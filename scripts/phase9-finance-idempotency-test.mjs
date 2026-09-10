/**
 * Phase 9 — Finance / Debt / Loyalty side-effect idempotency.
 * Run: node scripts/phase9-finance-idempotency-test.mjs
 *
 * Behavioral tests against server modules + source wiring guards.
 * No DB schema migration.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiRoot = path.join(root, 'server', 'kakapo-api')

const results = []
function test(name, fn) {
  try {
    const out = fn()
    if (out && typeof out.then === 'function') {
      return out.then(() => {
        results.push({ name, status: 'PASS' })
        console.log(`PASS  ${name}`)
      }).catch(e => {
        results.push({ name, status: 'FAIL', error: String(e?.message || e) })
        console.error(`FAIL  ${name}: ${e?.message || e}`)
      })
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

const { appendMoneyLedger } = await import(pathToFileURL(path.join(apiRoot, 'financeTruth.js')).href)
const {
  createPosSale,
  createClientOrderFromPosSale,
  returnPosSale,
  createFinanceMove,
  applyDebtRepayToShift,
  ensurePosCollections,
} = await import(pathToFileURL(path.join(apiRoot, 'posLogic.js')).href)

function freshDb() {
  const db = {
    moneyLedger: [],
    financeMoves: [],
    posSales: [],
    posShifts: [],
    posPoints: [{ id: 'POS-1', name: 'Test', active: true }],
    cashiers: [{ id: 'CASH-1', name: 'Кассир', salesCount: 0, salesTotal: 0 }],
    products: [{
      id: 101,
      name: 'Хлеб',
      price: 50,
      stock: 100,
      costPrice: 20,
      unit: 'шт',
      art: 'BREAD',
    }],
    stockLayers: [],
    clients: [{
      id: 'CL-1',
      name: 'Иван',
      phone: '996700000001',
      card: 'VIP001',
      debt: 0,
      bonus: 100,
      wallet: 80,
    }],
    cards: [{
      num: 'VIP001',
      client: 'Иван',
      phone: '996700000001',
      debt: 0,
      bonus: 100,
      wallet: 80,
      posCashBonus: 0,
      debtPayVersion: 0,
      bonusPayVersion: 0,
    }],
    orders: [],
    expenses: [],
    suppliers: [],
    supplierPayments: [],
    cashVault: { cashTotal: 0, cardTotal: 0, transfers: [], converts: [] },
    writeOffs: [],
    stockReceipts: [{
      id: 'REC-TEST',
      createdAtIso: new Date().toISOString(),
      supplierName: 'test',
      items: [{
        productId: 101,
        productName: 'Хлеб',
        qty: 1000,
        remainingQty: 1000,
        costPrice: 20,
        retailPrice: 50,
      }],
    }],
  }
  ensurePosCollections(db)
  db.posShifts.push({
    id: 'SH-1',
    posId: 'POS-1',
    status: 'open',
    cashierId: 'CASH-1',
    cashierName: 'Кассир',
    openingCash: 0,
    salesCash: 0,
    salesCard: 0,
    salesCredit: 0,
    salesWallet: 0,
    salesCount: 0,
    cashInTotal: 0,
    expenseTotal: 0,
  })
  return db
}

function saleBase(extra = {}) {
  return {
    clientRef: 'sale-ref-1',
    cashierId: 'CASH-1',
    shiftId: 'SH-1',
    posId: 'POS-1',
    clientId: 'CL-1',
    clientPhone: '996700000001',
    clientName: 'Иван',
    cardNum: 'VIP001',
    items: [{ productId: 101, productName: 'Хлеб', qty: 2, price: 50, lineTotal: 100 }],
    paidCash: 100,
    paidCard: 0,
    paidWallet: 0,
    debtAdded: 0,
    bonusSpent: 0,
    paymentMethod: 'cash',
    appliedLocal: true,
    skipBalances: true,
    ...extra,
  }
}

// ── A. Ledger dedupe ──────────────────────────────────────────
test('A1 appendMoneyLedger dedupes by clientRef+type', () => {
  const db = freshDb()
  const a = appendMoneyLedger(db, {
    type: 'sale_cash', amount: 100, direction: 'in', clientRef: 'led-1', cashAffect: true,
  })
  const b = appendMoneyLedger(db, {
    type: 'sale_cash', amount: 100, direction: 'in', clientRef: 'led-1', cashAffect: true,
  })
  const c = appendMoneyLedger(db, {
    type: 'sale_card', amount: 40, direction: 'in', clientRef: 'led-1', cashAffect: false,
  })
  expect(db.moneyLedger.length === 2, `expected 2 ledger rows, got ${db.moneyLedger.length}`)
  expect(!!b._replay, 'second same type must be replay')
  expect(!c._replay, 'different type must create new row')
  expect(a.id === b.id, 'replay returns same id')
})

// ── B. Duplicate sale ─────────────────────────────────────────
test('B1 duplicate sale clientRef → one sale, one finance, one debt', () => {
  const db = freshDb()
  const payload = saleBase({
    clientRef: 'credit-sale-1',
    paidCash: 0,
    debtAdded: 100,
    paymentMethod: 'credit',
    expectedDebtPayVersion: 0,
  })
  const s1 = createPosSale(db, payload)
  const debt1 = Number(db.cards[0].debt)
  const led1 = db.moneyLedger.filter(r => r.clientRef === 'credit-sale-1').length
  const s2 = createPosSale(db, payload)
  expect(s1.id === s2.id, 'same sale id')
  expect(!!s2._idempotentReplay, 'second call marks replay')
  expect(db.posSales.length === 1, 'one sale')
  expect(Number(db.cards[0].debt) === debt1, 'debt not doubled')
  expect(db.moneyLedger.filter(r => r.clientRef === 'credit-sale-1').length === led1, 'ledger not doubled')
})

test('B2 mixed payment components sum + ledger once on retry', () => {
  const db = freshDb()
  const payload = saleBase({
    clientRef: 'mixed-1',
    paidCash: 40,
    paidCard: 30,
    paidWallet: 20,
    debtAdded: 10,
    paymentMethod: 'mixed',
    expectedDebtPayVersion: 0,
  })
  createPosSale(db, payload)
  createPosSale(db, { ...payload })
  expect(db.posSales.length === 1, 'one mixed sale')
  const types = db.moneyLedger.filter(r => r.clientRef === 'mixed-1').map(r => r.type).sort()
  expect(types.includes('sale_cash'), 'cash ledger')
  expect(types.includes('sale_card'), 'card ledger')
  expect(types.includes('sale_wallet'), 'wallet ledger')
  expect(types.includes('sale_credit'), 'credit ledger')
  expect(types.length === 4, `expected 4 component ledgers, got ${types.join(',')}`)
  expect(Number(db.cards[0].debt) === 10, `debt should be 10, got ${db.cards[0].debt}`)
  expect(Number(db.cards[0].wallet) === 60, `wallet 80-20=60, got ${db.cards[0].wallet}`)
})

test('B3 loyalty spend+earn on skipBalances sale once', () => {
  const db = freshDb()
  const payload = saleBase({
    clientRef: 'bonus-sale-1',
    paidCash: 80,
    bonusSpent: 20,
    bonusEarned: 5,
    expectedBonusPayVersion: 0,
  })
  createPosSale(db, payload)
  const bonus1 = Number(db.cards[0].bonus)
  createPosSale(db, payload)
  expect(Number(db.cards[0].bonus) === bonus1, 'bonus not applied twice')
  expect(bonus1 === 85, `100-20+5=85, got ${bonus1}`)
})

// ── C. Order side-effect ──────────────────────────────────────
test('C1 createClientOrderFromPosSale dedupes by posSaleId', () => {
  const db = freshDb()
  const sale = createPosSale(db, saleBase({
    clientRef: 'ord-sale-1',
    clientPhone: '996700000001',
  }))
  const o1 = createClientOrderFromPosSale(db, sale, { clientRef: 'ord-sale-1' })
  const o2 = createClientOrderFromPosSale(db, sale, { clientRef: 'ord-sale-1' })
  expect(!!o1 && o1.id === o2.id, 'same order')
  expect(db.orders.length === 1, 'one order')
  expect(String(o1.posSaleClientRef) === 'ord-sale-1', 'stores sale clientRef')
})

// ── D. Debt repay ledger ──────────────────────────────────────
test('D1 debt repay shift ledger retry once', () => {
  const db = freshDb()
  const a = applyDebtRepayToShift(db, {
    amount: 50,
    method: 'cash',
    shiftId: 'SH-1',
    posId: 'POS-1',
    clientRef: 'repay-1',
    cardNum: 'VIP001',
  })
  const cash1 = Number(db.posShifts[0].salesCash)
  const b = applyDebtRepayToShift(db, {
    amount: 50,
    method: 'cash',
    shiftId: 'SH-1',
    posId: 'POS-1',
    clientRef: 'repay-1',
    cardNum: 'VIP001',
  })
  expect(!!b.replay, 'second repay is replay')
  expect(Number(db.posShifts[0].salesCash) === cash1, 'shift cash not doubled')
  expect(db.moneyLedger.filter(r => r.clientRef === 'repay-1').length === 1, 'one repay ledger')
  expect(a.amount === 50 && cash1 === 50, 'first repay applied')
})

// ── E. Return retry ───────────────────────────────────────────
test('E1 return retry same clientRef → one reversal', () => {
  const db = freshDb()
  const sale = createPosSale(db, saleBase({
    clientRef: 'ret-sale-1',
    paidCash: 0,
    debtAdded: 100,
    paymentMethod: 'credit',
    expectedDebtPayVersion: 0,
  }))
  expect(Number(db.cards[0].debt) === 100, 'credit debt 100')
  const r1 = returnPosSale(db, sale.id, {
    clientRef: 'ret-op-1',
    appliedLocal: true,
    skipBalances: true,
    expectedDebtPayVersion: Number(db.cards[0].debtPayVersion),
  })
  const debtAfter = Number(db.cards[0].debt)
  const returnsCount = (r1.returns || []).length
  const ledCount = db.moneyLedger.filter(r => r.clientRef === 'ret-op-1').length
  const r2 = returnPosSale(db, sale.id, {
    clientRef: 'ret-op-1',
    appliedLocal: true,
    skipBalances: true,
    expectedDebtPayVersion: Number(db.cards[0].debtPayVersion),
  })
  expect((r2.returns || []).length === returnsCount, 'returns not doubled')
  expect(Number(db.cards[0].debt) === debtAfter, 'debt cut once')
  expect(db.moneyLedger.filter(r => r.clientRef === 'ret-op-1').length === ledCount, 'return ledger once')
  expect(debtAfter === 0, `full credit return → debt 0, got ${debtAfter}`)
})

// ── F. Finance move / topup replay flag ───────────────────────
test('F1 createFinanceMove sets _replay on duplicate clientRef', () => {
  const db = freshDb()
  const m1 = createFinanceMove(db, {
    type: 'deposit',
    amount: 200,
    method: 'cash',
    payFrom: 'shift',
    shiftId: 'SH-1',
    posId: 'POS-1',
    clientRef: 'topup-1',
    refType: 'card_topup',
  })
  const m2 = createFinanceMove(db, {
    type: 'deposit',
    amount: 200,
    method: 'cash',
    payFrom: 'shift',
    shiftId: 'SH-1',
    posId: 'POS-1',
    clientRef: 'topup-1',
    refType: 'card_topup',
  })
  expect(db.financeMoves.length === 1, 'one finance move')
  expect(!!m2._replay, 'second move is replay')
  expect(m1.id === m2.id, 'same move id')
})

// ── G. Wallet payment once ────────────────────────────────────
test('G1 wallet payment retry deducts once', () => {
  const db = freshDb()
  createPosSale(db, saleBase({
    clientRef: 'wallet-1',
    paidCash: 0,
    paidWallet: 50,
    paymentMethod: 'mixed',
  }))
  createPosSale(db, saleBase({
    clientRef: 'wallet-1',
    paidCash: 0,
    paidWallet: 50,
    paymentMethod: 'mixed',
  }))
  expect(Number(db.cards[0].wallet) === 30, `80-50=30, got ${db.cards[0].wallet}`)
  expect(db.moneyLedger.filter(r => r.clientRef === 'wallet-1' && r.type === 'sale_wallet').length === 1, 'one wallet ledger')
})

// ── Source wiring ─────────────────────────────────────────────
const financeSrc = fs.readFileSync(path.join(apiRoot, 'financeTruth.js'), 'utf8')
const posSrc = fs.readFileSync(path.join(apiRoot, 'posLogic.js'), 'utf8')
const indexSrc = fs.readFileSync(path.join(apiRoot, 'index.js'), 'utf8')
const offlineSrc = fs.readFileSync(path.join(root, 'lib', 'offline.ts'), 'utf8')
const opsSrc = fs.readFileSync(path.join(root, 'lib', 'offlinePosOps.ts'), 'utf8')

test('S1 ledger dedupe + sale/return clientRef wiring', () => {
  expect(financeSrc.includes('clientRef') && financeSrc.includes('_replay'), 'ledger dedupe')
  expect(posSrc.includes('clientRef: clientRef || undefined'), 'sale ledger clientRef')
  expect(posSrc.includes('posSaleClientRef'), 'order ties to sale ref')
  expect(posSrc.includes('_idempotentReplay'), 'sale replay flag')
  expect(posSrc.includes('_pending'), 'return clientRef reserve')
  expect(posSrc.includes('_replay: true'), 'financeMove replay')
})

test('S2 route: sale/order repair + topup replay skip bonus', () => {
  expect(indexSrc.includes('completePosSaleOnlineLoyalty') || indexSrc.includes('posSaleClientRef'), 'dup sale loyalty/order repair')
  expect(indexSrc.includes('saleReplay'), 'concurrent sale skip loyalty')
  expect(indexSrc.includes('move._replay'), 'topup skip bonus on replay')
  expect(indexSrc.includes("rememberOpRef('sale_return'"), 'return opRef')
  expect(indexSrc.includes("rememberOpRef('pos_sale'"), 'sale opRef')
})

test('S3 local sticky clientRef for money ops', () => {
  expect(opsSrc.includes('createSaleSafe'), 'sale safe')
  expect(opsSrc.includes('debtRepaySafe'), 'debt repay safe')
  expect(opsSrc.includes('cardTopupSafe'), 'topup safe')
  expect(offlineSrc.includes("case 'sale_return'"), 'return send')
  expect(offlineSrc.includes('appliedLocal: true'), 'local-first skipBalances')
  expect(offlineSrc.includes('expectedDebtPayVersion'), 'OCC debt version')
  expect(offlineSrc.includes('expectedBonusPayVersion'), 'OCC bonus version')
})

test('S4 no dangerous PG unique migration added', () => {
  const schemaPath = path.join(apiRoot, 'pg', 'schema.sql')
  if (!fs.existsSync(schemaPath)) return
  const schema = fs.readFileSync(schemaPath, 'utf8')
  expect(!/UNIQUE\s*\(\s*client_ref/i.test(schema), 'must not add client_ref UNIQUE without approval')
})

// ── Finish ────────────────────────────────────────────────────
await Promise.resolve()
const failed = results.filter(r => r.status === 'FAIL')
const report = {
  phase: 9,
  title: 'Finance / Debt / Loyalty consistency',
  generatedAtIso: new Date().toISOString(),
  summary: {
    total: results.length,
    passed: results.filter(r => r.status === 'PASS').length,
    failed: failed.length,
  },
  results,
  notes: [
    'Server JSON docs remain SoT; no PG UNIQUE migration.',
    'Sale idempotency ≠ side-effect idempotency: order/ledger/topup bonus hardened separately.',
    'Local appliedLocal + server delta remain dual-apply to separate copies; retry protected by clientRef.',
  ],
}
fs.writeFileSync(
  path.join(root, 'scripts', 'phase9-finance-idempotency-report.json'),
  JSON.stringify(report, null, 2),
)
console.log(`\nPhase 9: ${report.summary.passed}/${report.summary.total} passed`)
if (failed.length) process.exit(1)
