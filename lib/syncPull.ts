/**
 * Входящий синк: GET /sync/changes после flush outbox.
 *
 * Phase 6: READY pending still blocks full pull (push first).
 * Cooldown / failed pending do NOT starve inbound — apply with overlays.
 * revisionCoordinator / barrier model untouched.
 */
import { api } from './api'
import { isOnline } from './offline'
import { getPending, cacheProducts, cacheClients, persistPosSnapshot } from './offline'
import { getSyncCursor, setSyncCursor, entityUpsertMany } from './localEntities'
import { cacheStockLayersAndSyncCatalog } from './stockLayersLocal'
import { appendConflictLog, mergeAppendById, mergeByIdLww, mergeSalesInbound, shouldTakeRemoteLww } from './syncConflict'
import { refreshStockAfterRevisionsDone } from './revisionCoordinatorClient'
import {
  shouldSkipFullPullForPending,
  pendingSaleStockDeltas,
  pendingStockTouchedProductIds,
  applyPendingStockOverlayToProducts,
  mergeLayersProtectingLocal,
} from './pendingPullGate'
import { isPerfEnabled, perfCount, perfNote } from './devTelemetry'
import type { Product, ProductStockLayer } from './types'
import type { AdminClient } from './clientCrm'
import type { AdminCard } from './cardCrm'

export type SyncPullResult = {
  ok: boolean
  skipped?: 'offline' | 'pending' | 'error'
  cursor?: string
  error?: string
}

let pullInFlight: Promise<SyncPullResult> | null = null

export async function pullSyncChanges(opts?: {
  forceFull?: boolean
  /** даже если есть pending — только для явного bootstrap */
  ignorePending?: boolean
}): Promise<SyncPullResult> {
  if (pullInFlight && !opts?.forceFull && !opts?.ignorePending) {
    return pullInFlight
  }
  const run = doPullSyncChanges(opts)
  if (!opts?.forceFull && !opts?.ignorePending) {
    pullInFlight = run.finally(() => { pullInFlight = null })
    return pullInFlight
  }
  return run
}

async function doPullSyncChanges(opts?: {
  forceFull?: boolean
  ignorePending?: boolean
}): Promise<SyncPullResult> {
  if (!isOnline()) return { ok: false, skipped: 'offline' }

  let pendingSnapshot: Awaited<ReturnType<typeof getPending>> = []
  if (!opts?.ignorePending) {
    try {
      pendingSnapshot = await getPending()
      // Phase 6: only READY-to-push blocks; cooldown/failed allow inbound + overlay
      if (shouldSkipFullPullForPending(pendingSnapshot)) {
        return { ok: false, skipped: 'pending' }
      }
    } catch { /* ignore */ }
  } else {
    try { pendingSnapshot = await getPending() } catch { /* ignore */ }
  }

  const t0 = isPerfEnabled() ? performance.now() : 0
  try {
    const since = opts?.forceFull ? '' : await getSyncCursor()
    const delta = await api.getSyncChanges(since || undefined)

    const del = Array.isArray(delta.deletes) ? delta.deletes : []
    let pendingProtect = new Set<string>()
    const stockDeltas = pendingSaleStockDeltas(pendingSnapshot)
    const stockTouched = pendingStockTouchedProductIds(pendingSnapshot)
    try {
      for (const r of pendingSnapshot) {
        if (r.failed && r.kind !== 'sale' && r.kind !== 'sale_return') continue
        if (r.kind === 'product_upsert') {
          const id = String((r.payload as any)?.localId || (r.payload as any)?.product?.id || '')
          if (id) pendingProtect.add(`product:${id}`)
        }
        if (r.kind === 'client_upsert') {
          const id = String((r.payload as any)?.localId || (r.payload as any)?.client?.id || '')
          if (id) pendingProtect.add(`client:${id}`)
        }
        if (
          r.kind === 'sale'
          || r.kind === 'sale_return'
          || r.kind === 'debt_repay'
          || r.kind === 'card_topup'
          || r.kind === 'card_loyalty_patch'
        ) {
          const cid = String((r.payload as any)?.clientId || '')
          if (cid) pendingProtect.add(`client:${cid}`)
          const cnum = String((r.payload as any)?.cardNum || (r.payload as any)?.num || '')
          if (cnum) pendingProtect.add(`card:${cnum}`)
        }
        if (r.kind === 'stock_receipt_create' || r.kind === 'stock_receipt_update' || r.kind === 'stock_receipt_delete') {
          const id = String(r.localId || (r.payload as any)?.id || '')
          if (id) pendingProtect.add(`receipt:${id}`)
        }
        if (r.kind === 'stock_writeoff_create' || r.kind === 'stock_writeoff_update' || r.kind === 'stock_writeoff_delete') {
          const id = String(r.localId || (r.payload as any)?.id || '')
          if (id) pendingProtect.add(`writeoff:${id}`)
        }
        if (r.kind === 'stock_revision_create' || r.kind === 'stock_revision_update' || r.kind === 'stock_revision_delete') {
          const id = String(r.localId || (r.payload as any)?.id || '')
          if (id) pendingProtect.add(`revision:${id}`)
        }
      }
    } catch { /* ignore */ }
    const delOf = (kind: string) => del
      .filter(d => d.kind === kind)
      .map(d => String(d.id))
      .filter(id => !pendingProtect.has(`${kind}:${id}`))
    const dropById = <T extends { id?: string | number }>(list: T[], ids: string[]): T[] => {
      if (!ids.length) return list
      const s = new Set(ids)
      return (list || []).filter(row => !s.has(String(row?.id ?? '')))
    }

    // Products — server base + local unacked sale/return stock overlay
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
      // Overlay only when remote product rows arrived (else local stock already includes pending)
      const productsInbound = !!(delta.products && delta.products.length) || !!opts?.forceFull || !!delta.full
      if (stockDeltas.size && productsInbound) {
        merged = applyPendingStockOverlayToProducts(merged, stockDeltas)
      }
      if ((delta.products && delta.products.length) || delOf('product').length) {
        useProducts.setState(s => ({
          products: merged,
          catalogEpoch: s.catalogEpoch + 1,
        }))
        if (isPerfEnabled()) {
          perfCount('products_array_replace', 1, 'syncPull.products', { catalogSize: merged.length })
        }
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

    // Stock layers — protect products with unacked stock effects; cursor still advances
    if (Array.isArray(delta.stockLayers) && (delta.stockLayersReplace || delta.full || opts?.forceFull || delta.stockLayers.length)) {
      const next = (delta.full || opts?.forceFull || delta.stockLayersReplace)
        ? (delta.stockLayers as ProductStockLayer[])
        : null
      if (next) {
        if (stockTouched.size) {
          const { readCachedStockLayers } = await import('./stockLayersLocal')
          const local = await readCachedStockLayers()
          const mergedLayers = mergeLayersProtectingLocal(local, next, stockTouched)
          await cacheStockLayersAndSyncCatalog(mergedLayers)
          // Local protected layers already reflect pending sale — do NOT re-apply sale deltas
        } else {
          await cacheStockLayersAndSyncCatalog(next)
        }
      } else {
        const { readCachedStockLayers } = await import('./stockLayersLocal')
        const local = await readCachedStockLayers()
        const map = new Map(local.map(l => [`${l.receiptId}:${l.productId}`, l]))
        for (const remote of delta.stockLayers as ProductStockLayer[]) {
          const pid = Number(remote.productId) || 0
          if (stockTouched.has(pid)) continue
          const key = `${remote.receiptId}:${remote.productId}`
          const cur = map.get(key)
          if (!cur || shouldTakeRemoteLww(cur, remote)) map.set(key, remote)
        }
        await cacheStockLayersAndSyncCatalog([...map.values()])
      }
    }

    // POS snapshot pieces
    const pos = delta.pos
    if (pos) {
      const { usePosStore } = await import('./posStore')
      const cur = usePosStore.getState()
      const patch: Record<string, unknown> = {}

      if (Array.isArray(pos.sales) && (delta.full || pos.sales.length || delOf('sale').length)) {
        let nextSales = delta.full
          ? mergeSalesInbound(cur.sales, pos.sales as any, { mode: 'full' })
          : (pos.sales.length
            ? mergeSalesInbound(cur.sales, pos.sales as any, { mode: 'delta' })
            : cur.sales)
        const saleDel = delOf('sale')
        if (saleDel.length) {
          const s = new Set(saleDel)
          nextSales = nextSales.filter((row: { id?: string | number }) => !s.has(String(row?.id ?? '')))
        }
        patch.sales = nextSales
      }
      if (Array.isArray(pos.shifts) && (delta.full || pos.shifts.length || delOf('shift').length)) {
        const incoming = pos.shifts
        let nextShifts: typeof cur.shifts
        if (delta.full) {
          nextShifts = incoming as typeof cur.shifts
        } else if (!incoming.length) {
          nextShifts = cur.shifts
        } else {
          const merged = mergeAppendById(cur.shifts, incoming)
          nextShifts = merged.map((sh: any) => {
            if (String(sh?.status || '') !== 'open') return sh
            const remote = (incoming || []).find((r: any) => String(r?.id) === String(sh?.id))
            if (!remote) return sh
            const srvCount = Number(remote.salesCount) || 0
            const locCount = Number(sh.salesCount) || 0
            if (srvCount >= locCount) {
              return {
                ...sh,
                salesCount: srvCount,
                salesCash: Number(remote.salesCash) || 0,
                salesCard: Number(remote.salesCard) || 0,
                salesCredit: Number(remote.salesCredit) || 0,
                expenseTotal: Number(remote.expenseTotal) || 0,
                cashInTotal: Number(remote.cashInTotal) || 0,
                updatedAtIso: remote.updatedAtIso || sh.updatedAtIso,
              }
            }
            return {
              ...sh,
              salesCash: Math.max(Number(remote.salesCash) || 0, Number(sh.salesCash) || 0),
              salesCard: Math.max(Number(remote.salesCard) || 0, Number(sh.salesCard) || 0),
              salesCredit: Math.max(Number(remote.salesCredit) || 0, Number(sh.salesCredit) || 0),
            }
          }) as typeof cur.shifts
        }
        const shiftDel = delOf('shift')
        if (shiftDel.length) {
          const s = new Set(shiftDel)
          nextShifts = nextShifts.filter(sh => !s.has(String(sh?.id ?? '')))
        }
        patch.shifts = nextShifts
      }
      if (Array.isArray(pos.receipts) || delOf('receipt').length) {
        const incoming = Array.isArray(pos.receipts) ? pos.receipts : []
        const base = delta.full
          ? incoming
          : (incoming.length ? mergeAppendById(cur.receipts, incoming) : cur.receipts)
        patch.receipts = dropById(base as any, delOf('receipt'))
      }
      if (Array.isArray(pos.writeoffs) || delOf('writeoff').length) {
        const incoming = Array.isArray(pos.writeoffs) ? pos.writeoffs : []
        const base = delta.full
          ? incoming
          : (incoming.length ? mergeAppendById(cur.writeoffs, incoming) : cur.writeoffs)
        patch.writeoffs = dropById(base as any, delOf('writeoff'))
      }
      if (Array.isArray(pos.revisions) || delOf('revision').length) {
        const prevRevisions = cur.revisions
        const incoming = Array.isArray(pos.revisions) ? pos.revisions : []
        const base = delta.full
          ? incoming
          : (incoming.length ? mergeAppendById(cur.revisions, incoming) : cur.revisions)
        patch.revisions = dropById(base as any, delOf('revision'))
        void refreshStockAfterRevisionsDone(prevRevisions, patch.revisions as typeof prevRevisions)
      }
      if (Array.isArray(pos.financeMoves) || delOf('finance_move').length) {
        const incoming = Array.isArray(pos.financeMoves) ? pos.financeMoves : []
        const base = delta.full
          ? incoming
          : (incoming.length ? mergeAppendById(cur.financeMoves, incoming) : cur.financeMoves)
        patch.financeMoves = dropById(base as any, delOf('finance_move'))
      }
      if (Array.isArray(pos.expenses) || delOf('expense').length) {
        const incoming = Array.isArray(pos.expenses) ? pos.expenses : []
        const base = delta.full
          ? incoming
          : (incoming.length ? mergeAppendById(cur.expenses, incoming) : cur.expenses)
        patch.expenses = dropById(base as any, delOf('expense'))
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
        try { await persistPosSnapshot({ force: true }) } catch { /* ignore */ }
      }
    }

    // Cursor: overlays applied on remote base — safe to advance (no silent skip)
    if (delta.cursor) await setSyncCursor(delta.cursor)
    // НЕ копируем main→lite: main часто уезжает вперёд из‑за товаров и softSync теряет чеки.
    // Lite курсор двигает только softSyncPosAfterSale (pos-lite).
    try {
      const { markLocalSyncAt } = await import('./offlineBootstrap')
      await markLocalSyncAt()
    } catch { /* ignore */ }
    if (t0) {
      perfNote('sync_pull_ms', performance.now() - t0, opts?.forceFull ? 'full' : 'delta', {
        cursor: !!delta.cursor,
        pendingOverlay: stockDeltas.size,
      })
    }
    return { ok: true, cursor: delta.cursor }
  } catch (e) {
    if (t0) {
      perfNote('sync_pull_ms', performance.now() - t0, 'error')
    }
    return {
      ok: false,
      skipped: 'error',
      error: e instanceof Error ? e.message : 'pull failed',
    }
  }
}
