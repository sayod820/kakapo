'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
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
import { fmtDateTime, fmtMoney, matchesDateRange, WRITEOFF_REASONS, writeoffReasonMeta } from './warehouseShared'

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
      whiteSpace: 'nowrap',
    }}>
      <span>{meta.icon}</span>
      {reason}
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
      onClick={onActivate}
      style={{
        padding: 14,
        borderRadius: 12,
        border: `1px solid ${overStock ? 'var(--red)' : active ? 'var(--red)' : 'var(--border)'}`,
        background: overStock ? 'rgba(255,90,90,.06)' : active ? 'rgba(255,90,90,.04)' : 'var(--card2)',
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
              {product.art || '—'} · на складе <b style={{ color: noStock ? 'var(--red)' : stock <= 5 ? 'var(--gold)' : 'var(--text)' }}>{stock} {unit}</b>
              {unitCost > 0 && <> · закуп {fmtMoney(unitCost)}/{unit}</>}
            </div>
          </div>
          <button type="button" className="k-btn k-btn-s" style={{ fontSize: 11 }} onClick={e => { e.stopPropagation(); onClear() }}>Сменить</button>
        </div>
        {canRemove && (
          <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px' }} onClick={e => { e.stopPropagation(); onRemove() }}>✕</button>
        )}
      </div>

      <div className="k-grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
        <div className="k-field" style={{ marginBottom: 0 }}>
          <label>Кол-во ({unit})</label>
          <input
            ref={qtyRef}
            className="k-inp"
            type="number"
            min="0"
            step="any"
            max={stock > 0 ? stock : undefined}
            value={line.qty}
            onChange={e => onQty(e.target.value)}
            onClick={e => e.stopPropagation()}
            style={overStock ? { borderColor: 'var(--red)' } : undefined}
          />
        </div>
        <div className="k-field" style={{ marginBottom: 0 }}>
          <label>Себестоимость</label>
          <div className="k-inp" style={{ display: 'flex', alignItems: 'center', opacity: 0.85, cursor: 'default' }}>
            {unitCost > 0 ? fmtMoney(unitCost) : '—'}
          </div>
        </div>
        <div className="k-field" style={{ marginBottom: 0 }}>
          <label>Сумма списания</label>
          <div className="k-inp" style={{ display: 'flex', alignItems: 'center', fontWeight: 900, color: total > 0 ? 'var(--red)' : 'var(--muted)', cursor: 'default' }}>
            {total > 0 ? fmtMoney(total) : '—'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {stock > 0 && (
          <button
            type="button"
            className="k-btn k-btn-s"
            style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={e => { e.stopPropagation(); onWriteAll() }}
          >
            Списать всё ({stock} {unit})
          </button>
        )}
        {overStock && (
          <span style={{ fontSize: 12, color: 'var(--red)', fontWeight: 700 }}>
            ⚠ Превышает остаток на {(qty - stock).toFixed(2)} {unit}
          </span>
        )}
        {noStock && qty > 0 && (
          <span style={{ fontSize: 12, color: 'var(--red)', fontWeight: 700 }}>⚠ Товара нет на складе</span>
        )}
      </div>
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
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [reasonFilter, setReasonFilter] = useState('all')
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
    setMsg('')
  }

  function openForm() {
    setEditingId(null)
    setDraft(prev => ({ ...prev, open: true }))
    setMsg('')
  }

  function openEditForm(writeoff: StockWriteoff) {
    setEditingId(writeoff.id)
    setDraft(writeoffToDraft(writeoff))
    setMsg('')
  }

  function closeForm() {
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
        await api.updateStockWriteoff(editingId, payload)
      } else {
        await api.createStockWriteoff(payload)
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
          <div className="kl">Всего списаний</div>
          <div className="kv">{writeoffs.length}</div>
        </div>
        <div className="k-kpi k-statcard">
          <div className="kl">Сумма списаний</div>
          <div className="kv" style={{ color: 'var(--red)' }}>{fmtMoney(listStats.totalCost)}</div>
        </div>
        <div className="k-kpi k-statcard">
          <div className="kl">За 30 дней</div>
          <div className="kv" style={{ fontSize: 18 }}>
            {listStats.monthCount} · <span style={{ color: 'var(--red)' }}>{fmtMoney(listStats.monthCost)}</span>
          </div>
        </div>
        <div className="k-kpi k-statcard">
          <div className="kl">Единиц списано</div>
          <div className="kv">{listStats.totalQty}</div>
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
            Показано: <b style={{ color: 'var(--text)' }}>{filtered.length}</b> из {writeoffs.length}
          </span>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: '1 1 auto' }}>
          <button
            type="button"
            className={`k-subtab ${reasonFilter === 'all' ? 'active' : ''}`}
            style={{ padding: '6px 12px', fontSize: 12 }}
            onClick={() => setReasonFilter('all')}
          >
            Все
          </button>
          {WRITEOFF_REASONS.map(r => (
            <button
              key={r.id}
              type="button"
              className={`k-subtab ${reasonFilter === r.id ? 'active' : ''}`}
              style={{ padding: '6px 12px', fontSize: 12 }}
              onClick={() => setReasonFilter(r.id)}
            >
              {r.icon} {r.label}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {hasDraft && !open && (
            <span style={{ fontSize: 12, color: 'var(--gold)', fontWeight: 700 }}>● Черновик</span>
          )}
          <button type="button" className="k-btn k-btn-g" disabled={!USE_API} onClick={openForm}>
            + Новое списание
          </button>
        </div>
      </div>

      {!filtered.length ? (
        <div className="k-empty">
          {writeoffs.length ? 'За выбранный период списаний нет' : 'Списаний пока нет — нажмите «Новое списание»'}
        </div>
      ) : (
        <div className="k-card k-tbl-scroll">
          <table className="k-tbl">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Причина</th>
                <th className="num">Позиций</th>
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
                      <td>{fmtDateTime(w.createdAtIso)}</td>
                      <td>
                        <ReasonBadge reason={w.reason} />
                        {w.note && (
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {w.note}
                          </div>
                        )}
                      </td>
                      <td className="num">{w.items.length}</td>
                      <td className="num">{qtySum}</td>
                      <td className="num" style={{ color: 'var(--red)', fontWeight: 800 }}>{fmtMoney(w.totalCost)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          <button type="button" className="k-btn k-btn-s" style={{ padding: '4px 10px' }} disabled={!USE_API} onClick={e => { e.stopPropagation(); openEditForm(w) }} title="Редактировать">✎</button>
                          <button type="button" className="k-btn k-btn-s" style={{ padding: '4px 10px' }} onClick={e => { e.stopPropagation(); setExpanded(isOpen ? null : w.id) }}>
                            {isOpen ? '▲' : '▼'}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={6} style={{ background: 'var(--card2)', padding: '12px 14px' }}>
                          <div style={{ display: 'grid', gap: 8 }}>
                            {w.items.map((it, i) => {
                              const product = products.find(p => p.id === it.productId)
                              const unitCost = it.unitCost ?? (it.lineCost && it.qty ? it.lineCost / it.qty : product?.costPrice)
                              const lineSum = it.lineCost ?? (unitCost != null ? Number(unitCost) * it.qty : null)
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
                                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>Кол-во</div>
                                    <div style={{ fontWeight: 900 }}>{it.qty} {product?.unit || 'шт'}</div>
                                  </div>
                                  {unitCost != null && (
                                    <div style={{ textAlign: 'right' }}>
                                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Закуп</div>
                                      <div>{fmtMoney(unitCost)}</div>
                                    </div>
                                  )}
                                  {lineSum != null && (
                                    <div style={{ textAlign: 'right' }}>
                                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Сумма</div>
                                      <div style={{ fontWeight: 900, color: 'var(--red)' }}>{fmtMoney(lineSum)}</div>
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
          <div
            className="k-modal k-receipt-modal"
            onClick={e => e.stopPropagation()}
            style={{ display: 'flex', flexDirection: 'column' }}
          >
            <div className="k-modal-h" style={{ flexShrink: 0 }}>
              <div>
                <b>{editingId ? '✎ Редактирование списания' : '📤 Новое списание'}</b>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginTop: 2 }}>
                  {editingId ? 'Измените товары и причину — остатки пересчитаются' : 'Выберите товар → укажите количество → проведите списание'}
                </div>
              </div>
              <button type="button" onClick={closeForm}>✕</button>
            </div>

            <div style={{ flexShrink: 0, padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--card2)' }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700, marginBottom: 8 }}>Причина списания</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: reason === 'Другое' || note ? 10 : 0 }}>
                {WRITEOFF_REASONS.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setDraftPatch({ reason: r.id })}
                    style={{
                      border: `1px solid ${reason === r.id ? r.color : 'var(--border)'}`,
                      background: reason === r.id ? r.bg : 'var(--card)',
                      color: reason === r.id ? r.color : 'var(--muted)',
                      borderRadius: 10, padding: '8px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    {r.icon} {r.label}
                  </button>
                ))}
              </div>
              {reason === 'Другое' && (
                <div className="k-field" style={{ marginBottom: 8 }}>
                  <label>Опишите причину</label>
                  <input className="k-inp" value={customReason} onChange={e => setDraftPatch({ customReason: e.target.value })} placeholder="Например: утеря при транспортировке" />
                </div>
              )}
              <div className="k-field" style={{ marginBottom: 0 }}>
                <label>Комментарий (необязательно)</label>
                <input className="k-inp" value={note} onChange={e => setDraftPatch({ note: e.target.value })} placeholder="Дополнительная информация…" />
              </div>
            </div>

            <div className="k-receipt-summary" style={{
              flexShrink: 0,
              padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--panel)',
            }}>
              <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>Позиций</div><div style={{ fontWeight: 900, fontSize: 18 }}>{totals.count}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>Единиц</div><div style={{ fontWeight: 900, fontSize: 18 }}>{totals.qtyTotal || '—'}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>Сумма списания</div><div style={{ fontWeight: 900, fontSize: 18, color: 'var(--red)' }}>{fmtMoney(totals.costTotal)}</div></div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Статус</div>
                <div style={{ fontWeight: 900, fontSize: 14, color: totals.hasOver ? 'var(--red)' : totals.count > 0 ? 'var(--green)' : 'var(--muted)' }}>
                  {totals.hasOver ? '⚠ Ошибка' : totals.count > 0 ? '✓ Готово' : '—'}
                </div>
              </div>
            </div>

            <div ref={bodyRef} className="k-modal-b" onScroll={onBodyScroll} style={{ flex: 1, overflow: 'auto', padding: '12px 16px', minHeight: 0 }}>
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

              {(() => {
                const pending = [...lines].reverse().find(l => !l.productId)
                if (!pending) return null
                const pendingIdx = lines.filter(l => l.productId).length
                return (
                  <div
                    ref={el => { lineRefs.current[pending.key] = el }}
                    style={{
                      padding: 16,
                      borderRadius: 12,
                      border: '2px dashed var(--red)',
                      background: 'rgba(255,90,90,.04)',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--red)', marginBottom: 10 }}>
                      {filledLines.length ? `+ Добавить товар ${pendingIdx + 1}` : '1. Найдите товар для списания'}
                    </div>
                    <WarehouseProductSelect
                      products={products}
                      value={null}
                      onChange={p => { if (p) selectProduct(pending.key, p) }}
                      placeholder="Начните вводить название, артикул или штрихкод…"
                    />
                  </div>
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
                style={{ flex: 1, minWidth: 180, background: 'linear-gradient(135deg,#FF5A5A,#cc4040)' }}
                disabled={saving || totals.hasOver || totals.count === 0}
                onClick={() => void submit()}
              >
                {saving ? 'Сохранение…' : editingId
                  ? `Сохранить${totals.costTotal > 0 ? ` · ${fmtMoney(totals.costTotal)}` : ''}`
                  : `Списать${totals.costTotal > 0 ? ` · ${fmtMoney(totals.costTotal)}` : ''}`}
              </button>
              <button type="button" className="k-btn k-btn-s" disabled={saving} onClick={() => { if (confirm(editingId ? 'Отменить редактирование?' : 'Очистить черновик?')) resetForm() }}>{editingId ? 'Отмена' : 'Очистить'}</button>
              <button type="button" className="k-btn k-btn-s" disabled={saving} onClick={closeForm}>Закрыть</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
