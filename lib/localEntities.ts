/**
 * Локальные сущности SQLite (Desktop) + fallback на KV.
 */
import { getKakapoDesktop, isKakapoDesktop } from './desktopBridge'

export type EntityKind =
  | 'product'
  | 'client'
  | 'category'
  | 'card'
  | 'stock_layer'
  | 'supplier'
  | 'sale'
  | 'shift'
  | 'receipt'
  | 'writeoff'
  | 'revision'
  | 'finance_move'
  | 'expense'

export type LocalEntityRow<T = unknown> = {
  kind: string
  id: string
  data: T
  updatedAtIso: string
  deleted?: boolean
}

export async function entityPut(
  kind: EntityKind | string,
  id: string,
  data: unknown,
  opts?: { updatedAtIso?: string; deleted?: boolean },
): Promise<boolean> {
  const desk = getKakapoDesktop()
  if (isKakapoDesktop() && desk?.localDbEntityPut) {
    const res = await desk.localDbEntityPut({
      kind,
      id: String(id),
      data,
      updatedAtIso: opts?.updatedAtIso || new Date().toISOString(),
      deleted: !!opts?.deleted,
    })
    return !!res?.ok
  }
  return false
}

export async function entityGet<T = unknown>(
  kind: EntityKind | string,
  id: string,
): Promise<LocalEntityRow<T> | null> {
  const desk = getKakapoDesktop()
  if (isKakapoDesktop() && desk?.localDbEntityGet) {
    const row = await desk.localDbEntityGet(kind, String(id))
    if (!row) return null
    return {
      kind,
      id: String(id),
      data: row.data as T,
      updatedAtIso: row.updatedAtIso,
    }
  }
  return null
}

export async function entityList<T = unknown>(
  kind?: EntityKind | string,
  opts?: { since?: string; limit?: number; includeDeleted?: boolean },
): Promise<LocalEntityRow<T>[]> {
  const desk = getKakapoDesktop()
  if (isKakapoDesktop() && desk?.localDbEntityList) {
    const rows = await desk.localDbEntityList(kind, opts)
    return (rows || []).map(r => ({
      kind: r.kind,
      id: r.id,
      data: r.data as T,
      updatedAtIso: r.updatedAtIso,
      deleted: r.deleted,
    }))
  }
  return []
}

export async function entityUpsertMany(
  kind: EntityKind | string,
  items: Array<{ id: string | number; data: unknown; updatedAtIso?: string }>,
): Promise<void> {
  if (!items.length) return
  const desk = getKakapoDesktop()
  if (isKakapoDesktop() && desk?.localDbEntityPutMany) {
    await desk.localDbEntityPutMany(
      items.map(it => ({
        kind,
        id: String(it.id),
        data: it.data,
        updatedAtIso: it.updatedAtIso || new Date().toISOString(),
      })),
    )
    return
  }
  for (const it of items) {
    await entityPut(kind, String(it.id), it.data, { updatedAtIso: it.updatedAtIso })
  }
}

export async function getSyncCursor(): Promise<string> {
  const desk = getKakapoDesktop()
  if (isKakapoDesktop() && desk?.localDbMetaGet) {
    try {
      const meta = await desk.localDbMetaGet()
      return String(meta?.syncCursor || '')
    } catch { /* ignore */ }
  }
  try {
    return String(localStorage.getItem('kakapo_sync_cursor') || '')
  } catch {
    return ''
  }
}

export async function setSyncCursor(cursor: string): Promise<void> {
  const value = String(cursor || '')
  const desk = getKakapoDesktop()
  if (isKakapoDesktop() && desk?.localDbMetaPatch) {
    await desk.localDbMetaPatch({ syncCursor: value })
    return
  }
  try {
    localStorage.setItem('kakapo_sync_cursor', value)
  } catch { /* ignore */ }
}

/** Курсор sequence change-log (GET /sync/changes?afterSequence=). */
export async function getSyncSequence(): Promise<number> {
  const desk = getKakapoDesktop()
  if (isKakapoDesktop() && desk?.localDbMetaGet) {
    try {
      const meta = await desk.localDbMetaGet()
      const n = Number(meta?.syncSequence)
      return Number.isFinite(n) && n > 0 ? n : 0
    } catch { /* ignore */ }
  }
  try {
    const n = Number(localStorage.getItem('kakapo_sync_sequence') || '0')
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

export async function setSyncSequence(seq: number): Promise<void> {
  const n = Math.max(0, Number(seq) || 0)
  const desk = getKakapoDesktop()
  if (isKakapoDesktop() && desk?.localDbMetaPatch) {
    await desk.localDbMetaPatch({ syncSequence: n })
    return
  }
  try {
    localStorage.setItem('kakapo_sync_sequence', String(n))
  } catch { /* ignore */ }
}

/** Отдельный курсор лёгкого pull чеков (не двигает полный sync cursor). */
export async function getPosLiteSyncCursor(): Promise<string> {
  try {
    const soft = String(localStorage.getItem('kakapo_pos_lite_cursor') || '')
    if (soft) return soft
  } catch { /* ignore */ }
  // Не подставляем main syncCursor: он часто уезжает вперёд из‑за товаров/склада
  // и softSync тогда пропускает чеки.
  return ''
}

function maxIsoCursor(a: string, b: string): string {
  const ta = Date.parse(a || '')
  const tb = Date.parse(b || '')
  if (!Number.isFinite(ta)) return Number.isFinite(tb) ? b : ''
  if (!Number.isFinite(tb)) return a
  return tb >= ta ? b : a
}

export async function setPosLiteSyncCursor(cursor: string): Promise<void> {
  const value = String(cursor || '')
  if (!value) return
  try {
    const prev = String(localStorage.getItem('kakapo_pos_lite_cursor') || '')
    const next = maxIsoCursor(prev, value)
    if (!next) return
    localStorage.setItem('kakapo_pos_lite_cursor', next)
  } catch { /* ignore */ }
}
