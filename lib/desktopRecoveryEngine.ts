/**
 * PC-2 — Desktop Recovery Engine (TypeScript façade).
 * Wraps pure core + PC-1A primitives. Refuse when recoveryMode=false.
 */
import {
  assertRecoveryModeOn,
  buildRecoveryReplayOrder,
  buildSnapshotManifest,
  businessPayloadFingerprint,
  classifyLocalShiftState,
  classifyPendingOpFresh,
  classifyQueueFresh,
  createRecoverySession,
  ensureLocalRecoveryShift,
  markGhostShiftsReconciled,
  newRecoverySessionId,
  openPosShiftContractNotes,
  pickSaleTargetShift,
  planAckCleanup,
  planShiftRemaps,
  recoveryShiftId,
  resumeRecoverySession,
  applyRecoveryStepDry,
  CLASS,
  REFUSE_RECOVERY_OFF,
  SHIFT_STATE,
  RECOVERY_SHIFT_PREFIX,
  isRecoveryShiftId,
} from './desktopRecoveryEngineCore.mjs'
import {
  ackCleanupCommittedOperation,
  appendRecoveryAudit,
  ensureRecoveryGateReady,
  isRecoveryModeActive,
  remapPendingSaleShift,
  RECOVERY_SKIP,
} from './desktopRecovery'
import type { PendingOp } from './offline'

export {
  CLASS,
  SHIFT_STATE,
  RECOVERY_SHIFT_PREFIX,
  REFUSE_RECOVERY_OFF,
  RECOVERY_SKIP,
  businessPayloadFingerprint,
  classifyLocalShiftState,
  classifyPendingOpFresh,
  classifyQueueFresh,
  createRecoverySession,
  planAckCleanup,
  planShiftRemaps,
  buildRecoveryReplayOrder,
  buildSnapshotManifest,
  pickSaleTargetShift,
  recoveryShiftId,
  isRecoveryShiftId,
  markGhostShiftsReconciled,
  ensureLocalRecoveryShift,
  openPosShiftContractNotes,
  applyRecoveryStepDry,
  resumeRecoverySession,
  newRecoverySessionId,
}

export async function requireRecoveryMode(): Promise<{ ok: true } | { ok: false; code: string; error: string }> {
  await ensureRecoveryGateReady()
  const gate = assertRecoveryModeOn(isRecoveryModeActive())
  if (!gate.ok) return gate as { ok: false; code: string; error: string }
  return { ok: true }
}

/** Dry-run full plan from fresh queue + server indexes (no mutations). */
export async function dryRunRecoveryPlan(input: {
  queue: PendingOp[]
  serverByClientRef?: Map<string, { id: string; fingerprint?: string; kind?: string; raw?: unknown }>
  serverClosedIds?: Set<string>
  serverShiftById?: Map<string, { status: string }>
  plannedTargetShiftId?: string
}): Promise<{
  ok: boolean
  error?: string
  code?: string
  sessionId?: string
  classified?: ReturnType<typeof classifyQueueFresh>
  ackPlan?: ReturnType<typeof planAckCleanup>
  remapPlan?: ReturnType<typeof planShiftRemaps>
  steps?: ReturnType<typeof buildRecoveryReplayOrder>
}> {
  const gate = await requireRecoveryMode()
  if (!gate.ok) return gate

  const session = createRecoverySession({ plannedTargetShiftId: input.plannedTargetShiftId })
  const classifyCtx = {
    serverByClientRef: input.serverByClientRef || new Map(),
    serverClosedIds: input.serverClosedIds || new Set(),
    serverShiftById: input.serverShiftById,
  }
  const classified = classifyQueueFresh(input.queue, classifyCtx)
  const ackPlan = planAckCleanup(classified.ops)
  const remapPlan = planShiftRemaps(classified.ops, {
    plannedTargetShiftId: input.plannedTargetShiftId || session.recoveryShiftId,
  })
  const steps = buildRecoveryReplayOrder(classified.ops, {
    plannedTargetShiftId: input.plannedTargetShiftId || undefined,
    remapPlanRows: remapPlan.ok ? remapPlan.rows : [],
  })

  await appendRecoveryAudit({
    action: 'CLASSIFY',
    reason: 'dryRunRecoveryPlan',
    before: { queueTotal: input.queue.length },
    after: { summary: classified.summary, sessionId: session.sessionId },
  })

  return {
    ok: true,
    sessionId: session.sessionId,
    classified,
    ackPlan,
    remapPlan,
    steps,
  }
}

/**
 * Execute one recovery step against live Desktop (still requires recoveryMode).
 * ACK/REMAP use PC-1A primitives. REPLAY_OP is executed only via
 * desktopRecoveryExecutor.executeRecoveryReplay with an injected API adapter
 * (PC-3) — never generic flushQueue; live production POST still operator-gated.
 */
export async function executeRecoveryStep(step: {
  type: string
  clientRef?: string
  expectedServerId?: string
  oldShiftId?: string
  plannedTargetShiftId?: string
  kind?: string
  seq?: number
  reason?: string
}): Promise<{ ok: boolean; error?: string; code?: string; plannedOnly?: boolean }> {
  const gate = await requireRecoveryMode()
  if (!gate.ok) return gate

  if (step.type === 'ACK_CLEANUP') {
    if (!step.clientRef || !step.expectedServerId) {
      return { ok: false, error: 'missing_args' }
    }
    return ackCleanupCommittedOperation(step.clientRef, step.expectedServerId, 'pc2_ack_cleanup')
  }
  if (step.type === 'SHIFT_REMAP') {
    if (!step.clientRef || !step.oldShiftId || !step.plannedTargetShiftId) {
      return { ok: false, error: 'missing_args' }
    }
    return remapPendingSaleShift({
      clientRef: step.clientRef,
      expectedOldShiftId: step.oldShiftId,
      newShiftId: step.plannedTargetShiftId,
      reason: 'pc2_shift_remap',
    })
  }
  if (step.type === 'REPLAY_OP') {
    return {
      ok: false,
      error: 'USE_executeRecoveryReplay_WITH_INJECTED_API',
      code: 'PC3_EXECUTOR_REQUIRED',
      plannedOnly: true,
    }
  }
  return { ok: true }
}
