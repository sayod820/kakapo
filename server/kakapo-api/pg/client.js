'use strict'

import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

let pool = null

export function getDatabaseUrl() {
  return String(process.env.DATABASE_URL || '').trim()
}

export function isPostgresEnabled() {
  return !!getDatabaseUrl()
}

async function loadPoolClass() {
  const mod = await import('pg')
  return mod.default?.Pool || mod.Pool
}

export async function getPool() {
  if (!isPostgresEnabled()) {
    throw new Error('DATABASE_URL is not set')
  }
  if (!pool) {
    const Pool = await loadPoolClass()
    // Without these a stuck transaction holds its locks forever: every later write to the same
    // product waits until the client gives up (seen as 499s). 0 disables.
    const lockMs = Number(process.env.PG_LOCK_TIMEOUT_MS ?? 20_000)
    const idleTxMs = Number(process.env.PG_IDLE_TX_TIMEOUT_MS ?? 60_000)
    const opts = [
      lockMs > 0 ? `-c lock_timeout=${lockMs}` : '',
      idleTxMs > 0 ? `-c idle_in_transaction_session_timeout=${idleTxMs}` : '',
    ].filter(Boolean).join(' ')
    pool = new Pool({
      connectionString: getDatabaseUrl(),
      max: Number(process.env.PG_POOL_MAX) || 10,
      idleTimeoutMillis: 30_000,
      ...(opts ? { options: opts } : {}),
    })
    pool.on('error', err => {
      console.error('[pg] pool error', err?.message || err)
    })
  }
  return pool
}

export async function withClient(fn) {
  const p = await getPool()
  const client = await p.connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}

export async function withTransaction(fn) {
  return withClient(async client => {
    await client.query('BEGIN')
    try {
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (e) {
      try { await client.query('ROLLBACK') } catch { /* ignore */ }
      throw e
    }
  })
}

export async function ensureSchema() {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
  const p = await getPool()
  await p.query(sql)
}

export async function closePool() {
  if (!pool) return
  const p = pool
  pool = null
  await p.end()
}
