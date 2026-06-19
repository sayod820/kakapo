'use client'

import { cardNumsMatch, canonicalCardNum, type AdminCard } from './cardCrm'
import type { AdminClient } from './clientCrm'

const TTL_MS = 90_000
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

export function mergeCardLoyaltyIfRecent(apiCard: AdminCard, localCard?: AdminCard): AdminCard {
  if (!localCard || !isRecent(cardSavedAt, cardKey(apiCard.num))) return apiCard
  return {
    ...apiCard,
    level: localCard.level || apiCard.level,
    vip: localCard.vip,
    debtEnabled: localCard.debtEnabled,
    loyaltyPeriod: localCard.loyaltyPeriod || apiCard.loyaltyPeriod,
    bonus: localCard.bonus ?? apiCard.bonus,
    debt: localCard.debt ?? apiCard.debt,
    debtLimit: localCard.debtLimit ?? apiCard.debtLimit,
  }
}

export function mergeClientLoyaltyIfRecent(apiClient: AdminClient, localClient?: AdminClient): AdminClient {
  if (!localClient || !isRecent(clientSavedAt, localClient.id)) return apiClient
  return {
    ...apiClient,
    level: localClient.level || apiClient.level,
    vip: localClient.vip,
    debtEnabled: localClient.debtEnabled,
    loyaltyPeriod: localClient.loyaltyPeriod || apiClient.loyaltyPeriod,
    bonus: localClient.bonus ?? apiClient.bonus,
    debt: localClient.debt ?? apiClient.debt,
    debtLimit: localClient.debtLimit ?? apiClient.debtLimit,
    card: localClient.card || apiClient.card,
  }
}

export function findLocalCard(cards: AdminCard[], num: string) {
  return cards.find(c => cardNumsMatch(c.num, num))
}
