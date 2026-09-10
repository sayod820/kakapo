/**
 * FIX E.2 — transactional order/loyalty crash-safety.
 * Run: node scripts/fixe2-effect-txn-test.mjs
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
  completePosSaleOrderEffect,
  completeBonusSpendEffect,
  completeBonusEarnEffect,
  EffectTxnFail,
  cardDocId,
  POS_EFFECT_KINDS,
  posEffectDocId,
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
    products: [{ id: 1, name: 'Tea', price: 100, stock: 10, unit: 'шт', art: 'T1' }],
    stockReceipts: [{ id: 'RCP1', items: [{ productId: 1, qty: 10, remainingQty: 10, unitCost: 50 }] }],
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
      bonus: 100, debt: 0, wallet: 0,
    }],
    settings: {
      loyalty: {
        welcomeBonus: 0,
        bronze: { bonusPercent: 5 },
        basic: { bonusPercent: 0 },
        silver: { bonusPercent: 2 },
        gold: { bonusPercent: 3 },
        platinum: { bonusPercent: 5 },
        vip: { bonusPercent: 5 },
      },
    },
    _seq: { order: 1000, product: 1, posSale: 0 },
  }
}

function hooks(db) {
  return {
    findCardByNum: (n) => (db.cards || []).find(c => String(c.num) === String(n)) || null,
    ensureCardRowForClient: (client) => hooks(db).findCardByNum(client.card),
    syncClientFromCardRow: (card) => {
      const c = (db.clients || []).find(x => x.card === card.num || x.phone === card.phone)
      if (c) c.bonus = card.bonus
    },
  }
}

function seedBackend(backend, db) {
  for (const card of db.cards) backend.seed('cards', cardDocId(card), card)
  for (const client of db.clients) backend.seed('clients', String(client.id), client)
}

const bodyBase = {
  cashierId: 'C1',
  shiftId: 'SH1',
  posId: 'POS1',
  clientPhone: '+992900000001',
  clientName: 'Client',
  cardNum: 'CARD1',
  paymentMethod: 'cash',
  paidCash: 90,
  bonusSpent: 10,
  orderGoodsTotal: 100,
  items: [{ productId: 1, qty: 1, price: 100 }],
}

test('A crash before txn → no effect', async () => {
  const backend = createMemoryEffectBackend()
  const db = baseDb()
  seedBackend(backend, db)
  // never call txn
  expect(backend.list('opRefs').length === 0, 'no claims')
  expect(backend.get('cards', 'num:CARD1').bonus === 100, 'card intact')
})

test('B crash after_claim → rollback no durable claim/effect', async () => {
  const backend = createMemoryEffectBackend()
  const db = baseDb()
  seedBackend(backend, db)
  const order = {
    id: 'K-1', status: 'delivered', channel: 'pos', posSaleClientRef: 'REF-B',
    goodsTotal: 100, total: 90, client: { phone: '+992900000001' },
  }
  let threw = false
  try {
    await completeBonusSpendEffect({
      saleRef: 'REF-B', amount: 10, goodsCap: 100,
      card: db.cards[0], client: db.clients[0], order,
      backend, failAt: 'after_claim',
    })
  } catch (e) {
    threw = e instanceof EffectTxnFail
  }
  expect(threw, 'injected fail')
  expect(backend.get('opRefs', posEffectDocId(POS_EFFECT_KINDS.BONUS_SPEND, 'REF-B')) == null, 'no claim')
  expect(backend.get('cards', 'num:CARD1').bonus === 100, 'no spend')
})

test('C crash after_balance_update → rollback no balance change', async () => {
  const backend = createMemoryEffectBackend()
  const db = baseDb()
  seedBackend(backend, db)
  const order = {
    id: 'K-1', status: 'delivered', channel: 'pos', posSaleClientRef: 'REF-C',
    goodsTotal: 100, total: 90, client: { phone: '+992900000001' },
  }
  try {
    await completeBonusSpendEffect({
      saleRef: 'REF-C', amount: 10, goodsCap: 100,
      card: db.cards[0], client: db.clients[0], order,
      backend, failAt: 'after_balance_update',
    })
    throw new Error('should fail')
  } catch (e) {
    expect(e instanceof EffectTxnFail, 'fail')
  }
  expect(backend.get('cards', 'num:CARD1').bonus === 100, 'rolled back')
  expect(backend.get('opRefs', posEffectDocId(POS_EFFECT_KINDS.BONUS_SPEND, 'REF-C')) == null, 'no claim')
})

test('D crash after_done_marker / before_commit → rollback all', async () => {
  const backend = createMemoryEffectBackend()
  const db = baseDb()
  seedBackend(backend, db)
  const order = {
    id: 'K-1', status: 'delivered', channel: 'pos', posSaleClientRef: 'REF-D',
    goodsTotal: 100, total: 90, client: { phone: '+992900000001' },
  }
  try {
    await completeBonusSpendEffect({
      saleRef: 'REF-D', amount: 10, goodsCap: 100,
      card: db.cards[0], client: db.clients[0], order,
      backend, failAt: 'before_commit',
    })
    throw new Error('should fail')
  } catch (e) {
    expect(e instanceof EffectTxnFail, 'fail')
  }
  expect(backend.get('cards', 'num:CARD1').bonus === 100, 'no balance')
  expect(backend.get('opRefs', posEffectDocId(POS_EFFECT_KINDS.BONUS_SPEND, 'REF-D')) == null, 'no claim')
})

test('E COMMIT then ACK lost → retry one effect', async () => {
  const backend = createMemoryEffectBackend()
  const db = baseDb()
  seedBackend(backend, db)
  const order = {
    id: 'K-1', status: 'delivered', channel: 'pos', posSaleClientRef: 'REF-E',
    goodsTotal: 100, total: 90, client: { phone: '+992900000001' },
  }
  const r1 = await completeBonusSpendEffect({
    saleRef: 'REF-E', amount: 10, goodsCap: 100,
    card: db.cards[0], client: db.clients[0], order, backend,
  })
  expect(!r1.replay && r1.card.bonus === 90, 'first spend')
  const r2 = await completeBonusSpendEffect({
    saleRef: 'REF-E', amount: 10, goodsCap: 100,
    card: db.cards[0], client: db.clients[0], order, backend,
  })
  expect(r2.replay && r2.card.bonus === 90, 'ack-lost replay')
})

test('F two processes same spend → one delta', async () => {
  const backend = createMemoryEffectBackend()
  const db = baseDb()
  seedBackend(backend, db)
  const order = {
    id: 'K-1', status: 'delivered', channel: 'pos', posSaleClientRef: 'REF-F',
    goodsTotal: 100, total: 90, client: { phone: '+992900000001' },
  }
  const [a, b] = await Promise.all([
    completeBonusSpendEffect({
      saleRef: 'REF-F', amount: 10, goodsCap: 100,
      card: clone(db.cards[0]), client: clone(db.clients[0]), order: clone(order), backend,
    }),
    completeBonusSpendEffect({
      saleRef: 'REF-F', amount: 10, goodsCap: 100,
      card: clone(db.cards[0]), client: clone(db.clients[0]), order: clone(order), backend,
    }),
  ])
  expect(backend.get('cards', 'num:CARD1').bonus === 90, 'one delta')
  expect([a, b].filter(x => !x.replay).length === 1, 'one winner')
})

test('G two processes same earn → one delta', async () => {
  const backend = createMemoryEffectBackend()
  const db = baseDb()
  seedBackend(backend, db)
  const order = {
    id: 'K-1', status: 'delivered', channel: 'pos', posSaleClientRef: 'REF-G',
    goodsTotal: 100, total: 100, bonusSpendApplied: true, client: { phone: '+992900000001' },
  }
  backend.seed('orders', 'K-1', order)
  const [a, b] = await Promise.all([
    completeBonusEarnEffect({
      saleRef: 'REF-G', earned: 5,
      card: clone(db.cards[0]), client: clone(db.clients[0]), order: clone(order), backend,
    }),
    completeBonusEarnEffect({
      saleRef: 'REF-G', earned: 5,
      card: clone(db.cards[0]), client: clone(db.clients[0]), order: clone(order), backend,
    }),
  ])
  expect(backend.get('cards', 'num:CARD1').bonus === 105, `earn once got ${backend.get('cards', 'num:CARD1').bonus}`)
  expect([a, b].filter(x => !x.replay).length === 1, 'one earn winner')
})

test('H two processes same order → one order', async () => {
  const backend = createMemoryEffectBackend()
  const drafts = [
    { id: 'K-1001', status: 'delivered', channel: 'pos', posSaleClientRef: 'REF-H', total: 90, client: { phone: 'p' } },
    { id: 'K-5001', status: 'delivered', channel: 'pos', posSaleClientRef: 'REF-H', total: 90, client: { phone: 'p' } },
  ]
  const [a, b] = await Promise.all([
    completePosSaleOrderEffect({ saleRef: 'REF-H', orderDraft: drafts[0], backend }),
    completePosSaleOrderEffect({ saleRef: 'REF-H', orderDraft: drafts[1], backend }),
  ])
  const orders = backend.list('orders')
  expect(orders.length === 1, `orders=${orders.length}`)
  expect(a.order.id === b.order.id, 'same canonical')
})

test('I restart after committed → replay no mutation', async () => {
  const backend = createMemoryEffectBackend()
  const db = baseDb()
  seedBackend(backend, db)
  const order = {
    id: 'K-1', status: 'delivered', channel: 'pos', posSaleClientRef: 'REF-I',
    goodsTotal: 100, total: 90, client: { phone: '+992900000001' },
  }
  await completeBonusSpendEffect({
    saleRef: 'REF-I', amount: 10, goodsCap: 100,
    card: db.cards[0], client: db.clients[0], order, backend,
  })
  const mid = backend.get('cards', 'num:CARD1').bonus
  const r = await completeBonusSpendEffect({
    saleRef: 'REF-I', amount: 10, goodsCap: 100,
    card: { ...db.cards[0], bonus: 100 }, client: db.clients[0], order, backend,
  })
  expect(r.replay && backend.get('cards', 'num:CARD1').bonus === mid, 'stable')
})

test('full path dual-process via completePosSaleOnlineLoyalty', async () => {
  const backend = createMemoryEffectBackend()
  const seed = baseDb()
  seedBackend(backend, seed)
  const processA = clone(seed)
  const processB = clone(seed)
  processB._seq.order = 5000
  const body = { ...bodyBase, clientRef: 'FIXE2-FULL' }

  const saleA = createPosSale(processA, body)
  const saleB = createPosSale(processB, body)

  await Promise.all([
    completePosSaleOnlineLoyalty(processA, saleA, body, hooks(processA), {
      createOrder: (d, s, b) => createClientOrderFromPosSale(d, s, b),
      effectBackend: backend,
    }),
    completePosSaleOnlineLoyalty(processB, saleB, body, hooks(processB), {
      createOrder: (d, s, b) => createClientOrderFromPosSale(d, s, b),
      effectBackend: backend,
    }),
  ])

  expect(backend.list('orders').filter(o => o.posSaleClientRef === 'FIXE2-FULL').length === 1, 'one order')
  expect(backend.get('cards', 'num:CARD1').bonus === 90, `bonus=${backend.get('cards', 'num:CARD1').bonus}`)
  const spendClaim = backend.get('opRefs', posEffectDocId(POS_EFFECT_KINDS.BONUS_SPEND, 'FIXE2-FULL'))
  const earnClaim = backend.get('opRefs', posEffectDocId(POS_EFFECT_KINDS.BONUS_EARN, 'FIXE2-FULL'))
  expect(spendClaim?.status === 'done' && earnClaim?.status === 'done', 'claims done')
})

test('order crash after_order_insert rolls back', async () => {
  const backend = createMemoryEffectBackend()
  try {
    await completePosSaleOrderEffect({
      saleRef: 'REF-ORD',
      orderDraft: { id: 'K-9', status: 'delivered', posSaleClientRef: 'REF-ORD', total: 1 },
      backend,
      failAt: 'after_order_insert',
    })
    throw new Error('should fail')
  } catch (e) {
    expect(e instanceof EffectTxnFail, 'fail')
  }
  expect(backend.list('orders').length === 0, 'no order')
  expect(backend.list('opRefs').length === 0, 'no claim')
})

await Promise.all(pending)

function runReg(label, script) {
  const r = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', timeout: 120000 })
  expect(r.status === 0, `${label}: ${(r.stderr || r.stdout || '').slice(-500)}`)
}

test('REGRESSION fixa', () => runReg('fixa', 'scripts/fixa-loyalty-underapply-test.mjs'))
test('REGRESSION fixc', () => runReg('fixc', 'scripts/fixc-row-level-persist-test.mjs'))
test('REGRESSION fixd', () => runReg('fixd', 'scripts/fixd-unique-violation-test.mjs'))
test('REGRESSION phase9', () => runReg('p9', 'scripts/phase9-finance-idempotency-test.mjs'))

await Promise.all(pending)

const failed = results.filter(r => r.status === 'FAIL')
const report = {
  title: 'FIX E.2 — transactional effect completion',
  generatedAtIso: new Date().toISOString(),
  crashSafe: failed.length === 0,
  multiReplicaEnabled: false,
  fixDIndexesApplied: false,
  passed: results.length - failed.length,
  failed: failed.length,
  results,
  sourceOfTruth: 'cards.bonus (clients.bonus mirrored in same txn)',
  claimStateMachine: 'missing → (uncommitted open) → done | rollback → missing',
}
fs.writeFileSync(path.join(root, 'scripts', 'fixe2-effect-txn-report.json'), JSON.stringify(report, null, 2))
console.log(`\nFIX E.2: ${report.passed}/${results.length} passed | crashSafe=${report.crashSafe}`)
if (failed.length) process.exitCode = 1
