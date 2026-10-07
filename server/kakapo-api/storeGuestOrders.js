/**
 * Anonymous Store tracking has no SMS login yet. A guest must know both an
 * order id and its Tajik phone number; every public projection is deliberately
 * narrower than the staff order/review record.
 */

import { marketItems, restItems } from './ordersLogic.js'

export const MAX_GUEST_TRACK_IDS = 20
export const GUEST_TRACK_RATE_LIMIT = Object.freeze({ windowMs: 60_000, max: 20, blockMs: 60_000 })
export const GUEST_REVIEW_RATE_LIMIT = Object.freeze({ windowMs: 60_000, max: 10, blockMs: 120_000 })

/** Same Tajik comparison key used by ONLINE client/order matching. */
export function phoneKey(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-9)
}

export function guestRateLimitKey(kind, ip) {
  const label = String(kind || 'request').replace(/[^a-z-]/gi, '').slice(0, 24) || 'request'
  return `guest-${label}:${String(ip || 'unknown').slice(0, 128)}`
}

export function isGuestTrackableOrder(order) {
  return !!order && order.channel !== 'pos' && !order.posSaleId
}

function orderPhoneMatches(order, key) {
  return key.length === 9 && phoneKey(order?.client?.phone) === key
}

function publicItemView(item) {
  return {
    name: item?.name,
    e: item?.e,
    qty: item?.qty,
    unit: item?.unit,
    grams: item?.grams,
    photo: item?.photo,
    photoThumb: item?.photoThumb,
  }
}

/** Customer tracking fields only: never return contacts, location, staff, payment, or operational notes. */
export function publicOrderView(order) {
  return {
    id: order.id,
    type: order.type,
    status: order.status,
    marketStatus: order.marketStatus,
    createdAtIso: order.createdAtIso,
    deliveredAtIso: order.deliveredAtIso,
    total: order.total,
    goodsTotal: order.goodsTotal,
    deliveryFee: order.deliveryFee,
    items: (order.items || []).map(publicItemView),
  }
}

/** Orders matching both number and phone; unknown/foreign ids are silently omitted. */
export function trackGuestOrders(db, { ids, phone } = {}) {
  const key = phoneKey(phone)
  if (key.length !== 9 || !Array.isArray(ids)) return []
  const wanted = [...new Set(ids
    .map(x => String(x || '').trim())
    .filter(Boolean))].slice(0, MAX_GUEST_TRACK_IDS)
  if (!wanted.length) return []
  const byId = new Map((db?.orders || []).map(o => [String(o.id), o]))
  return wanted
    .map(id => byId.get(id))
    .filter(o => isGuestTrackableOrder(o) && orderPhoneMatches(o, key))
    .map(publicOrderView)
}

function orderHasReviewTarget(order, restId) {
  if (restId === 'STORE') return marketItems(order.items || []).length > 0
  return restItems(order.items || [], restId).length > 0
    || String(order.restId || '') === restId
    || (order.restIds || []).some(id => String(id) === restId)
}

/** Guest review ownership: matching phone, delivered non-POS order, and actual target membership. */
export function checkGuestReview(db, { orderId, phone, restId } = {}) {
  const order = (db?.orders || []).find(o => String(o.id) === String(orderId || ''))
  if (!order || !isGuestTrackableOrder(order) || !orderPhoneMatches(order, phoneKey(phone))) {
    return { ok: false, detail: 'Order not found' }
  }
  if (order.status !== 'delivered') {
    return { ok: false, detail: 'Review is available after delivery' }
  }
  const target = String(restId || 'STORE').trim() || 'STORE'
  if (!orderHasReviewTarget(order, target)) {
    return { ok: false, detail: 'Review target is not part of this order' }
  }
  return { ok: true, order, restId: target }
}

/** Build the only public-review input accepted by persistence; never carry ownership phone or caller identity. */
export function trustedGuestReviewBody(gate, body = {}) {
  const order = gate?.order || {}
  return {
    orderId: String(order.id || ''),
    restId: String(gate?.restId || 'STORE'),
    rating: body.rating,
    text: body.text,
    client: String(order.client?.name || 'Customer').trim() || 'Customer',
  }
}

/** Public reviews deliberately omit ownership/order linkage and customer identity. */
export function publicReviewView(review) {
  return {
    id: review.id,
    restId: review.restId,
    restName: review.restName,
    client: 'Customer',
    rating: review.rating,
    text: review.text,
    date: review.date,
    createdAt: review.createdAt,
    targetType: review.targetType,
  }
}

export function toPublicPickup(p) {
  if (!p || typeof p !== 'object') return p
  return {
    id: p.id,
    type: p.type,
    e: p.e,
    color: p.color,
    name: p.name,
    addr: p.addr,
    active: p.active,
  }
}
