/**
 * Debt history sync core — история долга строится строго из серверного журнала,
 * поэтому на всех устройствах (и в онлайне) лента чеков и оплат совпадает.
 * Run: node scripts/debt-history-sync-core-test.mjs
 */
import {
  buildLedgerHistoryRows,
  entriesFromClientLedger,
  mergeLocalOnlyRows,
  normalizeLedgerEntry,
} from '../lib/debtHistoryLedgerCore.mjs'

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
const round2 = n => Math.round((Number(n) || 0) * 100) / 100
const isManual = r => r && r.source === 'manual' && !r.orderId

/** Один и тот же серверный журнал приходит на все устройства. */
const SERVER_LEDGER = [
  {
    id: 'DL-1',
    amount: 110.4,
    remaining: 20.4,
    paidAmount: 90,
    createdAtIso: '2026-10-01T13:18:00.000Z',
    orderId: 'K-13337',
    source: 'pos',
    desc: 'Чек K-13337',
    payments: [
      { id: 'MX-1', atIso: '2026-10-09T09:58:00.000Z', amount: 40, method: 'cash' },
      { id: 'MX-2', atIso: '2026-10-10T09:31:00.000Z', amount: 50, method: 'cash' },
    ],
  },
  {
    id: 'DL-2',
    amount: 26,
    remaining: 26,
    paidAmount: 0,
    createdAtIso: '2026-10-06T08:08:00.000Z',
    orderId: 'K-14289',
    source: 'pos',
    desc: 'Чек K-14289',
  },
  {
    id: 'DL-3',
    amount: 30,
    remaining: 0,
    paidAmount: 30,
    createdAtIso: '2026-09-04T11:00:00.000Z',
    orderId: 'K-7000',
    source: 'pos',
    desc: 'Чек K-7000',
  },
  {
    id: 'DL-4',
    amount: 20,
    remaining: 20,
    paidAmount: 0,
    createdAtIso: '2026-10-05T13:36:00.000Z',
    source: 'cash_advance',
    desc: 'Выдача',
  },
]

test('1) каждая запись журнала → строка долга, оплаты → строки погашения', () => {
  const rows = buildLedgerHistoryRows(entriesFromClientLedger(SERVER_LEDGER))
  const debts = rows.filter(r => r.type === 'debt')
  const pays = rows.filter(r => r.type === 'pay')
  expect(debts.length === 4, `debts=${debts.length}`)
  // DL-1: 2 реальные оплаты; DL-3: 1 синтетическая (нет разбивки)
  expect(pays.length === 3, `pays=${pays.length}`)
  expect(pays.some(p => p.id === 'srvpay-MX-1-DL-1'), 'реальная оплата MX-1')
  expect(pays.some(p => p.id === 'srvpay-MX-2-DL-1'), 'реальная оплата MX-2')
  expect(pays.some(p => p.id === 'ldg-pay-DL-3'), 'синтетическая оплата для старой записи')
})

test('2) реальные оплаты используют дату/способ из серверной разбивки', () => {
  const rows = buildLedgerHistoryRows(entriesFromClientLedger(SERVER_LEDGER))
  const p = rows.find(r => r.id === 'srvpay-MX-2-DL-1')
  expect(p, 'оплата есть')
  expect(round2(p.amount) === 50, `amount=${p.amount}`)
  expect(p.ts === Date.parse('2026-10-10T09:31:00.000Z'), 'дата реальной оплаты')
  expect(/наличные/.test(p.desc), `desc=${p.desc}`)
  expect(p.batchId === 'MX-2', 'batchId = id платежа (группировка)')
})

test('3) выдача наличных помечается как «Выдача наличных»', () => {
  const rows = buildLedgerHistoryRows(entriesFromClientLedger(SERVER_LEDGER))
  const cash = rows.find(r => r.id === 'ldg-DL-4')
  expect(cash && cash.desc === 'Выдача наличных', `desc=${cash && cash.desc}`)
})

test('4) ЛЮБОЕ устройство получает одинаковую историю из одного журнала', () => {
  const entries = entriesFromClientLedger(SERVER_LEDGER)
  const authoritative = buildLedgerHistoryRows(entries)
  // Устройство A — с локальными накоплениями (не ручными). Устройство B — пустое.
  const deviceA = mergeLocalOnlyRows(authoritative, [
    { id: 'pos-K-14289', ts: Date.parse('2026-10-06T08:08:00.000Z'), date: '6 окт 2026', time: '08:08', desc: 'Чек K-14289', amount: -26, type: 'debt', orderId: 'K-14289', source: 'pos' },
    { id: 'pay-local-1', ts: Date.parse('2026-10-10T09:31:00.000Z'), date: '10 окт 2026', time: '09:31', desc: 'Погашение', amount: 50, type: 'pay', orderId: 'K-13337', source: 'cashier' },
  ], isManual)
  const deviceB = mergeLocalOnlyRows(authoritative, [], isManual)
  const key = list => list.map(r => `${r.type}|${r.id}|${round2(r.amount)}|${r.orderId || ''}`).sort().join('\n')
  expect(key(deviceA) === key(deviceB), 'истории устройств совпадают')
  expect(deviceA.length === authoritative.length, `A=${deviceA.length} auth=${authoritative.length}`)
})

test('5) локальная ручная запись сохраняется, но дубль операции отбрасывается', () => {
  const entries = entriesFromClientLedger(SERVER_LEDGER)
  const authoritative = buildLedgerHistoryRows(entries)
  const withManual = mergeLocalOnlyRows(authoritative, [
    // Ручная, которой нет на сервере — должна остаться
    { id: 'manual-1', ts: 1, date: 'давно', time: '', desc: 'Ручной долг', amount: -500, type: 'debt', source: 'manual' },
    // Дубль серверного чека K-14289 — отбрасывается
    { id: 'manual-dup', ts: Date.parse('2026-10-06T08:08:00.000Z'), date: '6 окт 2026', time: '08:08', desc: 'Чек K-14289', amount: -26, type: 'debt', source: 'manual' },
  ], isManual)
  expect(withManual.some(r => r.id === 'manual-1'), 'ручная осталась')
  expect(!withManual.some(r => r.id === 'manual-dup'), 'дубль операции не показан')
  expect(withManual.length === authoritative.length + 1, `len=${withManual.length}`)
})

test('6) результат детерминированный (повторный расчёт тот же)', () => {
  const a = buildLedgerHistoryRows(entriesFromClientLedger(SERVER_LEDGER))
  const b = buildLedgerHistoryRows(entriesFromClientLedger(SERVER_LEDGER))
  expect(JSON.stringify(a) === JSON.stringify(b), 'идентично')
})

test('7) сырой client.debtLedger (без paidAmount) считает погашенное сам', () => {
  const raw = [{ id: 'DL-9', amount: 100, remaining: 25, createdAtIso: '2026-10-02T10:00:00.000Z', orderId: 'K-1', source: 'pos' }]
  const rows = buildLedgerHistoryRows(entriesFromClientLedger(raw))
  const pay = rows.find(r => r.type === 'pay')
  expect(pay && round2(pay.amount) === 75, `paid=${pay && pay.amount}`)
  expect(normalizeLedgerEntry(raw[0]).paidAmount === 75, 'normalize paidAmount')
})

test('8) вход пустой → пустая история (не падает)', () => {
  expect(buildLedgerHistoryRows([]).length === 0, 'empty')
  expect(buildLedgerHistoryRows(entriesFromClientLedger(undefined)).length === 0, 'undefined')
})

test('9) офлайн-операция (ещё нет на сервере) показывается, серверный дубль — нет', () => {
  const entries = entriesFromClientLedger(SERVER_LEDGER)
  const authoritative = buildLedgerHistoryRows(entries)
  const keepLocal = r => !/^(ldg-|ldg-pay-|srvpay-)/.test(String(r.id || ''))
  const rows = mergeLocalOnlyRows(authoritative, [
    // Офлайн: чек в долг ещё не ушёл на сервер → показываем
    { id: 'pos-offline-1', ts: 1_760_000_000_000, date: '10 окт 2026', time: '12:00', desc: 'Чек K-99999', amount: -77, type: 'debt', orderId: 'K-99999', source: 'pos' },
    // Серверный чек K-14289 → дубль, отбрасываем
    { id: 'pos-K-14289', ts: Date.parse('2026-10-06T08:08:00.000Z'), date: '6 окт 2026', time: '08:08', desc: 'Чек K-14289', amount: -26, type: 'debt', orderId: 'K-14289', source: 'pos' },
  ], keepLocal)
  expect(rows.some(r => r.id === 'pos-offline-1'), 'офлайн-запись видна')
  expect(!rows.some(r => r.id === 'pos-K-14289'), 'дубль серверного чека скрыт')
})

const failed = results.filter(r => r.status === 'FAIL')
console.log('\n---')
console.log(`PASS ${results.length - failed.length} / FAIL ${failed.length}`)
if (failed.length) process.exit(1)
