// ════════════════════════════════════════════════
// Гостевой трекинг заказов магазина (К3).
//
// Покупатель без входа видит свой заказ: мы запоминаем id заказов,
// оформленных из этого браузера, и обновляем их статус через
// POST /orders/track (телефон + id). Сотруднических данных тут нет.
//
// Чистая логика — в lib/clientOrderTrackingCore.mjs (её покрывает тест).
// ════════════════════════════════════════════════
import {
  TRACK_BATCH_MAX,
  TRACKED_REFS_MAX,
  normPhone,
  upsertRef,
  collectRefsForPhone,
  mergeTrackedIntoOrders,
} from './clientOrderTrackingCore.mjs'

export { TRACK_BATCH_MAX, normPhone, mergeTrackedIntoOrders }

const IDS_KEY = 'kakapo_client_order_ids_v1'

export interface TrackedOrderRef {
  id: string
  phone: string
  ts: number
}

function readRefs(): TrackedOrderRef[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(IDS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (r): r is TrackedOrderRef =>
        !!r && typeof r === 'object' && typeof r.id === 'string' && !!r.id,
    )
  } catch {
    return []
  }
}

function writeRefs(refs: TrackedOrderRef[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(IDS_KEY, JSON.stringify(refs.slice(0, TRACKED_REFS_MAX)))
  } catch {
    /* quota / приватный режим */
  }
}

/** Запомнить оформленный заказ, чтобы после перезагрузки его можно было отследить. */
export function rememberClientOrder(orderId?: string | null, phone?: string | null) {
  const id = String(orderId || '').trim()
  if (!id || !normPhone(phone)) return
  writeRefs(upsertRef(readRefs(), id, phone))
}

/** id известных заказов этого телефона (свежие — первыми), не больше лимита. */
export function listClientOrderIds(phone?: string | null, limit = TRACK_BATCH_MAX): string[] {
  return collectRefsForPhone(readRefs(), phone, limit).map(r => r.id)
}

/** true, если в браузере есть хоть один запомненный заказ (для раннего выхода). */
export function hasTrackedOrders(): boolean {
  return readRefs().length > 0
}
