// ════════════════════════════════════════════════
// KAKAPO — склад торговой точки: приход / списание
// Локально сразу + очередь, как чеки на кассе
// ════════════════════════════════════════════════
import { api, isNetworkError } from './api'
import { isLocalId, newClientRef, newLocalId, resolveLocalId } from './offline'
import { localFirstOp, type OfflineResult } from './localFirst'
import { applyPurchasePayToOpenShift } from './offlinePosOps'
import { supplierSupplyVersion, supplierPayVersion } from './offlineSupplierOps'
import { shadowMirrorPut } from './offlineV2'
import { useOfflineSync } from './offlineSync'
import { usePosStore } from './posStore'
import type { ProductStockLayer, StockReceipt, StockRevision, StockWriteoff, RevisionWaitDevice } from './types'
import {
  buildRevisionPosCuts,
  buildRevisionSubmitMeta,
  resolveRevisionWaitDevices,
  revisionUsesCoordinator,
} from './revisionMeta'
import { getTradeDeviceIdSync } from './tradeDevice'

function round2(v: number) {
  return Math.round((Number(v) || 0) * 100) / 100
}

export type { OfflineResult }

export type ReceiptItemInput = {
  productId: number
  qty: number
  costPrice?: number
  /** Сумма закупа по строке — источник правды для итога прихода */
  purchaseTotal?: number
  retailPrice?: number
  bulkPricing?: { minQty: number; price: number }[]
  expiryDate?: string | null
}

export type ReceiptPayload = {
  supplierId?: string
  createdBy?: string
  paidNow?: number
  payFrom?: 'shift' | 'vault'
  method?: 'cash' | 'card'
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

/** Применить/откатить суммы прихода к долгу поставщика (+ bump supplyVersion). */
async function applySupplierReceiptTotals(
  supplierId: string | undefined,
  receiptTotal: number,
  paidNow: number,
  sign: 1 | -1,
  opts?: { supplyVersionDelta?: number },
) {
  if (!supplierId) return
  const total = round2(receiptTotal)
  const paid = round2(Math.max(0, paidNow))
  if (!(Math.abs(total) > 0.001) && !(Math.abs(paid) > 0.001)) return
  const verDelta = opts?.supplyVersionDelta ?? 1
  usePosStore.setState(s => ({
    suppliers: s.suppliers.map(sup => {
      if (sup.id !== supplierId) return sup
      const totalSupplied = round2(Math.max(0, (Number(sup.totalSupplied) || 0) + sign * total))
      const totalPaid = round2(Math.max(0, (Number(sup.totalPaid) || 0) + sign * paid))
      return {
        ...sup,
        totalSupplied,
        totalPaid,
        payableAmount: round2(Math.max(0, totalSupplied - totalPaid)),
        supplyVersion: Math.max(0, supplierSupplyVersion(sup) + verDelta),
        ...(sign > 0 ? { lastDeliveryAtIso: new Date().toISOString() } : {}),
      }
    }),
  }))
  if (sign < 0) await trimLocalSupplierOverpay(supplierId)
}

/**
 * После отката прихода убрать лишние отдельные оплаты (totalPaid > totalSupplied)
 * и вернуть кассу — как будто оплату не записывали.
 */
async function trimLocalSupplierOverpay(supplierId: string) {
  const { cacheData, readCachedData, persistPosSnapshot } = await import('./offline')
  const key = `supplier_payments_${supplierId}`
  let payments = ((await readCachedData<import('./types').SupplierPayment[]>(key)) || [])
    .slice()
    .sort((a, b) => String(b.paidAtIso || '').localeCompare(String(a.paidAtIso || '')))

  let changed = false

  const restoreCash = async (payment: import('./types').SupplierPayment, amount: number) => {
    if (!(amount > 0.001)) return
    const fromCash = (payment.payFrom && payment.payFrom !== 'book') || !!payment.financeMoveId
    if (!fromCash) return
    const { applyMoneyOutLocal } = await import('./offlinePosOps')
    applyMoneyOutLocal({
      amount,
      payFrom: payment.payFrom === 'vault' ? 'vault' : 'shift',
      method: payment.method === 'card' ? 'card' : 'cash',
      dir: -1,
      shiftId: payment.shiftId,
    })
    if (payment.financeMoveId) {
      usePosStore.setState(s => ({
        financeMoves: s.financeMoves.filter(m => m.id !== payment.financeMoveId),
      }))
    }
  }

  while (true) {
    const sup = usePosStore.getState().suppliers.find(s => s.id === supplierId)
    if (!sup) break
    const excess = round2((Number(sup.totalPaid) || 0) - (Number(sup.totalSupplied) || 0))
    if (!(excess > 0.001)) break

    if (!payments.length) {
      usePosStore.setState(s => ({
        suppliers: s.suppliers.map(x => {
          if (x.id !== supplierId) return x
          const totalSupplied = Number(x.totalSupplied) || 0
          return {
            ...x,
            totalPaid: totalSupplied,
            payableAmount: 0,
          }
        }),
      }))
      changed = true
      break
    }

    const payment = payments[0]
    const amt = round2(Number(payment.amount) || 0)
    if (!(amt > 0.001)) {
      payments = payments.slice(1)
      changed = true
      continue
    }

    if (amt <= excess + 0.009) {
      await restoreCash(payment, amt)
      payments = payments.slice(1)
      usePosStore.setState(s => ({
        suppliers: s.suppliers.map(x => {
          if (x.id !== supplierId) return x
          const totalPaid = round2(Math.max(0, (Number(x.totalPaid) || 0) - amt))
          const totalSupplied = Number(x.totalSupplied) || 0
          return {
            ...x,
            totalPaid,
            payableAmount: round2(Math.max(0, totalSupplied - totalPaid)),
          }
        }),
      }))
      changed = true
    } else {
      await restoreCash(payment, excess)
      payment.amount = round2(amt - excess)
      payments = [payment, ...payments.slice(1)]
      usePosStore.setState(s => ({
        suppliers: s.suppliers.map(x => {
          if (x.id !== supplierId) return x
          const totalPaid = round2(Math.max(0, (Number(x.totalPaid) || 0) - excess))
          const totalSupplied = Number(x.totalSupplied) || 0
          return {
            ...x,
            totalPaid,
            payableAmount: round2(Math.max(0, totalSupplied - totalPaid)),
          }
        }),
      }))
      changed = true
      break
    }
  }

  if (changed) {
    usePosStore.setState(s => ({
      suppliers: s.suppliers.map(x => {
        if (x.id !== supplierId) return x
        return { ...x, payVersion: supplierPayVersion(x) + 1 }
      }),
    }))
    await cacheData(key, payments)
    void persistPosSnapshot()
  }
}

function findReceipt(id: string): StockReceipt | undefined {
  const list = usePosStore.getState().receipts
  return list.find(r => r.id === id)
}

function linePurchaseTotal(it: ReceiptItemInput, qty: number, costPrice: number) {
  const explicit = round2(it.purchaseTotal || 0)
  if (explicit > 0) return explicit
  return round2(qty * costPrice)
}

function withPreservedRemaining(
  old: StockReceipt | undefined,
  items: StockReceipt['items'],
): StockReceipt['items'] {
  if (!old?.items?.length) return items
  return items.map(it => {
    const prev = old.items.find(p => p.productId === it.productId)
    if (!prev) return it
    const consumed = round2(Math.max(0, (Number(prev.qty) || 0) - (Number(prev.remainingQty) || 0)))
    const remainingQty = round2(Math.max(0, (Number(it.qty) || 0) - consumed))
    return { ...it, remainingQty }
  })
}

function buildLocalReceipt(
  payload: ReceiptPayload,
  opts: { id: string; clientRef: string; createdAtIso?: string; updatedAtIso?: string },
): StockReceipt {
  const items = payload.items.map(it => {
    const qty = round2(it.qty)
    const purchaseTotal = linePurchaseTotal(it, qty, round2(it.costPrice || 0))
    const costPrice = qty > 0 && purchaseTotal > 0
      ? round2(purchaseTotal / qty)
      : round2(it.costPrice || 0)
    const retailPrice = round2(it.retailPrice || 0)
    return {
      productId: it.productId,
      productName: `#${it.productId}`,
      qty,
      remainingQty: qty,
      costPrice,
      purchaseTotal,
      retailPrice: retailPrice > 0 ? retailPrice : undefined,
      bulkPricing: it.bulkPricing,
      expiryDate: it.expiryDate ?? null,
    }
  })

  const totalCost = round2(items.reduce((s, it) => s + (Number(it.purchaseTotal) || it.qty * it.costPrice), 0))
  const paidNow = round2(payload.paidNow || 0)
  const payFrom = payload.payFrom === 'vault' ? 'vault' as const : 'shift' as const
  const method = payload.method === 'card' ? 'card' as const : 'cash' as const
  const supplier = payload.supplierId
    ? usePosStore.getState().suppliers.find(s => s.id === payload.supplierId)
    : undefined

  return {
    id: opts.id,
    clientRef: opts.clientRef,
    supplierId: payload.supplierId || null,
    supplierName: supplier?.name || '',
    createdAtIso: opts.createdAtIso || new Date().toISOString(),
    updatedAtIso: opts.updatedAtIso || new Date().toISOString(),
    createdBy: payload.createdBy,
    totalCost,
    paidNow,
    debtAdded: round2(Math.max(0, totalCost - paidNow)),
    items,
    payFrom: paidNow > 0.001 ? payFrom : undefined,
    method: paidNow > 0.001 ? method : undefined,
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

async function applyReceiptStock(
  receipt: StockReceipt,
  sign: 1 | -1,
  opts?: { supplyVersionDelta?: number },
) {
  const { useProducts } = await import('./store')
  const ps = useProducts.getState()
  const bumps = new Map<number, {
    delta: number
    prices?: { costPrice?: number; retailPrice?: number; bulkPricing?: StockReceipt['items'][0]['bulkPricing'] }
  }>()
  for (const it of receipt.items) {
    const pid = Number(it.productId)
    const prev = bumps.get(pid) || { delta: 0 }
    prev.delta += sign * (Number(sign < 0 ? (it.remainingQty ?? it.qty) : (it.remainingQty ?? it.qty)) || 0)
    if (sign > 0) {
      prev.prices = { costPrice: it.costPrice, retailPrice: it.retailPrice, bulkPricing: it.bulkPricing }
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
    if (sign > 0 && prices?.bulkPricing !== undefined) {
      patch.bulkPricing = Array.isArray(prices.bulkPricing) && prices.bulkPricing.length
        ? prices.bulkPricing
        : undefined
    }
    ps.updateProduct(productId, patch as any)
  }
  await applySupplierReceiptTotals(
    receipt.supplierId || undefined,
    Number(receipt.totalCost) || 0,
    Number(receipt.paidNow) || 0,
    sign,
    opts,
  )
  try {
    const { applyLocalReceiptLayers } = await import('./stockLayersLocal')
    await applyLocalReceiptLayers(receipt, sign)
  } catch { /* ignore */ }
}

/** Откат локального прихода, если сервер отклонил из‑за версии долга */
export async function revertLocalStockReceiptCreateOnReject(localId: string) {
  const receipt = findReceipt(localId)
  if (!receipt) return
  const paid = round2(Number(receipt.paidNow) || 0)
  if (paid > 0.001) {
    applyPurchasePayToOpenShift(paid, -1, undefined, {
      payFrom: receipt.payFrom,
      method: receipt.method,
    })
  }
  await applyReceiptStock(receipt, -1, { supplyVersionDelta: -1 })
  usePosStore.setState(s => ({
    receipts: s.receipts.filter(r => r.id !== localId && r.id !== receipt.id),
  }))
}

/** Откат локального списания при отказе сервера */
export async function revertLocalStockWriteoffCreateOnReject(localId: string) {
  const writeoff = usePosStore.getState().writeoffs.find(w => w.id === localId)
  if (!writeoff) return
  await applyWriteoffStock(writeoff.items, -1)
  usePosStore.setState(s => ({
    writeoffs: s.writeoffs.filter(w => w.id !== localId && w.id !== writeoff.id),
  }))
}

/** Откат локальной ревизии при отказе сервера (координатор / версия / ошибка) */
export async function revertLocalStockRevisionCreateOnReject(localId: string) {
  const rev = usePosStore.getState().revisions.find(r => r.id === localId)
  if (!rev) return
  const coordinated = revisionUsesCoordinator({ waitDevices: rev.waitDevices })
  const appliedLocally = !coordinated || String(rev.status || '') === 'done'
  if (appliedLocally && Array.isArray(rev.items) && rev.items.length) {
    await reverseRevision(rev.items)
  }
  usePosStore.setState(s => ({
    revisions: s.revisions.filter(r => r.id !== localId && r.id !== rev.id),
  }))
}

function hasBlockingRevisionLocal(): boolean {
  const pendingStatus = new Set(['pending_queues', 'pending_older', 'applying'])
  return usePosStore.getState().revisions.some(r => pendingStatus.has(String(r.status || '')))
}

export async function createStockReceiptSafe(
  payload: ReceiptPayload,
): Promise<OfflineResult<StockReceipt>> {
  const clientRef = newClientRef()
  const createdAtIso = new Date().toISOString()
  const supplierName = payload.supplierId
    ? (usePosStore.getState().suppliers.find(s => s.id === payload.supplierId)?.name || '')
    : ''
  const expectedSupplyVersion = payload.supplierId
    ? supplierSupplyVersion(usePosStore.getState().suppliers.find(s => s.id === payload.supplierId))
    : undefined
  const body = {
    ...payload,
    clientRef,
    createdAtIso,
    paidNow: round2(payload.paidNow || 0),
    payFrom: payload.payFrom === 'vault' ? 'vault' : 'shift',
    method: payload.method === 'card' ? 'card' : 'cash',
    supplierName,
    ...(payload.supplierId ? { expectedSupplyVersion } : {}),
  }

  const applyLocal = async () => {
    const localId = newLocalId('rec')
    let receipt = buildLocalReceipt(payload, { id: localId, clientRef, createdAtIso })
    receipt = await enrichReceiptNames(receipt)
    const paid = round2(receipt.paidNow || 0)
    if (paid > 0.001) {
      const shiftId = applyPurchasePayToOpenShift(paid, 1, undefined, {
        payFrom: receipt.payFrom,
        method: receipt.method,
      })
      if (shiftId) receipt = { ...receipt, shiftId }
    }
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
  const mapped = isLocalId(id) ? await resolveLocalId(id) : id
  const persistId = mapped || id
  const clientRef = newClientRef()
  const supplierName = payload.supplierId
    ? (usePosStore.getState().suppliers.find(s => s.id === payload.supplierId)?.name || '')
    : ''
  const body = {
    ...payload,
    clientRef,
    id: persistId,
    paidNow: round2(payload.paidNow || 0),
    payFrom: payload.payFrom === 'vault' ? 'vault' : 'shift',
    method: payload.method === 'card' ? 'card' : 'cash',
    supplierName,
    ...(payload.supplierId || findReceipt(id)?.supplierId
      ? {
          expectedSupplyVersion: supplierSupplyVersion(
            usePosStore.getState().suppliers.find(
              s => s.id === (payload.supplierId || findReceipt(id)?.supplierId || ''),
            ),
          ),
        }
      : {}),
  }
  const nowIso = new Date().toISOString()

  const applyLocal = async () => {
    const old = findReceipt(id) || findReceipt(persistId)
    if (old) {
      const oldPaid = round2(old.paidNow || 0)
      if (oldPaid > 0.001) {
        applyPurchasePayToOpenShift(oldPaid, -1, undefined, {
          payFrom: old.payFrom,
          method: old.method,
        })
      }
      await applyReceiptStock(old, -1)
    }
    const liveId = old?.id || persistId
    let receipt = buildLocalReceipt(payload, {
      id: liveId,
      clientRef: old?.clientRef || clientRef,
      createdAtIso: old?.createdAtIso,
      updatedAtIso: nowIso,
    })
    receipt = { ...receipt, items: withPreservedRemaining(old, receipt.items) }
    receipt = await enrichReceiptNames(receipt)
    const paid = round2(receipt.paidNow || 0)
    if (paid > 0.001) {
      const shiftId = applyPurchasePayToOpenShift(paid, 1, undefined, {
        payFrom: receipt.payFrom,
        method: receipt.method,
      })
      if (shiftId) receipt = { ...receipt, shiftId }
    }
    await applyReceiptStock(receipt, 1)
    await useOfflineSync.getState().queueOp('stock_receipt_update', { ...body, id: liveId })
    usePosStore.setState(s => ({
      receipts: s.receipts.map(r => (r.id === id || r.id === persistId || r.id === liveId ? receipt : r)),
    }))
    return receipt
  }

  if (isLocalId(id) && (!mapped || isLocalId(mapped))) {
    const data = await applyLocal()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data }
  }

  return raceWarehouseOp(() => api.updateStockReceipt(persistId, { ...body, id: persistId }), applyLocal)
}

export async function deleteStockReceiptSafe(id: string): Promise<OfflineResult<{ id: string }>> {
  const mapped = isLocalId(id) ? await resolveLocalId(id) : id
  const persistId = mapped || id
  const clientRef = newClientRef()
  const body = { clientRef, id: persistId }

  const applyLocal = async () => {
    const old = findReceipt(id) || findReceipt(persistId)
    if (old) {
      const oldPaid = round2(old.paidNow || 0)
      if (oldPaid > 0.001) {
        applyPurchasePayToOpenShift(oldPaid, -1, undefined, {
          payFrom: old.payFrom,
          method: old.method,
        })
      }
      await applyReceiptStock(old, -1)
    }
    await useOfflineSync.getState().queueOp('stock_receipt_delete', body)
    usePosStore.setState(s => ({
      receipts: s.receipts.filter(r => r.id !== id && r.id !== persistId && r.id !== old?.id),
    }))
    return { id: persistId }
  }

  if (isLocalId(id) && (!mapped || isLocalId(mapped))) {
    const data = await applyLocal()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data }
  }

  return raceWarehouseOp(
    () => api.deleteStockReceipt(persistId, { clientRef }),
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
  items: { productId: number; countedStock: number; systemStock?: number }[]
  /** Кого сервер ждёт перед ±; из формы ревизии */
  waitDevices?: RevisionWaitDevice[]
}

async function setProductStockExact(productId: number, stock: number) {
  const { useProducts } = await import('./store')
  const ps = useProducts.getState()
  const p = ps.products.find(x => x.id === productId)
  if (!p) return
  ps.updateProduct(productId, { stock: round2(Math.max(0, stock)) } as any)
}

async function applyRevisionDelta(
  items: { productId: number; countedStock: number; systemStock?: number }[],
) {
  const { useProducts } = await import('./store')
  const ps = useProducts.getState()
  for (const it of items) {
    const p = ps.products.find(x => x.id === it.productId)
    const liveNow = round2(Number(p?.stock) || 0)
    const frozen = Number.isFinite(Number(it.systemStock)) ? round2(Number(it.systemStock)) : liveNow
    const counted = round2(Number(it.countedStock) || 0)
    const target = Math.max(0, round2(liveNow + (counted - frozen)))
    await setProductStockExact(it.productId, target)
  }
}

async function reverseRevision(items: { productId: number; systemStock: number; stockBefore?: number }[]) {
  for (const it of items) {
    const restore = it.stockBefore != null ? Number(it.stockBefore) : Number(it.systemStock)
    await setProductStockExact(it.productId, restore || 0)
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
    const liveNow = round2(Number(p?.stock) || 0)
    const frozen = Number.isFinite(Number(it.systemStock)) ? round2(Number(it.systemStock)) : liveNow
    const countedStock = round2(Number(it.countedStock) || 0)
    return {
      productId: it.productId,
      productName: p?.name || `#${it.productId}`,
      systemStock: frozen,
      countedStock,
      diff: round2(countedStock - frozen),
      stockBefore: liveNow,
    }
  })
  // Срез opSeq по точкам/аппаратам + список устройств для ожидания на сервере
  const posCuts = buildRevisionPosCuts()
  const waitDevices = payload.waitDevices?.length
    ? payload.waitDevices
    : resolveRevisionWaitDevices(null)
  const sourceDeviceId = getTradeDeviceIdSync()
  const coordinated = revisionUsesCoordinator({ waitDevices })
  return {
    id: opts.id,
    clientRef: opts.clientRef,
    createdAtIso: opts.createdAtIso || new Date().toISOString(),
    createdBy: payload.createdBy,
    note: payload.note,
    items,
    posCuts,
    sourceDeviceId: sourceDeviceId || undefined,
    waitDevices: waitDevices.length ? waitDevices : undefined,
    status: coordinated ? 'pending_queues' : undefined,
  }
}

export async function createStockRevisionSafe(
  payload: RevisionPayload,
): Promise<OfflineResult<StockRevision>> {
  if (hasBlockingRevisionLocal()) {
    throw new Error('Дождитесь завершения текущей ревизии')
  }
  try {
    const { getPending } = await import('./offline')
    const pending = await getPending()
    if (pending.some(r => !r.failed && (r.kind === 'stock_revision_create' || r.kind === 'stock_revision_update'))) {
      throw new Error('Дождитесь отправки текущей ревизии')
    }
  } catch (e) {
    if (e instanceof Error && /дождитесь/i.test(e.message)) throw e
  }

  const clientRef = newClientRef()
  const createdAtIso = new Date().toISOString()
  const waitDevices = payload.waitDevices?.length
    ? payload.waitDevices
    : resolveRevisionWaitDevices(null)
  const meta = buildRevisionSubmitMeta({ waitDevices })
  const coordinated = revisionUsesCoordinator({ waitDevices: meta.waitDevices })
  const body = {
    ...payload,
    clientRef,
    createdAtIso,
    submittedAtIso: meta.submittedAtIso,
    sourceDeviceId: meta.sourceDeviceId,
    waitDevices: meta.waitDevices,
    posCuts: meta.posCuts,
    items: payload.items.map(it => ({
      productId: it.productId,
      countedStock: round2(it.countedStock),
      ...(Number.isFinite(Number(it.systemStock)) ? { systemStock: round2(Number(it.systemStock)) } : {}),
    })),
  }

  const applyLocal = async () => {
    const localId = newLocalId('rev')
    const revision = await buildLocalRevision(payload, { id: localId, clientRef, createdAtIso })
    await useOfflineSync.getState().queueOp('stock_revision_create', body, { localId })
    if (!coordinated) {
      await applyRevisionDelta(payload.items)
    }
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
  const old = usePosStore.getState().revisions.find(r => r.id === id)
  const waitDevices = payload.waitDevices?.length
    ? payload.waitDevices
    : resolveRevisionWaitDevices(null)
  const meta = buildRevisionSubmitMeta({ waitDevices })
  const body = {
    ...payload,
    clientRef,
    id,
    createdAtIso: old?.createdAtIso,
    submittedAtIso: meta.submittedAtIso,
    sourceDeviceId: meta.sourceDeviceId,
    waitDevices: meta.waitDevices,
    posCuts: meta.posCuts,
    items: payload.items.map(it => ({
      productId: it.productId,
      countedStock: round2(it.countedStock),
      ...(Number.isFinite(Number(it.systemStock)) ? { systemStock: round2(Number(it.systemStock)) } : {}),
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
    await applyRevisionDelta(payload.items)
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

export async function cancelStockRevisionSafe(id: string): Promise<OfflineResult<StockRevision>> {
  const rev = usePosStore.getState().revisions.find(r => r.id === id)
  if (!rev) throw new Error('Ревизия не найдена')

  const applyLocal = async () => {
    usePosStore.setState(s => ({
      revisions: s.revisions.map(r => (
        r.id === id ? { ...r, status: 'cancelled' as const, cancelledAtIso: new Date().toISOString() } : r
      )),
    }))
    return usePosStore.getState().revisions.find(r => r.id === id)!
  }

  if (isLocalId(id)) {
    const data = await applyLocal()
    return { offline: true, data }
  }

  try {
    const data = await api.cancelStockRevision(id)
    usePosStore.setState(s => ({
      revisions: s.revisions.map(r => (r.id === id ? { ...r, ...data } : r)),
    }))
    return { offline: false, data }
  } catch (e) {
    if (isNetworkError(e)) {
      const data = await applyLocal()
      return { offline: true, data }
    }
    throw e
  }
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
    {
      const { useProducts } = await import('./store')
      const patch: Record<string, unknown> = {}
      if (body.retailPrice != null && body.retailPrice > 0) patch.price = body.retailPrice
      if (body.costPrice != null && body.costPrice > 0) patch.costPrice = body.costPrice
      if (body.bulkPricing !== undefined) {
        const bulk = Array.isArray(body.bulkPricing) && body.bulkPricing.length ? body.bulkPricing : undefined
        patch.bulkPricing = bulk
      }
      if (Object.keys(patch).length) useProducts.getState().updateProduct(productId, patch as any)
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
        await applySupplierReceiptTotals(
          receipt.supplierId || undefined,
          Number(receipt.totalCost) || 0,
          Number(receipt.paidNow) || 0,
          -1,
        )
        usePosStore.setState(s => ({ receipts: s.receipts.filter(r => r.id !== receiptId) }))
      } else {
        const oldTotal = round2(Number(receipt.totalCost) || 0)
        const oldPaid = round2(Number(receipt.paidNow) || 0)
        const newTotal = round2(itemsLeft.reduce(
          (s, it) => s + (Number(it.qty) || 0) * (Number(it.costPrice) || 0),
          0,
        ))
        const newPaid = round2(Math.min(Number(receipt.paidNow) || 0, newTotal))
        const newDebt = round2(Math.max(0, newTotal - newPaid))
        // откат старых сумм + применение новых (две bump-версии, как reverse+update на сервере)
        await applySupplierReceiptTotals(receipt.supplierId || undefined, oldTotal, oldPaid, -1)
        await applySupplierReceiptTotals(receipt.supplierId || undefined, newTotal, newPaid, 1)
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
