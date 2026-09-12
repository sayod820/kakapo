/**
 * Durable cash debtRepayCash ledger — ACK/sync/restart undercount fix.
 * Live fixture: SHIFT-mtxsgiqx-cvp3g math (copy only; no production DB writes).
 * Run: node scripts/debt-repay-cash-ledger-test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  rememberCashDebtRepay,
  forgetCashDebtRepay,
  cashDebtRepayRowsForShift,
  uniqueCashDebtRepayTotalForShift,
  withPreservedDebtRepayCash,
  replaceDebtRepayCashLedger,
  loadDebtRepayCashLedger,
  _resetDebtRepayCashLedgerForTests,
} from '../lib/debtRepayCashLedgerCore.mjs'
import {
  overlayShiftSaleTotals,
  expectedTillCashFromShift,
  aggregateShiftSaleTotals,
} from '../lib/shiftSaleTotalsCore.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const results = []

function test(name, fn) {
  try {
    _resetDebtRepayCashLedgerForTests()
    fn()
    results.push({ name, status: 'PASS' })
    console.log(`PASS  ${name}`)
  } catch (e) {
    results.push({ name, status: 'FAIL', error: String(e?.message || e) })
    console.error(`FAIL  ${name}:`, e?.message || e)
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg || 'assert')
}
function r2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

/** Live shift snapshot (fixture copy) — SHIFT-mtxsgiqx-cvp3g */
const LIVE_SHIFT = 'SHIFT-mtxsgiqx-cvp3g'
const LIVE_SALE_CASH = 994.18
const LIVE_SALE_CARD = 72.9
const LIVE_SALE_COUNT = 54
const LIVE_EXPENSE = 224.5
const LIVE_OPENING = 0
const LIVE_REPAY = 2
const LIVE_TILL = 771.68
const LIVE_REF = 'debt-repay-K-8820-8819'

function mkLiveSales() {
  // Aggregate-equivalent stub: one row with cash/card totals matching live overlay
  const sales = []
  for (let i = 0; i < LIVE_SALE_COUNT - 1; i++) {
    sales.push({
      id: `SALE-live-${i}`,
      clientRef: `live-ref-${i}`,
      shiftId: LIVE_SHIFT,
      total: 0,
      paidCash: 0,
      paidCard: 0,
      debtAdded: 0,
    })
  }
  sales.push({
    id: 'SALE-live-cash-card',
    clientRef: 'live-ref-totals',
    shiftId: LIVE_SHIFT,
    total: LIVE_SALE_CASH + LIVE_SALE_CARD,
    paidCash: LIVE_SALE_CASH,
    paidCard: LIVE_SALE_CARD,
    debtAdded: 0,
  })
  return sales
}

function displayOverlay(shift, sales, extraRows) {
  const rows = [
    ...cashDebtRepayRowsForShift(String(shift.id || '')),
    ...(extraRows || []),
  ]
  const preserved = withPreservedDebtRepayCash(shift, shift)
  return overlayShiftSaleTotals(preserved, sales, rows)
}

test('cash repay before ACK → counted once', () => {
  rememberCashDebtRepay({
    clientRef: 'ref-pre-ack',
    shiftId: 'SH-A',
    amount: 2,
    method: 'cash',
  })
  const shift = {
    id: 'SH-A',
    openingCash: 0,
    salesCash: 100,
    salesCard: 0,
    salesCount: 1,
    expenseTotal: 0,
    cashInTotal: 0,
    debtRepayCash: 2,
  }
  const sales = [
    { id: 'S1', clientRef: 's1', shiftId: 'SH-A', paidCash: 100, paidCard: 0, debtAdded: 0, total: 100 },
  ]
  // Pending outbox still present as extra row
  const over = displayOverlay(shift, sales, [
    { clientRef: 'ref-pre-ack', shiftId: 'SH-A', amount: 2, method: 'cash' },
  ])
  expect(r2(over.debtRepayCash) === 2, `repay=${over.debtRepayCash}`)
  expect(r2(over.salesCash) === 100, `cash=${over.salesCash}`)
  expect(over.salesCount === 1, 'count')
  expect(r2(expectedTillCashFromShift(over)) === 102, `till=${expectedTillCashFromShift(over)}`)
})

test('cash repay after ACK/outbox deletion → still counted once', () => {
  rememberCashDebtRepay({
    clientRef: 'ref-post-ack',
    shiftId: 'SH-B',
    amount: 2,
    method: 'cash',
  })
  // Soft-sync wipe: server shift has no debtRepayCash; denorm salesCash includes +2
  const remote = {
    id: 'SH-B',
    openingCash: 0,
    salesCash: 102, // denorm includes repay (legacy)
    salesCard: 0,
    salesCount: 1,
    expenseTotal: 0,
    cashInTotal: 0,
  }
  const local = { ...remote, debtRepayCash: 2 }
  const merged = withPreservedDebtRepayCash(local, remote)
  expect(r2(merged.debtRepayCash) === 2, `preserved=${merged.debtRepayCash}`)
  const sales = [
    { id: 'S1', clientRef: 's1', shiftId: 'SH-B', paidCash: 100, paidCard: 0, debtAdded: 0, total: 100 },
  ]
  // No outbox repayRows after ACK
  const over = displayOverlay(merged, sales, [])
  expect(r2(over.salesCash) === 100, 'sale rows only')
  expect(r2(over.debtRepayCash) === 2, 'ledger reconstruct')
  expect(r2(expectedTillCashFromShift(over)) === 102, 'till')
})

test('restart → still counted once (hydrate ledger)', () => {
  rememberCashDebtRepay({
    clientRef: 'ref-restart',
    shiftId: 'SH-C',
    amount: 5,
    method: 'cash',
  })
  const snap = loadDebtRepayCashLedger().slice()
  _resetDebtRepayCashLedgerForTests()
  expect(uniqueCashDebtRepayTotalForShift('SH-C') === 0, 'cleared')
  replaceDebtRepayCashLedger(snap) // KV hydrate
  expect(r2(uniqueCashDebtRepayTotalForShift('SH-C')) === 5, 'hydrated')
  const over = displayOverlay(
    { id: 'SH-C', openingCash: 10, salesCash: 0, expenseTotal: 0, cashInTotal: 0 },
    [],
    [],
  )
  expect(r2(over.debtRepayCash) === 5, 'after restart')
  expect(r2(expectedTillCashFromShift(over)) === 15, 'till')
})

test('duplicate ACK → still once', () => {
  const entry = { clientRef: 'ref-dup', shiftId: 'SH-D', amount: 7, method: 'cash' }
  rememberCashDebtRepay(entry)
  rememberCashDebtRepay(entry)
  rememberCashDebtRepay({ ...entry, amount: 7 })
  expect(r2(uniqueCashDebtRepayTotalForShift('SH-D')) === 7, 'once')
  expect(cashDebtRepayRowsForShift('SH-D').length === 1, 'one row')
})

test('same cash repay local + remote projection → still once', () => {
  rememberCashDebtRepay({
    clientRef: 'ref-both',
    shiftId: 'SH-E',
    amount: 3,
    method: 'cash',
  })
  const shift = {
    id: 'SH-E',
    openingCash: 0,
    debtRepayCash: 3,
    salesCash: 0,
    expenseTotal: 0,
    cashInTotal: 0,
  }
  const over = displayOverlay(shift, [], [
    { clientRef: 'ref-both', shiftId: 'SH-E', amount: 3, method: 'cash' },
  ])
  expect(r2(over.debtRepayCash) === 3, `once=${over.debtRepayCash}`)
})

test('card repay → 0 cash effect', () => {
  const ok = rememberCashDebtRepay({
    clientRef: 'ref-card',
    shiftId: 'SH-F',
    amount: 50,
    method: 'card',
  })
  expect(ok === false, 'ignored')
  expect(uniqueCashDebtRepayTotalForShift('SH-F') === 0, 'zero')
  const over = displayOverlay(
    { id: 'SH-F', openingCash: 0, salesCash: 10, expenseTotal: 0, cashInTotal: 0 },
    [{ id: 'S', clientRef: 's', shiftId: 'SH-F', paidCash: 10, paidCard: 0, debtAdded: 0, total: 10 }],
    [{ clientRef: 'ref-card', shiftId: 'SH-F', amount: 50, method: 'card' }],
  )
  expect(r2(over.debtRepayCash) === 0, 'no card in till')
  expect(r2(over.salesCash) === 10, 'sale cash')
  expect(r2(expectedTillCashFromShift(over)) === 10, 'till')
})

test('sale count/revenue unchanged by repay', () => {
  rememberCashDebtRepay({
    clientRef: 'ref-sale',
    shiftId: 'SH-G',
    amount: 2,
    method: 'cash',
  })
  const sales = [
    { id: 'S1', clientRef: 'a', shiftId: 'SH-G', paidCash: 20, paidCard: 10, debtAdded: 5, total: 35 },
    { id: 'S2', clientRef: 'b', shiftId: 'SH-G', paidCash: 5, paidCard: 0, debtAdded: 0, total: 5 },
  ]
  const t = aggregateShiftSaleTotals(sales, 'SH-G')
  const over = displayOverlay(
    { id: 'SH-G', openingCash: 0, salesCount: 99, salesCash: 999, salesCard: 99, expenseTotal: 0, cashInTotal: 0 },
    sales,
    [],
  )
  expect(over.salesCount === t.salesCount && over.salesCount === 2, 'count from sales')
  expect(r2(over.salesCash) === 25, 'cash from sales')
  expect(r2(over.salesCard) === 10, 'card from sales')
  expect(r2(over.debtRepayCash) === 2, 'repay separate')
})

test('same amount on different receipts → both count', () => {
  rememberCashDebtRepay({ clientRef: 'r-A', shiftId: 'SH-H', amount: 2, method: 'cash', orderId: 'K-1' })
  rememberCashDebtRepay({ clientRef: 'r-B', shiftId: 'SH-H', amount: 2, method: 'cash', orderId: 'K-2' })
  expect(r2(uniqueCashDebtRepayTotalForShift('SH-H')) === 4, 'both')
})

test('forget on revert removes till effect', () => {
  rememberCashDebtRepay({ clientRef: 'r-rev', shiftId: 'SH-I', amount: 9, method: 'cash' })
  forgetCashDebtRepay('r-rev')
  expect(uniqueCashDebtRepayTotalForShift('SH-I') === 0, 'forgotten')
})

test('LIVE FIXTURE: expected till 771.68; sale cash 994.18; count 54; card 72.90', () => {
  rememberCashDebtRepay({
    clientRef: LIVE_REF,
    shiftId: LIVE_SHIFT,
    amount: LIVE_REPAY,
    method: 'cash',
    orderId: 'K-8820',
  })
  // Post-ACK wipe like production softSync
  const remote = {
    id: LIVE_SHIFT,
    status: 'open',
    openingCash: LIVE_OPENING,
    salesCount: LIVE_SALE_COUNT,
    salesCash: LIVE_SALE_CASH + LIVE_REPAY, // denorm 996.18
    salesCard: LIVE_SALE_CARD,
    salesCredit: 0,
    expenseTotal: LIVE_EXPENSE,
    cashInTotal: 0,
  }
  const merged = withPreservedDebtRepayCash(
    { ...remote, debtRepayCash: LIVE_REPAY },
    remote,
  )
  const sales = mkLiveSales()
  const over = displayOverlay(merged, sales, [])
  expect(r2(over.salesCash) === LIVE_SALE_CASH, `saleCash=${over.salesCash}`)
  expect(over.salesCount === LIVE_SALE_COUNT, `count=${over.salesCount}`)
  expect(r2(over.salesCard) === LIVE_SALE_CARD, `card=${over.salesCard}`)
  expect(r2(over.debtRepayCash) === LIVE_REPAY, `repay=${over.debtRepayCash}`)
  const till = expectedTillCashFromShift(over)
  expect(r2(till) === LIVE_TILL, `till=${till} want ${LIVE_TILL}`)
  expect(
    r2(LIVE_SALE_CASH + LIVE_REPAY - LIVE_EXPENSE) === LIVE_TILL,
    '994.18 + 2.00 - 224.50 = 771.68',
  )
})

test('wiring: Cashier uses overlayShiftSaleTotalsWithDebtRepay', () => {
  const src = fs.readFileSync(path.join(root, 'components/trade/CashierModule.tsx'), 'utf8')
  expect(src.includes('overlayShiftSaleTotalsWithDebtRepay'), 'cashier overlay')
  expect(!src.includes('overlayShiftSaleTotals(raw'), 'no bare overlay without ledger')
})

test('wiring: softSync + syncPull preserve debtRepayCash', () => {
  const pos = fs.readFileSync(path.join(root, 'lib/posStore.ts'), 'utf8')
  const pull = fs.readFileSync(path.join(root, 'lib/syncPull.ts'), 'utf8')
  const ops = fs.readFileSync(path.join(root, 'lib/offlinePosOps.ts'), 'utf8')
  expect(pos.includes('withPreservedDebtRepayCash'), 'posStore preserve')
  expect(pos.includes('hydrateDebtRepayCashLedger'), 'hydrate on softSync')
  expect(pull.includes('withPreservedDebtRepayCash'), 'syncPull preserve')
  expect(ops.includes('rememberCashDebtRepay'), 'remember on repay')
  const hydrate = fs.readFileSync(path.join(root, 'lib/offlineHydrate.ts'), 'utf8')
  expect(hydrate.includes('hydrateDebtRepayCashLedger'), 'hydrate on POS bootstrap')
  expect(hydrate.includes('scheduleDebtRepayCashJournalHydrate'), 'journal backfill on bootstrap')
  expect(pos.includes('scheduleDebtRepayCashJournalHydrate'), 'journal on softSync')
})

const failed = results.filter(r => r.status === 'FAIL')
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.log(JSON.stringify(failed, null, 2))
  process.exit(1)
}
