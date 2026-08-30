// ════════════════════════════════════════════════
// KAKAPO — поставщики офлайн (Offline V2)
// CRUD + оплаты долга (без кассового движения).
// Оплата с кассы (finance_move + supplierId) — по-прежнему только онлайн.
// ════════════════════════════════════════════════
import { api } from './api'
import { isLocalId, newClientRef, newLocalId, persistPosSnapshot } from './offline'
import { localFirstOp, type OfflineResult } from './localFirst'
import { isTradeLocalFirst, shadowMirrorPut } from './offlineV2'
import { useOfflineSync } from './offlineSync'
import { usePosStore } from './posStore'
import type { PosSupplier, SupplierPayment } from './types'

function round2(v: number) {
  return Math.round((Number(v) || 0) * 100) / 100
}

/** Лента оплат (с миграцией со старого debtVersion) */
export function supplierPayVersion(sup?: Pick<PosSupplier, 'payVersion' | 'debtVersion'> | null): number {
  if (!sup) return 0
  if (sup.payVersion != null && Number.isFinite(Number(sup.payVersion))) return Number(sup.payVersion) || 0
  return Number(sup.debtVersion) || 0
}

/** Лента приходов (с миграцией со старого debtVersion) */
export function supplierSupplyVersion(sup?: Pick<PosSupplier, 'supplyVersion' | 'debtVersion'> | null): number {
  if (!sup) return 0
  if (sup.supplyVersion != null && Number.isFinite(Number(sup.supplyVersion))) return Number(sup.supplyVersion) || 0
  return Number(sup.debtVersion) || 0
}

export type { OfflineResult }

export type SupplierPayload = {
  name: string
  category?: string
  phone?: string
  address?: string
  note?: string
}

/** Local-first: сразу локально, сервер в фоне. apiCall игнорируется. */
async function raceOp<T>(
  _apiCall: () => Promise<T>,
  localApply: () => Promise<T> | T,
  _slowMsg?: string,
): Promise<OfflineResult<T>> {
  return localFirstOp(localApply)
}

function patchSuppliers(next: PosSupplier[]) {
  usePosStore.setState({ suppliers: next })
  void persistPosSnapshot()
}

function applyPaymentToSupplier(supplierId: string, amountDelta: number) {
  patchSuppliers(usePosStore.getState().suppliers.map(sup => {
    if (sup.id !== supplierId) return sup
    const totalPaid = round2(Math.max(0, (Number(sup.totalPaid) || 0) + amountDelta))
    const totalSupplied = Number(sup.totalSupplied) || 0
    return {
      ...sup,
      totalPaid,
      payableAmount: round2(Math.max(0, totalSupplied - totalPaid)),
      payVersion: supplierPayVersion(sup) + 1,
    }
  }))
}

/** Откат локальной оплаты, если сервер отклонил из‑за версии оплат */
export function revertLocalSupplierPaymentOnReject(supplierId: string, amount: number) {
  const amt = round2(amount)
  if (!supplierId || !(amt > 0)) return
  patchSuppliers(usePosStore.getState().suppliers.map(sup => {
    if (sup.id !== supplierId) return sup
    const totalPaid = round2(Math.max(0, (Number(sup.totalPaid) || 0) - amt))
    const totalSupplied = Number(sup.totalSupplied) || 0
    return {
      ...sup,
      totalPaid,
      payableAmount: round2(Math.max(0, totalSupplied - totalPaid)),
      payVersion: Math.max(0, supplierPayVersion(sup) - 1),
    }
  }))
  shadowMirrorPut('supplier', supplierId, usePosStore.getState().suppliers.find(s => s.id === supplierId))
}

/** Создать / обновить поставщика. При V2=on — без сети. */
export async function saveSupplierSafe(
  payload: SupplierPayload,
  editingId?: string | null,
): Promise<OfflineResult<PosSupplier>> {
  const cleaned: SupplierPayload = {
    name: payload.name.trim(),
    category: payload.category?.trim() || undefined,
    phone: payload.phone?.trim() || undefined,
    address: payload.address?.trim() || undefined,
    note: payload.note?.trim() || undefined,
  }

  if (!isTradeLocalFirst()) {
    const saved = editingId
      ? await api.updateSupplier(editingId, cleaned)
      : await api.createSupplier(cleaned)
    shadowMirrorPut('supplier', saved.id, saved)
    return { offline: false, data: saved }
  }

  const applyLocal = async () => {
    const clientRef = newClientRef()
    const suppliers = usePosStore.getState().suppliers
    let supplier: PosSupplier

    if (editingId) {
      const prev = suppliers.find(s => s.id === editingId)
      supplier = {
        id: editingId,
        name: cleaned.name,
        category: cleaned.category,
        phone: cleaned.phone,
        address: cleaned.address,
        note: cleaned.note,
        payableAmount: prev?.payableAmount || 0,
        totalSupplied: prev?.totalSupplied || 0,
        totalPaid: prev?.totalPaid || 0,
        payVersion: supplierPayVersion(prev),
        supplyVersion: supplierSupplyVersion(prev),
        lastDeliveryAtIso: prev?.lastDeliveryAtIso,
      }
      patchSuppliers(suppliers.map(s => (s.id === editingId ? supplier : s)))
    } else {
      const localId = newLocalId('sup')
      supplier = {
        id: localId,
        name: cleaned.name,
        category: cleaned.category,
        phone: cleaned.phone,
        address: cleaned.address,
        note: cleaned.note,
        payableAmount: 0,
        totalSupplied: 0,
        totalPaid: 0,
        payVersion: 0,
        supplyVersion: 0,
      }
      patchSuppliers([supplier, ...suppliers])
    }

    await useOfflineSync.getState().queueOp(
      'supplier_upsert',
      { clientRef, localId: supplier.id, supplier: { ...supplier, ...cleaned } },
      { localId: supplier.id, clientRef },
    )
    shadowMirrorPut('supplier', supplier.id, supplier)
    return supplier
  }

  return raceOp(async () => {
    if (editingId && !isLocalId(editingId)) {
      const saved = await api.updateSupplier(editingId, cleaned)
      patchSuppliers(usePosStore.getState().suppliers.map(s => (s.id === saved.id ? saved : s)))
      shadowMirrorPut('supplier', saved.id, saved)
      return saved
    }
    const saved = await api.createSupplier(cleaned)
    const list = usePosStore.getState().suppliers
    patchSuppliers([saved, ...list.filter(s => s.id !== saved.id)])
    shadowMirrorPut('supplier', saved.id, saved)
    return saved
  }, applyLocal)
}

export async function deleteSupplierSafe(id: string): Promise<OfflineResult<{ id: string }>> {
  const clientRef = newClientRef()

  if (!isTradeLocalFirst()) {
    await api.deleteSupplier(id)
    return { offline: false, data: { id } }
  }

  const applyLocal = async () => {
    await useOfflineSync.getState().queueOp('supplier_delete', { clientRef, id }, { clientRef })
    patchSuppliers(usePosStore.getState().suppliers.filter(s => s.id !== id))
    return { id }
  }

  if (isLocalId(id)) {
    const data = await applyLocal()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data }
  }

  return raceOp(async () => {
    await api.deleteSupplier(id)
    patchSuppliers(usePosStore.getState().suppliers.filter(s => s.id !== id))
    return { id }
  }, applyLocal)
}

/** Оплата долга поставщику (без движения по кассе). При V2=on — без сети. */
export async function createSupplierPaymentSafe(
  supplierId: string,
  input: { amount: number; note?: string },
): Promise<OfflineResult<SupplierPayment>> {
  const amount = round2(input.amount)
  if (!(amount > 0)) throw new Error('Укажите сумму оплаты')

  const snapPayVersion = () => {
    const s = usePosStore.getState().suppliers.find(x => x.id === supplierId)
    return supplierPayVersion(s)
  }

  if (!isTradeLocalFirst()) {
    const pay = await api.createSupplierPayment(supplierId, {
      amount,
      note: input.note,
      expectedPayVersion: snapPayVersion(),
    })
    return { offline: false, data: pay }
  }

  const clientRef = newClientRef()
  const paidAtIso = new Date().toISOString()
  const expectedPayVersion = snapPayVersion()
  const payload = {
    clientRef,
    supplierId,
    amount,
    note: input.note,
    paidAtIso,
    expectedPayVersion,
  }

  const applyLocal = async () => {
    const localId = newLocalId('spay')
    const supplier = usePosStore.getState().suppliers.find(s => s.id === supplierId)
    const pay: SupplierPayment = {
      id: localId,
      supplierId,
      supplierName: supplier?.name || '',
      amount,
      paidAtIso,
      note: input.note,
      clientRef,
    }
    await useOfflineSync.getState().queueOp('supplier_payment_create', payload, {
      localId,
      clientRef,
    })
    applyPaymentToSupplier(supplierId, amount)
    shadowMirrorPut('supplier', supplierId, usePosStore.getState().suppliers.find(s => s.id === supplierId))
    return pay
  }

  return raceOp(
    async () => {
      const pay = await api.createSupplierPayment(supplierId, {
        amount,
        note: input.note,
        clientRef,
        expectedPayVersion,
      })
      applyPaymentToSupplier(supplierId, amount)
      return pay
    },
    applyLocal,
    'Медленная связь — оплата сохранена локально',
  )
}

/** Откат локального удаления оплаты, если сервер отклонил по payVersion */
export function revertLocalSupplierPaymentDeleteOnReject(
  supplierId: string,
  amount: number,
  payment?: Partial<SupplierPayment> | null,
) {
  const amt = round2(amount)
  if (!supplierId || !(amt > 0)) return
  // удаление локально: totalPaid−, payVersion+1 → откат: totalPaid+, payVersion−1
  patchSuppliers(usePosStore.getState().suppliers.map(sup => {
    if (sup.id !== supplierId) return sup
    const totalPaid = round2((Number(sup.totalPaid) || 0) + amt)
    const totalSupplied = Number(sup.totalSupplied) || 0
    return {
      ...sup,
      totalPaid,
      payableAmount: round2(Math.max(0, totalSupplied - totalPaid)),
      payVersion: Math.max(0, supplierPayVersion(sup) - 1),
    }
  }))
  shadowMirrorPut('supplier', supplierId, usePosStore.getState().suppliers.find(s => s.id === supplierId))
  if (payment?.id) {
    void import('./offline').then(({ cacheData, readCachedData }) => {
      void (async () => {
        const key = `supplier_payments_${supplierId}`
        const prev = (await readCachedData<SupplierPayment[]>(key)) || []
        if (prev.some(p => p.id === payment.id)) return
        const row: SupplierPayment = {
          id: String(payment.id),
          supplierId,
          supplierName: String(payment.supplierName || ''),
          amount: amt,
          paidAtIso: String(payment.paidAtIso || new Date().toISOString()),
          note: payment.note,
          clientRef: payment.clientRef,
          payFrom: payment.payFrom,
          method: payment.method,
          financeMoveId: payment.financeMoveId,
          shiftId: payment.shiftId,
        }
        await cacheData(key, [row, ...prev])
      })()
    })
  }
}

export async function deleteSupplierPaymentSafe(
  supplierId: string,
  paymentId: string,
  amountHint?: number,
): Promise<OfflineResult<{ id: string }>> {
  const snapPay = () => {
    const s = usePosStore.getState().suppliers.find(x => x.id === supplierId)
    return supplierPayVersion(s)
  }

  if (!isTradeLocalFirst()) {
    await api.deleteSupplierPayment(supplierId, paymentId, {
      expectedPayVersion: snapPay(),
    })
    return { offline: false, data: { id: paymentId } }
  }

  const clientRef = newClientRef()
  const expectedPayVersion = snapPay()
  const amount = round2(Number(amountHint) || 0)
  let paymentSnap: Partial<SupplierPayment> | undefined
  try {
    const { readCachedData } = await import('./offline')
    const list = (await readCachedData<SupplierPayment[]>(`supplier_payments_${supplierId}`)) || []
    paymentSnap = list.find(p => p.id === paymentId)
  } catch { /* ignore */ }

  const payload = {
    clientRef,
    supplierId,
    paymentId,
    expectedPayVersion,
    amount,
    payment: paymentSnap
      ? {
          id: paymentSnap.id,
          supplierName: paymentSnap.supplierName,
          amount: paymentSnap.amount ?? amount,
          paidAtIso: paymentSnap.paidAtIso,
          note: paymentSnap.note,
          clientRef: paymentSnap.clientRef,
          payFrom: paymentSnap.payFrom,
          method: paymentSnap.method,
          financeMoveId: paymentSnap.financeMoveId,
          shiftId: paymentSnap.shiftId,
        }
      : amount > 0
        ? { id: paymentId, amount, supplierId }
        : undefined,
  }

  const applyLocal = async () => {
    await useOfflineSync.getState().queueOp('supplier_payment_delete', payload, { clientRef })
    if (amount > 0) applyPaymentToSupplier(supplierId, -amount)
    shadowMirrorPut('supplier', supplierId, usePosStore.getState().suppliers.find(s => s.id === supplierId))
    return { id: paymentId }
  }

  if (isLocalId(paymentId)) {
    const data = await applyLocal()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data }
  }

  return raceOp(
    async () => {
      await api.deleteSupplierPayment(supplierId, paymentId, {
        clientRef,
        expectedPayVersion,
      })
      if (amount > 0) applyPaymentToSupplier(supplierId, -amount)
      return { id: paymentId }
    },
    applyLocal,
    'Медленная связь — удаление оплаты сохранено локально',
  )
}
