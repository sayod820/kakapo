import { orderBelongsToClientAccount } from './accountLifecycle.js'
import {
  loyaltyLockRecord,
  isLevelLocked,
  isAutoLevelActive,
  isLoyaltyPeriodCurrent,
  clearLevelLock,
  inferLevelAssignMode,
} from './loyaltyLock.js'

export const DEFAULT_LOYALTY = {
  welcomeBonus: 10,
  bronzeMinSpent: 500,
  tierMinSpent: { bronze: 500, silver: 1000, gold: 2000, platinum: 3000 },
  basic: { bonusPercent: 0 },
  bronze: { bonusPercent: 1 },
  silver: { bonusPercent: 2 },
  gold: { bonusPercent: 3, defaultDebtLimit: 2000 },
  platinum: { bonusPercent: 5, defaultDebtLimit: 2000 },
  vip: { bonusPercent: 5, defaultDebtLimit: 5000 },
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
    l.vipRules = { ...DEFAULT_LOYALTY.vipRules }
  }
  if (l.gold && l.gold.defaultDebtLimit == null) {
    l.gold.defaultDebtLimit = DEFAULT_LOYALTY.gold.defaultDebtLimit
  }
  if (l.platinum && l.platinum.defaultDebtLimit == null) {
    l.platinum.defaultDebtLimit = DEFAULT_LOYALTY.platinum.defaultDebtLimit
  }
  if (l.vip && l.vip.defaultDebtLimit == null) {
    l.vip.defaultDebtLimit = DEFAULT_LOYALTY.vip.defaultDebtLimit
  }
  return l
}

export function getTierDefaultDebtLimit(level, isVip, loyalty = DEFAULT_LOYALTY) {
  if (isVip) return Math.max(0, Number(loyalty.vip?.defaultDebtLimit) || 0)
  if (!level || level === 'basic' || level === 'new') return 0
  if (level === 'gold') return Math.max(0, Number(loyalty.gold?.defaultDebtLimit) || 0)
  if (level === 'platinum') return Math.max(0, Number(loyalty.platinum?.defaultDebtLimit) || 0)
  return 0
}

export function syncCardDebtLimitsFromLoyalty(db, syncClientFromCardRow) {
  const loyalty = ensureLoyaltySettings(db)
  for (const card of db.cards || []) {
    if (card.status !== 'active') continue
    const isVip = !!card.vip
    const debtEnabled = !!card.debtEnabled
    const level = card.level
    if (!isVip && !debtEnabled && level !== 'gold' && level !== 'platinum') continue
    const tierLimit = getTierDefaultDebtLimit(level, isVip, loyalty)
    if (tierLimit <= 0) continue
    if (Number(card.debtLimit) === tierLimit) continue
    card.debtLimit = tierLimit
    if (typeof syncClientFromCardRow === 'function') syncClientFromCardRow(card)
  }
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

function orderItemsSubtotal(order) {
  const items = Array.isArray(order?.items) ? order.items : []
  if (!items.length) return 0
  return Math.round(
    items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 1), 0) * 100,
  ) / 100
}

export function orderSpentContribution(order) {
  return bonusEligibleTotal(order)
}

export function bonusEligibleTotal(order) {
  const fromItems = orderItemsSubtotal(order)
  if (fromItems > 0) return fromItems

  const total = Number(order.total) || 0
  const bonusSpent = Number(order.bonusSpent) || 0
  const delivery = Number(order.deliveryFee) || 0
  return Math.max(0, Math.round((total + bonusSpent - delivery) * 100) / 100)
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

export function lifetimeDeliveredStats(db, phone, client = null) {
  const key = normalizePhoneDigits(phone)
  const resolved = client || findClientByPhone(db, phone)
  const delivered = (db.orders || []).filter(o => {
    if (o.status !== 'delivered') return false
    if (normalizePhoneDigits(o.client?.phone) !== key) return false
    if (resolved) return orderBelongsToClientAccount(o, resolved)
    return true
  })
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

export function earnedLevelForPeriod(spent, orderCount, loyalty = DEFAULT_LOYALTY) {
  if (!hasEarnedBronze(spent, orderCount, loyalty)) return 'basic'
  return suggestLevel(spent, loyalty)
}

const TIER_ORDER = ['basic', 'bronze', 'silver', 'gold', 'platinum']

function tierIndex(level) {
  const i = TIER_ORDER.indexOf(level || 'basic')
  return i >= 0 ? i : 0
}

function shouldAutoUpgradeLevel(stored, effective, storedPeriod, lock) {
  if (isLevelLocked(lock)) return false
  const period = currentLoyaltyPeriod()
  if (!storedPeriod) {
    if (!stored || stored === 'basic') return effective !== 'basic'
    return tierIndex(effective) > tierIndex(stored)
  }
  if (!isLoyaltyPeriodCurrent(storedPeriod) && effective === 'basic' && stored !== 'basic') return true
  if (effective === stored && isLoyaltyPeriodCurrent(storedPeriod)) return false
  if (!stored || stored === 'basic') return effective !== 'basic'
  if (!isLoyaltyPeriodCurrent(storedPeriod)) return effective !== 'basic'
  return tierIndex(effective) > tierIndex(stored)
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

function applyLevelUpgrade(db, phone, client, card, orderPeriod, loyalty) {
  if (client.vip && isForcedVipActive(client)) return

  const lock = loyaltyLockRecord(client, card)
  const mode = lock.levelAssignMode
  const stats = monthlyDeliveredStats(db, phone, orderPeriod, null, client)
  const earned = earnedLevelForPeriod(stats.spent, stats.orderCount, loyalty)
  const effective = resolveEffectiveLevel(
    stats.spent,
    stats.orderCount,
    client.level,
    client.loyaltyPeriod,
    loyalty,
  )

  if (mode === 'manual' && isLevelLocked(lock)) return

  let nextLevel = client.level || 'basic'

  if (mode === 'manual' && !isLevelLocked(lock) && nextLevel !== 'basic') {
    nextLevel = earned
    clearLevelLock(client, card)
    client.levelAssignMode = 'auto'
    if (card) card.levelAssignMode = 'auto'
  } else if (mode === 'auto' && !isAutoLevelActive(lock)) {
    nextLevel = earned
  } else if (mode === 'auto' && isAutoLevelActive(lock)) {
    if (!shouldAutoUpgradeLevel(client.level, effective, client.loyaltyPeriod, lock)) return
    nextLevel = effective
  } else {
    return
  }

  if (nextLevel === (client.level || 'basic') && client.loyaltyPeriod === orderPeriod) return

  client.level = nextLevel
  client.loyaltyPeriod = orderPeriod
  if (card) {
    card.level = nextLevel === 'basic' ? '' : nextLevel
    card.loyaltyPeriod = orderPeriod
    if (client.levelAssignMode) card.levelAssignMode = client.levelAssignMode
  }
}

function isForcedVipActive(client) {
  if (!client?.vip) return false
  if (!client.vipUntil) return true
  const until = new Date(client.vipUntil).getTime()
  if (Number.isNaN(until)) return true
  return Date.now() <= until
}

/** Сброс уровня в начале нового месяца с учётом auto/manual. */
function ensureClientPeriodForOrder(db, phone, client, card, orderPeriod, loyalty) {
  if (client.vip && isForcedVipActive(client)) {
    if (!client.loyaltyPeriod) client.loyaltyPeriod = orderPeriod
    if (card && !card.loyaltyPeriod) card.loyaltyPeriod = orderPeriod
    return
  }

  const stored = client.loyaltyPeriod || card?.loyaltyPeriod
  if (!stored || stored === orderPeriod) {
    if (!client.loyaltyPeriod) client.loyaltyPeriod = orderPeriod
    if (card && !card.loyaltyPeriod) card.loyaltyPeriod = orderPeriod
    return
  }

  const assignMode = inferLevelAssignMode(client, card)
  const levelValidUntil = client.levelValidUntil || card?.levelValidUntil
  const untilExpired = !!(levelValidUntil && Date.now() > new Date(levelValidUntil).getTime())
  const manualLockMonth = !!(client.levelLockedPeriod === stored || card?.levelLockedPeriod === stored)
  const stillManualLocked = assignMode === 'manual'
    && !untilExpired
    && !manualLockMonth
    && (levelValidUntil || client.levelLockedPeriod || card?.levelLockedPeriod)

  const stats = monthlyDeliveredStats(db, phone, stored, null, client)
  const earned = earnedLevelForPeriod(stats.spent, stats.orderCount, loyalty)
  const curLevel = client.level || 'basic'

  let nextLevel = 'basic'
  if (assignMode === 'manual' && stillManualLocked) {
    nextLevel = curLevel
  } else if (assignMode === 'manual' && (manualLockMonth || untilExpired)) {
    nextLevel = earned
  } else if (assignMode === 'auto') {
    nextLevel = 'basic'
  } else if (manualLockMonth) {
    nextLevel = earned
  }

  const clearManualLock = manualLockMonth || untilExpired
  client.level = nextLevel
  client.loyaltyPeriod = orderPeriod
  client.levelLockedPeriod = clearManualLock ? undefined : client.levelLockedPeriod
  client.levelValidUntil = untilExpired ? undefined : levelValidUntil
  client.levelAssignMode = (clearManualLock && assignMode === 'manual') ? 'auto' : assignMode

  if (card) {
    card.level = nextLevel === 'basic' ? '' : nextLevel
    card.loyaltyPeriod = orderPeriod
    card.levelLockedPeriod = clearManualLock ? undefined : card.levelLockedPeriod
    card.levelValidUntil = untilExpired ? undefined : levelValidUntil
    card.levelAssignMode = client.levelAssignMode
  }
}

function syncClientMonthlyStats(db, client, phone, period = currentLoyaltyPeriod()) {
  const stats = monthlyDeliveredStats(db, phone, period, null, client)
  client.orders = stats.orderCount
  client.spent = stats.spent
  const lifetime = lifetimeDeliveredStats(db, phone, client)
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
  const goodsCap = Math.floor(bonusEligibleTotal(order))
  const deduct = Math.min(balance, use, goodsCap)
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
  ensureClientPeriodForOrder(db, phone, client, card, orderPeriod, loyalty)

  applyLevelUpgrade(db, phone, client, card, orderPeriod, loyalty)

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

  // Нет заказов этого поколения аккаунта — обнуляем месячную статистику и уровень
  if (!delivered.length) {
    const period = currentLoyaltyPeriod()
    client.orders = 0
    client.spent = 0
    if (!client.vip) {
      const lock = loyaltyLockRecord(client, card)
      if (!(inferLevelAssignMode(client, card) === 'manual' && isLevelLocked(lock))) {
        client.level = 'basic'
        card.level = ''
      }
      client.loyaltyPeriod = period
    }
    syncClientMonthlyStats(db, client, phone, period)
    hooks.syncClientFromCardRow(card)
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
  applyLevelUpgrade(db, phone, client, card, period, loyalty)
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
