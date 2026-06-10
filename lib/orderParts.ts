import type { Order, OrderItem, OrderStatus, OrderType } from './types'

export type PartStatus = 'new' | 'assembling' | 'cooking' | 'done'

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

export function getMarketItems(items: OrderItem[] = []): OrderItem[] {
  return items.filter(isMarketItem)
}

export function getRestItems(items: OrderItem[] = [], restId?: string): OrderItem[] {
  return items.filter(it => isRestItem(it, restId))
}

export function getRestIdsFromOrder(o: Order): string[] {
  const ids = new Set<string>()
  if (o.restId) ids.add(String(o.restId))
  if (o.restIds) o.restIds.forEach(id => ids.add(String(id)))
  getRestItems(o.items).forEach(it => { if (it.restId) ids.add(String(it.restId)) })
  return [...ids]
}

export function inferOrderType(o: Pick<Order, 'type' | 'items'>): OrderType {
  if (o.type === 'mixed') return 'mixed'
  const market = getMarketItems(o.items).length > 0
  const rest = getRestItems(o.items).length > 0
  if (market && rest) return 'mixed'
  if (rest) return 'restaurant'
  return o.type === 'restaurant' ? 'restaurant' : 'market'
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
  if (o.status === 'assembler_done') return 'done'
  if (o.status === 'assembling') return 'assembling'
  return 'new'
}

export function getRestPartStatus(o: Order, restId: string): PartStatus {
  const key = String(restId)
  if (o.restParts?.[key]) return o.restParts[key]
  if (!hasRestPart(o, key)) return 'done'
  if (isMixedOrder(o)) return 'new'
  if (o.status === 'ready' || o.status === 'assembler_done' || o.status === 'courier_picked' || o.status === 'delivering' || o.status === 'delivered') {
    return 'done'
  }
  if (o.status === 'cooking') return 'cooking'
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

export function restPartToUiStatus(part: PartStatus): 'new' | 'cooking' | 'ready' | 'delivered' {
  if (part === 'new') return 'new'
  if (part === 'cooking') return 'cooking'
  if (part === 'done') return 'ready'
  return 'cooking'
}

export function normalizeOrder(raw: Order): Order {
  const items = (raw.items || []).map(it => ({
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

  if (type === 'mixed') {
    if (hasMarketPart(order) && !order.marketStatus) {
      order.marketStatus = raw.status === 'assembling' ? 'assembling' : raw.status === 'assembler_done' ? 'done' : 'new'
    }
    if (!order.restParts && restIds.length) {
      order.restParts = Object.fromEntries(
        restIds.map(id => [id, getRestPartStatus({ ...order, restParts: {} }, id)]),
      ) as Record<string, PartStatus>
    }
    if (allPartsDone(order) && order.status !== 'delivered' && order.status !== 'cancelled' && order.status !== 'courier_picked' && order.status !== 'delivering') {
      order.status = 'assembler_done'
    }
  }

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
  if (allPartsDone(order)) {
    return { ...order, status: 'assembler_done' as OrderStatus }
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
