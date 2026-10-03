/**
 * Pure current-shift totals from unique posSales rows (exact shiftId).
 * Display/close source of truth — not denormalized shift.salesCount/salesCash.
 */

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

export function saleDedupeKey(sale) {
  const ref = String(sale?.clientRef || '').trim()
  if (ref) return `ref:${ref}`
  const id = String(sale?.id || '').trim()
  if (id) return `id:${id}`
  return ''
}

function isoMs(value) {
  const t = Date.parse(String(value || ''))
  return Number.isFinite(t) ? t : 0
}

/** Prefer server SALE-* over off-*; then newer updated/created. */
export function preferSaleRow(a, b) {
  if (!a) return b
  if (!b) return a
  const aOff = String(a.id || '').startsWith('off-')
  const bOff = String(b.id || '').startsWith('off-')
  if (aOff !== bOff) return aOff ? b : a
  const aMs = Math.max(isoMs(a.updatedAtIso), isoMs(a.createdAtIso))
  const bMs = Math.max(isoMs(b.updatedAtIso), isoMs(b.createdAtIso))
  if (bMs !== aMs) return bMs > aMs ? b : a
  return b
}

/**
 * Unique sale rows belonging to exact shiftId (string match).
 * Dedupes by clientRef, else id — offline+server copies count once.
 */
export function uniqueSalesForShift(sales, shiftId) {
  const sid = String(shiftId || '').trim()
  if (!sid) return []
  const byKey = new Map()
  for (const sale of sales || []) {
    if (String(sale?.shiftId || '').trim() !== sid) continue
    const key = saleDedupeKey(sale)
    if (!key) continue
    byKey.set(key, preferSaleRow(byKey.get(key), sale))
  }
  return [...byKey.values()]
}

/**
 * Aggregate display/close counters from unique sale rows for one shift.
 * Fully returned rows stay in salesCount (match history «Чеков») but money is 0.
 */
export function aggregateShiftSaleTotals(sales, shiftId) {
  const rows = uniqueSalesForShift(sales, shiftId)
  let revenue = 0
  let salesCash = 0
  let salesCard = 0
  let salesCredit = 0
  let paidWallet = 0
  for (const s of rows) {
    if (String(s?.status || '') === 'returned') continue
    revenue = round2(revenue + (Number(s.total) || 0))
    salesCash = round2(salesCash + (Number(s.paidCash) || 0))
    salesCard = round2(salesCard + (Number(s.paidCard) || 0))
    salesCredit = round2(salesCredit + (Number(s.debtAdded) || 0))
    paidWallet = round2(paidWallet + (Number(s.paidWallet) || 0))
  }
  return {
    salesCount: rows.length,
    revenue,
    salesCash,
    salesCard,
    salesCredit,
    paidWallet,
  }
}

/** Overlay live sale totals onto a shift object (opening/cashIn/expense unchanged).
 * salesCash/salesCard stay sale-row only (1.2.179).
 * debtRepayCash = unique cash debt repayments (not sale revenue).
 */
export function overlayShiftSaleTotals(shift, sales, repayRows) {
  if (!shift) return shift
  const t = aggregateShiftSaleTotals(sales, shift.id)
  const fromRows = uniqueDebtRepayCashForShift(repayRows, shift.id)
  const fromShift = round2(Number(shift.debtRepayCash) || 0)
  const debtRepayCash = round2(Math.max(fromRows, fromShift))
  const other = otherShiftReturnTotalsForShift(sales, shift.id)
  return {
    ...shift,
    salesCount: t.salesCount,
    salesCash: t.salesCash,
    salesCard: t.salesCard,
    salesCredit: t.salesCredit,
    debtRepayCash,
    otherShiftReturnCash: round2(Math.max(other.cash, Number(shift.otherShiftReturnCash) || 0)),
    otherShiftReturnCard: round2(Math.max(other.card, Number(shift.otherShiftReturnCard) || 0)),
  }
}

/**
 * Возвраты чеков из других (закрытых) смен, выданные из кассы этой смены.
 * Источник — returns[].tillShiftId на строках чеков (локальных и серверных).
 */
export function otherShiftReturnTotalsForShift(sales, shiftId) {
  const sid = String(shiftId || '').trim()
  let cash = 0
  let card = 0
  if (!sid) return { cash, card }
  const byKey = new Map()
  for (const sale of sales || []) {
    if (!Array.isArray(sale?.returns)) continue
    if (!sale.returns.some(r => String(r?.tillShiftId || '') === sid)) continue
    const key = saleDedupeKey(sale)
    if (!key) continue
    byKey.set(key, preferSaleRow(byKey.get(key), sale))
  }
  for (const sale of byKey.values()) {
    for (const r of sale.returns || []) {
      if (String(r?.tillShiftId || '') !== sid) continue
      cash = round2(cash + (Number(r.cutCash) || 0))
      card = round2(card + (Number(r.cutCard) || 0))
    }
  }
  return { cash, card }
}

/** Карта по смене к сверке: продажи картой минус возвраты на карту по чекам других смен. */
export function expectedCardFromShift(shift) {
  return round2((Number(shift?.salesCard) || 0) - (Number(shift?.otherShiftReturnCard) || 0))
}

/**
 * Unique cash debt-repay amounts for a shift (dedupe by clientRef, else id).
 * Rows: { clientRef?, id?, shiftId?, amount?, method? } from pending ops / ledger.
 */
export function uniqueDebtRepayCashForShift(repayRows, shiftId) {
  const sid = String(shiftId || '').trim()
  if (!sid) return 0
  const byKey = new Map()
  for (const row of repayRows || []) {
    if (String(row?.shiftId || '').trim() !== sid) continue
    const method = String(row?.method || row?.type || 'cash')
    if (method === 'card' || method === 'debt_repay_card') continue
    const ref = String(row?.clientRef || '').trim()
    const id = String(row?.id || '').trim()
    const key = ref ? `ref:${ref}` : (id ? `id:${id}` : '')
    if (!key) continue
    const amt = round2(Number(row?.amount) || 0)
    if (!(amt > 0)) continue
    if (!byKey.has(key)) byKey.set(key, amt)
  }
  let sum = 0
  for (const amt of byKey.values()) sum = round2(sum + amt)
  return sum
}

/**
 * Till cash for an overlaid shift (salesCash = sale rows only, repay in debtRepayCash).
 * Server rows fold repay into salesCash and carry no debtRepayCash, so the sum matches shiftExpectedCash.
 */
export function expectedTillCashFromShift(shift) {
  return round2(
    (Number(shift?.openingCash) || 0)
    + (Number(shift?.salesCash) || 0)
    + (Number(shift?.debtRepayCash) || 0)
    + (Number(shift?.cashInTotal) || 0)
    - (Number(shift?.expenseTotal) || 0)
    - (Number(shift?.otherShiftReturnCash) || 0),
  )
}
