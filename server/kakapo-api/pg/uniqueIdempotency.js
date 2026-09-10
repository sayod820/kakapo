'use strict'

/**
 * FIX D — known PostgreSQL UNIQUE indexes for append/idempotency keys.
 * Only these names may trigger idempotent replay on SQLSTATE 23505.
 */

export const IDEMPOTENCY_UNIQUE_INDEXES = Object.freeze({
  uq_docs_possales_client_ref: Object.freeze({
    name: 'uq_docs_possales_client_ref',
    collection: 'posSales',
    /** @param {any} data */
    keyParts(data) {
      const clientRef = String(data?.clientRef || '').trim()
      return clientRef ? { clientRef } : null
    },
  }),
  uq_docs_moneyledger_client_ref_type: Object.freeze({
    name: 'uq_docs_moneyledger_client_ref_type',
    collection: 'moneyLedger',
    /** @param {any} data */
    keyParts(data) {
      const clientRef = String(data?.clientRef || '').trim()
      if (!clientRef) return null
      return { clientRef, type: String(data?.type || '') }
    },
  }),
  uq_docs_financemoves_client_ref: Object.freeze({
    name: 'uq_docs_financemoves_client_ref',
    collection: 'financeMoves',
    /** @param {any} data */
    keyParts(data) {
      const clientRef = String(data?.clientRef || '').trim()
      return clientRef ? { clientRef } : null
    },
  }),
  uq_docs_oprefs_kind_client_ref: Object.freeze({
    name: 'uq_docs_oprefs_kind_client_ref',
    collection: 'opRefs',
    /** @param {any} data */
    keyParts(data) {
      const clientRef = String(data?.clientRef || '').trim()
      if (!clientRef) return null
      return { kind: String(data?.kind || ''), clientRef }
    },
  }),
  /** Optional belt (FIX E): not required if claimPosEffect(order) is used. */
  uq_docs_orders_pos_sale_client_ref: Object.freeze({
    name: 'uq_docs_orders_pos_sale_client_ref',
    collection: 'orders',
    /** @param {any} data */
    keyParts(data) {
      const posSaleClientRef = String(data?.posSaleClientRef || '').trim()
      return posSaleClientRef ? { clientRef: posSaleClientRef, posSaleClientRef } : null
    },
  }),
})

export const IDEMPOTENCY_INDEX_NAMES = Object.freeze(Object.keys(IDEMPOTENCY_UNIQUE_INDEXES))

const NAME_SET = new Set(IDEMPOTENCY_INDEX_NAMES)

/** Extract constraint/index name from node-pg / PostgreSQL error. */
export function uniqueViolationConstraintName(err) {
  if (!err || err.code !== '23505') return ''
  const direct = String(err.constraint || '').trim()
  if (direct) return direct
  const msg = String(err.message || '')
  const m = msg.match(/unique constraint "([^"]+)"/i)
  return m ? m[1] : ''
}

/**
 * @returns {null | { known: false, constraint: string, code: string }
 *   | { known: true, constraint: string, code: string, collection: string, meta: object }}
 */
export function classifyUniqueViolation(err) {
  if (!err || err.code !== '23505') return null
  const constraint = uniqueViolationConstraintName(err)
  if (!constraint) {
    return { known: false, constraint: '', code: '23505' }
  }
  const meta = IDEMPOTENCY_UNIQUE_INDEXES[constraint]
  if (!meta) {
    return { known: false, constraint, code: '23505' }
  }
  return {
    known: true,
    constraint,
    code: '23505',
    collection: meta.collection,
    meta,
  }
}

export function isKnownIdempotencyUniqueViolation(err) {
  const c = classifyUniqueViolation(err)
  return !!(c && c.known)
}

/**
 * Fetch existing docs row by business idempotency key.
 * @param {import('pg').PoolClient} client
 * @param {string} indexName
 * @param {any} data attempted row data
 */
export async function fetchDocByIdempotencyKey(client, indexName, data) {
  const meta = IDEMPOTENCY_UNIQUE_INDEXES[indexName]
  if (!meta) return null
  const parts = meta.keyParts(data)
  if (!parts) return null

  if (indexName === 'uq_docs_possales_client_ref') {
    const res = await client.query(
      `SELECT id, data, sort_idx FROM docs
       WHERE collection = 'posSales'
         AND NULLIF(BTRIM(data->>'clientRef'), '') = $1
       LIMIT 1`,
      [parts.clientRef],
    )
    return res.rows[0] || null
  }
  if (indexName === 'uq_docs_moneyledger_client_ref_type') {
    const res = await client.query(
      `SELECT id, data, sort_idx FROM docs
       WHERE collection = 'moneyLedger'
         AND NULLIF(BTRIM(data->>'clientRef'), '') = $1
         AND COALESCE(data->>'type', '') = $2
       LIMIT 1`,
      [parts.clientRef, parts.type],
    )
    return res.rows[0] || null
  }
  if (indexName === 'uq_docs_financemoves_client_ref') {
    const res = await client.query(
      `SELECT id, data, sort_idx FROM docs
       WHERE collection = 'financeMoves'
         AND NULLIF(BTRIM(data->>'clientRef'), '') = $1
       LIMIT 1`,
      [parts.clientRef],
    )
    return res.rows[0] || null
  }
  if (indexName === 'uq_docs_oprefs_kind_client_ref') {
    const res = await client.query(
      `SELECT id, data, sort_idx FROM docs
       WHERE collection = 'opRefs'
         AND COALESCE(data->>'kind', '') = $1
         AND NULLIF(BTRIM(data->>'clientRef'), '') = $2
       LIMIT 1`,
      [parts.kind, parts.clientRef],
    )
    return res.rows[0] || null
  }
  if (indexName === 'uq_docs_orders_pos_sale_client_ref') {
    const res = await client.query(
      `SELECT id, data, sort_idx FROM docs
       WHERE collection = 'orders'
         AND NULLIF(BTRIM(data->>'posSaleClientRef'), '') = $1
       LIMIT 1`,
      [parts.posSaleClientRef],
    )
    return res.rows[0] || null
  }
  return null
}

/**
 * Apply one resolved conflict into an in-memory snapshot collection.
 * Loser attempted id is dropped; existing PG row wins.
 */
export function applyIdempotencyConflictToSnapshot(snapshot, conflict) {
  if (!snapshot || !conflict?.collection || !conflict.existingData) return snapshot
  const col = conflict.collection
  if (!Array.isArray(snapshot[col])) snapshot[col] = []
  const existing = conflict.existingData
  const existingId = String(conflict.existingId || existing.id || '')
  const attemptedId = String(conflict.attemptedId || '')
  const meta = IDEMPOTENCY_UNIQUE_INDEXES[conflict.constraint]
  const parts = meta ? meta.keyParts(existing) : null

  snapshot[col] = snapshot[col].filter(row => {
    const id = String(row?.id || '')
    if (attemptedId && id === attemptedId && id !== existingId) return false
    if (!parts) return true
    if (col === 'posSales' || col === 'financeMoves') {
      return String(row?.clientRef || '').trim() !== parts.clientRef || id === existingId
    }
    if (col === 'moneyLedger') {
      return !(
        String(row?.clientRef || '').trim() === parts.clientRef
        && String(row?.type || '') === parts.type
        && id !== existingId
      )
    }
    if (col === 'opRefs') {
      return !(
        String(row?.kind || '') === parts.kind
        && String(row?.clientRef || '').trim() === parts.clientRef
        && id !== existingId
      )
    }
    if (col === 'orders') {
      return String(row?.posSaleClientRef || '').trim() !== parts.posSaleClientRef || id === existingId
    }
    return true
  })

  const idx = snapshot[col].findIndex(r => String(r?.id || '') === existingId)
  if (idx >= 0) snapshot[col][idx] = existing
  else snapshot[col].unshift(existing)

  return snapshot
}

export function applyIdempotencyConflictsToSnapshot(snapshot, conflicts) {
  if (!Array.isArray(conflicts) || !conflicts.length) return snapshot
  for (const c of conflicts) applyIdempotencyConflictToSnapshot(snapshot, c)
  return snapshot
}

/** In-memory unique index check (tests / dry simulators). */
export function findInMemoryUniqueConflict(docsRows, collection, id, data) {
  for (const [name, meta] of Object.entries(IDEMPOTENCY_UNIQUE_INDEXES)) {
    if (meta.collection !== collection) continue
    const parts = meta.keyParts(data)
    if (!parts) continue
    for (const row of docsRows) {
      if (row.collection !== collection) continue
      if (row.id === id) continue
      const other = meta.keyParts(row.data)
      if (!other) continue
      const same =
        collection === 'moneyLedger'
          ? other.clientRef === parts.clientRef && other.type === parts.type
          : collection === 'opRefs'
            ? other.kind === parts.kind && other.clientRef === parts.clientRef
            : collection === 'orders'
              ? other.posSaleClientRef === parts.posSaleClientRef
              : other.clientRef === parts.clientRef
      if (same) {
        return {
          code: '23505',
          constraint: name,
          collection,
          existingId: row.id,
          existingData: row.data,
          attemptedId: id,
          attemptedData: data,
        }
      }
    }
  }
  return null
}

export function makePgUniqueViolationError(constraintName) {
  const err = new Error(`duplicate key value violates unique constraint "${constraintName}"`)
  err.code = '23505'
  err.constraint = constraintName
  return err
}

export { NAME_SET as IDEMPOTENCY_INDEX_NAME_SET }
