/** Расчёт и фиксация стоимости доставки на сервере */

export const DEFAULT_PRICING = {
  base: 10,
  baseDist: 2.5,
  perKm: 3,
  heavyKg: 50,
  heavyExtra: 10,
  freeFrom: 0,
  courierCommissionPercent: 15,
}

export function normalizePricing(raw = {}) {
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

export function calcDeliveryFee(distKm, weightKg, pricing) {
  let fee = Number(pricing.base) || 0
  const baseDist = Number(pricing.baseDist) || 0
  const perKm = Number(pricing.perKm) || 0
  const heavyKg = Number(pricing.heavyKg) || 50
  const heavyExtra = Number(pricing.heavyExtra) || 0
  const freeFrom = Number(pricing.freeFrom) || 0

  if (distKm > baseDist) {
    fee += Math.ceil((distKm - baseDist) * perKm)
  }
  if (weightKg > heavyKg) fee += heavyExtra
  return fee
}

export function calcDeliveryTotal(orderAmount, distKm, weightKg, pricing) {
  const freeFrom = Number(pricing.freeFrom) || 0
  if (freeFrom > 0 && Number(orderAmount) >= freeFrom) return 0
  return calcDeliveryFee(distKm, weightKg, pricing)
}

export function orderWeightKg(order) {
  if (order.weightKg != null && order.weightKg > 0) return order.weightKg
  const items = Array.isArray(order.items) ? order.items : []
  if (!items.length) return 5
  return Math.max(1, Math.round(items.reduce((s, it) => s + (Number(it.qty) || 1) * 0.4, 10) * 10) / 10)
}

export function isDeliveryFeeLocked(order) {
  const saved = Math.max(0, Number(order.deliveryFee) || 0)
  return order.status === 'delivered'
    || order.status === 'cancelled'
    || (order.deliveryFeeLocked === true && saved > 0)
}

/** Зафиксировать стоимость доставки (при оформлении или при доставке) */
export function lockOrderDeliveryFee(order, pricing) {
  const saved = Math.max(0, Number(order.deliveryFee) || 0)
  if (isDeliveryFeeLocked(order) && saved > 0) {
    order.deliveryFeeLocked = true
    return order
  }

  const km = Number(order.distanceKm) || 2.5
  const weight = orderWeightKg(order)
  order.deliveryFee = calcDeliveryTotal(order.total, km, weight, pricing)
  order.deliveryFeeLocked = true
  return order
}
