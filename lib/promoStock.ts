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

/** Лимит сохранён как кг×1000 (20 → 20000), а не как штуки */
export function promoLimitLooksLikeGrams(promo?: Promo | null): boolean {
  const limit = promoStockLimit(promo)
  if (limit < 1000 || limit % 1000 !== 0) return false
  const kg = limit / 1000
  if (kg < 1 || kg > 500) return false
  // 20 кг → 20000; 2000 шт обычно записывают как 2000 без ×1000
  if (limit >= 10000) return true
  if (limit >= 3000) return true
  return false
}

/** Граммы или штуки — приоритет у stockLimitUnit на акции (чтобы витрина совпадала с админкой) */
export function promoLimitUsesGrams(promo?: Promo | null, product?: Partial<Product> | null): boolean {
  if (promo?.stockLimitUnit === 'grams') return true
  if (isWeightedPromoProduct(product)) return true
  if (promoLimitLooksLikeGrams(promo)) return true
  if (promo?.stockLimitUnit === 'pieces') return false
  return false
}

/** Единица лимита в админке: кг для весовых, шт для остальных */
export function promoLimitUnit(product?: Partial<Product> | null, promo?: Promo | null): 'кг' | 'шт' {
  return promoLimitUsesGrams(promo, product) ? 'кг' : 'шт'
}

/** Ввод в админке → внутренние единицы (шт или граммы) */
export function stockLimitFromAdminInput(raw: string, product?: Partial<Product> | null): number | undefined {
  const n = Number(String(raw).replace(',', '.').trim())
  if (!Number.isFinite(n) || n <= 0) return undefined
  if (isWeightedPromoProduct(product)) return Math.round(n * 1000)
  return Math.round(n)
}

/** Внутренние единицы → строка для поля в админке */
export function stockLimitToAdminInput(limit?: number, product?: Partial<Product> | null, promo?: Promo | null): string {
  const n = Number(limit)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (promoLimitUsesGrams(promo, product)) {
    const kg = n / 1000
    return Number.isInteger(kg) ? String(kg) : kg.toFixed(1).replace(/\.0$/, '')
  }
  return String(Math.round(n))
}

export function formatPromoStockLeft(promo?: Promo | null, product?: Partial<Product> | null): string | null {
  if (!promo) return null
  const left = promoStockRemaining(promo)
  if (left == null) return null
  if (promoLimitUsesGrams(promo, product)) {
    if (left >= 1000) return `осталось ${(left / 1000).toFixed(1).replace(/\.0$/, '')} кг`
    return `осталось ${left} г`
  }
  return `осталось ${left} шт`
}

export function formatPromoStockAdmin(promo: Promo, product?: Partial<Product> | null): string | null {
  const limit = promoStockLimit(promo)
  if (!limit) return null
  const sold = promoStockSold(promo)
  if (promoLimitUsesGrams(promo, product)) {
    const fmt = (g: number) => (g >= 1000 ? `${(g / 1000).toFixed(1).replace(/\.0$/, '')} кг` : `${g} г`)
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
