/**
 * Debt reliability fixes regression (strict receipt, dedupe, shift cash, atomic mirror).
 * Run: node scripts/debt-reliability-fix-test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  applyDebtRepayment,
  addDebtCharge,
  sumDebtLedgerRemaining,
} from '../server/kakapo-api/debtLedger.js'
import {
  uniqueDebtRepayCashForShift,
  overlayShiftSaleTotals,
  expectedTillCashFromShift,
  aggregateShiftSaleTotals,
} from '../lib/shiftSaleTotalsCore.mjs'
import { resolveAuthoritativeCustomerDebt } from '../lib/debtUiProjectionCore.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const results = []

function test(name, fn) {
  try {
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

function mkEntry(id, remaining, orderId, at = '2026-09-01T10:00:00.000Z') {
  return {
    id,
    amount: remaining,
    remaining,
    createdAtIso: at,
    dueAtIso: at,
    source: 'pos',
    orderId,
    saleId: `SALE-${orderId}`,
    desc: `Касса · ${orderId}`,
    createdNotified: true,
  }
}

// ── STRICT RECEIPT ────────────────────────────────────────────
test('5) target remain 100, repay 30 → only target 70', () => {
  const client = {
    phone: '1',
    debt: 150,
    debtLedger: [
      mkEntry('A', 100, 'K-A', '2026-09-01T10:00:00.000Z'),
      mkEntry('B', 50, 'K-B', '2026-09-02T10:00:00.000Z'),
    ],
  }
  const card = { num: 'C1' }
  applyDebtRepayment(client, card, 30, { orderId: 'K-A' })
  expect(r2(client.debtLedger.find(e => e.id === 'A').remaining) === 70, 'A=70')
  expect(r2(client.debtLedger.find(e => e.id === 'B').remaining) === 50, 'B unchanged')
})

test('6) repay 100 → target 0', () => {
  const client = {
    phone: '1', debt: 100,
    debtLedger: [mkEntry('A', 100, 'K-A'), mkEntry('B', 40, 'K-B')],
  }
  applyDebtRepayment(client, { num: 'C' }, 100, { orderId: 'K-A' })
  expect(r2(client.debtLedger.find(e => e.id === 'A').remaining) === 0, 'A=0')
  expect(r2(client.debtLedger.find(e => e.id === 'B').remaining) === 40, 'B=40')
})

test('7) repay 120 → DEBT_RECEIPT_OVERPAY, other untouched', () => {
  const client = {
    phone: '1', debt: 150,
    debtLedger: [mkEntry('A', 100, 'K-A'), mkEntry('B', 50, 'K-B')],
  }
  let code = ''
  try {
    applyDebtRepayment(client, { num: 'C' }, 120, { orderId: 'K-A' })
  } catch (e) {
    code = e.code || ''
  }
  expect(code === 'DEBT_RECEIPT_OVERPAY', `code=${code}`)
  expect(r2(client.debtLedger.find(e => e.id === 'A').remaining) === 100, 'A untouched')
  expect(r2(client.debtLedger.find(e => e.id === 'B').remaining) === 50, 'B untouched')
})

test('8) missing target → DEBT_RECEIPT_NOT_FOUND', () => {
  const client = { phone: '1', debt: 10, debtLedger: [mkEntry('A', 10, 'K-A')] }
  let code = ''
  try {
    applyDebtRepayment(client, { num: 'C' }, 5, { orderId: 'K-MISSING' })
  } catch (e) {
    code = e.code || ''
  }
  expect(code === 'DEBT_RECEIPT_NOT_FOUND', `code=${code}`)
})

test('9) second receipt unchanged in targeted cases', () => {
  const client = {
    phone: '1', debt: 80,
    debtLedger: [mkEntry('A', 30, 'K-A'), mkEntry('B', 50, 'K-B')],
  }
  applyDebtRepayment(client, { num: 'C' }, 30, { orderId: 'K-A' })
  expect(r2(client.debtLedger.find(e => e.id === 'B').remaining) === 50, 'B still 50')
})

test('no orderId → FIFO still works', () => {
  const client = {
    phone: '1', debt: 80,
    debtLedger: [
      mkEntry('A', 30, 'K-A', '2026-09-01T10:00:00.000Z'),
      mkEntry('B', 50, 'K-B', '2026-09-02T10:00:00.000Z'),
    ],
  }
  applyDebtRepayment(client, { num: 'C' }, 40, {})
  expect(r2(client.debtLedger.find(e => e.id === 'A').remaining) === 0, 'A paid first')
  expect(r2(client.debtLedger.find(e => e.id === 'B').remaining) === 40, 'B partial')
})

test('already paid → DEBT_RECEIPT_ALREADY_PAID', () => {
  const client = {
    phone: '1', debt: 50,
    debtLedger: [
      { ...mkEntry('A', 0, 'K-A'), amount: 100, remaining: 0 },
      mkEntry('B', 50, 'K-B'),
    ],
  }
  let code = ''
  try {
    applyDebtRepayment(client, { num: 'C' }, 10, { orderId: 'K-A' })
  } catch (e) {
    code = e.code || ''
  }
  expect(code === 'DEBT_RECEIPT_ALREADY_PAID', `code=${code}`)
})

// ── DEDUPE fingerprint source ─────────────────────────────────
test('10) fingerprint source includes orderId', () => {
  const src = fs.readFileSync(path.join(root, 'lib/offline.ts'), 'utf8')
  expect(src.includes('orderId: string'), 'type has orderId')
  expect(/String\(a\?\.orderId \|\| a\?\.saleId \|\| ''\)\.trim\(\) === b\.orderId/.test(src), 'compare orderId')
  const ops = fs.readFileSync(path.join(root, 'lib/offlinePosOps.ts'), 'utf8')
  expect(ops.includes('String(input.orderId || \'\')'), 'inflight key orderId')
})

test('11) same clientRef path present in findDuplicateDebtRepay', () => {
  const src = fs.readFileSync(path.join(root, 'lib/offline.ts'), 'utf8')
  expect(src.includes('if (clientRef && String(p.clientRef || r.clientRef || \'\') === clientRef) return true'), 'clientRef match')
})

// ── PAY-WITH-SALE plumbing ────────────────────────────────────
test('12) CashierModule pay-with-sale passes orderId', () => {
  const src = fs.readFileSync(path.join(root, 'components/trade/CashierModule.tsx'), 'utf8')
  expect(src.includes('orderId: repayOrderId'), 'passes repayOrderId')
  expect(src.includes('repayTarget?.orderId'), 'uses repayTarget')
})

// ── SHIFT ─────────────────────────────────────────────────────
test('14) debt_repay_cash increases expected till once', () => {
  const shift = {
    id: 'SH-1',
    openingCash: 100,
    salesCash: 0,
    salesCard: 0,
    salesCredit: 0,
    salesCount: 0,
    cashInTotal: 0,
    expenseTotal: 0,
    debtRepayCash: 40,
  }
  const sales = [
    { id: 'S1', clientRef: 'r1', shiftId: 'SH-1', paidCash: 50, paidCard: 0, debtAdded: 0, total: 50 },
  ]
  const over = overlayShiftSaleTotals(shift, sales, [
    { clientRef: 'repay-1', shiftId: 'SH-1', amount: 40, method: 'cash' },
  ])
  expect(r2(over.salesCash) === 50, `sale cash ${over.salesCash}`)
  expect(r2(over.debtRepayCash) === 40, `debtRepayCash ${over.debtRepayCash}`)
  expect(r2(expectedTillCashFromShift(over)) === 190, `till ${expectedTillCashFromShift(over)}`)
})

test('15) duplicate repay clientRef not double-counted', () => {
  const sum = uniqueDebtRepayCashForShift([
    { clientRef: 'r1', shiftId: 'SH-1', amount: 40, method: 'cash' },
    { clientRef: 'r1', shiftId: 'SH-1', amount: 40, method: 'cash' },
    { clientRef: 'r2', shiftId: 'SH-1', amount: 10, method: 'cash' },
  ], 'SH-1')
  expect(sum === 50, `sum=${sum}`)
})

test('16) card repay excluded from debtRepayCash', () => {
  const sum = uniqueDebtRepayCashForShift([
    { clientRef: 'r1', shiftId: 'SH-1', amount: 40, method: 'card' },
    { clientRef: 'r2', shiftId: 'SH-1', amount: 15, method: 'cash' },
  ], 'SH-1')
  expect(sum === 15, `sum=${sum}`)
})

test('17) sale revenue/count unchanged by repayment overlay', () => {
  const sales = [
    { id: 'S1', clientRef: 'a', shiftId: 'SH-1', paidCash: 20, paidCard: 10, debtAdded: 5, total: 35, status: '' },
  ]
  const t = aggregateShiftSaleTotals(sales, 'SH-1')
  expect(t.salesCount === 1, 'count')
  expect(r2(t.salesCash) === 20, 'cash')
  expect(r2(t.salesCard) === 10, 'card')
  expect(r2(t.salesCredit) === 5, 'credit')
})

test('Desktop no longer bumps salesCard on card repay', () => {
  const src = fs.readFileSync(path.join(root, 'lib/offlinePosOps.ts'), 'utf8')
  // Within debtRepaySafe local apply: cash uses debtRepayCash; card must not bump salesCard
  const idx = src.indexOf('export async function debtRepaySafe')
  const end = src.indexOf('export async function', idx + 10)
  const body = src.slice(idx, end > idx ? end : idx + 8000)
  expect(body.includes('debtRepayCash:'), 'uses debtRepayCash')
  expect(!body.includes('salesCard:'), `unexpected salesCard in debtRepaySafe`)
})

test('durable debtRepayCash ledger wired (ACK/sync survive)', () => {
  const ops = fs.readFileSync(path.join(root, 'lib/offlinePosOps.ts'), 'utf8')
  const cash = fs.readFileSync(path.join(root, 'components/trade/CashierModule.tsx'), 'utf8')
  const pos = fs.readFileSync(path.join(root, 'lib/posStore.ts'), 'utf8')
  const pull = fs.readFileSync(path.join(root, 'lib/syncPull.ts'), 'utf8')
  expect(ops.includes('rememberCashDebtRepay'), 'remember on repay')
  expect(cash.includes('overlayShiftSaleTotalsWithDebtRepay'), 'cashier ledger overlay')
  expect(pos.includes('withPreservedDebtRepayCash'), 'softSync preserve')
  expect(pull.includes('withPreservedDebtRepayCash'), 'syncPull preserve')
  const journal = fs.readFileSync(path.join(root, 'lib/debtRepayCashJournal.ts'), 'utf8')
  const journalCore = fs.readFileSync(path.join(root, 'lib/debtRepayCashJournalCore.mjs'), 'utf8')
  expect(journal.includes('getFinanceJournal'), 'journal backfill module')
  expect(journalCore.includes('pickActiveOpenShift'), 'active open shift picker')
  expect(journal.includes('lastShiftId'), 'shift-aware coalesce')
  expect(pos.includes('scheduleDebtRepayCashJournalHydrate'), 'journal on softSync')
})

// ── UI / atomic wiring ────────────────────────────────────────
test('18) cashier uses resolveAuthoritativeCustomerDebt', () => {
  const src = fs.readFileSync(path.join(root, 'components/trade/CashierModule.tsx'), 'utf8')
  expect(src.includes('resolveAuthoritativeCustomerDebt'), 'import/use')
})

test('19) zero ledger + old debtAdded → 0', () => {
  const d = resolveAuthoritativeCustomerDebt({
    clientDebt: 0,
    cardDebt: 999,
    debtLedger: [{ remaining: 0 }],
  })
  expect(d === 0, `d=${d}`)
})

test('20) DebtsModule and Cashier share core resolver', () => {
  const debts = fs.readFileSync(path.join(root, 'components/trade/DebtsModule.tsx'), 'utf8')
  const cash = fs.readFileSync(path.join(root, 'components/trade/CashierModule.tsx'), 'utf8')
  expect(debts.includes('resolveAuthoritativeCustomerDebt'), 'debts')
  expect(cash.includes('resolveAuthoritativeCustomerDebt'), 'cashier')
})

test('atomic sqlDebtRepayCommit present', () => {
  const localDb = fs.readFileSync(path.join(root, 'desktop/localDb.cjs'), 'utf8')
  expect(localDb.includes('function sqlDebtRepayCommit'), 'fn')
  expect(localDb.includes('db.transaction'), 'tx')
  expect(localDb.includes('desktop:localDbDebtRepayCommit'), 'ipc')
  const preload = fs.readFileSync(path.join(root, 'desktop/preload.cjs'), 'utf8')
  expect(preload.includes('localDbDebtRepayCommit'), 'preload')
  const atomic = fs.readFileSync(path.join(root, 'lib/localDebtRepayAtomic.ts'), 'utf8')
  expect(atomic.includes('commitLocalDebtRepayAtomic'), 'bridge helper')
  const ops = fs.readFileSync(path.join(root, 'lib/offlinePosOps.ts'), 'utf8')
  expect(ops.includes('canAtomicLocalDebtRepayCommit'), 'wired')
})

test('charge + repay still compose', () => {
  const client = { phone: '9', debt: 0, debtLedger: [] }
  const card = { num: 'X' }
  addDebtCharge(client, card, { amount: 80, orderId: 'K-1', saleId: 'S-1' })
  client.debt = 80
  applyDebtRepayment(client, card, 25, { orderId: 'K-1', saleId: 'S-1' })
  expect(sumDebtLedgerRemaining(client.debtLedger) === 55, 'rem 55')
})

// ── CASH ADVANCE LEGACY TARGET + SERVER LEDGER ID ─────────────
function mkCashAdv(id, remaining, at = '2026-09-13T12:00:00.000Z') {
  return {
    id,
    amount: remaining,
    remaining,
    createdAtIso: at,
    dueAtIso: at,
    source: 'cash_advance',
    desc: 'Выдача наличных в долг',
    createdNotified: true,
  }
}

test('CA-1) exact match by server debtLedger.id (DL-…)', () => {
  const client = {
    phone: '1',
    debt: 486.7,
    debtLedger: [mkCashAdv('DL-1789309389399-c099', 486.7)],
  }
  applyDebtRepayment(client, { num: 'C' }, 486.7, { orderId: 'DL-1789309389399-c099' })
  expect(r2(client.debtLedger[0].remaining) === 0, 'paid')
})

test('CA-2) exact match by ldg-DL-… prefix', () => {
  const client = {
    phone: '1',
    debt: 486.7,
    debtLedger: [mkCashAdv('DL-1789309389399-c099', 486.7)],
  }
  applyDebtRepayment(client, { num: 'C' }, 486.7, { orderId: 'ldg-DL-1789309389399-c099' })
  expect(r2(client.debtLedger[0].remaining) === 0, 'paid via ldg prefix')
})

test('CA-3) legacy cash-* key → fallback exactly 1 cash_advance', () => {
  const client = {
    phone: '1',
    debt: 912.24,
    debtLedger: [
      mkCashAdv('DL-1789309389399-c099', 486.7),
      { ...mkCashAdv('DL-REPAIR-HOLOV-BASE-320.04', 320.04, '2026-09-12T10:00:00.000Z'), source: 'backfill' },
    ],
  }
  applyDebtRepayment(client, { num: 'C' }, 486.7, { orderId: 'cash-log-DL-1789309380388-J-99' })
  expect(r2(client.debtLedger.find(e => e.id === 'DL-1789309389399-c099').remaining) === 0, 'CA paid')
  expect(r2(client.debtLedger.find(e => e.id === 'DL-REPAIR-HOLOV-BASE-320.04').remaining) === 320.04, 'other untouched')
})

test('CA-4) legacy cash-* key → 0 matches → DEBT_RECEIPT_NOT_FOUND', () => {
  const client = {
    phone: '1',
    debt: 100,
    debtLedger: [mkCashAdv('DL-X', 50)],
  }
  let code = ''
  try {
    applyDebtRepayment(client, { num: 'C' }, 486.7, { orderId: 'cash-old-key' })
  } catch (e) {
    code = e.code || ''
  }
  expect(code === 'DEBT_RECEIPT_NOT_FOUND', `code=${code}`)
  expect(r2(client.debtLedger[0].remaining) === 50, 'unchanged')
})

test('CA-5) legacy cash-* key → >1 cash_advance same amount → DEBT_RECEIPT_AMBIGUOUS', () => {
  const client = {
    phone: '1',
    debt: 973.4,
    debtLedger: [
      mkCashAdv('DL-A', 486.7, '2026-09-10T10:00:00.000Z'),
      mkCashAdv('DL-B', 486.7, '2026-09-11T10:00:00.000Z'),
    ],
  }
  let code = ''
  try {
    applyDebtRepayment(client, { num: 'C' }, 486.7, { orderId: 'cash-legacy-dup' })
  } catch (e) {
    code = e.code || ''
  }
  expect(code === 'DEBT_RECEIPT_AMBIGUOUS', `code=${code}`)
  expect(r2(client.debtLedger.find(e => e.id === 'DL-A').remaining) === 486.7, 'A untouched')
  expect(r2(client.debtLedger.find(e => e.id === 'DL-B').remaining) === 486.7, 'B untouched')
})

test('CA-6) repeat same targeted repay → DEBT_RECEIPT_ALREADY_PAID', () => {
  const client = {
    phone: '1',
    debt: 486.7,
    debtLedger: [mkCashAdv('DL-1789309389399-c099', 486.7)],
  }
  applyDebtRepayment(client, { num: 'C' }, 486.7, { orderId: 'DL-1789309389399-c099' })
  let code = ''
  try {
    applyDebtRepayment(client, { num: 'C' }, 486.7, { orderId: 'DL-1789309389399-c099' })
  } catch (e) {
    code = e.code || ''
  }
  expect(code === 'DEBT_RECEIPT_ALREADY_PAID', `code=${code}`)
})

test('CA-7) wrong amount on legacy key → NOT_FOUND (no partial FIFO)', () => {
  const client = {
    phone: '1',
    debt: 486.7,
    debtLedger: [mkCashAdv('DL-1789309389399-c099', 486.7)],
  }
  let code = ''
  try {
    applyDebtRepayment(client, { num: 'C' }, 400, { orderId: 'cash-log-DL-old' })
  } catch (e) {
    code = e.code || ''
  }
  expect(code === 'DEBT_RECEIPT_NOT_FOUND', `code=${code}`)
  expect(r2(client.debtLedger[0].remaining) === 486.7, 'unchanged')
})

test('CA-8) pos source same amount not picked by cash_advance fallback', () => {
  const client = {
    phone: '1',
    debt: 973.4,
    debtLedger: [
      { ...mkCashAdv('DL-POS', 486.7), source: 'pos', orderId: 'K-9649' },
      mkCashAdv('DL-CA', 486.7, '2026-09-11T10:00:00.000Z'),
    ],
  }
  applyDebtRepayment(client, { num: 'C' }, 486.7, { orderId: 'cash-legacy-single-ca' })
  expect(r2(client.debtLedger.find(e => e.id === 'DL-CA').remaining) === 0, 'only CA paid')
  expect(r2(client.debtLedger.find(e => e.id === 'DL-POS').remaining) === 486.7, 'pos untouched')
})

test('CA-9) offline queue keeps debt_repay on DEBT_RECEIPT errors', () => {
  const src = fs.readFileSync(path.join(root, 'lib/offline.ts'), 'utf8')
  expect(src.includes('debtReceiptSyncErr'), 'sync err guard')
  expect(src.includes('DEBT_RECEIPT_NOT_FOUND'), 'NOT_FOUND guard')
  expect(src.includes('DEBT_RECEIPT_AMBIGUOUS'), 'AMBIGUOUS guard')
  expect(src.includes('Чек долга не найден'), 'ru guard')
  const rejectIdx = src.indexOf('const rejectRe =')
  const rejectLine = src.slice(rejectIdx, rejectIdx + 600)
  expect(!rejectLine.includes('чек не найден'), 'rejectRe must not auto-revert debt receipt sync errors')
})

test('CA-10) cashDebtOrderId uses server ledger id, not cash-local', () => {
  const vip = fs.readFileSync(path.join(root, 'lib/clientVipCredit.ts'), 'utf8')
  expect(vip.includes('Не синтезирует fake cash-${localId}'), 'doc')
  expect(!vip.includes('return id ? `cash-${id}`'), 'no cash- synthesis')
  expect(vip.includes("rawId.startsWith(LEDGER_DEBT_PREFIX)"), 'ldg strip')
})

const failed = results.filter(r => r.status === 'FAIL')
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.log(JSON.stringify(failed, null, 2))
  process.exit(1)
}
