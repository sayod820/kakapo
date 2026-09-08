/**
 * Матрица стратегий разрешения конфликтов при двустороннем синке.
 * Фактический merge по-прежнему в syncConflict / syncPull — политика здесь
 * как контракт и guard-лог, без резкой смены поведения.
 */

export type ConflictStrategy =
  | 'server_authoritative'
  | 'local_authoritative'
  | 'lww'
  | 'field_merge'
  | 'movement_append'
  | 'manual'

export const ENTITY_CONFLICT_POLICY: Record<string, ConflictStrategy> = {
  sale: 'movement_append', // idempotent clientRef
  sale_return: 'movement_append',
  stock: 'movement_append',
  stock_receipt: 'movement_append',
  stock_writeoff: 'movement_append',
  stock_revision: 'movement_append',
  stock_layer: 'lww',
  finance_move: 'movement_append',
  expense: 'movement_append',
  shift: 'lww',
  product: 'lww',
  category: 'lww',
  client: 'field_merge',
  card: 'field_merge',
  payment: 'server_authoritative',
  supplier_payment: 'movement_append',
  supplier: 'lww',
  pos_point: 'lww',
  cashier: 'lww',
  vault: 'server_authoritative',
  loyalty: 'field_merge',
}

export function strategyForEntity(kind: string): ConflictStrategy {
  const key = String(kind || '').trim().toLowerCase()
  if (!key) return 'manual'
  if (ENTITY_CONFLICT_POLICY[key]) return ENTITY_CONFLICT_POLICY[key]
  // aliases
  if (key === 'pos_sale' || key === 'sales') return 'movement_append'
  if (key === 'products') return 'lww'
  if (key === 'clients' || key === 'crm') return 'field_merge'
  if (key === 'cards') return 'field_merge'
  return 'manual'
}
