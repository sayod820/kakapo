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
import {
  loadLoyaltyStatusConfig,
  type LoyaltyStatusConfig,
  getRegistrationWelcomeBonus,
  tierThresholdsFromConfig,
} from './loyaltyStatusConfig'
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

/** Доставленные заказы того же месяца, которые были раньше текущего. */
function priorDeliveredOrders(phone: string, allDelivered: Order[], order: Order): Order[] {
  const period = loyaltyPeriodForOrder(order)
  const orderKey = orderSortKey(order)
  const orderId = String(order.id)
  return allDelivered.filter(o => {
    if (!phonesMatch(o.client?.phone || '', phone)) return false
    if (loyaltyPeriodForOrder(o) !== period) return false
    if (String(o.id) === orderId) return false
    const k = orderSortKey(o)
    if (k < orderKey) return true
    if (k > orderKey) return false
    return String(o.id) < orderId
  })
}

/** % кэшбэка для заказа — по тратам ДО этого заказа (для отображения уровня %). */
export function resolveOrderBonusLevel(
  phone: string,
  allDelivered: Order[],
  order: Order,
  _vip?: boolean,
): ClientLevel {
  const period = loyaltyPeriodForOrder(order)
  const priorOnly = priorDeliveredOrders(phone, allDelivered, order)
  const { spent, orderCount } = loyaltyStatsFromOrders(priorOnly, phone, period)
  return resolveEffectiveClientLevel(spent, orderCount, 'basic', period) as ClientLevel
}

type MarginalBand = { from: number; to: number; percent: number }

function marginalBandsFromConfig(cfg: LoyaltyStatusConfig): MarginalBand[] {
  const t = tierThresholdsFromConfig(cfg)
  const p = tierPercentsFromConfig(cfg)
  return [
    { from: 0, to: t.bronze, percent: 0 },
    { from: t.bronze, to: t.silver, percent: p.bronze },
    { from: t.silver, to: t.gold, percent: p.silver },
    { from: t.gold, to: t.platinum, percent: p.gold },
    { from: t.platinum, to: Infinity, percent: p.platinum },
  ]
}

/** Кэшбэк по «ступенькам»: до 500 SM — 0%, сверх порога — % соответствующего уровня. */
export function calcMarginalBonusEarned(
  priorEligibleSpent: number,
  orderEligible: number,
  vip?: boolean,
  cfg?: LoyaltyStatusConfig,
): number {
  const config = cfg ?? loadLoyaltyStatusConfig()
  const percents = tierPercentsFromConfig(config)
  const amount = Math.max(0, orderEligible)
  if (amount <= 0) return 0
  if (vip) {
    if (percents.vip <= 0) return 0
    return Math.round(amount * percents.vip / 100)
  }

  const bands = marginalBandsFromConfig(config)
  const start = Math.max(0, priorEligibleSpent)
  const end = start + amount
  let earned = 0
  for (const band of bands) {
    const overlapStart = Math.max(start, band.from)
    const overlapEnd = Math.min(end, band.to)
    const bandAmount = Math.max(0, overlapEnd - overlapStart)
    if (bandAmount > 0 && band.percent > 0) {
      earned += Math.round(bandAmount * band.percent / 100)
    }
  }
  return earned
}

export function priorBonusEligibleSpent(phone: string, allDelivered: Order[], order: Order): number {
  return priorDeliveredOrders(phone, allDelivered, order)
    .reduce((sum, o) => sum + bonusEligibleTotal(o), 0)
}

export function calcOrderMarginalBonusEarned(
  phone: string,
  allDelivered: Order[],
  order: Order,
  vip?: boolean,
  cfg?: LoyaltyStatusConfig,
): number {
  const prior = priorBonusEligibleSpent(phone, allDelivered, order)
  return calcMarginalBonusEarned(prior, bonusEligibleTotal(order), vip, cfg)
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
    earned += calcOrderMarginalBonusEarned(phone, delivered, order, merged.vip)
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
  level?: ClientLevel | string,
  vip?: boolean,
  allOrders?: Order[],
): number {
  if (order.bonusEarned != null && order.status === 'delivered') return order.bonusEarned
  const cfg = loadLoyaltyStatusConfig()
  const eligible = bonusEligibleTotal(order)
  const phone = order.client?.phone || ''

  if (allOrders?.length && phone) {
    const delivered = allOrders
      .filter(o => o.status === 'delivered' && phonesMatch(o.client?.phone || '', phone))
      .sort((a, b) => orderSortKey(a) - orderSortKey(b))

    if (order.status === 'delivered') {
      return calcOrderMarginalBonusEarned(phone, delivered, order, vip, cfg)
    }
    const period = currentLoyaltyPeriod()
    const priorEligible = delivered
      .filter(o => loyaltyPeriodForOrder(o) === period)
      .reduce((sum, o) => sum + bonusEligibleTotal(o), 0)
    return calcMarginalBonusEarned(priorEligible, eligible, vip, cfg)
  }

  return calcMarginalBonusEarned(0, eligible, vip, cfg)
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
  const earned = calcOrderMarginalBonusEarned(phone, delivered, order, vip)
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

/** Начисление через PATCH карты — запасной путь, если /loyalty/sync недоступен. */
async function syncLoyaltyBonusesViaCardApi(phone: string): Promise<number> {
  const merged = await findMergedClientByPhone(phone)
  if (!merged?.card) return 0

  const { useOrders } = await import('./store')
  await useOrders.getState().fetchOrders().catch(() => {})
  const orders = useOrders.getState().orders

  const delivered = orders
    .filter(o => o.status === 'delivered' && phonesMatch(o.client?.phone || '', phone))
    .sort((a, b) => orderSortKey(a) - orderSortKey(b))

  const expectedBonus = computeExpectedClientBonus(phone, orders, merged)
  const currentBonus = Number(merged.bonus) || 0
  if (expectedBonus <= currentBonus) {
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
      const earned = calcOrderMarginalBonusEarned(phone, delivered, o, merged.vip)
      return { ...o, bonusCredited: true, bonusEarned: earned }
    }),
  }))

  void useClientStore.getState().fetchFromApi()
  void useCardStore.getState().fetchFromApi()
  const { emitCrmSync } = await import('./clientProfileSync')
  emitCrmSync()
  return delta
}

async function refreshAfterApiLoyaltySync(phone: string) {
  const { useOrders } = await import('./store')
  const { emitCrmSync } = await import('./clientProfileSync')
  await Promise.all([
    useOrders.getState().fetchOrders().catch(() => {}),
    useClientStore.getState().fetchFromApi(),
    useCardStore.getState().fetchFromApi(),
  ])
  const delivered = useOrders.getState().orders
    .filter(o => o.status === 'delivered' && phonesMatch(o.client?.phone || '', phone))
  markOrdersBonusSynced(phone, delivered.map(o => o.id))
  emitCrmSync()
}

/** Сервер — единый источник правды: полный пересчёт по всем заказам в базе. */
async function syncLoyaltyBonusesFromApi(phone: string): Promise<number> {
  try {
    const r = await api.syncLoyalty(phone)
    await refreshAfterApiLoyaltySync(phone)
    return r.credited ?? 0
  } catch {
    return syncLoyaltyBonusesViaCardApi(phone)
  }
}

/** Пересчитать пропущенные бонусы за доставленные заказы (локально или через API). */
export async function syncLoyaltyBonuses(phone: string, orders: Order[]): Promise<number> {
  if (!phone.trim()) return 0

  const key = phoneDigits(phone)
  const inflight = syncInFlight.get(key)
  if (inflight) return inflight

  const run = (async () => {
    if (USE_API) {
      return syncLoyaltyBonusesFromApi(phone)
    }

    const pending = deliveredOrdersNeedingBonusSync(phone, orders)
    if (!pending.length) return 0

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
