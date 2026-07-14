import type {
  PosExpense,
  PosPoint,
  PosSale,
  PosSaleItem,
  PosShift,
  Product,
  StockReceipt,
  StockRevision,
  StockWriteoff,
} from '@/lib/types'

export type ReportPeriod = 'today' | '7d' | '30d' | 'month' | 'all'
export type ReportTab =
  | 'overview'
  | 'sales'
  | 'shifts'
  | 'warehouse'
  | 'suppliers'
  | 'debts'
  | 'products'

export const REPORT_PERIODS: { id: ReportPeriod; label: string }[] = [
  { id: 'today', label: 'Сегодня' },
  { id: '7d', label: '7 дней' },
  { id: '30d', label: '30 дней' },
  { id: 'month', label: 'Этот месяц' },
  { id: 'all', label: 'Всё' },
]

export const REPORT_TABS: { id: ReportTab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Сводка', icon: '📈' },
  { id: 'sales', label: 'Продажи', icon: '🧾' },
  { id: 'shifts', label: 'Смены', icon: '⏱' },
  { id: 'warehouse', label: 'Склад', icon: '🏬' },
  { id: 'suppliers', label: 'Поставщики', icon: '🚚' },
  { id: 'debts', label: 'Долги', icon: '💳' },
  { id: 'products', label: 'Товары', icon: '📦' },
]

export function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100
}

export function periodRange(period: ReportPeriod): { from: number | null; to: number | null } {
  const now = new Date()
  const end = now.getTime()
  if (period === 'all') return { from: null, to: null }
  if (period === 'today') {
    return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), to: end }
  }
  if (period === 'month') {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), to: end }
  }
  const days = period === '7d' ? 7 : 30
  return {
    from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime(),
    to: end,
  }
}

export function inPeriod(iso: string | undefined | null, from: number | null, to: number | null) {
  if (from == null && to == null) return true
  if (!iso) return false
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return false
  if (from != null && t < from) return false
  if (to != null && t > to) return false
  return true
}

/** Старые записи без posId считаем дефолтной точкой. */
export function matchesPos(
  entityPosId: string | undefined | null,
  filterPosId: string | null,
  defaultPosId: string | null,
) {
  if (!filterPosId) return true
  if (entityPosId) return entityPosId === filterPosId
  return !!defaultPosId && filterPosId === defaultPosId
}

export function defaultPosId(points: PosPoint[]) {
  const active = points.filter(p => p.active !== false)
  return active[0]?.id || points[0]?.id || null
}

export function posName(points: PosPoint[], posId?: string | null) {
  if (!posId) return '—'
  return points.find(p => p.id === posId)?.name || posId
}

export function saleNumberLabel(s: Pick<PosSale, 'orderId' | 'number' | 'id'>) {
  if (s.orderId) return String(s.orderId)
  if (Number(s.number) > 0) return `K-${s.number}`
  return s.id ? String(s.id).slice(-8) : '—'
}

export function saleLineLeft(it: Pick<PosSaleItem, 'qty' | 'returnedQty'>) {
  return Math.max(0, round2((Number(it.qty) || 0) - (Number(it.returnedQty) || 0)))
}

export function isSaleFullyReturned(s: PosSale) {
  if (s.status === 'returned') return true
  const items = s.items || []
  return items.length > 0 && items.every(it => saleLineLeft(it) <= 0)
}

export function isSalePartiallyReturned(s: PosSale) {
  if (isSaleFullyReturned(s)) return false
  if (s.status === 'partial') return true
  return (s.items || []).some(it => (Number(it.returnedQty) || 0) > 0)
}

export function paymentLabel(s: PosSale) {
  if (isSaleFullyReturned(s)) return 'Возврат'
  if (s.paymentMethod === 'cash') return 'Наличные'
  if (s.paymentMethod === 'card') return 'Карта'
  if (s.paymentMethod === 'credit' || (Number(s.debtAdded) || 0) > 0) return 'В долг'
  if (s.paymentMethod === 'mixed') return 'Смешанная'
  return String(s.paymentMethod || '—')
}

export function filterSales(
  sales: PosSale[],
  from: number | null,
  to: number | null,
  filterPosId: string | null,
  defPos: string | null,
) {
  return sales
    .filter(s => inPeriod(s.createdAtIso, from, to))
    .filter(s => matchesPos(s.posId, filterPosId, defPos))
    .sort((a, b) => String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || '')))
}

export function filterShifts(
  shifts: PosShift[],
  from: number | null,
  to: number | null,
  filterPosId: string | null,
  defPos: string | null,
) {
  return shifts
    .filter(s => inPeriod(s.openedAtIso, from, to))
    .filter(s => matchesPos(s.posId, filterPosId, defPos))
    .sort((a, b) => String(b.openedAtIso || '').localeCompare(String(a.openedAtIso || '')))
}

export type SalesAgg = {
  revenue: number
  cash: number
  card: number
  credit: number
  salesCount: number
  returnedCount: number
  returnTotal: number
  receiptsCount: number
}

export function aggregateSales(sales: PosSale[]): SalesAgg {
  let revenue = 0
  let cash = 0
  let card = 0
  let credit = 0
  let salesCount = 0
  let returnedCount = 0
  let returnTotal = 0
  let receiptsCount = sales.length

  for (const s of sales) {
    const full = isSaleFullyReturned(s)
    const partial = isSalePartiallyReturned(s)
    if (full) {
      returnedCount += 1
      returnTotal = round2(returnTotal + (Number(s.originalTotal) || Number(s.lastReturnTotal) || Number(s.total) || 0))
      continue
    }
    salesCount += 1
    revenue = round2(revenue + (Number(s.total) || 0))
    cash = round2(cash + (Number(s.paidCash) || 0))
    card = round2(card + (Number(s.paidCard) || 0))
    credit = round2(credit + (Number(s.debtAdded) || 0))
    if (partial) {
      returnedCount += 1
      returnTotal = round2(returnTotal + (Number(s.lastReturnTotal) || 0))
    }
  }

  return { revenue, cash, card, credit, salesCount, returnedCount, returnTotal, receiptsCount }
}

export type TopProductRow = {
  productId: number
  productName: string
  qty: number
  revenue: number
  cogs: number
}

export function topProducts(
  sales: PosSale[],
  productsById: Map<number, Product>,
  limit = 50,
): TopProductRow[] {
  const acc = new Map<number, TopProductRow>()
  for (const s of sales) {
    if (isSaleFullyReturned(s)) continue
    for (const it of s.items || []) {
      const left = saleLineLeft(it)
      if (!(left > 0)) continue
      const qty0 = Number(it.qty) || 0
      const line0 = Number(it.lineTotal) || 0
      const unitRev = qty0 > 0 ? line0 / qty0 : Number(it.price) || 0
      const rev = round2(unitRev * left)
      const pid = Number(it.productId) || 0
      const cost = Number(productsById.get(pid)?.costPrice) || 0
      const prev = acc.get(pid) || {
        productId: pid,
        productName: it.productName || productsById.get(pid)?.name || `#${pid}`,
        qty: 0,
        revenue: 0,
        cogs: 0,
      }
      prev.qty = round2(prev.qty + left)
      prev.revenue = round2(prev.revenue + rev)
      prev.cogs = round2(prev.cogs + cost * left)
      if (!prev.productName && it.productName) prev.productName = it.productName
      acc.set(pid, prev)
    }
  }
  return Array.from(acc.values()).sort((a, b) => b.revenue - a.revenue).slice(0, limit)
}

export function sumCogs(rows: TopProductRow[]) {
  return round2(rows.reduce((s, r) => s + r.cogs, 0))
}

export function filterByCreatedAt<T extends { createdAtIso?: string }>(
  rows: T[],
  from: number | null,
  to: number | null,
) {
  return rows
    .filter(r => inPeriod(r.createdAtIso, from, to))
    .sort((a, b) => String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || '')))
}

export function sumReceiptCost(receipts: StockReceipt[]) {
  return round2(receipts.reduce((s, r) => s + (Number(r.totalCost) || 0), 0))
}

export function sumReceiptPaid(receipts: StockReceipt[]) {
  return round2(receipts.reduce((s, r) => s + (Number(r.paidNow) || 0), 0))
}

export function sumWriteoffCost(rows: StockWriteoff[]) {
  return round2(rows.reduce((s, r) => s + (Number(r.totalCost) || 0), 0))
}

export function sumExpenses(rows: PosExpense[]) {
  return round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0))
}

export function revisionDiffCount(rows: StockRevision[]) {
  let plus = 0
  let minus = 0
  for (const r of rows) {
    for (const it of r.items || []) {
      const d = Number(it.diff) || 0
      if (d > 0) plus = round2(plus + d)
      else if (d < 0) minus = round2(minus + Math.abs(d))
    }
  }
  return { plus, minus, count: rows.length }
}
