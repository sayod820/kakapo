/**
 * Stage 3: sync journal upkeep.
 * - tx snapshot keeps only max changeSeq of syncChangeLog (no 25 MB clone); rollback drops newer rows
 * - syncChangeLog is memory-only with PG (not written to docs)
 * - pruneSyncJournalPg keeps the newest row and >= 14 days
 * Run: node scripts/sync-journal-upkeep-test.mjs  (PG part needs DATABASE_URL)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tx = await import(pathToFileURL(path.join(root, 'server/kakapo-api/pg/businessMutationTx.js')).href)
const store = await import(pathToFileURL(path.join(root, 'server/kakapo-api/pg/store.js')).href)

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS ${name}`) }
  else { fail += 1; console.log(`FAIL ${name} ${extra}`) }
}

const db = {
  posSales: [{ id: 'S1', total: 10 }],
  syncChangeLog: [{ changeSeq: 5 }, { changeSeq: 7 }],
  _seq: { syncChange: 7 },
}
const snap = tx.snapshotCollections(db, ['posSales'])
ok('snapshot has no syncChangeLog copy', !('syncChangeLog' in snap))
ok('snapshot remembers max changeSeq', snap._syncChangeLogMaxSeq === 7, String(snap._syncChangeLogMaxSeq))
db.posSales.push({ id: 'S2' })
db.syncChangeLog.push({ changeSeq: 8 }, { changeSeq: 9 })
db._seq.syncChange = 9
tx.restoreCollections(db, snap)
ok('rollback drops journal rows newer than snapshot', db.syncChangeLog.map(r => r.changeSeq).join(',') === '5,7', JSON.stringify(db.syncChangeLog))
ok('rollback restores business rows', db.posSales.length === 1)
ok('rollback restores _seq', db._seq.syncChange === 7)

ok('syncChangeLog is memory-only with PG', store.PG_MEMORY_ONLY_COLLECTIONS.includes('syncChangeLog'))
ok('syncChangeLog stays protected from unknown-collection prune', store.isAppendNoPruneCollection('syncChangeLog'))

const idx = fs.readFileSync(path.join(root, 'server/kakapo-api/index.js'), 'utf8')
ok('daily upkeep wired at startup', idx.includes('setInterval(runJournalUpkeep, 24 * 60 * 60 * 1000)'))

if (process.env.DATABASE_URL) {
  const { withClient } = await import(pathToFileURL(path.join(root, 'server/kakapo-api/pg/client.js')).href)
  const { pruneSyncJournalPg } = await import(pathToFileURL(path.join(root, 'server/kakapo-api/pg/syncChangesJournal.js')).href)
  const tag = `upkeep-test-${Date.now()}`
  await withClient(async (c) => {
    await c.query(
      `INSERT INTO sync_changes (entity_type, entity_id, action, updated_at, created_at, source_client_ref)
       VALUES ('test', $1, 'upsert', now(), now() - interval '90 days', $2),
              ('test', $1, 'upsert', now(), now() - interval '10 days', $3)`,
      [tag, `${tag}-old`, `${tag}-recent`],
    )
    await c.query(
      `INSERT INTO docs (collection, id, data, sort_idx) VALUES ('syncChangeLog', $1, '{}'::jsonb, 0)
       ON CONFLICT DO NOTHING`,
      [tag],
    )
  })
  const r = await pruneSyncJournalPg({ keepDays: 3 })
  ok('keepDays floor is 14', r.keepDays === 14, JSON.stringify(r))
  const left = await withClient(c => c.query('SELECT source_client_ref FROM sync_changes WHERE entity_id = $1', [tag]))
  const refs = left.rows.map(x => x.source_client_ref)
  ok('old row removed, 10-day row kept', !refs.includes(`${tag}-old`) && refs.includes(`${tag}-recent`), JSON.stringify(refs))
  const mirror = await withClient(c => c.query(`SELECT count(*)::int AS n FROM docs WHERE collection = 'syncChangeLog'`))
  ok('legacy docs copy removed', mirror.rows[0].n === 0)
  const head = await withClient(c => c.query('SELECT count(*)::int AS n FROM sync_changes'))
  ok('journal never emptied (head row survives)', head.rows[0].n >= 1)
  await withClient(c => c.query('DELETE FROM sync_changes WHERE entity_id = $1', [tag]))
} else {
  console.log('SKIP PG part (no DATABASE_URL)')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
