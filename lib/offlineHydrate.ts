// ════════════════════════════════════════════════
// KAKAPO — гидратация из офлайн-кэша
// Холодный старт без интернета: разделы показывают данные
// сразу, не дожидаясь таймаута сетевых запросов
// ════════════════════════════════════════════════
import { readCachedProducts, readCachedData } from './offline'
import type { Product } from './types'
import type { AdminClient } from './clientCrm'
import type { AdminCard } from './cardCrm'
import type { PosStore } from './posStore'

let hydrating: Promise<void> | null = null

/**
 * Заполняет сторы из кэша, но только те, что ещё пустые:
 * если ответ сервера пришёл раньше, он остаётся источником правды.
 */
export function hydrateOfflineCaches(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (hydrating) return hydrating
  hydrating = (async () => {
    await Promise.allSettled([
      hydrateProducts(),
      hydratePos(),
      hydrateClients(),
      hydrateCards(),
      hydrateCategories(),
      hydrateStockLayers(),
    ])
  })()
  return hydrating
}

async function hydrateProducts() {
  const cached = await readCachedProducts()
  if (!cached || !cached.length) return
  const { useProducts } = await import('./store')
  if (useProducts.getState().products.length) return
  useProducts.setState({ products: cached as Product[], loaded: true })
}

async function hydratePos() {
  const cached = await readCachedData<Partial<PosStore>>('pos_snapshot')
  if (!cached) return
  const { usePosStore } = await import('./posStore')
  if (usePosStore.getState().apiReady) return
  usePosStore.setState({ ...cached, apiReady: true, apiSyncing: false })
}

async function hydrateClients() {
  const cached = await readCachedData<AdminClient[]>('clients')
  if (!cached || !cached.length) return
  const { useClientStore } = await import('./clientStore')
  if (useClientStore.getState().clients.length) return
  useClientStore.setState({ clients: cached, hydrated: true, apiReady: true })
}

async function hydrateCards() {
  const cached = await readCachedData<AdminCard[]>('cards')
  if (!cached || !cached.length) return
  const { useCardStore } = await import('./cardStore')
  if (useCardStore.getState().cards.length) return
  useCardStore.setState({ cards: cached, hydrated: true, apiReady: true })
}

async function hydrateCategories() {
  const cached = await readCachedData<import('./types').Category[]>('categories')
  if (!cached || !cached.length) return
  const { applyCategoriesLocal, peekCategories } = await import('./useCategories')
  // Не затираем уже загруженные с API
  const current = peekCategories()
  if (current.length && current.some(c => Number(c.id) > 0)) return
  applyCategoriesLocal(cached)
}

async function hydrateStockLayers() {
  try {
    const { readCachedStockLayers } = await import('./stockLayersLocal')
    await readCachedStockLayers()
  } catch { /* ignore */ }
}
