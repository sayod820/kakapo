/**
 * Server journal → durable cash debtRepayCash backfill (1.2.182).
 * Run: node scripts/debt-repay-cash-journal-test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyCashDebtRepayJournalRows,
  filterCashDebtRepayJournalForShift,
  isCashDebtRepayJournalRow,
  journalDebtRepayDedupeKey,
  journalRowToLedgerEntry,
} from '../lib/debtRepayCashJournalCore.mjs'
import {
  rememberCashDebtRepay,
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

const LIVE_SHIFT = 'SHIFT-mtxsgiqx-cvp3g'
const LIVE_REF = '5ef1db5e-3760-4094-85cb-c506549e74e5'
const LIVE_LED = 'LED-mtxz2mvv-dycv2'
const LIVE_SALE_CASH = 994.18
const LIVE_SALE_CARD = 72.9
const LIVE_SALE_COUNT = 54
const LIVE_EXPENSE = 224.5
const LIVE_REPAY = 2
const LIVE_TILL = 771.68

const liveJournalRow = {
  id: LIVE_LED,
  createdAtIso: '2026-09-12T05:56:31.195Z',
  type: 'debt_repay_cash',
  amount: 2,
  direction: 'in',
  signedAmount: 2,
  cashAffect: true,
  shiftId: LIVE_SHIFT,
  clientRef: LIVE_REF,
  note: 'Погашение · Чек №8819 · Ромис',
  reason: 'Погашение долга нал · Ромис',
  meta: { method: 'cash', cardNum: 'КАКАПО-0036', clientName: 'Ромис', clientRef: LIVE_REF },
}

function mkLiveSales() {
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

function displayOverlay(shift, sales) {
  const rows = [
    ...loadDebtRepayCashLedger()
      .filter(r => String(r.shiftId) === String(shift.id))
      .map(r => ({ clientRef: r.clientRef, shiftId: r.shiftId, amount: r.amount, method: 'cash' })),
  ]
  const preserved = withPreservedDebtRepayCash(shift, shift)
  return overlayShiftSaleTotals(preserved, sales, rows)
}

test('1) live fixture journal 2.00 → expectedTill 771.68', () => {
  applyCashDebtRepayJournalRows([liveJournalRow], LIVE_SHIFT, rememberCashDebtRepay)
  const remote = {
    id: LIVE_SHIFT,
    openingCash: 0,
    salesCash: LIVE_SALE_CASH + LIVE_REPAY,
    salesCount: LIVE_SALE_COUNT,
    salesCard: LIVE_SALE_CARD,
    expenseTotal: LIVE_EXPENSE,
    cashInTotal: 0,
  }
  const over = displayOverlay(withPreservedDebtRepayCash(remote, remote), mkLiveSales())
  expect(r2(over.salesCash) === LIVE_SALE_CASH, `saleCash=${over.salesCash}`)
  expect(over.salesCount === LIVE_SALE_COUNT, `count=${over.salesCount}`)
  expect(r2(over.salesCard) === LIVE_SALE_CARD, `card=${over.salesCard}`)
  expect(r2(over.debtRepayCash) === LIVE_REPAY, `repay=${over.debtRepayCash}`)
  expect(r2(expectedTillCashFromShift(over)) === LIVE_TILL, `till=${expectedTillCashFromShift(over)}`)
})

test('2) already-ACKed absent locally → journal restores 2.00', () => {
  expect(uniqueCashDebtRepayTotalForShift(LIVE_SHIFT) === 0, 'empty')
  applyCashDebtRepayJournalRows([liveJournalRow], LIVE_SHIFT, rememberCashDebtRepay)
  expect(r2(uniqueCashDebtRepayTotalForShift(LIVE_SHIFT)) === 2, 'restored')
})

test('3) local + server same repay → once', () => {
  rememberCashDebtRepay({
    clientRef: LIVE_REF,
    shiftId: LIVE_SHIFT,
    amount: 2,
    method: 'cash',
  })
  applyCashDebtRepayJournalRows([liveJournalRow], LIVE_SHIFT, rememberCashDebtRepay)
  expect(r2(uniqueCashDebtRepayTotalForShift(LIVE_SHIFT)) === 2, 'once')
})

test('4) retry journal fetch → still once', () => {
  applyCashDebtRepayJournalRows([liveJournalRow], LIVE_SHIFT, rememberCashDebtRepay)
  applyCashDebtRepayJournalRows([liveJournalRow, liveJournalRow], LIVE_SHIFT, rememberCashDebtRepay)
  expect(r2(uniqueCashDebtRepayTotalForShift(LIVE_SHIFT)) === 2, 'once')
  expect(filterCashDebtRepayJournalForShift([liveJournalRow, liveJournalRow], LIVE_SHIFT).length === 1, 'filter dedupe')
})

test('5) restart KV then journal → once', () => {
  applyCashDebtRepayJournalRows([liveJournalRow], LIVE_SHIFT, rememberCashDebtRepay)
  const snap = loadDebtRepayCashLedger().slice()
  _resetDebtRepayCashLedgerForTests()
  replaceDebtRepayCashLedger(snap)
  applyCashDebtRepayJournalRows([liveJournalRow], LIVE_SHIFT, rememberCashDebtRepay)
  expect(r2(uniqueCashDebtRepayTotalForShift(LIVE_SHIFT)) === 2, 'once after restart+journal')
})

test('6) offline repayment counts immediately', () => {
  rememberCashDebtRepay({
    clientRef: 'offline-ref',
    shiftId: 'SH-OFF',
    amount: 15,
    method: 'cash',
  })
  expect(r2(uniqueCashDebtRepayTotalForShift('SH-OFF')) === 15, 'local immediate')
})

test('7) reconnect server row later → no duplicate', () => {
  rememberCashDebtRepay({
    clientRef: LIVE_REF,
    shiftId: LIVE_SHIFT,
    amount: 2,
    method: 'cash',
  })
  // later journal appears
  applyCashDebtRepayJournalRows([liveJournalRow], LIVE_SHIFT, rememberCashDebtRepay)
  expect(r2(uniqueCashDebtRepayTotalForShift(LIVE_SHIFT)) === 2, 'no dup')
})

test('8) card repayment ignored', () => {
  const card = {
    ...liveJournalRow,
    id: 'LED-card',
    clientRef: 'card-ref',
    type: 'debt_repay_card',
    meta: { method: 'card' },
  }
  expect(isCashDebtRepayJournalRow(card) === false, 'not cash')
  applyCashDebtRepayJournalRows([card], LIVE_SHIFT, rememberCashDebtRepay)
  expect(uniqueCashDebtRepayTotalForShift(LIVE_SHIFT) === 0, 'ignored')
})

test('9) missing clientRef → fallback LED-* id', () => {
  const row = {
    id: 'LED-no-ref',
    type: 'debt_repay_cash',
    amount: 3,
    shiftId: 'SH-FALL',
    meta: { method: 'cash' },
  }
  expect(journalDebtRepayDedupeKey(row) === 'LED-no-ref', 'fallback id')
  applyCashDebtRepayJournalRows([row], 'SH-FALL', rememberCashDebtRepay)
  expect(r2(uniqueCashDebtRepayTotalForShift('SH-FALL')) === 3, 'applied via id')
  const entry = journalRowToLedgerEntry(row)
  expect(entry.clientRef === 'LED-no-ref', 'entry key')
})

test('10) same amount different refs → both count', () => {
  applyCashDebtRepayJournalRows([
    { id: 'LED-a', clientRef: 'a', type: 'debt_repay_cash', amount: 2, shiftId: 'SH-X', meta: { method: 'cash' } },
    { id: 'LED-b', clientRef: 'b', type: 'debt_repay_cash', amount: 2, shiftId: 'SH-X', meta: { method: 'cash' } },
  ], 'SH-X', rememberCashDebtRepay)
  expect(r2(uniqueCashDebtRepayTotalForShift('SH-X')) === 4, 'both')
})

test('11) wrong shiftId ignored', () => {
  applyCashDebtRepayJournalRows([liveJournalRow], 'SHIFT-other', rememberCashDebtRepay)
  expect(uniqueCashDebtRepayTotalForShift(LIVE_SHIFT) === 0, 'wrong shift')
  expect(uniqueCashDebtRepayTotalForShift('SHIFT-other') === 0, 'row shift mismatch filter')
})

test('12) journal fetch failure leaves local ledger', () => {
  rememberCashDebtRepay({
    clientRef: 'keep-me',
    shiftId: 'SH-KEEP',
    amount: 9,
    method: 'cash',
  })
  // Simulate failed fetch: apply empty / no call — ledger intact
  applyCashDebtRepayJournalRows([], 'SH-KEEP', rememberCashDebtRepay)
  expect(r2(uniqueCashDebtRepayTotalForShift('SH-KEEP')) === 9, 'retained')
})

test('13+14) sale count/revenue/card unchanged', () => {
  applyCashDebtRepayJournalRows([liveJournalRow], LIVE_SHIFT, rememberCashDebtRepay)
  const sales = mkLiveSales()
  const t = aggregateShiftSaleTotals(sales, LIVE_SHIFT)
  const over = displayOverlay({
    id: LIVE_SHIFT,
    openingCash: 0,
    salesCount: 999,
    salesCash: 9999,
    salesCard: 999,
    expenseTotal: LIVE_EXPENSE,
    cashInTotal: 0,
  }, sales)
  expect(over.salesCount === t.salesCount && over.salesCount === LIVE_SALE_COUNT, 'count')
  expect(r2(over.salesCash) === LIVE_SALE_CASH, 'cash')
  expect(r2(over.salesCard) === LIVE_SALE_CARD, 'card')
})

test('wiring: journal hydrate scheduled at lifecycle points', () => {
  const j = fs.readFileSync(path.join(root, 'lib/debtRepayCashJournal.ts'), 'utf8')
  const hydrate = fs.readFileSync(path.join(root, 'lib/offlineHydrate.ts'), 'utf8')
  const pos = fs.readFileSync(path.join(root, 'lib/posStore.ts'), 'utf8')
  const pull = fs.readFileSync(path.join(root, 'lib/syncPull.ts'), 'utf8')
  const sync = fs.readFileSync(path.join(root, 'lib/offlineSync.ts'), 'utf8')
  expect(j.includes('getFinanceJournal'), 'uses finance journal API')
  expect(j.includes("type: 'debt_repay_cash'") || j.includes('debt_repay_cash'), 'type filter')
  expect(hydrate.includes('scheduleDebtRepayCashJournalHydrate'), 'bootstrap')
  expect(pos.includes('scheduleDebtRepayCashJournalHydrate'), 'softSync')
  expect(pull.includes('scheduleDebtRepayCashJournalHydrate'), 'syncPull')
  expect(sync.includes('scheduleDebtRepayCashJournalHydrate'), 'reconnect/refetch')
})

test('desktop version 1.2.182', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'desktop/package.json'), 'utf8'))
  expect(pkg.version === '1.2.182', `ver=${pkg.version}`)
})

const failed = results.filter(r => r.status === 'FAIL')
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.log(JSON.stringify(failed, null, 2))
  process.exit(1)
}
