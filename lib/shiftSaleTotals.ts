/**
 * Current-shift totals from unique posSales (exact shiftId).
 * UI/close must use these — not sticky denormalized shift.salesCount/salesCash.
 */
import type { PosSale, PosShift } from './types'
import {
  cashDebtRepayRowsForShift,
  withPreservedDebtRepayCash,
} from './debtRepayCashLedger'
import {
  saleDedupeKey as saleDedupeKeyCore,
  preferSaleRow as preferSaleRowCore,
  uniqueSalesForShift as uniqueSalesForShiftCore,
  aggregateShiftSaleTotals as aggregateShiftSaleTotalsCore,
  overlayShiftSaleTotals as overlayShiftSaleTotalsCore,
  expectedTillCashFromShift as expectedTillCashFromShiftCore,
  uniqueDebtRepayCashForShift as uniqueDebtRepayCashForShiftCore,
} from './shiftSaleTotalsCore.mjs'

export type ShiftSaleTotals = {
  salesCount: number
  revenue: number
  salesCash: number
  salesCard: number
  salesCredit: number
  paidWallet: number
}

export type DebtRepayCashRow = {
  clientRef?: string
  id?: string
  shiftId?: string
  amount?: number
  method?: string
  type?: string
}

export function saleDedupeKey(sale: Pick<PosSale, 'id' | 'clientRef'> | null | undefined): string {
  return saleDedupeKeyCore(sale)
}

export function preferSaleRow(a: PosSale, b: PosSale): PosSale {
  return preferSaleRowCore(a, b) as PosSale
}

export function uniqueSalesForShift(
  sales: PosSale[] | null | undefined,
  shiftId: string | null | undefined,
): PosSale[] {
  return uniqueSalesForShiftCore(sales, shiftId) as PosSale[]
}

export function aggregateShiftSaleTotals(
  sales: PosSale[] | null | undefined,
  shiftId: string | null | undefined,
): ShiftSaleTotals {
  return aggregateShiftSaleTotalsCore(sales, shiftId) as ShiftSaleTotals
}

export function uniqueDebtRepayCashForShift(
  repayRows: DebtRepayCashRow[] | null | undefined,
  shiftId: string | null | undefined,
): number {
  return uniqueDebtRepayCashForShiftCore(repayRows, shiftId)
}

export function overlayShiftSaleTotals(
  shift: PosShift,
  sales: PosSale[] | null | undefined,
  repayRows?: DebtRepayCashRow[] | null,
): PosShift {
  return overlayShiftSaleTotalsCore(shift, sales, repayRows) as PosShift
}

/**
 * Sale-row overlay + durable cash debt-repay ledger.
 * Reconstructs debtRepayCash after ACK/sync when outbox row is gone.
 */
export function overlayShiftSaleTotalsWithDebtRepay(
  shift: PosShift,
  sales: PosSale[] | null | undefined,
  extraRepayRows?: DebtRepayCashRow[] | null,
): PosShift {
  const rows = [
    ...cashDebtRepayRowsForShift(String(shift.id || '')),
    ...(extraRepayRows || []),
  ]
  const preserved = withPreservedDebtRepayCash(shift, shift) as PosShift
  return overlayShiftSaleTotalsCore(preserved, sales, rows) as PosShift
}

export function expectedTillCashFromShift(
  shift: Pick<PosShift, 'openingCash' | 'salesCash' | 'cashInTotal' | 'expenseTotal' | 'debtRepayCash'>,
): number {
  return expectedTillCashFromShiftCore(shift)
}
