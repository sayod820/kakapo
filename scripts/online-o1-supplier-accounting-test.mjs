/**
 * ONLINE-O1 — supplier accounting numeric matrix (real PG + API child).
 *
 *   O1_REAL_PG_REQUIRED=1
 *   DATABASE_URL=postgresql://…/kakapo_l11_test
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

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const PREFIX = 'O1-'

const REQUIRE = String(process.env.O1_REAL_PG_REQUIRED || process.env.O8_REAL_PG_REQUIRED || '') === '1'
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
      env: {
        ...process.env,
        PORT: String(port),
        KAKAPO_O8_TEST_API: '1',
        NODE_ENV: 'test',
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
  try { child.kill('SIGKILL') } catch { /* ignore */ }
}

async function pgIdentity() {
  return withClient(async (c) => {
    const r = await c.query('SELECT current_database() AS db, current_user AS usr')
    return { db: r.rows[0]?.db, usr: r.rows[0]?.usr }
  })
}

async function cleanupPg() {
  await withClient(async (c) => {
    await c.query(
      'DELETE FROM sync_changes WHERE source_client_ref LIKE $1',
      [`${PREFIX}%`],
    )
    await c.query(`DELETE FROM docs WHERE data->>'clientRef' LIKE $1`, [`${PREFIX}%`])
    await c.query(`DELETE FROM docs WHERE collection='posShifts' AND data->>'status'='open'`)
  })
}

async function getSupplier(base, id) {
  const r = await fetchJson(`${base}/suppliers`)
  const row = (r.body || []).find(s => s.id === id)
  return row
}

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100
}

async function seed(base) {
  const points = await fetchJson(`${base}/pos/points`)
  const posId = points.body?.[0]?.id
  const sup = await fetchJson(`${base}/suppliers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${PREFIX}Sup`, clientRef: `${PREFIX}sup` }),
  })
  const prod = await fetchJson(`${base}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `${PREFIX}P`,
      price: 100,
      costPrice: 50,
      stock: 0,
      clientRef: `${PREFIX}prod`,
    }),
  })
  const cashiers = await fetchJson(`${base}/cashiers`)
  let cashierId = cashiers.body?.[0]?.id
  if (!cashierId) {
    const c = await fetchJson(`${base}/cashiers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${PREFIX}Cashier`, pin: '0000' }),
    })
    cashierId = c.body?.id
  }
  const openList = await fetchJson(`${base}/pos/shifts?status=open`)
  const existingOpen = (openList.body || []).find(s => String(s.status) === 'open')
  if (existingOpen?.id) {
    return {
      supplierId: sup.body?.id,
      productId: prod.body?.id,
      shiftId: existingOpen.id,
      posId: existingOpen.posId || posId,
    }
  }
  const shift = await fetchJson(`${base}/pos/shifts/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      posId,
      cashierId,
      cashierName: `${PREFIX}Cashier`,
      openingCash: 1000,
      clientRef: `${PREFIX}shift-${Date.now()}`,
    }),
  })
  if (!shift.ok) {
    throw new Error(`O1 seed: shift open failed (${shift.status} ${shift.body?.detail || ''})`)
  }
  return {
    supplierId: sup.body?.id,
    productId: prod.body?.id,
    shiftId: shift.body?.id,
    posId: shift.body?.posId || posId,
  }
}

async function receiptCreate(base, fx, total, opts = {}) {
  const clientRef = opts.clientRef || `${PREFIX}rec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const body = {
    clientRef,
    supplierId: fx.supplierId,
    expectedSupplyVersion: opts.supplyVersion ?? 0,
    paidNow: opts.paidNow ?? 0,
    payFrom: opts.payFrom || 'shift',
    method: opts.method || 'cash',
    shiftId: fx.shiftId,
    posId: fx.posId,
    items: [{
      productId: fx.productId,
      qty: 1,
      purchaseTotal: total,
      costPrice: total,
    }],
  }
  const r = await fetchJson(`${base}/stock/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    if (r.status === 400 && String(r.body?.code || '') === '40P01') {
      await sleep(400)
      return receiptCreate(base, fx, total, opts)
    }
    throw new Error(`receipt: ${r.status} ${JSON.stringify(r.body)}`)
  }
  return { receipt: r.body, clientRef, nextSupplyVersion: (opts.supplyVersion ?? 0) + 1 }
}

async function paySupplier(base, fx, amount, opts = {}) {
  const clientRef = opts.clientRef || `${PREFIX}pay-${Date.now()}`
  const sup = await getSupplier(base, fx.supplierId)
  const body = {
    clientRef,
    amount,
    expectedPayVersion: opts.expectedPayVersion ?? sup?.payVersion ?? 0,
    settlementMethod: opts.settlementMethod || 'adjustment',
    payFrom: opts.payFrom,
    method: opts.method,
    shiftId: fx.shiftId,
    posId: fx.posId,
  }
  const r = await fetchJson(`${base}/suppliers/${fx.supplierId}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { r, clientRef }
}

console.log(`\n=== ONLINE-O1 REAL_PG=${REAL_PG} REQUIRED=${REQUIRE} ===`)
if (REQUIRE && !REAL_PG) {
  console.error('FAIL: O1_REAL_PG_REQUIRED=1 but DATABASE_URL missing')
  process.exit(1)
}
if (!REAL_PG) {
  console.log('  SKIP (no DATABASE_URL)')
  process.exit(0)
}

await ensureSchema()
const id = await pgIdentity()
console.log(`  INFO database=${id.db} user=${id.usr}`)
expect(id.db === 'kakapo_l11_test' || process.env.O8_ALLOW_NON_L11_DB === '1', 'O1 PG identity')
await cleanupPg()

const PORT = 18090 + Math.floor(Math.random() * 100)
const api = await startApi(PORT)
const fx = await seed(api.base)
expect(!!fx.supplierId, 'O1 seed')

try {
  // CASE 1
  let sv = 0
  const a = await receiptCreate(api.base, fx, 1000, { supplyVersion: sv })
  sv = a.nextSupplyVersion
  const b = await receiptCreate(api.base, fx, 500, { supplyVersion: sv })
  sv = b.nextSupplyVersion
  await paySupplier(api.base, fx, 400)
  const supMid = await getSupplier(api.base, fx.supplierId)
  expect(round2(supMid?.payableAmount) === 1100, 'CASE1 mid payable 1100')

  await fetchJson(`${api.base}/stock/receipts/${a.receipt.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}case1-edit-a`,
      supplierId: fx.supplierId,
      expectedSupplyVersion: sv,
      items: [{ productId: fx.productId, qty: 1, purchaseTotal: 800, costPrice: 800 }],
    }),
  })
  sv += 1
  await fetchJson(`${api.base}/stock/receipts/${b.receipt.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: `${PREFIX}case1-del-b` }),
  })
  const sup1 = await getSupplier(api.base, fx.supplierId)
  expect(round2(sup1?.payableAmount) === 400, 'CASE1 final payable 400')
  expect(round2(sup1?.totalPaid) === 400, 'CASE1 payment preserved')

  // CASE 2 — new supplier
  const sup2r = await fetchJson(`${api.base}/suppliers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${PREFIX}Sup2`, clientRef: `${PREFIX}sup2` }),
  })
  const fx2 = { ...fx, supplierId: sup2r.body?.id }
  await fetchJson(`${api.base}/finance/moves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'deposit',
      amount: 10000,
      payFrom: 'vault',
      method: 'cash',
      clientRef: `${PREFIX}vault-seed`,
    }),
  })
  await receiptCreate(api.base, fx2, 1000, {
    paidNow: 300,
    payFrom: 'vault',
    supplyVersion: 0,
  })
  await paySupplier(api.base, fx2, 200)
  const sup2 = await getSupplier(api.base, fx2.supplierId)
  expect(round2(sup2?.payableAmount) === 500, 'CASE2 payable 500')

  // CASE 7/8 double-click + ACK replay (fresh supplier with headroom)
  const supDc = await fetchJson(`${api.base}/suppliers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${PREFIX}SupDC`, clientRef: `${PREFIX}supdc` }),
  })
  const fxDc = { ...fx, supplierId: supDc.body?.id }
  await receiptCreate(api.base, fxDc, 2000, { supplyVersion: 0 })
  const dcRef = `${PREFIX}dc-100`
  const supDcBefore = await getSupplier(api.base, fxDc.supplierId)
  const payVerSnap = supDcBefore?.payVersion ?? 0
  const p1 = await paySupplier(api.base, fxDc, 100, { clientRef: dcRef, expectedPayVersion: payVerSnap })
  const p2 = await paySupplier(api.base, fxDc, 100, { clientRef: dcRef, expectedPayVersion: payVerSnap })
  const pays = await fetchJson(`${api.base}/suppliers/${fxDc.supplierId}/payments`)
  const dcRows = (pays.body || []).filter(p => p.clientRef === dcRef)
  expect(p1.r.ok && p2.r.ok && dcRows.length === 1, 'CASE7/8 idempotent single row')
  expect(p2.r.body?.replayed || p2.r.body?.id === p1.r.body?.id, 'CASE8 replay payload')

  // CASE 5 — overpay reject on standalone payment
  const fx3r = await fetchJson(`${api.base}/suppliers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${PREFIX}Sup3`, clientRef: `${PREFIX}sup3` }),
  })
  const fx3 = { ...fx, supplierId: fx3r.body?.id }
  const r3 = await receiptCreate(api.base, fx3, 1000, { supplyVersion: 0 })
  await paySupplier(api.base, fx3, 800)
  const over = await paySupplier(api.base, fx3, 500)
  expect(over.r.status === 409, 'CASE5 overpay rejected')
  const pays3 = await fetchJson(`${api.base}/suppliers/${fx3.supplierId}/payments`)
  expect((pays3.body || []).filter(p => round2(p.amount) === 800).length >= 1, 'CASE5 800 payment kept')

  // CASE 6 — delete receipt keeps payment
  await fetchJson(`${api.base}/stock/receipts/${r3.receipt.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: `${PREFIX}case6-del` }),
  })
  const pays6 = await fetchJson(`${api.base}/suppliers/${fx3.supplierId}/payments`)
  expect((pays6.body || []).some(p => round2(p.amount) === 800), 'CASE6 payment survives receipt delete')
  const sup6 = await getSupplier(api.base, fx3.supplierId)
  expect(round2(sup6?.creditBalance || Math.max(0, (sup6?.totalPaid || 0) - (sup6?.totalSupplied || 0))) === 800, 'CASE6 credit 800')

  // CASE 3 — cash exact-once (dedicated supplier + vault funding)
  await fetchJson(`${api.base}/finance/moves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'deposit',
      amount: 20000,
      payFrom: 'vault',
      method: 'cash',
      clientRef: `${PREFIX}case3-vault`,
    }),
  })
  const supC3 = await fetchJson(`${api.base}/suppliers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${PREFIX}SupC3`, clientRef: `${PREFIX}supc3` }),
  })
  const fxC3 = { ...fx, supplierId: supC3.body?.id }
  await receiptCreate(api.base, fxC3, 1000, { supplyVersion: 0 })
  const vault0r = await fetchJson(`${api.base}/finance/vault`)
  const vault0 = round2(Number(vault0r.body?.cashTotal) || 0)
  const supC3b = await getSupplier(api.base, fxC3.supplierId)
  const paid0 = round2(supC3b?.totalPaid || 0)
  const payRef3 = `${PREFIX}case3-cash`
  const payVer3 = supC3b?.payVersion ?? 0
  const c3p1 = await paySupplier(api.base, fxC3, 1000, {
    clientRef: payRef3,
    expectedPayVersion: payVer3,
    settlementMethod: 'cash',
    payFrom: 'vault',
    method: 'cash',
  })
  expect(c3p1.r.ok, `CASE3 payment ok (${c3p1.r.status} ${JSON.stringify(c3p1.r.body?.detail || '')})`)
  const c3p2 = await paySupplier(api.base, fxC3, 1000, {
    clientRef: payRef3,
    expectedPayVersion: payVer3,
    settlementMethod: 'cash',
    payFrom: 'vault',
    method: 'cash',
  })
  const vault1r = await fetchJson(`${api.base}/finance/vault`)
  const vault1 = round2(Number(vault1r.body?.cashTotal) || 0)
  const supC3a = await getSupplier(api.base, fxC3.supplierId)
  const paysC3 = await fetchJson(`${api.base}/suppliers/${fxC3.supplierId}/payments`)
  const ledgerN = await withClient(async (c) => {
    const r = await c.query(
      `SELECT COUNT(*)::int AS n FROM docs WHERE collection='moneyLedger' AND data->>'clientRef'=$1`,
      [payRef3],
    )
    return r.rows[0]?.n || 0
  })
  const finN = await withClient(async (c) => {
    const r = await c.query(
      `SELECT COUNT(*)::int AS n FROM docs WHERE collection='financeMoves' AND data->>'clientRef'=$1`,
      [payRef3],
    )
    return r.rows[0]?.n || 0
  })
  expect(round2(supC3a?.totalPaid) - paid0 === 1000, 'CASE3 totalPaid +1000 once')
  expect(round2(supC3a?.payableAmount) === 0, 'CASE3 payable 0')
  expect(round2(vault0 - vault1) === 1000, 'CASE3 vault cash -1000 once')
  expect((paysC3.body || []).filter(p => p.clientRef === payRef3).length === 1, 'CASE3 one SPAY')
  expect(ledgerN === 1, 'CASE3 one ledger row')
  expect(finN === 1, 'CASE3 one finance move')
  expect(c3p2.r.ok && (c3p2.r.body?.replayed || c3p2.r.body?.id === c3p1.r.body?.id), 'CASE3 retry replay')

  // CASE 4 — card exact-once
  await fetchJson(`${api.base}/finance/moves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'deposit',
      amount: 20000,
      payFrom: 'shift',
      method: 'card',
      shiftId: fx.shiftId,
      clientRef: `${PREFIX}case4-fund-card`,
    }),
  })
  const supC4 = await fetchJson(`${api.base}/suppliers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${PREFIX}SupC4`, clientRef: `${PREFIX}supc4` }),
  })
  const fxC4 = { ...fx, supplierId: supC4.body?.id }
  await receiptCreate(api.base, fxC4, 1000, { supplyVersion: 0 })
  const shiftCardBefore = await fetchJson(`${api.base}/pos/shifts`)
  const shCard0 = (shiftCardBefore.body || []).find(s => s.id === fx.shiftId)
  const card0 = round2(Number(shCard0?.salesCard) || 0)
  const expCard0 = round2(Number(shCard0?.expenseTotal) || 0)
  const payRef4 = `${PREFIX}case4-card`
  const supC4b = await getSupplier(api.base, fxC4.supplierId)
  const c4p1 = await paySupplier(api.base, fxC4, 1000, {
    clientRef: payRef4,
    expectedPayVersion: supC4b?.payVersion ?? 0,
    settlementMethod: 'card',
    payFrom: 'shift',
    method: 'card',
  })
  expect(c4p1.r.ok, 'CASE4 payment ok')
  await paySupplier(api.base, fxC4, 1000, {
    clientRef: payRef4,
    expectedPayVersion: supC4b?.payVersion ?? 0,
    settlementMethod: 'card',
    payFrom: 'shift',
    method: 'card',
  })
  const shCard1 = ((await fetchJson(`${api.base}/pos/shifts`)).body || []).find(s => s.id === fx.shiftId)
  const card1 = round2(Number(shCard1?.salesCard) || 0)
  const expCard1 = round2(Number(shCard1?.expenseTotal) || 0)
  const supC4a = await getSupplier(api.base, fxC4.supplierId)
  expect(round2(supC4a?.payableAmount) === 0, 'CASE4 payable 0')
  expect(round2(expCard1 - expCard0) === 0, 'CASE4 cash expense unchanged')
  expect(round2(card0 - card1) === 1000, 'CASE4 card -1000 once')
  expect((await fetchJson(`${api.base}/suppliers/${fxC4.supplierId}/payments`)).body?.filter(p => p.clientRef === payRef4).length === 1, 'CASE4 one SPAY')

} finally {
  killApi(api.child)
  await closePool()
}

console.log(`\n=== ONLINE-O1: ${passed} passed, ${failed} failed ===\n`)
process.exit(failed ? 1 : 0)
