/**
 * Двусторонний pull: дельты каталога и POS.
 * Курсор — максимальная метка в выдаче, не «сейчас» на сервере:
 * иначе чек с датой чека (офлайн) не попадёт в следующую дельту.
 */

import { listAllOpenStockLayers } from './posLogic.js'
import { listSyncDeletesSince } from './syncDeletes.js'

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
    row?.serverAtIso
    || row?.updatedAtIso
    || row?.updatedAt
    || row?.createdAtIso
    || row?.createdAt
    || row?.closedAtIso
    || row?.atIso
    || '',
  )
}

function filterBySince(list, since) {
  if (!Array.isArray(list)) return []
  if (!since) return list
  return list.filter(row => afterSince(rowStamp(row), since))
}

function maxIso(a, b) {
  const aa = Date.parse(a || '')
  const bb = Date.parse(b || '')
  if (!Number.isFinite(aa)) return Number.isFinite(bb) ? asIso(b) : ''
  if (!Number.isFinite(bb)) return asIso(a)
  return bb > aa ? asIso(b) : asIso(a)
}

function cursorFromPayload(payload, since) {
  let cur = since || ''
  const bump = (rows) => {
    for (const row of rows || []) {
      cur = maxIso(cur, rowStamp(row))
    }
  }
  bump(payload.products)
  bump(payload.categories)
  bump(payload.clients)
  bump(payload.cards)
  bump(payload.deletes)
  const pos = payload.pos || {}
  bump(pos.sales)
  bump(pos.shifts)
  bump(pos.receipts)
  bump(pos.writeoffs)
  bump(pos.revisions)
  bump(pos.financeMoves)
  bump(pos.expenses)
  bump(pos.suppliers)
  bump(pos.posPoints)
  bump(pos.cashiers)
  bump(pos.expiry)
  return cur || since || ''
}

/**
 * @param {object} db
 * @param {{ since?: string }} opts
 */
export function buildSyncChanges(db, opts = {}) {
  const since = asIso(opts.since || '')
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
  const deletes = listSyncDeletesSince(db, since)

  const payload = {
    since: since || null,
    full,
    products,
    categories,
    clients,
    cards,
    deletes,
    stockLayers,
    stockLayersReplace: true,
    pos: {
      sales: filterBySince(db.posSales || [], since),
      shifts: filterBySince(db.posShifts || [], since),
      receipts: filterBySince(db.stockReceipts || [], since),
      writeoffs: filterBySince(db.writeOffs || [], since),
      revisions: filterBySince(db.stockRevisions || [], since),
      financeMoves: filterBySince(db.financeMoves || [], since),
      expenses: filterBySince(db.expenses || [], since),
      suppliers: full ? (db.suppliers || []) : filterBySince(db.suppliers || [], since),
      posPoints: (full ? (db.posPoints || []) : filterBySince(db.posPoints || [], since))
        .map(p => ({
          ...p,
          pairCode: undefined,
        })),
      cashiers: full ? (db.cashiers || []) : filterBySince(db.cashiers || [], since),
      expiry: full ? (db.expiry || []) : filterBySince(db.expiry || [], since),
    },
  }
  payload.cursor = cursorFromPayload(payload, since)
  return payload
}
