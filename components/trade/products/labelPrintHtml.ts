'use client'

import JsBarcode from 'jsbarcode'
import {
  formatLabelMoney,
  type LabelAlign,
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

/** SVG штрихкода как строка — для печати в Electron без React innerHTML */
export function barcodeToSvgHtml(value: string, design: LabelDesign): string {
  const code = value.trim()
  if (!code || typeof document === 'undefined') return ''

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const { format, value: normalized } = barcodeFormat(code)
  try {
    JsBarcode(svg, normalized, {
      format,
      height: design.barcodeHeight,
      displayValue: design.barcodeShowDigits,
      margin: 2,
      lineColor: '#000000',
      fontSize: 11,
      width: 1.5,
      textMargin: 2,
    })
  } catch {
    try {
      JsBarcode(svg, normalized, {
        format: 'CODE128',
        height: design.barcodeHeight,
        displayValue: design.barcodeShowDigits,
        margin: 2,
        lineColor: '#000000',
        fontSize: 11,
        width: 1.5,
      })
    } catch {
      return ''
    }
  }
  svg.setAttribute('style', 'width:100%;height:auto;display:block')
  return svg.outerHTML
}

function alignCss(align: LabelAlign) {
  return align === 'center' ? 'center' : align === 'right' ? 'right' : 'left'
}

function blockVisible(id: LabelBlockId, edit: LabelEdit, design: LabelDesign) {
  const cfg = design.blocks.find(b => b.id === id)
  if (!cfg?.show) return false
  if (id === 'barcode') return edit.showBarcode && !!edit.barcode.trim()
  if (id === 'plu') return edit.showPlu && !!edit.plu
  if (id === 'brand') return !!edit.brand
  if (id === 'name') return !!edit.name
  if (id === 'meta') return !!edit.meta
  if (id === 'price') return true
  return true
}

function renderBlockHtml(id: LabelBlockId, edit: LabelEdit, design: LabelDesign, barcodeSvg: string): string {
  const cfg = design.blocks.find(b => b.id === id)
  if (!cfg || !blockVisible(id, edit, design)) return ''
  const align = alignCss(cfg.align)

  switch (id) {
    case 'brand':
      return `<div style="text-align:${align};width:100%;font-size:${design.brandSize}px;font-weight:800;color:${design.accentColor};letter-spacing:.06em">${escHtml(edit.brand || 'KAKAPO')}</div>`
    case 'name':
      return `<div style="text-align:${align};width:100%;font-size:${design.nameSize}px;font-weight:800;line-height:1.2;color:#000">${escHtml(edit.name)}</div>`
    case 'meta':
      return `<div style="text-align:${align};width:100%;font-size:${design.metaSize}px;line-height:1.2;color:#333">${escHtml(edit.meta)}</div>`
    case 'price':
      return `<div style="text-align:${align};width:100%;font-size:${design.priceSize}px;font-weight:900;line-height:1.1;color:${design.accentColor}">${escHtml(formatLabelMoney(edit.price))}</div>`
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

export function buildLabelCardPrintHtml(edit: LabelEdit, design: LabelDesign): string {
  const border = design.borderStyle === 'none'
    ? 'none'
    : `${design.borderStyle === 'dashed' ? '1px dashed' : '1px solid'} ${design.borderColor}`
  const barcodeSvg = edit.showBarcode && edit.barcode.trim()
    ? barcodeToSvgHtml(edit.barcode, design)
    : ''

  const blocks = design.blocks
    .map(b => renderBlockHtml(b.id, edit, design, barcodeSvg))
    .filter(Boolean)
    .join('')

  return `<div class="k-label-card" style="background:${design.bgColor};color:#000;border:${border};border-radius:${design.borderRadius}px;padding:${design.padding}px;display:flex;flex-direction:column;justify-content:flex-start;gap:3px;overflow:hidden;box-sizing:border-box">${blocks}</div>`
}

export function buildLabelsThermalPrintDocument(edits: LabelEdit[], design: LabelDesign): string {
  const cardsHtml = edits.map(edit => buildLabelCardPrintHtml(edit, design)).join('')
  return buildLabelsPrintDocument(design, cardsHtml, { thermalRoll: true })
}
