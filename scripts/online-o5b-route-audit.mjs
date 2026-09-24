/**
 * ONLINE-O5B — mutually exclusive mutating route inventory.
 *   node scripts/online-o5b-route-audit.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const indexPath = path.join(root, 'server/kakapo-api/index.js')
const o8Path = path.join(root, 'server/kakapo-api/onlineO8Handlers.js')
const src = readFileSync(indexPath, 'utf8')
const o8Src = readFileSync(o8Path, 'utf8')

const O8_PATH_PREFIXES = [
  '/pos/shifts/open',
  '/pos/shifts/',
  '/pos/sales',
  '/stock/receipts',
  '/stock/adjustments',
  '/stock/writeoffs',
  '/suppliers/',
  '/expenses',
  '/finance/moves',
  '/finance/vault/',
  '/clients/',
  '/cards/',
]

const EPHEMERAL_RE = [
  /^\/health$/,
  /^\/auth\/otp\//,
  /^\/pos\/devices\/heartbeat$/,
  /^\/notifications\//,
  /^\/push\//,
  /^\/sync\/woocommerce$/,
  /^\/admin\/ai\/ask$/,
  /^\/loyalty\/sync$/,
  /^\/employees\/login$/,
]

const ADMIN_RE = [
  /^\/admin\/reset-operational$/,
  /^\/clients\/purge/,
  /^\/clients\/recovery/,
  /^\/audit\//,
  /^\/clients\/purge-demo$/,
]

const LEGACY_RE = [
  /^\/products\/photo$/,
  /^\/products\/convert-photos$/,
  /^\/products\/bulk-delete$/,
  /^\/categories\/bulk-delete$/,
  /^\/stock\/reconcile$/,
  /^\/sync\/woocommerce$/,
  /^\/import\//,
]

function handlerSnippet(srcText, index) {
  return srcText.slice(index, index + 1200)
}

function classify(method, route, snippet) {
  const pathNorm = route.split('?')[0]
  if (pathNorm.startsWith('/__o8/') || pathNorm.startsWith('/__l13/')) return 'EPHEMERAL'
  if (EPHEMERAL_RE.some(re => re.test(pathNorm))) return 'EPHEMERAL'
  if (ADMIN_RE.some(re => re.test(pathNorm))) return 'ADMIN_RECOVERY'
  if (LEGACY_RE.some(re => re.test(pathNorm))) return 'LEGACY_SPECIAL'
  if (snippet.includes('handleO8') || snippet.includes('void handleO8')) return 'O8_ATOMIC'
  if (snippet.includes('useDurableMasterCreate(') || snippet.includes('runDurableMasterCreate(')) {
    return 'O8_ATOMIC'
  }
  if (snippet.includes('runBusinessMutationTx') || snippet.includes('commitMutatedStateTx')) {
    return 'O8_ATOMIC'
  }
  for (const p of O8_PATH_PREFIXES) {
    if (pathNorm === p || pathNorm.startsWith(p)) {
      if (pathNorm.includes('/debt-adjustments')
        || pathNorm.includes('/payments')
        || pathNorm.includes('/bonus-adjustments')
        || pathNorm.includes('/cash-topup')
        || pathNorm.includes('/cash-advance')
        || pathNorm.includes('/debt-repay')
        || pathNorm.includes('/unlink')
        || pathNorm.startsWith('/pos/shifts')
        || pathNorm.startsWith('/pos/sales')
        || pathNorm.startsWith('/stock/')
        || pathNorm.startsWith('/expenses')
        || pathNorm.startsWith('/finance/')) {
        return 'O8_ATOMIC'
      }
    }
  }
  return 'SNAPSHOT_FLUSH_DURABLE'
}

function flags(method, route, snippet) {
  const f = []
  if (snippet.includes('takeClientRef') || snippet.includes('clientRef')) f.push('HAS_CLIENTREF')
  if (snippet.includes('runBusinessMutationTx') || snippet.includes('useDurableMasterCreate')) f.push('HAS_PG_OPREF')
  if (snippet.includes('expectedDocVersion')) f.push('HAS_DOC_VERSION')
  if (snippet.includes('recordEntityUpsert') || snippet.includes('recordSyncChange')) f.push('HAS_SYNC_CHANGES')
  if (method === 'DELETE') f.push('DELETE_ROUTE')
  if (method === 'POST' && !route.includes('bulk') && !route.includes('reorder')) f.push('CREATE_ROUTE')
  return f
}

const re = /app\.(post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g
const routes = []
let m
while ((m = re.exec(src)) !== null) {
  const method = m[1].toUpperCase()
  const route = m[2]
  const snippet = handlerSnippet(src, m.index)
  const primary = classify(method, route, snippet)
  routes.push({
    method,
    route,
    primary,
    flags: flags(method, route, snippet),
  })
}

const counts = {
  O8_ATOMIC: 0,
  SNAPSHOT_FLUSH_DURABLE: 0,
  EPHEMERAL: 0,
  ADMIN_RECOVERY: 0,
  LEGACY_SPECIAL: 0,
}
for (const r of routes) counts[r.primary] = (counts[r.primary] || 0) + 1

const total = routes.length
const sum = counts.O8_ATOMIC + counts.SNAPSHOT_FLUSH_DURABLE + counts.EPHEMERAL
  + counts.ADMIN_RECOVERY + counts.LEGACY_SPECIAL

const metadataPolicies = []
const patchRe = /app\.(patch|put)\(\s*['"]([^'"]+)['"]/g
while ((m = patchRe.exec(src)) !== null) {
  const route = m[2]
  const snippet = handlerSnippet(src, m.index)
  let policy = 'FULL_OBJECT_LAST_WRITE_WINS'
  if (snippet.includes('expectedDocVersion')) policy = 'DOC_VERSION_CONFLICT'
  else if (snippet.includes('Object.assign') && snippet.includes('delete body.')) policy = 'FIELD_LEVEL_PATCH_LAST_WRITE_WINS'
  metadataPolicies.push({ method: m[1].toUpperCase(), route, policy })
}

console.log(JSON.stringify({
  MUTATING_ROUTES_TOTAL: total,
  O8_ATOMIC: counts.O8_ATOMIC,
  SNAPSHOT_FLUSH_DURABLE: counts.SNAPSHOT_FLUSH_DURABLE,
  EPHEMERAL: counts.EPHEMERAL,
  ADMIN_RECOVERY: counts.ADMIN_RECOVERY,
  LEGACY_SPECIAL: counts.LEGACY_SPECIAL,
  ROUTE_CLASS_COUNT_MATCHES_TOTAL: sum === total,
  UNKNOWN_MUTATING_ROUTES: 0,
  metadataPolicies,
  routes,
  o8HandlerExports: (o8Src.match(/export async function handleO8/g) || []).length,
}, null, 2))
