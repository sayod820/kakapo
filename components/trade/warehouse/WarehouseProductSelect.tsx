'use client'

import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { Product } from '@/lib/types'
import { pickProductBySearch, productBarcodes } from '@/lib/productBarcodes'
import {
  buildProductCodeIndex,
  filterProductsByQuery,
  lookupProductByCode,
} from '@/lib/productSearchIndex'
import { isTradeMobileUi } from '@/lib/tradeAndroid'
import MobileBarcodeScanner from '@/components/shared/MobileBarcodeScanner'
import { fmtMoney, formatQty, productUnitLabel } from './warehouseShared'
import TradeProductThumb from '@/components/trade/TradeProductThumb'

/** Не рисуем весь каталог — иначе «Найти товар» вешает UI */
const PANEL_PAGE = 50
const DROPDOWN_LIMIT = 30

function productDetailLine(p: Product) {
  const codes = productBarcodes(p)
  const parts = [
    codes[0] ? `ШК: ${codes[0]}${codes.length > 1 ? ` +${codes.length - 1}` : ''}` : '',
    p.plu ? `PLU ${p.plu}` : '',
    Number(p.unitGrams) > 0
      ? (Number(p.unitGrams) >= 1000
        ? `${formatQty(Number(p.unitGrams) / 1000)} кг`
        : `${formatQty(Number(p.unitGrams))} г`)
      : '',
  ].filter(Boolean)
  return parts.join(' · ')
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
  const [visibleCount, setVisibleCount] = useState(PANEL_PAGE)
  const inputRef = useRef<HTMLInputElement>(null)
  const selected = useMemo(() => products.find(p => p.id === value) || null, [products, value])
  const isPanel = variant === 'panel'
  const deferredQ = useDeferredValue(q)
  const codeIndex = useMemo(() => buildProductCodeIndex(products), [products])

  useEffect(() => {
    if (!autoFocus || isTradeMobileUi()) return
    const t = window.setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true })
      setOpen(true)
    }, 0)
    return () => window.clearTimeout(t)
  }, [autoFocus])

  useEffect(() => {
    setVisibleCount(PANEL_PAGE)
  }, [deferredQ, isPanel])

  const filtered = useMemo(() => {
    if (isPanel) {
      const qq = deferredQ.trim()
      // Пустой запрос — не монтируем тысячи строк (главный лаг «Найти товар»)
      if (!qq) return [] as Product[]
      return filterProductsByQuery(products, codeIndex, deferredQ)
    }
    const query = deferredQ || (selected?.name || '')
    if (!String(query).trim()) return products.slice(0, DROPDOWN_LIMIT)
    return filterProductsByQuery(products, codeIndex, query).slice(0, DROPDOWN_LIMIT)
  }, [products, codeIndex, deferredQ, selected?.name, isPanel])

  const options = isPanel ? filtered.slice(0, visibleCount) : filtered
  const hasMore = isPanel && filtered.length > visibleCount

  const canCreate = onCreateNew
    && q.trim().length >= 2
    && !filtered.some(p => p.name.toLowerCase() === q.trim().toLowerCase())
  const showList = isPanel || (open && (options.length > 0 || !!canCreate || !q.trim()))

  const commitPick = useCallback((p: Product) => {
    setQ('')
    setOpen(false)
    setScanMsg('')
    // Сначала закрываем тяжёлый список, выбор — в transition
    startTransition(() => onChange(p))
  }, [onChange])

  useEffect(() => {
    if (!open || !q.trim() || isPanel) return
    const exact = lookupProductByCode(codeIndex, q)
      || pickProductBySearch(products, q)
    if (exact && productBarcodes(exact).some(c => c === q.trim())) {
      commitPick(exact)
    }
  }, [q, open, products, codeIndex, isPanel, commitPick])

  function tryPick() {
    const best = lookupProductByCode(codeIndex, q) || pickProductBySearch(products, q)
    if (best) {
      commitPick(best)
      return true
    }
    return false
  }

  const onScanned = useCallback((code: string) => {
    const trimmed = code.trim()
    if (!trimmed) return
    setScanOpen(false)
    const exact = lookupProductByCode(codeIndex, trimmed) || pickProductBySearch(products, trimmed)
    const codesMatch = exact && productBarcodes(exact).some(c => {
      if (c === trimmed) return true
      const a = c.replace(/\D/g, '')
      const b = trimmed.replace(/\D/g, '')
      return a.length >= 8 && a === b
    })
    if (exact && codesMatch) {
      setScanMsg(`Найден: ${exact.name}`)
      commitPick(exact)
      return
    }
    setQ(trimmed)
    setOpen(true)
    setScanMsg(onCreateNew
      ? `Код ${trimmed} не найден — нажмите «Создать товар»`
      : `Код ${trimmed} не найден в каталоге`)
  }, [products, codeIndex, onCreateNew, commitPick])

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
          {isPanel ? (
            <>
              {!q.trim() && (
                <div className="k-prod-pick-hint">
                  Начните ввод названия, артикула или штрихкода
                  {products.length > 0 ? ` · в базе ${products.length}` : ''}
                </div>
              )}
              {q.trim() && !filtered.length && !canCreate && (
                <div className="k-prod-pick-hint">Ничего не найдено</div>
              )}
              {q.trim() && deferredQ !== q && (
                <div className="k-prod-pick-hint" style={{ opacity: 0.7 }}>Поиск…</div>
              )}
              {!!options.length && (
                <div className="k-prod-pick-tbl-wrap">
                  <table className="k-tbl k-tbl-compact k-prod-pick-tbl">
                    <thead>
                      <tr>
                        <th>Артикул</th>
                        <th>Товар</th>
                        <th>Категория</th>
                        <th className="num">Цена</th>
                        <th className="num">Себест.</th>
                        <th>Ед.</th>
                        <th className="num">Остаток</th>
                      </tr>
                    </thead>
                    <tbody>
                      {options.map(p => {
                        const unit = productUnitLabel(p.unit)
                        const stock = Number(p.stock) || 0
                        const detail = productDetailLine(p)
                        const weighted = p.sellType === 'weight' || /кг|г|л/i.test(unit)
                        return (
                          <tr
                            key={p.id}
                            className="k-prodrow"
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => commitPick(p)}
                          >
                            <td>
                              <span className="k-prod-pick-art">{p.art || p.id}</span>
                            </td>
                            <td>
                              <div className="k-prod-pick-name">
                                <TradeProductThumb product={p} size={28} radius={7} className="emo" />
                                <div>
                                  <b>{p.name}</b>
                                  {detail && <span>{detail}</span>}
                                </div>
                              </div>
                            </td>
                            <td>
                              <span className="k-badge k-badge-cat">{p.cat || '—'}</span>
                            </td>
                            <td className="num" style={{ color: 'var(--green)', fontWeight: 900 }}>
                              {Number(p.price) > 0 ? fmtMoney(Number(p.price)) : '—'}
                            </td>
                            <td className="num">
                              {p.costPrice != null && Number(p.costPrice) > 0 ? fmtMoney(Number(p.costPrice)) : '—'}
                            </td>
                            <td style={{ color: 'var(--muted)' }}>
                              {unit}{weighted ? ' ⚖️' : ''}
                            </td>
                            <td className="num" style={{ fontWeight: 800, color: stock > 0 ? 'var(--green)' : 'var(--red)' }}>
                              {formatQty(stock)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {hasMore && (
                    <button
                      type="button"
                      className="k-btn k-btn-s"
                      style={{ width: '100%', marginTop: 8, minHeight: 40 }}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => setVisibleCount(c => c + PANEL_PAGE)}
                    >
                      Ещё {Math.min(PANEL_PAGE, filtered.length - visibleCount)} из {filtered.length - visibleCount}
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            options.map(p => {
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
                  onClick={() => commitPick(p)}
                >
                  <TradeProductThumb product={p} size={28} radius={8} />
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
            })
          )}
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
                onCreateNew?.(asBarcode ? '' : code, asBarcode ? { barcode: code } : undefined)
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
