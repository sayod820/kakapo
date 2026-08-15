'use strict'

/**
 * Persist in-memory DB snapshot to PostgreSQL (docs + kv_meta).
 * UPSERT — не DELETE всей базы на каждый persist (очередь за 2 дня).
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

async function upsertDocs(client, docRows, collections) {
  for (let offset = 0; offset < docRows.length; offset += INSERT_BATCH) {
    const chunk = docRows.slice(offset, INSERT_BATCH + offset)
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
         sort_idx = EXCLUDED.sort_idx,
         updated_at = NOW()`,
      params,
    )
  }

  const byCol = new Map()
  for (const r of docRows) {
    if (!byCol.has(r.key)) byCol.set(r.key, [])
    byCol.get(r.key).push(r.id)
  }
  for (const col of collections) {
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
  if (collections.length) {
    await client.query(
      'DELETE FROM docs WHERE NOT (collection = ANY($1::text[]))',
      [collections],
    )
  } else {
    await client.query('DELETE FROM docs')
  }
}

/**
 * @param {import('pg').PoolClient} client
 * @param {Record<string, any>} snapshot
 */
export async function saveSnapshotToPg(client, snapshot) {
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
  await upsertDocs(client, docRows, collections)
}

/** Convenience: full save in a transaction */
export async function persistSnapshot(snapshot) {
  await withTransaction(async client => {
    await saveSnapshotToPg(client, snapshot)
  })
}
