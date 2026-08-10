/**
 * Двусторонний pull: дельты каталога и POS с курсором since (ISO).
 * Без since — полный снимок для первого синка.
 */

import { listAllOpenStockLayers } from './posLogic.js'

function asIso(v) {
  const s = String(v || '').trim()
  if (!s) return ''
  const t = Date.parse(s)
  return Number.isFinite(t) ? new Date(t).toISOString() : ''
}

function afterSince(iso, since) {
  if (!since) return true
  const a = Date.parse(iso || '')
  const b = Date.parse(since)
  if (!Number.isFinite(a)) return !since
  if (!Number.isFinite(b)) return true
  return a > b
}

function rowStamp(row) {
  return asIso(
    row?.updatedAtIso
    || row?.updatedAt
    || row?.createdAtIso
    || row?.createdAt
    || row?.closedAtIso
    || '',
  )
}

function filterBySince(list, since) {
  if (!Array.isArray(list)) return []
  if (!since) return list
  return list.filter(row => afterSince(rowStamp(row), since))
}

/**
 * @param {object} db
 * @param {{ since?: string }} opts
 */
export function buildSyncChanges(db, opts = {}) {
  const since = asIso(opts.since || '')
  const cursor = new Date().toISOString()
  const full = !since

  const products = full
    ? (db.products || [])
    : filterBySince(db.products || [], since)
  const categories = full
    ? (db.categories || [])
    : filterBySince(db.categories || [], since)
  const clients = full
    ? (db.clients || [])
    : filterBySince(db.clients || [], since)
  const cards = full
    ? (db.cards || [])
    : filterBySince(db.cards || [], since)

  const stockLayers = listAllOpenStockLayers(db)

  return {
    cursor,
    since: since || null,
    full,
    products,
    categories,
    clients,
    cards,
    stockLayers: full ? stockLayers : stockLayers.filter(l => afterSince(rowStamp(l), since)),
    pos: {
      sales: filterBySince(db.posSales || [], since),
      shifts: filterBySince(db.posShifts || [], since),
      receipts: filterBySince(db.stockReceipts || [], since),
      writeoffs: filterBySince(db.writeOffs || [], since),
      revisions: filterBySince(db.stockRevisions || [], since),
      financeMoves: filterBySince(db.financeMoves || [], since),
      expenses: filterBySince(db.expenses || [], since),
      suppliers: full ? (db.suppliers || []) : filterBySince(db.suppliers || [], since),
      posPoints: full ? (db.posPoints || []) : filterBySince(db.posPoints || [], since),
      cashiers: full ? (db.cashiers || []) : filterBySince(db.cashiers || [], since),
      expiry: full ? (db.expiry || []) : filterBySince(db.expiry || [], since),
    },
  }
}
