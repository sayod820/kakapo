/**
 * Offline V2 — полный офлайн Trade (SQLite + автосинк).
 *
 * Режим:
 * - off     — ничего не делаем
 * - shadow  — только теневая запись в SQLite (касса не меняется)
 * - on      — полный офлайн: товары, категории, клиенты, поставщики, финансы, долги
 *
 * По умолчанию:
 * - Desktop KAKAPO Касса → on
 * - Браузер → off
 *
 * Явно задать:
 *   localStorage.setItem('kakapo-offline-v2', 'shadow' | 'on' | 'off')
 */
import { getKakapoDesktop, isKakapoDesktop } from './desktopBridge'

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
  try {
    const raw = String(localStorage.getItem(LS_KEY) || '').trim().toLowerCase()
    if (raw === 'shadow' || raw === 'on' || raw === 'off') return raw
  } catch { /* ignore */ }
  // Desktop: полный офлайн по умолчанию (SQLite + очередь).
  // Браузер: выкл — без локальной SQLite.
  return isKakapoDesktop() ? 'on' : 'off'
}

export function setOfflineV2Mode(mode: OfflineV2Mode) {
  if (typeof window === 'undefined') return
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
 * Теневая запись. Никогда не бросает наружу и не блокирует кассу.
 * Вызывать через void shadowMirrorPut(...)
 */
export function shadowMirrorPut(kind: MirrorKind, id: string, data: unknown): void {
  if (!isOfflineV2Shadow()) return
  const rowId = String(id || '').trim()
  if (!rowId) return
  void (async () => {
    try {
      const desk = getKakapoDesktop()
      if (isKakapoDesktop() && desk?.localDbMirrorPut) {
        await desk.localDbMirrorPut({ kind, id: rowId, data })
        return
      }
      // Браузер: лёгкий fallback в localStorage (только для отладки)
      if (typeof window === 'undefined') return
      const key = `kakapo-mirror:${kind}:${rowId}`
      localStorage.setItem(key, JSON.stringify({
        kind,
        id: rowId,
        data,
        updatedAtIso: new Date().toISOString(),
      }))
    } catch (e) {
      try { console.warn('[offlineV2] shadow mirror failed', kind, rowId, e) } catch { /* ignore */ }
    }
  })()
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
