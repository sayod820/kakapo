import type { Product } from './types'
import { formatWeightGrams, isWeighted } from './productWeight'

export interface BulkPriceTier {
  minQty: number
  price: number
}

export function normalizeBulkPricing(raw?: BulkPriceTier[] | null): BulkPriceTier[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(t => ({
      minQty: Math.max(1, Math.floor(Number(t.minQty) || 0)),
      price: Math.round(Math.max(0, Number(t.price) || 0) * 100) / 100,
    }))
    .filter(t => t.minQty > 0 && t.price > 0)
    .sort((a, b) => a.minQty - b.minQty)
}

/** Цена за единицу (шт или за unitGrams) при текущем количестве в корзине */
export function effectiveUnitPrice(p: Partial<Product>, qty: number): number {
  const base = Number(p.price) || 0
  const tiers = normalizeBulkPricing(p.bulkPricing)
  if (!qty || !tiers.length) return base
  let unit = base
  for (const tier of tiers) {
    if (qty >= tier.minQty) unit = tier.price
  }
  return unit
}

export function qtyLabelForBulk(p: Partial<Product>, qty: number): string {
  if (isWeighted(p)) return formatWeightGrams(qty)
  return `${qty} шт`
}

export function formatBulkPricingHint(p: Partial<Product>): string | null {
  const tiers = normalizeBulkPricing(p.bulkPricing)
  if (!tiers.length) return null
  const best = tiers[tiers.length - 1]
  const unit = isWeighted(p) ? formatWeightGrams(best.minQty) : `${best.minQty} шт`
  return `от ${best.price.toFixed(2)} ЅМ при ${unit}+`
}

/** Подсказка в корзине: сколько не хватает до оптовой цены */
export function bulkPricingHintForQty(p: Partial<Product>, qty: number): string | null {
  const tiers = normalizeBulkPricing(p.bulkPricing)
  if (!tiers.length || !qty) return null
  const active = effectiveUnitPrice(p, qty)
  if (active < Number(p.price)) {
    return `Опт: ${active.toFixed(2)} ЅМ/${isWeighted(p) ? 'порция' : 'шт'}`
  }
  const next = tiers.find(t => t.minQty > qty)
  if (!next) return null
  const need = next.minQty - qty
  const needLabel = isWeighted(p) ? formatWeightGrams(need) : `${need} шт`
  return `Ещё ${needLabel} → ${next.price.toFixed(2)} ЅМ/${isWeighted(p) ? 'порция' : 'шт'}`
}

export function hasBulkPricing(p: Partial<Product>): boolean {
  return normalizeBulkPricing(p.bulkPricing).length > 0
}
