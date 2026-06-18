/** Способы оплаты в клиентском приложении (без онлайн-эквайринга) */

export type PaymentMethodId = 'cash' | 'transfer' | 'credit' | 'card'
export type PaymentStatus = 'pending' | 'confirmed'

export const STORE_PAYMENT_REQUISITES = {
  kaspi: '+992 93 000 00 00',
  holder: 'ИП КАКАПО',
  bank: 'Аmonatbank',
  note: 'В комментарии к переводу укажите номер заказа',
}

export const CHECKOUT_PAYMENT_OPTIONS = [
  { id: 'cash', icon: '💵', label: 'Наличными', sub: 'Курьеру при получении' },
  { id: 'transfer', icon: '📱', label: 'Перевод', sub: 'Kaspi / банк · до отправки курьера' },
] as const

export function orderPaymentMethod(
  order: Pick<{ payment_method?: string; pay?: string }, 'payment_method' | 'pay'> | Record<string, unknown>,
): string {
  const raw = order as Record<string, unknown>
  return String(raw.payment_method ?? raw.pay ?? 'cash')
}

export function isTransferPayment(method?: string): boolean {
  return method === 'transfer'
}

export function isVipCreditPayment(method?: string): boolean {
  return method === 'credit'
}

export function paymentMethodLabel(method?: string): string {
  switch (method) {
    case 'cash': return 'Наличными'
    case 'transfer': return 'Перевод'
    case 'credit': return 'VIP-кредит'
    case 'card': return 'Картой'
    default: return 'Наличными'
  }
}

export function initialPaymentStatus(method: string): PaymentStatus | undefined {
  if (method === 'transfer') return 'pending'
  return 'confirmed'
}

export function needsTransferConfirmation(order: {
  payment_method?: string
  pay?: string
  paymentStatus?: string
}): boolean {
  return isTransferPayment(orderPaymentMethod(order)) && order.paymentStatus !== 'confirmed'
}

export function paymentStatusLabel(method?: string, status?: string): string | null {
  if (!isTransferPayment(method)) return null
  return status === 'confirmed' ? 'Перевод получен' : 'Ожидаем перевод'
}
