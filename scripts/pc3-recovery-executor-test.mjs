/**
 * PC-3 — Live-safe recovery executor tests (disposable / mock API only).
 * Run: node scripts/pc3-recovery-executor-test.mjs
 * NEVER touches production cashier, PostgreSQL, or REAL_CASHIER_7 source.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const results = []

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

const ex = await import(pathToFileURL(path.join(root, 'lib/desktopRecoveryExecutorCore.mjs')).href)
const engine = await import(pathToFileURL(path.join(root, 'lib/desktopRecoveryEngineCore.mjs')).href)

function makeSaleOp(opts) {
  const items = opts.items || [{ productId: 1, qty: 1, price: 10 }]
  const paidCash = opts.paidCash != null ? opts.paidCash : items.reduce((a, i) => a + i.qty * i.price, 0)
  return {
    clientRef: opts.clientRef,
    kind: opts.kind || 'sale',
    seq: opts.seq,
    localId: opts.localId || `off-sale-${opts.seq}`,
    createdAtIso: opts.createdAtIso || '2026-09-16T03:00:00.000Z',
    attempts: 0,
    failed: !!opts.failed,
    lastError: opts.lastError,
    payload: {
      clientRef: opts.clientRef,
      shiftId: opts.shiftId,
      items,
      paidCash,
      paidCard: opts.paidCard || 0,
      debtAdded: opts.debtAdded || 0,
      bonusSpent: opts.bonusSpent || 0,
      appliedLocal: opts.appliedLocal !== false,
      clientId: opts.clientId,
      num: opts.num,
      ...(opts.payloadExtra || {}),
    },
  }
}

function baseSession(extra = {}) {
  return ex.createDurableRecoverySession({
    recoverySessionId: 'RS-pc3-test',
    deviceId: 'DEV-1',
    dbIdentity: 'db-sha-1',
    snapshotManifestHash: 'snap-sha-1',
    snapshotExists: true,
    phase: ex.RECOVERY_PHASE.PREPARE,
    ...extra,
  })
}

function worldFromQueue(queue, extra = {}) {
  return {
    recoveryMode: true,
    isDesktop: true,
    serverReachable: true,
    queue: queue.map(r => ({ ...r, payload: { ...r.payload } })),
    sales: queue.filter(r => r.kind === 'sale').map(r => ({
      id: r.localId,
      clientRef: r.clientRef,
      shiftId: r.payload.shiftId,
      paidCash: r.payload.paidCash,
    })),
    stock: { p1: 1000 },
    debt: { 'U-26': 64, 'U-37': 207.85 },
    shifts: [
      { id: 'SHIFT-ghost-1', status: 'open' },
      { id: 'SHIFT-ghost-2', status: 'open' },
    ],
    networkPostCount: 0,
    classifyCtx: {
      serverClosedIds: new Set(['SHIFT-ghost-1', 'SHIFT-ghost-2', 'SHIFT-ghost-3']),
      serverByClientRef: new Map(),
    },
    ...extra,
  }
}

await test('S1 executor core + façade files exist', () => {
  expect(fs.existsSync(path.join(root, 'lib/desktopRecoveryExecutorCore.mjs')))
  expect(fs.existsSync(path.join(root, 'lib/desktopRecoveryExecutor.ts')))
  expect(read('lib/desktopRecovery.ts').includes('recoveryRequiredAfterUpgrade'))
  expect(read('lib/offlinePosOps.ts').includes('RECOVERY_REPLAY_FREEZE'))
  expect(read('components/trade/RecoveryModeBanner.tsx').includes('data-recovery-phase'))
})

await test('S2 kind safety matrix covers production kinds', () => {
  const m = ex.kindSafetyMatrix()
  const kinds = new Set(m.map(r => r.kind))
  for (const k of ['sale', 'stock_receipt_create', 'debt_repay', 'cash_advance', 'card_topup', 'finance_move', 'sale_return']) {
    expect(kinds.has(k), k)
    expect(ex.isKindReplaySupported(k), `replay ${k}`)
  }
  expect(!ex.isKindReplaySupported('stock_revision_create'), 'revision blocked')
  expect(!ex.isKindReplaySupported('totally_unknown_kind'), 'unknown blocked')
})

await test('1 upgrade old DB with 100 queue → zero POST first boot', () => {
  const queue = []
  for (let i = 0; i < 100; i++) {
    queue.push(makeSaleOp({ clientRef: `u-${i}`, seq: i + 1, shiftId: 'SHIFT-ghost-1' }))
  }
  const r = ex.simulateUpgradeFirstBoot({
    meta: { recoveryRequiredAfterUpgrade: true },
    queue,
  })
  expect(r.recoveryActive && r.skipped && r.posts === 0, JSON.stringify(r))
  expect(r.queueUnchanged && r.banner)
})

await test('2 durable session restart preserves id/status/checkpoint', () => {
  let s = baseSession()
  s = ex.appendCheckpoint(s, { type: 'CLASSIFY', total: 10 })
  s = ex.persistSessionPatch(s, { status: ex.SESSION_STATUS.CLASSIFIED })
  const json = JSON.parse(JSON.stringify(s))
  const loaded = ex.createDurableRecoverySession(json)
  expect(loaded.recoverySessionId === 'RS-pc3-test')
  expect(loaded.status === 'CLASSIFIED')
  expect(loaded.checkpoints.length === 1)
  expect(loaded.snapshotManifestHash === 'snap-sha-1')
})

await test('3 queue grows during RECOVERY_PREPARE — delta detected', () => {
  const q1 = [makeSaleOp({ clientRef: 'a', seq: 1, shiftId: 'SHIFT-ghost-1' })]
  let s = baseSession({ queueWatermark: ex.queueWatermark(q1) })
  const q2 = [
    ...q1,
    ...Array.from({ length: 50 }, (_, i) => makeSaleOp({
      clientRef: `new-${i}`,
      seq: 100 + i,
      shiftId: 'off-recovery-RS-pc3-test',
    })),
  ]
  const r = ex.classifyFreshWithDelta(s, q2, { serverClosedIds: new Set(['SHIFT-ghost-1']) })
  expect(r.delta && r.delta.watermarkChanged, 'delta')
  expect(r.delta.countDelta === 50)
  expect(r.classified.total === 51)
})

await test('4 final freeze watermark stable + blocks new sales policy', () => {
  expect(ex.allowLocalBusinessMutation(ex.RECOVERY_PHASE.PREPARE))
  expect(!ex.allowLocalBusinessMutation(ex.RECOVERY_PHASE.REPLAY))
  expect(ex.allowLocalBusinessMutation(ex.RECOVERY_PHASE.COMPLETE))
  const s = ex.enterReplayFreeze(baseSession())
  expect(s.phase === ex.RECOVERY_PHASE.REPLAY)
  expect(s.status === ex.SESSION_STATUS.REPLAYING)
})

await test('5 exact ACK cleanup', () => {
  const row = makeSaleOp({ clientRef: 'ack-1', seq: 1, shiftId: 'SHIFT-ghost-1', paidCash: 5 })
  const fp = engine.businessPayloadFingerprint('sale', row.payload)
  const world = worldFromQueue([row], {
    classifyCtx: {
      serverByClientRef: new Map([['ack-1', { id: 'SALE-1', fingerprint: fp, kind: 'sale' }]]),
      serverClosedIds: new Set(),
    },
  })
  const classified = engine.classifyPendingOpFresh(row, world.classifyCtx)
  expect(classified.ackEligible)
  const r = ex.executeVerifiedAckCleanup(baseSession(), { ...classified, clientRef: 'ack-1', seq: 1, serverId: 'SALE-1' }, world)
  expect(r.ok, r.error)
  expect(world.queue.length === 0)
  expect(r.verify.networkPostCount === 0)
  expect(r.verify.salePreserved)
})

await test('6 mismatch ACK refused', () => {
  const row = makeSaleOp({ clientRef: 'ack-bad', seq: 1, shiftId: 'S', paidCash: 5 })
  const world = worldFromQueue([row])
  const r = ex.executeVerifiedAckCleanup(baseSession(), {
    classification: 'ALREADY_COMMITTED_SERVER',
    ackEligible: false,
    clientRef: 'ack-bad',
    seq: 1,
    serverId: 'X',
  }, world)
  expect(!r.ok && r.error === 'not_ack_eligible')
  expect(world.queue.length === 1)
})

await test('7 target shift timeout-after-commit adopts same clientRef', async () => {
  const api = ex.createMockRecoveryApi()
  const clientRef = 'recovery-open-RS-pc3-test'
  api.state.failModes[clientRef] = 'timeout_after_commit'
  const s = baseSession()
  const r = await ex.ensureRecoveryServerShift(s, api, { recoveryMode: true, isDesktop: true })
  expect(r.ok && r.adoptedAfterTimeout, JSON.stringify(r))
  expect(r.shiftId)
  expect(r.session.targetServerShiftId === r.shiftId)
  expect(api.state.shifts.filter(x => x.clientRef === clientRef).length === 1)
})

await test('8 target shift duplicate retry same ref', async () => {
  const api = ex.createMockRecoveryApi()
  const s = baseSession()
  const r1 = await ex.ensureRecoveryServerShift(s, api, { recoveryMode: true })
  expect(r1.ok)
  const r2 = await ex.ensureRecoveryServerShift(r1.session, api, { recoveryMode: true })
  expect(r2.ok && r2.adopted)
  expect(r2.shiftId === r1.shiftId)
  expect(api.state.shifts.length === 1)
})

await test('9 unexpected server open shift stops', async () => {
  const api = ex.createMockRecoveryApi({ allowMultiOpen: true })
  api.state.shifts.push({ id: 'SHIFT-OTHER', status: 'open', clientRef: 'other-open' })
  const r = await ex.ensureRecoveryServerShift(baseSession(), api, { recoveryMode: true })
  expect(!r.ok && r.code === ex.STOP_NEEDS_OPERATOR)
})

await test('10 100 sale replay exactly-once', async () => {
  const queue = []
  for (let i = 0; i < 100; i++) {
    queue.push(makeSaleOp({ clientRef: `sale-${i}`, seq: i + 1, shiftId: 'SHIFT-ghost-1', paidCash: 1 + (i % 7) }))
  }
  let s = baseSession({ targetServerShiftId: 'SHIFT-TARGET' })
  s = ex.enterReplayFreeze(s)
  // remap all
  const classified = engine.classifyQueueFresh(queue, { serverClosedIds: new Set(['SHIFT-ghost-1']) })
  const plan = engine.planShiftRemaps(classified.ops, { plannedTargetShiftId: 'SHIFT-TARGET' })
  const world = worldFromQueue(queue)
  world.stock = { p1: 5000 }
  const stockBefore = world.stock.p1
  const remap = ex.executeShiftRemapBatch(s, plan.rows, world)
  expect(remap.ok, remap.error)
  s = remap.session
  s = ex.enterReplayFreeze(s)
  const api = ex.createMockRecoveryApi({ allowMultiOpen: true })
  api.state.shifts.push({ id: 'SHIFT-TARGET', status: 'open', clientRef: 'recovery-open-RS-pc3-test' })
  const r = await ex.executeRecoveryReplay(s, world, api, { limit: 100 })
  expect(r.ok, r.error || r.code)
  expect(world.queue.length === 0, `left=${world.queue.length}`)
  expect(api.state.sales.length === 100)
  expect(world.stock.p1 === stockBefore, 'no double stock')
  expect(new Set(api.state.sales.map(x => x.clientRef)).size === 100)
})

await test('11 crash after 1/20/99 sales then resume', async () => {
  for (const crashAt of [1, 20, 99]) {
    const queue = Array.from({ length: 100 }, (_, i) =>
      makeSaleOp({ clientRef: `c${crashAt}-${i}`, seq: i + 1, shiftId: 'SHIFT-ghost-1' }))
    let s = baseSession({ recoverySessionId: `RS-crash-${crashAt}`, targetServerShiftId: 'SHIFT-T' })
    const world = worldFromQueue(queue)
    const plan = engine.planShiftRemaps(
      engine.classifyQueueFresh(queue, { serverClosedIds: new Set(['SHIFT-ghost-1']) }).ops,
      { plannedTargetShiftId: 'SHIFT-T' },
    )
    const rem = ex.executeShiftRemapBatch(s, plan.rows, world)
    s = ex.enterReplayFreeze(rem.session)
    world.crashAfterAckCount = crashAt
    const api = ex.createMockRecoveryApi({ allowMultiOpen: true })
    api.state.shifts.push({ id: 'SHIFT-T', status: 'open', clientRef: s.targetShiftOpenClientRef })
    const r1 = await ex.executeRecoveryReplay(s, world, api, { limit: 100 })
    expect(!r1.ok && r1.resumable, `crashAt=${crashAt} ${r1.error}`)
    expect((r1.session.completedClientRefs || []).length === crashAt)
    world.crashAfterAckCount = null
    const r2 = await ex.executeRecoveryReplay(r1.session, world, api, { limit: 100 })
    expect(r2.ok, r2.error)
    expect(world.queue.length === 0)
    expect(api.state.sales.length === 100)
  }
})

await test('12-13 receipt replay + timeout-after-commit', async () => {
  const receipt = {
    clientRef: 'rcp-1',
    kind: 'stock_receipt_create',
    seq: 1,
    payload: {
      clientRef: 'rcp-1',
      items: [{ productId: 1, qty: 5, price: 2 }],
      appliedLocal: true,
      supplierId: 'SUP-1',
    },
  }
  let s = ex.enterReplayFreeze(baseSession({ targetServerShiftId: 'SHIFT-T' }))
  const world = worldFromQueue([receipt], { stock: { p1: 10 } })
  const stockBefore = world.stock.p1
  const api = ex.createMockRecoveryApi({ allowMultiOpen: true })
  api.state.shifts.push({ id: 'SHIFT-T', status: 'open', clientRef: s.targetShiftOpenClientRef })
  api.state.failModes['rcp-1'] = 'timeout_after_commit'
  const r = await ex.executeRecoveryReplay(s, world, api, { limit: 5, requireTargetShift: false })
  expect(r.ok, r.error || r.code)
  expect(world.queue.length === 0)
  expect(api.state.receipts.length === 1)
  expect(world.stock.p1 === stockBefore)
})

await test('14 sale SHIFT_CLOSED after remap → stop', async () => {
  const row = makeSaleOp({ clientRef: 'sc-1', seq: 1, shiftId: 'SHIFT-ghost-1' })
  let s = baseSession({ targetServerShiftId: 'SHIFT-T' })
  const world = worldFromQueue([row])
  const plan = engine.planShiftRemaps(
    engine.classifyQueueFresh([row], { serverClosedIds: new Set(['SHIFT-ghost-1']) }).ops,
    { plannedTargetShiftId: 'SHIFT-T' },
  )
  s = ex.executeShiftRemapBatch(s, plan.rows, world).session
  s = ex.enterReplayFreeze(s)
  const api = ex.createMockRecoveryApi({ allowMultiOpen: true })
  api.state.shifts.push({ id: 'SHIFT-T', status: 'open', clientRef: s.targetShiftOpenClientRef })
  api.state.failModes['sc-1'] = 'SHIFT_CLOSED'
  const r = await ex.executeRecoveryReplay(s, world, api, { limit: 1 })
  expect(!r.ok && r.code === 'STOP_CHAIN')
  expect(world.queue.length === 1, 'poison not deleted')
})

await test('15-18 stock/debt/split/loyalty preserved on remap+replay', async () => {
  const row = makeSaleOp({
    clientRef: 'rich-1',
    seq: 1,
    shiftId: 'SHIFT-ghost-1',
    paidCash: 3,
    paidCard: 4,
    debtAdded: 5,
    bonusSpent: 2,
    clientId: 'U-26',
    num: '486',
  })
  const fp0 = engine.businessPayloadFingerprint('sale', row.payload)
  let s = baseSession({ targetServerShiftId: 'SHIFT-T' })
  const world = worldFromQueue([row], { stock: { p1: 99 }, debt: { 'U-26': 64 } })
  const plan = engine.planShiftRemaps(
    engine.classifyQueueFresh([row], { serverClosedIds: new Set(['SHIFT-ghost-1']) }).ops,
    { plannedTargetShiftId: 'SHIFT-T' },
  )
  const rem = ex.executeShiftRemapBatch(s, plan.rows, world)
  expect(rem.ok)
  const fp1 = engine.businessPayloadFingerprint('sale', world.queue[0].payload)
  expect(fp0 === fp1)
  s = ex.enterReplayFreeze(rem.session)
  const api = ex.createMockRecoveryApi({ allowMultiOpen: true })
  api.state.shifts.push({ id: 'SHIFT-T', status: 'open', clientRef: s.targetShiftOpenClientRef })
  const debtBefore = world.debt['U-26']
  const stockBefore = world.stock.p1
  const r = await ex.executeRecoveryReplay(s, world, api, { limit: 1 })
  expect(r.ok, r.error)
  expect(world.stock.p1 === stockBefore)
  expect(world.debt['U-26'] === debtBefore)
  expect(api.state.sales[0].payload.paidCash === 3)
  expect(api.state.sales[0].payload.paidCard === 4)
  expect(api.state.sales[0].payload.bonusSpent === 2)
})

await test('19-24 return/writeoff/debt_repay/cash_advance/finance/card_topup', async () => {
  const kinds = [
    { kind: 'sale_return', clientRef: 'ret-1', payloadExtra: { amount: 1 } },
    { kind: 'stock_writeoff_create', clientRef: 'wo-1', payloadExtra: { items: [{ productId: 1, qty: 1 }] } },
    { kind: 'debt_repay', clientRef: 'dr-1', payloadExtra: { amount: 10, num: '486' } },
    { kind: 'cash_advance', clientRef: 'ca-1', payloadExtra: { amount: 5, num: '486' } },
    { kind: 'finance_move', clientRef: 'fm-1', payloadExtra: { amount: 2, type: 'in' } },
    { kind: 'card_topup', clientRef: 'ct-1', payloadExtra: { amount: 7, num: '486' } },
  ]
  const queue = kinds.map((k, i) => ({
    clientRef: k.clientRef,
    kind: k.kind,
    seq: i + 1,
    payload: { clientRef: k.clientRef, appliedLocal: true, ...k.payloadExtra },
  }))
  let s = ex.enterReplayFreeze(baseSession({ targetServerShiftId: 'SHIFT-T' }))
  const world = worldFromQueue(queue)
  const api = ex.createMockRecoveryApi({ allowMultiOpen: true })
  api.state.shifts.push({ id: 'SHIFT-T', status: 'open', clientRef: s.targetShiftOpenClientRef })
  const r = await ex.executeRecoveryReplay(s, world, api, { limit: 10, requireTargetShift: false })
  expect(r.ok, r.error || r.code)
  expect(world.queue.length === 0)
})

await test('25 unsupported kind fail-closed', async () => {
  const row = {
    clientRef: 'rev-1',
    kind: 'stock_revision_create',
    seq: 1,
    payload: { clientRef: 'rev-1', id: 'REV-1' },
  }
  let s = ex.enterReplayFreeze(baseSession({ targetServerShiftId: 'SHIFT-T' }))
  const world = worldFromQueue([row])
  const api = ex.createMockRecoveryApi({ allowMultiOpen: true })
  const r = await ex.executeRecoveryReplay(s, world, api, { limit: 1 })
  expect(!r.ok && r.code === 'UNSUPPORTED_KIND')
  expect(world.queue.length === 1)
})

await test('26 pull forbidden before drain', () => {
  const s = baseSession({ status: ex.SESSION_STATUS.REPLAYING })
  const r = ex.executeCanonicalPull(s, worldFromQueue([]), { clients: [] })
  expect(!r.ok && r.error === 'pull_forbidden_before_drain')
})

await test('27-28 canonical pull after drain + U26/U37 baseline verify', () => {
  let s = baseSession({
    status: ex.SESSION_STATUS.PULL_READY,
    targetServerShiftId: 'SHIFT-T',
    completedClientRefs: ['sale-0'],
  })
  const world = worldFromQueue([])
  const snap = {
    clients: [
      { id: 'U-26', debt: 64 },
      { id: 'U-37', debt: 207.85 },
    ],
    cards: [],
    products: [],
    stock: { p1: 100 },
    sales: [{ clientRef: 'sale-0', id: 'SALE-1' }],
    shifts: [{ id: 'SHIFT-T', status: 'open' }],
    debt: {},
    verifyDebt: { 'U-26': 64, 'U-37': 207.85 },
  }
  const r = ex.executeCanonicalPull(s, world, snap)
  expect(r.ok, JSON.stringify(r.checks))
  expect(r.session.pullCompleted)
  expect(world.clients.find(c => c.id === 'U-26').debt === 64)
})

await test('29 ghost shifts finalized without shift_close POST', () => {
  let s = baseSession({ targetServerShiftId: 'SHIFT-T', completedClientRefs: ['a'] })
  const world = worldFromQueue([])
  world.shifts = [
    { id: 'SHIFT-ghost-1', status: 'open' },
    { id: 'SHIFT-ghost-2', status: 'open' },
    { id: 'SHIFT-T', status: 'open' },
  ]
  const r = ex.finalizeGhostShifts(s, world, ['SHIFT-ghost-1', 'SHIFT-ghost-2'])
  expect(r.ok && r.targetRemainsOpen)
  expect(world.shifts.find(x => x.id === 'SHIFT-ghost-1').status === 'closed')
  expect(world.networkPostCount === 0 || world.networkPostCount == null)
})

await test('30 recovery cannot disable early', () => {
  const s = baseSession({ status: ex.SESSION_STATUS.REPLAYING })
  const gate = ex.canDisableRecovery(s, { queue: [makeSaleOp({ clientRef: 'x', seq: 1, shiftId: 'S' })] })
  expect(!gate.ok)
})

await test('31 completed recovery can disable', () => {
  const s = baseSession({
    status: ex.SESSION_STATUS.COMPLETED,
    phase: ex.RECOVERY_PHASE.COMPLETE,
    pullCompleted: true,
    ghostFinalized: true,
  })
  const gate = ex.canDisableRecovery(s, { queue: [] })
  expect(gate.ok, JSON.stringify(gate.errors))
})

await test('32 normal Desktop sync after recovery (policy)', () => {
  expect(ex.allowLocalBusinessMutation(ex.RECOVERY_PHASE.COMPLETE))
  const boot = ex.simulateUpgradeFirstBoot({ meta: { recoveryMode: false, recoveryCompleted: true }, queue: [] })
  expect(!boot.recoveryActive)
})

await test('33 browser unchanged — recovery gates desktop-only', () => {
  const src = read('lib/desktopRecovery.ts')
  expect(src.includes('isKakapoDesktop()'))
  expect(read('lib/desktopRecoveryExecutor.ts').includes('isKakapoDesktop'))
})

await test('34 Android unchanged — no android recovery force', () => {
  expect(!read('lib/desktopRecovery.ts').includes('isTradeAndroidNative'))
  expect(!read('lib/desktopRecoveryExecutor.ts').includes('androidPersist'))
})

await test('35 sale exactly-once matrix: lost/dup/500/idempotency', async () => {
  const cases = [
    { ref: 'e-lost', mode: 'lost_response' },
    { ref: 'e-500b', mode: '500_before_commit' },
    { ref: 'e-500a', mode: '500_after_commit' },
  ]
  for (const c of cases) {
    const row = makeSaleOp({ clientRef: c.ref, seq: 1, shiftId: 'SHIFT-ghost-1' })
    let s = baseSession({ targetServerShiftId: 'SHIFT-T', recoverySessionId: `RS-${c.ref}` })
    const world = worldFromQueue([row])
    const plan = engine.planShiftRemaps(
      engine.classifyQueueFresh([row], { serverClosedIds: new Set(['SHIFT-ghost-1']) }).ops,
      { plannedTargetShiftId: 'SHIFT-T' },
    )
    s = ex.enterReplayFreeze(ex.executeShiftRemapBatch(s, plan.rows, world).session)
    const api = ex.createMockRecoveryApi({ allowMultiOpen: true })
    api.state.shifts.push({ id: 'SHIFT-T', status: 'open', clientRef: s.targetShiftOpenClientRef })
    api.state.failModes[c.ref] = c.mode
    const r = await ex.executeRecoveryReplay(s, world, api, { limit: 5 })
    expect(r.ok, `${c.ref} ${r.error || r.code}`)
    expect(api.state.sales.filter(x => x.clientRef === c.ref).length === 1, c.ref)
    expect(world.queue.length === 0, c.ref)
  }
  // different payload conflict
  {
    const row = makeSaleOp({ clientRef: 'e-confl', seq: 1, shiftId: 'SHIFT-T', paidCash: 1 })
    let s = ex.enterReplayFreeze(baseSession({ targetServerShiftId: 'SHIFT-T' }))
    const world = worldFromQueue([row], { classifyCtx: { serverClosedIds: new Set() } })
    const api = ex.createMockRecoveryApi({ allowMultiOpen: true })
    api.state.shifts.push({ id: 'SHIFT-T', status: 'open', clientRef: s.targetShiftOpenClientRef })
    const fpOther = engine.businessPayloadFingerprint('sale', { ...row.payload, paidCash: 99 })
    api.state.byRef.set('e-confl', { kind: 'sale', id: 'SALE-x', fingerprint: fpOther, clientRef: 'e-confl' })
    api.state.failModes['e-confl'] = null
    // force idempotency on create
    const orig = api.createPosSale
    api.createPosSale = async (p) => {
      throw new Error('IDEMPOTENCY_KEY_REUSED')
    }
    const r = await ex.executeRecoveryReplay(s, world, api, { limit: 1 })
    expect(!r.ok && (r.code === 'CONFLICT' || /CONFLICT/.test(r.session.stoppedReason || '')), JSON.stringify(r))
    expect(world.queue.length === 1)
  }
})

await test('36 preconditions refuse when recovery off / no snapshot', () => {
  const s = baseSession({ snapshotManifestHash: null, snapshotExists: false })
  const pre = ex.assertRecoveryPreconditions({ recoveryMode: false, session: s, isDesktop: true })
  expect(!pre.ok)
  const pre2 = ex.assertRecoveryPreconditions({ recoveryMode: true, session: s, isDesktop: true })
  expect(!pre2.ok && pre2.errors.includes('missing_snapshot'))
})

await test('37 post-drain verify → PULL_READY', () => {
  let s = baseSession({
    targetServerShiftId: 'SHIFT-T',
    completedClientRefs: ['a'],
    checkpoints: [
      { type: 'REPLAY_INTENT', clientRef: 'a' },
      { type: 'REPLAY_ACKED', clientRef: 'a' },
    ],
  })
  const world = worldFromQueue([])
  const r = ex.verifyPostDrain(s, world, { serverSales: [{ clientRef: 'a' }] })
  expect(r.ok && r.pullReady, JSON.stringify(r.errors))
})

await test('38 REAL_CASHIER_7 source SHA unchanged', () => {
  const src = path.join(root, 'scripts', '_diag_out', 'REAL_CASHIER_7', 'kakapo.sqlite')
  expect(fs.existsSync(src), 'fixture exists')
  const h = createHash('sha256').update(fs.readFileSync(src)).digest('hex').toUpperCase()
  expect(h === '2EC00CF7CDAC3123B95701F35C32EF28A4BE300B37C3F636E19A0597E32B869B', h)
})

await test('39 new sales during PREPARE use recovery shift id pattern', () => {
  const sessionId = 'RS-pc3-test'
  const rid = engine.recoveryShiftId(sessionId)
  expect(rid.startsWith('off-recovery-'))
  const ensured = engine.ensureLocalRecoveryShift([], { sessionId }, { cashierId: 'C1' })
  expect(ensured.shiftId === rid)
})

await test('40 refuse replay without freeze', async () => {
  const s = baseSession({ targetServerShiftId: 'SHIFT-T', status: ex.SESSION_STATUS.CLASSIFIED, classificationAt: new Date().toISOString() })
  const world = worldFromQueue([makeSaleOp({ clientRef: 'z', seq: 1, shiftId: 'SHIFT-T' })])
  const api = ex.createMockRecoveryApi()
  const r = await ex.executeRecoveryReplay(s, world, api, { limit: 1 })
  expect(!r.ok && r.code === 'REFUSE_PHASE')
})

// ── summary ──
const fail = results.filter(r => r.status === 'FAIL')
console.log('\n── PC-3 SUMMARY ──')
console.log(`PASS ${results.length - fail.length} / FAIL ${fail.length}`)
if (fail.length) {
  for (const f of fail) console.log(`  · ${f.name}: ${f.error}`)
  process.exitCode = 1
}
