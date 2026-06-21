'use client'

import type { Order } from './types'
import type { ClientLevel } from './clientCrm'
import { phonesMatch } from './clientCrm'
import { USE_API } from './config'
import { loadLoyaltyStatusConfig, type LoyaltyStatusConfig } from './loyaltyStatusConfig'
import { useCardStore } from './cardStore'
import { useClientStore } from './clientStore'
import { onBonusCredited } from './pushService'

export type LoyaltyTierPercents = {
  basic: number
  bronze: number
  silver: number
  gold: number
  platinum: number
  vip: number
}

export const DEFAULT_LOYALTY_PERCENTS: LoyaltyTierPercents = {
  basic: 0,
  bronze: 2,
  silver: 3,
  gold: 4,
  platinum: 5,
  vip: 5,
}

export function tierPercentsFromConfig(cfg: LoyaltyStatusConfig = loadLoyaltyStatusConfig()): LoyaltyTierPercents {
  return {
    basic: cfg.basic.bonusPercent,
    bronze: cfg.tiers.find(t => t.id === 'bronze')?.bonusPercent ?? 2,
    silver: cfg.tiers.find(t => t.id === 'silver')?.bonusPercent ?? 3,
    gold: cfg.tiers.find(t => t.id === 'gold')?.bonusPercent ?? 4,
    platinum: cfg.tiers.find(t => t.id === 'platinum')?.bonusPercent ?? 5,
    vip: cfg.vip.bonusPercent,
  }
}

export function getBonusPercentForClient(
  level: ClientLevel | string | undefined,
  vip: boolean | undefined,
  percents: LoyaltyTierPercents = DEFAULT_LOYALTY_PERCENTS,
): number {
  if (vip) return percents.vip
  const lv = level || 'basic'
  if (lv === 'bronze') return percents.bronze
  if (lv === 'silver') return percents.silver
  if (lv === 'gold') return percents.gold
  if (lv === 'platinum') return percents.platinum
  return percents.basic
}

/** Сумма товаров, с которой начисляются бонусы (без доставки, с учётом списанных бонусов). */
export function bonusEligibleTotal(order: Pick<Order, 'total' | 'deliveryFee' | 'bonusSpent'>): number {
  const total = Number(order.total) || 0
  const bonusSpent = Number(order.bonusSpent) || 0
  const delivery = Number(order.deliveryFee) || 0
  return Math.max(0, Math.round((total + bonusSpent - delivery) * 100) / 100)
}

export function calcOrderBonusEarned(
  eligibleTotal: number,
  level: ClientLevel | string | undefined,
  vip: boolean | undefined,
  cfg?: LoyaltyStatusConfig,
): number {
  const percent = getBonusPercentForClient(level, vip, tierPercentsFromConfig(cfg))
  if (eligibleTotal <= 0 || percent <= 0) return 0
  return Math.floor(eligibleTotal * percent / 100)
}

export function orderSpentContribution(order: Pick<Order, 'total' | 'bonusSpent'>): number {
  return Math.round(((Number(order.total) || 0) + (Number(order.bonusSpent) || 0)) * 10) / 10
}

export function expectedOrderBonus(
  order: Order,
  level?: ClientLevel | string,
  vip?: boolean,
): number {
  if (order.bonusEarned != null && order.status === 'delivered') return order.bonusEarned
  return calcOrderBonusEarned(bonusEligibleTotal(order), level, vip)
}

export type OrderLoyaltyPatch = {
  bonusCredited?: boolean
  bonusEarned?: number
  bonusSpent?: number
}

/** Локальный режим: начисление бонусов и обновление spent/orders при доставке. */
export function creditBonusOnDeliveryLocal(order: Order): OrderLoyaltyPatch | null {
  if (USE_API) return null
  if (order.status !== 'delivered' || order.bonusCredited) return null

  const phone = order.client?.phone || ''
  if (!phone) return null

  const clientStore = useClientStore.getState()
  const cardStore = useCardStore.getState()
  if (!clientStore.hydrated) clientStore.hydrate()
  if (!cardStore.hydrated) cardStore.hydrate()

  const client = clientStore.clients.find(c => phonesMatch(c.phone, phone))
  const card = client?.card
    ? cardStore.cards.find(c => c.num === client.card && c.status !== 'unlinked')
    : cardStore.cards.find(c => c.status === 'active' && c.phone && phonesMatch(c.phone, phone))

  const level = (client?.level || card?.level || 'basic') as ClientLevel
  const vip = !!(client?.vip || card?.vip)
  const eligible = bonusEligibleTotal(order)
  const earned = calcOrderBonusEarned(eligible, level, vip)
  const spentAdd = orderSpentContribution(order)

  if (client) {
    clientStore.updateClient(client.id, {
      orders: (client.orders || 0) + 1,
      spent: Math.round(((client.spent || 0) + spentAdd) * 10) / 10,
    })
  }

  if (card) {
    const prevBonus = card.bonus || 0
    const newBonus = prevBonus + earned
    cardStore.updateCardLoyalty(card.num, { bonus: newBonus }, { skipApi: true })
    if (earned > 0) onBonusCredited(phone, earned, card.num)
  } else if (earned > 0 && client) {
    onBonusCredited(phone, earned, client.card)
  }

  return { bonusCredited: true, bonusEarned: earned }
}
