/**
 * Phase 5 — Desktop atomic local sale commit.
 * SQLite transaction: outbox + stock layers + sale/shift mirrors.
 * Memory/Zustand applied ONLY after COMMIT.
 */
import { getKakapoDesktop, isKakapoDesktop } from './desktopBridge'
import { isPerfEnabled, perfNote } from './devTelemetry'
import type { PendingOp } from './offline'
import type { PosSale, PosShift, ProductStockLayer } from './types'

export type LocalSaleCommitInput = {
  queueRow: PendingOp
  stockLayers: ProductStockLayer[]
  sale: PosSale & { orderId?: string; _offline?: boolean }
  shift?: PosShift | null
  queueSeq?: number
  /** Dev failure injection — passed to native */
  failAt?: string
}

export type LocalSaleCommitResult =
  | { ok: true; clientRef: string; saleId: string; ms: number }
  | { ok: false; error: string; code?: string; rolledBack?: boolean; ms: number }

/** True when Desktop exposes real SQLite sale transaction IPC. */
export function canAtomicLocalSaleCommit(): boolean {
  if (!isKakapoDesktop()) return false
  const desk = getKakapoDesktop()
  return typeof desk?.localDbSaleCommit === 'function'
}

/**
 * Durable atomic commit. Does NOT touch Zustand / network / print.
 * On failure SQLite rolls back — caller must not apply memory side effects.
 */
export async function commitLocalSaleAtomic(input: LocalSaleCommitInput): Promise<LocalSaleCommitResult> {
  const t0 = performance.now()
  const desk = getKakapoDesktop()
  if (!desk?.localDbSaleCommit) {
    return {
      ok: false,
      error: 'sale_commit_unavailable',
      code: 'UNAVAILABLE',
      ms: performance.now() - t0,
    }
  }
  try {
    const res = await desk.localDbSaleCommit({
      queueRow: input.queueRow,
      stockLayers: input.stockLayers,
      sale: input.sale,
      shift: input.shift || undefined,
      queueSeq: input.queueSeq,
      failAt: input.failAt,
    })
    const ms = performance.now() - t0
    if (isPerfEnabled()) {
      perfNote('local_transaction_ms', ms, res.ok ? 'ok' : 'fail')
      perfNote('sale_local_ms', ms, res.ok ? 'local_transaction_ok' : 'local_transaction_fail')
    }
    if (!res?.ok) {
      return {
        ok: false,
        error: String(res?.error || 'sale_commit_failed'),
        code: res?.code,
        rolledBack: !!res?.rolledBack,
        ms,
      }
    }
    return {
      ok: true,
      clientRef: String(res.clientRef || input.queueRow.clientRef),
      saleId: String(res.saleId || input.sale.id || ''),
      ms,
    }
  } catch (e) {
    const ms = performance.now() - t0
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      rolledBack: true,
      ms,
    }
  }
}

/** Dev: inject crash point inside native sale transaction. */
export async function setLocalSaleCommitFailAt(stage: string): Promise<void> {
  const desk = getKakapoDesktop()
  if (!desk?.localDbSaleCommitSetFailAt) return
  await desk.localDbSaleCommitSetFailAt(stage)
}

/**
 * CASE D / restart: sale already in SQLite (mirror+queue) but Zustand/UI missed success.
 * Restore sale+shift into memory WITHOUT re-applying stock.
 */
export async function restoreCommittedSaleUi(opts: {
  clientRef?: string
  localId?: string
  pending?: PendingOp | null
}): Promise<(PosSale & { orderId?: string; _offline?: boolean }) | null> {
  if (!isKakapoDesktop()) return null
  const desk = getKakapoDesktop()
  const clientRef = String(opts.clientRef || opts.pending?.clientRef || '').trim()
  const localId = String(opts.localId || opts.pending?.localId || '').trim()

  let sale: (PosSale & { orderId?: string; _offline?: boolean }) | null = null
  if (desk?.localDbMirrorGet) {
    if (localId) {
      const m = await desk.localDbMirrorGet('sale', localId)
      if (m && typeof m === 'object') sale = m as PosSale & { orderId?: string; _offline?: boolean }
    }
    if (!sale && clientRef) {
      const m = await desk.localDbMirrorGet('sale', clientRef)
      if (m && typeof m === 'object') sale = m as PosSale & { orderId?: string; _offline?: boolean }
    }
  }
  if (!sale && opts.pending) {
    const p = (opts.pending.payload || {}) as Record<string, unknown>
    const { _revert: _omit, ...fields } = p
    sale = {
      ...(fields as unknown as PosSale),
      id: String(opts.pending.localId || localId || clientRef),
      total: Number(p.total) || Number((p as any).paidCash) || 0,
      _offline: true,
    }
  }
  if (!sale) return null

  const { usePosStore } = await import('./posStore')
  usePosStore.setState(st => {
    const id = String(sale!.id)
    const cref = String((sale as any).clientRef || clientRef || '')
    const already = st.sales.some(s =>
      s.id === id || (cref && String((s as any).clientRef || '') === cref),
    )
    const sales = already ? st.sales : [sale!, ...st.sales]
    return { sales }
  })

  // Prefer durable shift mirror over stale snapshot totals
  const shiftId = String((sale as any).shiftId || '').trim()
  if (shiftId && desk?.localDbMirrorGet) {
    const sh = await desk.localDbMirrorGet('shift', shiftId)
    if (sh && typeof sh === 'object' && (sh as any).id) {
      usePosStore.setState(st => ({
        shifts: st.shifts.map(x => (x.id === shiftId ? { ...x, ...(sh as PosShift) } : x)),
      }))
    }
  }

  return { ...sale, _offline: true }
}

/**
 * After pos_snapshot hydrate: merge sale/shift mirrors so crash-after-COMMIT is consistent.
 * Snapshot remains secondary cache (Phase 8).
 */
export async function reconcileLocalSalesFromDurables(): Promise<{ salesMerged: number; shiftsMerged: number }> {
  if (!canAtomicLocalSaleCommit()) return { salesMerged: 0, shiftsMerged: 0 }
  const desk = getKakapoDesktop()
  if (!desk?.localDbMirrorList) return { salesMerged: 0, shiftsMerged: 0 }

  const { usePosStore } = await import('./posStore')
  let salesMerged = 0
  let shiftsMerged = 0

  try {
    const saleRows = await desk.localDbMirrorList('sale', 300)
    const shiftRows = await desk.localDbMirrorList('shift', 80)
    usePosStore.setState(st => {
      let sales = st.sales.slice()
      let shifts = st.shifts.slice()
      for (const row of saleRows || []) {
        const data = row?.data
        if (!data || typeof data !== 'object') continue
        const s = data as PosSale
        const id = String(s.id || row.id || '')
        const cref = String((s as any).clientRef || '')
        if (!id && !cref) continue
        const idx = sales.findIndex(x =>
          x.id === id || (cref && String((x as any).clientRef || '') === cref),
        )
        if (idx < 0) {
          sales = [{ ...s, _offline: true } as PosSale, ...sales]
          salesMerged += 1
        }
      }
      for (const row of shiftRows || []) {
        const data = row?.data
        if (!data || typeof data !== 'object') continue
        const sh = data as PosShift
        const id = String(sh.id || row.id || '')
        if (!id) continue
        const idx = shifts.findIndex(x => x.id === id)
        if (idx < 0) {
          shifts = [sh, ...shifts]
          shiftsMerged += 1
        } else {
          // Mirror is post-COMMIT truth for counters when snapshot lagged
          const cur = shifts[idx]
          const mirrorCount = Number(sh.salesCount) || 0
          const curCount = Number(cur.salesCount) || 0
          if (mirrorCount >= curCount) {
            shifts[idx] = { ...cur, ...sh }
            shiftsMerged += 1
          }
        }
      }
      return { sales, shifts }
    })
  } catch { /* ignore */ }

  // Pending sales without mirror (legacy) — still show in UI from outbox payload
  try {
    const { getPending } = await import('./offline')
    const pending = (await getPending()).filter(r => r.kind === 'sale')
    for (const row of pending) {
      const cref = String(row.clientRef || '')
      const st = usePosStore.getState()
      const exists = st.sales.some(s =>
        s.id === row.localId
        || (cref && String((s as any).clientRef || '') === cref),
      )
      if (exists) continue
      await restoreCommittedSaleUi({ pending: row, clientRef: cref, localId: row.localId })
      salesMerged += 1
    }
  } catch { /* ignore */ }

  return { salesMerged, shiftsMerged }
}
