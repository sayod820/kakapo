/**
 * Shift reconcile / active-shift selection tests.
 * Run: node scripts/shift-reconcile-test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  pickActiveOpenShift,
  planOrphanOffShiftAdopts,
  applyOrphanOffShiftAdoptsProjection,
  sameLogicalOpenSession,
} from '../lib/shiftReconcileCore.mjs'

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

const cashier = 'CASHIER-msbrov4p-5fleg'
const pos = 'POS-DEFAULT'
const serverShift = {
  id: 'SHIFT-mtuxu2kz-u4xco',
  status: 'open',
  posId: pos,
  cashierId: cashier,
  openedAtIso: '2026-09-10T10:00:00.000Z',
  salesCount: 142,
  salesCash: 1000,
}
const ghostOld = {
  id: 'off-shift-1786416457069-o6c8ck',
  status: 'open',
  posId: pos,
  cashierId: cashier,
  openedAtIso: '2026-09-09T08:00:00.000Z',
  salesCount: 69,
  salesCash: 500,
}
const ghostNewer = {
  id: 'off-shift-9999999999999-zzzzzz',
  status: 'open',
  posId: pos,
  cashierId: cashier,
  openedAtIso: '2026-09-11T01:00:00.000Z',
  salesCount: 3,
  salesCash: 10,
}

test('T1 online: prefers server open over off-shift (diag case)', () => {
  const picked = pickActiveOpenShift([ghostOld, serverShift, ghostNewer], {
    cashierId: cashier,
    posId: pos,
  })
  expect(picked?.id === serverShift.id, `got ${picked?.id}`)
})

test('T2 offline-only: newest off-shift stays usable', () => {
  const picked = pickActiveOpenShift([ghostOld, ghostNewer], {
    cashierId: cashier,
    posId: pos,
  })
  expect(picked?.id === ghostNewer.id, `got ${picked?.id}`)
})

test('T3 plan adopts all open off-shifts for same POS/cashier', () => {
  const plans = planOrphanOffShiftAdopts([ghostOld, ghostNewer, serverShift])
  expect(plans.length === 2, `plans=${plans.length}`)
  expect(plans.every(p => p.serverId === serverShift.id), 'server target')
})

test('T4 projection closes orphans, remaps sales, never deletes sales', () => {
  const sales = [
    { id: 's-on-ghost', shiftId: ghostOld.id, total: 10 },
    { id: 's-on-server', shiftId: serverShift.id, total: 20 },
    { id: 's-on-other', shiftId: 'SHIFT-other', total: 5 },
  ]
  const { shifts, sales: nextSales, remappedSaleIds } = applyOrphanOffShiftAdoptsProjection(
    [ghostOld, serverShift],
    sales,
    planOrphanOffShiftAdopts([ghostOld, serverShift]),
    '2026-09-11T12:00:00.000Z',
  )
  const closed = shifts.find(s => s.id === ghostOld.id)
  const auth = shifts.find(s => s.id === serverShift.id)
  expect(closed?.status === 'closed', 'ghost closed')
  expect(String(closed?.note || '').includes('adopted→'), 'note')
  expect(auth?.status === 'open', 'server stays open')
  expect(auth?.salesCount === 142, 'keeps server count via max')
  expect(nextSales.find(s => s.id === 's-on-ghost')?.shiftId === serverShift.id, 'sale remapped')
  expect(nextSales.length === 3, 'no sale deleted')
  expect(remappedSaleIds.includes('s-on-ghost'), 'remap tracked')
  expect(nextSales.find(s => s.id === 's-on-other')?.shiftId === 'SHIFT-other', 'unrelated intact')
})

test('T5 receipt history uses authoritative active shift', () => {
  const active = pickActiveOpenShift([ghostOld, serverShift], { cashierId: cashier, posId: pos })
  const sales = [
    { id: 'a', shiftId: serverShift.id },
    { id: 'b', shiftId: ghostOld.id },
  ]
  const inShift = sales.filter(s => String(s.shiftId) === String(active?.id))
  expect(inShift.length === 1 && inShift[0].id === 'a', 'history sees server sales')
})

test('T6 sameLogicalOpenSession POS mismatch', () => {
  expect(sameLogicalOpenSession(ghostOld, serverShift) === true, 'same')
  expect(sameLogicalOpenSession(ghostOld, { ...serverShift, posId: 'POS-OTHER' }) === false, 'other')
})

test('T7 CashierModule wires pickActiveOpenShift', () => {
  const src = fs.readFileSync(path.join(root, 'components', 'trade', 'CashierModule.tsx'), 'utf8')
  expect(src.includes('pickActiveOpenShift'), 'missing pick')
})

test('T8 softSync/syncPull/offline reject safety wired', () => {
  const posSrc = fs.readFileSync(path.join(root, 'lib', 'posStore.ts'), 'utf8')
  const pull = fs.readFileSync(path.join(root, 'lib', 'syncPull.ts'), 'utf8')
  const off = fs.readFileSync(path.join(root, 'lib', 'offline.ts'), 'utf8')
  expect(posSrc.includes('reconcileOrphanOpenOffShifts'), 'posStore')
  expect(pull.includes('reconcileOrphanOpenOffShifts'), 'syncPull')
  expect(off.includes('_shiftReconcileTries'), 'park not revert')
  expect(
    off.includes('sale_shift_lifecycle')
    || off.includes('flush_shift_lifecycle')
    || off.includes('sale_shift_not_found')
    || off.includes('flush_shift_not_found'),
    'reconcile hook',
  )
})

test('T9 duplicate reconcile idempotent', () => {
  const shifts0 = [ghostOld, serverShift]
  const sales0 = [{ id: 's1', shiftId: ghostOld.id }]
  const once = applyOrphanOffShiftAdoptsProjection(
    shifts0,
    sales0,
    planOrphanOffShiftAdopts(shifts0),
  )
  const plans2 = planOrphanOffShiftAdopts(once.shifts)
  expect(plans2.length === 0, 'no second adopt')
  const twice = applyOrphanOffShiftAdoptsProjection(once.shifts, once.sales, plans2)
  expect(twice.sales[0].shiftId === serverShift.id, 'stays remapped')
  expect(twice.shifts.filter(s => s.status === 'open').length === 1, 'one open')
})

test('T10 resolveOpenShift uses pickActiveOpenShift', () => {
  const src = fs.readFileSync(path.join(root, 'lib', 'offlinePosOps.ts'), 'utf8')
  expect(src.includes('pickActiveOpenShift'), 'resolveOpenShift')
})

test('T11 sale reject must not immediately revert on shift lifecycle errors', () => {
  const off = fs.readFileSync(path.join(root, 'lib', 'offline.ts'), 'utf8')
  const idx = off.indexOf('flush_shift_lifecycle')
  expect(idx > 0, 'handler missing')
  const slice = off.slice(idx, idx + 1200)
  expect(slice.includes('_shiftReconcileTries'), 'tries')
  expect(!slice.includes('revertLocalSaleOnReject'), 'must not revert in this branch')
})

const failed = results.filter(r => r.status === 'FAIL')
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
