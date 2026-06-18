'use client'

import { api } from './api'
import { USE_API } from './config'
import { useCardStore, hydrateCardStore, syncCardsFromApi } from './cardStore'
import { useClientStore, hydrateClientStore, syncClientsFromApi } from './clientStore'
import { phonesMatch, type AdminClient } from './clientCrm'
import { type AdminCard } from './cardCrm'
import { emitCrmSync } from './clientProfileSync'
import { saveStoreUser, type StoreUser } from './clientSession'
import { ACCOUNT_NS, removeAccountJson } from './clientAccountStorage'

async function ensureCrmLoaded(): Promise<{ clients: AdminClient[]; cards: AdminCard[] }> {
  hydrateClientStore()
  hydrateCardStore()

  if (USE_API) {
    await Promise.all([syncClientsFromApi(), syncCardsFromApi()])
  }

  const { clients } = useClientStore.getState()
  const { cards } = useCardStore.getState()
  return { clients, cards }
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

async function unlinkCardAwait(num: string) {
  useCardStore.getState().unlinkCard(num)
  if (USE_API) await api.updateCard(num, { unlink: true })
}

/** Удалить клиента из CRM и отвязать его карты (админка и внутренние вызовы) */
export async function deleteClientFromCrm(clientId: string, phone?: string): Promise<void> {
  const { clients, cards } = await ensureCrmLoaded()

  const client = clients.find(c => c.id === clientId)
    || (phone ? clients.find(c => phonesMatch(c.phone, phone)) : undefined)

  const targetPhone = phone || client?.phone || ''
  const linkedCards = cardsForClient(client, targetPhone, cards)

  for (const card of linkedCards) {
    await unlinkCardAwait(card.num)
  }

  const idToDelete = client?.id || clientId
  if (!idToDelete) throw new Error('Клиент не найден')

  if (USE_API) {
    await api.deleteClient(idToDelete)
  }

  const freshClients = useClientStore.getState().clients.filter(c => c.id !== idToDelete)
  useClientStore.getState().setClients(freshClients)
  emitCrmSync()
}

async function resolveClientId(user: StoreUser): Promise<{ clientId?: string; phone: string }> {
  const phone = user.phone?.trim()
  if (!phone) throw new Error('Нет данных аккаунта')

  if (user.clientId) return { clientId: user.clientId, phone }

  if (USE_API) {
    const remote = await api.getClients()
    const found = remote.find(c => phonesMatch(c.phone, phone))
    if (found) return { clientId: found.id, phone }
  }

  const { clients } = await ensureCrmLoaded()
  const found = clients.find(c => phonesMatch(c.phone, phone))
  return { clientId: found?.id, phone }
}

/** Удалить аккаунт из профиля магазина */
export async function deleteClientAccount(user: StoreUser): Promise<void> {
  const { clientId, phone } = await resolveClientId(user)

  if (clientId) {
    await deleteClientFromCrm(clientId, phone)
  } else if (USE_API) {
    throw new Error('Клиент не найден в базе')
  } else {
    const { clients, cards } = await ensureCrmLoaded()
    const client = clients.find(c => phonesMatch(c.phone, phone))
    if (client) await deleteClientFromCrm(client.id, phone)
  }

  for (const ns of Object.values(ACCOUNT_NS)) {
    removeAccountJson(ns, phone)
  }

  saveStoreUser(null)
  emitCrmSync()
}
