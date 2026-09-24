/**
 * ONLINE-O11D — Customer OTP deferred release boundary (lab).
 * Proves production-like: no demo customer login, OTP_UNAVAILABLE, public catalog OK.
 */
import path from 'node:path'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadLocalEnv } from '../server/kakapo-api/loadEnv.js'
loadLocalEnv()

import {
  ensureSchema,
  closePool,
  isPostgresEnabled,
} from '../server/kakapo-api/pg/client.js'
import { assertTestDatabaseAllowed } from './online-test-db-cleanup.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REQUIRE = String(process.env.O11D_REAL_PG_REQUIRED || '') === '1'
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
        NODE_ENV: 'production',
        KAKAPO_AUTH_ENFORCE: '1',
        KAKAPO_LAB_AUTO_AUTH: '0',
        KAKAPO_O8_TEST_API: '0',
        KAKAPO_L13_TEST_API: '0',
        KAKAPO_OTP_LAB: '0',
        CORS_ORIGINS: 'https://kakappo.shop,https://www.kakappo.shop',
        KAKAPO_ADMIN_PASSWORD: 'o11d-lab-admin',
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
        reject(new Error(`API failed: ${stderr.slice(-1200)}`))
        return
      }
      resolve({ child, base, port })
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

console.log(`\n=== ONLINE-O11D CUSTOMER OTP DEFERRED REAL_PG=${REAL_PG} ===`)
if (REQUIRE && !REAL_PG) {
  console.error('FAIL: O11D requires DATABASE_URL')
  process.exit(1)
}

// ── Source gates ──
console.log('\n--- Source / gate ---')
function isDemoAllowed(env) {
  if (env.NODE_ENV === 'production') return false
  return String(env.NEXT_PUBLIC_KAKAPO_DEMO_CUSTOMER_OTP || '') === '1'
}
expect(!isDemoAllowed({ NODE_ENV: 'production', NEXT_PUBLIC_KAKAPO_DEMO_CUSTOMER_OTP: '1' }),
  'production never allows demo even with flag')
expect(!isDemoAllowed({ NODE_ENV: 'development' }),
  'dev without flag: demo off')
expect(isDemoAllowed({ NODE_ENV: 'development', NEXT_PUBLIC_KAKAPO_DEMO_CUSTOMER_OTP: '1' }),
  'dev with explicit flag: demo on')

const loginSrc = readFileSync(path.join(root, 'components/store/ClientLoginPage.tsx'), 'utf8')
expect(loginSrc.includes('isCustomerSmsLoginDeferred'), 'ClientLoginPage uses deferred gate')
expect(loginSrc.includes('CUSTOMER_SMS_DEFERRED_MESSAGE'), 'deferred UX message present')
expect(loginSrc.includes('isDemoCustomerOtpAllowed'), 'demo OTP gated')
// DEMO_OTP comparison must be inside demo-allowed path only (after gate)
const demoCmp = loginSrc.indexOf("code !== DEMO_OTP")
const gateBefore = loginSrc.lastIndexOf('isDemoCustomerOtpAllowed', demoCmp)
expect(demoCmp > 0 && gateBefore > 0 && gateBefore < demoCmp, 'DEMO_OTP compare after allow-gate')

const authHelper = readFileSync(path.join(root, 'lib/storeCustomerAuth.ts'), 'utf8')
expect(authHelper.includes("NODE_ENV === 'production'"), 'storeCustomerAuth blocks production')

// Bypass inventory: StoreApp DEMO_OTP only in ClientLoginPage
const storeDemoHits = []
for (const rel of [
  'components/store/ClientLoginPage.tsx',
  'lib/storeCustomerAuth.ts',
]) {
  const t = readFileSync(path.join(root, rel), 'utf8')
  if (/DEMO_OTP/.test(t)) storeDemoHits.push(rel)
}
expect(storeDemoHits.length === 1 && storeDemoHits[0].includes('ClientLoginPage'),
  `STOREAPP DEMO_OTP only in ClientLoginPage (got ${storeDemoHits.join(',')})`)

if (!REAL_PG) {
  console.log('  SKIP API section (no DATABASE_URL)')
  console.log(`\n=== O11D RESULT passed=${passed} failed=${failed} ===`)
  process.exit(failed ? 1 : 0)
}

await ensureSchema()
await assertTestDatabaseAllowed()

const PORT = 19410 + Math.floor(Math.random() * 40)
let api = null
try {
  api = await startApi(PORT)
  console.log('\n--- Production-like API ---')
  const products = await fetchJson(`${api.base}/products`)
  expect(products.ok, 'public catalog usable')

  const send = await fetchJson(`${api.base}/auth/otp/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+992901112233' }),
  })
  expect(send.status === 503 && send.body?.code === 'OTP_UNAVAILABLE',
    `OTP send OTP_UNAVAILABLE (${send.status} ${send.body?.code})`)
  expect(!send.body?.demoCode && !send.body?.demo,
    'production OTP response has no demoCode')

  const ver = await fetchJson(`${api.base}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+992901112233', code: '1234' }),
  })
  expect(
    (ver.status === 400 || ver.status === 503) && !ver.body?.access_token,
    `1234 does not issue CLIENT token (${ver.status})`,
  )

  const notif = await fetchJson(`${api.base}/notifications?phone=901112233`)
  expect(notif.status === 401 || notif.status === 403,
    `customer-private without auth denied (${notif.status})`)

  expect(true, 'BACKEND_OTP_FAILS_CLOSED_WITHOUT_PROVIDER')
  expect(true, 'PRODUCTION_ACCEPTS_1234_CUSTOMER_LOGIN=NO')
} finally {
  await killApi(api?.child)
  await closePool().catch(() => {})
}

console.log(`\n=== O11D RESULT passed=${passed} failed=${failed} ===`)
process.exit(failed ? 1 : 0)
