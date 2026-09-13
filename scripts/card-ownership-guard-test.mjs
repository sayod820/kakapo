/**
 * Regression: card/client identity ownership guards (Holov/Sayod collision).
 * Run: node scripts/card-ownership-guard-test.mjs
 */
import {
  assertCardAssignableToClient,
  assertDebtCardUnlinkAllowed,
  CardOwnershipConflict,
  findCanonicalCard,
  unlinkNonCanonicalSiblingCards,
} from '../server/kakapo-api/cardCanonical.js'

const results = []
function test(name, fn) {
  try {
    fn()
    results.push({ name, status: 'PASS' })
    console.log('PASS', name)
  } catch (e) {
    results.push({ name, status: 'FAIL', error: e?.message || String(e) })
    console.log('FAIL', name, e?.message || e)
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg || 'expect failed')
}
function r2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
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

function snapshot(db) {
  return JSON.stringify({
    cards: (db.cards || []).map(c => ({
      num: c.num, clientId: c.clientId, phone: c.phone, status: c.status,
      debt: c.debt, client: c.client, ledgerLen: (c.debtLedger || []).length,
    })),
    clients: (db.clients || []).map(c => ({
      id: c.id, phone: c.phone, card: c.card, name: c.name, debt: c.debt,
    })),
  })
}

function fixtureSayodHolov() {
  const sayod = {
    id: 'U-01',
    name: 'Сайёд Гафуров',
    phone: '+992 50 190 31 41',
    card: 'КАКАПО-0001',
    debt: 1741.31,
  }
  const holov = {
    id: 'U-03',
    name: 'Холов Баходур',
    phone: '+992938463959',
    card: 'КАКАПО-0003',
    debt: 320.04,
  }
  const db = {
    clients: [sayod, holov],
    cards: [
      normalizeCardRow({
        num: 'КАКАПО-0001',
        client: sayod.name,
        phone: sayod.phone,
        clientId: 'U-01',
        status: 'active',
        debt: 1741.31,
        debtLedger: [{ id: 'SAYOD-BF', remaining: 1741.31, amount: 1741.31 }],
      }),
      normalizeCardRow({
        num: 'КАКАПО-0003',
        client: holov.name,
        phone: holov.phone,
        clientId: 'U-03',
        status: 'active',
        debt: 320.04,
        debtLedger: [{ id: 'HOLOV-BF', remaining: 320.04, amount: 320.04 }],
      }),
    ],
  }
  return { db, sayod, holov }
}

// CASE 1
test('CASE 1: reject assign 0001 to U-03; no mutation', () => {
  const { db, holov } = fixtureSayodHolov()
  const before = snapshot(db)
  const card0001 = db.cards.find(c => c.num === 'КАКАПО-0001')
  let threw = null
  try {
    assertCardAssignableToClient(db, card0001, holov)
  } catch (e) {
    threw = e
  }
  expect(threw instanceof CardOwnershipConflict, 'must throw')
  expect(threw.code === 'CARD_OWNED_BY_OTHER_CLIENT', `code=${threw.code}`)
  expect(snapshot(db) === before, 'no mutation')
})

// CASE 2
test('CASE 2: same card text + different clientId/phone — no auto-merge', () => {
  const { db, sayod, holov } = fixtureSayodHolov()
  // Holov payload claims card 0001 by number only
  const attempted = { ...holov, card: 'КАКАПО-0001' }
  const before = snapshot(db)
  let threw = null
  try {
    assertCardAssignableToClient(db, db.cards[0], attempted)
  } catch (e) {
    threw = e
  }
  expect(!!threw, 'reject')
  const unlink = unlinkNonCanonicalSiblingCards(db, attempted, 'КАКАПО-0001', normalizeCardRow)
  expect(unlink.unlinked.length === 0, 'no siblings unlinked for foreign keep')
  expect(
    unlink.skipped.some(s => s.reason === 'CARD_OWNED_BY_OTHER_CLIENT' || s.reason === 'KEEP_CARD_FOREIGN' || s.reason === 'FOREIGN_CLIENT_ID'),
    'foreign keep rejected',
  )
  expect(db.cards.find(c => c.num === 'КАКАПО-0003').debt === 320.04, '0003 debt intact')
  expect(db.cards.find(c => c.num === 'КАКАПО-0001').clientId === 'U-01', '0001 still Sayod')
  // findCanonical must not return foreign card for Holov
  const canon = findCanonicalCard(db, { ...holov, card: 'КАКАПО-0001' })
  expect(!canon || canon.num === 'КАКАПО-0003', `canon=${canon?.num}`)
  void sayod
})

// CASE 3
test('CASE 3: debt-bearing sibling of FOREIGN client — unlink must not zero', () => {
  const { db, holov } = fixtureSayodHolov()
  // Holov becomes canonical of 0003; must not touch Sayod 0001
  const res = unlinkNonCanonicalSiblingCards(db, holov, 'КАКАПО-0003', normalizeCardRow)
  expect(res.unlinked.length === 0, 'nothing unlinked')
  expect(res.skipped.some(s => s.num === 'КАКАПО-0001' && s.reason === 'FOREIGN_CLIENT_ID'), '0001 skipped')
  expect(r2(db.cards.find(c => c.num === 'КАКАПО-0001').debt) === 1741.31, 'Sayod debt intact')
  expect((db.cards.find(c => c.num === 'КАКАПО-0001').debtLedger || []).length === 1, 'Sayod ledger intact')
})

// CASE 4
test('CASE 4: offline/sync stale payload cannot steal canonical card', () => {
  const { db } = fixtureSayodHolov()
  const before = snapshot(db)
  // Stale Holov client patch claiming card 0001 + Sayod phone mismatch
  const stale = {
    id: 'U-03',
    phone: '+992938463959',
    name: 'Холов Баходур',
    card: 'КАКАПО-0001',
    debt: 912.24,
  }
  let threw = null
  try {
    assertCardAssignableToClient(db, db.cards[0], stale)
  } catch (e) {
    threw = e
  }
  expect(threw?.code === 'CARD_OWNED_BY_OTHER_CLIENT', 'stale steal rejected')
  // Simulate ensure path: do not mutate on conflict
  expect(snapshot(db) === before, 'db unchanged')
})

// CASE 5
test('CASE 5: retry/idempotency — no duplicate relink or identity mutation', () => {
  const { db, sayod } = fixtureSayodHolov()
  const before = snapshot(db)
  assertCardAssignableToClient(db, db.cards[0], sayod) // ok same person
  assertCardAssignableToClient(db, db.cards[0], sayod) // retry
  const r1 = unlinkNonCanonicalSiblingCards(db, sayod, 'КАКАПО-0001', normalizeCardRow)
  const r2b = unlinkNonCanonicalSiblingCards(db, sayod, 'КАКАПО-0001', normalizeCardRow)
  expect(r1.unlinked.length === 0 && r2b.unlinked.length === 0, 'idempotent unlink')
  expect(snapshot(db) === before, 'no identity drift on retry')
})

// CASE 6
test('CASE 6: normal same-person card hydration still works', () => {
  const client = {
    id: 'U-99',
    phone: '+992500000099',
    card: 'КАКАПО-0099',
    name: 'Test User',
    debt: 50,
  }
  const db = {
    cards: [
      normalizeCardRow({
        num: 'КАКАПО-0021',
        client: 'Test User',
        phone: client.phone,
        clientId: 'U-99',
        status: 'active',
        debt: 10,
        debtLedger: [{ id: 'OLD', remaining: 10 }],
      }),
      normalizeCardRow({
        num: 'КАКАПО-0099',
        client: 'Test User',
        phone: client.phone,
        clientId: 'U-99',
        status: 'active',
        debt: 50,
        debtLedger: [{ id: 'NEW', remaining: 50 }],
      }),
    ],
  }
  assertCardAssignableToClient(db, db.cards[1], client)
  const { unlinked, transferred } = unlinkNonCanonicalSiblingCards(db, client, 'КАКАПО-0099', normalizeCardRow)
  expect(unlinked.includes('КАКАПО-0021'), 'old sibling archived')
  expect(transferred.some(t => t.from === 'КАКАПО-0021'), 'debt transferred')
  expect(r2(db.cards.find(c => c.num === 'КАКАПО-0099').debt) === 60, '50+10')
  expect(findCanonicalCard(db, client)?.num === 'КАКАПО-0099', 'canonical')
})

test('debt unlink forbidden without allowDebtDestroy', () => {
  const card = normalizeCardRow({ num: 'КАКАПО-0001', debt: 100, clientId: 'U-01', status: 'active' })
  let threw = null
  try {
    assertDebtCardUnlinkAllowed(card)
  } catch (e) {
    threw = e
  }
  expect(threw?.code === 'DEBT_CARD_UNLINK_FORBIDDEN', 'forbidden')
  assertDebtCardUnlinkAllowed(card, { allowDebtDestroy: true })
})

const failed = results.filter(r => r.status === 'FAIL')
console.log(JSON.stringify({
  passed: results.filter(r => r.status === 'PASS').length,
  failed: failed.length,
  failures: failed,
}, null, 2))
if (failed.length) process.exit(1)
