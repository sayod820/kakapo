import type { Order } from './types'
import type { DemoCourierOrder } from './demoOrders'
import {
  isTransferPayment,
  isVipCreditPayment,
  orderPaymentMethod,
  paymentMethodLabel,
} from './storePayment'

export type CourierPaymentBreakdown = {
  isCredit: boolean
  isTransfer: boolean
  products: number
  delivery: number
  credit: number
  cash: number
  payLabel: string
}

export { orderPaymentMethod, isVipCreditPayment as isVipCreditOrder }

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
  const method = orderPaymentMethod(order)
  const isCredit = isVipCreditPayment(method)
  const isTransfer = isTransferPayment(method)
  const storedDelivery = Number(order.deliveryFee) || 0
  const delivery = deliveryFee ?? (storedDelivery > 0 ? storedDelivery : null) ?? 0
  const products = orderProductsTotal(order)

  if (isCredit) {
    const credit = Number(order.creditAmount) >= 0 ? Number(order.creditAmount) : products
    const cash = delivery
    return {
      isCredit: true,
      isTransfer: false,
      products: credit,
      delivery: cash,
      credit,
      cash,
      payLabel: 'VIP-кредит',
    }
  }

  if (isTransfer) {
    return {
      isCredit: false,
      isTransfer: true,
      products,
      delivery,
      credit: 0,
      cash: 0,
      payLabel: 'Перевод',
    }
  }

  const cash = products + delivery
  return {
    isCredit: false,
    isTransfer: false,
    products,
    delivery,
    credit: 0,
    cash,
    payLabel: paymentMethodLabel(method),
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
