import type { Order } from './types'
import type { DemoCourierOrder } from './demoOrders'

export type CourierPaymentBreakdown = {
  isCredit: boolean
  products: number
  delivery: number
  credit: number
  cash: number
  payLabel: string
}

export function orderPaymentMethod(order: Pick<Order, 'payment_method' | 'pay'> | Record<string, unknown>): string {
  const raw = order as Record<string, unknown>
  return String(raw.payment_method ?? raw.pay ?? 'cash')
}

export function isVipCreditOrder(order: Pick<Order, 'payment_method' | 'pay'> | Record<string, unknown>): boolean {
  return orderPaymentMethod(order) === 'credit'
}

/** Сумма товаров в заказе (без доставки) */
export function orderProductsTotal(order: Pick<Order, 'total' | 'deliveryFee' | 'creditAmount' | 'items'>): number {
  const credit = Number((order as Order).creditAmount)
  if (Number.isFinite(credit) && credit >= 0) return credit
  return Math.max(0, Number(order.total) - (Number(order.deliveryFee) || 0))
}

export function resolveCourierPayment(
  order: Pick<Order, 'total' | 'deliveryFee' | 'creditAmount' | 'payment_method' | 'pay'>,
  deliveryFee: number | null,
): CourierPaymentBreakdown {
  const isCredit = isVipCreditOrder(order)
  const storedDelivery = Number(order.deliveryFee) || 0
  const delivery = deliveryFee ?? (storedDelivery > 0 ? storedDelivery : null) ?? 0
  const products = orderProductsTotal(order)

  if (isCredit) {
    const credit = Number(order.creditAmount) >= 0 ? Number(order.creditAmount) : products
    const cash = delivery
    return {
      isCredit: true,
      products: credit,
      delivery: cash,
      credit,
      cash,
      payLabel: 'VIP-кредит',
    }
  }

  const cash = products + delivery
  const method = orderPaymentMethod(order)
  const payLabel = method === 'card' ? 'Картой' : 'Наличными'
  return {
    isCredit: false,
    products,
    delivery,
    credit: 0,
    cash,
    payLabel,
  }
}

export function mapCourierPayLabel(order: Order): string {
  return resolveCourierPayment(order, order.deliveryFee ?? null).payLabel
}

export function enrichCourierOrderPayment(
  mapped: DemoCourierOrder,
  order: Order,
): DemoCourierOrder {
  const breakdown = resolveCourierPayment(order, order.deliveryFee ?? null)
  return {
    ...mapped,
    pay: breakdown.payLabel,
    paymentMethod: orderPaymentMethod(order),
    creditAmount: breakdown.isCredit ? breakdown.credit : 0,
    cashDue: breakdown.isCredit ? breakdown.cash : breakdown.cash,
    sum: breakdown.products,
  }
}
