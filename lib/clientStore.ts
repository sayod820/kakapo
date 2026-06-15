'use client'
import { create } from 'zustand'
import { USE_API } from './config'
import { api } from './api'
import {
  DEFAULT_ADMIN_CLIENTS,
  normalizeClient,
  type AdminClient,
} from './clientCrm'

const CLIENTS_KEY = 'kakapo-clients'

function loadClients(): AdminClient[] {
  if (typeof window === 'undefined') return DEFAULT_ADMIN_CLIENTS
  try {
    const raw = localStorage.getItem(CLIENTS_KEY)
    if (!raw) return DEFAULT_ADMIN_CLIENTS
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_ADMIN_CLIENTS
    return parsed.map(c => normalizeClient(c))
  } catch {
    return DEFAULT_ADMIN_CLIENTS
  }
}

function saveClients(list: AdminClient[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(CLIENTS_KEY, JSON.stringify(list))
  } catch { /* quota */ }
}

function mergeClientLists(primary: AdminClient[], secondary: AdminClient[]): AdminClient[] {
  const byId = new Map<string, AdminClient>()
  for (const c of secondary) byId.set(c.id, normalizeClient(c))
  for (const c of primary) {
    const prev = byId.get(c.id)
    byId.set(c.id, normalizeClient(prev ? { ...prev, ...c, id: c.id } : c))
  }
  return Array.from(byId.values())
}

function nextClientId(list: AdminClient[]): string {
  const nums = list.map(c => parseInt(c.id.replace(/\D/g, ''), 10)).filter(n => !Number.isNaN(n))
  const n = (nums.length ? Math.max(...nums) : 0) + 1
  return `U-${String(n).padStart(2, '0')}`
}

interface ClientStore {
  clients: AdminClient[]
  hydrated: boolean
  hydrate: () => void
  reload: () => void
  setClients: (list: AdminClient[]) => void
  addClient: (data: Omit<AdminClient, 'id' | 'orders' | 'spent' | 'createdAt' | 'lastOrderAt'>) => AdminClient
  updateClient: (id: string, patch: Partial<AdminClient>) => void
  toggleBlock: (id: string) => void
  fetchFromApi: () => Promise<void>
}

export const useClientStore = create<ClientStore>((set, get) => ({
  clients: DEFAULT_ADMIN_CLIENTS,
  hydrated: false,
  hydrate: () => {
    set({ clients: loadClients(), hydrated: true })
  },
  reload: () => {
    set({ clients: loadClients() })
  },
  setClients: list => {
    const clients = list.map(c => normalizeClient(c))
    saveClients(clients)
    set({ clients })
  },
  addClient: data => {
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
    if (USE_API) api.createClient(row).catch(console.error)
    set({ clients: next })
    return row
  },
  updateClient: (id, patch) => set(s => {
    const clients = s.clients.map(c => (c.id === id ? normalizeClient({ ...c, ...patch, id }) : c))
    saveClients(clients)
    if (USE_API) api.updateClient(id, patch).catch(console.error)
    return { clients }
  }),
  toggleBlock: id => {
    const c = get().clients.find(x => x.id === id)
    if (!c) return
    get().updateClient(id, { blocked: !c.blocked })
  },
  fetchFromApi: async () => {
    const local = loadClients()
    if (!USE_API) {
      set({ clients: local, hydrated: true })
      return
    }
    try {
      const apiList = await api.getClients()
      const remote = apiList.length ? apiList.map(c => normalizeClient(c)) : DEFAULT_ADMIN_CLIENTS
      const clients = mergeClientLists(local, remote)
      saveClients(clients)
      set({ clients, hydrated: true })
    } catch (e) {
      console.error(e)
      set({ clients: local, hydrated: true })
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
