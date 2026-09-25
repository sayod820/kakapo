/**
 * L11 — OPTION A: one PostgreSQL transaction for
 *   business docs + opRef/idempotency + sync_changes
 *
 * Flow (PG mode):
 *   advisory lock(clientRef)
 *   → check durable opRef (replay if done)
 *   → mutate memory (under lock; undo on rollback)
 *   → UPSERT touched docs + opRef
 *   → INSERT sync_changes
 *   → COMMIT
 *   → memory already holds projection (undo only on rollback)
 *
 * JSON / no-DATABASE_URL lab: memory backend simulating atomicity.
 *
 * HTTP 200 must only follow successful commit (caller responsibility).
 */
'use strict'

import { isPostgresEnabled, withTransaction, withClient } from './client.js'
import { maybeL13Hold } from './l13Chaos.js'
import { rowIdForItem } from './store.js'
import { notePersistedMemoryRows } from './snapshotChangeJournal.js'
import { claimDocWithClient, upsertDocWithClient } from './idempotentClaim.js'

export class BusinessTxFail extends Error {
  constructor(point) {
    super(`L11_FAIL_${point}`)
    this.point = point
    this.code = 'L11_INJECTED_FAIL'
  }
}

/** Bounded aggregate metrics */
const metrics = {
  businessTxStarted: 0,
  businessTxCommitted: 0,
  businessTxRolledBack: 0,
  businessTxCommitFailures: 0,
  syncRowsCommitted: 0,
  idempotentReplayHits: 0,
  concurrentDuplicateSuppressed: 0,
  memoryProjectionFailures: 0,
  snapshotConflictPrevented: 0,
}

export function getBusinessTxMetrics() {
  return { ...metrics }
}

export function resetBusinessTxMetrics() {
  for (const k of Object.keys(metrics)) metrics[k] = 0
}

export function opRefDocId(operationKind, clientRef) {
  const k = String(operationKind || '').trim()
  const ref = String(clientRef || '').trim()
  if (!k || !ref) return ''
  return `op:${k}:${ref}`
}

/**
 * Collections commonly touched by Desktop-visible mutations.
 * Used for undo snapshots when not explicitly listed.
 */
export const TX_COLLECTIONS = Object.freeze([
  'posSales',
  'posShifts',
  'products',
  'clients',
  'cards',
  'stockReceipts',
  'writeOffs',
  'stockRevisions',
  'suppliers',
  'financeMoves',
  'expenses',
  'moneyLedger',
  'opRefs',
  'orders',
  'cashiers',
  'posPoints',
  'categories',
  'employees',
  'supplierPayments',
  'stockAdjustments',
  'syncDeletes',
])

/** Serialize concurrent stock mutations on the same product (different clientRefs). */
export function stockProductAdvisoryLocks(productIds) {
  const ids = [...new Set((productIds || []).map((n) => Number(n)).filter((n) => n > 0))].sort((a, b) => a - b)
  return ids.map((id) => ({ ns: 'stock_product', key: String(id) }))
}

/** Serialize concurrent mutations on one order (+ related stock rows). */
export function orderResourceAdvisoryLocks(orderId, productIds = []) {
  const oid = String(orderId || '').trim()
  const locks = oid ? [{ ns: 'order', key: oid }] : []
  return sortAdvisoryLocks([...locks, ...stockProductAdvisoryLocks(productIds)])
}

/** Deterministic CRM owner locks (different clientRefs, same debt/bonus row). */
export function sortAdvisoryLocks(locks) {
  return [...(locks || [])]
    .map((L) => ({
      ns: String(L?.ns || '').trim(),
      key: String(L?.key || '').trim(),
    }))
    .filter((L) => L.ns && L.key)
    .sort((a, b) => `${a.ns}:${a.key}`.localeCompare(`${b.ns}:${b.key}`))
}

export function crmResourceLocksForCard(db, cardNum) {
  const num = String(cardNum || '').trim().toUpperCase()
  if (!num) return []
  const card = (db.cards || []).find((c) => String(c.num || '').toUpperCase() === num)
  const locks = [{ ns: 'crm_bonus_card', key: num }]
  const cid = card?.clientId != null ? String(card.clientId) : ''
  if (cid) locks.push({ ns: 'crm_debt_client', key: cid })
  if (cid) locks.push({ ns: 'crm_link_client', key: cid })
  locks.push({ ns: 'crm_link_card', key: num })
  const ph = String(card?.phone || '').replace(/\D/g, '').slice(-9)
  if (ph) locks.push({ ns: 'crm_link_client', key: `phone:${ph}` })
  return sortAdvisoryLocks(locks)
}

export function crmResourceLocksForClient(db, clientId, phone) {
  const locks = []
  const cid = clientId != null ? String(clientId) : ''
  if (cid) {
    locks.push({ ns: 'crm_debt_client', key: cid })
    locks.push({ ns: 'crm_link_client', key: cid })
  }
  const ph = String(phone || '').replace(/\D/g, '').slice(-9)
  if (ph) locks.push({ ns: 'crm_link_client', key: `phone:${ph}` })
  return sortAdvisoryLocks(locks)
}

/** O4D: link / unlink / replace — client + old/new card namespaces. */
export function crmResourceLocksForLink(db, opts = {}) {
  const locks = []
  const clientId = opts.clientId != null ? String(opts.clientId) : ''
  const oldNum = opts.oldCardNum ? String(opts.oldCardNum).trim().toUpperCase() : ''
  const newNum = opts.newCardNum ? String(opts.newCardNum).trim().toUpperCase() : ''
  if (clientId) {
    locks.push(...crmResourceLocksForClient(db, clientId, opts.phone))
  }
  if (oldNum) locks.push(...crmResourceLocksForCard(db, oldNum))
  if (newNum && newNum !== oldNum) locks.push(...crmResourceLocksForCard(db, newNum))
  return sortAdvisoryLocks(locks)
}

function deepClone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v))
}

export function snapshotCollections(db, collections = TX_COLLECTIONS) {
  const snap = {}
  for (const col of collections) {
    if (Array.isArray(db[col])) snap[col] = deepClone(db[col])
  }
  if (db._pendingSyncChanges) snap._pendingSyncChanges = deepClone(db._pendingSyncChanges)
  if (db.syncChangeLog) snap.syncChangeLog = deepClone(db.syncChangeLog)
  if (db._seq) snap._seq = deepClone(db._seq)
  return snap
}

export function restoreCollections(db, snap) {
  if (!snap) return
  if (snap._cashVault != null) {
    db.cashVault = deepClone(snap._cashVault)
  }
  for (const [col, rows] of Object.entries(snap)) {
    if (col.startsWith('_') && col !== '_pendingSyncChanges' && col !== '_seq') continue
    if (col === '_pendingSyncChanges') {
      db._pendingSyncChanges = deepClone(rows) || []
      continue
    }
    if (col === 'syncChangeLog') {
      db.syncChangeLog = deepClone(rows) || []
      continue
    }
    if (col === '_seq') {
      db._seq = deepClone(rows) || {}
      continue
    }
    db[col] = deepClone(rows)
  }
}

/**
 * Build doc rows from in-memory entities.
 * @param {Array<{collection:string, id?:string, row?:object}>|Array<{collection:string,ids:string[]}>} touched
 */
export function collectDocRows(db, touched = []) {
  const out = []
  const seen = new Set()
  for (const t of touched) {
    const collection = String(t.collection || '').trim()
    if (!collection) continue
    if (Array.isArray(t.ids)) {
      const list = db[collection] || []
      for (const id of t.ids) {
        const sid = String(id)
        const row = list.find((x, i) => rowIdForItem(x, i) === sid || String(x?.id) === sid || String(x?.num) === sid)
        if (!row) continue
        const docId = rowIdForItem(row, 0)
        const key = `${collection}\0${docId}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ collection, id: docId, data: stampTxMeta(row) })
      }
      continue
    }
    const row = t.row
    if (!row) continue
    const docId = String(t.id || rowIdForItem(row, 0))
    const key = `${collection}\0${docId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ collection, id: docId, data: stampTxMeta(row) })
  }
  return out
}

function stampTxMeta(row) {
  const data = deepClone(row)
  if (data && typeof data === 'object') {
    data._txCommittedAt = data._txCommittedAt || new Date().toISOString()
  }
  return data
}

export function takePendingSyncChanges(db) {
  const pending = Array.isArray(db._pendingSyncChanges) ? db._pendingSyncChanges.splice(0) : []
  return pending
}

export function peekPendingSyncChanges(db) {
  return Array.isArray(db._pendingSyncChanges) ? db._pendingSyncChanges.slice() : []
}

async function loadOpRefPg(client, operationKind, clientRef) {
  const id = opRefDocId(operationKind, clientRef)
  if (!id) return null
  const res = await client.query(
    `SELECT id, data FROM docs WHERE collection = 'opRefs' AND id = $1 LIMIT 1`,
    [id],
  )
  return res.rows[0]?.data || null
}

async function insertSyncChangeOnClient(client, entry, fail) {
  const entityType = String(entry.entityType || '').trim()
  const entityId = String(entry.entityId || '').trim()
  const action = String(entry.action || 'upsert').toLowerCase()
  if (!entityType || !entityId) return null
  const revision = entry.revision != null && Number.isFinite(Number(entry.revision))
    ? Number(entry.revision)
    : null
  const updatedAt = entry.updatedAt || new Date().toISOString()
  const data = entry.data === undefined ? null : entry.data
  const sourceClientRef = entry.sourceClientRef ? String(entry.sourceClientRef) : null

  fail?.('during_journal_row')

  if (sourceClientRef) {
    const existing = await client.query(
      `SELECT change_seq, created_at, entity_type, entity_id, action, revision, updated_at, data, source_client_ref
       FROM sync_changes
       WHERE source_client_ref = $1 AND entity_type = $2 AND entity_id = $3 AND action = $4
       LIMIT 1`,
      [sourceClientRef, entityType, entityId, action],
    )
    if (existing.rows[0]) {
      const r = existing.rows[0]
      return {
        changeSeq: Number(r.change_seq),
        createdAt: r.created_at,
        entityType: r.entity_type,
        entityId: r.entity_id,
        action: r.action,
        revision: r.revision != null ? Number(r.revision) : null,
        updatedAt: r.updated_at,
        data: r.data,
        sourceClientRef: r.source_client_ref,
        duplicate: true,
      }
    }
  }

  await client.query('SAVEPOINT sync_change_ins')
  try {
    const res = await client.query(
      `INSERT INTO sync_changes
        (entity_type, entity_id, action, revision, updated_at, data, source_client_ref)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb, $7)
       RETURNING change_seq, created_at, entity_type, entity_id, action, revision, updated_at, data, source_client_ref`,
      [
        entityType,
        entityId,
        action,
        revision,
        updatedAt,
        data == null ? null : JSON.stringify(data),
        sourceClientRef,
      ],
    )
    await client.query('RELEASE SAVEPOINT sync_change_ins')
    const r = res.rows[0]
    return {
      changeSeq: Number(r.change_seq),
      createdAt: r.created_at,
      entityType: r.entity_type,
      entityId: r.entity_id,
      action: r.action,
      revision: r.revision != null ? Number(r.revision) : null,
      updatedAt: r.updated_at,
      data: r.data,
      sourceClientRef: r.source_client_ref,
      duplicate: false,
    }
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT sync_change_ins')
    if (String(e?.code) === '23505' && sourceClientRef) {
      const again = await client.query(
        `SELECT change_seq, created_at, entity_type, entity_id, action, revision, updated_at, data, source_client_ref
         FROM sync_changes
         WHERE source_client_ref = $1 AND entity_type = $2 AND entity_id = $3 AND action = $4
         LIMIT 1`,
        [sourceClientRef, entityType, entityId, action],
      )
      const r = again.rows[0]
      if (r) {
        return {
          changeSeq: Number(r.change_seq),
          createdAt: r.created_at,
          entityType: r.entity_type,
          entityId: r.entity_id,
          action: r.action,
          revision: r.revision != null ? Number(r.revision) : null,
          updatedAt: r.updated_at,
          data: r.data,
          sourceClientRef: r.source_client_ref,
          duplicate: true,
        }
      }
    }
    throw e
  }
}

/** Collapse duplicate idempotency tuples within one business TX (same clientRef journal). */
function dedupeSyncChangesForInsert(entries) {
  if (!Array.isArray(entries) || entries.length < 2) return entries || []
  const seen = new Set()
  const out = []
  for (const entry of entries) {
    const ref = entry?.sourceClientRef ? String(entry.sourceClientRef) : ''
    const entityType = String(entry?.entityType || '').trim()
    const entityId = String(entry?.entityId || '').trim()
    const action = String(entry?.action || 'upsert').toLowerCase()
    if (ref && entityType && entityId) {
      const k = `${ref}\0${entityType}\0${entityId}\0${action}`
      if (seen.has(k)) continue
      seen.add(k)
    }
    out.push(entry)
  }
  return out
}

function mirrorSyncRows(db, rows) {
  if (!Array.isArray(db.syncChangeLog)) db.syncChangeLog = []
  if (!db._seq) db._seq = {}
  for (const row of rows || []) {
    if (!row || row.duplicate) continue
    const exists = db.syncChangeLog.some((r) => Number(r.changeSeq) === Number(row.changeSeq))
    if (exists) continue
    db.syncChangeLog.push({
      changeSeq: Number(row.changeSeq),
      entityType: row.entityType,
      entityId: row.entityId,
      action: row.action,
      revision: row.revision,
      updatedAt: row.updatedAt,
      data: row.data,
      sourceClientRef: row.sourceClientRef,
      createdAt: row.createdAt || new Date().toISOString(),
    })
    if ((Number(db._seq.syncChange) || 0) < Number(row.changeSeq)) {
      db._seq.syncChange = Number(row.changeSeq)
    }
  }
}

function applyDocsToMemory(db, docs, deletes) {
  try {
    for (const d of deletes || []) {
      const col = d.collection
      const id = String(d.id)
      if (!Array.isArray(db[col])) continue
      const idx = db[col].findIndex((x, i) => rowIdForItem(x, i) === id || String(x?.id) === id)
      if (idx >= 0) db[col].splice(idx, 1)
    }
    for (const doc of docs || []) {
      const col = doc.collection
      if (!Array.isArray(db[col])) db[col] = []
      const id = String(doc.id)
      const idx = db[col].findIndex((x, i) => rowIdForItem(x, i) === id || String(x?.id) === id)
      const data = deepClone(doc.data)
      if (idx >= 0) db[col][idx] = data
      else db[col].push(data)
    }
  } catch (e) {
    metrics.memoryProjectionFailures += 1
    throw e
  }
}

/** Serialize in-process stock mutations (PG tx lock alone can release before handler finishes). */
const memoryLocks = new Map()

function withMemoryLock(key, fn) {
  const prev = memoryLocks.get(key) || Promise.resolve()
  let release
  const gate = new Promise((r) => { release = r })
  const next = prev.then(() => gate)
  memoryLocks.set(key, next.catch(() => {}))
  return prev.then(fn).finally(() => release())
}

/**
 * Core helper — all migrated routes should use this (or commitBusinessMutation).
 *
 * @param {object} opts
 * @param {object} opts.db
 * @param {string} [opts.clientRef]
 * @param {string} opts.operationKind
 * @param {() => ({ result: any, docs?: any[], deletes?: any[], syncChanges?: any[], touched?: any[], collections?: string[] })} opts.mutate
 * @param {string} [opts.failAt] injected failure point
 * @param {boolean} [opts.deferMemoryApply] test: restore memory before commit, re-apply after
 */
export async function runBusinessMutationTx(opts = {}) {
  const {
    db,
    clientRef = '',
    operationKind,
    mutate,
    failAt = null,
    deferMemoryApply = false,
    advisoryLocks = [],
    fingerprint = null,
    authSubject = null,
  } = opts

  if (!operationKind || typeof mutate !== 'function') {
    throw new Error('runBusinessMutationTx: operationKind + mutate required')
  }

  const fail = (point) => {
    if (failAt && failAt === point) throw new BusinessTxFail(point)
  }

  metrics.businessTxStarted += 1
  const ref = String(clientRef || '').trim()
  const extraLocks = sortAdvisoryLocks(advisoryLocks)
  const actorSubject = authSubject != null && String(authSubject).trim()
    ? String(authSubject).trim()
    : null

  function assertReplayActor(existing) {
    if (!existing) return
    const stored = existing.authSubject ? String(existing.authSubject) : ''
    if (!stored || !actorSubject) return
    if (stored === actorSubject) return
    if (String(actorSubject).startsWith('ADMIN:')) return
    const err = new Error('Нет доступа к чужой идемпотентной операции')
    err.status = 403
    err.code = 'AUTH_OPREF_ACTOR_MISMATCH'
    throw err
  }

  // ——— JSON / lab without PG ———
  if (!isPostgresEnabled()) {
    return runMemoryAtomicTx({
      db,
      clientRef: ref,
      operationKind,
      mutate,
      fail,
      failAt,
      deferMemoryApply,
      advisoryLocks: extraLocks,
      fingerprint,
      authSubject: actorSubject,
      assertReplayActor,
    })
  }

  const collections = TX_COLLECTIONS
  const stockMemLockKeys = extraLocks
    .filter((L) => L.ns === 'stock_product')
    .map((L) => `mem:stock_product:${L.key}`)
    .sort()

  const executePgBusinessTx = async () => {
  /** Snapshot after advisory locks — avoids stale undo clobbering concurrent commits (O3B). */
  let undo = null
  let committed = false
  let out = null

  try {
    await maybeL13Hold('before_transaction')
    out = await withTransaction(async (client) => {
      fail('after_begin')

      // Stock / loyalty extras first (sorted product ids) — same order for all routes (O3C deadlock safe).
      for (const L of extraLocks) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [L.ns, L.key])
      }
      if (ref) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
          String(operationKind),
          ref,
        ])
        const existing = await loadOpRefPg(client, operationKind, ref)
        if (existing && (existing.status === 'done' || existing.result != null)) {
          assertReplayActor(existing)
          const storedFp = existing.fingerprint ? String(existing.fingerprint) : ''
          const incomingFp = fingerprint ? String(fingerprint) : ''
          if (incomingFp && storedFp && storedFp !== incomingFp) {
            const err = new Error('Тот же clientRef уже использован с другими параметрами')
            err.status = 409
            err.code = 'IDEMPOTENCY_KEY_REUSED'
            throw err
          }
          metrics.idempotentReplayHits += 1
          metrics.concurrentDuplicateSuppressed += 1
          return {
            ok: true,
            replay: true,
            result: existing.result,
            syncRows: [],
            docs: [],
            deletes: [],
          }
        }
      }

      undo = snapshotCollections(db, collections)
      undo._cashVault = deepClone(db.cashVault)

      fail('before_business_write')
      const prepared = await Promise.resolve(mutate())
      const result = prepared?.result
      let docs = Array.isArray(prepared?.docs) ? prepared.docs : null
      const deletes = Array.isArray(prepared?.deletes) ? prepared.deletes : []
      const metaUpdates = prepared?.meta && typeof prepared.meta === 'object' ? prepared.meta : null
      let syncChanges = Array.isArray(prepared?.syncChanges)
        ? prepared.syncChanges
        : takePendingSyncChanges(db)

      if (!docs) {
        docs = collectDocRows(db, prepared?.touched || [])
      }
      // Always persist opRef row when clientRef present
      const opId = ref ? opRefDocId(operationKind, ref) : ''
      const opPayload = opId
        ? {
            id: opId,
            kind: operationKind,
            clientRef: ref,
            status: 'done',
            result,
            fingerprint: fingerprint ? String(fingerprint) : null,
            authSubject: actorSubject,
            createdAtIso: new Date().toISOString(),
            updatedAtIso: new Date().toISOString(),
            _txCommittedAt: new Date().toISOString(),
          }
        : null

      fail('after_business_writes')

      if (deferMemoryApply) {
        // Test mode: strip memory mutation before durable write; apply after COMMIT
        restoreCollections(db, undo)
        // re-queue sync for insert from prepared copy
      }

      fail('during_opref')
      for (const doc of docs) {
        await upsertDocWithClient(client, doc.collection, doc.id, doc.data)
      }
      if (metaUpdates) {
        for (const [key, value] of Object.entries(metaUpdates)) {
          await client.query(
            `INSERT INTO kv_meta (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [String(key), JSON.stringify(value === undefined ? null : value)],
          )
        }
      }
      for (const d of deletes) {
        await client.query('DELETE FROM docs WHERE collection = $1 AND id = $2', [
          String(d.collection),
          String(d.id),
        ])
      }
      if (opPayload) {
        // Prefer claim-then-update for concurrent safety; we hold advisory lock already
        await upsertDocWithClient(client, 'opRefs', opId, opPayload)
      }

      fail('during_first_journal')
      const syncRows = []
      const journalEntries = dedupeSyncChangesForInsert(syncChanges)
      for (let i = 0; i < journalEntries.length; i++) {
        if (i === 0) fail('during_first_journal')
        if (i > 0) fail('during_nth_journal')
        const row = await insertSyncChangeOnClient(client, journalEntries[i], fail)
        if (row) syncRows.push(row)
      }

      fail('before_commit')
      await maybeL13Hold('before_commit')
      return {
        ok: true,
        replay: false,
        result,
        syncRows,
        docs,
        deletes,
        opPayload,
        syncChanges,
      }
    })
    await maybeL13Hold('after_commit')
    committed = true
  } catch (e) {
    metrics.businessTxRolledBack += 1
    if (e?.code === 'L11_INJECTED_FAIL' || String(e?.message || '').includes('L11_FAIL')) {
      // intentional
    } else {
      metrics.businessTxCommitFailures += 1
    }
    if (undo) restoreCollections(db, undo)
    // re-queue any pending that were taken
    throw e
  }

  if (!committed || !out) {
    if (undo) restoreCollections(db, undo)
    throw new Error('business tx failed without commit')
  }

  if (out.replay) {
    // Ensure memory projection matches durable replay if needed
    metrics.businessTxCommitted += 1
    return out
  }

  try {
    if (deferMemoryApply) {
      applyDocsToMemory(db, out.docs, out.deletes)
      if (out.opPayload) {
        if (!Array.isArray(db.opRefs)) db.opRefs = []
        const idx = db.opRefs.findIndex((r) => String(r.id) === String(out.opPayload.id))
        if (idx >= 0) db.opRefs[idx] = out.opPayload
        else db.opRefs.push(out.opPayload)
      }
    } else {
      // Memory already mutated under lock; stamp opRef into memory
      if (out.opPayload) {
        if (!Array.isArray(db.opRefs)) db.opRefs = []
        const idx = db.opRefs.findIndex(
          (r) => String(r.id) === String(out.opPayload.id)
            || (r.kind === operationKind && r.clientRef === ref),
        )
        if (idx >= 0) db.opRefs[idx] = { ...db.opRefs[idx], ...out.opPayload }
        else db.opRefs.push(out.opPayload)
      }
    }
    mirrorSyncRows(db, out.syncRows)
    notePersistedMemoryRows(db, out.docs, out.deletes)
    // Drop pending that were committed (already spliced in mutate path)
    metrics.syncRowsCommitted += out.syncRows.filter((r) => !r.duplicate).length
    metrics.businessTxCommitted += 1
  } catch (e) {
    metrics.memoryProjectionFailures += 1
    // Durable state OK — memory projection failed; restart will reload from PG
    throw e
  }

  return out
  }

  let chain = executePgBusinessTx
  for (const mk of stockMemLockKeys) {
    const prev = chain
    chain = () => withMemoryLock(mk, prev)
  }
  const runWithDeadlockRetry = async () => {
    const maxAttempts = 4
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await chain()
      } catch (e) {
        const code = String(e?.code || '')
        const msg = String(e?.message || '')
        const deadlock = code === '40P01' || /deadlock|взаимоблокировка/i.test(msg)
        if (!deadlock || attempt >= maxAttempts) throw e
        await new Promise((r) => setTimeout(r, 15 * attempt))
      }
    }
    throw new Error('business tx retry exhausted')
  }
  return runWithDeadlockRetry()
}

/** In-memory atomic simulator (lab / no DATABASE_URL) */
async function runMemoryAtomicTx({ db, clientRef, operationKind, mutate, fail, failAt, deferMemoryApply, advisoryLocks = [], fingerprint = null, authSubject = null, assertReplayActor = null }) {
  const lockKey = `${operationKind}:${clientRef || Math.random()}`
  const extraKeys = (advisoryLocks || []).map((L) => `${L.ns}:${L.key}`)
  const runInner = async () => {
  const undo = snapshotCollections(db)
  try {
    fail('after_begin')
    if (clientRef) {
      const id = opRefDocId(operationKind, clientRef)
      const existing = (db.opRefs || []).find((r) => String(r.id) === id || (r.kind === operationKind && r.clientRef === clientRef))
      if (existing && (existing.status === 'done' || existing.result != null)) {
        if (typeof assertReplayActor === 'function') assertReplayActor(existing)
        const storedFp = existing.fingerprint ? String(existing.fingerprint) : ''
        const incomingFp = fingerprint ? String(fingerprint) : ''
        if (incomingFp && storedFp && storedFp !== incomingFp) {
          const err = new Error('Тот же clientRef уже использован с другими параметрами')
          err.status = 409
          err.code = 'IDEMPOTENCY_KEY_REUSED'
          throw err
        }
        metrics.idempotentReplayHits += 1
        metrics.concurrentDuplicateSuppressed += 1
        metrics.businessTxCommitted += 1
        return { ok: true, replay: true, result: existing.result, syncRows: [], docs: [], deletes: [] }
      }
    }
    fail('before_business_write')
    const beforeSeq = Number(db._seq?.syncChange) || 0
    const prepared = await Promise.resolve(mutate())
    const result = prepared?.result
    let docs = prepared?.docs || collectDocRows(db, prepared?.touched || [])
    const deletes = prepared?.deletes || []
    let syncChanges = prepared?.syncChanges || takePendingSyncChanges(db)
    // JSON recordEntityUpsert writes immediately into syncChangeLog — adopt those rows
    if (!syncChanges.length) {
      syncChanges = (db.syncChangeLog || []).filter((r) => Number(r.changeSeq) > beforeSeq)
    }
    fail('after_business_writes')
    fail('during_opref')
    fail('during_first_journal')
    if (syncChanges.length > 1) fail('during_nth_journal')

    let syncRows = []
    if (syncChanges.length && syncChanges[0]?.changeSeq != null) {
      // Already durable in memory log (JSON path)
      syncRows = syncChanges
    } else {
      const { recordSyncChange } = await import('../../../lib/syncChangeLogCore.mjs')
      if (!Array.isArray(db.syncChangeLog)) db.syncChangeLog = []
      for (const entry of syncChanges) {
        const row = recordSyncChange(db, entry)
        if (row) syncRows.push(row)
      }
    }

    const opId = clientRef ? opRefDocId(operationKind, clientRef) : ''
    const opPayload = opId
      ? {
          id: opId,
          kind: operationKind,
          clientRef,
          status: 'done',
          result,
          fingerprint: fingerprint ? String(fingerprint) : null,
          authSubject: authSubject || null,
          createdAtIso: new Date().toISOString(),
          updatedAtIso: new Date().toISOString(),
        }
      : null
    if (opPayload) {
      if (!Array.isArray(db.opRefs)) db.opRefs = []
      const idx = db.opRefs.findIndex((r) => String(r.id) === opId)
      if (idx >= 0) db.opRefs[idx] = opPayload
      else db.opRefs.push(opPayload)
    }

    fail('before_commit')
    if (deferMemoryApply) {
      restoreCollections(db, undo)
      applyDocsToMemory(db, docs, deletes)
      if (opPayload) {
        if (!Array.isArray(db.opRefs)) db.opRefs = []
        db.opRefs.push(opPayload)
      }
      for (const row of syncRows) {
        if (!db.syncChangeLog.some((r) => r.changeSeq === row.changeSeq)) {
          db.syncChangeLog.push(row)
        }
      }
    }

    metrics.businessTxCommitted += 1
    metrics.syncRowsCommitted += syncRows.length
    return { ok: true, replay: false, result, syncRows, docs, deletes, opPayload }
  } catch (e) {
    metrics.businessTxRolledBack += 1
    restoreCollections(db, undo)
    throw e
  }
  }
  // Nest clientRef lock + extra loyalty_card locks (order: primary then extras)
  let chain = () => withMemoryLock(lockKey, runInner)
  for (const ek of extraKeys) {
    const prev = chain
    chain = () => withMemoryLock(ek, prev)
  }
  return chain()
}

/**
 * Apply committed docs into memory after a simulated "crash before projection".
 * Used by restart tests: load from PG via loadSnapshotFromPg.
 */
export async function loadDocsIntoMemory(db, collections = TX_COLLECTIONS) {
  if (!isPostgresEnabled()) return db
  return withClient(async (client) => {
    for (const col of collections) {
      const res = await client.query(
        'SELECT id, data FROM docs WHERE collection = $1 ORDER BY sort_idx ASC, id ASC',
        [col],
      )
      db[col] = res.rows.map((r) => r.data)
    }
    return db
  })
}

/**
 * Helper for routes that collect touched entities after in-callback mutation.
 */
export function touchedFromSale(db, sale) {
  const touched = []
  if (!sale) return touched
  touched.push({ collection: 'posSales', row: sale })
  if (sale.shiftId) touched.push({ collection: 'posShifts', ids: [String(sale.shiftId)] })
  const pids = new Set((sale.items || []).map((it) => String(it.productId)).filter(Boolean))
  if (pids.size) touched.push({ collection: 'products', ids: [...pids] })
  if (sale.clientId) touched.push({ collection: 'clients', ids: [String(sale.clientId)] })
  else if (sale.clientPhone) {
    const c = (db.clients || []).find(
      (x) => String(x.phone || '').replace(/\D/g, '').slice(-9) === String(sale.clientPhone).replace(/\D/g, '').slice(-9),
    )
    if (c) touched.push({ collection: 'clients', row: c })
  }
  if (sale.cardNum) {
    const card = (db.cards || []).find((x) => String(x.num || '').toUpperCase() === String(sale.cardNum).toUpperCase())
    if (card) touched.push({ collection: 'cards', row: card })
  }
  if (sale.orderId) {
    const ord = (db.orders || []).find((o) => String(o.id) === String(sale.orderId))
    if (ord) touched.push({ collection: 'orders', row: ord })
  }
  // stock layers live inside stockReceipts — persist whole receipts that contain those products
  if (pids.size && Array.isArray(db.stockReceipts)) {
    for (const rec of db.stockReceipts) {
      if ((rec.items || []).some((it) => pids.has(String(it.productId)))) {
        touched.push({ collection: 'stockReceipts', row: rec })
      }
    }
  }
  return touched
}

/** L11B: collect CRM/debt/loyalty docs for transactional commit. */
export function touchedFromCrm(db, opts = {}) {
  const touched = []
  const pushRow = (collection, row) => {
    if (!row) return
    touched.push({ collection, row })
  }
  const pushId = (collection, id) => {
    if (id == null || id === '') return
    touched.push({ collection, ids: [String(id)] })
  }
  if (opts.client) pushRow('clients', opts.client)
  if (opts.clientId) pushId('clients', opts.clientId)
  if (opts.card) pushRow('cards', opts.card)
  if (opts.cardNum) {
    const card = (db.cards || []).find(
      (x) => String(x.num || '').toUpperCase() === String(opts.cardNum).toUpperCase(),
    )
    if (card) pushRow('cards', card)
  }
  if (opts.shift) pushRow('posShifts', opts.shift)
  if (opts.shiftId) pushId('posShifts', opts.shiftId)
  if (opts.financeMove) pushRow('financeMoves', opts.financeMove)
  if (opts.financeMoveId) pushId('financeMoves', opts.financeMoveId)
  for (const led of opts.ledgerRows || []) pushRow('moneyLedger', led)
  if (opts.includeRecentLedger && Array.isArray(db.moneyLedger)) {
    // last few ledger rows often belong to this op — prefer explicit clientRef filter
    const ref = String(opts.clientRef || '').trim()
    if (ref) {
      for (const led of db.moneyLedger) {
        if (String(led.clientRef || '') === ref || String(led.meta?.clientRef || '') === ref) {
          pushRow('moneyLedger', led)
        }
      }
    }
  }
  return touched
}

/**
 * Stable L11B operationKind names (compat with existing opRef kinds where noted).
 * debt_repay / cash_advance / card_topup / card_loyalty_patch / client_upsert kept as-is.
 */
export const CRM_OP_KINDS = Object.freeze({
  CLIENT_UPSERT: 'client_upsert',
  CLIENT_DELETE: 'client_delete',
  CLIENT_RECOVERY: 'client_recovery',
  CLIENT_RESTORE: 'client_restore',
  CLIENT_PURGE_DEMO: 'client_purge_demo',
  CARD_ENSURE: 'card_ensure',
  CARD_LOYALTY_PATCH: 'card_loyalty_patch',
  CARD_TOPUP: 'card_topup',
  CASH_ADVANCE: 'cash_advance',
  DEBT_REPAY: 'debt_repay',
  CARD_GENERATE: 'card_generate',
  LOYALTY_SYNC: 'loyalty_sync',
  LOYALTY_SETTINGS: 'loyalty_settings',
  CRM_EXPIRE_RECOVERY: 'crm_expire_recovery',
  CRM_LOYALTY_MAINTENANCE: 'crm_loyalty_maintenance',
  CLIENT_DEBT_ADJUSTMENT: 'client_debt_adjustment',
  CARD_BONUS_ADJUSTMENT: 'card_bonus_adjustment',
  CRM_CLIENT_CARD_LINK: 'crm_client_card_link',
  CRM_CARD_UNLINK: 'crm_card_unlink',
})

/**
 * L11C warehouse opKinds — reuse existing Desktop/offline namespaces.
 */
export const WH_OP_KINDS = Object.freeze({
  STOCK_RECEIPT_CREATE: 'stock_receipt_create',
  STOCK_RECEIPT_UPDATE: 'stock_receipt_update',
  STOCK_RECEIPT_DELETE: 'stock_receipt_delete',
  STOCK_WRITEOFF_CREATE: 'stock_writeoff_create',
  STOCK_WRITEOFF_UPDATE: 'stock_writeoff_update',
  STOCK_WRITEOFF_DELETE: 'stock_writeoff_delete',
  STOCK_LAYER_CREATE: 'stock_receipt_create', // compat: POST /products/:id/stock-layers
  STOCK_LAYER_UPDATE: 'stock_layer_update',
  STOCK_LAYER_DELETE: 'stock_layer_delete',
  STOCK_LAYER_CONSUME: 'stock_layer_consume',
  STOCK_LAYER_RESTORE: 'stock_layer_restore',
  STOCK_RETURN_RESTORE: 'sale_return',
  STOCK_REVISION_CREATE: 'stock_revision_create',
  STOCK_REVISION_UPDATE: 'stock_revision_update',
  STOCK_REVISION_DELETE: 'stock_revision_delete',
  STOCK_REVISION_CANCEL: 'stock_revision_cancel',
  REVISION_RESULT_COMMIT: 'revision_result_commit',
  STOCK_RECONCILE: 'stock_reconcile',
  STOCK_ADJUSTMENT: 'stock_adjustment',
  WAREHOUSE_EXPIRY_MUTATION: 'warehouse_expiry_mutation',
})

/** POS sale — same opRef namespace as D4/PC-14. */
export const SALE_OP_KIND = 'pos_sale'

/**
 * L11D finance / product / supplier / POS admin opKinds — reuse existing namespaces.
 */
export const FIN_OP_KINDS = Object.freeze({
  FINANCE_MOVE_CREATE: 'finance_move_create',
  FINANCE_MOVE_DELETE: 'finance_move_delete',
  EXPENSE_CREATE: 'expense_create',
  EXPENSE_DELETE: 'expense_delete',
  SUPPLIER_UPSERT: 'supplier_upsert',
  SUPPLIER_DELETE: 'supplier_delete',
  SUPPLIER_PAYMENT_CREATE: 'supplier_payment_create',
  SUPPLIER_PAYMENT_DELETE: 'supplier_payment_delete',
  PRODUCT_UPSERT: 'product_upsert',
  PRODUCT_DELETE: 'product_delete',
  CATEGORY_UPSERT: 'category_upsert',
  CATEGORY_DELETE: 'category_delete',
  CASHIER_UPSERT: 'cashier_upsert',
  POS_POINT_UPSERT: 'pos_point_upsert',
  POS_POINT_DELETE: 'pos_point_delete',
  SHIFT_OPEN: 'shift_open',
  SHIFT_CLOSE: 'shift_close',
  EMPLOYEE_UPSERT: 'employee_upsert',
  EMPLOYEE_DELETE: 'employee_delete',
  PROMO_UPSERT: 'promo_upsert',
  PROMO_DELETE: 'promo_delete',
  ORDER_CREATE: 'order_create',
  ORDER_STATUS_UPDATE: 'order_status_update',
  DEVICE_BIND: 'device_bind',
  VAULT_CONVERT: 'vault_convert',
  SETTINGS_PRICING: 'settings_pricing',
  SETTINGS_ADMIN: 'settings_admin',
})

/** L11D: collect finance/admin docs for transactional commit. */
export function touchedFromFinance(db, opts = {}) {
  const touched = []
  const pushRow = (collection, row) => {
    if (!row) return
    touched.push({ collection, row })
  }
  const pushId = (collection, id) => {
    if (id == null || id === '') return
    touched.push({ collection, ids: [String(id)] })
  }
  if (opts.financeMove) pushRow('financeMoves', opts.financeMove)
  if (opts.financeMoveId) pushId('financeMoves', opts.financeMoveId)
  if (opts.expense) pushRow('expenses', opts.expense)
  if (opts.expenseId) pushId('expenses', opts.expenseId)
  if (opts.supplier) pushRow('suppliers', opts.supplier)
  if (opts.supplierId) pushId('suppliers', opts.supplierId)
  if (opts.payment) pushRow('supplierPayments', opts.payment)
  if (opts.product) pushRow('products', opts.product)
  if (opts.productId) pushId('products', opts.productId)
  for (const p of opts.products || []) {
    if (p && typeof p === 'object') pushRow('products', p)
    else pushId('products', p)
  }
  if (opts.category) pushRow('categories', opts.category)
  if (opts.cashier) pushRow('cashiers', opts.cashier)
  if (opts.posPoint) pushRow('posPoints', opts.posPoint)
  if (opts.shift) pushRow('posShifts', opts.shift)
  if (opts.shiftId) pushId('posShifts', opts.shiftId)
  if (opts.employee) pushRow('employees', opts.employee)
  if (opts.includeRecentLedger && Array.isArray(db.moneyLedger)) {
    const ref = String(opts.clientRef || '').trim()
    if (ref) {
      for (const led of db.moneyLedger) {
        if (String(led.clientRef || '') === ref || String(led.meta?.clientRef || '') === ref) {
          pushRow('moneyLedger', led)
        }
      }
    }
  }
  return touched
}

/** KV meta (cashVault) for finance/shift/vault O8 commits. */
export function metaCashVault(db) {
  return { cashVault: deepClone(db.cashVault) }
}

/** L11C: collect warehouse docs for transactional commit. */
export function touchedFromWarehouse(db, opts = {}) {
  const touched = []
  const pushRow = (collection, row) => {
    if (!row) return
    touched.push({ collection, row })
  }
  const pushId = (collection, id) => {
    if (id == null || id === '') return
    touched.push({ collection, ids: [String(id)] })
  }
  const seenPid = new Set()
  const pushProductId = (pid) => {
    const id = String(pid)
    if (!id || seenPid.has(id)) return
    seenPid.add(id)
    pushId('products', id)
  }

  if (opts.receipt) pushRow('stockReceipts', opts.receipt)
  if (opts.receiptId) pushId('stockReceipts', opts.receiptId)
  for (const r of opts.receipts || []) pushRow('stockReceipts', r)

  if (opts.writeoff) pushRow('writeOffs', opts.writeoff)
  if (opts.writeoffId) pushId('writeOffs', opts.writeoffId)
  if (opts.adjustment) pushRow('stockAdjustments', opts.adjustment)
  if (opts.adjustmentId) pushId('stockAdjustments', opts.adjustmentId)

  if (opts.revision) pushRow('stockRevisions', opts.revision)
  if (opts.revisionId) pushId('stockRevisions', opts.revisionId)
  for (const r of opts.revisions || []) pushRow('stockRevisions', r)

  if (opts.sale) pushRow('posSales', opts.sale)
  if (opts.saleId) pushId('posSales', opts.saleId)

  if (opts.supplier) pushRow('suppliers', opts.supplier)
  if (opts.supplierId) pushId('suppliers', opts.supplierId)
  if (opts.payment) pushRow('supplierPayments', opts.payment)

  if (opts.shift) pushRow('posShifts', opts.shift)
  if (opts.shiftId) pushId('posShifts', opts.shiftId)

  for (const p of opts.products || []) {
    if (p && typeof p === 'object') pushRow('products', p)
    else pushProductId(p)
  }
  for (const pid of opts.productIds || []) pushProductId(pid)

  // Layers live inside stockReceipts — pull receipts that contain affected products
  if (seenPid.size && Array.isArray(db.stockReceipts)) {
    for (const rec of db.stockReceipts) {
      if ((rec.items || []).some((it) => seenPid.has(String(it.productId)))) {
        pushRow('stockReceipts', rec)
      }
    }
  }

  if (opts.includeRecentLedger && Array.isArray(db.moneyLedger)) {
    const ref = String(opts.clientRef || '').trim()
    if (ref) {
      for (const led of db.moneyLedger) {
        if (String(led.clientRef || '') === ref || String(led.meta?.clientRef || '') === ref) {
          pushRow('moneyLedger', led)
        }
      }
    }
  }
  return touched
}

export function touchedEntities(db, list) {
  return collectDocRows(db, list)
}

/**
 * L11B: commit state that was already mutated in memory (large route bodies).
 * On PG failure: ROLLBACK + reload touched collections from PG (reverts memory).
 * HTTP 200 must only follow successful return.
 */
export async function commitMutatedStateTx(db, opts = {}) {
  const {
    clientRef = '',
    operationKind,
    result,
    touched = [],
    deletes = [],
    failAt = null,
  } = opts
  if (!operationKind) throw new Error('commitMutatedStateTx: operationKind required')

  const fail = (point) => {
    if (failAt && failAt === point) throw new BusinessTxFail(point)
  }

  const ref = String(clientRef || '').trim()
  const docs = collectDocRows(db, touched)
  const syncChanges = takePendingSyncChanges(db)

  if (!isPostgresEnabled()) {
    // Lab JSON: durability = snapshot flush (caller may persist)
    const { recordSyncChange } = await import('../../../lib/syncChangeLogCore.mjs')
    for (const entry of syncChanges) recordSyncChange(db, entry)
    if (ref) {
      const opId = opRefDocId(operationKind, ref)
      if (!Array.isArray(db.opRefs)) db.opRefs = []
      const opPayload = {
        id: opId,
        kind: operationKind,
        clientRef: ref,
        status: 'done',
        result,
        createdAtIso: new Date().toISOString(),
        updatedAtIso: new Date().toISOString(),
      }
      const idx = db.opRefs.findIndex((r) => String(r.id) === opId)
      if (idx >= 0) db.opRefs[idx] = opPayload
      else db.opRefs.push(opPayload)
    }
    metrics.businessTxCommitted += 1
    return { ok: true, replay: false, result, syncRows: syncChanges, docs }
  }

  metrics.businessTxStarted += 1
  const collections = [...new Set(docs.map((d) => d.collection).concat(deletes.map((d) => d.collection)))]

  try {
    const out = await withTransaction(async (client) => {
      fail('after_begin')
      if (ref) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [
          String(operationKind),
          ref,
        ])
        const existing = await client.query(
          `SELECT data FROM docs WHERE collection='opRefs' AND id=$1 LIMIT 1`,
          [opRefDocId(operationKind, ref)],
        )
        const data = existing.rows[0]?.data
        if (data && (data.status === 'done' || data.result != null)) {
          metrics.idempotentReplayHits += 1
          return { ok: true, replay: true, result: data.result, syncRows: [], docs: [] }
        }
      }
      fail('before_business_write')
      for (const doc of docs) {
        await upsertDocWithClient(client, doc.collection, doc.id, doc.data)
      }
      for (const d of deletes) {
        await client.query('DELETE FROM docs WHERE collection=$1 AND id=$2', [
          String(d.collection),
          String(d.id),
        ])
      }
      fail('after_business_writes')
      fail('during_opref')
      const opId = ref ? opRefDocId(operationKind, ref) : ''
      const opPayload = opId
        ? {
            id: opId,
            kind: operationKind,
            clientRef: ref,
            status: 'done',
            result,
            createdAtIso: new Date().toISOString(),
            updatedAtIso: new Date().toISOString(),
            _txCommittedAt: new Date().toISOString(),
          }
        : null
      if (opPayload) await upsertDocWithClient(client, 'opRefs', opId, opPayload)

      fail('during_first_journal')
      const syncRows = []
      const journalEntries = dedupeSyncChangesForInsert(syncChanges)
      for (let i = 0; i < journalEntries.length; i++) {
        if (i === 0) fail('during_first_journal')
        if (i > 0) fail('during_nth_journal')
        const row = await insertSyncChangeOnClient(client, journalEntries[i], fail)
        if (row) syncRows.push(row)
      }
      fail('before_commit')
      return { ok: true, replay: false, result, syncRows, docs, opPayload, deletes }
    })
    if (out.replay) {
      // Reload authoritative state from PG for this clientRef winner
      try { await loadDocsIntoMemory(db, collections.length ? collections : TX_COLLECTIONS) } catch { /* ignore */ }
      metrics.businessTxCommitted += 1
      return out
    }
    mirrorSyncRows(db, out.syncRows)
    if (out.opPayload) {
      if (!Array.isArray(db.opRefs)) db.opRefs = []
      const idx = db.opRefs.findIndex((r) => String(r.id) === String(out.opPayload.id))
      if (idx >= 0) db.opRefs[idx] = out.opPayload
      else db.opRefs.push(out.opPayload)
    }
    metrics.syncRowsCommitted += (out.syncRows || []).filter((r) => !r.duplicate).length
    metrics.businessTxCommitted += 1
    return out
  } catch (e) {
    metrics.businessTxRolledBack += 1
    // Re-queue pending for retry
    db._pendingSyncChanges = syncChanges.concat(db._pendingSyncChanges || [])
    try {
      await loadDocsIntoMemory(db, collections.length ? collections : ['clients', 'cards', 'opRefs', 'financeMoves', 'posShifts', 'moneyLedger'])
    } catch { /* best effort */ }
    throw e
  }
}
