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

/** Overlay live sale totals onto a shift object (opening/cashIn/expense unchanged). */
export function overlayShiftSaleTotals(shift, sales) {
  if (!shift) return shift
  const t = aggregateShiftSaleTotals(sales, shift.id)
  return {
    ...shift,
    salesCount: t.salesCount,
    salesCash: t.salesCash,
    salesCard: t.salesCard,
    salesCredit: t.salesCredit,
  }
}

export function expectedTillCashFromShift(shift) {
  return round2(
    (Number(shift?.openingCash) || 0)
    + (Number(shift?.salesCash) || 0)
    + (Number(shift?.cashInTotal) || 0)
    - (Number(shift?.expenseTotal) || 0),
  )
}
