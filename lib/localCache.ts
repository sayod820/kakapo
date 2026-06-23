'use client'

import { USE_API } from './config'

/** Ключи operational-данных (не сессия пользователя). Tombstones удаления — отдельно. */
export const APP_DATA_LOCAL_KEYS = [
  'kakapo-clients',
  'kakapo-cards',
  'kakapo-couriers',
  'kakapo-assemblers',
  'kakapo-push',
  'kakapo-pricing',
  'kakapo-pickups',
  'kakapo_orders_v1',
  'kakapo-loyalty-status-config',
  'kakapo-bonus-synced-orders',
  'kakapo-product-photos',
  'kakapo_admin_gbs',
  'kakapo_admin_sms',
  'kakapo_admin_store',
  'kakapo-client-addresses',
  'kakapo_client_notifs',
] as const

export function persistAppDataLocally(): boolean {
  return !USE_API
}

/** При USE_API все операционные данные только с backend — не пишем в localStorage. */
export function isServerSourceOfTruth(): boolean {
  return USE_API
}

/** Очистить устаревший кэш — при USE_API источник только backend */
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
