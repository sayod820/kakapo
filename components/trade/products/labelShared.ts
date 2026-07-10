import { productBarcodes } from '@/lib/productBarcodes'
import { formatPriceLabel, isWeighted } from '@/lib/productWeight'
import type { Product, ProductStockLayer } from '@/lib/types'

export type LabelEdit = {
  brand: string
  name: string
  price: string
  meta: string
  barcode: string
  showBarcode: boolean
}

export type LabelPick = {
  key: string
  productId: number
  receiptId: string | null
  product: Product
  layer: ProductStockLayer | null
}

export function labelPickKey(productId: number, receiptId?: string | null) {
  return `${productId}::${receiptId || 'default'}`
}

export function parseLabelPickKey(key: string) {
  const [productId, receiptId] = key.split('::')
  return {
    productId: Number(productId),
    receiptId: receiptId === 'default' ? null : receiptId,
  }
}

export function defaultLabelEdit(product: Product, layer?: ProductStockLayer | null): LabelEdit {
  const price = layer?.retailPrice ?? product.price ?? 0
  const codes = productBarcodes(product)
  const meta = layer
    ? `Партия · ${layer.remainingQty} ${product.unit || 'шт'} · ${layer.isActive ? 'активная' : `очередь ${layer.queueIndex + 1}`}`
    : isWeighted(product)
      ? formatPriceLabel(product)
      : `${product.unit || 'шт'} · ${product.art}`
  return {
    brand: 'KAKAPO',
    name: product.name,
    price: String(price),
    meta,
    barcode: product.plu ? `PLU ${product.plu}` : (codes[0] || product.art),
    showBarcode: true,
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
