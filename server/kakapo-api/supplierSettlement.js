/**
 * ONLINE-O1 — canonical supplier settlement (payment / adjustment / reversal).
 *
 * Invariant:
 *   payableAmount = max(0, totalSupplied - totalPaid)
 *   creditBalance = max(0, totalPaid - totalSupplied)  // explicit overpay credit, never silent trim
 *
 * Real money (cash/card): shift/vault + moneyLedger (+ finance_move when standalone).
 * Adjustment (book): supplier ledger only — no fabricated cash.
 */
'use strict'

import { queueDocDelete } from './db.js'
import { appendMoneyLedger } from './financeTruth.js'

function filterMoneyLedger(db, predKeep) {
  db.moneyLedger = (db.moneyLedger || []).filter(predKeep)
}

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100
}

function nowIso() {
  return new Date().toISOString()
}

function nextId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export const SETTLEMENT_METHOD = Object.freeze({
  ADJUSTMENT: 'adjustment',
  CASH: 'cash',
  CARD: 'card',
})

export function supplierPayableAmount(supplier) {
  if (!supplier) return 0
  return round2(Math.max(0, (Number(supplier.totalSupplied) || 0) - (Number(supplier.totalPaid) || 0)))
}

export function supplierCreditBalance(supplier) {
  if (!supplier) return 0
  return round2(Math.max(0, (Number(supplier.totalPaid) || 0) - (Number(supplier.totalSupplied) || 0)))
}

/** @param {object} supplier */
export function syncSupplierLedger(supplier) {
  if (!supplier) return supplier
  supplier.payableAmount = supplierPayableAmount(supplier)
  supplier.creditBalance = supplierCreditBalance(supplier)
  return supplier
}

function getSupplier(db, supplierId) {
  const supplier = (db.suppliers || []).find(s => String(s.id) === String(supplierId))
  if (!supplier) {
    const err = new Error('Поставщик не найден')
    err.status = 404
    throw err
  }
  return supplier
}

export function assertSupplierPayVersion(supplier, expected, actionLabel = 'Оплату') {
  if (expected === undefined || expected === null || expected === '') return
  const exp = Number(expected)
  if (!Number.isFinite(exp)) return
  const pay = Number(supplier.payVersion)
  const current = Number.isFinite(pay) ? pay : Number(supplier.debtVersion) || 0
  if (exp !== current) {
    const err = new Error(
      `Оплаты уже меняли на другой кассе (версия ${current}, ожидали ${exp}). ${actionLabel} не приняли — обновите данные.`,
    )
    err.status = 409
    err.code = 'SUPPLIER_PAY_VERSION_CONFLICT'
    throw err
  }
}

export function assertSupplierPaymentAmount(supplier, amount) {
  const amt = round2(amount)
  if (!(amt > 0)) {
    const err = new Error('Укажите сумму оплаты')
    err.status = 400
    throw err
  }
  const payable = supplierPayableAmount(supplier)
  if (amt > payable + 0.009) {
    const err = new Error(
      `Сумма ${amt.toFixed(2)} превышает долг ${payable.toFixed(2)} сом. Переплата не принимается — используйте корректировку после уменьшения закупок или отмените лишние оплаты.`,
    )
    err.status = 409
    err.code = 'SUPPLIER_OVERPAY_REJECTED'
    throw err
  }
  return amt
}

function shiftExpectedCash(shift) {
  return round2(
    (Number(shift.openingCash) || 0)
    + (Number(shift.salesCash) || 0)
    + (Number(shift.cashInTotal) || 0)
    - (Number(shift.expenseTotal) || 0),
  )
}

function touchShift(shift) {
  if (!shift) return
  shift.updatedAtIso = nowIso()
}

function applyCashOut(db, { amount, payFrom, method, shift, posId }) {
  const amt = round2(amount)
  if (payFrom === 'vault') {
    if (!db.cashVault) db.cashVault = { cashTotal: 0, cardTotal: 0, transfers: [] }
    const have = method === 'card'
      ? round2(Number(db.cashVault.cardTotal) || 0)
      : round2(Number(db.cashVault.cashTotal) || 0)
    if (amt > have + 0.009) {
      throw new Error(
        method === 'card'
          ? `В основном ящике на карте только ${have.toFixed(2)} сом`
          : `В основном ящике наличных только ${have.toFixed(2)} сом`,
      )
    }
    if (method === 'card') {
      db.cashVault.cardTotal = round2(have - amt)
    } else {
      db.cashVault.cashTotal = round2(have - amt)
    }
    return { shift: null, posId: posId || '' }
  }
  if (!shift) throw new Error('Нет открытой смены — откройте смену или оплатите из основного ящика')
  const expected = method === 'card'
    ? round2(Number(shift.salesCard) || 0)
    : shiftExpectedCash(shift)
  if (amt > expected + 0.009) {
    throw new Error(
      method === 'card'
        ? `На карте смены только ${expected.toFixed(2)} сом`
        : `В кассе недостаточно наличных (доступно ${expected.toFixed(2)} сом)`,
    )
  }
  if (method === 'card') {
    shift.salesCard = round2(expected - amt)
  } else {
    shift.expenseTotal = round2((Number(shift.expenseTotal) || 0) + amt)
  }
  touchShift(shift)
  return { shift, posId: shift.posId || posId || '' }
}

function restoreCashOut(db, payment) {
  const amount = round2(payment.amount)
  if (!(amount > 0.001)) return
  const payFrom = payment.payFrom === 'vault' ? 'vault' : 'shift'
  const method = payment.method === 'card' ? 'card' : 'cash'
  if (payFrom === 'vault') {
    if (!db.cashVault) db.cashVault = { cashTotal: 0, cardTotal: 0, transfers: [] }
    if (method === 'card') {
      db.cashVault.cardTotal = round2((Number(db.cashVault.cardTotal) || 0) + amount)
    } else {
      db.cashVault.cashTotal = round2((Number(db.cashVault.cashTotal) || 0) + amount)
    }
    return
  }
  if (payment.shiftId) {
    const shift = (db.posShifts || []).find(s => s.id === payment.shiftId)
    if (shift) {
      if (method === 'card') {
        shift.salesCard = round2((Number(shift.salesCard) || 0) + amount)
      } else {
        shift.expenseTotal = round2(Math.max(0, (Number(shift.expenseTotal) || 0) - amount))
      }
      touchShift(shift)
    }
  }
}

/**
 * Canonical supplier settlement (payment or book adjustment).
 * @returns {{ payment, financeMove?, supplier }}
 */
export function applySupplierSettlement(db, data = {}) {
  const supplierId = String(data.supplierId || '').trim()
  const supplier = getSupplier(db, supplierId)
  const amount = assertSupplierPaymentAmount(supplier, data.amount)
  assertSupplierPayVersion(supplier, data.expectedPayVersion ?? data.expectedDebtVersion ?? data.debtVersion)

  const methodRaw = String(data.settlementMethod || data.method || SETTLEMENT_METHOD.ADJUSTMENT).toLowerCase()
  const settlementMethod = methodRaw === 'card'
    ? SETTLEMENT_METHOD.CARD
    : methodRaw === 'cash'
      ? SETTLEMENT_METHOD.CASH
      : SETTLEMENT_METHOD.ADJUSTMENT

  const payFrom = settlementMethod === SETTLEMENT_METHOD.ADJUSTMENT
    ? 'book'
    : (data.payFrom === 'vault' ? 'vault' : 'shift')

  let shift = null
  let posId = String(data.posId || '').trim()
  let financeMove = null
  const paymentId = data.paymentId || nextId('SPAY')

  if (settlementMethod !== SETTLEMENT_METHOD.ADJUSTMENT) {
    if (data.shiftId) {
      shift = (db.posShifts || []).find(s => s.id === data.shiftId && s.status === 'open') || null
    }
    if (!shift && payFrom === 'shift') {
      shift = (db.posShifts || []).find(s => s.status === 'open' && (!posId || s.posId === posId)) || null
    }
    const cashMeta = applyCashOut(db, {
      amount,
      payFrom,
      method: settlementMethod === SETTLEMENT_METHOD.CARD ? 'card' : 'cash',
      shift,
      posId,
    })
    shift = cashMeta.shift
    posId = cashMeta.posId

    if (!data.skipFinanceMove) {
      financeMove = {
        id: data.financeMoveId || nextId('FIN'),
        type: 'withdraw',
        amount,
        note: String(data.note || '').trim(),
        createdBy: String(data.cashierName || data.createdBy || shift?.cashierName || '').trim(),
        createdAtIso: data.createdAtIso || nowIso(),
        shiftId: shift?.id,
        posId,
        supplierId: supplier.id,
        supplierName: supplier.name,
        clientRef: data.clientRef || undefined,
        payFrom,
        method: settlementMethod === SETTLEMENT_METHOD.CARD ? 'card' : 'cash',
        refType: 'supplier_settlement',
      }
      db.financeMoves.unshift(financeMove)
    }

    appendMoneyLedger(db, {
      type: 'supplier_pay',
      amount,
      direction: 'out',
      cashAffect: settlementMethod === SETTLEMENT_METHOD.CASH,
      posId,
      shiftId: shift?.id || '',
      cashierId: String(data.cashierId || shift?.cashierId || '').trim(),
      cashierName: String(data.cashierName || shift?.cashierName || '').trim(),
      refType: financeMove ? 'finance_move' : 'supplier_payment',
      refId: financeMove?.id || paymentId,
      clientRef: data.clientRef || '',
      reason: data.reason || `Оплата поставщику · ${supplier.name}`,
      note: String(data.note || '').trim(),
      meta: {
        payFrom,
        method: settlementMethod,
        supplierId: supplier.id,
        settlementMethod,
      },
    })
  }

  supplier.totalPaid = round2((Number(supplier.totalPaid) || 0) + amount)
  syncSupplierLedger(supplier)
  supplier.payVersion = (Number(supplier.payVersion) || 0) + 1

  const payment = {
    id: paymentId,
    supplierId: supplier.id,
    supplierName: supplier.name,
    amount,
    paidAtIso: data.paidAtIso || nowIso(),
    note: String(data.note || '').trim(),
    clientRef: data.clientRef || undefined,
    settlementMethod,
    method: settlementMethod === SETTLEMENT_METHOD.ADJUSTMENT ? undefined : settlementMethod,
    payFrom: settlementMethod === SETTLEMENT_METHOD.ADJUSTMENT ? 'book' : payFrom,
    shiftId: shift?.id,
    posId: posId || undefined,
    financeMoveId: financeMove?.id,
    receiptId: data.receiptId || undefined,
    sourceType: data.sourceType || 'payment',
  }
  if (!Array.isArray(db.supplierPayments)) db.supplierPayments = []
  db.supplierPayments.unshift(payment)

  return { payment, financeMove, supplier }
}

/**
 * Reverse a standalone supplier payment row (delete semantics).
 */
export function reverseSupplierSettlementPayment(db, supplierId, paymentId, data = {}) {
  const idx = (db.supplierPayments || []).findIndex(p => p.id === paymentId && p.supplierId === supplierId)
  if (idx < 0) throw new Error('Платёж не найден')
  const payment = db.supplierPayments[idx]
  const supplier = getSupplier(db, supplierId)
  // Не OCC на DELETE: касса часто отменяет свою же оплату со старым expectedPayVersion
  // (после create локальный payVersion отстаёт). Удаление по paymentId идемпотентно.
  void data

  const settlementMethod = payment.settlementMethod
    || (payment.payFrom === 'book' ? SETTLEMENT_METHOD.ADJUSTMENT : (payment.method === 'card' ? SETTLEMENT_METHOD.CARD : SETTLEMENT_METHOD.CASH))

  if (settlementMethod !== SETTLEMENT_METHOD.ADJUSTMENT) {
    restoreCashOut(db, payment)
    const finId = String(payment.financeMoveId || '')
    if (finId) {
      db.financeMoves = (db.financeMoves || []).filter(m => String(m.id) !== finId)
      queueDocDelete('financeMoves', finId)
      filterMoneyLedger(db, e => !(e.refType === 'finance_move' && String(e.refId) === finId))
    } else {
      filterMoneyLedger(db, e => !(e.refType === 'supplier_payment' && String(e.refId) === String(payment.id)))
    }
  }

  supplier.totalPaid = round2(Math.max(0, (Number(supplier.totalPaid) || 0) - payment.amount))
  syncSupplierLedger(supplier)
  supplier.payVersion = (Number(supplier.payVersion) || 0) + 1
  db.supplierPayments.splice(idx, 1)
  return { id: paymentId, payment, supplier }
}

/** After supply change: never delete payments — only refresh derived balances. */
export function reconcileSupplierLedgerAfterSupplyChange(db, supplierId) {
  if (!supplierId) return null
  const supplier = (db.suppliers || []).find(s => String(s.id) === String(supplierId))
  if (!supplier) return null
  syncSupplierLedger(supplier)
  return supplier
}
