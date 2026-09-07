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
  const lo = (local && typeof local === 'object') ? local as Record<string, unknown> : null
  const ro = (remote && typeof remote === 'object') ? remote as Record<string, unknown> : null
  const lv = lo && lo.docVersion != null ? Number(lo.docVersion) : NaN
  const rv = ro && ro.docVersion != null ? Number(ro.docVersion) : NaN
  if (Number.isFinite(lv) && Number.isFinite(rv) && (lv > 0 || rv > 0)) {
    if (rv !== lv) return rv > lv
  }
  const la = Date.parse(stampOf(local) || '')
  const ra = Date.parse(stampOf(remote) || '')
  if (!Number.isFinite(ra)) return false
  if (!Number.isFinite(la)) return true
  return ra >= la
}

type SaleItemLike = {
  productId?: number
  productName?: string
  qty?: number
  price?: number
  lineTotal?: number
  unit?: string
  returnedQty?: number
  [k: string]: unknown
}

type SaleLike = {
  id?: string | number
  clientRef?: string
  cashierName?: string
  cashierId?: string
  items?: SaleItemLike[]
  [k: string]: unknown
}

function isWeightUnit(u: unknown): boolean {
  const t = String(u || '').trim().toLowerCase()
  return t === 'кг' || t === 'kg'
}

/**
 * Склейка чека при синке: сервер даёт id/orderId/возвраты,
 * но qty веса не должен затираться «1» из корзины или пустым items.
 */
export function mergePosSalePreferItems<T extends SaleLike>(local: T, remote: T): T {
  if (!local) return remote
  if (!remote) return local

  const localItems = Array.isArray(local.items) ? local.items : []
  const remoteItems = Array.isArray(remote.items) ? remote.items : []

  let items: SaleItemLike[] = remoteItems
  if (!remoteItems.length && localItems.length) {
    items = localItems
  } else if (localItems.length && remoteItems.length) {
    const usedLocal = new Set<number>()
    items = remoteItems.map((rit, i) => {
      let lit: SaleItemLike | undefined
      const pid = Number(rit.productId)
      const sameIdx = localItems[i]
      if (sameIdx && Number(sameIdx.productId) === pid) {
        lit = sameIdx
        usedLocal.add(i)
      } else {
        const j = localItems.findIndex((x, idx) => !usedLocal.has(idx) && Number(x.productId) === pid)
        if (j >= 0) {
          lit = localItems[j]
          usedLocal.add(j)
        }
      }
      if (!lit) return rit

      const lq = Number(lit.qty) || 0
      const rq = Number(rit.qty) || 0
      const unit = rit.unit || lit.unit
      const weighted = isWeightUnit(unit)
      let qty = rq

      // Классический баг: в payload ушло qty=1 (строка корзины), вес был в weightKg
      if (weighted && rq === 1 && lq > 0 && Math.abs(lq - 1) > 0.0005) qty = lq
      // Локально точнее (3 знака), сервер round2 — оставляем локальный если почти равен
      else if (lq > 0 && Math.abs(lq - rq) > 0.0005 && Math.abs(lq - rq) < 0.015) qty = lq
      // Локаль дробный вес, сервер целое 2/3 — не затираем вес
      else if (weighted && lq > 0 && !Number.isInteger(lq) && Number.isInteger(rq) && Math.abs(lq - rq) >= 0.015) {
        qty = lq
      }

      return {
        ...rit,
        qty,
        unit,
        productName: String(rit.productName || lit.productName || '').trim() || rit.productName,
        returnedQty: rit.returnedQty != null ? rit.returnedQty : lit.returnedQty,
      }
    })
  }

  const remoteCashier = String(remote.cashierName || '').trim()
  const localCashier = String(local.cashierName || '').trim()
  const cashierName = remoteCashier && !/^кассир$/i.test(remoteCashier)
    ? remoteCashier
    : (localCashier || remoteCashier)

  return {
    ...local,
    ...remote,
    id: remote.id ?? local.id,
    items,
    cashierName,
    cashierId: remote.cashierId || local.cashierId,
    clientRef: remote.clientRef || local.clientRef,
  }
}

/** Входящие продажи: сохранить локальный вес/items, потом merge.
 *  mode:
 *   - 'delta' — только дописать/обновить (частичный /sync/changes) — НЕ удалять отсутствующие
 *   - 'full'  — полный снимок GET /pos/sales — можно убрать id, которых нет на сервере
 */
export function mergeSalesInbound<T extends SaleLike>(
  localList: T[],
  remoteList: T[],
  opts?: { mode?: 'delta' | 'full' },
): T[] {
  const mode = opts?.mode === 'full' ? 'full' : 'delta'
  const localById = new Map<string, T>()
  const localByRef = new Map<string, T>()
  for (const row of localList || []) {
    const id = String(row?.id ?? '')
    if (id) localById.set(id, row)
    const ref = String(row?.clientRef || '').trim()
    if (ref) localByRef.set(ref, row)
  }
  const enriched = (remoteList || []).map(remote => {
    const local = localById.get(String(remote?.id ?? ''))
      || (remote?.clientRef ? localByRef.get(String(remote.clientRef)) : undefined)
    return local ? mergePosSalePreferItems(local, remote) : remote
  })
  if (mode === 'delta') {
    // Частичная дельта: никогда не prune — иначе один новый чек стирает всю историю
    return mergeAppendById(localList, enriched)
  }
  return mergeInboundById(localList, enriched)
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
      const local = map.get(localId)
      map.delete(localId)
      const remoteId = String(remote.id)
      if (local && !shouldTakeRemoteLww(local, remote)) {
        map.set(remoteId, { ...local, id: remote.id as T['id'] })
      } else {
        map.set(remoteId, remote)
      }
      byRef.set(ref, remoteId)
      continue
    }
    const id = String(remote?.id ?? '')
    if (!id) continue
    const local = map.get(id)
    if (local && !shouldTakeRemoteLww(local, remote)) continue
    map.set(id, remote)
  }
  return [...map.values()].filter(row => !isUnlinkedLocalGhost(row, map))
}

/** Пока GET ещё без свежей записи — не выкидывать только что ушедший на сервер id. */
const INBOUND_KEEP_RECENT_MS = 3 * 60_000

function isRecentLocalRow(row: { createdAtIso?: string; updatedAtIso?: string; createdAt?: string }): boolean {
  const ts = Date.parse(String(row.createdAtIso || row.updatedAtIso || row.createdAt || ''))
  if (!Number.isFinite(ts)) return false
  const age = Date.now() - ts
  return age >= 0 && age < INBOUND_KEEP_RECENT_MS
}

/**
 * Входящий синк: серверные id — как на сервере (удалённые пропадают),
 * локальные off-* остаются, пока не склеены по clientRef.
 * Свежий remap (off-* → FIN-*) не должен исчезнуть, если GET ещё старый.
 */
export function mergeInboundById<T extends {
  id?: string | number
  clientRef?: string
  createdAtIso?: string
  updatedAtIso?: string
  createdAt?: string
}>(
  localList: T[],
  remoteList: T[],
): T[] {
  const merged = mergeAppendById(localList, remoteList)
  const remoteIds = new Set((remoteList || []).map(r => String(r?.id ?? '')).filter(Boolean))
  return merged.filter(row => {
    const id = String(row?.id ?? '')
    if (!id) return false
    if (id.startsWith('off-')) return true
    if (remoteIds.has(id)) return true
    return isRecentLocalRow(row)
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
