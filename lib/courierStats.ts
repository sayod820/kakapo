import { resolveOrderDeliveryFee } from './deliveryFee'
import type { PricingConfig } from './courierData'
import { matchesCourierAssignment } from './courierTeam'
import type { Order } from './types'

export const COURIER_NAME = 'Фирдавс Назаров'
export const COURIER_PHONE = '+992 93 111 22 33'
export const ASSEMBLER_NAME = 'Камола Юсупова'

export type CourierStatsProfile = { id?: string; name: string; phone: string }

/** Доставка принадлежит только этому курьеру — чужие и «без курьера» не показываем */
export function belongsToCourier(order: Order, courier: CourierStatsProfile | string): boolean {
  if (order.status !== 'delivered') return false
  const profile: CourierStatsProfile =
    typeof courier === 'string' ? { name: courier, phone: '' } : courier
  if (!profile.name && !profile.phone && !profile.id) return false
  return matchesCourierAssignment(order.courier, profile)
}

export function courierDeliveryEarning(
  order: Order,
  roadKm: Record<string, number>,
  tariff: PricingConfig,
): number {
  return resolveOrderDeliveryFee(order, tariff, roadKm)
}

export function formatSm(n: number): string {
  const rounded = Math.round(n * 100) / 100
  const fixed = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
  const [intPart, decPart] = fixed.split('.')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return decPart ? `${grouped}.${decPart}` : grouped
}

function shortClientName(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'Клиент'
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[1][0]}.`
}

export interface CourierHistoryItem {
  id: string
  client: string
  addr: string
  time: string
  rating: number
  earning: number
}

export interface CourierStats {
  todayEarnings: number
  todayCount: number
  weekEarnings: number
  totalDeliveries: number
  avgPerDay: number
  rating: number
  history: CourierHistoryItem[]
}

export function buildCourierStats(
  orders: Order[],
  roadKm: Record<string, number>,
  tariff: PricingConfig,
  courier: CourierStatsProfile | string = COURIER_NAME,
): CourierStats {
  const profile: CourierStatsProfile =
    typeof courier === 'string' ? { name: courier, phone: '' } : courier

  const delivered = orders
    .filter(o => belongsToCourier(o, profile))
    .sort((a, b) => (b.deliveredAt || b.createdAt || '').localeCompare(a.deliveredAt || a.createdAt || ''))

  const withEarnings = delivered.map(o => ({
    order: o,
    earning: courierDeliveryEarning(o, roadKm, tariff),
  }))

  const todayEarnings = withEarnings.reduce((s, x) => s + x.earning, 0)
  const todayCount = withEarnings.length
  const weekEarnings = todayEarnings
  const avgPerDay = todayCount > 0 ? weekEarnings / 7 : 0

  const history: CourierHistoryItem[] = withEarnings.slice(0, 20).map(({ order, earning }) => ({
    id: order.id,
    client: shortClientName(order.client?.name || ''),
    addr: order.client?.addr || '',
    time: order.deliveredAt || order.createdAt || '',
    rating: 5,
    earning,
  }))

  return {
    todayEarnings,
    todayCount,
    weekEarnings,
    totalDeliveries: todayCount,
    avgPerDay,
    rating: 4.9,
    history,
  }
}
