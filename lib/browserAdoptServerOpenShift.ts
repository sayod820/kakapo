/**
 * Browser online: adopt server-authoritative OPEN POS shifts into local store.
 * Desktop/Android local-first paths are unchanged (no-op).
 */
import { USE_API } from './config'
import { api } from './api'
import { isOnline } from './offline'
import { isTradeLocalFirst } from './offlineV2'
import { usePosStore } from './posStore'
import {
  mergeServerShiftsAuthoritative,
  needsServerOpenShiftAdopt,
} from './browserAdoptServerOpenShiftCore.mjs'
import type { PosShift } from './types'

export {
  mergeServerShiftsAuthoritative,
  needsServerOpenShiftAdopt,
}

let inFlight: Promise<{
  ok: boolean
  adopted: boolean
  openShifts: PosShift[]
  error?: string
}> | null = null

export function isBrowserOnlineShiftAdoptEnabled(): boolean {
  if (!USE_API) return false
  if (typeof window === 'undefined') return false
  // Desktop / Android keep local-first soft sync; browser must trust GET /pos/shifts
  if (isTradeLocalFirst()) return false
  return true
}

/**
 * GET /pos/shifts and merge into Zustand so pickActiveOpenShift sees server open.
 */
export async function adoptServerOpenShiftsBrowser(opts?: {
  posId?: string
  reason?: string
}): Promise<{
  ok: boolean
  adopted: boolean
  openShifts: PosShift[]
  error?: string
}> {
  if (!isBrowserOnlineShiftAdoptEnabled()) {
    return { ok: true, adopted: false, openShifts: [] }
  }
  if (!isOnline()) {
    return { ok: false, adopted: false, openShifts: [], error: 'offline' }
  }
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const serverShifts = (await api.getPosShifts()) as PosShift[]
      const local = usePosStore.getState().shifts || []
      const posId = String(opts?.posId || '').trim()
      const need = needsServerOpenShiftAdopt(local, serverShifts, posId)
      const merged = mergeServerShiftsAuthoritative(local, serverShifts) as PosShift[]
      const openShifts = merged.filter(s =>
        String(s.status) === 'open'
        && !String(s.id).startsWith('off-')
        && (!posId || String(s.posId || '') === posId))

      const changed = merged.length !== local.length
        || merged.some((s, i) => {
          const prev = local.find(x => String(x.id) === String(s.id))
          return !prev || String(prev.status) !== String(s.status)
        })

      if (changed || need) {
        usePosStore.setState({ shifts: merged })
      }

      return {
        ok: true,
        adopted: need || openShifts.length > 0,
        openShifts,
      }
    } catch (e) {
      return {
        ok: false,
        adopted: false,
        openShifts: [],
        error: e instanceof Error ? e.message : String(e),
      }
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

/** Find open server shift for POS from current store (after adopt). */
export function findAdoptedOpenShiftForPos(posId?: string): PosShift | null {
  const pos = String(posId || '').trim()
  const opens = (usePosStore.getState().shifts || []).filter(s =>
    String(s.status) === 'open' && !String(s.id).startsWith('off-'))
  if (!opens.length) return null
  if (pos) {
    const at = opens.find(s => String(s.posId || '') === pos)
    if (at) return at
  }
  return opens[0] || null
}
