import { restItems, inferType } from './ordersLogic.js'

export function restRevenueFromOrder(order, restId) {
  const items = restItems(order.items || [], restId)
  if (items.length) {
    return items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 1), 0)
  }
  if (String(order.restId) === String(restId) && inferType(order) === 'restaurant') {
    return Math.max(0, (Number(order.total) || 0) - (Number(order.deliveryFee) || 0))
  }
  return 0
}

export function restIdsInOrder(order) {
  const ids = new Set()
  if (order.restId) ids.add(String(order.restId))
  for (const rid of order.restIds || []) ids.add(String(rid))
  for (const it of order.items || []) if (it.restId) ids.add(String(it.restId))
  return [...ids]
}

/** Начисляет выручку ресторану при доставке заказа */
export function creditDeliveredOrder(db, order) {
  if (order.revenueCredited || order.status !== 'delivered') return
  const t = inferType(order)
  if (t === 'market') return

  let credited = false
  for (const rid of restIdsInOrder(order)) {
    const amount = restRevenueFromOrder(order, rid)
    if (amount <= 0) continue
    const r = db.restaurants.find(x => x.id === rid)
    if (!r) continue
    r.revenueMonth = (r.revenueMonth || 0) + amount
    r.ordersMonth = (r.ordersMonth || 0) + 1
    credited = true
  }
  if (credited) order.revenueCredited = true
}

export function grossFromNet(net, commissionPct) {
  const rate = (100 - Number(commissionPct)) / 100
  if (rate <= 0) return Math.round(Number(net) || 0)
  return Math.round((Number(net) || 0) / rate)
}

export function getPendingBalance(r) {
  const totalGross = Number(r?.revenueMonth) || 0
  const paidGross = Number(r?.paidRevenueMonth) || 0
  const pendingGross = Math.max(0, totalGross - paidGross)
  const commissionPct = Number(r?.commission) || 0
  const pendingCommission = Math.round(pendingGross * commissionPct / 100)
  const paidCommission = Math.round(paidGross * commissionPct / 100)
  const pendingNet = pendingGross - pendingCommission
  const paidNet = paidGross - paidCommission
  return {
    totalGross,
    paidGross,
    pendingGross,
    commissionPct,
    pendingCommission,
    paidCommission,
    pendingNet: Math.max(0, pendingNet),
    paidNet: Math.max(0, paidNet),
  }
}

export function processPayout(db, restId, { method = 'cash', note = '', amount: requestedNet = null } = {}) {
  const r = db.restaurants.find(x => x.id === restId)
  if (!r) return { error: 'Ресторан не найден', status: 404 }

  const bal = getPendingBalance(r)
  if (bal.pendingNet <= 0) return { error: 'Нет суммы к выплате', status: 400 }

  let netPay = requestedNet != null && requestedNet !== '' ? Number(requestedNet) : bal.pendingNet
  if (!Number.isFinite(netPay) || netPay <= 0) return { error: 'Укажите сумму выплаты', status: 400 }
  netPay = Math.round(netPay)
  if (netPay > bal.pendingNet) {
    return { error: `Максимум к выплате: ${bal.pendingNet.toLocaleString('ru-RU')} ЅМ`, status: 400 }
  }

  const isFull = netPay >= bal.pendingNet
  let grossPay
  let commissionPay

  if (isFull) {
    grossPay = bal.pendingGross
    commissionPay = bal.pendingCommission
    netPay = bal.pendingNet
  } else {
    grossPay = grossFromNet(netPay, bal.commissionPct)
    grossPay = Math.min(grossPay, bal.pendingGross)
    commissionPay = Math.round(grossPay * bal.commissionPct / 100)
    netPay = grossPay - commissionPay
  }

  r.paidRevenueMonth = (Number(r.paidRevenueMonth) || 0) + grossPay
  const newBal = getPendingBalance(r)
  const fullySettled = newBal.pendingNet <= 0 || newBal.pendingGross <= 0

  if (fullySettled) {
    r.revenueMonth = 0
    r.paidRevenueMonth = 0
    r.ordersMonth = 0
  }

  if (!Array.isArray(db.payouts)) db.payouts = []
  if (!db._seq.payout) db._seq.payout = db.payouts.length

  const payout = {
    id: ++db._seq.payout,
    restId,
    restName: r.name,
    emoji: r.emoji,
    partial: !fullySettled,
    revenueTotal: bal.totalGross,
    revenuePaid: grossPay,
    revenue: grossPay,
    revenueRemaining: fullySettled ? 0 : newBal.pendingGross,
    orders: r.ordersMonth || 0,
    commission: commissionPay,
    commissionPct: bal.commissionPct,
    amount: netPay,
    netRemaining: fullySettled ? 0 : newBal.pendingNet,
    paidNetBefore: bal.pendingNet,
    paidGrossBefore: bal.paidGross,
    method,
    note: String(note || '').trim(),
    date: new Date().toLocaleString('ru-RU'),
    createdAt: new Date().toISOString(),
  }

  db.payouts.unshift(payout)
  return { payout, restaurant: r, balance: getPendingBalance(r) }
}
