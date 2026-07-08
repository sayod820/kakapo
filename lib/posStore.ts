'use client'

import { create } from 'zustand'
import { api } from './api'
import { USE_API } from './config'
import type {
  PosCashier,
  PosExpense,
  PosSale,
  PosShift,
  PosSupplier,
  StockReceipt,
  StockRevision,
  StockWriteoff,
} from './types'

interface PosStore {
  cashiers: PosCashier[]
  shifts: PosShift[]
  sales: PosSale[]
  receipts: StockReceipt[]
  writeoffs: StockWriteoff[]
  revisions: StockRevision[]
  suppliers: PosSupplier[]
  expenses: PosExpense[]
  expiry: Array<{
    receiptId: string
    productId: number
    productName: string
    qty: number
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
  shifts: [],
  sales: [],
  receipts: [],
  writeoffs: [],
  revisions: [],
  suppliers: [],
  expenses: [],
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
    set({ apiSyncing: true, apiError: '' })
    try {
      const [
        cashiers,
        shifts,
        sales,
        receipts,
        writeoffs,
        revisions,
        suppliers,
        expenses,
        expiry,
        financeSummary,
        report,
      ] = await Promise.all([
        api.getCashiers(),
        api.getPosShifts(),
        api.getPosSales(),
        api.getStockReceipts(),
        api.getStockWriteoffs(),
        api.getStockRevisions(),
        api.getSuppliers(),
        api.getExpenses(),
        api.getStockExpiry(),
        api.getPosFinanceSummary(),
        api.getPosReport(),
      ])
      set({
        cashiers,
        shifts,
        sales,
        receipts,
        writeoffs,
        revisions,
        suppliers,
        expenses,
        expiry,
        financeSummary,
        report,
        apiReady: true,
        apiSyncing: false,
        apiError: '',
      })
    } catch (e) {
      set({
        apiReady: true,
        apiSyncing: false,
        apiError: e instanceof Error ? e.message : 'Не удалось загрузить POS данные',
      })
    }
  },
}))

export async function syncPosFromApi() {
  await usePosStore.getState().fetchFromApi()
}
