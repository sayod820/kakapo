/**
 * Pure active-shift selection + orphan off-shift projection (no store I/O).
 * Used by lib/shiftReconcile.ts and scripts/shift-reconcile-test.mjs.
 */
import { aggregateShiftSaleTotals } from './shiftSaleTotalsCore.mjs'

function isOffShiftId(value) {
  return typeof value === 'string' && value.startsWith('off-')
}

function openedMs(s) {
  const t = Date.parse(String(s?.openedAtIso || ''))
  return Number.isFinite(t) ? t : 0
}

/** Prefer authoritative server open shift; offline off-* only when no server open matches. */
export function pickActiveOpenShift(shifts, opts = {}) {
  const open = (shifts || []).filter(s => String(s?.status || '') === 'open')
  if (!open.length) return null

  const cashierId = String(opts.cashierId || '').trim()
  const posId = String(opts.posId || '').trim()

  let pool = open
  if (cashierId) {
    const mine = pool.filter(s => String(s.cashierId || '') === cashierId)
    if (mine.length) pool = mine
  }
  if (posId) {
    const atPos = pool.filter(s => String(s.posId || '') === posId)
    if (atPos.length) pool = atPos
  }

  const server = pool.filter(s => !isOffShiftId(s.id))
  const candidates = server.length ? server : pool
  return [...candidates].sort((a, b) => openedMs(b) - openedMs(a))[0] || null
}

export function sameLogicalOpenSession(a, b) {
  if (String(a?.status || '') !== 'open' || String(b?.status || '') !== 'open') return false
  const posA = String(a.posId || '').trim()
  const posB = String(b.posId || '').trim()
  if (posA && posB && posA !== posB) return false
  const cashA = String(a.cashierId || '').trim()
  const cashB = String(b.cashierId || '').trim()
  if (cashA && cashB && cashA !== cashB) return false
  if (posA && posB) return true
  if (cashA && cashB) return true
  if (a.clientRef && b.clientRef && String(a.clientRef) === String(b.clientRef)) return true
  return false
}

/** Find open off-* that should adopt an already-present server open shift. */
export function planOrphanOffShiftAdopts(shifts) {
  const open = (shifts || []).filter(s => String(s?.status || '') === 'open')
  const servers = open.filter(s => !isOffShiftId(s.id))
  const locals = open.filter(s => isOffShiftId(s.id))
  if (!servers.length || !locals.length) return []

  const plans = []
  const usedLocal = new Set()

  for (const local of locals) {
    const lid = String(local.id)
    if (usedLocal.has(lid)) continue
    const match = servers.find(srv => sameLogicalOpenSession(local, srv))
    if (!match) continue
    usedLocal.add(lid)
    plans.push({
      localId: lid,
      serverId: String(match.id),
      local,
      server: match,
    })
  }
  return plans
}

/**
 * Pure projection: remap sales off→server, close orphan off-shifts.
 * Never folds orphan denormalized counters into the server open shift
 * (that leaked prior-session salesCount/salesCash into a new shift).
 * After remap, recompute target open-shift sale counters from unique sale rows.
 * Does not delete sales or historical closed rows.
 */
export function applyOrphanOffShiftAdoptsProjection(
  shifts,
  sales,
  plans,
  closedAtIso = new Date().toISOString(),
) {
  if (!plans.length) return { shifts, sales, remappedSaleIds: [] }

  const byLocal = new Map(plans.map(p => [p.localId, p]))
  const remappedSaleIds = []
  const touchedServer = new Set(plans.map(p => String(p.serverId)))

  const nextSales = (sales || []).map(sale => {
    const sid = String(sale?.shiftId || '')
    const plan = byLocal.get(sid)
    if (!plan) return sale
    remappedSaleIds.push(String(sale.id))
    return { ...sale, shiftId: plan.serverId }
  })

  const nextShifts = (shifts || []).map(sh => {
    const id = String(sh.id)
    const asLocal = byLocal.get(id)
    if (asLocal) {
      return {
        ...sh,
        status: 'closed',
        closedAtIso,
        note: [String(sh.note || '').trim(), `reconcile:adopted→${asLocal.serverId}`]
          .filter(Boolean)
          .join(' | '),
        updatedAtIso: closedAtIso,
      }
    }
    if (!touchedServer.has(id)) return sh
    const t = aggregateShiftSaleTotals(nextSales, id)
    return {
      ...sh,
      salesCount: t.salesCount,
      salesCash: t.salesCash,
      salesCard: t.salesCard,
      salesCredit: t.salesCredit,
      updatedAtIso: closedAtIso,
    }
  })

  return { shifts: nextShifts, sales: nextSales, remappedSaleIds }
}
