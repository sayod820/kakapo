/**
 * Shift lifecycle + sale shift safety tests.
 * Run: node scripts/shift-lifecycle-test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  pickActiveOpenShift,
  planOrphanOffShiftAdopts,
  applyOrphanOffShiftAdoptsProjection,
} from '../lib/shiftReconcileCore.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const results = []

const queue = []
function test(name, fn) {
  queue.push([name, fn])
}
async function runAll() {
  for (const [name, fn] of queue) {
    try {
      await fn()
      results.push({ name, status: 'PASS' })
      console.log(`PASS  ${name}`)
    } catch (e) {
      results.push({ name, status: 'FAIL', error: String(e?.message || e) })
      console.error(`FAIL  ${name}:`, e?.message || e)
    }
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg || 'assert')
}
function read(p) {
  return fs.readFileSync(path.join(root, p), 'utf8')
}

const offline = read('lib/offline.ts')
const ops = read('lib/offlinePosOps.ts')
const posLogic = read('server/kakapo-api/posLogic.js')
const indexJs = read('server/kakapo-api/index.js')
const posStore = read('lib/posStore.ts')

test('T1 server createPosSale rejects closed shift (SHIFT_CLOSED)', () => {
  expect(posLogic.includes("err.code = 'SHIFT_CLOSED'"), 'code')
  expect(posLogic.includes("String(shift.status || '') !== 'open'"), 'status check')
  expect(indexJs.includes('code: e?.code'), 'API returns code')
})

test('T2 shift_close priority before shift_open', () => {
  expect(/shift_close.*return -45|return -45[\s\S]*shift_close/s.test(offline) || offline.includes("kind === 'shift_close') return -45"), 'prio')
  const closeIdx = offline.indexOf("kind === 'shift_close') return -45")
  const openIdx = offline.indexOf("kind === 'shift_open'")
  expect(closeIdx > 0 && openIdx > 0, 'both present')
})

test('T3 open waits behind pending close (BrokenRef barrier)', () => {
  expect(offline.includes('Сначала закройте предыдущую смену'), 'barrier msg')
  expect(offline.includes('BrokenRefError'), 'BrokenRef')
  expect(offline.includes('e instanceof BrokenRefError'), 'flush parks BrokenRef')
})

test('T4 already-open adopts instead of blind delete', () => {
  expect(offline.includes('shift_open_already_open') || offline.includes('flush_shift_open_already_open'), 'adopt reason')
  expect(!/revertLocalOpeningFloat\(localId\)[\s\S]{0,120}shifts\.filter\(sh => sh\.id !== localId\)/.test(offline), 'old delete path gone')
})

test('T5 shift_close already closed is idempotent success', () => {
  expect(offline.includes('смена уже закрыта') && offline.includes('markShiftCloseAcked'), 'ack')
})

test('T6 sale on closed/not-found parks — no immediate revert', () => {
  expect(offline.includes('SHIFT_CLOSED') || offline.includes('смена уже закрыта'), 'closed')
  const idx = offline.indexOf('flush_shift_lifecycle')
  expect(idx > 0, 'lifecycle park')
  const slice = offline.slice(idx, idx + 800)
  expect(!slice.includes('revertLocalSaleOnReject'), 'no revert in park branch')
})

test('T7 resolveSalePayload keeps sale on its own (closed) shift', () => {
  const idx = offline.indexOf('async function resolveSalePayload')
  expect(idx > 0, 'resolveSalePayload')
  const slice = offline.slice(idx, idx + 1200)
  expect(!slice.includes("row.status !== 'open'"), 'must not reroute closed shift')
  expect(slice.includes('hasPendingShiftOpen'), 'waits for own shift_open')
})

test('T7b flush does not reroute SHIFT_CLOSED sale to another shift', () => {
  const idx = offline.indexOf('flush_shift_lifecycle')
  const slice = offline.slice(Math.max(0, idx - 900), idx)
  expect(slice.includes('ownShiftClosed'), 'ownShiftClosed guard')
})

test('T7c locally closed shift never resurrected by inbound open', async () => {
  const { protectLocallyClosedShifts } = await import('../lib/shiftReconcileCore.mjs')
  const local = [{ id: 'SHIFT-A', status: 'closed', closedAtIso: '2026-09-24T18:00:00.000Z', actualCash: 500 }]
  const inbound = [
    { id: 'SHIFT-A', status: 'open', salesCount: 9, updatedAtIso: '2026-09-24T18:05:00.000Z' },
    { id: 'SHIFT-B', status: 'open' },
  ]
  const out = protectLocallyClosedShifts(local, inbound)
  const a = out.find(s => s.id === 'SHIFT-A')
  expect(a.status === 'closed', 'A stays closed')
  expect(a.actualCash === 500 && a.closedAtIso === local[0].closedAtIso, 'close fields kept')
  expect(a.salesCount === 9, 'server counters kept')
  expect(out.find(s => s.id === 'SHIFT-B').status === 'open', 'other open untouched')
  expect(protectLocallyClosedShifts([], inbound) === inbound, 'no-op identity')
  for (const f of ['lib/syncPull.ts', 'lib/posStore.ts', 'lib/offline.ts']) {
    expect(read(f).includes('protectLocallyClosedShifts'), `${f} wired`)
  }
})

test('T7d server accepts late queued sale into its closed shift + recomputes diff', async () => {
  const { createPosSale } = await import('../server/kakapo-api/posLogic.js')
  const shift = {
    id: 'SHIFT-late', status: 'closed', posId: 'POS-1', cashierId: '',
    openedAtIso: '2026-09-24T08:00:00.000Z', closedAtIso: '2026-09-24T18:00:00.000Z',
    openingCash: 0, salesCash: 100, salesCard: 0, salesCount: 1, cashInTotal: 0, expenseTotal: 0,
    actualCash: 150, closingCash: 150, expectedCash: 100, cashDiff: 50,
  }
  const db = {
    posShifts: [shift], posSales: [], cashiers: [], posPoints: [{ id: 'POS-1', name: 'P' }],
    clients: [], cards: [], orders: [], products: [{ id: 1, name: 'X', price: 50, stock: 10 }],
    stockReceipts: [{ id: 'RCPT-1', items: [{ productId: 1, qty: 10, remainingQty: 10, costPrice: 10 }] }],
  }
  const base = {
    shiftId: 'SHIFT-late', posId: 'POS-1', paymentMethod: 'cash', paidCash: 50, total: 50,
    items: [{ productId: 1, qty: 1, price: 50 }],
  }
  let rejected = false
  try { createPosSale(db, { ...base, clientRef: 'r-online' }) } catch (e) { rejected = e.code === 'SHIFT_CLOSED' }
  expect(rejected, 'online sale into closed shift still rejected')
  let afterClose = false
  try {
    createPosSale(db, { ...base, clientRef: 'r-after', appliedLocal: true, createdAtIso: '2026-09-25T09:00:00.000Z' })
  } catch (e) { afterClose = e.code === 'SHIFT_CLOSED' }
  expect(afterClose, 'sale made after close rejected')
  const sale = createPosSale(db, { ...base, clientRef: 'r-late', appliedLocal: true, createdAtIso: '2026-09-24T17:30:00.000Z' })
  expect(sale.shiftId === 'SHIFT-late', `sale on own shift, got ${sale.shiftId}`)
  expect(shift.status === 'closed', 'shift stays closed')
  expect(shift.salesCash === 150 && shift.expectedCash === 150 && shift.cashDiff === 0, `diff recomputed ${shift.expectedCash}/${shift.cashDiff}`)
})

test('T7e late sale tagged with wrong closed shift lands on the shift it was made in', async () => {
  const { createPosSale } = await import('../server/kakapo-api/posLogic.js')
  const mk = (id, o, c) => ({
    id, status: 'closed', posId: 'POS-1', cashierId: '', openedAtIso: o, closedAtIso: c,
    openingCash: 0, salesCash: 0, salesCard: 0, salesCount: 0, cashInTotal: 0, expenseTotal: 0,
    actualCash: 0, closingCash: 0, expectedCash: 0, cashDiff: 0,
  })
  const d23 = mk('SHIFT-23', '2026-09-23T02:44:00.000Z', '2026-09-23T16:58:00.000Z')
  const d24 = mk('SHIFT-24', '2026-09-24T02:57:00.000Z', '2026-09-24T17:04:00.000Z')
  const db = {
    posShifts: [d23, d24], posSales: [], cashiers: [], posPoints: [{ id: 'POS-1', name: 'P' }],
    clients: [], cards: [], orders: [], products: [{ id: 1, name: 'X', price: 50, stock: 10 }],
    stockReceipts: [{ id: 'RCPT-1', items: [{ productId: 1, qty: 10, remainingQty: 10, costPrice: 10 }] }],
  }
  const sale = createPosSale(db, {
    shiftId: 'SHIFT-24', posId: 'POS-1', paymentMethod: 'cash', paidCash: 50, total: 50,
    items: [{ productId: 1, qty: 1, price: 50 }],
    clientRef: 'r-23', appliedLocal: true, createdAtIso: '2026-09-23T16:07:00.000Z',
  })
  expect(sale.shiftId === 'SHIFT-23', `moved to own shift, got ${sale.shiftId}`)
  expect(d23.salesCash === 50 && d24.salesCash === 0, 'counters on own shift')
})

test('T7f SHIFT_CLOSED / off- shift sales no longer arm desktop recovery; stale arm auto-exits', async () => {
  const orch = await import('../lib/desktopRecoveryOrchestratorCore.mjs')
  const queue = [
    { clientRef: 'a', kind: 'sale', failed: true, lastError: 'SHIFT_CLOSED: Смена уже закрыта', payload: { shiftId: 'SHIFT-23' } },
    { clientRef: 'b', kind: 'sale', failed: false, lastError: '', payload: { shiftId: 'off-shift-1' } },
  ]
  const d = orch.detectRecoveryNeed({ queue, meta: {}, appVersion: '2', previousAppVersion: '1' })
  expect(!d.need, JSON.stringify(d.reasons))
  expect(orch.canAutoExitStaleRecovery({ queue, meta: { recoveryMode: true, recoverySession: { status: 'CLASSIFIED', phase: 'RECOVERY_PREPARE' } } }).ok, 'stale exits')
  expect(orch.canAutoExitStaleRecovery({ queue, meta: { recoverySession: { remappedClientRefs: ['a'], targetServerShiftId: 'SHIFT-R' } } }).ok, 'half-run session exits too')
  expect(!orch.canAutoExitStaleRecovery({ queue: null, meta: {} }).ok, 'unreadable queue stays')
  const o = read('lib/desktopRecoveryOrchestrator.ts')
  expect(o.includes('canAutoExitStaleRecovery') && !o.includes('ackPending'), 'orchestrator wired')
  expect(o.includes('if (detect.need) {'), 'exit on any detected need')
})

test('T7i parked shift/idempotency sales auto-retry; server-held clientRef acks', () => {
  expect(offline.includes('function isAutoRetryFailedSale'), 'helper')
  expect(offline.includes('(!r.failed || isAutoRetryFailedSale(r))'), 'flush picks parked shift sales')
  const idx = offline.indexOf("live.kind === 'sale' && /IDEMPOTENCY_KEY_REUSED")
  expect(idx > 0, 'idempotency ack branch')
  expect(offline.slice(idx, idx + 300).includes('deletePending(live.clientRef)'), 'acks queue row')
})

test('T7g server-closed shift beats fresher local open (morning stale shift)', async () => {
  const { adoptServerClosedShifts } = await import('../lib/shiftReconcileCore.mjs')
  const local = [
    { id: 'SHIFT-24', status: 'open', clientRef: 'normal-open-1', salesCount: 212, updatedAtIso: '2026-09-25T03:10:00.000Z' },
    { id: 'off-shift-x', status: 'open', clientRef: 'normal-open-2' },
  ]
  const remote = [{ id: 'SHIFT-24', status: 'closed', clientRef: 'normal-open-1', closedAtIso: '2026-09-24T17:04:17.934Z', actualCash: 900, updatedAtIso: '2026-09-24T17:04:18.000Z' }]
  const out = adoptServerClosedShifts(local, remote)
  const a = out.find(s => s.id === 'SHIFT-24')
  expect(a.status === 'closed' && a.closedAtIso === remote[0].closedAtIso && a.actualCash === 900, 'adopted close')
  expect(out.find(s => s.id === 'off-shift-x').status === 'open', 'other open untouched')
  const byRef = adoptServerClosedShifts([{ id: 'off-shift-y', status: 'open', clientRef: 'normal-open-1' }], remote)
  expect(byRef[0].status === 'closed', 'matched by clientRef')
  expect(adoptServerClosedShifts(local, []) === local, 'no-op identity')
  for (const f of ['lib/syncPull.ts', 'lib/posStore.ts']) {
    expect(read(f).includes('adoptServerClosedShifts'), `${f} wired`)
  }
  expect(posStore.includes('lastOpenShiftProbeAt'), 'delta probe for missed close')
})

test('T7h sale made after its shift closed goes to current open shift, waits without burning tries', () => {
  expect(offline.includes('async function saleMadeAfterShiftClose'), 'helper')
  const idx = offline.indexOf('const madeAfterClose')
  expect(idx > 0, 'flush uses helper')
  const slice = offline.slice(idx, idx + 2400)
  expect(slice.includes('(tries < 2 || madeAfterClose) && !ownShiftClosed'), 'reroute allowed')
  expect(slice.includes('madeAfterClose ? tries : tries + 1'), 'tries not burned')
})

test('T8 ensureDurableShiftCloses wired in softSync', () => {
  expect(ops.includes('ensureDurableShiftCloses'), 'ops')
  expect(posStore.includes('ensureDurableShiftCloses'), 'posStore')
})

test('T9 active shift still prefers server open (1.2.177)', () => {
  const ghost = { id: 'off-shift-1', status: 'open', posId: 'POS-DEFAULT', cashierId: 'C1', openedAtIso: '2026-09-11T01:00:00.000Z', salesCount: 5 }
  const srv = { id: 'SHIFT-real', status: 'open', posId: 'POS-DEFAULT', cashierId: 'C1', openedAtIso: '2026-09-10T02:00:00.000Z', salesCount: 100 }
  const picked = pickActiveOpenShift([ghost, srv], { cashierId: 'C1', posId: 'POS-DEFAULT' })
  expect(picked?.id === 'SHIFT-real', 'server wins')
})

test('T10 adopt plan closes ghosts without deleting sales', () => {
  const ghost = { id: 'off-shift-1', status: 'open', posId: 'P', cashierId: 'C', openedAtIso: '2026-09-11T01:00:00.000Z', salesCount: 2 }
  const srv = { id: 'SHIFT-x', status: 'open', posId: 'P', cashierId: 'C', openedAtIso: '2026-09-10T02:00:00.000Z', salesCount: 10 }
  const sales = [{ id: 's1', shiftId: ghost.id }, { id: 's2', shiftId: srv.id }]
  const { shifts, sales: next } = applyOrphanOffShiftAdoptsProjection(
    [ghost, srv],
    sales,
    planOrphanOffShiftAdopts([ghost, srv]),
  )
  expect(next.length === 2, 'sales kept')
  expect(next.find(s => s.id === 's1')?.shiftId === 'SHIFT-x', 'remapped')
  expect(shifts.find(s => s.id === ghost.id)?.status === 'closed', 'ghost closed')
})

test('T11 openShiftSafe refuses when server open already local', () => {
  expect(ops.includes("!String(s.id || '').startsWith('off-')"), 'server open guard')
})

test('T12 API error surfaces code for client match', () => {
  const api = read('lib/api.ts')
  expect(api.includes('json.code'), 'code in parseErrorText')
})

await runAll()
const failed = results.filter(r => r.status === 'FAIL')
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
