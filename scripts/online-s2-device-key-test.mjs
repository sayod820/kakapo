/**
 * ШАГ 2 — постоянный ключ кассы (DEVICE Bearer) + сотрудник из заголовка (PG lab).
 *
 * STRICT (без KAKAPO_LAB_AUTO_AUTH), KAKAPO_LEGACY_POS_WRITE=1 — старые кассы тоже должны работать.
 */
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { loadLocalEnv } from '../server/kakapo-api/loadEnv.js'
loadLocalEnv()

import { ensureSchema, closePool, isPostgresEnabled } from '../server/kakapo-api/pg/client.js'
import { cleanupOnlineTestPrefixes, bootstrapTestLabCashVault } from './online-test-db-cleanup.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WS = createRequire(path.join(root, 'server/kakapo-api/index.js'))('ws')
const PREFIX = 'S2DEV-'
const ROTATE_GRACE_MS = 2500
const REAL_PG = isPostgresEnabled()

let passed = 0
let failed = 0

function expect(cond, msg) {
  if (cond) { passed += 1; console.log(`  OK  ${msg}`) }
  else { failed += 1; console.error(`  FAIL ${msg}`) }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

function startApi(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['index.js'], {
      cwd: path.join(root, 'server/kakapo-api'),
      env: {
        ...process.env,
        PORT: String(port),
        KAKAPO_O8_TEST_API: '1',
        KAKAPO_LAB_AUTO_AUTH: '0',
        KAKAPO_AUTH_ENFORCE: '1',
        KAKAPO_LEGACY_POS_WRITE: '1',
        KAKAPO_OTP_LAB: '1',
        KAKAPO_DEVICE_KEY_ROTATE_GRACE_MS: String(ROTATE_GRACE_MS),
        NODE_ENV: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr?.on('data', (d) => { stderr += String(d) })
    const base = `http://127.0.0.1:${port}`
    waitHealth(base).then((up) => {
      if (!up) {
        try { child.kill('SIGKILL') } catch { /* */ }
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
    try { child.kill('SIGKILL') } catch { /* */ }
    setTimeout(resolve, 3000)
  })
}

const cref = (tag) => `${PREFIX}${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
const bearer = (t) => (t ? { Authorization: `Bearer ${t}` } : {})
const JSON_H = { 'Content-Type': 'application/json' }

function wsOpen(base, role, token) {
  return new Promise((resolve) => {
    const url = `${base.replace(/^http/, 'ws')}/ws/${role}`
    let done = false
    const finish = (v, ws) => {
      if (done) return
      done = true
      try { ws?.close() } catch { /* */ }
      resolve(v)
    }
    let ws
    try { ws = new WS(url, token ? ['kakapo', token] : ['kakapo']) } catch (e) {
      console.error('  ws ctor', e?.message || e)
      return resolve(false)
    }
    const t = setTimeout(() => finish(false, ws), 5000)
    ws.on('open', () => {
      setTimeout(() => { clearTimeout(t); finish(ws.readyState === 1, ws) }, 700)
    })
    ws.on('close', () => { clearTimeout(t); finish(false, ws) })
    ws.on('error', () => { clearTimeout(t); finish(false, ws) })
  })
}

console.log(`\n=== S2 DEVICE KEY REAL_PG=${REAL_PG} ===`)
if (!REAL_PG) {
  console.log('  SKIP (no DATABASE_URL)')
  process.exit(0)
}

await ensureSchema()
await cleanupOnlineTestPrefixes()

const PORT = 19100 + Math.floor(Math.random() * 80)
let api = await startApi(PORT)

try {
  await bootstrapTestLabCashVault()
  const adminLogin = await fetchJson(`${api.base}/auth/login`, {
    method: 'POST', headers: JSON_H, body: JSON.stringify({ login: 'admin', password: 'admin123' }),
  })
  expect(adminLogin.ok && adminLogin.body?.access_token, 'admin login')
  const adminH = { ...JSON_H, ...bearer(adminLogin.body?.access_token) }

  const pos = await fetchJson(`${api.base}/pos/points`, {
    method: 'POST', headers: adminH, body: JSON.stringify({ name: `${PREFIX}POS`, clientRef: cref('pos') }),
  })
  const posId = pos.body?.id
  expect(!!posId, 'pos created')

  async function bindDevice(tag) {
    const pair = await fetchJson(`${api.base}/pos/points/${encodeURIComponent(posId)}/pair-code`, {
      method: 'POST', headers: adminH, body: '{}',
    })
    const deviceId = `${PREFIX}${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const r = await fetchJson(`${api.base}/pos/devices/bind`, {
      method: 'POST', headers: JSON_H,
      body: JSON.stringify({ clientRef: cref(tag), code: pair.body?.code, deviceId, deviceName: `${PREFIX}${tag}` }),
    })
    return { deviceId, res: r }
  }

  // ── A bind выдаёт ключ ──
  console.log('\n--- A bind ---')
  const devA = await bindDevice('A')
  expect(devA.res.ok, `bind ok (${devA.res.status} ${devA.res.body?.detail || ''})`)
  const keyA = devA.res.body?.deviceToken
  expect(typeof keyA === 'string' && keyA.length > 20, 'bind returns deviceToken')

  const empPass = `p${Date.now().toString(36)}`
  const emp = await fetchJson(`${api.base}/employees`, {
    method: 'POST', headers: adminH,
    body: JSON.stringify({ name: cref('Cash'), password: empPass, role: 'custom', permissions: ['sales'], clientRef: cref('emp') }),
  })
  expect(emp.ok && emp.body?.id, `employee created (${emp.status})`)
  const empId = emp.body?.id

  // ── B вход сотрудника выдаёт новый ключ, старый отзывается ──
  console.log('\n--- B login ---')
  const login = await fetchJson(`${api.base}/employees/login`, {
    method: 'POST', headers: { ...JSON_H, 'x-kakapo-device-id': devA.deviceId },
    body: JSON.stringify({ id: empId, password: empPass }),
  })
  expect(login.ok && login.body?.token, `employee login (${login.status})`)
  const keyB = login.body?.deviceToken
  expect(typeof keyB === 'string' && keyB && keyB !== keyA, 'login returns fresh deviceToken')
  expect(await wsOpen(api.base, 'pos', keyB), 'WS accepts fresh key')
  expect(await wsOpen(api.base, 'pos', keyA), 'old key still accepted during rotation grace (in-flight requests)')
  const inFlight = await fetchJson(`${api.base}/pos/sales`, {
    headers: { ...JSON_H, ...bearer(keyA), 'x-kakapo-device-id': devA.deviceId, 'x-kakapo-employee-id': empId },
  })
  expect(inFlight.ok, `old key + employee works during grace, no legacy fallback needed (${inFlight.status})`)
  await new Promise(r => setTimeout(r, ROTATE_GRACE_MS + 700))
  expect(!(await wsOpen(api.base, 'pos', keyA)), 'old key expires after rotation grace (WS rejects)')
  expect(await wsOpen(api.base, 'pos', keyB), 'fresh key unaffected by grace expiry')

  const staffH = (key, extra = {}) => ({
    ...JSON_H, ...bearer(key), 'x-kakapo-device-id': devA.deviceId, 'x-kakapo-employee-id': empId, ...extra,
  })

  // ── C ключ + активный сотрудник → права сотрудника ──
  console.log('\n--- C device key + employee ---')
  const readSales = await fetchJson(`${api.base}/pos/sales`, { headers: staffH(keyB) })
  expect(readSales.ok, `GET /pos/sales with key+employee (${readSales.status} ${readSales.body?.code || ''})`)
  const onlyKey = await fetchJson(`${api.base}/pos/sales`, { headers: { ...bearer(keyB), 'x-kakapo-device-id': devA.deviceId } })
  expect(onlyKey.status === 401 || onlyKey.status === 403, `key without employee cannot read staff data (${onlyKey.status})`)
  const hb = await fetchJson(`${api.base}/pos/devices/heartbeat`, {
    method: 'POST', headers: staffH(keyB), body: JSON.stringify({ deviceId: devA.deviceId }),
  })
  expect(hb.status !== 401 && hb.status !== 403, `heartbeat auth passes with key+employee (${hb.status} ${hb.body?.code || ''})`)
  const noCap = await fetchJson(`${api.base}/finance/moves`, {
    method: 'POST', headers: staffH(keyB), body: JSON.stringify({ clientRef: cref('fin'), amount: 1 }),
  })
  expect(noCap.status === 403, `employee caps still enforced (finance ${noCap.status})`)

  const devB = await bindDevice('B')
  const mismatch = await fetchJson(`${api.base}/pos/sales`, {
    headers: staffH(keyB, { 'x-kakapo-device-id': devB.deviceId }),
  })
  expect(mismatch.status === 403 && mismatch.body?.code === 'AUTH_DEVICE_MISMATCH', `key of other device rejected (${mismatch.status} ${mismatch.body?.code})`)

  // ── D выход не отзывает ключ кассы ──
  console.log('\n--- D logout ---')
  await fetchJson(`${api.base}/auth/logout`, { method: 'POST', headers: { ...JSON_H, ...bearer(keyB) }, body: '{}' })
  const afterLogout = await fetchJson(`${api.base}/pos/sales`, { headers: staffH(keyB) })
  expect(afterLogout.ok, `device key survives /auth/logout (${afterLogout.status})`)

  // ── E WS принимает ключ ──
  console.log('\n--- E WS ---')
  expect(await wsOpen(api.base, 'pos', keyB), 'WS /ws/pos accepts device key')

  // ── F заблокированный сотрудник ──
  console.log('\n--- F blocked employee ---')
  await fetchJson(`${api.base}/employees/${encodeURIComponent(empId)}`, {
    method: 'PATCH', headers: adminH, body: JSON.stringify({ active: false }),
  })
  const blocked = await fetchJson(`${api.base}/pos/sales`, { headers: staffH(keyB) })
  expect(blocked.status === 401 && blocked.body?.code === 'AUTH_STAFF_DISABLED', `blocked employee denied (${blocked.status} ${blocked.body?.code})`)
  expect(await wsOpen(api.base, 'pos', keyB), 'device key not revoked by blocked employee (WS ok)')
  await fetchJson(`${api.base}/employees/${encodeURIComponent(empId)}`, {
    method: 'PATCH', headers: adminH, body: JSON.stringify({ active: true }),
  })
  const unblocked = await fetchJson(`${api.base}/pos/sales`, { headers: staffH(keyB) })
  expect(unblocked.ok, `same key works after unblock (${unblocked.status})`)

  // ── G legacy (без ключа) всё ещё работает ──
  console.log('\n--- G legacy ---')
  const legacy = await fetchJson(`${api.base}/pos/sales`, {
    headers: { 'x-kakapo-device-id': devA.deviceId, 'x-kakapo-employee-id': empId },
  })
  expect(legacy.ok, `legacy headers still work (${legacy.status} ${legacy.body?.code || ''})`)

  // ── G2 касса без ключа (обновилась без входа) берёт ключ сама ──
  console.log('\n--- G2 key without login ---')
  const legacyH = { ...JSON_H, 'x-kakapo-device-id': devA.deviceId, 'x-kakapo-employee-id': empId }
  const selfKey = await fetchJson(`${api.base}/pos/devices/key`, {
    method: 'POST', headers: legacyH, body: JSON.stringify({ deviceId: devA.deviceId }),
  })
  const keyG = selfKey.body?.deviceToken
  expect(selfKey.ok && typeof keyG === 'string' && keyG.length > 20, `legacy kassa gets device key (${selfKey.status} ${selfKey.body?.code || ''})`)
  expect(await wsOpen(api.base, 'pos', keyG), 'WS accepts self-issued key')
  await sleep(ROTATE_GRACE_MS + 700)
  expect(!(await wsOpen(api.base, 'pos', keyB)), 'previous key rotated out after grace')
  const withKey = await fetchJson(`${api.base}/pos/devices/key`, {
    method: 'POST', headers: staffH(keyG), body: JSON.stringify({ deviceId: devA.deviceId }),
  })
  expect(withKey.ok && !withKey.body?.deviceToken, 'kassa with key gets no new key (no rotation loop)')

  const sessLive = await fetchJson(`${api.base}/auth/session`, { headers: { Authorization: `Bearer ${keyG}` } })
  expect(sessLive.ok && sessLive.body?.active === true && sessLive.body?.principal === 'DEVICE', `/auth/session reports live key (${sessLive.status})`)
  const sessDead = await fetchJson(`${api.base}/auth/session`, { headers: { Authorization: `Bearer ${keyB}` } })
  expect(sessDead.ok && sessDead.body?.active === false, `/auth/session reports rotated key as dead (${sessDead.status})`)
  const sessNone = await fetchJson(`${api.base}/auth/session`)
  expect(sessNone.ok && sessNone.body?.active === false, `/auth/session without bearer is inactive (${sessNone.status})`)
  const otherDev = await fetchJson(`${api.base}/pos/devices/key`, {
    method: 'POST', headers: legacyH, body: JSON.stringify({ deviceId: devB.deviceId }),
  })
  expect(otherDev.status === 403 && !otherDev.body?.deviceToken, `cannot mint key for another device (${otherDev.status})`)
  const anon = await fetchJson(`${api.base}/pos/devices/key`, {
    method: 'POST', headers: JSON_H, body: JSON.stringify({ deviceId: devA.deviceId }),
  })
  expect((anon.status === 401 || anon.status === 403) && !anon.body?.deviceToken, `no key without device+employee (${anon.status})`)
  const ghost = await fetchJson(`${api.base}/pos/devices/key`, {
    method: 'POST', headers: { ...JSON_H, 'x-kakapo-device-id': `${PREFIX}ghost`, 'x-kakapo-employee-id': empId },
    body: JSON.stringify({ deviceId: `${PREFIX}ghost` }),
  })
  expect(ghost.status === 403 && !ghost.body?.deviceToken, `unbound device gets no key (${ghost.status})`)
  const keyAfterG = keyG

  // ── G3 смена пароля в админке — сразу в PG одной строкой, без полной записи базы ──
  console.log('\n--- G3 admin password change ---')
  const pgHash = async () => {
    if (!REAL_PG) return null
    const { withClient } = await import('../server/kakapo-api/pg/client.js')
    return withClient(async (c) => {
      const r = await c.query("SELECT data->>'passwordHash' AS h, data ? '_txCommittedAt' AS stamped FROM docs WHERE collection='employees' AND id=$1", [empId])
      return r.rows[0] || null
    })
  }
  const h0 = await pgHash()
  const t0 = Date.now()
  const pw = await fetchJson(`${api.base}/employees/${encodeURIComponent(empId)}`, {
    method: 'PATCH', headers: adminH, body: JSON.stringify({ password: 'S2-new-pass-5678' }),
  })
  const pwMs = Date.now() - t0
  expect(pw.ok, `admin password change ok (${pw.status})`)
  expect(pwMs < 3000, `admin password change answers fast (${pwMs}ms)`)
  const h1 = await pgHash()
  if (REAL_PG) {
    expect(h1?.h && h1.h !== h0?.h, 'new password hash is in PG right after the answer')
    expect(h1 && h1.stamped === false, 'employee row has no stale tx stamp')
  }

  // ── H перезапуск API — ключ живёт (сессии в PG) ──
  console.log('\n--- H restart ---')
  await killApi(api.child)
  api = await startApi(PORT + 1)
  if (REAL_PG) {
    const h2 = await pgHash()
    expect(h2?.h === h1?.h, 'new password hash survives API restart')
  }
  const afterRestart = await fetchJson(`${api.base}/pos/sales`, { headers: staffH(keyAfterG) })
  expect(afterRestart.ok, `device key survives API restart (${afterRestart.status})`)

  // ── I отвязка отзывает ключ ──
  console.log('\n--- I unbind ---')
  const adminLogin2 = await fetchJson(`${api.base}/auth/login`, {
    method: 'POST', headers: JSON_H, body: JSON.stringify({ login: 'admin', password: 'admin123' }),
  })
  const adminH2 = { ...JSON_H, ...bearer(adminLogin2.body?.access_token) }
  const unbind = await fetchJson(
    `${api.base}/pos/points/${encodeURIComponent(posId)}/devices/${encodeURIComponent(devA.deviceId)}`,
    { method: 'DELETE', headers: adminH2 },
  )
  expect(unbind.ok, `unbind (${unbind.status})`)
  const afterUnbind = await fetchJson(`${api.base}/pos/sales`, { headers: staffH(keyAfterG) })
  expect(afterUnbind.status === 401 || afterUnbind.status === 403, `unbound device key denied (${afterUnbind.status} ${afterUnbind.body?.code || ''})`)
  expect(!(await wsOpen(api.base, 'pos', keyAfterG)), 'WS rejects revoked device key')
  const afterUnbindKey = await fetchJson(`${api.base}/pos/devices/key`, {
    method: 'POST', headers: legacyH, body: JSON.stringify({ deviceId: devA.deviceId }),
  })
  expect(!afterUnbindKey.body?.deviceToken, `unbound kassa cannot get key back (${afterUnbindKey.status})`)

  console.log(`\n=== S2 RESULT passed=${passed} failed=${failed} ===`)
} catch (e) {
  failed += 1
  console.error('  FAIL crash', e?.stack || e)
} finally {
  await killApi(api?.child)
  await closePool().catch(() => {})
}

process.exit(failed > 0 ? 1 : 0)
