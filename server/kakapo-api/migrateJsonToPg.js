#!/usr/bin/env node
'use strict'

/**
 * Import kakapo.json → PostgreSQL.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node migrateJsonToPg.js [path/to/kakapo.json]
 *
 * Env:
 *   DATABASE_URL (required)
 *   DATA_DIR (optional, default ./data)
 *   MIGRATE_FORCE=1 — replace existing PG data
 */

import { existsSync, readFileSync, copyFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { ensureSchema, getDatabaseUrl, withClient, closePool } from './pg/client.js'
import { isPgEmpty, persistSnapshot, loadSnapshotFromPg } from './pg/store.js'
import { DEFAULT } from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || join(__dirname, 'data')
const defaultJson = join(DATA_DIR, 'kakapo.json')
const jsonPath = process.argv[2] || defaultJson
const force = process.env.MIGRATE_FORCE === '1' || process.argv.includes('--force')

function countReport(snap) {
  const keys = Object.keys(snap || {})
  const arrays = {}
  const meta = []
  for (const k of keys) {
    if (Array.isArray(snap[k])) arrays[k] = snap[k].length
    else meta.push(k)
  }
  return { arrays, meta }
}

async function main() {
  if (!getDatabaseUrl()) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }
  if (!existsSync(jsonPath)) {
    console.error('JSON file not found:', jsonPath)
    process.exit(1)
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const bak = `${jsonPath}.bak-${stamp}`
  copyFileSync(jsonPath, bak)
  console.log('[migrate] backup →', bak)

  const raw = JSON.parse(readFileSync(jsonPath, 'utf8'))
  const snapshot = { ...structuredClone(DEFAULT), ...raw }

  await ensureSchema()

  await withClient(async client => {
    const empty = await isPgEmpty(client)
    if (!empty && !force) {
      console.error('[migrate] Postgres already has data. Re-run with --force or MIGRATE_FORCE=1')
      process.exit(2)
    }
  })

  console.log('[migrate] writing snapshot…')
  await persistSnapshot(snapshot)

  const loaded = await withClient(c => loadSnapshotFromPg(c))
  const before = countReport(snapshot)
  const after = countReport(loaded)

  console.log('\n=== Migration report ===')
  console.log('Source:', jsonPath)
  console.log('Array counts (source → pg):')
  const allKeys = new Set([...Object.keys(before.arrays), ...Object.keys(after.arrays)])
  let mismatch = 0
  for (const k of [...allKeys].sort()) {
    const a = before.arrays[k] || 0
    const b = after.arrays[k] || 0
    const mark = a === b ? 'OK' : 'DIFF'
    if (a !== b) mismatch += 1
    console.log(`  ${k}: ${a} → ${b} [${mark}]`)
  }
  console.log('Meta keys:', after.meta.sort().join(', ') || '(none)')
  if (mismatch) {
    console.error(`\n⚠️  ${mismatch} collection count mismatch(es)`)
    process.exit(3)
  }
  console.log('\n✅ Migration OK')
}

main()
  .catch(err => {
    console.error('[migrate] failed', err)
    process.exit(1)
  })
  .finally(() => closePool().catch(() => {}))
