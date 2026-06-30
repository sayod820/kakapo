'use client'
import { create } from 'zustand'
import { USE_API } from './config'
import { api } from './api'
import {
  DEFAULT_ADMIN_COURIERS,
  normalizeCourier,
  type AdminCourier,
} from './courierTeam'
import { nextCourierAccountNumber } from './courierAccount'
import { clearAppDataLocalCache, persistAppDataLocally } from './localCache'

const COURIERS_KEY = 'kakapo-couriers'

function loadCouriers(): AdminCourier[] {
  if (USE_API) return []
  if (typeof window === 'undefined') return DEFAULT_ADMIN_COURIERS
  try {
    const raw = localStorage.getItem(COURIERS_KEY)
    if (!raw) return DEFAULT_ADMIN_COURIERS
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_ADMIN_COURIERS
    return parsed.map(c => normalizeCourier(c))
  } catch {
    return DEFAULT_ADMIN_COURIERS
  }
}

function saveCouriers(list: AdminCourier[]) {
  if (typeof window === 'undefined' || !persistAppDataLocally()) return
  try {
    localStorage.setItem(COURIERS_KEY, JSON.stringify(list))
  } catch { /* quota */ }
}

function nextCourierId(list: AdminCourier[]): string {
  const nums = list.map(c => parseInt(c.id.replace(/\D/g, ''), 10)).filter(n => !Number.isNaN(n))
  const n = (nums.length ? Math.max(...nums) : 0) + 1
  return `C-${String(n).padStart(2, '0')}`
}

interface CourierTeamStore {
  couriers: AdminCourier[]
  hydrated: boolean
  apiReady: boolean
  hydrate: () => void
  reload: () => void
  setCouriers: (list: AdminCourier[]) => void
  addCourier: (data: Omit<AdminCourier, 'id' | 'orders' | 'today' | 'week' | 'rating'>) => AdminCourier
  updateCourier: (id: string, patch: Partial<AdminCourier>) => void
  toggleBlock: (id: string) => void
  depositBalance: (id: string, amount: number, note?: string) => Promise<{ balance: number; added: number }>
  fetchFromApi: () => Promise<void>
}

export const useCourierTeamStore = create<CourierTeamStore>((set, get) => ({
  couriers: USE_API ? [] : DEFAULT_ADMIN_COURIERS,
  hydrated: false,
  apiReady: !USE_API,
  hydrate: () => {
    if (USE_API) return
    set({ couriers: loadCouriers(), hydrated: true, apiReady: true })
  },
  reload: () => {
    if (USE_API) return
    set({ couriers: loadCouriers() })
  },
  setCouriers: list => {
    const couriers = list.map(c => normalizeCourier(c))
    saveCouriers(couriers)
    set({ couriers })
  },
  addCourier: data => {
    const couriers = get().couriers
    const row = normalizeCourier({
      ...data,
      id: nextCourierId(couriers),
      account: nextCourierAccountNumber(couriers),
      rating: 5,
      orders: 0,
      today: 0,
      week: 0,
    })
    const next = [...couriers, row]
    saveCouriers(next)
    if (USE_API) api.createCourier(row).catch(console.error)
    set({ couriers: next })
    return row
  },
  updateCourier: (id, patch) => set(s => {
    const couriers = s.couriers.map(c => (c.id === id ? normalizeCourier({ ...c, ...patch, id }) : c))
    saveCouriers(couriers)
    if (USE_API) api.updateCourier(id, patch).catch(console.error)
    return { couriers }
  }),
  toggleBlock: id => {
    const c = get().couriers.find(x => x.id === id)
    if (!c) return
    get().updateCourier(id, { blocked: !c.blocked, status: !c.blocked ? 'offline' : c.status })
  },
  depositBalance: async (id, amount, note) => {
    const add = Math.max(0, Number(amount) || 0)
    if (add <= 0) throw new Error('Укажите сумму пополнения')
    if (USE_API) {
      const res = await api.depositCourierBalance(id, add, note)
      get().updateCourier(id, { balance: res.balance })
      return { balance: res.balance, added: res.added }
    }
    const c = get().couriers.find(x => x.id === id)
    if (!c) throw new Error('Курьер не найден')
    const balance = Math.round(((Number(c.balance) || 0) + add) * 100) / 100
    get().updateCourier(id, { balance })
    return { balance, added: add }
  },
  fetchFromApi: async () => {
    if (!USE_API) {
      set({ couriers: loadCouriers(), hydrated: true, apiReady: true })
      return
    }
    try {
      clearAppDataLocalCache()
      const apiList = await api.getCouriers()
      const couriers = apiList.map(c => normalizeCourier(c))
      set({ couriers, hydrated: true, apiReady: true })
    } catch (e) {
      console.error(e)
      const prev = get().couriers
      set({
        couriers: prev,
        hydrated: true,
        apiReady: prev.length > 0,
      })
    }
  },
}))

export function useCourierTeam() {
  return useCourierTeamStore(s => s.couriers)
}

export async function syncCourierTeamFromApi() {
  await useCourierTeamStore.getState().fetchFromApi()
}

export function hydrateCourierTeamStore() {
  if (USE_API) {
    void useCourierTeamStore.getState().fetchFromApi()
    return
  }
  useCourierTeamStore.getState().hydrate()
}

export function reloadCourierTeamStore() {
  useCourierTeamStore.getState().reload()
}
