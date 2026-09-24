/**
 * ONLINE-O1B — supplier accounting closure (real PG + API child).
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
import { opRefDocId, FIN_OP_KINDS, WH_OP_KINDS, loadDocsIntoMemory } from '../server/kakapo-api/pg/businessMutationTx.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const PREFIX = 'O1B-'

const REQUIRE = String(process.env.O1B_REAL_PG_REQUIRED || process.env.O1_REAL_PG_REQUIRED || '') === '1'
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
    await c.query(`DELETE FROM docs WHERE id LIKE $1`, [`${PREFIX}%`])
  })
}

async function countOpRef(kind, clientRef) {
  const id = opRefDocId(kind, clientRef)
  return withClient(async (c) => {
    const r = await c.query(`SELECT COUNT(*)::int AS n FROM docs WHERE collection='opRefs' AND id=$1`, [id])
    return r.rows[0]?.n || 0
  })
}

async function setChaos(base, point) {
  return fetchJson(`${base}/__o8/chaos/hold-at`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ point }),
  })
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
  let shift = await fetchJson(`${base}/pos/shifts/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      posId,
      cashierId,
      cashierName: `${PREFIX}Cashier`,
      openingCash: 50000,
      clientRef: `${PREFIX}shift-${Date.now()}`,
    }),
  })
  if (!shift.ok) {
    const open = await fetchJson(`${base}/pos/shifts`)
    shift = { ok: true, body: (open.body || []).find(s => s.status === 'open') }
  }
  await fetchJson(`${base}/stock/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}seed-rec`,
      supplierId: sup.body?.id,
      expectedSupplyVersion: 0,
      items: [{ productId: prod.body?.id, qty: 1, purchaseTotal: 50000, costPrice: 50000 }],
    }),
  })
  return {
    supplierId: sup.body?.id,
    productId: prod.body?.id,
    shiftId: shift.body?.id,
    posId: shift.body?.posId || posId,
  }
}

async function getSupplier(base, id) {
  const r = await fetchJson(`${base}/suppliers`)
  return (r.body || []).find(s => s.id === id)
}

async function payBook(base, fx, amount, clientRef, expectedPayVersion) {
  return fetchJson(`${base}/suppliers/${fx.supplierId}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef, amount, expectedPayVersion, settlementMethod: 'adjustment' }),
  })
}

async function injectLegacyPaidNowReceipt(c, fx) {
  const receiptId = `${PREFIX}LEG-REC`
  const paidNow = 200
  const total = 1000
  const receipt = {
    id: receiptId,
    supplierId: fx.supplierId,
    supplierName: `${PREFIX}Sup`,
    totalCost: total,
    paidNow,
    debtAdded: total - paidNow,
    payFrom: 'shift',
    method: 'cash',
    shiftId: fx.shiftId,
    createdAtIso: new Date().toISOString(),
    items: [{
      productId: fx.productId,
      productName: `${PREFIX}P`,
      qty: 1,
      remainingQty: 1,
      costPrice: total,
      purchaseTotal: total,
    }],
  }
  const ledgerId = `${PREFIX}LEG-LED`
  const ledger = {
    id: ledgerId,
    type: 'purchase_pay',
    amount: paidNow,
    direction: 'out',
    cashAffect: true,
    shiftId: fx.shiftId,
    refType: 'receipt',
    refId: receiptId,
    createdAtIso: new Date().toISOString(),
  }
  await c.query(`DELETE FROM docs WHERE id IN ($1, $2)`, [receiptId, ledgerId])
  await c.query(
    `INSERT INTO docs (collection, id, data, sort_idx, updated_at) VALUES ('stockReceipts', $1, $2::jsonb, 0, now())`,
    [receiptId, JSON.stringify(receipt)],
  )
  await c.query(
    `INSERT INTO docs (collection, id, data, sort_idx, updated_at) VALUES ('moneyLedger', $1, $2::jsonb, 0, now())`,
    [ledgerId, JSON.stringify(ledger)],
  )
  const supRow = await c.query(`SELECT data FROM docs WHERE collection='suppliers' AND id=$1`, [fx.supplierId])
  const sup = supRow.rows[0]?.data || {}
  sup.totalSupplied = round2((Number(sup.totalSupplied) || 0) + total)
  sup.totalPaid = round2((Number(sup.totalPaid) || 0) + paidNow)
  sup.payableAmount = round2(Math.max(0, sup.totalSupplied - sup.totalPaid))
  sup.supplyVersion = (Number(sup.supplyVersion) || 0) + 1
  await c.query(
    `UPDATE docs SET data=$2::jsonb, updated_at=now() WHERE collection='suppliers' AND id=$1`,
    [fx.supplierId, JSON.stringify(sup)],
  )
  const prodRow = await c.query(`SELECT data FROM docs WHERE collection='products' AND id=$1`, [String(fx.productId)])
  const prod = prodRow.rows[0]?.data || {}
  prod.stock = round2((Number(prod.stock) || 0) + 1)
  await c.query(
    `UPDATE docs SET data=$2::jsonb, updated_at=now() WHERE collection='products' AND id=$1`,
    [String(fx.productId), JSON.stringify(prod)],
  )
  return { receiptId, paidNow, total }
}

console.log(`\n=== ONLINE-O1B REAL_PG=${REAL_PG} REQUIRED=${REQUIRE} ===`)
if (REQUIRE && !REAL_PG) {
  console.error('FAIL: O1B_REAL_PG_REQUIRED=1 but DATABASE_URL missing')
  process.exit(1)
}
if (!REAL_PG) {
  console.log('  SKIP (no DATABASE_URL)')
  process.exit(0)
}

await ensureSchema()
const id = await pgIdentity()
console.log(`  INFO database=${id.db} user=${id.usr}`)
expect(id.db === 'kakapo_l11_test' || process.env.O8_ALLOW_NON_L11_DB === '1', 'O1B PG identity')
await cleanupPg()

const PORT = 18120 + Math.floor(Math.random() * 80)
let api = await startApi(PORT)
const fx = await seed(api.base)

try {
  // B — block finance supplier double path
  const supB = await getSupplier(api.base, fx.supplierId)
  const payVer = supB?.payVersion ?? 0
  const canonRef = `${PREFIX}canon-500`
  const okPay = await payBook(api.base, fx, 500, canonRef, payVer)
  expect(okPay.ok, 'canonical supplier payment 500')
  const finBlock = await fetchJson(`${api.base}/finance/moves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}fin-dup`,
      type: 'withdraw',
      amount: 500,
      supplierId: fx.supplierId,
      payFrom: 'shift',
      method: 'cash',
      shiftId: fx.shiftId,
    }),
  })
  expect(
    finBlock.status === 409
    && (finBlock.body?.code === 'SUPPLIER_PAY_USE_SUPPLIERS_ENDPOINT'
      || String(finBlock.body?.detail || '').includes('Поставщики')),
    'finance supplier withdraw blocked',
  )

  // G — history dedupe vs totalPaid
  const supG = await getSupplier(api.base, fx.supplierId)
  const hist = await fetchJson(`${api.base}/suppliers/${fx.supplierId}/payments`)
  const sumHist = round2((hist.body || []).reduce((s, p) => s + (Number(p.amount) || 0), 0))
  expect(round2(supG?.totalPaid) === sumHist, 'supplier history sum equals totalPaid')

  // A — payment reversal durable
  const pays = hist.body || []
  const payRow = pays.find(p => p.clientRef === canonRef)
  expect(!!payRow?.id, 'payment row for reversal')
  const delRef = `${PREFIX}rev-1`
  const supBeforeRev = await getSupplier(api.base, fx.supplierId)
  const paidBefore = round2(supBeforeRev?.totalPaid || 0)
  const d1 = await fetchJson(`${api.base}/suppliers/${fx.supplierId}/payments/${payRow.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: delRef, expectedPayVersion: supBeforeRev?.payVersion ?? 0 }),
  })
  expect(d1.ok && d1.body?.durable === true, 'reversal NORMAL durable')
  const opDel = await countOpRef(FIN_OP_KINDS.SUPPLIER_PAYMENT_DELETE, delRef)
  expect(opDel === 1, 'reversal PG opRef')
  const d2 = await fetchJson(`${api.base}/suppliers/${fx.supplierId}/payments/${payRow.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: delRef, expectedPayVersion: supBeforeRev?.payVersion ?? 0 }),
  })
  expect(d2.ok && d2.body?.replayed, 'reversal same-ref replay')
  const supAfterRev = await getSupplier(api.base, fx.supplierId)
  expect(round2(paidBefore - (supAfterRev?.totalPaid || 0)) === 500, 'reversal totalPaid -500 once')

  // precommit reversal kill
  const supP = await getSupplier(api.base, fx.supplierId)
  const p2 = await payBook(api.base, fx, 50, `${PREFIX}pre-rev-pay`, supP?.payVersion ?? 0)
  const pay2 = p2.body
  const revPreRef = `${PREFIX}pre-rev-del`
  await setChaos(api.base, 'before_commit')
  const killP = fetchJson(`${api.base}/suppliers/${fx.supplierId}/payments/${pay2.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: revPreRef, expectedPayVersion: (await getSupplier(api.base, fx.supplierId))?.payVersion ?? 0 }),
  }).catch(() => ({ ok: false }))
  await sleep(800)
  killApi(api.child)
  await killP
  expect(await countOpRef(FIN_OP_KINDS.SUPPLIER_PAYMENT_DELETE, revPreRef) === 0, 'reversal precommit zero opRef')
  api = await startApi(PORT)

  // postcommit reversal kill
  const supPost = await getSupplier(api.base, fx.supplierId)
  const p3 = await payBook(api.base, fx, 15, `${PREFIX}post-rev-pay`, supPost?.payVersion ?? 0)
  const revDelPostRef = `${PREFIX}post-rev-del`
  await setChaos(api.base, 'after_commit_before_response')
  const supAfterP3 = await getSupplier(api.base, fx.supplierId)
  const payVerPost = supAfterP3?.payVersion ?? 0
  const postP = fetchJson(`${api.base}/suppliers/${fx.supplierId}/payments/${p3.body.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: revDelPostRef, expectedPayVersion: payVerPost }),
  }).catch(() => ({ ok: false }))
  await sleep(1200)
  expect(await countOpRef(FIN_OP_KINDS.SUPPLIER_PAYMENT_DELETE, revDelPostRef) === 1, 'reversal postcommit committed')
  killApi(api.child)
  await postP
  api = await startApi(PORT)
  await fetchJson(`${api.base}/__o8/chaos/release`, { method: 'POST' })
  const postRetry = await fetchJson(`${api.base}/suppliers/${fx.supplierId}/payments/${p3.body.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: revDelPostRef, expectedPayVersion: payVerPost }),
  })
  expect(
    postRetry.ok && (postRetry.body?.replayed || postRetry.body?.duplicate),
    'reversal postcommit replay',
  )

  // Receipt delete chaos
  const recDel = await fetchJson(`${api.base}/stock/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}del-rec`,
      supplierId: fx.supplierId,
      expectedSupplyVersion: (await getSupplier(api.base, fx.supplierId))?.supplyVersion ?? 1,
      items: [{ productId: fx.productId, qty: 1, purchaseTotal: 100, costPrice: 100 }],
    }),
  })
  const delRecId = recDel.body?.id
  const recDelPreRef = `${PREFIX}del-pre`
  await setChaos(api.base, 'before_commit')
  fetchJson(`${api.base}/stock/receipts/${delRecId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: recDelPreRef }),
  }).catch(() => {})
  await sleep(800)
  killApi(api.child)
  await sleep(200)
  expect(await countOpRef(WH_OP_KINDS.STOCK_RECEIPT_DELETE, recDelPreRef) === 0, 'delete precommit no opRef')
  api = await startApi(PORT)
  await fetchJson(`${api.base}/__o8/chaos/release`, { method: 'POST' })

  const recDelPostRef = `${PREFIX}del-post`
  await setChaos(api.base, 'after_commit_before_response')
  fetchJson(`${api.base}/stock/receipts/${delRecId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: recDelPostRef }),
  }).catch(() => {})
  await sleep(1200)
  expect(await countOpRef(WH_OP_KINDS.STOCK_RECEIPT_DELETE, recDelPostRef) === 1, 'delete postcommit opRef')
  killApi(api.child)
  await sleep(200)
  api = await startApi(PORT)
  await fetchJson(`${api.base}/__o8/chaos/release`, { method: 'POST' })
  const delReplay = await fetchJson(`${api.base}/stock/receipts/${delRecId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: recDelPostRef }),
  })
  expect(delReplay.ok && (delReplay.body?.replayed || delReplay.body?.duplicate), 'delete postcommit replay')

  // E — receipt edit chaos
  const recEdit = await fetchJson(`${api.base}/stock/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}edit-rec`,
      supplierId: fx.supplierId,
      expectedSupplyVersion: (await getSupplier(api.base, fx.supplierId))?.supplyVersion ?? 1,
      items: [{ productId: fx.productId, qty: 1, purchaseTotal: 900, costPrice: 900 }],
    }),
  })
  const editId = recEdit.body?.id
  const editRef = `${PREFIX}edit-upd`
  await setChaos(api.base, 'before_commit')
  fetchJson(`${api.base}/stock/receipts/${editId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: editRef,
      supplierId: fx.supplierId,
      expectedSupplyVersion: (await getSupplier(api.base, fx.supplierId))?.supplyVersion ?? 2,
      items: [{ productId: fx.productId, qty: 1, purchaseTotal: 700, costPrice: 700 }],
    }),
  }).catch(() => {})
  await sleep(800)
  killApi(api.child)
  await sleep(300)
  expect(await countOpRef(WH_OP_KINDS.STOCK_RECEIPT_UPDATE, editRef) === 0, 'edit precommit no opRef')
  api = await startApi(PORT)
  await fetchJson(`${api.base}/__o8/chaos/release`, { method: 'POST' })

  const editPostRef = `${PREFIX}edit-post`
  await setChaos(api.base, 'after_commit_before_response')
  const editPostP = fetchJson(`${api.base}/stock/receipts/${editId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: editPostRef,
      supplierId: fx.supplierId,
      expectedSupplyVersion: (await getSupplier(api.base, fx.supplierId))?.supplyVersion ?? 2,
      items: [{ productId: fx.productId, qty: 1, purchaseTotal: 650, costPrice: 650 }],
    }),
  }).catch(() => ({ ok: false }))
  await sleep(1200)
  expect(await countOpRef(WH_OP_KINDS.STOCK_RECEIPT_UPDATE, editPostRef) === 1, 'edit postcommit opRef')
  killApi(api.child)
  await editPostP
  api = await startApi(PORT)
  await fetchJson(`${api.base}/__o8/chaos/release`, { method: 'POST' })
  const editReplay = await fetchJson(`${api.base}/stock/receipts/${editId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: editPostRef,
      supplierId: fx.supplierId,
      expectedSupplyVersion: (await getSupplier(api.base, fx.supplierId))?.supplyVersion ?? 2,
      items: [{ productId: fx.productId, qty: 1, purchaseTotal: 650, costPrice: 650 }],
    }),
  })
  expect(editReplay.ok && editReplay.body?.replayed, 'edit postcommit replay')

  // F — legacy paidNow delete
  killApi(api.child)
  await closePool()
  const leg = await withClient(async (c) => injectLegacyPaidNowReceipt(c, fx))
  api = await startApi(PORT)
  const supLegBefore = await getSupplier(api.base, fx.supplierId)
  const paidLeg = round2(supLegBefore?.totalPaid || 0)
  const delLeg = await fetchJson(`${api.base}/stock/receipts/${leg.receiptId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: `${PREFIX}leg-del` }),
  })
  expect(delLeg.ok, 'legacy receipt delete ok')
  const supLegAfter = await getSupplier(api.base, fx.supplierId)
  expect(round2(paidLeg - (supLegAfter?.totalPaid || 0)) === leg.paidNow, 'legacy totalPaid reduced once')
  expect(round2(supLegAfter?.totalPaid || 0) >= 0, 'legacy totalPaid non-negative')

  // restart memory == PG for supplier
  const memDb = { suppliers: [], supplierPayments: [] }
  await loadDocsIntoMemory(memDb, ['suppliers', 'supplierPayments'])
  const memSup = memDb.suppliers.find(s => s.id === fx.supplierId)
  expect(round2(memSup?.totalPaid) === round2(supLegAfter?.totalPaid), 'restart memory PG supplier totalPaid')

} finally {
  killApi(api.child)
  await closePool()
}

console.log(`\n=== ONLINE-O1B: ${passed} passed, ${failed} failed ===\n`)
process.exit(failed ? 1 : 0)
