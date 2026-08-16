'use client'

import { cardDigits, cardNumsMatch, canonicalCardNum, type AdminCard } from './cardCrm'
import type { AdminClient, ClientLevel } from './clientCrm'
import { normalizeLoyaltyLevel } from './loyaltyAdminLock'

const TTL_MS = 180_000
const MANUAL_STORE_KEY = 'kakapo-manual-loyalty-v1'

const cardSavedAt = new Map<string, number>()
const clientSavedAt = new Map<string, number>()
/** Долг / бонусы / кошелёк уже изменены локально, очередь ещё не ушла */
const moneyPendingClient = new Map<string, number>()
const moneyPendingCard = new Map<string, number>()
const MONEY_TTL_MS = 15 * 60_000

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

/** Стабильный ключ по цифрам карты — КАКАПО-0007 и KAKAPO-0007 совпадают */
function cardKey(num: string) {
  const d = cardDigits(num)
  return d ? `d:${d}` : canonicalCardNum(num)
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
  // убрать устаревшие ключи с другим написанием префикса
  for (const k of Object.keys(store)) {
    if (k !== key && cardNumsMatch(k.replace(/^d:/, ''), snapshot.cardNum)) {
      delete store[k]
    }
  }
  if (snapshot.levelAssignMode !== 'manual') {
    delete store[key]
    writeManualStore(store)
    return
  }
  store[key] = { ...snapshot, cardNum: canonicalCardNum(snapshot.cardNum) }
  writeManualStore(store)
}

export function clearManualLoyaltyOverride(num: string) {
  const key = cardKey(num)
  const store = readManualStore()
  let changed = false
  for (const k of Object.keys(store)) {
    if (k === key || cardNumsMatch(k.replace(/^d:/, ''), num)) {
      delete store[k]
      changed = true
    }
  }
  if (changed) writeManualStore(store)
}

export function getManualLoyaltyForCard(num: string): ManualLoyaltySnapshot | undefined {
  const store = readManualStore()
  const key = cardKey(num)
  if (store[key]) return store[key]
  for (const [k, v] of Object.entries(store)) {
    if (cardNumsMatch(k.replace(/^d:/, ''), num)) return v
  }
  return undefined
}

function manualOverrideForClient(client: AdminClient): ManualLoyaltySnapshot | undefined {
  if (client.card) return getManualLoyaltyForCard(client.card)
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

export function markMoneyPending(opts: { clientId?: string; cardNum?: string }) {
  const now = Date.now()
  if (opts.clientId) moneyPendingClient.set(opts.clientId, now)
  if (opts.cardNum && String(opts.cardNum).trim()) moneyPendingCard.set(cardKey(opts.cardNum), now)
}

export function clearMoneyPending(opts: { clientId?: string; cardNum?: string }) {
  if (opts.clientId) moneyPendingClient.delete(opts.clientId)
  if (opts.cardNum) moneyPendingCard.delete(cardKey(opts.cardNum))
}

export function clearMoneyPendingFromOp(kind: string, payload: Record<string, unknown> | undefined) {
  const p = payload || {}
  if (kind === 'sale' || kind === 'client_upsert') {
    clearMoneyPending({
      clientId: String(p.clientId || ''),
      cardNum: String(p.cardNum || ''),
    })
  }
  if (kind === 'debt_repay' || kind === 'card_topup') {
    clearMoneyPending({
      clientId: String(p.clientId || ''),
      cardNum: String(p.num || p.cardNum || ''),
    })
  }
  if (kind === 'sale_return') {
    clearMoneyPending({
      clientId: String(p.clientId || ''),
      cardNum: String(p.cardNum || ''),
    })
  }
}

function isMoneyPendingClient(id: string) {
  return isRecentTtl(moneyPendingClient, id, MONEY_TTL_MS)
}

function isMoneyPendingCard(num: string) {
  return isRecentTtl(moneyPendingCard, cardKey(num), MONEY_TTL_MS)
}

function isRecent(map: Map<string, number>, key: string) {
  return isRecentTtl(map, key, TTL_MS)
}

function isRecentTtl(map: Map<string, number>, key: string, ttl: number) {
  const t = map.get(key)
  if (!t) return false
  if (Date.now() - t > ttl) {
    map.delete(key)
    return false
  }
  return true
}

function mergeLoyaltyFields<T extends AdminCard | AdminClient>(
  api: T,
  local: T,
  keepMoney: boolean,
): T {
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
    bonus: keepMoney ? (local.bonus ?? api.bonus) : api.bonus,
    debt: keepMoney ? (local.debt ?? api.debt) : api.debt,
    debtLimit: local.debtLimit ?? api.debtLimit,
    ...('wallet' in api || 'wallet' in local
      ? { wallet: keepMoney ? ((local as AdminClient).wallet ?? (api as AdminClient).wallet) : (api as AdminClient).wallet }
      : {}),
  } as T
}

export function applyManualLoyaltyToCard(apiCard: AdminCard): AdminCard {
  const manual = getManualLoyaltyForCard(apiCard.num)
  if (!manual || manual.levelAssignMode !== 'manual') return apiCard
  if (apiCard.levelAssignMode === 'auto') {
    clearManualLoyaltyOverride(apiCard.num)
    return apiCard
  }
  if (serverMatchesManual(apiCard, manual)) {
    clearManualLoyaltyOverride(apiCard.num)
    return apiCard
  }
  return mergeLoyaltyFields(apiCard, {
    ...apiCard,
    level: manual.level === 'basic' ? '' : manual.level,
    levelAssignMode: 'manual',
    levelValidUntil: manual.levelValidUntil ?? undefined,
    levelLockedPeriod: manual.levelLockedPeriod ?? undefined,
    vip: manual.vip ?? apiCard.vip,
    debtEnabled: manual.debtEnabled ?? apiCard.debtEnabled,
    debtLimit: manual.debtLimit ?? apiCard.debtLimit,
    bonus: apiCard.bonus,
    debt: apiCard.debt,
  }, false)
}

export function applyManualLoyaltyToClient(apiClient: AdminClient): AdminClient {
  const manual = manualOverrideForClient(apiClient)
  if (!manual || manual.levelAssignMode !== 'manual') return apiClient
  if (apiClient.levelAssignMode === 'auto') {
    clearManualLoyaltyOverride(manual.cardNum)
    return apiClient
  }
  if (serverMatchesManual(apiClient, manual)) {
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
    bonus: apiClient.bonus,
    debt: apiClient.debt,
  }, false)
}

export function mergeCardLoyaltyIfRecent(apiCard: AdminCard, localCard?: AdminCard): AdminCard {
  let merged = apiCard
  if (localCard && isRecent(cardSavedAt, cardKey(apiCard.num))) {
    merged = mergeLoyaltyFields(apiCard, localCard, false)
  }
  if (localCard && isMoneyPendingCard(apiCard.num)) {
    merged = {
      ...merged,
      bonus: localCard.bonus ?? merged.bonus,
      debt: localCard.debt ?? merged.debt,
      wallet: localCard.wallet ?? merged.wallet,
      posCashBonus: localCard.posCashBonus ?? merged.posCashBonus,
    }
  }
  return applyManualLoyaltyToCard(merged)
}

export function mergeClientLoyaltyIfRecent(apiClient: AdminClient, localClient?: AdminClient): AdminClient {
  let merged = apiClient
  if (localClient && isRecent(clientSavedAt, localClient.id)) {
    merged = mergeLoyaltyFields(apiClient, localClient, false)
  }
  if (localClient && isMoneyPendingClient(localClient.id)) {
    merged = {
      ...merged,
      bonus: localClient.bonus ?? merged.bonus,
      debt: localClient.debt ?? merged.debt,
      wallet: localClient.wallet ?? merged.wallet,
    }
  }
  merged = applyManualLoyaltyToClient(merged)
  if (localClient && isRecent(clientSavedAt, localClient.id)) {
    return { ...merged, card: localClient.card || merged.card }
  }
  return merged
}

export function findLocalCard(cards: AdminCard[], num: string) {
  return cards.find(c => cardNumsMatch(c.num, num))
}
