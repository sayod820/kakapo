'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Product } from '@/lib/types'
import { filterProductsBySearch, pickProductBySearch, productBarcodes } from '@/lib/productBarcodes'
import MobileBarcodeScanner from '@/components/shared/MobileBarcodeScanner'
import { fmtMoney, formatQty, productUnitLabel } from './warehouseShared'

function productDetailChips(p: Product) {
  const unit = productUnitLabel(p.unit)
  const stock = Number(p.stock) || 0
  const codes = productBarcodes(p)
  const price = Number(p.price) || 0
  const cost = p.costPrice != null ? Number(p.costPrice) : null
  const grams = Number(p.unitGrams) || 0
  const chips: { label: string; value: string; accent?: 'green' | 'muted' }[] = []

  chips.push({ label: 'Продажа', value: price > 0 ? `${fmtMoney(price)}` : '—', accent: 'green' })
  if (cost != null && cost > 0) chips.push({ label: 'Закуп', value: fmtMoney(cost) })
  chips.push({ label: 'Остаток', value: `${formatQty(stock)} ${unit}` })
  chips.push({ label: 'Ед.', value: unit })

  if (grams > 0) {
    chips.push({
      label: 'Вес',
      value: grams >= 1000 ? `${formatQty(grams / 1000)} кг` : `${formatQty(grams)} г`,
    })
  }
  if (p.plu) chips.push({ label: 'PLU', value: String(p.plu) })
  if (p.art) chips.push({ label: 'Артикул', value: p.art })
  if (codes.length) chips.push({ label: codes.length > 1 ? 'Штрихкоды' : 'Штрихкод', value: codes.join(', ') })
  if (p.cat) chips.push({ label: 'Категория', value: p.cat, accent: 'muted' })
  if (p.brand) chips.push({ label: 'Бренд', value: p.brand, accent: 'muted' })
  if (p.country) chips.push({ label: 'Страна', value: p.country, accent: 'muted' })
  if (p.sellType === 'weight') chips.push({ label: 'Тип', value: 'Развес' })
  else if (p.sellType === 'piece') chips.push({ label: 'Тип', value: 'Штучный' })
  if (p.minWeight) chips.push({ label: 'Мин. вес', value: `${formatQty(p.minWeight)} г` })
  if (p.weightStep) chips.push({ label: 'Шаг', value: `${formatQty(p.weightStep)} г` })

  return chips
}

export default function WarehouseProductSelect({
  products,
  value,
  onChange,
  onCreateNew,
  placeholder = 'Поиск: штрихкод, название, артикул…',
  autoFocus = false,
  variant = 'dropdown',
}: {
  products: Product[]
  value: number | null
  onChange: (product: Product | null) => void
  onCreateNew?: (query: string, meta?: { barcode?: string }) => void
  placeholder?: string
  autoFocus?: boolean
  /** panel — большой список с полными данными (окно поиска прихода) */
  variant?: 'dropdown' | 'panel'
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(variant === 'panel')
  const [scanOpen, setScanOpen] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const selected = products.find(p => p.id === value) || null
  const isPanel = variant === 'panel'

  useEffect(() => {
    if (!autoFocus) return
    const t = window.setTimeout(() => {
      inputRef.current?.focus()
      setOpen(true)
    }, 50)
    return () => window.clearTimeout(t)
  }, [autoFocus])

  const options = useMemo(
    () => filterProductsBySearch(products, q || (isPanel ? '' : (selected?.name || '')), isPanel ? 80 : 30),
    [products, q, selected?.name, isPanel],
  )
  const canCreate = onCreateNew && q.trim().length >= 2 && !options.some(p => p.name.toLowerCase() === q.trim().toLowerCase())
  const showList = isPanel || (open && (options.length > 0 || !!canCreate))

  useEffect(() => {
    if (!open || !q.trim() || isPanel) return
    const exact = pickProductBySearch(products, q)
    if (exact && productBarcodes(exact).some(c => c === q.trim())) {
      onChange(exact)
      setQ('')
      setOpen(false)
      setScanMsg('')
    }
  }, [q, open, products, onChange, isPanel])

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

  return (
    <div className={isPanel ? 'k-prod-pick k-prod-pick-panel' : 'k-prod-pick'} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <input
          ref={inputRef}
          className="k-inp"
          style={{ flex: 1, minWidth: 0 }}
          value={(!isPanel && !open && selected) ? `${selected.e || '📦'} ${selected.name}` : q}
          placeholder={placeholder}
          onChange={e => { setQ(e.target.value); setOpen(true); setScanMsg('') }}
          onFocus={() => setOpen(true)}
          onBlur={() => { if (!isPanel) setTimeout(() => setOpen(false), 180) }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              tryPick()
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
      {showList && (
        <div className={isPanel ? 'k-prod-pick-list-panel' : 'k-prod-pick-list'}>
          {isPanel && !q.trim() && (
            <div className="k-prod-pick-hint">Начните ввод или выберите из списка · 📷 сканер камеры</div>
          )}
          {isPanel && q.trim() && !options.length && !canCreate && (
            <div className="k-prod-pick-hint">Ничего не найдено</div>
          )}
          {options.map(p => {
            const chips = productDetailChips(p)
            if (isPanel) {
              return (
                <button
                  key={p.id}
                  type="button"
                  className="k-prod-pick-card"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => selectProduct(p)}
                >
                  <div className="k-prod-pick-card-top">
                    <span className="emo">{p.e || '📦'}</span>
                    <div className="txt">
                      <b>{p.name}</b>
                      <span>
                        {[
                          p.id ? `#${p.id}` : '',
                          p.art || '',
                          productBarcodes(p)[0] || '',
                          p.plu ? `PLU ${p.plu}` : '',
                        ].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                    <div className="price">
                      <strong>{Number(p.price) > 0 ? fmtMoney(Number(p.price)) : '—'}</strong>
                      <small>продажа</small>
                    </div>
                  </div>
                  <div className="k-prod-pick-card-meta">
                    {chips.map(c => (
                      <div key={c.label} className={c.accent === 'green' ? 'green' : undefined}>
                        <span className="l">{c.label}</span>
                        <span className="v">{c.value}</span>
                      </div>
                    ))}
                  </div>
                </button>
              )
            }
            const unit = productUnitLabel(p.unit)
            const stock = Number(p.stock) || 0
            const codes = productBarcodes(p)
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
                    {[p.art, codes[0], p.plu ? `PLU ${p.plu}` : '', Number(p.price) > 0 ? fmtMoney(Number(p.price)) : ''].filter(Boolean).join(' · ')}
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
              className={isPanel ? 'k-prod-pick-create' : undefined}
              style={isPanel ? undefined : {
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                border: 'none', borderTop: options.length ? '1px solid var(--border)' : 'none',
                background: 'var(--green-d)', color: 'var(--green)',
                padding: '10px 10px', cursor: 'pointer', textAlign: 'left', fontSize: 13, fontWeight: 800,
              }}
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                const code = q.trim()
                const asBarcode = /^\d{8,}$/.test(code)
                onCreateNew(asBarcode ? '' : code, asBarcode ? { barcode: code } : undefined)
                setOpen(false)
              }}
            >
              + Создать товар «{q.trim()}»
            </button>
          )}
        </div>
      )}

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
