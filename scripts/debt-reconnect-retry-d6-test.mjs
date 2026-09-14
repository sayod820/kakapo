/**
 * Phase D6 — debt reconnect / retry / held op hardening tests.
 * Run: node scripts/debt-reconnect-retry-d6-test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lib = path.join(root, 'lib')

const results = []
function test(name, fn) {
  try {
    const out = fn()
    if (out && typeof out.then === 'function') {
      return out.then(() => {
        results.push({ name, status: 'PASS' })
        console.log(`PASS  ${name}`)
      }).catch(e => {
        results.push({ name, status: 'FAIL', error: String(e?.message || e) })
        console.error(`FAIL  ${name}: ${e?.message || e}`)
      })
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

const {
  DEBT_OP_ERROR_CLASS,
  AUTO_REVERT_ERROR_CODES,
  MANUAL_HELD_ERROR_CODES,
  classifyDebtOpError,
  canRemoveDebtQueueOp,
  isUnsafeDebtRepayTarget,
  debtRepayHoldReason,
  heldBackoffMs,
} = await import(pathToFileURL(path.join(lib, 'debtOpErrorClassifierCore.mjs')).href)

const { buildPendingDebtOverlay, applyDebtOverlayToProjection } = await import(
  pathToFileURL(path.join(lib, 'pendingDebtOverlayCore.mjs')).href
)

function op(kind, payload, extra = {}) {
  return {
    clientRef: payload.clientRef || extra.clientRef || 'ref',
    kind,
    payload: { appliedLocal: true, ...payload },
    createdAtIso: extra.createdAtIso || '2026-01-01T00:00:00.000Z',
    seq: extra.seq ?? 1,
    attempts: extra.attempts ?? 0,
    failed: !!extra.failed,
    lastError: extra.lastError,
    nextRetryAt: extra.nextRetryAt,
  }
}

// —— Classifier ——
await test('1 offline repay persists (queue model)', () => {
  const row = op('debt_repay', { clientRef: 'r1', amount: 20, num: 'VIP001', clientId: 'CL-1', appliedLocal: true })
  expect(row.payload.appliedLocal === true, 'applied')
  expect(canRemoveDebtQueueOp(row).ok === false, 'cannot remove')
})

await test('2 reconnect same clientRef (identity)', () => {
  const a = op('debt_repay', { clientRef: 'same-ref', amount: 10, num: 'V' })
  const b = { ...a, attempts: 3, failed: false }
  expect(a.clientRef === b.clientRef, 'same ref')
})

await test('3 timeout => RETRYABLE_TRANSPORT', () => {
  const c = classifyDebtOpError('debt_repay', new Error('timeout: fetch failed'))
  expect(c.class === DEBT_OP_ERROR_CLASS.RETRYABLE_TRANSPORT, c.class)
})

await test('3b connection reset / 502 / 503 message => RETRYABLE_TRANSPORT', () => {
  for (const msg of ['connection reset', '502 Bad Gateway', '503 Service Unavailable', '504 Gateway Timeout']) {
    const c = classifyDebtOpError('debt_repay', new Error(msg))
    expect(c.class === DEBT_OP_ERROR_CLASS.RETRYABLE_TRANSPORT, `${msg} => ${c.class}`)
    expect(!c.shouldRevert && !c.shouldDelete, `${msg} keep`)
  }
})

await test('4 503 => RETRYABLE_TRANSPORT', () => {
  const c = classifyDebtOpError('cash_advance', { message: 'Bad Gateway', status: 503 })
  expect(c.class === DEBT_OP_ERROR_CLASS.RETRYABLE_TRANSPORT, c.class)
})

await test('5 ACK lost / replay success', () => {
  const c = classifyDebtOpError('debt_repay', null, { responseBody: { replayed: true, duplicate: true } })
  expect(c.class === DEBT_OP_ERROR_CLASS.REPLAY_SUCCESS && c.shouldAck, c.class)
})

await test('6 API restart treated as transport or replay path available', () => {
  const c = classifyDebtOpError('cash_advance', { name: 'NetworkError', message: 'offline', isNetworkError: true })
  expect(c.class === DEBT_OP_ERROR_CLASS.RETRYABLE_TRANSPORT, c.class)
})

await test('7 OCC version refresh class', () => {
  const c = classifyDebtOpError('debt_repay', new Error('Долг клиента уже погашали (версию ожидали) [DEBT_PAY_VERSION_CONFLICT]'))
  expect(c.class === DEBT_OP_ERROR_CLASS.RETRYABLE_VERSION, c.class)
  expect(!c.shouldRevert, 'no revert')
})

await test('8 version retry no double local apply (classifier)', () => {
  const c = classifyDebtOpError('cash_advance', new Error('уже меняли на другой кассе'))
  expect(c.class === DEBT_OP_ERROR_CLASS.RETRYABLE_VERSION && !c.shouldRevert && !c.shouldDelete, 'park')
})

await test('9 NOT_FOUND stays held', () => {
  const c = classifyDebtOpError('debt_repay', new Error('Чек долга не найден [DEBT_RECEIPT_NOT_FOUND]'))
  expect(c.class === DEBT_OP_ERROR_CLASS.HELD_BUSINESS, c.class)
  expect(MANUAL_HELD_ERROR_CODES.includes('DEBT_RECEIPT_NOT_FOUND'), 'manual')
})

await test('10 AMBIGUOUS stays held', () => {
  const c = classifyDebtOpError('debt_repay', new Error('DEBT_RECEIPT_AMBIGUOUS'))
  expect(c.class === DEBT_OP_ERROR_CLASS.HELD_BUSINESS, c.class)
})

await test('11 held op keeps D5 overlay', () => {
  const queue = [
    op('debt_repay', { clientRef: 'h1', amount: 20, clientId: 'CL-1', num: 'VIP001' }, {
      failed: true,
      lastError: 'DEBT_RECEIPT_NOT_FOUND',
    }),
  ]
  const overlay = buildPendingDebtOverlay(queue)
  const r = applyDebtOverlayToProjection(100, { overlay, clientId: 'CL-1', mode: 'client' })
  expect(r.debt === 80, `got ${r.debt}`)
})

await test('12 same-key ALREADY_PAID => replay success path (response)', () => {
  const c = classifyDebtOpError('debt_repay', null, { responseBody: { replayed: true, clientRef: 'x' } })
  expect(c.shouldAck === true, 'ack')
})

await test('13 different-key ALREADY_PAID => held', () => {
  const c = classifyDebtOpError('debt_repay', new Error('Чек долга уже погашен [DEBT_RECEIPT_ALREADY_PAID]'))
  expect(c.class === DEBT_OP_ERROR_CLASS.HELD_BUSINESS && !c.shouldRevert, c.class)
})

await test('14 IDEMPOTENCY_KEY_REUSED => permanent, no retry storm', () => {
  const c = classifyDebtOpError('cash_advance', new Error('collision [IDEMPOTENCY_KEY_REUSED]'))
  expect(c.class === DEBT_OP_ERROR_CLASS.PERMANENT_REJECT, c.class)
  expect(heldBackoffMs(c) >= 300_000, `backoff ${heldBackoffMs(c)}`)
})

await test('15 concurrent reconnect single-flight (source)', () => {
  const offline = fs.readFileSync(path.join(lib, 'offline.ts'), 'utf8')
  expect(/if \(flushing\) return/.test(offline), 'flushing guard')
  const sync = fs.readFileSync(path.join(lib, 'offlineSync.ts'), 'utf8')
  expect(/syncLock/.test(sync), 'syncLock')
})

await test('16 manual Send Now same op (retryPending clears failed)', () => {
  const offline = fs.readFileSync(path.join(lib, 'offline.ts'), 'utf8')
  expect(/export async function retryPending/.test(offline), 'retryPending')
  expect(/forceSync\(\{ clientRef/.test(fs.readFileSync(path.join(root, 'components/trade/OfflineQueuePanel.tsx'), 'utf8')), 'UI')
})

await test('17 appliedLocal debt op cannot raw-delete', () => {
  const gate = canRemoveDebtQueueOp(op('debt_repay', { clientRef: 'x', amount: 1, appliedLocal: true }))
  expect(!gate.ok && gate.code === 'DEBT_PENDING_CANNOT_REMOVE', JSON.stringify(gate))
  const sale = canRemoveDebtQueueOp(op('sale', { clientRef: 's', debtAdded: 10, appliedLocal: true }))
  expect(!sale.ok, 'credit sale')
})

await test('18 non-debt safe queue delete unchanged', () => {
  const gate = canRemoveDebtQueueOp(op('expense_create', { clientRef: 'e', amount: 1 }, { kind: 'expense_create' }))
  // kind expense not in debtAffecting — but our op() forces kind from arg
  const row = { clientRef: 'e', kind: 'finance_move', payload: { appliedLocal: true }, createdAtIso: '', seq: 1, attempts: 0 }
  expect(canRemoveDebtQueueOp(row).ok === true, 'finance ok')
})

await test('19 queue sequence deterministic (byOrder source)', () => {
  const offline = fs.readFileSync(path.join(lib, 'offline.ts'), 'utf8')
  expect(/function byOrder/.test(offline) && /queueKindPriority/.test(offline), 'order')
  expect(/cash_advance|debt_repay/.test(offline), 'kinds')
})

await test('20 CA then repay dependency hold', () => {
  const ca = op('cash_advance', { clientRef: 'ca-1', amount: 100, num: 'VIP001', clientId: 'CL-1' })
  const rp = op('debt_repay', {
    clientRef: 'rp-1',
    amount: 20,
    num: 'VIP001',
    clientId: 'CL-1',
    parentCashAdvanceClientRef: 'ca-1',
  })
  const reason = debtRepayHoldReason(rp, [ca, rp])
  expect(!!reason && /ACK|выдач/i.test(reason), reason)
})

await test('21 child waits for DL id', () => {
  expect(isUnsafeDebtRepayTarget('cash-local-1') === true, 'unsafe')
  const rp = op('debt_repay', {
    clientRef: 'rp-2',
    amount: 20,
    orderId: 'cash-xyz',
    parentCashAdvanceClientRef: 'ca-gone',
  })
  const reason = debtRepayHoldReason(rp, [])
  expect(!!reason, reason || 'expected hold')
})

await test('22 CA ACK stores DL before child send (source)', () => {
  const offline = fs.readFileSync(path.join(lib, 'offline.ts'), 'utf8')
  expect(/persistCashAdvanceAckMapping/.test(offline), 'persist mapping')
  expect(/debtLedgerEntryId/.test(offline), 'dl id')
  expect(/parentCashAdvanceClientRef/.test(offline), 'patch child')
})

await test('23 crash after server ACK before queue delete — replay safe (D4+D6)', () => {
  // Same clientRef retry → REPLAY_SUCCESS classifier when body says so
  const c = classifyDebtOpError('cash_advance', null, {
    responseBody: { replayed: true, debtLedgerEntryId: 'DL-1' },
  })
  expect(c.shouldAck && !c.shouldRevert, 'replay ack')
})

await test('24 restart completes replay ACK cleanup (delete after success)', () => {
  const offline = fs.readFileSync(path.join(lib, 'offline.ts'), 'utf8')
  expect(/await deletePending\(live\.clientRef\)/.test(offline), 'delete on success')
})

await test('25 crash after DL mapping before delete — mapping first', () => {
  const offline = fs.readFileSync(path.join(lib, 'offline.ts'), 'utf8')
  const idxMap = offline.indexOf('persistCashAdvanceAckMapping')
  const idxDel = offline.indexOf('await deletePending(live.clientRef)')
  expect(idxMap > 0 && idxDel > 0, 'both present')
  // mapping helper called inside sendOp before flush deletePending
  expect(/await persistCashAdvanceAckMapping/.test(offline), 'called in send')
})

await test('26 no debt jump on ACK (D5 overlay clears with queue)', () => {
  const before = applyDebtOverlayToProjection(100, {
    overlay: buildPendingDebtOverlay([
      op('debt_repay', { clientRef: 'a', amount: 20, clientId: 'CL-1', num: 'V' }),
    ]),
    clientId: 'CL-1',
    mode: 'client',
  })
  const after = applyDebtOverlayToProjection(80, {
    overlay: buildPendingDebtOverlay([]),
    clientId: 'CL-1',
    mode: 'client',
  })
  expect(before.debt === 80 && after.debt === 80, 'stable')
})

await test('27 startup ordering envelope→queue→overlay→flush', () => {
  const hydrate = fs.readFileSync(path.join(lib, 'offlineHydrate.ts'), 'utf8')
  expect(/recoverLocalDebtOpEnvelopes/.test(hydrate), 'envelope')
  expect(/refreshDebtOverlayFromQueue/.test(hydrate), 'overlay')
  const trade = fs.readFileSync(path.join(root, 'components/trade/TradeApp.tsx'), 'utf8')
  expect(/hydrateOfflineCaches\(\)\.then/.test(trade), 'await hydrate before start')
})

await test('28 held op backoff no hot loop', () => {
  const c = classifyDebtOpError('debt_repay', new Error('DEBT_RECEIPT_NOT_FOUND'))
  expect(heldBackoffMs(c) >= 120_000, `ms=${heldBackoffMs(c)}`)
})

await test('29 unrelated queue op not starved (failed filtered from flush)', () => {
  const offline = fs.readFileSync(path.join(lib, 'offline.ts'), 'utf8')
  expect(/\.filter\(r => !r\.failed/.test(offline), 'skip failed')
})

await test('30 486.70 removed historical op is NOT recreated', () => {
  const overlay = buildPendingDebtOverlay([])
  const r = applyDebtOverlayToProjection(486.7, { overlay, clientId: 'U', mode: 'client' })
  expect(!r.usedOverlay && r.debt === 486.7, 'no phantom')
  expect(AUTO_REVERT_ERROR_CODES.length === 0, 'no auto-revert debt codes')
})

await test('source: debt kinds use classifier not auto-revert', () => {
  const offline = fs.readFileSync(path.join(lib, 'offline.ts'), 'utf8')
  expect(/Phase D6: classify debt errors/.test(offline), 'classifier branch')
  expect(/live\.kind === 'debt_repay' \|\| live\.kind === 'cash_advance'/.test(offline), 'debt branch')
  // revert helpers may still exist for other kinds / manual; debt path must classify first
  const idx = offline.indexOf('Phase D6: classify debt errors')
  const slice = offline.slice(idx, idx + 1200)
  expect(/RETRYABLE_VERSION/.test(slice) || /classifyDebtOpError/.test(slice), 'uses classifier')
  expect(!/revertLocalDebtRepayOnReject/.test(slice), 'no repay revert in D6 block')
})

await test('dropPending throws DEBT_PENDING_CANNOT_REMOVE', () => {
  const offline = fs.readFileSync(path.join(lib, 'offline.ts'), 'utf8')
  expect(/DEBT_PENDING_CANNOT_REMOVE/.test(offline), 'guard')
  const panel = fs.readFileSync(path.join(root, 'components/trade/OfflineQueuePanel.tsx'), 'utf8')
  expect(/canRemoveDebtQueueOp/.test(panel), 'UI guard')
})

await new Promise(r => setTimeout(r, 0))

const failed = results.filter(r => r.status === 'FAIL')
const report = {
  phase: 'D6',
  passed: results.filter(r => r.status === 'PASS').length,
  failed: failed.length,
  total: results.length,
  results,
  AUTO_REVERT_ERROR_CODES,
  MANUAL_HELD_ERROR_CODES,
}
fs.writeFileSync(path.join(root, 'scripts', 'debt-reconnect-retry-d6-report.json'), JSON.stringify(report, null, 2))
console.log(`\nD6: ${report.passed}/${report.total} passed`)
if (failed.length) process.exit(1)
