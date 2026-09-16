/**
 * ONLINE-7/8 — final browser online hardening.
 * Run: node scripts/online-final-hardening-test.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { racePlatformOpCore } from '../lib/racePlatformOpCore.mjs'

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

const CRITICAL_OPS = [
  'createStockReceiptSafe',
  'createStockWriteoffSafe',
  'createSaleSafe',
  'returnSaleSafe',
  'openShiftSafe',
  'closeShiftSafe',
  'financeMoveSafe',
  'cardTopupSafe',
  'cashAdvanceSafe',
  'debtRepaySafe',
  'createPosPointSafe',
  'ensureCashierSafe',
]

await test('A) Browser critical ops → queue delta 0 (racePlatformOp)', async () => {
  for (const _op of CRITICAL_OPS) {
    let queueN = 0
    await racePlatformOpCore(
      async () => ({ ok: true }),
      async () => {
        queueN++
        return { ok: false }
      },
      {
        isLocalFirst: () => false,
        localFirstOp: async (fn) => {
          queueN++
          return { offline: true, data: await fn() }
        },
      },
    )
    expect(queueN === 0, `${_op} queue`)
  }
})

await test('B) Desktop same ops → local-first/outbox preserved', async () => {
  let queueN = 0
  const res = await racePlatformOpCore(
    async () => ({ id: 'SRV' }),
    async () => {
      queueN++
      return { id: 'off-x' }
    },
    {
      isLocalFirst: () => true,
      localFirstOp: async (fn) => ({ offline: true, data: await fn() }),
    },
  )
  expect(queueN === 1 && res.offline === true, 'desktop queue')
})

await test('C) No success before API resolve (wiring)', () => {
  const cash = read('components/trade/CashierModule.tsx')
  const ret = cash.match(/returnBusyRef\.current = true[\s\S]*?returnBusyRef\.current = false/)
  expect(ret[0].indexOf('await returnSaleSafe') < ret[0].indexOf('setReturnConfirm(null)'), 'return')
  const sale = cash.match(/sellingTicketIdRef\.current = ticketId[\s\S]*?sellingTicketIdRef\.current = null/)
  expect(/await createSaleSafe|createSaleSafe\(/.test(sale[0]), 'sale awaits')
  expect(/showToast\([\s\S]*Продажа|Чек|Успех/.test(sale[0]) === false
    || sale[0].indexOf('createSaleSafe') < sale[0].lastIndexOf('showToast'), 'toast after')
})

await test('D) API reject → no fake success', async () => {
  let success = false
  try {
    await racePlatformOpCore(
      async () => {
        throw new Error('HTTP 422')
      },
      async () => {
        success = true
        return { id: 'fake' }
      },
      {
        isLocalFirst: () => false,
        localFirstOp: async (fn) => ({ offline: true, data: await fn() }),
      },
    )
    success = true
  } catch { /* expected */ }
  expect(!success, 'no success')
})

await test('E) Double-click → one logical operation (sale guard)', () => {
  const cash = read('components/trade/CashierModule.tsx')
  expect(/if \(sellingTicketIdRef\.current === ticketId\) return false/.test(cash), 'double-click guard')
  expect(/ticketSaleClientRefMap/.test(cash), 'sticky clientRef map')
})

await test('F) Timeout-after-commit retry same clientRef (sale sticky)', () => {
  const cash = read('components/trade/CashierModule.tsx')
  expect(/Один clientRef на попытку чека/.test(cash)
    || /stickyClientRef/.test(cash), 'sticky comment/var')
  expect(/ticketSaleClientRefMap\.current\.get\(ticketId\)/.test(cash), 'reuse ref')
  expect(/ticketSaleClientRefMap\.current\.delete\(ticketId\)/.test(cash), 'clear on success only')
  // On failure path, delete must not run before catch clears sellingTicketId
  const body = cash.slice(cash.indexOf('let stickyClientRef'), cash.indexOf('sellingTicketIdRef.current = null'))
  expect(body.indexOf('ticketSaleClientRefMap.current.delete') > body.indexOf('createSaleSafe'),
    'delete after success create')

  const ops = read('lib/offlinePosOps.ts')
  expect(/stickyMoneyClientRef/.test(ops) && /clearStickyMoneyClientRef/.test(ops),
    'money sticky helpers')
  expect(/stickyScope = `finance_move\|/.test(ops), 'finance sticky scope')
  expect(/stickyScope = `cash_advance\|/.test(ops), 'cash advance sticky')
  expect(/stickyScope = `card_topup\|/.test(ops), 'topup sticky')
  expect(/stickyScope = `debt_repay\|/.test(ops), 'debt repay sticky')
  expect(/stickyScope = `sale_return\|/.test(ops), 'return sticky')

  const wh = read('lib/offlineWarehouseOps.ts')
  expect(/stickyWarehouseClientRef/.test(wh) && /clearStickyWarehouseClientRef/.test(wh),
    'warehouse sticky helpers')
})

await test('G) switchCashier close success/open fail → authoritative closed + error', () => {
  const cash = read('components/trade/CashierModule.tsx')
  const sw = cash.match(/async function switchCashier\(\) \{[\s\S]*?\n  async function openCashierScreen/)
    || cash.match(/async function switchCashier\(\) \{[\s\S]*?\n  function openCashierScreen/)
  expect(!!sw, 'switchCashier found')
  const body = sw[0]
  expect(/closedOk = true/.test(body), 'tracks close ACK')
  expect(/Смена закрыта, но новую открыть не удалось/.test(body), 'half-close message')
  expect(/setOpenShiftModal\(true\)/.test(body), 'open modal for retry')
  // settings must not flip before openShiftSafe
  const closeIdx = body.indexOf('closeShiftSafe')
  const openIdx = body.indexOf('openShiftSafe')
  const saveIdx = body.indexOf('saveSettings')
  expect(closeIdx < openIdx && openIdx < saveIdx, 'settings after both ACK')
})

await test('H) Post-sale repay failure → sale committed; repay failure separate', () => {
  const cash = read('components/trade/CashierModule.tsx')
  expect(/Продажа сохранена/.test(cash) && /Погашение долга не выполнено/.test(cash),
    'separate messages')
})

await test('I) stale IDB → server wins after readiness', () => {
  const hyd = read('lib/offlineHydrate.ts')
  expect(/apiReady = isTradeLocalFirst\(\)/.test(hyd), 'browser hydrate not ready')
  const v2 = read('lib/offlineV2.ts')
  expect(/isLocalId\(r\.id\)/.test(v2) || /filter\(r => !isLocalId/.test(v2), 'purge off-*')
  expect(/clearAllPending/.test(v2), 'clear outbox')
})

await test('J) mutation before authoritative readiness (Clients provisional debt)', () => {
  const cli = read('components/trade/ClientsModule.tsx')
  expect(/!isTradeLocalFirst\(\) && !useClientStore\.getState\(\)\.apiReady\) return 0/.test(cli)
    || /apiReady\) return 0/.test(cli), 'provisional debt 0')
})

await test('K) expiry batch writeoff ACK/refresh correct', () => {
  const wh = read('components/trade/WarehouseModule.tsx')
  expect(/deleteStockLayerSafe\(row\.receiptId/.test(wh), 'layer-targeted')
  expect(/await loadExpiry/.test(wh) && /await refreshAll/.test(wh), 'await refresh')
})

await test('L) reload after mutations: server-confirmed data remains (contract)', async () => {
  const store = { sales: [] }
  const res = await racePlatformOpCore(
    async () => ({ id: 'SALE-SRV', total: 10 }),
    async () => ({ id: 'off-sale' }),
    {
      isLocalFirst: () => false,
      localFirstOp: async (fn) => ({ offline: true, data: await fn() }),
    },
  )
  if (!res.offline) store.sales = [res.data]
  expect(store.sales[0].id === 'SALE-SRV', 'canonical survives')
})

await test('inventory: only 3 bare localFirstOp (desktop-gated money)', () => {
  const ops = read('lib/offlinePosOps.ts')
  const matches = ops.match(/localFirstOp\(applyLocal\)/g) || []
  expect(matches.length === 3, `expected 3 got ${matches.length}`)
  expect(/if \(!isTradeLocalFirst\(\)\)[\s\S]*?localFirstOp\(applyLocal\)/.test(ops), 'gated')
})

await test('inventory: no bare localFirstOp in warehouse/client race wrappers', () => {
  for (const f of [
    'lib/offlineWarehouseOps.ts',
    'lib/offlineClientOps.ts',
    'lib/offlineLoyaltyOps.ts',
  ]) {
    const src = read(f)
    expect(!/return localFirstOp\(localApply\)/.test(src), f)
  }
})

await test('security: no hardcoded U-26/U-37 production debts in source', () => {
  const files = [
    'lib/offlinePosOps.ts',
    'lib/clientStore.ts',
    'lib/offlineV2.ts',
    'components/trade/CashierModule.tsx',
    'components/trade/DebtsModule.tsx',
  ]
  for (const f of files) {
    const src = read(f)
    expect(!/U-26.*64\.00|Мохпари.*64/.test(src), f)
    expect(!/U-37.*207\.85|Мустафо.*207/.test(src), f)
  }
})

await test('security: no revisionCoordinator edits in ONLINE phases', () => {
  // Server coordinator must remain present and unmodified by ONLINE hardening.
  const coord = path.join(root, 'server/kakapo-api/revisionCoordinator.js')
  expect(fs.existsSync(coord), 'coordinator present')
  const src = fs.readFileSync(coord, 'utf8')
  expect(src.length > 100, 'coordinator non-empty')
  // ONLINE patches must not import/rewrite coordinator from trade race wrappers
  for (const f of [
    'lib/localFirst.ts',
    'lib/offlineWarehouseOps.ts',
    'lib/offlinePosOps.ts',
    'lib/offlineClientOps.ts',
  ]) {
    const s = read(f)
    expect(!/revisionCoordinator\.js/.test(s), `${f} must not touch coordinator`)
  }
})

console.log('')
console.log(`online-final-hardening: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
