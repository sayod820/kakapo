'use client'
import { useEffect } from 'react'
import { useAuth } from '@/lib/store'
import { USE_API } from '@/lib/config'

type Props = { children: React.ReactNode; mode?: 'all' | 'assembler' | 'courier' | 'catalog' }

export default function ApiSyncProvider({ children, mode = 'catalog' }: Props) {
  const hydrate = useAuth(s => s.hydrate)

  useEffect(() => {
    hydrate()
  }, [hydrate])

  useEffect(() => {
    if (!USE_API) return
    let cancelled = false

    const load = async () => {
      const { useProducts, useRestaurants, useOrders } = await import('@/lib/store')
      const { syncCourierStoresFromApi } = await import('@/lib/courierStore')
      const tasks = [
        useProducts.getState().fetchProducts(),
        useRestaurants.getState().fetchRestaurants(),
        syncCourierStoresFromApi(),
      ]
      if (mode === 'assembler') tasks.push(useOrders.getState().fetchAssemblerOrders())
      else if (mode === 'courier') tasks.push(useOrders.getState().fetchCourierOrders())
      else if (mode === 'all') tasks.push(useOrders.getState().fetchOrders())
      if (!cancelled) await Promise.all(tasks)
    }

    load()
    const id = setInterval(load, 12000)
    return () => { cancelled = true; clearInterval(id) }
  }, [mode])

  return <>{children}</>
}
