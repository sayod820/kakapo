'use client'

import { Fragment, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import type { Product, StockWriteoff } from '@/lib/types'
import WarehouseProductSelect from './WarehouseProductSelect'
import { fmtDateTime, fmtMoney } from './warehouseShared'

type Line = { key: string; productId: number | null; qty: string }

const REASONS = ['Порча', 'Брак', 'Просрочка', 'Подарок', 'Внутреннее использование', 'Другое']

function emptyLine(): Line {
  return { key: String(Date.now() + Math.random()), productId: null, qty: '' }
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
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [reason, setReason] = useState(REASONS[0])
  const [customReason, setCustomReason] = useState('')
  const [lines, setLines] = useState<Line[]>([emptyLine()])
  const [expanded, setExpanded] = useState<string | null>(null)

  function resetForm() {
    setReason(REASONS[0])
    setCustomReason('')
    setLines([emptyLine()])
    setMsg('')
  }

  function updateLine(key: string, patch: Partial<Line>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)))
  }

  async function submit() {
    if (!USE_API) return
    const finalReason = reason === 'Другое' ? customReason.trim() : reason
    if (!finalReason) {
      setMsg('Укажите причину списания')
      return
    }
    const items = lines
      .filter(l => l.productId && Number(l.qty) > 0)
      .map(l => ({ productId: l.productId!, qty: Number(l.qty) }))
    if (!items.length) {
      setMsg('Добавьте товары для списания')
      return
    }
    setSaving(true)
    setMsg('')
    try {
      await api.createStockWriteoff({ reason: finalReason, items })
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
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button type="button" className="k-btn k-btn-g" disabled={!USE_API} onClick={() => { resetForm(); setOpen(true) }}>
          + Новое списание
        </button>
      </div>

      {!writeoffs.length ? (
        <div className="k-empty">Списаний пока нет</div>
      ) : (
        <div className="k-card k-tbl-scroll">
          <table className="k-tbl">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Причина</th>
                <th className="num">Позиций</th>
                <th className="num">Сумма</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {writeoffs.map(w => (
                <Fragment key={w.id}>
                  <tr>
                    <td>{fmtDateTime(w.createdAtIso)}</td>
                    <td>{w.reason}</td>
                    <td className="num">{w.items.length}</td>
                    <td className="num">{fmtMoney(w.totalCost)}</td>
                    <td>
                      <button type="button" className="k-btn k-btn-s" style={{ padding: '4px 10px' }} onClick={() => setExpanded(expanded === w.id ? null : w.id)}>
                        {expanded === w.id ? '▲' : '▼'}
                      </button>
                    </td>
                  </tr>
                  {expanded === w.id && (
                    <tr>
                      <td colSpan={5} style={{ background: 'var(--card2)', padding: 0 }}>
                        <table className="k-tbl">
                          <thead><tr><th>Товар</th><th className="num">Кол-во</th></tr></thead>
                          <tbody>
                            {w.items.map((it, i) => (
                              <tr key={i}><td>{it.productName}</td><td className="num">{it.qty}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="k-modal-bg" onClick={() => !saving && setOpen(false)}>
          <div className="k-modal k-modal-wide" onClick={e => e.stopPropagation()}>
            <div className="k-modal-h">
              <b>📤 Списание</b>
              <button type="button" onClick={() => !saving && setOpen(false)}>✕</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              <div className="k-grid2" style={{ marginBottom: 12 }}>
                <div className="k-field">
                  <label>Причина</label>
                  <select className="k-sel" value={reason} onChange={e => setReason(e.target.value)}>
                    {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                {reason === 'Другое' && (
                  <div className="k-field">
                    <label>Описание</label>
                    <input className="k-inp" value={customReason} onChange={e => setCustomReason(e.target.value)} />
                  </div>
                )}
              </div>

              {lines.map((line, idx) => {
                const product = products.find(p => p.id === line.productId)
                return (
                  <div key={line.key} className="k-line-row k-line-row--3">
                    <div className="k-field" style={{ marginBottom: 0 }}>
                      {idx === 0 && <label>Товар</label>}
                      <WarehouseProductSelect products={products} value={line.productId} onChange={p => updateLine(line.key, { productId: p?.id ?? null })} />
                    </div>
                    <div className="k-field" style={{ marginBottom: 0 }}>
                      {idx === 0 && <label>Кол-во</label>}
                      <input className="k-inp" type="number" min="0" step="any" value={line.qty} onChange={e => updateLine(line.key, { qty: e.target.value })} />
                    </div>
                    <button type="button" className="k-btn k-btn-s" style={{ padding: '9px 10px' }} disabled={lines.length <= 1} onClick={() => setLines(prev => prev.filter(l => l.key !== line.key))}>✕</button>
                    {product && (
                      <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--muted)', marginTop: -4 }}>
                        На складе: {product.stock ?? 0} {product.unit || 'шт'}
                      </div>
                    )}
                  </div>
                )
              })}
              <button type="button" className="k-btn k-btn-s" style={{ marginBottom: 12 }} onClick={() => setLines(prev => [...prev, emptyLine()])}>+ Строка</button>

              {msg && <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>{msg}</div>}

              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} disabled={saving} onClick={() => void submit()}>
                  {saving ? 'Сохранение…' : 'Списать'}
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
