/**
 * Phase 1 — Ghost Outbox isolated tests.
 * Simulates Desktop / Android / Browser queue mirrors with the FIXED deletePending semantics.
 *
 * Run: node scripts/phase1-ghost-outbox-test.mjs
 *
 * Mirrors real offline.ts rules:
 * - putPending: always LS; then native (desk/android/idb)
 * - getPending: native first, then merge LS-only refs
 * - deletePending (FIXED): native delete + ALWAYS LS delete by clientRef (no early return)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const offlineSrc = fs.readFileSync(path.join(root, 'lib', 'offline.ts'), 'utf8')

// ── Guard: production code must contain the fix ──────────────────────────────
const deleteFn = offlineSrc.match(/async function deletePending\([\s\S]*?\n(?:async function|export async function|\/\*\*)/)
const deleteBody = deleteFn?.[0] || ''
const hasEarlyReturnAfterDesk =
  /localDbQueueDelete[\s\S]{0,400}?return\s*\n\s*\} catch/.test(deleteBody)
    || /localDbQueueDelete[\s\S]{0,200}?\n\s*return\n/.test(deleteBody)
const alwaysClearsLs =
  /lsQueueDeleteClientRef\(ref\)/.test(deleteBody)
  || (/lsQueueWrite\(lsQueueRead\(\)\.filter/.test(deleteBody)
    && !/localDbQueueDelete[\s\S]*return[\s\S]*lsQueueWrite/.test(
      // old bug pattern: return before LS
      deleteBody,
    ))

function assertFixInSource() {
  if (!/lsQueueDeleteClientRef/.test(offlineSrc)) {
    throw new Error('FIX MISSING: lsQueueDeleteClientRef not found in offline.ts')
  }
  // Must not early-return after desk delete before LS cleanup
  const deskBlock = offlineSrc.slice(
    offlineSrc.indexOf('async function deletePending'),
    offlineSrc.indexOf('export async function dropPending'),
  )
  if (/localDbQueueDelete[\s\S]*?\n\s*return\s*\n/.test(deskBlock)
    && !deskBlock.includes('lsQueueDeleteClientRef')) {
    throw new Error('FIX MISSING: early return after desk delete still present')
  }
  if (!deskBlock.includes('lsQueueDeleteClientRef(ref)')) {
    throw new Error('FIX MISSING: deletePending must call lsQueueDeleteClientRef')
  }
  // Ensure LS clear is AFTER native deletes (order in source)
  const androidIdx = deskBlock.indexOf('files.queueDelete')
  const deskIdx = deskBlock.indexOf('localDbQueueDelete')
  const lsIdx = deskBlock.indexOf('lsQueueDeleteClientRef')
  if (lsIdx < 0 || (deskIdx >= 0 && lsIdx < deskIdx) || (androidIdx >= 0 && lsIdx < androidIdx)) {
    // LS after native is preferred; soft check
  }
  if (lsIdx < 0) throw new Error('FIX MISSING')
}

assertFixInSource()

// ── Simulated multi-backend store ────────────────────────────────────────────
function makeStore(platform) {
  /** @type {Map<string, any>} */
  const sqlite = new Map()
  /** @type {Map<string, any>} */
  const idb = new Map()
  /** @type {Map<string, any>} */
  const android = new Map()
  /** @type {any[]} */
  let ls = []

  const hasDesk = platform === 'desktop' || platform === 'desktop+idb'
  const hasIdb = platform === 'browser' || platform === 'desktop+idb' || platform === 'android+idb'
  const hasAndroid = platform === 'android' || platform === 'android+idb'

  function putPending(row) {
    const ref = String(row.clientRef)
    ls = ls.filter(r => r.clientRef !== ref).concat([{ ...row, clientRef: ref }])
    if (hasDesk) sqlite.set(ref, { ...row, clientRef: ref })
    if (hasAndroid) android.set(ref, { ...row, clientRef: ref })
    if (hasIdb) idb.set(ref, { ...row, clientRef: ref })
  }

  /** FIXED deletePending — all mirrors, no early return skipping LS */
  function deletePending(clientRef) {
    const ref = String(clientRef || '')
    if (!ref) return
    if (hasAndroid) android.delete(ref)
    if (hasDesk) sqlite.delete(ref)
    if (hasIdb) idb.delete(ref)
    ls = ls.filter(r => r.clientRef !== ref)
  }

  /** OLD buggy deletePending (Desktop) — for contrast checks */
  function deletePendingOldBuggy(clientRef) {
    const ref = String(clientRef || '')
    if (hasAndroid) android.delete(ref)
    if (hasDesk) {
      sqlite.delete(ref)
      if (hasIdb) idb.delete(ref)
      return // BUG: skip LS
    }
    if (hasIdb) {
      idb.delete(ref)
      return // BUG: skip LS
    }
    ls = ls.filter(r => r.clientRef !== ref)
  }

  function getPending() {
    /** @type {Map<string, any>} */
    const byRef = new Map()
    if (hasAndroid) for (const [k, v] of android) byRef.set(k, v)
    if (hasDesk) for (const [k, v] of sqlite) byRef.set(k, v)
    let idbOnly = 0
    if (hasIdb) {
      for (const [k, v] of idb) {
        if (!byRef.has(k)) {
          byRef.set(k, v)
          idbOnly++
        }
      }
    }
    if (byRef.size === 0) return [...ls]
    for (const row of ls) {
      if (row.clientRef && !byRef.has(row.clientRef)) byRef.set(row.clientRef, row)
    }
    return [...byRef.values()]
  }

  /** Simulate restart: drop runtime, keep durable maps (already durable) */
  function restart() {
    // Maps ARE durable in this sim; nothing to clear. Explicit no-op documents intent.
  }

  function snapshot() {
    return {
      sqlite: [...sqlite.keys()].sort(),
      idb: [...idb.keys()].sort(),
      android: [...android.keys()].sort(),
      ls: ls.map(r => r.clientRef).sort(),
      pending: getPending().map(r => r.clientRef).sort(),
    }
  }

  return { putPending, deletePending, deletePendingOldBuggy, getPending, restart, snapshot, platform }
}

function op(clientRef, kind = 'sale') {
  return { clientRef, kind, payload: { clientRef }, createdAtIso: new Date().toISOString(), seq: 1, attempts: 0 }
}

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
function sameSet(a, b) {
  const as = [...a].sort().join(',')
  const bs = [...b].sort().join(',')
  return as === bs
}

// ── TEST A — ONE OP (Desktop) ────────────────────────────────────────────────
test('A — one op put/delete/get (desktop)', () => {
  const s = makeStore('desktop')
  s.putPending(op('A'))
  expect(s.snapshot().sqlite.includes('A'), 'sqlite has A')
  expect(s.snapshot().ls.includes('A'), 'ls has A')
  s.deletePending('A')
  expect(s.getPending().length === 0, 'pending empty')
  expect(!s.snapshot().ls.includes('A'), 'ls empty of A')
  expect(!s.snapshot().sqlite.includes('A'), 'sqlite empty of A')
})

// ── Contrast: old bug would fail ─────────────────────────────────────────────
test('A′ — old buggy delete WOULD resurrect (desktop) [documents P1]', () => {
  const s = makeStore('desktop')
  s.putPending(op('A'))
  s.deletePendingOldBuggy('A')
  expect(s.snapshot().sqlite.length === 0, 'sqlite cleared')
  expect(s.snapshot().ls.includes('A'), 'LS STILL has A under old bug')
  expect(s.getPending().some(r => r.clientRef === 'A'), 'getPending resurrects A under old bug')
})

// ── TEST B — restart simulation ──────────────────────────────────────────────
test('B — restart after ACK (desktop)', () => {
  const s = makeStore('desktop')
  s.putPending(op('A'))
  s.deletePending('A') // ACK
  s.restart()
  expect(s.getPending().length === 0, 'no resurrection after restart')
})

test('B — restart after ACK (android)', () => {
  const s = makeStore('android')
  s.putPending(op('A'))
  s.deletePending('A')
  s.restart()
  expect(s.getPending().length === 0, 'android no resurrection')
})

test('B — restart after ACK (browser idb+ls)', () => {
  const s = makeStore('browser')
  s.putPending(op('A'))
  s.deletePending('A')
  s.restart()
  expect(s.getPending().length === 0, 'browser no resurrection')
})

// ── TEST C — multiple ops ────────────────────────────────────────────────────
test('C — delete B keeps A,C', () => {
  const s = makeStore('desktop')
  s.putPending(op('A'))
  s.putPending(op('B'))
  s.putPending(op('C'))
  s.deletePending('B')
  const refs = s.getPending().map(r => r.clientRef).sort()
  expect(sameSet(refs, ['A', 'C']), `got ${refs}`)
})

// ── TEST D — 100 ops all ACK ─────────────────────────────────────────────────
test('D — 100 ops all deleted → 0', () => {
  const s = makeStore('desktop')
  for (let i = 0; i < 100; i++) s.putPending(op(`R${i}`))
  expect(s.getPending().length === 100, '100 pending')
  for (let i = 0; i < 100; i++) s.deletePending(`R${i}`)
  s.restart()
  expect(s.getPending().length === 0, 'pending 0 after 100 ACK')
  expect(s.snapshot().ls.length === 0, 'ls 0')
  expect(s.snapshot().sqlite.length === 0, 'sqlite 0')
})

// ── TEST E — partial ACK ─────────────────────────────────────────────────────
test('E — ACK first 60 of 100 → 40 remain', () => {
  const s = makeStore('desktop')
  for (let i = 0; i < 100; i++) s.putPending(op(`R${i}`))
  for (let i = 0; i < 60; i++) s.deletePending(`R${i}`)
  s.restart()
  const left = s.getPending().map(r => r.clientRef).sort()
  expect(left.length === 40, `expected 40 got ${left.length}`)
  for (let i = 0; i < 60; i++) expect(!left.includes(`R${i}`), `R${i} should be gone`)
  for (let i = 60; i < 100; i++) expect(left.includes(`R${i}`), `R${i} should remain`)
})

// ── TEST F — duplicate delete ────────────────────────────────────────────────
test('F — duplicate deletePending idempotent', () => {
  const s = makeStore('desktop')
  s.putPending(op('A'))
  s.putPending(op('B'))
  s.deletePending('A')
  s.deletePending('A') // again
  s.deletePending('A')
  expect(s.getPending().map(r => r.clientRef).join() === 'B', 'only B left')
})

// ── TEST G — mixed kinds ─────────────────────────────────────────────────────
test('G — mixed kinds: ACK one sale only', () => {
  const s = makeStore('desktop')
  s.putPending(op('sale-1', 'sale'))
  s.putPending(op('ret-1', 'sale_return'))
  s.putPending(op('debt-1', 'debt_repay'))
  s.putPending(op('top-1', 'card_topup'))
  s.putPending(op('sale-2', 'sale'))
  s.deletePending('sale-1')
  const left = s.getPending().map(r => r.clientRef).sort()
  expect(sameSet(left, ['debt-1', 'ret-1', 'sale-2', 'top-1']), `got ${left}`)
})

// ── Platform matrix smoke ────────────────────────────────────────────────────
for (const platform of ['desktop', 'desktop+idb', 'android', 'browser']) {
  test(`platform smoke — ${platform}`, () => {
    const s = makeStore(platform)
    s.putPending(op('X', 'sale'))
    s.putPending(op('Y', 'debt_repay'))
    s.deletePending('X')
    s.restart()
    const left = s.getPending().map(r => r.clientRef)
    expect(sameSet(left, ['Y']), `${platform}: ${left}`)
    const snap = s.snapshot()
    expect(!snap.ls.includes('X'), 'ls clean')
  })
}

// ── Source regression: no early-return ghost pattern ─────────────────────────
test('source — deletePending clears LS without desk early-return', () => {
  const block = offlineSrc.slice(
    offlineSrc.indexOf('async function deletePending'),
    offlineSrc.indexOf('export async function dropPending'),
  )
  expect(block.includes('lsQueueDeleteClientRef(ref)'), 'calls ls helper')
  // Strip comments, then ensure no bare `return` after desk delete before LS clear
  const noComments = block
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
  const afterDesk = noComments.slice(noComments.indexOf('localDbQueueDelete'))
  const lsCall = afterDesk.indexOf('lsQueueDeleteClientRef')
  expect(lsCall >= 0, 'ls clear present')
  const beforeLs = afterDesk.slice(0, lsCall)
  expect(!/\breturn\b/.test(beforeLs), 'no early return before LS clear')
})

const failed = results.filter(r => r.status === 'FAIL')
const report = {
  phase: 1,
  generatedAt: new Date().toISOString(),
  summary: {
    total: results.length,
    passed: results.filter(r => r.status === 'PASS').length,
    failed: failed.length,
  },
  results,
}
const out = path.join(root, 'scripts', 'phase1-ghost-outbox-report.json')
fs.writeFileSync(out, JSON.stringify(report, null, 2))
console.log('\n' + JSON.stringify(report.summary, null, 2))
console.log(`Wrote ${out}`)
process.exit(failed.length ? 1 : 0)
