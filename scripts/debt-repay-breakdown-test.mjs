/**
 * FOCUS: durable repayment breakdown on debtLedger entries.
 *
 * 1) applyDebtRepayment remembers, per closed receipt, the real payment moment,
 *    method and payment id (one payment closing several receipts shares one id).
 * 2) buildDebtLedgerResponse exposes that breakdown (payments[]) to the cashier.
 * 3) Older entries (paid before the durable log existed) get the same breakdown
 *    reconstructed read-only from the money journal — real date, not the charge date.
 */
import {
  addDebtCharge,
  applyDebtRepayment,
  buildDebtLedgerResponse,
  sumDebtLedgerRemaining,
} from '../server/kakapo-api/debtLedger.js'

let pass = 0
let fail = 0
const check = (name, ok) => { if (ok) { pass++; console.log('PASS', name) } else { fail++; console.log('FAIL', name) } }

function makeClient(id = 'U-07', cardNum = 'KAKAPO-0007') {
  const card = { num: cardNum, clientId: id, debt: 0, debtLedger: [] }
  const client = {
    id,
    phone: '+992000000000',
    card: cardNum,
    debt: 0,
    debtLimit: 1000,
    debtLedger: [],
  }
  return { client, card }
}

/* ---------- 1. new repayments are recorded with the real payment moment ---------- */

const { client, card } = makeClient()
const { entry: e1 } = addDebtCharge(client, card, {
  amount: 19.8, orderId: 'K-14782', desc: 'Чек K-14782', createdAtIso: '2026-10-08T14:11:00.000Z',
})
const { entry: e2 } = addDebtCharge(client, card, {
  amount: 19, orderId: 'K-14882', desc: 'Чек K-14882', createdAtIso: '2026-10-09T09:20:00.000Z',
})
client.debt = sumDebtLedgerRemaining(client.debtLedger)

const PAY_AT = '2026-10-09T12:30:00.000Z'
const out = applyDebtRepayment(client, card, 38.8, {
  desc: 'Погашение долга наличными',
  method: 'cash',
  clientRef: 'pos-ref-1',
  atIso: PAY_AT,
})

check('FIFO closes oldest first', out.applied === 38.8 && out.repayments.length === 2)
check('both receipts share one payment id', out.paymentId === 'pos-ref-1')
check('entry 1 stores the payment moment', e1.payments?.[0]?.atIso === new Date(PAY_AT).toISOString())
check('entry 2 stores the payment moment', e2.payments?.[0]?.atIso === new Date(PAY_AT).toISOString())
check('payment method recorded', e1.payments?.[0]?.method === 'cash' && e2.payments?.[0]?.method === 'cash')
check('payment id recorded on both', e1.payments?.[0]?.id === 'pos-ref-1' && e2.payments?.[0]?.id === 'pos-ref-1')

/* replay with the same payment id must not duplicate the breakdown */
const { entry: e3 } = addDebtCharge(client, card, {
  amount: 50, orderId: 'K-14900', desc: 'Чек K-14900', createdAtIso: '2026-10-09T11:00:00.000Z',
})
applyDebtRepayment(client, card, 5, { orderId: 'K-14900', method: 'cash', clientRef: 'pos-ref-2', atIso: PAY_AT })
applyDebtRepayment(client, card, 7, { orderId: 'K-14900', method: 'cash', clientRef: 'pos-ref-2', atIso: PAY_AT })
check('replay does not duplicate the breakdown', e3.payments.length === 1)

/* ---------- 2. the API response carries the breakdown ---------- */

const resp = buildDebtLedgerResponse(client)
const r1 = resp.entries.find(e => e.id === e1.id)
const r2 = resp.entries.find(e => e.id === e2.id)
const r3 = resp.entries.find(e => e.id === e3.id)
check('response exposes payments for paid entry', Array.isArray(r1.payments) && r1.payments.length === 1)
check('response payment keeps the real date', r1.payments[0].atIso === new Date(PAY_AT).toISOString())
check('response payment keeps the amount', r1.payments[0].amount === 19.8)
check('response payment keeps the method', r1.payments[0].method === 'cash')
check('partly paid entry keeps its open remainder', r3.status === 'open' && r3.paidAmount === 12)
check('settled entry is marked paid', r2.status === 'paid' && r2.payments.length === 1)

/* ---------- 3. legacy entries are reconstructed from the money journal ---------- */

const { client: legacy } = makeClient('U-16', 'KAKAPO-0007')
const legacyCard = { num: 'KAKAPO-0007', clientId: 'U-16', debt: 0, debtLedger: [] }
const { entry: l1 } = addDebtCharge(legacy, legacyCard, {
  amount: 16.5, orderId: 'K-1001', desc: 'Чек K-1001', createdAtIso: '2026-10-08T08:00:00.000Z',
})
const { entry: l2 } = addDebtCharge(legacy, legacyCard, {
  amount: 32, orderId: 'K-1002', desc: 'Чек K-1002', createdAtIso: '2026-10-08T09:00:00.000Z',
})
/* the two receipts were closed on 09.10 by one cash payment (no entry.payments on them) */
l1.remaining = 0
l2.remaining = 0
const db = {
  moneyLedger: [{
    id: 'LED-legacy-1',
    createdAtIso: '2026-10-09T10:05:00.000Z',
    type: 'debt_repay_cash',
    refType: 'debt_repay',
    refId: 'KAKAPO-0007',
    amount: 48.5,
    meta: { cardNum: 'KAKAPO-0007', method: 'cash', clientAtIso: '2026-10-09T09:58:00.000Z' },
  }],
}

const legacyResp = buildDebtLedgerResponse(legacy, db)
const d1 = legacyResp.entries.find(e => e.id === l1.id)
const d2 = legacyResp.entries.find(e => e.id === l2.id)
check('legacy breakdown reconstructed for both receipts', !!d1.payments?.length && !!d2.payments?.length)
check('legacy breakdown uses the real payment moment', d1.payments[0].atIso === new Date('2026-10-09T09:58:00.000Z').toISOString())
check('legacy breakdown groups both receipts under one payment', d1.payments[0].id === d2.payments[0].id)
check('legacy breakdown amounts match paid sums', d1.payments[0].amount === 16.5 && d2.payments[0].amount === 32)

/* reconstructing must stay read-only: canonical balances untouched */
check('reconstruction does not write to the ledger', l1.payments === undefined && l2.payments === undefined)
check('reconstruction keeps remaining untouched', sumDebtLedgerRemaining(legacy.debtLedger) === 0)

/* a client with its own recorded breakdown is never overwritten by the reader */
const ownResp = buildDebtLedgerResponse(client, db)
const o1 = ownResp.entries.find(e => e.id === e1.id)
check('own recorded breakdown wins over reconstruction', o1.payments.length === 1 && o1.payments[0].amount === 19.8)

/* ---------- 4. reconstructed payment keeps the cash-register operation id ---------- */

const { client: legacyRef } = makeClient('U-17', 'KAKAPO-0007')
const legacyRefCard = { num: 'KAKAPO-0007', clientId: 'U-17', debt: 0, debtLedger: [] }
const { entry: refEntry } = addDebtCharge(legacyRef, legacyRefCard, {
  amount: 100, orderId: 'K-2001', desc: 'Чек K-2001', createdAtIso: '2026-10-08T08:00:00.000Z',
})
refEntry.remaining = 0
const dbRef = {
  moneyLedger: [{
    id: 'LED-xyz',
    createdAtIso: '2026-10-09T10:05:00.000Z',
    type: 'debt_repay_cash',
    refType: 'debt_repay',
    refId: 'KAKAPO-0007',
    amount: 100,
    meta: { cardNum: 'KAKAPO-0007', method: 'cash', clientRef: 'pos-ref-9', clientAtIso: '2026-10-09T09:58:00.000Z' },
  }],
}
const respRef = buildDebtLedgerResponse(legacyRef, dbRef)
const rr = respRef.entries.find(e => e.id === refEntry.id)
check('reconstructed payment id = cash-register clientRef (not the money row id)', rr.payments?.[0]?.id === 'pos-ref-9')
check('reconstructed payment keeps the operation ref', rr.payments?.[0]?.clientRef === 'pos-ref-9')
check('reconstructed payment still uses the real moment', rr.payments?.[0]?.atIso === new Date('2026-10-09T09:58:00.000Z').toISOString())

console.log(`SUMMARY pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)
