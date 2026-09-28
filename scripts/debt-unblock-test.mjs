/**
 * Ручная разблокировка долга: снимает блок, старые записи не блокируют снова,
 * новая просрочка после разблокировки считается как обычно.
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { unblockDebtCredit, runDebtMaintenance, canTakeNewDebt } = await import(pathToFileURL(path.join(root, 'server/kakapo-api/debtLedger.js')).href)

let pass = 0
let fail = 0
function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`PASS  ${name}`)
  } catch (e) {
    fail++
    console.log(`FAIL  ${name}: ${e.message}`)
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg || 'expectation failed')
}

const DAY = 864e5
const iso = ms => new Date(ms).toISOString()

function entry(id, amount, dueMs, extra = {}) {
  return {
    id,
    amount,
    remaining: amount,
    createdAtIso: iso(dueMs - 30 * DAY),
    dueAtIso: iso(dueMs),
    source: 'pos',
    desc: 'Чек',
    createdNotified: true,
    reminderNotified: false,
    overdueNotified: false,
    overdueStrikeApplied: false,
    ...extra,
  }
}

function makeDb() {
  const now = Date.now()
  const client = {
    id: 'c1',
    name: 'Музафар',
    phone: '+992900000001',
    card: 'КАКАПО-0001',
    debt: 300,
    debtLimit: 1000,
    debtEnabled: true,
    debtOverdueStrikes: 5,
    debtCreditBlocked: true,
    debtLedger: [
      entry('old-overdue', 100, now - 5 * DAY, { overdueNotified: true, overdueStrikeApplied: true }),
      entry('soon-a', 100, now + 1 * DAY),
      entry('soon-b', 100, now + 1 * DAY),
    ],
  }
  const card = {
    id: 'num:КАКАПО-0001',
    num: 'КАКАПО-0001',
    clientId: 'c1',
    phone: client.phone,
    debt: 300,
    debtCreditBlocked: true,
    debtOverdueStrikes: 5,
    status: 'active',
  }
  return { db: { clients: [client], cards: [card] }, client, card, now }
}

test('разблокировка снимает блок на клиенте и карте, долг не меняется', () => {
  const { client, card } = makeDb()
  const r = unblockDebtCredit(client, card)
  expect(client.debtCreditBlocked === false, 'client still blocked')
  expect(client.debtOverdueStrikes === 0, 'strikes not reset')
  expect(card.debtCreditBlocked === false, 'card still blocked')
  expect(card.debtOverdueStrikes === 0, 'card strikes not reset')
  expect(client.debt === 300, 'debt changed')
  expect(r.markedEntries === 2, `marked ${r.markedEntries}`)
  expect(canTakeNewDebt(client, card, 50).ok !== false, 'still cannot take debt')
})

test('ночная проверка сразу после разблокировки не блокирует снова', () => {
  const { db, client, card } = makeDb()
  unblockDebtCredit(client, card)
  runDebtMaintenance(db)
  expect(client.debtCreditBlocked === false, 'reblocked now')
  expect(client.debtOverdueStrikes === 0, `strikes ${client.debtOverdueStrikes}`)
})

test('старые записи, просроченные после разблокировки, не дают страйков', () => {
  const { db, client, card, now } = makeDb()
  unblockDebtCredit(client, card)
  runDebtMaintenance(db, iso(now + 3 * DAY))
  expect(client.debtCreditBlocked === false, 'reblocked by old entries')
  expect(client.debtOverdueStrikes === 0, `strikes ${client.debtOverdueStrikes}`)
})

test('новые долги после разблокировки снова считаются при просрочке', () => {
  const { db, client, card, now } = makeDb()
  unblockDebtCredit(client, card)
  client.debtLedger.unshift(entry('new-1', 50, now + 2 * DAY), entry('new-2', 50, now + 2 * DAY))
  client.debt = 400
  runDebtMaintenance(db, iso(now + 4 * DAY))
  expect(client.debtOverdueStrikes === 2, `strikes ${client.debtOverdueStrikes}`)
  expect(client.debtCreditBlocked === true, 'new overdue did not block')
})

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
