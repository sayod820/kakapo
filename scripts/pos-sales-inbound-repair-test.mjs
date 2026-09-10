/**
 * POS sales Server→Desktop inbound gap / repair.
 * Run: node scripts/pos-sales-inbound-repair-test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
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

const repairSrc = fs.readFileSync(path.join(root, 'lib', 'posSalesInboundRepair.ts'), 'utf8')
const posStoreSrc = fs.readFileSync(path.join(root, 'lib', 'posStore.ts'), 'utf8')
const pullSrc = fs.readFileSync(path.join(root, 'lib', 'syncPull.ts'), 'utf8')
const cashierSrc = fs.readFileSync(path.join(root, 'components', 'trade', 'CashierModule.tsx'), 'utf8')
const conflictSrc = fs.readFileSync(path.join(root, 'lib', 'syncConflict.ts'), 'utf8')
const financeSrc = fs.readFileSync(path.join(root, 'lib', 'financeTruthCache.ts'), 'utf8')

// ── Mirror of pure helpers (keep in sync with posSalesInboundRepair.ts) ──
function countLocalSalesForShift(sales, shiftId) {
  const sid = String(shiftId || '').trim()
  if (!sid) return 0
  let n = 0
  for (const s of sales || []) {
    if (String(s?.shiftId || '').trim() !== sid) continue
    if (String(s?.status || '') === 'returned') continue
    n += 1
  }
  return n
}

function detectPosSalesInboundGaps(shifts, sales, nowMs = Date.now()) {
  const dayStart = new Date(nowMs)
  dayStart.setHours(0, 0, 0, 0)
  const dayStartMs = dayStart.getTime()
  const gaps = []
  for (const sh of shifts || []) {
    const shiftId = String(sh?.id || '').trim()
    if (!shiftId || shiftId.startsWith('off-')) continue
    const status = String(sh?.status || '')
    if (status === 'closed') {
      const closed = Date.parse(String(sh.closedAtIso || ''))
      if (!Number.isFinite(closed) || closed < dayStartMs) continue
    } else if (status && status !== 'open') continue
    const shiftSalesCount = Math.max(0, Math.floor(Number(sh.salesCount) || 0))
    if (shiftSalesCount <= 0) continue
    const localSalesCount = countLocalSalesForShift(sales, shiftId)
    const missing = shiftSalesCount - localSalesCount
    if (missing <= 0) continue
    gaps.push({ shiftId, shiftSalesCount, localSalesCount, missing, posId: sh.posId, status })
  }
  return gaps
}

function filterSalesForGapRepair(remoteSales, gaps) {
  if (!gaps.length) return []
  const shiftIds = new Set(gaps.map(g => g.shiftId))
  const posIds = new Set(gaps.map(g => g.posId).filter(Boolean))
  return (remoteSales || []).filter(s => {
    const sid = String(s?.shiftId || '').trim()
    if (sid && shiftIds.has(sid)) return true
    if (!sid && posIds.size && s?.posId && posIds.has(String(s.posId))) return true
    return false
  })
}

function mergeAppendById(localList, remoteList) {
  const map = new Map()
  const byRef = new Map()
  for (const row of localList || []) {
    const id = String(row?.id ?? '')
    if (!id) continue
    map.set(id, row)
    if (row.clientRef) byRef.set(String(row.clientRef), id)
  }
  for (const remote of remoteList || []) {
    const ref = remote.clientRef ? String(remote.clientRef) : ''
    if (ref && byRef.has(ref)) {
      const localId = byRef.get(ref)
      map.delete(localId)
      map.set(String(remote.id), remote)
      byRef.set(ref, String(remote.id))
      continue
    }
    const id = String(remote?.id ?? '')
    if (!id) continue
    map.set(id, remote)
  }
  return [...map.values()]
}

function saleInCurrentShift(sale, activeShiftId) {
  const curId = String(activeShiftId || '').trim()
  const saleShiftId = String(sale.shiftId || '').trim()
  if (saleShiftId && curId) return saleShiftId === curId
  return false
}

// A. local sale remains one receipt after remote echo
test('A local+remote same clientRef → one receipt', () => {
  const local = [{ id: 'off-1', clientRef: 'CR1', shiftId: '6968', total: 10 }]
  const remote = [{ id: 'SALE-1', clientRef: 'CR1', shiftId: '6968', total: 10 }]
  const merged = mergeAppendById(local, remote)
  expect(merged.length === 1, `len=${merged.length}`)
  expect(merged[0].id === 'SALE-1', 'adopt server id')
})

// B. server sales missing locally → merge restores
test('B server sales missing locally → restored', () => {
  const local = []
  const remote = [
    { id: 'S1', shiftId: '6968', total: 1 },
    { id: 'S2', shiftId: '6968', total: 2 },
  ]
  const merged = mergeAppendById(local, remote)
  expect(merged.length === 2, `len=${merged.length}`)
})

// C. 20 server → 20 local
test('C 20 server sales → exactly 20', () => {
  const remote = Array.from({ length: 20 }, (_, i) => ({
    id: `S${i}`, shiftId: '6968', total: i + 1,
  }))
  const merged = mergeAppendById([], remote)
  expect(merged.length === 20, `len=${merged.length}`)
})

// D. pull 10× → still 20
test('D idempotent merge 10× → still 20', () => {
  const remote = Array.from({ length: 20 }, (_, i) => ({
    id: `S${i}`, shiftId: '6968', clientRef: `R${i}`, total: 1,
  }))
  let local = []
  for (let i = 0; i < 10; i++) local = mergeAppendById(local, remote)
  expect(local.length === 20, `len=${local.length}`)
})

// E. offline local + server → both
test('E offline local + server sales preserved', () => {
  const local = [{ id: 'off-x', clientRef: 'LOC', shiftId: '6968', total: 5 }]
  const remote = [{ id: 'S9', clientRef: 'SRV', shiftId: '6968', total: 7 }]
  const merged = mergeAppendById(local, remote)
  expect(merged.length === 2, `len=${merged.length}`)
  expect(merged.some(s => s.id === 'off-x'), 'keep offline')
  expect(merged.some(s => s.id === 'S9'), 'keep server')
})

// F. source: durable persist called on repair
test('F repair persists pos_snapshot (force)', () => {
  expect(repairSrc.includes("persistPosSnapshot({ force: true })"), 'force persist')
  expect(repairSrc.includes('No stock') || repairSrc.includes('no stock') || repairSrc.includes('No stock / finance'), 'no side effects comment')
})

// G. cursor ahead + missing → gap detect + repair API
test('G gap detect when shift.salesCount > local sales', () => {
  const shifts = [{ id: '6968', status: 'open', salesCount: 5, salesCash: 100, posId: 'POS1' }]
  const sales = [{ id: 'S1', shiftId: '6968' }]
  const gaps = detectPosSalesInboundGaps(shifts, sales)
  expect(gaps.length === 1, `gaps=${gaps.length}`)
  expect(gaps[0].missing === 4, `missing=${gaps[0].missing}`)
  expect(repairSrc.includes('getSyncChanges(undefined, { scope: \'pos-lite\' })')
    || repairSrc.includes('getSyncChanges(undefined, { scope: "pos-lite" })'), 'full lite backfill')
})

// H. current shift filter
test('H current shift filter shows matching shiftId only', () => {
  const sales = [
    { id: 'A', shiftId: '6968' },
    { id: 'B', shiftId: '7000' },
  ]
  const cur = sales.filter(s => saleInCurrentShift(s, '6968'))
  expect(cur.length === 1 && cur[0].id === 'A', 'only 6968')
})

// I. previous shift does not leak
test('I other shift excluded from current', () => {
  const sales = [{ id: 'B', shiftId: '7000' }]
  expect(!saleInCurrentShift(sales[0], '6968'), 'no leak')
})

// J. returned sales not counted in gap local count
test('J returned sales excluded from local count', () => {
  const sales = [
    { id: '1', shiftId: '6968', status: 'ok' },
    { id: '2', shiftId: '6968', status: 'returned' },
  ]
  expect(countLocalSalesForShift(sales, '6968') === 1, 'count')
})

// K/L. repair must not touch stock/loyalty/outbox
test('K/L repair projection-only (no stock/loyalty/outbox)', () => {
  expect(!/queueOp|applyStock|bonusSpend|createPosSale\(/.test(repairSrc), 'no side-effect APIs')
  expect(repairSrc.includes('mergeSalesInbound'), 'uses merge')
})

// wiring
test('wired softSync + syncPull + cashier startup', () => {
  expect(posStoreSrc.includes('maybeRepairPosSalesInboundAfterMerge'), 'posStore')
  expect(pullSrc.includes('maybeRepairPosSalesInboundAfterMerge'), 'syncPull')
  expect(cashierSrc.includes('repairPosSalesInboundFromServer'), 'CashierModule')
  expect(cashierSrc.includes("reason: 'cashier_startup'"), 'startup force')
})

test('mergeSalesInbound still preserves off-* on full (source)', () => {
  expect(conflictSrc.includes('mergeSalesInbound'), 'export')
  expect(conflictSrc.includes("mode === 'delta'"), 'delta append')
})

test('Reports money can come from shift.salesCash (explains empty history)', () => {
  expect(financeSrc.includes('salesCash'), 'truth uses salesCash')
  expect(cashierSrc.includes('Чеков не найдено'), 'empty copy')
  expect(cashierSrc.includes('saleInCurrentShift') || cashierSrc.includes('saleShiftId === curId'), 'shift filter')
})

test('filterSalesForGapRepair keeps shift 6968 rows', () => {
  const gaps = [{ shiftId: '6968', shiftSalesCount: 2, localSalesCount: 0, missing: 2, posId: 'P1' }]
  const remote = [
    { id: '1', shiftId: '6968' },
    { id: '2', shiftId: '9999' },
  ]
  const f = filterSalesForGapRepair(remote, gaps)
  expect(f.length === 1 && f[0].id === '1', 'filtered')
})

function runReg(label, script) {
  const r = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', timeout: 120000 })
  expect(r.status === 0, `${label}: ${(r.stderr || r.stdout || '').slice(-500)}`)
}

test('REGRESSION phase6 push/pull gate', () => runReg('p6', 'scripts/phase6-push-pull-starvation-test.mjs'))
test('REGRESSION phase5 atomic sale', () => runReg('p5', 'scripts/phase5-atomic-sale-test.mjs'))

const failed = results.filter(r => r.status === 'FAIL')
const report = {
  title: 'POS sales inbound repair',
  generatedAtIso: new Date().toISOString(),
  rootCause: 'pos-lite cursor can advance via shifts/CRM while sale rows with older stamps were never merged; UI history filters sales[] by shiftId while reports use shift.salesCash',
  passed: results.length - failed.length,
  failed: failed.length,
  results,
}
fs.writeFileSync(path.join(root, 'scripts', 'pos-sales-inbound-repair-report.json'), JSON.stringify(report, null, 2))
console.log(`\nInbound repair: ${report.passed}/${results.length} passed`)
if (failed.length) process.exitCode = 1
