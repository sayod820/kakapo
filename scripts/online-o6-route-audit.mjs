/**
 * ONLINE-O6 — gap counters for normal-route idempotency / domain bypass.
 *   node scripts/online-o6-route-audit.mjs
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const audit = JSON.parse(execSync('node scripts/online-o5b-route-audit.mjs', { cwd: root, encoding: 'utf8' }))

const DUPLICATE_CREATE = [
  { method: 'POST', route: '/clients' },
  { method: 'POST', route: '/orders' },
  { method: 'PATCH', route: '/orders/:id/status' },
  { method: 'POST', route: '/pos/points' },
  { method: 'POST', route: '/pos/devices/bind' },
  { method: 'POST', route: '/cards/ensure' },
  { method: 'POST', route: '/products/:id/stock-layers' },
]

const ORDER_ACTION_ROUTES = [
  { method: 'POST', route: '/orders', note: 'create' },
  { method: 'PATCH', route: '/orders/:id/status', note: 'all status/assignment/stock side effects' },
  { method: 'DELETE', route: '/orders/:id', note: 'admin delete' },
  { method: 'POST', route: '/orders/bulk-delete', note: 'admin bulk' },
]

const FIN_BYPASS_CHECK = [
  { method: 'POST', route: '/clients' },
  { method: 'POST', route: '/orders' },
  { method: 'POST', route: '/cards/ensure' },
]

const STOCK_BYPASS = [
  { method: 'POST', route: '/products/:id/stock-layers' },
  { method: 'PATCH', route: '/stock/layers/:receiptId/:productId' },
  { method: 'DELETE', route: '/stock/layers/:receiptId/:productId' },
]

function find(routes, spec) {
  return routes.find(r => r.method === spec.method && r.route === spec.route)
}

const routes = audit.routes || []
const legacy = routes.filter(r => r.primary === 'LEGACY_SPECIAL')

const withoutIdem = []
for (const spec of DUPLICATE_CREATE) {
  const r = find(routes, spec)
  if (!r) continue
  const ok = r.primary === 'O8_ATOMIC' && (r.flags || []).includes('HAS_PG_OPREF')
  if (!ok) withoutIdem.push(r)
}

const finBypass = []
for (const spec of FIN_BYPASS_CHECK) {
  const r = find(routes, spec)
  if (r && r.primary !== 'O8_ATOMIC') finBypass.push(r)
}

const stockBypass = []
for (const spec of STOCK_BYPASS) {
  const r = find(routes, spec)
  if (!r) continue
  const ok = r.primary === 'O8_ATOMIC' || r.primary === 'ADMIN_RECOVERY' || r.primary === 'LEGACY_SPECIAL'
  if (!ok && !(r.flags || []).includes('HAS_PG_OPREF')) stockBypass.push(r)
}

const lww = (audit.metadataPolicies || []).filter(p => p.policy === 'FULL_OBJECT_LAST_WRITE_WINS')
const normalUnsafeLww = lww.filter(p => {
  if (p.route.startsWith('/restaurants') || p.route.startsWith('/couriers')
    || p.route.startsWith('/assemblers') || p.route.startsWith('/pickups')) {
    return false // OUT_OF_SCOPE_RESTAURANT_COURIER
  }
  if (p.route === '/auth/admin') return false // admin
  if (p.route === '/stock/layers/:receiptId/:productId') {
    const r = find(routes, { method: 'PATCH', route: p.route })
    return r && r.primary === 'SNAPSHOT_FLUSH_DURABLE'
  }
  if (['/categories/:id', '/promos/:id', '/employees/:id', '/settings'].some(x => p.route.startsWith(x))) {
    return false // SAFE_REPLACEMENT master metadata
  }
  if (p.route === '/orders/:id/status') return false // O6B durable field patch + opRef
  return false
})

const orderActionAudit = ORDER_ACTION_ROUTES.map((spec) => {
  const r = find(routes, spec)
  if (!r) return { ...spec, found: false }
  const durable = r.primary === 'O8_ATOMIC' && (r.flags || []).includes('HAS_PG_OPREF')
  const natural = spec.route.includes('bulk') || spec.method === 'DELETE'
  return {
    ...spec,
    found: true,
    primary: r.primary,
    durable,
    naturallyIdempotent: natural,
    withoutRestartSafeIdempotency: !durable && !natural,
  }
})
const orderWithout = orderActionAudit.filter(x => x.withoutRestartSafeIdempotency)

console.log(JSON.stringify({
  NORMAL_ORDER_ACTION_ROUTES: ORDER_ACTION_ROUTES.length,
  ORDER_ACTIONS_WITH_DURABLE_OPREF: orderActionAudit.filter(x => x.durable).length,
  ORDER_ACTIONS_NATURALLY_IDEMPOTENT: orderActionAudit.filter(x => x.naturallyIdempotent).length,
  ORDER_ACTIONS_WITHOUT_RESTART_SAFE_IDEMPOTENCY: orderWithout.length,
  orderActionAudit,
  NORMAL_ROUTE_WITHOUT_RESTART_SAFE_IDEMPOTENCY: withoutIdem.length,
  withoutIdem,
  NORMAL_ROUTE_CAN_BYPASS_SIGNED_FINANCIAL_DOMAIN: finBypass.length,
  finBypass,
  NORMAL_ROUTE_CAN_BYPASS_SIGNED_STOCK_DOMAIN: stockBypass.length,
  stockBypass,
  UNEXPLAINED_LEGACY_SPECIAL: legacy.length,
  legacySpecial: legacy,
  NORMAL_UNSAFE_FULL_OBJECT_LWW_ROUTES: normalUnsafeLww.length,
  normalUnsafeLww,
  ...audit,
}, null, 2))
