/**
 * UI применяет inbound ТОЛЬКО из локальной БД (после того как SYNC-канал
 * скачал JSON с сервера и положил в SQLite/кэш). Без HTTP.
 */
import { getKakapoDesktop, isKakapoDesktop } from './desktopBridge'
import { applySyncDelta } from './syncPull'
import { mergeSalesInbound } from './syncConflict'
import { cacheClients, cacheData, persistPosSnapshot, readCachedData } from './offline'
import { setPosLiteSyncCursor } from './localEntities'

export const INBOUND_SYNC_KEY = 'kakapo_inbound_sync'
export const INBOUND_POS_LITE_KEY = 'kakapo_inbound_pos_lite'
export const POS_LITE_CURSOR_KEY = 'kakapo_pos_lite_cursor'

async function kvGet(key: string): Promise<unknown> {
  if (isKakapoDesktop()) {
    const desk = getKakapoDesktop()
    if (desk?.localDbKvGet) {
      try { return await desk.localDbKvGet(key) } catch { return null }
    }
  }
  try {
    return await readCachedData(key)
  } catch {
    return null
  }
}

async function kvSet(key: string, value: unknown): Promise<void> {
  if (isKakapoDesktop()) {
    const desk = getKakapoDesktop()
    if (desk?.localDbKvSet) {
      try { await desk.localDbKvSet(key, value); return } catch { /* fall */ }
    }
  }
  try { await cacheData(key, value) } catch { /* ignore */ }
}

async function kvClear(key: string): Promise<void> {
  await kvSet(key, null)
}

/** pos-lite дельта из базы → Zustand */
export async function applyPosLiteFromLocal(delta: any): Promise<boolean> {
  if (!delta || typeof delta !== 'object') return false
  try {
    const sales = (delta.pos?.sales || []) as any[]
    const shifts = (delta.pos?.shifts || []) as any[]
    const deleteIds = (Array.isArray(delta.deletes) ? delta.deletes : [])
      .filter((d: { kind?: string }) => d.kind === 'sale' || d.kind === 'shift')
      .map((d: { id?: string }) => String(d.id || ''))
      .filter(Boolean)

    const { usePosStore } = await import('./posStore')
    const localSales = usePosStore.getState().sales
    let mergedSales = sales.length
      ? mergeSalesInbound(localSales, sales as any, { mode: 'delta' }) as typeof localSales
      : localSales
    if (deleteIds.length) {
      const del = new Set(deleteIds)
      mergedSales = mergedSales.filter(s => !del.has(String(s.id)))
    }

    const localShifts = usePosStore.getState().shifts
    let mergedShifts = localShifts
    if (shifts.length) {
      const byId = new Map(localShifts.map(s => [String(s.id), s]))
      for (const sh of shifts) {
        const id = String(sh?.id || '')
        if (!id) continue
        const prev = byId.get(id)
        byId.set(id, prev ? { ...prev, ...sh } : sh)
      }
      for (const id of deleteIds) byId.delete(id)
      mergedShifts = [...byId.values()] as typeof localShifts
    }

    const patch: Record<string, unknown> = {}
    if (sales.length || deleteIds.length) patch.sales = mergedSales
    if (shifts.length || deleteIds.length) patch.shifts = mergedShifts
    if (Object.keys(patch).length) {
      usePosStore.setState(patch as any)
      try { await persistPosSnapshot() } catch { /* ignore */ }
    }

    if (Array.isArray(delta.clients) && delta.clients.length) {
      const { useClientStore } = await import('./clientStore')
      const { mergeClientLoyaltyIfRecent } = await import('./loyaltySaveGuard')
      const { mergeByIdLww } = await import('./syncConflict')
      const local = useClientStore.getState().clients || []
      const incoming = mergeByIdLww(local, delta.clients as any)
      const merged = incoming.map(row => {
        const prev = local.find(x => String(x.id) === String(row.id))
        return mergeClientLoyaltyIfRecent(row, prev)
      })
      useClientStore.setState({ clients: merged })
      await cacheClients(merged)
    }
    if (Array.isArray(delta.cards) && delta.cards.length) {
      const { useCardStore } = await import('./cardStore')
      const { mergeCardLoyaltyIfRecent, findLocalCard } = await import('./loyaltySaveGuard')
      const { mergeByIdLww } = await import('./syncConflict')
      const local = useCardStore.getState().cards || []
      const incoming = mergeByIdLww(local as any, delta.cards as any) as typeof local
      const merged = incoming.map(row => mergeCardLoyaltyIfRecent(row, findLocalCard(local, row.num)))
      useCardStore.setState({ cards: merged })
      await cacheData('cards', merged)
    }

    if (delta.cursor) await setPosLiteSyncCursor(String(delta.cursor))
    return true
  } catch {
    return false
  }
}

/** Забрать pending inbound из SQLite/кэша и применить в сторы */
export async function consumeInboundFromLocal(): Promise<{ sync: boolean; lite: boolean }> {
  let sync = false
  let lite = false

  const liteBlob = await kvGet(INBOUND_POS_LITE_KEY)
  if (liteBlob && typeof liteBlob === 'object' && (liteBlob as any).json) {
    lite = await applyPosLiteFromLocal((liteBlob as any).json)
    await kvClear(INBOUND_POS_LITE_KEY)
  } else if (liteBlob && typeof liteBlob === 'object' && (liteBlob as any).pos) {
    lite = await applyPosLiteFromLocal(liteBlob)
    await kvClear(INBOUND_POS_LITE_KEY)
  }

  const syncBlob = await kvGet(INBOUND_SYNC_KEY)
  if (syncBlob && typeof syncBlob === 'object') {
    const json = (syncBlob as any).json || syncBlob
    if (json && (json.cursor != null || json.pos || json.products)) {
      const res = await applySyncDelta(json)
      sync = !!res.ok
      await kvClear(INBOUND_SYNC_KEY)
    }
  }

  return { sync, lite }
}

/** Канал (in-process) кладёт дельту в локаль для UI */
export async function stashInboundLocal(
  kind: 'sync' | 'pos-lite',
  json: unknown,
): Promise<void> {
  const key = kind === 'pos-lite' ? INBOUND_POS_LITE_KEY : INBOUND_SYNC_KEY
  await kvSet(key, { ts: Date.now(), json })
}
