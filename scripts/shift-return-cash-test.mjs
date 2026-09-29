/**
 * Возврат наличными с кассы (appliedLocal/skipBalances) должен уменьшать наличные смены на сервере,
 * иначе при закрытии сервер пишет ложную недостачу на сумму возвратов (27.09: −47.50, 28.09: +16 в −151.10).
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pos = await import(pathToFileURL(path.join(root, 'server/kakapo-api/posLogic.js')).href)

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
  const shift = pos.openPosShift(db, { posId: 'POS-T', cashierId: 'C1', openingCash: 0, clientRef: 'shift-open-1' })
  const sale = pos.createPosSale(db, {
    posId: 'POS-T', shiftId: shift.id, cashierId: 'C1', clientRef: 'sale-1',
    paymentMethod: 'cash', paidCash: 100, total: 100,
    items: [{ productId: 1, productName: 'Хлеб', qty: 10, price: 10 }],
    appliedLocal: true, skipBalances: true,
  })
  return { db, shift: db.posShifts.find(s => s.id === shift.id), sale }
}

for (const [label, meta] of [
  ['обычный возврат', {}],
  ['возврат из очереди кассы (skipBalances)', { appliedLocal: true, skipBalances: true, queuedOffline: true }],
]) {
  test(`${label}: наличные смены уменьшаются, закрытие без недостачи`, () => {
    const { db, shift, sale } = makeDb()
    expect(Number(shift.salesCash) === 100, `salesCash after sale ${shift.salesCash}`)
    pos.returnPosSale(db, sale.id, { ...meta, clientRef: `ret-${label}`, items: [{ productId: 1, qty: 2 }] })
    expect(Number(shift.salesCash) === 80, `salesCash after return ${shift.salesCash}`)
    const closed = pos.closePosShift(db, shift.id, { closingCash: 80, clientRef: `close-${label}` })
    expect(Number(closed.expectedCash) === 80, `expectedCash ${closed.expectedCash}`)
    expect(Math.abs(Number(closed.cashDiff)) < 0.009, `cashDiff ${closed.cashDiff}`)
  })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
