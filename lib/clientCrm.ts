import type { Order } from './types'

export type ClientLevel = 'bronze' | 'silver' | 'gold' | 'platinum'

export interface AdminClient {
  id: string
  name: string
  phone: string
  email?: string
  addr?: string
  card: string
  level: ClientLevel
  orders: number
  spent: number
  debt: number
  bonus: number
  debtLimit: number
  blocked: boolean
  note?: string
  createdAt?: string
  lastOrderAt?: string
}

export const CLIENT_LEVEL_COLORS: Record<ClientLevel, string> = {
  bronze: '#CD7F32',
  silver: '#C0C0C0',
  gold: '#FFB800',
  platinum: '#3B8EF0',
}

export const CLIENT_LEVEL_OPTIONS: { id: ClientLevel; label: string }[] = [
  { id: 'bronze', label: 'Bronze' },
  { id: 'silver', label: 'Silver' },
  { id: 'gold', label: 'Gold' },
  { id: 'platinum', label: 'Platinum' },
]

export const DEFAULT_ADMIN_CLIENTS: AdminClient[] = [
  { id: 'U-01', name: 'Диловар Рахимов', phone: '+992 93 456 78 90', email: '', addr: 'ул. Ленина, 42', card: 'КАКАПО-0001', level: 'platinum', orders: 87, spent: 3420, debt: 1200, bonus: 4850, debtLimit: 3000, blocked: false, createdAt: '2024-01-12' },
  { id: 'U-02', name: 'Нилуфар Хасанова', phone: '+992 90 123 45 67', email: '', addr: 'ул. Сомони, 12', card: 'КАКАПО-0042', level: 'gold', orders: 43, spent: 1890, debt: 0, bonus: 1240, debtLimit: 1000, blocked: false, createdAt: '2024-03-05' },
  { id: 'U-03', name: 'Бахром Каримов', phone: '+992 88 789 01 23', email: '', addr: 'мкр. Мирный, 5', card: 'КАКАПО-0118', level: 'silver', orders: 28, spent: 980, debt: 0, bonus: 560, debtLimit: 0, blocked: false, createdAt: '2024-06-18' },
  { id: 'U-04', name: 'Зафар Мирзоев', phone: '+992 91 654 32 10', email: '', addr: 'ул. Рудаки, 8', card: 'КАКАПО-0234', level: 'gold', orders: 56, spent: 2340, debt: 4500, bonus: 2100, debtLimit: 2000, blocked: false, createdAt: '2023-11-02' },
  { id: 'U-05', name: 'Мадина Оразова', phone: '+992 93 321 65 43', email: '', addr: 'ул. Ленина, 18', card: '', level: 'silver', orders: 12, spent: 640, debt: 0, bonus: 120, debtLimit: 0, blocked: false, createdAt: '2025-01-20' },
  { id: 'U-06', name: 'Рустам Давлатов', phone: '+992 90 445 23 11', email: '', addr: 'ул. Сомони, 5', card: 'КАКАПО-0055', level: 'gold', orders: 34, spent: 1560, debt: 0, bonus: 890, debtLimit: 0, blocked: true, createdAt: '2024-08-09', note: 'Злоупотребление возвратами' },
]

export function normalizePhone(phone: string): string {
  return (phone || '').replace(/\D/g, '').slice(-9)
}

export function phonesMatch(a: string, b: string): boolean {
  const da = normalizePhone(a)
  const db = normalizePhone(b)
  return !!da && !!db && da === db
}

export function emptyClientForm(): ClientProfileForm {
  return emptyClientProfileForm()
}

export type ClientProfileForm = {
  name: string
  phone: string
  email: string
  addr: string
  card: string
  blocked: boolean
  note: string
}

export function emptyClientProfileForm(): ClientProfileForm {
  return {
    name: '',
    phone: '',
    email: '',
    addr: '',
    card: '',
    blocked: false,
    note: '',
  }
}

export function clientProfileFromClient(c: AdminClient): ClientProfileForm {
  return {
    name: c.name,
    phone: c.phone,
    email: c.email || '',
    addr: c.addr || '',
    card: c.card || '',
    blocked: c.blocked,
    note: c.note || '',
  }
}

export function normalizeClient(raw: Partial<AdminClient> & { id: string }): AdminClient {
  const level = (['bronze', 'silver', 'gold', 'platinum'] as ClientLevel[]).includes(raw.level as ClientLevel)
    ? (raw.level as ClientLevel)
    : 'bronze'
  return {
    id: raw.id,
    name: raw.name || '',
    phone: raw.phone || '',
    email: raw.email || '',
    addr: raw.addr || '',
    card: raw.card || '',
    level,
    orders: Number(raw.orders) || 0,
    spent: Number(raw.spent) || 0,
    debt: Number(raw.debt) || 0,
    bonus: Number(raw.bonus) || 0,
    debtLimit: Number(raw.debtLimit) || 0,
    blocked: !!raw.blocked,
    note: raw.note || '',
    createdAt: raw.createdAt,
    lastOrderAt: raw.lastOrderAt,
  }
}

export function suggestLevel(spent: number): ClientLevel {
  if (spent >= 3000) return 'platinum'
  if (spent >= 1500) return 'gold'
  if (spent >= 500) return 'silver'
  return 'bronze'
}

export function formatLastActivity(isoOrLabel?: string): string {
  if (!isoOrLabel) return '—'
  if (!/^\d{4}-\d{2}-\d{2}/.test(isoOrLabel)) return isoOrLabel
  const d = new Date(isoOrLabel)
  if (Number.isNaN(d.getTime())) return isoOrLabel
  const diff = Date.now() - d.getTime()
  const days = Math.floor(diff / 86400000)
  if (days <= 0) return 'Сегодня'
  if (days === 1) return 'Вчера'
  if (days < 7) return `${days} дн. назад`
  return d.toLocaleDateString('ru-RU')
}

export type ClientOrderStats = {
  orders: number
  spent: number
  marketOrders: number
  restaurantOrders: number
  mixedOrders: number
  lastOrderAt?: string
  lastAddr?: string
}

export function statsFromOrders(orders: Order[], phone: string): ClientOrderStats {
  const related = orders.filter(o => phonesMatch(o.client?.phone || '', phone))
  const delivered = related.filter(o => o.status === 'delivered')
  return {
    orders: related.length,
    spent: Math.round(delivered.reduce((s, o) => s + (o.total || 0), 0) * 10) / 10,
    marketOrders: related.filter(o => o.type === 'market').length,
    restaurantOrders: related.filter(o => o.type === 'restaurant').length,
    mixedOrders: related.filter(o => o.type === 'mixed').length,
    lastOrderAt: related[0]?.createdAt,
    lastAddr: related[0]?.client?.addr,
  }
}

export function enrichClientWithOrders(client: AdminClient, orders: Order[]): AdminClient & ClientOrderStats & { lastLabel: string } {
  const live = statsFromOrders(orders, client.phone)
  const spent = Math.max(client.spent, live.spent)
  const ordersCount = Math.max(client.orders, live.orders)
  const level = client.level || suggestLevel(spent)
  const lastLabel = formatLastActivity(live.lastOrderAt || client.lastOrderAt)
  return {
    ...client,
    ...live,
    orders: ordersCount,
    spent,
    level,
    addr: client.addr || live.lastAddr || '',
    lastLabel,
  }
}

export function clientSegment(stats: Pick<ClientOrderStats, 'marketOrders' | 'restaurantOrders' | 'mixedOrders'>): 'market' | 'restaurant' | 'mixed' | 'none' {
  if (stats.mixedOrders > 0) return 'mixed'
  if (stats.marketOrders > 0 && stats.restaurantOrders > 0) return 'mixed'
  if (stats.marketOrders > 0) return 'market'
  if (stats.restaurantOrders > 0) return 'restaurant'
  return 'none'
}

export function clientSegmentLabel(seg: ReturnType<typeof clientSegment>): string {
  if (seg === 'market') return '🛒 Магазин'
  if (seg === 'restaurant') return '🍽 Рестораны'
  if (seg === 'mixed') return '🔀 Смешанный'
  return '—'
}

export function isNewThisMonth(createdAt?: string): boolean {
  if (!createdAt || !/^\d{4}-\d{2}-\d{2}/.test(createdAt)) return false
  const d = new Date(createdAt)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

export function mergeClientsWithOrders(stored: AdminClient[], orders: Order[]): (AdminClient & ClientOrderStats & { lastLabel: string })[] {
  const byPhone = new Map<string, AdminClient>()
  for (const c of stored) byPhone.set(normalizePhone(c.phone), normalizeClient(c))

  for (const order of orders) {
    const phone = order.client?.phone || ''
    const key = normalizePhone(phone)
    if (!key) continue
    if (!byPhone.has(key)) {
      byPhone.set(key, normalizeClient({
        id: `U-${key}`,
        name: order.client?.name || 'Клиент',
        phone: order.client?.phone || phone,
        addr: order.client?.addr || '',
        card: '',
        level: 'bronze',
        orders: 0,
        spent: 0,
        debt: 0,
        bonus: 0,
        debtLimit: 0,
        blocked: false,
      }))
    } else {
      const prev = byPhone.get(key)!
      if (!prev.name && order.client?.name) prev.name = order.client.name
      if (!prev.addr && order.client?.addr) prev.addr = order.client.addr
    }
  }

  return [...byPhone.values()].map(c => enrichClientWithOrders(c, orders))
}
