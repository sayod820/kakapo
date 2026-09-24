/**
 * ONLINE-O5 — master data durable-before-response + restart hydration.
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
import {
  cleanupOnlineTestPrefixes,
  bootstrapTestLabCashVault,
} from './online-test-db-cleanup.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PREFIX = 'O5-'
const REQUIRE = String(process.env.O5_REAL_PG_REQUIRED || '') === '1'
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

async function pgProduct(id) {
  return withClient(async (c) => {
    const r = await c.query(
      `SELECT data FROM docs WHERE collection='products' AND id=$1`,
      [String(id)],
    )
    return r.rows[0]?.data || null
  })
}

async function pgSupplier(id) {
  return withClient(async (c) => {
    const r = await c.query(
      `SELECT data FROM docs WHERE collection='suppliers' AND id=$1`,
      [String(id)],
    )
    return r.rows[0]?.data || null
  })
}

async function main() {
  console.log(`\n=== ONLINE-O5 REAL_PG=${REAL_PG} REQUIRED=${REQUIRE} ===\n`)
  if (!REAL_PG) {
    if (REQUIRE) expect(false, 'PG required')
    console.log(`\nO5: ${passed} passed, ${failed} failed\n`)
    process.exit(failed ? 1 : 0)
  }

  await ensureSchema()
  await cleanupOnlineTestPrefixes([PREFIX])
  await bootstrapTestLabCashVault()

  const port = 19105 + Math.floor(Math.random() * 100)
  let api = await startApi(port)
  const runId = String(process.env.ONLINE_RUN_ID || Date.now())
  const cref = (s) => `${PREFIX}${runId}-${s}`

  try {
    const id = await withClient(async (c) => {
      const r = await c.query('SELECT current_database() AS db')
      return r.rows[0]?.db
    })
    expect(String(id).includes('test'), 'O5 PG test database')

    const createRef = cref('prod-create')
    const p0 = await fetchJson(`${api.base}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${PREFIX}ZeroStock`,
        price: 99,
        stock: 0,
        clientRef: createRef,
      }),
    })
    expect(p0.ok, `product create stock0 (${p0.status})`)
    const pid = p0.body?.id
    const pg0 = await pgProduct(pid)
    expect(pg0 && pg0.name === `${PREFIX}ZeroStock`, 'PG product after create')

    const pReplay = await fetchJson(`${api.base}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${PREFIX}ZeroStock-replay`,
        price: 1,
        stock: 0,
        clientRef: createRef,
      }),
    })
    expect(pReplay.status === 409, 'product create same clientRef different payload → 409')
    const pSame = await fetchJson(`${api.base}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${PREFIX}ZeroStock`,
        price: 99,
        stock: 0,
        clientRef: createRef,
      }),
    })
    expect(pSame.ok && pSame.body?.id === pid, 'product create same clientRef same payload replay')

    const patchRef = cref('prod-patch')
    const p1 = await fetchJson(`${api.base}/products/${pid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${PREFIX}Renamed`,
        price: 120,
        expectedDocVersion: p0.body?.docVersion ?? 1,
        clientRef: patchRef,
      }),
    })
    expect(p1.ok, 'product metadata patch')
    expect(p1.body?.price === 120, 'product price updated')

    const stockBlock = await fetchJson(`${api.base}/products/${pid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock: 999 }),
    })
    expect(stockBlock.status === 400, 'product PATCH stock blocked')

    const pStock = await fetchJson(`${api.base}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${PREFIX}WithStock`,
        price: 50,
        stock: 5,
        clientRef: cref('prod-stock'),
      }),
    })
    expect(pStock.ok, 'product create initial stock')
    const layers = await fetchJson(`${api.base}/products/${pStock.body.id}/stock-layers`)
    expect(Array.isArray(layers.body) && layers.body.length > 0, 'initial stock layers present')

    const sup = await fetchJson(`${api.base}/suppliers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${PREFIX}Supplier`,
        phone: '+79990001122',
        clientRef: cref('sup-create'),
      }),
    })
    expect(sup.ok, 'supplier create')
    const sid = sup.body?.id
    const paidBefore = Number(sup.body?.totalPaid) || 0
    const supPatch = await fetchJson(`${api.base}/suppliers/${sid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${PREFIX}Supplier-Edited`,
        totalPaid: 99999,
        clientRef: cref('sup-patch'),
      }),
    })
    expect(supPatch.ok, 'supplier metadata patch')
    expect(Number(supPatch.body?.totalPaid) === paidBefore, 'supplier totalPaid not via PATCH')

    const cl = await fetchJson(`${api.base}/clients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${PREFIX}Client`,
        phone: `+7999${String(runId).slice(-7)}`,
        clientRef: cref('cli-create'),
      }),
    })
    expect(cl.ok, 'client create')
    const cid = cl.body?.id
    const debtBlock = await fetchJson(`${api.base}/clients/${cid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ debt: 100 }),
    })
    expect(debtBlock.status === 400, 'client PATCH debt blocked')
    const bonusBlock = await fetchJson(`${api.base}/clients/${cid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bonus: 100 }),
    })
    expect(bonusBlock.status === 400, 'client PATCH bonus blocked')
    const metaOk = await fetchJson(`${api.base}/clients/${cid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${PREFIX}Client-Meta`, clientRef: cref('cli-meta') }),
    })
    expect(metaOk.ok, 'client metadata patch')

    const cat = await fetchJson(`${api.base}/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${PREFIX}Cat-${runId}`, clientRef: cref('cat') }),
    })
    expect(cat.ok, `category create (${cat.status})`)

    const emp = await fetchJson(`${api.base}/employees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${PREFIX}Staff-${runId}`,
        role: 'cashier',
        password: '1234',
        clientRef: cref('emp'),
      }),
    })
    expect(emp.ok, 'employee create')

    const promo = await fetchJson(`${api.base}/promos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `${PREFIX}Promo`,
        disc: 5,
      }),
    })
    expect(promo.ok, 'promo create')

    const snapName = `${PREFIX}Renamed`
    const snapPrice = 120
    await killApi(api.child)
    api = await startApi(port)
    const pgAfter = await pgProduct(pid)
    expect(pgAfter?.name === snapName, 'PG product after restart')
    const list = await fetchJson(`${api.base}/products`)
    const row = (list.body || []).find((p) => Number(p.id) === Number(pid))
    expect(row && row.name === snapName && Number(row.price) === snapPrice, 'restart product metadata API=PG')
    const supPg = await pgSupplier(sid)
    expect(supPg?.name === `${PREFIX}Supplier-Edited`, 'PG supplier metadata after restart')

    const del = await fetchJson(`${api.base}/products/${pid}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRef: cref('prod-del') }),
    })
    expect(del.ok, 'product delete zero stock')
    await killApi(api.child)
    api = await startApi(port)
    const gone = await fetchJson(`${api.base}/products/${pid}`)
    expect(gone.status === 404, 'deleted product not resurrected')
    const pgGone = await pgProduct(pid)
    expect(!pgGone, 'PG product row removed')
  } finally {
    await killApi(api.child)
    await cleanupOnlineTestPrefixes([PREFIX])
    await closePool()
  }

  console.log(`\n=== ONLINE-O5: ${passed} passed, ${failed} failed ===\n`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
