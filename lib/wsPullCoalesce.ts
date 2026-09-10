/**
 * Phase 7 — WS pull coalescing (dirty scopes + in-flight dedupe).
 * Coordinates existing softSync/pull calls; does not rewrite sync engines.
 */
import { isPerfEnabled, perfCount } from './devTelemetry'

export type WsPullScope =
  | 'crmSoft' // softSyncPosAfterSale (CRM + sales lite share one runner)
  | 'pos'
  | 'posWarehouse'
  | 'posFinance'
  | 'products'

const COALESCE_MS = 600

type Runner = {
  dirty: boolean
  inFlight: boolean
  timer: ReturnType<typeof setTimeout> | null
  run: () => void | Promise<void>
}

export type WsPullCoalescer = {
  mark: (scope: WsPullScope) => void
  /** @deprecated alias — same runner as crmSoft */
  crm: () => void
  posSoft: () => void
  pos: () => void
  posWarehouse: () => void
  posFinance: () => void
  products: () => void
  flushAll: () => void
  /** test/diagnostics */
  debugState: () => {
    dirty: Partial<Record<WsPullScope, boolean>>
    inFlight: Partial<Record<WsPullScope, boolean>>
    pendingTimers: number
  }
}

let eventCount = 0
let syncRunCount = 0
let coalescedCount = 0

export function wsPullTelemetrySnapshot() {
  return { ws_event_count: eventCount, ws_sync_run_count: syncRunCount, ws_coalesced_count: coalescedCount }
}

export function resetWsPullTelemetry() {
  eventCount = 0
  syncRunCount = 0
  coalescedCount = 0
}

export function createWsPullCoalescer(handlers: {
  crmSoft: () => void | Promise<void>
  pos: () => void | Promise<void>
  posWarehouse: () => void | Promise<void>
  posFinance: () => void | Promise<void>
  products: () => void | Promise<void>
}): WsPullCoalescer {
  const runners: Record<WsPullScope, Runner> = {
    crmSoft: { dirty: false, inFlight: false, timer: null, run: handlers.crmSoft },
    pos: { dirty: false, inFlight: false, timer: null, run: handlers.pos },
    posWarehouse: { dirty: false, inFlight: false, timer: null, run: handlers.posWarehouse },
    posFinance: { dirty: false, inFlight: false, timer: null, run: handlers.posFinance },
    products: { dirty: false, inFlight: false, timer: null, run: handlers.products },
  }

  async function drain(scope: WsPullScope) {
    const r = runners[scope]
    r.timer = null
    if (r.inFlight) {
      r.dirty = true
      return
    }
    while (r.dirty) {
      r.dirty = false
      r.inFlight = true
      syncRunCount += 1
      if (isPerfEnabled()) perfCount('ws_sync_run_count', 1, scope)
      try {
        await Promise.resolve(r.run())
      } catch (e) {
        console.error('[kakapo] ws pull failed', scope, e)
      } finally {
        r.inFlight = false
      }
      // If marked dirty during run → loop again (no lost events)
    }
  }

  function mark(scope: WsPullScope) {
    eventCount += 1
    if (isPerfEnabled()) perfCount('ws_event_count', 1, scope)
    const r = runners[scope]
    if (r.dirty || r.inFlight || r.timer) {
      coalescedCount += 1
      if (isPerfEnabled()) perfCount('ws_coalesced_count', 1, scope)
    }
    r.dirty = true
    if (r.inFlight) return
    if (r.timer) return // already scheduled; dirty stays true
    r.timer = setTimeout(() => { void drain(scope) }, COALESCE_MS)
  }

  function flushAll() {
    for (const scope of Object.keys(runners) as WsPullScope[]) {
      const r = runners[scope]
      if (r.timer) {
        clearTimeout(r.timer)
        r.timer = null
      }
      r.dirty = false
    }
  }

  return {
    mark,
    crm: () => mark('crmSoft'),
    posSoft: () => mark('crmSoft'),
    pos: () => mark('pos'),
    posWarehouse: () => mark('posWarehouse'),
    posFinance: () => mark('posFinance'),
    products: () => mark('products'),
    flushAll,
    debugState: () => {
      const dirty: Partial<Record<WsPullScope, boolean>> = {}
      const inFlight: Partial<Record<WsPullScope, boolean>> = {}
      let pendingTimers = 0
      for (const s of Object.keys(runners) as WsPullScope[]) {
        dirty[s] = runners[s].dirty
        inFlight[s] = runners[s].inFlight
        if (runners[s].timer) pendingTimers += 1
      }
      return { dirty, inFlight, pendingTimers }
    },
  }
}
