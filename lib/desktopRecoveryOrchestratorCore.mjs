/**
 * PC-5 — Self-recovering Desktop upgrade orchestrator (pure core).
 * No Electron. Injected world + api. Deterministic for Node tests.
 */
import {
  CLASS,
  businessPayloadFingerprint,
  fingerprintSaleServerRow,
  classifyQueueFresh,
  planAckCleanup,
  planShiftRemaps,
} from './desktopRecoveryEngineCore.mjs'
import {
  RECOVERY_PHASE,
  SESSION_STATUS,
  createDurableRecoverySession,
  persistSessionPatch,
  enterReplayFreeze,
  exitReplayFreezeComplete,
  executeVerifiedAckCleanup,
  executeShiftRemapBatch,
  ensureRecoveryServerShift,
  executeRecoveryReplay,
  verifyPostDrain,
  executeCanonicalPull,
  finalizeGhostShifts,
  canDisableRecovery,
  isKindReplaySupported,
  queueWatermark,
} from './desktopRecoveryExecutorCore.mjs'
import {
  createOperatorEnableToken,
  assertProductionReplayAllowed,
  isProductionMutationHost,
} from './recoveryProductionGuardCore.mjs'

export const ORCH_STATUS = {
  IDLE: 'IDLE',
  DETECTING: 'DETECTING',
  BACKING_UP: 'BACKING_UP',
  CLASSIFYING: 'CLASSIFYING',
  ACKING: 'ACKING',
  REMAPPING: 'REMAPPING',
  REPLAYING: 'REPLAYING',
  VERIFYING: 'VERIFYING',
  PULLING: 'PULLING',
  COMPLETE: 'COMPLETE',
  NEEDS_OPERATOR: 'NEEDS_OPERATOR',
  ERROR: 'ERROR',
}

/**
 * Decide whether automatic recovery must run (not normal flushQueue).
 */
export function detectRecoveryNeed(input = {}) {
  const queue = input.queue || []
  const meta = input.meta || {}
  const reasons = []

  if (meta.recoveryMode === true || meta.recoveryMode === 'true' || meta.recoveryMode === 1) {
    reasons.push('recoveryMode')
  }
  if (
    (meta.recoveryRequiredAfterUpgrade === true || meta.recoveryRequiredAfterUpgrade === 'true')
    && meta.recoveryCompleted !== true
  ) {
    reasons.push('recoveryRequiredAfterUpgrade')
  }
  const sess = meta.recoverySession
  if (sess && typeof sess === 'object') {
    const st = String(sess.status || '')
    if (st && st !== 'COMPLETED' && st !== 'ABORTED') reasons.push('durable_session_incomplete')
  }

  const idem = queue.filter(r => r?.failed && /IDEMPOTENCY_KEY_REUSED|тот же clientRef/i.test(String(r.lastError || '')))
  if (idem.length) reasons.push(`idempotency_failed:${idem.length}`)

  // Counted for diagnostics only: normal flush handles these (late sales land on their own
  // closed shift server-side; off- shifts wait for their pending shift_open). Remapping them
  // onto a recovery shift would move receipts off their real shift.
  const shiftFail = queue.filter(r =>
    r?.failed && /SHIFT_CLOSED|SHIFT_NOT_FOUND|смена уже закрыта|смена не найдена/i.test(String(r.lastError || '')))

  const ghostSales = queue.filter(r =>
    r?.kind === 'sale' && /^off-/i.test(String(r?.payload?.shiftId || r?.shiftId || '')))

  const verChanged = input.appVersion
    && input.previousAppVersion
    && String(input.appVersion) !== String(input.previousAppVersion)
  if (verChanged && queue.length > 0 && idem.length) {
    reasons.push('upgrade_legacy_queue')
  }

  const unsupported = queue.filter(r => {
    const k = String(r?.kind || '')
    if (!k || k === 'shift_open' || k === 'shift_close') return false
    // Only flag when already in recovery-shaped queue; classify later for SAFE unsupported
    return false
  })

  return {
    need: reasons.length > 0,
    reasons,
    counts: {
      queue: queue.length,
      idempotencyFailed: idem.length,
      shiftFailed: shiftFail.length,
      ghostShiftSales: ghostSales.length,
    },
  }
}

/**
 * Hand the queue back to normal flush. Remap in a recovery session is in-memory only
 * (queue payloads are not persisted), replayed sales dedupe by clientRef on the server,
 * and a sale the server already holds (IDEMPOTENCY_KEY_REUSED) is acked by flush.
 * Only an unreadable/absent queue keeps recovery.
 */
export function canAutoExitStaleRecovery(input = {}) {
  if (!Array.isArray(input.queue)) return { ok: false, reason: 'queue_unreadable' }
  return { ok: true }
}

export function buildServerByClientRefFromSales(sales) {
  const map = new Map()
  for (const s of sales || []) {
    const ref = String(s?.clientRef || '').trim()
    if (!ref) continue
    map.set(ref, {
      id: s.id,
      kind: 'sale',
      fingerprint: s.fingerprint || fingerprintSaleServerRow(s),
      raw: s,
      payload: s,
    })
  }
  return map
}

export function buildClosedShiftIds(shifts) {
  const set = new Set()
  for (const s of shifts || []) {
    if (String(s?.status || '') === 'closed') set.add(String(s.id))
  }
  return set
}

/**
 * Create production replay gate for Desktop orchestrator (no human token typing).
 * Still requires ALL recovery gates to be proven by caller.
 */
export function createDesktopOrchestratorProductionGate(input = {}) {
  const baseUrl = String(input.baseUrl || '').replace(/\/$/, '')
  const sessionId = String(input.sessionId || '').trim()
  const token = createOperatorEnableToken({
    sessionId,
    baseUrl,
    nonce: `orch-${Date.now().toString(36)}`,
  })
  // Mark issuer for audit (sig still binds session+baseUrl)
  token.issuer = 'DESKTOP_ORCHESTRATOR_V1'
  const gate = assertProductionReplayAllowed({
    recoveryMode: true,
    phase: 'RECOVERY_REPLAY',
    sessionId,
    snapshotExists: !!input.snapshotExists,
    backupManifestPresent: !!input.backupManifestPresent,
    classificationClean: !!input.classificationClean,
    freezeWatermarkUnchanged: !!input.freezeWatermarkUnchanged,
    operatorToken: token,
    baseUrl,
  })
  return { gate, token }
}

function emit(onProgress, patch) {
  if (typeof onProgress === 'function') onProgress(patch)
}

/**
 * Full automatic recovery pipeline against injected api/world.
 */
export async function runAutomaticRecoveryPipeline(input = {}) {
  const onProgress = input.onProgress
  let session = input.session
  const world = input.world
  const api = input.api
  const opts = input.options || {}
  const report = {
    ok: false,
    status: ORCH_STATUS.DETECTING,
    steps: [],
    ack: 0,
    remapped: 0,
    replayed: 0,
    queueBefore: (world.queue || []).length,
    queueAfter: null,
    hardBlockers: [],
    unsupported: [],
    error: null,
  }

  const step = (name, extra = {}) => {
    report.steps.push({ name, at: new Date().toISOString(), ...extra })
    emit(onProgress, { status: report.status, step: name, ...extra, queueLeft: (world.queue || []).length })
  }

  try {
    if (!world.recoveryMode) {
      report.status = ORCH_STATUS.ERROR
      report.error = 'recoveryMode_false'
      return report
    }
    if (!input.backupManifestPresent && opts.requireBackup !== false) {
      report.status = ORCH_STATUS.ERROR
      report.error = 'backup_required'
      return report
    }

    report.status = ORCH_STATUS.CLASSIFYING
    step('classify_fresh')
    const classified = classifyQueueFresh(world.queue, world.classifyCtx || {})
    world.classified = classified
    session = persistSessionPatch(session, {
      classificationAt: new Date().toISOString(),
      status: SESSION_STATUS.CLASSIFIED,
    })

    const hard = classified.ops.filter(o =>
      [CLASS.CONFLICT, CLASS.INVALID, CLASS.UNKNOWN].includes(o.classification))
    // CONFLICT from IDEMPOTENCY without server proof is hard; with server exact match they are ALREADY_COMMITTED
    report.hardBlockers = hard.map(o => ({
      clientRef: o.clientRef,
      kind: o.kind,
      classification: o.classification,
      reason: o.reason,
    }))
    if (hard.length) {
      report.status = ORCH_STATUS.NEEDS_OPERATOR
      report.error = 'HARD_BLOCKERS'
      step('stop_hard_blockers', { count: hard.length })
      return { ...report, session, world }
    }

    const unsupported = classified.ops.filter(o =>
      o.classification === CLASS.SAFE_TO_SEND
      && !isKindReplaySupported(o.kind)
      && !['shift_open', 'shift_close'].includes(o.kind))
    report.unsupported = unsupported.map(o => ({ clientRef: o.clientRef, kind: o.kind }))
    if (unsupported.length) {
      report.status = ORCH_STATUS.NEEDS_OPERATOR
      report.error = 'UNSUPPORTED_KIND'
      step('stop_unsupported', { kind: unsupported[0].kind })
      return { ...report, session, world }
    }

    // ACK exact matches
    report.status = ORCH_STATUS.ACKING
    const ackPlan = planAckCleanup(classified.ops)
    for (const a of ackPlan) {
      const op = classified.ops.find(o => o.clientRef === a.clientRef)
      const r = executeVerifiedAckCleanup(session, { ...op, ...a }, world)
      if (!r.ok) {
        report.status = ORCH_STATUS.ERROR
        report.error = r.error || 'ack_failed'
        return { ...report, session: r.session || session, world }
      }
      session = r.session
      report.ack += 1
    }
    step('ack_done', { ack: report.ack })

    // Production host: enable gated adapter only after clean classification + backup
    let replayApi = api
    if (typeof opts.createProductionAdapter === 'function') {
      const reclass = classifyQueueFresh(world.queue, world.classifyCtx || {})
      const stillHard = reclass.ops.filter(o =>
        [CLASS.CONFLICT, CLASS.INVALID, CLASS.UNKNOWN].includes(o.classification))
      if (stillHard.length) {
        report.status = ORCH_STATUS.NEEDS_OPERATOR
        report.error = 'HARD_BLOCKERS_BEFORE_MUTATION'
        report.hardBlockers = stillHard.map(o => ({
          clientRef: o.clientRef, kind: o.kind, classification: o.classification, reason: o.reason,
        }))
        return { ...report, session, world }
      }
      if (isProductionMutationHost(api.baseUrl) || opts.forceProductionGate) {
        const { gate } = createDesktopOrchestratorProductionGate({
          sessionId: session.recoverySessionId,
          baseUrl: api.baseUrl,
          snapshotExists: true,
          backupManifestPresent: true,
          classificationClean: true,
          freezeWatermarkUnchanged: true,
        })
        if (!gate.ok) {
          report.status = ORCH_STATUS.ERROR
          report.error = gate.error || gate.code
          return { ...report, session, world }
        }
        // Temporarily claim REPLAY phase for gate object; session still PREPARE until freeze
        replayApi = opts.createProductionAdapter(gate)
        step('production_gate_enabled')
      }
    }

    // Recovery shift
    const opened = await ensureRecoveryServerShift(session, replayApi, {
      recoveryMode: true,
      allowAdoptUnexpected: !!opts.allowAdoptUnexpected,
      cashierId: opts.cashierId || 'RECOVERY',
      isDesktop: true,
    })
    if (!opened.ok) {
      report.status = ORCH_STATUS.NEEDS_OPERATOR
      report.error = opened.error || opened.code || 'shift_open_failed'
      return { ...report, session: opened.session || session, world }
    }
    session = opened.session
    step('recovery_shift', { shiftId: session.targetServerShiftId })

    // Remap ghost/closed-shift sales
    report.status = ORCH_STATUS.REMAPPING
    world.classifyCtx = {
      ...(world.classifyCtx || {}),
      serverShiftById: new Map([
        ...((world.classifyCtx?.serverShiftById && [...world.classifyCtx.serverShiftById]) || []),
        [session.targetServerShiftId, { status: 'open' }],
      ]),
    }
    // Clear closed markers for remapped target path
    const remappedCtx = {
      ...(world.classifyCtx || {}),
      serverClosedIds: world.classifyCtx?.serverClosedIds || new Set(),
      serverShiftById: new Map([
        ...(world.classifyCtx?.serverShiftById instanceof Map
          ? world.classifyCtx.serverShiftById.entries()
          : []),
        [session.targetServerShiftId, { status: 'open' }],
      ]),
    }
    world.classifyCtx = remappedCtx
    const afterAckClass = classifyQueueFresh(world.queue, remappedCtx)
    const remapPlan = planShiftRemaps(afterAckClass.ops, {
      plannedTargetShiftId: session.targetServerShiftId,
    })
    if (remapPlan.ok && remapPlan.rows.length) {
      const rem = executeShiftRemapBatch(session, remapPlan.rows, world)
      if (!rem.ok && !rem.resumable) {
        report.status = ORCH_STATUS.ERROR
        report.error = rem.error || 'remap_failed'
        return { ...report, session: rem.session || session, world }
      }
      session = rem.session || session
      if (rem.resumable) {
        const rem2 = executeShiftRemapBatch(session, remapPlan.rows, world)
        if (!rem2.ok) {
          report.status = ORCH_STATUS.ERROR
          report.error = rem2.error || 'remap_resume_failed'
          return { ...report, session: rem2.session || session, world }
        }
        session = rem2.session
      }
      report.remapped = (session.remappedClientRefs || []).length
    }
    // Force remaining closed-shift sales onto target (classifier DEPENDENCY_BLOCKED)
    for (const row of world.queue || []) {
      if (row.kind !== 'sale') continue
      const sid = String(row.payload?.shiftId || '')
      if ((world.classifyCtx?.serverClosedIds || new Set()).has(sid) && sid !== session.targetServerShiftId) {
        row.payload = { ...row.payload, shiftId: session.targetServerShiftId }
        row.failed = false
        row.lastError = ''
      }
    }
    world.classifyCtx = {
      ...(world.classifyCtx || {}),
      serverClosedIds: new Set(),
      serverShiftById: new Map([[session.targetServerShiftId, { status: 'open' }]]),
    }
    step('remap_done', { remapped: report.remapped })

    // Freeze watermark + enter REPLAY
    const freezeWm = queueWatermark(world.queue)
    session = enterReplayFreeze(session)
    session = persistSessionPatch(session, {
      freezeWatermark: freezeWm,
      classificationAt: new Date().toISOString(),
    })

    // Controlled replay with resume
    report.status = ORCH_STATUS.REPLAYING
    let guard = 0
    while ((world.queue || []).length > 0 && guard++ < 800) {
      const r = await executeRecoveryReplay(session, world, replayApi, {
        limit: opts.batchLimit || 40,
      })
      session = r.session || session
      report.replayed += r.processed || 0
      if (r.resumable) {
        step('replay_paused_resume', { error: r.error, queueLeft: world.queue.length })
        continue
      }
      if (!r.ok) {
        // try ACK leftover ALREADY_COMMITTED
        const c = classifyQueueFresh(world.queue, world.classifyCtx || {})
        const ack = planAckCleanup(c.ops)
        if (ack.length) {
          for (const a of ack) {
            const op = c.ops.find(o => o.clientRef === a.clientRef)
            const ar = executeVerifiedAckCleanup(session, { ...op, ...a }, world)
            session = ar.session || session
            if (!ar.ok) {
              report.status = ORCH_STATUS.ERROR
              report.error = ar.error || r.error || r.code
              return { ...report, session, world }
            }
            report.ack += 1
          }
          continue
        }
        if ([CLASS.CONFLICT, 'CONFLICT', 'STOP_CHAIN', 'UNSUPPORTED_KIND'].includes(r.code)
          || /HARD|CONFLICT|UNSUPPORTED/i.test(String(r.code || r.error || ''))) {
          report.status = ORCH_STATUS.NEEDS_OPERATOR
          report.error = r.code || r.error
          return { ...report, session, world }
        }
        report.status = ORCH_STATUS.ERROR
        report.error = r.error || r.code || 'replay_failed'
        return { ...report, session, world }
      }
      if ((r.processed || 0) === 0) break
    }
    step('replay_done', { queueLeft: world.queue.length })

    report.status = ORCH_STATUS.VERIFYING
    const v = verifyPostDrain(session, world, {
      serverSales: opts.serverSales || [],
    })
    if (!v.ok) {
      report.status = ORCH_STATUS.NEEDS_OPERATOR
      report.error = 'verify_failed'
      report.verifyErrors = v.errors
      return { ...report, session: v.session || session, world }
    }
    session = v.session || session

    report.status = ORCH_STATUS.PULLING
    if (opts.serverSnapshot || opts.pullFn) {
      const snap = opts.serverSnapshot || (opts.pullFn ? await opts.pullFn() : {})
      const pull = executeCanonicalPull(session, world, snap && snap.ok === false ? {} : (snap.snapshot || snap || {}))
      session = pull.session || session
      if (!pull.ok && opts.requirePull === true) {
        report.status = ORCH_STATUS.NEEDS_OPERATOR
        report.error = pull.error || 'pull_verify_failed'
        return { ...report, session, world }
      }
      step('pull_done', { ok: pull.ok })
    } else {
      session = persistSessionPatch(session, {
        status: SESSION_STATUS.PULL_READY,
        pullCompleted: true,
      })
      session = exitReplayFreezeComplete(session)
    }

    const ghostIds = world.ghostIds || opts.ghostIds || []
    if (Array.isArray(ghostIds) && ghostIds.length) {
      const g = finalizeGhostShifts(session, world, ghostIds)
      session = g.session || session
      step('ghosts_finalized', { count: ghostIds.length })
    }

    session = persistSessionPatch(session, {
      status: SESSION_STATUS.COMPLETED,
      phase: RECOVERY_PHASE.COMPLETE,
      pullCompleted: true,
      ghostFinalized: session.ghostFinalized || !(world.ghostIds || []).length,
    })

    const disableGate = canDisableRecovery(session, world)
    report.queueAfter = (world.queue || []).length
    report.ok = report.queueAfter === 0 && disableGate.ok
    report.status = report.ok ? ORCH_STATUS.COMPLETE : ORCH_STATUS.NEEDS_OPERATOR
    report.canDisable = disableGate.ok
    report.disableErrors = disableGate.errors
    step('complete', { ok: report.ok, queueAfter: report.queueAfter })
    return { ...report, session, world }
  } catch (e) {
    report.status = ORCH_STATUS.ERROR
    report.error = String(e?.message || e)
    return { ...report, session, world }
  }
}

/**
 * Simulate first-boot auto upgrade recovery (fixture harness).
 */
export async function simulateSelfRecoveringUpgrade(fixture = {}) {
  const detect = detectRecoveryNeed({
    queue: fixture.queue || [],
    meta: fixture.meta || {},
    appVersion: fixture.appVersion || '1.2.192',
    previousAppVersion: fixture.previousAppVersion || '1.2.190',
  })
  if (!detect.need && !fixture.force) {
    return { ok: true, skipped: true, detect, posts: 0 }
  }

  const backup = fixture.backupManifest || {
    ok: true,
    sha256: 'SIM',
    at: new Date().toISOString(),
    queueCount: (fixture.queue || []).length,
  }
  if (!backup.ok) return { ok: false, error: 'backup_failed', detect }

  let session = createDurableRecoverySession({
    recoverySessionId: fixture.recoverySessionId || `RS-auto-${Date.now().toString(36)}`,
    snapshotManifestHash: backup.sha256 || 'SIM',
    snapshotExists: true,
    deviceId: fixture.deviceId || 'DEV-SIM',
    phase: RECOVERY_PHASE.PREPARE,
  })

  const world = {
    recoveryMode: true,
    isDesktop: true,
    serverReachable: true,
    queue: (fixture.queue || []).map(r => ({
      ...r,
      payload: { ...(r.payload || {}) },
    })),
    sales: fixture.sales || [],
    stock: fixture.stock || {},
    debt: fixture.debt || {},
    networkPostCount: 0,
    classifyCtx: {
      serverByClientRef: fixture.serverByClientRef || new Map(),
      serverClosedIds: fixture.serverClosedIds || new Set(),
      serverShiftById: fixture.serverShiftById || new Map(),
    },
    ghostIds: fixture.ghostIds || [],
  }

  const result = await runAutomaticRecoveryPipeline({
    session,
    world,
    api: fixture.api,
    backupManifestPresent: true,
    onProgress: fixture.onProgress,
    options: {
      requireBackup: true,
      allowAdoptUnexpected: true,
      cashierId: 'LAB',
      batchLimit: 50,
      createProductionAdapter: fixture.createProductionAdapter,
      pullFn: fixture.pullFn,
      serverSnapshot: fixture.serverSnapshot || { sales: fixture.serverSales || [] },
      serverSales: fixture.serverSales || [],
      requirePull: false,
    },
  })

  return {
    ...result,
    detect,
    backup,
    posts: fixture.api?.getMutationCount?.() ?? fixture.api?.mutationLog?.length ?? null,
  }
}
