import type { Order } from './types'
import {
  clientSegment,
  enrichClientWithOrders,
  normalizeClient,
  type AdminClient,
  type ClientLevel,
} from './clientCrm'

export type PushSegmentId =
  | 'all'
  | 'vip'
  | 'gold_plus'
  | 'rest'
  | 'market'
  | 'inactive'
  | 'debt'
  | 'no_card'

export type PushAutoEventId =
  | 'order_accepted'
  | 'courier_departed'
  | 'order_delivered'
  | 'restaurant_accepted'
  | 'bonus_credited'
  | 'promo_daily'
  | 'bonus_expiring'

export interface PushCampaign {
  id: string
  title: string
  body: string
  segment: PushSegmentId
  segmentLabel: string
  icon: string
  recipients: number
  delivered: number
  opened: number
  sentAt: string
}

export interface PushAutoSetting {
  id: PushAutoEventId
  label: string
  description: string
  enabled: boolean
  icon: string
}

export interface PushTemplate {
  id: string
  emoji: string
  title: string
  body: string
  segment?: PushSegmentId
}

export type PushClient = AdminClient & {
  marketOrders: number
  restaurantOrders: number
  mixedOrders: number
  lastOrderAt?: string
  lastLabel: string
}

export const PUSH_SEGMENT_OPTIONS: { id: PushSegmentId; label: string; emoji: string; hint: string }[] = [
  { id: 'all', label: 'Все клиенты', emoji: '👥', hint: 'Общая рассылка — видят все в приложении' },
  { id: 'vip', label: 'VIP клиенты', emoji: '💎', hint: 'Platinum + кредитный лимит' },
  { id: 'gold_plus', label: 'Gold и выше', emoji: '🥇', hint: 'Gold и Platinum уровни' },
  { id: 'rest', label: 'Посетители ресторанов', emoji: '🍽', hint: 'Заказывали из ресторанов' },
  { id: 'market', label: 'Покупатели магазина', emoji: '🛒', hint: 'Заказывали из КАКАПО Market' },
  { id: 'inactive', label: 'Неактивные 30+ дней', emoji: '💤', hint: 'Давно не делали заказ' },
  { id: 'debt', label: 'Клиенты с долгом', emoji: '💳', hint: 'Есть непогашенный долг по карте' },
  { id: 'no_card', label: 'Без карты', emoji: '🎴', hint: 'Ещё не получили КАКАПО-карту' },
]

export const PUSH_SEGMENT_LABELS: Record<PushSegmentId, string> = Object.fromEntries(
  PUSH_SEGMENT_OPTIONS.map(o => [o.id, o.label]),
) as Record<PushSegmentId, string>

export const DEFAULT_PUSH_TEMPLATES: PushTemplate[] = [
  { id: 't1', emoji: '🔥', title: 'Акция дня!', body: 'Скидки до 40% только сегодня! Заходите в приложение →', segment: 'all' },
  { id: 't2', emoji: '🍽', title: 'Новый ресторан!', body: 'Суши Яван теперь в КАКАПО — доставка за 30 минут!' },
  { id: 't3', emoji: '🎁', title: 'Бонусы истекают', body: 'Ваши бонусы сгорят через 3 дня. Потратьте их в магазине!', segment: 'gold_plus' },
  { id: 't4', emoji: '🚀', title: 'Бесплатная доставка', body: 'Сегодня доставляем бесплатно при любом заказе 🎉' },
  { id: 't5', emoji: '⭐', title: 'Оцените заказ', body: 'Расскажите как прошла доставка — нам важно ваше мнение!' },
  { id: 't6', emoji: '🥛', title: 'Молочная среда −30%', body: 'Скидка 30% на всё молочное до 22:00', segment: 'market' },
]

export const DEFAULT_PUSH_AUTO_SETTINGS: PushAutoSetting[] = [
  { id: 'order_accepted', label: 'При принятии заказа', description: 'Магазин и смешанные заказы', enabled: true, icon: '✅' },
  { id: 'courier_departed', label: 'Курьер выехал', description: 'Когда заказ в пути', enabled: true, icon: '🛵' },
  { id: 'order_delivered', label: 'Заказ доставлен', description: 'После успешной доставки', enabled: true, icon: '📦' },
  { id: 'restaurant_accepted', label: 'Заказ из ресторана принят', description: 'Ресторан начал готовить', enabled: true, icon: '🍽' },
  { id: 'bonus_credited', label: 'Бонусы начислены', description: 'При изменении баланса карты', enabled: true, icon: '⭐' },
  { id: 'promo_daily', label: 'Акции дня (9:00)', description: 'Ежедневная рассылка акций', enabled: false, icon: '🔥' },
  { id: 'bonus_expiring', label: 'Бонусы истекают', description: 'Напоминание за 3 дня', enabled: false, icon: '🎁' },
]

export const DEFAULT_PUSH_HISTORY: PushCampaign[] = [
  {
    id: 'h-demo-1',
    title: 'Молочная среда! −30%',
    body: 'Скидка 30% на молочное до 22:00',
    segment: 'market',
    segmentLabel: 'Покупатели магазина',
    icon: '🥛',
    recipients: 312,
    delivered: 312,
    opened: 106,
    sentAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: 'h-demo-2',
    title: 'Флэш-распродажа!',
    body: 'Только до 20:00 — скидки до 40%',
    segment: 'gold_plus',
    segmentLabel: 'Gold и выше',
    icon: '⚡',
    recipients: 390,
    delivered: 388,
    opened: 225,
    sentAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'h-demo-3',
    title: 'Новый ресторан!',
    body: 'Суши Яван теперь в КАКАПО',
    segment: 'all',
    segmentLabel: 'Все клиенты',
    icon: '🍽',
    recipients: 1847,
    delivered: 1840,
    opened: 405,
    sentAt: new Date(Date.now() - 86400000 * 4).toISOString(),
  },
]

const VIP_LEVELS: ClientLevel[] = ['platinum']
const GOLD_PLUS: ClientLevel[] = ['gold', 'platinum']

function daysSince(iso?: string): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

export function enrichClientsForPush(stored: AdminClient[], orders: Order[]): PushClient[] {
  return stored.map(c => enrichClientWithOrders(normalizeClient(c), orders))
}

export function filterClientsBySegment(clients: PushClient[], segment: PushSegmentId): PushClient[] {
  const active = clients.filter(c => !c.blocked)
  if (segment === 'all') return active
  return active.filter(c => {
    const seg = clientSegment(c)
    switch (segment) {
      case 'vip':
        return VIP_LEVELS.includes(c.level) || !!c.vip || (c.debtLimit >= 2000 && c.level !== 'bronze')
      case 'gold_plus':
        return GOLD_PLUS.includes(c.level)
      case 'rest':
        return seg === 'restaurant' || seg === 'mixed' || c.restaurantOrders > 0
      case 'market':
        return seg === 'market' || seg === 'mixed' || c.marketOrders > 0
      case 'inactive': {
        const days = daysSince(c.lastOrderAt || c.createdAt)
        return days === null || days >= 30
      }
      case 'debt':
        return c.debt > 0
      case 'no_card':
        return !c.card
      default:
        return true
    }
  })
}

export function countSegment(clients: PushClient[], segment: PushSegmentId): number {
  return filterClientsBySegment(clients, segment).length
}

export function formatPushTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays === 0) {
    return `Сегодня ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
  }
  if (diffDays === 1) return `Вчера ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
  if (diffDays < 7) {
    const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
    return `${days[d.getDay()]} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
  }
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function openRatePercent(opened: number, delivered: number): number {
  if (!delivered) return 0
  return Math.round((opened / delivered) * 100)
}

export function simulateOpenCount(delivered: number): number {
  const rate = 0.22 + Math.random() * 0.36
  return Math.max(1, Math.round(delivered * rate))
}
