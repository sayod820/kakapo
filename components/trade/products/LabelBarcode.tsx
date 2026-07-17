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

/** Оценка числа модулей — чтобы ширина полос росла вместе с блоком */
function approxModules(format: string, code: string) {
  if (format === 'EAN13') return 95
  if (format === 'EAN8') return 67
  return Math.max(40, code.length * 11 + 20)
}

export default function LabelBarcode({
  value,
  height,
  color,
  showText,
  maxWidthPx,
}: {
  value: string
  /** Высота полос (без цифр), px */
  height: number
  color?: string
  showText?: boolean
  /** Ширина блока — штрихкод заполняет её и растёт при ресайзе */
  maxWidthPx?: number
}) {
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !value.trim()) return
    const { format, value: code } = barcodeFormat(value)
    const boxW = Math.max(40, maxWidthPx || 120)
    const barH = Math.max(12, Math.round(height))
    const modules = approxModules(format, code)
    // Ширина одной полосы: чем шире блок — тем толще штрихи
    const moduleW = Math.max(1, Math.min(3.2, boxW / modules))
    const fontSize = showText
      ? Math.max(10, Math.min(22, Math.round(barH * 0.42)))
      : 0

    const opts = {
      format,
      height: barH,
      displayValue: !!showText,
      margin: 0,
      lineColor: color || '#111111',
      background: '#ffffff',
      fontSize,
      width: moduleW,
      textMargin: showText ? 2 : 0,
      flat: true,
    } as const

    try {
      JsBarcode(el, code, opts)
    } catch {
      try {
        JsBarcode(el, code, { ...opts, format: 'CODE128' })
      } catch {
        el.innerHTML = ''
        return
      }
    }

    // Заполняем ширину блока — при увеличении блока штрихкод растёт
    el.setAttribute('width', String(boxW))
    el.removeAttribute('height')
    el.style.width = '100%'
    el.style.maxWidth = '100%'
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
      overflow: 'visible',
      margin: 0,
      lineHeight: 0,
    }}>
      <svg ref={ref} style={{ width: '100%', height: 'auto', display: 'block' }} />
    </div>
  )
}
