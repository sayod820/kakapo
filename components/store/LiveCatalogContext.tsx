'use client'
import { createContext, useContext } from 'react'
import { useCatalogData } from '@/lib/useCatalogData'

type Catalog = { prods: any[]; restaurants: any[]; catalogReady: boolean; restaurantsReady: boolean; promosReady: boolean }

const Ctx = createContext<Catalog>({ prods: [], restaurants: [], catalogReady: false, restaurantsReady: false, promosReady: false })

export function LiveCatalogProvider({
  fallbackProds,
  fallbackRests,
  children,
}: {
  fallbackProds: any[]
  fallbackRests: any[]
  children: React.ReactNode
}) {
  const value = useCatalogData(fallbackProds, fallbackRests)
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useLiveCatalog() {
  return useContext(Ctx)
}
