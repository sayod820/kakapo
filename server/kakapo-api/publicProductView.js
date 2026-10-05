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

export function requestSeesFullProducts(req) {
  if (!isAuthEnforced()) return true
  return isStaffPrincipal(req?.auth?.principal)
}
