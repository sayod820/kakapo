#!/usr/bin/env node
/** Переплата поставщику невозможна: оплата при приходе, отдельная оплата, удаление партии. */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { createStockReceipt, deleteProductStockLayer, ensurePosCollections } = await import(
  pathToFileURL(path.join(root, 'server/kakapo-api/posLogic.js')).href
)
const { applySupplierSettlement } = await import(
  pathToFileURL(path.join(root, 'server/kakapo-api/supplierSettlement.js')).href
)

let pass = 0
let fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log('PASS ', name) } else { fail++; console.log('FAIL ', name) }
}
function throws(fn, re, name) {
  try { fn(); ok(false, `${name} (не отказал)`) } catch (e) { ok(re.test(String(e?.message || e)), `${name} — ${e?.message}`) }
}

function freshDb() {
  const db = {
    products: [
      { id: 1, name: 'Нон', price: 2, costPrice: 1.7, stock: 0 },
      { id: 2, name: 'Сок', price: 10, costPrice: 8, stock: 0 },
    ],
    stockReceipts: [],
    posSales: [],
    posShifts: [{ id: 'SH', status: 'open', posId: 'POS', openingCash: 1000, salesCash: 0, salesCard: 0, expenseTotal: 0, cashInTotal: 0 }],
    posPoints: [{ id: 'POS' }],
    cashiers: [{ id: 'C1' }],
    suppliers: [{ id: 'S1', name: 'Нон', supplyVersion: 0, payVersion: 0, totalSupplied: 0, totalPaid: 0 }],
    supplierPayments: [],
    financeMoves: [],
    writeOffs: [],
    moneyLedger: [],
    clients: [],
    cards: [],
    cashVault: { cashTotal: 5000, cardTotal: 0 },
    _seq: {},
  }
  ensurePosCollections(db)
  return db
}
const sup = db => db.suppliers[0]
const overpaid = db => (Number(sup(db).totalPaid) || 0) > (Number(sup(db).totalSupplied) || 0) + 0.009

{
  const db = freshDb()
  throws(
    () => createStockReceipt(db, { clientRef: 'r1', supplierId: 'S1', paidNow: 686.8, payFrom: 'vault', method: 'cash', items: [{ productId: 1, qty: 40, purchaseTotal: 68 }] }),
    /не может превышать сумму прихода/,
    'оплата при приходе больше суммы прихода',
  )
  ok(!overpaid(db) && db.stockReceipts.length === 0, 'после отказа нет прихода и переплаты')
}

{
  const db = freshDb()
  createStockReceipt(db, { clientRef: 'r1', supplierId: 'S1', paidNow: 0, items: [{ productId: 1, qty: 40, purchaseTotal: 68 }] })
  throws(
    () => applySupplierSettlement(db, { supplierId: 'S1', amount: 100, settlementMethod: 'cash', payFrom: 'vault' }),
    /превышает долг/,
    'отдельная оплата больше долга',
  )
  applySupplierSettlement(db, { supplierId: 'S1', amount: 68, settlementMethod: 'cash', payFrom: 'vault' })
  ok(!overpaid(db), 'оплата ровно на долг проходит без переплаты')
  createStockReceipt(db, { clientRef: 'r2', supplierId: 'S1', paidNow: 68, payFrom: 'vault', method: 'cash', items: [{ productId: 1, qty: 40, purchaseTotal: 68 }] })
  ok(!overpaid(db) && db.stockReceipts.length === 2, 'второй приход с оплатой на свою сумму проходит без переплаты')
}

{
  const db = freshDb()
  const r = createStockReceipt(db, {
    clientRef: 'r1', supplierId: 'S1', paidNow: 148, payFrom: 'vault', method: 'cash',
    items: [{ productId: 1, qty: 40, purchaseTotal: 68 }, { productId: 2, qty: 10, purchaseTotal: 80 }],
  })
  throws(
    () => deleteProductStockLayer(db, r.id, 2),
    /Сначала измените приход/,
    'удаление партии из полностью оплаченного прихода',
  )
  ok(!overpaid(db) && db.stockReceipts[0].items.length === 2, 'после отказа приход цел, переплаты нет')
}

{
  const db = freshDb()
  const r = createStockReceipt(db, {
    clientRef: 'r1', supplierId: 'S1', paidNow: 50, payFrom: 'vault', method: 'cash',
    items: [{ productId: 1, qty: 40, purchaseTotal: 68 }, { productId: 2, qty: 10, purchaseTotal: 80 }],
  })
  deleteProductStockLayer(db, r.id, 2)
  ok(!overpaid(db), 'удаление партии, когда оплата меньше новой суммы, — без переплаты')
  ok(Math.abs(Number(sup(db).totalSupplied) - 68) < 0.01, `поставлено стало 68 (${sup(db).totalSupplied})`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
