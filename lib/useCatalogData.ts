'use client'
import { useMemo } from 'react'
import { USE_API } from './config'
import { useProducts, useRestaurants, usePromos } from './store'
import { enrichProducts, enrichRestaurants } from './enrichCatalog'
import { applyActiveProductPromos } from './productPromos'

export function useCatalogData(fallbackProds: any[], fallbackRests: any[]) {
  const products = useProducts(s => s.products)
  const productsLoaded = useProducts(s => s.loaded)
  const promos = usePromos(s => s.promos)
  const promosLoaded = usePromos(s => s.loaded)
  const restaurants = useRestaurants(s => s.restaurants)
  const restaurantsLoaded = useRestaurants(s => s.loaded)
  return useMemo(() => {
    const catalogReady = !USE_API || productsLoaded
    const restaurantsReady = !USE_API || restaurantsLoaded
    const promosReady = !USE_API || promosLoaded
    const rawProds = USE_API
      ? (productsLoaded ? enrichProducts(products, fallbackProds) : [])
      : fallbackProds
    const prods = applyActiveProductPromos(rawProds, promos)
    return {
      prods,
      catalogReady,
      restaurantsReady,
      promosReady,
      restaurants: USE_API
        ? (restaurantsLoaded ? enrichRestaurants(restaurants, fallbackRests) : [])
        : fallbackRests,
    }
  }, [products, productsLoaded, promos, promosLoaded, restaurants, restaurantsLoaded, fallbackProds, fallbackRests])
}
