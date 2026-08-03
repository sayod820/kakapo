// ════════════════════════════════════════════════
// KAKAPO — склад торговой точки: приход / списание
// Локально сразу + очередь, как чеки на кассе
// ════════════════════════════════════════════════
import { api, isNetworkError, NetworkError } from './api'
import { isLocalId, newClientRef, newLocalId } from './offline'
import { useOfflineSync } from './offlineSync'
import { usePosStore } from './posStore'
import type { StockReceipt, StockWriteoff } from './types'

const WAREHOUSE_FAST_MS = 1600

function round2(v: number) {
  return Math.round((Number(v) || 0) * 100) / 100
}

export interface OfflineResult<T> {
  offline: boolean
  data: T
}

export type ReceiptItemInput = {
  productId: number
  qty: number
  costPrice?: number
  retailPrice?: number
  bulkPricing?: { minQty: number; price: number }[]
  expiryDate?: string | null
}

export type ReceiptPayload = {
  supplierId?: string
  createdBy?: string
  paidNow?: number
  items: ReceiptItemInput[]
}

export type WriteoffPayload = {
  reason: string
  note?: string
  createdBy?: string
  items: { productId: number; qty: number }[]
}

async function raceWarehouseOp<T>(
  apiCall: () => Promise<T>,
  localApply: () => Promise<T> | T,
): Promise<OfflineResult<T>> {
  try {
    const data = await Promise.race([
      apiCall(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new NetworkError('Медленная связь — сохранено локально')),
          WAREHOUSE_FAST_MS,
        )
      }),
    ])
    return { offline: false, data }
  } catch (e) {
    if (!isNetworkError(e)) throw e
    const data = await localApply()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data }
  }
}

async function bumpProductStock(
  productId: number,
  delta: number,
  prices?: { costPrice?: number; retailPrice?: number },
) {
  const { useProducts } = await import('./store')
  const ps = useProducts.getState()
  const p = ps.products.find(x => x.id === productId)
  if (!p) return
  const patch: Record<string, unknown> = {
    stock: round2(Math.max(0, (Number(p.stock) || 0) + delta)),
  }
  if (prices?.costPrice != null && prices.costPrice > 0) patch.costPrice = prices.costPrice
  if (prices?.retailPrice != null && prices.retailPrice > 0) patch.price = prices.retailPrice
  ps.updateProduct(productId, patch as any)
}

function patchSupplierDebt(supplierId: string | undefined, debtDelta: number) {
  if (!supplierId || !(Math.abs(debtDelta) > 0.001)) return
  usePosStore.setState(s => ({
    suppliers: s.suppliers.map(sup => {
      if (sup.id !== supplierId) return sup
      return { ...sup, debt: round2(Math.max(0, (Number(sup.debt) || 0) + debtDelta)) }
    }),
  }))
}

function buildLocalReceipt(
  payload: ReceiptPayload,
  opts: { id: string; clientRef: string; createdAtIso?: string },
): StockReceipt {
  const items = payload.items.map(it => {
    const qty = round2(it.qty)
    const costPrice = round2(it.costPrice || 0)
    const retailPrice = round2(it.retailPrice || 0)
    return {
      productId: it.productId,
      productName: `#${it.productId}`,
      qty,
      remainingQty: qty,
      costPrice,
      retailPrice: retailPrice > 0 ? retailPrice : undefined,
      bulkPricing: it.bulkPricing,
      expiryDate: it.expiryDate ?? null,
    }
  })

  const totalCost = round2(items.reduce((s, it) => s + it.qty * it.costPrice, 0))
  const paidNow = round2(payload.paidNow || 0)
  const supplier = payload.supplierId
    ? usePosStore.getState().suppliers.find(s => s.id === payload.supplierId)
    : undefined

  return {
    id: opts.id,
    clientRef: opts.clientRef,
    supplierId: payload.supplierId || null,
    supplierName: supplier?.name || '',
    createdAtIso: opts.createdAtIso || new Date().toISOString(),
    createdBy: payload.createdBy,
    totalCost,
    paidNow,
    debtAdded: round2(Math.max(0, totalCost - paidNow)),
    items,
  }
}

async function enrichReceiptNames(receipt: StockReceipt): Promise<StockReceipt> {
  const { useProducts } = await import('./store')
  const list = useProducts.getState().products
  return {
    ...receipt,
    items: receipt.items.map(it => {
      const p = list.find(x => x.id === it.productId)
      return { ...it, productName: p?.name || it.productName }
    }),
  }
}

async function applyReceiptStock(receipt: StockReceipt, sign: 1 | -1) {
  for (const it of receipt.items) {
    await bumpProductStock(it.productId, sign * (Number(it.qty) || 0), sign > 0
      ? { costPrice: it.costPrice, retailPrice: it.retailPrice }
      : undefined)
  }
  patchSupplierDebt(receipt.supplierId || undefined, sign * (Number(receipt.debtAdded) || 0))
}

export async function createStockReceiptSafe(
  payload: ReceiptPayload,
): Promise<OfflineResult<StockReceipt>> {
  const clientRef = newClientRef()
  const createdAtIso = new Date().toISOString()
  const body = { ...payload, clientRef, createdAtIso, paidNow: round2(payload.paidNow || 0) }

  const applyLocal = async () => {
    const localId = newLocalId('rec')
    let receipt = buildLocalReceipt(payload, { id: localId, clientRef, createdAtIso })
    receipt = await enrichReceiptNames(receipt)
    await useOfflineSync.getState().queueOp('stock_receipt_create', body, { localId })
    await applyReceiptStock(receipt, 1)
    usePosStore.setState(s => ({ receipts: [receipt, ...s.receipts] }))
    return receipt
  }

  return raceWarehouseOp(() => api.createStockReceipt(body), applyLocal)
}

export async function updateStockReceiptSafe(
  id: string,
  payload: ReceiptPayload,
): Promise<OfflineResult<StockReceipt>> {
  const clientRef = newClientRef()
  const body = { ...payload, clientRef, id, paidNow: round2(payload.paidNow || 0) }

  if (isLocalId(id)) {
    // Ещё не на сервере — правим локально и обновляем очередь create
    const old = usePosStore.getState().receipts.find(r => r.id === id)
    if (old) await applyReceiptStock(old, -1)
    let receipt = buildLocalReceipt(payload, {
      id,
      clientRef: old?.clientRef || clientRef,
      createdAtIso: old?.createdAtIso,
    })
    receipt = await enrichReceiptNames(receipt)
    await applyReceiptStock(receipt, 1)
    usePosStore.setState(s => ({
      receipts: s.receipts.map(r => (r.id === id ? receipt : r)),
    }))
    await useOfflineSync.getState().queueOp('stock_receipt_update', { ...body, id })
    void useOfflineSync.getState().syncNow()
    return { offline: true, data: receipt }
  }

  const applyLocal = async () => {
    const old = usePosStore.getState().receipts.find(r => r.id === id)
    if (old) await applyReceiptStock(old, -1)
    let receipt = buildLocalReceipt(payload, {
      id,
      clientRef,
      createdAtIso: old?.createdAtIso,
    })
    receipt = await enrichReceiptNames(receipt)
    await applyReceiptStock(receipt, 1)
    await useOfflineSync.getState().queueOp('stock_receipt_update', body)
    usePosStore.setState(s => ({
      receipts: s.receipts.map(r => (r.id === id ? receipt : r)),
    }))
    return receipt
  }

  return raceWarehouseOp(() => api.updateStockReceipt(id, body), applyLocal)
}

export async function deleteStockReceiptSafe(id: string): Promise<OfflineResult<{ id: string }>> {
  const clientRef = newClientRef()
  const body = { clientRef, id }

  const applyLocal = async () => {
    const old = usePosStore.getState().receipts.find(r => r.id === id)
    if (old) await applyReceiptStock(old, -1)
    await useOfflineSync.getState().queueOp('stock_receipt_delete', body)
    usePosStore.setState(s => ({ receipts: s.receipts.filter(r => r.id !== id) }))
    return { id }
  }

  if (isLocalId(id)) {
    const data = await applyLocal()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data }
  }

  return raceWarehouseOp(
    () => api.deleteStockReceipt(id, { clientRef }),
    applyLocal,
  )
}

async function applyWriteoffStock(items: { productId: number; qty: number }[], sign: 1 | -1) {
  for (const it of items) {
    await bumpProductStock(it.productId, sign * -(Number(it.qty) || 0))
  }
}

async function buildLocalWriteoff(
  payload: WriteoffPayload,
  opts: { id: string; clientRef: string; createdAtIso?: string },
): Promise<StockWriteoff> {
  const { useProducts } = await import('./store')
  const list = useProducts.getState().products
  const items = payload.items.map(it => {
    const p = list.find(x => x.id === it.productId)
    const unitCost = round2(Number(p?.costPrice) || 0)
    const qty = round2(it.qty)
    return {
      productId: it.productId,
      productName: p?.name || `#${it.productId}`,
      qty,
      unitCost,
      lineCost: round2(unitCost * qty),
    }
  })
  return {
    id: opts.id,
    clientRef: opts.clientRef,
    createdAtIso: opts.createdAtIso || new Date().toISOString(),
    createdBy: payload.createdBy,
    reason: payload.reason,
    note: payload.note,
    totalCost: round2(items.reduce((s, it) => s + (Number(it.lineCost) || 0), 0)),
    items,
  }
}

export async function createStockWriteoffSafe(
  payload: WriteoffPayload,
): Promise<OfflineResult<StockWriteoff>> {
  const clientRef = newClientRef()
  const createdAtIso = new Date().toISOString()
  const body = { ...payload, clientRef, createdAtIso }

  const applyLocal = async () => {
    const localId = newLocalId('wof')
    const writeoff = await buildLocalWriteoff(payload, { id: localId, clientRef, createdAtIso })
    await useOfflineSync.getState().queueOp('stock_writeoff_create', body, { localId })
    await applyWriteoffStock(payload.items, 1)
    usePosStore.setState(s => ({ writeoffs: [writeoff, ...s.writeoffs] }))
    return writeoff
  }

  return raceWarehouseOp(() => api.createStockWriteoff(body), applyLocal)
}

export async function updateStockWriteoffSafe(
  id: string,
  payload: WriteoffPayload,
): Promise<OfflineResult<StockWriteoff>> {
  const clientRef = newClientRef()
  const body = { ...payload, clientRef, id }

  const applyLocal = async () => {
    const old = usePosStore.getState().writeoffs.find(w => w.id === id)
    if (old) await applyWriteoffStock(old.items, -1)
    const writeoff = await buildLocalWriteoff(payload, {
      id,
      clientRef,
      createdAtIso: old?.createdAtIso,
    })
    await applyWriteoffStock(payload.items, 1)
    await useOfflineSync.getState().queueOp('stock_writeoff_update', body)
    usePosStore.setState(s => ({
      writeoffs: s.writeoffs.map(w => (w.id === id ? writeoff : w)),
    }))
    return writeoff
  }

  if (isLocalId(id)) {
    const data = await applyLocal()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data }
  }

  return raceWarehouseOp(() => api.updateStockWriteoff(id, body), applyLocal)
}

export async function deleteStockWriteoffSafe(id: string): Promise<OfflineResult<{ id: string }>> {
  const clientRef = newClientRef()
  const body = { clientRef, id }

  const applyLocal = async () => {
    const old = usePosStore.getState().writeoffs.find(w => w.id === id)
    if (old) await applyWriteoffStock(old.items, -1)
    await useOfflineSync.getState().queueOp('stock_writeoff_delete', body)
    usePosStore.setState(s => ({ writeoffs: s.writeoffs.filter(w => w.id !== id) }))
    return { id }
  }

  if (isLocalId(id)) {
    const data = await applyLocal()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data }
  }

  return raceWarehouseOp(
    () => api.deleteStockWriteoff(id, { clientRef }),
    applyLocal,
  )
}
