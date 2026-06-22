import { orderBelongsToClientAccount } from './accountLifecycle.js'

export const DEFAULT_LOYALTY = {
  welcomeBonus: 10,
  bronzeMinSpent: 500,
  tierMinSpent: { bronze: 500, silver: 1000, gold: 2000, platinum: 3000 },
  basic: { bonusPercent: 0 },
  bronze: { bonusPercent: 1 },
  silver: { bonusPercent: 2 },
  gold: { bonusPercent: 3 },
  platinum: { bonusPercent: 5 },
  vip: { bonusPercent: 5 },
  vipRules: { minOrders: 30, minReviews: 5, minSpent: 3000 },
}

export function ensureLoyaltySettings(db) {
  if (!db.settings) db.settings = {}
  if (!db.settings.loyalty) {
    db.settings.loyalty = structuredClone(DEFAULT_LOYALTY)
  }
  const l = db.settings.loyalty
  if (!l.tierMinSpent) {
    l.tierMinSpent = { ...DEFAULT_LOYALTY.tierMinSpent }
  }
  if (!l.vipRules) {
    l.vipRules = { minOrders: 30, minReviews: 5, minSpent: 3000 }
  }
  return l
}

export function currentLoyaltyPeriod(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function loyaltyPeriodForOrder(order) {
  const d = parseOrderDate(order)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function normalizePhoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-9)
}

export function phonesMatchServer(a, b) {
  const ka = normalizePhoneDigits(a)
  const kb = normalizePhoneDigits(b)
  return !!ka && !!kb && ka === kb
}

/** Доставленные заказы клиента (гибкое сравнение телефонов + телефон карты). */
export function deliveredOrdersForClient(db, phone, client = null) {
  const key = normalizePhoneDigits(phone)
  if (!key) return []
  const keys = new Set([key])
  const resolved = client || findClientByPhone(db, phone)
  if (resolved?.phone) keys.add(normalizePhoneDigits(resolved.phone))
  if (resolved?.card) {
    const card = (db.cards || []).find(c => String(c.num).toUpperCase() === String(resolved.card).toUpperCase())
    if (card?.phone) keys.add(normalizePhoneDigits(card.phone))
  }
  return (db.orders || []).filter(o => {
    if (o.status !== 'delivered') return false
    const op = normalizePhoneDigits(o.client?.phone)
    if (!op || !keys.has(op)) return false
    if (resolved) return orderBelongsToClientAccount(o, resolved)
    return true
  })
}

export function findClientByPhone(db, phone) {
  const key = normalizePhoneDigits(phone)
  if (!key) return null
  return (db.clients || []).find(c => normalizePhoneDigits(c.phone) === key) || null
}

function parseOrderDate(order) {
  const raw = order.deliveredAtIso || order.createdAtIso || order.createdAt
  if (!raw) return new Date()
  if (/^\d{4}-\d{2}-\d{2}/.test(String(raw))) {
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? new Date() : d
  }
  if (/^\d{1,2}:\d{2}/.test(String(raw))) return new Date()
  return new Date()
}

function orderInPeriod(order, period) {
  const d = parseOrderDate(order)
  const [y, m] = period.split('-').map(Number)
  return d.getFullYear() === y && d.getMonth() + 1 === m
}

export function orderSpentContribution(order) {
  return Math.round(((Number(order.total) || 0) + (Number(order.bonusSpent) || 0)) * 10) / 10
}

export function monthlyDeliveredStats(db, phone, period = currentLoyaltyPeriod(), excludeOrderId = null, client = null) {
  const key = normalizePhoneDigits(phone)
  const resolved = client || findClientByPhone(db, phone)
  const delivered = (db.orders || []).filter(o => {
    if (o.status !== 'delivered') return false
    if (normalizePhoneDigits(o.client?.phone) !== key) return false
    if (resolved && !orderBelongsToClientAccount(o, resolved)) return false
    if (excludeOrderId && String(o.id) === String(excludeOrderId)) return false
    return orderInPeriod(o, period)
  })
  return {
    orderCount: delivered.length,
    spent: Math.round(delivered.reduce((s, o) => s + orderSpentContribution(o), 0) * 10) / 10,
  }
}

export function lifetimeDeliveredStats(db, phone) {
  const key = normalizePhoneDigits(phone)
  const delivered = (db.orders || []).filter(
    o => o.status === 'delivered' && normalizePhoneDigits(o.client?.phone) === key,
  )
  return {
    orderCount: delivered.length,
    spent: Math.round(delivered.reduce((s, o) => s + orderSpentContribution(o), 0) * 10) / 10,
  }
}

export function hasEarnedBronze(spent, _orderCount, loyalty) {
  const min = Number(loyalty.bronzeMinSpent) || 500
  return spent >= min
}

export function suggestLevel(spent, loyalty = DEFAULT_LOYALTY) {
  const t = loyalty.tierMinSpent || DEFAULT_LOYALTY.tierMinSpent
  const bronzeMin = Number(loyalty.bronzeMinSpent) || t.bronze || 500
  if (spent >= t.platinum) return 'platinum'
  if (spent >= t.gold) return 'gold'
  if (spent >= t.silver) return 'silver'
  if (spent >= bronzeMin) return 'bronze'
  return 'basic'
}

export function resolveEffectiveLevel(spent, orderCount, storedLevel, storedPeriod, loyalty) {
  const period = currentLoyaltyPeriod()
  const stored = storedLevel && storedLevel !== 'new' ? storedLevel : 'basic'
  const storedActive = !!storedPeriod && storedPeriod === period
  const earned = suggestLevel(spent, loyalty)
  const earnedBronze = hasEarnedBronze(spent, orderCount, loyalty)

  if (stored !== 'basic' && (storedActive || !storedPeriod)) {
    if (!earnedBronze) return storedActive ? stored : 'basic'
    const tiers = ['basic', 'bronze', 'silver', 'gold', 'platinum']
    const earnedIdx = tiers.indexOf(earned)
    const storedIdx = tiers.indexOf(stored)
    return earnedIdx > storedIdx ? earned : stored
  }

  return earnedBronze ? earned : 'basic'
}

export function getBonusPercentForClient(client, loyalty = DEFAULT_LOYALTY) {
  if (!client) return 0
  if (client.vip) return Number(loyalty.vip?.bonusPercent) || 0
  const level = client.level || 'basic'
  if (level === 'bronze') return Number(loyalty.bronze?.bonusPercent) || 0
  if (level === 'silver') return Number(loyalty.silver?.bonusPercent) || 0
  if (level === 'gold') return Number(loyalty.gold?.bonusPercent) || 0
  if (level === 'platinum') return Number(loyalty.platinum?.bonusPercent) || 0
  return Number(loyalty.basic?.bonusPercent) || 0
}

export function bonusEligibleTotal(order) {
  const total = Number(order.total) || 0
  const bonusSpent = Number(order.bonusSpent) || 0
  const delivery = Number(order.deliveryFee) || 0
  return Math.max(0, Math.round((total + bonusSpent - delivery) * 100) / 100)
}

export function calcBonusEarned(eligibleTotal, percent) {
  if (eligibleTotal <= 0 || percent <= 0) return 0
  return Math.floor(eligibleTotal * percent / 100)
}

function marginalBandsFromLoyalty(loyalty = DEFAULT_LOYALTY) {
  const t = loyalty.tierMinSpent || DEFAULT_LOYALTY.tierMinSpent
  const bronzeMin = Number(loyalty.bronzeMinSpent) || t.bronze || 500
  return [
    { from: 0, to: bronzeMin, percent: 0 },
    { from: t.bronze, to: t.silver, percent: Number(loyalty.bronze?.bonusPercent) || 1 },
    { from: t.silver, to: t.gold, percent: Number(loyalty.silver?.bonusPercent) || 2 },
    { from: t.gold, to: t.platinum, percent: Number(loyalty.gold?.bonusPercent) || 3 },
    { from: t.platinum, to: Infinity, percent: Number(loyalty.platinum?.bonusPercent) || 5 },
  ]
}

/** Кэшбэк по ступенькам: до порога бронзы — 0%, далее % уровня на каждый диапазон. */
export function calcMarginalBonusEarned(priorEligibleSpent, orderEligible, loyalty = DEFAULT_LOYALTY, vip = false) {
  const amount = Math.max(0, Number(orderEligible) || 0)
  if (amount <= 0) return 0
  if (vip) {
    const vipPct = Number(loyalty.vip?.bonusPercent) || 0
    if (vipPct <= 0) return 0
    return Math.round(amount * vipPct / 100)
  }

  const bands = marginalBandsFromLoyalty(loyalty)
  const start = Math.max(0, Number(priorEligibleSpent) || 0)
  const end = start + amount
  let earned = 0
  for (const band of bands) {
    const overlapStart = Math.max(start, band.from)
    const overlapEnd = Math.min(end, band.to)
    const bandAmount = Math.max(0, overlapEnd - overlapStart)
    if (bandAmount > 0 && band.percent > 0) {
      earned += Math.round(bandAmount * band.percent / 100)
    }
  }
  return earned
}

function priorBonusEligibleSpent(db, phone, order, client = null, card = null) {
  const orderPeriod = loyaltyPeriodForOrder(order)
  const orderKey = orderSortKey(order)
  const orderId = String(order.id)
  const delivered = deliveredOrdersForClient(db, phone, client)
  return delivered
    .filter(o => {
      if (!isOrderBonusEligible(o, client, card)) return false
      if (loyaltyPeriodForOrder(o) !== orderPeriod) return false
      if (String(o.id) === orderId) return false
      const k = orderSortKey(o)
      if (k < orderKey) return true
      if (k > orderKey) return false
      return String(o.id) < orderId
    })
    .reduce((sum, o) => sum + bonusEligibleTotal(o), 0)
}

function findClientForOrder(db, order, hooks) {
  const phone = order.client?.phone || ''
  let client = findClientByPhone(db, phone)
  if (client) return client

  const key = normalizePhoneDigits(phone)
  if (!key) return null

  const card = (db.cards || []).find(
    c => c.status !== 'unlinked' && c.phone && normalizePhoneDigits(c.phone) === key,
  )
  if (card) {
    hooks.syncClientFromCardRow(card)
    return findClientByPhone(db, phone)
  }
  return null
}

function applyLevelUpgrade(client, card, effectiveLevel, period) {
  if (client.vip) return
  if (effectiveLevel === client.level && client.loyaltyPeriod === period) return
  client.level = effectiveLevel
  client.loyaltyPeriod = period
  if (card) {
    card.level = effectiveLevel
    card.loyaltyPeriod = period
  }
}

/** Сброс уровня в начале нового месяца (VIP не трогаем). */
function ensureClientPeriodForOrder(client, card, orderPeriod) {
  if (client.vip) {
    if (!client.loyaltyPeriod) client.loyaltyPeriod = orderPeriod
    if (card && !card.loyaltyPeriod) card.loyaltyPeriod = orderPeriod
    return
  }
  const stored = client.loyaltyPeriod || card?.loyaltyPeriod
  if (stored && stored !== orderPeriod) {
    client.level = 'basic'
    client.loyaltyPeriod = orderPeriod
    if (card) {
      card.level = 'basic'
      card.loyaltyPeriod = orderPeriod
    }
    return
  }
  if (!client.loyaltyPeriod) client.loyaltyPeriod = orderPeriod
  if (card && !card.loyaltyPeriod) card.loyaltyPeriod = orderPeriod
}

function syncClientMonthlyStats(db, client, phone, period = currentLoyaltyPeriod()) {
  const stats = monthlyDeliveredStats(db, phone, period)
  client.orders = stats.orderCount
  client.spent = stats.spent
  const lifetime = lifetimeDeliveredStats(db, phone)
  if (lifetime.orderCount > 0) {
    client.lastOrderAt = new Date().toISOString().slice(0, 10)
  }
}

function orderSortKey(order) {
  const d = parseOrderDate(order)
  return d.getTime()
}

/** С какого момента начислять кэшбэк (после ручной смены статуса в админке). */
export function getBonusEligibleFromMs(client, card = null) {
  const raw = client?.bonusEligibleFrom || card?.bonusEligibleFrom
  if (raw) {
    const d = new Date(raw)
    if (!Number.isNaN(d.getTime())) return d.getTime()
  }
  // VIP без метки: не начислять за заказы до месяца назначения
  if (client?.vip) {
    const period = client.loyaltyPeriod || card?.loyaltyPeriod
    if (period) {
      const [y, m] = period.split('-').map(Number)
      return new Date(y, m - 1, 1).getTime()
    }
    return Date.now()
  }
  return null
}

export function markBonusEligibleFrom(client, card, at = new Date()) {
  const iso = at.toISOString()
  client.bonusEligibleFrom = iso
  if (card) card.bonusEligibleFrom = iso
}

export function isOrderBonusEligible(order, client, card = null) {
  const fromMs = getBonusEligibleFromMs(client, card)
  if (fromMs == null) return true
  return orderSortKey(order) >= fromMs
}

function shouldUseVipBonus(client, card, order) {
  if (!client?.vip) return false
  return isOrderBonusEligible(order, client, card)
}

function earnBonusForOrder(db, phone, order, client, card, loyalty) {
  if (!isOrderBonusEligible(order, client, card)) return 0
  const eligible = bonusEligibleTotal(order)
  const prior = priorBonusEligibleSpent(db, phone, order, client, card)
  const vip = shouldUseVipBonus(client, card, order)
  return calcMarginalBonusEarned(prior, eligible, loyalty, vip)
}

/**
 * Списание бонусов при оформлении заказа.
 */
export function applyBonusSpendOnOrder(db, order, amount, hooks) {
  const use = Math.max(0, Math.floor(Number(amount) || 0))
  if (use <= 0) return { ok: true, bonusSpent: 0 }

  const client = findClientForOrder(db, order, hooks)
  if (!client) return { ok: false, error: 'Клиент не найден' }

  let card = client.card ? hooks.findCardByNum(client.card) : null
  if (!card) card = hooks.ensureCardRowForClient(client)
  if (!card) return { ok: false, error: 'Карта клиента не найдена' }

  const balance = Number(card.bonus) || 0
  const deduct = Math.min(balance, use)
  if (deduct <= 0) return { ok: true, bonusSpent: 0 }

  card.bonus = Math.max(0, balance - deduct)
  client.bonus = card.bonus
  hooks.syncClientFromCardRow(card)
  order.bonusSpent = deduct
  return { ok: true, bonusSpent: deduct }
}

/**
 * Начисление бонусов, обновление spent/orders и автоповышение уровня при доставке.
 */
export function creditClientBonusOnDelivery(db, order, hooks) {
  if (order.bonusCredited || order.status !== 'delivered') return 0

  const phone = order.client?.phone || ''
  if (!phone) return 0

  const client = findClientForOrder(db, order, hooks)
  if (!client) return 0

  let card = client.card ? hooks.findCardByNum(client.card) : null
  if (!card) card = hooks.ensureCardRowForClient(client)
  if (!card) return 0

  const loyalty = ensureLoyaltySettings(db)
  const orderPeriod = loyaltyPeriodForOrder(order)
  ensureClientPeriodForOrder(client, card, orderPeriod)
  const spentAdd = orderSpentContribution(order)

  const monthly = monthlyDeliveredStats(db, phone, orderPeriod, order.id)
  const monthlySpent = Math.round((monthly.spent + spentAdd) * 10) / 10
  const monthlyOrders = monthly.orderCount + 1
  const statusLevel = resolveEffectiveLevel(
    monthlySpent,
    monthlyOrders,
    client.level,
    client.loyaltyPeriod,
    loyalty,
  )
  applyLevelUpgrade(client, card, statusLevel, orderPeriod)

  const earned = earnBonusForOrder(db, phone, order, client, card, loyalty)

  if (earned > 0) {
    card.bonus = (Number(card.bonus) || 0) + earned
    client.bonus = card.bonus
  }

  syncClientMonthlyStats(db, client, phone, orderPeriod)
  hooks.syncClientFromCardRow(card)

  order.bonusCredited = true
  order.bonusEarned = earned
  return earned
}

/**
 * Пересчёт бонусов — только повышение, никогда не сбрасываем до welcome.
 */
export function reconcileClientBonuses(db, phone, hooks) {
  const key = normalizePhoneDigits(phone)
  if (!key) return { credited: 0, bonus: 0, orders: 0 }

  const client = findClientByPhone(db, phone)
  if (!client) return { credited: 0, bonus: 0, orders: 0 }

  let card = client.card ? hooks.findCardByNum(client.card) : null
  if (!card) card = hooks.ensureCardRowForClient(client)
  if (!card) return { credited: 0, bonus: 0, orders: 0 }

  const prevBonus = Number(card.bonus) || 0
  const loyalty = ensureLoyaltySettings(db)
  const welcome = Math.max(0, Number(loyalty.welcomeBonus) || 0)

  const delivered = deliveredOrdersForClient(db, phone, client)
    .sort((a, b) => orderSortKey(a) - orderSortKey(b))

  // Без заказов в базе — не трогаем баланс (иначе сброс до welcome)
  if (!delivered.length) {
    return { credited: 0, bonus: prevBonus, orders: 0, skipped: true }
  }

  let earned = 0
  for (const order of delivered) {
    const orderEarned = earnBonusForOrder(db, phone, order, client, card, loyalty)
    earned += orderEarned
    order.bonusCredited = true
    order.bonusEarned = orderEarned
  }

  const bonusSpent = delivered.reduce((s, o) => s + (Number(o.bonusSpent) || 0), 0)
  const expectedBonus = Math.max(0, welcome + earned - bonusSpent)
  const finalBonus = Math.max(prevBonus, expectedBonus)
  const delta = finalBonus - prevBonus

  if (finalBonus !== prevBonus) {
    card.bonus = finalBonus
    client.bonus = finalBonus
  }

  const period = currentLoyaltyPeriod()
  syncClientMonthlyStats(db, client, phone, period)
  const stats = monthlyDeliveredStats(db, phone, period)
  const finalLevel = resolveEffectiveLevel(
    stats.spent,
    stats.orderCount,
    client.level,
    client.loyaltyPeriod,
    loyalty,
  )
  applyLevelUpgrade(client, card, finalLevel, period)
  hooks.syncClientFromCardRow(card)

  return { credited: delta, bonus: finalBonus, orders: delivered.length }
}

/**
 * Пересчёт пропущенных бонусов для одного клиента (старые заказы без bonusCredited).
 */
export function backfillClientBonuses(db, phone, hooks) {
  const key = normalizePhoneDigits(phone)
  if (!key) return { credited: 0, orders: 0, bonus: 0 }

  const client = findClientByPhone(db, phone)
  const pending = deliveredOrdersForClient(db, phone, client)
    .filter(o => !o.bonusCredited)
    .sort((a, b) => orderSortKey(a) - orderSortKey(b))

  let totalEarned = 0
  for (const order of pending) {
    totalEarned += creditClientBonusOnDelivery(db, order, hooks)
  }

  const card = client?.card ? hooks.findCardByNum(client.card) : null
  if (card && client) hooks.syncClientFromCardRow(card)

  return {
    credited: totalEarned,
    orders: pending.length,
    bonus: client?.bonus ?? card?.bonus ?? 0,
  }
}

/**
 * Пересчёт всех пропущенных бонусов в базе (при старте сервера).
 */
export function backfillAllMissedBonuses(db, hooks) {
  const phones = new Set()
  for (const o of db.orders || []) {
    if (o.status === 'delivered' && !o.bonusCredited && o.client?.phone) {
      phones.add(normalizePhoneDigits(o.client.phone))
    }
  }
  let totalCredited = 0
  let totalOrders = 0
  for (const key of phones) {
    if (!key) continue
    const client = (db.clients || []).find(c => normalizePhoneDigits(c.phone) === key)
    const phone = client?.phone || (db.orders || []).find(
      o => normalizePhoneDigits(o.client?.phone) === key,
    )?.client?.phone
    if (!phone) continue
    const r = backfillClientBonuses(db, phone, hooks)
    totalCredited += r.credited
    totalOrders += r.orders
  }
  return { totalCredited, totalOrders, clients: phones.size }
}

/** Пересчёт всех клиентов — только повышение баланса (при старте сервера). */
export function reconcileAllClientBonuses(db, hooks) {
  const phones = new Set()
  for (const c of db.clients || []) {
    if (c.phone) phones.add(normalizePhoneDigits(c.phone))
  }
  for (const o of db.orders || []) {
    if (o.status === 'delivered' && o.client?.phone) {
      phones.add(normalizePhoneDigits(o.client.phone))
    }
  }

  let adjusted = 0
  let clients = 0
  for (const key of phones) {
    if (!key) continue
    const client = (db.clients || []).find(c => normalizePhoneDigits(c.phone) === key)
    const phone = client?.phone || (db.orders || []).find(
      o => normalizePhoneDigits(o.client?.phone) === key,
    )?.client?.phone
    if (!phone) continue
    const r = reconcileClientBonuses(db, phone, hooks)
    if (r.credited > 0) adjusted += 1
    clients += 1
  }
  return { clients, adjusted }
}
