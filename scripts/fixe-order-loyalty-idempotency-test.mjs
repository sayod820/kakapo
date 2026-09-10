/**
 * FIX E — Order + loyalty cross-process idempotency (claim-before-mutate).
 * Run: node scripts/fixe-order-loyalty-idempotency-test.mjs
 *
 * Does NOT enable multi-replica. No production UNIQUE migration required
 * (uses docs PK claim rows: op:pos_sale_order|pos_bonus_spend|pos_bonus_earn:{ref}).
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
  createMemoryClaimStore,
  claimPosEffect,
  updatePosEffect,
  readPosEffect,
  POS_EFFECT_KINDS,
  posEffectDocId,
} = await import(pathToFileURL(path.join(apiRoot, 'pg', 'idempotentClaim.js')).href)

const {
  findInMemoryUniqueConflict,
  makePgUniqueViolationError,
  classifyUniqueViolation,
  applyIdempotencyConflictsToSnapshot,
} = await import(pathToFileURL(path.join(apiRoot, 'pg', 'uniqueIdempotency.js')).href)

const { rowIdForItem } = await import(pathToFileURL(path.join(apiRoot, 'pg', 'store.js')).href)
const { createPosSale, createClientOrderFromPosSale } = await import(
  pathToFileURL(path.join(apiRoot, 'posLogic.js')).href
)
const { completePosSaleOnlineLoyalty } = await import(
  pathToFileURL(path.join(apiRoot, 'loyaltyBonus.js')).href
)

function clone(x) { return structuredClone(x) }

function baseDb() {
  return {
    products: [{ id: 1, name: 'Test Tea', price: 100, stock: 10, unit: 'шт', sellType: 'piece', art: 'T1', e: '🍵' }],
    stockReceipts: [{ id: 'RCP1', items: [{ productId: 1, qty: 10, remainingQty: 10, unitCost: 50 }] }],
    cashiers: [{ id: 'C1', name: 'Cashier', salesCount: 0, salesTotal: 0 }],
    posShifts: [{
      id: 'SH1', status: 'open', posId: 'POS1', cashierId: 'C1', cashierName: 'Cashier',
      salesCount: 0, salesCash: 0, salesCard: 0, salesCredit: 0, salesWallet: 0,
    }],
    posPoints: [{ id: 'POS1', name: 'Main' }],
    posSales: [],
    moneyLedger: [],
    financeMoves: [],
    opRefs: [],
    orders: [],
    clients: [{
      id: 'CL1', name: 'Client', phone: '+992900000001', card: 'CARD1',
      bonus: 100, debt: 0, wallet: 0, level: 'bronze',
    }],
    cards: [{
      num: 'CARD1', phone: '+992900000001', clientId: 'CL1', client: 'Client',
      bonus: 100, debt: 0, wallet: 0, debtPayVersion: 0, bonusPayVersion: 0,
    }],
    cashVault: { cashTotal: 0, cardTotal: 0, vaultVersion: 0, transfers: [], converts: [] },
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
    _seq: { order: 1000, product: 1, category: 1, posSale: 0 },
  }
}

function hooksFor(db) {
  return {
    findCardByNum: (num) => (db.cards || []).find(c => String(c.num) === String(num)) || null,
    ensureCardRowForClient: (client) => {
      const num = String(client.card || '').trim()
      if (!num) return null
      let card = (db.cards || []).find(c => String(c.num) === num)
      if (!card) {
        card = { num, phone: client.phone, clientId: client.id, bonus: client.bonus || 0, debt: 0, wallet: 0 }
        db.cards.push(card)
      }
      return card
    },
    syncClientFromCardRow: (card) => {
      const client = (db.clients || []).find(c => c.card === card.num || (card.phone && c.phone === card.phone))
      if (client) client.bonus = card.bonus
    },
  }
}

function createSharedPg() {
  const docs = new Map()
  const pk = (c, id) => `${c}\0${id}`
  function all() { return [...docs.values()] }
  function persist(snapshot) {
    const conflicts = []
    const docRows = []
    for (const [col, value] of Object.entries(snapshot || {})) {
      if (!Array.isArray(value)) continue
      const used = new Set()
      for (let i = 0; i < value.length; i++) {
        let id = value[i]?.id != null && String(value[i].id) !== ''
          ? String(value[i].id)
          : rowIdForItem(value[i], i)
        if (used.has(id)) id = `${id}#${i}`
        used.add(id)
        docRows.push({ key: col, id, data: value[i], sortIdx: i })
      }
    }
    for (const r of docRows) {
      const conflict = findInMemoryUniqueConflict(all(), r.key, r.id, r.data)
      if (conflict) {
        const err = makePgUniqueViolationError(conflict.constraint)
        expect(classifyUniqueViolation(err)?.known, 'known 23505')
        const existing = docs.get(pk(conflict.collection, conflict.existingId))
        conflicts.push({
          constraint: conflict.constraint,
          collection: conflict.collection,
          attemptedId: r.id,
          existingId: existing.id,
          existingData: existing.data,
        })
        continue
      }
      const k = pk(r.key, r.id)
      const prev = docs.get(k)
      if (prev) docs.set(k, { ...prev, data: clone(r.data) })
      else docs.set(k, { collection: r.key, id: r.id, data: clone(r.data), sortIdx: r.sortIdx })
    }
    applyIdempotencyConflictsToSnapshot(snapshot, conflicts)
    return { conflicts }
  }
  function list(col) { return all().filter(r => r.collection === col).map(r => r.data) }
  return { persist, list }
}

async function runSaleOnProcess(db, body, sharedPg, claimStore) {
  const clientRef = String(body.clientRef || '').trim()
  const dup = (db.posSales || []).find(s => s.clientRef === clientRef)
  if (dup) return { sale: dup, replay: true }

  const sale = createPosSale(db, body)
  if (sale._idempotentReplay) delete sale._idempotentReplay

  const claim = {
    claimEffect: claimPosEffect,
    updateEffect: updatePosEffect,
    readEffect: readPosEffect,
    store: claimStore,
  }

  if (sale.clientPhone) {
    const lr = await completePosSaleOnlineLoyalty(db, sale, body, hooksFor(db), {
      createOrder: (d, s, b) => createClientOrderFromPosSale(d, s, b),
      claim,
    })
    expect(lr.ok, lr.error || 'loyalty ok')
  }

  sharedPg.persist({
    posSales: db.posSales,
    moneyLedger: db.moneyLedger,
    financeMoves: db.financeMoves || [],
    opRefs: db.opRefs,
    orders: db.orders,
    cards: db.cards,
    clients: db.clients,
  })

  return { sale, claimStore }
}

const REF = 'FIXE-CROSS-1'
const body = {
  clientRef: REF,
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

test('wiring: effect txn + route', () => {
  expect(posEffectDocId(POS_EFFECT_KINDS.ORDER, 'x') === 'op:pos_sale_order:x', 'order id')
  const indexSrc = fs.readFileSync(path.join(apiRoot, 'index.js'), 'utf8')
  expect(indexSrc.includes('completePosSaleOnlineLoyalty'), 'wired')
  const lb = fs.readFileSync(path.join(apiRoot, 'loyaltyBonus.js'), 'utf8')
  expect(lb.includes('completeBonusSpendEffect'), 'E.2 spend txn')
})

test('dual-process same clientRef → one order + one spend + one earn', async () => {
  const { createMemoryEffectBackend, cardDocId } = await import(
    pathToFileURL(path.join(apiRoot, 'pg', 'effectTxn.js')).href
  )
  const backend = createMemoryEffectBackend()
  const seed = baseDb()
  for (const card of seed.cards) backend.seed('cards', cardDocId(card), card)
  for (const client of seed.clients) backend.seed('clients', String(client.id), client)
  const processA = clone(seed)
  const processB = clone(seed)
  processB._seq.order = 5000

  const saleA = createPosSale(processA, body)
  const saleB = createPosSale(processB, body)

  await Promise.all([
    completePosSaleOnlineLoyalty(processA, saleA, body, hooksFor(processA), {
      createOrder: (d, s, b) => createClientOrderFromPosSale(d, s, b),
      effectBackend: backend,
    }),
    completePosSaleOnlineLoyalty(processB, saleB, body, hooksFor(processB), {
      createOrder: (d, s, b) => createClientOrderFromPosSale(d, s, b),
      effectBackend: backend,
    }),
  ])

  const orders = backend.list('orders').filter(o => String(o.posSaleClientRef || '') === REF)
  expect(orders.length === 1, `orders=${orders.length}`)
  expect(backend.get('cards', 'num:CARD1').bonus === 90, 'one spend')
  const spend = backend.get('opRefs', posEffectDocId(POS_EFFECT_KINDS.BONUS_SPEND, REF))
  const earn = backend.get('opRefs', posEffectDocId(POS_EFFECT_KINDS.BONUS_EARN, REF))
  const orderClaim = backend.get('opRefs', posEffectDocId(POS_EFFECT_KINDS.ORDER, REF))
  expect(orderClaim?.status === 'done' && spend?.status === 'done' && earn?.status === 'done', 'done')
})

test('ACK lost retry → no second order/loyalty', async () => {
  const { createMemoryEffectBackend, cardDocId } = await import(
    pathToFileURL(path.join(apiRoot, 'pg', 'effectTxn.js')).href
  )
  const backend = createMemoryEffectBackend()
  const db = baseDb()
  for (const card of db.cards) backend.seed('cards', cardDocId(card), card)
  for (const client of db.clients) backend.seed('clients', String(client.id), client)
  const sale = createPosSale(db, body)
  await completePosSaleOnlineLoyalty(db, sale, body, hooksFor(db), {
    createOrder: (d, s, b) => createClientOrderFromPosSale(d, s, b),
    effectBackend: backend,
  })
  const orders1 = backend.list('orders').length
  const bonus1 = backend.get('cards', 'num:CARD1').bonus
  await completePosSaleOnlineLoyalty(db, sale, body, hooksFor(db), {
    createOrder: (d, s, b) => createClientOrderFromPosSale(d, s, b),
    effectBackend: backend,
  })
  expect(backend.list('orders').length === orders1, 'no second order')
  expect(backend.get('cards', 'num:CARD1').bonus === bonus1, 'no second loyalty')
})

test('skipBalances → no online loyalty', async () => {
  const db = baseDb()
  const sale = createPosSale(db, { ...body, clientRef: 'FIXE-SKIP', skipBalances: true, appliedLocal: true, bonusEarned: 2 })
  const lr = await completePosSaleOnlineLoyalty(db, sale, { ...body, clientRef: 'FIXE-SKIP', skipBalances: true }, hooksFor(db), {
    createOrder: (d, s, b) => createClientOrderFromPosSale(d, s, b),
  })
  expect(lr.skipped, 'skipped')
})

test('zero spend still completes spend+earn once', async () => {
  const { createMemoryEffectBackend, cardDocId } = await import(
    pathToFileURL(path.join(apiRoot, 'pg', 'effectTxn.js')).href
  )
  const backend = createMemoryEffectBackend()
  const db = baseDb()
  for (const card of db.cards) backend.seed('cards', cardDocId(card), card)
  for (const client of db.clients) backend.seed('clients', String(client.id), client)
  const b = { ...body, clientRef: 'FIXE-ZERO', bonusSpent: 0, paidCash: 100 }
  const sale = createPosSale(db, b)
  await completePosSaleOnlineLoyalty(db, sale, b, hooksFor(db), {
    createOrder: (d, s, x) => createClientOrderFromPosSale(d, s, x),
    effectBackend: backend,
  })
  const spend = backend.get('opRefs', posEffectDocId(POS_EFFECT_KINDS.BONUS_SPEND, 'FIXE-ZERO'))
  const earn = backend.get('opRefs', posEffectDocId(POS_EFFECT_KINDS.BONUS_EARN, 'FIXE-ZERO'))
  expect(spend?.status === 'done' && earn?.status === 'done', 'claims done')
  expect(backend.list('orders').length === 1, 'one order')
})

await Promise.all(pending)

function runRegression(label, script) {
  const r = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', timeout: 120000 })
  expect(r.status === 0, `${label} exit ${r.status}: ${(r.stderr || r.stdout || '').slice(-400)}`)
}

test('REGRESSION fixa', () => runRegression('fixa', 'scripts/fixa-loyalty-underapply-test.mjs'))
test('REGRESSION fixc', () => runRegression('fixc', 'scripts/fixc-row-level-persist-test.mjs'))
test('REGRESSION phase9', () => runRegression('p9', 'scripts/phase9-finance-idempotency-test.mjs'))

await Promise.all(pending)

const failed = results.filter(r => r.status === 'FAIL')
const report = {
  title: 'FIX E — Order + Loyalty (superseded crash-safety by FIX E.2 txn)',
  generatedAtIso: new Date().toISOString(),
  multiReplicaEnabled: false,
  migrationRequired: false,
  mechanism: {
    order: 'completePosSaleOrderEffect txn',
    spend: 'completeBonusSpendEffect txn',
    earn: 'completeBonusEarnEffect txn',
  },
  passed: results.filter(r => r.status === 'PASS').length,
  failed: failed.length,
  results,
}
fs.writeFileSync(path.join(root, 'scripts', 'fixe-order-loyalty-idempotency-report.json'), JSON.stringify(report, null, 2))
console.log(`\nFIX E: ${report.passed}/${results.length} passed`)
console.log('migrationRequired: false | multi-replica: false')
if (failed.length) process.exitCode = 1
