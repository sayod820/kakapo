import {
  clientReviewKey,
  reviewKeyFromRecord,
  STORE_REVIEW_REST_ID,
} from './clientOrderReview'
import { api } from './api'
import { USE_API } from './config'
import type { Order, Review } from './types'
import { ACCOUNT_NS, loadAccountJson, saveAccountJson } from './clientAccountStorage'
import { phoneDigits } from './clientSession'

export { phoneDigits, STORE_REVIEW_REST_ID }

export function getClientPhone(user?: { phone?: string } | null) {
  return phoneDigits(
    user?.phone || (typeof window !== 'undefined' ? localStorage.getItem('kakapo_client_phone') : '') || '',
  )
}

export function getClientOrderIds(apiOrders: Order[], user?: { phone?: string; name?: string } | null) {
  const mine = getClientPhone(user)
  const ids = new Set<string>()
  apiOrders.forEach(o => {
    if (!mine || phoneDigits(o.client?.phone || '') === mine) ids.add(String(o.id))
  })
  return ids
}

export function loadLocalReviews(phone?: string): Record<string, Review> {
  const raw = loadAccountJson<Record<string, Review>>(ACCOUNT_NS.reviewsLocal, {}, phone)
  if (!raw || typeof raw !== 'object') return {}
  const map: Record<string, Review> = {}
  for (const [key, rev] of Object.entries(raw)) {
    if (!rev) continue
    if (key.includes(':')) {
      map[key] = rev
      continue
    }
    if (rev.orderId && rev.restId) {
      map[clientReviewKey(String(rev.orderId), String(rev.restId))] = rev
    }
  }
  return map
}

export function saveLocalReview(
  orderId: string,
  review: Review,
  phone?: string,
  restId?: string,
) {
  const map = loadLocalReviews(phone)
  const key = clientReviewKey(orderId, restId || review.restId || STORE_REVIEW_REST_ID)
  map[key] = review
  saveAccountJson(ACCOUNT_NS.reviewsLocal, map, phone)
}

export function sortReviewsNewestFirst(list: Review[]): Review[] {
  return [...list].sort((a, b) => {
    const ta = a.createdAt || a.date || ''
    const tb = b.createdAt || b.date || ''
    return tb.localeCompare(ta)
  })
}

export function avgReviewRating(list: Review[]): number | null {
  if (!list.length) return null
  const sum = list.reduce((s, r) => s + (Number(r.rating) || 0), 0)
  return Math.round((sum / list.length) * 10) / 10
}

export function resolveReviewPlaceName(
  restId: string,
  review?: Pick<Review, 'restName' | 'productName'>,
  restaurants: { id: string; name?: string; emoji?: string }[] = [],
): string {
  if (restId === STORE_REVIEW_REST_ID) return '🏪 КАКАПО Магазин'
  const r = restaurants.find(x => x.id === restId)
  if (r) return `${r.emoji || '🍽'} ${r.name}`
  if (review?.restName) return review.restName
  return 'Ресторан'
}

export async function loadClientReviewMap(
  apiOrders: Order[],
  user?: { phone?: string; name?: string } | null,
): Promise<Record<string, Review>> {
  if (!USE_API) return loadLocalReviews(user?.phone || getClientPhone(user))
  const list = await api.getReviews()
  const orderIds = getClientOrderIds(apiOrders, user)
  const name = (user?.name || '').trim().toLowerCase()
  const map: Record<string, Review> = {}
  list.forEach(r => {
    const oid = r.orderId ? String(r.orderId) : ''
    const byOrder = oid && orderIds.has(oid)
    const byName = name && (r.client || '').trim().toLowerCase() === name
    if (!byOrder && !byName) return
    if (!oid) return
    const key = reviewKeyFromRecord(oid, r)
    if (key) map[key] = r
  })
  const local = loadLocalReviews(user?.phone || getClientPhone(user))
  for (const [key, rev] of Object.entries(local)) {
    if (!map[key]) map[key] = rev
  }
  return map
}
