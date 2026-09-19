/**
 * PC-14 server-only lab tests on production baseline (6adab8+).
 * No client modules. Run: node scripts/pc14-prod-baseline-server-test.mjs
 */
import {
  buildDebtOpFingerprint,
  checkIdempotencyReplay,
  isAckLostCompatibleReplay,
  resolveDebtOpIdempotency,
  classifyDebtOpClientRef,
  findCrossKindOpRefConflict,
  IDEMPOTENCY_KEY_REUSED,
} from '../server/kakapo-api/debtOpIdempotency.js'
import { applyDebtRepayToShift, applyCashAdvanceToShift, ensurePosCollections } from '../server/kakapo-api/posLogic.js'

let passed = 0
let failed = 0
function expect(cond, msg) {
  if (cond) { passed += 1; console.log(`  OK  ${msg}`) }
  else { failed += 1; console.error(`  FAIL ${msg}`) }
}

function freshDb() {
  const db = {
    moneyLedger: [],
    opRefs: [],
    posShifts: [{ id: 'SH-1', status: 'open', salesCash: 500, posId: 'P1', cashierId: 'C1', cashierName: 'X' }],
    clients: [{ id: 'CL-1', name: 'A', card: 'VIP1', debt: 100, debtLedger: [] }],
    cards: [{ num: 'VIP1', debt: 100, debtPayVersion: 0 }],
  }
  ensurePosCollections(db)
  return db
}

function findOpRefRow(db, kind, clientRef) {
  const ref = String(clientRef || '').trim()
  return (db.opRefs || []).find(r => r.clientRef === ref && r.kind === kind) || null
}

console.log('\n=== PC-14 prod-baseline server ===\n')

// 1–2 debt_repay first commit + exact retry
{
  const db = freshDb()
  const clientRef = 'pc14-dr-first'
  const fp = buildDebtOpFingerprint('debt_repay', { amount: 38, method: 'cash', cardNum: 'VIP1', shiftId: 'SH-1', clientId: 'CL-1' })
  applyDebtRepayToShift(db, { amount: 38, method: 'cash', shiftId: 'SH-1', clientRef, cardNum: 'VIP1', clientId: 'CL-1' })
  db.opRefs.push({ kind: 'debt_repay', clientRef, fingerprint: fp, result: { amount: 38, nextDebt: 62 } })
  expect(db.moneyLedger.length === 1, '1 debt_repay first commit (one ledger)')
  const r = resolveDebtOpIdempotency(db, { kind: 'debt_repay', clientRef, fingerprint: fp, findOpRefRow: (k, ref) => findOpRefRow(db, k, ref) })
  expect(r.action === 'replay', '2 exact retry replay success')
}

// 3–4 ACK lost + shiftId drift
{
  const db = freshDb()
  const clientRef = 'pc14-shift'
  const fpCommitted = buildDebtOpFingerprint('debt_repay', { amount: 38, method: 'cash', cardNum: 'VIP1', shiftId: 'SH-1' })
  const fpRetry = buildDebtOpFingerprint('debt_repay', { amount: 38, method: 'cash', cardNum: 'VIP1', shiftId: 'SH-2' })
  applyDebtRepayToShift(db, { amount: 38, method: 'cash', shiftId: 'SH-1', clientRef, cardNum: 'VIP1' })
  db.opRefs.push({ kind: 'debt_repay', clientRef, fingerprint: fpCommitted, result: { amount: 38 } })
  expect(!checkIdempotencyReplay(fpCommitted, fpRetry).ok, 'strict fp mismatch on shift drift')
  const r = resolveDebtOpIdempotency(db, { kind: 'debt_repay', clientRef, fingerprint: fpRetry, findOpRefRow: (k, ref) => findOpRefRow(db, k, ref) })
  expect(r.action === 'replay', '3–4 ACK lost shiftId drift → replay success')
  expect(db.moneyLedger.length === 1, '5–6 business/ledger effect remains 1')
}

// 7 same amount/card/method ack-lost helper
{
  const a = buildDebtOpFingerprint('debt_repay', { amount: 10, method: 'cash', cardNum: 'VIP1', shiftId: 'SH-1' })
  const b = buildDebtOpFingerprint('debt_repay', { amount: 10, method: 'cash', cardNum: 'VIP1', shiftId: 'SH-9' })
  expect(isAckLostCompatibleReplay(a, b), '7 same amount/card/method replay compatible')
}

// 8 amount mismatch → conflict
{
  const db = freshDb()
  const clientRef = 'pc14-mismatch'
  const fp1 = buildDebtOpFingerprint('debt_repay', { amount: 38, method: 'cash', cardNum: 'VIP1', shiftId: 'SH-1' })
  const fp2 = buildDebtOpFingerprint('debt_repay', { amount: 40, method: 'cash', cardNum: 'VIP1', shiftId: 'SH-1' })
  applyDebtRepayToShift(db, { amount: 38, method: 'cash', shiftId: 'SH-1', clientRef, cardNum: 'VIP1' })
  db.opRefs.push({ kind: 'debt_repay', clientRef, fingerprint: fp1, result: { amount: 38 } })
  const r = resolveDebtOpIdempotency(db, { kind: 'debt_repay', clientRef, fingerprint: fp2, findOpRefRow: (k, ref) => findOpRefRow(db, k, ref) })
  expect(r.action === 'conflict' && r.body?.code === IDEMPOTENCY_KEY_REUSED, '8 amount mismatch → 409')
}

// 9 different operation kind → conflict
{
  const db = freshDb()
  db.opRefs.push({ kind: 'debt_repay', clientRef: 'X', fingerprint: null, result: { ok: 1 } })
  expect(!!findCrossKindOpRefConflict(db, 'cash_advance', 'X'), '9 cross-kind detected')
  const r = resolveDebtOpIdempotency(db, {
    kind: 'cash_advance',
    clientRef: 'X',
    fingerprint: buildDebtOpFingerprint('cash_advance', { amount: 10, cardNum: 'VIP1', shiftId: 'SH-1' }),
    findOpRefRow: (k, ref) => findOpRefRow(db, k, ref),
  })
  expect(r.action === 'conflict', '9 different kind same ref → reject')
}

// 10 cash_advance ACK-lost replay (opRef lost; ledger backstop — D4 scenario)
{
  const db = freshDb()
  const clientRef = 'pc14-ca-ack'
  const fp = buildDebtOpFingerprint('cash_advance', { amount: 25, cardNum: 'VIP1', shiftId: 'SH-1', method: 'cash' })
  applyCashAdvanceToShift(db, { amount: 25, shiftId: 'SH-1', clientRef, cardNum: 'VIP1' })
  db.opRefs = []
  const r = resolveDebtOpIdempotency(db, { kind: 'cash_advance', clientRef, fingerprint: fp, findOpRefRow: (k, ref) => findOpRefRow(db, k, ref) })
  expect(r.action === 'continue' && r.ledgerBackstop, '10 cash_advance ACK-lost ledger backstop')
  expect(db.moneyLedger.length === 1, '10 single CA ledger row')
}

// 11 twenty same-ref retries → one effect
{
  const db = freshDb()
  const clientRef = 'pc14-storm'
  const fp = buildDebtOpFingerprint('debt_repay', { amount: 5, method: 'cash', cardNum: 'VIP1', shiftId: 'SH-1' })
  applyDebtRepayToShift(db, { amount: 5, method: 'cash', shiftId: 'SH-1', clientRef, cardNum: 'VIP1' })
  db.opRefs.push({ kind: 'debt_repay', clientRef, fingerprint: fp, result: { amount: 5 } })
  let replays = 0
  for (let i = 0; i < 20; i++) {
    const r = resolveDebtOpIdempotency(db, { kind: 'debt_repay', clientRef, fingerprint: fp, findOpRefRow: (k, ref) => findOpRefRow(db, k, ref) })
    if (r.action === 'replay') replays += 1
  }
  expect(replays === 20, '11 twenty retries all replay')
  expect(db.moneyLedger.length === 1, '11 one ledger effect')
}

// H status endpoint helper (read-only classify)
{
  const db = freshDb()
  const clientRef = 'pc14-status'
  const fp = buildDebtOpFingerprint('debt_repay', { amount: 12, method: 'cash', cardNum: 'VIP1', shiftId: 'SH-1' })
  applyDebtRepayToShift(db, { amount: 12, method: 'cash', shiftId: 'SH-1', clientRef, cardNum: 'VIP1' })
  const fpRetry = buildDebtOpFingerprint('debt_repay', { amount: 12, method: 'cash', cardNum: 'VIP1', shiftId: 'SH-2' })
  const cls = classifyDebtOpClientRef(db, 'debt_repay', clientRef, fpRetry)
  expect(cls.classification === 'EXACT_COMMITTED', 'GET /sync/debt-op-status classify EXACT_COMMITTED')
}

console.log(`\n=== PC-14 prod-baseline server: ${passed} passed, ${failed} failed ===\n`)
process.exit(failed > 0 ? 1 : 0)
