'use client'

import {
  ACCOUNT_NS,
  loadAccountJson,
  saveAccountJson,
} from './clientAccountStorage'
import { getActiveClientPhone, loadStoreUser } from './clientSession'

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

function resolvePhone(phone?: string): string {
  return phone?.trim() || getActiveClientPhone(loadStoreUser())
}

export function loadClientAddresses(phone?: string): ClientSavedAddress[] {
  const list = loadAccountJson<ClientSavedAddress[]>(ACCOUNT_NS.addresses, [], phone)
  return Array.isArray(list) ? list : []
}

export function saveClientAddresses(list: ClientSavedAddress[], phone?: string) {
  saveAccountJson(ACCOUNT_NS.addresses, list, phone)
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
