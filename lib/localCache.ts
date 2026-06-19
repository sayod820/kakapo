'use client'

import { USE_API } from './config'

/** Ключи operational-данных (не сессия пользователя) */
export const APP_DATA_LOCAL_KEYS = [
  'kakapo-clients',
  'kakapo-cards',
  'kakapo-deleted-phones',
  'kakapo-couriers',
  'kakapo-assemblers',
  'kakapo-push',
  'kakapo-pricing',
  'kakapo-pickups',
  'kakapo_orders_v1',
] as const

export function persistAppDataLocally(): boolean {
  return !USE_API
}

/** Очистить устаревший кэш — при USE_API источник только Render */
export function clearAppDataLocalCache() {
  if (!USE_API || typeof window === 'undefined') return
  for (const key of APP_DATA_LOCAL_KEYS) {
    try {
      localStorage.removeItem(key)
    } catch { /* quota */ }
  }
}

let clearedOnBoot = false

export function clearAppDataLocalCacheOnce() {
  if (clearedOnBoot) return
  clearedOnBoot = true
  clearAppDataLocalCache()
}
