import { suggestLevel, hasEarnedBronze, resolveEffectiveClientLevel, type ClientLevel } from './clientCrm'
import { isLoyaltyPeriodCurrent, loyaltyPeriodEndsLabel, loyaltyPeriodLabel, currentLoyaltyPeriod } from './loyaltyPeriod'
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
  period: string
  periodLabel: string
  periodEnds: string
}

function tierIndex(level: ClientLevel): number {
  if (level === 'basic') return -1
  return LOYALTY_TIERS.findIndex(t => t.id === level)
}

export function resolveAdminVipActive(adminVip?: boolean, storedPeriod?: string): boolean {
  if (!adminVip) return false
  // Назначение админки: без периода (legacy) или текущий месяц
  if (!storedPeriod) return true
  return isLoyaltyPeriodCurrent(storedPeriod)
}

export function getLoyaltyProgress(
  spent: number,
  orderCount: number,
  reviewCount: number,
  storedLevel?: ClientLevel | 'new',
  adminVip?: boolean,
  storedPeriod?: string,
): LoyaltyProgress {
  refreshLoyaltyTiersFromConfig()
  const cfg = loadLoyaltyStatusConfig()
  const vipRules = cfg.vipRules
  const period = currentLoyaltyPeriod()
  const effectiveLevel = resolveEffectiveClientLevel(spent, orderCount, storedLevel, storedPeriod)
  const adminVipActive = resolveAdminVipActive(adminVip, storedPeriod)

  const isBasicClient = effectiveLevel === 'basic' && !adminVipActive

  const tier = isBasicClient
    ? BASIC_CLIENT_TIER
    : LOYALTY_TIERS[Math.max(0, tierIndex(effectiveLevel))] || LOYALTY_TIERS[0]

  const nextTier = isBasicClient
    ? LOYALTY_TIERS[0]
    : LOYALTY_TIERS[tierIndex(effectiveLevel) + 1] || null

  let progressPct = 100
  let remaining = 0
  if (isBasicClient && nextTier) {
    const earnedBronze = hasEarnedBronze(spent, orderCount)
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
    isVip: adminVipActive || autoVip,
    isBasicClient,
    vipSteps,
    vipDoneCount: adminVipActive ? vipSteps.length : vipSteps.filter(s => s.done).length,
    period,
    periodLabel: loyaltyPeriodLabel(period),
    periodEnds: loyaltyPeriodEndsLabel(period),
  }
}

/** @deprecated use getVipRules() */
export const VIP_RULES = getVipRules()
