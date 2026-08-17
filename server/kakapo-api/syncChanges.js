/**
 * Двусторонний pull: дельты каталога и POS.
 * Курсор — максимальная метка в выдаче, не «сейчас» на сервере:
 * иначе чек с датой чека (офлайн) не попадёт в следующую дельту.
 */

import { listAllOpenStockLayers } from './posLogic.js'
import { listSyncDeletesSince } from './syncDeletes.js'
import { stripHeavyPhotoFields } from './productPhotoPipeline.js'

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

/** Первый pull без курсора: каталог целиком, история документов — не «за все годы». */
const DEFAULT_FULL_HISTORY_DAYS = 400

function filterRecentDays(list, days) {
  if (!Array.isArray(list)) return []
  if (!(Number(days) > 0)) return list
  const cutoff = Date.now() - Number(days) * 86400000
  return list.filter(row => {
    const t = Date.parse(rowStamp(row))
    if (!Number.isFinite(t)) return true
    return t >= cutoff
  })
}

function historyList(list, since, full, historyDays) {
  if (full) return filterRecentDays(list, historyDays)
  return filterBySince(list, since)
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
 * @param {{ since?: string, historyDays?: number }} opts
 */
export function buildSyncChanges(db, opts = {}) {
  const since = asIso(opts.since || '')
  const full = !since
  const rawDays = Number(opts.historyDays)
  const historyDays = Number.isFinite(rawDays) && rawDays > 0
    ? rawDays
    : DEFAULT_FULL_HISTORY_DAYS

  const products = (full
    ? (db.products || [])
    : filterBySince(db.products || [], since)
  ).map(stripHeavyPhotoFields)
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
      sales: historyList(db.posSales || [], since, full, historyDays),
      shifts: historyList(db.posShifts || [], since, full, historyDays),
      receipts: historyList(db.stockReceipts || [], since, full, historyDays),
      writeoffs: historyList(db.writeOffs || [], since, full, historyDays),
      revisions: historyList(db.stockRevisions || [], since, full, historyDays),
      financeMoves: historyList(db.financeMoves || [], since, full, historyDays),
      expenses: historyList(db.expenses || [], since, full, historyDays),
      suppliers: full ? (db.suppliers || []) : filterBySince(db.suppliers || [], since),
      posPoints: (full ? (db.posPoints || []) : filterBySince(db.posPoints || [], since))
        .map(p => ({
          ...p,
          pairCode: undefined,
        })),
      cashiers: full ? (db.cashiers || []) : filterBySince(db.cashiers || [], since),
      expiry: historyList(db.expiry || [], since, full, historyDays),
    },
  }
  payload.cursor = cursorFromPayload(payload, since)
  return payload
}
