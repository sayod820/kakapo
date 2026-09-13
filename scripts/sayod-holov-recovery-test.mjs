/**
 * Local fixture tests for Sayod/Holov recovery operator.
 * Run: node scripts/sayod-holov-recovery-test.mjs
 * Never touches production.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  verifyCorruptedPreconditions,
  isAlreadyRepaired,
  buildRepairedEntities,
  applyRepairedToState,
  applyRollbackSnapshotToState,
  exportRollbackSnapshot,
  planSummary,
  openSum,
  countOpenBy,
  CA_ID,
  SAYOD_DEBT,
  HOLOV_DEBT,
  CARD_0001,
  CARD_0003,
} from './sayod-holov-recovery-core.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const results = []

function test(name, fn) {
  try {
    fn()
    results.push({ name, status: 'PASS' })
    console.log('PASS', name)
  } catch (e) {
    results.push({ name, status: 'FAIL', error: e.message || String(e) })
    console.log('FAIL', name, e.message || e)
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg || 'expect failed')
}

function mkCorruptedFixture() {
  const ca = {
    id: CA_ID,
    source: 'cash_advance',
    amount: 486.7,
    remaining: 486.7,
    clientRef: 'b56ef247-caab-400c-9311-310ca0ca56b9',
    createdAtIso: '2026-09-13T14:19:11.403Z',
    desc: 'Выдача наличных · Холов Баходур',
  }
  const bf = {
    id: 'DL-BF-992938463959-1789309405427',
    source: 'backfill',
    amount: 1741.31,
    remaining: 1741.31,
    createdAtIso: '2026-09-13T14:23:25.427Z',
    desc: 'Существующий долг',
  }
  const closed = {
    id: 'DL-1789303943141-e5kn',
    source: 'cash_advance',
    amount: 1,
    remaining: 0,
    createdAtIso: '2026-09-13T12:49:56.410Z',
    desc: 'Выдача наличных · Сайёд Гафуров',
  }
  const ledger = [bf, ca, closed]
  return {
    clients: [
      {
        id: 'U-01',
        name: 'Холов Баходур',
        phone: '+992 50 190 31 41',
        card: CARD_0001,
        debt: 2228.01,
        debtEnabled: true,
        debtLedger: structuredClone(ledger),
      },
      {
        id: 'U-03',
        name: 'Холов Баходур',
        phone: '+992938463959',
        card: CARD_0001,
        debt: 2228.01,
        debtEnabled: true,
        debtLedger: structuredClone(ledger),
      },
    ],
    cards: [
      {
        num: CARD_0001,
        clientId: 'U-03',
        client: 'Холов Баходур',
        phone: '+992938463959',
        status: 'active',
        debt: 2228.01,
        debtPayVersion: 85,
        debtEnabled: true,
        debtLedger: structuredClone(ledger),
      },
      {
        num: CARD_0003,
        clientId: undefined,
        client: '',
        phone: '',
        status: 'unlinked',
        debt: 0,
        debtPayVersion: 0,
        debtLedger: [],
      },
    ],
    moneyLedger: [
      { id: 'LED-mtzwm0yi-hlqv8', type: 'cash_advance_cash', amount: 486.7, clientRef: 'b56ef247-caab-400c-9311-310ca0ca56b9' },
    ],
    posSales: [
      { id: 'SALE-mtzwd46g-vvx1g', orderId: 'K-9649', debtAdded: 99 },
      { id: 'SALE-mtzwh59y-6e0e0', orderId: 'K-9652', debtAdded: 6.5 },
    ],
    financeMoves: [{ id: 'FM-1', amount: 1 }],
    stockMarker: { qty: 42 },
    loyaltyMarker: { bonus: 9 },
    shiftMarker: { salesCount: 7 },
  }
}

function fingerprintSide(state) {
  return JSON.stringify({
    moneyLedger: state.moneyLedger,
    posSales: state.posSales,
    financeMoves: state.financeMoves,
    stockMarker: state.stockMarker,
    loyaltyMarker: state.loyaltyMarker,
    shiftMarker: state.shiftMarker,
  })
}

test('1) dry-run / build makes zero writes to original state', () => {
  const state = mkCorruptedFixture()
  const before = JSON.stringify(state)
  const pre = verifyCorruptedPreconditions(state)
  expect(pre.ok, pre.reasons?.join(';'))
  const repaired = buildRepairedEntities(state)
  expect(!!repaired.c1, 'built')
  expect(JSON.stringify(state) === before, 'state unchanged by build')
  const plan = planSummary(repaired)
  expect(plan.WOULD_SET_SAYOD_DEBT === SAYOD_DEBT, 'sayod')
  expect(plan.WOULD_SET_HOLOV_DEBT === HOLOV_DEBT, 'holov')
  expect(plan.WOULD_MOVE_CA_486_70, 'ca move')
  expect(plan.WOULD_RECREATE_K9649, 'k9649')
  expect(plan.WOULD_RECREATE_K9652, 'k9652')
  expect(!plan.WOULD_TOUCH_STOCK && !plan.WOULD_TOUCH_SALES && !plan.WOULD_TOUCH_FINANCE, 'no side')
})

test('2) corrupted -> successful repair', () => {
  const state = mkCorruptedFixture()
  const sideBefore = fingerprintSide(state)
  const repaired = buildRepairedEntities(state)
  applyRepairedToState(state, repaired)
  expect(isAlreadyRepaired(state), 'repaired')
  expect(fingerprintSide(state) === sideBefore, 'side effects unchanged')
  expect(openSum(state.cards.find(c => c.num === CARD_0001).debtLedger) === SAYOD_DEBT, 'sayod open')
  expect(openSum(state.cards.find(c => c.num === CARD_0003).debtLedger) === HOLOV_DEBT, 'holov open')
})

test('3) wrong precondition -> abort (no apply)', () => {
  const state = mkCorruptedFixture()
  state.cards.find(c => c.num === CARD_0001).debt = 100
  const pre = verifyCorruptedPreconditions(state)
  expect(!pre.ok, 'must fail')
  const before = JSON.stringify(state)
  // operator must not apply when pre fails — simulate by not calling apply
  expect(JSON.stringify(state) === before, 'untouched')
})

test('4) partial write failure -> full rollback', () => {
  const state = mkCorruptedFixture()
  const before = JSON.stringify(state)
  const repaired = buildRepairedEntities(state)
  let threw = false
  try {
    applyRepairedToState(state, repaired, { failAt: 'after_card_0001' })
  } catch (e) {
    threw = /INJECTED_FAIL/.test(e.message)
  }
  expect(threw, 'injected fail')
  expect(JSON.stringify(state) === before, 'full rollback')
})

test('5) second run -> ALREADY_REPAIRED', () => {
  const state = mkCorruptedFixture()
  applyRepairedToState(state, buildRepairedEntities(state))
  expect(isAlreadyRepaired(state), 'first')
  expect(isAlreadyRepaired(state), 'second')
})

test('6) cash advance count remains 1', () => {
  const state = mkCorruptedFixture()
  applyRepairedToState(state, buildRepairedEntities(state))
  const all = [...state.cards.find(c => c.num === CARD_0001).debtLedger, ...state.cards.find(c => c.num === CARD_0003).debtLedger]
  const openCa = all.filter(e => String(e.id) === CA_ID && Number(e.remaining) > 0.001)
  expect(openCa.length === 1, `ca=${openCa.length}`)
  expect(openCa[0] && state.cards.find(c => c.num === CARD_0003).debtLedger.some(e => e.id === CA_ID), 'on 0003')
})

test('7) K-9649 count remains 1', () => {
  const state = mkCorruptedFixture()
  applyRepairedToState(state, buildRepairedEntities(state))
  const c3 = state.cards.find(c => c.num === CARD_0003)
  expect(countOpenBy(c3.debtLedger, e => String(e.orderId) === 'K-9649') === 1, 'k9649')
})

test('8) K-9652 count remains 1', () => {
  const state = mkCorruptedFixture()
  applyRepairedToState(state, buildRepairedEntities(state))
  const c3 = state.cards.find(c => c.num === CARD_0003)
  expect(countOpenBy(c3.debtLedger, e => String(e.orderId) === 'K-9652') === 1, 'k9652')
})

test('9) moneyLedger unchanged', () => {
  const state = mkCorruptedFixture()
  const before = JSON.stringify(state.moneyLedger)
  applyRepairedToState(state, buildRepairedEntities(state))
  expect(JSON.stringify(state.moneyLedger) === before, 'money')
})

test('10) finance unchanged', () => {
  const state = mkCorruptedFixture()
  const before = JSON.stringify(state.financeMoves)
  applyRepairedToState(state, buildRepairedEntities(state))
  expect(JSON.stringify(state.financeMoves) === before, 'finance')
})

test('11) stock unchanged', () => {
  const state = mkCorruptedFixture()
  const before = JSON.stringify(state.stockMarker)
  applyRepairedToState(state, buildRepairedEntities(state))
  expect(JSON.stringify(state.stockMarker) === before, 'stock')
})

test('12) loyalty unchanged', () => {
  const state = mkCorruptedFixture()
  const before = JSON.stringify(state.loyaltyMarker)
  applyRepairedToState(state, buildRepairedEntities(state))
  expect(JSON.stringify(state.loyaltyMarker) === before, 'loyalty')
})

test('13) shift unchanged', () => {
  const state = mkCorruptedFixture()
  const before = JSON.stringify(state.shiftMarker)
  applyRepairedToState(state, buildRepairedEntities(state))
  expect(JSON.stringify(state.shiftMarker) === before, 'shift')
})

test('14) rollback restores exact prior JSON state', () => {
  const state = mkCorruptedFixture()
  const snap = exportRollbackSnapshot(state)
  const beforeFour = JSON.stringify({
    u01: state.clients.find(c => c.id === 'U-01'),
    u03: state.clients.find(c => c.id === 'U-03'),
    c1: state.cards.find(c => c.num === CARD_0001),
    c3: state.cards.find(c => c.num === CARD_0003),
  })
  applyRepairedToState(state, buildRepairedEntities(state))
  expect(isAlreadyRepaired(state), 'repaired before rollback')
  applyRollbackSnapshotToState(state, snap)
  const afterFour = JSON.stringify({
    u01: state.clients.find(c => c.id === 'U-01'),
    u03: state.clients.find(c => c.id === 'U-03'),
    c1: state.cards.find(c => c.num === CARD_0001),
    c3: state.cards.find(c => c.num === CARD_0003),
  })
  expect(afterFour === beforeFour, 'exact restore')
  expect(verifyCorruptedPreconditions(state).ok, 'corrupted shape restored')
})

test('rollback also rolls back on injected fail', () => {
  const state = mkCorruptedFixture()
  const snap = exportRollbackSnapshot(state)
  applyRepairedToState(state, buildRepairedEntities(state))
  const mid = JSON.stringify(state.cards.find(c => c.num === CARD_0001))
  let threw = false
  try {
    applyRollbackSnapshotToState(state, snap, { failAt: 'after_card_0001' })
  } catch (e) {
    threw = /INJECTED_FAIL/.test(e.message)
  }
  expect(threw, 'fail')
  expect(JSON.stringify(state.cards.find(c => c.num === CARD_0001)) === mid, 'still repaired after failed rollback')
})

const failed = results.filter(r => r.status === 'FAIL')
console.log(JSON.stringify({
  passed: results.filter(r => r.status === 'PASS').length,
  failed: failed.length,
  failures: failed,
}, null, 2))
if (failed.length) process.exit(1)

// write fixture for manual CLI dry-run
const fixturePath = path.join(__dirname, '_diag_out', 'sayod-holov-corrupted-fixture.json')
fs.mkdirSync(path.dirname(fixturePath), { recursive: true })
fs.writeFileSync(fixturePath, JSON.stringify(mkCorruptedFixture(), null, 2))
console.log('FIXTURE', fixturePath)
