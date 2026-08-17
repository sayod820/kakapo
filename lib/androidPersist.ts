const CHUNK = 80000

type Bridge = {
  kvGet: (key: string) => string
  kvSet: (key: string, json: string) => boolean
  kvDelete: (key: string) => boolean
  queueAll: () => string
  queuePut: (json: string) => boolean
  queueDelete: (clientRef: string) => boolean
  spillSlice?: (id: string, off: number, n: number) => string
  ingestBegin?: () => boolean
  ingestAppend?: (chunk: string) => boolean
  ingestKvSet?: (key: string) => boolean
  ingestQueuePut?: () => boolean
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function bridge(): Bridge | null {
  if (typeof window === 'undefined') return null
  try {
    const b = (window as Window & { KakapoAndroid?: Partial<Bridge> }).KakapoAndroid
    if (!b || typeof b.kvGet !== 'function' || typeof b.queuePut !== 'function') return null
    return b as Bridge
  } catch {
    return null
  }
}

async function fromBridge(b: Bridge, raw: string): Promise<unknown> {
  const parsed = parseJson(raw)
  if (!parsed || typeof parsed !== 'object') return parsed
  const meta = parsed as { __kakapoSpill?: string; len?: number }
  if (!meta.__kakapoSpill || typeof b.spillSlice !== 'function') return parsed
  const len = Number(meta.len) || 0
  let s = ''
  for (let i = 0; i < len; i += CHUNK) {
    s += b.spillSlice(meta.__kakapoSpill, i, CHUNK) || ''
    if (i > 0 && i % (CHUNK * 6) === 0) await new Promise(r => window.setTimeout(r, 0))
  }
  return parseJson(s)
}

function sendJson(b: Bridge, json: string, small: (s: string) => boolean, commit: () => boolean): boolean {
  if (json.length <= CHUNK * 2 || typeof b.ingestBegin !== 'function') return small(json)
  try {
    b.ingestBegin()
    for (let i = 0; i < json.length; i += CHUNK) b.ingestAppend?.(json.slice(i, i + CHUNK))
    return commit()
  } catch {
    return false
  }
}

export function androidPersist() {
  const b = bridge()
  if (!b) return null
  return {
    kvGet: async (key: string) => fromBridge(b, b.kvGet(String(key || ''))),
    kvSet: async (key: string, value: unknown) => {
      const json = JSON.stringify(value)
      return sendJson(b, json, s => !!b.kvSet(String(key || ''), s), () => !!b.ingestKvSet?.(String(key || '')))
    },
    kvDelete: async (key: string) => !!b.kvDelete(String(key || '')),
    queueAll: async () => {
      const parsed = await fromBridge(b, b.queueAll())
      return Array.isArray(parsed) ? parsed : []
    },
    queuePut: async (row: unknown) => {
      const json = JSON.stringify(row)
      return sendJson(b, json, s => !!b.queuePut(s), () => !!b.ingestQueuePut?.())
    },
    queueDelete: async (clientRef: string) => !!b.queueDelete(String(clientRef || '')),
  }
}
