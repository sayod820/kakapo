/** @typedef {import('better-sqlite3').Database} Db */

export function marketItems(items = []) {
  return items.filter(it => it.source === 'market' || (!it.restId && it.source !== 'restaurant'))
}

export function restItems(items = [], restId) {
  return items.filter(it => {
    if (it.source === 'restaurant' || it.restId) {
      return restId == null || String(it.restId) === String(restId)
    }
    return false
  })
}

export function inferType(order) {
  if (order.type === 'mixed') return 'mixed'
  const items = order.items || []
  const hasM = marketItems(items).length > 0
  const hasR = restItems(items).length > 0
  if (hasM && hasR) return 'mixed'
  if (hasR) return 'restaurant'
  return order.type || 'market'
}

export function getMarketStatus(order) {
  if (order.marketStatus) return order.marketStatus
  if (!marketItems(order.items || []).length) return 'done'
  if (order.status === 'assembler_done') return 'done'
  if (order.status === 'assembling') return 'assembling'
  return 'new'
}

export function getRestPartStatus(order, restId) {
  const parts = order.restParts || {}
  if (parts[restId]) return parts[restId]
  if (!restItems(order.items || [], restId).length) return 'done'
  if (inferType(order) === 'mixed') return 'new'
  const st = order.status
  if (['ready', 'assembler_done', 'courier_picked', 'delivering', 'delivered'].includes(st)) return 'done'
  if (st === 'cooking') return 'cooking'
  return 'new'
}

export function allPartsDone(order) {
  const items = order.items || []
  if (marketItems(items).length && getMarketStatus(order) !== 'done') return false
  const ids = new Set()
  if (order.restId) ids.add(String(order.restId))
  for (const rid of order.restIds || []) ids.add(String(rid))
  for (const it of restItems(items)) if (it.restId) ids.add(String(it.restId))
  for (const rid of ids) {
    if (getRestPartStatus(order, rid) !== 'done') return false
  }
  return true
}

export function anyPartDone(order) {
  const items = order.items || []
  if (marketItems(items).length && getMarketStatus(order) === 'done') return true
  const ids = new Set()
  if (order.restId) ids.add(String(order.restId))
  for (const rid of order.restIds || []) ids.add(String(rid))
  for (const it of restItems(items)) if (it.restId) ids.add(String(it.restId))
  for (const rid of ids) {
    if (getRestPartStatus(order, rid) === 'done') return true
  }
  return false
}

export function isAssemblerOrder(order) {
  const t = inferType(order)
  if (t === 'mixed') return ['new', 'assembling'].includes(getMarketStatus(order))
  return t === 'market' && ['new', 'assembling'].includes(order.status)
}

export function isCourierReady(order) {
  if (['delivered', 'cancelled', 'courier_picked', 'delivering'].includes(order.status)) return false
  const t = inferType(order)
  if (t === 'mixed') return anyPartDone(order) && ['ready', 'assembler_done'].includes(order.status)
  if (t === 'market') return order.status === 'assembler_done'
  if (t === 'restaurant') return order.status === 'ready'
  return false
}

export function isCourierSync(order) {
  if (['delivered', 'cancelled'].includes(order.status)) return false
  return isCourierReady(order) || ['courier_picked', 'delivering'].includes(order.status)
}

export function syncMixedStatus(order) {
  if (inferType(order) !== 'mixed') return order
  if (['courier_picked', 'delivering', 'delivered', 'cancelled'].includes(order.status)) return order
  if (allPartsDone(order)) order.status = 'assembler_done'
  else if (anyPartDone(order)) order.status = 'ready'
  else if (getMarketStatus(order) === 'assembling') order.status = 'assembling'
  else order.status = 'new'
  return order
}

export function applyStatusPatch(order, body) {
  if (body.marketStatus != null) order.marketStatus = body.marketStatus
  if (body.restParts != null) order.restParts = { ...(order.restParts || {}), ...body.restParts }
  if (body.pickedUpIds != null) order.pickedUpIds = body.pickedUpIds
  if (body.courierRoute != null) order.courierRoute = body.courierRoute
  if (body.courier != null) order.courier = body.courier
  if (body.assembler != null) order.assembler = body.assembler
  if (body.deliveredAt != null) order.deliveredAt = body.deliveredAt
  const t = inferType(order)
  if (t === 'mixed') {
    syncMixedStatus(order)
    if (body.status && !['new', 'assembling', 'assembler_done', 'ready'].includes(body.status)) {
      order.status = body.status
    }
  } else if (body.status) {
    order.status = body.status
  }
  return order
}
