/**
 * Snapshot flush writes only changed docs (full ~66k-row upsert made admin saves time out → 499).
 * Real Postgres test DB (wiped): DATABASE_URL, default local kakapo_l11_test.
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiRoot = path.join(root, 'server', 'kakapo-api')
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgresql://postgres@127.0.0.1:5432/kakapo_l11_test'
if (!/_test\b|_test$/.test(process.env.DATABASE_URL)) {
  console.error('Refusing to wipe a non-test database:', process.env.DATABASE_URL)
  process.exit(2)
}

const { ensureSchema, withClient, closePool } = await import(pathToFileURL(path.join(apiRoot, 'pg', 'client.js')).href)
const store = await import(pathToFileURL(path.join(apiRoot, 'pg', 'store.js')).href)
const { persistSnapshot, deleteDoc, loadSnapshotFromPg, seedSnapshotJournalBaseline, forgetWrittenDocHashes, __resetWrittenDocHashes } = store

let pass = 0
let fail = 0
async function test(name, fn) {
  try {
    await fn()
    pass++
    console.log(`PASS  ${name}`)
  } catch (e) {
    fail++
    console.log(`FAIL  ${name}: ${e.message}`)
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg || 'expectation failed')
}
async function q(sql, params = []) {
  return withClient(c => c.query(sql, params))
}
async function docData(collection, id) {
  const r = await q('SELECT data FROM docs WHERE collection = $1 AND id = $2', [collection, id])
  return r.rows[0]?.data ?? null
}

await ensureSchema()
await q('DELETE FROM docs')
await q('DELETE FROM kv_meta')
__resetWrittenDocHashes()

const snap = {
  settings: { a: 1 },
  products: [
    { id: 'P1', name: 'Молоко', price: 10 },
    { id: 'P2', name: 'Хлеб', price: 4 },
    { id: 'P3', name: 'Сыр', price: 30 },
  ],
  employees: [{ id: 'E1', name: 'Али' }],
  posSales: [{ id: 'S1', total: 14 }],
}

await test('first flush writes every row', async () => {
  const out = await persistSnapshot(snap)
  expect(out.stats.written === 5, `written ${out.stats.written}`)
  const n = (await q('SELECT count(*)::int n FROM docs')).rows[0].n
  expect(n === 5, `rows ${n}`)
})

await test('unchanged flush writes nothing', async () => {
  const out = await persistSnapshot(snap)
  expect(out.stats.written === 0, `written ${out.stats.written}`)
})

await test('one edited row → only that row written, PG updated', async () => {
  snap.employees[0] = { ...snap.employees[0], name: 'Али Р.' }
  const out = await persistSnapshot(snap)
  expect(out.stats.written === 1, `written ${out.stats.written}`)
  expect((await docData('employees', 'E1'))?.name === 'Али Р.', 'PG not updated')
})

await test('new row inserted, others skipped', async () => {
  snap.products.push({ id: 'P4', name: 'Чай', price: 12 })
  const out = await persistSnapshot(snap)
  expect(out.stats.written === 1, `written ${out.stats.written}`)
  expect((await docData('products', 'P4'))?.name === 'Чай', 'P4 missing')
})

await test('removed row pruned; re-added identical row is written again', async () => {
  const p2 = snap.products.find(p => p.id === 'P2')
  snap.products = snap.products.filter(p => p.id !== 'P2')
  await persistSnapshot(snap)
  expect((await docData('products', 'P2')) === null, 'P2 not pruned')
  snap.products.push(p2)
  const out = await persistSnapshot(snap)
  expect(out.stats.written === 1, `written ${out.stats.written}`)
  expect((await docData('products', 'P2'))?.name === 'Хлеб', 'P2 not restored')
})

await test('explicit delete via deleteDoc → memory copy re-written next flush', async () => {
  await deleteDoc('products', 'P3')
  const out = await persistSnapshot(snap)
  expect(out.stats.written === 1, `written ${out.stats.written}`)
  expect((await docData('products', 'P3'))?.name === 'Сыр', 'P3 not re-written')
})

await test('business-tx delete forgotten → behaves as before (re-written)', async () => {
  await q(`DELETE FROM docs WHERE collection='products' AND id='P1'`)
  forgetWrittenDocHashes([{ collection: 'products', id: 'P1' }])
  const out = await persistSnapshot(snap)
  expect(out.stats.written === 1, `written ${out.stats.written}`)
  expect((await docData('products', 'P1'))?.name === 'Молоко', 'P1 missing')
})

await test('newer tx row in PG is never overwritten; stale memory retried, not marked written', async () => {
  await q(`UPDATE docs SET data = '{"id":"S1","total":99}'::jsonb, updated_at = NOW() + interval '1 day' WHERE collection='posSales' AND id='S1'`)
  snap.posSales[0] = { id: 'S1', total: 15 }
  const a = await persistSnapshot(snap)
  expect(a.stats.written === 1, `attempt ${a.stats.written}`)
  expect((await docData('posSales', 'S1'))?.total === 99, 'newer PG row overwritten')
  const b = await persistSnapshot(snap)
  expect(b.stats.written === 1, `retry ${b.stats.written}`)
})

await test('after reload + baseline seed, unchanged flush writes nothing', async () => {
  await q(`UPDATE docs SET updated_at = NOW() WHERE collection='posSales'`)
  const loaded = await withClient(c => loadSnapshotFromPg(c))
  seedSnapshotJournalBaseline(loaded)
  const out = await persistSnapshot(loaded)
  expect(out.stats.written === 0, `written ${out.stats.written}`)
  loaded.products[0] = { ...loaded.products[0], price: 11 }
  const out2 = await persistSnapshot(loaded)
  expect(out2.stats.written === 1, `written ${out2.stats.written}`)
})

await test('full write option still writes everything', async () => {
  const loaded = await withClient(c => loadSnapshotFromPg(c))
  const out = await persistSnapshot(loaded, { full: true })
  expect(out.stats.written === out.stats.rows, `written ${out.stats.written}/${out.stats.rows}`)
})

await closePool()
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
