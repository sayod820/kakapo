/**
 * pos_snapshot: old receipts in a separate KV key, restored in original order.
 * Run: node scripts/pos-snapshot-archive-test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const ts = require('typescript')
let pass = 0
let fail = 0
async function test(name, fn) {
  try {
    await fn()
    pass++
    console.log(`PASS  ${name}`)
  } catch (e) {
    fail++
    console.error(`FAIL  ${name}: ${e?.message || e}`)
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg)
}

const src = fs.readFileSync(path.join(root, 'lib', 'offline.ts'), 'utf8')
const start = src.indexOf('const POS_SNAPSHOT_ARCHIVE_KEY')
const end = src.indexOf('async function writePosSnapshotFromStore')
expect(start > 0 && end > start, 'snippet markers')
const snippet = src.slice(start, end).replace(/export async function/g, 'async function')
const js = ts.transpileModule(snippet, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText

const kv = new Map()
const readCachedData = async key => (kv.has(`data_${key}`) ? structuredClone(kv.get(`data_${key}`)) : null)
const mod = new Function('readCachedData', `${js}\nreturn { splitSalesForSnapshot, readCachedPosSnapshot, sameRefs, POS_SNAPSHOT_ARCHIVE_KEY }`)(readCachedData)

const DAY = 86_400_000
const iso = daysAgo => new Date(Date.now() - daysAgo * DAY).toISOString()
const sales = [
  { id: 'a', createdAtIso: iso(100) },
  { id: 'b', createdAtIso: iso(0.5) },
  { id: 'c', createdAtIso: iso(40) },
  { id: 'd', createdAtIso: iso(0) },
  { id: 'e', createdAtIso: iso(30) },
  { id: 'f' },
]

function store(split, extra = {}) {
  kv.set(`data_${mod.POS_SNAPSHOT_ARCHIVE_KEY}`, split.archive)
  kv.set('data_pos_snapshot', { shifts: [{ id: 's1' }], sales: split.recent, salesArchived: true, salesArchivePos: split.archivePos, ...extra })
}

await test('split: old to archive, recent + no date stay in main', () => {
  const s = mod.splitSalesForSnapshot(sales)
  expect(s.archive.map(x => x.id).join() === 'a,c,e', `archive ${s.archive.map(x => x.id)}`)
  expect(s.recent.map(x => x.id).join() === 'b,d,f', `recent ${s.recent.map(x => x.id)}`)
  expect(s.archivePos.join() === '0,2,4', 'positions')
})

await test('read: restores all receipts in original order + other fields', async () => {
  store(mod.splitSalesForSnapshot(sales))
  const snap = await mod.readCachedPosSnapshot()
  expect(snap.sales.map(x => x.id).join() === 'a,b,c,d,e,f', `order ${snap.sales.map(x => x.id)}`)
  expect(snap.shifts?.[0]?.id === 's1', 'shifts kept')
  expect(!('salesArchived' in snap) && !('salesArchivePos' in snap), 'markers stripped')
})

await test('read: legacy snapshot (no archive) unchanged', async () => {
  kv.clear()
  kv.set('data_pos_snapshot', { sales: sales.slice(0, 2), shifts: [] })
  const snap = await mod.readCachedPosSnapshot()
  expect(snap.sales.length === 2 && snap.sales[0].id === 'a', 'legacy')
})

await test('read: positions out of sync (crash between writes) → nothing lost, no duplicates', async () => {
  kv.clear()
  const s = mod.splitSalesForSnapshot(sales)
  store(s)
  kv.set(`data_${mod.POS_SNAPSHOT_ARCHIVE_KEY}`, [...s.archive, { id: 'g', createdAtIso: iso(50) }, { id: 'b', createdAtIso: iso(2) }])
  const snap = await mod.readCachedPosSnapshot()
  const ids = snap.sales.map(x => x.id)
  expect(['a', 'b', 'c', 'd', 'e', 'f', 'g'].every(id => ids.includes(id)), `all ids ${ids}`)
  expect(new Set(ids).size === ids.length, `no dupes ${ids}`)
})

await test('read: no archive key yet → recent only, no crash', async () => {
  kv.clear()
  const s = mod.splitSalesForSnapshot(sales)
  kv.set('data_pos_snapshot', { sales: s.recent, salesArchived: true, salesArchivePos: s.archivePos })
  const snap = await mod.readCachedPosSnapshot()
  expect(snap.sales.map(x => x.id).join() === 'b,d,f', `recent ${snap.sales.map(x => x.id)}`)
})

await test('archive unchanged refs → no rewrite needed; changed sale → rewrite', () => {
  const s1 = mod.splitSalesForSnapshot(sales)
  const next = [...sales, { id: 'h', createdAtIso: iso(0) }]
  const s2 = mod.splitSalesForSnapshot(next)
  expect(mod.sameRefs(s2.archive, s1.archive), 'new recent sale keeps archive')
  const edited = next.map(x => (x.id === 'c' ? { ...x, returned: true } : x))
  expect(!mod.sameRefs(mod.splitSalesForSnapshot(edited).archive, s1.archive), 'edited old sale → rewrite')
})

await test('cutoff is day-aligned (archive stable within a day)', () => {
  expect(/Math\.floor\(Date\.now\(\) \/ 86_400_000\)/.test(snippet), 'day aligned cutoff')
})

await test('readers use readCachedPosSnapshot', () => {
  const hydrate = fs.readFileSync(path.join(root, 'lib', 'offlineHydrate.ts'), 'utf8')
  const posStore = fs.readFileSync(path.join(root, 'lib', 'posStore.ts'), 'utf8')
  expect(hydrate.includes('readCachedPosSnapshot<'), 'hydrate')
  expect(posStore.includes('readCachedPosSnapshot<'), 'posStore')
  expect(!/readCachedData<[^>]*>\('pos_snapshot'\)/.test(hydrate + posStore), 'no raw reads left')
})

console.log(`\n${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
