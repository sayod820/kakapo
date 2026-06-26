'use client'

import { cardNumsMatch, canonicalCardNum, type AdminCard } from './cardCrm'
import type { AdminClient } from './clientCrm'

const TTL_MS = 180_000
const cardSavedAt = new Map<string, number>()
const clientSavedAt = new Map<string, number>()

function cardKey(num: string) {
  return canonicalCardNum(num)
}

export function markCardLoyaltySaved(num: string) {
  cardSavedAt.set(cardKey(num), Date.now())
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
  const localLevel = local.level !== undefined && local.level !== '' ? local.level : undefined
  return {
    ...api,
    level: manual && localLevel ? localLevel : (localLevel ?? api.level),
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

export function mergeCardLoyaltyIfRecent(apiCard: AdminCard, localCard?: AdminCard): AdminCard {
  if (!localCard || !isRecent(cardSavedAt, cardKey(apiCard.num))) return apiCard
  return mergeLoyaltyFields(apiCard, localCard)
}

export function mergeClientLoyaltyIfRecent(apiClient: AdminClient, localClient?: AdminClient): AdminClient {
  if (!localClient || !isRecent(clientSavedAt, localClient.id)) return apiClient
  return {
    ...mergeLoyaltyFields(apiClient, localClient),
    card: localClient.card || apiClient.card,
  }
}

export function findLocalCard(cards: AdminCard[], num: string) {
  return cards.find(c => cardNumsMatch(c.num, num))
}
