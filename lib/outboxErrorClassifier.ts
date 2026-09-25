/**
 * Unified outbox error classifier (TS façade).
 */
export {
  OUTBOX_ERROR_CLASS,
  classifyOutboxError,
  outboxBackoffMs,
  outboxRetryPolicy,
} from './outboxErrorClassifierCore.mjs'
