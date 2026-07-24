'use client'

import { useEffect, useState } from 'react'
import { USE_API } from './config'
import { api } from './api'

/** Контакты поддержки КАКАПО (погашение долга и помощь) */

export type SupportContacts = {
  phone: string
  phoneTel: string
  phone2: string
  phone2Tel: string
  telegram: string
  telegramLabel: string
  hours: string
  name: string
  city: string
  address: string
  email: string
}

export type StoreContactSettings = {
  name?: string
  city?: string
  address?: string
  phone1?: string
  phone2?: string
  email?: string
  telegram?: string
  hours?: string
}

const STORAGE_KEY = 'kakapo_admin_store'
export const SUPPORT_CONTACTS_EVENT = 'kakapo-support-contacts'

const DEFAULT_STORE: Required<StoreContactSettings> = {
  name: 'КАКАПО',
  city: 'г. Яван, Таджикистан',
  address: 'ул. Ленина, 42',
  phone1: '+992 118 55-97-97',
  phone2: '+992 553 55-98-98',
  email: 'kakapo.tj@gmail.com',
  telegram: '@kakapo_tj',
  hours: '08:00 – 23:00',
}

let memoryStore: StoreContactSettings | null = null
let loadPromise: Promise<SupportContacts> | null = null

export function toTelHref(phone: string): string {
  const digits = String(phone || '').replace(/[^\d+]/g, '')
  return digits ? `tel:${digits}` : 'tel:'
}

export function toTelegramHref(tg: string): string {
  const raw = String(tg || '').trim()
  if (!raw) return 'https://t.me/kakapo_tj'
  if (/^https?:\/\//i.test(raw)) return raw
  const handle = raw.replace(/^@/, '').replace(/^t\.me\//i, '')
  return `https://t.me/${handle || 'kakapo_tj'}`
}

export function toTelegramLabel(tg: string): string {
  const raw = String(tg || '').trim()
  if (!raw) return '@kakapo_tj'
  if (/^https?:\/\//i.test(raw)) {
    const m = raw.match(/t\.me\/([^/?#]+)/i)
    return m ? `@${m[1]}` : raw
  }
  return raw.startsWith('@') ? raw : `@${raw}`
}

export function storeToSupport(store?: StoreContactSettings | null): SupportContacts {
  const s = { ...DEFAULT_STORE, ...(store || {}) }
  const phone = String(s.phone1 || DEFAULT_STORE.phone1).trim() || DEFAULT_STORE.phone1
  const phone2 = String(s.phone2 || DEFAULT_STORE.phone2).trim() || DEFAULT_STORE.phone2
  const telegram = String(s.telegram || DEFAULT_STORE.telegram).trim() || DEFAULT_STORE.telegram
  return {
    phone,
    phoneTel: toTelHref(phone),
    phone2,
    phone2Tel: toTelHref(phone2),
    telegram: toTelegramHref(telegram),
    telegramLabel: toTelegramLabel(telegram),
    hours: String(s.hours || DEFAULT_STORE.hours).trim() || DEFAULT_STORE.hours,
    name: String(s.name || DEFAULT_STORE.name).trim() || DEFAULT_STORE.name,
    city: String(s.city || DEFAULT_STORE.city).trim() || DEFAULT_STORE.city,
    address: String(s.address || DEFAULT_STORE.address).trim() || DEFAULT_STORE.address,
    email: String(s.email || DEFAULT_STORE.email).trim() || DEFAULT_STORE.email,
  }
}

function readLocalStore(): StoreContactSettings | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as StoreContactSettings
  } catch {
    return null
  }
}

function emit() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(SUPPORT_CONTACTS_EVENT))
}

export function applyStoreContactSettings(store: StoreContactSettings | null | undefined) {
  memoryStore = store ? { ...DEFAULT_STORE, ...store } : { ...DEFAULT_STORE }
  if (!USE_API && typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryStore))
    } catch { /* private mode */ }
  }
  emit()
  return getSupportContacts()
}

/** Актуальные контакты (из API/памяти или дефолт) */
export function getSupportContacts(): SupportContacts {
  if (memoryStore) return storeToSupport(memoryStore)
  if (!USE_API) return storeToSupport(readLocalStore())
  return storeToSupport(DEFAULT_STORE)
}

/** @deprecated используйте getSupportContacts() — оставлено для совместимости */
export const KAKAPO_SUPPORT = storeToSupport(DEFAULT_STORE)

export function subscribeSupportContacts(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => cb()
  window.addEventListener(SUPPORT_CONTACTS_EVENT, handler)
  return () => window.removeEventListener(SUPPORT_CONTACTS_EVENT, handler)
}

export async function ensureSupportContactsLoaded(): Promise<SupportContacts> {
  if (memoryStore) return getSupportContacts()
  if (!USE_API) {
    memoryStore = { ...DEFAULT_STORE, ...(readLocalStore() || {}) }
    emit()
    return getSupportContacts()
  }
  if (!loadPromise) {
    loadPromise = api.getStoreSettings()
      .then(remote => {
        memoryStore = { ...DEFAULT_STORE, ...(remote || {}) }
        emit()
        return getSupportContacts()
      })
      .catch(() => {
        memoryStore = { ...DEFAULT_STORE }
        emit()
        return getSupportContacts()
      })
      .finally(() => {
        loadPromise = null
      })
  }
  return loadPromise
}

/** React-хук: актуальные контакты из настроек админки */
export function useSupportContacts(): SupportContacts {
  const [s, setS] = useState(getSupportContacts)
  useEffect(() => {
    void ensureSupportContactsLoaded().then(setS)
    return subscribeSupportContacts(() => setS(getSupportContacts()))
  }, [])
  return s
}
