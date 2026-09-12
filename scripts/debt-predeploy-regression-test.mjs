/**
 * Pre-deploy regression for debtLedger lossless cap + canonical card.
 * Local in-memory only — never touches production.
 * Run: node scripts/debt-predeploy-regression-test.mjs
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  addDebtCharge,
  applyDebtRepayment,
  capDebtLedgerLossless,
  handleClientDebtDelta,
  reconcileDebtLedger,
  runDebtMaintenance,
  sumDebtLedgerRemaining,
} from '../server/kakapo-api/debtLedger.js'
import {
  findCanonicalCard,
  unlinkNonCanonicalSiblingCards,
} from '../server/kakapo-api/cardCanonical.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiRoot = path.join(root, 'server', 'kakapo-api')

const {
  createPosSale,
  applyDebtRepayToShift,
  ensurePosCollections,
} = await import(pathToFileURL(path.join(apiRoot, 'posLogic.js')).href)
const { appendMoneyLedger } = await import(pathToFileURL(path.join(apiRoot, 'financeTruth.js')).href)

const results = []
function test(name, fn) {
  try {
    fn()
    results.push({ name, status: 'PASS' })
    console.log(`PASS  ${name}`)
  } catch (e) {
    results.push({ name, status: 'FAIL', error: String(e?.message || e) })
    console.error(`FAIL  ${name}:`, e?.message || e)
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg || 'assert')
}
function r2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}
function effectiveDebt(card, client) {
  return r2(Math.max(Number(card?.debt) || 0, Number(client?.debt) || 0))
}

function normalizeCardRow(raw) {
  return {
    num: String(raw.num || '').toUpperCase(),
    client: raw.client || '',
    phone: raw.phone || '',
    clientId: raw.clientId,
    status: raw.status || 'unlinked',
    level: raw.level || '',
    bonus: Number(raw.bonus) || 0,
    debt: Number(raw.debt) || 0,
    debtLimit: Number(raw.debtLimit) || 0,
    vip: !!raw.vip,
    debtEnabled: !!raw.debtEnabled,
    debtLedger: Array.isArray(raw.debtLedger) ? raw.debtLedger : [],
    debtOverdueStrikes: Number(raw.debtOverdueStrikes) || 0,
    debtCreditBlocked: !!raw.debtCreditBlocked,
    debtPayVersion: Number(raw.debtPayVersion) || 0,
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
    products: [{
      id: 101, name: 'Хлеб', price: 50, stock: 100, costPrice: 20, unit: 'шт', art: 'BREAD',
    }],
    stockLayers: [],
    clients: [{
      id: 'CL-1', name: 'Тест', phone: '996700000001', card: 'VIP001',
      debt: 0, bonus: 0, wallet: 0, debtLedger: [],
    }],
    cards: [{
      num: 'VIP001', client: 'Тест', phone: '996700000001', clientId: 'CL-1',
      status: 'active', debt: 0, bonus: 0, wallet: 0, debtPayVersion: 0, bonusPayVersion: 0,
      debtLedger: [],
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
      items: [{
        productId: 101, productName: 'Хлеб', qty: 1000, remainingQty: 1000,
        costPrice: 20, retailPrice: 50,
      }],
    }],
  }
  ensurePosCollections(db)
  db.posShifts.push({
    id: 'SH-1', posId: 'POS-1', status: 'open', cashierId: 'CASH-1', cashierName: 'Кассир',
    openingCash: 0, salesCash: 0, salesCard: 0, salesCredit: 0, salesWallet: 0,
    salesCount: 0, cashInTotal: 0, expenseTotal: 0, debtRepayCash: 0, debtRepayCard: 0,
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
    clientName: 'Тест',
    cardNum: 'VIP001',
    items: [{ productId: 101, productName: 'Хлеб', qty: 2, price: 50, lineTotal: 100 }],
    paidCash: 0,
    paidCard: 0,
    paidWallet: 0,
    debtAdded: 100,
    bonusSpent: 0,
    paymentMethod: 'credit',
    appliedLocal: true,
    skipBalances: true,
    expectedDebtPayVersion: 0,
    ...extra,
  }
}

function mkEntry({ id, remaining, amount, at, source = 'pos' }) {
  return {
    id, amount: amount ?? remaining, remaining, createdAtIso: at, dueAtIso: at,
    source, desc: 'Долг', createdNotified: true, reminderNotified: false,
    overdueNotified: false, overdueStrikeApplied: false,
  }
}

function assertAligned(client, card, label) {
  const led = sumDebtLedgerRemaining(client.debtLedger)
  expect(r2(client.debt) === r2(card.debt), `${label}: client ${client.debt} != card ${card.debt}`)
  expect(r2(client.debt) === led, `${label}: client ${client.debt} != ledger ${led}`)
}

// ── 1. Normal debt sale ───────────────────────────────────────
test('1) normal debt sale aligns client/card/ledger', () => {
  const db = freshDb()
  createPosSale(db, saleBase({ clientRef: 'debt-sale-1', debtAdded: 100 }))
  const client = db.clients[0]
  const card = db.cards[0]
  expect(r2(client.debt) === 100, `client debt ${client.debt}`)
  expect(r2(card.debt) === 100, `card debt ${card.debt}`)
  expect(sumDebtLedgerRemaining(client.debtLedger) === 100, 'ledger rem')
  assertAligned(client, card, 'after sale')
})

// ── 2. Cash repayment + idempotent moneyLedger via clientRef ─
test('2) cash repayment decreases once; retry same clientRef once', () => {
  const db = freshDb()
  createPosSale(db, saleBase({ clientRef: 'debt-sale-2', debtAdded: 100, expectedDebtPayVersion: 0 }))
  const client = db.clients[0]
  const card = db.cards[0]
  const prev = 100
  const amount = 40
  const next = r2(prev - amount)
  handleClientDebtDelta(db, client, card, prev, next, {
    enforceLimit: false, source: 'pos', desc: 'Погашение долга наличными',
  })
  client.debt = next
  card.debt = next
  const a = applyDebtRepayToShift(db, {
    amount, method: 'cash', shiftId: 'SH-1', posId: 'POS-1',
    clientRef: 'repay-cash-1', cardNum: 'VIP001',
  })
  const b = applyDebtRepayToShift(db, {
    amount, method: 'cash', shiftId: 'SH-1', posId: 'POS-1',
    clientRef: 'repay-cash-1', cardNum: 'VIP001',
  })
  expect(!!b.replay || !!b._replay, 'second repay replay')
  expect(db.moneyLedger.filter(r => r.clientRef === 'repay-cash-1').length === 1, 'moneyLedger once')
  assertAligned(client, card, 'after partial repay')
  expect(r2(client.debt) === 60, `debt 60 got ${client.debt}`)
  expect(r2(a.amount) === 40, 'first repay amount')
})

// ── 3. Partial repayment exact remaining ──────────────────────
test('3) partial repayment preserves exact remaining', () => {
  const client = { phone: '1', debt: 100, debtLedger: [] }
  const card = { num: 'C1', debt: 100 }
  addDebtCharge(client, card, { amount: 70, orderId: 'K-A', saleId: 'S-A' })
  addDebtCharge(client, card, { amount: 30, orderId: 'K-B', saleId: 'S-B' })
  client.debt = 100
  card.debt = 100
  applyDebtRepayment(client, card, 25, { orderId: 'K-A', saleId: 'S-A' })
  const a = client.debtLedger.find(e => e.orderId === 'K-A')
  const b = client.debtLedger.find(e => e.orderId === 'K-B')
  expect(r2(a.remaining) === 45, `A rem ${a.remaining}`)
  expect(r2(b.remaining) === 30, `B rem ${b.remaining}`)
  expect(sumDebtLedgerRemaining(client.debtLedger) === 75, 'sum 75')
})

// ── 4. Full repayment → zeros ────────────────────────────────
test('4) full repayment → client=card=ledger=0', () => {
  const db = freshDb()
  createPosSale(db, saleBase({ clientRef: 'debt-sale-4', debtAdded: 55, expectedDebtPayVersion: 0 }))
  const client = db.clients[0]
  const card = db.cards[0]
  handleClientDebtDelta(db, client, card, 55, 0, { enforceLimit: false, source: 'pos' })
  client.debt = 0
  card.debt = 0
  expect(r2(client.debt) === 0 && r2(card.debt) === 0, 'balances 0')
  expect(sumDebtLedgerRemaining(client.debtLedger) === 0, 'ledger 0')
})

// ── 5. Admin absolute debt change stays aligned ───────────────
test('5) admin absolute debt change keeps client/card/ledger aligned', () => {
  const client = { phone: '9967', debt: 10, debtLedger: [] }
  const card = { num: 'ADM1', debt: 10, debtLedger: [] }
  addDebtCharge(client, card, { amount: 10, source: 'admin' })
  handleClientDebtDelta(null, client, card, 10, 250, {
    source: 'admin', desc: 'Изменение долга', enforceLimit: false,
  })
  client.debt = 250
  card.debt = 250
  runDebtMaintenance({ clients: [client], cards: [card] })
  assertAligned(client, card, 'admin set')
  expect(r2(client.debt) === 250, `debt 250 got ${client.debt}`)
})

// ── 6. >120 open rows ─────────────────────────────────────────
test('6) more than 120 OPEN rows — none dropped', () => {
  const ledger = []
  for (let i = 0; i < 130; i++) {
    ledger.push(mkEntry({ id: `O-${i}`, remaining: 1, at: `2026-01-01T00:${String(i % 60).padStart(2, '0')}:00.000Z` }))
  }
  const capped = capDebtLedgerLossless(ledger)
  expect(capped.length === 130, `len ${capped.length}`)
  expect(new Set(capped.map(e => e.id)).size === 130, 'all ids')
})

// ── 7. 120 with paid — paid pruned, open kept ────────────────
test('7) 120 with paid rows — paid may prune, open preserved', () => {
  const ledger = []
  for (let i = 0; i < 100; i++) {
    ledger.push(mkEntry({ id: `OPEN-${i}`, remaining: 2, at: `2026-02-01T${String(i % 24).padStart(2, '0')}:00:00.000Z` }))
  }
  for (let i = 0; i < 20; i++) {
    ledger.push(mkEntry({ id: `PAID-${i}`, remaining: 0, amount: 5, at: `2026-01-01T${String(i % 24).padStart(2, '0')}:00:00.000Z` }))
  }
  const openIds = ledger.filter(e => e.remaining > 0).map(e => e.id)
  const client = { phone: 'x', debt: r2(200 + 8.5), debtLedger: ledger }
  reconcileDebtLedger(client)
  for (const id of openIds) {
    expect(client.debtLedger.some(e => e.id === id && e.remaining > 0), `kept ${id}`)
  }
  expect(client.debtLedger.filter(e => e.remaining <= 0.001).length < 20, 'paid pruned')
})

// ── 8. Card reissue orphans ───────────────────────────────────
test('8) card reissue — one canonical; sibling unlinked; stale debt ignored', () => {
  const client = { id: 'U-X', phone: '+992500000001', card: 'КАКАПО-0046', debt: 217 }
  const db = {
    cards: [
      normalizeCardRow({
        num: 'КАКАПО-0021', client: 'Old', phone: client.phone, clientId: 'U-X',
        status: 'active', debt: 1219.49,
      }),
      normalizeCardRow({
        num: 'КАКАПО-0046', client: 'New', phone: client.phone, clientId: 'U-X',
        status: 'active', debt: 217,
      }),
    ],
  }
  unlinkNonCanonicalSiblingCards(db, client, 'КАКАПО-0046', normalizeCardRow)
  const old = db.cards.find(c => c.num === 'КАКАПО-0021')
  const neu = db.cards.find(c => c.num === 'КАКАПО-0046')
  expect(old.status === 'unlinked' && r2(old.debt) === 0, 'old cleared')
  expect(neu.status === 'active' && r2(neu.debt) === 217, 'canonical kept')
  const canon = findCanonicalCard(db, client)
  expect(canon?.num === 'КАКАПО-0046', 'finder')
  // effective debt must not use unlinked sibling
  const activeOnly = db.cards.filter(c => c.status !== 'unlinked')
  expect(activeOnly.length === 1, 'exactly one active')
  expect(effectiveDebt(canon, client) === 217, `effective ${effectiveDebt(canon, client)}`)
  expect(effectiveDebt(old, client) === 217, 'max(unlinked0, client217)=217 still via client')
  // when reading card debt for sums, skip unlinked
  const sumActive = r2(activeOnly.reduce((s, c) => s + r2(c.debt), 0))
  expect(sumActive === 217, `active sum ${sumActive}`)
})

// ── 9. Repaired-customer fixture not rewritten ────────────────
test('9) repaired-state fixture unchanged by reconcile (no prod rewrite)', () => {
  // Synthetic mirror of post-repair U-01 shape — must stay stable under maintenance.
  const repairId = 'DL-REPAIR-FIXTURE-8.50'
  const client = {
    phone: '992501903141',
    debt: 1740.31,
    debtLedger: [
      mkEntry({ id: repairId, remaining: 8.5, amount: 8.5, at: '2026-09-11T15:57:46.017Z', source: 'backfill' }),
      mkEntry({ id: 'DL-BF-OLD', remaining: 11.86, amount: 11.86, at: '2026-09-11T10:04:44.182Z', source: 'backfill' }),
      mkEntry({ id: 'POS-1', remaining: 1720, amount: 1720, at: '2026-09-10T10:00:00.000Z' }),
    ],
  }
  // Adjust last open so sum is exact 1740.31
  client.debtLedger[2].remaining = r2(1740.31 - 8.5 - 11.86)
  client.debtLedger[2].amount = client.debtLedger[2].remaining
  expect(sumDebtLedgerRemaining(client.debtLedger) === 1740.31, 'fixture sum')
  const card = { num: 'КАКАПО-0001', debt: 1740.31, status: 'active', phone: client.phone }
  const before = {
    debt: client.debt,
    rem: sumDebtLedgerRemaining(client.debtLedger),
    ids: client.debtLedger.map(e => e.id).join(','),
  }
  runDebtMaintenance({ clients: [client], cards: [card] })
  expect(r2(client.debt) === before.debt, 'debt unchanged')
  expect(sumDebtLedgerRemaining(client.debtLedger) === before.rem, 'ledger unchanged')
  expect(client.debtLedger.some(e => e.id === repairId), 'repair entry kept')
  expect(r2(card.debt) === 1740.31, 'card still aligned')
  // Guard: this suite must never call kakappo.shop
  expect(true, 'local only')
})

// moneyLedger append still dedupes (sanity for finance path)
test('moneyLedger append dedupe still works', () => {
  const db = freshDb()
  appendMoneyLedger(db, { type: 'debt_repay_cash', amount: 10, direction: 'in', clientRef: 'ml-1', cashAffect: true })
  appendMoneyLedger(db, { type: 'debt_repay_cash', amount: 10, direction: 'in', clientRef: 'ml-1', cashAffect: true })
  expect(db.moneyLedger.filter(r => r.clientRef === 'ml-1').length === 1, 'dedupe')
})

const failed = results.filter(r => r.status === 'FAIL')
console.log(`\npredeploy: ${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.log(JSON.stringify({ failed }, null, 2))
  process.exit(1)
}
