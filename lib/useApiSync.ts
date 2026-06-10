'use client'
import { useEffect, useRef } from 'react'
import { USE_API } from './config'
import { useProducts, useRestaurants, useOrders } from './store'
import { syncCourierStoresFromApi } from './courierStore'

export type SyncMode = 'all' | 'assembler' | 'courier' | 'catalog'

const INTERVAL_MS = 12000

export function useApiSync(mode: SyncMode = 'all') {
  const started = useRef(false)

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
