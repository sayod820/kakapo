'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import { useProducts } from '@/lib/store'
import { useCategories } from '@/lib/useCategories'
import type { Product, StockRevision } from '@/lib/types'
import WarehousePeriodFilter from './WarehousePeriodFilter'
import WarehouseProductSelect from './WarehouseProductSelect'
import RevisionScopePanel from './RevisionScopePanel'
import RevisionStepBar from './RevisionStepBar'
import {
  clearRevisionDraft,
  defaultRevisionDraft,
  emptyRevisionLine,
  loadRevisionDraft,
  revisionToDraft,
  saveRevisionDraft,
  type RevisionDraft,
  type RevisionDraftLine,
} from './revisionDraftStorage'
import { filterProductsBySearch } from '@/lib/productBarcodes'
import { fmtDateTime, matchesDateRange } from './warehouseShared'

function diffStyle(diff: number) {
  if (diff === 0) return { color: 'var(--muted)' }
  if (diff > 0) return { color: 'var(--green)' }
  return { color: 'var(--red)' }
}

function formatDiff(diff: number) {
  if (diff === 0) return '0'
  return diff > 0 ? `+${diff}` : String(diff)
}

function RevisionLineCard({
  line,
  idx,
  product,
  active,
  canRemove,
  onClear,
  onRemove,
  onActivate,
  onCounted,
  onMatchSystem,
  onZero,
  cardRef,
  countedRef,
}: {
  line: RevisionDraftLine
  idx: number
  product: Product
  active: boolean
  canRemove: boolean
  onClear: () => void
  onRemove: () => void
  onActivate: () => void
  onCounted: (v: string) => void
  onMatchSystem: () => void
  onZero: () => void
  cardRef: (el: HTMLDivElement | null) => void
  countedRef: (el: HTMLInputElement | null) => void
}) {
  const unit = product.unit || 'шт'
  const system = Number(product.stock) || 0
  const counted = line.countedStock !== '' ? Number(line.countedStock) : null
  const diff = counted != null ? counted - system : null

  return (
    <div
      ref={cardRef}
      onClick={onActivate}
      style={{
        padding: 14,
        borderRadius: 12,
        border: `1px solid ${active ? '#3B8EF0' : diff != null && diff !== 0 ? (diff > 0 ? 'var(--green)' : 'var(--red)') : 'var(--border)'}`,
        background: active ? 'rgba(59,142,240,.06)' : 'var(--card2)',
        marginBottom: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--muted)', minWidth: 22, paddingTop: 4 }}>{idx + 1}</span>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 28 }}>{product.e || '📦'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 16 }}>{product.name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {product.art || '—'} · в системе <b>{system} {unit}</b>
            </div>
          </div>
          <button type="button" className="k-btn k-btn-s" style={{ fontSize: 11 }} onClick={e => { e.stopPropagation(); onClear() }}>Сменить</button>
        </div>
        {canRemove && (
          <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px' }} onClick={e => { e.stopPropagation(); onRemove() }}>✕</button>
        )}
      </div>

      <div className="k-grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
        <div className="k-field" style={{ marginBottom: 0 }}>
          <label>В системе ({unit})</label>
          <div className="k-inp" style={{ display: 'flex', alignItems: 'center', opacity: 0.85, cursor: 'default' }}>{system}</div>
        </div>
        <div className="k-field" style={{ marginBottom: 0 }}>
          <label>Факт ({unit})</label>
          <input
            ref={countedRef}
            className="k-inp"
            type="number"
            step="any"
            min="0"
            value={line.countedStock}
            onChange={e => onCounted(e.target.value)}
            onClick={e => e.stopPropagation()}
          />
        </div>
        <div className="k-field" style={{ marginBottom: 0 }}>
          <label>Расхождение Δ</label>
          <div className="k-inp" style={{ display: 'flex', alignItems: 'center', fontWeight: 900, cursor: 'default', ...diffStyle(diff ?? 0) }}>
            {diff != null ? formatDiff(diff) : '—'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button type="button" className="k-btn k-btn-s" style={{ fontSize: 12, padding: '6px 12px' }} onClick={e => { e.stopPropagation(); onMatchSystem() }}>
          Как в системе ({system})
        </button>
        <button type="button" className="k-btn k-btn-s" style={{ fontSize: 12, padding: '6px 12px' }} onClick={e => { e.stopPropagation(); onZero() }}>
          Факт = 0
        </button>
        {diff != null && diff !== 0 && (
          <span style={{ fontSize: 12, fontWeight: 700, alignSelf: 'center', ...diffStyle(diff) }}>
            {diff > 0 ? '↑ Излишек' : '↓ Недостача'}
          </span>
        )}
        {diff === 0 && (
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', alignSelf: 'center' }}>✓ Совпадает</span>
        )}
      </div>
    </div>
  )
}

export default function WarehouseRevisionsPanel({
  revisions,
  products,
  onRefresh,
}: {
  revisions: StockRevision[]
  products: Product[]
  onRefresh: () => Promise<void>
}) {
  const fetchProducts = useProducts(s => s.fetchProducts)
  const { categories } = useCategories()
  const [draft, setDraft] = useState<RevisionDraft>(defaultRevisionDraft)
  const [hydrated, setHydrated] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [modalStep, setModalStep] = useState<'scope' | 'count'>('scope')
  const [scopeLabel, setScopeLabel] = useState('Все категории')
  const [countSearch, setCountSearch] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const countedRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const { open, note, lines, activeLineKey } = draft

  useEffect(() => {
    const loaded = loadRevisionDraft()
    setDraft(loaded)
    if (loaded.open && loaded.lines.some(l => l.productId)) {
      setModalStep('count')
    }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    saveRevisionDraft(draft)
  }, [draft, hydrated])

  const setDraftPatch = useCallback((patch: Partial<RevisionDraft>) => {
    setDraft(prev => ({ ...prev, ...patch }))
  }, [])

  const updateLine = useCallback((key: string, patch: Partial<RevisionDraftLine>) => {
    setDraft(prev => ({
      ...prev,
      lines: prev.lines.map(l => (l.key === key ? { ...l, ...patch } : l)),
    }))
  }, [])

  function resetForm() {
    clearRevisionDraft()
    setDraft(defaultRevisionDraft())
    setEditingId(null)
    setModalStep('scope')
    setScopeLabel('Все категории')
    setMsg('')
  }

  function openForm() {
    setEditingId(null)
    setModalStep('scope')
    setScopeLabel('Все категории')
    setDraft({ ...defaultRevisionDraft(), open: true })
    setMsg('')
  }

  function openEditForm(revision: StockRevision) {
    setEditingId(revision.id)
    setModalStep('count')
    setScopeLabel('Редактирование')
    setDraft(revisionToDraft(revision))
    setMsg('')
  }

  function closeForm() {
    setDraft(prev => ({ ...prev, open: false }))
    if (editingId) {
      setEditingId(null)
      setModalStep('scope')
      setScopeLabel('Все категории')
    }
    setMsg('')
  }

  function fillLineFromProduct(line: RevisionDraftLine, product: Product): RevisionDraftLine {
    return {
      ...line,
      productId: product.id,
      countedStock: line.countedStock !== '' ? line.countedStock : String(product.stock ?? 0),
    }
  }

  function startCountFromScope(toAdd: Product[], label: string) {
    if (!toAdd.length) return
    setScopeLabel(label)
    setCountSearch('')
    setDraft(prev => ({
      ...prev,
      lines: [
        ...toAdd.map(p => ({
          key: `rev-${p.id}-${Math.random()}`,
          productId: p.id,
          countedStock: String(p.stock ?? 0),
        })),
        emptyRevisionLine(),
      ],
      activeLineKey: null,
    }))
    setModalStep('count')
    setMsg('')
  }

  function backToScope() {
    if (editingId) return
    if (filledLines.length && !confirm('Вернуться к выбору категорий? Текущий пересчёт будет сброшен.')) return
    setModalStep('scope')
    setDraft(prev => ({ ...prev, lines: [emptyRevisionLine()], activeLineKey: null }))
    setMsg('')
  }

  function selectProduct(key: string, product: Product | null) {
    if (!product) {
      updateLine(key, { productId: null, countedStock: '' })
      return
    }
    const existing = lines.find(l => l.productId === product.id && l.key !== key)
    if (existing) {
      setDraftPatch({ activeLineKey: existing.key })
      setDraft(prev => ({
        ...prev,
        lines: prev.lines.filter(l => l.key !== key || l.productId !== null),
      }))
      setTimeout(() => countedRefs.current[existing.key]?.focus(), 80)
      return
    }
    const filled = fillLineFromProduct(lines.find(l => l.key === key)!, product)
    setDraft(prev => {
      const nextLines = prev.lines.map(l => (l.key === key ? filled : l))
      const hasEmpty = nextLines.some(l => !l.productId)
      return {
        ...prev,
        lines: hasEmpty ? nextLines : [...nextLines, emptyRevisionLine()],
        activeLineKey: key,
      }
    })
    setTimeout(() => countedRefs.current[key]?.focus(), 80)
  }

  const onBodyScroll = useCallback(() => {
    if (bodyRef.current) setDraftPatch({ scrollTop: bodyRef.current.scrollTop })
  }, [setDraftPatch])

  const totals = useMemo(() => {
    let count = 0
    let matched = 0
    let surplus = 0
    let shortage = 0
    let netDiff = 0
    for (const l of lines) {
      if (!l.productId || l.countedStock === '') continue
      const product = products.find(p => p.id === l.productId)
      if (!product) continue
      const system = Number(product.stock) || 0
      const counted = Number(l.countedStock) || 0
      const diff = counted - system
      count++
      netDiff += diff
      if (diff === 0) matched++
      else if (diff > 0) surplus += diff
      else shortage += Math.abs(diff)
    }
    return { count, matched, surplus, shortage, netDiff, withProduct: lines.filter(l => l.productId).length }
  }, [lines, products])

  const listStats = useMemo(() => {
    let surplusDocs = 0
    let shortageDocs = 0
    let matchedDocs = 0
    for (const rev of revisions) {
      const totalDiff = rev.items.reduce((s, it) => s + it.diff, 0)
      if (totalDiff > 0) surplusDocs++
      else if (totalDiff < 0) shortageDocs++
      else matchedDocs++
    }
    return { surplusDocs, shortageDocs, matchedDocs }
  }, [revisions])

  const filtered = useMemo(() => {
    return revisions.filter(rev => matchesDateRange(rev.createdAtIso, dateFrom, dateTo))
  }, [revisions, dateFrom, dateTo])

  const filledLines = lines.filter(l => l.productId)
  const visibleFilledLines = useMemo(() => {
    if (!countSearch.trim()) return filledLines
    const q = countSearch.trim()
    return filledLines.filter(l => {
      const product = products.find(p => p.id === l.productId)
      return product && filterProductsBySearch([product], q).length > 0
    })
  }, [filledLines, countSearch, products])
  const hasDraft = !editingId && lines.some(l => l.productId || l.countedStock)

  async function submit() {
    if (!USE_API) return
    const items = lines
      .filter(l => l.productId != null && l.countedStock !== '')
      .map(l => ({ productId: l.productId!, countedStock: Number(l.countedStock) }))
    if (!items.length) {
      setMsg('Добавьте товары и укажите фактический остаток')
      return
    }
    setSaving(true)
    setMsg('')
    try {
      const payload = { note: note.trim() || undefined, items }
      if (editingId) {
        await api.updateStockRevision(editingId, payload)
      } else {
        await api.createStockRevision(payload)
      }
      await Promise.all([onRefresh(), fetchProducts()])
      resetForm()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="k-kpis" style={{ marginBottom: 14 }}>
        <div className="k-kpi k-statcard">
          <div className="kl">Всего ревизий</div>
          <div className="kv">{revisions.length}</div>
        </div>
        <div className="k-kpi k-statcard">
          <div className="kl">С излишком</div>
          <div className="kv" style={{ color: 'var(--green)' }}>{listStats.surplusDocs}</div>
        </div>
        <div className="k-kpi k-statcard">
          <div className="kl">С недостачей</div>
          <div className="kv" style={{ color: 'var(--red)' }}>{listStats.shortageDocs}</div>
        </div>
        <div className="k-kpi k-statcard">
          <div className="kl">Без расхождений</div>
          <div className="kv" style={{ color: 'var(--muted)' }}>{listStats.matchedDocs}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <WarehousePeriodFilter
          from={dateFrom}
          to={dateTo}
          onFromChange={setDateFrom}
          onToChange={setDateTo}
          onClear={() => { setDateFrom(''); setDateTo('') }}
        />
        {(dateFrom || dateTo) && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            Показано: <b style={{ color: 'var(--text)' }}>{filtered.length}</b> из {revisions.length}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {hasDraft && !open && (
            <span style={{ fontSize: 12, color: 'var(--gold)', fontWeight: 700 }}>● Черновик</span>
          )}
          <button type="button" className="k-btn k-btn-g" disabled={!USE_API} onClick={openForm}>
            + Новая ревизия
          </button>
        </div>
      </div>

      {!filtered.length ? (
        <div className="k-empty">
          {revisions.length ? 'За выбранный период ревизий нет' : 'Ревизий пока нет — нажмите «Новая ревизия»'}
        </div>
      ) : (
        <div className="k-card k-tbl-scroll">
          <table className="k-tbl">
            <thead>
              <tr>
                <th>Дата</th>
                <th className="num">Позиций</th>
                <th className="num">Излишек</th>
                <th className="num">Недостача</th>
                <th className="num">Δ итого</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map(rev => {
                const surplus = rev.items.reduce((s, it) => s + (it.diff > 0 ? it.diff : 0), 0)
                const shortage = rev.items.reduce((s, it) => s + (it.diff < 0 ? Math.abs(it.diff) : 0), 0)
                const totalDiff = rev.items.reduce((s, it) => s + it.diff, 0)
                const isOpen = expanded === rev.id
                return (
                  <Fragment key={rev.id}>
                    <tr style={{ cursor: 'pointer' }} onClick={() => setExpanded(isOpen ? null : rev.id)}>
                      <td>
                        {fmtDateTime(rev.createdAtIso)}
                        {rev.note && (
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {rev.note}
                          </div>
                        )}
                      </td>
                      <td className="num">{rev.items.length}</td>
                      <td className="num" style={{ color: surplus > 0 ? 'var(--green)' : 'var(--muted)' }}>
                        {surplus > 0 ? `+${surplus}` : '—'}
                      </td>
                      <td className="num" style={{ color: shortage > 0 ? 'var(--red)' : 'var(--muted)' }}>
                        {shortage > 0 ? shortage : '—'}
                      </td>
                      <td className="num" style={{ fontWeight: 800, ...diffStyle(totalDiff) }}>
                        {formatDiff(totalDiff)}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          <button type="button" className="k-btn k-btn-s" style={{ padding: '4px 10px' }} disabled={!USE_API} onClick={e => { e.stopPropagation(); openEditForm(rev) }} title="Редактировать">✎</button>
                          <button type="button" className="k-btn k-btn-s" style={{ padding: '4px 10px' }} onClick={e => { e.stopPropagation(); setExpanded(isOpen ? null : rev.id) }}>
                            {isOpen ? '▲' : '▼'}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={6} style={{ background: 'var(--card2)', padding: '12px 14px' }}>
                          <div style={{ display: 'grid', gap: 8 }}>
                            {rev.items.map((it, i) => {
                              const product = products.find(p => p.id === it.productId)
                              return (
                                <div
                                  key={i}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                                    padding: '10px 12px', borderRadius: 10,
                                    border: '1px solid var(--border)', background: 'var(--card)',
                                  }}
                                >
                                  <span style={{ fontSize: 22 }}>{product?.e || '📦'}</span>
                                  <div style={{ flex: 1, minWidth: 120 }}>
                                    <div style={{ fontWeight: 800 }}>{it.productName}</div>
                                    {product?.art && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{product.art}</div>}
                                  </div>
                                  <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>Было</div>
                                    <div>{it.systemStock} {product?.unit || 'шт'}</div>
                                  </div>
                                  <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>Стало</div>
                                    <div style={{ fontWeight: 900 }}>{it.countedStock} {product?.unit || 'шт'}</div>
                                  </div>
                                  <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>Δ</div>
                                    <div style={{ fontWeight: 900, ...diffStyle(it.diff) }}>{formatDiff(it.diff)}</div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="k-modal-bg k-receipt-modal-bg" onClick={closeForm}>
          <div className="k-modal k-receipt-modal" onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="k-modal-h" style={{ flexShrink: 0 }}>
              <div>
                <b>{editingId ? '✎ Редактирование ревизии' : '📋 Новая ревизия'}</b>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginTop: 2 }}>
                  {modalStep === 'scope'
                    ? 'Шаг 1: выберите категории для пересчёта'
                    : editingId
                      ? 'Измените фактические остатки — склад обновится'
                      : 'Шаг 2: укажите факт по каждому товару и проведите ревизию'}
                </div>
              </div>
              <button type="button" onClick={closeForm}>✕</button>
            </div>

            {!editingId && <RevisionStepBar step={modalStep} />}

            {modalStep === 'scope' && !editingId ? (
              <>
                <RevisionScopePanel
                  products={products}
                  categories={categories}
                  onStart={startCountFromScope}
                />
                <div style={{ flexShrink: 0, padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--panel)' }}>
                  <button type="button" className="k-btn k-btn-s" style={{ width: '100%' }} onClick={closeForm}>Отмена</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ flexShrink: 0, padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--card2)' }}>
                  <div className="k-field" style={{ marginBottom: 10 }}>
                    <label>Комментарий (необязательно)</label>
                    <input className="k-inp" value={note} onChange={e => setDraftPatch({ note: e.target.value })} placeholder="Например: плановая инвентаризация зала" />
                  </div>
                  {!editingId && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
                        📂 {scopeLabel} · {filledLines.length} {filledLines.length === 1 ? 'товар' : filledLines.length < 5 ? 'товара' : 'товаров'}
                      </span>
                      <button type="button" className="k-btn k-btn-s" style={{ fontSize: 12 }} onClick={backToScope}>
                        ← Изменить категории
                      </button>
                    </div>
                  )}
                </div>

                <div className="k-receipt-summary" style={{
                  flexShrink: 0,
                  padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--panel)',
                }}>
                  <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>Позиций</div><div style={{ fontWeight: 900, fontSize: 18 }}>{totals.count}</div></div>
                  <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>Совпало</div><div style={{ fontWeight: 900, fontSize: 18, color: 'var(--green)' }}>{totals.matched}</div></div>
                  <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>Излишек</div><div style={{ fontWeight: 900, fontSize: 18, color: totals.surplus > 0 ? 'var(--green)' : 'var(--muted)' }}>{totals.surplus > 0 ? `+${totals.surplus}` : '—'}</div></div>
                  <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>Δ итого</div><div style={{ fontWeight: 900, fontSize: 18, ...diffStyle(totals.netDiff) }}>{totals.count ? formatDiff(totals.netDiff) : '—'}</div></div>
                </div>

                {filledLines.length > 5 && (
                  <div style={{ flexShrink: 0, padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                    <input
                      className="k-inp"
                      value={countSearch}
                      onChange={e => setCountSearch(e.target.value)}
                      placeholder="Поиск в списке: название, артикул, штрихкод…"
                    />
                  </div>
                )}

                <div ref={bodyRef} className="k-modal-b" onScroll={onBodyScroll} style={{ flex: 1, overflow: 'auto', padding: '12px 16px', minHeight: 0 }}>
                  {visibleFilledLines.length === 0 && countSearch.trim() && (
                    <div style={{ textAlign: 'center', padding: 24, color: 'var(--muted)', fontSize: 13 }}>
                      По запросу «{countSearch}» ничего не найдено
                    </div>
                  )}
                  {visibleFilledLines.map((line, idx) => {
                    const product = products.find(p => p.id === line.productId) || null
                    if (!product) return null
                    const realIdx = filledLines.indexOf(line)
                    return (
                      <RevisionLineCard
                        key={line.key}
                        line={line}
                        idx={realIdx >= 0 ? realIdx : idx}
                        product={product}
                        active={activeLineKey === line.key}
                        canRemove={filledLines.length > 0}
                        onClear={() => selectProduct(line.key, null)}
                        onRemove={() => setDraft(prev => ({
                          ...prev,
                          lines: prev.lines.filter(l => l.key !== line.key),
                          activeLineKey: prev.activeLineKey === line.key ? null : prev.activeLineKey,
                        }))}
                        onActivate={() => setDraftPatch({ activeLineKey: line.key })}
                        onCounted={v => updateLine(line.key, { countedStock: v })}
                        onMatchSystem={() => updateLine(line.key, { countedStock: String(product.stock ?? 0) })}
                        onZero={() => updateLine(line.key, { countedStock: '0' })}
                        cardRef={el => { lineRefs.current[line.key] = el }}
                        countedRef={el => { countedRefs.current[line.key] = el }}
                      />
                    )
                  })}

                  {(() => {
                    const pending = [...lines].reverse().find(l => !l.productId)
                    if (!pending) return null
                    const pendingIdx = lines.filter(l => l.productId).length
                    return (
                      <details style={{ marginTop: 8 }}>
                        <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 800, color: '#3B8EF0', padding: '8px 0' }}>
                          + Добавить ещё один товар вручную
                        </summary>
                        <div
                          ref={el => { lineRefs.current[pending.key] = el }}
                          style={{
                            padding: 16,
                            borderRadius: 12,
                            border: '2px dashed #3B8EF0',
                            background: 'rgba(59,142,240,.04)',
                            marginTop: 8,
                          }}
                        >
                          <WarehouseProductSelect
                            products={products}
                            value={null}
                            onChange={p => { if (p) selectProduct(pending.key, p) }}
                            placeholder="Название, артикул или штрихкод…"
                          />
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                            Позиция {pendingIdx + 1} · если товара нет в выбранных категориях
                          </div>
                        </div>
                      </details>
                    )
                  })()}

                  {msg && (
                    <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>
                      {msg}
                    </div>
                  )}
                </div>

                <div style={{ flexShrink: 0, padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--panel)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="k-btn k-btn-g"
                    style={{ flex: 1, minWidth: 180, background: 'linear-gradient(135deg,#3B8EF0,#2563b0)' }}
                    disabled={saving || totals.count === 0}
                    onClick={() => void submit()}
                  >
                    {saving ? 'Сохранение…' : editingId
                      ? `Сохранить${totals.netDiff !== 0 ? ` · Δ ${formatDiff(totals.netDiff)}` : ''}`
                      : `Провести ревизию${totals.netDiff !== 0 ? ` · Δ ${formatDiff(totals.netDiff)}` : ''}`}
                  </button>
                  <button type="button" className="k-btn k-btn-s" disabled={saving} onClick={() => { if (confirm(editingId ? 'Отменить редактирование?' : 'Очистить черновик?')) resetForm() }}>{editingId ? 'Отмена' : 'Очистить'}</button>
                  <button type="button" className="k-btn k-btn-s" disabled={saving} onClick={closeForm}>Закрыть</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
