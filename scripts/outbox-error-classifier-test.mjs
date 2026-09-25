/**
 * Unified outbox error classifier — pure tests.
 * Run: node scripts/outbox-error-classifier-test.mjs
 */
import {
  OUTBOX_ERROR_CLASS as C,
  classifyOutboxError,
  outboxBackoffMs,
  outboxRetryPolicy,
} from '../lib/outboxErrorClassifierCore.mjs'

let pass = 0
let fail = 0
function t(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (e) {
    fail++
    console.log(`  FAIL ${name}: ${e.message}`)
  }
}
function eq(a, b, msg = '') {
  if (a !== b) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}
function httpErr(message, status, code) {
  const e = new Error(message)
  e.status = status
  if (code) e.code = code
  return e
}

console.log('outbox-error-classifier')

t('401 AUTH_REQUIRED → RETRYABLE auth', () => {
  const c = classifyOutboxError('sale', httpErr('Требуется авторизация', 401, 'AUTH_REQUIRED'))
  eq(c.class, C.RETRYABLE); eq(c.auth, true)
})
t('auth code only in message', () => {
  const c = classifyOutboxError('expense_create', 'Требуется авторизация [AUTH_REQUIRED]')
  eq(c.class, C.RETRYABLE); eq(c.auth, true)
})
t('500 → RETRYABLE', () => eq(classifyOutboxError('sale', httpErr('boom', 500)).class, C.RETRYABLE))
t('429 → RETRYABLE', () => eq(classifyOutboxError('product_upsert', httpErr('Too many requests', 429)).class, C.RETRYABLE))
t('deadlock text → RETRYABLE', () => eq(classifyOutboxError('sale', 'deadlock detected').class, C.RETRYABLE))
t('BrokenRefError → DEPENDENCY', () => {
  const e = new Error('Связанная операция ещё не ушла'); e.name = 'BrokenRefError'
  eq(classifyOutboxError('shift_close', e).class, C.DEPENDENCY)
})
t('сначала дождитесь → DEPENDENCY', () => eq(classifyOutboxError('sale_return', 'Сначала дождитесь отправки чека').class, C.DEPENDENCY))

t('sale IDEMPOTENCY_KEY_REUSED → COMMITTED', () =>
  eq(classifyOutboxError('sale', httpErr('тот же clientRef уже использован', 409, 'IDEMPOTENCY_KEY_REUSED')).class, C.COMMITTED))
t('expense IDEMPOTENCY → COMMITTED', () =>
  eq(classifyOutboxError('expense_create', 'x [IDEMPOTENCY_KEY_REUSED]').class, C.COMMITTED))
t('debt_repay IDEMPOTENCY → NEEDS_REPAIR (never auto-ack debt)', () =>
  eq(classifyOutboxError('debt_repay', 'x [IDEMPOTENCY_KEY_REUSED]').class, C.NEEDS_REPAIR))

t('sale SHIFT_CLOSED → NEEDS_REPAIR (never revert)', () =>
  eq(classifyOutboxError('sale', httpErr('Смена уже закрыта', 409, 'SHIFT_CLOSED')).class, C.NEEDS_REPAIR))
t('sale SHIFT_CASHIER_MISMATCH → NEEDS_REPAIR', () =>
  eq(classifyOutboxError('sale', 'Смена другого кассира (SHIFT_CASHIER_MISMATCH)').class, C.NEEDS_REPAIR))
t('sale недостаточно остатка → CONFLICT', () =>
  eq(classifyOutboxError('sale', httpErr('Недостаточно остатка: товар #12', 409)).class, C.CONFLICT))
t('sale долг клиента уже меняли → NEEDS_REPAIR', () =>
  eq(classifyOutboxError('sale', 'Долг клиента уже меняли').class, C.NEEDS_REPAIR))
t('card_topup версия → CONFLICT', () =>
  eq(classifyOutboxError('card_topup', 'Бонусы уже меняли, версия 3, ожидали 2').class, C.CONFLICT))
t('shift_close conflict → NEEDS_REPAIR (must keep)', () =>
  eq(classifyOutboxError('shift_close', 'Смена уже закрыта').class, C.NEEDS_REPAIR))
t('stock_receipt_update conflict → NEEDS_REPAIR', () =>
  eq(classifyOutboxError('stock_receipt_update', 'Приходы уже меняли').class, C.NEEDS_REPAIR))
t('product validation → INVALID', () =>
  eq(classifyOutboxError('product_upsert', httpErr('Название обязательно', 400)).class, C.INVALID))
t('403 → INVALID', () => eq(classifyOutboxError('client_upsert', httpErr('nope', 403)).class, C.INVALID))
t('shift_close 403 → NEEDS_REPAIR', () => eq(classifyOutboxError('shift_close', httpErr('nope', 403)).class, C.NEEDS_REPAIR))
t('unknown 400 → NEEDS_REPAIR', () => eq(classifyOutboxError('finance_move', httpErr('что-то странное', 400)).class, C.NEEDS_REPAIR))

t('backoff: NEEDS_REPAIR ≥ 60s, ≤ 10min', () => {
  eq(outboxBackoffMs(C.NEEDS_REPAIR, 0), 60_000)
  eq(outboxBackoffMs(C.NEEDS_REPAIR, 20), 600_000)
})
t('backoff: RETRYABLE ≤ 120s', () => eq(outboxBackoffMs(C.RETRYABLE, 20), 120_000))

const NOW = 1_000_000
t('policy: pending due → send', () => eq(outboxRetryPolicy({ kind: 'sale', failed: false }, NOW), 'send'))
t('policy: pending cooldown → wait', () => eq(outboxRetryPolicy({ kind: 'sale', failed: false, nextRetryAt: NOW + 1 }, NOW), 'wait'))
t('policy: failed NEEDS_REPAIR due → send', () =>
  eq(outboxRetryPolicy({ kind: 'sale', failed: true, errorClass: C.NEEDS_REPAIR, nextRetryAt: NOW - 1 }, NOW), 'send'))
t('policy: failed NEEDS_REPAIR cooldown → wait', () =>
  eq(outboxRetryPolicy({ kind: 'sale', failed: true, errorClass: C.NEEDS_REPAIR, nextRetryAt: NOW + 1 }, NOW), 'wait'))
t('policy: failed INVALID → manual', () =>
  eq(outboxRetryPolicy({ kind: 'product_upsert', failed: true, errorClass: C.INVALID }, NOW), 'manual'))
t('policy: legacy failed row classified from lastError (shift) → send', () =>
  eq(outboxRetryPolicy({ kind: 'sale', failed: true, lastError: 'Смена уже закрыта' }, NOW), 'send'))
t('policy: legacy failed validation → manual', () =>
  eq(outboxRetryPolicy({ kind: 'product_upsert', failed: true, lastError: 'Название обязательно' }, NOW), 'manual'))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
