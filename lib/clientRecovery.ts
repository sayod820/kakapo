'use client'

import { api } from './api'
import { USE_API } from './config'
import { useCardStore, hydrateCardStore } from './cardStore'
import { useClientStore, hydrateClientStore } from './clientStore'
import { phonesMatch, type AdminClient } from './clientCrm'
import { normalizeCard, type AdminCard } from './cardCrm'
import { emitCrmSync } from './clientProfileSync'
import { legacyMoveToRecoveryOnServer, legacyRestoreOnServer } from './clientLegacyBackend'
import { unmarkPhoneDeleted } from './clientTombstones'

export type ClientAccountStatus = 'active' | 'recovery'

export function isClientInRecovery(c?: AdminClient | null): boolean {
  return c?.accountStatus === 'recovery'
}

export function isClientActiveAccount(c?: AdminClient | null): boolean {
  return !isClientInRecovery(c)
}

function findClient(clientId: string, phone?: string): AdminClient | undefined {
  const clients = useClientStore.getState().clients
  return clients.find(c => c.id === clientId)
    || (phone ? clients.find(c => phonesMatch(c.phone, phone)) : undefined)
}

function cardsForClient(client: AdminClient | undefined, phone: string, cards: AdminCard[]): AdminCard[] {
  return cards.filter(c => {
    if (c.status === 'unlinked') return false
    if (client && c.clientId === client.id) return true
    if (client?.card && c.num === client.card) return true
    if (phone && phonesMatch(c.phone || '', phone)) return true
    return false
  })
}

function unlinkCardsLocal(linked: AdminCard[]) {
  if (!linked.length) return
  const nums = new Set(linked.map(c => c.num))
  const cardStore = useCardStore.getState()
  cardStore.setCards(cardStore.cards.map(c => {
    if (!nums.has(c.num)) return c
    return normalizeCard({
      num: c.num,
      client: '',
      phone: '',
      status: 'unlinked',
      level: '',
      bonus: 0,
      debt: 0,
      debtLimit: 0,
      vip: false,
      debtEnabled: false,
    })
  }))
}

function patchClientLocal(clientId: string, patch: Partial<AdminClient>) {
  const clientStore = useClientStore.getState()
  const prev = clientStore.clients.find(c => c.id === clientId)
  if (!prev) return
  clientStore.updateClient(clientId, patch)
}

/** Переместить клиента в раздел восстановления (самоудаление или админ) */
export async function moveClientToRecovery(clientId: string, phone?: string): Promise<void> {
  hydrateClientStore()
  hydrateCardStore()

  const client = findClient(clientId, phone)
  const id = client?.id || clientId
  const targetPhone = phone || client?.phone || ''
  if (!id) throw new Error('Клиент не найден')

  const linked = cardsForClient(client, targetPhone, useCardStore.getState().cards)
  unlinkCardsLocal(linked)

  const deletedAt = new Date().toISOString().slice(0, 10)
  patchClientLocal(id, {
    accountStatus: 'recovery',
    deletedAt,
    card: '',
  })

  if (USE_API) {
    try {
      await api.moveClientToRecovery(id)
    } catch {
      await legacyMoveToRecoveryOnServer(id, targetPhone).catch(console.error)
    }
  }

  emitCrmSync()
}

/** Восстановить клиента из раздела восстановления */
export async function restoreClientFromRecovery(clientId: string): Promise<void> {
  hydrateClientStore()
  const client = useClientStore.getState().clients.find(c => c.id === clientId)
  if (!client) throw new Error('Клиент не найден')

  patchClientLocal(clientId, {
    accountStatus: 'active',
    deletedAt: undefined,
    blocked: false,
  })

  unmarkPhoneDeleted(client.phone)

  if (USE_API) {
    try {
      await api.restoreClient(clientId)
    } catch {
      await legacyRestoreOnServer(clientId).catch(console.error)
    }
  }

  emitCrmSync()
}
