/**
 * LWW + журнал конфликтов для двустороннего синка.
 */
import { getKakapoDesktop, isKakapoDesktop } from './desktopBridge'

export type ConflictEntry = {
  at: string
  kind: string
  id: string
  localAt?: string
  remoteAt?: string
  note: string
}

function stampOf(row: unknown): string {
  if (!row || typeof row !== 'object') return ''
  const o = row as Record<string, unknown>
  return String(o.updatedAtIso || o.updatedAt || o.createdAtIso || o.createdAt || '')
}

/** true = взять remote */
export function shouldTakeRemoteLww(local: unknown, remote: unknown): boolean {
  const la = Date.parse(stampOf(local) || '')
  const ra = Date.parse(stampOf(remote) || '')
  if (!Number.isFinite(ra)) return false
  if (!Number.isFinite(la)) return true
  return ra >= la
}

export function mergeByIdLww<T extends { id?: string | number }>(
  localList: T[],
  remoteList: T[],
  onConflict?: (local: T, remote: T) => void,
): T[] {
  const map = new Map<string, T>()
  for (const row of localList || []) {
    const id = String(row?.id ?? '')
    if (id) map.set(id, row)
  }
  for (const remote of remoteList || []) {
    const id = String(remote?.id ?? '')
    if (!id) continue
    const local = map.get(id)
    if (!local) {
      map.set(id, remote)
      continue
    }
    if (shouldTakeRemoteLww(local, remote)) {
      if (stampOf(local) && stampOf(remote) && stampOf(local) !== stampOf(remote)) {
        onConflict?.(local, remote)
      }
      map.set(id, { ...local, ...remote })
    }
  }
  return [...map.values()]
}

/** Append-only merge (продажи/документы): remote wins on same id, keep local-only */
export function mergeAppendById<T extends { id?: string | number; clientRef?: string }>(
  localList: T[],
  remoteList: T[],
): T[] {
  const map = new Map<string, T>()
  const byRef = new Map<string, string>()
  for (const row of localList || []) {
    const id = String(row?.id ?? '')
    if (!id) continue
    map.set(id, row)
    if (row.clientRef) byRef.set(String(row.clientRef), id)
  }
  for (const remote of remoteList || []) {
    const ref = remote.clientRef ? String(remote.clientRef) : ''
    if (ref && byRef.has(ref)) {
      const localId = byRef.get(ref)!
      map.delete(localId)
      map.set(String(remote.id), remote)
      byRef.set(ref, String(remote.id))
      continue
    }
    const id = String(remote?.id ?? '')
    if (!id) continue
    map.set(id, remote)
  }
  return [...map.values()].filter(row => !isUnlinkedLocalGhost(row, map))
}

/**
 * Входящий синк: серверные id — как на сервере (удалённые пропадают),
 * локальные off-* остаются, пока не склеены по clientRef.
 */
export function mergeInboundById<T extends { id?: string | number; clientRef?: string }>(
  localList: T[],
  remoteList: T[],
): T[] {
  const merged = mergeAppendById(localList, remoteList)
  const remoteIds = new Set((remoteList || []).map(r => String(r?.id ?? '')).filter(Boolean))
  return merged.filter(row => {
    const id = String(row?.id ?? '')
    if (!id) return false
    if (id.startsWith('off-')) return true
    return remoteIds.has(id)
  })
}

function isLocalEntityId(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith('off-')
}

/**
 * Старый локальный off-id без clientRef: после синка рядом лежит серверная копия.
 * Новые операции всегда пишут clientRef — их не трогаем.
 */
function isUnlinkedLocalGhost<T extends { id?: string | number; clientRef?: string; amount?: number; type?: string; createdAtIso?: string; shiftId?: string }>(
  row: T,
  map: Map<string, T>,
): boolean {
  const id = String(row?.id ?? '')
  if (!isLocalEntityId(id)) return false
  if (String(row.clientRef || '').trim()) return false
  const kind = String(row.type || '')
  if (kind !== 'deposit' && kind !== 'withdraw') return false
  const others = [...map.values()].filter(x => String(x?.id ?? '') !== id && !isLocalEntityId(x?.id))
  const ts = Date.parse(String(row.createdAtIso || ''))
  const twins = others.filter(o => {
    if (row.type && o.type && row.type !== o.type) return false
    if (Math.abs((Number(row.amount) || 0) - (Number(o.amount) || 0)) > 0.009) return false
    if (row.shiftId && o.shiftId && String(row.shiftId) !== String(o.shiftId)) return false
    const ot = Date.parse(String(o.createdAtIso || ''))
    if (Number.isFinite(ts) && Number.isFinite(ot) && Math.abs(ts - ot) > 20_000) return false
    return true
  })
  return twins.length >= 1
}

export async function appendConflictLog(entry: Omit<ConflictEntry, 'at'> & { at?: string }): Promise<void> {
  const row: ConflictEntry = {
    at: entry.at || new Date().toISOString(),
    kind: entry.kind,
    id: entry.id,
    localAt: entry.localAt,
    remoteAt: entry.remoteAt,
    note: entry.note,
  }
  const desk = getKakapoDesktop()
  if (isKakapoDesktop() && desk?.localDbMetaGet && desk?.localDbMetaPatch) {
    try {
      const meta = await desk.localDbMetaGet()
      const prev = Array.isArray(meta.syncConflicts) ? meta.syncConflicts as ConflictEntry[] : []
      const next = [row, ...prev].slice(0, 200)
      await desk.localDbMetaPatch({ syncConflicts: next })
      return
    } catch { /* ignore */ }
  }
  try {
    const raw = localStorage.getItem('kakapo_sync_conflicts')
    const prev = raw ? JSON.parse(raw) as ConflictEntry[] : []
    localStorage.setItem('kakapo_sync_conflicts', JSON.stringify([row, ...prev].slice(0, 200)))
  } catch { /* ignore */ }
}
