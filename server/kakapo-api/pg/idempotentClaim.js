'use strict'

/**
 * FIX E — atomic claim rows in docs via PRIMARY KEY (collection, id).
 * INSERT … ON CONFLICT DO NOTHING → at-most-one winner without new UNIQUE migration.
 *
 * Effect ids are deterministic: op:{kind}:{clientRef}
 */

import { withClient, isPostgresEnabled } from './client.js'

export const POS_EFFECT_KINDS = Object.freeze({
  ORDER: 'pos_sale_order',
  BONUS_SPEND: 'pos_bonus_spend',
  BONUS_EARN: 'pos_bonus_earn',
})

export function posEffectDocId(kind, clientRef) {
  const k = String(kind || '').trim()
  const ref = String(clientRef || '').trim()
  if (!k || !ref) return ''
  return `op:${k}:${ref}`
}

export function buildPosEffectPayload(kind, clientRef, extra = {}) {
  return {
    id: posEffectDocId(kind, clientRef),
    kind,
    clientRef: String(clientRef || '').trim(),
    status: extra.status || 'pending',
    result: extra.result || null,
    createdAtIso: extra.createdAtIso || new Date().toISOString(),
    updatedAtIso: new Date().toISOString(),
    ...extra.more,
  }
}

/**
 * @param {import('pg').PoolClient} client
 * @param {string} collection
 * @param {string} id
 * @param {object} data
 */
export async function claimDocWithClient(client, collection, id, data) {
  const col = String(collection || '').trim()
  const docId = String(id || '').trim()
  if (!col || !docId) return { inserted: false, reason: 'missing_args' }

  const insert = await client.query(
    `INSERT INTO docs (collection, id, data, sort_idx, updated_at)
     VALUES ($1, $2, $3::jsonb, 0, NOW())
     ON CONFLICT (collection, id) DO NOTHING
     RETURNING id, data`,
    [col, docId, JSON.stringify(data ?? null)],
  )
  if (insert.rowCount > 0) {
    return { inserted: true, id: docId, data: insert.rows[0].data }
  }
  const existing = await client.query(
    'SELECT id, data FROM docs WHERE collection = $1 AND id = $2 LIMIT 1',
    [col, docId],
  )
  return {
    inserted: false,
    id: docId,
    data: existing.rows[0]?.data ?? null,
  }
}

export async function upsertDocWithClient(client, collection, id, data) {
  const col = String(collection || '').trim()
  const docId = String(id || '').trim()
  if (!col || !docId) return { ok: false }
  await client.query(
    `INSERT INTO docs (collection, id, data, sort_idx, updated_at)
     VALUES ($1, $2, $3::jsonb, 0, NOW())
     ON CONFLICT (collection, id) DO UPDATE SET
       data = EXCLUDED.data,
       updated_at = NOW()`,
    [col, docId, JSON.stringify(data ?? null)],
  )
  return { ok: true, id: docId, data }
}

export async function readDocWithClient(client, collection, id) {
  const res = await client.query(
    'SELECT id, data FROM docs WHERE collection = $1 AND id = $2 LIMIT 1',
    [String(collection), String(id)],
  )
  return res.rows[0] || null
}

/** In-memory claim map for json engine + deterministic tests (injectable). */
export function createMemoryClaimStore() {
  /** @type {Map<string, any>} */
  const map = new Map()
  const key = (c, id) => `${c}\0${id}`

  return {
    async claim(collection, id, data) {
      const k = key(collection, id)
      if (map.has(k)) return { inserted: false, id, data: structuredClone(map.get(k)) }
      const row = structuredClone(data)
      map.set(k, row)
      return { inserted: true, id, data: structuredClone(row) }
    },
    async upsert(collection, id, data) {
      map.set(key(collection, id), structuredClone(data))
      return { ok: true, id, data }
    },
    async read(collection, id) {
      const row = map.get(key(collection, id))
      return row ? { id, data: structuredClone(row) } : null
    },
    clear() { map.clear() },
    size() { return map.size },
  }
}

let memoryFallback = createMemoryClaimStore()

/** Test helper: replace / share memory claim store across simulated processes. */
export function setMemoryClaimStore(store) {
  memoryFallback = store || createMemoryClaimStore()
  return memoryFallback
}

export function getMemoryClaimStore() {
  return memoryFallback
}

/**
 * Claim a POS effect row (opRefs collection, deterministic id).
 * Postgres: real INSERT. JSON engine: process memory map.
 */
export async function claimPosEffect(kind, clientRef, extra = {}, opts = {}) {
  const ref = String(clientRef || '').trim()
  const id = posEffectDocId(kind, ref)
  if (!id) return { inserted: false, reason: 'missing_key' }
  const payload = buildPosEffectPayload(kind, ref, extra)
  const collection = opts.collection || 'opRefs'

  if (opts.store) {
    return opts.store.claim(collection, id, payload)
  }
  if (!isPostgresEnabled()) {
    return memoryFallback.claim(collection, id, payload)
  }
  return withClient(client => claimDocWithClient(client, collection, id, payload))
}

export async function updatePosEffect(kind, clientRef, patch = {}, opts = {}) {
  const ref = String(clientRef || '').trim()
  const id = posEffectDocId(kind, ref)
  if (!id) return { ok: false, reason: 'missing_key' }
  const collection = opts.collection || 'opRefs'

  const read = opts.store
    ? await opts.store.read(collection, id)
    : !isPostgresEnabled()
      ? await memoryFallback.read(collection, id)
      : await withClient(client => readDocWithClient(client, collection, id))

  const prev = read?.data && typeof read.data === 'object' ? read.data : {}
  const next = {
    ...prev,
    ...buildPosEffectPayload(kind, ref, {
      status: patch.status || prev.status || 'done',
      result: patch.result !== undefined ? patch.result : prev.result,
      createdAtIso: prev.createdAtIso,
    }),
    ...patch,
    updatedAtIso: new Date().toISOString(),
  }

  if (opts.store) return opts.store.upsert(collection, id, next)
  if (!isPostgresEnabled()) return memoryFallback.upsert(collection, id, next)
  return withClient(client => upsertDocWithClient(client, collection, id, next))
}

export async function readPosEffect(kind, clientRef, opts = {}) {
  const id = posEffectDocId(kind, clientRef)
  if (!id) return null
  const collection = opts.collection || 'opRefs'
  if (opts.store) return opts.store.read(collection, id)
  if (!isPostgresEnabled()) return memoryFallback.read(collection, id)
  return withClient(client => readDocWithClient(client, collection, id))
}

/** Keep in-memory opRefs aligned with durable claim (snapshot flush upserts same id). */
export function mirrorEffectIntoOpRefs(db, effectData) {
  if (!db || !effectData?.id) return
  if (!Array.isArray(db.opRefs)) db.opRefs = []
  const id = String(effectData.id)
  const idx = db.opRefs.findIndex(r => String(r.id || '') === id
    || (r.kind === effectData.kind && String(r.clientRef || '') === String(effectData.clientRef || '')))
  if (idx >= 0) db.opRefs[idx] = { ...db.opRefs[idx], ...effectData }
  else db.opRefs.push({ ...effectData })
}
