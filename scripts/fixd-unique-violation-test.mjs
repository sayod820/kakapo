/**
 * FIX D — unique_violation (23505) handling + idempotency key tests.
 * Run: node scripts/fixd-unique-violation-test.mjs
 *
 * Does NOT apply production indexes.
 * Uses in-memory UNIQUE simulator matching proposed expression indexes.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiRoot = path.join(root, 'server', 'kakapo-api')

const results = []
function test(name, fn) {
  try {
    const out = fn()
    if (out?.then) {
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
  IDEMPOTENCY_UNIQUE_INDEXES,
  IDEMPOTENCY_INDEX_NAMES,
  classifyUniqueViolation,
  makePgUniqueViolationError,
  applyIdempotencyConflictsToSnapshot,
  findInMemoryUniqueConflict,
} = await import(pathToFileURL(path.join(apiRoot, 'pg', 'uniqueIdempotency.js')).href)

const { rowIdForItem, APPEND_NO_PRUNE_COLLECTIONS } = await import(
  pathToFileURL(path.join(apiRoot, 'pg', 'store.js')).href
)

const { appendMoneyLedger } = await import(pathToFileURL(path.join(apiRoot, 'financeTruth.js')).href)
const { createFinanceMove, createPosSale } = await import(
  pathToFileURL(path.join(apiRoot, 'posLogic.js')).href
)

/** Docs store with PK upsert + expression UNIQUE (FIX D). */
function createUniqueDocsStore() {
  /** @type {Map<string, {collection:string,id:string,data:any,sortIdx:number}>} */
  const docs = new Map()
  const pk = (c, id) => `${c}\0${id}`

  function allRows() {
    return [...docs.values()]
  }

  function upsertRow(collection, id, data, sortIdx) {
    const conflict = findInMemoryUniqueConflict(allRows(), collection, id, data)
    if (conflict) {
      const err = makePgUniqueViolationError(conflict.constraint)
      err._conflict = conflict
      throw err
    }
    const k = pk(collection, id)
    const prev = docs.get(k)
    if (prev) {
      docs.set(k, { ...prev, data: structuredClone(data) })
    } else {
      docs.set(k, { collection, id, data: structuredClone(data), sortIdx })
    }
  }

  function persistSnapshot(snapshot) {
    const conflicts = []
    const collections = []
    const docRows = []
    for (const [col, value] of Object.entries(snapshot || {})) {
      if (!Array.isArray(value)) continue
      collections.push(col)
      const used = new Set()
      for (let i = 0; i < value.length; i++) {
        let id = rowIdForItem(value[i], i)
        if (used.has(id)) id = `${id}#${i}`
        used.add(id)
        docRows.push({ key: col, id, data: value[i], sortIdx: i })
      }
    }
    for (const r of docRows) {
      try {
        upsertRow(r.key, r.id, r.data, r.sortIdx)
      } catch (e) {
        if (e.code !== '23505' || !e._conflict) throw e
        const classified = classifyUniqueViolation(e)
        expect(classified?.known, 'known constraint')
        const existing = docs.get(pk(e._conflict.collection, e._conflict.existingId))
        conflicts.push({
          constraint: e._conflict.constraint,
          collection: e._conflict.collection,
          attemptedId: r.id,
          attemptedData: r.data,
          existingId: existing.id,
          existingData: existing.data,
          _idempotentReplay: true,
        })
      }
    }
    applyIdempotencyConflictsToSnapshot(snapshot, conflicts)
    return { conflicts }
  }

  function byCollection(col) {
    return allRows().filter(r => r.collection === col).map(r => r.data)
  }

  return { persistSnapshot, byCollection, docs, allRows }
}

await test('wiring: known index names present', () => {
  expect(IDEMPOTENCY_INDEX_NAMES.length >= 4, '>=4 indexes')
  expect(IDEMPOTENCY_UNIQUE_INDEXES.uq_docs_possales_client_ref.collection === 'posSales', 'sale')
  expect(IDEMPOTENCY_UNIQUE_INDEXES.uq_docs_moneyledger_client_ref_type.collection === 'moneyLedger', 'ledger')
  expect(IDEMPOTENCY_UNIQUE_INDEXES.uq_docs_financemoves_client_ref.collection === 'financeMoves', 'fin')
  expect(IDEMPOTENCY_UNIQUE_INDEXES.uq_docs_oprefs_kind_client_ref.collection === 'opRefs', 'op')
  const storeSrc = fs.readFileSync(path.join(apiRoot, 'pg', 'store.js'), 'utf8')
  expect(storeSrc.includes('isKnownIdempotencyUniqueViolation'), 'store handles 23505')
  expect(storeSrc.includes('SAVEPOINT fixd_upsert'), 'savepoint path')
  const dbSrc = fs.readFileSync(path.join(apiRoot, 'db.js'), 'utf8')
  expect(dbSrc.includes('applyIdempotencyConflictsToSnapshot'), 'db reconcile')
  const indexSrc = fs.readFileSync(path.join(apiRoot, 'index.js'), 'utf8')
  expect(indexSrc.includes('await flushDbAsync()'), 'sale/finance await flush')
  expect(indexSrc.includes('idx >= 0) rows[idx] = row'), 'rememberOpRef upsert')
})

await test('E unexpected 23505 not swallowed', () => {
  const err = makePgUniqueViolationError('docs_pkey')
  const c = classifyUniqueViolation(err)
  expect(c && c.known === false, 'unknown not known')
  expect(c.constraint === 'docs_pkey', 'name')
  const known = classifyUniqueViolation(makePgUniqueViolationError('uq_docs_possales_client_ref'))
  expect(known?.known === true, 'known sale index')
})

await test('A same sale clientRef → one row, loser replay', () => {
  const store = createUniqueDocsStore()
  const snapA = {
    posSales: [{ id: 'SALE-A', clientRef: 'REF-1', total: 10 }],
  }
  const snapB = {
    posSales: [{ id: 'SALE-B', clientRef: 'REF-1', total: 10 }],
  }
  const r1 = store.persistSnapshot(snapA)
  expect(r1.conflicts.length === 0, 'first ok')
  const r2 = store.persistSnapshot(snapB)
  expect(r2.conflicts.length === 1, 'conflict')
  expect(r2.conflicts[0].constraint === 'uq_docs_possales_client_ref', 'sale idx')
  expect(r2.conflicts[0].existingId === 'SALE-A', 'winner A')
  expect(snapB.posSales.length === 1 && snapB.posSales[0].id === 'SALE-A', 'B memory adopts A')
  expect(store.byCollection('posSales').length === 1, 'one in db')
  expect(store.byCollection('posSales')[0].id === 'SALE-A', 'db is A')
})

await test('B same moneyLedger (clientRef,type) → one line', () => {
  const store = createUniqueDocsStore()
  store.persistSnapshot({
    moneyLedger: [{ id: 'LED-1', clientRef: 'R', type: 'sale_cash', amount: 5 }],
  })
  const snap = {
    moneyLedger: [{ id: 'LED-2', clientRef: 'R', type: 'sale_cash', amount: 5 }],
  }
  const r = store.persistSnapshot(snap)
  expect(r.conflicts[0].constraint === 'uq_docs_moneyledger_client_ref_type', 'ledger idx')
  expect(store.byCollection('moneyLedger').length === 1, 'one ledger')
  // different type same clientRef allowed
  store.persistSnapshot({
    moneyLedger: [
      { id: 'LED-1', clientRef: 'R', type: 'sale_cash', amount: 5 },
      { id: 'LED-3', clientRef: 'R', type: 'sale_card', amount: 3 },
    ],
  })
  expect(store.byCollection('moneyLedger').length === 2, 'two types ok')
})

await test('C same financeMoves clientRef → one move', () => {
  const store = createUniqueDocsStore()
  store.persistSnapshot({
    financeMoves: [{ id: 'FIN-1', clientRef: 'TOP-1', type: 'deposit', amount: 100 }],
  })
  const snap = {
    financeMoves: [{ id: 'FIN-2', clientRef: 'TOP-1', type: 'deposit', amount: 100 }],
  }
  const r = store.persistSnapshot(snap)
  expect(r.conflicts[0].constraint === 'uq_docs_financemoves_client_ref', 'fin idx')
  expect(store.byCollection('financeMoves').length === 1, 'one move')
})

await test('D same opRefs(kind,clientRef) → one opRef', () => {
  const store = createUniqueDocsStore()
  store.persistSnapshot({
    opRefs: [{ id: 'op1', kind: 'debt_repay', clientRef: 'DR-1', result: { ok: 1 } }],
  })
  const snap = {
    opRefs: [{ id: 'op2', kind: 'debt_repay', clientRef: 'DR-1', result: { ok: 1 } }],
  }
  const r = store.persistSnapshot(snap)
  expect(r.conflicts[0].constraint === 'uq_docs_oprefs_kind_client_ref', 'op idx')
  expect(store.byCollection('opRefs').length === 1, 'one opRef')
  // different kind same clientRef allowed by UNIQUE design
  store.persistSnapshot({
    opRefs: [
      { id: 'op1', kind: 'debt_repay', clientRef: 'DR-1', result: { ok: 1 } },
      { id: 'op3', kind: 'pos_sale', clientRef: 'DR-1', result: { id: 'S' } },
    ],
  })
  expect(store.byCollection('opRefs').length === 2, 'two kinds ok')
})

await test('F different clientRefs both persist', () => {
  const store = createUniqueDocsStore()
  store.persistSnapshot({
    posSales: [{ id: 'SALE-A', clientRef: 'REF-A', total: 1 }],
  })
  store.persistSnapshot({
    posSales: [{ id: 'SALE-B', clientRef: 'REF-B', total: 2 }],
  })
  const sales = store.byCollection('posSales')
  expect(sales.length === 2, 'both')
  expect(sales.some(s => s.clientRef === 'REF-A') && sales.some(s => s.clientRef === 'REF-B'), 'refs')
})

await test('business keys: app-level dedupe matches UNIQUE', () => {
  const db = {
    posSales: [],
    moneyLedger: [],
    financeMoves: [],
    posShifts: [],
    products: [],
    cashiers: [],
    cashVault: { cashTotal: 0, cardTotal: 0, version: 0 },
    clients: [],
    cards: [],
    _seq: { posSale: 0, order: 0 },
  }
  // ledger
  const L1 = appendMoneyLedger(db, { type: 'sale_cash', amount: 10, clientRef: 'X', direction: 'in' })
  const L2 = appendMoneyLedger(db, { type: 'sale_cash', amount: 10, clientRef: 'X', direction: 'in' })
  expect(L2._replay === true && L2.id === L1.id, 'ledger replay')
  const L3 = appendMoneyLedger(db, { type: 'sale_card', amount: 5, clientRef: 'X', direction: 'in' })
  expect(!L3._replay && L3.id !== L1.id, 'different type new line')

  // finance move
  const M1 = createFinanceMove(db, {
    type: 'deposit', amount: 50, clientRef: 'FM1', payFrom: 'vault', method: 'cash',
  })
  const M2 = createFinanceMove(db, {
    type: 'deposit', amount: 50, clientRef: 'FM1', payFrom: 'vault', method: 'cash',
  })
  expect(M2._replay === true && M2.id === M1.id, 'finance replay')
})

await test('FIX C no-prune still listed', () => {
  expect(APPEND_NO_PRUNE_COLLECTIONS.includes('posSales'), 'posSales')
  expect(APPEND_NO_PRUNE_COLLECTIONS.includes('moneyLedger'), 'ledger')
})

await test('migration script exists (dry-run default)', () => {
  const p = path.join(root, 'scripts', 'fixd-apply-unique-indexes.mjs')
  expect(fs.existsSync(p), 'script')
  const src = fs.readFileSync(p, 'utf8')
  expect(src.includes('CREATE UNIQUE INDEX CONCURRENTLY'), 'concurrently')
  expect(src.includes('CONFIRM_FIXD_APPLY'), 'confirm gate')
  expect(/must not.*begin|not.*inside begin/i.test(src), 'no txn wrap note')
})

function runRegression(label, script) {
  const r = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' })
  const ok = r.status === 0
  if (!ok) {
    console.error(r.stdout?.slice(-800))
    console.error(r.stderr?.slice(-800))
  }
  expect(ok, `${label} exit ${r.status}`)
}

await test('REGRESSION fixc-row-level-persist-test.mjs', () => {
  runRegression('fixc', 'scripts/fixc-row-level-persist-test.mjs')
})

await test('REGRESSION fixa-loyalty-underapply-test.mjs', () => {
  runRegression('fixa', 'scripts/fixa-loyalty-underapply-test.mjs')
})

await test('REGRESSION phase9-finance-idempotency-test.mjs', () => {
  runRegression('phase9', 'scripts/phase9-finance-idempotency-test.mjs')
})

await test('REGRESSION phase10-stress-consistency-test.mjs', () => {
  runRegression('phase10', 'scripts/phase10-stress-consistency-test.mjs')
})

const failed = results.filter(r => r.status === 'FAIL')
const report = {
  title: 'FIX D — 23505 handling (indexes NOT applied to prod)',
  generatedAtIso: new Date().toISOString(),
  productionIndexesApplied: false,
  multiReplicaEnabled: false,
  passed: results.filter(r => r.status === 'PASS').length,
  failed: failed.length,
  results,
}
fs.writeFileSync(
  path.join(root, 'scripts', 'fixd-unique-violation-report.json'),
  JSON.stringify(report, null, 2),
)

console.log('')
console.log(`FIX D: ${report.passed}/${results.length} passed`)
console.log('productionIndexesApplied: false | multi-replica: false')
if (failed.length) process.exitCode = 1
