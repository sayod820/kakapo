/**
 * Admin reports: kassa by cashier, by product (net of returns, Asia/Dushanbe window),
 * products running out by 30-day sales rate.
 * Run: node scripts/admin-reports-test.mjs
 */
import { getPosAdminReports } from '../server/kakapo-api/posLogic.js'

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`PASS ${name}`) }
  else { fail += 1; console.log(`FAIL ${name} ${extra}`) }
}

const now = new Date('2026-10-05T10:00:00+05:00')
const db = {
  products: [
    { id: 1, name: 'Молоко', stock: 3, unit: 'шт', costPrice: 5 },
    { id: 2, name: 'Хлеб', stock: 100, unit: 'шт', costPrice: 1 },
    { id: 3, name: 'Соль', stock: 0, unit: 'шт' },
    { id: 4, name: 'Сахар', stock: 2, unit: 'кг' },
  ],
  posSales: [
    // today, Али: 2 молока + 1 хлеб, total with sale discount 20 (gross 22)
    { id: 's1', createdAtIso: '2026-10-05T03:00:00.000Z', cashierName: 'Али', total: 20, paidCash: 20, paidCard: 0, debtAdded: 0,
      items: [{ productId: 1, qty: 2, price: 10, lineTotal: 20, unitCost: 5 }, { productId: 2, qty: 1, price: 2, lineTotal: 2 }] },
    // yesterday 20:30Z = today 01:30 local, Вали, partial return of 1 молоко (total already net)
    { id: 's2', createdAtIso: '2026-10-04T20:30:00.000Z', cashierName: 'Вали', total: 10, paidCash: 0, paidCard: 10, debtAdded: 0, lastReturnTotal: 10,
      items: [{ productId: 1, qty: 2, price: 10, lineTotal: 20, returnedQty: 1 }] },
    // full return, Вали
    { id: 's3', createdAtIso: '2026-10-05T04:00:00.000Z', cashierName: 'Вали', status: 'returned', total: 0, originalTotal: 30,
      items: [{ productId: 3, qty: 3, price: 10, lineTotal: 30, returnedQty: 3 }] },
    // 10 days ago: соль sold (counts for 30-day rate, not for 7-day window)
    { id: 's4', createdAtIso: '2026-09-25T04:00:00.000Z', cashierName: 'Али', total: 30, paidCash: 30, debtAdded: 0,
      items: [{ productId: 3, qty: 6, price: 5, lineTotal: 30 }] },
    // old (60 days): сахар — not in 30-day rate
    { id: 's5', createdAtIso: '2026-08-01T04:00:00.000Z', cashierName: 'Али', total: 10, items: [{ productId: 4, qty: 5, price: 2, lineTotal: 10 }] },
  ],
}

const r1 = getPosAdminReports(db, { days: 1, now })
ok('window today (Dushanbe)', r1.from === '2026-10-05' && r1.to === '2026-10-05', `${r1.from}..${r1.to}`)
const ali = r1.cashiers.find(c => c.cashier === 'Али')
const vali = r1.cashiers.find(c => c.cashier === 'Вали')
ok('Али today: 1 sale 20', ali?.sales === 1 && ali?.revenue === 20 && ali?.cash === 20, JSON.stringify(ali))
ok('Вали today: 1 sale (01:30 local), card 10', vali?.sales === 1 && vali?.revenue === 10 && vali?.card === 10, JSON.stringify(vali))
ok('Вали returns = partial 10 + full 30', vali?.returns === 40, String(vali?.returns))
ok('cashiers sorted by revenue', r1.cashiers[0].cashier === 'Али')
ok('Али profit = 20 - (2*5 + 1*1)', ali?.profit === 9, String(ali?.profit))

const milk = r1.products.find(p => p.id === 1)
const bread = r1.products.find(p => p.id === 2)
ok('молоко qty net of return = 3', milk?.qty === 3, String(milk?.qty))
ok('sale discount spread over lines (milk 20*20/22 + 10)', Math.abs((milk?.revenue || 0) - 28.18) < 0.02, String(milk?.revenue))
ok('product revenues sum to cashier revenue', Math.abs((milk?.revenue || 0) + (bread?.revenue || 0) - 30) < 0.02)
ok('fully returned product not in top', !r1.products.some(p => p.id === 3))

const r7 = getPosAdminReports(db, { days: 7, now })
ok('7-day window excludes 10-day-old sale', !r7.products.some(p => p.id === 3) && r7.cashiers.find(c => c.cashier === 'Али')?.sales === 1)
const r30 = getPosAdminReports(db, { days: 30, now })
ok('30-day window includes it', r30.products.some(p => p.id === 3))

const low = r1.lowStock
const lowIds = low.map(p => p.id)
ok('соль (0 left, sold 6 in 30d) is out', low.find(p => p.id === 3)?.daysLeft === 0, JSON.stringify(low))
ok('молоко (3 left, 3 sold/30d → 30 days) not low', !lowIds.includes(1), lowIds.join(','))
ok('хлеб plenty → not low', !lowIds.includes(2))
ok('сахар not sold in 30d → not listed', !lowIds.includes(4))
ok('suggestQty for 2 weeks', low.find(p => p.id === 3)?.suggestQty === 3, String(low.find(p => p.id === 3)?.suggestQty))

const empty = getPosAdminReports({}, { days: 30, now })
ok('empty db safe', empty.cashiers.length === 0 && empty.products.length === 0 && empty.lowStock.length === 0)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
