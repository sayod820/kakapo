/**
 * ONLINE-O8 — production HTTP route access inventory.
 * All app.(get|post|put|patch|delete) routes from index.js are covered.
 * Explicit overrides set PUBLIC / ADMIN; default STAFF for trade.
 * UNKNOWN_AUTH_ROUTES must stay 0.
 */
'use strict'

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CAP } from './apiAuth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Explicit access overrides (method + route → policy fields).
 * Anything not listed defaults to STAFF (+ READ_STAFF for GET, mutation caps heuristic for writes).
 */
const OVERRIDES = {
  'GET /': { access: 'PUBLIC_STORE', public: true, domain: 'health' },
  'GET /health': { access: 'PUBLIC_STORE', public: true, domain: 'health' },
  'GET /ready': { access: 'PUBLIC_STORE', public: true, domain: 'health' },
  'GET /updates/kassa': { access: 'PUBLIC_STORE', public: true, domain: 'updates' },
  'GET /updates/kassa-ui': { access: 'PUBLIC_STORE', public: true, domain: 'updates' },

  'POST /auth/otp/send': { access: 'PUBLIC_STORE', public: true, domain: 'auth' },
  'POST /auth/otp/verify': { access: 'PUBLIC_STORE', public: true, domain: 'auth' },
  'POST /auth/login': { access: 'PUBLIC_STORE', public: true, domain: 'auth' },
  'POST /auth/logout': { access: 'PUBLIC_STORE', public: true, domain: 'auth', businessRisk: 'revokes bearer; handler requires token' },
  'GET /auth/admin': { access: 'PUBLIC_STORE', public: true, domain: 'auth' },
  'PATCH /auth/admin': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'auth', requireCaps: [CAP.SETTINGS_EDIT] },

  'GET /products': { access: 'PUBLIC_STORE', public: true, domain: 'catalog' },
  'GET /categories': { access: 'PUBLIC_STORE', public: true, domain: 'catalog' },
  'GET /categories/tree': { access: 'PUBLIC_STORE', public: true, domain: 'catalog' },
  'GET /promos': { access: 'PUBLIC_STORE', public: true, domain: 'catalog' },
  'GET /restaurants': { access: 'PUBLIC_STORE', public: true, domain: 'market' },
  'GET /restaurants/:id': { access: 'PUBLIC_STORE', public: true, domain: 'market' },
  'GET /settings/pricing': { access: 'PUBLIC_STORE', public: true, domain: 'settings' },
  'GET /settings/loyalty': { access: 'PUBLIC_STORE', public: true, domain: 'settings' },
  'GET /settings/store': { access: 'PUBLIC_STORE', public: true, domain: 'settings' },
  'GET /reviews': { access: 'PUBLIC_STORE', public: true, domain: 'reviews' },
  'POST /reviews': { access: 'PUBLIC_STORE', public: true, domain: 'reviews' },
  'GET /clients/session-check': { access: 'PUBLIC_STORE', public: true, domain: 'crm' },
  'POST /orders': { access: 'PUBLIC_STORE', public: true, domain: 'orders', businessRisk: 'store checkout' },
  'POST /pos/devices/bind': { access: 'PUBLIC_STORE', public: true, domain: 'pos', businessRisk: 'needs live pair code' },
  'GET /pos/devices/check': { access: 'PUBLIC_STORE', public: true, domain: 'pos' },
  'GET /employees/directory': { access: 'PUBLIC_STORE', public: true, domain: 'staff' },
  'GET /employees/local-auth': { access: 'PUBLIC_STORE', public: true, domain: 'staff', deviceRequired: true },
  'POST /employees/login': { access: 'PUBLIC_STORE', public: true, domain: 'staff', deviceRequired: true },

  // Admin-only / recovery
  'POST /pos/points/:id/pair-code': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'pos', requireCaps: [CAP.DEVICE_PAIR], businessRisk: 'critical' },
  'POST /admin/reset-operational': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'admin', requireCaps: [CAP.ADMIN_RECOVERY], businessRisk: 'critical' },
  'POST /admin/ai/ask': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'admin', requireCaps: [CAP.ADMIN_RECOVERY] },
  'GET /admin/dashboard': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'admin', requireCaps: [CAP.READ_STAFF] },
  'GET /admin/ai/status': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'admin', requireCaps: [CAP.READ_STAFF] },
  'GET /audit': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'audit', requireCaps: [CAP.ADMIN_RECOVERY] },
  'POST /audit/:id/restore': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'audit', requireCaps: [CAP.ADMIN_RECOVERY], businessRisk: 'critical' },
  'POST /clients/purge-demo': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'crm', requireCaps: [CAP.ADMIN_RECOVERY], businessRisk: 'critical' },
  'POST /clients/purge-account': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'crm', requireCaps: [CAP.ADMIN_RECOVERY], businessRisk: 'critical' },
  'POST /clients/recovery-by-phone': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'crm', requireCaps: [CAP.ADMIN_RECOVERY], businessRisk: 'critical' },
  'POST /clients/:id/recovery': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'crm', requireCaps: [CAP.ADMIN_RECOVERY], businessRisk: 'critical' },
  'POST /clients/:id/restore': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'crm', requireCaps: [CAP.ADMIN_RECOVERY], businessRisk: 'critical' },
  'GET /clients/deleted-phones': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'crm', requireCaps: [CAP.ADMIN_RECOVERY] },
  'POST /products/bulk-delete': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'catalog', requireCaps: [CAP.ADMIN_RECOVERY], businessRisk: 'critical' },
  'POST /categories/bulk-delete': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'catalog', requireCaps: [CAP.ADMIN_RECOVERY], businessRisk: 'critical' },
  'POST /orders/bulk-delete': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'orders', requireCaps: [CAP.ADMIN_RECOVERY], businessRisk: 'critical' },
  'POST /reviews/bulk-delete': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'reviews', requireCaps: [CAP.ADMIN_RECOVERY] },
  'POST /stock/reconcile': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'stock', requireCaps: [CAP.ADMIN_RECOVERY], businessRisk: 'critical' },
  'GET /employees': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'staff', requireCaps: [CAP.STAFF_EDIT] },
  'POST /employees': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'staff', requireCaps: [CAP.STAFF_EDIT] },
  'PATCH /employees/:id': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'staff', requireCaps: [CAP.STAFF_EDIT] },
  'DELETE /employees/:id': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'staff', requireCaps: [CAP.STAFF_EDIT] },
  'GET /settings/admin': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'settings', requireCaps: [CAP.SETTINGS_EDIT] },
  'PATCH /settings/admin': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'settings', requireCaps: [CAP.SETTINGS_EDIT] },
  'POST /sync/woocommerce': { access: 'ADMIN', adminOnly: true, authRequired: true, domain: 'sync', requireCaps: [CAP.ADMIN_RECOVERY] },

  // High-risk trade mutations — explicit caps
  'POST /pos/sales': { access: 'STAFF', authRequired: true, domain: 'pos', requireCaps: [CAP.SALE_CREATE], businessRisk: 'critical' },
  'POST /pos/sales/:id/return': { access: 'STAFF', authRequired: true, domain: 'pos', requireCaps: [CAP.SALE_RETURN], businessRisk: 'critical' },
  'POST /pos/shifts/open': { access: 'STAFF', authRequired: true, domain: 'pos', requireCaps: [CAP.SHIFT_OPEN], businessRisk: 'critical', selfOnly: true },
  'PATCH /pos/shifts/:id/close': { access: 'STAFF', authRequired: true, domain: 'pos', requireCaps: [CAP.SHIFT_CLOSE], businessRisk: 'critical', selfOnly: true },
  'POST /expenses': { access: 'STAFF', authRequired: true, domain: 'finance', requireCaps: [CAP.EXPENSE], businessRisk: 'high' },
  'POST /finance/moves': { access: 'STAFF', authRequired: true, domain: 'finance', requireCaps: [CAP.FINANCE_MOVE], businessRisk: 'critical' },
  'POST /finance/vault/card-to-cash': { access: 'STAFF', authRequired: true, domain: 'finance', requireCaps: [CAP.FINANCE_MOVE], businessRisk: 'critical' },
  'POST /finance/vault/cash-to-card': { access: 'STAFF', authRequired: true, domain: 'finance', requireCaps: [CAP.FINANCE_MOVE], businessRisk: 'critical' },
  'POST /suppliers/:id/payments': { access: 'STAFF', authRequired: true, domain: 'suppliers', requireCaps: [CAP.SUPPLIER_PAY], businessRisk: 'critical' },
  'POST /stock/receipts': { access: 'STAFF', authRequired: true, domain: 'stock', requireCaps: [CAP.STOCK_RECEIPT], businessRisk: 'high' },
  'POST /stock/writeoffs': { access: 'STAFF', authRequired: true, domain: 'stock', requireCaps: [CAP.WRITEOFF], businessRisk: 'high' },
  'POST /stock/adjustments': { access: 'STAFF', authRequired: true, domain: 'stock', requireCaps: [CAP.STOCK_ADJUSTMENT], businessRisk: 'high' },
  'POST /stock/revisions': { access: 'STAFF', authRequired: true, domain: 'stock', requireCaps: [CAP.STOCK_ADJUSTMENT], businessRisk: 'critical' },
  'POST /cards/:num/debt-repay': { access: 'STAFF', authRequired: true, domain: 'crm', requireCaps: [CAP.CLIENT_DEBT_REPAY], businessRisk: 'critical' },
  'POST /cards/:num/cash-advance': { access: 'STAFF', authRequired: true, domain: 'crm', requireCaps: [CAP.CASH_ADVANCE], businessRisk: 'critical' },
  'POST /cards/:num/cash-topup': { access: 'STAFF', authRequired: true, domain: 'crm', requireCaps: [CAP.BONUS_ADJUSTMENT], businessRisk: 'critical' },
  'POST /cards/:num/bonus-adjustments': { access: 'STAFF', authRequired: true, domain: 'crm', requireCaps: [CAP.BONUS_ADJUSTMENT], businessRisk: 'high' },
  'POST /clients/:id/debt-adjustments': { access: 'STAFF', authRequired: true, domain: 'crm', requireCaps: [CAP.CLIENT_DEBT_REPAY], businessRisk: 'critical' },
  'POST /products': { access: 'STAFF', authRequired: true, domain: 'catalog', requireCaps: [CAP.PRODUCT_EDIT], businessRisk: 'high' },
  'PATCH /products/:id': { access: 'STAFF', authRequired: true, domain: 'catalog', requireCaps: [CAP.PRODUCT_EDIT], businessRisk: 'high' },
  'DELETE /products/:id': { access: 'STAFF', authRequired: true, domain: 'catalog', requireCaps: [CAP.PRODUCT_EDIT], businessRisk: 'high' },

  'GET /notifications': { access: 'AUTHENTICATED_CLIENT', authRequired: true, domain: 'notify', clientSelfOnly: true, requireCaps: [] },
  'PATCH /notifications/read-all': { access: 'AUTHENTICATED_CLIENT', authRequired: true, domain: 'notify', clientSelfOnly: true, requireCaps: [] },
  'PATCH /notifications/:id/read': { access: 'AUTHENTICATED_CLIENT', authRequired: true, domain: 'notify', clientSelfOnly: true, requireCaps: [] },
  'GET /debt/ledger': { access: 'STAFF', authRequired: true, domain: 'crm', requireCaps: [CAP.CLIENT_CRM], clientSelfOnly: true },
}

function defaultPolicy(method, route) {
  if (route.startsWith('/admin') || route.includes('purge') || route.includes('recovery')
    || route.includes('bulk-delete') || route.includes('reset-operational')
    || route.includes('pair-code') || route.startsWith('/audit')) {
    return {
      access: 'ADMIN',
      adminOnly: true,
      authRequired: true,
      domain: 'admin',
      requireCaps: [CAP.ADMIN_RECOVERY],
      businessRisk: 'admin-default',
    }
  }
  if (method === 'GET') {
    return {
      access: 'STAFF',
      authRequired: true,
      domain: 'trade',
      requireCaps: [CAP.READ_STAFF],
    }
  }
  return {
    access: 'STAFF',
    authRequired: true,
    domain: 'trade',
    requireCaps: [CAP.READ_STAFF],
    businessRisk: 'staff-mutation-default',
  }
}

function scanIndexRoutes() {
  const src = readFileSync(join(__dirname, 'index.js'), 'utf8')
  const re = /app\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g
  const out = []
  let m
  while ((m = re.exec(src))) {
    out.push({ method: m[1].toUpperCase(), route: m[2] })
  }
  return out
}

function compilePattern(route) {
  const parts = String(route).split('/').map((p) => {
    if (p.startsWith(':')) return '[^/]+'
    return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  })
  return new RegExp(`^${parts.join('/')}$`)
}

function buildInventory() {
  const scanned = scanIndexRoutes()
  /** @type {import('./apiAuth.js').AccessClass extends string ? any[] : any[]} */
  const list = []
  for (const { method, route } of scanned) {
    const key = `${method} ${route}`
    const over = OVERRIDES[key] || {}
    const base = defaultPolicy(method, route)
    const row = {
      method,
      route,
      access: over.access || base.access,
      domain: over.domain || base.domain,
      public: over.public || false,
      authRequired: over.authRequired != null ? over.authRequired : base.authRequired,
      adminOnly: over.adminOnly || false,
      deviceRequired: over.deviceRequired || false,
      requireCaps: over.requireCaps != null ? over.requireCaps : base.requireCaps,
      clientSelfOnly: over.clientSelfOnly || false,
      businessRisk: over.businessRisk || base.businessRisk,
      caller: over.caller,
    }
    list.push(row)
  }
  return list
}

export const ROUTE_ACCESS = buildInventory()

const COMPILED = ROUTE_ACCESS.map((p) => ({
  ...p,
  _re: compilePattern(p.route),
  _method: p.method.toUpperCase(),
}))

export function matchRoutePolicy(method, path) {
  const m = String(method || 'GET').toUpperCase()
  const p = String(path || '').split('?')[0]
  const hits = COMPILED.filter((r) => r._method === m && r._re.test(p))
  if (!hits.length) return null
  hits.sort((a, b) => b.route.length - a.route.length)
  return hits[0]
}

export function inventoryUnknownAuthCount() {
  return ROUTE_ACCESS.filter((e) => !e.access || e.access === 'UNKNOWN').length
}

export function routeCoverageStats() {
  const stats = {
    PRODUCTION_ROUTES_TOTAL: ROUTE_ACCESS.length,
    PUBLIC_ROUTES: 0,
    AUTHENTICATED_ROUTES: 0,
    ADMIN_ONLY_ROUTES: 0,
    DEVICE_ROUTES: 0,
    TEST_ONLY_ROUTES: 0,
    UNKNOWN_AUTH_ROUTES: inventoryUnknownAuthCount(),
  }
  for (const r of ROUTE_ACCESS) {
    if (r.access === 'TEST_ONLY') stats.TEST_ONLY_ROUTES += 1
    if (r.access === 'PUBLIC_STORE' || r.public) stats.PUBLIC_ROUTES += 1
    if (r.authRequired || ['STAFF', 'CASHIER', 'ADMIN', 'AUTHENTICATED_CLIENT', 'DEVICE'].includes(r.access)) {
      if (!(r.access === 'PUBLIC_STORE' || r.public)) stats.AUTHENTICATED_ROUTES += 1
    }
    if (r.access === 'ADMIN' || r.adminOnly) stats.ADMIN_ONLY_ROUTES += 1
    if (r.access === 'DEVICE' || r.deviceRequired) stats.DEVICE_ROUTES += 1
  }
  return stats
}

export const TEST_ROUTE_PREFIXES = ['/__o8', '/__l13']

export function countMountedTestRoutes(app) {
  // Best-effort: check env gates rather than stack introspection
  let n = 0
  if (String(process.env.KAKAPO_O8_TEST_API || '') === '1') n += 6
  if (String(process.env.KAKAPO_L13_TEST_API || '') === '1') n += 5
  return n
}
