/**
 * ONLINE-O3 — stock / warehouse / FIFO / O8 writeoff conservation (real PG + API).
 *
 *   O3_REAL_PG_REQUIRED=1
 *   DATABASE_URL=postgresql://…/kakapo_l11_test
 */
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  ensureSchema,
  closePool,
  withClient,
  isPostgresEnabled,
} from '../server/kakapo-api/pg/client.js'
import {
  cleanupOnlineTestPrefixes,
  assertStockFixtureBaselineClean,
  bootstrapTestLabCashVault,
} from './online-test-db-cleanup.mjs'
import { opRefDocId, WH_OP_KINDS } from '../server/kakapo-api/pg/businessMutationTx.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const PREFIX = 'O3-'

const REQUIRE = String(process.env.O3_REAL_PG_REQUIRED || process.env.O8_REAL_PG_REQUIRED || '') === '1'
const REAL_PG = isPostgresEnabled()

let passed = 0
let failed = 0

function expect(cond, msg) {
  if (cond) { passed += 1; console.log(`  OK  ${msg}`) }
  else { failed += 1; console.error(`  FAIL ${msg}`) }
}

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
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
      env: { ...process.env, PORT: String(port), KAKAPO_O8_TEST_API: '1', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr?.on('data', (d) => { stderr += String(d) })
    const base = `http://127.0.0.1:${port}`
    waitHealth(base).then((up) => {
      if (!up) {
        try { child.kill('SIGKILL') } catch { /* ignore */ }
        reject(new Error(`API failed: ${stderr.slice(-800)}`))
        return
      }
      resolve({ child, base })
    })
  })
}

function killApi(child) {
  try { child.kill('SIGKILL') } catch { /* ignore */ }
}

async function cleanupPg() {
  await cleanupOnlineTestPrefixes()
}

function sumLayersFromReceipts(receipts, productId) {
  let s = 0
  for (const r of receipts || []) {
    for (const it of r.items || []) {
      if (Number(it.productId) !== Number(productId)) continue
      s += Number(it.remainingQty) || 0
    }
  }
  return round2(s)
}

async function getProductStock(base, productId) {
  const all = await fetchJson(`${base}/products`)
  const row = (all.body || []).find(p => Number(p.id) === Number(productId))
  return row?.stock
}

async function seed(base) {
  const points = await fetchJson(`${base}/pos/points`)
  const posId = points.body?.[0]?.id
  const sup = await fetchJson(`${base}/suppliers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${PREFIX}Sup`, clientRef: `${PREFIX}sup-${Date.now()}` }),
  })
  const prod = await fetchJson(`${base}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `${PREFIX}P`,
      price: 100,
      costPrice: 50,
      stock: 0,
      clientRef: `${PREFIX}prod-${Date.now()}`,
    }),
  })
  const cashiers = await fetchJson(`${base}/cashiers`)
  let cashierId = cashiers.body?.[0]?.id
  if (!cashierId) {
    const c = await fetchJson(`${base}/cashiers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${PREFIX}Cashier`, pin: '0000' }),
    })
    cashierId = c.body?.id
  }
  const openList = await fetchJson(`${base}/pos/shifts?status=open`)
  const existingOpen = (openList.body || []).find(s => String(s.status) === 'open')
  if (existingOpen?.id) {
    return {
      supplierId: sup.body?.id,
      productId: prod.body?.id,
      shiftId: existingOpen.id,
      posId: existingOpen.posId || posId,
      cashierId: existingOpen.cashierId || cashierId,
    }
  }
  const shift = await fetchJson(`${base}/pos/shifts/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      posId,
      cashierId,
      cashierName: `${PREFIX}Cashier`,
      openingCash: 1000,
      clientRef: `${PREFIX}shift-${Date.now()}`,
    }),
  })
  if (!shift.ok) {
    throw new Error(`seed shift: ${shift.status} ${shift.body?.detail || JSON.stringify(shift.body)}`)
  }
  return {
    supplierId: sup.body?.id,
    productId: prod.body?.id,
    shiftId: shift.body?.id,
    posId: shift.body?.posId || posId,
    cashierId,
  }
}

async function supplierSupplyVersion(base, supplierId) {
  const r = await fetchJson(`${base}/suppliers/${supplierId}`)
  return Number(r.body?.supplyVersion) || 0
}

async function receiptPost(base, fx, items, clientRef, createdAtIso) {
  const supplyVersion = fx.supplierId ? await supplierSupplyVersion(base, fx.supplierId) : 0
  const body = {
    clientRef,
    supplierId: fx.supplierId,
    expectedSupplyVersion: supplyVersion,
    paidNow: 0,
    items,
  }
  if (createdAtIso) body.createdAtIso = createdAtIso
  return fetchJson(`${base}/stock/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function runInMemoryFifo() {
  const { createStockReceipt, createPosSale, sumProductLayers, ensurePosCollections } = await import(
    pathToFileURL(path.join(root, 'server/kakapo-api/posLogic.js')).href,
  )
  const db = {
    products: [{ id: 9001, name: 'FIFO', price: 10, costPrice: 5, stock: 0, unit: 'шт' }],
    stockReceipts: [],
    writeOffs: [],
    posSales: [],
    posShifts: [{
      id: 'SH-O3',
      status: 'open',
      posId: 'POS-1',
      cashierId: 'C1',
      openingCash: 0,
      salesCash: 0,
      salesCard: 0,
      expenseTotal: 0,
    }],
    posPoints: [{ id: 'POS-1', name: 'T' }],
    cashiers: [{ id: 'C1', name: 'K' }],
    suppliers: [{ id: 'S1', name: 'S', totalSupplied: 0, totalPaid: 0, payable: 0, supplyVersion: 0 }],
    supplierPayments: [],
    moneyLedger: [],
    orders: [],
    expenses: [],
    clients: [],
    cards: [],
    cashVault: { cashTotal: 0, cardTotal: 0 },
    _seq: {},
  }
  ensurePosCollections(db)
  const pid = 9001
  createStockReceipt(db, {
    clientRef: 'fifo-a',
    supplierId: 'S1',
    createdAtIso: '2020-01-01T00:00:00.000Z',
    items: [{ productId: pid, qty: 10, purchaseTotal: 50, costPrice: 5 }],
  })
  createStockReceipt(db, {
    clientRef: 'fifo-b',
    supplierId: 'S1',
    createdAtIso: '2020-01-02T00:00:00.000Z',
    items: [{ productId: pid, qty: 10, purchaseTotal: 70, costPrice: 7 }],
  })
  expect(round2(sumProductLayers(db, pid)) === 20, 'FIFO seed stock 20')
  const sale1 = createPosSale(db, {
    clientRef: 'fifo-s1',
    shiftId: 'SH-O3',
    posId: 'POS-1',
    cashierId: 'C1',
    items: [{ productId: pid, qty: 12, price: 10 }],
  })
  const cogs1 = round2((sale1.items || [])[0]?.lineCost ?? 0)
  expect(cogs1 === round2(10 * 5 + 2 * 7), `FIFO sale1 COGS ${cogs1}`)
  expect(round2(sumProductLayers(db, pid)) === 8, 'FIFO after sale1 layers 8')
  expect(round2(db.products[0].stock) === 8, 'FIFO after sale1 product.stock 8')
  const recA = db.stockReceipts.find(r => r.clientRef === 'fifo-a')
  const recB = db.stockReceipts.find(r => r.clientRef === 'fifo-b')
  expect(round2(recA.items[0].remainingQty) === 0, 'FIFO A remaining 0')
  expect(round2(recB.items[0].remainingQty) === 8, 'FIFO B remaining 8')
  createPosSale(db, {
    clientRef: 'fifo-s2',
    shiftId: 'SH-O3',
    posId: 'POS-1',
    cashierId: 'C1',
    items: [{ productId: pid, qty: 3, price: 10 }],
  })
  expect(round2(recB.items[0].remainingQty) === 5, 'FIFO B remaining 5 after sale2')
  expect(round2(db.products[0].stock) === 5, 'FIFO product.stock 5')
}

async function main() {
  console.log('ONLINE-O3 stock conservation\n')
  await runInMemoryFifo()

  if (!REAL_PG) {
    console.log('\n  SKIP PG/API cases (no DATABASE_URL)')
    if (REQUIRE) {
      failed += 1
      console.error('  FAIL O3_REAL_PG_REQUIRED=1 but PG disabled')
    }
    console.log(`\nO3: ${passed} passed, ${failed} failed`)
    process.exit(failed ? 1 : 0)
  }

  await ensureSchema()
  await cleanupPg()
  await bootstrapTestLabCashVault()
  await assertStockFixtureBaselineClean(PREFIX)
  const port = 18703 + Math.floor(Math.random() * 200)
  let api = await startApi(port)
  const { base } = api

  try {
    const fx = await seed(base)

    // Layer match after receipt
    const recRef = `${PREFIX}rec1`
    const r1 = await receiptPost(base, fx, [{
      productId: fx.productId,
      qty: 10,
      purchaseTotal: 100,
    }], recRef)
    expect(r1.ok && r1.body?.id, 'receipt create')
    const allRec = await fetchJson(`${base}/stock/receipts`)
    const layerSum = sumLayersFromReceipts(allRec.body, fx.productId)
    const stock1 = await getProductStock(base, fx.productId)
    expect(round2(stock1) === layerSum, `product.stock=${stock1} layers=${layerSum}`)

    // Writeoff O8 replay
    const woRef = `${PREFIX}wo1`
    const wo1 = await fetchJson(`${base}/stock/writeoffs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRef: woRef,
        reason: `${PREFIX}test`,
        items: [{ productId: fx.productId, qty: 3 }],
      }),
    })
    expect(wo1.ok && wo1.body?.durable, 'writeoff durable')
    const woReplay = await fetchJson(`${base}/stock/writeoffs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRef: woRef,
        reason: `${PREFIX}test`,
        items: [{ productId: fx.productId, qty: 3 }],
      }),
    })
    expect(woReplay.body?.replayed && woReplay.body?.id === wo1.body?.id, 'writeoff idempotent replay')
    const stockAfterWo = await getProductStock(base, fx.productId)
    expect(round2(stockAfterWo) === 7, `stock after writeoff 7 (got ${stockAfterWo})`)

    const opId = opRefDocId(WH_OP_KINDS.STOCK_WRITEOFF_CREATE, woRef)
    const opRow = await withClient(async (c) => {
      const q = await c.query('SELECT id FROM docs WHERE id = $1', [opId])
      return q.rows[0]
    })
    expect(!!opRow, 'writeoff opRef in PG')

    const prod2 = await fetchJson(`${base}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${PREFIX}P2`,
        price: 100,
        costPrice: 50,
        stock: 0,
        clientRef: `${PREFIX}prod2-${Date.now()}`,
      }),
    })
    const productId2 = prod2.body?.id

    // Receipt delete blocked when consumed (single layer product)
    const rec2Ref = `${PREFIX}rec2`
    const r2 = await fetchJson(`${base}/stock/receipts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRef: rec2Ref,
        paidNow: 0,
        items: [{ productId: productId2, qty: 10, purchaseTotal: 100 }],
      }),
    })
    expect(r2.ok && r2.body?.id, `rec2 create (${r2.status} ${r2.body?.detail || ''})`)
    const rec2Id = r2.body?.id
    const saleR = await fetchJson(`${base}/pos/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRef: `${PREFIX}sale-consume`,
        shiftId: fx.shiftId,
        posId: fx.posId,
        cashierId: fx.cashierId,
        items: [{ productId: productId2, qty: 4, price: 100 }],
      }),
    })
    expect(saleR.ok, `sale consume (${saleR.status} ${saleR.body?.detail || ''})`)
    const recAfterSale = (await fetchJson(`${base}/stock/receipts`)).body?.find(r => r.id === rec2Id)
    const remAfterSale = recAfterSale?.items?.[0]?.remainingQty
    expect(round2(remAfterSale) === 6, `rec2 remaining after sale (${remAfterSale})`)
    const delBad = await fetchJson(`${base}/stock/receipts/${rec2Id}?clientRef=${PREFIX}del-bad`, {
      method: 'DELETE',
    })
    expect(!delBad.ok && /использовано/i.test(String(delBad.body?.detail || '')), 'reject delete consumed receipt')

    // Receipt edit below consumed rejected
    const updBad = await fetchJson(`${base}/stock/receipts/${rec2Id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRef: `${PREFIX}upd-bad`,
        supplierId: fx.supplierId,
        expectedSupplyVersion: await supplierSupplyVersion(base, fx.supplierId),
        items: [{ productId: productId2, qty: 3, purchaseTotal: 30 }],
      }),
    })
    expect(!updBad.ok && /уменьшить приход/i.test(String(updBad.body?.detail || '')), 'reject receipt edit below consumed')

    // Writeoff delete replay
    const woDelRef = `${PREFIX}wo-del`
    const woDel = await fetchJson(`${base}/stock/writeoffs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRef: woDelRef,
        reason: 'del',
        items: [{ productId: fx.productId, qty: 1 }],
      }),
    })
    const wId = woDel.body?.id
    const stockBeforeDel = await getProductStock(base, fx.productId)
    const d1 = await fetchJson(`${base}/stock/writeoffs/${wId}?clientRef=${PREFIX}wodel1`, { method: 'DELETE' })
    expect(d1.ok, 'writeoff delete ok')
    const d2 = await fetchJson(`${base}/stock/writeoffs/${wId}?clientRef=${PREFIX}wodel1`, { method: 'DELETE' })
    expect(d2.body?.replayed, 'writeoff delete replay')
    const stockAfterRestore = await getProductStock(base, fx.productId)
    expect(round2(stockAfterRestore) === round2(stockBeforeDel + 1), 'writeoff delete restores stock once')

    // API restart same stock
    const snapStock = await getProductStock(base, fx.productId)
    killApi(api.child)
    await sleep(500)
    api = await startApi(port)
    const afterRestart = await getProductStock(api.base, fx.productId)
    expect(round2(afterRestart) === round2(snapStock), 'restart preserves product.stock')
  } finally {
    killApi(api.child)
    await cleanupPg()
    await closePool()
  }

  console.log(`\nO3: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
