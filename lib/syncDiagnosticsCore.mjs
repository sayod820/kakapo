/**
 * Bounded sync observability (L0). No payload dumps.
 * Shared by Desktop TS + node LAB tests.
 */

export const FULL_PULL_REASONS = Object.freeze({
  BOOTSTRAP: 'BOOTSTRAP',
  RECOVERY: 'RECOVERY',
  CURSOR_EXPIRED: 'CURSOR_EXPIRED',
  EMPTY_LOCAL_DB: 'EMPTY_LOCAL_DB',
  MANUAL_DIAGNOSTIC: 'MANUAL_DIAGNOSTIC',
  UNEXPECTED_RUNTIME_FULL_PULL: 'UNEXPECTED_RUNTIME_FULL_PULL',
})

const EVENT_RING_MAX = 50

function emptyState() {
  return {
    online: true,
    wsConnected: false,
    recoveryMode: false,
    outboxTotal: 0,
    outboxReady: 0,
    outboxFailed: 0,
    oldestOutboxAt: null,
    lastPushStartedAt: null,
    lastPushCompletedAt: null,
    lastPushError: null,
    lastPullStartedAt: null,
    lastPullCompletedAt: null,
    lastPullError: null,
    syncCursor: null,
    lastAppliedChangeAt: null,
    lastFullPullAt: null,
    fullPullCount: 0,
    clientFullPullCount: 0,
    cardFullPullCount: 0,
    productFullPullCount: 0,
    crmPartialMergeCount: 0,
    crmEntitiesPatched: 0,
    crmEntitiesPruned: 0,
    wsHintCount: 0,
    coalescedPullCount: 0,
    syncProtocol: 'v1',
    changeSeqCursor: null,
    serverHeadCursor: null,
    syncEnginePhase: null,
    needsBaseline: false,
    outboxIsolated: 0,
  }
}

let state = emptyState()
/** @type {Array<Record<string, unknown>>} */
const eventRing = []

function pushEvent(ev) {
  eventRing.push({ ...ev, at: ev.at || Date.now() })
  while (eventRing.length > EVENT_RING_MAX) eventRing.shift()
}

export function resetSyncDiagnostics() {
  state = emptyState()
  eventRing.length = 0
}

export function getSyncDiagnostics() {
  return {
    ...state,
    recentEvents: eventRing.slice(),
  }
}

export function patchSyncDiagnostics(partial) {
  if (!partial || typeof partial !== 'object') return getSyncDiagnostics()
  for (const [k, v] of Object.entries(partial)) {
    if (!(k in state)) continue
    if (k === 'recentEvents') continue
    state[k] = v
  }
  return getSyncDiagnostics()
}

export function noteSyncEvent(type, detail = {}) {
  const safe = {}
  for (const [k, v] of Object.entries(detail || {})) {
    if (v == null) continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      safe[k] = typeof v === 'string' && v.length > 120 ? `${v.slice(0, 117)}...` : v
    }
  }
  pushEvent({ type: String(type || 'event'), ...safe })
}

/**
 * @param {{
 *   kind: 'clients'|'cards'|'products'|'pos'|'sync_changes',
 *   reason: string,
 *   caller?: string,
 *   runtime?: 'desktop'|'browser'|'node'|'unknown',
 *   phase?: 'bootstrap'|'recovery'|'normal-runtime'|'diagnostic',
 * }} info
 */
export function recordFullPull(info) {
  const reason = String(info?.reason || FULL_PULL_REASONS.UNEXPECTED_RUNTIME_FULL_PULL)
  const kind = String(info?.kind || 'unknown')
  const now = Date.now()
  state.lastFullPullAt = now
  state.fullPullCount += 1
  if (kind === 'clients') state.clientFullPullCount += 1
  if (kind === 'cards') state.cardFullPullCount += 1
  if (kind === 'products') state.productFullPullCount += 1
  noteSyncEvent('full_pull', {
    kind,
    reason,
    caller: info?.caller || '',
    runtime: info?.runtime || 'unknown',
    phase: info?.phase || 'normal-runtime',
  })
}

export function recordCrmMerge(info) {
  const mode = String(info?.mode || '')
  const patched = Math.max(0, Number(info?.patched) || 0)
  const pruned = Math.max(0, Number(info?.pruned) || 0)
  const kept = Math.max(0, Number(info?.kept) || 0)
  if (mode === 'PARTIAL_DELTA_UPSERT') state.crmPartialMergeCount += 1
  state.crmEntitiesPatched += patched
  state.crmEntitiesPruned += pruned
  noteSyncEvent('crm_merge', {
    entity: info?.entity || 'client',
    mode,
    patched,
    pruned,
    kept,
  })
}

export function recordWsHint(kind) {
  state.wsHintCount += 1
  noteSyncEvent('ws_hint', { kind: String(kind || '') })
}

export function recordCoalescedPull() {
  state.coalescedPullCount += 1
}

export function notePullStarted() {
  state.lastPullStartedAt = Date.now()
  state.lastPullError = null
}

export function notePullCompleted(ok, error) {
  state.lastPullCompletedAt = Date.now()
  if (!ok && error) state.lastPullError = String(error).slice(0, 200)
  else if (ok) state.lastPullError = null
}

export function notePushStarted() {
  state.lastPushStartedAt = Date.now()
  state.lastPushError = null
}

export function notePushCompleted(ok, error) {
  state.lastPushCompletedAt = Date.now()
  if (!ok && error) state.lastPushError = String(error).slice(0, 200)
  else if (ok) state.lastPushError = null
}

export function noteAppliedChange(cursor) {
  state.lastAppliedChangeAt = Date.now()
  if (cursor != null) state.syncCursor = String(cursor)
}
