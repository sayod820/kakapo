/**
 * Закрытие смены: авто-сверка кассы («Всё совпало») не должна перекрывать серверную недостачу.
 * Погашение долга нал входит в ожидаемые наличные и на сервере, и на кассе.
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { closePosShift, repairAutoReconcileShiftNotes } = await import(pathToFileURL(path.join(root, 'server/kakapo-api/posLogic.js')).href)
const { expectedTillCashFromShift, overlayShiftSaleTotals } = await import(pathToFileURL(path.join(root, 'lib/shiftSaleTotalsCore.mjs')).href)

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

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
