import type { Product, Restaurant } from './types'

/** Синонимы catId из API/GBS → slug каталога в приложении */
const CAT_ALIASES: Record<string, string> = {
  drinks: 'drink',
  sweets: 'sweet',
}

/** Slug категории для фильтров (meat, veg…) — не путать с p.cat «Мясо» из API */
export function productCatSlug(p: { catId?: string; cat?: string }): string {
  const raw = String(p.catId || p.cat || '')
  return CAT_ALIASES[raw] || raw
}

/** Дополняет товар из API полями UI (grad, desc…) из локального seed */
export function enrichProducts(api: Product[], seed: any[]): any[] {
  const list = Array.isArray(api) ? api : []
  if (!list.length) return seed
  return list.map(p => {
    const base = seed.find(s => s.id === p.id || s.art === p.art) || {}
    const discount = p.discount ?? (p.old && p.old > p.price ? Math.round((1 - p.price / p.old) * 100) : 0)
    const catId = productCatSlug({ catId: p.catId || base.catId, cat: base.cat })
    return {
      ...base,
      ...p,
      discount,
      grad: base.grad || 'linear-gradient(145deg,#0D2A0D,#1A4A1A)',
      catLabel: p.cat || base.catLabel || base.cat || '',
      catId,
      cat: catId,
      desc: p.desc || base.desc || p.name,
      brand: p.brand || base.brand || '',
      country: p.country || base.country || '',
      barcode: p.barcode || base.barcode || '',
      sellType: p.sellType || base.sellType || 'piece',
      unitGrams: p.unitGrams || base.unitGrams,
      weightStep: p.weightStep || base.weightStep,
      minWeight: p.minWeight || base.minWeight,
      bulkPricing: p.bulkPricing || base.bulkPricing,
      specs: base.specs || {},
      r: base.r ?? 4.8,
      rv: base.rv ?? 100,
      isNew: base.isNew ?? false,
      org: p.organic ?? base.org ?? false,
    }
  })
}

/** Дополняет ресторан из API полями UI из seed (рейтинг и число отзывов — только из API) */
export function enrichRestaurants(api: Restaurant[], seed: any[]): any[] {
  const list = Array.isArray(api) ? api : []
  if (!list.length) {
    return seed.map(r => ({
      ...r,
      rating: 0,
      reviews: 0,
    }))
  }
  return list.map(r => {
    const base = seed.find(s => s.id === r.id) || {}
    const { rating: _seedRating, reviews: _seedReviews, ...baseUi } = base
    return {
      ...baseUi,
      ...r,
      rating: typeof r.rating === 'number' ? r.rating : 0,
      reviews: typeof r.reviews === 'number' ? r.reviews : 0,
      blocked: !!r.blocked,
      open: r.blocked ? false : (typeof r.open === 'boolean' ? r.open : (base.open ?? true)),
      cuisine: r.cuisine || base.cuisine || '',
      img: r.img || base.img || 'linear-gradient(135deg,#1A1A1A,#2A2A2A)',
      tags: base.tags || [],
      minOrder: base.minOrder ?? 20,
      deliveryMin: base.deliveryMin ?? 35,
      deliveryFee: base.deliveryFee ?? 5,
      hours: base.hours ?? '09:00–23:00',
      categories: base.categories || [...new Set((r.menu || []).map((m: any) => m.cat))],
      menu: (r.menu || []).map((m: any) => ({
        ...m,
        inStock: m.inStock ?? true,
        popular: m.popular ?? false,
        time: m.time ?? 20,
        old: m.old ?? null,
        desc: m.desc || '',
      })),
    }
  })
}
