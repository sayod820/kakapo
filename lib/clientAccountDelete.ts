'use client'

import { api } from './api'
import { USE_API } from './config'
import { useCardStore, hydrateCardStore } from './cardStore'
import { useClientStore, hydrateClientStore } from './clientStore'
import { normalizePhone, phonesMatch, type AdminClient } from './clientCrm'
import { normalizeCard, type AdminCard } from './cardCrm'
import { emitCrmSync } from './clientProfileSync'
import { moveClientToRecovery } from './clientRecovery'
import { legacyPurgeClientOnServer } from './clientLegacyBackend'
import { markPhoneDeleted, isSyntheticOrderClientId } from './clientTombstones'
import { syncCardsFromApi } from './cardStore'
import { type StoreUser } from './clientSession'
import { ACCOUNT_NS, removeAccountJson } from './clientAccountStorage'

function findClient(clientId: string, phone?: string): AdminClient | undefined {
  const clients = useClientStore.getState().clients
  return clients.find(c => c.id === clientId)
    || (phone ? clients.find(c => phonesMatch(c.phone, phone)) : undefined)
}

function cardsForClient(
  client: AdminClient | undefined,
  phone: string,
  cards: AdminCard[],
): AdminCard[] {
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

function removeClientsByPhone(phone: string) {
  const key = normalizePhone(phone)
  if (!key) return
  const clientStore = useClientStore.getState()
  clientStore.setClients(clientStore.clients.filter(c => normalizePhone(c.phone) !== key))
}

function isNotFoundError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e || '')
  return /не найден|404|not found/i.test(msg)
}

async function resolveServerClientId(clientId: string, phone: string): Promise<string | undefined> {
  const local = findClient(clientId, phone)
  if (local && !isSyntheticOrderClientId(local.id)) return local.id

  if (USE_API && phone) {
    try {
      const remote = await api.getClients()
      const found = remote.find(c => phonesMatch(c.phone, phone))
      if (found) return found.id
    } catch { /* offline */ }
  }

  if (clientId && !isSyntheticOrderClientId(clientId)) return clientId
  return undefined
}

async function remoteDeleteClient(clientId: string, phone: string): Promise<void> {
  if (!USE_API) return
  const serverId = await resolveServerClientId(clientId, phone)
  try {
    if (serverId) {
      await api.deleteClient(serverId)
      return
    }
    if (phone) {
      await api.deleteClientByPhone(phone)
    }
  } catch (e) {
    if (!phone || !isNotFoundError(e)) throw e
    await api.deleteClientByPhone(phone)
  }
}

/** Полностью удалить клиента из CRM (только админ) */
export async function deleteClientFromCrm(clientId: string, phone?: string): Promise<void> {
  hydrateClientStore()
  hydrateCardStore()

  const client = findClient(clientId, phone)
  const targetPhone = phone || client?.phone || ''
  if (!targetPhone && !clientId) throw new Error('Клиент не найден')

  const linkedCards = cardsForClient(client, targetPhone, useCardStore.getState().cards)

  unlinkCardsLocal(linkedCards)
  if (targetPhone) {
    removeClientsByPhone(targetPhone)
    markPhoneDeleted(targetPhone)
  } else if (clientId) {
    const clientStore = useClientStore.getState()
    clientStore.setClients(clientStore.clients.filter(c => c.id !== clientId))
  }

  if (USE_API) {
    try {
      await remoteDeleteClient(clientId, targetPhone)
    } catch (e) {
      console.error(e)
      try {
        const serverId = await resolveServerClientId(clientId, targetPhone)
        await legacyPurgeClientOnServer(serverId || clientId, targetPhone)
      } catch (legacyErr) {
        console.error(legacyErr)
      }
    }
    try {
      await syncCardsFromApi()
    } catch { /* ignore */ }
  }

  emitCrmSync()
}

/** Самоудаление из профиля — клиент попадает в «Восстановление» */
export async function deleteClientAccount(user: StoreUser): Promise<void> {
  const phone = user.phone?.trim()
  if (!phone) throw new Error('Нет данных аккаунта')

  hydrateClientStore()

  let clientId = user.clientId
  const local = findClient(clientId || '', phone)
  if (local) clientId = local.id

  if (!clientId && USE_API) {
    try {
      const remote = await api.getClients()
      const found = remote.find(c => phonesMatch(c.phone, phone))
      if (found) clientId = found.id
    } catch { /* локально */ }
  }

  let apiError: Error | null = null
  try {
    if (clientId || normalizePhone(phone)) {
      await moveClientToRecovery(clientId || '', phone)
    }
  } catch (e) {
    apiError = e instanceof Error ? e : new Error('Не удалось удалить аккаунт')
  }

  for (const ns of Object.values(ACCOUNT_NS)) {
    removeAccountJson(ns, phone)
  }

  if (apiError) throw apiError
}
