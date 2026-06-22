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
import { loadLoyaltyStatusConfig, type LoyaltyStatusConfig, getRegistrationWelcomeBonus } from './loyaltyStatusConfig'
import { useCardStore } from './cardStore'
import { useClientStore } from './clientStore'
import { onBonusCredited } from './pushService'
import { currentLoyaltyPeriod, loyaltyPeriodForOrder } from './loyaltyPeriod'
import { findMergedClientByPhone } from './clientProfileSync'
import { phoneDigits } from './clientSession'

const BONUS_SYNC_KEY = 'kakapo-bonus-synced-orders'
const syncInFlight = new Map<string, Promise<number>>()

function readSyncedOrderIds(phone: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(BONUS_SYNC_KEY)
    if (!raw) return new Set()
    const map = JSON.parse(raw) as Record<string, string[]>
    return new Set(map[phoneDigits(phone)] || [])
  } catch {
    return new Set()
  }
}

function markOrdersBonusSynced(phone: string, orderIds: string[]) {
  if (typeof window === 'undefined' || !orderIds.length) return
  try {
    const key = phoneDigits(phone)
    const raw = localStorage.getItem(BONUS_SYNC_KEY)
    const map = raw ? (JSON.parse(raw) as Record<string, string[]>) : {}
    const prev = new Set(map[key] || [])
    for (const id of orderIds) prev.add(String(id))
    map[key] = [...prev]
    localStorage.setItem(BONUS_SYNC_KEY, JSON.stringify(map))
  } catch { /* quota */ }
}

export function isOrderBonusSynced(phone: string, orderId: string): boolean {
  return readSyncedOrderIds(phone).has(String(orderId))
}

export function orderNeedsBonusSync(phone: string, order: Order): boolean {
  if (order.status !== 'delivered') return false
  if (!phonesMatch(order.client?.phone || '', phone)) return false
  if (order.bonusCredited) return false
  if (isOrderBonusSynced(phone, order.id)) return false
  return true
}

function orderSortKey(order: Order): number {
  const raw = order.deliveredAtIso || order.createdAtIso || order.createdAt || ''
  const d = new Date(String(raw))
  return Number.isNaN(d.getTime()) ? 0 : d.getTime()
}

/** Сумма трат (spent) до этого заказа в том же месяце. */
export function spentBeforeDeliveredOrder(
  phone: string,
  allDelivered: Order[],
  order: Order,
): number {
  const period = loyaltyPeriodForOrder(order)
  const orderKey = orderSortKey(order)
  const orderId = String(order.id)
  const priorOnly = allDelivered.filter(o => {
    if (!phonesMatch(o.client?.phone || '', phone)) return false
    if (loyaltyPeriodForOrder(o) !== period) return false
    if (String(o.id) === orderId) return false
    const k = orderSortKey(o)
    if (k < orderKey) return true
    if (k > orderKey) return false
    return String(o.id) < orderId
  })
  return loyaltyStatsFromOrders(priorOnly, phone, period).spent
}

type TierBonusBand = { from: number; to: number; percent: number }

function tierBonusBands(cfg: LoyaltyStatusConfig = loadLoyaltyStatusConfig()): TierBonusBand[] {
  const p = tierPercentsFromConfig(cfg)
  const bronze = cfg.bronzeMinSpent
  const silver = cfg.tiers.find(t => t.id === 'silver')?.minSpent ?? 1000
  const gold = cfg.tiers.find(t => t.id === 'gold')?.minSpent ?? 2000
  const platinum = cfg.tiers.find(t => t.id === 'platinum')?.minSpent ?? 3000
  return [
    { from: 0, to: bronze, percent: p.basic },
    { from: bronze, to: silver, percent: p.bronze },
    { from: silver, to: gold, percent: p.silver },
    { from: gold, to: platinum, percent: p.gold },
    { from: platinum, to: Infinity, percent: p.platinum },
  ]
}

/** Кэшбэк по сегментам: часть заказа выше порога 500 получает % бронзы и т.д. */
export function calcProgressiveBonusForOrder(
  spentBefore: number,
  order: Pick<Order, 'total' | 'deliveryFee' | 'bonusSpent'>,
  vip?: boolean,
  cfg?: LoyaltyStatusConfig,
): number {
  const config = cfg ?? loadLoyaltyStatusConfig()
  const eligible = bonusEligibleTotal(order)
  const spentAdd = orderSpentContribution(order)
  if (eligible <= 0 || spentAdd <= 0) return 0
  if (vip) {
    const percent = tierPercentsFromConfig(config).vip
    return Math.round(eligible * percent / 100)
  }

  const spentAfter = spentBefore + spentAdd
  let earned = 0
  for (const band of tierBonusBands(config)) {
    if (band.percent <= 0) continue
    const segStart = Math.max(spentBefore, band.from)
    const segEnd = Math.min(spentAfter, band.to)
    if (segEnd <= segStart) continue
    const spentInSegment = segEnd - segStart
    const eligibleInSegment = (spentInSegment / spentAdd) * eligible
    earned += Math.round(eligibleInSegment * band.percent / 100)
  }
  return earned
}

/** % кэшбэка для заказа — по тратам ДО этого заказа (legacy preview). */
export function resolveOrderBonusLevel(
  phone: string,
  allDelivered: Order[],
  order: Order,
  _vip?: boolean,
): ClientLevel {
  const period = loyaltyPeriodForOrder(order)
  const orderKey = orderSortKey(order)
  const orderId = String(order.id)
  const priorOnly = allDelivered.filter(o => {
    if (!phonesMatch(o.client?.phone || '', phone)) return false
    if (loyaltyPeriodForOrder(o) !== period) return false
    if (String(o.id) === orderId) return false
    const k = orderSortKey(o)
    if (k < orderKey) return true
    if (k > orderKey) return false
    return String(o.id) < orderId
  })
  const { spent, orderCount } = loyaltyStatsFromOrders(priorOnly, phone, period)
  return resolveEffectiveClientLevel(spent, orderCount, 'basic', period) as ClientLevel
}

/** Статус после доставки заказа — с учётом этого заказа (для отображения уровня). */
export function resolveOrderStatusLevel(
  phone: string,
  allDelivered: Order[],
  order: Order,
  storedLevel?: ClientLevel | string,
  storedPeriod?: string,
): ClientLevel {
  const period = loyaltyPeriodForOrder(order)
  const including = allDelivered.filter(o =>
    phonesMatch(o.client?.phone || '', phone)
    && loyaltyPeriodForOrder(o) === period
    && (orderSortKey(o) < orderSortKey(order)
      || (orderSortKey(o) === orderSortKey(order) && String(o.id) <= String(order.id))),
  )
  const { spent, orderCount } = loyaltyStatsFromOrders(including, phone, period)
  return resolveEffectiveClientLevel(spent, orderCount, storedLevel, storedPeriod || period) as ClientLevel
}

/** Ожидаемый баланс: welcome + кэшбэк за доставленные заказы − списанные бонусы. */
export function computeExpectedClientBonus(
  phone: string,
  orders: Order[],
  merged: { level?: ClientLevel | string; vip?: boolean; loyaltyPeriod?: string },
): number {
  const delivered = orders
    .filter(o => o.status === 'delivered' && phonesMatch(o.client?.phone || '', phone))
    .sort((a, b) => orderSortKey(a) - orderSortKey(b))

  let earned = 0
  for (const order of delivered) {
    const spentBefore = spentBeforeDeliveredOrder(phone, delivered, order)
    earned += calcProgressiveBonusForOrder(spentBefore, order, merged.vip)
  }

  const bonusSpent = delivered.reduce((s, o) => s + (Number(o.bonusSpent) || 0), 0)
  return Math.max(0, getRegistrationWelcomeBonus() + earned - bonusSpent)
}

export function deliveredOrdersNeedingBonusSync(phone: string, orders: Order[]): Order[] {
  return orders.filter(o => orderNeedsBonusSync(phone, o))
}

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
  bronze: 1,
  silver: 2,
  gold: 3,
  platinum: 5,
  vip: 5,
}

export function tierPercentsFromConfig(cfg: LoyaltyStatusConfig = loadLoyaltyStatusConfig()): LoyaltyTierPercents {
  return {
    basic: cfg.basic.bonusPercent,
    bronze: cfg.tiers.find(t => t.id === 'bronze')?.bonusPercent ?? 1,
    silver: cfg.tiers.find(t => t.id === 'silver')?.bonusPercent ?? 2,
    gold: cfg.tiers.find(t => t.id === 'gold')?.bonusPercent ?? 3,
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
  _level?: ClientLevel | string,
  vip?: boolean,
  allOrders?: Order[],
): number {
  if (order.bonusEarned != null && order.status === 'delivered') return order.bonusEarned
  const cfg = loadLoyaltyStatusConfig()
  const phone = order.client?.phone || ''

  if (allOrders?.length && phone) {
    const delivered = allOrders
      .filter(o => o.status === 'delivered' && phonesMatch(o.client?.phone || '', phone))
      .sort((a, b) => orderSortKey(a) - orderSortKey(b))
    const spentBefore = order.status === 'delivered'
      ? spentBeforeDeliveredOrder(phone, delivered, order)
      : loyaltyStatsFromOrders(
        delivered.filter(o => loyaltyPeriodForOrder(o) === currentLoyaltyPeriod()),
        phone,
        currentLoyaltyPeriod(),
      ).spent
    return calcProgressiveBonusForOrder(spentBefore, order, vip, cfg)
  }

  return calcProgressiveBonusForOrder(0, order, vip, cfg)
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

  const orderPeriod = loyaltyPeriodForOrder(order)
  const delivered = allOrders.filter(o =>
    o.status === 'delivered' && phonesMatch(o.client?.phone || '', phone),
  )
  const statusLevel = resolveOrderStatusLevel(
    phone,
    delivered,
    order,
    (client?.level || card?.level || 'basic') as ClientLevel,
    orderPeriod,
  )
  const vip = !!(client?.vip || card?.vip)
  const spentBefore = spentBeforeDeliveredOrder(phone, delivered, order)
  const earned = calcProgressiveBonusForOrder(spentBefore, order, vip)
  const { spent: monthlySpent, orderCount } = loyaltyStatsFromOrders(allOrders, phone)

  if (client) {
    clientStore.updateClient(client.id, {
      orders: Math.max(client.orders || 0, orderCount),
      spent: Math.max(client.spent || 0, monthlySpent),
      level: vip ? client.level : statusLevel,
      loyaltyPeriod: orderPeriod,
    })
  }

  const loyaltyPatch = {
    bonus: (card?.bonus || client?.bonus || 0) + earned,
    level: vip ? (card?.level || statusLevel) : statusLevel,
    loyaltyPeriod: orderPeriod,
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

/** Привести баланс к ожидаемому (welcome + кэшбэк − списания). */
async function reconcileBonusBalance(phone: string, orders: Order[]): Promise<number> {
  const merged = await findMergedClientByPhone(phone)
  if (!merged?.card) return 0

  const expectedBonus = computeExpectedClientBonus(phone, orders, merged)
  const currentBonus = Number(merged.bonus) || 0
  if (Math.abs(currentBonus - expectedBonus) <= 0) return 0

  const delivered = orders
    .filter(o => o.status === 'delivered' && phonesMatch(o.client?.phone || '', phone))
    .sort((a, b) => orderSortKey(a) - orderSortKey(b))
  const period = currentLoyaltyPeriod()
  const monthDelivered = delivered.filter(o => loyaltyPeriodForOrder(o) === period)
  const { spent, orderCount } = loyaltyStatsFromOrders(monthDelivered, phone, period)
  const finalLevel = resolveEffectiveClientLevel(spent, orderCount, 'basic', period) as ClientLevel

  await api.updateCard(merged.card, {
    bonus: expectedBonus,
    level: merged.vip ? merged.level : finalLevel,
    loyaltyPeriod: period,
  })
  if (merged.id) {
    await api.updateClient(merged.id, {
      bonus: expectedBonus,
      spent,
      orders: orderCount,
      level: merged.vip ? merged.level : finalLevel,
      loyaltyPeriod: period,
    }).catch(() => {})
  }

  markOrdersBonusSynced(phone, delivered.map(o => o.id))

  const { useOrders } = await import('./store')
  useOrders.setState(s => ({
    orders: s.orders.map(o => {
      if (!delivered.some(d => d.id === o.id)) return o
      const spentBefore = spentBeforeDeliveredOrder(phone, delivered, o)
      const earned = calcProgressiveBonusForOrder(spentBefore, o, merged.vip)
      return { ...o, bonusCredited: true, bonusEarned: earned }
    }),
  }))

  void useClientStore.getState().fetchFromApi()
  void useCardStore.getState().fetchFromApi()
  return expectedBonus - currentBonus
}

/** Начисление через PATCH карты — если /loyalty/sync ещё нет на сервере. */
async function syncLoyaltyBonusesViaCardApi(phone: string, orders: Order[]): Promise<number> {
  const merged = await findMergedClientByPhone(phone)
  if (!merged?.card) return 0

  const pending = deliveredOrdersNeedingBonusSync(phone, orders)
  if (!pending.length) return 0

  const delivered = orders
    .filter(o => o.status === 'delivered' && phonesMatch(o.client?.phone || '', phone))
    .sort((a, b) => orderSortKey(a) - orderSortKey(b))

  const expectedBonus = computeExpectedClientBonus(phone, orders, merged)
  const currentBonus = Number(merged.bonus) || 0
  if (Math.abs(currentBonus - expectedBonus) <= 0) {
    markOrdersBonusSynced(phone, delivered.map(o => o.id))
    return 0
  }

  const delta = expectedBonus - currentBonus

  const period = currentLoyaltyPeriod()
  const monthDelivered = delivered.filter(o => loyaltyPeriodForOrder(o) === period)
  const { spent, orderCount } = loyaltyStatsFromOrders(monthDelivered, phone, period)
  const finalLevel = resolveEffectiveClientLevel(spent, orderCount, 'basic', period) as ClientLevel

  await api.updateCard(merged.card, {
    bonus: expectedBonus,
    level: merged.vip ? merged.level : finalLevel,
    loyaltyPeriod: period,
  })
  if (merged.id) {
    await api.updateClient(merged.id, {
      bonus: expectedBonus,
      spent,
      orders: orderCount,
      level: merged.vip ? merged.level : finalLevel,
      loyaltyPeriod: period,
    }).catch(() => {})
  }

  markOrdersBonusSynced(phone, delivered.map(o => o.id))
  if (delta > 0) onBonusCredited(phone, delta, merged.card)

  const { useOrders } = await import('./store')
  useOrders.setState(s => ({
    orders: s.orders.map(o => {
      if (!delivered.some(d => d.id === o.id)) return o
      const spentBefore = spentBeforeDeliveredOrder(phone, delivered, o)
      const earned = calcProgressiveBonusForOrder(spentBefore, o, merged.vip)
      return { ...o, bonusCredited: true, bonusEarned: earned }
    }),
  }))

  void useClientStore.getState().fetchFromApi()
  void useCardStore.getState().fetchFromApi()
  return delta
}

/** Пересчитать пропущенные бонусы за доставленные заказы (локально или через API). */
export async function syncLoyaltyBonuses(phone: string, orders: Order[]): Promise<number> {
  if (!phone.trim()) return 0

  const key = phoneDigits(phone)
  const inflight = syncInFlight.get(key)
  if (inflight) return inflight

  const run = (async () => {
    const pending = deliveredOrdersNeedingBonusSync(phone, orders)
      if (!pending.length) {
      if (USE_API) return reconcileBonusBalance(phone, orders)
      return 0
    }

    if (USE_API) {
      try {
        const r = await api.syncLoyalty(phone)
        markOrdersBonusSynced(phone, pending.map(o => o.id))
        void useClientStore.getState().fetchFromApi()
        void useCardStore.getState().fetchFromApi()
        const { useOrders } = await import('./store')
        useOrders.setState(s => ({
          orders: s.orders.map(o => {
            if (!pending.some(p => p.id === o.id)) return o
            const delivered = orders
              .filter(x => x.status === 'delivered' && phonesMatch(x.client?.phone || '', phone))
              .sort((a, b) => orderSortKey(a) - orderSortKey(b))
            const spentBefore = spentBeforeDeliveredOrder(phone, delivered, o)
            const earned = calcProgressiveBonusForOrder(spentBefore, o, undefined)
            return { ...o, bonusCredited: true, bonusEarned: earned }
          }),
        }))
        return r.credited || 0
      } catch {
        return syncLoyaltyBonusesViaCardApi(phone, orders)
      }
    }

    let credited = 0
    for (const order of pending) {
      const patch = creditBonusOnDeliveryLocal(order, orders)
      if (patch?.bonusEarned) credited += patch.bonusEarned
      if (patch) {
        markOrdersBonusSynced(phone, [order.id])
        const { useOrders } = await import('./store')
        useOrders.setState(s => ({
          orders: s.orders.map(o => (o.id === order.id ? { ...o, ...patch } : o)),
        }))
      }
    }
    return credited
  })().finally(() => {
    syncInFlight.delete(key)
  })

  syncInFlight.set(key, run)
  return run
}
