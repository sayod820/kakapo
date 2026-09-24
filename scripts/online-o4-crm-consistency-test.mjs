/**
 * ONLINE-O4 — CRM / debt / loyalty consistency (real PG + API).
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
import { opRefDocId, CRM_OP_KINDS } from '../server/kakapo-api/pg/businessMutationTx.js'
import {
  cleanupOnlineTestPrefixes,
  bootstrapTestLabCashVault,
} from './online-test-db-cleanup.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const PREFIX = 'O4-'

const REQUIRE = String(process.env.O4_REAL_PG_REQUIRED || process.env.O8_REAL_PG_REQUIRED || '') === '1'
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
  return new Promise((resolve) => {
    if (!child || child.killed) return resolve()
    const done = () => resolve()
    child.once('exit', done)
    try { child.kill('SIGKILL') } catch { /* ignore */ }
    setTimeout(done, 3000)
  })
}

async function openShift(base, posId, cashierId) {
  const openList = await fetchJson(`${base}/pos/shifts?status=open`)
  const existing = (openList.body || []).find(s => String(s.status) === 'open')
  if (existing?.id) return existing.id
  const sh = await fetchJson(`${base}/pos/shifts/open`, {
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
  if (!sh.ok) {
    throw new Error(`shift ${sh.status} ${sh.body?.detail || JSON.stringify(sh.body)}`)
  }
  return sh.body.id
}

async function seedProduct(base) {
  const points = await fetchJson(`${base}/pos/points`)
  const posId = points.body?.[0]?.id
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
  if (!cashierId) throw new Error('seed: no cashier')
  const prod = await fetchJson(`${base}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `${PREFIX}P-${Date.now()}`,
      price: 100,
      costPrice: 50,
      stock: 100,
      clientRef: `${PREFIX}prod-${Date.now()}`,
    }),
  })
  if (!prod.ok) throw new Error('product')
  await fetchJson(`${base}/stock/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}rec-${Date.now()}`,
      paidNow: 0,
      items: [{ productId: prod.body.id, qty: 100, purchaseTotal: 5000, costPrice: 50 }],
    }),
  })
  const shiftId = await openShift(base, posId, cashierId)
  return { productId: prod.body.id, shiftId, posId, cashierId }
}

async function ensureClientCard(base, ts) {
  const phone = `998${String(ts).slice(-9)}`
  const cardNum = `${PREFIX}C${String(ts).slice(-6)}`
  const cl = await fetchJson(`${base}/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `${PREFIX}Client`,
      phone,
      clientRef: `${PREFIX}cli-${ts}`,
    }),
  })
  expect(cl.ok, 'create client')
  await fetchJson(`${base}/cards/ensure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ num: cardNum, client: cl.body.name, phone, status: 'active', debtEnabled: true }),
  })
  await fetchJson(`${base}/clients/${cl.body.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card: cardNum, clientRef: `${PREFIX}link-${ts}` }),
  })
  const client = (await fetchJson(`${base}/clients`)).body?.find(c => c.id === cl.body.id)
  const card = await getCard(base, cardNum)
  return { client, cardNum, card, phone }
}

function mirrorOk(client, card) {
  if (!client || !card) return false
  return round2(client.debt) === round2(card.debt) && round2(client.bonus) === round2(card.bonus)
}

async function getCard(base, cardNum) {
  const all = await fetchJson(`${base}/cards`)
  return (all.body || []).find(c => String(c.num || '').toUpperCase() === String(cardNum).toUpperCase()) || null
}

async function refreshCrm(base, clientId, cardNum) {
  const clients = await fetchJson(`${base}/clients`)
  const client = (clients.body || []).find(c => c.id === clientId) || null
  const card = await getCard(base, cardNum)
  return { client, card }
}

async function debtLedger(base, phone) {
  const r = await fetchJson(`${base}/debt/ledger?phone=${encodeURIComponent(phone)}`)
  return r.body?.ledger || r.body?.entries || r.body || []
}

async function main() {
  console.log('ONLINE-O4 CRM / debt / loyalty consistency\n')
  if (!REAL_PG) {
    if (REQUIRE) { failed += 1; console.error('  FAIL PG required') }
    console.log(`\nO4: ${passed} passed, ${failed} failed`)
    process.exit(failed ? 1 : 0)
  }

  await ensureSchema()
  await cleanupOnlineTestPrefixes([PREFIX])
  await bootstrapTestLabCashVault()
  const port = 18904 + Math.floor(Math.random() * 200)
  let api = await startApi(port)
  const { base } = api

  try {
    const fx = await seedProduct(base)
    const RUN_ID = String(process.env.ONLINE_RUN_ID || Date.now())
    const ts = RUN_ID
    const cref = (suffix) => `${PREFIX}${RUN_ID}-${suffix}`
    let { client, cardNum, card, phone } = await ensureClientCard(base, ts)

    // V — PATCH bypass blocked
    const patchDebt = await fetchJson(`${base}/clients/${client.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ debt: 999, clientRef: cref('patch-debt') }),
    })
    expect(patchDebt.status === 400 && patchDebt.body?.code === 'DEBT_REQUIRES_ADJUSTMENT_OPERATION', 'PATCH client debt blocked')
    const patchBonus = await fetchJson(`${base}/cards/${encodeURIComponent(cardNum)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bonus: 999, clientRef: cref('patch-bonus') }),
    })
    expect(patchBonus.status === 400 && patchBonus.body?.code === 'BONUS_REQUIRES_ADJUSTMENT_OPERATION', 'PATCH card bonus blocked')

    // W/X — audited bonus adjustment
    const adjB = await fetchJson(`${base}/cards/${encodeURIComponent(cardNum)}/bonus-adjustments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRef: cref('badj'), targetBonus: 100, reason: `${PREFIX}seed bonus` }),
    })
    expect(adjB.ok && adjB.body?.durable !== false, `bonus adjustment durable (${adjB.status} ${adjB.body?.detail || ''})`)
    ;({ client, card } = await refreshCrm(base, client.id, cardNum))
    expect(mirrorOk(client, card) && round2(client.bonus) === 100, 'mirror after bonus adj')

    // Two debt sales → receipts A=100 B=200
    const saleA = await fetchJson(`${base}/pos/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRef: cref('sale-a'),
        shiftId: fx.shiftId,
        posId: fx.posId,
        clientPhone: phone,
        cardNum,
        paymentMethod: 'cash',
        total: 100,
        paidCash: 0,
        debtAdded: 100,
        expectedDebtPayVersion: card.debtPayVersion ?? 0,
        items: [{ productId: fx.productId, qty: 1, price: 100, lineTotal: 100 }],
      }),
    })
    expect(saleA.ok, 'debt sale A')
    const orderA = saleA.body?.orderId
    ;({ client, card } = await refreshCrm(base, client.id, cardNum))
    expect(mirrorOk(client, card) && round2(client.debt) === 100, 'mirror after sale A debt 100')

    const saleB = await fetchJson(`${base}/pos/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRef: cref('sale-b'),
        shiftId: fx.shiftId,
        posId: fx.posId,
        clientPhone: phone,
        cardNum,
        paymentMethod: 'cash',
        total: 200,
        paidCash: 0,
        debtAdded: 200,
        expectedDebtPayVersion: card.debtPayVersion ?? 0,
        items: [{ productId: fx.productId, qty: 1, price: 200, lineTotal: 200 }],
      }),
    })
    expect(saleB.ok, 'debt sale B')
    const orderB = saleB.body?.orderId
    ;({ client, card } = await refreshCrm(base, client.id, cardNum))
    expect(round2(client.debt) === 300, 'total debt 300')

    // E — repay 50 against B only
    const repayB = await fetchJson(`${base}/cards/${encodeURIComponent(cardNum)}/debt-repay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRef: cref('repay-b50'),
        amount: 50,
        method: 'cash',
        shiftId: fx.shiftId,
        posId: fx.posId,
        orderId: orderB,
        expectedDebtPayVersion: card.debtPayVersion ?? 0,
      }),
    })
    expect(repayB.ok, 'repay 50 on receipt B')
    const led = await debtLedger(base, phone)
    const rowA = led.find(e => String(e.orderId) === String(orderA))
    const rowB = led.find(e => String(e.orderId) === String(orderB))
    expect(round2(rowA?.remaining) === 100, 'receipt A still 100')
    expect(round2(rowB?.remaining) === 150, `receipt B 150 (${rowB?.remaining})`)
    ;({ client, card } = await refreshCrm(base, client.id, cardNum))
    expect(round2(client.debt) === 250, 'client debt 250')

    // G — overpay targeted receipt rejected
    const over = await fetchJson(`${base}/cards/${encodeURIComponent(cardNum)}/debt-repay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRef: cref('overpay'),
        amount: 200,
        method: 'cash',
        shiftId: fx.shiftId,
        orderId: orderB,
        expectedDebtPayVersion: card.debtPayVersion ?? 0,
      }),
    })
    expect(!over.ok && (over.body?.code === 'DEBT_RECEIPT_OVERPAY' || over.status === 400), 'targeted overpay rejected')

    // H — cash advance 100
    const adv = await fetchJson(`${base}/cards/${encodeURIComponent(cardNum)}/cash-advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRef: cref('adv100'),
        amount: 100,
        shiftId: fx.shiftId,
        posId: fx.posId,
        expectedDebtPayVersion: card.debtPayVersion ?? 0,
      }),
    })
    expect(adv.ok, 'cash advance 100')
    ;({ client, card } = await refreshCrm(base, client.id, cardNum))
    expect(round2(client.debt) === 350, 'debt after advance 350')
    expect(mirrorOk(client, card), 'mirror after advance')

    // Cash repay 200 (partial)
    const repay200 = await fetchJson(`${base}/cards/${encodeURIComponent(cardNum)}/debt-repay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRef: cref('repay200'),
        amount: 200,
        method: 'cash',
        shiftId: fx.shiftId,
        expectedDebtPayVersion: card.debtPayVersion ?? 0,
      }),
    })
    expect(repay200.ok, 'repay 200 FIFO')
    ;({ client, card } = await refreshCrm(base, client.id, cardNum))
    expect(round2(client.debt) === 150, 'debt after repay 200 → 150')

    // N — bonus spend with version
    const spend60 = await fetchJson(`${base}/pos/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRef: cref('bonus-spend'),
        shiftId: fx.shiftId,
        posId: fx.posId,
        clientPhone: phone,
        cardNum,
        paymentMethod: 'cash',
        total: 60,
        paidCash: 0,
        bonusSpent: 60,
        expectedBonusPayVersion: card.bonusPayVersion ?? 0,
        items: [{ productId: fx.productId, qty: 1, price: 60, lineTotal: 60 }],
      }),
    })
    expect(spend60.ok, `bonus spend 60 (${spend60.status} ${spend60.body?.detail || ''})`)
    ;({ client, card } = await refreshCrm(base, client.id, cardNum))
    expect(mirrorOk(client, card) && round2(client.bonus) === 40 && round2(card.bonus) === 40, `bonus 40 after spend (got ${client?.bonus})`)

    // Concurrent bonus spend race
    const ver = card.bonusPayVersion ?? 0
    const [s1, s2] = await Promise.all([
      fetchJson(`${base}/pos/sales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientRef: `${PREFIX}bon-r1-${ts}`,
          shiftId: fx.shiftId,
          posId: fx.posId,
          clientPhone: phone,
          cardNum,
          paymentMethod: 'cash',
          total: 35,
          paidCash: 0,
          bonusSpent: 35,
          expectedBonusPayVersion: ver,
          items: [{ productId: fx.productId, qty: 1, price: 35, lineTotal: 35 }],
        }),
      }),
      fetchJson(`${base}/pos/sales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientRef: `${PREFIX}bon-r2-${ts}`,
          shiftId: fx.shiftId,
          posId: fx.posId,
          clientPhone: phone,
          cardNum,
          paymentMethod: 'cash',
          total: 35,
          paidCash: 0,
          bonusSpent: 35,
          expectedBonusPayVersion: ver,
          items: [{ productId: fx.productId, qty: 1, price: 35, lineTotal: 35 }],
        }),
      }),
    ])
    const wins = [s1, s2].filter(r => r.ok && !r.body?.replayed).length
    expect(wins <= 1, `concurrent bonus spend at most one (${wins})`)
    ;({ client, card } = await refreshCrm(base, client.id, cardNum))
    expect(round2(client.bonus) >= 0, 'bonus non-negative after race')

    // Debt repay concurrency
    ;({ client, card } = await refreshCrm(base, client.id, cardNum))
    const dVer = card.debtPayVersion ?? 0
    const debtBefore = round2(client.debt)
    const [d1, d2] = await Promise.all([
      fetchJson(`${base}/cards/${encodeURIComponent(cardNum)}/debt-repay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientRef: `${PREFIX}dr1-${ts}`,
          amount: Math.min(700, debtBefore),
          method: 'cash',
          shiftId: fx.shiftId,
          expectedDebtPayVersion: dVer,
        }),
      }),
      fetchJson(`${base}/cards/${encodeURIComponent(cardNum)}/debt-repay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientRef: `${PREFIX}dr2-${ts}`,
          amount: Math.min(700, debtBefore),
          method: 'cash',
          shiftId: fx.shiftId,
          expectedDebtPayVersion: dVer,
        }),
      }),
    ])
    ;({ client, card } = await refreshCrm(base, client.id, cardNum))
    expect(round2(client.debt) >= 0, 'debt non-negative after concurrent repay')
    const repaid = round2(debtBefore - round2(client.debt))
    expect(repaid <= round2(Math.min(700, debtBefore) + 0.01), 'no double full repay')

    // P — topup replay
    const topRef = cref('topup')
    const t1 = await fetchJson(`${base}/cards/${encodeURIComponent(cardNum)}/cash-topup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRef: topRef,
        cash: 50,
        shiftId: fx.shiftId,
        posId: fx.posId,
        expectedBonusPayVersion: card.bonusPayVersion ?? 0,
      }),
    })
    expect(t1.ok, 'topup ok')
    const bonusAfterTop = round2((await refreshCrm(base, client.id, cardNum)).client.bonus)
    const t2 = await fetchJson(`${base}/cards/${encodeURIComponent(cardNum)}/cash-topup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRef: topRef,
        cash: 50,
        shiftId: fx.shiftId,
        posId: fx.posId,
      }),
    })
    expect(t2.ok && t2.body?.replayed, 'topup replay')
    ;({ client, card } = await refreshCrm(base, client.id, cardNum))
    expect(round2(client.bonus) === bonusAfterTop, 'topup no double bonus')

    // AC — restart hydration sample
    const debtSnap = round2(client.debt)
    const bonusSnap = round2(client.bonus)
    await killApi(api.child)
    api = await startApi(port)
    ;({ client, card } = await refreshCrm(base, client.id, cardNum))
    expect(!!client, 'client row after restart')
    expect(client && round2(client.debt) === debtSnap && round2(client.bonus) === bonusSnap, 'restart CRM match')
    expect(mirrorOk(client, card), 'mirror after restart')

    const pgDebt = await withClient(async (c) => {
      const cid = String(client.id)
      const r = await c.query(`SELECT data->>'debt' AS d FROM docs WHERE collection='clients' AND id=$1`, [cid])
      return round2(Number(r.rows[0]?.d))
    })
    expect(pgDebt === debtSnap, 'PG client debt match')
  } finally {
    await killApi(api.child)
    await cleanupOnlineTestPrefixes([PREFIX])
    await closePool()
  }

  console.log(`\nO4: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
