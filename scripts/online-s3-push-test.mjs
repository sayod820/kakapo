/**
 * ШАГ 3 — push вместо опроса: сервер сам шлёт кассе (WS /ws/pos по ключу устройства)
 * изменения сотрудников и настроек лояльности; ping → pong для сторожа соединения (PG lab).
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
const PREFIX = 'S3PUSH-'
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

/** Постоянный сокет кассы: копит сообщения, ждёт нужное */
function wsListen(base, role, token) {
  return new Promise((resolve) => {
    const url = `${base.replace(/^http/, 'ws')}/ws/${role}`
    const inbox = []
    const waiters = []
    let ws
    try { ws = new WS(url, token ? ['kakapo', token] : ['kakapo']) } catch { return resolve(null) }
    const t = setTimeout(() => resolve(null), 5000)
    ws.on('message', (data) => {
      const text = String(data)
      inbox.push(text)
      for (const w of [...waiters]) {
        if (w.match(text)) {
          waiters.splice(waiters.indexOf(w), 1)
          w.resolve(text)
        }
      }
    })
    ws.on('open', () => {
      clearTimeout(t)
      resolve({
        ws,
        waitFor(match, ms = 3000) {
          const hit = inbox.find(match)
          if (hit) {
            inbox.splice(inbox.indexOf(hit), 1)
            return Promise.resolve(hit)
          }
          return new Promise((res) => {
            const w = { match, resolve: res }
            waiters.push(w)
            setTimeout(() => {
              const i = waiters.indexOf(w)
              if (i >= 0) { waiters.splice(i, 1); res(null) }
            }, ms)
          })
        },
        close() { try { ws.close() } catch { /* */ } },
      })
    })
    ws.on('error', () => { clearTimeout(t); resolve(null) })
  })
}

const posKind = (kind) => (text) => {
  try {
    const m = JSON.parse(text)
    return m?.event === 'pos_update' && m?.payload?.kind === kind
  } catch { return false }
}

console.log(`\n=== S3 PUSH REAL_PG=${REAL_PG} ===`)
if (!REAL_PG) {
  console.log('  SKIP (no DATABASE_URL)')
  process.exit(0)
}

await ensureSchema()
await cleanupOnlineTestPrefixes()

const PORT = 19200 + Math.floor(Math.random() * 80)
const api = await startApi(PORT)
let sock = null

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
  const pair = await fetchJson(`${api.base}/pos/points/${encodeURIComponent(posId)}/pair-code`, {
    method: 'POST', headers: adminH, body: '{}',
  })
  const deviceId = cref('dev')
  const bind = await fetchJson(`${api.base}/pos/devices/bind`, {
    method: 'POST', headers: JSON_H,
    body: JSON.stringify({ clientRef: cref('bind'), code: pair.body?.code, deviceId, deviceName: `${PREFIX}dev` }),
  })
  const key = bind.body?.deviceToken
  expect(bind.ok && key, `device bound with key (${bind.status})`)

  const emp = await fetchJson(`${api.base}/employees`, {
    method: 'POST', headers: adminH,
    body: JSON.stringify({ name: cref('Cash'), password: `p${Date.now().toString(36)}`, role: 'custom', permissions: ['sales'], clientRef: cref('emp') }),
  })
  const empId = emp.body?.id
  expect(emp.ok && empId, `employee created (${emp.status})`)
  const staffH = { ...JSON_H, ...bearer(key), 'x-kakapo-device-id': deviceId, 'x-kakapo-employee-id': empId }

  sock = await wsListen(api.base, 'pos', key)
  expect(!!sock, 'WS /ws/pos open with device key')

  console.log('\n--- A ping/pong ---')
  sock.ws.send('ping')
  expect(!!(await sock.waitFor((t) => t === 'pong')), 'server answers pong (client watchdog)')

  console.log('\n--- B employee change pushed ---')
  const revBefore = (await fetchJson(`${api.base}/sync/changes?scope=pos`, { headers: staffH })).body?.employeesAuthRev
  await fetchJson(`${api.base}/employees/${encodeURIComponent(empId)}`, {
    method: 'PATCH', headers: adminH, body: JSON.stringify({ name: cref('Renamed') }),
  })
  expect(!!(await sock.waitFor(posKind('employee'))), 'PATCH employee → pos_update kind=employee')
  const revAfter = (await fetchJson(`${api.base}/sync/changes?scope=pos`, { headers: staffH })).body?.employeesAuthRev
  expect(!!revBefore && !!revAfter && revBefore !== revAfter, 'employeesAuthRev changed → касса перекачает сотрудников')

  const emp2 = await fetchJson(`${api.base}/employees`, {
    method: 'POST', headers: adminH,
    body: JSON.stringify({ name: cref('Two'), password: `q${Date.now().toString(36)}`, role: 'custom', permissions: ['sales'], clientRef: cref('emp2') }),
  })
  expect(!!(await sock.waitFor(posKind('employee'))), 'POST employee → pos_update kind=employee')
  await fetchJson(`${api.base}/employees/${encodeURIComponent(emp2.body?.id)}`, { method: 'DELETE', headers: adminH })
  const del = await sock.waitFor(posKind('employee'))
  expect(!!del && JSON.parse(del).payload?.deleted === true, 'DELETE employee → pos_update kind=employee deleted')

  console.log('\n--- C loyalty settings pushed ---')
  const loy = await fetchJson(`${api.base}/settings/loyalty`, { method: 'PATCH', headers: adminH, body: '{}' })
  expect(loy.ok, `PATCH /settings/loyalty (${loy.status})`)
  expect(!!(await sock.waitFor(posKind('loyalty-settings'))), 'PATCH loyalty → pos_update kind=loyalty-settings')

  console.log('\n--- D anonymous WS gets no staff events ---')
  const anon = await wsListen(api.base, 'client', '')
  await fetchJson(`${api.base}/employees/${encodeURIComponent(empId)}`, {
    method: 'PATCH', headers: adminH, body: JSON.stringify({ name: cref('Again') }),
  })
  expect(!!(await sock.waitFor(posKind('employee'))), 'pos socket got employee event')
  expect(!(await anon?.waitFor(posKind('employee'), 800)), 'client/catalog socket did not')
  anon?.close()

  console.log('\n--- E failed cash advance reported to audit ---')
  const ceName = cref('Said')
  const ce = await fetchJson(`${api.base}/pos/client-errors`, {
    method: 'POST', headers: staffH,
    body: JSON.stringify({ kind: 'cash_advance', message: 'Мало наличных: в кассе 0.00', context: { clientName: ceName, amount: 204 } }),
  })
  expect(ce.ok, `POST /pos/client-errors with device key (${ce.status})`)
  const ceAnon = await fetchJson(`${api.base}/pos/client-errors`, {
    method: 'POST', headers: JSON_H, body: JSON.stringify({ kind: 'x', message: 'x' }),
  })
  expect(ceAnon.status === 401 || ceAnon.status === 403, `anonymous rejected (${ceAnon.status})`)
  const audit = await fetchJson(`${api.base}/audit?action=client_error&days=1`, { headers: adminH })
  const rows = Array.isArray(audit.body) ? audit.body : (audit.body?.items || audit.body?.rows || [])
  expect(rows.some(r => r.entityName === ceName && /Мало наличных/.test(r.summary || '')), `audit has client_error row (${audit.status}, ${rows.length})`)

  console.log(`\n=== S3 RESULT passed=${passed} failed=${failed} ===`)
} catch (e) {
  failed += 1
  console.error('  FAIL crash', e?.stack || e)
} finally {
  sock?.close()
  await killApi(api?.child)
  await closePool().catch(() => {})
}

process.exit(failed > 0 ? 1 : 0)
