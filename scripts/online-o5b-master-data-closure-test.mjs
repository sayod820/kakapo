/**
 * ONLINE-O5B — master data durable create idempotency, ACK-lost restart, metadata proofs.
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
const PREFIX = 'O5B-'
const REQUIRE = String(process.env.O5B_REAL_PG_REQUIRED || '') === '1'
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

function startApi(port, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['index.js'], {
      cwd: path.join(root, 'server/kakapo-api'),
      env: {
        ...process.env,
        PORT: String(port),
        KAKAPO_O8_TEST_API: '1',
        NODE_ENV: 'test',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr?.on('data', (d) => { stderr += String(d) })
    const base = `http://127.0.0.1:${port}`
    waitHealth(base).then((up) => {
      if (!up) {
        try { child.kill('SIGKILL') } catch { /* ignore */ }
        reject(new Error(`API failed: ${stderr.slice(-800)}`))
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

async function waitOpRef(clientRef, kind, ms = 20000) {
  const id = opRefDocId(kind, clientRef)
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const row = await withClient(async (c) => {
      const r = await c.query(
        `SELECT data FROM docs WHERE collection='opRefs' AND id=$1`,
        [id],
      )
      return r.rows[0]?.data
    })
    if (row?.result) return row
    await sleep(100)
  }
  return null
}

async function countProductsByName(name) {
  return withClient(async (c) => {
    const r = await c.query(
      `SELECT COUNT(*)::int AS n FROM docs WHERE collection='products' AND data->>'name' = $1`,
      [name],
    )
    return r.rows[0]?.n || 0
  })
}

async function pgProduct(id) {
  return withClient(async (c) => {
    const r = await c.query(
      `SELECT data FROM docs WHERE collection='products' AND id=$1`,
      [String(id)],
    )
    return r.rows[0]?.data || null
  })
}

async function ackLostRestartRetry(api, port, {
  path: urlPath,
  method,
  body,
  clientRef,
  kind,
  countName,
}) {
  const inflight = fetchJson(`${api.base}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const op = await waitOpRef(clientRef, kind, 25000)
  expect(!!op?.result, `ACK-lost opRef durable ${clientRef}`)
  await killApi(api.child)
  let first = null
  try { first = await inflight } catch { /* connection reset */ }
  api = await startApi(port)
  const retry = await fetchJson(`${api.base}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(retry.ok, `ACK-lost retry ok (${retry.status})`)
  const entityId = retry.body?.id ?? op?.result?.id
  expect(String(retry.body?.id ?? '') === String(entityId ?? ''), 'ACK-lost retry same entity id')
  if (countName) {
    const n = await countProductsByName(countName)
    expect(n === 1, `ACK-lost single PG entity for ${countName} (n=${n})`)
  }
  return { api, entityId, retry, first }
}

async function main() {
  console.log(`\n=== ONLINE-O5B REAL_PG=${REAL_PG} REQUIRED=${REQUIRE} ===\n`)
  if (!REAL_PG) {
    if (REQUIRE) expect(false, 'PG required')
    console.log(`\nO5B: ${passed} passed, ${failed} failed\n`)
    process.exit(failed ? 1 : 0)
  }

  await ensureSchema()
  await cleanupOnlineTestPrefixes([PREFIX, 'O5-'])
  await bootstrapTestLabCashVault()

  const port = 19155 + Math.floor(Math.random() * 100)
  let api = await startApi(port)
  const runId = String(process.env.ONLINE_RUN_ID || Date.now())
  const cref = (s) => `${PREFIX}${runId}-${s}`

  try {
    const prodName = `${PREFIX}AckLost-${runId}`
    const prodRef = cref('prod-ack')
    const prodBody = { name: prodName, price: 77, stock: 0, clientRef: prodRef }
    const ackProd = await ackLostRestartRetry(api, port, {
      path: '/products',
      method: 'POST',
      body: prodBody,
      clientRef: prodRef,
      kind: FIN_OP_KINDS.PRODUCT_UPSERT,
      countName: prodName,
    })
    api = ackProd.api

    const stockName = `${PREFIX}StockAck-${runId}`
    const stockRef = cref('prod-stock-ack')
    const stockBody = { name: stockName, price: 40, stock: 7, clientRef: stockRef }
    const ackStock = await ackLostRestartRetry(api, port, {
      path: '/products',
      method: 'POST',
      body: stockBody,
      clientRef: stockRef,
      kind: FIN_OP_KINDS.PRODUCT_UPSERT,
      countName: stockName,
    })
    api = ackStock.api
    const stockId = ackStock.entityId
    const layers = await fetchJson(`${api.base}/products/${stockId}/stock-layers`)
    const layerQty = (layers.body || []).reduce((s, L) => s + (Number(L.qty) || 0), 0)
    expect(Math.abs(layerQty - 7) < 0.02, `initial stock single layer set (${layerQty})`)
    const replayStock = await fetchJson(`${api.base}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stockBody),
    })
    expect(replayStock.body?.id === stockId, 'initial stock replay same id')
    expect(await countProductsByName(stockName) === 1, 'initial stock no duplicate product')

    const supRef = cref('sup-ack')
    const supBody = { name: `${PREFIX}Sup-${runId}`, phone: '+79991112233', clientRef: supRef }
    const ackSup = await ackLostRestartRetry(api, port, {
      path: '/suppliers',
      method: 'POST',
      body: supBody,
      clientRef: supRef,
      kind: FIN_OP_KINDS.SUPPLIER_UPSERT,
    })
    api = ackSup.api

    const catRef = cref('cat-ack')
    const catBody = { name: `${PREFIX}Cat-${runId}`, clientRef: catRef }
    const ackCat = await ackLostRestartRetry(api, port, {
      path: '/categories',
      method: 'POST',
      body: catBody,
      clientRef: catRef,
      kind: FIN_OP_KINDS.CATEGORY_UPSERT,
    })
    api = ackCat.api

    const empRef = cref('emp-ack')
    const empBody = {
      name: `${PREFIX}Emp-${runId}`,
      role: 'cashier',
      password: '1234',
      clientRef: empRef,
    }
    const ackEmp = await ackLostRestartRetry(api, port, {
      path: '/employees',
      method: 'POST',
      body: empBody,
      clientRef: empRef,
      kind: FIN_OP_KINDS.EMPLOYEE_UPSERT,
    })
    api = ackEmp.api

    const promoRef = cref('promo-ack')
    const promoBody = { title: `${PREFIX}Promo-${runId}`, disc: 10, clientRef: promoRef }
    const ackPromo = await ackLostRestartRetry(api, port, {
      path: '/promos',
      method: 'POST',
      body: promoBody,
      clientRef: promoRef,
      kind: FIN_OP_KINDS.PROMO_UPSERT,
    })
    api = ackPromo.api

    const mismatch = await fetchJson(`${api.base}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${PREFIX}Mismatch`,
        price: 1,
        stock: 0,
        clientRef: prodRef,
      }),
    })
    expect(mismatch.status === 409, 'idempotency payload mismatch 409')

    const delRef = cref('del-prod')
    const delTarget = await fetchJson(`${api.base}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${PREFIX}Del-${runId}`,
        price: 1,
        stock: 0,
        clientRef: cref('del-create'),
      }),
    })
    const delId = delTarget.body?.id
    const del1 = await fetchJson(`${api.base}/products/${delId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRef: delRef }),
    })
    expect(del1.ok, 'product delete')
    const del2 = await fetchJson(`${api.base}/products/${delId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRef: delRef }),
    })
    expect(del2.ok && (del2.body?.replayed || del2.body?.idempotentReplay), 'delete retry replay')
    await killApi(api.child)
    api = await startApi(port)
    const del3 = await fetchJson(`${api.base}/products/${delId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRef: delRef }),
    })
    expect(del3.ok, 'delete retry after restart')
    expect(!(await pgProduct(delId)), 'delete not resurrected in PG')

    const pA = await fetchJson(`${api.base}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${PREFIX}Luw-${runId}`,
        price: 100,
        stock: 0,
        clientRef: cref('luw-create'),
      }),
    })
    const luwId = pA.body?.id
    const v1 = pA.body?.docVersion ?? 1
    const patchA = await fetchJson(`${api.base}/products/${luwId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${PREFIX}Luw-A`, expectedDocVersion: v1 }),
    })
    expect(patchA.ok, 'product patch name')
    const patchB = await fetchJson(`${api.base}/products/${luwId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: 222, expectedDocVersion: v1 }),
    })
    expect(patchB.status === 409, 'product concurrent patch version conflict')

    await killApi(api.child)
    api = await startApi(port, { KAKAPO_MASTER_FLUSH_FAIL: '1', KAKAPO_MASTER_DATA_PERSIST: '1' })
    const flushFail = await fetchJson(`${api.base}/promos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `${PREFIX}FlushFail-${runId}`, disc: 1 }),
    })
    expect(flushFail.status >= 500, `flush fail not 2xx (${flushFail.status})`)
    await killApi(api.child)
    api = await startApi(port)
  } finally {
    await killApi(api.child)
    await cleanupOnlineTestPrefixes([PREFIX, 'O5-'])
    await closePool()
  }

  console.log(`\n=== ONLINE-O5B: ${passed} passed, ${failed} failed ===\n`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
