/**
 * Офлайн-отчёты: агрегаты из локального posStore / клиентов
 * (без обязательного GET /reports/pos).
 */
import { usePosStore } from './posStore'
import { useClientStore } from './clientStore'
import {
  buildLocalFinanceTruth,
  cacheFinanceTruth,
  readCachedFinanceTruth,
} from './financeTruthCache'
import type { FinanceTruthBundle } from './types'

export type LocalReportBundle = {
  salesCount: number
  revenue: number
  cash: number
  card: number
  debtAdded: number
  receiptsCost: number
  writeoffsCost: number
  expenses: number
  supplierDebt: number
  clientDebt: number
  openShifts: number
  truth: FinanceTruthBundle | null
  fromCache: boolean
}

function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100
}

/** Собрать отчёт за период [from, to] (yyyy-mm-dd или ISO). */
export function buildLocalTradeReport(fromIso: string, toIso: string): LocalReportBundle {
  const pos = usePosStore.getState()
  const clients = useClientStore.getState().clients || []
  const from = Date.parse(fromIso.includes('T') ? fromIso : `${fromIso}T00:00:00`)
  const to = Date.parse(toIso.includes('T') ? toIso : `${toIso}T23:59:59.999`)

  const inRange = (iso?: string) => {
    const t = Date.parse(String(iso || ''))
    if (!Number.isFinite(t)) return false
    if (Number.isFinite(from) && t < from) return false
    if (Number.isFinite(to) && t > to) return false
    return true
  }

  const sales = (pos.sales || []).filter(s => inRange(s.createdAtIso))
  let revenue = 0
  let cash = 0
  let card = 0
  let debtAdded = 0
  for (const s of sales) {
    if (String(s.status || '') === 'returned') continue
    revenue += Number(s.total) || 0
    cash += Number((s as any).cashPaid ?? (s.pay === 'cash' ? s.total : 0)) || 0
    card += Number((s as any).cardPaid ?? (s.pay === 'card' ? s.total : 0)) || 0
    debtAdded += Number(s.debtAdded) || 0
  }

  const receiptsCost = (pos.receipts || [])
    .filter(r => inRange(r.createdAtIso))
    .reduce((s, r) => s + (Number(r.totalCost) || 0), 0)
  const writeoffsCost = (pos.writeoffs || [])
    .filter(w => inRange(w.createdAtIso))
    .reduce((s, w) => s + (Number(w.totalCost) || 0), 0)
  const expenses = (pos.expenses || [])
    .filter(e => inRange(e.createdAtIso))
    .reduce((s, e) => s + (Number(e.amount) || 0), 0)

  const supplierDebt = (pos.suppliers || []).reduce((s, x) => s + (Number(x.payableAmount) || 0), 0)
  const clientDebt = clients.reduce((s, c) => s + (Number(c.debt) || 0), 0)
  const openShifts = (pos.shifts || []).filter(sh => sh.status === 'open').length

  const truth = buildLocalFinanceTruth({
    shifts: pos.shifts,
    financeMoves: pos.financeMoves,
    expenses: pos.expenses,
    sales: pos.sales,
  })
  void cacheFinanceTruth(undefined, truth)

  return {
    salesCount: sales.length,
    revenue: round2(revenue),
    cash: round2(cash),
    card: round2(card),
    debtAdded: round2(debtAdded),
    receiptsCost: round2(receiptsCost),
    writeoffsCost: round2(writeoffsCost),
    expenses: round2(expenses),
    supplierDebt: round2(supplierDebt),
    clientDebt: round2(clientDebt),
    openShifts,
    truth,
    fromCache: false,
  }
}

/** Обновить finance truth из локали (Reports / Finance при офлайне). */
export async function refreshLocalFinanceTruth(
  q?: Record<string, string>,
): Promise<FinanceTruthBundle | null> {
  try {
    const pos = usePosStore.getState()
    const truth = buildLocalFinanceTruth({
      shifts: pos.shifts,
      financeMoves: pos.financeMoves,
      expenses: pos.expenses,
      sales: pos.sales,
    })
    await cacheFinanceTruth(q, truth)
    return truth
  } catch {
    return readCachedFinanceTruth(q)
  }
}
