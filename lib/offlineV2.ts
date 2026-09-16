/**
 * Offline V2 — полный офлайн Trade (SQLite + автосинк).
 *
 * Режим:
 * - off     — ничего не делаем
 * - shadow  — только теневая запись в SQLite (касса не меняется)
 * - on      — полный офлайн: товары, категории, клиенты, поставщики, финансы, долги
 *
 * Правило:
 * - Desktop KAKAPO Касса → ВСЕГДА on (SQLite + очередь + двусторонний sync)
 * - Браузер → off (сервер напрямую; локальный режим не нужен)
 *
 * Явно задать (только браузер):
 *   localStorage.setItem('kakapo-offline-v2', 'shadow' | 'on' | 'off')
 */
import { getKakapoDesktop, isKakapoDesktop } from './desktopBridge'
import { isTradeAndroidNative } from './tradeAndroid'

export type OfflineV2Mode = 'off' | 'shadow' | 'on'

export type MirrorKind =
  | 'sale'
  | 'shift'
  | 'product'
  | 'client'
  | 'supplier'
  | 'stock_receipt'
  | 'stock_writeoff'
  | 'finance_move'

const LS_KEY = 'kakapo-offline-v2'

export function getOfflineV2Mode(): OfflineV2Mode {
  if (typeof window === 'undefined') return 'off'
  // ПК-приложение / Android: всегда полный local-first
  if (isKakapoDesktop()) return 'on'
  if (isTradeAndroidNative()) return 'on'
  // Браузер: всегда онлайн, без очереди (LS флаг игнорируем)
  return 'off'
}

export function setOfflineV2Mode(mode: OfflineV2Mode) {
  if (typeof window === 'undefined') return
  if (isKakapoDesktop() || isTradeAndroidNative()) {
    try { localStorage.setItem(LS_KEY, 'on') } catch { /* ignore */ }
    return
  }
  // Браузер не хранит offline-v2 — всегда off
  try { localStorage.setItem(LS_KEY, 'off') } catch { /* ignore */ }
  void mode
}

export function isOfflineV2Shadow(): boolean {
  const m = getOfflineV2Mode()
  return m === 'shadow' || m === 'on'
}

export function isOfflineV2Full(): boolean {
  return getOfflineV2Mode() === 'on'
}

/**
 * Trade local-first: сначала локально (SQLite/стор/очередь), потом sync.
 * Только ПК-касса и Android. Браузер — false.
 */
export function isTradeLocalFirst(): boolean {
  return isKakapoDesktop() || isTradeAndroidNative()
}

/** Вызвать при старте Trade: зафиксировать on на ПК и в Android-приложении */
export function ensureDesktopLocalFirst(): void {
  if (!isKakapoDesktop() && !isTradeAndroidNative()) return
  try { localStorage.setItem(LS_KEY, 'on') } catch { /* ignore */ }
}

/**
 * Браузер: выключить local-first в LS и сбросить застрявшую очередь
 * (раньше чеки могли попасть в IndexedDB/localStorage).
 */
export async function ensureBrowserOnlineOnly(): Promise<void> {
  if (typeof window === 'undefined') return
  if (isKakapoDesktop() || isTradeAndroidNative()) return
  try { localStorage.setItem(LS_KEY, 'off') } catch { /* ignore */ }
  try {
    const { clearAllPending, isLocalId } = await import('./offline')
    await clearAllPending()
    const { useOfflineSync } = await import('./offlineSync')
    await useOfflineSync.getState().refresh()
    // Drop phantom offline entities so browser never mutates via isLocalId→queueOp shortcuts
    try {
      const { usePosStore } = await import('./posStore')
      usePosStore.setState(s => ({
        receipts: (s.receipts || []).filter(r => !isLocalId(r.id)),
        writeoffs: (s.writeoffs || []).filter(w => !isLocalId(w.id)),
        revisions: (s.revisions || []).filter(r => !isLocalId(r.id)),
        expenses: (s.expenses || []).filter(e => !isLocalId(e.id)),
        financeMoves: (s.financeMoves || []).filter(m => !isLocalId(m.id)),
        sales: (s.sales || []).filter(sale => !isLocalId(sale.id)),
        shifts: (s.shifts || []).filter(sh => !isLocalId(sh.id)),
        posPoints: (s.posPoints || []).filter(p => !isLocalId(p.id)),
        cashiers: (s.cashiers || []).filter(c => !isLocalId(c.id)),
      }))
    } catch { /* ignore */ }
  } catch { /* ignore */ }
}

/**
 * Теневая запись. Никогда не бросает наружу и не блокирует кассу.
 * Вызывать через void shadowMirrorPut(...)
 */
export function shadowMirrorPut(_kind: MirrorKind, _id: string, _data: unknown): void {
  return
}

/** Удобные обёртки */
export function shadowMirrorSale(sale: { id?: string; clientRef?: string } & Record<string, unknown>) {
  const id = String(sale.id || sale.clientRef || '').trim()
  if (!id) return
  shadowMirrorPut('sale', id, sale)
}

export function shadowMirrorShift(shift: { id?: string } & Record<string, unknown>) {
  const id = String(shift.id || '').trim()
  if (!id) return
  shadowMirrorPut('shift', id, shift)
}
