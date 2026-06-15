'use client'
import { create } from 'zustand'
import { USE_API } from './config'
import { api } from './api'
import {
  DEFAULT_ADMIN_ASSEMBLERS,
  normalizeAssembler,
  type AdminAssembler,
} from './assemblerTeam'

const ASSEMBLERS_KEY = 'kakapo-assemblers'

function loadAssemblers(): AdminAssembler[] {
  if (typeof window === 'undefined') return DEFAULT_ADMIN_ASSEMBLERS
  try {
    const raw = localStorage.getItem(ASSEMBLERS_KEY)
    if (!raw) return DEFAULT_ADMIN_ASSEMBLERS
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_ADMIN_ASSEMBLERS
    return parsed.map(a => normalizeAssembler(a))
  } catch {
    return DEFAULT_ADMIN_ASSEMBLERS
  }
}

function saveAssemblers(list: AdminAssembler[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(ASSEMBLERS_KEY, JSON.stringify(list))
  } catch { /* quota */ }
}

function mergeAssemblerLists(primary: AdminAssembler[], secondary: AdminAssembler[]): AdminAssembler[] {
  const byId = new Map<string, AdminAssembler>()
  for (const a of secondary) byId.set(a.id, normalizeAssembler(a))
  for (const a of primary) {
    const prev = byId.get(a.id)
    byId.set(a.id, normalizeAssembler(prev ? { ...prev, ...a, id: a.id } : a))
  }
  return Array.from(byId.values())
}

function nextAssemblerId(list: AdminAssembler[]): string {
  const nums = list.map(a => parseInt(a.id.replace(/\D/g, ''), 10)).filter(n => !Number.isNaN(n))
  const n = (nums.length ? Math.max(...nums) : 0) + 1
  return `A-${String(n).padStart(2, '0')}`
}

interface AssemblerTeamStore {
  assemblers: AdminAssembler[]
  hydrated: boolean
  hydrate: () => void
  reload: () => void
  setAssemblers: (list: AdminAssembler[]) => void
  addAssembler: (data: Omit<AdminAssembler, 'id' | 'ordersToday' | 'ordersTotal' | 'week' | 'rating'>) => AdminAssembler
  updateAssembler: (id: string, patch: Partial<AdminAssembler>) => void
  toggleBlock: (id: string) => void
  fetchFromApi: () => Promise<void>
}

export const useAssemblerTeamStore = create<AssemblerTeamStore>((set, get) => ({
  assemblers: DEFAULT_ADMIN_ASSEMBLERS,
  hydrated: false,
  hydrate: () => {
    set({ assemblers: loadAssemblers(), hydrated: true })
  },
  reload: () => {
    set({ assemblers: loadAssemblers() })
  },
  setAssemblers: list => {
    const assemblers = list.map(a => normalizeAssembler(a))
    saveAssemblers(assemblers)
    set({ assemblers })
  },
  addAssembler: data => {
    const assemblers = get().assemblers
    const row = normalizeAssembler({
      ...data,
      id: nextAssemblerId(assemblers),
      rating: 5,
      ordersToday: 0,
      ordersTotal: 0,
      week: 0,
    })
    const next = [...assemblers, row]
    saveAssemblers(next)
    if (USE_API) api.createAssembler(row).catch(console.error)
    set({ assemblers: next })
    return row
  },
  updateAssembler: (id, patch) => set(s => {
    const assemblers = s.assemblers.map(a => (a.id === id ? normalizeAssembler({ ...a, ...patch, id }) : a))
    saveAssemblers(assemblers)
    if (USE_API) api.updateAssembler(id, patch).catch(console.error)
    return { assemblers }
  }),
  toggleBlock: id => {
    const a = get().assemblers.find(x => x.id === id)
    if (!a) return
    get().updateAssembler(id, { blocked: !a.blocked, status: !a.blocked ? 'offline' : a.status })
  },
  fetchFromApi: async () => {
    const local = loadAssemblers()
    if (!USE_API) {
      set({ assemblers: local, hydrated: true })
      return
    }
    try {
      const apiList = await api.getAssemblers()
      const remote = apiList.length ? apiList.map(a => normalizeAssembler(a)) : DEFAULT_ADMIN_ASSEMBLERS
      const assemblers = mergeAssemblerLists(local, remote)
      saveAssemblers(assemblers)
      set({ assemblers, hydrated: true })
    } catch (e) {
      console.error(e)
      set({ assemblers: local, hydrated: true })
    }
  },
}))

export function useAssemblerTeam() {
  return useAssemblerTeamStore(s => s.assemblers)
}

export async function syncAssemblerTeamFromApi() {
  await useAssemblerTeamStore.getState().fetchFromApi()
}

export function hydrateAssemblerTeamStore() {
  useAssemblerTeamStore.getState().hydrate()
}
