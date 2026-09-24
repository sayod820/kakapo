/**
 * L9 — Monotonic changeSeq + tombstone stream (pure, Node-testable).
 * changeSeq is authoritative ordering. Timestamps are metadata only.
 */

export const SYNC_CHANGE_ACTIONS = Object.freeze({
  UPSERT: 'upsert',
  DELETE: 'delete',
})

export const CURSOR_EXPIRED = 'CURSOR_EXPIRED'

/** Default retention: 90 days. Row cap sized for ~50k/day × 90d (not 500k ≈ 10d). */
export const DEFAULT_RETENTION = Object.freeze({
  maxAgeMs: 90 * 24 * 60 * 60 * 1000,
  maxRows: 5_000_000,
})

export function ensureChangeLogState(state = {}) {
  if (!Array.isArray(state.syncChangeLog)) state.syncChangeLog = []
  if (!state._seq || typeof state._seq !== 'object') state._seq = {}
  if (typeof state._seq.syncChange !== 'number') {
    let max = 0
    for (const row of state.syncChangeLog) {
      const n = Number(row?.changeSeq) || 0
      if (n > max) max = n
    }
    state._seq.syncChange = max
  }
  return state
}

/**
 * Append one change event. Caller must invoke AFTER successful business mutation
 * in the same synchronous turn (in-memory transitional atomicity).
 */
export function recordSyncChange(state, opts = {}) {
  ensureChangeLogState(state)
  const entityType = String(opts.entityType || opts.kind || '').trim()
  const entityId = String(opts.entityId ?? opts.id ?? '').trim()
  const action = String(opts.action || SYNC_CHANGE_ACTIONS.UPSERT).toLowerCase()
  if (!entityType || !entityId) return null
  if (action !== SYNC_CHANGE_ACTIONS.UPSERT && action !== SYNC_CHANGE_ACTIONS.DELETE) {
    throw new Error(`invalid_sync_action:${action}`)
  }

  const changeSeq = (Number(state._seq.syncChange) || 0) + 1
  state._seq.syncChange = changeSeq
  const updatedAt = String(opts.updatedAt || opts.updatedAtIso || new Date().toISOString())
  const revision = opts.revision != null ? Number(opts.revision) : null
  const row = {
    changeSeq,
    entityType,
    entityId,
    action,
    revision: Number.isFinite(revision) ? revision : null,
    updatedAt,
    data: action === SYNC_CHANGE_ACTIONS.DELETE ? null : (opts.data === undefined ? null : opts.data),
    sourceClientRef: opts.sourceClientRef ? String(opts.sourceClientRef) : null,
    createdAt: new Date().toISOString(),
  }
  state.syncChangeLog.push(row)
  // Prune opportunistically (every 1024 inserts) — correctness retention, not per-row cost
  if ((changeSeq & 1023) === 0) {
    pruneChangeLog(state, opts.retention || DEFAULT_RETENTION)
  }
  return row
}

export function pruneChangeLog(state, retention = DEFAULT_RETENTION) {
  ensureChangeLogState(state)
  const maxAgeMs = Number(retention.maxAgeMs) || DEFAULT_RETENTION.maxAgeMs
  const maxRows = Number(retention.maxRows) || DEFAULT_RETENTION.maxRows
  const edge = Date.now() - maxAgeMs
  let rows = state.syncChangeLog.filter((r) => {
    const t = Date.parse(r.createdAt || r.updatedAt || '')
    if (!Number.isFinite(t)) return true
    return t >= edge
  })
  if (rows.length > maxRows) rows = rows.slice(-maxRows)
  state.syncChangeLog = rows
  return rows.length
}

export function getServerHeadCursor(state) {
  ensureChangeLogState(state)
  return Number(state._seq.syncChange) || 0
}

export function getMinAvailableCursor(state) {
  ensureChangeLogState(state)
  if (!state.syncChangeLog.length) return 0
  return Number(state.syncChangeLog[0].changeSeq) || 0
}

/**
 * Query changes WHERE change_seq > cursor ORDER BY change_seq ASC LIMIT n
 */
export function queryChangesSince(state, cursor, opts = {}) {
  ensureChangeLogState(state)
  const after = Math.max(0, Number(cursor) || 0)
  const limit = Math.max(1, Math.min(5000, Number(opts.limit) || 500))
  const scope = String(opts.scope || '').trim().toLowerCase()
  const minAvailable = getMinAvailableCursor(state)
  const serverHead = getServerHeadCursor(state)

  // Cursor below retention window → explicit expiry (never silent full dump)
  if (after > 0 && minAvailable > 0 && after < minAvailable - 1) {
    // allow after === minAvailable-1 (next expected). Expired if after < first-1
    // Strict: if after < minAvailable - 0 and first event is minAvailable, cursor after=minAvailable-1 is OK
  }
  if (after > 0 && minAvailable > 0 && after < minAvailable) {
    // If the next needed seq is gone: after+1 < minAvailable
    if (after + 1 < minAvailable) {
      return {
        ok: false,
        error: CURSOR_EXPIRED,
        code: CURSOR_EXPIRED,
        minAvailableCursor: minAvailable,
        serverHeadCursor: serverHead,
        changes: [],
        nextCursor: after,
        hasMore: false,
      }
    }
  }

  let rows = state.syncChangeLog.filter((r) => (Number(r.changeSeq) || 0) > after)
  if (scope === 'pos-lite' || scope === 'pos' || scope === 'sales') {
    const allow = new Set(['sale', 'shift', 'client', 'card'])
    rows = rows.filter((r) => allow.has(String(r.entityType)))
  } else if (scope === 'warehouse' || scope === 'stock') {
    const allow = new Set(['product', 'receipt', 'writeoff', 'revision', 'supplier', 'stock_layer', 'category'])
    rows = rows.filter((r) => allow.has(String(r.entityType)))
  } else if (scope === 'finance') {
    const allow = new Set(['finance_move', 'expense', 'shift'])
    rows = rows.filter((r) => allow.has(String(r.entityType)))
  }
  // IMPORTANT: scoped filter does NOT advance past filtered-out seqs as "applied".
  // Safe strategy: scoped responses still return global nextCursor from unfiltered stream
  // only when scope is empty. For scoped pulls, nextCursor = last returned scoped seq,
  // and Desktop must NOT use scoped cursor as global (see L9 pos-lite strategy).

  const globalRows = state.syncChangeLog.filter((r) => (Number(r.changeSeq) || 0) > after)
  const sliced = rows.slice(0, limit)
  const lastReturned = sliced.length
    ? Number(sliced[sliced.length - 1].changeSeq)
    : after
  // Global-safe cursor: always based on unfiltered stream head for this window
  let nextCursor = after
  if (!scope) {
    const globalSlice = globalRows.slice(0, limit)
    nextCursor = globalSlice.length
      ? Number(globalSlice[globalSlice.length - 1].changeSeq)
      : after
    return {
      ok: true,
      changes: globalSlice,
      nextCursor,
      hasMore: globalRows.length > limit,
      minAvailableCursor: minAvailable,
      serverHeadCursor: serverHead,
      protocol: 'changeSeq',
      version: 2,
    }
  }

  // Scoped: return filtered changes but nextCursor stays global-safe from unfiltered
  // up to the max seq examined in this page (so cross-scope events are not skipped).
  const globalSlice = globalRows.slice(0, limit)
  nextCursor = globalSlice.length
    ? Number(globalSlice[globalSlice.length - 1].changeSeq)
    : after
  // Include only scoped events that fall within the global page window
  const windowMax = nextCursor
  const scopedInWindow = rows.filter((r) => (Number(r.changeSeq) || 0) <= windowMax)

  return {
    ok: true,
    changes: scopedInWindow,
    nextCursor,
    hasMore: globalRows.length > limit,
    minAvailableCursor: minAvailable,
    serverHeadCursor: serverHead,
    protocol: 'changeSeq',
    version: 2,
    scope: scope || 'full',
    // Diagnostic: lastReturned may be < nextCursor when scope filters
    lastScopedSeq: lastReturned,
  }
}

/**
 * Convert change events → L8-style delta bags for atomic apply.
 * Applies ascending changeSeq; later events win per entity.
 */
export function changesToDeltaBags(changes = []) {
  const byKey = new Map() // `${type}:${id}` → last event
  const ordered = [...changes].sort((a, b) => (Number(a.changeSeq) || 0) - (Number(b.changeSeq) || 0))
  for (const ev of ordered) {
    const type = String(ev.entityType || '')
    const id = String(ev.entityId || '')
    if (!type || !id) continue
    const prev = byKey.get(`${type}:${id}`)
    if (prev) {
      const prevRev = Number(prev.revision)
      const nextRev = Number(ev.revision)
      // Do not regress entity revision when duplicate/older arrives
      if (Number.isFinite(prevRev) && Number.isFinite(nextRev) && nextRev < prevRev) continue
      if ((Number(prev.changeSeq) || 0) > (Number(ev.changeSeq) || 0)) continue
    }
    byKey.set(`${type}:${id}`, ev)
  }

  const bags = {
    products: [],
    clients: [],
    cards: [],
    categories: [],
    stockLayers: [],
    deletes: [],
    pos: {
      sales: [],
      shifts: [],
      receipts: [],
      writeoffs: [],
      revisions: [],
      financeMoves: [],
      expenses: [],
      suppliers: [],
      posPoints: [],
      cashiers: [],
      expiry: [],
    },
  }

  const pushUpsert = (list, ev) => {
    if (ev.data && typeof ev.data === 'object') list.push(ev.data)
    else list.push({ id: ev.entityId })
  }

  for (const ev of byKey.values()) {
    const t = ev.entityType
    if (ev.action === SYNC_CHANGE_ACTIONS.DELETE) {
      bags.deletes.push({ kind: t, id: ev.entityId, changeSeq: ev.changeSeq })
      continue
    }
    if (t === 'product') pushUpsert(bags.products, ev)
    else if (t === 'client') pushUpsert(bags.clients, ev)
    else if (t === 'card') pushUpsert(bags.cards, ev)
    else if (t === 'category') pushUpsert(bags.categories, ev)
    else if (t === 'stock_layer') pushUpsert(bags.stockLayers, ev)
    else if (t === 'sale') pushUpsert(bags.pos.sales, ev)
    else if (t === 'shift') pushUpsert(bags.pos.shifts, ev)
    else if (t === 'receipt') pushUpsert(bags.pos.receipts, ev)
    else if (t === 'writeoff') pushUpsert(bags.pos.writeoffs, ev)
    else if (t === 'revision') pushUpsert(bags.pos.revisions, ev)
    else if (t === 'finance_move') pushUpsert(bags.pos.financeMoves, ev)
    else if (t === 'expense') pushUpsert(bags.pos.expenses, ev)
    else if (t === 'supplier') pushUpsert(bags.pos.suppliers, ev)
    else if (t === 'pos_point') pushUpsert(bags.pos.posPoints, ev)
    else if (t === 'cashier') pushUpsert(bags.pos.cashiers, ev)
  }

  return bags
}

/**
 * Deterministic entity apply rule for tests.
 * state.entities: Map key → { revision, changeSeq, data, deleted }
 */
export function applyChangeEventToEntityMap(entities, ev) {
  const key = `${ev.entityType}:${ev.entityId}`
  const prev = entities.get(key)
  const seq = Number(ev.changeSeq) || 0
  const rev = ev.revision != null ? Number(ev.revision) : null

  if (prev) {
    if ((Number(prev.changeSeq) || 0) > seq) return { applied: false, reason: 'older_seq' }
    // After tombstone, a new upsert starts a new lifecycle (ID reuse allowed)
    if (!prev.deleted) {
      if (
        Number.isFinite(Number(prev.revision))
        && Number.isFinite(rev)
        && rev < Number(prev.revision)
      ) {
        return { applied: false, reason: 'older_revision' }
      }
    }
  }

  if (ev.action === SYNC_CHANGE_ACTIONS.DELETE) {
    entities.set(key, {
      revision: rev ?? (prev?.revision ?? null),
      changeSeq: seq,
      data: null,
      deleted: true,
    })
    return { applied: true, reason: 'delete' }
  }

  entities.set(key, {
    revision: rev ?? (prev?.revision ?? null),
    changeSeq: seq,
    data: ev.data,
    deleted: false,
  })
  return { applied: true, reason: 'upsert' }
}

/** Estimate retention cost helpers */
export function estimateRetention(opts = {}) {
  const eventsPerDay = Number(opts.eventsPerDay) || 50_000
  const avgBytes = Number(opts.avgBytesPerEvent) || 800
  const days = Number(opts.days) || 90
  const bytesPerDay = eventsPerDay * avgBytes
  return {
    eventsPerDay,
    avgBytesPerEvent: avgBytes,
    retentionDays: days,
    storagePerDayMb: Math.round((bytesPerDay / (1024 * 1024)) * 100) / 100,
    storageTotalMb: Math.round((bytesPerDay * days) / (1024 * 1024)),
    recommendedMaxRows: Math.max(DEFAULT_RETENTION.maxRows, eventsPerDay * days),
  }
}

/** Migration: never set cursor=head after baseline — use H1 captured BEFORE baseline. */
export function chooseMigrationCursor(opts = {}) {
  const existing = opts.existingChangeSeqCursor
  if (existing != null && Number(existing) >= 0) {
    return { cursor: Number(existing), mode: 'resume' }
  }
  if (opts.cursorExpired || opts.needsBaseline) {
    return { cursor: null, mode: 'needs_baseline' }
  }
  const h1 = opts.baselineStartChangeSeq
  if (h1 != null && Number.isFinite(Number(h1)) && Number(h1) >= 0 && opts.baselineComplete) {
    // Catch-up starts strictly AFTER H1; concurrent  H1+1..head are not missed.
    return { cursor: Number(h1), mode: 'catchup_after_h1' }
  }
  // Do NOT use serverHeadCursor alone — that is the L9 race.
  return { cursor: null, mode: 'keep_v1_until_baseline' }
}
