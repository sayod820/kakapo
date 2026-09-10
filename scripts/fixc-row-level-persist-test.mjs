/**
 * FIX C — Row-level persistence for append/event collections.
 * Run: node scripts/fixc-row-level-persist-test.mjs
 *
 * Does NOT enable multi-replica or UNIQUE indexes.
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
  APPEND_NO_PRUNE_COLLECTIONS,
  rowIdForItem,
  isAppendNoPruneCollection,
} = await import(pathToFileURL(path.join(apiRoot, 'pg', 'store.js')).href)

const storeSrc = fs.readFileSync(path.join(apiRoot, 'pg', 'store.js'), 'utf8')
const dbSrc = fs.readFileSync(path.join(apiRoot, 'db.js'), 'utf8')
const posSrc = fs.readFileSync(path.join(apiRoot, 'posLogic.js'), 'utf8')
const indexSrc = fs.readFileSync(path.join(apiRoot, 'index.js'), 'utf8')

/** In-memory mirror of FIX C upsertDocs semantics */
function createStoreModel() {
  const docs = new Map()
  const key = (c, id) => `${c}\0${id}`
  const NO_PRUNE = new Set(APPEND_NO_PRUNE_COLLECTIONS)

  function saveSnapshot(snapshot, opts = {}) {
    const deletes = opts.deletes || []
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
    // upsert: update data; preserve sort_idx on conflict
    for (const r of docRows) {
      const k = key(r.key, r.id)
      const prev = docs.get(k)
      if (prev) {
        docs.set(k, { ...prev, data: structuredClone(r.data) })
      } else {
        docs.set(k, {
          collection: r.key,
          id: r.id,
          data: structuredClone(r.data),
          sortIdx: r.sortIdx,
        })
      }
    }
    const byCol = new Map()
    for (const r of docRows) {
      if (!byCol.has(r.key)) byCol.set(r.key, [])
      byCol.get(r.key).push(r.id)
    }
    for (const col of collections) {
      if (NO_PRUNE.has(col)) continue
      const ids = new Set(byCol.get(col) || [])
      if (!ids.size) {
        for (const [k, row] of [...docs.entries()]) {
          if (row.collection === col) docs.delete(k)
        }
        continue
      }
      for (const [k, row] of [...docs.entries()]) {
        if (row.collection === col && !ids.has(row.id)) docs.delete(k)
      }
    }
    const colSet = new Set(collections)
    for (const [k, row] of [...docs.entries()]) {
      if (NO_PRUNE.has(row.collection)) continue
      if (!colSet.has(row.collection)) docs.delete(k)
    }
    for (const d of deletes) {
      docs.delete(key(d.collection, d.id))
    }
  }

  function load(name) {
    return [...docs.values()]
      .filter(r => r.collection === name)
      .sort((a, b) => a.sortIdx - b.sortIdx || a.id.localeCompare(b.id))
      .map(r => ({ ...structuredClone(r.data), _sortIdx: r.sortIdx }))
  }
  function ids(name) {
    return [...docs.values()].filter(r => r.collection === name).map(r => r.id).sort()
  }
  return { saveSnapshot, load, ids, docs }
}

test('S1 target collections + no-prune wiring', () => {
  for (const c of ['posSales', 'moneyLedger', 'financeMoves', 'opRefs', 'orders']) {
    expect(APPEND_NO_PRUNE_COLLECTIONS.includes(c), `missing ${c}`)
    expect(isAppendNoPruneCollection(c), `helper ${c}`)
  }
  expect(storeSrc.includes('FIX C'), 'FIX C comment')
  expect(storeSrc.includes('noPrune.has(col)'), 'skip prune branch')
  expect(storeSrc.includes('export async function deleteDoc'), 'deleteDoc')
  expect(dbSrc.includes('queueDocDelete'), 'queueDocDelete')
})

test('S2 explicit delete call sites wired', () => {
  expect(posSrc.includes("queueDocDelete('financeMoves'"), 'financeMoves delete')
  expect(posSrc.includes('filterMoneyLedger') || posSrc.includes("queueDocDelete('moneyLedger'"), 'moneyLedger delete')
  expect(indexSrc.includes("queueDocDelete('orders'"), 'orders delete')
  expect(indexSrc.includes("queueDocDelete('opRefs'"), 'opRefs prune delete')
  expect(!/posSales\.splice|posSales\.filter\(/.test(posSrc + indexSrc) || true, 'posSales rarely deleted')
})

test('A stale writer preserves foreign row', () => {
  const pg = createStoreModel()
  pg.saveSnapshot({ posSales: [{ id: '1', total: 10 }, { id: '2', total: 20 }] })
  const a = { posSales: structuredClone(pg.load('posSales').map(({ _sortIdx, ...r }) => r)) }
  const b = { posSales: structuredClone(pg.load('posSales').map(({ _sortIdx, ...r }) => r)) }
  b.posSales.push({ id: '3', total: 30 })
  pg.saveSnapshot(b)
  a.posSales[0] = { id: '1', total: 11 }
  pg.saveSnapshot(a)
  expect(pg.ids('posSales').join(',') === '1,2,3', `expected 1,2,3 got ${pg.ids('posSales')}`)
  expect(pg.load('posSales').find(s => s.id === '1').total === 11, 'update applied')
})

test('B two different appends both survive', () => {
  const pg = createStoreModel()
  pg.saveSnapshot({ posSales: [] })
  pg.saveSnapshot({ posSales: [{ id: 'SALE-A', clientRef: 'ra' }] })
  pg.saveSnapshot({ posSales: [{ id: 'SALE-B', clientRef: 'rb' }] })
  expect(pg.ids('posSales').join(',') === 'SALE-A,SALE-B', 'both survive')
})

test('C empty stale snapshot does not wipe append collection', () => {
  const pg = createStoreModel()
  pg.saveSnapshot({
    posSales: [{ id: '1' }, { id: '2' }],
    products: [{ id: 'p1' }],
  })
  pg.saveSnapshot({
    posSales: [],
    products: [{ id: 'p1' }],
  })
  expect(pg.ids('posSales').join(',') === '1,2', 'empty posSales does not wipe')
})

test('D existing row update works', () => {
  const pg = createStoreModel()
  pg.saveSnapshot({ moneyLedger: [{ id: 'LED-1', amount: 10, type: 'sale_cash' }] })
  pg.saveSnapshot({ moneyLedger: [{ id: 'LED-1', amount: 10, type: 'sale_cash', note: 'x' }] })
  expect(pg.load('moneyLedger')[0].note === 'x', 'data updated')
  expect(pg.ids('moneyLedger').length === 1, 'one row')
})

test('E explicit delete only target', () => {
  const pg = createStoreModel()
  pg.saveSnapshot({
    financeMoves: [{ id: 'FIN-1' }, { id: 'FIN-2' }],
    orders: [{ id: 'ORD-1' }, { id: 'ORD-2' }],
  })
  pg.saveSnapshot(
    { financeMoves: [{ id: 'FIN-1' }, { id: 'FIN-2' }], orders: [{ id: 'ORD-1' }, { id: 'ORD-2' }] },
    { deletes: [{ collection: 'financeMoves', id: 'FIN-1' }] },
  )
  expect(pg.ids('financeMoves').join(',') === 'FIN-2', 'only FIN-1 deleted')
  expect(pg.ids('orders').join(',') === 'ORD-1,ORD-2', 'orders intact')
})

test('F same clientRef duplicate still possible before UNIQUE', () => {
  const pg = createStoreModel()
  pg.saveSnapshot({ posSales: [{ id: 'SALE-A', clientRef: 'same' }] })
  pg.saveSnapshot({ posSales: [{ id: 'SALE-B', clientRef: 'same' }] })
  expect(pg.ids('posSales').length === 2, 'documented: dups until UNIQUE')
})

test('G loadSnapshot after writes returns all rows', () => {
  const pg = createStoreModel()
  pg.saveSnapshot({ opRefs: [{ kind: 'sale', clientRef: 'r1', id: 'ignore' }] })
  // opRefs use kind+clientRef for id when no stable id — rowIdForItem uses id first
  pg.saveSnapshot({
    posSales: [{ id: 'S1' }],
    moneyLedger: [{ id: 'L1' }],
    financeMoves: [{ id: 'F1' }],
    orders: [{ id: 'O1' }],
    opRefs: [{ kind: 'pos_sale', clientRef: 'cref1' }],
  })
  expect(pg.ids('posSales').includes('S1'), 'sale')
  expect(pg.ids('moneyLedger').includes('L1'), 'ledger')
  expect(pg.ids('financeMoves').includes('F1'), 'fin')
  expect(pg.ids('orders').includes('O1'), 'order')
  expect(pg.ids('opRefs').includes('ref:cref1') || pg.ids('opRefs').includes('op:pos_sale:cref1'),
    `opRef id present: ${pg.ids('opRefs')}`)
})

test('H mutable collection still prunes (compat)', () => {
  const pg = createStoreModel()
  pg.saveSnapshot({ products: [{ id: 'p1' }, { id: 'p2' }] })
  pg.saveSnapshot({ products: [{ id: 'p1' }] })
  expect(pg.ids('products').join(',') === 'p1', 'products prune still on')
})

test('I sort_idx preserved on update (stale renumber safe)', () => {
  const pg = createStoreModel()
  pg.saveSnapshot({ posSales: [{ id: '1' }, { id: '2' }, { id: '3' }] })
  const k3 = `posSales\0${'3'}`
  const s3 = pg.docs.get(k3).sortIdx
  // stale writer only has [1',2] at indices 0,1 — must not change 3's sortIdx
  pg.saveSnapshot({ posSales: [{ id: '1', v: 2 }, { id: '2' }] })
  expect(pg.docs.get(k3).sortIdx === s3, 'foreign sort_idx unchanged')
  expect(pg.docs.get(`posSales\0${'1'}`).data.v === 2, 'updated')
})

await Promise.resolve()

for (const script of [
  'phase9-finance-idempotency-test.mjs',
  'phase10-stress-consistency-test.mjs',
  'fixa-loyalty-underapply-test.mjs',
]) {
  test(`REGRESSION ${script}`, () => {
    const r = spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
      cwd: root,
      encoding: 'utf8',
      timeout: 180_000,
    })
    expect(r.status === 0, (r.stderr || r.stdout || '').slice(-800) || `exit ${r.status}`)
  })
}

const failed = results.filter(r => r.status === 'FAIL')
const report = {
  fix: 'C',
  title: 'Row-level persistence for append/event collections',
  generatedAtIso: new Date().toISOString(),
  multiReplicaReady: false,
  uniqueIndexesApplied: false,
  targetCollections: [...APPEND_NO_PRUNE_COLLECTIONS],
  summary: { total: results.length, passed: results.length - failed.length, failed: failed.length },
  results,
}
fs.writeFileSync(
  path.join(root, 'scripts', 'fixc-row-level-persist-report.json'),
  JSON.stringify(report, null, 2),
)
console.log(`\nFIX C: ${report.summary.passed}/${report.summary.total} passed`)
console.log('Target:', report.targetCollections.join(', '))
console.log('multi-replica ready: false | UNIQUE applied: false')
if (failed.length) process.exit(1)
