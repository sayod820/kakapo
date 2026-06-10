'use client'
import { createContext, useContext } from 'react'
import { useCatalogData } from '@/lib/useCatalogData'

type Catalog = { prods: any[]; restaurants: any[] }

const Ctx = createContext<Catalog>({ prods: [], restaurants: [] })

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
