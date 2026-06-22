import type { Product } from './types'
import type { Promo } from './types'

export function isProductPromo(p: Promo): boolean {
  return p.type === 'product' && p.productId != null
}

export function activeProductPromos(promos: Promo[]): Promo[] {
  return promos.filter(p => p.on && isProductPromo(p))
}

/** Базовый каталог без зачёркнутых цен — скидки только из раздела «Акции» */
export function stripProductSaleFields(products: Product[]): Product[] {
  return products.map(p => ({
    ...p,
    old: null,
    discount: 0,
  }))
}

/** Применить активные товарные акции к каталогу для магазина */
export function applyActiveProductPromos(products: Product[], promos: Promo[]): Product[] {
  const base = stripProductSaleFields(products)
  const byId = new Map<number, Promo>()
  for (const promo of activeProductPromos(promos)) {
    const id = Number(promo.productId)
    if (id > 0) byId.set(id, promo)
  }
  if (!byId.size) return base

  return base.map(p => {
    const promo = byId.get(p.id)
    if (!promo) return p
    const salePrice = Number(promo.salePrice)
    const oldPrice = Number(promo.oldPrice) || Number(p.price) || 0
    if (!Number.isFinite(salePrice) || salePrice <= 0) return p
    const discount = oldPrice > salePrice
      ? Math.round((1 - salePrice / oldPrice) * 100)
      : 0
    return {
      ...p,
      price: salePrice,
      old: oldPrice > salePrice ? oldPrice : null,
      discount,
      hot: promo.markHot ?? p.hot,
    }
  })
}

export function productPromoLabel(promo: Promo, product?: Product | null): string {
  const sale = Number(promo.salePrice) || 0
  const old = Number(promo.oldPrice) || Number(product?.price) || 0
  if (old > sale && sale > 0) {
    const pct = Math.round((1 - sale / old) * 100)
    return `−${pct}% · ${sale.toFixed(2)} ЅМ`
  }
  return sale > 0 ? `${sale.toFixed(2)} ЅМ` : ''
}
