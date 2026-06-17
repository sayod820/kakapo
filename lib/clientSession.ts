'use client'

import { normalizePhone, type AdminClient } from './clientCrm'
import { crmToStoreUser, findMergedClientByPhone } from './clientProfileSync'

export type StoreUser = {
  name: string
  phone: string
  level: 'bronze' | 'silver' | 'gold' | 'platinum'
  bonus: number
  clientId?: string
  email?: string
  addr?: string
  vip?: boolean
  card?: string
  debt?: number
  debtLimit?: number
  blocked?: boolean
}

const USER_KEY = 'kakapo_store_user'
const PHONE_KEY = 'kakapo_client_phone'

export function phoneDigits(v: string) {
  return normalizePhone(v)
}

export function formatTjPhone(raw: string): string {
  const d = normalizePhone(raw)
  if (d.length !== 9) return raw.trim()
  return `+992 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`
}

export async function findStoreClientByPhone(phone: string): Promise<AdminClient | null> {
  return findMergedClientByPhone(phone)
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
  return crmToStoreUser(c)
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
