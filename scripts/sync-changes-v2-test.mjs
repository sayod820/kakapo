/**
 * Step 3: /sync/changes v2 — journal completeness, seq-gap safety, client protocol choice.
 * Run: node scripts/sync-changes-v2-test.mjs
 */
import {
  seedPersistedHash,
  diffSnapshotRows,
  commitPersistedHashes,
  notePersistedMemoryRows,
  insertSnapshotJournalRows,
  entityIdFor,
  __resetPersistedHashes,
} from '../server/kakapo-api/pg/snapshotChangeJournal.js'
import { safeSeqPrefix } from '../server/kakapo-api/pg/syncChangesJournal.js'
import { fetchInboundDelta, V1_BACKSTOP_MS } from '../lib/syncPullV2Core.mjs'

let pass = 0
let fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok', name) } else { fail++; console.log('  FAIL', name) }
}

const row = (key, id, data) => ({ key, id, data, json: JSON.stringify(data) })

console.log('snapshot journal')
{
  __resetPersistedHashes()
  seedPersistedHash('clients', 'C1', { id: 'C1', name: 'A' })
  seedPersistedHash('cards', 'K1', { num: 'K1', bonus: 0 })
  const { candidates } = diffSnapshotRows([
    row('clients', 'C1', { id: 'C1', name: 'A' }),
    row('cards', 'K1', { num: 'K1', bonus: 5 }),
    row('clients', 'C2', { id: 'C2', name: 'new' }),
    row('stockLayers', 'L1', { id: 'L1' }),
  ])
  const keys = [...candidates.values()].map(c => `${c.collection}:${c.id}`).sort()
  ok(JSON.stringify(keys) === JSON.stringify(['cards:K1', 'clients:C2']), 'only changed/new journaled rows are candidates')

  commitPersistedHashes([...candidates.values()], [])
  ok(diffSnapshotRows([row('cards', 'K1', { num: 'K1', bonus: 5 })]).candidates.size === 0, 'committed hash suppresses repeat')

  const db = { clients: [{ id: 'C1', name: 'B' }] }
  notePersistedMemoryRows(db, [{ collection: 'clients', id: 'C1' }], [])
  ok(diffSnapshotRows([row('clients', 'C1', { id: 'C1', name: 'B' })]).candidates.size === 0, 'tx-committed row not re-journaled by flush')
  ok(diffSnapshotRows([row('clients', 'C1', { id: 'C1', name: 'C' })]).candidates.size === 1, 'later legacy edit after tx is journaled')

  ok(entityIdFor('cards', { num: 'K9', id: 'x' }, 'num:K9') === 'K9', 'card entity id = num')
  ok(entityIdFor('posSales', { id: 'S1' }, 'S1') === 'S1', 'sale entity id = id')
  ok(entityIdFor('posShifts', {}, 'num:3') === 'num:3', 'fallback to row id')
}

console.log('journal insert sanitize')
{
  const calls = []
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] } } }
  const n = await insertSnapshotJournalRows(client, [
    { collection: 'posPoints', id: 'P1', data: { id: 'P1', pairCode: 'SECRET', name: 'x' }, action: 'upsert' },
    { collection: 'products', id: '7', data: { id: 7, photo: 'data:image/png;base64,AAA', docVersion: 4 }, action: 'upsert' },
    { collection: 'cards', id: 'num:K1', data: { num: 'K1' }, action: 'upsert' },
    { collection: 'stockLayers', id: 'L', data: {}, action: 'upsert' },
  ])
  ok(n === 3, 'non-journaled collection skipped')
  const p = calls[0].params
  ok(!String(p[5]).includes('SECRET'), 'pairCode stripped')
  ok(!String(p[12]).includes('base64'), 'data: photo stripped')
  ok(p[9] === 4, 'docVersion → revision')
  ok(p[13] === 'K1', 'card journaled by num')
}

console.log('seq gap safety')
{
  const now = Date.parse('2026-09-25T12:00:00Z')
  const old = new Date(now - 60_000).toISOString()
  const fresh = new Date(now - 2_000).toISOString()
  const r1 = safeSeqPrefix([{ changeSeq: 11, createdAt: old }, { changeSeq: 12, createdAt: fresh }], 10, now)
  ok(r1.rows.length === 2 && !r1.truncated, 'contiguous rows pass')
  const r2 = safeSeqPrefix([{ changeSeq: 11, createdAt: old }, { changeSeq: 13, createdAt: fresh }], 10, now)
  ok(r2.rows.length === 1 && r2.truncated, 'fresh gap (in-flight tx) stops page before gap')
  const r3 = safeSeqPrefix([{ changeSeq: 11, createdAt: old }, { changeSeq: 13, createdAt: old }], 10, now)
  ok(r3.rows.length === 2, 'old gap (rolled back) is passed')
  const r4 = safeSeqPrefix([{ changeSeq: 12, createdAt: fresh }], 10, now)
  ok(r4.rows.length === 0 && r4.truncated, 'fresh gap right after cursor → empty page')
  const r5 = safeSeqPrefix([{ changeSeq: 500, createdAt: fresh }], 0, now)
  ok(r5.rows.length === 1, 'cursor 0 (bootstrap) not treated as gap')
}

console.log('client protocol choice')
{
  const mk = (over = {}) => {
    const log = []
    let v2Cur = over.v2Cursor ?? 0
    return {
      log,
      deps: {
        forceFull: false,
        now: 10_000_000,
        lastV1At: 10_000_000 - 1000,
        getV1Cursor: async () => over.v1Cursor ?? '2026-09-25T00:00:00.000Z',
        getV2Cursor: async () => v2Cur,
        fetchV1: async (since) => { log.push(`v1:${since || 'full'}`); return { full: !since, cursor: 'T', changeSeqCursor: 900, products: [], pos: {} } },
        fetchV2: over.fetchV2 || (async (cursor) => { log.push(`v2:${cursor}`); return { ok: true, protocol: 'changeSeq', changes: [], nextCursor: cursor, hasMore: false } }),
        ...over.deps,
      },
    }
  }

  let t = mk({ v2Cursor: 0 })
  let out = await fetchInboundDelta(t.deps)
  ok(out.mode === 'v1' && out.v2Cursor === 900, 'no v2 cursor → v1 delta, adopt changeSeqCursor')

  t = mk({ v2Cursor: 100 })
  out = await fetchInboundDelta(t.deps)
  ok(out.mode === 'v2' && t.log[0] === 'v2:100' && out.v2Cursor === 100, 'v2 cursor → v2 pull')

  t = mk({ v2Cursor: 100, deps: { lastV1At: 10_000_000 - V1_BACKSTOP_MS } })
  out = await fetchInboundDelta(t.deps)
  ok(out.mode === 'v1' && out.v2Cursor === null, 'backstop v1 delta does not move v2 cursor')

  t = mk({ v2Cursor: 100, deps: { lastV1At: 0 } })
  out = await fetchInboundDelta(t.deps)
  ok(out.mode === 'v1', 'first pull of session is v1')

  let pages = 0
  t = mk({
    v2Cursor: 100,
    fetchV2: async (cursor) => {
      pages++
      if (cursor === 100) {
        return { ok: true, protocol: 'changeSeq', nextCursor: 102, hasMore: true, changes: [
          { changeSeq: 101, entityType: 'client', entityId: 'C1', action: 'upsert', data: { id: 'C1', name: 'old' } },
          { changeSeq: 102, entityType: 'card', entityId: 'K1', action: 'upsert', data: { num: 'K1' } },
        ] }
      }
      return { ok: true, protocol: 'changeSeq', nextCursor: 104, hasMore: false, changes: [
        { changeSeq: 103, entityType: 'client', entityId: 'C1', action: 'upsert', data: { id: 'C1', name: 'new' } },
        { changeSeq: 104, entityType: 'sale', entityId: 'S1', action: 'delete' },
      ] }
    },
  })
  out = await fetchInboundDelta(t.deps)
  ok(pages === 2 && out.v2Cursor === 104, 'pages until hasMore=false, cursor = last nextCursor')
  ok(out.delta.clients.length === 1 && out.delta.clients[0].name === 'new', 'same entity across pages → last wins')
  ok(out.delta.cards.length === 1 && out.delta.deletes[0].kind === 'sale', 'cards + deletes in v1 bag shape')
  ok(out.delta.full === false && out.delta.cursor === '', 'v2 delta never full, no v1 cursor')

  t = mk({ v2Cursor: 100, fetchV2: async () => ({ ok: false, code: 'CURSOR_EXPIRED' }) })
  out = await fetchInboundDelta(t.deps)
  ok(out.mode === 'v1-full' && t.log.includes('v1:full') && out.v2Cursor === 900, 'CURSOR_EXPIRED → full v1 pull + new v2 cursor')

  t = mk({ v2Cursor: 100, fetchV2: async () => { throw new Error('502') } })
  out = await fetchInboundDelta(t.deps)
  ok(out.mode === 'v1' && out.v2Cursor === null && t.log[0].startsWith('v1:2026'), 'v2 error → v1 delta, v2 cursor kept')

  t = mk({ v2Cursor: 100, fetchV2: async () => ({ cursor: 'T', full: false, products: [] }) })
  out = await fetchInboundDelta(t.deps)
  ok(out.mode === 'v1', 'old server (v1 payload on v=2) → v1 fallback')

  t = mk({ v2Cursor: 100, deps: { forceFull: true } })
  out = await fetchInboundDelta(t.deps)
  ok(out.mode === 'v1-full' && out.v2Cursor === 900, 'forceFull → v1 full, re-adopt v2 cursor')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
