'use client'

import type { Order } from './types'
import type { ClientLevel } from './clientCrm'
import {
  phonesMatch,
  loyaltyStatsFromOrders,
  resolveEffectiveClientLevel,
} from './clientCrm'
import { bonusEligibleTotal } from './orderLoyaltyAmount'
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
import { inferLevelAssignMode } from './loyaltyAdminLock'
import { onBonusCredited } from './pushService'
import { currentLoyaltyPeriod, loyaltyPeriodForOrder } from './loyaltyPeriod'
import { findMergedClientByPhone } from './clientProfileSync'
import { phoneDigits } from './clientSession'

const BONUS_SYNC_KEY = 'kakapo-bonus-synced-orders'
const syncInFlight = new Map<string, Promise<number>>()

function readSyncedOrderIds(phone: string): Set<string> {
  if (USE_API || typeof window === 'undefined') return new Set()
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
  if (USE_API || typeof window === 'undefined' || !orderIds.length) return
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

export function getBonusEligibleFromMs(
  merged: { bonusEligibleFrom?: string; vip?: boolean; loyaltyPeriod?: string },
  card?: { bonusEligibleFrom?: string; loyaltyPeriod?: string } | null,
): number | null {
  const raw = merged.bonusEligibleFrom || card?.bonusEligibleFrom
  if (raw) {
    const d = new Date(raw)
    if (!Number.isNaN(d.getTime())) return d.getTime()
  }
  if (merged.vip) {
    const period = merged.loyaltyPeriod || card?.loyaltyPeriod
    if (period) {
      const [y, m] = period.split('-').map(Number)
      return new Date(y, m - 1, 1).getTime()
    }
    return Date.now()
  }
  return null
}

export function isOrderBonusEligible(
  order: Order,
  merged: { bonusEligibleFrom?: string; vip?: boolean; loyaltyPeriod?: string },
  card?: { bonusEligibleFrom?: string; loyaltyPeriod?: string } | null,
): boolean {
  const fromMs = getBonusEligibleFromMs(merged, card)
  if (fromMs == null) return true
  return orderSortKey(order) >= fromMs
}

export function priorBonusEligibleSpent(
  phone: string,
  allDelivered: Order[],
  order: Order,
  merged?: { bonusEligibleFrom?: string; vip?: boolean; loyaltyPeriod?: string },
  card?: { bonusEligibleFrom?: string; loyaltyPeriod?: string } | null,
): number {
  return priorDeliveredOrders(phone, allDelivered, order)
    .filter(o => !merged || isOrderBonusEligible(o, merged, card))
    .reduce((sum, o) => sum + bonusEligibleTotal(o), 0)
}

export function calcOrderMarginalBonusEarned(
  phone: string,
  allDelivered: Order[],
  order: Order,
  vip?: boolean,
  cfg?: LoyaltyStatusConfig,
  merged?: { bonusEligibleFrom?: string; vip?: boolean; loyaltyPeriod?: string },
  card?: { bonusEligibleFrom?: string; loyaltyPeriod?: string } | null,
): number {
  if (merged && !isOrderBonusEligible(order, merged, card)) return 0
  const prior = priorBonusEligibleSpent(phone, allDelivered, order, merged, card)
  const useVip = !!(vip && (!merged || isOrderBonusEligible(order, merged, card)))
  return calcMarginalBonusEarned(prior, bonusEligibleTotal(order), useVip, cfg)
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
  merged: { level?: ClientLevel | string; vip?: boolean; loyaltyPeriod?: string; bonusEligibleFrom?: string },
  card?: { bonusEligibleFrom?: string; loyaltyPeriod?: string } | null,
): number {
  const delivered = orders
    .filter(o => o.status === 'delivered' && phonesMatch(o.client?.phone || '', phone))
    .sort((a, b) => orderSortKey(a) - orderSortKey(b))

  let earned = 0
  for (const order of delivered) {
    earned += calcOrderMarginalBonusEarned(phone, delivered, order, merged.vip, undefined, merged, card)
  }

  const bonusSpent = delivered.reduce((s, o) => s + (Number(o.bonusSpent) || 0), 0)
  return Math.max(0, getRegistrationWelcomeBonus() + earned - bonusSpent)
}

/** Локальный пересчёт баланса и уровня (в т.ч. после отмены заказа). */
export function reconcileClientBonusesLocal(phone: string, orders: Order[], refundBonusSpent = 0): number {
  if (USE_API || !phone.trim()) return 0

  const clientStore = useClientStore.getState()
  const cardStore = useCardStore.getState()
  if (!clientStore.hydrated) clientStore.hydrate()
  if (!cardStore.hydrated) cardStore.hydrate()

  const client = clientStore.clients.find(c => phonesMatch(c.phone, phone))
  const card = client?.card
    ? cardStore.cards.find(c => c.num === client.card && c.status !== 'unlinked')
    : cardStore.cards.find(c => c.status === 'active' && c.phone && phonesMatch(c.phone, phone))

  if (!client && !card) return 0

  const merged = {
    vip: !!(client?.vip || card?.vip),
    loyaltyPeriod: client?.loyaltyPeriod || card?.loyaltyPeriod,
    bonusEligibleFrom: client?.bonusEligibleFrom || card?.bonusEligibleFrom,
  }

  let expectedBonus = computeExpectedClientBonus(phone, orders, merged, card)
  if (refundBonusSpent > 0) expectedBonus += refundBonusSpent

  const prevBonus = card?.bonus ?? client?.bonus ?? 0
  const delta = expectedBonus - prevBonus

  const delivered = orders.filter(o => o.status === 'delivered' && phonesMatch(o.client?.phone || '', phone))
  const { spent, orderCount } = loyaltyStatsFromOrders(orders, phone)
  const period = currentLoyaltyPeriod()
  const assignMode = inferLevelAssignMode(card || {}, client || {})
  const keepManual = assignMode === 'manual'
  const vip = merged.vip

  const nextLevel: ClientLevel = delivered.length
    ? (vip
      ? ((client?.level || card?.level || 'basic') as ClientLevel)
      : resolveEffectiveClientLevel(spent, orderCount, 'basic', period) as ClientLevel)
    : 'basic'

  if (client) {
    clientStore.updateClient(client.id, {
      bonus: expectedBonus,
      orders: orderCount,
      spent,
      ...(keepManual ? {} : { level: nextLevel }),
      loyaltyPeriod: period,
    }, { skipApi: true })
  }

  if (card) {
    cardStore.updateCardLoyalty(card.num, {
      bonus: expectedBonus,
      ...(keepManual ? {} : { level: vip ? card.level : (nextLevel === 'basic' ? '' : nextLevel) }),
      loyaltyPeriod: period,
    }, { skipApi: true })
  }

  void import('./clientProfileSync').then(m => m.emitCrmSync()).catch(() => {})
  return delta
}

/** Снять кэшбэк за отменённый заказ (локальный режим без API). */
export function reverseBonusOnOrderCancelLocal(prev: Order, orders: Order[]): OrderLoyaltyPatch | null {
  if (USE_API) return null
  const phone = prev.client?.phone || ''
  if (!phone) return null
  const hadLoyalty = prev.status === 'delivered'
    || prev.bonusCredited
    || (Number(prev.bonusEarned) || 0) > 0
    || (Number(prev.bonusSpent) || 0) > 0
  if (!hadLoyalty) return null
  const refund = Number(prev.bonusSpent) || 0
  reconcileClientBonusesLocal(phone, orders, refund)
  return { bonusCredited: false, bonusEarned: 0, bonusSpent: 0 }
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

/** Сумма товаров, с которой начисляются бонусы (без доставки). */
export { bonusEligibleTotal, orderSpentContribution } from './orderLoyaltyAmount'

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

export function expectedOrderBonus(
  order: Order,
  level?: ClientLevel | string,
  vip?: boolean,
  allOrders?: Order[],
  bonusMeta?: { bonusEligibleFrom?: string; loyaltyPeriod?: string },
): number {
  if (order.bonusEarned != null && order.status === 'delivered') return order.bonusEarned
  const cfg = loadLoyaltyStatusConfig()
  const eligible = bonusEligibleTotal(order)
  const phone = order.client?.phone || ''
  const merged = { vip, ...bonusMeta }

  if (allOrders?.length && phone) {
    const delivered = allOrders
      .filter(o => o.status === 'delivered' && phonesMatch(o.client?.phone || '', phone))
      .sort((a, b) => orderSortKey(a) - orderSortKey(b))

    if (order.status === 'delivered') {
      return calcOrderMarginalBonusEarned(phone, delivered, order, vip, cfg, merged)
    }
    const period = currentLoyaltyPeriod()
    const priorEligible = delivered
      .filter(o => loyaltyPeriodForOrder(o) === period)
      .filter(o => isOrderBonusEligible(o, merged))
      .reduce((sum, o) => sum + bonusEligibleTotal(o), 0)
    const useVip = !!(vip && isOrderBonusEligible(order, merged))
    return calcMarginalBonusEarned(priorEligible, eligible, useVip, cfg)
  }

  const useVip = !!(vip && (!bonusMeta?.bonusEligibleFrom || isOrderBonusEligible(order, merged)))
  return calcMarginalBonusEarned(0, eligible, useVip, cfg)
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

  const ordersWithCurrent = allOrders.map(o => (o.id === order.id ? order : o))
  reconcileClientBonusesLocal(phone, ordersWithCurrent)

  const delivered = ordersWithCurrent.filter(o =>
    o.status === 'delivered' && phonesMatch(o.client?.phone || '', phone),
  )
  const merged = {
    vip: !!(client?.vip || card?.vip),
    loyaltyPeriod: client?.loyaltyPeriod || card?.loyaltyPeriod,
    bonusEligibleFrom: client?.bonusEligibleFrom || card?.bonusEligibleFrom,
  }
  const earned = calcOrderMarginalBonusEarned(phone, delivered, order, merged.vip, undefined, merged, card)
  if (earned > 0) onBonusCredited(phone, earned, card?.num || client?.card)

  return { bonusCredited: true, bonusEarned: earned }
}

export function onOrderDeliveredLoyalty(order: Order, allOrders: Order[] = []) {
  creditBonusOnDeliveryLocal(order, allOrders)
}

async function refreshAfterApiLoyaltySync(phone: string) {
  const { useOrders } = await import('./store')
  const { emitCrmSync, fetchCrmStoreUser, mergeCrmIntoStoreUser, crmStoreUsersEqual } = await import('./clientProfileSync')
  await Promise.all([
    useOrders.getState().fetchOrders().catch(() => {}),
    useClientStore.getState().fetchFromApi(),
    useCardStore.getState().fetchFromApi(),
  ])
  const delivered = useOrders.getState().orders
    .filter(o => o.status === 'delivered' && phonesMatch(o.client?.phone || '', phone))
  markOrdersBonusSynced(phone, delivered.map(o => o.id))
  emitCrmSync()

  if (typeof window !== 'undefined') {
    const { loadStoreUser, saveStoreUser, isClientSessionActive } = await import('./clientSession')
    if (isClientSessionActive()) {
      const stored = loadStoreUser()
      if (stored && phonesMatch(stored.phone, phone)) {
        const next = await fetchCrmStoreUser(phone, stored.card)
        if (next) {
          const merged = mergeCrmIntoStoreUser(stored, next)
          if (!crmStoreUsersEqual(stored, merged)) saveStoreUser(merged)
        }
      }
    }
  }
}

/** Сервер — единый источник правды: полный пересчёт по всем заказам в базе. */
async function syncLoyaltyBonusesFromApi(phone: string): Promise<number> {
  const r = await api.syncLoyalty(phone)
  await refreshAfterApiLoyaltySync(phone)
  return r.credited ?? 0
}

/** Пересчитать пропущенные бонусы за доставленные заказы (локально или через API). */
export async function syncLoyaltyBonuses(
  phone: string,
  orders: Order[],
  opts?: { force?: boolean },
): Promise<number> {
  if (!phone.trim()) return 0

  const key = phoneDigits(phone)
  if (opts?.force) syncInFlight.delete(key)
  const inflight = syncInFlight.get(key)
  if (inflight) return inflight

  const run = (async () => {
    if (USE_API) {
      try {
        return await syncLoyaltyBonusesFromApi(phone)
      } catch {
        // Только читаем с сервера — никогда не пишем баланс с клиента
        await refreshAfterApiLoyaltySync(phone)
        return 0
      }
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
