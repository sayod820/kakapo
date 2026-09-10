/**
 * FIX D — live read-only duplicate audit + index inventory.
 * Does NOT apply migrations. Does NOT mutate data.
 *
 * Usage:
 *   set DATABASE_URL=... && node scripts/fixd-unique-audit.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiRoot = path.join(root, 'server', 'kakapo-api')
const outPath = path.join(root, 'scripts', 'fixd-unique-audit-report.json')
const require = createRequire(path.join(apiRoot, 'package.json'))
const pg = require('pg')

const INDEX_NAMES = [
  'uq_docs_possales_client_ref',
  'uq_docs_moneyledger_client_ref_type',
  'uq_docs_financemoves_client_ref',
  'uq_docs_oprefs_kind_client_ref',
]

function loadUrlFromFiles() {
  if (String(process.env.DATABASE_URL || '').trim()) return String(process.env.DATABASE_URL).trim()
  const candidates = [
    path.join(root, 'server', 'kakapo-api', '.env'),
    path.join(root, '.env.local'),
    path.join(root, '.env'),
    path.join(root, 'deploy', 'hetzner', '.env'),
  ]
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/)
      if (!m) continue
      const v = m[1].trim().replace(/^['"]|['"]$/g, '')
      if (v && !/^(your|change|xxx|placeholder)/i.test(v)) return v
    }
  }
  return ''
}

const COUNTS_SQL = `
SELECT collection,
  COUNT(*)::int AS total_rows,
  COUNT(*) FILTER (
    WHERE NULLIF(BTRIM(data->>'clientRef'), '') IS NOT NULL
  )::int AS rows_with_valid_client_ref,
  COUNT(*) FILTER (
    WHERE data->>'clientRef' IS NULL
  )::int AS null_client_ref,
  COUNT(*) FILTER (
    WHERE data->>'clientRef' IS NOT NULL AND BTRIM(data->>'clientRef') = ''
  )::int AS empty_or_whitespace_client_ref
FROM docs
WHERE collection IN ('posSales','moneyLedger','financeMoves','opRefs')
GROUP BY collection
ORDER BY collection;
`

const DUP_SQL = {
  posSales_clientRef: `
SELECT NULLIF(BTRIM(data->>'clientRef'), '') AS client_ref,
       COUNT(*)::int AS n,
       array_agg(id ORDER BY id) AS doc_ids
FROM docs
WHERE collection = 'posSales'
  AND NULLIF(BTRIM(data->>'clientRef'), '') IS NOT NULL
GROUP BY 1
HAVING COUNT(*) > 1
ORDER BY n DESC, client_ref
LIMIT 200;`,

  moneyLedger_clientRef_type: `
SELECT NULLIF(BTRIM(data->>'clientRef'), '') AS client_ref,
       COALESCE(data->>'type','') AS ledger_type,
       COUNT(*)::int AS n,
       array_agg(id ORDER BY id) AS doc_ids
FROM docs
WHERE collection = 'moneyLedger'
  AND NULLIF(BTRIM(data->>'clientRef'), '') IS NOT NULL
GROUP BY 1, 2
HAVING COUNT(*) > 1
ORDER BY n DESC, client_ref, ledger_type
LIMIT 200;`,

  financeMoves_clientRef: `
SELECT NULLIF(BTRIM(data->>'clientRef'), '') AS client_ref,
       COUNT(*)::int AS n,
       array_agg(id ORDER BY id) AS doc_ids
FROM docs
WHERE collection = 'financeMoves'
  AND NULLIF(BTRIM(data->>'clientRef'), '') IS NOT NULL
GROUP BY 1
HAVING COUNT(*) > 1
ORDER BY n DESC, client_ref
LIMIT 200;`,

  opRefs_kind_clientRef: `
SELECT COALESCE(data->>'kind','') AS op_kind,
       NULLIF(BTRIM(data->>'clientRef'), '') AS client_ref,
       COUNT(*)::int AS n,
       array_agg(id ORDER BY id) AS doc_ids
FROM docs
WHERE collection = 'opRefs'
  AND NULLIF(BTRIM(data->>'clientRef'), '') IS NOT NULL
GROUP BY 1, 2
HAVING COUNT(*) > 1
ORDER BY n DESC, op_kind, client_ref
LIMIT 200;`,
}

const INDEXES_SQL = `
SELECT i.relname AS index_name,
       ix.indisunique,
       ix.indisvalid,
       ix.indisready,
       ix.indisprimary,
       pg_get_indexdef(ix.indexrelid) AS index_def
FROM pg_index ix
JOIN pg_class t ON t.oid = ix.indrelid
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public' AND t.relname = 'docs'
ORDER BY i.relname;
`

async function main() {
  const url = loadUrlFromFiles()
  const report = {
    title: 'FIX D — Live Unique Audit (read-only)',
    generatedAtIso: new Date().toISOString(),
    migrationApplied: false,
    databaseUrlPresent: Boolean(url),
    stopReason: null,
    counts: null,
    duplicates: null,
    indexes: null,
    proposedIndexNames: INDEX_NAMES,
    nameConflicts: null,
    migrationAllowed: false,
  }

  if (!url) {
    report.stopReason = 'DATABASE_URL unavailable — migration NOT applied'
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
    console.log('STOP: DATABASE_URL unavailable')
    console.log(`Report: ${outPath}`)
    process.exitCode = 2
    return
  }

  // mask host for log only
  let hostHint = 'unknown'
  try {
    hostHint = new URL(url.replace(/^postgresql:/, 'http:')).host
  } catch { /* ignore */ }
  console.log(`Connecting (read-only) host=${hostHint}`)

  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 12000,
    statement_timeout: 60000,
  })

  try {
    await client.connect()
    await client.query('BEGIN READ ONLY')

    const countsRes = await client.query(COUNTS_SQL)
    report.counts = countsRes.rows

    const duplicates = {}
    let totalDupGroups = 0
    let totalDupRows = 0
    for (const [name, sql] of Object.entries(DUP_SQL)) {
      const res = await client.query(sql)
      const groups = res.rows
      const extraRows = groups.reduce((s, g) => s + Math.max(0, Number(g.n) - 1), 0)
      duplicates[name] = {
        duplicateGroups: groups.length,
        duplicateExtraRows: extraRows,
        rows: groups,
      }
      totalDupGroups += groups.length
      totalDupRows += groups.reduce((s, g) => s + Number(g.n), 0)
    }
    report.duplicates = {
      summary: { totalDupGroups, totalDupRows },
      details: duplicates,
    }

    const idxRes = await client.query(INDEXES_SQL)
    report.indexes = idxRes.rows
    const existingNames = new Set(idxRes.rows.map(r => r.index_name))
    report.nameConflicts = INDEX_NAMES.map(name => ({
      name,
      alreadyExists: existingNames.has(name),
      equivalentUniqueLikely: idxRes.rows.some(r =>
        r.indisunique && String(r.index_def || '').includes(name.replace('uq_docs_', '')),
      ),
    }))

    // also detect equivalent expression uniques by def substring
    report.equivalentUniques = {
      posSales: idxRes.rows.filter(r =>
        r.indisunique && /posSales/i.test(r.index_def) && /clientRef/i.test(r.index_def),
      ),
      moneyLedger: idxRes.rows.filter(r =>
        r.indisunique && /moneyLedger/i.test(r.index_def) && /clientRef/i.test(r.index_def),
      ),
      financeMoves: idxRes.rows.filter(r =>
        r.indisunique && /financeMoves/i.test(r.index_def) && /clientRef/i.test(r.index_def),
      ),
      opRefs: idxRes.rows.filter(r =>
        r.indisunique && /opRefs/i.test(r.index_def) && /clientRef/i.test(r.index_def),
      ),
    }

    await client.query('COMMIT')

    if (totalDupGroups > 0) {
      report.stopReason = `duplicate groups = ${totalDupGroups} — migration NOT applied; no auto-repair`
      report.migrationAllowed = false
      report.repairPlan = {
        policy: 'Do NOT auto-delete. Manual keep-oldest / re-link per group.',
        steps: [
          'For each duplicate group: choose canonical docs.id (prefer earliest updated_at / business number).',
          'Re-point any foreign refs (orders.posSaleId, ledger.refId) to canonical id if needed.',
          'DELETE only non-canonical docs rows after explicit ops approval.',
          'Re-run this audit until totalDupGroups = 0.',
          'Then deploy 23505 handlers, then CREATE INDEX CONCURRENTLY one-by-one.',
        ],
      }
    } else {
      report.migrationAllowed = true
      report.stopReason = null
    }
  } catch (e) {
    try { await client.query('ROLLBACK') } catch { /* ignore */ }
    report.stopReason = `audit error: ${String(e?.message || e).slice(0, 300)}`
    report.migrationAllowed = false
    process.exitCode = 3
  } finally {
    try { await client.end() } catch { /* ignore */ }
  }

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({
    databaseUrlPresent: report.databaseUrlPresent,
    migrationAllowed: report.migrationAllowed,
    stopReason: report.stopReason,
    counts: report.counts,
    dupSummary: report.duplicates?.summary,
    indexCount: report.indexes?.length,
    nameConflicts: report.nameConflicts,
  }, null, 2))
  console.log(`Report: ${outPath}`)
  if (!report.migrationAllowed) process.exitCode = process.exitCode || 2
}

main()
