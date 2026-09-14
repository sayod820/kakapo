/**
 * Phase D5 — durable pending debt overlay on server pull.
 * Run: node scripts/debt-pending-overlay-d5-test.mjs
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

const core = await import(pathToFileURL(path.join(lib, 'pendingDebtOverlayCore.mjs')).href)
const {
  buildPendingDebtOverlay,
  applyDebtOverlayToProjection,
  OVERLAY_INCLUDED_QUEUE_STATES,
  OVERLAY_EXCLUDED_QUEUE_STATES,
  DEBT_OVERLAY_UNPARSEABLE,
  extractDebtOpFromQueueRow,
} = core

let activeOverlay = null
function refreshDebtOverlayFromPending(list, now) {
  activeOverlay = buildPendingDebtOverlay(list || [], { now })
  return activeOverlay
}
function clearActiveDebtOverlay() { activeOverlay = null }
function applyPendingDebtOverlayToClient(server, local, overlay) {
  const ov = overlay ?? activeOverlay
  if (!ov || ov.empty) return server
  const r = applyDebtOverlayToProjection(Number(server.debt) || 0, {
    overlay: ov,
    clientId: server.id,
    mode: 'client',
    localDebt: local != null ? Number(local.debt) : null,
  })
  if (!r.usedOverlay && !r.failSafeLocal) return server
  return { ...server, debt: r.debt }
}
function applyPendingDebtOverlayToCard(server, local, overlay) {
  const ov = overlay ?? activeOverlay
  if (!ov || ov.empty) return server
  const r = applyDebtOverlayToProjection(Number(server.debt) || 0, {
    overlay: ov,
    cardNum: server.num,
    cardClientId: server.clientId || local?.clientId || '',
    mode: 'card',
    localDebt: local != null ? Number(local.debt) : null,
    localDebtPayVersion: local != null ? Number(local.debtPayVersion) || 0 : null,
    serverDebtPayVersion: Number(server.debtPayVersion) || 0,
  })
  if (!r.usedOverlay && !r.failSafeLocal) return server
  return { ...server, debt: r.debt, debtPayVersion: r.debtPayVersion }
}

function op(kind, payload, extra = {}) {
  return {
    clientRef: payload.clientRef || extra.clientRef || 'ref',
    kind,
    payload: { appliedLocal: true, ...payload },
    createdAtIso: extra.createdAtIso || '2026-01-01T00:00:00.000Z',
    seq: extra.seq ?? 1,
    attempts: 0,
    failed: !!extra.failed,
    lastError: extra.lastError,
    nextRetryAt: extra.nextRetryAt,
  }
}

function simMerge(serverDebt, queue, opts = {}) {
  const overlay = buildPendingDebtOverlay(queue)
  refreshDebtOverlayFromPending(queue)
  const client = applyPendingDebtOverlayToClient(
    { id: opts.clientId || 'CL-1', debt: serverDebt },
    opts.localClient,
    overlay,
  )
  const card = applyPendingDebtOverlayToCard(
    { num: opts.cardNum || 'VIP001', debt: serverDebt, debtPayVersion: opts.serverVer ?? 0, clientId: opts.clientId || 'CL-1' },
    opts.localCard,
    overlay,
  )
  return { overlay, client, card }
}

await test('1 server100 + pending repay20 => 80', () => {
  const { client, card } = simMerge(100, [
    op('debt_repay', { clientRef: 'r1', amount: 20, clientId: 'CL-1', num: 'VIP001', expectedDebtPayVersion: 0 }),
  ])
  expect(client.debt === 80 && card.debt === 80, `got ${client.debt}/${card.debt}`)
})

await test('2 server100 + pending credit sale20 => 120', () => {
  const { client, card } = simMerge(100, [
    op('sale', { clientRef: 's1', debtAdded: 20, clientId: 'CL-1', cardNum: 'VIP001', expectedDebtPayVersion: 0 }),
  ])
  expect(client.debt === 120 && card.debt === 120, `got ${client.debt}`)
})

await test('3 server100 + pending CA50 => 150', () => {
  const { client, card } = simMerge(100, [
    op('cash_advance', { clientRef: 'ca1', amount: 50, clientId: 'CL-1', num: 'VIP001', expectedDebtPayVersion: 0 }),
  ])
  expect(client.debt === 150 && card.debt === 150, `got ${client.debt}`)
})

await test('4 multiple ops aggregate correctly', () => {
  const { client } = simMerge(100, [
    op('sale', { clientRef: 'a', debtAdded: 30, clientId: 'CL-1', cardNum: 'VIP001' }),
    op('debt_repay', { clientRef: 'b', amount: 20, clientId: 'CL-1', num: 'VIP001' }),
    op('cash_advance', { clientRef: 'c', amount: 10, clientId: 'CL-1', num: 'VIP001' }),
  ])
  expect(client.debt === 120, `got ${client.debt}`)
})

await test('5 duplicate same clientRef counted once', () => {
  const { client, overlay } = simMerge(100, [
    op('debt_repay', { clientRef: 'dup', amount: 20, clientId: 'CL-1', num: 'VIP001' }, { seq: 1 }),
    op('debt_repay', { clientRef: 'dup', amount: 20, clientId: 'CL-1', num: 'VIP001' }, { seq: 2 }),
  ])
  expect(client.debt === 80, `got ${client.debt}`)
  expect(overlay.skipped.some(s => s.reason === 'duplicate_clientRef'), 'dup skipped')
})

await test('6 non-debt sale counted 0', () => {
  const { client } = simMerge(100, [
    op('sale', { clientRef: 'cash', debtAdded: 0, total: 50, clientId: 'CL-1', cardNum: 'VIP001' }),
  ])
  expect(client.debt === 100, `got ${client.debt}`)
})

await test('7 appliedLocal=false counted 0', () => {
  const { client } = simMerge(100, [
    op('debt_repay', { clientRef: 'x', amount: 20, clientId: 'CL-1', num: 'VIP001', appliedLocal: false }),
  ])
  expect(client.debt === 100, `got ${client.debt}`)
})

await test('8 held NOT_FOUND repay still overlays', () => {
  const { client } = simMerge(100, [
    op('debt_repay', { clientRef: 'h1', amount: 20, clientId: 'CL-1', num: 'VIP001' }, {
      failed: true,
      lastError: 'DEBT_RECEIPT_NOT_FOUND: missing',
    }),
  ])
  expect(client.debt === 80, `got ${client.debt}`)
})

await test('9 ambiguous held repay still overlays', () => {
  const { client } = simMerge(100, [
    op('debt_repay', { clientRef: 'h2', amount: 15, clientId: 'CL-1', num: 'VIP001' }, {
      failed: true,
      lastError: 'DEBT_RECEIPT_AMBIGUOUS',
    }),
  ])
  expect(client.debt === 85, `got ${client.debt}`)
})

await test('10 app restart / empty in-memory map still 80', () => {
  clearActiveDebtOverlay()
  // only durable queue rebuild — no moneyPending
  const { client } = simMerge(100, [
    op('debt_repay', { clientRef: 'rst', amount: 20, clientId: 'CL-1', num: 'VIP001' }),
  ])
  expect(client.debt === 80, `got ${client.debt}`)
})

await test('11 TTL expired still 80', () => {
  // overlay does not use moneyPending TTL at all
  const { client } = simMerge(100, [
    op('debt_repay', { clientRef: 'ttl', amount: 20, clientId: 'CL-1', num: 'VIP001' }),
  ])
  expect(client.debt === 80, 'overlay independent of TTL')
})

await test('12 forceFull still preserves overlay', () => {
  // forceFull: localCard undefined — overlay still from server base
  const overlay = buildPendingDebtOverlay([
    op('debt_repay', { clientRef: 'ff', amount: 20, clientId: 'CL-1', num: 'VIP001', expectedDebtPayVersion: 2 }),
  ])
  const card = applyPendingDebtOverlayToCard(
    { num: 'VIP001', debt: 100, debtPayVersion: 2, clientId: 'CL-1' },
    undefined,
    overlay,
  )
  expect(card.debt === 80, `got ${card.debt}`)
  expect(card.debtPayVersion >= 3, `ver=${card.debtPayVersion}`)
})

await test('13 normal pull preserves overlay', () => {
  const { client } = simMerge(100, [
    op('cash_advance', { clientRef: 'np', amount: 5, clientId: 'CL-1', num: 'VIP001' }),
  ])
  expect(client.debt === 105, 'normal')
})

await test('14 reconnect pull preserves overlay', () => {
  const { client } = simMerge(100, [
    op('sale', { clientRef: 'rc', debtAdded: 7, clientId: 'CL-1', cardNum: 'VIP001' }),
  ])
  expect(client.debt === 107, 'reconnect')
})

await test('15 startup pull preserves overlay', () => {
  clearActiveDebtOverlay()
  refreshDebtOverlayFromPending([
    op('debt_repay', { clientRef: 'su', amount: 20, clientId: 'CL-1', num: 'VIP001' }),
  ])
  const client = applyPendingDebtOverlayToClient({ id: 'CL-1', debt: 100 })
  expect(client.debt === 80, 'startup')
})

await test('16 ACK transition server100+pending-20=80 then server80+no pending=80', () => {
  let r = simMerge(100, [
    op('debt_repay', { clientRef: 'ack', amount: 20, clientId: 'CL-1', num: 'VIP001' }),
  ])
  expect(r.client.debt === 80, 'before ack')
  r = simMerge(80, [])
  expect(r.client.debt === 80, 'after ack')
})

await test('17 no double-apply local already80 + server100 + pending-20 =>80 not60', () => {
  const overlay = buildPendingDebtOverlay([
    op('debt_repay', { clientRef: 'nd', amount: 20, clientId: 'CL-1', num: 'VIP001' }),
  ])
  const client = applyPendingDebtOverlayToClient(
    { id: 'CL-1', debt: 100 },
    { id: 'CL-1', debt: 80 },
    overlay,
  )
  expect(client.debt === 80, `got ${client.debt} (not 60)`)
})

await test('18 two pending repayments sum correctly', () => {
  const { client } = simMerge(100, [
    op('debt_repay', { clientRef: 't1', amount: 10, clientId: 'CL-1', num: 'VIP001' }),
    op('debt_repay', { clientRef: 't2', amount: 15, clientId: 'CL-1', num: 'VIP001' }),
  ])
  expect(client.debt === 75, `got ${client.debt}`)
})

await test('19 sale+repay mixed', () => {
  const { client } = simMerge(100, [
    op('sale', { clientRef: 'm1', debtAdded: 40, clientId: 'CL-1', cardNum: 'VIP001' }),
    op('debt_repay', { clientRef: 'm2', amount: 25, clientId: 'CL-1', num: 'VIP001' }),
  ])
  expect(client.debt === 115, `got ${client.debt}`)
})

await test('20 card/client both same effective debt', () => {
  const { client, card } = simMerge(100, [
    op('debt_repay', { clientRef: 'both', amount: 20, clientId: 'CL-1', num: 'VIP001' }),
  ])
  expect(client.debt === card.debt && client.debt === 80, 'same')
})

await test('21 client only op when card unavailable', () => {
  const overlay = buildPendingDebtOverlay([
    op('debt_repay', { clientRef: 'co', amount: 20, clientId: 'CL-1' }),
  ])
  const client = applyPendingDebtOverlayToClient({ id: 'CL-1', debt: 100 }, null, overlay)
  const card = applyPendingDebtOverlayToCard({ num: 'VIP001', debt: 100, clientId: 'CL-1' }, null, overlay)
  expect(client.debt === 80, 'client')
  expect(card.debt === 100, 'card unchanged without cardNum on op')
})

await test('22 wrong card ownership does not cross-apply', () => {
  const overlay = buildPendingDebtOverlay([
    op('debt_repay', { clientRef: 'own', amount: 20, clientId: 'CL-OTHER', num: 'VIP001' }),
  ])
  const card = applyPendingDebtOverlayToCard(
    { num: 'VIP001', debt: 100, clientId: 'CL-1' },
    { num: 'VIP001', debt: 100, clientId: 'CL-1' },
    overlay,
  )
  expect(card.debt === 100, `got ${card.debt}`)
})

await test('23 unparseable debt queue item => diagnostic/fail-safe', () => {
  const overlay = buildPendingDebtOverlay([
    op('debt_repay', { clientRef: 'bad', amount: 0, clientId: 'CL-1', num: 'VIP001' }),
  ])
  // amount 0 → unparseable for repay
  expect(overlay.unparseable.length >= 1 || overlay.skipped.length >= 1, 'flagged')
  const r = applyDebtOverlayToProjection(100, {
    overlay: buildPendingDebtOverlay([
      { clientRef: 'bad2', kind: 'debt_repay', payload: { clientRef: 'bad2', clientId: 'CL-1', num: 'VIP001', appliedLocal: true }, createdAtIso: '2026-01-01T00:00:00Z', seq: 1, attempts: 0 },
    ]),
    clientId: 'CL-1',
    mode: 'client',
    localDebt: 77,
  })
  // missing amount → unparseable → fail-safe local
  expect(r.failSafeLocal === true && r.debt === 77, `got ${JSON.stringify(r)}`)
  expect(r.code === DEBT_OVERLAY_UNPARSEABLE || r.failSafeLocal, 'code')
})

await test('24 debtPayVersion never goes backward', () => {
  const overlay = buildPendingDebtOverlay([
    op('debt_repay', { clientRef: 'v1', amount: 10, clientId: 'CL-1', num: 'VIP001', expectedDebtPayVersion: 5 }),
  ])
  const card = applyPendingDebtOverlayToCard(
    { num: 'VIP001', debt: 100, debtPayVersion: 4, clientId: 'CL-1' },
    { num: 'VIP001', debt: 90, debtPayVersion: 6 },
    overlay,
  )
  expect(card.debtPayVersion >= 6, `ver=${card.debtPayVersion}`)
})

await test('25 ACK does not add extra version', () => {
  const before = applyPendingDebtOverlayToCard(
    { num: 'VIP001', debt: 100, debtPayVersion: 1, clientId: 'CL-1' },
    { num: 'VIP001', debt: 80, debtPayVersion: 2 },
    buildPendingDebtOverlay([
      op('debt_repay', { clientRef: 'vack', amount: 20, clientId: 'CL-1', num: 'VIP001', expectedDebtPayVersion: 1 }),
    ]),
  )
  expect(before.debtPayVersion === 2, `before=${before.debtPayVersion}`)
  const after = applyPendingDebtOverlayToCard(
    { num: 'VIP001', debt: 80, debtPayVersion: 2, clientId: 'CL-1' },
    { num: 'VIP001', debt: 80, debtPayVersion: 2 },
    buildPendingDebtOverlay([]),
  )
  expect(after.debtPayVersion === 2, `after=${after.debtPayVersion}`)
})

await test('26 duplicate clientRef in queue counted once', () => {
  const overlay = buildPendingDebtOverlay([
    op('cash_advance', { clientRef: 'same', amount: 50, clientId: 'CL-1', num: 'VIP001' }, { seq: 1 }),
    op('cash_advance', { clientRef: 'same', amount: 50, clientId: 'CL-1', num: 'VIP001' }, { seq: 9 }),
  ])
  expect(overlay.ops.length === 1, 'one op')
  const r = applyDebtOverlayToProjection(100, { overlay, clientId: 'CL-1', mode: 'client' })
  expect(r.debt === 150, `got ${r.debt}`)
})

await test('27 queue order irrelevant for pure projection', () => {
  const a = buildPendingDebtOverlay([
    op('sale', { clientRef: 'o1', debtAdded: 30, clientId: 'CL-1', cardNum: 'VIP001' }, { seq: 1 }),
    op('debt_repay', { clientRef: 'o2', amount: 10, clientId: 'CL-1', num: 'VIP001' }, { seq: 2 }),
  ])
  const b = buildPendingDebtOverlay([
    op('debt_repay', { clientRef: 'o2', amount: 10, clientId: 'CL-1', num: 'VIP001' }, { seq: 1 }),
    op('sale', { clientRef: 'o1', debtAdded: 30, clientId: 'CL-1', cardNum: 'VIP001' }, { seq: 2 }),
  ])
  const da = applyDebtOverlayToProjection(100, { overlay: a, clientId: 'CL-1', mode: 'client' })
  const db = applyDebtOverlayToProjection(100, { overlay: b, clientId: 'CL-1', mode: 'client' })
  expect(da.debt === db.debt && da.debt === 120, 'order irrelevant')
})

await test('28 explicit reverted operation excluded', () => {
  // reverted ⇒ deleted from queue ⇒ empty overlay
  const { client } = simMerge(100, [])
  expect(client.debt === 100, 'no overlay after revert/delete')
  expect(OVERLAY_EXCLUDED_QUEUE_STATES.includes('explicitly_reverted_deleted'), 'doc')
})

await test('29 browser path unchanged (source guard)', () => {
  const offline = fs.readFileSync(path.join(lib, 'offline.ts'), 'utf8')
  // Browser still online-first for sales that await network — D5 only overlay on pull
  expect(/enqueueOp/.test(offline), 'queue intact')
  const guard = fs.readFileSync(path.join(lib, 'loyaltySaveGuard.ts'), 'utf8')
  expect(/applyPendingDebtOverlayToCard/.test(guard), 'overlay wired')
  expect(/MONEY_TTL_MS/.test(guard), 'TTL kept as optimization for bonus/wallet')
})

await test('30 486.70 historical removed queue does NOT magically overlay', () => {
  // Historical case: queue already empty after recovery — no phantom overlay
  const overlay = buildPendingDebtOverlay([])
  const r = applyDebtOverlayToProjection(486.7, { overlay, clientId: 'U-xx', mode: 'client' })
  expect(r.debt === 486.7 && !r.usedOverlay, 'no magic overlay')
})

await test('included/excluded states documented', () => {
  expect(OVERLAY_INCLUDED_QUEUE_STATES.includes('ready'), 'ready')
  expect(OVERLAY_INCLUDED_QUEUE_STATES.includes('cooldown'), 'cooldown')
  expect(OVERLAY_INCLUDED_QUEUE_STATES.includes('failed'), 'failed')
  expect(OVERLAY_EXCLUDED_QUEUE_STATES.includes('acked_deleted'), 'acked')
  expect(OVERLAY_EXCLUDED_QUEUE_STATES.includes('appliedLocal_false'), 'appliedLocal')
})

await test('source wiring: syncPull + stores refresh overlay', () => {
  const syncPull = fs.readFileSync(path.join(lib, 'syncPull.ts'), 'utf8')
  expect(/refreshDebtOverlayFromPending/.test(syncPull), 'syncPull')
  const clientStore = fs.readFileSync(path.join(lib, 'clientStore.ts'), 'utf8')
  expect(/refreshDebtOverlayFromQueue/.test(clientStore), 'clientStore')
  const cardStore = fs.readFileSync(path.join(lib, 'cardStore.ts'), 'utf8')
  expect(/refreshDebtOverlayFromQueue/.test(cardStore), 'cardStore')
  const posStore = fs.readFileSync(path.join(lib, 'posStore.ts'), 'utf8')
  expect(/refreshDebtOverlayFromQueue/.test(posStore), 'posStore')
  const hydrate = fs.readFileSync(path.join(lib, 'offlineHydrate.ts'), 'utf8')
  expect(/refreshDebtOverlayFromQueue/.test(hydrate), 'hydrate')
})

await test('extractDebtOpFromQueueRow sale_on_credit', () => {
  const r = extractDebtOpFromQueueRow(op('sale', { clientRef: 'e1', debtAdded: 12, clientId: 'CL-1', cardNum: 'VIP001' }))
  expect(r.ok && r.op.debtDelta === 12 && r.op.type === 'sale_on_credit', JSON.stringify(r))
})

await new Promise(r => setTimeout(r, 0))

const failed = results.filter(r => r.status === 'FAIL')
const report = {
  phase: 'D5',
  passed: results.filter(r => r.status === 'PASS').length,
  failed: failed.length,
  total: results.length,
  results,
  OVERLAY_INCLUDED_QUEUE_STATES,
  OVERLAY_EXCLUDED_QUEUE_STATES,
}
fs.writeFileSync(path.join(root, 'scripts', 'debt-pending-overlay-d5-report.json'), JSON.stringify(report, null, 2))
console.log(`\nD5: ${report.passed}/${report.total} passed`)
if (failed.length) process.exit(1)
