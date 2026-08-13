/** Номер операции кассы: своя лента 1, 2, 3… на каждую точку (онлайн и офлайн). */

const KEY = 'kakapo-pos-opseq-v1'

function posKey(posId: string) {
  return String(posId || '').trim() || 'POS-DEFAULT'
}

function readMap(): Record<string, number> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, number>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeMap(map: Record<string, number>) {
  if (typeof window === 'undefined') return
  localStorage.setItem(KEY, JSON.stringify(map))
}

/** Подтянуть локальный счётчик, если с сервера пришли чеки / точки с большим номером. */
export function notePosOpSeq(posId: string, seq: number) {
  const id = posKey(posId)
  const n = Math.floor(Number(seq) || 0)
  if (n <= 0) return
  const map = readMap()
  if (n > (Number(map[id]) || 0)) {
    map[id] = n
    writeMap(map)
  }
}

export function notePosOpSeqFromSales(sales: { posId?: string; opSeq?: number }[] | undefined | null) {
  if (!sales?.length) return
  const maxByPos = new Map<string, number>()
  for (const s of sales) {
    const id = posKey(s.posId || '')
    const n = Math.floor(Number(s.opSeq) || 0)
    if (n > (maxByPos.get(id) || 0)) maxByPos.set(id, n)
  }
  for (const [id, n] of maxByPos) notePosOpSeq(id, n)
}

export function notePosOpSeqFromPoints(points: { id?: string; opSeq?: number }[] | undefined | null) {
  if (!points?.length) return
  for (const p of points) {
    notePosOpSeq(String(p.id || ''), Number(p.opSeq) || 0)
  }
}

/** Следующий номер операции этой кассы. Не сбрасывается при обновлении страницы. */
export function allocPosOpSeq(posId: string): number {
  const id = posKey(posId)
  const map = readMap()
  const next = (Number(map[id]) || 0) + 1
  map[id] = next
  writeMap(map)
  return next
}
