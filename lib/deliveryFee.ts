import { calcDeliveryFee, calcDeliveryPrice, type PricingConfig } from './courierData'
import { normalizeOrder } from './orderParts'
import type { Order } from './types'

/** Заказ уже завершён или стоимость доставки зафиксирована (не нулевая) */
export function isOrderDeliveryFeeLocked(order: Order): boolean {
  const saved = Math.max(0, Number(order.deliveryFee) || 0)
  return (
    order.status === 'delivered'
    || order.status === 'cancelled'
    || (order.deliveryFeeLocked === true && saved > 0)
  )
}

export function orderWeightKg(order: Order): number {
  if (order.weightKg != null && order.weightKg > 0) return order.weightKg
  const items = Array.isArray(order.items) ? order.items : []
  if (!items.length) return 5
  return Math.max(1, Math.round(items.reduce((s, it) => s + (Number(it.qty) || 1) * 0.4, 10) * 10) / 10)
}

function computeLiveDeliveryFee(
  o: Order,
  pricing: PricingConfig,
  roadKm: Record<string, number>,
): number {
  const km = roadKm[o.id] ?? o.distanceKm ?? null
  const weight = orderWeightKg(o)

  if (km != null) {
    return calcDeliveryPrice({
      orderAmount: o.total,
      distanceKm: km,
      weightKg: weight,
      pricing,
    }).total
  }

  if (o.deliveryFee != null && o.deliveryFee > 0) return o.deliveryFee
  return calcDeliveryFee(2, weight, pricing)
}

/** Стоимость доставки: для завершённых — сохранённая сумма или пересчёт по тарифу, если была 0 */
export function resolveOrderDeliveryFee(
  order: Order,
  pricing: PricingConfig,
  roadKm: Record<string, number> = {},
): number {
  const o = normalizeOrder(order)
  const saved = Math.max(0, Number(o.deliveryFee) || 0)

  if (o.status === 'delivered' || o.status === 'cancelled') {
    if (saved > 0) return saved
    return computeLiveDeliveryFee(o, pricing, roadKm)
  }

  if (o.deliveryFeeLocked === true && saved > 0) return saved

  return computeLiveDeliveryFee(o, pricing, roadKm)
}

export function buildDeliveryFeePatch(
  order: Order,
  pricing: PricingConfig,
  roadKm: Record<string, number> = {},
): { deliveryFee: number; deliveryFeeLocked: true } {
  const o = normalizeOrder(order)
  return {
    deliveryFee: computeLiveDeliveryFee(o, pricing, roadKm),
    deliveryFeeLocked: true,
  }
}
