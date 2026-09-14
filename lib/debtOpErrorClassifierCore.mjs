/**
 * Phase D6 — pure debt outbox error classifier.
 * HTTP status alone is insufficient; prefer server `code` embedded in message as [CODE].
 */

export const DEBT_OP_ERROR_CLASS = Object.freeze({
  RETRYABLE_TRANSPORT: 'RETRYABLE_TRANSPORT',
  RETRYABLE_VERSION: 'RETRYABLE_VERSION',
  HELD_BUSINESS: 'HELD_BUSINESS',
  PERMANENT_REJECT: 'PERMANENT_REJECT',
  REPLAY_SUCCESS: 'REPLAY_SUCCESS',
  UNKNOWN: 'UNKNOWN',
})

/** Errors that may auto-revert local debt (narrow; prefer HELD otherwise). */
export const AUTO_REVERT_ERROR_CODES = Object.freeze([
  // Intentionally empty for debt_repay / cash_advance in D6 —
  // destructive revert is too dangerous for appliedLocal debt.
])

/** Business holds — keep queue + overlay, no auto-revert. */
export const MANUAL_HELD_ERROR_CODES = Object.freeze([
  'DEBT_RECEIPT_NOT_FOUND',
  'DEBT_RECEIPT_AMBIGUOUS',
  'DEBT_RECEIPT_ALREADY_PAID', // different clientRef (same key → REPLAY_SUCCESS on server)
  'IDEMPOTENCY_KEY_REUSED',
  'CARD_OWNERSHIP_CONFLICT',
  'CLIENT_REF_REQUIRED',
])

export const AUTO_RETRY_CODES = Object.freeze([
  'RETRYABLE_TRANSPORT',
  'RETRYABLE_VERSION',
])

export const HELD_CODES = Object.freeze([
  'HELD_BUSINESS',
])

export const PERMANENT_CODES = Object.freeze([
  'PERMANENT_REJECT',
])

function extractCode(err) {
  if (!err) return ''
  if (typeof err === 'object') {
    const c = String(err.code || err.errorCode || '').trim()
    if (c) return c
    const msg = String(err.message || err.detail || err)
    const m = msg.match(/\[([A-Z0-9_]+)\]\s*$/)
    if (m) return m[1]
    const m2 = msg.match(/\b(DEBT_[A-Z0-9_]+|IDEMPOTENCY_[A-Z0-9_]+|CLIENT_REF_[A-Z0-9_]+|CARD_OWNERSHIP_[A-Z0-9_]+)\b/)
    if (m2) return m2[1]
  }
  const s = String(err)
  const m = s.match(/\[([A-Z0-9_]+)\]\s*$/)
  if (m) return m[1]
  const m2 = s.match(/\b(DEBT_[A-Z0-9_]+|IDEMPOTENCY_[A-Z0-9_]+|CLIENT_REF_[A-Z0-9_]+)\b/)
  return m2 ? m2[1] : ''
}

function extractMessage(err) {
  if (!err) return ''
  if (typeof err === 'string') return err
  return String(err.message || err.detail || err)
}

function extractStatus(err) {
  const n = Number(err?.status || err?.statusCode || 0)
  return Number.isFinite(n) ? n : 0
}

function isNetworkLike(err, msg, status) {
  if (err && (err.name === 'NetworkError' || err.isNetworkError)) return true
  if (status === 502 || status === 503 || status === 504) return true
  // Status embedded only in message text (no err.status) — common fetch/proxy shapes
  if (/\b502\b|\b503\b|\b504\b/.test(msg)) return true
  if (/network|offline|timeout|timed out|fetch failed|failed to fetch|econnreset|econnrefused|connection reset|reset by peer|socket|aborted|сеть|таймаут/i.test(msg)) {
    return true
  }
  return false
}

/**
 * @param {string} kind queue kind
 * @param {unknown} err
 * @param {{ responseBody?: any }} [opts]
 * @returns {{ class: string, code: string, message: string, status: number, shouldRevert: boolean, shouldDelete: boolean, shouldAck: boolean, backoffMs: number | null }}
 */
export function classifyDebtOpError(kind, err, opts = {}) {
  const k = String(kind || '')
  const msg = extractMessage(err)
  const code = extractCode(err)
  const status = extractStatus(err)
  const body = opts.responseBody

  if (body && (body.replayed || body.duplicate || body.replay)) {
    return {
      class: DEBT_OP_ERROR_CLASS.REPLAY_SUCCESS,
      code: code || 'REPLAY',
      message: msg,
      status: status || 200,
      shouldRevert: false,
      shouldDelete: true,
      shouldAck: true,
      backoffMs: null,
    }
  }

  if (isNetworkLike(err, msg, status)) {
    return {
      class: DEBT_OP_ERROR_CLASS.RETRYABLE_TRANSPORT,
      code: code || 'TRANSPORT',
      message: msg,
      status,
      shouldRevert: false,
      shouldDelete: false,
      shouldAck: false,
      backoffMs: null, // flush stops; reconnect retries
    }
  }

  if (
    code === 'DEBT_RECEIPT_NOT_FOUND'
    || code === 'DEBT_RECEIPT_AMBIGUOUS'
    || /DEBT_RECEIPT_NOT_FOUND|DEBT_RECEIPT_AMBIGUOUS|Чек долга не найден|несколько непогашенных/i.test(msg)
  ) {
    return {
      class: DEBT_OP_ERROR_CLASS.HELD_BUSINESS,
      code: code || (/AMBIGUOUS|нескольк/i.test(msg) ? 'DEBT_RECEIPT_AMBIGUOUS' : 'DEBT_RECEIPT_NOT_FOUND'),
      message: msg,
      status: status || 400,
      shouldRevert: false,
      shouldDelete: false,
      shouldAck: false,
      backoffMs: 300_000, // 5 min — no hot loop
    }
  }

  if (code === 'DEBT_RECEIPT_ALREADY_PAID' || /DEBT_RECEIPT_ALREADY_PAID|уже погашен/i.test(msg)) {
    return {
      class: DEBT_OP_ERROR_CLASS.HELD_BUSINESS,
      code: 'DEBT_RECEIPT_ALREADY_PAID',
      message: msg,
      status: status || 400,
      shouldRevert: false,
      shouldDelete: false,
      shouldAck: false,
      backoffMs: 300_000,
    }
  }

  if (code === 'IDEMPOTENCY_KEY_REUSED' || /IDEMPOTENCY_KEY_REUSED|тот же clientRef уже использован/i.test(msg)) {
    return {
      class: DEBT_OP_ERROR_CLASS.PERMANENT_REJECT,
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: msg,
      status: status || 409,
      shouldRevert: false,
      shouldDelete: false,
      shouldAck: false,
      backoffMs: 600_000,
    }
  }

  if (
    code === 'DEBT_PAY_VERSION_CONFLICT'
    || /уже погашали|уже меняли|верси.*ожидали|DEBT_PAY_VERSION/i.test(msg)
  ) {
    return {
      class: DEBT_OP_ERROR_CLASS.RETRYABLE_VERSION,
      code: code || 'DEBT_PAY_VERSION_CONFLICT',
      message: msg,
      status: status || 409,
      shouldRevert: false,
      shouldDelete: false,
      shouldAck: false,
      backoffMs: null, // use pendingRetryDelayMs
    }
  }

  if (
    code === 'CLIENT_REF_REQUIRED'
    || code === 'CARD_OWNERSHIP_CONFLICT'
    || /clientRef обязателен|ownership|карта принадлежит|неверн(ая|ый) сумм|укажите сумму/i.test(msg)
  ) {
    return {
      class: DEBT_OP_ERROR_CLASS.PERMANENT_REJECT,
      code: code || 'PERMANENT',
      message: msg,
      status: status || 400,
      shouldRevert: false,
      shouldDelete: false,
      shouldAck: false,
      backoffMs: 600_000,
    }
  }

  // Debt kinds: default to held (no silent revert) unless clearly non-debt reject
  if (k === 'debt_repay' || k === 'cash_advance' || (k === 'sale' && /долг|debt/i.test(msg))) {
    return {
      class: DEBT_OP_ERROR_CLASS.HELD_BUSINESS,
      code: code || 'HELD_UNKNOWN',
      message: msg,
      status: status || 400,
      shouldRevert: false,
      shouldDelete: false,
      shouldAck: false,
      backoffMs: 120_000,
    }
  }

  return {
    class: DEBT_OP_ERROR_CLASS.UNKNOWN,
    code: code || 'UNKNOWN',
    message: msg,
    status,
    shouldRevert: false,
    shouldDelete: false,
    shouldAck: false,
    backoffMs: null,
  }
}

export function isDebtAffectingQueueKind(kind) {
  const k = String(kind || '')
  return k === 'debt_repay' || k === 'cash_advance' || k === 'sale'
}

/**
 * Guard: appliedLocal debt ops must not be raw-deleted from queue.
 * @returns {{ ok: true } | { ok: false, code: 'DEBT_PENDING_CANNOT_REMOVE', detail: string }}
 */
export function canRemoveDebtQueueOp(row) {
  if (!row) return { ok: true }
  const kind = String(row.kind || '')
  const p = row.payload && typeof row.payload === 'object' ? row.payload : {}
  const appliedLocal = p.appliedLocal !== false
  const debtSale = kind === 'sale' && (Number(p.debtAdded) || 0) > 0.001
  const debtKind = kind === 'debt_repay' || kind === 'cash_advance' || debtSale
  if (debtKind && appliedLocal) {
    return {
      ok: false,
      code: 'DEBT_PENDING_CANNOT_REMOVE',
      detail: 'Локально применённая debt-операция не удаляется из очереди. Дождитесь отправки или устраните ошибку (held).',
    }
  }
  return { ok: true }
}

/** Synthetic / incomplete repay targets must not hit the server. */
export function isUnsafeDebtRepayTarget(orderId) {
  const s = String(orderId || '').trim()
  if (!s) return false
  if (/^cash-/i.test(s)) return true
  if (/^local-/i.test(s)) return true
  return false
}

/**
 * Hold repay until parent CA ACK supplies DL-*.
 * @returns {string|null} reason to hold, or null to send
 */
export function debtRepayHoldReason(row, allPending) {
  if (!row || String(row.kind) !== 'debt_repay') return null
  const p = row.payload || {}
  const orderId = String(p.orderId || '').trim()
  const parentRef = String(p.parentCashAdvanceClientRef || p.awaitCashAdvanceClientRef || '').trim()

  if (isUnsafeDebtRepayTarget(orderId)) {
    if (parentRef) {
      const parent = (allPending || []).find(r => String(r.clientRef) === parentRef && r.kind === 'cash_advance')
      if (parent) return `Ожидание ACK выдачи наличных (${parentRef})`
      return `Синтетический target ${orderId} — нет DL id`
    }
    return `Синтетический target ${orderId} — нельзя слать на сервер`
  }

  if (parentRef) {
    const parent = (allPending || []).find(r => String(r.clientRef) === parentRef && r.kind === 'cash_advance')
    if (parent) return `Ожидание ACK выдачи наличных (${parentRef})`
    // Parent ACKed; child should already have orderId patched. If still empty → hold.
    if (!orderId) return `Нет targetDebtLedgerId после выдачи ${parentRef}`
  }
  return null
}

/**
 * Held business errors: long backoff so they don't starve / hot-loop.
 */
export function heldBackoffMs(classification, attempts = 0) {
  if (classification?.backoffMs != null) return classification.backoffMs
  if (classification?.class === DEBT_OP_ERROR_CLASS.HELD_BUSINESS) return 300_000
  if (classification?.class === DEBT_OP_ERROR_CLASS.PERMANENT_REJECT) return 600_000
  const n = Math.max(0, Math.min(Number(attempts) || 0, 8))
  return Math.min(120_000, Math.round(2_500 * (2 ** n)))
}
