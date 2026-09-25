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
