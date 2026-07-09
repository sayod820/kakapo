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

export function productBarcodeSearchText(p: Partial<Product>): string {
  return productBarcodes(p).join(' ')
}
