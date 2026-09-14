/**
 * Phase D6 — debt outbox error classifier (TS façade).
 */
export {
  DEBT_OP_ERROR_CLASS,
  AUTO_REVERT_ERROR_CODES,
  MANUAL_HELD_ERROR_CODES,
  AUTO_RETRY_CODES,
  HELD_CODES,
  PERMANENT_CODES,
  classifyDebtOpError,
  isDebtAffectingQueueKind,
  canRemoveDebtQueueOp,
  isUnsafeDebtRepayTarget,
  debtRepayHoldReason,
  heldBackoffMs,
} from './debtOpErrorClassifierCore.mjs'
