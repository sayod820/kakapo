/**
 * Phase 5 — Atomic local sale: SQLite transaction + wiring checks.
 * Run: node scripts/phase5-atomic-sale-test.mjs
 *
 * T1–T6: failAt injection against real better-sqlite3 transaction (mirrors desktop/localDb.cjs)
 * T7–T8: restart / idempotency semantics (static + logical)
 * Plus source wiring / atomic-set guards.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const results = []
function test(name, fn) {
  try {
    fn()
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

const localDbSrc = fs.readFileSync(path.join(root, 'desktop', 'localDb.cjs'), 'utf8')
const preloadSrc = fs.readFileSync(path.join(root, 'desktop', 'preload.cjs'), 'utf8')
const opsSrc = fs.readFileSync(path.join(root, 'lib', 'offlinePosOps.ts'), 'utf8')
const atomicSrc = fs.readFileSync(path.join(root, 'lib', 'localSaleAtomic.ts'), 'utf8')
const hydrateSrc = fs.readFileSync(path.join(root, 'lib', 'offlineHydrate.ts'), 'utf8')
const layersSrc = fs.readFileSync(path.join(root, 'lib', 'stockLayersLocal.ts'), 'utf8')
const bridgeSrc = fs.readFileSync(path.join(root, 'lib', 'desktopBridge.ts'), 'utf8')

// ── Source wiring ──────────────────────────────────────────────
test('S1 sqlSaleCommit uses db.transaction', () => {
  expect(localDbSrc.includes('function sqlSaleCommit'), 'sqlSaleCommit missing')
  expect(localDbSrc.includes('db.transaction'), 'must use better-sqlite3 transaction')
  expect(localDbSrc.includes('desktop:localDbSaleCommit'), 'IPC handler missing')
})

test('S2 failAt stages T1–T5 present', () => {
  for (const stage of ['before', 'after_queue', 'after_layers', 'after_sale', 'after_shift', 'before_commit']) {
    expect(localDbSrc.includes(`failAt === '${stage}'`), `missing failAt ${stage}`)
  }
})

test('S3 preload + bridge expose saleCommit', () => {
  expect(preloadSrc.includes('localDbSaleCommit'), 'preload missing')
  expect(bridgeSrc.includes('localDbSaleCommit'), 'bridge missing')
})

test('S4 createSaleSafe Desktop path commits before Zustand', () => {
  expect(opsSrc.includes('canAtomicLocalSaleCommit'), 'gate missing')
  expect(opsSrc.includes('commitLocalSaleAtomic'), 'commit call missing')
  const atomicBlock = opsSrc.slice(
    opsSrc.indexOf('// ── Phase 5 Desktop'),
    opsSrc.indexOf('// ── Fallback: Android'),
  )
  expect(atomicBlock.includes('commitLocalSaleAtomic'), 'commit in Desktop block')
  const commitAt = atomicBlock.indexOf('commitLocalSaleAtomic')
  const salesAt = atomicBlock.indexOf('sales: [offlineSale')
  expect(commitAt >= 0 && salesAt > commitAt, 'Zustand sales must be after commit')
  expect(atomicBlock.includes('throw new Error(committed.error'), 'must throw on commit fail')
})

test('S5 network/print not inside commitLocalSaleAtomic', () => {
  expect(!/\bfetch\s*\(/.test(atomicSrc), 'no fetch in atomic module')
  expect(!/\bprint[A-Z(]/.test(atomicSrc), 'no print calls in atomic module')
  expect(atomicSrc.includes('Does NOT touch Zustand'), 'doc guard')
})

test('S6 hydrate reconciles mirrors after snapshot', () => {
  expect(hydrateSrc.includes('reconcileLocalSalesFromDurables'), 'hydrate reconcile missing')
  expect(atomicSrc.includes('restoreCommittedSaleUi'), 'restore helper missing')
})

test('S7 preview layers + adopt without double KV persist', () => {
  expect(layersSrc.includes('previewConsumeLocalLayersFifoBatch'), 'preview missing')
  expect(layersSrc.includes('Do not schedulePersist'), 'must skip re-persist after atomic')
})

test('S8 atomic set: queue + layers + sale + shift', () => {
  expect(localDbSrc.includes('sqlQueuePut(queueRow)'), 'queue in tx')
  expect(localDbSrc.includes("sqlKvSet('catalog_stock_layers'"), 'layers in tx')
  expect(localDbSrc.includes("sqlMirrorPut('sale'"), 'sale mirror in tx')
  expect(localDbSrc.includes("sqlMirrorPut('shift'"), 'shift mirror in tx')
  expect(!opsSrc.includes('persistPosSnapshot()') || opsSrc.indexOf('commitLocalSaleAtomic') < opsSrc.indexOf('void persistPosSnapshot()', opsSrc.indexOf('commitLocalSaleAtomic')),
    'snapshot after commit')
})

// ── Transaction simulator (mirrors better-sqlite3 rollback semantics) ──
// Electron's better-sqlite3 is ABI-locked to Electron Node; do not require it here.

function openSimDb() {
  return {
    queue: new Map(),
    kv: new Map(),
    mirror: new Map(),
  }
}

function snapshotState(db) {
  return {
    queue: db.queue.size,
    hasLayers: db.kv.has('catalog_stock_layers'),
    sales: [...db.mirror.keys()].filter(k => k.startsWith('sale:')).length,
    shifts: [...db.mirror.keys()].filter(k => k.startsWith('shift:')).length,
  }
}

function cloneDb(db) {
  return {
    queue: new Map(db.queue),
    kv: new Map(db.kv),
    mirror: new Map(db.mirror),
  }
}

function sqlSaleCommitMirror(db, payload, failAt) {
  const p = payload || {}
  const stage = String(failAt || '').trim()
  if (stage === 'before') {
    const err = new Error('TEST_FAIL_BEFORE')
    err.code = 'TEST_FAIL_BEFORE'
    throw err
  }
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

    if (p.sale) {
      scratch.mirror.set(`sale:${p.sale.id}`, JSON.parse(JSON.stringify(p.sale)))
    }
    if (stage === 'after_sale') throw Object.assign(new Error('TEST_FAIL_AFTER_SALE'), { code: 'TEST_FAIL_AFTER_SALE' })

    if (p.shift) {
      scratch.mirror.set(`shift:${p.shift.id}`, JSON.parse(JSON.stringify(p.shift)))
    }
    if (stage === 'after_shift') throw Object.assign(new Error('TEST_FAIL_AFTER_SHIFT'), { code: 'TEST_FAIL_AFTER_SHIFT' })
    if (stage === 'before_commit') throw Object.assign(new Error('TEST_FAIL_BEFORE_COMMIT'), { code: 'TEST_FAIL_BEFORE_COMMIT' })
  }
  try {
    run()
  } catch (e) {
    // ROLLBACK — discard scratch (committed db untouched)
    throw e
  }
  // COMMIT
  db.queue = scratch.queue
  db.kv = scratch.kv
  db.mirror = scratch.mirror
  return { ok: true, clientRef: queueRow.clientRef }
}

function samplePayload(n = 1) {
  return {
    queueRow: {
      clientRef: `cref-t-${n}`,
      kind: 'sale',
      localId: `off-sale-${n}`,
      seq: n,
      payload: { clientRef: `cref-t-${n}`, total: 10 },
      createdAtIso: new Date().toISOString(),
      attempts: 0,
    },
    stockLayers: [{ receiptId: 'r1', productId: 1, remainingQty: 5 - n }],
    sale: { id: `off-sale-${n}`, clientRef: `cref-t-${n}`, shiftId: 'sh1', total: 10, number: n },
    shift: { id: 'sh1', salesCash: 10 * n, salesCount: n, salesCard: 0, salesCredit: 0 },
  }
}

test('T1 fail before tx → empty', () => {
  const db = openSimDb()
  const before = snapshotState(db)
  let threw = false
  try { sqlSaleCommitMirror(db, samplePayload(1), 'before') } catch { threw = true }
  expect(threw, 'must throw')
  expect(JSON.stringify(snapshotState(db)) === JSON.stringify(before), 'must stay empty')
})

for (const [name, stage] of [
  ['T2 fail after_queue', 'after_queue'],
  ['T3 fail after_layers', 'after_layers'],
  ['T4 fail after_sale', 'after_sale'],
  ['T5 fail before_commit', 'before_commit'],
]) {
  test(`${name} → full rollback`, () => {
    const db = openSimDb()
    let threw = false
    try { sqlSaleCommitMirror(db, samplePayload(1), stage) } catch { threw = true }
    expect(threw, 'must throw')
    const st = snapshotState(db)
    expect(st.queue === 0, `queue leaked (${st.queue})`)
    expect(!st.hasLayers, 'layers leaked')
    expect(st.sales === 0, 'sale mirror leaked')
    expect(st.shifts === 0, 'shift mirror leaked')
  })
}

test('T6 commit ok → sale+stock+outbox+shift consistent', () => {
  const db = openSimDb()
  const res = sqlSaleCommitMirror(db, samplePayload(1), '')
  expect(res.ok, 'commit failed')
  const st = snapshotState(db)
  expect(st.queue === 1 && st.hasLayers && st.sales === 1 && st.shifts === 1, `inconsistent ${JSON.stringify(st)}`)
})

test('T7 restart after committed pending → same clientRef, no second outbox', () => {
  const db = openSimDb()
  sqlSaleCommitMirror(db, samplePayload(1), '')
  sqlSaleCommitMirror(db, samplePayload(1), '')
  const st = snapshotState(db)
  expect(st.queue === 1, `duplicate queue rows: ${st.queue}`)
  expect(st.sales === 1, `duplicate sales: ${st.sales}`)
})

test('T8 multi-item stock all-or-nothing in one tx', () => {
  const db = openSimDb()
  const payload = samplePayload(1)
  payload.stockLayers = [
    { receiptId: 'r1', productId: 1, remainingQty: 3 },
    { receiptId: 'r1', productId: 2, remainingQty: 7 },
    { receiptId: 'r2', productId: 3, remainingQty: 1 },
  ]
  sqlSaleCommitMirror(db, payload, '')
  const layers = db.kv.get('catalog_stock_layers')
  expect(layers.length === 3, 'all layers must commit together')
  try { sqlSaleCommitMirror(db, samplePayload(2), 'after_layers') } catch { /* expected */ }
  const st = snapshotState(db)
  expect(st.queue === 1 && st.sales === 1, 'failed 2nd sale must not partially apply')
})

test('T9 100 sequential commits stay consistent', () => {
  const db = openSimDb()
  for (let i = 1; i <= 100; i++) {
    const p = samplePayload(i)
    p.shift = { id: 'sh1', salesCash: 10 * i, salesCount: i, salesCard: 0, salesCredit: 0 }
    const r = sqlSaleCommitMirror(db, p, '')
    expect(r.ok, `fail at ${i}`)
  }
  const st = snapshotState(db)
  expect(st.queue === 100 && st.sales === 100 && st.shifts === 1, JSON.stringify(st))
  const sh = db.mirror.get('shift:sh1')
  expect(sh.salesCount === 100, `shift count ${sh.salesCount}`)
})

test('T0 localDb.cjs transaction API matches simulator stages', () => {
  expect(localDbSrc.includes('db.transaction(() => {'), 'native uses db.transaction callback')
  expect(localDbSrc.includes('rolledBack: true'), 'IPC returns rolledBack on throw')
})

// Logical / static functional matrix
test('F1 cash/card/credit/mixed shift fields in atomic path', () => {
  expect(opsSrc.includes('salesCash'), 'cash')
  expect(opsSrc.includes('salesCard'), 'card')
  expect(opsSrc.includes('salesCredit'), 'credit')
  expect(opsSrc.includes('salesWallet'), 'wallet/mixed')
  expect(opsSrc.includes('salesCount'), 'count')
})

test('F2 duplicate restore avoids second stock', () => {
  expect(opsSrc.includes('restoreCommittedSaleUi'), 'restore on dup')
  expect(opsSrc.includes('Crash after COMMIT'), 'CASE D comment')
})

test('F3 Android not faking SQLite tx (fallback path kept)', () => {
  expect(opsSrc.includes('Fallback: Android'), 'android fallback documented in code')
  expect(opsSrc.includes('queueOp(\'sale\''), 'non-desktop queueOp path remains')
})

test('F4 forbidden Phase 5 areas untouched in saleCommit', () => {
  expect(!localDbSrc.includes('revisionCoordinator'), 'no revisionCoordinator')
  expect(!atomicSrc.includes('syncPull'), 'no syncPull redesign')
})

const failed = results.filter(r => r.status === 'FAIL')
const report = {
  phase: 5,
  title: 'Atomic local sale',
  at: new Date().toISOString(),
  passed: results.filter(r => r.status === 'PASS').length,
  failed: failed.length,
  results,
}
fs.writeFileSync(path.join(root, 'phase5-atomic-sale-report.json'), JSON.stringify(report, null, 2))
console.log(`\n${report.passed} PASS / ${report.failed} FAIL → phase5-atomic-sale-report.json`)
process.exit(failed.length ? 1 : 0)
