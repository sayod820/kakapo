'use client'

import { api } from './api'
import { USE_API } from './config'
import {
  DEFAULT_ADMIN_CLIENTS,
  normalizeClient,
  phonesMatch,
  pickClientDisplayName,
  isClientPurged,
  type AdminClient,
  type ClientLevel,
} from './clientCrm'
import { DEFAULT_ADMIN_CARDS, normalizeCard, cardNumsMatch, resolveDebtEnabled, memberSinceDate, type AdminCard } from './cardCrm'
import { isPhoneDeleted, unmarkPhoneDeleted } from './clientTombstones'
import { isClientInRecovery } from './clientRecovery'

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
  levelLockedPeriod?: string
  vipUntil?: string
  bonusEligibleFrom?: string
  accountGeneration?: number
  recoveryExpiresAt?: string
  memberSince?: string
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

function findLinkedCard(client: AdminClient, cards: AdminCard[]): AdminCard | null {
  if (client.card) {
    const byNum = cards.find(c => cardNumsMatch(c.num, client.card))
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
  if (isPhoneDeleted(phone)) return null
  const num = cardNum?.trim().toUpperCase()
  if (num) {
    const byNum = cards.find(c => cardNumsMatch(c.num, num) && c.status !== 'unlinked')
    if (byNum) {
      if (byNum.phone && isPhoneDeleted(byNum.phone)) return null
      return normalizeCard(byNum)
    }
  }
  if (client) {
    const linked = findLinkedCard(client, cards)
    if (linked) return linked
  }
  const byPhone = cards.find(c => c.status !== 'unlinked' && c.phone && phonesMatch(c.phone, phone))
  if (byPhone && isPhoneDeleted(byPhone.phone)) return null
  return byPhone ? normalizeCard(byPhone) : null
}

/** Карта — источник правды для лояльности и долга */
export function mergeClientWithCard(client: AdminClient, card?: AdminCard | null): AdminClient {
  const base = normalizeClient(client)
  if (!card || card.status === 'unlinked') return base
  const level = (card.level || base.level) as ClientLevel
  const vip = !!(card.vip || base.vip)
  const debtEnabled = resolveDebtEnabled(card, base)
  return normalizeClient({
    ...base,
    card: card.num,
    name: pickClientDisplayName(base.name, card.client),
    phone: base.phone || card.phone,
    level,
    bonus: card.bonus ?? base.bonus,
    debt: card.debt ?? base.debt,
    debtLimit: Math.max(0, Number(card.debtLimit ?? base.debtLimit) || 0),
    vip,
    debtEnabled,
    blocked: card.status === 'blocked' || base.blocked,
    loyaltyPeriod: card.loyaltyPeriod || base.loyaltyPeriod,
    levelLockedPeriod: card.levelLockedPeriod || base.levelLockedPeriod,
    vipUntil: card.vipUntil || base.vipUntil,
    bonusEligibleFrom: card.bonusEligibleFrom || base.bonusEligibleFrom,
    accountGeneration: card.accountGeneration || base.accountGeneration,
    recoveryExpiresAt: card.recoveryExpiresAt || base.recoveryExpiresAt,
  })
}

export function crmToStoreUser(c: AdminClient, card?: AdminCard | null): CrmStoreUser {
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
    debtLimit: Math.max(0, Number(c.debtLimit) || 0),
    debtEnabled: !!c.debtEnabled,
    blocked: !!c.blocked,
    loyaltyPeriod: c.loyaltyPeriod,
    levelLockedPeriod: c.levelLockedPeriod,
    vipUntil: c.vipUntil,
    bonusEligibleFrom: c.bonusEligibleFrom,
    accountGeneration: c.accountGeneration,
    recoveryExpiresAt: c.recoveryExpiresAt,
    memberSince: memberSinceDate(c, card),
  }
}

function buildClientFromCard(card: AdminCard): AdminClient {
  return normalizeClient({
    id: card.clientId || `CARD-${card.num.replace(/\W/g, '')}`,
    name: pickClientDisplayName(card.client),
    phone: card.phone,
    email: '',
    addr: '',
    card: card.num,
    level: (card.level || 'basic') as ClientLevel,
    orders: 0,
    spent: 0,
    debt: card.debt,
    bonus: card.bonus,
    debtLimit: card.debtLimit,
    blocked: card.status === 'blocked',
    vip: !!card.vip,
    debtEnabled: !!card.debtEnabled,
    loyaltyPeriod: card.loyaltyPeriod,
    bonusEligibleFrom: card.bonusEligibleFrom,
  })
}

async function loadCrmData(): Promise<{ clients: AdminClient[]; cards: AdminCard[] }> {
  if (USE_API) {
    try {
      const [clients, cards] = await Promise.all([api.getClients(), api.getCards()])
      return {
        clients: clients.map(c => normalizeClient(c)).filter(c => !isClientPurged(c)),
        cards: cards.map(c => normalizeCard(c)),
      }
    } catch {
      return { clients: [], cards: [] }
    }
  }
  const localClients = loadLocalClients()
  const localCards = loadLocalCards()
  return { clients: localClients, cards: localCards }
}

export async function findMergedClientByPhone(phone: string, cardNum?: string): Promise<AdminClient | null> {
  const { clients, cards } = await loadCrmData()
  const eligible = clients.filter(c => !isClientPurged(c))
  const phoneMatches = eligible.filter(c => phonesMatch(c.phone, phone))
  if (phoneMatches.length) {
    unmarkPhoneDeleted(phone)
  } else if (isPhoneDeleted(phone)) {
    return null
  }
  const client = phoneMatches.find(c => c.card && cardNum && cardNumsMatch(c.card, cardNum))
    || phoneMatches.find(c => c.card)
    || phoneMatches[0]
  const card = findBestCard(phone, cardNum, client, cards)
  if (client) return mergeClientWithCard(client, card)
  if (card) return mergeClientWithCard(buildClientFromCard(card), card)
  return null
}

export async function findMergedClientByCard(cardNum: string): Promise<AdminClient | null> {
  const num = cardNum.trim().toUpperCase()
  if (!num) return null
  const { clients, cards } = await loadCrmData()
  const card = cards.find(c => cardNumsMatch(c.num, num) && c.status !== 'unlinked')
  if (!card) return null
  const normalized = normalizeCard(card)
  const client = card.clientId
    ? clients.find(c => c.id === card.clientId)
    : clients.find(c => cardNumsMatch(c.card, num) || (card.phone && phonesMatch(c.phone, card.phone)))
  if (client) return mergeClientWithCard(client, normalized)
  return mergeClientWithCard(buildClientFromCard(normalized), normalized)
}

export async function fetchCrmStoreUser(phone: string, cardNum?: string): Promise<CrmStoreUser | null> {
  if (isPhoneDeleted(phone)) return null
  const merged = await findMergedClientByPhone(phone, cardNum)
  if (!merged || isClientPurged(merged) || isClientInRecovery(merged)) return null
  const { cards } = await loadCrmData()
  const card = findLinkedCard(merged, cards)
  return crmToStoreUser(merged, card)
}

/** Только сервер: есть ли активный аккаунт (для автовыхода после удаления в админке) */
export async function isStoreAccountActiveOnServer(phone: string): Promise<boolean> {
  if (!phone?.trim() || isPhoneDeleted(phone)) return false
  if (!USE_API) {
    const merged = await findMergedClientByPhone(phone)
    return !!merged && !isClientPurged(merged) && !isClientInRecovery(merged)
  }
  try {
    const [apiClients, apiCards] = await Promise.all([api.getClients(), api.getCards()])
    const client = apiClients
      .map(c => normalizeClient(c))
      .find(c => phonesMatch(c.phone, phone) && !isClientPurged(c) && !isClientInRecovery(c))
    if (client) return true
    const card = apiCards
      .map(c => normalizeCard(c))
      .find(c => c.status !== 'unlinked' && c.phone && phonesMatch(c.phone, phone))
    return !!card
  } catch {
    // Сеть / таймаут API — не считаем аккаунт удалённым
    return true
  }
}

const SYNC_KEYS: (keyof CrmStoreUser)[] = [
  'name', 'phone', 'level', 'bonus', 'vip', 'card', 'debt', 'debtLimit', 'debtEnabled', 'blocked', 'email', 'addr', 'clientId', 'loyaltyPeriod', 'levelLockedPeriod', 'vipUntil', 'bonusEligibleFrom', 'accountGeneration', 'recoveryExpiresAt', 'memberSince',
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
