'use client'

import { create } from 'zustand'
import { api } from './api'
import { USE_API } from './config'
import type {
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
        expiry,
        financeSummary,
        report,
      }
      set({ ...snapshot, apiReady: true, apiSyncing: false, apiError: '' })
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
            set({ ...cached, apiReady: true, apiSyncing: false, apiError: '' })
            return
          }
        } catch { /* нет кэша */ }
      }
      set({
        apiReady: alreadyReady || true,
        apiSyncing: false,
        apiError: e instanceof Error ? e.message : 'Не удалось загрузить POS данные',
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
])

export async function softSyncPosAfterSale() {
  try {
    const [sales, shifts] = await Promise.all([
      api.getPosSales(),
      api.getPosShifts(),
    ])

    const { getPending, isLocalId } = await import('./offline')
    const pending = await getPending()
    const protectShifts = pending.some(r => !r.failed && SHIFT_PENDING_KINDS.has(r.kind))

    const localSales = usePosStore.getState().sales
    const serverSaleIds = new Set(sales.map(s => String(s.id)))
    const localOnlySales = localSales.filter(s => {
      const id = String(s.id)
      if (serverSaleIds.has(id)) return false
      return isLocalId(id) || !!(s as { _offline?: boolean })._offline
    })
    // Серверные чеки (в т.ч. с браузера) + ещё не ушедшие локальные
    const mergedSales = localOnlySales.length ? [...localOnlySales, ...sales] : sales

    const prevIds = new Set(localSales.map(s => String(s.id)))
    const hasNewFromServer = sales.some(s => !prevIds.has(String(s.id)))

    if (protectShifts) {
      // Сервер ещё без queued ops — оставляем локальные смены (ожидаемый нал / expenseTotal)
      usePosStore.setState({ sales: mergedSales })
    } else {
      usePosStore.setState({ sales: mergedSales, shifts })
    }

    if (hasNewFromServer || localOnlySales.length || mergedSales.length !== localSales.length) {
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
          expiry: cur.expiry,
          financeSummary: cur.financeSummary,
          report: cur.report,
        })
      } catch { /* ignore */ }
    }
  } catch { /* нет связи — локальный чек уже на экране */ }
}

/**
 * Лёгкое обновление склада (приходы / списания / ревизии / поставщики / сроки).
 * Без sales/finance/reconcile — чтобы слабый интернет не «замораживал» раздел.
 * Локальные (off-*) записи НЕ затираются сервером.
 */
function mergeLocalDocs<T extends { id?: string }>(local: T[], server: T[]): T[] {
  const serverIds = new Set(server.map(s => String(s.id || '')))
  const localOnly = local.filter(s => {
    const id = String(s.id || '')
    if (!id || serverIds.has(id)) return false
    return id.startsWith('off-') || !!(s as { _offline?: boolean })._offline
  })
  return localOnly.length ? [...localOnly, ...server] : server
}

let warehouseSoftSyncInFlight: Promise<void> | null = null

export async function softSyncWarehouse(opts?: { expiryDays?: number }) {
  // Не гоняем параллельно несколько тяжёлых pull — склад «замирает»
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

      const cur = usePosStore.getState()
      usePosStore.setState({
        receipts: mergeLocalDocs(cur.receipts, receipts),
        writeoffs: mergeLocalDocs(cur.writeoffs, writeoffs),
        revisions: mergeLocalDocs(cur.revisions, revisions),
        suppliers: mergeLocalDocs(cur.suppliers as { id?: string }[], suppliers as { id?: string }[]) as typeof cur.suppliers,
        expiry,
        apiReady: true,
        apiError: '',
      })
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
          expiry: snap.expiry,
          financeSummary: snap.financeSummary,
          report: snap.report,
        })
      } catch { /* ignore */ }
    } catch { /* нет связи — оставляем локальный снимок */ }
    finally {
      warehouseSoftSyncInFlight = null
    }
  })()
  return warehouseSoftSyncInFlight
}
