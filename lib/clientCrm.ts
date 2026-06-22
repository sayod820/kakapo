'use client'

import type { Order } from './types'
import { isPhoneDeleted } from './clientTombstones'
import { isDemoSeedClient } from './clientDemoSeed'
import { loadLoyaltyStatusConfig, DEFAULT_LOYALTY_STATUS_CONFIG, tierThresholdsFromConfig } from './loyaltyStatusConfig'
import { currentLoyaltyPeriod, orderInLoyaltyPeriod, isLoyaltyPeriodCurrent } from './loyaltyPeriod'
import { orderBelongsToClientAccount } from './clientAccountLifecycle'

export type ClientLevel = 'basic' | 'bronze' | 'silver' | 'gold' | 'platinum'

export type ClientAccountStatus = 'active' | 'recovery'

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
  vip?: boolean
  debtEnabled?: boolean
  note?: string
  createdAt?: string
  lastOrderAt?: string
  /** Месяц (YYYY-MM), за который действует текущий статус и VIP */
  loyaltyPeriod?: string
  /** С какого момента (ISO) начислять кэшбэк после ручной смены статуса */
  bonusEligibleFrom?: string
  /** Поколение аккаунта: после полного удаления и новой регистрации +1 */
  accountGeneration?: number
  /** До какой даты можно восстановить аккаунт (recovery) */
  recoveryExpiresAt?: string
  /** active — обычный клиент; recovery — удалил аккаунт / перенесён админом */
  accountStatus?: ClientAccountStatus
  /** Дата перевода в восстановление */
  deletedAt?: string
}

/** Маркеры в note для старого backend без accountStatus / delete API */
export const RECOVERY_NOTE_PREFIX = 'kakapo-recovery'
export const PURGED_NOTE = 'kakapo-purged'
/** VIP на старом backend без поля vip в JSON */
export const VIP_NOTE_MARKER = 'kakapo-vip'
/** Раздел долга на backend без поля debtEnabled в JSON */
export const DEBT_NOTE_MARKER = 'kakapo-debt'

export function vipFromNote(note?: string): boolean {
  return !!(note && note.includes(VIP_NOTE_MARKER))
}

export function debtFromNote(note?: string): boolean {
  return !!(note && note.includes(DEBT_NOTE_MARKER))
}

export function withVipNote(note: string | undefined, vip: boolean): string {
  const cleaned = (note || '').replace(/\bkakapo-vip\b/g, '').replace(/\s+/g, ' ').trim()
  if (!vip) return cleaned
  return cleaned ? `${cleaned} ${VIP_NOTE_MARKER}` : VIP_NOTE_MARKER
}

export function withDebtNote(note: string | undefined, debtEnabled: boolean): string {
  const cleaned = (note || '').replace(/\bkakapo-debt\b/g, '').replace(/\s+/g, ' ').trim()
  if (!debtEnabled) return cleaned
  return cleaned ? `${cleaned} ${DEBT_NOTE_MARKER}` : DEBT_NOTE_MARKER
}

export function withLoyaltyNote(note: string | undefined, vip: boolean, debtEnabled: boolean): string {
  return withDebtNote(withVipNote(note, vip), debtEnabled)
}

export function isClientPurged(c?: AdminClient | null): boolean {
  if (!c) return false
  const note = c.note || ''
  if (note.includes(PURGED_NOTE)) return true
  if (note === 'deleted') return true
  return c.name === 'Удалён' && /^\+0000000/.test(c.phone || '')
}

export function parseRecoveryDeletedAt(note: string): string | undefined {
  const m = note.match(/kakapo-recovery\s+(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : undefined
}

export const CLIENT_LEVEL_COLORS: Record<ClientLevel, string> = {
  basic: '#8FB897',
  bronze: '#CD7F32',
  silver: '#C0C0C0',
  gold: '#FFB800',
  platinum: '#3B8EF0',
}

export const CLIENT_LEVEL_OPTIONS: { id: ClientLevel; label: string }[] = [
  { id: 'basic', label: 'Базовый' },
  { id: 'bronze', label: 'Bronze' },
  { id: 'silver', label: 'Silver' },
  { id: 'gold', label: 'Gold' },
  { id: 'platinum', label: 'Platinum' },
]

export const DEFAULT_ADMIN_CLIENTS: AdminClient[] = [
  { id: 'U-01', name: 'Диловар Рахимов', phone: '+992 93 456 78 90', email: '', addr: 'ул. Ленина, 42', card: 'КАКАПО-0001', level: 'platinum', orders: 87, spent: 3420, debt: 1200, bonus: 4850, debtLimit: 3000, blocked: false, vip: true, debtEnabled: true, createdAt: '2024-01-12' },
  { id: 'U-02', name: 'Нилуфар Хасанова', phone: '+992 90 123 45 67', email: '', addr: 'ул. Сомони, 12', card: 'КАКАПО-0042', level: 'gold', orders: 43, spent: 1890, debt: 0, bonus: 1240, debtLimit: 1000, blocked: false, createdAt: '2024-03-05' },
  { id: 'U-03', name: 'Бахром Каримов', phone: '+992 88 789 01 23', email: '', addr: 'мкр. Мирный, 5', card: 'КАКАПО-0118', level: 'silver', orders: 28, spent: 980, debt: 0, bonus: 560, debtLimit: 0, blocked: false, createdAt: '2024-06-18' },
  { id: 'U-04', name: 'Зафар Мирзоев', phone: '+992 91 654 32 10', email: '', addr: 'ул. Рудаки, 8', card: 'КАКАПО-0234', level: 'gold', orders: 56, spent: 2340, debt: 4500, bonus: 2100, debtLimit: 2000, blocked: false, debtEnabled: true, createdAt: '2023-11-02' },
  { id: 'U-05', name: 'Мадина Оразова', phone: '+992 93 321 65 43', email: '', addr: 'ул. Ленина, 18', card: '', level: 'silver', orders: 12, spent: 640, debt: 0, bonus: 120, debtLimit: 0, blocked: false, createdAt: '2025-01-20' },
  { id: 'U-06', name: 'Рустам Давлатов', phone: '+992 90 445 23 11', email: '', addr: 'ул. Сомони, 5', card: 'КАКАПО-0055', level: 'gold', orders: 34, spent: 1560, debt: 0, bonus: 890, debtLimit: 0, blocked: true, createdAt: '2024-08-09', note: 'Злоупотребление возвратами' },
  { id: 'U-07', name: 'Сайёд Гафуров', phone: '+992 50 190 31 41', email: '', addr: '', card: 'KAKAPO-0236', level: 'silver', orders: 0, spent: 0, debt: 0, bonus: 100, debtLimit: 0, blocked: false, createdAt: '2025-06-01' },
]

export { isDemoSeedClient, demoSeedPhones } from './clientDemoSeed'

export function normalizePhone(phone: string): string {
  return (phone || '').replace(/\D/g, '').slice(-9)
}

export function phonesMatch(a: string, b: string): boolean {
  const da = normalizePhone(a)
  const db = normalizePhone(b)
  return !!da && !!db && da === db
}

export const CLIENT_NAME_PLACEHOLDER = 'Клиент'

export function isClientNamePlaceholder(name?: string | null): boolean {
  const t = (name || '').trim()
  return !t || t === CLIENT_NAME_PLACEHOLDER
}

/** Предпочитает реальное имя вместо заглушки «Клиент» */
export function pickClientDisplayName(...names: (string | undefined | null)[]): string {
  for (const n of names) {
    const t = (n || '').trim()
    if (t && !isClientNamePlaceholder(t)) return t
  }
  for (const n of names) {
    const t = (n || '').trim()
    if (t) return t
  }
  return CLIENT_NAME_PLACEHOLDER
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
  const known = ['basic', 'bronze', 'silver', 'gold', 'platinum'] as ClientLevel[]
  const legacyBasic = raw.level === 'new' || raw.level === ('' as string)
  const level = known.includes(raw.level as ClientLevel)
    ? (raw.level as ClientLevel)
    : legacyBasic || ((Number(raw.orders) || 0) === 0 && (Number(raw.spent) || 0) === 0)
      ? 'basic'
      : 'basic'
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
    vip: !!raw.vip || vipFromNote(raw.note),
    debtEnabled: raw.debtEnabled === true
      || debtFromNote(raw.note)
      || (raw.debtEnabled === undefined && !debtFromNote(raw.note) && ((Number(raw.debt) || 0) > 0 || (Number(raw.debtLimit) || 0) > 0)),
    note: raw.note || '',
    createdAt: raw.createdAt,
    lastOrderAt: raw.lastOrderAt,
    loyaltyPeriod: raw.loyaltyPeriod || undefined,
    bonusEligibleFrom: raw.bonusEligibleFrom || undefined,
    accountGeneration: Number(raw.accountGeneration) > 0 ? Number(raw.accountGeneration) : 1,
    recoveryExpiresAt: raw.recoveryExpiresAt || undefined,
    accountStatus: raw.accountStatus === 'recovery' || (raw.note || '').includes(RECOVERY_NOTE_PREFIX)
      ? 'recovery'
      : 'active',
    deletedAt: raw.deletedAt || parseRecoveryDeletedAt(raw.note || ''),
  }
}

/** Минимум покупок за месяц для уровня Бронза (ниже — «Базовый», без кэшбэка) */
export const BRONZE_MIN_SPENT = 500

export function hasEarnedBronze(spent: number, _orderCount = 0): boolean {
  const min = typeof window !== 'undefined' ? loadLoyaltyStatusConfig().bronzeMinSpent : BRONZE_MIN_SPENT
  return spent >= min
}

/** Доставленные заказы клиента за период (по умолчанию — текущий месяц) */
export function loyaltyOrdersForClient(
  orders: Order[],
  phone: string,
  period = currentLoyaltyPeriod(),
  account?: Pick<AdminClient, 'id' | 'phone' | 'accountGeneration'> | null,
): Order[] {
  return orders.filter(
    o => phonesMatch(o.client?.phone || '', phone)
      && o.status === 'delivered'
      && orderInLoyaltyPeriod(o, period)
      && (!account || orderBelongsToClientAccount(o, account)),
  )
}

export function loyaltyStatsFromOrders(
  orders: Order[],
  phone: string,
  period = currentLoyaltyPeriod(),
  account?: Pick<AdminClient, 'id' | 'phone' | 'accountGeneration'> | null,
): { orderCount: number; spent: number; period: string } {
  const delivered = loyaltyOrdersForClient(orders, phone, period, account)
  return {
    period,
    orderCount: delivered.length,
    spent: Math.round(delivered.reduce((s, o) => s + (o.total || 0) + (o.bonusSpent || 0), 0) * 10) / 10,
  }
}

const TIER_ORDER: ClientLevel[] = ['bronze', 'silver', 'gold', 'platinum']

export function loyaltyTierIndex(level: ClientLevel): number {
  if (level === 'basic') return -1
  return TIER_ORDER.indexOf(level)
}

export function maxClientLevel(a: ClientLevel, b: ClientLevel): ClientLevel {
  return loyaltyTierIndex(a) >= loyaltyTierIndex(b) ? a : b
}

/** Уровень за текущий месяц: авто + назначение админки (только если задан в этом месяце) */
export function resolveEffectiveClientLevel(
  spent: number,
  orderCount: number,
  storedLevel?: ClientLevel | 'new',
  storedPeriod?: string,
): ClientLevel {
  const normalizedStored = storedLevel === 'new' ? 'basic' : storedLevel
  const storedActive = isLoyaltyPeriodCurrent(storedPeriod)
  const adminAssignedLegacy = !!normalizedStored && normalizedStored !== 'basic' && !storedPeriod
  const storedForMonth = storedActive && normalizedStored && normalizedStored !== 'basic'
    ? normalizedStored
    : adminAssignedLegacy
      ? normalizedStored!
      : 'basic'

  const earned = suggestLevel(spent)
  const earnedBronze = hasEarnedBronze(spent, orderCount)

  if (storedForMonth !== 'basic') {
    if (!earnedBronze && !storedActive && !adminAssignedLegacy) return 'basic'
    if (!earnedBronze) return storedForMonth
    const earnedIdx = loyaltyTierIndex(earned)
    const storedIdx = loyaltyTierIndex(storedForMonth)
    return earnedIdx > storedIdx ? earned : storedForMonth
  }

  return earnedBronze ? earned : 'basic'
}

export function shouldAutoUpgradeLevel(
  stored: ClientLevel | undefined,
  effective: ClientLevel,
  storedPeriod?: string,
): boolean {
  if (!storedPeriod) {
    if (!stored || stored === 'basic') return effective !== 'basic'
    return loyaltyTierIndex(effective) > loyaltyTierIndex(stored)
  }
  if (!isLoyaltyPeriodCurrent(storedPeriod) && effective === 'basic' && stored !== 'basic') {
    return true // месяц сменился — сбросить до basic
  }
  if (effective === stored && isLoyaltyPeriodCurrent(storedPeriod)) return false
  if (!stored || stored === 'basic') return effective !== 'basic'
  if (!isLoyaltyPeriodCurrent(storedPeriod)) return effective !== 'basic'
  return loyaltyTierIndex(effective) > loyaltyTierIndex(stored)
}

export function suggestLevel(spent: number, cfg?: ReturnType<typeof loadLoyaltyStatusConfig>): ClientLevel {
  const c = cfg ?? (typeof window !== 'undefined' ? loadLoyaltyStatusConfig() : DEFAULT_LOYALTY_STATUS_CONFIG)
  const t = tierThresholdsFromConfig(c)
  if (spent >= t.platinum) return 'platinum'
  if (spent >= t.gold) return 'gold'
  if (spent >= t.silver) return 'silver'
  if (spent >= t.bronze) return 'bronze'
  return 'basic'
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

export function statsFromOrders(
  orders: Order[],
  client: Pick<AdminClient, 'id' | 'phone' | 'accountGeneration'>,
): ClientOrderStats {
  const phone = client.phone
  const related = orders.filter(o => orderBelongsToClientAccount(o, client))
  const delivered = loyaltyOrdersForClient(orders, phone, currentLoyaltyPeriod(), client)
  const active = related.filter(o => o.status !== 'cancelled')
  return {
    orders: delivered.length,
    spent: Math.round(delivered.reduce((s, o) => s + (o.total || 0) + (o.bonusSpent || 0), 0) * 10) / 10,
    marketOrders: active.filter(o => o.type === 'market').length,
    restaurantOrders: active.filter(o => o.type === 'restaurant').length,
    mixedOrders: active.filter(o => o.type === 'mixed').length,
    lastOrderAt: active[0]?.createdAt,
    lastAddr: active[0]?.client?.addr,
  }
}

export function enrichClientWithOrders(client: AdminClient, orders: Order[]): AdminClient & ClientOrderStats & { lastLabel: string } {
  const live = statsFromOrders(orders, client)
  const hasLive = orders.some(o => orderBelongsToClientAccount(o, client))
  const crmMonthly = isLoyaltyPeriodCurrent(client.loyaltyPeriod)
  const spent = hasLive ? live.spent : (crmMonthly ? client.spent : 0)
  const ordersCount = hasLive ? live.orders : (crmMonthly ? client.orders : 0)
  const level = hasLive || orders.length > 0
    ? resolveEffectiveClientLevel(spent, ordersCount, client.level || 'basic', client.loyaltyPeriod)
    : (client.level || 'basic')
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
  for (const c of stored) {
    if (isClientPurged(c)) continue
    const key = normalizePhone(c.phone)
    if (!key || isPhoneDeleted(c.phone)) continue
    byPhone.set(key, normalizeClient(c))
  }

  for (const order of orders) {
    const phone = order.client?.phone || ''
    const key = normalizePhone(phone)
    if (!key || isPhoneDeleted(phone)) continue
    // Не создавать «призрака» из демо-заказа K-4832 (телефоны U-01…U-07)
    if (!byPhone.has(key) && isDemoSeedClient(undefined, phone)) continue
    if (!byPhone.has(key)) {
      byPhone.set(key, normalizeClient({
        id: `U-${key}`,
        name: pickClientDisplayName(order.client?.name),
        phone: order.client?.phone || phone,
        addr: order.client?.addr || '',
        card: '',
        level: 'basic',
        orders: 0,
        spent: 0,
        debt: 0,
        bonus: 0,
        debtLimit: 0,
        blocked: false,
      }))
    } else {
      const prev = byPhone.get(key)!
      prev.name = pickClientDisplayName(prev.name, order.client?.name)
      if (!prev.addr && order.client?.addr) prev.addr = order.client.addr
    }
  }

  return [...byPhone.values()]
    .filter(c => !isClientPurged(c) && !isPhoneDeleted(c.phone))
    .map(c => enrichClientWithOrders(c, orders))
}
