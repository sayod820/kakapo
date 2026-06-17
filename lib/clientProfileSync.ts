'use client'

import { api } from './api'
import { USE_API } from './config'
import {
  DEFAULT_ADMIN_CLIENTS,
  normalizeClient,
  phonesMatch,
  type AdminClient,
  type ClientLevel,
} from './clientCrm'
import { DEFAULT_ADMIN_CARDS, normalizeCard, type AdminCard } from './cardCrm'

const CLIENTS_KEY = 'kakapo-clients'
const CARDS_KEY = 'kakapo-cards'

export const CRM_SYNC_EVENT = 'kakapo-crm-sync'
export const CRM_SYNC_BC = 'kakapo-crm-sync'

export type CrmStoreUser = {
  name: string
  phone: string
  level: ClientLevel
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

function loadLocalClients(): AdminClient[] {
  if (typeof window === 'undefined') return DEFAULT_ADMIN_CLIENTS
  try {
    const raw = localStorage.getItem(CLIENTS_KEY)
    if (!raw) return DEFAULT_ADMIN_CLIENTS
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_ADMIN_CLIENTS
    return parsed.map(c => normalizeClient(c))
  } catch {
    return DEFAULT_ADMIN_CLIENTS
  }
}

function loadLocalCards(): AdminCard[] {
  if (typeof window === 'undefined') return DEFAULT_ADMIN_CARDS
  try {
    const raw = localStorage.getItem(CARDS_KEY)
    if (!raw) return DEFAULT_ADMIN_CARDS
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_ADMIN_CARDS
    return parsed.map(c => normalizeCard(c))
  } catch {
    return DEFAULT_ADMIN_CARDS
  }
}

function findLinkedCard(client: AdminClient, cards: AdminCard[]): AdminCard | null {
  if (client.card) {
    const byNum = cards.find(c => c.num === client.card)
    if (byNum && byNum.status !== 'unlinked') return normalizeCard(byNum)
  }
  const byPhone = cards.find(
    c => c.status === 'active' && c.phone && phonesMatch(c.phone, client.phone),
  )
  return byPhone ? normalizeCard(byPhone) : null
}

/** Карта — источник правды для лояльности и долга */
export function mergeClientWithCard(client: AdminClient, card?: AdminCard | null): AdminClient {
  const base = normalizeClient(client)
  if (!card || card.status === 'unlinked') return base
  const level = (card.level || base.level) as ClientLevel
  return normalizeClient({
    ...base,
    card: card.num,
    name: base.name || card.client,
    phone: base.phone || card.phone,
    level,
    bonus: card.bonus ?? base.bonus,
    debt: card.debt ?? base.debt,
    debtLimit: card.debtLimit ?? base.debtLimit,
    vip: !!(card.vip ?? base.vip),
    blocked: card.status === 'blocked' || base.blocked,
  })
}

export function crmToStoreUser(c: AdminClient): CrmStoreUser {
  return {
    name: c.name,
    phone: c.phone,
    level: c.level,
    bonus: c.bonus,
    clientId: c.id,
    email: c.email || '',
    addr: c.addr || '',
    vip: !!c.vip,
    card: c.card || '',
    debt: c.debt || 0,
    debtLimit: c.debtLimit || 0,
    blocked: !!c.blocked,
  }
}

export async function findMergedClientByPhone(phone: string): Promise<AdminClient | null> {
  if (USE_API) {
    try {
      const [clients, cards] = await Promise.all([api.getClients(), api.getCards()])
      const client = clients.find(c => phonesMatch(c.phone, phone))
      if (!client) return null
      const card = findLinkedCard(normalizeClient(client), cards.map(c => normalizeCard(c)))
      return mergeClientWithCard(normalizeClient(client), card)
    } catch { /* local fallback */ }
  }
  const clients = loadLocalClients()
  const cards = loadLocalCards()
  const client = clients.find(c => phonesMatch(c.phone, phone))
  if (!client) return null
  const card = findLinkedCard(client, cards)
  return mergeClientWithCard(client, card)
}

export async function fetchCrmStoreUser(phone: string): Promise<CrmStoreUser | null> {
  const merged = await findMergedClientByPhone(phone)
  if (!merged) return null
  return crmToStoreUser(merged)
}

const SYNC_KEYS: (keyof CrmStoreUser)[] = [
  'name', 'phone', 'level', 'bonus', 'vip', 'card', 'debt', 'debtLimit', 'blocked', 'email', 'addr', 'clientId',
]

export function crmStoreUsersEqual(a: CrmStoreUser | null | undefined, b: CrmStoreUser | null | undefined): boolean {
  if (!a || !b) return a === b
  return SYNC_KEYS.every(k => a[k] === b[k])
}

export function emitCrmSync() {
  if (typeof window === 'undefined') return
  try {
    new BroadcastChannel(CRM_SYNC_BC).postMessage({ type: 'refresh', at: Date.now() })
  } catch { /* unsupported */ }
  window.dispatchEvent(new CustomEvent(CRM_SYNC_EVENT))
}
