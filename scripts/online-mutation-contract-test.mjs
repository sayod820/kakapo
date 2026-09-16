/**
 * ONLINE-0 — browser vs Desktop mutation contract.
 * Run: node scripts/online-mutation-contract-test.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
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

// ── TEST A — browser success ──
await test('A) browser success: api once, localApply 0, queueOp 0, offline=false', async () => {
  let apiN = 0
  let localN = 0
  let queueN = 0
  const canonical = { id: 'R1', total: 64 }

  const result = await racePlatformOpCore(
    async () => {
      apiN++
      return canonical
    },
    async () => {
      localN++
      queueN++
      return { id: 'LOCAL', total: 0 }
    },
    {
      isLocalFirst: () => false,
      localFirstOp: async (fn) => {
        queueN++
        const data = await fn()
        return { offline: true, data }
      },
    },
  )

  expect(apiN === 1, `apiCall=${apiN}`)
  expect(localN === 0, `localApply=${localN}`)
  expect(queueN === 0, `queueOp=${queueN}`)
  expect(result.offline === false, `offline=${result.offline}`)
  expect(result.data === canonical, 'canonical API result')
})

// ── TEST B — browser API failure ──
await test('B) browser API failure: no localApply/queue, error propagates', async () => {
  let localN = 0
  let queueN = 0
  let threw = false

  try {
    await racePlatformOpCore(
      async () => {
        throw new Error('HTTP 500')
      },
      async () => {
        localN++
        queueN++
        return { ok: true }
      },
      {
        isLocalFirst: () => false,
        localFirstOp: async (fn) => {
          queueN++
          const data = await fn()
          return { offline: true, data }
        },
      },
    )
  } catch (e) {
    threw = true
    expect(String(e.message) === 'HTTP 500', `msg=${e.message}`)
  }

  expect(threw, 'error must propagate')
  expect(localN === 0, `localApply=${localN}`)
  expect(queueN === 0, `queueOp=${queueN}`)
})

// ── TEST C — Desktop/Android local-first ──
await test('C) Desktop: localApply, api not sync, offline=true', async () => {
  let apiN = 0
  let localN = 0

  const result = await racePlatformOpCore(
    async () => {
      apiN++
      return { id: 'SERVER' }
    },
    async () => {
      localN++
      return { id: 'LOCAL' }
    },
    {
      isLocalFirst: () => true,
      localFirstOp: async (fn) => {
        const data = await fn()
        return { offline: true, data }
      },
    },
  )

  expect(localN === 1, `localApply=${localN}`)
  expect(apiN === 0, `apiCall=${apiN} (must not run sync)`)
  expect(result.offline === true, `offline=${result.offline}`)
  expect(result.data.id === 'LOCAL', `data=${result.data.id}`)
})

// ── TEST D — no browser fallback to localFirstOp ──
await test('D) API failure NEVER causes localFirstOp', async () => {
  let localFirstOpN = 0
  let localApplyN = 0

  await racePlatformOpCore(
    async () => {
      throw Object.assign(new Error('network'), { status: 0 })
    },
    async () => {
      localApplyN++
      return {}
    },
    {
      isLocalFirst: () => false,
      localFirstOp: async (fn) => {
        localFirstOpN++
        const data = await fn()
        return { offline: true, data }
      },
    },
  ).then(
    () => {
      throw new Error('must not resolve')
    },
    () => {},
  )

  expect(localFirstOpN === 0, `localFirstOp=${localFirstOpN}`)
  expect(localApplyN === 0, `localApply=${localApplyN}`)
})

// ── Wiring audit ──
await test('wiring: localFirst exports racePlatformOp via core', () => {
  const src = read('lib/localFirst.ts')
  expect(/racePlatformOpCore/.test(src), 'imports core')
  expect(/export async function racePlatformOp/.test(src), 'exports racePlatformOp')
  expect(/isTradeLocalFirst/.test(src), 'uses isTradeLocalFirst')
})

await test('wiring: raceWarehouseOp → racePlatformOp (apiCall not ignored)', () => {
  const src = read('lib/offlineWarehouseOps.ts')
  expect(/return racePlatformOp\(apiCall, localApply\)/.test(src), 'raceWarehouseOp wired')
  expect(!/return localFirstOp\(localApply\)/.test(src.replace(/cancelStockRevisionSafe[\s\S]*$/, '')),
    'warehouse race path not bare localFirstOp')
  expect(/_apiCall/.test(src) === false || !/async function raceWarehouseOp[\s\S]*?_apiCall/.test(src),
    'raceWarehouseOp must not underscore-ignore apiCall')
})

await test('wiring: raceCashierOp → racePlatformOp', () => {
  const src = read('lib/offlinePosOps.ts')
  expect(/return racePlatformOp\(apiCall, localApply\)/.test(src), 'raceCashierOp wired')
  expect(/async function raceCashierOp[\s\S]*?_apiCall/.test(src) === false, 'apiCall not ignored')
  expect(/returnSaleSafe[\s\S]*?racePlatformOp\(/.test(src), 'returnSaleSafe uses racePlatformOp')
})

await test('wiring: cancelStockRevisionSafe browser has no network localApply fallback', () => {
  const src = read('lib/offlineWarehouseOps.ts')
  const m = src.match(/export async function cancelStockRevisionSafe[\s\S]*?(?=export async function)/)
  expect(!!m, 'found cancelStockRevisionSafe')
  expect(/!isTradeLocalFirst\(\)/.test(m[0]), 'browser branch')
  // After browser branch, network fallback only under local-first try/catch
  const browserBlock = m[0].match(/if \(!isTradeLocalFirst\(\)\) \{[\s\S]*?\n  \}/)
  expect(!!browserBlock, 'browser block present')
  expect(!/applyLocal/.test(browserBlock[0]), 'browser block must not call applyLocal')
})

console.log('')
console.log(`online-mutation-contract: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
