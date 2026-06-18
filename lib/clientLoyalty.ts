import { suggestLevel, hasEarnedBronze, BRONZE_MIN_SPENT, type ClientLevel } from './clientCrm'

export type LoyaltyTier = {
  id: ClientLevel
  label: string
  emoji: string
  minSpent: number
  color: string
  cashback: string
  perk: string
}

/** Базовый статус — без привилегий, пока не выполнены условия Бронзы */
export const BASIC_CLIENT_TIER: LoyaltyTier = {
  id: 'basic',
  label: 'Обычный клиент',
  emoji: '👤',
  minSpent: 0,
  color: '#8FB897',
  cashback: '—',
  perk: 'Привилегий пока нет',
}

export const LOYALTY_TIERS: LoyaltyTier[] = [
  { id: 'bronze', label: 'Бронза', emoji: '🥉', minSpent: BRONZE_MIN_SPENT, color: '#CD7F32', cashback: '2%', perk: 'Бонусы за покупки' },
  { id: 'silver', label: 'Серебро', emoji: '🥈', minSpent: 500, color: '#C0C0C0', cashback: '3%', perk: 'Доп. скидки' },
  { id: 'gold', label: 'Золото', emoji: '🥇', minSpent: 1500, color: '#FFB800', cashback: '4%', perk: 'Приоритет сборки' },
  { id: 'platinum', label: 'Platinum', emoji: '💎', minSpent: 3000, color: '#3B8EF0', cashback: '5%', perk: 'Кредитный лимит' },
]

export const VIP_RULES = {
  minOrders: 30,
  minReviews: 5,
  minSpent: 3000,
}

export type VipStep = {
  id: string
  label: string
  done: boolean
  progress: string
}

export type LoyaltyProgress = {
  spent: number
  level: ClientLevel
  tier: LoyaltyTier
  nextTier: LoyaltyTier | null
  progressPct: number
  remaining: number
  isVip: boolean
  isBasicClient: boolean
  vipSteps: VipStep[]
  vipDoneCount: number
}

function tierIndex(level: ClientLevel): number {
  if (level === 'basic') return -1
  return LOYALTY_TIERS.findIndex(t => t.id === level)
}

export function getLoyaltyProgress(
  spent: number,
  orderCount: number,
  reviewCount: number,
  storedLevel?: ClientLevel | 'new',
  adminVip?: boolean,
): LoyaltyProgress {
  const normalizedStored = storedLevel === 'new' ? 'basic' : storedLevel
  const earned = suggestLevel(spent)
  const earnedBronze = hasEarnedBronze(spent, orderCount)

  let effectiveLevel: ClientLevel = earnedBronze ? earned : 'basic'

  if (normalizedStored && normalizedStored !== 'basic') {
    const storedIdx = tierIndex(normalizedStored)
    const earnedIdx = tierIndex(earnedBronze ? earned : 'basic')
    if (storedIdx >= 0 && storedIdx > earnedIdx) effectiveLevel = normalizedStored
  }

  if (effectiveLevel === 'bronze' && !earnedBronze) effectiveLevel = 'basic'

  const isBasicClient = effectiveLevel === 'basic' && !adminVip

  const tier = isBasicClient
    ? BASIC_CLIENT_TIER
    : LOYALTY_TIERS[Math.max(0, tierIndex(effectiveLevel))] || LOYALTY_TIERS[0]

  const nextTier = isBasicClient
    ? LOYALTY_TIERS[0]
    : LOYALTY_TIERS[tierIndex(effectiveLevel) + 1] || null

  let progressPct = 100
  let remaining = 0
  if (isBasicClient && nextTier) {
    progressPct = earnedBronze ? 100 : (orderCount > 0 ? 50 : 0)
    remaining = earnedBronze ? 0 : Math.max(0, BRONZE_MIN_SPENT - spent)
  } else if (nextTier) {
    const range = nextTier.minSpent - tier.minSpent
    const done = Math.max(0, spent - tier.minSpent)
    progressPct = range > 0 ? Math.min(100, Math.round((done / range) * 100)) : 0
    remaining = Math.max(0, nextTier.minSpent - spent)
  }

  const platinumOk = spent >= VIP_RULES.minSpent
  const ordersOk = orderCount >= VIP_RULES.minOrders
  const reviewsOk = reviewCount >= VIP_RULES.minReviews

  const vipSteps: VipStep[] = [
    {
      id: 'spent',
      label: `${VIP_RULES.minSpent.toLocaleString()} ЅМ`,
      done: platinumOk,
      progress: `${Math.min(spent, VIP_RULES.minSpent).toLocaleString()}/${VIP_RULES.minSpent.toLocaleString()}`,
    },
    {
      id: 'orders',
      label: `${VIP_RULES.minOrders} заказов`,
      done: ordersOk,
      progress: `${Math.min(orderCount, VIP_RULES.minOrders)}/${VIP_RULES.minOrders}`,
    },
    {
      id: 'reviews',
      label: `${VIP_RULES.minReviews} отзывов`,
      done: reviewsOk,
      progress: `${Math.min(reviewCount, VIP_RULES.minReviews)}/${VIP_RULES.minReviews}`,
    },
  ]

  const autoVip = platinumOk && ordersOk && reviewsOk

  return {
    spent,
    level: effectiveLevel,
    tier,
    nextTier,
    progressPct,
    remaining,
    isVip: !!adminVip || autoVip,
    isBasicClient,
    vipSteps,
    vipDoneCount: adminVip ? vipSteps.length : vipSteps.filter(s => s.done).length,
  }
}
