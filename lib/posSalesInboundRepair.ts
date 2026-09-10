/**
 * Server → Desktop POS sales inbound repair.
 *
 * Symptom: shift.salesCash / salesCount updated from softSync, but sales[]
 * missing → «История чеков / Эта смена» empty while reports still show money.
 *
 * Cause: pos-lite cursor can advance on shifts/CRM while older sale stamps
 * were never delivered; later deltas never re-send those sales.
 *
 * Repair is projection-only: merge sales into Zustand + pos_snapshot.
 * No stock / finance / loyalty / outbox side effects.
 */
import { api } from './api'
import { mergeSalesInbound } from './syncConflict'
import type { PosSale, PosShift } from './types'

export type PosSalesInboundGap = {
  shiftId: string
  shiftSalesCount: number
  localSalesCount: number
  missing: number
  posId?: string
  status?: string
}

export type PosSalesInboundTrace = {
  server_posSales_returned: number
  sync_changes_posSales_received: number
  posSales_after_filter: number
  posSales_after_merge: number
  posSales_written_sqlite: boolean
  zustand_sales_count: number
  gaps_before: PosSalesInboundGap[]
  gaps_after: PosSalesInboundGap[]
  repaired: boolean
  reason: string
}

/** Count non-fully-returned sales for a shift (matches shift.salesCount intent). */
export function countLocalSalesForShift(
  sales: PosSale[] | undefined,
  shiftId: string,
): number {
  const sid = String(shiftId || '').trim()
  if (!sid) return 0
  let n = 0
  for (const s of sales || []) {
    if (String(s?.shiftId || '').trim() !== sid) continue
    if (String(s?.status || '') === 'returned') continue
    n += 1
  }
  return n
}

/**
 * Gap when server shift counters exceed local receipt projection.
 * Open shifts always checked; closed shifts only if closed today (local day).
 */
export function detectPosSalesInboundGaps(
  shifts: PosShift[] | undefined,
  sales: PosSale[] | undefined,
  nowMs = Date.now(),
): PosSalesInboundGap[] {
  const dayStart = new Date(nowMs)
  dayStart.setHours(0, 0, 0, 0)
  const dayStartMs = dayStart.getTime()
  const gaps: PosSalesInboundGap[] = []

  for (const sh of shifts || []) {
    const shiftId = String(sh?.id || '').trim()
    if (!shiftId) continue
    if (String(shiftId).startsWith('off-')) continue

    const status = String(sh?.status || '')
    if (status === 'closed') {
      const closed = Date.parse(String(sh.closedAtIso || ''))
      if (!Number.isFinite(closed) || closed < dayStartMs) continue
    } else if (status && status !== 'open') {
      continue
    }

    const shiftSalesCount = Math.max(0, Math.floor(Number(sh.salesCount) || 0))
    if (shiftSalesCount <= 0) continue
    const localSalesCount = countLocalSalesForShift(sales, shiftId)
    const missing = shiftSalesCount - localSalesCount
    if (missing <= 0) continue
    gaps.push({
      shiftId,
      shiftSalesCount,
      localSalesCount,
      missing,
      posId: sh.posId ? String(sh.posId) : undefined,
      status: status || 'open',
    })
  }
  return gaps
}

/** Filter remote sales to gap shifts + same POS (when known). Keep off-path remotes for those shifts. */
export function filterSalesForGapRepair(
  remoteSales: PosSale[],
  gaps: PosSalesInboundGap[],
): PosSale[] {
  if (!gaps.length) return []
  const shiftIds = new Set(gaps.map(g => g.shiftId))
  const posIds = new Set(gaps.map(g => g.posId).filter(Boolean) as string[])
  return (remoteSales || []).filter(s => {
    const sid = String(s?.shiftId || '').trim()
    if (sid && shiftIds.has(sid)) return true
    // Sales without shiftId but same POS — include for period repair (legacy)
    if (!sid && posIds.size && s?.posId && posIds.has(String(s.posId))) return true
    return false
  })
}

let repairInFlight: Promise<PosSalesInboundTrace | null> | null = null
let lastRepairAt = 0
const REPAIR_MIN_GAP_MS = 12_000

export type RepairPosSalesInboundOpts = {
  reason?: string
  force?: boolean
  /** When provided, skip re-detect (already known). */
  gaps?: PosSalesInboundGap[]
}

/**
 * Bounded backfill: pos-lite full window (14d) → merge delta → persist snapshot.
 * Idempotent; does not enqueue outbox or mutate stock/loyalty.
 */
export async function repairPosSalesInboundFromServer(
  opts: RepairPosSalesInboundOpts = {},
): Promise<PosSalesInboundTrace | null> {
  if (typeof window === 'undefined') return null
  if (repairInFlight) return repairInFlight

  const reason = String(opts.reason || 'repair')
  const force = !!opts.force
  const now = Date.now()
  if (!force && now - lastRepairAt < REPAIR_MIN_GAP_MS) return null

  repairInFlight = (async () => {
    const { usePosStore } = await import('./posStore')
    const before = usePosStore.getState()
    const gaps = opts.gaps?.length
      ? opts.gaps
      : detectPosSalesInboundGaps(before.shifts, before.sales)
    const trace: PosSalesInboundTrace = {
      server_posSales_returned: 0,
      sync_changes_posSales_received: 0,
      posSales_after_filter: 0,
      posSales_after_merge: 0,
      posSales_written_sqlite: false,
      zustand_sales_count: before.sales?.length || 0,
      gaps_before: gaps,
      gaps_after: [],
      repaired: false,
      reason,
    }
    if (!gaps.length) {
      trace.gaps_after = []
      return trace
    }

    try {
      // Full pos-lite (since='') → ~14 days of sales; does not require cursor rewind
      const delta = await api.getSyncChanges(undefined, { scope: 'pos-lite' })
      const remoteSales = (delta.pos?.sales || []) as PosSale[]
      trace.sync_changes_posSales_received = remoteSales.length
      trace.server_posSales_returned = remoteSales.length

      const filtered = filterSalesForGapRepair(remoteSales, gaps)
      trace.posSales_after_filter = filtered.length

      // Also accept all remote sales in window if filter empty but gaps exist
      // (shiftId mismatch on server rows) — merge whole lite window once.
      const toMerge = filtered.length ? filtered : remoteSales
      if (!toMerge.length) {
        trace.gaps_after = detectPosSalesInboundGaps(before.shifts, before.sales)
        return trace
      }

      const localNow = usePosStore.getState().sales
      const merged = mergeSalesInbound(localNow, toMerge as any, { mode: 'delta' }) as PosSale[]
      trace.posSales_after_merge = merged.length

      usePosStore.setState({ sales: merged })
      trace.zustand_sales_count = merged.length

      try {
        const { persistPosSnapshot } = await import('./offline')
        await persistPosSnapshot({ force: true })
        trace.posSales_written_sqlite = true
      } catch { /* snapshot best-effort */ }

      // Advance lite cursor to payload cursor so we don't thrash; sales already merged
      const nextCursor = String(delta.cursor || '')
      if (nextCursor) {
        try {
          const { setPosLiteSyncCursor } = await import('./localEntities')
          await setPosLiteSyncCursor(nextCursor)
        } catch { /* ignore */ }
      }

      const after = usePosStore.getState()
      trace.gaps_after = detectPosSalesInboundGaps(after.shifts, after.sales)
      trace.repaired = trace.gaps_after.length < gaps.length
        || merged.length > localNow.length

      try {
        const { perfNote } = await import('./devTelemetry')
        perfNote('soft_sync', 0, 'pos_sales_inbound_repair', {
          reason,
          gapsBefore: gaps.length,
          gapsAfter: trace.gaps_after.length,
          received: remoteSales.length,
          merged: toMerge.length,
          salesAfter: merged.length,
        })
      } catch { /* ignore */ }

      lastRepairAt = Date.now()
      return trace
    } catch {
      trace.gaps_after = detectPosSalesInboundGaps(
        usePosStore.getState().shifts,
        usePosStore.getState().sales,
      )
      return trace
    } finally {
      repairInFlight = null
    }
  })()

  return repairInFlight
}

/**
 * After soft/full inbound merge: if shift counters imply missing receipts, repair.
 */
export async function maybeRepairPosSalesInboundAfterMerge(opts?: {
  reason?: string
  force?: boolean
}): Promise<PosSalesInboundTrace | null> {
  const { usePosStore } = await import('./posStore')
  const st = usePosStore.getState()
  const gaps = detectPosSalesInboundGaps(st.shifts, st.sales)
  if (!gaps.length) return null
  return repairPosSalesInboundFromServer({
    reason: opts?.reason || 'gap_after_merge',
    force: opts?.force,
    gaps,
  })
}
