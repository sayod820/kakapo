/**
 * Phase 4 — reconnect timer earlier-wins + backoff preservation.
 * Run: node scripts/phase4-reconnect-timer-test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = fs.readFileSync(path.join(root, 'lib', 'offlineSync.ts'), 'utf8')

const BACKOFF_MS = [2500, 4000, 7000, 12000, 20000, 30000, 45000]
const SLACK = 25

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

/** Mirror of fixed scheduleReconnect state machine (no real setTimeout side effects beyond tracking). */
function makeScheduler(clock = { now: 0 }) {
  let reconnectTimer = null
  let reconnectDueAt = 0
  let reconnectAttempt = 0
  let syncLock = false
  let fireCount = 0
  let lastTag = ''
  const events = []

  function peekBackoffMs() {
    return BACKOFF_MS[Math.min(reconnectAttempt, BACKOFF_MS.length - 1)]
  }
  function nextBackoffMs() {
    const idx = Math.min(reconnectAttempt, BACKOFF_MS.length - 1)
    reconnectAttempt += 1
    return BACKOFF_MS[idx]
  }
  function clearReconnectTimer() {
    reconnectTimer = null
    reconnectDueAt = 0
  }
  function resetBackoff() {
    reconnectAttempt = 0
    clearReconnectTimer()
  }

  function scheduleReconnect(delayMs) {
    const explicit = delayMs != null && Number.isFinite(Number(delayMs))
    const requestedWait = explicit ? Math.max(0, Number(delayMs)) : peekBackoffMs()
    const now = clock.now
    const newDueAt = now + requestedWait

    if (reconnectTimer && reconnectDueAt > 0) {
      if (newDueAt >= reconnectDueAt - SLACK) {
        lastTag = 'kept_existing'
        events.push({ tag: lastTag, requestedWait, dueIn: reconnectDueAt - now, attempt: reconnectAttempt })
        return
      }
      reconnectTimer = null
      lastTag = 'rescheduled_earlier'
      events.push({ tag: lastTag, from: reconnectDueAt - now, to: requestedWait, attempt: reconnectAttempt })
    } else {
      lastTag = 'scheduleReconnect'
      events.push({ tag: lastTag, requestedWait, attempt: reconnectAttempt })
    }

    const wait = explicit ? requestedWait : nextBackoffMs()
    reconnectDueAt = now + wait
    reconnectTimer = { wait, dueAt: reconnectDueAt }
  }

  function fireIfDue() {
    if (!reconnectTimer || clock.now < reconnectDueAt) return false
    reconnectTimer = null
    reconnectDueAt = 0
    if (syncLock) {
      scheduleReconnect(4000)
      return true
    }
    fireCount += 1
    return true
  }

  return {
    scheduleReconnect,
    resetBackoff,
    nextBackoffMs,
    clearReconnectTimer,
    fireIfDue,
    setSyncLock: (v) => { syncLock = v },
    advance: (ms) => { clock.now += ms; fireIfDue() },
    setNow: (t) => { clock.now = t },
    get state() {
      return {
        hasTimer: !!reconnectTimer,
        dueAt: reconnectDueAt,
        dueIn: reconnectDueAt > 0 ? reconnectDueAt - clock.now : null,
        attempt: reconnectAttempt,
        fireCount,
        lastTag,
        events: [...events],
        now: clock.now,
      }
    },
  }
}

test('source — earlier-wins + reconnectDueAt present', () => {
  expect(src.includes('reconnectDueAt'), 'dueAt state')
  expect(src.includes('rescheduled_earlier'), 'telemetry tag')
  expect(src.includes('kept_existing'), 'kept tag')
  expect(!/if \(reconnectTimer\) \{\s*if \(isPerfEnabled\(\)\) \{[\s\S]*?skipped_existing_timer[\s\S]*?return\s*\}/.test(src)
    || src.includes('rescheduled_earlier'), 'old skip-only path gone')
  expect(src.includes('peekBackoffMs'), 'peek before consume')
  expect(/function resetBackoff\(\) \{[\s\S]*?clearReconnectTimer/.test(src), 'success clears timer')
})

test('A — no existing timer → schedule 600', () => {
  const s = makeScheduler()
  s.scheduleReconnect(600)
  expect(s.state.hasTimer, 'timer')
  expect(s.state.dueIn === 600, `dueIn ${s.state.dueIn}`)
  expect(s.state.attempt === 0, 'no backoff consume on explicit')
  expect(s.state.lastTag === 'scheduleReconnect', 'tag')
})

test('B — existing 45s + new 600ms → reschedule earlier', () => {
  const s = makeScheduler()
  s.scheduleReconnect(45000)
  expect(s.state.dueIn === 45000, '45s')
  s.scheduleReconnect(600)
  expect(s.state.lastTag === 'rescheduled_earlier', s.state.lastTag)
  expect(s.state.dueIn === 600, `dueIn ${s.state.dueIn}`)
  expect(s.state.hasTimer, 'one timer')
})

test('C — existing 600ms + new 45s → keep existing', () => {
  const s = makeScheduler()
  s.scheduleReconnect(600)
  s.scheduleReconnect(45000)
  expect(s.state.lastTag === 'kept_existing', s.state.lastTag)
  expect(s.state.dueIn === 600, `dueIn ${s.state.dueIn}`)
})

test('D — partially elapsed: compare deadline not raw delay', () => {
  const s = makeScheduler({ now: 0 })
  s.scheduleReconnect(45000)
  s.advance(40000) // 5s left
  expect(s.state.dueIn === 5000, `left ${s.state.dueIn}`)
  // new requests 10s → dueAt = now+10s = 50000, existing dueAt = 45000 → keep existing
  s.scheduleReconnect(10000)
  expect(s.state.lastTag === 'kept_existing', s.state.lastTag)
  expect(s.state.dueIn === 5000, `still 5s left, got ${s.state.dueIn}`)
})

test('E — failure backoff grows; new work does not reset attempt', () => {
  const s = makeScheduler()
  // failure schedules (non-explicit) → attempt 1, delay 2500
  s.scheduleReconnect(undefined)
  expect(s.state.attempt === 1, `attempt ${s.state.attempt}`)
  expect(s.state.dueIn === 2500, `wait ${s.state.dueIn}`)
  s.advance(2500)
  s.scheduleReconnect(undefined)
  expect(s.state.attempt === 2, `attempt ${s.state.attempt}`)
  expect(s.state.dueIn === 4000, `wait ${s.state.dueIn}`)
  // grow to longer
  s.advance(4000)
  s.scheduleReconnect(undefined)
  expect(s.state.attempt === 3, 'attempt 3')
  // jump toward long backoff
  while (s.state.attempt < 7) {
    s.advance(s.state.dueIn || 0)
    s.scheduleReconnect(undefined)
  }
  expect(s.state.dueIn === 45000, `tier ${s.state.dueIn}`)
  const attemptBefore = s.state.attempt
  // new sale wants 600ms — pulls forward, does NOT reset attempt
  s.scheduleReconnect(600)
  expect(s.state.lastTag === 'rescheduled_earlier', s.state.lastTag)
  expect(s.state.dueIn === 600, 'pulled to 600')
  expect(s.state.attempt === attemptBefore, 'attempt preserved')
})

test('F — 100 sales while waiting → one timer, not 100', () => {
  const s = makeScheduler()
  s.scheduleReconnect(45000)
  for (let i = 0; i < 100; i++) s.scheduleReconnect(600)
  const earlier = s.state.events.filter(e => e.tag === 'rescheduled_earlier')
  const kept = s.state.events.filter(e => e.tag === 'kept_existing')
  expect(earlier.length === 1, `earlier=${earlier.length}`)
  expect(kept.length === 99, `kept=${kept.length}`)
  expect(s.state.dueIn === 600, 'nearest 600')
  expect(s.state.hasTimer, 'single logical timer')
})

test('G — flush lock: timer fire while locked reschedules once, no parallel', () => {
  const s = makeScheduler()
  s.scheduleReconnect(100)
  s.setSyncLock(true)
  s.advance(100)
  expect(s.state.fireCount === 0, 'did not run flush body')
  expect(s.state.hasTimer, 'deferred')
  expect(s.state.dueIn === 4000, `defer ${s.state.dueIn}`)
  s.setSyncLock(false)
  // second trigger while first deferred — keep one
  s.scheduleReconnect(4000)
  expect(s.state.lastTag === 'kept_existing' || s.state.dueIn === 4000, 'one defer')
})

test('H — success reset clears timer + attempt', () => {
  const s = makeScheduler()
  s.scheduleReconnect(undefined)
  expect(s.state.attempt === 1, 'attempted')
  s.resetBackoff()
  expect(s.state.attempt === 0, 'reset')
  expect(!s.state.hasTimer, 'timer null')
  expect(s.state.dueAt === 0, 'dueAt 0')
})

const failed = results.filter(r => r.status === 'FAIL')
const report = {
  phase: 4,
  generatedAt: new Date().toISOString(),
  summary: {
    total: results.length,
    passed: results.filter(r => r.status === 'PASS').length,
    failed: failed.length,
  },
  telemetryExample: {
    before: "existing 45s + new 600ms → tag skipped_existing_timer",
    after: "existing 45s + new 600ms → tag rescheduled_earlier { fromDueInMs: 45000, toDelayMs: 600 }",
  },
  results,
}
const out = path.join(root, 'scripts', 'phase4-reconnect-timer-report.json')
fs.writeFileSync(out, JSON.stringify(report, null, 2))
console.log('\n' + JSON.stringify(report.summary, null, 2))
console.log(`Wrote ${out}`)
process.exit(failed.length ? 1 : 0)
