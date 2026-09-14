/**
 * Phase D4 — debt operation idempotency helpers (pure).
 * Canonical key: operationId === clientRef.
 * Same kind+clientRef+fingerprint → replay; same key different fingerprint → 409.
 */

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

export const IDEMPOTENCY_KEY_REUSED = 'IDEMPOTENCY_KEY_REUSED'
export const CLIENT_REF_REQUIRED = 'CLIENT_REF_REQUIRED'

/**
 * Canonical immutable fingerprint for debt-related ops.
 * Volatile timestamps / names are excluded.
 */
export function buildDebtOpFingerprint(kind, fields = {}) {
  const k = String(kind || '').trim()
  const amount = round2(fields.amount)
  const debtAdded = fields.debtAdded != null ? round2(fields.debtAdded) : null
  const method = String(fields.method || '').trim().toLowerCase() || null
  const clientId = String(fields.clientId || '').trim() || null
  const cardNum = String(fields.cardNum || fields.num || '').trim().toUpperCase() || null
  const orderId = String(
    fields.orderId || fields.targetDebtLedgerId || fields.saleId || '',
  ).trim() || null
  const shiftId = String(fields.shiftId || '').trim() || null
  return {
    kind: k,
    amount: Number.isFinite(amount) ? amount : 0,
    debtAdded,
    method,
    clientId,
    cardNum,
    orderId,
    shiftId,
  }
}

export function fingerprintsEqual(a, b) {
  if (!a || !b) return !a && !b
  if (String(a.kind) !== String(b.kind)) return false
  if (round2(a.amount) !== round2(b.amount)) return false
  if ((a.debtAdded == null) !== (b.debtAdded == null)) return false
  if (a.debtAdded != null && round2(a.debtAdded) !== round2(b.debtAdded)) return false
  if (String(a.method || '') !== String(b.method || '')) return false
  // Historical moneyLedger rows may omit clientId — only conflict when both present and differ
  const aCid = String(a.clientId || '').trim()
  const bCid = String(b.clientId || '').trim()
  if (aCid && bCid && aCid !== bCid) return false
  if (String(a.cardNum || '').toUpperCase() !== String(b.cardNum || '').toUpperCase()) return false
  const aOid = String(a.orderId || '').trim()
  const bOid = String(b.orderId || '').trim()
  if (aOid && bOid && aOid !== bOid) return false
  if (String(a.shiftId || '') !== String(b.shiftId || '')) return false
  return true
}

/**
 * @returns {{ ok: true } | { ok: false, code: string, detail: string, status: number }}
 */
export function checkIdempotencyReplay(storedFingerprint, incomingFingerprint) {
  if (!storedFingerprint) return { ok: true }
  if (fingerprintsEqual(storedFingerprint, incomingFingerprint)) return { ok: true }
  return {
    ok: false,
    status: 409,
    code: IDEMPOTENCY_KEY_REUSED,
    detail: 'Тот же clientRef уже использован для другой debt-операции',
  }
}

export function fingerprintFromMoneyLedgerDebtRepay(row) {
  if (!row) return null
  return buildDebtOpFingerprint('debt_repay', {
    amount: row.amount,
    method: row.meta?.method || (String(row.type || '').includes('card') ? 'card' : 'cash'),
    clientId: row.meta?.clientId,
    cardNum: row.meta?.cardNum || row.cardNum,
    orderId: row.meta?.orderId || row.orderId,
    shiftId: row.shiftId,
  })
}

export function fingerprintFromMoneyLedgerCashAdvance(row) {
  if (!row) return null
  return buildDebtOpFingerprint('cash_advance', {
    amount: row.amount,
    method: 'cash',
    clientId: row.meta?.clientId,
    cardNum: row.meta?.cardNum || row.cardNum,
    shiftId: row.shiftId,
  })
}

export function fingerprintFromPosSale(sale) {
  if (!sale) return null
  return buildDebtOpFingerprint('pos_sale', {
    amount: sale.total,
    debtAdded: sale.debtAdded,
    clientId: sale.clientId,
    cardNum: sale.cardNum,
    method: sale.paymentMethod || null,
    shiftId: sale.shiftId,
    // orderId omitted — remappable
  })
}

export function requireClientRef(clientRef) {
  const ref = String(clientRef || '').trim()
  if (ref) return { ok: true, clientRef: ref }
  return {
    ok: false,
    status: 400,
    code: CLIENT_REF_REQUIRED,
    detail: 'clientRef обязателен для идемпотентной debt-операции',
  }
}

/** Deterministic opRefs doc id (aligns with uq_docs_oprefs_kind_client_ref / claim style). */
export function debtOpRefDocId(kind, clientRef) {
  const k = String(kind || '').trim()
  const ref = String(clientRef || '').trim()
  if (!k || !ref) return ''
  return `op:${k}:${ref}`
}
