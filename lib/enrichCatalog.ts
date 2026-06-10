import type { Product, Restaurant } from './types'

/** Дополняет товар из API полями UI (grad, desc…) из локального seed */
export function enrichProducts(api: Product[], seed: any[]): any[] {
  if (!api.length) return seed
  return api.map(p => {
    const base = seed.find(s => s.id === p.id || s.art === p.art) || {}
    const discount = p.discount ?? (p.old && p.old > p.price ? Math.round((1 - p.price / p.old) * 100) : 0)
    return {
      ...base,
      ...p,
      discount,
      grad: base.grad || 'linear-gradient(145deg,#0D2A0D,#1A4A1A)',
      cat: p.cat || base.cat,
      catId: p.catId || base.catId || p.catId,
      desc: base.desc || p.name,
      specs: base.specs || {},
      r: base.r ?? 4.8,
      rv: base.rv ?? 100,
      isNew: base.isNew ?? false,
      org: p.organic ?? base.org ?? false,
    }
  })
}

/** Дополняет ресторан из API полями UI из seed */
export function enrichRestaurants(api: Restaurant[], seed: any[]): any[] {
  if (!api.length) return seed
  return api.map(r => {
    const base = seed.find(s => s.id === r.id) || {}
    return {
      ...base,
      ...r,
      open: r.open ?? base.open ?? true,
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
