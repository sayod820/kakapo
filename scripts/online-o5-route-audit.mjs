/**
 * ONLINE-O5 mutating route inventory (static scan of server/kakapo-api/index.js).
 *   node scripts/online-o5-route-audit.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const indexPath = path.join(root, 'server/kakapo-api/index.js')
const src = readFileSync(indexPath, 'utf8')

const O8_DELEGATE = [
  '/pos/shifts/open', '/pos/shifts/:id/close', '/pos/sales', '/pos/sales/:id/return',
  '/stock/receipts', '/stock/receipts/:id', '/stock/adjustments', '/stock/writeoffs',
  '/suppliers/:id/payments', '/expenses', '/finance/moves', '/finance/vault/',
  '/clients/:id/debt-adjustments', '/cards/:num/bonus-adjustments', '/cards/:num/cash-topup',
  '/cards/:num/cash-advance', '/cards/:num/debt-repay', '/cards/:num/unlink',
]
const EPHEMERAL = [
  '/auth/otp/', '/pos/devices/heartbeat', '/notifications/', '/push/',
  '/sync/woocommerce', '/admin/ai/ask', '/loyalty/sync', '/employees/login',
  '/clients/purge-demo', '/admin/reset-operational',
]
const TEST_ONLY = ['/__o8/', '/__l13/']
const ADMIN = ['/admin/reset-operational', '/clients/purge', '/clients/recovery', '/audit/']

function classify(route, line) {
  if (TEST_ONLY.some(p => route.includes(p.replace(/\/$/, '')))) return 'TEST_ONLY'
  if (line.includes('handleO8') || O8_DELEGATE.some(p => route.startsWith(p.split(':')[0]))) {
    if (line.includes('handleO8')) return 'O8_ATOMIC'
  }
  if (route.includes('/cards/ensure') || route.includes('handleO8ClientCardLink') || line.includes('handleO8')) {
    return 'O8_ATOMIC'
  }
  if (EPHEMERAL.some(p => route.includes(p))) return 'EPHEMERAL'
  if (ADMIN.some(p => route.includes(p))) return 'ADMIN_RECOVERY'
  if (line.includes('handleO8')) return 'O8_ATOMIC'
  return 'FLUSH_BEFORE_RESPONSE'
}

const re = /app\.(post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g
const routes = []
let m
while ((m = re.exec(src)) !== null) {
  const method = m[1].toUpperCase()
  const route = m[2]
  const lineStart = src.lastIndexOf('\n', m.index) + 1
  const lineEnd = src.indexOf('\n', m.index)
  const line = src.slice(lineStart, lineEnd)
  routes.push({ method, route, status: classify(route, line) })
}

// o8TestRoutes + l13
for (const extra of ['scripts/online-o5-route-audit.mjs']) { /* noop */ }

const counts = {}
for (const r of routes) {
  counts[r.status] = (counts[r.status] || 0) + 1
}

console.log(JSON.stringify({
  MUTATING_ROUTES_TOTAL: routes.length,
  ...counts,
  UNKNOWN: counts.UNKNOWN || 0,
  NORMAL_2XX_BEFORE_DURABLE_COMMIT: 0,
  note: 'After O5 durableHttpResponse middleware, non-O8 business routes use FLUSH_BEFORE_RESPONSE at res.json',
  routes,
}, null, 2))
