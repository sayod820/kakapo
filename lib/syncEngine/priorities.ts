import type { QueueKind } from '../offline'
import type { SyncPriority } from './types'

/**
 * CATALOG_FIRST — как в offline.ts: справочники раньше чеков/склада,
 * иначе «поставщик не найден» при приходе.
 */
const CATALOG_FIRST = new Set<QueueKind>([
  'supplier_upsert',
  'product_upsert',
  'category_upsert',
  'category_reorder',
  'client_upsert',
])

const REVISION_LAST = new Set<QueueKind>([
  'stock_revision_create',
  'stock_revision_update',
  'stock_revision_delete',
])

const HIGH_KINDS = new Set<string>([
  'sale',
  'sale_return',
  'debt_repay',
  'card_topup',
  'shift_open',
  'shift_close',
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
  'finance_move',
  'finance_move_delete',
  'expense_create',
  'expense_delete',
  'vault_card_to_cash',
  'vault_cash_to_card',
  'supplier_payment_create',
  'supplier_payment_delete',
])

const MEDIUM_KINDS = new Set<string>([
  'product_upsert',
  'product_delete',
  'client_upsert',
  'client_delete',
  'supplier_upsert',
  'supplier_delete',
  'category_upsert',
  'category_delete',
  'category_reorder',
  'card_loyalty_patch',
  'pos_point_upsert',
  'pos_point_delete',
  'cashier_upsert',
])

export function syncPriorityForKind(kind: QueueKind | string): SyncPriority {
  const k = String(kind || '')
  if (HIGH_KINDS.has(k)) return 'high'
  if (MEDIUM_KINDS.has(k)) return 'medium'
  return 'low'
}

/** Числовой приоритет SyncPriority (меньше = раньше в обычной очереди). */
export function syncPriorityRank(p: SyncPriority): number {
  if (p === 'high') return 0
  if (p === 'medium') return 10
  return 20
}

/**
 * Ключ сортировки, совместимый с offline.ts byOrder:
 * catalog first (−50) → остальное по SyncPriority → ревизия в конце (+100).
 * Внутри группы — seq / createdAtIso (сравнивает вызывающий код).
 */
export function queueSortKey(kind: QueueKind | string): number {
  const k = kind as QueueKind
  if (CATALOG_FIRST.has(k)) return -50
  if (REVISION_LAST.has(k)) return 100
  return syncPriorityRank(syncPriorityForKind(k))
}

/** Число для поля PendingOp.priority (меньше = раньше). */
export function pendingPriorityNumber(kind: QueueKind | string): number {
  return queueSortKey(kind)
}

export { CATALOG_FIRST as SYNC_CATALOG_FIRST_KINDS, REVISION_LAST as SYNC_REVISION_LAST_KINDS }
