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

/**
 * PC-14: committed ledger exists but retry fingerprint drifted (shiftId / missing optional fields).
 * Same business op — not a different action.
 */
export function isAckLostCompatibleReplay(storedFingerprint, incomingFingerprint) {
  if (!storedFingerprint || !incomingFingerprint) return false
  if (fingerprintsEqual(storedFingerprint, incomingFingerprint)) return true
  const a = storedFingerprint
  const b = incomingFingerprint
  if (String(a.kind || '') !== String(b.kind || '')) return false
  if (round2(a.amount) !== round2(b.amount)) return false
  if (String(a.method || '') !== String(b.method || '')) return false
  if (String(a.cardNum || '').toUpperCase() !== String(b.cardNum || '').toUpperCase()) return false
  const aCid = String(a.clientId || '').trim()
  const bCid = String(b.clientId || '').trim()
  if (aCid && bCid && aCid !== bCid) return false
  const aOid = String(a.orderId || '').trim()
  const bOid = String(b.orderId || '').trim()
  if (aOid && bOid && aOid !== bOid) return false
  return true
}

const DEBT_LEDGER_REF_TYPES = Object.freeze({
  debt_repay: 'debt_repay',
  cash_advance: 'cash_advance',
})

export function findMoneyLedgerForDebtKind(db, kind, clientRef) {
  const ref = String(clientRef || '').trim()
  const refType = DEBT_LEDGER_REF_TYPES[String(kind || '').trim()]
  if (!ref || !refType) return null
  return (db.moneyLedger || []).find((r) =>
    String(r.refType || '') === refType
    && (String(r.clientRef || '') === ref || String(r.meta?.clientRef || '') === ref),
  ) || null
}

export function findFinanceMoveByClientRef(db, clientRef) {
  const ref = String(clientRef || '').trim()
  if (!ref) return null
  return (db.financeMoves || []).find((m) => String(m.clientRef || '') === ref) || null
}

/** Same clientRef already used for a different committed operation kind. */
export function findCrossKindOpRefConflict(db, kind, clientRef) {
  const ref = String(clientRef || '').trim()
  const k = String(kind || '').trim()
  if (!ref || !k) return null
  for (const row of db.opRefs || []) {
    if (String(row.clientRef || '').trim() !== ref) continue
    if (String(row.kind || '').trim() === k) continue
    if (row.result != null && row.result.status !== 'applying') return row
  }
  return null
}

export function fingerprintFromLedgerKind(kind, row) {
  if (!row) return null
  if (kind === 'debt_repay') return fingerprintFromMoneyLedgerDebtRepay(row)
  if (kind === 'cash_advance') return fingerprintFromMoneyLedgerCashAdvance(row)
  return null
}

/**
 * PC-14 central resolver for debt-family routes.
 * @returns {{ action: 'continue' } | { action: 'replay', payload: object } | { action: 'conflict', status: number, body: object }}
 */
export function resolveDebtOpIdempotency(db, opts = {}) {
  const kind = String(opts.kind || '').trim()
  const clientRef = String(opts.clientRef || '').trim()
  const fingerprint = opts.fingerprint
  const findOpRefRow = typeof opts.findOpRefRow === 'function' ? opts.findOpRefRow : () => null

  const cross = findCrossKindOpRefConflict(db, kind, clientRef)
  if (cross) {
    return {
      action: 'conflict',
      status: 409,
      body: {
        detail: 'Операция с этим идентификатором уже была использована для другого действия.',
        code: IDEMPOTENCY_KEY_REUSED,
        clientRef,
        kind,
        otherKind: cross.kind,
      },
    }
  }

  const ledger = findMoneyLedgerForDebtKind(db, kind, clientRef)
  const ledgerFp = fingerprintFromLedgerKind(kind, ledger)
  const row = findOpRefRow(kind, clientRef)

  const canReplay = (storedFp, incomingFp) => {
    if (!incomingFp) return false
    if (!storedFp) return !!ledger
    const strict = checkIdempotencyReplay(storedFp, incomingFp)
    if (strict.ok) return true
    return ledger && isAckLostCompatibleReplay(storedFp, incomingFp)
      && isAckLostCompatibleReplay(ledgerFp, incomingFp)
  }

  if (row && row.result && row.result.status === 'applying') {
    const check = checkIdempotencyReplay(row.fingerprint, fingerprint)
    if (!check.ok) {
      return { action: 'conflict', status: check.status || 409, body: { ...check, clientRef, kind } }
    }
    return { action: 'continue' }
  }

  if (row && row.result != null) {
    if (canReplay(row.fingerprint, fingerprint)) {
      const result = row.result && typeof row.result === 'object' ? row.result : {}
      return {
        action: 'replay',
        payload: {
          ...result,
          clientRef,
          kind,
          replayed: true,
          duplicate: true,
          idempotentReplay: true,
        },
      }
    }
    if (ledger && isAckLostCompatibleReplay(ledgerFp, fingerprint)) {
      return {
        action: 'replay',
        payload: {
          ...row.result,
          clientRef,
          kind,
          replayed: true,
          duplicate: true,
          idempotentReplay: true,
          ackLostBackstop: true,
        },
      }
    }
    const check = checkIdempotencyReplay(row.fingerprint, fingerprint)
    return {
      action: 'conflict',
      status: check.status || 409,
      body: {
        detail: check.detail || 'Операция с этим идентификатором уже была использована для другого действия.',
        code: check.code || IDEMPOTENCY_KEY_REUSED,
        clientRef,
        kind,
      },
    }
  }

  if (ledger) {
    const check = checkIdempotencyReplay(ledgerFp, fingerprint)
    if (check.ok || isAckLostCompatibleReplay(ledgerFp, fingerprint)) {
      return { action: 'continue', ledgerBackstop: true, ledger, ledgerFp }
    }
    return {
      action: 'conflict',
      status: check.status || 409,
      body: { ...check, clientRef, kind },
    }
  }

  return { action: 'continue' }
}

/** Read-only status for client reconcile (PC-14). */
export function classifyDebtOpClientRef(db, kind, clientRef, incomingFingerprint = null) {
  const ref = String(clientRef || '').trim()
  const k = String(kind || '').trim()
  if (!ref || !k) return { classification: 'INVALID' }
  const cross = findCrossKindOpRefConflict(db, k, ref)
  if (cross) {
    return {
      classification: 'DIFFERENT_OPERATION',
      clientRef: ref,
      kind: k,
      otherKind: cross.kind,
    }
  }
  const ledger = findMoneyLedgerForDebtKind(db, k, ref)
  const ledgerFp = fingerprintFromLedgerKind(k, ledger)
  if (ledger) {
    if (!incomingFingerprint
      || checkIdempotencyReplay(ledgerFp, incomingFingerprint).ok
      || isAckLostCompatibleReplay(ledgerFp, incomingFingerprint)) {
      return {
        classification: 'EXACT_COMMITTED',
        clientRef: ref,
        kind: k,
        ledgerAmount: round2(ledger.amount),
        fingerprint: ledgerFp,
      }
    }
    return { classification: 'SEMANTIC_MISMATCH', clientRef: ref, kind: k, fingerprint: ledgerFp }
  }
  return { classification: 'NOT_FOUND', clientRef: ref, kind: k }
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

export function requireClientRef(clientRef, opts = {}) {
  let ref = String(clientRef || '').trim()
  if (ref) return { ok: true, clientRef: ref }
  // Migration: old PC kassa / browser builds omit clientRef. While
  // KAKAPO_LEGACY_POS_WRITE=1, synthesize one so warehouse/sales/debt keep working.
  // Duplicate protection still relies on O8 fingerprint / opRef collision.
  if (String(process.env.KAKAPO_LEGACY_POS_WRITE || '') === '1') {
    const fallback = String(opts.fallback || '').trim()
    ref = fallback || `legacy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    console.warn('[idempotency] synthesized legacy clientRef', ref)
    return { ok: true, clientRef: ref, legacySynthesized: true }
  }
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
