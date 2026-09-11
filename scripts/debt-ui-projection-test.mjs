/**
 * Debt UI projection — no stale sale.debtAdded resurrection.
 * Run: node scripts/debt-ui-projection-test.mjs
 */
import {
  allocateSaleRemainsToDebtBudget,
  displayedCustomerDebt,
  resolveAuthoritativeCustomerDebt,
  sumDisplayedCustomerDebts,
  sumOpenDebtLedgerRemaining,
  round2,
} from '../lib/debtUiProjectionCore.mjs'

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

function enrichLike({ clientDebt, cardDebt, debtLedger, sales, historyRemainBySaleId = {} }) {
  const debt = resolveAuthoritativeCustomerDebt({ clientDebt, cardDebt, debtLedger })
  const { posRemain, cashOnCard, saleStatus, posOriginal } = allocateSaleRemainsToDebtBudget(
    sales,
    historyRemainBySaleId,
    debt,
  )
  return { debt, posRemain, cashOnCard, saleStatus, posOriginal, projectedOld: round2(posRemain + cashOnCard) }
}

test('1) CRM debt=0, historical sale debtAdded=1209.73 → list+footer 0', () => {
  const sales = [
    { id: 'S1', debtAdded: 1209.73, dateIso: '2026-08-01T10:00:00.000Z' },
  ]
  const row = enrichLike({ clientDebt: 0, cardDebt: 0, sales })
  expect(row.debt === 0, `debt=${row.debt}`)
  expect(row.posRemain === 0, `posRemain=${row.posRemain}`)
  expect(row.cashOnCard === 0, `cashOnCard=${row.cashOnCard}`)
  expect(row.saleStatus.S1.remain === 0, 'sale remain must be 0')
  expect(row.posOriginal === 1209.73, 'original credit preserved')
})

test('2) CRM debt=500, sale debtAdded=1209.73 → current=500 not 1209.73', () => {
  const sales = [
    { id: 'S1', debtAdded: 1209.73, dateIso: '2026-08-01T10:00:00.000Z' },
  ]
  const row = enrichLike({ clientDebt: 500, sales })
  expect(row.debt === 500, `debt=${row.debt}`)
  expect(row.posRemain + row.cashOnCard === 500, `sum=${row.posRemain + row.cashOnCard}`)
  expect(row.saleStatus.S1.remain === 500, `remain=${row.saleStatus.S1.remain}`)
  expect(row.posOriginal === 1209.73, 'original kept')
})

test('3) multiple repaid historical debt sales → total stays 0', () => {
  const sales = [
    { id: 'A', debtAdded: 100, dateIso: '2026-07-01T00:00:00.000Z' },
    { id: 'B', debtAdded: 200, dateIso: '2026-07-02T00:00:00.000Z' },
    { id: 'C', debtAdded: 300, dateIso: '2026-07-03T00:00:00.000Z' },
  ]
  const row = enrichLike({ clientDebt: 0, sales })
  expect(row.debt === 0, 'debt 0')
  expect(Object.values(row.saleStatus).every(s => s.remain === 0), 'all remains 0')
})

test('4) partial repayment: original 1000, authoritative remaining 300 → display 300', () => {
  const sales = [
    { id: 'S1', debtAdded: 1000, dateIso: '2026-08-01T10:00:00.000Z' },
  ]
  const row = enrichLike({
    clientDebt: 300,
    sales,
    historyRemainBySaleId: { S1: { remain: 300, paid: 700, status: 'partial' } },
  })
  expect(row.debt === 300, `debt=${row.debt}`)
  expect(row.saleStatus.S1.remain === 300, `remain=${row.saleStatus.S1.remain}`)
  expect(row.posOriginal === 1000, 'original 1000')
})

test('5) six known zero-CRM stale-sale cases must NOT contribute 2843.61', () => {
  const stale = [
    { id: 'U-16', name: 'Хумайро', sale: 1209.73 },
    { id: 'U-07', name: 'Эмом', sale: 774.74 },
    { id: 'U-27', name: 'Фарух', sale: 260.9 },
    { id: 'U-18', name: 'Саидчон', sale: 242.6 },
    { id: 'U-12', name: 'Акмал Бачаи малима', sale: 227.2 },
    { id: 'U-26', name: 'Мохпари', sale: 128.44 },
  ]
  const rows = stale.map(c => ({
    id: c.id,
    debt: displayedCustomerDebt({ clientDebt: 0, cardDebt: 0 }),
    _inflatedOld: c.sale,
  }))
  const footer = sumDisplayedCustomerDebts(rows)
  const oldInflate = round2(stale.reduce((s, c) => s + c.sale, 0))
  expect(oldInflate === 2843.61, `old inflate baseline ${oldInflate}`)
  expect(footer === 0, `footer=${footer}`)
  expect(rows.every(r => r.debt === 0), 'each list debt 0')
})

test('6) list sum == footer total (single source)', () => {
  const customers = [
    { id: 'A', debtLedger: [{ remaining: 100 }, { remaining: 50 }] },
    { id: 'B', clientDebt: 200, debtLedger: [] },
    { id: 'C', clientDebt: 0, cardDebt: 999 }, // no ledger → client.debt wins (0), not card inflate alone without client field... 
  ]
  // C: clientDebt=0 is finite → 0 (prefer client over card when clientDebt provided)
  const rows = customers.map(c => ({
    id: c.id,
    debt: resolveAuthoritativeCustomerDebt({
      clientDebt: c.clientDebt,
      cardDebt: c.cardDebt,
      debtLedger: c.debtLedger,
    }),
  }))
  // A: ledger 150; B: client 200; C: 0
  expect(rows[0].debt === 150, `A=${rows[0].debt}`)
  expect(rows[1].debt === 200, `B=${rows[1].debt}`)
  expect(rows[2].debt === 0, `C=${rows[2].debt}`)
  const footer = sumDisplayedCustomerDebts(rows)
  const listSum = round2(rows.reduce((s, r) => s + r.debt, 0))
  expect(footer === listSum, `${footer} vs ${listSum}`)
  expect(footer === 350, `footer=${footer}`)
})

test('7) restart preserves same values (pure fn idempotent)', () => {
  const input = {
    clientDebt: 1740.31,
    debtLedger: [{ remaining: 1000 }, { remaining: 740.31 }],
  }
  const a = resolveAuthoritativeCustomerDebt(input)
  const b = resolveAuthoritativeCustomerDebt(input)
  expect(a === b && a === 1740.31, `${a} ${b}`)
})

test('8) sync refresh does not re-inflate stale sale debt', () => {
  // After sync: CRM/ledger cleared, local sales still have debtAdded
  const before = enrichLike({
    clientDebt: 0,
    debtLedger: [{ remaining: 0 }],
    sales: [{ id: 'S', debtAdded: 1209.73, dateIso: '2026-01-01T00:00:00.000Z' }],
  })
  const afterSync = enrichLike({
    clientDebt: 0,
    debtLedger: [{ remaining: 0 }, { remaining: 0 }],
    sales: [{ id: 'S', debtAdded: 1209.73, dateIso: '2026-01-01T00:00:00.000Z' }],
  })
  expect(before.debt === 0 && afterSync.debt === 0, 'stays 0')
  expect(afterSync.posRemain === 0, 'no sale resurrection')
})

test('ledger remaining preferred over inflated card.debt', () => {
  const d = resolveAuthoritativeCustomerDebt({
    clientDebt: 217,
    cardDebt: 1219.49,
    debtLedger: [{ remaining: 217 }],
  })
  expect(d === 217, `got ${d}`)
})

test('sumOpenDebtLedgerRemaining ignores entries without remaining field', () => {
  expect(sumOpenDebtLedgerRemaining([{ amount: 10 }]) == null, 'no remaining field')
  expect(sumOpenDebtLedgerRemaining([{ remaining: 10 }, { remaining: 5.5 }]) === 15.5, 'sum')
})

const failed = results.filter(r => r.status === 'FAIL')
console.log('\n---')
console.log(`PASS ${results.length - failed.length} / FAIL ${failed.length}`)
if (failed.length) process.exit(1)
