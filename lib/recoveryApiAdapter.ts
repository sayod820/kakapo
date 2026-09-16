/**
 * PC-4 — Recovery API adapter façade.
 * Documents mapping to lib/api.ts. Runtime uses recoveryApiAdapterCore
 * against isolated baseUrl only (production hosts refused by default).
 */
export {
  recoveryHttpContractMatrix,
  contractForKind,
  classifyRecoveryHttpError,
  createRecoveryHttpAdapter,
  captureConservationSnapshot,
  assertConservation,
  planRollback,
  applyRollbackDecision,
} from './recoveryApiAdapterCore.mjs'

export {
  PRODUCTION_ALLOWLIST,
  REFUSE_PRODUCTION_REPLAY,
  isProductionMutationHost,
  isAllowlistedProductionBase,
  createOperatorEnableToken,
  verifyOperatorEnableToken,
  assertProductionReplayAllowed,
} from './recoveryProductionGuardCore.mjs'

/** Explicit map: QueueKind → api.* (for audits / runbooks) */
export const RECOVERY_API_FN_BY_KIND: Record<string, string> = {
  sale: 'api.createPosSale',
  stock_receipt_create: 'api.createStockReceipt',
  shift_open: 'api.openPosShift',
  shift_close: 'api.closePosShift',
  debt_repay: 'api.debtRepayCard',
  cash_advance: 'api.cashAdvanceCard',
  card_topup: 'api.cashTopupCard',
  finance_move: 'api.createFinanceMove',
  sale_return: 'api.returnPosSale',
  stock_writeoff_create: 'api.createStockWriteoff',
  client_upsert: 'api.updateClient|createClient',
  card_loyalty_patch: 'api card loyalty PATCH',
}
