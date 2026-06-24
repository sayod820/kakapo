import type { Product, Promo } from './types'

export function promoStockLimit(promo?: Promo | null): number {
  const n = Number(promo?.stockLimit)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function promoStockSold(promo?: Promo | null): number {
  const n = Number(promo?.stockSold)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Остаток по акции: null = без лимита */
export function promoStockRemaining(promo?: Promo | null): number | null {
  if (!promo) return null
  const limit = promoStockLimit(promo)
  if (!limit) return null
  return Math.max(0, limit - promoStockSold(promo))
}

export function isPromoStockAvailable(promo?: Promo | null): boolean {
  const left = promoStockRemaining(promo)
  return left === null || left > 0
}

export function promoStockPercent(promo?: Promo | null): number | null {
  if (!promo) return null
  const limit = promoStockLimit(promo)
  if (!limit) return null
  const left = promoStockRemaining(promo) ?? 0
  return Math.round((left / limit) * 100)
}

export function isWeightedPromoProduct(product?: Partial<Product> | null): boolean {
  return product?.sellType === 'weight'
}

/** Единица лимита в админке: кг для весовых, шт для остальных */
export function promoLimitUnit(product?: Partial<Product> | null): 'кг' | 'шт' {
  return isWeightedPromoProduct(product) ? 'кг' : 'шт'
}

/** Ввод в админке → внутренние единицы (шт или граммы) */
export function stockLimitFromAdminInput(raw: string, product?: Partial<Product> | null): number | undefined {
  const n = Number(String(raw).replace(',', '.').trim())
  if (!Number.isFinite(n) || n <= 0) return undefined
  if (isWeightedPromoProduct(product)) return Math.round(n * 1000)
  return Math.round(n)
}

/** Внутренние единицы → строка для поля в админке */
export function stockLimitToAdminInput(limit?: number, product?: Partial<Product> | null): string {
  const n = Number(limit)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (isWeightedPromoProduct(product)) {
    const kg = n / 1000
    return Number.isInteger(kg) ? String(kg) : kg.toFixed(1).replace(/\.0$/, '')
  }
  return String(Math.round(n))
}

export function formatPromoStockLeft(promo?: Promo | null, product?: Partial<Product> | null): string | null {
  if (!promo) return null
  const left = promoStockRemaining(promo)
  if (left == null) return null
  if (isWeightedPromoProduct(product)) {
    if (left >= 1000) return `осталось ${(left / 1000).toFixed(1)} кг`
    return `осталось ${left} г`
  }
  return `осталось ${left} шт`
}

export function formatPromoStockAdmin(promo: Promo, product?: Partial<Product> | null): string | null {
  const limit = promoStockLimit(promo)
  if (!limit) return null
  const sold = promoStockSold(promo)
  if (isWeightedPromoProduct(product)) {
    const fmt = (g: number) => (g >= 1000 ? `${(g / 1000).toFixed(1)} кг` : `${g} г`)
    return `${fmt(sold)} / ${fmt(limit)}`
  }
  return `${sold} / ${limit} шт`
}

export function isPromoStockExhausted(promo?: Promo | null): boolean {
  if (!promo) return false
  const limit = promoStockLimit(promo)
  if (!limit) return false
  return promoStockSold(promo) >= limit
}

/** Сколько ещё можно добавить в корзину по акции */
export function promoCartRoom(promo?: Promo | null, currentCartQty: number): number | null {
  const left = promoStockRemaining(promo)
  if (left == null) return null
  return Math.max(0, left - (Number(currentCartQty) || 0))
}
