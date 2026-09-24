/**
 * ONLINE-O2B — durable shift/finance/vault/return closure (real PG + API child).
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
import { loadDocsIntoMemory } from '../server/kakapo-api/pg/businessMutationTx.js'
import { shiftExpectedCash } from '../server/kakapo-api/financeTruth.js'
import { expectedTillCashFromShift } from '../lib/shiftSaleTotalsCore.mjs'
import {
  opRefDocId,
  FIN_OP_KINDS,
  WH_OP_KINDS,
} from '../server/kakapo-api/pg/businessMutationTx.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const PREFIX = 'O2B-'

const REQUIRE = String(process.env.O2B_REAL_PG_REQUIRED || process.env.O2_REAL_PG_REQUIRED || '') === '1'
const REAL_PG = isPostgresEnabled()

let passed = 0
let failed = 0

function expect(cond, msg) {
  if (cond) { passed += 1; console.log(`  OK  ${msg}`) }
  else { failed += 1; console.error(`  FAIL ${msg}`) }
}

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100
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
    await c.query('DELETE FROM sync_changes WHERE source_client_ref LIKE $1', [`${PREFIX}%`])
    await c.query(`DELETE FROM docs WHERE data->>'clientRef' LIKE $1`, [`${PREFIX}%`])
    await c.query(`DELETE FROM docs WHERE id LIKE $1`, [`op:%${PREFIX}%`])
    await c.query(`DELETE FROM docs WHERE collection='posShifts' AND data->>'status'='open'`)
  })
}

async function setChaos(base, point) {
  return fetchJson(`${base}/__o8/chaos/hold-at`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ point }),
  })
}

async function releaseChaos(base) {
  return fetchJson(`${base}/__o8/chaos/release`, { method: 'POST' })
}

async function seed(base) {
  const points = await fetchJson(`${base}/pos/points`)
  const posId = points.body?.[0]?.id
  const prod = await fetchJson(`${base}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `${PREFIX}Product`,
      price: 100,
      costPrice: 40,
      stock: 100,
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
  const sup = await fetchJson(`${base}/suppliers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${PREFIX}Supplier`, clientRef: `${PREFIX}sup` }),
  })
  return { productId: prod.body?.id, posId, cashierId, supplierId: sup.body?.id }
}

function getShift(shifts, id) {
  return (shifts.body || []).find(s => s.id === id)
}

console.log(`\n=== ONLINE-O2B REAL_PG=${REAL_PG} REQUIRED=${REQUIRE} ===`)
if (REQUIRE && !REAL_PG) {
  console.error('FAIL: O2B_REAL_PG_REQUIRED=1 but DATABASE_URL missing')
  process.exit(1)
}
if (!REAL_PG) {
  console.log('  SKIP (no DATABASE_URL)')
  process.exit(0)
}

await ensureSchema()
const id = await pgIdentity()
console.log(`  INFO database=${id.db} user=${id.usr}`)
expect(id.db === 'kakapo_l11_test' || process.env.O8_ALLOW_NON_L11_DB === '1', 'O2B PG identity')
await cleanupOnlineTestPrefixes([PREFIX])
await bootstrapTestLabCashVault()
await cleanupPg()

const PORT = 18300 + Math.floor(Math.random() * 40)
let api = await startApi(PORT)
const fx = await seed(api.base)

try {
  // B — shift open durable + replay
  const openRef = `${PREFIX}shift-open`
  const open1 = await fetchJson(`${api.base}/pos/shifts/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: openRef,
      posId: fx.posId,
      cashierId: fx.cashierId,
      openingCash: 1000,
    }),
  })
  expect(open1.ok && open1.body?.durable === true, `shift open durable (${open1.status} ${open1.body?.detail || ''})`)
  const shiftId = open1.body?.id
  const open2 = await fetchJson(`${api.base}/pos/shifts/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: openRef,
      posId: fx.posId,
      cashierId: fx.cashierId,
      openingCash: 1000,
    }),
  })
  expect(open2.ok && open2.body?.replayed, 'shift open replay')
  const openOp = await withClient(async (c) => {
    const oid = opRefDocId(FIN_OP_KINDS.SHIFT_OPEN, openRef)
    const r = await c.query(`SELECT COUNT(*)::int AS n FROM docs WHERE collection='opRefs' AND id=$1`, [oid])
    return r.rows[0]?.n || 0
  })
  expect(openOp === 1, 'shift open single opRef')

  // D — server vs browser expected cash
  const sh = getShift(await fetchJson(`${api.base}/pos/shifts`), shiftId)
  expect(round2(shiftExpectedCash(sh)) === round2(expectedTillCashFromShift(sh)), 'SERVER_UI_EXPECTED_CASH_MATCH')

  // J — full shift money scenario (spec §J)
  const runTag = String(process.env.ONLINE_RUN_ID || Date.now())
  const phone = `998${String(runTag).slice(-9)}`
  const cardNum = `${PREFIX}DC${String(runTag).slice(-6)}`.slice(0, 24).toUpperCase()
  const cl = await fetchJson(`${api.base}/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `${PREFIX}DebtClient`,
      phone,
      clientRef: `${PREFIX}cli-${runTag}`,
    }),
  })
  expect(cl.ok && cl.body?.id, 'debt fixture client create')
  await fetchJson(`${api.base}/cards/ensure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ num: cardNum, clientId: cl.body.id, client: cl.body.name, phone, debtEnabled: true }),
  })
  const link = await fetchJson(`${api.base}/clients/${cl.body.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card: cardNum, clientRef: `${PREFIX}link-${runTag}` }),
  })
  expect(link.ok, 'debt fixture O8 link')
  const debtSeed = await fetchJson(`${api.base}/clients/${cl.body.id}/debt-adjustments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}debt-seed-${runTag}`,
      targetDebt: 50,
      reason: 'O2B canonical repay fixture',
    }),
  })
  expect(debtSeed.ok, 'canonical debt seed 50')
  const cardsAfter = await fetchJson(`${api.base}/cards`)
  const cardRow = (cardsAfter.body || []).find(c => String(c.num).toUpperCase() === cardNum)
  const clientAfter = (await fetchJson(`${api.base}/clients`)).body?.find(c => c.id === cl.body.id)
  expect(round2(clientAfter?.debt) === 50, 'canonical client debt 50 before repay')
  expect(cardRow?.status === 'active' && round2(cardRow?.debt) === 50, 'active card mirror debt 50 before repay')
  await fetchJson(`${api.base}/pos/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}sale-cash`,
      shiftId,
      posId: fx.posId,
      paymentMethod: 'cash',
      total: 100,
      paidCash: 100,
      items: [{ productId: fx.productId, qty: 1, price: 100, lineTotal: 100 }],
    }),
  })
  await fetchJson(`${api.base}/pos/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}sale-card`,
      shiftId,
      paymentMethod: 'card',
      total: 200,
      paidCard: 200,
      items: [{ productId: fx.productId, qty: 1, price: 200, lineTotal: 200 }],
    }),
  })
  const repay = await fetchJson(`${api.base}/cards/${encodeURIComponent(cardNum)}/debt-repay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}debt-repay`,
      amount: 50,
      method: 'cash',
      shiftId,
    }),
  })
  expect(repay.ok, `cash debt repay +50 (${repay.status} ${repay.body?.detail || repay.body?.code || ''})`)
  expect(repay.ok, 'DEBT_REPAY_SUCCEEDED')
  const shRepay = getShift(await fetchJson(`${api.base}/pos/shifts`), shiftId)
  const repayCashDelta = round2(Number(shRepay?.salesCash) || 0) - 100
  expect(repayCashDelta === 50, `DEBT_REPAY_CASH_EFFECT +50 (salesCash delta ${repayCashDelta})`)
  await fetchJson(`${api.base}/expenses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}exp`,
      amount: 20,
      category: 'O2B',
      payFrom: 'shift',
      method: 'cash',
      shiftId,
    }),
  })
  await fetchJson(`${api.base}/stock/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}rec-pay`,
      supplierId: fx.supplierId,
      expectedSupplyVersion: 0,
      shiftId,
      posId: fx.posId,
      items: [{ productId: fx.productId, qty: 1, purchaseTotal: 100, costPrice: 100 }],
    }),
  })
  const supRow = (await fetchJson(`${api.base}/suppliers`)).body?.find(s => s.id === fx.supplierId)
  const spay = await fetchJson(`${api.base}/suppliers/${fx.supplierId}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}sup-pay`,
      amount: 100,
      payFrom: 'shift',
      method: 'cash',
      settlementMethod: 'cash',
      shiftId,
      expectedPayVersion: supRow?.payVersion ?? 0,
    }),
  })
  expect(spay.ok, 'supplier cash pay -100')
  const depRef = `${PREFIX}dep`
  await fetchJson(`${api.base}/finance/moves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: depRef,
      type: 'deposit',
      amount: 40,
      payFrom: 'shift',
      method: 'cash',
      shiftId,
    }),
  })
  const dep2 = await fetchJson(`${api.base}/finance/moves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: depRef,
      type: 'deposit',
      amount: 40,
      payFrom: 'shift',
      method: 'cash',
      shiftId,
    }),
  })
  expect(dep2.ok && dep2.body?.replayed, 'finance move replay')

  const saleCash = await fetchJson(`${api.base}/pos/sales`)
  const saleRow = (saleCash.body || []).find(s => s.clientRef === `${PREFIX}sale-cash`)
  const retRef = `${PREFIX}return`
  const ret1 = await fetchJson(`${api.base}/pos/sales/${saleRow.id}/return`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: retRef, items: [{ index: 0, qty: 0.3 }] }),
  })
  expect(ret1.ok && ret1.body?.durable === true, 'sale partial return durable')
  const ret2 = await fetchJson(`${api.base}/pos/sales/${saleRow.id}/return`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: retRef, items: [{ index: 0, qty: 0.3 }] }),
  })
  expect(ret2.ok && ret2.body?.replayed, 'sale return replay')

  const shMid = getShift(await fetchJson(`${api.base}/pos/shifts`), shiftId)
  expect(repay.ok, 'DEBT_REPAY_SUCCEEDED before till math')
  const manualJ = round2(
    (Number(shMid?.openingCash) || 0)
    + (Number(shMid?.salesCash) || 0)
    + (Number(shMid?.cashInTotal) || 0)
    - (Number(shMid?.expenseTotal) || 0),
  )
  expect(round2(shiftExpectedCash(shMid)) === manualJ, `J manual expected ${manualJ}`)
  expect(manualJ === 1040, `J scenario total 1040 (got ${manualJ})`)
  expect(round2(shiftExpectedCash(shMid)) === round2(expectedTillCashFromShift(shMid)), 'J SERVER_UI match')
  expect(!(Number(shMid.debtRepayCash) > 0 && round2(shiftExpectedCash(shMid)) !== manualJ), 'no debtRepayCash double-count')

  // H — vault convert durable
  const vault0 = await fetchJson(`${api.base}/finance/vault`)
  const vRef = `${PREFIX}vcc`
  const vcc = await fetchJson(`${api.base}/finance/vault/card-to-cash`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: vRef,
      amount: 30,
      expectedVaultVersion: vault0.body?.vaultVersion ?? 0,
    }),
  })
  expect(vcc.ok && vcc.body?.durable === true, 'vault card-to-cash durable')
  const profitBefore = (await fetchJson(`${api.base}/finance/profit`)).body?.summary?.revenue
  expect(round2(profitBefore) >= 270, 'transfer not revenue (profit from sales)')

  // G — finance move delete
  const finList = await fetchJson(`${api.base}/finance/moves`)
  const depMove = (finList.body || []).find(m => m.clientRef === depRef)
  const delRef = `${PREFIX}fin-del`
  const del1 = await fetchJson(`${api.base}/finance/moves/${depMove.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: delRef }),
  })
  expect(del1.ok && del1.body?.durable === true, 'finance move delete durable')

  // C — shift close
  const shPre = getShift(await fetchJson(`${api.base}/pos/shifts`), shiftId)
  const expectedClose = shiftExpectedCash(shPre)
  const closeRef = `${PREFIX}shift-close`
  const close1 = await fetchJson(`${api.base}/pos/shifts/${shiftId}/close`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: closeRef,
      closingCash: expectedClose,
      closingCard: round2(shPre.salesCard || 0),
    }),
  })
  expect(close1.ok && close1.body?.durable === true, 'shift close durable')
  const close2 = await fetchJson(`${api.base}/pos/shifts/${shiftId}/close`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: closeRef,
      closingCash: expectedClose,
      closingCard: round2(shPre.salesCard || 0),
    }),
  })
  expect(close2.ok && close2.body?.replayed, 'shift close replay')
  const transfers = await withClient(async (c) => {
    const r = await c.query(`SELECT value FROM kv_meta WHERE key='cashVault'`)
    const v = r.rows[0]?.value
    const transfers = v?.transfers || []
    return transfers.filter(t => String(t.shiftId) === String(shiftId)).length
  })
  expect(transfers === 1, 'single vault transfer on close')

  // ACK-lost replay (same ref after successful close path)
  const openRef2 = `${PREFIX}shift-open-ack`
  const ack1 = await fetchJson(`${api.base}/pos/shifts/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: openRef2,
      posId: fx.posId,
      cashierId: fx.cashierId,
      openingCash: 0,
    }),
  })
  expect(ack1.ok, 'second shift open after close')
  const ack2 = await fetchJson(`${api.base}/pos/shifts/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: openRef2,
      posId: fx.posId,
      cashierId: fx.cashierId,
      openingCash: 0,
    }),
  })
  expect(ack2.ok && ack2.body?.replayed, 'shift open ACK-lost style replay')

  // restart hydration
  killApi(api.child)
  await sleep(400)
  api = await startApi(PORT)
  const memDb = { posShifts: [] }
  await loadDocsIntoMemory(memDb, ['posShifts'])
  const memShift = memDb.posShifts.find(s => s.id === shiftId)
  const apiShift = getShift(await fetchJson(`${api.base}/pos/shifts`), shiftId)
  expect(memShift?.status === 'closed' && apiShift?.status === 'closed', 'restart closed shift')
  const pgShift = await withClient(async (c) => {
    const r = await c.query(`SELECT data FROM docs WHERE collection='posShifts' AND id=$1`, [String(shiftId)])
    return r.rows[0]?.data || null
  })
  expect(round2(Number(pgShift?.salesCash)) === round2(Number(apiShift?.salesCash)), 'restart PG shift salesCash')
  const pgClientDebt = await withClient(async (c) => {
    const r = await c.query(`SELECT data->>'debt' AS d FROM docs WHERE collection='clients' AND id=$1`, [String(cl.body.id)])
    return round2(Number(r.rows[0]?.d))
  })
  expect(pgClientDebt === 0, 'restart PG client debt 0 after repay')

} finally {
  killApi(api.child)
  await cleanupOnlineTestPrefixes([PREFIX])
  await closePool()
}

console.log(`\n=== ONLINE-O2B: ${passed} passed, ${failed} failed ===\n`)
process.exit(failed ? 1 : 0)
