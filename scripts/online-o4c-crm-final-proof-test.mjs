/**
 * ONLINE-O4C — CRM final proof (bonus authority, chaos matrix, full lifecycle).
 *
 * Bonus model (Option A):
 *   BONUS_CANONICAL_ENTITY = client (clients.bonus)
 *   BONUS_MIRROR_ENTITY = active linked card
 *
 *   O4C_REAL_PG_REQUIRED=1
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
const PREFIX = 'O4C-'

const REQUIRE = String(process.env.O4C_REAL_PG_REQUIRED || process.env.O4B_REAL_PG_REQUIRED || '') === '1'
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
        KAKAPO_CRM_PATCH_PERSIST: '1',
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

async function isolatedSection(fn) {
  await cleanupOnlineTestPrefixes()
  await bootstrapTestLabCashVault()
  if (api?.child) killApi(api.child)
  await sleep(300)
  api = await startApi(PORT)
  const fx = await seedFx(api.base)
  await fn(api.base, fx)
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

async function countOpRef(kind, clientRef) {
  const id = opRefDocId(kind, clientRef)
  return withClient(async (c) => {
    const r = await c.query(`SELECT COUNT(*)::int AS n FROM docs WHERE collection='opRefs' AND id=$1`, [id])
    return r.rows[0]?.n || 0
  })
}

async function pgClient(clientId) {
  return withClient(async (c) => {
    const r = await c.query(
      `SELECT data FROM docs WHERE collection='clients' AND id=$1`,
      [String(clientId)],
    )
    return r.rows[0]?.data || null
  })
}

async function pgCard(num) {
  return withClient(async (c) => {
    const r = await c.query(
      `SELECT data FROM docs WHERE collection='cards' AND id=$1`,
      [String(num).toUpperCase()],
    )
    return r.rows[0]?.data || null
  })
}

/** Economic bonus = client canonical (Option A). */
function canonicalBonus(client) {
  return round2(client?.bonus)
}

function spendableBonusTotal(client, cards) {
  let total = canonicalBonus(client)
  for (const c of cards || []) {
    if (c.status === 'active' && String(c.num).toUpperCase() !== String(client?.card || '').toUpperCase()) {
      if (round2(c.bonus) > 0.001) total += round2(c.bonus)
    }
  }
  return round2(total)
}

async function refreshCrm(base, clientId, cardNum) {
  const clients = await fetchJson(`${base}/clients`)
  const client = (clients.body || []).find(c => c.id === clientId) || null
  const cards = await fetchJson(`${base}/cards`)
  const numKey = String(cardNum || client?.card || '').toUpperCase()
  let card = (cards.body || []).find(c => String(c.num).toUpperCase() === numKey) || null
  if (!card && numKey) {
    const pg = await pgCard(numKey)
    if (pg?.num) card = pg
  }
  return { client, card, cards: cards.body || [] }
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
  const openList = await fetchJson(`${base}/pos/shifts?status=open`)
  let shiftId = (openList.body || []).find(s => s.status === 'open')?.id
  if (!shiftId) {
    const sh = await fetchJson(`${base}/pos/shifts/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        posId,
        cashierId,
        cashierName: `${PREFIX}Cashier`,
        openingCash: 1000,
        clientRef: `${PREFIX}shift-${tag}`,
      }),
    })
    shiftId = sh.body?.id
  }
  return { productId: prod.body.id, shiftId, posId, cashierId }
}

async function mkClientCard(base, tag, cardSuffix) {
  const phone = `998${String(Date.now()).slice(-9)}`
  const cardNum = `${PREFIX}${String(cardSuffix || tag).slice(0, 8)}${Math.random().toString(36).slice(2, 9)}`.slice(0, 24).toUpperCase()
  const cl = await fetchJson(`${base}/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${PREFIX}Client-${tag}`, phone, clientRef: `${PREFIX}cli-${tag}` }),
  })
  if (!cl.ok || !cl.body?.id) throw new Error(`mkClientCard: client create failed ${tag}`)
  await fetchJson(`${base}/cards/ensure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ num: cardNum, client: cl.body.name, phone, status: 'active', debtEnabled: true }),
  })
  const link = await fetchJson(`${base}/clients/${cl.body.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card: cardNum, clientRef: `${PREFIX}link-${tag}` }),
  })
  if (!link.ok) throw new Error(`mkClientCard: link failed ${tag} ${link.body?.detail || link.status}`)
  await flushPatch(base)
  return { clientId: cl.body.id, phone, cardNum }
}

async function flushPatch(base) {
  if (base) await fetchJson(`${base}/__o8/flush-db`, { method: 'POST' }, 15000)
  else await sleep(300)
}

async function unlinkCard(base, cardNum, clientRef) {
  const r = await fetchJson(`${base}/cards/${encodeURIComponent(cardNum)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unlink: true, clientRef }),
  })
  await flushPatch(base)
  return r
}

async function linkCard(base, clientId, cardNum, clientRef) {
  const r = await fetchJson(`${base}/clients/${clientId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card: cardNum, clientRef }),
  })
  await flushPatch(base)
  return r
}

async function bonusAdj(base, cardNum, target, clientRef) {
  const r = await fetchJson(`${base}/cards/${encodeURIComponent(cardNum)}/bonus-adjustments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef, targetBonus: target, reason: `${PREFIX}adj` }),
  })
  await flushPatch(base)
  return r
}

async function debtAdj(base, clientId, target, clientRef) {
  return fetchJson(`${base}/clients/${clientId}/debt-adjustments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef, targetDebt: target, reason: `${PREFIX}adj` }),
  })
}

async function debtSale(base, fx, phone, cardNum, amount, clientRef, debtVer) {
  const qty = Math.max(1, Math.round(amount / 100))
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
      total: qty * 100,
      paidCash: 0,
      debtAdded: qty * 100,
      ...(debtVer != null ? { expectedDebtPayVersion: debtVer } : {}),
      items: [{ productId: fx.productId, qty, price: 100, lineTotal: qty * 100 }],
    }),
  })
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
      expectedBonusPayVersion: bonusVer,
      items: [{ productId: fx.productId, qty: 1, price: amount, lineTotal: amount }],
    }),
  })
}

async function repay(base, cardNum, fx, amount, clientRef, debtVer, orderId) {
  return fetchJson(`${base}/cards/${encodeURIComponent(cardNum)}/debt-repay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef,
      amount,
      method: 'cash',
      shiftId: fx.shiftId,
      posId: fx.posId,
      ...(orderId ? { orderId } : {}),
      ...(debtVer != null ? { expectedDebtPayVersion: debtVer } : {}),
    }),
  })
}

async function testBonusConservation(base, fx) {
  console.log('\n--- B Bonus unlink/relink ---')
  const cc = await mkClientCard(base, 'bon', 'CARDA')
  await bonusAdj(base, cc.cardNum, 100, `${PREFIX}b100`)
  let { client, card, cards } = await refreshCrm(base, cc.clientId, cc.cardNum)
  const pgStart = await pgClient(cc.clientId)
  expect(round2(Number(pgStart?.bonus)) === 100, `pg after adj (${pgStart?.bonus})`)
  expect(canonicalBonus(client) === 100, 'start canonical 100')
  expect(spendableBonusTotal(client, cards) === 100, 'economic total 100 linked')
  await unlinkCard(base, cc.cardNum, `${PREFIX}un1`)
  await flushPatch(base)
  ;({ client, card, cards } = await refreshCrm(base, cc.clientId, cc.cardNum))
  expect(canonicalBonus(client) === 100, 'after unlink client 100')
  expect(spendableBonusTotal(client, cards) === 100, 'economic total still 100')
  await flushPatch(base)
  const base2 = await restartApi()
  const pgUn = await pgClient(cc.clientId)
  ;({ client, card, cards } = await refreshCrm(base2, cc.clientId, cc.cardNum))
  expect(round2(Number(pgUn?.bonus)) === 100, `pg after restart bonus (${pgUn?.bonus})`)
  expect(canonicalBonus(client) === 100, 'after restart unlinked 100')
  await linkCard(base2, cc.clientId, cc.cardNum, `${PREFIX}re1`)
  await flushPatch(base2)
  ;({ client, card, cards } = await refreshCrm(base2, cc.clientId, cc.cardNum))
  expect(canonicalBonus(client) === 100 && round2(card.bonus) === 100, 'relink mirror 100')
  expect(spendableBonusTotal(client, cards) === 100, 'no duplicate balances')

  const cardB = `${PREFIX}BCARD${String(Date.now()).slice(-5)}`
  await fetchJson(`${base2}/cards/ensure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ num: cardB, status: 'unlinked' }),
  })
  await unlinkCard(base2, cc.cardNum, `${PREFIX}un2`)
  await linkCard(base2, cc.clientId, cardB, `${PREFIX}linkB`)
  await flushPatch(base2)
  ;({ client, card, cards } = await refreshCrm(base2, cc.clientId, cardB))
  const oldSpend = await bonusSpend(base2, fx, cc.phone, cc.cardNum, 10, `${PREFIX}oldspend`, 0)
  expect(!oldSpend.ok, 'old card cannot spend')
  expect(card, 'new active card present')
  const newSpend = await bonusSpend(base2, fx, cc.phone, cardB, 10, `${PREFIX}newspend`, card?.bonusPayVersion ?? 0)
  expect(newSpend.ok, 'new card can spend')
}

async function testChaosDebtRepay(base, fx) {
  console.log('\n--- E Debt repay chaos ---')
  const cc = await mkClientCard(base, 'chrep', 'REP')
  await debtAdj(base, cc.clientId, 500, `${PREFIX}d500`)
  await flushPatch(base)
  let { client, card } = await refreshCrm(base, cc.clientId, cc.cardNum)
  if (!card) {
    await flushPatch(base)
    ;({ client, card } = await refreshCrm(base, cc.clientId, cc.cardNum))
  }
  if (!card) {
    failed += 1
    console.error('  FAIL chaos repay: card missing')
    return
  }
  const ref = `${PREFIX}chaos-repay`
  await setChaos(base, 'before_commit')
  const p = repay(base, cc.cardNum, fx, 200, ref, card.debtPayVersion).catch(() => ({ ok: false }))
  await sleep(900)
  killApi(api.child)
  await p
  expect(await countOpRef(CRM_OP_KINDS.DEBT_REPAY, ref) === 0, 'repay precommit opRef 0')
  const pg0 = await pgClient(cc.clientId)
  expect(round2(Number(pg0?.debt)) === 500, 'repay precommit debt 500')

  const base2 = await restartApi()
  await releaseChaos(base2)
  ;({ client, card } = await refreshCrm(base2, cc.clientId, cc.cardNum))
  await setChaos(base2, 'after_commit_before_response')
  const p2 = repay(base2, cc.cardNum, fx, 200, ref, card.debtPayVersion).catch(() => ({ ok: false }))
  await sleep(1200)
  expect(await countOpRef(CRM_OP_KINDS.DEBT_REPAY, ref) === 1, 'postcommit opRef 1')
  killApi(api.child)
  await p2
  const base3 = await restartApi()
  await releaseChaos(base3)
  const r3 = await repay(base3, cc.cardNum, fx, 200, ref, card.debtPayVersion)
  expect(r3.ok && r3.body?.replayed, 'repay ACK replay')
  ;({ client } = await refreshCrm(base3, cc.clientId, cc.cardNum))
  expect(round2(client.debt) === 300, 'debt reduced once to 300')
}

async function testChaosAdvance(base, fx) {
  console.log('\n--- F Cash advance chaos ---')
  const cc = await mkClientCard(base, 'chadv', 'ADV')
  await debtAdj(base, cc.clientId, 200, `${PREFIX}advbase`)
  let { client, card } = await refreshCrm(base, cc.clientId, cc.cardNum)
  const ref = `${PREFIX}chaos-adv`
  await setChaos(base, 'before_commit')
  const p = fetchJson(`${base}/cards/${encodeURIComponent(cc.cardNum)}/cash-advance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: ref, amount: 100, shiftId: fx.shiftId, posId: fx.posId }),
  }).catch(() => ({ ok: false }))
  await sleep(900)
  killApi(api.child)
  await p
  expect(await countOpRef(CRM_OP_KINDS.CASH_ADVANCE, ref) === 0, 'advance precommit opRef 0')
  const base2 = await restartApi()
  await releaseChaos(base2)
  ;({ client, card } = await refreshCrm(base2, cc.clientId, cc.cardNum))
  expect(round2(client.debt) === 200, 'advance precommit no debt bump')
  const ok = await fetchJson(`${base2}/cards/${encodeURIComponent(cc.cardNum)}/cash-advance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: ref, amount: 100, shiftId: fx.shiftId, posId: fx.posId }),
  })
  expect(ok.ok, 'advance postcommit ok')
  const ok2 = await fetchJson(`${base2}/cards/${encodeURIComponent(cc.cardNum)}/cash-advance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: ref, amount: 100, shiftId: fx.shiftId, posId: fx.posId }),
  })
  expect(ok2.body?.replayed, 'advance replay')
  ;({ client } = await refreshCrm(base2, cc.clientId, cc.cardNum))
  expect(round2(client.debt) === 300, 'advance debt +100 once')
}

async function testChaosBonusSpend(base, fx) {
  console.log('\n--- G Bonus spend chaos ---')
  const cc = await mkClientCard(base, 'chbsp', 'BSP')
  await bonusAdj(base, cc.cardNum, 100, `${PREFIX}bsp100`)
  let { client, card } = await refreshCrm(base, cc.clientId, cc.cardNum)
  if (!card) {
    failed += 1
    console.error('  FAIL chaos bonus spend: card missing')
    return
  }
  const ref = `${PREFIX}chaos-bspend`
  // Sale runs loyalty inside mutate(); hold before_transaction (not before_commit).
  await setChaos(base, 'before_transaction')
  const p = bonusSpend(base, fx, cc.phone, cc.cardNum, 40, ref, card.bonusPayVersion).catch(() => ({ ok: false }))
  await sleep(900)
  killApi(api.child)
  await p
  const base2 = await restartApi()
  await releaseChaos(base2)
  ;({ client, card } = await refreshCrm(base2, cc.clientId, cc.cardNum))
  const pgB = await pgClient(cc.clientId)
  expect(round2(Number(pgB?.bonus)) === 100, 'bonus precommit PG unchanged')
  expect(round2(client.bonus) === 100, 'bonus precommit unchanged')
  const s1 = await bonusSpend(base2, fx, cc.phone, cc.cardNum, 40, ref, card.bonusPayVersion)
  expect(s1.ok, 'bonus spend commit')
  const s2 = await bonusSpend(base2, fx, cc.phone, cc.cardNum, 40, ref, card.bonusPayVersion)
  expect(s2.body?.replayed, 'bonus spend replay')
  ;({ client } = await refreshCrm(base2, cc.clientId, cc.cardNum))
  expect(round2(client.bonus) === 60, 'bonus 60 once')
}

async function testLinkUnlinkRestart(base, fx) {
  console.log('\n--- C Link/unlink restart ---')
  const cc = await mkClientCard(base, 'lnk', 'LNK')
  await bonusAdj(base, cc.cardNum, 50, `${PREFIX}lnk-b50`)
  await debtAdj(base, cc.clientId, 100, `${PREFIX}lnk-d100`)
  let { client, card } = await refreshCrm(base, cc.clientId, cc.cardNum)
  const dBefore = round2(client.debt)
  const bBefore = canonicalBonus(client)
  await unlinkCard(base, cc.cardNum, `${PREFIX}lnk-un`)
  ;({ client } = await refreshCrm(base, cc.clientId, cc.cardNum))
  expect(canonicalBonus(client) === bBefore && round2(client.debt) === dBefore, 'unlink preserves canonical')
  const base2 = await restartApi()
  ;({ client } = await refreshCrm(base2, cc.clientId, cc.cardNum))
  expect(canonicalBonus(client) === bBefore, 'restart unlinked bonus')
  await linkCard(base2, cc.clientId, cc.cardNum, `${PREFIX}lnk-re`)
  ;({ client, card } = await refreshCrm(base2, cc.clientId, cc.cardNum))
  expect(round2(card.bonus) === bBefore && round2(card.debt) === dBefore, 'relink mirror debt/bonus')
}

async function testDebtReturnChaos(base, fx) {
  console.log('\n--- F Debt return chaos ---')
  const cc = await mkClientCard(base, 'dret', 'DRET')
  let { client, card } = await refreshCrm(base, cc.clientId, cc.cardNum)
  const saleRef = `${PREFIX}ret-sale-${Date.now()}`
  const s = await debtSale(base, fx, cc.phone, cc.cardNum, 300, saleRef, card.debtPayVersion)
  expect(s.ok, 'return chaos sale')
  const retRef = `${PREFIX}ret-chaos`
  const retBody = {
    clientRef: retRef,
    expectedDebtPayVersion: card.debtPayVersion,
    total: 100,
    items: [{ productId: fx.productId, qty: 1, price: 100 }],
  }
  await setChaos(base, 'before_transaction')
  const p = fetchJson(`${base}/pos/sales/${s.body.id}/return`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(retBody),
  }).catch(() => ({ ok: false }))
  await sleep(900)
  killApi(api.child)
  await p
  expect(await countOpRef(WH_OP_KINDS.STOCK_RETURN_RESTORE, retRef) === 0, 'return precommit opRef 0')
  const base2 = await restartApi()
  await releaseChaos(base2)
  ;({ client, card } = await refreshCrm(base2, cc.clientId, cc.cardNum))
  expect(round2(client.debt) === 300, 'return precommit debt unchanged')
  const r1 = await fetchJson(`${base2}/pos/sales/${s.body.id}/return`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...retBody, expectedDebtPayVersion: card.debtPayVersion }),
  })
  expect(r1.ok, 'return postcommit')
  ;({ client, card } = await refreshCrm(base2, cc.clientId, cc.cardNum))
  const r2 = await fetchJson(`${base2}/pos/sales/${s.body.id}/return`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...retBody, expectedDebtPayVersion: card.debtPayVersion }),
  })
  expect(r2.body?.replayed || r2.body?.duplicate, 'return replay')
  ;({ client } = await refreshCrm(base2, cc.clientId, cc.cardNum))
  expect(round2(client.debt) === 200, 'return debt cut once')
}

async function testAdjChaos(base, fx) {
  console.log('\n--- H/I Adjustment chaos ---')
  const cc = await mkClientCard(base, 'adj', 'ADJ')
  await bonusAdj(base, cc.cardNum, 80, `${PREFIX}adj-b80`)
  let { client, card } = await refreshCrm(base, cc.clientId, cc.cardNum)
  const bRef = `${PREFIX}badj`
  await setChaos(base, 'before_commit')
  const pb = fetchJson(`${base}/cards/${encodeURIComponent(cc.cardNum)}/bonus-adjustments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: bRef, targetBonus: 120, reason: 'O4C' }),
  }).catch(() => ({ ok: false }))
  await sleep(900)
  killApi(api.child)
  await pb
  const base2 = await restartApi()
  await releaseChaos(base2)
  ;({ client, card } = await refreshCrm(base2, cc.clientId, cc.cardNum))
  expect(round2(client.bonus) === 80, 'bonus adj precommit unchanged')
  const dRef = `${PREFIX}dadj`
  await setChaos(base2, 'before_commit')
  const pd = debtAdj(base2, cc.clientId, 150, dRef).catch(() => ({ ok: false }))
  await sleep(900)
  killApi(api.child)
  await pd
  const base3 = await restartApi()
  await releaseChaos(base3)
  ;({ client } = await refreshCrm(base3, cc.clientId, cc.cardNum))
  expect(round2(client.debt) === 0, 'debt adj precommit unchanged')
  const bOk = await bonusAdj(base3, cc.cardNum, 120, bRef)
  expect(bOk.ok, 'bonus adj commit')
  const b2 = await bonusAdj(base3, cc.cardNum, 120, bRef)
  expect(b2.body?.replayed, 'bonus adj replay')
  const dOk = await debtAdj(base3, cc.clientId, 150, dRef)
  expect(dOk.ok, 'debt adj commit')
}

async function testTopupChaos(base, fx) {
  console.log('\n--- J Topup chaos ---')
  const cc = await mkClientCard(base, 'top', 'TOP')
  let { client, card } = await refreshCrm(base, cc.clientId, cc.cardNum)
  const ref = `${PREFIX}top-chaos`
  await setChaos(base, 'before_commit')
  const p = fetchJson(`${base}/cards/${encodeURIComponent(cc.cardNum)}/cash-topup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: ref,
      cash: 50,
      shiftId: fx.shiftId,
      posId: fx.posId,
      expectedBonusPayVersion: card.bonusPayVersion,
    }),
  }).catch(() => ({ ok: false }))
  await sleep(900)
  killApi(api.child)
  await p
  expect(await countOpRef(CRM_OP_KINDS.CARD_TOPUP, ref) === 0, 'topup precommit opRef 0')
  const base2 = await restartApi()
  await releaseChaos(base2)
  ;({ client, card } = await refreshCrm(base2, cc.clientId, cc.cardNum))
  const b0 = round2(client.bonus)
  const t1 = await fetchJson(`${base2}/cards/${encodeURIComponent(cc.cardNum)}/cash-topup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: ref,
      cash: 50,
      shiftId: fx.shiftId,
      posId: fx.posId,
      expectedBonusPayVersion: card.bonusPayVersion,
    }),
  })
  expect(t1.ok, 'topup commit')
  const t2 = await fetchJson(`${base2}/cards/${encodeURIComponent(cc.cardNum)}/cash-topup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: ref,
      cash: 50,
      shiftId: fx.shiftId,
      posId: fx.posId,
      expectedBonusPayVersion: card.bonusPayVersion,
    }),
  })
  expect(t2.body?.replayed, 'topup replay')
  ;({ client } = await refreshCrm(base2, cc.clientId, cc.cardNum))
  expect(round2(client.bonus) > b0, 'topup bonus once')
}

async function testVersionProof(base, fx) {
  console.log('\n--- L Version proof ---')
  const cc = await mkClientCard(base, 'ver', 'VER')
  await debtAdj(base, cc.clientId, 100, `${PREFIX}ver-d`)
  let { client, card } = await refreshCrm(base, cc.clientId, cc.cardNum)
  const dv0 = Number(card.debtPayVersion) || 0
  const bv0 = Number(card.bonusPayVersion) || 0
  await repay(base, cc.cardNum, fx, 10, `${PREFIX}ver-rep`, card.debtPayVersion)
  ;({ card } = await refreshCrm(base, cc.clientId, cc.cardNum))
  expect(Number(card.debtPayVersion) === dv0 + 1, 'debtPayVersion +1 on repay')
  await bonusAdj(base, cc.cardNum, 20, `${PREFIX}ver-b`)
  ;({ card } = await refreshCrm(base, cc.clientId, cc.cardNum))
  expect(Number(card.bonusPayVersion) === bv0 + 1, 'bonusPayVersion +1 on adj')
  const ref = `${PREFIX}ver-rep2`
  await setChaos(base, 'before_commit')
  const p = repay(base, cc.cardNum, fx, 5, ref, card.debtPayVersion).catch(() => ({ ok: false }))
  await sleep(800)
  killApi(api.child)
  await p
  const base2 = await restartApi()
  await releaseChaos(base2)
  ;({ card } = await refreshCrm(base2, cc.clientId, cc.cardNum))
  const dvHold = Number(card.debtPayVersion) || 0
  const rOk = await repay(base2, cc.cardNum, fx, 5, ref, card.debtPayVersion)
  expect(rOk.ok, 'version repay commit')
  const r2 = await repay(base2, cc.cardNum, fx, 5, ref, card.debtPayVersion)
  expect(r2.body?.replayed, 'version repay replay no extra bump')
  ;({ card } = await refreshCrm(base2, cc.clientId, cc.cardNum))
  expect(Number(card.debtPayVersion) === dvHold + 1, 'debtPayVersion replay safe')
}

async function testFullLifecycle(base, fx) {
  console.log('\n--- K Full CRM lifecycle ---')
  const cc = await mkClientCard(base, 'life', 'LIFE')
  await bonusAdj(base, cc.cardNum, 100, `${PREFIX}life-b100`)
  let { client, card } = await refreshCrm(base, cc.clientId, cc.cardNum)
  expect(round2(client.debt) === 0 && round2(client.bonus) === 100, 'L0')
  const s1 = await debtSale(base, fx, cc.phone, cc.cardNum, 500, `${PREFIX}life-s1`, card.debtPayVersion)
  expect(s1.ok, 'L1 sale')
  const orderId = s1.body?.orderId
  ;({ client, card } = await refreshCrm(base, cc.clientId, cc.cardNum))
  expect(round2(client.debt) === 500, 'L1 debt 500')
  await repay(base, cc.cardNum, fx, 200, `${PREFIX}life-r1`, card.debtPayVersion, orderId)
  ;({ client, card } = await refreshCrm(base, cc.clientId, cc.cardNum))
  expect(round2(client.debt) === 300, 'L2 debt 300')
  await fetchJson(`${base}/cards/${encodeURIComponent(cc.cardNum)}/cash-advance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}life-adv`,
      amount: 100,
      shiftId: fx.shiftId,
      posId: fx.posId,
      expectedDebtPayVersion: card.debtPayVersion,
    }),
  })
  ;({ client, card } = await refreshCrm(base, cc.clientId, cc.cardNum))
  expect(round2(client.debt) === 400, 'L3 debt 400')
  await bonusSpend(base, fx, cc.phone, cc.cardNum, 40, `${PREFIX}life-bs`, card.bonusPayVersion)
  ;({ client, card } = await refreshCrm(base, cc.clientId, cc.cardNum))
  expect(round2(client.bonus) === 60, 'L4 bonus 60')
  const earn = await debtSale(base, fx, cc.phone, cc.cardNum, 100, `${PREFIX}life-earn`, card.debtPayVersion)
  expect(earn.ok, 'L5 earn sale')
  ;({ client, card } = await refreshCrm(base, cc.clientId, cc.cardNum))
  const bonusAfterEarn = round2(client.bonus)
  expect(bonusAfterEarn >= 60, 'L5 bonus earned or unchanged')
  const top = await fetchJson(`${base}/cards/${encodeURIComponent(cc.cardNum)}/cash-topup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}life-top`,
      cash: 30,
      shiftId: fx.shiftId,
      posId: fx.posId,
      expectedBonusPayVersion: card.bonusPayVersion,
    }),
  })
  expect(top.ok, 'L6 topup')
  ;({ client, card } = await refreshCrm(base, cc.clientId, cc.cardNum))
  const bonusAfterTop = round2(client.bonus)
  expect(bonusAfterTop >= bonusAfterEarn, 'L6 topup increased bonus')
  await fetchJson(`${base}/pos/sales/${s1.body.id}/return`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}life-ret`,
      expectedDebtPayVersion: card.debtPayVersion,
      total: 100,
    }),
  })
  ;({ client, card } = await refreshCrm(base, cc.clientId, cc.cardNum))
  expect(round2(client.debt) >= 0, 'L7 return debt ok')
  await unlinkCard(base, cc.cardNum, `${PREFIX}life-un`)
  ;({ client, card } = await refreshCrm(base, cc.clientId, cc.cardNum))
  expect(canonicalBonus(client) === bonusAfterTop, 'L8 unlink bonus conserved')
  const baseR = await restartApi()
  ;({ client } = await refreshCrm(baseR, cc.clientId, cc.cardNum))
  expect(canonicalBonus(client) === bonusAfterTop, 'L9 restart unlinked')
  await linkCard(baseR, cc.clientId, cc.cardNum, `${PREFIX}life-re`)
  ;({ client, card } = await refreshCrm(baseR, cc.clientId, cc.cardNum))
  expect(round2(card.bonus) === canonicalBonus(client), 'L10 relink mirror')
  const cardB = `${PREFIX}LIFEB${String(Date.now()).slice(-4)}`
  await fetchJson(`${baseR}/cards/ensure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ num: cardB, status: 'unlinked' }),
  })
  await unlinkCard(baseR, cc.cardNum, `${PREFIX}life-un2`)
  await linkCard(baseR, cc.clientId, cardB, `${PREFIX}life-linkB`)
  await flushPatch(baseR)
  const oldSpend = await bonusSpend(baseR, fx, cc.phone, cc.cardNum, 5, `${PREFIX}life-old`, 0)
  expect(!oldSpend.ok, 'L11 old card blocked')
  const pgC = await pgClient(cc.clientId)
  const pgBonus = round2(Number(pgC?.bonus))
  expect(pgBonus === canonicalBonus(client), 'L12 PG bonus match')
}

async function invariantSweep() {
  console.log('\n--- M Invariant sweep ---')
  const bad = await withClient(async (c) => {
    const clients = await c.query(`SELECT id, data FROM docs WHERE collection='clients' AND data->>'name' LIKE $1`, [`${PREFIX}%`])
    const issues = []
    for (const row of clients.rows) {
      const d = row.data
      if (round2(Number(d.debt)) < -0.001) issues.push({ id: row.id, kind: 'neg_debt' })
      if (round2(Number(d.bonus)) < -0.001) issues.push({ id: row.id, kind: 'neg_bonus' })
    }
    return issues
  })
  expect(bad.length === 0, `sweep issues ${bad.length}`)
}

async function main() {
  console.log('ONLINE-O4C CRM final proof\n')
  console.log('Model: BONUS_CANONICAL_ENTITY=client BONUS_MIRROR_ENTITY=active_card\n')
  if (!REAL_PG) {
    if (REQUIRE) { failed += 1; console.error('  FAIL PG required') }
    console.log(`\nO4C: ${passed} passed, ${failed} failed`)
    process.exit(failed ? 1 : 0)
  }

  await ensureSchema()
  await cleanupOnlineTestPrefixes()
  await bootstrapTestLabCashVault()
  PORT = 19104 + Math.floor(Math.random() * 200)
  try {
    await isolatedSection(testBonusConservation)
    await isolatedSection(testChaosDebtRepay)
    await isolatedSection(testChaosAdvance)
    await isolatedSection(testChaosBonusSpend)
    await isolatedSection(testLinkUnlinkRestart)
    await isolatedSection(testDebtReturnChaos)
    await isolatedSection(testAdjChaos)
    await isolatedSection(testTopupChaos)
    await isolatedSection(testVersionProof)
    await isolatedSection(testFullLifecycle)
    await invariantSweep()
  } finally {
    if (api?.child) killApi(api.child)
    await cleanupOnlineTestPrefixes()
    await closePool()
  }
  console.log(`\nO4C: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
