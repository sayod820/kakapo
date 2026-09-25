/**
 * L10 — Single change writer + durable PG journal flush.
 *
 * Architecture (chosen: durable journal-before-response):
 * 1. Business mutation succeeds in memory
 * 2. recordSyncChange queues an event (ONLY writer entrypoint)
 * 3. flushSyncChangeJournal() BEFORE HTTP 200 / inside persistNow:
 *    - PG: INSERT sync_changes (BIGSERIAL seq) — authoritative
 *    - mirror committed rows into db.syncChangeLog
 *    - JSON engine: assign memory seq immediately (lab)
 *
 * Guarantees when PG enabled and flush awaited before response:
 * - no change event without prior business mutation (record only after mutate)
 * - no accepted response without durable journal rows for that request's pending
 * - crash after flush before response → client retries; idempotent source_client_ref suppresses dupes
 *
 * Residual (honest): crash AFTER memory mutate BEFORE flush → mutation without event until retry.
 * Idempotent clientRef retry re-records and flushes.
 */
import {
  recordSyncChange as recordCore,
  queryChangesSince,
  getServerHeadCursor as getMemoryHead,
  getMinAvailableCursor as getMemoryMin,
  changesToDeltaBags,
  ensureChangeLogState,
  pruneChangeLog,
  CURSOR_EXPIRED,
  SYNC_CHANGE_ACTIONS,
  DEFAULT_RETENTION,
} from '../../lib/syncChangeLogCore.mjs'
import { isPostgresEnabled } from './pg/client.js'

export {
  CURSOR_EXPIRED,
  SYNC_CHANGE_ACTIONS,
  changesToDeltaBags,
  pruneChangeLog,
  DEFAULT_RETENTION,
}

/** Observability (process-local, bounded). */
const metrics = {
  eventsWritten: 0,
  eventsByEntityType: Object.create(null),
  journalWriteFailures: 0,
  duplicateJournalSuppressed: 0,
  cursorExpiredResponses: 0,
  v1Requests: 0,
  v2Requests: 0,
  journalFlushes: 0,
}

export function getSyncChangeMetrics() {
  return {
    ...metrics,
    eventsByEntityType: { ...metrics.eventsByEntityType },
  }
}

export function noteSyncProtocolRequest(version) {
  if (Number(version) >= 2) metrics.v2Requests += 1
  else metrics.v1Requests += 1
}

export function ensureSyncChangeLog(db) {
  return ensureChangeLogState(db)
}

function normalizeEntry(opts = {}) {
  const entityType = String(opts.entityType || opts.kind || '').trim()
  const entityId = String(opts.entityId ?? opts.id ?? '').trim()
  const action = String(opts.action || SYNC_CHANGE_ACTIONS.UPSERT).toLowerCase()
  return {
    entityType,
    entityId,
    action,
    revision: opts.revision != null ? Number(opts.revision) : null,
    updatedAt: String(opts.updatedAt || opts.updatedAtIso || new Date().toISOString()),
    data: action === SYNC_CHANGE_ACTIONS.DELETE ? null : (opts.data === undefined ? null : opts.data),
    sourceClientRef: opts.sourceClientRef ? String(opts.sourceClientRef) : null,
  }
}

/**
 * Canonical writer — ALL mutation paths must use this (or recordEntityUpsert/Delete).
 * Does NOT push to syncChangeLog directly when PG is enabled — queues for durable flush.
 */
export function recordSyncChange(db, opts = {}) {
  ensureSyncChangeLog(db)
  const entry = normalizeEntry(opts)
  if (!entry.entityType || !entry.entityId) return null

  if (!isPostgresEnabled()) {
    // Lab / JSON engine: durable = memory + kakapo.json snapshot
    const row = recordCore(db, entry)
    bumpMetrics(row)
    return row
  }

  if (!Array.isArray(db._pendingSyncChanges)) db._pendingSyncChanges = []
  db._pendingSyncChanges.push(entry)
  return entry
}

function bumpMetrics(row, duplicate = false) {
  if (!row) return
  if (duplicate) {
    metrics.duplicateJournalSuppressed += 1
    return
  }
  metrics.eventsWritten += 1
  const t = String(row.entityType || 'unknown')
  metrics.eventsByEntityType[t] = (metrics.eventsByEntityType[t] || 0) + 1
}

function mirrorRow(db, row) {
  ensureSyncChangeLog(db)
  const mapped = {
    changeSeq: Number(row.changeSeq),
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    revision: row.revision,
    updatedAt: row.updatedAt,
    data: row.data,
    sourceClientRef: row.sourceClientRef,
    createdAt: row.createdAt || new Date().toISOString(),
  }
  // Avoid duplicate mirror if already present (idempotent flush)
  const exists = (db.syncChangeLog || []).some((r) => Number(r.changeSeq) === mapped.changeSeq)
  if (!exists) {
    db.syncChangeLog.push(mapped)
    if ((Number(db._seq.syncChange) || 0) < mapped.changeSeq) {
      db._seq.syncChange = mapped.changeSeq
    }
  }
  return mapped
}

/**
 * Flush pending change events to durable PG journal (or no-op for JSON).
 * MUST be awaited before HTTP 200 for covered mutations when PG enabled.
 */
export async function flushSyncChangeJournal(db) {
  ensureSyncChangeLog(db)
  const pending = Array.isArray(db._pendingSyncChanges) ? db._pendingSyncChanges.splice(0) : []
  if (!pending.length) {
    return { ok: true, count: 0, pending: 0 }
  }
  if (!isPostgresEnabled()) {
    // Should not happen — JSON path writes immediately in recordSyncChange
    for (const p of pending) {
      const row = recordCore(db, p)
      bumpMetrics(row)
    }
    return { ok: true, count: pending.length, pending: 0 }
  }

  try {
    const { insertSyncChangesPgBatch } = await import('./pg/syncChangesJournal.js')
    const rows = await insertSyncChangesPgBatch(pending)
    for (const row of rows) {
      mirrorRow(db, row)
      bumpMetrics(row, !!row.duplicate)
    }
    metrics.journalFlushes += 1
    // Retention: prune memory mirror only (PG retained separately)
    pruneChangeLog(db, {
      maxAgeMs: 90 * 24 * 60 * 60 * 1000,
      maxRows: 5_000_000, // ~90d at 50k/day — do not use 500k (≈10d)
    })
    return { ok: true, count: rows.length, pending: 0 }
  } catch (e) {
    metrics.journalWriteFailures += 1
    // Re-queue so retry can flush
    db._pendingSyncChanges = pending.concat(db._pendingSyncChanges || [])
    throw e
  }
}

export function recordEntityUpsert(db, entityType, entityId, data, opts = {}) {
  return recordSyncChange(db, {
    entityType,
    entityId,
    action: SYNC_CHANGE_ACTIONS.UPSERT,
    revision: opts.revision ?? data?.docVersion ?? data?.debtPayVersion ?? data?.bonusPayVersion ?? null,
    updatedAt: opts.updatedAt || data?.serverAtIso || data?.updatedAtIso || data?.createdAtIso,
    data: data == null ? null : data,
    sourceClientRef: opts.sourceClientRef || data?.clientRef || null,
  })
}

export function recordEntityDelete(db, entityType, entityId, opts = {}) {
  return recordSyncChange(db, {
    entityType,
    entityId,
    action: SYNC_CHANGE_ACTIONS.DELETE,
    revision: opts.revision ?? null,
    updatedAt: opts.updatedAt || new Date().toISOString(),
    data: null,
    sourceClientRef: opts.sourceClientRef || null,
  })
}

export async function getServerHeadCursor(db) {
  if (isPostgresEnabled()) {
    try {
      await flushSyncChangeJournal(db)
      const { getSyncChangesHeadPg } = await import('./pg/syncChangesJournal.js')
      const h = await getSyncChangesHeadPg()
      return h.serverHeadCursor
    } catch { /* fall through */ }
  }
  ensureSyncChangeLog(db)
  return getMemoryHead(db)
}

/** Cursor a client may adopt after a v1 pull without skipping in-flight journal rows. */
export async function getSafeHeadCursor(db) {
  if (isPostgresEnabled()) {
    await flushSyncChangeJournal(db)
    const { getSyncChangesHeadPg } = await import('./pg/syncChangesJournal.js')
    const h = await getSyncChangesHeadPg()
    return h.safeHeadCursor
  }
  ensureSyncChangeLog(db)
  return getMemoryHead(db)
}

export async function getMinAvailableCursor(db) {
  if (isPostgresEnabled()) {
    try {
      const { getSyncChangesHeadPg } = await import('./pg/syncChangesJournal.js')
      const h = await getSyncChangesHeadPg()
      return h.minAvailableCursor
    } catch { /* fall through */ }
  }
  ensureSyncChangeLog(db)
  return getMemoryMin(db)
}

/** Sync helpers for tests / non-PG */
export function getServerHeadCursorSync(db) {
  ensureSyncChangeLog(db)
  return getMemoryHead(db)
}

export function queryChangesSinceMemory(db, cursor, opts) {
  return queryChangesSince(db, cursor, opts)
}

/**
 * Build v2 protocol response from durable PG journal when available.
 * L11: when DATABASE_URL set, PG is the ONLY v2 authority — no memory fallback on failure.
 */
export async function buildSyncChangesV2(db, opts = {}) {
  noteSyncProtocolRequest(2)
  ensureSyncChangeLog(db)

  if (isPostgresEnabled()) {
    // Flush any leftover non-tx pending (legacy paths) before read
    try {
      await flushSyncChangeJournal(db)
    } catch (e) {
      metrics.journalWriteFailures += 1
      throw e
    }
    const { querySyncChangesPg } = await import('./pg/syncChangesJournal.js')
    const res = await querySyncChangesPg(
      opts.cursor != null ? opts.cursor : opts.since,
      { limit: opts.limit, scope: opts.scope },
    )
    if (!res.ok && res.code === CURSOR_EXPIRED) {
      metrics.cursorExpiredResponses += 1
      return {
        ok: false,
        error: CURSOR_EXPIRED,
        code: CURSOR_EXPIRED,
        protocol: 'changeSeq',
        version: 2,
        changes: [],
        nextCursor: Number(opts.cursor) || 0,
        hasMore: false,
        minAvailableCursor: res.minAvailableCursor,
        serverHeadCursor: res.serverHeadCursor,
        full: false,
      }
    }
    const bags = changesToDeltaBags(res.changes || [])
    return {
      ok: true,
      protocol: 'changeSeq',
      version: 2,
      durable: true,
      changes: res.changes,
      nextCursor: res.nextCursor,
      cursor: String(res.nextCursor),
      hasMore: res.hasMore,
      minAvailableCursor: res.minAvailableCursor,
      serverHeadCursor: res.serverHeadCursor,
      scope: res.scope || (opts.scope || 'full'),
      full: false,
      since: null,
      products: bags.products,
      categories: bags.categories,
      clients: bags.clients,
      cards: bags.cards,
      deletes: bags.deletes,
      stockLayers: bags.stockLayers,
      stockLayersReplace: false,
      pos: bags.pos,
    }
  }

  // Lab JSON engine only
  await flushSyncChangeJournal(db)
  const cursor = opts.cursor != null ? opts.cursor : opts.since
  const res = queryChangesSince(db, cursor, { limit: opts.limit, scope: opts.scope })
  if (!res.ok && res.code === CURSOR_EXPIRED) {
    metrics.cursorExpiredResponses += 1
    return {
      ok: false,
      error: CURSOR_EXPIRED,
      code: CURSOR_EXPIRED,
      protocol: 'changeSeq',
      version: 2,
      changes: [],
      nextCursor: Number(cursor) || 0,
      hasMore: false,
      minAvailableCursor: res.minAvailableCursor,
      serverHeadCursor: res.serverHeadCursor,
      full: false,
    }
  }
  const bags = changesToDeltaBags(res.changes || [])
  return {
    ok: true,
    protocol: 'changeSeq',
    version: 2,
    durable: false,
    changes: res.changes,
    nextCursor: res.nextCursor,
    cursor: String(res.nextCursor),
    hasMore: res.hasMore,
    minAvailableCursor: res.minAvailableCursor,
    serverHeadCursor: res.serverHeadCursor,
    scope: res.scope || (opts.scope || 'full'),
    full: false,
    since: null,
    products: bags.products,
    categories: bags.categories,
    clients: bags.clients,
    cards: bags.cards,
    deletes: bags.deletes,
    stockLayers: bags.stockLayers,
    stockLayersReplace: false,
    pos: bags.pos,
  }
}

/** Sync build for memory-only tests */
export function buildSyncChangesV2Sync(db, opts = {}) {
  noteSyncProtocolRequest(2)
  ensureSyncChangeLog(db)
  const cursor = opts.cursor != null ? opts.cursor : opts.since
  const res = queryChangesSince(db, cursor, { limit: opts.limit, scope: opts.scope })
  if (!res.ok && res.code === CURSOR_EXPIRED) {
    metrics.cursorExpiredResponses += 1
    return {
      ok: false,
      error: CURSOR_EXPIRED,
      code: CURSOR_EXPIRED,
      protocol: 'changeSeq',
      version: 2,
      changes: [],
      nextCursor: Number(cursor) || 0,
      hasMore: false,
      minAvailableCursor: res.minAvailableCursor,
      serverHeadCursor: res.serverHeadCursor,
      full: false,
    }
  }
  const bags = changesToDeltaBags(res.changes || [])
  return {
    ok: true,
    protocol: 'changeSeq',
    version: 2,
    durable: false,
    changes: res.changes,
    nextCursor: res.nextCursor,
    cursor: String(res.nextCursor),
    hasMore: res.hasMore,
    minAvailableCursor: res.minAvailableCursor,
    serverHeadCursor: res.serverHeadCursor,
    scope: res.scope || (opts.scope || 'full'),
    full: false,
    since: null,
    products: bags.products,
    categories: bags.categories,
    clients: bags.clients,
    cards: bags.cards,
    deletes: bags.deletes,
    stockLayers: bags.stockLayers,
    stockLayersReplace: false,
    pos: bags.pos,
  }
}
