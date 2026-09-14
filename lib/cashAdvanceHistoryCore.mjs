/**
 * Pure cash-advance history projection helpers (no I/O).
 * Keeps UI labels / dedupe stable across local write + ledger sync.
 */

export const CASH_ADVANCE_HISTORY_LABEL = 'Выдача наличных'
export const LEDGER_DEBT_PREFIX = 'ldg-'

const MATCH_MS = 15 * 60 * 1000

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

export function isCashAdvanceLedgerSource(source) {
  return String(source || '').toLowerCase() === 'cash_advance'
}

/** Map server debtLedger.source → local DebtHistory source. */
export function mapDebtLedgerSource(source) {
  const s = String(source || '').toLowerCase()
  if (s === 'pos') return 'pos'
  if (s === 'order' || s === 'store') return 'order'
  if (s === 'cashier' || s === 'cash_advance') return 'cashier'
  if (s === 'backfill') return 'pos'
  if (s === 'manual' || s === 'admin') return 'manual'
  return 'cashier'
}

export function cashAdvanceHistoryDesc(_desc) {
  return CASH_ADVANCE_HISTORY_LABEL
}

export function ledgerDebtHistoryId(ledgerId) {
  const id = String(ledgerId || '').trim()
  if (!id) return ''
  if (id.startsWith(LEDGER_DEBT_PREFIX)) return id
  return `${LEDGER_DEBT_PREFIX}${id}`
}

/**
 * Find local history row that already represents this cash_advance ledger entry.
 */
export function findMatchingCashAdvanceLocal(local, entry, nowTs = Date.now()) {
  const list = Array.isArray(local) ? local : []
  const ledgerId = String(entry?.id || '').trim()
  const stableId = ledgerDebtHistoryId(ledgerId)
  const amt = round2(Math.abs(Number(entry?.amount) || 0))
  const ts = Date.parse(String(entry?.createdAtIso || '')) || 0
  const clientRef = String(entry?.clientRef || entry?.meta?.clientRef || '').trim()

  if (stableId) {
    const byId = list.find(r => r && r.type === 'debt' && (r.id === stableId || r.id === ledgerId))
    if (byId) return byId
  }
  if (clientRef) {
    const byRef = list.find(r =>
      r && r.type === 'debt'
      && String(r.clientRef || '').trim() === clientRef
      && Math.abs(Math.abs(Number(r.amount) || 0) - amt) < 0.02,
    )
    if (byRef) return byRef
  }
  if (!(amt > 0)) return undefined
  return list.find(r => {
    if (!r || r.type !== 'debt') return false
    if (r.source === 'pos' || r.source === 'order') return false
    if (String(r.orderId || '').trim()) return false
    if (Math.abs(Math.abs(Number(r.amount) || 0) - amt) >= 0.02) return false
    const rowTs = Number(r.ts) || 0
    if (ts > 0 && rowTs > 0 && Math.abs(rowTs - ts) < MATCH_MS) return true
    if (ts <= 0 && rowTs > 0 && Math.abs(rowTs - nowTs) < MATCH_MS) return true
    return false
  })
}

/**
 * Upsert a local cash-advance history row (idempotent by clientRef / amount+time / ledger id).
 * @returns {{ next: object[], changed: boolean, duplicated: boolean }}
 */
export function upsertLocalCashAdvanceHistory(local, opts = {}) {
  const prev = Array.isArray(local) ? local.map(r => ({ ...r })) : []
  const amount = round2(Math.abs(Number(opts.amount) || 0))
  if (!(amount > 0)) return { next: prev, changed: false, duplicated: false }

  const clientRef = String(opts.clientRef || '').trim() || undefined
  const ledgerEntryId = String(opts.ledgerEntryId || '').trim() || undefined
  const stableId = ledgerDebtHistoryId(ledgerEntryId)
  const ts = Number(opts.ts) || Date.now()
  const when = opts.when || null
  const entry = {
    id: ledgerEntryId || undefined,
    amount,
    createdAtIso: opts.createdAtIso || new Date(ts).toISOString(),
    clientRef,
  }
  const matched = findMatchingCashAdvanceLocal(prev, entry, ts)
  if (matched) {
    const idx = prev.findIndex(r => r.id === matched.id)
    if (idx < 0) return { next: prev, changed: false, duplicated: true }
    const cur = prev[idx]
    const nextId = stableId || cur.id
    const nextRow = {
      ...cur,
      id: nextId,
      orderId: ledgerEntryId || cur.orderId || undefined,
      desc: CASH_ADVANCE_HISTORY_LABEL,
      source: 'cashier',
      clientRef: cur.clientRef || clientRef,
      amount: -amount,
      type: 'debt',
    }
    const same =
      cur.id === nextRow.id
      && cur.desc === nextRow.desc
      && cur.source === nextRow.source
      && String(cur.orderId || '') === String(nextRow.orderId || '')
      && String(cur.clientRef || '') === String(nextRow.clientRef || '')
      && Math.abs(Math.abs(Number(cur.amount) || 0) - amount) < 0.02
    if (same) return { next: prev, changed: false, duplicated: true }
    prev[idx] = nextRow
    return { next: prev, changed: true, duplicated: true }
  }

  const date = when?.date || new Date(ts).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
  const time = when?.time || new Date(ts).toLocaleTimeString('ru-RU', {
    hour: '2-digit', minute: '2-digit',
  })
  prev.unshift({
    id: stableId || opts.id || `cashadv-${ts}-${Math.random().toString(36).slice(2, 8)}`,
    orderId: ledgerEntryId || undefined,
    date,
    time,
    ts,
    desc: CASH_ADVANCE_HISTORY_LABEL,
    amount: -amount,
    type: 'debt',
    source: 'cashier',
    clientRef,
  })
  return { next: prev, changed: true, duplicated: false }
}

/**
 * Apply one debtLedger cash_advance entry into local history (no duplicates).
 */
export function mergeCashAdvanceLedgerEntry(local, entry) {
  if (!isCashAdvanceLedgerSource(entry?.source)) {
    return { next: Array.isArray(local) ? local : [], changed: false }
  }
  const amt = round2(Math.abs(Number(entry.amount) || 0))
  if (!(amt > 0.001)) return { next: Array.isArray(local) ? local : [], changed: false }
  const ts = Date.parse(String(entry.createdAtIso || '')) || Date.now()
  return upsertLocalCashAdvanceHistory(local, {
    amount: amt,
    ts,
    createdAtIso: entry.createdAtIso,
    ledgerEntryId: entry.id,
    clientRef: entry.clientRef || entry.meta?.clientRef,
    when: null,
  })
}

/**
 * Fallback: ensure open client.debtLedger cash_advance rows appear in history.
 * Dedupes by ldg-id / amount+time / clientRef.
 */
export function mergeOpenCashAdvancesFromClientLedger(history, debtLedger) {
  let next = Array.isArray(history) ? history.map(r => ({ ...r })) : []
  let changed = false
  const list = Array.isArray(debtLedger) ? debtLedger : []
  for (const e of list) {
    if (!isCashAdvanceLedgerSource(e?.source)) continue
    const rem = Number(e.remaining)
    const amt = rem > 0.001 ? rem : Math.abs(Number(e.amount) || 0)
    if (!(amt > 0.001)) continue
    const out = upsertLocalCashAdvanceHistory(next, {
      amount: amt,
      ts: Date.parse(String(e.createdAtIso || '')) || Date.now(),
      createdAtIso: e.createdAtIso,
      ledgerEntryId: e.id,
      clientRef: e.clientRef,
    })
    next = out.next
    if (out.changed) changed = true
  }
  return { next, changed }
}

/** Count history debt rows that are cash advances (cashier, no orderId). */
export function countCashAdvanceHistoryRows(history) {
  const list = Array.isArray(history) ? history : []
  return list.filter(r =>
    r
    && r.type === 'debt'
    && r.source === 'cashier'
    && String(r.desc || '').includes(CASH_ADVANCE_HISTORY_LABEL),
  ).length
}
