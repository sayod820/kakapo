'use client'
import { useEffect } from 'react'
import { USE_API } from '@/lib/config'
import { clearAppDataLocalCacheOnce } from '@/lib/localCache'

type Props = { children: React.ReactNode; mode?: 'all' | 'assembler' | 'courier' | 'catalog' }

export default function ApiSyncProvider({ children, mode = 'catalog' }: Props) {
  // Регистрируем service worker — интерфейс открывается офлайн после первого онлайн-визита
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* не поддерживается */ })
    }
    if (document.readyState === 'complete') onLoad()
    else window.addEventListener('load', onLoad, { once: true })
    return () => window.removeEventListener('load', onLoad)
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
