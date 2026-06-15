import { api } from './api'
import { USE_API } from './config'
import type { Order, Review } from './types'

export function phoneDigits(v: string) {
  return (v || '').replace(/\D/g, '').slice(-9)
}

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

export async function loadClientReviewMap(
  apiOrders: Order[],
  user?: { phone?: string; name?: string } | null,
): Promise<Record<string, Review>> {
  if (!USE_API) return {}
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
