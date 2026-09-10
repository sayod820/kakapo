'use strict'

/**
 * Persist in-memory DB snapshot to PostgreSQL (docs + kv_meta).
 * UPSERT — не DELETE всей базы на каждый persist (очередь кассы 3+ дня).
 *
 * FIX C: append/event collections are never pruned by snapshot absence.
 * Explicit deletes go through deleteDoc / pendingDeletes.
 */

import { withTransaction } from './client.js'
import {
  classifyUniqueViolation,
  fetchDocByIdempotencyKey,
  isKnownIdempotencyUniqueViolation,
} from './uniqueIdempotency.js'

const INSERT_BATCH = 200

const UPSERT_SQL = `INSERT INTO docs (collection, id, data, sort_idx, updated_at)
 VALUES ($1, $2, $3::jsonb, $4, NOW())
 ON CONFLICT (collection, id) DO UPDATE SET
   data = EXCLUDED.data,
   updated_at = NOW()`

async function upsertOneDocRow(client, r) {
  await client.query(UPSERT_SQL, [
    r.key,
    r.id,
    JSON.stringify(r.data ?? null),
    r.sortIdx,
  ])
}

/**
 * Append / event collections: UPSERT only.
 * Missing from local snapshot MUST NOT delete PG rows (multi-writer safety).
 */
export const APPEND_NO_PRUNE_COLLECTIONS = Object.freeze([
  'posSales',
  'moneyLedger',
  'financeMoves',
  'opRefs',
  'orders',
])

const NO_PRUNE = new Set(APPEND_NO_PRUNE_COLLECTIONS)

export function isAppendNoPruneCollection(name) {
  return NO_PRUNE.has(String(name || ''))
}

export function rowIdForItem(item, index) {
  if (item == null || typeof item !== 'object') return `__i${index}`
  if (item.id != null && String(item.id) !== '') return String(item.id)
  if (item.clientRef != null && String(item.clientRef) !== '') return `ref:${item.clientRef}`
  if (item.num != null && String(item.num) !== '') return `num:${item.num}`
  if (item.kind != null && item.clientRef != null) return `op:${item.kind}:${item.clientRef}`
  return `__i${index}`
}

export async function isPgEmpty(client) {
  const docs = await client.query('SELECT COUNT(*)::int AS n FROM docs')
  const meta = await client.query('SELECT COUNT(*)::int AS n FROM kv_meta')
  return (docs.rows[0]?.n || 0) === 0 && (meta.rows[0]?.n || 0) === 0
}

/**
 * @param {import('pg').PoolClient} client
 * @returns {Promise<Record<string, any>>}
 */
export async function loadSnapshotFromPg(client) {
  const out = {}

  const metaRes = await client.query('SELECT key, value FROM kv_meta')
  for (const row of metaRes.rows) {
    out[row.key] = row.value
  }

  const docsRes = await client.query(
    'SELECT collection, id, data, sort_idx FROM docs ORDER BY collection, sort_idx, id',
  )
  const byCol = new Map()
  for (const row of docsRes.rows) {
    if (!byCol.has(row.collection)) byCol.set(row.collection, [])
    byCol.get(row.collection).push(row.data)
  }
  for (const [name, items] of byCol) {
    out[name] = items
  }

  return out
}

async function upsertMeta(client, metaEntries) {
  if (!metaEntries.length) {
    await client.query('DELETE FROM kv_meta')
    return
  }
  for (let offset = 0; offset < metaEntries.length; offset += INSERT_BATCH) {
    const chunk = metaEntries.slice(offset, INSERT_BATCH + offset)
    const values = []
    const params = []
    let p = 1
    for (const m of chunk) {
      values.push(`($${p++}, $${p++}::jsonb, NOW())`)
      params.push(m.key, JSON.stringify(m.value === undefined ? null : m.value))
    }
    await client.query(
      `INSERT INTO kv_meta (key, value, updated_at) VALUES ${values.join(',')}
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      params,
    )
  }
  const keys = metaEntries.map(m => m.key)
  await client.query('DELETE FROM kv_meta WHERE NOT (key = ANY($1::text[]))', [keys])
}

/**
 * Upsert doc rows. For no-prune collections, ON CONFLICT (collection,id)
 * preserves sort_idx (update does not touch sort_idx).
 *
 * FIX D: on SQLSTATE 23505 for known idempotency indexes, skip loser row,
 * fetch existing by business key, and return conflicts for memory reconcile.
 *
 * @returns {Promise<Array<object>>} idempotency conflicts (may be empty)
 */
async function upsertDocRows(client, docRows) {
  /** @type {Array<object>} */
  const conflicts = []

  async function upsertChunk(chunk) {
    const values = []
    const params = []
    let p = 1
    for (const r of chunk) {
      values.push(`($${p++}, $${p++}, $${p++}::jsonb, $${p++}, NOW())`)
      params.push(r.key, r.id, JSON.stringify(r.data ?? null), r.sortIdx)
    }
    await client.query(
      `INSERT INTO docs (collection, id, data, sort_idx, updated_at)
       VALUES ${values.join(',')}
       ON CONFLICT (collection, id) DO UPDATE SET
         data = EXCLUDED.data,
         updated_at = NOW()`,
      params,
    )
  }

  async function resolveRowConflict(r, err) {
    const classified = classifyUniqueViolation(err)
    if (!classified?.known) throw err
    const existing = await fetchDocByIdempotencyKey(client, classified.constraint, r.data)
    if (!existing) throw err
    conflicts.push({
      constraint: classified.constraint,
      collection: classified.collection,
      attemptedId: r.id,
      attemptedData: r.data,
      existingId: existing.id,
      existingData: existing.data,
      _idempotentReplay: true,
    })
  }

  async function upsertRowsOneByOne(rows) {
    for (const r of rows) {
      await client.query('SAVEPOINT fixd_upsert_row')
      try {
        await upsertOneDocRow(client, r)
        await client.query('RELEASE SAVEPOINT fixd_upsert_row')
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT fixd_upsert_row')
        if (!isKnownIdempotencyUniqueViolation(e)) throw e
        await resolveRowConflict(r, e)
      }
    }
  }

  for (let offset = 0; offset < docRows.length; offset += INSERT_BATCH) {
    const chunk = docRows.slice(offset, INSERT_BATCH + offset)
    await client.query('SAVEPOINT fixd_upsert_batch')
    try {
      await upsertChunk(chunk)
      await client.query('RELEASE SAVEPOINT fixd_upsert_batch')
    } catch (e) {
      await client.query('ROLLBACK TO SAVEPOINT fixd_upsert_batch')
      if (!isKnownIdempotencyUniqueViolation(e)) throw e
      // Batch hit expression UNIQUE — fall back to per-row with savepoints
      await upsertRowsOneByOne(chunk)
    }
  }

  return conflicts
}

async function applyExplicitDeletes(client, deletes) {
  if (!Array.isArray(deletes) || !deletes.length) return
  for (const d of deletes) {
    const collection = String(d.collection || '').trim()
    const id = String(d.id ?? '').trim()
    if (!collection || !id) continue
    await client.query(
      'DELETE FROM docs WHERE collection = $1 AND id = $2',
      [collection, id],
    )
  }
}

/**
 * @param {import('pg').PoolClient} client
 * @param {Array<{key:string,id:string,data:any,sortIdx:number}>} docRows
 * @param {string[]} collections
 * @param {{ noPruneCollections?: Iterable<string> }} [opts]
 */
async function upsertDocs(client, docRows, collections, opts = {}) {
  const noPrune = new Set([
    ...NO_PRUNE,
    ...(opts.noPruneCollections ? [...opts.noPruneCollections] : []),
  ])

  const conflicts = await upsertDocRows(client, docRows)

  // Do not prune using loser attempted ids that lost an idempotency race
  const skipIds = new Set(
    conflicts.map(c => `${c.collection}\0${c.attemptedId}`),
  )

  const byCol = new Map()
  for (const r of docRows) {
    if (skipIds.has(`${r.key}\0${r.id}`)) continue
    if (!byCol.has(r.key)) byCol.set(r.key, [])
    byCol.get(r.key).push(r.id)
  }

  for (const col of collections) {
    if (noPrune.has(col)) {
      // FIX C: empty or partial local array must NOT wipe / prune this collection
      continue
    }
    const ids = byCol.get(col) || []
    if (!ids.length) {
      await client.query('DELETE FROM docs WHERE collection = $1', [col])
      continue
    }
    await client.query(
      'DELETE FROM docs WHERE collection = $1 AND NOT (id = ANY($2::text[]))',
      [col, ids],
    )
  }

  // Drop unknown collections, but never drop protected append collections
  // even if this snapshot omitted the key entirely.
  const protectedList = [...noPrune]
  if (collections.length) {
    await client.query(
      `DELETE FROM docs
       WHERE NOT (collection = ANY($1::text[]))
         AND NOT (collection = ANY($2::text[]))`,
      [collections, protectedList],
    )
  } else if (!protectedList.length) {
    await client.query('DELETE FROM docs')
  } else {
    await client.query(
      'DELETE FROM docs WHERE NOT (collection = ANY($1::text[]))',
      [protectedList],
    )
  }

  return conflicts
}

/**
 * @param {import('pg').PoolClient} client
 * @param {Record<string, any>} snapshot
 * @param {{
 *   noPruneCollections?: Iterable<string>,
 *   deletes?: Array<{ collection: string, id: string }>,
 * }} [opts]
 */
/**
 * @returns {Promise<{ conflicts: Array<object> }>}
 */
export async function saveSnapshotToPg(client, snapshot, opts = {}) {
  const metaEntries = []
  const docRows = []
  const collections = []

  for (const [key, value] of Object.entries(snapshot || {})) {
    if (Array.isArray(value)) {
      collections.push(key)
      const used = new Set()
      for (let i = 0; i < value.length; i++) {
        let id = rowIdForItem(value[i], i)
        if (used.has(id)) id = `${id}#${i}`
        used.add(id)
        docRows.push({ key, id, data: value[i], sortIdx: i })
      }
    } else {
      metaEntries.push({ key, value })
    }
  }

  await upsertMeta(client, metaEntries)
  const conflicts = await upsertDocs(client, docRows, collections, opts)
  await applyExplicitDeletes(client, opts.deletes || [])
  return { conflicts: conflicts || [] }
}

/** Explicit single-row delete (append collections must use this, not snapshot absence). */
export async function deleteDoc(collection, id) {
  const col = String(collection || '').trim()
  const docId = String(id ?? '').trim()
  if (!col || !docId) return { ok: false, reason: 'missing_args' }
  await withTransaction(async client => {
    await client.query(
      'DELETE FROM docs WHERE collection = $1 AND id = $2',
      [col, docId],
    )
  })
  return { ok: true, collection: col, id: docId }
}

/**
 * Convenience: full save in a transaction.
 * @param {Record<string, any>} snapshot
 * @param {{ deletes?: Array<{collection:string,id:string}>, noPruneCollections?: Iterable<string> }} [opts]
 */
/**
 * @returns {Promise<{ conflicts: Array<object> }>}
 */
export async function persistSnapshot(snapshot, opts = {}) {
  return withTransaction(async client => {
    return saveSnapshotToPg(client, snapshot, opts)
  })
}

export {
  classifyUniqueViolation,
  isKnownIdempotencyUniqueViolation,
  fetchDocByIdempotencyKey,
} from './uniqueIdempotency.js'
