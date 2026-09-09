/**
 * Запись полной/дельты sync в локальную SQLite/KV.
 * Используется bootstrap и (Android) sync-каналом.
 * Desktop main использует desktop/syncInboundSqlite.cjs — ключи те же.
 */
import {
  cacheProducts,
  cacheClients,
  cacheCategories,
  cacheData,
  cacheEmployeesAuth,
  sanitizeProductForLocalCache,
} from './offline'
import { setSyncCursor, setPosLiteSyncCursor } from './localEntities'

function asArr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function mergeById<T extends { id?: string | number; num?: string }>(
  local: T[],
  remote: T[],
  full: boolean,
): T[] {
  if (full) return asArr(remote)
  if (!asArr(remote).length) return asArr(local)
  const m = new Map<string, T>()
  for (const row of local || []) {
    const id = String(row?.id ?? row?.num ?? '')
    if (id) m.set(id, row)
  }
  for (const row of remote) {
    const id = String(row?.id ?? row?.num ?? '')
    if (!id) continue
    const prev = m.get(id)
    m.set(id, prev && typeof prev === 'object' ? { ...prev, ...row } : row)
  }
  return [...m.values()]
}

function dropDeletes<T extends { id?: string | number; num?: string }>(
  list: T[],
  deletes: { kind?: string; id?: string }[],
  kinds: string[],
): T[] {
  const del = new Set(
    asArr(deletes)
      .filter(d => kinds.includes(String(d?.kind || '')))
      .map(d => String(d?.id || ''))
      .filter(Boolean),
  )
  if (!del.size) return list
  return asArr(list).filter(row => !del.has(String(row?.id ?? row?.num ?? '')))
}

export function deltaHasWork(json: any): boolean {
  if (!json || typeof json !== 'object') return false
  if (json.full) return true
  if (asArr(json.deletes).length) return true
  if (asArr(json.products).length) return true
  if (asArr(json.categories).length) return true
  if (asArr(json.clients).length) return true
  if (asArr(json.cards).length) return true
  if (asArr(json.stockLayers).length) return true
  const pos = json.pos || {}
  for (const k of ['sales', 'shifts', 'receipts', 'writeoffs', 'revisions', 'financeMoves', 'expenses', 'suppliers', 'posPoints', 'cashiers', 'expiry']) {
    if (asArr(pos[k]).length) return true
  }
  return false
}

/** Пишет дельту/full в канонические ключи SQLite (+ data_* для UI). */
export async function applySyncDeltaToSqlite(json: any): Promise<string[]> {
  const scopes: string[] = []
  if (!json || typeof json !== 'object') return scopes
  const full = !!json.full
  const deletes = asArr<{ kind?: string; id?: string }>(json.deletes)

  if (asArr(json.products).length || deletes.some(d => d.kind === 'product')) {
    const { readCachedProducts } = await import('./offline')
    let list = (await readCachedProducts()) || []
    list = mergeById(list as any, asArr(json.products), full) as any
    list = dropDeletes(list as any, deletes, ['product']) as any
    await cacheProducts((list as any[]).map(sanitizeProductForLocalCache))
    scopes.push('products')
  }

  if (asArr(json.categories).length || deletes.some(d => d.kind === 'category')) {
    const { readCachedCategories } = await import('./offline')
    let list = (await readCachedCategories()) || []
    // dual key
    const desk = (await import('./desktopBridge')).getKakapoDesktop()
    if ((!list || !(list as any[]).length) && desk?.localDbKvGet) {
      try {
        const alt = await desk.localDbKvGet('categories')
        if (Array.isArray(alt)) list = alt
      } catch { /* ignore */ }
    }
    list = mergeById(list as any, asArr(json.categories), full) as any
    list = dropDeletes(list as any, deletes, ['category']) as any
    await cacheCategories(list as any[])
    if (desk?.localDbKvSet) {
      try { await desk.localDbKvSet('categories', list) } catch { /* ignore */ }
    }
    scopes.push('categories')
  }

  if (asArr(json.clients).length || deletes.some(d => d.kind === 'client')) {
    const { readCachedClients, readCachedData } = await import('./offline')
    let list = (await readCachedClients()) || (await readCachedData<any[]>('clients')) || []
    list = mergeById(list as any, asArr(json.clients), full) as any
    list = dropDeletes(list as any, deletes, ['client']) as any
    await cacheClients(list as any[])
    await cacheData('clients', list)
    scopes.push('clients')
  }

  if (asArr(json.cards).length || deletes.some(d => d.kind === 'card')) {
    const { readCachedData } = await import('./offline')
    let list = (await readCachedData<any[]>('cards')) || []
    const desk = (await import('./desktopBridge')).getKakapoDesktop()
    if (!list.length && desk?.localDbKvGet) {
      try {
        const alt = await desk.localDbKvGet('cards')
        if (Array.isArray(alt)) list = alt
      } catch { /* ignore */ }
    }
    list = mergeById(list, asArr(json.cards), full)
    list = dropDeletes(list, deletes, ['card'])
    await cacheData('cards', list)
    if (desk?.localDbKvSet) {
      try { await desk.localDbKvSet('cards', list) } catch { /* ignore */ }
    }
    scopes.push('cards')
  }

  if (asArr(json.stockLayers).length || json.stockLayersReplace || full) {
    const { readCachedStockLayers, cacheStockLayers } = await import('./stockLayersLocal')
    let next: any[]
    if (full || json.stockLayersReplace) {
      next = asArr(json.stockLayers)
    } else {
      const local = (await readCachedStockLayers()) || []
      const m = new Map(local.map(l => [`${l.receiptId}:${l.productId}`, l]))
      for (const remote of asArr<any>(json.stockLayers)) {
        m.set(`${remote.receiptId}:${remote.productId}`, remote)
      }
      next = [...m.values()]
    }
    await cacheStockLayers(next)
    scopes.push('stockLayers')
  }

  const pos = json.pos || {}
  const { readCachedData } = await import('./offline')
  const snap = (await readCachedData<Record<string, any>>('pos_snapshot')) || {}
  let snapChanged = false
  const nextSnap = { ...snap }

  const mergeField = (field: string, kind: string, remote: any[], mode: 'sales' | 'id' = 'id') => {
    if (!asArr(remote).length && !deletes.some(d => d.kind === kind) && !full) return
    let cur = asArr(nextSnap[field])
    if (mode === 'sales') {
      if (full) cur = asArr(remote)
      else {
        const m = new Map(cur.map((r: any) => [String(r.id), r]))
        for (const row of asArr(remote)) {
          const id = String(row?.id || '')
          if (!id) continue
          const prev = m.get(id)
          m.set(id, prev ? { ...prev, ...row } : row)
        }
        cur = [...m.values()]
      }
    } else {
      cur = mergeById(cur, asArr(remote), full)
    }
    cur = dropDeletes(cur, deletes, [kind])
    nextSnap[field] = cur
    snapChanged = true
  }

  mergeField('sales', 'sale', pos.sales, 'sales')
  mergeField('shifts', 'shift', pos.shifts)
  mergeField('receipts', 'receipt', pos.receipts)
  mergeField('writeoffs', 'writeoff', pos.writeoffs)
  mergeField('revisions', 'revision', pos.revisions)
  mergeField('financeMoves', 'finance_move', pos.financeMoves)
  mergeField('expenses', 'expense', pos.expenses)
  mergeField('suppliers', 'supplier', pos.suppliers)
  mergeField('posPoints', 'pos_point', pos.posPoints)
  mergeField('cashiers', 'cashier', pos.cashiers)
  if (asArr(pos.expiry).length || full) {
    nextSnap.expiry = asArr(pos.expiry)
    snapChanged = true
  }

  if (snapChanged) {
    await cacheData('pos_snapshot', nextSnap)
    const desk = (await import('./desktopBridge')).getKakapoDesktop()
    if (desk?.localDbKvSet) {
      try { await desk.localDbKvSet('pos_snapshot', nextSnap) } catch { /* ignore */ }
    }
    scopes.push('pos')
  }

  if (json.cursor) {
    await setSyncCursor(String(json.cursor))
    await setPosLiteSyncCursor(String(json.cursor))
  }

  return [...new Set(scopes)]
}

export async function writeEmployeesAuthToSqlite(rows: unknown[]): Promise<void> {
  await cacheEmployeesAuth(rows as any)
}
