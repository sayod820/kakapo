'use client'

import JsBarcode from 'jsbarcode'
import {
  labelPriceAmount,
  mmToLabelPx,
  RETAIL_LAYOUT,
  retailLabelName,
  retailShowBarcode,
  retailShowPlu,
  retailShowSize,
} from './labelRetailLayout'
import {
  type LabelBlockId,
  type LabelDesign,
  type LabelEdit,
  buildLabelsPrintDocument,
} from './labelShared'

function escHtml(s: string) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function barcodeFormat(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 13) return { format: 'EAN13' as const, value: digits }
  if (digits.length === 8) return { format: 'EAN8' as const, value: digits }
  if (/^\d+$/.test(digits) && digits.length >= 6) return { format: 'CODE128' as const, value: digits }
  return { format: 'CODE128' as const, value: value.trim() }
}

export function barcodeToSvgHtml(value: string, heightPx: number, showDigits: boolean): string {
  const code = value.trim()
  if (!code || typeof document === 'undefined') return ''

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const { format, value: normalized } = barcodeFormat(code)
  try {
    JsBarcode(svg, normalized, {
      format,
      height: heightPx,
      displayValue: showDigits,
      margin: 0,
      lineColor: '#000000',
      background: '#ffffff',
      fontSize: Math.max(8, Math.round(heightPx * 0.28)),
      width: 1.6,
      textMargin: 1,
      flat: true,
    })
  } catch {
    try {
      JsBarcode(svg, normalized, {
        format: 'CODE128',
        height: heightPx,
        displayValue: showDigits,
        margin: 0,
        lineColor: '#000000',
        background: '#ffffff',
        fontSize: Math.max(8, Math.round(heightPx * 0.28)),
        width: 1.6,
        flat: true,
      })
    } catch {
      return ''
    }
  }
  svg.setAttribute('style', 'width:92%;height:auto;display:block;margin:0 auto')
  return svg.outerHTML
}

function renderBlockHtml(id: LabelBlockId, edit: LabelEdit, design: LabelDesign, barcodeSvg: string): string {
  const cfg = design.blocks.find(b => b.id === id)
  if (!cfg?.show) return ''
  const align = cfg.align === 'center' ? 'center' : cfg.align === 'right' ? 'right' : 'left'

  switch (id) {
    case 'brand':
      return `<div style="text-align:${align};width:100%;font-size:${design.brandSize}px;font-weight:800;color:#000">${escHtml(edit.brand || 'KAKAPO')}</div>`
    case 'name':
      return `<div style="text-align:${align};width:100%;font-size:${design.nameSize}px;font-weight:800;line-height:1.15;color:#000">${escHtml(edit.name)}</div>`
    case 'meta':
      return `<div style="text-align:${align};width:100%;font-size:${Math.max(design.metaSize, 11)}px;line-height:1.15;color:#000;font-weight:600">${escHtml(edit.meta)}</div>`
    case 'price':
      return `<div style="text-align:${align};width:100%;font-size:${design.priceSize}px;font-weight:900;line-height:1.1;color:#000">${escHtml(labelPriceAmount(edit.price))} сом</div>`
    case 'plu':
      return `<div style="text-align:${align};width:100%;font-size:${design.metaSize}px;font-weight:700;color:#000">PLU ${escHtml(edit.plu)}</div>`
    case 'barcode':
      return barcodeSvg
        ? `<div style="text-align:${align};width:100%;margin-top:4px">${barcodeSvg}</div>`
        : ''
    default:
      return ''
  }
}

function buildRetailLabelCardHtml(edit: LabelEdit, design: LabelDesign): string {
  const pad = Math.max(design.padding, mmToLabelPx(RETAIL_LAYOUT.paddingMm))
  const barcodeH = mmToLabelPx(RETAIL_LAYOUT.barcodeHeightMm)
  const barcodeSvg = retailShowBarcode(edit)
    ? barcodeToSvgHtml(edit.barcode, barcodeH, design.barcodeShowDigits)
    : ''

  const plu = retailShowPlu(edit)
    ? `<div style="font-size:${RETAIL_LAYOUT.pluMm}mm;font-weight:700;line-height:1.15;margin-bottom:0.5mm;flex-shrink:0">PLU ${escHtml(edit.plu)}</div>`
    : ''

  const barcode = barcodeSvg
    ? `<div style="width:100%;max-width:100%;flex-shrink:0;display:flex;justify-content:center;margin-top:auto">${barcodeSvg}</div>`
    : ''

  const size = retailShowSize(edit)
    ? `<div style="font-size:${RETAIL_LAYOUT.sizeMm}mm;font-weight:600;line-height:1.1;margin-top:0.5mm;flex-shrink:0">${escHtml(edit.size)}</div>`
    : ''

  return `<div class="k-label-card k-label-retail" style="background:#fff;color:#000;border:none;padding:${pad}px ${pad + 2}px ${pad}px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;height:100%;overflow:hidden;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;text-align:center">
  <div style="font-size:${RETAIL_LAYOUT.nameMm}mm;font-weight:800;line-height:1.1;letter-spacing:0.03em;text-transform:uppercase;width:100%;flex-shrink:0">${escHtml(retailLabelName(edit))}</div>
  <hr style="border:none;border-top:${RETAIL_LAYOUT.rulePx}px solid #000;margin:2px 0;width:100%;flex-shrink:0">
  <div style="display:flex;align-items:flex-end;justify-content:center;gap:0.6mm;flex:1 1 auto;min-height:0;width:100%;padding:1px 0">
    <span style="font-size:${RETAIL_LAYOUT.priceMm}mm;font-weight:900;line-height:0.92;letter-spacing:-0.02em">${escHtml(labelPriceAmount(edit.price))}</span>
    <span style="font-size:${RETAIL_LAYOUT.currencyMm}mm;font-weight:700;line-height:1;padding-bottom:0.8mm">сом</span>
  </div>
  <hr style="border:none;border-top:${RETAIL_LAYOUT.rulePx}px solid #000;margin:2px 0;width:100%;flex-shrink:0">
  ${plu}
  ${barcode}
  ${size}
</div>`
}

function buildClassicLabelCardHtml(edit: LabelEdit, design: LabelDesign): string {
  const barcodeSvg = edit.showBarcode && edit.barcode.trim()
    ? barcodeToSvgHtml(edit.barcode, design.barcodeHeight, design.barcodeShowDigits)
    : ''

  const blocks = design.blocks
    .map(b => renderBlockHtml(b.id, edit, design, barcodeSvg))
    .filter(Boolean)
    .join('')

  return `<div class="k-label-card" style="background:#fff;color:#000;border:none;border-radius:0;padding:${Math.max(design.padding, 4)}px;display:flex;flex-direction:column;justify-content:flex-start;gap:2px;overflow:hidden;box-sizing:border-box">${blocks}</div>`
}

export function buildLabelCardPrintHtml(edit: LabelEdit, design: LabelDesign): string {
  if (design.layout === 'retail') return buildRetailLabelCardHtml(edit, design)
  return buildClassicLabelCardHtml(edit, design)
}

export function buildLabelsThermalPrintDocument(edits: LabelEdit[], design: LabelDesign): string {
  const cardsHtml = edits.map(edit => buildLabelCardPrintHtml(edit, design)).join('')
  return buildLabelsPrintDocument(design, cardsHtml, { thermalRoll: true })
}
