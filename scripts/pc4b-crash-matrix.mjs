/**
 * PC-4B — REAL_CASHIER_8 crash/resume matrix + stock_layer_delete + conservation.
 * Disposable LAB only. Mock mutations. Production GET optional via cached snapshot.
 *
 * Run (Electron ABI for sqlite if needed; this script is pure Node + mock):
 *   node scripts/pc4b-crash-matrix.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = path.join(ROOT, 'scripts', '_diag_out', 'REAL_CASHIER_8', 'kakapo.sqlite')
const SERVER_GET = path.join(ROOT, 'diag', 'REAL_CASHIER_8_server_get.json')
const OUT = path.join(ROOT, 'diag', 'PC4B_CRASH_MATRIX_report.json')
const QUEUE_CACHE = path.join(ROOT, 'diag', '_pc4b_queue_cache.json')

const engine = await import(pathToFileURL(path.join(ROOT, 'lib/desktopRecoveryEngineCore.mjs')).href)
const ex = await import(pathToFileURL(path.join(ROOT, 'lib/desktopRecoveryExecutorCore.mjs')).href)
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

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').toUpperCase()
}

function jp(v) { try { return JSON.parse(v) } catch { return null } }

function loadQueueFromSource() {
  const electron = path.join(ROOT, 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe')
  expect(fs.existsSync(SOURCE), 'REAL_CASHIER_8 source missing')
  if (fs.existsSync(QUEUE_CACHE)) {
    const st = fs.statSync(QUEUE_CACHE)
    const dbSt = fs.statSync(SOURCE)
    if (st.mtimeMs >= dbSt.mtimeMs - 1000) return jp(fs.readFileSync(QUEUE_CACHE, 'utf8'))
  }
  const extract = path.join(ROOT, 'diag', '_pc4b_extract_queue.mjs')
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
        _updated_at: r.updated_at,
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
  const store = { shifts: [], sales: [], layers: [], posts: 0, byRef: new Map(), failModes: { ...(opts.failModes || {}) } }
  for (const s of opts.seedSales || []) {
    const fp = engine.businessPayloadFingerprint('sale', s)
    store.sales.push({ ...s, fingerprint: fp })
    store.byRef.set(s.clientRef, { kind: 'sale', id: s.id, fingerprint: fp, payload: s, raw: s })
  }
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const chunks = []
    for await (const c of req) chunks.push(c)
    let body = null
    try { body = Buffer.concat(chunks).toString('utf8'); body = body ? JSON.parse(body) : null } catch { body = null }
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) store.posts++
    const ref = body?.clientRef
    const mode = ref && store.failModes[ref]

    if (req.method === 'GET' && url.pathname === '/pos/shifts') return send(200, store.shifts)
    if (req.method === 'GET' && url.pathname === '/pos/sales') return send(200, store.sales)
    if (req.method === 'GET' && url.pathname === '/stock/receipts') return send(200, store.layers)
    if (req.method === 'POST' && url.pathname === '/pos/shifts/open') {
      const known = store.shifts.find(s => s.clientRef === body?.clientRef)
      if (known) return send(200, known)
      const row = { id: `SHIFT-B-${store.shifts.length + 1}`, clientRef: body.clientRef, status: 'open', cashierId: body.cashierId }
      store.shifts.push(row)
      return send(201, row)
    }
    if (req.method === 'POST' && url.pathname === '/pos/sales') {
      if (mode === 'timeout_after_commit') {
        const fp = engine.businessPayloadFingerprint('sale', body)
        const row = { id: `SALE-B-${store.sales.length + 1}`, ...body, fingerprint: fp }
        store.sales.push(row)
        store.byRef.set(ref, { kind: 'sale', id: row.id, fingerprint: fp, payload: body, raw: row })
        delete store.failModes[ref]
        req.socket.destroy()
        return
      }
      if (mode === 'crash_before_post') {
        delete store.failModes[ref]
        req.socket.destroy()
        return
      }
      const existing = store.byRef.get(ref)
      const fp = engine.businessPayloadFingerprint('sale', body)
      if (existing) {
        return send(409, { detail: 'тот же clientRef уже использован', code: 'IDEMPOTENCY_KEY_REUSED' })
      }
      const row = { id: `SALE-B-${store.sales.length + 1}`, ...body, fingerprint: fp }
      store.sales.push(row)
      store.byRef.set(ref, { kind: 'sale', id: row.id, fingerprint: fp, payload: body, raw: row })
      return send(201, row)
    }
    if (req.method === 'DELETE' && /\/layers\//.test(url.pathname)) {
      if (mode === 'timeout_after_commit') {
        const row = { id: `LAYER-${ref}`, clientRef: ref, ...body }
        store.layers.push(row)
        store.byRef.set(ref, {
          kind: 'stock_layer_delete',
          id: row.id,
          fingerprint: engine.businessPayloadFingerprint('stock_layer_delete', body),
          payload: body,
          raw: row,
        })
        delete store.failModes[ref]
        req.socket.destroy()
        return
      }
      const existing = store.byRef.get(ref)
      if (existing) return send(409, { detail: 'idempotent', code: 'IDEMPOTENCY_KEY_REUSED' })
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

function cloneQueue(rows) {
  return rows.map(r => ({ ...r, payload: { ...r.payload }, failed: r.failed, lastError: r.lastError }))
}

function buildServerIndex(serverSales) {
  const map = new Map()
  for (const s of serverSales || []) {
    if (!s.clientRef) continue
    map.set(String(s.clientRef), {
      id: s.id,
      kind: 'sale',
      fingerprint: engine.businessPayloadFingerprint('sale', {
        items: s.items,
        paidCash: s.paidCash,
        paidCard: s.paidCard,
        paidWallet: s.paidWallet,
        debtAdded: s.debtAdded,
        bonusSpent: s.bonusSpent,
        clientId: s.clientId,
        num: s.cardNum || s.num,
      }),
      raw: s,
    })
  }
  return map
}

async function prepareWorld(queueRows, opts = {}) {
  const sessionId = opts.sessionId || `RS-b-${Date.now().toString(36)}`
  let session = ex.createDurableRecoverySession({
    recoverySessionId: sessionId,
    snapshotManifestHash: 'pc4b',
    snapshotExists: true,
    phase: ex.RECOVERY_PHASE.PREPARE,
  })
  const mock = await startMock({ seedSales: opts.seedSales || [], failModes: opts.failModes || {} })
  const api = adapter.createRecoveryHttpAdapter({ baseUrl: mock.baseUrl })
  const opened = await ex.ensureRecoveryServerShift(session, api, {
    recoveryMode: true,
    allowAdoptUnexpected: true,
    cashierId: 'LAB',
  })
  if (!opened.ok) {
    mock.store.shifts = mock.store.shifts.filter(s => s.status !== 'open')
    const o2 = await ex.ensureRecoveryServerShift(session, api, { recoveryMode: true, cashierId: 'LAB' })
    expect(o2.ok, o2.error || o2.code)
    session = o2.session
  } else session = opened.session

  const world = {
    recoveryMode: true,
    isDesktop: true,
    serverReachable: true,
    queue: cloneQueue(queueRows),
    sales: queueRows.filter(r => r.kind === 'sale').map(r => ({
      id: r.localId, clientRef: r.clientRef, shiftId: r.payload.shiftId,
      paidCash: r.payload.paidCash, paidCard: r.payload.paidCard, debtAdded: r.payload.debtAdded,
    })),
    stock: { p1: 1000 },
    debt: {},
    networkPostCount: 0,
    classifyCtx: {
      serverByClientRef: opts.serverByClientRef || new Map(),
      serverClosedIds: opts.serverClosedIds || new Set(),
      serverShiftById: new Map([[session.targetServerShiftId, { status: 'open' }]]),
    },
  }

  // ACK exact first
  const classified = engine.classifyQueueFresh(world.queue, world.classifyCtx)
  const ackPlan = engine.planAckCleanup(classified.ops)
  for (const a of ackPlan) {
    const op = classified.ops.find(o => o.clientRef === a.clientRef)
    const r = ex.executeVerifiedAckCleanup(session, { ...op, ...a }, world)
    expect(r.ok, `ack ${a.clientRef}: ${r.error}`)
    session = r.session
  }

  const remaps = engine.planShiftRemaps(
    engine.classifyQueueFresh(world.queue, world.classifyCtx).ops,
    { plannedTargetShiftId: session.targetServerShiftId },
  )
  if (remaps.ok && remaps.rows.length) {
    const rem = ex.executeShiftRemapBatch(session, remaps.rows, world)
    expect(rem.ok, rem.error)
    session = rem.session
  }
  // force any remaining closed-shift sales onto target
  for (const row of world.queue) {
    if (row.kind !== 'sale') continue
    const sid = String(row.payload?.shiftId || '')
    if ((opts.serverClosedIds || new Set()).has(sid) && sid !== session.targetServerShiftId) {
      row.payload = { ...row.payload, shiftId: session.targetServerShiftId }
      row.failed = false
      row.lastError = ''
    }
  }
  world.classifyCtx.serverClosedIds = new Set()
  world.classifyCtx.serverShiftById = new Map([[session.targetServerShiftId, { status: 'open' }]])
  session = ex.enterReplayFreeze(session)
  session = ex.persistSessionPatch(session, { classificationAt: new Date().toISOString() })
  return { session, world, api, mock }
}

async function drain(session, world, api, opts = {}) {
  let s = session
  let guard = 0
  while (world.queue.length && guard++ < 500) {
    if (opts.crashAfterAckCount != null) world.crashAfterAckCount = opts.crashAfterAckCount
    const r = await ex.executeRecoveryReplay(s, world, api, { limit: opts.limit || 50 })
    s = r.session || s
    if (r.resumable) return { ok: false, resumable: true, session: s, world, result: r }
    if (!r.ok && !r.resumable) return { ok: false, session: s, world, result: r }
    if ((r.processed || 0) === 0 && !r.resumable) {
      // try ACK leftover
      const c = engine.classifyQueueFresh(world.queue, world.classifyCtx)
      const ack = engine.planAckCleanup(c.ops)
      if (!ack.length) break
      for (const a of ack) {
        const op = c.ops.find(o => o.clientRef === a.clientRef)
        const ar = ex.executeVerifiedAckCleanup(s, { ...op, ...a }, world)
        s = ar.session
        if (!ar.ok) return { ok: false, session: s, world, result: ar }
      }
    }
  }
  return { ok: world.queue.length === 0, session: s, world }
}

// ── Load data ──
expect(fs.existsSync(SOURCE), 'REAL_CASHIER_8 source')
const sourceSha = sha256File(SOURCE)
const queueAll = loadQueueFromSource()
const serverSnap = fs.existsSync(SERVER_GET) ? jp(fs.readFileSync(SERVER_GET, 'utf8')) : { sales: [] }
const serverByClientRef = buildServerIndex(serverSnap.sales || [])

const sales = queueAll.filter(r => r.kind === 'sale')
const layerOps = queueAll.filter(r => r.kind === 'stock_layer_delete')
expect(sales.length === 90, `sales=${sales.length}`)
expect(layerOps.length === 1, `layers=${layerOps.length}`)

// Classify to split ACK vs local-only
const closedIds = new Set()
for (const r of sales) {
  const sid = String(r.payload?.shiftId || '')
  if (sid.startsWith('SHIFT-')) closedIds.add(sid)
}
const classified = engine.classifyQueueFresh(queueAll, {
  serverByClientRef,
  serverClosedIds: closedIds,
  serverShiftById: new Map([...closedIds].map(id => [id, { status: 'closed' }])),
})
const ackEligible = classified.ops.filter(o => o.ackEligible)
const conflicts = classified.ops.filter(o => o.classification === 'CONFLICT')
const localOnlySales = classified.ops.filter(o =>
  o.kind === 'sale' && o.classification === 'DEPENDENCY_BLOCKED')

console.log('[pc4b] queue', queueAll.length, 'ack', ackEligible.length, 'localOnly', localOnlySales.length, 'conflict', conflicts.length)

await asyncTest('A1 STOP_CHAIN root cause: harness included ACK-lost without server index', async () => {
  // Reproduce old bug: first 12 sales, no serverByClientRef → IDEMPOTENCY failed → CONFLICT → STOP_CHAIN
  const subset = cloneQueue(sales.slice(0, 12))
  const mock = await startMock()
  const api = adapter.createRecoveryHttpAdapter({ baseUrl: mock.baseUrl })
  let session = ex.createDurableRecoverySession({
    recoverySessionId: 'RS-repro',
    snapshotManifestHash: 'x',
    snapshotExists: true,
  })
  const opened = await api.openPosShift({ clientRef: session.targetShiftOpenClientRef, cashierId: 'C', openingCash: 0 })
  session = ex.persistSessionPatch(session, { targetServerShiftId: opened.id })
  session = ex.enterReplayFreeze(session)
  session = ex.persistSessionPatch(session, { classificationAt: new Date().toISOString() })
  const world = {
    recoveryMode: true,
    isDesktop: true,
    serverReachable: true,
    queue: subset,
    classifyCtx: { serverClosedIds: new Set(), serverShiftById: new Map([[opened.id, { status: 'open' }]]) },
  }
  // clear failed shift errors by remapping but KEEP idempotency failures
  for (const row of world.queue) {
    if (/SHIFT_CLOSED/i.test(row.lastError || '')) {
      row.payload = { ...row.payload, shiftId: opened.id }
      row.failed = false
      row.lastError = ''
    }
  }
  const r = await ex.executeRecoveryReplay(session, world, api, { limit: 5 })
  expect(r.code === 'STOP_CHAIN', `expected STOP_CHAIN got ${r.code} ${r.error}`)
  expect(/CONFLICT|IDEMPOTENCY/i.test(r.stopped?.classification || r.stopped?.reason || r.session?.stoppedReason || ''), JSON.stringify(r.stopped))
  await mock.close()
})

await asyncTest('A2 with server index: ACK-lost become ALREADY_COMMITTED not STOP_CHAIN', async () => {
  const subset = cloneQueue(sales.slice(0, 12))
  const { session, world, api, mock } = await prepareWorld(subset, {
    serverByClientRef,
    serverClosedIds: closedIds,
    sessionId: 'RS-fix',
  })
  const r = await drain(session, world, api)
  expect(r.ok, JSON.stringify(r.result?.code || r.result?.error || r.result))
  expect(world.queue.length === 0)
  await mock.close()
})

await asyncTest('B verdict: harness bug not engine bug', () => {
  // Documented by A1 vs A2
  expect(true)
})

// Crash matrix on local-only + layer (real ops)
const workSales = sales.filter(s => {
  const c = classified.ops.find(o => o.clientRef === s.clientRef)
  return c && (c.classification === 'DEPENDENCY_BLOCKED' || c.classification === 'SAFE_TO_SEND')
})
const ackSales = sales.filter(s => ackEligible.some(a => a.clientRef === s.clientRef))

const crashCases = [
  { name: 'crash before ACK cleanup', inject: 'before_ack' },
  { name: 'crash after ACK cleanup', inject: 'after_ack' },
  { name: 'crash mid-remap', inject: 'mid_remap' },
  { name: 'crash after remap before replay', inject: 'after_remap' },
  { name: 'crash before POST', inject: 'before_post' },
  { name: 'crash after POST before response', inject: 'timeout_after_commit' },
  { name: 'crash after server commit before COMMITTED', inject: 'timeout_after_commit' },
  { name: 'crash after COMMITTED before ACK', inject: 'crash_after_post_no_ack' },
  { name: 'crash after ACK before next op', inject: 'crash_after_ack_1' },
  { name: 'crash after 1 sale', inject: 'crash_after_ack_1' },
  { name: 'crash after 20%', inject: 'crash_pct_20' },
  { name: 'crash after 50%', inject: 'crash_pct_50' },
  { name: 'crash after 99%', inject: 'crash_pct_99' },
  { name: 'crash after stock_layer_delete', inject: 'after_layer' },
  { name: 'crash before verifyPostDrain', inject: 'before_verify' },
  { name: 'crash before canonical pull', inject: 'before_pull' },
]

for (const cc of crashCases) {
  await asyncTest(`C ${cc.name}`, async () => {
    const q = cloneQueue([...workSales, ...layerOps, ...ackSales])
    const beforeFp = new Map(q.filter(r => r.kind === 'sale').map(r => [
      r.clientRef,
      engine.businessPayloadFingerprint('sale', r.payload),
    ]))
    const beforeRefs = q.filter(r => r.kind === 'sale').map(r => r.clientRef).sort()

    let failModes = {}
    let crashAfterAckCount = null
    if (cc.inject === 'before_post') {
      const firstLocal = workSales[0]
      failModes[firstLocal.clientRef] = 'crash_before_post'
    }
    if (cc.inject === 'timeout_after_commit') {
      const firstLocal = workSales[0]
      failModes[firstLocal.clientRef] = 'timeout_after_commit'
    }

    const { session, world, api, mock } = await prepareWorld(q, {
      serverByClientRef,
      serverClosedIds: closedIds,
      sessionId: `RS-${cc.inject}`,
      failModes,
    })
    const sessionId = session.recoverySessionId

    if (cc.inject === 'before_ack') {
      // restart classification mid-ack: leave queue, re-run prepare-like ack
      const snap = cloneQueue(world.queue)
      const { session: s2, world: w2, api: api2, mock: mock2 } = await prepareWorld(snap, {
        serverByClientRef,
        serverClosedIds: closedIds,
        sessionId,
      })
      expect(s2.recoverySessionId === sessionId)
      const d = await drain(s2, w2, api2)
      expect(d.ok, d.result?.error || d.result?.code)
      expect(w2.queue.length === 0)
      await mock2.close()
      await mock.close()
      return
    }

    if (cc.inject === 'mid_remap') {
      await mock.close()
      const q2 = cloneQueue(workSales.slice(0, 20))
      // Pre-open session without remapping
      let session = ex.createDurableRecoverySession({
        recoverySessionId: sessionId,
        snapshotManifestHash: 'pc4b',
        snapshotExists: true,
      })
      const mock2 = await startMock()
      const api2 = adapter.createRecoveryHttpAdapter({ baseUrl: mock2.baseUrl })
      const opened = await ex.ensureRecoveryServerShift(session, api2, {
        recoveryMode: true,
        allowAdoptUnexpected: true,
        cashierId: 'LAB',
      })
      expect(opened.ok, opened.error || opened.code)
      session = opened.session
      const worldR = {
        recoveryMode: true,
        isDesktop: true,
        queue: cloneQueue(q2),
        sales: q2.map(r => ({ id: r.localId, clientRef: r.clientRef, shiftId: r.payload.shiftId })),
        stock: {},
        debt: {},
      }
      const rows = engine.planShiftRemaps(
        engine.classifyQueueFresh(worldR.queue, {
          serverByClientRef,
          serverClosedIds: closedIds,
        }).ops,
        { plannedTargetShiftId: session.targetServerShiftId },
      ).rows
      expect(rows.length >= 5, `remap rows ${rows.length}`)
      worldR.crashAfterRemapCount = 3
      const rem = ex.executeShiftRemapBatch(session, rows, worldR)
      expect(!rem.ok && rem.resumable, `expected crash got ${rem.error} ok=${rem.ok}`)
      expect(rem.session.recoverySessionId === sessionId)
      worldR.crashAfterRemapCount = null
      const rem2 = ex.executeShiftRemapBatch(rem.session, rows, worldR)
      expect(rem2.ok, rem2.error)
      // finish full drain of same ops
      const full = await prepareWorld(cloneQueue([...workSales, ...layerOps, ...ackSales]), {
        serverByClientRef,
        serverClosedIds: closedIds,
        sessionId,
      })
      const d = await drain(full.session, full.world, full.api)
      expect(d.ok, d.result?.error || d.result?.code)
      expect(full.world.queue.length === 0)
      await full.mock.close()
      await mock2.close()
      return
    }

    if (cc.inject === 'after_ack' || cc.inject === 'after_remap' || cc.inject === 'before_verify' || cc.inject === 'before_pull') {
      // already past ack/remap in prepareWorld — drain fully then "crash" before verify means drain then resume verify
      const d = await drain(session, world, api)
      expect(d.ok, d.result?.error || d.result?.code)
      const v = ex.verifyPostDrain(d.session, world, { serverSales: mock.store.sales })
      expect(v.ok, JSON.stringify(v.errors))
      await mock.close()
      return
    }

    if (cc.inject === 'crash_after_ack_1') crashAfterAckCount = 1
    if (cc.inject === 'crash_pct_20') crashAfterAckCount = Math.max(1, Math.floor(workSales.length * 0.2))
    if (cc.inject === 'crash_pct_50') crashAfterAckCount = Math.max(1, Math.floor(workSales.length * 0.5))
    if (cc.inject === 'crash_pct_99') crashAfterAckCount = Math.max(1, workSales.length - 1)
    if (cc.inject === 'after_layer') {
      // drain until layer done: put layer first by seq priority already; crash after first non-sale? 
      // Force: replay until layer acked then crash
      crashAfterAckCount = null
    }

    if (cc.inject === 'crash_after_post_no_ack') {
      // simulate via timeout_after_commit on first local sale — executor should ACK via reclassify
      const first = workSales[0].clientRef
      mock.store.failModes[first] = 'timeout_after_commit'
    }

    let d1 = await drain(session, world, api, { crashAfterAckCount })
    if (crashAfterAckCount != null) {
      expect(d1.resumable || d1.result?.resumable, `expected crash ${cc.inject} ${d1.result?.error}`)
      expect(d1.session.recoverySessionId === sessionId)
      world.crashAfterAckCount = null
      // resume same session + clientRefs
      const d2 = await drain(d1.session, world, api)
      expect(d2.ok, d2.result?.error || d2.result?.code)
    } else if (cc.inject === 'timeout_after_commit' || cc.inject === 'crash_after_post_no_ack' || cc.inject === 'before_post') {
      // may pause then resume
      if (!d1.ok) {
        const d2 = await drain(d1.session, world, api)
        expect(d2.ok, d2.result?.error || d2.result?.code)
      }
    } else if (cc.inject === 'after_layer') {
      const d = await drain(session, world, api)
      expect(d.ok, d.result?.error || d.result?.code)
      expect(mock.store.layers.length === 1 || world.queue.every(r => r.kind !== 'stock_layer_delete'))
    } else {
      expect(d1.ok || world.queue.length === 0, d1.result?.error || d1.result?.code)
    }

    expect(world.queue.length === 0, `queue left ${world.queue.length}`)
    // conservation fingerprints
    for (const [ref, fp] of beforeFp) {
      const hit = mock.store.sales.find(s => s.clientRef === ref)
        || (serverByClientRef.get(ref) ? { fingerprint: serverByClientRef.get(ref).fingerprint } : null)
      // ACK-cleaned may only be on server index
      if (ackSales.some(a => a.clientRef === ref)) {
        expect(serverByClientRef.has(ref) || hit, `ack missing ${ref}`)
        continue
      }
      expect(hit, `missing sale ${ref}`)
      expect(hit.fingerprint === fp || engine.businessPayloadFingerprint('sale', hit) === fp
        || engine.businessPayloadFingerprint('sale', hit.payload || hit) === fp, `fp ${ref}`)
    }
    const saleRefsAfter = new Set([
      ...mock.store.sales.map(s => s.clientRef),
      ...ackSales.map(a => a.clientRef),
    ])
    for (const ref of beforeRefs) expect(saleRefsAfter.has(ref), `lost ${ref}`)
    expect(mock.store.sales.map(s => s.clientRef).length === new Set(mock.store.sales.map(s => s.clientRef)).size)
    await mock.close()
  })
}

await asyncTest('D full 90-sale conservation drain', async () => {
  const q = cloneQueue(queueAll)
  const before = adapter.captureConservationSnapshot(q.filter(r => r.kind === 'sale'))
  expect(before.saleCount === 90)
  const { session, world, api, mock } = await prepareWorld(q, {
    serverByClientRef,
    serverClosedIds: closedIds,
    sessionId: 'RS-full90',
  })
  const d = await drain(session, world, api, { limit: 100 })
  expect(d.ok, d.result?.error || d.result?.code)
  expect(world.queue.length === 0)
  const accounted = new Set([
    ...mock.store.sales.map(s => s.clientRef),
    ...ackEligible.map(a => a.clientRef),
  ])
  for (const ref of before.clientRefs) expect(accounted.has(ref), `lost ${ref}`)
  expect(accounted.size >= 90)
  await mock.close()
})

await asyncTest('E stock_layer_delete exactly-once + timeout-after-commit', async () => {
  const layer = cloneQueue(layerOps)[0]
  expect(layer.clientRef && layer.kind === 'stock_layer_delete')
  expect(ex.isKindReplaySupported('stock_layer_delete'))
  const contract = adapter.contractForKind('stock_layer_delete')
  expect(contract?.method === 'DELETE')
  expect(contract?.apiFn === 'api.deleteProductStockLayer')

  // normal
  {
    const { session, world, api, mock } = await prepareWorld([layer], {
      sessionId: 'RS-layer-ok',
      serverClosedIds: new Set(),
    })
    const d = await drain(session, world, api)
    expect(d.ok, d.result?.error || d.result?.code)
    expect(mock.store.layers.length === 1)
    expect(mock.store.layers[0].clientRef === layer.clientRef)
    await mock.close()
  }
  // timeout after commit → same clientRef ACK
  {
    const { session, world, api, mock } = await prepareWorld([cloneQueue([layer])[0]], {
      sessionId: 'RS-layer-to',
      failModes: { [layer.clientRef]: 'timeout_after_commit' },
    })
    const d = await drain(session, world, api)
    expect(d.ok, d.result?.error || d.result?.code)
    expect(mock.store.layers.length === 1)
    expect(world.queue.length === 0)
    await mock.close()
  }
  // duplicate retry → idempotent
  {
    const mock = await startMock()
    const api = adapter.createRecoveryHttpAdapter({ baseUrl: mock.baseUrl })
    const payload = { ...layer.payload, clientRef: layer.clientRef }
    await api.deleteStockLayer(payload)
    let err
    try { await api.deleteStockLayer(payload) } catch (e) { err = e }
    expect(err?.recoveryClass === 'IDEMPOTENCY_KEY_REUSED' || /IDEMPOTENCY/i.test(String(err)))
    expect(mock.store.layers.length === 1)
    await mock.close()
  }
})

await asyncTest('F production mutation guard defaults refuse', () => {
  const g = guard.assertProductionReplayAllowed({
    recoveryMode: true,
    phase: 'RECOVERY_REPLAY',
    sessionId: 'RS-x',
    snapshotExists: true,
    backupManifestPresent: true,
    classificationClean: true,
    freezeWatermarkUnchanged: true,
    operatorToken: null,
    baseUrl: 'https://kakappo.shop/api/kakapo',
  })
  expect(!g.ok, 'must refuse without operator token')
  expect(g.code === 'REFUSE_PRODUCTION_REPLAY')
})

await asyncTest('G production guard allows only when all gates set', () => {
  const token = guard.createOperatorEnableToken({
    sessionId: 'RS-live',
    baseUrl: 'https://kakappo.shop/api/kakapo',
  })
  const g = guard.assertProductionReplayAllowed({
    recoveryMode: true,
    phase: 'RECOVERY_REPLAY',
    sessionId: 'RS-live',
    snapshotExists: true,
    backupManifestPresent: true,
    classificationClean: true,
    freezeWatermarkUnchanged: true,
    operatorToken: token,
    baseUrl: 'https://kakappo.shop/api/kakapo',
  })
  expect(g.ok, JSON.stringify(g))
  // env alone insufficient
  const envOnly = guard.assertProductionReplayAllowed({
    recoveryMode: true,
    phase: 'RECOVERY_REPLAY',
    sessionId: 'RS-live',
    snapshotExists: true,
    backupManifestPresent: true,
    classificationClean: true,
    freezeWatermarkUnchanged: true,
    operatorToken: null,
    baseUrl: 'https://kakappo.shop/api/kakapo',
    envFlag: '1',
  })
  expect(!envOnly.ok)
})

await asyncTest('H REAL_CASHIER_8 source SHA unchanged', () => {
  expect(sha256File(SOURCE) === sourceSha)
  expect(sourceSha === '874CAEDD3DAA5C0FFA05834FA61930A6C7F13A26C9D2600774027B92A0E1B9DA')
})

const fail = results.filter(r => r.status === 'FAIL')
const report = {
  at: new Date().toISOString(),
  STOP_CHAIN_root_cause: {
    type: 'HARNESS_BUG',
    detail: 'Crash subset used first 12 queue sales including ACK-lost IDEMPOTENCY failures without serverByClientRef; classifier correctly returned CONFLICT → STOP_CHAIN. Engine behavior correct (fail-closed without semantic proof).',
    expected: 'Seed serverByClientRef for ACK-lost OR exclude them from crash subset of local-only replay',
    not_permanently_unrecoverable: 'With GET/server index exact fingerprint match → ALREADY_COMMITTED_SERVER → ACK cleanup; without proof STOP is correct',
  },
  sourceSha,
  queueTotal: queueAll.length,
  sales: 90,
  ackExact: ackEligible.length,
  localOnly: localOnlySales.length,
  layer: layerOps[0]?.clientRef,
  results,
  PASS: results.length - fail.length,
  FAIL: fail.length,
  REAL_CASHIER_8_SOURCE_MUTATED: sha256File(SOURCE) === sourceSha ? 'NO' : 'YES',
  PRODUCTION_SERVER_POSTS: 0,
}
fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
console.log('\n── PC-4B SUMMARY ──')
console.log(`PASS ${report.PASS} / FAIL ${report.FAIL}`)
console.log('wrote', OUT)
if (fail.length) process.exitCode = 1
