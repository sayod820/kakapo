'use strict'

/**
 * ONLINE-O6 — durable PG mutations for legacy operational creates.
 */
import { normalizePhoneDigits } from './accountLifecycle.js'
import { buildO8Fingerprint } from './pg/o8Fingerprint.js'
import {
  CRM_OP_KINDS,
  FIN_OP_KINDS,
  touchedFromCrm,
  touchedFromWarehouse,
  touchedFromFinance,
} from './pg/businessMutationTx.js'
import { createPosPoint, bindPosDevice } from './posLogic.js'
import { buildEnsureExistingCardPatch, buildEnsureNewCardRow } from './crmEnsureCard.js'
import { CardOwnershipConflict, assertCardAssignableToClient } from './cardCanonical.js'
import { nextOrderId } from './seed.js'
import { inferType } from './ordersLogic.js'
import { reserveOrderStock } from './orderStock.js'
import { currentLoyaltyPeriod } from './loyaltyBonus.js'

export const O6_OP_KINDS = Object.freeze({
  ORDER_CREATE: 'order_create',
  ORDER_STATUS: 'order_status_update',
  DEVICE_BIND: 'device_bind',
})

function metaSeq(db) {
  return { _seq: JSON.parse(JSON.stringify(db._seq || {})) }
}

export function fingerprintClientCreate(body = {}) {
  return {
    phone: normalizePhoneDigits(body.phone || ''),
    name: String(body.name || '').trim(),
    email: String(body.email || '').trim(),
  }
}

export function fingerprintOrderCreate(body = {}, orderPreview = {}) {
  const client = body.client || {
    phone: body.client_phone,
    name: body.client_name,
  }
  const items = (body.items || [])
    .map(it => `${it.product_id ?? it.id}:${Number(it.qty) || 0}`)
    .sort()
    .join('|')
  return {
    phone: normalizePhoneDigits(client?.phone || ''),
    total: Number(body.total || 0).toFixed(2),
    items,
    type: orderPreview.type || inferType({ type: body.type, items: body.items || [] }),
  }
}

export function fingerprintPosPointCreate(body = {}) {
  return {
    name: String(body.name || '').trim(),
    code: String(body.code || '').trim(),
  }
}

export function fingerprintDeviceBind(body = {}) {
  return {
    deviceId: String(body.deviceId || '').trim(),
    code: String(body.code || '').replace(/\D/g, '').slice(0, 4),
    deviceName: String(body.deviceName || 'Устройство').trim(),
  }
}

export function fingerprintCardEnsure(body = {}) {
  return {
    num: String(body.num || '').toUpperCase(),
    clientId: body.clientId != null ? String(body.clientId) : '',
    phone: normalizePhoneDigits(body.phone || ''),
  }
}

export function fingerprintOrderStatus(orderId, body = {}) {
  return {
    orderId: String(orderId),
    status: String(body.status || '').trim(),
    itemsSig: Array.isArray(body.items)
      ? body.items.map(it => `${it.product_id ?? it.id}:${Number(it.qty) || 0}`).sort().join('|')
      : '',
  }
}

/**
 * @param {object} deps — index-local hooks (normalizeClientRow, ensureCardRowForClient, …)
 */
export function mutateCreateClient(db, body, clientRef, deps) {
  deps.runAccountLifecycleMaintenance?.()
  const phone = body?.phone || ''
  const digits = normalizePhoneDigits(phone)
  if (digits) {
    const existing = (db.clients || []).find(c => normalizePhoneDigits(c.phone) === digits)
    if (existing) {
      if (existing.accountStatus === 'recovery' && !deps.isRecoveryExpired?.(existing)) {
        const err = new Error(`Аккаунт можно восстановить до ${existing.recoveryExpiresAt || deps.recoveryExpiresAtIso?.(existing.deletedAt)}`)
        err.status = 409
        throw err
      }
      if (existing.accountStatus === 'active') {
        const err = new Error('Клиент с этим телефоном уже зарегистрирован')
        err.status = 409
        throw err
      }
    }
    deps.forgetDeletedPhone?.(phone)
  }

  const loyalty = deps.ensureLoyaltySettings(db)
  const nums = (db.clients || []).map(c => parseInt(String(c.id).replace(/\D/g, ''), 10)).filter(n => !Number.isNaN(n))
  const n = (nums.length ? Math.max(...nums) : 0) + 1
  const welcomeBonus = Number(loyalty.welcomeBonus) || 0
  const generation = digits ? deps.nextAccountGeneration(db, phone) : 1
  const row = deps.normalizeClientRow({
    id: `U-${String(n).padStart(2, '0')}`,
    level: 'basic',
    orders: 0,
    spent: 0,
    debt: 0,
    bonus: welcomeBonus,
    debtLimit: 0,
    blocked: false,
    loyaltyPeriod: currentLoyaltyPeriod(),
    accountGeneration: generation,
    accountStatus: 'active',
    createdAt: new Date().toISOString().slice(0, 10),
    ...body,
    bonus: welcomeBonus,
    accountGeneration: generation,
    accountStatus: 'active',
    level: 'basic',
    orders: 0,
    spent: 0,
    vip: false,
  })
  if (!Array.isArray(db.clients)) db.clients = []
  db.clients.push(row)
  const card = deps.ensureCardRowForClient(row)
  deps.clearPersonalNotificationsOnServer?.(row.phone)
  deps.reconcileClientBonuses?.(db, row.phone, deps.loyaltyHooks?.())
  if (clientRef) row.clientRef = clientRef
  const touched = touchedFromCrm(db, { client: row, card: card || undefined })
  return { result: row, touched, meta: metaSeq(db) }
}

export function mutateCreateOrder(db, body, deps) {
  const client = body.client || {
    name: body.client_name,
    phone: body.client_phone,
    addr: body.address,
    lat: body.lat,
    lng: body.lng,
  }
  const otype = inferType({ type: body.type, items: body.items || [] })
  const order = {
    id: nextOrderId(db),
    type: otype,
    status: 'new',
    createdAt: deps.nowTime?.() || new Date().toTimeString().slice(0, 5),
    createdAtIso: new Date().toISOString(),
    total: body.total || 0,
    goodsTotal: body.goodsTotal != null ? Number(body.goodsTotal) : undefined,
    deliveryFee: body.deliveryFee || 0,
    deliveryFeeLocked: body.deliveryFeeLocked === true || Number(body.deliveryFee) > 0,
    comment: body.comment || '',
    payment_method: body.payment_method || body.pay || 'cash',
    pay: body.payment_method || body.pay || 'cash',
    creditAmount: body.creditAmount != null ? Number(body.creditAmount) : undefined,
    vip: body.vip === true,
    priority: body.priority || 'normal',
    client,
    items: body.items || [],
    restId: body.restId,
    restName: body.restName,
    restIds: body.restIds,
    pickupIds: body.pickupIds,
    distanceKm: body.distanceKm,
    durationMin: body.durationMin,
    weightKg: body.weightKg,
    bonusSpent: 0,
    clientRef: body.clientRef,
  }
  if (otype === 'mixed') {
    order.marketStatus = body.marketStatus || 'new'
    order.restParts = body.restParts || Object.fromEntries((body.restIds || []).map(r => [r, 'new']))
  }
  const bonusSpendReq = Math.max(0, Math.floor(Number(body.bonusSpent) || 0))
  reserveOrderStock(db, order)
  if (bonusSpendReq > 0) {
    const spendResult = deps.applyBonusSpendOnOrder(db, order, bonusSpendReq, deps.loyaltyHooks?.())
    if (!spendResult.ok) {
      const err = new Error(spendResult.error || 'Не удалось списать бонусы')
      err.status = 400
      throw err
    }
  }
  const orderClient = deps.findClientByPhone?.(db, client.phone || '')
  deps.stampOrderForClient?.(order, orderClient)
  deps.consumePromoStockOnOrder?.(order)
  if (!Array.isArray(db.orders)) db.orders = []
  db.orders.push(order)
  const productIds = (order.items || []).map(it => Number(it.product_id ?? it.id)).filter(n => n > 0)
  const touched = [
    { collection: 'orders', row: order },
    ...touchedFromWarehouse(db, { productIds }),
    ...touchedFromCrm(db, { client: orderClient || undefined, clientRef: body.clientRef }),
  ]
  return { result: order, touched, meta: metaSeq(db) }
}

export function mutateCreatePosPoint(db, body) {
  const row = createPosPoint(db, body)
  return {
    result: row,
    touched: touchedFromFinance(db, { posPoint: row }),
    meta: metaSeq(db),
  }
}

export function mutateBindDevice(db, body) {
  const result = bindPosDevice(db, body)
  const pointId = result?.point?.id
  const touched = []
  if (pointId) {
    const full = (db.posPoints || []).find(p => p.id === pointId)
    if (full) touched.push({ collection: 'posPoints', row: full })
  }
  return { result, touched, meta: metaSeq(db) }
}

export function mutateEnsureCard(db, body, deps) {
  const num = String(body.num || '').toUpperCase()
  if (!num) {
    const err = new Error('Укажите номер карты')
    err.status = 400
    throw err
  }
  let card = deps.findCardByNum(num)
  const client = body.clientId
    ? (db.clients || []).find(c => c.id === body.clientId)
    : (db.clients || []).find(c => {
      if (!c.card) return false
      const digits = String(c.card).replace(/\D/g, '')
      return c.card.toUpperCase() === num || digits === num.replace(/\D/g, '')
    })
  if (card) {
    const attempted = client || (body.phone
      ? (db.clients || []).find(c => normalizePhoneDigits(c.phone) === normalizePhoneDigits(body.phone))
      : null)
    if (attempted) {
      try {
        assertCardAssignableToClient(db, card, attempted)
      } catch (e) {
        if (e instanceof CardOwnershipConflict) {
          const err = new Error(e.message)
          err.status = 409
          err.code = e.code
          throw err
        }
        throw e
      }
    } else if (body.clientId && card.clientId && String(body.clientId) !== String(card.clientId)) {
      const err = new Error(`Карта ${num} уже принадлежит клиенту ${card.clientId}`)
      err.status = 409
      err.code = 'CARD_OWNED_BY_OTHER_CLIENT'
      throw err
    }
    const { patch, vipChanged, levelChanged } = buildEnsureExistingCardPatch(body, card)
    if (vipChanged || levelChanged) {
      patch.loyaltyPeriod = currentLoyaltyPeriod()
      patch.bonusEligibleFrom = new Date().toISOString()
    }
    Object.assign(card, deps.normalizeCardRow({ ...card, ...patch, num: card.num }))
  } else {
    const phoneClient = body.phone
      ? (db.clients || []).find(c => normalizePhoneDigits(c.phone) === normalizePhoneDigits(body.phone))
      : undefined
    const idClient = body.clientId
      ? (db.clients || []).find(c => String(c.id) === String(body.clientId))
      : undefined
    if (phoneClient && idClient && String(phoneClient.id) !== String(idClient.id)) {
      const err = new Error('clientId не совпадает с телефоном клиента')
      err.status = 409
      err.code = 'ENSURE_CLIENT_ID_PHONE_MISMATCH'
      throw err
    }
    const baseClient = idClient || phoneClient || client
    card = buildEnsureNewCardRow(body, baseClient, deps.normalizeCardRow)
    if (!db.cards) db.cards = []
    db.cards.push(card)
  }
  return {
    result: card,
    touched: touchedFromCrm(db, { card, cardNum: card.num }),
    meta: metaSeq(db),
  }
}

export function buildO6Fingerprint(kind, fields) {
  return buildO8Fingerprint(kind, fields)
}
