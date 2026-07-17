'use client'

import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'

function barcodeFormat(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 13) return { format: 'EAN13' as const, value: digits }
  if (digits.length === 8) return { format: 'EAN8' as const, value: digits }
  if (/^\d+$/.test(digits) && digits.length >= 6) return { format: 'CODE128' as const, value: digits }
  return { format: 'CODE128' as const, value: value.trim() }
}

export default function LabelBarcode({
  value,
  height,
  color,
  showText,
  maxWidthPx,
}: {
  value: string
  height: number
  color?: string
  showText?: boolean
  /** Макс. ширина в px — штрихкод не растягивается на всю этикетку */
  maxWidthPx?: number
}) {
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !value.trim()) return
    const { format, value: code } = barcodeFormat(value)
    const opts = {
      format,
      height: Math.max(8, height),
      displayValue: !!showText,
      margin: 0,
      lineColor: color || '#111111',
      background: '#ffffff',
      fontSize: showText ? Math.max(9, Math.round(height * 0.28)) : 0,
      width: 1.4,
      textMargin: showText ? 1 : 0,
      flat: true,
    } as const
    try {
      JsBarcode(el, code, opts)
    } catch {
      try {
        JsBarcode(el, code, { ...opts, format: 'CODE128' })
      } catch {
        el.innerHTML = ''
      }
    }
    // Не растягивать SVG — только ужать если шире блока
    el.removeAttribute('width')
    el.style.maxWidth = maxWidthPx ? `${maxWidthPx}px` : '100%'
    el.style.width = 'auto'
    el.style.height = 'auto'
    el.style.display = 'block'
    el.style.margin = '0 auto'
  }, [value, height, color, showText, maxWidthPx])

  if (!value.trim()) {
    return (
      <div style={{ fontSize: 10, color: '#999', padding: '4px 0', textAlign: 'center' }}>
        Нет штрихкода
      </div>
    )
  }

  return (
    <div style={{
      width: '100%',
      maxWidth: maxWidthPx ? `${maxWidthPx}px` : '100%',
      overflow: 'hidden',
      margin: 0,
      display: 'flex',
      justifyContent: 'center',
    }}>
      <svg ref={ref} />
    </div>
  )
}
