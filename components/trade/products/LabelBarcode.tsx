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
}: {
  value: string
  height: number
  color?: string
  showText?: boolean
}) {
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !value.trim()) return
    const { format, value: code } = barcodeFormat(value)
    try {
      JsBarcode(el, code, {
        format,
        height,
        displayValue: !!showText,
        margin: 0,
        lineColor: color || '#111111',
        background: '#ffffff',
        fontSize: showText ? Math.max(10, Math.round(height * 0.28)) : 0,
        width: 1.5,
        textMargin: showText ? 2 : 0,
        flat: true,
      })
    } catch {
      try {
        JsBarcode(el, code, {
          format: 'CODE128',
          height,
          displayValue: !!showText,
          margin: 0,
          lineColor: color || '#111111',
          background: '#ffffff',
          fontSize: showText ? Math.max(10, Math.round(height * 0.28)) : 0,
          width: 1.5,
          textMargin: showText ? 2 : 0,
          flat: true,
        })
      } catch {
        el.innerHTML = ''
      }
    }
  }, [value, height, color, showText])

  if (!value.trim()) {
    return (
      <div style={{ fontSize: 10, color: '#999', padding: '4px 0', textAlign: 'center' }}>
        Нет штрихкода — добавьте в карточке товара
      </div>
    )
  }

  return (
    <div style={{ width: '100%', overflow: 'hidden', margin: 0 }}>
      <svg ref={ref} style={{ width: '100%', height: 'auto', display: 'block' }} />
    </div>
  )
}
