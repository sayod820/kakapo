#!/usr/bin/env node
'use strict'

/**
 * Export PostgreSQL snapshot → kakapo.json (rollback aid).
 *
 * Usage:
 *   DATABASE_URL=postgres://... node exportPgToJson.js [outPath]
 */

import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { ensureSchema, getDatabaseUrl, withClient, closePool } from './pg/client.js'
import { loadSnapshotFromPg } from './pg/store.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || join(__dirname, 'data')
const outPath = process.argv[2] || join(DATA_DIR, 'kakapo.export.json')

async function main() {
  if (!getDatabaseUrl()) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }
  await ensureSchema()
  const snap = await withClient(c => loadSnapshotFromPg(c))
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(snap, null, 2), 'utf8')
  const products = Array.isArray(snap.products) ? snap.products.length : 0
  const clients = Array.isArray(snap.clients) ? snap.clients.length : 0
  console.log(`✅ Exported → ${outPath}`)
  console.log(`   products=${products} clients=${clients}`)
}

main()
  .catch(err => {
    console.error('[export] failed', err)
    process.exit(1)
  })
  .finally(() => closePool().catch(() => {}))
