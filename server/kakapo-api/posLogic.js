import { findClientByPhone, applyClientLoyaltyAfterDelivery } from './loyaltyBonus.js'

function nextPosOrderId(db) {
  if (!db._seq) db._seq = {}
  db._seq.pos = (db._seq.pos || 0) + 1
  return `POS-${String(db._seq.pos).padStart(5, '0')}`
}

/**
 * Продажа за прилавком (касса внутри приложения). В отличие от обычного checkout, товар
 * уже физически передан клиенту в момент оплаты — заказ сразу создаётся доставленным,
 * без очередей сборщика/курьера, и сразу проходит через штатный движок лояльности
 * (applyClientLoyaltyAfterDelivery — тот же, что и у онлайн-заказов).
 */
export function createPosSale(db, hooks, payload) {
  const rawItems = Array.isArray(payload?.items) ? payload.items : []
  if (!rawItems.length) throw new Error('Корзина пуста')

  // ─── Фаза 1: только валидация, без единой мутации — если что-то не так
  // (не хватает лимита в долг, товара не существует и т.п.), сервер не должен
  // успеть списать склад или изменить долг за заказ, который в итоге не создастся.
  const plannedItems = []
  let goodsTotal = 0

  for (const raw of rawItems) {
    const product = (db.products || []).find(p => p.id === Number(raw?.productId))
    if (!product) throw new Error(`Товар не найден (id ${raw?.productId})`)

    const qty = Number(raw?.qty) || 0
    if (qty <= 0) throw new Error(`Некорректное количество для «${product.name}»`)

    const weighted = product.sellType === 'weight'
    const price = Math.max(0, Number(raw?.price) || 0)
    goodsTotal += Math.round(price * qty * 100) / 100

    // Списываем склад только для штучных товаров — у весовых `stock` в каталоге не всегда
    // хранится в граммах/кг единообразно, автоматическое списание было бы ненадёжным.
    if (!weighted) {
      const stock = Number(product.stock) || 0
      if (stock < qty) {
        throw new Error(`Недостаточно «${product.name}» на складе (осталось ${stock})`)
      }
    }

    plannedItems.push({
      product,
      weighted,
      qty,
      item: {
        id: product.id,
        product_id: product.id,
        art: product.art || '',
        name: product.name,
        e: product.e || '📦',
        qty: weighted ? 1 : qty,
        unit: weighted ? (raw?.unit || product.unit) : product.unit,
        price,
        source: 'market',
      },
    })
  }

  goodsTotal = Math.round(goodsTotal * 100) / 100

  const phone = String(payload?.clientPhone || '').trim()
  const client = phone ? findClientByPhone(db, phone) : null

  const bonusRequested = Math.max(0, Math.floor(Number(payload?.bonusSpent) || 0))
  const bonusSpent = client
    ? Math.min(bonusRequested, Math.floor(Number(client.bonus) || 0), Math.floor(goodsTotal))
    : 0

  const requestedMethod = String(payload?.paymentMethod || 'cash')
  const paymentMethod = requestedMethod === 'credit' ? 'credit' : requestedMethod === 'card' ? 'card' : 'cash'
  const payableBeforeCredit = Math.max(0, Math.round((goodsTotal - bonusSpent) * 100) / 100)

  let card = null
  let creditAmount = 0
  if (paymentMethod === 'credit') {
    if (!client || !client.vip) throw new Error('Оплата в долг доступна только для VIP-клиентов')
    card = client.card ? hooks.findCardByNum(client.card) : null
    if (!card) card = hooks.ensureCardRowForClient(client)
    if (!card) throw new Error('Не удалось найти карту клиента')
    const debtLimit = Number(card.debtLimit) || 0
    const currentDebt = Number(card.debt) || 0
    if (currentDebt + payableBeforeCredit > debtLimit + 0.01) {
      throw new Error(`Недостаточно кредитного лимита (доступно ${Math.max(0, debtLimit - currentDebt).toFixed(2)} ЅМ)`)
    }
    creditAmount = payableBeforeCredit
  }

  // ─── Фаза 2: всё провалидировано — теперь применяем изменения.
  const items = plannedItems.map(p => p.item)
  for (const p of plannedItems) {
    if (!p.weighted) {
      p.product.stock = Math.round(((Number(p.product.stock) || 0) - p.qty) * 100) / 100
    }
  }
  if (card) {
    card.debt = Math.round(((Number(card.debt) || 0) + creditAmount) * 100) / 100
    hooks.syncClientFromCardRow(card)
  }

  const now = new Date()
  const nowIso = now.toISOString()

  const order = {
    id: nextPosOrderId(db),
    type: 'market',
    status: 'delivered',
    client: { name: client?.name || String(payload?.clientName || '').trim() || 'Розница', phone: client?.phone || '' },
    items,
    goodsTotal,
    total: goodsTotal,
    deliveryFee: 0,
    bonusSpent,
    payment_method: paymentMethod,
    pay: paymentMethod,
    ...(creditAmount > 0 ? { creditAmount } : {}),
    source: 'pos',
    cashierId: String(payload?.cashierId || ''),
    cashierName: String(payload?.cashierName || ''),
    deliveredAt: now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dushanbe' }),
    deliveredAtIso: nowIso,
    createdAtIso: nowIso,
  }

  if (!Array.isArray(db.orders)) db.orders = []
  db.orders.push(order)

  let loyalty = { earned: 0, credited: 0, bonus: client?.bonus ?? 0, orders: 0 }
  if (client?.phone) {
    loyalty = applyClientLoyaltyAfterDelivery(db, order, hooks)
  }

  if (typeof hooks?.persist === 'function') hooks.persist()
  if (typeof hooks?.broadcast === 'function') hooks.broadcast('order_update', order)

  return { order, loyalty, client: client ? findClientByPhone(db, client.phone) : null }
}
