/**
 * Regression: lossless debtLedger soft-cap + card reissue orphans.
 * Run: node scripts/debt-ledger-cap-test.mjs
 */
import {
  DEBT_LEDGER_SOFT_CAP,
  addDebtCharge,
  applyDebtRepayment,
  capDebtLedgerLossless,
  reconcileDebtLedger,
  runDebtMaintenance,
  syncDebtLedgerToCard,
  sumDebtLedgerRemaining,
} from '../server/kakapo-api/debtLedger.js'
import {
  findCanonicalCard,
  unlinkNonCanonicalSiblingCards,
} from '../server/kakapo-api/cardCanonical.js'

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

function r2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function mkEntry({ id, remaining, amount, at, source = 'pos', orderId }) {
  return {
    id,
    amount: amount ?? remaining,
    remaining,
    createdAtIso: at,
    dueAtIso: at,
    source,
    orderId,
    desc: orderId ? `Касса · ${orderId}` : 'Долг',
    createdNotified: true,
    reminderNotified: false,
    overdueNotified: false,
    overdueStrikeApplied: false,
  }
}

function normalizeCardRow(raw) {
  return {
    num: String(raw.num || '').toUpperCase(),
    client: raw.client || '',
    phone: raw.phone || '',
    clientId: raw.clientId,
    status: raw.status || 'unlinked',
    level: raw.level || '',
    bonus: Number(raw.bonus) || 0,
    debt: Number(raw.debt) || 0,
    debtLimit: Number(raw.debtLimit) || 0,
    vip: !!raw.vip,
    debtEnabled: !!raw.debtEnabled,
    debtLedger: Array.isArray(raw.debtLedger) ? raw.debtLedger : [],
    debtOverdueStrikes: Number(raw.debtOverdueStrikes) || 0,
    debtCreditBlocked: !!raw.debtCreditBlocked,
  }
}

test('1) 120 entries, oldest OPEN=8.50 + backfill → open 8.50 survives', () => {
  const openOldest = mkEntry({
    id: 'OPEN-850',
    remaining: 8.5,
    at: '2026-08-01T00:00:00.000Z',
    orderId: 'K-OLD',
  })
  const rest = []
  for (let i = 0; i < 119; i++) {
    rest.push(mkEntry({
      id: `O-${i}`,
      remaining: 1,
      at: `2026-08-${String((i % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
      orderId: `K-${i}`,
    }))
  }
  // newest-first: rest then oldest at end (like pre-slice array of 120)
  const client = {
    phone: '+992501903141',
    debt: r2(8.5 + 119),
    debtLedger: [...rest, openOldest],
  }
  expect(client.debtLedger.length === 120, 'start len 120')
  expect(client.debtLedger[client.debtLedger.length - 1].id === 'OPEN-850', 'oldest is OPEN-850')

  const beforeDebt = client.debt
  reconcileDebtLedger(client) // gap 0 — just caps
  // Force positive gap path like production: drop rem from ledger artificially then reconcile
  client.debt = beforeDebt
  client.debtLedger = client.debtLedger.filter(e => e.id !== 'OPEN-850')
  // refill to 119 open of 1 + we'll backfill
  client.debtLedger = rest.map(e => ({ ...e }))
  client.debt = r2(119 + 8.5) // debt still includes lost 8.50
  expect(sumDebtLedgerRemaining(client.debtLedger) === 119, 'ledger short by 8.50')

  // Pack to 120 with paid rows so naive slice would drop an open if we only unshifted
  const packed = []
  for (let i = 0; i < 120; i++) {
    packed.push(mkEntry({
      id: `P-${i}`,
      remaining: i === 119 ? 8.5 : 1,
      at: `2026-07-${String((i % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
      orderId: `K-P-${i}`,
    }))
  }
  // Make debt = sum + gap so reconcile inserts backfill while at cap
  const openSum = sumDebtLedgerRemaining(packed)
  const client2 = {
    phone: '+992501903141',
    debt: r2(openSum + 11.86),
    debtLedger: packed,
  }
  const open850 = packed.find(e => e.remaining === 8.5)
  expect(!!open850, 'has open 8.50')
  reconcileDebtLedger(client2)
  expect(client2.debtLedger.some(e => e.id === open850.id && r2(e.remaining) === 8.5), 'open 8.50 survived')
  expect(r2(client2.debt) === r2(openSum + 11.86), `debt preserved got ${client2.debt}`)
  expect(sumDebtLedgerRemaining(client2.debtLedger) === r2(client2.debt), 'sum==debt')
  expect(client2.debtLedger.some(e => e.source === 'backfill'), 'backfill present')
})

test('2) 120 with paid rows + backfill → paid pruned, no open lost', () => {
  const ledger = []
  for (let i = 0; i < 100; i++) {
    ledger.push(mkEntry({
      id: `OPEN-${i}`,
      remaining: 2,
      at: `2026-09-01T${String(i % 24).padStart(2, '0')}:00:00.000Z`,
    }))
  }
  for (let i = 0; i < 20; i++) {
    ledger.push(mkEntry({
      id: `PAID-${i}`,
      remaining: 0,
      amount: 5,
      at: `2026-08-01T${String(i % 24).padStart(2, '0')}:00:00.000Z`,
    }))
  }
  expect(ledger.length === 120, 'len 120')
  const openIds = new Set(ledger.filter(e => e.remaining > 0).map(e => e.id))
  const client = {
    phone: '992111',
    debt: r2(sumDebtLedgerRemaining(ledger) + 8.5),
    debtLedger: ledger,
  }
  reconcileDebtLedger(client)
  for (const id of openIds) {
    expect(client.debtLedger.some(e => e.id === id && e.remaining > 0), `open ${id} kept`)
  }
  expect(client.debtLedger.filter(e => e.remaining <= 0.001).length < 20, 'some paid pruned')
  expect(sumDebtLedgerRemaining(client.debtLedger) === r2(client.debt), 'aligned')
})

test('3) >120 open entries → all open preserved', () => {
  const ledger = []
  for (let i = 0; i < 130; i++) {
    ledger.push(mkEntry({
      id: `O-${i}`,
      remaining: 1,
      at: `2026-06-01T00:${String(i % 60).padStart(2, '0')}:00.000Z`,
    }))
  }
  const capped = capDebtLedgerLossless(ledger)
  expect(capped.length === 130, `len=${capped.length}`)
  expect(capped.every(e => e.remaining > 0), 'all open')
  expect(new Set(capped.map(e => e.id)).size === 130, 'all ids unique kept')
})

test('4) reconcile positive gap → client debt must not decrease due to cap', () => {
  const ledger = []
  for (let i = 0; i < 120; i++) {
    ledger.push(mkEntry({
      id: `X-${i}`,
      remaining: i < 118 ? 1 : (i === 118 ? 8.5 : 0),
      amount: i === 119 ? 3 : (i === 118 ? 8.5 : 1),
      at: `2026-05-${String((i % 28) + 1).padStart(2, '0')}T08:00:00.000Z`,
    }))
  }
  const rem = sumDebtLedgerRemaining(ledger)
  const client = { phone: '992222', debt: r2(rem + 20), debtLedger: ledger }
  const before = client.debt
  reconcileDebtLedger(client)
  expect(r2(client.debt) >= before - 0.001, `debt decreased ${before}→${client.debt}`)
  expect(r2(client.debt) === before, `debt should stay ${before} got ${client.debt}`)
  expect(sumDebtLedgerRemaining(client.debtLedger) === r2(client.debt), 'sum match')
})

test('5) client/card remain equal after legitimate reconcile', () => {
  const client = {
    phone: '992333',
    debt: 50,
    debtLedger: [
      mkEntry({ id: 'A', remaining: 30, at: '2026-09-01T10:00:00.000Z' }),
      mkEntry({ id: 'B', remaining: 10, at: '2026-09-02T10:00:00.000Z' }),
    ],
  }
  const card = { num: 'КАКАПО-0001', debt: 40, status: 'active', phone: '992333' }
  const db = { clients: [client], cards: [card] }
  runDebtMaintenance(db)
  expect(r2(client.debt) === 50, `client debt ${client.debt}`)
  expect(sumDebtLedgerRemaining(client.debtLedger) === 50, 'ledger 50')
  expect(r2(card.debt) === 50, `card debt synced ${card.debt}`)
  expect(Array.isArray(card.debtLedger) && card.debtLedger.length === client.debtLedger.length, 'ledger copied')
})

test('6) card reissue: old unlinked, new canonical, no stale sibling debt', () => {
  const client = {
    id: 'U-99',
    phone: '+992500000099',
    card: 'КАКАПО-0099',
    debt: 217,
  }
  const db = {
    cards: [
      normalizeCardRow({
        num: 'КАКАПО-0021',
        client: 'Old',
        phone: client.phone,
        clientId: 'U-99',
        status: 'active',
        debt: 1219.49,
      }),
      normalizeCardRow({
        num: 'КАКАПО-0099',
        client: 'New',
        phone: client.phone,
        clientId: 'U-99',
        status: 'active',
        debt: 217,
      }),
    ],
  }
  const { unlinked } = unlinkNonCanonicalSiblingCards(db, client, 'КАКАПО-0099', normalizeCardRow)
  expect(unlinked.includes('КАКАПО-0021'), 'old unlinked')
  const old = db.cards.find(c => c.num === 'КАКАПО-0021')
  const neu = db.cards.find(c => c.num === 'КАКАПО-0099')
  expect(old.status === 'unlinked', 'old status')
  expect(r2(old.debt) === 0, 'old debt cleared')
  expect(neu.status === 'active', 'new active')
  expect(r2(neu.debt) === 217, 'canonical debt kept')
  const canon = findCanonicalCard(db, client)
  expect(canon?.num === 'КАКАПО-0099', 'canonical finder')
})

test('7) debt sale charge + repayment still work under cap helpers', () => {
  const client = { phone: '992444', debt: 0, debtLedger: [] }
  const card = { num: 'КАКАПО-0044', debt: 0 }
  // seed 119 open tiny rows
  for (let i = 0; i < 119; i++) {
    client.debtLedger.push(mkEntry({
      id: `S-${i}`,
      remaining: 0.01,
      at: `2026-04-01T00:${String(i % 60).padStart(2, '0')}:00.000Z`,
    }))
  }
  client.debt = sumDebtLedgerRemaining(client.debtLedger)
  card.debt = client.debt

  const { entry } = addDebtCharge(client, card, {
    amount: 8.5,
    source: 'pos',
    orderId: 'K-TEST',
    saleId: 'SALE-TEST',
  })
  expect(!!entry, 'charge created')
  expect(client.debtLedger.some(e => e.orderId === 'K-TEST' && r2(e.remaining) === 8.5), 'charge kept')
  // open rows must not be dropped (119*0.01 + 8.5)
  const openCount = client.debtLedger.filter(e => e.remaining > 0.001).length
  expect(openCount === 120, `openCount=${openCount}`)

  client.debt = r2(client.debt + 8.5)
  card.debt = client.debt
  const pay = applyDebtRepayment(client, card, 8.5, { orderId: 'K-TEST', saleId: 'SALE-TEST' })
  expect(r2(pay.applied) === 8.5, `applied ${pay.applied}`)
  const charged = client.debtLedger.find(e => e.orderId === 'K-TEST')
  expect(r2(charged.remaining) === 0, 'targeted repay')
})

test('soft cap constant', () => {
  expect(DEBT_LEDGER_SOFT_CAP === 120, 'cap 120')
})

const failed = results.filter(r => r.status === 'FAIL')
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
