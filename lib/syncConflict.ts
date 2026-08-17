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
  return [...map.values()]
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
