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

export function cashEligibleTotal(
  order: Pick<Order, 'items' | 'total' | 'deliveryFee' | 'bonusSpent' | 'goodsTotal' | 'pay' | 'payment_method' | 'creditAmount'> & {
    channel?: string
    posSaleId?: string
    paidCash?: number
  },
): number {
  const pay = String(order.pay || order.payment_method || '').toLowerCase()
  if (pay === 'credit') return 0
  const posCash = Number(order.paidCash)
  if (order.channel === 'pos' || order.posSaleId) {
    if (Number.isFinite(posCash)) return Math.max(0, Math.round(posCash * 100) / 100)
    if (pay && pay !== 'cash' && pay !== 'mixed') return 0
  }
  if (pay === 'card' || pay === 'wallet') return 0
  const credit = Number(order.creditAmount) || 0
  const base = orderGoodsTotal(order)
  return Math.max(0, Math.round((base - credit) * 100) / 100)
}

export function bonusEligibleTotal(
  order: Pick<Order, 'items' | 'total' | 'deliveryFee' | 'bonusSpent' | 'goodsTotal'>,
): number {
  return orderGoodsTotal(order)
}

export function orderSpentContribution(
  order: Pick<Order, 'items' | 'total' | 'deliveryFee' | 'bonusSpent' | 'goodsTotal' | 'pay' | 'payment_method' | 'creditAmount'> & {
    channel?: string
    posSaleId?: string
    paidCash?: number
  },
): number {
  return cashEligibleTotal(order)
}

/** Сумма к оплате клиентом: товары + доставка − бонусы. */
export function orderPayableTotal(
  order: Pick<Order, 'total' | 'deliveryFee' | 'bonusSpent' | 'items' | 'goodsTotal'>,
): number {
  const stored = Number(order.total)
  const goods = orderGoodsTotal(order)
  const delivery = Number(order.deliveryFee) || 0
  const bonus = Number(order.bonusSpent) || 0
  if (Number.isFinite(stored) && stored > 0) {
    if (delivery > 0 && Math.abs(stored - goods) < 0.05 && goods + delivery - bonus > stored + 0.05) {
      return Math.max(0, Math.round((goods + delivery - bonus) * 100) / 100)
    }
    return stored
  }
  return Math.max(0, Math.round((goods + delivery - bonus) * 100) / 100)
}
