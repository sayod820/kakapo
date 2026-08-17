// ════════════════════════════════════════════════
// KAKAPO — клиенты офлайн (Offline V2)
// ════════════════════════════════════════════════
import { api } from './api'
import { USE_API } from './config'
import {
  normalizeClient,
  type AdminClient,
  type ClientProfileForm,
} from './clientCrm'
import {
  newClientRegistrationDefaults,
  provisionLoyaltyCardForClient,
  registerClientAccount,
  saveClientProfile,
} from './clientCardSync'
import { markClientIdentityPending, useClientStore } from './clientStore'
import { cacheData, isLocalId, newClientRef, newLocalId } from './offline'
import { localFirstOp, type OfflineResult } from './localFirst'
import { isTradeLocalFirst, shadowMirrorPut } from './offlineV2'
import { useOfflineSync } from './offlineSync'
import { useCardStore } from './cardStore'

export type { OfflineResult }

/** Local-first: сразу локально, сервер в фоне. apiCall игнорируется. */
async function raceOp<T>(
  _apiCall: () => Promise<T>,
  localApply: () => Promise<T> | T,
): Promise<OfflineResult<T>> {
  return localFirstOp(localApply)
}

function persistClients() {
  void cacheData('clients', useClientStore.getState().clients)
}

function persistCards() {
  void cacheData('cards', useCardStore.getState().cards)
}

function findClient(id: string): AdminClient | undefined {
  return useClientStore.getState().clients.find(c => c.id === id)
}

function syncLinkedCardIdentity(client: AdminClient, opts?: { skipApi?: boolean }) {
  if (!client?.card) return
  useCardStore.getState().syncIdentityFromClient(client, opts)
  persistCards()
}

function profileToPatch(form: ClientProfileForm) {
  return {
    name: form.name.trim(),
    phone: form.phone.trim(),
    email: form.email.trim(),
    addr: form.addr.trim(),
    note: form.note.trim(),
    blocked: form.blocked,
    card: form.card.trim().toUpperCase(),
  }
}

/** Сохранить клиента (создание / профиль). При V2=on — без сети. */
export async function saveClientSafe(input: {
  editingId: string | null
  withCard: boolean
  profile: ClientProfileForm
}): Promise<OfflineResult<AdminClient>> {
  const { editingId, withCard, profile } = input
  const patch = profileToPatch(profile)

  if (!isTradeLocalFirst()) {
    if (!editingId && withCard) {
      const client = await registerClientAccount({
        ...patch,
        level: 'basic',
        debt: 0,
        bonus: 0,
        debtLimit: 0,
      })
      shadowMirrorPut('client', client.id, client)
      return { offline: false, data: client }
    }
    saveClientProfile(editingId, profile)
    const id = editingId || useClientStore.getState().clients.find(c => c.phone === patch.phone)?.id
    const client = (id && findClient(id)) || useClientStore.getState().clients.slice(-1)[0]
    if (!client) throw new Error('Не удалось сохранить клиента')
    shadowMirrorPut('client', client.id, client)
    return { offline: false, data: client }
  }

  const applyLocal = async () => {
    const clientRef = newClientRef()
    let client: AdminClient

    if (editingId) {
      useClientStore.getState().updateClient(editingId, patch, { skipApi: true })
      client = findClient(editingId)!
      markClientIdentityPending(editingId)
      syncLinkedCardIdentity(client)
    } else {
      const localId = newLocalId('cli')
      const registration = withCard ? newClientRegistrationDefaults() : {}
      client = normalizeClient({
        ...patch,
        ...registration,
        id: localId,
        level: 'basic',
        debt: 0,
        bonus: 0,
        debtLimit: 0,
        orders: 0,
        spent: 0,
        createdAt: new Date().toISOString().slice(0, 10),
      })
      useClientStore.setState(s => ({ clients: [...s.clients, client] }))
    }

    await useOfflineSync.getState().queueOp(
      'client_upsert',
      { clientRef, localId: client.id, client: { ...client } },
      { localId: client.id, clientRef },
    )
    persistClients()
    shadowMirrorPut('client', client.id, client)
    return client
  }

  return raceOp(async () => {
    if (editingId && !isLocalId(editingId)) {
      const remote = await api.updateClient(editingId, { ...patch, clientRef: newClientRef() })
      useClientStore.getState().updateClient(editingId, remote, { skipApi: true })
      const client = findClient(editingId)!
      persistClients()
      shadowMirrorPut('client', client.id, client)
      return client
    }
    if (!editingId && withCard) {
      const client = await registerClientAccount({
        ...patch,
        level: 'basic',
        debt: 0,
        bonus: 0,
        debtLimit: 0,
      })
      shadowMirrorPut('client', client.id, client)
      return client
    }
    saveClientProfile(editingId, profile)
    const client = editingId
      ? findClient(editingId)!
      : useClientStore.getState().clients.find(c => c.phone === patch.phone)!
    shadowMirrorPut('client', client.id, client)
    return client
  }, applyLocal)
}

export async function deleteClientSafe(
  id: string,
  phone?: string,
): Promise<OfflineResult<{ id: string }>> {
  const clientRef = newClientRef()

  if (!isTradeLocalFirst()) {
    if (USE_API) await api.deleteClient(id, phone)
    else useClientStore.getState().removeClient(id)
    return { offline: false, data: { id } }
  }

  const applyLocal = async () => {
    await useOfflineSync.getState().queueOp(
      'client_delete',
      { clientRef, id, phone },
      { clientRef },
    )
    useClientStore.setState(s => ({ clients: s.clients.filter(c => c.id !== id) }))
    persistClients()
    return { id }
  }

  if (isLocalId(id)) {
    const data = await applyLocal()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data }
  }

  return raceOp(async () => {
    await api.deleteClient(id, phone)
    useClientStore.setState(s => ({ clients: s.clients.filter(c => c.id !== id) }))
    persistClients()
    return { id }
  }, applyLocal)
}

/** Блок / разблок клиента. При V2=on — без сети. */
export async function toggleClientBlockSafe(id: string): Promise<OfflineResult<AdminClient>> {
  const client = findClient(id)
  if (!client) throw new Error('Клиент не найден')
  const blocked = !client.blocked

  if (!isTradeLocalFirst()) {
    useClientStore.getState().toggleBlock(id)
    const updated = findClient(id)!
    markClientIdentityPending(id)
    syncLinkedCardIdentity(updated)
    return { offline: false, data: updated }
  }

  const applyLocal = async () => {
    const clientRef = newClientRef()
    useClientStore.getState().updateClient(id, { blocked }, { skipApi: true })
    const updated = findClient(id)!
    markClientIdentityPending(id)
    syncLinkedCardIdentity(updated)
    await useOfflineSync.getState().queueOp(
      'client_upsert',
      { clientRef, localId: id, client: { ...updated } },
      { localId: id, clientRef },
    )
    persistClients()
    shadowMirrorPut('client', id, updated)
    return updated
  }

  return raceOp(async () => {
    const remote = await api.updateClient(id, { blocked, clientRef: newClientRef() })
    useClientStore.getState().updateClient(id, remote, { skipApi: true })
    persistClients()
    const updated = findClient(id)!
    shadowMirrorPut('client', id, updated)
    return updated
  }, applyLocal)
}

/** Выдать карту лояльности. При V2=on — локально + очередь (сервер создаст карту при PATCH). */
export async function provisionLoyaltyCardSafe(client: AdminClient): Promise<OfflineResult<AdminClient>> {
  if (!isTradeLocalFirst()) {
    const updated = await provisionLoyaltyCardForClient(client)
    return { offline: false, data: updated }
  }

  const { useCardStore } = await import('./cardStore')
  const { hydrateCardStore } = await import('./clientCardSync')
  const { normalizeCard, canonicalCardNum } = await import('./cardCrm')
  const { getRegistrationWelcomeBonus } = await import('./loyaltyStatusConfig')

  hydrateCardStore()
  const cardStore = useCardStore.getState()
  let current = findClient(client.id) || normalizeClient(client)
  if (current.card) {
    const linked = cardStore.cards.find(c => c.num === current.card && c.status !== 'unlinked')
    if (linked) return { offline: false, data: current }
  }

  const applyLocal = async () => {
    const clientRef = newClientRef()
    const cards = useCardStore.getState().cards
    const nums = cards.map(c => parseInt(String(c.num).replace(/\D/g, ''), 10)).filter(x => !Number.isNaN(x))
    let next = (nums.length ? Math.max(...nums) : 0) + 1
    const num = `КАКАПО-${String(next).padStart(4, '0')}`
    const key = canonicalCardNum(num)
    const welcome = getRegistrationWelcomeBonus()
    const enriched = normalizeClient({
      ...current,
      ...newClientRegistrationDefaults(),
      card: key,
      bonus: Math.max(Number(current.bonus) || 0, welcome),
    })
    const card = normalizeCard({
      num: key,
      client: enriched.name,
      phone: enriched.phone,
      clientId: enriched.id,
      status: 'active',
      level: enriched.level,
      bonus: enriched.bonus,
      debtLimit: enriched.debtLimit,
      debt: enriched.debt,
      vip: enriched.vip,
      debtEnabled: enriched.debtEnabled,
      issued: new Date().toISOString().slice(0, 10),
    })
    useCardStore.setState(s => ({
      cards: [...s.cards.filter(c => canonicalCardNum(c.num) !== key), card],
    }))
    useClientStore.getState().updateClient(enriched.id, {
      card: key,
      bonus: enriched.bonus,
      level: enriched.level,
      debt: enriched.debt,
      debtEnabled: enriched.debtEnabled,
      debtLimit: enriched.debtLimit,
      vip: enriched.vip,
    }, { skipApi: true })
    const updated = findClient(client.id) || enriched

    await useOfflineSync.getState().queueOp(
      'card_loyalty_patch',
      {
        clientRef,
        num: key,
        clientId: updated.id,
        debt: updated.debt,
        debtEnabled: updated.debtEnabled,
        debtLimit: updated.debtLimit,
        bonus: updated.bonus,
        level: updated.level,
        vip: updated.vip,
        cardPatch: {
          phone: updated.phone,
          client: updated.name,
          clientId: updated.id,
          status: 'active',
          level: updated.level,
          bonus: updated.bonus,
          debt: updated.debt,
          debtLimit: updated.debtLimit,
          vip: updated.vip,
          debtEnabled: updated.debtEnabled,
          allowBonusDecrease: true,
        },
        clientPatch: {
          card: key,
          bonus: updated.bonus,
          level: updated.level,
          debt: updated.debt,
          debtEnabled: updated.debtEnabled,
          debtLimit: updated.debtLimit,
          vip: updated.vip,
        },
      },
      { clientRef },
    )
    persistClients()
    void cacheData('cards', useCardStore.getState().cards)
    shadowMirrorPut('client', updated.id, updated)
    return updated
  }

  return raceOp(async () => {
    const updated = await provisionLoyaltyCardForClient(client)
    return updated
  }, applyLocal)
}
