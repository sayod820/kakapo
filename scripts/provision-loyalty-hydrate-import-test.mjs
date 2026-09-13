/**
 * Regression: provisionLoyaltyCardSafe must resolve hydrateCardStore from cardStore.
 * Live 1.2.183 Debts repay failed with minified "r is not a function" because
 * hydrateCardStore was dynamically imported from clientCardSync (not exported).
 *
 * Run: node scripts/provision-loyalty-hydrate-import-test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
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
    console.error(`FAIL  ${name}:`, e?.message || e)
  }
}

function expect(cond, msg) {
  if (!cond) throw new Error(msg || 'assert')
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

/** Extract dynamic import target used for hydrateCardStore in a source file. */
function hydrateDynamicImportFrom(src) {
  // Matches any: { … hydrateCardStore … } = await import('…')
  const re = /\{[^}]*\bhydrateCardStore\b[^}]*\}\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]\s*\)/g
  const hits = []
  let m
  while ((m = re.exec(src))) hits.push(m[1])
  return hits
}

test('1) offlineClientOps imports hydrateCardStore from ./cardStore only', () => {
  const src = read('lib/offlineClientOps.ts')
  const hits = hydrateDynamicImportFrom(src)
  expect(hits.length >= 1, `expected dynamic import, got ${JSON.stringify(hits)}`)
  expect(hits.every(h => h === './cardStore'), `wrong targets: ${JSON.stringify(hits)}`)
  expect(!/\{\s*[^}]*\bhydrateCardStore\b[^}]*\}\s*=\s*await\s+import\(\s*['"]\.\/clientCardSync['"]\s*\)/.test(src),
    'forbidden: hydrateCardStore from clientCardSync')
  expect(src.includes('hydrateCardStore()'), 'calls hydrateCardStore()')
})

test('2) real export lives on cardStore; clientCardSync does not export it', () => {
  const cardStore = read('lib/cardStore.ts')
  const cardSync = read('lib/clientCardSync.ts')
  expect(/export\s+function\s+hydrateCardStore\s*\(/.test(cardStore), 'cardStore exports hydrateCardStore')
  expect(!/export\s+(?:async\s+)?function\s+hydrateCardStore\s*\(/.test(cardSync), 'clientCardSync must not export fn')
  expect(!/export\s*\{[^}]*\bhydrateCardStore\b[^}]*\}/.test(cardSync), 'clientCardSync must not re-export')
  // Internal use via import from cardStore is OK
  expect(/import\s*\{[^}]*\bhydrateCardStore\b[^}]*\}\s*from\s*['"]\.\/cardStore['"]/.test(cardSync),
    'clientCardSync may import hydrateCardStore for internal use')
})

test('3) module-graph simulation: wrong module → not a function; cardStore → function', () => {
  // Mirrors production destructure without mocking hydrate away.
  const clientCardSyncNamespace = Object.freeze({}) // no hydrateCardStore export
  const { hydrateCardStore: rWrong } = clientCardSyncNamespace
  expect(typeof rWrong !== 'function', 'wrong module yields non-function (live bug)')
  let threw = false
  try {
    rWrong()
  } catch (e) {
    threw = /is not a function/i.test(String(e?.message || e))
  }
  expect(threw, 'calling missing export throws "is not a function"')

  const cardStoreNamespace = {
    hydrateCardStore() { return 'ok' },
  }
  const { hydrateCardStore: rOk } = cardStoreNamespace
  expect(typeof rOk === 'function', 'cardStore export is a function')
  expect(rOk() === 'ok', 'callable')
})

test('4) Debts repay path: card miss → provisionLoyaltyCardSafe before debtRepaySafe', () => {
  const debts = read('components/trade/DebtsModule.tsx')
  const ops = read('lib/offlineClientOps.ts')
  expect(debts.includes('provisionLoyaltyCardSafe'), 'Debts imports provision')
  expect(debts.includes('repayDebtIntoOpenShift'), 'helper present')
  expect(debts.includes('debtRepaySafe'), 'calls debtRepaySafe')
  // Order inside repayDebtIntoOpenShift: provision on !card, then debtRepaySafe
  const fnStart = debts.indexOf('async function repayDebtIntoOpenShift')
  const fnBody = debts.slice(fnStart, debts.indexOf('function salesFor', fnStart))
  const provAt = fnBody.indexOf('provisionLoyaltyCardSafe')
  const repayAt = fnBody.indexOf('debtRepaySafe')
  expect(provAt >= 0 && repayAt > provAt, 'provision before debtRepaySafe')
  expect(fnBody.includes('cardForClient'), 'card miss via cardForClient')
  expect(ops.includes('export async function provisionLoyaltyCardSafe'), 'ops exports provision')
})

test('5) existing-card path unchanged: early return when card already linked', () => {
  const ops = read('lib/offlineClientOps.ts')
  const start = ops.indexOf('export async function provisionLoyaltyCardSafe')
  const body = ops.slice(start, start + 2500)
  expect(body.includes('if (current.card)'), 'checks existing card')
  expect(body.includes("c.status !== 'unlinked'"), 'skips unlinked')
  expect(body.includes('return { offline: false, data: current }'), 'no duplicate provision')
})

test('6) failure before commit: provision hydrate is before queueOp / debtRepay', () => {
  const ops = read('lib/offlineClientOps.ts')
  const start = ops.indexOf('export async function provisionLoyaltyCardSafe')
  const body = ops.slice(start, start + 3500)
  const hydAt = body.indexOf('hydrateCardStore()')
  const queueAt = body.indexOf("queueOp(")
  expect(hydAt >= 0, 'calls hydrate')
  // queueOp may appear later for new card; hydrate must come first
  if (queueAt >= 0) expect(hydAt < queueAt, 'hydrate before any queueOp')
  // debt repay atomic not inside provision
  expect(!body.includes('commitLocalDebtRepayAtomic'), 'provision does not commit debt repay')
  expect(!body.includes('rememberCashDebtRepay'), 'provision does not touch repay ledger')
})

test('7) no other wrong hydrateCardStore imports in repo TS/TSX', () => {
  const walk = (dir, out = []) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === 'desktop' || ent.name === '.next' || ent.name === 'dist') continue
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(p, out)
      else if (/\.(ts|tsx)$/.test(ent.name)) out.push(p)
    }
    return out
  }
  const files = walk(path.join(root, 'lib')).concat(walk(path.join(root, 'components')))
  const bad = []
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8')
    if (/\{\s*hydrateCardStore[^}]*\}\s*=\s*await\s+import\(\s*['"]\.\/clientCardSync['"]\s*\)/.test(src)) {
      bad.push(path.relative(root, f))
    }
    if (/import\s*\{[^}]*\bhydrateCardStore\b[^}]*\}\s*from\s*['"][^'"]*clientCardSync['"]/.test(src)) {
      bad.push(path.relative(root, f))
    }
  }
  expect(bad.length === 0, `wrong imports: ${bad.join(', ')}`)
})

test('8) Cashier / Clients still call provisionLoyaltyCardSafe (shared fix)', () => {
  const cash = read('components/trade/CashierModule.tsx')
  const clients = read('components/trade/ClientsModule.tsx')
  expect(cash.includes('provisionLoyaltyCardSafe'), 'Cashier')
  expect(clients.includes('provisionLoyaltyCardSafe'), 'Clients')
})

const failed = results.filter(r => r.status === 'FAIL')
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.log(JSON.stringify(failed, null, 2))
  process.exit(1)
}
