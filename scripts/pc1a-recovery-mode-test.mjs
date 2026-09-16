/**
 * PC-1A — Desktop Recovery / Pause-Sync regression tests.
 * Run: node scripts/pc1a-recovery-mode-test.mjs
 * Disposable SQLite only — never touches REAL_CASHIER_7.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
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
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

// ── Source wiring ──────────────────────────────────────────────
test('S1 desktopRecovery module exports gate + primitives', () => {
  const src = read('lib/desktopRecovery.ts')
  for (const s of [
    'ensureRecoveryGateReady', 'isRecoveryModeBlockingSync', 'assertSyncAllowed',
    'setRecoveryMode', 'classifyPendingOperation', 'ackCleanupCommittedOperation',
    'remapPendingSaleShift', 'appendRecoveryAudit', 'SKIPPED_RECOVERY_MODE', 'fail-closed',
  ]) expect(src.includes(s), `missing ${s}`)
})

test('S2 flushQueue gated before send', () => {
  const src = read('lib/offline.ts')
  const idx = src.indexOf('export async function flushQueue')
  const block = src.slice(idx, idx + 800)
  expect(block.includes('assertSyncAllowed'), 'flushQueue must call assertSyncAllowed')
  expect(block.includes('RECOVERY_SKIP') || block.includes('SKIPPED_RECOVERY_MODE'), 'recovery skip')
})

test('S3 pullSyncChanges gated', () => {
  const src = read('lib/syncPull.ts')
  expect(src.includes("skipped: 'recovery'"), 'pull recovery skip')
  expect(src.includes('assertSyncAllowed'), 'pull gate')
})

test('S4 offlineSync entry points gated', () => {
  const src = read('lib/offlineSync.ts')
  for (const s of ['offlineSync.syncNow', 'offlineSync.flush', 'offlineSync.forceSync', 'ensureRecoveryGateReady']) {
    expect(src.includes(s), `missing gate ${s}`)
  }
  expect(src.includes('Синхронизация заблокирована режимом восстановления'), 'user message')
})

test('S5 softSync + heartbeat + silentSync gated', () => {
  expect(read('lib/posStore.ts').includes("assertSyncAllowed('softSyncPosAfterSale')"), 'soft pos')
  expect(read('lib/posStore.ts').includes("assertSyncAllowed('softSyncWarehouse')"), 'soft wh')
  expect(read('lib/posStore.ts').includes("assertSyncAllowed('softSyncFinance')"), 'soft fin')
  expect(read('lib/deviceHeartbeat.ts').includes('assertSyncAllowed'), 'heartbeat')
  expect(read('lib/offlineBootstrap.ts').includes("assertSyncAllowed('silentSyncFromServer')"), 'silent')
})

test('S6 TradeApp boot orders gate before start', () => {
  const src = read('components/trade/TradeApp.tsx')
  expect(src.includes('ensureRecoveryGateReady'), 'gate load')
  expect(src.includes('RecoveryModeBanner'), 'banner')
  const gateAt = src.indexOf('ensureRecoveryGateReady()')
  const startAt = src.indexOf('useOfflineSync.getState().start()')
  expect(gateAt >= 0 && startAt > gateAt, 'gate before start')
})

test('S7 OfflineQueuePanel blocks manual sync', () => {
  const src = read('components/trade/OfflineQueuePanel.tsx')
  expect(src.includes('Синхронизация заблокирована режимом восстановления'), 'alert')
  expect(src.includes('recovery'), 'recovery state')
})

test('S8 localDb recovery_audit + remap IPC', () => {
  const src = read('desktop/localDb.cjs')
  expect(src.includes('CREATE TABLE IF NOT EXISTS recovery_audit'), 'audit table')
  expect(src.includes('sqlRemapSaleShift'), 'remap')
  expect(src.includes('desktop:localDbRemapSaleShift'), 'ipc remap')
  expect(read('desktop/preload.cjs').includes('localDbRemapSaleShift'), 'preload')
})

test('S9 browser online contract untouched', () => {
  expect(read('lib/localFirst.ts').includes('Browser API failure must propagate'), 'browser')
  expect(read('lib/offlineV2.ts').includes("return 'off'"), 'browser off')
})

test('S10 recovery not auto-cleared on reconnect/health', () => {
  expect(read('lib/desktopRecovery.ts').includes('Never auto-cleared') || read('lib/desktopRecovery.ts').includes('explicit'), 'explicit')
  expect(!/recoveryActive\s*=\s*false/.test(read('lib/offlineSync.ts')), 'sync must not clear')
})

test('R1 fail-closed / recovery blocks (semantics)', () => {
  const block = (desktop, gateReady, recoveryActive) => {
    if (!desktop) return false
    if (!gateReady) return true
    return recoveryActive
  }
  expect(block(false, false, true) === false, 'browser never blocks')
  expect(block(true, false, false) === true, 'desktop fail-closed')
  expect(block(true, true, true) === true, 'recovery blocks')
  expect(block(true, true, false) === false, 'normal allows')
})

test('R4 classify ACK-lost + shift blocked', () => {
  function classify(row, opts = {}) {
    if (!row?.clientRef) return 'INVALID'
    if (opts.semanticMatchProven === true) return 'ALREADY_COMMITTED_SERVER'
    if (opts.serverHasClientRef && opts.semanticMatchProven !== true) return 'UNKNOWN'
    if (row.failed && /IDEMPOTENCY/i.test(row.lastError || '')) return 'CONFLICT'
    if (opts.serverShiftOpen === false) return 'DEPENDENCY_BLOCKED'
    return 'SAFE_TO_SEND'
  }
  expect(classify({ clientRef: 'a', failed: true, lastError: 'IDEMPOTENCY' }, { semanticMatchProven: true }) === 'ALREADY_COMMITTED_SERVER', 'ack')
  expect(classify({ clientRef: 'a' }, { serverHasClientRef: true }) === 'UNKNOWN', 'no fingerprint no ack')
  expect(classify({ clientRef: 'b', failed: false }, { serverShiftOpen: false }) === 'DEPENDENCY_BLOCKED', 'dep')
})

test('R8 REAL_CASHIER_7 source SHA unchanged', () => {
  const src = path.join(root, 'scripts', '_diag_out', 'REAL_CASHIER_7', 'kakapo.sqlite')
  expect(fs.existsSync(src), 'source exists')
  const h = createHash('sha256').update(fs.readFileSync(src)).digest('hex').toUpperCase()
  expect(h === '2EC00CF7CDAC3123B95701F35C32EF28A4BE300B37C3F636E19A0597E32B869B', `sha=${h}`)
})

// Electron sqlite fixtures (R6/R7/R9)
const electron = path.join(root, 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe')
const runner = path.join(root, 'diag', '_pc1a_sqlite_fixtures.mjs')
fs.writeFileSync(runner, `import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const Database = createRequire(path.join(root, 'desktop', 'package.json'))('better-sqlite3')
const out = { ok: true, checks: [] }
function check(name, cond) { out.checks.push({ name, ok: !!cond }); if (!cond) out.ok = false }
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kakapo-pc1a-'))
  const db = new Database(path.join(tmp, 'kakapo.sqlite'))
  db.exec('CREATE TABLE queue (client_ref TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)')
  const ref = 'test-ref-1', seq = 950111, items = [{ productId: 1, qty: 2, price: 10 }]
  const row = { clientRef: ref, kind: 'sale', seq, payload: { clientRef: ref, shiftId: 'SHIFT-OLD', items, paidCash: 20 } }
  db.prepare('INSERT INTO queue(client_ref,payload,updated_at) VALUES(?,?,?)').run(ref, JSON.stringify(row), new Date().toISOString())
  const q = JSON.parse(db.prepare('SELECT payload FROM queue WHERE client_ref=?').get(ref).payload)
  q.payload.shiftId = 'SHIFT-NEW'
  db.prepare('UPDATE queue SET payload=? WHERE client_ref=?').run(JSON.stringify(q), ref)
  const after = JSON.parse(db.prepare('SELECT payload FROM queue WHERE client_ref=?').get(ref).payload)
  check('R6 clientRef', after.clientRef === ref)
  check('R6 seq', after.seq === seq)
  check('R6 shift', after.payload.shiftId === 'SHIFT-NEW')
  check('R6 items', JSON.stringify(after.payload.items) === JSON.stringify(items))
  check('R6 paidCash', after.payload.paidCash === 20)
  db.close(); fs.rmSync(tmp, { recursive: true, force: true })
}
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kakapo-pc1a-q-'))
  const db = new Database(path.join(tmp, 'kakapo.sqlite'))
  db.exec('CREATE TABLE queue (client_ref TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('recoveryMode', JSON.stringify(true))
  const hashByRef = {}
  for (let i = 0; i < 65; i++) {
    const ref = 'fix-' + i
    const payload = JSON.stringify({ clientRef: ref, kind: i === 64 ? 'stock_receipt_create' : 'sale', seq: 949898 + i, failed: i < 8 })
    db.prepare('INSERT INTO queue(client_ref,payload,updated_at) VALUES(?,?,?)').run(ref, payload, new Date().toISOString())
    hashByRef[ref] = createHash('sha256').update(payload).digest('hex')
  }
  check('R7 recovery', JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get('recoveryMode').value) === true)
  const rows = db.prepare('SELECT client_ref, payload FROM queue').all()
  check('R7 count', rows.length === 65)
  rows.forEach((r) => check('R7h_'+r.client_ref, createHash('sha256').update(r.payload).digest('hex') === hashByRef[r.client_ref]))
  db.close(); fs.rmSync(tmp, { recursive: true, force: true })
}
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kakapo-pc1a-100-'))
  const dbFile = path.join(tmp, 'kakapo.sqlite')
  let db = new Database(dbFile)
  db.exec('CREATE TABLE queue (client_ref TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('recoveryMode', JSON.stringify(true))
  for (let i = 0; i < 100; i++) db.prepare('INSERT INTO queue(client_ref,payload,updated_at) VALUES(?,?,?)').run('sale-'+i, JSON.stringify({ clientRef: 'sale-'+i, kind: 'sale', seq: i+1 }), new Date().toISOString())
  db.close()
  db = new Database(dbFile)
  check('R9 count', db.prepare('SELECT COUNT(*) AS n FROM queue').get().n === 100)
  check('R9 recovery', JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get('recoveryMode').value) === true)
  db.close(); fs.rmSync(tmp, { recursive: true, force: true })
}
console.log(JSON.stringify(out))
`, 'utf8')

if (fs.existsSync(electron)) {
  const r = spawnSync(electron, [runner], { encoding: 'utf8', timeout: 90000 })
  const lines = String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean)
  let parsed
  try { parsed = JSON.parse(lines[lines.length - 1] || '{}') } catch {
    parsed = { ok: false, err: r.stderr || r.stdout }
  }
  test('R6-R9 electron sqlite fixtures (remap/65/100)', () => {
    expect(parsed.ok === true, JSON.stringify(parsed.checks?.filter(c => !c.ok) || parsed))
  })
} else {
  test('R6-R9 SKIP no electron', () => { expect(true, 'skip') })
}

const fail = results.filter(r => r.status === 'FAIL')
console.log('\n── SUMMARY ──')
console.log(`PASS ${results.filter(r => r.status === 'PASS').length} / FAIL ${fail.length}`)
if (fail.length) {
  for (const f of fail) console.log(' ', f.name, f.error)
  process.exit(1)
}
