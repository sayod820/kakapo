'use client'

import type { ClientLevel } from './clientCrm'
import { hasEarnedBronze, suggestLevel } from './clientCrm'
import { currentLoyaltyPeriod, isLoyaltyPeriodCurrent } from './loyaltyPeriod'
import { getVipRules } from './clientLoyalty'

export type LevelAssignMode = 'auto' | 'manual'

export type LoyaltyLockFields = {
  levelAssignMode?: LevelAssignMode
  levelValidUntil?: string | null
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

export function isLevelLocked(record?: LoyaltyLockFields | null, now = Date.now()): boolean {
  if (record?.levelAssignMode === 'auto') return false
  const lvl = record?.level
  if (!lvl || lvl === 'basic') return false
  if (record?.levelValidUntil) {
    const until = new Date(record.levelValidUntil).getTime()
    if (!Number.isNaN(until)) return now <= until
  }
  if (record?.levelLockedPeriod && isLoyaltyPeriodCurrent(record.levelLockedPeriod)) return true
  if (record?.levelAssignMode === 'manual' && !record?.levelValidUntil && !record?.levelLockedPeriod) {
    return true
  }
  return false
}

export function isAutoLevelActive(record?: LoyaltyLockFields | null, now = Date.now()): boolean {
  if (record?.levelAssignMode !== 'auto') return false
  if (!record.levelValidUntil) return true
  const until = new Date(record.levelValidUntil).getTime()
  if (Number.isNaN(until)) return true
  return now <= until
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
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}

export function isoToDatetimeLocal(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function datetimeLocalToIso(local: string): string | undefined {
  if (!local) return undefined
  const d = new Date(local)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString()
}

export function addDurationToNow(days: number, hours: number, minutes: number, from = new Date()): string {
  const d = new Date(from)
  d.setDate(d.getDate() + Math.max(0, days))
  d.setHours(d.getHours() + Math.max(0, hours))
  d.setMinutes(d.getMinutes() + Math.max(0, minutes))
  d.setSeconds(59, 999)
  return d.toISOString()
}

export type LevelDurationParts = { days: number; hours: number; minutes: number; permanent: boolean }

export function inferLevelDuration(
  mode: LevelAssignMode,
  level?: ClientLevel | '',
  levelValidUntil?: string | null,
  levelLockedPeriod?: string,
): LevelDurationParts {
  if (mode === 'manual' && (!level || level === 'basic')) {
    return { days: 0, hours: 0, minutes: 0, permanent: true }
  }
  if (!levelValidUntil) {
    const hasMonthLock = !!(levelLockedPeriod && isLoyaltyPeriodCurrent(levelLockedPeriod))
    if (hasMonthLock) {
      return { days: 0, hours: 0, minutes: 0, permanent: false }
    }
    return { days: 0, hours: 0, minutes: 0, permanent: true }
  }
  const until = new Date(levelValidUntil).getTime()
  if (Number.isNaN(until)) return { days: 0, hours: 0, minutes: 0, permanent: false }
  const endMonthMs = new Date(endOfLoyaltyPeriodIso()).getTime()
  if (Math.abs(until - endMonthMs) < 60000) {
    return { days: 0, hours: 0, minutes: 0, permanent: false }
  }
  const now = Date.now()
  if (until <= now) return { days: 0, hours: 0, minutes: 0, permanent: false }
  let ms = until - now
  const days = Math.floor(ms / 86400000)
  ms -= days * 86400000
  const hours = Math.floor(ms / 3600000)
  ms -= hours * 3600000
  const minutes = Math.ceil(ms / 60000)
  return { days, hours, minutes, permanent: false }
}

export function resolveLevelLockFromUntil(
  mode: LevelAssignMode,
  level: ClientLevel,
  untilIso?: string | null,
  permanent = false,
): { levelAssignMode: LevelAssignMode; levelValidUntil?: string; levelLockedPeriod?: string } {
  if (mode === 'auto') {
    if (permanent || !untilIso) {
      return { levelAssignMode: 'auto', levelValidUntil: undefined, levelLockedPeriod: undefined }
    }
    return { levelAssignMode: 'auto', levelValidUntil: untilIso, levelLockedPeriod: undefined }
  }
  if (level === 'basic' || permanent || !untilIso) {
    return { levelAssignMode: 'manual', levelValidUntil: undefined, levelLockedPeriod: undefined }
  }
  const endMonth = endOfLoyaltyPeriodIso()
  const isEndMonth = Math.abs(new Date(untilIso).getTime() - new Date(endMonth).getTime()) < 60000
  if (isEndMonth) {
    return {
      levelAssignMode: 'manual',
      levelValidUntil: untilIso,
      levelLockedPeriod: currentLoyaltyPeriod(),
    }
  }
  return { levelAssignMode: 'manual', levelValidUntil: untilIso, levelLockedPeriod: undefined }
}

export function formatLevelLockLabel(period?: string): string {
  if (!period || !isLoyaltyPeriodCurrent(period)) return ''
  const [y, m] = period.split('-').map(Number)
  if (!y || !m) return ''
  const last = new Date(y, m, 0)
  return `до ${last.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`
}

/** -1 = постоянный VIP */
export const VIP_PERMANENT_DAYS = -1

export function vipUntilForTermDays(days: number): string | null | undefined {
  if (days === VIP_PERMANENT_DAYS) return null
  if (days <= 0) return endOfLoyaltyPeriodIso()
  return vipUntilAfterDays(days)
}

export function inferVipTermDays(vip?: boolean, vipUntil?: string): number {
  if (!vip) return 0
  if (!vipUntil) return VIP_PERMANENT_DAYS
  return 0
}

export function termDaysToUntil(days: number): string | null | undefined {
  return vipUntilForTermDays(days)
}

export function inferLevelAssignMode(
  card?: { levelAssignMode?: LevelAssignMode; levelLockedPeriod?: string },
  client?: { levelAssignMode?: LevelAssignMode; levelLockedPeriod?: string },
): LevelAssignMode {
  const mode = card?.levelAssignMode || client?.levelAssignMode
  if (mode === 'auto' || mode === 'manual') return mode
  const lock = card?.levelLockedPeriod || client?.levelLockedPeriod
  if (lock && isLoyaltyPeriodCurrent(lock)) return 'manual'
  return 'auto'
}

export function inferLevelTermDays(
  mode: LevelAssignMode,
  level?: ClientLevel | '',
  levelValidUntil?: string | null,
  levelLockedPeriod?: string,
): number {
  if (!level || level === 'basic') return VIP_PERMANENT_DAYS
  if (!levelValidUntil && !levelLockedPeriod) {
    return mode === 'manual' ? VIP_PERMANENT_DAYS : 0
  }
  if (!levelValidUntil && levelLockedPeriod && isLoyaltyPeriodCurrent(levelLockedPeriod)) return 0
  if (!levelValidUntil) return VIP_PERMANENT_DAYS
  const untilMs = new Date(levelValidUntil).getTime()
  if (Number.isNaN(untilMs)) return 0
  const endMonthMs = new Date(endOfLoyaltyPeriodIso()).getTime()
  if (Math.abs(untilMs - endMonthMs) < 3 * 86400000) return 0
  const days = Math.round((untilMs - Date.now()) / 86400000)
  if (days <= 8) return 7
  if (days <= 35) return 30
  if (days <= 95) return 90
  return VIP_PERMANENT_DAYS
}

export function resolveLevelLockFromTerm(
  mode: LevelAssignMode,
  level: ClientLevel,
  termDays: number,
): { levelAssignMode: LevelAssignMode; levelValidUntil?: string; levelLockedPeriod?: string } {
  if (mode === 'auto') {
    const until = termDaysToUntil(termDays)
    return {
      levelAssignMode: 'auto',
      levelValidUntil: until === null ? undefined : until,
      levelLockedPeriod: undefined,
    }
  }
  if (level === 'basic') {
    return { levelAssignMode: 'manual', levelValidUntil: undefined, levelLockedPeriod: undefined }
  }
  const until = termDaysToUntil(termDays)
  if (until === null) {
    return { levelAssignMode: 'manual', levelValidUntil: undefined, levelLockedPeriod: undefined }
  }
  if (termDays <= 0) {
    return {
      levelAssignMode: 'manual',
      levelValidUntil: until,
      levelLockedPeriod: currentLoyaltyPeriod(),
    }
  }
  return {
    levelAssignMode: 'manual',
    levelValidUntil: until,
    levelLockedPeriod: undefined,
  }
}

export function formatAdminLevelExpiry(record: LoyaltyLockFields): string {
  const lvl = record.level
  if (!lvl || lvl === 'basic') return 'Постоянно'
  if (record.levelAssignMode === 'auto') {
    if (!isAutoLevelActive(record)) return 'авто истекло'
    if (!record.levelValidUntil) return 'авто · постоянно'
    return `авто · до ${formatVipUntilLabel(record.levelValidUntil)}`
  }
  if (isLevelLocked(record)) {
    if (!record.levelValidUntil && !record.levelLockedPeriod) return 'ручной · постоянно'
    if (record.levelValidUntil) return `ручной · до ${formatVipUntilLabel(record.levelValidUntil)}`
    const label = formatLevelLockLabel(record.levelLockedPeriod)
    return label ? `ручной · ${label}` : 'ручной · до конца месяца'
  }
  return 'ручной · без срока'
}

export function formatAdminVipExpiry(record: LoyaltyLockFields): string {
  if (!record.vip) return '—'
  if (!record.vipUntil) return 'Постоянно'
  if (!isForcedVipActive(record)) return `истёк ${formatVipUntilLabel(record.vipUntil)}`
  return `до ${formatVipUntilLabel(record.vipUntil)}`
}
