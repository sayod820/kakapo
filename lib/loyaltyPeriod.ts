'use client'

import type { Order } from './types'

/** Ключ периода лояльности: YYYY-MM */
export function currentLoyaltyPeriod(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function loyaltyPeriodLabel(period = currentLoyaltyPeriod()): string {
  const [y, m] = period.split('-').map(Number)
  if (!y || !m) return period
  const d = new Date(y, m - 1, 1)
  const month = d.toLocaleDateString('ru-RU', { month: 'long' })
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${y}`
}

export function loyaltyPeriodEndsLabel(period = currentLoyaltyPeriod()): string {
  const [y, m] = period.split('-').map(Number)
  if (!y || !m) return 'конец месяца'
  const last = new Date(y, m, 0)
  return last.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

export function parseOrderLoyaltyDate(
  order: Pick<Order, 'createdAt' | 'deliveredAt'> & { date?: string; createdAtIso?: string; deliveredAtIso?: string },
): Date | null {
  const raw = order.deliveredAtIso || order.createdAtIso || order.createdAt || order.date
  if (!raw) return new Date()
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? new Date() : d
  }
  // Формат «14:23» с API — считаем заказ текущего месяца
  if (/^\d{1,2}:\d{2}/.test(String(raw))) return new Date()
  return new Date()
}

export function orderInLoyaltyPeriod(
  order: Pick<Order, 'createdAt' | 'deliveredAt' | 'status'> & { date?: string; createdAtIso?: string; deliveredAtIso?: string },
  period = currentLoyaltyPeriod(),
): boolean {
  if (order.status === 'delivered') {
    const d = parseOrderLoyaltyDate(order)
    if (!d) return true
    const [y, m] = period.split('-').map(Number)
    return d.getFullYear() === y && d.getMonth() + 1 === m
  }
  const d = parseOrderLoyaltyDate(order)
  if (!d) return true
  const [y, m] = period.split('-').map(Number)
  return d.getFullYear() === y && d.getMonth() + 1 === m
}

export function loyaltyPeriodForOrder(
  order: Pick<Order, 'createdAt' | 'deliveredAt' | 'status'> & { date?: string; createdAtIso?: string; deliveredAtIso?: string },
): string {
  const d = parseOrderLoyaltyDate(order)
  if (!d) return currentLoyaltyPeriod()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function isLoyaltyPeriodCurrent(stored?: string | null): boolean {
  if (!stored) return false
  return stored === currentLoyaltyPeriod()
}
