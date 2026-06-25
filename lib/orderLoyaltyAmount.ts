import type { Order, OrderItem } from './types'

/** Сумма товаров в заказе (без доставки). */
export function orderItemsSubtotal(items?: OrderItem[] | null): number {
  if (!items?.length) return 0
  return Math.round(
    items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 1), 0) * 100,
  ) / 100
}

function goodsTotalFromPayable(
  order: Pick<Order, 'total' | 'deliveryFee' | 'bonusSpent'>,
): number {
  const total = Number(order.total) || 0
  const bonusSpent = Number(order.bonusSpent) || 0
  const delivery = Number(order.deliveryFee) || 0
  return Math.max(0, Math.round((total + bonusSpent - delivery) * 100) / 100)
}

/** Сумма покупки (товары) без курьерской доставки — для выручки, чеков, статистики магазина. */
export function orderGoodsTotal(
  order: Pick<Order, 'items' | 'total' | 'deliveryFee' | 'bonusSpent' | 'goodsTotal'>,
): number {
  const explicit = Number(order.goodsTotal)
  if (Number.isFinite(explicit) && explicit >= 0) return explicit

  const fromTotal = goodsTotalFromPayable(order)
  const fromItems = orderItemsSubtotal(order.items)
  if (fromItems <= 0) return fromTotal

  const delivery = Number(order.deliveryFee) || 0
  if (delivery <= 0) return fromItems
  if (fromItems > fromTotal + 0.05) return fromTotal
  return fromItems
}

/** База для кэшбэка и месячных трат: только товары, без курьерской доставки. */
export function bonusEligibleTotal(
  order: Pick<Order, 'items' | 'total' | 'deliveryFee' | 'bonusSpent' | 'goodsTotal'>,
): number {
  return orderGoodsTotal(order)
}

export function orderSpentContribution(
  order: Pick<Order, 'items' | 'total' | 'deliveryFee' | 'bonusSpent' | 'goodsTotal'>,
): number {
  return orderGoodsTotal(order)
}
