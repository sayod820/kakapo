/**
 * Phase D5 — durable pending debt overlay (pure).
 * Source of truth: local outbox/queue rows with appliedLocal debt effects.
 * Formula: effectiveDebt = round2(serverBaseDebt + Σ pending debtDelta)
 * Dedupes by clientRef. Does NOT double-apply on top of already-local debt.
 */

import {
  round2,
  toDebtOperationFromSale,
  toDebtOperationFromRepayment,
  toDebtOperationFromCashAdvance,
} from './debtOperationCore.mjs'

export const DEBT_OVERLAY_UNPARSEABLE = 'DEBT_OVERLAY_UNPARSEABLE'

/** Queue classes that still carry an unacked local debt effect. */
export const OVERLAY_INCLUDED_QUEUE_STATES = Object.freeze([
  'ready',
  'cooldown',
  'failed', // includes DEBT_RECEIPT_NOT_FOUND / AMBIGUOUS held-in-queue
])

/** Not in queue / not applied / not debt — excluded from overlay. */
export const OVERLAY_EXCLUDED_QUEUE_STATES = Object.freeze([
  'acked_deleted', // row gone after ACK
  'appliedLocal_false',
  'non_debt_sale',
  'non_debt_kind',
  'explicitly_reverted_deleted', // hard reject → revert + deletePending
])

function cardKey(num) {
  const s = String(num || '').trim().toUpperCase()
  if (!s) return ''
  const digits = s.replace(/\D/g, '')
  return digits || s
}

function classifyQueueRow(row, now = Date.now()) {
  if (row?.failed) return 'failed'
  if (Number(row?.nextRetryAt) > now) return 'cooldown'
  return 'ready'
}

function isDebtQueueKind(kind) {
  const k = String(kind || '')
  return k === 'sale' || k === 'cash_advance' || k === 'debt_repay'
}

/**
 * Extract one DebtOperation from a queue row, or null / unparseable marker.
 * @returns {{ ok: true, op: object } | { ok: false, skip: string } | { ok: false, unparseable: true, detail: object }}
 */
export function extractDebtOpFromQueueRow(row) {
  if (!row || typeof row !== 'object') {
    return { ok: false, skip: 'bad_row' }
  }
  const kind = String(row.kind || '')
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {}
  const clientRef = String(row.clientRef || payload.clientRef || '').trim()

  if (!isDebtQueueKind(kind)) {
    return { ok: false, skip: 'non_debt_kind' }
  }

  // appliedLocal must be true for overlay (local effect already on CRM)
  if (payload.appliedLocal === false) {
    return { ok: false, skip: 'appliedLocal_false' }
  }
  // Missing appliedLocal on legacy debt rows: treat as applied if still in queue
  // (enqueueOp always sets appliedLocal for these kinds)

  const input = {
    ...payload,
    clientRef,
    failed: !!row.failed,
    held: /DEBT_RECEIPT_NOT_FOUND|DEBT_RECEIPT_AMBIGUOUS/i.test(String(row.lastError || '')),
    syncHeld: /DEBT_RECEIPT_NOT_FOUND|DEBT_RECEIPT_AMBIGUOUS/i.test(String(row.lastError || '')),
    createdAtIso: row.createdAtIso || payload.createdAtIso,
    seq: row.seq,
  }

  try {
    let op
    if (kind === 'sale') {
      const debtAdded = round2(payload.debtAdded ?? payload.paidCredit ?? 0)
      if (!(debtAdded > 0.001)) {
        return { ok: false, skip: 'non_debt_sale' }
      }
      op = toDebtOperationFromSale({ ...input, debtAdded, amount: debtAdded })
    } else if (kind === 'cash_advance') {
      const amount = round2(Math.abs(Number(payload.amount) || 0))
      if (!(amount > 0.001)) {
        return { ok: false, unparseable: true, detail: { clientRef, kind, reason: 'missing_amount' } }
      }
      op = toDebtOperationFromCashAdvance({ ...input, amount })
    } else if (kind === 'debt_repay') {
      const amount = round2(Math.abs(Number(payload.amount) || 0))
      if (!(amount > 0.001)) {
        return { ok: false, unparseable: true, detail: { clientRef, kind, reason: 'missing_amount' } }
      }
      op = toDebtOperationFromRepayment({ ...input, amount })
    } else {
      return { ok: false, skip: 'non_debt_kind' }
    }

    if (!op.clientRef) {
      return { ok: false, unparseable: true, detail: { clientRef: '', kind, reason: 'missing_clientRef' } }
    }
    if (!op.appliedLocal) {
      return { ok: false, skip: 'appliedLocal_false' }
    }
    // Attach OCC hint from payload (pre-apply version); local applied version = expected + 1
    const expected = Number(payload.expectedDebtPayVersion ?? payload.debtPayVersion)
    op._expectedDebtPayVersion = Number.isFinite(expected) ? expected : null
    op._queueClass = classifyQueueRow(row)
    return { ok: true, op }
  } catch (e) {
    return {
      ok: false,
      unparseable: true,
      detail: { clientRef, kind, reason: String(e?.message || e) },
    }
  }
}

/**
 * Build overlay maps from durable queue.
 * Duplicate clientRef counted once (first by seq/created order preferred).
 */
export function buildPendingDebtOverlay(pendingList, opts = {}) {
  const now = opts.now ?? Date.now()
  const byClientRef = new Map()
  const ops = []
  const unparseable = []
  const skipped = []

  const rows = Array.isArray(pendingList) ? [...pendingList] : []
  rows.sort((a, b) => {
    const t = String(a?.createdAtIso || '').localeCompare(String(b?.createdAtIso || ''))
    return t !== 0 ? t : (Number(a?.seq) || 0) - (Number(b?.seq) || 0)
  })

  for (const row of rows) {
    const className = classifyQueueRow(row, now)
    if (!OVERLAY_INCLUDED_QUEUE_STATES.includes(className)) {
      skipped.push({ clientRef: row?.clientRef, reason: `state_${className}` })
      continue
    }
    const extracted = extractDebtOpFromQueueRow(row)
    if (extracted.ok) {
      const ref = extracted.op.clientRef
      if (byClientRef.has(ref)) {
        skipped.push({ clientRef: ref, reason: 'duplicate_clientRef' })
        continue
      }
      byClientRef.set(ref, extracted.op)
      ops.push(extracted.op)
    } else if (extracted.unparseable) {
      unparseable.push(extracted.detail)
    } else {
      skipped.push({ clientRef: row?.clientRef, reason: extracted.skip || 'skip' })
    }
  }

  /** @type {Map<string, number>} */
  const deltaByClientId = new Map()
  /** @type {Map<string, number>} */
  const deltaByCardKey = new Map()
  /** @type {Map<string, number>} */
  const versionHintByCardKey = new Map()
  /** @type {Map<string, string>} clientId bound to card from ops */
  const cardOwnerByKey = new Map()
  /** @type {Set<string>} */
  const unparseableClientIds = new Set()
  /** @type {Set<string>} */
  const unparseableCardKeys = new Set()
  /** ownership conflicts */
  const ownershipConflicts = []

  for (const u of unparseable) {
    // cannot attribute without ids — still surface diagnostic
  }

  for (const op of ops) {
    const delta = round2(op.debtDelta)
    const cid = String(op.clientId || '').trim()
    if (cid) {
      deltaByClientId.set(cid, round2((deltaByClientId.get(cid) || 0) + delta))
    }
    const ck = cardKey(op.cardNum)
    if (ck) {
      if (cid) {
        const prevOwner = cardOwnerByKey.get(ck)
        if (prevOwner && prevOwner !== cid) {
          ownershipConflicts.push({ cardKey: ck, clientIds: [prevOwner, cid] })
          // do not cross-apply conflicting card deltas
          continue
        }
        cardOwnerByKey.set(ck, cid)
      }
      deltaByCardKey.set(ck, round2((deltaByCardKey.get(ck) || 0) + delta))
      const exp = op._expectedDebtPayVersion
      if (exp != null && Number.isFinite(exp)) {
        const hint = Math.max(0, Math.floor(exp) + 1)
        versionHintByCardKey.set(ck, Math.max(versionHintByCardKey.get(ck) || 0, hint))
      }
    }
  }

  // Attribute unparseable debt-like rows for fail-safe pin
  for (const row of rows) {
    if (!isDebtQueueKind(row?.kind)) continue
    const extracted = extractDebtOpFromQueueRow(row)
    if (!extracted.unparseable) continue
    const p = row.payload || {}
    const cid = String(p.clientId || '').trim()
    const ck = cardKey(p.num || p.cardNum)
    if (cid) unparseableClientIds.add(cid)
    if (ck) unparseableCardKeys.add(ck)
  }

  return {
    ops,
    unparseable,
    skipped,
    ownershipConflicts,
    deltaByClientId,
    deltaByCardKey,
    versionHintByCardKey,
    cardOwnerByKey,
    unparseableClientIds,
    unparseableCardKeys,
    empty: ops.length === 0 && unparseable.length === 0,
  }
}

export function clientDebtDelta(overlay, clientId) {
  if (!overlay || !clientId) return 0
  return round2(overlay.deltaByClientId?.get(String(clientId).trim()) || 0)
}

export function cardDebtDelta(overlay, cardNum, opts = {}) {
  if (!overlay || !cardNum) return 0
  const ck = cardKey(cardNum)
  if (!ck) return 0
  const owner = overlay.cardOwnerByKey?.get(ck)
  const cardClientId = String(opts.cardClientId || '').trim()
  // Ownership guard: if card is bound to client A and overlay ops claim client B, skip
  if (owner && cardClientId && owner !== cardClientId) {
    return 0
  }
  return round2(overlay.deltaByCardKey?.get(ck) || 0)
}

export function cardVersionHint(overlay, cardNum) {
  if (!overlay || !cardNum) return 0
  return Math.max(0, overlay.versionHintByCardKey?.get(cardKey(cardNum)) || 0)
}

/**
 * Apply overlay onto server-base debt (NOT onto already-local debt).
 * @returns {{ debt: number, debtPayVersion?: number, usedOverlay: boolean, failSafeLocal: boolean }}
 */
export function applyDebtOverlayToProjection(serverBaseDebt, opts = {}) {
  const {
    overlay = null,
    clientId = '',
    cardNum = '',
    cardClientId = '',
    localDebt = null,
    localDebtPayVersion = null,
    serverDebtPayVersion = null,
  } = opts

  const base = round2(serverBaseDebt)
  if (!overlay || overlay.empty) {
    return {
      debt: base,
      debtPayVersion: serverDebtPayVersion != null ? Math.max(0, Number(serverDebtPayVersion) || 0) : undefined,
      usedOverlay: false,
      failSafeLocal: false,
    }
  }

  const cid = String(clientId || '').trim()
  const ck = cardKey(cardNum)
  const failSafe = (cid && overlay.unparseableClientIds?.has(cid))
    || (ck && overlay.unparseableCardKeys?.has(ck))

  if (failSafe && localDebt != null && Number.isFinite(Number(localDebt))) {
    const ver = Math.max(
      Number(localDebtPayVersion) || 0,
      Number(serverDebtPayVersion) || 0,
      cardNum ? cardVersionHint(overlay, cardNum) : 0,
    )
    return {
      debt: round2(localDebt),
      debtPayVersion: ver,
      usedOverlay: true,
      failSafeLocal: true,
      code: DEBT_OVERLAY_UNPARSEABLE,
    }
  }

  let delta = 0
  if (cid) delta = round2(delta + clientDebtDelta(overlay, cid))
  // When projecting a card row, use card key (not also client — callers choose one identity)
  if (ck && opts.mode === 'card') {
    delta = cardDebtDelta(overlay, cardNum, { cardClientId })
  } else if (ck && opts.mode === 'client') {
    // client projection: only clientId sum (card-only ops without clientId won't move client)
    delta = clientDebtDelta(overlay, cid)
  } else if (ck && !cid) {
    delta = cardDebtDelta(overlay, cardNum, { cardClientId })
  }

  const effective = round2(Math.max(0, base + delta))
  const ver = Math.max(
    Number(localDebtPayVersion) || 0,
    Number(serverDebtPayVersion) || 0,
    cardNum ? cardVersionHint(overlay, cardNum) : 0,
  )

  return {
    debt: effective,
    debtPayVersion: ver,
    usedOverlay: Math.abs(delta) > 0.0005 || failSafe,
    failSafeLocal: false,
    pendingDelta: delta,
  }
}

export { round2, cardKey as overlayCardKey, classifyQueueRow }
