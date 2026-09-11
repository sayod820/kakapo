/**
 * Active-shift selection + orphan off-shift reconciliation.
 * Projection-only: never deletes sales; never replays stock/finance/loyalty.
 */
import type { PosSale, PosShift } from './types'
import {
  pickActiveOpenShift as pickActiveOpenShiftCore,
  sameLogicalOpenSession as sameLogicalOpenSessionCore,
  planOrphanOffShiftAdopts as planOrphanOffShiftAdoptsCore,
  applyOrphanOffShiftAdoptsProjection as applyOrphanOffShiftAdoptsProjectionCore,
} from './shiftReconcileCore.mjs'

export type ShiftPickOpts = {
  cashierId?: string
  posId?: string
}

export type OrphanAdoptPlan = {
  localId: string
  serverId: string
  local: PosShift
  server: PosShift
}

export function pickActiveOpenShift(
  shifts: PosShift[],
  opts: ShiftPickOpts = {},
): PosShift | null {
  return pickActiveOpenShiftCore(shifts, opts) as PosShift | null
}

export function sameLogicalOpenSession(a: PosShift, b: PosShift): boolean {
  return sameLogicalOpenSessionCore(a, b)
}

export function planOrphanOffShiftAdopts(shifts: PosShift[]): OrphanAdoptPlan[] {
  return planOrphanOffShiftAdoptsCore(shifts) as OrphanAdoptPlan[]
}

export function applyOrphanOffShiftAdoptsProjection(
  shifts: PosShift[],
  sales: PosSale[],
  plans: OrphanAdoptPlan[],
  closedAtIso = new Date().toISOString(),
): { shifts: PosShift[]; sales: PosSale[]; remappedSaleIds: string[] } {
  return applyOrphanOffShiftAdoptsProjectionCore(shifts, sales, plans, closedAtIso) as {
    shifts: PosShift[]
    sales: PosSale[]
    remappedSaleIds: string[]
  }
}

/**
 * Apply adopt plans to pos store + id map + pending sale shiftIds.
 * Safe while online when server open shift already exists locally.
 */
export async function reconcileOrphanOpenOffShifts(opts?: {
  reason?: string
}): Promise<{ adopted: number; remappedSales: number }> {
  const { usePosStore } = await import('./posStore')
  const { rememberId, getPending, putPending, persistPosSnapshot } = await import('./offline')

  const state = usePosStore.getState()
  const plans = planOrphanOffShiftAdopts(state.shifts)
  if (!plans.length) return { adopted: 0, remappedSales: 0 }

  for (const p of plans) {
    await rememberId(p.localId, p.serverId)
  }

  const { shifts, sales, remappedSaleIds } = applyOrphanOffShiftAdoptsProjection(
    state.shifts,
    state.sales,
    plans,
  )

  try {
    const pending = await getPending()
    for (const row of pending) {
      if (row.kind !== 'sale' && row.kind !== 'shift_open') continue
      const payload = { ...(row.payload || {}) } as Record<string, unknown>
      let changed = false
      if (row.kind === 'sale') {
        const sid = String(payload.shiftId || '')
        const plan = plans.find(p => p.localId === sid)
        if (plan) {
          payload.shiftId = plan.serverId
          changed = true
        }
      }
      if (row.kind === 'shift_open' && row.localId) {
        const plan = plans.find(p => p.localId === String(row.localId))
        if (plan) {
          const { deletePending } = await import('./offline')
          await deletePending(row.clientRef)
          continue
        }
      }
      if (changed) {
        await putPending({ ...row, payload: payload as typeof row.payload })
      }
    }
  } catch { /* ignore queue remap errors */ }

  usePosStore.setState(s => ({
    shifts,
    sales,
    cashVault: s.cashVault
      ? {
        ...s.cashVault,
        openingFloats: (s.cashVault.openingFloats || []).map(f => {
          const plan = plans.find(p => p.localId === String(f.shiftId))
          return plan ? { ...f, shiftId: plan.serverId } : f
        }),
      }
      : s.cashVault,
  }))

  void persistPosSnapshot()
  if (opts?.reason) {
    try {
      console.info('[shiftReconcile]', opts.reason, {
        adopted: plans.length,
        remappedSales: remappedSaleIds.length,
        pairs: plans.map(p => `${p.localId}→${p.serverId}`),
      })
    } catch { /* ignore */ }
  }
  return { adopted: plans.length, remappedSales: remappedSaleIds.length }
}
