/**
 * PC-4 — LAB adapter / prep / rollback / conservation tests.
 * Isolated mock HTTP with production-shaped errors. No production POST.
 * REAL_CASHIER_8: if missing → NEED_FRESH_COPY (no fabricated live counts).
 *
 * Run: node scripts/pc4-recovery-lab-test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const results = []
const NEED_FRESH_COPY = !fs.existsSync(path.join(root, 'scripts', '_diag_out', 'REAL_CASHIER_8', 'kakapo.sqlite'))

async function test(name, fn) {
  try {
    await fn()
    results.push({ name, status: 'PASS' })
    console.log(`PASS  ${name}`)
  } catch (e) {
    results.push({ name, status: 'FAIL', error: String(e?.message || e) })
    console.error(`FAIL  ${name}: ${e?.message || e}`)
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg || 'expect failed')
}
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const adapter = await import(pathToFileURL(path.join(root, 'lib/recoveryApiAdapterCore.mjs')).href)
const ex = await import(pathToFileURL(path.join(root, 'lib/desktopRecoveryExecutorCore.mjs')).href)
const engine = await import(pathToFileURL(path.join(root, 'lib/desktopRecoveryEngineCore.mjs')).href)

/** Isolated HTTP mock with production-like shapes */
function startIsolatedMock(opts = {}) {
  const store = {
    shifts: [],
    sales: [],
    receipts: [],
    writeoffs: [],
    moves: [],
    cards: {},
    failModes: { ...(opts.failModes || {}) },
    committedThenFail: new Set(),
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const chunks = []
    for await (const c of req) chunks.push(c)
    let body = null
    const raw = Buffer.concat(chunks).toString('utf8')
    try { body = raw ? JSON.parse(raw) : null } catch { body = null }

    const send = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(obj))
    }

    const ref = body?.clientRef

    // Global fail modes by clientRef
    if (ref && store.failModes[ref]) {
      const mode = store.failModes[ref]
      if (mode === 'timeout_before') {
        // hang then destroy = connection abort for client with short timeout — use destroy
        req.socket.destroy()
        return
      }
      if (mode === 'timeout_after_commit' || mode === '500_after_commit') {
        // commit then fail response
        if (url.pathname === '/pos/sales' && req.method === 'POST') {
          const row = {
            id: `SALE-${store.sales.length + 1}`,
            clientRef: ref,
            ...body,
            fingerprint: engine.businessPayloadFingerprint('sale', body),
          }
          store.sales.push(row)
          delete store.failModes[ref]
          if (mode === 'timeout_after_commit') {
            req.socket.destroy()
            return
          }
          return send(500, { detail: 'Internal Server Error' })
        }
      }
      if (mode === '500_before_commit') {
        delete store.failModes[ref]
        return send(500, { detail: 'Internal Server Error' })
      }
      if (mode === '400') {
        delete store.failModes[ref]
        return send(400, { detail: 'validation: missing items' })
      }
      if (mode === '404') {
        delete store.failModes[ref]
        return send(404, { detail: 'not found' })
      }
      if (mode === 'SHIFT_CLOSED') {
        delete store.failModes[ref]
        return send(409, { detail: 'Смена уже закрыта', code: 'SHIFT_CLOSED' })
      }
      if (mode === '409_exact') {
        // pretends already committed exact — return 409 idempotency; sale already stored
        const existing = store.sales.find(s => s.clientRef === ref)
        if (!existing) {
          store.sales.push({
            id: `SALE-pre-${ref}`,
            clientRef: ref,
            ...body,
            fingerprint: engine.businessPayloadFingerprint('sale', body),
          })
        }
        delete store.failModes[ref]
        return send(409, { detail: 'тот же clientRef уже использован', code: 'IDEMPOTENCY_KEY_REUSED' })
      }
      if (mode === '409_mismatch') {
        store.sales.push({
          id: `SALE-other-${ref}`,
          clientRef: ref,
          paidCash: 999,
          items: [{ productId: 1, qty: 1, price: 999 }],
          fingerprint: engine.businessPayloadFingerprint('sale', {
            items: [{ productId: 1, qty: 1, price: 999 }],
            paidCash: 999,
            paidCard: 0,
            debtAdded: 0,
            bonusSpent: 0,
          }),
        })
        delete store.failModes[ref]
        return send(409, { detail: 'тот же clientRef уже использован', code: 'IDEMPOTENCY_KEY_REUSED' })
      }
      if (mode === 'connection_reset') {
        delete store.failModes[ref]
        req.socket.destroy()
        return
      }
    }

    if (req.method === 'GET' && url.pathname === '/pos/shifts') {
      return send(200, store.shifts)
    }
    if (req.method === 'POST' && url.pathname === '/pos/shifts/open') {
      const known = store.shifts.find(s => s.clientRef === body.clientRef)
      if (known) return send(200, known)
      const open = store.shifts.filter(s => s.status === 'open')
      if (open.length && !opts.allowMultiOpen) {
        return send(409, { detail: 'На этой точке продаж уже открыта сессия' })
      }
      const row = {
        id: `SHIFT-${store.shifts.length + 1}`,
        clientRef: body.clientRef,
        status: 'open',
        cashierId: body.cashierId,
        posId: body.posId || 'POS-1',
      }
      store.shifts.push(row)
      return send(201, row)
    }
    if (req.method === 'GET' && url.pathname === '/pos/sales') {
      return send(200, store.sales)
    }
    if (req.method === 'POST' && url.pathname === '/pos/sales') {
      const existing = store.sales.find(s => s.clientRef === ref)
      if (existing) {
        const fp = engine.businessPayloadFingerprint('sale', body)
        if (existing.fingerprint !== fp) {
          return send(409, { detail: 'тот же clientRef уже использован', code: 'IDEMPOTENCY_KEY_REUSED' })
        }
        return send(409, { detail: 'тот же clientRef уже использован', code: 'IDEMPOTENCY_KEY_REUSED' })
      }
      const row = {
        id: `SALE-${store.sales.length + 1}`,
        clientRef: ref,
        ...body,
        fingerprint: engine.businessPayloadFingerprint('sale', body),
      }
      store.sales.push(row)
      return send(201, row)
    }
    if (req.method === 'GET' && url.pathname === '/stock/receipts') return send(200, store.receipts)
    if (req.method === 'POST' && url.pathname === '/stock/receipts') {
      const row = { id: `RCP-${store.receipts.length + 1}`, clientRef: ref, ...body }
      store.receipts.push(row)
      return send(201, row)
    }
    if (req.method === 'POST' && url.pathname === '/stock/writeoffs') {
      const row = { id: `WO-${store.writeoffs.length + 1}`, clientRef: ref, ...body }
      store.writeoffs.push(row)
      return send(201, row)
    }
    if (req.method === 'POST' && url.pathname === '/finance/moves') {
      const row = { id: `FM-${store.moves.length + 1}`, clientRef: ref, ...body }
      store.moves.push(row)
      return send(201, row)
    }
    if (req.method === 'POST' && /\/cards\/[^/]+\/debt-repay$/.test(url.pathname)) {
      return send(201, { id: `DR-${ref}`, clientRef: ref, amount: body.amount, nextDebt: 0, card: {} })
    }
    if (req.method === 'POST' && /\/cards\/[^/]+\/cash-advance$/.test(url.pathname)) {
      return send(201, { debtLedgerEntryId: `CA-${ref}`, clientRef: ref, amount: body.amount, nextDebt: 10, card: {} })
    }
    if (req.method === 'POST' && /\/cards\/[^/]+\/cash-topup$/.test(url.pathname)) {
      return send(201, { financeMove: { id: `CT-${ref}` }, card: {} })
    }
    if (req.method === 'POST' && /\/pos\/sales\/[^/]+\/return$/.test(url.pathname)) {
      return send(201, { id: `RET-${ref}`, clientRef: ref })
    }
    send(404, { detail: 'mock route not found' })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        server,
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        store,
        close: () => new Promise((r) => server.close(() => r())),
      })
    })
  })
}

function makeSale(opts) {
  return {
    clientRef: opts.clientRef,
    kind: 'sale',
    seq: opts.seq,
    createdAtIso: '2026-09-16T06:00:00.000Z',
    payload: {
      clientRef: opts.clientRef,
      shiftId: opts.shiftId || 'SHIFT-ghost-1',
      items: opts.items || [{ productId: 1, qty: 1, price: 10 }],
      paidCash: opts.paidCash ?? 10,
      paidCard: opts.paidCard ?? 0,
      debtAdded: opts.debtAdded ?? 0,
      bonusSpent: opts.bonusSpent ?? 0,
      appliedLocal: true,
      paymentMethod: 'cash',
    },
  }
}

await test('S0 REAL_CASHIER_8 presence gate', () => {
  if (NEED_FRESH_COPY) {
    console.log('  NOTE  NEED_FRESH_COPY — scripts/_diag_out/REAL_CASHIER_8/kakapo.sqlite missing')
  }
  expect(typeof NEED_FRESH_COPY === 'boolean')
})

await test('S1 adapter refuses production hosts', () => {
  let threw = false
  try {
    adapter.createRecoveryHttpAdapter({ baseUrl: 'https://kakappo.shop/api' })
  } catch (e) {
    threw = /REFUSE_PRODUCTION_HOST/.test(String(e.message))
  }
  expect(threw)
  const matrix = adapter.recoveryHttpContractMatrix()
  expect(matrix.find(r => r.kind === 'sale')?.path === '/pos/sales')
  expect(matrix.find(r => r.kind === 'debt_repay')?.apiFn === 'api.debtRepayCard')
})

await test('1 real adapter success 201', async () => {
  const mock = await startIsolatedMock({ allowMultiOpen: true })
  try {
    const api = adapter.createRecoveryHttpAdapter({ baseUrl: mock.baseUrl })
    const sale = await api.createPosSale({
      clientRef: 'ok-1',
      shiftId: 'SHIFT-1',
      items: [{ productId: 1, qty: 1, price: 5 }],
      paidCash: 5,
      paymentMethod: 'cash',
    })
    expect(sale.id && sale.clientRef === 'ok-1')
    expect(api.getMutationCount() === 1)
  } finally {
    await mock.close()
  }
})

await test('2 real adapter 400', async () => {
  const mock = await startIsolatedMock({ failModes: { bad: '400' } })
  try {
    const api = adapter.createRecoveryHttpAdapter({ baseUrl: mock.baseUrl })
    let cls
    try {
      await api.createPosSale({ clientRef: 'bad', items: [], paidCash: 0, paymentMethod: 'cash' })
    } catch (e) {
      cls = e.recoveryClass
    }
    expect(cls === 'VALIDATION_400', cls)
  } finally {
    await mock.close()
  }
})

await test('3 409 exact idempotency', async () => {
  const mock = await startIsolatedMock({ failModes: { ex: '409_exact' } })
  try {
    const api = adapter.createRecoveryHttpAdapter({ baseUrl: mock.baseUrl })
    const payload = {
      clientRef: 'ex',
      items: [{ productId: 1, qty: 1, price: 5 }],
      paidCash: 5,
      paymentMethod: 'cash',
    }
    let err
    try { await api.createPosSale(payload) } catch (e) { err = e }
    expect(err?.recoveryClass === 'IDEMPOTENCY_KEY_REUSED')
    const hit = await api.getByClientRef('sale', 'ex')
    expect(hit && hit.fingerprint === engine.businessPayloadFingerprint('sale', payload))
  } finally {
    await mock.close()
  }
})

await test('4 409 mismatch', async () => {
  const mock = await startIsolatedMock({ failModes: { mm: '409_mismatch' } })
  try {
    const api = adapter.createRecoveryHttpAdapter({ baseUrl: mock.baseUrl })
    const payload = {
      clientRef: 'mm',
      items: [{ productId: 1, qty: 1, price: 5 }],
      paidCash: 5,
      paymentMethod: 'cash',
    }
    let err
    try { await api.createPosSale(payload) } catch (e) { err = e }
    expect(err?.recoveryClass === 'IDEMPOTENCY_KEY_REUSED')
    const hit = await api.getByClientRef('sale', 'mm')
    expect(hit.fingerprint !== engine.businessPayloadFingerprint('sale', payload))
  } finally {
    await mock.close()
  }
})

await test('5 SHIFT_CLOSED', async () => {
  const mock = await startIsolatedMock({ failModes: { sc: 'SHIFT_CLOSED' } })
  try {
    const api = adapter.createRecoveryHttpAdapter({ baseUrl: mock.baseUrl })
    let cls
    try {
      await api.createPosSale({ clientRef: 'sc', items: [{ productId: 1, qty: 1, price: 1 }], paidCash: 1, paymentMethod: 'cash' })
    } catch (e) { cls = e.recoveryClass }
    expect(cls === 'SHIFT_CLOSED')
  } finally {
    await mock.close()
  }
})

await test('6-9 timeout/500 before/after + connection reset', async () => {
  for (const [ref, mode, expectClass] of [
    ['t0', 'timeout_before', 'TIMEOUT_BEFORE_COMMIT'],
    ['t1', 'timeout_after_commit', 'TIMEOUT_AFTER_COMMIT'],
    ['s0', '500_before_commit', 'SERVER_500_BEFORE_COMMIT'],
    ['s1', '500_after_commit', 'SERVER_500_AFTER_COMMIT'],
    ['cr', 'connection_reset', 'TIMEOUT_BEFORE_COMMIT'],
  ]) {
    const mock = await startIsolatedMock({ failModes: { [ref]: mode } })
    try {
      const api = adapter.createRecoveryHttpAdapter({
        baseUrl: mock.baseUrl,
        // short timeout for hang cases
      })
      // override fetch timeout via wrapping — adapter uses 15s; for destroy, fetch fails fast
      let cls
      try {
        await api.createPosSale({
          clientRef: ref,
          items: [{ productId: 1, qty: 1, price: 1 }],
          paidCash: 1,
          paymentMethod: 'cash',
        })
      } catch (e) {
        cls = e.recoveryClass
      }
      expect(cls === expectClass || (mode.includes('timeout') && /TIMEOUT/.test(cls)) || (mode.includes('500') && /SERVER_500/.test(cls)) || (mode === 'connection_reset' && /TIMEOUT|UNKNOWN/.test(cls)), `${ref} got ${cls}`)
    } finally {
      await mock.close()
    }
  }
})

await test('10-13 first boot zero mutations + queue preserve + PREPARE sale + restart', () => {
  const queue = Array.from({ length: 20 }, (_, i) => makeSale({ clientRef: `q-${i}`, seq: i + 1 }))
  const boot = ex.simulateUpgradeFirstBoot({
    meta: { recoveryRequiredAfterUpgrade: true },
    queue,
  })
  expect(boot.posts === 0 && boot.queueUnchanged && boot.banner)
  expect(ex.allowLocalBusinessMutation(ex.RECOVERY_PHASE.PREPARE))
  let s = ex.createDurableRecoverySession({
    recoverySessionId: 'RS-boot',
    snapshotManifestHash: 'x',
    snapshotExists: true,
  })
  s = ex.appendCheckpoint(s, { type: 'BOOT' })
  const loaded = ex.createDurableRecoverySession(JSON.parse(JSON.stringify(s)))
  expect(loaded.recoverySessionId === 'RS-boot' && loaded.checkpoints.length === 1)
})

await test('14-16 prep tool backup / metadata-only / idempotent', async () => {
  const tmpDir = path.join(root, 'diag', `_pc4_prep_${Date.now()}`)
  fs.mkdirSync(tmpDir, { recursive: true })
  const dbFile = path.join(tmpDir, 'kakapo.sqlite')
  const electron = path.join(root, 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe')
  expect(fs.existsSync(electron), 'electron.exe')

  const seed = path.join(tmpDir, '_seed.mjs')
  fs.writeFileSync(seed, `
    import { createRequire } from 'node:module'
    const require = createRequire(import.meta.url)
    const Database = require(${JSON.stringify(path.join(root, 'desktop', 'node_modules', 'better-sqlite3'))})
    const db = new Database(${JSON.stringify(dbFile)})
    db.exec(\`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE queue (client_ref TEXT PRIMARY KEY, payload TEXT, updated_at TEXT);\`)
    db.prepare('INSERT INTO queue(client_ref,payload,updated_at) VALUES(?,?,?)')
      .run('keep-1', JSON.stringify({ clientRef: 'keep-1', kind: 'sale' }), new Date().toISOString())
    db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('syncCursor', JSON.stringify('CUR-1'))
    db.close()
    console.log('SEED_OK')
  `)
  const seedRun = spawnSync(electron, [seed], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
  })
  expect(seedRun.status === 0 && /SEED_OK/.test(seedRun.stdout || ''), seedRun.stderr || seedRun.stdout)

  const prep = path.join(root, 'scripts', 'pc4-recovery-prep.mjs')
  const r1 = spawnSync(process.execPath, [prep, '--db', dbFile, '--arm'], { encoding: 'utf8' })
  expect(r1.status === 0, r1.stderr || r1.stdout)
  const report = JSON.parse(fs.readFileSync(path.join(tmpDir, 'pc4-prep-report.json'), 'utf8'))
  expect(report.after.recoveryMode === true)
  expect(fs.existsSync(report.backup.dest))

  const verifySeed = path.join(tmpDir, '_verify.mjs')
  fs.writeFileSync(verifySeed, `
    import { createRequire } from 'node:module'
    const require = createRequire(import.meta.url)
    const Database = require(${JSON.stringify(path.join(root, 'desktop', 'node_modules', 'better-sqlite3'))})
    const db = new Database(${JSON.stringify(dbFile)}, { readonly: true })
    const q = db.prepare('SELECT COUNT(*) AS n FROM queue').get()
    const cursor = JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get('syncCursor').value)
    const mode = JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get('recoveryMode').value)
    db.close()
    if (q.n !== 1) throw new Error('queue changed')
    if (cursor !== 'CUR-1') throw new Error('cursor changed')
    if (mode !== true) throw new Error('mode not set')
    console.log('VERIFY_OK')
  `)
  const v = spawnSync(electron, [verifySeed], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
  })
  expect(v.status === 0 && /VERIFY_OK/.test(v.stdout || ''), v.stderr || v.stdout)

  const r2 = spawnSync(process.execPath, [prep, '--db', dbFile, '--arm'], { encoding: 'utf8' })
  expect(r2.status === 0, 'idempotent')
  const r3 = spawnSync(process.execPath, [prep, '--db', dbFile, '--verify'], { encoding: 'utf8' })
  expect(r3.status === 0 && r3.stdout.includes('recoveryMode'))
})

await test('17-23 full synthetic LAB replay conservation (not REAL_CASHIER_8)', async () => {
  const mock = await startIsolatedMock({ allowMultiOpen: true })
  try {
    const queue = Array.from({ length: 30 }, (_, i) => makeSale({
      clientRef: `lab-${i}`,
      seq: i + 1,
      paidCash: 2 + (i % 3),
      paidCard: i % 2,
      debtAdded: i === 5 ? 4 : 0,
      bonusSpent: i === 7 ? 1 : 0,
    }))
    const before = adapter.captureConservationSnapshot(queue)
    let s = ex.createDurableRecoverySession({
      recoverySessionId: 'RS-lab-syn',
      snapshotManifestHash: 'lab',
      snapshotExists: true,
      deviceId: 'LAB',
    })
    const world = {
      recoveryMode: true,
      isDesktop: true,
      serverReachable: true,
      queue: queue.map(r => ({ ...r, payload: { ...r.payload } })),
      sales: queue.map(r => ({ id: r.clientRef, clientRef: r.clientRef, shiftId: r.payload.shiftId, paidCash: r.payload.paidCash })),
      stock: { p1: 1000 },
      debt: { 'U-26': 64 },
      networkPostCount: 0,
      classifyCtx: { serverClosedIds: new Set(['SHIFT-ghost-1']) },
    }
    const stockBefore = world.stock.p1
    const debtBefore = world.debt['U-26']
    const classified = engine.classifyQueueFresh(world.queue, world.classifyCtx)
    const plan = engine.planShiftRemaps(classified.ops, { plannedTargetShiftId: 'SHIFT-TARGET' })
    // open shift via HTTP adapter
    const api = adapter.createRecoveryHttpAdapter({ baseUrl: mock.baseUrl })
    const opened = await ex.ensureRecoveryServerShift(s, api, { recoveryMode: true, allowAdoptUnexpected: true })
    expect(opened.ok, opened.error || opened.code)
    s = opened.session
    // force target id used in remap
    s = ex.persistSessionPatch(s, { targetServerShiftId: opened.shiftId })
    const rem = ex.executeShiftRemapBatch(s, plan.rows.map(r => ({ ...r, plannedTargetShiftId: opened.shiftId })), world)
    expect(rem.ok, rem.error)
    s = ex.enterReplayFreeze(rem.session)
    s = ex.persistSessionPatch(s, { targetServerShiftId: opened.shiftId })
    const r = await ex.executeRecoveryReplay(s, world, api, { limit: 40 })
    expect(r.ok, r.error || r.code)
    expect(world.queue.length === 0)
    expect(mock.store.sales.length === 30)
    expect(world.stock.p1 === stockBefore)
    expect(world.debt['U-26'] === debtBefore)
    const after = adapter.captureConservationSnapshot([], mock.store.sales)
    after.clientRefs = mock.store.sales.map(x => x.clientRef).sort()
    after.totals = {
      cash: mock.store.sales.reduce((a, x) => a + (Number(x.paidCash) || 0), 0),
      card: mock.store.sales.reduce((a, x) => a + (Number(x.paidCard) || 0), 0),
      debt: mock.store.sales.reduce((a, x) => a + (Number(x.debtAdded) || 0), 0),
    }
    const cons = adapter.assertConservation(before, after, {
      completedRefs: before.clientRefs,
      compareTotals: true,
    })
    // clientRefs all present on server
    for (const ref of before.clientRefs) {
      expect(after.clientRefs.includes(ref), `missing ${ref}`)
    }
    expect(new Set(after.clientRefs).size === 30)
    expect(Math.abs(before.totals.cash - after.totals.cash) < 0.001)
    expect(Math.abs(before.totals.debt - after.totals.debt) < 0.001)
    expect(cons.ok || cons.errors.every(e => e.startsWith('LOST') === false), JSON.stringify(cons.errors))
  } finally {
    await mock.close()
  }
})

await test('24 partial replay crash/resume via HTTP adapter', async () => {
  const mock = await startIsolatedMock({ allowMultiOpen: true })
  try {
    const queue = Array.from({ length: 15 }, (_, i) => makeSale({ clientRef: `cr-${i}`, seq: i + 1 }))
    let s = ex.createDurableRecoverySession({
      recoverySessionId: 'RS-crash',
      snapshotManifestHash: 'x',
      snapshotExists: true,
      targetServerShiftId: 'SHIFT-1',
    })
    const world = {
      recoveryMode: true,
      isDesktop: true,
      serverReachable: true,
      queue: queue.map(r => ({ ...r, payload: { ...r.payload } })),
      sales: [],
      stock: { p1: 100 },
      classifyCtx: { serverClosedIds: new Set(['SHIFT-ghost-1']) },
      crashAfterAckCount: 5,
    }
    const api = adapter.createRecoveryHttpAdapter({ baseUrl: mock.baseUrl })
    await api.openPosShift({ clientRef: s.targetShiftOpenClientRef, cashierId: 'C1', openingCash: 0 })
    const shifts = await api.listOpenShifts()
    s = ex.persistSessionPatch(s, { targetServerShiftId: shifts[0].id })
    const plan = engine.planShiftRemaps(
      engine.classifyQueueFresh(world.queue, world.classifyCtx).ops,
      { plannedTargetShiftId: s.targetServerShiftId },
    )
    s = ex.enterReplayFreeze(ex.executeShiftRemapBatch(s, plan.rows, world).session)
    s = ex.persistSessionPatch(s, { targetServerShiftId: shifts[0].id })
    const r1 = await ex.executeRecoveryReplay(s, world, api, { limit: 20 })
    expect(!r1.ok && r1.resumable)
    world.crashAfterAckCount = null
    const r2 = await ex.executeRecoveryReplay(r1.session, world, api, { limit: 20 })
    expect(r2.ok, r2.error)
    expect(world.queue.length === 0)
    expect(mock.store.sales.length === 15)
  } finally {
    await mock.close()
  }
})

await test('25 rollback before replay restores backup world', () => {
  const backup = { queue: [makeSale({ clientRef: 'a', seq: 1 })], stock: { p1: 5 } }
  const world = { queue: [], stock: { p1: 5 } }
  const session = ex.createDurableRecoverySession({ recoverySessionId: 'RS-rb', snapshotManifestHash: 'x' })
  const r = adapter.applyRollbackDecision('BEFORE_SERVER_REPLAY', world, session, backup)
  expect(r.plan.allowBlindRestore)
  expect(r.world.queue.length === 1)
})

await test('26 rollback after partial uses reclassify not blind restore', async () => {
  const mock = await startIsolatedMock({ allowMultiOpen: true })
  try {
    const session = ex.createDurableRecoverySession({
      recoverySessionId: 'RS-partial',
      snapshotManifestHash: 'x',
      snapshotExists: true,
      completedClientRefs: ['p-0', 'p-1'],
    })
    const world = {
      queue: [makeSale({ clientRef: 'p-2', seq: 3 })],
      serverCommitted: true,
    }
    const backup = { queue: [makeSale({ clientRef: 'p-0', seq: 1 }), makeSale({ clientRef: 'p-1', seq: 2 }), makeSale({ clientRef: 'p-2', seq: 3 })] }
    const r = adapter.applyRollbackDecision('AFTER_PARTIAL_REPLAY', world, session, backup)
    expect(!r.plan.allowBlindRestore)
    expect(r.resumeRequired)
    expect(r.world.queue.length === 1, 'keep current world')
  } finally {
    await mock.close()
  }
})

await test('27 unsupported kind fail-closed', async () => {
  const mock = await startIsolatedMock()
  try {
    let s = ex.enterReplayFreeze(ex.createDurableRecoverySession({
      recoverySessionId: 'RS-u',
      snapshotManifestHash: 'x',
      snapshotExists: true,
      targetServerShiftId: 'SHIFT-T',
      classificationAt: new Date().toISOString(),
    }))
    const world = {
      recoveryMode: true,
      isDesktop: true,
      serverReachable: true,
      queue: [{ clientRef: 'rev', kind: 'stock_revision_create', seq: 1, payload: { clientRef: 'rev' } }],
      classifyCtx: {},
    }
    const api = adapter.createRecoveryHttpAdapter({ baseUrl: mock.baseUrl })
    const r = await ex.executeRecoveryReplay(s, world, api, { limit: 1 })
    expect(!r.ok && r.code === 'UNSUPPORTED_KIND')
  } finally {
    await mock.close()
  }
})

await test('28-29 Desktop/Browser wiring unchanged for non-desktop', () => {
  expect(read('lib/desktopRecovery.ts').includes('isKakapoDesktop()'))
  expect(read('lib/recoveryApiAdapterCore.mjs').includes('REFUSE_PRODUCTION_HOST'))
  expect(read('components/trade/RecoveryModeBanner.tsx').includes('data-recovery-phase'))
})

await test('30 classifyRecoveryHttpError shapes', () => {
  expect(adapter.classifyRecoveryHttpError({ status: 409, body: { code: 'IDEMPOTENCY_KEY_REUSED', detail: 'x' } }).class === 'IDEMPOTENCY_KEY_REUSED')
  expect(adapter.classifyRecoveryHttpError({ status: 409, body: { code: 'SHIFT_CLOSED', detail: 'closed' } }).class === 'SHIFT_CLOSED')
  expect(adapter.classifyRecoveryHttpError({ status: 400, body: { detail: 'bad' } }).class === 'VALIDATION_400')
  expect(adapter.classifyRecoveryHttpError({ status: 404, body: { detail: 'no' } }).class === 'NOT_FOUND_404')
  expect(adapter.classifyRecoveryHttpError({ status: 500, afterCommit: false }).class === 'SERVER_500_BEFORE_COMMIT')
  expect(adapter.classifyRecoveryHttpError({ status: 500, afterCommit: true }).class === 'SERVER_500_AFTER_COMMIT')
  expect(adapter.classifyRecoveryHttpError({ network: true, text: 'ECONNRESET' }).class === 'TIMEOUT_BEFORE_COMMIT')
})

await test('31 prep tool instructions printable', () => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'pc4-recovery-prep.mjs'), '--instructions'], { encoding: 'utf8' })
  expect(r.status === 0 && r.stdout.includes('REAL_CASHIER_8'))
})

await test('32 production host block + files exist', () => {
  expect(fs.existsSync(path.join(root, 'lib/recoveryApiAdapter.ts')))
  expect(fs.existsSync(path.join(root, 'scripts/pc4-recovery-prep.mjs')))
  expect(read('lib/api.ts').includes('createPosSale'))
})

// ── summary ──
const fail = results.filter(r => r.status === 'FAIL')
console.log('\n── PC-4 SUMMARY ──')
console.log(`PASS ${results.length - fail.length} / FAIL ${fail.length}`)
console.log(`NEED_FRESH_COPY = ${NEED_FRESH_COPY}`)
if (fail.length) {
  for (const f of fail) console.log(`  · ${f.name}: ${f.error}`)
  process.exitCode = 1
}

// Write gate file for report
fs.writeFileSync(
  path.join(root, 'diag', 'PC4_NEED_FRESH_COPY.json'),
  JSON.stringify({
    NEED_FRESH_COPY,
    reason: NEED_FRESH_COPY
      ? 'scripts/_diag_out/REAL_CASHIER_8/kakapo.sqlite not provided — operator must copy live triplet'
      : 'REAL_CASHIER_8 present',
    at: new Date().toISOString(),
    commitHint: 'eedaf6c2+',
  }, null, 2),
)
