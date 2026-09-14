/**
 * Phase D2 — Atomic local credit sale + debt projection.
 * Pure SQLite-txn simulator (mirrors desktop/localDb.cjs sqlSaleCommit) + source wiring.
 * Run: node scripts/debt-credit-sale-atomic-test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  toDebtOperationFromSale,
  validateDebtOperation,
  round2,
  moneyToCents,
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
const atomicSrc = fs.readFileSync(path.join(root, 'lib', 'localSaleAtomic.ts'), 'utf8')

// ── Source wiring ──
test('W1 sqlSaleCommit writes client+card debt inside same txn', () => {
  expect(localDbSrc.includes('Phase D2'), 'D2 comment')
  expect(localDbSrc.includes("sqlEntityPut('card'"), 'card entity')
  expect(localDbSrc.includes("sqlEntityPut('client'"), 'client entity')
  expect(localDbSrc.includes("sqlUpsertKvArrayRow('data_clients'"), 'data_clients')
  expect(localDbSrc.includes("sqlUpsertKvArrayRow('data_cards'"), 'data_cards')
  expect(localDbSrc.includes("sqlUpsertKvArrayRow('catalog_clients'"), 'catalog_clients')
})

test('W2 createSaleSafe builds creditClientRow/creditCardRow before commit', () => {
  expect(opsSrc.includes('creditClientRow'), 'client row')
  expect(opsSrc.includes('creditCardRow'), 'card row')
  expect(opsSrc.includes('debtAdded > 0.001'), 'gated on debtAdded')
  const commitIdx = opsSrc.indexOf('commitLocalSaleAtomic({')
  const clientPass = opsSrc.indexOf('client: creditClientRow', commitIdx)
  expect(clientPass > commitIdx && clientPass < commitIdx + 400, 'pass client into commit')
})

test('W3 post-commit uses absolute nextDebt (no second +debtAdded)', () => {
  const block = opsSrc.slice(
    opsSrc.indexOf('// Absolute hydrate from committed projection'),
    opsSrc.indexOf('if (walletPaid > 0.001)', opsSrc.indexOf('// Absolute hydrate from committed projection')),
  )
  expect(block.includes('debt: nextDebt'), 'absolute nextDebt')
  expect(!block.includes('debt: nextDebt +') && !block.includes('+ debtAdded'), 'no additive')
})

test('W4 queue kind remains sale; no new network fields required', () => {
  expect(opsSrc.includes("kind: 'sale'"), 'kind=sale')
  expect(!opsSrc.includes("kind: 'sale_on_credit'"), 'no new kind')
})

test('W5 no API call before Desktop commit', () => {
  const atomicBlock = opsSrc.slice(
    opsSrc.indexOf('// ── Phase 5 Desktop'),
    opsSrc.indexOf('// ── Fallback: Android'),
  )
  expect(!atomicBlock.includes('await api.'), 'no await api in Desktop atomic block')
  expect(atomicSrc.includes('Does NOT touch Zustand'), 'atomic module isolation')
})

// ── Sim DB ──
function openSimDb(seed = {}) {
  return {
    queue: new Map(),
    kv: new Map(Object.entries(seed.kv || {})),
    mirror: new Map(),
    entities: new Map(Object.entries(seed.entities || {})),
  }
}

function cloneDb(db) {
  return {
    queue: new Map(db.queue),
    kv: new Map([...db.kv.entries()].map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])),
    mirror: new Map([...db.mirror.entries()].map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])),
    entities: new Map([...db.entities.entries()].map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])),
  }
}

function upsertKvArray(scratch, key, idField, idValue, row) {
  const id = String(idValue || '')
  const cur = scratch.kv.get(key)
  if (!Array.isArray(cur)) return
  const next = cur.slice()
  const idx = next.findIndex(x => String(x?.[idField] || '') === id)
  if (idx >= 0) next[idx] = { ...next[idx], ...row, [idField]: next[idx][idField] }
  else next.push(row)
  scratch.kv.set(key, next)
}

function sqlSaleCommitSim(db, payload, failAt) {
  const p = payload || {}
  const stage = String(failAt || '').trim()
  if (stage === 'before') throw Object.assign(new Error('TEST_FAIL_BEFORE'), { code: 'TEST_FAIL_BEFORE' })
  const queueRow = p.queueRow
  if (!queueRow?.clientRef) return { ok: false, error: 'missing_queue_row' }

  const scratch = cloneDb(db)
  const run = () => {
    scratch.queue.set(queueRow.clientRef, JSON.parse(JSON.stringify(queueRow)))
    if (stage === 'after_queue') throw Object.assign(new Error('TEST_FAIL_AFTER_QUEUE'), { code: 'TEST_FAIL_AFTER_QUEUE' })

    if (Object.prototype.hasOwnProperty.call(p, 'stockLayers')) {
      scratch.kv.set('catalog_stock_layers', JSON.parse(JSON.stringify(p.stockLayers)))
    }
    if (stage === 'after_layers') throw Object.assign(new Error('TEST_FAIL_AFTER_LAYERS'), { code: 'TEST_FAIL_AFTER_LAYERS' })

    if (p.sale) scratch.mirror.set(`sale:${p.sale.id}`, JSON.parse(JSON.stringify(p.sale)))
    if (stage === 'after_sale') throw Object.assign(new Error('TEST_FAIL_AFTER_SALE'), { code: 'TEST_FAIL_AFTER_SALE' })

    if (p.shift) scratch.mirror.set(`shift:${p.shift.id}`, JSON.parse(JSON.stringify(p.shift)))
    if (stage === 'after_shift') throw Object.assign(new Error('TEST_FAIL_AFTER_SHIFT'), { code: 'TEST_FAIL_AFTER_SHIFT' })

    if (p.card?.num) {
      scratch.entities.set(`card:${p.card.num}`, JSON.parse(JSON.stringify(p.card)))
      upsertKvArray(scratch, 'data_cards', 'num', p.card.num, p.card)
    }
    if (stage === 'after_card') throw Object.assign(new Error('TEST_FAIL_AFTER_CARD'), { code: 'TEST_FAIL_AFTER_CARD' })

    if (p.client?.id) {
      scratch.entities.set(`client:${p.client.id}`, JSON.parse(JSON.stringify(p.client)))
      upsertKvArray(scratch, 'catalog_clients', 'id', p.client.id, p.client)
      upsertKvArray(scratch, 'data_clients', 'id', p.client.id, p.client)
    }
    if (stage === 'after_client') throw Object.assign(new Error('TEST_FAIL_AFTER_CLIENT'), { code: 'TEST_FAIL_AFTER_CLIENT' })

    if (p.queueSeq != null) scratch.kv.set('queue_seq', p.queueSeq)
    if (stage === 'before_commit') throw Object.assign(new Error('TEST_FAIL_BEFORE_COMMIT'), { code: 'TEST_FAIL_BEFORE_COMMIT' })
  }
  try {
    run()
  } catch (e) {
    throw e // ROLLBACK: discard scratch
  }
  db.queue = scratch.queue
  db.kv = scratch.kv
  db.mirror = scratch.mirror
  db.entities = scratch.entities
  return { ok: true, clientRef: queueRow.clientRef }
}

function creditPayload(opts = {}) {
  const debtAdded = opts.debtAdded != null ? opts.debtAdded : 50
  const prevDebt = opts.prevDebt != null ? opts.prevDebt : 100
  const nextDebt = round2(prevDebt + debtAdded)
  const clientRef = opts.clientRef || 'cref-credit-1'
  const clientId = opts.clientId || 'U-01'
  const cardNum = opts.cardNum || 'КАКАПО-0001'
  const debtPayVersion = opts.debtPayVersion != null ? opts.debtPayVersion : 3
  return {
    queueRow: {
      clientRef,
      kind: 'sale',
      localId: opts.localId || 'off-sale-1',
      seq: opts.seq || 1,
      payload: {
        clientRef,
        debtAdded,
        clientId,
        cardNum,
        clientDebtAfter: nextDebt,
        expectedDebtPayVersion: debtPayVersion,
        appliedLocal: true,
        skipBalances: true,
        total: debtAdded,
      },
      createdAtIso: '2026-09-14T15:00:00.000Z',
      attempts: 0,
    },
    stockLayers: [{ receiptId: 'r1', productId: 1, remainingQty: 9 }],
    sale: {
      id: opts.localId || 'off-sale-1',
      clientRef,
      shiftId: 'sh1',
      total: debtAdded,
      debtAdded,
      number: 1,
    },
    shift: { id: 'sh1', salesCredit: debtAdded, salesCount: 1, salesCash: 0, salesCard: 0 },
    client: {
      id: clientId,
      name: 'Sayod',
      card: cardNum,
      debt: nextDebt,
      debtEnabled: true,
      phone: '+992501903141',
    },
    card: {
      num: cardNum,
      clientId,
      debt: nextDebt,
      debtEnabled: true,
      debtPayVersion: debtPayVersion + 1,
    },
    _meta: { prevDebt, nextDebt, debtAdded, debtPayVersion },
  }
}

function seedCrm(prevDebt = 100) {
  return {
    kv: {
      catalog_clients: [{ id: 'U-01', name: 'Sayod', card: 'КАКАПО-0001', debt: prevDebt, phone: '+992501903141' }],
      data_clients: [{ id: 'U-01', name: 'Sayod', card: 'КАКАПО-0001', debt: prevDebt, phone: '+992501903141' }],
      data_cards: [{ num: 'КАКАПО-0001', clientId: 'U-01', debt: prevDebt, debtPayVersion: 3 }],
    },
  }
}

// 1) normal credit sale
test('1) normal credit sale: sale+queue+client+card debt +D', () => {
  const db = openSimDb(seedCrm(100))
  const p = creditPayload({ prevDebt: 100, debtAdded: 50 })
  const res = sqlSaleCommitSim(db, p, '')
  expect(res.ok, 'commit ok')
  expect(db.queue.has('cref-credit-1'), 'queue')
  expect(db.mirror.has('sale:off-sale-1'), 'sale')
  expect(db.entities.get('client:U-01').debt === 150, `client debt=${db.entities.get('client:U-01').debt}`)
  expect(db.entities.get('card:КАКАПО-0001').debt === 150, 'card debt')
  expect(db.kv.get('data_clients').find(c => c.id === 'U-01').debt === 150, 'data_clients')
  expect(db.kv.get('data_cards').find(c => c.num === 'КАКАПО-0001').debt === 150, 'data_cards')
})

// 2) non-credit sale — no debt rows
test('2) cash/card non-credit sale: debt unchanged', () => {
  const db = openSimDb(seedCrm(100))
  const p = creditPayload({ debtAdded: 0, prevDebt: 100 })
  delete p.client
  delete p.card
  p.queueRow.payload.debtAdded = 0
  p.sale.debtAdded = 0
  p.sale.total = 40
  p.shift.salesCash = 40
  p.shift.salesCredit = 0
  sqlSaleCommitSim(db, p, '')
  expect(db.queue.has('cref-credit-1'), 'queue exists')
  expect(!db.entities.has('client:U-01'), 'no client entity write')
  expect(db.kv.get('data_clients').find(c => c.id === 'U-01').debt === 100, 'debt unchanged')
})

// 3–6) failure rollback
for (const [label, stage] of [
  ['3) fail BEFORE debt update (after_shift)', 'after_shift'],
  ['4) fail DURING client update (after_client)', 'after_client'],
  ['5) fail DURING card update (after_card)', 'after_card'],
  ['6) fail AFTER projections before COMMIT', 'before_commit'],
]) {
  test(label, () => {
    const db = openSimDb(seedCrm(100))
    const beforeQ = db.queue.size
    const beforeDebt = db.kv.get('data_clients')[0].debt
    let threw = false
    try {
      sqlSaleCommitSim(db, creditPayload({ prevDebt: 100, debtAdded: 50 }), stage)
    } catch {
      threw = true
    }
    expect(threw, 'must throw')
    expect(db.queue.size === beforeQ, 'queue rolled back')
    expect(db.mirror.size === 0, 'sale rolled back')
    expect(db.entities.size === 0, 'entities rolled back')
    expect(db.kv.get('data_clients')[0].debt === beforeDebt, 'debt rolled back')
  })
}

// 7) restart simulation
test('7) restart after commit: reload KV/entities shows correct debt', () => {
  const db = openSimDb(seedCrm(100))
  sqlSaleCommitSim(db, creditPayload({ prevDebt: 100, debtAdded: 50 }), '')
  // simulate process restart: only durable maps survive
  const reloaded = {
    queue: new Map(db.queue),
    kv: new Map([...db.kv.entries()].map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])),
    mirror: new Map([...db.mirror.entries()].map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])),
    entities: new Map([...db.entities.entries()].map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])),
  }
  expect(reloaded.kv.get('data_clients').find(c => c.id === 'U-01').debt === 150, 'hydrate data_clients')
  expect(reloaded.entities.get('client:U-01').debt === 150, 'entity client')
  expect(reloaded.entities.get('card:КАКАПО-0001').debt === 150, 'entity card')
  expect(reloaded.queue.has('cref-credit-1'), 'outbox survives')
})

// 8) duplicate clientRef
test('8) duplicate same clientRef: debt applied once', () => {
  const db = openSimDb(seedCrm(100))
  const p = creditPayload({ clientRef: 'cref-dup', prevDebt: 100, debtAdded: 50 })
  sqlSaleCommitSim(db, p, '')
  // second commit with same clientRef overwrites queue row (ON CONFLICT) but must NOT +50 again
  // Caller must pass absolute nextDebt=150 again (idempotent absolute projection)
  const p2 = creditPayload({
    clientRef: 'cref-dup',
    prevDebt: 100,
    debtAdded: 50,
    localId: 'off-sale-1',
  })
  // Simulate correct duplicate path: same absolute projections
  sqlSaleCommitSim(db, p2, '')
  expect(db.entities.get('client:U-01').debt === 150, 'still 150')
  expect(db.queue.size === 1, 'one queue row')
})

// 9) two different credit sales
test('9) two different credit sales: debt increments twice', () => {
  const db = openSimDb(seedCrm(100))
  sqlSaleCommitSim(db, creditPayload({ clientRef: 'a', localId: 's1', prevDebt: 100, debtAdded: 50 }), '')
  const after1 = db.entities.get('client:U-01').debt
  expect(after1 === 150, 'after1')
  sqlSaleCommitSim(db, creditPayload({
    clientRef: 'b',
    localId: 's2',
    prevDebt: 150,
    debtAdded: 25,
    debtPayVersion: 4,
  }), '')
  expect(db.entities.get('client:U-01').debt === 175, `got ${db.entities.get('client:U-01').debt}`)
  expect(db.queue.size === 2, 'two queue rows')
})

// 10) decimal 0.01
test('10) decimal: existing + 0.01 no float corruption', () => {
  const db = openSimDb(seedCrm(10.1))
  const p = creditPayload({ prevDebt: 10.1, debtAdded: 0.01 })
  sqlSaleCommitSim(db, p, '')
  expect(db.entities.get('client:U-01').debt === 10.11, `debt=${db.entities.get('client:U-01').debt}`)
  expect(moneyToCents(db.entities.get('client:U-01').debt) === 1011, 'cents')
})

// 11) identity protection
test('11) U-identity: client id / card num linkage preserved', () => {
  const db = openSimDb(seedCrm(100))
  const p = creditPayload({ clientId: 'U-01', cardNum: 'КАКАПО-0001', prevDebt: 100, debtAdded: 10 })
  sqlSaleCommitSim(db, p, '')
  const cl = db.entities.get('client:U-01')
  const card = db.entities.get('card:КАКАПО-0001')
  expect(cl.id === 'U-01', 'client id')
  expect(cl.card === 'КАКАПО-0001', 'client.card')
  expect(card.num === 'КАКАПО-0001', 'card.num')
  expect(card.clientId === 'U-01', 'card.clientId')
  expect(cl.phone === '+992501903141', 'phone preserved')
  expect(db.kv.get('data_clients').find(c => c.id === 'U-03') == null, 'no cross-adopt')
})

// 12) debtPayVersion semantics
test('12) debtPayVersion bumped +1 on credit (matches existing local/server)', () => {
  const db = openSimDb(seedCrm(100))
  const p = creditPayload({ debtPayVersion: 3, prevDebt: 100, debtAdded: 10 })
  sqlSaleCommitSim(db, p, '')
  expect(db.entities.get('card:КАКАПО-0001').debtPayVersion === 4, 'version +1')
  // repay OCC expects version field present — credit increases it (existing behavior)
  expect(opsSrc.includes('debtPayVersion: expectedDebtPayVersion + 1'), 'ops bumps version')
})

// 13) no network required
test('13) local commit needs no network fields', () => {
  const db = openSimDb(seedCrm(0))
  const p = creditPayload({ prevDebt: 0, debtAdded: 5 })
  expect(!('Authorization' in (p.queueRow.payload || {})), 'no auth')
  const res = sqlSaleCommitSim(db, p, '')
  expect(res.ok, 'ok offline')
})

// 14) queue payload contract
test('14) queue payload/network contract unchanged (kind=sale + clientRef)', () => {
  const db = openSimDb(seedCrm(10))
  const p = creditPayload({ prevDebt: 10, debtAdded: 5 })
  sqlSaleCommitSim(db, p, '')
  const row = db.queue.get('cref-credit-1')
  expect(row.kind === 'sale', 'kind')
  expect(row.clientRef === 'cref-credit-1', 'clientRef')
  expect(row.payload.appliedLocal === true, 'appliedLocal')
  expect(row.payload.skipBalances === true, 'skipBalances')
  expect(row.payload.debtAdded === 5, 'debtAdded')
})

// 15) DebtOperation mapping
test('15) DebtOperation: operationId==clientRef, debtDelta positive', () => {
  const p = creditPayload({ clientRef: 'cref-d1', prevDebt: 10, debtAdded: 7.5 })
  const op = toDebtOperationFromSale({
    clientRef: p.queueRow.clientRef,
    clientId: 'U-01',
    cardNum: 'КАКАПО-0001',
    debtAdded: 7.5,
    saleId: p.sale.id,
    createdAtIso: p.queueRow.createdAtIso,
  })
  expect(op.operationId === 'cref-d1', 'operationId')
  expect(op.operationId === op.clientRef, 'rule')
  expect(op.type === 'sale_on_credit', 'type')
  expect(op.debtDelta === 7.5, 'delta')
  const v = validateDebtOperation(op)
  expect(v.ok, v.errors.join(','))
})

console.log(`\n${'='.repeat(40)}`)
console.log(`RESULT  passed=${passed} failed=${failed}`)
if (failed > 0) process.exit(1)
