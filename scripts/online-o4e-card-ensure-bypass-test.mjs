/**
 * ONLINE-O4E — POST /cards/ensure must not mutate financial client↔card relation.
 *
 *   O4E_REAL_PG_REQUIRED=1
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
import { CRM_OP_KINDS, opRefDocId } from '../server/kakapo-api/pg/businessMutationTx.js'
import {
  cleanupOnlineTestPrefixes,
  bootstrapTestLabCashVault,
} from './online-test-db-cleanup.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const PREFIX = 'O4E-'

const REQUIRE = String(process.env.O4E_REAL_PG_REQUIRED || '') === '1'
const REAL_PG = isPostgresEnabled()

let passed = 0
let failed = 0
let PORT = 0
/** @type {{ child: import('node:child_process').ChildProcess, base: string } | null} */
let api = null

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

async function fetchJson(url, init, ms = 60000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    let body = null
    try { body = await res.json() } catch { body = null }
    return { ok: res.ok, status: res.status, body }
  } finally {
    clearTimeout(t)
  }
}

async function waitHealth(base, ms = 45000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetchJson(`${base}/health`, {}, 5000)
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

async function restartApi() {
  if (api?.child) killApi(api.child)
  await sleep(400)
  api = await startApi(PORT)
  return api.base
}

async function pgClient(clientId) {
  return withClient(async (c) => {
    const r = await c.query(`SELECT data FROM docs WHERE collection='clients' AND id=$1`, [String(clientId)])
    return r.rows[0]?.data || null
  })
}

async function pgCard(num) {
  const key = String(num || '').trim().toUpperCase()
  return withClient(async (c) => {
    for (const id of [key, `num:${key}`]) {
      const r = await c.query(
        `SELECT data FROM docs WHERE collection='cards' AND upper(id)=upper($1) LIMIT 1`,
        [id],
      )
      if (r.rows[0]?.data) return r.rows[0].data
    }
    const r = await c.query(
      `SELECT data FROM docs WHERE collection='cards' AND upper(data->>'num')=upper($1) LIMIT 1`,
      [key],
    )
    return r.rows[0]?.data || null
  })
}

async function refreshCrm(base, clientId, cardNum) {
  const clients = await fetchJson(`${base}/clients`)
  const client = (clients.body || []).find(c => c.id === clientId) || null
  const cards = await fetchJson(`${base}/cards`)
  const numKey = String(cardNum || '').toUpperCase()
  const card = (cards.body || []).find(c => String(c.num).toUpperCase() === numKey) || null
  return { client, card, cards: cards.body || [] }
}

function cardNum(tag) {
  return `${PREFIX}${tag}${Date.now()}${Math.random().toString(36).slice(2, 5)}`.slice(0, 24).toUpperCase()
}

async function mkClient(base, tag) {
  const phone = `998${String(Date.now()).slice(-9)}`
  const cl = await fetchJson(`${base}/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${PREFIX}C-${tag}`, phone, clientRef: `${PREFIX}cli-${tag}-${Date.now()}` }),
  })
  if (!cl.ok) throw new Error('client create')
  return { clientId: cl.body.id, phone, name: cl.body.name }
}

async function ensureOnly(base, payload) {
  const clientRef = String(payload.clientRef || '').trim() || `${PREFIX}ensure-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  return fetchJson(`${base}/cards/ensure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, clientRef }),
  })
}

async function linkClient(base, clientId, cardNum, clientRef) {
  return fetchJson(`${base}/clients/${clientId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card: cardNum, clientRef }),
  })
}

async function mkLinked(base, tag) {
  const cc = await mkClient(base, tag)
  const num = cardNum(tag)
  await ensureOnly(base, { num, clientId: cc.clientId, phone: cc.phone, client: cc.name, status: 'active', debtEnabled: true })
  const link = await linkClient(base, cc.clientId, num, `${PREFIX}link-${tag}-${Date.now()}`)
  if (!link.ok) throw new Error(`link ${link.status}`)
  return { ...cc, cardNum: num }
}

async function seedFx(base) {
  const tag = `seed-${Date.now()}`
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
      price: 100,
      costPrice: 50,
      stock: 0,
      clientRef: `${PREFIX}prod-${tag}`,
    }),
  })
  await fetchJson(`${base}/stock/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}rec-${tag}`,
      paidNow: 0,
      items: [{ productId: prod.body.id, qty: 200, purchaseTotal: 10000, costPrice: 50 }],
    }),
  })
  let shiftId
  if (posId && cashierId) {
    const sh = await fetchJson(`${base}/pos/shifts/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        posId,
        cashierId,
        openingCash: 1000,
        clientRef: `${PREFIX}shift-${Date.now()}`,
      }),
    })
    shiftId = sh.body?.id
  }
  return { productId: prod.body?.id, shiftId, posId }
}

async function bonusSpend(base, fx, phone, cardNum, amount, clientRef, bonusVer) {
  return fetchJson(`${base}/pos/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef,
      shiftId: fx.shiftId,
      posId: fx.posId,
      clientPhone: phone,
      cardNum,
      paymentMethod: 'cash',
      total: amount,
      paidCash: 0,
      bonusSpent: amount,
      ...(bonusVer != null ? { expectedBonusPayVersion: bonusVer } : {}),
      items: [{ productId: fx.productId, qty: 1, price: amount, lineTotal: amount }],
    }),
  })
}

function activeCardsForClient(cards, clientId) {
  return (cards || []).filter(
    c => c.status === 'active' && String(c.clientId || '') === String(clientId),
  )
}

function mirrorOk(client, card) {
  if (!client?.card || !card) return false
  if (String(client.card).toUpperCase() !== String(card.num).toUpperCase()) return false
  if (card.status !== 'active') return false
  return round2(client.debt) === round2(card.debt) && round2(client.bonus) === round2(card.bonus)
}

async function unlinkedCanonical(base, cc, debt, bonus) {
  const linked = await mkLinked(base, 'seed')
  await fetchJson(`${base}/clients/${linked.clientId}/debt-adjustments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: `${PREFIX}sd-${Date.now()}`, targetDebt: debt, reason: 'O4E' }),
  })
  await fetchJson(`${base}/cards/${encodeURIComponent(linked.cardNum)}/bonus-adjustments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: `${PREFIX}sb-${Date.now()}`, targetBonus: bonus, reason: 'O4E' }),
  })
  await fetchJson(`${base}/cards/${encodeURIComponent(linked.cardNum)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unlink: true, clientRef: `${PREFIX}un-${Date.now()}` }),
  })
  await sleep(200)
  const { client } = await refreshCrm(base, linked.clientId, linked.cardNum)
  expect(!client?.card && round2(client?.debt) === debt && round2(client?.bonus) === bonus, 'seed unlinked canonical')
  return linked
}

async function testEnsureNewDoesNotLink(base) {
  console.log('\n--- 1 Ensure new card does not link ---')
  const cc = await mkClient(base, 'new')
  const num = cardNum('NEW')
  const r = await ensureOnly(base, {
    num,
    clientId: cc.clientId,
    phone: cc.phone,
    client: cc.name,
    status: 'active',
    bonus: 999,
    debt: 888,
  })
  expect(r.ok, 'ensure OK')
  expect(r.body?.status === 'unlinked', 'card forced unlinked')
  expect(round2(r.body?.bonus) === 0 && round2(r.body?.debt) === 0, 'no financial mirror on create')
  const { client, card } = await refreshCrm(base, cc.clientId, num)
  expect(String(client?.card || '').toUpperCase() !== num, 'ensure did not set client.card to new num')
  expect(card?.status === 'unlinked', 'API card unlinked')
}

async function testEnsureBCannotReplaceA(base) {
  console.log('\n--- 2 Ensure B cannot replace active A ---')
  const cc = await mkLinked(base, 'rep')
  const cardB = cardNum('B')
  const r = await ensureOnly(base, {
    num: cardB,
    clientId: cc.clientId,
    phone: cc.phone,
    status: 'active',
    bonus: 100,
    debt: 500,
  })
  expect(r.ok, 'ensure B OK')
  const { client, cards } = await refreshCrm(base, cc.clientId, cardB)
  const cardA = cards.find(c => String(c.num).toUpperCase() === cc.cardNum.toUpperCase())
  const b = cards.find(c => String(c.num).toUpperCase() === cardB)
  expect(String(client?.card).toUpperCase() === cc.cardNum, 'client.card still A')
  expect(cardA?.status === 'active', 'A still active')
  expect(b?.status === 'unlinked', 'B unlinked')
  expect(activeCardsForClient(cards, cc.clientId).length === 1, 'single active card')
}

async function testNoDualActive(base) {
  console.log('\n--- 3 No dual active via ensure ---')
  const cc = await mkLinked(base, 'dual')
  const cardB = cardNum('DUAL')
  await ensureOnly(base, { num: cardB, clientId: cc.clientId, phone: cc.phone, status: 'active' })
  const { cards } = await refreshCrm(base, cc.clientId, cardB)
  expect(activeCardsForClient(cards, cc.clientId).length === 1, 'at most one active')
}

async function testNoSpendableBonusMirror(base, fx) {
  console.log('\n--- 4 Ensure cannot create spendable bonus mirror ---')
  const seed = await unlinkedCanonical(base, null, 500, 100)
  const cardB = cardNum('BON')
  await ensureOnly(base, {
    num: cardB,
    clientId: seed.clientId,
    phone: seed.phone,
    status: 'active',
    bonus: 100,
  })
  let { client, card } = await refreshCrm(base, seed.clientId, cardB)
  expect(round2(client?.bonus) === 100, 'canonical bonus on client')
  expect(round2(card?.bonus) === 0, 'card bonus not mirrored by ensure')
  const spend = await bonusSpend(base, fx, seed.phone, cardB, 10, `${PREFIX}sp-${Date.now()}`)
  expect(!spend.ok, 'bonus spend on unlinked B rejected')
  const ref = `${PREFIX}link-bon-${Date.now()}`
  const link = await linkClient(base, seed.clientId, cardB, ref)
  expect(link.ok, 'explicit link')
  await sleep(150)
  ;({ client, card } = await refreshCrm(base, seed.clientId, cardB))
  expect(mirrorOk(client, card), 'mirror after O8 link')
  if (!fx.shiftId) {
    expect(true, 'bonus spend after link (skipped — no shift fixture)')
  } else {
    const spend2 = await bonusSpend(base, fx, seed.phone, cardB, 10, `${PREFIX}sp2-${Date.now()}`)
    expect(spend2.ok, `bonus spend after link (${spend2.status} ${spend2.body?.detail || spend2.body?.code || ''})`)
  }
}

async function testDebtOwnership(base, fx) {
  console.log('\n--- 5 Ensure cannot change debt ownership ---')
  const seed = await unlinkedCanonical(base, null, 500, 0)
  const cardB = cardNum('DEB')
  await ensureOnly(base, { num: cardB, clientId: seed.clientId, phone: seed.phone, debt: 500, status: 'active' })
  const { client, card } = await refreshCrm(base, seed.clientId, cardB)
  expect(round2(client?.debt) === 500, 'client debt canonical')
  expect(round2(card?.debt) === 0, 'card debt not copied on ensure')
  const debtBefore = round2(client?.debt)
  const sale = await fetchJson(`${base}/pos/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}ds-${Date.now()}`,
      shiftId: fx.shiftId,
      posId: fx.posId,
      clientPhone: seed.phone,
      cardNum: cardB,
      paymentMethod: 'cash',
      total: 100,
      paidCash: 0,
      debtAdded: 100,
      items: [{ productId: fx.productId, qty: 1, price: 100, lineTotal: 100 }],
    }),
  })
  await sleep(120)
  const after = await refreshCrm(base, seed.clientId, cardB)
  expect(!after.client?.card, 'ensure-only: no client.card after debt POS attempt')
  if (sale.ok) {
    expect(round2(after.client?.debt) === round2(debtBefore + 100), 'client canonical debt if POS accepts')
  } else {
    expect(round2(after.client?.debt) === debtBefore, 'client debt unchanged when POS rejects')
  }
}

async function testRestartStaysUnlinked(base) {
  console.log('\n--- 6 Ensure + restart stays unlinked ---')
  const cc = await mkClient(base, 'rst')
  let { client: boot } = await refreshCrm(base, cc.clientId, '')
  if (boot?.card) {
    await fetchJson(`${base}/cards/${encodeURIComponent(boot.card)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unlink: true, clientRef: `${PREFIX}clr-${Date.now()}` }),
    })
    await sleep(150)
  }
  const num = cardNum('RST')
  await ensureOnly(base, { num, clientId: cc.clientId, phone: cc.phone, status: 'active' })
  await fetchJson(`${base}/__o8/flush-db`, { method: 'POST' }, 15000)
  await sleep(250)
  const pre = await refreshCrm(base, cc.clientId, num)
  expect(pre.card?.status === 'unlinked', 'pre-restart API card unlinked')
  const pgBefore = await pgClient(cc.clientId)
  expect(!pgBefore?.card, 'PG client.card empty before restart')
  const base2 = await restartApi()
  const { client, card } = await refreshCrm(base2, cc.clientId, num)
  const pgC = await pgClient(cc.clientId)
  expect(!client?.card, 'API client.card empty after restart')
  expect(!pgC?.card, 'PG client.card empty after restart')
  const financiallyLinked = card?.status === 'active' && String(client?.card || '').toUpperCase() === num
  expect(!financiallyLinked, 'no hidden financial link after restart')
}

async function testEnsureThenO8Link(base) {
  console.log('\n--- 7 Ensure + explicit O8 link ---')
  const cc = await mkClient(base, 'lnk')
  const num = cardNum('LNK')
  await ensureOnly(base, { num, clientId: cc.clientId, phone: cc.phone })
  const ref = `${PREFIX}lnk-${Date.now()}`
  const link = await linkClient(base, cc.clientId, num, ref)
  expect(link.ok, 'link OK')
  const nOps = await withClient(async (c) => {
    const id = opRefDocId(CRM_OP_KINDS.CRM_CLIENT_CARD_LINK, ref)
    const r = await c.query(`SELECT COUNT(*)::int AS n FROM docs WHERE collection='opRefs' AND id=$1`, [id])
    return r.rows[0]?.n || 0
  })
  expect(nOps === 1, 'opRef durable for link')
  const { client, card } = await refreshCrm(base, cc.clientId, num)
  expect(mirrorOk(client, card), 'linked mirror')
}

async function testReplaceAtomic(base) {
  console.log('\n--- 8 Explicit replacement atomic ---')
  const cc = await mkLinked(base, 'xrep')
  const cardB = cardNum('XREP')
  await ensureOnly(base, { num: cardB, clientId: cc.clientId, phone: cc.phone, status: 'unlinked' })
  const ref = `${PREFIX}xrep-${Date.now()}`
  const link = await linkClient(base, cc.clientId, cardB, ref)
  expect(link.ok, 'replace link OK')
  const { client, cards } = await refreshCrm(base, cc.clientId, cardB)
  const a = cards.find(c => String(c.num).toUpperCase() === cc.cardNum.toUpperCase())
  const b = cards.find(c => String(c.num).toUpperCase() === cardB)
  expect(String(client?.card).toUpperCase() === cardB, 'client.card is B')
  expect(b?.status === 'active', 'B active')
  expect(a?.status === 'unlinked', 'A tombstoned')
  expect(activeCardsForClient(cards, cc.clientId).length === 1, 'one active after replace')
}

async function testCollisions(base) {
  console.log('\n--- 9 Collision paths ---')
  const a = await mkLinked(base, 'colA')
  const b = await mkClient(base, 'colB')
  const steal = await ensureOnly(base, { num: a.cardNum, clientId: b.clientId, phone: b.phone })
  expect(steal.status === 409, 'wrong clientId on owned card → 409')

  const cc = await mkClient(base, 'ph')
  const num = cardNum('PH')
  await ensureOnly(base, { num, phone: cc.phone, clientId: cc.clientId })
  const other = await mkClient(base, 'ph2')
  const mismatch = await ensureOnly(base, {
    num: cardNum('MIS'),
    phone: cc.phone,
    clientId: other.clientId,
  })
  expect(mismatch.status === 409 && mismatch.body?.code === 'ENSURE_CLIENT_ID_PHONE_MISMATCH', 'clientId/phone mismatch')
}

async function isolated(fn) {
  await cleanupOnlineTestPrefixes()
  await bootstrapTestLabCashVault()
  if (api?.child) killApi(api.child)
  await sleep(300)
  api = await startApi(PORT)
  const fx = await seedFx(api.base)
  await fn(api.base, fx)
}

async function main() {
  console.log('ONLINE-O4E card ensure bypass closure\n')
  if (!REAL_PG) {
    if (REQUIRE) { failed += 1; console.error('  FAIL PG required') }
    console.log(`\nO4E: ${passed} passed, ${failed} failed`)
    process.exit(failed ? 1 : 0)
  }
  await ensureSchema()
  PORT = 19220 + Math.floor(Math.random() * 200)
  try {
    await isolated(testEnsureNewDoesNotLink)
    await isolated(testEnsureBCannotReplaceA)
    await isolated(testNoDualActive)
    await isolated(testNoSpendableBonusMirror)
    await isolated(testDebtOwnership)
    await isolated(testRestartStaysUnlinked)
    await isolated(testEnsureThenO8Link)
    await isolated(testReplaceAtomic)
    await isolated(testCollisions)
  } finally {
    if (api?.child) killApi(api.child)
    await cleanupOnlineTestPrefixes()
    await closePool()
  }
  console.log(`\nO4E: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
