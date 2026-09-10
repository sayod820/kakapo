/**
 * Phase 0 baseline helper — static confirmation of ghost-outbox (AUDIT P1).
 * Run: node scripts/phase0-baseline-check.mjs
 * Does not mutate app data; only inspects source for known anti-patterns.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const offlinePath = path.join(root, 'lib', 'offline.ts')
const syncPath = path.join(root, 'lib', 'offlineSync.ts')
const cashierPath = path.join(root, 'components', 'trade', 'CashierModule.tsx')
const salePath = path.join(root, 'lib', 'offlinePosOps.ts')

function read(p) {
  return fs.readFileSync(p, 'utf8')
}

const offline = read(offlinePath)
const sync = read(syncPath)
const cashier = read(cashierPath)
const sale = read(salePath)

const findings = []

// P1 ghost outbox: deletePending early-return without localStorage clear
{
  const fn = offline.match(/async function deletePending\([\s\S]*?\n\}/)
  const body = fn?.[0] || ''
  const clearsLs = /lsQueueWrite\(lsQueueRead\(\)\.filter/.test(body)
  const earlyReturnAfterDesk = /localDbQueueDelete[\s\S]*?\n\s*return/.test(body)
  const earlyReturnAfterIdb = /idbRun\(STORE_QUEUE[\s\S]*?s\.delete[\s\S]*?\n\s*return/.test(body)
  const getPendingMergesLs = /for \(const row of lsQueueRead\(\)\)/.test(offline)
  findings.push({
    id: 'P1_ghost_outbox',
    severity: 'critical',
    confirmed:
      earlyReturnAfterDesk
      && !/localDbQueueDelete[\s\S]*lsQueueWrite[\s\S]*return/.test(body.split('if (desk')[1] || ''),
    detail: {
      deletePendingClearsLsOnlyOnFallback: clearsLs && earlyReturnAfterDesk,
      earlyReturnAfterDesk,
      earlyReturnAfterIdb,
      getPendingMergesLocalStorage: getPendingMergesLs,
      note: 'putPending always writes LS; deletePending on Desktop returns after SQLite(+IDB) without LS clear → ACK ops can resurrect via getPending LS merge',
    },
  })
}

// P2 reconnect timer not reschedulable to earlier
{
  const fn = sync.match(/function scheduleReconnect\([\s\S]*?\n\}/)
  const body = fn?.[0] || ''
  const ignoresIfExists = /if \(reconnectTimer\) return/.test(body)
  findings.push({
    id: 'P2_reconnect_timer',
    severity: 'high',
    confirmed: ignoresIfExists,
    detail: {
      scheduleReconnectBailsIfTimerExists: ignoresIfExists,
      note: 'new queueOp(600ms) cannot pull forward an existing 45s stuck timer',
    },
  })
}

// P4 full products map on sale
{
  const mapsAll = /products: s\.products\.map\(p => \{[\s\S]*decById\.get\(p\.id\)/.test(sale)
  findings.push({
    id: 'P4_full_products_rewrite',
    severity: 'high',
    confirmed: mapsAll,
    detail: {
      createSaleSafeMapsEntireCatalog: mapsAll,
      cashierSubscribesToFullProducts: /useProducts\(s => s\.products\)/.test(cashier),
    },
  })
}

// P5 softSyncWarehouse on register entry
{
  const onRegister = /posSurface !== 'register'[\s\S]{0,80}softSyncWarehouse/.test(cashier)
    || /if \(!active \|\| posSurface !== 'register'\) return\s*\n\s*void softSyncWarehouse/.test(cashier)
  findings.push({
    id: 'P5_warehouse_on_register',
    severity: 'high',
    confirmed: /void softSyncWarehouse\(\{ expiryDays: 14 \}\)/.test(cashier)
      && /posSurface !== 'register'/.test(cashier),
    detail: {
      softSyncWarehouseOnRegisterEffect: true,
      softSyncWarehouseOnAlertsOpen: /alertsOpen[\s\S]{0,60}softSyncWarehouse/.test(cashier),
    },
  })
}

// Telemetry present
{
  const tele = fs.existsSync(path.join(root, 'lib', 'devTelemetry.ts'))
  findings.push({
    id: 'P0_telemetry',
    severity: 'info',
    confirmed: tele,
    detail: {
      module: 'lib/devTelemetry.ts',
      enable: "localStorage.setItem('kakapo_perf','1'); location.reload()",
      api: 'window.__kakapoPerf.snapshot()',
    },
  })
}

const report = {
  phase: 0,
  generatedAt: new Date().toISOString(),
  findings,
  runtimeBaseline: {
    status: 'pending_manual',
    scenarios: [
      'register_entry',
      'scan_product',
      'add_product',
      'one_sale',
      '10_sales',
      'reconnect_after_offline',
    ],
    how: [
      "1. Desktop Trade: localStorage.setItem('kakapo_perf','1'); reload",
      "2. Run scenario; optionally __kakapoPerf.scenario('one_sale')",
      "3. Copy __kakapoPerf.snapshot() JSON here / to chat",
    ],
  },
}

const outDir = path.join(root, 'scripts')
const outFile = path.join(outDir, 'phase0-baseline-report.json')
fs.writeFileSync(outFile, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
console.log(`\nWrote ${outFile}`)
