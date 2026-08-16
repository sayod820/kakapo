import type { KakapoDesktopApi } from './desktopBridge'

type AndroidDbBridge = {
  kvGet: (key: string) => string
  kvSet: (key: string, json: string) => boolean
  kvDelete: (key: string) => boolean
  queueAll: () => string
  queuePut: (json: string) => boolean
  queueDelete: (clientRef: string) => boolean
  metaGet: () => string
  metaPatch: (json: string) => boolean
  markInstalled: () => boolean
  mirrorPut: (json: string) => boolean
  mirrorGet: (kind: string, id: string) => string
  mirrorList: (kind: string, limit: number) => string
  entityPut: (json: string) => boolean
  entityPutMany: (json: string) => boolean
  entityGet: (kind: string, id: string) => string
  entityList: (kind: string, optsJson: string) => string
  entityDelete: (kind: string, id: string) => boolean
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function androidBridge(): AndroidDbBridge | null {
  if (typeof window === 'undefined') return null
  try {
    const b = (window as Window & { KakapoAndroid?: Partial<AndroidDbBridge> }).KakapoAndroid
    if (!b || typeof b.kvGet !== 'function' || typeof b.kvSet !== 'function') return null
    if (typeof b.queueAll !== 'function' || typeof b.queuePut !== 'function') return null
    return b as AndroidDbBridge
  } catch {
    return null
  }
}

/** Тот же API, что у Electron SQLite — через нативный Android SQLite. */
export function getAndroidLocalDbApi(): KakapoDesktopApi | null {
  const b = androidBridge()
  if (!b) return null
  return {
    isDesktop: false,
    localDbKvGet: async key => parseJson(b.kvGet(String(key || ''))),
    localDbKvSet: async (key, value) => ({ ok: !!b.kvSet(String(key || ''), JSON.stringify(value)) }),
    localDbKvDelete: async key => ({ ok: !!b.kvDelete(String(key || '')) }),
    localDbQueueAll: async () => {
      const parsed = parseJson(b.queueAll())
      return Array.isArray(parsed) ? parsed : []
    },
    localDbQueuePut: async row => ({ ok: !!b.queuePut(JSON.stringify(row)) }),
    localDbQueueDelete: async clientRef => ({ ok: !!b.queueDelete(String(clientRef || '')) }),
    localDbMetaGet: async () => {
      const parsed = parseJson(b.metaGet())
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
    },
    localDbMetaPatch: async patch => {
      const ok = !!b.metaPatch(JSON.stringify(patch || {}))
      const meta = parseJson(b.metaGet())
      return { ok, meta: (meta && typeof meta === 'object' ? meta : {}) as Record<string, unknown> }
    },
    localDbMarkInstalled: async () => ({ ok: !!b.markInstalled(), bootstrapComplete: true }),
    localDbMirrorPut: async row => ({ ok: !!b.mirrorPut(JSON.stringify(row)) }),
    localDbMirrorGet: async (kind, id) => parseJson(b.mirrorGet(String(kind || ''), String(id || ''))),
    localDbMirrorList: async (kind, limit) => {
      const parsed = parseJson(b.mirrorList(String(kind || ''), Number(limit) || 200))
      return Array.isArray(parsed) ? parsed as never : []
    },
    localDbEntityPut: async row => ({ ok: !!b.entityPut(JSON.stringify(row)) }),
    localDbEntityPutMany: async rows => ({ ok: !!b.entityPutMany(JSON.stringify(rows || [])), count: Array.isArray(rows) ? rows.length : 0 }),
    localDbEntityGet: async (kind, id) => {
      const parsed = parseJson(b.entityGet(String(kind || ''), String(id || '')))
      if (!parsed || typeof parsed !== 'object') return null
      const row = parsed as { data?: unknown; updatedAtIso?: string }
      return { data: row.data, updatedAtIso: String(row.updatedAtIso || '') }
    },
    localDbEntityList: async (kind, opts) => {
      const parsed = parseJson(b.entityList(String(kind || ''), JSON.stringify(opts || {})))
      return Array.isArray(parsed) ? parsed as never : []
    },
  } as KakapoDesktopApi
}

export function androidQueueBridge() {
  const b = androidBridge()
  if (!b) return null
  return {
    queueAll: () => b.queueAll(),
    queuePut: (json: string) => b.queuePut(json),
    queueDelete: (clientRef: string) => b.queueDelete(clientRef),
  }
}

export function androidQueueAllRaw(): unknown[] {
  const b = androidBridge()
  if (!b) return []
  const parsed = parseJson(b.queueAll())
  return Array.isArray(parsed) ? parsed : []
}

export function androidQueuePutRaw(row: unknown): boolean {
  const b = androidBridge()
  if (!b) return false
  try {
    return !!b.queuePut(JSON.stringify(row))
  } catch {
    return false
  }
}

export function androidQueueDeleteRaw(clientRef: string): boolean {
  const b = androidBridge()
  if (!b) return false
  try {
    return !!b.queueDelete(String(clientRef || ''))
  } catch {
    return false
  }
}
