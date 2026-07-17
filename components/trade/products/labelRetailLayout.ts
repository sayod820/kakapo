import type { CSSProperties } from 'react'
import {
  getLabelElements,
  type LabelDesign,
  type LabelEdit,
  type LabelElement,
} from './labelShared'

export function mmToLabelPx(mm: number) {
  return Math.max(1, Math.round((Number(mm) * 203) / 25.4))
}

export function labelPriceAmount(price: string | number) {
  return (Number(price) || 0).toFixed(2)
}

export function retailLabelName(edit: LabelEdit) {
  return String(edit.name || '').trim().toLocaleUpperCase('ru-RU')
}

export function retailShowPlu(edit: LabelEdit) {
  // Есть номер PLU — печатаем/показываем (галочка showPlu=false только явное скрытие в старых правках игнорируем, если plu есть)
  return !!String(edit.plu || '').trim()
}

export function retailShowBarcode(edit: LabelEdit) {
  return edit.showBarcode !== false && !!String(edit.barcode || '').trim()
}

export function retailShowSize(edit: LabelEdit) {
  return !!String(edit.size || '').trim()
}

/** В редакторе: только флаг visible из макета (не скрывать из-за пустых данных) */
export function isElementShownForDesign(el: LabelElement): boolean {
  return el.visible
}

export function barcodeHeightsInBox(boxHeightPx: number, showDigits: boolean) {
  const digitReserve = showDigits ? Math.max(12, Math.round(boxHeightPx * 0.32)) : 0
  return {
    barHeight: Math.max(8, boxHeightPx - digitReserve),
    showDigits,
  }
}

export function elementBoxStyle(el: LabelElement, scale = 1): CSSProperties {
  return {
    position: 'absolute',
    left: `${el.x * scale}mm`,
    top: `${el.y * scale}mm`,
    width: `${el.w * scale}mm`,
    height: `${el.h * scale}mm`,
    boxSizing: 'border-box',
    overflow: 'hidden',
    textAlign: el.align,
    display: 'flex',
    flexDirection: 'column',
    alignItems: el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center',
    justifyContent: el.id === 'price' || el.id === 'barcode' ? 'flex-end' : 'flex-start',
  }
}

export function isElementShown(el: LabelElement, edit: LabelEdit): boolean {
  if (!el.visible) return false
  if (el.id === 'name') return !!String(edit.name || '').trim()
  if (el.id === 'size') return retailShowSize(edit)
  if (el.id === 'plu') return retailShowPlu(edit)
  if (el.id === 'barcode') return retailShowBarcode(edit)
  return true
}

export function retailCanvasStyle(design: LabelDesign, scale = 1): CSSProperties {
  return {
    position: 'relative',
    width: `${design.labelWidthMm * scale}mm`,
    height: `${design.labelHeightMm * scale}mm`,
    background: '#fff',
    color: '#000',
    overflow: 'hidden',
    boxSizing: 'border-box',
    fontFamily: 'Arial, Helvetica, sans-serif',
  }
}

export function elementsForDesign(design: LabelDesign): LabelElement[] {
  return getLabelElements(design)
}
