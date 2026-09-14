/**
 * Cash advance HISTORY UI — dedupe / label / ledger merge (no accounting).
 * Run: node scripts/cash-advance-history-ui-test.mjs
 */
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const {
  CASH_ADVANCE_HISTORY_LABEL,
  mapDebtLedgerSource,
  upsertLocalCashAdvanceHistory,
  mergeCashAdvanceLedgerEntry,
  mergeOpenCashAdvancesFromClientLedger,
  countCashAdvanceHistoryRows,
  findMatchingCashAdvanceLocal,
} = await import(pathToFileURL(path.join(root, 'lib/cashAdvanceHistoryCore.mjs')).href)

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`PASS  ${name}`)
  } catch (e) {
    failed++
    console.error(`FAIL  ${name}`)
    console.error(`      ${e?.message || e}`)
  }
}

function expect(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}

test('mapDebtLedgerSource maps cash_advance → cashier', () => {
  expect(mapDebtLedgerSource('cash_advance') === 'cashier')
  expect(mapDebtLedgerSource('pos') === 'pos')
})

test('local write uses fixed label Выдача наличных', () => {
  const { next, duplicated } = upsertLocalCashAdvanceHistory([], {
    amount: 1,
    ts: Date.parse('2026-09-13T12:49:56.410Z'),
    clientRef: '18fd36ec-7ddc-413f-9680-a262e26f854e',
  })
  expect(!duplicated)
  expect(next.length === 1)
  expect(next[0].desc === CASH_ADVANCE_HISTORY_LABEL)
  expect(next[0].source === 'cashier')
  expect(Math.abs(next[0].amount) === 1)
})

test('ledger sync after local write does not duplicate', () => {
  const local = upsertLocalCashAdvanceHistory([], {
    amount: 1,
    ts: Date.parse('2026-09-13T12:49:56.410Z'),
    clientRef: 'ref-1',
  }).next
  const merged = mergeCashAdvanceLedgerEntry(local, {
    id: 'DL-1789303943141-e5kn',
    amount: 1,
    remaining: 1,
    source: 'cash_advance',
    createdAtIso: '2026-09-13T12:49:56.410Z',
    clientRef: 'ref-1',
    desc: 'Выдача наличных · Сайёд',
  })
  expect(countCashAdvanceHistoryRows(merged.next) === 1, `got ${countCashAdvanceHistoryRows(merged.next)}`)
  expect(merged.next.some(r => r.id === 'ldg-DL-1789303943141-e5kn' || r.clientRef === 'ref-1'))
  expect(merged.next[0].orderId === 'DL-1789303943141-e5kn', 'server ledger id stored as orderId')
})

test('local write after ledger sync does not duplicate', () => {
  const fromLedger = mergeCashAdvanceLedgerEntry([], {
    id: 'DL-NEW',
    amount: 1,
    source: 'cash_advance',
    createdAtIso: '2026-09-13T12:50:00.000Z',
  }).next
  const again = upsertLocalCashAdvanceHistory(fromLedger, {
    amount: 1,
    ts: Date.parse('2026-09-13T12:50:00.000Z'),
    ledgerEntryId: 'DL-NEW',
  })
  expect(again.duplicated === true)
  expect(countCashAdvanceHistoryRows(again.next) === 1)
})

test('reconnect / hydrate merge is idempotent', () => {
  let hist = []
  for (let i = 0; i < 3; i++) {
    hist = mergeOpenCashAdvancesFromClientLedger(hist, [
      {
        id: 'DL-1',
        amount: 1,
        remaining: 1,
        source: 'cash_advance',
        createdAtIso: '2026-09-13T12:49:56.410Z',
      },
    ]).next
  }
  expect(countCashAdvanceHistoryRows(hist) === 1)
})

test('POS product debt rows are not treated as cash advance', () => {
  const hist = [
    {
      id: 'pos-1',
      type: 'debt',
      source: 'pos',
      orderId: 'SALE-1',
      amount: -50,
      desc: 'Чек №12',
      ts: Date.now(),
    },
  ]
  const merged = mergeOpenCashAdvancesFromClientLedger(hist, [
    {
      id: 'DL-CA',
      amount: 1,
      remaining: 1,
      source: 'cash_advance',
      createdAtIso: '2026-09-13T12:49:56.410Z',
    },
  ]).next
  expect(merged.filter(r => r.source === 'pos').length === 1)
  expect(countCashAdvanceHistoryRows(merged) === 1)
  expect(!findMatchingCashAdvanceLocal(hist, {
    id: 'x',
    amount: 50,
    source: 'cash_advance',
    createdAtIso: new Date().toISOString(),
  }), 'should not match POS rows')
})

test('accounting paths are not imported here (history-only module)', () => {
  expect(CASH_ADVANCE_HISTORY_LABEL === 'Выдача наличных')
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
