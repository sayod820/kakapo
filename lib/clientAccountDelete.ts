'use client'

import { api } from './api'
import { USE_API } from './config'
import { useCardStore } from './cardStore'
import { useClientStore } from './clientStore'
import { phonesMatch } from './clientCrm'
import { emitCrmSync } from './clientProfileSync'
import { saveStoreUser, type StoreUser } from './clientSession'
import { ACCOUNT_NS, removeAccountJson } from './clientAccountStorage'

/** Удалить клиента из CRM, отвязать карты и очистить локальные данные аккаунта */
export async function deleteClientAccount(user: StoreUser): Promise<void> {
  const phone = user.phone?.trim()
  if (!phone) throw new Error('Нет данных аккаунта')

  const clientStore = useClientStore.getState()
  const cardStore = useCardStore.getState()

  const client = user.clientId
    ? clientStore.clients.find(c => c.id === user.clientId)
    : clientStore.clients.find(c => phonesMatch(c.phone, phone))

  const linkedCards = cardStore.cards.filter(c => {
    if (c.status === 'unlinked') return false
    if (client && c.clientId === client.id) return true
    return phonesMatch(c.phone || '', phone)
  })

  for (const card of linkedCards) {
    cardStore.unlinkCard(card.num)
  }

  if (client) {
    if (USE_API) await api.deleteClient(client.id)
    clientStore.setClients(clientStore.clients.filter(c => c.id !== client.id))
  }

  for (const ns of Object.values(ACCOUNT_NS)) {
    removeAccountJson(ns, phone)
  }

  saveStoreUser(null)
  emitCrmSync()
}
