/**
 * ONLINE-O4B — CRM / debt / loyalty final closure (real PG + API).
 *
 *   O4B_REAL_PG_REQUIRED=1
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
import { opRefDocId, WH_OP_KINDS, CRM_OP_KINDS } from '../server/kakapo-api/pg/businessMutationTx.js'
import {
  cleanupOnlineTestPrefixes,
  bootstrapTestLabCashVault,
} from './online-test-db-cleanup.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const PREFIX = 'O4B-'

const REQUIRE = String(process.env.O4B_REAL_PG_REQUIRED || process.env.O4_REAL_PG_REQUIRED || '') === '1'
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

async function openShift(base, posId, cashierId, tag) {
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
      clientRef: `${PREFIX}shift-${tag}-${Date.now()}`,
    }),
  })
  if (!sh.ok) throw new Error(`shift ${sh.status} ${sh.body?.detail || ''}`)
  return sh.body.id
}

async function seedFx(base, tag) {
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
  const prod = await fetchJson(`${base}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `${PREFIX}P-${tag}`,
      price: 500,
      costPrice: 50,
      stock: 0,
      clientRef: `${PREFIX}prod-${tag}`,
    }),
  })
  if (!prod.ok) throw new Error('product seed')
  await fetchJson(`${base}/stock/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}rec-${tag}`,
      paidNow: 0,
      items: [{ productId: prod.body.id, qty: 500, purchaseTotal: 25000, costPrice: 50 }],
    }),
  })
  const shiftId = await openShift(base, posId, cashierId, tag)
  return { productId: prod.body.id, shiftId, posId, cashierId }
}

async function mkClientCard(base, tag) {
  const ts = `${tag}-${Date.now()}`
  const phone = `998${String(Date.now()).slice(-9)}`
  const cardNum = `${PREFIX}${String(tag).slice(0, 8).toUpperCase()}${String(Date.now()).slice(-4)}`
  const cl = await fetchJson(`${base}/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${PREFIX}Client-${tag}`, phone, clientRef: `${PREFIX}cli-${ts}` }),
  })
  if (!cl.ok) throw new Error('client create')
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
  return { clientId: cl.body.id, phone, cardNum }
}

async function refreshCrm(base, clientId, cardNum) {
  const clients = await fetchJson(`${base}/clients`)
  const client = (clients.body || []).find(c => c.id === clientId) || null
  const cards = await fetchJson(`${base}/cards`)
  const card = (cards.body || []).find(c => String(c.num).toUpperCase() === String(cardNum).toUpperCase()) || null
  return { client, card }
}

function mirrorOk(client, card) {
  if (!client || !card) return false
  return round2(client.debt) === round2(card.debt) && round2(client.bonus) === round2(card.bonus)
}

async function debtLedger(base, phone) {
  const r = await fetchJson(`${base}/debt/ledger?phone=${encodeURIComponent(phone)}`)
  return r.body?.ledger || r.body?.entries || r.body || []
}

async function productStock(base, productId) {
  const all = await fetchJson(`${base}/products`)
  const row = (all.body || []).find(p => Number(p.id) === Number(productId))
  return round2(row?.stock)
}

async function debtSale(base, fx, cc, amount, clientRef, debtVer) {
  const unit = 100
  const qty = Math.max(1, Math.round(amount / unit))
  const lineTotal = round2(qty * unit)
  return fetchJson(`${base}/pos/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef,
      shiftId: fx.shiftId,
      posId: fx.posId,
      clientPhone: cc.phone,
      cardNum: cc.cardNum,
      paymentMethod: 'cash',
      total: lineTotal,
      paidCash: 0,
      debtAdded: lineTotal,
      ...(debtVer != null && debtVer !== '' ? { expectedDebtPayVersion: debtVer } : {}),
      items: [{ productId: fx.productId, qty, price: unit, lineTotal }],
    }),
  })
}

async function topUpStock(base, fx, qty = 80) {
  await fetchJson(`${base}/stock/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}stock-${Date.now()}`,
      paidNow: 0,
      items: [{ productId: fx.productId, qty, purchaseTotal: qty * 50, costPrice: 50 }],
    }),
  })
}

async function partialReturn(base, saleId, clientRef, returnAmount, debtVer, fx) {
  const unit = 100
  const qty = Math.max(1, Math.round(returnAmount / unit))
  return saleReturn(base, saleId, clientRef, {
    debtVer,
    items: [{ productId: fx.productId, qty, price: unit }],
    total: round2(qty * unit),
  })
}

async function repay(base, cc, fx, amount, clientRef, opts = {}) {
  return fetchJson(`${base}/cards/${encodeURIComponent(cc.cardNum)}/debt-repay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef,
      amount,
      method: opts.method || 'cash',
      shiftId: fx.shiftId,
      posId: fx.posId,
      orderId: opts.orderId,
      ...(opts.debtVer != null && opts.debtVer !== '' ? { expectedDebtPayVersion: opts.debtVer } : {}),
    }),
  })
}

async function saleReturn(base, saleId, clientRef, opts = {}) {
  return fetchJson(`${base}/pos/sales/${saleId}/return`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef,
      expectedDebtPayVersion: opts.debtVer,
      expectedBonusPayVersion: opts.bonusVer,
      items: opts.items,
      total: opts.total,
    }),
  })
}

async function countOpRef(kind, clientRef) {
  const id = opRefDocId(kind, clientRef)
  return withClient(async (c) => {
    const r = await c.query(`SELECT COUNT(*)::int AS n FROM docs WHERE collection='opRefs' AND id=$1`, [id])
    return r.rows[0]?.n || 0
  })
}

async function countLedgerRef(clientRef) {
  return withClient(async (c) => {
    const r = await c.query(
      `SELECT COUNT(*)::int AS n FROM docs WHERE collection='moneyLedger' AND data->>'clientRef'=$1`,
      [clientRef],
    )
    return r.rows[0]?.n || 0
  })
}

async function pgClientDebt(clientId) {
  return withClient(async (c) => {
    const r = await c.query(`SELECT data->>'debt' AS d, data->>'bonus' AS b FROM docs WHERE collection='clients' AND id=$1`, [String(clientId)])
    return { debt: round2(Number(r.rows[0]?.d)), bonus: round2(Number(r.rows[0]?.b)) }
  })
}

async function setChaos(base, point) {
  return fetchJson(`${base}/__o8/chaos/hold-at`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ point }) })
}

async function releaseChaos(base) {
  return fetchJson(`${base}/__o8/chaos/release`, { method: 'POST' })
}

async function diagReturnFail(label, ret, ctx) {
  if (ret.ok) return
  console.error(`  DIAG ${label}:`, JSON.stringify({
    status: ret.status,
    body: ret.body,
    ...ctx,
  }, null, 2))
}

async function runSections(base, fx) {
  const RUN_ID = String(process.env.ONLINE_RUN_ID || Date.now())
  const cref = (suffix) => `${PREFIX}${RUN_ID}-${suffix}`
  // ——— A/B debt return ———
  console.log('\n--- A/B Debt return ---')
  const ccA = await mkClientCard(base, 'retA')
  let { client, card } = await refreshCrm(base, ccA.clientId, ccA.cardNum)
  const st0 = await productStock(base, fx.productId)
  const s500 = await debtSale(base, fx, ccA, 500, `${PREFIX}sale500-${Date.now()}`, card.debtPayVersion)
  expect(s500.ok, `A1 sale ok (${s500.status})`)
  expect(s500.ok, 'A1 debt sale 500')
  const saleId = s500.body?.id
  const orderId = s500.body?.orderId
  ;({ client, card } = await refreshCrm(base, ccA.clientId, ccA.cardNum))
  expect(round2(client.debt) === 500 && mirrorOk(client, card), 'A1 debt 500 mirror')
  const retRefA1 = cref('ret-full-a1')
  const retFull = await saleReturn(base, saleId, retRefA1, { debtVer: card.debtPayVersion })
  await diagReturnFail('A1 full return', retFull, {
    clientRef: retRefA1,
    saleId,
    orderId,
    expectedDebtPayVersion: card.debtPayVersion,
    clientDebt: client?.debt,
    cardDebt: card?.debt,
    productStock: st0,
  })
  expect(retFull.ok, `A1 full return ok (${retFull.status} ${retFull.body?.detail || retFull.body?.code || ''})`)
  ;({ client, card } = await refreshCrm(base, ccA.clientId, ccA.cardNum))
  expect(round2(client.debt) === 0, 'A1 client debt 0 after full return')
  const ledA1 = await debtLedger(base, ccA.phone)
  const remA1 = ledA1.find(e => String(e.orderId) === String(orderId))
  expect(!remA1 || round2(remA1.remaining) === 0, 'A1 receipt balance 0')
  const st1 = await productStock(base, fx.productId)
  expect(round2(st1) >= round2(st0), `A1 stock not reduced by return (${st0}->${st1})`)
  expect(await countOpRef(WH_OP_KINDS.STOCK_RETURN_RESTORE, retRefA1) === 1, 'A1 one return opRef')

  const ccB = await mkClientCard(base, 'retB')
  ;({ client, card } = await refreshCrm(base, ccB.clientId, ccB.cardNum))
  const sb = await debtSale(base, fx, ccB, 500, `${PREFIX}saleB-${Date.now()}`, card.debtPayVersion)
  const saleBId = sb.body?.id
  const ordB = sb.body?.orderId
  ;({ client, card } = await refreshCrm(base, ccB.clientId, ccB.cardNum))
  const ret200 = await partialReturn(base, saleBId, `${PREFIX}ret-partial`, 200, card.debtPayVersion, fx)
  expect(ret200.ok, 'A2 partial return 200')
  ;({ client, card } = await refreshCrm(base, ccB.clientId, ccB.cardNum))
  expect(round2(client.debt) === 300, `A2 debt 300 (${client.debt})`)
  const ledB = await debtLedger(base, ccB.phone)
  const rowB = ledB.find(e => String(e.orderId) === String(ordB))
  expect(round2(rowB?.remaining) === 300, `A2 receipt remaining 300 (${rowB?.remaining})`)

  const ccC = await mkClientCard(base, 'retC')
  ;({ client, card } = await refreshCrm(base, ccC.clientId, ccC.cardNum))
  const sc = await debtSale(base, fx, ccC, 500, `${PREFIX}saleC-${Date.now()}`, card.debtPayVersion)
  const saleCId = sc.body?.id
  const ordC = sc.body?.orderId
  ;({ client, card } = await refreshCrm(base, ccC.clientId, ccC.cardNum))
  await repay(base, ccC, fx, 200, `${PREFIX}repC200`, { debtVer: card.debtPayVersion, orderId: ordC })
  ;({ client, card } = await refreshCrm(base, ccC.clientId, ccC.cardNum))
  expect(round2(client.debt) === 300, 'A3 after repay 200 debt 300')
  const retC = await partialReturn(base, saleCId, `${PREFIX}retC200`, 200, card.debtPayVersion, fx)
  expect(retC.ok, 'A3 return 200 after repay')
  ;({ client, card } = await refreshCrm(base, ccC.clientId, ccC.cardNum))
  expect(round2(client.debt) >= 0 && round2(client.debt) <= 300, `A3 debt non-negative preserved repay (${client.debt})`)

  const ccD = await mkClientCard(base, 'retD')
  ;({ client, card } = await refreshCrm(base, ccD.clientId, ccD.cardNum))
  const sd = await debtSale(base, fx, ccD, 500, `${PREFIX}saleD-${Date.now()}`, card.debtPayVersion)
  const saleDId = sd.body?.id
  const ordD = sd.body?.orderId
  ;({ client, card } = await refreshCrm(base, ccD.clientId, ccD.cardNum))
  await repay(base, ccD, fx, 500, `${PREFIX}repD500`, { debtVer: card.debtPayVersion, orderId: ordD })
  ;({ client, card } = await refreshCrm(base, ccD.clientId, ccD.cardNum))
  expect(round2(client.debt) === 0, 'A4 debt 0 after full repay')
  const retD = await saleReturn(base, saleDId, `${PREFIX}retD`, { debtVer: card.debtPayVersion })
  expect(retD.ok || retD.status === 400, 'A4 return after full repay handled')
  ;({ client, card } = await refreshCrm(base, ccD.clientId, ccD.cardNum))
  expect(round2(client.debt) >= 0, 'A4 no negative debt')

  // B idempotency
  console.log('\n--- B Return idempotency ---')
  await topUpStock(base, 200)
  const ccI = await mkClientCard(base, 'idemp')
  ;({ client, card } = await refreshCrm(base, ccI.clientId, ccI.cardNum))
  const saleRef = `${PREFIX}idemp-sale-${Date.now()}`
  const si = await debtSale(base, fx, ccI, 300, saleRef, card?.debtPayVersion)
  expect(si.ok, `B sale ok (${si.status} ${si.body?.detail || ''})`)
  ;({ client, card } = await refreshCrm(base, ccI.clientId, ccI.cardNum))
  const refRet = `${PREFIX}idemp-ret`
  const stBefore = await productStock(base, fx.productId)
  const r1 = await saleReturn(base, si.body.id, refRet, { debtVer: card.debtPayVersion })
  expect(r1.ok, `B first return (${r1.status})`)
  const r2 = await saleReturn(base, si.body.id, refRet, { debtVer: card.debtPayVersion })
  expect(r2.ok && (r2.body?.replayed || r2.body?.duplicate), 'B replay same ref')
  const stAfter = await productStock(base, fx.productId)
  expect(round2(stAfter) === round2(stBefore + 3), 'B stock once (+3 units)')
  expect(await countOpRef(WH_OP_KINDS.STOCK_RETURN_RESTORE, refRet) === 1, 'B single opRef')
  const badFp = await saleReturn(base, si.body.id, `${PREFIX}idemp-ret-other`, { debtVer: card.debtPayVersion, total: 999 })
  expect(badFp.status === 409 || badFp.status === 400 || badFp.body?.replayed, 'B different ref after full return handled')

  // C different-ref repay concurrency
  console.log('\n--- C Different-ref repay ---')
  const ccCnc = await mkClientCard(base, 'concRep')
  ;({ client, card } = await refreshCrm(base, ccCnc.clientId, ccCnc.cardNum))
  await fetchJson(`${base}/clients/${ccCnc.clientId}/debt-adjustments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: `${PREFIX}adj1k`, targetDebt: 1000, reason: 'O4B seed' }),
  })
  ;({ client, card } = await refreshCrm(base, ccCnc.clientId, ccCnc.cardNum))
  const dVer = card.debtPayVersion ?? 0
  const [rp1, rp2] = await Promise.all([
    repay(base, ccCnc, fx, 700, `${PREFIX}conc-r1`, { debtVer: dVer }),
    repay(base, ccCnc, fx, 700, `${PREFIX}conc-r2`, { debtVer: dVer }),
  ])
  ;({ client, card } = await refreshCrm(base, ccCnc.clientId, ccCnc.cardNum))
  const repaid = round2(1000 - round2(client.debt))
  expect(repaid <= 1000.01, `C total repay <= 1000 (${repaid})`)
  expect(round2(client.debt) >= 0, 'C debt non-negative')
  expect(mirrorOk(client, card), 'C mirror ok')

  // D exact receipt concurrency
  console.log('\n--- D Receipt-target concurrency ---')
  const ccT = await mkClientCard(base, 'tgt')
  ;({ client, card } = await refreshCrm(base, ccT.clientId, ccT.cardNum))
  const sa = await debtSale(base, fx, ccT, 100, `${PREFIX}tgtA`, card.debtPayVersion)
  ;({ client, card } = await refreshCrm(base, ccT.clientId, ccT.cardNum))
  const sb2 = await debtSale(base, fx, ccT, 200, `${PREFIX}tgtB`, card.debtPayVersion)
  const orderIdA = sa.body?.orderId
  const orderIdB = sb2.body?.orderId
  ;({ client, card } = await refreshCrm(base, ccT.clientId, ccT.cardNum))
  const v1 = card.debtPayVersion ?? 0
  const [ta, tb] = await Promise.all([
    repay(base, ccT, fx, 100, `${PREFIX}payA`, { orderId: orderIdA }),
    repay(base, ccT, fx, 150, `${PREFIX}payB`, { orderId: orderIdB }),
  ])
  expect(ta.ok && tb.ok, 'D targeted concurrent ok')
  const ledT = await debtLedger(base, ccT.phone)
  const rA = ledT.find(e => String(e.orderId) === String(orderIdA))
  const rB = ledT.find(e => String(e.orderId) === String(orderIdB))
  expect(round2(rA?.remaining) === 0, 'D receipt A zero')
  expect(round2(rB?.remaining) === 50, `D receipt B 50 (${rB?.remaining})`)
  ;({ client, card } = await refreshCrm(base, ccT.clientId, ccT.cardNum))
  expect(round2(client.debt) === 50, 'D canonical debt 50')

  // E debt sale + repay concurrency
  console.log('\n--- E Sale+repay concurrency ---')
  await topUpStock(base, fx, 50)
  const ccE = await mkClientCard(base, 'saleRep')
  ;({ client, card } = await refreshCrm(base, ccE.clientId, ccE.cardNum))
  await fetchJson(`${base}/clients/${ccE.clientId}/debt-adjustments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: `${PREFIX}adj500`, targetDebt: 500, reason: 'O4B' }),
  })
  ;({ client, card } = await refreshCrm(base, ccE.clientId, ccE.cardNum))
  const [es, er] = await Promise.all([
    debtSale(base, fx, ccE, 300, `${PREFIX}conc-sale`, null),
    repay(base, ccE, fx, 400, `${PREFIX}conc-repay`, {}),
  ])
  ;({ client, card } = await refreshCrm(base, ccE.clientId, ccE.cardNum))
  const pgE = await pgClientDebt(ccE.clientId)
  expect(round2(client.debt) === pgE.debt, 'E API PG debt match')
  expect(es.ok, `E sale ok (${es.status})`)
  expect(er.ok, `E repay ok (${er.status})`)
  expect(round2(client.debt) === 400, `E final debt 400 (${client.debt})`)

  // F advance + repay concurrency
  console.log('\n--- F Advance+repay concurrency ---')
  const ccF = await mkClientCard(base, 'advRep')
  ;({ client, card } = await refreshCrm(base, ccF.clientId, ccF.cardNum))
  await fetchJson(`${base}/clients/${ccF.clientId}/debt-adjustments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: `${PREFIX}adj500b`, targetDebt: 500, reason: 'O4B' }),
  })
  ;({ client, card } = await refreshCrm(base, ccF.clientId, ccF.cardNum))
  const [fa, fr] = await Promise.all([
    fetchJson(`${base}/cards/${encodeURIComponent(ccF.cardNum)}/cash-advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRef: `${PREFIX}adv300`, amount: 300, shiftId: fx.shiftId, posId: fx.posId }),
    }),
    repay(base, ccF, fx, 400, `${PREFIX}rep400`, {}),
  ])
  ;({ client, card } = await refreshCrm(base, ccF.clientId, ccF.cardNum))
  expect(round2(client.debt) >= 0, 'F debt non-negative')
  expect(fa.ok && fr.ok && round2(client.debt) === 400, `F debt 400 (${client.debt})`)

  // G return + repay concurrency
  console.log('\n--- G Return+repay concurrency ---')
  const ccG = await mkClientCard(base, 'retRep')
  ;({ client, card } = await refreshCrm(base, ccG.clientId, ccG.cardNum))
  const sg = await debtSale(base, fx, ccG, 500, `${PREFIX}g-sale`, card.debtPayVersion)
  ;({ client, card } = await refreshCrm(base, ccG.clientId, ccG.cardNum))
  const gv = card.debtPayVersion ?? 0
  const [gr, gp] = await Promise.all([
    saleReturn(base, sg.body.id, `${PREFIX}g-ret`, { debtVer: gv, total: 200 }),
    repay(base, ccG, fx, 400, `${PREFIX}g-repay`, { debtVer: gv }),
  ])
  ;({ client, card } = await refreshCrm(base, ccG.clientId, ccG.cardNum))
  expect(round2(client.debt) >= 0, 'G no negative debt')
  expect(mirrorOk(client, card), 'G mirror ok')

  // H/I link unlink
  console.log('\n--- H/I Link unlink ---')
  const ccH = await mkClientCard(base, 'link')
  ;({ client, card } = await refreshCrm(base, ccH.clientId, ccH.cardNum))
  await debtSale(base, fx, ccH, 500, `${PREFIX}link-debt`, card.debtPayVersion)
  ;({ client, card } = await refreshCrm(base, ccH.clientId, ccH.cardNum))
  const unlinkDebt = await fetchJson(`${base}/cards/${encodeURIComponent(ccH.cardNum)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unlink: true, clientRef: `${PREFIX}unlink-debt` }),
  })
  expect(unlinkDebt.ok, 'H1 unlink with canonical debt ok')
  ;({ client, card } = await refreshCrm(base, ccH.clientId, ccH.cardNum))
  expect(round2(client.debt) === 500, 'H1 client debt preserved')
  expect(!client.card, 'H1 client.card cleared after unlink')
  expect(card?.status === 'unlinked', 'H1 card tombstoned')

  const ccI2 = await mkClientCard(base, 'bonlink')
  await fetchJson(`${base}/cards/${encodeURIComponent(ccI2.cardNum)}/bonus-adjustments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: `${PREFIX}b100`, targetBonus: 100, reason: 'O4B' }),
  })
  ;({ client, card } = await refreshCrm(base, ccI2.clientId, ccI2.cardNum))
  const bonusBeforeUnlink = round2(client.bonus)
  await fetchJson(`${base}/cards/${encodeURIComponent(ccI2.cardNum)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unlink: true, clientRef: `${PREFIX}unlink-bonus` }),
  })
  ;({ client, card } = await refreshCrm(base, ccI2.clientId, ccI2.cardNum))
  expect(round2(client.bonus) === bonusBeforeUnlink, 'I unlink client bonus preserved on client')
  const rel = await fetchJson(`${base}/clients/${ccI2.clientId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card: ccI2.cardNum, clientRef: `${PREFIX}relink` }),
  })
  expect(rel.ok, 'I relink PATCH ok')
  ;({ client, card } = await refreshCrm(base, ccI2.clientId, ccI2.cardNum))
  expect(round2(client.bonus) === bonusBeforeUnlink, 'I client bonus after relink')
  expect(round2(card.bonus) === bonusBeforeUnlink, `I card bonus after relink (${card?.bonus})`)

  // J collision
  console.log('\n--- J Link collision ---')
  const ccJ1 = await mkClientCard(base, 'col1')
  const ccJ2 = await mkClientCard(base, 'col2')
  const steal = await fetchJson(`${base}/clients/${ccJ2.clientId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card: ccJ1.cardNum, clientRef: `${PREFIX}steal` }),
  })
  expect(!steal.ok || steal.status === 409, 'J card collision rejected or noop')

  // K delete protection
  console.log('\n--- K Delete protection ---')
  const ccK = await mkClientCard(base, 'del')
  ;({ client, card } = await refreshCrm(base, ccK.clientId, ccK.cardNum))
  await debtSale(base, fx, ccK, 100, `${PREFIX}del-sale`, card.debtPayVersion)
  const del = await fetchJson(`${base}/clients/${ccK.clientId}/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: `${PREFIX}del-client` }),
  })
  expect(!del.ok || del.status === 400, 'K client with debt delete blocked')
  const hist = await debtLedger(base, ccK.phone)
  expect(hist.length >= 1, 'K debt history readable')

  // P PATCH regression
  console.log('\n--- P PATCH regression ---')
  const patchD = await fetchJson(`${base}/clients/${ccK.clientId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ debt: 1, clientRef: `${PREFIX}patch-d` }),
  })
  expect(patchD.status === 400 && patchD.body?.code === 'DEBT_REQUIRES_ADJUSTMENT_OPERATION', 'P PATCH debt blocked')

  // L full lifecycle
  console.log('\n--- L Full CRM lifecycle ---')
  const ccL = await mkClientCard(base, 'life')
  await fetchJson(`${base}/cards/${encodeURIComponent(ccL.cardNum)}/bonus-adjustments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: `${PREFIX}life-b100`, targetBonus: 100, reason: 'life' }),
  })
  ;({ client, card } = await refreshCrm(base, ccL.clientId, ccL.cardNum))
  expect(round2(client.debt) === 0 && round2(client.bonus) === 100, 'L0 seed')
  const ls1 = await debtSale(base, fx, ccL, 500, `${PREFIX}life-s1`, card.debtPayVersion)
  ;({ client, card } = await refreshCrm(base, ccL.clientId, ccL.cardNum))
  expect(round2(client.debt) === 500, 'L1 debt sale')
  await repay(base, ccL, fx, 200, `${PREFIX}life-r200`, { debtVer: card.debtPayVersion, orderId: ls1.body?.orderId })
  ;({ client, card } = await refreshCrm(base, ccL.clientId, ccL.cardNum))
  expect(round2(client.debt) === 300, 'L2 repay 200')
  await fetchJson(`${base}/cards/${encodeURIComponent(ccL.cardNum)}/cash-advance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: `${PREFIX}life-adv`, amount: 100, shiftId: fx.shiftId, posId: fx.posId, expectedDebtPayVersion: card.debtPayVersion }),
  })
  ;({ client, card } = await refreshCrm(base, ccL.clientId, ccL.cardNum))
  expect(round2(client.debt) === 400, 'L3 advance')
  await fetchJson(`${base}/pos/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}life-bspend`,
      shiftId: fx.shiftId,
      posId: fx.posId,
      clientPhone: ccL.phone,
      cardNum: ccL.cardNum,
      paymentMethod: 'cash',
      total: 40,
      paidCash: 0,
      bonusSpent: 40,
      expectedBonusPayVersion: card.bonusPayVersion,
      items: [{ productId: fx.productId, qty: 1, price: 40, lineTotal: 40 }],
    }),
  })
  ;({ client, card } = await refreshCrm(base, ccL.clientId, ccL.cardNum))
  expect(round2(client.bonus) === 60, 'L4 bonus spend')
  await saleReturn(base, ls1.body.id, `${PREFIX}life-ret100`, { debtVer: card.debtPayVersion, total: 100 })
  ;({ client, card } = await refreshCrm(base, ccL.clientId, ccL.cardNum))
  expect(round2(client.debt) >= 0, 'L7 partial return debt ok')
  const snapDebt = round2(client.debt)
  const snapBonus = round2(client.bonus)
  const pgL = await pgClientDebt(ccL.clientId)
  expect(pgL.debt === snapDebt && pgL.bonus === snapBonus, 'L PG match')

  // O crash sample — debt repay ACK lost
  console.log('\n--- O Crash matrix sample ---')
  const ccO = await mkClientCard(base, 'crash')
  ;({ client, card } = await refreshCrm(base, ccO.clientId, ccO.cardNum))
  await fetchJson(`${base}/clients/${ccO.clientId}/debt-adjustments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: `${PREFIX}crash-adj`, targetDebt: 200, reason: 'crash' }),
  })
  ;({ client, card } = await refreshCrm(base, ccO.clientId, ccO.cardNum))
  const crashRepayRef = cref('crash-repay')
  const c1 = await repay(base, ccO, fx, 50, crashRepayRef, { debtVer: card.debtPayVersion })
  expect(c1.ok, 'O repay durable')
  const c2 = await repay(base, ccO, fx, 50, crashRepayRef, { debtVer: card.debtPayVersion })
  expect(c2.ok && (c2.body?.replayed || c2.body?.duplicate), 'O repay ACK replay')
  expect(await countOpRef(CRM_OP_KINDS.DEBT_REPAY, crashRepayRef) === 1, 'O single repay opRef')
}

async function main() {
  console.log('ONLINE-O4B CRM final closure\n')
  if (!REAL_PG) {
    if (REQUIRE) { failed += 1; console.error('  FAIL PG required') }
    console.log(`\nO4B: ${passed} passed, ${failed} failed`)
    process.exit(failed ? 1 : 0)
  }

  await ensureSchema()
  const RUN_ID = String(process.env.ONLINE_RUN_ID || Date.now())
  await cleanupOnlineTestPrefixes()
  await bootstrapTestLabCashVault()
  const port = 19004 + Math.floor(Math.random() * 200)
  let api = await startApi(port)
  try {
    const fx = await seedFx(api.base, RUN_ID)
    await runSections(api.base, fx)
  } finally {
    await killApi(api.child)
    await cleanupOnlineTestPrefixes()
    await closePool()
  }
  console.log(`\nO4B: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
