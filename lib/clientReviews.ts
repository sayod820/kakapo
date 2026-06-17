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
  const map = loadAccountJson<Record<string, Review>>(ACCOUNT_NS.reviewsLocal, {}, phone)
  return map && typeof map === 'object' ? map : {}
}

export function saveLocalReview(orderId: string, review: Review, phone?: string) {
  const map = loadLocalReviews(phone)
  map[String(orderId)] = review
  saveAccountJson(ACCOUNT_NS.reviewsLocal, map, phone)
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
    const byOrder = r.orderId && orderIds.has(String(r.orderId))
    const byName = name && (r.client || '').trim().toLowerCase() === name
    if (byOrder || byName) {
      if (r.orderId) map[String(r.orderId)] = r
    }
  })
  return map
}
