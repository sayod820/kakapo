/**
 * Receipt debt status follows server debtLedger[].remaining per saleId,
 * not oldest-first allocation of the total (client U-16 case, 05.10).
 */
import { allocateSaleRemainsToDebtBudget, ledgerRemainBySaleId } from '../lib/debtUiProjectionCore.mjs'

let pass = 0
let fail = 0
const check = (name, ok) => { if (ok) { pass++; console.log('PASS', name) } else { fail++; console.log('FAIL', name) } }

const sales = [
  { id: 'S-0808', debtAdded: 16.5, dateIso: '2026-08-08T14:05:00Z' },
  { id: 'S-0811', debtAdded: 32, dateIso: '2026-08-11T10:53:00Z' },
  { id: 'S-1004a', debtAdded: 163.21, dateIso: '2026-10-04T03:14:00Z' },
  { id: 'S-1004b', debtAdded: 24, dateIso: '2026-10-04T05:38:00Z' },
]
const ledger = [
  { saleId: 'S-0808', amount: 16.5, remaining: 0 },
  { saleId: 'S-0811', amount: 32, remaining: 0 },
  { saleId: 'S-1004a', amount: 163.21, remaining: 43.21 },
  { saleId: 'S-1004b', amount: 24, remaining: 24 },
  { amount: 9, remaining: 0 },
]
const debt = 67.21

const old = allocateSaleRemainsToDebtBudget(sales, {}, debt)
check('old behaviour (no ledger) marks 08.08 open', old.saleStatus['S-0808'].remain > 0)

const r = allocateSaleRemainsToDebtBudget(sales, {}, debt, { debtLedger: ledger })
check('08.08 paid', r.saleStatus['S-0808'].status === 'paid' && r.saleStatus['S-0808'].remain === 0)
check('08.11 paid', r.saleStatus['S-0811'].remain === 0)
check('04.10 a partial 43.21', r.saleStatus['S-1004a'].remain === 43.21 && r.saleStatus['S-1004a'].status === 'partial')
check('04.10 b open 24', r.saleStatus['S-1004b'].remain === 24 && r.saleStatus['S-1004b'].status === 'open')
check('posRemain = debt', r.posRemain === debt && r.cashOnCard === 0)

const hist = { 'S-0808': { remain: 16.5, paid: 0, status: 'open' } }
const r2 = allocateSaleRemainsToDebtBudget(sales, hist, debt, { debtLedger: ledger })
check('ledger beats stale local history', r2.saleStatus['S-0808'].remain === 0)

const withNew = [...sales, { id: 'off-new', debtAdded: 10, dateIso: '2026-10-05T05:00:00Z' }]
const r3 = allocateSaleRemainsToDebtBudget(withNew, {}, debt + 10, { debtLedger: ledger })
check('unsynced newest receipt gets leftover', r3.saleStatus['off-new'].remain === 10 && r3.saleStatus['S-0808'].remain === 0)

const r4 = allocateSaleRemainsToDebtBudget(sales, {}, 0, { debtLedger: ledger })
check('debt 0 → all paid', Object.values(r4.saleStatus).every(s => s.remain === 0))

check('ledger without saleId → null map', ledgerRemainBySaleId([{ amount: 5, remaining: 5 }]) === null)

console.log(`SUMMARY pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
