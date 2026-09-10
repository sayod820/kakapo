/**
 * Phase 3 — register entry must not trigger softSyncWarehouse.
 * Run: node scripts/phase3-register-entry-test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cashier = fs.readFileSync(path.join(root, 'components', 'trade', 'CashierModule.tsx'), 'utf8')
const posStore = fs.readFileSync(path.join(root, 'lib', 'posStore.ts'), 'utf8')

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

/** Extract register-related useEffects roughly */
function effectsMentioning(src, needle) {
  const blocks = []
  const re = /useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\)/g
  let m
  while ((m = re.exec(src))) {
    if (m[0].includes(needle)) blocks.push(m[0])
  }
  return blocks
}

test('A — register effect does not call softSyncWarehouse', () => {
  const blocks = effectsMentioning(cashier, "posSurface !== 'register'")
  expect(blocks.length >= 1, 'register effects exist')
  for (const b of blocks) {
    expect(!b.includes('softSyncWarehouse'), 'register effect still calls softSyncWarehouse')
  }
  expect(!/posSurface !== 'register'[\s\S]{0,120}softSyncWarehouse/.test(cashier), 'nearby register→warehouse')
})

test('B — softSyncWarehouse still exists for Warehouse/WS', () => {
  expect(posStore.includes('export async function softSyncWarehouse'), 'API kept')
  expect(posStore.includes('warehouseSoftSyncInFlight'), 'in-flight dedupe kept')
})

test('C — softSyncExpiry for alerts (not full warehouse)', () => {
  expect(posStore.includes('export async function softSyncExpiry'), 'softSyncExpiry exists')
  expect(posStore.includes('getStockExpiry'), 'expiry GET')
  expect(!/softSyncExpiry[\s\S]{0,400}pullSyncChanges/.test(posStore), 'expiry must not pullSync')
  expect(!/softSyncExpiry[\s\S]{0,600}pullStockLayersFromServer/.test(posStore), 'expiry must not pull layers')
  const alertBlocks = effectsMentioning(cashier, 'alertsOpen')
  const syncAlert = alertBlocks.find(b => b.includes('softSync') || b.includes('Expiry'))
  expect(!!syncAlert, 'alerts has sync effect')
  expect(syncAlert.includes('softSyncExpiry'), 'alerts uses softSyncExpiry')
  expect(!syncAlert.includes('softSyncWarehouse'), 'alerts must not full warehouse')
})

test('D — rapid nav: warehouse inFlight still singleton', () => {
  expect(/if \(warehouseSoftSyncInFlight\) return warehouseSoftSyncInFlight/.test(posStore), 'dedupe')
})

test('E — Cashier no longer imports softSyncWarehouse', () => {
  expect(!/import \{[^}]*softSyncWarehouse[^}]*\} from '@\/lib\/posStore'/.test(cashier), 'import removed')
  expect(/softSyncExpiry/.test(cashier), 'imports softSyncExpiry')
})

test('F — register_open_local telemetry marker', () => {
  expect(cashier.includes("perfScenario('register_open_local')"), 'marker')
})

test('G — softSyncWarehouse parts documented as heavy', () => {
  expect(posStore.includes('НЕ вызывать из critical register entry')
    || posStore.includes('critical register'), 'warning comment')
})

const failed = results.filter(r => r.status === 'FAIL')
const report = {
  phase: 3,
  generatedAt: new Date().toISOString(),
  oldEntryFlow: {
    trigger: "useEffect([active, posSurface]) when register",
    call: 'void softSyncWarehouse({ expiryDays: 14 })',
    internals: ['pullSyncChanges', 'api.getStockExpiry', 'pullStockLayersFromServer({ bumpProducts: true })'],
    note: 'void = non-awaited but still starts heavy work + state updates on open',
  },
  newEntryFlow: {
    trigger: 'same deps',
    call: 'none (local-only + register_open_local marker)',
    alerts: 'softSyncExpiry only (throttled GET expiry)',
    freshness: 'WS posWarehouse / WarehouseModule / existing sync',
  },
  summary: {
    total: results.length,
    passed: results.filter(r => r.status === 'PASS').length,
    failed: failed.length,
  },
  results,
}
const out = path.join(root, 'scripts', 'phase3-register-entry-report.json')
fs.writeFileSync(out, JSON.stringify(report, null, 2))
console.log('\n' + JSON.stringify(report.summary, null, 2))
console.log(`Wrote ${out}`)
process.exit(failed.length ? 1 : 0)
