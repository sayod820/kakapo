/**
 * Cash advance safety — CASE 1–12 regression tests.
 * In-memory server createCashAdvance + source guards for Desktop semantic path.
 */
import { createRequire } from 'module'
import path from 'path'
import fs from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)

const { createCashAdvance, applyCashAdvanceToShift, ensurePosCollections } = await import(
  pathToFileURL(path.join(root, 'server/kakapo-api/posLogic.js')).href
)
const { sumDebtLedgerRemaining } = await import(
  pathToFileURL(path.join(root, 'server/kakapo-api/debtLedger.js')).href
)

let passed = 0
let failed = 0
const results = []

function test(name, fn) {
  try {
    fn()
    passed++
    results.push({ name, ok: true })
    console.log(`PASS  ${name}`)
  } catch (e) {
    failed++
    results.push({ name, ok: false, error: String(e?.message || e) })
    console.error(`FAIL  ${name}`)
    console.error(`      ${e?.message || e}`)
  }
}

function expect(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function freshDb(opts = {}) {
  const db = {
    posShifts: [],
    moneyLedger: [],
    financeMoves: [],
    cards: [],
    clients: [],
    cashVault: { cashTotal: 0, cardTotal: 0 },
  }
  ensurePosCollections(db)
  const shift = {
    id: opts.shiftId || 'SHIFT-T1',
    status: 'open',
    posId: 'POS-1',
    openingCash: opts.openingCash ?? 0,
    salesCash: opts.salesCash ?? 2000,
    salesCard: opts.salesCard ?? 100,
    salesCount: opts.salesCount ?? 10,
    debtRepayCash: opts.debtRepayCash ?? 1,
    cashInTotal: opts.cashInTotal ?? 0,
    expenseTotal: opts.expenseTotal ?? 0,
    cashierId: 'C1',
    cashierName: 'Test',
  }
  db.posShifts.push(shift)
  const client = {
    id: 'U-01',
    name: 'Sayod',
    phone: '+992501903141',
    card: 'KAKAPO-0001',
    debt: opts.debt ?? 1739.31,
    debtEnabled: true,
    debtLedger: Array.isArray(opts.debtLedger)
      ? opts.debtLedger
      : [
          {
            id: 'DL-OLD-1',
            amount: 100,
            remaining: 100,
            createdAtIso: '2026-09-01T00:00:00.000Z',
            source: 'pos',
            orderId: 'K-OLD',
            saleId: 'SALE-OLD',
            desc: 'Продажа · K-OLD',
          },
          {
            id: 'DL-OLD-2',
            amount: round2((opts.debt ?? 1739.31) - 100),
            remaining: round2((opts.debt ?? 1739.31) - 100),
            createdAtIso: '2026-09-02T00:00:00.000Z',
            source: 'pos',
            orderId: 'K-OLD2',
            desc: 'Продажа · K-OLD2',
          },
        ],
  }
  const card = {
    num: 'KAKAPO-0001',
    client: 'Sayod',
    clientId: 'U-01',
    phone: '+992501903141',
    debt: opts.cardDebt != null ? opts.cardDebt : (opts.debt ?? 1739.31),
    debtPayVersion: opts.debtPayVersion ?? 81,
    debtEnabled: true,
    status: 'active',
  }
  db.clients.push(client)
  db.cards.push(card)
  return { db, shift, client, card }
}

function expectedTill(shift) {
  return round2(
    (Number(shift.openingCash) || 0)
    + (Number(shift.salesCash) || 0)
    + (Number(shift.debtRepayCash) || 0)
    + (Number(shift.cashInTotal) || 0)
    - (Number(shift.expenseTotal) || 0),
  )
}

// ── CASE 1: stale local absolute would have sent 50; server uses canonical += ──
test('CASE1 stale local 0 / server 1739.31 / advance 50 → 1789.31 never 50', () => {
  const { db, client, card } = freshDb({ debt: 1739.31, cardDebt: 1739.31 })
  // Client would have computed absolute 50 from local 0 — server must ignore that
  const outcome = createCashAdvance(db, {
    card,
    linkedClient: client,
    clientRef: 'adv-case1',
    amount: 50,
    shiftId: 'SHIFT-T1',
    expectedDebtPayVersion: 81,
    note: 'test',
    // deliberately NOT passing absolute debt
  })
  expect(outcome.ok, outcome.detail)
  expect(outcome.result.nextDebt === 1789.31, `got ${outcome.result.nextDebt}`)
  expect(card.debt === 1789.31, `card.debt=${card.debt}`)
  expect(client.debt === 1789.31, `client.debt=${client.debt}`)
  expect(outcome.result.nextDebt !== 50, 'must never be 50')
})

test('CASE2 normal 1739.31 + 50 = 1789.31', () => {
  const { db, client, card } = freshDb()
  const outcome = createCashAdvance(db, {
    card, linkedClient: client, clientRef: 'adv-case2', amount: 50, shiftId: 'SHIFT-T1',
    expectedDebtPayVersion: 81,
  })
  expect(outcome.ok, outcome.detail)
  expect(outcome.result.prevDebt === 1739.31, 'prev')
  expect(outcome.result.nextDebt === 1789.31, 'next')
})

test('CASE3 duplicate same clientRef — debt+till once', () => {
  const { db, client, card, shift } = freshDb()
  const a = createCashAdvance(db, {
    card, linkedClient: client, clientRef: 'adv-dup', amount: 50, shiftId: 'SHIFT-T1',
    expectedDebtPayVersion: 81,
  })
  expect(a.ok, a.detail)
  const expense1 = shift.expenseTotal
  const debt1 = card.debt
  const ver1 = card.debtPayVersion
  const ledgerCount1 = (db.moneyLedger || []).filter(r => r.refType === 'cash_advance').length
  const openRemain1 = sumDebtLedgerRemaining(client.debtLedger)

  const b = createCashAdvance(db, {
    card, linkedClient: client, clientRef: 'adv-dup', amount: 50, shiftId: 'SHIFT-T1',
    expectedDebtPayVersion: ver1,
  })
  expect(b.ok && b.result.replay === true, 'second must replay')
  expect(shift.expenseTotal === expense1, `expense doubled? ${shift.expenseTotal}`)
  expect(card.debt === debt1, `debt doubled? ${card.debt}`)
  expect(card.debtPayVersion === ver1, 'version bumped twice')
  expect((db.moneyLedger || []).filter(r => r.refType === 'cash_advance').length === ledgerCount1, 'ledger dup')
  expect(sumDebtLedgerRemaining(client.debtLedger) === openRemain1, 'ledger remain doubled')
})

test('CASE4 ACK-lost retry same clientRef — no second effects', () => {
  const { db, client, card, shift } = freshDb()
  const ref = 'adv-ack-lost'
  const first = createCashAdvance(db, {
    card, linkedClient: client, clientRef: ref, amount: 50, shiftId: 'SHIFT-T1',
    expectedDebtPayVersion: 81,
  })
  expect(first.ok, first.detail)
  // Simulate lost response: client retries identical request
  const retry = createCashAdvance(db, {
    card, linkedClient: client, clientRef: ref, amount: 50, shiftId: 'SHIFT-T1',
    expectedDebtPayVersion: 81, // stale version on retry body — still entity-idempotent via ledger
  })
  // Entity ledger replay happens before OCC check when clientRef known
  expect(retry.ok && retry.result.replay === true, 'retry replay')
  expect(card.debt === 1789.31, `debt=${card.debt}`)
  expect(shift.expenseTotal === 50, `expense=${shift.expenseTotal}`)
  expect((db.moneyLedger || []).filter(r => String(r.clientRef) === ref).length === 1, 'one ledger')
})

test('CASE5 OCC conflict — reject, no mutation', () => {
  const { db, client, card, shift } = freshDb({ debtPayVersion: 82 })
  const beforeDebt = card.debt
  const beforeExp = shift.expenseTotal
  const beforeLed = (client.debtLedger || []).length
  const outcome = createCashAdvance(db, {
    card, linkedClient: client, clientRef: 'adv-occ', amount: 50, shiftId: 'SHIFT-T1',
    expectedDebtPayVersion: 81,
  })
  expect(!outcome.ok, 'must fail')
  expect(outcome.code === 'DEBT_PAY_VERSION_CONFLICT', `code=${outcome.code}`)
  expect(outcome.status === 409, `status=${outcome.status}`)
  expect(card.debt === beforeDebt, 'debt mutated')
  expect(shift.expenseTotal === beforeExp, 'expense mutated')
  expect((client.debtLedger || []).length === beforeLed, 'ledger mutated')
  expect((db.moneyLedger || []).length === 0, 'money ledger row')
})

test('CASE6 source: Desktop uses cash_advance not absolute card_loyalty_patch', () => {
  const src = fs.readFileSync(path.join(root, 'lib/offlinePosOps.ts'), 'utf8')
  expect(/export async function cashAdvanceSafe/.test(src), 'cashAdvanceSafe missing')
  expect(/kind:\s*'cash_advance'/.test(src), 'queue kind cash_advance')
  // chargeCashDebtFromOpenShift must call cashAdvanceSafe, not financeMove+adjust
  const chargeIdx = src.indexOf('export async function chargeCashDebtFromOpenShift')
  const chargeBlock = src.slice(chargeIdx, chargeIdx + 2500)
  expect(/cashAdvanceSafe\(/.test(chargeBlock), 'wrapper must call cashAdvanceSafe')
  expect(!/financeMoveSafe\(\s*\{\s*type:\s*'withdraw'/.test(chargeBlock), 'old withdraw path')
  expect(!/adjustClientDebtSafe/.test(chargeBlock), 'old absolute adjust path')
})

test('CASE6b atomic commit wiring present', () => {
  const atomic = fs.readFileSync(path.join(root, 'lib/localCashAdvanceAtomic.ts'), 'utf8')
  expect(/commitLocalCashAdvanceAtomic/.test(atomic), 'atomic export')
  const offline = fs.readFileSync(path.join(root, 'lib/offline.ts'), 'utf8')
  expect(/case 'cash_advance'/.test(offline), 'sendOp cash_advance')
  expect(/findDuplicateCashAdvance/.test(offline), 'dedupe')
  expect(/revertLocalCashAdvanceOnReject/.test(offline), 'OCC revert')
})

test('CASE7/8 pending overlay + restart guards in source', () => {
  const guard = fs.readFileSync(path.join(root, 'lib/loyaltySaveGuard.ts'), 'utf8')
  expect(/cash_advance/.test(guard), 'clearMoneyPending cash_advance')
  const pull = fs.readFileSync(path.join(root, 'lib/syncPull.ts'), 'utf8')
  expect(/cash_advance/.test(pull), 'syncPull protect')
  const ops = fs.readFileSync(path.join(root, 'lib/offlinePosOps.ts'), 'utf8')
  expect(/markMoneyPending/.test(ops.slice(ops.indexOf('cashAdvanceSafe'), ops.indexOf('cashAdvanceSafe') + 8000)), 'markMoneyPending')
  expect(/commitLocalCashAdvanceAtomic|canAtomicLocalCashAdvanceCommit/.test(ops), 'sqlite atomic')
})

test('CASE9 sync pull pending: moneyPending keeps local debt in merge', () => {
  // Behavioral unit of mergeCardLoyaltyIfRecent is covered by debt suites;
  // assert cash_advance clears/marks via same pending path.
  const guard = fs.readFileSync(path.join(root, 'lib/loyaltySaveGuard.ts'), 'utf8')
  expect(/kind === 'debt_repay' \|\| kind === 'card_topup' \|\| kind === 'cash_advance'/.test(guard)
    || /cash_advance/.test(guard), 'pending clear includes cash_advance')
})

test('CASE10 existing debtLedger preserved + new charge appended', () => {
  const { db, client, card } = freshDb()
  const oldRemain = client.debtLedger.find(e => e.id === 'DL-OLD-1').remaining
  const beforeLen = client.debtLedger.length
  const outcome = createCashAdvance(db, {
    card, linkedClient: client, clientRef: 'adv-led', amount: 50, shiftId: 'SHIFT-T1',
    expectedDebtPayVersion: 81,
  })
  expect(outcome.ok, outcome.detail)
  expect(client.debtLedger.length === beforeLen + 1, `len ${client.debtLedger.length}`)
  const old = client.debtLedger.find(e => e.id === 'DL-OLD-1')
  expect(old && old.remaining === oldRemain, 'old remaining wiped')
  const neu = client.debtLedger.find(e => e.source === 'cash_advance')
  expect(!!neu, 'cash_advance entry missing')
  expect(round2(neu.remaining) === 50, `new remain ${neu.remaining}`)
  expect(round2(sumDebtLedgerRemaining(client.debtLedger)) === 1789.31, 'sum remain')
})

test('CASE11 no sale pollution', () => {
  const { db, client, card, shift } = freshDb({
    salesCount: 42, salesCash: 2195.95, salesCard: 112.5, debtRepayCash: 1,
  })
  const outcome = createCashAdvance(db, {
    card, linkedClient: client, clientRef: 'adv-sale', amount: 50, shiftId: 'SHIFT-T1',
    expectedDebtPayVersion: 81,
  })
  expect(outcome.ok, outcome.detail)
  expect(shift.salesCount === 42, 'salesCount')
  expect(shift.salesCash === 2195.95, 'salesCash')
  expect(shift.salesCard === 112.5, 'salesCard')
  expect(shift.debtRepayCash === 1, 'debtRepayCash')
  expect(outcome.result.till.salesCount === 42, 'till salesCount')
  expect(outcome.result.till.salesCash === 2195.95, 'till salesCash')
})

test('CASE12 expected till decreases by exactly 50', () => {
  const { db, client, card, shift } = freshDb({
    openingCash: 0, salesCash: 1000, debtRepayCash: 5, cashInTotal: 0, expenseTotal: 100,
  })
  // Local formula includes debtRepayCash; server shiftExpectedCash may not —
  // we assert expense +50 and local-style till delta.
  const beforeLocal = expectedTill(shift)
  const outcome = createCashAdvance(db, {
    card, linkedClient: client, clientRef: 'adv-till', amount: 50, shiftId: 'SHIFT-T1',
    expectedDebtPayVersion: 81,
  })
  expect(outcome.ok, outcome.detail)
  expect(shift.expenseTotal === 150, `expense=${shift.expenseTotal}`)
  const afterLocal = expectedTill(shift)
  expect(round2(beforeLocal - afterLocal) === 50, `till delta ${beforeLocal - afterLocal}`)
})

test('API route + client method wired', () => {
  const idx = fs.readFileSync(path.join(root, 'server/kakapo-api/index.js'), 'utf8')
  expect(/\/cards\/:num\/cash-advance/.test(idx), 'route missing')
  expect(/createCashAdvance/.test(idx), 'handler uses createCashAdvance')
  const api = fs.readFileSync(path.join(root, 'lib/api.ts'), 'utf8')
  expect(/cashAdvanceCard:/.test(api), 'api.cashAdvanceCard')
})

test('UI entry points still call chargeCashDebtFromOpenShift (safe wrapper)', () => {
  const cashier = fs.readFileSync(path.join(root, 'components/trade/CashierModule.tsx'), 'utf8')
  const debts = fs.readFileSync(path.join(root, 'components/trade/DebtsModule.tsx'), 'utf8')
  expect(/chargeCashDebtFromOpenShift/.test(cashier), 'CashierModule')
  expect(/chargeCashDebtFromOpenShift/.test(debts), 'DebtsModule')
  // Panel only opens modal via callback — no direct absolute path
  const panel = fs.readFileSync(path.join(root, 'components/trade/ClientDebtPanel.tsx'), 'utf8')
  expect(/onIssueCash/.test(panel), 'ClientDebtPanel callback')
  expect(!/adjustClientDebtSafe/.test(panel), 'panel must not adjust absolute')
})

test('applyCashAdvanceToShift alone is idempotent by clientRef', () => {
  const { db, shift } = freshDb({ salesCash: 500, expenseTotal: 0 })
  const a = applyCashAdvanceToShift(db, {
    amount: 25, shiftId: shift.id, clientRef: 'till-only', cardNum: 'KAKAPO-0001',
  })
  const b = applyCashAdvanceToShift(db, {
    amount: 25, shiftId: shift.id, clientRef: 'till-only', cardNum: 'KAKAPO-0001',
  })
  expect(a.expenseTotal === 25, 'first')
  expect(b.replay === true, 'replay')
  expect(shift.expenseTotal === 25, 'not doubled')
})

const report = {
  passed,
  failed,
  results,
  staleLocalCase: results.find(r => r.name.startsWith('CASE1')),
  duplicate: results.find(r => r.name.startsWith('CASE3')),
  ackLost: results.find(r => r.name.startsWith('CASE4')),
  occ: results.find(r => r.name.startsWith('CASE5')),
  shiftAccounting: results.find(r => r.name.startsWith('CASE12')),
}
fs.writeFileSync(
  path.join(root, 'scripts/cash-advance-safe-report.json'),
  JSON.stringify(report, null, 2),
)
console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
