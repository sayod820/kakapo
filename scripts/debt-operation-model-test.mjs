/**
 * Phase D1 — DebtOperation model tests (pure, no DB / network).
 * Run: node scripts/debt-operation-model-test.mjs
 */
import {
  round2,
  moneyToCents,
  centsToMoney,
  isSyntheticCashTarget,
  isCanonicalDebtLedgerTarget,
  toDebtOperationFromSale,
  toDebtOperationFromRepayment,
  toDebtOperationFromCashAdvance,
  validateDebtOperation,
  serializeDebtOperation,
  deserializeDebtOperation,
} from '../lib/debtOperationCore.mjs'

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

function deepClone(v) {
  return JSON.parse(JSON.stringify(v))
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

// ── A. sale_on_credit mapping ──
test('A) sale_on_credit mapping preserves clientRef / ids / +debtDelta', () => {
  const input = {
    clientRef: 'cref-sale-001',
    clientId: 'U-01',
    cardNum: 'КАКАПО-0001',
    debtAdded: 120.5,
    saleId: 'local-sale-9',
    orderId: 'K-100',
    shiftId: 'sh-1',
    createdAtIso: '2026-09-14T10:00:00.000Z',
    seq: 42,
  }
  const before = deepClone(input)
  const op = toDebtOperationFromSale(input)
  expect(deepEqual(input, before), 'input mutated')
  expect(op.clientRef === 'cref-sale-001', 'clientRef')
  expect(op.operationId === op.clientRef, 'operationId === clientRef')
  expect(op.type === 'sale_on_credit', 'type')
  expect(op.debtDelta === 120.5, `debtDelta=${op.debtDelta}`)
  expect(op.amount === 120.5, `amount=${op.amount}`)
  expect(op.clientId === 'U-01', 'clientId')
  expect(op.cardNum === 'КАКАПО-0001', 'card')
  expect(op.saleId === 'local-sale-9', 'saleId')
  expect(op.shiftId === 'sh-1', 'shiftId')
  expect(op.opSeq === 42, 'opSeq')
  const v = validateDebtOperation(op)
  expect(v.ok, v.errors.join(','))
})

// ── B. cash_advance mapping ──
test('B) cash_advance mapping: stable id, +debtDelta, null ledger target OK', () => {
  const input = {
    clientRef: 'cref-ca-002',
    clientId: 'U-03',
    num: 'КАКАПО-0003',
    amount: 486.7,
    shiftId: 'sh-2',
    createdAtIso: '2026-09-14T11:00:00.000Z',
  }
  const before = deepClone(input)
  const op = toDebtOperationFromCashAdvance(input)
  expect(deepEqual(input, before), 'input mutated')
  expect(op.operationId === 'cref-ca-002', 'operationId')
  expect(op.operationId === op.clientRef, 'id rule')
  expect(op.type === 'cash_advance', 'type')
  expect(op.debtDelta === 486.7, `debtDelta=${op.debtDelta}`)
  expect(op.targetDebtLedgerId == null, 'ledger null before server')
  expect(op.cardNum === 'КАКАПО-0003', 'card from num')
  const v = validateDebtOperation(op)
  expect(v.ok, v.errors.join(','))
})

// ── C. debt_repay mapping ──
test('C) debt_repay mapping: -debtDelta, method preserved', () => {
  for (const method of ['cash', 'card']) {
    const input = {
      clientRef: `cref-repay-${method}`,
      clientId: 'U-01',
      num: 'КАКАПО-0001',
      amount: 50,
      method,
      shiftId: 'sh-3',
      createdAtIso: '2026-09-14T12:00:00.000Z',
      appliedLocal: true,
    }
    const before = deepClone(input)
    const op = toDebtOperationFromRepayment(input)
    expect(deepEqual(input, before), 'input mutated')
    expect(op.type === 'debt_repay', 'type')
    expect(op.debtDelta === -50, `debtDelta=${op.debtDelta}`)
    expect(op.amount === 50, 'amount')
    expect(op.method === method, `method=${op.method}`)
    expect(op.appliedLocal === true, 'appliedLocal')
    const v = validateDebtOperation(op)
    expect(v.ok, v.errors.join(','))
  }
})

// ── D. selected receipt DL-* ──
test('D) selected receipt DL-* target preserved exactly', () => {
  const led = 'DL-1789309389399-c099'
  const input = {
    clientRef: 'cref-target-dl',
    clientId: 'U-03',
    amount: 100,
    method: 'cash',
    orderId: led,
    createdAtIso: '2026-09-14T12:30:00.000Z',
  }
  const op = toDebtOperationFromRepayment(input)
  expect(op.targetDebtLedgerId === led, `ledger=${op.targetDebtLedgerId}`)
  expect(op.targetOrderId === led, `orderId=${op.targetOrderId}`)
  expect(isCanonicalDebtLedgerTarget(op.targetDebtLedgerId), 'canonical')
  const v = validateDebtOperation(op)
  expect(v.ok, v.errors.join(','))
})

// ── E. legacy cash-* ──
test('E) legacy cash-* target: validator rejects, input untouched', () => {
  const input = {
    clientRef: 'cref-cash-legacy',
    clientId: 'U-03',
    amount: 486.7,
    method: 'cash',
    targetDebtLedgerId: 'cash-log-DL-legacy-1',
    createdAtIso: '2026-09-14T12:45:00.000Z',
  }
  const before = deepClone(input)
  const op = toDebtOperationFromRepayment(input)
  expect(deepEqual(input, before), 'mapper mutated input')
  expect(op.targetDebtLedgerId === 'cash-log-DL-legacy-1', 'must not auto-rewrite target')
  expect(isSyntheticCashTarget(op.targetDebtLedgerId), 'synthetic detect')
  const v = validateDebtOperation(op)
  expect(!v.ok, 'must fail validation')
  expect(
    v.errors.includes('targetDebtLedgerId_synthetic_cash_not_canonical'),
    `errors=${v.errors.join(',')}`,
  )
  // Validator must not mutate op
  const afterValidate = deepClone(op)
  validateDebtOperation(op)
  expect(deepEqual(op, afterValidate), 'validator mutated op')
})

// ── F. id stability serialize/deserialize ──
test('F) serialize → deserialize keeps operationId', () => {
  const op = toDebtOperationFromSale({
    clientRef: 'cref-stable-f',
    clientId: 'U-01',
    debtAdded: 10,
    createdAtIso: '2026-09-14T13:00:00.000Z',
  })
  const round = deserializeDebtOperation(serializeDebtOperation(op))
  expect(round.operationId === op.operationId, 'operationId')
  expect(round.clientRef === op.clientRef, 'clientRef')
  expect(round.operationId === round.clientRef, 'rule')
})

// ── G. server remap simulation ──
test('G) saleId/orderId remap does not change operationId', () => {
  const clientRef = 'cref-remap-g'
  const op1 = toDebtOperationFromSale({
    clientRef,
    clientId: 'U-01',
    debtAdded: 33.33,
    saleId: 'local-abc',
    orderId: 'K-1',
    createdAtIso: '2026-09-14T13:10:00.000Z',
  })
  const op2 = toDebtOperationFromSale({
    clientRef,
    clientId: 'U-01',
    debtAdded: 33.33,
    saleId: 'server-sale-999',
    orderId: 'ORD-server-999',
    createdAtIso: '2026-09-14T13:10:00.000Z',
  })
  expect(op1.operationId === clientRef, 'op1 id')
  expect(op2.operationId === clientRef, 'op2 id')
  expect(op1.operationId === op2.operationId, 'stable across remap')
  expect(op1.saleId !== op2.saleId, 'saleId may change')
  expect(op1.targetOrderId !== op2.targetOrderId, 'orderId may change')
})

// ── H. duplicate retry ──
test('H) duplicate payloads with same clientRef → same operationId', () => {
  const payload = {
    clientRef: 'cref-dup-h',
    clientId: 'U-01',
    amount: 20,
    method: 'cash',
    createdAtIso: '2026-09-14T13:20:00.000Z',
  }
  const a = toDebtOperationFromRepayment(payload)
  const b = toDebtOperationFromRepayment({ ...payload, attempts: 2, failed: true })
  expect(a.operationId === b.operationId, 'same operationId')
  expect(a.operationId === payload.clientRef, 'equals clientRef')
})

// ── I. amount precision 486.70 ──
test('I) amount precision 486.70 exact in normalized form', () => {
  const op = toDebtOperationFromCashAdvance({
    clientRef: 'cref-prec-i',
    clientId: 'U-03',
    amount: 486.7,
    createdAtIso: '2026-09-14T13:30:00.000Z',
  })
  expect(op.amount === 486.7, `amount=${op.amount}`)
  expect(moneyToCents(op.amount) === 48670, `cents=${moneyToCents(op.amount)}`)
  expect(centsToMoney(48670) === 486.7, 'cents back')
  expect(round2(0) === 0, 'zero')
  expect(round2(0.01) === 0.01, '0.01')
  expect(moneyToCents(0.01) === 1, '1 cent')
  expect(moneyToCents(1000000.12) === 100000012, 'large')
  // classic float trap: 0.1+0.2
  expect(round2(0.1 + 0.2) === 0.3, '0.1+0.2')
  expect(moneyToCents(0.1 + 0.2) === 30, '30 cents')
})

// ── J. helpers pure ──
test('J) helpers are pure (deepEqual before/after)', () => {
  const saleIn = {
    clientRef: 'cref-pure-j',
    clientId: 'U-01',
    debtAdded: 15.55,
    saleId: 'S1',
    createdAtIso: '2026-09-14T14:00:00.000Z',
  }
  const repayIn = {
    clientRef: 'cref-pure-j2',
    clientId: 'U-01',
    amount: 5,
    method: 'card',
    orderId: 'DL-abc',
    createdAtIso: '2026-09-14T14:01:00.000Z',
  }
  const caIn = {
    clientRef: 'cref-pure-j3',
    clientId: 'U-03',
    amount: 1,
    createdAtIso: '2026-09-14T14:02:00.000Z',
  }
  const s0 = deepClone(saleIn)
  const r0 = deepClone(repayIn)
  const c0 = deepClone(caIn)
  toDebtOperationFromSale(saleIn)
  toDebtOperationFromRepayment(repayIn)
  toDebtOperationFromCashAdvance(caIn)
  expect(deepEqual(saleIn, s0), 'sale input')
  expect(deepEqual(repayIn, r0), 'repay input')
  expect(deepEqual(caIn, c0), 'ca input')
})

// Extra invariant checks
test('invariant: operationId === clientRef always from mappers', () => {
  const samples = [
    toDebtOperationFromSale({ clientRef: 'a', clientId: 'c', debtAdded: 1, createdAtIso: '2026-01-01T00:00:00.000Z' }),
    toDebtOperationFromRepayment({ clientRef: 'b', clientId: 'c', amount: 1, createdAtIso: '2026-01-01T00:00:00.000Z' }),
    toDebtOperationFromCashAdvance({ clientRef: 'd', clientId: 'c', amount: 1, createdAtIso: '2026-01-01T00:00:00.000Z' }),
  ]
  for (const op of samples) {
    expect(op.operationId === op.clientRef, `${op.type} id mismatch`)
  }
})

test('validator rejects operationId !== clientRef', () => {
  const op = toDebtOperationFromSale({
    clientRef: 'cref-x',
    clientId: 'U-01',
    debtAdded: 1,
    createdAtIso: '2026-01-01T00:00:00.000Z',
  })
  op.operationId = 'other'
  const v = validateDebtOperation(op)
  expect(!v.ok, 'must fail')
  expect(v.errors.includes('operationId_must_equal_clientRef'), v.errors.join(','))
})

test('validator rejects wrong debtDelta sign', () => {
  const op = toDebtOperationFromRepayment({
    clientRef: 'cref-sign',
    clientId: 'U-01',
    amount: 10,
    createdAtIso: '2026-01-01T00:00:00.000Z',
  })
  op.debtDelta = 10
  const v = validateDebtOperation(op)
  expect(!v.ok, 'must fail')
  expect(v.errors.includes('debtDelta_must_be_negative_for_repay'), v.errors.join(','))
})

console.log(`\n${'='.repeat(40)}`)
console.log(`RESULT  passed=${passed} failed=${failed}`)
if (failed > 0) process.exit(1)
