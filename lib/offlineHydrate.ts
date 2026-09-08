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
import { isKakapoDesktop } from './desktopBridge'
import { isTradeAndroidNative } from './tradeAndroid'

let hydrating: Promise<void> | null = null

/**
 * Заполняет сторы из кэша.
 * На desktop/android (preferLocal) — кэш первичен даже если стор уже частично
 * заполнен пустым ответом API.
 */
export function hydrateOfflineCaches(opts?: { preferLocal?: boolean }): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (hydrating) return hydrating
  const preferLocal = opts?.preferLocal === true
    || isKakapoDesktop()
    || isTradeAndroidNative()
  hydrating = (async () => {
    await Promise.allSettled([
      hydrateProducts(preferLocal),
      hydratePos(preferLocal),
      hydrateClients(preferLocal),
      hydrateCards(preferLocal),
      hydrateCategories(preferLocal),
      hydrateStockLayers(),
    ])
    if (preferLocal) {
      try {
        const { projectSqliteToStores } = await import('./localRepository')
        await projectSqliteToStores({ force: true })
      } catch { /* ignore */ }
    }
  })().finally(() => {
    hydrating = null
  })
  return hydrating
}

async function hydrateProducts(preferLocal: boolean) {
  const cached = await readCachedProducts()
  if (!cached || !cached.length) return
  const { useProducts } = await import('./store')
  const cur = useProducts.getState().products
  if (!cur.length || (preferLocal && cached.length >= cur.length)) {
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

async function hydratePos(preferLocal: boolean) {
  const cached = await readCachedData<Partial<PosStore>>('pos_snapshot')
  if (!cached) return
  const { usePosStore } = await import('./posStore')
  const st = usePosStore.getState()
  if (st.apiReady && !preferLocal) return
  if (preferLocal || !st.apiReady) {
    usePosStore.setState({ ...cached, apiReady: true, apiSyncing: false })
  }
}

async function hydrateClients(preferLocal: boolean) {
  const cached = await readCachedData<AdminClient[]>('clients')
  if (!cached || !cached.length) return
  const { useClientStore } = await import('./clientStore')
  const cur = useClientStore.getState().clients
  if (cur.length && !preferLocal) return
  if (!cur.length || (preferLocal && cached.length >= cur.length)) {
    useClientStore.setState({ clients: cached, hydrated: true, apiReady: true })
  }
}

async function hydrateCards(preferLocal: boolean) {
  const cached = await readCachedData<AdminCard[]>('cards')
  if (!cached || !cached.length) return
  const { useCardStore } = await import('./cardStore')
  const cur = useCardStore.getState().cards
  if (cur.length && !preferLocal) return
  if (!cur.length || (preferLocal && cached.length >= cur.length)) {
    useCardStore.setState({ cards: cached, hydrated: true, apiReady: true })
  }
}

async function hydrateCategories(preferLocal: boolean) {
  const cached = await readCachedData<import('./types').Category[]>('categories')
  if (!cached || !cached.length) return
  const { applyCategoriesLocal, peekCategories } = await import('./useCategories')
  const current = peekCategories()
  if (current.length && current.some(c => Number(c.id) > 0) && !preferLocal) return
  if (!current.length || preferLocal) {
    applyCategoriesLocal(cached)
  }
}

async function hydrateStockLayers() {
  try {
    const { readCachedStockLayers } = await import('./stockLayersLocal')
    await readCachedStockLayers()
  } catch { /* ignore */ }
}
