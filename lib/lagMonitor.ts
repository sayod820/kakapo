/**
 * Always-on lightweight freeze monitor for the cashier screen.
 * Long tasks (main thread busy ≥ 200 ms) and slow input events are attributed to
 * recent lagMark() labels and sent as one short report every few minutes.
 * Never throws; never changes business logic.
 */

type Mark = { t: number; k: string }
type LongTask = { start: number; dur: number }
type SlowEvent = { name: string; dur: number; delay: number; target: string }

const MARKS_MAX = 600
const LONG_TASK_MIN_MS = 200
const SLOW_EVENT_MIN_MS = 150
const REPORT_EVERY_MS = 3 * 60_000

let started = false
const marks: Mark[] = []
let longTasks: LongTask[] = []
let slowEvents: SlowEvent[] = []
let renders = 0
let navs: { page: string; ms: number }[] = []
let navPending: { page: string; t: number } | null = null
let contextProvider: (() => Record<string, string | number | boolean | undefined>) | null = null
let sender: ((message: string, context: Record<string, string | number | boolean | undefined>) => void) | null = null

export function lagMark(k: string): void {
  if (!started) return
  marks.push({ t: performance.now(), k })
  if (marks.length > MARKS_MAX) marks.splice(0, marks.length - MARKS_MAX)
}

export function lagRender(): void {
  if (started) renders += 1
}

/** Section switch clicked; lagNavShown() closes the measurement once the new section is painted. */
export function lagNavStart(page: string): void {
  if (!started) return
  lagMark(`nav:${page}`)
  navPending = { page, t: performance.now() }
}

export function lagNavShown(page: string): void {
  const p = navPending
  if (!started || !p || p.page !== page) return
  navPending = null
  const done = () => {
    navs.push({ page, ms: performance.now() - p.t })
    if (navs.length > 200) navs.splice(0, navs.length - 200)
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(done, 0))
  else done()
}

export function setLagContextProvider(fn: typeof contextProvider): void {
  contextProvider = fn
}

function marksIn(from: number, to: number): string[] {
  const out: string[] = []
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i]
    if (m.t < from) break
    if (m.t <= to) out.push(m.k)
  }
  return out
}

function topEntries(weights: Map<string, number>, n: number): string {
  return [...weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k}:${Math.round(v)}`)
    .join(' ')
}

function flush(): void {
  if (!sender) return
  const tasks = longTasks
  const events = slowEvents
  const renderCount = renders
  const navList = navs
  longTasks = []
  slowEvents = []
  renders = 0
  navs = []
  if (!tasks.length && !events.length && !navList.length) return

  const byNav = new Map<string, number>()
  let navMax = 0
  for (const n of navList) {
    byNav.set(n.page, Math.max(byNav.get(n.page) || 0, n.ms))
    if (n.ms > navMax) navMax = n.ms
  }

  const byMark = new Map<string, number>()
  let totalMs = 0
  let maxMs = 0
  for (const task of tasks) {
    totalMs += task.dur
    if (task.dur > maxMs) maxMs = task.dur
    const ks = new Set(marksIn(task.start - 30, task.start + task.dur + 30))
    if (!ks.size) ks.add('?')
    for (const k of ks) byMark.set(k, (byMark.get(k) || 0) + task.dur)
  }
  const byEvent = new Map<string, number>()
  let evMax = 0
  let evDelayMax = 0
  for (const ev of events) {
    const k = `${ev.name}@${ev.target}`
    byEvent.set(k, Math.max(byEvent.get(k) || 0, ev.dur))
    if (ev.dur > evMax) evMax = ev.dur
    if (ev.delay > evDelayMax) evDelayMax = ev.delay
  }

  let extra: Record<string, string | number | boolean | undefined> = {}
  try { extra = contextProvider?.() || {} } catch { /* ignore */ }

  sender(`long ${tasks.length} / ${Math.round(totalMs)}ms, max ${Math.round(maxMs)}ms`, {
    ltN: tasks.length,
    ltMs: Math.round(totalMs),
    ltMax: Math.round(maxMs),
    ltTop: topEntries(byMark, 5),
    evN: events.length,
    evMax: Math.round(evMax),
    evDelayMax: Math.round(evDelayMax),
    evTop: topEntries(byEvent, 3),
    renders: renderCount,
    navN: navList.length,
    navMax: Math.round(navMax),
    navTop: topEntries(byNav, 5),
    shell: typeof window !== 'undefined' && (window as { kakapoDesktop?: { isDesktop?: boolean } }).kakapoDesktop?.isDesktop ? 'desktop' : 'web',
    ...extra,
  })
}

export function startLagMonitor(
  send: (message: string, context: Record<string, string | number | boolean | undefined>) => void,
): void {
  sender = send
  if (started || typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return
  started = true
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        if (e.duration >= LONG_TASK_MIN_MS) longTasks.push({ start: e.startTime, dur: e.duration })
      }
      if (longTasks.length > 500) longTasks.splice(0, longTasks.length - 500)
    }).observe({ type: 'longtask', buffered: false })
  } catch { /* longtask unsupported */ }
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries() as PerformanceEventTiming[]) {
        if (e.duration < SLOW_EVENT_MIN_MS) continue
        const el = e.target as HTMLElement | null
        const target = el
          ? `${el.tagName || '?'}${el.getAttribute?.('data-lag') ? `.${el.getAttribute('data-lag')}` : ''}`
          : '-'
        slowEvents.push({ name: e.name, dur: e.duration, delay: e.processingStart - e.startTime, target })
      }
      if (slowEvents.length > 500) slowEvents.splice(0, slowEvents.length - 500)
    }).observe({ type: 'event', buffered: false, durationThreshold: 104 } as PerformanceObserverInit)
  } catch { /* event timing unsupported */ }
  window.setInterval(() => {
    try { flush() } catch { /* ignore */ }
  }, REPORT_EVERY_MS)
}
