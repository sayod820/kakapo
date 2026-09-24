/**
 * ONLINE-O6B — durable order status / action idempotency (PG lab).
 */
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  ensureSchema,
  closePool,
  withClient,
  isPostgresEnabled,
} from '../server/kakapo-api/pg/client.js'
import { opRefDocId, FIN_OP_KINDS } from '../server/kakapo-api/pg/businessMutationTx.js'
import {
  cleanupOnlineTestPrefixes,
  bootstrapTestLabCashVault,
} from './online-test-db-cleanup.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PREFIX = 'O6B-'
const REQUIRE = String(process.env.O6B_REAL_PG_REQUIRED || '') === '1'
const REAL_PG = isPostgresEnabled()

let passed = 0
let failed = 0

function expect(cond, msg) {
  if (cond) { passed += 1; console.log(`  OK  ${msg}`) }
  else { failed += 1; console.error(`  FAIL ${msg}`) }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchJson(url, init) {
  const res = await fetch(url, init)
  let body = null
  try { body = await res.json() } catch { body = null }
  return { ok: res.ok, status: res.status, body }
}

async function waitHealth(base, ms = 45000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetchJson(`${base}/health`)
      if (r.ok && r.body?.ok) return true
    } catch { /* retry */ }
    await sleep(250)
  }
  return false
}

function startApi(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['index.js'], {
      cwd: path.join(root, 'server/kakapo-api'),
      env: { ...process.env, PORT: String(port), KAKAPO_O8_TEST_API: '1', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr?.on('data', (d) => { stderr += String(d) })
    const base = `http://127.0.0.1:${port}`
    waitHealth(base).then((up) => {
      if (!up) {
        try { child.kill('SIGKILL') } catch { /* ignore */ }
        reject(new Error(`API failed: ${stderr.slice(-1200)}`))
        return
      }
      resolve({ child, base })
    })
  })
}

function killApi(child) {
  return new Promise((resolve) => {
    if (!child) return resolve()
    child.once('exit', () => resolve())
    try { child.kill('SIGKILL') } catch { /* ignore */ }
    setTimeout(resolve, 3000)
  })
}

async function waitOpRef(clientRef, kind, ms = 25000) {
  const id = opRefDocId(kind, clientRef)
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const row = await withClient(async (c) => {
      const r = await c.query(`SELECT data FROM docs WHERE collection='opRefs' AND id=$1`, [id])
      return r.rows[0]?.data
    })
    if (row?.result) return row
    await sleep(100)
  }
  return null
}

async function productStock(api, productId) {
  const p = await fetchJson(`${api.base}/products/${productId}`)
  const layers = await fetchJson(`${api.base}/products/${productId}/stock-layers`)
  const layerSum = (layers.body || []).reduce((s, l) => s + (Number(l.remainingQty) || 0), 0)
  return Math.max(Number(p.body?.stock) || 0, layerSum)
}

async function countNotifications(prefix) {
  return withClient(async (c) => {
    const r = await c.query(
      `SELECT COUNT(*)::int AS n FROM docs WHERE collection='notifications' AND id LIKE $1`,
      [`${prefix}%`],
    )
    return r.rows[0]?.n || 0
  })
}

async function seedOrder(api, cref, tag = '') {
  const phone = `+9929${String(Date.now()).slice(-8)}${tag.slice(0, 2)}`
  const prod = await fetchJson(`${api.base}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `${PREFIX}Sku${tag}`,
      price: 10,
      stock: 5,
      clientRef: cref(`prod${tag}`),
    }),
  })
  expect(prod.ok, `seed product${tag}`)
  const pid = prod.body?.id
  const orderRef = cref(`ord${tag}`)
  const ord = await fetchJson(`${api.base}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: orderRef,
      client: { name: `${PREFIX}Buyer`, phone, addr: 'Addr' },
      items: [{ product_id: pid, qty: 2, price: 10, name: `${PREFIX}Sku` }],
      total: 20,
      type: 'market',
    }),
  })
  expect(ord.ok, 'seed order')
  return { orderId: ord.body?.id, pid, phone, productStock: prod.body?.stock }
}

async function patchStatus(api, orderId, status, clientRef, extra = {}) {
  return fetchJson(`${api.base}/orders/${encodeURIComponent(orderId)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, clientRef, ...extra }),
  })
}

async function main() {
  console.log(`\n=== ONLINE-O6B REAL_PG=${REAL_PG} REQUIRED=${REQUIRE} ===\n`)
  if (!REAL_PG) {
    if (REQUIRE) expect(false, 'PG required')
    console.log(`\nO6B: ${passed} passed, ${failed} failed\n`)
    process.exit(failed ? 1 : 0)
  }

  await ensureSchema()
  await cleanupOnlineTestPrefixes([PREFIX, 'O6-', 'O6B-'])
  await bootstrapTestLabCashVault()

  const port = 19180 + Math.floor(Math.random() * 80)
  let api = await startApi(port)
  const runId = String(process.env.ONLINE_RUN_ID || Date.now())
  const cref = (s) => `${PREFIX}${runId}-${s}`

  try {
    const { orderId, pid } = await seedOrder(api, cref, runId)
    expect(!!orderId, 'order id present')

    const noRef = await patchStatus(api, orderId, 'assembling', '')
    expect(noRef.status === 400 && noRef.body?.code === 'CLIENT_REF_REQUIRED', 'missing clientRef → 400')

    const confirmRef = cref('confirm')
    const confirmBody = { status: 'assembling', clientRef: confirmRef }
    const inflight = patchStatus(api, orderId, 'assembling', confirmRef)
    const op = await waitOpRef(confirmRef, FIN_OP_KINDS.ORDER_STATUS_UPDATE, 25000)
    expect(!!op?.result, 'confirm opRef durable')
    expect(!!op?.result?.id, 'confirm opRef stores order entity')
    await killApi(api.child)
    try { await inflight } catch { /* reset */ }
    api = await startApi(port)
    const retry = await patchStatus(api, orderId, 'assembling', confirmRef)
    expect(retry.ok && retry.body?.status === 'assembling', 'confirm ACK-lost retry')
    expect(retry.body?.id === orderId, 'confirm replay same order')
    const op2 = await waitOpRef(confirmRef, FIN_OP_KINDS.ORDER_STATUS_UPDATE, 5000)
    expect(op2?.result?.status === 'assembling', 'opRef stores assembling')

    const conflict = await patchStatus(api, orderId, 'cancelled', confirmRef)
    expect(conflict.status === 409, 'same ref different status → 409')

    const cancelRef = cref('cancel')
    const stockBefore = await productStock(api, pid)
    const cancel = await patchStatus(api, orderId, 'cancelled', cancelRef)
    expect(cancel.ok && cancel.body?.status === 'cancelled', 'cancel transition')
    const stockAfter = await productStock(api, pid)
    expect(stockAfter >= stockBefore, 'cancel restores stock (>= before cancel path)')

    const cancelRetry = await patchStatus(api, orderId, 'cancelled', cancelRef)
    expect(cancelRetry.ok, 'cancel replay ok')
    expect(
      cancelRetry.body?.replayed || cancelRetry.body?.idempotentReplay || cancelRetry.body?.status === 'cancelled',
      'cancel replay response',
    )
    expect((cancelRetry.body?.stockReserveLines || []).length === 0, 'cancel replay reserve cleared once')

    const dupRef1 = cref('dup-a')
    const dupRef2 = cref('dup-b')
    const dup1 = await patchStatus(api, orderId, 'cancelled', dupRef1)
    const dup2 = await patchStatus(api, orderId, 'cancelled', dupRef2)
    expect(dup1.ok && dup2.ok, 'same-status different ref ok')
    expect(dup1.body?.status === 'cancelled' && dup2.body?.status === 'cancelled', 'same-status noop state')

    const stale = await patchStatus(api, orderId, 'assembling', cref('stale'))
    expect(stale.status === 409, 'stale action on cancelled terminal → 409')

    const notifBefore = await countNotifications(`ord-${orderId}`)
    await patchStatus(api, orderId, 'cancelled', cref('notif-replay'))
    const notifAfter = await countNotifications(`ord-${orderId}`)
    expect(notifAfter === notifBefore, 'notification rows not duplicated on no-op replay')

    const ord2 = await seedOrder(api, cref, '-2')
    const preRef = cref('precommit')
    const preKill = patchStatus(api, ord2.orderId, 'assembling', preRef)
    await sleep(400)
    await killApi(api.child)
    try { await preKill } catch { /* ignore */ }
    api = await startApi(port)
    const preOp = await waitOpRef(preRef, FIN_OP_KINDS.ORDER_STATUS_UPDATE, 3000)
    const ordCheck = await fetchJson(`${api.base}/orders/${ord2.orderId}`)
    if (!preOp) {
      expect(ordCheck.body?.status === 'new', 'precommit kill: status unchanged')
    } else {
      expect(ordCheck.body?.status === 'assembling', 'postcommit before kill')
      const preRetry = await patchStatus(api, ord2.orderId, 'assembling', preRef)
      expect(preRetry.ok, 'precommit/postcommit retry replay')
    }

    const [a, b] = await Promise.all([
      patchStatus(api, ord2.orderId, 'assembling', cref('conc-a')),
      patchStatus(api, ord2.orderId, 'cancelled', cref('conc-b')),
    ])
    expect(a.ok || b.ok, 'concurrency: at least one ok')
    const finalOrd = await fetchJson(`${api.base}/orders/${ord2.orderId}`)
    expect(['assembling', 'cancelled', 'new'].includes(finalOrd.body?.status), 'concurrency: valid final status')
    if (a.ok && b.ok && a.body?.status !== b.body?.status) {
      expect(
        finalOrd.body?.status === a.body?.status || finalOrd.body?.status === b.body?.status,
        'concurrency: PG final matches one committed action',
      )
    }

    await killApi(api.child)
    api = await startApi(port)
    const hydrated = await fetchJson(`${api.base}/orders/${orderId}`)
    expect(hydrated.body?.status === 'cancelled', 'restart hydration order status')
    const pgOrd = await withClient(async (c) => {
      const r = await c.query(`SELECT data FROM docs WHERE collection='orders' AND id=$1`, [String(orderId)])
      return r.rows[0]?.data
    })
    expect(pgOrd?.status === hydrated.body?.status, 'restart PG=API order')
  } finally {
    await killApi(api?.child)
    await closePool()
  }

  console.log(`\n=== ONLINE-O6B: ${passed} passed, ${failed} failed ===\n`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
