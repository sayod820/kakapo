/**
 * Phase D4 — Server debt operation idempotency hardening.
 * Run: node scripts/debt-server-idempotency-d4-test.mjs
 *
 * Pure module + in-memory server logic tests. No production DB. No deploy.
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

const {
  buildDebtOpFingerprint,
  fingerprintsEqual,
  checkIdempotencyReplay,
  requireClientRef,
  fingerprintFromMoneyLedgerDebtRepay,
  fingerprintFromMoneyLedgerCashAdvance,
  fingerprintFromPosSale,
  debtOpRefDocId,
  IDEMPOTENCY_KEY_REUSED,
  CLIENT_REF_REQUIRED,
} = await import(pathToFileURL(path.join(apiRoot, 'debtOpIdempotency.js')).href)

const {
  createPosSale,
  createCashAdvance,
  applyDebtRepayToShift,
  ensurePosCollections,
} = await import(pathToFileURL(path.join(apiRoot, 'posLogic.js')).href)

  const {
  addDebtCharge,
  applyDebtRepayment,
  handleClientDebtDelta,
  resolveDebtRepaymentTarget,
} = await import(pathToFileURL(path.join(apiRoot, 'debtLedger.js')).href)

const { IDEMPOTENCY_UNIQUE_INDEXES, classifyUniqueViolation } = await import(
  pathToFileURL(path.join(apiRoot, 'pg', 'uniqueIdempotency.js')).href
)

function freshDb() {
  const db = {
    moneyLedger: [],
    financeMoves: [],
    posSales: [],
    posShifts: [],
    opRefs: [],
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
      debt: 100,
      bonus: 0,
      wallet: 0,
      debtEnabled: true,
      debtLedger: [{
        id: 'DL-TARGET-1',
        amount: 100,
        remaining: 100,
        createdAtIso: new Date().toISOString(),
        source: 'pos',
        desc: 'seed',
      }],
    }],
    cards: [{
      num: 'VIP001',
      client: 'Иван',
      phone: '996700000001',
      debt: 100,
      bonus: 0,
      wallet: 0,
      debtEnabled: true,
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
    _seq: { sale: 0, order: 4800 },
  }
  ensurePosCollections(db)
  db.posShifts.push({
    id: 'SH-1',
    posId: 'POS-1',
    status: 'open',
    cashierId: 'CASH-1',
    cashierName: 'Кассир',
    openingCash: 500,
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

/** Minimal in-memory opRef gate mirroring index.js D4 helpers */
function makeOpGate(db) {
  function findOpRefRow(kind, clientRef) {
    const ref = String(clientRef || '').trim()
    if (!ref) return null
    return (db.opRefs || []).find(r => r.clientRef === ref && r.kind === kind) || null
  }
  function rememberOpRef(kind, clientRef, result, fingerprint = null) {
    const ref = String(clientRef || '').trim()
    if (!ref) return
    if (!Array.isArray(db.opRefs)) db.opRefs = []
    const idx = db.opRefs.findIndex(r => r.clientRef === ref && r.kind === kind)
    const row = {
      id: debtOpRefDocId(kind, ref),
      clientRef: ref,
      kind,
      result,
      fingerprint: fingerprint || (idx >= 0 ? db.opRefs[idx].fingerprint : null) || null,
      createdAtIso: new Date().toISOString(),
    }
    if (idx >= 0) db.opRefs[idx] = row
    else db.opRefs.push(row)
  }
  function replayOrConflict(kind, clientRef, fingerprint) {
    const row = findOpRefRow(kind, clientRef)
    if (!row) return null
    if (row.result && row.result.status === 'applying') {
      const check = checkIdempotencyReplay(row.fingerprint, fingerprint)
      if (!check.ok) return { status: 409, body: check }
      return null
    }
    const check = checkIdempotencyReplay(row.fingerprint, fingerprint)
    if (!check.ok) return { status: 409, body: { ...check, clientRef, kind } }
    return {
      status: 200,
      body: { ...row.result, clientRef, replayed: true, duplicate: true },
    }
  }
  return { findOpRefRow, rememberOpRef, replayOrConflict }
}

function saleBody(overrides = {}) {
  return {
    clientRef: 'sale-ref-1',
    items: [{ productId: 101, qty: 1, price: 50 }],
    paymentMethod: 'credit',
    debtAdded: 50,
    total: 50,
    shiftId: 'SH-1',
    posId: 'POS-1',
    cashierId: 'CASH-1',
    clientId: 'CL-1',
    cardNum: 'VIP001',
    clientPhone: '996700000001',
    clientName: 'Иван',
    ...overrides,
  }
}

function runSaleOnce(db, body) {
  const gate = makeOpGate(db)
  const clientRef = String(body.clientRef || '').trim()
  const debtAddedEarly = Math.round((Number(body.debtAdded) || 0) * 100) / 100
  if (debtAddedEarly > 0.001 && !clientRef) {
    return { status: 400, body: { code: CLIENT_REF_REQUIRED } }
  }
  const saleFp = buildDebtOpFingerprint('pos_sale', {
    amount: body.total,
    debtAdded: debtAddedEarly,
    clientId: body.clientId,
    cardNum: body.cardNum,
    method: body.paymentMethod,
    shiftId: body.shiftId,
  })
  if (clientRef) {
    const early = gate.replayOrConflict('pos_sale', clientRef, saleFp)
    if (early) return early
    const dup = (db.posSales || []).find(s => s.clientRef === clientRef)
    if (dup) {
      const dupFp = fingerprintFromPosSale(dup)
      const check = checkIdempotencyReplay(dupFp, saleFp)
      if (!check.ok) return { status: 409, body: { ...check, clientRef } }
      gate.rememberOpRef('pos_sale', clientRef, { id: dup.id, orderId: dup.orderId }, saleFp)
      return { status: 200, body: { ...dup, replayed: true, duplicate: true, clientRef } }
    }
  }
  const row = createPosSale(db, body)
  const saleReplay = !!row._idempotentReplay
  if (saleReplay) delete row._idempotentReplay
  if (clientRef) gate.rememberOpRef('pos_sale', clientRef, { id: row.id, orderId: row.orderId }, saleFp)
  return { status: 200, body: { ...row, replayed: !!saleReplay, duplicate: !!saleReplay, clientRef } }
}

function runCaOnce(db, body) {
  const gate = makeOpGate(db)
  const refGate = requireClientRef(body.clientRef)
  if (!refGate.ok) return { status: refGate.status, body: refGate }
  const clientRef = refGate.clientRef
  const amount = Math.round((Number(body.amount) || 0) * 100) / 100
  const card = db.cards.find(c => c.num === 'VIP001')
  const linkedClient = db.clients.find(c => c.id === 'CL-1')
  const fp = buildDebtOpFingerprint('cash_advance', {
    amount,
    method: 'cash',
    clientId: linkedClient.id,
    cardNum: 'VIP001',
    shiftId: body.shiftId || 'SH-1',
  })
  const early = gate.replayOrConflict('cash_advance', clientRef, fp)
  if (early) return early
  const knownLedger = (db.moneyLedger || []).find(r =>
    String(r.refType || '') === 'cash_advance'
    && (String(r.clientRef || '') === clientRef || String(r.meta?.clientRef || '') === clientRef),
  )
  if (knownLedger) {
    const ledFp = fingerprintFromMoneyLedgerCashAdvance(knownLedger)
    const check = checkIdempotencyReplay(ledFp, fp)
    if (!check.ok) return { status: 409, body: { ...check, clientRef } }
    const result = {
      amount: Number(knownLedger.amount) || 0,
      debtLedgerEntryId: knownLedger.meta?.debtLedgerEntryId || null,
      replayed: true,
      duplicate: true,
      clientRef,
    }
    gate.rememberOpRef('cash_advance', clientRef, result, fp)
    return { status: 200, body: result }
  }
  gate.rememberOpRef('cash_advance', clientRef, { status: 'applying', clientRef }, fp)
  const outcome = createCashAdvance(db, {
    card,
    linkedClient,
    clientRef,
    amount,
    shiftId: body.shiftId || 'SH-1',
    posId: 'POS-1',
    cashierId: 'CASH-1',
    cardNum: 'VIP001',
  })
  if (!outcome.ok) {
    return { status: outcome.status || 400, body: outcome }
  }
  gate.rememberOpRef('cash_advance', clientRef, { ...outcome.result, clientRef }, fp)
  return {
    status: 200,
    body: {
      ...outcome.result,
      clientRef,
      replayed: !!outcome.result.replay,
      duplicate: !!outcome.result.replay,
    },
  }
}

function runRepayOnce(db, body) {
  const gate = makeOpGate(db)
  const refGate = requireClientRef(body.clientRef)
  if (!refGate.ok) return { status: refGate.status, body: refGate }
  const clientRef = refGate.clientRef
  const amount = Math.round((Number(body.amount) || 0) * 100) / 100
  const method = String(body.method || 'cash').toLowerCase() === 'card' ? 'card' : 'cash'
  const orderId = String(body.orderId || '').trim() || undefined
  const card = db.cards.find(c => c.num === 'VIP001')
  const linkedClient = db.clients.find(c => c.id === 'CL-1')
  const fp = buildDebtOpFingerprint('debt_repay', {
    amount,
    method,
    clientId: linkedClient.id,
    cardNum: 'VIP001',
    orderId,
    shiftId: body.shiftId || 'SH-1',
  })
  const early = gate.replayOrConflict('debt_repay', clientRef, fp)
  if (early) return early
  const knownLedger = (db.moneyLedger || []).find(r =>
    String(r.refType || '') === 'debt_repay'
    && (String(r.clientRef || '') === clientRef || String(r.meta?.clientRef || '') === clientRef),
  )
  if (knownLedger) {
    const ledFp = fingerprintFromMoneyLedgerDebtRepay(knownLedger)
    const check = checkIdempotencyReplay(ledFp, fp)
    if (!check.ok) return { status: 409, body: { ...check, clientRef } }
    const result = {
      amount: Number(knownLedger.amount) || 0,
      replayed: true,
      duplicate: true,
      clientRef,
      till: { replay: true, amount: Number(knownLedger.amount) || 0 },
    }
    gate.rememberOpRef('debt_repay', clientRef, result, fp)
    return { status: 200, body: result }
  }
  if (!(amount > 0)) return { status: 400, body: { detail: 'amount' } }
  const prevDebt = Math.max(Number(card.debt) || 0, Number(linkedClient.debt) || 0)
  const nextDebt = Math.round(Math.max(0, prevDebt - amount) * 100) / 100
  const repaidTowardDebt = Math.round(Math.max(0, prevDebt - nextDebt) * 100) / 100
  if (orderId && linkedClient) {
    const target = resolveDebtRepaymentTarget(linkedClient, orderId, amount)
    if (target && Math.round((Number(target.remaining) || 0) * 100) / 100 <= 0.001) {
      return {
        status: 400,
        body: { code: 'DEBT_RECEIPT_ALREADY_PAID', detail: `Чек долга уже погашен (${orderId})` },
      }
    }
  }
  if (amount > prevDebt + 0.001) {
    return { status: 400, body: { detail: `Долг клиента ${prevDebt}` } }
  }
  gate.rememberOpRef('debt_repay', clientRef, { status: 'applying', clientRef }, fp)
  try {
    handleClientDebtDelta(db, linkedClient, card, prevDebt, nextDebt, {
      enforceLimit: false,
      source: 'pos',
      orderId,
      desc: 'Погашение долга наличными',
    })
  } catch (e) {
    const idx = db.opRefs.findIndex(r => r.clientRef === clientRef && r.kind === 'debt_repay')
    if (idx >= 0 && db.opRefs[idx]?.result?.status === 'applying') db.opRefs.splice(idx, 1)
    return { status: e.status || 400, body: { code: e.code, detail: e.message } }
  }
  linkedClient.debt = nextDebt
  card.debt = nextDebt
  card.debtPayVersion = (Number(card.debtPayVersion) || 0) + 1
  const till = applyDebtRepayToShift(db, {
    amount: repaidTowardDebt,
    method,
    shiftId: body.shiftId || 'SH-1',
    posId: 'POS-1',
    cashierId: 'CASH-1',
    cardNum: 'VIP001',
    clientRef,
    orderId,
    clientId: linkedClient.id,
  })
  const result = {
    amount,
    method,
    prevDebt,
    nextDebt,
    till,
    clientRef,
    debtPayVersion: card.debtPayVersion,
  }
  gate.rememberOpRef('debt_repay', clientRef, result, fp)
  return { status: 200, body: result }
}

// —— Fingerprint / policy unit ——
await test('fingerprint equal vs collision', () => {
  const a = buildDebtOpFingerprint('debt_repay', { amount: 20, method: 'cash', clientId: 'CL-1', cardNum: 'VIP001', orderId: 'DL-1', shiftId: 'SH-1' })
  const b = buildDebtOpFingerprint('debt_repay', { amount: 20, method: 'cash', clientId: 'CL-1', cardNum: 'VIP001', orderId: 'DL-1', shiftId: 'SH-1' })
  const c = buildDebtOpFingerprint('debt_repay', { amount: 50, method: 'cash', clientId: 'CL-1', cardNum: 'VIP001', orderId: 'DL-1', shiftId: 'SH-1' })
  expect(fingerprintsEqual(a, b), 'equal')
  const bad = checkIdempotencyReplay(a, c)
  expect(!bad.ok && bad.code === IDEMPOTENCY_KEY_REUSED, '409 collision')
})

await test('requireClientRef policy', () => {
  expect(requireClientRef('').code === CLIENT_REF_REQUIRED, 'empty')
  expect(requireClientRef('  x  ').ok && requireClientRef('  x  ').clientRef === 'x', 'trim')
})

await test('debtOpRefDocId deterministic', () => {
  expect(debtOpRefDocId('cash_advance', 'abc') === 'op:cash_advance:abc', 'id')
})

await test('known unique indexes catalog', () => {
  expect(!!IDEMPOTENCY_UNIQUE_INDEXES.uq_docs_possales_client_ref, 'posSales')
  expect(!!IDEMPOTENCY_UNIQUE_INDEXES.uq_docs_moneyledger_client_ref_type, 'moneyLedger')
  expect(!!IDEMPOTENCY_UNIQUE_INDEXES.uq_docs_financemoves_client_ref, 'financeMoves')
  expect(!!IDEMPOTENCY_UNIQUE_INDEXES.uq_docs_oprefs_kind_client_ref, 'opRefs')
  const fake = { code: '23505', constraint: 'uq_docs_moneyledger_client_ref_type' }
  expect(classifyUniqueViolation(fake).known === true, '23505 known')
})

// —— Credit sale ——
await test('1 credit sale first apply', () => {
  const db = freshDb()
  const remBefore = db.stockReceipts[0].items[0].remainingQty
  const r = runSaleOnce(db, saleBody())
  expect(r.status === 200, 'status')
  expect(db.posSales.length === 1, 'one sale')
  expect(db.stockReceipts[0].items[0].remainingQty === remBefore - 1, 'stock once')
  expect(Number(db.cards[0].debt) === 150, `debt=${db.cards[0].debt}`)
  expect(db.posShifts[0].salesCredit === 50, 'shift credit')
})

await test('2 identical credit sale replay', () => {
  const db = freshDb()
  const a = runSaleOnce(db, saleBody())
  const b = runSaleOnce(db, saleBody())
  expect(a.status === 200 && b.status === 200, 'ok')
  expect(b.body.replayed || b.body.duplicate, 'replay flag')
  expect(db.posSales.length === 1, 'one sale')
  expect(Number(db.cards[0].debt) === 150, 'debt once')
})

await test('3 concurrent duplicate credit sale', () => {
  const db = freshDb()
  // Sequential claim simulation (Node single-thread): first apply, second replay
  const a = runSaleOnce(db, saleBody({ clientRef: 'conc-sale' }))
  const b = runSaleOnce(db, saleBody({ clientRef: 'conc-sale' }))
  expect(a.status === 200 && b.status === 200, 'both ok')
  expect(db.posSales.length === 1, 'one')
  expect(!(b.body.replayed === false && a.body.id !== b.body.id), 'no second writer')
})

await test('4 same clientRef different credit sale payload => 409', () => {
  const db = freshDb()
  runSaleOnce(db, saleBody({ clientRef: 'sale-col', debtAdded: 50, total: 50 }))
  const bad = runSaleOnce(db, saleBody({ clientRef: 'sale-col', debtAdded: 80, total: 80 }))
  expect(bad.status === 409 && bad.body.code === IDEMPOTENCY_KEY_REUSED, '409')
  expect(db.posSales.length === 1, 'still one')
})

// —— Cash advance ——
await test('5 CA first apply', () => {
  const db = freshDb()
  const r = runCaOnce(db, { clientRef: 'ca-1', amount: 30, shiftId: 'SH-1' })
  expect(r.status === 200, `status ${r.status} ${JSON.stringify(r.body)}`)
  expect(r.body.debtLedgerEntryId, 'DL id')
  expect(Number(db.cards[0].debt) === 130, 'debt+30')
  expect((db.moneyLedger || []).filter(x => x.refType === 'cash_advance').length === 1, 'ledger1')
})

await test('6 identical CA replay', () => {
  const db = freshDb()
  const a = runCaOnce(db, { clientRef: 'ca-2', amount: 25, shiftId: 'SH-1' })
  const b = runCaOnce(db, { clientRef: 'ca-2', amount: 25, shiftId: 'SH-1' })
  expect(a.status === 200 && b.status === 200, 'ok')
  expect(b.body.replayed || b.body.duplicate, 'replay')
  expect(Number(db.cards[0].debt) === 125, 'debt once')
  expect((db.moneyLedger || []).filter(x => x.refType === 'cash_advance').length === 1, 'ml once')
})

await test('7 concurrent duplicate CA', () => {
  const db = freshDb()
  const a = runCaOnce(db, { clientRef: 'ca-conc', amount: 10, shiftId: 'SH-1' })
  const b = runCaOnce(db, { clientRef: 'ca-conc', amount: 10, shiftId: 'SH-1' })
  expect(a.status === 200 && b.status === 200, 'ok')
  expect((db.moneyLedger || []).filter(x => x.refType === 'cash_advance').length === 1, 'one ml')
})

await test('8 ACK lost CA replay returns same DL id', () => {
  const db = freshDb()
  const a = runCaOnce(db, { clientRef: 'ca-ack', amount: 40, shiftId: 'SH-1' })
  // Simulate ACK loss: drop in-memory opRef only; moneyLedger remains
  db.opRefs = []
  const b = runCaOnce(db, { clientRef: 'ca-ack', amount: 40, shiftId: 'SH-1' })
  expect(b.status === 200, 'replay ok')
  expect(String(b.body.debtLedgerEntryId) === String(a.body.debtLedgerEntryId), 'same DL')
  expect(Number(db.cards[0].debt) === 140, 'debt once')
})

await test('9 same clientRef different CA amount => 409', () => {
  const db = freshDb()
  runCaOnce(db, { clientRef: 'ca-col', amount: 15, shiftId: 'SH-1' })
  const bad = runCaOnce(db, { clientRef: 'ca-col', amount: 99, shiftId: 'SH-1' })
  expect(bad.status === 409 && bad.body.code === IDEMPOTENCY_KEY_REUSED, '409')
})

// —— Debt repay ——
await test('10 repay first apply', () => {
  const db = freshDb()
  const r = runRepayOnce(db, { clientRef: 'rp-1', amount: 40, orderId: 'DL-TARGET-1', shiftId: 'SH-1' })
  expect(r.status === 200, `ok ${JSON.stringify(r.body)}`)
  expect(Number(db.cards[0].debt) === 60, 'debt')
  expect(db.cards[0].debtPayVersion === 1, 'ver')
  expect((db.moneyLedger || []).filter(x => x.refType === 'debt_repay').length === 1, 'ml')
  expect(Number(db.posShifts[0].salesCash) === 40, 'till')
})

await test('11 identical repay replay', () => {
  const db = freshDb()
  runRepayOnce(db, { clientRef: 'rp-2', amount: 20, orderId: 'DL-TARGET-1', shiftId: 'SH-1' })
  const b = runRepayOnce(db, { clientRef: 'rp-2', amount: 20, orderId: 'DL-TARGET-1', shiftId: 'SH-1' })
  expect(b.status === 200 && (b.body.replayed || b.body.duplicate), 'replay')
  expect(Number(db.cards[0].debt) === 80, 'debt once')
  expect(db.cards[0].debtPayVersion === 1, 'ver once')
  expect((db.moneyLedger || []).filter(x => x.refType === 'debt_repay').length === 1, 'ml once')
})

await test('12 concurrent duplicate repay', () => {
  const db = freshDb()
  const a = runRepayOnce(db, { clientRef: 'rp-c', amount: 10, orderId: 'DL-TARGET-1', shiftId: 'SH-1' })
  const b = runRepayOnce(db, { clientRef: 'rp-c', amount: 10, orderId: 'DL-TARGET-1', shiftId: 'SH-1' })
  expect(a.status === 200 && b.status === 200, 'ok')
  expect((db.moneyLedger || []).filter(x => x.refType === 'debt_repay').length === 1, 'one')
})

await test('13 ACK lost repay replay', () => {
  const db = freshDb()
  const a = runRepayOnce(db, { clientRef: 'rp-ack', amount: 15, orderId: 'DL-TARGET-1', shiftId: 'SH-1' })
  db.opRefs = []
  const b = runRepayOnce(db, { clientRef: 'rp-ack', amount: 15, orderId: 'DL-TARGET-1', shiftId: 'SH-1' })
  expect(b.status === 200 && (b.body.replayed || b.body.duplicate), 'ledger backstop')
  expect(Number(db.cards[0].debt) === 85, 'debt')
  expect(a.body.amount === b.body.amount, 'amount')
})

await test('14 API restart replay (opRef + ledgers durable in db snapshot)', () => {
  const db = freshDb()
  runSaleOnce(db, saleBody({ clientRef: 'restart-sale' }))
  runCaOnce(db, { clientRef: 'restart-ca', amount: 5, shiftId: 'SH-1' })
  runRepayOnce(db, { clientRef: 'restart-rp', amount: 5, orderId: 'DL-TARGET-1', shiftId: 'SH-1' })
  // "Restart" = new process with same durable collections (no in-memory-only map)
  const snap = JSON.parse(JSON.stringify({
    posSales: db.posSales,
    moneyLedger: db.moneyLedger,
    opRefs: db.opRefs,
    cards: db.cards,
    clients: db.clients,
    posShifts: db.posShifts,
    products: db.products,
    stockReceipts: db.stockReceipts,
    cashiers: db.cashiers,
    posPoints: db.posPoints,
    _seq: db._seq,
  }))
  const db2 = freshDb()
  Object.assign(db2, snap)
  ensurePosCollections(db2)
  const s = runSaleOnce(db2, saleBody({ clientRef: 'restart-sale' }))
  const c = runCaOnce(db2, { clientRef: 'restart-ca', amount: 5, shiftId: 'SH-1' })
  const r = runRepayOnce(db2, { clientRef: 'restart-rp', amount: 5, orderId: 'DL-TARGET-1', shiftId: 'SH-1' })
  expect(s.body.replayed || s.body.duplicate, 'sale replay')
  expect(c.body.replayed || c.body.duplicate, 'ca replay')
  expect(r.body.replayed || r.body.duplicate, 'rp replay')
  expect(db2.posSales.filter(x => x.clientRef === 'restart-sale').length === 1, 'sale1')
  expect(db2.moneyLedger.filter(x => x.clientRef === 'restart-ca').length === 1, 'ca1')
  expect(db2.moneyLedger.filter(x => x.clientRef === 'restart-rp').length === 1, 'rp1')
})

await test('15 same clientRef different repay amount => 409', () => {
  const db = freshDb()
  runRepayOnce(db, { clientRef: 'rp-amt', amount: 10, orderId: 'DL-TARGET-1', shiftId: 'SH-1' })
  const bad = runRepayOnce(db, { clientRef: 'rp-amt', amount: 50, orderId: 'DL-TARGET-1', shiftId: 'SH-1' })
  expect(bad.status === 409 && bad.body.code === IDEMPOTENCY_KEY_REUSED, '409')
})

await test('16 same clientRef different target receipt => 409', () => {
  const db = freshDb()
  // seed second receipt
  db.clients[0].debtLedger.push({
    id: 'DL-TARGET-2',
    amount: 50,
    remaining: 50,
    createdAtIso: new Date().toISOString(),
    source: 'pos',
  })
  db.clients[0].debt = 150
  db.cards[0].debt = 150
  runRepayOnce(db, { clientRef: 'rp-tgt', amount: 10, orderId: 'DL-TARGET-1', shiftId: 'SH-1' })
  const bad = runRepayOnce(db, { clientRef: 'rp-tgt', amount: 10, orderId: 'DL-TARGET-2', shiftId: 'SH-1' })
  expect(bad.status === 409 && bad.body.code === IDEMPOTENCY_KEY_REUSED, '409')
})

await test('17 same clientRef replay after target fully paid => success replay', () => {
  const db = freshDb()
  const a = runRepayOnce(db, { clientRef: 'rp-paid', amount: 100, orderId: 'DL-TARGET-1', shiftId: 'SH-1' })
  expect(a.status === 200, 'first')
  expect(Number(db.clients[0].debtLedger.find(e => e.id === 'DL-TARGET-1').remaining) === 0, 'paid')
  const b = runRepayOnce(db, { clientRef: 'rp-paid', amount: 100, orderId: 'DL-TARGET-1', shiftId: 'SH-1' })
  expect(b.status === 200 && (b.body.replayed || b.body.duplicate), 'replay success not ALREADY_PAID')
  expect(db.cards[0].debtPayVersion === 1, 'ver once')
})

await test('18 different clientRef against already-paid target => business reject', () => {
  const db = freshDb()
  runRepayOnce(db, { clientRef: 'rp-first', amount: 100, orderId: 'DL-TARGET-1', shiftId: 'SH-1' })
  const bad = runRepayOnce(db, { clientRef: 'rp-other', amount: 10, orderId: 'DL-TARGET-1', shiftId: 'SH-1' })
  expect(bad.status === 400 && bad.body.code === 'DEBT_RECEIPT_ALREADY_PAID', `got ${JSON.stringify(bad.body)}`)
})

await test('19 no duplicate moneyLedger (CA+repay)', () => {
  const db = freshDb()
  runCaOnce(db, { clientRef: 'ml-ca', amount: 7, shiftId: 'SH-1' })
  runCaOnce(db, { clientRef: 'ml-ca', amount: 7, shiftId: 'SH-1' })
  runRepayOnce(db, { clientRef: 'ml-rp', amount: 7, orderId: 'DL-TARGET-1', shiftId: 'SH-1' })
  runRepayOnce(db, { clientRef: 'ml-rp', amount: 7, orderId: 'DL-TARGET-1', shiftId: 'SH-1' })
  expect(db.moneyLedger.filter(x => x.clientRef === 'ml-ca').length === 1, 'ca ml')
  expect(db.moneyLedger.filter(x => x.clientRef === 'ml-rp').length === 1, 'rp ml')
})

await test('20 no duplicate debtLedger effect (CA clientRef)', () => {
  const db = freshDb()
  const a = runCaOnce(db, { clientRef: 'dl-ca', amount: 12, shiftId: 'SH-1' })
  runCaOnce(db, { clientRef: 'dl-ca', amount: 12, shiftId: 'SH-1' })
  const charges = (db.clients[0].debtLedger || []).filter(e => String(e.clientRef || '') === 'dl-ca')
  expect(charges.length === 1, `charges=${charges.length}`)
  expect(String(a.body.debtLedgerEntryId) === String(charges[0].id), 'same id')
})

await test('21 debtPayVersion increments once', () => {
  const db = freshDb()
  runRepayOnce(db, { clientRef: 'ver-1', amount: 5, orderId: 'DL-TARGET-1', shiftId: 'SH-1' })
  runRepayOnce(db, { clientRef: 'ver-1', amount: 5, orderId: 'DL-TARGET-1', shiftId: 'SH-1' })
  expect(db.cards[0].debtPayVersion === 1, 'once')
})

await test('22 shift/till effect once', () => {
  const db = freshDb()
  runRepayOnce(db, { clientRef: 'till-1', amount: 8, orderId: 'DL-TARGET-1', shiftId: 'SH-1' })
  runRepayOnce(db, { clientRef: 'till-1', amount: 8, orderId: 'DL-TARGET-1', shiftId: 'SH-1' })
  expect(Number(db.posShifts[0].salesCash) === 8, `salesCash=${db.posShifts[0].salesCash}`)
})

await test('23 duplicate path never applies stock twice for sale', () => {
  const db = freshDb()
  const before = db.stockReceipts[0].items[0].remainingQty
  runSaleOnce(db, saleBody({ clientRef: 'stk-1' }))
  runSaleOnce(db, saleBody({ clientRef: 'stk-1' }))
  expect(db.stockReceipts[0].items[0].remainingQty === before - 1, 'stock')
})

await test('24 missing clientRef policy', () => {
  const db = freshDb()
  const sale = runSaleOnce(db, saleBody({ clientRef: '' }))
  expect(sale.status === 400 && sale.body.code === CLIENT_REF_REQUIRED, 'credit sale')
  const ca = runCaOnce(db, { amount: 1, shiftId: 'SH-1' })
  expect(ca.status === 400 && ca.body.code === CLIENT_REF_REQUIRED, 'ca')
  const rp = runRepayOnce(db, { amount: 1, orderId: 'DL-TARGET-1', shiftId: 'SH-1' })
  expect(rp.status === 400 && rp.body.code === CLIENT_REF_REQUIRED, 'rp')
  // Legacy non-credit online sale may omit clientRef
  const cash = runSaleOnce(db, saleBody({
    clientRef: '',
    paymentMethod: 'cash',
    debtAdded: 0,
    total: 50,
    paidCash: 50,
  }))
  expect(cash.status === 200, 'cash without clientRef allowed in helper when debtAdded=0')
})

await test('source wiring: routes + flush + fingerprint', () => {
  const idx = fs.readFileSync(path.join(apiRoot, 'index.js'), 'utf8')
  expect(/debtOpIdempotency\.js/.test(idx), 'import')
  expect(/IDEMPOTENCY_KEY_REUSED/.test(idx), 'code')
  expect(/CLIENT_REF_REQUIRED/.test(idx), 'ref required')
  expect((idx.match(/app\.post\('\/cards\/:num\/debt-repay'/g) || []).length === 1, 'one repay route')
  expect((idx.match(/app\.post\('\/cards\/:num\/cash-advance'/g) || []).length === 1, 'one ca route')
  expect(/await flushDbAsync\(\)/.test(idx), 'flush')
  expect(/buildDebtOpFingerprint\('cash_advance'/.test(idx), 'ca fp')
  expect(/buildDebtOpFingerprint\('debt_repay'/.test(idx), 'rp fp')
  expect(/buildDebtOpFingerprint\('pos_sale'/.test(idx), 'sale fp')
})

await test('addDebtCharge clientRef backstop', () => {
  const client = { id: 'C', debt: 0, debtLedger: [] }
  const card = { num: 'X', debt: 0 }
  const a = addDebtCharge(client, card, { amount: 10, source: 'cash_advance', clientRef: 'chg-1' })
  const b = addDebtCharge(client, card, { amount: 10, source: 'cash_advance', clientRef: 'chg-1' })
  expect(a.entry.id === b.entry.id && b.replay === true, 'replay')
  expect(client.debtLedger.filter(e => e.clientRef === 'chg-1').length === 1, 'one')
})

// Drain async tests
await new Promise(r => setTimeout(r, 0))

const failed = results.filter(r => r.status === 'FAIL')
const report = {
  phase: 'D4',
  passed: results.filter(r => r.status === 'PASS').length,
  failed: failed.length,
  total: results.length,
  results,
}
fs.writeFileSync(
  path.join(root, 'scripts', 'debt-server-idempotency-d4-report.json'),
  JSON.stringify(report, null, 2),
)
console.log(`\nD4: ${report.passed}/${report.total} passed`)
if (failed.length) process.exit(1)
