/**
 * FIX A — Online loyalty under-apply repair (P10-LOYALTY-UNDER).
 * Run: node scripts/fixa-loyalty-underapply-test.mjs
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
  createPosSale,
  createClientOrderFromPosSale,
  ensurePosCollections,
} = await import(pathToFileURL(path.join(apiRoot, 'posLogic.js')).href)
const {
  applyBonusSpendOnOrder,
  applyClientLoyaltyAfterDelivery,
  completePosSaleOnlineLoyalty,
  creditClientBonusOnDelivery,
} = await import(pathToFileURL(path.join(apiRoot, 'loyaltyBonus.js')).href)

function hooks(db) {
  return {
    findCardByNum: (n) => (db.cards || []).find(c => String(c.num).toUpperCase() === String(n).toUpperCase()) || null,
    ensureCardRowForClient: (client) => {
      if (!client?.card) return null
      return hooks(db).findCardByNum(client.card)
    },
    syncClientFromCardRow: (card) => {
      const client = (db.clients || []).find(c =>
        c.card === card.num || (card.phone && c.phone === card.phone),
      )
      if (client) {
        client.bonus = card.bonus
        client.debt = card.debt
        client.wallet = card.wallet
      }
    },
  }
}

function freshDb() {
  const db = {
    moneyLedger: [],
    financeMoves: [],
    posSales: [],
    posShifts: [],
    posPoints: [{ id: 'POS-1', name: 'Test', active: true }],
    cashiers: [{ id: 'CASH-1', name: 'Кассир', salesCount: 0, salesTotal: 0 }],
    products: [{ id: 101, name: 'Хлеб', price: 100, stock: 10000, costPrice: 20, unit: 'шт' }],
    clients: [{
      id: 'CL-1', name: 'Иван', phone: '996700000001', card: 'VIP001',
      debt: 0, bonus: 200, wallet: 0, level: 'bronze',
    }],
    cards: [{
      num: 'VIP001', client: 'Иван', phone: '996700000001',
      debt: 0, bonus: 200, wallet: 0, posCashBonus: 200,
      debtPayVersion: 0, bonusPayVersion: 0, level: 'bronze',
    }],
    orders: [],
    expenses: [],
    suppliers: [],
    supplierPayments: [],
    cashVault: { cashTotal: 0, cardTotal: 0, transfers: [], converts: [] },
    writeOffs: [],
    stockReceipts: [{
      id: 'REC-1',
      createdAtIso: new Date().toISOString(),
      items: [{ productId: 101, productName: 'Хлеб', qty: 10000, remainingQty: 10000, costPrice: 20, retailPrice: 100 }],
    }],
    settings: {
      loyalty: {
        welcomeBonus: 0,
        bronzeMinSpent: 0,
        cashDepositTiers: [],
        tierMinSpent: { bronze: 0, silver: 1000, gold: 2000, platinum: 3000 },
        basic: { bonusPercent: 0 },
        bronze: { bonusPercent: 10 },
        silver: { bonusPercent: 2 },
        gold: { bonusPercent: 3 },
        platinum: { bonusPercent: 5 },
        vip: { bonusPercent: 5, defaultDebtLimit: 5000 },
        vipRules: { minOrders: 99, minReviews: 99, minSpent: 999999 },
      },
    },
  }
  ensurePosCollections(db)
  db.posShifts.push({
    id: 'SH-1', posId: 'POS-1', status: 'open', cashierId: 'CASH-1', cashierName: 'Кассир',
    openingCash: 0, salesCash: 0, salesCard: 0, salesCredit: 0, salesWallet: 0,
    salesCount: 0, cashInTotal: 0, expenseTotal: 0,
  })
  return db
}

function onlineSale(ref, extra = {}) {
  return {
    clientRef: ref,
    cashierId: 'CASH-1',
    shiftId: 'SH-1',
    posId: 'POS-1',
    clientId: 'CL-1',
    clientPhone: '996700000001',
    clientName: 'Иван',
    cardNum: 'VIP001',
    items: [{ productId: 101, productName: 'Хлеб', qty: 1, price: 100, lineTotal: 100 }],
    paidCash: 100,
    paidCard: 0,
    paidWallet: 0,
    debtAdded: 0,
    bonusSpent: 0,
    paymentMethod: 'cash',
    appliedLocal: false,
    skipBalances: false,
    ...extra,
  }
}

/** Simulate POST /pos/sales loyalty completion path (incl. early dup). */
async function postSaleOnce(db, body) {
  const clientRef = String(body.clientRef || '').trim()
  const existing = clientRef
    ? (db.posSales || []).find(s => s.clientRef === clientRef)
    : null
  let sale = existing
  let replay = false
  if (sale) {
    sale._idempotentReplay = true
    replay = true
  } else {
    sale = createPosSale(db, body)
    replay = !!sale._idempotentReplay
    if (replay) delete sale._idempotentReplay
  }
  if (sale._idempotentReplay) delete sale._idempotentReplay

  const lr = await completePosSaleOnlineLoyalty(db, sale, body, hooks(db), {
    createOrder: (d, s, b) => createClientOrderFromPosSale(d, s, b),
  })
  return { sale, lr, replay: replay || !!existing }
}

test('A sale+loyalty success → retry loyalty once', async () => {
  const db = freshDb()
  const body = onlineSale('A-1')
  const r1 = await postSaleOnce(db, body)
  expect(r1.lr.ok && r1.lr.order?.bonusCredited && r1.lr.order?.bonusSpendApplied, 'first complete')
  const bonus1 = Number(db.cards[0].bonus)
  const r2 = await postSaleOnce(db, body)
  expect(r2.lr.ok && r2.lr.order?.bonusCredited, 'still credited')
  expect(!r2.lr.earnAppliedNow && !r2.lr.spendAppliedNow, 'second retry no re-apply')
  expect(Number(db.cards[0].bonus) === bonus1, 'bonus unchanged on retry')
  expect(db.posSales.length === 1 && db.orders.length === 1, 'one sale/order')
})

test('B sale ok + loyalty missing → retry repairs once', async () => {
  const db = freshDb()
  const body = onlineSale('B-1')
  const sale = createPosSale(db, body)
  const order = createClientOrderFromPosSale(db, sale, body)
  // spend applied, earn missing
  applyBonusSpendOnOrder(db, order, Number(body.bonusSpent) || 0, hooks(db))
  expect(order.bonusSpendApplied && !order.bonusCredited, 'partial')
  const before = Number(db.cards[0].bonus)
  // Simulate route early-dup / replay completion
  const lr = await completePosSaleOnlineLoyalty(db, sale, body, hooks(db), {
    createOrder: (d, s, b) => createClientOrderFromPosSale(d, s, b),
  })
  expect(lr.ok && lr.earnAppliedNow && order.bonusCredited, 'repaired earn')
  const mid = Number(db.cards[0].bonus)
  expect(mid !== before || (Number(order.bonusEarned) === 0 && order.bonusCredited), 'earn marker set')
  const lr2 = await completePosSaleOnlineLoyalty(db, sale, body, hooks(db), {
    createOrder: (d, s, b) => createClientOrderFromPosSale(d, s, b),
  })
  expect(!lr2.earnAppliedNow && Number(db.cards[0].bonus) === mid, 'second repair no-op')
})

test('C failure → retry twice → still one effect', async () => {
  const db = freshDb()
  const body = onlineSale('C-1', { bonusSpent: 20, paidCash: 80 })
  const sale = createPosSale(db, body)
  createClientOrderFromPosSale(db, sale, body)
  await postSaleOnce(db, body)
  const order = db.orders[0]
  expect(order.bonusSpendApplied && order.bonusCredited, 'markers set')
  const b1 = Number(db.cards[0].bonus)
  expect(Number(order.bonusSpent) === 20, 'spent 20 once')
  await postSaleOnce(db, body)
  await postSaleOnce(db, body)
  expect(Number(db.cards[0].bonus) === b1, 'stable after double retry')
  expect(Number(order.bonusSpent) === 20 && db.orders.length === 1, 'one spend/order')
})

test('D ACK lost after loyalty success → no duplicate', async () => {
  const db = freshDb()
  const body = onlineSale('D-1', { bonusSpent: 10, paidCash: 90 })
  const r1 = await postSaleOnce(db, body)
  const b1 = Number(db.cards[0].bonus)
  expect(r1.lr.order.bonusSpendApplied && r1.lr.order.bonusCredited, 'complete')
  const r2 = await postSaleOnce(db, body)
  expect(!r2.lr.spendAppliedNow && !r2.lr.earnAppliedNow, 'ack-lost retry idle')
  expect(Number(db.cards[0].bonus) === b1, 'no dup')
})

test('E concurrent retry same clientRef → one loyalty', async () => {
  const db = freshDb()
  const body = onlineSale('E-1')
  const sale = createPosSale(db, body)
  createClientOrderFromPosSale(db, sale, body)
  const before = Number(db.cards[0].bonus)
  await Promise.all([
    completePosSaleOnlineLoyalty(db, sale, body, hooks(db), {
      createOrder: (d, s, b) => createClientOrderFromPosSale(d, s, b),
    }),
    completePosSaleOnlineLoyalty(db, sale, body, hooks(db), {
      createOrder: (d, s, b) => createClientOrderFromPosSale(d, s, b),
    }),
  ])
  const order = db.orders[0]
  expect(order.bonusCredited, 'credited')
  const after = Number(db.cards[0].bonus)
  creditClientBonusOnDelivery(db, order, hooks(db))
  expect(Number(db.cards[0].bonus) === after, 'credit idempotent')
  expect(after >= before, 'bonus moved at most once directionally')
})

test('F skipBalances local-first → no online loyalty on replay', async () => {
  const db = freshDb()
  const body = onlineSale('F-1', {
    appliedLocal: true,
    skipBalances: true,
    bonusSpent: 15,
    bonusEarned: 3,
    paidCash: 85,
    expectedBonusPayVersion: 0,
  })
  const sale = createPosSale(db, body)
  const bonusAfterLocal = Number(db.cards[0].bonus)
  expect(bonusAfterLocal === 200 - 15 + 3, `local skipBalances applied: ${bonusAfterLocal}`)
  const lr = await completePosSaleOnlineLoyalty(db, sale, body, hooks(db), {
    createOrder: (d, s, b) => createClientOrderFromPosSale(d, s, b),
  })
  expect(lr.skipped, 'online completion skipped')
  expect(Number(db.cards[0].bonus) === bonusAfterLocal, 'no second online loyalty')
  const order = createClientOrderFromPosSale(db, sale, body)
  expect(!order.bonusCredited, 'order not auto-credited via skip path')
})

test('zero-loyalty sale still sets durable markers', async () => {
  const db = freshDb()
  db.settings.loyalty.bronze.bonusPercent = 0
  db.clients[0].level = 'basic'
  db.cards[0].level = 'basic'
  const body = onlineSale('Z-1', { bonusSpent: 0 })
  const r = await postSaleOnce(db, body)
  expect(r.lr.ok && r.lr.order.bonusSpendApplied && r.lr.order.bonusCredited, 'markers even if earned 0')
  const b = Number(db.cards[0].bonus)
  await postSaleOnce(db, body)
  expect(Number(db.cards[0].bonus) === b, 'retry stable')
})

test('spend-only repair without re-spend', async () => {
  const db = freshDb()
  const body = onlineSale('S-1', { bonusSpent: 25, paidCash: 75 })
  const sale = createPosSale(db, body)
  const order = createClientOrderFromPosSale(db, sale, body)
  applyBonusSpendOnOrder(db, order, 25, hooks(db))
  expect(order.bonusSpendApplied && !order.bonusCredited, 'spend done earn missing')
  const spentAmt = Number(order.bonusSpent)
  await completePosSaleOnlineLoyalty(db, sale, body, hooks(db), {
    createOrder: (d, s, b) => createClientOrderFromPosSale(d, s, b),
  })
  expect(order.bonusCredited, 'earn repaired')
  expect(Number(order.bonusSpent) === spentAmt, 'spend amount unchanged')
  const again = applyBonusSpendOnOrder(db, order, 25, hooks(db))
  expect(again.replay && Number(order.bonusSpent) === spentAmt, 'spend replay no-op')
})

test('source wiring: route uses completePosSaleOnlineLoyalty', () => {
  const indexSrc = fs.readFileSync(path.join(apiRoot, 'index.js'), 'utf8')
  expect(indexSrc.includes('completePosSaleOnlineLoyalty'), 'imported/used')
  expect(indexSrc.includes('finishLoyalty'), 'dup path calls finishLoyalty')
  const lb = fs.readFileSync(path.join(apiRoot, 'loyaltyBonus.js'), 'utf8')
  expect(lb.includes('bonusSpendApplied') && lb.includes('bonusCredited'), 'markers')
  expect(lb.includes('completeBonusSpendEffect') || lb.includes('effectTxn'), 'FIX E.2 txn path')
})

await Promise.all(pending)

// G regression
for (const script of ['phase9-finance-idempotency-test.mjs', 'phase10-stress-consistency-test.mjs']) {
  test(`G regression ${script}`, () => {
    const r = spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
      cwd: root, encoding: 'utf8', timeout: 120_000,
    })
    expect(r.status === 0, r.stderr || r.stdout?.slice(-500) || `exit ${r.status}`)
  })
}

await Promise.all(pending)

const failed = results.filter(r => r.status === 'FAIL')
const report = {
  fix: 'A',
  issue: 'P10-LOYALTY-UNDER',
  generatedAtIso: new Date().toISOString(),
  summary: { total: results.length, passed: results.length - failed.length, failed: failed.length },
  results,
  markers: ['order.bonusSpendApplied', 'order.bonusCredited'],
}
fs.writeFileSync(path.join(root, 'scripts', 'fixa-loyalty-underapply-report.json'), JSON.stringify(report, null, 2))
console.log(`\nFIX A: ${report.summary.passed}/${report.summary.total} passed`)
if (failed.length) process.exit(1)
