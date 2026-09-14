/**
 * Phase D1 — DebtOperation model (TS façade).
 * Pure re-exports; no runtime wiring into sale/repay/sync.
 */
import {
  DEBT_OPERATION_TYPES,
  DEBT_OPERATION_SYNC_STATES,
  DEBT_OPERATION_METHODS,
  round2,
  moneyToCents,
  centsToMoney,
  isSyntheticCashTarget,
  isCanonicalDebtLedgerTarget,
  toDebtOperationFromSale as toSaleCore,
  toDebtOperationFromRepayment as toRepayCore,
  toDebtOperationFromCashAdvance as toAdvanceCore,
  validateDebtOperation as validateCore,
  serializeDebtOperation as serializeCore,
  deserializeDebtOperation as deserializeCore,
} from './debtOperationCore.mjs'

export type DebtOperationType = 'sale_on_credit' | 'cash_advance' | 'debt_repay'
export type DebtOperationSyncState = 'pending' | 'syncing' | 'acked' | 'failed' | 'held'
export type DebtOperationMethod = 'cash' | 'card' | 'other'

export interface DebtOperation {
  operationId: string
  clientRef: string
  type: DebtOperationType
  clientId: string
  cardNum?: string | null
  amount: number
  method?: DebtOperationMethod | null
  targetDebtLedgerId?: string | null
  targetOrderId?: string | null
  saleId?: string | null
  shiftId?: string | null
  debtDelta: number
  createdAt: string
  opSeq?: number | null
  syncState: DebtOperationSyncState
  appliedLocal: boolean
}

export interface DebtOperationValidation {
  ok: boolean
  errors: string[]
}

export {
  DEBT_OPERATION_TYPES,
  DEBT_OPERATION_SYNC_STATES,
  DEBT_OPERATION_METHODS,
  round2,
  moneyToCents,
  centsToMoney,
  isSyntheticCashTarget,
  isCanonicalDebtLedgerTarget,
}

export function toDebtOperationFromSale(input: Record<string, unknown> = {}): DebtOperation {
  return toSaleCore(input) as DebtOperation
}

export function toDebtOperationFromRepayment(input: Record<string, unknown> = {}): DebtOperation {
  return toRepayCore(input) as DebtOperation
}

export function toDebtOperationFromCashAdvance(input: Record<string, unknown> = {}): DebtOperation {
  return toAdvanceCore(input) as DebtOperation
}

export function validateDebtOperation(op: unknown): DebtOperationValidation {
  return validateCore(op) as DebtOperationValidation
}

export function serializeDebtOperation(op: DebtOperation): string {
  return serializeCore(op)
}

export function deserializeDebtOperation(raw: string): DebtOperation {
  return deserializeCore(raw) as DebtOperation
}
