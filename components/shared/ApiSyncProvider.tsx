'use client'
import { useEffect } from 'react'
import { useAuth } from '@/lib/store'
import { USE_API } from '@/lib/config'
import { clearAppDataLocalCacheOnce } from '@/lib/localCache'

type Props = { children: React.ReactNode; mode?: 'all' | 'assembler' | 'courier' | 'catalog' }

export default function ApiSyncProvider({ children, mode = 'catalog' }: Props) {
  const hydrate = useAuth(s => s.hydrate)

  useEffect(() => {
    hydrate()
  }, [hydrate])

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
