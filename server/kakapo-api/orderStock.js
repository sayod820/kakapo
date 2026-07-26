/**
 * Резерв склада под онлайн-заказ магазина.
 * Списываем при оформлении, возвращаем при отмене, пересчитываем при правке состава.
 * Ресторанные позиции не трогаем — их остаток не в складе КАКАПО.
 */
import { marketItems } from './ordersLogic.js'
import { deductStockLines, restoreStockLines, sumProductLayers } from './posLogic.js'

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function productIdOf(item) {
  // product_id / productId — реальный товар; id в UI иногда бывает локальным ключом строки
  const id = Number(item?.product_id ?? item?.productId ?? item?.id)
  return id > 0 ? id : 0
}

/** Граммы из unit строки заказа («500 г», «0.5 кг»). */
function gramsFromUnit(unit) {
  const u = String(unit || '').toLowerCase().replace(/\s+/g, ' ')
  const kg = u.match(/(\d+(?:[.,]\d+)?)\s*кг/)
  if (kg) return Math.round(parseFloat(kg[1].replace(',', '.')) * 1000)
  const gr = u.match(/(\d+(?:[.,]\d+)?)\s*г/)
  if (gr) return Math.round(parseFloat(gr[1].replace(',', '.')))
  return 0
}

/**
 * Сколько единиц склада списывать за строку заказа.
 * Весовой товар на складе — в кг; в заказе часто qty=1 и вес в unit/grams.
 * Сборщик же добавляет «N шт» без граммов — тогда списываем qty как единицы склада.
 */
export function stockQtyForOrderItem(item, product) {
  if (!product) return 0
  const sellType = String(product.sellType || '').toLowerCase()
  if (sellType === 'weight') {
    const grams = Number(item.grams ?? item.weightGrams ?? item.promoUnits) || gramsFromUnit(item.unit)
    if (grams > 0) return round2(grams / 1000)
    const w = Number(item.weightKg)
    if (w > 0) return round2(w)
    // Сборка/правка: qty без grams (сок 17 шт, АНгур 6 шт) — иначе резерв = 0 и склад не двигается
    const qty = round2(Number(item.qty) || 0)
    return qty > 0 ? qty : 0
  }
  return round2(Number(item.qty) || 0)
}

/** Агрегированные строки списания только по товарам магазина. */
export function buildMarketStockLines(db, orderOrItems) {
  const items = Array.isArray(orderOrItems)
    ? orderOrItems
    : (orderOrItems?.items || [])
  const byId = new Map()
  for (const item of marketItems(items)) {
    const productId = productIdOf(item)
    if (!productId) continue
    const product = (db.products || []).find(p => Number(p.id) === productId)
    if (!product) continue
    const qty = stockQtyForOrderItem(item, product)
    if (!(qty > 0)) continue
    const prev = byId.get(productId)
    if (prev) prev.qty = round2(prev.qty + qty)
    else byId.set(productId, { productId, qty, productName: product.name })
  }
  return [...byId.values()]
}

function sameLines(a = [], b = []) {
  if (a.length !== b.length) return false
  const map = new Map(a.map(l => [Number(l.productId), round2(l.qty)]))
  for (const l of b) {
    if (round2(map.get(Number(l.productId))) !== round2(l.qty)) return false
    map.delete(Number(l.productId))
  }
  return map.size === 0
}

function touchedProductIds(...lineGroups) {
  const ids = new Set()
  for (const lines of lineGroups) {
    for (const l of lines || []) {
      if (l?.productId) ids.add(Number(l.productId))
    }
  }
  return [...ids]
}

/** Проверка доступности без списания. */
export function assertMarketStockAvailable(db, orderOrItems) {
  const lines = buildMarketStockLines(db, orderOrItems)
  for (const line of lines) {
    const have = sumProductLayers(db, line.productId)
    if (have + 1e-9 < line.qty) {
      throw new Error(`Недостаточно остатка: ${line.productName} (есть ${have}, нужно ${line.qty})`)
    }
  }
  return lines
}

/**
 * Списать склад под заказ. Повторный вызов безопасен (идемпотентно по stockReserved).
 * Заказы с кассы (stockFromPos) уже списаны — не трогаем.
 */
export function reserveOrderStock(db, order) {
  if (!order || order.stockFromPos) return []
  // Пустой «резерв» (старый баг весовых qty=0) не считаем успешным — пересчитаем
  if (order.stockReserved && Array.isArray(order.stockReserveLines) && order.stockReserveLines.length > 0) {
    return order.stockReserveLines
  }
  if (order.stockReserved && Array.isArray(order.stockReserveLines) && order.stockReserveLines.length === 0) {
    const retry = buildMarketStockLines(db, order)
    if (!retry.length) return order.stockReserveLines
    // иначе fall through — дорезервируем
    order.stockReserved = false
  }
  const lines = assertMarketStockAvailable(db, order)
  if (lines.length) deductStockLines(db, lines)
  order.stockReserved = true
  order.stockReserveLines = lines.map(l => ({
    productId: l.productId,
    qty: l.qty,
    productName: l.productName,
  }))
  return order.stockReserveLines
}

/** Вернуть склад при отмене / удалении. */
export function releaseOrderStock(db, order, reason = 'Отмена заказа') {
  if (!order || order.stockFromPos) return []
  if (!order.stockReserved) return []
  const lines = Array.isArray(order.stockReserveLines) ? order.stockReserveLines : []
  if (lines.length) restoreStockLines(db, lines, reason)
  order.stockReserved = false
  order.stockReserveLines = []
  return lines
}

/**
 * Пересчитать резерв при смене состава (сборщик заменил товар).
 * Если заказ отменён — ничего не делаем.
 */
export function syncOrderStockReserve(db, order, nextItems) {
  if (!order || order.stockFromPos) return { changed: false, productIds: [] }
  if (order.status === 'cancelled') return { changed: false, productIds: [] }

  const prevLines = Array.isArray(order.stockReserveLines) ? order.stockReserveLines : []
  const probe = { items: nextItems != null ? nextItems : order.items }
  const nextLines = buildMarketStockLines(db, probe)

  // !stockReserved → не выходим: старые заказы без резерва списываем при первой правке/статусе
  if (order.stockReserved && sameLines(prevLines, nextLines)) {
    return { changed: false, productIds: [] }
  }

  // Сначала проверяем, хватит ли после возврата текущего резерва
  const freed = new Map(prevLines.map(l => [Number(l.productId), round2(l.qty)]))
  for (const line of nextLines) {
    const have = sumProductLayers(db, line.productId) + (freed.get(line.productId) || 0)
    if (have + 1e-9 < line.qty) {
      throw new Error(`Недостаточно остатка: ${line.productName} (есть ${round2(have - (freed.get(line.productId) || 0))}, нужно ${line.qty})`)
    }
  }

  if (order.stockReserved && prevLines.length) {
    restoreStockLines(db, prevLines, 'Правка состава заказа')
  }
  if (nextLines.length) deductStockLines(db, nextLines)
  order.stockReserved = true
  order.stockReserveLines = nextLines.map(l => ({
    productId: l.productId,
    qty: l.qty,
    productName: l.productName,
  }))
  return { changed: true, productIds: touchedProductIds(prevLines, nextLines) }
}
