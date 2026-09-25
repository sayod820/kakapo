/**
 * Один человек — один кассир. Имя сравнивается без регистра, лишних пробелов и ё/е.
 * Слитый дубль остаётся строкой с mergedInto (старые кассы/очереди шлют его id),
 * все ссылки на него переводятся на основного.
 */

const HISTORY_COLLECTIONS = new Set(['auditLog', 'opRefs', 'syncChangeLog', 'syncDeletes', 'cashiers'])
const CASHIER_REF_FIELDS = ['cashierId', 'returnedByCashierId']

export function normalizeCashierName(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/ё/g, 'е')
}

export function resolveCashierId(db, id) {
  if (!id) return id
  const list = Array.isArray(db?.cashiers) ? db.cashiers : []
  let cur = String(id)
  for (let hop = 0; hop < 8; hop++) {
    const row = list.find(c => c && String(c.id) === cur)
    const next = row?.mergedInto ? String(row.mergedInto) : ''
    if (!next || next === cur) return cur
    cur = next
  }
  return cur
}

export function findCashierById(db, id) {
  if (!id) return null
  const rid = resolveCashierId(db, id)
  return (db?.cashiers || []).find(c => c && String(c.id) === rid) || null
}

/** Живой (не слитый) кассир с таким именем, кроме exceptId. */
export function findCashierByName(db, name, exceptId = '') {
  const key = normalizeCashierName(name)
  if (!key) return null
  return (db?.cashiers || []).find(c => (
    c
    && !c.mergedInto
    && String(c.id) !== String(exceptId || '')
    && normalizeCashierName(c.name) === key
  )) || null
}

function pickCanonical(group) {
  return [...group].sort((a, b) => {
    const byActive = Number(b.active !== false) - Number(a.active !== false)
    if (byActive) return byActive
    const bySales = (Number(b.salesCount) || 0) - (Number(a.salesCount) || 0)
    if (bySales) return bySales
    return String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || ''))
  })[0]
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

/**
 * @returns {{ merged: Array<{ from: string, to: string, name: string }>, remapped: Record<string, number> }}
 */
export function mergeDuplicateCashiers(db, { now = new Date().toISOString() } = {}) {
  const out = { merged: [], remapped: {} }
  const list = Array.isArray(db?.cashiers) ? db.cashiers : []
  const groups = new Map()
  for (const c of list) {
    if (!c || c.mergedInto) continue
    const key = normalizeCashierName(c.name)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(c)
  }

  const alias = new Map()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const canon = pickCanonical(group)
    for (const dup of group) {
      if (dup === canon) continue
      canon.salesCount = (Number(canon.salesCount) || 0) + (Number(dup.salesCount) || 0)
      canon.salesTotal = round2((Number(canon.salesTotal) || 0) + (Number(dup.salesTotal) || 0))
      if (canon.active === false && dup.active !== false) canon.active = true
      dup.mergedInto = canon.id
      dup.mergedAtIso = now
      dup.active = false
      dup.salesCount = 0
      dup.salesTotal = 0
      dup.updatedAtIso = now
      alias.set(String(dup.id), String(canon.id))
      out.merged.push({ from: String(dup.id), to: String(canon.id), name: String(canon.name || '') })
    }
    canon.updatedAtIso = now
  }

  // Ранее слитые (повторный запуск / кассир слит вручную) — тоже переводим ссылки
  for (const c of list) {
    if (c?.mergedInto && !alias.has(String(c.id))) {
      const to = resolveCashierId(db, c.id)
      if (to && to !== String(c.id)) alias.set(String(c.id), to)
    }
  }
  if (!alias.size) return out

  for (const [col, rows] of Object.entries(db)) {
    if (!Array.isArray(rows) || HISTORY_COLLECTIONS.has(col)) continue
    let n = 0
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      let touched = false
      for (const f of CASHIER_REF_FIELDS) {
        const to = row[f] != null ? alias.get(String(row[f])) : undefined
        if (to) { row[f] = to; touched = true }
      }
      if (touched) {
        // snapshot upsert пишет строку только если метка не старее той, что в PG
        if (row._txCommittedAt) row._txCommittedAt = now
        n++
      }
    }
    if (n) out.remapped[col] = n
  }
  return out
}
