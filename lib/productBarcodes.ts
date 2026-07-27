import type { Product } from './types'

/** Уникальные штрихкоды товара (основной + дополнительные) */
export function productBarcodes(p: Partial<Product> | null | undefined): string[] {
  if (!p) return []
  const list = [
    ...(p.barcode ? [String(p.barcode).trim()] : []),
    ...(Array.isArray(p.barcodes) ? p.barcodes.map(b => String(b).trim()) : []),
  ].filter(Boolean)
  return [...new Set(list)]
}

export function normalizeBarcodes(codes: string[]) {
  const barcodes = [...new Set(codes.map(c => c.trim()).filter(Boolean))]
  return {
    barcode: barcodes[0],
    barcodes,
  }
}

/** Префикс внутренних EAN-13 (не 2x — чтобы не путать с весовыми этикетками) */
export const INTERNAL_EAN_PREFIX = '460'

export function ean13CheckDigit(digits12: string): string {
  const d = String(digits12 || '').replace(/\D/g, '').padStart(12, '0').slice(0, 12)
  let sum = 0
  for (let i = 0; i < 12; i++) {
    sum += Number(d[i]) * (i % 2 === 0 ? 1 : 3)
  }
  return String((10 - (sum % 10)) % 10)
}

export function buildEan13(digits12: string): string {
  const d = String(digits12 || '').replace(/\D/g, '').padStart(12, '0').slice(0, 12)
  return d + ean13CheckDigit(d)
}

export function collectUsedBarcodes(
  products: Array<Partial<Product>> | null | undefined,
  excludeId?: number | null,
): Set<string> {
  const used = new Set<string>()
  for (const p of products || []) {
    if (excludeId != null && p.id != null && Number(p.id) === Number(excludeId)) continue
    for (const c of productBarcodes(p)) used.add(c)
  }
  return used
}

/**
 * Свободный внутренний EAN-13: 460 + 9 цифр + контрольная.
 * preferSerial — обычно номер артикула (если свободен).
 */
export function nextFreeEan13(
  products: Array<Partial<Product>> | null | undefined,
  preferSerial?: number | null,
  excludeId?: number | null,
): string {
  const used = collectUsedBarcodes(products, excludeId)
  let n = preferSerial && preferSerial > 0 ? Math.floor(preferSerial) : 1
  if (n > 999_999_999) n = 1
  for (let i = 0; i < 1_000_000; i++) {
    const serial = ((n - 1 + i) % 999_999_999) + 1
    const code = buildEan13(INTERNAL_EAN_PREFIX + String(serial).padStart(9, '0'))
    if (!used.has(code)) return code
  }
  const stamp = Date.now() % 1_000_000_000
  return buildEan13(INTERNAL_EAN_PREFIX + String(stamp).padStart(9, '0'))
}

export function productBarcodeSearchText(p: Partial<Product>): string {
  return productBarcodes(p).join(' ')
}

/** Текст для полнотекстового поиска: имя, артикул, штрихкоды, PLU, бренд */
export function productSearchHaystack(p: Partial<Product>, extra = ''): string {
  return [
    p.name,
    p.art,
    p.brand,
    p.plu,
    productBarcodeSearchText(p),
    extra,
  ].filter(Boolean).join(' ').toLowerCase()
}

/** Релевантность для сортировки (сканер штрихкода → точное совпадение вверху) */
export function productSearchScore(p: Partial<Product>, query: string, extra = ''): number {
  const q = query.trim().toLowerCase()
  const qRaw = query.trim()
  if (!q) return 0

  const codes = productBarcodes(p)
  if (qRaw && codes.some(c => c === qRaw)) return 1000
  const qDigits = qRaw.replace(/\D/g, '')
  if (qDigits.length >= 8 && codes.some(c => c.replace(/\D/g, '') === qDigits)) return 1000

  const name = (p.name || '').toLowerCase()
  const art = (p.art || '').toLowerCase()
  const plu = (p.plu || '').toLowerCase()

  if (art === q) return 900
  if (plu === q) return 880
  if (qDigits && String(p.plu || '').replace(/\D/g, '') === qDigits) return 880
  if (name === q) return 800
  if (name.startsWith(q)) return 700
  if (art.startsWith(q)) return 650
  // Частичный штрихкод — только для длинных кодов (не 4 цифры PLU / начало EAN)
  if (qDigits.length >= 8 && codes.some(c => c.replace(/\D/g, '').startsWith(qDigits))) return 600
  if (qRaw.length >= 8 && codes.some(c => c.startsWith(qRaw))) return 600
  if (name.includes(q)) return 500
  if (art.includes(q)) return 400
  if (qDigits.length >= 8 && codes.some(c => c.replace(/\D/g, '').includes(qDigits))) return 300
  if (qRaw.length >= 8 && codes.some(c => c.includes(qRaw))) return 300
  // Короткие цифры (PLU) — без haystack.includes, иначе «23» ловит PLU 1234
  if (/^\d+$/.test(qRaw) && qDigits.length <= 7) return 0

  const haystack = productSearchHaystack(p, extra)
  if (haystack.includes(q)) return 100
  return 0
}

export function productMatchesSearch(p: Partial<Product>, query: string, extra = ''): boolean {
  if (!query.trim()) return true
  return productSearchScore(p, query, extra) > 0
}

/** Отфильтровать и отсортировать товары по имени / артикулу / штрихкоду */
export function filterProductsBySearch<T extends Partial<Product>>(
  products: T[],
  query: string,
  limit = 30,
  extraForProduct?: (p: T) => string,
): T[] {
  const q = query.trim()
  if (!q) return products.slice(0, limit)
  return products
    .map(p => ({ p, score: productSearchScore(p, q, extraForProduct?.(p) || '') }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(row => row.p)
}

/** Лучшее совпадение для сканера (Enter / точный штрихкод / PLU) */
export function pickProductBySearch<T extends Partial<Product>>(
  products: T[],
  query: string,
  extraForProduct?: (p: T) => string,
): T | null {
  const q = query.trim()
  if (!q) return null
  const qDigits = q.replace(/\D/g, '')
  const rows = filterProductsBySearch(products, q, 30, extraForProduct)
  if (!rows.length) return null

  const exactBarcode = rows.find(p => {
    const codes = productBarcodes(p)
    if (codes.some(c => c === q)) return true
    if (qDigits.length >= 8 && codes.some(c => c.replace(/\D/g, '') === qDigits)) return true
    return false
  })
  if (exactBarcode) return exactBarcode

  const exactArt = rows.find(p => String(p.art || '').toLowerCase() === q.toLowerCase())
  if (exactArt) return exactArt

  // PLU (обычно 4 цифры) — только точное совпадение, не префикс штрихкода
  if (qDigits.length >= 1 && qDigits.length <= 4 && /^\d+$/.test(q.trim())) {
    const exactPlu = rows.find(p => String(p.plu || '').replace(/\D/g, '') === qDigits)
    if (exactPlu) return exactPlu
    return null
  }

  if (rows.length === 1) {
    const only = rows[0]
    if (productSearchScore(only, q, extraForProduct?.(only) || '') >= 600) return only
    return null
  }
  const top = rows[0]
  if (productSearchScore(top, q, extraForProduct?.(top) || '') >= 600) return top
  return null
}

/** Поиск товара в строке документа (приход, списание, ревизия) */
export function documentProductMatchesSearch(
  productId: number,
  productName: string,
  products: Iterable<Partial<Product>>,
  query: string,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (productName.toLowerCase().includes(q)) return true
  for (const p of products) {
    if (p.id === productId && productMatchesSearch(p, q)) return true
  }
  return false
}
