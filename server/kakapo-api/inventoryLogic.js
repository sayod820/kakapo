function nextId(db, seqKey, prefix, pad = 5) {
  if (!db._seq) db._seq = {}
  db._seq[seqKey] = (db._seq[seqKey] || 0) + 1
  return `${prefix}-${String(db._seq[seqKey]).padStart(pad, '0')}`
}

/**
 * Приход товара от поставщика: увеличивает stock, обновляет costPrice на последнюю цену
 * закупки, неоплаченный остаток уходит в долг поставщику. Сначала полная валидация,
 * потом применение — как и в posLogic.js, чтобы ошибка не оставляла частичных мутаций.
 */
export function createStockReceipt(db, payload) {
  const rawItems = Array.isArray(payload?.items) ? payload.items : []
  if (!rawItems.length) throw new Error('Добавьте хотя бы один товар')

  const supplierId = String(payload?.supplierId || '').trim()
  const supplier = supplierId ? (db.suppliers || []).find(s => s.id === supplierId) : null
  if (supplierId && !supplier) throw new Error('Поставщик не найден')

  const plannedItems = []
  let totalCost = 0
  for (const raw of rawItems) {
    const product = (db.products || []).find(p => p.id === Number(raw?.productId))
    if (!product) throw new Error(`Товар не найден (id ${raw?.productId})`)
    const qty = Number(raw?.qty) || 0
    if (qty <= 0) throw new Error(`Некорректное количество для «${product.name}»`)
    const costPrice = Math.max(0, Number(raw?.costPrice) || 0)
    totalCost += Math.round(costPrice * qty * 100) / 100
    plannedItems.push({ product, qty, costPrice })
  }
  totalCost = Math.round(totalCost * 100) / 100

  const paidNow = Math.max(0, Math.min(totalCost, Number(payload?.paidNow) || 0))
  const debtDelta = Math.round((totalCost - paidNow) * 100) / 100
  if (debtDelta > 0 && !supplier) {
    throw new Error('Для прихода с неполной оплатой нужно выбрать поставщика')
  }

  for (const p of plannedItems) {
    p.product.stock = Math.round(((Number(p.product.stock) || 0) + p.qty) * 100) / 100
    p.product.costPrice = p.costPrice
  }
  if (supplier && debtDelta !== 0) {
    supplier.debt = Math.round(((Number(supplier.debt) || 0) + debtDelta) * 100) / 100
  }

  const receipt = {
    id: nextId(db, 'stockReceipt', 'RCV'),
    supplierId: supplier?.id || '',
    supplierName: supplier?.name || String(payload?.supplierName || '').trim(),
    items: plannedItems.map(p => ({ productId: p.product.id, name: p.product.name, qty: p.qty, costPrice: p.costPrice })),
    totalCost,
    paidNow,
    debtDelta,
    createdAtIso: new Date().toISOString(),
    createdBy: String(payload?.createdBy || ''),
  }
  if (!Array.isArray(db.stockReceipts)) db.stockReceipts = []
  db.stockReceipts.push(receipt)
  return receipt
}

/** Списание товара (порча/просрочка/недостача/другое) — уменьшает stock. */
export function createWriteOff(db, payload) {
  const rawItems = Array.isArray(payload?.items) ? payload.items : []
  if (!rawItems.length) throw new Error('Добавьте хотя бы один товар')
  const reason = String(payload?.reason || '').trim() || 'другое'

  const plannedItems = []
  let totalCost = 0
  for (const raw of rawItems) {
    const product = (db.products || []).find(p => p.id === Number(raw?.productId))
    if (!product) throw new Error(`Товар не найден (id ${raw?.productId})`)
    const qty = Number(raw?.qty) || 0
    if (qty <= 0) throw new Error(`Некорректное количество для «${product.name}»`)
    const stock = Number(product.stock) || 0
    if (stock < qty) throw new Error(`Недостаточно «${product.name}» на складе (осталось ${stock})`)
    const costPrice = Number(product.costPrice) || 0
    totalCost += Math.round(costPrice * qty * 100) / 100
    plannedItems.push({ product, qty, costPrice })
  }
  totalCost = Math.round(totalCost * 100) / 100

  for (const p of plannedItems) {
    p.product.stock = Math.round(((Number(p.product.stock) || 0) - p.qty) * 100) / 100
  }

  const writeOff = {
    id: nextId(db, 'writeOff', 'WO'),
    items: plannedItems.map(p => ({ productId: p.product.id, name: p.product.name, qty: p.qty, costPrice: p.costPrice })),
    reason,
    totalCost,
    createdAtIso: new Date().toISOString(),
    createdBy: String(payload?.createdBy || ''),
  }
  if (!Array.isArray(db.writeOffs)) db.writeOffs = []
  db.writeOffs.push(writeOff)
  return writeOff
}

/** Простая запись расхода — не влияет на склад. */
export function createExpense(db, payload) {
  const amount = Math.max(0, Number(payload?.amount) || 0)
  if (amount <= 0) throw new Error('Укажите сумму расхода')
  const category = String(payload?.category || '').trim() || 'другое'

  const expense = {
    id: nextId(db, 'expense', 'EXP'),
    category,
    amount,
    note: String(payload?.note || '').trim(),
    createdAtIso: new Date().toISOString(),
    createdBy: String(payload?.createdBy || ''),
  }
  if (!Array.isArray(db.expenses)) db.expenses = []
  db.expenses.push(expense)
  return expense
}

/** Погашение долга перед поставщиком (частичное или полное). */
export function paySupplierDebt(db, payload) {
  const supplierId = String(payload?.supplierId || '').trim()
  const supplier = (db.suppliers || []).find(s => s.id === supplierId)
  if (!supplier) throw new Error('Поставщик не найден')
  const amount = Math.max(0, Number(payload?.amount) || 0)
  if (amount <= 0) throw new Error('Укажите сумму погашения')
  if (amount > (Number(supplier.debt) || 0) + 0.01) throw new Error('Сумма больше текущего долга')

  supplier.debt = Math.round(((Number(supplier.debt) || 0) - amount) * 100) / 100

  const payment = {
    id: nextId(db, 'supplierPayment', 'SPAY'),
    supplierId,
    amount,
    note: String(payload?.note || '').trim(),
    createdAtIso: new Date().toISOString(),
    createdBy: String(payload?.createdBy || ''),
  }
  if (!Array.isArray(db.supplierPayments)) db.supplierPayments = []
  db.supplierPayments.push(payment)
  return payment
}

/**
 * Ревизия (инвентаризация): фактически пересчитанный остаток сразу становится новым stock,
 * разница (излишек/недостача) только фиксируется в отчёте — без отдельного workflow
 * согласования.
 */
export function applyStockRevision(db, payload) {
  const rawItems = Array.isArray(payload?.items) ? payload.items : []
  if (!rawItems.length) throw new Error('Добавьте хотя бы один товар')

  const plannedItems = []
  for (const raw of rawItems) {
    const product = (db.products || []).find(p => p.id === Number(raw?.productId))
    if (!product) throw new Error(`Товар не найден (id ${raw?.productId})`)
    const counted = Number(raw?.countedStock)
    if (!Number.isFinite(counted) || counted < 0) throw new Error(`Некорректный фактический остаток для «${product.name}»`)
    const systemStock = Number(product.stock) || 0
    plannedItems.push({ product, systemStock, counted, diff: Math.round((counted - systemStock) * 100) / 100 })
  }

  for (const p of plannedItems) {
    p.product.stock = p.counted
  }

  const revision = {
    id: nextId(db, 'stockRevision', 'REV'),
    items: plannedItems.map(p => ({
      productId: p.product.id,
      name: p.product.name,
      systemStock: p.systemStock,
      countedStock: p.counted,
      diff: p.diff,
    })),
    createdAtIso: new Date().toISOString(),
    createdBy: String(payload?.createdBy || ''),
  }
  if (!Array.isArray(db.stockRevisions)) db.stockRevisions = []
  db.stockRevisions.push(revision)
  return revision
}
