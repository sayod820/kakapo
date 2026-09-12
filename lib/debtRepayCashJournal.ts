/**
 * Hydrate durable cash debtRepayCash ledger from authoritative server moneyLedger.
 * Reconstructs already-ACKed cash repayments for the open shift (1.2.182).
 * Non-blocking, coalesced, fail-soft — never zeros local ledger on error.
 */
import {
  applyCashDebtRepayJournalRows,
  filterCashDebtRepayJournalForShift,
  isCashDebtRepayJournalRow,
  journalDebtRepayDedupeKey,
  journalRowToLedgerEntry,
} from './debtRepayCashJournalCore.mjs'
import {
  rememberCashDebtRepay,
  uniqueCashDebtRepayTotalForShift,
  hydrateDebtRepayCashLedger,
} from './debtRepayCashLedger'

export {
  applyCashDebtRepayJournalRows,
  filterCashDebtRepayJournalForShift,
  isCashDebtRepayJournalRow,
  journalDebtRepayDedupeKey,
  journalRowToLedgerEntry,
}

type OpenShiftLike = {
  id?: string
  status?: string
  openedAtIso?: string | null
  createdAtIso?: string | null
  debtRepayCash?: number
}

let inFlight: Promise<{ ok: boolean; applied?: number; reason?: string }> | null = null
let lastOkAt = 0
let lastShiftId = ''
/** Coalesce window — avoid hammering journal on every softSync tick. */
const COALESCE_MS = 45_000

function pickOpenShift(shifts: OpenShiftLike[] | null | undefined, preferId?: string): OpenShiftLike | null {
  const list = Array.isArray(shifts) ? shifts : []
  if (preferId) {
    const hit = list.find(s => String(s?.id || '') === String(preferId) && String(s?.status || '') === 'open')
    if (hit) return hit
  }
  return list.find(s => String(s?.status || '') === 'open') || null
}

function fromIsoForShift(shift: OpenShiftLike): string {
  const opened = String(shift.openedAtIso || '').trim()
  if (opened) return opened
  const created = String(shift.createdAtIso || '').trim()
  if (created) return created
  // Fallback: start of UTC day — still better than unbounded 10k journal
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

/**
 * Patch open shift.debtRepayCash from ledger so Cashier useMemo refreshes.
 * Does not touch salesCash / salesCount / salesCard.
 */
function bumpOpenShiftDebtRepayCash(shiftId: string) {
  const sid = String(shiftId || '').trim()
  if (!sid) return
  try {
    // Lazy import avoids circular deps with posStore
    void import('./posStore').then(({ usePosStore }) => {
      const total = uniqueCashDebtRepayTotalForShift(sid)
      const shifts = usePosStore.getState().shifts || []
      let changed = false
      const next = shifts.map((s: OpenShiftLike) => {
        if (String(s?.id || '') !== sid) return s
        const cur = Math.round((Number(s.debtRepayCash) || 0) * 100) / 100
        const want = Math.round(Math.max(cur, total) * 100) / 100
        if (want === cur) return s
        changed = true
        return { ...s, debtRepayCash: want }
      })
      if (changed) usePosStore.setState({ shifts: next as any })
    }).catch(() => {})
  } catch { /* ignore */ }
}

export type JournalHydrateResult = {
  ok: boolean
  applied?: number
  reason?: string
  shiftId?: string
}

/**
 * Fetch journal and merge into durable ledger. Safe to call often (coalesced).
 * Never clears local ledger on failure.
 */
export async function hydrateDebtRepayCashFromJournal(opts?: {
  force?: boolean
  shiftId?: string
  /** Inject rows for tests (skips network). */
  _testRows?: unknown[]
}): Promise<JournalHydrateResult> {
  if (inFlight && !opts?.force && !opts?._testRows) return inFlight

  const run = (async (): Promise<JournalHydrateResult> => {
    try {
      await hydrateDebtRepayCashLedger()
    } catch { /* ignore */ }

    let shift: OpenShiftLike | null = null
    try {
      const { usePosStore } = await import('./posStore')
      shift = pickOpenShift(usePosStore.getState().shifts, opts?.shiftId)
    } catch {
      return { ok: false, reason: 'no_store' }
    }
    if (!shift?.id || String(shift.status || '') !== 'open') {
      return { ok: false, reason: 'no_open_shift' }
    }
    const shiftId = String(shift.id)

    const now = Date.now()
    if (
      !opts?.force
      && !opts?._testRows
      && lastShiftId === shiftId
      && lastOkAt
      && now - lastOkAt < COALESCE_MS
    ) {
      return { ok: true, applied: 0, reason: 'coalesced', shiftId }
    }

    let rows: unknown[] = []
    if (opts?._testRows) {
      rows = opts._testRows
    } else {
      try {
        const { isOnline } = await import('./offline')
        if (!isOnline()) return { ok: false, reason: 'offline', shiftId }
      } catch { /* proceed; api will fail soft */ }

      try {
        const { api } = await import('./api')
        const from = fromIsoForShift(shift)
        const res = await api.getFinanceJournal({
          type: 'debt_repay_cash',
          from,
          limit: '1000',
        })
        rows = Array.isArray(res?.rows) ? res.rows : []
      } catch {
        return { ok: false, reason: 'fetch_failed', shiftId }
      }
    }

    const applied = applyCashDebtRepayJournalRows(rows, shiftId, rememberCashDebtRepay)
    bumpOpenShiftDebtRepayCash(shiftId)
    lastOkAt = Date.now()
    lastShiftId = shiftId
    return { ok: true, applied, shiftId }
  })()

  if (!opts?._testRows) {
    inFlight = run.finally(() => {
      if (inFlight === run) inFlight = null
    }) as Promise<JournalHydrateResult>
    return inFlight
  }
  return run
}

/** Fire-and-forget schedule (never blocks cashier). */
export function scheduleDebtRepayCashJournalHydrate(opts?: { force?: boolean; shiftId?: string }) {
  void hydrateDebtRepayCashFromJournal(opts).catch(() => {})
}

/** Test helper */
export function _resetDebtRepayCashJournalHydrateForTests() {
  inFlight = null
  lastOkAt = 0
  lastShiftId = ''
}
