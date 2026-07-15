import { productBarcodes } from '@/lib/productBarcodes'
import { formatPriceLabel, isWeighted } from '@/lib/productWeight'
import type { Product, ProductStockLayer } from '@/lib/types'

export type LabelBlockId = 'brand' | 'name' | 'meta' | 'price' | 'plu' | 'barcode'
export type LabelAlign = 'left' | 'center' | 'right'
export type PaperPresetId = 'a4' | 'thermal58' | 'thermal80' | 'label40x30' | 'label58x40' | 'label50x25' | 'custom'

export type LabelBlockConfig = {
  id: LabelBlockId
  show: boolean
  align: LabelAlign
}

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
  barcodeHeight: number
  barcodeShowDigits: boolean
  paperPreset: PaperPresetId
  paperWidthMm: number
  paperHeightMm: number
  labelWidthMm: number
  labelHeightMm: number
  marginMm: number
  gapMm: number
  blocks: LabelBlockConfig[]
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

export const LABEL_BLOCK_LABELS: Record<LabelBlockId, string> = {
  brand: 'Бренд',
  name: 'Название',
  meta: 'Подпись',
  price: 'Цена',
  plu: 'PLU (весы)',
  barcode: 'Штрихкод',
}

export const PAPER_PRESETS: Record<Exclude<PaperPresetId, 'custom'>, {
  label: string
  paperWidthMm: number
  paperHeightMm: number
  labelWidthMm: number
  labelHeightMm: number
  marginMm: number
  gapMm: number
}> = {
  a4: { label: 'A4 (обычный лист)', paperWidthMm: 210, paperHeightMm: 297, labelWidthMm: 65, labelHeightMm: 40, marginMm: 8, gapMm: 3 },
  thermal58: { label: 'Термо 58 мм (лентa)', paperWidthMm: 58, paperHeightMm: 0, labelWidthMm: 54, labelHeightMm: 40, marginMm: 2, gapMm: 2 },
  thermal80: { label: 'Термо 80 мм (лентa)', paperWidthMm: 80, paperHeightMm: 0, labelWidthMm: 76, labelHeightMm: 50, marginMm: 2, gapMm: 2 },
  label40x30: { label: 'Наклейки 40×30 мм', paperWidthMm: 210, paperHeightMm: 297, labelWidthMm: 40, labelHeightMm: 30, marginMm: 5, gapMm: 2 },
  label58x40: { label: 'Наклейки 58×40 мм', paperWidthMm: 210, paperHeightMm: 297, labelWidthMm: 58, labelHeightMm: 40, marginMm: 5, gapMm: 3 },
  label50x25: { label: 'Наклейки 50×25 мм', paperWidthMm: 210, paperHeightMm: 297, labelWidthMm: 50, labelHeightMm: 25, marginMm: 5, gapMm: 2 },
}

export const DEFAULT_BLOCKS: LabelBlockConfig[] = [
  { id: 'brand', show: true, align: 'left' },
  { id: 'name', show: true, align: 'left' },
  { id: 'meta', show: true, align: 'left' },
  { id: 'price', show: true, align: 'left' },
  { id: 'plu', show: true, align: 'left' },
  { id: 'barcode', show: true, align: 'center' },
]

export const LABEL_DESIGN_KEY = 'kakapo-label-design-v2'

export const DEFAULT_LABEL_DESIGN: LabelDesign = {
  bgColor: '#ffffff',
  textColor: '#111111',
  accentColor: '#0a7a3e',
  borderColor: '#cccccc',
  brandSize: 10,
  nameSize: 14,
  priceSize: 22,
  metaSize: 10,
  padding: 8,
  borderRadius: 4,
  borderStyle: 'solid',
  barcodeHeight: 36,
  barcodeShowDigits: true,
  paperPreset: 'label58x40',
  paperWidthMm: 210,
  paperHeightMm: 297,
  labelWidthMm: 58,
  labelHeightMm: 40,
  marginMm: 5,
  gapMm: 3,
  blocks: DEFAULT_BLOCKS,
}

function normalizeBlocks(raw?: LabelBlockConfig[] | null): LabelBlockConfig[] {
  const list = Array.isArray(raw) ? raw : []
  const byId = new Map(list.map(b => [b.id, b]))
  const merged = DEFAULT_BLOCKS.map(def => ({ ...def, ...byId.get(def.id) }))
  for (const b of list) {
    if (!merged.find(x => x.id === b.id)) merged.push(b)
  }
  return merged
}

export function applyPaperPreset(preset: PaperPresetId, design: LabelDesign): LabelDesign {
  if (preset === 'custom') return { ...design, paperPreset: 'custom' }
  const p = PAPER_PRESETS[preset]
  return {
    ...design,
    paperPreset: preset,
    paperWidthMm: p.paperWidthMm,
    paperHeightMm: p.paperHeightMm,
    labelWidthMm: p.labelWidthMm,
    labelHeightMm: p.labelHeightMm,
    marginMm: p.marginMm,
    gapMm: p.gapMm,
  }
}

export function loadLabelDesign(): LabelDesign {
  if (typeof window === 'undefined') return DEFAULT_LABEL_DESIGN
  try {
    const raw = localStorage.getItem(LABEL_DESIGN_KEY) || localStorage.getItem('kakapo-label-design')
    if (!raw) return DEFAULT_LABEL_DESIGN
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_LABEL_DESIGN,
      ...parsed,
      blocks: normalizeBlocks(parsed.blocks),
    }
  } catch {
    return DEFAULT_LABEL_DESIGN
  }
}

export function saveLabelDesign(design: LabelDesign) {
  if (typeof window === 'undefined') return
  localStorage.setItem(LABEL_DESIGN_KEY, JSON.stringify(design))
}

export function moveBlock(blocks: LabelBlockConfig[], id: LabelBlockId, dir: -1 | 1) {
  const idx = blocks.findIndex(b => b.id === id)
  if (idx < 0) return blocks
  const next = idx + dir
  if (next < 0 || next >= blocks.length) return blocks
  const copy = [...blocks]
  ;[copy[idx], copy[next]] = [copy[next], copy[idx]]
  return copy
}

export function labelPickKey(productId: number, receiptId?: string | null) {
  return `${productId}::${receiptId || 'default'}`
}

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

export function buildPrintCss(design: LabelDesign) {
  const pageH = design.paperHeightMm > 0 ? `${design.paperHeightMm}mm` : 'auto'
  return `
    @media print {
      body * { visibility: hidden !important; }
      #k-label-print, #k-label-print * { visibility: visible !important; }
      #k-label-print {
        position: absolute; left: 0; top: 0; width: 100%;
        display: grid !important;
        grid-template-columns: repeat(auto-fill, ${design.labelWidthMm}mm) !important;
        gap: ${design.gapMm}mm !important;
        justify-content: start;
      }
      .k-label-card {
        width: ${design.labelWidthMm}mm !important;
        height: ${design.labelHeightMm}mm !important;
        min-height: ${design.labelHeightMm}mm !important;
        max-width: ${design.labelWidthMm}mm !important;
        box-sizing: border-box;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .k-label-edit-btn { display: none !important; }
      @page {
        size: ${design.paperWidthMm}mm ${pageH};
        margin: ${design.marginMm}mm;
      }
    }
  `
}

/** HTML для прямой печати этикеток из Electron (без браузерного диалога) */
export function buildLabelsPrintDocument(design: LabelDesign, labelsInnerHtml: string): string {
  const pageH = design.paperHeightMm > 0 ? design.paperHeightMm : Math.max(design.labelHeightMm + design.marginMm * 2, 40)
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Этикетки</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif;padding:${design.marginMm}mm}
  #k-label-print{
    display:grid;
    grid-template-columns:repeat(auto-fill, ${design.labelWidthMm}mm);
    gap:${design.gapMm}mm;
    justify-content:start;
  }
  .k-label-card{
    width:${design.labelWidthMm}mm !important;
    height:${design.labelHeightMm}mm !important;
    min-height:${design.labelHeightMm}mm !important;
    max-width:${design.labelWidthMm}mm !important;
    break-inside:avoid;
    page-break-inside:avoid;
    overflow:hidden;
  }
  .k-label-edit-btn{display:none !important}
  svg{max-width:100%;height:auto}
  @page{size:${design.paperWidthMm}mm ${pageH}mm;margin:0}
</style></head><body>
  <div id="k-label-print">${labelsInnerHtml}</div>
</body></html>`
}

type CSSProperties = Record<string, string | number | undefined>

export function previewCardStyle(design: LabelDesign): CSSProperties {
  const scale = 1.4
  return {
    width: `${design.labelWidthMm * scale}mm`,
    height: `${design.labelHeightMm * scale}mm`,
    minHeight: `${design.labelHeightMm * scale}mm`,
    maxWidth: `${design.labelWidthMm * scale}mm`,
    boxSizing: 'border-box',
  }
}

export function previewGridStyle(design: LabelDesign): CSSProperties {
  const scale = 1.4
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, ${design.labelWidthMm * scale}mm)`,
    gap: `${design.gapMm * scale}mm`,
  }
}
