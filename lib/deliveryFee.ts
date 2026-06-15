import { calcDeliveryFee, calcDeliveryPrice, type PricingConfig } from './courierData'
import { normalizeOrder } from './orderParts'
import type { Order } from './types'

/** Заказ уже завершён или стоимость доставки зафиксирована при оформлении/доставке */
export function isOrderDeliveryFeeLocked(order: Order): boolean {
  return (
    order.deliveryFeeLocked === true
    || order.status === 'delivered'
    || order.status === 'cancelled'
  )
}

export function orderWeightKg(order: Order): number {
  if (order.weightKg != null && order.weightKg > 0) return order.weightKg
  const items = Array.isArray(order.items) ? order.items : []
  if (!items.length) return 5
  return Math.max(1, Math.round(items.reduce((s, it) => s + (Number(it.qty) || 1) * 0.4, 10) * 10) / 10)
}

/** Стоимость доставки: для завершённых — только сохранённая сумма; для новых — текущий тариф */
export function resolveOrderDeliveryFee(
  order: Order,
  pricing: PricingConfig,
  roadKm: Record<string, number> = {},
): number {
  const o = normalizeOrder(order)
  if (isOrderDeliveryFeeLocked(o)) {
    return Math.max(0, Number(o.deliveryFee) || 0)
  }

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

export function buildDeliveryFeePatch(
  order: Order,
  pricing: PricingConfig,
  roadKm: Record<string, number> = {},
): { deliveryFee: number; deliveryFeeLocked: true } {
  return {
    deliveryFee: resolveOrderDeliveryFee(order, pricing, roadKm),
    deliveryFeeLocked: true,
  }
}
