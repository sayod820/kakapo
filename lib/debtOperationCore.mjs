/**
 * Phase D1 — durable DebtOperation model (pure).
 * Canonical representation for future local-first debt phases.
 * No DB writes, no network, no runtime side effects.
 */

export const DEBT_OPERATION_TYPES = Object.freeze([
  'sale_on_credit',
  'cash_advance',
  'debt_repay',
])

export const DEBT_OPERATION_SYNC_STATES = Object.freeze([
  'pending',
  'syncing',
  'acked',
  'failed',
  'held',
])

export const DEBT_OPERATION_METHODS = Object.freeze(['cash', 'card', 'other'])

/** Same money rounding as debtUiProjection / POS helpers. */
export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

/** Fixed 2-decimal money as integer cents (model/tests only). */
export function moneyToCents(n) {
  return Math.round(round2(n) * 100)
}

export function centsToMoney(cents) {
  return round2((Number(cents) || 0) / 100)
}

export function isSyntheticCashTarget(id) {
  return /^cash-/i.test(String(id || '').trim())
}

/**
 * Canonical server debtLedger target id.
 * Accepts DL-* / ldg-* / bare non-cash ledger ids.
 * Rejects empty and synthetic cash-*.
 */
export function isCanonicalDebtLedgerTarget(id) {
  const s = String(id || '').trim()
  if (!s) return false
  if (isSyntheticCashTarget(s)) return false
  return true
}

function strOrNull(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s ? s : null
}

function pickClientRef(input) {
  const ref = strOrNull(input?.clientRef) || strOrNull(input?.operationId)
  return ref || ''
}

function pickSyncState(input) {
  const s = String(input?.syncState || '').trim()
  if (DEBT_OPERATION_SYNC_STATES.includes(s)) return s
  if (input?.held || input?.syncHeld) return 'held'
  if (input?.failed) return 'failed'
  if (input?.acked || input?.synced) return 'acked'
  if (input?.syncing) return 'syncing'
  return 'pending'
}

function pickMethod(input) {
  const m = String(input?.method || '').trim().toLowerCase()
  if (m === 'cash' || m === 'card' || m === 'other') return m
  return null
}

/**
 * Prefer explicit targetDebtLedgerId; else promote non-cash orderId that looks like a ledger id.
 * Never promotes synthetic cash-* into targetDebtLedgerId.
 */
function resolveTargetDebtLedgerId(input) {
  const explicit = strOrNull(input?.targetDebtLedgerId) || strOrNull(input?.debtLedgerId)
  // Preserve explicit value as-is (including synthetic cash-*) so validators can reject without mutation
  if (explicit) return explicit
  const orderId = strOrNull(input?.orderId) || strOrNull(input?.targetOrderId)
  if (!orderId) return null
  if (isSyntheticCashTarget(orderId)) return null
  if (/^DL-/i.test(orderId) || /^ldg-/i.test(orderId)) return orderId
  return null
}

function resolveTargetOrderId(input) {
  return strOrNull(input?.targetOrderId) || strOrNull(input?.orderId)
}

function baseFields(input, overrides) {
  const clientRef = pickClientRef(input)
  const createdAt = strOrNull(input?.createdAt)
    || strOrNull(input?.createdAtIso)
    || strOrNull(overrides?.createdAt)
    || ''
  const opSeqRaw = input?.opSeq ?? input?.seq
  const opSeq = opSeqRaw == null || opSeqRaw === ''
    ? null
    : (Number.isFinite(Number(opSeqRaw)) ? Number(opSeqRaw) : null)

  return {
    operationId: clientRef,
    clientRef,
    clientId: String(input?.clientId || overrides?.clientId || '').trim(),
    cardNum: strOrNull(input?.cardNum) || strOrNull(input?.num) || null,
    amount: round2(overrides?.amount ?? input?.amount ?? 0),
    method: pickMethod(input),
    targetDebtLedgerId: resolveTargetDebtLedgerId(input),
    targetOrderId: resolveTargetOrderId(input),
    saleId: strOrNull(input?.saleId) || strOrNull(input?.id) || null,
    shiftId: strOrNull(input?.shiftId),
    createdAt,
    opSeq,
    syncState: pickSyncState(input),
    appliedLocal: !!(input?.appliedLocal ?? overrides?.appliedLocal ?? false),
    ...overrides,
    // Re-apply identity after overrides so callers cannot desync operationId/clientRef
    operationId: clientRef,
    clientRef,
  }
}

/**
 * Map existing credit-sale / pos sale payload → DebtOperation.
 * Does not mutate input.
 */
export function toDebtOperationFromSale(input = {}) {
  const debtAdded = round2(
    input?.debtAdded != null ? input.debtAdded : (input?.amount != null ? input.amount : 0),
  )
  const amount = debtAdded > 0 ? debtAdded : round2(input?.amount || 0)
  const op = baseFields(input, {
    type: 'sale_on_credit',
    amount,
    debtDelta: round2(Math.abs(amount)),
    method: pickMethod(input) || 'other',
    appliedLocal: input?.appliedLocal != null ? !!input.appliedLocal : true,
  })
  // saleId: prefer explicit saleId over generic id when both exist
  if (strOrNull(input?.saleId)) op.saleId = strOrNull(input.saleId)
  return op
}

/**
 * Map existing debt_repay queue/API payload → DebtOperation.
 */
export function toDebtOperationFromRepayment(input = {}) {
  const amount = round2(Math.abs(Number(input?.amount) || 0))
  const op = baseFields(input, {
    type: 'debt_repay',
    amount,
    debtDelta: round2(-amount),
    method: pickMethod(input) || 'cash',
    appliedLocal: input?.appliedLocal != null ? !!input.appliedLocal : true,
  })
  // If caller explicitly set synthetic cash-* as targetDebtLedgerId, preserve for validator
  // (do not auto-rewrite). resolveTargetDebtLedgerId already returns it when explicit.
  const explicit = strOrNull(input?.targetDebtLedgerId) || strOrNull(input?.debtLedgerId)
  if (explicit) op.targetDebtLedgerId = explicit
  return op
}

/**
 * Map existing cash_advance payload → DebtOperation.
 */
export function toDebtOperationFromCashAdvance(input = {}) {
  const amount = round2(Math.abs(Number(input?.amount) || 0))
  const op = baseFields(input, {
    type: 'cash_advance',
    amount,
    debtDelta: round2(Math.abs(amount)),
    method: pickMethod(input) || 'cash',
    appliedLocal: input?.appliedLocal != null ? !!input.appliedLocal : true,
  })
  // Before server mapping, targetDebtLedgerId may be null (allowed)
  if (!strOrNull(input?.targetDebtLedgerId) && !strOrNull(input?.debtLedgerId) && !strOrNull(input?.debtLedgerEntryId)) {
    op.targetDebtLedgerId = null
  } else {
    const led = strOrNull(input?.targetDebtLedgerId)
      || strOrNull(input?.debtLedgerId)
      || strOrNull(input?.debtLedgerEntryId)
    op.targetDebtLedgerId = led
  }
  return op
}

/**
 * Pure validator — diagnostics / tests only in D1.
 * Does not mutate op.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateDebtOperation(op) {
  const errors = []
  if (!op || typeof op !== 'object') {
    return { ok: false, errors: ['op_missing'] }
  }

  const operationId = String(op.operationId || '').trim()
  const clientRef = String(op.clientRef || '').trim()
  if (!operationId) errors.push('operationId_missing')
  if (!clientRef) errors.push('clientRef_missing')
  if (operationId && clientRef && operationId !== clientRef) {
    errors.push('operationId_must_equal_clientRef')
  }

  const clientId = String(op.clientId || '').trim()
  if (!clientId) errors.push('clientId_missing')

  if (!DEBT_OPERATION_TYPES.includes(op.type)) {
    errors.push('type_invalid')
  }

  const amount = Number(op.amount)
  if (!(Number.isFinite(amount) && amount > 0)) {
    errors.push('amount_must_be_positive')
  }

  const debtDelta = Number(op.debtDelta)
  if (!Number.isFinite(debtDelta)) {
    errors.push('debtDelta_invalid')
  } else if (op.type === 'sale_on_credit' || op.type === 'cash_advance') {
    if (!(debtDelta > 0)) errors.push('debtDelta_must_be_positive_for_charge')
    if (Number.isFinite(amount) && round2(debtDelta) !== round2(amount)) {
      errors.push('debtDelta_must_equal_amount_for_charge')
    }
  } else if (op.type === 'debt_repay') {
    if (!(debtDelta < 0)) errors.push('debtDelta_must_be_negative_for_repay')
    if (Number.isFinite(amount) && round2(debtDelta) !== round2(-amount)) {
      errors.push('debtDelta_must_equal_neg_amount_for_repay')
    }
  }

  const target = strOrNull(op.targetDebtLedgerId)
  if (target != null) {
    if (isSyntheticCashTarget(target)) {
      errors.push('targetDebtLedgerId_synthetic_cash_not_canonical')
    } else if (!isCanonicalDebtLedgerTarget(target)) {
      errors.push('targetDebtLedgerId_not_canonical')
    }
  }

  const createdAt = String(op.createdAt || '').trim()
  if (!createdAt) {
    errors.push('createdAt_missing')
  } else {
    const t = Date.parse(createdAt)
    if (!Number.isFinite(t)) errors.push('createdAt_invalid')
  }

  if (!DEBT_OPERATION_SYNC_STATES.includes(op.syncState)) {
    errors.push('syncState_invalid')
  }

  if (typeof op.appliedLocal !== 'boolean') {
    errors.push('appliedLocal_must_be_boolean')
  }

  if (op.method != null && op.method !== '' && !DEBT_OPERATION_METHODS.includes(op.method)) {
    errors.push('method_invalid')
  }

  return { ok: errors.length === 0, errors }
}

/** JSON round-trip helper for stability tests. */
export function serializeDebtOperation(op) {
  return JSON.stringify(op)
}

export function deserializeDebtOperation(raw) {
  return JSON.parse(typeof raw === 'string' ? raw : String(raw))
}
