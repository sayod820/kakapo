'use strict'

/**
 * Доп. inbound, которого нет (или мало) в /sync/changes:
 * vault, stock layers, expiry, loyalty — как раньше softSync*, но в SYNC-канале.
 */

function asArr(v) {
  return Array.isArray(v) ? v : []
}

function bumpProductsFromLayers(dbBridge, layers) {
  const products = asArr(dbBridge.kvGet('catalog_products'))
  if (!products.length) return false
  const byPid = new Map()
  for (const l of asArr(layers)) {
    const pid = Number(l.productId) || 0
    if (!pid) continue
    const qty = Number(l.remainingQty) || 0
    if (!(qty > 0.0001)) continue
    byPid.set(pid, Math.round(((byPid.get(pid) || 0) + qty) * 1000) / 1000)
  }
  let changed = false
  const next = products.map((p) => {
    const pid = Number(p.id) || 0
    if (!byPid.has(pid) && !asArr(layers).some(l => Number(l.productId) === pid)) {
      // товар без открытых партий — не трогаем (локально мог быть другой расчёт)
      return p
    }
    const stock = byPid.get(pid) || 0
    if (Math.abs(stock - (Number(p.stock) || 0)) < 0.0001) return p
    changed = true
    return { ...p, stock }
  })
  // Товары, у которых партии кончились → stock 0
  const touched = new Set([...byPid.keys()])
  for (const l of asArr(layers)) {
    const pid = Number(l.productId) || 0
    if (pid) touched.add(pid)
  }
  // Also zero stock for products that had layers before but not in new list?
  // Safer: only update products that appear in layers OR currently have stock from layers sum
  const next2 = next.map((p) => {
    const pid = Number(p.id) || 0
    if (!touched.has(pid)) return p
    const stock = byPid.get(pid) || 0
    if (Math.abs(stock - (Number(p.stock) || 0)) < 0.0001) return p
    changed = true
    return { ...p, stock }
  })
  if (!changed) return false
  dbBridge.kvSet('catalog_products', next2)
  return true
}

/**
 * @param {{ httpRequest: Function, dbBridge: any, expiryDays?: number, skipLayers?: boolean, skipVault?: boolean }} opts
 * @returns {Promise<string[]>} scopes
 */
async function pullChannelExtras(opts) {
  const { httpRequest, dbBridge, expiryDays = 14, skipLayers = false, skipVault = false } = opts || {}
  const scopes = []
  if (!dbBridge || typeof httpRequest !== 'function') return scopes

  // 1) Cash vault
  if (!skipVault) {
    try {
      const res = await httpRequest({ method: 'GET', path: '/finance/vault', timeoutMs: 10000 })
      const vault = res.json
      if (vault && typeof vault === 'object') {
        const snap = dbBridge.kvGet('pos_snapshot') || {}
        const next = { ...snap, cashVault: vault }
        dbBridge.kvSet('pos_snapshot', next)
        dbBridge.kvSet('data_pos_snapshot', next)
        scopes.push('pos')
      }
    } catch { /* best-effort */ }
  }

  // 2) Expiry
  try {
    const days = Math.max(1, Math.min(90, Number(expiryDays) || 14))
    const res = await httpRequest({
      method: 'GET',
      path: `/stock/expiry?days=${days}`,
      timeoutMs: 12000,
    })
    const list = Array.isArray(res.json) ? res.json : asArr(res.json?.items)
    if (list) {
      const snap = dbBridge.kvGet('pos_snapshot') || {}
      const next = { ...snap, expiry: list }
      dbBridge.kvSet('pos_snapshot', next)
      dbBridge.kvSet('data_pos_snapshot', next)
      scopes.push('pos')
    }
  } catch { /* best-effort */ }

  // 3) Stock layers (+ bump product.stock)
  if (!skipLayers) {
    try {
      const res = await httpRequest({ method: 'GET', path: '/stock/layers', timeoutMs: 25000 })
      const layers = Array.isArray(res.json) ? res.json : []
      dbBridge.kvSet('catalog_stock_layers', layers)
      scopes.push('stockLayers')
      if (bumpProductsFromLayers(dbBridge, layers)) scopes.push('products')
    } catch { /* best-effort */ }
  }

  // 4) Loyalty settings
  try {
    const res = await httpRequest({ method: 'GET', path: '/settings/loyalty', timeoutMs: 10000 })
    if (res.json && typeof res.json === 'object') {
      dbBridge.kvSet('loyalty_status_config', res.json)
      scopes.push('loyalty')
    }
  } catch { /* best-effort */ }

  return [...new Set(scopes)]
}

module.exports = {
  pullChannelExtras,
  bumpProductsFromLayers,
}
