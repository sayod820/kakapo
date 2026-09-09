'use strict'

/**
 * Inbound SYNC → SQLite only (main process).
 * UI потом только читает KV/entities, без HTTP и без applySyncDelta.
 */

function asArr(v) {
  return Array.isArray(v) ? v : []
}

function byIdMap(list) {
  const m = new Map()
  for (const row of list || []) {
    const id = String(row?.id ?? row?.num ?? '')
    if (id) m.set(id, row)
  }
  return m
}

function mergeById(local, remote, full) {
  if (full) return asArr(remote)
  if (!asArr(remote).length) return asArr(local)
  const m = byIdMap(local)
  for (const row of remote) {
    const id = String(row?.id ?? row?.num ?? '')
    if (!id) continue
    const prev = m.get(id)
    m.set(id, prev && typeof prev === 'object' ? { ...prev, ...row } : row)
  }
  return [...m.values()]
}

function mergeSales(local, remote, full) {
  if (full) return asArr(remote)
  if (!asArr(remote).length) return asArr(local)
  const m = byIdMap(local)
  // delta: новые/обновлённые сверху по времени — просто upsert
  for (const row of remote) {
    const id = String(row?.id ?? '')
    if (!id) continue
    const prev = m.get(id)
    m.set(id, prev && typeof prev === 'object' ? { ...prev, ...row } : row)
  }
  return [...m.values()].sort((a, b) =>
    String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || '')),
  )
}

function dropDeletes(list, deletes, kinds) {
  const del = new Set(
    asArr(deletes)
      .filter(d => kinds.includes(String(d?.kind || '')))
      .map(d => String(d?.id || ''))
      .filter(Boolean),
  )
  if (!del.size) return list
  return asArr(list).filter(row => !del.has(String(row?.id ?? row?.num ?? '')))
}

function deltaHasWork(json) {
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

/**
 * Применить дельту в SQLite KV. Возвращает scopes для UI reload.
 * @returns {{ scopes: string[] }}
 */
function applyDeltaToSqlite(dbBridge, json) {
  const scopes = []
  if (!dbBridge || !deltaHasWork(json)) return { scopes }
  const full = !!json.full
  const deletes = asArr(json.deletes)

  // Products
  if (asArr(json.products).length || deletes.some(d => d.kind === 'product')) {
    let list = asArr(dbBridge.kvGet('catalog_products'))
    list = mergeById(list, json.products, full)
    list = dropDeletes(list, deletes, ['product'])
    dbBridge.kvSet('catalog_products', list)
    scopes.push('products')
  }

  // Categories
  if (asArr(json.categories).length || deletes.some(d => d.kind === 'category')) {
    let list = asArr(dbBridge.kvGet('categories'))
    list = mergeById(list, json.categories, full)
    list = dropDeletes(list, deletes, ['category'])
    dbBridge.kvSet('categories', list)
    scopes.push('categories')
  }

  if (asArr(json.clients).length || deletes.some(d => d.kind === 'client')) {
    let list = asArr(dbBridge.kvGet('catalog_clients'))
    if (!list.length) list = asArr(dbBridge.kvGet('clients'))
    if (!list.length) list = asArr(dbBridge.kvGet('data_clients'))
    list = mergeById(list, json.clients, full)
    list = dropDeletes(list, deletes, ['client'])
    dbBridge.kvSet('catalog_clients', list)
    dbBridge.kvSet('clients', list)
    dbBridge.kvSet('data_clients', list)
    scopes.push('clients')
  }

  // Cards
  if (asArr(json.cards).length || deletes.some(d => d.kind === 'card')) {
    let list = asArr(dbBridge.kvGet('cards'))
    if (!list.length) list = asArr(dbBridge.kvGet('data_cards'))
    list = mergeById(list, json.cards, full)
    list = dropDeletes(list, deletes, ['card'])
    dbBridge.kvSet('cards', list)
    dbBridge.kvSet('data_cards', list)
    scopes.push('cards')
  }

  // Stock layers
  if (asArr(json.stockLayers).length || json.stockLayersReplace) {
    const next = (full || json.stockLayersReplace)
      ? asArr(json.stockLayers)
      : (() => {
          const local = asArr(dbBridge.kvGet('catalog_stock_layers'))
          const m = new Map(local.map(l => [`${l.receiptId}:${l.productId}`, l]))
          for (const remote of json.stockLayers) {
            m.set(`${remote.receiptId}:${remote.productId}`, remote)
          }
          return [...m.values()]
        })()
    dbBridge.kvSet('catalog_stock_layers', next)
    scopes.push('stockLayers')
  }

  // POS snapshot pieces
  const pos = json.pos || {}
  const snap = dbBridge.kvGet('pos_snapshot') || {}
  let snapChanged = false
  const nextSnap = { ...snap }

  if (asArr(pos.sales).length || deletes.some(d => d.kind === 'sale')) {
    nextSnap.sales = dropDeletes(mergeSales(snap.sales, pos.sales, full), deletes, ['sale'])
    snapChanged = true
    scopes.push('pos')
  }
  if (asArr(pos.shifts).length || deletes.some(d => d.kind === 'shift')) {
    nextSnap.shifts = dropDeletes(mergeById(snap.shifts, pos.shifts, full), deletes, ['shift'])
    snapChanged = true
    scopes.push('pos')
  }
  for (const [field, kind] of [
    ['receipts', 'receipt'],
    ['writeoffs', 'writeoff'],
    ['revisions', 'revision'],
    ['financeMoves', 'finance_move'],
    ['expenses', 'expense'],
    ['suppliers', 'supplier'],
    ['posPoints', 'pos_point'],
    ['cashiers', 'cashier'],
  ]) {
    if (asArr(pos[field]).length || deletes.some(d => d.kind === kind)) {
      nextSnap[field] = dropDeletes(mergeById(snap[field], pos[field], full), deletes, [kind])
      snapChanged = true
      scopes.push('pos')
    }
  }
  if (asArr(pos.expiry).length) {
    nextSnap.expiry = full ? asArr(pos.expiry) : asArr(pos.expiry)
    snapChanged = true
    scopes.push('pos')
  }
  if (snapChanged) {
    dbBridge.kvSet('pos_snapshot', nextSnap)
    // UI cacheData пишет data_pos_snapshot — дублируем
    dbBridge.kvSet('data_pos_snapshot', nextSnap)
  }

  // Dual-write для UI cacheData (data_*) и альтернативных ключей
  if (scopes.includes('clients')) {
    try {
      const list = dbBridge.kvGet('catalog_clients') || dbBridge.kvGet('clients')
      if (list) {
        dbBridge.kvSet('data_clients', list)
        dbBridge.kvSet('clients', list)
      }
    } catch { /* ignore */ }
  }
  if (scopes.includes('categories')) {
    try {
      const list = dbBridge.kvGet('categories')
      if (list) dbBridge.kvSet('data_categories', list)
    } catch { /* ignore */ }
  }
  if (scopes.includes('cards')) {
    try {
      const list = dbBridge.kvGet('cards')
      if (list) dbBridge.kvSet('data_cards', list)
    } catch { /* ignore */ }
  }

  // Entities mirror (optional)
  if (typeof dbBridge.entityPutMany === 'function') {
    const stamp = String(json.cursor || new Date().toISOString())
    try {
      if (asArr(json.products).length) {
        dbBridge.entityPutMany(json.products.map(p => ({
          kind: 'product', id: String(p.id), data: p, updatedAtIso: String(p.updatedAtIso || stamp),
        })))
      }
      if (asArr(json.clients).length) {
        dbBridge.entityPutMany(json.clients.map(c => ({
          kind: 'client', id: String(c.id), data: c, updatedAtIso: String(c.updatedAtIso || stamp),
        })))
      }
      if (asArr(pos.sales).length) {
        dbBridge.entityPutMany(pos.sales.map(s => ({
          kind: 'sale', id: String(s.id), data: s, updatedAtIso: String(s.createdAtIso || stamp),
        })))
      }
    } catch { /* ignore */ }
  }

  return { scopes: [...new Set(scopes)] }
}

module.exports = {
  deltaHasWork,
  applyDeltaToSqlite,
}
