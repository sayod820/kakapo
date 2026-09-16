/**
 * PC-1A — Desktop Recovery / Pause-Sync.
 *
 * Durable meta.recoveryMode gates ALL server push/pull on Desktop.
 * Browser and Android are unaffected (isKakapoDesktop() only).
 *
 * Fail-closed: until ensureRecoveryGateReady() completes on Desktop,
 * sync is blocked (gateReady=false → treat as recovery).
 */
import { getKakapoDesktop, isKakapoDesktop } from './desktopBridge'
import type { PendingOp, QueueKind } from './offline'

export const RECOVERY_SKIP = 'SKIPPED_RECOVERY_MODE' as const

export type RecoveryAuditAction =
  | 'RECOVERY_ENABLED'
  | 'RECOVERY_DISABLED'
  | 'ACK_CLEANUP'
  | 'SHIFT_REMAP'
  | 'CLASSIFY'
  | 'GATE_READY'
  | 'SNAPSHOT'
  | 'REPLAY_ACKED'
  | 'GHOST_RECONCILED'

export type RecoveryAuditEntry = {
  ts: string
  action: RecoveryAuditAction
  clientRef?: string
  kind?: string
  before?: unknown
  after?: unknown
  reason?: string
}

export type PendingClassification =
  | 'SAFE_TO_SEND'
  | 'ALREADY_COMMITTED_SERVER'
  | 'CONFLICT'
  | 'DEPENDENCY_BLOCKED'
  | 'INVALID'
  | 'UNKNOWN'

/** In-memory gate — fail-closed until loaded on Desktop */
let gateReady = false
let recoveryActive = false
let loadPromise: Promise<void> | null = null

/** Test / fixture hooks (Node scripts) */
let testOverride: boolean | null = null

export function __resetRecoveryGateForTests() {
  gateReady = false
  recoveryActive = false
  loadPromise = null
  testOverride = null
}

export function __setRecoveryGateForTests(opts: {
  ready?: boolean
  recovery?: boolean
  /** Force isRecovery blocking regardless of desktop bridge */
  forceDesktop?: boolean
}) {
  if (opts.ready != null) gateReady = opts.ready
  if (opts.recovery != null) {
    recoveryActive = opts.recovery
    testOverride = opts.recovery
  }
}

function desktopOrTest(): boolean {
  if (testOverride != null) return true
  return isKakapoDesktop()
}

/**
 * True when server push/pull/flush must be skipped.
 * Browser → always false.
 * Desktop before gate ready → true (fail-closed).
 * Desktop after load → recoveryActive.
 */
export function isRecoveryModeBlockingSync(): boolean {
  if (testOverride != null) {
    return !!testOverride
  }
  if (!isKakapoDesktop()) return false
  if (!gateReady) return true
  return recoveryActive
}

export function isRecoveryModeActive(): boolean {
  if (testOverride != null) return !!testOverride
  if (!isKakapoDesktop()) return false
  return gateReady && recoveryActive
}

export function isRecoveryGateReady(): boolean {
  if (!isKakapoDesktop() && testOverride == null) return true
  return gateReady
}

export async function ensureRecoveryGateReady(): Promise<{ recovery: boolean }> {
  if (!desktopOrTest() && testOverride == null) {
    gateReady = true
    recoveryActive = false
    return { recovery: false }
  }
  if (testOverride != null) {
    gateReady = true
    recoveryActive = !!testOverride
    return { recovery: recoveryActive }
  }
  if (gateReady) return { recovery: recoveryActive }
  if (loadPromise) {
    await loadPromise
    return { recovery: recoveryActive }
  }

  loadPromise = (async () => {
    try {
      const desk = getKakapoDesktop()
      const meta = desk?.localDbMetaGet ? await desk.localDbMetaGet() : {}
      recoveryActive = meta?.recoveryMode === true || meta?.recoveryMode === 'true' || meta?.recoveryMode === 1
    } catch {
      // Fail-closed: cannot read meta → keep recovery-like block until success
      recoveryActive = true
    } finally {
      gateReady = true
    }
  })()

  await loadPromise
  return { recovery: recoveryActive }
}

export async function appendRecoveryAudit(entry: Omit<RecoveryAuditEntry, 'ts'> & { ts?: string }): Promise<void> {
  const row: RecoveryAuditEntry = {
    ts: entry.ts || new Date().toISOString(),
    action: entry.action,
    clientRef: entry.clientRef,
    kind: entry.kind,
    before: entry.before,
    after: entry.after,
    reason: entry.reason,
  }
  if (!isKakapoDesktop()) return
  try {
    const desk = getKakapoDesktop()
    if (typeof (desk as any)?.localDbRecoveryAuditAppend === 'function') {
      await (desk as any).localDbRecoveryAuditAppend(row)
      return
    }
    // Fallback: meta array
    const meta = desk?.localDbMetaGet ? await desk.localDbMetaGet() : {}
    const prev = Array.isArray(meta?.recoveryAudit) ? meta.recoveryAudit : []
    const next = [...prev, row].slice(-2000)
    await desk?.localDbMetaPatch?.({ recoveryAudit: next })
  } catch { /* best-effort */ }
}

/**
 * Explicit operator/sign-off control. Never auto-cleared.
 * Desktop-only.
 */
export async function setRecoveryMode(
  enabled: boolean,
  reason = 'explicit',
): Promise<{ ok: boolean; recovery: boolean; error?: string }> {
  if (!isKakapoDesktop() && testOverride == null) {
    return { ok: false, recovery: false, error: 'not_desktop' }
  }
  await ensureRecoveryGateReady()
  const before = recoveryActive
  recoveryActive = !!enabled
  if (testOverride != null) testOverride = recoveryActive

  if (isKakapoDesktop()) {
    try {
      const desk = getKakapoDesktop()
      await desk?.localDbMetaPatch?.({ recoveryMode: recoveryActive })
    } catch (e) {
      recoveryActive = before
      return { ok: false, recovery: before, error: e instanceof Error ? e.message : String(e) }
    }
  }

  await appendRecoveryAudit({
    action: recoveryActive ? 'RECOVERY_ENABLED' : 'RECOVERY_DISABLED',
    reason,
    before: { recoveryMode: before },
    after: { recoveryMode: recoveryActive },
  })
  return { ok: true, recovery: recoveryActive }
}

/** Central gate — call from every sync/flush/pull entry */
export async function assertSyncAllowed(source: string): Promise<
  | { allowed: true }
  | { allowed: false; code: typeof RECOVERY_SKIP; source: string }
> {
  if (!isKakapoDesktop() && testOverride == null) return { allowed: true }
  await ensureRecoveryGateReady()
  if (!isRecoveryModeBlockingSync()) return { allowed: true }
  return { allowed: false, code: RECOVERY_SKIP, source }
}

export function classifyPendingOperation(
  row: PendingOp,
  opts?: {
    /** @deprecated Prefer semanticMatchProven — clientRef alone must not ACK */
    serverHasClientRef?: boolean
    /** Exact business fingerprint match vs server row */
    semanticMatchProven?: boolean
    serverShiftOpen?: boolean
    shiftId?: string
  },
): { classification: PendingClassification; reason: string } {
  if (!row?.clientRef) return { classification: 'INVALID', reason: 'missing clientRef' }
  if (opts?.semanticMatchProven === true) {
    return { classification: 'ALREADY_COMMITTED_SERVER', reason: 'exact semantic match' }
  }
  if (opts?.serverHasClientRef && opts?.semanticMatchProven !== true) {
    return {
      classification: 'UNKNOWN',
      reason: 'server clientRef hit without semantic fingerprint proof',
    }
  }
  if (row.failed) {
    const err = String(row.lastError || '')
    if (/SHIFT_CLOSED|смена уже закрыта|SHIFT_NOT_FOUND/i.test(err)) {
      return { classification: 'DEPENDENCY_BLOCKED', reason: err.slice(0, 160) }
    }
    if (/IDEMPOTENCY|конфликт|верси/i.test(err)) {
      return { classification: 'CONFLICT', reason: err.slice(0, 160) }
    }
    return { classification: 'INVALID', reason: err.slice(0, 160) || 'failed' }
  }
  const shiftId = String(opts?.shiftId || (row.payload as any)?.shiftId || '')
  if (shiftId && opts?.serverShiftOpen === false) {
    return { classification: 'DEPENDENCY_BLOCKED', reason: `shift ${shiftId} not open on server` }
  }
  return { classification: 'SAFE_TO_SEND', reason: 'no server match; refs ok' }
}

/**
 * Remove queue row after proving server already committed.
 * NO POST. Does not revert local applied effects.
 */
export async function ackCleanupCommittedOperation(
  clientRef: string,
  expectedServerId: string,
  reason = 'ack_cleanup',
): Promise<{ ok: boolean; error?: string }> {
  const ref = String(clientRef || '').trim()
  const sid = String(expectedServerId || '').trim()
  if (!ref || !sid) return { ok: false, error: 'missing_args' }

  const { getPending, deletePending } = await import('./offline')
  const row = (await getPending()).find(r => r.clientRef === ref)
  if (!row) return { ok: false, error: 'not_in_queue' }

  const before = {
    clientRef: ref,
    kind: row.kind,
    seq: row.seq,
    localId: row.localId,
    failed: row.failed,
    lastError: row.lastError,
  }

  await deletePending(ref)

  await appendRecoveryAudit({
    action: 'ACK_CLEANUP',
    clientRef: ref,
    kind: row.kind,
    before,
    after: { removed: true, expectedServerId: sid },
    reason,
  })
  return { ok: true }
}

/**
 * Remap pending sale shiftId in queue + local sale projection.
 * Preserves clientRef, seq, totals/items. NO new sale, NO POST.
 */
export async function remapPendingSaleShift(opts: {
  clientRef: string
  expectedOldShiftId: string
  newShiftId: string
  reason?: string
}): Promise<{ ok: boolean; error?: string }> {
  const ref = String(opts.clientRef || '').trim()
  const oldId = String(opts.expectedOldShiftId || '').trim()
  const newId = String(opts.newShiftId || '').trim()
  if (!ref || !oldId || !newId) return { ok: false, error: 'missing_args' }

  const desk = getKakapoDesktop()
  if (desk && typeof (desk as any).localDbRemapSaleShift === 'function') {
    const res = await (desk as any).localDbRemapSaleShift({
      clientRef: ref,
      expectedOldShiftId: oldId,
      newShiftId: newId,
    })
    if (!res?.ok) return { ok: false, error: res?.error || 'remap_failed' }
    await appendRecoveryAudit({
      action: 'SHIFT_REMAP',
      clientRef: ref,
      kind: 'sale',
      before: { shiftId: oldId },
      after: { shiftId: newId, seq: res.seq, clientRef: ref },
      reason: opts.reason || 'shift_remap',
    })
    try {
      const { usePosStore } = await import('./posStore')
      const { persistPosSnapshot } = await import('./offline')
      usePosStore.setState(s => ({
        sales: s.sales.map(sale => {
          if (String(sale.clientRef || '') === ref) return { ...sale, shiftId: newId }
          return sale
        }),
      }))
      void persistPosSnapshot()
    } catch { /* ignore */ }
    return { ok: true }
  }

  // Non-native fallback (tests): queue + zustand only
  const { getPending, putPending } = await import('./offline')
  const row = (await getPending()).find(r => r.clientRef === ref)
  if (!row) return { ok: false, error: 'not_in_queue' }
  if (row.kind !== 'sale') return { ok: false, error: 'not_sale' }
  const curShift = String((row.payload as any)?.shiftId || '')
  if (curShift !== oldId) return { ok: false, error: 'shift_mismatch' }
  const nextPayload = { ...(row.payload as object), shiftId: newId }
  await putPending({ ...row, payload: nextPayload as PendingOp['payload'] })
  await appendRecoveryAudit({
    action: 'SHIFT_REMAP',
    clientRef: ref,
    kind: 'sale',
    before: { shiftId: oldId, seq: row.seq },
    after: { shiftId: newId, seq: row.seq, clientRef: ref },
    reason: opts.reason || 'shift_remap',
  })
  return { ok: true }
}

export type SyncSkipResult = {
  skipped: typeof RECOVERY_SKIP
  source?: string
}
