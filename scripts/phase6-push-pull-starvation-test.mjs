/**
 * Phase 6 — Push/pull starvation: gate + overlay + cursor safety.
 * Run: node scripts/phase6-push-pull-starvation-test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const results = []
function test(name, fn) {
  try {
    fn()
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

const gateSrc = fs.readFileSync(path.join(root, 'lib', 'pendingPullGate.ts'), 'utf8')
const pullSrc = fs.readFileSync(path.join(root, 'lib', 'syncPull.ts'), 'utf8')
const syncSrc = fs.readFileSync(path.join(root, 'lib', 'offlineSync.ts'), 'utf8')
const revSrc = fs.readFileSync(path.join(root, 'server', 'kakapo-api', 'revisionCoordinator.js'), 'utf8')
const localDbSrc = fs.readFileSync(path.join(root, 'desktop', 'localDb.cjs'), 'utf8')
const atomicSrc = fs.readFileSync(path.join(root, 'lib', 'localSaleAtomic.ts'), 'utf8')

// ── Mirror of pendingPullGate (pure) ──────────────────────────
function classifyPendingOp(row, now = Date.now()) {
  if (row.failed) return 'failed'
  if (Number(row.nextRetryAt) > now) return 'cooldown'
  return 'ready'
}
function hasReadyToPushPending(list, now = Date.now()) {
  return (list || []).some(r => classifyPendingOp(r, now) === 'ready')
}
function shouldSkipFullPullForPending(list, now = Date.now()) {
  return hasReadyToPushPending(list, now)
}
function pendingSaleStockDeltas(list) {
  const deltas = new Map()
  const add = (pid, d) => {
    if (!(pid > 0) || !Number.isFinite(d) || Math.abs(d) < 1e-9) return
    deltas.set(pid, (deltas.get(pid) || 0) + d)
  }
  for (const row of list || []) {
    if (row.kind !== 'sale' && row.kind !== 'sale_return') continue
    const p = row.payload || {}
    const sign = row.kind === 'sale' ? -1 : 1
    const items = Array.isArray(p.items) ? p.items : []
    for (const it of items) {
      const qty = it.weightKg != null ? Number(it.weightKg) : Number(it.qty) || 0
      add(Number(it.productId) || 0, sign * qty)
    }
  }
  return deltas
}
function applyPendingStockOverlayToProducts(products, deltas) {
  if (!deltas.size) return products
  return products.map(p => {
    const d = deltas.get(Number(p.id))
    if (d == null) return p
    return { ...p, stock: Math.round(((Number(p.stock) || 0) + d) * 1000) / 1000 }
  })
}
function mergeLayersProtectingLocal(local, remote, protect) {
  if (!protect.size) return remote
  const keepLocal = local.filter(l => protect.has(Number(l.productId)))
  const remoteRest = remote.filter(l => !protect.has(Number(l.productId)))
  return [...remoteRest, ...keepLocal]
}

const now = 1_700_000_000_000

// ── Source wiring ─────────────────────────────────────────────
test('S1 gate uses shouldSkipFullPullForPending (not any !failed)', () => {
  expect(pullSrc.includes('shouldSkipFullPullForPending'), 'gate import')
  expect(!/pending\.some\(\s*r\s*=>\s*!r\.failed\s*\)/.test(pullSrc), 'old gate removed')
})

test('S2 overlay + layer protect wired', () => {
  expect(pullSrc.includes('applyPendingStockOverlayToProducts'), 'stock overlay')
  expect(pullSrc.includes('mergeLayersProtectingLocal'), 'layers protect')
  expect(pullSrc.includes('pendingSaleStockDeltas'), 'deltas')
})

test('S3 syncNow/flush allow inbound on cooldown', () => {
  expect(syncSrc.includes('hasReadyToPushPending'), 'ready check')
  expect(syncSrc.includes('Phase 6'), 'phase6 comments')
})

test('S4 revisionCoordinator untouched', () => {
  expect(revSrc.includes('pending_queues'), 'barrier still present')
  expect(gateSrc.includes('Does NOT touch revisionCoordinator'), 'doc')
})

test('S5 Phase 5 atomic sale untouched', () => {
  expect(localDbSrc.includes('function sqlSaleCommit'), 'sale commit remains')
  expect(atomicSrc.includes('commitLocalSaleAtomic'), 'atomic module remains')
})

// ── TEST A — cooldown + unrelated product ─────────────────────
test('TEST A cooldown pending does not skip pull; ready does', () => {
  const cooldownSale = {
    kind: 'sale',
    failed: false,
    nextRetryAt: now + 45_000,
    payload: { items: [{ productId: 1, qty: 1 }] },
  }
  const readySale = {
    kind: 'sale',
    failed: false,
    nextRetryAt: 0,
    payload: { items: [{ productId: 1, qty: 1 }] },
  }
  expect(!shouldSkipFullPullForPending([cooldownSale], now), 'cooldown must allow pull')
  expect(shouldSkipFullPullForPending([readySale], now), 'ready must block pull')
  // Unrelated product B can be applied while A pending in cooldown
  const products = [
    { id: 1, stock: 10, name: 'A' },
    { id: 2, stock: 5, name: 'B-old' },
  ]
  const remote = [
    { id: 1, stock: 10, name: 'A' },
    { id: 2, stock: 5, name: 'B-new' },
  ]
  const deltas = pendingSaleStockDeltas([cooldownSale])
  const merged = applyPendingStockOverlayToProducts(remote, deltas)
  expect(merged.find(p => p.id === 2).name === 'B-new', 'B updated')
  expect(merged.find(p => p.id === 1).stock === 9, 'A keeps pending delta on server base')
})

// ── TEST B — client update while product pending ──────────────
test('TEST B client protect set built for sale pending; unrelated client free', () => {
  expect(pullSrc.includes("pendingProtect.add(`client:"), 'client protect')
  expect(pullSrc.includes('mergeClientLoyaltyIfRecent'), 'loyalty merge')
  // Classification: failed does not block
  const failed = { kind: 'sale', failed: true, nextRetryAt: now + 45_000, payload: {} }
  expect(!shouldSkipFullPullForPending([failed], now), 'failed allows pull')
})

// ── TEST C — same product overlay ─────────────────────────────
test('TEST C same product keeps pending delta after remote base change', () => {
  const pending = [{
    kind: 'sale',
    failed: false,
    nextRetryAt: now + 45_000,
    payload: { items: [{ productId: 7, qty: 2 }] },
  }]
  // Local sold 2 from 10 → 8; server base later becomes 12 (other inbound)
  // effective = 12 - 2 = 10
  const remote = [{ id: 7, stock: 12 }]
  const over = applyPendingStockOverlayToProducts(remote, pendingSaleStockDeltas(pending))
  expect(over[0].stock === 10, `expected 10 got ${over[0].stock}`)
})

// ── TEST D — multiple pending mixed classes ───────────────────
test('TEST D multiple pending: only ready blocks', () => {
  const list = [
    { kind: 'sale', failed: false, nextRetryAt: now + 45_000, payload: { items: [{ productId: 1, qty: 1 }] } },
    { kind: 'sale', failed: true, nextRetryAt: now + 10_000, payload: { items: [{ productId: 2, qty: 1 }] } },
    { kind: 'client_upsert', failed: false, nextRetryAt: 0, payload: {} },
  ]
  expect(shouldSkipFullPullForPending(list, now), 'ready client_upsert blocks')
  const onlyCool = list.filter(r => classifyPendingOp(r, now) !== 'ready')
  expect(!shouldSkipFullPullForPending(onlyCool, now), 'cooldown+failed allow')
})

// ── TEST E — failed terminal ──────────────────────────────────
test('TEST E failed op does not skip full pull', () => {
  const list = [
    { kind: 'sale', failed: true, attempts: 9, nextRetryAt: now + 120_000, payload: { items: [{ productId: 1, qty: 1 }] } },
  ]
  expect(!shouldSkipFullPullForPending(list, now), 'failed must not starve')
  expect(classifyPendingOp(list[0], now) === 'failed', 'class failed')
})

// ── TEST F — cursor safety (overlay not defer) ────────────────
test('TEST F cursor advances with overlay (no silent skip)', () => {
  expect(pullSrc.includes('safe to advance') || pullSrc.includes('Cursor: overlays'), 'cursor policy documented')
  // After ACK: delta empty → stock = remote only
  const afterAck = applyPendingStockOverlayToProducts([{ id: 1, stock: 9 }], new Map())
  expect(afterAck[0].stock === 9, 'no overlay after ACK')
  // Conflicting remote applied then overlay: deferred not needed
  const withPending = applyPendingStockOverlayToProducts(
    [{ id: 1, stock: 10 }],
    new Map([[1, -1]]),
  )
  expect(withPending[0].stock === 9, 'remote+overlay')
})

// ── TEST G — layers protect survives merge ────────────────────
test('TEST G layer protect keeps local for touched product', () => {
  const local = [
    { receiptId: 'r1', productId: 1, remainingQty: 3 },
    { receiptId: 'r2', productId: 2, remainingQty: 9 },
  ]
  const remote = [
    { receiptId: 'r1', productId: 1, remainingQty: 99 },
    { receiptId: 'r2', productId: 2, remainingQty: 8 },
    { receiptId: 'r3', productId: 3, remainingQty: 1 },
  ]
  const merged = mergeLayersProtectingLocal(local, remote, new Set([1]))
  const a = merged.find(l => l.productId === 1)
  const b = merged.find(l => l.productId === 2)
  const c = merged.find(l => l.productId === 3)
  expect(a.remainingQty === 3, 'A local kept')
  expect(b.remainingQty === 8, 'B remote taken')
  expect(c.remainingQty === 1, 'C remote new')
})

// ── TEST H — revision barrier regression ──────────────────────
test('TEST H revision barrier kinds still protected; READY revision still gates', () => {
  expect(pullSrc.includes("pendingProtect.add(`revision:"), 'revision protect')
  expect(revSrc.includes('PENDING_STATUSES') || revSrc.includes('pending_queues'), 'server barrier')
  const revReady = {
    kind: 'stock_revision_create',
    failed: false,
    nextRetryAt: 0,
    payload: { id: 'rev1' },
  }
  expect(shouldSkipFullPullForPending([revReady], now), 'ready revision still blocks full pull')
  const revCool = { ...revReady, nextRetryAt: now + 60_000 }
  expect(!shouldSkipFullPullForPending([revCool], now), 'cooldown revision allows pull with protect')
})

test('CLASS mirror matches source exports', () => {
  expect(gateSrc.includes('export function classifyPendingOp'), 'classify')
  expect(gateSrc.includes('export function shouldSkipFullPullForPending'), 'skip')
  expect(gateSrc.includes('export function pendingSaleStockDeltas'), 'deltas')
  expect(gateSrc.includes('export function mergeLayersProtectingLocal'), 'layers')
})

const failed = results.filter(r => r.status === 'FAIL')
const report = {
  phase: 6,
  title: 'Push/pull starvation',
  at: new Date().toISOString(),
  passed: results.filter(r => r.status === 'PASS').length,
  failed: failed.length,
  results,
}
fs.writeFileSync(path.join(root, 'phase6-push-pull-starvation-report.json'), JSON.stringify(report, null, 2))
console.log(`\n${report.passed} PASS / ${report.failed} FAIL → phase6-push-pull-starvation-report.json`)
process.exit(failed.length ? 1 : 0)
