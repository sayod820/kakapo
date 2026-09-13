/**
 * Hydrate durable cash debtRepayCash ledger from authoritative server moneyLedger.
 * Reconstructs already-ACKed cash repayments for the *active* open shift only.
 * Non-blocking, coalesced (per shiftId), fail-soft — never zeros local ledger on error.
 *
 * Never applies closed-shift repayments onto a newly opened shift.
 */
import {
  applyCashDebtRepayJournalRows,
  filterCashDebtRepayJournalForShift,
  isCashDebtRepayJournalRow,
  journalDebtRepayDedupeKey,
  journalRowToLedgerEntry,
  resolveJournalHydrateShift,
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
  resolveJournalHydrateShift,
}

type OpenShiftLike = {
  id?: string
  status?: string
  openedAtIso?: string | null
  createdAtIso?: string | null
  debtRepayCash?: number
  cashierId?: string
  posId?: string
}

let inFlight: Promise<JournalHydrateResult> | null = null
let inFlightShiftId = ''
let lastOkAt = 0
let lastShiftId = ''
/** Coalesce window — per active shiftId only. */
const COALESCE_MS = 45_000

/**
 * Resolve the shift to hydrate: explicit open preferId, else shared pickActiveOpenShift.
 * Never falls back to "first open in array" (orphan/old open bug).
 */
function resolveActiveShiftForHydrate(
  shifts: OpenShiftLike[] | null | undefined,
  opts?: { preferId?: string; cashierId?: string; posId?: string },
): OpenShiftLike | null {
  return resolveJournalHydrateShift(shifts, opts) as OpenShiftLike | null
}

function fromIsoForShift(shift: OpenShiftLike): string {
  const opened = String(shift.openedAtIso || '').trim()
  if (opened) return opened
  const created = String(shift.createdAtIso || '').trim()
  if (created) return created
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

/**
 * Patch *open* shift.debtRepayCash from ledger so Cashier useMemo refreshes.
 * Never writes debtRepayCash onto closed shifts.
 */
function bumpOpenShiftDebtRepayCash(shiftId: string) {
  const sid = String(shiftId || '').trim()
  if (!sid) return
  try {
    void import('./posStore').then(({ usePosStore }) => {
      const total = uniqueCashDebtRepayTotalForShift(sid)
      const shifts = usePosStore.getState().shifts || []
      let changed = false
      const next = shifts.map((s: OpenShiftLike) => {
        if (String(s?.id || '') !== sid) return s
        if (String(s?.status || '') !== 'open') return s
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

async function resolveHydrateContext(preferId?: string): Promise<{
  shift: OpenShiftLike | null
  reason?: string
}> {
  try {
    const { usePosStore } = await import('./posStore')
    const shifts = usePosStore.getState().shifts || []
    let posId = ''
    try {
      const { getBoundPosIdSync } = await import('./tradeDevice')
      posId = String(getBoundPosIdSync() || '').trim()
    } catch { /* ignore */ }
    // Prefer cashierId from the currently newest open shift at this POS (Cashier settings are LS-only).
    let cashierId = ''
    const openAtPos = shifts.filter(s =>
      String(s?.status || '') === 'open'
      && (!posId || String(s?.posId || '') === posId),
    )
    if (openAtPos.length) {
      const newest = [...openAtPos].sort((a, b) =>
        Date.parse(String(b.openedAtIso || '')) - Date.parse(String(a.openedAtIso || '')),
      )[0]
      cashierId = String(newest?.cashierId || '').trim()
    }
    const shift = resolveActiveShiftForHydrate(shifts, {
      preferId,
      cashierId: cashierId || undefined,
      posId: posId || undefined,
    })
    return { shift }
  } catch {
    return { shift: null, reason: 'no_store' }
  }
}

/**
 * Fetch journal and merge into durable ledger for the active open shift only.
 * Never clears local ledger on failure.
 * Never applies rows whose shiftId ≠ active open shift.
 */
export async function hydrateDebtRepayCashFromJournal(opts?: {
  force?: boolean
  shiftId?: string
  /** Inject rows for tests (skips network). */
  _testRows?: unknown[]
}): Promise<JournalHydrateResult> {
  const preferId = String(opts?.shiftId || '').trim() || undefined
  const force = !!opts?.force
  const testRows = opts?._testRows

  // In-flight reuse only for the same target shift (shift-aware).
  if (inFlight && !force && !testRows) {
    if (!preferId || preferId === inFlightShiftId) return inFlight
    try { await inFlight } catch { /* ignore */ }
  }

  try {
    await hydrateDebtRepayCashLedger()
  } catch { /* ignore */ }

  const ctx = await resolveHydrateContext(preferId)
  if (ctx.reason === 'no_store') return { ok: false, reason: 'no_store' }
  const shift = ctx.shift
  if (!shift?.id || String(shift.status || '') !== 'open') {
    return { ok: false, reason: 'no_open_shift' }
  }
  const shiftId = String(shift.id)

  // Another call may have started for this shift while we resolved context.
  if (inFlight && !force && !testRows && inFlightShiftId === shiftId) {
    return inFlight
  }

  const now = Date.now()
  if (
    !force
    && !testRows
    && lastShiftId === shiftId
    && lastOkAt
    && now - lastOkAt < COALESCE_MS
  ) {
    return { ok: true, applied: 0, reason: 'coalesced', shiftId }
  }

  const run = (async (): Promise<JournalHydrateResult> => {
    let rows: unknown[] = []
    if (testRows) {
      rows = testRows
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

    // Exact shiftId match only — closed previous shift rows never land on new open shift.
    const applied = applyCashDebtRepayJournalRows(rows, shiftId, rememberCashDebtRepay)
    bumpOpenShiftDebtRepayCash(shiftId)
    lastOkAt = Date.now()
    lastShiftId = shiftId
    return { ok: true, applied, shiftId }
  })()

  if (!testRows) {
    inFlightShiftId = shiftId
    inFlight = run.finally(() => {
      if (inFlight === run) {
        inFlight = null
        inFlightShiftId = ''
      }
    })
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
  inFlightShiftId = ''
  lastOkAt = 0
  lastShiftId = ''
}
