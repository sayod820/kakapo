/**
 * ONLINE-O8A — durable mutations for representative trade routes.
 * HTTP 2xx only after runBusinessMutationTx COMMIT (PostgreSQL) or memory atomic commit.
 */
'use strict'

import {
  runBusinessMutationTx,
  CRM_OP_KINDS,
  FIN_OP_KINDS,
  WH_OP_KINDS,
  touchedFromCrm,
  touchedFromFinance,
  touchedFromWarehouse,
  touchedFromSale,
  metaCashVault,
  stockProductAdvisoryLocks,
  crmResourceLocksForCard,
  crmResourceLocksForClient,
  crmResourceLocksForLink,
  sortAdvisoryLocks,
  SALE_OP_KIND,
} from './pg/businessMutationTx.js'
import {
  applyFinancialCardUnlink,
  applyFinancialClientCardLink,
} from './crmLinkMutations.js'
import { CardOwnershipConflict } from './cardCanonical.js'
import { buildO8Fingerprint } from './pg/o8Fingerprint.js'
import {
  buildDebtOpFingerprint,
} from './debtOpIdempotency.js'
import { maybeL13Hold } from './pg/l13Chaos.js'
import { isPostgresEnabled } from './pg/client.js'
import { recordEntityUpsert } from './syncChangeLog.js'
import {
  requireClientRef,
  CLIENT_REF_REQUIRED,
  IDEMPOTENCY_KEY_REUSED,
} from './debtOpIdempotency.js'
import {
  applyDebtRepayment,
  syncDebtLedgerToCard,
  resolveDebtRepaymentTarget,
} from './debtLedger.js'
import { authSubjectKey } from './apiAuth.js'

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100
}

/** Inject authenticated actor into opRef for cross-actor replay denial. */
function runO8Tx(req, opts) {
  return runBusinessMutationTx({
    ...opts,
    authSubject: authSubjectKey(req?.auth) || opts.authSubject || null,
  })
}

function calcCashDepositBonusServer(cash, loyalty) {
  const amt = Math.max(0, Number(cash) || 0)
  if (amt <= 0) return 0
  const tiers = (loyalty?.cashDepositTiers || [])
    .slice()
    .sort((a, b) => (Number(b.minAmount) || 0) - (Number(a.minAmount) || 0))
  const tier = tiers.find(t => amt >= (Number(t.minAmount) || 0))
  const pct = tier ? Number(tier.bonusPercent) || 0 : 0
  return Math.round((amt * pct) / 100 * 100) / 100
}

function txError(res, e, fallback = 'Операция не выполнена') {
  const status = e?.status || 400
  res.status(status).json({
    detail: e?.message || fallback,
    code: e?.code || undefined,
  })
}

async function afterCommitHold() {
  await maybeL13Hold('after_commit_before_response')
}

/**
 * @param {object} ctx — db + pos/loyalty helpers from index.js
 */
export async function handleO8CashTopup(req, res, ctx) {
  const {
    db,
    findCardByNum,
    ensureLoyaltySettings,
    createFinanceMove,
    syncClientFromCardRow,
    auditFromReq,
    broadcastPosUpdate,
  } = ctx

  const num = decodeURIComponent(req.params.num).toUpperCase()
  const card = findCardByNum(num)
  if (!card) return res.status(404).json({ detail: 'Карта не найдена' })

  const refGate = requireClientRef(req.body?.clientRef, { fallback: String(req.body?.localId || req.body?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef

  const cash = round2(req.body?.cash)
  if (!(cash > 0)) {
    return res.status(400).json({ detail: 'Укажите сумму пополнения' })
  }

  const expectedPayVer = req.body?.expectedBonusPayVersion ?? req.body?.bonusPayVersion

  const fingerprint = buildO8Fingerprint(CRM_OP_KINDS.CARD_TOPUP, {
    cardNum: num,
    cash,
    shiftId: req.body?.shiftId || '',
    posId: req.body?.posId || '',
  })

  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: CRM_OP_KINDS.CARD_TOPUP,
      fingerprint,
      mutate: () => {
        if (expectedPayVer != null && expectedPayVer !== '') {
          const exp = Math.max(0, Number(expectedPayVer) || 0)
          const cardGate = findCardByNum(num)
          const current = Number(cardGate?.bonusPayVersion) || 0
          if (exp !== current) {
            const err = new Error(
              `Бонусы уже меняли на другой кассе (версия ${current}, ожидали ${exp}). Пополнение не приняли — обновите данные.`,
            )
            err.status = 409
            throw err
          }
        }
        const loyalty = ensureLoyaltySettings(db)
        const bonusEarned = calcCashDepositBonusServer(cash, loyalty)
        const addToBonus = round2(cash + bonusEarned)

        const move = createFinanceMove(db, {
          type: 'deposit',
          amount: cash,
          note: String(req.body?.note || `Пополнение бонусов · ${card.client || card.phone || card.num}`),
          reason: 'Пополнение бонусов клиента',
          refType: 'card_topup',
          cardNum: num,
          createdBy: req.body?.cashierName,
          cashierId: req.body?.cashierId,
          cashierName: req.body?.cashierName,
          shiftId: req.body?.shiftId,
          posId: req.body?.posId,
          clientRef,
          createdAtIso: req.body?.createdAtIso,
        })

        const cardRow = findCardByNum(num)
        if (move && move._replay) {
          const result = {
            card: cardRow,
            financeMove: move,
            bonusEarned: 0,
            addToBonus: 0,
            replay: true,
            clientRef,
          }
          return {
            result,
            touched: touchedFromCrm(db, {
              card: cardRow,
              financeMove: move,
              clientRef,
              includeRecentLedger: true,
            }),
          }
        }

        cardRow.posCashBonus = round2(Math.max(0, (Number(cardRow.posCashBonus) || 0) + addToBonus))
        cardRow.bonus = round2(Math.max(0, (Number(cardRow.bonus) || 0) + addToBonus))
        cardRow.bonusPayVersion = (Number(cardRow.bonusPayVersion) || 0) + 1
        cardRow.wallet = 0
        const stamp = new Date().toISOString()
        cardRow.updatedAtIso = stamp
        cardRow.serverAtIso = stamp
        syncClientFromCardRow(cardRow)

        recordEntityUpsert(db, 'finance_move', move.id, move, { sourceClientRef: clientRef })
        recordEntityUpsert(db, 'card', cardRow.num, cardRow, { sourceClientRef: clientRef })

        const result = {
          card: cardRow,
          financeMove: move,
          bonusEarned,
          addToBonus,
          clientRef,
        }
        return {
          result,
          touched: touchedFromCrm(db, {
            card: cardRow,
            financeMove: move,
            clientRef,
            includeRecentLedger: true,
          }),
        }
      },
    })

    await afterCommitHold()

    const payload = txOut.result
    if (!txOut.replay) {
      auditFromReq(db, req, {
        app: 'trade',
        action: 'update',
        entity: 'card',
        entityId: num,
        entityName: payload.card?.client || num,
        summary: `Пополнение бонусов ${num} · +${payload.addToBonus}⭐`
          + (payload.bonusEarned > 0 ? ` (деньги +${cash} + бонус +${payload.bonusEarned})` : ` (деньги +${cash})`)
          + ` · касса +${cash}`,
        after: {
          cash,
          bonusEarned: payload.bonusEarned,
          addToBonus: payload.addToBonus,
          bonus: payload.card?.bonus,
          bonusPayVersion: payload.card?.bonusPayVersion,
        },
      })
      broadcastPosUpdate({ kind: 'client-cash-topup', id: payload.financeMove?.id })
    }

    res.json({
      ...payload,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
    })
  } catch (e) {
    txError(res, e, 'Не удалось пополнить бонусы')
  }
}

export async function handleO8SupplierBookPayment(req, res, ctx) {
  const { db, createSupplierPayment, broadcastPosUpdate } = ctx
  const supplierId = req.params.id

  const refGate = requireClientRef(req.body?.clientRef, { fallback: String(req.body?.localId || req.body?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef

  const amount = round2(req.body?.amount)
  if (!(amount > 0)) {
    return res.status(400).json({ detail: 'Укажите сумму оплаты' })
  }

  const payFrom = req.body?.payFrom === 'vault' ? 'vault' : (req.body?.payFrom === 'shift' ? 'shift' : '')
  const methodRaw = String(req.body?.settlementMethod || req.body?.method || 'adjustment').toLowerCase()
  const settlementMethod = methodRaw === 'card' ? 'card' : methodRaw === 'cash' ? 'cash' : 'adjustment'

  const expectedPayVersion = req.body?.expectedPayVersion ?? req.body?.expectedDebtVersion ?? req.body?.debtVersion
  const fingerprint = buildO8Fingerprint(FIN_OP_KINDS.SUPPLIER_PAYMENT_CREATE, {
    supplierId,
    amount,
    settlementMethod,
    payFrom: payFrom || (settlementMethod === 'adjustment' ? 'book' : 'shift'),
    expectedPayVersion: expectedPayVersion != null ? Number(expectedPayVersion) : null,
  })

  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: FIN_OP_KINDS.SUPPLIER_PAYMENT_CREATE,
      fingerprint,
      mutate: () => {
        const payment = createSupplierPayment(db, supplierId, {
          amount,
          note: req.body?.note,
          expectedPayVersion,
          clientRef,
          settlementMethod,
          method: req.body?.method,
          payFrom: payFrom || undefined,
          shiftId: req.body?.shiftId,
          posId: req.body?.posId,
          cashierId: req.body?.cashierId,
          cashierName: req.body?.cashierName || req.body?.createdBy,
          createdAtIso: req.body?.createdAtIso,
          reason: req.body?.reason,
        })
        payment.clientRef = clientRef
        const supplier = (db.suppliers || []).find(s => s.id === supplierId)
        recordEntityUpsert(db, 'supplier_payment', payment.id, payment, { sourceClientRef: clientRef })
        if (supplier) {
          recordEntityUpsert(db, 'supplier', supplier.id, { ...supplier, updatedAtIso: new Date().toISOString() }, { sourceClientRef: clientRef })
        }
        let financeMove = null
        if (payment.financeMoveId) {
          financeMove = (db.financeMoves || []).find(m => String(m.id) === String(payment.financeMoveId))
          if (financeMove) recordEntityUpsert(db, 'finance_move', financeMove.id, financeMove, { sourceClientRef: clientRef })
        }
        const shift = payment.shiftId
          ? (db.posShifts || []).find(s => s.id === payment.shiftId)
          : null
        return {
          result: payment,
          touched: touchedFromFinance(db, {
            supplier,
            supplierId,
            payment,
            financeMove,
            shift,
            shiftId: shift?.id,
            clientRef,
            includeRecentLedger: settlementMethod !== 'adjustment',
          }),
        }
      },
    })

    await afterCommitHold()
    if (!txOut.replay) {
      broadcastPosUpdate({ kind: 'supplier_payment', id: txOut.result?.id })
    }
    res.json({
      ...txOut.result,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
    })
  } catch (e) {
    txError(res, e, 'Не удалось провести оплату поставщику')
  }
}

export async function handleO8StockReceiptCreate(req, res, ctx) {
  const {
    db,
    createStockReceipt,
    auditFromReq,
    broadcastPosUpdate,
    broadcastProduct,
  } = ctx

  const refGate = requireClientRef(req.body?.clientRef, { fallback: String(req.body?.localId || req.body?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef

  const body = { ...(req.body || {}), clientRef }
  const items = Array.isArray(body.items) ? body.items : []
  const fingerprint = buildO8Fingerprint(WH_OP_KINDS.STOCK_RECEIPT_CREATE, {
    supplierId: body.supplierId || '',
    paidNow: round2(body.paidNow),
    payFrom: body.payFrom || '',
    method: body.method || '',
    shiftId: body.shiftId || '',
    items: items.map(it => ({
      productId: it.productId,
      qty: round2(it.qty),
      purchaseTotal: round2(it.purchaseTotal),
      costPrice: round2(it.costPrice),
    })),
  })

  try {
    const productIds = items.map(it => it.productId).filter(Boolean)
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: WH_OP_KINDS.STOCK_RECEIPT_CREATE,
      fingerprint,
      advisoryLocks: stockProductAdvisoryLocks(productIds),
      mutate: () => {
        const row = createStockReceipt(db, body)
        row.clientRef = clientRef
        const productIds = (row.items || []).map(it => it.productId).filter(Boolean)
        const supplier = row.supplierId
          ? (db.suppliers || []).find(s => s.id === row.supplierId)
          : null
        const shift = body.shiftId || row.shiftId
          ? (db.posShifts || []).find(s => s.id === (body.shiftId || row.shiftId))
          : null
        const paidPayment = (db.supplierPayments || []).find(p => String(p.receiptId) === String(row.id))
        return {
          result: row,
          touched: touchedFromWarehouse(db, {
            receipt: row,
            supplier,
            supplierId: row.supplierId,
            productIds,
            shift,
            shiftId: shift?.id,
            clientRef,
            includeRecentLedger: true,
            payment: paidPayment,
          }),
        }
      },
    })

    await afterCommitHold()

    const row = txOut.result
    if (!txOut.replay) {
      auditFromReq(db, req, {
        action: 'create',
        entity: 'stock',
        entityId: row.id,
        entityName: row.supplierName || row.id,
        summary: `Приход товара · ${row.supplierName || row.id}` + (row.items?.length ? ` · ${row.items.length} поз.` : ''),
      })
      broadcastPosUpdate({ kind: 'receipt', id: row.id })
      broadcastProduct({ reason: 'receipt' })
    }

    res.json({
      ...row,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
    })
  } catch (e) {
    txError(res, e, 'Не удалось провести приход')
  }
}

export async function handleO8StockReceiptUpdate(req, res, ctx) {
  const {
    db,
    updateStockReceipt,
    auditFromReq,
    broadcastPosUpdate,
    broadcastProduct,
  } = ctx

  const refGate = requireClientRef(req.body?.clientRef, { fallback: String(req.body?.localId || req.body?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef
  const receiptId = req.params.id
  const body = { ...(req.body || {}), clientRef }
  const items = Array.isArray(body.items) ? body.items : []
  const fingerprint = buildO8Fingerprint(WH_OP_KINDS.STOCK_RECEIPT_UPDATE, {
    receiptId,
    supplierId: body.supplierId || '',
    paidNow: round2(body.paidNow),
    items: items.map(it => ({
      productId: it.productId,
      qty: round2(it.qty),
      purchaseTotal: round2(it.purchaseTotal),
    })),
  })

  try {
    const productIds = items.map(it => it.productId).filter(Boolean)
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: WH_OP_KINDS.STOCK_RECEIPT_UPDATE,
      fingerprint,
      advisoryLocks: stockProductAdvisoryLocks(productIds),
      mutate: () => {
        const row = updateStockReceipt(db, receiptId, body)
        row.clientRef = clientRef
        const productIds = (row.items || []).map(it => it.productId).filter(Boolean)
        const supplier = row.supplierId
          ? (db.suppliers || []).find(s => s.id === row.supplierId)
          : null
        const paidPayment = (db.supplierPayments || []).find(p => String(p.receiptId) === String(row.id))
        const shift = row.shiftId
          ? (db.posShifts || []).find(s => s.id === row.shiftId)
          : null
        return {
          result: row,
          touched: touchedFromWarehouse(db, {
            receipt: row,
            supplier,
            supplierId: row.supplierId,
            productIds,
            shift,
            shiftId: shift?.id,
            clientRef,
            includeRecentLedger: true,
            payment: paidPayment,
          }),
        }
      },
    })

    await afterCommitHold()
    const row = txOut.result
    if (!txOut.replay) {
      auditFromReq(db, req, {
        action: 'update',
        entity: 'stock',
        entityId: row.id,
        entityName: row.supplierName || row.id,
        summary: `Изменён приход · ${row.supplierName || row.id}`,
      })
      broadcastPosUpdate({ kind: 'receipt', id: row.id, updated: true })
      broadcastProduct({ reason: 'receipt-update' })
    }
    res.json({
      ...row,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
    })
  } catch (e) {
    txError(res, e, 'Не удалось изменить приход')
  }
}

export async function handleO8StockReceiptDelete(req, res, ctx) {
  const {
    db,
    deleteStockReceipt,
    auditFromReq,
    broadcastPosUpdate,
    broadcastProduct,
  } = ctx

  const refGate = requireClientRef(req.body?.clientRef || req.query?.clientRef, { fallback: String(req.body?.localId || req.body?.id || req.query?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef
  const receiptId = req.params.id
  const fingerprint = buildO8Fingerprint(WH_OP_KINDS.STOCK_RECEIPT_DELETE, { receiptId })
  const receiptBefore = (db.stockReceipts || []).find(r => r.id === receiptId)
  const lockProductIds = (receiptBefore?.items || []).map(it => it.productId).filter(Boolean)

  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: WH_OP_KINDS.STOCK_RECEIPT_DELETE,
      fingerprint,
      advisoryLocks: stockProductAdvisoryLocks(lockProductIds),
      mutate: () => {
        const row = deleteStockReceipt(db, receiptId)
        const supplier = row.supplierId
          ? (db.suppliers || []).find(s => s.id === row.supplierId)
          : null
        const productIds = lockProductIds.length
          ? lockProductIds
          : (receiptBefore?.items || []).map(it => it.productId).filter(Boolean)
        return {
          result: row,
          deletes: [{ collection: 'stockReceipts', id: String(receiptId) }],
          touched: touchedFromWarehouse(db, {
            supplier,
            supplierId: row.supplierId,
            productIds,
            clientRef,
            includeRecentLedger: true,
          }),
        }
      },
    })

    await afterCommitHold()
    const row = txOut.result
    if (!txOut.replay) {
      auditFromReq(db, req, {
        action: 'delete',
        entity: 'stock',
        entityId: row.id,
        entityName: row.supplierName || row.id,
        summary: `Удалён приход · ${row.supplierName || row.id}`,
      })
      broadcastPosUpdate({ kind: 'receipt', id: row.id, deleted: true })
      broadcastProduct({ reason: 'receipt-delete' })
    }
    res.json({
      ...row,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
    })
  } catch (e) {
    txError(res, e, 'Не удалось удалить приход')
  }
}

export async function handleO8WriteoffCreate(req, res, ctx) {
  const {
    db,
    createStockWriteoff,
    auditFromReq,
    broadcastPosUpdate,
    broadcastProduct,
  } = ctx

  const refGate = requireClientRef(req.body?.clientRef, { fallback: String(req.body?.localId || req.body?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef
  const body = { ...(req.body || {}), clientRef }
  const items = Array.isArray(body.items) ? body.items : []
  const fingerprint = buildO8Fingerprint(WH_OP_KINDS.STOCK_WRITEOFF_CREATE, {
    reason: String(body.reason || '').trim(),
    items: items.map(it => ({ productId: it.productId, qty: round2(it.qty) })),
  })

  try {
    const productIds = items.map(it => it.productId).filter(Boolean)
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: WH_OP_KINDS.STOCK_WRITEOFF_CREATE,
      fingerprint,
      advisoryLocks: stockProductAdvisoryLocks(productIds),
      mutate: () => {
        const row = createStockWriteoff(db, body)
        row.clientRef = clientRef
        const productIds = (row.items || []).map(it => it.productId).filter(Boolean)
        return {
          result: row,
          touched: touchedFromWarehouse(db, {
            writeoff: row,
            productIds,
            clientRef,
          }),
        }
      },
    })

    await afterCommitHold()
    const row = txOut.result
    if (!txOut.replay) {
      auditFromReq(db, req, {
        action: 'create',
        entity: 'stock',
        entityId: row.id,
        entityName: row.reason || row.id,
        summary: `Списание · ${row.reason || row.id}`,
      })
      broadcastPosUpdate({ kind: 'writeoff', id: row.id })
      broadcastProduct({ reason: 'writeoff' })
    }
    res.json({
      ...row,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
    })
  } catch (e) {
    txError(res, e, 'Не удалось провести списание')
  }
}

export async function handleO8WriteoffUpdate(req, res, ctx) {
  const {
    db,
    updateStockWriteoff,
    auditFromReq,
    broadcastPosUpdate,
    broadcastProduct,
  } = ctx

  const refGate = requireClientRef(req.body?.clientRef, { fallback: String(req.body?.localId || req.body?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef
  const writeoffId = req.params.id
  const body = { ...(req.body || {}), clientRef }
  const items = Array.isArray(body.items) ? body.items : []
  const fingerprint = buildO8Fingerprint(WH_OP_KINDS.STOCK_WRITEOFF_UPDATE, {
    writeoffId,
    reason: String(body.reason || '').trim(),
    items: items.map(it => ({ productId: it.productId, qty: round2(it.qty) })),
  })

  const oldWo = (db.writeOffs || []).find(w => w.id === writeoffId)
  const lockPids = new Set([
    ...(items.map(it => it.productId).filter(Boolean)),
    ...(oldWo?.items || []).map(it => it.productId).filter(Boolean),
  ])
  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: WH_OP_KINDS.STOCK_WRITEOFF_UPDATE,
      fingerprint,
      advisoryLocks: stockProductAdvisoryLocks([...lockPids]),
      mutate: () => {
        const row = updateStockWriteoff(db, writeoffId, body)
        row.clientRef = clientRef
        const productIds = (row.items || []).map(it => it.productId).filter(Boolean)
        return {
          result: row,
          touched: touchedFromWarehouse(db, {
            writeoff: row,
            writeoffId,
            productIds,
            clientRef,
          }),
        }
      },
    })

    await afterCommitHold()
    const row = txOut.result
    if (!txOut.replay) {
      auditFromReq(db, req, {
        action: 'update',
        entity: 'stock',
        entityId: row.id,
        entityName: row.reason || row.id,
        summary: `Изменено списание · ${row.reason || row.id}`,
      })
      broadcastPosUpdate({ kind: 'writeoff', id: row.id, updated: true })
      broadcastProduct({ reason: 'writeoff-update' })
    }
    res.json({
      ...row,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
    })
  } catch (e) {
    txError(res, e, 'Не удалось изменить списание')
  }
}

export async function handleO8WriteoffDelete(req, res, ctx) {
  const {
    db,
    deleteStockWriteoff,
    auditFromReq,
    broadcastPosUpdate,
    broadcastProduct,
  } = ctx

  const refGate = requireClientRef(req.body?.clientRef || req.query?.clientRef, { fallback: String(req.body?.localId || req.body?.id || req.query?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef
  const writeoffId = req.params.id
  const fingerprint = buildO8Fingerprint(WH_OP_KINDS.STOCK_WRITEOFF_DELETE, { writeoffId })
  const beforeDel = (db.writeOffs || []).find(w => w.id === writeoffId)
  const delLockPids = (beforeDel?.items || []).map(it => it.productId).filter(Boolean)

  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: WH_OP_KINDS.STOCK_WRITEOFF_DELETE,
      fingerprint,
      advisoryLocks: stockProductAdvisoryLocks(delLockPids),
      mutate: () => {
        const before = (db.writeOffs || []).find(w => w.id === writeoffId)
        const productIds = (before?.items || []).map(it => it.productId).filter(Boolean)
        const row = deleteStockWriteoff(db, writeoffId)
        return {
          result: row,
          touched: touchedFromWarehouse(db, {
            writeoffId,
            productIds,
            clientRef,
          }),
        }
      },
    })

    await afterCommitHold()
    const row = txOut.result
    if (!txOut.replay) {
      auditFromReq(db, req, {
        action: 'delete',
        entity: 'stock',
        entityId: row.id,
        entityName: writeoffId,
        summary: `Удалено списание · ${writeoffId}`,
      })
      broadcastPosUpdate({ kind: 'writeoff', id: writeoffId, deleted: true })
      broadcastProduct({ reason: 'writeoff-delete' })
    }
    res.json({
      ...row,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
    })
  } catch (e) {
    txError(res, e, 'Не удалось удалить списание')
  }
}

function revisionItemsFingerprint(items) {
  return (Array.isArray(items) ? items : []).map(it => ({
    productId: it.productId,
    countedStock: round2(it.countedStock),
    systemStock: Number.isFinite(Number(it.systemStock)) ? round2(it.systemStock) : null,
  }))
}

function revisionProductIds(...lists) {
  const out = new Set()
  for (const list of lists) {
    for (const it of Array.isArray(list) ? list : []) {
      if (it?.productId != null && it.productId !== '') out.add(it.productId)
    }
  }
  return [...out]
}

const REVISION_PENDING_STATUSES = new Set(['pending_queues', 'pending_older', 'applying'])

export async function handleO8RevisionCreate(req, res, ctx) {
  const { db, createStockRevision, auditFromReq, broadcastPosUpdate, broadcastProduct, runRevisionCoordinator } = ctx
  const clientRef = String(req.body?.clientRef || req.query?.clientRef || '').trim()
  const body = { ...(req.body || {}), ...(clientRef ? { clientRef } : {}) }
  const fingerprint = buildO8Fingerprint(WH_OP_KINDS.STOCK_REVISION_CREATE, {
    note: String(body.note || '').trim(),
    items: revisionItemsFingerprint(body.items),
  })

  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: WH_OP_KINDS.STOCK_REVISION_CREATE,
      fingerprint,
      advisoryLocks: stockProductAdvisoryLocks(revisionProductIds(body.items)),
      mutate: () => {
        const row = createStockRevision(db, body)
        if (clientRef) row.clientRef = clientRef
        return {
          result: row,
          touched: touchedFromWarehouse(db, {
            revision: row,
            productIds: revisionProductIds(row.items),
            clientRef,
          }),
        }
      },
    })

    await afterCommitHold()
    const row = txOut.result
    if (!txOut.replay) {
      auditFromReq(db, req, {
        action: 'create',
        entity: 'stock',
        entityId: row.id,
        entityName: row.note || row.id,
        summary: `Ревизия склада · ${row.note || row.id}`,
      })
      broadcastPosUpdate({ kind: 'revision', id: row.id })
      broadcastProduct({ reason: 'revision' })
    }
    if (typeof runRevisionCoordinator === 'function') void runRevisionCoordinator()
    res.json({
      ...row,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
    })
  } catch (e) {
    txError(res, e, 'Не удалось сохранить ревизию')
  }
}

export async function handleO8RevisionUpdate(req, res, ctx) {
  const { db, updateStockRevision, auditFromReq, broadcastPosUpdate, broadcastProduct } = ctx
  const clientRef = String(req.body?.clientRef || req.query?.clientRef || '').trim()
  const revisionId = req.params.id
  const body = { ...(req.body || {}), ...(clientRef ? { clientRef } : {}) }
  const fingerprint = buildO8Fingerprint(WH_OP_KINDS.STOCK_REVISION_UPDATE, {
    revisionId,
    note: String(body.note || '').trim(),
    items: revisionItemsFingerprint(body.items),
  })
  const oldRev = (db.stockRevisions || []).find(r => r.id === revisionId)

  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: WH_OP_KINDS.STOCK_REVISION_UPDATE,
      fingerprint,
      advisoryLocks: stockProductAdvisoryLocks(revisionProductIds(body.items, oldRev?.items)),
      mutate: () => {
        const before = (db.stockRevisions || []).find(r => r.id === revisionId)
        const beforeItems = before?.items || []
        const row = updateStockRevision(db, revisionId, body)
        if (clientRef) row.clientRef = clientRef
        return {
          result: row,
          touched: touchedFromWarehouse(db, {
            revision: row,
            productIds: revisionProductIds(row.items, beforeItems),
            clientRef,
          }),
        }
      },
    })

    await afterCommitHold()
    const row = txOut.result
    if (!txOut.replay) {
      auditFromReq(db, req, {
        action: 'update',
        entity: 'stock',
        entityId: row.id,
        entityName: row.note || row.id,
        summary: `Изменена ревизия · ${row.note || row.id}`,
      })
      broadcastPosUpdate({ kind: 'revision', id: row.id, updated: true })
      broadcastProduct({ reason: 'revision-update' })
    }
    res.json({
      ...row,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
    })
  } catch (e) {
    txError(res, e, 'Не удалось изменить ревизию')
  }
}

export async function handleO8RevisionDelete(req, res, ctx) {
  const { db, deleteStockRevision, auditFromReq, broadcastPosUpdate, broadcastProduct } = ctx
  const clientRef = String(req.body?.clientRef || req.query?.clientRef || '').trim()
  const revisionId = req.params.id
  const fingerprint = buildO8Fingerprint(WH_OP_KINDS.STOCK_REVISION_DELETE, { revisionId })
  const oldRev = (db.stockRevisions || []).find(r => r.id === revisionId)

  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: WH_OP_KINDS.STOCK_REVISION_DELETE,
      fingerprint,
      advisoryLocks: stockProductAdvisoryLocks(revisionProductIds(oldRev?.items)),
      mutate: () => {
        const before = (db.stockRevisions || []).find(r => r.id === revisionId)
        const productIds = revisionProductIds(before?.items)
        const row = deleteStockRevision(db, revisionId)
        return {
          result: row,
          deletes: [{ collection: 'stockRevisions', id: String(revisionId) }],
          touched: touchedFromWarehouse(db, { productIds, clientRef }),
        }
      },
    })

    await afterCommitHold()
    const row = txOut.result
    if (!txOut.replay) {
      auditFromReq(db, req, {
        action: 'delete',
        entity: 'stock',
        entityId: revisionId,
        entityName: oldRev?.note || revisionId,
        summary: `Удалена ревизия · ${oldRev?.note || revisionId}`,
      })
      broadcastPosUpdate({ kind: 'revision', id: revisionId, deleted: true })
      broadcastProduct({ reason: 'revision-delete' })
    }
    res.json({
      ...row,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
    })
  } catch (e) {
    txError(res, e, 'Не удалось удалить ревизию')
  }
}

export async function handleO8RevisionCancel(req, res, ctx) {
  const { db, cancelStockRevision, auditFromReq, broadcastPosUpdate, runRevisionCoordinator } = ctx
  const revisionId = req.params.id
  try {
    const txOut = await runO8Tx(req, {
      db,
      operationKind: WH_OP_KINDS.STOCK_REVISION_CANCEL,
      mutate: () => {
        const row = cancelStockRevision(db, revisionId)
        return { result: row, touched: touchedFromWarehouse(db, { revision: row }) }
      },
    })
    await afterCommitHold()
    const row = txOut.result
    auditFromReq(db, req, {
      action: 'update',
      entity: 'stock',
      entityId: row.id,
      entityName: row.note || row.id,
      summary: `Отменена ревизия · ${row.note || row.id}`,
    })
    broadcastPosUpdate({ kind: 'revision', id: row.id, cancelled: true })
    if (typeof runRevisionCoordinator === 'function') void runRevisionCoordinator()
    res.json(row)
  } catch (e) {
    txError(res, e, 'Не удалось отменить ревизию')
  }
}

/**
 * Revision v2 coordinator step as one business tx: applied stock + revision status
 * are committed together (no debounced snapshot window).
 * @returns {Promise<boolean>} true when something changed
 */
export async function runO8RevisionCoordinatorTx(ctx) {
  const { db, processRevisionQueue } = ctx
  const pendingBefore = (db.stockRevisions || []).filter(r => REVISION_PENDING_STATUSES.has(String(r.status || '')))
  if (!pendingBefore.length) return false
  const lockPids = revisionProductIds(...pendingBefore.map(r => r.items))
  const txOut = await runBusinessMutationTx({
    db,
    operationKind: WH_OP_KINDS.REVISION_RESULT_COMMIT,
    advisoryLocks: stockProductAdvisoryLocks(lockPids),
    mutate: () => {
      const pending = (db.stockRevisions || []).filter(r => REVISION_PENDING_STATUSES.has(String(r.status || '')))
      const changed = processRevisionQueue(db)
      if (!changed) return { result: { changed: false }, touched: [] }
      const applied = pending.filter(r => String(r.status) === 'done')
      const productIds = revisionProductIds(...applied.map(r => r.items))
      try {
        for (const rev of pending) recordEntityUpsert(db, 'revision', rev.id, rev)
        for (const pid of productIds) {
          const p = (db.products || []).find(x => Number(x.id) === Number(pid))
          if (p) recordEntityUpsert(db, 'product', p.id, p)
        }
      } catch { /* sync journal best-effort, docs still committed */ }
      return {
        result: { changed: true, applied: applied.map(r => r.id) },
        touched: touchedFromWarehouse(db, { revisions: pending, productIds }),
      }
    },
  })
  return !!txOut?.result?.changed
}

export async function handleO8ExpenseCreate(req, res, ctx) {
  const { db, createExpense, broadcastPosUpdate } = ctx

  const refGate = requireClientRef(req.body?.clientRef, { fallback: String(req.body?.localId || req.body?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef
  const amount = round2(req.body?.amount)
  const fingerprint = buildO8Fingerprint(FIN_OP_KINDS.EXPENSE_CREATE, {
    amount,
    payFrom: req.body?.payFrom === 'vault' ? 'vault' : 'shift',
    method: req.body?.method === 'card' ? 'card' : 'cash',
    category: String(req.body?.category || '').trim(),
  })

  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: FIN_OP_KINDS.EXPENSE_CREATE,
      fingerprint,
      mutate: () => {
        const row = createExpense(db, { ...(req.body || {}), clientRef })
        row.clientRef = clientRef
        const shift = row.shiftId
          ? (db.posShifts || []).find(s => s.id === row.shiftId)
          : null
        recordEntityUpsert(db, 'expense', row.id, row, { sourceClientRef: clientRef })
        return {
          result: row,
          touched: touchedFromFinance(db, {
            expense: row,
            shift,
            shiftId: shift?.id,
            clientRef,
            includeRecentLedger: true,
          }),
        }
      },
    })
    await afterCommitHold()
    if (!txOut.replay) broadcastPosUpdate({ kind: 'expense', id: txOut.result?.id })
    res.json({
      ...txOut.result,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
    })
  } catch (e) {
    txError(res, e, 'Не удалось добавить расход')
  }
}

export async function handleO8ExpenseDelete(req, res, ctx) {
  const { db, deleteExpense, broadcastPosUpdate } = ctx
  const expenseId = req.params.id

  const refGate = requireClientRef(req.body?.clientRef, { fallback: String(req.body?.localId || req.body?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef
  const fingerprint = buildO8Fingerprint(FIN_OP_KINDS.EXPENSE_DELETE, { expenseId })

  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: FIN_OP_KINDS.EXPENSE_DELETE,
      fingerprint,
      mutate: () => {
        const row = deleteExpense(db, expenseId)
        const shift = row.shiftId
          ? (db.posShifts || []).find(s => s.id === row.shiftId)
          : null
        return {
          result: row,
          touched: touchedFromFinance(db, {
            expenseId,
            shift,
            shiftId: shift?.id,
            clientRef,
            includeRecentLedger: true,
          }),
        }
      },
    })
    await afterCommitHold()
    if (!txOut.replay) broadcastPosUpdate({ kind: 'expense', id: expenseId, deleted: true })
    res.json({
      ...txOut.result,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
    })
  } catch (e) {
    txError(res, e, 'Не удалось удалить расход')
  }
}

export async function handleO8SupplierPaymentDelete(req, res, ctx) {
  const { db, deleteSupplierPayment, broadcastPosUpdate } = ctx
  const supplierId = req.params.id
  const paymentId = req.params.paymentId

  const refGate = requireClientRef(req.body?.clientRef, { fallback: String(req.body?.localId || req.body?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef

  const expectedPayVersion = req.body?.expectedPayVersion ?? req.body?.expectedDebtVersion ?? req.body?.debtVersion
  const fingerprint = buildO8Fingerprint(FIN_OP_KINDS.SUPPLIER_PAYMENT_DELETE, {
    supplierId,
    paymentId,
    expectedPayVersion: expectedPayVersion != null ? Number(expectedPayVersion) : null,
  })

  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: FIN_OP_KINDS.SUPPLIER_PAYMENT_DELETE,
      fingerprint,
      mutate: () => {
        const row = deleteSupplierPayment(db, supplierId, paymentId, {
          expectedPayVersion,
          clientRef,
        })
        const supplier = row.supplier || (db.suppliers || []).find(s => s.id === supplierId)
        const shift = row.payment?.shiftId
          ? (db.posShifts || []).find(s => s.id === row.payment.shiftId)
          : null
        return {
          result: { id: row.id, payment: row.payment, supplierId },
          touched: touchedFromFinance(db, {
            supplier,
            supplierId,
            shift,
            shiftId: shift?.id,
            clientRef,
            includeRecentLedger: true,
          }),
        }
      },
    })

    await afterCommitHold()
    if (!txOut.replay) {
      broadcastPosUpdate({ kind: 'supplier_payment', id: paymentId, deleted: true })
    }
    res.json({
      ...txOut.result,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
    })
  } catch (e) {
    txError(res, e, 'Не удалось удалить платёж')
  }
}

export async function handleO8ShiftOpen(req, res, ctx) {
  const { db, openPosShift, auditFromReq, broadcastPosUpdate } = ctx
  const refGate = requireClientRef(req.body?.clientRef, { fallback: String(req.body?.localId || req.body?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef
  const openingCash = round2(req.body?.openingCash)
  const actorSubject = authSubjectKey(req?.auth)
  // Body cashierId never grants authority — ownership is authenticated actor.
  const fingerprint = buildO8Fingerprint(FIN_OP_KINDS.SHIFT_OPEN, {
    posId: String(req.body?.posId || '').trim(),
    cashierId: String(req.body?.cashierId || '').trim(),
    openingCash,
    openedByAuthSubject: actorSubject || '',
  })
  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: FIN_OP_KINDS.SHIFT_OPEN,
      fingerprint,
      mutate: () => {
        const row = openPosShift(db, { ...(req.body || {}), clientRef })
        row.clientRef = clientRef
        if (actorSubject) {
          row.openedByAuthSubject = actorSubject
          if (req.auth?.principal === 'STAFF' || req.auth?.principal === 'CASHIER') {
            row.openedByEmployeeId = String(req.auth.subjectId || '')
          }
        }
        recordEntityUpsert(db, 'shift', row.id, row, { sourceClientRef: clientRef })
        return {
          result: row,
          touched: touchedFromFinance(db, {
            shift: row,
            shiftId: row.id,
            clientRef,
            includeRecentLedger: true,
          }),
          meta: metaCashVault(db),
        }
      },
    })
    await afterCommitHold()
    if (!txOut.replay) {
      auditFromReq(db, req, {
        app: 'trade',
        action: 'shift_open',
        entity: 'shift',
        entityId: txOut.result?.id,
        entityName: txOut.result?.cashierName || txOut.result?.posId,
        summary: `Открыта смена · ${txOut.result?.cashierName || 'кассир'} · касса ${txOut.result?.openingCash ?? 0}`,
      })
      broadcastPosUpdate({ kind: 'shift', id: txOut.result?.id })
    }
    res.json({
      ...txOut.result,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
    })
  } catch (e) {
    txError(res, e, 'Не удалось открыть смену')
  }
}

export async function handleO8ShiftClose(req, res, ctx) {
  const { db, closePosShift, auditFromReq, broadcastPosUpdate } = ctx
  const shiftId = req.params.id
  const refGate = requireClientRef(req.body?.clientRef, { fallback: String(req.body?.localId || req.body?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef
  const closingCash = round2(req.body?.closingCash)
  const actorSubject = authSubjectKey(req?.auth)
  const fingerprint = buildO8Fingerprint(FIN_OP_KINDS.SHIFT_CLOSE, {
    shiftId,
    closingCash,
    closingCard: req.body?.closingCard != null ? round2(req.body.closingCard) : null,
  })
  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: FIN_OP_KINDS.SHIFT_CLOSE,
      fingerprint,
      mutate: () => {
        const existing = (db.posShifts || []).find(s => String(s.id) === String(shiftId))
        if (existing && actorSubject && req.auth?.principal !== 'ADMIN') {
          const owner = String(existing.openedByAuthSubject || '')
          if (owner && owner !== actorSubject) {
            const err = new Error('Нет доступа к чужой смене')
            err.status = 403
            err.code = 'AUTH_SHIFT_OWNER'
            throw err
          }
          // Body cashierId spoof cannot escalate: require owner match when stamped,
          // or matching employee id for staff-opened shifts.
          if (!owner && existing.openedByEmployeeId) {
            if (String(req.auth.subjectId) !== String(existing.openedByEmployeeId)) {
              const err = new Error('Нет доступа к чужой смене')
              err.status = 403
              err.code = 'AUTH_SHIFT_OWNER'
              throw err
            }
          }
        }
        const row = closePosShift(db, shiftId, { ...(req.body || {}), clientRef })
        row.closeClientRef = clientRef
        recordEntityUpsert(db, 'shift', row.id, row, { sourceClientRef: clientRef })
        return {
          result: row,
          touched: touchedFromFinance(db, {
            shift: row,
            shiftId: row.id,
            clientRef,
            includeRecentLedger: true,
          }),
          meta: metaCashVault(db),
        }
      },
    })
    await afterCommitHold()
    if (!txOut.replay) {
      auditFromReq(db, req, {
        app: 'trade',
        action: 'shift_close',
        entity: 'shift',
        entityId: txOut.result?.id,
        entityName: txOut.result?.cashierName || txOut.result?.posId,
        summary: `Закрыта смена · ${txOut.result?.cashierName || 'кассир'}`,
      })
      broadcastPosUpdate({ kind: 'shift', id: txOut.result?.id })
    }
    res.json({
      ...txOut.result,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
    })
  } catch (e) {
    txError(res, e, 'Не удалось закрыть смену')
  }
}

export async function handleO8FinanceMoveCreate(req, res, ctx) {
  const { db, createFinanceMove, auditFromReq, broadcastPosUpdate } = ctx
  const refGate = requireClientRef(req.body?.clientRef, { fallback: String(req.body?.localId || req.body?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef
  const amount = round2(req.body?.amount)
  const type = req.body?.type === 'withdraw' ? 'withdraw' : 'deposit'
  const fingerprint = buildO8Fingerprint(FIN_OP_KINDS.FINANCE_MOVE_CREATE, {
    type,
    amount,
    payFrom: req.body?.payFrom === 'vault' ? 'vault' : 'shift',
    method: req.body?.method === 'card' ? 'card' : 'cash',
    shiftId: String(req.body?.shiftId || '').trim(),
  })
  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: FIN_OP_KINDS.FINANCE_MOVE_CREATE,
      fingerprint,
      mutate: () => {
        const row = createFinanceMove(db, { ...(req.body || {}), clientRef })
        if (row._replay) {
          return { result: row, touched: [], meta: metaCashVault(db) }
        }
        row.clientRef = clientRef
        const shift = row.shiftId
          ? (db.posShifts || []).find(s => s.id === row.shiftId)
          : null
        return {
          result: row,
          touched: touchedFromFinance(db, {
            financeMove: row,
            shift,
            shiftId: shift?.id,
            clientRef,
            includeRecentLedger: true,
          }),
          meta: metaCashVault(db),
        }
      },
    })
    await afterCommitHold()
    if (!txOut.replay && txOut.result && !txOut.result._replay) {
      const row = txOut.result
      const isIn = row.type !== 'withdraw'
      auditFromReq(db, req, {
        app: 'trade',
        action: isIn ? 'cash_in' : 'cash_out',
        entity: 'cash',
        entityId: row.id,
        entityName: row.supplierName || row.createdBy || row.id,
        summary: (isIn ? `Внесение в кассу · ${row.amount} ЅМ` : `Снятие из кассы · ${row.amount} ЅМ`)
          + (row.note ? ` · ${row.note}` : ''),
        after: { type: row.type, amount: row.amount, note: row.note, shiftId: row.shiftId },
      })
      broadcastPosUpdate({ kind: 'finance-move', id: row.id })
    }
    const out = { ...txOut.result, replayed: !!txOut.replay, duplicate: !!txOut.replay, durable: isPostgresEnabled() }
    delete out._replay
    res.json(out)
  } catch (e) {
    txError(res, e, 'Не удалось сохранить движение')
  }
}

export async function handleO8FinanceMoveDelete(req, res, ctx) {
  const { db, deleteFinanceMove, isCardTopupFinanceMove, broadcastPosUpdate } = ctx
  const moveId = req.params.id
  const refGate = requireClientRef(req.body?.clientRef, { fallback: String(req.body?.localId || req.body?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef
  const existing = (db.financeMoves || []).find(r => String(r.id) === String(moveId))
  if (existing && isCardTopupFinanceMove(existing)) {
    return res.status(409).json({ detail: 'Пополнение бонусов нельзя удалить' })
  }
  const fingerprint = buildO8Fingerprint(FIN_OP_KINDS.FINANCE_MOVE_DELETE, { financeMoveId: moveId })
  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: FIN_OP_KINDS.FINANCE_MOVE_DELETE,
      fingerprint,
      mutate: () => {
        const before = (db.financeMoves || []).find(r => String(r.id) === String(moveId))
        const shiftId = before?.shiftId
        const row = deleteFinanceMove(db, moveId, { clientRef })
        const shift = shiftId ? (db.posShifts || []).find(s => s.id === shiftId) : null
        return {
          result: row,
          touched: touchedFromFinance(db, {
            financeMoveId: moveId,
            shift,
            shiftId: shift?.id,
            clientRef,
            includeRecentLedger: true,
          }),
          deletes: [{ collection: 'financeMoves', id: String(moveId) }],
          meta: metaCashVault(db),
        }
      },
    })
    await afterCommitHold()
    if (!txOut.replay) broadcastPosUpdate({ kind: 'finance-move', id: moveId, deleted: true })
    res.json({
      ...txOut.result,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
    })
  } catch (e) {
    txError(res, e, 'Не удалось удалить')
  }
}

/** Cash advance — durable O8 (PG commit before HTTP 2xx). */
export async function handleO8CashAdvance(req, res, ctx) {
  const {
    db,
    findCardByNum,
    createCashAdvance,
    syncClientFromCardRow,
    normalizeCardRow,
    normalizePhoneDigits,
    auditFromReq,
    broadcastPosUpdate,
    broadcastLoyalty,
  } = ctx

  const num = decodeURIComponent(req.params.num).toUpperCase()
  const refGate = requireClientRef(req.body?.clientRef, { fallback: String(req.body?.localId || req.body?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef
  const fingerprint = buildDebtOpFingerprint('cash_advance', {
    amount: round2(req.body?.amount),
    method: 'cash',
    clientId: req.body?.clientId,
    cardNum: num,
    shiftId: req.body?.shiftId,
  })

  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: CRM_OP_KINDS.CASH_ADVANCE,
      fingerprint,
      advisoryLocks: crmResourceLocksForCard(db, num),
      mutate: () => {
        const card = findCardByNum(num)
        if (!card) {
          const err = new Error('Карта не найдена')
          err.status = 404
          err.code = 'CARD_NOT_FOUND'
          throw err
        }
        const linkedClient = (db.clients || []).find(c =>
          c.card === num
          || (card.phone && normalizePhoneDigits(c.phone) === normalizePhoneDigits(card.phone)),
        ) || null
        const outcome = createCashAdvance(db, {
          card,
          linkedClient,
          clientRef,
          amount: req.body?.amount,
          shiftId: req.body?.shiftId,
          posId: req.body?.posId,
          cashierId: req.body?.cashierId,
          cashierName: req.body?.cashierName,
          note: req.body?.note,
          createdAtIso: req.body?.createdAtIso,
          expectedDebtPayVersion: req.body?.expectedDebtPayVersion ?? req.body?.debtPayVersion,
          cardNum: num,
        })
        if (!outcome.ok) {
          const err = new Error(outcome.detail || 'Не удалось выдать наличные')
          err.status = outcome.status || 400
          err.code = outcome.code
          throw err
        }
        Object.assign(card, normalizeCardRow(card))
        syncClientFromCardRow(card)
        const { result } = outcome
        const shift = result.till?.shiftId
          ? (db.posShifts || []).find(s => s.id === result.till.shiftId)
          : null
        return {
          result: { card, ...result, clientRef },
          touched: [
            ...touchedFromCrm(db, { card, client: linkedClient, cardNum: num, clientRef, includeRecentLedger: true }),
            ...touchedFromFinance(db, { shift, shiftId: shift?.id, clientRef, includeRecentLedger: true }),
          ],
          meta: metaCashVault(db),
        }
      },
    })
    await afterCommitHold()
    const payload = { ...txOut.result, replayed: !!txOut.replay, duplicate: !!txOut.replay, durable: isPostgresEnabled() }
    if (!txOut.replay) {
      auditFromReq(db, req, {
        app: 'trade',
        action: 'update',
        entity: 'debt',
        entityId: num,
        entityName: payload.card?.client || num,
        summary: `Выдача наличных ${num}: ${payload.prevDebt} → ${payload.nextDebt} · из кассы −${payload.amount}`,
        before: { debt: payload.prevDebt },
        after: { debt: payload.nextDebt, amount: payload.amount, till: payload.till },
      })
      broadcastPosUpdate({ kind: 'cash-advance', cardNum: num, amount: payload.amount })
      const ph = payload.client?.phone
      if (ph) broadcastLoyalty({ phone: ph, bonus: payload.client.bonus, card: num })
    }
    res.json(payload)
  } catch (e) {
    txError(res, e, 'Не удалось выдать наличные')
  }
}

/** Debt repayment — durable O8 (PG commit before HTTP 2xx). */
export async function handleO8DebtRepay(req, res, ctx) {
  const {
    db,
    findCardByNum,
    handleClientDebtDelta,
    applyDebtRepayToShift,
    syncClientFromCardRow,
    normalizeCardRow,
    normalizePhoneDigits,
    auditFromReq,
    broadcastPosUpdate,
    broadcastLoyalty,
  } = ctx

  const num = decodeURIComponent(req.params.num).toUpperCase()
  const refGate = requireClientRef(req.body?.clientRef, { fallback: String(req.body?.localId || req.body?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef
  const amount = round2(req.body?.amount)
  const method = String(req.body?.method || 'cash').toLowerCase() === 'card' ? 'card' : 'cash'
  const orderId = String(req.body?.orderId || '').trim() || undefined
  const fingerprint = buildDebtOpFingerprint('debt_repay', {
    amount,
    method,
    clientId: req.body?.clientId,
    cardNum: num,
    orderId,
    shiftId: req.body?.shiftId,
  })

  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: CRM_OP_KINDS.DEBT_REPAY,
      fingerprint,
      advisoryLocks: crmResourceLocksForCard(db, num),
      mutate: () => {
        const card = findCardByNum(num)
        if (!card) {
          const err = new Error('Карта не найдена')
          err.status = 404
          throw err
        }
        const appliedLocal = !!(req.body?.appliedLocal || req.body?.skipBalances)
        if (!(amount > 0)) {
          const err = new Error('Укажите сумму погашения')
          err.status = 400
          throw err
        }
        if (method === 'cash' && !String(req.body?.shiftId || '').trim()) {
          const err = new Error('Откройте смену, чтобы принять наличные в кассу')
          err.status = 400
          throw err
        }
        const linkedClient = (db.clients || []).find(c =>
          c.card === num
          || (card.phone && normalizePhoneDigits(c.phone) === normalizePhoneDigits(card.phone)),
        ) || null
        const prevDebt = round2(Math.max(Number(card.debt) || 0, Number(linkedClient?.debt) || 0))
        const expectedPayVer = req.body?.expectedDebtPayVersion ?? req.body?.debtPayVersion
        if (expectedPayVer !== undefined && expectedPayVer !== null && expectedPayVer !== '') {
          const exp = Number(expectedPayVer)
          if (Number.isFinite(exp)) {
            const current = Number(card.debtPayVersion) || 0
            if (exp !== current) {
              const err = new Error(
                `Долг клиента уже погашали на другой кассе (версия ${current}, ожидали ${exp}). Погашение не приняли — обновите данные.`,
              )
              err.status = 400
              throw err
            }
          }
        }
        if (!appliedLocal && amount > prevDebt + 0.001) {
          const err = new Error(`Долг клиента ${prevDebt.toFixed(2)} ЅМ`)
          err.status = 400
          throw err
        }
        const nextDebt = round2(Math.max(0, prevDebt - amount))
        const repaidTowardDebt = round2(Math.max(0, prevDebt - nextDebt))

        if (orderId && linkedClient) {
          const target = resolveDebtRepaymentTarget(linkedClient, orderId, amount)
          if (target && round2(Number(target.remaining) || 0) <= 0.001) {
            const err = new Error(`Чек долга уже погашен (${orderId})`)
            err.status = 400
            err.code = 'DEBT_RECEIPT_ALREADY_PAID'
            throw err
          }
        }

        if (appliedLocal && repaidTowardDebt < 0.001) {
          return {
            result: {
              card,
              client: linkedClient,
              amount: 0,
              method,
              prevDebt,
              nextDebt: prevDebt,
              bonusEarned: 0,
              till: null,
              noop: true,
              clientRef,
            },
            touched: touchedFromCrm(db, { card, client: linkedClient, cardNum: num, clientRef }),
          }
        }

        const repayOrderId = orderId
        if (linkedClient) {
          if (!appliedLocal) {
            handleClientDebtDelta(db, linkedClient, card, prevDebt, nextDebt, {
              enforceLimit: false,
              source: 'pos',
              orderId: repayOrderId,
              desc: method === 'cash' ? 'Погашение долга наличными' : 'Погашение долга картой',
            })
          } else if (repaidTowardDebt > 0.001) {
            applyDebtRepayment(linkedClient, card, repaidTowardDebt, {
              orderId: repayOrderId,
              desc: method === 'cash' ? 'Погашение долга наличными' : 'Погашение долга картой',
            })
          }
          linkedClient.debt = nextDebt
          card.debt = nextDebt
          syncDebtLedgerToCard(linkedClient, card)
        } else {
          card.debt = nextDebt
        }
        card.debtPayVersion = (Number(card.debtPayVersion) || 0) + 1
        const stamp = new Date().toISOString()
        card.updatedAtIso = stamp
        card.serverAtIso = stamp
        if (linkedClient) {
          linkedClient.updatedAtIso = stamp
          linkedClient.serverAtIso = stamp
        }
        Object.assign(card, normalizeCardRow(card))
        syncClientFromCardRow(card)

        const till = applyDebtRepayToShift(db, {
          amount: repaidTowardDebt,
          method,
          shiftId: req.body?.shiftId,
          posId: req.body?.posId,
          cashierId: req.body?.cashierId,
          cashierName: req.body?.cashierName,
          cardNum: num,
          clientName: card.client || linkedClient?.name || '',
          note: String(req.body?.note || '').trim(),
          clientRef,
          orderId: repayOrderId,
          clientId: linkedClient?.id || req.body?.clientId,
        })
        const shift = till?.shiftId ? (db.posShifts || []).find(s => s.id === till.shiftId) : null
        const result = {
          card,
          client: linkedClient,
          amount,
          method,
          prevDebt,
          nextDebt,
          bonusEarned: 0,
          till,
          clientRef,
        }
        return {
          result,
          touched: [
            ...touchedFromCrm(db, { card, client: linkedClient, cardNum: num, clientRef, includeRecentLedger: true }),
            ...touchedFromFinance(db, { shift, shiftId: shift?.id, clientRef, includeRecentLedger: true }),
          ],
          meta: metaCashVault(db),
        }
      },
    })
    await afterCommitHold()
    const payload = { ...txOut.result, replayed: !!txOut.replay, duplicate: !!txOut.replay, durable: isPostgresEnabled() }
    if (!txOut.replay && !payload.noop) {
      auditFromReq(db, req, {
        app: 'trade',
        action: 'update',
        entity: 'debt',
        entityId: num,
        entityName: payload.card?.client || num,
        summary: `Погашение долга ${num}: ${payload.prevDebt} → ${payload.nextDebt}`
          + (method === 'cash' ? ` · нал +${amount} в кассу` : ' · карта'),
        before: { debt: payload.prevDebt },
        after: { debt: payload.nextDebt, method, amount, till: payload.till },
      })
      broadcastPosUpdate({ kind: 'debt-repay', cardNum: num, amount, method })
      const ph = payload.client?.phone
      if (ph) broadcastLoyalty({ phone: ph, bonus: payload.client.bonus, card: num })
    }
    res.json(payload)
  } catch (e) {
    txError(res, e, 'Не удалось погасить долг')
  }
}

/** Audited client debt correction (O4) — no silent PATCH debt. */
export async function handleO8ClientDebtAdjustment(req, res, ctx) {
  const {
    db,
    findCardByNum,
    handleClientDebtDelta,
    deliverDebtNotifications,
    auditFromReq,
    broadcastPosUpdate,
  } = ctx

  const clientId = req.params.id
  const client = (db.clients || []).find(x => String(x.id) === String(clientId))
  if (!client) return res.status(404).json({ detail: 'Клиент не найден' })

  const refGate = requireClientRef(req.body?.clientRef, { fallback: String(req.body?.localId || req.body?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef
  const targetDebt = round2(req.body?.targetDebt)
  if (!(targetDebt >= 0)) {
    return res.status(400).json({ detail: 'Укажите targetDebt ≥ 0' })
  }
  const reason = String(req.body?.reason || 'Корректировка долга').trim()
  const fingerprint = buildO8Fingerprint(CRM_OP_KINDS.CLIENT_DEBT_ADJUSTMENT, {
    clientId: String(clientId),
    targetDebt,
  })

  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: CRM_OP_KINDS.CLIENT_DEBT_ADJUSTMENT,
      fingerprint,
      advisoryLocks: crmResourceLocksForClient(db, clientId, client.phone),
      mutate: () => {
        const prevDebt = round2(client.debt)
        const linkedCard = client.card ? findCardByNum(client.card) : null
        if (Math.abs(prevDebt - targetDebt) > 0.001) {
          const { notifications } = handleClientDebtDelta(db, client, linkedCard, prevDebt, targetDebt, {
            source: 'admin',
            desc: reason,
            enforceLimit: false,
          })
          client.debt = targetDebt
          if (targetDebt > prevDebt) client.debtEnabled = true
          if (linkedCard) {
            linkedCard.debt = targetDebt
            if (targetDebt > prevDebt) linkedCard.debtEnabled = true
            linkedCard.debtPayVersion = (Number(linkedCard.debtPayVersion) || 0) + 1
            linkedCard.updatedAtIso = new Date().toISOString()
          }
          deliverDebtNotifications(notifications)
        }
        const result = { client, prevDebt, nextDebt: targetDebt, reason, clientRef }
        return {
          result,
          touched: touchedFromCrm(db, {
            client,
            card: linkedCard,
            clientRef,
          }),
        }
      },
    })
    await afterCommitHold()
    if (!txOut.replay) {
      auditFromReq(db, req, {
        action: 'update',
        entity: 'debt',
        entityId: clientId,
        entityName: client.name || client.phone,
        summary: `Корректировка долга · ${reason}`,
        before: { debt: txOut.result?.prevDebt },
        after: { debt: txOut.result?.nextDebt },
      })
      broadcastPosUpdate({ kind: 'crm', id: clientId })
    }
    res.json({
      ...txOut.result,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
    })
  } catch (e) {
    txError(res, e, 'Не удалось скорректировать долг')
  }
}

/** Audited card bonus correction (O4) — no silent PATCH bonus. */
export async function handleO8CardBonusAdjustment(req, res, ctx) {
  const {
    db,
    findCardByNum,
    alignPosCashBonusToTarget,
    loyaltyHooks,
    syncClientFromCardRow,
    auditFromReq,
    broadcastPosUpdate,
    broadcastLoyalty,
  } = ctx

  const num = decodeURIComponent(req.params.num).toUpperCase()
  const card = findCardByNum(num)
  if (!card) return res.status(404).json({ detail: 'Карта не найдена' })

  const refGate = requireClientRef(req.body?.clientRef, { fallback: String(req.body?.localId || req.body?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef
  const targetBonus = round2(req.body?.targetBonus)
  if (!(targetBonus >= 0)) {
    return res.status(400).json({ detail: 'Укажите targetBonus ≥ 0' })
  }
  const reason = String(req.body?.reason || 'Корректировка бонусов').trim()
  const fingerprint = buildO8Fingerprint(CRM_OP_KINDS.CARD_BONUS_ADJUSTMENT, {
    cardNum: num,
    targetBonus,
  })
  const hooks = typeof loyaltyHooks === 'function' ? loyaltyHooks() : loyaltyHooks

  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: CRM_OP_KINDS.CARD_BONUS_ADJUSTMENT,
      fingerprint,
      advisoryLocks: crmResourceLocksForCard(db, num),
      mutate: () => {
        const prevBonus = round2(card.bonus)
        card.bonus = targetBonus
        card.bonusPayVersion = (Number(card.bonusPayVersion) || 0) + 1
        card.updatedAtIso = new Date().toISOString()
        if (card.phone) {
          alignPosCashBonusToTarget(db, card.phone, targetBonus, hooks)
        }
        syncClientFromCardRow(card)
        const linkedClient = (db.clients || []).find(c =>
          String(c.card || '').toUpperCase() === num
          || (card.clientId && String(c.id) === String(card.clientId)),
        ) || null
        const result = { card, prevBonus, nextBonus: targetBonus, reason, clientRef }
        return {
          result,
          touched: touchedFromCrm(db, { card, client: linkedClient, cardNum: num, clientRef }),
        }
      },
    })
    await afterCommitHold()
    if (!txOut.replay) {
      auditFromReq(db, req, {
        action: 'update',
        entity: 'card',
        entityId: num,
        entityName: card.client || num,
        summary: `Корректировка бонусов · ${reason}`,
        before: { bonus: txOut.result?.prevBonus },
        after: { bonus: txOut.result?.nextBonus },
      })
      broadcastPosUpdate({ kind: 'card', num })
      if (card.phone) {
        broadcastLoyalty({ phone: card.phone, bonus: card.bonus, card: num })
      }
    }
    res.json({
      ...txOut.result,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
    })
  } catch (e) {
    txError(res, e, 'Не удалось скорректировать бонусы')
  }
}

export async function handleO8VaultCardToCash(req, res, ctx) {
  const { db, convertVaultCardToCash, broadcastPosUpdate } = ctx
  const refGate = requireClientRef(req.body?.clientRef, { fallback: String(req.body?.localId || req.body?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef
  const amount = round2(req.body?.amount)
  const fingerprint = buildO8Fingerprint(FIN_OP_KINDS.VAULT_CONVERT, {
    dir: 'card_to_cash',
    amount,
    expectedVaultVersion: req.body?.expectedVaultVersion ?? null,
  })
  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: FIN_OP_KINDS.VAULT_CONVERT,
      fingerprint,
      mutate: () => {
        const row = convertVaultCardToCash(db, { ...(req.body || {}), clientRef })
        const shiftIds = new Set((row.fromShifts || []).map(s => s.shiftId).filter(Boolean))
        const shifts = (db.posShifts || []).filter(s => shiftIds.has(s.id))
        const touched = touchedFromFinance(db, { clientRef, includeRecentLedger: true })
        for (const sh of shifts) touched.push({ collection: 'posShifts', row: sh })
        return { result: row, touched, meta: metaCashVault(db) }
      },
    })
    await afterCommitHold()
    if (!txOut.replay) broadcastPosUpdate({ kind: 'vault-convert', id: txOut.result?.id })
    res.json({
      ...txOut.result,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
    })
  } catch (e) {
    txError(res, e, 'Не удалось перевести')
  }
}

export async function handleO8VaultCashToCard(req, res, ctx) {
  const { db, convertVaultCashToCard, broadcastPosUpdate } = ctx
  const refGate = requireClientRef(req.body?.clientRef, { fallback: String(req.body?.localId || req.body?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef
  const amount = round2(req.body?.amount)
  const fingerprint = buildO8Fingerprint(FIN_OP_KINDS.VAULT_CONVERT, {
    dir: 'cash_to_card',
    amount,
    expectedVaultVersion: req.body?.expectedVaultVersion ?? null,
  })
  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: FIN_OP_KINDS.VAULT_CONVERT,
      fingerprint,
      mutate: () => {
        const row = convertVaultCashToCard(db, { ...(req.body || {}), clientRef })
        const shiftIds = new Set((row.fromShifts || []).map(s => s.shiftId).filter(Boolean))
        const shifts = (db.posShifts || []).filter(s => shiftIds.has(s.id))
        const touched = touchedFromFinance(db, { clientRef, includeRecentLedger: true })
        for (const sh of shifts) touched.push({ collection: 'posShifts', row: sh })
        return { result: row, touched, meta: metaCashVault(db) }
      },
    })
    await afterCommitHold()
    if (!txOut.replay) broadcastPosUpdate({ kind: 'vault-convert', id: txOut.result?.id })
    res.json({
      ...txOut.result,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
    })
  } catch (e) {
    txError(res, e, 'Не удалось перевести')
  }
}

export async function handleO8PosSaleCreate(req, res, ctx) {
  const {
    db,
    createPosSale,
    completePosSaleOnlineLoyalty,
    loyaltyHooks,
    createClientOrderFromPosSale,
    deliverDebtNotifications,
    findClientByPhone,
    auditFromReq,
    broadcastPosUpdate,
    broadcastProduct,
    broadcastLoyalty,
    broadcast,
  } = ctx

  const body = { ...(req.body || {}) }
  const refGate = requireClientRef(body.clientRef)
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef
  body.clientRef = clientRef

  const skipBalances = !!(body.appliedLocal || body.skipBalances)
  const debtAddedEarly = round2(body.debtAdded)
  const bonusSpendReq = Math.max(0, Math.floor(Number(body.bonusSpent) || 0))
  if (bonusSpendReq > 0 && !skipBalances) {
    const phone = String(body.clientPhone || '').trim()
    if (!phone) return res.status(400).json({ detail: 'Для списания бонусов нужен клиент' })
    const client = findClientByPhone(db, phone)
    if (!client) return res.status(400).json({ detail: 'Клиент не найден' })
    const activeNum = String(client.card || '').trim().toUpperCase()
    if (!activeNum) {
      return res.status(409).json({
        detail: 'Нет активной карты для списания бонусов',
        code: 'NO_ACTIVE_LOYALTY_CARD',
      })
    }
    const reqNum = String(body.cardNum || '').trim().toUpperCase()
    if (reqNum && reqNum !== activeNum) {
      return res.status(409).json({
        detail: 'Карта не является активной для этого клиента',
        code: 'CARD_NOT_ACTIVE_FOR_CLIENT',
      })
    }
    const card = ctx.findCardByNum(activeNum)
    if (!card || card.status !== 'active') {
      return res.status(409).json({
        detail: 'Нет активной карты для списания бонусов',
        code: 'NO_ACTIVE_LOYALTY_CARD',
      })
    }
    const bal = Math.max(Number(client.bonus) || 0, Number(card.bonus) || 0)
    if (bal < bonusSpendReq) {
      return res.status(400).json({ detail: `Недостаточно бонусов (доступно ${bal})` })
    }
  }

  const saleFp = buildDebtOpFingerprint(SALE_OP_KIND, {
    amount: body.total,
    debtAdded: debtAddedEarly,
    clientId: body.clientId,
    cardNum: body.cardNum,
    method: body.paymentMethod,
    shiftId: body.shiftId,
  })

  const rawItems = Array.isArray(body.items) ? body.items : []
  const phoneKey = String(body.clientPhone || '').replace(/\D/g, '').slice(-9)
  const crmLocks = (debtAddedEarly > 0 || bonusSpendReq > 0)
    ? [
      ...crmResourceLocksForClient(db, body.clientId, body.clientPhone),
      ...(body.cardNum ? crmResourceLocksForCard(db, body.cardNum) : []),
    ]
    : []
  const advisoryLocks = sortAdvisoryLocks([
    ...stockProductAdvisoryLocks(rawItems.map(it => it.productId)),
    ...crmLocks,
    ...(phoneKey ? [{ ns: 'loyalty_client', key: phoneKey }] : []),
  ])
  const hooks = typeof loyaltyHooks === 'function' ? loyaltyHooks() : loyaltyHooks

  const finishLoyalty = async (sale, { broadcastNewOrder = false } = {}) => {
    const lr = await completePosSaleOnlineLoyalty(db, sale, body, hooks, {
      createOrder: createClientOrderFromPosSale,
    })
    if (!lr.ok) return lr
    if (lr.broadcastLoyalty && lr.order?.client?.phone) {
      const client = findClientByPhone(db, lr.order.client.phone)
      if (client) {
        broadcastLoyalty({
          phone: client.phone,
          bonus: client.bonus,
          card: client.card || '',
        })
      }
    }
    if (broadcastNewOrder && lr.broadcastOrder && lr.order) {
      broadcast('new_order', lr.order)
    }
    return lr
  }

  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: SALE_OP_KIND,
      fingerprint: saleFp,
      advisoryLocks,
      mutate: async () => {
        const row = createPosSale(db, body)
        const replayRow = !!row._idempotentReplay
        if (replayRow) delete row._idempotentReplay
        if (!replayRow && row.clientPhone && !skipBalances) {
          const lr = await finishLoyalty(row, { broadcastNewOrder: false })
          if (!lr.ok) {
            const err = new Error(lr.error || 'Не удалось списать бонусы')
            throw err
          }
        }
        if (!replayRow) {
          try {
            recordEntityUpsert(db, 'sale', row.id, row, { sourceClientRef: clientRef })
          } catch { /* ignore */ }
        }
        const shift = row.shiftId ? (db.posShifts || []).find(s => s.id === row.shiftId) : null
        const touched = [
          ...touchedFromSale(db, row),
          ...touchedFromFinance(db, {
            shift,
            shiftId: shift?.id,
            clientRef,
            includeRecentLedger: true,
          }),
          ...touchedFromCrm(db, {
            clientRef,
            shift,
            shiftId: shift?.id,
            cardNum: row.cardNum,
            includeRecentLedger: true,
          }),
        ]
        return { result: row, touched, meta: metaCashVault(db) }
      },
    })

    await afterCommitHold()
    let row = { ...txOut.result }
    if (txOut.replay && row.clientPhone) {
      const lr = await finishLoyalty(row, { broadcastNewOrder: true })
      if (!lr.ok) {
        return res.status(400).json({ detail: lr.error || 'Не удалось дозавершить бонусы' })
      }
    }
    if (!txOut.replay) {
      deliverDebtNotifications(row._debtNotifications || [])
    }
    delete row._debtNotifications

    if (!txOut.replay) {
      broadcastPosUpdate({ kind: 'sale', id: row.id })
      broadcastProduct({ reason: 'sale' })
      const discAmt = round2(Number(row.discountAmount) || 0)
      if (discAmt > 0.001) {
        auditFromReq(db, req, {
          app: 'trade',
          action: 'discount',
          entity: 'sale',
          entityId: row.id,
          entityName: row.saleNumber || row.id,
          summary: `Скидка на чеке ${row.saleNumber || row.id} · −${discAmt} ЅМ · итог ${row.total} ЅМ`,
        })
      }
    }

    res.json({
      ...row,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
      clientRef,
    })
  } catch (e) {
    txError(res, e, 'Не удалось провести продажу')
  }
}

export async function handleO8StockAdjustment(req, res, ctx) {
  const {
    db,
    createStockAdjustment,
    auditFromReq,
    broadcastProduct,
  } = ctx

  const refGate = requireClientRef(req.body?.clientRef, { fallback: String(req.body?.localId || req.body?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef
  const body = { ...(req.body || {}), clientRef }
  const targetQty = body.targetQty != null ? round2(body.targetQty) : null
  const deltaQty = body.deltaQty != null ? round2(body.deltaQty) : null
  const fingerprint = buildO8Fingerprint(WH_OP_KINDS.STOCK_ADJUSTMENT, {
    productId: body.productId,
    targetQty,
    deltaQty,
    reason: String(body.reason || '').trim(),
  })

  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: WH_OP_KINDS.STOCK_ADJUSTMENT,
      fingerprint,
      advisoryLocks: stockProductAdvisoryLocks([body.productId]),
      mutate: () => {
        const row = createStockAdjustment(db, body)
        return {
          result: row,
          touched: touchedFromWarehouse(db, {
            adjustment: row,
            productIds: [row.productId],
            clientRef,
          }),
        }
      },
    })
    await afterCommitHold()
    const row = txOut.result
    if (!txOut.replay) {
      auditFromReq(db, req, {
        action: 'adjust',
        entity: 'stock',
        entityId: row.id,
        entityName: row.productName,
        summary: `Корректировка остатка · ${row.productName} · ${row.stockBefore} → ${row.stockAfter}`,
      })
      broadcastProduct({ id: row.productId, reason: 'stock-adjustment' })
    }
    res.json({
      ...row,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
    })
  } catch (e) {
    txError(res, e, 'Не удалось скорректировать остаток')
  }
}

export async function handleO8SaleReturn(req, res, ctx) {
  const {
    db,
    returnPosSale,
    reconcileClientBonuses,
    loyaltyHooks,
    findClientByPhone,
    broadcastLoyalty,
    broadcastPosUpdate,
    broadcastProduct,
    auditFromReq,
  } = ctx
  const saleId = req.params.id
  const refGate = requireClientRef(req.body?.clientRef, { fallback: String(req.body?.localId || req.body?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef
  const items = Array.isArray(req.body?.items) ? req.body.items : []
  const salePre = (db.posSales || []).find(s => String(s.id) === String(saleId))
  const fingerprint = buildO8Fingerprint(WH_OP_KINDS.STOCK_RETURN_RESTORE, {
    saleId,
    items: items.map(it => ({ productId: it.productId, qty: it.qty, index: it.index })),
    total: req.body?.total,
  })
  const returnCrmLocks = salePre?.cardNum
    ? crmResourceLocksForCard(db, salePre.cardNum)
    : crmResourceLocksForClient(db, null, salePre?.clientPhone)
  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: WH_OP_KINDS.STOCK_RETURN_RESTORE,
      fingerprint,
      advisoryLocks: sortAdvisoryLocks([
        ...stockProductAdvisoryLocks(items.map(it => it.productId)),
        ...returnCrmLocks,
      ]),
      mutate: () => {
        const row = returnPosSale(db, saleId, { ...(req.body || {}), clientRef })
        const last = Array.isArray(row.returns) ? row.returns[row.returns.length - 1] : null
        if (last && !last.clientRef) last.clientRef = clientRef
        recordEntityUpsert(db, 'sale', row.id, row, { sourceClientRef: clientRef })
        const shift = row.shiftId ? (db.posShifts.find(s => s.id === row.shiftId)) : null
        const touched = [
          ...touchedFromSale(db, row),
          ...touchedFromFinance(db, {
            shift,
            shiftId: shift?.id,
            clientRef,
            includeRecentLedger: true,
          }),
        ]
        return { result: row, touched, meta: metaCashVault(db) }
      },
    })
    await afterCommitHold()
    const row = { ...txOut.result }
    const bonusRefund = Number(row._bonusRefunded) || 0
    const bonusPhone = String(row._bonusRefundPhone || row.clientPhone || '').trim()
    delete row._bonusRefunded
    delete row._bonusRefundPhone
    const hooks = typeof loyaltyHooks === 'function' ? loyaltyHooks() : loyaltyHooks
    if (!txOut.replay && bonusRefund > 0 && bonusPhone) {
      reconcileClientBonuses(db, bonusPhone, hooks)
      const client = findClientByPhone(db, bonusPhone)
      if (client) {
        broadcastLoyalty({ phone: client.phone, bonus: client.bonus, card: client.card || '' })
      }
    }
    if (!txOut.replay) {
      auditFromReq(db, req, {
        app: 'trade',
        action: 'return',
        entity: 'sale',
        entityId: row.id,
        entityName: row.saleNumber || row.id,
        summary: `Возврат по чеку ${row.saleNumber || row.id}`
          + (bonusRefund > 0 ? ` · бонусы +${bonusRefund}` : ''),
      })
      broadcastPosUpdate({ kind: 'sale-return', id: row.id })
      broadcastProduct({ reason: 'sale-return' })
    }
    res.json({
      ...row,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
    })
  } catch (e) {
    txError(res, e, 'Не удалось оформить возврат')
  }
}

/** Durable financial unlink (O4D). */
export async function handleO8CardUnlink(req, res, ctx) {
  const {
    db,
    findCardByNum,
    normalizeCardRow,
    auditFromReq,
    broadcastPosUpdate,
    notifyCrmChange,
  } = ctx

  const num = decodeURIComponent(req.params.num).toUpperCase()
  const refGate = requireClientRef(req.body?.clientRef, { fallback: String(req.body?.localId || req.body?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef
  const fingerprint = buildO8Fingerprint(CRM_OP_KINDS.CRM_CARD_UNLINK, {
    cardNum: num,
    action: 'unlink',
  })

  const cardProbe = findCardByNum(num)
  const clientId = cardProbe?.clientId
    || (db.clients || []).find(c => String(c.card || '').toUpperCase() === num)?.id

  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: CRM_OP_KINDS.CRM_CARD_UNLINK,
      fingerprint,
      advisoryLocks: crmResourceLocksForLink(db, {
        clientId,
        oldCardNum: num,
        phone: cardProbe?.phone,
      }),
      mutate: () => {
        const out = applyFinancialCardUnlink(db, num, {
          findCardByNum,
          normalizeCardRow,
        }, { allowDebtDestroy: req.body?.allowDebtDestroy === true })
        return {
          result: { ...out, clientRef, cardNum: num },
          touched: touchedFromCrm(db, {
            client: out.client,
            card: out.card,
            cardNum: num,
            clientRef,
          }),
        }
      },
    })
    await afterCommitHold()
    if (!txOut.replay) {
      auditFromReq(db, req, {
        action: 'update',
        entity: 'card',
        entityId: num,
        entityName: txOut.result?.card?.client || num,
        summary: `Отвязана карта ${num} (durable)`,
      })
      if (txOut.result?.client) notifyCrmChange?.(txOut.result.client)
      broadcastPosUpdate?.({ kind: 'crm', cardNum: num })
    }
    res.json({
      ...txOut.result?.card,
      client: txOut.result?.client,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
      clientRef,
    })
  } catch (e) {
    if (e instanceof CardOwnershipConflict) {
      return res.status(e.status || 409).json({ detail: e.message, code: e.code, conflict: e.details })
    }
    txError(res, e, 'Не удалось отвязать карту')
  }
}

/** Durable financial link / relink / replace (O4D). */
export async function handleO8ClientCardLink(req, res, ctx) {
  const {
    db,
    findCardByNum,
    ensureCardRowForClient,
    unlinkNonCanonicalSiblingCards,
    normalizeCardRow,
    assertCardAssignableToClient,
    normalizeClientRow,
    auditFromReq,
    broadcastPosUpdate,
    notifyCrmChange,
  } = ctx

  const clientId = req.params.id
  const client = (db.clients || []).find(x => String(x.id) === String(clientId))
  if (!client) return res.status(404).json({ detail: 'Клиент не найден' })

  const refGate = requireClientRef(req.body?.clientRef, { fallback: String(req.body?.localId || req.body?.id || '').trim() })
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code || CLIENT_REF_REQUIRED })
  }
  const clientRef = refGate.clientRef
  const cardNum = String(req.body?.card || '').trim().toUpperCase()
  if (!cardNum) {
    return res.status(400).json({ detail: 'Укажите card для привязки', code: 'CARD_NUM_REQUIRED' })
  }
  if (req.body?.debt != null || req.body?.bonus != null) {
    return res.status(400).json({
      detail: 'Изменение долга/бонусов только через adjustment-операции',
      code: 'CRM_FINANCIAL_PATCH_FORBIDDEN',
    })
  }

  const fingerprint = buildO8Fingerprint(CRM_OP_KINDS.CRM_CLIENT_CARD_LINK, {
    clientId: String(clientId),
    cardNum,
    action: 'link',
  })
  const prevCardNum = client.card ? String(client.card).toUpperCase() : null

  try {
    const txOut = await runO8Tx(req, {
      db,
      clientRef,
      operationKind: CRM_OP_KINDS.CRM_CLIENT_CARD_LINK,
      fingerprint,
      advisoryLocks: crmResourceLocksForLink(db, {
        clientId,
        oldCardNum: prevCardNum,
        newCardNum: cardNum,
        phone: client.phone,
      }),
      mutate: () => {
        const patch = { ...(req.body || {}) }
        delete patch.clientRef
        delete patch.card
        delete patch.expectedDocVersion
        delete patch.debtLedger
        if (typeof normalizeClientRow === 'function') {
          Object.assign(client, normalizeClientRow({ ...client, ...patch, id: client.id, card: client.card }))
        }
        const out = applyFinancialClientCardLink(db, client, cardNum, {
          findCardByNum,
          ensureCardRowForClient,
          unlinkNonCanonicalSiblingCards,
          normalizeCardRow,
          assertCardAssignableToClient,
        })
        const touched = touchedFromCrm(db, {
          client: out.client,
          card: out.card,
          cardNum,
          clientRef,
        })
        for (const s of db.cards || []) {
          if (String(s.clientId || '') !== String(client.id || '')) continue
          touched.push({ collection: 'cards', row: s })
        }
        return {
          result: { ...out, clientRef },
          touched,
        }
      },
    })
    await afterCommitHold()
    if (!txOut.replay) {
      auditFromReq(db, req, {
        action: 'update',
        entity: 'client',
        entityId: clientId,
        entityName: client.name || client.phone,
        summary: `Привязана карта ${cardNum} к клиенту ${clientId}`,
      })
      notifyCrmChange?.(txOut.result?.client)
      broadcastPosUpdate?.({ kind: 'crm', id: clientId, cardNum })
    }
    res.json({
      ...txOut.result?.client,
      linkedCard: txOut.result?.card,
      replayed: !!txOut.replay,
      duplicate: !!txOut.replay,
      durable: isPostgresEnabled(),
      clientRef,
    })
  } catch (e) {
    if (e instanceof CardOwnershipConflict) {
      return res.status(e.status || 409).json({ detail: e.message, code: e.code, conflict: e.details })
    }
    txError(res, e, 'Не удалось привязать карту')
  }
}

export { IDEMPOTENCY_KEY_REUSED, CLIENT_REF_REQUIRED }
