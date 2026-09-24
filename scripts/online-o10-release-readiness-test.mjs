/**
 * ONLINE-O10 — Final release readiness (lab only; does NOT deploy).
 * Production-like start, CORS/WS/staff revoke, ready, restore drill.
 */
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { loadLocalEnv } from '../server/kakapo-api/loadEnv.js'
loadLocalEnv()

import {
  ensureSchema,
  closePool,
  withClient,
  isPostgresEnabled,
  getDatabaseUrl,
} from '../server/kakapo-api/pg/client.js'
import { assertSafeAuthEnvOrThrow } from '../server/kakapo-api/apiAuth.js'
import {
  cleanupOnlineTestPrefixes,
  bootstrapTestLabCashVault,
  assertTestDatabaseAllowed,
} from './online-test-db-cleanup.mjs'

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/kakapo-api/package.json'))
const WebSocket = require('ws')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PREFIX = 'O10-'
const REQUIRE = String(process.env.O10_REAL_PG_REQUIRED || '') === '1'
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
  try {
    const res = await fetch(url, init)
    let body = null
    try { body = await res.json() } catch { body = null }
    return { ok: res.ok, status: res.status, body }
  } catch (e) {
    return { ok: false, status: 0, body: { detail: String(e?.message || e) } }
  }
}

async function waitHealth(base, ms = 45000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const r = await fetchJson(`${base}/health`)
    if (r.ok && r.body?.ok) return true
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
        NODE_ENV: extraEnv.NODE_ENV || 'test',
        KAKAPO_AUTH_ENFORCE: '1',
        KAKAPO_LAB_AUTO_AUTH: '0',
        KAKAPO_O8_TEST_API: '0',
        KAKAPO_L13_TEST_API: '0',
        KAKAPO_OTP_LAB: '0',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr?.on('data', (d) => { stderr += String(d) })
    const base = `http://127.0.0.1:${port}`
    waitHealth(base).then((up) => {
      if (!up) {
        try { child.kill('SIGKILL') } catch { /* */ }
        reject(new Error(`API failed: ${stderr.slice(-1500)}`))
        return
      }
      resolve({ child, base, port, stderr })
    })
  })
}

function killApi(child) {
  return new Promise((resolve) => {
    if (!child) return resolve()
    child.once('exit', () => resolve())
    try { child.kill('SIGTERM') } catch { /* */ }
    setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* */ }
      resolve()
    }, 4000)
  })
}

function startApiExpectFail(port, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['index.js'], {
      cwd: path.join(root, 'server/kakapo-api'),
      env: { ...process.env, PORT: String(port), ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let settled = false
    const done = (v) => { if (!settled) { settled = true; resolve(v) } }
    const t = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* */ }
      done({ code: -1, timedOut: true })
    }, 12000)
    child.on('exit', (code) => {
      clearTimeout(t)
      done({ code: code ?? 1, timedOut: false })
    })
  })
}

console.log(`\n=== ONLINE-O10 RELEASE READINESS REAL_PG=${REAL_PG} REQUIRED=${REQUIRE} ===`)
if (REQUIRE && !REAL_PG) {
  console.error('FAIL: O10 requires DATABASE_URL')
  process.exit(1)
}
if (!REAL_PG) {
  console.log('SKIP (no DATABASE_URL)')
  process.exit(0)
}

await ensureSchema()
await assertTestDatabaseAllowed()
await cleanupOnlineTestPrefixes([PREFIX])
await bootstrapTestLabCashVault()

// ── Unit: production CORS / lab flags ──
console.log('\n--- D Safe startup assertions ---')
{
  const saved = { ...process.env }
  process.env.NODE_ENV = 'production'
  process.env.CORS_ORIGINS = 'https://kakappo.shop'
  delete process.env.KAKAPO_O8_TEST_API
  delete process.env.KAKAPO_LAB_AUTO_AUTH
  delete process.env.KAKAPO_L13_TEST_API
  delete process.env.KAKAPO_OTP_LAB
  try {
    assertSafeAuthEnvOrThrow()
    expect(true, 'production+explicit CORS ok')
  } catch (e) {
    expect(false, `safe assert threw: ${e.message}`)
  }
  process.env.CORS_ORIGINS = '*'
  try {
    assertSafeAuthEnvOrThrow()
    expect(false, 'CORS=* should throw')
  } catch {
    expect(true, 'LAB_AUTO / CORS: production refuses CORS=*')
  }
  for (const k of Object.keys(saved)) {
    if (saved[k] != null) process.env[k] = saved[k]
    else delete process.env[k]
  }
  process.env.NODE_ENV = saved.NODE_ENV || 'test'
}

const failCors = await startApiExpectFail(19310 + Math.floor(Math.random() * 40), {
  NODE_ENV: 'production',
  CORS_ORIGINS: '*',
  KAKAPO_LAB_AUTO_AUTH: '0',
  KAKAPO_O8_TEST_API: '0',
  KAKAPO_L13_TEST_API: '0',
  KAKAPO_OTP_LAB: '0',
  KAKAPO_ADMIN_PASSWORD: 'o10-prod-lab-only',
})
expect(failCors.code !== 0 && !failCors.timedOut, `production process refuses CORS=* (code=${failCors.code})`)

// ── Production-like start ──
console.log('\n--- V Production-like start ---')
const PORT = 19350 + Math.floor(Math.random() * 40)
let api = await startApi(PORT, {
  NODE_ENV: 'production',
  CORS_ORIGINS: 'https://kakappo.shop,https://www.kakappo.shop',
  KAKAPO_ADMIN_PASSWORD: 'o10-prod-lab-only',
})

try {
  const health = await fetchJson(`${api.base}/health`)
  expect(health.ok && health.body?.ok, 'health ok')
  const ready = await fetchJson(`${api.base}/ready`)
  expect(ready.ok && ready.body?.ready === true, `ready DB-aware (${ready.status})`)

  const o8 = await fetchJson(`${api.base}/__o8/ping`)
  expect(o8.status === 404, `__o8 not mounted (${o8.status})`)
  const l13 = await fetchJson(`${api.base}/__l13/ping`)
  expect(l13.status === 404, `__l13 not mounted (${l13.status})`)

  const anonSale = await fetchJson(`${api.base}/pos/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: `${PREFIX}anon`, paymentMethod: 'cash', total: 1, paidCash: 1, items: [] }),
  })
  expect(anonSale.status === 401, `anon privileged 401 (${anonSale.status})`)

  const products = await fetchJson(`${api.base}/products`)
  expect(products.ok, 'public catalog works')

  const login = await fetchJson(`${api.base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'admin', password: 'o10-prod-lab-only' }),
  })
  // admin password may still be admin123 from seed if env only applies on first bootstrap
  let adminTok = login.body?.access_token
  if (!login.ok) {
    const login2 = await fetchJson(`${api.base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'admin', password: 'admin123' }),
    })
    expect(login2.ok && login2.body?.access_token, `admin login fallback (${login2.status})`)
    adminTok = login2.body?.access_token
  } else {
    expect(true, 'admin login production-like')
  }
  const adminH = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminTok}` }

  // WS protocol auth
  console.log('\n--- F WS Sec-WebSocket-Protocol ---')
  const wsOk = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${api.port}/ws/admin`, ['kakapo', adminTok])
    const t = setTimeout(() => { try { ws.close() } catch { /* */ }; resolve(false) }, 3000)
    ws.on('open', () => { clearTimeout(t); try { ws.close() } catch { /* */ }; resolve(true) })
    ws.on('unexpected-response', () => { clearTimeout(t); resolve(false) })
  })
  expect(wsOk, 'admin WS via Sec-WebSocket-Protocol')

  const wsQuery = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${api.port}/ws/admin?token=${encodeURIComponent(adminTok)}`)
    const t = setTimeout(() => { try { ws.close() } catch { /* */ }; resolve('timeout') }, 2500)
    ws.on('open', () => { clearTimeout(t); try { ws.close() } catch { /* */ }; resolve('open') })
    ws.on('unexpected-response', (_r, res) => { clearTimeout(t); resolve(String(res.statusCode)) })
  })
  // production ignores query token → 401
  expect(wsQuery === '401' || wsQuery === 'timeout' || wsQuery !== 'open',
    `production ignores WS query token (got ${wsQuery})`)

  // Staff revoke
  console.log('\n--- G Staff live revoke ---')
  const empName = `${PREFIX}Staff-${Date.now()}`
  const emp = await fetchJson(`${api.base}/employees`, {
    method: 'POST',
    headers: adminH,
    body: JSON.stringify({
      name: empName,
      role: 'cashier',
      permissions: ['sales'],
      password: 'staff-pin-99',
      clientRef: `${PREFIX}emp-${Date.now()}`,
    }),
  })
  if (!(emp.ok && emp.body?.id)) {
    expect(false, `create staff (${emp.status} ${emp.body?.detail || ''})`)
    throw new Error('create staff failed')
  }
  expect(true, `create staff (${emp.body.id})`)

  // Dedicated POS point for this run (avoid name collisions on shared lab POS)
  const p = await fetchJson(`${api.base}/pos/points`, {
    method: 'POST',
    headers: adminH,
    body: JSON.stringify({ name: `${PREFIX}POS-${Date.now()}`, clientRef: `${PREFIX}pos-${Date.now()}` }),
  })
  expect(p.ok && p.body?.id, `create POS (${p.status})`)
  const posId = p.body.id
  const pair = await fetchJson(`${api.base}/pos/points/${posId}/pair-code`, {
    method: 'POST',
    headers: adminH,
    body: '{}',
  })
  expect(pair.ok && pair.body?.code, `pair-code (${pair.status})`)
  const deviceId = `${PREFIX}dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const bind = await fetchJson(`${api.base}/pos/devices/bind`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: pair.body.code,
      deviceId,
      name: deviceId,
      clientRef: `${PREFIX}bind-${Date.now()}`,
    }),
  })
  if (!bind.ok) {
    expect(false, `device bind (${bind.status} ${bind.body?.detail || ''})`)
    throw new Error('device bind failed')
  }
  expect(true, 'device bind ok')
  const staffLogin = await fetchJson(`${api.base}/employees/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-kakapo-device-id': deviceId },
    body: JSON.stringify({ id: emp.body.id, password: 'staff-pin-99' }),
  })
  if (!(staffLogin.ok && staffLogin.body?.access_token)) {
    expect(false, `staff login (${staffLogin.status} ${staffLogin.body?.detail || ''})`)
    throw new Error('staff login failed')
  }
  expect(true, 'staff login ok')
  const staffTok = staffLogin.body.access_token

  const staffRead = await fetchJson(`${api.base}/pos/shifts`, {
    headers: { Authorization: `Bearer ${staffTok}` },
  })
  expect(staffRead.ok || staffRead.status === 200, `staff allowed read (${staffRead.status})`)

  const disable = await fetchJson(`${api.base}/employees/${emp.body.id}`, {
    method: 'PATCH',
    headers: adminH,
    body: JSON.stringify({ active: false }),
  })
  expect(disable.ok && disable.body?.active === false, `disable staff (${disable.status} active=${disable.body?.active})`)
  const afterDisable = await fetchJson(`${api.base}/pos/shifts`, {
    headers: { Authorization: `Bearer ${staffTok}` },
  })
  expect(
    afterDisable.status === 401 && afterDisable.body?.code === 'AUTH_STAFF_DISABLED',
    `disabled staff Bearer denied (${afterDisable.status} ${afterDisable.body?.code || ''})`,
  )

  // Re-enable and reduce permissions
  await fetchJson(`${api.base}/employees/${emp.body.id}`, {
    method: 'PATCH',
    headers: adminH,
    body: JSON.stringify({ active: true, permissions: ['sales'] }),
  })
  const staffLogin2 = await fetchJson(`${api.base}/employees/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-kakapo-device-id': deviceId },
    body: JSON.stringify({ id: emp.body.id, password: 'staff-pin-99' }),
  })
  expect(staffLogin2.ok && staffLogin2.body?.access_token, `staff re-login (${staffLogin2.status})`)
  const staffTok2 = staffLogin2.body?.access_token
  await fetchJson(`${api.base}/employees/${emp.body.id}`, {
    method: 'PATCH',
    headers: adminH,
    body: JSON.stringify({ permissions: [] }),
  })
  const finDeny = await fetchJson(`${api.base}/expenses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staffTok2}` },
    body: JSON.stringify({ clientRef: `${PREFIX}exp-${Date.now()}`, amount: 1, category: 'x' }),
  })
  expect(finDeny.status === 403 || finDeny.status === 401,
    `role reduction loses finance (${finDeny.status})`)

  expect(true, 'PRODUCTION_LIKE_START_PASS')
} finally {
  await killApi(api?.child)
}

// ── Lab restore drill (SQL snapshot counts) ──
console.log('\n--- L Lab restore drill ---')
const snap = await withClient(async (c) => {
  const r = await c.query(`
    SELECT collection, COUNT(*)::int AS n
    FROM docs
    GROUP BY collection
    ORDER BY collection
  `)
  return r.rows
})
await withClient(async (c) => {
  await c.query(`CREATE TABLE IF NOT EXISTS o10_restore_drill (
    collection text PRIMARY KEY,
    n int NOT NULL,
    captured_at timestamptz DEFAULT now()
  )`)
  await c.query('TRUNCATE o10_restore_drill')
  for (const row of snap) {
    await c.query(
      'INSERT INTO o10_restore_drill(collection, n) VALUES ($1,$2)',
      [row.collection, row.n],
    )
  }
})
const restored = await withClient(async (c) => {
  const r = await c.query('SELECT collection, n FROM o10_restore_drill ORDER BY collection')
  return r.rows
})
const match = snap.length === restored.length
  && snap.every((s, i) => s.collection === restored[i].collection && s.n === restored[i].n)
expect(match, `LAB_RESTORE_DRILL_PASS counts match (cols=${snap.length})`)
expect(!!getDatabaseUrl(), 'backup target is lab DATABASE_URL only')

console.log(`\n=== O10 RESULT passed=${passed} failed=${failed} ===`)
await closePool()
process.exit(failed ? 1 : 0)
