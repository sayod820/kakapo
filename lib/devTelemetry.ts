/**
 * Phase 0 — development telemetry for Trade/Cashier local-first.
 * Off by default in production builds unless explicitly enabled:
 *   localStorage.setItem('kakapo_perf', '1')
 *   or window.__kakapoPerf.enable()
 * Never throws; never changes business logic.
 */

export type PerfMetricName =
  | 'sale_local_ms'
  | 'cashier_render'
  | 'products_array_replace'
  | 'queue_size'
  | 'oldest_pending_age_ms'
  | 'sync_push_ms'
  | 'sync_pull_ms'
  | 'soft_sync'
  | 'sqlite_write_ms'
  | 'pos_snapshot_persist_ms'
  | 'catalog_persist_ms'
  | 'reconnect_scheduled_delay_ms'
  | 'register_entry_ms'
  | 'local_transaction_ms'
  | 'ws_event_count'
  | 'ws_sync_run_count'
  | 'ws_coalesced_count'
  | 'snapshot_write_count'
  | 'catalog_write_count'
  | 'snapshot_payload_bytes'
  | 'catalog_payload_bytes'

type Sample = { t: number; ms?: number; n?: number; tag?: string; extra?: Record<string, unknown> }

type MetricBucket = {
  count: number
  sumMs: number
  maxMs: number
  lastMs: number
  lastAt: number
  samples: Sample[]
}

const MAX_SAMPLES = 80
const buckets = new Map<PerfMetricName, MetricBucket>()

type SoftSyncKind = 'pos' | 'warehouse' | 'finance' | 'other'

let enabledCache: boolean | null = null
let bootLogged = false

function emptyBucket(): MetricBucket {
  return { count: 0, sumMs: 0, maxMs: 0, lastMs: 0, lastAt: 0, samples: [] }
}

function bucket(name: PerfMetricName): MetricBucket {
  let b = buckets.get(name)
  if (!b) {
    b = emptyBucket()
    buckets.set(name, b)
  }
  return b
}

function readFlag(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const w = window as Window & { __kakapoPerfForce?: boolean }
    if (w.__kakapoPerfForce === true) return true
    if (w.__kakapoPerfForce === false) return false
    if (localStorage.getItem('kakapo_perf') === '1') return true
    if (/[?&]kakapo_perf=1(?:&|$)/.test(window.location.search || '')) return true
  } catch { /* ignore */ }
  return process.env.NODE_ENV === 'development'
}

export function isPerfEnabled(): boolean {
  if (enabledCache == null) enabledCache = readFlag()
  return enabledCache
}

export function setPerfEnabled(on: boolean): void {
  enabledCache = on
  if (typeof window === 'undefined') return
  try {
    ;(window as Window & { __kakapoPerfForce?: boolean }).__kakapoPerfForce = on
    if (on) localStorage.setItem('kakapo_perf', '1')
    else localStorage.removeItem('kakapo_perf')
  } catch { /* ignore */ }
  if (on) ensureWindowApi()
}

function pushSample(name: PerfMetricName, sample: Sample, ms?: number): void {
  const b = bucket(name)
  b.count += 1
  b.lastAt = sample.t
  if (ms != null && Number.isFinite(ms)) {
    b.sumMs += ms
    b.lastMs = ms
    if (ms > b.maxMs) b.maxMs = ms
  }
  b.samples.push(sample)
  if (b.samples.length > MAX_SAMPLES) b.samples.splice(0, b.samples.length - MAX_SAMPLES)
}

function logLine(msg: string, data?: Record<string, unknown>): void {
  if (!isPerfEnabled()) return
  try {
    if (data) console.debug(`[kakapo:perf] ${msg}`, data)
    else console.debug(`[kakapo:perf] ${msg}`)
  } catch { /* ignore */ }
}

/** Mark start; returns end() that records duration under `name`. */
export function perfTime(name: PerfMetricName, tag?: string, extra?: Record<string, unknown>): () => number {
  if (!isPerfEnabled()) return () => 0
  const t0 = performance.now()
  return () => {
    const ms = performance.now() - t0
    pushSample(name, { t: Date.now(), ms, tag, extra }, ms)
    logLine(name, { ms: Math.round(ms * 10) / 10, tag, ...extra })
    return ms
  }
}

export function perfCount(name: PerfMetricName, n = 1, tag?: string, extra?: Record<string, unknown>): void {
  if (!isPerfEnabled()) return
  pushSample(name, { t: Date.now(), n, tag, extra })
  if (name === 'cashier_render' || name === 'products_array_replace') {
    // high-frequency: only log every 25th to keep console usable
    const b = bucket(name)
    if (b.count % 25 === 1) logLine(name, { count: b.count, tag, ...extra })
    return
  }
  logLine(name, { n, tag, ...extra })
}

export function perfNote(name: PerfMetricName, ms: number, tag?: string, extra?: Record<string, unknown>): void {
  if (!isPerfEnabled()) return
  pushSample(name, { t: Date.now(), ms, tag, extra }, ms)
  logLine(name, { ms: Math.round(ms * 10) / 10, tag, ...extra })
}

export function perfSoftSync(kind: SoftSyncKind, extra?: Record<string, unknown>): void {
  perfCount('soft_sync', 1, kind, extra)
}

export function perfSnapshot(): Record<string, {
  count: number
  avgMs: number | null
  maxMs: number
  lastMs: number
  lastAt: number
  recent: Sample[]
}> {
  const out: Record<string, {
    count: number
    avgMs: number | null
    maxMs: number
    lastMs: number
    lastAt: number
    recent: Sample[]
  }> = {}
  for (const [name, b] of buckets) {
    out[name] = {
      count: b.count,
      avgMs: b.count && b.sumMs ? Math.round((b.sumMs / b.count) * 10) / 10 : null,
      maxMs: Math.round(b.maxMs * 10) / 10,
      lastMs: Math.round(b.lastMs * 10) / 10,
      lastAt: b.lastAt,
      recent: b.samples.slice(-10),
    }
  }
  return out
}

export function perfReset(): void {
  buckets.clear()
  logLine('reset')
}

export function perfScenario(label: string): void {
  if (!isPerfEnabled()) return
  logLine(`scenario:${label}`, { at: new Date().toISOString() })
  try {
    const w = window as Window & { __kakapoPerfScenarios?: string[] }
    if (!w.__kakapoPerfScenarios) w.__kakapoPerfScenarios = []
    w.__kakapoPerfScenarios.push(`${new Date().toISOString()} ${label}`)
  } catch { /* ignore */ }
}

function ensureWindowApi(): void {
  if (typeof window === 'undefined') return
  if (bootLogged) return
  bootLogged = true
  const api = {
    enable: () => setPerfEnabled(true),
    disable: () => setPerfEnabled(false),
    enabled: () => isPerfEnabled(),
    snapshot: () => perfSnapshot(),
    reset: () => perfReset(),
    scenario: (label: string) => perfScenario(label),
    mark: (name: PerfMetricName, ms?: number, tag?: string) => {
      if (ms != null) perfNote(name, ms, tag)
      else perfCount(name, 1, tag)
    },
  }
  ;(window as Window & { __kakapoPerf?: typeof api }).__kakapoPerf = api
  if (isPerfEnabled()) {
    console.info('[kakapo:perf] enabled — window.__kakapoPerf.snapshot() / .scenario("scan")')
  }
}

if (typeof window !== 'undefined') {
  try { ensureWindowApi() } catch { /* ignore */ }
}
