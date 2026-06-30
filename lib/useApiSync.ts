'use client'
import { useEffect, useRef } from 'react'
import { USE_API } from './config'
import { useProducts, useRestaurants, useOrders, usePromos, mergeOrderFields, applyAdminPins } from './store'
import { syncCourierStoresFromApi } from './courierStore'
import { syncClientsFromApi } from './clientStore'
import { syncCardsFromApi } from './cardStore'
import { syncAssemblerTeamFromApi } from './assemblerTeamStore'
import { syncPushFromApi } from './pushStore'
import { clearAppDataLocalCacheOnce } from './localCache'
import { useWebSocket } from './ws'

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
    if (msg.event === 'loyalty_update') {
      void syncClientsFromApi()
      void syncCardsFromApi()
      return
    }
    if (msg.event === 'courier_wallet_update') {
      void syncCourierStoresFromApi()
      return
    }
    if (msg.order) {
      const pins = useOrders.getState().orderAdminPins
      const pin = pins[msg.order.id]
      const order = pin
        ? { ...msg.order, ...pin, status: pin.status ?? msg.order.status }
        : msg.order
      useOrders.setState(s => {
        const exists = s.orders.some(o => o.id === order.id)
        const next = exists
          ? s.orders.map(o => o.id === order.id ? mergeOrderFields(o, order, pin) : o)
          : [order, ...s.orders]
        return { orders: applyAdminPins(next, pins) }
      })
      return
    }
    const orders = useOrders.getState()
    if (mode === 'assembler') orders.fetchAssemblerOrders()
    else if (mode === 'courier') orders.fetchCourierOrders()
    else if (mode === 'restaurant') orders.fetchRestaurantOrders()
    else if (mode === 'all') orders.fetchOrders()
  })

  useEffect(() => {
    if (!USE_API) return

    const load = async () => {
      try {
        if (mode === 'all') {
          await Promise.allSettled([syncClientsFromApi(), syncCardsFromApi()])
        }
        const { syncLoyaltyStatusConfigFromApi } = await import('./loyaltyStatusConfig')
        const tasks: Promise<unknown>[] = [
          syncLoyaltyStatusConfigFromApi(),
          useProducts.getState().fetchProducts(),
          usePromos.getState().fetchPromos(),
          useRestaurants.getState().fetchRestaurants(),
          syncCourierStoresFromApi(),
        ]
        if (mode === 'all') {
          tasks.push(
            syncAssemblerTeamFromApi(),
            syncPushFromApi(),
          )
        }
        if (mode === 'assembler') tasks.push(useOrders.getState().fetchAssemblerOrders())
        else if (mode === 'courier') tasks.push(useOrders.getState().fetchCourierOrders())
        else if (mode === 'restaurant') tasks.push(useOrders.getState().fetchRestaurantOrders())
        else if (mode === 'all') tasks.push(useOrders.getState().fetchOrders())
        await Promise.allSettled(tasks)
      } catch (e) {
        console.error('[kakapo] useApiSync load failed', e)
      }
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
  clearAppDataLocalCacheOnce()
  void import('./loyaltyStatusConfig').then(m => m.syncLoyaltyStatusConfigFromApi()).catch(() => {})
  useProducts.getState().fetchProducts()
  usePromos.getState().fetchPromos()
  useRestaurants.getState().fetchRestaurants()
  useOrders.getState().fetchOrders()
  void syncCourierStoresFromApi()
  void syncClientsFromApi()
  void syncCardsFromApi()
  void syncAssemblerTeamFromApi()
  void syncPushFromApi()
}

let startedGuard = false
