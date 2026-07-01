import {
  getMarketItems,
  getRestIdsFromOrder,
  getRestItemsForOrder,
  hasMarketPart,
  normalizeOrder,
} from './orderParts'
import type { Order, Review } from './types'

export const STORE_REVIEW_REST_ID = 'STORE'

export type ClientReviewTargetType = 'market' | 'restaurant'

export interface ClientReviewTarget {
  type: ClientReviewTargetType
  restId: string
}

/** Ключ отзыва: заказ + магазин или ресторан */
export function clientReviewKey(orderId: string, restId: string): string {
  return `${orderId}:${restId}`
}

export function reviewKeyFromRecord(orderId: string, review: Review): string {
  const rid = String(review.restId || STORE_REVIEW_REST_ID)
  if (!review.orderId) return ''
  return clientReviewKey(String(review.orderId), rid)
}

/** Удобно: один отзыв на магазин и один на каждый ресторан в заказе */
export function getClientReviewTargets(order: Order): ClientReviewTarget[] {
  const o = normalizeOrder(order)
  const out: ClientReviewTarget[] = []
  if (hasMarketPart(o) || getMarketItems(o.items).length > 0) {
    out.push({ type: 'market', restId: STORE_REVIEW_REST_ID })
  }
  for (const rid of getRestIdsFromOrder(o)) {
    if (getRestItemsForOrder(o, rid).length > 0 || o.type === 'restaurant') {
      out.push({ type: 'restaurant', restId: rid })
    }
  }
  if (!out.length && o.type === 'restaurant' && o.restId) {
    out.push({ type: 'restaurant', restId: String(o.restId) })
  }
  return out
}

export function resolveReviewTargetLabel(
  target: ClientReviewTarget,
  restaurants: { id: string; name?: string; emoji?: string }[] = [],
): string {
  if (target.type === 'market') return '🏪 Магазин КАКАПО'
  const r = restaurants.find(x => x.id === target.restId)
  return r ? `${r.emoji || '🍽'} ${r.name}` : 'Ресторан'
}

export function getPendingReviewTargets(
  order: Order,
  reviewed: Record<string, Review>,
): ClientReviewTarget[] {
  return getClientReviewTargets(order).filter(
    t => !reviewed[clientReviewKey(order.id, t.restId)],
  )
}

export function canClientReviewOrder(
  order: Order,
  reviewed: Record<string, Review>,
  uiStatus: string,
): boolean {
  if (uiStatus !== 'delivered') return false
  return getPendingReviewTargets(order, reviewed).length > 0
}

export function reviewPromptForTarget(target: ClientReviewTarget): {
  title: string
  placeholder: string
  success: string
} {
  if (target.type === 'market') {
    return {
      title: 'Оцените покупку',
      placeholder: 'Что понравилось в товарах? (необязательно)…',
      success: '⭐ Спасибо! Отзыв о магазине отправлен',
    }
  }
  return {
    title: 'Оцените ресторан',
    placeholder: 'Что понравилось в блюдах? (необязательно)…',
    success: '⭐ Спасибо! Ресторан получил ваш отзыв',
  }
}

type ClientOrderRow = {
  id: string
  items?: { e?: string; name: string; qty: number; price: number; restId?: string }[]
  orderType?: string
  restId?: string
  phone?: string
  addr?: string
  time?: string
  total?: number
}

export function resolveOrderForReview(
  orderId: string,
  apiOrders: Order[],
  clientRow?: ClientOrderRow | null,
): Order | null {
  const raw = apiOrders.find(o => o.id === orderId)
  if (raw) return normalizeOrder(raw)
  if (!clientRow) return null
  const hasItems = (clientRow.items?.length ?? 0) > 0
  if (!hasItems && !clientRow.restId) return null
  return normalizeOrder({
    id: orderId,
    type: (clientRow.orderType as Order['type']) || (clientRow.restId ? 'restaurant' : 'market'),
    status: 'delivered',
    items: (clientRow.items || []).map(it => ({
      e: it.e || '📦',
      name: it.name,
      qty: it.qty,
      unit: 'шт',
      price: it.price,
      source: it.restId ? 'restaurant' as const : 'market' as const,
      restId: it.restId || clientRow.restId,
    })),
    restId: clientRow.restId,
    client: { name: '', phone: clientRow.phone || '', addr: clientRow.addr || '' },
    total: clientRow.total || 0,
    createdAt: clientRow.time,
  } as Order)
}
