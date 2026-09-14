/**
 * CRM identity re-corruption guards (Sayod/Holov).
 * Covers Desktop merge authority + server reject paths.
 *
 * Run: node scripts/crm-identity-recorrupt-guard-test.mjs
 */
import {
  assertCardAssignableToClient,
  CardOwnershipConflict,
  unlinkNonCanonicalSiblingCards,
} from '../server/kakapo-api/cardCanonical.js'
import {
  syncDebtLedgerFromCard,
  syncDebtLedgerToCard,
} from '../server/kakapo-api/debtLedger.js'
import {
  mergeClientsServerAuthoritative,
  mergeCardsServerAuthoritative,
  patchHasClientIdentity,
  patchHasCardIdentity,
} from '../lib/crmIdentityAuthorityCore.mjs'

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

function goodServer() {
  return {
    clients: [
      {
        id: 'U-01',
        name: 'Сайёд Гафуров',
        phone: '+992 50 190 31 41',
        card: 'КАКАПО-0001',
        debt: 1741.31,
        debtLedger: [{ id: 'DL-S', amount: 1741.31, remaining: 1741.31 }],
      },
      {
        id: 'U-03',
        name: 'Холов Баходур',
        phone: '+992938463959',
        card: 'КАКАПО-0003',
        debt: 912.24,
        debtLedger: [{ id: 'DL-H', amount: 912.24, remaining: 912.24 }],
      },
    ],
    cards: [
      normalizeCardRow({
        num: 'КАКАПО-0001',
        clientId: 'U-01',
        client: 'Сайёд Гафуров',
        phone: '+992 50 190 31 41',
        status: 'active',
        debt: 1741.31,
        debtLedger: [{ id: 'DL-S', amount: 1741.31, remaining: 1741.31 }],
      }),
      normalizeCardRow({
        num: 'КАКАПО-0003',
        clientId: 'U-03',
        client: 'Холов Баходур',
        phone: '+992938463959',
        status: 'active',
        debt: 912.24,
        debtLedger: [{ id: 'DL-H', amount: 912.24, remaining: 912.24 }],
      }),
    ],
  }
}

function corruptDesktop() {
  const led = [
    { id: 'DL-BF', amount: 1741.31, remaining: 1741.31, source: 'backfill' },
    { id: 'DL-CA', amount: 486.7, remaining: 486.7, source: 'cash_advance' },
  ]
  return {
    clients: [
      {
        id: 'U-01',
        name: 'Холов Баходур',
        phone: '+992 50 190 31 41',
        card: 'КАКАПО-0001',
        debt: 2228.01,
        debtLedger: led,
        updatedAtIso: '2026-09-13T14:23:09.399Z',
      },
      {
        id: 'U-03',
        name: 'Холов Баходур',
        phone: '+992938463959',
        card: 'КАКАПО-0001',
        debt: 2228.01,
        debtLedger: led,
        updatedAtIso: '2026-09-13T14:23:09.399Z',
      },
    ],
    cards: [
      normalizeCardRow({
        num: 'КАКАПО-0001',
        clientId: 'U-03',
        client: 'Холов Баходур',
        phone: '+992938463959',
        status: 'active',
        debt: 2228.01,
        debtLedger: led,
      }),
      normalizeCardRow({
        num: 'КАКАПО-0003',
        clientId: undefined,
        client: '',
        phone: '',
        status: 'unlinked',
        debt: 0,
        debtLedger: [],
      }),
    ],
  }
}

// ——— TEST A: corrupt Desktop converges to good server ———
test('A) startup merge converges corrupt Desktop to good server', () => {
  const local = corruptDesktop()
  const remote = goodServer()
  const clients = mergeClientsServerAuthoritative(local.clients, remote.clients)
  const cards = mergeCardsServerAuthoritative(local.cards, remote.cards)
  const u01 = clients.find(c => c.id === 'U-01')
  const u03 = clients.find(c => c.id === 'U-03')
  const c1 = cards.find(c => c.num === 'КАКАПО-0001')
  const c3 = cards.find(c => c.num === 'КАКАПО-0003')
  expect(u01.name === 'Сайёд Гафуров', 'U-01 name Sayod')
  expect(u01.card === 'КАКАПО-0001', 'U-01 card 0001')
  expect(u03.name === 'Холов Баходур', 'U-03 Holov')
  expect(u03.card === 'КАКАПО-0003', 'U-03 card 0003')
  expect(c1.clientId === 'U-01', '0001 owner U-01')
  expect(c3.clientId === 'U-03', '0003 owner U-03')
  expect(c3.status === 'active', '0003 active')
  expect(r2(u01.debt) === 1741.31, 'U-01 debt from server')
  expect(r2(u03.debt) === 912.24, 'U-03 debt from server')
})

// ——— TEST B: server rejects corrupt write ———
test('B) server rejects binding 0001 to U-03 when owned by U-01', () => {
  const db = goodServer()
  const card = db.cards.find(c => c.num === 'КАКАПО-0001')
  const holov = db.clients.find(c => c.id === 'U-03')
  let rejected = false
  try {
    assertCardAssignableToClient(db, card, holov)
  } catch (e) {
    expect(e instanceof CardOwnershipConflict, 'CardOwnershipConflict')
    expect(e.code === 'CARD_OWNED_BY_OTHER_CLIENT', e.code)
    rejected = true
  }
  expect(rejected, 'must reject')
  // server unchanged
  expect(card.clientId === 'U-01', 'card still U-01')
  expect(db.clients.find(c => c.id === 'U-01').name === 'Сайёд Гафуров', 'Sayod intact')
})

// ——— TEST C: phone collision cannot cross-merge IDs ———
test('C) phone collision cannot cross-merge client ids', () => {
  const local = [
    { id: 'U-01', name: 'A', phone: '+992111', card: 'КАКАПО-0001', debt: 1 },
    { id: 'U-99', name: 'LocalOnly', phone: '+992938463959', card: '', debt: 0 },
  ]
  const remote = [
    { id: 'U-01', name: 'Сайёд Гафуров', phone: '+992 50 190 31 41', card: 'КАКАПО-0001', debt: 1741.31 },
    { id: 'U-03', name: 'Холов Баходур', phone: '+992938463959', card: 'КАКАПО-0003', debt: 912.24 },
  ]
  const merged = mergeClientsServerAuthoritative(local, remote)
  expect(merged.find(c => c.id === 'U-01').phone.includes('50'), 'U-01 keeps own phone from server')
  expect(merged.find(c => c.id === 'U-03').id === 'U-03', 'U-03 present')
  expect(!merged.some(c => c.id === 'U-01' && c.phone.includes('938')), 'no phone steal onto U-01')
})

// ——— TEST D: same-name clients remain separate ———
test('D) same-name clients remain separate by id', () => {
  const remote = [
    { id: 'U-01', name: 'Холов Баходур', phone: '1', card: 'КАКАПО-0001', debt: 1 },
    { id: 'U-03', name: 'Холов Баходур', phone: '2', card: 'КАКАПО-0003', debt: 2 },
  ]
  const merged = mergeClientsServerAuthoritative([], remote)
  expect(merged.length === 2, 'two rows')
  expect(new Set(merged.map(c => c.id)).size === 2, 'distinct ids')
})

// ——— TEST E: card ownership conflict ———
test('E) card ownership conflict is explicit 409-class error', () => {
  const db = goodServer()
  try {
    assertCardAssignableToClient(db, db.cards[0], db.clients[1])
    throw new Error('should throw')
  } catch (e) {
    expect(e.status === 409 || e.code === 'CARD_OWNED_BY_OTHER_CLIENT', '409-class')
  }
})

// ——— TEST F: debtLedger cannot assign U-01 ledger to U-03 ———
test('F) debtLedger from U-01 card cannot land on U-03', () => {
  const db = goodServer()
  const card = db.cards.find(c => c.num === 'КАКАПО-0001')
  const holov = db.clients.find(c => c.id === 'U-03')
  const before = JSON.stringify(holov.debtLedger)
  syncDebtLedgerFromCard(card, holov)
  expect(JSON.stringify(holov.debtLedger) === before, 'holov ledger unchanged')
  expect(r2(holov.debt) === 912.24, 'holov debt unchanged')
})

// ——— TEST G: restart cache semantics (server wins over stale data_clients) ———
test('G) authoritative merge overwrites stale data_clients projection', () => {
  const stale = corruptDesktop().clients
  const remote = goodServer().clients
  const once = mergeClientsServerAuthoritative(stale, remote)
  // simulate restart rehydrate from "persisted authoritative" then merge again
  const twice = mergeClientsServerAuthoritative(once, remote)
  expect(once.find(c => c.id === 'U-01').name === 'Сайёд Гафуров', 'first')
  expect(twice.find(c => c.id === 'U-01').name === 'Сайёд Гафуров', 'second')
  expect(once.find(c => c.id === 'U-03').card === 'КАКАПО-0003', 'card fixed')
})

// ——— TEST H: loyalty-only patch is not identity ———
test('H) loyalty patch is not treated as identity write', () => {
  expect(!patchHasClientIdentity({ bonus: 10, level: 'gold', debt: 5 }), 'client loyalty')
  expect(patchHasClientIdentity({ name: 'X' }), 'name is identity')
  expect(patchHasClientIdentity({ card: 'КАКАПО-0001' }), 'card is identity')
  expect(!patchHasCardIdentity({ bonus: 1, debt: 2, level: 'gold' }), 'card loyalty')
  expect(patchHasCardIdentity({ clientId: 'U-03' }), 'clientId is identity')
  expect(patchHasCardIdentity({ phone: '+1' }), 'phone is identity')
})

// ——— TEST I: open-shift unrelated — merge does not touch shifts ———
test('I) CRM merge does not mutate shift objects', () => {
  const shift = { id: 'SHIFT-1', status: 'open', salesCash: 100 }
  const copy = JSON.stringify(shift)
  mergeClientsServerAuthoritative(corruptDesktop().clients, goodServer().clients)
  expect(JSON.stringify(shift) === copy, 'shift untouched')
})

// ——— TEST J: stock/sales/finance untouched by ownership unlink ———
test('J) unlink sibling refuses foreign debt wipe; sales arrays untouched', () => {
  const db = goodServer()
  db.sales = [{ id: 'SALE-1', total: 10 }]
  db.stock = [{ id: 'P1', qty: 5 }]
  db.moneyLedger = [{ id: 'LED-1', amount: 1 }]
  const salesBefore = JSON.stringify(db.sales)
  const stockBefore = JSON.stringify(db.stock)
  const finBefore = JSON.stringify(db.moneyLedger)
  // Holov tries to keep 0001 (foreign) — skipped, no wipe
  const r = unlinkNonCanonicalSiblingCards(db, db.clients[1], 'КАКАПО-0001', normalizeCardRow)
  expect(r.skipped.length >= 1, 'skipped foreign keep')
  expect(db.cards.find(c => c.num === 'КАКАПО-0001').debt > 0, '0001 debt intact')
  expect(db.cards.find(c => c.num === 'КАКАПО-0003').debt > 0, '0003 debt intact')
  expect(JSON.stringify(db.sales) === salesBefore, 'sales')
  expect(JSON.stringify(db.stock) === stockBefore, 'stock')
  expect(JSON.stringify(db.moneyLedger) === finBefore, 'finance')
})

// Extra: syncDebtLedgerToCard also blocked cross-client
test('F2) syncDebtLedgerToCard blocked across clientId', () => {
  const db = goodServer()
  const card = db.cards.find(c => c.num === 'КАКАПО-0003')
  const sayod = db.clients.find(c => c.id === 'U-01')
  const before = card.debtLedger.length
  syncDebtLedgerToCard(sayod, card, { syncDebtBalance: true })
  expect(card.debtLedger.length === before, 'no ledger copy')
  expect(r2(card.debt) === 912.24, 'card debt unchanged')
})

const failed = results.filter(r => r.status === 'FAIL')
console.log('\nSUMMARY', { total: results.length, passed: results.length - failed.length, failed: failed.length })
if (failed.length) {
  console.error(failed)
  process.exit(1)
}
