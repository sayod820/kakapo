/**
 * pos_snapshot: old receipts in per-day KV keys, restored in original order.
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
const end = src.indexOf('async function drainPosSnapshotWrites')
expect(start > 0 && end > start, 'snippet markers')
const snippet = src.slice(start, end)
  .replace(/export async function/g, 'async function')
  .replace("await import('./posStore')", 'await posStoreStub()')
const js = ts.transpileModule(snippet, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText

const kv = new Map()
const writes = []
const readCachedData = async key => (kv.has(`data_${key}`) ? structuredClone(kv.get(`data_${key}`)) : null)
const cacheData = async (key, value) => {
  writes.push(key)
  if (value == null) kv.delete(`data_${key}`)
  else kv.set(`data_${key}`, structuredClone(value))
}
let storeState = { sales: [], shifts: [] }
const posStoreStub = async () => ({ usePosStore: { getState: () => storeState } })
const noop = () => {}
const mod = new Function(
  'readCachedData', 'cacheData', 'posStoreStub', 'lagMark', 'isPerfEnabled', 'perfNote', 'perfCount',
  `let snapshotWriteCount = 0\n${js}\nreturn { splitSalesForSnapshot, readCachedPosSnapshot, writePosSnapshotFromStore, sameRefs, archiveSig, POS_SNAPSHOT_ARCHIVE_KEY, POS_SNAPSHOT_ARCHIVE_DAY_PREFIX, storedSigs: () => archiveStoredSigs, openShiftsSig, writtenOpenSig: () => writtenOpenShiftsSig, reset: () => { archiveStoredSigs = new Map(); archiveWrittenRefs = new Map(); legacyArchivePresent = false } }`,
)(readCachedData, cacheData, posStoreStub, noop, () => false, noop, noop)

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
const archDays = () => [...kv.keys()].filter(k => k.startsWith(`data_${mod.POS_SNAPSHOT_ARCHIVE_DAY_PREFIX}`)).length

await test('split: old to archive grouped by day, recent + no date stay in main', () => {
  const s = mod.splitSalesForSnapshot(sales)
  expect(s.archive.map(x => x.id).join() === 'a,c,e', `archive ${s.archive.map(x => x.id)}`)
  expect(s.recent.map(x => x.id).join() === 'b,d,f', `recent ${s.recent.map(x => x.id)}`)
  expect(s.archivePos.join() === '0,2,4', 'positions')
  expect(s.days.length === 3 && s.days.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d.day)), 'day keys')
})

await test('split: unsorted store order → archive/positions grouped per day, still aligned', () => {
  const t = Date.now() - 10 * DAY
  const mixed = [
    { id: 'x1', createdAtIso: new Date(t).toISOString() },
    { id: 'y1', createdAtIso: new Date(t - DAY).toISOString() },
    { id: 'x2', createdAtIso: new Date(t + 1000).toISOString() },
  ]
  const s = mod.splitSalesForSnapshot(mixed)
  s.archive.forEach((sale, i) => expect(mixed[s.archivePos[i]] === sale, `pos ${i}`))
  expect(s.days.map(d => d.sales.map(x => x.id).join('+')).join() === 'y1,x1+x2', 'grouped')
})

await test('write → read round trip: all receipts back in original order', async () => {
  kv.clear(); mod.reset(); writes.length = 0
  storeState = { sales, shifts: [{ id: 's1', status: 'open' }] }
  await mod.writePosSnapshotFromStore()
  expect(archDays() === 3, `day keys ${archDays()}`)
  mod.reset()
  const snap = await mod.readCachedPosSnapshot()
  expect(snap.sales.map(x => x.id).join() === 'a,b,c,d,e,f', `order ${snap.sales.map(x => x.id)}`)
  expect(snap.shifts?.[0]?.id === 's1', 'shifts kept')
  expect(!('salesArchived' in snap) && !('salesArchivePos' in snap) && !('salesArchiveDays' in snap), 'markers stripped')
})

await test('new recent sale → no archive day rewritten', async () => {
  kv.clear(); mod.reset()
  storeState = { sales, shifts: [] }
  await mod.writePosSnapshotFromStore()
  writes.length = 0
  storeState = { sales: [{ id: 'n', createdAtIso: iso(0) }, ...sales], shifts: [] }
  await mod.writePosSnapshotFromStore()
  expect(writes.join() === 'pos_snapshot', `writes ${writes}`)
})

await test('after restart (same content, new objects) → no archive day rewritten', async () => {
  kv.clear(); mod.reset()
  storeState = { sales, shifts: [] }
  await mod.writePosSnapshotFromStore()
  mod.reset()
  const snap = await mod.readCachedPosSnapshot()
  writes.length = 0
  storeState = { sales: structuredClone(snap.sales), shifts: [] }
  await mod.writePosSnapshotFromStore()
  expect(writes.join() === 'pos_snapshot', `writes ${writes}`)
})

await test('a new day entering the archive writes only that day', async () => {
  kv.clear(); mod.reset()
  storeState = { sales, shifts: [] }
  await mod.writePosSnapshotFromStore()
  writes.length = 0
  storeState = { sales: [...sales, { id: 'old', createdAtIso: iso(20) }], shifts: [] }
  await mod.writePosSnapshotFromStore()
  const dayWrites = writes.filter(k => k.startsWith(mod.POS_SNAPSHOT_ARCHIVE_DAY_PREFIX))
  expect(dayWrites.length === 1, `day writes ${dayWrites}`)
})

await test('edited old receipt rewrites only its day; removed day key is dropped', async () => {
  kv.clear(); mod.reset()
  storeState = { sales, shifts: [] }
  await mod.writePosSnapshotFromStore()
  writes.length = 0
  const edited = sales.map(x => (x.id === 'c' ? { ...x, status: 'returned', returns: [{ id: 'r' }] } : x))
  storeState = { sales: edited, shifts: [] }
  await mod.writePosSnapshotFromStore()
  expect(writes.filter(k => k.startsWith(mod.POS_SNAPSHOT_ARCHIVE_DAY_PREFIX)).length === 1, `writes ${writes}`)
  storeState = { sales: edited.filter(x => x.id !== 'a'), shifts: [] }
  await mod.writePosSnapshotFromStore()
  expect(archDays() === 2, `days left ${archDays()}`)
})

await test('legacy single-key archive is read, then migrated to day keys and removed', async () => {
  kv.clear(); mod.reset()
  const s = mod.splitSalesForSnapshot(sales)
  kv.set(`data_${mod.POS_SNAPSHOT_ARCHIVE_KEY}`, s.archive)
  kv.set('data_pos_snapshot', { shifts: [], sales: s.recent, salesArchived: true, salesArchivePos: s.archivePos, salesArchiveSig: 'x' })
  const snap = await mod.readCachedPosSnapshot()
  expect(snap.sales.map(x => x.id).join() === 'a,b,c,d,e,f', `legacy order ${snap.sales.map(x => x.id)}`)
  expect(!('salesArchiveSig' in snap), 'legacy sig stripped')
  storeState = { sales: snap.sales, shifts: [] }
  await mod.writePosSnapshotFromStore()
  expect(archDays() === 3, 'migrated to day keys')
  expect(!kv.has(`data_${mod.POS_SNAPSHOT_ARCHIVE_KEY}`), 'legacy key removed')
})

await test('read: legacy snapshot (no archive) unchanged', async () => {
  kv.clear(); mod.reset()
  kv.set('data_pos_snapshot', { sales: sales.slice(0, 2), shifts: [] })
  const snap = await mod.readCachedPosSnapshot()
  expect(snap.sales.length === 2 && snap.sales[0].id === 'a', 'legacy')
})

await test('read: missing day chunk (crash between writes) → nothing duplicated, day rewritten next time', async () => {
  kv.clear(); mod.reset()
  storeState = { sales, shifts: [] }
  await mod.writePosSnapshotFromStore()
  const someDay = [...kv.keys()].find(k => k.startsWith(`data_${mod.POS_SNAPSHOT_ARCHIVE_DAY_PREFIX}`))
  kv.delete(someDay)
  mod.reset()
  const snap = await mod.readCachedPosSnapshot()
  const ids = snap.sales.map(x => x.id)
  expect(new Set(ids).size === ids.length, `no dupes ${ids}`)
  expect(['b', 'd', 'f'].every(id => ids.includes(id)), `recent kept ${ids}`)
  expect(mod.storedSigs().size === 2, 'missing day not trusted')
})

await test('read: wrong chunk length → that day not trusted, others kept', async () => {
  kv.clear(); mod.reset()
  storeState = { sales, shifts: [] }
  await mod.writePosSnapshotFromStore()
  const someDay = [...kv.keys()].find(k => k.startsWith(`data_${mod.POS_SNAPSHOT_ARCHIVE_DAY_PREFIX}`))
  kv.set(someDay, [...kv.get(someDay), { id: 'g', createdAtIso: iso(50) }])
  mod.reset()
  const snap = await mod.readCachedPosSnapshot()
  const ids = snap.sales.map(x => x.id)
  expect(['a', 'b', 'c', 'd', 'e', 'f', 'g'].every(id => ids.includes(id)), `all ids ${ids}`)
  expect(new Set(ids).size === ids.length, `no dupes ${ids}`)
  expect(mod.storedSigs().size === 2, 'bad day not trusted')
})

await test('signature: content-based, order-sensitive', () => {
  const copy = structuredClone(sales)
  expect(mod.archiveSig(copy) === mod.archiveSig(sales), 'equal for same content')
  const edited = copy.map(x => (x.id === 'c' ? { ...x, status: 'returned' } : x))
  expect(mod.archiveSig(edited) !== mod.archiveSig(sales), 'edit changes sig')
  expect(mod.archiveSig([...copy].reverse()) !== mod.archiveSig(sales), 'order changes sig')
})

await test('open shifts signature: close/open changes it, other edits do not; read remembers disk state', async () => {
  const open = [{ id: 's1', status: 'open', salesCount: 1 }, { id: 's0', status: 'closed' }]
  const sig = mod.openShiftsSig(open)
  expect(sig === 's1', `sig ${sig}`)
  expect(mod.openShiftsSig([{ ...open[0], salesCount: 9 }, open[1]]) === sig, 'counters ignored')
  expect(mod.openShiftsSig([{ ...open[0], status: 'closed' }, open[1]]) !== sig, 'close changes sig')
  expect(mod.openShiftsSig(null) === '', 'no shifts')
  kv.clear()
  kv.set('data_pos_snapshot', { sales: [], shifts: open })
  await mod.readCachedPosSnapshot()
  expect(mod.writtenOpenSig() === 's1', 'disk state remembered on read')
})

await test('persist forces write when open shifts differ from disk', () => {
  expect(/openShiftsSig\(usePosStore\.getState\(\)\.shifts\) !== writtenOpenShiftsSig/.test(src), 'force on shift change')
  expect(/writtenOpenShiftsSig = openShiftsSig\(payload\.shifts\)/.test(src), 'updated after write')
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
