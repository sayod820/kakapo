/**
 * Phase D3 — Android / non-Desktop local debt commit via write-ahead envelope.
 * Desktop keeps native sqlDebtRepayCommit (true SQLite transaction).
 */
import { androidPersist } from './androidPersist'
import { isTradeAndroidNative } from './tradeAndroid'
import { isKakapoDesktop } from './desktopBridge'
import {
  DEBT_OP_ENVELOPE_KV_KEY,
  buildCashAdvanceEnvelope,
  buildDebtRepayEnvelope,
  upsertArrayRow,
  upsertCashRepayLedger,
  upsertShiftRow,
} from './localDebtCommitEnvelopeCore.mjs'
import type { PendingOp } from './offline'
import type { AdminCard } from './cardCrm'
import type { AdminClient } from './clientCrm'
import type { PosShift } from './types'

export type LocalDebtEnvelopeCommitInput = {
  kind: 'debt_repay' | 'cash_advance'
  queueRow: PendingOp
  client?: AdminClient | null
  card?: AdminCard | null
  shift?: PosShift | null
  cashRepayLedgerEntry?: {
    clientRef: string
    shiftId: string
    amount: number
    method?: string
    orderId?: string
    createdAtIso?: string
  } | null
  failAt?: string
}

export type LocalDebtEnvelopeCommitResult =
  | { ok: true; clientRef: string; path: 'envelope' }
  | { ok: false; error: string; code?: string }

/** True when local-first but no Desktop SQLite debtRepayCommit IPC. */
export function canEnvelopeLocalDebtCommit(): boolean {
  if (isKakapoDesktop()) return false
  return isTradeAndroidNative() || !!androidPersist()
}

async function kvGetRaw<T>(key: string): Promise<T | null> {
  const { readCachedData } = await import('./offline')
  // envelope map lives as data_* via cacheData OR direct catalog key
  if (key === DEBT_OP_ENVELOPE_KV_KEY) {
    const v = await readCachedData<T>('debt_op_envelopes')
    return v
  }
  if (key.startsWith('data_')) {
    return readCachedData<T>(key.slice(5))
  }
  const { readCachedClients } = await import('./offline')
  if (key === 'catalog_clients') return (await readCachedClients()) as T | null
  return readCachedData<T>(key)
}

async function kvSetRaw(key: string, value: unknown): Promise<void> {
  const { cacheData, cacheClients } = await import('./offline')
  if (key === DEBT_OP_ENVELOPE_KV_KEY) {
    await cacheData('debt_op_envelopes', value)
    return
  }
  if (key === 'catalog_clients') {
    await cacheClients(value as any)
    return
  }
  if (key === 'data_clients') {
    await cacheData('clients', value)
    return
  }
  if (key === 'data_cards') {
    await cacheData('cards', value)
    return
  }
  if (key === 'data_pos_snapshot') {
    await cacheData('pos_snapshot', value)
    return
  }
  if (key === 'data_debt_repay_cash_ledger') {
    await cacheData('debt_repay_cash_ledger', value)
    return
  }
  await cacheData(key.replace(/^data_/, ''), value)
}

async function readEnvelopeMap(): Promise<Record<string, any>> {
  const raw = await kvGetRaw<Record<string, any>>(DEBT_OP_ENVELOPE_KV_KEY)
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...raw }
  return {}
}

async function writeEnvelopeMap(map: Record<string, any>): Promise<void> {
  await kvSetRaw(DEBT_OP_ENVELOPE_KV_KEY, map)
}

async function putQueueDurable(row: PendingOp): Promise<void> {
  // LS mirror first (sync)
  try {
    const { mirrorPendingAfterNativeCommit } = await import('./offline')
    await mirrorPendingAfterNativeCommit(row)
  } catch { /* ignore */ }
  const files = androidPersist()
  if (files) {
    const ok = await files.queuePut(row)
    if (!ok) throw new Error('android_queue_put_failed')
  }
}

async function applyEnvelopeEffects(env: any, failAt = ''): Promise<void> {
  const stage = String(failAt || '').trim()

  if (stage === 'after_intent') throw Object.assign(new Error('TEST_FAIL_AFTER_INTENT'), { code: 'TEST_FAIL_AFTER_INTENT' })

  if (!env?.queueRow) throw new Error('missing_queue_row')
  await putQueueDurable(env.queueRow as PendingOp)
  if (stage === 'after_queue') throw Object.assign(new Error('TEST_FAIL_AFTER_QUEUE'), { code: 'TEST_FAIL_AFTER_QUEUE' })

  if (env.card && (env.card.num || env.card.id)) {
    const num = String(env.card.num || env.card.id)
    const cards = (await kvGetRaw<any[]>('data_cards')) || []
    await kvSetRaw('data_cards', upsertArrayRow(cards, 'num', num, env.card))
  }
  if (stage === 'after_card') throw Object.assign(new Error('TEST_FAIL_AFTER_CARD'), { code: 'TEST_FAIL_AFTER_CARD' })

  if (env.client && env.client.id) {
    const id = String(env.client.id)
    const clients = (await kvGetRaw<any[]>('data_clients')) || []
    const catalog = (await kvGetRaw<any[]>('catalog_clients')) || []
    await kvSetRaw('data_clients', upsertArrayRow(clients, 'id', id, env.client))
    await kvSetRaw('catalog_clients', upsertArrayRow(catalog, 'id', id, env.client))
  }
  if (stage === 'after_client') throw Object.assign(new Error('TEST_FAIL_AFTER_CLIENT'), { code: 'TEST_FAIL_AFTER_CLIENT' })

  if (env.shift && env.shift.id) {
    const snap = (await kvGetRaw<any>('data_pos_snapshot')) || {}
    const next = { ...snap, shifts: upsertShiftRow(snap.shifts, env.shift) }
    await kvSetRaw('data_pos_snapshot', next)
  }
  if (stage === 'after_shift') throw Object.assign(new Error('TEST_FAIL_AFTER_SHIFT'), { code: 'TEST_FAIL_AFTER_SHIFT' })

  if (env.cashRepayLedgerEntry) {
    const led = (await kvGetRaw<any[]>('data_debt_repay_cash_ledger')) || []
    await kvSetRaw('data_debt_repay_cash_ledger', upsertCashRepayLedger(led, env.cashRepayLedgerEntry))
    try {
      const { replaceDebtRepayCashLedger } = await import('./debtRepayCashLedger')
      const next = upsertCashRepayLedger(
        (await kvGetRaw<any[]>('data_debt_repay_cash_ledger')) || [],
        env.cashRepayLedgerEntry,
      )
      replaceDebtRepayCashLedger(next as any)
    } catch { /* ignore */ }
  }
  if (stage === 'after_ledger') throw Object.assign(new Error('TEST_FAIL_AFTER_LEDGER'), { code: 'TEST_FAIL_AFTER_LEDGER' })
  if (stage === 'before_clear') throw Object.assign(new Error('TEST_FAIL_BEFORE_CLEAR'), { code: 'TEST_FAIL_BEFORE_CLEAR' })
}

/**
 * Durable local debt op for Android file store.
 * Intent envelope first → apply absolute effects → clear envelope.
 */
export async function commitLocalDebtOpEnvelope(
  input: LocalDebtEnvelopeCommitInput,
): Promise<LocalDebtEnvelopeCommitResult> {
  const clientRef = String(input.queueRow?.clientRef || '').trim()
  if (!clientRef) return { ok: false, error: 'missing_client_ref', code: 'MISSING_REF' }

  const built = input.kind === 'cash_advance'
    ? buildCashAdvanceEnvelope({
      clientRef,
      queueRow: input.queueRow,
      client: input.client,
      card: input.card,
      shift: input.shift,
      createdAtIso: input.queueRow.createdAtIso,
    })
    : buildDebtRepayEnvelope({
      clientRef,
      queueRow: input.queueRow,
      client: input.client,
      card: input.card,
      shift: input.shift,
      cashRepayLedgerEntry: input.cashRepayLedgerEntry,
      createdAtIso: input.queueRow.createdAtIso,
    })

  try {
    if (String(input.failAt || '') === 'before_intent') {
      throw Object.assign(new Error('TEST_FAIL_BEFORE_INTENT'), { code: 'TEST_FAIL_BEFORE_INTENT' })
    }

    const map = await readEnvelopeMap()
    map[clientRef] = { ...built, state: 'intent' }
    await writeEnvelopeMap(map)

    await applyEnvelopeEffects(built, input.failAt)

    const after = await readEnvelopeMap()
    delete after[clientRef]
    await writeEnvelopeMap(after)

    return { ok: true, clientRef, path: 'envelope' }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      code: (e as any)?.code,
    }
  }
}

/** Startup / hydrate: finish any leftover intent envelopes exactly once. */
export async function recoverLocalDebtOpEnvelopes(): Promise<number> {
  if (!canEnvelopeLocalDebtCommit()) return 0
  try {
    const map = await readEnvelopeMap()
    const refs = Object.keys(map)
    let n = 0
    for (const ref of refs) {
      const env = map[ref]
      if (!env || env.state === 'committed') {
        delete map[ref]
        continue
      }
      await applyEnvelopeEffects(env)
      delete map[ref]
      n += 1
    }
    await writeEnvelopeMap(map)
    return n
  } catch {
    return 0
  }
}

export { buildCashAdvanceEnvelope, buildDebtRepayEnvelope }
