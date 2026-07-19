'use client'

import { api } from './api'
import { USE_API } from './config'
import { useCardStore, hydrateCardStore, syncCardsFromApi } from './cardStore'
import { hydrateClientStore, syncClientsFromApi } from './clientStore'
import { phonesMatch, type AdminClient } from './clientCrm'
import { normalizeCard, cardNumsMatch, type AdminCard } from './cardCrm'
import { emitCrmSync } from './clientProfileSync'
import { legacyMoveToRecoveryOnServer, legacyRestoreOnServer } from './clientLegacyBackend'
import { unmarkPhoneDeleted } from './clientTombstones'
import { isRecoveryExpired, recoveryExpiresAtIso } from './clientAccountLifecycle'
import {
  findLocalClient,
  resolveServerClientId,
  applyLocalClientPatch,
} from './clientActionResolve'

export type ClientAccountStatus = 'active' | 'recovery'

export function isClientInRecovery(c?: AdminClient | null): boolean {
  if (c?.accountStatus !== 'recovery') return false
  return !isRecoveryExpired(c)
}

export function isClientActiveAccount(c?: AdminClient | null): boolean {
  return !isClientInRecovery(c)
}

function cardsForClient(client: AdminClient | undefined, phone: string, cards: AdminCard[]): AdminCard[] {
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

function isDebtDeleteBlock(error: unknown): boolean {
  return error instanceof Error && /долг|погас/i.test(error.message)
}

async function remoteMoveToRecovery(clientId: string, phone: string): Promise<void> {
  if (!USE_API) return

  const serverId = await resolveServerClientId(clientId, phone)

  if (serverId) {
    try {
      await api.moveClientToRecovery(serverId, phone)
      return
    } catch (error) {
      if (isDebtDeleteBlock(error)) throw error
      try {
        await legacyMoveToRecoveryOnServer(serverId, phone)
        return
      } catch { /* try phone route */ }
    }
  }

  if (phone) {
    try {
      await api.moveClientToRecoveryByPhone(phone)
      return
    } catch (error) {
      if (isDebtDeleteBlock(error)) throw error
      await legacyMoveToRecoveryOnServer(clientId, phone)
      return
    }
  }

  throw new Error('Клиент не найден на сервере. Добавьте его в CRM или удалите навсегда.')
}

/** Переместить клиента в раздел восстановления (самоудаление или админ) */
export async function moveClientToRecovery(clientId: string, phone?: string): Promise<void> {
  hydrateClientStore()
  hydrateCardStore()

  const client = findLocalClient(clientId, phone)
  const targetPhone = (phone || client?.phone || '').trim()
  if (!targetPhone && !clientId) throw new Error('Клиент не найден')

  // Сначала сервер подтверждает удаление. Если есть долг или нет связи,
  // локальная сессия и профиль остаются нетронутыми.
  if (USE_API) {
    await remoteMoveToRecovery(clientId, targetPhone)
  }

  const linked = cardsForClient(client, targetPhone, useCardStore.getState().cards)
  unlinkCardsLocal(linked)

  const deletedAt = new Date().toISOString().slice(0, 10)
  applyLocalClientPatch(client?.id || clientId, targetPhone, {
    accountStatus: 'recovery',
    deletedAt,
    recoveryExpiresAt: recoveryExpiresAtIso(deletedAt),
    card: '',
  })

  if (USE_API) {
    await Promise.all([syncClientsFromApi(), syncCardsFromApi()])
  }

  emitCrmSync()
}

/** Восстановить клиента из раздела восстановления */
export async function restoreClientFromRecovery(clientId: string, phone?: string): Promise<void> {
  hydrateClientStore()
  const client = findLocalClient(clientId, phone)
  const targetPhone = phone || client?.phone || ''
  const localId = client?.id || clientId
  if (!localId && !targetPhone) throw new Error('Клиент не найден')

  applyLocalClientPatch(localId, targetPhone, {
    accountStatus: 'active',
    deletedAt: undefined,
    recoveryExpiresAt: undefined,
    blocked: false,
  })

  if (targetPhone) unmarkPhoneDeleted(targetPhone)

  if (USE_API) {
    const serverId = await resolveServerClientId(clientId, targetPhone)
    if (!serverId) throw new Error('Клиент не найден на сервере')
    try {
      await api.restoreClient(serverId)
    } catch {
      await legacyRestoreOnServer(serverId)
    }
    await syncClientsFromApi()
  }

  emitCrmSync()
}
