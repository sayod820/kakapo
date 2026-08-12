// ════════════════════════════════════════════════
// KAKAPO — склад торговой точки: приход / списание
// Локально сразу + очередь, как чеки на кассе
// ════════════════════════════════════════════════
import { api } from './api'
import { isLocalId, newClientRef, newLocalId } from './offline'
import { localFirstOp, type OfflineResult } from './localFirst'
import { shadowMirrorPut } from './offlineV2'
import { useOfflineSync } from './offlineSync'
import { usePosStore } from './posStore'
import type { ProductStockLayer, StockReceipt, StockRevision, StockWriteoff } from './types'

function round2(v: number) {
  return Math.round((Number(v) || 0) * 100) / 100
}

export type { OfflineResult }

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

/** Local-first: сразу локально, сервер в фоне. apiCall игнорируется. */
async function raceWarehouseOp<T>(
  _apiCall: () => Promise<T>,
  localApply: () => Promise<T> | T,
): Promise<OfflineResult<T>> {
  return localFirstOp(localApply)
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
  const { useProducts } = await import('./store')
  const ps = useProducts.getState()
  const bumps = new Map<number, { delta: number; prices?: { costPrice?: number; retailPrice?: number } }>()
  for (const it of receipt.items) {
    const pid = Number(it.productId)
    const prev = bumps.get(pid) || { delta: 0 }
    prev.delta += sign * (Number(it.qty) || 0)
    if (sign > 0) {
      prev.prices = { costPrice: it.costPrice, retailPrice: it.retailPrice }
    }
    bumps.set(pid, prev)
  }
  for (const [productId, { delta, prices }] of bumps) {
    const p = ps.products.find(x => x.id === productId)
    if (!p) continue
    const patch: Record<string, unknown> = {
      stock: round2(Math.max(0, (Number(p.stock) || 0) + delta)),
    }
    if (prices?.costPrice != null && prices.costPrice > 0) patch.costPrice = prices.costPrice
    if (prices?.retailPrice != null && prices.retailPrice > 0) patch.price = prices.retailPrice
    ps.updateProduct(productId, patch as any)
  }
  patchSupplierDebt(receipt.supplierId || undefined, sign * (Number(receipt.debtAdded) || 0))
  try {
    const { applyLocalReceiptLayers } = await import('./stockLayersLocal')
    await applyLocalReceiptLayers(receipt, sign)
  } catch { /* ignore */ }
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
    shadowMirrorPut('stock_receipt', receipt.id, receipt)
    return receipt
  }

  const res = await raceWarehouseOp(() => api.createStockReceipt(body), applyLocal)
  if (res.data) shadowMirrorPut('stock_receipt', res.data.id, res.data)
  return res
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
    if (sign > 0) {
      try {
        const { consumeLocalLayersFifo } = await import('./stockLayersLocal')
        await consumeLocalLayersFifo(it.productId, Number(it.qty) || 0)
      } catch { /* ignore */ }
    }
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
    shadowMirrorPut('stock_writeoff', writeoff.id, writeoff)
    return writeoff
  }

  const res = await raceWarehouseOp(() => api.createStockWriteoff(body), applyLocal)
  if (res.data) shadowMirrorPut('stock_writeoff', res.data.id, res.data)
  return res
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

// ── Ревизия (инвентаризация) ──

export type RevisionPayload = {
  note?: string
  createdBy?: string
  items: { productId: number; countedStock: number }[]
}

async function setProductStockExact(productId: number, stock: number) {
  const { useProducts } = await import('./store')
  const ps = useProducts.getState()
  const p = ps.products.find(x => x.id === productId)
  if (!p) return
  ps.updateProduct(productId, { stock: round2(Math.max(0, stock)) } as any)
}

async function applyRevisionExact(items: { productId: number; countedStock: number }[]) {
  for (const it of items) {
    await setProductStockExact(it.productId, Number(it.countedStock) || 0)
  }
}

async function reverseRevision(items: { productId: number; systemStock: number }[]) {
  for (const it of items) {
    await setProductStockExact(it.productId, Number(it.systemStock) || 0)
  }
}

async function buildLocalRevision(
  payload: RevisionPayload,
  opts: { id: string; clientRef: string; createdAtIso?: string },
): Promise<StockRevision> {
  const { useProducts } = await import('./store')
  const list = useProducts.getState().products
  const items = payload.items.map(it => {
    const p = list.find(x => x.id === it.productId)
    const systemStock = round2(Number(p?.stock) || 0)
    const countedStock = round2(Number(it.countedStock) || 0)
    return {
      productId: it.productId,
      productName: p?.name || `#${it.productId}`,
      systemStock,
      countedStock,
      diff: round2(countedStock - systemStock),
    }
  })
  return {
    id: opts.id,
    clientRef: opts.clientRef,
    createdAtIso: opts.createdAtIso || new Date().toISOString(),
    createdBy: payload.createdBy,
    note: payload.note,
    items,
  }
}

export async function createStockRevisionSafe(
  payload: RevisionPayload,
): Promise<OfflineResult<StockRevision>> {
  const clientRef = newClientRef()
  const createdAtIso = new Date().toISOString()
  const body = {
    ...payload,
    clientRef,
    createdAtIso,
    items: payload.items.map(it => ({
      productId: it.productId,
      countedStock: round2(it.countedStock),
    })),
  }

  const applyLocal = async () => {
    const localId = newLocalId('rev')
    const revision = await buildLocalRevision(payload, { id: localId, clientRef, createdAtIso })
    await useOfflineSync.getState().queueOp('stock_revision_create', body, { localId })
    await applyRevisionExact(payload.items)
    usePosStore.setState(s => ({ revisions: [revision, ...s.revisions] }))
    shadowMirrorPut('stock_receipt', `rev:${revision.id}`, revision)
    return revision
  }

  const res = await raceWarehouseOp(() => api.createStockRevision(body as any), applyLocal)
  if (res.data) shadowMirrorPut('stock_receipt', `rev:${res.data.id}`, res.data)
  return res
}

export async function updateStockRevisionSafe(
  id: string,
  payload: RevisionPayload,
): Promise<OfflineResult<StockRevision>> {
  const clientRef = newClientRef()
  const body = {
    ...payload,
    clientRef,
    id,
    items: payload.items.map(it => ({
      productId: it.productId,
      countedStock: round2(it.countedStock),
    })),
  }

  const applyLocal = async () => {
    const old = usePosStore.getState().revisions.find(r => r.id === id)
    if (old) await reverseRevision(old.items)
    const revision = await buildLocalRevision(payload, {
      id,
      clientRef,
      createdAtIso: old?.createdAtIso,
    })
    await applyRevisionExact(payload.items)
    await useOfflineSync.getState().queueOp('stock_revision_update', body)
    usePosStore.setState(s => ({
      revisions: s.revisions.map(r => (r.id === id ? revision : r)),
    }))
    return revision
  }

  if (isLocalId(id)) {
    const data = await applyLocal()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data }
  }

  return raceWarehouseOp(() => api.updateStockRevision(id, body as any), applyLocal)
}

export async function deleteStockRevisionSafe(id: string): Promise<OfflineResult<{ id: string }>> {
  const clientRef = newClientRef()
  const body = { clientRef, id }

  const applyLocal = async () => {
    const old = usePosStore.getState().revisions.find(r => r.id === id)
    if (old) await reverseRevision(old.items)
    await useOfflineSync.getState().queueOp('stock_revision_delete', body)
    usePosStore.setState(s => ({ revisions: s.revisions.filter(r => r.id !== id) }))
    return { id }
  }

  if (isLocalId(id)) {
    const data = await applyLocal()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data }
  }

  return raceWarehouseOp(() => api.deleteStockRevision(id), applyLocal)
}

/** Правка цен/опта существующей партии (раздел «Партии и приходы»). */
export async function updateStockLayerSafe(
  receiptId: string,
  productId: number,
  data: {
    costPrice?: number
    retailPrice?: number
    bulkPricing?: { minQty: number; price: number }[]
    expiryDate?: string | null
  },
): Promise<OfflineResult<ProductStockLayer[]>> {
  const clientRef = newClientRef()
  const body = {
    clientRef,
    receiptId,
    productId,
    costPrice: data.costPrice != null ? round2(data.costPrice) : undefined,
    retailPrice: data.retailPrice != null ? round2(data.retailPrice) : undefined,
    bulkPricing: data.bulkPricing,
    expiryDate: data.expiryDate,
  }

  const applyLocal = async () => {
    await useOfflineSync.getState().queueOp('stock_layer_update', body, { clientRef })
    usePosStore.setState(s => ({
      receipts: s.receipts.map(r => {
        if (r.id !== receiptId) return r
        return {
          ...r,
          items: r.items.map(it => (
            Number(it.productId) === Number(productId)
              ? {
                  ...it,
                  costPrice: body.costPrice ?? it.costPrice,
                  retailPrice: body.retailPrice ?? it.retailPrice,
                  bulkPricing: body.bulkPricing ?? it.bulkPricing,
                  expiryDate: body.expiryDate !== undefined ? body.expiryDate : it.expiryDate,
                }
              : it
          )),
        }
      }),
    }))
    if (body.retailPrice != null && body.retailPrice > 0) {
      const { useProducts } = await import('./store')
      useProducts.getState().updateProduct(productId, { price: body.retailPrice } as any)
    }
    if (body.costPrice != null && body.costPrice > 0) {
      const { useProducts } = await import('./store')
      useProducts.getState().updateProduct(productId, { costPrice: body.costPrice } as any)
    }
    // Локальный снимок слоёв для UI
    const receipt = usePosStore.getState().receipts.find(r => r.id === receiptId)
    const item = receipt?.items.find(it => Number(it.productId) === Number(productId))
    const layer: ProductStockLayer = {
      receiptId,
      productId,
      productName: item?.productName || `#${productId}`,
      qty: Number(item?.qty) || 0,
      remainingQty: Number(item?.remainingQty) || 0,
      costPrice: Number(item?.costPrice) || 0,
      retailPrice: Number(item?.retailPrice) || 0,
      bulkPricing: item?.bulkPricing || [],
      expiryDate: item?.expiryDate,
      createdAtIso: receipt?.createdAtIso || new Date().toISOString(),
      supplierName: receipt?.supplierName,
      layerIndex: 0,
      isActive: true,
    }
    return [layer]
  }

  if (isLocalId(receiptId)) {
    const dataLocal = await applyLocal()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data: dataLocal }
  }

  return raceWarehouseOp(
    () => api.updateProductStockLayer(receiptId, productId, {
      costPrice: body.costPrice,
      retailPrice: body.retailPrice,
      bulkPricing: body.bulkPricing,
      expiryDate: body.expiryDate,
    }),
    applyLocal,
  )
}

/** Удалить одну партию (остаток снимется со склада). */
export async function deleteStockLayerSafe(
  receiptId: string,
  productId: number,
): Promise<OfflineResult<{
  receiptId: string
  productId: number
  deletedReceipt: boolean
  layers: ProductStockLayer[]
}>> {
  const clientRef = newClientRef()
  const body = { clientRef, receiptId, productId }

  const applyLocal = async () => {
    const receipt = usePosStore.getState().receipts.find(r => r.id === receiptId)
    const item = receipt?.items.find(it => Number(it.productId) === Number(productId))
    let remFromCache = round2(Number(item?.remainingQty) || 0)
    if (!(remFromCache > 0)) {
      try {
        const { readCachedStockLayers } = await import('./stockLayersLocal')
        const hit = (await readCachedStockLayers()).find(
          l => l.receiptId === receiptId && Number(l.productId) === Number(productId),
        )
        remFromCache = round2(Number(hit?.remainingQty) || 0)
      } catch { /* ignore */ }
    }
    if (!(remFromCache > 0) && item && !(Number(item.remainingQty) > 0)) {
      throw new Error('Партия уже израсходована')
    }
    if (!(remFromCache > 0) && !item) {
      // Нет в сторе и нет остатка — всё равно чистим кэш партии
      remFromCache = 0
    }

    await useOfflineSync.getState().queueOp('stock_layer_delete', body, { clientRef })

    const itemsLeft = receipt
      ? receipt.items.filter(it => Number(it.productId) !== Number(productId))
      : []
    const deletedReceipt = !!(receipt && itemsLeft.length === 0)

    if (receipt) {
      if (deletedReceipt) {
        const debtDelta = -round2(Number(receipt.debtAdded) || 0)
        patchSupplierDebt(receipt.supplierId || undefined, debtDelta)
        usePosStore.setState(s => ({ receipts: s.receipts.filter(r => r.id !== receiptId) }))
      } else {
        const oldDebt = round2(Number(receipt.debtAdded) || 0)
        const newTotal = round2(itemsLeft.reduce(
          (s, it) => s + (Number(it.qty) || 0) * (Number(it.costPrice) || 0),
          0,
        ))
        const newPaid = round2(Math.min(Number(receipt.paidNow) || 0, newTotal))
        const newDebt = round2(Math.max(0, newTotal - newPaid))
        patchSupplierDebt(receipt.supplierId || undefined, newDebt - oldDebt)
        usePosStore.setState(s => ({
          receipts: s.receipts.map(r => (
            r.id !== receiptId
              ? r
              : {
                  ...r,
                  items: itemsLeft,
                  totalCost: newTotal,
                  paidNow: newPaid,
                  debtAdded: newDebt,
                }
          )),
        }))
      }
    }

    if (remFromCache > 0) {
      await bumpProductStock(productId, -remFromCache)
    }

    const { removeLocalStockLayer, readCachedStockLayers } = await import('./stockLayersLocal')
    await removeLocalStockLayer(receiptId, productId)
    const layers = (await readCachedStockLayers()).filter(l => Number(l.productId) === Number(productId))

    return {
      receiptId,
      productId,
      deletedReceipt,
      layers,
    }
  }

  if (isLocalId(receiptId)) {
    const dataLocal = await applyLocal()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data: dataLocal }
  }

  return raceWarehouseOp(
    () => api.deleteProductStockLayer(receiptId, productId, { clientRef }),
    applyLocal,
  )
}
