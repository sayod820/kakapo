/**
 * Уведомления кассира: просрок, смена, деньги, заказы из клиентского магазина.
 * (Остатки убраны — шумели бейджем 99+.)
 */

import type { CashVault, Order, PosShift } from '@/lib/types'
import { shiftExpectedCashLocal } from '@/lib/offlinePosOps'
import { getMarketStatus, normalizeOrder } from '@/lib/orderParts'
import { isAssemblerStoreHandoffPending } from '@/lib/orderUiMap'

export type CashierAlertGroupId = 'expiry' | 'shift' | 'money' | 'orders'

export type CashierAlertItem = {
  id: string
  title: string
  detail?: string
  tone: 'critical' | 'warn' | 'info'
}

export type CashierAlertGroup = {
  id: CashierAlertGroupId
  title: string
  hint: string
  icon: string
  tone: 'critical' | 'warn' | 'info'
  count: number
  items: CashierAlertItem[]
  go?: 'warehouse-expiry' | 'finance' | 'queue' | 'close-shift' | 'shop-orders'
}

export type CashierExpiryRow = {
  productName?: string
  name?: string
  daysLeft: number
}

export type CashierAlertsInput = {
  expiry: CashierExpiryRow[]
  activeShift: PosShift | null
  cashVault: CashVault | null | undefined
  pendingOps: number
  /** Заказы из клиентского приложения, которые ждут магазин */
  shopOrders?: Order[]
  now?: number
}

const LOW_TILL = 100
const LOW_VAULT = 200
const SOON_DAYS = 3
const MAX_ITEMS = 5

function hoursOpen(openedAtIso: string, now: number): number {
  const t = new Date(openedAtIso).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, (now - t) / 3600000)
}

function expiryLabel(row: CashierExpiryRow): string {
  return String(row.productName || row.name || '').trim()
}

/** Этап магазинной части для подписи в уведомлениях / списке */
export type ShopOrderStage = 'new' | 'assembling' | 'ready' | 'handoff'

export function getShopOrderStage(o: Order): ShopOrderStage | null {
  if (!o || o.channel === 'pos') return null
  if (o.status === 'cancelled' || o.status === 'delivered' || o.status === 'delivering') return null
  if (o.type === 'restaurant') return null

  const order = normalizeOrder(o)
  const pickups = Array.isArray(order.pickupIds) ? order.pickupIds : []
  const touchesStore =
    order.type === 'market'
    || order.type === 'mixed'
    || pickups.includes('store')
    || (Array.isArray(order.items) && order.items.some(it => !it.restId && it.source !== 'restaurant'))

  if (!touchesStore) return null

  if (isAssemblerStoreHandoffPending(order)) return 'handoff'

  if (order.type === 'mixed') {
    const ms = getMarketStatus(order)
    if (ms === 'new') return 'new'
    if (ms === 'assembling') return 'assembling'
    if (ms === 'done') return 'ready'
    return null
  }

  if (order.status === 'new') return 'new'
  if (order.status === 'assembling') return 'assembling'
  if (order.status === 'assembler_done' || order.status === 'ready') return 'ready'
  return null
}

export function shopOrderStageLabel(stage: ShopOrderStage): string {
  if (stage === 'new') return 'Новый'
  if (stage === 'assembling') return 'Собирается'
  if (stage === 'ready') return 'Собран'
  return 'Отдать курьеру'
}

export function shopOrderStageTone(stage: ShopOrderStage): 'critical' | 'warn' | 'info' {
  if (stage === 'new' || stage === 'handoff') return 'critical'
  if (stage === 'assembling') return 'warn'
  return 'info'
}

export function shopOrderStageClass(stage: ShopOrderStage): string {
  if (stage === 'new') return 'new'
  if (stage === 'assembling') return 'work'
  if (stage === 'handoff') return 'hand'
  return 'ready'
}

/** Заказы из клиентского: новый → сборка → готов → отдать курьеру */
export function isShopIncomingOrder(o: Order): boolean {
  return getShopOrderStage(o) != null
}

export function listShopIncomingOrders(orders: Order[]): Order[] {
  return (orders || [])
    .filter(isShopIncomingOrder)
    .sort((a, b) => {
      const stageRank = (o: Order) => {
        const s = getShopOrderStage(o)
        if (s === 'handoff') return 0
        if (s === 'new') return 1
        if (s === 'assembling') return 2
        return 3
      }
      const ra = stageRank(a)
      const rb = stageRank(b)
      if (ra !== rb) return ra - rb
      const ta = new Date(a.createdAtIso || a.createdAt || 0).getTime()
      const tb = new Date(b.createdAtIso || b.createdAt || 0).getTime()
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0)
    })
}

export function buildCashierAlertGroups(input: CashierAlertsInput): CashierAlertGroup[] {
  const now = input.now ?? Date.now()
  const groups: CashierAlertGroup[] = []

  // ── 1. Просрок ──
  const expired = input.expiry.filter((e) => Number(e.daysLeft) < 0)
  const today = input.expiry.filter((e) => Number(e.daysLeft) === 0)
  const soon = input.expiry.filter((e) => {
    const d = Number(e.daysLeft)
    return d > 0 && d <= SOON_DAYS
  })
  const expiryItems: CashierAlertItem[] = []
  if (expired.length) {
    expiryItems.push({
      id: 'exp-gone',
      title: `Уже просрочено · ${expired.length}`,
      detail: expired.slice(0, 3).map(expiryLabel).filter(Boolean).join(', ') || undefined,
      tone: 'critical',
    })
  }
  if (today.length) {
    expiryItems.push({
      id: 'exp-today',
      title: `Истекает сегодня · ${today.length}`,
      detail: today.slice(0, 3).map(expiryLabel).filter(Boolean).join(', ') || undefined,
      tone: 'critical',
    })
  }
  if (soon.length) {
    expiryItems.push({
      id: 'exp-soon',
      title: `Через 1–${SOON_DAYS} дня · ${soon.length}`,
      detail: soon.slice(0, 3).map(expiryLabel).filter(Boolean).join(', ') || undefined,
      tone: 'warn',
    })
  }
  const expiryCount = expired.length + today.length + soon.length
  if (expiryCount > 0) {
    groups.push({
      id: 'expiry',
      title: 'Просрок',
      hint: 'Срок годности на складе',
      icon: '⏳',
      tone: expired.length || today.length ? 'critical' : 'warn',
      count: expiryCount,
      items: expiryItems.slice(0, MAX_ITEMS),
      go: 'warehouse-expiry',
    })
  }

  // ── 2. Смена ──
  const shiftItems: CashierAlertItem[] = []
  if (input.activeShift) {
    const hrs = hoursOpen(input.activeShift.openedAtIso, now)
    if (hrs >= 12) {
      shiftItems.push({
        id: 'shift-long',
        title: `Смена открыта ${Math.floor(hrs)} ч`,
        detail: 'Пора сверить кассу и закрыть смену',
        tone: hrs >= 16 ? 'critical' : 'warn',
      })
    }
  }
  if (input.pendingOps > 0) {
    shiftItems.push({
      id: 'shift-queue',
      title: `Очередь офлайн · ${input.pendingOps}`,
      detail: 'Есть несинхронизированные операции',
      tone: input.pendingOps >= 5 ? 'critical' : 'warn',
    })
  }
  if (shiftItems.length) {
    const crit = shiftItems.some((i) => i.tone === 'critical')
    groups.push({
      id: 'shift',
      title: 'Смена',
      hint: 'Смена и синхронизация',
      icon: '🕐',
      tone: crit ? 'critical' : 'warn',
      count: shiftItems.length,
      items: shiftItems,
      go: shiftItems.some((i) => i.id === 'shift-queue') ? 'queue' : 'close-shift',
    })
  }

  // ── 3. Деньги ──
  const moneyItems: CashierAlertItem[] = []
  if (input.activeShift) {
    const till = shiftExpectedCashLocal(input.activeShift)
    if (till < LOW_TILL) {
      moneyItems.push({
        id: 'money-till',
        title: `В кассе мало наличных · ${Math.round(till)} с.`,
        detail: `Рекомендуется ≥ ${LOW_TILL} с. на сдачу`,
        tone: till < 50 ? 'critical' : 'warn',
      })
    }
  }
  const vaultCash = Number(input.cashVault?.cashTotal) || 0
  if (input.cashVault && vaultCash < LOW_VAULT) {
    moneyItems.push({
      id: 'money-vault',
      title: `В основном сейфе мало · ${Math.round(vaultCash)} с.`,
      detail: `Может не хватить на открытие смены (≥ ${LOW_VAULT} с.)`,
      tone: vaultCash < 100 ? 'critical' : 'warn',
    })
  }
  if (moneyItems.length) {
    groups.push({
      id: 'money',
      title: 'Деньги',
      hint: 'Касса и основной сейф',
      icon: '💵',
      tone: moneyItems.some((i) => i.tone === 'critical') ? 'critical' : 'warn',
      count: moneyItems.length,
      items: moneyItems,
      go: 'finance',
    })
  }

  // ── 4. Заказы из клиентского (весь процесс до передачи курьеру) ──
  const shopOrders = listShopIncomingOrders(input.shopOrders || [])
  const hotCount = shopOrders.filter((o) => {
    const s = getShopOrderStage(o)
    return s === 'new' || s === 'handoff'
  }).length
  if (shopOrders.length) {
    const orderItems: CashierAlertItem[] = shopOrders.slice(0, MAX_ITEMS).map((o) => {
      const name = String(o.client?.name || 'Клиент').trim()
      const nItems = Array.isArray(o.items) ? o.items.length : 0
      const stage = getShopOrderStage(o) || 'new'
      const stLabel = shopOrderStageLabel(stage)
      return {
        id: `ord-${o.id}`,
        title: `${o.id} · ${name}`,
        detail: `${stLabel} · ${nItems} поз. · ${Math.round(Number(o.total) || 0)} с.`,
        tone: shopOrderStageTone(stage),
      }
    })
    groups.push({
      id: 'orders',
      title: 'Заказы',
      hint: 'Онлайн: новый → сборка → отдать курьеру',
      icon: '🛒',
      tone: hotCount > 0 ? 'critical' : 'warn',
      count: shopOrders.length,
      items: orderItems,
      go: 'shop-orders',
    })
  }

  return groups
}

export function cashierAlertsTotal(groups: CashierAlertGroup[]): number {
  return groups.reduce((s, g) => s + g.count, 0)
}
