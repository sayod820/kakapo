/**
 * Atomic Desktop debt repayment commit.
 * SQLite transaction: outbox + card/client entities + shift mirror (+ optional history).
 * Memory/Zustand applied ONLY after COMMIT.
 */
import { getKakapoDesktop, isKakapoDesktop } from './desktopBridge'
import { isPerfEnabled, perfNote } from './devTelemetry'
import type { PendingOp } from './offline'
import type { AdminCard } from './cardCrm'
import type { AdminClient } from './clientCrm'
import type { PosShift } from './types'

export type LocalDebtRepayCommitInput = {
  queueRow: PendingOp
  card?: AdminCard | null
  client?: AdminClient | null
  shift?: PosShift | null
  debtHistoryKey?: string
  debtHistory?: unknown
  queueSeq?: number
  failAt?: string
}

export type LocalDebtRepayCommitResult =
  | { ok: true; clientRef: string; ms: number }
  | { ok: false; error: string; code?: string; rolledBack?: boolean; ms: number }

export function canAtomicLocalDebtRepayCommit(): boolean {
  if (!isKakapoDesktop()) return false
  const desk = getKakapoDesktop()
  return typeof desk?.localDbDebtRepayCommit === 'function'
}

export async function commitLocalDebtRepayAtomic(
  input: LocalDebtRepayCommitInput,
): Promise<LocalDebtRepayCommitResult> {
  const t0 = performance.now()
  const desk = getKakapoDesktop()
  if (!desk?.localDbDebtRepayCommit) {
    return {
      ok: false,
      error: 'debt_repay_commit_unavailable',
      code: 'UNAVAILABLE',
      ms: performance.now() - t0,
    }
  }
  try {
    const res = await desk.localDbDebtRepayCommit({
      queueRow: input.queueRow,
      card: input.card || undefined,
      client: input.client || undefined,
      shift: input.shift || undefined,
      debtHistoryKey: input.debtHistoryKey,
      debtHistory: input.debtHistory,
      queueSeq: input.queueSeq,
      failAt: input.failAt,
    })
    const ms = performance.now() - t0
    if (isPerfEnabled()) {
      perfNote('local_transaction_ms', ms, res.ok ? 'debt_repay_ok' : 'debt_repay_fail')
    }
    if (!res?.ok) {
      return {
        ok: false,
        error: String(res?.error || 'debt_repay_commit_failed'),
        code: res?.code,
        rolledBack: !!res?.rolledBack,
        ms,
      }
    }
    return {
      ok: true,
      clientRef: String(res.clientRef || input.queueRow.clientRef),
      ms,
    }
  } catch (e) {
    const ms = performance.now() - t0
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      rolledBack: true,
      ms,
    }
  }
}

export async function setLocalDebtRepayCommitFailAt(stage: string): Promise<void> {
  const desk = getKakapoDesktop()
  if (!desk?.localDbDebtRepayCommitSetFailAt) return
  await desk.localDbDebtRepayCommitSetFailAt(stage)
}
