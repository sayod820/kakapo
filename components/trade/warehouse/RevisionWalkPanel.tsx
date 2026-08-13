'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { Category, Product } from '@/lib/types'
import { pickProductBySearch, productBarcodes } from '@/lib/productBarcodes'
import {
  buildProductCodeIndex,
  filterProductsByQuery,
  lookupProductByCode,
} from '@/lib/productSearchIndex'
import { categorySlug, productMatchesCategoryFilter } from '@/lib/useCategories'
import MobileBarcodeScanner from '@/components/shared/MobileBarcodeScanner'
import type { RevisionDraftLine } from './revisionDraftStorage'
import {
  fmtMoney,
  formatQty,
  isGramLabel,
  isKgLabel,
  packInputUnitLabel,
  packRealWorld,
  parsePackUnit,
  sanitizeDecimalInput,
} from './warehouseShared'

const PAGE = 50

type StockFlt = 'all' | 'in' | 'out'
type WalkTab = 'todo' | 'done'

function matchStock(p: Product, live: number, flt: StockFlt) {
  if (flt === 'in') return live > 0
  if (flt === 'out') return live <= 0
  return true
}

function formatDiff(diff: number) {
  const rounded = Math.round(diff * 1000) / 1000
  if (rounded === 0) return '0'
  return rounded > 0 ? `+${rounded}` : String(rounded)
}

function formatMoneyDiff(n: number) {
  if (n === 0) return fmtMoney(0)
  return `${n > 0 ? '+' : '−'}${fmtMoney(Math.abs(n))}`
}

function moneyBasisPrice(product: Product | undefined | null): number {
  if (!product) return 0
  const cost = Number(product.costPrice) || 0
  if (cost > 0) return cost
  return Number(product.price) || 0
}

function diffStyle(diff: number) {
  if (diff === 0) return { color: 'var(--muted)' }
  if (diff > 0) return { color: 'var(--green)' }
  return { color: 'var(--red)' }
}

export default function RevisionWalkPanel({
  products,
  categories,
  lines,
  stockOf,
  onUpsert,
  onRemove,
  onEditProduct,
  note,
  onNoteChange,
  onBack,
}: {
  products: Product[]
  categories: Category[]
  lines: RevisionDraftLine[]
  stockOf: (p: Product) => number
  onUpsert: (product: Product, countedStock: string) => void
  onRemove: (productId: number) => void
  onEditProduct: (productId: number) => void
  note: string
  onNoteChange: (v: string) => void
  onBack: () => void
}) {
  const [tab, setTab] = useState<WalkTab>('todo')
  const [q, setQ] = useState('')
  const [allCats, setAllCats] = useState(true)
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set())
  const [stockFlt, setStockFlt] = useState<StockFlt>('all')
  const [visibleCount, setVisibleCount] = useState(PAGE)
  const [scanOpen, setScanOpen] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const [onlyDiff, setOnlyDiff] = useState(false)
  const [sheet, setSheet] = useState<{ product: Product; counted: string; edit: boolean } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const factRef = useRef<HTMLInputElement>(null)
  const deferredQ = useDeferredValue(q)

  const doneById = useMemo(() => {
    const map = new Map<number, RevisionDraftLine>()
    for (const l of lines) {
      if (l.productId != null && l.countedStock !== '') map.set(l.productId, l)
    }
    return map
  }, [lines])

  const doneLines = useMemo(
    () => lines.filter(l => l.productId != null && l.countedStock !== ''),
    [lines],
  )

  const roots = useMemo(
    () => categories.filter(c => c.parent_id == null).sort((a, b) => (a.order || 0) - (b.order || 0)),
    [categories],
  )

  const codeIndex = useMemo(() => buildProductCodeIndex(products), [products])

  const inCat = useCallback((p: Product) => {
    if (allCats) return true
    if (!selectedCats.size) return false
    for (const slug of selectedCats) {
      if (productMatchesCategoryFilter(p.catId, slug, categories)) return true
    }
    return false
  }, [allCats, selectedCats, categories])

  const todoProducts = useMemo(() => {
    let list = products.filter(p => !doneById.has(p.id) && inCat(p) && matchStock(p, stockOf(p), stockFlt))
    const qq = deferredQ.trim()
    if (qq) list = filterProductsByQuery(list, codeIndex, qq)
    return list
  }, [products, doneById, inCat, stockFlt, stockOf, deferredQ, codeIndex])

  const doneVisible = useMemo(() => {
    let list = doneLines
    if (onlyDiff) {
      list = list.filter(l => {
        const p = products.find(x => x.id === l.productId)
        if (!p) return false
        const system = stockOf(p)
        return (Number(l.countedStock) || 0) !== system
      })
    }
    const qq = deferredQ.trim()
    if (!qq) return list
    return list.filter(l => {
      const p = products.find(x => x.id === l.productId)
      return p && filterProductsByQuery([p], codeIndex, qq).length > 0
    })
  }, [doneLines, onlyDiff, products, stockOf, deferredQ, codeIndex])

  useEffect(() => {
    setVisibleCount(PAGE)
  }, [deferredQ, allCats, selectedCats, stockFlt, tab])

  useEffect(() => {
    if (!sheet) {
      const t = window.setTimeout(() => searchRef.current?.focus({ preventScroll: true }), 40)
      return () => window.clearTimeout(t)
    }
    const t = window.setTimeout(() => {
      factRef.current?.focus({ preventScroll: true })
      factRef.current?.select()
    }, 40)
    return () => window.clearTimeout(t)
  }, [sheet])

  const openSheet = useCallback((product: Product, edit = false) => {
    const existing = doneById.get(product.id)
    const system = stockOf(product)
    setSheet({
      product,
      counted: existing?.countedStock ?? String(system),
      edit: edit || Boolean(existing),
    })
    setScanMsg('')
  }, [doneById, stockOf])

  const tryOpenFromQuery = useCallback((raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return false
    const exact = lookupProductByCode(codeIndex, trimmed) || pickProductBySearch(products, trimmed)
    const codesMatch = exact && (
      productBarcodes(exact).some(c => {
        if (c === trimmed) return true
        const a = c.replace(/\D/g, '')
        const b = trimmed.replace(/\D/g, '')
        return a.length >= 8 && a === b
      })
      || String(exact.art || '').toLowerCase() === trimmed.toLowerCase()
      || String(exact.plu || '') === trimmed
    )
    if (exact && codesMatch) {
      openSheet(exact, doneById.has(exact.id))
      setQ('')
      return true
    }
    return false
  }, [codeIndex, products, openSheet, doneById])

  useEffect(() => {
    if (tab !== 'todo' || !q.trim() || sheet) return
    tryOpenFromQuery(q)
  }, [q, tab, sheet, tryOpenFromQuery])

  const onScanned = useCallback((code: string) => {
    setScanOpen(false)
    const trimmed = code.trim()
    if (!trimmed) return
    if (tryOpenFromQuery(trimmed)) return
    setQ(trimmed)
    setTab('todo')
    setScanMsg(`Код ${trimmed} не найден`)
  }, [tryOpenFromQuery])

  function saveSheet() {
    if (!sheet) return
    const v = sanitizeDecimalInput(sheet.counted)
    if (v === '' || Number.isNaN(Number(v))) return
    onUpsert(sheet.product, v)
    setSheet(null)
    setQ('')
    setTab('done')
    window.setTimeout(() => {
      setTab('todo')
      searchRef.current?.focus({ preventScroll: true })
    }, 80)
  }

  const todoShown = todoProducts.slice(0, visibleCount)
  const doneCount = doneLines.length
  const todoCount = todoProducts.length
  const progressTotal = doneCount + todoCount
  const progressPct = progressTotal > 0 ? Math.round((doneCount / progressTotal) * 100) : 0

  const walkTotals = useMemo(() => {
    let matched = 0
    let netDiff = 0
    let costMoneyDiff = 0
    for (const l of doneLines) {
      const p = products.find(x => x.id === l.productId)
      if (!p) continue
      const system = stockOf(p)
      const counted = Number(l.countedStock) || 0
      const diff = counted - system
      netDiff += diff
      costMoneyDiff += diff * moneyBasisPrice(p)
      if (diff === 0) matched++
    }
    return { matched, netDiff, costMoneyDiff }
  }, [doneLines, products, stockOf])

  return (
    <div className="k-rev-walk">
      <div className="k-rev-walk-sticky">
        <div className="k-rev-note">
          <div className="k-rev-note-row">
            <input
              className="k-inp"
              value={note}
              onChange={e => onNoteChange(e.target.value)}
              placeholder="Комментарий…"
            />
            <button type="button" className="k-btn k-btn-s k-rev-walk-back" onClick={onBack}>
              <span className="k-rev-walk-back-full">← Режим</span>
              <span className="k-rev-walk-back-short">←</span>
            </button>
          </div>
        </div>

        <div className="k-rev-walk-prog">
          <div className="k-rev-walk-prog-bar">
            <i style={{ width: `${progressPct}%` }} />
          </div>
          <span>
            <b>{progressPct}%</b>
            <em> · {doneCount}{progressTotal ? `/${progressTotal}` : ''}</em>
          </span>
        </div>

        <div className="k-rev-walk-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className={`k-subtab${tab === 'todo' ? ' active' : ''}`}
            onClick={() => setTab('todo')}
          >
            Не сделано <b>{todoCount}</b>
          </button>
          <button
            type="button"
            role="tab"
            className={`k-subtab${tab === 'done' ? ' active' : ''}`}
            onClick={() => setTab('done')}
          >
            Сделано <b>{doneCount}</b>
          </button>
        </div>

        <div className="k-rev-walk-search">
          <input
            ref={searchRef}
            className="k-inp"
            value={q}
            onChange={e => { setQ(e.target.value); setScanMsg('') }}
            placeholder="Штрихкод, название, артикул…"
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (!tryOpenFromQuery(q) && tab === 'todo' && todoShown[0]) openSheet(todoShown[0])
              }
            }}
          />
          <button
            type="button"
            className="k-btn k-btn-s k-cam-scan-btn"
            title="Сканер камеры"
            aria-label="Сканер камеры"
            onClick={() => { setScanOpen(true); setScanMsg('') }}
          >
            📷
          </button>
        </div>
        {scanMsg && <div className="k-rev-walk-msg">{scanMsg}</div>}
      </div>

      {doneCount > 0 && (
        <div className="k-rev-walk-sum">
          <div><span>Поз.</span><b>{doneCount}</b></div>
          <div><span>ОК</span><b style={{ color: 'var(--green)' }}>{walkTotals.matched}</b></div>
          <div><span>Δ</span><b style={diffStyle(walkTotals.netDiff)}>{formatDiff(walkTotals.netDiff)}</b></div>
          <div><span>Σ</span><b style={diffStyle(walkTotals.costMoneyDiff)}>{formatMoneyDiff(walkTotals.costMoneyDiff)}</b></div>
        </div>
      )}

      {tab === 'todo' && (
        <div className="k-rev-walk-filters">
          <div className="k-rev-scope-lbl">Категории</div>
          <div className="k-cats k-cats-compact k-rev-cats">
            <button
              type="button"
              className={`k-cat ${allCats ? 'active' : ''}`}
              onClick={() => { setAllCats(true); setSelectedCats(new Set()) }}
            >
              <span className="ce">🏪</span>
              Все
            </button>
            {roots.map(c => {
              const slug = categorySlug(c)
              const active = !allCats && selectedCats.has(slug)
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`k-cat ${active ? 'active' : ''}`}
                  onClick={() => {
                    setAllCats(false)
                    setSelectedCats(prev => {
                      const next = new Set(prev)
                      if (next.has(slug)) next.delete(slug)
                      else next.add(slug)
                      return next
                    })
                  }}
                >
                  <span className="ce">{c.emoji || '📦'}</span>
                  {c.name.split(' ')[0]}
                  {active && <span className="cc">✓</span>}
                </button>
              )
            })}
          </div>
          <div className="k-rev-stock-flt">
            {([
              { id: 'all' as const, label: 'Все' },
              { id: 'in' as const, label: 'В наличии' },
              { id: 'out' as const, label: 'Нет' },
            ]).map(f => (
              <button
                key={f.id}
                type="button"
                className={`k-subtab${stockFlt === f.id ? ' active' : ''}`}
                onClick={() => setStockFlt(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'done' && doneCount > 0 && (
        <div className="k-rev-stock-flt">
          <button
            type="button"
            className={`k-subtab${onlyDiff ? ' active' : ''}`}
            onClick={() => setOnlyDiff(v => !v)}
          >
            Только расхождение
          </button>
        </div>
      )}

      <div className="k-rev-walk-list">
        {tab === 'todo' && todoShown.length === 0 && (
          <div className="k-rcpt-empty">
            {doneCount > 0 && todoCount === 0
              ? 'Всё посчитано по текущему фильтру'
              : deferredQ.trim()
                ? 'Ничего не найдено'
                : 'Нет товаров'}
          </div>
        )}
        {tab === 'todo' && todoShown.map(p => {
          const system = stockOf(p)
          return (
            <button
              key={p.id}
              type="button"
              className="k-rev-walk-row"
              onClick={() => openSheet(p)}
            >
              <span className="k-rev-walk-emo">{p.e || '📦'}</span>
              <span className="k-rev-walk-txt">
                <b>{p.name}</b>
                <small>{p.art || '—'} · система {formatQty(system)}</small>
              </span>
              <span className="k-rev-walk-go">→</span>
            </button>
          )
        })}
        {tab === 'todo' && todoProducts.length > visibleCount && (
          <button
            type="button"
            className="k-btn k-btn-s"
            style={{ width: '100%', marginTop: 6 }}
            onClick={() => setVisibleCount(c => c + PAGE)}
          >
            Ещё {todoProducts.length - visibleCount}
          </button>
        )}

        {tab === 'done' && doneVisible.length === 0 && (
          <div className="k-rcpt-empty">
            {doneCount === 0 ? 'Пока пусто — найдите товар и сохраните факт' : 'Нет расхождений'}
          </div>
        )}
        {tab === 'done' && doneVisible.map((line, idx) => {
          const p = products.find(x => x.id === line.productId)
          if (!p) return null
          const packInfo = parsePackUnit(p.unit)
          const unit = packInputUnitLabel(packInfo)
          const system = stockOf(p)
          const counted = Number(line.countedStock) || 0
          const diff = counted - system
          const costPrice = Number(p.costPrice) || 0
          const basisPrice = moneyBasisPrice(p)
          const costDiff = basisPrice > 0 ? diff * basisPrice : null
          const diffReal = packRealWorld(diff, packInfo)
          return (
            <div key={line.key} className={`k-rev-walk-done${diff !== 0 ? (diff > 0 ? ' up' : ' down') : ''}`}>
              <button type="button" className="k-rev-walk-row" onClick={() => openSheet(p, true)}>
                <span className="k-rev-line-n">{idx + 1}</span>
                <span className="k-rev-walk-emo">{p.e || '📦'}</span>
                <span className="k-rev-walk-txt">
                  <b>{p.name}</b>
                  <small>
                    {formatQty(system)}→{formatQty(counted)} {unit}
                    {' · '}
                    <span style={diffStyle(diff)}>{diff === 0 ? 'OK' : `${formatDiff(diff)} ${unit}`}</span>
                    {diff !== 0 && diffReal && (
                      <> · <span style={diffStyle(diffReal.value)}>{formatDiff(diffReal.value)} {diffReal.label}</span></>
                    )}
                    {diff !== 0 && costDiff != null && (
                      <> · <span style={diffStyle(costDiff)}>{formatMoneyDiff(costDiff)}{costPrice <= 0 ? ' · розн.' : ''}</span></>
                    )}
                  </small>
                </span>
              </button>
              <div className="k-rev-walk-done-btns">
                <button type="button" className="k-btn k-btn-s" title="Редактор товара" onClick={() => onEditProduct(p.id)}>✎</button>
                <button type="button" className="k-btn k-btn-s k-rev-x" title="Убрать из сделанных" onClick={() => onRemove(p.id)}>✕</button>
              </div>
            </div>
          )
        })}
      </div>

      {sheet && (() => {
        const p = sheet.product
        const packInfo = parsePackUnit(p.unit)
        const isWeight = p.sellType === 'weight' || isGramLabel(packInfo.label) || isKgLabel(packInfo.label)
        const unit = packInputUnitLabel(packInfo)
        const system = stockOf(p)
        const counted = sheet.counted !== '' ? Number(sheet.counted) : null
        const diff = counted != null ? counted - system : null
        const systemReal = packRealWorld(system, packInfo)
        const diffReal = diff != null ? packRealWorld(diff, packInfo) : null
        const costPrice = Number(p.costPrice) || 0
        const basisPrice = moneyBasisPrice(p)
        const costDiff = diff != null && basisPrice > 0 ? diff * basisPrice : null
        return (
          <div className="k-rev-walk-sheet-bg" onClick={() => setSheet(null)}>
            <div className="k-rev-walk-sheet" onClick={e => e.stopPropagation()}>
              <div className="k-rev-walk-sheet-handle" aria-hidden />
              <div className="k-rev-walk-sheet-h">
                <span className="k-rev-walk-emo">{p.e || '📦'}</span>
                <div className="k-rev-walk-txt">
                  <b>{p.name}</b>
                  <small>
                    {p.art || '—'} · система <b>{formatQty(system)}</b> {unit}
                    {systemReal && <> ({formatQty(systemReal.value)} {systemReal.label})</>}
                    {basisPrice > 0 && (
                      <> · {costPrice > 0 ? 'закуп' : 'розн.'} {fmtMoney(basisPrice)}</>
                    )}
                  </small>
                </div>
                <button type="button" className="k-rcpt-find-x" onClick={() => setSheet(null)} aria-label="Закрыть">✕</button>
              </div>
              <div className="k-field">
                <label>Факт ({unit})</label>
                <input
                  ref={factRef}
                  className="k-inp"
                  type="text"
                  inputMode={isWeight ? 'decimal' : 'numeric'}
                  value={sheet.counted}
                  onChange={e => setSheet({ ...sheet, counted: sanitizeDecimalInput(e.target.value) })}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      saveSheet()
                    }
                  }}
                />
              </div>
              <div className={`k-rev-walk-sheet-diff${diff != null && diff !== 0 ? (diff > 0 ? ' up' : ' down') : diff === 0 ? ' ok' : ''}`}>
                {diff == null ? (
                  <b>—</b>
                ) : diff === 0 ? (
                  <b>✓ OK</b>
                ) : (
                  <>
                    <b style={diffStyle(diff)}>{formatDiff(diff)} {unit}</b>
                    {diffReal && (
                      <span style={diffStyle(diffReal.value)}>= {formatDiff(diffReal.value)} {diffReal.label}</span>
                    )}
                    {costDiff != null && (
                      <span style={diffStyle(costDiff)}>
                        {formatMoneyDiff(costDiff)}
                        {costPrice <= 0 && ' · розн.'}
                      </span>
                    )}
                  </>
                )}
              </div>
              <div className="k-rev-walk-sheet-actions">
                <button
                  type="button"
                  className="k-btn k-btn-s"
                  onClick={() => setSheet({ ...sheet, counted: String(system) })}
                >
                  ⟲ Система
                </button>
                <button
                  type="button"
                  className="k-btn k-btn-s"
                  onClick={() => setSheet({ ...sheet, counted: '0' })}
                >
                  0
                </button>
                <button
                  type="button"
                  className="k-btn k-btn-g"
                  style={{ background: 'linear-gradient(135deg,#3B8EF0,#2563b0)' }}
                  onClick={saveSheet}
                >
                  {sheet.edit ? 'Сохранить' : 'В сделано'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {scanOpen && (
        <MobileBarcodeScanner
          open={scanOpen}
          onClose={() => setScanOpen(false)}
          onDetect={onScanned}
          title="Сканер · обход"
          hint="Наведите на штрихкод — откроется факт"
        />
      )}
    </div>
  )
}
