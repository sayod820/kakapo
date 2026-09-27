'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { USE_API } from '@/lib/config'
import { clearAppDataLocalCacheOnce } from '@/lib/localCache'
import { isKakapoDesktop } from '@/lib/desktopBridge'
import { isTradeAndroidNative } from '@/lib/tradeAndroid'

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

/** Касса живёт на своём useApiSync('pos') + /sync/changes: каталог/акции/рестораны отсюда ей не нужны. */
function isTradeRoute(pathname: string | null) {
  const p = pathname || (typeof window !== 'undefined' ? window.location.pathname : '')
  return p === '/trade' || p.startsWith('/trade/') || p === '/pos' || p.startsWith('/pos/')
}

/** Приложение кассы (ПК/APK) открывает только торговлю — фоновый опрос сайта ему не нужен ни на каком адресе. */
function isKassaApp() {
  if (typeof window === 'undefined') return false
  if (isKakapoDesktop() || isTradeAndroidNative()) return true
  return /kakapo-trade-desktop/i.test(navigator.userAgent || '')
}

function skipSitePolling(pathname: string | null) {
  return isKassaApp() || isTradeRoute(pathname) || isTradeRoute(typeof window !== 'undefined' ? window.location.pathname : null)
}

export default function ApiSyncProvider({ children, mode = 'catalog' }: Props) {
  const pathname = usePathname()
  const skip = skipSitePolling(pathname)

  useEffect(() => {
    void purgeServiceWorkers()
  }, [])

  useEffect(() => {
    if (!USE_API) return
    clearAppDataLocalCacheOnce()
    if (skip) return
    let cancelled = false

    const load = async () => {
      if (skipSitePolling(null)) return
      try {
        const { useProducts, usePromos, useRestaurants, useOrders } = await import('@/lib/store')
        const { syncCourierStoresFromApi } = await import('@/lib/courierStore')
        const { syncLoyaltyStatusConfigFromApi } = await import('@/lib/loyaltyStatusConfig')
        const tasks: Promise<unknown>[] = [
          syncLoyaltyStatusConfigFromApi(),
          useProducts.getState().fetchProducts(),
          usePromos.getState().fetchPromos(),
          useRestaurants.getState().fetchRestaurants(),
          syncCourierStoresFromApi(),
        ]
        if (mode !== 'catalog') {
          const { syncClientsFromApi } = await import('@/lib/clientStore')
          const { syncCardsFromApi } = await import('@/lib/cardStore')
          tasks.push(syncClientsFromApi(), syncCardsFromApi())
        }
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
  }, [mode, skip])

  return <>{children}</>
}
