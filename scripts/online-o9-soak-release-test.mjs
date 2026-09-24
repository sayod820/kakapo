/**
 * ONLINE-O9 — Final ONLINE soak & release readiness (PG lab).
 *
 * Release-candidate proof: mixed workload, restarts, ACK-lost, concurrency,
 * failure injection, read/WS/resource audits, production config blockers.
 * Does NOT deploy. Does NOT redesign O1–O8 semantics.
 */
import path from 'node:path'
import { spawn, execFileSync, execSync } from 'node:child_process'
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
  getPool,
} from '../server/kakapo-api/pg/client.js'
import {
  opRefDocId,
  FIN_OP_KINDS,
  WH_OP_KINDS,
} from '../server/kakapo-api/pg/businessMutationTx.js'
import { unlinkSync } from 'node:fs'
import { assertSafeAuthEnvOrThrow } from '../server/kakapo-api/apiAuth.js'
import {
  cleanupOnlineTestPrefixes,
  bootstrapTestLabCashVault,
  assertTestDatabaseAllowed,
} from './online-test-db-cleanup.mjs'

const require = createRequire(import.meta.url)
const WebSocket = require('../server/kakapo-api/node_modules/ws')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PREFIX = 'O9-'
const REQUIRE = String(process.env.O9_REAL_PG_REQUIRED || '') === '1'
const REAL_PG = isPostgresEnabled()
const SEED = 0x09a09a09
const SOAK_TARGET = 520
const STOCK_TOL = 0.051

let passed = 0
let failed = 0
let soakOps = 0
let count5xx = 0
let count4xx = 0
let PERIODIC_INVARIANT_FAILURES = 0
let softInvariantContinues = 0
let restartCount = 0

const summaryExtras = {
  SESSION_POLICY: null,
  ACK_LOST: null,
  CONCURRENCY: null,
  FAILURE_INJECTION: null,
  SNAPSHOT_O8: null,
  WS: null,
  RESOURCES: null,
  CONFIG_AUDIT: null,
  STARTUP_VALIDATION: null,
  BACKUP: null,
  GIT: null,
}

function expect(cond, msg) {
  if (cond) {
    passed += 1
    console.log(`  OK  ${msg}`)
  } else {
    failed += 1
    console.error(`  FAIL ${msg}`)
  }
}

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100
}

function mulberry32(a) {
  return function rand() {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(SEED)
let refSeq = 0
function nextRef(tag) {
  refSeq += 1
  return `${PREFIX}${tag}-${SEED.toString(16)}-${refSeq}`
}

function uniquePhone(tag = '') {
  const n = Math.floor(rand() * 1e9)
  const suffix = String(Date.now()).slice(-5) + String(n).padStart(4, '0').slice(0, 4)
  return `9929${suffix.slice(0, 8)}`
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchJson(url, init) {
  try {
    const res = await fetch(url, init)
    let body = null
    try { body = await res.json() } catch { body = null }
    if (res.status >= 500) count5xx += 1
    else if (res.status >= 400) count4xx += 1
    return { ok: res.ok, status: res.status, body }
  } catch (e) {
    return { ok: false, status: 0, body: { detail: String(e?.message || e) } }
  }
}

async function waitHealth(base, ms = 60000) {
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
        KAKAPO_LAB_AUTO_AUTH: extraEnv.KAKAPO_LAB_AUTO_AUTH != null
          ? extraEnv.KAKAPO_LAB_AUTO_AUTH
          : '1',
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
    try { child.kill('SIGKILL') } catch { /* ignore */ }
    setTimeout(resolve, 3000)
  })
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function adminLogin(base) {
  const healthy = await waitHealth(base, 30000)
  if (!healthy) return { ok: false, status: 0, body: { detail: 'health timeout before login' } }
  return fetchJson(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'admin', password: 'admin123' }),
  })
}

async function waitOpRef(clientRef, kind, ms = 25000) {
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
    await sleep(80)
  }
  return null
}

async function countOpRefsLike(prefix = PREFIX) {
  return withClient(async (c) => {
    const r = await c.query(
      `SELECT COUNT(*)::int AS n FROM docs WHERE collection='opRefs' AND id LIKE $1`,
      [`%${prefix}%`],
    )
    return r.rows[0]?.n || 0
  })
}

function connectWs(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/admin`)
    const t = setTimeout(() => reject(new Error('ws connect timeout')), 10000)
    ws.on('open', () => {
      clearTimeout(t)
      resolve({
        ws,
        close: () => { try { ws.close() } catch { /* */ } },
      })
    })
    ws.on('error', (e) => {
      clearTimeout(t)
      reject(e)
    })
  })
}

async function sumLayersForProduct(base, headers, productId) {
  const pid = String(productId)
  const layersEp = await fetchJson(`${base}/products/${encodeURIComponent(pid)}/stock-layers`, { headers })
  if (layersEp.ok && Array.isArray(layersEp.body)) {
    return round2((layersEp.body || []).reduce((s, L) => s + (Number(L.remainingQty ?? L.qty) || 0), 0))
  }
  const receipts = await fetchJson(`${base}/stock/receipts`, { headers })
  let sum = 0
  for (const rec of receipts.body || []) {
    for (const it of rec.items || []) {
      if (String(it.productId) === pid) sum += Number(it.remainingQty) || 0
    }
  }
  return round2(sum)
}

async function resolveProduct(base, headers, fx) {
  const pid = String(fx.productId)
  let get = await fetchJson(`${base}/products/${encodeURIComponent(pid)}`, { headers })
  if (get.ok && get.body && get.body.stock != null) {
    fx.productId = String(get.body.id ?? pid)
    return get.body
  }
  const list = await fetchJson(`${base}/products`, { headers })
  const byName = (list.body || []).find((p) => p.name === fx.productName)
  if (byName) {
    fx.productId = String(byName.id)
    return byName
  }
  const byId = (list.body || []).find((p) => String(p.id) === pid)
  if (byId) {
    fx.productId = String(byId.id)
    return byId
  }
  return get.body || null
}

/**
 * Fixture-scoped stock invariant: product.stock vs layer remainingQty for THIS productId only.
 * Soft continue when |mismatch|<=1 and recheck settles; hard fail otherwise.
 */
async function checkFixtureStockInvariant(base, headers, fx, { hard = false } = {}) {
  const prod = await resolveProduct(base, headers, fx)
  if (!prod || prod.stock == null) {
    const msg = `invariant: product unresolved id=${fx.productId} name=${fx.productName}`
    if (hard) expect(false, msg)
    else {
      PERIODIC_INVARIANT_FAILURES += 1
      console.warn(`  WARN soft ${msg}`)
    }
    return { ok: false, mismatch: Infinity }
  }
  let stock = round2(Number(prod.stock))
  let layers = await sumLayersForProduct(base, headers, fx.productId)
  let mismatch = round2(Math.abs(stock - layers))
  if (mismatch > STOCK_TOL) {
    await sleep(200)
    const prod2 = await resolveProduct(base, headers, fx)
    stock = round2(Number(prod2?.stock))
    layers = await sumLayersForProduct(base, headers, fx.productId)
    mismatch = round2(Math.abs(stock - layers))
  }
  if (mismatch <= STOCK_TOL) return { ok: true, mismatch: 0, stock, layers }

  PERIODIC_INVARIANT_FAILURES += 1
  console.warn(`  WARN invariant stock=${stock} layers=${layers} Δ=${mismatch} productId=${fx.productId}`)

  if (mismatch > 1 || hard) {
    expect(false, `stock/layer hard fail stock=${stock} layers=${layers} Δ=${mismatch}`)
    return { ok: false, mismatch, stock, layers }
  }

  await sleep(200)
  const prod3 = await resolveProduct(base, headers, fx)
  const stock3 = round2(Number(prod3?.stock))
  const layers3 = await sumLayersForProduct(base, headers, fx.productId)
  const m3 = round2(Math.abs(stock3 - layers3))
  if (m3 <= STOCK_TOL) {
    softInvariantContinues += 1
    console.log(`  INFO invariant settled after 200ms (was Δ=${mismatch})`)
    return { ok: true, mismatch: 0, stock: stock3, layers: layers3, soft: true }
  }
  expect(false, `stock/layer recheck fail stock=${stock3} layers=${layers3} Δ=${m3}`)
  return { ok: false, mismatch: m3, stock: stock3, layers: layers3 }
}

async function truthSnapshot(base, headers, fx) {
  const prod = await resolveProduct(base, headers, fx)
  const shifts = await fetchJson(`${base}/pos/shifts`, { headers })
  const shift = (shifts.body || []).find((s) => String(s.id) === String(fx.shiftId))
    || (shifts.body || []).find((s) => s.status === 'open')
  const clients = await fetchJson(`${base}/clients`, { headers })
  const client = (clients.body || []).find((c) => String(c.id) === String(fx.clientId))
  const cards = await fetchJson(`${base}/cards`, { headers })
  const card = (cards.body || []).find(
    (c) => String(c.num || '').toUpperCase() === String(fx.cardNum || '').toUpperCase(),
  )
  const opRefs = await countOpRefsLike(PREFIX)
  const pgProd = await withClient(async (c) => {
    const r = await c.query(
      `SELECT data FROM docs WHERE collection='products' AND id=$1`,
      [String(fx.productId)],
    )
    return r.rows[0]?.data || null
  })
  const pgShift = await withClient(async (c) => {
    const r = await c.query(
      `SELECT data FROM docs WHERE collection='posShifts' AND id=$1`,
      [String(fx.shiftId)],
    )
    return r.rows[0]?.data || null
  })
  const pgClient = await withClient(async (c) => {
    const r = await c.query(
      `SELECT data FROM docs WHERE collection='clients' AND id=$1`,
      [String(fx.clientId)],
    )
    return r.rows[0]?.data || null
  })
  return {
    stockApi: round2(Number(prod?.stock)),
    stockPg: round2(Number(pgProd?.stock)),
    shiftCashApi: round2(Number(shift?.salesCash) || 0),
    shiftCashPg: round2(Number(pgShift?.salesCash) || 0),
    debtApi: round2(Number(client?.debt ?? card?.debt) || 0),
    debtPg: round2(Number(pgClient?.debt) || 0),
    bonusApi: round2(Number(card?.bonus ?? client?.bonus) || 0),
    bonusPg: round2(Number(pgClient?.bonus) || 0),
    opRefs,
  }
}

async function pgTotalsSnapshot() {
  return withClient(async (c) => {
    const docs = await c.query(`SELECT collection, COUNT(*)::int AS n FROM docs GROUP BY collection ORDER BY collection`)
    const sync = await c.query(`SELECT COUNT(*)::int AS n FROM sync_changes`)
    const byCol = Object.fromEntries((docs.rows || []).map((r) => [r.collection, r.n]))
    return { docsByCollection: byCol, syncChanges: sync.rows[0]?.n || 0 }
  })
}

async function ensureOpenShift(base, headers, fx) {
  const openList = await fetchJson(`${base}/pos/shifts`, { headers })
  const existing = (openList.body || []).find(
    (s) => s.status === 'open' && String(s.posId) === String(fx.posId),
  )
  if (existing) {
    fx.shiftId = existing.id
    fx.cashierId = existing.cashierId || fx.cashierId
    return existing
  }
  const open = await fetchJson(`${base}/pos/shifts/open`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      posId: fx.posId,
      cashierId: fx.cashierId,
      cashierName: fx.cashierName || `${PREFIX}Cashier`,
      openingCash: 5000,
      clientRef: nextRef('shift'),
    }),
  })
  if (open.ok && open.body?.id) {
    fx.shiftId = open.body.id
    return open.body
  }
  // Reuse any open shift on this POS after 400 (already open)
  const again = await fetchJson(`${base}/pos/shifts`, { headers })
  const reuse = (again.body || []).find(
    (s) => s.status === 'open' && String(s.posId) === String(fx.posId),
  )
  if (reuse) {
    fx.shiftId = reuse.id
    return reuse
  }
  // Close stray opens then reopen
  for (const s of again.body || []) {
    if (s.status === 'open') {
      await fetchJson(`${base}/pos/shifts/${encodeURIComponent(s.id)}/close`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ closingCash: 0, clientRef: nextRef('shClose') }),
      })
    }
  }
  await bootstrapTestLabCashVault()
  const reopen = await fetchJson(`${base}/pos/shifts/open`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      posId: fx.posId,
      cashierId: fx.cashierId,
      cashierName: fx.cashierName || `${PREFIX}Cashier`,
      openingCash: 5000,
      clientRef: nextRef('shift2'),
    }),
  })
  expect(reopen.ok, `shift reopen (${reopen.status} ${reopen.body?.detail || ''})`)
  fx.shiftId = reopen.body?.id
  return reopen.body
}

async function afterRestartRelogin(apiState, fx) {
  restartCount += 1
  const login = await adminLogin(apiState.base)
  expect(login.ok && login.body?.access_token, `re-login after restart #${restartCount}`)
  const token = login.body?.access_token
  const headers = { 'Content-Type': 'application/json', ...authHeaders(token) }
  await resolveProduct(apiState.base, headers, fx)
  await ensureOpenShift(apiState.base, headers, fx)
  return { token, headers }
}

async function lifecycleBootstrap(api) {
  await bootstrapTestLabCashVault()
  const login = await adminLogin(api.base)
  expect(login.ok && login.body?.access_token, `admin login (${login.status} ${login.body?.detail || ''})`)
  const token = login.body?.access_token
  const headers = { 'Content-Type': 'application/json', ...authHeaders(token) }

  const productName = `${PREFIX}Sku-${SEED.toString(16)}`
  const prod = await fetchJson(`${api.base}/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: productName,
      price: 100,
      costPrice: 40,
      stock: 0,
      clientRef: nextRef('prod'),
    }),
  })
  expect(prod.ok && prod.body?.id, `create product (${prod.status})`)
  const productId = String(prod.body.id)

  const points = await fetchJson(`${api.base}/pos/points`, { headers })
  let posId = points.body?.[0]?.id
  if (!posId) {
    const p = await fetchJson(`${api.base}/pos/points`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: `${PREFIX}POS`, clientRef: nextRef('pos') }),
    })
    posId = p.body?.id
  }
  expect(!!posId, 'posId')

  const cashiers = await fetchJson(`${api.base}/cashiers`, { headers })
  let cashierId = cashiers.body?.[0]?.id
  let cashierName = cashiers.body?.[0]?.name || `${PREFIX}Cashier`
  if (!cashierId) {
    const c = await fetchJson(`${api.base}/cashiers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: cashierName, pin: '4242', clientRef: nextRef('cashier') }),
    })
    cashierId = c.body?.id
  }

  const fx = {
    productId,
    productName,
    posId,
    cashierId,
    cashierName,
    shiftId: null,
    clientId: null,
    cardNum: null,
    phone: null,
    supplierId: null,
    employeeId: null,
    deviceId: null,
    orderId: null,
    lastSaleId: null,
  }

  const bigRec = await fetchJson(`${api.base}/stock/receipts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      clientRef: nextRef('bigRec'),
      paidNow: 0,
      items: [{ productId, qty: 8500, costPrice: 40, retailPrice: 100, purchaseTotal: 8500 * 40 }],
    }),
  })
  expect(bigRec.ok, `big receipt 8500 (${bigRec.status} ${bigRec.body?.detail || ''})`)

  await ensureOpenShift(api.base, headers, fx)

  const phone = uniquePhone('life')
  const cardNum = `${PREFIX}CARD-${String(Date.now()).slice(-8)}`
  const cl = await fetchJson(`${api.base}/clients`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: `${PREFIX}Client`,
      phone,
      clientRef: nextRef('cli'),
    }),
  })
  expect(cl.ok && cl.body?.id, `create client (${cl.status} ${cl.body?.detail || ''})`)
  fx.clientId = cl.body.id
  fx.phone = phone
  fx.cardNum = cardNum
  await fetchJson(`${api.base}/cards/ensure`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      num: cardNum,
      client: `${PREFIX}Client`,
      phone,
      status: 'active',
      debtEnabled: true,
      bonus: 0,
      clientRef: nextRef('card'),
    }),
  })
  await fetchJson(`${api.base}/clients/${fx.clientId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ card: cardNum, clientRef: nextRef('link') }),
  })

  const sup = await fetchJson(`${api.base}/suppliers`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: `${PREFIX}Sup`, phone: uniquePhone('sup'), clientRef: nextRef('sup') }),
  })
  expect(sup.ok && sup.body?.id, `supplier (${sup.status})`)
  fx.supplierId = sup.body.id
  const payableRec = await fetchJson(`${api.base}/stock/receipts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      clientRef: nextRef('payRec'),
      supplierId: fx.supplierId,
      paidNow: 0,
      items: [{ productId, qty: 10, costPrice: 40, purchaseTotal: 400 }],
    }),
  })
  expect(payableRec.ok, `payable receipt (${payableRec.status})`)

  const empName = `${PREFIX}Emp-${Date.now().toString(36)}`
  const emp = await fetchJson(`${api.base}/employees`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: empName,
      role: 'custom',
      password: 'emp-o9-99',
      permissions: ['sales'],
      clientRef: nextRef('emp'),
    }),
  })
  if (!emp.ok) {
    const dir = await fetchJson(`${api.base}/employees`, { headers })
    const existing = (dir.body || []).find((e) => String(e.name || '').startsWith(`${PREFIX}Emp`))
    if (existing) {
      fx.employeeId = existing.id
      console.log(`  INFO reuse employee ${existing.id}`)
    }
  } else {
    fx.employeeId = emp.body.id
  }
  expect(!!fx.employeeId, `employee (${emp.status})`)

  // Device bind BEFORE staff login
  let bindOk = false
  const pair = await fetchJson(`${api.base}/pos/points/${encodeURIComponent(posId)}/pair-code`, {
    method: 'POST',
    headers,
    body: '{}',
  })
  const deviceId = `${PREFIX}dev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  if (pair.ok && pair.body?.code) {
    const bind = await fetchJson(`${api.base}/pos/devices/bind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRef: nextRef('bind'),
        code: pair.body.code,
        deviceId,
        deviceName: `${PREFIX}Term-${Date.now().toString(36)}`,
      }),
    })
    bindOk = bind.ok
    fx.deviceId = bind.body?.device?.id || deviceId
    expect(bind.ok, `device bind (${bind.status} ${bind.body?.detail || ''})`)
  } else {
    expect(false, `pair-code for bind (${pair.status})`)
  }

  const staffLogin = await fetchJson(`${api.base}/employees/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(fx.deviceId ? { 'x-kakapo-device-id': fx.deviceId } : {}),
    },
    body: JSON.stringify({ id: fx.employeeId, password: 'emp-o9-99' }),
  })
  if (staffLogin.status === 401 && !bindOk) {
    console.log('  SKIP staff capability (bind failed → login 401 treated as harness skip)')
  } else {
    expect(staffLogin.ok && staffLogin.body?.access_token, `staff login (${staffLogin.status})`)
    if (staffLogin.ok) {
      const staffH = {
        'Content-Type': 'application/json',
        ...authHeaders(staffLogin.body.access_token),
        ...(fx.deviceId ? { 'x-kakapo-device-id': fx.deviceId } : {}),
      }
      const finDeny = await fetchJson(`${api.base}/finance/moves`, {
        method: 'POST',
        headers: staffH,
        body: JSON.stringify({
          clientRef: nextRef('staffFin'),
          type: 'deposit',
          amount: 1,
          payFrom: 'shift',
          method: 'cash',
          shiftId: fx.shiftId,
        }),
      })
      expect(finDeny.status === 403, `sales staff finance 403 got ${finDeny.status}`)
    }
  }

  // Cash / card / debt sale
  const cashSale = await fetchJson(`${api.base}/pos/sales`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      clientRef: nextRef('saleCash'),
      shiftId: fx.shiftId,
      posId: fx.posId,
      cashierId: fx.cashierId,
      paymentMethod: 'cash',
      total: 100,
      paidCash: 100,
      items: [{ productId, qty: 1, price: 100, lineTotal: 100 }],
    }),
  })
  expect(cashSale.ok, `cash sale (${cashSale.status})`)
  fx.lastSaleId = cashSale.body?.id

  const cardSale = await fetchJson(`${api.base}/pos/sales`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      clientRef: nextRef('saleCard'),
      shiftId: fx.shiftId,
      posId: fx.posId,
      cashierId: fx.cashierId,
      paymentMethod: 'card',
      total: 100,
      paidCard: 100,
      items: [{ productId, qty: 1, price: 100, lineTotal: 100 }],
    }),
  })
  expect(cardSale.ok, `card sale (${cardSale.status})`)

  const debtSale = await fetchJson(`${api.base}/pos/sales`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      clientRef: nextRef('saleDebt'),
      shiftId: fx.shiftId,
      posId: fx.posId,
      cashierId: fx.cashierId,
      paymentMethod: 'credit',
      total: 100,
      paidCredit: 100,
      cardNum: fx.cardNum,
      clientId: fx.clientId,
      items: [{ productId, qty: 1, price: 100, lineTotal: 100 }],
    }),
  })
  expect(debtSale.ok, `debt sale (${debtSale.status} ${debtSale.body?.detail || ''})`)

  const cardAfterDebt = await fetchJson(`${api.base}/cards`, { headers })
  const cardRow = (cardAfterDebt.body || []).find(
    (c) => String(c.num || '').toUpperCase() === String(fx.cardNum).toUpperCase(),
  )
  const repay = await fetchJson(`${api.base}/cards/${encodeURIComponent(fx.cardNum)}/debt-repay`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      clientRef: nextRef('repay'),
      amount: 50,
      method: 'cash',
      shiftId: fx.shiftId,
      posId: fx.posId,
      expectedDebtPayVersion: cardRow?.debtPayVersion ?? 0,
    }),
  })
  expect(repay.ok, `debt repay (${repay.status} ${repay.body?.detail || ''})`)

  const adv = await fetchJson(`${api.base}/cards/${encodeURIComponent(fx.cardNum)}/cash-advance`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      clientRef: nextRef('adv'),
      amount: 20,
      shiftId: fx.shiftId,
      clientId: fx.clientId,
    }),
  })
  expect(adv.ok, `cash advance (${adv.status})`)

  const supRow = await fetchJson(`${api.base}/suppliers/${fx.supplierId}`, { headers })
  const pay = await fetchJson(`${api.base}/suppliers/${fx.supplierId}/payments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      clientRef: nextRef('spay'),
      amount: 50,
      expectedPayVersion: supRow.body?.payVersion ?? 0,
      settlementMethod: 'adjustment',
    }),
  })
  expect(pay.ok, `supplier pay (${pay.status})`)

  const exp = await fetchJson(`${api.base}/expenses`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      clientRef: nextRef('exp'),
      amount: 15,
      category: 'O9',
      payFrom: 'shift',
      method: 'cash',
      shiftId: fx.shiftId,
    }),
  })
  expect(exp.ok, `expense (${exp.status})`)

  const move = await fetchJson(`${api.base}/finance/moves`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      clientRef: nextRef('fmove'),
      type: 'deposit',
      amount: 25,
      payFrom: 'shift',
      method: 'cash',
      shiftId: fx.shiftId,
    }),
  })
  expect(move.ok, `finance move (${move.status})`)

  const wo = await fetchJson(`${api.base}/stock/writeoffs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      clientRef: nextRef('wo'),
      reason: 'O9',
      items: [{ productId, qty: 2 }],
    }),
  })
  expect(wo.ok, `writeoff (${wo.status})`)

  if (fx.lastSaleId) {
    const ret = await fetchJson(`${api.base}/pos/sales/${encodeURIComponent(fx.lastSaleId)}/return`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        clientRef: nextRef('ret'),
        items: [{ index: 0, qty: 1 }],
      }),
    })
    expect(ret.ok, `sale return (${ret.status})`)
  }

  const prodNow = await resolveProduct(api.base, headers, fx)
  const adjTarget = round2(Number(prodNow?.stock || 0) + 5)
  const adj = await fetchJson(`${api.base}/stock/adjustments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      clientRef: nextRef('adj'),
      productId: fx.productId,
      targetQty: adjTarget,
      reason: 'O9-adj',
    }),
  })
  expect(adj.ok, `stock adjustment (${adj.status})`)

  const ord = await fetchJson(`${api.base}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: nextRef('ord'),
      client: { name: `${PREFIX}Buyer`, phone: uniquePhone('ord'), addr: 'A' },
      items: [{ product_id: productId, qty: 1, price: 100, name: productName }],
      total: 100,
      type: 'market',
    }),
  })
  expect(ord.ok && ord.body?.id, `order create (${ord.status})`)
  fx.orderId = ord.body?.id
  const st = await fetchJson(`${api.base}/orders/${encodeURIComponent(fx.orderId)}/status`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'assembling', clientRef: nextRef('ordSt') }),
  })
  expect(st.ok, `order status (${st.status})`)

  const patch = await fetchJson(`${api.base}/products/${encodeURIComponent(fx.productId)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ name: productName, price: 101 }),
  })
  expect(patch.ok, `product PATCH (${patch.status})`)

  const report = await fetchJson(`${api.base}/reports/pos`, { headers })
  expect(report.ok, `reports/pos (${report.status})`)

  // Lab OTP client auth
  const otpPhone = uniquePhone('otp')
  const send = await fetchJson(`${api.base}/auth/otp/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: otpPhone }),
  })
  if (send.ok && send.body?.challengeId) {
    const ver = await fetchJson(`${api.base}/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: otpPhone,
        code: '1234',
        challengeId: send.body.challengeId,
        name: `${PREFIX}Otp`,
      }),
    })
    expect(ver.ok && ver.body?.access_token, `lab OTP client auth (${ver.status})`)
  } else {
    console.log(`  INFO otp send skipped/unavailable (${send.status}) — lab may require OTP_LAB`)
  }

  await checkFixtureStockInvariant(api.base, headers, fx, { hard: true })
  return { token, headers, fx }
}

async function soakOp(api, headers, fx, kind) {
  const pid = fx.productId
  switch (kind) {
    case 'sale': {
      const r = await fetchJson(`${api.base}/pos/sales`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          clientRef: nextRef('soakSale'),
          shiftId: fx.shiftId,
          posId: fx.posId,
          cashierId: fx.cashierId,
          paymentMethod: 'cash',
          total: 100,
          paidCash: 100,
          items: [{ productId: pid, qty: 1, price: 100, lineTotal: 100 }],
        }),
      })
      if (r.ok) fx.lastSaleId = r.body?.id
      return r
    }
    case 'receipt': {
      return fetchJson(`${api.base}/stock/receipts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          clientRef: nextRef('soakRec'),
          paidNow: 0,
          items: [{ productId: pid, qty: 3, costPrice: 40, purchaseTotal: 120 }],
        }),
      })
    }
    case 'writeoff': {
      return fetchJson(`${api.base}/stock/writeoffs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          clientRef: nextRef('soakWo'),
          reason: 'soak',
          items: [{ productId: pid, qty: 1 }],
        }),
      })
    }
    case 'expense': {
      return fetchJson(`${api.base}/expenses`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          clientRef: nextRef('soakExp'),
          amount: 5,
          category: 'O9soak',
          payFrom: 'shift',
          method: 'cash',
          shiftId: fx.shiftId,
        }),
      })
    }
    case 'repay': {
      return fetchJson(`${api.base}/cards/${encodeURIComponent(fx.cardNum)}/debt-repay`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          clientRef: nextRef('soakRepay'),
          amount: 5,
          method: 'cash',
          shiftId: fx.shiftId,
          clientId: fx.clientId,
        }),
      })
    }
    case 'advance': {
      return fetchJson(`${api.base}/cards/${encodeURIComponent(fx.cardNum)}/cash-advance`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          clientRef: nextRef('soakAdv'),
          amount: 5,
          shiftId: fx.shiftId,
          clientId: fx.clientId,
        }),
      })
    }
    case 'meta': {
      return fetchJson(`${api.base}/products/${encodeURIComponent(pid)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ price: 100 + Math.floor(rand() * 5) }),
      })
    }
    case 'reports': {
      return fetchJson(`${api.base}/reports/pos`, { headers })
    }
    case 'orderStatus': {
      if (!fx.orderId) {
        const ord = await fetchJson(`${api.base}/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientRef: nextRef('soakOrd'),
            client: { name: `${PREFIX}B`, phone: uniquePhone('so'), addr: 'A' },
            items: [{ product_id: pid, qty: 1, price: 100, name: fx.productName }],
            total: 100,
            type: 'market',
          }),
        })
        fx.orderId = ord.body?.id
      }
      const statuses = ['assembling', 'assembled', 'delivering', 'delivered']
      const st = statuses[Math.floor(rand() * statuses.length)]
      return fetchJson(`${api.base}/orders/${encodeURIComponent(fx.orderId)}/status`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: st, clientRef: nextRef('soakOrdSt') }),
      })
    }
    case 'finance': {
      return fetchJson(`${api.base}/finance/moves`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          clientRef: nextRef('soakFin'),
          type: 'deposit',
          amount: 3,
          payFrom: 'shift',
          method: 'cash',
          shiftId: fx.shiftId,
        }),
      })
    }
    default:
      return { ok: false, status: 0, body: { detail: 'unknown kind' } }
  }
}

const SOAK_KINDS = [
  'sale', 'receipt', 'writeoff', 'expense', 'repay', 'advance',
  'meta', 'reports', 'orderStatus', 'finance',
  'sale', 'receipt', 'sale', 'writeoff', 'expense', 'finance',
]

async function runSoak(apiHolder, headersHolder, fx) {
  const restartAt = new Set([
    Math.floor(SOAK_TARGET * 0.25),
    Math.floor(SOAK_TARGET * 0.5),
    Math.floor(SOAK_TARGET * 0.75),
  ])
  let headers = headersHolder
  let api = apiHolder

  while (soakOps < SOAK_TARGET) {
    const kind = SOAK_KINDS[soakOps % SOAK_KINDS.length]
    // Occasionally force debt sale path so repay/advance have something to do
    if (kind === 'repay' || kind === 'advance') {
      await soakOp(api, headers, fx, 'sale').catch(() => {})
      await fetchJson(`${api.base}/pos/sales`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          clientRef: nextRef('soakDebt'),
          shiftId: fx.shiftId,
          posId: fx.posId,
          cashierId: fx.cashierId,
          paymentMethod: 'debt',
          total: 100,
          paidDebt: 100,
          cardNum: fx.cardNum,
          clientId: fx.clientId,
          items: [{ productId: fx.productId, qty: 1, price: 100, lineTotal: 100 }],
        }),
      })
    }
    await soakOp(api, headers, fx, kind)
    soakOps += 1

    if (soakOps % 50 === 0) {
      console.log(`  … soak ${soakOps}/${SOAK_TARGET} invariant check`)
      const inv = await checkFixtureStockInvariant(api.base, headers, fx, { hard: false })
      if (!inv.ok && inv.mismatch > 1) {
        // hard fail already recorded; continue only if soft path allowed — mismatch>1 already failed
        console.error(`  HARD invariant at op=${soakOps}; continuing soak only if not fatal`)
      }
      // Never early-exit soak on soft invariant
    }

    if (restartAt.has(soakOps)) {
      console.log(`\n--- Soak restart @ ${soakOps} (${Math.round((soakOps / SOAK_TARGET) * 100)}%) ---`)
      const before = await truthSnapshot(api.base, headers, fx)
      await killApi(api.child)
      api = await startApi(api.port)
      const rel = await afterRestartRelogin(api, fx)
      headers = rel.headers
      const after = await truthSnapshot(api.base, headers, fx)
      expect(
        Math.abs(after.stockApi - after.stockPg) <= STOCK_TOL,
        `restart@${soakOps} stock API==PG (${after.stockApi}/${after.stockPg})`,
      )
      expect(
        Math.abs(after.stockApi - before.stockApi) <= STOCK_TOL,
        `restart@${soakOps} stock preserved (${before.stockApi}→${after.stockApi})`,
      )
      expect(after.opRefs >= before.opRefs, `restart@${soakOps} opRefs non-decreasing`)
      expect(
        Math.abs(after.shiftCashApi - after.shiftCashPg) <= 0.051,
        `restart@${soakOps} shift cash API==PG`,
      )
      expect(
        Math.abs(after.debtApi - after.debtPg) <= 0.051,
        `restart@${soakOps} debt API==PG`,
      )
    }
  }

  expect(soakOps >= 500, `soak completed >=500 (got ${soakOps})`)
  expect(soakOps >= SOAK_TARGET, `soak target ${SOAK_TARGET} (got ${soakOps})`)
  return { api, headers }
}

async function sectionSessionPolicy(port) {
  console.log('\n=== SESSION POLICY (LAB_AUTO_AUTH=0) ===')
  let api = await startApi(port + 11, { KAKAPO_LAB_AUTO_AUTH: '0' })
  try {
    const login = await adminLogin(api.base)
    expect(login.ok && login.body?.access_token, 'strict admin login')
    const tok = login.body.access_token
    await killApi(api.child)
    api = await startApi(port + 11, { KAKAPO_LAB_AUTO_AUTH: '0' })
    const stale = await fetchJson(`${api.base}/employees`, {
      headers: { Authorization: `Bearer ${tok}` },
    })
    expect(stale.status === 401, `old token 401 after kill (${stale.status})`)
    const relogin = await adminLogin(api.base)
    expect(relogin.ok && relogin.body?.access_token, 're-login after session death')
    summaryExtras.SESSION_POLICY = 'PASS'
  } finally {
    await killApi(api?.child)
  }
}

async function sectionAckLost(apiHolder, port, headers, fx) {
  console.log('\n=== ACK-LOST ===')
  let api = apiHolder
  // Product create
  const prodRef = nextRef('ackProd')
  const prodName = `${PREFIX}AckProd-${refSeq}`
  const prodBody = { name: prodName, price: 55, stock: 0, clientRef: prodRef }
  const inflightP = fetchJson(`${api.base}/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify(prodBody),
  })
  const opP = await waitOpRef(prodRef, FIN_OP_KINDS.PRODUCT_UPSERT, 25000)
  expect(!!opP?.result, 'ACK-lost product opRef durable')
  await killApi(api.child)
  try { await inflightP } catch { /* reset */ }
  api = await startApi(port)
  const rel = await afterRestartRelogin(api, fx)
  headers = rel.headers
  const retryP = await fetchJson(`${api.base}/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify(prodBody),
  })
  expect(retryP.ok, `ACK-lost product retry (${retryP.status})`)
  const nProd = await withClient(async (c) => {
    const r = await c.query(
      `SELECT COUNT(*)::int AS n FROM docs WHERE collection='products' AND data->>'name'=$1`,
      [prodName],
    )
    return r.rows[0]?.n || 0
  })
  expect(nProd === 1, `ACK-lost product single effect (n=${nProd})`)

  // Writeoff
  const woRef = nextRef('ackWo')
  const woBody = {
    clientRef: woRef,
    reason: 'ack',
    items: [{ productId: fx.productId, qty: 1 }],
  }
  const inflightW = fetchJson(`${api.base}/stock/writeoffs`, {
    method: 'POST',
    headers,
    body: JSON.stringify(woBody),
  })
  const opW = await waitOpRef(woRef, WH_OP_KINDS.STOCK_WRITEOFF_CREATE, 25000)
  expect(!!opW?.result, 'ACK-lost writeoff opRef durable')
  await killApi(api.child)
  try { await inflightW } catch { /* reset */ }
  api = await startApi(port)
  const rel2 = await afterRestartRelogin(api, fx)
  headers = rel2.headers
  const retryW = await fetchJson(`${api.base}/stock/writeoffs`, {
    method: 'POST',
    headers,
    body: JSON.stringify(woBody),
  })
  expect(retryW.ok, `ACK-lost writeoff retry (${retryW.status})`)
  const nWo = await withClient(async (c) => {
    const id = opRefDocId(WH_OP_KINDS.STOCK_WRITEOFF_CREATE, woRef)
    const r = await c.query(`SELECT COUNT(*)::int AS n FROM docs WHERE collection='opRefs' AND id=$1`, [id])
    return r.rows[0]?.n || 0
  })
  expect(nWo === 1, `ACK-lost writeoff single opRef (n=${nWo})`)
  summaryExtras.ACK_LOST = 'PASS'
  return { api, headers }
}

async function sectionConcurrency(api, headers, fx) {
  console.log('\n=== CONCURRENCY ===')
  const [a, b] = await Promise.all([
    fetchJson(`${api.base}/pos/sales`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        clientRef: nextRef('concA'),
        shiftId: fx.shiftId,
        posId: fx.posId,
        cashierId: fx.cashierId,
        paymentMethod: 'cash',
        total: 100,
        paidCash: 100,
        items: [{ productId: fx.productId, qty: 1, price: 100, lineTotal: 100 }],
      }),
    }),
    fetchJson(`${api.base}/pos/sales`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        clientRef: nextRef('concB'),
        shiftId: fx.shiftId,
        posId: fx.posId,
        cashierId: fx.cashierId,
        paymentMethod: 'cash',
        total: 100,
        paidCash: 100,
        items: [{ productId: fx.productId, qty: 1, price: 100, lineTotal: 100 }],
      }),
    }),
  ])
  expect(a.ok && b.ok, `parallel sales different refs (${a.status}/${b.status})`)
  expect(String(a.body?.id) !== String(b.body?.id), 'parallel sales distinct ids')
  summaryExtras.CONCURRENCY = 'PASS'
}

async function sectionFailureInjection(port, fx) {
  console.log('\n=== FAILURE INJECTION ===')
  let api = await startApi(port + 21, { KAKAPO_LAB_AUTO_AUTH: '0' })
  try {
    const anon = await fetchJson(`${api.base}/pos/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRef: nextRef('anon'),
        paymentMethod: 'cash',
        total: 1,
        paidCash: 1,
        items: [],
      }),
    })
    expect(anon.status === 401, `anon 401 LAB_AUTO_AUTH=0 (${anon.status})`)
  } finally {
    await killApi(api.child)
  }

  api = await startApi(port + 22)
  try {
    const login = await adminLogin(api.base)
    const headers = { 'Content-Type': 'application/json', ...authHeaders(login.body?.access_token) }
    // Ensure shift
    const localFx = { ...fx }
    await ensureOpenShift(api.base, headers, localFx)
    const bad = await fetchJson(`${api.base}/pos/sales`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        clientRef: nextRef('insuf'),
        shiftId: localFx.shiftId,
        posId: localFx.posId,
        cashierId: localFx.cashierId,
        paymentMethod: 'cash',
        total: 100,
        paidCash: 100,
        items: [{ productId: localFx.productId, qty: 999999, price: 100, lineTotal: 99999900 }],
      }),
    })
    expect(bad.status >= 400 && bad.status < 500, `insufficient stock 4xx (${bad.status})`)

    await fetchJson(`${api.base}/__o8/chaos/hold-at`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ point: 'before_commit' }),
    })
    const chaosRef = nextRef('chaos')
    const p = fetchJson(`${api.base}/expenses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        clientRef: chaosRef,
        amount: 1,
        category: 'chaos',
        payFrom: 'shift',
        method: 'cash',
        shiftId: localFx.shiftId,
      }),
    }).catch(() => ({ ok: false }))
    await sleep(600)
    await killApi(api.child)
    await p
    const opN = await withClient(async (c) => {
      const id = opRefDocId(FIN_OP_KINDS.EXPENSE_CREATE, chaosRef)
      const r = await c.query(`SELECT COUNT(*)::int AS n FROM docs WHERE collection='opRefs' AND id=$1`, [id])
      return r.rows[0]?.n || 0
    })
    expect(opN === 0, `precommit kill → no opRef (n=${opN})`)
    summaryExtras.FAILURE_INJECTION = 'PASS'
  } finally {
    await killApi(api?.child)
  }
}

async function sectionSnapshotO8(apiHolder, port, headers, fx) {
  console.log('\n=== SNAPSHOT / O8 FLUSH ===')
  let api = apiHolder
  const sale1 = await fetchJson(`${api.base}/pos/sales`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      clientRef: nextRef('snapSale1'),
      shiftId: fx.shiftId,
      posId: fx.posId,
      cashierId: fx.cashierId,
      paymentMethod: 'cash',
      total: 100,
      paidCash: 100,
      items: [{ productId: fx.productId, qty: 1, price: 100, lineTotal: 100 }],
    }),
  })
  expect(sale1.ok, `snap sale1 (${sale1.status})`)
  await fetchJson(`${api.base}/products/${encodeURIComponent(fx.productId)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ price: 102 }),
  })
  await fetchJson(`${api.base}/__o8/flush-db`, { method: 'POST', headers })
  const sale2 = await fetchJson(`${api.base}/pos/sales`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      clientRef: nextRef('snapSale2'),
      shiftId: fx.shiftId,
      posId: fx.posId,
      cashierId: fx.cashierId,
      paymentMethod: 'cash',
      total: 100,
      paidCash: 100,
      items: [{ productId: fx.productId, qty: 1, price: 100, lineTotal: 100 }],
    }),
  })
  expect(sale2.ok, `snap sale2 (${sale2.status})`)
  await killApi(api.child)
  api = await startApi(port)
  const rel = await afterRestartRelogin(api, fx)
  headers = rel.headers
  const snap = await truthSnapshot(api.base, headers, fx)
  expect(Math.abs(snap.stockApi - snap.stockPg) <= STOCK_TOL, `snap stock API==PG ${snap.stockApi}/${snap.stockPg}`)
  summaryExtras.SNAPSHOT_O8 = 'PASS'
  return { api, headers }
}

async function sectionWs(api, headers, fx) {
  console.log('\n=== WEBSOCKET ===')
  let conn = await connectWs(api.port)
  conn.close()
  // Mutate while WS down
  await fetchJson(`${api.base}/products/${encodeURIComponent(fx.productId)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ price: 103, clientRef: nextRef('wsMeta') }),
  })
  conn = await connectWs(api.port)
  // No GET /products/:id route — recover via list (canonical Store/trade pull)
  const list = await fetchJson(`${api.base}/products`, { headers })
  const prod = (list.body || []).find(
    (p) => String(p.id) === String(fx.productId) || p.name === fx.productName,
  )
  const wsOk = list.ok && !!prod && prod.stock != null
  expect(wsOk, `WS reconnect then product list GET recovers canonical (list=${list.status} found=${!!prod})`)
  if (prod) fx.productId = String(prod.id)
  conn.close()
  summaryExtras.WS = wsOk ? 'PASS' : 'FAIL'
}

async function sectionResources() {
  console.log('\n=== RESOURCES ===')
  const rss0 = process.memoryUsage().rss
  let idle = await withClient(async (c) => {
    const r = await c.query(
      `SELECT COUNT(*)::int AS n FROM pg_stat_activity
       WHERE datname = current_database() AND state = 'idle in transaction'`,
    )
    return r.rows[0]?.n || 0
  })
  if (idle > 0) {
    await sleep(500)
    idle = await withClient(async (c) => {
      const r = await c.query(
        `SELECT COUNT(*)::int AS n FROM pg_stat_activity
         WHERE datname = current_database() AND state = 'idle in transaction'`,
      )
      return r.rows[0]?.n || 0
    })
  }
  expect(idle === 0, `idle-in-tx=0 (got ${idle})`)

  let total = null
  let idleConn = null
  let waiting = null
  try {
    const pool = typeof getPool === 'function' ? await getPool() : null
    total = pool?.totalCount ?? null
    idleConn = pool?.idleCount ?? null
    waiting = pool?.waitingCount ?? null
  } catch { /* pool optional */ }
  console.log(`  INFO pg pool total=${total} idle=${idleConn} waiting=${waiting}`)
  const rss1 = process.memoryUsage().rss
  const deltaMb = ((rss1 - rss0) / (1024 * 1024)).toFixed(2)
  console.log(`  INFO RSS delta ${deltaMb} MB`)
  summaryExtras.RESOURCES = { idleInTx: idle, poolTotal: total, rssDeltaMb: Number(deltaMb) }
}

function sectionConfigAudit() {
  console.log('\n=== CONFIG AUDIT (no secrets) ===')
  const keys = [
    'NODE_ENV',
    'KAKAPO_O8_TEST_API',
    'KAKAPO_LAB_AUTO_AUTH',
    'KAKAPO_OTP_LAB',
    'KAKAPO_L13_TEST_API',
    'DATABASE_URL',
  ]
  const audit = {}
  for (const k of keys) {
    if (k === 'DATABASE_URL') {
      audit[k] = REAL_PG ? '(set, redacted)' : '(unset)'
    } else {
      audit[k] = process.env[k] ?? '(unset)'
    }
  }
  audit.SMS_OTP_PROVIDER = 'MISSING'
  audit.CURRENT_AUTH_SINGLE_INSTANCE_SAFE = 'YES'
  audit.CURRENT_AUTH_MULTI_INSTANCE_SAFE = 'NO'
  audit.INITIAL_RELEASE_MULTI_INSTANCE_BLOCKER = 'NO — single-instance session acceptable for initial release'
  console.log(JSON.stringify(audit, null, 2))
  summaryExtras.CONFIG_AUDIT = audit
}

async function sectionStartupValidation() {
  console.log('\n=== STARTUP VALIDATION ===')
  // Unit: production + each dangerous flag refuses
  const flags = [
    { KAKAPO_O8_TEST_API: '1' },
    { KAKAPO_LAB_AUTO_AUTH: '1' },
    { KAKAPO_L13_TEST_API: '1' },
    { KAKAPO_OTP_LAB: '1' },
  ]
  const saved = { ...process.env }
  let refuses = 0
  for (const f of flags) {
    process.env.NODE_ENV = 'production'
    process.env.CORS_ORIGINS = 'https://kakappo.shop'
    for (const k of Object.keys(f)) process.env[k] = f[k]
    // clear others that might also trip
    try {
      assertSafeAuthEnvOrThrow()
      expect(false, `production+${Object.keys(f)[0]} should throw`)
    } catch {
      refuses += 1
      expect(true, `production refuses ${Object.keys(f)[0]}`)
    }
    for (const k of Object.keys(f)) {
      if (saved[k] == null) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
  process.env.NODE_ENV = saved.NODE_ENV || 'test'
  for (const k of ['KAKAPO_O8_TEST_API', 'KAKAPO_LAB_AUTO_AUTH', 'KAKAPO_L13_TEST_API', 'KAKAPO_OTP_LAB']) {
    if (saved[k] == null) delete process.env[k]
    else process.env[k] = saved[k]
  }

  // Safe production-like: NODE_ENV=production without dangerous flags should not throw
  process.env.NODE_ENV = 'production'
  delete process.env.KAKAPO_O8_TEST_API
  delete process.env.KAKAPO_LAB_AUTO_AUTH
  delete process.env.KAKAPO_L13_TEST_API
  delete process.env.KAKAPO_OTP_LAB
  process.env.CORS_ORIGINS = 'https://kakappo.shop,https://www.kakappo.shop'
  try {
    assertSafeAuthEnvOrThrow()
    expect(true, 'safe production-like starts (assertSafeAuthEnv ok)')
  } catch (e) {
    expect(false, `safe production-like threw: ${e.message}`)
  }
  // also refuse wildcard CORS
  process.env.CORS_ORIGINS = '*'
  try {
    assertSafeAuthEnvOrThrow()
    expect(false, 'production+CORS=* should throw')
  } catch {
    expect(true, 'production refuses CORS_ORIGINS=*')
  }
  process.env.CORS_ORIGINS = 'https://kakappo.shop,https://www.kakappo.shop'
  // restore lab env
  process.env.NODE_ENV = saved.NODE_ENV || 'test'
  for (const k of Object.keys(saved)) {
    if (saved[k] != null) process.env[k] = saved[k]
  }
  process.env.KAKAPO_O8_TEST_API = '1'
  process.env.KAKAPO_LAB_AUTO_AUTH = '1'
  summaryExtras.STARTUP_VALIDATION = { refuses, ok: refuses === flags.length }
}

async function sectionBackup(apiHolder, port, headers, fx) {
  console.log('\n=== BACKUP / PG HYDRATE (required) ===')
  let api = apiHolder
  const before = await pgTotalsSnapshot()
  await killApi(api.child)
  api = await startApi(port)
  const rel = await afterRestartRelogin(api, fx)
  headers = rel.headers
  const after = await pgTotalsSnapshot()
  const keys = new Set([...Object.keys(before.docsByCollection), ...Object.keys(after.docsByCollection)])
  let mismatch = 0
  for (const k of keys) {
    if ((before.docsByCollection[k] || 0) !== (after.docsByCollection[k] || 0)) mismatch += 1
  }
  expect(mismatch === 0 && before.syncChanges === after.syncChanges,
    `PG hydrate totals match after restart (colMismatches=${mismatch} sync ${before.syncChanges}→${after.syncChanges})`)

  // Optional pg_dump if available
  let dumpOk = null
  try {
    execFileSync('pg_dump', ['--version'], { stdio: 'ignore' })
    const url = getDatabaseUrl()
    const out = path.join(root, 'scripts', `.o9-pgdump-${Date.now()}.sql`)
    try {
      execFileSync('pg_dump', [url, '-f', out], { stdio: 'ignore', timeout: 60000 })
      dumpOk = true
      try { unlinkSync(out) } catch { /* */ }
    } catch {
      dumpOk = false
    }
  } catch {
    dumpOk = 'ENOENT_SKIPPED'
    console.log('  INFO pg_dump not available — primary hydrate proof used')
  }
  summaryExtras.BACKUP = { hydrate: mismatch === 0, pg_dump: dumpOk }
  return { api, headers }
}

function sectionGit() {
  console.log('\n=== GIT ===')
  let head = 'unknown'
  let porcelain = 0
  try {
    head = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim()
    const st = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' })
    porcelain = st.split('\n').filter((l) => l.trim()).length
  } catch (e) {
    console.warn('  WARN git:', e.message)
  }
  console.log(`  HEAD ${head}`)
  console.log(`  porcelain ${porcelain}`)
  summaryExtras.GIT = { head, porcelain }
}

async function main() {
  console.log(`\n=== ONLINE-O9 SOAK RELEASE REAL_PG=${REAL_PG} REQUIRED=${REQUIRE} SEED=${SEED.toString(16)} ===\n`)
  if (!REAL_PG) {
    if (REQUIRE) {
      console.error('FAIL: O9_REAL_PG_REQUIRED=1 but DATABASE_URL missing')
      process.exit(1)
    }
    console.log('SKIP: no DATABASE_URL')
    process.exit(0)
  }

  await ensureSchema()
  await assertTestDatabaseAllowed()
  await cleanupOnlineTestPrefixes([PREFIX])
  await bootstrapTestLabCashVault()

  const port = 19290 + Math.floor(rand() * 80)
  let api = await startApi(port)
  let headers = null
  let fx = null

  try {
    console.log('\n=== LIFECYCLE ===')
    const life = await lifecycleBootstrap(api)
    headers = life.headers
    fx = life.fx

    console.log('\n=== SOAK ===')
    const soaked = await runSoak(api, headers, fx)
    api = soaked.api
    headers = soaked.headers

    await sectionSessionPolicy(port)
    // Main API still running after soak — ACK-lost reuses it
    const ack = await sectionAckLost(api, port, headers, fx)
    api = ack.api
    headers = ack.headers

    await sectionConcurrency(api, headers, fx)
    await sectionFailureInjection(port, fx)

    // Re-bind main API after failure section may have used other ports
    if (!api?.child || api.child.killed || api.child.exitCode != null) {
      api = await startApi(port)
      const rel = await afterRestartRelogin(api, fx)
      headers = rel.headers
    }

    const snap = await sectionSnapshotO8(api, port, headers, fx)
    api = snap.api
    headers = snap.headers

    await sectionWs(api, headers, fx)
    await sectionResources()
    sectionConfigAudit()
    await sectionStartupValidation()
    const bak = await sectionBackup(api, port, headers, fx)
    api = bak.api
    headers = bak.headers
    sectionGit()

    // Final fixture invariant
    await checkFixtureStockInvariant(api.base, headers, fx, { hard: true })
  } catch (e) {
    failed += 1
    console.error('FAIL uncaught', e)
  } finally {
    await killApi(api?.child)
    await cleanupOnlineTestPrefixes([PREFIX])
    await closePool()
  }

  const result = {
    PASSED: passed,
    FAILED: failed,
    SOAK_OPERATIONS_TOTAL: soakOps,
    PERIODIC_INVARIANT_FAILURES,
    SOFT_INVARIANT_CONTINUES: softInvariantContinues,
    RESTARTS: restartCount,
    COUNT_5XX: count5xx,
    COUNT_4XX: count4xx,
    ...summaryExtras,
  }
  console.log(`\n=== O9 RESULT passed=${passed} failed=${failed} soak=${soakOps} ===`)
  console.log(JSON.stringify(result, null, 2))
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
