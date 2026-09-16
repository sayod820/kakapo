/**
 * PC-3 — Live-safe Recovery Executor (pure core, Node-testable).
 * Injected API adapter only. No production POST. No live cashier SQLite.
 */
import { createHash } from 'node:crypto'
import {
  CLASS,
  SHIFT_STATE,
  businessPayloadFingerprint,
  classifyPendingOpFresh,
  classifyQueueFresh,
  planAckCleanup,
  planShiftRemaps,
  buildRecoveryReplayOrder,
  createRecoverySession,
  assertRecoveryModeOn,
  applyRecoveryStepDry,
  resumeRecoverySession,
  markGhostShiftsReconciled,
  recoveryShiftId,
  newRecoverySessionId,
  openPosShiftContractNotes,
  REFUSE_RECOVERY_OFF,
} from './desktopRecoveryEngineCore.mjs'

export {
  CLASS,
  SHIFT_STATE,
  REFUSE_RECOVERY_OFF,
  businessPayloadFingerprint,
  classifyQueueFresh,
  planAckCleanup,
  planShiftRemaps,
  buildRecoveryReplayOrder,
  createRecoverySession,
  resumeRecoverySession,
  markGhostShiftsReconciled,
  recoveryShiftId,
  openPosShiftContractNotes,
}

/** Durable session lifecycle */
export const SESSION_STATUS = {
  CREATED: 'CREATED',
  PAUSED: 'PAUSED',
  CLASSIFIED: 'CLASSIFIED',
  ACK_CLEANED: 'ACK_CLEANED',
  SHIFT_READY: 'SHIFT_READY',
  REMAPPED: 'REMAPPED',
  REPLAYING: 'REPLAYING',
  VERIFYING: 'VERIFYING',
  PULL_READY: 'PULL_READY',
  COMPLETED: 'COMPLETED',
  ABORTED: 'ABORTED',
}

/** Operator-facing recovery phase (UI + mutation policy) */
export const RECOVERY_PHASE = {
  PREPARE: 'RECOVERY_PREPARE', // local sales OK, sync blocked
  REPLAY: 'RECOVERY_REPLAY',   // new business mutations blocked
  COMPLETE: 'RECOVERY_COMPLETE',
}

export const STOP_NEEDS_OPERATOR = 'STOP_NEEDS_OPERATOR'

function stableStringify(v) {
  if (v == null) return 'null'
  if (typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  const keys = Object.keys(v).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`
}

export function queueWatermark(queue) {
  const rows = queue || []
  const seqs = rows.map(r => Number(r.seq) || 0)
  const maxSeq = seqs.length ? Math.max(...seqs) : 0
  const minSeq = seqs.length ? Math.min(...seqs) : 0
  const refs = rows.map(r => String(r.clientRef || '')).sort()
  const fingerprint = createHash('sha256')
    .update(refs.map((ref, i) => {
      const row = rows.find(r => String(r.clientRef) === ref) || rows[i]
      return `${ref}|${row?.kind}|${row?.seq}|${row?.failed ? 1 : 0}`
    }).join('\n'))
    .digest('hex')
  return {
    count: rows.length,
    maxSeq,
    minSeq,
    fingerprint,
  }
}

export function createDurableRecoverySession(input = {}) {
  const sessionId = input.recoverySessionId || input.sessionId || newRecoverySessionId()
  const wm = input.queueWatermark || null
  return {
    recoverySessionId: sessionId,
    createdAt: input.createdAt || new Date().toISOString(),
    deviceId: input.deviceId || null,
    sourceQueueSeq: input.sourceQueueSeq ?? wm?.maxSeq ?? null,
    sourceSyncCursor: input.sourceSyncCursor ?? null,
    snapshotManifestHash: input.snapshotManifestHash || null,
    snapshotExists: input.snapshotExists !== false && !!input.snapshotManifestHash,
    status: input.status || SESSION_STATUS.CREATED,
    phase: input.phase || RECOVERY_PHASE.PREPARE,
    targetServerShiftId: input.targetServerShiftId || null,
    targetShiftOpenClientRef: input.targetShiftOpenClientRef || `recovery-open-${sessionId}`,
    classificationAt: input.classificationAt || null,
    classificationCounts: input.classificationCounts || null,
    queueWatermark: wm,
    replayCursor: input.replayCursor || null,
    lastCompletedSeq: input.lastCompletedSeq ?? null,
    stoppedReason: input.stoppedReason || null,
    checkpoints: Array.isArray(input.checkpoints) ? input.checkpoints.slice() : [],
    completedClientRefs: Array.isArray(input.completedClientRefs) ? input.completedClientRefs.slice() : [],
    ackCleanedClientRefs: Array.isArray(input.ackCleanedClientRefs) ? input.ackCleanedClientRefs.slice() : [],
    remappedClientRefs: Array.isArray(input.remappedClientRefs) ? input.remappedClientRefs.slice() : [],
    pullCompleted: !!input.pullCompleted,
    ghostFinalized: !!input.ghostFinalized,
    localRecoveryShiftId: recoveryShiftId(sessionId),
    dbIdentity: input.dbIdentity || null,
  }
}

export function persistSessionPatch(session, patch) {
  return { ...session, ...patch, recoverySessionId: session.recoverySessionId }
}

export function appendCheckpoint(session, cp) {
  const row = {
    ts: new Date().toISOString(),
    ...cp,
  }
  const checkpoints = [...(session.checkpoints || []), row]
  return persistSessionPatch(session, {
    checkpoints,
    replayCursor: cp.clientRef || session.replayCursor,
    lastCompletedSeq: cp.seq != null ? cp.seq : session.lastCompletedSeq,
  })
}

/**
 * Fail-closed preconditions for destructive / replay actions.
 */
export function assertRecoveryPreconditions(ctx = {}) {
  const fails = []
  if (ctx.isDesktop === false) fails.push('not_desktop')
  if (!ctx.recoveryMode) fails.push('recoveryMode_false')
  if (!ctx.session?.recoverySessionId) fails.push('missing_session')
  if (ctx.requireSnapshot !== false && !ctx.session?.snapshotExists && !ctx.session?.snapshotManifestHash) {
    fails.push('missing_snapshot')
  }
  if (ctx.requireClassified && ctx.session?.status === SESSION_STATUS.CREATED) {
    fails.push('not_classified')
  }
  if (ctx.requireClassified && !ctx.session?.classificationAt && ctx.session?.status === SESSION_STATUS.CREATED) {
    fails.push('classification_incomplete')
  }
  if (ctx.expectedDeviceId && ctx.session?.deviceId && String(ctx.expectedDeviceId) !== String(ctx.session.deviceId)) {
    fails.push('deviceId_mismatch')
  }
  if (ctx.expectedDbIdentity && ctx.session?.dbIdentity && String(ctx.expectedDbIdentity) !== String(ctx.session.dbIdentity)) {
    fails.push('db_identity_mismatch')
  }
  if (ctx.dbReplaced) fails.push('unexpected_db_replacement')
  if (ctx.globalBlocker) fails.push(`global_blocker:${ctx.globalBlocker}`)
  if (ctx.revisionRunning) fails.push('revision_conflicting')
  if (ctx.requireServer && !ctx.serverReachable) fails.push('server_unreachable')
  if (fails.length) {
    return { ok: false, code: 'REFUSE_PRECONDITIONS', errors: fails }
  }
  return { ok: true }
}

/**
 * Fresh classify + detect watermark delta vs session.
 */
export function classifyFreshWithDelta(session, queue, classifyCtx = {}) {
  const wm = queueWatermark(queue)
  const prev = session.queueWatermark
  const classified = classifyQueueFresh(queue, classifyCtx)
  let delta = null
  if (prev && (prev.fingerprint !== wm.fingerprint || prev.count !== wm.count || prev.maxSeq !== wm.maxSeq)) {
    const prevRefs = new Set()
    // delta = rows not in previous fingerprint set approximated by count/seq growth
    delta = {
      watermarkChanged: true,
      prev,
      next: wm,
      countDelta: wm.count - (prev.count || 0),
      maxSeqDelta: wm.maxSeq - (prev.maxSeq || 0),
    }
  }
  const nextSession = persistSessionPatch(session, {
    status: SESSION_STATUS.CLASSIFIED,
    classificationAt: new Date().toISOString(),
    classificationCounts: classified.summary,
    queueWatermark: wm,
    sourceQueueSeq: wm.maxSeq,
  })
  return { session: nextSession, classified, watermark: wm, delta }
}

/** Explicit kind safety matrix for recovery replay */
export function kindSafetyMatrix() {
  const row = (kind, opts) => ({
    kind,
    replaySupported: opts.replaySupported,
    idempotencyProven: opts.idempotencyProven,
    dependency: opts.dependency || 'seq',
    canonicalVerification: opts.canonicalVerification || 'clientRef',
    safeAckRule: opts.safeAckRule || 'exact_fingerprint',
    stopRule: opts.stopRule || 'CONFLICT|INVALID|UNKNOWN',
  })
  return [
    row('sale', { replaySupported: true, idempotencyProven: true, dependency: 'shift+stock_prereq', canonicalVerification: 'sale_by_clientRef' }),
    row('stock_receipt_create', { replaySupported: true, idempotencyProven: true, dependency: 'before_sales', canonicalVerification: 'receipt_by_clientRef' }),
    row('shift_open', { replaySupported: false, idempotencyProven: true, dependency: 'barrier', stopRule: 'use ensureRecoveryServerShift only' }),
    row('shift_close', { replaySupported: false, idempotencyProven: true, stopRule: 'never close ghost already closed on server' }),
    row('debt_repay', { replaySupported: true, idempotencyProven: true, dependency: 'sale_or_order' }),
    row('cash_advance', { replaySupported: true, idempotencyProven: true }),
    row('card_topup', { replaySupported: true, idempotencyProven: true }),
    row('finance_move', { replaySupported: true, idempotencyProven: true }),
    row('sale_return', { replaySupported: true, idempotencyProven: true, dependency: 'sale' }),
    row('stock_writeoff_create', { replaySupported: true, idempotencyProven: true }),
    row('stock_writeoff_update', { replaySupported: true, idempotencyProven: true }),
    row('stock_writeoff_delete', { replaySupported: true, idempotencyProven: true }),
    row('client_upsert', { replaySupported: true, idempotencyProven: true, dependency: 'early' }),
    row('card_loyalty_patch', { replaySupported: true, idempotencyProven: true }),
    row('product_upsert', { replaySupported: true, idempotencyProven: true, dependency: 'early' }),
    row('vault_card_to_cash', { replaySupported: true, idempotencyProven: true }),
    row('vault_cash_to_card', { replaySupported: true, idempotencyProven: true }),
    row('expense_create', { replaySupported: true, idempotencyProven: true }),
    row('stock_revision_create', { replaySupported: false, idempotencyProven: true, stopRule: 'revisionCoordinator — DO NOT SEND in recovery' }),
    row('stock_revision_update', { replaySupported: false, idempotencyProven: true, stopRule: 'revisionCoordinator — DO NOT SEND' }),
    row('stock_revision_delete', { replaySupported: false, idempotencyProven: true, stopRule: 'revisionCoordinator — DO NOT SEND' }),
  ]
}

export function isKindReplaySupported(kind) {
  const hit = kindSafetyMatrix().find(r => r.kind === kind)
  if (!hit) return false
  return !!hit.replaySupported
}

export function allowLocalBusinessMutation(phase) {
  return phase === RECOVERY_PHASE.PREPARE || phase === RECOVERY_PHASE.COMPLETE || !phase
}

export function enterReplayFreeze(session) {
  return persistSessionPatch(session, {
    phase: RECOVERY_PHASE.REPLAY,
    status: SESSION_STATUS.REPLAYING,
  })
}

export function exitReplayFreezeComplete(session) {
  return persistSessionPatch(session, {
    phase: RECOVERY_PHASE.COMPLETE,
    status: SESSION_STATUS.COMPLETED,
  })
}

/**
 * Controlled server recovery shift open (injected API).
 */
export async function ensureRecoveryServerShift(session, api, opts = {}) {
  const pre = assertRecoveryPreconditions({
    isDesktop: opts.isDesktop !== false,
    recoveryMode: opts.recoveryMode !== false,
    session,
    requireSnapshot: opts.requireSnapshot !== false,
    serverReachable: opts.serverReachable !== false,
    requireServer: true,
    revisionRunning: opts.revisionRunning,
    globalBlocker: opts.globalBlocker,
    expectedDeviceId: opts.expectedDeviceId,
    expectedDbIdentity: opts.expectedDbIdentity,
    dbReplaced: opts.dbReplaced,
  })
  if (!pre.ok) return { ok: false, ...pre, session }

  const clientRef = session.targetShiftOpenClientRef || `recovery-open-${session.recoverySessionId}`
  let openShifts = []
  try {
    openShifts = await api.listOpenShifts()
  } catch (e) {
    return { ok: false, error: String(e?.message || e), session }
  }

  const already = openShifts.find(s => String(s.clientRef || '') === clientRef)
  if (already) {
    const next = persistSessionPatch(session, {
      targetServerShiftId: already.id,
      targetShiftOpenClientRef: clientRef,
      status: SESSION_STATUS.SHIFT_READY,
    })
    return { ok: true, adopted: true, shiftId: already.id, session: next }
  }

  const unexpected = openShifts.filter(s => String(s.clientRef || '') !== clientRef)
  if (unexpected.length > 0 && !opts.allowAdoptUnexpected) {
    const next = persistSessionPatch(session, {
      status: SESSION_STATUS.ABORTED,
      stoppedReason: STOP_NEEDS_OPERATOR + ':unexpected_open_shift',
    })
    return {
      ok: false,
      code: STOP_NEEDS_OPERATOR,
      error: 'unexpected_open_shift',
      unexpected: unexpected.map(s => s.id),
      session: next,
    }
  }

  let result
  try {
    result = await api.openPosShift({
      clientRef,
      cashierId: opts.cashierId || 'CASHIER-RECOVERY',
      cashierName: opts.cashierName || 'Recovery',
      openingCash: opts.openingCash ?? 0,
      posId: opts.posId,
      note: `recoverySession:${session.recoverySessionId}`,
    })
  } catch (e) {
    const msg = String(e?.message || e)
    // timeout-after-commit: lookup by clientRef
    if (/timeout|CRASH_AFTER_POST|ECONN/i.test(msg) && api.getShiftByClientRef) {
      const found = await api.getShiftByClientRef(clientRef)
      if (found) {
        const next = persistSessionPatch(session, {
          targetServerShiftId: found.id,
          targetShiftOpenClientRef: clientRef,
          status: SESSION_STATUS.SHIFT_READY,
        })
        return { ok: true, adoptedAfterTimeout: true, shiftId: found.id, session: next }
      }
    }
    if (/уже открыта|already open/i.test(msg)) {
      const next = persistSessionPatch(session, {
        status: SESSION_STATUS.ABORTED,
        stoppedReason: STOP_NEEDS_OPERATOR + ':duplicate_open',
      })
      return { ok: false, code: STOP_NEEDS_OPERATOR, error: msg, session: next }
    }
    return { ok: false, error: msg, session }
  }

  const shiftId = result?.id || result?.shiftId
  if (!shiftId) return { ok: false, error: 'no_shift_id', session }

  const next = persistSessionPatch(session, {
    targetServerShiftId: shiftId,
    targetShiftOpenClientRef: clientRef,
    status: SESSION_STATUS.SHIFT_READY,
  })
  return { ok: true, shiftId, session: next, clientRef }
}

export function executeVerifiedAckCleanup(session, op, world) {
  const pre = assertRecoveryPreconditions({
    isDesktop: world.isDesktop !== false,
    recoveryMode: world.recoveryMode,
    session,
    requireSnapshot: true,
  })
  if (!pre.ok) return { ok: false, ...pre, session, world }

  if (op.classification !== CLASS.ALREADY_COMMITTED_SERVER || !op.ackEligible) {
    return { ok: false, error: 'not_ack_eligible', session, world }
  }

  let s = appendCheckpoint(session, {
    type: 'ACK_INTENT',
    clientRef: op.clientRef,
    seq: op.seq,
    expectedServerId: op.serverId || op.expectedServerId,
  })

  const beforeQueue = (world.queue || []).length
  const saleBefore = (world.sales || []).find(x => String(x.clientRef) === op.clientRef)
  const stockBefore = stableStringify(world.stock || {})
  const debtBefore = stableStringify(world.debt || {})
  const postsBefore = world.networkPostCount || 0

  const row = (world.queue || []).find(r => r.clientRef === op.clientRef)
  if (!row) return { ok: false, error: 'not_in_queue', session: s, world }

  // crash point
  if (world.crashBeforeAck === op.clientRef) {
    return { ok: false, error: 'CRASH_BEFORE_ACK', resumable: true, session: s, world }
  }

  world.queue = world.queue.filter(r => r.clientRef !== op.clientRef)
  s = appendCheckpoint(s, {
    type: 'ACK_DONE',
    clientRef: op.clientRef,
    seq: op.seq,
  })
  s = persistSessionPatch(s, {
    ackCleanedClientRefs: [...(s.ackCleanedClientRefs || []), op.clientRef],
    status: SESSION_STATUS.ACK_CLEANED,
  })

  if (world.crashAfterAck === op.clientRef) {
    return { ok: false, error: 'CRASH_AFTER_ACK', resumable: true, session: s, world }
  }

  const saleAfter = (world.sales || []).find(x => String(x.clientRef) === op.clientRef)
  const verify = {
    queueDelta: beforeQueue - (world.queue || []).length,
    salePreserved: !saleBefore || !!saleAfter,
    stockUnchanged: stableStringify(world.stock || {}) === stockBefore,
    debtUnchanged: stableStringify(world.debt || {}) === debtBefore,
    networkPostCount: (world.networkPostCount || 0) - postsBefore,
  }
  if (verify.queueDelta !== 1 || !verify.salePreserved || !verify.stockUnchanged || verify.networkPostCount !== 0) {
    return { ok: false, error: 'ack_verify_failed', verify, session: s, world }
  }
  return { ok: true, session: s, world, verify }
}

export function executeShiftRemapBatch(session, rows, world) {
  const pre = assertRecoveryPreconditions({
    isDesktop: world.isDesktop !== false,
    recoveryMode: world.recoveryMode,
    session,
    requireSnapshot: true,
  })
  if (!pre.ok) return { ok: false, ...pre, session, world }

  const target = session.targetServerShiftId
  if (!target) return { ok: false, error: 'missing_targetServerShiftId', session, world }

  let s = session
  const done = []
  for (const plan of rows || []) {
    if (s.remappedClientRefs?.includes(plan.clientRef)) {
      done.push(plan.clientRef)
      continue
    }
    const row = (world.queue || []).find(r => r.clientRef === plan.clientRef)
    if (!row || row.kind !== 'sale') {
      return { ok: false, error: 'row_missing', clientRef: plan.clientRef, session: s, world }
    }
    if (String(row.payload?.shiftId || '') !== String(plan.oldShiftId)) {
      return { ok: false, error: 'shift_mismatch', clientRef: plan.clientRef, session: s, world }
    }
    const beforeFp = businessPayloadFingerprint(row.kind, row.payload)
    s = appendCheckpoint(s, { type: 'REMAP_INTENT', clientRef: plan.clientRef, seq: plan.seq, oldShiftId: plan.oldShiftId })

    if (world.crashAfterRemapCount != null && done.length >= world.crashAfterRemapCount) {
      return { ok: false, error: 'CRASH_DURING_REMAP', resumable: true, session: s, world, done }
    }

    row.payload = {
      ...row.payload,
      shiftId: target,
      recoveryRemappedFrom: plan.oldShiftId,
      recoverySessionId: s.recoverySessionId,
    }
    if (Array.isArray(world.sales)) {
      world.sales = world.sales.map(sale =>
        String(sale.clientRef) === plan.clientRef ? { ...sale, shiftId: target } : sale)
    }
    const afterFp = businessPayloadFingerprint(row.kind, row.payload)
    if (beforeFp !== afterFp) {
      return { ok: false, error: 'fingerprint_changed', clientRef: plan.clientRef, session: s, world }
    }
    s = appendCheckpoint(s, { type: 'REMAP_DONE', clientRef: plan.clientRef, seq: plan.seq, newShiftId: target })
    s = persistSessionPatch(s, {
      remappedClientRefs: [...(s.remappedClientRefs || []), plan.clientRef],
    })
    done.push(plan.clientRef)
  }
  s = persistSessionPatch(s, { status: SESSION_STATUS.REMAPPED })
  return { ok: true, session: s, world, remapped: done.length }
}

/**
 * Send one op via injected adapter. ORIGINAL clientRef only.
 */
async function sendOpViaAdapter(api, row) {
  const kind = row.kind
  if (kind === 'sale' && api.createPosSale) return api.createPosSale({ ...row.payload, clientRef: row.clientRef })
  if (kind === 'stock_receipt_create' && api.createStockReceipt) {
    return api.createStockReceipt({ ...row.payload, clientRef: row.clientRef })
  }
  if (kind === 'debt_repay' && api.createDebtRepay) return api.createDebtRepay({ ...row.payload, clientRef: row.clientRef })
  if (kind === 'cash_advance' && api.createCashAdvance) return api.createCashAdvance({ ...row.payload, clientRef: row.clientRef })
  if (kind === 'card_topup' && api.createCardTopup) return api.createCardTopup({ ...row.payload, clientRef: row.clientRef })
  if (kind === 'finance_move' && api.createFinanceMove) return api.createFinanceMove({ ...row.payload, clientRef: row.clientRef })
  if (kind === 'sale_return' && api.createSaleReturn) return api.createSaleReturn({ ...row.payload, clientRef: row.clientRef })
  if (String(kind).startsWith('stock_writeoff') && api.createStockWriteoff) {
    return api.createStockWriteoff({ ...row.payload, clientRef: row.clientRef, kind })
  }
  if (api.postKind) return api.postKind(kind, { ...row.payload, clientRef: row.clientRef })
  throw new Error(`unsupported_kind_${kind}`)
}

async function verifyCanonical(api, row, serverId) {
  if (!api.getByClientRef) return { ok: true, skipped: true }
  const hit = await api.getByClientRef(row.kind, row.clientRef)
  if (!hit) return { ok: false, error: 'canonical_missing' }
  if (serverId && hit.id && String(hit.id) !== String(serverId)) {
    return { ok: false, error: 'canonical_id_mismatch' }
  }
  const localFp = businessPayloadFingerprint(row.kind, row.payload)
  const remoteFp = hit.fingerprint || (hit.payload
    ? businessPayloadFingerprint(row.kind, hit.payload)
    : null)
  if (remoteFp && remoteFp !== localFp) return { ok: false, error: 'canonical_fp_mismatch' }
  return { ok: true, hit }
}

/**
 * Controlled replay — NOT flushQueue.
 */
export async function executeRecoveryReplay(session, world, api, options = {}) {
  const pre = assertRecoveryPreconditions({
    isDesktop: world.isDesktop !== false,
    recoveryMode: world.recoveryMode,
    session,
    requireSnapshot: true,
    requireClassified: true,
    serverReachable: world.serverReachable !== false,
    requireServer: true,
    revisionRunning: world.revisionRunning,
    globalBlocker: world.globalBlocker,
    expectedDeviceId: world.expectedDeviceId,
    expectedDbIdentity: world.expectedDbIdentity,
    dbReplaced: world.dbReplaced,
  })
  if (!pre.ok) return { ok: false, ...pre, session, world }

  if (session.phase !== RECOVERY_PHASE.REPLAY && !options.allowWithoutFreeze) {
    return { ok: false, error: 'must_enter_replay_freeze', code: 'REFUSE_PHASE', session, world }
  }
  if (!session.targetServerShiftId && options.requireTargetShift !== false) {
    return { ok: false, error: 'missing_targetServerShiftId', session, world }
  }

  let s = persistSessionPatch(session, { status: SESSION_STATUS.REPLAYING })
  const limit = options.limit != null ? options.limit : Infinity
  let processed = 0

  // Reclassify each loop for crash/timeout safety
  while (processed < limit) {
    const { session: s2, classified } = classifyFreshWithDelta(s, world.queue, world.classifyCtx || {})
    s = s2
    world.classified = classified

    const blockers = classified.ops.filter(o =>
      [CLASS.CONFLICT, CLASS.INVALID, CLASS.UNKNOWN].includes(o.classification))
    if (blockers.length && !options.continueOnStopMarkers) {
      // Only stop if a sendable dependency is affected — always stop chain for these
      s = persistSessionPatch(s, {
        status: SESSION_STATUS.ABORTED,
        stoppedReason: `${blockers[0].classification}:${blockers[0].clientRef}`,
      })
      return {
        ok: false,
        code: 'STOP_CHAIN',
        stopped: blockers[0],
        session: s,
        world,
        processed,
      }
    }

    const sendable = classified.ops
      .filter(o => o.classification === CLASS.SAFE_TO_SEND)
      .filter(o => isKindReplaySupported(o.kind))
      .sort((a, b) => {
        const pri = (k) => {
          if (String(k).startsWith('stock_receipt')) return 10
          if (k === 'sale') return 20
          return 30
        }
        const d = pri(a.kind) - pri(b.kind)
        return d !== 0 ? d : (Number(a.seq) || 0) - (Number(b.seq) || 0)
      })

    const unsupported = classified.ops.filter(o =>
      o.classification === CLASS.SAFE_TO_SEND && !isKindReplaySupported(o.kind))
    if (unsupported.length) {
      s = persistSessionPatch(s, {
        status: SESSION_STATUS.ABORTED,
        stoppedReason: `UNSUPPORTED_KIND:${unsupported[0].kind}`,
      })
      return { ok: false, code: 'UNSUPPORTED_KIND', kind: unsupported[0].kind, session: s, world }
    }

    // ACK any exact committed left (timeout-after-commit path)
    const ackPlan = planAckCleanup(classified.ops)
    if (ackPlan.length) {
      const a = ackPlan[0]
      const op = classified.ops.find(o => o.clientRef === a.clientRef)
      const r = executeVerifiedAckCleanup(s, { ...op, ...a }, world)
      s = r.session
      if (!r.ok && !r.resumable) return { ...r, processed }
      if (r.ok) {
        processed += 1
        continue
      }
      if (r.resumable) return { ...r, processed }
    }

    const next = sendable[0]
    if (!next) break

    const row = world.queue.find(r => r.clientRef === next.clientRef)
    if (!row) {
      processed += 1
      continue
    }

    // Force shift on remapped target for sales
    if (row.kind === 'sale' && session.targetServerShiftId) {
      row.payload = { ...row.payload, shiftId: session.targetServerShiftId }
    }

    s = appendCheckpoint(s, {
      type: 'REPLAY_INTENT',
      clientRef: row.clientRef,
      kind: row.kind,
      seq: row.seq,
      fingerprint: next.fingerprint,
    })

    const stockBefore = stableStringify(world.stock || {})
    const debtBefore = stableStringify(world.debt || {})

    let serverId
    try {
      const res = await sendOpViaAdapter(api, row)
      serverId = res?.id || res?.serverId || res
      world.networkPostCount = (world.networkPostCount || 0) + 1
    } catch (e) {
      const msg = String(e?.message || e)
      if (/timeout|CRASH_AFTER_POST|lost_response/i.test(msg)) {
        // reclassify same clientRef — do NOT new ref
        if (api.getByClientRef) {
          const hit = await api.getByClientRef(row.kind, row.clientRef)
          if (hit) {
            world.classifyCtx = world.classifyCtx || {}
            world.classifyCtx.serverByClientRef = new Map(world.classifyCtx.serverByClientRef || [])
            world.classifyCtx.serverByClientRef.set(row.clientRef, {
              id: hit.id,
              fingerprint: hit.fingerprint || businessPayloadFingerprint(row.kind, row.payload),
              kind: row.kind,
              raw: hit.raw || hit,
            })
            s = appendCheckpoint(s, { type: 'TIMEOUT_COMMITTED', clientRef: row.clientRef, serverId: hit.id })
            continue
          }
        }
        s = persistSessionPatch(s, {
          status: SESSION_STATUS.PAUSED,
          stoppedReason: `timeout_unconfirmed:${row.clientRef}`,
        })
        return { ok: false, error: 'timeout_unconfirmed', clientRef: row.clientRef, session: s, world, processed }
      }
      if (/IDEMPOTENCY_KEY_REUSED/i.test(msg)) {
        if (api.getByClientRef) {
          const hit = await api.getByClientRef(row.kind, row.clientRef)
          if (hit) {
            const fp = businessPayloadFingerprint(row.kind, row.payload)
            const remoteFp = hit.fingerprint || businessPayloadFingerprint(row.kind, hit.payload || hit)
            if (remoteFp === fp) {
              world.classifyCtx = world.classifyCtx || {}
              world.classifyCtx.serverByClientRef = new Map(world.classifyCtx.serverByClientRef || [])
              world.classifyCtx.serverByClientRef.set(row.clientRef, {
                id: hit.id,
                fingerprint: fp,
                kind: row.kind,
              })
              continue
            }
            s = persistSessionPatch(s, {
              status: SESSION_STATUS.ABORTED,
              stoppedReason: `CONFLICT:${row.clientRef}`,
            })
            return { ok: false, code: 'CONFLICT', clientRef: row.clientRef, session: s, world }
          }
        }
        s = persistSessionPatch(s, {
          status: SESSION_STATUS.ABORTED,
          stoppedReason: `IDEMPOTENCY_UNRESOLVED:${row.clientRef}`,
        })
        return { ok: false, code: 'CONFLICT', error: msg, session: s, world }
      }
      if (/SHIFT_CLOSED|смена уже закрыта/i.test(msg)) {
        s = persistSessionPatch(s, {
          status: SESSION_STATUS.ABORTED,
          stoppedReason: `SHIFT_CLOSED:${row.clientRef}`,
        })
        return { ok: false, code: 'STOP_CHAIN', error: msg, session: s, world }
      }
      if (/500_before_commit/i.test(msg)) {
        // safe retry same ref
        row.attempts = (row.attempts || 0) + 1
        s = appendCheckpoint(s, { type: 'RETRY_SAME_REF', clientRef: row.clientRef, reason: msg })
        if ((row.attempts || 0) > (options.maxAttempts || 3)) {
          return { ok: false, error: 'max_attempts', session: s, world }
        }
        continue
      }
      if (/500_after_commit/i.test(msg)) {
        if (api.getByClientRef) {
          const hit = await api.getByClientRef(row.kind, row.clientRef)
          if (hit) {
            world.classifyCtx = world.classifyCtx || {}
            world.classifyCtx.serverByClientRef = new Map(world.classifyCtx.serverByClientRef || [])
            world.classifyCtx.serverByClientRef.set(row.clientRef, {
              id: hit.id,
              fingerprint: businessPayloadFingerprint(row.kind, row.payload),
              kind: row.kind,
            })
            continue
          }
        }
        return { ok: false, error: '500_after_commit_unconfirmed', session: s, world }
      }
      return { ok: false, error: msg, session: s, world, processed }
    }

    s = appendCheckpoint(s, {
      type: 'REPLAY_COMMITTED',
      clientRef: row.clientRef,
      kind: row.kind,
      seq: row.seq,
      serverId,
    })

    const ver = await verifyCanonical(api, row, serverId)
    if (!ver.ok) {
      s = persistSessionPatch(s, {
        status: SESSION_STATUS.PAUSED,
        stoppedReason: `verify_failed:${row.clientRef}:${ver.error}`,
      })
      return { ok: false, error: ver.error, session: s, world, processed }
    }

    // appliedLocal: do not touch stock/debt again
    if (row.payload?.appliedLocal) {
      if (stableStringify(world.stock || {}) !== stockBefore) {
        return { ok: false, error: 'stock_double_apply', session: s, world }
      }
      if (stableStringify(world.debt || {}) !== debtBefore) {
        return { ok: false, error: 'debt_double_apply', session: s, world }
      }
    }

    world.queue = world.queue.filter(r => r.clientRef !== row.clientRef)
    s = appendCheckpoint(s, {
      type: 'REPLAY_ACKED',
      clientRef: row.clientRef,
      kind: row.kind,
      seq: row.seq,
      serverId,
    })
    s = persistSessionPatch(s, {
      completedClientRefs: [...(s.completedClientRefs || []), row.clientRef],
      lastCompletedSeq: row.seq,
    })

    if (world.crashAfterAckCount != null && (s.completedClientRefs || []).length >= world.crashAfterAckCount) {
      return { ok: false, error: 'CRASH_AFTER_ACK_BATCH', resumable: true, session: s, world, processed: processed + 1 }
    }

    processed += 1
  }

  return { ok: true, session: s, world, processed }
}

export function verifyPostDrain(session, world, opts = {}) {
  const queue = world.queue || []
  const classified = classifyQueueFresh(queue, world.classifyCtx || {})
  const errors = []
  if (queue.some(r => !r.failed)) errors.push('ready_queue_not_empty')
  const bad = classified.ops.filter(o =>
    [CLASS.UNKNOWN, CLASS.CONFLICT, CLASS.SAFE_TO_SEND].includes(o.classification))
  // failed unresolved replayable
  if (classified.ops.some(o => o.classification === CLASS.SAFE_TO_SEND)) errors.push('replayable_remaining')
  if (classified.ops.some(o => o.classification === CLASS.UNKNOWN || o.classification === CLASS.CONFLICT)) {
    errors.push('unresolved_conflict_or_unknown')
  }
  if (!session.targetServerShiftId) errors.push('missing_target_shift')
  const intents = (session.checkpoints || []).filter(c => c.type === 'REPLAY_INTENT')
  const acked = (session.checkpoints || []).filter(c => c.type === 'REPLAY_ACKED')
  if (intents.length > acked.length + (session.ackCleanedClientRefs || []).length) {
    // allow ACK_DONE for timeout path
    const ackDone = (session.checkpoints || []).filter(c => c.type === 'ACK_DONE').length
    if (intents.length > acked.length + ackDone) errors.push('checkpoint_inconsistent')
  }
  if (opts.requireServerSales && Array.isArray(opts.serverSales)) {
    for (const ref of session.completedClientRefs || []) {
      if (!opts.serverSales.some(s => String(s.clientRef) === ref)) errors.push(`missing_server_sale:${ref}`)
    }
  }
  // duplicate clientRefs on server
  if (opts.serverSales) {
    const seen = new Set()
    for (const s of opts.serverSales) {
      const r = String(s.clientRef || '')
      if (!r) continue
      if (seen.has(r)) errors.push(`duplicate_clientRef:${r}`)
      seen.add(r)
    }
  }
  if (errors.length) {
    return { ok: false, errors, session, pullReady: false }
  }
  const next = persistSessionPatch(session, { status: SESSION_STATUS.PULL_READY })
  return { ok: true, session: next, pullReady: true }
}

/**
 * Controlled pull simulation — projection refresh only.
 * Baseline debts are verification targets, not mutations.
 */
export function executeCanonicalPull(session, world, serverSnapshot) {
  if (session.status !== SESSION_STATUS.PULL_READY && !world.allowPullAnytime) {
    return { ok: false, error: 'pull_forbidden_before_drain', session, world }
  }
  const clients = (serverSnapshot.clients || []).map(c => ({ ...c }))
  world.clients = clients
  world.cards = (serverSnapshot.cards || []).map(c => ({ ...c }))
  world.products = (serverSnapshot.products || []).map(p => ({ ...p }))
  world.stock = { ...(serverSnapshot.stock || {}) }
  world.sales = (serverSnapshot.sales || []).map(s => ({ ...s }))
  world.shifts = (serverSnapshot.shifts || []).map(s => ({ ...s }))
  world.debt = { ...(serverSnapshot.debt || {}) }

  const checks = []
  if (serverSnapshot.verifyDebt) {
    for (const [id, expected] of Object.entries(serverSnapshot.verifyDebt)) {
      const local = world.clients.find(c => String(c.id) === id || String(c.num) === id)
      const got = local ? Number(local.debt) : NaN
      checks.push({ id, expected, got, ok: Math.abs(got - Number(expected)) < 0.001 })
    }
  }
  const allOk = checks.every(c => c.ok)
  const next = persistSessionPatch(session, {
    pullCompleted: true,
    status: allOk ? SESSION_STATUS.COMPLETED : SESSION_STATUS.VERIFYING,
    phase: allOk ? RECOVERY_PHASE.COMPLETE : session.phase,
  })
  return { ok: allOk, session: next, world, checks }
}

export function finalizeGhostShifts(session, world, ghostIds) {
  world.shifts = markGhostShiftsReconciled(world.shifts || [], ghostIds)
  const refsLeft = (world.queue || []).some(r => ghostIds.includes(String(r.payload?.shiftId || '')))
  const salesOnGhost = (world.sales || []).some(s =>
    ghostIds.includes(String(s.shiftId || '')) && !session.completedClientRefs?.includes(s.clientRef))
  // After drain, remapped sales should not reference ghosts
  const next = persistSessionPatch(session, { ghostFinalized: !refsLeft })
  return {
    ok: !refsLeft,
    session: next,
    world,
    queueRefsGhost: refsLeft,
    note: 'no shift_close POST; server already closed; target shift remains open for normal lifecycle',
    targetServerShiftId: session.targetServerShiftId,
    targetRemainsOpen: true,
  }
}

export function canDisableRecovery(session, world = {}) {
  const errors = []
  if ((world.queue || []).some(r => !r.failed)) errors.push('queue_pending')
  if ((world.queue || []).length > 0) {
    // allow only non-replayable hard-failed? still refuse if any remain
    errors.push('queue_not_empty')
  }
  if (!session.pullCompleted) errors.push('pull_not_completed')
  if (session.status !== SESSION_STATUS.COMPLETED && session.phase !== RECOVERY_PHASE.COMPLETE) {
    errors.push('session_not_completed')
  }
  if (session.stoppedReason && session.status === SESSION_STATUS.ABORTED) errors.push('aborted')
  if (!session.ghostFinalized && world.requireGhostFinalized !== false) {
    // soft: only if ghosts were present
    if ((world.ghostIds || []).length) errors.push('ghost_not_finalized')
  }
  if ([CLASS.CONFLICT, CLASS.UNKNOWN].some(c =>
    (session.classificationCounts || {})[c] > 0 && session.status === SESSION_STATUS.ABORTED)) {
    errors.push('unresolved_conflict')
  }
  if (errors.length) return { ok: false, errors }
  return { ok: true }
}

/**
 * Upgrade first-boot: meta.recoveryMode / recoveryRequiredAfterUpgrade → zero POST.
 */
export function simulateUpgradeFirstBoot(world) {
  const meta = world.meta || {}
  let gateReady = false
  let recoveryActive = false
  const posts = []

  // Fail-closed before gate ready
  const blockingBeforeReady = () => !gateReady || recoveryActive

  // Load meta (as ensureRecoveryGateReady)
  if (meta.recoveryRequiredAfterUpgrade && !meta.recoveryCompleted) {
    recoveryActive = true
    meta.recoveryMode = true
  }
  if (meta.recoveryMode === true || meta.recoveryMode === 'true' || meta.recoveryMode === 1) {
    recoveryActive = true
  }
  gateReady = true

  const tryFlush = () => {
    if (blockingBeforeReady() || recoveryActive) {
      return { skipped: true, code: 'SKIPPED_RECOVERY_MODE' }
    }
    posts.push('flush')
    return { skipped: false }
  }

  const r1 = tryFlush()
  const queueBefore = (world.queue || []).map(r => r.clientRef).join(',')
  const r2 = tryFlush()
  const queueAfter = (world.queue || []).map(r => r.clientRef).join(',')

  return {
    recoveryActive,
    gateReady,
    flushAttempts: 2,
    skipped: r1.skipped && r2.skipped,
    posts: posts.length,
    queueUnchanged: queueBefore === queueAfter,
    banner: recoveryActive,
  }
}

/** In-memory mock API for tests */
export function createMockRecoveryApi(opts = {}) {
  const state = {
    shifts: [],
    sales: [],
    receipts: [],
    byRef: new Map(),
    posts: 0,
    failMode: opts.failMode || null, // per clientRef map or global
    failModes: opts.failModes || {},
  }

  const api = {
    state,
    listOpenShifts: async () => state.shifts.filter(s => s.status === 'open'),
    getShiftByClientRef: async (clientRef) => state.shifts.find(s => s.clientRef === clientRef),
    openPosShift: async (data) => {
      state.posts += 1
      const existing = state.shifts.find(s => s.clientRef === data.clientRef)
      if (existing) return existing
      const open = state.shifts.filter(s => s.status === 'open')
      if (open.length && !opts.allowMultiOpen) {
        throw new Error('На этой точке продаж уже открыта сессия')
      }
      if (state.failModes[data.clientRef] === 'timeout_after_commit') {
        const row = {
          id: `SHIFT-rec-${state.shifts.length + 1}`,
          clientRef: data.clientRef,
          status: 'open',
          cashierId: data.cashierId,
          posId: data.posId || 'POS-1',
          note: data.note,
        }
        state.shifts.push(row)
        state.byRef.set(data.clientRef, { kind: 'shift_open', ...row })
        delete state.failModes[data.clientRef]
        throw new Error('timeout')
      }
      const row = {
        id: `SHIFT-rec-${state.shifts.length + 1}`,
        clientRef: data.clientRef,
        status: 'open',
        cashierId: data.cashierId,
        posId: data.posId || 'POS-1',
        note: data.note,
      }
      state.shifts.push(row)
      return row
    },
    createPosSale: async (payload) => {
      state.posts += 1
      const ref = payload.clientRef
      const mode = state.failModes[ref] || state.failMode
      const fp = businessPayloadFingerprint('sale', payload)
      if (mode === 'timeout_after_commit' || mode === 'lost_response') {
        const row = { id: `SALE-${state.sales.length + 1}`, clientRef: ref, fingerprint: fp, payload, shiftId: payload.shiftId }
        state.sales.push(row)
        state.byRef.set(ref, { kind: 'sale', ...row })
        delete state.failModes[ref]
        throw new Error(mode === 'lost_response' ? 'lost_response' : 'timeout')
      }
      if (mode === '500_before_commit') {
        delete state.failModes[ref]
        throw new Error('500_before_commit')
      }
      if (mode === '500_after_commit') {
        const row = { id: `SALE-${state.sales.length + 1}`, clientRef: ref, fingerprint: fp, payload, shiftId: payload.shiftId }
        state.sales.push(row)
        state.byRef.set(ref, { kind: 'sale', ...row })
        delete state.failModes[ref]
        throw new Error('500_after_commit')
      }
      if (mode === 'SHIFT_CLOSED') {
        throw new Error('SHIFT_CLOSED')
      }
      const existing = state.byRef.get(ref)
      if (existing && existing.kind === 'sale') {
        if (existing.fingerprint !== fp) throw new Error('IDEMPOTENCY_KEY_REUSED different payload')
        throw new Error('IDEMPOTENCY_KEY_REUSED')
      }
      const row = { id: `SALE-${state.sales.length + 1}`, clientRef: ref, fingerprint: fp, payload, shiftId: payload.shiftId }
      state.sales.push(row)
      state.byRef.set(ref, { kind: 'sale', ...row })
      return row
    },
    createStockReceipt: async (payload) => {
      state.posts += 1
      const ref = payload.clientRef
      const fp = businessPayloadFingerprint('stock_receipt_create', payload)
      const mode = state.failModes[ref]
      if (mode === 'timeout_after_commit') {
        const row = { id: `RCP-${state.receipts.length + 1}`, clientRef: ref, fingerprint: fp, payload }
        state.receipts.push(row)
        state.byRef.set(ref, { kind: 'stock_receipt_create', ...row })
        delete state.failModes[ref]
        throw new Error('timeout')
      }
      const existing = state.byRef.get(ref)
      if (existing) {
        if (existing.fingerprint !== fp) throw new Error('IDEMPOTENCY_KEY_REUSED different')
        throw new Error('IDEMPOTENCY_KEY_REUSED')
      }
      const row = { id: `RCP-${state.receipts.length + 1}`, clientRef: ref, fingerprint: fp, payload }
      state.receipts.push(row)
      state.byRef.set(ref, { kind: 'stock_receipt_create', ...row })
      return row
    },
    createDebtRepay: async (payload) => {
      state.posts += 1
      const ref = payload.clientRef
      const row = { id: `DR-${ref}`, clientRef: ref, payload }
      state.byRef.set(ref, { kind: 'debt_repay', ...row, fingerprint: businessPayloadFingerprint('debt_repay', payload) })
      return row
    },
    createCashAdvance: async (payload) => {
      state.posts += 1
      const ref = payload.clientRef
      const row = { id: `CA-${ref}`, clientRef: ref, payload }
      state.byRef.set(ref, { kind: 'cash_advance', ...row, fingerprint: businessPayloadFingerprint('cash_advance', payload) })
      return row
    },
    createCardTopup: async (payload) => {
      state.posts += 1
      const ref = payload.clientRef
      const row = { id: `CT-${ref}`, clientRef: ref, payload }
      state.byRef.set(ref, { kind: 'card_topup', ...row, fingerprint: businessPayloadFingerprint('card_topup', payload) })
      return row
    },
    createFinanceMove: async (payload) => {
      state.posts += 1
      const ref = payload.clientRef
      const row = { id: `FM-${ref}`, clientRef: ref, payload }
      state.byRef.set(ref, { kind: 'finance_move', ...row, fingerprint: businessPayloadFingerprint('finance_move', payload) })
      return row
    },
    createSaleReturn: async (payload) => {
      state.posts += 1
      const ref = payload.clientRef
      const row = { id: `RET-${ref}`, clientRef: ref, payload }
      state.byRef.set(ref, { kind: 'sale_return', ...row, fingerprint: businessPayloadFingerprint('sale_return', payload) })
      return row
    },
    createStockWriteoff: async (payload) => {
      state.posts += 1
      const ref = payload.clientRef
      const kind = payload.kind || 'stock_writeoff_create'
      const row = { id: `WO-${ref}`, clientRef: ref, payload }
      state.byRef.set(ref, { kind, ...row, fingerprint: businessPayloadFingerprint(kind, payload) })
      return row
    },
    postKind: async (kind, payload) => {
      state.posts += 1
      const ref = payload.clientRef
      const row = { id: `X-${ref}`, clientRef: ref, payload }
      state.byRef.set(ref, { kind, ...row, fingerprint: businessPayloadFingerprint(kind, payload) })
      return row
    },
    getByClientRef: async (kind, clientRef) => {
      const hit = state.byRef.get(clientRef)
      if (!hit) return null
      if (kind && hit.kind !== kind && !(kind === 'sale' && hit.kind === 'sale')) return null
      return hit
    },
  }
  return api
}
