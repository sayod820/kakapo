'use client'

import { api } from './api'
import { USE_API } from './config'
import { useCardStore, hydrateCardStore } from './cardStore'
import { useClientStore, hydrateClientStore } from './clientStore'
import { normalizePhone, phonesMatch, type AdminClient } from './clientCrm'
import { normalizeCard, type AdminCard } from './cardCrm'
import { emitCrmSync } from './clientProfileSync'
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

function removeClientLocal(clientId: string) {
  const clientStore = useClientStore.getState()
  clientStore.setClients(clientStore.clients.filter(c => c.id !== clientId))
}

function isNotFoundError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e || '')
  return /не найден|404|not found/i.test(msg)
}

async function remoteDeleteClient(clientId: string, phone: string): Promise<void> {
  if (!USE_API) return
  try {
    await api.deleteClient(clientId)
    return
  } catch (e) {
    if (!phone || !isNotFoundError(e)) throw e
  }
  await api.deleteClientByPhone(phone)
}

/** Удалить клиента из CRM и отвязать его карты (админка и внутренние вызовы) */
export async function deleteClientFromCrm(clientId: string, phone?: string): Promise<void> {
  hydrateClientStore()
  hydrateCardStore()

  const client = findClient(clientId, phone)
  const idToDelete = client?.id || clientId
  const targetPhone = phone || client?.phone || ''
  if (!idToDelete && !targetPhone) throw new Error('Клиент не найден')

  const linkedCards = cardsForClient(client, targetPhone, useCardStore.getState().cards)

  // Сразу обновляем UI — не ждём сеть
  unlinkCardsLocal(linkedCards)
  if (idToDelete) removeClientLocal(idToDelete)

  if (USE_API) {
    if (idToDelete) {
      await remoteDeleteClient(idToDelete, targetPhone)
    } else if (targetPhone) {
      await api.deleteClientByPhone(targetPhone)
    }
  }

  emitCrmSync()
}

/** Удалить аккаунт из профиля магазина */
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
    } catch { /* удалим локально и по телефону */ }
  }

  let apiError: Error | null = null
  try {
    if (clientId || normalizePhone(phone)) {
      await deleteClientFromCrm(clientId || '', phone)
    }
  } catch (e) {
    apiError = e instanceof Error ? e : new Error('Не удалось удалить аккаунт')
  }

  for (const ns of Object.values(ACCOUNT_NS)) {
    removeAccountJson(ns, phone)
  }

  if (apiError) throw apiError
}
