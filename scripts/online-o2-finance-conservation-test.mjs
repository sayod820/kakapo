/**
 * ONLINE-O2 — finance / cash / shift conservation (real PG + API child).
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
import { loadDocsIntoMemory } from '../server/kakapo-api/pg/businessMutationTx.js'
import { shiftExpectedCash } from '../server/kakapo-api/financeTruth.js'
import { FIN_OP_KINDS } from '../server/kakapo-api/pg/businessMutationTx.js'
import { opRefDocId } from '../server/kakapo-api/pg/businessMutationTx.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const PREFIX = 'O2-'

const REQUIRE = String(process.env.O2_REAL_PG_REQUIRED || process.env.O1_REAL_PG_REQUIRED || '') === '1'
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
      stock: 50,
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
  let shiftBody = shift.body
  if (!shift.ok) {
    const open = await fetchJson(`${base}/pos/shifts`)
    shiftBody = (open.body || []).find(s => s.status === 'open' && s.posId === posId)
  }
  return {
    productId: prod.body?.id,
    shiftId: shiftBody?.id,
    posId: shiftBody?.posId || posId,
    cashierId,
  }
}

function getShift(shifts, id) {
  return (shifts.body || []).find(s => s.id === id)
}

console.log(`\n=== ONLINE-O2 REAL_PG=${REAL_PG} REQUIRED=${REQUIRE} ===`)
if (REQUIRE && !REAL_PG) {
  console.error('FAIL: O2_REAL_PG_REQUIRED=1 but DATABASE_URL missing')
  process.exit(1)
}
if (!REAL_PG) {
  console.log('  SKIP (no DATABASE_URL)')
  process.exit(0)
}

await ensureSchema()
const id = await pgIdentity()
console.log(`  INFO database=${id.db} user=${id.usr}`)
expect(id.db === 'kakapo_l11_test' || process.env.O8_ALLOW_NON_L11_DB === '1', 'O2 PG identity')
await cleanupPg()

const PORT = 18200 + Math.floor(Math.random() * 50)
let api = await startApi(PORT)
const fx = await seed(api.base)

try {
  // C — cash sale conservation
  const sh0 = getShift(await fetchJson(`${api.base}/pos/shifts`), fx.shiftId)
  const exp0 = shiftExpectedCash(sh0)
  const sc0 = round2(sh0?.salesCash || 0)
  const saleRef = `${PREFIX}sale-cash`
  const sale = await fetchJson(`${api.base}/pos/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: saleRef,
      shiftId: fx.shiftId,
      posId: fx.posId,
      paymentMethod: 'cash',
      total: 100,
      paidCash: 100,
      items: [{ productId: fx.productId, qty: 1, price: 100, lineTotal: 100 }],
    }),
  })
  expect(sale.ok, 'cash sale ok')
  const sh1 = getShift(await fetchJson(`${api.base}/pos/shifts`), fx.shiftId)
  expect(round2(sh1.salesCash) - sc0 === 100, 'cash sale +salesCash 100')
  expect(shiftExpectedCash(sh1) - exp0 === 100, 'shift expected cash +100')
  const saleId = sale.body?.id
  await sleep(200)
  const journal = await fetchJson(`${api.base}/finance/journal?limit=200`)
  const ledRows = (journal.body?.rows || []).filter(r =>
    r.type === 'sale_cash' && (r.clientRef === saleRef || r.refId === saleId),
  )
  expect(ledRows.length >= 1, 'one sale_cash ledger (journal)')

  // D — card sale, physical cash unchanged
  const expBeforeCard = shiftExpectedCash(sh1)
  const card0 = round2(sh1.salesCard || 0)
  const cardSaleRef = `${PREFIX}sale-card`
  const cardSale = await fetchJson(`${api.base}/pos/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: cardSaleRef,
      shiftId: fx.shiftId,
      paymentMethod: 'card',
      total: 200,
      paidCard: 200,
      items: [{ productId: fx.productId, qty: 1, price: 200, lineTotal: 200 }],
    }),
  })
  expect(cardSale.ok, 'card sale ok')
  const sh2 = getShift(await fetchJson(`${api.base}/pos/shifts`), fx.shiftId)
  expect(shiftExpectedCash(sh2) - expBeforeCard === 0, 'card sale: expected cash unchanged')
  expect(round2(sh2.salesCard) - card0 === 200, 'card sale +salesCard 200')

  // G — expense cash O8 durable + idempotency
  const expRef = `${PREFIX}exp-cash`
  const sh3 = getShift(await fetchJson(`${api.base}/pos/shifts`), fx.shiftId)
  const expTot0 = round2(sh3.expenseTotal || 0)
  const e1 = await fetchJson(`${api.base}/expenses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: expRef,
      amount: 20,
      category: 'O2',
      payFrom: 'shift',
      method: 'cash',
      shiftId: fx.shiftId,
    }),
  })
  expect(e1.ok && e1.body?.durable === true, 'expense create durable')
  const e2 = await fetchJson(`${api.base}/expenses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: expRef,
      amount: 20,
      category: 'O2',
      payFrom: 'shift',
      method: 'cash',
      shiftId: fx.shiftId,
    }),
  })
  expect(e2.ok && e2.body?.replayed, 'expense replay')
  const sh4 = getShift(await fetchJson(`${api.base}/pos/shifts`), fx.shiftId)
  expect(round2(sh4.expenseTotal) - expTot0 === 20, 'expense +expenseTotal once')
  const ledExp = await withClient(async (c) => {
    const r = await c.query(
      `SELECT COUNT(*)::int AS n FROM docs WHERE collection='moneyLedger'
       AND data->>'clientRef'=$1 AND data->>'type'='expense'`,
      [expRef],
    )
    return r.rows[0]?.n || 0
  })
  expect(ledExp === 1, 'one expense ledger')
  const opExp = await withClient(async (c) => {
    const id = opRefDocId(FIN_OP_KINDS.EXPENSE_CREATE, expRef)
    const r = await c.query(`SELECT COUNT(*)::int AS n FROM docs WHERE collection='opRefs' AND id=$1`, [id])
    return r.rows[0]?.n || 0
  })
  expect(opExp === 1, 'expense opRef')

  // F — finance deposit cash (cashInTotal)
  const depRef = `${PREFIX}fin-dep`
  const cin0 = round2(sh4.cashInTotal || 0)
  const dep = await fetchJson(`${api.base}/finance/moves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: depRef,
      type: 'deposit',
      amount: 40,
      payFrom: 'shift',
      method: 'cash',
      shiftId: fx.shiftId,
    }),
  })
  expect(dep.ok, 'finance deposit ok')
  const sh5 = getShift(await fetchJson(`${api.base}/pos/shifts`), fx.shiftId)
  expect(round2(sh5.cashInTotal) - cin0 === 40, 'deposit +cashInTotal 40')

  // M — transfer not revenue (vault card→cash info ledger; uses open-shift salesCard pool)
  const vaultBefore = await fetchJson(`${api.base}/finance/vault`)
  const trRef = `${PREFIX}vcc-${Date.now()}`
  const tr = await fetchJson(`${api.base}/finance/vault/card-to-cash`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: trRef,
      amount: 30,
      expectedVaultVersion: vaultBefore.body?.vaultVersion ?? 0,
    }),
  })
  expect(tr.ok, `vault card-to-cash ok (${tr.status} ${tr.body?.detail || ''})`)
  const ledVcc = await withClient(async (c) => {
    const r = await c.query(
      `SELECT COUNT(*)::int AS n FROM docs WHERE collection='moneyLedger'
       AND data->>'type'='vault_card_to_cash'
       AND (data->>'clientRef'=$1 OR data->>'refId'=$2)`,
      [trRef, tr.body?.id || ''],
    )
    return r.rows[0]?.n || 0
  })
  expect(ledVcc >= 1, 'transfer ledger row in PG')
  const truth = await fetchJson(`${api.base}/finance/truth`)
  const transferRows = (truth.body?.journal || []).filter(j =>
    j.type === 'vault_card_to_cash' && (j.refId === tr.body?.id || j.clientRef === trRef),
  )
  expect(transferRows.length === 0 || transferRows.every(r => !r.cashAffect || r.signedAmount === 0), 'transfer not cash book outflow')

  // S — profit from sales not double-counted with ledger
  const profit = truth.body?.profit?.summary?.revenue
  expect(round2(profit) >= 300, 'profit revenue from posSales >= 300 (100+200)')

  // T — restart hydration shift fields
  killApi(api.child)
  await sleep(400)
  api = await startApi(PORT)
  const memDb = { posShifts: [], moneyLedger: [], expenses: [] }
  await loadDocsIntoMemory(memDb, ['posShifts', 'moneyLedger', 'expenses'])
  const memShift = memDb.posShifts.find(s => s.id === fx.shiftId)
  const apiShift = getShift(await fetchJson(`${api.base}/pos/shifts`), fx.shiftId)
  expect(round2(memShift?.salesCash) === round2(apiShift?.salesCash), 'restart salesCash match')
  expect(round2(memShift?.expenseTotal) === round2(apiShift?.expenseTotal), 'restart expenseTotal match')

} finally {
  killApi(api.child)
  await closePool()
}

console.log(`\n=== ONLINE-O2: ${passed} passed, ${failed} failed ===\n`)
process.exit(failed ? 1 : 0)
