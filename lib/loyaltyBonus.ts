'use client'

import type { Order } from './types'
import type { ClientLevel } from './clientCrm'
import {
  phonesMatch,
  loyaltyStatsFromOrders,
  resolveEffectiveClientLevel,
} from './clientCrm'
import { USE_API } from './config'
import { api } from './api'
import { loadLoyaltyStatusConfig, type LoyaltyStatusConfig } from './loyaltyStatusConfig'
import { useCardStore } from './cardStore'
import { useClientStore } from './clientStore'
import { onBonusCredited } from './pushService'
import { currentLoyaltyPeriod } from './loyaltyPeriod'

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
  const cfg = loadLoyaltyStatusConfig()
  const eligible = bonusEligibleTotal(order)
  if (order.status !== 'delivered') {
    const spentPreview = eligible
    const previewLevel = resolveEffectiveClientLevel(spentPreview, 1, level, currentLoyaltyPeriod())
    return calcOrderBonusEarned(eligible, previewLevel, vip, cfg)
  }
  return calcOrderBonusEarned(eligible, level, vip, cfg)
}

export type OrderLoyaltyPatch = {
  bonusCredited?: boolean
  bonusEarned?: number
  bonusSpent?: number
}

function refreshCrmAfterDelivery() {
  if (!USE_API) return
  void useClientStore.getState().fetchFromApi()
  void useCardStore.getState().fetchFromApi()
}

/** Локальный режим: начисление бонусов и обновление spent/orders при доставке. */
export function creditBonusOnDeliveryLocal(order: Order, allOrders: Order[] = []): OrderLoyaltyPatch | null {
  if (USE_API) {
    refreshCrmAfterDelivery()
    return null
  }
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

  if (!client && !card) return null

  const { spent: monthlySpent, orderCount } = loyaltyStatsFromOrders(allOrders, phone)
  const effectiveLevel = resolveEffectiveClientLevel(
    monthlySpent,
    orderCount,
    (client?.level || card?.level || 'basic') as ClientLevel,
    client?.loyaltyPeriod || card?.loyaltyPeriod,
  )
  const vip = !!(client?.vip || card?.vip)
  const eligible = bonusEligibleTotal(order)
  const earned = calcOrderBonusEarned(eligible, effectiveLevel, vip)
  const period = currentLoyaltyPeriod()

  if (client) {
    clientStore.updateClient(client.id, {
      orders: Math.max(client.orders || 0, orderCount),
      spent: Math.max(client.spent || 0, monthlySpent),
      level: vip ? client.level : effectiveLevel,
      loyaltyPeriod: period,
    })
  }

  const loyaltyPatch = {
    bonus: (card?.bonus || client?.bonus || 0) + earned,
    level: vip ? (card?.level || effectiveLevel) : effectiveLevel,
    loyaltyPeriod: period,
  }

  if (card) {
    const prevBonus = card.bonus || 0
    cardStore.updateCardLoyalty(card.num, {
      ...loyaltyPatch,
      bonus: prevBonus + earned,
    }, { skipApi: true })
    if (earned > 0) onBonusCredited(phone, earned, card.num)
  } else if (earned > 0 && client) {
    onBonusCredited(phone, earned, client.card)
  }

  return { bonusCredited: true, bonusEarned: earned }
}

export function onOrderDeliveredLoyalty(order: Order, allOrders: Order[] = []) {
  creditBonusOnDeliveryLocal(order, allOrders)
}

/** Пересчитать пропущенные бонусы за доставленные заказы (локально или через API). */
export async function syncLoyaltyBonuses(phone: string, orders: Order[]): Promise<number> {
  if (!phone.trim()) return 0
  if (USE_API) {
    try {
      const r = await api.syncLoyalty(phone)
      void useClientStore.getState().fetchFromApi()
      void useCardStore.getState().fetchFromApi()
      return r.credited || 0
    } catch {
      return 0
    }
  }
  let credited = 0
  const mine = orders.filter(
    o => o.status === 'delivered' && !o.bonusCredited && phonesMatch(o.client?.phone || '', phone),
  )
  for (const order of mine) {
    const patch = creditBonusOnDeliveryLocal(order, orders)
    if (patch?.bonusEarned) credited += patch.bonusEarned
    if (patch) {
      const { useOrders } = await import('./store')
      useOrders.setState(s => ({
        orders: s.orders.map(o => (o.id === order.id ? { ...o, ...patch } : o)),
      }))
    }
  }
  return credited
}
