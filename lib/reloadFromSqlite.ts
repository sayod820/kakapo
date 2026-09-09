/**
 * UI ← SQLite only. После того как SYNC-канал записал дельту в базу.
 * Никакого HTTP / applySyncDelta с сервера.
 */
import { readCachedProducts, readCachedClients, readCachedData } from './offline'

let reloadInFlight: Promise<void> | null = null
let lastReloadAt = 0
const RELOAD_MIN_MS = 400

export type SqliteReloadScope =
  | 'products'
  | 'clients'
  | 'cards'
  | 'categories'
  | 'pos'
  | 'stockLayers'
  | 'all'

export async function reloadStoresFromSqlite(scopes?: SqliteReloadScope[]): Promise<void> {
  if (typeof window === 'undefined') return
  const now = Date.now()
  if (reloadInFlight) return reloadInFlight
  if (now - lastReloadAt < RELOAD_MIN_MS) return

  const want = new Set(scopes?.length ? scopes : ['all'])
  const all = want.has('all')

  reloadInFlight = (async () => {
    try {
      if (all || want.has('products')) {
        const cached = await readCachedProducts()
        if (cached?.length) {
          const { useProducts } = await import('./store')
          useProducts.setState({ products: cached, loaded: true })
        }
      }
      if (all || want.has('clients')) {
        let cached = await readCachedClients()
        if (!cached?.length) cached = await readCachedData('clients')
        if (cached?.length) {
          const { useClientStore } = await import('./clientStore')
          useClientStore.setState({ clients: cached as any, hydrated: true, apiReady: true })
        }
      }
      if (all || want.has('cards')) {
        let cached = await readCachedData<any[]>('cards')
        if (!cached?.length) {
          const desk = (await import('./desktopBridge')).getKakapoDesktop()
          if (desk?.localDbKvGet) {
            try {
              const alt = await desk.localDbKvGet('cards')
              if (Array.isArray(alt) && alt.length) cached = alt
            } catch { /* ignore */ }
          }
        }
        if (cached?.length) {
          const { useCardStore } = await import('./cardStore')
          useCardStore.setState({ cards: cached, hydrated: true, apiReady: true })
        }
      }
      if (all || want.has('categories')) {
        let cached = await readCachedData<any[]>('categories')
        if (!cached?.length) {
          const desk = (await import('./desktopBridge')).getKakapoDesktop()
          if (desk?.localDbKvGet) {
            try {
              const alt = await desk.localDbKvGet('categories')
              if (Array.isArray(alt) && alt.length) cached = alt
            } catch { /* ignore */ }
          }
        }
        if (cached?.length) {
          const { applyCategoriesLocal } = await import('./useCategories')
          applyCategoriesLocal(cached)
        }
      }
      if (all || want.has('pos')) {
        const cached = await readCachedData<Record<string, unknown>>('pos_snapshot')
        let snap = cached
        if (!snap || typeof snap !== 'object') {
          const desk = (await import('./desktopBridge')).getKakapoDesktop()
          if (desk?.localDbKvGet) {
            try {
              const alt = await desk.localDbKvGet('pos_snapshot')
              if (alt && typeof alt === 'object') snap = alt as Record<string, unknown>
            } catch { /* ignore */ }
          }
        }
        if (snap && typeof snap === 'object') {
          const { usePosStore } = await import('./posStore')
          const cur = usePosStore.getState()
          const remoteSales = Array.isArray(snap.sales) ? snap.sales as any[] : null
          let sales = cur.sales
          if (remoteSales) {
            const localOff = cur.sales.filter(s => String(s.id || '').startsWith('off-'))
            const remoteIds = new Set(remoteSales.map(s => String(s.id)))
            const keepOff = localOff.filter(s => !remoteIds.has(String(s.id)))
            sales = [...keepOff, ...remoteSales]
          }
          usePosStore.setState({
            ...snap,
            sales,
            apiReady: true,
            apiSyncing: false,
          } as any)
        }
      }
      if (all || want.has('stockLayers')) {
        try {
          const { readCachedStockLayers } = await import('./stockLayersLocal')
          await readCachedStockLayers()
        } catch { /* ignore */ }
      }
      lastReloadAt = Date.now()
    } finally {
      reloadInFlight = null
    }
  })()
  return reloadInFlight
}
