/**
 * ONLINE-O4D — durable atomic client/card link & unlink (real PG + chaos).
 *
 *   O4D_REAL_PG_REQUIRED=1
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
const PREFIX = 'O4D-'

const REQUIRE = String(process.env.O4D_REAL_PG_REQUIRED || '') === '1'
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
    const r = await c.query(`SELECT data FROM docs WHERE collection='clients' AND id=$1`, [String(clientId)])
    return r.rows[0]?.data || null
  })
}

async function pgCard(num) {
  const key = String(num || '').trim().toUpperCase()
  return withClient(async (c) => {
    let r = await c.query(
      `SELECT data FROM docs WHERE collection='cards' AND upper(id)=upper($1) LIMIT 1`,
      [key],
    )
    if (r.rows[0]?.data) return r.rows[0].data
    r = await c.query(
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
  const numKey = String(cardNum || client?.card || '').toUpperCase()
  const card = (cards.body || []).find(c => String(c.num).toUpperCase() === numKey) || null
  return { client, card, cards: cards.body || [] }
}

async function mkClientCard(base, tag) {
  const phone = `998${String(Date.now()).slice(-9)}`
  const cardNum = `${PREFIX}${tag}${Date.now()}${Math.random().toString(36).slice(2, 5)}`.slice(0, 24).toUpperCase()
  const cl = await fetchJson(`${base}/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `${PREFIX}C-${tag}`, phone, clientRef: `${PREFIX}cli-${tag}-${Date.now()}` }),
  })
  if (!cl.ok) throw new Error('client create')
  await fetchJson(`${base}/cards/ensure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ num: cardNum, client: cl.body.name, phone, status: 'active', debtEnabled: true }),
  })
  const link = await fetchJson(`${base}/clients/${cl.body.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card: cardNum, clientRef: `${PREFIX}link-${tag}-${Date.now()}` }),
  })
  if (!link.ok) throw new Error(`link failed ${link.body?.detail || link.status}`)
  return { clientId: cl.body.id, phone, cardNum }
}

async function seedDebtBonus(base, cc, debt, bonus) {
  await fetchJson(`${base}/clients/${cc.clientId}/debt-adjustments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: `${PREFIX}sd-${Date.now()}`, targetDebt: debt, reason: 'O4D' }),
  })
  await fetchJson(`${base}/cards/${encodeURIComponent(cc.cardNum)}/bonus-adjustments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: `${PREFIX}sb-${Date.now()}`, targetBonus: bonus, reason: 'O4D' }),
  })
  await sleep(150)
}

async function unlink(base, cardNum, clientRef) {
  return fetchJson(`${base}/cards/${encodeURIComponent(cardNum)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unlink: true, clientRef }),
  })
}

async function linkClient(base, clientId, cardNum, clientRef) {
  return fetchJson(`${base}/clients/${clientId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card: cardNum, clientRef }),
  })
}

function mirrorOk(client, card) {
  if (!client?.card || !card) return false
  if (String(client.card).toUpperCase() !== String(card.num).toUpperCase()) return false
  if (card.status !== 'active') return false
  return round2(client.debt) === round2(card.debt) && round2(client.bonus) === round2(card.bonus)
}

async function testUnlinkPrecommit(base) {
  console.log('\n--- F Unlink precommit ---')
  const cc = await mkClientCard(base, 'unpre')
  await seedDebtBonus(base, cc, 500, 100)
  let { client, card } = await refreshCrm(base, cc.clientId, cc.cardNum)
  expect(mirrorOk(client, card), 'F seed mirror')
  const ref = `${PREFIX}un-pre`
  await setChaos(base, 'before_commit')
  const p = unlink(base, cc.cardNum, ref).catch(() => ({ ok: false }))
  await sleep(900)
  killApi(api.child)
  await p
  expect(await countOpRef(CRM_OP_KINDS.CRM_CARD_UNLINK, ref) === 0, 'F opRef 0')
  const base2 = await restartApi()
  await releaseChaos(base2)
  ;({ client, card } = await refreshCrm(base2, cc.clientId, cc.cardNum))
  const pgC = await pgClient(cc.clientId)
  const pgK = await pgCard(cc.cardNum)
  expect(String(client.card).toUpperCase() === cc.cardNum, 'F still linked API')
  expect(card?.status === 'active', 'F card still active')
  expect(round2(client.debt) === 500 && round2(client.bonus) === 100, 'F canonical preserved')
  expect(round2(Number(pgC?.debt)) === round2(client.debt), 'F PG client debt')
  expect(round2(Number(pgC?.bonus)) === round2(client.bonus), 'F PG client bonus')
  if (pgK && card) {
    expect(round2(Number(pgK.debt)) === round2(card.debt) && round2(Number(pgK.bonus)) === round2(card.bonus), 'F PG card mirror')
  } else {
    expect(card && round2(card.debt) === 500 && round2(card.bonus) === 100, 'F API card mirror (PG row pending)')
  }
}

async function testUnlinkPostcommit(base) {
  console.log('\n--- G Unlink postcommit ---')
  const cc = await mkClientCard(base, 'unpost')
  await seedDebtBonus(base, cc, 500, 100)
  const ref = `${PREFIX}un-post`
  await setChaos(base, 'after_commit_before_response')
  const p = unlink(base, cc.cardNum, ref).catch(() => ({ ok: false }))
  await sleep(1200)
  expect(await countOpRef(CRM_OP_KINDS.CRM_CARD_UNLINK, ref) === 1, 'G opRef 1 after commit')
  killApi(api.child)
  await p
  const base2 = await restartApi()
  await releaseChaos(base2)
  let { client, card } = await refreshCrm(base2, cc.clientId, cc.cardNum)
  expect(!client.card, 'G client.card cleared')
  expect(round2(client.debt) === 500 && round2(client.bonus) === 100, 'G canonical debt/bonus')
  expect(card?.status === 'unlinked', 'G card tombstoned')
  const r2 = await unlink(base2, cc.cardNum, ref)
  expect(r2.ok && r2.body?.replayed, 'G ACK replay')
  ;({ client } = await refreshCrm(base2, cc.clientId, cc.cardNum))
  expect(round2(client.debt) === 500, 'G no double financial effect')
}

async function testRelinkChaos(base) {
  console.log('\n--- H Relink chaos ---')
  const cc = await mkClientCard(base, 'relnk')
  await seedDebtBonus(base, cc, 500, 100)
  const unRef = `${PREFIX}re-un`
  await unlink(base, cc.cardNum, unRef)
  let { client } = await refreshCrm(base, cc.clientId, cc.cardNum)
  expect(!client.card, 'H unlinked start')
  const linkRef = `${PREFIX}re-link`
  await setChaos(base, 'before_commit')
  const p = linkClient(base, cc.clientId, cc.cardNum, linkRef).catch(() => ({ ok: false }))
  await sleep(900)
  killApi(api.child)
  await p
  const base2 = await restartApi()
  await releaseChaos(base2)
  ;({ client } = await refreshCrm(base2, cc.clientId, cc.cardNum))
  expect(!client.card, 'H precommit relink rolled back')
  await setChaos(base2, 'after_commit_before_response')
  const p2 = linkClient(base2, cc.clientId, cc.cardNum, linkRef).catch(() => ({ ok: false }))
  await sleep(1200)
  killApi(api.child)
  await p2
  const base3 = await restartApi()
  await releaseChaos(base3)
  let { client: c3, card: k3 } = await refreshCrm(base3, cc.clientId, cc.cardNum)
  expect(mirrorOk(c3, k3), 'H postcommit linked mirror')
  const r3 = await linkClient(base3, cc.clientId, cc.cardNum, linkRef)
  expect(r3.body?.replayed, 'H relink replay')
}

async function testCardReplace(base) {
  console.log('\n--- I Card replacement ---')
  const cc = await mkClientCard(base, 'repA')
  await seedDebtBonus(base, cc, 500, 100)
  const cardB = `${PREFIX}B${Math.random().toString(36).slice(2, 8)}`.slice(0, 24).toUpperCase()
  await fetchJson(`${base}/cards/ensure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ num: cardB, status: 'unlinked' }),
  })
  const refPre = `${PREFIX}rep-pre`
  await setChaos(base, 'before_commit')
  const p = linkClient(base, cc.clientId, cardB, refPre).catch(() => ({ ok: false }))
  await sleep(900)
  killApi(api.child)
  await p
  const base2 = await restartApi()
  await releaseChaos(base2)
  let { client, card } = await refreshCrm(base2, cc.clientId, cc.cardNum)
  expect(String(client.card).toUpperCase() === cc.cardNum, 'I precommit A still active')
  const refPost = `${PREFIX}rep-post`
  await linkClient(base2, cc.clientId, cardB, refPost)
  await sleep(200)
  ;({ client, card } = await refreshCrm(base2, cc.clientId, cardB))
  const old = await pgCard(cc.cardNum)
  expect(String(client.card).toUpperCase() === cardB, 'I client on B')
  expect(
    card?.status === 'active'
    && round2(client.debt) === round2(card.debt)
    && round2(client.bonus) === round2(card.bonus),
    `I B mirror (${client.debt}/${client.bonus} vs ${card?.debt}/${card?.bonus})`,
  )
  const { cards: allCards } = await refreshCrm(base2, cc.clientId, cardB)
  const activeForClient = (allCards || []).filter(c =>
    c.status === 'active'
    && (String(c.clientId) === String(cc.clientId) || String(c.num).toUpperCase() === cardB),
  )
  expect(activeForClient.length === 1, `I one active card (${activeForClient.length})`)
  const cardAApi = (allCards || []).find(c => String(c.num).toUpperCase() === cc.cardNum)
  expect(cardAApi?.status === 'unlinked', 'I A inactive')
  expect(round2(Number(cardAApi?.bonus)) === 0, 'I A mirror cleared')
}

async function testConcurrency(base) {
  console.log('\n--- J Concurrency ---')
  const cc = await mkClientCard(base, 'conc')
  const cB = `${PREFIX}CB${Math.random().toString(36).slice(2, 6)}`.slice(0, 24).toUpperCase()
  const cC = `${PREFIX}CC${Math.random().toString(36).slice(2, 6)}`.slice(0, 24).toUpperCase()
  await fetchJson(`${base}/cards/ensure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ num: cB, status: 'unlinked' }),
  })
  await fetchJson(`${base}/cards/ensure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ num: cC, status: 'unlinked' }),
  })
  await unlink(base, cc.cardNum, `${PREFIX}conc-un`)
  const [lb, lc] = await Promise.all([
    linkClient(base, cc.clientId, cB, `${PREFIX}conc-b`),
    linkClient(base, cc.clientId, cC, `${PREFIX}conc-c`),
  ])
  expect(lb.ok || lc.ok, 'J one link ok')
  const { client, cards } = await refreshCrm(base, cc.clientId, cB)
  const activeForClient = (cards || []).filter(c =>
    c.status === 'active'
    && (String(c.clientId) === String(cc.clientId) || String(c.num).toUpperCase() === String(client?.card || '').toUpperCase()),
  )
  expect(activeForClient.length <= 1, `J at most one active (${activeForClient.length})`)

  const cc1 = await mkClientCard(base, 'own1')
  const cc2 = await mkClientCard(base, 'own2')
  const steal = await linkClient(base, cc2.clientId, cc1.cardNum, `${PREFIX}steal`)
  expect(!steal.ok && (steal.status === 409 || steal.body?.code === 'CARD_OWNED_BY_OTHER_CLIENT'), 'J two clients one card blocked')
}

async function testRestartHydration(base) {
  console.log('\n--- K Restart hydration ---')
  const cc = await mkClientCard(base, 'hyd')
  await seedDebtBonus(base, cc, 300, 80)
  await unlink(base, cc.cardNum, `${PREFIX}hyd-un`)
  const baseR = await restartApi()
  const apiC = await pgClient(cc.clientId)
  const { client } = await refreshCrm(baseR, cc.clientId, cc.cardNum)
  expect(round2(Number(apiC?.bonus)) === round2(client.bonus), 'K bonus PG=API')
  await linkClient(baseR, cc.clientId, cc.cardNum, `${PREFIX}hyd-re`)
  await restartApi()
  const pgC2 = await pgClient(cc.clientId)
  const pgK2 = await pgCard(cc.cardNum)
  const { client: c2, card: k2 } = await refreshCrm(api.base, cc.clientId, cc.cardNum)
  expect(String(pgC2?.card).toUpperCase() === String(c2.card).toUpperCase(), 'K client.card PG=API')
  expect(round2(Number(pgC2?.debt)) === round2(c2.debt), 'K client debt PG=API')
  expect(
    pgK2 && pgC2
    && round2(Number(pgK2.debt)) === round2(Number(pgC2.debt))
    && round2(Number(pgK2.bonus)) === round2(Number(pgC2.bonus)),
    `K card mirror matches PG client (${pgK2?.debt}/${pgK2?.bonus} vs ${pgC2?.debt}/${pgC2?.bonus})`,
  )
}

async function testBonusRecheck(base, fx) {
  console.log('\n--- M Canonical bonus recheck ---')
  const cc = await mkClientCard(base, 'bon')
  await fetchJson(`${base}/cards/${encodeURIComponent(cc.cardNum)}/bonus-adjustments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: `${PREFIX}b100`, targetBonus: 100, reason: 'O4D' }),
  })
  let { card: bCard } = await refreshCrm(base, cc.clientId, cc.cardNum)
  await unlink(base, cc.cardNum, `${PREFIX}bon-un`)
  await restartApi()
  await linkClient(api.base, cc.clientId, cc.cardNum, `${PREFIX}bon-re`)
  ;({ card: bCard } = await refreshCrm(api.base, cc.clientId, cc.cardNum))
  const spend1 = await fetchJson(`${api.base}/pos/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}sp1`,
      shiftId: fx.shiftId,
      posId: fx.posId,
      clientPhone: cc.phone,
      cardNum: cc.cardNum,
      paymentMethod: 'cash',
      total: 40,
      paidCash: 0,
      bonusSpent: 40,
      expectedBonusPayVersion: bCard?.bonusPayVersion ?? 0,
      items: [{ productId: fx.productId, qty: 1, price: 40, lineTotal: 40 }],
    }),
  })
  expect(spend1.ok, `M spend 40 (${spend1.status} ${spend1.body?.detail || ''})`)
  const cardB = `${PREFIX}BNB${Math.random().toString(36).slice(2, 6)}`.slice(0, 24).toUpperCase()
  await fetchJson(`${api.base}/cards/ensure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ num: cardB, status: 'unlinked' }),
  })
  await unlink(api.base, cc.cardNum, `${PREFIX}bon-un2`)
  await linkClient(api.base, cc.clientId, cardB, `${PREFIX}bon-linkB`)
  const { card: newCard } = await refreshCrm(api.base, cc.clientId, cardB)
  const oldSpend = await fetchJson(`${api.base}/pos/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}sp-old`,
      shiftId: fx.shiftId,
      posId: fx.posId,
      clientPhone: cc.phone,
      cardNum: cc.cardNum,
      paymentMethod: 'cash',
      total: 20,
      paidCash: 0,
      bonusSpent: 20,
      items: [{ productId: fx.productId, qty: 1, price: 20, lineTotal: 20 }],
    }),
  })
  expect(!oldSpend.ok, 'M old card blocked')
  const spend2 = await fetchJson(`${api.base}/pos/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}sp-new`,
      shiftId: fx.shiftId,
      posId: fx.posId,
      clientPhone: cc.phone,
      cardNum: cardB,
      paymentMethod: 'cash',
      total: 20,
      paidCash: 0,
      bonusSpent: 20,
      expectedBonusPayVersion: newCard?.bonusPayVersion ?? 0,
      items: [{ productId: fx.productId, qty: 1, price: 20, lineTotal: 20 }],
    }),
  })
  expect(spend2.ok, `M new card spend 20 (${spend2.status})`)
  const { client } = await refreshCrm(api.base, cc.clientId, cardB)
  expect(round2(client.bonus) === 40, `M canonical bonus 40 (${client.bonus})`)
}

async function seedFx(base) {
  const points = await fetchJson(`${base}/pos/points`)
  const posId = points.body?.[0]?.id
  const prod = await fetchJson(`${base}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `${PREFIX}P-${Date.now()}`,
      price: 100,
      costPrice: 50,
      stock: 0,
      clientRef: `${PREFIX}prod-${Date.now()}`,
    }),
  })
  await fetchJson(`${base}/stock/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef: `${PREFIX}rec-${Date.now()}`,
      paidNow: 0,
      items: [{ productId: prod.body?.id, qty: 200, purchaseTotal: 10000, costPrice: 50 }],
    }),
  })
  const openList = await fetchJson(`${base}/pos/shifts?status=open`)
  let shiftId = (openList.body || []).find(s => s.status === 'open')?.id
  if (!shiftId) {
    const cashiers = await fetchJson(`${base}/cashiers`)
    const cashierId = cashiers.body?.[0]?.id
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
    shiftId = sh.body?.id
  }
  return { productId: prod.body?.id, shiftId, posId }
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
  console.log('ONLINE-O4D link/unlink atomic closure\n')
  if (!REAL_PG) {
    if (REQUIRE) { failed += 1; console.error('  FAIL PG required') }
    console.log(`\nO4D: ${passed} passed, ${failed} failed`)
    process.exit(failed ? 1 : 0)
  }
  await ensureSchema()
  PORT = 19120 + Math.floor(Math.random() * 200)
  try {
    await isolated(testUnlinkPrecommit)
    await isolated(testUnlinkPostcommit)
    await isolated(testRelinkChaos)
    await isolated(testCardReplace)
    await isolated(testConcurrency)
    await isolated(testRestartHydration)
    await isolated(testBonusRecheck)
  } finally {
    if (api?.child) killApi(api.child)
    await cleanupOnlineTestPrefixes()
    await closePool()
  }
  console.log(`\nO4D: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
