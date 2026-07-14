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

export type ReportPeriod = 'today' | '7d' | '30d' | 'month' | 'all' | 'custom'
export type ReportTab =
  | 'overview'
  | 'sales'
  | 'returns'
  | 'cashiers'
  | 'shifts'
  | 'till'
  | 'profit'
  | 'warehouse'
  | 'suppliers'
  | 'debts'
  | 'products'

export type SaleStatusFilter = 'all' | 'sold' | 'returned' | 'partial' | 'credit'
export type PayFilter = 'all' | 'cash' | 'card' | 'credit' | 'mixed'

export const REPORT_PERIODS: { id: ReportPeriod; label: string }[] = [
  { id: 'today', label: 'Сегодня' },
  { id: '7d', label: '7 дней' },
  { id: '30d', label: '30 дней' },
  { id: 'month', label: 'Этот месяц' },
  { id: 'all', label: 'Всё время' },
  { id: 'custom', label: 'Свои даты' },
]

export const REPORT_TABS: { id: ReportTab; label: string; icon: string; hint: string }[] = [
  { id: 'overview', label: 'Сводка', icon: '📈', hint: 'Деньги и итоги за выбранный период' },
  { id: 'sales', label: 'Продажи', icon: '🧾', hint: 'Все чеки кассы с оплатой и статусом' },
  { id: 'returns', label: 'Возвраты', icon: '↩️', hint: 'Полные и частичные возвраты' },
  { id: 'cashiers', label: 'Кассиры', icon: '👤', hint: 'Кто сколько продал' },
  { id: 'shifts', label: 'Смены', icon: '⏱', hint: 'Открытие/закрытие кассы' },
  { id: 'till', label: 'Касса факт', icon: '⚖️', hint: 'Ожидаемое vs фактическое по закрытым сменам (из БД)' },
  { id: 'profit', label: 'Прибыль', icon: '💎', hint: 'Выручка − закупочная себестоимость (FIFO) из БД' },
  { id: 'warehouse', label: 'Склад', icon: '🏬', hint: 'Приходы, списания, ревизии, сроки' },
  { id: 'suppliers', label: 'Поставщики', icon: '🚚', hint: 'Долги поставщикам и расходы' },
  { id: 'debts', label: 'Долги', icon: '💳', hint: 'Клиенты и продажи в долг' },
  { id: 'products', label: 'Товары', icon: '📦', hint: 'Что продаётся лучше всего' },
]

/** Query-параметры периода для API /finance/* */
export function periodToApiQuery(
  period: ReportPeriod,
  customFrom?: string,
  customTo?: string,
  extra?: { posId?: string; cashierId?: string; type?: string },
): Record<string, string> {
  const { from, to } = periodRange(period, customFrom, customTo)
  const q: Record<string, string> = {}
  if (from != null) q.from = new Date(from).toISOString()
  if (to != null) q.to = new Date(to).toISOString()
  if (extra?.posId) q.posId = extra.posId
  if (extra?.cashierId) q.cashierId = extra.cashierId
  if (extra?.type) q.type = extra.type
  return q
}

export const LEDGER_TYPE_LABELS: Record<string, string> = {
  shift_open: 'Открытие смены',
  shift_close: 'Сверка кассы',
  sale_cash: 'Продажа · нал',
  sale_card: 'Продажа · карта',
  sale_credit: 'Продажа · долг',
  sale_return_cash: 'Возврат · нал',
  sale_return_card: 'Возврат · карта',
  expense: 'Расход',
  deposit: 'Вклад',
  withdraw: 'Снятие',
  purchase_pay: 'Оплата закупа',
}

export function ledgerTypeLabel(type: string) {
  return LEDGER_TYPE_LABELS[type] || type
}

export const SALE_STATUS_OPTS: { id: SaleStatusFilter; label: string }[] = [
  { id: 'all', label: 'Все чеки' },
  { id: 'sold', label: 'Только продажи' },
  { id: 'returned', label: 'Полный возврат' },
  { id: 'partial', label: 'Частичный возврат' },
  { id: 'credit', label: 'С долгом' },
]

export const PAY_OPTS: { id: PayFilter; label: string }[] = [
  { id: 'all', label: 'Любая оплата' },
  { id: 'cash', label: 'Наличные' },
  { id: 'card', label: 'Карта' },
  { id: 'credit', label: 'В долг' },
  { id: 'mixed', label: 'Смешанная' },
]

export function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100
}

export function ymdLocal(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function periodRange(
  period: ReportPeriod,
  customFrom?: string,
  customTo?: string,
): { from: number | null; to: number | null } {
  const now = new Date()
  const end = now.getTime()
  if (period === 'custom') {
    const from = customFrom ? new Date(`${customFrom}T00:00:00`).getTime() : null
    const to = customTo ? new Date(`${customTo}T23:59:59.999`).getTime() : end
    return {
      from: from != null && !Number.isNaN(from) ? from : null,
      to: to != null && !Number.isNaN(to) ? to : null,
    }
  }
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

export type SaleFilters = {
  from: number | null
  to: number | null
  posId: string | null
  defPos: string | null
  cashierId?: string | null
  pay?: PayFilter
  status?: SaleStatusFilter
  q?: string
}

export function filterSales(sales: PosSale[], f: SaleFilters) {
  const q = (f.q || '').trim().toLowerCase()
  const qDigits = q.replace(/[^\d]/g, '')
  return sales
    .filter(s => inPeriod(s.createdAtIso, f.from, f.to))
    .filter(s => matchesPos(s.posId, f.posId, f.defPos))
    .filter(s => {
      if (!f.cashierId) return true
      return s.cashierId === f.cashierId || s.cashierName === f.cashierId
    })
    .filter(s => {
      const pay = f.pay || 'all'
      if (pay === 'all') return true
      if (pay === 'credit') return (Number(s.debtAdded) || 0) > 0 || s.paymentMethod === 'credit'
      return s.paymentMethod === pay
    })
    .filter(s => {
      const st = f.status || 'all'
      if (st === 'all') return true
      const full = isSaleFullyReturned(s)
      const partial = isSalePartiallyReturned(s)
      if (st === 'returned') return full
      if (st === 'partial') return partial
      if (st === 'credit') return !full && ((Number(s.debtAdded) || 0) > 0 || s.paymentMethod === 'credit')
      if (st === 'sold') return !full
      return true
    })
    .filter(s => {
      if (!q) return true
      const hay = [
        saleNumberLabel(s),
        s.orderId,
        s.id,
        s.cashierName,
        s.clientName,
        s.clientPhone,
        s.cardNum,
        paymentLabel(s),
        ...(s.items || []).map(i => i.productName),
      ].join(' ').toLowerCase()
      if (hay.includes(q)) return true
      if (qDigits && String(s.number || '').includes(qDigits)) return true
      return false
    })
    .sort((a, b) => String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || '')))
}

export function filterShifts(
  shifts: PosShift[],
  from: number | null,
  to: number | null,
  filterPosId: string | null,
  defPos: string | null,
  cashierId?: string | null,
) {
  return shifts
    .filter(s => inPeriod(s.openedAtIso, from, to))
    .filter(s => matchesPos(s.posId, filterPosId, defPos))
    .filter(s => {
      if (!cashierId) return true
      return s.cashierId === cashierId || s.cashierName === cashierId
    })
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
  avgCheck: number
}

export function aggregateSales(sales: PosSale[]): SalesAgg {
  let revenue = 0
  let cash = 0
  let card = 0
  let credit = 0
  let salesCount = 0
  let returnedCount = 0
  let returnTotal = 0
  const receiptsCount = sales.length

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

  return {
    revenue,
    cash,
    card,
    credit,
    salesCount,
    returnedCount,
    returnTotal,
    receiptsCount,
    avgCheck: salesCount > 0 ? round2(revenue / salesCount) : 0,
  }
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
  limit = 100,
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

export type CashierRow = {
  key: string
  name: string
  checks: number
  revenue: number
  cash: number
  card: number
  credit: number
  returns: number
}

export function cashierStats(sales: PosSale[]): CashierRow[] {
  const acc = new Map<string, CashierRow>()
  for (const s of sales) {
    const key = s.cashierId || s.cashierName || 'unknown'
    const name = s.cashierName || 'Без имени'
    const row = acc.get(key) || {
      key, name, checks: 0, revenue: 0, cash: 0, card: 0, credit: 0, returns: 0,
    }
    if (isSaleFullyReturned(s)) {
      row.returns += 1
    } else {
      row.checks += 1
      row.revenue = round2(row.revenue + (Number(s.total) || 0))
      row.cash = round2(row.cash + (Number(s.paidCash) || 0))
      row.card = round2(row.card + (Number(s.paidCard) || 0))
      row.credit = round2(row.credit + (Number(s.debtAdded) || 0))
      if (isSalePartiallyReturned(s)) row.returns += 1
    }
    acc.set(key, row)
  }
  return Array.from(acc.values()).sort((a, b) => b.revenue - a.revenue)
}

export type DayRow = { day: string; checks: number; revenue: number; cash: number; card: number; credit: number }

export function dailyBreakdown(sales: PosSale[]): DayRow[] {
  const acc = new Map<string, DayRow>()
  for (const s of sales) {
    if (isSaleFullyReturned(s)) continue
    const d = new Date(s.createdAtIso)
    if (Number.isNaN(d.getTime())) continue
    const day = ymdLocal(d)
    const row = acc.get(day) || { day, checks: 0, revenue: 0, cash: 0, card: 0, credit: 0 }
    row.checks += 1
    row.revenue = round2(row.revenue + (Number(s.total) || 0))
    row.cash = round2(row.cash + (Number(s.paidCash) || 0))
    row.card = round2(row.card + (Number(s.paidCard) || 0))
    row.credit = round2(row.credit + (Number(s.debtAdded) || 0))
    acc.set(day, row)
  }
  return Array.from(acc.values()).sort((a, b) => b.day.localeCompare(a.day))
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

export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? '')
    if (/[;"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const body = [headers.map(esc).join(';'), ...rows.map(r => r.map(esc).join(';'))].join('\n')
  const blob = new Blob(['\uFEFF' + body], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function formatPeriodLabel(period: ReportPeriod, customFrom?: string, customTo?: string) {
  if (period === 'custom') {
    if (customFrom && customTo) return `${customFrom} → ${customTo}`
    if (customFrom) return `с ${customFrom}`
    if (customTo) return `до ${customTo}`
    return 'Свои даты'
  }
  return REPORT_PERIODS.find(p => p.id === period)?.label || period
}
