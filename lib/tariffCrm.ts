import {
  calcDeliveryFee,
  calcDeliveryPrice,
  DEFAULT_PRICING,
  type PricingConfig,
} from './courierData'
import { courierDeliveryEarning } from './courierStats'
import { isOrderDeliveryFeeLocked, orderWeightKg, resolveOrderDeliveryFee } from './deliveryFee'
import { orderGoodsTotal } from './orderLoyaltyAmount'
import { inferOrderType } from './orderParts'
import type { Order } from './types'
import type { AdminCourier } from './courierTeam'

export type TariffTab = 'shop' | 'restaurants' | 'couriers' | 'assemblers'

export const TARIFF_TAB_OPTIONS: { id: TariffTab; label: string; icon: string; color: string }[] = [
  { id: 'shop', label: 'Магазин', icon: '🛒', color: '#1FD760' },
  { id: 'restaurants', label: 'Рестораны', icon: '🍽', color: '#FF8C00' },
  { id: 'couriers', label: 'Курьеры', icon: '🛵', color: '#3B8EF0' },
  { id: 'assemblers', label: 'Сборщики', icon: '📦', color: '#9B6DFF' },
]

export const TARIFF_PRESETS: { id: string; label: string; desc: string; emoji: string; config: PricingConfig }[] = [
  {
    id: 'economy',
    label: 'Эконом',
    desc: 'Ниже база · больше бесплатных доставок',
    emoji: '💚',
    config: { base: 7, baseDist: 2, perKm: 2, heavyKg: 50, heavyExtra: 8, freeFrom: 80 },
  },
  {
    id: 'standard',
    label: 'Стандарт',
    desc: 'Рекомендуемый тариф КАКАПО',
    emoji: '⭐',
    config: { ...DEFAULT_PRICING, freeFrom: 0 },
  },
  {
    id: 'premium',
    label: 'Премиум',
    desc: 'Выше база · приоритетная доставка',
    emoji: '👑',
    config: { base: 15, baseDist: 3, perKm: 4, heavyKg: 40, heavyExtra: 15, freeFrom: 150 },
  },
]

export const TARIFF_FIELD_META: {
  key: keyof PricingConfig
  label: string
  unit: string
  hint: string
  step?: number
}[] = [
  { key: 'base', label: 'Базовая стоимость', unit: 'ЅМ', hint: 'Минимальная цена доставки', step: 1 },
  { key: 'baseDist', label: 'Бесплатный радиус', unit: 'км', hint: 'До этого расстояния — только базовая цена', step: 0.1 },
  { key: 'perKm', label: 'За каждый доп. км', unit: 'ЅМ/км', hint: 'Добавляется за каждый км сверх базового', step: 0.5 },
  { key: 'heavyKg', label: 'Порог тяжёлого груза', unit: 'кг', hint: 'Если вес заказа превышает — надбавка', step: 1 },
  { key: 'heavyExtra', label: 'Надбавка за тяжёлый груз', unit: 'ЅМ', hint: 'Добавляется если вес > порога', step: 1 },
  { key: 'freeFrom', label: 'Бесплатная доставка от', unit: 'ЅМ', hint: '0 = отключено · сумма заказа для бесплатной доставки', step: 10 },
  { key: 'courierCommissionPercent', label: 'Комиссия с курьера', unit: '%', hint: '% от стоимости доставки · списывается при принятии заказа', step: 1 },
]

export function validatePricing(p: PricingConfig): string | null {
  if (p.base < 0) return 'Базовая стоимость не может быть отрицательной'
  if (p.baseDist < 0) return 'Радиус не может быть отрицательным'
  if (p.perKm < 0) return 'Цена за км не может быть отрицательной'
  if (p.heavyKg <= 0) return 'Порог веса должен быть больше 0'
  if (p.heavyExtra < 0) return 'Надбавка не может быть отрицательной'
  if (p.freeFrom != null && p.freeFrom < 0) return 'Порог бесплатной доставки не может быть отрицательным'
  if ((p.courierCommissionPercent ?? 0) < 0) return 'Комиссия курьера не может быть отрицательной'
  if ((p.courierCommissionPercent ?? 0) > 100) return 'Комиссия курьера не может быть больше 100%'
  return null
}

export function normalizePricing(raw: Partial<PricingConfig>): PricingConfig {
  return {
    base: Number(raw.base) || DEFAULT_PRICING.base,
    baseDist: Number(raw.baseDist) ?? DEFAULT_PRICING.baseDist,
    perKm: Number(raw.perKm) ?? DEFAULT_PRICING.perKm,
    heavyKg: Number(raw.heavyKg) ?? DEFAULT_PRICING.heavyKg,
    heavyExtra: Number(raw.heavyExtra) ?? DEFAULT_PRICING.heavyExtra,
    freeFrom: Number(raw.freeFrom) ?? 0,
    courierCommissionPercent: Math.max(0, Math.min(100, Number(
      raw.courierCommissionPercent ?? raw.courierCommissionPerOrder ?? DEFAULT_PRICING.courierCommissionPercent,
    ) || 0)),
  }
}

export function buildTariffStats(
  orders: Order[],
  pricing: PricingConfig,
  roadKm: Record<string, number>,
) {
  const delivered = orders.filter(o => o.status === 'delivered')
  let totalFees = 0
  let count = 0
  let freeCount = 0
  for (const o of delivered) {
    const fee = resolveOrderDeliveryFee(o, pricing, roadKm)
    totalFees += fee
    count++
    if (fee === 0) freeCount++
  }
  return {
    avgDelivery: count ? Math.round(totalFees / count) : 0,
    deliveredCount: count,
    freeCount,
    totalDeliveryRevenue: Math.round(totalFees),
  }
}

export interface TariffOrderPreview {
  id: string
  type: string
  client: string
  km: number
  weight: number
  orderTotal: number
  fee: number
  isFree: boolean
  breakdown: string[]
  status: string
  locked: boolean
}

export function previewOrdersForTab(
  orders: Order[],
  pricing: PricingConfig,
  roadKm: Record<string, number>,
  tab: TariffTab,
  limit = 10,
): TariffOrderPreview[] {
  const filtered = orders.filter(o => {
    const t = inferOrderType(o)
    if (tab === 'shop') return t === 'market' || t === 'mixed'
    if (tab === 'restaurants') return t === 'restaurant' || t === 'mixed'
    if (tab === 'couriers') return o.status === 'delivered' || o.status === 'delivering'
    return t === 'market' || t === 'mixed'
  })

  return filtered.slice(0, limit).map(o => {
    const km = roadKm[o.id] ?? o.distanceKm ?? 2.5
    const weight = orderWeightKg(o)
    const locked = isOrderDeliveryFeeLocked(o)
    const fee = resolveOrderDeliveryFee(o, pricing, roadKm)
    const goodsTotal = orderGoodsTotal(o)
    const livePreview = locked ? null : calcDeliveryPrice({
      orderAmount: goodsTotal,
      distanceKm: km,
      weightKg: weight,
      pricing,
    })
    return {
      id: o.id,
      type: inferOrderType(o),
      client: o.client?.name || 'Клиент',
      km: Math.round(km * 10) / 10,
      weight,
      orderTotal: goodsTotal,
      fee,
      isFree: fee === 0,
      breakdown: livePreview?.breakdown ?? [`🔒 Зафиксировано: ${fee} ЅМ`],
      status: o.status,
      locked,
    }
  })
}

export function courierTariffSummary(
  orders: Order[],
  couriers: AdminCourier[],
  pricing: PricingConfig,
  roadKm: Record<string, number>,
) {
  const delivered = orders.filter(o => o.status === 'delivered')
  const totalEarnings = delivered.reduce(
    (s, o) => s + courierDeliveryEarning(o, roadKm, pricing),
    0,
  )
  return {
    courierCount: couriers.filter(c => !c.blocked).length,
    activeCouriers: couriers.filter(c => c.status !== 'offline').length,
    deliveries: delivered.length,
    totalEarnings: Math.round(totalEarnings),
    avgPerDelivery: delivered.length ? Math.round(totalEarnings / delivered.length) : 0,
  }
}

export function calcPreview(
  pricing: PricingConfig,
  distKm: number,
  weightKg: number,
  orderAmount: number,
) {
  const feeOnly = calcDeliveryFee(distKm, weightKg, pricing)
  const full = calcDeliveryPrice({
    orderAmount,
    distanceKm: distKm,
    weightKg,
    pricing,
  })
  const extraKm = Math.max(0, distKm - pricing.baseDist)
  const extraCost = extraKm > 0 ? Math.ceil(extraKm * pricing.perKm) : 0
  const heavy = weightKg > pricing.heavyKg
  return { feeOnly, full, extraKm, extraCost, heavy, breakdown: full.breakdown, isFree: full.isFree }
}

export function formatSm(n: number): string {
  return `${Math.round(n).toLocaleString('ru-RU')} ЅМ`
}

export const TAB_CONNECTIONS: Record<TariffTab, { href: string; label: string; desc: string }[]> = {
  shop: [
    { href: '/store', label: 'Магазин клиента', desc: 'Клиент видит стоимость доставки при оформлении' },
    { href: '/admin?p=orders', label: 'Заказы магазина', desc: 'Статус и deliveryFee в заказах' },
  ],
  restaurants: [
    { href: '/restaurant', label: 'Кабинет ресторана', desc: 'Доставка добавляется к заказу клиента' },
    { href: '/admin?p=partners', label: 'Рестораны-партнёры', desc: 'Точки забора для маршрута' },
  ],
  couriers: [
    { href: '/courier', label: 'Приложение курьера', desc: 'Заработок = тариф доставки по заказу' },
    { href: '/admin?p=courierorders', label: 'Заказы курьеров', desc: 'Маршруты и км по OSRM' },
    { href: '/admin?p=finance', label: 'Финансы → Курьеры', desc: 'Сводка выплат курьерам' },
  ],
  assemblers: [
    { href: '/assembler', label: 'Приложение сборщика', desc: 'Тариф не влияет на сборку · только доставка' },
    { href: '/admin?p=finance', label: 'Финансы → Сборщики', desc: 'Отдельная оплата сборки (3 ЅМ/заказ)' },
  ],
}
