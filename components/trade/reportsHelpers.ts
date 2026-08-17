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

export type ReportPeriod = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'all' | 'custom'
export type ReportTab =
  | 'overview'
  | 'sales'
  | 'returns'
  | 'cashiers'
  | 'shifts'
  | 'hours'
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
  { id: 'yesterday', label: 'Вчера' },
  { id: '7d', label: '7 дней' },
  { id: '30d', label: '30 дней' },
  { id: 'month', label: 'Этот месяц' },
  { id: 'all', label: 'Всё время' },
  { id: 'custom', label: 'Свои даты' },
]

export const REPORT_TABS: { id: ReportTab; label: string; icon: string; hint: string }[] = [
  { id: 'overview', label: 'Сводка', icon: '📈', hint: 'Деньги и итоги за период' },
  { id: 'sales', label: 'Продажи', icon: '🧾', hint: 'Чеки: оплата и статус' },
  { id: 'returns', label: 'Возвраты', icon: '↩️', hint: 'Полные и частичные возвраты' },
  { id: 'cashiers', label: 'Кассиры', icon: '👤', hint: 'Кто сколько продал' },
  { id: 'hours', label: 'По часам', icon: '🕒', hint: 'Когда больше продаж' },
  { id: 'shifts', label: 'Смены', icon: '⏱', hint: 'Открытие и закрытие кассы' },
  { id: 'till', label: 'Сверки', icon: '⚖️', hint: 'Ожидалось в кассе vs факт при закрытии' },
  { id: 'profit', label: 'Прибыль', icon: '💎', hint: 'Доход без расходов и после расходов кассы' },
  { id: 'warehouse', label: 'Склад', icon: '🏬', hint: 'Приходы, списания, ревизии, сроки' },
  { id: 'suppliers', label: 'Поставщики', icon: '🚚', hint: 'Долги поставщикам и закупки' },
  { id: 'debts', label: 'Долги', icon: '💳', hint: 'Выдали и вернули за выбранные дни · осталось — сколько должны сейчас' },
  { id: 'products', label: 'Товары', icon: '📦', hint: 'Топ за период · залежались за 30 дней · заказ по 7 дням' },
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
  debt_repay_cash: 'Погашение долга · нал',
  debt_repay_card: 'Погашение долга · карта',
  debt_repay: 'Погашение долга',
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
  if (period === 'yesterday') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime()
    const endY = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - 1
    return { from: start, to: endY }
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

/** Последние N календарных дней, включая сегодня. Не зависит от фильтра периода. */
export function lookbackRange(days: number): { from: number; to: number } {
  const now = new Date()
  const n = Math.max(1, Math.floor(Number(days) || 1))
  return {
    from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1)).getTime(),
    to: now.getTime(),
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

export function saleItemUnitCost(
  it: Pick<PosSaleItem, 'qty' | 'unitCost' | 'lineCost'>,
  catalogCost = 0,
) {
  const qty0 = Number(it.qty) || 0
  if (qty0 > 0 && it.lineCost != null && Number.isFinite(Number(it.lineCost))) {
    return Number(it.lineCost) / qty0
  }
  if (it.unitCost != null && Number.isFinite(Number(it.unitCost))) {
    return Number(it.unitCost)
  }
  return Number(catalogCost) || 0
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
      const cost = saleItemUnitCost(it, Number(productsById.get(pid)?.costPrice) || 0)
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

export type ProductInsightRow = {
  productId: number
  productName: string
  cat: string
  stock: number
  price: number
  cost: number
  qty: number
  revenue: number
  cogs: number
  profit: number
  supplierName: string
}

export type CategoryInsightRow = {
  cat: string
  products: number
  soldProducts: number
  unsoldProducts: number
  qty: number
  revenue: number
  cogs: number
  profit: number
  stock: number
}

export type SupplierInsightRow = {
  key: string
  name: string
  receipts: number
  suppliedCost: number
  paid: number
  debt: number
  soldQty: number
  revenue: number
  cogs: number
  profit: number
  products: number
}

/** Последний поставщик по приходам товара */
export function lastSupplierByProduct(receipts: StockReceipt[]): Map<number, string> {
  const map = new Map<number, string>()
  const ordered = [...receipts].sort((a, b) => String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || '')))
  for (const r of ordered) {
    const name = String(r.supplierName || '').trim() || 'Без поставщика'
    for (const it of r.items || []) {
      const pid = Number(it.productId) || 0
      if (pid > 0) map.set(pid, name)
    }
  }
  return map
}

export function buildProductInsights(
  products: Product[],
  sales: PosSale[],
  receipts: StockReceipt[],
): {
  all: ProductInsightRow[]
  top: ProductInsightRow[]
  unsold: ProductInsightRow[]
  deadStock: ProductInsightRow[]
  categories: CategoryInsightRow[]
  suppliers: SupplierInsightRow[]
} {
  const sold = topProducts(sales, new Map(products.map(p => [Number(p.id), p])), 10_000)
  const soldById = new Map(sold.map(r => [r.productId, r]))
  const supplierByProduct = lastSupplierByProduct(receipts)

  const all: ProductInsightRow[] = products.map(p => {
    const row = soldById.get(Number(p.id))
    const qty = Number(row?.qty) || 0
    const revenue = Number(row?.revenue) || 0
    const cogs = Number(row?.cogs) || 0
    const cost = Number(p.costPrice) || 0
    return {
      productId: Number(p.id),
      productName: p.name || `#${p.id}`,
      cat: String(p.cat || p.catId || 'Без категории'),
      stock: Number(p.stock) || 0,
      price: Number(p.price) || 0,
      cost,
      qty,
      revenue,
      cogs: qty > 0 ? cogs : 0,
      profit: round2(revenue - (qty > 0 ? cogs : 0)),
      supplierName: supplierByProduct.get(Number(p.id)) || '—',
    }
  }).sort((a, b) => b.revenue - a.revenue || a.productName.localeCompare(b.productName, 'ru'))

  const top = all.filter(r => r.qty > 0).slice(0, 50)
  const unsold = all
    .filter(r => !(r.qty > 0))
    .sort((a, b) => b.stock - a.stock || a.productName.localeCompare(b.productName, 'ru'))
  const deadStock = unsold.filter(r => r.stock > 0).slice(0, 80)

  const catAcc = new Map<string, CategoryInsightRow>()
  for (const r of all) {
    const row = catAcc.get(r.cat) || {
      cat: r.cat,
      products: 0,
      soldProducts: 0,
      unsoldProducts: 0,
      qty: 0,
      revenue: 0,
      cogs: 0,
      profit: 0,
      stock: 0,
    }
    row.products += 1
    if (r.qty > 0) row.soldProducts += 1
    else row.unsoldProducts += 1
    row.qty = round2(row.qty + r.qty)
    row.revenue = round2(row.revenue + r.revenue)
    row.cogs = round2(row.cogs + r.cogs)
    row.profit = round2(row.profit + r.profit)
    row.stock = round2(row.stock + r.stock)
    catAcc.set(r.cat, row)
  }
  const categories = Array.from(catAcc.values()).sort((a, b) => b.revenue - a.revenue || b.products - a.products)

  const supplierAcc = new Map<string, SupplierInsightRow>()
  for (const r of receipts) {
    if (r.stockAdjustment) continue
    const name = String(r.supplierName || '').trim() || 'Без поставщика'
    const key = String(r.supplierId || name)
    const row = supplierAcc.get(key) || {
      key,
      name,
      receipts: 0,
      suppliedCost: 0,
      paid: 0,
      debt: 0,
      soldQty: 0,
      revenue: 0,
      cogs: 0,
      profit: 0,
      products: 0,
    }
    row.receipts += 1
    row.suppliedCost = round2(row.suppliedCost + (Number(r.totalCost) || 0))
    row.paid = round2(row.paid + (Number(r.paidNow) || 0))
    row.debt = round2(row.debt + (Number(r.debtAdded) || 0))
    supplierAcc.set(key, row)
  }

  const productIdsBySupplier = new Map<string, Set<number>>()
  for (const r of receipts) {
    if (r.stockAdjustment) continue
    const name = String(r.supplierName || '').trim() || 'Без поставщика'
    const key = String(r.supplierId || name)
    const set = productIdsBySupplier.get(key) || new Set<number>()
    for (const it of r.items || []) {
      const pid = Number(it.productId) || 0
      if (pid > 0) set.add(pid)
    }
    productIdsBySupplier.set(key, set)
  }

  for (const [key, set] of productIdsBySupplier) {
    const row = supplierAcc.get(key)
    if (!row) continue
    row.products = set.size
    for (const pid of set) {
      const p = soldById.get(pid)
      if (!p) continue
      row.soldQty = round2(row.soldQty + p.qty)
      row.revenue = round2(row.revenue + p.revenue)
      row.cogs = round2(row.cogs + p.cogs)
    }
    row.profit = round2(row.revenue - row.cogs)
  }

  const suppliers = Array.from(supplierAcc.values()).sort((a, b) => b.profit - a.profit || b.revenue - a.revenue)

  return { all, top, unsold, deadStock, categories, suppliers }
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
  return round2(receipts.reduce((s, r) => s + (r.stockAdjustment ? 0 : Number(r.totalCost) || 0), 0))
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

export function previousPeriodRange(
  period: ReportPeriod,
  customFrom?: string,
  customTo?: string,
): { from: number | null; to: number | null } {
  const { from, to } = periodRange(period, customFrom, customTo)
  if (from == null || to == null) return { from: null, to: null }
  const span = Math.max(1, to - from)
  return { from: from - span - 1, to: from - 1 }
}

export function deltaPct(current: number, previous: number) {
  if (!(Math.abs(previous) > 0.001)) return null
  return round2(((current - previous) / Math.abs(previous)) * 100)
}

export function sumLedgerDebtRepaid(entries?: { type?: string; amount?: number; signedAmount?: number }[]) {
  let n = 0
  for (const e of entries || []) {
    const t = String(e.type || '')
    if (!t.includes('debt_repay')) continue
    n = round2(n + Math.abs(Number(e.amount) || Number(e.signedAmount) || 0))
  }
  return n
}

export type DebtRepaidPick = {
  amount: number
  /** journal = касса (есть точка/кассир). history = погашения клиентов, без точки */
  source: 'journal' | 'history'
}

/** Одна сумма «вернули»: журнал кассы, если там есть погашения. Иначе история клиентов. Не складывать оба. */
export function pickDebtRepaid(input: {
  journal?: { type?: string; amount?: number; signedAmount?: number }[]
  cashBook?: { type?: string; amount?: number; signedAmount?: number }[]
  historyTotal: number
}): DebtRepaidPick {
  const fromJournal = sumLedgerDebtRepaid(input.journal)
  if (fromJournal > 0.001) return { amount: fromJournal, source: 'journal' }
  const fromCash = sumLedgerDebtRepaid(input.cashBook)
  if (fromCash > 0.001) return { amount: fromCash, source: 'journal' }
  return { amount: round2(input.historyTotal), source: 'history' }
}

export type PointRow = {
  key: string
  name: string
  checks: number
  revenue: number
  cash: number
  card: number
  credit: number
}

export function pointStats(sales: PosSale[], points: PosPoint[], defPos: string | null): PointRow[] {
  const acc = new Map<string, PointRow>()
  for (const s of sales) {
    if (isSaleFullyReturned(s)) continue
    const key = s.posId || defPos || '—'
    const name = posName(points, key)
    const row = acc.get(key) || { key, name, checks: 0, revenue: 0, cash: 0, card: 0, credit: 0 }
    row.checks += 1
    row.revenue = round2(row.revenue + (Number(s.total) || 0))
    row.cash = round2(row.cash + (Number(s.paidCash) || 0))
    row.card = round2(row.card + (Number(s.paidCard) || 0))
    row.credit = round2(row.credit + (Number(s.debtAdded) || 0))
    acc.set(key, row)
  }
  return Array.from(acc.values()).sort((a, b) => b.revenue - a.revenue)
}

export type HourRow = {
  hour: number
  checks: number
  revenue: number
  cash: number
  card: number
  credit: number
}

export function hourlyBreakdown(sales: PosSale[]): HourRow[] {
  const acc = Array.from({ length: 24 }, (_, hour) => ({
    hour, checks: 0, revenue: 0, cash: 0, card: 0, credit: 0,
  }))
  for (const s of sales) {
    if (isSaleFullyReturned(s)) continue
    const d = new Date(s.createdAtIso)
    if (Number.isNaN(d.getTime())) continue
    const row = acc[d.getHours()]
    row.checks += 1
    row.revenue = round2(row.revenue + (Number(s.total) || 0))
    row.cash = round2(row.cash + (Number(s.paidCash) || 0))
    row.card = round2(row.card + (Number(s.paidCard) || 0))
    row.credit = round2(row.credit + (Number(s.debtAdded) || 0))
  }
  return acc
}

export type AbcRow = ProductInsightRow & { abc: 'A' | 'B' | 'C'; share: number }

export function abcClassify(rows: ProductInsightRow[]): AbcRow[] {
  const sold = rows.filter(r => r.revenue > 0.001)
  const total = sold.reduce((s, r) => s + r.revenue, 0)
  let cum = 0
  return sold.map(r => {
    const before = total > 0 ? cum / total : 0
    cum = round2(cum + r.revenue)
    const abc: 'A' | 'B' | 'C' = before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C'
    return { ...r, abc, share: total > 0 ? round2((r.revenue / total) * 100) : 0 }
  })
}

export type OrderSuggestRow = ProductInsightRow & { daysCover: number; suggestQty: number; reason: string }

export function orderSuggestions(
  rows: ProductInsightRow[],
  days = 7,
): OrderSuggestRow[] {
  const span = Math.max(1, days)
  const out: OrderSuggestRow[] = []
  for (const r of rows) {
    if (!(r.qty > 0)) continue
    const daily = r.qty / span
    const weekNeed = daily * 7
    const daysCover = daily > 0.001 ? r.stock / daily : 999
    let reason = ''
    let suggestQty = 0
    if (r.stock <= 0) {
      reason = 'Нет на складе, продавался за 7 дн.'
      suggestQty = Math.max(1, Math.ceil(weekNeed))
    } else if (daysCover < 3) {
      reason = `Хватит ~${Math.max(0, Math.round(daysCover))} дн.`
      suggestQty = Math.max(1, Math.ceil(weekNeed - r.stock))
    } else if (r.stock < weekNeed * 0.4) {
      reason = 'Мало к продажам за 7 дн.'
      suggestQty = Math.max(1, Math.ceil(weekNeed - r.stock))
    }
    if (suggestQty > 0) out.push({ ...r, daysCover: round2(daysCover), suggestQty, reason })
  }
  return out.sort((a, b) => a.daysCover - b.daysCover).slice(0, 80)
}

export function lossProducts(rows: ProductInsightRow[]): (ProductInsightRow & { reason: string })[] {
  return rows
    .filter(r => r.qty > 0 && r.profit < -0.009)
    .map(r => ({
      ...r,
      reason: r.cogs > r.revenue ? 'Закуп дороже продажи' : 'Убыток по товару',
    }))
    .sort((a, b) => a.profit - b.profit)
    .slice(0, 80)
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
