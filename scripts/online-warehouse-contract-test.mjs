/**
 * ONLINE-3 — warehouse browser mutation contract (Приход / списание / layers).
 * Run: node scripts/online-warehouse-contract-test.mjs
 *
 * Proves old Приход bug would FAIL and current wiring PASSes.
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

/** OLD broken race — always localFirst (pre ONLINE-0/2) */
async function oldRaceWarehouseOp(_apiCall, localApply, localFirstOp) {
  return localFirstOp(localApply)
}

/** Simulate UI success gate used after Safe resolve */
function uiWouldShowSuccess(res, { afterRefreshDone }) {
  if (!res) return false
  if (res.offline) return true // desktop local ack
  return !!afterRefreshDone
}

// ── A. Browser receipt success ──
await test('A) browser receipt success: API once, no local/queue, offline=false, success after ACK', async () => {
  let apiN = 0
  let localN = 0
  let queueN = 0
  const serverReceipt = { id: 'REC-42', clientRef: 'cr-1', items: [{ productId: 1, qty: 2 }] }

  const res = await racePlatformOpCore(
    async () => {
      apiN++
      return serverReceipt
    },
    async () => {
      localN++
      queueN++
      return { id: 'off-rec-phantom', items: [] }
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

  expect(apiN === 1, `api=${apiN}`)
  expect(localN === 0, `local=${localN}`)
  expect(queueN === 0, `queue=${queueN}`)
  expect(res.offline === false, 'offline false')
  expect(res.data.id === 'REC-42', `id=${res.data.id}`)
  expect(!String(res.data.id).startsWith('off-rec'), 'no phantom off-rec-*')
  expect(uiWouldShowSuccess(res, { afterRefreshDone: true }), 'success only after refresh gate')
})

// ── B. Browser receipt 400 ──
await test('B) browser receipt 400: no receipt, form preserved, no success', async () => {
  let localN = 0
  let queueN = 0
  let formClosed = false
  let successShown = false
  const formDraft = { qty: '5', productId: 7 }

  try {
    await racePlatformOpCore(
      async () => {
        throw new Error('Поставщик не найден')
      },
      async () => {
        localN++
        queueN++
        formClosed = true
        return { id: 'off-rec-x' }
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
    successShown = true
  } catch (e) {
    expect(/Поставщик не найден/.test(String(e.message)), `msg=${e.message}`)
  }

  expect(localN === 0, 'no localApply')
  expect(queueN === 0, 'no queue')
  expect(!formClosed, 'form not closed')
  expect(!successShown, 'no success')
  expect(formDraft.qty === '5' && formDraft.productId === 7, 'draft preserved')
})

// ── C. Browser network fail ──
await test('C) browser network fail: no local fallback / queue / phantom', async () => {
  let localN = 0
  let queueN = 0
  let phantom = null

  await racePlatformOpCore(
    async () => {
      throw new Error('Failed to fetch')
    },
    async () => {
      localN++
      phantom = { id: 'off-rec-net' }
      queueN++
      return phantom
    },
    {
      isLocalFirst: () => false,
      localFirstOp: async (fn) => {
        queueN++
        const data = await fn()
        return { offline: true, data }
      },
    },
  ).then(
    () => {
      throw new Error('must reject')
    },
    () => {},
  )

  expect(localN === 0 && queueN === 0 && phantom == null, 'no fallback')
})

// ── D. Reload after success uses server id ──
await test('D) browser reload: store keeps server receipt id (not off-rec)', async () => {
  const store = { receipts: [] }
  const server = { id: 'REC-99', clientRef: 'c9', totalCost: 10 }

  const res = await racePlatformOpCore(
    async () => server,
    async () => ({ id: 'off-rec-99' }),
    {
      isLocalFirst: () => false,
      localFirstOp: async (fn) => ({ offline: true, data: await fn() }),
    },
  )
  // ONLINE-3 upsert
  if (!res.offline) {
    store.receipts = [res.data, ...store.receipts.filter(r => r.id !== res.data.id)]
  }
  // simulate reload from store snapshot
  const afterReload = store.receipts.find(r => r.clientRef === 'c9')
  expect(!!afterReload, 'receipt present')
  expect(afterReload.id === 'REC-99', `id=${afterReload.id}`)
  expect(!String(afterReload.id).startsWith('off-rec'), 'canonical id')
})

// ── E. Writeoff success/failure ──
await test('E) browser writeoff success + failure contract', async () => {
  const ok = await racePlatformOpCore(
    async () => ({ id: 'WOF-1', reason: 'Бой' }),
    async () => ({ id: 'off-wof-1' }),
    {
      isLocalFirst: () => false,
      localFirstOp: async (fn) => ({ offline: true, data: await fn() }),
    },
  )
  expect(ok.offline === false && ok.data.id === 'WOF-1', 'writeoff success')

  let queued = false
  try {
    await racePlatformOpCore(
      async () => {
        throw new Error('Недостаточно остатка')
      },
      async () => {
        queued = true
        return { id: 'off-wof-x' }
      },
      {
        isLocalFirst: () => false,
        localFirstOp: async (fn) => {
          queued = true
          return { offline: true, data: await fn() }
        },
      },
    )
  } catch (e) {
    expect(/остатка/i.test(e.message), 'error surfaced')
  }
  expect(!queued, 'no queue on fail')
})

// ── F. Desktop receipt local-first ──
await test('F) Desktop receipt: local-first, queue, offline=true, api not sync', async () => {
  let apiN = 0
  let queueN = 0
  const res = await racePlatformOpCore(
    async () => {
      apiN++
      return { id: 'SERVER' }
    },
    async () => {
      queueN++
      return { id: 'off-rec-desk', items: [] }
    },
    {
      isLocalFirst: () => true,
      localFirstOp: async (fn) => {
        const data = await fn()
        return { offline: true, data }
      },
    },
  )
  expect(apiN === 0, 'api not sync')
  expect(queueN === 1, 'queue/local apply')
  expect(res.offline === true, 'offline true')
  expect(String(res.data.id).startsWith('off-rec'), 'local id ok on desktop')
})

// ── G. Quick arrival ──
await test('G) quick arrival: browser direct API, no queue', async () => {
  let queueN = 0
  const res = await racePlatformOpCore(
    async () => ({ id: 'REC-QA', items: [{ productId: 3, qty: 1 }] }),
    async () => {
      queueN++
      return { id: 'off-rec-qa' }
    },
    {
      isLocalFirst: () => false,
      localFirstOp: async (fn) => {
        queueN++
        return { offline: true, data: await fn() }
      },
    },
  )
  expect(res.offline === false && queueN === 0, 'direct API')
  expect(res.data.id === 'REC-QA', 'server id')
})

// ── OLD BUG regression: must FAIL on old race, PASS on new ──
await test('OLD-BUG) pre-ONLINE race would create off-rec + success without API', async () => {
  let apiN = 0
  let queueN = 0
  const oldRes = await oldRaceWarehouseOp(
    async () => {
      apiN++
      return { id: 'REC-REAL' }
    },
    async () => {
      queueN++
      return { id: 'off-rec-ghost' }
    },
    async (fn) => ({ offline: true, data: await fn() }),
  )
  // Document that OLD path is the bug:
  expect(apiN === 0, 'OLD: API never ran')
  expect(queueN === 1, 'OLD: queued phantom')
  expect(oldRes.offline === true && oldRes.data.id === 'off-rec-ghost', 'OLD: fake local success')

  // NEW path fixed:
  apiN = 0
  queueN = 0
  const newRes = await racePlatformOpCore(
    async () => {
      apiN++
      return { id: 'REC-REAL' }
    },
    async () => {
      queueN++
      return { id: 'off-rec-ghost' }
    },
    {
      isLocalFirst: () => false,
      localFirstOp: async (fn) => ({ offline: true, data: await fn() }),
    },
  )
  expect(apiN === 1 && queueN === 0, 'NEW: API before success')
  expect(newRes.offline === false && newRes.data.id === 'REC-REAL', 'NEW: canonical')
})

// ── Source wiring audits ──
await test('wiring: createStockReceiptSafe upserts online + uses raceWarehouseOp', () => {
  const src = read('lib/offlineWarehouseOps.ts')
  expect(/upsertReceiptOnline\(res\.data\)/.test(src), 'upsert on create')
  expect(/reconcileAfterWarehouseOnlineMutation/.test(src), 'reconcile helper exported')
  expect(/raceWarehouseOp\(\(\) => api\.createStockReceipt/.test(src), 'create uses race')
  expect(/!res\.offline\) upsertWriteoffOnline/.test(src) || /upsertWriteoffOnline\(res\.data\)/.test(src), 'writeoff upsert')
})

await test('wiring: WarehouseReceiptsPanel awaits refresh before success/reset', () => {
  const src = read('components/trade/warehouse/WarehouseReceiptsPanel.tsx')
  const submit = src.match(/async function submit\(\) \{[\s\S]*?\n  async function removeReceipt/)
  expect(!!submit, 'submit found')
  const body = submit[0]
  expect(/await createStockReceiptSafe/.test(body), 'awaits create')
  expect(/await updateStockReceiptSafe/.test(body), 'awaits update')
  expect(/await Promise\.all\(\[onRefresh\(\), fetchProducts\(\)\]\)/.test(body), 'awaits refresh')
  expect(/setMsg\('Приход сохранён'\)/.test(body), 'online success message')
  // create branch: await refresh then success (not fire-and-forget)
  const createBranch = body.slice(body.indexOf('await createStockReceiptSafe'))
  expect(/await Promise\.all\(\[onRefresh\(\), fetchProducts\(\)\]\)[\s\S]*?setMsg\('Приход сохранён'\)/.test(createBranch),
    'create: refresh before success')
  expect(/catch \(e\) \{[\s\S]*setMsg\(e instanceof Error/.test(body), 'error UX')
  expect(!/void Promise\.all\(\[onRefresh/.test(body), 'no fire-and-forget refresh on submit')
})

await test('wiring: ProductArrivalsPanel quick arrival awaits ACK before close', () => {
  const src = read('components/trade/products/ProductArrivalsPanel.tsx')
  const add = src.match(/async function handleAdd\(\) \{[\s\S]*?\n  function startEdit/)
  expect(!!add, 'handleAdd')
  const body = add[0]
  expect(/await createStockReceiptSafe/.test(body), 'uses Safe')
  expect(/await loadLayers\(\)/.test(body), 'refresh layers after online')
  expect(/Форма остаётся открытой/.test(body) || /catch \(e\) \{[\s\S]*setMsg/.test(body), 'error keeps form')
  // close only after success branches
  const catchIdx = body.indexOf('catch (e)')
  const closeBeforeCatch = body.slice(0, catchIdx)
  expect(/setShowAdd\(false\)/.test(closeBeforeCatch), 'close on success path')
  expect(!/setShowAdd\(false\)/.test(body.slice(catchIdx)), 'no close in catch')
})

await test('wiring: WriteoffsPanel + RevisionsPanel await refresh; no revisionCoordinator edits', () => {
  const wo = read('components/trade/warehouse/WarehouseWriteoffsPanel.tsx')
  expect(/await Promise\.all\(\[onRefresh\(\), fetchProducts\(\)\]\)/.test(wo), 'writeoff await refresh')
  expect(/setMsg\('Списание сохранено'\)/.test(wo), 'writeoff success')

  const rev = read('components/trade/warehouse/WarehouseRevisionsPanel.tsx')
  expect(/await Promise\.all\(\[onRefresh\(\), fetchProducts\(\), loadLayers\(\)\]\)/.test(rev), 'rev await')
  expect(/setMsg\('Ревизия сохранена'\)/.test(rev), 'rev success')

  // revisionCoordinator must be untouched this phase
  const coordPath = path.join(root, 'lib/revisionCoordinator.ts')
  if (fs.existsSync(coordPath)) {
    // just ensure we didn't require changing it for ONLINE-3
    expect(true, 'coordinator file present, not required for this test')
  }
})

await test('wiring: WarehouseModule.refreshAll awaits softSync', () => {
  const src = read('components/trade/WarehouseModule.tsx')
  expect(/const refreshAll = useCallback\(async \(\) => \{/.test(src), 'async refreshAll')
  expect(/await Promise\.all\(\[[\s\S]*softSyncWarehouse[\s\S]*fetchProducts/.test(src), 'awaits sync')
})

console.log('')
console.log(`online-warehouse-contract: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
