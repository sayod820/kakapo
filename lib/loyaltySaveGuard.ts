'use client'

import { cardNumsMatch, canonicalCardNum, type AdminCard } from './cardCrm'
import type { AdminClient, ClientLevel } from './clientCrm'
import { normalizeLoyaltyLevel } from './loyaltyAdminLock'

const TTL_MS = 180_000
const MANUAL_STORE_KEY = 'kakapo-manual-loyalty-v1'

const cardSavedAt = new Map<string, number>()
const clientSavedAt = new Map<string, number>()

export type ManualLoyaltySnapshot = {
  cardNum: string
  clientId?: string
  level: ClientLevel
  levelAssignMode: 'manual' | 'auto'
  levelValidUntil?: string | null
  levelLockedPeriod?: string | null
  vip?: boolean
  debtEnabled?: boolean
  debtLimit?: number
  bonus?: number
  debt?: number
}

type ManualStore = Record<string, ManualLoyaltySnapshot>

function cardKey(num: string) {
  return canonicalCardNum(num)
}

function readManualStore(): ManualStore {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(MANUAL_STORE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ManualStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeManualStore(store: ManualStore) {
  if (typeof window === 'undefined') return
  try {
    if (!Object.keys(store).length) {
      localStorage.removeItem(MANUAL_STORE_KEY)
      return
    }
    localStorage.setItem(MANUAL_STORE_KEY, JSON.stringify(store))
  } catch { /* quota */ }
}

export function persistManualLoyaltySnapshot(snapshot: ManualLoyaltySnapshot) {
  const key = cardKey(snapshot.cardNum)
  const store = readManualStore()
  if (snapshot.levelAssignMode !== 'manual') {
    delete store[key]
    writeManualStore(store)
    return
  }
  store[key] = { ...snapshot, cardNum: key }
  writeManualStore(store)
}

export function clearManualLoyaltyOverride(num: string) {
  const key = cardKey(num)
  const store = readManualStore()
  if (!store[key]) return
  delete store[key]
  writeManualStore(store)
}

function getManualOverride(num: string): ManualLoyaltySnapshot | undefined {
  return readManualStore()[cardKey(num)]
}

function manualOverrideForClient(client: AdminClient): ManualLoyaltySnapshot | undefined {
  if (client.card) return getManualOverride(client.card)
  return undefined
}

function serverMatchesManual(row: { level?: ClientLevel | ''; levelAssignMode?: 'auto' | 'manual' }, manual: ManualLoyaltySnapshot): boolean {
  const lvl = normalizeLoyaltyLevel(row.level)
  return row.levelAssignMode === 'manual' && lvl === manual.level
}

function resolvedLocalLoyaltyLevel(local: AdminCard | AdminClient): ClientLevel | undefined {
  if (local.level === undefined) {
    return local.levelAssignMode === 'manual' ? 'basic' : undefined
  }
  if (local.level === '') {
    return local.levelAssignMode === 'manual' ? 'basic' : undefined
  }
  return local.level as ClientLevel
}

export function markCardLoyaltySaved(num: string, snapshot?: ManualLoyaltySnapshot) {
  cardSavedAt.set(cardKey(num), Date.now())
  if (snapshot) persistManualLoyaltySnapshot(snapshot)
}

export function markClientLoyaltySaved(clientId: string) {
  if (!clientId) return
  clientSavedAt.set(clientId, Date.now())
}

function isRecent(map: Map<string, number>, key: string) {
  const t = map.get(key)
  if (!t) return false
  if (Date.now() - t > TTL_MS) {
    map.delete(key)
    return false
  }
  return true
}

function mergeLoyaltyFields<T extends AdminCard | AdminClient>(api: T, local: T): T {
  const manual = local.levelAssignMode === 'manual'
  const localLevel = resolvedLocalLoyaltyLevel(local)
  return {
    ...api,
    level: manual ? (localLevel ?? 'basic') : (localLevel ?? api.level),
    vip: local.vip,
    debtEnabled: local.debtEnabled,
    loyaltyPeriod: local.loyaltyPeriod ?? api.loyaltyPeriod,
    levelLockedPeriod: 'levelLockedPeriod' in local ? (local.levelLockedPeriod ?? undefined) : api.levelLockedPeriod,
    levelAssignMode: local.levelAssignMode ?? api.levelAssignMode,
    levelValidUntil: 'levelValidUntil' in local ? (local.levelValidUntil ?? undefined) : api.levelValidUntil,
    vipUntil: 'vipUntil' in local ? (local.vipUntil ?? undefined) : api.vipUntil,
    bonus: local.bonus ?? api.bonus,
    debt: local.debt ?? api.debt,
    debtLimit: local.debtLimit ?? api.debtLimit,
  } as T
}

function applyManualOverrideToCard(apiCard: AdminCard): AdminCard {
  const manual = getManualOverride(apiCard.num)
  if (!manual) return apiCard
  if (serverMatchesManual(apiCard, manual)) {
    clearManualLoyaltyOverride(apiCard.num)
    return apiCard
  }
  const apiNorm = normalizeLoyaltyLevel(apiCard.level)
  if (apiCard.levelAssignMode === 'manual' && apiNorm === manual.level) {
    clearManualLoyaltyOverride(apiCard.num)
    return apiCard
  }
  return mergeLoyaltyFields(apiCard, {
    ...apiCard,
    level: manual.level,
    levelAssignMode: 'manual',
    levelValidUntil: manual.levelValidUntil ?? undefined,
    levelLockedPeriod: manual.levelLockedPeriod ?? undefined,
    vip: manual.vip ?? apiCard.vip,
    debtEnabled: manual.debtEnabled ?? apiCard.debtEnabled,
    debtLimit: manual.debtLimit ?? apiCard.debtLimit,
    bonus: manual.bonus ?? apiCard.bonus,
    debt: manual.debt ?? apiCard.debt,
  })
}

function applyManualOverrideToClient(apiClient: AdminClient): AdminClient {
  const manual = manualOverrideForClient(apiClient)
  if (!manual) return apiClient
  if (serverMatchesManual(apiClient, manual)) {
    clearManualLoyaltyOverride(manual.cardNum)
    return apiClient
  }
  const apiNorm = normalizeLoyaltyLevel(apiClient.level)
  if (apiClient.levelAssignMode === 'manual' && apiNorm === manual.level) {
    clearManualLoyaltyOverride(manual.cardNum)
    return apiClient
  }
  return mergeLoyaltyFields(apiClient, {
    ...apiClient,
    level: manual.level,
    levelAssignMode: 'manual',
    levelValidUntil: manual.levelValidUntil ?? undefined,
    levelLockedPeriod: manual.levelLockedPeriod ?? undefined,
    vip: manual.vip ?? apiClient.vip,
    debtEnabled: manual.debtEnabled ?? apiClient.debtEnabled,
    debtLimit: manual.debtLimit ?? apiClient.debtLimit,
    bonus: manual.bonus ?? apiClient.bonus,
    debt: manual.debt ?? apiClient.debt,
  })
}

export function mergeCardLoyaltyIfRecent(apiCard: AdminCard, localCard?: AdminCard): AdminCard {
  let merged = apiCard
  if (localCard && isRecent(cardSavedAt, cardKey(apiCard.num))) {
    merged = mergeLoyaltyFields(apiCard, localCard)
  }
  return applyManualOverrideToCard(merged)
}

export function mergeClientLoyaltyIfRecent(apiClient: AdminClient, localClient?: AdminClient): AdminClient {
  let merged = apiClient
  if (localClient && isRecent(clientSavedAt, localClient.id)) {
    merged = mergeLoyaltyFields(apiClient, localClient)
  }
  merged = applyManualOverrideToClient(merged)
  if (localClient && isRecent(clientSavedAt, localClient.id)) {
    return { ...merged, card: localClient.card || merged.card }
  }
  return merged
}

export function findLocalCard(cards: AdminCard[], num: string) {
  return cards.find(c => cardNumsMatch(c.num, num))
}
