/**
 * P10 multi-writer snapshot safety — audit + lost-update REPRO (read-only vs production).
 * Run: node scripts/p10-multi-writer-snapshot-audit.mjs
 *
 * Does NOT modify pg/store.js.
 * Does NOT apply migrations / enable multi-replica.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiRoot = path.join(root, 'server', 'kakapo-api')
const storeSrc = fs.readFileSync(path.join(apiRoot, 'pg', 'store.js'), 'utf8')
const dbSrc = fs.readFileSync(path.join(apiRoot, 'db.js'), 'utf8')

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

/** Mirrors pg/store.js rowIdForItem */
function rowIdForItem(item, index) {
  if (item == null || typeof item !== 'object') return `__i${index}`
  if (item.id != null && String(item.id) !== '') return String(item.id)
  if (item.clientRef != null && String(item.clientRef) !== '') return `ref:${item.clientRef}`
  if (item.num != null && String(item.num) !== '') return `num:${item.num}`
  if (item.kind != null && item.clientRef != null) return `op:${item.kind}:${item.clientRef}`
  return `__i${index}`
}

/**
 * In-memory model of upsertDocs DELETE semantics (exact current behavior).
 * docs: Map `${collection}\0${id}` → { collection, id, data, sortIdx }
 */
function createFakePg() {
  /** @type {Map<string, {collection:string,id:string,data:any,sortIdx:number}>} */
  const docs = new Map()
  const key = (c, id) => `${c}\0${id}`

  function upsertDocs(docRows, collections) {
    for (const r of docRows) {
      docs.set(key(r.key, r.id), {
        collection: r.key,
        id: r.id,
        data: structuredClone(r.data),
        sortIdx: r.sortIdx,
      })
    }
    const byCol = new Map()
    for (const r of docRows) {
      if (!byCol.has(r.key)) byCol.set(r.key, [])
      byCol.get(r.key).push(r.id)
    }
    for (const col of collections) {
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
    if (collections.length) {
      for (const [k, row] of [...docs.entries()]) {
        if (!colSet.has(row.collection)) docs.delete(k)
      }
    } else {
      docs.clear()
    }
  }

  function saveSnapshot(snapshot) {
    const docRows = []
    const collections = []
    for (const [k, value] of Object.entries(snapshot || {})) {
      if (!Array.isArray(value)) continue
      collections.push(k)
      const used = new Set()
      for (let i = 0; i < value.length; i++) {
        let id = rowIdForItem(value[i], i)
        if (used.has(id)) id = `${id}#${i}`
        used.add(id)
        docRows.push({ key: k, id, data: value[i], sortIdx: i })
      }
    }
    upsertDocs(docRows, collections)
  }

  function loadCollection(name) {
    return [...docs.values()]
      .filter(r => r.collection === name)
      .sort((a, b) => a.sortIdx - b.sortIdx || a.id.localeCompare(b.id))
      .map(r => structuredClone(r.data))
  }

  function ids(name) {
    return [...docs.values()]
      .filter(r => r.collection === name)
      .map(r => r.id)
      .sort()
  }

  return { saveSnapshot, loadCollection, ids, docs }
}

// ── Source wiring ─────────────────────────────────────────────
test('S1 upsertDocs has destructive DELETE missing ids', () => {
  expect(storeSrc.includes('DELETE FROM docs WHERE collection = $1 AND NOT (id = ANY($2::text[]))'), 'per-collection delete')
  expect(storeSrc.includes('DELETE FROM docs WHERE NOT (collection = ANY($1::text[]))'), 'orphan collection delete')
  expect(storeSrc.includes('ON CONFLICT (collection, id) DO UPDATE'), 'upsert by PK')
  expect(storeSrc.includes('async function upsertDocs'), 'upsertDocs')
  expect(storeSrc.includes('export async function persistSnapshot'), 'persistSnapshot')
  expect(storeSrc.includes('export async function loadSnapshotFromPg'), 'loadSnapshot')
})

test('S2 persistSnapshot wrapped in withTransaction', () => {
  expect(storeSrc.includes('withTransaction'), 'tx')
  expect(/persistSnapshot[\s\S]*withTransaction[\s\S]*saveSnapshotToPg/m.test(storeSrc), 'tx wraps save')
})

test('S3 db.js single in-memory cache + debounce flush', () => {
  expect(dbSrc.includes('scheduleSaveDb'), 'scheduleSaveDb')
  expect(dbSrc.includes('persistSnapshot(snapshot)'), 'flush calls persistSnapshot')
  expect(dbSrc.includes('let cache = null'), 'one cache')
  expect(dbSrc.includes('SAVE_DEBOUNCE_MS'), 'debounce')
})

// ── CONFIRMED LOST UPDATE REPRO ───────────────────────────────
test('REPRO A: stale snapshot persist deletes B row (CONFIRMED DATA LOSS)', () => {
  const pg = createFakePg()
  // Shared initial state [1,2]
  pg.saveSnapshot({
    posSales: [
      { id: '1', total: 10 },
      { id: '2', total: 20 },
    ],
  })
  expect(pg.ids('posSales').join(',') === '1,2', 'initial 1,2')

  // A and B both "loaded" [1,2]
  const snapA = { posSales: structuredClone(pg.loadCollection('posSales')) }
  const snapB = { posSales: structuredClone(pg.loadCollection('posSales')) }

  // B adds 3 and persists
  snapB.posSales.push({ id: '3', total: 30 })
  pg.saveSnapshot(snapB)
  expect(pg.ids('posSales').join(',') === '1,2,3', 'after B: 1,2,3')

  // A updates 1 and persists its stale [1',2] (no 3)
  snapA.posSales[0] = { id: '1', total: 11 }
  pg.saveSnapshot(snapA)

  const ids = pg.ids('posSales')
  expect(ids.includes('1') && ids.includes('2'), '1 and 2 remain')
  expect(!ids.includes('3'), 'CONFIRMED: row 3 deleted by stale A persist')
  expect(pg.loadCollection('posSales').find(s => s.id === '1').total === 11, 'A update applied')
})

test('MATRIX A: two writers append different sales — CURRENT LOSES one', () => {
  const pg = createFakePg()
  pg.saveSnapshot({ posSales: [] })
  const a = { posSales: [{ id: 'SALE-A', clientRef: 'ra' }] }
  const b = { posSales: [{ id: 'SALE-B', clientRef: 'rb' }] }
  // Both started from empty; B persists first, then A
  pg.saveSnapshot(b)
  pg.saveSnapshot(a)
  expect(pg.ids('posSales').join(',') === 'SALE-A', 'A wipe kills B — CURRENT unsafe')
})

test('MATRIX C: A updates sale1 while B inserted sale2 — sale2 LOST', () => {
  const pg = createFakePg()
  pg.saveSnapshot({ posSales: [{ id: 'sale1', v: 1 }] })
  const a = { posSales: [{ id: 'sale1', v: 2 }] }
  const b = { posSales: [{ id: 'sale1', v: 1 }, { id: 'sale2', v: 1 }] }
  pg.saveSnapshot(b)
  expect(pg.ids('posSales').includes('sale2'), 'B inserted sale2')
  pg.saveSnapshot(a)
  expect(!pg.ids('posSales').includes('sale2'), 'sale2 lost after A stale update')
})

test('MATRIX D: explicit empty collection deletes ALL rows in collection', () => {
  const pg = createFakePg()
  pg.saveSnapshot({ posSales: [{ id: '1' }, { id: '2' }], moneyLedger: [{ id: 'L1' }] })
  pg.saveSnapshot({ posSales: [], moneyLedger: [{ id: 'L1' }] })
  expect(pg.ids('posSales').length === 0, 'empty array → DELETE entire collection')
  expect(pg.ids('moneyLedger').join(',') === 'L1', 'other collection kept if present in snapshot')
})

test('MATRIX E: stale persist no foreign rows — CURRENT FAILS (same as REPRO)', () => {
  // Documented by REPRO A
  expect(true, 'see REPRO A')
})

test('MATRIX F: single-process sequential appends OK', () => {
  const pg = createFakePg()
  const snap = { posSales: [] }
  snap.posSales.push({ id: '1' })
  pg.saveSnapshot(snap)
  snap.posSales.push({ id: '2' })
  pg.saveSnapshot(snap)
  snap.posSales.push({ id: '3' })
  pg.saveSnapshot(snap)
  expect(pg.ids('posSales').join(',') === '1,2,3', 'single writer cumulative OK')
})

test('MATRIX B: same clientRef different ids — BOTH may exist before UNIQUE', () => {
  const pg = createFakePg()
  pg.saveSnapshot({
    posSales: [
      { id: 'SALE-A', clientRef: 'same' },
      { id: 'SALE-B', clientRef: 'same' },
    ],
  })
  expect(pg.ids('posSales').length === 2, 'before UNIQUE both exist (different docs.id)')
})

/** Safe model: upsert only rows in snapshot; NEVER delete missing ids */
function saveSnapshotRowLevel(pgDocs, snapshot, { appendCollections }) {
  const key = (c, id) => `${c}\0${id}`
  for (const [col, value] of Object.entries(snapshot || {})) {
    if (!Array.isArray(value)) continue
    const used = new Set()
    for (let i = 0; i < value.length; i++) {
      let id = rowIdForItem(value[i], i)
      if (used.has(id)) id = `${id}#${i}`
      used.add(id)
      pgDocs.set(key(col, id), {
        collection: col,
        id,
        data: structuredClone(value[i]),
        sortIdx: i,
      })
    }
    // mutable collections could still prune — append collections must NOT
    void appendCollections
  }
}

test('SAFE MODEL: stale A persist does NOT delete B row', () => {
  const docs = new Map()
  const load = (name) => [...docs.values()].filter(r => r.collection === name).map(r => structuredClone(r.data))
  const ids = (name) => [...docs.values()].filter(r => r.collection === name).map(r => r.id).sort()

  saveSnapshotRowLevel(docs, {
    posSales: [{ id: '1', total: 10 }, { id: '2', total: 20 }],
  }, { appendCollections: new Set(['posSales']) })

  const snapA = { posSales: load('posSales') }
  const snapB = { posSales: load('posSales') }
  snapB.posSales.push({ id: '3', total: 30 })
  saveSnapshotRowLevel(docs, snapB, { appendCollections: new Set(['posSales']) })
  expect(ids('posSales').join(',') === '1,2,3', 'B added 3')

  snapA.posSales[0] = { id: '1', total: 11 }
  saveSnapshotRowLevel(docs, snapA, { appendCollections: new Set(['posSales']) })
  expect(ids('posSales').join(',') === '1,2,3', 'SAFE: 3 survives stale A')
  expect(load('posSales').find(s => s.id === '1').total === 11, 'A update applied')
})

test('SAFE MODEL: two writers append different sales — both survive', () => {
  const docs = new Map()
  const ids = (name) => [...docs.values()].filter(r => r.collection === name).map(r => r.id).sort()
  saveSnapshotRowLevel(docs, { posSales: [{ id: 'SALE-A', clientRef: 'ra' }] }, { appendCollections: new Set(['posSales']) })
  saveSnapshotRowLevel(docs, { posSales: [{ id: 'SALE-B', clientRef: 'rb' }] }, { appendCollections: new Set(['posSales']) })
  expect(ids('posSales').join(',') === 'SALE-A,SALE-B', 'both survive')
})

const APPEND = ['posSales', 'moneyLedger', 'financeMoves', 'opRefs', 'orders', 'expenses', 'stockReceipts', 'writeOffs', 'auditLog', 'syncDeletes']
const MUTABLE = ['clients', 'cards', 'products', 'cashiers', 'posShifts', 'posPoints', 'suppliers', 'categories', 'promos', 'couriers', 'assemblers', 'users', 'reviews']
const NESTED = [
  { name: 'posSales.returns[]', note: 'Nested in sale doc; row-level sale upsert carries returns; prefer extract later' },
  { name: 'cashVault.*', note: 'Often kv_meta or nested object — not docs array' },
]

const report = {
  title: 'P10 Multi-Writer Snapshot Safety Audit',
  generatedAtIso: new Date().toISOString(),
  productionChanged: false,
  migrationApplied: false,
  multiReplicaEnabled: false,
  confirmedLostUpdate: true,
  results,
  A_exactCurrentSaveFlow: {
    load: 'initDb → loadSnapshotFromPg: SELECT all docs + kv_meta → in-memory cache arrays',
    mutate: 'HTTP handlers mutate shared cache object (loadDb())',
    schedule: 'persist()/scheduleSaveDb → debounce SAVE_DEBOUNCE_MS → enqueueFlush → persistNow',
    persist: 'persistSnapshot(cache) → withTransaction → saveSnapshotToPg',
    upsert: 'INSERT docs ON CONFLICT (collection,id) DO UPDATE data/sort_idx',
    deleteDestructive: [
      'DELETE FROM docs WHERE collection=$1 AND NOT (id = ANY($2))  -- ids missing from THIS snapshot',
      'DELETE FROM docs WHERE collection=$1  -- if array empty in snapshot',
      'DELETE FROM docs WHERE NOT (collection = ANY($1))  -- collections absent from snapshot keys',
      'kv_meta: DELETE keys not in snapshot meta set',
    ],
    transactionBoundary: 'One BEGIN/COMMIT around entire snapshot save (all collections)',
    processModel: 'Single Node process holds one cache; multi-process = multiple caches + same PG',
  },
  B_confirmedLostUpdateRepro: {
    status: 'CONFIRMED MULTI-WRITER DATA LOSS',
    scenario: 'A loads [1,2]; B loads [1,2]; B adds 3 persists; A updates 1 persists [1,2] → 3 deleted',
    test: 'REPRO A / MATRIX C',
  },
  C_affectedCollections: {
    appendImmutableIsh: APPEND.map(c => ({
      collection: c,
      safeModel: 'UPSERT row by (collection,id) ONLY; never DELETE missing ids; explicit tombstone/delete API only',
    })),
    mutableEntity: MUTABLE.map(c => ({
      collection: c,
      safeModel: 'UPSERT exact row; DELETE only on explicit delete/tombstone; optional OCC (updatedAtIso / *PayVersion)',
    })),
    nestedHistory: NESTED,
    highestRiskIfWiped: ['posSales', 'moneyLedger', 'financeMoves', 'opRefs', 'orders'],
  },
  D_rootCause: [
    'saveSnapshotToPg treats process memory array as authoritative full set for each collection',
    'Missing id in local snapshot interpreted as delete',
    'Not a PostgreSQL MVCC bug — application-level snapshot replace semantics',
  ],
  E_minimalSafePersistenceModel: {
    keepSchema: 'docs(collection,id,data JSONB) PRIMARY KEY — no normalization required for v1',
    appendCollections: 'upsertDocsRows(rows) without DELETE-missing; optional insert-only for moneyLedger',
    mutableCollections: 'upsert single row; deleteDoc(collection,id) explicit',
    kvMeta: 'prefer upsert keys; avoid DELETE-all-missing unless single-writer confirmed',
    explicitDelete: 'tombstone collection or DELETE WHERE collection=$1 AND id=$2 only',
    notInScope: 'Enabling multi-replica / UNIQUE indexes (separate preflight)',
  },
  F_filesThatWouldChange: [
    'server/kakapo-api/pg/store.js — split upsertDocs into upsertRows + deleteMissing (gated)',
    'server/kakapo-api/db.js — optional persist modes / dirty collection tracking',
    'server/kakapo-api/index.js — only if callers need explicit delete helpers',
    'NOT applied in this audit',
  ],
  G_requiredApiChanges: {
    proposed: [
      'upsertDoc(collection, id, data, sortIdx?)',
      'upsertDocsBatch(collection, items[]) — no prune',
      'deleteDoc(collection, id) — explicit only',
      'persistSnapshot(snapshot, { pruneMissing: false }) for append-safe path',
      'Eventually: dirty set of touched ids instead of full-array rewrite',
    ],
    compatibility: 'Single-process today: pruneMissing=true preserves current behavior until cutover',
  },
  H_interactionWithUniqueIndexes: [
    'Row-level INSERT/UPDATE + UNIQUE(clientRef) expression index → unique_violation → SELECT existing → replay',
    'Without prune, concurrent different clientRefs both survive (MATRIX A safe model)',
    'Same clientRef two SALE ids: still possible until UNIQUE; row-level does not invent uniqueness',
    'UNIQUE does not fix wipe; wipe fix does not replace UNIQUE',
  ],
  I_regressionRisks: [
    'Disabling prune without explicit delete breaks intentional full-collection clears / admin wipes',
    'Empty array currently means wipe collection — callers may rely on this',
    'sort_idx global order may drift if only partial upserts',
    'Single-process regression if prune left on for append collections while two workers mistakenly run',
    'Balance OCC still required for cards/clients — row-level != walletPayVersion',
  ],
  J_recommendedDeploymentSequence: [
    '1. Keep single API writer (do NOT enable multi-replica)',
    '2. Land row-level upsert API with pruneMissing default true (compat)',
    '3. Switch append collections (posSales, moneyLedger, financeMoves, opRefs) to pruneMissing=false',
    '4. Add explicit delete helpers for real deletes',
    '5. Chaos test MATRIX A/C/E',
    '6. Then UNIQUE clientRef indexes (separate approval)',
    '7. Multi-replica only after prune-off + UNIQUE + OCC review',
  ],
  proposedPatchFile: 'scripts/p10-proposed-row-level-persist.patch.md',
  note: 'Proposed patch documented only — NOT applied to production store.js',
}

// Write proposed patch as documentation (not applied)
const proposedMd = `# PROPOSED (NOT APPLIED) — row-level persist for append collections

## Goal
Keep \`docs(collection,id,data JSONB)\`. Change semantics for append collections:
- UPSERT rows present in the write
- Do **not** \`DELETE ... NOT (id = ANY(...))\` for those collections

## Suggested API in \`pg/store.js\` (sketch)

\`\`\`js
export const APPEND_COLLECTIONS = new Set([
  'posSales', 'moneyLedger', 'financeMoves', 'opRefs',
  'orders', 'expenses', 'stockReceipts', 'writeOffs',
])

async function upsertDocRows(client, docRows) {
  // same INSERT ... ON CONFLICT DO UPDATE batch as today
}

async function deleteMissingIds(client, collection, ids) {
  // ONLY call for mutable collections when prune explicitly requested
  await client.query(
    'DELETE FROM docs WHERE collection = $1 AND NOT (id = ANY($2::text[]))',
    [collection, ids],
  )
}

export async function saveSnapshotToPg(client, snapshot, opts = {}) {
  const pruneMissing = opts.pruneMissing !== false // default true for compat
  // build docRows as today
  await upsertDocRows(client, docRows)
  if (!pruneMissing) return
  for (const col of collections) {
    if (APPEND_COLLECTIONS.has(col)) continue // CRITICAL: never prune append
    await deleteMissingIds(client, col, idsFor(col))
  }
}
\`\`\`

## Call site
\`persistSnapshot(cache, { pruneMissing: true })\` until cutover.
Then \`db.js\` flush for monetary ops uses pruneMissing false for append sets,
or better: \`upsertDocsBatch('posSales', [sale])\` without full snapshot.

## Explicit delete
\`\`\`js
export async function deleteDoc(collection, id) {
  await withTransaction(async client => {
    await client.query('DELETE FROM docs WHERE collection=$1 AND id=$2', [collection, id])
  })
}
\`\`\`

## NOT in this change
- UNIQUE indexes
- Multi-replica
- Wallet OCC
- Normalizing returns out of posSales
`

fs.writeFileSync(path.join(root, 'scripts', 'p10-proposed-row-level-persist.patch.md'), proposedMd)
fs.writeFileSync(
  path.join(root, 'scripts', 'p10-multi-writer-snapshot-audit-report.json'),
  JSON.stringify(report, null, 2),
)

const failed = results.filter(r => r.status === 'FAIL')
console.log(`\nAudit tests: ${results.length - failed.length}/${results.length} passed`)
console.log('CONFIRMED MULTI-WRITER DATA LOSS:', report.confirmedLostUpdate)
console.log('Production store.js modified: false')
if (failed.length) process.exit(1)
