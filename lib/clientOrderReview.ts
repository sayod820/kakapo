import { getMarketItems, getRestIdsFromOrder, getRestItems, normalizeOrder } from './orderParts'
import type { Order, Review } from './types'

/** ID «ресторана» для отзывов о товарах магазина (не курьер) */
export const STORE_REVIEW_REST_ID = 'STORE'

export type ClientReviewTargetType = 'restaurant' | 'market'

export interface ClientReviewTarget {
  type: ClientReviewTargetType
  restId: string
}

export function clientReviewKey(orderId: string, restId: string): string {
  return `${orderId}:${restId}`
}

export function getClientReviewTargets(order: Order): ClientReviewTarget[] {
  const o = normalizeOrder(order)
  const out: ClientReviewTarget[] = []
  for (const rid of getRestIdsFromOrder(o)) {
    if (getRestItems(o.items, rid).length > 0) {
      out.push({ type: 'restaurant', restId: rid })
    }
  }
  if (getMarketItems(o.items).length > 0) {
    out.push({ type: 'market', restId: STORE_REVIEW_REST_ID })
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
      title: 'Оцените товары',
      placeholder: 'Что понравилось в товарах? (необязательно)…',
      success: '⭐ Спасибо! Отзыв о товарах отправлен',
    }
  }
  return {
    title: 'Оцените блюда',
    placeholder: 'Что понравилось в ресторане? (необязательно)…',
    success: '⭐ Спасибо! Ресторан получил ваш отзыв',
  }
}
