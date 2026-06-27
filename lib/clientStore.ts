'use client'
import { create } from 'zustand'
import { emitCrmSync } from './clientProfileSync'
import { USE_API } from './config'
import { api } from './api'
import { ensureArray } from './apiGuards'
import {
  DEFAULT_ADMIN_CLIENTS,
  normalizeClient,
  isClientPurged,
  phonesMatch,
  type AdminClient,
} from './clientCrm'
import { markClientLoyaltySaved, mergeClientLoyaltyIfRecent } from './loyaltySaveGuard'
import { isPhoneDeleted, mergeDeletedPhonesFromServer, unmarkPhoneDeleted } from './clientTombstones'
import { clearAppDataLocalCache, persistAppDataLocally } from './localCache'

const CLIENTS_KEY = 'kakapo-clients'
const PENDING_CLIENT_MS = 120_000
/** Клиенты, созданные локально и ещё не подтверждённые API */
const pendingClientSync = new Map<string, number>()

export function markPendingClientSync(id: string) {
  if (!id) return
  pendingClientSync.set(id, Date.now())
}

function isPendingClientSync(id: string): boolean {
  const t = pendingClientSync.get(id)
  if (!t) return false
  if (Date.now() - t > PENDING_CLIENT_MS) {
    pendingClientSync.delete(id)
    return false
  }
  return true
}

function clearPendingClientSync(id: string) {
  pendingClientSync.delete(id)
}

/** @deprecated use clearAppDataLocalCache */
export function clearCrmLocalCache() {
  clearAppDataLocalCache()
}

function readLocalClientsCache(): AdminClient[] {
  if (USE_API) return []
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(CLIENTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.length) return []
    return parsed.map(c => normalizeClient(c))
  } catch {
    return []
  }
}

function loadClients(): AdminClient[] {
  if (USE_API) return []
  if (typeof window === 'undefined') return DEFAULT_ADMIN_CLIENTS
  const cached = readLocalClientsCache()
  return cached.length ? cached : DEFAULT_ADMIN_CLIENTS
}

function saveClients(list: AdminClient[], opts?: { skipEmit?: boolean }) {
  if (typeof window === 'undefined') return
  if (!persistAppDataLocally()) {
    if (!opts?.skipEmit) emitCrmSync()
    return
  }
  try {
    localStorage.setItem(CLIENTS_KEY, JSON.stringify(list))
    emitCrmSync()
  } catch { /* quota */ }
}

function filterVisibleClients(list: AdminClient[]): AdminClient[] {
  return list.filter(c => !isClientPurged(c) && !isPhoneDeleted(c.phone))
}

function nextClientId(list: AdminClient[]): string {
  const nums = list.map(c => parseInt(c.id.replace(/\D/g, ''), 10)).filter(n => !Number.isNaN(n))
  const n = (nums.length ? Math.max(...nums) : 0) + 1
  return `U-${String(n).padStart(2, '0')}`
}

interface ClientStore {
  clients: AdminClient[]
  hydrated: boolean
  apiReady: boolean
  apiSyncing: boolean
  apiError: string
  hydrate: () => void
  reload: () => void
  applyVisibleFilter: () => void
  setClients: (list: AdminClient[]) => void
  addClient: (data: Omit<AdminClient, 'id' | 'orders' | 'spent' | 'createdAt' | 'lastOrderAt'>, opts?: { skipApi?: boolean }) => AdminClient
  updateClient: (id: string, patch: Partial<AdminClient>, opts?: { skipApi?: boolean }) => void
  removeClient: (id: string) => void
  toggleBlock: (id: string) => void
  fetchFromApi: () => Promise<void>
}

export const useClientStore = create<ClientStore>((set, get) => ({
  clients: USE_API ? [] : DEFAULT_ADMIN_CLIENTS,
  hydrated: false,
  apiReady: !USE_API,
  apiSyncing: false,
  apiError: '',
  hydrate: () => {
    if (USE_API) return
    set({ clients: filterVisibleClients(loadClients()), hydrated: true, apiReady: true })
  },
  reload: () => {
    set({ clients: filterVisibleClients(loadClients()) })
  },
  applyVisibleFilter: () => {
    set(s => ({ clients: filterVisibleClients(s.clients) }))
  },
  setClients: list => {
    const clients = filterVisibleClients(list.map(c => normalizeClient(c)))
    saveClients(clients)
    set({ clients })
  },
  addClient: (data, opts) => {
    const clients = get().clients
    if (data.phone) unmarkPhoneDeleted(data.phone)
    const row = normalizeClient({
      ...data,
      id: nextClientId(clients),
      orders: 0,
      spent: 0,
      createdAt: new Date().toISOString().slice(0, 10),
    })
    const next = [...clients, row]
    saveClients(next)
    markPendingClientSync(row.id)
    if (USE_API && !opts?.skipApi) {
      api.createClient(row)
        .then(created => {
          const normalized = normalizeClient(created)
          unmarkPhoneDeleted(normalized.phone)
          clearPendingClientSync(row.id)
          set(s => ({
            clients: filterVisibleClients(
              s.clients.map(c => (c.id === row.id ? normalized : c)),
            ),
          }))
          emitCrmSync()
        })
        .catch(console.error)
    }
    set({ clients: next })
    return row
  },
  updateClient: (id, patch, opts) => set(s => {
    const clients = s.clients.map(c => (c.id === id ? normalizeClient({ ...c, ...patch, id }) : c))
    saveClients(clients, { skipEmit: opts?.skipApi })
    if (USE_API && !opts?.skipApi) api.updateClient(id, patch).catch(console.error)
    return { clients }
  }),
  removeClient: id => {
    const clients = get().clients.filter(c => c.id !== id)
    saveClients(clients)
    if (USE_API) api.deleteClient(id).catch(console.error)
    set({ clients })
  },
  toggleBlock: id => {
    const c = get().clients.find(x => x.id === id)
    if (!c) return
    get().updateClient(id, { blocked: !c.blocked })
  },
  fetchFromApi: async () => {
    if (!USE_API) {
      set({ clients: filterVisibleClients(loadClients()), hydrated: true, apiReady: true })
      return
    }
    const prev = get().clients
    set({ apiSyncing: true, apiError: '' })
    try {
      clearAppDataLocalCache()
      const deletedMeta = await api.getDeletedPhones()
      mergeDeletedPhonesFromServer(deletedMeta.phones || [])
      const apiList = ensureArray<AdminClient>(await api.getClients(), 'clients')
        .map(c => normalizeClient(c))
        .filter(c => !isClientPurged(c) && !isPhoneDeleted(c.phone))
      const local = prev
      const apiIds = new Set(apiList.map(c => String(c.id)))
      const merged = apiList.map(c => {
        const normalized = c
        clearPendingClientSync(normalized.id)
        const lc = local.find(x => x.id === normalized.id)
          || local.find(x => phonesMatch(x.phone, normalized.phone))
        return mergeClientLoyaltyIfRecent(normalized, lc)
      })
      for (const lc of local) {
        if (isClientPurged(lc) || isPhoneDeleted(lc.phone)) continue
        if (!isPendingClientSync(lc.id)) continue
        if (apiIds.has(lc.id)) continue
        if (merged.some(m => m.id === lc.id || phonesMatch(m.phone, lc.phone))) continue
        merged.push(normalizeClient(lc))
      }
      const clients = filterVisibleClients(merged)
      set({ clients, hydrated: true, apiReady: true, apiSyncing: false, apiError: '' })
      emitCrmSync()
    } catch (e) {
      console.error(e)
      const msg = e instanceof Error ? e.message : 'Не удалось загрузить клиентов'
      set({ clients: prev, hydrated: true, apiReady: true, apiSyncing: false, apiError: msg })
    }
  },
}))

if (typeof window !== 'undefined') {
  window.addEventListener('kakapo-deleted-phone', () => {
    useClientStore.getState().applyVisibleFilter()
  })
}

export function useClients() {
  return useClientStore(s => s.clients)
}

export async function syncClientsFromApi() {
  await useClientStore.getState().fetchFromApi()
}

export function refilterClientsStore() {
  useClientStore.getState().applyVisibleFilter()
}

export { markClientLoyaltySaved }

export function hydrateClientStore() {
  if (USE_API) {
    void useClientStore.getState().fetchFromApi()
    return
  }
  useClientStore.getState().hydrate()
}
