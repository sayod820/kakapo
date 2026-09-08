/**
 * Монотонный change-log для pull по sequence (afterSequence).
 * Не заменяет ISO-дельту since — дополняет её.
 */

const MAX_ROWS = 50000
const LIST_LIMIT = 2000

export function ensureServerChanges(db) {
  if (!Array.isArray(db.serverChanges)) db.serverChanges = []
  return db.serverChanges
}

/**
 * bump db._syncSeq + append row. Prune to last MAX_ROWS.
 * @returns {number} sequence
 */
export function appendServerChange(db, { entityType, entityId, operation, changedData } = {}) {
  const sequence = (Number(db._syncSeq) || 0) + 1
  db._syncSeq = sequence
  const rows = ensureServerChanges(db)
  rows.push({
    sequence,
    entity_type: String(entityType || ''),
    entity_id: String(entityId ?? ''),
    operation: String(operation || ''),
    changed_data: changedData !== undefined ? changedData : null,
    created_at: new Date().toISOString(),
  })
  if (rows.length > MAX_ROWS) {
    db.serverChanges = rows.slice(-MAX_ROWS)
  }
  return sequence
}

/** Rows with sequence > afterSeq, capped at LIST_LIMIT. */
export function listServerChangesSince(db, afterSeq) {
  const after = Number(afterSeq) || 0
  const rows = ensureServerChanges(db)
  if (!(after > 0)) return rows.slice(-LIST_LIMIT)
  const out = []
  for (const row of rows) {
    if (Number(row.sequence) > after) {
      out.push(row)
      if (out.length >= LIST_LIMIT) break
    }
  }
  return out
}
