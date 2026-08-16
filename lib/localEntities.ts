/**
 * Локальные сущности SQLite (Desktop) + fallback на KV.
 */
import { getLocalDb } from './localDbClient'

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
  const desk = getLocalDb()
  if (desk?.localDbEntityPut) {
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
  const desk = getLocalDb()
  if (desk?.localDbEntityGet) {
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
  const desk = getLocalDb()
  if (desk?.localDbEntityList) {
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
  const desk = getLocalDb()
  if (desk?.localDbEntityPutMany) {
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
  const desk = getLocalDb()
  if (desk?.localDbMetaGet) {
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
  const desk = getLocalDb()
  if (desk?.localDbMetaPatch) {
    await desk.localDbMetaPatch({ syncCursor: value })
    return
  }
  try {
    localStorage.setItem('kakapo_sync_cursor', value)
  } catch { /* ignore */ }
}
