/**
 * Durable cash debt-repay projection for expected till.
 * Survives ACK (outbox delete), softSync, and restart.
 * Dedupes by stable clientRef (operation identity).
 */
const LS_KEY = 'kakapo_debt_repay_cash_v1'

/** @typedef {{ clientRef: string, shiftId: string, amount: number, method?: string, orderId?: string, createdAtIso?: string }} DebtRepayCashAck */

/** @type {DebtRepayCashAck[] | null} */
let mem = null

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function readLs() {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(LS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function writeLs(rows) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(rows))
  } catch { /* ignore quota */ }
}

export function loadDebtRepayCashLedger() {
  if (mem) return mem
  mem = readLs()
  return mem
}

/** Replace in-memory ledger (tests / hydrate from KV). */
export function replaceDebtRepayCashLedger(rows) {
  mem = Array.isArray(rows) ? rows.slice() : []
  writeLs(mem)
  return mem
}

/**
 * Remember a cash debt repayment. Idempotent by clientRef.
 * Card method is ignored (0 till effect).
 */
export function rememberCashDebtRepay(entry) {
  const clientRef = String(entry?.clientRef || '').trim()
  const shiftId = String(entry?.shiftId || '').trim()
  const method = String(entry?.method || 'cash') === 'card' ? 'card' : 'cash'
  const amount = round2(Number(entry?.amount) || 0)
  if (!clientRef || !shiftId || !(amount > 0) || method === 'card') return false

  const rows = loadDebtRepayCashLedger()
  const idx = rows.findIndex(r => String(r.clientRef || '').trim() === clientRef)
  const next = {
    clientRef,
    shiftId,
    amount,
    method: 'cash',
    orderId: String(entry?.orderId || '').trim() || undefined,
    createdAtIso: String(entry?.createdAtIso || '').trim() || new Date().toISOString(),
  }
  if (idx >= 0) {
    // Same clientRef = same op: keep first amount (idempotent ACK/retry)
    const prev = rows[idx]
    rows[idx] = {
      ...prev,
      ...next,
      amount: round2(Number(prev.amount) || amount),
      shiftId: String(prev.shiftId || shiftId),
    }
  } else {
    rows.push(next)
  }
  // Cap growth — keep last 2000 ops
  if (rows.length > 2000) rows.splice(0, rows.length - 2000)
  mem = rows
  writeLs(rows)
  return true
}

export function forgetCashDebtRepay(clientRef) {
  const ref = String(clientRef || '').trim()
  if (!ref) return false
  const rows = loadDebtRepayCashLedger()
  const next = rows.filter(r => String(r.clientRef || '').trim() !== ref)
  if (next.length === rows.length) return false
  mem = next
  writeLs(next)
  return true
}

/** Rows for overlay uniqueDebtRepayCashForShift (cash only). */
export function cashDebtRepayRowsForShift(shiftId) {
  const sid = String(shiftId || '').trim()
  if (!sid) return []
  return loadDebtRepayCashLedger()
    .filter(r => String(r.shiftId || '').trim() === sid)
    .map(r => ({
      clientRef: r.clientRef,
      shiftId: r.shiftId,
      amount: r.amount,
      method: 'cash',
      orderId: r.orderId,
      id: r.clientRef,
    }))
}

export function uniqueCashDebtRepayTotalForShift(shiftId) {
  const sid = String(shiftId || '').trim()
  if (!sid) return 0
  const by = new Map()
  for (const r of cashDebtRepayRowsForShift(sid)) {
    const ref = String(r.clientRef || '').trim()
    const amt = round2(Number(r.amount) || 0)
    if (!ref || !(amt > 0)) continue
    if (!by.has(ref)) by.set(ref, amt)
  }
  let sum = 0
  for (const a of by.values()) sum = round2(sum + a)
  return sum
}

/**
 * Merge durable debtRepayCash onto a shift after server sync wipe.
 * Does not change sale counters.
 */
export function withPreservedDebtRepayCash(localShift, remoteShift) {
  const shiftId = String(remoteShift?.id || localShift?.id || '').trim()
  const fromLocal = round2(Number(localShift?.debtRepayCash) || 0)
  const fromRemote = round2(Number(remoteShift?.debtRepayCash) || 0)
  const fromLedger = uniqueCashDebtRepayTotalForShift(shiftId)
  const debtRepayCash = round2(Math.max(fromLocal, fromRemote, fromLedger))
  return {
    ...(remoteShift || localShift || {}),
    debtRepayCash,
  }
}

/** Test helper — clear memory + LS */
export function _resetDebtRepayCashLedgerForTests() {
  mem = []
  writeLs([])
}
