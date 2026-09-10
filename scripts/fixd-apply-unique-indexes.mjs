/**
 * FIX D — UNIQUE idempotency indexes on docs JSONB.
 *
 * DEFAULT: dry-run / precheck only. Does NOT apply indexes.
 *
 * Apply (staging/prod) only after review:
 *   CONFIRM_FIXD_APPLY=YES node scripts/fixd-apply-unique-indexes.mjs --apply
 *
 * NEVER wrap CREATE INDEX CONCURRENTLY in a transaction.
 * Creates indexes ONE BY ONE; validates indisvalid/indisready after each.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiRoot = path.join(root, 'server', 'kakapo-api')
const require = createRequire(path.join(apiRoot, 'package.json'))
const pg = require('pg')
const outPath = path.join(root, 'scripts', 'fixd-apply-unique-indexes-report.json')

const INDEXES = [
  {
    name: 'uq_docs_possales_client_ref',
    sql: `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_docs_possales_client_ref
ON docs ((NULLIF(BTRIM(data->>'clientRef'), '')))
WHERE collection = 'posSales'
  AND NULLIF(BTRIM(data->>'clientRef'), '') IS NOT NULL`,
  },
  {
    name: 'uq_docs_moneyledger_client_ref_type',
    sql: `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_docs_moneyledger_client_ref_type
ON docs (
  (NULLIF(BTRIM(data->>'clientRef'), '')),
  (COALESCE(data->>'type', ''))
)
WHERE collection = 'moneyLedger'
  AND NULLIF(BTRIM(data->>'clientRef'), '') IS NOT NULL`,
  },
  {
    name: 'uq_docs_financemoves_client_ref',
    sql: `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_docs_financemoves_client_ref
ON docs ((NULLIF(BTRIM(data->>'clientRef'), '')))
WHERE collection = 'financeMoves'
  AND NULLIF(BTRIM(data->>'clientRef'), '') IS NOT NULL`,
  },
  {
    name: 'uq_docs_oprefs_kind_client_ref',
    sql: `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_docs_oprefs_kind_client_ref
ON docs (
  (COALESCE(data->>'kind', '')),
  (NULLIF(BTRIM(data->>'clientRef'), ''))
)
WHERE collection = 'opRefs'
  AND NULLIF(BTRIM(data->>'clientRef'), '') IS NOT NULL`,
  },
]

const ROLLBACK = INDEXES.map(i => `DROP INDEX CONCURRENTLY IF EXISTS ${i.name};`)

const DUP_CHECKS = {
  posSales: `SELECT COUNT(*)::int AS groups FROM (
    SELECT 1 FROM docs WHERE collection='posSales'
      AND NULLIF(BTRIM(data->>'clientRef'),'') IS NOT NULL
    GROUP BY NULLIF(BTRIM(data->>'clientRef'),'') HAVING COUNT(*)>1
  ) t`,
  moneyLedger: `SELECT COUNT(*)::int AS groups FROM (
    SELECT 1 FROM docs WHERE collection='moneyLedger'
      AND NULLIF(BTRIM(data->>'clientRef'),'') IS NOT NULL
    GROUP BY NULLIF(BTRIM(data->>'clientRef'),''), COALESCE(data->>'type','') HAVING COUNT(*)>1
  ) t`,
  financeMoves: `SELECT COUNT(*)::int AS groups FROM (
    SELECT 1 FROM docs WHERE collection='financeMoves'
      AND NULLIF(BTRIM(data->>'clientRef'),'') IS NOT NULL
    GROUP BY NULLIF(BTRIM(data->>'clientRef'),'') HAVING COUNT(*)>1
  ) t`,
  opRefs: `SELECT COUNT(*)::int AS groups FROM (
    SELECT 1 FROM docs WHERE collection='opRefs'
      AND NULLIF(BTRIM(data->>'clientRef'),'') IS NOT NULL
    GROUP BY COALESCE(data->>'kind',''), NULLIF(BTRIM(data->>'clientRef'),'') HAVING COUNT(*)>1
  ) t`,
}

function loadUrl() {
  if (String(process.env.DATABASE_URL || '').trim()) return String(process.env.DATABASE_URL).trim()
  for (const file of [
    path.join(root, 'server', 'kakapo-api', '.env'),
    path.join(root, 'deploy', 'hetzner', '.env'),
  ]) {
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/)
      if (!m) continue
      const v = m[1].trim().replace(/^['"]|['"]$/g, '')
      if (v) return v
    }
  }
  return ''
}

const wantApply = process.argv.includes('--apply')
const confirmed = String(process.env.CONFIRM_FIXD_APPLY || '').trim() === 'YES'

async function indexStatus(client, name) {
  const res = await client.query(
    `SELECT i.relname AS index_name, ix.indisunique, ix.indisvalid, ix.indisready,
            pg_get_indexdef(ix.indexrelid) AS index_def
     FROM pg_index ix
     JOIN pg_class t ON t.oid = ix.indrelid
     JOIN pg_class i ON i.oid = ix.indexrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname='public' AND t.relname='docs' AND i.relname=$1`,
    [name],
  )
  return res.rows[0] || null
}

async function main() {
  const url = loadUrl()
  const report = {
    title: 'FIX D — UNIQUE index migration',
    generatedAtIso: new Date().toISOString(),
    mode: wantApply && confirmed ? 'APPLY' : 'DRY_RUN',
    applied: false,
    indexes: INDEXES.map(i => i.name),
    rollback: ROLLBACK,
    hetznerCommands: {
      audit: 'docker exec -e DATABASE_URL="$DATABASE_URL" kakapo-api node /app/scripts/fixd-unique-audit.mjs',
      dryRun: 'docker exec -e DATABASE_URL="$DATABASE_URL" kakapo-api node /app/scripts/fixd-apply-unique-indexes.mjs',
      apply:
        'docker exec -e DATABASE_URL="$DATABASE_URL" -e CONFIRM_FIXD_APPLY=YES kakapo-api node /app/scripts/fixd-apply-unique-indexes.mjs --apply',
      validate: INDEXES.map(i =>
        `SELECT i.relname, ix.indisvalid, ix.indisready FROM pg_index ix JOIN pg_class i ON i.oid=ix.indexrelid WHERE i.relname='${i.name}';`,
      ),
      rollback: ROLLBACK,
      invalidCleanupHint:
        'If CONCURRENTLY left an INVALID index: DROP INDEX CONCURRENTLY IF EXISTS <name>; then recreate.',
    },
    precheck: null,
    results: [],
    stopReason: null,
  }

  if (!url) {
    report.stopReason = 'DATABASE_URL unavailable'
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
    console.log('STOP: DATABASE_URL unavailable')
    console.log(`Report: ${outPath}`)
    process.exitCode = 2
    return
  }

  if (wantApply && !confirmed) {
    report.stopReason = 'Refusing --apply without CONFIRM_FIXD_APPLY=YES (safety)'
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
    console.log(report.stopReason)
    console.log(`Report: ${outPath}`)
    process.exitCode = 2
    return
  }

  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 15000,
    statement_timeout: 0, // CONCURRENTLY can take long
  })

  try {
    await client.connect()

    const dupSummary = {}
    let totalDupGroups = 0
    for (const [k, sql] of Object.entries(DUP_CHECKS)) {
      const r = await client.query(sql)
      const n = Number(r.rows[0]?.groups || 0)
      dupSummary[k] = n
      totalDupGroups += n
    }

    const existing = {}
    for (const idx of INDEXES) {
      existing[idx.name] = await indexStatus(client, idx.name)
    }

    report.precheck = { totalDupGroups, dupSummary, existing }

    if (totalDupGroups > 0) {
      report.stopReason = `duplicate groups=${totalDupGroups} — refuse create UNIQUE`
      fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
      console.log(report.stopReason)
      process.exitCode = 2
      return
    }

    if (report.mode === 'DRY_RUN') {
      report.stopReason = 'DRY_RUN — indexes NOT created (review app 23505 handlers first)'
      fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
      console.log('FIX D migration DRY_RUN OK (0 duplicate groups)')
      console.log('Indexes to create:', INDEXES.map(i => i.name).join(', '))
      console.log('To apply later: CONFIRM_FIXD_APPLY=YES node scripts/fixd-apply-unique-indexes.mjs --apply')
      console.log(`Report: ${outPath}`)
      return
    }

    // APPLY — one by one, NO surrounding transaction
    for (const idx of INDEXES) {
      const before = await indexStatus(client, idx.name)
      if (before?.indisvalid && before?.indisready) {
        report.results.push({ name: idx.name, status: 'ALREADY_VALID', ...before })
        console.log(`SKIP (valid): ${idx.name}`)
        continue
      }
      if (before && !before.indisvalid) {
        report.results.push({
          name: idx.name,
          status: 'INVALID_EXISTS',
          cleanup: `DROP INDEX CONCURRENTLY IF EXISTS ${idx.name};`,
          ...before,
        })
        report.stopReason = `Invalid index ${idx.name} exists — cleanup manually, do not continue`
        fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
        console.error(report.stopReason)
        process.exitCode = 3
        return
      }

      console.log(`CREATE CONCURRENTLY: ${idx.name}`)
      // Must NOT be inside BEGIN
      await client.query(idx.sql)
      const after = await indexStatus(client, idx.name)
      const ok = !!(after && after.indisvalid && after.indisready)
      report.results.push({
        name: idx.name,
        status: ok ? 'CREATED_VALID' : 'INVALID_AFTER_BUILD',
        ...after,
      })
      if (!ok) {
        report.stopReason = `Index ${idx.name} not valid after build`
        fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
        console.error(report.stopReason, after)
        process.exitCode = 3
        return
      }
      console.log(`OK valid: ${idx.name}`)
    }

    report.applied = true
    report.stopReason = null
  } catch (e) {
    report.stopReason = String(e?.message || e).slice(0, 400)
    process.exitCode = 3
  } finally {
    try { await client.end() } catch { /* ignore */ }
  }

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({
    mode: report.mode,
    applied: report.applied,
    stopReason: report.stopReason,
    results: report.results,
  }, null, 2))
  console.log(`Report: ${outPath}`)
}

main()
