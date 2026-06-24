'use client'
import { useMemo } from 'react'
import { USE_API } from './config'
import { useProducts, useRestaurants, usePromos } from './store'
import { enrichProducts, enrichRestaurants } from './enrichCatalog'
import { applyActiveProductPromos } from './productPromos'

export function useCatalogData(fallbackProds: any[], fallbackRests: any[]) {
  const products = useProducts(s => s.products)
  const promos = usePromos(s => s.promos)
  const restaurants = useRestaurants(s => s.restaurants)
  return useMemo(() => {
    const catalogReady = !USE_API || products.length > 0
    const rawProds = USE_API
      ? enrichProducts(products.length > 0 ? products : fallbackProds, fallbackProds)
      : fallbackProds
    const prods = applyActiveProductPromos(rawProds, promos)
    return {
      prods,
      catalogReady,
      restaurants: USE_API
        ? (restaurants.length > 0 ? enrichRestaurants(restaurants, fallbackRests) : fallbackRests)
        : fallbackRests,
    }
  }, [products, promos, restaurants, fallbackProds, fallbackRests])
}
