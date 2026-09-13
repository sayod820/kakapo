/**
 * Atomic Desktop cash-advance commit.
 * Reuses the same SQLite txn shape as debt repay (queue + card/client + shift).
 * Memory/Zustand applied ONLY after COMMIT.
 */
export {
  canAtomicLocalDebtRepayCommit as canAtomicLocalCashAdvanceCommit,
  commitLocalDebtRepayAtomic as commitLocalCashAdvanceAtomic,
  setLocalDebtRepayCommitFailAt as setLocalCashAdvanceCommitFailAt,
} from './localDebtRepayAtomic'
export type {
  LocalDebtRepayCommitInput as LocalCashAdvanceCommitInput,
  LocalDebtRepayCommitResult as LocalCashAdvanceCommitResult,
} from './localDebtRepayAtomic'
