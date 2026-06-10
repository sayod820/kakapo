'use client'
import { useMemo } from 'react'
import { USE_API } from './config'
import { useProducts, useRestaurants } from './store'
import { enrichProducts, enrichRestaurants } from './enrichCatalog'

export function useCatalogData(fallbackProds: any[], fallbackRests: any[]) {
  const products = useProducts(s => s.products)
  const restaurants = useRestaurants(s => s.restaurants)
  return useMemo(() => ({
    prods: USE_API && products.length > 0
      ? enrichProducts(products, fallbackProds)
      : fallbackProds,
    restaurants: USE_API && restaurants.length > 0
      ? enrichRestaurants(restaurants, fallbackRests)
      : fallbackRests,
  }), [products, restaurants, fallbackProds, fallbackRests])
}
