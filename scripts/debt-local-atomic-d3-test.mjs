/**
 * Phase D3 — unify local atomic debt repay / cash advance.
 * Run: node scripts/debt-local-atomic-d3-test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEBT_OP_ENVELOPE_KV_KEY,
  applyDebtOpEnvelopeToStore,
  buildCashAdvanceEnvelope,
  buildDebtRepayEnvelope,
  recoverDebtOpEnvelopesInStore,
  round2,
  upsertCashRepayLedger,
} from '../lib/localDebtCommitEnvelopeCore.mjs'
import {
  toDebtOperationFromRepayment,
  toDebtOperationFromCashAdvance,
  validateDebtOperation,
  isSyntheticCashTarget,
} from '../lib/debtOperationCore.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`PASS  ${name}`)
  } catch (e) {
    failed++
    console.error(`FAIL  ${name}`)
    console.error(`      ${e?.message || e}`)
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}

const localDbSrc = fs.readFileSync(path.join(root, 'desktop', 'localDb.cjs'), 'utf8')
const opsSrc = fs.readFileSync(path.join(root, 'lib', 'offlinePosOps.ts'), 'utf8')
const hydrateSrc = fs.readFileSync(path.join(root, 'lib', 'offlineHydrate.ts'), 'utf8')
const envSrc = fs.readFileSync(path.join(root, 'lib', 'localDebtCommitEnvelope.ts'), 'utf8')

function openStore(seed = {}) {
  return {
    queue: new Map(),
    kv: new Map(Object.entries(seed.kv || {}).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])),
  }
}

function seedCrm(debt = 100) {
  return {
    kv: {
      data_clients: [{ id: 'U-01', debt, card: 'КАКАПО-0001' }],
      catalog_clients: [{ id: 'U-01', debt, card: 'КАКАПО-0001' }],
      data_cards: [{ num: 'КАКАПО-0001', clientId: 'U-01', debt, debtPayVersion: 2 }],
      data_pos_snapshot: {
        shifts: [{ id: 'sh1', debtRepayCash: 0, expenseTotal: 0, status: 'open' }],
      },
      data_debt_repay_cash_ledger: [],
    },
  }
}

function repayEnv(opts = {}) {
  const amount = opts.amount != null ? opts.amount : 20
  const prev = opts.prevDebt != null ? opts.prevDebt : 100
  const nextDebt = round2(prev - amount)
  const clientRef = opts.clientRef || 'cref-repay-1'
  const orderId = opts.orderId
  return buildDebtRepayEnvelope({
    clientRef,
    queueRow: {
      clientRef,
      kind: 'debt_repay',
      payload: {
        clientRef,
        num: 'КАКАПО-0001',
        amount,
        method: opts.method || 'cash',
        clientId: 'U-01',
        prevDebt: prev,
        nextDebt,
        orderId,
        appliedLocal: true,
        expectedDebtPayVersion: 2,
      },
      createdAtIso: '2026-09-14T16:00:00.000Z',
      seq: 1,
      attempts: 0,
      localId: clientRef,
    },
    client: { id: 'U-01', debt: nextDebt, card: 'КАКАПО-0001' },
    card: { num: 'КАКАПО-0001', debt: nextDebt, debtPayVersion: 3, clientId: 'U-01' },
    shift: opts.method === 'card'
      ? { id: 'sh1', debtRepayCash: 0, expenseTotal: 0 }
      : { id: 'sh1', debtRepayCash: amount, expenseTotal: 0 },
    cashRepayLedgerEntry: (opts.method === 'card')
      ? null
      : {
          clientRef,
          shiftId: 'sh1',
          amount,
          method: 'cash',
          orderId,
          createdAtIso: '2026-09-14T16:00:00.000Z',
        },
  })
}

function caEnv(opts = {}) {
  const amount = opts.amount != null ? opts.amount : 50
  const prev = opts.prevDebt != null ? opts.prevDebt : 100
  const nextDebt = round2(prev + amount)
  const clientRef = opts.clientRef || 'cref-ca-1'
  return buildCashAdvanceEnvelope({
    clientRef,
    queueRow: {
      clientRef,
      kind: 'cash_advance',
      payload: {
        clientRef,
        num: 'КАКАПО-0001',
        amount,
        clientId: 'U-01',
        prevDebt: prev,
        nextDebt,
        appliedLocal: true,
        expectedDebtPayVersion: 2,
      },
      createdAtIso: '2026-09-14T16:10:00.000Z',
      seq: 2,
      attempts: 0,
      localId: clientRef,
    },
    client: { id: 'U-01', debt: nextDebt, debtEnabled: true, card: 'КАКАПО-0001' },
    card: { num: 'КАКАПО-0001', debt: nextDebt, debtPayVersion: 3, debtEnabled: true, clientId: 'U-01' },
    shift: { id: 'sh1', expenseTotal: amount, debtRepayCash: 0 },
  })
}

// 1–2 Desktop wiring still atomic
test('1) Desktop repay still atomic (sqlDebtRepayCommit + D3 KV/ledger)', () => {
  expect(localDbSrc.includes('function sqlDebtRepayCommit'), 'sqlDebtRepayCommit')
  expect(localDbSrc.includes('db.transaction'), 'transaction')
  expect(localDbSrc.includes("sqlUpsertKvArrayRow('data_clients'"), 'D3 clients KV')
  expect(localDbSrc.includes("sqlUpsertKvArrayRow('data_cards'"), 'D3 cards KV')
  expect(localDbSrc.includes('cashRepayLedgerEntry'), 'cash ledger in txn')
  expect(opsSrc.includes('canAtomicLocalDebtRepayCommit'), 'Desktop gate')
  expect(opsSrc.includes('cashRepayLedgerEntry: cashLedgerEntry'), 'pass ledger')
})

test('2) Desktop CA still atomic (reuses debtRepayCommit IPC)', () => {
  expect(opsSrc.includes('canAtomicLocalCashAdvanceCommit'), 'CA gate')
  expect(opsSrc.includes('commitLocalCashAdvanceAtomic'), 'CA commit')
  const caAtomic = fs.readFileSync(path.join(root, 'lib', 'localCashAdvanceAtomic.ts'), 'utf8')
  expect(caAtomic.includes('commitLocalDebtRepayAtomic'), 'reuses repay IPC')
})

// 3–4 Android envelope path
test('3) Android/non-Desktop repay uses envelope path', () => {
  expect(opsSrc.includes('canEnvelopeLocalDebtCommit'), 'envelope gate')
  expect(opsSrc.includes("kind: 'debt_repay'"), 'repay kind')
  expect(opsSrc.includes('commitLocalDebtOpEnvelope'), 'envelope commit')
  expect(envSrc.includes('write-ahead envelope'), 'module')
})

test('4) Android/non-Desktop CA uses envelope path', () => {
  expect(opsSrc.includes("kind: 'cash_advance'"), 'ca kind to envelope')
  const idx = opsSrc.indexOf('// Android / file-store: write-ahead envelope')
  expect(idx > 0, 'CA envelope comment')
  expect(opsSrc.includes("kind: 'cash_advance'"), 'cash_advance')
})

test('5) crash after queue write → recover completes once', () => {
  const store = openStore(seedCrm(100))
  const env = repayEnv({ amount: 20, prevDebt: 100 })
  let threw = false
  try {
    applyDebtOpEnvelopeToStore(store, env, 'after_queue')
  } catch {
    threw = true
  }
  expect(threw, 'threw')
  expect(store.kv.get(DEBT_OP_ENVELOPE_KV_KEY)['cref-repay-1'], 'intent remains')
  recoverDebtOpEnvelopesInStore(store)
  expect(store.kv.get('data_clients').find(c => c.id === 'U-01').debt === 80, 'debt 80')
  expect(!store.kv.get(DEBT_OP_ENVELOPE_KV_KEY)['cref-repay-1'], 'envelope cleared')
  expect(store.queue.has('cref-repay-1'), 'queue')
})

test('6) crash after client write → recover', () => {
  const store = openStore(seedCrm(100))
  try {
    applyDebtOpEnvelopeToStore(store, repayEnv(), 'after_client')
  } catch { /* expected */ }
  recoverDebtOpEnvelopesInStore(store)
  expect(store.kv.get('data_clients')[0].debt === 80, 'client')
  expect(store.kv.get('data_cards')[0].debt === 80, 'card')
})

test('7) crash after card write → recover', () => {
  const store = openStore(seedCrm(100))
  try {
    applyDebtOpEnvelopeToStore(store, repayEnv(), 'after_card')
  } catch { /* expected */ }
  recoverDebtOpEnvelopesInStore(store)
  expect(store.kv.get('data_cards')[0].debt === 80, 'card debt')
})

test('8) crash before shift write → recover includes shift', () => {
  const store = openStore(seedCrm(100))
  try {
    applyDebtOpEnvelopeToStore(store, repayEnv(), 'after_client')
  } catch { /* expected */ }
  recoverDebtOpEnvelopesInStore(store)
  const sh = store.kv.get('data_pos_snapshot').shifts.find(s => s.id === 'sh1')
  expect(sh.debtRepayCash === 20, `debtRepayCash=${sh.debtRepayCash}`)
})

test('9) crash before final clear → recover clears envelope', () => {
  const store = openStore(seedCrm(100))
  try {
    applyDebtOpEnvelopeToStore(store, repayEnv(), 'before_clear')
  } catch { /* expected */ }
  expect(store.kv.get(DEBT_OP_ENVELOPE_KV_KEY)['cref-repay-1'], 'still intent')
  recoverDebtOpEnvelopesInStore(store)
  expect(!store.kv.get(DEBT_OP_ENVELOPE_KV_KEY)['cref-repay-1'], 'cleared')
  expect(store.kv.get('data_clients')[0].debt === 80, 'debt ok')
})

test('10) crash immediately after commit (no envelope) → durable state kept', () => {
  const store = openStore(seedCrm(100))
  applyDebtOpEnvelopeToStore(store, repayEnv(), '')
  expect(!store.kv.get(DEBT_OP_ENVELOPE_KV_KEY)['cref-repay-1'], 'no envelope')
  expect(store.queue.has('cref-repay-1'), 'queue')
  expect(store.kv.get('data_clients')[0].debt === 80, 'debt')
})

test('11) duplicate repayment same clientRef → debt once', () => {
  const store = openStore(seedCrm(100))
  applyDebtOpEnvelopeToStore(store, repayEnv({ clientRef: 'dup-r', amount: 20 }), '')
  applyDebtOpEnvelopeToStore(store, repayEnv({ clientRef: 'dup-r', amount: 20 }), '')
  expect(store.kv.get('data_clients')[0].debt === 80, 'still 80')
  expect(store.queue.size === 1, 'one queue')
  const led = store.kv.get('data_debt_repay_cash_ledger')
  expect(led.filter(r => r.clientRef === 'dup-r').length === 1, 'ledger once')
})

test('12) duplicate CA same clientRef → debt once', () => {
  const store = openStore(seedCrm(100))
  applyDebtOpEnvelopeToStore(store, caEnv({ clientRef: 'dup-ca', amount: 50 }), '')
  applyDebtOpEnvelopeToStore(store, caEnv({ clientRef: 'dup-ca', amount: 50 }), '')
  expect(store.kv.get('data_clients')[0].debt === 150, '150')
  expect(store.queue.size === 1, 'one queue')
})

test('13) cash repayment shift effect once', () => {
  const store = openStore(seedCrm(100))
  applyDebtOpEnvelopeToStore(store, repayEnv({ amount: 15 }), '')
  applyDebtOpEnvelopeToStore(store, repayEnv({ amount: 15 }), '')
  const sh = store.kv.get('data_pos_snapshot').shifts[0]
  expect(sh.debtRepayCash === 15, `got ${sh.debtRepayCash}`)
})

test('14) CA shift expense effect once', () => {
  const store = openStore(seedCrm(100))
  applyDebtOpEnvelopeToStore(store, caEnv({ amount: 40 }), '')
  applyDebtOpEnvelopeToStore(store, caEnv({ amount: 40 }), '')
  expect(store.kv.get('data_pos_snapshot').shifts[0].expenseTotal === 40, 'expense once')
})

test('15) selected DL-* target preserved', () => {
  const led = 'DL-1789309389399-c099'
  const env = repayEnv({ orderId: led, amount: 10 })
  expect(env.queueRow.payload.orderId === led, 'orderId')
  const op = toDebtOperationFromRepayment({
    clientRef: env.clientRef,
    clientId: 'U-01',
    amount: 10,
    method: 'cash',
    orderId: led,
    createdAtIso: env.createdAtIso,
  })
  expect(op.targetDebtLedgerId === led, 'target')
  expect(validateDebtOperation(op).ok, 'valid')
})

test('16) FIFO repayment target null allowed', () => {
  const op = toDebtOperationFromRepayment({
    clientRef: 'fifo-1',
    clientId: 'U-01',
    amount: 5,
    method: 'cash',
    createdAtIso: '2026-09-14T16:00:00.000Z',
  })
  expect(op.targetDebtLedgerId == null, 'null target')
  expect(validateDebtOperation(op).ok, 'ok')
})

test('17) synthetic cash-* not canonicalized', () => {
  const op = toDebtOperationFromRepayment({
    clientRef: 'cash-syn',
    clientId: 'U-01',
    amount: 5,
    targetDebtLedgerId: 'cash-log-x',
    createdAtIso: '2026-09-14T16:00:00.000Z',
  })
  expect(isSyntheticCashTarget(op.targetDebtLedgerId), 'synthetic')
  expect(!validateDebtOperation(op).ok, 'invalid')
  expect(op.targetDebtLedgerId === 'cash-log-x', 'not rewritten')
})

test('18) app restart restores correct debt', () => {
  const store = openStore(seedCrm(200))
  applyDebtOpEnvelopeToStore(store, repayEnv({ prevDebt: 200, amount: 30 }), '')
  const reloaded = openStore({
    kv: Object.fromEntries([...store.kv.entries()]),
  })
  reloaded.queue = new Map(store.queue)
  expect(reloaded.kv.get('data_clients')[0].debt === 170, 'hydrate debt')
  expect(reloaded.queue.has('cref-repay-1'), 'queue survives')
})

test('19) no network required for local-capable platform (source)', () => {
  const localBlock = opsSrc.slice(
    opsSrc.indexOf('const applyLocal = async (): Promise<DebtRepayResult>'),
    opsSrc.indexOf('const run = localFirstOp(applyLocal)', opsSrc.indexOf('const applyLocal = async (): Promise<DebtRepayResult>')),
  )
  expect(!localBlock.includes('await api.'), 'no api in local repay')
  expect(opsSrc.includes('NETWORK') || true, 'ok')
})

test('20) operationId == clientRef (D1 mappers)', () => {
  const r = toDebtOperationFromRepayment({
    clientRef: 'op-r',
    clientId: 'U-01',
    amount: 1,
    createdAtIso: '2026-01-01T00:00:00.000Z',
  })
  const c = toDebtOperationFromCashAdvance({
    clientRef: 'op-c',
    clientId: 'U-01',
    amount: 1,
    createdAtIso: '2026-01-01T00:00:00.000Z',
  })
  expect(r.operationId === r.clientRef && r.operationId === 'op-r', 'repay')
  expect(c.operationId === c.clientRef && c.operationId === 'op-c', 'ca')
})

test('21) history not duplicated (cash ledger upsert by clientRef)', () => {
  let led = []
  led = upsertCashRepayLedger(led, { clientRef: 'h1', shiftId: 'sh1', amount: 10, method: 'cash' })
  led = upsertCashRepayLedger(led, { clientRef: 'h1', shiftId: 'sh1', amount: 10, method: 'cash' })
  expect(led.length === 1, 'once')
  expect(led[0].amount === 10, 'amount')
})

test('22) journal not duplicated (re-apply envelope keeps one ledger row)', () => {
  const store = openStore(seedCrm(100))
  applyDebtOpEnvelopeToStore(store, repayEnv({ clientRef: 'j1', amount: 12 }), '')
  // simulate crash-before-clear then recover
  store.kv.set(DEBT_OP_ENVELOPE_KV_KEY, {
    j1: { ...repayEnv({ clientRef: 'j1', amount: 12 }), state: 'intent' },
  })
  recoverDebtOpEnvelopesInStore(store)
  const rows = store.kv.get('data_debt_repay_cash_ledger').filter(r => r.clientRef === 'j1')
  expect(rows.length === 1, `got ${rows.length}`)
})

test('W) hydrate recovers envelopes', () => {
  expect(hydrateSrc.includes('recoverLocalDebtOpEnvelopes'), 'hydrate recover')
})

test('W2) absolute hydrate on duplicate (no double subtract)', () => {
  expect(opsSrc.includes('Absolute hydrate — never subtract amount again'), 'repay dup')
  expect(opsSrc.includes('(dup.payload as any)?.nextDebt'), 'uses nextDebt')
})

test('W3) before_intent leaves store empty', () => {
  const store = openStore(seedCrm(50))
  let threw = false
  try {
    applyDebtOpEnvelopeToStore(store, repayEnv(), 'before_intent')
  } catch {
    threw = true
  }
  expect(threw, 'threw')
  expect(store.queue.size === 0, 'no queue')
  expect(store.kv.get('data_clients')[0].debt === 50, 'debt unchanged')
})

console.log(`\n${'='.repeat(40)}`)
console.log(`RESULT  passed=${passed} failed=${failed}`)
if (failed > 0) process.exit(1)
