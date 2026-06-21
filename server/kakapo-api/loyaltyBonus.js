export const DEFAULT_LOYALTY = {
  welcomeBonus: 100,
  bronzeMinSpent: 1,
  tierMinSpent: { bronze: 1, silver: 500, gold: 1500, platinum: 3000 },
  basic: { bonusPercent: 0 },
  bronze: { bonusPercent: 2 },
  silver: { bonusPercent: 3 },
  gold: { bonusPercent: 4 },
  platinum: { bonusPercent: 5 },
  vip: { bonusPercent: 5 },
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
  return l
}

export function currentLoyaltyPeriod(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function normalizePhoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-9)
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

export function monthlyDeliveredStats(db, phone, period = currentLoyaltyPeriod()) {
  const key = normalizePhoneDigits(phone)
  const delivered = (db.orders || []).filter(
    o => o.status === 'delivered' && normalizePhoneDigits(o.client?.phone) === key && orderInPeriod(o, period),
  )
  return {
    orderCount: delivered.length,
    spent: Math.round(delivered.reduce((s, o) => s + orderSpentContribution(o), 0) * 10) / 10,
  }
}

export function hasEarnedBronze(spent, orderCount, loyalty) {
  const min = Number(loyalty.bronzeMinSpent) || 1
  return spent >= min || orderCount >= 1
}

export function suggestLevel(spent, loyalty = DEFAULT_LOYALTY) {
  const t = loyalty.tierMinSpent || DEFAULT_LOYALTY.tierMinSpent
  if (spent >= t.platinum) return 'platinum'
  if (spent >= t.gold) return 'gold'
  if (spent >= t.silver) return 'silver'
  if (spent >= (Number(loyalty.bronzeMinSpent) || t.bronze || 1)) return 'bronze'
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

export function orderSpentContribution(order) {
  return Math.round(((Number(order.total) || 0) + (Number(order.bonusSpent) || 0)) * 10) / 10
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
  const period = currentLoyaltyPeriod()
  const spentAdd = orderSpentContribution(order)

  client.orders = (Number(client.orders) || 0) + 1
  client.spent = Math.round(((Number(client.spent) || 0) + spentAdd) * 10) / 10
  client.lastOrderAt = new Date().toISOString().slice(0, 10)

  const monthly = monthlyDeliveredStats(db, phone, period)
  const monthlySpent = Math.round((monthly.spent + spentAdd) * 10) / 10
  const monthlyOrders = monthly.orderCount + 1
  const effectiveLevel = resolveEffectiveLevel(
    monthlySpent,
    monthlyOrders,
    client.level,
    client.loyaltyPeriod,
    loyalty,
  )
  applyLevelUpgrade(client, card, effectiveLevel, period)

  const eligible = bonusEligibleTotal(order)
  const percent = getBonusPercentForClient({ ...client, level: effectiveLevel }, loyalty)
  const earned = calcBonusEarned(eligible, percent)

  if (earned > 0) {
    card.bonus = (Number(card.bonus) || 0) + earned
    client.bonus = card.bonus
  }

  hooks.syncClientFromCardRow(card)

  order.bonusCredited = true
  order.bonusEarned = earned
  return earned
}
