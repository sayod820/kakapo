'use strict'

/**
 * ONLINE-O6B — durable order status transition (single canonical PATCH route).
 */
import { applyStatusPatch } from './ordersLogic.js'
import { reserveOrderStock, releaseOrderStock, syncOrderStockReserve } from './orderStock.js'
import {
  applyCourierCommissionOnAccept,
  stampCourierCommissionOnOrder,
  refundCourierCommission,
} from './courierWallet.js'
import {
  syncOrderBonusOnStatusChange,
  applyClientLoyaltyAfterDelivery,
} from './loyaltyBonus.js'
import { creditDeliveredOrder } from './restaurantStats.js'
import { lockOrderDeliveryFee } from './deliveryFee.js'
import { buildO8Fingerprint } from './pg/o8Fingerprint.js'
import { FIN_OP_KINDS, touchedFromWarehouse, touchedFromCrm } from './pg/businessMutationTx.js'

function metaSeq(db) {
  return { _seq: JSON.parse(JSON.stringify(db._seq || {})) }
}

function itemsSig(items) {
  if (!Array.isArray(items)) return ''
  return items.map(it => `${it.product_id ?? it.id}:${Number(it.qty) || 0}`).sort().join('|')
}

export function fingerprintOrderStatusUpdate(orderId, body = {}) {
  const picked = Array.isArray(body.pickedUpIds) ? [...body.pickedUpIds].map(String).sort().join(',') : ''
  const restParts = body.restParts && typeof body.restParts === 'object'
    ? JSON.stringify(body.restParts, Object.keys(body.restParts).sort())
    : ''
  const courier = body.courier && typeof body.courier === 'object'
    ? String(body.courier.id || body.courier.phone || '')
    : String(body.courier || '')
  const assembler = body.assembler && typeof body.assembler === 'object'
    ? String(body.assembler.id || body.assembler.phone || '')
    : String(body.assembler || '')
  return {
    orderId: String(orderId),
    status: String(body.status || '').trim(),
    marketStatus: body.marketStatus != null ? String(body.marketStatus) : '',
    adminOverride: body.adminOverride === true,
    itemsSig: itemsSig(body.items),
    pickedUpIds: picked,
    restParts,
    courier,
    assembler,
    courierAtClient: body.courierAtClient === true,
  }
}

export function buildOrderStatusFingerprint(orderId, body) {
  return buildO8Fingerprint(FIN_OP_KINDS.ORDER_STATUS_UPDATE, fingerprintOrderStatusUpdate(orderId, body))
}

/**
 * Apply order status patch + stock/bonus/delivery/courier effects inside PG tx.
 * @returns {{ result: object, touched: object[], meta: object, fx: object }}
 */
export function mutateOrderStatusUpdate(db, orderId, body, hooks = {}) {
  const id = String(orderId)
  const idx = (db.orders || []).findIndex(o => String(o.id) === id)
  if (idx < 0) {
    const err = new Error('Заказ не найден')
    err.status = 404
    throw err
  }
  const prev = db.orders[idx]
  const prevSnap = JSON.parse(JSON.stringify(prev))

  const semanticKeys = Object.keys(body || {}).filter(k => k !== 'clientRef')
  const extraFields = semanticKeys.filter(k => k !== 'status' && body[k] != null)
  const repeatStatus = body?.status && body.status === prev.status && extraFields.length === 0
  if (repeatStatus && !body?.adminOverride) {
    return {
      result: prev,
      touched: [{ collection: 'orders', row: prev }],
      meta: metaSeq(db),
      fx: {
        prev: prevSnap,
        stockTouchedIds: [],
        commissionResult: { ok: true },
        bonusChanged: false,
        phone: prev.client?.phone || '',
        transitionApplied: false,
      },
    }
  }

  if (!body?.adminOverride) {
    if (['cancelled', 'delivered'].includes(prev.status) && body?.status && body.status !== prev.status) {
      const err = new Error(
        prev.status === 'cancelled' ? 'Заказ уже отменён' : 'Заказ уже доставлен',
      )
      err.status = 409
      err.code = 'ORDER_TERMINAL_STATE'
      throw err
    }
  }

  const commissionResult = applyCourierCommissionOnAccept(db, prev, body)
  if (!commissionResult.ok) {
    const err = new Error(commissionResult.error || 'Комиссия курьера')
    err.status = 400
    throw err
  }

  let stockTouchedIds = []
  const nextStatus = body?.status || prev.status
  const willCancel = nextStatus === 'cancelled' && prev.status !== 'cancelled'

  try {
    if (!willCancel && Array.isArray(body?.items)) {
      const sync = syncOrderStockReserve(db, prev, body.items)
      if (sync.changed) stockTouchedIds = sync.productIds
    } else if (
      !willCancel
      && !prev.stockFromPos
      && !prev.stockReserved
      && !['cancelled', 'delivered'].includes(prev.status)
    ) {
      const sync = syncOrderStockReserve(db, prev, prev.items)
      if (sync.changed) stockTouchedIds = sync.productIds
    }
  } catch (e) {
    const err = new Error(e?.message || 'Недостаточно остатка на складе')
    err.status = 400
    throw err
  }

  const updated = applyStatusPatch({ ...prev }, body)
  updated.stockReserved = prev.stockReserved
  updated.stockReserveLines = prev.stockReserveLines
  updated.stockFromPos = prev.stockFromPos

  if (updated.status === 'cancelled' && prev.status !== 'cancelled') {
    const released = releaseOrderStock(db, updated, 'Отмена заказа')
    stockTouchedIds = [...new Set([...stockTouchedIds, ...released.map(l => Number(l.productId))])]
  } else if (prev.status === 'cancelled' && updated.status !== 'cancelled') {
    try {
      const reserved = reserveOrderStock(db, updated)
      stockTouchedIds = [...new Set([...stockTouchedIds, ...reserved.map(l => Number(l.productId))])]
    } catch (e) {
      const err = new Error(e?.message || 'Недостаточно остатка на складе')
      err.status = 400
      throw err
    }
  }

  stampCourierCommissionOnOrder(updated, commissionResult)

  const bonusSync = syncOrderBonusOnStatusChange(db, prev, updated, hooks.loyaltyHooks?.())
  const bonusChanged = !!bonusSync.changed

  if (updated.status === 'delivered' && prev.status !== 'delivered') {
    updated.deliveredAtIso = new Date().toISOString()
    if (!updated.deliveredAt) {
      updated.deliveredAt = hooks.nowTime?.() || new Date().toTimeString().slice(0, 5)
    }
    lockOrderDeliveryFee(updated, db.settings?.pricing)
    creditDeliveredOrder(db, updated)
    applyClientLoyaltyAfterDelivery(db, updated, hooks.loyaltyHooks?.())
  }
  if (updated.status === 'cancelled' && prev.status !== 'cancelled') {
    refundCourierCommission(db, updated)
  }

  db.orders[idx] = updated

  const productIds = [...new Set(stockTouchedIds)]
  const phone = updated.client?.phone || prev.client?.phone || ''
  const client = phone && hooks.findClientByPhone ? hooks.findClientByPhone(db, phone) : null
  const touched = [
    { collection: 'orders', row: updated },
    ...touchedFromWarehouse(db, { productIds }),
    ...(bonusChanged && client ? touchedFromCrm(db, { client }) : []),
  ]

  const statusChanged = prev.status !== updated.status
  const deliveryEdge = updated.status === 'delivered' && prev.status !== 'delivered'
  const cancelEdge = updated.status === 'cancelled' && prev.status !== 'cancelled'
  const transitionApplied = statusChanged
    || deliveryEdge
    || cancelEdge
    || bonusChanged
    || productIds.length > 0
    || Number(commissionResult?.commission) > 0

  return {
    result: updated,
    touched,
    meta: metaSeq(db),
    fx: {
      prev: prevSnap,
      stockTouchedIds: productIds,
      commissionResult,
      bonusChanged,
      phone,
      transitionApplied,
    },
  }
}
