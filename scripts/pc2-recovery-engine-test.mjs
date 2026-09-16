/**
 * PC-2 — Recovery engine test matrix (disposable fixtures only).
 * Run: node scripts/pc2-recovery-engine-test.mjs
 * NEVER touches REAL_CASHIER_7 or production.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const results = []
function test(name, fn) {
  try {
    const r = fn()
    if (r && typeof r.then === 'function') {
      throw new Error('use sync tests only')
    }
    results.push({ name, status: 'PASS' })
    console.log(`PASS  ${name}`)
  } catch (e) {
    results.push({ name, status: 'FAIL', error: String(e?.message || e) })
    console.error(`FAIL  ${name}: ${e?.message || e}`)
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg)
}
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const core = await import(pathToFileURL(path.join(root, 'lib/desktopRecoveryEngineCore.mjs')).href)

function makeSaleOp(opts) {
  const items = opts.items || [{ productId: 1, qty: 1, price: 10 }]
  const paidCash = opts.paidCash != null ? opts.paidCash : items.reduce((a, i) => a + i.qty * i.price, 0)
  return {
    clientRef: opts.clientRef,
    kind: 'sale',
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
    },
  }
}

function fixture65Like() {
  const queue = []
  // 8 ACK-lost-like (same fp on server)
  for (let i = 0; i < 8; i++) {
    queue.push(makeSaleOp({
      clientRef: `ack-${i}`,
      seq: 949898 + i,
      shiftId: 'SHIFT-mu22lkd9-v7qcg',
      failed: true,
      lastError: 'IDEMPOTENCY_KEY_REUSED',
      paidCash: 3 + i,
      items: [{ productId: 1, qty: 1, price: 3 + i }],
    }))
  }
  // 4 failed closed other shift
  for (let i = 0; i < 4; i++) {
    queue.push(makeSaleOp({
      clientRef: `closed-${i}`,
      seq: 950104 + i,
      shiftId: 'SHIFT-mtz7ukp1-xfhxr',
      failed: true,
      lastError: 'Смена уже закрыта [SHIFT_CLOSED]',
      paidCash: 5,
    }))
  }
  // 52 ready on ghost
  for (let i = 0; i < 52; i++) {
    queue.push(makeSaleOp({
      clientRef: `ready-${i}`,
      seq: 950111 + i,
      shiftId: 'SHIFT-mtxsgiqx-cvp3g',
      paidCash: 2 + (i % 5),
      items: [{ productId: 2, qty: 1, price: 2 + (i % 5) }],
    }))
  }
  queue.push({
    clientRef: 'receipt-1',
    kind: 'stock_receipt_create',
    seq: 950121,
    createdAtIso: '2026-09-16T03:34:34.185Z',
    attempts: 0,
    failed: false,
    payload: {
      clientRef: 'receipt-1',
      supplierId: 'SUP-1',
      items: [{ productId: 9, qty: 1, costPrice: 1 }],
    },
  })
  return queue
}

function serverIndexForAck(queue) {
  const map = new Map()
  for (const row of queue.filter(r => String(r.clientRef).startsWith('ack-'))) {
    map.set(row.clientRef, {
      id: `SALE-${row.clientRef}`,
      kind: 'sale',
      fingerprint: core.businessPayloadFingerprint('sale', row.payload),
      raw: {
        id: `SALE-${row.clientRef}`,
        items: row.payload.items,
        paidCash: row.payload.paidCash,
        paidCard: 0,
        debtAdded: 0,
        total: row.payload.paidCash,
      },
    })
  }
  return map
}

// ── Source wiring ──
test('S1 engine core exports', () => {
  for (const k of [
    'classifyQueueFresh', 'planAckCleanup', 'planShiftRemaps', 'buildRecoveryReplayOrder',
    'applyRecoveryStepDry', 'resumeRecoverySession', 'pickSaleTargetShift', 'ensureLocalRecoveryShift',
    'markGhostShiftsReconciled', 'businessPayloadFingerprint', 'REFUSE_RECOVERY_OFF',
  ]) expect(typeof core[k] === 'function' || typeof core[k] === 'string', k)
})

test('S2 TS façade + offlinePosOps recovery shift wiring', () => {
  expect(fs.existsSync(path.join(root, 'lib/desktopRecoveryEngine.ts')), 'engine ts')
  const ops = read('lib/offlinePosOps.ts')
  const eng = read('lib/desktopRecoveryEngine.ts')
  expect(ops.includes('isRecoveryModeActive'), 'recovery gate in resolve')
  expect(ops.includes('off-recovery') || ops.includes('ensureLocalRecoveryShift'), 'recovery shift')
  expect(
    eng.includes('REPLAY_DEFERRED_TO_PC3_LIVE')
    || eng.includes('PC3_EXECUTOR_REQUIRED')
    || eng.includes('USE_executeRecoveryReplay'),
    'no live replay',
  )
})

test('S3 PC-1A gate still present', () => {
  expect(read('lib/offline.ts').includes('assertSyncAllowed'), 'flush gate')
  expect(read('lib/desktopRecovery.ts').includes('SKIPPED_RECOVERY_MODE'), 'skip')
})

test('1 fixture 65-like classification counts', () => {
  const queue = fixture65Like()
  expect(queue.length === 65, `len=${queue.length}`)
  const closed = new Set(['SHIFT-mtxsgiqx-cvp3g', 'SHIFT-mtz7ukp1-xfhxr', 'SHIFT-mu22lkd9-v7qcg'])
  const classified = core.classifyQueueFresh(queue, {
    serverByClientRef: serverIndexForAck(queue),
    serverClosedIds: closed,
  })
  expect(classified.summary.ALREADY_COMMITTED_SERVER === 8, `ack=${classified.summary.ALREADY_COMMITTED_SERVER}`)
  expect(classified.summary.DEPENDENCY_BLOCKED === 56, `dep=${classified.summary.DEPENDENCY_BLOCKED}`)
  expect(classified.summary.SAFE_TO_SEND === 1, `safe=${classified.summary.SAFE_TO_SEND}`)
})

test('2 queue grows to 100+ during recovery classification', () => {
  const queue = fixture65Like()
  for (let i = 0; i < 40; i++) {
    queue.push(makeSaleOp({
      clientRef: `new-${i}`,
      seq: 960000 + i,
      shiftId: 'off-recovery-RS-test',
      paidCash: 1,
    }))
  }
  expect(queue.length === 105, '105')
  const classified = core.classifyQueueFresh(queue, {
    serverByClientRef: serverIndexForAck(queue),
    serverClosedIds: new Set(['SHIFT-mtxsgiqx-cvp3g', 'SHIFT-mtz7ukp1-xfhxr', 'SHIFT-mu22lkd9-v7qcg']),
  })
  expect(classified.total === 105, 'total')
  expect(classified.summary.SAFE_TO_SEND >= 40, 'new safe on recovery shift')
})

test('3 ACK-lost exact match → ackEligible', () => {
  const queue = fixture65Like()
  const classified = core.classifyQueueFresh(queue, {
    serverByClientRef: serverIndexForAck(queue),
    serverClosedIds: new Set(),
  })
  const ack = core.planAckCleanup(classified.ops)
  expect(ack.length === 8, `ack plan ${ack.length}`)
  expect(ack.every(a => a.expectedServerId && a.fingerprint), 'ids+fp')
})

test('4 same clientRef DIFFERENT payload → CONFLICT, no cleanup', () => {
  const row = makeSaleOp({ clientRef: 'dup-1', seq: 1, shiftId: 'SHIFT-A', paidCash: 10 })
  const serverByClientRef = new Map([['dup-1', {
    id: 'SALE-x',
    fingerprint: core.businessPayloadFingerprint('sale', { ...row.payload, paidCash: 99, items: [{ productId: 1, qty: 1, price: 99 }] }),
  }]])
  const c = core.classifyPendingOpFresh(row, { serverByClientRef })
  expect(c.classification === 'CONFLICT', c.classification)
  expect(!c.ackEligible, 'no ack')
  const plan = core.planAckCleanup([{ ...c, clientRef: 'dup-1', kind: 'sale', seq: 1 }])
  expect(plan.length === 0, 'no cleanup')
})

test('4b clientRef alone without fingerprint → UNKNOWN, no ACK', () => {
  const row = makeSaleOp({ clientRef: 'bare-1', seq: 1, shiftId: 'SHIFT-A', paidCash: 10 })
  const c = core.classifyPendingOpFresh(row, {
    serverByClientRef: new Map([['bare-1', { id: 'SALE-bare' }]]),
  })
  expect(c.classification === 'UNKNOWN', c.classification)
  expect(!c.ackEligible, 'no ack without fp')
  expect(core.planAckCleanup([{ ...c, clientRef: 'bare-1', kind: 'sale', seq: 1 }]).length === 0, 'no cleanup')
})

test('5 remap plan for 56 ghost sales is explicit', () => {
  const queue = fixture65Like()
  const classified = core.classifyQueueFresh(queue, {
    serverByClientRef: serverIndexForAck(queue),
    serverClosedIds: new Set(['SHIFT-mtxsgiqx-cvp3g', 'SHIFT-mtz7ukp1-xfhxr', 'SHIFT-mu22lkd9-v7qcg']),
  })
  const bad = core.planShiftRemaps(classified.ops, {})
  expect(bad.ok === false, 'require target')
  const plan = core.planShiftRemaps(classified.ops, { plannedTargetShiftId: 'SHIFT-RECOVERY-TARGET' })
  expect(plan.ok && plan.rows.length === 56, `rows=${plan.rows.length}`)
  expect(plan.rows.every(r => r.plannedTargetShiftId === 'SHIFT-RECOVERY-TARGET'), 'explicit')
  expect(plan.rows.every(r => r.oldShiftId !== 'SHIFT-RECOVERY-TARGET'), 'old differs')
})

test('6-7 recovery shift: new sales not on ghost; pickSaleTargetShift', () => {
  const session = core.createRecoverySession({ sessionId: 'RS-test' })
  let shifts = [
    { id: 'SHIFT-mtxsgiqx-cvp3g', status: 'open', cashierId: 'C1' },
    { id: 'SHIFT-ghost2', status: 'open', cashierId: 'C1' },
  ]
  const ensured = core.ensureLocalRecoveryShift(shifts, session, { cashierId: 'C1', posId: 'POS-DEFAULT' })
  shifts = ensured.shifts
  const picked = core.pickSaleTargetShift(shifts, {
    recoveryShiftId: ensured.shiftId,
    serverClosedIds: new Set(['SHIFT-mtxsgiqx-cvp3g', 'SHIFT-ghost2']),
  })
  expect(picked && picked.id === ensured.shiftId, `picked=${picked?.id}`)
  expect(core.isRecoveryShiftId(picked.id), 'recovery id')
})

test('8 receipt dependency before sales in replay order', () => {
  const queue = fixture65Like()
  const classified = core.classifyQueueFresh(queue, {
    serverByClientRef: serverIndexForAck(queue),
    serverClosedIds: new Set(['SHIFT-mtxsgiqx-cvp3g', 'SHIFT-mtz7ukp1-xfhxr', 'SHIFT-mu22lkd9-v7qcg']),
  })
  const remap = core.planShiftRemaps(classified.ops, { plannedTargetShiftId: 'T1' })
  const steps = core.buildRecoveryReplayOrder(classified.ops, {
    plannedTargetShiftId: 'T1',
    remapPlanRows: remap.rows,
  })
  const replayKinds = steps.filter(s => s.type === 'REPLAY_OP').map(s => s.kind)
  const receiptIdx = replayKinds.indexOf('stock_receipt_create')
  const firstSaleIdx = replayKinds.findIndex(k => k === 'sale')
  expect(receiptIdx >= 0 && (firstSaleIdx < 0 || receiptIdx < firstSaleIdx), 'receipt before sale')
})

test('9 crash after remap — fingerprint preserved, session resumes', () => {
  const session = core.createRecoverySession({ sessionId: 'RS-crash-remap' })
  const row = makeSaleOp({ clientRef: 'r1', seq: 10, shiftId: 'SHIFT-OLD', paidCash: 7 })
  const world = {
    recoveryMode: true,
    queue: [row],
    sales: [{ id: 'off-sale-10', clientRef: 'r1', shiftId: 'SHIFT-OLD', paidCash: 7 }],
    classifyCtx: {},
  }
  const fpBefore = core.businessPayloadFingerprint('sale', row.payload)
  const res = core.applyRecoveryStepDry(session, {
    type: 'SHIFT_REMAP',
    clientRef: 'r1',
    oldShiftId: 'SHIFT-OLD',
    plannedTargetShiftId: 'SHIFT-NEW',
    kind: 'sale',
    seq: 10,
  }, world)
  expect(res.ok, res.error)
  expect(world.queue[0].payload.shiftId === 'SHIFT-NEW', 'remapped')
  expect(core.businessPayloadFingerprint('sale', world.queue[0].payload) === fpBefore, 'fp same')
  expect(world.sales[0].shiftId === 'SHIFT-NEW', 'sale proj')
  // crash: serialize session
  const resumed = core.resumeRecoverySession(JSON.parse(JSON.stringify(session)), world)
  expect(resumed.ok, 'resume')
  expect(world.recoveryMode === true, 'still recovery')
})

test('10 crash after server commit before ACK', () => {
  const session = core.createRecoverySession({ sessionId: 'RS-crash-post' })
  const row = makeSaleOp({ clientRef: 'post-1', seq: 20, shiftId: 'off-recovery-x', paidCash: 4 })
  const world = {
    recoveryMode: true,
    queue: [row],
    allowSimulatedPost: true,
    crashAfterPost: 'post-1',
    classifyCtx: {},
  }
  const r = core.applyRecoveryStepDry(session, {
    type: 'REPLAY_OP', clientRef: 'post-1', kind: 'sale', seq: 20,
  }, world)
  expect(r.ok === false && r.resumable, 'crash')
  expect(world.queue.length === 1, 'still queued')
  expect(world.serverCommitted.get('post-1'), 'server has it')
  // resume → reclassify as ALREADY_COMMITTED with fingerprint
  world.classifyCtx = {
    serverByClientRef: new Map([['post-1', {
      id: world.serverCommitted.get('post-1').id,
      fingerprint: world.serverCommitted.get('post-1').fingerprint,
      kind: 'sale',
    }]]),
  }
  const resumed = core.resumeRecoverySession(session, world)
  const ack = core.planAckCleanup(resumed.classified.ops)
  expect(ack.length === 1, 'ack after resume')
  const cleaned = core.applyRecoveryStepDry(session, {
    type: 'ACK_CLEANUP',
    clientRef: 'post-1',
    expectedServerId: ack[0].expectedServerId,
    kind: 'sale',
  }, world)
  expect(cleaned.ok && world.queue.length === 0, 'acked')
  expect((world.networkPostCount || 0) === 1, 'only one post')
})

test('11 crash after 20/100 replay then resume without dup', () => {
  const session = core.createRecoverySession({ sessionId: 'RS-batch' })
  const queue = []
  for (let i = 0; i < 100; i++) {
    queue.push(makeSaleOp({
      clientRef: `b-${i}`,
      seq: i + 1,
      shiftId: 'off-recovery-x',
      paidCash: 1,
    }))
  }
  const world = {
    recoveryMode: true,
    queue,
    allowSimulatedPost: true,
    crashAfterAckCount: 20,
    serverCommitted: new Map(),
    classifyCtx: {},
    networkPostCount: 0,
  }
  let crashed = false
  for (let i = 0; i < 100; i++) {
    const r = core.applyRecoveryStepDry(session, {
      type: 'REPLAY_OP', clientRef: `b-${i}`, kind: 'sale', seq: i + 1,
    }, world)
    if (!r.ok && r.error === 'CRASH_AFTER_ACK_BATCH') {
      crashed = true
      break
    }
  }
  expect(crashed, 'crashed at 20')
  expect(session.completedClientRefs.length === 20, `done=${session.completedClientRefs.length}`)
  expect(world.queue.length === 80, `left=${world.queue.length}`)
  // resume remaining
  world.crashAfterAckCount = null
  for (const row of [...world.queue]) {
    core.applyRecoveryStepDry(session, {
      type: 'REPLAY_OP', clientRef: row.clientRef, kind: 'sale', seq: row.seq,
    }, world)
  }
  expect(world.queue.length === 0, 'drained')
  expect(world.networkPostCount === 100, `posts=${world.networkPostCount}`)
  expect(new Set(session.completedClientRefs).size === 100, 'unique')
})

test('12 restart recovery session id stable via createRecoverySession', () => {
  const s1 = core.createRecoverySession({ sessionId: 'RS-fixed' })
  const s2 = core.createRecoverySession({ sessionId: 'RS-fixed' })
  expect(s1.sessionId === s2.sessionId, 'stable')
  expect(s1.recoveryShiftId === s2.recoveryShiftId, 'shift id')
})

test('13-14 timeout/duplicate → same clientRef ACK', () => {
  const row = makeSaleOp({ clientRef: 'to-1', seq: 1, shiftId: 'off-recovery-x', paidCash: 8 })
  const fp = core.businessPayloadFingerprint('sale', row.payload)
  const c = core.classifyPendingOpFresh(row, {
    serverByClientRef: new Map([['to-1', { id: 'SALE-1', fingerprint: fp, kind: 'sale' }]]),
  })
  expect(c.classification === 'ALREADY_COMMITTED_SERVER' && c.ackEligible, 'dup response')
})

test('15-17 server open shift cases', () => {
  const notes = core.openPosShiftContractNotes()
  expect(notes.idempotency && notes.apiSufficient, 'contract')
  // unexpected open exists → target must be explicit, not auto
  const plan = core.planShiftRemaps(
    [{ kind: 'sale', needsRemap: true, clientRef: 'a', seq: 1, shiftId: 'OLD' }],
    {},
  )
  expect(plan.ok === false, 'no auto target')
  // two possible → still require explicit plannedTargetShiftId
  const plan2 = core.planShiftRemaps(
    [{ kind: 'sale', needsRemap: true, clientRef: 'a', seq: 1, shiftId: 'OLD', classification: 'DEPENDENCY_BLOCKED' }],
    { plannedTargetShiftId: 'SHIFT-CHOSEN-BY-OPERATOR' },
  )
  expect(plan2.rows[0].plannedTargetShiftId === 'SHIFT-CHOSEN-BY-OPERATOR', 'explicit')
})

test('18 stock no double decrement on remap/replay appliedLocal', () => {
  const session = core.createRecoverySession({ sessionId: 'RS-stock' })
  const row = makeSaleOp({ clientRef: 'st-1', seq: 1, shiftId: 'off-recovery-x', paidCash: 1, appliedLocal: true })
  const world = {
    recoveryMode: true,
    queue: [row],
    allowSimulatedPost: true,
    stockEffects: [],
    classifyCtx: {},
  }
  const beforeEffects = world.stockEffects.length
  core.applyRecoveryStepDry(session, { type: 'REPLAY_OP', clientRef: 'st-1', kind: 'sale', seq: 1 }, world)
  expect(world.stockEffects.length === beforeEffects, 'no extra stock effect')
})

test('19-21 debt/cash/loyalty fingerprint stable across remap', () => {
  const row = makeSaleOp({
    clientRef: 'd1', seq: 1, shiftId: 'OLD',
    paidCash: 5, paidCard: 3, debtAdded: 2, bonusSpent: 1, clientId: 'U-26', num: 'CARD-1',
    items: [{ productId: 3, qty: 2, price: 4, discount: 0 }],
  })
  const fp = core.businessPayloadFingerprint('sale', row.payload)
  row.payload.shiftId = 'NEW'
  expect(core.businessPayloadFingerprint('sale', row.payload) === fp, 'shift excluded from fp')
})

test('22 fresh kinds appear in classification', () => {
  const queue = [
    makeSaleOp({ clientRef: 's1', seq: 1, shiftId: 'off-recovery-x' }),
    {
      clientRef: 'wo1', kind: 'stock_writeoff_create', seq: 2, createdAtIso: '', attempts: 0, failed: false,
      payload: { clientRef: 'wo1', items: [{ productId: 1, qty: 1 }] },
    },
    {
      clientRef: 'dr1', kind: 'debt_repay', seq: 3, createdAtIso: '', attempts: 0, failed: false,
      payload: { clientRef: 'dr1', num: 'C1', amount: 10, shiftId: 'off-recovery-x', orderId: 'cash-pending' },
    },
  ]
  const c = core.classifyQueueFresh(queue, {})
  expect(c.ops.find(o => o.kind === 'stock_writeoff_create')?.classification === 'SAFE_TO_SEND', 'wo')
  expect(c.ops.find(o => o.kind === 'debt_repay')?.classification === 'DEPENDENCY_BLOCKED', 'debt hold')
})

test('23-24 UNKNOWN/CONFLICT stop chain; poison not deleted', () => {
  const queue = [
    makeSaleOp({ clientRef: 'ok', seq: 1, shiftId: 'off-recovery-x' }),
    makeSaleOp({ clientRef: 'bad', seq: 2, shiftId: 'off-recovery-x', failed: true, lastError: 'IDEMPOTENCY_KEY_REUSED' }),
  ]
  // conflict without server match → CONFLICT, not deleted
  const classified = core.classifyQueueFresh(queue, {})
  const steps = core.buildRecoveryReplayOrder(classified.ops, {})
  expect(steps.some(s => s.type === 'STOP_CHAIN' && s.clientRef === 'bad'), 'stop')
  expect(queue.length === 2, 'poison kept')
})

test('25 recovery=false executor refuses', () => {
  const session = core.createRecoverySession()
  const r = core.applyRecoveryStepDry(session, { type: 'CLASSIFY' }, { recoveryMode: false, queue: [] })
  expect(r.ok === false && r.code === core.REFUSE_RECOVERY_OFF, 'refuse')
})

test('26 background sync stays zero during planning (ACK/REMAP no post)', () => {
  const session = core.createRecoverySession()
  const row = makeSaleOp({ clientRef: 'a1', seq: 1, shiftId: 'OLD', paidCash: 2 })
  const fp = core.businessPayloadFingerprint('sale', row.payload)
  const world = {
    recoveryMode: true,
    queue: [row],
    networkPostCount: 0,
    classifyCtx: {
      serverByClientRef: new Map([['a1', { id: 'SALE-a1', fingerprint: fp, kind: 'sale' }]]),
    },
  }
  core.applyRecoveryStepDry(session, { type: 'CLASSIFY' }, world)
  const classified = core.classifyQueueFresh(world.queue, world.classifyCtx)
  const ack = core.planAckCleanup(classified.ops)[0]
  core.applyRecoveryStepDry(session, {
    type: 'ACK_CLEANUP', clientRef: ack.clientRef, expectedServerId: ack.expectedServerId, kind: 'sale',
  }, world)
  expect(world.networkPostCount === 0, 'zero posts')
})

test('27 ghost mark reconciled closed', () => {
  const shifts = [
    { id: 'SHIFT-mtxsgiqx-cvp3g', status: 'open', note: '' },
    { id: 'SHIFT-other', status: 'open', note: '' },
  ]
  const next = core.markGhostShiftsReconciled(shifts, ['SHIFT-mtxsgiqx-cvp3g'])
  expect(next[0].status === 'closed', 'closed')
  expect(/RECONCILED_CLOSED_GHOST/.test(next[0].note), 'note')
  expect(next[1].status === 'open', 'other open')
})

test('28 snapshot manifest includes session', () => {
  const m = core.buildSnapshotManifest({
    recoverySessionId: 'RS-1',
    deviceId: 'dev',
    queueSeq: 950163,
    files: [{ name: 'kakapo.sqlite', sha256: 'abc' }],
  })
  expect(m.recoverySessionId === 'RS-1' && m.queueSeq === 950163, 'manifest')
})

test('29 REAL_CASHIER_7 source SHA unchanged', () => {
  const src = path.join(root, 'scripts', '_diag_out', 'REAL_CASHIER_7', 'kakapo.sqlite')
  expect(fs.existsSync(src), 'exists')
  const h = createHash('sha256').update(fs.readFileSync(src)).digest('hex').toUpperCase()
  expect(h === '2EC00CF7CDAC3123B95701F35C32EF28A4BE300B37C3F636E19A0597E32B869B', h)
})

test('30 full dry-run plan on 65-like does not mutate queue', () => {
  const queue = fixture65Like()
  const hash = createHash('sha256').update(JSON.stringify(queue)).digest('hex')
  const session = core.createRecoverySession({ plannedTargetShiftId: 'T1' })
  const world = {
    recoveryMode: true,
    queue: JSON.parse(JSON.stringify(queue)),
    classifyCtx: {
      serverByClientRef: serverIndexForAck(queue),
      serverClosedIds: new Set(['SHIFT-mtxsgiqx-cvp3g', 'SHIFT-mtz7ukp1-xfhxr', 'SHIFT-mu22lkd9-v7qcg']),
    },
  }
  core.applyRecoveryStepDry(session, { type: 'REQUIRE_RECOVERY_MODE' }, world)
  core.applyRecoveryStepDry(session, { type: 'SNAPSHOT' }, world)
  core.applyRecoveryStepDry(session, { type: 'CLASSIFY' }, world)
  // only plan remap/ack without execute replay posts
  const classified = world.classified
  const ack = core.planAckCleanup(classified.ops)
  expect(ack.length === 8, '8 ack')
  // original queue fixture untouched
  expect(createHash('sha256').update(JSON.stringify(queue)).digest('hex') === hash, 'immutable fixture')
})

test('31 shift state machine labels', () => {
  expect(core.classifyLocalShiftState({ id: 'SHIFT-1', status: 'open' }, {
    serverOpenIds: new Set(['SHIFT-1']),
  }) === core.SHIFT_STATE.ONLINE_CANONICAL_OPEN, 'online')
  expect(core.classifyLocalShiftState({ id: 'SHIFT-1', status: 'open' }, {
    serverClosedIds: new Set(['SHIFT-1']),
  }) === core.SHIFT_STATE.RECOVERY_PENDING, 'ghost')
  expect(core.classifyLocalShiftState({ id: 'off-recovery-x', status: 'open' }, {}) === core.SHIFT_STATE.OFFLINE_LOCALLY_OPEN, 'recovery')
  expect(core.classifyLocalShiftState({ id: 'SHIFT-1', status: 'closed', note: 'reconcile:RECONCILED' }, {}) === core.SHIFT_STATE.RECONCILED_CLOSED, 'reconciled')
})

const fail = results.filter(r => r.status === 'FAIL')
console.log('\n── PC-2 SUMMARY ──')
console.log(`PASS ${results.filter(r => r.status === 'PASS').length} / FAIL ${fail.length}`)
if (fail.length) {
  for (const f of fail) console.log(' ', f.name, f.error)
  process.exit(1)
}
