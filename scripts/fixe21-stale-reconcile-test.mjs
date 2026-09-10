/**
 * FIX E.2.1 — post-reconcile stale card/client refs must not overwrite bonus/level.
 * Run: node scripts/fixe21-stale-reconcile-test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiRoot = path.join(root, 'server', 'kakapo-api')

const results = []
const pending = []
function test(name, fn) {
  try {
    const out = fn()
    if (out?.then) {
      pending.push(out.then(() => {
        results.push({ name, status: 'PASS' })
        console.log(`PASS  ${name}`)
      }).catch(e => {
        results.push({ name, status: 'FAIL', error: String(e?.message || e) })
        console.error(`FAIL  ${name}: ${e?.message || e}`)
      }))
      return
    }
    results.push({ name, status: 'PASS' })
    console.log(`PASS  ${name}`)
  } catch (e) {
    results.push({ name, status: 'FAIL', error: String(e?.message || e) })
    console.error(`FAIL  ${name}: ${e?.message || e}`)
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg)
}

const {
  createMemoryEffectBackend,
  cardDocId,
} = await import(pathToFileURL(path.join(apiRoot, 'pg', 'effectTxn.js')).href)

const { createPosSale, createClientOrderFromPosSale } = await import(
  pathToFileURL(path.join(apiRoot, 'posLogic.js')).href
)
const { completePosSaleOnlineLoyalty } = await import(
  pathToFileURL(path.join(apiRoot, 'loyaltyBonus.js')).href
)

function clone(x) { return structuredClone(x) }

function baseDb() {
  return {
    products: [{ id: 1, name: 'Tea', price: 100, stock: 50, unit: 'шт', art: 'T1' }],
    stockReceipts: [{ id: 'RCP1', items: [{ productId: 1, qty: 50, remainingQty: 50, unitCost: 50 }] }],
    cashiers: [{ id: 'C1', name: 'C', salesCount: 0, salesTotal: 0 }],
    posShifts: [{
      id: 'SH1', status: 'open', posId: 'POS1', cashierId: 'C1', cashierName: 'C',
      salesCount: 0, salesCash: 0, salesCard: 0, salesCredit: 0, salesWallet: 0,
    }],
    posPoints: [{ id: 'POS1' }],
    posSales: [],
    moneyLedger: [],
    orders: [],
    opRefs: [],
    clients: [{
      id: 'CL1', name: 'Client', phone: '+992900000001', card: 'CARD1',
      bonus: 100, debt: 0, wallet: 0, level: 'bronze',
    }],
    cards: [{
      num: 'CARD1', phone: '+992900000001', clientId: 'CL1', client: 'Client',
      bonus: 100, debt: 0, wallet: 0, level: 'bronze', status: 'active',
    }],
    settings: {
      loyalty: {
        welcomeBonus: 0,
        // Use 1 (not 0): `Number(x) || 500` would treat 0 as missing.
        bronzeMinSpent: 1,
        tierMinSpent: { bronze: 1, silver: 1000, gold: 2000, platinum: 3000 },
        bronze: { bonusPercent: 10 },
        basic: { bonusPercent: 10 },
        silver: { bonusPercent: 2 },
        gold: { bonusPercent: 3 },
        platinum: { bonusPercent: 5 },
        vip: { bonusPercent: 10 },
      },
    },
    _seq: { order: 1000, product: 1, posSale: 0 },
  }
}

function makeHooks(db, { onSyncCard } = {}) {
  return {
    findCardByNum: (n) => (db.cards || []).find(c => String(c.num) === String(n)) || null,
    ensureCardRowForClient: (client) => makeHooks(db).findCardByNum(client.card),
    syncClientFromCardRow: (card) => {
      onSyncCard?.(card)
      const c = (db.clients || []).find(x =>
        x.card === card.num
        || String(x.phone || '') === String(card.phone || ''),
      )
      if (!c) return
      // Mirror production authority fields used after earn
      c.bonus = Number(card.bonus) || 0
      c.level = !card.level || card.level === '' ? 'basic' : card.level
      if (card.levelValidUntil != null) c.levelValidUntil = card.levelValidUntil
    },
  }
}

function seedBackend(backend, db) {
  for (const card of db.cards) backend.seed('cards', cardDocId(card), card)
  for (const client of db.clients) backend.seed('clients', String(client.id), client)
}

/** Simulate flushDbAsync snapshot persist (JSON shape). */
function simulateFlush(db) {
  return {
    cards: clone(db.cards),
    clients: clone(db.clients),
    orders: clone(db.orders),
  }
}

function broadcastFromDb(db) {
  const client = db.clients[0]
  return {
    phone: client.phone,
    bonus: client.bonus,
    card: client.card || '',
  }
}

const bodyEarn10 = {
  cashierId: 'C1',
  shiftId: 'SH1',
  posId: 'POS1',
  clientPhone: '+992900000001',
  clientName: 'Client',
  cardNum: 'CARD1',
  paymentMethod: 'cash',
  paidCash: 100,
  bonusSpent: 0,
  orderGoodsTotal: 100,
  items: [{ productId: 1, qty: 1, price: 100 }],
  clientRef: 'FIXE21-EARN',
}

test('post-earn hooks: bonus 100→110 survives reconcile + flush + broadcast', async () => {
  const backend = createMemoryEffectBackend()
  const db = baseDb()
  // VIP flat 10% of cashEligible(100) → earn 10 (avoids marginal 0% band)
  db.clients[0].vip = true
  db.cards[0].vip = true
  seedBackend(backend, db)
  const synced = []
  const hooks = makeHooks(db, { onSyncCard: (c) => synced.push(c) })

  const sale = createPosSale(db, bodyEarn10)
  const lr = await completePosSaleOnlineLoyalty(db, sale, bodyEarn10, hooks, {
    createOrder: (d, s, b) => createClientOrderFromPosSale(d, s, b),
    effectBackend: backend,
  })
  expect(lr.ok, 'loyalty ok')
  expect(lr.earnAppliedNow === true, 'earn applied')

  const card = db.cards.find(c => c.num === 'CARD1')
  const client = db.clients.find(c => c.id === 'CL1')
  expect(Number(card.bonus) === 110, `card.bonus=${card.bonus}`)
  expect(Number(client.bonus) === 110, `client.bonus=${client.bonus}`)
  expect(Number(backend.get('cards', 'num:CARD1').bonus) === 110, 'backend card')

  const flushed = simulateFlush(db)
  expect(Number(flushed.cards[0].bonus) === 110, 'flush cards.bonus')
  expect(Number(flushed.clients[0].bonus) === 110, 'flush clients.bonus')

  const bc = broadcastFromDb(db)
  expect(bc.bonus === 110, `broadcast=${bc.bonus}`)
})

test('stale pre-txn card ref cannot overwrite canonical after path', async () => {
  const backend = createMemoryEffectBackend()
  const db = baseDb()
  db.clients[0].vip = true
  db.cards[0].vip = true
  seedBackend(backend, db)
  const oldCard = db.cards[0]
  expect(oldCard.bonus === 100, 'pre bonus')

  const synced = []
  const hooks = makeHooks(db, { onSyncCard: (c) => synced.push(c) })

  const sale = createPosSale(db, { ...bodyEarn10, clientRef: 'FIXE21-STALE' })
  await completePosSaleOnlineLoyalty(db, sale, { ...bodyEarn10, clientRef: 'FIXE21-STALE' }, hooks, {
    createOrder: (d, s, b) => createClientOrderFromPosSale(d, s, b),
    effectBackend: backend,
  })

  const canonical = db.cards.find(c => c.num === 'CARD1')
  expect(canonical !== oldCard, 'reconcile replaced array slot')
  expect(Number(canonical.bonus) === 110, `canonical=${canonical.bonus}`)
  expect(Number(oldCard.bonus) === 100, 'orphan still 100')
  expect(synced.length >= 1, 'sync called')
  expect(synced.every(c => c !== oldCard), 'sync never received orphan')
  expect(synced.every(c => Number(c.bonus) === 110), 'sync used canonical bonus')

  oldCard.bonus = 100
  const flushed = simulateFlush(db)
  expect(Number(flushed.cards[0].bonus) === 110, 'flush ignores orphan')
  expect(Number(flushed.clients[0].bonus) === 110, 'flush client')
  expect(broadcastFromDb(db).bonus === 110, 'broadcast ignores orphan')
  expect(Number(db.clients[0].bonus) === 110, 'live client')
})

test('level upgrade mutates canonical db.cards and survives flush', async () => {
  const backend = createMemoryEffectBackend()
  const db = baseDb()
  // Non-VIP so applyLevelUpgrade runs; bronzeMinSpent=1 + order 100 → bronze
  db.clients[0].level = 'basic'
  db.clients[0].vip = false
  db.cards[0].level = ''
  db.cards[0].vip = false
  db.settings.loyalty.basic = { bonusPercent: 10 }
  seedBackend(backend, db)
  const hooks = makeHooks(db)

  const sale = createPosSale(db, { ...bodyEarn10, clientRef: 'FIXE21-LVL' })
  await completePosSaleOnlineLoyalty(db, sale, { ...bodyEarn10, clientRef: 'FIXE21-LVL' }, hooks, {
    createOrder: (d, s, b) => createClientOrderFromPosSale(d, s, b),
    effectBackend: backend,
  })

  const card = db.cards.find(c => c.num === 'CARD1')
  const client = db.clients.find(c => c.id === 'CL1')
  // Marginal: 1 som @0% + 99 @10% ≈ 10 → ~110
  expect(Number(card.bonus) === Number(client.bonus), 'card/client bonus mirror')
  expect(Number(card.bonus) >= 109 && Number(card.bonus) <= 110, `bonus=${card.bonus}`)
  expect(client.level === 'bronze', `client.level=${client.level}`)
  expect(String(card.level) === 'bronze', `card.level=${card.level}`)

  const flushed = simulateFlush(db)
  expect(flushed.cards[0].level === 'bronze', `flush card.level=${flushed.cards[0].level}`)
  expect(flushed.clients[0].level === 'bronze', `flush client.level=${flushed.clients[0].level}`)
  expect(Number(flushed.cards[0].bonus) === Number(card.bonus), 'flush card bonus')
  expect(Number(flushed.clients[0].bonus) === Number(card.bonus), 'flush client bonus')
})

await Promise.all(pending)

function runReg(label, script) {
  const r = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', timeout: 180000 })
  expect(r.status === 0, `${label}: ${(r.stderr || r.stdout || '').slice(-600)}`)
}

test('REGRESSION fixa', () => runReg('fixa', 'scripts/fixa-loyalty-underapply-test.mjs'))
test('REGRESSION fixe', () => runReg('fixe', 'scripts/fixe-order-loyalty-idempotency-test.mjs'))
test('REGRESSION fixe2', () => runReg('fixe2', 'scripts/fixe2-effect-txn-test.mjs'))

await Promise.all(pending)

const failed = results.filter(r => r.status === 'FAIL')
const report = {
  title: 'FIX E.2.1 — post-reconcile stale reference',
  generatedAtIso: new Date().toISOString(),
  passed: results.length - failed.length,
  failed: failed.length,
  results,
  cardsBonusAuthoritative: true,
}
fs.writeFileSync(path.join(root, 'scripts', 'fixe21-stale-reconcile-report.json'), JSON.stringify(report, null, 2))
console.log(`\nFIX E.2.1: ${report.passed}/${results.length} passed`)
if (failed.length) process.exitCode = 1
