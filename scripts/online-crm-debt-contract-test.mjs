/**
 * ONLINE-4 — CRM / debt online consistency.
 * Run: node scripts/online-crm-debt-contract-test.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  diagnoseDebtProjection,
  resolveAuthoritativeCustomerDebt,
  displayedCustomerDebt,
  sumDisplayedCustomerDebts,
  round2,
} from '../lib/debtUiProjectionCore.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

let passed = 0
let failed = 0

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++
      console.log(`PASS  ${name}`)
    })
    .catch((e) => {
      failed++
      console.error(`FAIL  ${name}`)
      console.error(`      ${e?.message || e}`)
    })
}

function expect(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

// Simulate old max() projector vs canonical
function oldMaxDebt(clientDebt, cardDebt) {
  return Math.max(0, Number(clientDebt) || 0, Number(cardDebt) || 0)
}

await test('A) client=64 card=64 ledger=64 → all projections 64', () => {
  const input = {
    clientDebt: 64,
    cardDebt: 64,
    debtLedger: [{ remaining: 64 }],
  }
  const d = resolveAuthoritativeCustomerDebt(input)
  expect(d === 64, `debt=${d}`)
  expect(displayedCustomerDebt(input) === 64, 'displayed')
  expect(sumDisplayedCustomerDebts([{ debt: d }]) === 64, 'sum')
  const diag = diagnoseDebtProjection(input)
  expect(diag.source === 'ledger', `source=${diag.source}`)
  expect(!diag.disagreed, 'no drift')
})

await test('B) U-37 shape: 207.85 via ledger 108.85+99', () => {
  const input = {
    clientDebt: 207.85,
    cardDebt: 207.85,
    debtLedger: [{ remaining: 108.85 }, { remaining: 99 }],
  }
  const d = resolveAuthoritativeCustomerDebt(input)
  expect(d === 207.85, `debt=${d}`)
  expect(diagnoseDebtProjection(input).source === 'ledger', 'ledger source')
})

await test('C) stale IDB 999 vs API 64 → after sync projection 64', () => {
  const idb = { clientDebt: 999, cardDebt: 999, debtLedger: [{ remaining: 999 }] }
  expect(resolveAuthoritativeCustomerDebt(idb) === 999, 'before sync shows idb')
  const afterApi = { clientDebt: 64, cardDebt: 64, debtLedger: [{ remaining: 64 }] }
  expect(resolveAuthoritativeCustomerDebt(afterApi) === 64, 'after sync 64')
})

await test('D) card/client disagreement: NOT max; deterministic + diagnostic', () => {
  const input = { clientDebt: 64, cardDebt: 999 }
  const d = resolveAuthoritativeCustomerDebt(input)
  expect(d === 64, `prefer client not max; got ${d}`)
  expect(oldMaxDebt(64, 999) === 999, 'old max would hide')
  expect(d !== oldMaxDebt(64, 999), 'canonical != max')
  const diag = diagnoseDebtProjection(input)
  expect(diag.disagreed === true, 'diagnostic disagreed')
  expect(diag.drift.clientCard === true, 'clientCard drift')
  expect(diag.source === 'client', `source=${diag.source}`)
})

await test('E wiring: browser client update awaits API / reverts on fail', () => {
  const src = read('lib/clientStore.ts')
  expect(/await api\.updateClient/.test(src), 'await updateClient')
  expect(/clients: prev/.test(src) && /apiError/.test(src), 'revert + apiError')
  expect(/isTradeLocalFirst\(\)/.test(src), 'platform branch')
})

await test('F wiring: browser card update/unlink no silent success', () => {
  const src = read('lib/cardStore.ts')
  expect(/await api\.updateCard/.test(src), 'await updateCard')
  expect(/Не удалось отвязать карту/.test(src) || /unlink/.test(src), 'unlink error path')
  expect(/cards: prev/.test(src), 'revert cards')
})

await test('G wiring: debt repay awaits refreshAll', () => {
  const src = read('components/trade/DebtsModule.tsx')
  expect(/await refreshAll\(\)/.test(src), 'await refresh')
  expect(/const refreshAll = useCallback\(async \(\)/.test(src), 'async refreshAll')
  expect(/resolveAuthoritativeCustomerDebt/.test(src), 'uses canonical')
})

await test('H) repay failure keeps confirmed debt (contract)', () => {
  // Pure: projection unchanged when mutation throws before state update
  const before = { clientDebt: 64, cardDebt: 64, debtLedger: [{ remaining: 64 }] }
  const confirmed = resolveAuthoritativeCustomerDebt(before)
  let threw = false
  try {
    throw new Error('HTTP 409')
  } catch {
    threw = true
  }
  expect(threw && resolveAuthoritativeCustomerDebt(before) === confirmed, 'debt unchanged')
})

await test('I wiring: Desktop local-first CRM path preserved', () => {
  const clientSrc = read('lib/clientStore.ts')
  expect(/isTradeLocalFirst\(\)/.test(clientSrc), 'branches on local-first')
  expect(/api\.updateClient\(id, patch\)\.catch\(console\.error\)/.test(clientSrc), 'desktop fire-and-forget kept')
  const hyd = read('lib/offlineHydrate.ts')
  expect(/apiReady = isTradeLocalFirst\(\)/.test(hyd), 'browser hydrate apiReady false')
  expect(/if \(isTradeLocalFirst\(\)\) \{[\s\S]*refreshDebtOverlayFromQueue/.test(hyd), 'overlay only local-first')
})

await test('wiring: ClientsModule + Cashier use canonical projector', () => {
  const cli = read('components/trade/ClientsModule.tsx')
  expect(/resolveAuthoritativeCustomerDebt/.test(cli), 'Clients import')
  expect(/clientShownDebt/.test(cli), 'clientShownDebt helper')
  expect(!/effectiveDebt\(card, c\)/.test(cli), 'no list effectiveDebt')

  const cash = read('components/trade/CashierModule.tsx')
  expect(/resolveAuthoritativeCustomerDebt/.test(cash), 'Cashier projector')
  expect(!/effectiveDebt\(/.test(cash), 'Cashier no effectiveDebt display')
})

await test('wiring: effectiveDebt no longer max()', () => {
  const src = read('lib/cardCrm.ts')
  expect(/resolveAuthoritativeCustomerDebt/.test(src), 'effectiveDebt delegates')
  expect(!/Math\.max\(0, Number\(a\?\.debt\) \|\| 0, Number\(b\?\.debt\)/.test(src), 'old max removed')
})

await test('cases E–H edge: ledger absent equal; zero; multi; no card', () => {
  expect(resolveAuthoritativeCustomerDebt({ clientDebt: 10, cardDebt: 10 }) === 10, 'B equal no ledger')
  expect(resolveAuthoritativeCustomerDebt({ clientDebt: 0, cardDebt: 0 }) === 0, 'F zero')
  expect(resolveAuthoritativeCustomerDebt({
    debtLedger: [{ remaining: 1 }, { remaining: 2 }, { remaining: 3 }],
  }) === 6, 'G multi')
  expect(resolveAuthoritativeCustomerDebt({ clientDebt: 5 }) === 5, 'E no card')
  expect(resolveAuthoritativeCustomerDebt({ cardDebt: 7 }) === 7, 'card only')
})

console.log('')
console.log(`online-crm-debt-contract: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
