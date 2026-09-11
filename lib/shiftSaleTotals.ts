/**
 * Current-shift totals from unique posSales (exact shiftId).
 * UI/close must use these — not sticky denormalized shift.salesCount/salesCash.
 */
import type { PosSale, PosShift } from './types'
import {
  saleDedupeKey as saleDedupeKeyCore,
  preferSaleRow as preferSaleRowCore,
  uniqueSalesForShift as uniqueSalesForShiftCore,
  aggregateShiftSaleTotals as aggregateShiftSaleTotalsCore,
  overlayShiftSaleTotals as overlayShiftSaleTotalsCore,
  expectedTillCashFromShift as expectedTillCashFromShiftCore,
} from './shiftSaleTotalsCore.mjs'

export type ShiftSaleTotals = {
  salesCount: number
  revenue: number
  salesCash: number
  salesCard: number
  salesCredit: number
  paidWallet: number
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

export function overlayShiftSaleTotals(
  shift: PosShift,
  sales: PosSale[] | null | undefined,
): PosShift {
  return overlayShiftSaleTotalsCore(shift, sales) as PosShift
}

export function expectedTillCashFromShift(
  shift: Pick<PosShift, 'openingCash' | 'salesCash' | 'cashInTotal' | 'expenseTotal'>,
): number {
  return expectedTillCashFromShiftCore(shift)
}
