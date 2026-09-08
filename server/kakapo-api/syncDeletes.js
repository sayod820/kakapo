/**
 * Удаления для pull-синка. Без этого локальная касса вечно держит
 * товар/клиента, который уже стёрли на сервере.
 */

const TTL_MS = 30 * 24 * 60 * 60 * 1000
const LIMIT = 8000

export function ensureSyncDeletes(db) {
  if (!Array.isArray(db.syncDeletes)) db.syncDeletes = []
  return db.syncDeletes
}

export function recordSyncDelete(db, kind, id) {
  const k = String(kind || '').trim()
  const i = String(id ?? '').trim()
  if (!k || !i) return
  const rows = ensureSyncDeletes(db)
  const atIso = new Date().toISOString()
  const idx = rows.findIndex(r => String(r.kind) === k && String(r.id) === i)
  if (idx >= 0) rows.splice(idx, 1)
  rows.push({ kind: k, id: i, atIso })
  pruneSyncDeletes(db)
}

export function pruneSyncDeletes(db) {
  const rows = ensureSyncDeletes(db)
  const edge = Date.now() - TTL_MS
  const alive = rows.filter(r => Date.parse(r.atIso || '') > edge)
  db.syncDeletes = alive.length > LIMIT ? alive.slice(-LIMIT) : alive
}

export function listSyncDeletesSince(db, since) {
  const rows = ensureSyncDeletes(db)
  if (!since) return rows.slice()
  const t = Date.parse(since)
  if (!Number.isFinite(t)) return rows.slice()
  return rows.filter(r => Date.parse(r.atIso || '') > t)
}
