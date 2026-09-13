/**
 * Persistence adapters for Sayod/Holov recovery.
 * - memory: fixture tests
 * - postgres: production apply (DATABASE_URL)
 * - api-readonly: dry-run against live HTTP API (no writes)
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CARD_0001, CARD_0003, SAYOD_ID, HOLOV_ID, cardKey } from './sayod-holov-recovery-core.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const API = process.env.KAKAPO_API || 'https://kakappo.shop/api/kakapo'

export async function loadStateFromApi() {
  const get = async (p) => {
    const r = await fetch(`${API}${p}`, { headers: { Accept: 'application/json' } })
    if (!r.ok) throw new Error(`GET ${p} -> ${r.status}`)
    return r.json()
  }
  const [clients, cards] = await Promise.all([get('/clients'), get('/cards')])
  return {
    clients: Array.isArray(clients) ? clients : [],
    cards: Array.isArray(cards) ? cards : [],
    source: 'api-readonly',
  }
}

export function loadStateFromFixture(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  return {
    clients: raw.clients || [],
    cards: raw.cards || [],
    moneyLedger: raw.moneyLedger ? structuredClone(raw.moneyLedger) : undefined,
    posSales: raw.posSales ? structuredClone(raw.posSales) : undefined,
    financeMoves: raw.financeMoves ? structuredClone(raw.financeMoves) : undefined,
    source: 'fixture',
    path: filePath,
  }
}

function ends(n, suf) {
  return String(n || '').replace(/\D/g, '').endsWith(suf)
}

/**
 * Load four docs from PostgreSQL with FOR UPDATE locks inside an existing client txn.
 */
export async function loadFourLocked(pgClient) {
  async function loadClient(id) {
    const res = await pgClient.query(
      `SELECT id, data, sort_idx FROM docs WHERE collection='clients' AND id=$1 FOR UPDATE`,
      [id],
    )
    if (!res.rows.length) throw new Error(`PG missing clients/${id}`)
    return res.rows[0]
  }
  async function loadCard(num) {
    const candidates = [num, `num:${num}`]
    for (const id of candidates) {
      const res = await pgClient.query(
        `SELECT id, data, sort_idx FROM docs WHERE collection='cards' AND id=$1 FOR UPDATE`,
        [id],
      )
      if (res.rows.length) return res.rows[0]
    }
    const res = await pgClient.query(
      `SELECT id, data, sort_idx FROM docs
       WHERE collection='cards' AND (data->>'num'=$1 OR upper(data->>'num')=upper($1))
       FOR UPDATE`,
      [num],
    )
    if (!res.rows.length) throw new Error(`PG missing cards/${num}`)
    if (res.rows.length > 1) throw new Error(`PG ambiguous cards/${num}`)
    return res.rows[0]
  }

  const u01 = await loadClient(SAYOD_ID)
  const u03 = await loadClient(HOLOV_ID)
  const c1 = await loadCard(CARD_0001)
  const c3 = await loadCard(CARD_0003)
  return { u01, u03, c1, c3 }
}

export async function loadStateFromPostgres() {
  const { withClient } = await import('../server/kakapo-api/pg/client.js')
  return withClient(async (client) => {
    const clientsRes = await client.query(`SELECT data FROM docs WHERE collection='clients'`)
    const cardsRes = await client.query(`SELECT data FROM docs WHERE collection='cards'`)
    return {
      clients: clientsRes.rows.map(r => r.data),
      cards: cardsRes.rows.map(r => r.data),
      source: 'postgres',
    }
  })
}

export async function applyRepairedPostgres(repaired, opts = {}) {
  const { withTransaction } = await import('../server/kakapo-api/pg/client.js')
  const failAt = opts.failAt
  return withTransaction(async (pgClient) => {
    const fail = (point) => {
      if (failAt && failAt === point) throw new Error(`INJECTED_FAIL:${point}`)
    }
    fail('before_write')
    const locked = await loadFourLocked(pgClient)
    fail('after_lock')

    async function upsert(rowMeta, data) {
      await pgClient.query(
        `INSERT INTO docs (collection, id, data, sort_idx, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, NOW())
         ON CONFLICT (collection, id) DO UPDATE SET
           data = EXCLUDED.data,
           sort_idx = EXCLUDED.sort_idx,
           updated_at = NOW()`,
        [rowMeta.collection, rowMeta.id, JSON.stringify(data), rowMeta.sort_idx || 0],
      )
    }

    await upsert({ collection: 'cards', id: locked.c1.id, sort_idx: locked.c1.sort_idx }, repaired.c1)
    fail('after_card_0001')
    await upsert({ collection: 'cards', id: locked.c3.id, sort_idx: locked.c3.sort_idx }, repaired.c3)
    fail('after_card_0003')
    await upsert({ collection: 'clients', id: locked.u01.id, sort_idx: locked.u01.sort_idx }, repaired.u01)
    fail('after_client_u01')
    await upsert({ collection: 'clients', id: locked.u03.id, sort_idx: locked.u03.sort_idx }, repaired.u03)
    fail('before_commit')
    return {
      ok: true,
      ids: {
        card0001: locked.c1.id,
        card0003: locked.c3.id,
        u01: locked.u01.id,
        u03: locked.u03.id,
      },
    }
  })
}

export async function applyRollbackPostgres(snapshot, opts = {}) {
  const { withTransaction } = await import('../server/kakapo-api/pg/client.js')
  const failAt = opts.failAt
  return withTransaction(async (pgClient) => {
    const fail = (point) => {
      if (failAt && failAt === point) throw new Error(`INJECTED_FAIL:${point}`)
    }
    fail('before_write')
    const locked = await loadFourLocked(pgClient)
    async function upsert(rowMeta, data) {
      await pgClient.query(
        `INSERT INTO docs (collection, id, data, sort_idx, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, NOW())
         ON CONFLICT (collection, id) DO UPDATE SET
           data = EXCLUDED.data,
           sort_idx = EXCLUDED.sort_idx,
           updated_at = NOW()`,
        [rowMeta.collection, rowMeta.id, JSON.stringify(data), rowMeta.sort_idx || 0],
      )
    }
    await upsert({ collection: 'cards', id: locked.c1.id, sort_idx: locked.c1.sort_idx }, snapshot.cards[CARD_0001])
    fail('after_card_0001')
    await upsert({ collection: 'cards', id: locked.c3.id, sort_idx: locked.c3.sort_idx }, snapshot.cards[CARD_0003])
    fail('after_card_0003')
    await upsert({ collection: 'clients', id: locked.u01.id, sort_idx: locked.u01.sort_idx }, snapshot.clients[SAYOD_ID])
    fail('after_client_u01')
    await upsert({ collection: 'clients', id: locked.u03.id, sort_idx: locked.u03.sort_idx }, snapshot.clients[HOLOV_ID])
    fail('before_commit')
    return { ok: true }
  })
}

export function defaultSnapshotDir() {
  return path.join(__dirname, '_diag_out', 'sayod-holov-recovery-snapshots')
}

export function writeSnapshotFile(snapshot, dir = defaultSnapshotDir()) {
  fs.mkdirSync(dir, { recursive: true })
  const name = `rollback-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  const full = path.join(dir, name)
  fs.writeFileSync(full, JSON.stringify(snapshot, null, 2), 'utf8')
  return full
}

export { ends, cardKey }
