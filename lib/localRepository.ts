/**
 * Phase 4 lite — тонкий репозиторий поверх сторов / SQLite.
 *
 * На desktop / trade Android SQLite (KV cache) — source of truth;
 * zustand — projection для UI (CashierModule без переписывания).
 */
import { localFirstOp, type OfflineResult } from './localFirst'
import { usePosStore } from './posStore'
import { useProducts } from './store'
import { isKakapoDesktop } from './desktopBridge'
import { isTradeAndroidNative } from './tradeAndroid'

let projectedOnceThisSession = false

/** Desktop или trade Android — локальный кэш/SQLite первичен. */
export function isSqlitePrimary(): boolean {
  return isKakapoDesktop() || isTradeAndroidNative()
}

/** Каталог: SQLite/KV при primary, иначе zustand. */
export async function readProducts() {
  if (isSqlitePrimary()) {
    try {
      const { readCachedProducts } = await import('./offline')
      const cached = await readCachedProducts()
      if (cached && cached.length) return cached
    } catch { /* fall through */ }
  }
  return useProducts.getState().products || []
}

/** Чеки: pos_snapshot из кэша при primary, иначе zustand. */
export async function readSales() {
  if (isSqlitePrimary()) {
    try {
      const { readCachedData } = await import('./offline')
      const snap = await readCachedData<{ sales?: unknown[] }>('pos_snapshot')
      if (Array.isArray(snap?.sales) && snap.sales.length) return snap.sales
    } catch { /* fall through */ }
  }
  return usePosStore.getState().sales || []
}

/** Клиенты: кэш при primary, иначе clientStore. */
export async function readClients() {
  if (isSqlitePrimary()) {
    try {
      const { readCachedData } = await import('./offline')
      const cached = await readCachedData<unknown[]>('clients')
      if (Array.isArray(cached) && cached.length) return cached
    } catch { /* fall through */ }
  }
  try {
    const { useClientStore } = await import('./clientStore')
    return useClientStore.getState().clients || []
  } catch {
    return []
  }
}

/**
 * Hydrate zustand из SQLite/KV.
 * light — только products + pos snapshot (после flush/pull).
 * force — даже если сторы уже заполнены (cold path desktop once/session).
 */
export async function projectSqliteToStores(opts?: {
  light?: boolean
  force?: boolean
}): Promise<void> {
  if (typeof window === 'undefined') return
  if (!isSqlitePrimary()) return

  const force = !!opts?.force || (!projectedOnceThisSession && isKakapoDesktop())
  const light = !!opts?.light

  try {
    const { readCachedProducts, readCachedData } = await import('./offline')

    const products = await readCachedProducts()
    if (products && products.length) {
      const cur = useProducts.getState().products || []
      if (force || !cur.length) {
        useProducts.setState({ products: products as any, loaded: true })
      }
    }

    const pos = await readCachedData<Record<string, unknown>>('pos_snapshot')
    if (pos && typeof pos === 'object') {
      const ready = usePosStore.getState().apiReady
      if (force || !ready || light) {
        usePosStore.setState({
          ...pos,
          apiReady: true,
          apiSyncing: false,
        } as any)
      }
    }

    if (!light) {
      const clients = await readCachedData<unknown[]>('clients')
      if (Array.isArray(clients) && clients.length) {
        const { useClientStore } = await import('./clientStore')
        const cur = useClientStore.getState().clients || []
        if (force || !cur.length) {
          useClientStore.setState({ clients: clients as any, hydrated: true, apiReady: true })
        }
      }
    }

    projectedOnceThisSession = true
  } catch { /* ignore */ }
}

/**
 * Local-first запись: локальный apply + очередь + отложенный sync.
 * Не дублирует бизнес-логику кассы — обёртка над localFirstOp.
 */
export function writeLocalFirst<T>(
  localApply: () => Promise<T> | T,
): Promise<OfflineResult<T>> {
  return localFirstOp(localApply)
}
