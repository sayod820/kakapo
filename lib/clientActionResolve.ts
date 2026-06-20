'use client'

import { api } from './api'
import { USE_API } from './config'
import { phonesMatch, type AdminClient } from './clientCrm'
import { isSyntheticOrderClientId } from './clientTombstones'
import { useClientStore } from './clientStore'

export function findLocalClient(clientId: string, phone?: string): AdminClient | undefined {
  const clients = useClientStore.getState().clients
  return clients.find(c => c.id === clientId)
    || (phone ? clients.find(c => phonesMatch(c.phone, phone)) : undefined)
}

/** Найти реальный ID клиента на сервере (не синтетический U-XXXXXXXXX из заказов) */
export async function resolveServerClientId(clientId: string, phone?: string): Promise<string | undefined> {
  const local = findLocalClient(clientId, phone)
  if (local && !isSyntheticOrderClientId(local.id)) {
    if (!USE_API) return local.id
  }

  if (USE_API) {
    try {
      const remote = await api.getClients()
      if (clientId && !isSyntheticOrderClientId(clientId)) {
        const byId = remote.find(c => c.id === clientId)
        if (byId) return byId.id
      }
      if (phone) {
        const byPhone = remote.find(c => phonesMatch(c.phone, phone))
        if (byPhone) return byPhone.id
      }
    } catch { /* offline */ }
  }

  if (clientId && !isSyntheticOrderClientId(clientId)) return clientId
  return undefined
}

export function applyLocalClientPatch(clientId: string, phone: string, patch: Partial<AdminClient>) {
  const clientStore = useClientStore.getState()
  const match = clientStore.clients.find(c =>
    c.id === clientId || (phone && phonesMatch(c.phone, phone)),
  )
  if (match) {
    clientStore.updateClient(match.id, patch, USE_API ? { skipApi: true } : undefined)
  }
}

export function removeLocalClientByPhone(phone: string) {
  const key = phone.replace(/\D/g, '').slice(-9)
  if (!key) return
  const clientStore = useClientStore.getState()
  clientStore.setClients(
    clientStore.clients.filter(c => c.phone.replace(/\D/g, '').slice(-9) !== key),
  )
}
