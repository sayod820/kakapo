/**
 * Единый источник правды по деньгам (ledger + автоотчёты).
 * Все цифры считаются только из db — приложения только запрашивают.
 */

export const CASH_DIFF_ALERT_SOM = 50

function ensureLedger(db) {
  if (!db || typeof db !== 'object') throw new Error('db required')
  if (!Array.isArray(db.moneyLedger)) db.moneyLedger = []
  if (!Array.isArray(db.posShifts)) db.posShifts = []
  if (!Array.isArray(db.posSales)) db.posSales = []
  if (!Array.isArray(db.products)) db.products = []
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function nowIso() {
  return new Date().toISOString()
}

function nextId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function ymd(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function inRange(iso, fromIso, toIso) {
  if (!iso) return false
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return false
  if (fromIso) {
    const f = new Date(fromIso).getTime()
    if (!Number.isNaN(f) && t < f) return false
  }
  if (toIso) {
    const to = new Date(toIso).getTime()
    if (!Number.isNaN(to) && t > to) return false
  }
  return true
}

/** Запись в неизменяемый журнал денег */
export function appendMoneyLedger(db, data = {}) {
  ensureLedger(db)
  const amount = round2(Math.abs(Number(data.amount) || 0))
  const direction = data.direction === 'out' || data.direction === 'info' ? data.direction : 'in'
  const cashAffect = data.cashAffect === true || (data.cashAffect !== false && direction !== 'info' && data.type !== 'sale_credit' && data.type !== 'shift_close')
  const signedAmount = data.signedAmount != null
    ? round2(Number(data.signedAmount) || 0)
    : direction === 'out' ? -amount : direction === 'in' ? amount : 0
  const row = {
    id: nextId('LED'),
    createdAtIso: data.createdAtIso || nowIso(),
    type: String(data.type || 'other'),
    amount: amount || Math.abs(signedAmount),
    direction,
    signedAmount,
    cashAffect: !!cashAffect,
    posId: data.posId || '',
    shiftId: data.shiftId || '',
    cashierId: data.cashierId || '',
    cashierName: data.cashierName || '',
    refType: data.refType || '',
    refId: data.refId || '',
    note: String(data.note || '').trim(),
    reason: String(data.reason || '').trim(),
    meta: data.meta && typeof data.meta === 'object' ? data.meta : {},
  }
  db.moneyLedger.unshift(row)
  return row
}

export function listMoneyLedger(db, q = {}) {
  ensureLedger(db)
  let rows = [...db.moneyLedger]
  if (q.from) rows = rows.filter(r => inRange(r.createdAtIso, q.from, null))
  if (q.to) rows = rows.filter(r => inRange(r.createdAtIso, null, q.to))
  if (q.posId) rows = rows.filter(r => r.posId === q.posId)
  if (q.cashierId) rows = rows.filter(r => r.cashierId === q.cashierId || r.cashierName === q.cashierId)
  if (q.type) rows = rows.filter(r => r.type === q.type)
  if (q.cashOnly) rows = rows.filter(r => r.cashAffect)
  rows.sort((a, b) => String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || '')))
  return rows
}

/** Кассовая книга: движение наличных + running balance */
export function getCashBook(db, q = {}) {
  const rows = listMoneyLedger(db, { ...q, cashOnly: true })
    .slice()
    .sort((a, b) => String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || '')))

  let balance = 0
  const entries = rows.map(r => {
    balance = round2(balance + (Number(r.signedAmount) || 0))
    return {
      ...r,
      balanceAfter: balance,
    }
  })

  const byDayMap = new Map()
  for (const e of entries) {
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

  return {
    balance,
    entries: entries.slice().reverse(),
    days,
    summary: {
      inflow: round2(entries.filter(e => (Number(e.signedAmount) || 0) > 0).reduce((s, e) => s + e.signedAmount, 0)),
      outflow: round2(entries.filter(e => (Number(e.signedAmount) || 0) < 0).reduce((s, e) => s + Math.abs(e.signedAmount), 0)),
      count: entries.length,
    },
  }
}

function shiftExpectedCash(shift) {
  return round2(
    (Number(shift.openingCash) || 0)
    + (Number(shift.salesCash) || 0)
    - (Number(shift.expenseTotal) || 0),
  )
}

/** Ожидаемое vs факт по сменам/кассам */
export function getExpectedVsActual(db, q = {}) {
  ensureLedger(db)
  let shifts = (db.posShifts || []).filter(s => s.status === 'closed')
  if (q.from) shifts = shifts.filter(s => inRange(s.closedAtIso || s.openedAtIso, q.from, null))
  if (q.to) shifts = shifts.filter(s => inRange(s.closedAtIso || s.openedAtIso, null, q.to))
  if (q.posId) shifts = shifts.filter(s => s.posId === q.posId)

  const rows = shifts.map(s => {
    const expected = s.expectedCash != null ? round2(s.expectedCash) : shiftExpectedCash(s)
    const actual = s.actualCash != null ? round2(s.actualCash) : round2(s.closingCash)
    const diff = s.cashDiff != null ? round2(s.cashDiff) : round2(actual - expected)
    return {
      shiftId: s.id,
      posId: s.posId || '',
      cashierId: s.cashierId,
      cashierName: s.cashierName,
      openedAtIso: s.openedAtIso,
      closedAtIso: s.closedAtIso,
      openingCash: round2(s.openingCash),
      salesCash: round2(s.salesCash),
      expenseTotal: round2(s.expenseTotal),
      expectedCash: expected,
      actualCash: actual,
      cashDiff: diff,
      alert: Math.abs(diff) >= CASH_DIFF_ALERT_SOM,
      day: ymd(s.closedAtIso || s.openedAtIso),
    }
  }).sort((a, b) => String(b.closedAtIso || '').localeCompare(String(a.closedAtIso || '')))

  const alertCount = rows.filter(r => r.alert).length
  const totalDiff = round2(rows.reduce((s, r) => s + Math.abs(r.cashDiff), 0))

  return {
    threshold: CASH_DIFF_ALERT_SOM,
    rows,
    summary: {
      shifts: rows.length,
      withAlert: alertCount,
      absDiffSum: totalDiff,
      shortCount: rows.filter(r => r.cashDiff < -0.009).length,
      overCount: rows.filter(r => r.cashDiff > 0.009).length,
    },
  }
}

function saleNetRevenue(sale) {
  if (sale.status === 'returned') return 0
  return round2(Number(sale.total) || 0)
}

function saleCogs(sale, db) {
  if (sale.totalCost != null) return round2(sale.totalCost)
  // fallback для старых чеков
  let cogs = 0
  for (const it of sale.items || []) {
    const left = Math.max(0, round2((Number(it.qty) || 0) - (Number(it.returnedQty) || 0)))
    if (!(left > 0)) continue
    if (it.lineCost != null && Number(it.qty) > 0) {
      cogs = round2(cogs + (Number(it.lineCost) || 0) * (left / Number(it.qty)))
      continue
    }
    const p = (db.products || []).find(x => Number(x.id) === Number(it.productId))
    const unit = Number(it.unitCost) || Number(p?.costPrice) || 0
    cogs = round2(cogs + unit * left)
  }
  return cogs
}

/** Прибыль: выручка − себестоимость (FIFO/слои) */
export function getProfitReport(db, q = {}) {
  ensureLedger(db)
  let sales = [...(db.posSales || [])]
  if (q.from) sales = sales.filter(s => inRange(s.createdAtIso, q.from, null))
  if (q.to) sales = sales.filter(s => inRange(s.createdAtIso, null, q.to))
  if (q.posId) sales = sales.filter(s => (s.posId || '') === q.posId)

  let revenue = 0
  let cogs = 0
  let count = 0
  const byProduct = new Map()

  for (const sale of sales) {
    if (sale.status === 'returned') continue
    const rev = saleNetRevenue(sale)
    const cost = saleCogs(sale, db)
    if (!(rev > 0) && !(cost > 0)) continue
    revenue = round2(revenue + rev)
    cogs = round2(cogs + cost)
    count += 1
    for (const it of sale.items || []) {
      const left = Math.max(0, round2((Number(it.qty) || 0) - (Number(it.returnedQty) || 0)))
      if (!(left > 0)) continue
      const unitRev = Number(it.qty) > 0 ? (Number(it.lineTotal) || 0) / Number(it.qty) : Number(it.price) || 0
      const unitCost = Number(it.unitCost) || (() => {
        const p = (db.products || []).find(x => Number(x.id) === Number(it.productId))
        return Number(p?.costPrice) || 0
      })()
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

  const profit = round2(revenue - cogs)
  const marginPct = revenue > 0 ? round2((profit / revenue) * 100) : 0
  const products = [...byProduct.values()]
    .map(p => ({ ...p, profit: round2(p.revenue - p.cogs) }))
    .sort((a, b) => b.profit - a.profit)

  return {
    summary: { revenue, cogs, profit, marginPct, salesCount: count },
    products: products.slice(0, 100),
  }
}

export function getFinanceAlerts(db, q = {}) {
  const vs = getExpectedVsActual(db, q)
  const alerts = []
  for (const r of vs.rows) {
    if (!r.alert) continue
    alerts.push({
      id: `cashdiff-${r.shiftId}`,
      kind: 'cash_diff',
      severity: Math.abs(r.cashDiff) >= CASH_DIFF_ALERT_SOM * 2 ? 'high' : 'warn',
      title: r.cashDiff < 0 ? 'Недостача в кассе' : 'Излишек в кассе',
      message: `${r.cashierName || 'Кассир'}: ожидалось ${r.expectedCash.toFixed(2)}, факт ${r.actualCash.toFixed(2)}, разница ${r.cashDiff.toFixed(2)} сом`,
      amount: r.cashDiff,
      atIso: r.closedAtIso,
      posId: r.posId,
      shiftId: r.shiftId,
      cashierName: r.cashierName,
    })
  }

  // Открытые смены дольше 16ч
  const now = Date.now()
  for (const s of db.posShifts || []) {
    if (s.status !== 'open') continue
    const t = new Date(s.openedAtIso).getTime()
    if (Number.isNaN(t)) continue
    if (now - t > 16 * 3600 * 1000) {
      alerts.push({
        id: `longshift-${s.id}`,
        kind: 'long_shift',
        severity: 'warn',
        title: 'Долгая открытая смена',
        message: `${s.cashierName || 'Кассир'} — смена открыта более 16 часов`,
        amount: 0,
        atIso: s.openedAtIso,
        posId: s.posId,
        shiftId: s.id,
        cashierName: s.cashierName,
      })
    }
  }

  alerts.sort((a, b) => String(b.atIso || '').localeCompare(String(a.atIso || '')))
  return {
    threshold: CASH_DIFF_ALERT_SOM,
    alerts,
    count: alerts.length,
  }
}

/** Сводный пакет правды для UI */
export function getFinanceTruthBundle(db, q = {}) {
  return {
    cashBook: getCashBook(db, q),
    expectedVsActual: getExpectedVsActual(db, q),
    profit: getProfitReport(db, q),
    journal: listMoneyLedger(db, q).slice(0, 500),
    alerts: getFinanceAlerts(db, q),
    generatedAtIso: nowIso(),
  }
}
