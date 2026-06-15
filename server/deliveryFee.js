/** Расчёт и фиксация стоимости доставки на сервере */

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
  return order.deliveryFeeLocked === true
    || order.status === 'delivered'
    || order.status === 'cancelled'
}

/** Зафиксировать стоимость доставки (при оформлении или при доставке) */
export function lockOrderDeliveryFee(order, pricing) {
  if (isDeliveryFeeLocked(order)) {
    order.deliveryFeeLocked = true
    return order
  }

  const hasFee = order.deliveryFee != null && Number.isFinite(Number(order.deliveryFee))
  if (!hasFee) {
    const km = Number(order.distanceKm) || 2.5
    const weight = orderWeightKg(order)
    order.deliveryFee = calcDeliveryTotal(order.total, km, weight, pricing)
  } else {
    order.deliveryFee = Math.max(0, Number(order.deliveryFee))
  }

  order.deliveryFeeLocked = true
  return order
}
