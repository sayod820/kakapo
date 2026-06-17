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
  const items = order.items || []
  const hasM = marketItems(items).length > 0
  const hasR = restItems(items).length > 0
  if (hasM && hasR) return 'mixed'
  if (hasR) return 'restaurant'
  if (hasM) return 'market'
  return order.type || 'market'
}

export function getMarketStatus(order) {
  if (order.marketStatus) return order.marketStatus
  const items = order.items || []
  if (!marketItems(items).length) return 'done'
  const mkt = marketItems(items)
  if (mkt.length > 0 && mkt.every(it => it.done)) return 'done'
  if (order.status === 'assembler_done') return 'done'
  if (inferType(order) === 'market' && ['courier_picked', 'delivering', 'delivered'].includes(order.status)) {
    return 'done'
  }
  if (order.status === 'assembling') return 'assembling'
  return 'new'
}

export function getRestPartStatus(order, restId) {
  const parts = order.restParts || {}
  const key = String(restId)
  if (parts[key]) return parts[key]
  if (!restItems(order.items || [], restId).length) return 'done'
  const mixed = inferType(order) === 'mixed'
  const hasMarket = marketItems(order.items || []).length > 0
  if (!mixed || !hasMarket) {
    const st = order.status
    if (['ready', 'assembler_done', 'courier_picked', 'delivering', 'delivered'].includes(st)) return 'done'
    if (st === 'cooking') return 'cooking'
    return 'new'
  }
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
  if (t === 'restaurant') return order.status === 'ready' || allPartsDone(order)
  return false
}

export function isCourierSync(order) {
  if (['delivered', 'cancelled'].includes(order.status)) return false
  return isCourierReady(order) || ['courier_picked', 'delivering'].includes(order.status)
}

export function isCourierMapOrder(order) {
  if (['delivered', 'cancelled', 'courier_picked', 'delivering'].includes(order.status)) return false
  return ['new', 'assembling', 'cooking', 'ready', 'assembler_done'].includes(order.status)
}

export function isCourierMapSync(order) {
  if (['delivered', 'cancelled'].includes(order.status)) return false
  return isCourierMapOrder(order) || ['courier_picked', 'delivering'].includes(order.status)
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

function collectRestIds(order) {
  const ids = new Set()
  if (order.restId) ids.add(String(order.restId))
  for (const rid of order.restIds || []) ids.add(String(rid))
  for (const it of restItems(order.items || [])) {
    if (it.restId) ids.add(String(it.restId))
  }
  return [...ids]
}

/** Админка: принудительно ставит статус и согласует этапы заказа */
export function applyAdminStatusFields(order, newStatus) {
  const t = inferType(order)
  order.status = newStatus

  if (!['courier_picked', 'delivering', 'delivered'].includes(newStatus)) {
    order.courier = null
    order.courierRoute = null
    order.pickedUpIds = []
  }
  if (newStatus === 'delivered' && !order.deliveredAt) {
    order.deliveredAt = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  }

  if (newStatus === 'new') {
    order.assembler = null
  }

  const items = order.items || []
  const restIds = collectRestIds(order)
  const hasM = marketItems(items).length > 0

  if (t === 'mixed') {
    if (['new', 'cancelled'].includes(newStatus)) {
      if (hasM) order.marketStatus = 'new'
      if (restIds.length) order.restParts = Object.fromEntries(restIds.map(id => [id, 'new']))
      order.items = items.map(it => ({ ...it, done: false }))
    } else if (newStatus === 'assembling') {
      if (hasM) order.marketStatus = 'assembling'
      if (restIds.length) order.restParts = Object.fromEntries(restIds.map(id => [id, 'new']))
      order.items = items.map(it => ({ ...it, done: false }))
    } else if (newStatus === 'cooking') {
      if (hasM) order.marketStatus = 'new'
      if (restIds.length) order.restParts = Object.fromEntries(restIds.map(id => [id, 'cooking']))
      order.items = items.map(it => ({ ...it, done: false }))
    } else if (newStatus === 'ready') {
      if (hasM) order.marketStatus = 'done'
      if (restIds.length) order.restParts = Object.fromEntries(restIds.map(id => [id, 'new']))
      order.items = items.map(it => (marketItems([it]).length ? { ...it, done: true } : { ...it, done: false }))
    } else if (newStatus === 'assembler_done') {
      if (hasM) order.marketStatus = 'done'
      if (restIds.length) order.restParts = Object.fromEntries(restIds.map(id => [id, 'done']))
      order.items = items.map(it => ({ ...it, done: true }))
    } else if (['courier_picked', 'delivering', 'delivered'].includes(newStatus)) {
      if (hasM) order.marketStatus = 'done'
      if (restIds.length) order.restParts = Object.fromEntries(restIds.map(id => [id, 'done']))
      order.items = items.map(it => ({ ...it, done: true }))
    }
  } else if (t === 'market') {
    if (['new', 'cancelled', 'assembling', 'cooking'].includes(newStatus)) {
      order.items = items.map(it => ({ ...it, done: false }))
    } else {
      order.items = items.map(it => ({ ...it, done: true }))
    }
  }

  return order
}

export function applyStatusPatch(order, body) {
  if (body.adminOverride === true && body.status) {
    applyAdminStatusFields(order, body.status)
    if ('courier' in body) order.courier = body.courier ?? null
    if ('assembler' in body) order.assembler = body.assembler ?? null
    if (body.deliveredAt != null) order.deliveredAt = body.deliveredAt
    if (body.deliveryFee != null) order.deliveryFee = body.deliveryFee
    if (body.deliveryFeeLocked != null) order.deliveryFeeLocked = body.deliveryFeeLocked
    return order
  }

  const adminOverride = body.adminOverride === true

  if (body.marketStatus != null) order.marketStatus = body.marketStatus
  if (body.restParts != null) {
    order.restParts = adminOverride
      ? body.restParts
      : { ...(order.restParts || {}), ...body.restParts }
  }
  if (body.pickedUpIds != null) order.pickedUpIds = body.pickedUpIds
  if ('courierRoute' in body) order.courierRoute = body.courierRoute ?? null
  if ('courier' in body) order.courier = body.courier ?? null
  if ('assembler' in body) order.assembler = body.assembler ?? null
  if (body.deliveredAt != null) order.deliveredAt = body.deliveredAt
  if (body.deliveryFee != null) order.deliveryFee = body.deliveryFee
  if (body.deliveryFeeLocked != null) order.deliveryFeeLocked = body.deliveryFeeLocked
  if (body.items != null) order.items = body.items
  if ('courierAtClient' in body) order.courierAtClient = !!body.courierAtClient

  if (body.status) {
    order.status = body.status
    if (body.status === 'delivered') order.courierAtClient = false
  } else if (!adminOverride && inferType(order) === 'mixed') {
    syncMixedStatus(order)
  }
  return order
}
