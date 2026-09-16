/**
 * PC-3 — Live-safe Recovery Executor façade (Desktop).
 * Persists durable session in localDb meta. Uses injected API only for tests;
 * production wiring still refuses until operator runbook (PC-3 does not POST live).
 */
import {
  SESSION_STATUS,
  RECOVERY_PHASE,
  createDurableRecoverySession,
  persistSessionPatch,
  assertRecoveryPreconditions,
  classifyFreshWithDelta,
  ensureRecoveryServerShift,
  executeVerifiedAckCleanup,
  executeShiftRemapBatch,
  executeRecoveryReplay,
  verifyPostDrain,
  executeCanonicalPull,
  finalizeGhostShifts,
  canDisableRecovery,
  enterReplayFreeze,
  exitReplayFreezeComplete,
  allowLocalBusinessMutation,
  kindSafetyMatrix,
  isKindReplaySupported,
  queueWatermark,
  simulateUpgradeFirstBoot,
  createMockRecoveryApi,
  STOP_NEEDS_OPERATOR,
} from './desktopRecoveryExecutorCore.mjs'
import {
  appendRecoveryAudit,
  ensureRecoveryGateReady,
  isRecoveryModeActive,
  setRecoveryMode,
  RECOVERY_SKIP,
} from './desktopRecovery'
import { getKakapoDesktop, isKakapoDesktop } from './desktopBridge'

export {
  SESSION_STATUS,
  RECOVERY_PHASE,
  STOP_NEEDS_OPERATOR,
  kindSafetyMatrix,
  isKindReplaySupported,
  queueWatermark,
  createDurableRecoverySession,
  simulateUpgradeFirstBoot,
  createMockRecoveryApi,
  allowLocalBusinessMutation,
  canDisableRecovery,
  RECOVERY_SKIP,
}

const META_SESSION_KEY = 'recoverySession'
const META_PHASE_KEY = 'recoveryPhase'

/** In-memory phase for tests / when meta unavailable */
let phaseOverride: string | null = null

export function __setRecoveryPhaseForTests(phase: string | null) {
  phaseOverride = phase
}

export async function getRecoveryPhase(): Promise<string> {
  if (phaseOverride) return phaseOverride
  if (!isKakapoDesktop()) return RECOVERY_PHASE.COMPLETE
  try {
    await ensureRecoveryGateReady()
    const desk = getKakapoDesktop()
    const meta = desk?.localDbMetaGet ? await desk.localDbMetaGet() : {}
    return String(meta?.[META_PHASE_KEY] || RECOVERY_PHASE.PREPARE)
  } catch {
    return RECOVERY_PHASE.PREPARE
  }
}

export async function setRecoveryPhase(phase: string, reason = 'explicit'): Promise<{ ok: boolean; phase: string }> {
  phaseOverride = phase
  if (isKakapoDesktop()) {
    try {
      const desk = getKakapoDesktop()
      await desk?.localDbMetaPatch?.({ [META_PHASE_KEY]: phase })
    } catch {
      return { ok: false, phase }
    }
  }
  await appendRecoveryAudit({
    action: 'CLASSIFY',
    reason: `phase:${phase}:${reason}`,
    after: { phase },
  })
  return { ok: true, phase }
}

export async function loadDurableRecoverySession(): Promise<ReturnType<typeof createDurableRecoverySession> | null> {
  if (!isKakapoDesktop()) return null
  try {
    const desk = getKakapoDesktop()
    const meta = desk?.localDbMetaGet ? await desk.localDbMetaGet() : {}
    if (meta?.[META_SESSION_KEY] && typeof meta[META_SESSION_KEY] === 'object') {
      return createDurableRecoverySession(meta[META_SESSION_KEY] as object)
    }
  } catch { /* ignore */ }
  return null
}

export async function saveDurableRecoverySession(
  session: ReturnType<typeof createDurableRecoverySession>,
): Promise<void> {
  if (!isKakapoDesktop()) return
  try {
    const desk = getKakapoDesktop()
    await desk?.localDbMetaPatch?.({
      [META_SESSION_KEY]: session,
      recoverySessionId: session.recoverySessionId,
      [META_PHASE_KEY]: session.phase,
    })
  } catch { /* ignore */ }
}

export async function beginRecoverySession(input: {
  deviceId?: string
  dbIdentity?: string
  snapshotManifestHash: string
  sourceSyncCursor?: string | null
  queue?: unknown[]
}): Promise<{ ok: boolean; session?: ReturnType<typeof createDurableRecoverySession>; error?: string }> {
  await ensureRecoveryGateReady()
  if (!isRecoveryModeActive()) {
    return { ok: false, error: 'recoveryMode must be true' }
  }
  const wm = queueWatermark((input.queue || []) as Parameters<typeof queueWatermark>[0])
  const session = createDurableRecoverySession({
    deviceId: input.deviceId,
    dbIdentity: input.dbIdentity,
    snapshotManifestHash: input.snapshotManifestHash,
    snapshotExists: true,
    sourceSyncCursor: input.sourceSyncCursor,
    queueWatermark: wm,
    sourceQueueSeq: wm.maxSeq,
    phase: RECOVERY_PHASE.PREPARE,
    status: SESSION_STATUS.CREATED,
  })
  await saveDurableRecoverySession(session)
  await setRecoveryPhase(RECOVERY_PHASE.PREPARE, 'begin_session')
  await appendRecoveryAudit({
    action: 'SNAPSHOT',
    reason: 'beginRecoverySession',
    after: { recoverySessionId: session.recoverySessionId, watermark: wm },
  })
  return { ok: true, session }
}

/** Strict disable — refuses unless canDisableRecovery */
export async function disableRecoveryStrict(session: ReturnType<typeof createDurableRecoverySession>, world: {
  queue?: unknown[]
  ghostIds?: string[]
}): Promise<{ ok: boolean; recovery?: boolean; error?: string; errors?: string[] }> {
  const gate = canDisableRecovery(session, world)
  if (!gate.ok) {
    return { ok: false, error: 'REFUSE_DISABLE', errors: gate.errors }
  }
  const r = await setRecoveryMode(false, 'pc3_signoff')
  if (r.ok) {
    await setRecoveryPhase(RECOVERY_PHASE.COMPLETE, 'disabled')
  }
  return r
}

export async function assertExecutorPreconditions(session: ReturnType<typeof createDurableRecoverySession>, extra: Record<string, unknown> = {}) {
  return assertRecoveryPreconditions({
    isDesktop: isKakapoDesktop() || extra.isDesktop === true,
    recoveryMode: isRecoveryModeActive(),
    session,
    requireSnapshot: true,
    ...extra,
  })
}

export {
  classifyFreshWithDelta,
  ensureRecoveryServerShift,
  executeVerifiedAckCleanup,
  executeShiftRemapBatch,
  executeRecoveryReplay,
  verifyPostDrain,
  executeCanonicalPull,
  finalizeGhostShifts,
  enterReplayFreeze,
  exitReplayFreezeComplete,
  persistSessionPatch,
}
