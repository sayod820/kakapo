/**
 * Phase 6 — pending classification + full-pull gate + stock overlay.
 * Does NOT touch revisionCoordinator / barrier revision model.
 */
import type { PendingOp, QueueKind } from './offline'

export type PendingClass =
  | 'ready' // can push now
  | 'cooldown' // nextRetryAt > now, failed=false
  | 'failed' // terminal/manual until revive
  | 'revision_related' // informative tag (still also ready/cooldown/failed)

const REVISION_KINDS = new Set<QueueKind>([
  'stock_revision_create',
  'stock_revision_update',
  'stock_revision_delete',
])

const STOCK_EFFECT_KINDS = new Set<QueueKind>([
  'sale',
  'sale_return',
  'stock_receipt_create',
  'stock_receipt_update',
  'stock_receipt_delete',
  'stock_writeoff_create',
  'stock_writeoff_update',
  'stock_writeoff_delete',
  'stock_layer_update',
  'stock_layer_delete',
  'stock_revision_create',
  'stock_revision_update',
  'stock_revision_delete',
])

export function classifyPendingOp(row: PendingOp, now = Date.now()): PendingClass {
  if (row.failed) return 'failed'
  if (Number(row.nextRetryAt) > now) return 'cooldown'
  return 'ready'
}

export function isRevisionRelatedPending(row: PendingOp): boolean {
  return REVISION_KINDS.has(row.kind)
}

/** Hard gate for full pull: only READY (pushable now) ops block. */
export function hasReadyToPushPending(list: PendingOp[], now = Date.now()): boolean {
  return (list || []).some(r => classifyPendingOp(r, now) === 'ready')
}

/**
 * true → skip full pull (legacy skipped:'pending').
 * Cooldown + failed do NOT block (Phase 6).
 * Ready-to-push still blocks so push can drain first without racing.
 */
export function shouldSkipFullPullForPending(list: PendingOp[], now = Date.now()): boolean {
  return hasReadyToPushPending(list, now)
}

/** Line qty for stock effect (weight already folded into items.qty on sale payload). */
function lineStockQty(it: Record<string, unknown>): number {
  const w = it.weightKg != null ? Number(it.weightKg) : NaN
  if (Number.isFinite(w) && w > 0) return w
  return Number(it.qty) || 0
}

/**
 * Unacked local stock deltas relative to server base.
 * sale → negative; sale_return → positive.
 * Receipt/writeoff/revision: no simple product.stock delta here — layers protected separately.
 */
export function pendingSaleStockDeltas(list: PendingOp[]): Map<number, number> {
  const deltas = new Map<number, number>()
  const add = (pid: number, d: number) => {
    if (!(pid > 0) || !Number.isFinite(d) || Math.abs(d) < 1e-9) return
    deltas.set(pid, (deltas.get(pid) || 0) + d)
  }
  for (const row of list || []) {
    if (row.failed && row.kind !== 'sale' && row.kind !== 'sale_return') continue
    // Failed sale still holds local stock effect until revert/delete
    if (row.kind !== 'sale' && row.kind !== 'sale_return') continue
    const p = (row.payload || {}) as Record<string, unknown>
    const sign = row.kind === 'sale' ? -1 : 1
    const items = Array.isArray(p.items)
      ? p.items
      : (Array.isArray((p._revert as any)?.cart) ? (p._revert as any).cart : [])
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue
      const it = raw as Record<string, unknown>
      add(Number(it.productId) || 0, sign * lineStockQty(it))
    }
  }
  return deltas
}

export function pendingStockTouchedProductIds(list: PendingOp[]): Set<number> {
  const ids = new Set<number>()
  for (const [pid] of pendingSaleStockDeltas(list)) ids.add(pid)
  for (const row of list || []) {
    if (!STOCK_EFFECT_KINDS.has(row.kind)) continue
    if (row.failed && row.kind !== 'sale' && row.kind !== 'sale_return') continue
    const p = (row.payload || {}) as Record<string, unknown>
    const items = Array.isArray(p.items) ? p.items : []
    for (const raw of items) {
      const pid = Number((raw as any)?.productId) || 0
      if (pid) ids.add(pid)
    }
    const one = Number(p.productId) || 0
    if (one) ids.add(one)
  }
  return ids
}

/** Apply server product.stock + local unacked sale/return deltas. */
export function applyPendingStockOverlayToProducts<T extends { id?: number | string; stock?: number }>(
  products: T[],
  deltas: Map<number, number>,
): T[] {
  if (!deltas.size || !products?.length) return products
  return products.map(p => {
    const pid = Number(p.id) || 0
    const d = deltas.get(pid)
    if (d == null || !Number.isFinite(d)) return p
    const next = Math.round(((Number(p.stock) || 0) + d) * 1000) / 1000
    if (Math.abs(next - (Number(p.stock) || 0)) < 1e-9) return p
    return { ...p, stock: next }
  })
}

/** Keep local layers for products touched by unacked stock ops; take remote for the rest. */
export function mergeLayersProtectingLocal<T extends { productId?: number | string }>(
  local: T[],
  remote: T[],
  protectProductIds: Set<number>,
): T[] {
  if (!protectProductIds.size) return remote
  const keepLocal = (local || []).filter(l => protectProductIds.has(Number(l.productId) || 0))
  const remoteRest = (remote || []).filter(l => !protectProductIds.has(Number(l.productId) || 0))
  return [...remoteRest, ...keepLocal]
}

export function summarizePendingClasses(list: PendingOp[], now = Date.now()) {
  let ready = 0
  let cooldown = 0
  let failed = 0
  let revisionRelated = 0
  for (const r of list || []) {
    const c = classifyPendingOp(r, now)
    if (c === 'ready') ready++
    else if (c === 'cooldown') cooldown++
    else if (c === 'failed') failed++
    if (isRevisionRelatedPending(r)) revisionRelated++
  }
  return { ready, cooldown, failed, revisionRelated, total: (list || []).length }
}
