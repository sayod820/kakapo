/**
 * Входящий синк: GET /sync/changes после flush outbox.
 * Не вызывать, пока в очереди есть незакрытые операции.
 */
import { api } from './api'
import { isOnline } from './offline'
import { getPending, cacheProducts, cacheClients, persistPosSnapshot } from './offline'
import { getSyncCursor, setSyncCursor, entityUpsertMany } from './localEntities'
import { cacheStockLayers } from './stockLayersLocal'
import { appendConflictLog, mergeAppendById, mergeByIdLww, shouldTakeRemoteLww } from './syncConflict'
import type { Product, ProductStockLayer } from './types'
import type { AdminClient } from './clientCrm'
import type { AdminCard } from './cardCrm'

export type SyncPullResult = {
  ok: boolean
  skipped?: 'offline' | 'pending' | 'error'
  cursor?: string
  error?: string
}

export async function pullSyncChanges(opts?: {
  forceFull?: boolean
  /** даже если есть pending — только для явного bootstrap */
  ignorePending?: boolean
}): Promise<SyncPullResult> {
  if (!isOnline()) return { ok: false, skipped: 'offline' }

  if (!opts?.ignorePending) {
    try {
      const pending = await getPending()
      if (pending.some(r => !r.failed)) {
        return { ok: false, skipped: 'pending' }
      }
    } catch { /* ignore */ }
  }

  try {
    const since = opts?.forceFull ? '' : await getSyncCursor()
    const delta = await api.getSyncChanges(since || undefined)

    // Products
    if (Array.isArray(delta.products) && delta.products.length) {
      const { useProducts } = await import('./store')
      const local = useProducts.getState().products || []
      const merged = opts?.forceFull || delta.full
        ? (delta.products as Product[])
        : mergeByIdLww(local, delta.products as Product[], (a, b) => {
          void appendConflictLog({
            kind: 'product',
            id: String(a.id),
            localAt: String((a as any).updatedAtIso || ''),
            remoteAt: String((b as any).updatedAtIso || ''),
            note: 'LWW: взята серверная карточка товара',
          })
        })
      useProducts.setState({ products: merged })
      await cacheProducts(merged)
      await entityUpsertMany(
        'product',
        merged.map(p => ({
          id: p.id,
          data: p,
          updatedAtIso: String((p as any).updatedAtIso || (p as any).updatedAt || delta.cursor),
        })),
      )
    }

    // Categories
    if (Array.isArray(delta.categories)) {
      try {
        const { applyCategoriesLocal, peekCategories } = await import('./useCategories')
        const { cacheCategories } = await import('./offline')
        if (delta.full || opts?.forceFull) {
          applyCategoriesLocal(delta.categories)
          await cacheCategories(delta.categories)
        } else if (delta.categories.length) {
          const local = peekCategories() || []
          const merged = mergeByIdLww(local as any, delta.categories as any)
          applyCategoriesLocal(merged)
          await cacheCategories(merged)
        }
      } catch { /* ignore */ }
    }

    // Clients
    if (Array.isArray(delta.clients) && delta.clients.length) {
      const { useClientStore } = await import('./clientStore')
      const local = useClientStore.getState().clients || []
      const merged = delta.full || opts?.forceFull
        ? (delta.clients as AdminClient[])
        : mergeByIdLww(local, delta.clients as AdminClient[])
      useClientStore.setState({ clients: merged })
      await cacheClients(merged)
    }

    // Cards
    if (Array.isArray(delta.cards) && delta.cards.length) {
      try {
        const { useCardStore } = await import('./cardStore')
        const local = useCardStore.getState().cards || []
        const merged = delta.full || opts?.forceFull
          ? (delta.cards as AdminCard[])
          : mergeByIdLww(local as any, delta.cards as any) as AdminCard[]
        useCardStore.setState({ cards: merged })
      } catch { /* ignore */ }
    }

    // Stock layers
    if (Array.isArray(delta.stockLayers)) {
      if (delta.full || opts?.forceFull || delta.stockLayers.length) {
        let next: ProductStockLayer[]
        if (delta.full || opts?.forceFull) {
          next = delta.stockLayers as ProductStockLayer[]
        } else {
          const { readCachedStockLayers } = await import('./stockLayersLocal')
          const local = await readCachedStockLayers()
          const map = new Map(local.map(l => [`${l.receiptId}:${l.productId}`, l]))
          for (const remote of delta.stockLayers as ProductStockLayer[]) {
            const key = `${remote.receiptId}:${remote.productId}`
            const cur = map.get(key)
            if (!cur || shouldTakeRemoteLww(cur, remote)) map.set(key, remote)
          }
          next = [...map.values()]
        }
        await cacheStockLayers(next)
      }
    }

    // POS snapshot pieces
    const pos = delta.pos
    if (pos) {
      const { usePosStore } = await import('./posStore')
      const cur = usePosStore.getState()
      const patch: Record<string, unknown> = {}

      if (Array.isArray(pos.sales)) {
        patch.sales = delta.full
          ? pos.sales
          : mergeAppendById(cur.sales, pos.sales)
      }
      if (Array.isArray(pos.shifts)) {
        patch.shifts = delta.full
          ? pos.shifts
          : mergeAppendById(cur.shifts, pos.shifts)
      }
      if (Array.isArray(pos.receipts)) {
        patch.receipts = delta.full
          ? pos.receipts
          : mergeAppendById(cur.receipts, pos.receipts)
      }
      if (Array.isArray(pos.writeoffs)) {
        patch.writeoffs = delta.full
          ? pos.writeoffs
          : mergeAppendById(cur.writeoffs, pos.writeoffs)
      }
      if (Array.isArray(pos.revisions)) {
        patch.revisions = delta.full
          ? pos.revisions
          : mergeAppendById(cur.revisions, pos.revisions)
      }
      if (Array.isArray(pos.financeMoves)) {
        patch.financeMoves = delta.full
          ? pos.financeMoves
          : mergeAppendById(cur.financeMoves, pos.financeMoves)
      }
      if (Array.isArray(pos.expenses)) {
        patch.expenses = delta.full
          ? pos.expenses
          : mergeAppendById(cur.expenses, pos.expenses)
      }
      if (Array.isArray(pos.suppliers) && (delta.full || pos.suppliers.length)) {
        patch.suppliers = delta.full
          ? pos.suppliers
          : mergeByIdLww(cur.suppliers, pos.suppliers)
      }
      if (Array.isArray(pos.posPoints) && (delta.full || pos.posPoints.length)) {
        patch.posPoints = delta.full ? pos.posPoints : mergeByIdLww(cur.posPoints, pos.posPoints)
      }
      if (Array.isArray(pos.cashiers) && (delta.full || pos.cashiers.length)) {
        patch.cashiers = delta.full ? pos.cashiers : mergeByIdLww(cur.cashiers, pos.cashiers)
      }
      if (Array.isArray(pos.expiry) && (delta.full || pos.expiry.length)) {
        patch.expiry = delta.full ? pos.expiry : pos.expiry
      }

      if (Object.keys(patch).length) {
        usePosStore.setState(patch as any)
        try { await persistPosSnapshot() } catch { /* ignore */ }
      }
    }

    if (delta.cursor) await setSyncCursor(delta.cursor)
    try {
      const { markLocalSyncAt } = await import('./offlineBootstrap')
      await markLocalSyncAt()
    } catch { /* ignore */ }
    return { ok: true, cursor: delta.cursor }
  } catch (e) {
    return {
      ok: false,
      skipped: 'error',
      error: e instanceof Error ? e.message : 'pull failed',
    }
  }
}
