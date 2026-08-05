'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Product } from '@/lib/types'
import { filterProductsBySearch, pickProductBySearch, productBarcodes } from '@/lib/productBarcodes'
import MobileBarcodeScanner from '@/components/shared/MobileBarcodeScanner'
import { formatQty, productUnitLabel } from './warehouseShared'

export default function WarehouseProductSelect({
  products,
  value,
  onChange,
  onCreateNew,
  placeholder = 'Поиск: штрихкод, название, артикул…',
  autoFocus = false,
}: {
  products: Product[]
  value: number | null
  onChange: (product: Product | null) => void
  onCreateNew?: (query: string, meta?: { barcode?: string }) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const [menuBox, setMenuBox] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const selected = products.find(p => p.id === value) || null
  const options = useMemo(
    () => filterProductsBySearch(products, q || (open ? '' : selected?.name || ''), 30),
    [products, q, selected?.name, open],
  )
  const canCreate = !!(onCreateNew && q.trim().length >= 2 && !options.some(p => p.name.toLowerCase() === q.trim().toLowerCase()))
  const showMenu = open && (q.trim().length > 0 || options.length > 0 || canCreate)

  const updateMenuBox = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const gap = 4
    const spaceBelow = window.innerHeight - r.bottom - gap - 12
    const spaceAbove = r.top - gap - 12
    const preferBelow = spaceBelow >= 160 || spaceBelow >= spaceAbove
    const maxHeight = Math.max(140, Math.min(320, preferBelow ? spaceBelow : spaceAbove))
    const top = preferBelow ? r.bottom + gap : Math.max(8, r.top - gap - maxHeight)
    setMenuBox({
      top,
      left: r.left,
      width: Math.max(r.width, 240),
      maxHeight,
    })
  }, [])

  useLayoutEffect(() => {
    if (!showMenu) {
      setMenuBox(null)
      return
    }
    updateMenuBox()
    const onWin = () => updateMenuBox()
    window.addEventListener('resize', onWin)
    // scroll на любом предке (модалка прихода) — иначе список «пропадает»
    window.addEventListener('scroll', onWin, true)
    return () => {
      window.removeEventListener('resize', onWin)
      window.removeEventListener('scroll', onWin, true)
    }
  }, [showMenu, q, options.length, canCreate, updateMenuBox])

  useEffect(() => {
    if (!autoFocus) return
    const t = window.setTimeout(() => inputRef.current?.focus(), 60)
    return () => window.clearTimeout(t)
  }, [autoFocus])

  useEffect(() => {
    if (!open || !q.trim()) return
    const exact = pickProductBySearch(products, q)
    if (exact && productBarcodes(exact).some(c => c === q.trim())) {
      onChange(exact)
      setQ('')
      setOpen(false)
      setScanMsg('')
    }
  }, [q, open, products, onChange])

  function tryPick() {
    const best = pickProductBySearch(products, q)
    if (best) {
      onChange(best)
      setQ('')
      setOpen(false)
      setScanMsg('')
      return true
    }
    return false
  }

  function selectProduct(p: Product) {
    onChange(p)
    setQ('')
    setOpen(false)
    setScanMsg('')
  }

  const onScanned = useCallback((code: string) => {
    const trimmed = code.trim()
    if (!trimmed) return
    setScanOpen(false)
    const exact = pickProductBySearch(products, trimmed)
    const codesMatch = exact && productBarcodes(exact).some(c => {
      if (c === trimmed) return true
      const a = c.replace(/\D/g, '')
      const b = trimmed.replace(/\D/g, '')
      return a.length >= 8 && a === b
    })
    if (exact && codesMatch) {
      onChange(exact)
      setQ('')
      setOpen(false)
      setScanMsg(`Найден: ${exact.name}`)
      return
    }
    setQ(trimmed)
    setOpen(true)
    setScanMsg(onCreateNew
      ? `Код ${trimmed} не найден — нажмите «Создать товар»`
      : `Код ${trimmed} не найден в каталоге`)
  }, [products, onCreateNew, onChange])

  const menu = showMenu && menuBox && typeof document !== 'undefined'
    ? createPortal(
      <div
        style={{
          position: 'fixed',
          top: menuBox.top,
          left: menuBox.left,
          width: menuBox.width,
          zIndex: 4000,
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          maxHeight: menuBox.maxHeight,
          overflow: 'auto',
          boxShadow: '0 12px 32px rgba(0,0,0,.45)',
        }}
        onMouseDown={e => e.preventDefault()}
      >
        {options.map(p => {
          const codes = productBarcodes(p)
          const unit = productUnitLabel(p.unit)
          const stock = Number(p.stock) || 0
          return (
            <button
              key={p.id}
              type="button"
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                border: 'none', background: 'transparent', color: 'var(--text)',
                padding: '9px 10px', cursor: 'pointer', textAlign: 'left', fontSize: 13,
              }}
              onMouseDown={e => e.preventDefault()}
              onClick={() => selectProduct(p)}
            >
              <span>{p.e || '📦'}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700 }}>
                  {p.name}
                </span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[p.art, codes[0], p.plu ? `PLU ${p.plu}` : ''].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span style={{
                flexShrink: 0, textAlign: 'right', minWidth: 72,
                display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2,
              }}>
                <span style={{
                  fontSize: 12, fontWeight: 900, color: 'var(--green)',
                  background: 'var(--green-d)', border: '1px solid var(--green)',
                  borderRadius: 6, padding: '2px 7px', lineHeight: 1.3,
                }}>
                  {unit}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>
                  {formatQty(stock)} {unit}
                </span>
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>на складе</span>
              </span>
            </button>
          )
        })}
        {canCreate && (
          <button
            type="button"
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              border: 'none', borderTop: options.length ? '1px solid var(--border)' : 'none',
              background: 'var(--green-d)', color: 'var(--green)',
              padding: '10px 10px', cursor: 'pointer', textAlign: 'left', fontSize: 13, fontWeight: 800,
            }}
            onMouseDown={e => e.preventDefault()}
            onClick={() => {
              const code = q.trim()
              const asBarcode = /^\d{8,}$/.test(code)
              onCreateNew?.(asBarcode ? '' : code, asBarcode ? { barcode: code } : undefined)
              setOpen(false)
            }}
          >
            + Создать товар «{q.trim()}»
          </button>
        )}
        {!options.length && !canCreate && q.trim() && (
          <div style={{ padding: '12px 10px', fontSize: 13, color: 'var(--muted)', fontWeight: 700 }}>
            Ничего не найдено
          </div>
        )}
      </div>,
      document.body,
    )
    : null

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <input
          ref={inputRef}
          className="k-inp"
          style={{ flex: 1, minWidth: 0 }}
          value={open ? q : (selected ? `${selected.e || '📦'} ${selected.name}` : q)}
          placeholder={placeholder}
          onChange={e => { setQ(e.target.value); setOpen(true); setScanMsg('') }}
          onFocus={() => { setOpen(true); requestAnimationFrame(updateMenuBox) }}
          onBlur={() => setTimeout(() => setOpen(false), 180)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              tryPick()
            }
            if (e.key === 'Escape') {
              setOpen(false)
              setQ('')
            }
          }}
        />
        <button
          type="button"
          className="k-btn k-btn-s k-cam-scan-btn"
          title="Сканер камеры"
          aria-label="Сканер камеры"
          onMouseDown={e => e.preventDefault()}
          onClick={() => { setScanOpen(true); setScanMsg('') }}
          style={{
            flexShrink: 0, minWidth: 48, minHeight: 44, padding: '0 12px',
            fontSize: 20, lineHeight: 1,
          }}
        >
          📷
        </button>
      </div>
      {scanMsg && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, fontWeight: 700 }}>
          {scanMsg}
        </div>
      )}
      {menu}

      <MobileBarcodeScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onDetect={onScanned}
        title="Сканер · поиск товара"
        hint="Наведите на штрихкод — товар найдётся сам"
      />
    </div>
  )
}
