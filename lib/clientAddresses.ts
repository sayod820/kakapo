'use client'

import {
  ACCOUNT_NS,
  loadAccountJson,
  saveAccountJson,
} from './clientAccountStorage'
import { getActiveClientPhone, loadStoreUser } from './clientSession'
import { USE_API } from './config'

/** @deprecated legacy global key — only for migration */
export const ADDRESSES_STORAGE_KEY = 'kakapo-client-addresses'

export type ClientSavedAddress = {
  id: number
  label: string
  street: string
  apt: string
  floor: string
  ent: string
  comment: string
  def: boolean
  lat?: number
  lng?: number
}

export function formatClientAddressLine(
  a: Pick<ClientSavedAddress, 'street' | 'apt' | 'floor' | 'ent'>,
): string {
  let s = a.street.trim()
  if (a.apt?.trim()) s += `, кв. ${a.apt.trim()}`
  if (a.floor?.trim()) s += `, этаж ${a.floor.trim()}`
  if (a.ent?.trim()) s += `, подъезд ${a.ent.trim()}`
  return s
}

/** Разбор строки адреса из CRM / регистрации */
export function parseClientAddressLine(line: string): Pick<ClientSavedAddress, 'street' | 'apt' | 'floor' | 'ent'> {
  let street = line.trim()
  let apt = ''
  let floor = ''
  let ent = ''
  const aptM = street.match(/,\s*кв\.\s*([^,]+)/i)
  if (aptM) {
    apt = aptM[1].trim()
    street = street.replace(aptM[0], '')
  }
  const floorM = street.match(/,\s*этаж\s*([^,]+)/i)
  if (floorM) {
    floor = floorM[1].trim()
    street = street.replace(floorM[0], '')
  }
  const entM = street.match(/,\s*подъезд\s*([^,]+)/i)
  if (entM) {
    ent = entM[1].trim()
    street = street.replace(entM[0], '')
  }
  street = street.replace(/,\s*,/g, ',').replace(/^,\s*|,\s*$/g, '').trim()
  return { street: street || line.trim(), apt, floor, ent }
}

function resolvePhone(phone?: string): string {
  return phone?.trim() || getActiveClientPhone(loadStoreUser())
}

export function loadClientAddresses(phone?: string): ClientSavedAddress[] {
  const list = loadAccountJson<ClientSavedAddress[]>(ACCOUNT_NS.addresses, [], phone)
  return Array.isArray(list) ? list : []
}

export function loadClientAddressesUpdatedAt(phone?: string): string {
  return loadAccountJson<string>(ACCOUNT_NS.addressesUpdatedAt, '', phone) || ''
}

/** Локальное сохранение без обращения к серверу — для слияния данных при синхронизации. */
export function saveClientAddressesLocal(
  list: ClientSavedAddress[],
  phone?: string,
  updatedAt?: string,
) {
  saveAccountJson(ACCOUNT_NS.addresses, list, phone)
  saveAccountJson(ACCOUNT_NS.addressesUpdatedAt, updatedAt || new Date().toISOString(), phone)
}

/** Сохранение адресов: локально + (при USE_API) отправка на сервер для синхронизации между устройствами. */
export function saveClientAddresses(list: ClientSavedAddress[], phone?: string) {
  const ts = new Date().toISOString()
  saveAccountJson(ACCOUNT_NS.addresses, list, phone)
  saveAccountJson(ACCOUNT_NS.addressesUpdatedAt, ts, phone)

  if (!USE_API || typeof window === 'undefined') return
  const clientId = loadStoreUser()?.clientId
  if (!clientId) return
  // fire-and-forget: не блокируем UI
  void import('./clientAddressSync')
    .then(m => m.saveRemoteAddresses(clientId, list, ts))
    .catch(() => { /* оставляем локальную копию, синхронизируем позже */ })
}

/** Адрес при регистрации — единственный и по умолчанию */
export function setRegistrationDefaultAddress(data: {
  street: string
  apt?: string
  floor?: string
  ent?: string
  lat: number
  lng: number
  phone?: string
}): ClientSavedAddress {
  const entry: ClientSavedAddress = {
    id: Date.now(),
    label: '🏠 Дом',
    street: data.street.trim(),
    apt: data.apt?.trim() || '',
    floor: data.floor?.trim() || '',
    ent: data.ent?.trim() || '',
    comment: '',
    def: true,
    lat: data.lat,
    lng: data.lng,
  }
  saveClientAddresses([entry], data.phone || resolvePhone())
  return entry
}

export function getDefaultClientAddress(phone?: string): ClientSavedAddress | null {
  const list = loadClientAddresses(phone)
  return list.find(a => a.def) || list[0] || null
}

/** Если локальных адресов нет — импорт из CRM (addr) + геокод для точки на карте */
export async function ensureClientDefaultAddress(
  phone: string,
  crmAddr?: string,
): Promise<ClientSavedAddress | null> {
  const p = phone?.trim()
  if (!p) return null
  const existing = loadClientAddresses(p)
  if (existing.length) return existing.find(a => a.def) || existing[0]

  const line = crmAddr?.trim()
  if (!line) return null

  const parsed = parseClientAddressLine(line)
  let lat: number | undefined
  let lng: number | undefined
  try {
    const { forwardGeocode } = await import('./geocode')
    const query = parsed.street || line
    const results = await forwardGeocode(query)
    if (results[0]) {
      lat = results[0].lat
      lng = results[0].lng
    }
  } catch { /* offline / geocode fail */ }

  const entry: ClientSavedAddress = {
    id: Date.now(),
    label: '🏠 Дом',
    street: parsed.street || line,
    apt: parsed.apt || '',
    floor: parsed.floor || '',
    ent: parsed.ent || '',
    comment: '',
    def: true,
    lat,
    lng,
  }
  saveClientAddresses([entry], p)
  return entry
}
