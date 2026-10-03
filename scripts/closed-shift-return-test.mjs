/**
 * Возврат чека из закрытой смены: деньги выдаются из кассы текущей смены.
 * Старая (закрытая) смена не меняется; текущая закрывается без ложной недостачи.
 * Касса: overlay по returns[].tillShiftId даёт ту же «ожидаемую сумму в кассе».
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import fs from 'node:fs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pos = await import(pathToFileURL(path.join(root, 'server/kakapo-api/posLogic.js')).href)
const core = await import(pathToFileURL(path.join(root, 'lib/shiftSaleTotalsCore.mjs')).href)

let pass = 0
let fail = 0
function test(name, fn) {
  try { fn(); pass++; console.log(`PASS  ${name}`) } catch (e) { fail++; console.log(`FAIL  ${name}: ${e.message}`) }
}
function expect(cond, msg) { if (!cond) throw new Error(msg) }

function makeDb() {
  const db = {
    products: [{ id: 1, name: 'Хлеб', price: 10, costPrice: 7, stock: 100 }],
    posPoints: [{ id: 'POS-T', name: 'Касса' }],
    cashiers: [{ id: 'C1', name: 'Кассир', active: true }],
    clients: [], cards: [], orders: [], _seq: {},
    stockReceipts: [{ id: 'RCPT-1', items: [{ productId: 1, qty: 100, remainingQty: 100, costPrice: 7 }] }],
  }
  pos.ensurePosCollections(db)
  const old = pos.openPosShift(db, { posId: 'POS-T', cashierId: 'C1', openingCash: 0, clientRef: 'open-old' })
  const sale = pos.createPosSale(db, {
    posId: 'POS-T', shiftId: old.id, cashierId: 'C1', clientRef: 'sale-old',
    paymentMethod: 'mixed', paidCash: 70, paidCard: 30, total: 100,
    items: [{ productId: 1, productName: 'Хлеб', qty: 10, price: 10 }],
  })
  pos.closePosShift(db, old.id, { closingCash: 70, closingCard: 30, clientRef: 'close-old' })
  const oldRow = db.posShifts.find(s => s.id === old.id)
  const snapshot = JSON.stringify({ salesCash: oldRow.salesCash, salesCard: oldRow.salesCard, expectedCash: oldRow.expectedCash, cashDiff: oldRow.cashDiff })
  const cur = pos.openPosShift(db, { posId: 'POS-T', cashierId: 'C1', openingCash: 70, clientRef: 'open-cur' })
  return { db, oldRow, snapshot, cur: db.posShifts.find(s => s.id === cur.id), sale: db.posSales.find(s => s.id === sale.id) }
}

test('чек из закрытой смены: текущая смена отдаёт деньги, вчерашние цифры не меняются', () => {
  const { db, oldRow, snapshot, cur, sale } = makeDb()
  pos.returnPosSale(db, sale.id, { clientRef: 'ret-1', currentShiftId: cur.id, items: [{ productId: 1, qty: 10 }] })
  const after = JSON.stringify({ salesCash: oldRow.salesCash, salesCard: oldRow.salesCard, expectedCash: oldRow.expectedCash, cashDiff: oldRow.cashDiff })
  expect(after === snapshot, `old shift changed ${after} vs ${snapshot}`)
  expect(Number(cur.otherShiftReturnCash) === 70, `cur cash ${cur.otherShiftReturnCash}`)
  expect(Number(cur.otherShiftReturnCard) === 30, `cur card ${cur.otherShiftReturnCard}`)
  const last = sale.returns[sale.returns.length - 1]
  expect(last.tillShiftId === cur.id, `tillShiftId ${last.tillShiftId}`)
  const led = db.moneyLedger.find(r => r.type === 'sale_return_cash' && r.clientRef === 'ret-1')
  expect(led && led.shiftId === cur.id, `ledger shift ${led?.shiftId}`)
  expect(led.meta?.originalShiftId === oldRow.id, 'ledger originalShiftId')
  const closed = pos.closePosShift(db, cur.id, { closingCash: 0, closingCard: -30, clientRef: 'close-cur' })
  expect(Number(closed.expectedCash) === 0, `expectedCash ${closed.expectedCash}`)
  expect(Math.abs(Number(closed.cashDiff)) < 0.009, `cashDiff ${closed.cashDiff}`)
  expect(Number(closed.expectedCard) === -30, `expectedCard ${closed.expectedCard}`)
})

test('старая касса без currentShiftId: берётся открытая смена той же кассы', () => {
  const { db, oldRow, snapshot, cur, sale } = makeDb()
  pos.returnPosSale(db, sale.id, { clientRef: 'ret-2', items: [{ productId: 1, qty: 2 }] })
  expect(JSON.stringify({ salesCash: oldRow.salesCash, salesCard: oldRow.salesCard, expectedCash: oldRow.expectedCash, cashDiff: oldRow.cashDiff }) === snapshot, 'old shift changed')
  expect(Number(cur.otherShiftReturnCash) === 20, `cur cash ${cur.otherShiftReturnCash}`)
})

test('нет открытой смены: деньги не приписываются никуда (как раньше)', () => {
  const { db, cur, sale } = makeDb()
  pos.closePosShift(db, cur.id, { closingCash: 70, clientRef: 'close-cur-early' })
  pos.returnPosSale(db, sale.id, { clientRef: 'ret-3', items: [{ productId: 1, qty: 1 }] })
  expect(!(Number(cur.otherShiftReturnCash) > 0), 'closed shift touched')
  expect(!sale.returns[sale.returns.length - 1].tillShiftId, 'tillShiftId set')
})

test('смена открыта после возврата (очередь) — не приписываем', () => {
  const { db, cur, sale } = makeDb()
  pos.returnPosSale(db, sale.id, { clientRef: 'ret-4', createdAtIso: '2000-01-01T00:00:00.000Z', items: [{ productId: 1, qty: 1 }] })
  expect(!(Number(cur.otherShiftReturnCash) > 0), 'attributed to later shift')
})

test('возврат в своей открытой смене — как раньше (salesCash уменьшается)', () => {
  const { db, cur } = makeDb()
  const s = pos.createPosSale(db, {
    posId: 'POS-T', shiftId: cur.id, cashierId: 'C1', clientRef: 'sale-cur',
    paymentMethod: 'cash', paidCash: 50, total: 50,
    items: [{ productId: 1, productName: 'Хлеб', qty: 5, price: 10 }],
  })
  pos.returnPosSale(db, s.id, { clientRef: 'ret-5', currentShiftId: cur.id, items: [{ productId: 1, qty: 1 }] })
  expect(Number(cur.salesCash) === 40, `salesCash ${cur.salesCash}`)
  expect(!(Number(cur.otherShiftReturnCash) > 0), 'other field touched')
})

test('повтор того же возврата (clientRef) не списывает дважды', () => {
  const { db, cur, sale } = makeDb()
  pos.returnPosSale(db, sale.id, { clientRef: 'ret-6', currentShiftId: cur.id, items: [{ productId: 1, qty: 3 }] })
  pos.returnPosSale(db, sale.id, { clientRef: 'ret-6', currentShiftId: cur.id, items: [{ productId: 1, qty: 3 }] })
  expect(Number(cur.otherShiftReturnCash) === 30, `cur cash ${cur.otherShiftReturnCash}`)
})

test('касса: overlay по чекам даёт ту же сумму в ящике, что и сервер', () => {
  const shift = { id: 'SH-2', openingCash: 100, salesCash: 0, salesCard: 0, cashInTotal: 0, expenseTotal: 0 }
  const sales = [
    { id: 'S-1', shiftId: 'SH-1', status: 'returned', paidCash: 0, returns: [{ cutCash: 70, cutCard: 30, tillShiftId: 'SH-2' }] },
    { id: 'S-1', shiftId: 'SH-1', status: 'returned', paidCash: 0, returns: [{ cutCash: 70, cutCard: 30, tillShiftId: 'SH-2' }] },
    { id: 'S-2', shiftId: 'SH-2', paidCash: 20, total: 20 },
  ]
  const over = core.overlayShiftSaleTotals(shift, sales, [])
  expect(over.otherShiftReturnCash === 70 && over.otherShiftReturnCard === 30, JSON.stringify(over))
  expect(core.expectedTillCashFromShift(over) === 50, `till ${core.expectedTillCashFromShift(over)}`)
  expect(core.expectedCardFromShift(over) === -30, `card ${core.expectedCardFromShift(over)}`)
  const serverRow = { ...shift, salesCash: 20, otherShiftReturnCash: 70 }
  expect(core.overlayShiftSaleTotals(serverRow, [], []).otherShiftReturnCash === 70, 'server field kept when sale rows gone')
})

test('касса: код АДМИН/ADMIN больше не подходит', () => {
  const src = fs.readFileSync(path.join(root, 'components/trade/CashierModule.tsx'), 'utf8')
  expect(!/upper === 'АДМИН'|upper === 'ADMIN'/.test(src), 'bypass still present')
  expect(src.includes("currentShiftId: activeShift?.status === 'open'"), 'kassa sends currentShiftId')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
