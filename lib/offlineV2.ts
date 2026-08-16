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
  // ПК-приложение: всегда полный local-first, нельзя выключить через LS
  if (isKakapoDesktop()) return 'on'
  if (isTradeAndroidNative()) return 'on'
  try {
    const raw = String(localStorage.getItem(LS_KEY) || '').trim().toLowerCase()
    if (raw === 'shadow' || raw === 'on' || raw === 'off') return raw
  } catch { /* ignore */ }
  return 'off'
}

export function setOfflineV2Mode(mode: OfflineV2Mode) {
  if (typeof window === 'undefined') return
  // На ПК режим всегда on — не даём записать off/shadow
  if (isKakapoDesktop() || isTradeAndroidNative()) {
    try { localStorage.setItem(LS_KEY, 'on') } catch { /* ignore */ }
    return
  }
  try {
    localStorage.setItem(LS_KEY, mode)
  } catch { /* ignore */ }
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
 * На ПК-приложении всегда true.
 */
export function isTradeLocalFirst(): boolean {
  return isKakapoDesktop() || isTradeAndroidNative() || isOfflineV2Full()
}

/** Вызвать при старте Trade: зафиксировать on на ПК и в Android-приложении */
export function ensureDesktopLocalFirst(): void {
  if (!isKakapoDesktop() && !isTradeAndroidNative()) return
  try { localStorage.setItem(LS_KEY, 'on') } catch { /* ignore */ }
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
