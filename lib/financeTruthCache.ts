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

function inRange(iso: string | undefined, fromMs?: number | null, toMs?: number | null) {
  if (fromMs == null && toMs == null) return true
  if (!iso) return false
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return false
  if (fromMs != null && Number.isFinite(fromMs) && t < fromMs) return false
  if (toMs != null && Number.isFinite(toMs) && t > toMs) return false
  return true
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

export type LocalFinanceTruthInput = {
  shifts: PosShift[]
  financeMoves?: { type: string; amount: number; createdAtIso?: string; note?: string; id?: string; posId?: string; cashierId?: string }[]
  expenses?: { amount: number; createdAtIso?: string; category?: string; id?: string; posId?: string; cashierId?: string }[]
  sales?: {
    total?: number
    paidCash?: number
    paidCard?: number
    debtAdded?: number
    createdAtIso?: string
    status?: string
    posId?: string
    cashierId?: string
    totalCost?: number
  }[]
  /** Фильтры периода / точки (как у API) */
  fromMs?: number | null
  toMs?: number | null
  posId?: string
  cashierId?: string
}

/** Локальный снимок из POS-стора — работает без сервера. */
export function buildLocalFinanceTruth(input: LocalFinanceTruthInput): FinanceTruthBundle {
  const fromMs = input.fromMs ?? null
  const toMs = input.toMs ?? null
  const posId = String(input.posId || '').trim()
  const cashierId = String(input.cashierId || '').trim()

  const matchEntity = (row: { posId?: string; cashierId?: string; createdAtIso?: string; openedAtIso?: string }) => {
    const iso = row.createdAtIso || row.openedAtIso
    if (!inRange(iso, fromMs, toMs)) return false
    if (posId && String(row.posId || '') !== posId) return false
    if (cashierId && String(row.cashierId || '') !== cashierId) return false
    return true
  }

  const shifts = (input.shifts || []).filter(s => matchEntity({
    posId: s.posId,
    cashierId: s.cashierId,
    openedAtIso: s.openedAtIso,
    createdAtIso: s.openedAtIso,
  }))
  const moves = (input.financeMoves || []).filter(m => matchEntity(m))
  const expenses = (input.expenses || []).filter(e => matchEntity(e))
  const sales = (input.sales || [])
    .filter(s => s.status !== 'returned')
    .filter(s => matchEntity(s))

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
  const cogs = Math.round(sales.reduce((a, s) => a + (Number(s.totalCost) || 0), 0) * 100) / 100
  const expenseSum = Math.round(expenses.reduce((a, e) => a + (Number(e.amount) || 0), 0) * 100) / 100
  const depositSum = Math.round(
    moves.filter(m => m.type === 'deposit').reduce((a, m) => a + (Number(m.amount) || 0), 0) * 100,
  ) / 100
  const withdrawSum = Math.round(
    moves.filter(m => m.type === 'withdraw').reduce((a, m) => a + (Number(m.amount) || 0), 0) * 100,
  ) / 100
  const cashSales = Math.round(sales.reduce((a, s) => a + (Number(s.paidCash) || 0), 0) * 100) / 100
  const inflow = Math.round((cashSales + depositSum) * 100) / 100
  const outflow = Math.round((expenseSum + withdrawSum) * 100) / 100
  const balance = Math.round((inflow - outflow) * 100) / 100
  const profitAmt = Math.round((revenue - cogs - expenseSum) * 100) / 100

  const entries: MoneyLedgerEntry[] = [
    ...sales.filter(s => (Number(s.paidCash) || 0) > 0.001).map(s => {
      const amount = Number(s.paidCash) || 0
      return {
        id: `sale-cash-${(s as { id?: string }).id || s.createdAtIso}`,
        type: 'sale_cash',
        amount,
        direction: 'in' as const,
        signedAmount: amount,
        cashAffect: true,
        createdAtIso: s.createdAtIso || new Date().toISOString(),
        note: 'Продажа нал',
      }
    }),
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
  const alerts = rows.filter(r => r.alert).map(r => ({
    id: `shift-diff-${r.shiftId}`,
    severity: Math.abs(r.cashDiff) > 50 ? 'high' as const : 'medium' as const,
    title: r.cashDiff < 0 ? 'Недостача в кассе' : 'Излишек в кассе',
    message: `${r.cashierName || 'Кассир'} · ожид. ${r.expectedCash} / факт ${r.actualCash}`,
    amount: r.cashDiff,
    atIso: r.closedAtIso || r.openedAtIso,
  }))

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
        cogs,
        profit: profitAmt,
        marginPct: revenue > 0 ? Math.round((profitAmt / revenue) * 10000) / 100 : 0,
        salesCount: sales.length,
      },
      products: [],
    },
    journal: entries,
    alerts: { threshold: 1, alerts, count: alerts.length },
    generatedAtIso: new Date().toISOString(),
  }
}

/** Собрать локальный truth из apiQuery (from/to/posId/cashierId). */
export function buildLocalFinanceTruthFromQuery(
  input: Omit<LocalFinanceTruthInput, 'fromMs' | 'toMs' | 'posId' | 'cashierId'>,
  q?: Record<string, string>,
): FinanceTruthBundle {
  const fromMs = q?.from ? Date.parse(q.from) : null
  const toMs = q?.to ? Date.parse(q.to) : null
  return buildLocalFinanceTruth({
    ...input,
    fromMs: Number.isFinite(fromMs as number) ? fromMs : null,
    toMs: Number.isFinite(toMs as number) ? toMs : null,
    posId: q?.posId,
    cashierId: q?.cashierId,
  })
}
