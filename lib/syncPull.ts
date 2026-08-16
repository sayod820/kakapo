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

    const del = Array.isArray(delta.deletes) ? delta.deletes : []
    const delOf = (kind: string) => del.filter(d => d.kind === kind).map(d => String(d.id))
    const dropById = <T extends { id?: string | number }>(list: T[], ids: string[]): T[] => {
      if (!ids.length) return list
      const s = new Set(ids)
      return (list || []).filter(row => !s.has(String(row?.id ?? '')))
    }

    // Products
    {
      const { useProducts } = await import('./store')
      let merged = useProducts.getState().products || []
      if (Array.isArray(delta.products) && delta.products.length) {
        merged = opts?.forceFull || delta.full
          ? (delta.products as Product[])
          : mergeByIdLww(merged, delta.products as Product[], (a, b) => {
            void appendConflictLog({
              kind: 'product',
              id: String(a.id),
              localAt: String((a as any).updatedAtIso || ''),
              remoteAt: String((b as any).updatedAtIso || ''),
              note: 'LWW: взята серверная карточка товара',
            })
          })
      }
      merged = dropById(merged, delOf('product'))
      if ((delta.products && delta.products.length) || delOf('product').length) {
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
    }

    // Categories
    if (Array.isArray(delta.categories)) {
      try {
        const { applyCategoriesLocal, peekCategories } = await import('./useCategories')
        const { cacheCategories } = await import('./offline')
        if (delta.full || opts?.forceFull) {
          const list = dropById(delta.categories as any, delOf('category'))
          applyCategoriesLocal(list)
          await cacheCategories(list)
        } else if (delta.categories.length) {
          const local = peekCategories() || []
          const merged = dropById(mergeByIdLww(local as any, delta.categories as any), delOf('category'))
          applyCategoriesLocal(merged)
          await cacheCategories(merged)
        } else if (delOf('category').length) {
          const local = peekCategories() || []
          const merged = dropById(local as any, delOf('category'))
          applyCategoriesLocal(merged)
          await cacheCategories(merged)
        }
      } catch { /* ignore */ }
    }

    // Clients — не затираем долг/бонусы, пока касса ещё не отправила очередь
    {
      const { useClientStore } = await import('./clientStore')
      const { mergeClientLoyaltyIfRecent } = await import('./loyaltySaveGuard')
      const local = useClientStore.getState().clients || []
      let merged = local
      if (Array.isArray(delta.clients) && delta.clients.length) {
        const incoming = delta.full || opts?.forceFull
          ? (delta.clients as AdminClient[])
          : mergeByIdLww(local, delta.clients as AdminClient[])
        merged = incoming.map(row => {
          const prev = local.find(x => String(x.id) === String(row.id))
          return mergeClientLoyaltyIfRecent(row, prev)
        })
      }
      merged = dropById(merged, delOf('client'))
      if ((delta.clients && delta.clients.length) || delOf('client').length) {
        useClientStore.setState({ clients: merged })
        await cacheClients(merged)
      }
    }

    // Cards
    if ((Array.isArray(delta.cards) && delta.cards.length) || delOf('card').length) {
      try {
        const { useCardStore } = await import('./cardStore')
        const { cacheData } = await import('./offline')
        const { mergeCardLoyaltyIfRecent, findLocalCard } = await import('./loyaltySaveGuard')
        const local = useCardStore.getState().cards || []
        let merged = local
        if (Array.isArray(delta.cards) && delta.cards.length) {
          const incoming = delta.full || opts?.forceFull
            ? (delta.cards as AdminCard[])
            : mergeByIdLww(local as any, delta.cards as any) as AdminCard[]
          merged = incoming.map(row => mergeCardLoyaltyIfRecent(row, findLocalCard(local, row.num)))
        }
        merged = dropById(merged, delOf('card'))
        useCardStore.setState({ cards: merged })
        await cacheData('cards', merged)
      } catch { /* ignore */ }
    }

    // Stock layers — полный список открытых партий (исчерпанные не приходят)
    if (Array.isArray(delta.stockLayers) && (delta.stockLayersReplace || delta.full || opts?.forceFull || delta.stockLayers.length)) {
      const next = (delta.full || opts?.forceFull || delta.stockLayersReplace)
        ? (delta.stockLayers as ProductStockLayer[])
        : null
      if (next) {
        await cacheStockLayers(next)
      } else {
        const { readCachedStockLayers } = await import('./stockLayersLocal')
        const local = await readCachedStockLayers()
        const map = new Map(local.map(l => [`${l.receiptId}:${l.productId}`, l]))
        for (const remote of delta.stockLayers as ProductStockLayer[]) {
          const key = `${remote.receiptId}:${remote.productId}`
          const cur = map.get(key)
          if (!cur || shouldTakeRemoteLww(cur, remote)) map.set(key, remote)
        }
        await cacheStockLayers([...map.values()])
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
      if (delta.full || delOf('supplier').length || (Array.isArray(pos.suppliers) && pos.suppliers.length)) {
        const incoming = Array.isArray(pos.suppliers) ? pos.suppliers : []
        const base = delta.full ? incoming : mergeByIdLww(cur.suppliers, incoming)
        patch.suppliers = dropById(base as any, delOf('supplier'))
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
