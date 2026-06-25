'use client'

import { normalizePhone, type AdminClient } from './clientCrm'
import { crmToStoreUser, findMergedClientByPhone } from './clientProfileSync'

export type StoreUser = {
  name: string
  phone: string
  level: 'basic' | 'bronze' | 'silver' | 'gold' | 'platinum'
  bonus: number
  clientId?: string
  email?: string
  addr?: string
  vip?: boolean
  card?: string
  debt?: number
  debtLimit?: number
  blocked?: boolean
  debtEnabled?: boolean
  loyaltyPeriod?: string
  levelLockedPeriod?: string
  vipUntil?: string
  bonusEligibleFrom?: string
  accountGeneration?: number
  recoveryExpiresAt?: string
  memberSince?: string
}

const USER_KEY = 'kakapo_store_user'
const PHONE_KEY = 'kakapo_client_phone'

let sessionEpoch = 0

export function getSessionEpoch(): number {
  return sessionEpoch
}

export function bumpSessionEpoch(): number {
  sessionEpoch += 1
  return sessionEpoch
}

export function phoneDigits(v: string) {
  return normalizePhone(v)
}

export function formatTjPhone(raw: string): string {
  const d = normalizePhone(raw)
  if (d.length !== 9) return raw.trim()
  return `+992 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`
}

export async function findStoreClientByPhone(phone: string, cardNum?: string): Promise<AdminClient | null> {
  return findMergedClientByPhone(phone, cardNum)
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

export function isClientSessionActive(): boolean {
  return !!loadStoreUser()
}

export function clearClientSession() {
  if (typeof window === 'undefined') return
  bumpSessionEpoch()
  try {
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(PHONE_KEY)
  } catch { /* quota */ }
}

export function saveStoreUser(user: StoreUser | null) {
  if (typeof window === 'undefined') return
  try {
    if (!user) {
      clearClientSession()
    } else {
      const prev = loadStoreUser()
      const prevPhone = prev ? phoneDigits(prev.phone) : ''
      const nextPhone = phoneDigits(user.phone)
      localStorage.setItem(USER_KEY, JSON.stringify(user))
      localStorage.setItem(PHONE_KEY, user.phone.trim())
      if (prevPhone !== nextPhone) bumpSessionEpoch()
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
    level: 'basic',
    bonus: 0,
  }
}

export function getActiveClientPhone(user?: { phone?: string } | null): string {
  if (typeof window === 'undefined') return user?.phone?.trim() || ''
  if (user?.phone?.trim()) return user.phone.trim()
  const stored = loadStoreUser()
  return stored?.phone?.trim() || ''
}
