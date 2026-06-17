import type { Order, OrderItem, OrderStatus, OrderType } from './types'
import { restIdToPickupId } from './pickups'

export type PartStatus = 'new' | 'assembling' | 'cooking' | 'done'

/** Приводит items к массиву (строка из админ-таблицы, объект из API и т.д.) */
export function coerceOrderItems(raw: unknown, total = 0, type: OrderType = 'market'): OrderItem[] {
  if (Array.isArray(raw)) return raw as OrderItem[]
  if (typeof raw === 'string' && raw.trim()) {
    const names = raw.split(',').map(s => s.trim()).filter(Boolean)
    if (!names.length) return []
    const perItem = total > 0 ? Math.round(total / names.length) : 0
    const source = type === 'restaurant' ? 'restaurant' as const : 'market' as const
    return names.map(name => ({
      e: '📦',
      name: name.replace(/^[^\s]+\s/, ''),
      qty: 1,
      unit: 'шт',
      price: perItem,
      source,
    }))
  }
  return []
}

export function isMarketItem(it: OrderItem): boolean {
  if (it.source === 'market') return true
  if (it.source === 'restaurant') return false
  return !it.restId
}

export function isRestItem(it: OrderItem, restId?: string): boolean {
  if (it.source === 'restaurant' || it.restId) {
    return restId ? String(it.restId) === String(restId) : true
  }
  return false
}

export function getMarketItems(items: OrderItem[] | unknown = []): OrderItem[] {
  const list = Array.isArray(items) ? items : []
  return list.filter(isMarketItem)
}

export function getRestItems(items: OrderItem[] | unknown = [], restId?: string): OrderItem[] {
  const list = Array.isArray(items) ? items : []
  return list.filter(it => isRestItem(it, restId))
}

export function getRestIdsFromOrder(o: Order): string[] {
  const ids = new Set<string>()
  if (o.restId) ids.add(String(o.restId))
  if (o.restIds) o.restIds.forEach(id => ids.add(String(id)))
  getRestItems(o.items).forEach(it => { if (it.restId) ids.add(String(it.restId)) })
  return [...ids]
}

export function inferOrderType(o: Pick<Order, 'type' | 'items'>): OrderType {
  const market = getMarketItems(o.items || []).length > 0
  const rest = getRestItems(o.items || []).length > 0
  if (market && rest) return 'mixed'
  if (rest) return 'restaurant'
  if (market) return 'market'
  if (o.type === 'restaurant' || o.type === 'mixed' || o.type === 'market') return o.type
  return 'market'
}

export function isMixedOrder(o: Order): boolean {
  return inferOrderType(o) === 'mixed'
}

export function hasMarketPart(o: Order): boolean {
  return getMarketItems(o.items).length > 0
}

export function hasRestPart(o: Order, restId?: string): boolean {
  return getRestItems(o.items, restId).length > 0
}

export function getMarketStatus(o: Order): PartStatus {
  if (o.marketStatus) return o.marketStatus
  if (!hasMarketPart(o)) return 'done'
  const marketItemsList = getMarketItems(o.items)
  if (marketItemsList.length > 0 && marketItemsList.every(it => it.done)) return 'done'
  if (o.status === 'assembler_done') return 'done'
  // Чисто магазинный заказ: курьер уже принял → сборка завершена
  if (inferOrderType(o) === 'market' && ['courier_picked', 'delivering', 'delivered'].includes(o.status)) {
    return 'done'
  }
  if (o.status === 'assembling') return 'assembling'
  return 'new'
}

export function getRestPartStatus(o: Order, restId: string): PartStatus {
  const key = String(restId)
  if (o.restParts?.[key]) return o.restParts[key]
  if (!hasRestPart(o, key)) return 'done'
  if (!isMixedOrder(o) || !hasMarketPart(o)) {
    if (o.status === 'ready' || o.status === 'assembler_done' || o.status === 'courier_picked' || o.status === 'delivering' || o.status === 'delivered') {
      return 'done'
    }
    if (o.status === 'cooking') return 'cooking'
    return 'new'
  }
  return 'new'
}

export function isMarketPartActive(o: Order): boolean {
  if (!hasMarketPart(o)) return false
  const ms = getMarketStatus(o)
  return ms === 'new' || ms === 'assembling'
}

export function isRestPartActive(o: Order, restId: string): boolean {
  if (!hasRestPart(o, restId)) return false
  const rs = getRestPartStatus(o, restId)
  return rs === 'new' || rs === 'cooking'
}

export function allRestPartsDone(o: Order): boolean {
  const ids = getRestIdsFromOrder(o)
  if (!ids.length) return true
  return ids.every(id => getRestPartStatus(o, id) === 'done')
}

export function allPartsDone(o: Order): boolean {
  if (hasMarketPart(o) && getMarketStatus(o) !== 'done') return false
  return allRestPartsDone(o)
}

export function anyPartDone(o: Order): boolean {
  const order = normalizeOrder(o)
  if (hasMarketPart(order) && getMarketStatus(order) === 'done') return true
  return getRestIdsFromOrder(order).some(id => getRestPartStatus(order, id) === 'done')
}

export function getAllPickupIds(o: Order): string[] {
  const order = normalizeOrder(o)
  const ids: string[] = []
  if (hasMarketPart(order)) ids.push('store')
  getRestIdsFromOrder(order).forEach(rid => ids.push(restIdToPickupId(rid)))
  return ids
}

export function isPickupPointReady(o: Order, pickupId: string): boolean {
  const order = normalizeOrder(o)
  if (pickupId === 'store') return getMarketStatus(order) === 'done'
  for (const rid of getRestIdsFromOrder(order)) {
    if (restIdToPickupId(rid) === pickupId) return getRestPartStatus(order, rid) === 'done'
  }
  return false
}

export function getReadyUnpickedPickupIds(o: Order, routeOrder?: string[]): string[] {
  const order = normalizeOrder(o)
  const route = routeOrder ?? order.courierRoute
  const picked = new Set(order.pickedUpIds || [])
  const ready = getAllPickupIds(order).filter(pid => isPickupPointReady(order, pid) && !picked.has(pid))
  if (!route?.length) return ready
  const rank = new Map(route.map((id, i) => [id, i]))
  return [...ready].sort((a, b) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999))
}

/** Точки забора для принятия заказа курьером (с fallback для ресторана) */
export function getCourierAcceptPickupIds(o: Order): string[] {
  const order = normalizeOrder(o)
  let ids = getReadyUnpickedPickupIds(order)
  if (!ids.length) {
    ids = getAllPickupIds(order).filter(pid => isPickupPointReady(order, pid))
  }
  if (!ids.length && inferOrderType(order) === 'restaurant' && order.status === 'ready') {
    ids = getAllPickupIds(order)
  }
  return ids
}

/** Маршрут: сначала выбранная точка, затем остальные */
export function buildCourierRoute(firstPickupId: string, o: Order): string[] {
  const all = getAllPickupIds(normalizeOrder(o))
  return [firstPickupId, ...all.filter(id => id !== firstPickupId)]
}

export function getPendingPartsForCourier(o: Order): { pickupId: string; label: string; status: string }[] {
  const order = normalizeOrder(o)
  const out: { pickupId: string; label: string; status: string }[] = []
  if (hasMarketPart(order) && getMarketStatus(order) !== 'done') {
    const ms = getMarketStatus(order)
    out.push({
      pickupId: 'store',
      label: 'Магазин',
      status: ms === 'assembling' ? 'Собирается' : 'Ожидает сборку',
    })
  }
  for (const rid of getRestIdsFromOrder(order)) {
    const st = getRestPartStatus(order, rid)
    if (st !== 'done') {
      out.push({
        pickupId: restIdToPickupId(rid),
        label: 'Ресторан',
        status: st === 'cooking' ? 'Готовится' : 'Ожидает',
      })
    }
  }
  return out
}

/** Текст ожидания для курьера — магазин или ресторан */
export function formatCourierWaitingMessage(
  parts: { pickupId: string; label: string; status: string }[],
): { icon: string; text: string } {
  if (!parts.length) return { icon: '⏳', text: 'Ожидаем готовность заказа…' }
  if (parts.length === 1) {
    if (parts[0].pickupId === 'store') {
      return { icon: '🛒', text: 'Товар из магазина ещё собирается…' }
    }
    return { icon: '🍽', text: 'Заказ из ресторана ещё готовится…' }
  }
  const waiting = parts.map(p => (p.pickupId === 'store' ? 'магазин' : 'ресторан'))
  return { icon: '⏳', text: `Ожидаем: ${waiting.join(' и ')}…` }
}

export function allPickupsCollected(o: Order): boolean {
  const order = normalizeOrder(o)
  return getAllPickupIds(order).every(pid => (order.pickedUpIds || []).includes(pid))
}

export type CourierProgressStep = 'toPickup' | 'toClient' | 'done'

/** Прогресс курьера — восстанавливается из сохранённых полей заказа */
export function deriveCourierProgress(o: Order): { step: CourierProgressStep; pickupIdx: number } {
  const order = normalizeOrder(o)
  if (order.status === 'delivered') return { step: 'done', pickupIdx: 0 }
  if (order.courierAtClient && order.status === 'delivering') return { step: 'done', pickupIdx: 0 }
  if (order.status === 'delivering') return { step: 'toClient', pickupIdx: 0 }

  const route = order.courierRoute?.length ? order.courierRoute : getAllPickupIds(order)
  const picked = new Set(order.pickedUpIds || [])
  const readyUnpicked = getReadyUnpickedPickupIds(order, route)

  if (readyUnpicked.length) {
    return { step: 'toPickup', pickupIdx: 0 }
  }

  for (let i = 0; i < route.length; i++) {
    if (!picked.has(route[i])) {
      const pending = getPendingPartsForCourier(order)
      if (pending.length) return { step: 'toPickup', pickupIdx: 0 }
    }
  }

  if (allPickupsCollected(order) || !getPendingPartsForCourier(order).length) {
    return { step: 'toClient', pickupIdx: 0 }
  }

  return { step: 'toPickup', pickupIdx: 0 }
}

export function restPartToUiStatus(part: PartStatus): 'new' | 'cooking' | 'ready' | 'delivered' {
  if (part === 'new') return 'new'
  if (part === 'cooking') return 'cooking'
  if (part === 'done') return 'ready'
  return 'cooking'
}

export function normalizeOrder(raw: Order): Order {
  const savedStatus = raw.status
  const inferredType = inferOrderType({
    ...raw,
    items: coerceOrderItems(raw.items, Number(raw.total) || 0, raw.type),
  })
  const items = coerceOrderItems(raw.items, Number(raw.total) || 0, inferredType).map(it => ({
    ...it,
    source: it.source ?? (it.restId ? 'restaurant' as const : 'market' as const),
  }))
  const type = inferOrderType({ ...raw, items })
  const restIds = getRestIdsFromOrder({ ...raw, items, type })
  const order: Order = {
    ...raw,
    type,
    items,
    restIds: restIds.length ? restIds : raw.restIds,
  }

  if (type === 'mixed' && !order.restParts && restIds.length) {
    order.restParts = Object.fromEntries(
      restIds.map(id => [id, getRestPartStatus({ ...order, restParts: {} }, id)]),
    ) as Record<string, PartStatus>
  }

  if (hasMarketPart(order) && !order.marketStatus) {
    order.marketStatus = getMarketStatus(order)
  }

  if (savedStatus) order.status = savedStatus
  return order
}

export function normalizeOrders(list: Order[]): Order[] {
  return list.map(normalizeOrder)
}

export function applyMarketStatus(o: Order, status: PartStatus): Order {
  const next = normalizeOrder({ ...o, marketStatus: status })
  return syncOverallStatus(next)
}

export function applyRestPartStatus(o: Order, restId: string, status: PartStatus): Order {
  const key = String(restId)
  const restParts = { ...(o.restParts || {}), [key]: status }
  const next = normalizeOrder({ ...o, restParts })
  return syncOverallStatus(next)
}

export function syncOverallStatus(o: Order): Order {
  const order = normalizeOrder(o)
  if (!isMixedOrder(order)) return order
  if (['courier_picked', 'delivering', 'delivered', 'cancelled'].includes(order.status)) {
    return order
  }
  if (allPartsDone(order)) {
    return { ...order, status: 'assembler_done' as OrderStatus }
  }
  if (anyPartDone(order)) {
    return { ...order, status: 'ready' as OrderStatus }
  }
  if (hasMarketPart(order) && getMarketStatus(order) === 'assembling') {
    return { ...order, status: 'assembling' as OrderStatus }
  }
  return { ...order, status: 'new' as OrderStatus }
}

export function initMixedOrderFields(data: Partial<Order>): Partial<Order> {
  const items = (data.items || []) as OrderItem[]
  const type = inferOrderType({ type: data.type, items })
  if (type !== 'mixed') return { ...data, type }

  const restIds = getRestIdsFromOrder({ ...data, items, type } as Order)
  return {
    ...data,
    type: 'mixed',
    marketStatus: hasMarketPart({ items } as Order) ? 'new' : undefined,
    restParts: Object.fromEntries(restIds.map(id => [id, 'new'])) as Record<string, PartStatus>,
    restIds,
    restId: data.restId ?? restIds[0],
  }
}
