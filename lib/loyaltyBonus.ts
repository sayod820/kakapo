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
import { findMergedClientByPhone } from './clientProfileSync'

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

function orderSortKey(order: Order): number {
  const raw = order.deliveredAtIso || order.createdAtIso || order.createdAt || ''
  const d = new Date(String(raw))
  return Number.isNaN(d.getTime()) ? 0 : d.getTime()
}

/** Начисление через PATCH карты — если /loyalty/sync ещё нет на сервере. */
async function syncLoyaltyBonusesViaCardApi(phone: string, orders: Order[]): Promise<number> {
  const merged = await findMergedClientByPhone(phone)
  if (!merged?.card) return 0

  const delivered = orders
    .filter(o => o.status === 'delivered' && phonesMatch(o.client?.phone || '', phone))
    .sort((a, b) => orderSortKey(a) - orderSortKey(b))

  const pending = delivered.filter(o => !o.bonusCredited)
  if (!pending.length) return 0

  let totalNew = 0
  const processed: Order[] = []
  let finalLevel = merged.level
  const period = currentLoyaltyPeriod()

  for (const order of delivered) {
    const batch = [...processed, order]
    const { spent, orderCount } = loyaltyStatsFromOrders(batch, phone)
    const effectiveLevel = resolveEffectiveClientLevel(
      spent,
      orderCount,
      merged.level,
      merged.loyaltyPeriod,
    ) as ClientLevel
    finalLevel = effectiveLevel
    if (!order.bonusCredited) {
      const earned = calcOrderBonusEarned(
        bonusEligibleTotal(order),
        effectiveLevel,
        merged.vip,
      )
      totalNew += earned
    }
    processed.push({ ...order, bonusCredited: true, bonusEarned: order.bonusEarned })
  }

  if (totalNew <= 0) return 0

  const { spent, orderCount } = loyaltyStatsFromOrders(delivered, phone)
  const newBonus = (merged.bonus || 0) + totalNew

  await api.updateCard(merged.card, {
    bonus: newBonus,
    level: merged.vip ? merged.level : finalLevel,
    loyaltyPeriod: period,
  })
  if (merged.id) {
    await api.updateClient(merged.id, {
      bonus: newBonus,
      spent,
      orders: orderCount,
      level: merged.vip ? merged.level : finalLevel,
      loyaltyPeriod: period,
    }).catch(() => {})
  }

  if (totalNew > 0) onBonusCredited(phone, totalNew, merged.card)

  const { useOrders } = await import('./store')
  useOrders.setState(s => ({
    orders: s.orders.map(o => {
      const hit = pending.find(p => p.id === o.id)
      if (!hit) return o
      const batch = delivered.slice(0, delivered.findIndex(d => d.id === o.id) + 1)
      const { spent: ms, orderCount: mc } = loyaltyStatsFromOrders(batch, phone)
      const lvl = resolveEffectiveClientLevel(ms, mc, merged.level, merged.loyaltyPeriod) as ClientLevel
      const earned = calcOrderBonusEarned(bonusEligibleTotal(hit), lvl, merged.vip)
      return { ...o, bonusCredited: true, bonusEarned: earned }
    }),
  }))

  void useClientStore.getState().fetchFromApi()
  void useCardStore.getState().fetchFromApi()
  return totalNew
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
      return syncLoyaltyBonusesViaCardApi(phone, orders)
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
