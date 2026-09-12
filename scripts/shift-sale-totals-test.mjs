/**
 * Current-shift totals from unique posSales (exact shiftId).
 * Run: node scripts/shift-sale-totals-test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  uniqueSalesForShift,
  aggregateShiftSaleTotals,
  overlayShiftSaleTotals,
  preferSaleRow,
  saleDedupeKey,
} from '../lib/shiftSaleTotalsCore.mjs'
import {
  planOrphanOffShiftAdopts,
  applyOrphanOffShiftAdoptsProjection,
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

const SHIFT = 'SHIFT-mtwi7klw-yl4r6'
const OLD = 'SHIFT-mtuxu2kz-u4xco'

test('T1 exact shiftId only — no old-shift leak', () => {
  const sales = [
    { id: 'a', clientRef: 'r1', shiftId: SHIFT, total: 0.33, paidCash: 0.33, paidCard: 0, debtAdded: 0 },
    { id: 'b', clientRef: 'r2', shiftId: SHIFT, total: 0.33, paidCash: 0.33, paidCard: 0, debtAdded: 0 },
    { id: 'old', clientRef: 'ro', shiftId: OLD, total: 100, paidCash: 100, paidCard: 0, debtAdded: 0 },
  ]
  const t = aggregateShiftSaleTotals(sales, SHIFT)
  expect(t.salesCount === 2, `count=${t.salesCount}`)
  expect(t.salesCash === 0.66, `cash=${t.salesCash}`)
  expect(t.revenue === 0.66, `rev=${t.revenue}`)
})

test('T2 dedupe offline+server by clientRef — count once', () => {
  const sales = [
    { id: 'off-sale-1', clientRef: 'same', shiftId: SHIFT, total: 10, paidCash: 10, paidCard: 0, debtAdded: 0, createdAtIso: '2026-09-11T05:00:00.000Z' },
    { id: 'SALE-server-1', clientRef: 'same', shiftId: SHIFT, total: 10, paidCash: 10, paidCard: 0, debtAdded: 0, createdAtIso: '2026-09-11T05:00:01.000Z' },
    { id: 'SALE-2', clientRef: 'other', shiftId: SHIFT, total: 5, paidCash: 5, paidCard: 0, debtAdded: 0 },
  ]
  const uniq = uniqueSalesForShift(sales, SHIFT)
  expect(uniq.length === 2, `uniq=${uniq.length}`)
  expect(uniq.some(s => s.id === 'SALE-server-1'), 'prefer server id')
  const t = aggregateShiftSaleTotals(sales, SHIFT)
  expect(t.salesCount === 2 && t.salesCash === 15, JSON.stringify(t))
})

test('T3 stale denormalized counters ignored by overlay', () => {
  const shift = {
    id: SHIFT,
    status: 'open',
    openingCash: 1809.97,
    salesCount: 79,
    salesCash: 1379.99,
    salesCard: 50,
    salesCredit: 20,
    cashInTotal: 0,
    expenseTotal: 0,
  }
  const sales = [
    { id: '1', clientRef: 'a', shiftId: SHIFT, total: 0.33, paidCash: 0.33, paidCard: 0, debtAdded: 0 },
    { id: '2', clientRef: 'b', shiftId: SHIFT, total: 0.33, paidCash: 0.33, paidCard: 0, debtAdded: 0 },
    { id: '3', clientRef: 'c', shiftId: SHIFT, total: 4.5, paidCash: 4.5, paidCard: 0, debtAdded: 0 },
    { id: '4', clientRef: 'd', shiftId: SHIFT, total: 4.5, paidCash: 4.5, paidCard: 0, debtAdded: 0 },
    { id: '5', clientRef: 'e', shiftId: SHIFT, total: 4.5, paidCash: 4.5, paidCard: 0, debtAdded: 0 },
    { id: '6', clientRef: 'f', shiftId: SHIFT, total: 4.5, paidCash: 4.5, paidCard: 0, debtAdded: 0 },
  ]
  const live = overlayShiftSaleTotals(shift, sales)
  expect(live.salesCount === 6, `count=${live.salesCount}`)
  expect(live.salesCash === 18.66, `cash=${live.salesCash}`)
  expect(live.salesCard === 0 && live.salesCredit === 0, 'card/credit')
  expect(live.openingCash === 1809.97, 'opening preserved')
})

test('T4 orphan adopt must not max-fold ghost counters into new shift', () => {
  const ghost = {
    id: 'off-shift-old',
    status: 'open',
    posId: 'POS-DEFAULT',
    cashierId: 'C1',
    salesCount: 79,
    salesCash: 1379.99,
  }
  const server = {
    id: SHIFT,
    status: 'open',
    posId: 'POS-DEFAULT',
    cashierId: 'C1',
    salesCount: 2,
    salesCash: 0.66,
  }
  const sales = [
    { id: 's1', clientRef: 'a', shiftId: SHIFT, total: 0.33, paidCash: 0.33, paidCard: 0, debtAdded: 0 },
    { id: 's2', clientRef: 'b', shiftId: SHIFT, total: 0.33, paidCash: 0.33, paidCard: 0, debtAdded: 0 },
    { id: 'g1', clientRef: 'g', shiftId: ghost.id, total: 9, paidCash: 9, paidCard: 0, debtAdded: 0 },
  ]
  const plans = planOrphanOffShiftAdopts([ghost, server])
  expect(plans.length === 1, 'one plan')
  const { shifts, sales: next } = applyOrphanOffShiftAdoptsProjection(
    [ghost, server],
    sales,
    plans,
  )
  const auth = shifts.find(s => s.id === SHIFT)
  expect(auth.salesCount === 3, `count=${auth.salesCount} (2+remapped, not 79)`)
  expect(auth.salesCash === 9.66, `cash=${auth.salesCash}`)
  expect(next.filter(s => s.shiftId === SHIFT).length === 3, 'remapped')
  expect(shifts.find(s => s.id === ghost.id)?.status === 'closed', 'ghost closed')
})

test('T5 offline sale appears immediately in totals without server ACK', () => {
  const sales = [
    { id: 'off-sale-new', clientRef: 'pending', shiftId: SHIFT, total: 7, paidCash: 7, paidCard: 0, debtAdded: 0 },
  ]
  const t = aggregateShiftSaleTotals(sales, SHIFT)
  expect(t.salesCount === 1 && t.salesCash === 7, JSON.stringify(t))
})

test('T6 reconnect: same clientRef remains once after server copy arrives', () => {
  const before = aggregateShiftSaleTotals([
    { id: 'off-1', clientRef: 'x', shiftId: SHIFT, total: 3, paidCash: 3, paidCard: 0, debtAdded: 0 },
  ], SHIFT)
  const after = aggregateShiftSaleTotals([
    { id: 'off-1', clientRef: 'x', shiftId: SHIFT, total: 3, paidCash: 3, paidCard: 0, debtAdded: 0 },
    { id: 'SALE-1', clientRef: 'x', shiftId: SHIFT, total: 3, paidCash: 3, paidCard: 0, debtAdded: 0 },
  ], SHIFT)
  expect(before.salesCount === 1 && after.salesCount === 1, 'no double count')
  expect(before.salesCash === 3 && after.salesCash === 3, 'cash once')
})

test('T7 CashierModule overlays live sale totals + durable debt repay', () => {
  const src = fs.readFileSync(path.join(root, 'components', 'trade', 'CashierModule.tsx'), 'utf8')
  expect(src.includes('overlayShiftSaleTotalsWithDebtRepay'), 'overlay with ledger')
  expect(src.includes("from '@/lib/shiftSaleTotals'"), 'import path')
})

test('T8 soft sync / pull no longer prefer inflated local sale counters', () => {
  const pos = fs.readFileSync(path.join(root, 'lib', 'posStore.ts'), 'utf8')
  const pull = fs.readFileSync(path.join(root, 'lib', 'syncPull.ts'), 'utf8')
  expect(!pos.includes('srvCount >= locCount'), 'posStore old branch gone')
  expect(pos.includes('Never keep inflated local denormalized sale counters')
    || pos.includes('never keep inflated local denormalized'), 'posStore comment')
  expect(!pull.includes('srvCount >= locCount'), 'syncPull old branch gone')
})

test('T9 preferSaleRow / saleDedupeKey basics', () => {
  expect(saleDedupeKey({ clientRef: 'a', id: '1' }) === 'ref:a', 'ref')
  expect(saleDedupeKey({ id: 'SALE-1' }) === 'id:SALE-1', 'id')
  const pref = preferSaleRow(
    { id: 'off-1', clientRef: 'a' },
    { id: 'SALE-1', clientRef: 'a' },
  )
  expect(pref.id === 'SALE-1', 'server wins')
})

const failed = results.filter(r => r.status === 'FAIL')
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
