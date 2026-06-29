import type { Order } from './types'
import { getMarketStatus, isMarketPartActive, isMixedOrder, normalizeOrder } from './orderParts'
import { isAssemblerStoreHandoffPending } from './orderUiMap'

export type AssemblerStatus = 'working' | 'available' | 'offline'

export interface AdminAssembler {
  id: string
  name: string
  phone: string
  status: AssemblerStatus
  ordersToday: number
  ordersTotal: number
  week: number
  avgTimeMin: number
  rating: number
  blocked: boolean
  otp?: string
}

export const DEFAULT_ADMIN_ASSEMBLERS: AdminAssembler[] = [
  { id: 'A-01', name: 'Камола Юсупова', phone: '+992 93 500 11 22', status: 'working', ordersToday: 12, ordersTotal: 840, week: 56, avgTimeMin: 7, rating: 4.9, blocked: false, otp: '5678' },
  { id: 'A-02', name: 'Шахло Рахимова', phone: '+992 93 500 33 44', status: 'available', ordersToday: 8, ordersTotal: 612, week: 41, avgTimeMin: 9, rating: 4.7, blocked: false, otp: '5678' },
  { id: 'A-03', name: 'Зарина Холова', phone: '+992 93 500 55 66', status: 'offline', ordersToday: 0, ordersTotal: 290, week: 0, avgTimeMin: 8, rating: 4.5, blocked: false, otp: '5678' },
]

export function emptyAssemblerForm(): Omit<AdminAssembler, 'id' | 'ordersToday' | 'ordersTotal' | 'week' | 'rating'> {
  return {
    name: '',
    phone: '',
    status: 'offline',
    avgTimeMin: 8,
    blocked: false,
    otp: '5678',
  }
}

export function normalizeAssembler(raw: Partial<AdminAssembler> & { id: string }): AdminAssembler {
  const status = raw.status === 'working' || raw.status === 'available' ? raw.status : 'offline'
  const avgRaw = raw.avgTimeMin ?? (typeof (raw as { avgTime?: string }).avgTime === 'string'
    ? parseInt(String((raw as { avgTime?: string }).avgTime), 10)
    : NaN)
  return {
    id: raw.id,
    name: raw.name || '',
    phone: raw.phone || '',
    status,
    ordersToday: Number(raw.ordersToday) || 0,
    ordersTotal: Number(raw.ordersTotal) || 0,
    week: Number(raw.week) || 0,
    avgTimeMin: Number.isFinite(avgRaw) && avgRaw > 0 ? avgRaw : 8,
    rating: Number(raw.rating) || 5,
    blocked: !!raw.blocked,
    otp: raw.otp || '5678',
  }
}

export function formatAssemblerAvgTime(min: number): string {
  if (!min || min <= 0) return '—'
  return `${min} мин`
}

export function matchesAssemblerAssignment(
  assembler: { name?: string } | null | undefined,
  profile: Pick<AdminAssembler, 'name' | 'phone'>,
): boolean {
  if (!assembler?.name) return false
  const an = assembler.name.toLowerCase().replace(/\./g, '').trim()
  const pn = profile.name.toLowerCase().trim()
  if (an === pn) return true
  const aFirst = an.split(/\s+/)[0] || ''
  const pFirst = pn.split(/\s+/)[0] || ''
  return an.startsWith(pFirst) || pn.startsWith(aFirst) || an.includes(pFirst)
}

export type AssemblerMember = { name: string; id?: string }

export function getAssemblerTeam(order: { assemblerTeam?: AssemblerMember[]; assembler?: { name?: string } | null }): AssemblerMember[] {
  if (order.assemblerTeam?.length) return order.assemblerTeam
  if (order.assembler?.name) return [{ name: order.assembler.name }]
  return []
}

export function mergeAssemblerTeam(
  order: { assemblerTeam?: AssemblerMember[]; assembler?: { name?: string } | null },
  member: AssemblerMember,
): AssemblerMember[] {
  const team = getAssemblerTeam(order)
  if (team.some(m => (member.id && m.id === member.id) || m.name === member.name)) return team
  return [...team, member]
}

export function isInAssemblerTeam(
  order: { assemblerTeam?: AssemblerMember[]; assembler?: { name?: string } | null },
  name: string,
  id?: string,
): boolean {
  return getAssemblerTeam(order).some(m => (id && m.id === id) || m.name === name)
}

export function orderHasAssemblerAssignment(
  order: { assemblerTeam?: AssemblerMember[]; assembler?: { name?: string; id?: string } | null },
  profile: Pick<AdminAssembler, 'name' | 'id'>,
): boolean {
  if (profile.id && order.assembler?.id === profile.id) return true
  if (order.assembler?.name && matchesAssemblerAssignment(order.assembler, profile)) return true
  const team = getAssemblerTeam(order)
  if (profile.id && team.some(m => m.id === profile.id)) return true
  return team.some(m => matchesAssemblerAssignment(m, profile))
}

export function isAssemblerOrderClaimed(
  order: { assemblerTeam?: AssemblerMember[]; assembler?: { name?: string; id?: string } | null },
): boolean {
  return !!(order.assembler?.name || order.assembler?.id || order.assemblerTeam?.length)
}

/** Сборщик видит: свободные заказы в очереди или уже принятые им */
export function canAssemblerSeeOrder(order: Order, profile: Pick<AdminAssembler, 'name' | 'id'>): boolean {
  const o = normalizeOrder(order)
  if (o.status === 'cancelled') {
    if (!isAssemblerOrderClaimed(o)) return false
    return orderHasAssemblerAssignment(o, profile)
  }
  if (isMixedOrder(o)) {
    if (!isMarketPartActive(o) && !isAssemblerStoreHandoffPending(o)) return false
  } else if (o.type !== 'market') {
    return false
  } else if (!['new', 'assembling'].includes(o.status) && !isAssemblerStoreHandoffPending(o)) {
    return false
  }
  if (!isAssemblerOrderClaimed(o)) return true
  return orderHasAssemblerAssignment(o, profile)
}

export function isAssemblerActiveOrder(o: Order): boolean {
  const order = normalizeOrder(o)
  if (isMixedOrder(order)) return getMarketStatus(order) === 'assembling'
  return order.type === 'market' && order.status === 'assembling'
}

export function countAssemblerActiveOrders(
  orders: Order[],
  profile: Pick<AdminAssembler, 'name' | 'phone'>,
): number {
  return orders.filter(o => isAssemblerActiveOrder(o) && (
    orderHasAssemblerAssignment(o, profile) || matchesAssemblerAssignment(o.assembler, profile)
  )).length
}

export function countAssemblerCompletedOrders(
  orders: Order[],
  profile: Pick<AdminAssembler, 'name' | 'phone'>,
): number {
  return orders.filter(o => {
    if (!orderHasAssemblerAssignment(o, profile) && !matchesAssemblerAssignment(o.assembler, profile)) return false
    const st = o.status
    return ['assembler_done', 'courier_picked', 'delivering', 'delivered'].includes(st)
      || (isMixedOrder(normalizeOrder(o)) && getMarketStatus(normalizeOrder(o)) === 'done')
  }).length
}

export function findAssemblerByPhone(assemblers: AdminAssembler[], phone: string): AdminAssembler | undefined {
  const digits = phone.replace(/\D/g, '')
  return assemblers.find(a => {
    const d = a.phone.replace(/\D/g, '')
    return d === digits || d.endsWith(digits.slice(-9))
  })
}

const STATUS_LABEL: Record<AssemblerStatus, string> = {
  working: 'На смене',
  available: 'Свободен',
  offline: 'Не в сети',
}

export function assemblerStatusLabel(s: AssemblerStatus): string {
  return STATUS_LABEL[s] ?? s
}

export function assemblerStatusIcon(s: AssemblerStatus): string {
  if (s === 'working') return '🟢'
  if (s === 'available') return '🟡'
  return '⚫'
}

export function verifyAssemblerPin(
  assemblers: AdminAssembler[],
  code: string,
  assemblerId?: string,
): { ok: true; assembler: AdminAssembler } | { ok: false; error: string } {
  if (assemblerId) {
    const a = assemblers.find(x => x.id === assemblerId)
    if (!a) return { ok: false, error: 'Сборщик не найден · проверьте раздел «Сборщики» в админке' }
    if (a.blocked) return { ok: false, error: 'Доступ заблокирован администратором' }
    const expected = a.otp || '5678'
    if (String(code) !== expected) {
      return { ok: false, error: `Неверный PIN · Демо: ${expected}` }
    }
    return { ok: true, assembler: a }
  }
  const match = assemblers.find(a => !a.blocked && (a.otp || '5678') === String(code))
  if (!match) return { ok: false, error: 'Неверный PIN · Демо: 5678' }
  return { ok: true, assembler: match }
}
