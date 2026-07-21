'use client'
import { useEffect } from 'react'
import { USE_API } from '@/lib/config'
import { clearAppDataLocalCacheOnce } from '@/lib/localCache'

type Props = { children: React.ReactNode; mode?: 'all' | 'assembler' | 'courier' | 'catalog' }

/** Старый SW кэшировал портал и подменял страницы — снимаем его у всех и чистим кэш. */
async function purgeServiceWorkers() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map(r => r.unregister()))
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    }
  } catch { /* ignore */ }
}

export default function ApiSyncProvider({ children, mode = 'catalog' }: Props) {
  useEffect(() => {
    void purgeServiceWorkers()
  }, [])

  useEffect(() => {
    if (!USE_API) return
    clearAppDataLocalCacheOnce()
    let cancelled = false

    const load = async () => {
      try {
        const { useProducts, useRestaurants, useOrders } = await import('@/lib/store')
        const { syncCourierStoresFromApi } = await import('@/lib/courierStore')
        const { syncClientsFromApi } = await import('@/lib/clientStore')
        const { syncCardsFromApi } = await import('@/lib/cardStore')
        const { syncLoyaltyStatusConfigFromApi } = await import('@/lib/loyaltyStatusConfig')
        const tasks = [
          syncLoyaltyStatusConfigFromApi(),
          useProducts.getState().fetchProducts(),
          useRestaurants.getState().fetchRestaurants(),
          syncCourierStoresFromApi(),
          syncClientsFromApi(),
          syncCardsFromApi(),
        ]
        if (mode === 'assembler') tasks.push(useOrders.getState().fetchAssemblerOrders())
        else if (mode === 'courier') tasks.push(useOrders.getState().fetchCourierOrders())
        else if (mode === 'all') tasks.push(useOrders.getState().fetchOrders())
        if (!cancelled) await Promise.allSettled(tasks)
      } catch (e) {
        console.error('[kakapo] ApiSyncProvider load failed', e)
      }
    }

    load()
    const id = setInterval(load, 12000)
    return () => { cancelled = true; clearInterval(id) }
  }, [mode])

  return <>{children}</>
}
