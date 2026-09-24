/**
 * ONLINE-O6 — legacy write paths durable idempotency (PG lab).
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
import { opRefDocId, FIN_OP_KINDS, CRM_OP_KINDS } from '../server/kakapo-api/pg/businessMutationTx.js'
import {
  cleanupOnlineTestPrefixes,
  bootstrapTestLabCashVault,
} from './online-test-db-cleanup.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PREFIX = 'O6-'
const REQUIRE = String(process.env.O6_REAL_PG_REQUIRED || '') === '1'
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

async function countClientsByPhone(phoneDigits) {
  return withClient(async (c) => {
    const r = await c.query(
      `SELECT COUNT(*)::int AS n FROM docs WHERE collection='clients' AND regexp_replace(data->>'phone', '\\D', '', 'g') LIKE $1`,
      [`%${phoneDigits.slice(-9)}`],
    )
    return r.rows[0]?.n || 0
  })
}

async function ackLostRetry(api, port, { path: urlPath, method, body, clientRef, kind, countCheck }) {
  const inflight = fetchJson(`${api.base}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const op = await waitOpRef(clientRef, kind, 25000)
  expect(!!op?.result, `opRef durable ${kind} ${clientRef}`)
  await killApi(api.child)
  try { await inflight } catch { /* reset */ }
  const api2 = await startApi(port)
  const retry = await fetchJson(`${api2.base}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  expect(retry.ok, `retry ok ${kind} (${retry.status})`)
  if (countCheck) {
    const n = await countCheck()
    expect(n === 1, `single entity ${kind} (n=${n})`)
  }
  return { api: api2, retry, entityId: retry.body?.id ?? op?.result?.id ?? op?.result?.point?.id }
}

async function main() {
  console.log(`\n=== ONLINE-O6 REAL_PG=${REAL_PG} REQUIRED=${REQUIRE} ===\n`)
  if (!REAL_PG) {
    if (REQUIRE) expect(false, 'PG required')
    console.log(`\nO6: ${passed} passed, ${failed} failed\n`)
    process.exit(failed ? 1 : 0)
  }

  await ensureSchema()
  await cleanupOnlineTestPrefixes([PREFIX, 'O5B-', 'O5-'])
  await bootstrapTestLabCashVault()

  const port = 19165 + Math.floor(Math.random() * 100)
  let api = await startApi(port)
  const runId = String(process.env.ONLINE_RUN_ID || Date.now())
  const cref = (s) => `${PREFIX}${runId}-${s}`

  try {
    const phone = `+9929${String(runId).slice(-8)}`
    const clientRef = cref('cli')
    const clientBody = { name: `${PREFIX}User`, phone, clientRef }
    const ackCli = await ackLostRetry(api, port, {
      path: '/clients',
      method: 'POST',
      body: clientBody,
      clientRef,
      kind: CRM_OP_KINDS.CLIENT_UPSERT,
      countCheck: async () => countClientsByPhone(phone.replace(/\D/g, '')),
    })
    api = ackCli.api
    const clientId = ackCli.retry.body?.id

    const prod = await fetchJson(`${api.base}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${PREFIX}Sku`,
        price: 10,
        stock: 20,
        clientRef: cref('prod-seed'),
      }),
    })
    expect(prod.ok, 'seed product for order')
    const pid = prod.body?.id

    const orderRef = cref('ord')
    const orderBody = {
      clientRef: orderRef,
      client: { name: `${PREFIX}Buyer`, phone, addr: 'Test addr' },
      items: [{ product_id: pid, qty: 1, price: 10, name: `${PREFIX}Sku` }],
      total: 10,
      type: 'market',
    }
    const ackOrd = await ackLostRetry(api, port, {
      path: '/orders',
      method: 'POST',
      body: orderBody,
      clientRef: orderRef,
      kind: FIN_OP_KINDS.ORDER_CREATE,
    })
    api = ackOrd.api
    expect(ackOrd.retry.body?.id === ackOrd.entityId, 'order replay same id')

    const pointRef = cref('pos')
    const ackPos = await ackLostRetry(api, port, {
      path: '/pos/points',
      method: 'POST',
      body: { name: `${PREFIX}Point`, clientRef: pointRef },
      clientRef: pointRef,
      kind: FIN_OP_KINDS.POS_POINT_UPSERT,
    })
    api = ackPos.api
    const posId = ackPos.retry.body?.id

    const pair = await fetchJson(`${api.base}/pos/points/${encodeURIComponent(posId)}/pair-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(pair.ok && pair.body?.code, 'pair code issued')
    const bindRef = cref('bind')
    const deviceId = `${PREFIX}dev-${runId}`
    const bindBody = {
      clientRef: bindRef,
      code: pair.body.code,
      deviceId,
      deviceName: `${PREFIX}Terminal`,
    }
    const ackBind = await ackLostRetry(api, port, {
      path: '/pos/devices/bind',
      method: 'POST',
      body: bindBody,
      clientRef: bindRef,
      kind: FIN_OP_KINDS.DEVICE_BIND,
    })
    api = ackBind.api
    expect(ackBind.retry.body?.device?.id === deviceId, 'device bind replay same device')

    const cardNum = `O6${String(runId).slice(-10)}`.padEnd(12, '0').slice(0, 12)
    const cardRef = cref('card')
    const cardBody = { num: cardNum, clientId, clientRef: cardRef }
    const ackCard = await ackLostRetry(api, port, {
      path: '/cards/ensure',
      method: 'POST',
      body: cardBody,
      clientRef: cardRef,
      kind: CRM_OP_KINDS.CARD_ENSURE,
    })
    api = ackCard.api
    expect(String(ackCard.retry.body?.num).toUpperCase() === cardNum.toUpperCase(), 'card ensure replay same num')
    expect(ackCard.retry.body?.status !== 'active' || !ackCard.retry.body?.clientId || ackCard.retry.body?.clientId === clientId, 'card ensure record-only contract')

    const layerRef = cref('layer')
    const layerBody = { qty: 2, costPrice: 5, reason: `${PREFIX}layer`, clientRef: layerRef }
    const ackLayer = await ackLostRetry(api, port, {
      path: `/products/${pid}/stock-layers`,
      method: 'POST',
      body: layerBody,
      clientRef: layerRef,
      kind: 'stock_receipt_create',
    })
    api = ackLayer.api

    const mismatch = await fetchJson(`${api.base}/clients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Other', phone: '+79990000001', clientRef }),
    })
    expect(mismatch.status === 409, 'client create payload mismatch 409')

    const noRef = await fetchJson(`${api.base}/clients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${PREFIX}NoRef`, phone: '+79990000002' }),
    })
    expect(noRef.status === 400, 'PG client create requires clientRef')
  } finally {
    await killApi(api.child)
    await cleanupOnlineTestPrefixes([PREFIX, 'O5B-', 'O5-'])
    await closePool()
  }

  console.log(`\n=== ONLINE-O6: ${passed} passed, ${failed} failed ===\n`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
