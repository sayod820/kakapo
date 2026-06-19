'use client'
import { create } from 'zustand'
import { emitCrmSync } from './clientProfileSync'
import { USE_API } from './config'
import { api } from './api'
import {
  DEFAULT_ADMIN_CLIENTS,
  normalizeClient,
  normalizePhone,
  isClientPurged,
  type AdminClient,
} from './clientCrm'
import { isPhoneDeleted } from './clientTombstones'

const CLIENTS_KEY = 'kakapo-clients'

function readLocalClientsCache(): AdminClient[] {
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

function saveClients(list: AdminClient[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(CLIENTS_KEY, JSON.stringify(list))
    emitCrmSync()
  } catch { /* quota */ }
}

function filterVisibleClients(list: AdminClient[]): AdminClient[] {
  return list.filter(c => !isClientPurged(c) && !isPhoneDeleted(c.phone))
}

/** API — сервер главный; локально только новые, ещё не на backend */
function mergeClientsForApi(local: AdminClient[], remote: AdminClient[]): AdminClient[] {
  const remoteFiltered = filterVisibleClients(remote)
  const localFiltered = filterVisibleClients(local)
  const remoteIds = new Set(remoteFiltered.map(c => c.id))
  const remotePhones = new Set(remoteFiltered.map(c => normalizePhone(c.phone)).filter(Boolean))
  const localOnly = localFiltered.filter(c => {
    if (remoteIds.has(c.id)) return false
    const key = normalizePhone(c.phone)
    if (key && remotePhones.has(key)) return false
    return true
  })
  return [...remoteFiltered, ...localOnly]
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
  hydrate: () => void
  reload: () => void
  setClients: (list: AdminClient[]) => void
  addClient: (data: Omit<AdminClient, 'id' | 'orders' | 'spent' | 'createdAt' | 'lastOrderAt'>, opts?: { skipApi?: boolean }) => AdminClient
  updateClient: (id: string, patch: Partial<AdminClient>) => void
  removeClient: (id: string) => void
  toggleBlock: (id: string) => void
  fetchFromApi: () => Promise<void>
}

export const useClientStore = create<ClientStore>((set, get) => ({
  clients: USE_API ? [] : DEFAULT_ADMIN_CLIENTS,
  hydrated: false,
  apiReady: !USE_API,
  hydrate: () => {
    if (USE_API) return
    set({ clients: filterVisibleClients(loadClients()), hydrated: true, apiReady: true })
  },
  reload: () => {
    set({ clients: filterVisibleClients(loadClients()) })
  },
  setClients: list => {
    const clients = filterVisibleClients(list.map(c => normalizeClient(c)))
    saveClients(clients)
    set({ clients })
  },
  addClient: (data, opts) => {
    const clients = get().clients
    const row = normalizeClient({
      ...data,
      id: nextClientId(clients),
      orders: 0,
      spent: 0,
      createdAt: new Date().toISOString().slice(0, 10),
    })
    const next = [...clients, row]
    saveClients(next)
    if (USE_API && !opts?.skipApi) api.createClient(row).catch(console.error)
    set({ clients: next })
    return row
  },
  updateClient: (id, patch) => set(s => {
    const clients = s.clients.map(c => (c.id === id ? normalizeClient({ ...c, ...patch, id }) : c))
    saveClients(clients)
    if (USE_API) api.updateClient(id, patch).catch(console.error)
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
    try {
      const apiList = await api.getClients()
      const remote = filterVisibleClients(apiList.map(c => normalizeClient(c)))
      const localOnly = filterVisibleClients(readLocalClientsCache())
      const clients = mergeClientsForApi(localOnly, remote)
      saveClients(clients)
      set({ clients, hydrated: true, apiReady: true })
    } catch (e) {
      console.error(e)
      const fallback = filterVisibleClients(readLocalClientsCache())
      set({ clients: fallback, hydrated: true, apiReady: true })
    }
  },
}))

export function useClients() {
  return useClientStore(s => s.clients)
}

export async function syncClientsFromApi() {
  await useClientStore.getState().fetchFromApi()
}

export function hydrateClientStore() {
  useClientStore.getState().hydrate()
}
