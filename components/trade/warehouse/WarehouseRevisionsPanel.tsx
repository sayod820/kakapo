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
import { fmtDateTime, fmtMoney, matchesDateRange } from './warehouseShared'

function diffStyle(diff: number) {
  if (diff === 0) return { color: 'var(--muted)' }
  if (diff > 0) return { color: 'var(--green)' }
  return { color: 'var(--red)' }
}

function formatDiff(diff: number) {
  if (diff === 0) return '0'
  return diff > 0 ? `+${diff}` : String(diff)
}

function formatMoneyDiff(n: number) {
  if (n === 0) return fmtMoney(0)
  return `${n > 0 ? '+' : '−'}${fmtMoney(Math.abs(n))}`
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
  const costPrice = Number(product.costPrice) || 0
  const retailPrice = Number(product.price) || 0
  const costDiff = diff != null ? diff * costPrice : null
  const retailDiff = diff != null ? diff * retailPrice : null
  const barcode = product.barcode || product.barcodes?.[0] || ''

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
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <span>{product.art || '—'}</span>
              {barcode && <span>· 🏷 {barcode}</span>}
              <span>· в системе <b style={{ color: 'var(--text)' }}>{system} {unit}</b></span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <span>Розница: <b style={{ color: 'var(--text)' }}>{fmtMoney(retailPrice)}</b></span>
              <span>Закуп: <b style={{ color: 'var(--text)' }}>{fmtMoney(costPrice)}</b></span>
            </div>
          </div>
          <button type="button" className="k-btn k-btn-s" style={{ fontSize: 11 }} onClick={e => { e.stopPropagation(); onClear() }}>Сменить</button>
        </div>
        {canRemove && (
          <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px' }} onClick={e => { e.stopPropagation(); onRemove() }}>✕</button>
        )}
      </div>

      <div className="k-field" style={{ marginBottom: 0 }}>
        <label>Фактический остаток ({unit}) · было {system}</label>
        <input
          ref={countedRef}
          className="k-inp"
          type="number"
          step="any"
          min="0"
          value={line.countedStock}
          onChange={e => onCounted(e.target.value)}
          onClick={e => e.stopPropagation()}
          style={{ fontSize: 18, fontWeight: 800 }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="k-btn k-btn-s" style={{ fontSize: 12, padding: '6px 12px' }} onClick={e => { e.stopPropagation(); onMatchSystem() }}>
          Как в системе ({system})
        </button>
        <button type="button" className="k-btn k-btn-s" style={{ fontSize: 12, padding: '6px 12px' }} onClick={e => { e.stopPropagation(); onZero() }}>
          Факт = 0
        </button>
        {diff != null && diff !== 0 && (
          <span style={{ fontSize: 12, fontWeight: 700, ...diffStyle(diff) }}>
            {diff > 0 ? '↑ Излишек' : '↓ Недостача'} {formatDiff(diff)} {unit}
          </span>
        )}
        {diff === 0 && (
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)' }}>✓ Совпадает</span>
        )}
      </div>

      {diff != null && diff !== 0 && (costPrice > 0 || retailPrice > 0) && (
        <div style={{
          display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, paddingTop: 10,
          borderTop: '1px dashed var(--border)',
        }}>
          {costPrice > 0 && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{diff < 0 ? 'Убыток по закупке' : 'Излишек по закупке'}</div>
              <div style={{ fontWeight: 900, fontSize: 14, ...diffStyle(costDiff ?? 0) }}>{formatMoneyDiff(costDiff ?? 0)}</div>
            </div>
          )}
          {retailPrice > 0 && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{diff < 0 ? 'Убыток по рознице' : 'Излишек по рознице'}</div>
              <div style={{ fontWeight: 900, fontSize: 14, ...diffStyle(retailDiff ?? 0) }}>{formatMoneyDiff(retailDiff ?? 0)}</div>
            </div>
          )}
        </div>
      )}
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
  const [deletingId, setDeletingId] = useState<string | null>(null)
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
    let costMoneyDiff = 0
    for (const l of lines) {
      if (!l.productId || l.countedStock === '') continue
      const product = products.find(p => p.id === l.productId)
      if (!product) continue
      const system = Number(product.stock) || 0
      const counted = Number(l.countedStock) || 0
      const diff = counted - system
      count++
      netDiff += diff
      costMoneyDiff += diff * (Number(product.costPrice) || 0)
      if (diff === 0) matched++
      else if (diff > 0) surplus += diff
      else shortage += Math.abs(diff)
    }
    return { count, matched, surplus, shortage, netDiff, costMoneyDiff, withProduct: lines.filter(l => l.productId).length }
  }, [lines, products])

  const listStats = useMemo(() => {
    let surplusDocs = 0
    let shortageDocs = 0
    let matchedDocs = 0
    let totalMoneyDiff = 0
    for (const rev of revisions) {
      const totalDiff = rev.items.reduce((s, it) => s + it.diff, 0)
      if (totalDiff > 0) surplusDocs++
      else if (totalDiff < 0) shortageDocs++
      else matchedDocs++
      for (const it of rev.items) {
        const product = products.find(p => p.id === it.productId)
        totalMoneyDiff += it.diff * (Number(product?.costPrice) || 0)
      }
    }
    return { surplusDocs, shortageDocs, matchedDocs, totalMoneyDiff }
  }, [revisions, products])

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

  async function removeRevision(id: string) {
    if (!USE_API) return
    const revision = revisions.find(r => r.id === id)
    if (!revision) return
    if (!confirm(`Удалить ревизию от ${fmtDateTime(revision.createdAtIso)}?\n\nОстатки вернутся к значениям до ревизии.`)) return
    setDeletingId(id)
    try {
      await api.deleteStockRevision(id)
      if (editingId === id) resetForm()
      if (expanded === id) setExpanded(null)
      await Promise.all([onRefresh(), fetchProducts()])
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось удалить ревизию')
    } finally {
      setDeletingId(null)
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
        <div className="k-kpi k-statcard">
          <div className="kl">{listStats.totalMoneyDiff < 0 ? 'Убыток (закуп)' : 'Итого по закупу'}</div>
          <div className="kv" style={{ ...diffStyle(listStats.totalMoneyDiff) }}>
            {listStats.totalMoneyDiff !== 0 ? formatMoneyDiff(listStats.totalMoneyDiff) : '—'}
          </div>
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
          <table className="k-tbl" style={{ minWidth: 780 }}>
            <thead>
              <tr>
                <th>Дата</th>
                <th className="num">Позиций</th>
                <th className="num">Излишек</th>
                <th className="num">Недостача</th>
                <th className="num">Δ итого</th>
                <th className="num">Сумма (закуп)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map(rev => {
                const surplus = rev.items.reduce((s, it) => s + (it.diff > 0 ? it.diff : 0), 0)
                const shortage = rev.items.reduce((s, it) => s + (it.diff < 0 ? Math.abs(it.diff) : 0), 0)
                const totalDiff = rev.items.reduce((s, it) => s + it.diff, 0)
                const costMoneyDiff = rev.items.reduce((s, it) => {
                  const product = products.find(p => p.id === it.productId)
                  return s + it.diff * (Number(product?.costPrice) || 0)
                }, 0)
                const isOpen = expanded === rev.id
                return (
                  <Fragment key={rev.id}>
                    <tr style={{ cursor: 'pointer' }} onClick={() => setExpanded(isOpen ? null : rev.id)}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {fmtDateTime(rev.createdAtIso)}
                        {rev.note && (
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {rev.note}
                          </div>
                        )}
                      </td>
                      <td className="num">{rev.items.length}</td>
                      <td className="num" style={{ color: surplus > 0 ? 'var(--green)' : 'var(--muted)', whiteSpace: 'nowrap' }}>
                        {surplus > 0 ? `+${surplus}` : '—'}
                      </td>
                      <td className="num" style={{ color: shortage > 0 ? 'var(--red)' : 'var(--muted)', whiteSpace: 'nowrap' }}>
                        {shortage > 0 ? shortage : '—'}
                      </td>
                      <td className="num" style={{ fontWeight: 800, whiteSpace: 'nowrap', ...diffStyle(totalDiff) }}>
                        {formatDiff(totalDiff)}
                      </td>
                      <td className="num" style={{ fontWeight: 900, whiteSpace: 'nowrap', ...diffStyle(costMoneyDiff) }}>
                        {costMoneyDiff !== 0 ? formatMoneyDiff(costMoneyDiff) : '—'}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          <button type="button" className="k-btn k-btn-s" style={{ padding: '4px 10px' }} disabled={!USE_API} onClick={e => { e.stopPropagation(); openEditForm(rev) }} title="Редактировать">✎</button>
                          <button
                            type="button"
                            className="k-btn k-btn-s"
                            style={{ padding: '4px 10px', color: 'var(--red)' }}
                            disabled={!USE_API || deletingId === rev.id}
                            onClick={e => { e.stopPropagation(); void removeRevision(rev.id) }}
                            title="Удалить"
                          >
                            {deletingId === rev.id ? '…' : '🗑'}
                          </button>
                          <button type="button" className="k-btn k-btn-s" style={{ padding: '4px 10px' }} onClick={e => { e.stopPropagation(); setExpanded(isOpen ? null : rev.id) }}>
                            {isOpen ? '▲' : '▼'}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={7} style={{ background: 'var(--card2)', padding: '12px 14px' }}>
                          <div style={{ display: 'grid', gap: 8 }}>
                            {rev.items.map((it, i) => {
                              const product = products.find(p => p.id === it.productId)
                              const barcode = product?.barcode || product?.barcodes?.[0] || ''
                              const costPrice = Number(product?.costPrice) || 0
                              const costDiff = it.diff * costPrice
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
                                  <div style={{ flex: 1, minWidth: 140 }}>
                                    <div style={{ fontWeight: 800 }}>{it.productName}</div>
                                    <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                      {product?.art && <span>{product.art}</span>}
                                      {barcode && <span>· 🏷 {barcode}</span>}
                                    </div>
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
                                  {costPrice > 0 && it.diff !== 0 && (
                                    <div style={{ textAlign: 'right' }}>
                                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{it.diff < 0 ? 'Убыток' : 'Излишек'} (закуп)</div>
                                      <div style={{ fontWeight: 900, ...diffStyle(costDiff) }}>{formatMoneyDiff(costDiff)}</div>
                                    </div>
                                  )}
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
                  <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>{totals.costMoneyDiff < 0 ? 'Убыток (закуп)' : 'Сумма (закуп)'}</div><div style={{ fontWeight: 900, fontSize: 18, ...diffStyle(totals.costMoneyDiff) }}>{totals.count ? formatMoneyDiff(totals.costMoneyDiff) : '—'}</div></div>
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
                  {editingId && (
                    <button
                      type="button"
                      className="k-btn k-btn-s"
                      style={{ color: 'var(--red)' }}
                      disabled={saving || deletingId === editingId}
                      onClick={() => void removeRevision(editingId)}
                    >
                      {deletingId === editingId ? 'Удаление…' : 'Удалить'}
                    </button>
                  )}
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
