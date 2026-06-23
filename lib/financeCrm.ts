import type { Order, Restaurant, RestaurantPayout } from './types'
import type { AdminCourier } from './courierTeam'
import type { AdminAssembler } from './assemblerTeam'
import type { PricingConfig } from './courierData'
import { getMarketItems, getRestItems, inferOrderType, getRestIdsFromOrder, normalizeOrders, normalizeOrder, coerceOrderItems } from './orderParts'
import { matchesCourierAssignment } from './courierTeam'
import { matchesAssemblerAssignment } from './assemblerTeam'
import { courierDeliveryEarning } from './courierStats'
import { orderGoodsTotal } from './orderLoyaltyAmount'

export type FinanceTab = 'shop' | 'restaurants' | 'couriers' | 'assemblers'

/** Оплата сборщику за собранный заказ магазина (ЅМ) */
export const ASSEMBLER_PAY_PER_ORDER = 3

export interface RestaurantBalance {
  totalGross: number
  paidGross: number
  pendingGross: number
  commissionPct: number
  pendingCommission: number
  paidCommission: number
  pendingNet: number
  paidNet: number
}

export interface RestaurantFinanceRow {
  id: string
  name: string
  emoji: string
  commission: number
  ordersMonth: number
  balance: RestaurantBalance
}

export interface CourierFinanceRow {
  id: string
  name: string
  vehicle: string
  deliveries: number
  earnings: number
  weekDeliveries: number
  rating: number
}

export interface AssemblerFinanceRow {
  id: string
  name: string
  assembled: number
  earnings: number
  weekAssembled: number
  avgTimeMin: number
}

export interface DailyRevenuePoint {
  label: string
  day: number
  shop: number
  restaurant: number
  total: number
}

export interface ShopFinanceSummary {
  revenue: number
  orders: number
  avgCheck: number
}

export interface FinanceSummary {
  shop: ShopFinanceSummary
  /** Сумма доставки, оплаченная клиентами — только для раздела курьеров */
  courierDeliveryFees: number
  restaurantGross: number
  restaurantCommission: number
  restaurantPendingNet: number
  totalTurnover: number
  dailyChart: DailyRevenuePoint[]
  restaurants: RestaurantFinanceRow[]
  couriers: CourierFinanceRow[]
  assemblers: AssemblerFinanceRow[]
  recentPayouts: RestaurantPayout[]
}

function parseOrderDate(order: Order): Date | null {
  const raw = order.createdAt || ''
  const d = new Date(raw)
  if (!Number.isNaN(d.getTime())) return d
  const m = raw.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/)
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    return new Date(year, Number(m[2]) - 1, Number(m[1]))
  }
  return null
}

function isDelivered(order: Order): boolean {
  return order.status === 'delivered'
}

export function restaurantBalance(r: Pick<Restaurant, 'revenueMonth' | 'paidRevenueMonth' | 'commission'>): RestaurantBalance {
  const totalGross = Number(r.revenueMonth) || 0
  const paidGross = Number(r.paidRevenueMonth) || 0
  const pendingGross = Math.max(0, totalGross - paidGross)
  const commissionPct = Number(r.commission) || 0
  const pendingCommission = Math.round(pendingGross * commissionPct / 100)
  const paidCommission = Math.round(paidGross * commissionPct / 100)
  const pendingNet = Math.max(0, pendingGross - pendingCommission)
  const paidNet = Math.max(0, paidGross - paidCommission)
  return { totalGross, paidGross, pendingGross, commissionPct, pendingCommission, paidCommission, pendingNet, paidNet }
}

export function marketRevenueFromOrder(order: Order): number {
  if (!isDelivered(order)) return 0
  const items = getMarketItems(order.items || [])
  if (items.length) {
    return items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 1), 0)
  }
  const t = inferOrderType(order)
  if (t === 'market') return orderGoodsTotal(order)
  return 0
}

export function restaurantRevenueFromOrder(order: Order, restId?: string): number {
  if (!isDelivered(order)) return 0
  const items = getRestItems(order.items || [], restId)
  if (items.length) {
    return items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 1), 0)
  }
  if (restId && String(order.restId) !== String(restId)) return 0
  const t = inferOrderType(order)
  if (t === 'restaurant' || t === 'mixed') {
    return Math.max(0, (Number(order.total) || 0) - (Number(order.deliveryFee) || 0))
  }
  return 0
}

export function buildDailyRevenueChart(orders: Order[], dayCount = 16): DailyRevenuePoint[] {
  const now = new Date()
  const points: DailyRevenuePoint[] = []
  for (let i = dayCount - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    const day = d.getDate()
    const label = String(day)
    let shop = 0
    let restaurant = 0
    for (const o of orders) {
      if (!isDelivered(o)) continue
      const od = parseOrderDate(o)
      if (!od || od.getDate() !== day || od.getMonth() !== d.getMonth() || od.getFullYear() !== d.getFullYear()) continue
      shop += marketRevenueFromOrder(o)
      if (inferOrderType(o) !== 'market') {
        for (const rid of getRestIdsFromOrder(o)) {
          restaurant += restaurantRevenueFromOrder(o, rid)
        }
        if (!getRestIdsFromOrder(o).length) restaurant += restaurantRevenueFromOrder(o)
      }
    }
    points.push({ label, day, shop, restaurant, total: shop + restaurant })
  }
  return points
}

export function buildCourierFinance(
  orders: Order[],
  couriers: AdminCourier[],
  roadKm: Record<string, number>,
  tariff: PricingConfig,
): CourierFinanceRow[] {
  const delivered = orders.filter(isDelivered)
  return couriers.map(c => {
    const mine = delivered.filter(o => matchesCourierAssignment(o.courier, c))
    const earnings = mine.reduce((s, o) => s + courierDeliveryEarning(o, roadKm, tariff), 0)
    return {
      id: c.id,
      name: c.name,
      vehicle: c.vehicle,
      deliveries: mine.length,
      earnings: Math.round(earnings),
      weekDeliveries: c.week || mine.length,
      rating: c.rating,
    }
  }).sort((a, b) => b.earnings - a.earnings)
}

export function buildAssemblerFinance(
  orders: Order[],
  assemblers: AdminAssembler[],
): AssemblerFinanceRow[] {
  const delivered = orders.filter(o => {
    if (!isDelivered(o)) return false
    const t = inferOrderType(o)
    return t === 'market' || t === 'mixed'
  })
  return assemblers.map(a => {
    const mine = delivered.filter(o => matchesAssemblerAssignment(o.assembler, a))
    const count = mine.length
    return {
      id: a.id,
      name: a.name,
      assembled: count,
      earnings: count * ASSEMBLER_PAY_PER_ORDER,
      weekAssembled: a.week || count,
      avgTimeMin: a.avgTimeMin,
    }
  }).sort((a, b) => b.earnings - a.earnings)
}

export function buildFinanceSummary(
  orders: Order[],
  restaurants: Restaurant[],
  couriers: AdminCourier[],
  assemblers: AdminAssembler[],
  roadKm: Record<string, number>,
  tariff: PricingConfig,
  payouts: RestaurantPayout[] = [],
): FinanceSummary {
  const delivered = orders.filter(isDelivered)
  const shopOrders = delivered.filter(o => inferOrderType(o) === 'market' || inferOrderType(o) === 'mixed')
  const shopRevenue = delivered.reduce((s, o) => s + marketRevenueFromOrder(o), 0)
  const courierDeliveryFees = delivered.reduce((s, o) => s + (Number(o.deliveryFee) || 0), 0)

  const restRows: RestaurantFinanceRow[] = restaurants.map(r => ({
    id: r.id,
    name: r.name,
    emoji: r.emoji,
    commission: r.commission,
    ordersMonth: r.ordersMonth || 0,
    balance: restaurantBalance(r),
  }))

  const restaurantGross = restRows.reduce((s, r) => s + r.balance.totalGross, 0)
  const restaurantCommission = restRows.reduce((s, r) => s + r.balance.pendingCommission + r.balance.paidCommission, 0)
  const restaurantPendingNet = restRows.reduce((s, r) => s + r.balance.pendingNet, 0)

  const shop: ShopFinanceSummary = {
    revenue: shopRevenue,
    orders: shopOrders.length,
    avgCheck: shopOrders.length ? Math.round(shopRevenue / shopOrders.length) : 0,
  }

  return {
    shop,
    courierDeliveryFees,
    restaurantGross,
    restaurantCommission,
    restaurantPendingNet,
    totalTurnover: shopRevenue + restaurantGross,
    dailyChart: buildDailyRevenueChart(orders),
    restaurants: restRows.sort((a, b) => b.balance.totalGross - a.balance.totalGross),
    couriers: buildCourierFinance(orders, couriers, roadKm, tariff),
    assemblers: buildAssemblerFinance(orders, assemblers),
    recentPayouts: payouts.slice(0, 20),
  }
}

export function formatSm(n: number): string {
  return `${Math.round(n).toLocaleString('ru-RU')} ЅМ`
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  if (typeof window === 'undefined') return
  const escape = (v: string | number) => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))]
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export function printFinanceReport(title: string, htmlBody: string) {
  if (typeof window === 'undefined') return
  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) return
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
body{font-family:Arial,sans-serif;padding:24px;color:#111}
h1{font-size:18px;margin:0 0 4px}p{color:#666;font-size:12px;margin:0 0 20px}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{border:1px solid #ddd;padding:8px;text-align:left}
th{background:#f5f5f5}
@media print{body{padding:0}}
</style></head><body>
<h1>${title}</h1>
<p>КАКАПО · ${new Date().toLocaleString('ru-RU')}</p>
${htmlBody}
<script>window.onload=function(){window.print()}</script>
</body></html>`)
  w.document.close()
}

export const FINANCE_TAB_OPTIONS: { id: FinanceTab; label: string; icon: string }[] = [
  { id: 'shop', label: 'Магазин', icon: '🛒' },
  { id: 'restaurants', label: 'Рестораны', icon: '🍽' },
  { id: 'couriers', label: 'Курьеры', icon: '🛵' },
  { id: 'assemblers', label: 'Сборщики', icon: '📦' },
]

/** Демо-заказы из AdminApp (items — строка) → Order для расчётов */
export function demoAdminRowsToOrders(rows: Record<string, unknown>[]): Order[] {
  return rows.map(row => normalizeOrder({
    id: String(row.id || ''),
    type: (row.type as Order['type']) || 'market',
    status: (row.status as Order['status']) || 'new',
    createdAt: String(row.time || row.createdAt || ''),
    deliveredAt: row.deliveredAt as string | undefined,
    client: {
      name: String(row.client || ''),
      phone: String(row.phone || ''),
      addr: String(row.addr || ''),
    },
    courier: row.courier && row.courier !== '—'
      ? { name: String(row.courier), phone: String(row.courierPhone || '') }
      : null,
    assembler: row.assembler && row.assembler !== '—'
      ? { name: String(row.assembler) }
      : null,
    items: coerceOrderItems(row.items, Number(row.total) || 0, (row.type as Order['type']) || 'market'),
    total: Number(row.total) || 0,
    deliveryFee: Number(row.deliveryFee) || 0,
    restId: row.restId as string | undefined,
    restName: row.rest as string | undefined,
  }))
}

export function prepareOrdersForFinance(apiOrders: Order[], demoRows?: Record<string, unknown>[]): Order[] {
  if (apiOrders.length) return normalizeOrders(apiOrders)
  if (demoRows?.length) return demoAdminRowsToOrders(demoRows)
  return []
}
