/**
 * Pre-deploy regression runner (local only, no production writes).
 * Run: node scripts/run-debt-predeploy-suite.mjs
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const suites = [
  'scripts/debt-ledger-cap-test.mjs',
  'scripts/debt-ui-projection-test.mjs',
  'scripts/debt-predeploy-regression-test.mjs',
  'scripts/debt-reliability-fix-test.mjs',
  'scripts/phase5-atomic-sale-test.mjs',
  'scripts/phase6-push-pull-starvation-test.mjs',
  'scripts/phase9-finance-idempotency-test.mjs',
  'scripts/shift-lifecycle-test.mjs',
  'scripts/shift-reconcile-test.mjs',
  'scripts/fixe-order-loyalty-idempotency-test.mjs',
  'scripts/fixe2-effect-txn-test.mjs',
  'scripts/fixd-unique-violation-test.mjs',
  'scripts/phase1-ghost-outbox-test.mjs',
]

const syntaxFiles = [
  'server/kakapo-api/debtLedger.js',
  'server/kakapo-api/cardCanonical.js',
  'server/kakapo-api/index.js',
  'server/kakapo-api/posLogic.js',
  'server/kakapo-api/financeTruth.js',
]

const report = {
  startedAt: new Date().toISOString(),
  suites: [],
  syntax: [],
  importChecks: null,
  startup: null,
}

function runNode(args, timeoutMs = 120000) {
  return spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  })
}

for (const rel of suites) {
  const full = path.join(root, rel)
  console.log(`\n==== RUN ${rel} ====`)
  if (!fs.existsSync(full)) {
    report.suites.push({ file: rel, status: 'MISSING' })
    console.log('MISSING', rel)
    continue
  }
  const r = runNode([full])
  const out = `${r.stdout || ''}\n${r.stderr || ''}`
  const passLines = (out.match(/^PASS\b/gm) || []).length
  const failLines = (out.match(/^FAIL\b/gm) || []).length
  const entry = {
    file: rel,
    status: r.status === 0 ? 'PASS' : 'FAIL',
    exit: r.status,
    passLines,
    failLines,
    tail: out.trim().split(/\n/).slice(-25).join('\n'),
  }
  report.suites.push(entry)
  console.log(entry.status, rel, `exit=${r.status} PASS~${passLines} FAIL~${failLines}`)
  if (entry.status !== 'PASS') console.log(entry.tail)
}

console.log('\n==== SYNTAX ====')
for (const rel of syntaxFiles) {
  const r = runNode(['--check', rel])
  const ok = r.status === 0
  report.syntax.push({ file: rel, status: ok ? 'PASS' : 'FAIL', stderr: (r.stderr || '').trim() })
  console.log(ok ? 'SYNTAX OK' : 'SYNTAX FAIL', rel)
}

console.log('\n==== IMPORT ====')
const importFile = path.join(root, 'scripts/_tmp_import_check.mjs')
fs.writeFileSync(importFile, `
import { pathToFileURL } from 'node:url'
import path from 'node:path'
const api = path.resolve('server/kakapo-api')
await import(pathToFileURL(path.join(api, 'debtLedger.js')).href)
await import(pathToFileURL(path.join(api, 'cardCanonical.js')).href)
await import(pathToFileURL(path.join(api, 'posLogic.js')).href)
await import(pathToFileURL(path.join(api, 'financeTruth.js')).href)
console.log('IMPORT_OK')
`)
const imp = runNode([importFile])
report.importChecks = {
  status: imp.status === 0 ? 'PASS' : 'FAIL',
  detail: `${imp.stdout || ''}${imp.stderr || ''}`.trim().slice(-800),
}
console.log(report.importChecks.status, report.importChecks.detail.slice(0, 200))
try { fs.unlinkSync(importFile) } catch { /* ignore */ }

console.log('\n==== STARTUP (no listen / no prod DB) ====')
const startupFile = path.join(root, 'scripts/_tmp_startup_check.mjs')
fs.writeFileSync(startupFile, `
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
const idx = fs.readFileSync('server/kakapo-api/index.js', 'utf8')
if (!idx.includes("from './debtLedger.js'")) throw new Error('index missing debtLedger import')
if (!idx.includes("from './cardCanonical.js'")) throw new Error('index missing cardCanonical import')
if (!idx.includes('unlinkNonCanonicalSiblingCards')) throw new Error('index missing unlink wiring')
if (!idx.includes('syncDebtBalance')) throw new Error('index missing syncDebtBalance wiring on issue/ensure')
const chk = spawnSync(process.execPath, ['--check', 'server/kakapo-api/index.js'], { encoding: 'utf8' })
if (chk.status !== 0) throw new Error(chk.stderr || 'index syntax fail')
// index.js boots DB/listen — do not import it here.
console.log('STARTUP_CHECK_OK')
`)
const st = runNode([startupFile])
report.startup = {
  status: st.status === 0 ? 'PASS' : 'FAIL',
  detail: `${st.stdout || ''}${st.stderr || ''}`.trim().slice(-800),
}
console.log(report.startup.status, report.startup.detail)
try { fs.unlinkSync(startupFile) } catch { /* ignore */ }

report.finishedAt = new Date().toISOString()
fs.mkdirSync(path.join(root, 'scripts/_diag_out'), { recursive: true })
const outPath = path.join(root, 'scripts/_diag_out/debt-predeploy-regression-report.json')
fs.writeFileSync(outPath, JSON.stringify(report, null, 2))

const failedSuites = report.suites.filter(s => s.status !== 'PASS')
const failedSyntax = report.syntax.filter(s => s.status !== 'PASS')
const ready = failedSuites.length === 0
  && failedSyntax.length === 0
  && report.importChecks?.status === 'PASS'
  && report.startup?.status === 'PASS'

console.log('\n==== SUMMARY ====')
console.log(JSON.stringify({
  TESTS_PASS: report.suites.filter(s => s.status === 'PASS').map(s => s.file),
  TESTS_FAIL: failedSuites.map(s => ({ file: s.file, exit: s.exit, failLines: s.failLines })),
  SERVER_STARTUP_CHECK: report.startup?.status,
  IMPORT_CHECK: report.importChecks?.status,
  READY_FOR_PRODUCTION_DEPLOY: ready ? 'YES' : 'NO',
  report: outPath,
}, null, 2))

process.exit(ready ? 0 : 1)
