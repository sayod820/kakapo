import { normalizeOrder } from './orderParts'
import type { Order, OrderItem, Review } from './types'

/** Все отзывы о товарах идут в магазин (не в ресторан) */
export const STORE_REVIEW_REST_ID = 'STORE'

export interface ClientReviewTarget {
  productKey: string
  productId?: number | string
  productName: string
  emoji: string
}

type OrderItemExt = OrderItem & { productId?: number; cartLineId?: string }

/** Стабильный ключ позиции заказа для отзыва */
export function productReviewKeyFromItem(item: OrderItem, index: number): string {
  const it = item as OrderItemExt
  if (it.product_id != null && Number(it.product_id) > 0) return `p${it.product_id}`
  if (it.productId != null && Number(it.productId) > 0) return `p${it.productId}`
  if (it.id != null && Number(it.id) > 0) return `p${it.id}`
  if (it.art) return `a${String(it.art).trim()}`
  if (it.cartLineId) return `c${String(it.cartLineId)}`
  const name = String(it.name || '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .slice(0, 48)
  return `line${index}_${name || 'item'}`
}

export function clientReviewKey(orderId: string, productKey: string): string {
  return `${orderId}:${productKey}`
}

export function reviewKeyFromRecord(orderId: string, review: Review): string {
  if (review.productKey) return clientReviewKey(orderId, review.productKey)
  // старые отзывы по ресторану — не считаем как товарные
  return ''
}

/** Каждая позиция заказа — отдельный отзыв о товаре */
export function getClientReviewTargets(order: Order): ClientReviewTarget[] {
  const o = normalizeOrder(order)
  return (o.items || []).map((item, index) => ({
    productKey: productReviewKeyFromItem(item, index),
    productId: item.product_id ?? item.id,
    productName: String(item.name || 'Товар').trim() || 'Товар',
    emoji: item.e || '📦',
  }))
}

export function resolveReviewTargetLabel(target: ClientReviewTarget): string {
  return `${target.emoji} ${target.productName}`
}

export function getPendingReviewTargets(
  order: Order,
  reviewed: Record<string, Review>,
): ClientReviewTarget[] {
  return getClientReviewTargets(order).filter(
    t => !reviewed[clientReviewKey(order.id, t.productKey)],
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
  return {
    title: 'Оцените товар',
    placeholder: `Что понравилось в «${target.productName}»? (необязательно)…`,
    success: `⭐ Спасибо! Отзыв о «${target.productName}» отправлен`,
  }
}

type ClientOrderRow = {
  id: string
  items?: {
    e?: string
    name: string
    qty: number
    price: number
    restId?: string
    id?: number
    art?: string
    product_id?: number
    source?: string
    cartLineId?: string
  }[]
  orderType?: string
  restId?: string
  phone?: string
  addr?: string
  time?: string
  total?: number
}

/** Заказ для отзыва: из API или из карточки «Мои заказы» */
export function resolveOrderForReview(
  orderId: string,
  apiOrders: Order[],
  clientRow?: ClientOrderRow | null,
): Order | null {
  const raw = apiOrders.find(o => o.id === orderId)
  if (raw) return normalizeOrder(raw)
  if (!clientRow?.items?.length) return null
  return normalizeOrder({
    id: orderId,
    type: (clientRow.orderType as Order['type']) || 'market',
    status: 'delivered',
    items: clientRow.items.map(it => ({
      e: it.e || '📦',
      name: it.name,
      qty: it.qty,
      unit: 'шт',
      price: it.price,
      id: it.id,
      art: it.art,
      product_id: it.product_id,
      source: it.source === 'restaurant' || it.restId ? 'restaurant' as const : 'market' as const,
      restId: it.restId,
      cartLineId: it.cartLineId,
    })),
    restId: clientRow.restId,
    client: { name: '', phone: clientRow.phone || '', addr: clientRow.addr || '' },
    total: clientRow.total || 0,
    createdAt: clientRow.time,
  } as Order)
}
