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
  if (Array.isArray(json.clients) && json.clients.length) return true
  if (Array.isArray(json.cards) && json.cards.length) return true
  if (Array.isArray(json.stockLayers) && json.stockLayers.length) return true
  const pos = json.pos || {}
  for (const k of ['sales', 'shifts', 'receipts', 'writeoffs', 'revisions', 'financeMoves', 'expenses', 'suppliers']) {
    if (Array.isArray(pos[k]) && pos[k].length) return true
  }
  return false
}

async function pullInbound(): Promise<boolean> {
  let has = false
  try {
    const since = await getPosLiteSyncCursor()
    const delta = await api.getSyncChanges(since || undefined, { scope: 'pos-lite' })
    if (delta?.cursor) {
      await setPosLiteSyncCursor(String(delta.cursor))
      try { localStorage.setItem(POS_LITE_CURSOR_KEY, String(delta.cursor)) } catch { /* ignore */ }
    }
    if (deltaHasWork(delta)) {
      await stashInboundLocal('pos-lite', delta)
      has = true
    }
  } catch { /* best-effort */ }

  try {
    const pending = await getPending()
    if (pending.some(r => !r.failed)) return has
    const since = await getSyncCursor()
    const delta = await api.getSyncChanges(since || undefined)
    if (delta?.cursor) await setSyncCursor(String(delta.cursor))
    if (deltaHasWork(delta)) {
      await stashInboundLocal('sync', delta)
      has = true
    }
  } catch { /* best-effort */ }
  return has
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
      const has = await pullInbound()
      if (has) {
        emitUi('inbound-ready')
        try { await consumeInboundFromLocal() } catch { /* ignore */ }
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

export async function kickInProcessSyncChannel(opts?: { mode?: SyncKickMode }): Promise<void> {
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
  }, 60000)
}
