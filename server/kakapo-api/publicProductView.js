/**
 * Store visitors must not see purchase prices / supplier data.
 * Staff, cashiers and paired devices get the full product row.
 */
import { isAuthEnforced } from './apiAuth.js'

const STAFF_PRINCIPALS = new Set(['ADMIN', 'STAFF', 'CASHIER', 'DEVICE'])
const INTERNAL_PRODUCT_KEY = /cost|supplier|purchase|margin/i

export function isStaffPrincipal(principal) {
  return STAFF_PRINCIPALS.has(String(principal || '').toUpperCase())
}

export function toPublicProduct(product) {
  if (!product || typeof product !== 'object') return product
  const out = {}
  for (const [k, v] of Object.entries(product)) {
    if (!INTERNAL_PRODUCT_KEY.test(k)) out[k] = v
  }
  return out
}

/**
 * Store «Хиты»: product ids ranked by how many POS receipts contained them.
 * Only ids leave the server — no quantities or revenue.
 */
export function topSellingProductIds(db, { days = 30, limit = 12, now = Date.now() } = {}) {
  const from = new Date(now - days * 86400000).toISOString()
  const sellable = new Map((db.products || [])
    .filter(p => !p.deleted && !p.archived && Number(p.price) > 0 && !(typeof p.stock === 'number' && p.stock <= 0))
    .map(p => [Number(p.id), p]))
  const receipts = new Map()
  for (const s of db.posSales || []) {
    if (s.status === 'returned' || String(s.createdAtIso || '') < from) continue
    const seen = new Set()
    for (const it of s.items || []) {
      const pid = Number(it.productId) || 0
      if (!pid || seen.has(pid) || !sellable.has(pid)) continue
      if (!((Number(it.qty) || 0) - (Number(it.returnedQty) || 0) > 0)) continue
      seen.add(pid)
      receipts.set(pid, (receipts.get(pid) || 0) + 1)
    }
  }
  return [...receipts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, Math.max(1, Math.min(48, limit)))
    .map(([id]) => id)
}

export function requestSeesFullProducts(req) {
  if (!isAuthEnforced()) return true
  return isStaffPrincipal(req?.auth?.principal)
}
