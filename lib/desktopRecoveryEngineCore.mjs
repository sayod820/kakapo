/**
 * PC-2 — Desktop Recovery Engine (pure core, Node-testable).
 * No network. No production SQLite. Disposable fixtures only.
 */
import { createHash } from 'node:crypto'

export const RECOVERY_SHIFT_PREFIX = 'off-recovery-'
export const REFUSE_RECOVERY_OFF = 'REFUSE_TO_RUN_RECOVERY_MODE_OFF'

export const CLASS = {
  SAFE_TO_SEND: 'SAFE_TO_SEND',
  ALREADY_COMMITTED_SERVER: 'ALREADY_COMMITTED_SERVER',
  CONFLICT: 'CONFLICT',
  DEPENDENCY_BLOCKED: 'DEPENDENCY_BLOCKED',
  INVALID: 'INVALID',
  UNKNOWN: 'UNKNOWN',
}

/** Shift lifecycle for Desktop recovery / reconnect */
export const SHIFT_STATE = {
  ONLINE_CANONICAL_OPEN: 'ONLINE_CANONICAL_OPEN',
  OFFLINE_LOCALLY_OPEN: 'OFFLINE_LOCALLY_OPEN',
  RECOVERY_PENDING: 'RECOVERY_PENDING',
  RECONCILED_CLOSED: 'RECONCILED_CLOSED',
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function stableStringify(v) {
  if (v == null) return 'null'
  if (typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  const keys = Object.keys(v).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`
}

/** Immutable business fingerprint for sale-like ops (excludes shiftId / local-only fields). */
export function businessPayloadFingerprint(kind, payload) {
  const p = payload && typeof payload === 'object' ? payload : {}
  const items = Array.isArray(p.items)
    ? p.items.map(it => ({
      productId: it.productId,
      qty: round2(it.qty),
      weightKg: it.weightKg != null ? round2(it.weightKg) : undefined,
      price: round2(it.price),
      discount: round2(it.discount),
      name: it.name != null ? String(it.name) : undefined,
    }))
    : []
  const core = {
    kind: String(kind || ''),
    items,
    paidCash: round2(p.paidCash),
    paidCard: round2(p.paidCard),
    paidWallet: round2(p.paidWallet),
    debtAdded: round2(p.debtAdded),
    bonusSpent: Math.floor(Number(p.bonusSpent) || 0),
    clientId: p.clientId != null ? String(p.clientId) : '',
    cardNum: p.num != null ? String(p.num) : (p.cardNum != null ? String(p.cardNum) : ''),
    total: p.total != null ? round2(p.total) : undefined,
    amount: p.amount != null ? round2(p.amount) : undefined,
    cash: p.cash != null ? round2(p.cash) : undefined,
    credit: p.credit != null ? round2(p.credit) : undefined,
    type: p.type != null ? String(p.type) : undefined,
    supplierId: p.supplierId != null ? String(p.supplierId) : undefined,
  }
  return createHash('sha256').update(stableStringify(core)).digest('hex')
}

export function fingerprintSaleServerRow(sale) {
  return businessPayloadFingerprint('sale', {
    items: sale?.items,
    paidCash: sale?.paidCash,
    paidCard: sale?.paidCard,
    paidWallet: sale?.paidWallet,
    debtAdded: sale?.debtAdded,
    bonusSpent: sale?.bonusSpent,
    clientId: sale?.clientId,
    num: sale?.cardNum || sale?.num,
    total: sale?.total,
  })
}

export function newRecoverySessionId(now = new Date()) {
  const t = now.toISOString().replace(/[:.]/g, '-')
  const rnd = Math.random().toString(36).slice(2, 8)
  return `RS-${t}-${rnd}`
}

export function recoveryShiftId(sessionId) {
  return `${RECOVERY_SHIFT_PREFIX}${String(sessionId || '').trim()}`
}

export function isRecoveryShiftId(id) {
  return String(id || '').startsWith(RECOVERY_SHIFT_PREFIX)
}

export function isOffShiftId(id) {
  return String(id || '').startsWith('off-')
}

/**
 * Classify local shift vs server open/closed set.
 * serverOpenIds / serverClosedIds / reconciledLocalIds are Sets of shift ids.
 */
export function classifyLocalShiftState(localShift, ctx = {}) {
  const id = String(localShift?.id || '')
  const status = String(localShift?.status || '')
  const note = String(localShift?.note || '')
  if (status === 'closed' || /reconcile:|RECONCILED/i.test(note) || (ctx.reconciledLocalIds || new Set()).has(id)) {
    return SHIFT_STATE.RECONCILED_CLOSED
  }
  if (isRecoveryShiftId(id)) return SHIFT_STATE.OFFLINE_LOCALLY_OPEN
  const serverOpen = ctx.serverOpenIds || new Set()
  const serverClosed = ctx.serverClosedIds || new Set()
  if (serverOpen.has(id)) return SHIFT_STATE.ONLINE_CANONICAL_OPEN
  if (status === 'open' && serverClosed.has(id)) return SHIFT_STATE.RECOVERY_PENDING
  if (status === 'open' && isOffShiftId(id)) return SHIFT_STATE.OFFLINE_LOCALLY_OPEN
  if (status === 'open') return SHIFT_STATE.OFFLINE_LOCALLY_OPEN
  return SHIFT_STATE.RECONCILED_CLOSED
}

/**
 * During recovery: never attach NEW sales to RECOVERY_PENDING (ghost) shifts.
 * Prefer recovery local shift, else OFFLINE_LOCALLY_OPEN off-*, else null.
 */
export function pickSaleTargetShift(shifts, opts = {}) {
  const list = shifts || []
  const ctx = {
    serverOpenIds: opts.serverOpenIds || new Set(),
    serverClosedIds: opts.serverClosedIds || new Set(),
    reconciledLocalIds: opts.reconciledLocalIds || new Set(),
  }
  const recoveryId = opts.recoveryShiftId ? String(opts.recoveryShiftId) : ''
  if (recoveryId) {
    const hit = list.find(s => String(s.id) === recoveryId && String(s.status) === 'open')
    if (hit) return hit
  }
  const open = list.filter(s => String(s.status) === 'open')
  const ranked = []
  for (const s of open) {
    const st = classifyLocalShiftState(s, ctx)
    if (st === SHIFT_STATE.RECOVERY_PENDING || st === SHIFT_STATE.RECONCILED_CLOSED) continue
    if (st === SHIFT_STATE.ONLINE_CANONICAL_OPEN) ranked.push({ s, p: 1 })
    else if (isRecoveryShiftId(s.id)) ranked.push({ s, p: 0 })
    else if (st === SHIFT_STATE.OFFLINE_LOCALLY_OPEN) ranked.push({ s, p: 2 })
  }
  ranked.sort((a, b) => a.p - b.p)
  return ranked[0]?.s || null
}

/**
 * Fresh classify one queue op against optional server index.
 * serverByClientRef: Map clientRef → { id, kind?, fingerprint?, raw? }
 * serverShiftById: Map shiftId → { status }
 */
export function classifyPendingOpFresh(row, ctx = {}) {
  const kind = String(row?.kind || '')
  const clientRef = String(row?.clientRef || '').trim()
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {}
  if (!clientRef) {
    return { classification: CLASS.INVALID, reason: 'missing clientRef', fingerprint: null }
  }
  const fp = businessPayloadFingerprint(kind, payload)
  const serverHit = ctx.serverByClientRef?.get(clientRef)

  if (serverHit) {
    const serverFp = serverHit.fingerprint
      || (serverHit.raw ? fingerprintSaleServerRow(serverHit.raw) : null)
      || (serverHit.payload ? businessPayloadFingerprint(kind, serverHit.payload) : null)
    if (serverHit.kind && String(serverHit.kind) !== kind && kind !== 'sale') {
      return {
        classification: CLASS.CONFLICT,
        reason: `clientRef used for different kind server=${serverHit.kind} local=${kind}`,
        fingerprint: fp,
        serverId: serverHit.id,
      }
    }
    if (!serverFp) {
      // Same clientRef alone is NEVER enough for ACK — need semantic proof
      return {
        classification: CLASS.UNKNOWN,
        reason: 'server clientRef hit but business fingerprint unavailable',
        fingerprint: fp,
        serverId: serverHit.id,
        ackEligible: false,
      }
    }
    if (serverFp !== fp) {
      return {
        classification: CLASS.CONFLICT,
        reason: 'same clientRef different business fingerprint',
        fingerprint: fp,
        serverId: serverHit.id,
        serverFingerprint: serverFp,
        ackEligible: false,
      }
    }
    return {
      classification: CLASS.ALREADY_COMMITTED_SERVER,
      reason: 'exact semantic match',
      fingerprint: fp,
      serverId: serverHit.id,
      serverFingerprint: serverFp,
      ackEligible: true,
    }
  }

  if (row.failed) {
    const err = String(row.lastError || '')
    if (/IDEMPOTENCY_KEY_REUSED/i.test(err)) {
      return {
        classification: CLASS.CONFLICT,
        reason: err.slice(0, 160),
        fingerprint: fp,
        ackEligible: false,
      }
    }
    if (/SHIFT_CLOSED|смена уже закрыта|SHIFT_NOT_FOUND|смена не найдена/i.test(err)) {
      return { classification: CLASS.DEPENDENCY_BLOCKED, reason: err.slice(0, 160), fingerprint: fp }
    }
    if (/не найден|BrokenRef|ждём|синтетический/i.test(err)) {
      return { classification: CLASS.DEPENDENCY_BLOCKED, reason: err.slice(0, 160), fingerprint: fp }
    }
    return { classification: CLASS.INVALID, reason: err.slice(0, 160) || 'failed', fingerprint: fp }
  }

  const shiftId = String(payload.shiftId || '')
  if (shiftId && ctx.serverShiftById) {
    const sh = ctx.serverShiftById.get(shiftId)
    if (sh && String(sh.status) !== 'open') {
      return {
        classification: CLASS.DEPENDENCY_BLOCKED,
        reason: `shift ${shiftId} status=${sh.status} on server`,
        fingerprint: fp,
        shiftId,
        needsRemap: true,
      }
    }
  }
  if (shiftId && (ctx.serverClosedIds || new Set()).has(shiftId)) {
    return {
      classification: CLASS.DEPENDENCY_BLOCKED,
      reason: `shift ${shiftId} closed on server`,
      fingerprint: fp,
      shiftId,
      needsRemap: true,
    }
  }

  if (kind === 'debt_repay' && String(payload.orderId || '').startsWith('cash-')) {
    return {
      classification: CLASS.DEPENDENCY_BLOCKED,
      reason: 'synthetic cash-* orderId waits CA ack',
      fingerprint: fp,
    }
  }

  return { classification: CLASS.SAFE_TO_SEND, reason: 'no server match; refs ok', fingerprint: fp }
}

export function classifyQueueFresh(queueRows, ctx = {}) {
  const out = []
  const summary = {
    SAFE_TO_SEND: 0,
    ALREADY_COMMITTED_SERVER: 0,
    CONFLICT: 0,
    DEPENDENCY_BLOCKED: 0,
    INVALID: 0,
    UNKNOWN: 0,
  }
  for (const row of queueRows || []) {
    const c = classifyPendingOpFresh(row, ctx)
    summary[c.classification] = (summary[c.classification] || 0) + 1
    out.push({
      seq: row.seq,
      kind: row.kind,
      clientRef: row.clientRef,
      localId: row.localId,
      createdAtIso: row.createdAtIso,
      failed: !!row.failed,
      lastError: row.lastError,
      shiftId: row.payload?.shiftId,
      appliedLocal: !!(row.payload?.appliedLocal || row.appliedLocal),
      ...c,
    })
  }
  return { ops: out, summary, total: out.length }
}

/** ACK eligible only when exact semantic match proven */
export function planAckCleanup(classifiedOps) {
  return (classifiedOps || [])
    .filter(o => o.classification === CLASS.ALREADY_COMMITTED_SERVER && o.ackEligible === true && o.serverId)
    .map(o => ({
      clientRef: o.clientRef,
      kind: o.kind,
      seq: o.seq,
      expectedServerId: o.serverId,
      fingerprint: o.fingerprint,
      serverFingerprint: o.serverFingerprint,
    }))
}

/**
 * Build remap plan for dependency-blocked sales on closed shifts.
 * targetShiftId must be EXPLICIT — never heuristic nearest.
 */
export function planShiftRemaps(classifiedOps, opts = {}) {
  const target = String(opts.plannedTargetShiftId || '').trim()
  if (!target) {
    return { ok: false, error: 'plannedTargetShiftId_required', rows: [] }
  }
  const rows = []
  for (const o of classifiedOps || []) {
    if (o.kind !== 'sale') continue
    if (!(o.needsRemap || o.classification === CLASS.DEPENDENCY_BLOCKED)) continue
    const oldId = String(o.shiftId || '')
    if (!oldId || oldId === target) continue
    rows.push({
      clientRef: o.clientRef,
      seq: o.seq,
      localId: o.localId,
      oldShiftId: oldId,
      plannedTargetShiftId: target,
      fingerprint: o.fingerprint,
      createdAt: o.createdAtIso,
      classification: o.classification,
    })
  }
  return { ok: true, rows, plannedTargetShiftId: target }
}

/**
 * Deterministic dependency-ordered recovery steps (plan only).
 * Kinds unknown stay as STOP markers.
 */
export function buildRecoveryReplayOrder(classifiedOps, opts = {}) {
  const ack = planAckCleanup(classifiedOps)
  const remaps = opts.remapPlanRows || []
  const priority = (kind) => {
    if (['supplier_upsert', 'product_upsert', 'category_upsert', 'client_upsert'].includes(kind)) return 10
    if (kind === 'shift_close') return 20
    if (kind === 'shift_open') return 30
    if (String(kind).startsWith('stock_receipt') || String(kind).startsWith('stock_layer')) return 40
    if (String(kind).startsWith('stock_writeoff')) return 50
    if (['sale', 'sale_return', 'debt_repay', 'cash_advance', 'card_topup'].includes(kind)) return 60
    if (String(kind).startsWith('finance') || String(kind).startsWith('expense') || String(kind).startsWith('vault')) return 70
    if (String(kind).startsWith('stock_revision')) return 90
    return 80
  }

  const steps = []
  steps.push({ type: 'REQUIRE_RECOVERY_MODE' })
  steps.push({ type: 'SNAPSHOT' })
  steps.push({ type: 'CLASSIFY' })

  for (const a of ack) {
    steps.push({ type: 'ACK_CLEANUP', ...a })
  }
  if (opts.plannedTargetShiftId) {
    steps.push({
      type: 'ENSURE_CANONICAL_SHIFT_MAPPING',
      plannedTargetShiftId: opts.plannedTargetShiftId,
      note: 'future: open server recovery shift then bind — PC-2 plans only',
    })
  }
  for (const r of remaps) {
    steps.push({ type: 'SHIFT_REMAP', ...r })
  }

  const sendable = (classifiedOps || [])
    .filter(o => o.classification === CLASS.SAFE_TO_SEND
      || (o.classification === CLASS.DEPENDENCY_BLOCKED && o.needsRemap && opts.plannedTargetShiftId))
    .slice()
    .sort((a, b) => {
      const pa = priority(a.kind) - priority(b.kind)
      if (pa !== 0) return pa
      return (Number(a.seq) || 0) - (Number(b.seq) || 0)
    })

  for (const o of sendable) {
    if (o.classification === CLASS.DEPENDENCY_BLOCKED && o.needsRemap && !opts.plannedTargetShiftId) {
      steps.push({ type: 'STOP_CHAIN', clientRef: o.clientRef, reason: 'needs remap target', kind: o.kind, seq: o.seq })
      continue
    }
    steps.push({
      type: 'REPLAY_OP',
      clientRef: o.clientRef,
      kind: o.kind,
      seq: o.seq,
      fingerprint: o.fingerprint,
    })
  }

  for (const o of classifiedOps || []) {
    if ([CLASS.CONFLICT, CLASS.INVALID, CLASS.UNKNOWN].includes(o.classification)) {
      if (o.classification === CLASS.ALREADY_COMMITTED_SERVER) continue
      if (o.ackEligible) continue
      steps.push({
        type: 'STOP_CHAIN',
        clientRef: o.clientRef,
        kind: o.kind,
        seq: o.seq,
        classification: o.classification,
        reason: o.reason,
      })
    }
  }

  steps.push({ type: 'VERIFY' })
  steps.push({ type: 'PULL_AFTER_DRAIN' })
  return steps
}

/**
 * In-memory recovery session state machine for crash resume.
 */
export function createRecoverySession(input = {}) {
  const sessionId = input.sessionId || newRecoverySessionId()
  return {
    sessionId,
    recoveryModeRequired: true,
    createdAtIso: input.createdAtIso || new Date().toISOString(),
    status: 'open',
    checkpoint: null,
    completedClientRefs: [],
    remappedClientRefs: [],
    ackCleanedClientRefs: [],
    plannedTargetShiftId: input.plannedTargetShiftId || null,
    recoveryShiftId: recoveryShiftId(sessionId),
    snapshotManifest: input.snapshotManifest || null,
    audit: [],
  }
}

export function assertRecoveryModeOn(recoveryMode) {
  if (!recoveryMode) {
    return { ok: false, code: REFUSE_RECOVERY_OFF, error: 'recoveryMode must be true' }
  }
  return { ok: true }
}

/**
 * Apply one dry-run / in-memory step. Mutates session + working copies.
 * networkPostCount must stay 0 for ACK/REMAP/CLASSIFY/SNAPSHOT.
 */
export function applyRecoveryStepDry(session, step, world) {
  const gate = assertRecoveryModeOn(world.recoveryMode)
  if (!gate.ok) return { ok: false, ...gate, session, world }

  const w = world
  const s = session
  const audit = (action, before, after, reason) => {
    s.audit.push({
      ts: new Date().toISOString(),
      action,
      clientRef: step.clientRef,
      kind: step.kind,
      before,
      after,
      reason,
    })
  }

  switch (step.type) {
    case 'REQUIRE_RECOVERY_MODE':
      return { ok: true, session: s, world: w }
    case 'SNAPSHOT': {
      s.snapshotManifest = w.snapshotManifest || s.snapshotManifest
      s.checkpoint = { type: 'SNAPSHOT', at: new Date().toISOString() }
      return { ok: true, session: s, world: w }
    }
    case 'CLASSIFY': {
      const classified = classifyQueueFresh(w.queue, w.classifyCtx || {})
      w.classified = classified
      s.checkpoint = { type: 'CLASSIFY', total: classified.total }
      return { ok: true, session: s, world: w, classified }
    }
    case 'ACK_CLEANUP': {
      const before = w.queue.find(r => r.clientRef === step.clientRef)
      if (!before) return { ok: false, error: 'not_in_queue', session: s, world: w }
      // Semantic re-check
      const c = classifyPendingOpFresh(before, w.classifyCtx || {})
      if (c.classification !== CLASS.ALREADY_COMMITTED_SERVER || !c.ackEligible) {
        return { ok: false, error: 'not_ack_eligible', classification: c.classification, session: s, world: w }
      }
      w.queue = w.queue.filter(r => r.clientRef !== step.clientRef)
      s.ackCleanedClientRefs.push(step.clientRef)
      s.checkpoint = { type: 'ACK_CLEANUP', clientRef: step.clientRef, serverId: step.expectedServerId }
      audit('ACK_CLEANUP', { seq: before.seq, kind: before.kind }, { removed: true, serverId: step.expectedServerId }, 'exact_match')
      w.networkPostCount = w.networkPostCount || 0
      return { ok: true, session: s, world: w }
    }
    case 'SHIFT_REMAP': {
      const row = w.queue.find(r => r.clientRef === step.clientRef)
      if (!row) return { ok: false, error: 'not_in_queue', session: s, world: w }
      const oldId = String(row.payload?.shiftId || '')
      if (oldId !== String(step.oldShiftId)) {
        return { ok: false, error: 'shift_mismatch', session: s, world: w }
      }
      const beforeFp = businessPayloadFingerprint(row.kind, row.payload)
      row.payload = { ...row.payload, shiftId: step.plannedTargetShiftId }
      // sales projection
      if (Array.isArray(w.sales)) {
        w.sales = w.sales.map(sale => {
          if (String(sale.clientRef || '') === step.clientRef) {
            return { ...sale, shiftId: step.plannedTargetShiftId }
          }
          return sale
        })
      }
      const afterFp = businessPayloadFingerprint(row.kind, row.payload)
      if (beforeFp !== afterFp) {
        return { ok: false, error: 'fingerprint_changed', session: s, world: w }
      }
      s.remappedClientRefs.push(step.clientRef)
      s.checkpoint = { type: 'SHIFT_REMAP', clientRef: step.clientRef, newShiftId: step.plannedTargetShiftId }
      audit('SHIFT_REMAP', { shiftId: oldId, seq: row.seq }, { shiftId: step.plannedTargetShiftId, seq: row.seq }, 'explicit')
      return { ok: true, session: s, world: w }
    }
    case 'ENSURE_CANONICAL_SHIFT_MAPPING': {
      s.plannedTargetShiftId = step.plannedTargetShiftId
      s.checkpoint = { type: 'ENSURE_CANONICAL_SHIFT_MAPPING', plannedTargetShiftId: step.plannedTargetShiftId }
      return { ok: true, session: s, world: w, deferredServerOpen: true }
    }
    case 'REPLAY_OP': {
      // Dry-run: simulate server accept + local ACK without real POST unless world.allowSimulatedPost
      if (!w.allowSimulatedPost) {
        s.checkpoint = { type: 'REPLAY_OP_PLANNED', clientRef: step.clientRef }
        return { ok: true, session: s, world: w, plannedOnly: true }
      }
      const row = w.queue.find(r => r.clientRef === step.clientRef)
      if (!row) {
        // already done
        return { ok: true, session: s, world: w, alreadyDone: true }
      }
      w.networkPostCount = (w.networkPostCount || 0) + 1
      const serverId = `SALE-sim-${step.seq || step.clientRef}`
      // timeout-after-commit simulation
      if (w.crashAfterPost === step.clientRef) {
        w.serverCommitted = w.serverCommitted || new Map()
        w.serverCommitted.set(step.clientRef, {
          id: serverId,
          fingerprint: businessPayloadFingerprint(row.kind, row.payload),
          kind: row.kind,
        })
        s.checkpoint = { type: 'POST_SENT_NO_ACK', clientRef: step.clientRef, serverId }
        return { ok: false, error: 'CRASH_AFTER_POST', session: s, world: w, resumable: true }
      }
      w.serverCommitted = w.serverCommitted || new Map()
      w.serverCommitted.set(step.clientRef, {
        id: serverId,
        fingerprint: businessPayloadFingerprint(row.kind, row.payload),
        kind: row.kind,
      })
      // appliedLocal sales: do NOT decrement stock again
      if (row.payload?.appliedLocal && Array.isArray(w.stockEffects)) {
        // no-op stock
      }
      w.queue = w.queue.filter(r => r.clientRef !== step.clientRef)
      s.completedClientRefs.push(step.clientRef)
      s.checkpoint = { type: 'REPLAY_ACKED', clientRef: step.clientRef, serverId }
      if (w.crashAfterAckCount != null && s.completedClientRefs.length >= w.crashAfterAckCount) {
        return { ok: false, error: 'CRASH_AFTER_ACK_BATCH', session: s, world: w, resumable: true }
      }
      return { ok: true, session: s, world: w, serverId }
    }
    case 'STOP_CHAIN':
      s.checkpoint = { type: 'STOP_CHAIN', clientRef: step.clientRef, reason: step.reason }
      return { ok: true, session: s, world: w, stopped: true }
    case 'VERIFY':
      s.checkpoint = { type: 'VERIFY', queueLeft: (w.queue || []).length }
      return { ok: true, session: s, world: w }
    case 'PULL_AFTER_DRAIN':
      if ((w.queue || []).some(r => !r.failed)) {
        return { ok: false, error: 'queue_not_drained', session: s, world: w }
      }
      s.checkpoint = { type: 'PULL_AFTER_DRAIN' }
      return { ok: true, session: s, world: w }
    default:
      return { ok: false, error: `unknown_step_${step.type}`, session: s, world: w }
  }
}

/** Resume after crash: reclassify and skip completed ACKs / remaps. */
export function resumeRecoverySession(session, world) {
  const gate = assertRecoveryModeOn(world.recoveryMode)
  if (!gate.ok) return { ok: false, ...gate }

  // Rebuild classify ctx including serverCommitted from prior posts
  const serverByClientRef = new Map(world.classifyCtx?.serverByClientRef || [])
  for (const [ref, hit] of (world.serverCommitted || new Map()).entries()) {
    serverByClientRef.set(ref, hit)
  }
  world.classifyCtx = { ...(world.classifyCtx || {}), serverByClientRef }
  const classified = classifyQueueFresh(world.queue, world.classifyCtx)
  world.classified = classified

  // Auto ACK exact committed left in queue
  const ackPlan = planAckCleanup(classified.ops)
  return { ok: true, session, world, classified, ackPlan }
}

export function markGhostShiftsReconciled(shifts, ghostIds, closedAtIso = new Date().toISOString()) {
  const set = new Set((ghostIds || []).map(String))
  return (shifts || []).map(sh => {
    if (!set.has(String(sh.id))) return sh
    if (String(sh.status) !== 'open') return sh
    return {
      ...sh,
      status: 'closed',
      closedAtIso,
      note: [String(sh.note || '').trim(), 'reconcile:RECONCILED_CLOSED_GHOST']
        .filter(Boolean)
        .join(' | '),
      recoveryState: SHIFT_STATE.RECONCILED_CLOSED,
    }
  })
}

export function ensureLocalRecoveryShift(shifts, session, meta = {}) {
  const id = recoveryShiftId(session.sessionId)
  if ((shifts || []).some(s => String(s.id) === id)) {
    return { shifts, shiftId: id, created: false }
  }
  const shift = {
    id,
    posId: meta.posId || 'POS-DEFAULT',
    cashierId: meta.cashierId || '',
    cashierName: meta.cashierName || 'Recovery',
    openedAtIso: new Date().toISOString(),
    openingCash: 0,
    salesCash: 0,
    salesCard: 0,
    salesCredit: 0,
    salesCount: 0,
    status: 'open',
    note: `recoverySession:${session.sessionId}`,
    clientRef: `recovery-shift-${session.sessionId}`,
    recoveryState: SHIFT_STATE.OFFLINE_LOCALLY_OPEN,
  }
  return { shifts: [shift, ...(shifts || [])], shiftId: id, created: true }
}

/** Snapshot manifest shape (files hashed by caller). */
export function buildSnapshotManifest(meta = {}) {
  return {
    recoverySessionId: meta.recoverySessionId,
    timestamp: meta.timestamp || new Date().toISOString(),
    deviceId: meta.deviceId || null,
    queueSeq: meta.queueSeq ?? null,
    syncCursor: meta.syncCursor ?? null,
    files: meta.files || [],
    queueExportSha256: meta.queueExportSha256 || null,
    shiftsExportSha256: meta.shiftsExportSha256 || null,
    salesSummary: meta.salesSummary || null,
  }
}

export function openPosShiftContractNotes() {
  return {
    idempotency: 'openPosShift returns existing row when same clientRef',
    duplicateOpen: 'throws if POS or cashier already has open shift',
    fields: ['clientRef', 'cashierId', 'cashierName', 'openingCash', 'posId', 'openedAtIso', 'note'],
    responseId: 'SHIFT-* canonical',
    recoveryPlan: 'PC-3/live: open ONE recovery shift with sticky clientRef recovery-open-<sessionId>; map all remapped sales to returned id',
    apiSufficient: true,
    minimalPatchNeeded: 'None for open; Desktop must not auto-adopt closed SHIFT-* as active during recovery',
  }
}
