'use strict'

/** Хранение журнала действий админки и торговли. Срок — 30 дней. */

export const AUDIT_RETENTION_DAYS = 30
export const AUDIT_MAX_ENTRIES = 25000

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

export function ensureAuditLog(db) {
  if (!db) return
  if (!Array.isArray(db.auditLog)) db.auditLog = []
}

export function pruneAuditLog(db, nowMs = Date.now()) {
  ensureAuditLog(db)
  const cutoff = nowMs - AUDIT_RETENTION_DAYS * 864e5
  const before = db.auditLog.length
  db.auditLog = db.auditLog.filter(e => {
    const t = Date.parse(String(e.atIso || ''))
    return !Number.isNaN(t) && t >= cutoff
  })
  if (db.auditLog.length > AUDIT_MAX_ENTRIES) {
    db.auditLog = db.auditLog.slice(0, AUDIT_MAX_ENTRIES)
  }
  return before - db.auditLog.length
}

/**
 * @param {object} db
 * @param {object} entry
 * @param {string} entry.action - create|update|delete|sale|return|shift_open|shift_close|login|other
 * @param {string} entry.entity - product|client|card|debt|employee|sale|shift|stock|settings|...
 * @param {string} [entry.entityId]
 * @param {string} [entry.entityName]
 * @param {string} [entry.summary]
 * @param {object} [entry.before]
 * @param {object} [entry.after]
 * @param {object} [entry.actor]
 * @param {string} [entry.app] - admin|trade
 */
export function logAudit(db, entry = {}) {
  ensureAuditLog(db)
  pruneAuditLog(db)

  const actor = entry.actor || {}
  const name = String(
    actor.name
    || actor.adminLogin
    || actor.cashierName
    || actor.employeeName
    || actor.createdBy
    || 'Система',
  ).trim() || 'Система'

  const row = {
    id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    atIso: new Date().toISOString(),
    app: entry.app === 'trade' ? 'trade' : 'admin',
    action: String(entry.action || 'other'),
    entity: String(entry.entity || 'other'),
    entityId: entry.entityId != null ? String(entry.entityId) : undefined,
    entityName: entry.entityName ? String(entry.entityName).slice(0, 120) : undefined,
    summary: String(entry.summary || '').slice(0, 280),
    before: entry.before && typeof entry.before === 'object' ? slimSnapshot(entry.before) : undefined,
    after: entry.after && typeof entry.after === 'object' ? slimSnapshot(entry.after) : undefined,
    actor: {
      name,
      role: actor.role || undefined,
      adminLogin: actor.adminLogin || undefined,
      employeeId: actor.employeeId || undefined,
      cashierId: actor.cashierId || undefined,
      cashierName: actor.cashierName || undefined,
    },
  }

  db.auditLog.unshift(row)
  if (db.auditLog.length > AUDIT_MAX_ENTRIES) {
    db.auditLog = db.auditLog.slice(0, AUDIT_MAX_ENTRIES)
  }
  return row
}

function slimSnapshot(obj) {
  const out = {}
  const keys = Object.keys(obj).slice(0, 24)
  for (const k of keys) {
    const v = obj[k]
    if (v == null) continue
    if (typeof v === 'string') out[k] = v.slice(0, 80)
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (Array.isArray(v)) out[k] = `Array(${v.length})`
    else if (typeof v === 'object') out[k] = '{…}'
  }
  return out
}

export function actorFromRequest(req) {
  const h = req?.headers || {}
  const body = req?.body || {}
  const adminLogin = String(h['x-kakapo-admin-login'] || h['x-admin-login'] || '').trim()
  const adminName = String(h['x-kakapo-admin-name'] || '').trim()
  const employeeId = String(h['x-kakapo-employee-id'] || body.employeeId || '').trim()
  const employeeName = String(h['x-kakapo-employee-name'] || body.employeeName || '').trim()
  const cashierId = String(body.cashierId || h['x-kakapo-cashier-id'] || '').trim()
  const cashierName = String(body.cashierName || body.createdBy || h['x-kakapo-cashier-name'] || '').trim()
  const appHint = String(h['x-kakapo-app'] || '').trim()

  let app = 'admin'
  let name = ''
  let role = ''

  if (appHint === 'trade' || employeeId || employeeName || cashierId || cashierName) {
    app = 'trade'
    name = employeeName || cashierName || 'Сотрудник торговли'
    role = employeeId ? 'employee' : (cashierId ? 'cashier' : 'trade')
  }
  if (adminLogin || adminName) {
    app = appHint === 'trade' ? 'trade' : 'admin'
    if (app === 'admin') {
      name = adminName || adminLogin || 'Админ'
      role = 'admin'
    }
  }
  if (!name) name = 'Система'

  return {
    app,
    name,
    role,
    adminLogin: adminLogin || undefined,
    employeeId: employeeId || undefined,
    employeeName: employeeName || undefined,
    cashierId: cashierId || undefined,
    cashierName: cashierName || undefined,
    createdBy: body.createdBy ? String(body.createdBy) : undefined,
  }
}

export function auditFromReq(db, req, partial) {
  const actor = actorFromRequest(req)
  return logAudit(db, {
    ...partial,
    app: partial.app || actor.app,
    actor: { ...actor, ...(partial.actor || {}) },
  })
}

export function listAuditLog(db, query = {}) {
  ensureAuditLog(db)
  pruneAuditLog(db)

  let list = db.auditLog || []
  const app = String(query.app || '').trim()
  const action = String(query.action || '').trim()
  const entity = String(query.entity || '').trim()
  const q = String(query.q || '').trim().toLowerCase()
  const days = Math.min(AUDIT_RETENTION_DAYS, Math.max(1, Number(query.days) || AUDIT_RETENTION_DAYS))
  const cutoff = Date.now() - days * 864e5

  list = list.filter(e => {
    const t = Date.parse(String(e.atIso || ''))
    if (Number.isNaN(t) || t < cutoff) return false
    if (app && e.app !== app) return false
    if (action && e.action !== action) return false
    if (entity && e.entity !== entity) return false
    if (q) {
      const hay = [
        e.summary, e.entityName, e.entityId, e.actor?.name, e.actor?.adminLogin, e.actor?.cashierName,
      ].join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  const limit = Math.min(500, Math.max(1, Number(query.limit) || 200))
  const offset = Math.max(0, Number(query.offset) || 0)
  const total = list.length
  const items = list.slice(offset, offset + limit)

  return {
    retentionDays: AUDIT_RETENTION_DAYS,
    total,
    limit,
    offset,
    items,
  }
}

export function diffBrief(before, after, keys) {
  if (!before || !after) return ''
  const parts = []
  for (const k of keys) {
    const a = before[k]
    const b = after[k]
    if (a === b) continue
    if (typeof a === 'number' || typeof b === 'number') {
      if (round2(a) !== round2(b)) parts.push(`${k}: ${a ?? '—'} → ${b ?? '—'}`)
    } else if (String(a ?? '') !== String(b ?? '')) {
      parts.push(`${k}: ${a ?? '—'} → ${b ?? '—'}`)
    }
  }
  return parts.slice(0, 6).join('; ')
}
