/**
 * Run ONLINE regression suites (isolated per script cleanup) + optional clean chain.
 *
 *   node scripts/run-online-regression.mjs
 *   CHAIN=1 node scripts/run-online-regression.mjs   # same order, shared PG (each suite cleans PREFIX)
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalEnv } from '../server/kakapo-api/loadEnv.js'
loadLocalEnv()
import { ensureSchema, closePool, isPostgresEnabled } from '../server/kakapo-api/pg/client.js'
import {
  assertTestDatabaseAllowed,
  truncateTestLabDatabase,
  cleanupOnlineTestPrefixes,
  postChainOrphanSweep,
} from './online-test-db-cleanup.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const SUITES = [
  { name: 'O8A', script: 'online-o8a-durable-mutation-test.mjs', env: { O8_REAL_PG_REQUIRED: '1' } },
  { name: 'O1', script: 'online-o1-supplier-accounting-test.mjs', env: { O1_REAL_PG_REQUIRED: '1' } },
  { name: 'O1B', script: 'online-o1b-supplier-closure-test.mjs', env: {} },
  { name: 'O2', script: 'online-o2-finance-conservation-test.mjs', env: { O2_REAL_PG_REQUIRED: '1' } },
  { name: 'O2B', script: 'online-o2b-finance-closure-test.mjs', env: { O2B_REAL_PG_REQUIRED: '1' } },
  { name: 'O3', script: 'online-o3-stock-conservation-test.mjs', env: { O3_REAL_PG_REQUIRED: '1' } },
  { name: 'O3B', script: 'online-o3b-stock-final-closure-test.mjs', env: { O3B_REAL_PG_REQUIRED: '1' } },
  { name: 'O3C', script: 'online-o3c-stock-concurrency-test.mjs', env: { O3C_REAL_PG_REQUIRED: '1' } },
  { name: 'O4', script: 'online-o4-crm-consistency-test.mjs', env: { O4_REAL_PG_REQUIRED: '1' } },
  { name: 'O4B', script: 'online-o4b-crm-final-closure-test.mjs', env: { O4B_REAL_PG_REQUIRED: '1' } },
  { name: 'O4C', script: 'online-o4c-crm-final-proof-test.mjs', env: { O4C_REAL_PG_REQUIRED: '1' } },
  { name: 'O4D', script: 'online-o4d-link-unlink-atomic-test.mjs', env: { O4D_REAL_PG_REQUIRED: '1' } },
  { name: 'O4E', script: 'online-o4e-card-ensure-bypass-test.mjs', env: { O4E_REAL_PG_REQUIRED: '1' } },
  { name: 'O5', script: 'online-o5-master-data-durable-test.mjs', env: { O5_REAL_PG_REQUIRED: '1' } },
  { name: 'O5B', script: 'online-o5b-master-data-closure-test.mjs', env: { O5B_REAL_PG_REQUIRED: '1' } },
  { name: 'O6', script: 'online-o6-legacy-closure-test.mjs', env: { O6_REAL_PG_REQUIRED: '1' } },
  { name: 'O6B', script: 'online-o6b-order-action-test.mjs', env: { O6B_REAL_PG_REQUIRED: '1' } },
  { name: 'O7', script: 'online-o7-read-consistency-test.mjs', env: { O7_REAL_PG_REQUIRED: '1' } },
  { name: 'O8', script: 'online-o8-auth-hardening-test.mjs', env: { O8_AUTH_REAL_PG_REQUIRED: '1', KAKAPO_LAB_AUTO_AUTH: '0' } },
  { name: 'O8B', script: 'online-o8b-auth-closure-test.mjs', env: { O8B_AUTH_REAL_PG_REQUIRED: '1', KAKAPO_LAB_AUTO_AUTH: '0' } },
  { name: 'O9', script: 'online-o9-soak-release-test.mjs', env: { O9_REAL_PG_REQUIRED: '1' } },
  { name: 'O10', script: 'online-o10-release-readiness-test.mjs', env: { O10_REAL_PG_REQUIRED: '1', KAKAPO_LAB_AUTO_AUTH: '0' } },
  { name: 'O11D', script: 'online-o11d-customer-otp-deferred-test.mjs', env: { O11D_REAL_PG_REQUIRED: '1' } },
  { name: 'D4', script: 'debt-server-idempotency-d4-test.mjs', env: {} },
  { name: 'L13', script: 'online-l13-local-first-test.mjs', env: {} },
]

const SKIP = new Set(
  String(process.env.SKIP_SUITES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)
const ACTIVE_SUITES = SUITES.filter((s) => !SKIP.has(s.name))
if (SKIP.size) {
  console.log(`SKIP_SUITES=${[...SKIP].join(',')} → running ${ACTIVE_SUITES.length}/${SUITES.length}`)
}

function runSuite(suite, runId) {
  return new Promise((resolve) => {
    const scriptPath = path.join(root, 'scripts', suite.script)
    const child = spawn(process.execPath, [scriptPath], {
      cwd: root,
      env: {
        ...process.env,
        // O1–O7 / PC14 / D4: loopback lab auto-admin so signed write tests stay green.
        // O8 auth suite sets KAKAPO_LAB_AUTO_AUTH=0 explicitly.
        KAKAPO_LAB_AUTO_AUTH: suite.env?.KAKAPO_LAB_AUTO_AUTH != null
          ? suite.env.KAKAPO_LAB_AUTO_AUTH
          : '1',
        ...suite.env,
        ONLINE_RUN_ID: runId,
      },
      stdio: 'inherit',
    })
    child.on('close', (code) => resolve({ name: suite.name, ok: code === 0, code: code ?? 1 }))
  })
}

async function main() {
  if (isPostgresEnabled()) {
    await ensureSchema()
    await assertTestDatabaseAllowed()
    if (process.env.CLEAN_RUN === '1' && process.env.SKIP_GLOBAL_TRUNCATE !== '1') {
      console.log('\n========== CLEAN_RUN TRUNCATE LAB ==========\n')
      await truncateTestLabDatabase()
    }
    console.log('\n========== GLOBAL TEST DB CLEANUP ==========\n')
    await cleanupOnlineTestPrefixes()
  }
  const results = []
  for (const suite of ACTIVE_SUITES) {
    console.log(`\n========== ${suite.name} ==========\n`)
    const runId = `${suite.name}-${Date.now()}`
    results.push(await runSuite(suite, runId))
    if (isPostgresEnabled()) {
      await cleanupOnlineTestPrefixes()
      await closePool()
    }
  }
  console.log('\n========== SUMMARY ==========')
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`)
  }
  const allOk = results.every(r => r.ok)
  if (isPostgresEnabled()) {
    const sweep = await postChainOrphanSweep()
    if (sweep.orphanTestLayers.length > 0) {
      console.log('\nWARN orphan layers (missing product doc):', sweep.orphanTestLayers.length)
    }
    await closePool()
  }
  process.exit(allOk ? 0 : 1)
}

main()
