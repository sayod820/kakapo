import { suggestLevel, type ClientLevel } from './clientCrm'

export type LoyaltyTier = {
  id: ClientLevel
  label: string
  emoji: string
  minSpent: number
  color: string
  cashback: string
  perk: string
}

export const LOYALTY_TIERS: LoyaltyTier[] = [
  { id: 'bronze', label: 'Бронза', emoji: '🥉', minSpent: 0, color: '#CD7F32', cashback: '2%', perk: 'Бонусы за покупки' },
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
  vipSteps: VipStep[]
  vipDoneCount: number
}

export function getLoyaltyProgress(
  spent: number,
  orderCount: number,
  reviewCount: number,
  storedLevel?: ClientLevel,
): LoyaltyProgress {
  const bySpent = suggestLevel(spent)
  let effectiveLevel = bySpent
  if (storedLevel) {
    const storedIdx = LOYALTY_TIERS.findIndex(t => t.id === storedLevel)
    const spentIdx = LOYALTY_TIERS.findIndex(t => t.id === bySpent)
    if (storedIdx >= 0 && storedIdx > spentIdx) effectiveLevel = storedLevel
  }

  const tierIdx = LOYALTY_TIERS.findIndex(t => t.id === effectiveLevel)
  const tier = LOYALTY_TIERS[Math.max(0, tierIdx)] || LOYALTY_TIERS[0]
  const nextTier = LOYALTY_TIERS[tierIdx + 1] || null

  let progressPct = 100
  let remaining = 0
  if (nextTier) {
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

  return {
    spent,
    level: effectiveLevel,
    tier,
    nextTier,
    progressPct,
    remaining,
    isVip: platinumOk && ordersOk && reviewsOk,
    vipSteps,
    vipDoneCount: vipSteps.filter(s => s.done).length,
  }
}
