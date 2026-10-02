/**
 * Закрытие смены: авто-сверка кассы («Всё совпало») не должна перекрывать серверную недостачу.
 * Погашение долга нал входит в ожидаемые наличные и на сервере, и на кассе.
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { closePosShift, repairAutoReconcileShiftNotes, recomputeClosedShiftReconcile, applyDebtRepayToShift } = await import(pathToFileURL(path.join(root, 'server/kakapo-api/posLogic.js')).href)
const { expectedTillCashFromShift, overlayShiftSaleTotals } = await import(pathToFileURL(path.join(root, 'lib/shiftSaleTotalsCore.mjs')).href)
const { rememberCashDebtRepay, remapCashDebtRepayShiftId, cashDebtRepayRowsForShift, _resetDebtRepayCashLedgerForTests } = await import(pathToFileURL(path.join(root, 'lib/debtRepayCashLedgerCore.mjs')).href)

let pass = 0
let fail = 0
function test(name, fn) {
  try {
    fn()
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

function makeDb(shift) {
  return {
    posShifts: [shift],
    posSales: [],
    moneyLedger: [],
    cashVault: { cashTotal: 0, cardTotal: 0, transfers: [] },
  }
}

function baseShift(id) {
  return {
    id,
    status: 'open',
    posId: 'POS-T',
    cashierId: 'C1',
    cashierName: 'T',
    openingCash: 0,
    salesCash: 1361.84,
    salesCard: 327.5,
    cashInTotal: 10000,
    expenseTotal: 9718.41,
    openedAtIso: '2026-09-28T02:35:47.063Z',
  }
}

test('kassa auto note "Всё совпало" replaced by server shortage', () => {
  const db = makeDb(baseShift('SH-1'))
  const row = closePosShift(db, 'SH-1', { closingCash: 1412.15, closingCard: 327.5, note: 'Всё совпало' })
  expect(row.cashDiff === -231.28, `diff ${row.cashDiff}`)
  expect(/недостача 231\.28/.test(row.note), `note ${row.note}`)
})

test('matching close keeps "Всё совпало"', () => {
  const db = makeDb(baseShift('SH-2'))
  const row = closePosShift(db, 'SH-2', { closingCash: 1643.43, closingCard: 327.5, note: 'Всё совпало' })
  expect(row.cashDiff === 0, `diff ${row.cashDiff}`)
  expect(row.note === 'Всё совпало', `note ${row.note}`)
})

test('manual cashier comment is kept', () => {
  const db = makeDb(baseShift('SH-3'))
  const row = closePosShift(db, 'SH-3', { closingCash: 1412.15, closingCard: 327.5, note: 'отдал 204 Саидмуроду' })
  expect(row.note === 'отдал 204 Саидмуроду', `note ${row.note}`)
  expect(/недостача 231\.28/.test(row.reconcileNote), `rec ${row.reconcileNote}`)
})

test('kassa expected till includes cash debt repay (same as server)', () => {
  const shift = { ...baseShift('SH-4'), salesCash: 1361.84, debtRepayCash: 0 }
  const sales = [{ id: 'S1', clientRef: 's1', shiftId: 'SH-4', paidCash: 1130.56, paidCard: 327.5, total: 1458.06 }]
  const repay = [
    { clientRef: 'r1', shiftId: 'SH-4', amount: 207.85, method: 'cash' },
    { clientRef: 'r2', shiftId: 'SH-4', amount: 23.43, method: 'cash' },
  ]
  const over = overlayShiftSaleTotals(shift, sales, repay)
  expect(over.salesCash === 1130.56, `sales ${over.salesCash}`)
  expect(expectedTillCashFromShift(over) === 1643.43, `till ${expectedTillCashFromShift(over)}`)
})

test('server shift row (repay folded, no debtRepayCash) unchanged', () => {
  expect(expectedTillCashFromShift(baseShift('SH-5')) === 1643.43, 'server row')
})

test('startup repair: old closed shift note replaced once, manual/moved kept', () => {
  const closed = (id, note, reconcileNote) => ({ ...baseShift(id), status: 'closed', note, reconcileNote })
  const db = makeDb(closed('OLD-1', 'Всё совпало', 'нал · недостача 231.28 · карта · без расхождения'))
  db.posShifts.push(
    closed('OLD-2', 'Всё совпало', 'Всё совпало'),
    closed('OLD-3', 'отдал Саидмуроду', 'нал · недостача 204.00 · карта · без расхождения'),
    closed('OLD-4', 'Переместили 12.00 сом с наличных на карту', 'Переместили 12.00 сом с нал → карта'),
    { ...baseShift('OPEN-1'), note: 'Всё совпало', reconcileNote: 'нал · недостача 1.00' },
  )
  const fixed = repairAutoReconcileShiftNotes(db)
  expect(fixed.length === 1 && fixed[0].id === 'OLD-1', JSON.stringify(fixed))
  expect(db.posShifts[0].note.startsWith('нал · недостача 231.28'), db.posShifts[0].note)
  expect(db.posShifts[2].note === 'отдал Саидмуроду', 'manual kept')
  expect(db.posShifts[4].note === 'Всё совпало', 'open shift untouched')
  expect(repairAutoReconcileShiftNotes(db).length === 0, 'idempotent')
})

test('late sale into closed shift updates reconcileNote and auto note', () => {
  const db = makeDb(baseShift('SH-L'))
  const row = closePosShift(db, 'SH-L', { closingCash: 1643.43, closingCard: 327.5, note: 'Всё совпало' })
  expect(row.note === 'Всё совпало', row.note)
  row.salesCash = Math.round((row.salesCash + 8.5) * 100) / 100
  recomputeClosedShiftReconcile(row)
  expect(row.cashDiff === -8.5, `diff ${row.cashDiff}`)
  expect(/^нал · недостача 8\.50/.test(row.reconcileNote), row.reconcileNote)
  expect(row.note === row.reconcileNote, `note ${row.note}`)
})

test('late sale keeps manual cashier comment', () => {
  const db = makeDb(baseShift('SH-M'))
  const row = closePosShift(db, 'SH-M', { closingCash: 1643.43, closingCard: 327.5, note: 'отдал 50 Али' })
  row.salesCash = Math.round((row.salesCash + 8.5) * 100) / 100
  recomputeClosedShiftReconcile(row)
  expect(row.note === 'отдал 50 Али', row.note)
  expect(/недостача 8\.50/.test(row.reconcileNote), row.reconcileNote)
})

test('cash debt repay made on kassa after its close goes to main vault, not shift', () => {
  const db = makeDb(baseShift('SH-V'))
  applyDebtRepayToShift(db, { amount: 63.82, method: 'cash', shiftId: 'SH-V', clientRef: 'rep-late', createdAtIso: '2026-09-29T16:48:53.000Z', cardNum: 'K-1', clientName: 'Федия' })
  applyDebtRepayToShift(db, { amount: 20, method: 'cash', shiftId: 'SH-V', clientRef: 'rep-in', createdAtIso: '2026-09-29T16:40:00.000Z', cardNum: 'K-2' })
  const row = closePosShift(db, 'SH-V', { clientRef: 'close-1', closedAtIso: '2026-09-29T16:46:28.000Z', closingCash: 1663.43, closingCard: 327.5, note: 'Всё совпало' })
  expect(row.cashDiff === 0, `diff ${row.cashDiff}`)
  expect(row.note === 'Всё совпало', row.note)
  expect(row.lateDebtRepayToVault?.length === 1 && row.lateDebtRepayToVault[0].amount === 63.82, JSON.stringify(row.lateDebtRepayToVault))
  expect(db.cashVault.cashTotal === Math.round((1663.43 + 63.82) * 100) / 100, `vault ${db.cashVault.cashTotal}`)
  expect(db.moneyLedger.some(r => r.refType === 'debt_repay_late' && r.amount === 63.82), 'vault ledger row')
})

test('repay without kassa time is never moved (old kassa / server clock not trusted)', () => {
  const db = makeDb(baseShift('SH-W'))
  applyDebtRepayToShift(db, { amount: 63.82, method: 'cash', shiftId: 'SH-W', clientRef: 'rep-old', cardNum: 'K-1' })
  const row = closePosShift(db, 'SH-W', { clientRef: 'close-2', closedAtIso: '2020-01-01T00:00:00.000Z', closingCash: 1643.43, closingCard: 327.5 })
  expect(!row.lateDebtRepayToVault, 'nothing moved')
  expect(row.cashDiff === -63.82, `diff ${row.cashDiff}`)
})

test('startup repair rebuilds note from diffs and bumps _txCommittedAt', () => {
  const sh = { ...baseShift('OLD-D'), status: 'closed', cashDiff: -35, cardDiff: 0, note: 'нал · излишек 282.70 · карта · без расхождения', reconcileNote: 'нал · излишек 282.70 · карта · без расхождения', _txCommittedAt: '2026-09-23T17:00:00.000Z' }
  const db = makeDb(sh)
  const fixed = repairAutoReconcileShiftNotes(db)
  expect(fixed.length === 1, JSON.stringify(fixed))
  expect(sh.reconcileNote === 'нал · недостача 35.00 · карта · без расхождения', sh.reconcileNote)
  expect(sh.note === sh.reconcileNote, sh.note)
  expect(sh._txCommittedAt > '2026-09-24', `tx ${sh._txCommittedAt}`)
  expect(repairAutoReconcileShiftNotes(db).length === 0, 'idempotent')
})

test('kassa repay ledger follows offline shift id → server id', () => {
  _resetDebtRepayCashLedgerForTests()
  rememberCashDebtRepay({ clientRef: 'r-off', shiftId: 'off-shift-1', amount: 256.74, method: 'cash' })
  expect(cashDebtRepayRowsForShift('SHIFT-1').length === 0, 'not yet')
  expect(remapCashDebtRepayShiftId('off-shift-1', 'SHIFT-1') === 1, 'remapped')
  const rows = cashDebtRepayRowsForShift('SHIFT-1')
  expect(rows.length === 1 && rows[0].amount === 256.74, JSON.stringify(rows))
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
