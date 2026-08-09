'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { USE_API } from '@/lib/config'
import {
  createStockWriteoffSafe,
  deleteStockWriteoffSafe,
  updateStockWriteoffSafe,
} from '@/lib/offlineWarehouseOps'
import { useProducts } from '@/lib/store'
import type { Product, StockWriteoff } from '@/lib/types'
import WarehousePeriodFilter from './WarehousePeriodFilter'
import WarehouseProductSelect from './WarehouseProductSelect'
import {
  clearWriteoffDraft,
  defaultWriteoffDraft,
  emptyWriteoffLine,
  loadWriteoffDraft,
  saveWriteoffDraft,
  writeoffToDraft,
  type WriteoffDraft,
  type WriteoffDraftLine,
} from './writeoffDraftStorage'
import { fmtDateTime, fmtMoney, matchesDateRange, sanitizeDecimalInput, WRITEOFF_REASONS, writeoffReasonMeta } from './warehouseShared'

function lineCost(line: WriteoffDraftLine, product: Product | undefined) {
  const qty = Number(line.qty) || 0
  const unit = Number(product?.costPrice) || 0
  return qty * unit
}

function ReasonBadge({ reason }: { reason: string }) {
  const meta = writeoffReasonMeta(reason)
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 800,
      color: meta.color, background: meta.bg, border: `1px solid ${meta.color}33`,
      maxWidth: '100%',
    }}>
      <span>{meta.icon}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{reason}</span>
    </span>
  )
}

function WriteoffLineCard({
  line,
  idx,
  product,
  active,
  canRemove,
  onClear,
  onRemove,
  onActivate,
  onQty,
  onWriteAll,
  stockLimit,
  cardRef,
  qtyRef,
}: {
  line: WriteoffDraftLine
  idx: number
  product: Product
  active: boolean
  canRemove: boolean
  onClear: () => void
  onRemove: () => void
  onActivate: () => void
  onQty: (v: string) => void
  onWriteAll: () => void
  stockLimit?: number
  cardRef: (el: HTMLDivElement | null) => void
  qtyRef: (el: HTMLInputElement | null) => void
}) {
  const stock = stockLimit ?? (Number(product.stock) || 0)
  const unit = product.unit || 'шт'
  const qty = Number(line.qty) || 0
  const unitCost = Number(product.costPrice) || 0
  const total = lineCost(line, product)
  const overStock = qty > stock
  const noStock = stock <= 0

  return (
    <div
      ref={cardRef}
      className={`k-wo-line${active ? ' is-on' : ''}${overStock ? ' is-bad' : ''}`}
      onClick={onActivate}
    >
      <div className="k-wo-line-top">
        <span className="k-wo-line-idx">{idx + 1}</span>
        <span className="k-wo-line-emo">{product.e || '📦'}</span>
        <div className="k-wo-line-txt">
          <b>{product.name}</b>
          <small>
            {product.art || '—'} · склад{' '}
            <b style={{ color: noStock ? 'var(--red)' : stock <= 5 ? 'var(--gold)' : 'var(--text)' }}>{stock} {unit}</b>
            {unitCost > 0 && <> · {fmtMoney(unitCost)}/{unit}</>}
          </small>
        </div>
        <button type="button" className="k-btn k-btn-s" onClick={e => { e.stopPropagation(); onClear() }}>⇄</button>
        {canRemove && (
          <button type="button" className="k-btn k-btn-s" style={{ color: 'var(--red)' }} onClick={e => { e.stopPropagation(); onRemove() }}>✕</button>
        )}
      </div>

      <div className="k-wo-line-grid">
        <div className="k-field">
          <label>Кол-во ({unit})</label>
          <input
            ref={qtyRef}
            className="k-inp"
            type="text"
            inputMode="decimal"
            value={line.qty}
            onChange={e => onQty(sanitizeDecimalInput(e.target.value))}
            onClick={e => e.stopPropagation()}
            style={overStock ? { borderColor: 'var(--red)' } : undefined}
          />
        </div>
        <div className="k-field">
          <label>Себест.</label>
          <div className="k-inp k-wo-ro">{unitCost > 0 ? fmtMoney(unitCost) : '—'}</div>
        </div>
        <div className="k-field k-wo-sum">
          <label>Сумма</label>
          <div className="k-inp k-wo-ro" style={{ color: total > 0 ? 'var(--red)' : 'var(--muted)', fontWeight: 900 }}>
            {total > 0 ? fmtMoney(total) : '—'}
          </div>
        </div>
      </div>

      {(stock > 0 || overStock || (noStock && qty > 0)) && (
        <div className="k-wo-line-foot">
          {stock > 0 && (
            <button
              type="button"
              className="k-btn k-btn-s"
              onClick={e => { e.stopPropagation(); onWriteAll() }}
            >
              Всё ({stock})
            </button>
          )}
          {overStock && (
            <span className="err">⚠ +{(qty - stock).toFixed(2)} {unit}</span>
          )}
          {noStock && qty > 0 && (
            <span className="err">⚠ нет на складе</span>
          )}
        </div>
      )}
    </div>
  )
}

export default function WarehouseWriteoffsPanel({
  writeoffs,
  products,
  onRefresh,
}: {
  writeoffs: StockWriteoff[]
  products: Product[]
  onRefresh: () => Promise<void>
}) {
  const fetchProducts = useProducts(s => s.fetchProducts)
  const [draft, setDraft] = useState<WriteoffDraft>(defaultWriteoffDraft)
  const [hydrated, setHydrated] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [reasonFilter, setReasonFilter] = useState('all')
  const [addOpen, setAddOpen] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const { open, reason, customReason, note, lines, activeLineKey } = draft

  useEffect(() => {
    setDraft(loadWriteoffDraft())
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    saveWriteoffDraft(draft)
  }, [draft, hydrated])

  const setDraftPatch = useCallback((patch: Partial<WriteoffDraft>) => {
    setDraft(prev => ({ ...prev, ...patch }))
  }, [])

  const updateLine = useCallback((key: string, patch: Partial<WriteoffDraftLine>) => {
    setDraft(prev => ({
      ...prev,
      lines: prev.lines.map(l => (l.key === key ? { ...l, ...patch } : l)),
    }))
  }, [])

  const setActiveLine = useCallback((key: string | null) => {
    setDraftPatch({ activeLineKey: key })
  }, [setDraftPatch])

  function resetForm() {
    clearWriteoffDraft()
    setDraft(defaultWriteoffDraft())
    setEditingId(null)
    setAddOpen(false)
    setMsg('')
  }

  function openForm() {
    setEditingId(null)
    setAddOpen(false)
    setDraft(prev => ({ ...prev, open: true }))
    setMsg('')
  }

  function openEditForm(writeoff: StockWriteoff) {
    setEditingId(writeoff.id)
    setAddOpen(false)
    setDraft(writeoffToDraft(writeoff))
    setMsg('')
  }

  function closeForm() {
    setAddOpen(false)
    if (editingId) {
      setDraft(prev => ({ ...prev, open: false }))
      setEditingId(null)
      setMsg('')
      return
    }
    setDraft(prev => ({ ...prev, open: false }))
    setMsg('')
  }

  function fillLineFromProduct(line: WriteoffDraftLine, product: Product): WriteoffDraftLine {
    return {
      ...line,
      productId: product.id,
      qty: line.qty || '1',
    }
  }

  function selectProduct(key: string, product: Product | null) {
    if (!product) {
      updateLine(key, { productId: null, qty: '' })
      return
    }

    const existing = lines.find(l => l.productId === product.id && l.key !== key)
    if (existing) {
      setActiveLine(existing.key)
      setDraft(prev => ({
        ...prev,
        lines: prev.lines.filter(l => l.key !== key || l.productId !== null),
      }))
      setTimeout(() => qtyRefs.current[existing.key]?.focus(), 80)
      return
    }

    const filled = fillLineFromProduct(lines.find(l => l.key === key)!, product)
    setDraft(prev => {
      const nextLines = prev.lines.map(l => (l.key === key ? filled : l))
      const hasEmpty = nextLines.some(l => !l.productId)
      return {
        ...prev,
        lines: hasEmpty ? nextLines : [...nextLines, emptyWriteoffLine()],
        activeLineKey: key,
      }
    })
    setTimeout(() => qtyRefs.current[key]?.focus(), 80)
  }

  function addProductFromFind(product: Product) {
    setAddOpen(false)
    setDraft(prev => {
      const existing = prev.lines.find(l => l.productId === product.id)
      if (existing) {
        return { ...prev, activeLineKey: existing.key }
      }
      let pending = prev.lines.find(l => !l.productId)
      let nextLines = prev.lines
      if (!pending) {
        pending = emptyWriteoffLine()
        nextLines = [...nextLines, pending]
      }
      const filled = fillLineFromProduct(pending, product)
      const mapped = nextLines.map(l => (l.key === pending!.key ? filled : l))
      const hasEmpty = mapped.some(l => !l.productId)
      return {
        ...prev,
        lines: hasEmpty ? mapped : [...mapped, emptyWriteoffLine()],
        activeLineKey: pending.key,
      }
    })
  }

  function setLineQty(key: string, qty: string) {
    updateLine(key, { qty })
  }

  function writeAll(key: string) {
    const line = lines.find(l => l.key === key)
    const product = products.find(p => p.id === line?.productId)
    if (!line?.productId || !product) return
    const stock = stockLimitFor(line.productId)
    if (stock > 0) updateLine(key, { qty: String(stock) })
  }

  const onBodyScroll = useCallback(() => {
    if (bodyRef.current) setDraftPatch({ scrollTop: bodyRef.current.scrollTop })
  }, [setDraftPatch])

  useEffect(() => {
    if (!open || !bodyRef.current) return
    bodyRef.current.scrollTop = draft.scrollTop
  }, [open, draft.scrollTop])

  const editingWriteoff = editingId ? writeoffs.find(w => w.id === editingId) || null : null

  function stockLimitFor(productId: number) {
    const product = products.find(p => p.id === productId)
    let stock = Number(product?.stock) || 0
    if (editingWriteoff) {
      for (const it of editingWriteoff.items) {
        if (it.productId === productId) stock += Number(it.qty) || 0
      }
    }
    return stock
  }

  const totals = useMemo(() => {
    let count = 0
    let qtyTotal = 0
    let costTotal = 0
    let hasOver = false
    for (const l of lines) {
      if (!l.productId || !(Number(l.qty) > 0)) continue
      const product = products.find(p => p.id === l.productId)
      if (!product) continue
      const qty = Number(l.qty) || 0
      const stock = stockLimitFor(l.productId!)
      if (qty > stock) hasOver = true
      count++
      qtyTotal += qty
      costTotal += lineCost(l, product)
    }
    return { count, qtyTotal, costTotal, withProduct: lines.filter(l => l.productId).length, hasOver }
  }, [lines, products, editingWriteoff])

  const listStats = useMemo(() => {
    const now = Date.now()
    const monthAgo = now - 30 * 24 * 60 * 60 * 1000
    let monthCost = 0
    let monthCount = 0
    let totalQty = 0
    for (const w of writeoffs) {
      totalQty += w.items.reduce((s, it) => s + (Number(it.qty) || 0), 0)
      const t = new Date(w.createdAtIso).getTime()
      if (t >= monthAgo) {
        monthCount++
        monthCost += Number(w.totalCost) || 0
      }
    }
    const totalCost = writeoffs.reduce((s, w) => s + (Number(w.totalCost) || 0), 0)
    return { totalCost, monthCost, monthCount, totalQty }
  }, [writeoffs])

  const filtered = useMemo(() => {
    return writeoffs.filter(w => {
      if (reasonFilter !== 'all' && !w.reason.startsWith(reasonFilter)) return false
      return matchesDateRange(w.createdAtIso, dateFrom, dateTo)
    })
  }, [writeoffs, reasonFilter, dateFrom, dateTo])

  const filledLines = lines.filter(l => l.productId)
  const hasDraft = !editingId && lines.some(l => l.productId || l.qty)

  async function submit() {
    if (!USE_API) return
    const finalReason = reason === 'Другое' ? customReason.trim() : reason
    if (!finalReason) {
      setMsg('Укажите причину списания')
      return
    }
    if (totals.hasOver) {
      setMsg('Исправьте количество — превышен остаток на складе')
      return
    }
    const items = lines
      .filter(l => l.productId && Number(l.qty) > 0)
      .map(l => ({ productId: l.productId!, qty: Number(l.qty) }))
    if (!items.length) {
      setMsg('Добавьте товары и укажите количество')
      return
    }
    setSaving(true)
    setMsg('')
    try {
      const payload = {
        reason: finalReason,
        note: note.trim() || undefined,
        items,
      }
      if (editingId) {
        const res = await updateStockWriteoffSafe(editingId, payload)
        resetForm()
        if (!res.offline) void Promise.all([onRefresh(), fetchProducts()])
        else setMsg('Сохранено локально · отправится при связи')
      } else {
        const res = await createStockWriteoffSafe(payload)
        resetForm()
        if (!res.offline) void Promise.all([onRefresh(), fetchProducts()])
        else setMsg('Списание сохранено · отправится при связи')
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  async function removeWriteoff(id: string) {
    if (!USE_API) return
    const writeoff = writeoffs.find(w => w.id === id)
    if (!writeoff) return
    if (!confirm(`Удалить списание от ${fmtDateTime(writeoff.createdAtIso)}?\n\nТовар вернётся на склад.`)) return
    setDeletingId(id)
    try {
      const res = await deleteStockWriteoffSafe(id)
      if (editingId === id) resetForm()
      if (expanded === id) setExpanded(null)
      if (!res.offline) void Promise.all([onRefresh(), fetchProducts()])
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось удалить списание')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="k-wh-writeoffs">
      <div className="k-wh-panel-head">
        <div className="k-wh-meta">
          <span className="k-wh-meta-count"><b>{writeoffs.length}</b> списаний</span>
          <div className="k-wh-money">
            <span>Сумма <b style={{ color: 'var(--red)' }}>{fmtMoney(listStats.totalCost)}</b></span>
            <span>30 дн. <b>{listStats.monthCount}</b> · <b style={{ color: 'var(--red)' }}>{fmtMoney(listStats.monthCost)}</b></span>
            <span>Ед. <b>{listStats.totalQty}</b></span>
          </div>
        </div>

        <div className="k-wh-filters-row">
          <WarehousePeriodFilter
            from={dateFrom}
            to={dateTo}
            onFromChange={setDateFrom}
            onToChange={setDateTo}
            onClear={() => { setDateFrom(''); setDateTo('') }}
          />
          {(dateFrom || dateTo) && (
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              <b style={{ color: 'var(--text)' }}>{filtered.length}</b> / {writeoffs.length}
            </span>
          )}
          <div className="k-wh-cta" style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {hasDraft && !open && (
              <span style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 700 }}>● Черновик</span>
            )}
            <button type="button" className="k-btn k-btn-g" disabled={!USE_API} onClick={openForm}>
              + Новое списание
            </button>
          </div>
        </div>

        <div className="k-wh-chip-row">
          <button
            type="button"
            className={`k-subtab ${reasonFilter === 'all' ? 'active' : ''}`}
            style={{ padding: '5px 10px', fontSize: 12 }}
            onClick={() => setReasonFilter('all')}
          >
            Все
          </button>
          {WRITEOFF_REASONS.map(r => (
            <button
              key={r.id}
              type="button"
              className={`k-subtab ${reasonFilter === r.id ? 'active' : ''}`}
              style={{ padding: '5px 10px', fontSize: 12 }}
              onClick={() => setReasonFilter(r.id)}
            >
              {r.icon} {r.label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        className={`k-wh-fab${hasDraft && !open ? ' has-draft' : ''}`}
        disabled={!USE_API || open}
        onClick={openForm}
        aria-label="Новое списание"
        title={hasDraft && !open ? 'Черновик списания' : 'Новое списание'}
      >
        +
      </button>

      {!filtered.length ? (
        <div className="k-empty">
          {writeoffs.length ? 'За выбранный период списаний нет' : 'Списаний пока нет — нажмите «Новое списание»'}
        </div>
      ) : (
        <>
          <div className="k-wh-cards">
            {filtered.map(w => {
              const qtySum = w.items.reduce((s, it) => s + (Number(it.qty) || 0), 0)
              const isOpen = expanded === w.id
              return (
                <div key={w.id} className="k-wh-card" style={{ padding: 10, gap: 8 }}>
                  <div className="k-wh-card-top">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{fmtDateTime(w.createdAtIso)}</div>
                      <div style={{ marginTop: 4 }}><ReasonBadge reason={w.reason} /></div>
                      {w.note && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{w.note}</div>
                      )}
                    </div>
                  </div>
                  <div className="k-wh-card-meta">
                    <div>
                      <div className="l">Позиций</div>
                      <div className="v">{w.items.length}</div>
                    </div>
                    <div>
                      <div className="l">Кол-во</div>
                      <div className="v">{qtySum}</div>
                    </div>
                    <div>
                      <div className="l">Сумма</div>
                      <div className="v" style={{ color: 'var(--red)' }}>{fmtMoney(w.totalCost)}</div>
                    </div>
                  </div>
                  <div className="k-wh-card-actions">
                    <button type="button" className="k-btn k-btn-s" disabled={!USE_API} onClick={() => openEditForm(w)}>✎</button>
                    <button
                      type="button"
                      className="k-btn k-btn-s"
                      style={{ color: 'var(--red)' }}
                      disabled={!USE_API || deletingId === w.id}
                      onClick={() => void removeWriteoff(w.id)}
                    >
                      {deletingId === w.id ? '…' : '🗑'}
                    </button>
                    <button type="button" className="k-btn k-btn-s" style={{ minWidth: 48 }} onClick={() => setExpanded(isOpen ? null : w.id)}>
                      {isOpen ? '▲' : '▼'}
                    </button>
                  </div>
                  {isOpen && (
                    <div className="k-wh-card-detail">
                      {w.items.map((it, i) => {
                        const product = products.find(p => p.id === it.productId)
                        const unitCost = it.unitCost ?? (it.lineCost && it.qty ? it.lineCost / it.qty : product?.costPrice)
                        const lineSum = it.lineCost ?? (unitCost != null ? Number(unitCost) * it.qty : null)
                        return (
                          <div
                            key={i}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                              padding: '8px 10px', borderRadius: 8,
                              border: '1px solid var(--border)', background: 'var(--card2)',
                            }}
                          >
                            <span style={{ fontSize: 18 }}>{product?.e || '📦'}</span>
                            <div style={{ flex: 1, minWidth: 100 }}>
                              <div style={{ fontWeight: 800, fontSize: 13 }}>{it.productName}</div>
                              {product?.art && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{product.art}</div>}
                            </div>
                            <div style={{ textAlign: 'right', fontSize: 12 }}>
                              <b>{it.qty}</b> {product?.unit || 'шт'}
                            </div>
                            {lineSum != null && (
                              <div style={{ textAlign: 'right', fontWeight: 900, color: 'var(--red)', fontSize: 12 }}>{fmtMoney(lineSum)}</div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="k-wh-panel-body k-wh-desk-tbl">
          <table className="k-tbl">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Причина</th>
                <th className="num">Поз.</th>
                <th className="num">Кол-во</th>
                <th className="num">Сумма</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map(w => {
                const qtySum = w.items.reduce((s, it) => s + (Number(it.qty) || 0), 0)
                const isOpen = expanded === w.id
                return (
                  <Fragment key={w.id}>
                    <tr style={{ cursor: 'pointer' }} onClick={() => setExpanded(isOpen ? null : w.id)}>
                      <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDateTime(w.createdAtIso)}</td>
                      <td>
                        <ReasonBadge reason={w.reason} />
                        {w.note && (
                          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {w.note}
                          </div>
                        )}
                      </td>
                      <td className="num">{w.items.length}</td>
                      <td className="num">{qtySum}</td>
                      <td className="num" style={{ color: 'var(--red)', fontWeight: 800 }}>{fmtMoney(w.totalCost)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 3, justifyContent: 'flex-end' }}>
                          <button type="button" className="k-btn k-btn-s" style={{ padding: '3px 8px', fontSize: 12, minHeight: 0 }} disabled={!USE_API} onClick={e => { e.stopPropagation(); openEditForm(w) }} title="Редактировать">✎</button>
                          <button
                            type="button"
                            className="k-btn k-btn-s"
                            style={{ padding: '3px 8px', fontSize: 12, minHeight: 0, color: 'var(--red)' }}
                            disabled={!USE_API || deletingId === w.id}
                            onClick={e => { e.stopPropagation(); void removeWriteoff(w.id) }}
                            title="Удалить"
                          >
                            {deletingId === w.id ? '…' : '🗑'}
                          </button>
                          <button type="button" className="k-btn k-btn-s" style={{ padding: '3px 8px', fontSize: 12, minHeight: 0 }} onClick={e => { e.stopPropagation(); setExpanded(isOpen ? null : w.id) }}>
                            {isOpen ? '▲' : '▼'}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={6} style={{ background: 'var(--card2)', padding: '8px 10px' }}>
                          <div style={{ display: 'grid', gap: 6 }}>
                            {w.items.map((it, i) => {
                              const product = products.find(p => p.id === it.productId)
                              const unitCost = it.unitCost ?? (it.lineCost && it.qty ? it.lineCost / it.qty : product?.costPrice)
                              const lineSum = it.lineCost ?? (unitCost != null ? Number(unitCost) * it.qty : null)
                              return (
                                <div
                                  key={i}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                                    padding: '6px 8px', borderRadius: 8,
                                    border: '1px solid var(--border)', background: 'var(--card)',
                                  }}
                                >
                                  <span style={{ fontSize: 16 }}>{product?.e || '📦'}</span>
                                  <div style={{ flex: 1, minWidth: 100 }}>
                                    <div style={{ fontWeight: 800, fontSize: 12 }}>{it.productName}</div>
                                    {product?.art && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{product.art}</div>}
                                  </div>
                                  <div style={{ textAlign: 'right', fontSize: 12 }}>
                                    <b>{it.qty}</b> {product?.unit || 'шт'}
                                  </div>
                                  {unitCost != null && (
                                    <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--muted)' }}>{fmtMoney(unitCost)}</div>
                                  )}
                                  {lineSum != null && (
                                    <div style={{ textAlign: 'right', fontWeight: 900, color: 'var(--red)', fontSize: 12 }}>{fmtMoney(lineSum)}</div>
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
        </>
      )}

      {open && (
        <div className="k-modal-bg k-receipt-modal-bg" onClick={closeForm}>
          <div
            className="k-modal k-receipt-modal k-wo-modal"
            onClick={e => e.stopPropagation()}
            style={{ display: 'flex', flexDirection: 'column' }}
          >
            <div className="k-rcpt-head">
              <div className="k-rcpt-head-title">
                <span className="k-rcpt-head-ic" style={{ background: 'rgba(255,90,90,.12)', color: 'var(--red)', borderColor: 'rgba(255,90,90,.3)' }}>
                  {editingId ? '✎' : '📤'}
                </span>
                <div>
                  <b>{editingId ? 'Редактирование списания' : 'Новое списание'}</b>
                  <div className="sub">
                    {editingId ? 'Остатки пересчитаются' : 'Товар → количество → списать'}
                  </div>
                </div>
              </div>
              <button type="button" className="k-rcpt-find-x" onClick={closeForm} aria-label="Закрыть">✕</button>
              <div className="k-rcpt-head-actions k-hide-desk">
                {editingId && (
                  <button
                    type="button"
                    className="k-btn k-btn-s k-btn-del"
                    style={{ color: 'var(--red)' }}
                    disabled={saving || deletingId === editingId}
                    onClick={() => void removeWriteoff(editingId)}
                  >
                    {deletingId === editingId ? '…' : 'Удалить'}
                  </button>
                )}
                <button
                  type="button"
                  className="k-btn k-btn-s"
                  disabled={saving}
                  onClick={() => { if (confirm(editingId ? 'Отменить редактирование?' : 'Очистить черновик?')) resetForm() }}
                >
                  {editingId ? 'Отмена' : 'Очистить'}
                </button>
                <button
                  type="button"
                  className="k-btn k-btn-g"
                  style={{ background: 'linear-gradient(135deg,#FF5A5A,#cc4040)' }}
                  disabled={saving || totals.hasOver || totals.count === 0}
                  onClick={() => void submit()}
                >
                  {saving ? '…' : editingId
                    ? `Сохранить${totals.costTotal > 0 ? ` · ${fmtMoney(totals.costTotal)}` : ''}`
                    : `Списать${totals.costTotal > 0 ? ` · ${fmtMoney(totals.costTotal)}` : ''}`}
                </button>
              </div>
            </div>

            <div
              ref={bodyRef}
              className="k-modal-b k-receipt-scroll"
              onScroll={onBodyScroll}
            >
              <div className="k-wo-reason">
                <div className="k-wo-reason-h">Причина</div>
                <div className="k-wo-reason-list">
                  {WRITEOFF_REASONS.map(r => (
                    <button
                      key={r.id}
                      type="button"
                      className={`k-wo-reason-btn${reason === r.id ? ' on' : ''}`}
                      style={{
                        borderColor: reason === r.id ? r.color : undefined,
                        background: reason === r.id ? r.bg : undefined,
                        color: reason === r.id ? r.color : undefined,
                      }}
                      onClick={() => setDraftPatch({ reason: r.id })}
                    >
                      {r.icon} {r.label}
                    </button>
                  ))}
                </div>
                {reason === 'Другое' && (
                  <div className="k-field" style={{ marginBottom: 6 }}>
                    <label>Опишите причину</label>
                    <input className="k-inp" value={customReason} onChange={e => setDraftPatch({ customReason: e.target.value })} placeholder="Например: утеря" />
                  </div>
                )}
                <div className="k-field" style={{ marginBottom: 0 }}>
                  <label>Комментарий</label>
                  <input className="k-inp" value={note} onChange={e => setDraftPatch({ note: e.target.value })} placeholder="Необязательно…" />
                </div>
              </div>

              <div className="k-wo-summary">
                <div><span>Поз.</span><b>{totals.count}</b></div>
                <div><span>Ед.</span><b>{totals.qtyTotal || '—'}</b></div>
                <div><span>Сумма</span><b style={{ color: 'var(--red)' }}>{fmtMoney(totals.costTotal)}</b></div>
                <div>
                  <span>Статус</span>
                  <b style={{ color: totals.hasOver ? 'var(--red)' : totals.count > 0 ? 'var(--green)' : 'var(--muted)' }}>
                    {totals.hasOver ? '⚠' : totals.count > 0 ? '✓' : '—'}
                  </b>
                </div>
              </div>

              {filledLines.length === 0 && (
                <div className="k-rcpt-empty">Нажмите + чтобы найти товар</div>
              )}

              {filledLines.map((line, idx) => {
                const product = products.find(p => p.id === line.productId) || null
                if (!product) return null
                return (
                  <WriteoffLineCard
                    key={line.key}
                    line={line}
                    idx={idx}
                    product={product}
                    active={activeLineKey === line.key}
                    canRemove={filledLines.length > 0}
                    onClear={() => selectProduct(line.key, null)}
                    onRemove={() => setDraft(prev => ({
                      ...prev,
                      lines: prev.lines.filter(l => l.key !== line.key),
                      activeLineKey: prev.activeLineKey === line.key ? null : prev.activeLineKey,
                    }))}
                    onActivate={() => setActiveLine(line.key)}
                    onQty={v => setLineQty(line.key, v)}
                    onWriteAll={() => writeAll(line.key)}
                    stockLimit={stockLimitFor(line.productId!)}
                    cardRef={el => { lineRefs.current[line.key] = el }}
                    qtyRef={el => { qtyRefs.current[line.key] = el }}
                  />
                )
              })}

              {msg && (
                <div className="k-rcpt-msg" style={{ margin: '8px 0 0' }}>{msg}</div>
              )}
            </div>

            <div className="k-receipt-modal-actions k-hide-mob">
              <button
                type="button"
                className="k-btn k-btn-g k-btn-primary-wide"
                style={{ background: 'linear-gradient(135deg,#FF5A5A,#cc4040)' }}
                disabled={saving || totals.hasOver || totals.count === 0}
                onClick={() => void submit()}
              >
                {saving ? 'Сохранение…' : editingId
                  ? `Сохранить${totals.costTotal > 0 ? ` · ${fmtMoney(totals.costTotal)}` : ''}`
                  : `Списать${totals.costTotal > 0 ? ` · ${fmtMoney(totals.costTotal)}` : ''}`}
              </button>
              <div className="k-btn-row">
                <button type="button" className="k-btn k-btn-s" disabled={saving} onClick={() => { if (confirm(editingId ? 'Отменить редактирование?' : 'Очистить черновик?')) resetForm() }}>{editingId ? 'Отмена' : 'Очистить'}</button>
                {editingId && (
                  <button
                    type="button"
                    className="k-btn k-btn-s"
                    style={{ color: 'var(--red)' }}
                    disabled={saving || deletingId === editingId}
                    onClick={() => void removeWriteoff(editingId)}
                  >
                    {deletingId === editingId ? 'Удаление…' : 'Удалить'}
                  </button>
                )}
                <button type="button" className="k-btn k-btn-s" disabled={saving} onClick={closeForm}>Закрыть</button>
              </div>
            </div>

            <button
              type="button"
              className="k-wh-fab k-wo-fab k-hide-desk"
              onClick={() => setAddOpen(true)}
              aria-label="Добавить товар"
              title="Добавить товар"
            >
              +
            </button>

            {addOpen && (
              <div className="k-rcpt-find-bg" onClick={() => setAddOpen(false)}>
                <div className="k-rcpt-find-modal" onClick={e => e.stopPropagation()}>
                  <div className="k-rcpt-find-h">
                    <div>
                      <b>Найти товар</b>
                      <div className="sub">Поиск по базе · штрихкод · цена · остаток · PLU</div>
                    </div>
                    <button type="button" className="k-rcpt-find-x" onClick={() => setAddOpen(false)}>✕</button>
                  </div>
                  <div className="k-rcpt-find-body">
                    <WarehouseProductSelect
                      products={products}
                      value={null}
                      onChange={p => { if (p) addProductFromFind(p) }}
                      placeholder="Поиск или сканер: название, артикул, штрихкод…"
                      autoFocus
                      variant="panel"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
