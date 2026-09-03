/**
 * Избранное кассы — отдельно для каждого сотрудника «Торговля».
 * localStorage на ПК/Android иногда сбрасывается → дублируем в локальную базу.
 */
import { androidPersist } from './androidPersist'
import { getKakapoDesktop, isKakapoDesktop } from './desktopBridge'
import { loadLastTradeEmployeeId, loadTradeEmployeeSession } from './employeeSession'

const LS_MAP_KEY = 'kakapo_pos_favorites_by_employee'
const LS_LEGACY_KEY = 'kakapo_pos_favorites'
const DB_KEY = 'pos_favorites_by_employee_v1'
const SETTINGS_KEY = 'kakapo_trade_pos_settings'

export type PosFavMap = Record<string, number[]>

let memory: PosFavMap = {}
let readyPromise: Promise<void> | null = null

function parseFavIdList(arr: unknown): number[] {
  if (!Array.isArray(arr)) return []
  return arr.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0)
}

function parseMap(raw: unknown): PosFavMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: PosFavMap = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    out[k] = parseFavIdList(v)
  }
  return out
}

function mergeMaps(a: PosFavMap, b: PosFavMap): PosFavMap {
  const out: PosFavMap = { ...a }
  for (const [k, ids] of Object.entries(b || {})) {
    const prev = out[k] || []
    out[k] = [...new Set([...prev, ...ids])]
  }
  return out
}

function readLocal(): PosFavMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(LS_MAP_KEY)
    if (!raw) return {}
    return parseMap(JSON.parse(raw))
  } catch {
    return {}
  }
}

function writeLocal(map: PosFavMap) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(LS_MAP_KEY, JSON.stringify(map))
  } catch { /* quota */ }
}

function readLegacyList(): number[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(LS_LEGACY_KEY)
    if (!raw) return []
    return parseFavIdList(JSON.parse(raw))
  } catch {
    return []
  }
}

async function readRemote(): Promise<PosFavMap> {
  const android = androidPersist()
  if (android) {
    try {
      const v = await android.kvGet(DB_KEY)
      if (v && typeof v === 'object') return parseMap(v)
    } catch { /* fallback */ }
  }
  const desk = getKakapoDesktop()
  if (isKakapoDesktop() && desk?.localDbKvGet) {
    try {
      const v = await desk.localDbKvGet(DB_KEY)
      if (v && typeof v === 'object') return parseMap(v)
    } catch { /* fallback */ }
  }
  return {}
}

function writeRemote(map: PosFavMap) {
  const desk = getKakapoDesktop()
  if (isKakapoDesktop() && desk?.localDbKvSet) {
    void Promise.resolve(desk.localDbKvSet(DB_KEY, map)).catch(() => { /* ignore */ })
  }
  const android = androidPersist()
  if (android) {
    void Promise.resolve(android.kvSet(DB_KEY, map)).catch(() => { /* ignore */ })
  }
}

function current(): PosFavMap {
  memory = mergeMaps(readLocal(), memory)
  return memory
}

function persist(map: PosFavMap) {
  memory = map
  writeLocal(map)
  writeRemote(map)
}

/** Ключ владельца: сотрудник Trade → его профиль; иначе кассир смены. */
export function posFavOwnerKey(employeeId?: string, cashierId?: string): string {
  const empId = String(
    employeeId
    || loadTradeEmployeeSession()?.employeeId
    || loadLastTradeEmployeeId()
    || '',
  ).trim()
  if (empId) return `emp:${empId}`
  const cid = String(cashierId || '').trim()
  if (cid) return `cashier:${cid}`
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const fromSettings = String((JSON.parse(raw) as { cashierId?: string }).cashierId || '').trim()
      if (fromSettings) return `cashier:${fromSettings}`
    }
  } catch { /* ignore */ }
  return 'default'
}

function migrateLegacyForOwner(map: PosFavMap, owner: string, cashierId?: string): PosFavMap {
  if (map[owner]?.length) return map
  const legacy = readLegacyList()
  if (legacy.length) {
    map[owner] = legacy
    try { localStorage.removeItem(LS_LEGACY_KEY) } catch { /* ignore */ }
    return map
  }
  if (owner.startsWith('emp:') && cashierId) {
    const cashierOwner = `cashier:${cashierId}`
    if (map[cashierOwner]?.length) {
      map[owner] = [...map[cashierOwner]]
    }
  }
  return map
}

/** Синхронно — из памяти / localStorage (после ensurePosFavoritesReady там полная карта). */
export function loadPosFavIds(owner?: string, cashierId?: string): number[] {
  const key = owner || posFavOwnerKey(undefined, cashierId)
  try {
    let map = current()
    map = migrateLegacyForOwner(map, key, cashierId)
    if (map !== memory) persist(map)
    return map[key] || []
  } catch {
    return []
  }
}

export function savePosFavIds(ids: number[], owner?: string, cashierId?: string) {
  const key = owner || posFavOwnerKey(undefined, cashierId)
  const map = current()
  map[key] = ids
  persist(map)
}

/** Подтянуть из SQLite / Android KV и слить с localStorage. */
export function ensurePosFavoritesReady(): Promise<void> {
  if (readyPromise) return readyPromise
  readyPromise = (async () => {
    memory = mergeMaps(readLocal(), memory)
    const remote = await readRemote()
    if (Object.keys(remote).length) memory = mergeMaps(memory, remote)
    persist(memory)
  })()
  return readyPromise
}

if (typeof window !== 'undefined') void ensurePosFavoritesReady()
