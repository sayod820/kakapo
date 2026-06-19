'use client'
import { create } from 'zustand'
import { USE_API } from './config'
import { api } from './api'
import {
  DEFAULT_ADMIN_ASSEMBLERS,
  normalizeAssembler,
  type AdminAssembler,
} from './assemblerTeam'
import { clearAppDataLocalCache, persistAppDataLocally } from './localCache'

const ASSEMBLERS_KEY = 'kakapo-assemblers'

function loadAssemblers(): AdminAssembler[] {
  if (USE_API) return []
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
  if (typeof window === 'undefined' || !persistAppDataLocally()) return
  try {
    localStorage.setItem(ASSEMBLERS_KEY, JSON.stringify(list))
  } catch { /* quota */ }
}

function nextAssemblerId(list: AdminAssembler[]): string {
  const nums = list.map(a => parseInt(a.id.replace(/\D/g, ''), 10)).filter(n => !Number.isNaN(n))
  const n = (nums.length ? Math.max(...nums) : 0) + 1
  return `A-${String(n).padStart(2, '0')}`
}

interface AssemblerTeamStore {
  assemblers: AdminAssembler[]
  hydrated: boolean
  apiReady: boolean
  hydrate: () => void
  reload: () => void
  setAssemblers: (list: AdminAssembler[]) => void
  addAssembler: (data: Omit<AdminAssembler, 'id' | 'ordersToday' | 'ordersTotal' | 'week' | 'rating'>) => AdminAssembler
  updateAssembler: (id: string, patch: Partial<AdminAssembler>) => void
  toggleBlock: (id: string) => void
  fetchFromApi: () => Promise<void>
}

export const useAssemblerTeamStore = create<AssemblerTeamStore>((set, get) => ({
  assemblers: USE_API ? [] : DEFAULT_ADMIN_ASSEMBLERS,
  hydrated: false,
  apiReady: !USE_API,
  hydrate: () => {
    if (USE_API) return
    set({ assemblers: loadAssemblers(), hydrated: true, apiReady: true })
  },
  reload: () => {
    if (USE_API) return
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
    if (!USE_API) {
      set({ assemblers: loadAssemblers(), hydrated: true, apiReady: true })
      return
    }
    try {
      clearAppDataLocalCache()
      const apiList = await api.getAssemblers()
      const assemblers = apiList.map(a => normalizeAssembler(a))
      set({ assemblers, hydrated: true, apiReady: true })
    } catch (e) {
      console.error(e)
      const prev = get().assemblers
      set({
        assemblers: prev,
        hydrated: true,
        apiReady: prev.length > 0,
      })
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
  if (USE_API) {
    void useAssemblerTeamStore.getState().fetchFromApi()
    return
  }
  useAssemblerTeamStore.getState().hydrate()
}
