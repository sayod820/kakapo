// ════════════════════════════════════════════════
// KAKAPO — кэш FinanceTruth для офлайн Финансы / Отчёты
// ════════════════════════════════════════════════
import { cacheData, readCachedData } from './offline'
import type { FinanceTruthBundle, MoneyLedgerEntry } from './types'
import type { PosShift } from './types'

const CACHE_PREFIX = 'finance_truth:'

function queryKey(q?: Record<string, string>): string {
  if (!q) return 'default'
  return Object.entries(q)
    .filter(([, v]) => v != null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&') || 'default'
}

export async function cacheFinanceTruth(
  q: Record<string, string> | undefined,
  data: FinanceTruthBundle,
): Promise<void> {
  await cacheData(`${CACHE_PREFIX}${queryKey(q)}`, {
    ...data,
    generatedAtIso: data.generatedAtIso || new Date().toISOString(),
    _cachedAtIso: new Date().toISOString(),
  })
  // Последний успешный снимок — запасной при любом фильтре
  await cacheData(`${CACHE_PREFIX}__last`, data)
}

export async function readCachedFinanceTruth(
  q?: Record<string, string>,
): Promise<FinanceTruthBundle | null> {
  const exact = await readCachedData<FinanceTruthBundle>(`${CACHE_PREFIX}${queryKey(q)}`)
  if (exact) return exact
  return readCachedData<FinanceTruthBundle>(`${CACHE_PREFIX}__last`)
}

/** Минимальный локальный снимок из POS-стора, если кэша нет. */
export function buildLocalFinanceTruth(input: {
  shifts: PosShift[]
  financeMoves?: { type: string; amount: number; createdAtIso?: string; note?: string; id?: string }[]
  expenses?: { amount: number; createdAtIso?: string; category?: string; id?: string }[]
  sales?: { total?: number; paidCash?: number; createdAtIso?: string; status?: string }[]
}): FinanceTruthBundle {
  const shifts = input.shifts || []
  const moves = input.financeMoves || []
  const expenses = input.expenses || []
  const sales = (input.sales || []).filter(s => s.status !== 'returned')

  const rows = shifts.map(s => {
    const openingCash = Number(s.openingCash) || 0
    const salesCash = Number(s.salesCash) || 0
    const cashIn = Number(s.cashInTotal) || 0
    const expenseTotal = Number(s.expenseTotal) || 0
    const expectedCash = Math.round((openingCash + salesCash + cashIn - expenseTotal) * 100) / 100
    const actualCash = s.status === 'closed' ? (Number(s.closingCash) || 0) : expectedCash
    const cashDiff = Math.round((actualCash - expectedCash) * 100) / 100
    return {
      shiftId: s.id,
      posId: s.posId || '',
      cashierId: s.cashierId || '',
      cashierName: s.cashierName || '',
      openedAtIso: s.openedAtIso,
      closedAtIso: s.closedAtIso,
      openingCash,
      salesCash,
      expenseTotal,
      expectedCash,
      actualCash,
      cashDiff,
      alert: Math.abs(cashDiff) > 1,
      day: (s.openedAtIso || '').slice(0, 10),
    }
  })

  const revenue = Math.round(sales.reduce((a, s) => a + (Number(s.total) || 0), 0) * 100) / 100
  const expenseSum = Math.round(expenses.reduce((a, e) => a + (Number(e.amount) || 0), 0) * 100) / 100
  const depositSum = Math.round(
    moves.filter(m => m.type === 'deposit').reduce((a, m) => a + (Number(m.amount) || 0), 0) * 100,
  ) / 100
  const withdrawSum = Math.round(
    moves.filter(m => m.type === 'withdraw').reduce((a, m) => a + (Number(m.amount) || 0), 0) * 100,
  ) / 100
  const inflow = Math.round((revenue + depositSum) * 100) / 100
  const outflow = Math.round((expenseSum + withdrawSum) * 100) / 100
  const balance = Math.round((inflow - outflow) * 100) / 100

  const entries: MoneyLedgerEntry[] = [
    ...moves.map(m => {
      const amount = Number(m.amount) || 0
      const isIn = m.type === 'deposit'
      return {
        id: m.id || `move-${m.createdAtIso}`,
        type: isIn ? 'cash_in' : 'cash_out',
        amount,
        direction: (isIn ? 'in' : 'out') as 'in' | 'out',
        signedAmount: isIn ? amount : -amount,
        cashAffect: true,
        createdAtIso: m.createdAtIso || new Date().toISOString(),
        note: m.note,
      }
    }),
    ...expenses.map(e => {
      const amount = Number(e.amount) || 0
      return {
        id: e.id || `exp-${e.createdAtIso}`,
        type: 'expense',
        amount,
        direction: 'out' as const,
        signedAmount: -amount,
        cashAffect: true,
        createdAtIso: e.createdAtIso || new Date().toISOString(),
        note: e.category,
      }
    }),
  ].sort((a, b) => String(b.createdAtIso).localeCompare(String(a.createdAtIso)))

  const withAlert = rows.filter(r => r.alert).length
  return {
    cashBook: {
      balance,
      entries,
      days: [],
      summary: { inflow, outflow, count: entries.length },
    },
    expectedVsActual: {
      threshold: 1,
      rows,
      summary: {
        shifts: rows.length,
        withAlert,
        absDiffSum: Math.round(rows.reduce((a, r) => a + Math.abs(r.cashDiff), 0) * 100) / 100,
        shortCount: rows.filter(r => r.cashDiff < -0.01).length,
        overCount: rows.filter(r => r.cashDiff > 0.01).length,
      },
    },
    profit: {
      summary: {
        revenue,
        cogs: 0,
        profit: Math.round((revenue - expenseSum) * 100) / 100,
        marginPct: revenue > 0 ? Math.round(((revenue - expenseSum) / revenue) * 10000) / 100 : 0,
        salesCount: sales.length,
      },
      products: [],
    },
    journal: entries,
    alerts: { threshold: 1, alerts: [], count: 0 },
    generatedAtIso: new Date().toISOString(),
  }
}
