import type { Product } from './types'
import { effectiveUnitPrice } from './productBulkPricing'

export type SellType = 'piece' | 'weight'

export function isWeighted(p: Partial<Product> | null | undefined): boolean {
  return p?.sellType === 'weight'
}

/** Граммы, за которые указана цена (500 г → 500, 1 кг → 1000) */
export function productUnitGrams(p: Partial<Product>): number {
  if (p.unitGrams && p.unitGrams > 0) return p.unitGrams
  const u = (p.unit || '').toLowerCase().replace(/\s+/g, ' ')
  const kg = u.match(/(\d+(?:[.,]\d+)?)\s*кг/)
  if (kg) return Math.round(parseFloat(kg[1].replace(',', '.')) * 1000)
  const gr = u.match(/(\d+(?:[.,]\d+)?)\s*г/)
  if (gr) return Math.round(parseFloat(gr[1].replace(',', '.')))
  return isWeighted(p) ? 1000 : 1
}

export function weightStep(p: Partial<Product>): number {
  return p.weightStep && p.weightStep > 0 ? p.weightStep : 100
}

export function minWeight(p: Partial<Product>): number {
  return p.minWeight && p.minWeight > 0 ? p.minWeight : weightStep(p)
}

export function formatWeightGrams(grams: number): string {
  return formatKgAmount(grams, false)
}

/** Кг из граммов: 100 г → «0.1» или «0.1 кг» */
export function formatKgAmount(grams: number, compact = false): string {
  if (!grams) return compact ? '0' : '0 кг'
  const kg = grams / 1000
  const s = Number.isInteger(kg) ? String(kg) : kg.toFixed(1).replace(/\.0$/, '')
  return compact ? s : `${s} кг`
}

export function formatCartQty(p: Partial<Product>, qty: number): string {
  if (!qty) return '0'
  return isWeighted(p) ? formatWeightGrams(qty) : String(qty)
}

/** Компактное кол-во для степперов на карточках: 100 г → 0.1, 700 г → 0.7 */
export function formatCartQtyStepper(p: Partial<Product>, qty: number): string {
  if (!qty) return '0'
  return isWeighted(p) ? formatKgAmount(qty, true) : String(qty)
}

export function formatPriceLabel(p: Partial<Product>): string {
  const price = Number(p.price) || 0
  if (!isWeighted(p)) return `${price.toFixed(2)} ЅМ / ${p.unit || 'шт'}`
  const ug = productUnitGrams(p)
  if (ug === 1000) return `${price.toFixed(2)} ЅМ / кг`
  if (ug === 100) return `${price.toFixed(2)} ЅМ / 100 г`
  return `${price.toFixed(2)} ЅМ / ${formatWeightGrams(ug)}`
}

export function calcLineTotal(p: Partial<Product>, qty: number): number {
  if (!qty) return 0
  if (!isWeighted(p)) {
    const unit = effectiveUnitPrice(p, qty)
    return Math.round(unit * qty * 100) / 100
  }
  const unit = effectiveUnitPrice(p, qty)
  return Math.round(unit * (qty / productUnitGrams(p)) * 100) / 100
}

export function nextCartQty(p: Partial<Product>, current: number, add: boolean): number {
  if (!isWeighted(p)) return add ? current + 1 : Math.max(0, current - 1)
  const step = weightStep(p)
  const min = minWeight(p)
  if (add) return current === 0 ? min : current + step
  const next = current - step
  return next < min ? 0 : next
}

export function orderItemFromProduct(p: Partial<Product>, qty: number) {
  const weighted = isWeighted(p)
  return {
    ...(typeof p.id === 'number' ? { id: p.id } : {}),
    name: weighted ? `${p.name} (${formatWeightGrams(qty)})` : (p.name || 'Товар'),
    e: p.e || '📦',
    qty: weighted ? 1 : qty,
    unit: weighted ? formatWeightGrams(qty) : (p.unit || 'шт'),
    price: Number(calcLineTotal(p, qty).toFixed(2)),
    source: 'market' as const,
    ...(p.art ? { art: p.art } : {}),
  }
}

export function estimateCartWeightKg(items: { p: Partial<Product>; qty: number }[]): number {
  const kg = items.reduce((s, { p, qty }) => {
    if (isWeighted(p)) return s + qty / 1000
    return s + qty * 0.35
  }, 0)
  return Math.max(0.3, kg)
}

/** Единицы для бейджа корзины: граммы → кг (700 г = 0.7), штуки — как есть */
export function cartQtyUnits(p: Partial<Product> | null | undefined, qty: number): number {
  if (!qty) return 0
  if (p && isWeighted(p)) return qty / 1000
  return qty
}

export function sumCartUnits(
  cart: Record<string | number, number>,
  prods: Partial<Product>[] = [],
): number {
  const byId = new Map(prods.map(p => [String(p.id), p]))
  return Object.entries(cart).reduce((sum, [id, qty]) => {
    const p = byId.get(String(id))
    return sum + cartQtyUnits(p, qty)
  }, 0)
}

/** Формат числа на бейдже корзины: 1.7, 2, 3.5 */
export function formatCartBadgeCount(total: number): string {
  if (!total) return '0'
  if (Number.isInteger(total)) return String(total)
  const s = total.toFixed(1)
  return s.endsWith('.0') ? s.slice(0, -2) : s
}
