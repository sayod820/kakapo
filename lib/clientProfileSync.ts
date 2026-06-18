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
import { DEFAULT_ADMIN_CARDS, normalizeCard, cardHasDebtSection, type AdminCard } from './cardCrm'

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
  debtEnabled?: boolean
  loyaltyPeriod?: string
}

function loadLocalClients(): AdminClient[] {
  if (typeof window === 'undefined') return USE_API ? [] : DEFAULT_ADMIN_CLIENTS
  try {
    const raw = localStorage.getItem(CLIENTS_KEY)
    if (!raw) return USE_API ? [] : DEFAULT_ADMIN_CLIENTS
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.length) return USE_API ? [] : DEFAULT_ADMIN_CLIENTS
    return parsed.map(c => normalizeClient(c))
  } catch {
    return USE_API ? [] : DEFAULT_ADMIN_CLIENTS
  }
}

function loadLocalCards(): AdminCard[] {
  if (typeof window === 'undefined') return USE_API ? [] : DEFAULT_ADMIN_CARDS
  try {
    const raw = localStorage.getItem(CARDS_KEY)
    if (!raw) return USE_API ? [] : DEFAULT_ADMIN_CARDS
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.length) return USE_API ? [] : DEFAULT_ADMIN_CARDS
    return parsed.map(c => normalizeCard(c))
  } catch {
    return USE_API ? [] : DEFAULT_ADMIN_CARDS
  }
}

function mergeCrmClients(api: AdminClient[], local: AdminClient[]): AdminClient[] {
  const byId = new Map<string, AdminClient>()
  for (const c of api) byId.set(c.id, normalizeClient(c))
  for (const c of local) {
    const prev = byId.get(c.id)
    byId.set(c.id, normalizeClient(prev
      ? { ...prev, ...c, id: c.id, vip: !!(prev.vip || c.vip) }
      : c))
  }
  for (const c of local) {
    if (byId.has(c.id)) continue
    const byPhone = [...byId.values()].find(x => phonesMatch(x.phone, c.phone))
    if (byPhone) {
      byId.set(byPhone.id, normalizeClient({
        ...byPhone,
        ...c,
        id: byPhone.id,
        vip: !!(byPhone.vip || c.vip),
      }))
    } else {
      byId.set(c.id, normalizeClient(c))
    }
  }
  return Array.from(byId.values())
}

function mergeCrmCards(api: AdminCard[], local: AdminCard[]): AdminCard[] {
  const byNum = new Map<string, AdminCard>()
  for (const c of api) byNum.set(c.num, normalizeCard(c))
  for (const c of local) {
    const prev = byNum.get(c.num)
    byNum.set(c.num, normalizeCard(prev
      ? { ...prev, ...c, num: c.num, vip: !!(prev.vip || c.vip) }
      : c))
  }
  return Array.from(byNum.values())
}

function findLinkedCard(client: AdminClient, cards: AdminCard[]): AdminCard | null {
  if (client.card) {
    const byNum = cards.find(c => c.num === client.card)
    if (byNum && byNum.status !== 'unlinked') return normalizeCard(byNum)
  }
  if (client.id) {
    const byClientId = cards.find(c => c.clientId === client.id && c.status !== 'unlinked')
    if (byClientId) return normalizeCard(byClientId)
  }
  const byPhone = cards.find(
    c => c.status !== 'unlinked' && c.phone && phonesMatch(c.phone, client.phone),
  )
  return byPhone ? normalizeCard(byPhone) : null
}

function findBestCard(phone: string, cardNum: string | undefined, client: AdminClient | undefined, cards: AdminCard[]): AdminCard | null {
  const num = cardNum?.trim().toUpperCase()
  if (num) {
    const byNum = cards.find(c => c.num === num && c.status !== 'unlinked')
    if (byNum) return normalizeCard(byNum)
  }
  if (client) {
    const linked = findLinkedCard(client, cards)
    if (linked) return linked
  }
  const byPhone = cards.find(c => c.status !== 'unlinked' && c.phone && phonesMatch(c.phone, phone))
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
    vip: !!(card.vip || base.vip),
    debtEnabled: cardHasDebtSection({
      debtEnabled: card.debtEnabled ?? base.debtEnabled,
      debt: card.debt ?? base.debt,
      debtLimit: card.debtLimit ?? base.debtLimit,
    }),
    blocked: card.status === 'blocked' || base.blocked,
    loyaltyPeriod: card.loyaltyPeriod || base.loyaltyPeriod,
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
    debtEnabled: !!c.debtEnabled,
    blocked: !!c.blocked,
    loyaltyPeriod: c.loyaltyPeriod,
  }
}

function buildClientFromCard(card: AdminCard): AdminClient {
  return normalizeClient({
    id: card.clientId || `CARD-${card.num.replace(/\W/g, '')}`,
    name: card.client || 'Клиент',
    phone: card.phone,
    email: '',
    addr: '',
    card: card.num,
    level: (card.level || 'bronze') as ClientLevel,
    orders: 0,
    spent: 0,
    debt: card.debt,
    bonus: card.bonus,
    debtLimit: card.debtLimit,
    blocked: card.status === 'blocked',
    vip: !!card.vip,
    debtEnabled: !!card.debtEnabled,
  })
}

async function loadCrmData(): Promise<{ clients: AdminClient[]; cards: AdminCard[] }> {
  const localClients = loadLocalClients()
  const localCards = loadLocalCards()
  if (USE_API) {
    try {
      const [clients, cards] = await Promise.all([api.getClients(), api.getCards()])
      return {
        clients: mergeCrmClients(clients.map(c => normalizeClient(c)), localClients),
        cards: mergeCrmCards(cards.map(c => normalizeCard(c)), localCards),
      }
    } catch { /* local fallback */ }
  }
  return { clients: localClients, cards: localCards }
}

export async function findMergedClientByPhone(phone: string, cardNum?: string): Promise<AdminClient | null> {
  const { clients, cards } = await loadCrmData()
  const client = clients.find(c => phonesMatch(c.phone, phone))
  const card = findBestCard(phone, cardNum, client, cards)
  if (client) return mergeClientWithCard(client, card)
  if (card) return mergeClientWithCard(buildClientFromCard(card), card)
  return null
}

export async function findMergedClientByCard(cardNum: string): Promise<AdminClient | null> {
  const num = cardNum.trim().toUpperCase()
  if (!num) return null
  const { clients, cards } = await loadCrmData()
  const card = cards.find(c => c.num === num && c.status !== 'unlinked')
  if (!card) return null
  const normalized = normalizeCard(card)
  const client = card.clientId
    ? clients.find(c => c.id === card.clientId)
    : clients.find(c => c.card === num || (card.phone && phonesMatch(c.phone, card.phone)))
  if (client) return mergeClientWithCard(client, normalized)
  return mergeClientWithCard(buildClientFromCard(normalized), normalized)
}

export async function fetchCrmStoreUser(phone: string, cardNum?: string): Promise<CrmStoreUser | null> {
  const merged = await findMergedClientByPhone(phone, cardNum)
  if (!merged) return null
  return crmToStoreUser(merged)
}

const SYNC_KEYS: (keyof CrmStoreUser)[] = [
  'name', 'phone', 'level', 'bonus', 'vip', 'card', 'debt', 'debtLimit', 'debtEnabled', 'blocked', 'email', 'addr', 'clientId', 'loyaltyPeriod',
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
