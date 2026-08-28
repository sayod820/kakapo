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
    paidCard?: number
  },
): number {
  const pay = String(order.pay || order.payment_method || '').toLowerCase()
  // Долг / кошелёк / полная оплата бонусами — без прогресса и кэшбэка статуса
  if (pay === 'credit' || pay === 'wallet' || pay === 'balance') return 0

  const credit = Number(order.creditAmount) || 0
  const base = orderGoodsTotal(order)

  if (order.channel === 'pos' || order.posSaleId) {
    const rawCash = Number(order.paidCash)
    const rawCard = Number(order.paidCard)
    const hasCash = Number.isFinite(rawCash)
    const hasCard = Number.isFinite(rawCard)
    if (hasCash || hasCard) {
      const cash = hasCash ? Math.max(0, rawCash) : 0
      const card = hasCard ? Math.max(0, rawCard) : 0
      const sum = Math.round((cash + card) * 100) / 100
      // Старые чеки «только карта» без поля paidCard (не путать с оплатой бонусами: paidCard=0)
      if (sum < 0.001 && pay === 'card' && !hasCard) {
        return Math.max(0, Math.round((base - credit) * 100) / 100)
      }
      return Math.max(0, sum)
    }
    if (pay && pay !== 'cash' && pay !== 'card' && pay !== 'mixed') return 0
  }

  // Приложение и прочее: нал и карта считаются, сумма в долг вычитается
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
    paidCard?: number
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
