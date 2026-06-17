'use client'

import { api } from './api'
import { USE_API } from './config'
import { normalizePhone, phonesMatch, DEFAULT_ADMIN_CLIENTS, type AdminClient } from './clientCrm'

export type StoreUser = {
  name: string
  phone: string
  level: 'bronze' | 'silver' | 'gold' | 'platinum'
  bonus: number
  clientId?: string
}

const USER_KEY = 'kakapo_store_user'
const PHONE_KEY = 'kakapo_client_phone'

export function phoneDigits(v: string) {
  return normalizePhone(v)
}

export function loadStoreUser(): StoreUser | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoreUser
    if (!parsed?.phone || !parsed?.name) return null
    return parsed
  } catch {
    return null
  }
}

export function saveStoreUser(user: StoreUser | null) {
  if (typeof window === 'undefined') return
  try {
    if (!user) {
      localStorage.removeItem(USER_KEY)
    } else {
      localStorage.setItem(USER_KEY, JSON.stringify(user))
      localStorage.setItem(PHONE_KEY, user.phone.trim())
    }
  } catch { /* quota */ }
}

export function storeUserFromClient(c: AdminClient): StoreUser {
  return {
    name: c.name,
    phone: c.phone,
    level: c.level,
    bonus: c.bonus,
    clientId: c.id,
  }
}

export async function resolveStoreUserByPhone(phone: string, fallbackName?: string): Promise<StoreUser> {
  if (USE_API) {
    try {
      const clients = await api.getClients()
      const match = clients.find(c => phonesMatch(c.phone, phone))
      if (match) return storeUserFromClient(match)
    } catch { /* fallback below */ }
  } else {
    const match = DEFAULT_ADMIN_CLIENTS.find(c => phonesMatch(c.phone, phone))
    if (match) return storeUserFromClient(match)
  }
  return {
    name: fallbackName || 'Клиент',
    phone,
    level: 'bronze',
    bonus: 0,
  }
}

export function getActiveClientPhone(user?: { phone?: string } | null): string {
  if (typeof window === 'undefined') return user?.phone?.trim() || ''
  try {
    return user?.phone?.trim() || loadStoreUser()?.phone || localStorage.getItem(PHONE_KEY) || ''
  } catch {
    return user?.phone?.trim() || loadStoreUser()?.phone || ''
  }
}
