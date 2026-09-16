/**
 * PC-5 — Self-recovering Desktop upgrade tests.
 * REAL_CASHIER_8 + live-like derivative. Mock only. No production.
 *
 *   node scripts/pc5-self-recovering-upgrade-test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = path.join(ROOT, 'scripts', '_diag_out', 'REAL_CASHIER_8', 'kakapo.sqlite')
const QUEUE_CACHE = path.join(ROOT, 'diag', '_pc4b_queue_cache.json')
const SERVER_GET = path.join(ROOT, 'diag', 'REAL_CASHIER_8_server_get.json')
const OUT = path.join(ROOT, 'diag', 'PC5_SELF_RECOVERING_report.json')

const engine = await import(pathToFileURL(path.join(ROOT, 'lib/desktopRecoveryEngineCore.mjs')).href)
const orch = await import(pathToFileURL(path.join(ROOT, 'lib/desktopRecoveryOrchestratorCore.mjs')).href)
const adapter = await import(pathToFileURL(path.join(ROOT, 'lib/recoveryApiAdapterCore.mjs')).href)
const guard = await import(pathToFileURL(path.join(ROOT, 'lib/recoveryProductionGuardCore.mjs')).href)

const results = []
function test(name, fn) {
  try {
    const r = fn()
    if (r && typeof r.then === 'function') throw new Error('use asyncTest')
    results.push({ name, status: 'PASS' })
    console.log(`PASS  ${name}`)
  } catch (e) {
    results.push({ name, status: 'FAIL', error: String(e?.message || e) })
    console.error(`FAIL  ${name}: ${e?.message || e}`)
  }
}
async function asyncTest(name, fn) {
  try {
    await fn()
    results.push({ name, status: 'PASS' })
    console.log(`PASS  ${name}`)
  } catch (e) {
    results.push({ name, status: 'FAIL', error: String(e?.message || e) })
    console.error(`FAIL  ${name}: ${e?.message || e}`)
  }
}
function expect(c, m) { if (!c) throw new Error(m || 'expect failed') }

function jp(v) { try { return JSON.parse(v) } catch { return null } }

function ensureQueueCache() {
  if (fs.existsSync(QUEUE_CACHE) && fs.existsSync(SOURCE)) {
    const st = fs.statSync(QUEUE_CACHE)
    const dbSt = fs.statSync(SOURCE)
    if (st.mtimeMs >= dbSt.mtimeMs - 1000) return jp(fs.readFileSync(QUEUE_CACHE, 'utf8'))
  }
  const electron = path.join(ROOT, 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe')
  const extract = path.join(ROOT, 'diag', '_pc5_extract_queue.mjs')
  fs.writeFileSync(extract, `
    import { createRequire } from 'node:module'
    import fs from 'node:fs'
    const require = createRequire(${JSON.stringify(path.join(ROOT, 'desktop', 'package.json'))})
    const Database = require('better-sqlite3')
    const db = new Database(${JSON.stringify(SOURCE)}, { readonly: true })
    const rows = db.prepare('SELECT client_ref, updated_at, payload FROM queue ORDER BY updated_at ASC').all()
    const out = rows.map(r => {
      const row = JSON.parse(r.payload)
      const nested = row.payload && typeof row.payload === 'object' ? row.payload : {}
      return {
        clientRef: String(row.clientRef || r.client_ref),
        kind: String(row.kind || 'unknown'),
        seq: row.seq,
        localId: row.localId,
        createdAtIso: row.createdAtIso || nested.createdAtIso,
        failed: !!row.failed,
        lastError: row.lastError || '',
        payload: { ...nested, clientRef: nested.clientRef || row.clientRef },
      }
    })
    db.close()
    fs.writeFileSync(${JSON.stringify(QUEUE_CACHE)}, JSON.stringify(out))
    console.log('EXTRACTED', out.length)
  `)
  const r = spawnSync(electron, [extract], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
  })
  if (r.status !== 0) throw new Error('extract failed: ' + (r.stderr || r.stdout))
  return jp(fs.readFileSync(QUEUE_CACHE, 'utf8'))
}

function startMock(opts = {}) {
  const store = { shifts: [], sales: [...(opts.seedSales || [])], layers: [], byRef: new Map(), failModes: { ...(opts.failModes || {}) } }
  for (const s of store.sales) {
    const fp = s.fingerprint || engine.businessPayloadFingerprint('sale', s)
    store.byRef.set(s.clientRef, { kind: 'sale', id: s.id, fingerprint: fp, payload: s, raw: s })
  }
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const chunks = []
    for await (const c of req) chunks.push(c)
    let body = null
    try { body = Buffer.concat(chunks).toString('utf8'); body = body ? JSON.parse(body) : null } catch { body = null }
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
    const ref = body?.clientRef
    const mode = ref && store.failModes[ref]

    if (req.method === 'GET' && url.pathname === '/pos/shifts') return send(200, store.shifts)
    if (req.method === 'GET' && url.pathname === '/pos/sales') return send(200, store.sales)
    if (req.method === 'GET' && url.pathname === '/stock/receipts') return send(200, store.layers)
    if (req.method === 'POST' && url.pathname === '/pos/shifts/open') {
      const known = store.shifts.find(s => s.clientRef === body?.clientRef)
      if (known) return send(200, known)
      const row = { id: `SHIFT-R-${store.shifts.length + 1}`, clientRef: body.clientRef, status: 'open', cashierId: body.cashierId }
      store.shifts.push(row)
      return send(201, row)
    }
    if (req.method === 'POST' && url.pathname === '/pos/sales') {
      if (mode === 'timeout_after_commit') {
        const fp = engine.businessPayloadFingerprint('sale', body)
        const row = { id: `SALE-R-${store.sales.length + 1}`, ...body, fingerprint: fp }
        store.sales.push(row)
        store.byRef.set(ref, { kind: 'sale', id: row.id, fingerprint: fp, payload: body, raw: row })
        delete store.failModes[ref]
        req.socket.destroy()
        return
      }
      const existing = store.byRef.get(ref)
      if (existing) return send(409, { detail: 'тот же clientRef уже использован', code: 'IDEMPOTENCY_KEY_REUSED' })
      const fp = engine.businessPayloadFingerprint('sale', body)
      const row = { id: `SALE-R-${store.sales.length + 1}`, ...body, fingerprint: fp }
      store.sales.push(row)
      store.byRef.set(ref, { kind: 'sale', id: row.id, fingerprint: fp, payload: body, raw: row })
      return send(201, row)
    }
    if (req.method === 'DELETE' && /\/layers\//.test(url.pathname)) {
      if (store.byRef.get(ref)) return send(409, { detail: 'idempotent', code: 'IDEMPOTENCY_KEY_REUSED' })
      const row = { id: `LAYER-${ref}`, clientRef: ref, ...body }
      store.layers.push(row)
      store.byRef.set(ref, {
        kind: 'stock_layer_delete',
        id: row.id,
        fingerprint: engine.businessPayloadFingerprint('stock_layer_delete', body),
        payload: body,
        raw: row,
      })
      return send(200, row)
    }
    send(404, { detail: 'miss' })
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        store,
        close: () => new Promise(r => server.close(() => r())),
      })
    })
  })
}

expect(fs.existsSync(SOURCE), 'REAL_CASHIER_8 source')
const sourceSha = crypto.createHash('sha256').update(fs.readFileSync(SOURCE)).digest('hex').toUpperCase()
const queueAll = ensureQueueCache()
const serverSnap = fs.existsSync(SERVER_GET) ? jp(fs.readFileSync(SERVER_GET, 'utf8')) : { sales: [], shifts: [] }
const sales = queueAll.filter(r => r.kind === 'sale')
const layerOps = queueAll.filter(r => r.kind === 'stock_layer_delete')
expect(sales.length === 90, `sales=${sales.length}`)
expect(layerOps.length === 1, `layers=${layerOps.length}`)

const closedIds = new Set()
for (const r of sales) {
  const sid = String(r.payload?.shiftId || '')
  if (sid) closedIds.add(sid)
}
const serverByClientRef = orch.buildServerByClientRefFromSales(serverSnap.sales || [])
const ghostIds = [...new Set(sales.filter(s => /^off-/i.test(String(s.payload?.shiftId || ''))).map(s => String(s.payload.shiftId)))]

test('A detectRecoveryNeed on REAL_CASHIER_8', () => {
  const d = orch.detectRecoveryNeed({
    queue: queueAll,
    meta: {},
    appVersion: '1.2.192',
    previousAppVersion: '1.2.190',
  })
  expect(d.need, JSON.stringify(d))
  expect(d.counts.idempotencyFailed === 8, String(d.counts.idempotencyFailed))
  expect(d.counts.shiftFailed >= 1)
})

test('B healthy empty queue skips recovery', () => {
  const d = orch.detectRecoveryNeed({
    queue: [],
    meta: {},
    appVersion: '1.2.192',
    previousAppVersion: '1.2.190',
  })
  expect(!d.need)
})

test('C normal pending sale without legacy markers skips', () => {
  const d = orch.detectRecoveryNeed({
    queue: [{
      clientRef: 'n1', kind: 'sale', failed: false, lastError: '',
      payload: { shiftId: 'SHIFT-OPEN-1', items: [] },
    }],
    meta: {},
    appVersion: '1.2.192',
    previousAppVersion: '1.2.192',
  })
  expect(!d.need)
})

test('D desktop orchestrator production gate without human token', () => {
  const g = orch.createDesktopOrchestratorProductionGate({
    sessionId: 'RS-auto',
    baseUrl: 'https://kakappo.shop/api/kakapo',
    snapshotExists: true,
    backupManifestPresent: true,
    classificationClean: true,
    freezeWatermarkUnchanged: true,
  })
  expect(g.gate.ok, JSON.stringify(g.gate))
  expect(g.token.issuer === 'DESKTOP_ORCHESTRATOR_V1')
})

test('E env alone still insufficient', () => {
  const r = guard.assertProductionReplayAllowed({
    recoveryMode: true,
    phase: 'RECOVERY_REPLAY',
    sessionId: 'RS-x',
    snapshotExists: true,
    backupManifestPresent: true,
    classificationClean: true,
    freezeWatermarkUnchanged: true,
    operatorToken: null,
    baseUrl: 'https://kakappo.shop/api/kakapo',
    envFlag: '1',
  })
  expect(!r.ok)
})

await asyncTest('F REAL_CASHIER_8 full automatic upgrade → queue 0', async () => {
  const seedSales = (serverSnap.sales || []).filter(s =>
    sales.some(q => q.clientRef === s.clientRef && /IDEMPOTENCY|тот же clientRef/i.test(q.lastError || '')))
  const mock = await startMock({
    seedSales: seedSales.map(s => ({
      ...s,
      fingerprint: engine.fingerprintSaleServerRow(s),
    })),
  })
  // mark historical shifts closed on mock for classification realism
  for (const id of closedIds) {
    mock.store.shifts.push({ id, status: 'closed', clientRef: `closed-${id}` })
  }
  const api = adapter.createRecoveryHttpAdapter({ baseUrl: mock.baseUrl })
  const beforeRefs = sales.map(s => s.clientRef).sort()
  const result = await orch.simulateSelfRecoveringUpgrade({
    queue: queueAll.map(r => ({ ...r, payload: { ...r.payload } })),
    meta: { recoveryRequiredAfterUpgrade: true },
    appVersion: '1.2.192',
    previousAppVersion: '1.2.190',
    serverByClientRef,
    serverClosedIds: closedIds,
    serverShiftById: new Map([...closedIds].map(id => [id, { status: 'closed' }])),
    ghostIds,
    api,
    serverSales: mock.store.sales,
    serverSnapshot: { sales: mock.store.sales, shifts: mock.store.shifts },
    backupManifest: { ok: true, sha256: sourceSha },
  })
  expect(result.ok, JSON.stringify({ error: result.error, status: result.status, blockers: result.hardBlockers?.slice?.(0, 3), queueAfter: result.queueAfter }))
  expect(result.queueAfter === 0, `queueAfter=${result.queueAfter}`)
  expect(result.ack === 8, `ack=${result.ack}`)
  const accounted = new Set([
    ...mock.store.sales.map(s => s.clientRef),
    ...seedSales.map(s => s.clientRef),
  ])
  // All original sale refs either ACK'd (on seed) or replayed onto mock
  for (const ref of beforeRefs) expect(accounted.has(ref), `lost ${ref}`)
  expect(mock.store.sales.map(s => s.clientRef).length === new Set(mock.store.sales.map(s => s.clientRef)).size)
  expect(mock.store.layers.length === 1)
  await mock.close()
})

await asyncTest('G live-like derivative: extra sales + ACK-lost + crash timeout', async () => {
  // Use local-only SHIFT_CLOSED sales (not ACK-lost) as base — ACK-lost need server seed
  const localOnly = queueAll.filter(r =>
    r.kind === 'sale' && /SHIFT_CLOSED|смена уже закрыта/i.test(String(r.lastError || ''))).slice(0, 10)
  const base = localOnly.map(r => ({ ...r, payload: { ...r.payload } }))
  const extraOffline = {
    clientRef: 'LIVE-EXTRA-OFFLINE-1',
    kind: 'sale',
    seq: 999001,
    failed: false,
    lastError: '',
    payload: {
      clientRef: 'LIVE-EXTRA-OFFLINE-1',
      shiftId: 'off-ghost-live',
      items: [{ productId: 1, qty: 1, price: 10, name: 'x' }],
      paidCash: 10,
      paidCard: 0,
      paidWallet: 0,
      debtAdded: 0,
      bonusSpent: 0,
    },
  }
  const ackLost = {
    clientRef: 'LIVE-ACK-LOST-1',
    kind: 'sale',
    seq: 999002,
    failed: true,
    lastError: 'IDEMPOTENCY_KEY_REUSED: тот же clientRef',
    payload: {
      clientRef: 'LIVE-ACK-LOST-1',
      shiftId: 'SHIFT-OLD',
      items: [{ productId: 2, qty: 1, price: 5, name: 'y' }],
      paidCash: 5,
      paidCard: 0,
      paidWallet: 0,
      debtAdded: 0,
      bonusSpent: 0,
    },
  }
  const crashSale = {
    clientRef: 'LIVE-CRASH-1',
    kind: 'sale',
    seq: 999003,
    failed: true,
    lastError: 'Смена уже закрыта [SHIFT_CLOSED]',
    payload: {
      clientRef: 'LIVE-CRASH-1',
      shiftId: 'SHIFT-OLD',
      items: [{ productId: 3, qty: 2, price: 7, name: 'z' }],
      paidCash: 14,
      paidCard: 0,
      paidWallet: 0,
      debtAdded: 0,
      bonusSpent: 0,
    },
  }
  const q = [...base, extraOffline, ackLost, crashSale]
  const mock = await startMock({
    seedSales: [{
      ...ackLost.payload,
      id: 'SALE-SEED-ACK',
      fingerprint: engine.businessPayloadFingerprint('sale', ackLost.payload),
    }],
    failModes: { 'LIVE-CRASH-1': 'timeout_after_commit' },
  })
  mock.store.shifts.push({ id: 'SHIFT-OLD', status: 'closed' })
  for (const r of base) {
    const sid = String(r.payload?.shiftId || '')
    if (sid && !mock.store.shifts.some(s => s.id === sid)) {
      mock.store.shifts.push({ id: sid, status: 'closed' })
    }
  }
  const api = adapter.createRecoveryHttpAdapter({ baseUrl: mock.baseUrl })
  const serverByClientRef2 = orch.buildServerByClientRefFromSales(mock.store.sales)
  const closed2 = new Set(['SHIFT-OLD', ...base.map(r => r.payload?.shiftId).filter(Boolean)])
  const result = await orch.simulateSelfRecoveringUpgrade({
    queue: q,
    meta: { recoveryMode: true },
    force: true,
    serverByClientRef: serverByClientRef2,
    serverClosedIds: closed2,
    serverShiftById: new Map([...closed2].map(id => [id, { status: 'closed' }])),
    ghostIds: ['off-ghost-live'],
    api,
    serverSales: mock.store.sales,
    serverSnapshot: { sales: mock.store.sales },
    backupManifest: { ok: true, sha256: 'LIVE' },
  })
  expect(result.ok, JSON.stringify({ error: result.error, status: result.status, q: result.queueAfter, blockers: result.hardBlockers?.slice?.(0, 5) }))
  expect(result.queueAfter === 0)
  expect(mock.store.sales.some(s => s.clientRef === 'LIVE-EXTRA-OFFLINE-1'))
  expect(mock.store.sales.some(s => s.clientRef === 'LIVE-CRASH-1'))
  expect(mock.store.sales.filter(s => s.clientRef === 'LIVE-CRASH-1').length === 1)
  await mock.close()
})

await asyncTest('H backup required — refuse without manifest', async () => {
  const mock = await startMock()
  const api = adapter.createRecoveryHttpAdapter({ baseUrl: mock.baseUrl })
  const result = await orch.simulateSelfRecoveringUpgrade({
    queue: sales.slice(0, 3),
    meta: { recoveryMode: true },
    force: true,
    api,
    backupManifest: { ok: false },
    serverClosedIds: new Set(),
  })
  // simulateSelfRecoveringUpgrade returns early on backup fail
  expect(!result.ok && result.error === 'backup_failed')
  await mock.close()
})

test('I REAL_CASHIER_8 source SHA unchanged', () => {
  expect(sourceSha === '874CAEDD3DAA5C0FFA05834FA61930A6C7F13A26C9D2600774027B92A0E1B9DA')
})

test('J production GET classify allowed without mutation gate', () => {
  const api = adapter.createRecoveryHttpAdapter({
    baseUrl: 'https://kakappo.shop/api/kakapo',
    allowProductionHost: true,
    allowProductionGetClassify: true,
    fetchFn: async () => ({ ok: true, status: 200, text: async () => '[]' }),
  })
  expect(!!api.listPosSales)
  expect(!!api.setProductionReplayGate)
})

await asyncTest('J2 mutation refuses until gate set', async () => {
  const api = adapter.createRecoveryHttpAdapter({
    baseUrl: 'https://kakappo.shop/api/kakapo',
    allowProductionHost: true,
    allowProductionGetClassify: true,
    fetchFn: async () => ({ ok: true, status: 200, text: async () => '[]' }),
  })
  let refused = false
  try {
    await api.openPosShift({ clientRef: 'x', cashierId: 'C', openingCash: 0 })
  } catch (e) {
    refused = /REFUSE_PRODUCTION_REPLAY/.test(String(e.message || e))
  }
  expect(refused)
})

const fail = results.filter(r => r.status === 'FAIL')
const report = {
  at: new Date().toISOString(),
  sourceSha,
  PASS: results.length - fail.length,
  FAIL: fail.length,
  results,
  REAL_CASHIER_8_SOURCE_MUTATED: crypto.createHash('sha256').update(fs.readFileSync(SOURCE)).digest('hex').toUpperCase() === sourceSha ? 'NO' : 'YES',
  PRODUCTION_SERVER_POSTS: 0,
}
fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
console.log('\n── PC-5 SUMMARY ──')
console.log(`PASS ${report.PASS} / FAIL ${report.FAIL}`)
console.log('wrote', OUT)
if (fail.length) process.exitCode = 1
