'use client'

import type { ClientLevel } from './clientCrm'
import { hasEarnedBronze, suggestLevel } from './clientCrm'
import { currentLoyaltyPeriod, isLoyaltyPeriodCurrent } from './loyaltyPeriod'
import { getVipRules } from './clientLoyalty'

export type LoyaltyLockFields = {
  levelLockedPeriod?: string
  vipUntil?: string
  vip?: boolean
  level?: ClientLevel | 'new' | ''
}

/** Конец месяца лояльности (23:59:59.999 локально). */
export function endOfLoyaltyPeriodIso(period = currentLoyaltyPeriod()): string {
  const [y, m] = period.split('-').map(Number)
  if (!y || !m) return new Date().toISOString()
  return new Date(y, m, 0, 23, 59, 59, 999).toISOString()
}

export function vipUntilAfterDays(days: number, from = new Date()): string {
  const d = new Date(from)
  d.setDate(d.getDate() + Math.max(1, days))
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

export function isLevelLocked(record?: LoyaltyLockFields | null): boolean {
  if (!record?.levelLockedPeriod) return false
  return isLoyaltyPeriodCurrent(record.levelLockedPeriod)
}

export function isForcedVipActive(record?: LoyaltyLockFields | null, now = Date.now()): boolean {
  if (!record?.vip) return false
  if (!record.vipUntil) return true
  const until = new Date(record.vipUntil).getTime()
  if (Number.isNaN(until)) return true
  return now <= until
}

export function qualifiesAutoVip(
  spent: number,
  orderCount: number,
  reviewCount: number,
): boolean {
  const rules = getVipRules()
  return spent >= rules.minSpent && orderCount >= rules.minOrders && reviewCount >= rules.minReviews
}

/** Уровень по итогам месяца после снятия принудительного назначения. */
export function earnedLevelForPeriod(spent: number, orderCount: number): ClientLevel {
  if (!hasEarnedBronze(spent, orderCount)) return 'basic'
  return suggestLevel(spent)
}

export function formatVipUntilLabel(vipUntil?: string): string {
  if (!vipUntil) return 'бессрочно'
  const d = new Date(vipUntil)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

export function formatLevelLockLabel(period?: string): string {
  if (!period || !isLoyaltyPeriodCurrent(period)) return ''
  const [y, m] = period.split('-').map(Number)
  if (!y || !m) return ''
  const last = new Date(y, m, 0)
  return `до ${last.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`
}
