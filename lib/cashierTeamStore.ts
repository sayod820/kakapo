'use client'
import { create } from 'zustand'
import { USE_API } from './config'
import { api } from './api'
import {
  DEFAULT_ADMIN_CASHIERS,
  normalizeCashier,
  type AdminCashier,
} from './cashierTeam'
import { clearAppDataLocalCache, persistAppDataLocally } from './localCache'

const CASHIERS_KEY = 'kakapo-cashiers'

function loadCashiers(): AdminCashier[] {
  if (USE_API) return []
  if (typeof window === 'undefined') return DEFAULT_ADMIN_CASHIERS
  try {
    const raw = localStorage.getItem(CASHIERS_KEY)
    if (!raw) return DEFAULT_ADMIN_CASHIERS
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_ADMIN_CASHIERS
    return parsed.map(c => normalizeCashier(c))
  } catch {
    return DEFAULT_ADMIN_CASHIERS
  }
}

function saveCashiers(list: AdminCashier[]) {
  if (typeof window === 'undefined' || !persistAppDataLocally()) return
  try {
    localStorage.setItem(CASHIERS_KEY, JSON.stringify(list))
  } catch { /* quota */ }
}

function nextCashierId(list: AdminCashier[]): string {
  const nums = list.map(c => parseInt(c.id.replace(/\D/g, ''), 10)).filter(n => !Number.isNaN(n))
  const n = (nums.length ? Math.max(...nums) : 0) + 1
  return `PC-${String(n).padStart(2, '0')}`
}

interface CashierTeamStore {
  cashiers: AdminCashier[]
  hydrated: boolean
  apiReady: boolean
  hydrate: () => void
  reload: () => void
  addCashier: (data: Omit<AdminCashier, 'id' | 'salesToday' | 'salesTotal'>) => AdminCashier
  updateCashier: (id: string, patch: Partial<AdminCashier>) => void
  toggleBlock: (id: string) => void
  fetchFromApi: () => Promise<void>
}

export const useCashierTeamStore = create<CashierTeamStore>((set, get) => ({
  cashiers: USE_API ? [] : DEFAULT_ADMIN_CASHIERS,
  hydrated: false,
  apiReady: !USE_API,
  hydrate: () => {
    if (USE_API) return
    set({ cashiers: loadCashiers(), hydrated: true, apiReady: true })
  },
  reload: () => {
    if (USE_API) return
    set({ cashiers: loadCashiers() })
  },
  addCashier: data => {
    const cashiers = get().cashiers
    const row = normalizeCashier({
      ...data,
      id: nextCashierId(cashiers),
      salesToday: 0,
      salesTotal: 0,
    })
    const next = [...cashiers, row]
    saveCashiers(next)
    if (USE_API) api.createCashier(row).catch(console.error)
    set({ cashiers: next })
    return row
  },
  updateCashier: (id, patch) => set(s => {
    const cashiers = s.cashiers.map(c => (c.id === id ? normalizeCashier({ ...c, ...patch, id }) : c))
    saveCashiers(cashiers)
    if (USE_API) api.updateCashier(id, patch).catch(console.error)
    return { cashiers }
  }),
  toggleBlock: id => {
    const c = get().cashiers.find(x => x.id === id)
    if (!c) return
    get().updateCashier(id, { blocked: !c.blocked })
  },
  fetchFromApi: async () => {
    if (!USE_API) {
      set({ cashiers: loadCashiers(), hydrated: true, apiReady: true })
      return
    }
    try {
      clearAppDataLocalCache()
      const apiList = await api.getCashiers()
      const cashiers = apiList.map(c => normalizeCashier(c))
      set({ cashiers, hydrated: true, apiReady: true })
    } catch (e) {
      console.error(e)
      const prev = get().cashiers
      set({
        cashiers: prev,
        hydrated: true,
        apiReady: prev.length > 0,
      })
    }
  },
}))

export function useCashierTeam() {
  return useCashierTeamStore(s => s.cashiers)
}

export async function syncCashierTeamFromApi() {
  await useCashierTeamStore.getState().fetchFromApi()
}

export function hydrateCashierTeamStore() {
  if (USE_API) {
    void useCashierTeamStore.getState().fetchFromApi()
    return
  }
  useCashierTeamStore.getState().hydrate()
}
