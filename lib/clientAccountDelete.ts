'use client'

import { api } from './api'
import { USE_API } from './config'
import { useCardStore, hydrateCardStore, syncCardsFromApi } from './cardStore'
import { useClientStore, hydrateClientStore, syncClientsFromApi } from './clientStore'
import { phonesMatch, type AdminClient } from './clientCrm'
import { normalizeCard, cardNumsMatch, type AdminCard } from './cardCrm'
import { emitCrmSync } from './clientProfileSync'
import { moveClientToRecovery } from './clientRecovery'
import { legacyPurgeClientOnServer } from './clientLegacyBackend'
import { markPhoneDeleted } from './clientTombstones'
import {
  findLocalClient,
  resolveServerClientId,
  removeLocalClientByPhone,
} from './clientActionResolve'
import { type StoreUser } from './clientSession'
import { ACCOUNT_NS, removeAccountJson } from './clientAccountStorage'

function findClient(clientId: string, phone?: string): AdminClient | undefined {
  return findLocalClient(clientId, phone)
}

function cardsForClient(
  client: AdminClient | undefined,
  phone: string,
  cards: AdminCard[],
): AdminCard[] {
  return cards.filter(c => {
    if (c.status === 'unlinked') return false
    if (client && c.clientId === client.id) return true
    if (client?.card && cardNumsMatch(c.num, client.card)) return true
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
  removeLocalClientByPhone(phone)
}

function isNotFoundError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e || '')
  return /не найден|404|not found/i.test(msg)
}

async function remoteDeleteClient(clientId: string, phone: string): Promise<void> {
  if (!USE_API) return

  const serverId = await resolveServerClientId(clientId, phone)

  if (phone) {
    try {
      await api.deleteClientByPhone(phone)
      return
    } catch (e) {
      if (!isNotFoundError(e) || !serverId) throw e
    }
  }

  if (serverId) {
    await api.deleteClient(serverId)
    return
  }

  throw new Error('Клиент не найден на сервере')
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
    useClientStore.getState().setClients(
      useClientStore.getState().clients.filter(c => c.id !== clientId),
    )
  }

  if (USE_API) {
    let deleted = false
    let lastErr: Error | null = null
    try {
      await remoteDeleteClient(clientId, targetPhone)
      deleted = true
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error('Не удалось удалить клиента')
      try {
        const serverId = await resolveServerClientId(clientId, targetPhone)
        if (serverId || targetPhone) {
          await legacyPurgeClientOnServer(serverId || clientId, targetPhone)
          deleted = true
        }
      } catch (legacyErr) {
        lastErr = legacyErr instanceof Error ? legacyErr : lastErr
      }
    }
    if (!deleted) {
      throw lastErr || new Error('Не удалось удалить клиента на сервере')
    }
    await Promise.all([syncClientsFromApi(), syncCardsFromApi()])
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
