// ════════════════════════════════════════════════
// KAKAPO Ритейл — касса (till) на конкретной точке продаж
// ════════════════════════════════════════════════
import { findClientByPhone, applyClientLoyaltyAfterDelivery, reverseClientBonusOnOrderCancel } from './loyaltyBonus.js'
import { findLocation, findProduct, stockAtLocation, materializeStockMap, recalcTotalStock } from './retailLogic.js'

function nextId(db, seqKey, prefix, pad = 5) {
  if (!db._seq) db._seq = {}
  db._seq[seqKey] = (db._seq[seqKey] || 0) + 1
  return `${prefix}-${String(db._seq[seqKey]).padStart(pad, '0')}`
}
function ensureArrays(db) {
  if (!Array.isArray(db.tillShifts)) db.tillShifts = []
}

/* ── Смена кассы на точке ── */
export function getOpenTillShift(db, locationId, cashierName) {
  ensureArrays(db)
  return db.tillShifts.find(s => s.locationId === locationId && s.cashierName === cashierName && s.status === 'open') || null
}

export function openTillShift(db, payload) {
  ensureArrays(db)
  const locationId = String(payload?.locationId || '')
  findLocation(db, locationId)
  const cashierName = String(payload?.cashierName || '').trim()
  if (!cashierName) throw new Error('Укажите кассира')
  if (getOpenTillShift(db, locationId, cashierName)) throw new Error('У этого кассира уже есть открытая смена на этой точке')
  const shift = {
    id: nextId(db, 'tillShift', 'TSH'),
    locationId,
    cashierName,
    openingCash: Math.max(0, Number(payload?.openingCash) || 0),
    openedAtIso: new Date().toISOString(),
    closedAtIso: null,
    closingCashDeclared: null,
    expectedCash: null,
    difference: null,
    status: 'open',
  }
  db.tillShifts.push(shift)
  return shift
}

export function closeTillShift(db, payload) {
  ensureArrays(db)
  const locationId = String(payload?.locationId || '')
  const cashierName = String(payload?.cashierName || '').trim()
  const shift = getOpenTillShift(db, locationId, cashierName)
  if (!shift) throw new Error('Нет открытой смены для этого кассира на этой точке')

  const shiftOrders = (db.orders || []).filter(o => o.shiftId === shift.id)
  const delivered = shiftOrders.filter(o => o.status === 'delivered')
  const cashTotal = delivered.filter(o => o.payment_method === 'cash').reduce((s, o) => s + (Number(o.goodsTotal) || 0), 0)
  const cardTotal = delivered.filter(o => o.payment_method === 'card').reduce((s, o) => s + (Number(o.goodsTotal) || 0), 0)
  const debtTotal = delivered.filter(o => o.payment_method === 'credit').reduce((s, o) => s + (Number(o.goodsTotal) || 0), 0)

  const expectedCash = Math.round((shift.openingCash + cashTotal) * 100) / 100
  const declared = Math.max(0, Number(payload?.closingCashDeclared) || 0)

  shift.closedAtIso = new Date().toISOString()
  shift.closingCashDeclared = declared
  shift.expectedCash = expectedCash
  shift.difference = Math.round((declared - expectedCash) * 100) / 100
  shift.status = 'closed'
  shift.revenue = Math.round((cashTotal + cardTotal + debtTotal) * 100) / 100
  shift.checks = delivered.length
  shift.cashTotal = Math.round(cashTotal * 100) / 100
  shift.cardTotal = Math.round(cardTotal * 100) / 100
  shift.debtTotal = Math.round(debtTotal * 100) / 100
  return shift
}

/* ── Продажа в кассе ── */
export function createTillSale(db, hooks, payload) {
  const locationId = String(payload?.locationId || '')
  findLocation(db, locationId)
  const cashierName = String(payload?.cashierName || '').trim()
  const shift = getOpenTillShift(db, locationId, cashierName)
  if (!shift) throw new Error('Нет открытой смены — откройте смену перед продажей')

  const rawItems = Array.isArray(payload?.items) ? payload.items : []
  if (!rawItems.length) throw new Error('Чек пуст')
  const paymentMethodRaw = String(payload?.paymentMethod || 'cash')
  const paymentMethod = paymentMethodRaw === 'debt' ? 'credit' : paymentMethodRaw
  if (!['cash', 'card', 'credit'].includes(paymentMethod)) throw new Error('Неизвестный способ оплаты')

  // ── Фаза 1: валидация, без мутаций ──
  const planned = rawItems.map(raw => {
    const product = findProduct(db, raw?.productId)
    const qty = Number(raw?.qty)
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Некорректное количество для «${product.name}»`)
    const price = Number(raw?.price)
    if (!Number.isFinite(price) || price < 0) throw new Error(`Некорректная цена для «${product.name}»`)
    const available = stockAtLocation(db, product, locationId)
    if (qty > available) throw new Error(`Недостаточно остатка «${product.name}» на точке (есть ${available})`)
    return { product, qty, price, unit: raw?.unit || product.unit }
  })
  const goodsTotal = Math.round(planned.reduce((s, p) => s + p.qty * p.price, 0) * 100) / 100

  const phone = String(payload?.clientPhone || '').trim()
  const client = phone ? findClientByPhone(db, phone) : null
  if (phone && !client) throw new Error('Клиент с таким телефоном не найден')

  let card = null
  if (client?.card) card = hooks.findCardByNum(client.card)

  const bonusRequested = Math.max(0, Number(payload?.bonusSpent) || 0)
  const bonusAvailable = client ? Math.min(Number(client.bonus) || 0, goodsTotal) : 0
  const bonusSpent = Math.min(bonusRequested, bonusAvailable)

  if (paymentMethod === 'credit') {
    if (!client) throw new Error('Для продажи в долг нужно выбрать клиента')
    const debtEnabled = client.debtEnabled === true || (Number(client.debt) || 0) > 0 || (Number(client.debtLimit) || 0) > 0
    if (!debtEnabled) throw new Error('У этого клиента не включён раздел долга')
    const currentDebt = Number(client.debt) || 0
    const debtLimit = Number(client.debtLimit) || 0
    const amountAfterBonus = Math.max(0, goodsTotal - bonusSpent)
    if (debtLimit > 0 && currentDebt + amountAfterBonus > debtLimit) {
      throw new Error(`Превышен лимит долга (лимит ${debtLimit}, текущий долг ${currentDebt})`)
    }
  }

  // ── Фаза 2: применяем ──
  for (const p of planned) {
    materializeStockMap(db, p.product)
    p.product.stockByLocation[locationId] = Math.round(((p.product.stockByLocation[locationId] || 0) - p.qty) * 100) / 100
    recalcTotalStock(p.product)
  }

  const payable = Math.max(0, Math.round((goodsTotal - bonusSpent) * 100) / 100)
  const nowIso = new Date().toISOString()
  const order = {
    id: nextId(db, 'tillOrder', 'TILL'),
    type: 'market',
    status: 'delivered',
    createdAt: new Date().toLocaleString('ru-RU'),
    createdAtIso: nowIso,
    client: { name: client?.name || 'Розница', phone: client?.phone || '' },
    items: planned.map(p => ({
      id: p.product.id,
      product_id: p.product.id,
      art: p.product.art,
      e: p.product.e,
      name: p.product.name,
      qty: p.qty,
      unit: p.unit,
      price: p.price,
    })),
    goodsTotal,
    total: payable,
    deliveryFee: 0,
    bonusSpent,
    payment_method: paymentMethod,
    pay: paymentMethod,
    source: 'retail-till',
    locationId,
    shiftId: shift.id,
    cashierName,
    deliveredAt: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
    deliveredAtIso: nowIso,
  }
  if (!Array.isArray(db.orders)) db.orders = []
  db.orders.push(order)

  if (paymentMethod === 'credit' && client) {
    if (!card) card = hooks.ensureCardRowForClient(client)
    if (card) {
      card.debt = Math.round(((Number(card.debt) || 0) + payable) * 100) / 100
      hooks.syncClientFromCardRow(card)
    }
  }
  if (bonusSpent > 0 && client) {
    if (!card) card = hooks.ensureCardRowForClient(client)
    if (card) {
      card.bonus = Math.max(0, Math.round(((Number(card.bonus) || 0) - bonusSpent) * 100) / 100)
      hooks.syncClientFromCardRow(card)
    }
  }

  let loyalty = { earned: 0, credited: 0, bonus: 0, orders: 0 }
  if (client?.phone) {
    loyalty = applyClientLoyaltyAfterDelivery(db, order, hooks)
  }

  if (typeof hooks?.persist === 'function') hooks.persist()
  if (typeof hooks?.broadcast === 'function') hooks.broadcast('order_update', order)

  return { order, loyalty }
}

/* ── Возврат чека кассы ── */
export function createTillReturn(db, hooks, payload) {
  const orderId = String(payload?.orderId || '').trim()
  if (!orderId) throw new Error('Не указан чек для возврата')
  const order = (db.orders || []).find(o => o.id === orderId)
  if (!order) throw new Error('Чек не найден')
  if (order.source !== 'retail-till') throw new Error('Возврат в кассе доступен только для чеков, пробитых в этой кассе')
  if (order.status === 'cancelled') throw new Error('Этот чек уже возвращён/отменён')

  const prev = { ...order, client: { ...order.client } }
  for (const it of order.items || []) {
    const product = (db.products || []).find(p => p.id === Number(it.product_id ?? it.id))
    if (!product || !order.locationId) continue
    materializeStockMap(db, product)
    product.stockByLocation[order.locationId] = Math.round(((product.stockByLocation[order.locationId] || 0) + (Number(it.qty) || 0)) * 100) / 100
    recalcTotalStock(product)
  }

  if (order.payment_method === 'credit' && order.client?.phone) {
    const client = findClientByPhone(db, order.client.phone)
    let card = client?.card ? hooks.findCardByNum(client.card) : null
    if (!card && client) card = hooks.ensureCardRowForClient(client)
    if (card) {
      card.debt = Math.max(0, Math.round(((Number(card.debt) || 0) - Number(order.total)) * 100) / 100)
      hooks.syncClientFromCardRow(card)
    }
  }

  order.status = 'cancelled'
  order.cancelReason = 'Возврат в кассе'

  let loyalty = { credited: 0, bonus: 0, orders: 0 }
  if (order.client?.phone) {
    loyalty = reverseClientBonusOnOrderCancel(db, prev, order, hooks)
  }

  if (typeof hooks?.persist === 'function') hooks.persist()
  if (typeof hooks?.broadcast === 'function') hooks.broadcast('order_update', order)
  return { order, loyalty }
}

/* ── Коррекция суммы уже пробитого чека ── */
export function applyTillCorrection(db, payload) {
  const orderId = String(payload?.orderId || '').trim()
  const order = (db.orders || []).find(o => o.id === orderId)
  if (!order) throw new Error('Чек не найден')
  if (order.source !== 'retail-till') throw new Error('Коррекция доступна только для чеков этой кассы')
  if (order.status === 'cancelled') throw new Error('Нельзя скорректировать отменённый чек')
  const delta = Number(payload?.delta)
  if (!Number.isFinite(delta) || delta === 0) throw new Error('Укажите сумму коррекции')
  const reason = String(payload?.reason || '').trim()
  order.goodsTotal = Math.max(0, Math.round((Number(order.goodsTotal) + delta) * 100) / 100)
  order.total = Math.max(0, Math.round((Number(order.total) + delta) * 100) / 100)
  order.correctionReason = reason
  order.correctedAtIso = new Date().toISOString()
  return order
}
