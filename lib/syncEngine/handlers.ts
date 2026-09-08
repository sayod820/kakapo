import type { QueueKind } from '../offline'
import type { PendingOp } from '../offline'

export type SyncOpHandler = (row: PendingOp) => Promise<string>

/**
 * Один менеджер, много kind-handlers.
 * По умолчанию — существующий sendOp (идемпотентность / clientRef без изменений).
 */
class SyncManagerImpl {
  private handlers = new Map<string, SyncOpHandler>()

  registerHandler(kind: QueueKind | string, handler: SyncOpHandler): void {
    this.handlers.set(String(kind), handler)
  }

  async dispatch(row: PendingOp): Promise<string> {
    const custom = this.handlers.get(String(row.kind))
    if (custom) return custom(row)
    return defaultSendOp(row)
  }
}

async function defaultSendOp(row: PendingOp): Promise<string> {
  const { sendOp } = await import('../offline')
  return sendOp(row)
}

export const syncManager = new SyncManagerImpl()

/** Тонкие wrappers — место для спец-логики по kind без ломки sendOp. */
export function registerDefaultKindHandlers(): void {
  const kinds: QueueKind[] = [
    'sale',
    'shift_open',
    'shift_close',
    'sale_return',
    'debt_repay',
    'card_topup',
    'finance_move',
    'vault_card_to_cash',
    'vault_cash_to_card',
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
    'product_upsert',
    'product_delete',
    'client_upsert',
    'client_delete',
    'supplier_upsert',
    'supplier_delete',
    'supplier_payment_create',
    'supplier_payment_delete',
    'expense_create',
    'expense_delete',
    'finance_move_delete',
    'category_upsert',
    'category_delete',
    'category_reorder',
    'card_loyalty_patch',
    'pos_point_upsert',
    'pos_point_delete',
    'cashier_upsert',
  ]
  for (const kind of kinds) {
    syncManager.registerHandler(kind, row => defaultSendOp(row))
  }
}
