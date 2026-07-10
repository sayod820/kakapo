import { productBarcodes } from '@/lib/productBarcodes'
import { formatPriceLabel, isWeighted } from '@/lib/productWeight'
import type { Product, ProductStockLayer } from '@/lib/types'

export type LabelLayout = 'classic' | 'compact' | 'price-first'

export type LabelDesign = {
  bgColor: string
  textColor: string
  accentColor: string
  borderColor: string
  brandSize: number
  nameSize: number
  priceSize: number
  metaSize: number
  padding: number
  borderRadius: number
  borderStyle: 'dashed' | 'solid' | 'none'
  layout: LabelLayout
  showBrand: boolean
  showMeta: boolean
  showPrice: boolean
  barcodeHeight: number
  barcodeShowDigits: boolean
}

export type LabelEdit = {
  brand: string
  name: string
  price: string
  meta: string
  barcode: string
  plu: string
  showBarcode: boolean
  showPlu: boolean
}

export type LabelPick = {
  key: string
  productId: number
  receiptId: string | null
  product: Product
  layer: ProductStockLayer | null
}

export const LABEL_DESIGN_KEY = 'kakapo-label-design'

export const DEFAULT_LABEL_DESIGN: LabelDesign = {
  bgColor: '#ffffff',
  textColor: '#111111',
  accentColor: '#0a7a3e',
  borderColor: '#cccccc',
  brandSize: 10,
  nameSize: 14,
  priceSize: 22,
  metaSize: 10,
  padding: 12,
  borderRadius: 8,
  borderStyle: 'dashed',
  layout: 'classic',
  showBrand: true,
  showMeta: true,
  showPrice: true,
  barcodeHeight: 44,
  barcodeShowDigits: true,
}

export function loadLabelDesign(): LabelDesign {
  if (typeof window === 'undefined') return DEFAULT_LABEL_DESIGN
  try {
    const raw = localStorage.getItem(LABEL_DESIGN_KEY)
    if (!raw) return DEFAULT_LABEL_DESIGN
    return { ...DEFAULT_LABEL_DESIGN, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_LABEL_DESIGN
  }
}

export function saveLabelDesign(design: LabelDesign) {
  if (typeof window === 'undefined') return
  localStorage.setItem(LABEL_DESIGN_KEY, JSON.stringify(design))
}

export function labelPickKey(productId: number, receiptId?: string | null) {
  return `${productId}::${receiptId || 'default'}`
}

/** Штрихкод для печати — только реальный код товара, не артикул */
export function pickScanBarcode(product: Product): string {
  const codes = productBarcodes(product)
  for (const c of codes) {
    const digits = String(c).replace(/\D/g, '')
    if (digits.length >= 8 && digits.length <= 14) return digits
  }
  for (const c of codes) {
    const v = String(c).trim()
    if (v.length >= 4) return v
  }
  return ''
}

export function defaultLabelEdit(product: Product, layer?: ProductStockLayer | null): LabelEdit {
  const price = layer?.retailPrice ?? product.price ?? 0
  const scanCode = pickScanBarcode(product)
  const meta = layer
    ? `Партия · ${layer.remainingQty} ${product.unit || 'шт'} · ${product.art}`
    : isWeighted(product)
      ? `${formatPriceLabel(product)} · ${product.art}`
      : `${product.unit || 'шт'} · ${product.art}`
  return {
    brand: 'KAKAPO',
    name: product.name,
    price: String(price),
    meta,
    barcode: scanCode,
    plu: product.plu || '',
    showBarcode: !!scanCode,
    showPlu: !!(product.plu && isWeighted(product)),
  }
}

export function buildLabelPick(product: Product, layer?: ProductStockLayer | null): LabelPick {
  const receiptId = layer?.receiptId ?? null
  return {
    key: labelPickKey(product.id, receiptId),
    productId: product.id,
    receiptId,
    product,
    layer: layer ?? null,
  }
}

export function formatLabelMoney(price: string | number) {
  return `${(Number(price) || 0).toFixed(2)} сом`
}

export function layerShortLabel(layer: ProductStockLayer, unit: string) {
  const status = layer.isActive ? '● активная' : `очередь ${layer.queueIndex + 1}`
  return `${status} · ${layer.remainingQty} ${unit} · ${layer.retailPrice.toFixed(2)} сом`
}

export function designScale(design: LabelDesign, size: 'small' | 'medium' | 'large') {
  const m = size === 'small' ? 0.85 : size === 'large' ? 1.15 : 1
  return {
    ...design,
    brandSize: Math.round(design.brandSize * m),
    nameSize: Math.round(design.nameSize * m),
    priceSize: Math.round(design.priceSize * m),
    metaSize: Math.round(design.metaSize * m),
    padding: Math.round(design.padding * m),
    barcodeHeight: Math.round(design.barcodeHeight * m),
  }
}
