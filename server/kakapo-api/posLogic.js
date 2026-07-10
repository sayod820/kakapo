function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function nowIso() {
  return new Date().toISOString()
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

function updateSupplierDebt(db, supplierId, receiptTotal, paidNow) {
  if (!supplierId) return null
  const supplier = (db.suppliers || []).find(s => s.id === supplierId)
  if (!supplier) throw new Error('Поставщик не найден')
  const added = Math.max(0, round2(receiptTotal - paidNow))
  supplier.payableAmount = round2((supplier.payableAmount || 0) + added)
  supplier.totalSupplied = round2((supplier.totalSupplied || 0) + receiptTotal)
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

function consumeReceiptBalances(db, productId, qty) {
  let left = round2(qty)
  const receipts = (db.stockReceipts || [])
    .filter(r => Array.isArray(r.items) && r.items.some(i => Number(i.productId) === Number(productId) && Number(i.remainingQty) > 0))
    .sort((a, b) => String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || '')))
  for (const receipt of receipts) {
    for (const item of receipt.items || []) {
      if (Number(item.productId) !== Number(productId)) continue
      if (left <= 0) return
      const take = Math.min(Number(item.remainingQty) || 0, left)
      item.remainingQty = round2((Number(item.remainingQty) || 0) - take)
      left = round2(left - take)
    }
  }
  syncProductPricingFromActiveLayer(db, productId)
}

function consumeStock(db, items) {
  const normalized = items.map(raw => {
    const product = getProduct(db, raw.productId)
    const qty = round2(raw.qty)
    if (!(qty > 0)) throw new Error(`Некорректное количество для ${product.name}`)
    if (round2(product.stock) < qty) throw new Error(`Недостаточно остатка: ${product.name}`)
    return { product, qty }
  })
  for (const row of normalized) {
    row.product.stock = round2((Number(row.product.stock) || 0) - row.qty)
    consumeReceiptBalances(db, row.product.id, row.qty)
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
  const existing = db.posShifts.find(s => s.cashierId === cashier.id && s.status === 'open')
  if (existing) throw new Error('У кассира уже открыта смена')
  const row = {
    id: nextId('SHIFT'),
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
    status: 'open',
    note: String(data.note || '').trim(),
  }
  db.posShifts.unshift(row)
  return row
}

export function closePosShift(db, id, data = {}) {
  ensurePosCollections(db)
  const row = db.posShifts.find(s => s.id === id)
  if (!row) throw new Error('Смена не найдена')
  row.status = 'closed'
  row.closedAtIso = nowIso()
  row.closingCash = round2(data.closingCash)
  row.note = String(data.note || row.note || '').trim()
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
  supplier.payableAmount = round2(Math.max(0, (supplier.payableAmount || 0) - amount))
  supplier.totalPaid = round2((supplier.totalPaid || 0) + amount)
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
  return row
}

export function listStockReceipts(db) {
  ensurePosCollections(db)
  return [...db.stockReceipts].sort((a, b) => String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || '')))
}

export function createStockReceipt(db, data = {}) {
  ensurePosCollections(db)
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
    id: nextId('REC'),
    supplierId: supplier?.id || null,
    supplierName: supplier?.name || '',
    createdAtIso: nowIso(),
    createdBy: String(data.createdBy || '').trim(),
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

export function listStockWriteoffs(db) {
  ensurePosCollections(db)
  return [...db.writeOffs].sort((a, b) => String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || '')))
}

export function createStockWriteoff(db, data = {}) {
  ensurePosCollections(db)
  const rows = consumeStock(db, Array.isArray(data.items) ? data.items : [])
  const writeoff = {
    id: nextId('WOF'),
    createdAtIso: nowIso(),
    createdBy: String(data.createdBy || '').trim(),
    reason: String(data.reason || '').trim() || 'Списание',
    totalCost: round2(rows.reduce((sum, row) => sum + (Number(row.product.costPrice) || 0) * row.qty, 0)),
    items: rows.map(row => ({
      productId: row.product.id,
      productName: row.product.name,
      qty: row.qty,
    })),
  }
  db.writeOffs.unshift(writeoff)
  return writeoff
}

export function listStockRevisions(db) {
  ensurePosCollections(db)
  return [...db.stockRevisions].sort((a, b) => String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || '')))
}

export function createStockRevision(db, data = {}) {
  ensurePosCollections(db)
  const rawItems = Array.isArray(data.items) ? data.items : []
  if (!rawItems.length) throw new Error('Нет строк для ревизии')
  const items = rawItems.map(raw => {
    const product = getProduct(db, raw.productId)
    const countedStock = round2(raw.countedStock)
    const systemStock = round2(product.stock)
    product.stock = countedStock
    return {
      productId: product.id,
      productName: product.name,
      systemStock,
      countedStock,
      diff: round2(countedStock - systemStock),
    }
  })
  const row = {
    id: nextId('REV'),
    createdAtIso: nowIso(),
    createdBy: String(data.createdBy || '').trim(),
    items,
  }
  db.stockRevisions.unshift(row)
  return row
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
        productId: item.productId,
        productName: item.productName,
        qty: item.remainingQty,
        expiryDate: item.expiryDate,
        daysLeft: Math.ceil(diff / (24 * 60 * 60 * 1000)),
      })
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft)
}

export function listPosSales(db) {
  ensurePosCollections(db)
  return [...db.posSales].sort((a, b) => String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || '')))
}

export function createPosSale(db, data = {}) {
  ensurePosCollections(db)
  const rawItems = Array.isArray(data.items) ? data.items : []
  if (!rawItems.length) throw new Error('Добавьте товары в продажу')
  const rows = consumeStock(db, rawItems)
  const items = rows.map(row => {
    const price = round2(rawItems.find(x => Number(x.productId) === Number(row.product.id))?.price ?? row.product.price)
    return {
      productId: row.product.id,
      productName: row.product.name,
      qty: row.qty,
      price,
      lineTotal: round2(price * row.qty),
    }
  })
  const total = round2(items.reduce((sum, item) => sum + item.lineTotal, 0))
  const paymentMethod = ['cash', 'card', 'credit', 'mixed'].includes(data.paymentMethod) ? data.paymentMethod : 'cash'
  const paidCash = round2(data.paidCash ?? (paymentMethod === 'cash' ? total : 0))
  const paidCard = round2(data.paidCard ?? (paymentMethod === 'card' ? total : 0))
  const debtAdded = round2(data.debtAdded ?? (paymentMethod === 'credit' ? total : 0))
  const cashier = data.cashierId ? db.cashiers.find(c => c.id === data.cashierId) : null
  const shift = data.shiftId ? db.posShifts.find(s => s.id === data.shiftId) : null
  if (data.shiftId && !shift) throw new Error('Смена не найдена')
  const sale = {
    id: nextId('SALE'),
    createdAtIso: nowIso(),
    cashierId: cashier?.id || '',
    cashierName: cashier?.name || '',
    shiftId: shift?.id || '',
    clientId: data.clientId || '',
    clientName: String(data.clientName || '').trim(),
    clientPhone: String(data.clientPhone || '').trim(),
    cardNum: String(data.cardNum || '').trim(),
    paymentMethod,
    total,
    paidCash,
    paidCard,
    debtAdded,
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
