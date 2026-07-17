'use client'

import JsBarcode from 'jsbarcode'
import {
  isElementShown,
  labelPriceAmount,
  mmToLabelPx,
  retailLabelName,
} from './labelRetailLayout'
import {
  getLabelElements,
  type LabelBlockId,
  type LabelDesign,
  type LabelEdit,
  type LabelElement,
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

/** Штрихкод строго в ширину блока (не на всю этикетку) */
export function barcodeToSvgHtml(
  value: string,
  heightPx: number,
  showDigits: boolean,
  maxWidthPx?: number,
): string {
  const code = value.trim()
  if (!code || typeof document === 'undefined') return ''

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const { format, value: normalized } = barcodeFormat(code)
  const digitFont = showDigits ? Math.max(9, Math.min(14, Math.round(heightPx * 0.22))) : 0
  const opts = {
    format,
    height: Math.max(8, heightPx),
    displayValue: showDigits,
    margin: 0,
    lineColor: '#000000',
    background: '#ffffff',
    fontSize: digitFont,
    width: 1.4,
    textMargin: showDigits ? 1 : 0,
    flat: true,
  } as const

  try {
    JsBarcode(svg, normalized, opts)
  } catch {
    try {
      JsBarcode(svg, normalized, { ...opts, format: 'CODE128' })
    } catch {
      return ''
    }
  }

  const boxW = Math.max(24, maxWidthPx || 0)
  if (boxW > 0) {
    svg.setAttribute('width', String(boxW))
    svg.setAttribute('style', `width:${boxW}px;max-width:${boxW}px;height:auto;display:block;margin:0 auto`)
  } else {
    svg.setAttribute('style', 'width:100%;max-width:100%;height:auto;display:block;margin:0 auto')
  }
  return svg.outerHTML
}

function absStyle(el: LabelElement) {
  const x = mmToLabelPx(el.x)
  const y = mmToLabelPx(el.y)
  const w = mmToLabelPx(el.w)
  const h = mmToLabelPx(el.h)
  const alignItems = el.id === 'price' ? 'flex-end' : el.id === 'barcode' ? 'flex-end' : 'flex-start'
  const justify = el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center'
  // Важно: width/height только здесь — не переопределять width:100% (ломает рамку штрихкода)
  return `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;overflow:hidden;box-sizing:border-box;text-align:${el.align};display:flex;flex-direction:column;align-items:${justify};justify-content:${alignItems}`
}

function fontPx(mm: number) {
  return Math.max(10, mmToLabelPx(mm))
}

function renderAbsElement(el: LabelElement, edit: LabelEdit, design: LabelDesign): string {
  if (!isElementShown(el, edit)) return ''

  if (el.id === 'line1' || el.id === 'line2') {
    return `<div class="k-label-abs" style="${absStyle(el)}"><div style="width:100%;height:${Math.max(2, mmToLabelPx(0.35))}px;background:#000"></div></div>`
  }
  if (el.id === 'name') {
    return `<div class="k-label-abs" style="${absStyle(el)}"><div style="width:100%;font-size:${fontPx(el.fontSizeMm)}px;font-weight:800;line-height:1.05;letter-spacing:0.02em;text-transform:uppercase">${escHtml(retailLabelName(edit))}</div></div>`
  }
  if (el.id === 'size') {
    return `<div class="k-label-abs" style="${absStyle(el)}"><div style="width:100%;font-size:${fontPx(el.fontSizeMm)}px;font-weight:700;line-height:1.1">${escHtml(edit.size)}</div></div>`
  }
  if (el.id === 'price') {
    const cur = Math.max(10, Math.round(fontPx(el.fontSizeMm) * 0.28))
    const gap = mmToLabelPx(0.5)
    const pad = mmToLabelPx(0.6)
    const justify = el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center'
    return `<div class="k-label-abs" style="${absStyle(el)}">
      <div style="display:flex;align-items:flex-end;justify-content:${justify};gap:${gap}px;width:100%">
        <span style="font-size:${fontPx(el.fontSizeMm)}px;font-weight:900;line-height:0.92;letter-spacing:-0.02em">${escHtml(labelPriceAmount(edit.price))}</span>
        <span style="font-size:${cur}px;font-weight:700;line-height:1;padding-bottom:${pad}px">сом</span>
      </div>
    </div>`
  }
  if (el.id === 'plu') {
    return `<div class="k-label-abs" style="${absStyle(el)}"><div style="width:100%;font-size:${fontPx(el.fontSizeMm)}px;font-weight:700;line-height:1.1">PLU ${escHtml(edit.plu)}</div></div>`
  }
  if (el.id === 'barcode') {
    const showDigits = design.barcodeShowDigits !== false
    const boxW = mmToLabelPx(el.w)
    const boxH = mmToLabelPx(el.h)
    const digitReserve = showDigits ? Math.max(12, Math.round(boxH * 0.32)) : 0
    const hPx = Math.max(8, boxH - digitReserve)
    const svg = barcodeToSvgHtml(edit.barcode, hPx, showDigits, boxW)
    if (!svg) return ''
    return `<div class="k-label-abs" style="${absStyle(el)}"><div style="width:100%;max-width:100%;overflow:hidden">${svg}</div></div>`
  }
  return ''
}

function buildRetailLabelCardHtml(edit: LabelEdit, design: LabelDesign): string {
  const w = mmToLabelPx(design.labelWidthMm)
  const h = mmToLabelPx(design.labelHeightMm)
  // Печать: PLU и размер всегда, если есть текст (не зависеть от showPlu в карточке товара)
  const printEdit: LabelEdit = {
    ...edit,
    showPlu: !!(edit.showPlu || String(edit.plu || '').trim()),
    showBarcode: !!(edit.showBarcode || String(edit.barcode || '').trim()),
    size: String(edit.size || '').trim() || edit.size,
  }
  const parts = getLabelElements(design).map(el => renderAbsElement(el, printEdit, design)).join('')
  return `<div class="k-label-card" style="position:relative;width:${w}px;height:${h}px;min-height:${h}px;max-height:${h}px;overflow:hidden;background:#fff;color:#000;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif">${parts}</div>`
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

function buildClassicLabelCardHtml(edit: LabelEdit, design: LabelDesign): string {
  const barcodeSvg = edit.showBarcode && edit.barcode.trim()
    ? barcodeToSvgHtml(edit.barcode, design.barcodeHeight, design.barcodeShowDigits)
    : ''

  const blocks = design.blocks
    .map(b => renderBlockHtml(b.id, edit, design, barcodeSvg))
    .filter(Boolean)
    .join('')

  return `<div class="k-label-card" style="background:#fff;color:#000;border:none;border-radius:0;padding:${Math.max(design.padding, 4)}px;display:flex;flex-direction:column;justify-content:flex-start;gap:2px;overflow:hidden;box-sizing:border-box;height:100%">${blocks}</div>`
}

export function buildLabelCardPrintHtml(edit: LabelEdit, design: LabelDesign): string {
  if (design.layout !== 'blocks') return buildRetailLabelCardHtml(edit, design)
  return buildClassicLabelCardHtml(edit, design)
}

/** Один HTML-документ = одна этикетка (для TSPL / XP-235B) */
export function buildSingleLabelThermalDocument(edit: LabelEdit, design: LabelDesign): string {
  const fixed: LabelDesign = {
    ...design,
    layout: design.layout === 'blocks' ? 'blocks' : 'retail',
    labelWidthMm: 58,
    labelHeightMm: 40,
    paperWidthMm: 58,
    barcodeShowDigits: design.barcodeShowDigits !== false,
    elements: getLabelElements(design),
  }
  return buildLabelsPrintDocument(fixed, buildLabelCardPrintHtml(edit, fixed), { thermalRoll: true })
}

export function buildLabelsThermalPrintDocument(edits: LabelEdit[], design: LabelDesign): string {
  const fixed: LabelDesign = {
    ...design,
    layout: design.layout === 'blocks' ? 'blocks' : 'retail',
    labelWidthMm: 58,
    labelHeightMm: 40,
    paperWidthMm: 58,
    barcodeShowDigits: design.barcodeShowDigits !== false,
    elements: getLabelElements(design),
  }
  const cardsHtml = edits.map(edit => buildLabelCardPrintHtml(edit, fixed)).join('')
  return buildLabelsPrintDocument(fixed, cardsHtml, { thermalRoll: true })
}
