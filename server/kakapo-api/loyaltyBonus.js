import { orderBelongsToClientAccount } from './accountLifecycle.js'
import {
  loyaltyLockRecord,
  isLevelLocked,
  isLoyaltyPeriodCurrent,
  inferLevelAssignMode,
} from './loyaltyLock.js'

export const DEFAULT_LOYALTY = {
  welcomeBonus: 10,
  bronzeMinSpent: 500,
  tierMinSpent: { bronze: 500, silver: 1000, gold: 2000, platinum: 3000 },
  basic: { bonusPercent: 0 },
  bronze: { bonusPercent: 1 },
  silver: { bonusPercent: 2 },
  gold: { bonusPercent: 3 },
  platinum: { bonusPercent: 5 },
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
  if (l.vip && l.vip.defaultDebtLimit == null) {
    l.vip.defaultDebtLimit = DEFAULT_LOYALTY.vip.defaultDebtLimit
  }
  return l
}

export function getTierDefaultDebtLimit(level, isVip, loyalty = DEFAULT_LOYALTY) {
  if (isVip) return Math.max(0, Number(loyalty.vip?.defaultDebtLimit) || 0)
  return 0
}

function qualifiesForDebtSection(level, isVip) {
  return !!isVip
}

function applyAutoDebtSection(client, card, loyalty) {
  if (inferLevelAssignMode(client, card) === 'manual') return
  const level = client?.level || card?.level || 'basic'
  const isVip = !!(client?.vip || card?.vip)
  if (!qualifiesForDebtSection(level, isVip)) return
  client.debtEnabled = true
  if (card) card.debtEnabled = true
  const limit = getTierDefaultDebtLimit(level, isVip, loyalty)
  if (limit > 0) {
    client.debtLimit = limit
    if (card) card.debtLimit = limit
  }
}

export function syncCardDebtLimitsFromLoyalty(db, syncClientFromCardRow) {
  const loyalty = ensureLoyaltySettings(db)
  for (const card of db.cards || []) {
    if (card.status !== 'active') continue
    const isVip = !!card.vip
    const level = card.level
    if (!qualifiesForDebtSection(level, isVip) && !card.debtEnabled) continue
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

/** Скользящее окно статуса/кэшбэка клиента (вместо календарного месяца). */
export const LOYALTY_WINDOW_DAYS = 30

export function loyaltyWindowStartMs(days = LOYALTY_WINDOW_DAYS, now = Date.now()) {
  return now - days * 86400000
}

function orderInLoyaltyWindow(order, days = LOYALTY_WINDOW_DAYS, now = Date.now()) {
  const t = parseOrderDate(order).getTime()
  return t >= loyaltyWindowStartMs(days, now) && t <= now
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

/** Статистика клиента за скользящее окно (по умолчанию — последние 30 дней). */
export function rollingWindowDeliveredStats(db, phone, now = Date.now(), excludeOrderId = null, client = null) {
  const key = normalizePhoneDigits(phone)
  const resolved = client || findClientByPhone(db, phone)
  const delivered = (db.orders || []).filter(o => {
    if (o.status !== 'delivered') return false
    if (normalizePhoneDigits(o.client?.phone) !== key) return false
    if (resolved && !orderBelongsToClientAccount(o, resolved)) return false
    if (excludeOrderId && String(o.id) === String(excludeOrderId)) return false
    return orderInLoyaltyWindow(o, LOYALTY_WINDOW_DAYS, now)
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

/**
 * Эффективный уровень: ручной (закреплённый админом) держится, пока не истёк срок;
 * автоматический — всегда живая функция от трат за скользящее окно, без «сброса».
 */
export function resolveEffectiveLevel(spent, orderCount, storedLevel, lock, loyalty) {
  const stored = storedLevel && storedLevel !== 'new' ? storedLevel : 'basic'
  if (isLevelLocked(lock)) return stored
  return hasEarnedBronze(spent, orderCount, loyalty) ? suggestLevel(spent, loyalty) : 'basic'
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

/** Доставленные заказы за скользящие 30 дней ДО этого заказа (для маржинального кэшбэка). */
function priorBonusEligibleSpent(db, phone, order, client = null, card = null) {
  const orderKey = orderSortKey(order)
  const windowStart = loyaltyWindowStartMs(LOYALTY_WINDOW_DAYS, orderKey)
  const orderId = String(order.id)
  const delivered = deliveredOrdersForClient(db, phone, client)
  return delivered
    .filter(o => {
      if (!isOrderMarginalBonusEligible(o, client, card)) return false
      if (String(o.id) === orderId) return false
      const k = orderSortKey(o)
      if (k < windowStart) return false
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

/** Авто-уровень — живой пересчёт из трат за скользящие 30 дней, без «срока действия». */
export function applyLevelUpgrade(db, phone, client, card, loyalty, now = Date.now()) {
  if (client.vip && isForcedVipActive(client)) return

  const lock = loyaltyLockRecord(client, card)
  if (lock.levelAssignMode === 'manual' || isLevelLocked(lock)) return

  const stats = rollingWindowDeliveredStats(db, phone, now, null, client)
  const nextLevel = earnedLevelForPeriod(stats.spent, stats.orderCount, loyalty)
  if (nextLevel === (client.level || 'basic')) return

  client.level = nextLevel
  client.loyaltyPeriod = currentLoyaltyPeriod(new Date(now))
  if (card) {
    card.level = nextLevel === 'basic' ? '' : nextLevel
    card.loyaltyPeriod = client.loyaltyPeriod
    if (client.levelAssignMode) card.levelAssignMode = client.levelAssignMode
  }
  applyAutoDebtSection(client, card, loyalty)
}

function isForcedVipActive(client) {
  if (!client?.vip) return false
  if (!client.vipUntil) return true
  const until = new Date(client.vipUntil).getTime()
  if (Number.isNaN(until)) return true
  return Date.now() <= until
}

/** Снять истёкшую РУЧНУЮ блокировку статуса и откатить на авто-расчёт по скользящему окну. */
export function clearExpiredManualLoyaltyLock(db, phone, client, card, loyalty, now = Date.now()) {
  if (client.vip && isForcedVipActive(client)) return
  if (inferLevelAssignMode(client, card) !== 'manual') return

  const levelValidUntil = client.levelValidUntil || card?.levelValidUntil
  const levelLockedPeriod = client.levelLockedPeriod || card?.levelLockedPeriod
  const untilExpired = !!(levelValidUntil && now > new Date(levelValidUntil).getTime())
  const periodLockExpired = !!(levelLockedPeriod && !isLoyaltyPeriodCurrent(levelLockedPeriod))
  if (!untilExpired && !periodLockExpired) return

  const stats = rollingWindowDeliveredStats(db, phone, now, null, client)
  const nextLevel = earnedLevelForPeriod(stats.spent, stats.orderCount, loyalty)

  client.level = nextLevel
  client.loyaltyPeriod = currentLoyaltyPeriod(new Date(now))
  client.levelLockedPeriod = undefined
  client.levelValidUntil = undefined
  client.levelAssignMode = 'auto'

  if (card) {
    card.level = nextLevel === 'basic' ? '' : nextLevel
    card.loyaltyPeriod = client.loyaltyPeriod
    card.levelLockedPeriod = undefined
    card.levelValidUntil = undefined
    card.levelAssignMode = 'auto'
  }
  applyAutoDebtSection(client, card, loyalty)
}

function syncClientRollingStats(db, client, phone, now = Date.now()) {
  const stats = rollingWindowDeliveredStats(db, phone, now, null, client)
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

/** Явная отсечка после ручной смены VIP/уровня в админке */
export function getExplicitBonusEligibleFromMs(client, card = null) {
  const raw = client?.bonusEligibleFrom || card?.bonusEligibleFrom
  if (raw) {
    const d = new Date(raw)
    if (!Number.isNaN(d.getTime())) return d.getTime()
  }
  return null
}

/** С какого момента применять VIP-% */
export function getVipBonusEligibleFromMs(client, card = null) {
  const explicit = getExplicitBonusEligibleFromMs(client, card)
  if (explicit != null) return explicit
  if (!client?.vip) return null
  const period = client.loyaltyPeriod || card?.loyaltyPeriod
  if (period) {
    const [y, m] = period.split('-').map(Number)
    return new Date(y, m - 1, 1).getTime()
  }
  return null
}

export function getBonusEligibleFromMs(client, card = null) {
  return getExplicitBonusEligibleFromMs(client, card)
}

export function isOrderMarginalBonusEligible(order, client, card = null) {
  const fromMs = getExplicitBonusEligibleFromMs(client, card)
  if (fromMs == null) return true
  return orderSortKey(order) >= fromMs
}

export function isOrderVipBonusEligible(order, client, card = null) {
  if (!client?.vip) return false
  const fromMs = getVipBonusEligibleFromMs(client, card)
  if (fromMs == null) return true
  return orderSortKey(order) >= fromMs
}

export function isOrderBonusEligible(order, client, card = null) {
  return isOrderMarginalBonusEligible(order, client, card)
}

export function markBonusEligibleFrom(client, card, at = new Date()) {
  const iso = at.toISOString()
  client.bonusEligibleFrom = iso
  if (card) card.bonusEligibleFrom = iso
}

function shouldUseVipBonus(client, card, order) {
  if (!client?.vip) return false
  return isOrderVipBonusEligible(order, client, card)
}

function earnBonusForOrder(db, phone, order, client, card, loyalty) {
  if (!isOrderMarginalBonusEligible(order, client, card)) return 0
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
  clearExpiredManualLoyaltyLock(db, phone, client, card, loyalty)

  if (inferLevelAssignMode(client, card) === 'auto' && !isLevelLocked(loyaltyLockRecord(client, card))) {
    applyLevelUpgrade(db, phone, client, card, loyalty)
  }

  applyAutoDebtSection(client, card, loyalty)

  const earned = earnBonusForOrder(db, phone, order, client, card, loyalty)

  if (earned > 0) {
    card.bonus = (Number(card.bonus) || 0) + earned
    client.bonus = card.bonus
  }

  syncClientRollingStats(db, client, phone)
  hooks.syncClientFromCardRow(card)

  order.bonusCredited = true
  order.bonusEarned = earned
  return earned
}

/**
 * Доставка (в т.ч. из админки): начислить кэшбэк, пересчитать уровень и баланс.
 */
export function applyClientLoyaltyAfterDelivery(db, order, hooks) {
  if (order.status !== 'delivered') return { earned: 0, credited: 0, bonus: 0, orders: 0 }

  const phone = order.client?.phone || ''
  const earned = creditClientBonusOnDelivery(db, order, hooks)
  if (!phone) return { earned, credited: 0, bonus: 0, orders: 0 }

  const result = reconcileClientBonuses(db, phone, hooks)
  return { earned, ...result }
}

/**
 * Отмена заказа: вернуть списанные бонусы и пересчитать кэшбэк без этого заказа.
 */
export function reverseClientBonusOnOrderCancel(db, prev, updated, hooks) {
  const phone = prev.client?.phone || updated.client?.phone || ''
  if (!phone) return { credited: 0, bonus: 0, orders: 0 }

  updated.bonusCredited = false
  updated.bonusEarned = 0

  const spent = Number(prev.bonusSpent) || 0
  if (spent > 0) {
    const client = findClientByPhone(db, phone)
    let card = client?.card ? hooks.findCardByNum(client.card) : null
    if (!card && client) card = hooks.ensureCardRowForClient(client)
    if (client && card) {
      card.bonus = (Number(card.bonus) || 0) + spent
      client.bonus = card.bonus
      updated.bonusSpent = 0
      hooks.syncClientFromCardRow(card)
    }
  }

  return reconcileClientBonuses(db, phone, hooks)
}

/**
 * Пересчёт бонусов по доставленным заказам (допускает уменьшение при отмене).
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

  // Нет доставленных заказов — welcome-бонус, статистика и уровень сбрасываются
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
    const expectedBonus = Math.max(0, welcome)
    const delta = expectedBonus - prevBonus
    if (expectedBonus !== prevBonus) {
      card.bonus = expectedBonus
      client.bonus = expectedBonus
    }
    syncClientRollingStats(db, client, phone)
    if (inferLevelAssignMode(client, card) === 'auto' && !isLevelLocked(loyaltyLockRecord(client, card))) {
      applyLevelUpgrade(db, phone, client, card, loyalty)
    }
    hooks.syncClientFromCardRow(card)
    return { credited: delta, bonus: expectedBonus, orders: 0, skipped: false }
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
  const finalBonus = expectedBonus
  const delta = finalBonus - prevBonus

  if (finalBonus !== prevBonus) {
    card.bonus = finalBonus
    client.bonus = finalBonus
  }

  syncClientRollingStats(db, client, phone)
  if (inferLevelAssignMode(client, card) === 'auto' && !isLevelLocked(loyaltyLockRecord(client, card))) {
    applyLevelUpgrade(db, phone, client, card, loyalty)
  }
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
