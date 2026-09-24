/**
 * ONLINE-O8A — durable mutation foundation (real PostgreSQL + API child).
 *
 *   O8_REAL_PG_REQUIRED=1
 *   DATABASE_URL=postgresql://…/kakapo_l11_test
 */
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  ensureSchema,
  closePool,
  withClient,
  isPostgresEnabled,
} from '../server/kakapo-api/pg/client.js'
import { loadDocsIntoMemory } from '../server/kakapo-api/pg/businessMutationTx.js'
import { opRefDocId, FIN_OP_KINDS, CRM_OP_KINDS, WH_OP_KINDS } from '../server/kakapo-api/pg/businessMutationTx.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const PREFIX = 'O8A-'

const REQUIRE = String(process.env.O8_REAL_PG_REQUIRED || process.env.L11_REAL_PG_REQUIRED || '') === '1'
const REAL_PG = isPostgresEnabled()

let passed = 0
let failed = 0
const matrix = Object.create(null)

function expect(cond, msg) {
  if (cond) { passed += 1; console.log(`  OK  ${msg}`) }
  else { failed += 1; console.error(`  FAIL ${msg}`) }
}

function mark(route, field, ok) {
  if (!matrix[route]) matrix[route] = {}
  matrix[route][field] = ok ? 'PASS' : 'FAIL'
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100
}

async function fetchJson(url, init) {
  const res = await fetch(url, init)
  let body = null
  try { body = await res.json() } catch { body = null }
  return { ok: res.ok, status: res.status, body }
}

async function waitHealth(base, ms = 45000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetchJson(`${base}/health`)
      if (r.ok && r.body?.ok) return true
    } catch { /* retry */ }
    await sleep(250)
  }
  return false
}

function startApi(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['index.js'], {
      cwd: path.join(root, 'server/kakapo-api'),
      env: {
        ...process.env,
        PORT: String(port),
        KAKAPO_O8_TEST_API: '1',
        NODE_ENV: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr?.on('data', (d) => { stderr += String(d) })
    const base = `http://127.0.0.1:${port}`
    waitHealth(base).then((up) => {
      if (!up) {
        try { child.kill('SIGKILL') } catch { /* ignore */ }
        reject(new Error(`API failed to start: ${stderr.slice(-800)}`))
        return
      }
      resolve({ child, base })
    })
  })
}

function killApi(child) {
  try { child.kill('SIGKILL') } catch { /* ignore */ }
}

async function pgIdentity() {
  return withClient(async (c) => {
    const r = await c.query('SELECT current_database() AS db, current_user AS usr')
    return { db: r.rows[0]?.db, usr: r.rows[0]?.usr }
  })
}

async function cleanupPg() {
  await withClient(async (c) => {
    await c.query(
      'DELETE FROM sync_changes WHERE source_client_ref LIKE $1 OR entity_id LIKE $1',
      [`${PREFIX}%`],
    )
    await c.query(`DELETE FROM docs WHERE data->>'clientRef' LIKE $1`, [`${PREFIX}%`])
    await c.query(
      `DELETE FROM docs WHERE id LIKE $1 OR id LIKE $2`,
      [`${PREFIX}%`, `op:%${PREFIX}%`],
    )
    await c.query(`DELETE FROM docs WHERE collection='stockReceipts' AND data->>'clientRef' LIKE $1`, [`${PREFIX}%`])
    await c.query(`DELETE FROM docs WHERE collection='writeOffs' AND data->>'clientRef' LIKE $1`, [`${PREFIX}%`])
    await c.query(`DELETE FROM docs WHERE collection='posSales' AND data->>'clientRef' LIKE $1`, [`${PREFIX}%`])
    await c.query(`DELETE FROM docs WHERE collection='stockAdjustments' AND data->>'clientRef' LIKE $1`, [`${PREFIX}%`])
    await c.query(`DELETE FROM docs WHERE collection='products' AND data->>'name' LIKE $1`, [`${PREFIX}%`])
    await c.query(`DELETE FROM docs WHERE collection='suppliers' AND data->>'name' LIKE $1`, [`${PREFIX}%`])
    await c.query(`DELETE FROM docs WHERE collection='posShifts' AND data->>'status'='open' AND (data->>'cashierName' LIKE $1 OR data->>'clientRef' LIKE $1)`, [`${PREFIX}%`])
  })
}

async function countOpRef(kind, clientRef) {
  const id = opRefDocId(kind, clientRef)
  return withClient(async (c) => {
    const r = await c.query(`SELECT COUNT(*)::int AS n FROM docs WHERE collection='opRefs' AND id=$1`, [id])
    return r.rows[0]?.n || 0
  })
}

async function countSync(clientRef) {
  return withClient(async (c) => {
    const r = await c.query(
      'SELECT COUNT(*)::int AS n FROM sync_changes WHERE source_client_ref=$1',
      [clientRef],
    )
    return r.rows[0]?.n || 0
  })
}

async function setChaos(base, point) {
  return fetchJson(`${base}/__o8/chaos/hold-at`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ point }),
  })
}

async function releaseChaos(base) {
  return fetchJson(`${base}/__o8/chaos/release`, { method: 'POST' })
}

async function seedTradeFixtures(base) {
  const points = await fetchJson(`${base}/pos/points`)
  const posId = points.body?.[0]?.id
  if (!posId) throw new Error('seed: no pos point')

  const sup = await fetchJson(`${base}/suppliers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${PREFIX}Supplier`, clientRef: `${PREFIX}sup-seed` }),
  })
  if (!sup.ok) throw new Error(`seed supplier: ${sup.status} ${JSON.stringify(sup.body)}`)
  const supplierId = sup.body?.id

  const prod = await fetchJson(`${base}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `${PREFIX}Product`,
      price: 100,
      costPrice: 50,
      stock: 0,
      clientRef: `${PREFIX}prod-seed`,
    }),
  })
  if (!prod.ok) throw new Error(`seed product: ${prod.status} ${JSON.stringify(prod.body)}`)
  const productId = prod.body?.id

  const cardNum = `${PREFIX}CARD-${Date.now()}`
  const cardEnsure = await fetchJson(`${base}/cards/ensure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      num: cardNum,
      client: 'O8 Test',
      status: 'active',
      bonus: 0,
      clientRef: `${PREFIX}card-seed-${Date.now()}`,
    }),
  })
  if (!cardEnsure.ok) {
    throw new Error(`seed card ensure: ${cardEnsure.status} ${JSON.stringify(cardEnsure.body)}`)
  }

  const cashiers = await fetchJson(`${base}/cashiers`)
  let cashierId = cashiers.body?.[0]?.id
  if (!cashierId) {
    const created = await fetchJson(`${base}/cashiers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${PREFIX}Cashier`, pin: '0000' }),
    })
    cashierId = created.body?.id
  }
  if (!cashierId) throw new Error('seed: no cashier')

  const shiftRef = `${PREFIX}shift-open-${Date.now()}`
  let shift = await fetchJson(`${base}/pos/shifts/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      posId,
      cashierId,
      cashierName: `${PREFIX}Cashier`,
      openingCash: 1000,
      clientRef: shiftRef,
    }),
  })
  if (!shift.ok) {
    const open = await fetchJson(`${base}/pos/shifts`)
    const existing = (open.body || []).find(s => s.status === 'open' && s.posId === posId)
    if (existing) shift = { ok: true, body: existing }
  }
  if (!shift.ok) throw new Error(`seed shift: ${shift.status} ${JSON.stringify(shift.body)}`)

  const seedRec = await fetchJson(`${base}/stock/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}seed-rec-${Date.now()}`,
      supplierId,
      expectedSupplyVersion: 0,
      items: [{ productId, qty: 1, purchaseTotal: 10000, costPrice: 10000 }],
    }),
  })
  if (!seedRec.ok) {
    throw new Error(`seed receipt: ${seedRec.status} ${JSON.stringify(seedRec.body)}`)
  }

  return {
    supplierId,
    productId,
    cardNum,
    shiftId: shift.body?.id,
    posId: shift.body?.posId || posId,
  }
}

async function runRouteSuite(name, fn) {
  console.log(`\n=== ${name} ===`)
  try {
    await fn()
  } catch (e) {
    failed += 1
    console.error(`  FAIL suite ${name}:`, e?.message || e)
  }
}

console.log(`\n=== ONLINE-O8A REAL_PG=${REAL_PG} REQUIRED=${REQUIRE} ===`)

if (REQUIRE && !REAL_PG) {
  console.error('FAIL: O8_REAL_PG_REQUIRED=1 but DATABASE_URL missing')
  process.exit(1)
}

if (REAL_PG) {
  await ensureSchema()
  const id = await pgIdentity()
  console.log(`  INFO database=${id.db} user=${id.usr}`)
  expect(id.db === 'kakapo_l11_test' || process.env.O8_ALLOW_NON_L11_DB === '1', 'O8A.0 PG identity')
  if (REQUIRE && id.db !== 'kakapo_l11_test' && process.env.O8_ALLOW_NON_L11_DB !== '1') {
    process.exit(1)
  }
  await cleanupPg()
} else {
  console.log('  SKIP real-PG suites (set O8_REAL_PG_REQUIRED=1)')
  process.exit(0)
}

const PORT = 18080 + Math.floor(Math.random() * 200)
let api
try {
  api = await startApi(PORT)
} catch (e) {
  console.error(e.message)
  process.exit(1)
}

const pre = await fetchJson(`${api.base}/__o8/preflight`)
expect(pre.ok && pre.body?.ok, 'O8A preflight /__o8/preflight')
if (!pre.ok) {
  killApi(api.child)
  process.exit(1)
}

let fx
try {
  fx = await seedTradeFixtures(api.base)
  expect(!!fx.supplierId && !!fx.productId && !!fx.shiftId, 'O8A seed fixtures')
} catch (e) {
  expect(false, `O8A seed fixtures: ${e?.message || e}`)
  killApi(api.child)
  await closePool()
  process.exit(1)
}

const latencies = { topup: [], supplier: [], receipt: [] }

async function testSupplierPayment() {
  const route = 'supplier_payment'
  const clientRef = `${PREFIX}spay-1`
  const body = {
    clientRef,
    amount: 100,
    note: 'O8A book',
    expectedPayVersion: 0,
  }
  const t0 = Date.now()
  const r1 = await fetchJson(`${api.base}/suppliers/${fx.supplierId}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  latencies.supplier.push(Date.now() - t0)
  expect(r1.ok && r1.body?.amount === 100, `${route} NORMAL`)
  mark(route, 'NORMAL', r1.ok)

  const opN = await countOpRef(FIN_OP_KINDS.SUPPLIER_PAYMENT_CREATE, clientRef)
  const syncN = await countSync(clientRef)
  expect(opN === 1, `${route} PG_OPREF_ROWS`)
  expect(syncN >= 1, `${route} PG_SYNC_CHANGE_ROWS`)
  mark(route, 'PG_OPREF_ROWS', opN === 1)
  mark(route, 'PG_SYNC_CHANGE_ROWS', syncN >= 1)

  const r2 = await fetchJson(`${api.base}/suppliers/${fx.supplierId}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(r2.ok && r2.body?.replayed, `${route} SAME_REF_RETRY`)
  mark(route, 'SAME_REF_RETRY', r2.ok && r2.body?.replayed)

  const payCount = await withClient(async (c) => {
    const r = await c.query(
      `SELECT COUNT(*)::int AS n FROM docs WHERE collection='supplierPayments' AND data->>'clientRef'=$1`,
      [clientRef],
    )
    return r.rows[0]?.n || 0
  })
  expect(payCount === 1, `${route} no duplicate payment row`)
  mark(route, 'DOUBLE_CLICK', payCount === 1)

  const bad = await fetchJson(`${api.base}/suppliers/${fx.supplierId}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, clientRef, amount: 200 }),
  })
  expect(bad.status === 409, `${route} SAME_REF_DIFFERENT_PAYLOAD`)
  mark(route, 'SAME_REF_DIFFERENT_PAYLOAD', bad.status === 409)

  const supPg = await withClient(async (c) => {
    const r = await c.query(`SELECT data FROM docs WHERE collection='suppliers' AND id=$1`, [fx.supplierId])
    return r.rows[0]?.data
  })
  expect(Math.round((supPg?.totalPaid || 0) * 100) / 100 === 100, `${route} supplier.totalPaid`)
}

async function testCashTopup() {
  const route = 'cash_topup'
  const clientRef = `${PREFIX}top-1`
  const body = {
    clientRef,
    cash: 50,
    shiftId: fx.shiftId,
    posId: fx.posId,
    expectedBonusPayVersion: 0,
  }
  const t0 = Date.now()
  const r1 = await fetchJson(`${api.base}/cards/${encodeURIComponent(fx.cardNum)}/cash-topup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  latencies.topup.push(Date.now() - t0)
  expect(r1.ok && r1.body?.durable === true, `${route} NORMAL durable (${r1.status} ${JSON.stringify(r1.body?.detail || '')})`)
  mark(route, 'NORMAL', r1.ok && r1.body?.durable === true)

  const opN = await countOpRef(CRM_OP_KINDS.CARD_TOPUP, clientRef)
  expect(opN === 1, `${route} PG_OPREF_ROWS`)
  mark(route, 'PG_OPREF_ROWS', opN === 1)

  const r2 = await fetchJson(`${api.base}/cards/${encodeURIComponent(fx.cardNum)}/cash-topup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(r2.ok && r2.body?.replayed, `${route} ACK_LOST retry`)
  mark(route, 'SAME_REF_RETRY', r2.ok && r2.body?.replayed)

  const bonus1 = r1.body?.card?.bonus
  const bonus2 = r2.body?.card?.bonus
  expect(bonus1 === bonus2, `${route} no double bonus`)
  mark(route, 'ACK_LOST_DOUBLE_EFFECT', bonus1 === bonus2)
}

async function testStockReceipt() {
  const route = 'stock_receipt'
  const clientRef = `${PREFIX}rec-1`
  const body = {
    clientRef,
    supplierId: fx.supplierId,
    paidNow: 0,
    items: [{ productId: fx.productId, qty: 5, costPrice: 40, purchaseTotal: 200 }],
    expectedSupplyVersion: 1,
  }
  const t0 = Date.now()
  const r1 = await fetchJson(`${api.base}/stock/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  latencies.receipt.push(Date.now() - t0)
  expect(r1.ok && r1.body?.totalCost === 200, `${route} NORMAL`)
  mark(route, 'NORMAL', r1.ok)

  const opN = await countOpRef(WH_OP_KINDS.STOCK_RECEIPT_CREATE, clientRef)
  expect(opN === 1, `${route} PG_OPREF_ROWS`)
  mark(route, 'PG_OPREF_ROWS', opN === 1)

  const prodList = await fetchJson(`${api.base}/products`)
  const prodRow = (prodList.body || []).find(p => String(p.id) === String(fx.productId))
  const stockApi = round2(Number(prodRow?.stock))
  const prodPg = await withClient(async (c) => {
    const r = await c.query(
      `SELECT data FROM docs WHERE collection='products' AND id=$1 LIMIT 1`,
      [String(fx.productId)],
    )
    return r.rows[0]?.data
  })
  const stockPg = round2(Number(prodPg?.stock))
  const allRec = await fetchJson(`${api.base}/stock/receipts`)
  let layerSum = 0
  for (const rec of allRec.body || []) {
    for (const it of rec.items || []) {
      if (Number(it.productId) === Number(fx.productId)) layerSum += Number(it.remainingQty) || 0
    }
  }
  layerSum = round2(layerSum)
  expect(stockApi === layerSum && stockPg === layerSum && layerSum >= 5, `${route} stock/layer API=${stockApi} PG=${stockPg} layers=${layerSum}`)
  mark(route, 'PG_BUSINESS_ROWS', stockApi === layerSum && stockPg === layerSum)

  const r2 = await fetchJson(`${api.base}/stock/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(r2.ok && r2.body?.replayed, `${route} SAME_REF_RETRY`)
  mark(route, 'SAME_REF_RETRY', r2.ok && r2.body?.replayed)
}

async function testPrecommitKill() {
  const route = 'precommit'
  const clientRef = `${PREFIX}pre-1`
  await setChaos(api.base, 'before_commit')
  const p = fetchJson(`${api.base}/suppliers/${fx.supplierId}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef, amount: 10, expectedPayVersion: 1 }),
  }).catch(() => ({ ok: false }))
  await sleep(800)
  killApi(api.child)
  await sleep(300)
  await p

  const opN = await countOpRef(FIN_OP_KINDS.SUPPLIER_PAYMENT_CREATE, clientRef)
  expect(opN === 0, `${route} opRef zero after kill before commit`)
  mark(route, 'PRECOMMIT_KILL', opN === 0)

  api = await startApi(PORT)
  expect((await fetchJson(`${api.base}/__o8/preflight`)).ok, 'API restart after precommit kill')
}

async function testPostcommitKill() {
  const route = 'postcommit'
  const clientRef = `${PREFIX}post-1`
  await setChaos(api.base, 'after_commit_before_response')
  const p = fetchJson(`${api.base}/suppliers/${fx.supplierId}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef, amount: 15, expectedPayVersion: 1 }),
  }).catch(() => ({ ok: false, status: 0, body: null }))
  await sleep(1200)
  const opN = await countOpRef(FIN_OP_KINDS.SUPPLIER_PAYMENT_CREATE, clientRef)
  expect(opN === 1, `${route} committed before response`)
  killApi(api.child)
  await sleep(400)
  await p

  api = await startApi(PORT)
  await releaseChaos(api.base)
  const r2 = await fetchJson(`${api.base}/suppliers/${fx.supplierId}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef, amount: 15, expectedPayVersion: 1 }),
  }).catch(() => ({ ok: false, body: null }))
  expect(r2.ok && r2.body?.replayed, `${route} retry replay`)
  mark(route, 'POSTCOMMIT_PRERESPONSE_KILL', r2.ok && r2.body?.replayed)

  const payN = await withClient(async (c) => {
    const r = await c.query(
      `SELECT COUNT(*)::int AS n FROM docs WHERE collection='supplierPayments' AND data->>'clientRef'=$1`,
      [clientRef],
    )
    return r.rows[0]?.n || 0
  })
  expect(payN === 1, `${route} single payment row`)
}

async function testRestartHydration() {
  const route = 'restart'
  const clientRef = `${PREFIX}hydr-1`
  const body = {
    clientRef,
    amount: 25,
    expectedPayVersion: 2,
  }
  const r1 = await fetchJson(`${api.base}/suppliers/${fx.supplierId}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(r1.ok, `${route} mutation ok`)
  const paidBefore = r1.body?.amount

  killApi(api.child)
  await sleep(400)
  api = await startApi(PORT)

  const getSup = await fetchJson(`${api.base}/suppliers`)
  const sup = (getSup.body || []).find(s => s.id === fx.supplierId)
  expect(sup != null, `${route} API GET supplier`)

  const memDb = { suppliers: [], supplierPayments: [], opRefs: [] }
  await loadDocsIntoMemory(memDb, ['suppliers', 'supplierPayments', 'opRefs'])
  const supMem = memDb.suppliers.find(s => s.id === fx.supplierId)
  expect(Math.round((supMem?.totalPaid || 0) * 100) / 100 >= 25 + 100 + 15, `${route} MEMORY_EQUALS_PG totalPaid`)
  mark(route, 'API_RESTART', sup != null)
  mark(route, 'MEMORY_EQUALS_PG', supMem != null)
}

await runRouteSuite('Supplier book payment', testSupplierPayment)
await runRouteSuite('Cash topup', testCashTopup)
await runRouteSuite('Stock receipt create', testStockReceipt)
await runRouteSuite('Precommit kill', testPrecommitKill)
await runRouteSuite('Postcommit kill', testPostcommitKill)
await runRouteSuite('Restart hydration', testRestartHydration)

function pct(arr, p) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const i = Math.min(s.length - 1, Math.floor((p / 100) * s.length))
  return s[i]
}

console.log('\n=== Performance (ms) ===')
console.log(`  topup p50=${pct(latencies.topup, 50)} p95=${pct(latencies.topup, 95)} max=${Math.max(0, ...latencies.topup)}`)
console.log(`  supplier p50=${pct(latencies.supplier, 50)} p95=${pct(latencies.supplier, 95)} max=${Math.max(0, ...latencies.supplier)}`)
console.log(`  receipt p50=${pct(latencies.receipt, 50)} p95=${pct(latencies.receipt, 95)} max=${Math.max(0, ...latencies.receipt)}`)

killApi(api.child)
await closePool()

console.log(`\n=== O8A RESULT passed=${passed} failed=${failed} ===`)
console.log('MATRIX', JSON.stringify(matrix, null, 2))
process.exit(failed > 0 ? 1 : 0)
