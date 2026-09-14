/**
 * Phase D7 — isolated in-memory debt world (local + server + oracle).
 * No production I/O. Deterministic fixtures for stress/failure validation.
 */
import {
  round2,
} from '../lib/debtOperationCore.mjs'
import {
  buildPendingDebtOverlay,
  applyDebtOverlayToProjection,
} from '../lib/pendingDebtOverlayCore.mjs'
import {
  classifyDebtOpError,
  canRemoveDebtQueueOp,
  isUnsafeDebtRepayTarget,
  debtRepayHoldReason,
  DEBT_OP_ERROR_CLASS,
} from '../lib/debtOpErrorClassifierCore.mjs'
import {
  buildDebtOpFingerprint,
  checkIdempotencyReplay,
} from '../server/kakapo-api/debtOpIdempotency.js'

export { round2, classifyDebtOpError, canRemoveDebtQueueOp, DEBT_OP_ERROR_CLASS }

export const SEED_DEFAULT = 20260914

/** Mulberry32 PRNG */
export function makeRng(seed = SEED_DEFAULT) {
  let t = seed >>> 0
  return {
    seed,
    next() {
      t += 0x6d2b79f5
      let r = Math.imul(t ^ (t >>> 15), 1 | t)
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296
    },
    int(max) {
      return Math.floor(this.next() * max)
    },
    pick(arr) {
      return arr[this.int(arr.length)]
    },
  }
}

export function freshWorld(opts = {}) {
  const startA = opts.startDebtA != null ? round2(opts.startDebtA) : 1000
  const startB = opts.startDebtB != null ? round2(opts.startDebtB) : 0
  return {
    failHooks: new Set(opts.failHooks || []),
    metrics: {
      scenarios: 0,
      assertions: 0,
      failureInjections: 0,
      randomOps: 0,
      duplicateReplays: 0,
      ackLossCases: 0,
      restartCases: 0,
      heldCases: 0,
      doubleApply: 0,
      lostOp: 0,
      debtResurrection: 0,
      clientCardMismatch: 0,
      serverLedgerMismatch: 0,
      shiftDouble: 0,
      stockDouble: 0,
      versionRegression: 0,
    },
    bugs: [],
    local: {
      clientA: { id: 'CLIENT_A', debt: startA, card: 'CARD_A' },
      cardA: { num: 'CARD_A', debt: startA, debtPayVersion: 0, clientId: 'CLIENT_A' },
      clientB: { id: 'CLIENT_B', debt: startB, card: 'CARD_B' },
      cardB: { num: 'CARD_B', debt: startB, debtPayVersion: 0, clientId: 'CLIENT_B' },
      queue: [],
      stock: 1000,
      shift: { salesCredit: 0, salesCash: 0, expenseTotal: 0, debtRepayCash: 0 },
      seq: 0,
    },
    server: {
      clientA: { id: 'CLIENT_A', debt: startA },
      cardA: { num: 'CARD_A', debt: startA, debtPayVersion: 0, clientId: 'CLIENT_A' },
      clientB: { id: 'CLIENT_B', debt: startB },
      cardB: { num: 'CARD_B', debt: startB, debtPayVersion: 0, clientId: 'CLIENT_B' },
      debtLedger: {
        CLIENT_A: [
          { id: 'DL-A1', amount: 400, remaining: 400, source: 'pos' },
          { id: 'DL-A2', amount: 600, remaining: 600, source: 'pos' },
        ],
        CLIENT_B: [],
      },
      opRefs: new Map(),
      moneyLedger: [],
      posSales: [],
      stock: 1000,
      shift: { salesCredit: 0, salesCash: 0, expenseTotal: 0, debtRepayCash: 0 },
      processGen: 1,
    },
    oracle: {
      debtA: startA,
      debtB: startB,
      pending: new Map(),
      appliedServer: new Set(),
      appliedLocal: new Set(),
    },
  }
}

function assert(world, cond, msg, metricKey) {
  world.metrics.assertions++
  if (!cond) {
    if (metricKey) world.metrics[metricKey]++
    throw new Error(msg)
  }
}

function sumPendingDelta(oracle, clientId) {
  let s = 0
  for (const p of oracle.pending.values()) {
    if (p.clientId === clientId) s = round2(s + p.delta)
  }
  return s
}

function openLedgerTotal(server, clientId) {
  return round2((server.debtLedger[clientId] || []).reduce((a, e) => a + (Number(e.remaining) || 0), 0))
}

export function checkInvariants(world, { converged = false } = {}) {
  const { local, server, oracle, metrics } = world
  world.metrics.assertions += 4
  if (Math.abs(local.clientA.debt - local.cardA.debt) > 0.011) {
    metrics.clientCardMismatch++
    throw new Error(`I4 local A mismatch client=${local.clientA.debt} card=${local.cardA.debt}`)
  }
  if (Math.abs(server.clientA.debt - server.cardA.debt) > 0.011) {
    metrics.clientCardMismatch++
    throw new Error('I4 server A mismatch')
  }
  const overlay = buildPendingDebtOverlay(local.queue)
  const eff = applyDebtOverlayToProjection(server.clientA.debt, {
    overlay,
    clientId: 'CLIENT_A',
    mode: 'client',
    localDebt: local.clientA.debt,
  })
  const expectedEff = round2(server.clientA.debt + sumPendingDelta(oracle, 'CLIENT_A'))
  const localEff = round2(local.clientA.debt)
  if (Math.abs(localEff - expectedEff) > 0.011 && Math.abs(eff.debt - expectedEff) > 0.011) {
    metrics.debtResurrection++
    throw new Error(`I6 effective mismatch overlay=${eff.debt} oracleEff=${expectedEff} local=${localEff}`)
  }
  assert(world, local.clientA.debt >= -0.001 && server.clientA.debt >= -0.001, 'I13 negative debt', 'doubleApply')
  assert(world, local.cardA.debtPayVersion >= 0, 'I14 ver')
  if (converged) {
    assert(world, local.queue.filter(r => !r.failed || !/HELD|NOT_FOUND|AMBIGUOUS|ALREADY_PAID|IDEMPOTENCY/i.test(String(r.lastError || ''))).length === 0
      || local.queue.every(r => r.failed), 'convergence note')
    // For full convergence callers pass empty queue expectation separately
    if (local.queue.length === 0) {
      assert(world, Math.abs(local.clientA.debt - server.clientA.debt) < 0.011, 'I7 local==server', 'debtResurrection')
      assert(world, Math.abs(server.clientA.debt - oracle.debtA) < 0.011, 'I5 oracle==server', 'serverLedgerMismatch')
      const open = openLedgerTotal(server, 'CLIENT_A')
      assert(world, Math.abs(open - server.clientA.debt) < 0.011, `I5 ledger ${open} vs ${server.clientA.debt}`, 'serverLedgerMismatch')
    }
  }
}

function nextRef(world, prefix) {
  world.local.seq++
  return `${prefix}-${world.local.seq}`
}

function inject(world, hook) {
  if (world.failHooks.has(hook)) {
    world.metrics.failureInjections++
    world.failHooks.delete(hook)
    const e = new Error(`FAIL_INJECT:${hook}`)
    e.code = 'FAIL_INJECT'
    e.hook = hook
    throw e
  }
}

function queuePush(world, row) {
  const exists = world.local.queue.find(r => r.clientRef === row.clientRef)
  if (exists) return exists
  world.local.queue.push(row)
  return row
}

function queueDelete(world, clientRef) {
  world.local.queue = world.local.queue.filter(r => r.clientRef !== clientRef)
  world.oracle.pending.delete(clientRef)
}

function applyLocalDebt(world, clientId, delta) {
  const isA = clientId === 'CLIENT_A'
  const client = isA ? world.local.clientA : world.local.clientB
  const card = isA ? world.local.cardA : world.local.cardB
  client.debt = round2(Math.max(0, client.debt + delta))
  card.debt = client.debt
  card.debtPayVersion = (Number(card.debtPayVersion) || 0) + 1
}

function applyServerDebt(world, clientId, delta, { orderId, source, kind, clientRef } = {}) {
  const isA = clientId === 'CLIENT_A'
  const client = isA ? world.server.clientA : world.server.clientB
  const card = isA ? world.server.cardA : world.server.cardB
  const prev = client.debt
  const ledger = world.server.debtLedger[clientId] || (world.server.debtLedger[clientId] = [])

  // Validate receipt targets BEFORE mutating projections (atomic apply).
  if (delta < 0) {
    const left = round2(Math.abs(delta))
    if (orderId) {
      const target = ledger.find(e => e.id === orderId)
      if (!target) {
        const err = new Error(`Чек долга не найден (${orderId}) [DEBT_RECEIPT_NOT_FOUND]`)
        err.code = 'DEBT_RECEIPT_NOT_FOUND'
        err.status = 400
        throw err
      }
      if (round2(target.remaining) <= 0.001) {
        const err = new Error(`Чек долга уже погашен (${orderId}) [DEBT_RECEIPT_ALREADY_PAID]`)
        err.code = 'DEBT_RECEIPT_ALREADY_PAID'
        err.status = 400
        throw err
      }
      if (left > target.remaining + 0.001) {
        const err = new Error('OVERPAY [DEBT_RECEIPT_OVERPAY]')
        err.code = 'DEBT_RECEIPT_OVERPAY'
        err.status = 400
        throw err
      }
    }
  }

  client.debt = round2(Math.max(0, client.debt + delta))
  card.debt = client.debt
  card.debtPayVersion = (Number(card.debtPayVersion) || 0) + 1

  if (delta > 0) {
    const id = `DL-${String(clientRef).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)}`
    ledger.push({ id, amount: round2(delta), remaining: round2(delta), source: source || kind || 'pos', clientRef })
    return { debtLedgerEntryId: id, prevDebt: prev, nextDebt: client.debt }
  }
  let left = round2(Math.abs(delta))
  if (orderId) {
    const target = ledger.find(e => e.id === orderId)
    target.remaining = round2(target.remaining - left)
  } else {
    for (const e of ledger) {
      if (left <= 0.001) break
      const take = Math.min(round2(e.remaining), left)
      e.remaining = round2(e.remaining - take)
      left = round2(left - take)
    }
  }
  return { prevDebt: prev, nextDebt: client.debt }
}

export function localApplyAndEnqueue(world, kind, fields = {}) {
  const clientRef = fields.clientRef || nextRef(world, kind === 'sale' ? 'sale' : kind)
  const clientId = fields.clientId || 'CLIENT_A'
  let delta = 0
  if (kind === 'sale') delta = round2(fields.debtAdded || fields.amount || 0)
  else if (kind === 'cash_advance') delta = round2(fields.amount || 0)
  else if (kind === 'debt_repay') delta = -round2(fields.amount || 0)
  else throw new Error('bad kind')

  if (world.oracle.appliedLocal.has(clientRef)) {
    world.metrics.doubleApply++
    throw new Error(`I2 double local apply ${clientRef}`)
  }

  try {
    inject(world, 'before_local')
    inject(world, 'after_queue')
    const payload = {
      clientRef,
      appliedLocal: true,
      skipBalances: true,
      clientId,
      num: clientId === 'CLIENT_A' ? 'CARD_A' : 'CARD_B',
      cardNum: clientId === 'CLIENT_A' ? 'CARD_A' : 'CARD_B',
      amount: Math.abs(delta),
      debtAdded: kind === 'sale' ? delta : undefined,
      orderId: fields.orderId,
      parentCashAdvanceClientRef: fields.parentCashAdvanceClientRef,
      expectedDebtPayVersion: fields.expectedDebtPayVersion
        ?? (clientId === 'CLIENT_A' ? world.local.cardA.debtPayVersion : world.local.cardB.debtPayVersion),
      method: fields.method || (kind === 'debt_repay' ? 'cash' : undefined),
    }
    inject(world, 'mid_local')
    if (kind === 'sale') {
      inject(world, 'after_sale')
      world.local.stock -= 1
      world.local.shift.salesCredit = round2(world.local.shift.salesCredit + delta)
    }
    if (kind === 'cash_advance') {
      world.local.shift.expenseTotal = round2(world.local.shift.expenseTotal + Math.abs(delta))
    }
    if (kind === 'debt_repay') {
      world.local.shift.debtRepayCash = round2(world.local.shift.debtRepayCash + Math.abs(delta))
      world.local.shift.salesCash = round2(world.local.shift.salesCash + Math.abs(delta))
    }
    inject(world, 'after_card')
    applyLocalDebt(world, clientId, delta)
    inject(world, 'after_client')
    inject(world, 'after_shift')
    inject(world, 'before_commit')
    queuePush(world, {
      clientRef,
      kind: kind === 'sale' ? 'sale' : kind,
      payload,
      createdAtIso: new Date().toISOString(),
      seq: world.local.seq,
      attempts: 0,
      failed: false,
    })
    world.oracle.appliedLocal.add(clientRef)
    world.oracle.pending.set(clientRef, { delta, clientId, kind })
    if (clientId === 'CLIENT_A') world.oracle.debtA = round2(world.oracle.debtA + delta)
    else world.oracle.debtB = round2(world.oracle.debtB + delta)
    inject(world, 'after_commit_before_ui')
    return { clientRef, delta, payload }
  } catch (e) {
    if (e.code === 'FAIL_INJECT' && ['before_local', 'mid_local', 'before_commit'].includes(e.hook)) {
      return { aborted: true, hook: e.hook }
    }
    // After local COMMIT: op must survive crash before UI hydrate.
    if (e.code === 'FAIL_INJECT' && e.hook === 'after_commit_before_ui') {
      return { clientRef, delta, payload: world.local.queue.find(r => r.clientRef === clientRef)?.payload, crashedAfterCommit: true }
    }
    throw e
  }
}

function serverClaimOrReplay(world, kind, clientRef, fingerprint) {
  const key = `${kind}|${clientRef}`
  const prev = world.server.opRefs.get(key)
  if (prev) {
    const check = checkIdempotencyReplay(prev.fingerprint, fingerprint)
    if (!check.ok) {
      const err = new Error(check.detail || 'IDEMPOTENCY_KEY_REUSED')
      err.code = 'IDEMPOTENCY_KEY_REUSED'
      err.status = 409
      throw err
    }
    world.metrics.duplicateReplays++
    return { ...prev.result, replayed: true, duplicate: true }
  }
  const ml = world.server.moneyLedger.find(m => m.clientRef === clientRef && m.kind === kind)
  if (ml) {
    world.metrics.duplicateReplays++
    return { ...ml.result, replayed: true, duplicate: true, debtLedgerEntryId: ml.debtLedgerEntryId }
  }
  return null
}

export function serverApply(world, kind, payload, { ackLoss = false } = {}) {
  const clientRef = String(payload.clientRef || '').trim()
  if (!clientRef) {
    const err = new Error('clientRef required [CLIENT_REF_REQUIRED]')
    err.code = 'CLIENT_REF_REQUIRED'
    throw err
  }
  const clientId = payload.clientId || 'CLIENT_A'
  const amount = round2(payload.amount || payload.debtAdded || 0)
  let fingerprint
  let delta = 0
  let k = kind
  if (k === 'sale' || k === 'sale_on_credit') {
    delta = round2(payload.debtAdded || amount)
    fingerprint = buildDebtOpFingerprint('pos_sale', {
      amount: delta,
      debtAdded: delta,
      clientId,
      cardNum: payload.cardNum || payload.num,
      method: 'credit',
    })
    k = 'sale'
  } else if (k === 'cash_advance') {
    delta = amount
    fingerprint = buildDebtOpFingerprint('cash_advance', {
      amount,
      method: 'cash',
      clientId,
      cardNum: payload.num || payload.cardNum,
    })
  } else if (k === 'debt_repay') {
    delta = -amount
    fingerprint = buildDebtOpFingerprint('debt_repay', {
      amount,
      method: payload.method || 'cash',
      clientId,
      cardNum: payload.num || payload.cardNum,
      orderId: payload.orderId,
    })
  }

  if (isUnsafeDebtRepayTarget(payload.orderId)) {
    const err = new Error('synthetic target [DEBT_RECEIPT_NOT_FOUND]')
    err.code = 'DEBT_RECEIPT_NOT_FOUND'
    throw err
  }

  const replay = serverClaimOrReplay(world, k, clientRef, fingerprint)
  if (replay) return replay

  const card = clientId === 'CLIENT_A' ? world.server.cardA : world.server.cardB
  const expected = payload.expectedDebtPayVersion
  if (expected != null && Number(expected) !== Number(card.debtPayVersion)) {
    const err = new Error(`версию ожидали ${expected} сейчас ${card.debtPayVersion} [DEBT_PAY_VERSION_CONFLICT]`)
    err.code = 'DEBT_PAY_VERSION_CONFLICT'
    err.status = 409
    throw err
  }

  if (world.oracle.appliedServer.has(clientRef)) {
    world.metrics.doubleApply++
    throw new Error(`I3 double server apply ${clientRef}`)
  }

  let result
  if (k === 'sale') {
    result = applyServerDebt(world, clientId, delta, { source: 'pos', clientRef, kind: k })
    const stockBefore = world.server.stock
    world.server.stock -= 1
    if (world.server.stock !== stockBefore - 1) world.metrics.stockDouble++
    world.server.shift.salesCredit = round2(world.server.shift.salesCredit + delta)
    world.server.posSales.push({ clientRef, debtAdded: delta, id: `SALE-${clientRef}` })
  } else if (k === 'cash_advance') {
    result = applyServerDebt(world, clientId, delta, { source: 'cash_advance', clientRef, kind: k })
    world.server.shift.expenseTotal = round2(world.server.shift.expenseTotal + amount)
  } else if (k === 'debt_repay') {
    result = applyServerDebt(world, clientId, delta, { orderId: payload.orderId, clientRef, kind: k })
    world.server.shift.debtRepayCash = round2(world.server.shift.debtRepayCash + amount)
    world.server.shift.salesCash = round2(world.server.shift.salesCash + amount)
  }

  world.oracle.appliedServer.add(clientRef)
  const out = {
    clientRef,
    amount: Math.abs(delta),
    debtLedgerEntryId: result.debtLedgerEntryId || null,
    prevDebt: result.prevDebt,
    nextDebt: result.nextDebt,
    replayed: false,
  }
  world.server.opRefs.set(`${k}|${clientRef}`, { fingerprint, result: out })
  world.server.moneyLedger.push({
    clientRef,
    kind: k,
    amount: Math.abs(delta),
    debtLedgerEntryId: out.debtLedgerEntryId,
    result: out,
  })

  if (ackLoss) {
    world.metrics.ackLossCases++
    const err = new Error('ACK_LOST')
    err.code = 'ACK_LOST'
    err.committed = out
    throw err
  }
  return out
}

export function flushOne(world, clientRef, opts = {}) {
  const row = world.local.queue.find(r => r.clientRef === clientRef)
  if (!row) return { missing: true }
  if (row.failed && !opts.force) return { skipped: 'failed' }

  const hold = debtRepayHoldReason(row, world.local.queue)
  if (hold) {
    row.failed = false
    row.nextRetryAt = Date.now() + 60_000
    row.lastError = hold
    return { held: true, reason: hold }
  }

  inject(world, 'before_send')
  const kind = row.kind === 'sale' ? 'sale' : row.kind
  try {
    const res = serverApply(world, kind, row.payload, { ackLoss: opts.ackLoss })
    inject(world, 'after_server_commit_before_ack')
    if (kind === 'cash_advance' && res.debtLedgerEntryId) {
      inject(world, 'after_ack_before_mapping')
      for (const child of world.local.queue) {
        if (child.kind !== 'debt_repay') continue
        const p = child.payload || {}
        if (String(p.parentCashAdvanceClientRef || '') === clientRef || isUnsafeDebtRepayTarget(p.orderId)) {
          p.orderId = res.debtLedgerEntryId
          delete p._unsafeOrderId
          child.failed = false
          child.lastError = ''
          child.nextRetryAt = undefined
        }
      }
      inject(world, 'after_mapping_before_delete')
    }
    queueDelete(world, clientRef)
    return { ok: true, res }
  } catch (e) {
    if (e.code === 'ACK_LOST') return { ackLost: true, committed: e.committed }
    if (e.code === 'FAIL_INJECT') throw e
    const cls = classifyDebtOpError(kind, e)
    if (cls.class === DEBT_OP_ERROR_CLASS.RETRYABLE_TRANSPORT) {
      return { transport: true, error: cls }
    }
    if (cls.class === DEBT_OP_ERROR_CLASS.RETRYABLE_VERSION) {
      const card = row.payload.clientId === 'CLIENT_B' ? world.server.cardB : world.server.cardA
      row.payload.expectedDebtPayVersion = card.debtPayVersion
      row.failed = false
      row.attempts = (row.attempts || 0) + 1
      if (opts.autoVersionRetry !== false && !opts._versionRetried) {
        return flushOne(world, clientRef, { ...opts, _versionRetried: true })
      }
      return { versionRetry: true }
    }
    if (cls.class === DEBT_OP_ERROR_CLASS.HELD_BUSINESS || cls.class === DEBT_OP_ERROR_CLASS.PERMANENT_REJECT) {
      world.metrics.heldCases++
      row.failed = true
      row.lastError = cls.message
      row.payload._debtErrorCode = cls.code
      row.nextRetryAt = Date.now() + 300_000
      return { held: true, cls }
    }
    // Idempotent replay via moneyLedger after ACK loss path
    if (e.code === 'IDEMPOTENCY_KEY_REUSED') {
      row.failed = true
      row.lastError = e.message
      world.metrics.heldCases++
      return { held: true, cls: classifyDebtOpError(kind, e) }
    }
    row.failed = true
    row.lastError = String(e.message || e)
    return { failed: true, error: e }
  }
}

export function flushAll(world, opts = {}) {
  const out = []
  for (let pass = 0; pass < 3; pass++) {
    const refs = world.local.queue.filter(r => !r.failed || opts.force).map(r => r.clientRef)
    for (const ref of refs) out.push(flushOne(world, ref, opts))
  }
  return out
}

export function pullMerge(world, { forceFull = false } = {}) {
  inject(world, 'before_overlay')
  const overlay = buildPendingDebtOverlay(world.local.queue)
  inject(world, 'after_server_fetch_before_merge')
  const r = applyDebtOverlayToProjection(world.server.clientA.debt, {
    overlay,
    clientId: 'CLIENT_A',
    mode: 'client',
    localDebt: forceFull ? null : world.local.clientA.debt,
  })
  const cardR = applyDebtOverlayToProjection(world.server.cardA.debt, {
    overlay,
    cardNum: 'CARD_A',
    cardClientId: 'CLIENT_A',
    mode: 'card',
    localDebt: forceFull ? null : world.local.cardA.debt,
    localDebtPayVersion: world.local.cardA.debtPayVersion,
    serverDebtPayVersion: world.server.cardA.debtPayVersion,
  })
  world.local.clientA.debt = r.debt
  world.local.cardA.debt = cardR.debt
  const prevVer = world.local.cardA.debtPayVersion
  world.local.cardA.debtPayVersion = Math.max(
    prevVer,
    world.server.cardA.debtPayVersion,
    Number(cardR.debtPayVersion) || 0,
  )
  if (world.local.cardA.debtPayVersion < prevVer) world.metrics.versionRegression++
  return { effective: r.debt, forceFull }
}

export function appRestart(world) {
  world.metrics.restartCases++
  world.failHooks.clear()
  return pullMerge(world, { forceFull: true })
}

export function bumpExternalVersion(world, clientId = 'CLIENT_A') {
  const card = clientId === 'CLIENT_A' ? world.server.cardA : world.server.cardB
  card.debtPayVersion = (Number(card.debtPayVersion) || 0) + 1
}

export function tryRawDelete(world, clientRef) {
  const row = world.local.queue.find(r => r.clientRef === clientRef)
  const gate = canRemoveDebtQueueOp(row)
  if (!gate.ok) return gate
  queueDelete(world, clientRef)
  return { ok: true }
}

export function openLedger(world, clientId = 'CLIENT_A') {
  return openLedgerTotal(world.server, clientId)
}

export function converge(world) {
  // clear held for converge tests that shouldn't leave holds — caller filters
  flushAll(world, { force: false })
  // retry version conflicts
  for (let i = 0; i < 5; i++) {
    for (const row of world.local.queue) {
      if (!row.failed) flushOne(world, row.clientRef)
      else if (row.payload?._debtErrorCode === 'DEBT_PAY_VERSION_CONFLICT' || /верси/i.test(row.lastError || '')) {
        row.failed = false
        flushOne(world, row.clientRef)
      }
    }
  }
  pullMerge(world)
  checkInvariants(world, { converged: world.local.queue.length === 0 })
}
