import { normalizeCourierAccount } from './courierAccount'

export type CourierStatus = 'available' | 'busy' | 'offline'
export type CourierVehicle = 'moto' | 'bike' | 'car'

export interface AdminCourier {
  id: string
  name: string
  phone: string
  vehicle: CourierVehicle
  num: string
  status: CourierStatus
  rating: number
  orders: number
  today: number
  week: number
  /** Сколько заказов курьер может вести одновременно */
  maxActiveOrders: number
  blocked: boolean
  /** Предоплаченный счёт для комиссии за заказы, ЅМ */
  balance: number
  /** Номер счёта для пополнения, напр. KUR-0001 */
  account?: string
  /** Индивидуальный % комиссии (0 — из тарифа) */
  commissionPercent?: number
  otp?: string
}

export const VEHICLE_OPTIONS: { id: CourierVehicle; label: string; icon: string }[] = [
  { id: 'moto', label: 'Мотоцикл', icon: '🏍' },
  { id: 'bike', label: 'Велосипед', icon: '🚲' },
  { id: 'car', label: 'Авто', icon: '🚗' },
]

export function vehicleLabel(v: CourierVehicle): string {
  return VEHICLE_OPTIONS.find(x => x.id === v)?.label ?? v
}

export function vehicleIcon(v: CourierVehicle): string {
  return VEHICLE_OPTIONS.find(x => x.id === v)?.icon ?? '🛵'
}

export const DEFAULT_ADMIN_COURIERS: AdminCourier[] = [
  { id: 'C-01', name: 'Фирдавс Назаров', phone: '+992 93 111 22 33', vehicle: 'moto', num: 'TJ 1234 AA', status: 'busy', rating: 4.9, orders: 342, today: 42, week: 310, maxActiveOrders: 1, blocked: false, balance: 120, account: 'KUR-0001', otp: '1234' },
  { id: 'C-02', name: 'Баходур Кодиров', phone: '+992 90 222 33 44', vehicle: 'bike', num: '—', status: 'available', rating: 4.7, orders: 187, today: 28, week: 195, maxActiveOrders: 1, blocked: false, balance: 45, account: 'KUR-0002' },
  { id: 'C-03', name: 'Рустам Холов', phone: '+992 91 333 44 55', vehicle: 'car', num: 'TJ 5678 BB', status: 'available', rating: 4.8, orders: 521, today: 56, week: 420, maxActiveOrders: 2, blocked: false, balance: 200, account: 'KUR-0003' },
  { id: 'C-04', name: 'Зубайр Рахимов', phone: '+992 88 444 55 66', vehicle: 'moto', num: 'TJ 9012 CC', status: 'offline', rating: 4.6, orders: 98, today: 0, week: 145, maxActiveOrders: 1, blocked: false, balance: 0, account: 'KUR-0004' },
]

export function emptyCourierForm(): Omit<AdminCourier, 'id' | 'orders' | 'today' | 'week' | 'rating'> {
  return {
    name: '',
    phone: '',
    vehicle: 'moto',
    num: '',
    status: 'offline',
    maxActiveOrders: 1,
    blocked: false,
    balance: 0,
    commissionPercent: 0,
    otp: '1234',
  }
}

export function normalizeCourier(raw: Partial<AdminCourier> & { id: string }): AdminCourier {
  const vehicle = (raw.vehicle === 'bike' || raw.vehicle === 'car' || raw.vehicle === 'moto')
    ? raw.vehicle
    : 'moto'
  return {
    id: raw.id,
    name: raw.name || '',
    phone: raw.phone || '',
    vehicle,
    num: raw.num || '—',
    status: raw.status === 'available' || raw.status === 'busy' ? raw.status : 'offline',
    rating: Number(raw.rating) || 5,
    orders: Number(raw.orders) || 0,
    today: Number(raw.today) || 0,
    week: Number(raw.week) || 0,
    maxActiveOrders: Math.max(1, Math.min(5, Number(raw.maxActiveOrders) || 1)),
    blocked: !!raw.blocked,
    balance: Math.max(0, Math.round((Number(raw.balance) || 0) * 100) / 100),
    account: normalizeCourierAccount(raw.account, raw.id),
    commissionPercent: Math.max(0, Number(raw.commissionPercent ?? raw.commissionPerOrder) || 0) || undefined,
    otp: raw.otp || '1234',
  }
}

/** Совпадение заказа с курьером по телефону/имени */
export function matchesCourierAssignment(
  courier: { name?: string; phone?: string } | null | undefined,
  profile: Pick<AdminCourier, 'name' | 'phone'>,
): boolean {
  if (!courier) return false
  const phone = profile.phone.replace(/\D/g, '')
  if (courier.phone && courier.phone.replace(/\D/g, '') === phone) return true
  const first = profile.name.split(/\s+/)[0]?.toLowerCase() || ''
  const cn = (courier.name || '').toLowerCase()
  return cn === profile.name.toLowerCase() || cn.startsWith(first) || profile.name.toLowerCase().startsWith(cn.split(/\s+/)[0] || '')
}

export function isMyCourierOrder(
  order: { status: string; courier?: { name?: string; phone?: string } | null },
  profile: Pick<AdminCourier, 'name' | 'phone'>,
): boolean {
  if (!matchesCourierAssignment(order.courier, profile)) return false
  if (['courier_picked', 'delivering'].includes(order.status)) return true
  if (order.status === 'assembler_done' || order.status === 'ready') return true
  return false
}

/** Активные доставки курьера по телефону или имени */
export function countCourierActiveOrders(
  orders: { status: string; courier?: { name?: string; phone?: string } | null }[],
  courier: Pick<AdminCourier, 'name' | 'phone'>,
): number {
  return orders.filter(o => isMyCourierOrder(o, courier)).length
}

export function findCourierByPhone(couriers: AdminCourier[], phone: string): AdminCourier | undefined {
  const digits = phone.replace(/\D/g, '')
  const tail = digits.slice(-9)
  if (tail.length < 9) return undefined
  return couriers.find(c => {
    const cd = c.phone.replace(/\D/g, '')
    return cd === digits || cd.endsWith(tail) || cd.slice(-9) === tail
  })
}

export function verifyCourierOtp(
  couriers: AdminCourier[],
  phone: string,
  code: string,
): { ok: true; courier: AdminCourier } | { ok: false; error: string } {
  const courier = findCourierByPhone(couriers, phone)
  if (!courier) return { ok: false, error: 'Номер не найден · проверьте раздел «Курьеры» в админке' }
  if (courier.blocked) return { ok: false, error: 'Доступ заблокирован администратором' }
  const expected = courier.otp || '1234'
  if (String(code) !== expected) {
    return { ok: false, error: `Неверный код · Демо: ${expected}` }
  }
  return { ok: true, courier }
}

/** Профиль курьера: store → localStorage → демо-данные */
export function resolveCourierProfile(couriers: AdminCourier[], phone: string): AdminCourier {
  return findCourierByPhone(couriers, phone)
    ?? findCourierByPhone(DEFAULT_ADMIN_COURIERS, phone)
    ?? DEFAULT_ADMIN_COURIERS[0]
}
