/**
 * Локальный журнал движений склада (KV `stock_movements`).
 * Клиентская сторона покрытия offline-sync prompt; сервер опционален.
 */
import { cacheData, readCachedData } from './offline'

export type LocalStockMovement = {
  movementId: string
  operationId?: string
  productId: number
  quantity: number
  type: string
  source?: string
  atIso: string
}

const KEY = 'stock_movements'
const MAX = 5000

export async function appendLocalStockMovement(input: {
  movementId: string
  operationId?: string
  productId: number
  quantity: number
  type: string
  source?: string
}): Promise<void> {
  const productId = Number(input.productId) || 0
  const quantity = Number(input.quantity) || 0
  if (!productId || !(quantity > 0) || !input.movementId) return
  try {
    const prev = (await readCachedData<LocalStockMovement[]>(KEY)) || []
    const row: LocalStockMovement = {
      movementId: String(input.movementId),
      operationId: input.operationId ? String(input.operationId) : undefined,
      productId,
      quantity,
      type: String(input.type || 'SALE'),
      source: input.source,
      atIso: new Date().toISOString(),
    }
    const next = [...prev, row]
    const pruned = next.length > MAX ? next.slice(-MAX) : next
    await cacheData(KEY, pruned)
  } catch { /* ignore */ }
}

export async function readLocalStockMovements(): Promise<LocalStockMovement[]> {
  try {
    return (await readCachedData<LocalStockMovement[]>(KEY)) || []
  } catch {
    return []
  }
}
