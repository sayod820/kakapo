import type { Product } from './types'
import { productBarcodes, productMatchesSearch } from './productBarcodes'

/** Индекс штрихкод / артикул / PLU → товар (O(1) для сканера) */
export type ProductCodeIndex = Map<string, Product>

export function buildProductCodeIndex(products: Product[]): ProductCodeIndex {
  const map = new Map<string, Product>()
  const put = (key: string, p: Product) => {
    const k = String(key || '').trim()
    if (!k || map.has(k)) return
    map.set(k, p)
  }
  for (const p of products) {
    for (const c of productBarcodes(p)) {
      put(c, p)
      const d = c.replace(/\D/g, '')
      if (d) put(d, p)
    }
    const art = String(p.art || '').trim()
    if (art) {
      put(art, p)
      const ad = art.replace(/\D/g, '')
      if (ad) put(ad, p)
    }
    const plu = String(p.plu || '').replace(/\D/g, '')
    if (plu) put(`plu:${plu}`, p)
  }
  return map
}

export function lookupProductByCode(index: ProductCodeIndex, raw: string): Product | null {
  const q = String(raw || '').trim()
  if (!q) return null
  const digits = q.replace(/\D/g, '')
  return (
    index.get(q)
    || (digits ? index.get(digits) : undefined)
    || (digits.length >= 1 && digits.length <= 4 && /^\d+$/.test(q) ? index.get(`plu:${digits}`) : undefined)
    || null
  )
}

/** Похоже на скан штрихкода / длинный цифровой код */
export function looksLikeBarcodeQuery(raw: string): boolean {
  const q = String(raw || '').trim()
  if (!q) return false
  const compact = q.replace(/[\s\-]/g, '')
  const digits = compact.replace(/\D/g, '')
  if (digits.length >= 8) return true
  return digits.length >= 6 && digits.length === compact.length
}

/**
 * Быстрый фильтр для Товар / Склад.
 * Скан EAN → O(1) по индексу (SQLite тут не нужен — каталог уже в памяти).
 * Имя / короткий запрос → обычный productMatchesSearch.
 */
export function filterProductsByQuery(
  products: Product[],
  index: ProductCodeIndex,
  query: string,
  extraHaystack?: (p: Product) => string,
): Product[] {
  const q = String(query || '').trim()
  if (!q) return products

  if (looksLikeBarcodeQuery(q)) {
    const hit = lookupProductByCode(index, q)
    if (hit) return [hit]
    // Полный штрихкод не найден — не гоняем фонетику по всему каталогу
    const digits = q.replace(/\D/g, '')
    if (digits.length >= 8) return []
  }

  // Короткий цифровой хвост / артикул — сначала точный индекс
  const exact = lookupProductByCode(index, q)
  if (exact && (/^\d{4,}$/.test(q.replace(/[\s\-]/g, '')) || q.length >= 3)) {
    // Если запрос похож на код и есть точное совпадение — отдаём его первым, плюс остальные по имени
    const rest = products.filter(p =>
      p.id !== exact.id && productMatchesSearch(p, q, extraHaystack?.(p) || ''),
    )
    return [exact, ...rest]
  }

  return products.filter(p => productMatchesSearch(p, q, extraHaystack?.(p) || ''))
}
