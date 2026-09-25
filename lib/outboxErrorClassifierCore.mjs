/**
 * Unified outbox error classifier (all queue kinds).
 *
 * COMMITTED    — server already holds an op with this clientRef → ack, never revert.
 * RETRYABLE    — transport / 5xx / 429 / lock / auth: retry automatically with backoff.
 * DEPENDENCY   — parent op not delivered yet: retry automatically with backoff.
 * CONFLICT     — business reject (version / stock / money): per-kind refresh or revert.
 * NEEDS_REPAIR — must-keep op (shift_close, debt, appliedLocal sale on shift issue, unknown):
 *                stays in queue, retried automatically with long backoff, visible in UI.
 * INVALID      — payload validation / permission: manual only.
 */

export const OUTBOX_ERROR_CLASS = Object.freeze({
  COMMITTED: 'COMMITTED',
  RETRYABLE: 'RETRYABLE',
  DEPENDENCY: 'DEPENDENCY',
  CONFLICT: 'CONFLICT',
  NEEDS_REPAIR: 'NEEDS_REPAIR',
  INVALID: 'INVALID',
})

const C = OUTBOX_ERROR_CLASS

const DEBT_KINDS = new Set(['debt_repay', 'cash_advance'])

/** Kinds that must never be dropped from the queue on reject. */
const MUST_KEEP_KINDS = new Set(['shift_close', 'debt_repay', 'cash_advance', 'stock_receipt_update'])

const AUTH_RE = /AUTH_REQUIRED|SESSION_EXPIRED|требуется авторизация|сессия (закрыта|истекла)|не авторизован/i
const TRANSPORT_RE = /нет связи|сеть недоступ|timeout|timed?\s*out|не отвечает|failed to fetch|networkerror|network request|ECONN|ETIMEDOUT|ENOTFOUND|временно недоступ|too many requests|deadlock|lock timeout|could not serialize|SERIALIZATION_FAILURE|LOCK_TIMEOUT|SERVICE_BUSY/i
const IDEMPOTENT_RE = /IDEMPOTENCY_KEY_REUSED|тот же clientRef уже использован/i
const DEPENDENCY_RE = /связанная операция|сначала дождитесь|дождитесь отправки|BROKEN_REF/i
const SHIFT_RE = /смена не найдена|смена уже закрыта|SHIFT_CLOSED|SHIFT_NOT_FOUND|SHIFT_POS_MISMATCH|SHIFT_CASHIER_MISMATCH/i
const CONFLICT_RE = /уже меняли|уже изменился|уже погашали|не приняли|верси.*ожидали|VERSION_CONFLICT|недостаточно остатка|недостаточно средств|недостаточно бонусов|недостаточно наличных|по партиям|осталось \d|уже полностью возвращён|можно вернуть не больше|нечего возвращать|позиция для возврата|в основном ящике|на карте только|наличных только|партия уже израсходована|поставщик не найден|товар #|укажите фактическое|уже открыта сессия|уже открыта смена|нельзя удалить|со складом|INSUFFICIENT_/i
const INVALID_RE = /обязател|некоррект|invalid|validation|VALIDATION_|forbidden|нет прав|FORBIDDEN/i

function extractMessage(err) {
  if (!err) return ''
  if (typeof err === 'string') return err
  return String(err.message || err.detail || err)
}

function extractCode(err, msg) {
  if (err && typeof err === 'object') {
    const c = String(err.code || err.errorCode || '').trim()
    if (c) return c
  }
  const m = String(msg || '').match(/\[([A-Z0-9_]+)\]\s*$/)
  return m ? m[1] : ''
}

function extractStatus(err) {
  const n = Number(err?.status || err?.statusCode || 0)
  return Number.isFinite(n) ? n : 0
}

/**
 * @param {string} kind
 * @param {unknown} err  Error (with optional .status/.code) or message string
 * @returns {{ class: string, code: string, message: string, status: number, auth: boolean }}
 */
export function classifyOutboxError(kind, err) {
  const k = String(kind || '')
  const message = extractMessage(err)
  const code = extractCode(err, message)
  const status = extractStatus(err)
  const text = `${message} ${code}`
  const out = (cls, extra = {}) => ({ class: cls, code: code || cls, message, status, auth: false, ...extra })

  if (err && typeof err === 'object' && err.name === 'BrokenRefError') return out(C.DEPENDENCY)
  if (status === 401 || AUTH_RE.test(text)) return out(C.RETRYABLE, { auth: true, code: code || 'AUTH_REQUIRED' })
  if (status >= 500 || status === 408 || status === 429 || TRANSPORT_RE.test(text)) return out(C.RETRYABLE)
  if (IDEMPOTENT_RE.test(text)) {
    return DEBT_KINDS.has(k) ? out(C.NEEDS_REPAIR, { code: 'IDEMPOTENCY_KEY_REUSED' }) : out(C.COMMITTED, { code: 'IDEMPOTENCY_KEY_REUSED' })
  }
  if (DEPENDENCY_RE.test(text)) return out(C.DEPENDENCY)
  if (DEBT_KINDS.has(k)) return out(C.NEEDS_REPAIR)
  if (k === 'sale' && SHIFT_RE.test(text)) return out(C.NEEDS_REPAIR)
  if (k === 'sale' && /долг|debt/i.test(text)) return out(C.NEEDS_REPAIR)
  if (CONFLICT_RE.test(text) || SHIFT_RE.test(text)) {
    return MUST_KEEP_KINDS.has(k) ? out(C.NEEDS_REPAIR) : out(C.CONFLICT)
  }
  if (status === 403 || INVALID_RE.test(text)) {
    return MUST_KEEP_KINDS.has(k) ? out(C.NEEDS_REPAIR) : out(C.INVALID)
  }
  return out(C.NEEDS_REPAIR)
}

/** Backoff before next automatic attempt. */
export function outboxBackoffMs(cls, attempts = 0) {
  const n = Math.max(0, Math.min(Number(attempts) || 0, 8))
  const exp = Math.round(2_500 * (2 ** n))
  switch (cls) {
    case C.RETRYABLE:
    case C.DEPENDENCY:
      return Math.min(120_000, exp)
    case C.CONFLICT:
      return Math.min(300_000, exp)
    case C.NEEDS_REPAIR:
      return Math.min(600_000, Math.max(60_000, exp))
    default:
      return 600_000
  }
}

const AUTO_CLASSES = new Set([C.RETRYABLE, C.DEPENDENCY, C.CONFLICT, C.NEEDS_REPAIR])

/**
 * Retry policy for a queue row.
 * @returns {'send' | 'wait' | 'manual'}
 *   send   — eligible now;
 *   wait   — auto-retry later (nextRetryAt in future);
 *   manual — failed with INVALID/unclassified legacy error; only forceSync revives it.
 */
export function outboxRetryPolicy(row, now = Date.now()) {
  if (!row) return 'manual'
  const due = !(Number(row.nextRetryAt) > now)
  if (!row.failed) return due ? 'send' : 'wait'
  const cls = row.errorClass || (row.lastError ? classifyOutboxError(row.kind, row.lastError).class : '')
  if (!AUTO_CLASSES.has(cls)) return 'manual'
  return due ? 'send' : 'wait'
}
