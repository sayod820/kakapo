'use strict'

/**
 * Persist in-memory DB snapshot to PostgreSQL (docs + kv_meta).
 */

import { withTransaction } from './client.js'

const INSERT_BATCH = 200

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

/**
 * Full replace of all collections / meta from an in-memory snapshot.
 * @param {import('pg').PoolClient} client
 * @param {Record<string, any>} snapshot
 */
export async function saveSnapshotToPg(client, snapshot) {
  await client.query('DELETE FROM docs')
  await client.query('DELETE FROM kv_meta')

  const metaEntries = []
  const docRows = []

  for (const [key, value] of Object.entries(snapshot || {})) {
    if (Array.isArray(value)) {
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

  if (metaEntries.length) {
    const values = []
    const params = []
    let p = 1
    for (const m of metaEntries) {
      values.push(`($${p++}, $${p++}::jsonb)`)
      params.push(m.key, JSON.stringify(m.value === undefined ? null : m.value))
    }
    await client.query(
      `INSERT INTO kv_meta (key, value) VALUES ${values.join(',')}`,
      params,
    )
  }

  for (let offset = 0; offset < docRows.length; offset += INSERT_BATCH) {
    const chunk = docRows.slice(offset, offset + INSERT_BATCH)
    const values = []
    const params = []
    let p = 1
    for (const r of chunk) {
      values.push(`($${p++}, $${p++}, $${p++}::jsonb, $${p++})`)
      params.push(r.key, r.id, JSON.stringify(r.data ?? null), r.sortIdx)
    }
    await client.query(
      `INSERT INTO docs (collection, id, data, sort_idx) VALUES ${values.join(',')}`,
      params,
    )
  }
}

/** Convenience: full save in a transaction */
export async function persistSnapshot(snapshot) {
  await withTransaction(async client => {
    await saveSnapshotToPg(client, snapshot)
  })
}
