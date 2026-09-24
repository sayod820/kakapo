/**
 * ONLINE-O3B — sale O8, adjustment, concurrency, return trace (real PG + API).
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
import { opRefDocId, SALE_OP_KIND, WH_OP_KINDS } from '../server/kakapo-api/pg/businessMutationTx.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const PREFIX = 'O3B-'

const REQUIRE = String(process.env.O3B_REAL_PG_REQUIRED || process.env.O8_REAL_PG_REQUIRED || '') === '1'
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
  const openList = await fetchJson(`${base}/pos/shifts?status=open`)
  const existingOpen = (openList.body || []).find(s => String(s.status) === 'open')
  if (existingOpen?.id) {
    return {
      productId: prod.body?.id,
      shiftId: existingOpen.id,
      posId: existingOpen.posId || posId,
    }
  }
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
  if (!cashierId) throw new Error('seed: no cashier')
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
    throw new Error(`shift ${shift.status} ${shift.body?.detail || JSON.stringify(shift.body)}`)
  }
  return { productId: prod.body?.id, shiftId: shift.body?.id, posId: shift.body?.posId || posId }
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

async function receipt(base, productId, qty, cost, clientRef, createdAtIso) {
  return fetchJson(`${base}/stock/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef,
      paidNow: 0,
      createdAtIso,
      items: [{ productId, qty, purchaseTotal: round2(qty * cost), costPrice: cost }],
    }),
  })
}

async function sale(base, fx, qty, clientRef) {
  return fetchJson(`${base}/pos/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef,
      shiftId: fx.shiftId,
      posId: fx.posId,
      paymentMethod: 'cash',
      total: round2(qty * 100),
      paidCash: round2(qty * 100),
      items: [{ productId: fx.productId, qty, price: 100, lineTotal: round2(qty * 100) }],
    }),
  })
}

async function runReturnTraceUnit() {
  const { createStockReceipt, createPosSale, sumProductLayers, ensurePosCollections, restoreConsumedLayersTrace } = await import(
    pathToFileURL(path.join(root, 'server/kakapo-api/posLogic.js')).href,
  )
  const db = {
    products: [{ id: 8001, name: 'R', price: 10, costPrice: 5, stock: 0 }],
    stockReceipts: [],
    posSales: [],
    posShifts: [{ id: 'SH', status: 'open', posId: 'POS', openingCash: 0, salesCash: 0, salesCard: 0, expenseTotal: 0 }],
    posPoints: [{ id: 'POS' }],
    cashiers: [{ id: 'C1' }],
    suppliers: [{ id: 'S1', name: 'S', supplyVersion: 0, totalSupplied: 0, totalPaid: 0, payable: 0 }],
    supplierPayments: [],
    writeOffs: [],
    moneyLedger: [],
    clients: [],
    cards: [],
    cashVault: { cashTotal: 0, cardTotal: 0 },
    _seq: {},
  }
  ensurePosCollections(db)
  createStockReceipt(db, { clientRef: 'ra', supplierId: 'S1', createdAtIso: '2020-01-01T00:00:00Z', items: [{ productId: 8001, qty: 2, purchaseTotal: 10, costPrice: 5 }] })
  createStockReceipt(db, { clientRef: 'rb', supplierId: 'S1', createdAtIso: '2020-01-02T00:00:00Z', items: [{ productId: 8001, qty: 3, purchaseTotal: 21, costPrice: 7 }] })
  const s = createPosSale(db, {
    clientRef: 's1',
    shiftId: 'SH',
    posId: 'POS',
    items: [{ productId: 8001, qty: 5, price: 10 }],
  })
  const layers = s.items[0].consumedLayers
  expect(Array.isArray(layers) && layers.length === 2, 'sale stores 2 consumed slices')
  expect(round2(sumProductLayers(db, 8001)) === 0, 'stock 0 after sale')
  restoreConsumedLayersTrace(db, layers, 2)
  expect(round2(sumProductLayers(db, 8001)) === 2, 'return 2 restores stock')
  restoreConsumedLayersTrace(db, layers, 1)
  expect(round2(sumProductLayers(db, 8001)) === 3, 'return 1 more')
}

async function main() {
  console.log('ONLINE-O3B stock final closure\n')
  await runReturnTraceUnit()

  if (!REAL_PG) {
    if (REQUIRE) { failed += 1; console.error('  FAIL PG required') }
    console.log(`\nO3B: ${passed} passed, ${failed} failed`)
    process.exit(failed ? 1 : 0)
  }

  await ensureSchema()
  await cleanupPg()
  await bootstrapTestLabCashVault()
  await assertStockFixtureBaselineClean(PREFIX)
  const port = 18803 + Math.floor(Math.random() * 200)
  let api = await startApi(port)
  const { base } = api

  try {
    const fx = await seed(base)
    const recA = await receipt(base, fx.productId, 10, 5, `${PREFIX}rec-a-${Date.now()}`, '2020-01-01T00:00:00Z')
    expect(recA.ok, `receipt ok (${recA.status})`)
    const layer0 = round2((recA.body?.items || []).reduce((s, it) => s + (Number(it.remainingQty) || 0), 0))
    const st0 = round2(await getProductStock(base, fx.productId))
    expect(layer0 === 10 && st0 === 10, `seed receipt/stock 10 (receipt=${layer0} stock=${st0})`)

    const patch = await fetchJson(`${base}/products/${fx.productId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock: 99, name: `${PREFIX}P` }),
    })
    expect(!patch.ok && patch.body?.code === 'STOCK_REQUIRES_ADJUSTMENT_OPERATION', 'PATCH stock rejected')

    const adj = await fetchJson(`${base}/stock/adjustments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRef: `${PREFIX}adj1-${Date.now()}`,
        productId: fx.productId,
        targetQty: 12,
        reason: `${PREFIX}manual`,
      }),
    })
    expect(adj.ok && adj.body?.durable, 'stock adjustment durable')
    expect(round2(await getProductStock(base, fx.productId)) === 12, 'stock after adjustment 12')

    const saleRef = `${PREFIX}sale-o8`
    const s1 = await sale(base, fx, 2, saleRef)
    expect(s1.ok && s1.body?.durable, 'sale O8 durable')
    const opId = opRefDocId(SALE_OP_KIND, saleRef)
    const opRow = await withClient(async (c) => {
      const q = await c.query('SELECT id FROM docs WHERE id = $1', [opId])
      return q.rows[0]
    })
    expect(!!opRow, 'sale opRef in PG')
    const sReplay = await sale(base, fx, 2, saleRef)
    expect(sReplay.body?.replayed && sReplay.body?.id === s1.body?.id, 'sale replay')
    expect(round2(await getProductStock(base, fx.productId)) === 10, 'stock after sale x1')

    const layersOnSale = s1.body?.items?.[0]?.consumedLayers
    expect(Array.isArray(layersOnSale) && layersOnSale.length >= 1, 'API sale has consumedLayers')

    // Concurrency: stock=10, two sales 4+3
    const fx2 = await seed(base)
    await receipt(base, fx2.productId, 10, 5, `${PREFIX}rec-c10`, '2020-01-01T00:00:00Z')
    const [cA, cB] = await Promise.all([
      sale(base, fx2, 4, `${PREFIX}conc-a`),
      sale(base, fx2, 3, `${PREFIX}conc-b`),
    ])
    expect(cA.ok && cB.ok, 'concurrent sales both ok')
    expect(round2(await getProductStock(base, fx2.productId)) === 3, 'concurrent final stock 3')

    // Race oversell: stock 5, two x4
    const fx3 = await seed(base)
    const rec3 = await receipt(base, fx3.productId, 5, 5, `${PREFIX}rec-c5-${Date.now()}`, '2020-01-01T00:00:00Z')
    expect(rec3.ok, 'oversell receipt ok')
    expect(round2(await getProductStock(base, fx3.productId)) === 5, 'oversell seed stock 5')
    const overTs = Date.now()
    const [oA, oB] = await Promise.all([
      sale(base, fx3, 4, `${PREFIX}over-a-${overTs}`),
      sale(base, fx3, 4, `${PREFIX}over-b-${overTs}`),
    ])
    const winners = [oA, oB].filter(r => r.ok && !r.body?.replayed)
    const okCount = winners.length
    expect(okCount <= 1, `oversell at most one new ok (${okCount})`)
    const st3 = round2(await getProductStock(base, fx3.productId))
    if (okCount === 1) {
      expect(!winners[0].body?.stockSkipped, 'oversell winner consumed stock')
      expect(st3 >= 0 && st3 <= 1, `oversell winner leaves stock 0-1 (${st3})`)
    } else if (okCount === 0) {
      expect(st3 === 5, `oversell both rejected keeps stock 5 (${st3})`)
      const bad = [oA, oB].find(r => !r.ok)
      expect(bad && /остат/i.test(String(bad.body?.detail || '')), 'reject message mentions stock')
    } else {
      expect(false, `unexpected oversell okCount ${okCount}`)
    }

    // Precommit kill sale
    await setChaos(base, 'before_commit')
    const killRef = `${PREFIX}pre-sale`
    const preP = sale(base, fx, 1, killRef).catch(() => ({ ok: false }))
    await sleep(700)
    killApi(api.child)
    await preP
    const preOp = await withClient(async (c) => {
      const q = await c.query('SELECT id FROM docs WHERE id = $1', [opRefDocId(SALE_OP_KIND, killRef)])
      return q.rows.length
    })
    expect(preOp === 0, 'precommit sale opRef zero')
    await sleep(400)
    api = await startApi(port)
    expect(round2(await getProductStock(api.base, fx.productId)) === 10, 'precommit no stock effect')

    await releaseChaos(api.base)
  } finally {
    killApi(api.child)
    await cleanupPg()
    await closePool()
  }

  console.log(`\nO3B: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
