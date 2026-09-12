/**
 * Durable cash debt-repay ledger (Desktop/browser).
 * Core is sync (localStorage); KV mirror is best-effort async.
 */
import {
  rememberCashDebtRepay as rememberCore,
  forgetCashDebtRepay as forgetCore,
  cashDebtRepayRowsForShift as rowsCore,
  uniqueCashDebtRepayTotalForShift as totalCore,
  withPreservedDebtRepayCash as preserveCore,
  loadDebtRepayCashLedger,
  replaceDebtRepayCashLedger,
  _resetDebtRepayCashLedgerForTests,
} from './debtRepayCashLedgerCore.mjs'

const KV_KEY = 'debt_repay_cash_ledger'

function mirrorToKv() {
  void import('./offline')
    .then(({ cacheData }) => cacheData(KV_KEY, loadDebtRepayCashLedger()))
    .catch(() => {})
}

/** Hydrate from Desktop KV if present (restart). Safe to call multiple times. */
export async function hydrateDebtRepayCashLedger(): Promise<void> {
  try {
    const { readCachedData } = await import('./offline')
    const rows = await readCachedData<unknown[]>(KV_KEY)
    if (Array.isArray(rows) && rows.length) {
      // Prefer KV if it has more ops than LS (Desktop primary)
      const local = loadDebtRepayCashLedger()
      if (rows.length >= local.length) replaceDebtRepayCashLedger(rows as any)
    } else {
      mirrorToKv()
    }
  } catch { /* ignore */ }
}

export function rememberCashDebtRepay(entry: {
  clientRef?: string
  shiftId?: string
  amount?: number
  method?: string
  orderId?: string
  createdAtIso?: string
}): boolean {
  const ok = rememberCore(entry)
  if (ok) mirrorToKv()
  return ok
}

export function forgetCashDebtRepay(clientRef: string): boolean {
  const ok = forgetCore(clientRef)
  if (ok) mirrorToKv()
  return ok
}

export function cashDebtRepayRowsForShift(shiftId: string) {
  return rowsCore(shiftId)
}

export function uniqueCashDebtRepayTotalForShift(shiftId: string): number {
  return totalCore(shiftId)
}

export function withPreservedDebtRepayCash<T extends { id?: string; debtRepayCash?: number }>(
  localShift: T | null | undefined,
  remoteShift: T | null | undefined,
): T {
  return preserveCore(localShift, remoteShift) as T
}

export function debtRepayRowsForOverlay(shiftId: string) {
  return cashDebtRepayRowsForShift(String(shiftId || ''))
}

export { _resetDebtRepayCashLedgerForTests, loadDebtRepayCashLedger, replaceDebtRepayCashLedger }
