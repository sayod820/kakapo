import { currentLoyaltyPeriod } from './loyaltyBonus.js'

export function isLoyaltyPeriodCurrent(period, date = new Date()) {
  if (!period) return false
  return period === currentLoyaltyPeriod(date)
}

export function endOfLoyaltyPeriodIso(period = currentLoyaltyPeriod()) {
  const [y, m] = period.split('-').map(Number)
  if (!y || !m) return new Date().toISOString()
  return new Date(y, m, 0, 23, 59, 59, 999).toISOString()
}

export function inferLevelAssignMode(client, card) {
  const mode = client?.levelAssignMode || card?.levelAssignMode
  if (mode === 'auto' || mode === 'manual') return mode
  const lock = client?.levelLockedPeriod || card?.levelLockedPeriod
  if (lock && isLoyaltyPeriodCurrent(lock)) return 'manual'
  return 'auto'
}

function cardLevelToBasic(raw) {
  return raw === '' || raw == null || raw === 'basic' ? 'basic' : raw
}

export function loyaltyLockRecord(client, card) {
  const mode = inferLevelAssignMode(client, card)
  let level = 'basic'
  if (card?.levelAssignMode === 'manual') {
    level = cardLevelToBasic(card.level)
  } else if (client?.levelAssignMode === 'manual') {
    level = cardLevelToBasic(client.level ?? card?.level)
  } else {
    level = cardLevelToBasic(client?.level ?? card?.level)
  }
  return {
    levelAssignMode: mode,
    levelValidUntil: client?.levelValidUntil || card?.levelValidUntil,
    levelLockedPeriod: client?.levelLockedPeriod || card?.levelLockedPeriod,
    level: level === '' ? 'basic' : level,
    vip: !!client?.vip,
    vipUntil: client?.vipUntil || card?.vipUntil,
  }
}

export function vipUntilAfterDays(days, from = new Date()) {
  const d = new Date(from)
  d.setDate(d.getDate() + Math.max(1, days))
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

export const AUTO_LEVEL_DEFAULT_TERM_DAYS = 30

export function isLevelLocked(record, now = Date.now()) {
  if (record?.levelAssignMode === 'auto') return false
  const lvl = record?.level
  const isBasicLvl = !lvl || lvl === 'basic' || lvl === ''
  if (record?.levelAssignMode === 'manual' && isBasicLvl) return true
  if (isBasicLvl) return false
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

export function isAutoLevelActive(record, now = Date.now()) {
  if (record?.levelAssignMode !== 'auto') return false
  if (!record.levelValidUntil) return true
  const until = new Date(record.levelValidUntil).getTime()
  if (Number.isNaN(until)) return true
  return now <= until
}

export function clearLevelLock(client, card) {
  if (client) {
    client.levelLockedPeriod = undefined
    client.levelValidUntil = undefined
  }
  if (card) {
    card.levelLockedPeriod = undefined
    card.levelValidUntil = undefined
  }
}

/** Для старых записей без levelAssignMode */
export function normalizeLevelAssignMode(row) {
  if (row.levelAssignMode === 'auto' || row.levelAssignMode === 'manual') return row.levelAssignMode
  if (row.levelLockedPeriod && isLoyaltyPeriodCurrent(row.levelLockedPeriod)) return 'manual'
  return 'auto'
}
