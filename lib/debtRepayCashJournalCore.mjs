/**
 * Pure helpers: map server moneyLedger debt_repay_cash → durable local ledger entries.
 * No network. Used by Desktop hydrate + node tests.
 */

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

/**
 * True if journal row is a cash debt repayment for till.
 * Card / wrong type → false.
 */
export function isCashDebtRepayJournalRow(row) {
  if (!row || typeof row !== 'object') return false
  const type = String(row.type || '').trim()
  if (type !== 'debt_repay_cash') return false
  const method = String(row.meta?.method || row.method || 'cash').toLowerCase()
  if (method === 'card' || method === 'debt_repay_card') return false
  const amount = round2(Number(row.amount) || 0)
  return amount > 0
}

/**
 * Dedupe key: clientRef primary, LED-* id fallback.
 */
export function journalDebtRepayDedupeKey(row) {
  const ref = String(row?.clientRef || row?.meta?.clientRef || '').trim()
  if (ref) return ref
  const id = String(row?.id || '').trim()
  return id
}

/**
 * Filter journal rows for one open shift.
 */
export function filterCashDebtRepayJournalForShift(rows, shiftId) {
  const sid = String(shiftId || '').trim()
  if (!sid) return []
  const out = []
  const seen = new Set()
  for (const row of rows || []) {
    if (!isCashDebtRepayJournalRow(row)) continue
    if (String(row.shiftId || '').trim() !== sid) continue
    const key = journalDebtRepayDedupeKey(row)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

/**
 * Map one journal row → rememberCashDebtRepay entry.
 */
export function journalRowToLedgerEntry(row) {
  const clientRef = journalDebtRepayDedupeKey(row)
  const shiftId = String(row?.shiftId || '').trim()
  const amount = round2(Number(row?.amount) || 0)
  return {
    clientRef,
    shiftId,
    amount,
    method: 'cash',
    createdAtIso: String(row?.createdAtIso || '').trim() || undefined,
  }
}

/**
 * Apply filtered journal rows via rememberFn (same API as local repay).
 * Returns number of remember() calls that returned true (new or refresh).
 */
export function applyCashDebtRepayJournalRows(rows, shiftId, rememberFn) {
  const filtered = filterCashDebtRepayJournalForShift(rows, shiftId)
  let n = 0
  for (const row of filtered) {
    const entry = journalRowToLedgerEntry(row)
    if (!entry.clientRef || !entry.shiftId || !(entry.amount > 0)) continue
    try {
      if (rememberFn(entry)) n += 1
    } catch { /* ignore one bad row */ }
  }
  return n
}
