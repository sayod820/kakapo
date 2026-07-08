// ════════════════════════════════════════════════
// KAKAPO Ритейл — точки продаж и склад (мульти-локация)
// ════════════════════════════════════════════════
// Дизайн: product.stock остаётся суммарным остатком (единственное поле,
// которое читают остальные 5 приложений — не трогаем их контракт).
// product.stockByLocation — новая, аддитивная разбивка по точкам.
// Если разбивки ещё нет и точка одна — весь product.stock считается
// принадлежащим этой единственной точке (не требует миграции данных).

function nextId(db, seqKey, prefix, pad = 5) {
  if (!db._seq) db._seq = {}
  db._seq[seqKey] = (db._seq[seqKey] || 0) + 1
  return `${prefix}-${String(db._seq[seqKey]).padStart(pad, '0')}`
}

function ensureArrays(db) {
  if (!Array.isArray(db.locations)) db.locations = []
  if (!Array.isArray(db.stockBatches)) db.stockBatches = []
}

export function listLocations(db) {
  ensureArrays(db)
  return db.locations
}

export function createLocation(db, payload) {
  ensureArrays(db)
  const name = String(payload?.name || '').trim()
  if (!name) throw new Error('Укажите название точки')
  const loc = {
    id: nextId(db, 'location', 'LOC'),
    name,
    address: String(payload?.address || '').trim(),
    type: payload?.type === 'warehouse' ? 'warehouse' : 'shop',
    isActive: true,
  }
  db.locations.push(loc)
  return loc
}

export function updateLocation(db, id, payload) {
  ensureArrays(db)
  const loc = db.locations.find(l => l.id === id)
  if (!loc) throw new Error('Точка не найдена')
  Object.assign(loc, payload, { id: loc.id })
  return loc
}

/** Остаток товара на конкретной точке (с учётом «неявной» единственной точки) */
export function stockAtLocation(db, product, locationId) {
  ensureArrays(db)
  const map = product.stockByLocation
  if (map && typeof map === 'object' && locationId in map) {
    return Number(map[locationId]) || 0
  }
  if (db.locations.length <= 1) return Number(product.stock) || 0
  return 0
}

function recalcTotalStock(product) {
  const map = product.stockByLocation
  if (!map || typeof map !== 'object') return
  product.stock = Math.round(Object.values(map).reduce((s, v) => s + (Number(v) || 0), 0) * 100) / 100
}

/** На первую операцию с несколькими точками — раскладывает существующий stock в явную карту */
function materializeStockMap(db, product) {
  ensureArrays(db)
  if (!product.stockByLocation || typeof product.stockByLocation !== 'object') {
    product.stockByLocation = {}
    const first = db.locations[0]
    if (first) product.stockByLocation[first.id] = Number(product.stock) || 0
  }
  for (const loc of db.locations) {
    if (!(loc.id in product.stockByLocation)) product.stockByLocation[loc.id] = 0
  }
  return product.stockByLocation
}

function findProduct(db, productId) {
  const product = (db.products || []).find(p => p.id === Number(productId))
  if (!product) throw new Error(`Товар не найден (id ${productId})`)
  return product
}

function findLocation(db, locationId) {
  ensureArrays(db)
  const loc = db.locations.find(l => l.id === locationId)
  if (!loc) throw new Error('Точка не найдена')
  return loc
}

/** Приход товара на точку — создаёт партию (для срока годности) и увеличивает остаток */
export function createStockIncome(db, payload) {
  ensureArrays(db)
  const locationId = String(payload?.locationId || '')
  findLocation(db, locationId)
  const rawItems = Array.isArray(payload?.items) ? payload.items : []
  if (!rawItems.length) throw new Error('Добавьте хотя бы один товар')

  const planned = rawItems.map(raw => {
    const product = findProduct(db, raw?.productId)
    const qty = Number(raw?.qty)
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Некорректное количество для «${product.name}»`)
    const costPrice = Number(raw?.costPrice) || 0
    return { product, qty, costPrice, expiryDate: raw?.expiryDate || null }
  })

  const batches = []
  for (const p of planned) {
    materializeStockMap(db, p.product)
    p.product.stockByLocation[locationId] = Math.round((((p.product.stockByLocation[locationId] || 0) + p.qty)) * 100) / 100
    if (p.costPrice > 0) p.product.costPrice = p.costPrice
    recalcTotalStock(p.product)
    const batch = {
      id: nextId(db, 'stockBatch', 'BATCH'),
      productId: p.product.id,
      productName: p.product.name,
      locationId,
      quantity: p.qty,
      expiryDate: p.expiryDate,
      costPrice: p.costPrice,
      supplierId: payload?.supplierId || null,
      receivedAtIso: new Date().toISOString(),
    }
    db.stockBatches.push(batch)
    batches.push(batch)
  }

  return {
    id: nextId(db, 'stockIncome', 'INC'),
    locationId,
    items: planned.map(p => ({ productId: p.product.id, name: p.product.name, qty: p.qty, costPrice: p.costPrice })),
    totalCost: Math.round(planned.reduce((s, p) => s + p.qty * p.costPrice, 0) * 100) / 100,
    batches,
    createdAtIso: new Date().toISOString(),
    createdBy: String(payload?.createdBy || ''),
  }
}

/** Списание — уменьшает остаток на точке, по возможности гасит партии по FIFO (по сроку годности) */
export function createStockWriteoff(db, payload) {
  ensureArrays(db)
  const locationId = String(payload?.locationId || '')
  findLocation(db, locationId)
  const rawItems = Array.isArray(payload?.items) ? payload.items : []
  if (!rawItems.length) throw new Error('Добавьте хотя бы один товар')
  const reason = String(payload?.reason || '').trim() || 'Другое'

  const planned = rawItems.map(raw => {
    const product = findProduct(db, raw?.productId)
    const qty = Number(raw?.qty)
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Некорректное количество для «${product.name}»`)
    const available = stockAtLocation(db, product, locationId)
    if (qty > available) throw new Error(`Недостаточно остатка «${product.name}» на точке (есть ${available})`)
    return { product, qty }
  })

  for (const p of planned) {
    materializeStockMap(db, p.product)
    p.product.stockByLocation[locationId] = Math.round(((p.product.stockByLocation[locationId] || 0) - p.qty) * 100) / 100
    recalcTotalStock(p.product)

    let remaining = p.qty
    const batches = db.stockBatches
      .filter(b => b.productId === p.product.id && b.locationId === locationId && b.quantity > 0)
      .sort((a, b) => (a.expiryDate || '9999') < (b.expiryDate || '9999') ? -1 : 1)
    for (const b of batches) {
      if (remaining <= 0) break
      const take = Math.min(b.quantity, remaining)
      b.quantity = Math.round((b.quantity - take) * 100) / 100
      remaining = Math.round((remaining - take) * 100) / 100
    }
  }

  return {
    id: nextId(db, 'writeoff', 'WO'),
    locationId,
    items: planned.map(p => ({ productId: p.product.id, name: p.product.name, qty: p.qty })),
    reason,
    createdAtIso: new Date().toISOString(),
    createdBy: String(payload?.createdBy || ''),
  }
}

/** Перемещение между точками — не меняет суммарный stock, только разбивку */
export function createStockTransfer(db, payload) {
  ensureArrays(db)
  const fromId = String(payload?.fromLocationId || '')
  const toId = String(payload?.toLocationId || '')
  if (!fromId || !toId) throw new Error('Укажите точки отправления и назначения')
  if (fromId === toId) throw new Error('Точки отправления и назначения совпадают')
  findLocation(db, fromId)
  findLocation(db, toId)
  const rawItems = Array.isArray(payload?.items) ? payload.items : []
  if (!rawItems.length) throw new Error('Добавьте хотя бы один товар')

  const planned = rawItems.map(raw => {
    const product = findProduct(db, raw?.productId)
    const qty = Number(raw?.qty)
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Некорректное количество для «${product.name}»`)
    const available = stockAtLocation(db, product, fromId)
    if (qty > available) throw new Error(`Недостаточно остатка «${product.name}» на точке-отправителе (есть ${available})`)
    return { product, qty }
  })

  for (const p of planned) {
    materializeStockMap(db, p.product)
    p.product.stockByLocation[fromId] = Math.round(((p.product.stockByLocation[fromId] || 0) - p.qty) * 100) / 100
    p.product.stockByLocation[toId] = Math.round(((p.product.stockByLocation[toId] || 0) + p.qty) * 100) / 100
    recalcTotalStock(p.product)

    let remaining = p.qty
    const sourceBatches = db.stockBatches
      .filter(b => b.productId === p.product.id && b.locationId === fromId && b.quantity > 0)
      .sort((a, b) => (a.expiryDate || '9999') < (b.expiryDate || '9999') ? -1 : 1)
    for (const b of sourceBatches) {
      if (remaining <= 0) break
      const take = Math.min(b.quantity, remaining)
      b.quantity = Math.round((b.quantity - take) * 100) / 100
      remaining = Math.round((remaining - take) * 100) / 100
      db.stockBatches.push({
        id: nextId(db, 'stockBatch', 'BATCH'),
        productId: p.product.id,
        productName: p.product.name,
        locationId: toId,
        quantity: take,
        expiryDate: b.expiryDate,
        costPrice: b.costPrice,
        supplierId: b.supplierId,
        receivedAtIso: b.receivedAtIso,
      })
    }
  }

  return {
    id: nextId(db, 'transfer', 'TR'),
    fromLocationId: fromId,
    toLocationId: toId,
    items: planned.map(p => ({ productId: p.product.id, name: p.product.name, qty: p.qty })),
    createdAtIso: new Date().toISOString(),
    createdBy: String(payload?.createdBy || ''),
  }
}

/** Инвентаризация — прямая корректировка остатка на точке по факту пересчёта */
export function applyStockInventory(db, payload) {
  ensureArrays(db)
  const locationId = String(payload?.locationId || '')
  findLocation(db, locationId)
  const rawItems = Array.isArray(payload?.items) ? payload.items : []
  if (!rawItems.length) throw new Error('Добавьте хотя бы один товар')

  const planned = rawItems.map(raw => {
    const product = findProduct(db, raw?.productId)
    const counted = Number(raw?.countedStock)
    if (!Number.isFinite(counted) || counted < 0) throw new Error(`Некорректный фактический остаток для «${product.name}»`)
    const systemStock = stockAtLocation(db, product, locationId)
    return { product, systemStock, counted, diff: Math.round((counted - systemStock) * 100) / 100 }
  })

  for (const p of planned) {
    materializeStockMap(db, p.product)
    p.product.stockByLocation[locationId] = p.counted
    recalcTotalStock(p.product)
  }

  const revision = {
    id: nextId(db, 'stockRevision', 'REV'),
    locationId,
    items: planned.map(p => ({ productId: p.product.id, name: p.product.name, systemStock: p.systemStock, countedStock: p.counted, diff: p.diff })),
    createdAtIso: new Date().toISOString(),
    createdBy: String(payload?.createdBy || ''),
  }
  if (!Array.isArray(db.stockRevisions)) db.stockRevisions = []
  db.stockRevisions.push(revision)
  return revision
}

export function listBatches(db, { expiringSoonDays } = {}) {
  ensureArrays(db)
  let list = db.stockBatches.filter(b => b.quantity > 0)
  if (expiringSoonDays != null) {
    const cutoff = new Date(Date.now() + expiringSoonDays * 86400000).toISOString().slice(0, 10)
    list = list.filter(b => b.expiryDate && b.expiryDate <= cutoff)
  }
  return list
}
