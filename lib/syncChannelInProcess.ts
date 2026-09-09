/**
 * SYNC-канал для Android / non-Electron local-first.
 * Единственное место (вне desktop main), где trade sync ходит на сервер.
 * UI только kick + consumeInboundFromLocal.
 */
import { api } from './api'
import { flushQueue, getPending } from './offline'
import { getSyncCursor, getPosLiteSyncCursor, setPosLiteSyncCursor, setSyncCursor } from './localEntities'
import { stashInboundLocal, consumeInboundFromLocal, POS_LITE_CURSOR_KEY } from './applyInboundLocal'
import { isCashierPaymentCritical } from './cashierUiGate'
import type { SyncKickMode } from './syncGate'

let running = false
let again: SyncKickMode | null = null
let startedTimer = false
let expiryDays = 14

function emitUi(type: string, extra?: Record<string, unknown>) {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('kakapo-sync-channel', { detail: { type, ...extra } }))
    }
  } catch { /* ignore */ }
}

function deltaHasWork(json: any): boolean {
  if (!json || typeof json !== 'object') return false
  if (json.full) return true
  if (Array.isArray(json.deletes) && json.deletes.length) return true
  if (Array.isArray(json.products) && json.products.length) return true
  if (Array.isArray(json.categories) && json.categories.length) return true
  if (Array.isArray(json.clients) && json.clients.length) return true
  if (Array.isArray(json.cards) && json.cards.length) return true
  if (Array.isArray(json.stockLayers) && json.stockLayers.length) return true
  const pos = json.pos || {}
  for (const k of ['sales', 'shifts', 'receipts', 'writeoffs', 'revisions', 'financeMoves', 'expenses', 'suppliers', 'posPoints', 'cashiers', 'expiry']) {
    if (Array.isArray(pos[k]) && pos[k].length) return true
  }
  return false
}

async function pullInbound(): Promise<{ has: boolean; scopes: string[] }> {
  let has = false
  const scopes: string[] = []
  const MONEY_KINDS = new Set(['debt_repay', 'card_topup', 'sale', 'sale_return'])
  const STOCK_KINDS = new Set([
    'sale', 'sale_return',
    'stock_writeoff_create', 'stock_writeoff_update', 'stock_writeoff_delete',
    'stock_revision_create', 'stock_revision_update', 'stock_revision_delete',
    'stock_receipt_create', 'stock_receipt_update', 'stock_receipt_delete',
    'stock_layer_update', 'stock_layer_delete',
  ])
  const stripPendingCrmStock = async (delta: any) => {
    if (!delta || typeof delta !== 'object') return delta
    try {
      const pending = await getPending()
      const kinds = pending.filter(r => !r.failed).map(r => String(r.kind || ''))
      if (!kinds.length) return delta
      const next = { ...delta }
      if (kinds.some(k => MONEY_KINDS.has(k))) {
        delete next.clients
        delete next.cards
      }
      if (kinds.some(k => STOCK_KINDS.has(k))) {
        delete next.products
        delete next.stockLayers
      }
      return next
    } catch {
      return delta
    }
  }
  try {
    const since = await getPosLiteSyncCursor()
    let delta = await api.getSyncChanges(since || undefined, { scope: 'pos-lite' })
    if (delta?.cursor) {
      await setPosLiteSyncCursor(String(delta.cursor))
      try { localStorage.setItem(POS_LITE_CURSOR_KEY, String(delta.cursor)) } catch { /* ignore */ }
    }
    delta = await stripPendingCrmStock(delta)
    if (deltaHasWork(delta)) {
      await stashInboundLocal('pos-lite', delta)
      has = true
    }
  } catch { /* best-effort */ }

  try {
    const since = await getSyncCursor()
    let delta = await api.getSyncChanges(since || undefined)
    if (delta?.cursor) await setSyncCursor(String(delta.cursor))
    delta = await stripPendingCrmStock(delta)
    if (deltaHasWork(delta)) {
      await stashInboundLocal('sync', delta)
      has = true
    }
  } catch { /* best-effort */ }

  // extras: vault / layers / expiry / loyalty
  try {
    const pending = await getPending()
    const kinds = pending.filter(r => !r.failed).map(r => String(r.kind || ''))
    const stockBusy = kinds.some(k => STOCK_KINDS.has(k))
    const vaultBusy = kinds.some(k =>
      k === 'vault_card_to_cash' || k === 'vault_cash_to_card' || k === 'finance_move' || k === 'expense_create',
    )
    const { pullChannelExtrasInProcess } = await import('./syncChannelExtras')
    const extraScopes = await pullChannelExtrasInProcess({
      expiryDays,
      skipLayers: stockBusy,
      skipVault: vaultBusy,
    })
    if (extraScopes.length) {
      scopes.push(...extraScopes)
      has = true
    }
  } catch { /* best-effort */ }

  return { has, scopes: [...new Set(scopes)] }
}

async function run(mode: SyncKickMode) {
  if (running) {
    again = mode
    return
  }
  running = true
  emitUi('start')
  try {
    if (mode === 'flush' || mode === 'both') {
      if (!isCashierPaymentCritical()) {
        try {
          await flushQueue()
        } catch { /* network */ }
      }
    }
    if (mode === 'inbound' || mode === 'both') {
      const { has, scopes } = await pullInbound()
      if (has) {
        emitUi('inbound-ready', { scopes })
        try { await consumeInboundFromLocal() } catch { /* ignore */ }
        if (scopes.length) {
          try {
            const { reloadStoresFromSqlite } = await import('./reloadFromSqlite')
            await reloadStoresFromSqlite(scopes as any)
          } catch { /* ignore */ }
        }
      }
    }
    emitUi('done')
  } catch (e) {
    emitUi('error', { error: e instanceof Error ? e.message : String(e) })
  } finally {
    running = false
    if (again) {
      const next = again
      again = null
      setTimeout(() => { void run(next) }, 40)
    }
  }
}

export async function kickInProcessSyncChannel(opts?: {
  mode?: SyncKickMode
  expiryDays?: number
}): Promise<void> {
  if (opts?.expiryDays != null) expiryDays = Number(opts.expiryDays) || 14
  ensureInProcessSyncTimers()
  await run(opts?.mode || 'both')
}

export function ensureInProcessSyncTimers(): void {
  if (startedTimer || typeof window === 'undefined') return
  startedTimer = true
  setInterval(() => {
    if (document.visibilityState === 'hidden') return
    if (isCashierPaymentCritical()) return
    void run('inbound')
  }, 20000)
}
