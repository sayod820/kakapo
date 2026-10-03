/**
 * Admin dashboard: today's kassa revenue (Asia/Dushanbe day, net of returns),
 * real low-stock list (only items sold in the last 14 days), stale open shifts.
 * Run: node scripts/admin-dashboard-test.mjs
 */
import { getAdminDashboardPos } from '../server/kakapo-api/posLogic.js'

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS ${name}`) }
  else { fail += 1; console.log(`FAIL ${name} ${extra}`) }
}

const now = new Date('2026-10-03T10:00:00+05:00')
const db = {
  products: [
    { id: 1, name: 'Молоко', stock: 0, unit: 'шт' },
    { id: 2, name: 'Хлеб', stock: 2, unit: 'шт' },
    { id: 3, name: 'Соль', stock: 0, unit: 'шт' },
    { id: 4, name: 'Сахар', stock: 50, unit: 'кг' },
  ],
  posSales: [
    { id: 's1', createdAtIso: '2026-10-03T03:00:00.000Z', total: 100, paidCash: 60, paidCard: 40, items: [{ productId: 1, qty: 2 }] },
    { id: 's2', createdAtIso: '2026-10-02T20:30:00.000Z', total: 50, paidCash: 50, paidCard: 0, items: [{ productId: 2, qty: 1 }] },
    { id: 's3', createdAtIso: '2026-10-02T18:00:00.000Z', total: 999, paidCash: 999, items: [{ productId: 4, qty: 1 }] },
    { id: 's4', createdAtIso: '2026-10-03T04:00:00.000Z', total: 30, status: 'returned', items: [{ productId: 3, qty: 1, returnedQty: 1 }] },
    { id: 's5', createdAtIso: '2026-08-01T04:00:00.000Z', total: 10, items: [{ productId: 3, qty: 5 }] },
  ],
  posShifts: [
    { id: 'sh1', status: 'open', cashierName: 'Али', openedAtIso: '2026-10-02T03:00:00.000Z' },
    { id: 'sh2', status: 'open', cashierName: 'Вали', openedAtIso: '2026-10-03T02:00:00.000Z' },
    { id: 'sh3', status: 'closed', cashierName: 'Гули', openedAtIso: '2026-09-30T02:00:00.000Z' },
  ],
}

const d = getAdminDashboardPos(db, now)
ok('business day is Dushanbe', d.today === '2026-10-03', d.today)
ok('20:30Z yesterday counts as today (01:30 local)', d.posSalesToday === 2, String(d.posSalesToday))
ok('revenue today excludes yesterday and full returns', d.posRevenueToday === 150, String(d.posRevenueToday))
ok('cash/card split', d.posCashToday === 110 && d.posCardToday === 40, `${d.posCashToday}/${d.posCardToday}`)
ok('out/low counts over all products', d.lowStock.outCount === 2 && d.lowStock.lowCount === 1, JSON.stringify(d.lowStock))
const ids = d.lowStock.items.map(i => i.id)
ok('list shows only recently sold items', ids.join(',') === '1,2', ids.join(','))
ok('returned/old sales do not mark item as hot', !ids.includes(3))
ok('open shifts only', d.openShifts.length === 2)
ok('stale flag for shift from previous day', d.openShifts.find(s => s.id === 'sh1')?.stale === true && d.openShifts.find(s => s.id === 'sh2')?.stale === false)

const empty = getAdminDashboardPos({}, now)
ok('empty db safe', empty.posRevenueToday === 0 && empty.lowStock.items.length === 0 && empty.openShifts.length === 0)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
