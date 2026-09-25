'use strict'

/**
 * Durable API sessions (api_sessions). Memory map in apiAuth stays the read path;
 * this table is written through so a restart does not log everyone out.
 */
import { withClient } from './client.js'

const PRUNE_EVERY_MS = 60 * 60 * 1000

function dataForStorage(row) {
  const { token: _token, ...rest } = row || {}
  return rest
}

export function createPgSessionBackend() {
  let lastPruneAt = 0
  const run = (label, fn) => {
    withClient(fn).catch((e) => console.error(`[sessions] ${label} failed`, e?.message || e))
  }
  return {
    save(hash, row) {
      run('save', (c) => c.query(
        `INSERT INTO api_sessions (token_hash, principal, subject_id, data, expires_at)
         VALUES ($1, $2, $3, $4::jsonb, to_timestamp($5 / 1000.0))
         ON CONFLICT (token_hash) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`,
        [hash, row.principal, row.subjectId, JSON.stringify(dataForStorage(row)), Number(row.expiresAtMs) || Date.now()],
      ))
      if (Date.now() - lastPruneAt > PRUNE_EVERY_MS) {
        lastPruneAt = Date.now()
        run('prune', (c) => c.query('DELETE FROM api_sessions WHERE expires_at <= now()'))
      }
    },
    remove(hash) {
      run('remove', (c) => c.query('DELETE FROM api_sessions WHERE token_hash = $1', [hash]))
    },
    clear() {
      run('clear', (c) => c.query('DELETE FROM api_sessions'))
    },
  }
}

/** @returns {Promise<Array<{ hash: string, data: object }>>} */
export async function loadActiveSessionsFromPg() {
  return withClient(async (c) => {
    const res = await c.query('SELECT token_hash, data FROM api_sessions WHERE expires_at > now()')
    return res.rows.map((r) => ({ hash: String(r.token_hash), data: r.data }))
  })
}
