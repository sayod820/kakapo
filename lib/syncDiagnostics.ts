/**
 * L0 sync observability wrapper for Desktop/browser.
 * Bounded counters only — never dump CRM payloads.
 */
import {
  FULL_PULL_REASONS,
  getSyncDiagnostics as getCore,
  noteAppliedChange as noteAppliedChangeCore,
  notePullCompleted as notePullCompletedCore,
  notePullStarted as notePullStartedCore,
  notePushCompleted as notePushCompletedCore,
  notePushStarted as notePushStartedCore,
  noteSyncEvent as noteSyncEventCore,
  patchSyncDiagnostics as patchCore,
  recordCoalescedPull as recordCoalescedPullCore,
  recordCrmMerge as recordCrmMergeCore,
  recordFullPull as recordFullPullCore,
  recordWsHint as recordWsHintCore,
  resetSyncDiagnostics as resetCore,
} from './syncDiagnosticsCore.mjs'
import { isKakapoDesktop } from './desktopBridge'

export { FULL_PULL_REASONS }

export type FullPullReason =
  | 'BOOTSTRAP'
  | 'RECOVERY'
  | 'CURSOR_EXPIRED'
  | 'EMPTY_LOCAL_DB'
  | 'MANUAL_DIAGNOSTIC'
  | 'UNEXPECTED_RUNTIME_FULL_PULL'

export type FullPullKind = 'clients' | 'cards' | 'products' | 'pos' | 'sync_changes'

export function getSyncDiagnostics() {
  return getCore()
}

export function resetSyncDiagnostics() {
  resetCore()
}

export function patchSyncDiagnostics(partial: Record<string, unknown>) {
  return patchCore(partial)
}

export function noteSyncEvent(type: string, detail?: Record<string, unknown>) {
  noteSyncEventCore(type, detail)
}

export function detectSyncRuntime(): 'desktop' | 'browser' | 'unknown' {
  try {
    if (typeof window === 'undefined') return 'unknown'
    if (isKakapoDesktop()) return 'desktop'
    return 'browser'
  } catch {
    return 'unknown'
  }
}

export function classifyFullPullPhase(reason: string): 'bootstrap' | 'recovery' | 'normal-runtime' | 'diagnostic' {
  if (reason === FULL_PULL_REASONS.BOOTSTRAP || reason === FULL_PULL_REASONS.EMPTY_LOCAL_DB) return 'bootstrap'
  if (reason === FULL_PULL_REASONS.RECOVERY) return 'recovery'
  if (reason === FULL_PULL_REASONS.MANUAL_DIAGNOSTIC) return 'diagnostic'
  return 'normal-runtime'
}

export function recordFullPull(info: {
  kind: FullPullKind
  reason: FullPullReason | string
  caller?: string
  runtime?: 'desktop' | 'browser' | 'node' | 'unknown'
  phase?: 'bootstrap' | 'recovery' | 'normal-runtime' | 'diagnostic'
}) {
  const reason = String(info.reason || FULL_PULL_REASONS.UNEXPECTED_RUNTIME_FULL_PULL)
  recordFullPullCore({
    kind: info.kind,
    reason,
    caller: info.caller,
    runtime: info.runtime || detectSyncRuntime(),
    phase: info.phase || classifyFullPullPhase(reason),
  })
}

export function recordCrmMerge(info: {
  entity: 'client' | 'card'
  mode: string
  patched?: number
  pruned?: number
  kept?: number
}) {
  recordCrmMergeCore(info)
}

export function recordWsHint(kind: string) {
  recordWsHintCore(kind)
}

export function recordCoalescedPull() {
  recordCoalescedPullCore()
}

export function notePullStarted() {
  notePullStartedCore()
}

export function notePullCompleted(ok: boolean, error?: string) {
  notePullCompletedCore(ok, error)
}

export function notePushStarted() {
  notePushStartedCore()
}

export function notePushCompleted(ok: boolean, error?: string) {
  notePushCompletedCore(ok, error)
}

export function noteAppliedChange(cursor?: string | null) {
  noteAppliedChangeCore(cursor)
}

/** Classify whether a full CRM GET is expected for this caller context. */
export function expectedFullPullReason(opts: {
  bootstrap?: boolean
  recovery?: boolean
  emptyLocal?: boolean
  cursorExpired?: boolean
  manual?: boolean
}): FullPullReason {
  if (opts.manual) return FULL_PULL_REASONS.MANUAL_DIAGNOSTIC as FullPullReason
  if (opts.recovery) return FULL_PULL_REASONS.RECOVERY as FullPullReason
  if (opts.bootstrap) return FULL_PULL_REASONS.BOOTSTRAP as FullPullReason
  if (opts.emptyLocal) return FULL_PULL_REASONS.EMPTY_LOCAL_DB as FullPullReason
  if (opts.cursorExpired) return FULL_PULL_REASONS.CURSOR_EXPIRED as FullPullReason
  return FULL_PULL_REASONS.UNEXPECTED_RUNTIME_FULL_PULL as FullPullReason
}
