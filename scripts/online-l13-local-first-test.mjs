/**
 * Step 7 — local-first on real PG (L13): real API child process + lab Postgres.
 * The kassa is simulated by the exact payloads its outbox sends
 * (appliedLocal / queuedOffline / skipStockAfterRevision / opSeq / createdAtIso).
 *
 *   A  2-day offline: 22 queued receipts, shift closed meanwhile → own shift / open shift
 *   C  revision during offline: sale before count not deducted twice, sale after count deducted
 *   B  two kassas at once → both converge through /sync/changes v2 (lib/syncPullV2Core.mjs)
 *   D  API restart: state from PG identical, replays stay idempotent
 *
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:5432/kakapo_l11_test node scripts/online-l13-local-first-test.mjs
 */
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadLocalEnv } from '../server/kakapo-api/loadEnv.js'
loadLocalEnv()

import { ensureSchema, closePool, isPostgresEnabled, withClient } from '../server/kakapo-api/pg/client.js'
import { assertTestDatabaseAllowed, truncateTestLabDatabase } from './online-test-db-cleanup.mjs'
import { fetchInboundDelta } from '../lib/syncPullV2Core.mjs'
import { changesToDeltaBags } from '../lib/syncChangeLogCore.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const P = 'L13-'
const HOUR = 3600_000

let passed = 0
let failed = 0
function expect(cond, msg) {
  if (cond) { passed += 1; console.log(`  OK   ${msg}`) } else { failed += 1; console.error(`  FAIL ${msg}`) }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const iso = (ms) => new Date(ms).toISOString()
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
let refN = 0
const cref = (tag) => `${P}${tag}-${Date.now().toString(36)}-${++refN}`

async function fetchJson(url, init) {
  try {
    const res = await fetch(url, init)
    let body = null
    try { body = await res.json() } catch { body = null }
    return { ok: res.ok, status: res.status, body }
  } catch (e) {
    return { ok: false, status: 0, body: { detail: String(e?.message || e) } }
  }
}

async function waitHealth(base, ms = 60000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const r = await fetchJson(`${base}/health`)
    if (r.ok && r.body?.ok) return true
    await sleep(250)
  }
  return false
}

function startApi(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['index.js'], {
      cwd: path.join(root, 'server/kakapo-api'),
      env: { ...process.env, PORT: String(port), KAKAPO_O8_TEST_API: '1', KAKAPO_L13_TEST_API: '1', KAKAPO_LAB_AUTO_AUTH: '1', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let log = ''
    child.stdout?.on('data', (d) => { log += String(d) })
    child.stderr?.on('data', (d) => { log += String(d) })
    const base = `http://127.0.0.1:${port}`
    waitHealth(base).then((up) => {
      if (!up) {
        try { child.kill('SIGKILL') } catch { /* ignore */ }
        reject(new Error(`API failed: ${log.slice(-1500)}`))
        return
      }
      resolve({ child, base, log: () => log })
    })
  })
}

function killApi(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode != null) return resolve()
    child.once('exit', () => resolve())
    try { child.kill('SIGKILL') } catch { /* ignore */ }
    setTimeout(resolve, 3000)
  })
}

let api = null
const get = (p) => fetchJson(`${api.base}${p}`)
const send = (method, p, body) => fetchJson(`${api.base}${p}`, {
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {}),
})

async function productStock(id) {
  const r = await get('/products')
  const p = (r.body || []).find(x => Number(x.id) === Number(id))
  return p ? round2(p.stock) : NaN
}

async function salesByRef() {
  const r = await get('/pos/sales?limit=100000')
  const list = Array.isArray(r.body) ? r.body : (r.body?.items || r.body?.sales || [])
  const map = new Map()
  for (const s of list) if (String(s.clientRef || '').startsWith(P)) map.set(s.clientRef, s)
  return map
}

/** What the kassa outbox sends for a receipt punched while offline. */
function offlineSale(k, { at, opSeq, shiftId, productId, qty = 1, price = 10 }) {
  const total = round2(qty * price)
  return {
    clientRef: cref(`sale-${k.dev}`),
    shiftId,
    posId: k.posId,
    cashierId: k.cashierId,
    cashierName: k.cashierName,
    deviceId: k.dev,
    deviceName: k.dev,
    opSeq,
    createdAtIso: iso(at),
    appliedLocal: true,
    queuedOffline: true,
    skipStockAfterRevision: true,
    paymentMethod: 'cash',
    total,
    paidCash: total,
    items: [{ productId, qty, price, lineTotal: total }],
  }
}

/** Kassa flush of one queued receipt (lib/offline.ts): on SHIFT_CLOSED for a receipt punched
 *  after the close, the same payload goes to the point's current open shift. */
async function flushQueued(body) {
  let r = await send('POST', '/pos/sales', body)
  if (!r.ok && /SHIFT_CLOSED|смена уже закрыта/i.test(`${r.body?.code} ${r.body?.detail}`)) {
    const shifts = (await get('/pos/shifts')).body || []
    const closed = shifts.find(s => s.id === body.shiftId)
    const madeAfterClose = closed?.closedAtIso && Date.parse(body.createdAtIso) > Date.parse(closed.closedAtIso)
    const open = shifts.find(s => s.status === 'open' && s.posId === body.posId)
    if (madeAfterClose && open) {
      body.shiftId = open.id
      r = await send('POST', '/pos/sales', body)
      r.rerouted = true
    }
  }
  return r
}

function onlineSale(k, { shiftId, productId, qty = 1, price = 10 }) {
  const total = round2(qty * price)
  return {
    clientRef: cref(`on-${k.dev}`),
    shiftId,
    posId: k.posId,
    cashierId: k.cashierId,
    cashierName: k.cashierName,
    deviceId: k.dev,
    paymentMethod: 'cash',
    total,
    paidCash: total,
    items: [{ productId, qty, price, lineTotal: total }],
  }
}

async function pgSaleCountByRefs(refs) {
  return withClient(async (c) => {
    const r = await c.query(
      `SELECT count(*)::int n FROM docs WHERE collection='posSales' AND data->>'clientRef' = ANY($1::text[])`,
      [refs],
    )
    return r.rows[0].n
  })
}

async function pgLedgerCountByRefs(refs) {
  return withClient(async (c) => {
    const r = await c.query(
      `SELECT count(*)::int n FROM docs WHERE collection='moneyLedger' AND data->>'type' LIKE 'sale%'
         AND (data->>'clientRef' = ANY($1::text[]) OR data->>'refId' IN (
           SELECT id FROM docs WHERE collection='posSales' AND data->>'clientRef' = ANY($1::text[])))`,
      [refs],
    )
    return r.rows[0].n
  })
}

async function waitPersisted(refs, ms = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await pgSaleCountByRefs(refs) === refs.length) return true
    await sleep(300)
  }
  return false
}

// ─────────────────────────────────────────────────────────────
console.log('\n=== L13 local-first on real PG ===')
if (!isPostgresEnabled()) {
  console.error('FAIL: DATABASE_URL required (kakapo_l11_test)')
  process.exit(1)
}
const ident = await assertTestDatabaseAllowed()
console.log(`lab DB: ${ident.db}`)
await ensureSchema()
await truncateTestLabDatabase()

const PORT = 18900 + Math.floor(Math.random() * 80)
api = await startApi(PORT)

try {
  // ── fixtures ──
  const mkProduct = async (name) => (await send('POST', '/products', {
    name: `${P}${name}`, price: 10, costPrice: 5, stock: 0, clientRef: cref('prod'),
  })).body?.id
  const P1 = await mkProduct('Milk')
  const P2 = await mkProduct('Bread')
  const rec = await send('POST', '/stock/receipts', {
    clientRef: cref('rec'),
    supplierName: `${P}Sup`,
    items: [
      { productId: P1, qty: 100, costPrice: 5, retailPrice: 10 },
      { productId: P2, qty: 50, costPrice: 5, retailPrice: 10 },
    ],
  })
  expect(rec.ok && P1 && P2, 'fixtures: 2 products, receipt 100 + 50')
  const PA = (await send('POST', '/pos/points', { name: `${P}PointA`, clientRef: cref('pt') })).body?.id
  const PB = (await send('POST', '/pos/points', { name: `${P}PointB`, clientRef: cref('pt') })).body?.id
  const CA = (await send('POST', '/cashiers', { name: `${P}Kassir A`, pin: '1111', clientRef: cref('csh') })).body?.id
  const CB = (await send('POST', '/cashiers', { name: `${P}Kassir B`, pin: '2222', clientRef: cref('csh') })).body?.id
  expect(PA && PB && CA && CB && PA !== PB && CA !== CB, 'fixtures: 2 points, 2 cashiers')
  const A = { dev: `${P}DEV-A`, posId: PA, cashierId: CA, cashierName: `${P}Kassir A` }
  const B = { dev: `${P}DEV-B`, posId: PB, cashierId: CB, cashierName: `${P}Kassir B` }

  const openShift = async (k, openedAt) => (await send('POST', '/pos/shifts/open', {
    clientRef: cref('shift'), posId: k.posId, cashierId: k.cashierId, cashierName: k.cashierName,
    openingCash: 0, openedAtIso: iso(openedAt),
  })).body

  // ── A: 2 days offline ──
  console.log('\n--- A  2 days offline, shift closed meanwhile ---')
  const now = Date.now()
  const S1 = await openShift(A, now - 49 * HOUR)
  expect(S1?.id, 'kassa A opened shift S1 49h ago (online)')
  let seqA = 0
  const offlineA = []
  for (let i = 0; i < 20; i++) {
    offlineA.push(offlineSale(A, { at: now - 48 * HOUR + i * 2.2 * HOUR, opSeq: ++seqA, shiftId: S1.id, productId: P1 }))
  }
  // While A is offline, the shift is closed from another device and a new one opened
  const close = await send('PATCH', `/pos/shifts/${S1.id}/close`, {
    clientRef: cref('close'), closingCash: 0, closedAtIso: iso(now - 2 * HOUR),
  })
  expect(close.ok, `S1 closed from another device 2h ago (${close.status})`)
  const S2 = await openShift(A, now - 1 * HOUR)
  expect(S2?.id && S2.id !== S1.id, 'new shift S2 opened 1h ago')
  // A keeps selling offline with its stale shift S1 after the close
  for (let i = 0; i < 2; i++) {
    offlineA.push(offlineSale(A, { at: now - 30 * 60_000 + i * 60_000, opSeq: ++seqA, shiftId: S1.id, productId: P1 }))
  }

  const stockBeforeFlush = await productStock(P1)
  const flushA = []
  for (const body of offlineA) flushA.push(await flushQueued(body))
  const bad = flushA.filter(r => !r.ok)
  expect(!bad.length, `all 22 queued receipts accepted (${bad.map(r => `${r.status}:${r.body?.code || r.body?.detail}`).join(', ') || 'ok'})`)
  expect(flushA.filter(r => r.rerouted).length === 2, 'the 2 receipts punched after the close were re-sent to the open shift (kassa rule)')
  let byRef = await salesByRef()
  const refsA = offlineA.map(s => s.clientRef)
  const inS1 = refsA.slice(0, 20).filter(r => byRef.get(r)?.shiftId === S1.id).length
  const inS2 = refsA.slice(20).filter(r => byRef.get(r)?.shiftId === S2.id).length
  expect(inS1 === 20, `receipts punched before the close landed in their closed shift S1 (${inS1}/20)`)
  expect(inS2 === 2, `receipts punched after the close landed in the open shift S2 (${inS2}/2)`)
  expect(refsA.every(r => byRef.get(r)?.createdAtIso), 'receipt time = kassa time (createdAtIso kept)')
  expect(await productStock(P1) === round2(stockBeforeFlush - 22), `stock P1 ${stockBeforeFlush} → ${await productStock(P1)} (−22 exactly)`)

  const replayA = []
  for (const body of offlineA) replayA.push(await flushQueued(body))
  expect(replayA.every(r => r.ok || r.status === 409), `replay of the whole queue answered without errors (${[...new Set(replayA.map(r => r.status))].join(',')})`)
  byRef = await salesByRef()
  expect(refsA.filter(r => byRef.has(r)).length === 22, 'replay did not create duplicates (22 receipts)')
  expect(await productStock(P1) === round2(stockBeforeFlush - 22), 'replay did not deduct stock again')
  expect(await waitPersisted(refsA), '22 receipts durable in Postgres')
  expect(await pgLedgerCountByRefs(refsA) === 22, `money ledger: exactly one sale entry per receipt (${await pgLedgerCountByRefs(refsA)})`)

  // ── C: revision while kassa A is offline ──
  console.log('\n--- C  revision during offline ---')
  const p2Start = await productStock(P2)
  const S3 = await openShift(B, Date.now() - 60_000)
  expect(S3?.id, 'kassa B has its own open shift S3')
  // A (offline) sells 3 before the count — server does not know about it
  const beforeCount = offlineSale(A, { at: Date.now() - 10 * 60_000, opSeq: ++seqA, shiftId: S2.id, productId: P2, qty: 3 })
  // Stock-taker counts physical 47 while the system (unaware of A's sale) shows 50
  const rev = await send('POST', '/stock/revisions', {
    clientRef: cref('rev'), note: `${P}count`,
    items: [{ productId: P2, countedStock: round2(p2Start - 3), systemStock: p2Start }],
  })
  expect(rev.ok, `revision posted (${rev.status})`)
  expect(await productStock(P2) === round2(p2Start - 3), `after revision P2 = ${await productStock(P2)} (counted)`)
  await sleep(1100)
  // A (still offline) sells 2 after the count; B (online) sells 1 after the count
  const afterCount = offlineSale(A, { at: Date.now(), opSeq: ++seqA, shiftId: S2.id, productId: P2, qty: 2 })
  const bOnline = await send('POST', '/pos/sales', onlineSale(B, { shiftId: S3.id, productId: P2, qty: 1 }))
  expect(bOnline.ok, 'kassa B online sale after the count')
  const f1 = await send('POST', '/pos/sales', beforeCount)
  const f2 = await send('POST', '/pos/sales', afterCount)
  expect(f1.ok && f2.ok, `A flushes both late receipts (${f1.status}, ${f2.status})`)
  byRef = await salesByRef()
  const sBefore = byRef.get(beforeCount.clientRef)
  const sAfter = byRef.get(afterCount.clientRef)
  expect(!!sBefore && !!sAfter, 'late receipts are not lost')
  expect(sBefore?.stockSkipped === true, 'receipt punched BEFORE the count: stock not deducted again (count already saw it)')
  expect(!sAfter?.stockSkipped, 'receipt punched AFTER the count: stock deducted')
  const expectP2 = round2(p2Start - 3 - 2 - 1)
  expect(await productStock(P2) === expectP2, `P2 final ${await productStock(P2)} = ${expectP2} (counted 47 − 2 after − 1 online)`)
  await send('POST', '/pos/sales', beforeCount)
  await send('POST', '/pos/sales', afterCount)
  expect(await productStock(P2) === expectP2, 'replay after revision does not change stock')
  // Status change of the revision (queued → done) must reach kassas via v2, not only its creation
  const qRevRef = cref('qrev')
  const qRev = await send('POST', '/stock/revisions', {
    clientRef: qRevRef, note: `${P}queued`, waitDevices: [{ deviceId: B.dev, posId: B.posId }],
    items: [{ productId: P2, countedStock: expectP2, systemStock: expectP2 }],
  })
  expect(qRev.ok, `queued revision posted, waits for kassa B queue (${qRev.status})`)
  await sleep(300)
  const pendingStatus = ((await get('/stock/revisions')).body || []).find(r => r.clientRef === qRevRef)?.status
  expect(pendingStatus === 'pending_queues', `revision waits for kassa B (${pendingStatus})`)
  const hb = await send('POST', '/pos/devices/heartbeat', { deviceId: B.dev, posId: B.posId, queueLen: 0, queueFlushed: true })
  expect(hb.ok, `kassa B reports empty queue (${hb.status})`)
  let srvRevStatus = null
  let journalRevStatus = null
  for (let i = 0; i < 40; i++) {
    const srvRev = ((await get('/stock/revisions')).body || []).find(r => r.clientRef === qRevRef)
    const revId = srvRev?.id
    srvRevStatus = srvRev?.status || null
    const feed = (await get('/sync/changes?v=2&cursor=0&limit=5000')).body?.changes || []
    journalRevStatus = changesToDeltaBags(feed).pos.revisions.find(r => r.id === revId)?.status || null
    if (srvRevStatus && srvRevStatus === journalRevStatus && !/queue|pending/i.test(srvRevStatus)) break
    await sleep(500)
  }
  expect(srvRevStatus === 'done' && journalRevStatus === 'done', `queued revision: status "done" reaches v2 journal (${journalRevStatus} / ${srvRevStatus})`)
  expect(await productStock(P2) === expectP2, 'zero-diff queued revision keeps P2')

  // ── B: two kassas at once, convergence via v2 ──
  console.log('\n--- B  two kassas, convergence through /sync/changes v2 ---')
  // Safe head lags fresh journal rows by the 15s gap grace — kassa adopts only a cursor > 0
  let startCursor = 0
  for (let i = 0; i < 60 && !(startCursor > 0); i++) {
    startCursor = Number((await get('/sync/changes')).body?.changeSeqCursor) || 0
    if (!(startCursor > 0)) await sleep(500)
  }
  expect(startCursor > 0, `both kassas start from the same v2 cursor ${startCursor}`)
  // Kassa stock = sum of cached layers (lib/stockLayersLocal); baseline taken with the cursor
  const baseLayers = ((await get(`/products/${P1}/stock-layers`)).body || [])
  const layerKey = (l) => `${l.receiptId}:${l.productId}`
  const layerQty = (l) => Number(l.remainingQty ?? l.qty) || 0
  const burst = []
  for (let i = 0; i < 10; i++) {
    burst.push(onlineSale(A, { shiftId: S2.id, productId: P1 }))
    burst.push(onlineSale(B, { shiftId: S3.id, productId: P1 }))
  }
  const burstRes = await Promise.all(burst.map(b => send('POST', '/pos/sales', b)))
  expect(burstRes.every(r => r.ok), `20 concurrent sales from A and B accepted (${[...new Set(burstRes.map(r => r.status))].join(',')})`)
  const burstRefs = new Set(burst.map(b => b.clientRef))

  async function kassaPull(label) {
    let cursor = startCursor
    const seen = new Map()
    let productRow = null
    const layers = new Map(baseLayers.map(l => [layerKey(l), l]))
    let v1Calls = 0
    const t0 = Date.now()
    while (Date.now() - t0 < 30000) {
      const out = await fetchInboundDelta({
        now: Date.now(),
        lastV1At: Date.now(),
        getV1Cursor: async () => '',
        getV2Cursor: async () => cursor,
        fetchV1: async () => { v1Calls++; return { full: false } },
        fetchV2: async (c, limit) => (await get(`/sync/changes?v=2&cursor=${c}&limit=${limit}`)).body,
      })
      if (out.mode !== 'v2') break
      cursor = out.v2Cursor
      for (const s of out.delta.pos.sales) if (burstRefs.has(s.clientRef)) seen.set(s.clientRef, s.id)
      const p = out.delta.products.find(x => Number(x.id) === Number(P1))
      if (p) productRow = p
      for (const l of out.delta.stockLayers) if (Number(l.productId) === Number(P1)) layers.set(layerKey(l), l)
      if (seen.size === burstRefs.size && round2(productRow?.stock) === expectP1) break
      await sleep(500)
    }
    const layerStock = round2([...layers.values()].reduce((s, l) => s + layerQty(l), 0))
    return { label, seen, productRow, layerStock, v1Calls, cursor }
  }
  const expectP1 = round2(100 - 22 - 20)
  const [pa, pb] = await Promise.all([kassaPull('A'), kassaPull('B')])
  const serverStockP1 = await productStock(P1)
  byRef = await salesByRef()
  const serverIds = [...burstRefs].map(r => byRef.get(r)?.id).sort().join(',')
  expect(pa.v1Calls === 0 && pb.v1Calls === 0, 'both pulled only through v2 (no v1 fallback)')
  expect(pa.seen.size === 20 && pb.seen.size === 20, `each kassa received all 20 sales (A ${pa.seen.size}, B ${pb.seen.size})`)
  expect([...pa.seen.values()].sort().join(',') === serverIds && [...pb.seen.values()].sort().join(',') === serverIds, 'A, B and server have identical sale ids')
  expect(pa.layerStock === serverStockP1 && pb.layerStock === serverStockP1, `stock from layers identical on A, B and server (${pa.layerStock} / ${pb.layerStock} / ${serverStockP1})`)
  expect(round2(pa.productRow?.stock) === serverStockP1 && round2(pb.productRow?.stock) === serverStockP1, `product card itself arrives via v2 with the new stock (${pa.productRow?.stock} / ${pb.productRow?.stock})`)
  expect(serverStockP1 === expectP1, `stock P1 = 100 − 22 offline − 20 concurrent = ${serverStockP1}`)

  // ── D: restart, state comes back from PG ──
  console.log('\n--- D  API restart on the same Postgres ---')
  const allRefs = [...refsA, beforeCount.clientRef, afterCount.clientRef, ...burstRefs]
  expect(await waitPersisted(allRefs), `all ${allRefs.length} receipts durable before restart`)
  await sleep(1500)
  const snap = { p1: await productStock(P1), p2: await productStock(P2) }
  await killApi(api.child)
  api = await startApi(PORT)
  byRef = await salesByRef()
  expect(allRefs.every(r => byRef.has(r)), `after restart all ${allRefs.length} receipts are there`)
  expect(await productStock(P1) === snap.p1 && await productStock(P2) === snap.p2, `stock after restart identical (P1 ${snap.p1}, P2 ${snap.p2})`)
  expect(refsA.slice(0, 20).every(r => byRef.get(r)?.shiftId === S1.id), 'shift attribution survived restart')
  expect(byRef.get(beforeCount.clientRef)?.stockSkipped === true, 'revision decision survived restart')
  const shifts = (await get('/pos/shifts')).body || []
  expect(shifts.find(s => s.id === S1.id)?.status === 'closed', 'S1 still closed after restart')
  const r1 = await flushQueued(offlineA[0])
  const r2 = await send('POST', '/pos/sales', afterCount)
  expect((r1.ok || r1.status === 409) && (r2.ok || r2.status === 409), 'replay after restart answered')
  byRef = await salesByRef()
  expect(allRefs.filter(r => byRef.has(r)).length === allRefs.length && await pgSaleCountByRefs(allRefs) === allRefs.length, 'replay after restart created no duplicates (memory + PG)')
  expect(await productStock(P1) === snap.p1 && await productStock(P2) === snap.p2, 'replay after restart did not move stock')
} catch (e) {
  failed += 1
  console.error('  FAIL crashed:', e?.stack || e)
} finally {
  await killApi(api?.child)
  await closePool()
}

console.log(`\nL13 local-first: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
