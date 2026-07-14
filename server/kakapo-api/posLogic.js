import { nextOrderId } from './seed.js'
import { stampOrderForClient } from './accountLifecycle.js'
import { findClientByPhone } from './loyaltyBonus.js'
import { appendMoneyLedger } from './financeTruth.js'

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function nowIso() {
  return new Date().toISOString()
}

function nowTimeLocal() {
  return new Date().toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Dushanbe',
  })
}

function nextId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function ensurePosCollections(db) {
  if (!Array.isArray(db.cashiers)) db.cashiers = []
  if (!Array.isArray(db.posShifts)) db.posShifts = []
  if (!Array.isArray(db.posSales)) db.posSales = []
  if (!Array.isArray(db.stockReceipts)) db.stockReceipts = []
  if (!Array.isArray(db.writeOffs)) db.writeOffs = []
  if (!Array.isArray(db.stockRevisions)) db.stockRevisions = []
  if (!Array.isArray(db.suppliers)) db.suppliers = []
  if (!Array.isArray(db.supplierPayments)) db.supplierPayments = []
  if (!Array.isArray(db.expenses)) db.expenses = []
  if (!Array.isArray(db.financeMoves)) db.financeMoves = []
  if (!Array.isArray(db.moneyLedger)) db.moneyLedger = []
  if (!Array.isArray(db.posPoints)) db.posPoints = []
  if (!db._seq || typeof db._seq !== 'object') db._seq = {}
  ensureDefaultPosPoint(db)
}

const DEFAULT_POS_ID = 'POS-DEFAULT'

function ensureDefaultPosPoint(db) {
  if (!db.posPoints.length) {
    db.posPoints.push({
      id: DEFAULT_POS_ID,
      name: 'Магазин · Ленина 42',
      code: 'Касса №1 · KAKAPO',
      note: '',
      active: true,
      createdAtIso: nowIso(),
    })
  }
  const fallbackId = db.posPoints[0]?.id || DEFAULT_POS_ID
  for (const s of db.posShifts) {
    if (!s.posId) s.posId = fallbackId
  }
  for (const s of db.posSales) {
    if (!s.posId) s.posId = fallbackId
  }
}

export function listPosPoints(db) {
  ensurePosCollections(db)
  return [...db.posPoints].sort((a, b) => String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || '')))
}

export function createPosPoint(db, data = {}) {
  ensurePosCollections(db)
  const name = String(data.name || '').trim()
  if (!name) throw new Error('Укажите название точки продаж')
  const n = db.posPoints.length + 1
  const code = String(data.code || '').trim() || `Касса №${n} · KAKAPO`
  const row = {
    id: nextId('POS'),
    name,
    code,
    note: String(data.note || '').trim(),
    active: data.active !== false,
    createdAtIso: nowIso(),
  }
  db.posPoints.push(row)
  return row
}

export function updatePosPoint(db, id, data = {}) {
  ensurePosCollections(db)
  const row = db.posPoints.find(p => p.id === id)
  if (!row) throw new Error('Точка продаж не найдена')
  if (data.name != null) {
    const name = String(data.name).trim()
    if (!name) throw new Error('Укажите название')
    row.name = name
  }
  if (data.code != null) row.code = String(data.code).trim()
  if (data.note != null) row.note = String(data.note).trim()
  if (data.active != null) row.active = !!data.active
  return row
}

export function deletePosPoint(db, id) {
  ensurePosCollections(db)
  const idx = db.posPoints.findIndex(p => p.id === id)
  if (idx < 0) throw new Error('Точка продаж не найдена')
  const open = db.posShifts.find(s => s.posId === id && s.status === 'open')
  if (open) throw new Error('Сначала закройте сессию на этой кассе')
  const activeCount = db.posPoints.filter(p => p.active !== false).length
  const row = db.posPoints[idx]
  if (row.active !== false && activeCount <= 1) {
    throw new Error('Нельзя удалить последнюю точку продаж')
  }
  db.posPoints.splice(idx, 1)
  return { id }
}

/** Присвоить сквозные номера старым чекам. true = были изменения. */
export function ensurePosSaleNumbers(db) {
  ensurePosCollections(db)
  const sales = db.posSales || []
  let max = Math.max(0, Number(db._seq.posSale) || 0)
  for (const s of sales) {
    const n = Number(s.number)
    if (n > max) max = n
  }
  const need = sales
    .filter(s => !(Number(s.number) > 0))
    .sort((a, b) => String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || '')))
  if (!need.length) {
    db._seq.posSale = max
    return false
  }
  for (const s of need) {
    max += 1
    s.number = max
  }
  db._seq.posSale = max
  return true
}

function nextPosSaleNumber(db) {
  ensurePosSaleNumbers(db)
  const n = (Number(db._seq.posSale) || 0) + 1
  db._seq.posSale = n
  return n
}

function getProduct(db, productId) {
  const product = (db.products || []).find(p => Number(p.id) === Number(productId))
  if (!product) throw new Error(`Товар #${productId} не найден`)
  return product
}

function getClientById(db, clientId) {
  return (db.clients || []).find(c => String(c.id) === String(clientId)) || null
}

function getCardByNum(db, cardNum) {
  const key = String(cardNum || '').trim().toUpperCase()
  if (!key) return null
  return (db.cards || []).find(c => String(c.num || '').trim().toUpperCase() === key) || null
}

function syncSupplierPayable(supplier) {
  if (!supplier) return supplier
  supplier.payableAmount = round2(Math.max(0, (supplier.totalSupplied || 0) - (supplier.totalPaid || 0)))
  return supplier
}

function updateSupplierDebt(db, supplierId, receiptTotal, paidNow) {
  if (!supplierId) return null
  const supplier = (db.suppliers || []).find(s => s.id === supplierId)
  if (!supplier) throw new Error('Поставщик не найден')
  supplier.totalSupplied = round2((supplier.totalSupplied || 0) + receiptTotal)
  supplier.totalPaid = round2((supplier.totalPaid || 0) + Math.max(0, round2(paidNow)))
  syncSupplierPayable(supplier)
  supplier.lastDeliveryAtIso = nowIso()
  return supplier
}

function normalizeBulkPricing(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map(t => ({
      minQty: Math.max(1, Math.floor(Number(t.minQty) || 0)),
      price: round2(t.price),
    }))
    .filter(t => t.minQty > 0 && t.price > 0)
    .sort((a, b) => a.minQty - b.minQty)
}

function getActiveStockLayer(db, productId) {
  ensurePosCollections(db)
  const receipts = [...(db.stockReceipts || [])].sort((a, b) => String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || '')))
  for (const receipt of receipts) {
    for (const item of receipt.items || []) {
      if (Number(item.productId) !== Number(productId)) continue
      if (!(Number(item.remainingQty) > 0)) continue
      return { receipt, item }
    }
  }
  return null
}

function syncProductPricingFromActiveLayer(db, productId) {
  const product = (db.products || []).find(p => Number(p.id) === Number(productId))
  if (!product) return
  const active = getActiveStockLayer(db, productId)
  if (!active) return
  const item = active.item
  const retail = round2(item.retailPrice ?? product.price)
  if (retail > 0) product.price = retail
  const cost = round2(item.costPrice)
  if (cost > 0) product.costPrice = cost
  const bulk = normalizeBulkPricing(item.bulkPricing)
  if (bulk.length) product.bulkPricing = bulk
  else delete product.bulkPricing
}

export function listProductStockLayers(db, productId) {
  ensurePosCollections(db)
  const layers = []
  const receipts = [...(db.stockReceipts || [])].sort((a, b) => String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || '')))
  let queueIndex = 0
  for (const receipt of receipts) {
    for (const item of receipt.items || []) {
      if (Number(item.productId) !== Number(productId)) continue
      const remainingQty = round2(item.remainingQty)
      if (!(remainingQty > 0)) continue
      layers.push({
        receiptId: receipt.id,
        productId: Number(item.productId),
        productName: item.productName,
        qty: round2(item.qty),
        remainingQty,
        costPrice: round2(item.costPrice),
        retailPrice: round2(item.retailPrice),
        bulkPricing: normalizeBulkPricing(item.bulkPricing),
        expiryDate: item.expiryDate || null,
        createdAtIso: receipt.createdAtIso,
        supplierName: receipt.supplierName || '',
        queueIndex,
        isActive: queueIndex === 0,
      })
      queueIndex += 1
    }
  }
  return layers
}

export function addProductStockLayer(db, productId, data = {}) {
  ensurePosCollections(db)
  const product = getProduct(db, productId)
  const qty = round2(data.qty)
  const costPrice = round2(data.costPrice)
  const retailPrice = round2(data.retailPrice ?? product.price)
  const bulkPricing = normalizeBulkPricing(data.bulkPricing)
  if (!(qty > 0)) throw new Error('Укажите количество прихода')
  product.stock = round2((Number(product.stock) || 0) + qty)
  const receipt = {
    id: nextId('REC'),
    supplierId: data.supplierId || null,
    supplierName: data.supplierName || '',
    createdAtIso: nowIso(),
    createdBy: String(data.createdBy || '').trim(),
    totalCost: round2(qty * costPrice),
    paidNow: round2(data.paidNow),
    debtAdded: 0,
    items: [{
      productId: product.id,
      productName: product.name,
      qty,
      remainingQty: qty,
      costPrice,
      retailPrice,
      bulkPricing: bulkPricing.length ? bulkPricing : undefined,
      expiryDate: data.expiryDate || null,
    }],
  }
  db.stockReceipts.unshift(receipt)
  syncProductPricingFromActiveLayer(db, product.id)
  return { receipt, layers: listProductStockLayers(db, product.id) }
}

export function updateProductStockLayer(db, receiptId, productId, patch = {}) {
  ensurePosCollections(db)
  const receipt = (db.stockReceipts || []).find(r => r.id === receiptId)
  if (!receipt) throw new Error('Приход не найден')
  const item = (receipt.items || []).find(i => Number(i.productId) === Number(productId))
  if (!item) throw new Error('Партия не найдена')
  if (!(Number(item.remainingQty) > 0)) throw new Error('Партия уже израсходована')
  if (patch.retailPrice != null) item.retailPrice = round2(patch.retailPrice)
  if (patch.costPrice != null) item.costPrice = round2(patch.costPrice)
  if (patch.bulkPricing != null) {
    const bulk = normalizeBulkPricing(patch.bulkPricing)
    if (bulk.length) item.bulkPricing = bulk
    else delete item.bulkPricing
  }
  if (patch.expiryDate !== undefined) item.expiryDate = patch.expiryDate || null
  syncProductPricingFromActiveLayer(db, productId)
  return listProductStockLayers(db, productId)
}

function consumeReceiptBalances(db, productId, qty, preferReceiptId = '') {
  let left = round2(qty)
  let cogs = 0
  const receipts = (db.stockReceipts || [])
    .filter(r => Array.isArray(r.items) && r.items.some(i => Number(i.productId) === Number(productId) && Number(i.remainingQty) > 0))
    .sort((a, b) => String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || '')))

  const ordered = preferReceiptId
    ? [
        ...receipts.filter(r => r.id === preferReceiptId),
        ...receipts.filter(r => r.id !== preferReceiptId),
      ]
    : receipts

  if (preferReceiptId) {
    const target = receipts.find(r => r.id === preferReceiptId)
    if (!target) throw new Error('Выбранная партия не найдена')
    const item = (target.items || []).find(i => Number(i.productId) === Number(productId))
    const rem = round2(item?.remainingQty)
    if (!(rem >= left)) {
      throw new Error(`В выбранной партии осталось ${rem || 0} — нужно ${left}`)
    }
  }

  for (const receipt of ordered) {
    for (const item of receipt.items || []) {
      if (Number(item.productId) !== Number(productId)) continue
      if (left <= 0) break
      if (preferReceiptId && receipt.id !== preferReceiptId) continue
      const take = Math.min(Number(item.remainingQty) || 0, left)
      if (!(take > 0)) continue
      const unitCost = Number(item.costPrice) || 0
      cogs = round2(cogs + take * unitCost)
      item.remainingQty = round2((Number(item.remainingQty) || 0) - take)
      left = round2(left - take)
    }
  }
  if (preferReceiptId && left > 0.0001) {
    throw new Error('Недостаточно остатка в выбранной партии')
  }
  syncProductPricingFromActiveLayer(db, productId)
  return cogs
}

function restoreReceiptBalance(db, productId, qty, receiptId = '') {
  const add = round2(qty)
  if (!(add > 0)) return
  if (receiptId) {
    const receipt = (db.stockReceipts || []).find(r => r.id === receiptId)
    const item = receipt?.items?.find(i => Number(i.productId) === Number(productId))
    if (item) {
      item.remainingQty = round2((Number(item.remainingQty) || 0) + add)
      syncProductPricingFromActiveLayer(db, productId)
      return
    }
  }
  // fallback: вернуть в самый новый слой с этим товаром или создать виртуальный не требуется —
  // просто синхронизируем цену после роста stock
  syncProductPricingFromActiveLayer(db, productId)
}

function consumeStock(db, items) {
  const normalized = items.map(raw => {
    const product = getProduct(db, raw.productId)
    const qty = round2(raw.qty)
    if (!(qty > 0)) throw new Error(`Некорректное количество для ${product.name}`)
    if (round2(product.stock) < qty) throw new Error(`Недостаточно остатка: ${product.name}`)
    const receiptId = String(raw.receiptId || '').trim()
    return { product, qty, cogs: 0, receiptId }
  })
  for (const row of normalized) {
    row.product.stock = round2((Number(row.product.stock) || 0) - row.qty)
    row.cogs = consumeReceiptBalances(db, row.product.id, row.qty, row.receiptId)
  }
  return normalized
}

export function listCashiers(db) {
  ensurePosCollections(db)
  return db.cashiers
}

export function createCashier(db, data = {}) {
  ensurePosCollections(db)
  const name = String(data.name || '').trim()
  const pin = String(data.pin || '').trim()
  if (!name) throw new Error('Укажите имя кассира')
  if (pin.length < 4) throw new Error('PIN должен быть не короче 4 символов')
  const row = {
    id: nextId('CASHIER'),
    name,
    pin,
    active: data.active !== false,
    salesCount: 0,
    salesTotal: 0,
    createdAtIso: nowIso(),
  }
  db.cashiers.unshift(row)
  return row
}

export function updateCashier(db, id, patch = {}) {
  ensurePosCollections(db)
  const row = db.cashiers.find(x => x.id === id)
  if (!row) throw new Error('Кассир не найден')
  Object.assign(row, patch)
  row.name = String(row.name || '').trim()
  row.pin = String(row.pin || '').trim()
  return row
}

export function listPosShifts(db) {
  ensurePosCollections(db)
  return [...db.posShifts].sort((a, b) => String(b.openedAtIso || '').localeCompare(String(a.openedAtIso || '')))
}

export function openPosShift(db, data = {}) {
  ensurePosCollections(db)
  const cashier = db.cashiers.find(c => c.id === data.cashierId)
  if (!cashier) throw new Error('Кассир не найден')
  const posId = String(data.posId || '').trim() || (db.posPoints[0]?.id || DEFAULT_POS_ID)
  const pos = db.posPoints.find(p => p.id === posId)
  if (!pos || pos.active === false) throw new Error('Точка продаж не найдена')
  const openOnPos = db.posShifts.find(s => s.posId === posId && s.status === 'open')
  if (openOnPos) throw new Error('На этой точке продаж уже открыта сессия')
  const existing = db.posShifts.find(s => s.cashierId === cashier.id && s.status === 'open')
  if (existing) throw new Error('У кассира уже открыта смена')
  const row = {
    id: nextId('SHIFT'),
    posId,
    cashierId: cashier.id,
    cashierName: cashier.name,
    openedAtIso: nowIso(),
    closedAtIso: null,
    openingCash: round2(data.openingCash),
    closingCash: null,
    salesCash: 0,
    salesCard: 0,
    salesCredit: 0,
    salesCount: 0,
    expenseTotal: 0,
    cashInTotal: 0,
    status: 'open',
    note: String(data.note || '').trim(),
  }
  db.posShifts.unshift(row)
  appendMoneyLedger(db, {
    type: 'shift_open',
    amount: row.openingCash,
    direction: 'in',
    cashAffect: true,
    posId,
    shiftId: row.id,
    cashierId: cashier.id,
    cashierName: cashier.name,
    refType: 'shift',
    refId: row.id,
    reason: 'Открытие смены · разменный фонд',
    note: row.note,
  })
  return row
}

export function closePosShift(db, id, data = {}) {
  ensurePosCollections(db)
  const row = db.posShifts.find(s => s.id === id)
  if (!row) throw new Error('Смена не найдена')
  const expectedCash = round2(
    (Number(row.openingCash) || 0)
    + (Number(row.salesCash) || 0)
    + (Number(row.cashInTotal) || 0)
    - (Number(row.expenseTotal) || 0),
  )
  const actualCash = round2(data.closingCash)
  const cashDiff = round2(actualCash - expectedCash)
  row.status = 'closed'
  row.closedAtIso = nowIso()
  row.closingCash = actualCash
  row.expectedCash = expectedCash
  row.actualCash = actualCash
  row.cashDiff = cashDiff
  row.note = String(data.note || row.note || '').trim()
  appendMoneyLedger(db, {
    type: 'shift_close',
    amount: Math.abs(cashDiff),
    direction: 'info',
    cashAffect: false,
    signedAmount: cashDiff,
    posId: row.posId || '',
    shiftId: row.id,
    cashierId: row.cashierId,
    cashierName: row.cashierName,
    refType: 'shift',
    refId: row.id,
    reason: Math.abs(cashDiff) < 0.009
      ? 'Сверка кассы · без расхождения'
      : cashDiff < 0
        ? `Недостача ${Math.abs(cashDiff).toFixed(2)} сом`
        : `Излишек ${cashDiff.toFixed(2)} сом`,
    note: row.note,
    meta: { expectedCash, actualCash, cashDiff },
  })
  return row
}

export function listSuppliers(db) {
  ensurePosCollections(db)
  return db.suppliers
}

export function createSupplier(db, data = {}) {
  ensurePosCollections(db)
  const name = String(data.name || '').trim()
  if (!name) throw new Error('Укажите название поставщика')
  const row = {
    id: nextId('SUP'),
    name,
    category: String(data.category || '').trim(),
    phone: String(data.phone || '').trim(),
    address: String(data.address || '').trim(),
    note: String(data.note || '').trim(),
    payableAmount: 0,
    totalSupplied: 0,
    totalPaid: 0,
    lastDeliveryAtIso: null,
  }
  db.suppliers.unshift(row)
  return row
}

export function updateSupplier(db, id, patch = {}) {
  ensurePosCollections(db)
  const row = db.suppliers.find(s => s.id === id)
  if (!row) throw new Error('Поставщик не найден')
  Object.assign(row, patch)
  row.name = String(row.name || '').trim()
  return row
}

export function createSupplierPayment(db, supplierId, data = {}) {
  ensurePosCollections(db)
  const supplier = db.suppliers.find(s => s.id === supplierId)
  if (!supplier) throw new Error('Поставщик не найден')
  const amount = round2(data.amount)
  if (!(amount > 0)) throw new Error('Укажите сумму оплаты')
  supplier.totalPaid = round2((supplier.totalPaid || 0) + amount)
  syncSupplierPayable(supplier)
  const payment = {
    id: nextId('SPAY'),
    supplierId: supplier.id,
    supplierName: supplier.name,
    amount,
    paidAtIso: nowIso(),
    note: String(data.note || '').trim(),
  }
  db.supplierPayments.unshift(payment)
  return payment
}

export function listSupplierPayments(db, supplierId) {
  ensurePosCollections(db)
  return (db.supplierPayments || [])
    .filter(p => !supplierId || p.supplierId === supplierId)
    .sort((a, b) => String(b.paidAtIso || '').localeCompare(String(a.paidAtIso || '')))
}

export function deleteSupplierPayment(db, supplierId, paymentId) {
  ensurePosCollections(db)
  const idx = (db.supplierPayments || []).findIndex(p => p.id === paymentId && p.supplierId === supplierId)
  if (idx < 0) throw new Error('Платёж не найден')
  const payment = db.supplierPayments[idx]
  const supplier = db.suppliers.find(s => s.id === supplierId)
  if (supplier) {
    supplier.totalPaid = round2(Math.max(0, (supplier.totalPaid || 0) - payment.amount))
    syncSupplierPayable(supplier)
  }
  db.supplierPayments.splice(idx, 1)
  return { id: paymentId }
}

export function deleteSupplier(db, id) {
  ensurePosCollections(db)
  const idx = (db.suppliers || []).findIndex(s => s.id === id)
  if (idx < 0) throw new Error('Поставщик не найден')
  const supplier = db.suppliers[idx]
  if (Number(supplier.payableAmount) > 0) {
    throw new Error('Нельзя удалить поставщика с непогашенным долгом — сначала погасите задолженность')
  }
  db.suppliers.splice(idx, 1)
  db.supplierPayments = (db.supplierPayments || []).filter(p => p.supplierId !== id)
  return { id }
}

export function listExpenses(db) {
  ensurePosCollections(db)
  return [...db.expenses].sort((a, b) => String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || '')))
}

export function createExpense(db, data = {}) {
  ensurePosCollections(db)
  const amount = round2(data.amount)
  if (!(amount > 0)) throw new Error('Укажите сумму расхода')
  const row = {
    id: nextId('EXP'),
    category: String(data.category || '').trim() || 'Прочее',
    amount,
    note: String(data.note || '').trim(),
    createdBy: String(data.createdBy || '').trim(),
    shiftId: data.shiftId || undefined,
    createdAtIso: nowIso(),
  }
  db.expenses.unshift(row)
  if (row.shiftId) {
    const shift = db.posShifts.find(s => s.id === row.shiftId)
    if (shift) shift.expenseTotal = round2((shift.expenseTotal || 0) + amount)
  }
  const shift = row.shiftId ? db.posShifts.find(s => s.id === row.shiftId) : null
  appendMoneyLedger(db, {
    type: 'expense',
    amount,
    direction: 'out',
    cashAffect: true,
    posId: shift?.posId || '',
    shiftId: row.shiftId || '',
    cashierId: '',
    cashierName: row.createdBy || '',
    refType: 'expense',
    refId: row.id,
    reason: `Расход · ${row.category}`,
    note: row.note,
  })
  return row
}

/** Вклады / снятия — с открытой смены списывают/вносят наличные в кассу */
export function listFinanceMoves(db) {
  ensurePosCollections(db)
  return [...db.financeMoves].sort((a, b) => String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || '')))
}

export function createFinanceMove(db, data = {}) {
  ensurePosCollections(db)
  const type = data.type === 'withdraw' ? 'withdraw' : 'deposit'
  const amount = round2(data.amount)
  if (!(amount > 0)) throw new Error('Укажите сумму')

  let shift = null
  if (data.shiftId) {
    shift = db.posShifts.find(s => s.id === data.shiftId)
    if (!shift) throw new Error('Смена не найдена')
    if (shift.status !== 'open') throw new Error('Смена уже закрыта')
  }

  const cashierName = String(data.createdBy || data.cashierName || shift?.cashierName || '').trim()
  const cashierId = String(data.cashierId || shift?.cashierId || '').trim()
  const supplierId = String(data.supplierId || '').trim()
  let supplier = null
  let payment = null

  if (type === 'withdraw' && supplierId) {
    supplier = db.suppliers.find(s => s.id === supplierId)
    if (!supplier) throw new Error('Поставщик не найден')
  }

  const note = String(data.note || '').trim()
  const reason = String(data.reason || '').trim()
    || (type === 'deposit'
      ? 'Внесение в кассу'
      : supplier
        ? `Оплата поставщику · ${supplier.name}`
        : 'Снятие из кассы')

  const row = {
    id: nextId('FIN'),
    type,
    amount,
    note,
    createdBy: cashierName,
    createdAtIso: nowIso(),
    shiftId: shift?.id || undefined,
    posId: shift?.posId || data.posId || '',
    supplierId: supplier?.id,
    supplierName: supplier?.name,
  }
  db.financeMoves.unshift(row)

  if (shift) {
    if (type === 'withdraw') {
      shift.expenseTotal = round2((Number(shift.expenseTotal) || 0) + amount)
    } else {
      shift.cashInTotal = round2((Number(shift.cashInTotal) || 0) + amount)
    }
  }

  if (supplier) {
    supplier.totalPaid = round2((Number(supplier.totalPaid) || 0) + amount)
    syncSupplierPayable(supplier)
    payment = {
      id: nextId('SPAY'),
      supplierId: supplier.id,
      supplierName: supplier.name,
      amount,
      paidAtIso: row.createdAtIso,
      note: note || `С кассы · ${shift?.id || ''}`,
      financeMoveId: row.id,
      shiftId: shift?.id,
    }
    if (!Array.isArray(db.supplierPayments)) db.supplierPayments = []
    db.supplierPayments.unshift(payment)
  }

  appendMoneyLedger(db, {
    type: type === 'deposit' ? 'deposit' : 'withdraw',
    amount,
    direction: type === 'deposit' ? 'in' : 'out',
    cashAffect: true,
    posId: row.posId || '',
    shiftId: row.shiftId || '',
    cashierId,
    cashierName,
    refType: 'finance_move',
    refId: row.id,
    reason,
    note,
    meta: supplier ? { supplierId: supplier.id, supplierName: supplier.name, paymentId: payment?.id } : {},
  })
  return { ...row, payment }
}

export function deleteFinanceMove(db, id) {
  ensurePosCollections(db)
  const before = db.financeMoves.length
  db.financeMoves = db.financeMoves.filter(r => r.id !== id)
  if (db.financeMoves.length === before) throw new Error('Запись не найдена')
  return { id }
}

export function listStockReceipts(db) {
  ensurePosCollections(db)
  return [...db.stockReceipts].sort((a, b) => String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || '')))
}

function reverseSupplierDebt(db, supplierId, receiptTotal, debtAdded) {
  if (!supplierId) return null
  const supplier = (db.suppliers || []).find(s => s.id === supplierId)
  if (!supplier) throw new Error('Поставщик не найден')
  const paidNow = Math.max(0, round2(receiptTotal - debtAdded))
  supplier.totalSupplied = round2(Math.max(0, (supplier.totalSupplied || 0) - receiptTotal))
  supplier.totalPaid = round2(Math.max(0, (supplier.totalPaid || 0) - paidNow))
  syncSupplierPayable(supplier)
  return supplier
}

function restoreReceiptBalances(db, productId, qty) {
  let left = round2(qty)
  const receipts = [...(db.stockReceipts || [])]
    .sort((a, b) => String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || '')))
  for (const receipt of receipts) {
    for (const item of receipt.items || []) {
      if (Number(item.productId) !== Number(productId)) continue
      if (left <= 0) break
      const consumed = round2((Number(item.qty) || 0) - (Number(item.remainingQty) || 0))
      if (consumed <= 0) continue
      const add = Math.min(consumed, left)
      item.remainingQty = round2((Number(item.remainingQty) || 0) + add)
      left = round2(left - add)
    }
  }
  if (left > 0) {
    for (const receipt of receipts) {
      for (const item of receipt.items || []) {
        if (Number(item.productId) !== Number(productId)) continue
        item.remainingQty = round2((Number(item.remainingQty) || 0) + left)
        item.qty = round2((Number(item.qty) || 0) + left)
        receipt.totalCost = round2((receipt.items || []).reduce((sum, row) => sum + (Number(row.qty) || 0) * (Number(row.costPrice) || 0), 0))
        left = 0
        break
      }
      if (left <= 0) break
    }
  }
  syncProductPricingFromActiveLayer(db, productId)
}

function reverseStockReceipt(db, receipt) {
  for (const item of receipt.items || []) {
    const product = getProduct(db, item.productId)
    const remaining = round2(item.remainingQty ?? item.qty)
    if (remaining > 0) {
      product.stock = round2(Math.max(0, (Number(product.stock) || 0) - remaining))
    }
    syncProductPricingFromActiveLayer(db, item.productId)
  }
  if (receipt.supplierId) {
    reverseSupplierDebt(db, receipt.supplierId, receipt.totalCost, receipt.debtAdded)
  }
  const idx = (db.stockReceipts || []).findIndex(r => r.id === receipt.id)
  if (idx >= 0) db.stockReceipts.splice(idx, 1)
}

function reverseStockWriteoff(db, writeoff) {
  for (const item of writeoff.items || []) {
    const product = getProduct(db, item.productId)
    const qty = round2(item.qty)
    product.stock = round2((Number(product.stock) || 0) + qty)
    restoreReceiptBalances(db, item.productId, qty)
  }
}

function buildStockReceipt(db, data = {}, meta = {}) {
  const rawItems = Array.isArray(data.items) ? data.items : []
  if (!rawItems.length) throw new Error('Добавьте товары в приход')
  const items = rawItems.map(raw => {
    const product = getProduct(db, raw.productId)
    const qty = round2(raw.qty)
    const costPrice = round2(raw.costPrice)
    if (!(qty > 0)) throw new Error(`Некорректное количество для ${product.name}`)
    return {
      product,
      qty,
      costPrice,
      retailPrice: round2(raw.retailPrice ?? product.price),
      bulkPricing: normalizeBulkPricing(raw.bulkPricing),
      expiryDate: raw.expiryDate || null,
    }
  })
  let totalCost = 0
  for (const row of items) {
    row.product.stock = round2((Number(row.product.stock) || 0) + row.qty)
    if (row.costPrice > 0) row.product.costPrice = row.costPrice
    totalCost = round2(totalCost + row.qty * row.costPrice)
  }
  const paidNow = round2(data.paidNow)
  const supplier = updateSupplierDebt(db, data.supplierId || '', totalCost, paidNow)
  const receipt = {
    id: meta.id || nextId('REC'),
    supplierId: supplier?.id || null,
    supplierName: supplier?.name || '',
    createdAtIso: meta.createdAtIso || nowIso(),
    createdBy: String(meta.createdBy || data.createdBy || '').trim(),
    totalCost,
    paidNow,
    debtAdded: round2(Math.max(0, totalCost - paidNow)),
    items: items.map(row => ({
      productId: row.product.id,
      productName: row.product.name,
      qty: row.qty,
      remainingQty: row.qty,
      costPrice: row.costPrice,
      retailPrice: row.retailPrice,
      bulkPricing: row.bulkPricing.length ? row.bulkPricing : undefined,
      expiryDate: row.expiryDate,
    })),
  }
  db.stockReceipts.unshift(receipt)
  for (const row of items) syncProductPricingFromActiveLayer(db, row.product.id)
  return receipt
}

export function createStockReceipt(db, data = {}) {
  ensurePosCollections(db)
  const receipt = buildStockReceipt(db, data)
  if ((Number(receipt.paidNow) || 0) > 0) {
    appendMoneyLedger(db, {
      type: 'purchase_pay',
      amount: receipt.paidNow,
      direction: 'out',
      cashAffect: true,
      cashierName: receipt.createdBy || '',
      refType: 'receipt',
      refId: receipt.id,
      reason: `Оплата закупа · ${receipt.supplierName || 'поставщик'}`,
      note: '',
    })
  }
  return receipt
}

export function updateStockReceipt(db, id, data = {}) {
  ensurePosCollections(db)
  const receipt = (db.stockReceipts || []).find(r => r.id === id)
  if (!receipt) throw new Error('Приход не найден')
  const meta = {
    id: receipt.id,
    createdAtIso: receipt.createdAtIso,
    createdBy: receipt.createdBy,
  }
  reverseStockReceipt(db, receipt)
  return buildStockReceipt(db, data, meta)
}

export function deleteStockReceipt(db, id) {
  ensurePosCollections(db)
  const receipt = (db.stockReceipts || []).find(r => r.id === id)
  if (!receipt) throw new Error('Приход не найден')
  reverseStockReceipt(db, receipt)
  return { id }
}

function buildStockWriteoff(db, data = {}, meta = {}) {
  const rows = consumeStock(db, Array.isArray(data.items) ? data.items : [])
  const writeoff = {
    id: meta.id || nextId('WOF'),
    createdAtIso: meta.createdAtIso || nowIso(),
    createdBy: String(meta.createdBy || data.createdBy || '').trim(),
    reason: String(data.reason || '').trim() || 'Списание',
    note: String(data.note || '').trim(),
    totalCost: round2(rows.reduce((sum, row) => sum + (Number(row.product.costPrice) || 0) * row.qty, 0)),
    items: rows.map(row => {
      const unitCost = round2(Number(row.product.costPrice) || 0)
      return {
        productId: row.product.id,
        productName: row.product.name,
        qty: row.qty,
        unitCost,
        lineCost: round2(unitCost * row.qty),
      }
    }),
  }
  db.writeOffs.unshift(writeoff)
  return writeoff
}

export function listStockWriteoffs(db) {
  ensurePosCollections(db)
  return [...db.writeOffs].sort((a, b) => String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || '')))
}

export function createStockWriteoff(db, data = {}) {
  ensurePosCollections(db)
  return buildStockWriteoff(db, data)
}

export function updateStockWriteoff(db, id, data = {}) {
  ensurePosCollections(db)
  const idx = (db.writeOffs || []).findIndex(w => w.id === id)
  if (idx < 0) throw new Error('Списание не найдено')
  const old = db.writeOffs[idx]
  const meta = {
    id: old.id,
    createdAtIso: old.createdAtIso,
    createdBy: old.createdBy,
  }
  reverseStockWriteoff(db, old)
  db.writeOffs.splice(idx, 1)
  return buildStockWriteoff(db, data, meta)
}

export function deleteStockWriteoff(db, id) {
  ensurePosCollections(db)
  const idx = (db.writeOffs || []).findIndex(w => w.id === id)
  if (idx < 0) throw new Error('Списание не найдено')
  const old = db.writeOffs[idx]
  reverseStockWriteoff(db, old)
  db.writeOffs.splice(idx, 1)
  return { id }
}

export function listStockRevisions(db) {
  ensurePosCollections(db)
  return [...db.stockRevisions].sort((a, b) => String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || '')))
}

function reverseStockRevision(db, revision) {
  for (const item of revision.items || []) {
    const product = getProduct(db, item.productId)
    product.stock = round2(item.systemStock)
    syncProductPricingFromActiveLayer(db, item.productId)
  }
}

function buildStockRevision(db, data = {}, meta = {}) {
  const rawItems = Array.isArray(data.items) ? data.items : []
  if (!rawItems.length) throw new Error('Нет строк для ревизии')
  const items = rawItems.map(raw => {
    const product = getProduct(db, raw.productId)
    const countedStock = round2(raw.countedStock)
    const systemStock = round2(product.stock)
    product.stock = countedStock
    syncProductPricingFromActiveLayer(db, product.id)
    return {
      productId: product.id,
      productName: product.name,
      systemStock,
      countedStock,
      diff: round2(countedStock - systemStock),
    }
  })
  const row = {
    id: meta.id || nextId('REV'),
    createdAtIso: meta.createdAtIso || nowIso(),
    createdBy: String(meta.createdBy || data.createdBy || '').trim(),
    note: String(data.note || '').trim(),
    items,
  }
  db.stockRevisions.unshift(row)
  return row
}

export function createStockRevision(db, data = {}) {
  ensurePosCollections(db)
  return buildStockRevision(db, data)
}

export function updateStockRevision(db, id, data = {}) {
  ensurePosCollections(db)
  const idx = (db.stockRevisions || []).findIndex(r => r.id === id)
  if (idx < 0) throw new Error('Ревизия не найдена')
  const old = db.stockRevisions[idx]
  const meta = {
    id: old.id,
    createdAtIso: old.createdAtIso,
    createdBy: old.createdBy,
  }
  reverseStockRevision(db, old)
  db.stockRevisions.splice(idx, 1)
  return buildStockRevision(db, data, meta)
}

export function deleteStockRevision(db, id) {
  ensurePosCollections(db)
  const idx = (db.stockRevisions || []).findIndex(r => r.id === id)
  if (idx < 0) throw new Error('Ревизия не найдена')
  const old = db.stockRevisions[idx]
  reverseStockRevision(db, old)
  db.stockRevisions.splice(idx, 1)
  return { id }
}

export function listExpiryItems(db, days = 14) {
  ensurePosCollections(db)
  const ms = Math.max(1, Number(days) || 14) * 24 * 60 * 60 * 1000
  const now = Date.now()
  const out = []
  for (const receipt of db.stockReceipts) {
    for (const item of receipt.items || []) {
      if (!(Number(item.remainingQty) > 0) || !item.expiryDate) continue
      const ts = new Date(item.expiryDate).getTime()
      if (Number.isNaN(ts)) continue
      const diff = ts - now
      if (diff > ms) continue
      out.push({
        receiptId: receipt.id,
        receiptCreatedAtIso: receipt.createdAtIso,
        productId: item.productId,
        productName: item.productName,
        qty: item.remainingQty,
        costPrice: Number(item.costPrice) || 0,
        retailPrice: Number(item.retailPrice) || 0,
        expiryDate: item.expiryDate,
        daysLeft: Math.ceil(diff / (24 * 60 * 60 * 1000)),
      })
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft)
}

export function listPosSales(db) {
  ensurePosCollections(db)
  ensurePosSaleNumbers(db)
  return [...db.posSales].sort((a, b) => {
    const nb = Number(b.number) || 0
    const na = Number(a.number) || 0
    if (nb !== na) return nb - na
    return String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || ''))
  })
}

export function createPosSale(db, data = {}) {
  ensurePosCollections(db)
  const rawItems = Array.isArray(data.items) ? data.items : []
  if (!rawItems.length) throw new Error('Добавьте товары в продажу')
  const rows = consumeStock(db, rawItems)
  const items = rows.map((row, idx) => {
    const raw = rawItems[idx] || {}
    const price = round2(raw.price ?? row.product.price)
    const lineCost = round2(row.cogs || 0)
    const unitCost = row.qty > 0 ? round2(lineCost / row.qty) : 0
    return {
      productId: row.product.id,
      productName: row.product.name,
      qty: row.qty,
      price,
      lineTotal: round2(price * row.qty),
      unitCost,
      lineCost,
      receiptId: row.receiptId || undefined,
    }
  })
  const total = round2(items.reduce((sum, item) => sum + item.lineTotal, 0))
  const totalCost = round2(items.reduce((sum, item) => sum + (Number(item.lineCost) || 0), 0))
  const profit = round2(total - totalCost)
  const paymentMethod = ['cash', 'card', 'credit', 'mixed'].includes(data.paymentMethod) ? data.paymentMethod : 'cash'
  const paidCash = round2(data.paidCash ?? (paymentMethod === 'cash' ? total : 0))
  const paidCard = round2(data.paidCard ?? (paymentMethod === 'card' ? total : 0))
  const debtAdded = round2(data.debtAdded ?? (paymentMethod === 'credit' ? total : 0))
  const cashReceived = round2(data.cashReceived ?? 0)
  const changeGiven = round2(data.changeGiven ?? 0)
  const cashier = data.cashierId ? db.cashiers.find(c => c.id === data.cashierId) : null
  const shift = data.shiftId ? db.posShifts.find(s => s.id === data.shiftId) : null
  if (data.shiftId && !shift) throw new Error('Смена не найдена')
  const posId = String(data.posId || shift?.posId || (db.posPoints[0]?.id || DEFAULT_POS_ID)).trim()
  // Один счётчик с онлайн-заказами: K-4864 …
  const orderId = nextOrderId(db)
  const sale = {
    id: nextId('SALE'),
    number: nextPosSaleNumber(db),
    orderId,
    createdAtIso: nowIso(),
    cashierId: cashier?.id || '',
    cashierName: cashier?.name || '',
    shiftId: shift?.id || '',
    posId,
    clientId: data.clientId || '',
    clientName: String(data.clientName || '').trim(),
    clientPhone: String(data.clientPhone || '').trim(),
    cardNum: String(data.cardNum || '').trim(),
    paymentMethod,
    total,
    totalCost,
    profit,
    paidCash,
    paidCard,
    debtAdded,
    cashReceived,
    changeGiven,
    note: String(data.note || '').trim(),
    items,
  }
  if (cashier) {
    cashier.salesCount = Number(cashier.salesCount || 0) + 1
    cashier.salesTotal = round2((Number(cashier.salesTotal) || 0) + total)
  }
  if (shift) {
    shift.salesCount = Number(shift.salesCount || 0) + 1
    shift.salesCash = round2((Number(shift.salesCash) || 0) + paidCash)
    shift.salesCard = round2((Number(shift.salesCard) || 0) + paidCard)
    shift.salesCredit = round2((Number(shift.salesCredit) || 0) + debtAdded)
  }
  if (debtAdded > 0) {
    const client = getClientById(db, data.clientId) || null
    if (client) client.debt = round2((Number(client.debt) || 0) + debtAdded)
    const card = getCardByNum(db, data.cardNum)
    if (card) card.debt = round2((Number(card.debt) || 0) + debtAdded)
  }
  db.posSales.unshift(sale)
  const baseLed = {
    posId,
    shiftId: shift?.id || '',
    cashierId: cashier?.id || '',
    cashierName: cashier?.name || '',
    refType: 'sale',
    refId: sale.id,
    createdAtIso: sale.createdAtIso,
  }
  if (paidCash > 0) {
    appendMoneyLedger(db, {
      ...baseLed,
      type: 'sale_cash',
      amount: paidCash,
      direction: 'in',
      cashAffect: true,
      reason: `Продажа нал · ${sale.orderId || sale.number}`,
    })
  }
  if (paidCard > 0) {
    appendMoneyLedger(db, {
      ...baseLed,
      type: 'sale_card',
      amount: paidCard,
      direction: 'in',
      cashAffect: false,
      reason: `Продажа карта · ${sale.orderId || sale.number}`,
    })
  }
  if (debtAdded > 0) {
    appendMoneyLedger(db, {
      ...baseLed,
      type: 'sale_credit',
      amount: debtAdded,
      direction: 'info',
      cashAffect: false,
      reason: `Продажа в долг · ${sale.clientName || sale.clientPhone || ''}`,
    })
  }
  return sale
}

/**
 * Покупка на кассе с клиентом → заказ в «Мои заказы» (сразу delivered).
 * Номер заказа берётся из sale.orderId (общий счётчик онлайн + касса).
 */
export function createClientOrderFromPosSale(db, sale, extras = {}) {
  if (!sale) return null
  const phone = String(sale.clientPhone || extras.clientPhone || '').trim()
  if (!phone) return null

  const client =
    getClientById(db, sale.clientId || extras.clientId) ||
    findClientByPhone(db, phone)

  const goodsTotal = round2(
    Number(extras.orderGoodsTotal ?? extras.goodsTotal ?? sale.total) || 0,
  )
  const bonusSpent = Math.max(0, Math.floor(Number(extras.bonusSpent) || 0))
  const payable = Math.max(0, round2(goodsTotal - bonusSpent))
  const debtAdded = round2(Number(sale.debtAdded) || 0)
  const createdAtIso = sale.createdAtIso || nowIso()
  const createdAt = nowTimeLocal()

  const items = (sale.items || []).map(item => {
    let product = null
    try {
      product = getProduct(db, item.productId)
    } catch {
      product = null
    }
    return {
      id: Number(item.productId) || 0,
      product_id: Number(item.productId) || 0,
      art: product?.art || '',
      e: product?.e || '📦',
      name: item.productName || product?.name || 'Товар',
      qty: Number(item.qty) || 0,
      unit: product?.unit || '',
      price: round2(Number(item.price) || 0),
      source: 'market',
      done: true,
    }
  })

  const pay =
    sale.paymentMethod === 'mixed'
      ? 'mixed'
      : sale.paymentMethod === 'credit'
        ? 'credit'
        : sale.paymentMethod === 'card'
          ? 'card'
          : 'cash'

  const orderId = String(sale.orderId || '').trim() || nextOrderId(db)
  sale.orderId = orderId

  const order = {
    id: orderId,
    type: 'market',
    status: 'delivered',
    channel: 'pos',
    posSaleId: sale.id,
    posSaleNumber: sale.number,
    createdAt,
    createdAtIso,
    deliveredAt: createdAt,
    deliveredAtIso: createdAtIso,
    total: payable,
    goodsTotal,
    deliveryFee: 0,
    deliveryFeeLocked: true,
    comment: extras.note || sale.note || 'Покупка в магазине',
    payment_method: pay,
    pay,
    creditAmount: debtAdded > 0 ? debtAdded : undefined,
    vip: client?.vip === true,
    priority: 'normal',
    client: {
      name: sale.clientName || client?.name || '',
      phone: phone || client?.phone || '',
      addr: client?.addr || 'Касса КАКАПО',
    },
    items,
    marketStatus: 'done',
    bonusSpent: 0,
    pickupIds: ['store'],
  }

  stampOrderForClient(order, client)
  db.orders.push(order)
  return order
}

export function returnPosSale(db, saleId, meta = {}) {
  ensurePosCollections(db)
  const sale = (db.posSales || []).find(s => String(s.id) === String(saleId))
  if (!sale) throw new Error('Чек не найден')
  if (sale.status === 'returned') throw new Error('Чек уже полностью возвращён')

  const items = Array.isArray(sale.items) ? sale.items : []
  if (!items.length) throw new Error('В чеке нет позиций')

  /** @type {{ index: number, productId: number, qty: number }[]} */
  let plan = []
  const requested = Array.isArray(meta.items) ? meta.items : null

  if (requested && requested.length) {
    for (const row of requested) {
      const index = Number.isInteger(Number(row.index)) ? Number(row.index) : -1
      let item = index >= 0 && index < items.length ? items[index] : null
      if (!item && row.productId != null) {
        item = items.find(it => {
          const left = round2((Number(it.qty) || 0) - (Number(it.returnedQty) || 0))
          return String(it.productId) === String(row.productId) && left > 0
        }) || null
      }
      if (!item) throw new Error('Позиция для возврата не найдена')
      const idx = items.indexOf(item)
      const left = round2((Number(item.qty) || 0) - (Number(item.returnedQty) || 0))
      const qty = round2(row.qty != null ? Number(row.qty) : left)
      if (!(qty > 0)) throw new Error('Количество возврата должно быть больше 0')
      if (qty > left + 1e-9) throw new Error(`Можно вернуть не больше ${left}`)
      plan.push({ index: idx, productId: Number(item.productId), qty })
    }
  } else {
    items.forEach((item, index) => {
      const left = round2((Number(item.qty) || 0) - (Number(item.returnedQty) || 0))
      if (left > 0) plan.push({ index, productId: Number(item.productId), qty: left })
    })
  }

  if (!plan.length) throw new Error('Нечего возвращать')

  // merge same index
  const byIndex = new Map()
  for (const p of plan) {
    const prev = byIndex.get(p.index)
    byIndex.set(p.index, prev ? { ...p, qty: round2(prev.qty + p.qty) } : p)
  }
  plan = [...byIndex.values()]

  const returnLines = []
  let returnTotal = 0
  for (const p of plan) {
    const item = items[p.index]
    const left = round2((Number(item.qty) || 0) - (Number(item.returnedQty) || 0))
    if (p.qty > left + 1e-9) throw new Error(`Можно вернуть не больше ${left}`)
    const unit = Number(item.qty) > 0
      ? round2((Number(item.lineTotal) || 0) / Number(item.qty))
      : round2(Number(item.price) || 0)
    const lineReturn = round2(unit * p.qty)
    item.returnedQty = round2((Number(item.returnedQty) || 0) + p.qty)
    const product = getProduct(db, item.productId)
    product.stock = round2((Number(product.stock) || 0) + p.qty)
    restoreReceiptBalance(db, item.productId, p.qty, item.receiptId || '')
    returnLines.push({
      productId: item.productId,
      productName: item.productName,
      qty: p.qty,
      price: unit,
      lineTotal: lineReturn,
    })
    returnTotal = round2(returnTotal + lineReturn)
  }

  if (!(returnTotal > 0)) throw new Error('Сумма возврата равна 0')

  if (sale.originalTotal == null) sale.originalTotal = round2(Number(sale.total) || 0)

  let remainCashCut = returnTotal
  let cutDebt = 0
  let cutCash = 0
  let cutCard = 0
  const debtBefore = round2(Number(sale.debtAdded) || 0)
  if (debtBefore > 0 && remainCashCut > 0) {
    cutDebt = Math.min(debtBefore, remainCashCut)
    remainCashCut = round2(remainCashCut - cutDebt)
  }
  const cashBefore = round2(Number(sale.paidCash) || 0)
  if (cashBefore > 0 && remainCashCut > 0) {
    cutCash = Math.min(cashBefore, remainCashCut)
    remainCashCut = round2(remainCashCut - cutCash)
  }
  const cardBefore = round2(Number(sale.paidCard) || 0)
  if (cardBefore > 0 && remainCashCut > 0) {
    cutCard = Math.min(cardBefore, remainCashCut)
    remainCashCut = round2(remainCashCut - cutCard)
  }
  // leftover (rounding) → cash then card then debt already applied
  if (remainCashCut > 0) {
    if (cashBefore - cutCash > 0) {
      const extra = Math.min(cashBefore - cutCash, remainCashCut)
      cutCash = round2(cutCash + extra)
      remainCashCut = round2(remainCashCut - extra)
    }
    if (remainCashCut > 0 && cardBefore - cutCard > 0) {
      const extra = Math.min(cardBefore - cutCard, remainCashCut)
      cutCard = round2(cutCard + extra)
      remainCashCut = round2(remainCashCut - extra)
    }
  }

  sale.debtAdded = Math.max(0, round2(debtBefore - cutDebt))
  sale.paidCash = Math.max(0, round2(cashBefore - cutCash))
  sale.paidCard = Math.max(0, round2(cardBefore - cutCard))
  sale.total = Math.max(0, round2((Number(sale.total) || 0) - returnTotal))

  if (cutDebt > 0) {
    const client = getClientById(db, sale.clientId) || null
    if (client) client.debt = Math.max(0, round2((Number(client.debt) || 0) - cutDebt))
    const card = getCardByNum(db, sale.cardNum)
    if (card) card.debt = Math.max(0, round2((Number(card.debt) || 0) - cutDebt))
  }

  const fullyReturned = items.every(it => {
    const left = round2((Number(it.qty) || 0) - (Number(it.returnedQty) || 0))
    return left <= 0
  })

  const cashier = sale.cashierId ? db.cashiers.find(c => c.id === sale.cashierId) : null
  if (cashier) {
    if (fullyReturned) cashier.salesCount = Math.max(0, Number(cashier.salesCount || 0) - 1)
    cashier.salesTotal = Math.max(0, round2((Number(cashier.salesTotal) || 0) - returnTotal))
  }
  const shift = sale.shiftId ? db.posShifts.find(s => s.id === sale.shiftId) : null
  if (shift && shift.status === 'open') {
    if (fullyReturned) shift.salesCount = Math.max(0, Number(shift.salesCount || 0) - 1)
    shift.salesCash = Math.max(0, round2((Number(shift.salesCash) || 0) - cutCash))
    shift.salesCard = Math.max(0, round2((Number(shift.salesCard) || 0) - cutCard))
    shift.salesCredit = Math.max(0, round2((Number(shift.salesCredit) || 0) - cutDebt))
  }

  if (!Array.isArray(sale.returns)) sale.returns = []
  sale.returns.push({
    atIso: nowIso(),
    total: returnTotal,
    cutCash,
    cutCard,
    cutDebt,
    note: String(meta.note || '').trim(),
    cashierId: String(meta.cashierId || '').trim(),
    items: returnLines,
  })

  sale.returnedAtIso = nowIso()
  sale.returnNote = String(meta.note || '').trim()
  sale.returnedByCashierId = String(meta.cashierId || '').trim()
  sale.status = fullyReturned ? 'returned' : 'partial'
  sale.lastReturnTotal = returnTotal
  if (sale.totalCost != null && Number(sale.originalTotal) > 0) {
    const ratio = returnTotal / Number(sale.originalTotal)
    const cutCost = round2((Number(sale.totalCost) || 0) * Math.min(1, ratio))
    sale.totalCost = Math.max(0, round2((Number(sale.totalCost) || 0) - cutCost))
    sale.profit = round2((Number(sale.total) || 0) - (Number(sale.totalCost) || 0))
  }
  const ledBase = {
    posId: sale.posId || '',
    shiftId: sale.shiftId || '',
    cashierId: String(meta.cashierId || sale.cashierId || ''),
    cashierName: sale.cashierName || '',
    refType: 'sale_return',
    refId: sale.id,
  }
  if (cutCash > 0) {
    appendMoneyLedger(db, {
      ...ledBase,
      type: 'sale_return_cash',
      amount: cutCash,
      direction: 'out',
      cashAffect: true,
      reason: `Возврат нал · ${sale.orderId || sale.number}`,
      note: String(meta.note || '').trim(),
    })
  }
  if (cutCard > 0) {
    appendMoneyLedger(db, {
      ...ledBase,
      type: 'sale_return_card',
      amount: cutCard,
      direction: 'out',
      cashAffect: false,
      reason: `Возврат карта · ${sale.orderId || sale.number}`,
      note: String(meta.note || '').trim(),
    })
  }
  return sale
}

export function getPosFinanceSummary(db) {
  ensurePosCollections(db)
  const sales = db.posSales || []
  const receipts = db.stockReceipts || []
  const expenses = db.expenses || []
  const supplierPayments = db.supplierPayments || []
  return {
    revenue: round2(sales.reduce((sum, row) => sum + (Number(row.total) || 0), 0)),
    cashRevenue: round2(sales.reduce((sum, row) => sum + (Number(row.paidCash) || 0), 0)),
    cardRevenue: round2(sales.reduce((sum, row) => sum + (Number(row.paidCard) || 0), 0)),
    creditIssued: round2(sales.reduce((sum, row) => sum + (Number(row.debtAdded) || 0), 0)),
    cogs: round2(receipts.reduce((sum, row) => sum + (Number(row.totalCost) || 0), 0)),
    expenses: round2(expenses.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)),
    supplierPayments: round2(supplierPayments.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)),
    supplierDebt: round2((db.suppliers || []).reduce((sum, row) => sum + (Number(row.payableAmount) || 0), 0)),
    clientDebt: round2((db.clients || []).reduce((sum, row) => sum + (Number(row.debt) || 0), 0)),
    salesCount: sales.length,
  }
}

export function getPosReport(db) {
  ensurePosCollections(db)
  return {
    summary: getPosFinanceSummary(db),
    topProducts: Object.values((db.posSales || []).reduce((acc, sale) => {
      for (const item of sale.items || []) {
        const key = String(item.productId)
        const prev = acc[key] || { productId: item.productId, productName: item.productName, qty: 0, revenue: 0 }
        prev.qty = round2(prev.qty + (Number(item.qty) || 0))
        prev.revenue = round2(prev.revenue + (Number(item.lineTotal) || 0))
        acc[key] = prev
      }
      return acc
    }, {})).sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    recentSales: listPosSales(db).slice(0, 20),
    openShifts: (db.posShifts || []).filter(s => s.status === 'open'),
  }
}
