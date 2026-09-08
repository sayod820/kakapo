/**
 * Smoke: offline-sync engine files present (no runtime API).
 * Exit 0 if all required paths exist.
 */
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const required = [
  'lib/syncEngine/priorities.ts',
  'lib/connectivityManager.ts',
  'lib/syncConflictPolicy.ts',
  'lib/stockMovements.ts',
  'server/kakapo-api/serverChanges.js',
  'server/kakapo-api/syncBatch.js',
  'desktop/syncWorker.cjs',
]

let ok = true
for (const rel of required) {
  const abs = join(root, rel)
  if (!existsSync(abs)) {
    console.error(`[sync-smoke] missing: ${rel}`)
    ok = false
  } else {
    console.log(`[sync-smoke] ok: ${rel}`)
  }
}

if (!ok) {
  process.exit(1)
}
console.log('[sync-smoke] all checks passed')
process.exit(0)
