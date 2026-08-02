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

/** Лёгкое обновление после чека — только продажи и смены, без склада/финансов */
export async function softSyncPosAfterSale() {
  try {
    const [sales, shifts] = await Promise.all([
      api.getPosSales(),
      api.getPosShifts(),
    ])
    usePosStore.setState({ sales, shifts })
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
  } catch { /* нет связи — локальный чек уже на экране */ }
}
