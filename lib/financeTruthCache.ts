// ════════════════════════════════════════════════
// KAKAPO — кэш FinanceTruth для офлайн Финансы / Отчёты
// ════════════════════════════════════════════════
import { cacheData, readCachedData } from './offline'
import type { CashBoxSnapshot, CashVault, FinanceTruthBundle, MoneyLedgerEntry, PosPoint } from './types'
import type { PosShift } from './types'

const CACHE_PREFIX = 'finance_truth:'

/** Как на сервере (financeTruth.js) — алерт от 50 сом */
export const CASH_DIFF_ALERT_SOM = 50

function queryKey(q?: Record<string, string>): string {
  if (!q) return 'default'
  return Object.entries(q)
    .filter(([, v]) => v != null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&') || 'default'
}

function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function ymd(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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

/** Нормализация типов фильтра (локальные алиасы ↔ сервер) */
function typeMatches(entryType: string, filter: string) {
  if (!filter) return true
  if (entryType === filter) return true
  if (filter === 'deposit' && (entryType === 'cash_in' || entryType === 'deposit')) return true
  if (filter === 'withdraw' && (entryType === 'cash_out' || entryType === 'withdraw')) return true
  if (filter === 'debt_repay' && entryType.startsWith('debt_repay')) return true
  return false
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

function isOffEntityId(id?: string) {
  return String(id || '').startsWith('off-')
}

function financeTwinKey(row: {
  clientRef?: string
  type?: string
  category?: string
  amount?: number
  shiftId?: string
  createdAtIso?: string
}): string {
  const ref = String(row.clientRef || '').trim()
  if (ref) return `ref:${ref}`
  const ts = Date.parse(String(row.createdAtIso || ''))
  const bucket = Number.isFinite(ts) ? Math.round(ts / 20_000) : String(row.createdAtIso || '')
  return `fp:${row.type || row.category || ''}|${(Number(row.amount) || 0).toFixed(2)}|${row.shiftId || ''}|${bucket}`
}

/** Двойная запись (off-* + сервер) не должна дважды плюсовать книгу. */
function dedupeFinanceRows<T extends {
  id?: string
  clientRef?: string
  type?: string
  category?: string
  amount?: number
  shiftId?: string
  createdAtIso?: string
}>(rows: T[]): T[] {
  const out: T[] = []
  const indexByKey = new Map<string, number>()
  for (const row of rows) {
    const key = financeTwinKey(row)
    const prevIdx = indexByKey.get(key)
    if (prevIdx != null) {
      const prev = out[prevIdx]
      if (isOffEntityId(prev.id) && !isOffEntityId(row.id)) out[prevIdx] = row
      continue
    }
    indexByKey.set(key, out.length)
    out.push(row)
  }
  return out
}

export type LocalFinanceTruthInput = {
  shifts: PosShift[]
  financeMoves?: {
    type: string
    amount: number
    createdAtIso?: string
    note?: string
    id?: string
    clientRef?: string
    posId?: string
    cashierId?: string
    shiftId?: string
    createdBy?: string
  }[]
  expenses?: {
    amount: number
    createdAtIso?: string
    category?: string
    id?: string
    clientRef?: string
    posId?: string
    cashierId?: string
    shiftId?: string
    createdBy?: string
  }[]
  sales?: {
    id?: string
    total?: number
    paidCash?: number
    paidCard?: number
    debtAdded?: number
    createdAtIso?: string
    status?: string
    posId?: string
    cashierId?: string
    cashierName?: string
    shiftId?: string
    totalCost?: number
    items?: {
      productId?: number
      productName?: string
      qty?: number
      returnedQty?: number
      price?: number
      lineTotal?: number
      unitCost?: number
      lineCost?: number
    }[]
  }[]
  receipts?: {
    id?: string
    paidNow?: number
    createdAtIso?: string
    supplierName?: string
    posId?: string
    shiftId?: string
    stockAdjustment?: boolean
  }[]
  cashVault?: CashVault
  posPoints?: PosPoint[]
  /** Фильтры периода / точки (как у API) */
  fromMs?: number | null
  toMs?: number | null
  posId?: string
  cashierId?: string
  type?: string
}

function shiftExpected(s: PosShift) {
  return round2(
    (Number(s.openingCash) || 0)
    + (Number(s.salesCash) || 0)
    + (Number(s.cashInTotal) || 0)
    - (Number(s.expenseTotal) || 0),
  )
}

/** Локальный свод ящика: основной + открытые точки */
export function buildLocalCashBoxSnapshot(input: {
  shifts: PosShift[]
  cashVault?: CashVault | null
  posPoints?: PosPoint[]
  posId?: string
}): CashBoxSnapshot {
  const vault = input.cashVault || { cashTotal: 0, cardTotal: 0, transfers: [] }
  const posFilter = String(input.posId || '').trim()
  const openShifts = (input.shifts || []).filter(s => s.status === 'open')
  const pointsList = (input.posPoints || []).filter(p => p.active !== false)

  let transfers = [...(vault.transfers || [])]
  if (posFilter) transfers = transfers.filter(t => String(t.posId || '') === posFilter)
  transfers.sort((a, b) => String(b.closedAtIso || '').localeCompare(String(a.closedAtIso || '')))

  const mainCash = posFilter
    ? round2(transfers.reduce((a, t) => a + (Number(t.cashAmount) || 0), 0))
    : round2(Number(vault.cashTotal) || 0)
  const mainCard = posFilter
    ? round2(transfers.reduce((a, t) => a + (Number(t.cardAmount) || 0), 0))
    : round2(Number(vault.cardTotal) || 0)

  const points = pointsList
    .filter(p => !posFilter || p.id === posFilter)
    .map(p => {
      const shift = openShifts.find(s => String(s.posId || '') === String(p.id))
      if (!shift) {
        return {
          posId: p.id,
          posName: p.name || p.id,
          open: false,
          cashNow: 0,
          cardNow: 0,
        }
      }
      return {
        posId: p.id,
        posName: p.name || p.id,
        shiftId: shift.id,
        cashierName: shift.cashierName || '',
        open: true,
        cashNow: shiftExpected(shift),
        cardNow: round2(Number(shift.salesCard) || 0),
      }
    })

  for (const s of openShifts) {
    const pid = String(s.posId || '')
    if (!pid) continue
    if (posFilter && pid !== posFilter) continue
    if (points.some(p => p.posId === pid)) continue
    points.push({
      posId: pid,
      posName: pid,
      shiftId: s.id,
      cashierName: s.cashierName || '',
      open: true,
      cashNow: shiftExpected(s),
      cardNow: round2(Number(s.salesCard) || 0),
    })
  }

  const openCash = round2(points.reduce((a, p) => a + (Number(p.cashNow) || 0), 0))
  const openCard = round2(points.reduce((a, p) => a + (Number(p.cardNow) || 0), 0))

  return {
    totalCash: round2(mainCash + openCash),
    totalCard: round2(mainCard + openCard),
    main: { cash: mainCash, card: mainCard },
    points,
    transfers: transfers.slice(0, 50),
  }
}

/** Локальный снимок из POS-стора — работает без сервера. */
export function buildLocalFinanceTruth(input: LocalFinanceTruthInput): FinanceTruthBundle {
  const fromMs = input.fromMs ?? null
  const toMs = input.toMs ?? null
  const posId = String(input.posId || '').trim()
  const cashierId = String(input.cashierId || '').trim()
  const typeFilter = String(input.type || '').trim()

  const shiftPos = new Map<string, string>()
  const shiftCashier = new Map<string, string>()
  for (const s of input.shifts || []) {
    if (s.id) {
      shiftPos.set(s.id, String(s.posId || ''))
      shiftCashier.set(s.id, String(s.cashierId || ''))
    }
  }

  const resolvePos = (row: { posId?: string; shiftId?: string }) =>
    String(row.posId || (row.shiftId ? shiftPos.get(row.shiftId) : '') || '')

  const resolveCashier = (row: { cashierId?: string; shiftId?: string; createdBy?: string }) =>
    String(row.cashierId || (row.shiftId ? shiftCashier.get(row.shiftId) : '') || '')

  const matchEntity = (row: {
    posId?: string
    cashierId?: string
    createdAtIso?: string
    openedAtIso?: string
    shiftId?: string
    createdBy?: string
  }) => {
    const iso = row.createdAtIso || row.openedAtIso
    if (!inRange(iso, fromMs, toMs)) return false
    if (posId) {
      const rowPos = resolvePos(row)
      // без точки — не отбрасываем (старые записи без posId)
      if (rowPos && rowPos !== posId) return false
    }
    if (cashierId) {
      const rowCashier = resolveCashier(row)
      if (rowCashier && rowCashier !== cashierId) return false
      if (!rowCashier && row.createdBy && row.createdBy !== cashierId) {
        /* createdBy часто имя, не id — не режем */
      }
    }
    return true
  }

  const allShifts = input.shifts || []
  const closedShifts = allShifts
    .filter(s => s.status === 'closed')
    .filter(s => matchEntity({
      posId: s.posId,
      cashierId: s.cashierId,
      openedAtIso: s.closedAtIso || s.openedAtIso,
      createdAtIso: s.closedAtIso || s.openedAtIso,
    }))

  const moves = dedupeFinanceRows((input.financeMoves || []).filter(m => matchEntity(m)))
  const expenses = dedupeFinanceRows((input.expenses || []).filter(e => matchEntity(e)))
  const sales = (input.sales || [])
    .filter(s => s.status !== 'returned')
    .filter(s => matchEntity(s))
  const receipts = (input.receipts || [])
    .filter(r => !r.stockAdjustment)
    .filter(r => (Number(r.paidNow) || 0) > 0.001)
    .filter(r => matchEntity(r))

  const rows = closedShifts.map(s => {
    const openingCash = Number(s.openingCash) || 0
    const salesCash = Number(s.salesCash) || 0
    const cashIn = Number(s.cashInTotal) || 0
    const expenseTotal = Number(s.expenseTotal) || 0
    const expectedCash = s.expectedCash != null
      ? round2(Number(s.expectedCash))
      : round2(openingCash + salesCash + cashIn - expenseTotal)
    const actualCash = s.actualCash != null
      ? round2(Number(s.actualCash))
      : (s.closingCash != null ? (Number(s.closingCash) || 0) : expectedCash)
    const cashDiff = s.cashDiff != null ? round2(Number(s.cashDiff)) : round2(actualCash - expectedCash)
    const expectedCard = s.expectedCard != null ? round2(Number(s.expectedCard)) : round2(Number(s.salesCard) || 0)
    const actualCard = s.actualCard != null ? round2(Number(s.actualCard))
      : (s.closingCard != null ? round2(Number(s.closingCard)) : expectedCard)
    const cardDiff = s.cardDiff != null ? round2(Number(s.cardDiff)) : round2(actualCard - expectedCard)
    return {
      shiftId: s.id,
      posId: s.posId || '',
      cashierId: s.cashierId || '',
      cashierName: s.cashierName || '',
      openedAtIso: s.openedAtIso,
      closedAtIso: s.closedAtIso,
      openingCash,
      salesCash,
      salesCard: Number(s.salesCard) || 0,
      salesCredit: Number(s.salesCredit) || 0,
      expenseTotal,
      expectedCash,
      actualCash,
      cashDiff,
      expectedCard,
      actualCard,
      cardDiff,
      note: String(s.reconcileNote || s.note || ''),
      alert: Math.abs(cashDiff) >= CASH_DIFF_ALERT_SOM || Math.abs(cardDiff) >= CASH_DIFF_ALERT_SOM,
      day: ymd(s.closedAtIso || s.openedAtIso),
    }
  }).sort((a, b) => String(b.closedAtIso || '').localeCompare(String(a.closedAtIso || '')))

  // Погашение долга нал = salesCash смены − сумма paidCash продаж смены
  const paidCashByShift = new Map<string, number>()
  for (const s of input.sales || []) {
    if (s.status === 'returned') continue
    const sid = String(s.shiftId || '')
    if (!sid) continue
    paidCashByShift.set(sid, round2((paidCashByShift.get(sid) || 0) + (Number(s.paidCash) || 0)))
  }

  const entries: MoneyLedgerEntry[] = []

  for (const s of sales) {
    const amount = Number(s.paidCash) || 0
    if (!(amount > 0.001)) continue
    entries.push({
      id: `sale-cash-${s.id || s.createdAtIso}`,
      type: 'sale_cash',
      amount,
      direction: 'in',
      signedAmount: amount,
      cashAffect: true,
      createdAtIso: s.createdAtIso || new Date().toISOString(),
      posId: resolvePos(s),
      shiftId: s.shiftId,
      cashierId: s.cashierId,
      cashierName: s.cashierName,
      note: 'Продажа нал',
      reason: 'Продажа нал',
    })
  }

  for (const s of allShifts) {
    if (!matchEntity({
      posId: s.posId,
      cashierId: s.cashierId,
      createdAtIso: s.closedAtIso || s.openedAtIso,
      openedAtIso: s.openedAtIso,
    })) continue
    const sid = s.id
    const delta = round2((Number(s.salesCash) || 0) - (paidCashByShift.get(sid) || 0))
    if (delta > 0.001) {
      entries.push({
        id: `debt-repay-${sid}`,
        type: 'debt_repay_cash',
        amount: delta,
        direction: 'in',
        signedAmount: delta,
        cashAffect: true,
        createdAtIso: s.closedAtIso || s.openedAtIso || new Date().toISOString(),
        posId: s.posId || '',
        shiftId: sid,
        cashierId: s.cashierId,
        cashierName: s.cashierName,
        reason: 'Погашение долга · нал (по смене)',
      })
    }
  }

  for (const m of moves) {
    const amount = Number(m.amount) || 0
    if (!(amount > 0.001)) continue
    const isIn = m.type === 'deposit' || m.type === 'cash_in'
    entries.push({
      id: m.id || `move-${m.createdAtIso}`,
      type: isIn ? 'deposit' : 'withdraw',
      amount,
      direction: isIn ? 'in' : 'out',
      signedAmount: isIn ? amount : -amount,
      cashAffect: true,
      createdAtIso: m.createdAtIso || new Date().toISOString(),
      posId: resolvePos(m),
      shiftId: m.shiftId,
      cashierId: m.cashierId,
      cashierName: m.createdBy,
      note: m.note,
      reason: isIn ? 'Внесение в кассу' : 'Снятие из кассы',
    })
  }

  for (const e of expenses) {
    const amount = Number(e.amount) || 0
    if (!(amount > 0.001)) continue
    entries.push({
      id: e.id || `exp-${e.createdAtIso}`,
      type: 'expense',
      amount,
      direction: 'out',
      signedAmount: -amount,
      cashAffect: true,
      createdAtIso: e.createdAtIso || new Date().toISOString(),
      posId: resolvePos(e),
      shiftId: e.shiftId,
      cashierId: e.cashierId,
      cashierName: e.createdBy,
      note: e.category,
      reason: `Расход · ${e.category || 'Прочее'}`,
    })
  }

  for (const r of receipts) {
    const amount = Number(r.paidNow) || 0
    entries.push({
      id: `purchase-${r.id || r.createdAtIso}`,
      type: 'purchase_pay',
      amount,
      direction: 'out',
      signedAmount: -amount,
      cashAffect: true,
      createdAtIso: r.createdAtIso || new Date().toISOString(),
      posId: resolvePos(r),
      shiftId: r.shiftId,
      reason: `Оплата закупа · ${r.supplierName || 'поставщик'}`,
    })
  }

  entries.sort((a, b) => String(a.createdAtIso).localeCompare(String(b.createdAtIso)))

  const typed = typeFilter
    ? entries.filter(e => typeMatches(e.type, typeFilter))
    : entries

  let balance = 0
  const withBalance = typed.map(e => {
    const next = e.cashAffect ? round2(balance + (Number(e.signedAmount) || 0)) : balance
    if (e.cashAffect) balance = next
    return { ...e, balanceAfter: e.cashAffect ? next : undefined }
  })

  const cashEntries = withBalance.filter(e => e.cashAffect)
  const byDayMap = new Map<string, { day: string; inflow: number; outflow: number; net: number; count: number }>()
  for (const e of cashEntries) {
    const day = ymd(e.createdAtIso)
    if (!day) continue
    const d = byDayMap.get(day) || { day, inflow: 0, outflow: 0, net: 0, count: 0 }
    const s = Number(e.signedAmount) || 0
    if (s >= 0) d.inflow = round2(d.inflow + s)
    else d.outflow = round2(d.outflow + Math.abs(s))
    d.net = round2(d.inflow - d.outflow)
    d.count += 1
    byDayMap.set(day, d)
  }
  const days = [...byDayMap.values()].sort((a, b) => b.day.localeCompare(a.day))

  const inflow = round2(cashEntries.filter(e => (e.signedAmount || 0) > 0).reduce((a, e) => a + (e.signedAmount || 0), 0))
  const outflow = round2(cashEntries.filter(e => (e.signedAmount || 0) < 0).reduce((a, e) => a + Math.abs(e.signedAmount || 0), 0))
  const bookBalance = cashEntries.length
    ? (cashEntries[cashEntries.length - 1].balanceAfter ?? round2(inflow - outflow))
    : 0

  // Прибыль = выручка − себестоимость (как на сервере; расходы — отдельно во вкладке)
  let revenue = 0
  let cogs = 0
  const byProduct = new Map<number, {
    productId: number
    productName: string
    qty: number
    revenue: number
    cogs: number
  }>()

  for (const sale of sales) {
    const rev = round2(Number(sale.total) || 0)
    let cost = sale.totalCost != null ? round2(Number(sale.totalCost) || 0) : 0
    if (sale.totalCost == null && sale.items?.length) {
      for (const it of sale.items) {
        const left = Math.max(0, round2((Number(it.qty) || 0) - (Number(it.returnedQty) || 0)))
        if (!(left > 0)) continue
        if (it.lineCost != null && Number(it.qty) > 0) {
          cost = round2(cost + (Number(it.lineCost) || 0) * (left / Number(it.qty)))
        } else {
          cost = round2(cost + (Number(it.unitCost) || 0) * left)
        }
      }
    }
    if (!(rev > 0) && !(cost > 0)) continue
    revenue = round2(revenue + rev)
    cogs = round2(cogs + cost)
    for (const it of sale.items || []) {
      const left = Math.max(0, round2((Number(it.qty) || 0) - (Number(it.returnedQty) || 0)))
      if (!(left > 0)) continue
      const unitRev = Number(it.qty) > 0 ? (Number(it.lineTotal) || 0) / Number(it.qty) : Number(it.price) || 0
      const unitCost = Number(it.unitCost) || 0
      const pid = Number(it.productId) || 0
      const prev = byProduct.get(pid) || {
        productId: pid,
        productName: it.productName || `#${pid}`,
        qty: 0,
        revenue: 0,
        cogs: 0,
      }
      prev.qty = round2(prev.qty + left)
      prev.revenue = round2(prev.revenue + unitRev * left)
      prev.cogs = round2(prev.cogs + unitCost * left)
      byProduct.set(pid, prev)
    }
  }

  const profitAmt = round2(revenue - cogs)
  const products = [...byProduct.values()]
    .map(p => ({ ...p, profit: round2(p.revenue - p.cogs) }))
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 100)

  const withAlert = rows.filter(r => r.alert).length
  const alerts: FinanceTruthBundle['alerts']['alerts'] = rows.filter(r => r.alert).map(r => {
    const cardDiff = Number(r.cardDiff) || 0
    const cashDiff = Number(r.cashDiff) || 0
    const net = round2(cashDiff + cardDiff)
    const moved = Math.abs(cashDiff) >= 0.009 && Math.abs(cardDiff) >= 0.009
      && Math.abs(net) < 0.009 && Math.sign(cashDiff) !== Math.sign(cardDiff)
    if (moved) {
      const amount = Math.abs(cashDiff)
      const text = cashDiff < 0
        ? `Переместили ${amount.toFixed(2)} сом с нал → карта`
        : `Переместили ${amount.toFixed(2)} сом с карта → нал`
      return {
        id: `shift-diff-${r.shiftId}`,
        kind: 'cash_diff',
        severity: 'medium' as const,
        title: 'Перемещение нал ↔ карта',
        message: `${r.cashierName || 'Кассир'} · ${text}`,
        amount: 0,
        atIso: r.closedAtIso || r.openedAtIso,
      }
    }
    const parts = [
      Math.abs(cashDiff) >= 0.009
        ? `нал ${r.expectedCash}→${r.actualCash} (${cashDiff > 0 ? '+' : ''}${cashDiff.toFixed(2)})`
        : '',
      Math.abs(cardDiff) >= 0.009
        ? `карта ${r.expectedCard}→${r.actualCard} (${cardDiff > 0 ? '+' : ''}${cardDiff.toFixed(2)})`
        : '',
    ].filter(Boolean)
    return {
      id: `shift-diff-${r.shiftId}`,
      kind: 'cash_diff',
      severity: Math.abs(cashDiff) >= CASH_DIFF_ALERT_SOM * 2 || Math.abs(cardDiff) >= CASH_DIFF_ALERT_SOM * 2
        ? 'high' as const
        : 'medium' as const,
      title: cashDiff < 0 || cardDiff < 0 ? 'Недостача при сверке' : 'Излишек при сверке',
      message: `${r.cashierName || 'Кассир'} · ${parts.join(' · ') || r.note || ''}`,
      amount: cashDiff,
      atIso: r.closedAtIso || r.openedAtIso,
    }
  })

  // Долгие открытые смены
  const now = Date.now()
  for (const s of allShifts) {
    if (s.status !== 'open') continue
    if (posId && String(s.posId || '') && String(s.posId) !== posId) continue
    const t = Date.parse(s.openedAtIso || '')
    if (!Number.isFinite(t)) continue
    if (now - t > 16 * 3600 * 1000) {
      alerts.push({
        id: `longshift-${s.id}`,
        kind: 'long_shift',
        severity: 'medium',
        title: 'Долгая открытая смена',
        message: `${s.cashierName || 'Кассир'} — смена открыта более 16 часов`,
        amount: 0,
        atIso: s.openedAtIso,
      })
    }
  }
  alerts.sort((a, b) => String(b.atIso || '').localeCompare(String(a.atIso || '')))

  const journalDesc = [...withBalance].reverse()

  return {
    cashBook: {
      balance: bookBalance,
      entries: journalDesc.filter(e => e.cashAffect),
      days,
      summary: { inflow, outflow, count: cashEntries.length },
    },
    expectedVsActual: {
      threshold: CASH_DIFF_ALERT_SOM,
      rows,
      summary: {
        shifts: rows.length,
        withAlert,
        absDiffSum: round2(rows.reduce((a, r) => a + Math.abs(r.cashDiff), 0)),
        shortCount: rows.filter(r => r.cashDiff < -0.01).length,
        overCount: rows.filter(r => r.cashDiff > 0.01).length,
      },
    },
    profit: {
      summary: {
        revenue,
        cogs,
        profit: profitAmt,
        marginPct: revenue > 0 ? round2((profitAmt / revenue) * 100) : 0,
        salesCount: sales.length,
      },
      products,
    },
    journal: journalDesc,
    alerts: { threshold: CASH_DIFF_ALERT_SOM, alerts, count: alerts.length },
    cashBox: buildLocalCashBoxSnapshot({
      shifts: allShifts,
      cashVault: input.cashVault,
      posPoints: input.posPoints,
      posId,
    }),
    generatedAtIso: new Date().toISOString(),
  }
}

/** Собрать локальный truth из apiQuery (from/to/posId/cashierId). */
export function buildLocalFinanceTruthFromQuery(
  input: Omit<LocalFinanceTruthInput, 'fromMs' | 'toMs' | 'posId' | 'cashierId' | 'type'>,
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
    type: q?.type,
  })
}
