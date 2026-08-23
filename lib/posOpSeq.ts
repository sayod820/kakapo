/**
 * Номер операции кассы: своя лента 1, 2, 3… на каждую точку (онлайн и офлайн).
 *
 * На этой ленте держится защита склада от двойного списания: ревизия пишет
 * срез номеров (posCuts), а сервер по нему отличает поздний офлайн-чек.
 * Поэтому счётчик живёт в локальной базе ПК, а localStorage — только запасной
 * слой для браузера. Читаем всегда больший номер из двух: назад лента не едет.
 */
import { getKakapoDesktop, isKakapoDesktop } from './desktopBridge'

const KEY = 'kakapo-pos-opseq-v1'
const DB_KEY = 'pos_opseq_v1'

type SeqMap = Record<string, number>

let memory: SeqMap = {}
let readyPromise: Promise<void> | null = null

function posKey(posId: string, deviceId?: string) {
  const pos = String(posId || '').trim() || 'POS-DEFAULT'
  const dev = String(deviceId || '').trim()
  return dev ? `${pos}::${dev}` : pos
}

function readLocal(): SeqMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as SeqMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeLocal(map: SeqMap) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch { /* quota */ }
}

async function readDb(): Promise<SeqMap> {
  const desk = getKakapoDesktop()
  if (!isKakapoDesktop() || !desk?.localDbKvGet) return {}
  try {
    const value = await desk.localDbKvGet(DB_KEY)
    return value && typeof value === 'object' ? (value as SeqMap) : {}
  } catch {
    return {}
  }
}

function writeDb(map: SeqMap) {
  const desk = getKakapoDesktop()
  if (!isKakapoDesktop() || !desk?.localDbKvSet) return
  void Promise.resolve(desk.localDbKvSet(DB_KEY, map)).catch(() => { /* ignore */ })
}

/** Слить две ленты, оставив больший номер по каждой точке */
function mergeMax(base: SeqMap, extra: SeqMap): SeqMap {
  const out: SeqMap = { ...base }
  for (const [id, raw] of Object.entries(extra || {})) {
    const n = Math.floor(Number(raw) || 0)
    if (n > (Number(out[id]) || 0)) out[id] = n
  }
  return out
}

/** Актуальная лента: память + localStorage (его могли обновить в другой вкладке) */
function current(): SeqMap {
  memory = mergeMax(readLocal(), memory)
  return memory
}

function persist(map: SeqMap) {
  memory = map
  writeLocal(map)
  writeDb(map)
}

function bump(map: SeqMap, posId: string, seq: number, deviceId?: string): boolean {
  const id = posKey(posId, deviceId)
  const n = Math.floor(Number(seq) || 0)
  if (n <= 0 || n <= (Number(map[id]) || 0)) return false
  map[id] = n
  return true
}

/**
 * Поднять ленту с диска ПК до первой выдачи номера.
 * Если localStorage стёрли, а в SQLite лента есть — без этого чек получил бы
 * номер ниже среза ревизии, и склад списался бы вторично.
 */
export function ensurePosOpSeqReady(): Promise<void> {
  if (readyPromise) return readyPromise
  readyPromise = (async () => {
    memory = mergeMax(readLocal(), memory)
    const fromDb = await readDb()
    if (Object.keys(fromDb).length) memory = mergeMax(memory, fromDb)
    persist(memory)
  })()
  return readyPromise
}

/** Подтянуть локальный счётчик, если с сервера пришли чеки / точки с большим номером. */
export function notePosOpSeq(posId: string, seq: number, deviceId?: string) {
  const map = current()
  if (bump(map, posId, seq, deviceId)) persist(map)
}

export function notePosOpSeqFromSales(sales: { posId?: string; opSeq?: number; deviceId?: string }[] | undefined | null) {
  if (!sales?.length) return
  const map = current()
  let changed = false
  for (const s of sales) {
    if (bump(map, String(s.posId || ''), Number(s.opSeq) || 0, s.deviceId)) changed = true
  }
  if (changed) persist(map)
}

export function notePosOpSeqFromPoints(points: { id?: string; opSeq?: number }[] | undefined | null) {
  if (!points?.length) return
  const map = current()
  let changed = false
  for (const p of points) {
    if (bump(map, String(p.id || ''), Number(p.opSeq) || 0)) changed = true
  }
  if (changed) persist(map)
}

/** Следующий номер операции этого аппарата на этой точке. */
export function allocPosOpSeq(posId: string, deviceId?: string): number {
  const id = posKey(posId, deviceId)
  const map = current()
  const next = (Number(map[id]) || 0) + 1
  map[id] = next
  persist(map)
  return next
}

/** Снимок лент opSeq для heartbeat / ревизии */
export function getPosOpSeqSnapshot(): Record<string, number> {
  const map = current()
  return { ...map }
}

// Лента нужна уже к первому чеку — греем сразу при загрузке модуля
if (typeof window !== 'undefined') void ensurePosOpSeqReady()
