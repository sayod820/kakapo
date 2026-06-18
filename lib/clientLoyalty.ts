import { suggestLevel, hasEarnedBronze, type ClientLevel } from './clientCrm'
import { loadLoyaltyStatusConfig } from './loyaltyStatusConfig'

export type LoyaltyTier = {
  id: ClientLevel
  label: string
  emoji: string
  minSpent: number
  color: string
  cashback: string
  perk: string
}

function cfgBasicTier(): LoyaltyTier {
  const b = loadLoyaltyStatusConfig().basic
  return { id: 'basic', label: b.label, emoji: b.emoji, minSpent: b.minSpent, color: b.color, cashback: b.cashback, perk: b.perk }
}

function cfgLoyaltyTiers(): LoyaltyTier[] {
  return loadLoyaltyStatusConfig().tiers.map(t => ({
    id: t.id as ClientLevel,
    label: t.label,
    emoji: t.emoji,
    minSpent: t.minSpent,
    color: t.color,
    cashback: t.cashback,
    perk: t.perk,
  }))
}

export const BASIC_CLIENT_TIER: LoyaltyTier = cfgBasicTier()

export const LOYALTY_TIERS: LoyaltyTier[] = cfgLoyaltyTiers()

export function refreshLoyaltyTiersFromConfig() {
  Object.assign(BASIC_CLIENT_TIER, cfgBasicTier())
  const next = cfgLoyaltyTiers()
  LOYALTY_TIERS.length = 0
  LOYALTY_TIERS.push(...next)
}

export function getVipRules() {
  const r = loadLoyaltyStatusConfig().vipRules
  return { minOrders: r.minOrders, minReviews: r.minReviews, minSpent: r.minSpent }
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
  refreshLoyaltyTiersFromConfig()
  const cfg = loadLoyaltyStatusConfig()
  const vipRules = cfg.vipRules
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
    remaining = earnedBronze ? 0 : Math.max(0, cfg.bronzeMinSpent - spent)
  } else if (nextTier) {
    const range = nextTier.minSpent - tier.minSpent
    const done = Math.max(0, spent - tier.minSpent)
    progressPct = range > 0 ? Math.min(100, Math.round((done / range) * 100)) : 0
    remaining = Math.max(0, nextTier.minSpent - spent)
  }

  const platinumOk = spent >= vipRules.minSpent
  const ordersOk = orderCount >= vipRules.minOrders
  const reviewsOk = reviewCount >= vipRules.minReviews

  const vipSteps: VipStep[] = [
    {
      id: 'spent',
      label: `${vipRules.minSpent.toLocaleString()} ЅМ`,
      done: platinumOk,
      progress: `${Math.min(spent, vipRules.minSpent).toLocaleString()}/${vipRules.minSpent.toLocaleString()}`,
    },
    {
      id: 'orders',
      label: `${vipRules.minOrders} заказов`,
      done: ordersOk,
      progress: `${Math.min(orderCount, vipRules.minOrders)}/${vipRules.minOrders}`,
    },
    {
      id: 'reviews',
      label: `${vipRules.minReviews} отзывов`,
      done: reviewsOk,
      progress: `${Math.min(reviewCount, vipRules.minReviews)}/${vipRules.minReviews}`,
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

/** @deprecated use getVipRules() */
export const VIP_RULES = getVipRules()
