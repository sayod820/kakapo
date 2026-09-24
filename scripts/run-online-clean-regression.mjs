/**
 * Authoritative clean regression: guarded lab TRUNCATE + full suite chain + orphan sweep.
 *
 *   node scripts/run-online-clean-regression.mjs
 *
 * Requires DATABASE_URL → kakapo_l11_test or kakapo_l11_test_*
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureSchema, closePool, isPostgresEnabled } from '../server/kakapo-api/pg/client.js'
import {
  assertTestDatabaseAllowed,
  truncateTestLabDatabase,
  cleanupOnlineTestPrefixes,
  postChainOrphanSweep,
} from './online-test-db-cleanup.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

process.env.CLEAN_RUN = '1'

const regression = path.join(root, 'scripts/run-online-regression.mjs')

async function main() {
  if (!isPostgresEnabled()) {
    console.error('DATABASE_URL required')
    process.exit(1)
  }
  const id = await assertTestDatabaseAllowed()
  console.log(`Clean regression on lab DB: ${id.db} (${id.user})\n`)
  await ensureSchema()
  console.log('========== TRUNCATE LAB (docs/sync_changes/kv_meta) ==========\n')
  await truncateTestLabDatabase()
  await cleanupOnlineTestPrefixes()

  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [regression], {
      cwd: root,
      env: { ...process.env, SKIP_GLOBAL_TRUNCATE: '1' },
      stdio: 'inherit',
    })
    child.on('close', (c) => resolve(c ?? 1))
  })

  console.log('\n========== POST-CHAIN ORPHAN SWEEP ==========\n')
  const sweep = await postChainOrphanSweep()
  console.log(JSON.stringify({
    orphanTestLayerCount: sweep.orphanTestLayers.length,
    orphanSamples: sweep.orphanTestLayers.slice(0, 5),
    prefixLeaks: sweep.prefixLeaks.filter(p => p.count > 0),
  }, null, 2))

  if (sweep.orphanTestLayers.length > 0) {
    console.error('\nFAIL: ORPHAN_TEST_LAYER count must be 0 after chain')
    await closePool()
    process.exit(1)
  }

  await closePool()
  process.exit(code === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  try { await closePool() } catch { /* ignore */ }
  process.exit(1)
})
