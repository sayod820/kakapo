import type { Product } from './types'

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
  if (grams >= 1000) {
    const kg = grams / 1000
    return `${Number.isInteger(kg) ? kg : kg.toFixed(1).replace(/\.0$/, '')} кг`
  }
  return `${grams} г`
}

export function formatCartQty(p: Partial<Product>, qty: number): string {
  if (!qty) return '0'
  return isWeighted(p) ? formatWeightGrams(qty) : String(qty)
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
  const price = Number(p.price) || 0
  if (!qty) return 0
  if (!isWeighted(p)) return price * qty
  return price * (qty / productUnitGrams(p))
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
