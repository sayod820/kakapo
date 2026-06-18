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

export function parseOrderLoyaltyDate(order: Pick<Order, 'createdAt'> & { date?: string }): Date | null {
  const raw = order.createdAt || order.date
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

export function orderInLoyaltyPeriod(
  order: Pick<Order, 'createdAt'> & { date?: string },
  period = currentLoyaltyPeriod(),
): boolean {
  const d = parseOrderLoyaltyDate(order)
  if (!d) return false
  const [y, m] = period.split('-').map(Number)
  return d.getFullYear() === y && d.getMonth() + 1 === m
}

export function isLoyaltyPeriodCurrent(stored?: string | null): boolean {
  if (!stored) return false
  return stored === currentLoyaltyPeriod()
}
