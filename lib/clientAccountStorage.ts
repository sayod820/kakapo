'use client'

import { getActiveClientPhone, loadStoreUser, phoneDigits } from './clientSession'

export const ACCOUNT_NS = {
  addresses: 'addresses',
  addressesUpdatedAt: 'addresses_updated_at',
  notifications: 'notifications',
  reviewRepliesSeen: 'review_replies_seen',
  cart: 'cart',
  cartMeta: 'cart_meta',
  cartUpdatedAt: 'cart_updated_at',
  wished: 'wished',
  wishedUpdatedAt: 'wished_updated_at',
  reviewsLocal: 'reviews_local',
  debtHistory: 'debt_history',
} as const

export type AccountNs = (typeof ACCOUNT_NS)[keyof typeof ACCOUNT_NS]

export function getAccountId(explicitPhone?: string): string {
  const phone = explicitPhone?.trim() || getActiveClientPhone(loadStoreUser())
  return phoneDigits(phone) || 'guest'
}

export function accountStorageKey(name: AccountNs | string, phone?: string): string {
  return `kakapo_acct_${getAccountId(phone)}_${name}`
}

export function loadAccountJson<T>(name: AccountNs | string, fallback: T, phone?: string): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(accountStorageKey(name, phone))
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function saveAccountJson(name: AccountNs | string, value: unknown, phone?: string) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(accountStorageKey(name, phone), JSON.stringify(value))
  } catch { /* quota */ }
}

export function removeAccountJson(name: AccountNs | string, phone?: string) {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(accountStorageKey(name, phone))
  } catch { /* ignore */ }
}

const BROADCAST_NOTIFS_KEY = 'kakapo_broadcast_notifs'

export function loadBroadcastNotifications<T>(): T[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(BROADCAST_NOTIFS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveBroadcastNotifications(list: unknown[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(BROADCAST_NOTIFS_KEY, JSON.stringify(list.slice(0, 50)))
  } catch { /* quota */ }
}

/** Однократный перенос старых общих ключей в аккаунт текущего клиента */
export function migrateLegacyClientData(phone?: string) {
  if (typeof window === 'undefined') return
  const id = getAccountId(phone)
  if (id === 'guest') return
  const flag = `kakapo_acct_${id}_migrated_v1`
  if (localStorage.getItem(flag)) return

  try {
    if (!loadAccountJson(ACCOUNT_NS.addresses, null, phone)) {
      const legacyAddr = localStorage.getItem('kakapo-client-addresses')
      if (legacyAddr) saveAccountJson(ACCOUNT_NS.addresses, JSON.parse(legacyAddr), phone)
    }

    if (!loadAccountJson(ACCOUNT_NS.notifications, null, phone)) {
      const legacyNotifs = localStorage.getItem('kakapo_client_notifs')
      if (legacyNotifs) {
        try {
          const all = JSON.parse(legacyNotifs) as Array<{ targetPhone?: string; broadcast?: boolean }>
          const mine = Array.isArray(all)
            ? all.filter(n => !n.broadcast && !!n.targetPhone && phoneDigits(n.targetPhone) === id)
            : []
          if (mine.length) saveAccountJson(ACCOUNT_NS.notifications, mine, phone)
        } catch { /* ignore */ }
        localStorage.removeItem('kakapo_client_notifs')
      }
    }

    if (!loadAccountJson(ACCOUNT_NS.reviewRepliesSeen, null, phone)) {
      const legacySeen = localStorage.getItem('kakapo_review_replies_seen')
      if (legacySeen) saveAccountJson(ACCOUNT_NS.reviewRepliesSeen, JSON.parse(legacySeen), phone)
    }
  } catch { /* ignore */ }

  localStorage.setItem(flag, '1')
}
