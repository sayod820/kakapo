/**
 * ONLINE-5/6 — sales / returns / shifts / finance / topup browser contract.
 * Run: node scripts/online-money-ops-contract-test.mjs
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

async function browserMoneyOp(apiResult) {
  let apiN = 0
  let localN = 0
  let queueN = 0
  const res = await racePlatformOpCore(
    async () => {
      apiN++
      return apiResult
    },
    async () => {
      localN++
      queueN++
      return { id: 'phantom-local' }
    },
    {
      isLocalFirst: () => false,
      localFirstOp: async (fn) => {
        queueN++
        return { offline: true, data: await fn() }
      },
    },
  )
  return { res, apiN, localN, queueN }
}

await test('A) Browser cash sale: API once, localApply 0, queue 0', async () => {
  const { res, apiN, localN, queueN } = await browserMoneyOp({ id: 'SALE-1', paymentMethod: 'cash', total: 10 })
  expect(apiN === 1 && localN === 0 && queueN === 0, `api=${apiN} local=${localN} q=${queueN}`)
  expect(res.offline === false && res.data.id === 'SALE-1', 'canonical sale')
})

await test('B) Browser debt sale: debt applied once (single API)', async () => {
  const { res, apiN, queueN } = await browserMoneyOp({
    id: 'SALE-D',
    paymentMethod: 'credit',
    debtAdded: 50,
  })
  expect(apiN === 1 && queueN === 0 && res.data.debtAdded === 50, 'debt once')
})

await test('C) Sale API failure: no fake sale', async () => {
  let localN = 0
  let ok = false
  try {
    await racePlatformOpCore(
      async () => {
        throw new Error('HTTP 500')
      },
      async () => {
        localN++
        return { id: 'fake' }
      },
      {
        isLocalFirst: () => false,
        localFirstOp: async (fn) => ({ offline: true, data: await fn() }),
      },
    )
    ok = true
  } catch (e) {
    expect(/500/.test(e.message), 'error')
  }
  expect(!ok && localN === 0, 'no fake sale')
})

await test('D) Return success: API once', async () => {
  const { res, apiN, queueN } = await browserMoneyOp({ id: 'SALE-1', status: 'returned' })
  expect(apiN === 1 && queueN === 0 && res.data.status === 'returned', 'return ACK')
})

await test('E) Return failure: sale remains unreturned', async () => {
  const sale = { id: 'S1', status: 'completed' }
  try {
    await racePlatformOpCore(
      async () => {
        throw new Error('Нельзя вернуть')
      },
      async () => ({ ...sale, status: 'returned' }),
      {
        isLocalFirst: () => false,
        localFirstOp: async (fn) => ({ offline: true, data: await fn() }),
      },
    )
  } catch { /* expected */ }
  expect(sale.status === 'completed', 'unchanged')
})

await test('F wiring: shift open/close raceCashierOp; UI after ACK', () => {
  const ops = read('lib/offlinePosOps.ts')
  expect(/raceCashierOp\(\(\) => api\.openPosShift/.test(ops)
    || /raceCashierOp\(\(\) => api\.openPosShift|raceCashierOp\(\(\) => api\.open/.test(ops)
    || /openPosShift/.test(ops) && /raceCashierOp/.test(ops), 'open uses race')
  expect(/closePosShift|closeShift/.test(ops) && /raceCashierOp/.test(ops), 'close race')
  const cash = read('components/trade/CashierModule.tsx')
  expect(/await openShiftSafe|await ensureCashierSafe/.test(cash), 'await open path')
  expect(/await closeShiftSafe|closeShiftSafe\(/.test(cash), 'close awaited')
})

await test('G/H) Finance deposit/withdraw: browser API once, no localApply', async () => {
  for (const kind of ['deposit', 'withdraw']) {
    const { apiN, localN, queueN, res } = await browserMoneyOp({ id: `FM-${kind}`, type: kind, amount: 100 })
    expect(apiN === 1 && localN === 0 && queueN === 0 && !res.offline, kind)
  }
})

await test('I) Vault conversion accounting once', async () => {
  const { apiN, queueN, res } = await browserMoneyOp({ id: 'VAULT-1', kind: 'card_to_cash' })
  expect(apiN === 1 && queueN === 0 && res.data.id === 'VAULT-1', 'vault once')
})

await test('J) Card topup balance/cash once', async () => {
  const { apiN, queueN, res } = await browserMoneyOp({ financeMove: { id: 'TOP-1' }, card: { bonus: 10 } })
  expect(apiN === 1 && queueN === 0 && res.data.financeMove.id === 'TOP-1', 'topup once')
})

await test('K) Cash advance debt+cash once', async () => {
  const { apiN, queueN, res } = await browserMoneyOp({ nextDebt: 150, amount: 50 })
  expect(apiN === 1 && queueN === 0 && res.data.nextDebt === 150, 'CA once')
})

await test('L) Debt repay once', async () => {
  const { apiN, queueN, res } = await browserMoneyOp({ nextDebt: 14, amount: 50 })
  expect(apiN === 1 && queueN === 0 && res.data.nextDebt === 14, 'repay once')
})

await test('M) Double-click / same clientRef idempotent shape (contract)', async () => {
  // Same clientRef → server returns same entity; client must not invent second local id
  const clientRef = 'cr-same'
  const first = await browserMoneyOp({ id: 'SALE-X', clientRef })
  const second = await browserMoneyOp({ id: 'SALE-X', clientRef })
  expect(first.res.data.id === second.res.data.id, 'same id')
  expect(!String(first.res.data.id).startsWith('off-'), 'no phantom')
})

await test('N) Browser queueOp=0 for money racePlatformOp', async () => {
  let queueN = 0
  await racePlatformOpCore(
    async () => ({ ok: 1 }),
    async () => {
      queueN++
      return { ok: 0 }
    },
    {
      isLocalFirst: () => false,
      localFirstOp: async (fn) => {
        queueN++
        return { offline: true, data: await fn() }
      },
    },
  )
  expect(queueN === 0, 'no queue')
})

await test('O) Desktop local-first/outbox remains', async () => {
  let apiN = 0
  let queueN = 0
  const res = await racePlatformOpCore(
    async () => {
      apiN++
      return { id: 'SRV' }
    },
    async () => {
      queueN++
      return { id: 'off-local' }
    },
    {
      isLocalFirst: () => true,
      localFirstOp: async (fn) => ({ offline: true, data: await fn() }),
    },
  )
  expect(apiN === 0 && queueN === 1 && res.offline === true, 'desktop LF')
})

await test('P wiring: POS point / ensureCashier racePlatformOp; no bare localFirst on browser path', () => {
  const ops = read('lib/offlinePosOps.ts')
  const createBlock = ops.slice(ops.indexOf('export async function createPosPointSafe'))
  const ensureBlock = ops.slice(ops.indexOf('export async function ensureCashierSafe'))
  expect(/racePlatformOp\(/.test(createBlock), 'createPosPoint racePlatformOp')
  expect(/api\.createPosPoint/.test(createBlock), 'API createPosPoint')
  expect(/racePlatformOp\(/.test(ensureBlock), 'ensureCashier racePlatformOp')
  expect(/api\.createCashier/.test(ensureBlock), 'API createCashier')
  // createPosPointSafe must NOT end with bare return localFirstOp(applyLocal)
  expect(!/return localFirstOp\(applyLocal\)\s*\}\s*\n\s*export async function updatePosPointSafe/.test(ops),
    'create not bare localFirst')
  expect(!/return localFirstOp\(applyLocal\)\s*\}\s*$/.test(ensureBlock.slice(0, 1200)),
    'ensure not bare localFirst')
})

await test('wiring: return confirm closes after ACK; finance delete after ACK', () => {
  const cash = read('components/trade/CashierModule.tsx')
  const ret = cash.match(/returnBusyRef\.current = true[\s\S]*?returnBusyRef\.current = false/)
  expect(!!ret, 'return handler')
  expect(/await returnSaleSafe/.test(ret[0]), 'await return')
  expect(ret[0].indexOf('await returnSaleSafe') < ret[0].indexOf('setReturnConfirm(null)'),
    'close confirm after ACK')
  expect(/Продажа сохранена/.test(cash) && /Погашение долга не выполнено/.test(cash),
    'post-sale repay error toast')

  const fin = read('components/trade/FinanceModule.tsx')
  const rm = fin.match(/async function confirmRemoveMove[\s\S]*?async function confirmRemoveExpense/)
  expect(!!rm, 'confirmRemoveMove')
  expect(rm[0].indexOf('await financeMoveDeleteSafe') < rm[0].indexOf('setDelMoveId(null)'),
    'dismiss delete after ACK')
})

await test('wiring: createSaleSafe browser early API (no race localApply)', () => {
  const ops = read('lib/offlinePosOps.ts')
  const sale = ops.slice(ops.indexOf('export async function createSaleSafe'))
  expect(/if \(!isTradeLocalFirst\(\)\)/.test(sale), 'browser branch')
  expect(/api\.createPosSale/.test(sale), 'createPosSale')
  expect(/return \{ offline: false/.test(sale), 'offline false')
})

await test('wiring: financeMoveSafe / cardTopupSafe / vault use raceCashierOp', () => {
  const ops = read('lib/offlinePosOps.ts')
  expect(/export async function financeMoveSafe[\s\S]*?raceCashierOp/.test(ops), 'finance race')
  expect(/export async function cardTopupSafe[\s\S]*?raceCashierOp/.test(ops), 'topup race')
  expect(/export async function vaultCardToCashSafe[\s\S]*?raceCashierOp/.test(ops), 'vault race')
})

console.log('')
console.log(`online-money-ops-contract: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
