'use client'

import { Fragment, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import type { Product, StockRevision } from '@/lib/types'
import WarehouseProductSelect from './WarehouseProductSelect'
import { fmtDateTime } from './warehouseShared'

type Line = { key: string; productId: number | null; countedStock: string }

function emptyLine(): Line {
  return { key: String(Date.now() + Math.random()), productId: null, countedStock: '' }
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
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [lines, setLines] = useState<Line[]>([emptyLine()])
  const [expanded, setExpanded] = useState<string | null>(null)

  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

  function resetForm() {
    setLines([emptyLine()])
    setMsg('')
  }

  function updateLine(key: string, patch: Partial<Line>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)))
  }

  async function submit() {
    if (!USE_API) return
    const items = lines
      .filter(l => l.productId != null && l.countedStock !== '')
      .map(l => ({ productId: l.productId!, countedStock: Number(l.countedStock) }))
    if (!items.length) {
      setMsg('Добавьте товары с фактическим остатком')
      return
    }
    setSaving(true)
    setMsg('')
    try {
      await api.createStockRevision({ items })
      await onRefresh()
      resetForm()
      setOpen(false)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 420 }}>
          Инвентаризация: укажите фактический остаток — система обновит общий остаток товара
        </div>
        <button type="button" className="k-btn k-btn-g" disabled={!USE_API} onClick={() => { resetForm(); setOpen(true) }}>
          + Новая ревизия
        </button>
      </div>

      {!revisions.length ? (
        <div className="k-empty">Ревизий пока нет</div>
      ) : (
        <div className="k-card k-tbl-scroll">
          <table className="k-tbl">
            <thead>
              <tr>
                <th>Дата</th>
                <th className="num">Позиций</th>
                <th className="num">Расхождение</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {revisions.map(rev => {
                const totalDiff = rev.items.reduce((s, it) => s + it.diff, 0)
                return (
                  <Fragment key={rev.id}>
                    <tr>
                      <td>{fmtDateTime(rev.createdAtIso)}</td>
                      <td className="num">{rev.items.length}</td>
                      <td className="num" style={{ color: totalDiff === 0 ? 'var(--muted)' : totalDiff > 0 ? 'var(--green)' : 'var(--red)' }}>
                        {totalDiff > 0 ? '+' : ''}{totalDiff}
                      </td>
                      <td>
                        <button type="button" className="k-btn k-btn-s" style={{ padding: '4px 10px' }} onClick={() => setExpanded(expanded === rev.id ? null : rev.id)}>
                          {expanded === rev.id ? '▲' : '▼'}
                        </button>
                      </td>
                    </tr>
                    {expanded === rev.id && (
                      <tr>
                        <td colSpan={4} style={{ background: 'var(--card2)', padding: 0 }}>
                          <table className="k-tbl">
                            <thead>
                              <tr>
                                <th>Товар</th>
                                <th className="num">Было</th>
                                <th className="num">Стало</th>
                                <th className="num">Δ</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rev.items.map((it, i) => (
                                <tr key={i}>
                                  <td>{it.productName}</td>
                                  <td className="num">{it.systemStock}</td>
                                  <td className="num">{it.countedStock}</td>
                                  <td className="num" style={{ color: it.diff === 0 ? 'var(--muted)' : it.diff > 0 ? 'var(--green)' : 'var(--red)' }}>
                                    {it.diff > 0 ? '+' : ''}{it.diff}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
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
        <div className="k-modal-bg" onClick={() => !saving && setOpen(false)}>
          <div className="k-modal k-modal-wide" onClick={e => e.stopPropagation()}>
            <div className="k-modal-h">
              <b>📋 Ревизия</b>
              <button type="button" onClick={() => !saving && setOpen(false)}>✕</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              {lines.map((line, idx) => {
                const product = line.productId ? productMap.get(line.productId) : null
                const system = product?.stock ?? 0
                const counted = line.countedStock !== '' ? Number(line.countedStock) : null
                const diff = counted != null ? counted - system : null
                return (
                  <div key={line.key} className="k-line-row k-line-row--5">
                    <div className="k-field" style={{ marginBottom: 0 }}>
                      {idx === 0 && <label>Товар</label>}
                      <WarehouseProductSelect products={products} value={line.productId} onChange={p => updateLine(line.key, { productId: p?.id ?? null, countedStock: p ? String(p.stock ?? 0) : '' })} />
                    </div>
                    <div className="k-field" style={{ marginBottom: 0 }}>
                      {idx === 0 && <label>В системе</label>}
                      <input className="k-inp" readOnly value={product ? String(system) : '—'} style={{ opacity: 0.7 }} />
                    </div>
                    <div className="k-field" style={{ marginBottom: 0 }}>
                      {idx === 0 && <label>Факт</label>}
                      <input className="k-inp" type="number" step="any" value={line.countedStock} onChange={e => updateLine(line.key, { countedStock: e.target.value })} />
                    </div>
                    <div className="k-field" style={{ marginBottom: 0 }}>
                      {idx === 0 && <label>Δ</label>}
                      <input className="k-inp" readOnly value={diff != null ? (diff > 0 ? `+${diff}` : String(diff)) : '—'} style={{ color: diff == null || diff === 0 ? 'var(--muted)' : diff > 0 ? 'var(--green)' : 'var(--red)' }} />
                    </div>
                    <button type="button" className="k-btn k-btn-s" style={{ padding: '9px 10px' }} disabled={lines.length <= 1} onClick={() => setLines(prev => prev.filter(l => l.key !== line.key))}>✕</button>
                  </div>
                )
              })}
              <button type="button" className="k-btn k-btn-s" style={{ marginBottom: 12 }} onClick={() => setLines(prev => [...prev, emptyLine()])}>+ Строка</button>

              {msg && <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>{msg}</div>}

              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} disabled={saving} onClick={() => void submit()}>
                  {saving ? 'Сохранение…' : 'Провести ревизию'}
                </button>
                <button type="button" className="k-btn k-btn-s" disabled={saving} onClick={() => setOpen(false)}>Отмена</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
