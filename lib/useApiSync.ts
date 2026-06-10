'use client'
import { useEffect, useRef } from 'react'
import { USE_API } from './config'
import { useProducts, useRestaurants, useOrders, mergeOrderFields } from './store'
import { syncCourierStoresFromApi } from './courierStore'
import { useWebSocket } from './ws'
import { normalizeOrder } from './orderParts'

export type SyncMode = 'all' | 'assembler' | 'courier' | 'restaurant' | 'catalog'

const INTERVAL_MS = 12000

function wsRoleForMode(mode: SyncMode) {
  if (mode === 'assembler') return 'assembler' as const
  if (mode === 'courier') return 'courier' as const
  if (mode === 'restaurant') return 'restaurant' as const
  return 'admin' as const
}

export function useApiSync(mode: SyncMode = 'all') {
  const started = useRef(false)

  useWebSocket(wsRoleForMode(mode), (msg) => {
    if (!USE_API) return
    const orders = useOrders.getState()
    if (mode === 'assembler') orders.fetchAssemblerOrders()
    else if (mode === 'courier') orders.fetchCourierOrders()
    else if (mode === 'restaurant') orders.fetchRestaurantOrders()
    else if (mode === 'all') orders.fetchOrders()
    if (msg.order) {
      const normalized = normalizeOrder(msg.order)
      useOrders.setState(s => {
        const exists = s.orders.some(o => o.id === normalized.id)
        const next = exists
          ? s.orders.map(o => o.id === normalized.id ? mergeOrderFields(o, normalized) : o)
          : [normalized, ...s.orders]
        return { orders: next }
      })
    }
  })

  useEffect(() => {
    if (!USE_API) return

    const load = async () => {
      const tasks: Promise<void>[] = [
        useProducts.getState().fetchProducts(),
        useRestaurants.getState().fetchRestaurants(),
        syncCourierStoresFromApi(),
      ]
      if (mode === 'assembler') tasks.push(useOrders.getState().fetchAssemblerOrders())
      else if (mode === 'courier') tasks.push(useOrders.getState().fetchCourierOrders())
      else if (mode === 'restaurant') tasks.push(useOrders.getState().fetchRestaurantOrders())
      else if (mode === 'all') tasks.push(useOrders.getState().fetchOrders())
      await Promise.all(tasks)
    }

    load()
    const id = setInterval(load, INTERVAL_MS)
    return () => clearInterval(id)
  }, [mode])
}

/** Однократная загрузка при старте (layout) */
export function hydrateAllFromApi() {
  if (!USE_API || startedGuard) return
  startedGuard = true
  useProducts.getState().fetchProducts()
  useRestaurants.getState().fetchRestaurants()
  useOrders.getState().fetchOrders()
  syncCourierStoresFromApi()
}

let startedGuard = false
