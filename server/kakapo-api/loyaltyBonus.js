export const DEFAULT_LOYALTY = {
  welcomeBonus: 100,
  bronzeMinSpent: 1,
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
  return db.settings.loyalty
}

export function normalizePhoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-9)
}

export function findClientByPhone(db, phone) {
  const key = normalizePhoneDigits(phone)
  if (!key) return null
  return (db.clients || []).find(c => normalizePhoneDigits(c.phone) === key) || null
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

/**
 * Списание бонусов при оформлении заказа.
 * @returns {{ ok: boolean, error?: string, bonusSpent?: number }}
 */
export function applyBonusSpendOnOrder(db, order, amount, { findCardByNum, ensureCardRowForClient, syncClientFromCardRow }) {
  const use = Math.max(0, Math.floor(Number(amount) || 0))
  if (use <= 0) return { ok: true, bonusSpent: 0 }

  const phone = order.client?.phone || ''
  let client = findClientByPhone(db, phone)
  if (!client) return { ok: false, error: 'Клиент не найден' }

  let card = client.card ? findCardByNum(client.card) : null
  if (!card) {
    card = ensureCardRowForClient(client)
  }
  if (!card) return { ok: false, error: 'Карта клиента не найдена' }

  const balance = Number(card.bonus) || 0
  const deduct = Math.min(balance, use)
  if (deduct <= 0) return { ok: true, bonusSpent: 0 }

  card.bonus = Math.max(0, balance - deduct)
  client.bonus = card.bonus
  syncClientFromCardRow(card)
  order.bonusSpent = deduct
  return { ok: true, bonusSpent: deduct }
}

/**
 * Начисление бонусов и обновление spent/orders при доставке.
 * @returns {number} начисленные бонусы
 */
export function creditClientBonusOnDelivery(db, order, { findCardByNum, ensureCardRowForClient, syncClientFromCardRow }) {
  if (order.bonusCredited || order.status !== 'delivered') return 0

  const phone = order.client?.phone || ''
  if (!phone) return 0

  let client = findClientByPhone(db, phone)
  if (!client) return 0

  let card = client.card ? findCardByNum(client.card) : null
  if (!card) card = ensureCardRowForClient(client)
  if (!card) return 0

  const loyalty = ensureLoyaltySettings(db)
  const percent = getBonusPercentForClient(client, loyalty)
  const eligible = bonusEligibleTotal(order)
  const earned = calcBonusEarned(eligible, percent)
  const spentAdd = orderSpentContribution(order)

  client.orders = (Number(client.orders) || 0) + 1
  client.spent = Math.round(((Number(client.spent) || 0) + spentAdd) * 10) / 10

  if (earned > 0) {
    card.bonus = (Number(card.bonus) || 0) + earned
    client.bonus = card.bonus
  }

  syncClientFromCardRow(card)

  order.bonusCredited = true
  order.bonusEarned = earned
  return earned
}
