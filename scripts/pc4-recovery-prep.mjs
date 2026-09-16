#!/usr/bin/env node
/**
 * PC-4 — Offline recovery preparation tool (LAB / pre-live only).
 *
 * Arms recovery metadata on a disposable SQLite copy WITHOUT starting Trade UI
 * and WITHOUT syncing.
 *
 * Usage:
 *   node scripts/pc4-recovery-prep.mjs --db <path-to-kakapo.sqlite> --arm
 *   node scripts/pc4-recovery-prep.mjs --db <path> --verify
 *   node scripts/pc4-recovery-prep.mjs --instructions
 *
 * NEVER run against production live DB while Desktop is open.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

/** Re-exec under Electron Node ABI so better-sqlite3 (desktop) loads. */
function ensureElectronAbi() {
  if (process.versions.electron) return false
  const electron = path.join(root, 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe')
  const electronCmd = fs.existsSync(electron)
    ? electron
    : path.join(root, 'desktop', 'node_modules', '.bin', 'electron.cmd')
  if (!fs.existsSync(electron) && !fs.existsSync(electronCmd)) {
    throw new Error('Electron not found under desktop/node_modules — required for SQLite prep')
  }
  const { spawnSync } = require('node:child_process')
  const r = spawnSync(electron, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    stdio: 'inherit',
  })
  process.exit(r.status == null ? 1 : r.status)
}

const argsEarly = process.argv.slice(2)
if (!argsEarly.includes('--instructions') && !argsEarly.includes('--help') && !argsEarly.includes('-h')) {
  ensureElectronAbi()
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').toUpperCase()
}

function printInstructions() {
  console.log(`
============================================================
OPERATOR: CREATE REAL_CASHIER_8 (Cursor will NOT pull from PC)
============================================================
1. On the LIVE cashier PC, fully quit "KAKAPO Kassa" / Electron.
2. Locate AppData local DB folder (typical):
   %APPDATA%\\kakapo-trade-desktop\\  OR  userData path shown in About
   Files:
     kakapo.sqlite
     kakapo.sqlite-wal
     kakapo.sqlite-shm
3. Copy ALL THREE files to a USB / network share as a triplet.
4. On the LAB machine place them at:
   <repo>/scripts/_diag_out/REAL_CASHIER_8/
     kakapo.sqlite
     kakapo.sqlite-wal
     kakapo.sqlite-shm
5. Do NOT overwrite REAL_CASHIER_7.
6. Tell the operator chat: REAL_CASHIER_8_READY
7. Lab will:
   - hash source (immutable)
   - create ANALYSIS/LAB copy
   - integrity_check
   - arm recovery flags ONLY on LAB copy

Cursor must never connect to the live cashier PC to fetch this copy.
`)
}

function parseArgs(argv) {
  const out = { arm: false, verify: false, instructions: false, db: null, force: false }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--arm') out.arm = true
    else if (a === '--verify') out.verify = true
    else if (a === '--instructions') out.instructions = true
    else if (a === '--force') out.force = true
    else if (a === '--db') out.db = argv[++i]
    else if (a === '--help' || a === '-h') out.instructions = true
  }
  return out
}

function resolveBetterSqlite3() {
  const candidates = [
    path.join(root, 'desktop', 'node_modules', 'better-sqlite3'),
    path.join(root, 'node_modules', 'better-sqlite3'),
  ]
  for (const c of candidates) {
    try {
      return require(c)
    } catch { /* next */ }
  }
  throw new Error('better-sqlite3 not found (install desktop deps)')
}

function tripletPaths(dbFile) {
  return {
    main: dbFile,
    wal: dbFile + '-wal',
    shm: dbFile + '-shm',
  }
}

function refuseIfUnsafe(dbFile, opts) {
  const dir = path.dirname(dbFile)
  const lockCandidates = [
    path.join(dir, 'kakapo.lock'),
    path.join(dir, '.kakapo-desktop.lock'),
  ]
  for (const lock of lockCandidates) {
    if (fs.existsSync(lock) && !opts.force) {
      throw new Error(`REFUSE: lock file present (${lock}). Close Desktop first.`)
    }
  }
  // Heuristic: refuse obvious live AppData path unless --force
  const norm = dbFile.replace(/\\/g, '/').toLowerCase()
  if (!opts.force && /appdata\/roaming\/kakapo/i.test(norm)) {
    throw new Error('REFUSE: looks like live AppData path. Use a LAB copy + --force only if intentional.')
  }
}

function backupTriplet(dbFile) {
  const t = tripletPaths(dbFile)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = path.join(path.dirname(dbFile), `pc4-prep-backup-${stamp}`)
  fs.mkdirSync(dest, { recursive: true })
  const hashes = {}
  for (const [k, p] of Object.entries(t)) {
    if (!fs.existsSync(p)) continue
    const name = path.basename(p)
    fs.copyFileSync(p, path.join(dest, name))
    hashes[name] = sha256File(p)
  }
  const manifest = {
    createdAt: new Date().toISOString(),
    source: dbFile,
    dest,
    hashes,
  }
  fs.writeFileSync(path.join(dest, 'MANIFEST.json'), JSON.stringify(manifest, null, 2))
  return manifest
}

function metaGet(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key)
  if (!row) return undefined
  try { return JSON.parse(row.value) } catch { return row.value }
}

function metaSet(db, key, value) {
  db.prepare(`
    INSERT INTO meta(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, JSON.stringify(value))
}

function armRecovery(dbFile, opts) {
  refuseIfUnsafe(dbFile, opts)
  if (!fs.existsSync(dbFile)) throw new Error(`missing db: ${dbFile}`)

  const beforeHash = sha256File(dbFile)
  const backup = backupTriplet(dbFile)

  const Database = resolveBetterSqlite3()
  const db = new Database(dbFile)
  try {
    db.pragma('journal_mode = WAL')
    // integrity
    const integrity = db.pragma('integrity_check', { simple: true })
    if (String(integrity) !== 'ok') {
      throw new Error(`integrity_check failed: ${integrity}`)
    }

    const before = {
      recoveryMode: metaGet(db, 'recoveryMode'),
      recoveryRequiredAfterUpgrade: metaGet(db, 'recoveryRequiredAfterUpgrade'),
    }

    // ONLY these keys — no queue/entities/mirror/sales
    metaSet(db, 'recoveryMode', true)
    metaSet(db, 'recoveryRequiredAfterUpgrade', true)
    metaSet(db, 'recoveryPhase', 'RECOVERY_PREPARE')
    metaSet(db, 'recoveryPrepAt', new Date().toISOString())
    metaSet(db, 'recoveryPrepTool', 'pc4-recovery-prep')

    const after = {
      recoveryMode: metaGet(db, 'recoveryMode'),
      recoveryRequiredAfterUpgrade: metaGet(db, 'recoveryRequiredAfterUpgrade'),
      recoveryPhase: metaGet(db, 'recoveryPhase'),
    }

    if (after.recoveryMode !== true || after.recoveryRequiredAfterUpgrade !== true) {
      throw new Error('verify_failed: meta not armed')
    }

    // Idempotent second write
    metaSet(db, 'recoveryMode', true)
    metaSet(db, 'recoveryRequiredAfterUpgrade', true)

    db.close()

    const afterHash = sha256File(dbFile)
    const report = {
      ok: true,
      dbFile,
      beforeHash,
      afterHash,
      backup,
      before,
      after,
      note: 'Only recovery metadata keys written. Queue/entities untouched by this tool.',
    }
    const reportPath = path.join(path.dirname(dbFile), 'pc4-prep-report.json')
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
    return report
  } catch (e) {
    try { db.close() } catch { /* ignore */ }
    throw e
  }
}

function verifyArm(dbFile) {
  const Database = resolveBetterSqlite3()
  const db = new Database(dbFile, { readonly: true })
  try {
    const out = {
      recoveryMode: metaGet(db, 'recoveryMode'),
      recoveryRequiredAfterUpgrade: metaGet(db, 'recoveryRequiredAfterUpgrade'),
      recoveryPhase: metaGet(db, 'recoveryPhase'),
      sha256: sha256File(dbFile),
    }
    console.log(JSON.stringify(out, null, 2))
    return out
  } finally {
    db.close()
  }
}

const args = parseArgs(process.argv)
if (args.instructions || (!args.arm && !args.verify && !args.db)) {
  printInstructions()
  if (!args.arm && !args.verify) process.exit(0)
}
if (!args.db) {
  console.error('Missing --db <kakapo.sqlite>')
  process.exit(1)
}
const dbPath = path.resolve(args.db)
if (args.arm) armRecovery(dbPath, args)
else if (args.verify) verifyArm(dbPath)
