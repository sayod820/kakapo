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
  email?: string
  addr?: string
}

const USER_KEY = 'kakapo_store_user'
const PHONE_KEY = 'kakapo_client_phone'
const CLIENTS_KEY = 'kakapo-clients'

export function phoneDigits(v: string) {
  return normalizePhone(v)
}

export function formatTjPhone(raw: string): string {
  const d = normalizePhone(raw)
  if (d.length !== 9) return raw.trim()
  return `+992 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`
}

function loadStoredClients(): AdminClient[] {
  if (typeof window === 'undefined') return DEFAULT_ADMIN_CLIENTS
  try {
    const raw = localStorage.getItem(CLIENTS_KEY)
    if (!raw) return DEFAULT_ADMIN_CLIENTS
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_ADMIN_CLIENTS
    return parsed as AdminClient[]
  } catch {
    return DEFAULT_ADMIN_CLIENTS
  }
}

export async function findStoreClientByPhone(phone: string): Promise<AdminClient | null> {
  if (USE_API) {
    try {
      const clients = await api.getClients()
      const match = clients.find(c => phonesMatch(c.phone, phone))
      if (match) return match
    } catch { /* local fallback */ }
  }
  return loadStoredClients().find(c => phonesMatch(c.phone, phone)) || null
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
      localStorage.removeItem(PHONE_KEY)
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
    email: c.email || '',
    addr: c.addr || '',
  }
}

export async function resolveStoreUserByPhone(phone: string, fallbackName?: string): Promise<StoreUser> {
  const match = await findStoreClientByPhone(phone)
  if (match) return storeUserFromClient(match)
  return {
    name: fallbackName || 'Клиент',
    phone: formatTjPhone(phone),
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
