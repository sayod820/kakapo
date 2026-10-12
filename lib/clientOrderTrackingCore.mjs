// ════════════════════════════════════════════════
// Чистая логика гостевого трекинга заказов (К3).
// Без DOM: используется и витриной (lib/clientOrderTracking.ts), и тестами.
// ════════════════════════════════════════════════

/** Эндпоинт POST /orders/track принимает не больше 20 id за раз. */
export const TRACK_BATCH_MAX = 20
/** Сколько id заказов храним в браузере максимум. */
export const TRACKED_REFS_MAX = 60

/** Последние 9 цифр телефона — единый ключ клиента во всей витрине. */
export function normPhone(raw) {
  return String(raw || '').replace(/\D/g, '').slice(-9)
}

/** Добавить/обновить ссылку на заказ (свежие — первыми, без дублей, с ограничением). */
export function upsertRef(refs, id, phone, max = TRACKED_REFS_MAX) {
  const orderId = String(id || '').trim()
  const p = normPhone(phone)
  if (!orderId || !p) return Array.isArray(refs) ? refs.slice() : []
  const list = (Array.isArray(refs) ? refs : []).filter(r => r && String(r.id) !== orderId)
  list.unshift({ id: orderId, phone: p, ts: Date.now() })
  return list.slice(0, max)
}

/** id известных заказов этого телефона (свежие — первыми). */
export function collectRefsForPhone(refs, phone, limit = TRACK_BATCH_MAX) {
  const p = normPhone(phone)
  if (!p) return []
  const seen = new Set()
  const out = []
  for (const r of (Array.isArray(refs) ? refs : [])) {
    if (!r || typeof r.id !== 'string') continue
    if (normPhone(r.phone) !== p) continue
    if (seen.has(r.id)) continue
    seen.add(r.id)
    out.push(r)
    if (out.length >= limit) break
  }
  return out
}

// Поля публичного ответа трекинга, которые заменяют локальную копию заказа.
const TRACKED_FIELDS = [
  'status',
  'marketStatus',
  'restParts',
  'deliveredAt',
  'deliveredAtIso',
  'cancelReason',
  'courierAtClient',
  'pickedUpIds',
  'courier',
  'assembler',
  'courierRoute',
  'total',
  'deliveryFee',
  'payment_method',
  'pay',
  'weightKg',
  'creditAmount',
  'bonusSpent',
]

function mergeOne(local, tracked) {
  let patch = null
  for (const field of TRACKED_FIELDS) {
    const value = tracked[field]
    if (value === undefined) continue
    if (JSON.stringify(local[field]) === JSON.stringify(value)) continue
    if (!patch) patch = {}
    patch[field] = value
  }
  // Локальная копия без позиций (после перезагрузки) — берём позиции из ответа.
  if ((!local.items || !local.items.length) && tracked.items && tracked.items.length) {
    if (!patch) patch = {}
    patch.items = tracked.items
  }
  return patch ? { ...local, ...patch } : local
}

/**
 * Влить свежие публичные данные трекинга в локальный список заказов.
 * `phone` проставляется на новые заказы: публичный ответ намеренно не отдаёт
 * контакты, а витрина сопоставляет «Мои заказы» по телефону.
 * Возвращает исходный массив, если ничего не изменилось (для стабильности ссылок React).
 */
export function mergeTrackedIntoOrders(orders, tracked, phone) {
  if (!Array.isArray(tracked) || !tracked.length) return orders
  const byId = new Map()
  for (const o of (Array.isArray(orders) ? orders : [])) byId.set(String(o.id), o)
  const ownPhone = String(phone || '').trim()
  let changed = false
  for (const t of tracked) {
    const id = String((t && t.id) || '')
    if (!id) continue
    const local = byId.get(id)
    if (!local) {
      byId.set(id, ownPhone ? { ...t, client: { ...((t && t.client) || {}), phone: ownPhone } } : t)
      changed = true
      continue
    }
    const merged = mergeOne(local, t)
    if (merged !== local) {
      byId.set(id, merged)
      changed = true
    }
  }
  return changed ? Array.from(byId.values()) : orders
}
