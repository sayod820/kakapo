/**
 * Phase 7 — WS coalescing + Cashier keep-alive.
 * Run: node scripts/phase7-ws-coalesce-keepalive-test.mjs
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
    console.error(`FAIL  ${name}: ${e?.message || e}`)
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg)
}

const coalesceSrc = fs.readFileSync(path.join(root, 'lib', 'wsPullCoalesce.ts'), 'utf8')
const apiSyncSrc = fs.readFileSync(path.join(root, 'lib', 'useApiSync.ts'), 'utf8')
const cashierSrc = fs.readFileSync(path.join(root, 'components', 'trade', 'CashierModule.tsx'), 'utf8')
const tradeSrc = fs.readFileSync(path.join(root, 'components', 'trade', 'TradeApp.tsx'), 'utf8')
const syncPullSrc = fs.readFileSync(path.join(root, 'lib', 'syncPull.ts'), 'utf8')
const atomicSrc = fs.readFileSync(path.join(root, 'lib', 'localSaleAtomic.ts'), 'utf8')

// ── Mirror coalescer (sync fake clock) ─────────────────────────
function createCoalescer(handlers, coalesceMs = 600) {
  const runners = {}
  for (const s of Object.keys(handlers)) {
    runners[s] = { dirty: false, inFlight: false, timer: null, run: handlers[s] }
  }
  let eventCount = 0
  let syncRunCount = 0
  let coalescedCount = 0
  const timers = []

  function drain(scope) {
    const r = runners[scope]
    r.timer = null
    if (r.inFlight) { r.dirty = true; return }
    const loop = () => {
      if (!r.dirty) return
      r.dirty = false
      r.inFlight = true
      syncRunCount += 1
      const ret = r.run()
      const done = () => {
        r.inFlight = false
        if (r.dirty) loop()
      }
      if (ret && typeof ret.then === 'function') ret.then(done, done)
      else done()
    }
    loop()
  }

  function mark(scope) {
    eventCount += 1
    const r = runners[scope]
    if (r.dirty || r.inFlight || r.timer) coalescedCount += 1
    r.dirty = true
    if (r.inFlight) return
    if (r.timer) return
    const id = { scope, fireAt: Date.now() + coalesceMs }
    r.timer = id
    timers.push(id)
  }

  function advance(ms) {
    // fire due timers
    const now = Date.now()
    // simulate: reduce fireAt
    for (const t of timers) t.fireAt -= ms
    const due = timers.filter(t => t.fireAt <= now)
    for (const t of due) {
      const idx = timers.indexOf(t)
      if (idx >= 0) timers.splice(idx, 1)
      drain(t.scope)
    }
  }

  // simpler: flush all scheduled immediately for unit tests
  function flushScheduled() {
    const pending = timers.splice(0, timers.length)
    for (const t of pending) drain(t.scope)
  }

  return {
    mark,
    flushScheduled,
    stats: () => ({ eventCount, syncRunCount, coalescedCount }),
    crm: () => mark('crmSoft'),
    posSoft: () => mark('crmSoft'),
    posWarehouse: () => mark('posWarehouse'),
  }
}

// ── Source wiring ──────────────────────────────────────────────
test('S1 createWsPullCoalescer + shared crmSoft', () => {
  expect(coalesceSrc.includes('dirty') && coalesceSrc.includes('inFlight'), 'dirty/inFlight')
  expect(apiSyncSrc.includes('createWsPullCoalescer'), 'wired')
  expect(apiSyncSrc.includes("crm: () => mark('crmSoft')") || apiSyncSrc.includes('pull.crm()'), 'crm API')
  expect(apiSyncSrc.includes('crm + posSoft share') || apiSyncSrc.includes('share one softSyncPosAfterSale'), 'shared')
})

test('S2 sale no longer double-schedules crm+posSoft', () => {
  expect(apiSyncSrc.includes('No duplicate crm+posSoft'), 'comment')
  // Old pattern removed
  const saleBlock = apiSyncSrc.slice(
    apiSyncSrc.indexOf("kind === 'sale'"),
    apiSyncSrc.indexOf('Склад / поставщики'),
  )
  expect(saleBlock.includes('pull.posSoft()'), 'posSoft once')
  expect(!/pull\.crm\(\)[\s\S]*pull\.posSoft\(\)/.test(saleBlock), 'no crm then posSoft in sale block')
})

test('S3 Phase 5/6 untouched', () => {
  expect(atomicSrc.includes('commitLocalSaleAtomic'), 'atomic')
  expect(syncPullSrc.includes('shouldSkipFullPullForPending'), 'phase6 gate')
})

test('S4 TradeApp keep-alive 30s unchanged', () => {
  expect(tradeSrc.includes('30_000'), '30s')
  expect(tradeSrc.includes('salesKeepAlive'), 'keepalive')
  expect(tradeSrc.includes('active={salesActive}'), 'active prop')
})

test('S5 Cashier CAS+scanner gated by active', () => {
  expect(cashierSrc.includes('if (!active) return'), 'active early returns exist')
  expect(/pollBusy[\s\S]{0,80}setInterval|setInterval\([\s\S]{0,120}pollBusy/.test(cashierSrc), 'CAS poll interval')
  expect(/Phase 7: при active=false[\s\S]*if \(!active\) return/.test(cashierSrc), 'scanner gated')
  expect(/active,\s*\n\s*overlayBlocksSearch/.test(cashierSrc), 'active in scanner deps')
})

// ── TEST A — one sale → one soft run ───────────────────────────
test('TEST A one sale mark → one sync run', () => {
  let runs = 0
  const c = createCoalescer({ crmSoft: () => { runs += 1 } })
  c.posSoft()
  c.flushScheduled()
  expect(runs === 1, `runs=${runs}`)
  expect(c.stats().eventCount === 1, 'events')
})

// ── TEST B — 10 identical in window ────────────────────────────
test('TEST B 10 events coalesce to 1 run', () => {
  let runs = 0
  const c = createCoalescer({ crmSoft: () => { runs += 1 } })
  for (let i = 0; i < 10; i++) c.posSoft()
  c.flushScheduled()
  expect(runs === 1, `runs=${runs}`)
  expect(c.stats().coalescedCount >= 9, `coalesced=${c.stats().coalescedCount}`)
})

// ── TEST C — event during inFlight ─────────────────────────────
test('TEST C dirty during inFlight → second pass', async () => {
  let runs = 0
  const blockers = []
  const c = createCoalescer({
    crmSoft: () => new Promise(r => {
      runs += 1
      blockers.push(r)
    }),
  })
  c.posSoft()
  c.flushScheduled()
  expect(runs === 1, 'first started')
  c.posSoft() // during inFlight
  expect(c.stats().eventCount === 2, '2 events')
  blockers[0]()
  await Promise.resolve()
  await Promise.resolve()
  expect(runs === 2, `second pass runs=${runs}`)
})

// ── TEST D — different scopes ──────────────────────────────────
test('TEST D client+stock+pos scopes separate', () => {
  const counts = { crmSoft: 0, posWarehouse: 0 }
  const c = createCoalescer({
    crmSoft: () => { counts.crmSoft += 1 },
    posWarehouse: () => { counts.posWarehouse += 1 },
  })
  c.crm()
  c.posWarehouse()
  c.crm()
  c.flushScheduled()
  expect(counts.crmSoft === 1 && counts.posWarehouse === 1, JSON.stringify(counts))
})

// ── TEST E — 100 burst ─────────────────────────────────────────
test('TEST E 100-event burst → 1 network run', () => {
  let runs = 0
  const c = createCoalescer({ crmSoft: () => { runs += 1 } })
  for (let i = 0; i < 100; i++) c.posSoft()
  c.flushScheduled()
  expect(runs === 1, `runs=${runs}`)
  expect(c.stats().eventCount === 100, 'events counted')
})

// ── TEST F–J keep-alive source ─────────────────────────────────
test('TEST F CAS poll stops when active false (deps include active)', () => {
  const casIdx = cashierSrc.indexOf('Живой вес CAS')
  const endIdx = cashierSrc.indexOf('stopCasWeight', casIdx)
  const casChunk = cashierSrc.slice(casIdx, endIdx > casIdx ? endIdx : casIdx + 8000)
  expect(casChunk.includes('if (!active) return'), 'early return')
  expect(/\},\s*\[active\]\)/.test(casChunk), 'deps active')
})

test('TEST G keep-alive cart persist not gated (session save stays)', () => {
  expect(cashierSrc.includes('savePosSessionState'), 'cart persist')
  expect(tradeSrc.includes('30_000'), '30s window')
})

test('TEST H scanner/CAS re-bind on active flip (cleanup+deps)', () => {
  expect(cashierSrc.includes('window.removeEventListener(\'keydown\', onKeyDown, true)'), 'keydown cleanup')
  expect(cashierSrc.includes('window.clearInterval(pollId)'), 'CAS cleanup')
  expect(cashierSrc.includes('window.clearInterval(tick)'), 'focus tick cleanup')
})

test('TEST I unmount after keepalive — TradeApp clears salesKeepAlive', () => {
  expect(tradeSrc.includes('setSalesKeepAlive(false)'), 'unmount path')
  expect(tradeSrc.includes('setSalesKeepAlive(true)'), 'remount path')
})

test('TEST J sale path still local-first (atomic untouched)', () => {
  expect(atomicSrc.includes('COMMIT'), 'atomic')
  expect(cashierSrc.includes('createSaleSafe') || cashierSrc.includes('submitSale'), 'sale entry')
})

const failed = results.filter(r => r.status === 'FAIL')
const report = {
  phase: 7,
  title: 'WS coalescing + Cashier keep-alive',
  at: new Date().toISOString(),
  passed: results.filter(r => r.status === 'PASS').length,
  failed: failed.length,
  results,
}
fs.writeFileSync(path.join(root, 'phase7-ws-coalesce-keepalive-report.json'), JSON.stringify(report, null, 2))
console.log(`\n${report.passed} PASS / ${report.failed} FAIL → phase7-ws-coalesce-keepalive-report.json`)
process.exit(failed.length ? 1 : 0)

