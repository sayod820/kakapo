/**
 * UI ← SQLite only. После того как SYNC-канал записал дельту в базу.
 * Никакого HTTP / applySyncDelta с сервера.
 */
import { readCachedProducts, readCachedClients, readCachedData } from './offline'

let reloadInFlight: Promise<void> | null = null
let pendingScopes: Set<string> | null = null
let pendingTimer: ReturnType<typeof setTimeout> | null = null

export type SqliteReloadScope =
  | 'products'
  | 'clients'
  | 'cards'
  | 'categories'
  | 'pos'
  | 'stockLayers'
  | 'loyalty'
  | 'all'

function scheduleDeferredReload() {
  if (pendingTimer) return
  pendingTimer = setTimeout(() => {
    pendingTimer = null
    const scopes = pendingScopes ? ([...pendingScopes] as SqliteReloadScope[]) : undefined
    pendingScopes = null
    void reloadStoresFromSqlite(scopes?.includes('all') ? ['all'] : scopes)
  }, 120)
}

export async function reloadStoresFromSqlite(scopes?: SqliteReloadScope[]): Promise<void> {
  if (typeof window === 'undefined') return

  // Не роняем апдейт: если уже идёт reload — копим scopes и повторим
  if (reloadInFlight) {
    if (!pendingScopes) pendingScopes = new Set()
    if (!scopes?.length || scopes.includes('all')) pendingScopes.add('all')
    else for (const s of scopes) pendingScopes.add(s)
    scheduleDeferredReload()
    return reloadInFlight
  }

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
          const { mergeClientLoyaltyIfRecent } = await import('./loyaltySaveGuard')
          const local = useClientStore.getState().clients || []
          const byId = new Map(local.map(c => [String(c.id), c]))
          const merged = (cached as any[]).map(row => {
            const prev = byId.get(String(row.id))
              || local.find(x => String(x.phone || '') === String(row.phone || ''))
            return mergeClientLoyaltyIfRecent(row as any, prev)
          })
          for (const lc of local) {
            if (!merged.some(m => String(m.id) === String(lc.id))) merged.push(lc as any)
          }
          useClientStore.setState({ clients: merged as any, hydrated: true, apiReady: true })
          // НЕ пишем merge обратно в SQLite — иначе локальная защита отравляет серверные апдейты
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
          const { mergeCardLoyaltyIfRecent, findLocalCard } = await import('./loyaltySaveGuard')
          const local = useCardStore.getState().cards || []
          const merged = cached.map(row => mergeCardLoyaltyIfRecent(row as any, findLocalCard(local, row.num)))
          useCardStore.setState({ cards: merged as any, hydrated: true, apiReady: true })
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
          const { readCachedStockLayers, cacheStockLayersAndSyncCatalog } = await import('./stockLayersLocal')
          const layers = await readCachedStockLayers()
          if (layers?.length) await cacheStockLayersAndSyncCatalog(layers)
        } catch { /* ignore */ }
      }
      if (all || want.has('loyalty')) {
        try {
          const desk = (await import('./desktopBridge')).getKakapoDesktop()
          let raw: unknown = null
          if (desk?.localDbKvGet) {
            try { raw = await desk.localDbKvGet('loyalty_status_config') } catch { /* ignore */ }
          }
          if (!raw) {
            try {
              const s = localStorage.getItem('kakapo-loyalty-status-config')
              if (s) raw = JSON.parse(s)
            } catch { /* ignore */ }
          }
          if (raw && typeof raw === 'object') {
            const { LOYALTY_STATUS_CONFIG_EVENT } = await import('./loyaltyStatusConfig')
            try {
              localStorage.setItem('kakapo-loyalty-status-config', JSON.stringify(raw))
            } catch { /* ignore */ }
            window.dispatchEvent(new CustomEvent(LOYALTY_STATUS_CONFIG_EVENT, { detail: raw }))
          }
        } catch { /* ignore */ }
      }
    } finally {
      reloadInFlight = null
      if (pendingScopes && pendingScopes.size) scheduleDeferredReload()
    }
  })()
  return reloadInFlight
}
