import { clientReviewKey, STORE_REVIEW_REST_ID } from './clientOrderReview'
import { api } from './api'
import { USE_API } from './config'
import type { Order, Review } from './types'
import { ACCOUNT_NS, loadAccountJson, saveAccountJson } from './clientAccountStorage'
import { phoneDigits } from './clientSession'

export { phoneDigits }

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
    const rid = String(rev.restId || STORE_REVIEW_REST_ID)
    map[clientReviewKey(key, rid)] = { ...rev, restId: rid }
  }
  return map
}

export function saveLocalReview(orderId: string, review: Review, phone?: string, restId?: string) {
  const map = loadLocalReviews(phone)
  const key = clientReviewKey(orderId, restId || review.restId || STORE_REVIEW_REST_ID)
  map[key] = review
  saveAccountJson(ACCOUNT_NS.reviewsLocal, map, phone)
}

export async function loadClientReviewMap(
  apiOrders: Order[],
  user?: { phone?: string; name?: string } | null,
): Promise<Record<string, Review>> {
  if (!USE_API) return loadLocalReviews(user?.phone || getClientPhone(user))
  const list = await api.getReviews()
  const mine = getClientPhone(user)
  const orderIds = getClientOrderIds(apiOrders, user)
  const map: Record<string, Review> = {}
  list.forEach(r => {
    const oid = r.orderId ? String(r.orderId) : ''
    const byOrder = oid && orderIds.has(oid)
    const byPhone = mine && phoneDigits(r.client || '') === mine
    if (!byOrder && !byPhone) return
    if (!oid) return
    const key = clientReviewKey(oid, String(r.restId || STORE_REVIEW_REST_ID))
    map[key] = r
  })
  return map
}
