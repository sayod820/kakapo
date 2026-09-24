/**
 * ONLINE-O3C — stock concurrency, crash matrix, lifecycle (real PG + API).
 */
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  ensureSchema,
  closePool,
  withClient,
  isPostgresEnabled,
} from '../server/kakapo-api/pg/client.js'
import { opRefDocId, SALE_OP_KIND } from '../server/kakapo-api/pg/businessMutationTx.js'
import {
  cleanupOnlineTestPrefixes,
  assertStockFixtureBaselineClean,
  bootstrapTestLabCashVault,
} from './online-test-db-cleanup.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const PREFIX = 'O3C-'

const REQUIRE = String(process.env.O3C_REAL_PG_REQUIRED || process.env.O8_REAL_PG_REQUIRED || '') === '1'
const REAL_PG = isPostgresEnabled()

let passed = 0
let failed = 0
const fixtureProductIds = []

function expect(cond, msg) {
  if (cond) { passed += 1; console.log(`  OK  ${msg}`) }
  else { failed += 1; console.error(`  FAIL ${msg}`) }
}

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchJson(url, init) {
  const res = await fetch(url, init)
  let body = null
  try { body = await res.json() } catch { body = null }
  return { ok: res.ok, status: res.status, body }
}

async function waitHealth(base, ms = 45000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetchJson(`${base}/health`)
      if (r.ok && r.body?.ok) return true
    } catch { /* retry */ }
    await sleep(250)
  }
  return false
}

function startApi(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['index.js'], {
      cwd: path.join(root, 'server/kakapo-api'),
      env: { ...process.env, PORT: String(port), KAKAPO_O8_TEST_API: '1', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr?.on('data', (d) => { stderr += String(d) })
    const base = `http://127.0.0.1:${port}`
    waitHealth(base).then((up) => {
      if (!up) {
        try { child.kill('SIGKILL') } catch { /* ignore */ }
        reject(new Error(`API failed: ${stderr.slice(-800)}`))
        return
      }
      resolve({ child, base })
    })
  })
}

function killApi(child) {
  try { child.kill('SIGKILL') } catch { /* ignore */ }
}

async function layerSum(base, productId, opts = {}) {
  const recs = await fetchJson(`${base}/stock/receipts`)
  const onlyRefs = opts.clientRefs ? new Set(opts.clientRefs) : null
  let s = 0
  for (const r of recs.body || []) {
    if (onlyRefs && !onlyRefs.has(String(r.clientRef || ''))) continue
    for (const it of r.items || []) {
      if (Number(it.productId) !== Number(productId)) continue
      const rem = Number(it.remainingQty) || 0
      if (rem < -0.0001) return { sum: NaN, badLayer: true }
      s += rem
    }
  }
  return { sum: round2(s), badLayer: false }
}

async function apiStock(base, productId) {
  const all = await fetchJson(`${base}/products`)
  const row = (all.body || []).find(p => Number(p.id) === Number(productId))
  return round2(row?.stock)
}

async function pgStock(productId) {
  return withClient(async (c) => {
    const r = await c.query(`SELECT data->>'stock' AS s FROM docs WHERE collection='products' AND id=$1`, [String(productId)])
    return round2(Number(r.rows[0]?.s))
  })
}

async function assertLayerTruth(base, productId, label) {
  const st = await apiStock(base, productId)
  const pg = await pgStock(productId)
  const { sum, badLayer } = await layerSum(base, productId)
  expect(!badLayer, `${label} no negative layers`)
  expect(st === sum && pg === sum && st >= 0, `${label} stock/layer API=${st} PG=${pg} layers=${sum}`)
}

async function seed(base) {
  const points = await fetchJson(`${base}/pos/points`)
  const posId = points.body?.[0]?.id
  const ts = Date.now()
  const prod = await fetchJson(`${base}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `${PREFIX}P-${ts}`,
      price: 100,
      costPrice: 50,
      stock: 0,
      clientRef: `${PREFIX}prod-${ts}`,
    }),
  })
  if (!prod.ok) throw new Error(`prod ${prod.status}`)
  fixtureProductIds.push(prod.body.id)
  const openList = await fetchJson(`${base}/pos/shifts?status=open`)
  const existingOpen = (openList.body || []).find(s => String(s.status) === 'open')
  if (existingOpen?.id) {
    return { productId: prod.body.id, shiftId: existingOpen.id, posId: existingOpen.posId || posId }
  }
  const cashiers = await fetchJson(`${base}/cashiers`)
  let cashierId = cashiers.body?.[0]?.id
  if (!cashierId) {
    const c = await fetchJson(`${base}/cashiers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${PREFIX}Cashier`, pin: '0000' }),
    })
    cashierId = c.body?.id
  }
  if (!cashierId) throw new Error('seed: no cashier')
  const shift = await fetchJson(`${base}/pos/shifts/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      posId,
      cashierId,
      cashierName: `${PREFIX}Cashier`,
      openingCash: 1000,
      clientRef: `${PREFIX}shift-${ts}`,
    }),
  })
  if (!shift.ok) {
    throw new Error(`shift ${shift.status} ${shift.body?.detail || JSON.stringify(shift.body)}`)
  }
  return { productId: prod.body.id, shiftId: shift.body.id, posId: shift.body.posId || posId }
}

async function receipt(base, productId, qty, cost, clientRef, createdAtIso) {
  const purchaseTotal = round2(qty * cost)
  return fetchJson(`${base}/stock/receipts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef,
      paidNow: 0,
      createdAtIso,
      items: [{ productId, qty, purchaseTotal, costPrice: cost }],
    }),
  })
}

async function sale(base, fx, qty, clientRef, price = 100) {
  return fetchJson(`${base}/pos/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef,
      shiftId: fx.shiftId,
      posId: fx.posId,
      paymentMethod: 'cash',
      total: round2(qty * price),
      paidCash: round2(qty * price),
      items: [{ productId: fx.productId, qty, price, lineTotal: round2(qty * price) }],
    }),
  })
}

async function writeoff(base, productId, qty, clientRef) {
  return fetchJson(`${base}/stock/writeoffs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientRef,
      reason: `${PREFIX}wo`,
      items: [{ productId, qty }],
    }),
  })
}

async function setChaos(base, point) {
  return fetchJson(`${base}/__o8/chaos/hold-at`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ point }),
  })
}

async function releaseChaos(base) {
  return fetchJson(`${base}/__o8/chaos/release`, { method: 'POST' })
}

async function main() {
  console.log('ONLINE-O3C stock concurrency & closure\n')
  if (!REAL_PG) {
    if (REQUIRE) { failed += 1; console.error('  FAIL PG required') }
    console.log(`\nO3C: ${passed} passed, ${failed} failed`)
    process.exit(failed ? 1 : 0)
  }

  await ensureSchema()
  await cleanupOnlineTestPrefixes()
  await bootstrapTestLabCashVault()
  await assertStockFixtureBaselineClean(PREFIX)
  const port = 18903 + Math.floor(Math.random() * 200)
  let api = await startApi(port)
  const { base } = api

  try {
    // A1 sale + writeoff race stock=5
    const fxA1 = await seed(base)
    await receipt(base, fxA1.productId, 5, 5, `${PREFIX}a1-rec`, '2020-01-01T00:00:00Z')
    const tsA1 = Date.now()
    const [rA1s, rA1w] = await Promise.all([
      sale(base, fxA1, 4, `${PREFIX}a1-sale-${tsA1}`),
      writeoff(base, fxA1.productId, 4, `${PREFIX}a1-wo-${tsA1}`),
    ])
    const winsA1 = [rA1s, rA1w].filter(r => r.ok && !r.body?.replayed).length
    expect(winsA1 <= 1, `A1 at most one commit (${winsA1})`)
    await assertLayerTruth(base, fxA1.productId, 'A1')

    // A2 sale 4 + writeoff 3 on stock 10
    const fxA2 = await seed(base)
    await receipt(base, fxA2.productId, 10, 5, `${PREFIX}a2-rec`, '2020-01-01T00:00:00Z')
    const tsA2 = Date.now()
    const [rA2s, rA2w] = await Promise.all([
      sale(base, fxA2, 4, `${PREFIX}a2-sale-${tsA2}`),
      writeoff(base, fxA2.productId, 3, `${PREFIX}a2-wo-${tsA2}`),
    ])
    expect(rA2s.ok && rA2w.ok, 'A2 both ok')
    expect(round2(await apiStock(base, fxA2.productId)) === 3, 'A2 final stock 3')
    await assertLayerTruth(base, fxA2.productId, 'A2')

    // B1 edit 5 vs sale 6 on receipt 10
    const fxB1 = await seed(base)
    const recB1 = await receipt(base, fxB1.productId, 10, 5, `${PREFIX}b1-rec`, '2020-01-02T00:00:00Z')
    const recB1Id = recB1.body?.id
    const tsB1 = Date.now()
    const [rB1s, rB1e] = await Promise.all([
      sale(base, fxB1, 6, `${PREFIX}b1-sale-${tsB1}`),
      fetchJson(`${base}/stock/receipts/${recB1Id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientRef: `${PREFIX}b1-edit-${tsB1}`,
          paidNow: 0,
          items: [{ productId: fxB1.productId, qty: 5, purchaseTotal: 25, costPrice: 5 }],
        }),
      }),
    ])
    const saleOk = rB1s.ok && !rB1s.body?.replayed
    const editOk = rB1e.ok && !rB1e.body?.replayed
    if (saleOk && editOk) {
      expect(false, 'B1 both must not succeed with incompatible qty')
    } else {
      expect(saleOk || editOk || (!rB1s.ok && !rB1e.ok), 'B1 deterministic conflict')
    }
    await assertLayerTruth(base, fxB1.productId, 'B1')

    // B2 sale 3 + edit 12
    const fxB2 = await seed(base)
    const recB2 = await receipt(base, fxB2.productId, 10, 5, `${PREFIX}b2-rec`, '2020-01-02T00:00:00Z')
    const tsB2 = Date.now()
    async function b2Pair() {
      const ts = Date.now()
      return Promise.all([
        sale(base, fxB2, 3, `${PREFIX}b2-sale-${ts}`),
        fetchJson(`${base}/stock/receipts/${recB2.body.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientRef: `${PREFIX}b2-edit-${ts}`,
            paidNow: 0,
            items: [{ productId: fxB2.productId, qty: 12, purchaseTotal: 60, costPrice: 5 }],
          }),
        }),
      ])
    }
    let [rB2s, rB2e] = await b2Pair()
    const deadlocked = (r) => r.body?.code === '40P01' || /взаимоблокировка|deadlock/i.test(String(r.body?.detail || ''))
    if (deadlocked(rB2s) || deadlocked(rB2e)) {
      await sleep(80)
      ;[rB2s, rB2e] = await b2Pair()
    }
    expect(rB2s.ok && rB2e.ok, 'B2 both may succeed')
    await assertLayerTruth(base, fxB2.productId, 'B2')

    // C delete vs sale
    const fxC = await seed(base)
    const recC = await receipt(base, fxC.productId, 10, 5, `${PREFIX}c-rec`, '2020-01-03T00:00:00Z')
    const tsC = Date.now()
    const [rCs, rCd] = await Promise.all([
      sale(base, fxC, 4, `${PREFIX}c-sale-${tsC}`),
      fetchJson(`${base}/stock/receipts/${recC.body.id}?clientRef=${PREFIX}c-del-${tsC}`, { method: 'DELETE' }),
    ])
    const saleCommitted = rCs.ok && !rCs.body?.replayed
    const delCommitted = rCd.ok && !rCd.body?.replayed
    expect(!(saleCommitted && delCommitted), 'C not both delete and sale success')
    await assertLayerTruth(base, fxC.productId, 'C')

    // D return vs writeoff
    const fxD = await seed(base)
    await receipt(base, fxD.productId, 10, 5, `${PREFIX}d-rec`, '2020-01-04T00:00:00Z')
    const sd = await sale(base, fxD, 5, `${PREFIX}d-sale`)
    expect(sd.ok, 'D seed sale')
    const saleId = sd.body?.id
    const tsD = Date.now()
    const [rDr, rDw] = await Promise.all([
      fetchJson(`${base}/pos/sales/${saleId}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientRef: `${PREFIX}d-ret-${tsD}`,
          items: [{ productId: fxD.productId, qty: 3 }],
        }),
      }),
      writeoff(base, fxD.productId, 4, `${PREFIX}d-wo-${tsD}`),
    ])
    expect(rDr.ok || rDw.ok, 'D at least one op ok')
    await assertLayerTruth(base, fxD.productId, 'D')

    // E crash matrix (cash sale)
    const fxE = await seed(base)
    await receipt(base, fxE.productId, 20, 5, `${PREFIX}e-rec`, '2020-01-05T00:00:00Z')
    const preRef = `${PREFIX}e-pre`
    await releaseChaos(api.base)
    await setChaos(api.base, 'before_commit')
    const preP = sale(api.base, fxE, 2, preRef).catch(() => ({ ok: false }))
    await sleep(1000)
    killApi(api.child)
    await preP
    const preOp = await withClient(async (c) => {
      const q = await c.query('SELECT COUNT(*)::int AS n FROM docs WHERE id=$1', [opRefDocId(SALE_OP_KIND, preRef)])
      return q.rows[0]?.n || 0
    })
    expect(preOp === 0, 'E precommit opRef 0')
    api = await startApi(port)
    expect(round2(await apiStock(api.base, fxE.productId)) === 20, 'E precommit no stock effect')
    await releaseChaos(api.base)

    const postRef = `${PREFIX}e-post`
    await setChaos(api.base, 'after_commit_before_response')
    const postP = sale(api.base, fxE, 2, postRef)
    await sleep(1200)
    killApi(api.child)
    const postR = await postP.catch(() => ({ ok: false, body: null }))
    await sleep(400)
    const postOp = await withClient(async (c) => {
      const q = await c.query('SELECT COUNT(*)::int AS n FROM docs WHERE id=$1', [opRefDocId(SALE_OP_KIND, postRef)])
      return q.rows[0]?.n || 0
    })
    expect(postOp >= 1, 'E postcommit opRef durable')
    api = await startApi(port)
    const postReplay = await sale(api.base, fxE, 2, postRef)
    expect(postReplay.body?.replayed, 'E postcommit replay')
    expect(round2(await apiStock(api.base, fxE.productId)) === 18, 'E stock after one sale of 2')
    await releaseChaos(api.base)

    // G full lifecycle — fresh API + PG cleanup (orphan layers on recycled product ids)
    killApi(api.child)
    await cleanupOnlineTestPrefixes([PREFIX])
    api = await startApi(port)
    const gBase = api.base
    fixtureProductIds.length = 0
    const fxG = await seed(gBase)
    const pid = fxG.productId
    const gRefA = `${PREFIX}g-rec-a`
    const gRefB = `${PREFIX}g-rec-b`
    const gRefs = [gRefA, gRefB]
    const gRecA = await receipt(gBase, pid, 10, 5, gRefA, '2020-01-01T00:00:00.000Z')
    expect(gRecA.ok, 'G receipt A')
    expect(round2(gRecA.body?.items?.[0]?.costPrice) === 5, 'G receipt A cost 5')
    expect(round2(gRecA.body?.items?.[0]?.qty) === 10, 'G receipt A qty 10')
    const gRecB = await receipt(gBase, pid, 10, 7, gRefB, '2020-01-02T00:00:00.000Z')
    expect(gRecB.ok, 'G receipt B')
    expect(round2(gRecB.body?.items?.[0]?.costPrice) === 7, `G receipt B cost 7 (${gRecB.body?.items?.[0]?.costPrice})`)
    expect(round2(gRecB.body?.items?.[0]?.qty) === 10, 'G receipt B qty 10')
    expect(round2((await layerSum(gBase, pid, { clientRefs: gRefs })).sum) === 20, 'G seed stock 20 layers')
    const recList = await fetchJson(`${gBase}/stock/receipts`)
    let fifoLeft = 12
    let fifoCogs = 0
    const gRecs = (recList.body || [])
      .filter(r => gRefs.includes(String(r.clientRef || '')))
      .sort((a, b) => String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || '')))
    for (const r of gRecs) {
      for (const it of r.items || []) {
        if (Number(it.productId) !== Number(pid)) continue
        const rem = round2(it.remainingQty)
        if (!(rem > 0) || !(fifoLeft > 0)) continue
        const take = Math.min(rem, fifoLeft)
        fifoCogs = round2(fifoCogs + take * round2(it.costPrice))
        fifoLeft = round2(fifoLeft - take)
      }
    }
    expect(fifoLeft === 0, 'G seed layers cover sale 12')
    expect(fifoCogs === 64, `G expected FIFO COGS 64 (${fifoCogs})`)
    const sg = await sale(gBase, fxG, 12, `${PREFIX}g-sale1`)
    const cogs = round2((sg.body?.items || [])[0]?.lineCost)
    expect(cogs === fifoCogs, `G sale COGS matches FIFO (${cogs} vs ${fifoCogs})`)
    await assertLayerTruth(gBase, pid, 'G after sale 12')
    expect(round2((await layerSum(gBase, pid, { clientRefs: gRefs })).sum) === 8, 'G layers after sale 12')
    await writeoff(gBase, pid, 2, `${PREFIX}g-wo`)
    await assertLayerTruth(gBase, pid, 'G after writeoff 2')
    expect(round2((await layerSum(gBase, pid, { clientRefs: gRefs })).sum) === 6, 'G layers after writeoff')
    await fetchJson(`${gBase}/pos/sales/${sg.body.id}/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRef: `${PREFIX}g-ret`,
        items: [{ productId: pid, qty: 3 }],
      }),
    })
    await fetchJson(`${gBase}/stock/adjustments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientRef: `${PREFIX}g-adj`,
        productId: pid,
        targetQty: 10,
        reason: `${PREFIX}adj`,
      }),
    })
    await sale(gBase, fxG, 2, `${PREFIX}g-sale2`)
    expect(round2(await apiStock(gBase, pid)) === 8, 'G final stock 8')
    await assertLayerTruth(gBase, pid, 'G lifecycle')

    // J invariant sweep (G fixture only after isolated restart)
    for (const id of fixtureProductIds) {
      await assertLayerTruth(gBase, id, `sweep ${id}`)
    }
  } finally {
    killApi(api.child)
    await cleanupOnlineTestPrefixes([PREFIX])
    await closePool()
  }

  console.log(`\nO3C: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
