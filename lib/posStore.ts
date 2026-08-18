'use client'

import { create } from 'zustand'
import { api } from './api'
import { USE_API } from './config'
import { mergeInboundById } from './syncConflict'
import type {
  CashVault,
  FinanceMove,
  PosCashier,
  PosExpense,
  PosPoint,
  PosSale,
  PosShift,
  PosSupplier,
  StockReceipt,
  StockRevision,
  StockWriteoff,
} from './types'

const EMPTY_VAULT: CashVault = { cashTotal: 0, cardTotal: 0, transfers: [] }

/** Пока удаление ещё в очереди — входящий sync не должен вернуть строку. */
const inboundDeletedIds = new Set<string>()
const inboundDeletedTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function noteInboundDeletedIds(ids: Array<string | undefined | null>) {
  for (const raw of ids) {
    const id = String(raw || '').trim()
    if (!id) continue
    inboundDeletedIds.add(id)
    const prev = inboundDeletedTimers.get(id)
    if (prev) clearTimeout(prev)
    inboundDeletedTimers.set(id, setTimeout(() => {
      inboundDeletedIds.delete(id)
      inboundDeletedTimers.delete(id)
    }, 60_000))
  }
}

function omitInboundDeleted<T extends { id?: string }>(list: T[]): T[] {
  if (!inboundDeletedIds.size || !list?.length) return list
  return list.filter(row => !inboundDeletedIds.has(String(row?.id || '')))
}

async function pendingDeleteIds(): Promise<Set<string>> {
  try {
    const { getPending } = await import('./offline')
    const pending = await getPending()
    const ids = new Set<string>()
    for (const row of pending) {
      if (row.failed) continue
      if (!String(row.kind || '').includes('delete')) continue
      const p = (row.payload || {}) as Record<string, unknown>
      for (const key of ['id', 'paymentId', 'receiptId']) {
        const v = String(p[key] || '').trim()
        if (v) ids.add(v)
      }
    }
    return ids
  } catch {
    return new Set()
  }
}

function dropDeletedRemote<T extends { id?: string }>(remote: T[], extra: Set<string>): T[] {
  const hide = extra.size || inboundDeletedIds.size
  if (!hide) return remote
  return (remote || []).filter(row => {
    const id = String(row?.id || '')
    if (!id) return false
    if (inboundDeletedIds.has(id) || extra.has(id)) return false
    return true
  })
}

/** Сервер + локальные сдачи, которых ещё нет на сервере */
function mergeCashVault(local: CashVault | undefined, server: CashVault): CashVault {
  const serverTransfers = server.transfers || []
  const serverShiftIds = new Set(serverTransfers.map(t => String(t.shiftId)))
  const localOnly = (local?.transfers || []).filter(t => t.shiftId && !serverShiftIds.has(String(t.shiftId)))
  if (!localOnly.length) {
    return {
      cashTotal: Number(server.cashTotal) || 0,
      cardTotal: Number(server.cardTotal) || 0,
      transfers: serverTransfers,
    }
  }
  const extraCash = localOnly.reduce((a, t) => a + (Number(t.cashAmount) || 0), 0)
  const extraCard = localOnly.reduce((a, t) => a + (Number(t.cardAmount) || 0), 0)
  return {
    cashTotal: Math.round(((Number(server.cashTotal) || 0) + extraCash) * 100) / 100,
    cardTotal: Math.round(((Number(server.cardTotal) || 0) + extraCard) * 100) / 100,
    transfers: [...localOnly, ...serverTransfers].sort((a, b) =>
      String(b.closedAtIso || '').localeCompare(String(a.closedAtIso || '')),
    ),
  }
}

export interface PosStore {
  cashiers: PosCashier[]
  posPoints: PosPoint[]
  shifts: PosShift[]
  sales: PosSale[]
  receipts: StockReceipt[]
  writeoffs: StockWriteoff[]
  revisions: StockRevision[]
  suppliers: PosSupplier[]
  expenses: PosExpense[]
  financeMoves: FinanceMove[]
  cashVault: CashVault
  expiry: Array<{
    receiptId: string
    receiptCreatedAtIso?: string
    productId: number
    productName: string
    qty: number
    costPrice?: number
    retailPrice?: number
    expiryDate: string
    daysLeft: number
  }>
  financeSummary: any
  report: any
  apiReady: boolean
  apiSyncing: boolean
  apiError: string
  fetchFromApi: () => Promise<void>
}

export const usePosStore = create<PosStore>((set) => ({
  cashiers: [],
  posPoints: [],
  shifts: [],
  sales: [],
  receipts: [],
  writeoffs: [],
  revisions: [],
  suppliers: [],
  expenses: [],
  financeMoves: [],
  cashVault: { ...EMPTY_VAULT, transfers: [] },
  expiry: [],
  financeSummary: null,
  report: null,
  apiReady: !USE_API,
  apiSyncing: false,
  apiError: '',
  fetchFromApi: async () => {
    if (!USE_API) {
      set({ apiReady: true, apiSyncing: false, apiError: '' })
      return
    }
    const alreadyReady = usePosStore.getState().apiReady
    if (!alreadyReady) set({ apiSyncing: true, apiError: '' })
    else set({ apiError: '' })
    try {
      const [
        cashiers,
        posPoints,
        shifts,
        sales,
        receipts,
        writeoffs,
        revisions,
        suppliers,
        expenses,
        financeMoves,
        cashVault,
        expiry,
        financeSummary,
        report,
      ] = await Promise.all([
        api.getCashiers(),
        api.getPosPoints(),
        api.getPosShifts(),
        api.getPosSales(),
        api.getStockReceipts(),
        api.getStockWriteoffs(),
        api.getStockRevisions(),
        api.getSuppliers(),
        api.getExpenses(),
        api.getFinanceMoves(),
        api.getCashVault().catch(() => ({ ...EMPTY_VAULT, transfers: [] as CashVault['transfers'] })),
        api.getStockExpiry(),
        api.getPosFinanceSummary(),
        api.getPosReport(),
      ])
      const snapshot = {
        cashiers,
        posPoints,
        shifts,
        sales,
        receipts,
        writeoffs,
        revisions,
        suppliers,
        expenses,
        financeMoves,
        cashVault: mergeCashVault(
          usePosStore.getState().cashVault,
          cashVault || { ...EMPTY_VAULT, transfers: [] },
        ),
        expiry,
        financeSummary,
        report,
      }
      const local = usePosStore.getState()
      try {
        const { getPending } = await import('./offline')
        const pending = await getPending()
        const pendingSupplierIds = new Set(
          pending
            .filter(r => !r.failed && r.kind === 'supplier_upsert')
            .map(r => String(r.payload?.localId || r.payload?.supplier?.id || r.payload?.id || ''))
            .filter(Boolean),
        )
        if (pendingSupplierIds.size) {
          const localById = new Map(local.suppliers.map(s => [String(s.id), s]))
          snapshot.suppliers = (snapshot.suppliers || []).map(s => {
            if (!pendingSupplierIds.has(String(s.id))) return s
            const loc = localById.get(String(s.id))
            if (!loc) return s
            return {
              ...s,
              name: loc.name,
              phone: loc.phone,
              address: loc.address,
              note: loc.note,
              category: loc.category,
            }
          })
          for (const loc of local.suppliers) {
            if (!pendingSupplierIds.has(String(loc.id))) continue
            if (!snapshot.suppliers.some(s => String(s.id) === String(loc.id))) {
              snapshot.suppliers.push(loc)
            }
          }
        }
        const pendingCashierIds = new Set(
          pending
            .filter(r => !r.failed && r.kind === 'cashier_upsert')
            .map(r => String(r.payload?.localId || r.payload?.cashier?.id || r.payload?.id || ''))
            .filter(Boolean),
        )
        if (pendingCashierIds.size) {
          const localById = new Map(local.cashiers.map(c => [String(c.id), c]))
          snapshot.cashiers = (snapshot.cashiers || []).map(c => {
            if (!pendingCashierIds.has(String(c.id))) return c
            const loc = localById.get(String(c.id))
            return loc ? { ...c, name: loc.name } : c
          })
          for (const loc of local.cashiers) {
            if (!pendingCashierIds.has(String(loc.id))) continue
            if (!snapshot.cashiers.some(c => String(c.id) === String(loc.id))) {
              snapshot.cashiers.push(loc)
            }
          }
        }
      } catch { /* очередь недоступна */ }
      const delIds = await pendingDeleteIds()
      snapshot.sales = omitInboundDeleted(mergeInboundById(local.sales, dropDeletedRemote(snapshot.sales, delIds)))
      snapshot.shifts = mergeInboundById(local.shifts, snapshot.shifts)
      snapshot.receipts = omitInboundDeleted(mergeInboundById(local.receipts, dropDeletedRemote(snapshot.receipts, delIds)))
      snapshot.writeoffs = omitInboundDeleted(mergeInboundById(local.writeoffs, dropDeletedRemote(snapshot.writeoffs, delIds)))
      snapshot.revisions = omitInboundDeleted(mergeInboundById(local.revisions, dropDeletedRemote(snapshot.revisions, delIds)))
      snapshot.expenses = omitInboundDeleted(mergeInboundById(local.expenses, dropDeletedRemote(snapshot.expenses, delIds)))
      snapshot.financeMoves = omitInboundDeleted(mergeInboundById(local.financeMoves, dropDeletedRemote(snapshot.financeMoves, delIds)))
      set({ ...snapshot, apiReady: true, apiSyncing: false, apiError: '' })
      try {
        const { notePosOpSeqFromSales, notePosOpSeqFromPoints } = await import('./posOpSeq')
        notePosOpSeqFromPoints(posPoints)
        notePosOpSeqFromSales(sales)
      } catch { /* ignore */ }
      try {
        const { cacheData } = await import('./offline')
        void cacheData('pos_snapshot', snapshot)
      } catch { /* кэш недоступен */ }
    } catch (e) {
      // нет связи — при первом запуске поднимаем данные из офлайн-кэша
      if (!alreadyReady) {
        try {
          const { readCachedData } = await import('./offline')
          const cached = await readCachedData<Partial<PosStore>>('pos_snapshot')
          if (cached) {
            set({
              ...cached,
              cashVault: cached.cashVault || { ...EMPTY_VAULT, transfers: [] },
              apiReady: true,
              apiSyncing: false,
              apiError: '',
            })
            return
          }
        } catch { /* нет кэша */ }
      }
      set({
        apiReady: alreadyReady || true,
        apiSyncing: false,
        // Не пугаем Финансы/Отчёты красной ошибкой — локальные данные уже есть
        apiError: '',
      })
    }
  },
}))

export async function syncPosFromApi() {
  await usePosStore.getState().fetchFromApi()
}

/** Лёгкое обновление после чека — только продажи и смены, без склада/финансов.
 *  Не затирает локальные правки смены, пока в очереди есть операции, влияющие на кассу. */
const SHIFT_PENDING_KINDS = new Set([
  'sale',
  'sale_return',
  'finance_move',
  'finance_move_delete',
  'expense_create',
  'expense_delete',
  'shift_open',
  'shift_close',
  'debt_repay',
  'vault_card_to_cash',
  'vault_cash_to_card',
])

export async function softSyncPosAfterSale() {
  try {
    const [sales, shifts] = await Promise.all([
      api.getPosSales(),
      api.getPosShifts(),
    ])

    const { getPending } = await import('./offline')
    const pending = await getPending()
    const protectShifts = pending.some(r => !r.failed && SHIFT_PENDING_KINDS.has(r.kind))

    // Состояние читаем после await — иначе потеряем чеки, пробитые во время запроса
    const localSales = usePosStore.getState().sales

    // Серверные чеки + локальные ещё не ушедшие; имя кассира не затираем пустым «Кассир»
    const localById = new Map(localSales.map(s => [String(s.id), s]))
    const localByRef = new Map(
      localSales
        .filter(s => (s as { clientRef?: string }).clientRef)
        .map(s => [String((s as { clientRef?: string }).clientRef), s]),
    )
    const isGenericCashier = (n?: string) => {
      const t = String(n || '').trim()
      return !t || /^кассир$/i.test(t)
    }
    const enrichedServer = sales.map(s => {
      const local = localById.get(String(s.id))
        || (s.clientRef ? localByRef.get(String(s.clientRef)) : undefined)
      if (!local) return s
      if (isGenericCashier(s.cashierName) && !isGenericCashier(local.cashierName)) {
        return { ...s, cashierName: local.cashierName, cashierId: s.cashierId || local.cashierId }
      }
      return s
    })
    const mergedSales = mergeInboundById(localSales, enrichedServer)

    const prevIds = new Set(localSales.map(s => String(s.id)))
    const hasNewFromServer = enrichedServer.some(s => !prevIds.has(String(s.id)))
    const keptLocal = mergedSales.some(s => String(s.id || '').startsWith('off-'))

    const localShifts = usePosStore.getState().shifts
    const enrichedShifts = (shifts || []).map(sh => {
      const local = localShifts.find(x => String(x.id) === String(sh.id))
        || (sh.clientRef
          ? localShifts.find(x => String(x.clientRef || '') === String(sh.clientRef))
          : undefined)
      if (!local) return sh
      let next = sh
      if (isGenericCashier(sh.cashierName) && !isGenericCashier(local.cashierName)) {
        next = { ...next, cashierName: local.cashierName }
      }
      if (local.openedAtIso && (!sh.openedAtIso || local.openedAtIso < sh.openedAtIso)) {
        next = { ...next, openedAtIso: local.openedAtIso }
      }
      if (local.closedAtIso && (!sh.closedAtIso || String(local.closedAtIso) < String(sh.closedAtIso))) {
        next = { ...next, closedAtIso: local.closedAtIso }
      }
      if (local.clientRef && !next.clientRef) next = { ...next, clientRef: local.clientRef }
      return next
    })

    if (protectShifts) {
      // Сервер ещё без queued ops — оставляем локальные смены (ожидаемый нал / expenseTotal)
      usePosStore.setState({ sales: mergedSales })
    } else {
      usePosStore.setState({
        sales: mergedSales,
        shifts: mergeInboundById(localShifts, enrichedShifts),
      })
    }

    if (hasNewFromServer || keptLocal || mergedSales.length !== localSales.length) {
      try {
        const { cacheData } = await import('./offline')
        const cur = usePosStore.getState()
        void cacheData('pos_snapshot', {
          cashiers: cur.cashiers,
          posPoints: cur.posPoints,
          shifts: cur.shifts,
          sales: cur.sales,
          receipts: cur.receipts,
          writeoffs: cur.writeoffs,
          revisions: cur.revisions,
          suppliers: cur.suppliers,
          expenses: cur.expenses,
          financeMoves: cur.financeMoves,
          cashVault: cur.cashVault,
          expiry: cur.expiry,
          financeSummary: cur.financeSummary,
          report: cur.report,
        })
      } catch { /* ignore */ }
    }
  } catch { /* нет связи — локальный чек уже на экране */ }
}

async function persistSoftPosSnapshot() {
  try {
    const { cacheData } = await import('./offline')
    const snap = usePosStore.getState()
    void cacheData('pos_snapshot', {
      cashiers: snap.cashiers,
      posPoints: snap.posPoints,
      shifts: snap.shifts,
      sales: snap.sales,
      receipts: snap.receipts,
      writeoffs: snap.writeoffs,
      revisions: snap.revisions,
      suppliers: snap.suppliers,
      expenses: snap.expenses,
      financeMoves: snap.financeMoves,
      cashVault: snap.cashVault,
      expiry: snap.expiry,
      financeSummary: snap.financeSummary,
      report: snap.report,
    })
  } catch { /* ignore */ }
}

/**
 * Лёгкое обновление склада (приходы / списания / ревизии / поставщики / сроки).
 * Локальные off-* не затираются и склеиваются с сервером по clientRef.
 */
let warehouseSoftSyncInFlight: Promise<void> | null = null

export async function softSyncWarehouse(opts?: { expiryDays?: number }) {
  if (warehouseSoftSyncInFlight) return warehouseSoftSyncInFlight
  warehouseSoftSyncInFlight = (async () => {
    try {
      const days = opts?.expiryDays ?? 14
      const [receipts, writeoffs, revisions, suppliers, expiry] = await Promise.all([
        api.getStockReceipts(),
        api.getStockWriteoffs(),
        api.getStockRevisions(),
        api.getSuppliers(),
        api.getStockExpiry(days),
      ])

      const delIds = await pendingDeleteIds()
      const cur = usePosStore.getState()
      usePosStore.setState({
        receipts: omitInboundDeleted(mergeInboundById(cur.receipts, dropDeletedRemote(receipts, delIds))),
        writeoffs: omitInboundDeleted(mergeInboundById(cur.writeoffs, dropDeletedRemote(writeoffs, delIds))),
        revisions: omitInboundDeleted(mergeInboundById(cur.revisions, dropDeletedRemote(revisions, delIds))),
        suppliers: mergeInboundById(cur.suppliers, suppliers) as typeof cur.suppliers,
        expiry,
        apiReady: true,
        apiError: '',
      })
      await persistSoftPosSnapshot()

      try {
        const { pullStockLayersFromServer } = await import('./stockLayersLocal')
        await pullStockLayersFromServer({ bumpProducts: true })
      } catch { /* ignore */ }
    } catch { /* нет связи — оставляем локальный снимок */ }
    finally {
      warehouseSoftSyncInFlight = null
    }
  })()
  return warehouseSoftSyncInFlight
}

/** Вклады / расходы / ящик с другого аппарата — без полного POS-снимка. */
let financeSoftSyncInFlight: Promise<void> | null = null

export async function softSyncFinance() {
  if (financeSoftSyncInFlight) return financeSoftSyncInFlight
  financeSoftSyncInFlight = (async () => {
    try {
      const [financeMoves, expenses, cashVault] = await Promise.all([
        api.getFinanceMoves(),
        api.getExpenses(),
        api.getCashVault().catch(() => null),
      ])
      const delIds = await pendingDeleteIds()
      const cur = usePosStore.getState()
      usePosStore.setState({
        financeMoves: omitInboundDeleted(mergeInboundById(cur.financeMoves, dropDeletedRemote(financeMoves, delIds))),
        expenses: omitInboundDeleted(mergeInboundById(cur.expenses, dropDeletedRemote(expenses, delIds))),
        ...(cashVault
          ? { cashVault: mergeCashVault(cur.cashVault, cashVault) }
          : {}),
        apiReady: true,
        apiError: '',
      })
      await persistSoftPosSnapshot()
    } catch { /* нет связи */ }
    finally {
      financeSoftSyncInFlight = null
    }
  })()
  return financeSoftSyncInFlight
}
