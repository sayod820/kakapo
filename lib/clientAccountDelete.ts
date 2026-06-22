'use client'

import { api } from './api'
import { USE_API } from './config'
import { useCardStore, hydrateCardStore } from './cardStore'
import { useClientStore } from './clientStore'
import { phonesMatch, normalizePhone, isClientPurged, normalizeClient, DEFAULT_ADMIN_CLIENTS, type AdminClient } from './clientCrm'
import { normalizeCard, cardNumsMatch, type AdminCard } from './cardCrm'
import { emitCrmSync } from './clientProfileSync'
import { legacyPurgeClientOnServer } from './clientLegacyBackend'
import { markPhoneDeleted, markPhonesDeleted, isSyntheticOrderClientId } from './clientTombstones'
import { demoSeedPhones, isDemoSeedClient } from './clientDemoSeed'
import {
  findLocalClient,
  resolveServerClientId,
  removeLocalClientByPhone,
} from './clientActionResolve'
import { type StoreUser } from './clientSession'
import { ACCOUNT_NS, removeAccountJson } from './clientAccountStorage'

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

function applyLocalDelete(clientId: string, phone: string) {
  const client = findLocalClient(clientId, phone)
  const linkedCards = cardsForClient(client, phone, useCardStore.getState().cards)
  unlinkCardsLocal(linkedCards)

  if (phone) {
    removeLocalClientByPhone(phone)
  } else if (clientId) {
    useClientStore.getState().setClients(
      useClientStore.getState().clients.filter(c => c.id !== clientId),
    )
  }
  useClientStore.getState().applyVisibleFilter()
}

async function clientStillOnServer(phone: string): Promise<boolean> {
  if (!phone) return false
  try {
    const remote = await api.getClients()
    return remote.some(c => phonesMatch(c.phone, phone) && !isClientPurged(normalizeClient(c)))
  } catch {
    return false
  }
}

/** Удаление на Render: новый API → PATCH purge → legacy-анонимизация (старый backend) */
async function purgeClientOnServer(clientId: string, phone: string): Promise<void> {
  const serverId = await resolveServerClientId(clientId, phone)
  const id = serverId || clientId
  let lastErr: Error | null = null

  if (phone) {
    try {
      await api.deleteClientByPhone(phone)
      if (!(await clientStillOnServer(phone))) return
    } catch (e) {
      lastErr = e instanceof Error ? e : lastErr
    }
  }

  if (id && !isSyntheticOrderClientId(id)) {
    try {
      await api.deleteClient(id, phone)
      if (!(await clientStillOnServer(phone))) return
    } catch (e) {
      lastErr = e instanceof Error ? e : lastErr
    }
  }

  try {
    await api.purgeClient(id)
    if (!(await clientStillOnServer(phone))) return
  } catch (e) {
    lastErr = e instanceof Error ? e : lastErr
  }

  try {
    await legacyPurgeClientOnServer(id, phone)
    if (!(await clientStillOnServer(phone))) return
  } catch (e) {
    lastErr = e instanceof Error ? e : lastErr
  }

  if (await clientStillOnServer(phone)) {
    throw lastErr || new Error('Клиент остался на сервере. Обновите backend на Render и попробуйте снова.')
  }
}

/** Полностью удалить клиента из CRM (только админ) */
export async function deleteClientFromCrm(clientId: string, phone?: string): Promise<void> {
  hydrateCardStore()

  const client = findLocalClient(clientId, phone)
  const targetPhone = phone || client?.phone || ''
  if (!targetPhone && !clientId) throw new Error('Клиент не найден')

  // Сначала tombstone — переживает polling и sync с API
  if (targetPhone) markPhoneDeleted(targetPhone)

  applyLocalDelete(clientId, targetPhone)

  if (USE_API) {
    const onServer = await clientStillOnServer(targetPhone).catch(() => false)
    if (onServer) {
      try {
        await purgeClientOnServer(clientId, targetPhone)
      } catch (e) {
        // Tombstone уже стоит — для «призрака» из заказов этого достаточно
        if (!isSyntheticOrderClientId(clientId) && !isDemoSeedClient(clientId, targetPhone)) {
          throw e
        }
      }
    }
    useClientStore.getState().applyVisibleFilter()
  }

  emitCrmSync()
}

/** Удалить всех демо-клиентов U-01…U-07 (тестовые данные) */
export async function purgeAllDemoClientsFromCrm(): Promise<{ removed: number; errors: number }> {
  markPhonesDeleted(demoSeedPhones())

  let removed = 0
  let errors = 0

  if (USE_API) {
    try {
      const res = await api.purgeDemoClients()
      removed = res.removed ?? DEFAULT_ADMIN_CLIENTS.length
      useClientStore.getState().applyVisibleFilter()
      emitCrmSync()
      return { removed, errors: 0 }
    } catch {
      /* старый backend — удаляем по одному */
    }
  }

  for (const demo of DEFAULT_ADMIN_CLIENTS) {
    try {
      await deleteClientFromCrm(demo.id, demo.phone)
      removed += 1
    } catch {
      errors += 1
    }
  }

  useClientStore.getState().applyVisibleFilter()
  emitCrmSync()
  return { removed, errors }
}

/** Самоудаление из профиля — полное удаление: клиент, заказы, бонусы */
export async function deleteClientAccount(user: StoreUser): Promise<void> {
  const phone = user.phone?.trim()
  if (!phone) throw new Error('Нет данных аккаунта')

  let clientId = user.clientId
  const local = findLocalClient(clientId || '', phone)
  if (local) clientId = local.id

  if (phone) markPhoneDeleted(phone)
  applyLocalDelete(clientId || '', phone)

  if (USE_API) {
    try {
      await api.purgeAccountByPhone(phone)
      const { useOrders } = await import('./store')
      await useOrders.getState().fetchOrders()
      await useClientStore.getState().fetchFromApi()
      await useCardStore.getState().fetchFromApi()
    } catch (e) {
      throw e instanceof Error ? e : new Error('Не удалось удалить аккаунт')
    }
  } else {
    const { useOrders } = await import('./store')
    const { phonesMatch } = await import('./clientCrm')
    useOrders.setState({
      orders: useOrders.getState().orders.filter(o => !phonesMatch(o.client?.phone || '', phone)),
    })
  }

  for (const ns of Object.values(ACCOUNT_NS)) {
    removeAccountJson(ns, phone)
  }

  emitCrmSync()
}
