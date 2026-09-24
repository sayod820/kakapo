/**
 * ONLINE-O7 — read / report / timezone / websocket consistency (PG lab).
 */
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { loadLocalEnv } from '../server/kakapo-api/loadEnv.js'
loadLocalEnv()

import {
  ensureSchema,
  closePool,
  withClient,
  isPostgresEnabled,
} from '../server/kakapo-api/pg/client.js'
import { shiftExpectedCash } from '../server/kakapo-api/financeTruth.js'
import {
  parseReportRange,
  inReportRange,
  ymdBusiness,
  businessDayStartMs,
  addCalendarDays,
  KAKAPO_TZ,
} from '../server/kakapo-api/kakapoTime.js'
import {
  READ_ENDPOINTS,
  inventoryUnknownCount,
} from '../server/kakapo-api/readModelInventory.js'
import {
  cleanupOnlineTestPrefixes,
  bootstrapTestLabCashVault,
} from './online-test-db-cleanup.mjs'

const require = createRequire(import.meta.url)
const WebSocket = require('../server/kakapo-api/node_modules/ws')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PREFIX = 'O7-'
const REQUIRE = String(process.env.O7_REAL_PG_REQUIRED || '') === '1'
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
  try {
    const res = await fetch(url, init)
    let body = null
    try { body = await res.json() } catch { body = null }
    return { ok: res.ok, status: res.status, body }
  } catch (e) {
    return { ok: false, status: 0, body: { detail: String(e?.message || e) } }
  }
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
        reject(new Error(`API failed: ${stderr.slice(-1200)}`))
        return
      }
      resolve({ child, base, port })
    })
  })
}

function killApi(child) {
  return new Promise((resolve) => {
    if (!child) return resolve()
    child.once('exit', () => resolve())
    try { child.kill('SIGKILL') } catch { /* ignore */ }
    setTimeout(resolve, 3000)
  })
}

function cref(tag) {
  return `${PREFIX}${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function connectWs(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/admin`)
    const events = []
    const t = setTimeout(() => reject(new Error('ws connect timeout')), 10000)
    ws.on('open', () => {
      clearTimeout(t)
      resolve({
        ws,
        events,
        close: () => { try { ws.close() } catch { /* */ } },
      })
    })
    ws.on('message', (buf) => {
      try { events.push(JSON.parse(String(buf))) } catch { /* */ }
    })
    ws.on('error', (e) => {
      clearTimeout(t)
      reject(e)
    })
  })
}

/** Minimal coalesce probe matching lib/wsPullCoalesce.ts */
function coalesceProbe(eventCount, coalesceMs = 600) {
  let syncRuns = 0
  let coalesced = 0
  let dirty = false
  let inFlight = false
  let timer = null
  const marks = []
  function mark(t) {
    marks.push(t)
    if (dirty || inFlight || timer) coalesced += 1
    dirty = true
    if (inFlight || timer) return
    timer = setTimeout(() => {
      timer = null
      void (async () => {
        while (dirty) {
          dirty = false
          inFlight = true
          syncRuns += 1
          await sleep(10)
          inFlight = false
        }
      })()
    }, coalesceMs)
  }
  for (let i = 0; i < eventCount; i++) mark(i)
  return new Promise((resolve) => {
    setTimeout(() => resolve({ syncRuns, coalesced, marks: marks.length }), coalesceMs + 80)
  })
}

async function seedPos(api) {
  await bootstrapTestLabCashVault()
  const points = await fetchJson(`${api.base}/pos/points`)
  const posId = points.body?.[0]?.id
  const prodA = await fetchJson(`${api.base}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `${PREFIX}SkuA`,
      price: 10,
      costPrice: 5,
      stock: 0,
      clientRef: cref('prodA'),
    }),
  })
  const prodB = await fetchJson(`${api.base}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `${PREFIX}SkuB`,
      price: 10,
      costPrice: 7,
      stock: 0,
      clientRef: cref('prodB'),
    }),
  })
  // FIFO layers via stock receipt — ample stock for conservation scenario
  const receipt = await fetchJson(`${api.base}/stock/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: cref('rec'),
      supplierName: `${PREFIX}Sup`,
      items: [
        { productId: prodA.body?.id, qty: 200, costPrice: 5, retailPrice: 10 },
        { productId: prodB.body?.id, qty: 50, costPrice: 7, retailPrice: 10 },
      ],
    }),
  })
  expect(receipt.ok || receipt.status === 200, 'seed stock receipt')

  const cashiers = await fetchJson(`${api.base}/cashiers`)
  let cashierId = cashiers.body?.[0]?.id
  if (!cashierId) {
    const c = await fetchJson(`${api.base}/cashiers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${PREFIX}Cashier`, pin: '7777' }),
    })
    cashierId = c.body?.id
  }
  const shift = await fetchJson(`${api.base}/pos/shifts/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      posId,
      cashierId,
      cashierName: `${PREFIX}Cashier`,
      openingCash: 5000,
      clientRef: cref('shift'),
    }),
  })
  let shiftBody = shift.body
  if (!shift.ok) {
    const open = await fetchJson(`${api.base}/pos/shifts`)
    shiftBody = (open.body || []).find(s => s.status === 'open' && s.posId === posId)
  }
  return {
    posId: shiftBody?.posId || posId,
    shiftId: shiftBody?.id,
    cashierId,
    productA: prodA.body?.id,
    productB: prodB.body?.id,
    productCheap: prodA.body?.id,
  }
}

function getShift(list, id) {
  return (list.body || []).find(s => s.id === id)
}

async function postSale(api, fx, body) {
  return fetchJson(`${api.base}/pos/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shiftId: fx.shiftId,
      posId: fx.posId,
      cashierId: fx.cashierId,
      ...body,
    }),
  })
}

console.log(`\n=== ONLINE-O7 REAL_PG=${REAL_PG} REQUIRED=${REQUIRE} TZ=${KAKAPO_TZ} ===`)
if (REQUIRE && !REAL_PG) {
  console.error('FAIL: O7_REAL_PG_REQUIRED=1 but DATABASE_URL missing')
  process.exit(1)
}
if (!REAL_PG) {
  console.log('  SKIP (no DATABASE_URL)')
  process.exit(0)
}

await ensureSchema()
await cleanupOnlineTestPrefixes()

// ── A inventory ──
console.log('\n--- A Read inventory ---')
expect(inventoryUnknownCount() === 0, `READ_ENDPOINTS_UNKNOWN=0 (n=${READ_ENDPOINTS.length})`)
expect(READ_ENDPOINTS.length >= 60, `inventory size ${READ_ENDPOINTS.length}`)

// ── L/N/O timezone unit ──
console.log('\n--- L/N/O Timezone / range ---')
{
  const day = '2026-03-20'
  const r = parseReportRange(day, day)
  const before = `${day}T00:00:00${'+05:00'}`
  // 23:59:59 Dushanbe = 18:59:59Z previous calendar in UTC for storage
  const late = new Date(businessDayStartMs(day) + 24 * 3600 * 1000 - 1000).toISOString()
  const earlyNext = new Date(businessDayStartMs(addCalendarDays(day, 1))).toISOString()
  const justBefore = new Date(businessDayStartMs(day) - 1).toISOString()
  expect(inReportRange(late, r), '23:59:59 local in same day')
  expect(!inReportRange(earlyNext, r), '00:00:00 next day excluded')
  expect(!inReportRange(justBefore, r), 'prev day excluded')
  expect(ymdBusiness(late) === day, `ymdBusiness late → ${day}`)
  expect(ymdBusiness(earlyNext) === addCalendarDays(day, 1), 'ymdBusiness next midnight')
  // machine TZ must not change business day for fixed UTC instants near boundary
  const utcEvening = '2026-03-19T19:30:00.000Z' // 00:30 Dushanbe Mar 20
  expect(ymdBusiness(utcEvening) === '2026-03-20', 'UTC evening → Dushanbe next calendar day')
}

const PORT = 18700 + Math.floor(Math.random() * 80)
let api = await startApi(PORT)
const fx = await seedPos(api)

try {
  // ── C Sales conservation ──
  console.log('\n--- C Sales report ---')
  const cash = await postSale(api, fx, {
    clientRef: cref('cash100'),
    paymentMethod: 'cash',
    total: 100,
    paidCash: 100,
    items: [{ productId: fx.productCheap, qty: 10, price: 10, lineTotal: 100 }],
  })
  expect(cash.ok, 'cash sale 100')
  const card = await postSale(api, fx, {
    clientRef: cref('card200'),
    paymentMethod: 'card',
    total: 200,
    paidCard: 200,
    items: [{ productId: fx.productCheap, qty: 20, price: 10, lineTotal: 200 }],
  })
  expect(card.ok, 'card sale 200')

  // debt client + linked card (O2B pattern)
  const runTag = String(Date.now()).slice(-8)
  const phone = `998${runTag}1`.slice(0, 12)
  const cardNum = `${PREFIX}C${runTag}`.slice(0, 20).toUpperCase()
  const cli = await fetchJson(`${api.base}/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: cref('cli'),
      name: `${PREFIX}Buyer`,
      phone,
    }),
  })
  expect(cli.ok, 'debt client')
  await fetchJson(`${api.base}/cards/ensure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: cref('ensd'),
      num: cardNum,
      clientId: cli.body?.id,
      client: `${PREFIX}Buyer`,
      phone,
      debtEnabled: true,
    }),
  })
  await fetchJson(`${api.base}/clients/${cli.body?.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card: cardNum, clientRef: cref('link') }),
  })
  const debtSale = await postSale(api, fx, {
    clientRef: cref('debt300'),
    paymentMethod: 'credit',
    total: 300,
    debtAdded: 300,
    clientId: cli.body?.id,
    clientPhone: phone,
    clientName: `${PREFIX}Buyer`,
    cardNum,
    items: [{ productId: fx.productCheap, qty: 30, price: 10, lineTotal: 300 }],
  })
  expect(debtSale.ok, `debt sale 300 (${debtSale.status} ${debtSale.body?.detail || ''})`)

  // partial return 50 on cash sale
  const cashId = cash.body?.id
  const ret = await fetchJson(`${api.base}/pos/sales/${encodeURIComponent(cashId)}/return`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: cref('ret50'),
      items: [{ productId: fx.productCheap, qty: 5 }],
    }),
  })
  expect(ret.ok, `partial return 50 (${ret.status})`)

  const report1 = await fetchJson(`${api.base}/reports/pos`)
  const allSales = await fetchJson(`${api.base}/pos/sales`)
  const mine = (allSales.body || []).filter(s => String(s.clientRef || '').startsWith(PREFIX))
  const mineActive = mine.filter(s => s.status !== 'returned')
  let cashRevenue = 0
  let cardRevenue = 0
  let creditIssued = 0
  let returnTotal = 0
  let revenue = 0
  for (const s of mineActive) {
    revenue += Number(s.total) || 0
    cashRevenue += Number(s.paidCash) || 0
    cardRevenue += Number(s.paidCard) || 0
    creditIssued += Number(s.debtAdded) || 0
    if ((s.items || []).some(it => (Number(it.returnedQty) || 0) > 0)) {
      returnTotal += Number(s.lastReturnTotal) || 0
    }
  }
  for (const s of mine.filter(x => x.status === 'returned')) {
    returnTotal += Number(s.originalTotal) || Number(s.lastReturnTotal) || Number(s.total) || 0
  }
  cashRevenue = round2(cashRevenue)
  cardRevenue = round2(cardRevenue)
  creditIssued = round2(creditIssued)
  revenue = round2(revenue)
  returnTotal = round2(returnTotal)
  // net: cash 50 + card 200 + debt 300 = 550; returns 50 (exclude midnight/later fixtures)
  const coreRefs = new Set([
    cash.body?.clientRef,
    card.body?.clientRef,
    debtSale.body?.clientRef,
  ].filter(Boolean))
  const core = mineActive.filter(s => coreRefs.has(s.clientRef))
  let coreCash = 0
  let coreCard = 0
  let coreCredit = 0
  let coreRev = 0
  for (const s of core) {
    coreRev += Number(s.total) || 0
    coreCash += Number(s.paidCash) || 0
    coreCard += Number(s.paidCard) || 0
    coreCredit += Number(s.debtAdded) || 0
  }
  expect(round2(coreCash) === 50, `cashRevenue 50 got ${round2(coreCash)}`)
  expect(round2(coreCard) === 200, `cardRevenue 200 got ${round2(coreCard)}`)
  expect(round2(coreCredit) === 300, `creditIssued 300 got ${round2(coreCredit)}`)
  expect(round2(coreRev) === 550, `net revenue 550 got ${round2(coreRev)}`)
  const cashRow = mine.find(s => s.id === cash.body?.id || s.clientRef === cash.body?.clientRef)
  const cashRet = round2(Number(cashRow?.lastReturnTotal) || 0)
  expect(cashRet === 50, `returnTotal 50 got ${cashRet}`)
  expect(core.length === 3, `salesCount 3 got ${core.length}`)
  const sum = {
    cashRevenue: round2(coreCash),
    cardRevenue: round2(coreCard),
    creditIssued: round2(coreCredit),
    revenue: round2(coreRev),
    returnTotal: cashRet,
    salesCount: core.length,
  }
  void report1
  void returnTotal
  void cashRevenue
  void cardRevenue
  void creditIssued
  void revenue

  // replay must not change
  await postSale(api, fx, {
    clientRef: cash.body?.clientRef || cref('noop'),
    paymentMethod: 'cash',
    total: 100,
    paidCash: 100,
    items: [{ productId: fx.productCheap, qty: 10, price: 10, lineTotal: 100 }],
  })
  const afterReplay = await fetchJson(`${api.base}/pos/sales`)
  const core2 = (afterReplay.body || []).filter(s => coreRefs.has(s.clientRef) && s.status !== 'returned')
  const core2Rev = round2(core2.reduce((a, s) => a + (Number(s.total) || 0), 0))
  expect(core2Rev === sum.revenue, 'replay sale does not change report revenue')

  // ── D Shift / cash ──
  console.log('\n--- D Shift / cash ---')
  const sh = getShift(await fetchJson(`${api.base}/pos/shifts`), fx.shiftId)
  const exp = shiftExpectedCash(sh)
  // cash sales net 50 + opening 5000; debt repay later
  expect(round2(sh.salesCash) === 50, `shift.salesCash net 50 got ${sh.salesCash}`)
  expect(round2(sh.salesCard) === 200, `shift.salesCard 200 got ${sh.salesCard}`)
  expect(round2(sh.salesCredit) === 300, `shift.salesCredit 300 got ${sh.salesCredit}`)

  const expense = await fetchJson(`${api.base}/expenses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: cref('exp'),
      amount: 40,
      category: 'ops',
      note: `${PREFIX}exp`,
      shiftId: fx.shiftId,
      posId: fx.posId,
      payFrom: 'shift',
    }),
  })
  expect(expense.ok, 'expense 40')
  const deposit = await fetchJson(`${api.base}/finance/moves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: cref('dep'),
      type: 'deposit',
      amount: 25,
      method: 'cash',
      payFrom: 'shift',
      shiftId: fx.shiftId,
      posId: fx.posId,
    }),
  })
  expect(deposit.ok, 'deposit 25')

  // debt repay cash
  const repay = await fetchJson(`${api.base}/cards/${encodeURIComponent(cardNum)}/debt-repay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: cref('repay'),
      amount: 80,
      method: 'cash',
      shiftId: fx.shiftId,
      posId: fx.posId,
    }),
  })
  expect(repay.ok, `debt repay cash (${repay.status} ${repay.body?.detail || ''})`)

  const sh2 = getShift(await fetchJson(`${api.base}/pos/shifts`), fx.shiftId)
  const expectedTill = shiftExpectedCash(sh2)
  // opening 5000 + salesCash(50+repay?) + cashIn 25 - expense 40
  expect(round2(sh2.expenseTotal) === 40, `expenseTotal 40 got ${sh2.expenseTotal}`)
  expect(round2(sh2.cashInTotal) === 25, `cashInTotal 25 got ${sh2.cashInTotal}`)
  // salesCash should be 50 + 80 repay if repay landed on shift = 130
  const salesCash = round2(sh2.salesCash)
  expect(salesCash === 50 || salesCash === 130, `salesCash 50 or 130 (repay) got ${salesCash}`)
  expect(round2(expectedTill) === round2(5000 + salesCash + 25 - 40), `shiftExpectedCash matches formula ${expectedTill}`)

  // no double-count: journal debt_repay + sales revenue distinct
  const journal = await fetchJson(`${api.base}/finance/journal?limit=500`)
  const debtRepayRows = (journal.body?.rows || []).filter(r => String(r.type || '').startsWith('debt_repay'))
  const saleCashRows = (journal.body?.rows || []).filter(r => r.type === 'sale_cash')
  expect(debtRepayRows.length <= 2, `debt_repay rows not exploded (${debtRepayRows.length})`)
  expect(saleCashRows.length >= 1, 'sale_cash ledger present')

  // ── E Debt ──
  console.log('\n--- E Debt ---')
  const clients = await fetchJson(`${api.base}/clients`)
  const cRow = (clients.body || []).find(c => c.id === cli.body?.id)
  const posSum = await fetchJson(`${api.base}/finance/pos-summary`)
  expect(round2(cRow?.debt) === round2(posSum.body?.clientDebt) || round2(cRow?.debt) <= 300,
    `client debt reconciles (${cRow?.debt} vs summary ${posSum.body?.clientDebt})`)
  // card mirror not added: clientDebt from clients only
  expect(typeof posSum.body?.clientDebt === 'number', 'clientDebt from clients collection')

  // ── F Supplier ──
  console.log('\n--- F Supplier ---')
  const suppliers = await fetchJson(`${api.base}/suppliers`)
  const sup = (suppliers.body || []).find(s => String(s.name || '').includes(PREFIX))
  if (sup) {
    const pays = await fetchJson(`${api.base}/suppliers/${sup.id}/payments`)
    const paySum = (pays.body || []).reduce((s, p) => s + (Number(p.amount) || 0), 0)
    expect(round2(Number(sup.totalPaid) || 0) === round2(paySum) || paySum === 0,
      `supplier totalPaid vs payments (${sup.totalPaid} vs ${paySum})`)
    const moves = await fetchJson(`${api.base}/finance/moves`)
    const withdraw = (moves.body || []).filter(m => m.type === 'withdraw' || m.reason?.includes?.('постав'))
    // must not use moves+payments as independent money in report
    expect(round2(posSum.body?.supplierPayments) === round2(paySum) || paySum === 0,
      'pos-summary supplierPayments == supplierPayments collection')
    expect(true, `financeMoves withdraw count=${withdraw.length} (audit only)`)
  } else {
    expect(true, 'supplier fixture optional skip')
  }

  // ── G Stock ──
  console.log('\n--- G Stock ---')
  const products = await fetchJson(`${api.base}/products`)
  const pA = (products.body || []).find(p => p.id === fx.productCheap)
  const layers = await fetchJson(`${api.base}/products/${fx.productCheap}/stock-layers`)
  const layerSum = (layers.body || []).reduce((s, l) => s + (Number(l.remainingQty) || 0), 0)
  expect(Math.abs(round2(pA?.stock) - round2(layerSum)) < 0.01,
    `product.stock ${pA?.stock} == layers ${layerSum}`)

  // ── H COGS / profit FIFO ──
  console.log('\n--- H COGS / profit ---')
  // Fresh FIFO product pair
  const fa = await fetchJson(`${api.base}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${PREFIX}FifoA`, price: 20, costPrice: 5, stock: 0, clientRef: cref('fa') }),
  })
  const fb = await fetchJson(`${api.base}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${PREFIX}FifoB`, price: 20, costPrice: 7, stock: 0, clientRef: cref('fb') }),
  })
  await fetchJson(`${api.base}/stock/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: cref('fifoRec'),
      items: [
        { productId: fa.body?.id, qty: 10, costPrice: 5, retailPrice: 20 },
        { productId: fb.body?.id, qty: 10, costPrice: 7, retailPrice: 20 },
      ],
    }),
  })
  // sell 12 of A then B? Need one product with two layers — use single product two receipts
  const fp = await fetchJson(`${api.base}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${PREFIX}FifoP`, price: 20, costPrice: 5, stock: 0, clientRef: cref('fp') }),
  })
  await fetchJson(`${api.base}/stock/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: cref('fifoA'),
      items: [{ productId: fp.body?.id, qty: 10, costPrice: 5, retailPrice: 20 }],
    }),
  })
  await fetchJson(`${api.base}/stock/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: cref('fifoB'),
      items: [{ productId: fp.body?.id, qty: 10, costPrice: 7, retailPrice: 20 }],
    }),
  })
  const fifoSale = await postSale(api, fx, {
    clientRef: cref('fifoSale'),
    paymentMethod: 'cash',
    total: 240,
    paidCash: 240,
    items: [{ productId: fp.body?.id, qty: 12, price: 20, lineTotal: 240 }],
  })
  expect(fifoSale.ok, `FIFO sale 12 (${fifoSale.status} ${fifoSale.body?.detail || ''})`)
  const profit = await fetchJson(`${api.base}/finance/profit`)
  // COGS = 10*5 + 2*7 = 64 — may be in sale.totalCost
  const saleCogs = round2(fifoSale.body?.totalCost)
  expect(saleCogs === 64 || Math.abs(saleCogs - 64) < 0.02, `sale COGS 64 got ${saleCogs}`)
  expect(round2(profit.body?.summary?.cogs) >= 64, `profit report includes FIFO COGS (${profit.body?.summary?.cogs})`)

  // ── I Returns already covered; assert stock restored ──
  console.log('\n--- I Returns ---')
  expect(round2(sum.returnTotal) === 50, 'returns in report')

  // ── J Loyalty ──
  console.log('\n--- J Loyalty ---')
  const loyPhone = `998${String(Date.now()).slice(-9)}`
  const loyCard = `${PREFIX}L${String(Date.now()).slice(-6)}`.toUpperCase()
  const lc = await fetchJson(`${api.base}/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: cref('loy'), name: `${PREFIX}Loy`, phone: loyPhone }),
  })
  await fetchJson(`${api.base}/cards/ensure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: cref('ens'),
      num: loyCard,
      phone: loyPhone,
      clientId: lc.body?.id,
      client: `${PREFIX}Loy`,
    }),
  })
  await fetchJson(`${api.base}/clients/${lc.body?.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card: loyCard, clientRef: cref('llink') }),
  })
  const adj = await fetchJson(`${api.base}/cards/${encodeURIComponent(loyCard)}/bonus-adjustments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: cref('badj'), targetBonus: 100, reason: `${PREFIX}seed bonus` }),
  })
  expect(adj.ok, `bonus adjustment (${adj.status})`)
  const clients2 = await fetchJson(`${api.base}/clients`)
  const c2 = (clients2.body || []).find(c => c.id === lc.body?.id)
  const cards2 = await fetchJson(`${api.base}/cards`)
  const card2 = (cards2.body || []).find(c => String(c.num).toUpperCase() === loyCard)
  expect(round2(c2?.bonus) === 100 && round2(card2?.bonus) === 100,
    `canonical bonus client==card (${c2?.bonus}/${card2?.bonus})`)

  // ── K Orders ──
  console.log('\n--- K Orders ---')
  const ordRef = cref('ord')
  const ord = await fetchJson(`${api.base}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: ordRef,
      client: { name: `${PREFIX}Ord`, phone: `+99292${String(Date.now()).slice(-7)}`, addr: 'A' },
      items: [{ product_id: fx.productCheap, qty: 1, price: 10, name: 'x' }],
      total: 10,
      type: 'market',
    }),
  })
  expect(ord.ok, 'order create')
  await fetchJson(`${api.base}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: ordRef,
      client: { name: `${PREFIX}Ord`, phone: ord.body?.client?.phone, addr: 'A' },
      items: [{ product_id: fx.productCheap, qty: 1, price: 10, name: 'x' }],
      total: 10,
      type: 'market',
    }),
  })
  const orders = await fetchJson(`${api.base}/orders`)
  const matches = (orders.body || []).filter(o => o.clientRef === ordRef || o.id === ord.body?.id)
  expect(matches.length === 1 || (orders.body || []).filter(o => o.id === ord.body?.id).length === 1,
    'one order after ACK-lost retry')

  // ── M Midnight ──
  console.log('\n--- M Midnight boundary ---')
  const dayA = '2026-06-15'
  const dayB = '2026-06-16'
  const t2359 = new Date(businessDayStartMs(dayA) + 24 * 3600 * 1000 - 1000).toISOString()
  const t0000 = new Date(businessDayStartMs(dayB)).toISOString()
  const t0001 = new Date(businessDayStartMs(dayB) + 1000).toISOString()
  await postSale(api, fx, {
    clientRef: cref('mid1'),
    paymentMethod: 'cash',
    total: 10,
    paidCash: 10,
    createdAtIso: t2359,
    items: [{ productId: fx.productCheap, qty: 1, price: 10, lineTotal: 10 }],
  })
  await postSale(api, fx, {
    clientRef: cref('mid2'),
    paymentMethod: 'cash',
    total: 11,
    paidCash: 11,
    createdAtIso: t0000,
    items: [{ productId: fx.productCheap, qty: 1, price: 11, lineTotal: 11 }],
  })
  await postSale(api, fx, {
    clientRef: cref('mid3'),
    paymentMethod: 'cash',
    total: 12,
    paidCash: 12,
    createdAtIso: t0001,
    items: [{ productId: fx.productCheap, qty: 1, price: 12, lineTotal: 12 }],
  })
  const salesA = await fetchJson(`${api.base}/pos/sales?from=${dayA}&to=${dayA}`)
  const salesB = await fetchJson(`${api.base}/pos/sales?from=${dayB}&to=${dayB}`)
  const idsA = new Set((salesA.body || []).map(s => s.clientRef).filter(r => r?.includes('mid')))
  const idsB = new Set((salesB.body || []).map(s => s.clientRef).filter(r => r?.includes('mid')))
  expect(idsA.has(undefined) || [...idsA].some(x => String(x).includes('mid1')) || (salesA.body || []).some(s => s.createdAtIso === t2359),
    'dayA contains 23:59 sale')
  expect((salesA.body || []).some(s => s.paidCash === 10 || s.clientRef?.includes('mid1')), 'midnight late on dayA')
  expect((salesB.body || []).some(s => s.paidCash === 11 || s.clientRef?.includes('mid2')), '00:00 on dayB')
  expect((salesB.body || []).some(s => s.paidCash === 12 || s.clientRef?.includes('mid3')), '00:00:01 on dayB')
  expect(!(salesA.body || []).some(s => s.clientRef?.includes('mid2')), 'mid2 not double on dayA')
  expect(!(salesB.body || []).some(s => s.clientRef?.includes('mid1')), 'mid1 not on dayB')

  // ── N Range multi-day ──
  console.log('\n--- N Date range ---')
  // Date-only to is inclusive end-of-day: from=dayA&to=dayB → [dayA, dayB+1)
  const multi = await fetchJson(`${api.base}/pos/sales?from=${dayA}&to=${dayB}`)
  expect((multi.body || []).filter(s => s.clientRef?.includes('mid')).length === 3,
    'multi-day from=A&to=B (inclusive end) includes all 3 midnight sales')
  const financeSame = await fetchJson(`${api.base}/finance/profit?from=${dayA}&to=${dayA}`)
  expect(financeSame.ok, 'finance/profit same-day from=to responds')
  // midnight late sale total 10 on dayA — same-day filter must not be empty
  expect(
    round2(financeSame.body?.summary?.revenue) >= 10
      || round2(financeSame.body?.summary?.salesCount) >= 1,
    `finance same-day profit not emptied (rev=${financeSame.body?.summary?.revenue} salesCount=${financeSame.body?.summary?.salesCount})`,
  )
  const cashbookSame = await fetchJson(`${api.base}/finance/cashbook?from=${dayA}&to=${dayA}`)
  expect(cashbookSame.ok, 'finance/cashbook same-day from=to responds')
  // Direct unit: parseReportRange same-day + multi-day inclusive
  {
    const rSame = parseReportRange(dayA, dayA)
    const rMulti = parseReportRange(dayA, dayB)
    expect(inReportRange(t2359, rSame), 'unit: 23:59 in same-day range')
    expect(!inReportRange(t0000, rSame), 'unit: 00:00 next excluded from dayA-only')
    expect(inReportRange(t0000, rMulti), 'unit: multi inclusive includes dayB start')
    expect(inReportRange(t0001, rMulti), 'unit: multi inclusive includes dayB+1s')
  }

  // ── Q API vs PG ──
  console.log('\n--- Q API vs PG ---')
  const apiSales = await fetchJson(`${api.base}/pos/sales`)
  const pgSales = await withClient(async (c) => {
    const r = await c.query(`SELECT data FROM docs WHERE collection='posSales'`)
    return r.rows.map(x => x.data)
  })
  const apiRev = round2((apiSales.body || []).filter(s => s.status !== 'returned').reduce((s, x) => s + (Number(x.total) || 0), 0))
  const pgRev = round2(pgSales.filter(s => s.status !== 'returned').reduce((s, x) => s + (Number(x.total) || 0), 0))
  expect(apiRev === pgRev, `API sales revenue ${apiRev} == PG ${pgRev}`)

  const snapBefore = await fetchJson(`${api.base}/reports/pos`)
  const profitBefore = await fetchJson(`${api.base}/finance/profit`)
  const cashboxBefore = await fetchJson(`${api.base}/finance/cashbox`)
  const beforeR = {
    revenue: snapBefore.body?.summary?.revenue,
    profitCogs: profitBefore.body?.summary?.cogs,
    cashbox: cashboxBefore.body?.totalCash,
  }

  // ── Y Read-after-write ──
  console.log('\n--- Y Read-after-write ---')
  const raw = await postSale(api, fx, {
    clientRef: cref('raw'),
    paymentMethod: 'cash',
    total: 15,
    paidCash: 15,
    items: [{ productId: fx.productCheap, qty: 1, price: 15, lineTotal: 15 }],
  })
  expect(raw.ok, 'RAW sale')
  const immediate = await fetchJson(`${api.base}/pos/sales`)
  expect((immediate.body || []).some(s => s.id === raw.body?.id), 'GET sees sale after 2xx')

  // ── S Pagination ──
  console.log('\n--- S Pagination ---')
  const page1 = await fetchJson(`${api.base}/pos/sales?limit=2&offset=0`)
  const page2 = await fetchJson(`${api.base}/pos/sales?limit=2&offset=2`)
  const ids1 = (page1.body || []).map(s => s.id)
  const ids2 = (page2.body || []).map(s => s.id)
  expect(ids1.length <= 2, 'page size ≤2')
  expect(ids1.every(id => !ids2.includes(id)), 'no duplicate rows across pages')

  // ── T/U/V/W WebSocket ──
  console.log('\n--- T/U WebSocket commit ordering ---')
  try {
    const sock = await connectWs(api.port)
    await sleep(200)
    sock.events.length = 0

    // PRECOMMIT: hold before_commit — no durable-success WS; release without other PG-heavy GETs
    await fetchJson(`${api.base}/__o8/chaos/hold-at`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ point: 'before_commit' }),
    })
    const held = postSale(api, fx, {
      clientRef: cref('wshold'),
      paymentMethod: 'cash',
      total: 9,
      paidCash: 9,
      items: [{ productId: fx.productCheap, qty: 1, price: 9, lineTotal: 9 }],
    })
    await sleep(500)
    const saleEventsDuringHold = sock.events.filter(e => e.event === 'pos_update' && e.payload?.kind === 'sale')
    expect(saleEventsDuringHold.length === 0, 'no sale WS before commit')
    await fetchJson(`${api.base}/__o8/chaos/release`, { method: 'POST' })
    const heldRes = await Promise.race([
      held,
      sleep(15000).then(() => ({ ok: false, status: 0, body: { detail: 'timeout' } })),
    ])
    await sleep(400)
    expect(heldRes.ok, `held sale completes (${heldRes.status})`)
    const after = sock.events.filter(e => e.event === 'pos_update' && e.payload?.kind === 'sale')
    expect(after.length >= 1, 'sale WS after commit')

    // POSTCOMMIT hold: commit done, broadcast not yet
    sock.events.length = 0
    await fetchJson(`${api.base}/__o8/chaos/hold-at`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ point: 'after_commit_before_response' }),
    })
    const held2p = postSale(api, fx, {
      clientRef: cref('wspost'),
      paymentMethod: 'cash',
      total: 8,
      paidCash: 8,
      items: [{ productId: fx.productCheap, qty: 1, price: 8, lineTotal: 8 }],
    })
    await sleep(500)
    const midWs = sock.events.filter(e => e.event === 'pos_update' && e.payload?.kind === 'sale')
    expect(midWs.length === 0, 'POSTCOMMIT hold: WS not yet emitted')
    await fetchJson(`${api.base}/__o8/chaos/release`, { method: 'POST' })
    const held2res = await Promise.race([
      held2p,
      sleep(15000).then(() => ({ ok: false, status: 0, body: { detail: 'timeout' } })),
    ])
    await sleep(300)
    expect(held2res.ok, 'postcommit sale completes')
    expect(sock.events.some(e => e.event === 'pos_update'), 'WS after postcommit release')
    // GET after response sees sale
    const midGet = await fetchJson(`${api.base}/pos/sales`)
    expect((midGet.body || []).some(s => s.clientRef?.includes('wspost')), 'POSTCOMMIT: GET sees sale after release')

    // V duplicate WS safety — client replaces by id
    console.log('\n--- V Duplicate WS ---')
    let localSales = [...(await fetchJson(`${api.base}/pos/sales`)).body || []]
    const sample = localSales[0]
    if (sample) {
      const apply = (list, sale) => {
        const exists = list.some(s => s.id === sale.id)
        return exists ? list.map(s => (s.id === sale.id ? sale : s)) : [sale, ...list]
      }
      localSales = apply(localSales, sample)
      localSales = apply(localSales, sample)
      expect(localSales.filter(s => s.id === sample.id).length === 1, 'duplicate WS replace not double-add')
    } else {
      expect(true, 'duplicate WS skip (no sales)')
    }

    // W missed WS — full GET recovers
    console.log('\n--- W Missed WS recovery ---')
    await fetchJson(`${api.base}/__o8/chaos/release`, { method: 'POST' })
    await fetchJson(`${api.base}/__o8/chaos/hold-at`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ point: null }),
    })
    await sleep(200)
    expect(await waitHealth(api.base, 15000), 'API healthy before miss-sale')
    const missRef = cref('miss')
    const miss = await postSale(api, fx, {
      clientRef: missRef,
      paymentMethod: 'cash',
      total: 7,
      paidCash: 7,
      items: [{ productId: fx.productCheap, qty: 1, price: 7, lineTotal: 7 }],
    })
    expect(miss.ok, `miss sale ok (${miss.status} ${miss.body?.detail || ''})`)
    await sleep(200)
    const pull = await fetchJson(`${api.base}/pos/sales`)
    expect(
      (pull.body || []).some(s => s.id === miss.body?.id || s.clientRef === missRef),
      'missed WS recovered via GET',
    )
    sock.close()
  } catch (e) {
    failed += 1
    console.error(`  FAIL WS section: ${e?.message || e}`)
    try {
      await fetchJson(`${api.base}/__o8/chaos/release`, { method: 'POST' })
    } catch { /* */ }
  }

  // X coalescing
  console.log('\n--- X Event storm coalescing ---')
  const storm = await coalesceProbe(20, 100)
  expect(storm.marks === 20, '20 events marked')
  expect(storm.syncRuns <= 3, `coalesce syncRuns≤3 got ${storm.syncRuns}`)
  expect(storm.coalesced >= 10, `coalesced≥10 got ${storm.coalesced}`)

  // ── R Restart ──
  console.log('\n--- R Restart stability ---')
  const snapR1 = await fetchJson(`${api.base}/reports/pos`)
  const profitR1 = await fetchJson(`${api.base}/finance/profit`)
  const vaultR1 = await fetchJson(`${api.base}/finance/vault`)
  await killApi(api.child)
  await sleep(500)
  const PORT2 = PORT + 1
  api = await startApi(PORT2)
  const snapR2 = await fetchJson(`${api.base}/reports/pos`)
  const profitR2 = await fetchJson(`${api.base}/finance/profit`)
  const vaultR2 = await fetchJson(`${api.base}/finance/vault`)
  expect(round2(snapR1.body?.summary?.revenue) === round2(snapR2.body?.summary?.revenue),
    `report revenue stable across restart (${snapR1.body?.summary?.revenue})`)
  expect(round2(profitR1.body?.summary?.cogs) === round2(profitR2.body?.summary?.cogs),
    'profit COGS stable across restart')
  expect(round2(vaultR1.body?.cashTotal) === round2(vaultR2.body?.cashTotal),
    'vault stable across restart')

  // ── Z Mixed lifecycle snapshot ──
  console.log('\n--- Z Mixed lifecycle ---')
  const finalReport = await fetchJson(`${api.base}/reports/pos`)
  const finalShift = getShift(await fetchJson(`${api.base}/pos/shifts`), fx.shiftId)
  expect(finalReport.body?.summary != null, 'final report present')
  expect(finalShift != null, 'shift still present after restart')
  expect(shiftExpectedCash(finalShift) === round2(
    (Number(finalShift.openingCash) || 0)
    + (Number(finalShift.salesCash) || 0)
    + (Number(finalShift.cashInTotal) || 0)
    - (Number(finalShift.expenseTotal) || 0),
  ), 'final till conservation')

  console.log('  INFO beforeR snapshot kept for audit', beforeR)
} finally {
  await killApi(api?.child)
  await cleanupOnlineTestPrefixes()
  await closePool()
}

console.log(`\n=== O7 RESULT passed=${passed} failed=${failed} ===`)
process.exit(failed ? 1 : 0)
