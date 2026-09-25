'use strict'

/**
 * Journal completeness for /sync/changes v2.
 *
 * Legacy routes mutate memory and rely on the debounced snapshot flush, without
 * recordSyncChange. The flush therefore detects docs whose JSON changed since the
 * last durable write (hash per doc) and journals them in the same PG transaction.
 * Transactional routes note their committed rows so the flush does not re-journal them.
 */
import { createHash } from 'crypto'

export const COLLECTION_ENTITY = Object.freeze({
  posSales: 'sale',
  posShifts: 'shift',
  products: 'product',
  clients: 'client',
  cards: 'card',
  categories: 'category',
  stockReceipts: 'receipt',
  writeOffs: 'writeoff',
  stockRevisions: 'revision',
  financeMoves: 'finance_move',
  expenses: 'expense',
  suppliers: 'supplier',
  posPoints: 'pos_point',
  cashiers: 'cashier',
})

const persisted = new Map()

const keyOf = (collection, id) => `${collection}\0${id}`

export function hashJson(json) {
  return createHash('sha1').update(String(json)).digest('hex')
}

export function isJournaledCollection(collection) {
  return Object.prototype.hasOwnProperty.call(COLLECTION_ENTITY, String(collection || ''))
}

/** Rows as loaded from PG — baseline, no events. */
export function seedPersistedHash(collection, id, data) {
  if (!isJournaledCollection(collection)) return
  persisted.set(keyOf(collection, String(id)), hashJson(JSON.stringify(data ?? null)))
}

/** After a business tx commit: memory rows now equal durable rows. */
export function notePersistedMemoryRows(db, docs = [], deletes = []) {
  for (const d of deletes || []) {
    if (isJournaledCollection(d?.collection)) persisted.delete(keyOf(d.collection, String(d.id)))
  }
  for (const doc of docs || []) {
    const col = String(doc?.collection || '')
    if (!isJournaledCollection(col)) continue
    const id = String(doc.id)
    const list = Array.isArray(db?.[col]) ? db[col] : []
    const row = list.find((x) => x && (String(x.id) === id || String(x.num) === id || `num:${x.num}` === id))
    persisted.set(keyOf(col, id), hashJson(JSON.stringify(row ?? doc.data ?? null)))
  }
}

/**
 * @param {Array<{ key: string, id: string, data: any }>} docRows
 * @returns {{ candidates: Map<string, { collection: string, id: string, data: any, hash: string }> }}
 */
export function diffSnapshotRows(docRows) {
  const candidates = new Map()
  for (const r of docRows || []) {
    if (!isJournaledCollection(r.key)) continue
    const k = keyOf(r.key, r.id)
    const h = hashJson(r.json != null ? r.json : JSON.stringify(r.data ?? null))
    if (persisted.get(k) === h) continue
    candidates.set(k, { collection: r.key, id: String(r.id), data: r.data, hash: h })
  }
  return { candidates }
}

function sanitizeForJournal(collection, data) {
  if (!data || typeof data !== 'object') return data
  if (collection === 'posPoints') {
    const { pairCode: _p, ...rest } = data
    return rest
  }
  if (collection === 'products') {
    // Same rule as stripHeavyPhotoFields (v1 feed): inline data: photos never go to the feed
    const isData = (v) => typeof v === 'string' && v.trim().toLowerCase().startsWith('data:')
    if (!isData(data.photo) && !isData(data.photoThumb)) return data
    const out = { ...data }
    if (isData(out.photo)) out.photo = null
    if (isData(out.photoThumb)) out.photoThumb = null
    return out
  }
  return data
}

/** Entity id as used by recordEntityUpsert / v1 tombstones (cards by num). */
export function entityIdFor(collection, data, rowId) {
  if (data && typeof data === 'object') {
    if (collection === 'cards' && data.num != null && String(data.num) !== '') return String(data.num)
    if (data.id != null && String(data.id) !== '') return String(data.id)
  }
  return String(rowId)
}

function stampOf(data) {
  const s = data && typeof data === 'object'
    ? (data.serverAtIso || data.updatedAtIso || data.updatedAt || data.closedAtIso || data.createdAtIso)
    : null
  const t = Date.parse(String(s || ''))
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString()
}

/**
 * Insert journal rows inside the snapshot transaction.
 * @param {import('pg').PoolClient} client
 * @param {Array<{ collection: string, id: string, data?: any, action: 'upsert'|'delete' }>} events
 */
export async function insertSnapshotJournalRows(client, events) {
  const list = (events || []).filter((e) => isJournaledCollection(e.collection))
  const BATCH = 200
  let inserted = 0
  for (let off = 0; off < list.length; off += BATCH) {
    const chunk = list.slice(off, off + BATCH)
    const values = []
    const params = []
    let p = 1
    for (const e of chunk) {
      const entityType = COLLECTION_ENTITY[e.collection]
      const del = e.action === 'delete'
      const data = del ? null : sanitizeForJournal(e.collection, e.data)
      const revision = !del && data && Number.isFinite(Number(data.docVersion)) ? Number(data.docVersion) : null
      values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}::timestamptz, $${p++}::jsonb, NULL)`)
      params.push(entityType, del ? String(e.id) : entityIdFor(e.collection, e.data, e.id), del ? 'delete' : 'upsert', revision, del ? new Date().toISOString() : stampOf(data), data == null ? null : JSON.stringify(data))
    }
    await client.query(
      `INSERT INTO sync_changes (entity_type, entity_id, action, revision, updated_at, data, source_client_ref)
       VALUES ${values.join(',')}`,
      params,
    )
    inserted += chunk.length
  }
  return inserted
}

/** Apply hash updates only after the snapshot transaction committed. */
export function commitPersistedHashes(upserts = [], deletes = []) {
  for (const u of upserts) persisted.set(keyOf(u.collection, u.id), u.hash)
  for (const d of deletes) persisted.delete(keyOf(d.collection, d.id))
}

/** @internal tests */
export function __resetPersistedHashes() {
  persisted.clear()
}

export function __persistedSize() {
  return persisted.size
}
