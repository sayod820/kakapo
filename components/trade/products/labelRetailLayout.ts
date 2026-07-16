import type { CSSProperties } from 'react'
import type { LabelDesign, LabelEdit } from './labelShared'

/** Макет как на фото: название → вес → цена → PLU → мелкий штрихкод */
export const RETAIL_LAYOUT = {
  nameMm: 2.8,
  sizeMm: 2.2,
  priceMm: 10,
  currencyMm: 2.6,
  pluMm: 2.2,
  /** Мелкий штрихкод внизу (~3.2 мм) */
  barcodeHeightMm: 3.2,
  barcodeWidthPct: 72,
  paddingMm: 1.2,
  rulePx: 1.5,
} as const

export function mmToLabelPx(mm: number) {
  return Math.round((mm * 203) / 25.4)
}

export function labelPriceAmount(price: string | number) {
  return (Number(price) || 0).toFixed(2)
}

export function retailDividerStyle(design: LabelDesign): CSSProperties {
  return {
    border: 'none',
    borderTop: `${RETAIL_LAYOUT.rulePx}px solid #000`,
    margin: '2px 0',
    width: '100%',
    flexShrink: 0,
  }
}

export function retailCardStyle(design: LabelDesign): CSSProperties {
  const pad = Math.max(design.padding, mmToLabelPx(RETAIL_LAYOUT.paddingMm) / 3.5)
  return {
    background: '#fff',
    color: '#000',
    border: 'none',
    borderRadius: 0,
    padding: `${pad}px ${pad + 2}px ${pad}px`,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    height: '100%',
    overflow: 'hidden',
    boxSizing: 'border-box',
    fontFamily: 'Arial, Helvetica, sans-serif',
    textAlign: 'center',
  }
}

export function retailNameStyle(): CSSProperties {
  return {
    fontSize: `${RETAIL_LAYOUT.nameMm}mm`,
    fontWeight: 800,
    lineHeight: 1.1,
    letterSpacing: '0.03em',
    textTransform: 'uppercase',
    width: '100%',
    flexShrink: 0,
    color: '#000',
  }
}

export function retailPriceRowStyle(): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: '0.6mm',
    flex: '1 1 auto',
    minHeight: 0,
    width: '100%',
    padding: '1px 0',
  }
}

export function retailAmountStyle(): CSSProperties {
  return {
    fontSize: `${RETAIL_LAYOUT.priceMm}mm`,
    fontWeight: 900,
    lineHeight: 0.92,
    letterSpacing: '-0.02em',
    color: '#000',
  }
}

export function retailCurrencyStyle(): CSSProperties {
  return {
    fontSize: `${RETAIL_LAYOUT.currencyMm}mm`,
    fontWeight: 700,
    lineHeight: 1,
    paddingBottom: '0.8mm',
    color: '#000',
  }
}

export function retailPluStyle(): CSSProperties {
  return {
    fontSize: `${RETAIL_LAYOUT.pluMm}mm`,
    fontWeight: 700,
    lineHeight: 1.15,
    marginBottom: '0.5mm',
    flexShrink: 0,
    color: '#000',
  }
}

export function retailSizeStyle(): CSSProperties {
  return {
    fontSize: `${RETAIL_LAYOUT.sizeMm}mm`,
    fontWeight: 600,
    lineHeight: 1.15,
    marginTop: '0.3mm',
    marginBottom: '0.2mm',
    flexShrink: 0,
    color: '#000',
  }
}

export function retailBarcodeWrapStyle(): CSSProperties {
  return {
    width: `${RETAIL_LAYOUT.barcodeWidthPct}%`,
    maxWidth: `${RETAIL_LAYOUT.barcodeWidthPct}%`,
    flexShrink: 0,
    display: 'flex',
    justifyContent: 'center',
    marginTop: 'auto',
    paddingTop: '0.4mm',
  }
}

export function retailLabelName(edit: LabelEdit) {
  return String(edit.name || '').trim().toLocaleUpperCase('ru-RU')
}

export function retailShowPlu(edit: LabelEdit) {
  return edit.showPlu && !!String(edit.plu || '').trim()
}

export function retailShowBarcode(edit: LabelEdit) {
  return edit.showBarcode && !!String(edit.barcode || '').trim()
}

export function retailShowSize(edit: LabelEdit) {
  return !!String(edit.size || '').trim()
}

export function retailBarcodeHeightPx() {
  return mmToLabelPx(RETAIL_LAYOUT.barcodeHeightMm)
}
