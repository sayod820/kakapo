/**
 * P10-MP-RACE — DB idempotency PREFLIGHT (read-only).
 * Run: node scripts/p10-mp-race-db-preflight.mjs
 *
 * Does NOT apply migrations.
 * If DATABASE_URL is set — runs duplicate audit SELECTs only.
 * Otherwise records schema analysis + SQL for ops to run manually.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiRoot = path.join(root, 'server', 'kakapo-api')
const schemaSql = fs.readFileSync(path.join(apiRoot, 'pg', 'schema.sql'), 'utf8')
const storeSrc = fs.readFileSync(path.join(apiRoot, 'pg', 'store.js'), 'utf8')

const AUDIT_SQL = {
  collections: `
SELECT collection, COUNT(*)::int AS n
FROM docs
GROUP BY collection
ORDER BY collection;`,

  posSales_dup_clientRef: `
SELECT data->>'clientRef' AS client_ref,
       COUNT(*)::int AS n,
       array_agg(id ORDER BY id) AS doc_ids
FROM docs
WHERE collection = 'posSales'
  AND NULLIF(BTRIM(data->>'clientRef'), '') IS NOT NULL
GROUP BY data->>'clientRef'
HAVING COUNT(*) > 1
ORDER BY n DESC, client_ref
LIMIT 200;`,

  moneyLedger_dup_clientRef_type: `
SELECT data->>'clientRef' AS client_ref,
       data->>'type' AS ledger_type,
       COUNT(*)::int AS n,
       array_agg(id ORDER BY id) AS doc_ids
FROM docs
WHERE collection = 'moneyLedger'
  AND NULLIF(BTRIM(data->>'clientRef'), '') IS NOT NULL
GROUP BY data->>'clientRef', data->>'type'
HAVING COUNT(*) > 1
ORDER BY n DESC, client_ref, ledger_type
LIMIT 200;`,

  opRefs_dup_kind_clientRef: `
SELECT data->>'kind' AS op_kind,
       data->>'clientRef' AS client_ref,
       COUNT(*)::int AS n,
       array_agg(id ORDER BY id) AS doc_ids
FROM docs
WHERE collection = 'opRefs'
  AND NULLIF(BTRIM(data->>'clientRef'), '') IS NOT NULL
GROUP BY data->>'kind', data->>'clientRef'
HAVING COUNT(*) > 1
ORDER BY n DESC, op_kind, client_ref
LIMIT 200;`,

  financeMoves_dup_clientRef: `
SELECT data->>'clientRef' AS client_ref,
       COUNT(*)::int AS n,
       array_agg(id ORDER BY id) AS doc_ids
FROM docs
WHERE collection = 'financeMoves'
  AND NULLIF(BTRIM(data->>'clientRef'), '') IS NOT NULL
GROUP BY data->>'clientRef'
HAVING COUNT(*) > 1
ORDER BY n DESC, client_ref
LIMIT 200;`,

  return_dup_clientRef: `
SELECT r.elem->>'clientRef' AS return_client_ref,
       COUNT(*)::int AS n,
       array_agg(d.id ORDER BY d.id) AS sale_doc_ids
FROM docs d
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(d.data->'returns') = 'array' THEN d.data->'returns' ELSE '[]'::jsonb END
) AS r(elem)
WHERE d.collection = 'posSales'
  AND NULLIF(BTRIM(r.elem->>'clientRef'), '') IS NOT NULL
GROUP BY r.elem->>'clientRef'
HAVING COUNT(*) > 1
ORDER BY n DESC, return_client_ref
LIMIT 200;`,

  debt_repay_ledger_dup: `
SELECT data->>'clientRef' AS client_ref,
       COUNT(*)::int AS n,
       array_agg(id ORDER BY id) AS doc_ids
FROM docs
WHERE collection = 'moneyLedger'
  AND data->>'refType' = 'debt_repay'
  AND NULLIF(BTRIM(data->>'clientRef'), '') IS NOT NULL
GROUP BY data->>'clientRef'
HAVING COUNT(*) > 1
ORDER BY n DESC, client_ref
LIMIT 200;`,

  empty_clientRef_counts: `
SELECT collection,
       COUNT(*) FILTER (WHERE NULLIF(BTRIM(data->>'clientRef'), '') IS NULL)::int AS missing_client_ref,
       COUNT(*)::int AS total
FROM docs
WHERE collection IN ('posSales','moneyLedger','financeMoves','opRefs')
GROUP BY collection
ORDER BY collection;`,

  sample_row_ids: `
SELECT collection, id,
       data->>'clientRef' AS client_ref,
       data->>'kind' AS kind,
       data->>'type' AS type,
       data->>'refType' AS ref_type
FROM docs
WHERE collection IN ('posSales','moneyLedger','financeMoves','opRefs')
ORDER BY collection, updated_at DESC NULLS LAST
LIMIT 40;`,
}

const PROPOSED_SQL = {
  note: 'NOT APPLIED — for review only. Prefer CONCURRENTLY on live DB.',
  precheck_duplicates: Object.keys(AUDIT_SQL).filter(k => k.includes('dup')),
  indexes: [
    {
      name: 'uq_docs_possales_client_ref',
      effect: 'sale',
      sql: `
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_docs_possales_client_ref
ON docs ((NULLIF(BTRIM(data->>'clientRef'), '')))
WHERE collection = 'posSales'
  AND NULLIF(BTRIM(data->>'clientRef'), '') IS NOT NULL;`,
    },
    {
      name: 'uq_docs_moneyledger_client_ref_type',
      effect: 'ledger component',
      sql: `
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_docs_moneyledger_client_ref_type
ON docs (
  (NULLIF(BTRIM(data->>'clientRef'), '')),
  (COALESCE(data->>'type', ''))
)
WHERE collection = 'moneyLedger'
  AND NULLIF(BTRIM(data->>'clientRef'), '') IS NOT NULL;`,
    },
    {
      name: 'uq_docs_financemoves_client_ref',
      effect: 'finance move / topup',
      sql: `
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_docs_financemoves_client_ref
ON docs ((NULLIF(BTRIM(data->>'clientRef'), '')))
WHERE collection = 'financeMoves'
  AND NULLIF(BTRIM(data->>'clientRef'), '') IS NOT NULL;`,
    },
    {
      name: 'uq_docs_oprefs_kind_client_ref',
      effect: 'opRef',
      sql: `
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_docs_oprefs_kind_client_ref
ON docs (
  (COALESCE(data->>'kind', '')),
  (NULLIF(BTRIM(data->>'clientRef'), ''))
)
WHERE collection = 'opRefs'
  AND NULLIF(BTRIM(data->>'clientRef'), '') IS NOT NULL;`,
    },
  ],
  returns_note:
    'Nested returns[] cannot take a simple UNIQUE across sales without denormalization. '
    + 'Option A (preferred): new collection posSaleReturns with docs.id = clientRef or UNIQUE(data->>clientRef). '
    + 'Option B: generated column / trigger expanding returns — heavier.',
  rollback: [
    'DROP INDEX CONCURRENTLY IF EXISTS uq_docs_possales_client_ref;',
    'DROP INDEX CONCURRENTLY IF EXISTS uq_docs_moneyledger_client_ref_type;',
    'DROP INDEX CONCURRENTLY IF EXISTS uq_docs_financemoves_client_ref;',
    'DROP INDEX CONCURRENTLY IF EXISTS uq_docs_oprefs_kind_client_ref;',
  ],
}

function analyzeSchema() {
  return {
    relationalTables: [
      {
        table: 'kv_meta',
        columns: ['key TEXT PK', 'value JSONB', 'updated_at TIMESTAMPTZ'],
        holds: 'Non-array snapshot keys (settings blobs, sequences, etc.)',
      },
      {
        table: 'docs',
        columns: [
          'collection TEXT',
          'id TEXT',
          'data JSONB',
          'sort_idx INTEGER',
          'updated_at TIMESTAMPTZ',
          'PRIMARY KEY (collection, id)',
        ],
        holds: 'ALL array collections: posSales, moneyLedger, financeMoves, opRefs, orders, ...',
      },
      {
        table: 'schema_meta',
        columns: ['key TEXT PK', 'value TEXT'],
        holds: 'schema version marker only',
      },
    ],
    noDedicatedTables: [
      'posSales', 'opRefs', 'moneyLedger', 'financeMoves',
      'returns (nested)', 'debt repayment',
    ],
    docsIdStrategy: {
      source: 'pg/store.js rowIdForItem()',
      rules: [
        'item.id → docs.id (posSales use SALE-... random id — NOT clientRef)',
        'else item.clientRef → docs.id = ref:{clientRef}',
        'else item.num → num:{num}',
        'else kind+clientRef → op:{kind}:{clientRef} (opRefs)',
        'else __i{index}; collisions get #{index} suffix',
      ],
      implication:
        'PRIMARY KEY (collection, id) does NOT enforce UNIQUE(clientRef) for posSales, '
        + 'because docs.id is sale.id, while clientRef lives only in data JSONB.',
    },
    jsonFields: {
      posSales: {
        collection: 'posSales',
        relational: ['collection', 'id (=sale.id)', 'sort_idx', 'updated_at'],
        inDataJsonb: [
          'clientRef', 'number', 'paidCash', 'paidCard', 'paidWallet', 'debtAdded',
          'bonusSpent', 'paymentMethod', 'items', 'returns[]', 'status', 'and more',
        ],
        returns: 'Nested array data.returns[].clientRef - not a separate docs row',
      },
      moneyLedger: {
        collection: 'moneyLedger',
        relational: ['collection', 'id (=LED-...)', 'sort_idx', 'updated_at'],
        inDataJsonb: ['clientRef', 'type', 'amount', 'direction', 'refType', 'refId', 'meta'],
      },
      financeMoves: {
        collection: 'financeMoves',
        relational: ['collection', 'id (=FIN-... or ref:clientRef if no id)', 'sort_idx', 'updated_at'],
        inDataJsonb: ['clientRef', 'type', 'amount', 'refType', 'cardNum'],
      },
      opRefs: {
        collection: 'opRefs',
        relational: ['collection', 'id often op:{kind}:{clientRef}', 'sort_idx', 'updated_at'],
        inDataJsonb: ['kind', 'clientRef', 'result', 'createdAtIso'],
        note: 'docs.id often encodes kind+clientRef, but duplicate JSON rows can still exist with #{i} suffix if array had dups before save.',
      },
      debtRepay: {
        storage: [
          'opRefs where kind=debt_repay',
          'moneyLedger where refType=debt_repay (+ clientRef in data)',
          'card/client debt fields in cards/clients collections — not a separate repay ledger table',
        ],
      },
    },
    schemaFile: 'server/kakapo-api/pg/schema.sql',
    schemaSqlExcerpt: schemaSql.trim(),
    storeHasFullSnapshotDelete: storeSrc.includes('DELETE FROM docs WHERE collection') && storeSrc.includes('NOT (id = ANY'),
  }
}

async function runPgAudit() {
  const url = String(process.env.DATABASE_URL || '').trim()
  if (!url) {
    return {
      status: 'SKIPPED',
      reason: 'DATABASE_URL not set in this environment',
      note: 'Run the same script with DATABASE_URL to execute read-only SELECTs against production/staging.',
    }
  }
  const { withClient } = await import(pathToFileURL(path.join(apiRoot, 'pg', 'client.js')).href)
  const out = { status: 'OK', queries: {} }
  await withClient(async (client) => {
    // read-only: SET TRANSACTION READ ONLY if supported
    try { await client.query('BEGIN READ ONLY') } catch { await client.query('BEGIN') }
    try {
      for (const [name, sql] of Object.entries(AUDIT_SQL)) {
        const res = await client.query(sql)
        out.queries[name] = {
          rowCount: res.rowCount,
          rows: res.rows,
        }
      }
      await client.query('COMMIT')
    } catch (e) {
      try { await client.query('ROLLBACK') } catch { /* ignore */ }
      throw e
    }
  })
  return out
}

function summarizeAudit(audit) {
  if (audit.status !== 'OK') return { status: audit.status, reason: audit.reason }
  const q = audit.queries
  const count = (name) => (q[name]?.rows || []).length
  return {
    status: 'OK',
    duplicateGroups: {
      posSales_clientRef: count('posSales_dup_clientRef'),
      moneyLedger_clientRef_type: count('moneyLedger_dup_clientRef_type'),
      opRefs_kind_clientRef: count('opRefs_dup_kind_clientRef'),
      financeMoves_clientRef: count('financeMoves_dup_clientRef'),
      return_clientRef: count('return_dup_clientRef'),
      debt_repay_ledger_clientRef: count('debt_repay_ledger_dup'),
    },
    blockingUniques: {
      posSales: count('posSales_dup_clientRef') === 0,
      moneyLedger: count('moneyLedger_dup_clientRef_type') === 0,
      opRefs: count('opRefs_dup_kind_clientRef') === 0,
      financeMoves: count('financeMoves_dup_clientRef') === 0,
      returns: count('return_dup_clientRef') === 0,
      debtRepayLedger: count('debt_repay_ledger_dup') === 0,
    },
  }
}

const schema = analyzeSchema()
const audit = await runPgAudit().catch(e => ({
  status: 'ERROR',
  reason: String(e?.message || e),
}))
const auditSummary = summarizeAudit(audit)

const report = {
  title: 'P10-MP-RACE DB Idempotency Preflight',
  generatedAtIso: new Date().toISOString(),
  migrationApplied: false,
  A_currentSchema: schema,
  B_currentToctou: {
    appLevel: [
      'POST /pos/sales: find posSales by clientRef in memory → createPosSale with new SALE-id',
      'Two API processes load snapshot → both find miss → both insert different docs.id, same data.clientRef',
      'PRIMARY KEY (collection, id) allows both rows',
    ],
    persistLevel: [
      'saveSnapshotToPg upserts by (collection, id) then DELETEs docs whose id not in this process snapshot',
      'Multi-replica last-writer-wins can wipe the other process sales — broader than clientRef dup',
      'UNIQUE(clientRef) alone does not fix snapshot wipe; needs single-writer or row-level writes',
    ],
    opRefsPartial: [
      'opRefs often get docs.id = op:{kind}:{clientRef} → PK collision on persist helps opRef row',
      'Does NOT prevent two posSales rows with different SALE ids',
    ],
  },
  C_duplicateDataAudit: {
    summary: auditSummary,
    raw: audit.status === 'OK' ? { collections: audit.queries.collections, dups: {
      posSales: audit.queries.posSales_dup_clientRef,
      moneyLedger: audit.queries.moneyLedger_dup_clientRef_type,
      opRefs: audit.queries.opRefs_dup_kind_clientRef,
      financeMoves: audit.queries.financeMoves_dup_clientRef,
      returns: audit.queries.return_dup_clientRef,
      debtRepay: audit.queries.debt_repay_ledger_dup,
      emptyClientRef: audit.queries.empty_clientRef_counts,
    } } : audit,
    auditSql: AUDIT_SQL,
  },
  D_proposedInvariants: [
    { effect: 'sale', invariant: "UNIQUE NULLIF(BTRIM(data->>'clientRef'),'') WHERE collection='posSales'" },
    { effect: 'money ledger component', invariant: "UNIQUE (clientRef, type) WHERE collection='moneyLedger' AND clientRef present" },
    { effect: 'financeMove / topup', invariant: "UNIQUE clientRef WHERE collection='financeMoves'" },
    { effect: 'opRef', invariant: "UNIQUE (kind, clientRef) WHERE collection='opRefs'" },
    { effect: 'debt repay ledger', invariant: 'Covered by moneyLedger (clientRef,type) and/or opRefs(kind,clientRef)' },
    { effect: 'sale_return', invariant: 'Denormalize to posSaleReturns + UNIQUE(clientRef) — nested returns[] cannot UNIQUE cleanly' },
  ],
  E_proposedSql: PROPOSED_SQL,
  F_applicationChangesRequired: [
    'Do not rely on find()-then-insert alone after UNIQUE exists.',
    'Preferred persist path for idempotent ops: INSERT ... ON CONFLICT on the expression unique → SELECT existing → return replay.',
    'In-memory createPosSale: on unique_violation when flushing, reload sale by clientRef and mark _idempotentReplay.',
    'Critical: multi-process full-snapshot DELETE is unsafe — move monetary writes to row-level upsert OR enforce single API writer (leader election / one replica).',
    'Returns: extract to collection before UNIQUE, or accept app-level-only for nested returns short-term.',
    'Legacy rows with empty clientRef stay unconstrained (partial index) — OK for old online sales.',
    'Before CREATE UNIQUE INDEX: resolve duplicate groups from audit (manual merge / keep oldest).',
  ],
  G_deploymentOrder: [
    '1. PRECHECK: run audit SELECTs on staging then prod (read-only).',
    '2. If duplicate groups > 0: data repair playbook (keep canonical sale/ledger, re-link, delete dup docs) — separate approval.',
    '3. Deploy app that handles unique_violation as idempotent replay (compatible with or without index).',
    '4. CREATE UNIQUE INDEX CONCURRENTLY (one index at a time; monitor locks).',
    '5. Verify: re-run audit (0 dups); chaos: two workers same clientRef → one sale.',
    '6. Only then consider enabling multi-replica; until snapshot wipe fixed, prefer single writer.',
  ],
  H_rollback: {
    indexes: PROPOSED_SQL.rollback,
    app: 'Keep find()+replay path; unique_violation handler can remain harmless.',
    data: 'Index drop does not delete business rows.',
  },
  I_risks: [
    'CREATE UNIQUE INDEX fails if audit finds duplicates — must clean first.',
    'CONCURRENTLY cannot run inside a transaction block.',
    'Partial indexes ignore NULL/empty clientRef — unprotected legacy paths.',
    'Nested returns UNIQUE requires schema change (new collection).',
    'Full-snapshot multi-writer wipe remains HIGH even after UNIQUE(clientRef).',
    'Expression indexes add write CPU; monitor persist latency.',
    'rowIdForItem ref: collision + #{i} suffix can still create duplicate logical clientRefs under different docs.id — UNIQUE expression on data->>clientRef is the real guard.',
  ],
}

const outPath = path.join(root, 'scripts', 'p10-mp-race-db-preflight-report.json')
fs.writeFileSync(outPath, JSON.stringify(report, null, 2))

console.log('P10-MP-RACE DB preflight (migration NOT applied)')
console.log(`Schema: docs JSONB document store — no relational posSales/opRefs/ledger tables`)
console.log(`Audit: ${auditSummary.status}${auditSummary.reason ? ' — ' + auditSummary.reason : ''}`)
if (auditSummary.duplicateGroups) {
  console.log('Duplicate groups:', JSON.stringify(auditSummary.duplicateGroups))
  console.log('Safe for UNIQUE now?:', JSON.stringify(auditSummary.blockingUniques))
}
console.log(`Report: ${outPath}`)
