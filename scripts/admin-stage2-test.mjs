/**
 * Admin stage 2: kassa finance by day (Asia/Dushanbe, net of returns, COGS, expenses)
 * and employee ↔ cashier link by id (rename keeps the same cashier).
 * Run: node scripts/admin-stage2-test.mjs
 */
import { getPosDailyFinance } from '../server/kakapo-api/posLogic.js'
import { syncEmployeeCashier, linkEmployeesToCashiers } from '../server/kakapo-api/employeesLogic.js'

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS ${name}`) }
  else { fail += 1; console.log(`FAIL ${name} ${extra}`) }
}

const now = new Date('2026-10-03T10:00:00+05:00')
const db = {
  products: [{ id: 1, costPrice: 6 }, { id: 2, costPrice: 0 }],
  posSales: [
    { id: 'a', createdAtIso: '2026-10-03T03:00:00.000Z', total: 100, paidCash: 70, paidCard: 30, items: [{ productId: 1, qty: 10 }] },
    { id: 'b', createdAtIso: '2026-10-02T20:00:00.000Z', total: 40, paidCash: 0, paidCard: 0, debtAdded: 40, totalCost: 25, items: [{ productId: 2, qty: 1 }] },
    { id: 'c', createdAtIso: '2026-10-02T10:00:00.000Z', total: 50, paidCash: 50, items: [{ productId: 1, qty: 5, lineCost: 30 }] },
    { id: 'd', createdAtIso: '2026-10-02T11:00:00.000Z', total: 20, status: 'returned', originalTotal: 20, items: [{ productId: 1, qty: 2, returnedQty: 2 }] },
    { id: 'e', createdAtIso: '2026-10-02T12:00:00.000Z', total: 30, lastReturnTotal: 10, paidCash: 30, items: [{ productId: 1, qty: 4, returnedQty: 1, lineCost: 24 }] },
    { id: 'old', createdAtIso: '2026-08-01T10:00:00.000Z', total: 999, items: [] },
  ],
  expenses: [
    { amount: 15, createdAtIso: '2026-10-03T04:00:00.000Z' },
    { amount: 5, createdAtIso: '2026-10-02T05:00:00.000Z' },
  ],
}

const f = getPosDailyFinance(db, { days: 2, now })
ok('two days, oldest first', f.days.length === 2 && f.from === '2026-10-02' && f.to === '2026-10-03', JSON.stringify([f.from, f.to]))
const today = f.days[1]
const yday = f.days[0]
ok('today: 20:00Z on 02.10 belongs to 03.10 local', today.sales === 2, String(today.sales))
ok('today revenue/cash/card/debt', today.revenue === 140 && today.cash === 70 && today.card === 30 && today.debt === 40, JSON.stringify(today))
ok('today cogs from costPrice and totalCost', today.cogs === 85 && today.profit === 55, `${today.cogs}/${today.profit}`)
ok('today expenses', today.expenses === 15)
ok('yesterday: full return excluded from revenue, counted in returns', yday.sales === 2 && yday.revenue === 80 && yday.returns === 30, JSON.stringify(yday))
ok('partial return cogs uses left qty', yday.cogs === 48, String(yday.cogs))
ok('totals', f.totals.revenue === 220 && f.totals.sales === 4 && f.totals.avgCheck === 55, JSON.stringify(f.totals))
ok('old sales outside the window ignored', f.totals.revenue < 999)
ok('days clamp', getPosDailyFinance({}, { days: 9999, now }).days.length === 366 && getPosDailyFinance({}, { days: 0, now }).days.length === 30)

const db2 = {
  employees: [
    { id: 'EMP-1', name: 'Гафуров Сайёд' },
    { id: 'EMP-2', name: 'Новый Сотрудник' },
  ],
  cashiers: [
    { id: 'CASHIER-1', name: 'гафуров  сайед', salesCount: 900 },
    { id: 'CASHIER-OLD', name: 'Гафуров Сайёд', mergedInto: 'CASHIER-1' },
    { id: 'CASHIER-9', name: 'Другой Кассир' },
  ],
}
ok('startup link by normalized name', linkEmployeesToCashiers(db2) === 1 && db2.employees[0].cashierId === 'CASHIER-1', JSON.stringify(db2.employees))
ok('no cashier → no link', !db2.employees[1].cashierId)

const emp = db2.employees[0]
const prev = emp.name
emp.name = 'Гафуров Саид'
const changed = syncEmployeeCashier(db2, emp, prev)
ok('rename moves cashier name, same id', changed?.id === 'CASHIER-1' && db2.cashiers[0].name === 'Гафуров Саид' && emp.cashierId === 'CASHIER-1')

const again = syncEmployeeCashier(db2, emp, emp.name)
ok('same name again → nothing to write', again === null && db2.cashiers[0].name === 'Гафуров Саид')

const prev2 = emp.name
emp.name = 'Другой Кассир'
const clash = syncEmployeeCashier(db2, emp, prev2)
ok('rename into existing cashier name links there, no rename', clash === null && emp.cashierId === 'CASHIER-9' && db2.cashiers[0].name === 'Гафуров Саид')

const lone = { id: 'EMP-3', name: 'Без Кассира' }
ok('employee without cashier → null', syncEmployeeCashier(db2, lone, 'Старое Имя') === null && !lone.cashierId)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
