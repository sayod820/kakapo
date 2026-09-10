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
    ])
    // After products in memory — apply durable layers → stock (no catalog rewrite)
    await hydrateStockLayers()
  })()
  return hydrating
}

async function hydrateProducts() {
  const cached = await readCachedProducts()
  if (!cached || !cached.length) return
  const { useProducts } = await import('./store')
  if (!useProducts.getState().products.length) {
    useProducts.setState({ products: cached as Product[], loaded: true })
  }
  // Поднять object URL из IndexedDB (в т.ч. если каталог уже пришёл с API)
  try {
    const { warmOfflinePhotoCache, schedulePhotoPrefetchFromProducts } = await import('./photoOfflineCache')
    const list = useProducts.getState().products
    const source = list.length ? list : cached
    await warmOfflinePhotoCache(source)
    // Недостающие миниатюры — в фоне; уже на диске не качаем
    schedulePhotoPrefetchFromProducts(source)
  } catch { /* ignore */ }
}

async function hydratePos() {
  const cached = await readCachedData<Partial<PosStore>>('pos_snapshot')
  if (cached) {
    const { usePosStore } = await import('./posStore')
    if (!usePosStore.getState().apiReady) {
      usePosStore.setState({ ...cached, apiReady: true, apiSyncing: false })
    }
  }
  // Phase 5: authoritative sale/shift mirrors + pending outbox beat a lagging snapshot
  try {
    const { reconcileLocalSalesFromDurables } = await import('./localSaleAtomic')
    await reconcileLocalSalesFromDurables()
  } catch { /* ignore */ }
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
    const { readCachedStockLayers, applyCachedLayersToProductStock } = await import('./stockLayersLocal')
    await readCachedStockLayers()
    // Effective stock from durable layers (catalog cache may lag after Phase 8)
    await applyCachedLayersToProductStock()
  } catch { /* ignore */ }
}
