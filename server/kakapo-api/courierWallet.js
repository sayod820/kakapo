import { normalizePhoneDigits } from './accountLifecycle.js'
import { calcDeliveryTotal, orderWeightKg } from './deliveryFee.js'

export function getCourierCommissionPercent(pricing, courier) {
  const custom = Number(courier?.commissionPercent ?? courier?.commissionPerOrder)
  if (Number.isFinite(custom) && custom > 0) return Math.min(100, Math.round(custom * 100) / 100)
  const fromTariff = Number(pricing?.courierCommissionPercent ?? pricing?.courierCommissionPerOrder)
  const fallback = Number.isFinite(fromTariff) && fromTariff >= 0 ? fromTariff : 15
  return Math.max(0, Math.min(100, Math.round(fallback * 100) / 100))
}

export function getCourierBalance(courier) {
  return Math.max(0, Math.round((Number(courier?.balance) || 0) * 100) / 100)
}

function roundSm(n) {
  return Math.max(0, Math.round(n * 100) / 100)
}

export function resolveDeliveryFeeForCommission(order, pricing) {
  const saved = Math.max(0, Number(order?.deliveryFee) || 0)
  if (saved > 0) return saved
  const km = Number(order?.distanceKm) || 2.5
  const weight = orderWeightKg(order || {})
  return Math.max(0, calcDeliveryTotal(order?.total, km, weight, pricing || {}))
}

export function getCourierCommissionForOrder(pricing, courier, order) {
  const percent = getCourierCommissionPercent(pricing, courier)
  const deliveryFee = order ? resolveDeliveryFeeForCommission(order, pricing) : Math.max(0, Number(pricing?.base) || 0)
  const commission = percent > 0 && deliveryFee > 0 ? roundSm((deliveryFee * percent) / 100) : 0
  return { commission, percent, deliveryFee }
}

export function findCourierByAssignment(db, courierRef) {
  if (!courierRef?.phone && !courierRef?.name) return null
  const key = normalizePhoneDigits(courierRef.phone || '')
  const list = db.couriers || []
  if (key) {
    const byPhone = list.find(c => normalizePhoneDigits(c.phone) === key)
    if (byPhone) return byPhone
  }
  const name = String(courierRef.name || '').trim().toLowerCase()
  if (!name) return null
  return list.find(c => String(c.name || '').trim().toLowerCase() === name) || null
}

export function canCourierAffordOrder(db, courier, pricing, order) {
  if (!courier) return { ok: false, commission: 0, balance: 0, error: 'Курьер не найден в системе' }
  if (courier.blocked) return { ok: false, commission: 0, balance: 0, error: 'Аккаунт курьера заблокирован' }
  const { commission, percent, deliveryFee } = getCourierCommissionForOrder(pricing, courier, order)
  const balance = getCourierBalance(courier)
  if (commission <= 0) return { ok: true, commission: 0, balance, percent, deliveryFee }
  if (balance + 0.001 < commission) {
    return {
      ok: false,
      commission,
      balance,
      percent,
      deliveryFee,
      error: `Недостаточно средств на счёте. Нужно ${commission} ЅМ (${percent}% от ${deliveryFee} ЅМ доставки), на счёте ${balance} ЅМ.`,
    }
  }
  return { ok: true, commission, balance, percent, deliveryFee }
}

function isNewCourierAssignment(prev, body) {
  if (!body?.courier?.phone && !body?.courier?.name) return false
  const prevKey = normalizePhoneDigits(prev?.courier?.phone || '')
  const nextKey = normalizePhoneDigits(body.courier?.phone || '')
  if (!nextKey) return false
  if (!prevKey) return true
  return prevKey !== nextKey
}

/** Проверка и списание комиссии при принятии заказа курьером */
export function applyCourierCommissionOnAccept(db, prev, body) {
  if (!isNewCourierAssignment(prev, body)) return { ok: true }
  if (Number(prev.courierCommissionPaid) > 0) return { ok: true }

  const courier = findCourierByAssignment(db, body.courier)
  if (!courier) return { ok: false, error: 'Курьер не найден в системе' }

  const pricing = db.settings?.pricing || {}
  const gate = canCourierAffordOrder(db, courier, pricing, prev)
  if (!gate.ok) return { ok: false, error: gate.error }

  if (gate.commission > 0) {
    courier.balance = Math.round((gate.balance - gate.commission) * 100) / 100
  }

  return {
    ok: true,
    commission: gate.commission,
    courierId: courier.id,
    balance: courier.balance,
  }
}

export function stampCourierCommissionOnOrder(order, commissionResult) {
  if (!commissionResult?.commission) return order
  order.courierCommissionPaid = commissionResult.commission
  order.courierCommissionCourierId = commissionResult.courierId
  order.courierCommissionRefunded = false
  return order
}

export function refundCourierCommission(db, order) {
  const paid = Number(order.courierCommissionPaid) || 0
  if (paid <= 0 || order.courierCommissionRefunded) return false
  const courierId = order.courierCommissionCourierId
  let courier = courierId ? (db.couriers || []).find(c => c.id === courierId) : null
  if (!courier && order.courier) courier = findCourierByAssignment(db, order.courier)
  if (!courier) return false
  courier.balance = Math.round((getCourierBalance(courier) + paid) * 100) / 100
  order.courierCommissionRefunded = true
  return true
}

export function depositCourierBalance(db, courierId, amount, note = '') {
  const courier = (db.couriers || []).find(c => c.id === courierId)
  if (!courier) return { ok: false, error: 'Курьер не найден' }
  const add = Math.max(0, Number(amount) || 0)
  if (add <= 0) return { ok: false, error: 'Укажите сумму пополнения' }
  const prev = getCourierBalance(courier)
  courier.balance = Math.round((prev + add) * 100) / 100
  if (!db.courierWalletTx) db.courierWalletTx = []
  db.courierWalletTx.unshift({
    id: `CW-${Date.now()}`,
    courierId,
    type: 'deposit',
    amount: add,
    balanceAfter: courier.balance,
    note: String(note || '').trim() || 'Пополнение счёта',
    at: new Date().toISOString(),
  })
  db.courierWalletTx = db.courierWalletTx.slice(0, 500)
  return { ok: true, balance: courier.balance, added: add }
}
