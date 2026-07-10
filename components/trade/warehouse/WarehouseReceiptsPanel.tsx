'use client'

import { Fragment, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import { useProducts } from '@/lib/store'
import type { PosSupplier, Product, StockReceipt } from '@/lib/types'
import WarehouseProductSelect from './WarehouseProductSelect'
import { fmtDateTime, fmtMoney } from './warehouseShared'

type Line = {
  key: string
  productId: number | null
  qty: string
  costPrice: string
  expiryDate: string
}

function emptyLine(): Line {
  return { key: String(Date.now() + Math.random()), productId: null, qty: '', costPrice: '', expiryDate: '' }
}

export default function WarehouseReceiptsPanel({
  receipts,
  suppliers,
  products,
  onRefresh,
}: {
  receipts: StockReceipt[]
  suppliers: PosSupplier[]
  products: Product[]
  onRefresh: () => Promise<void>
}) {
  const fetchProducts = useProducts(s => s.fetchProducts)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [paidNow, setPaidNow] = useState('')
  const [lines, setLines] = useState<Line[]>([emptyLine()])
  const [expanded, setExpanded] = useState<string | null>(null)

  function resetForm() {
    setSupplierId('')
    setPaidNow('')
    setLines([emptyLine()])
    setMsg('')
  }

  function updateLine(key: string, patch: Partial<Line>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)))
  }

  async function submit() {
    if (!USE_API) return
    const items = lines
      .filter(l => l.productId && Number(l.qty) > 0)
      .map(l => ({
        productId: l.productId!,
        qty: Number(l.qty),
        costPrice: Number(l.costPrice) || 0,
        expiryDate: l.expiryDate || null,
      }))
    if (!items.length) {
      setMsg('Добавьте хотя бы один товар с количеством')
      return
    }
    setSaving(true)
    setMsg('')
    try {
      await api.createStockReceipt({
        supplierId: supplierId || undefined,
        paidNow: Number(paidNow) || 0,
        items,
      })
      await Promise.all([onRefresh(), fetchProducts()])
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
          + Новый приход
        </button>
      </div>

      {!receipts.length ? (
        <div className="k-empty">Приходов пока нет</div>
      ) : (
        <div className="k-card" style={{ overflow: 'hidden' }}>
          <table className="k-tbl">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Поставщик</th>
                <th className="num">Позиций</th>
                <th className="num">Сумма</th>
                <th className="num">Оплачено</th>
                <th className="num">Долг</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {receipts.map(r => (
                <Fragment key={r.id}>
                  <tr>
                    <td>{fmtDateTime(r.createdAtIso)}</td>
                    <td>{r.supplierName || '—'}</td>
                    <td className="num">{r.items.length}</td>
                    <td className="num">{fmtMoney(r.totalCost)}</td>
                    <td className="num">{fmtMoney(r.paidNow)}</td>
                    <td className="num" style={{ color: r.debtAdded > 0 ? 'var(--gold)' : 'var(--muted)' }}>
                      {r.debtAdded > 0 ? fmtMoney(r.debtAdded) : '—'}
                    </td>
                    <td>
                      <button type="button" className="k-btn k-btn-s" style={{ padding: '4px 10px' }} onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                        {expanded === r.id ? '▲' : '▼'}
                      </button>
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr>
                      <td colSpan={7} style={{ background: 'var(--card2)', padding: 0 }}>
                        <table className="k-tbl" style={{ margin: 0 }}>
                          <thead>
                            <tr>
                              <th>Товар</th>
                              <th className="num">Кол-во</th>
                              <th className="num">Себест.</th>
                              <th>Срок</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.items.map((it, i) => (
                              <tr key={i}>
                                <td>{it.productName}</td>
                                <td className="num">{it.qty}</td>
                                <td className="num">{fmtMoney(it.costPrice)}</td>
                                <td>{it.expiryDate || '—'}</td>
                              </tr>
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
              <b>📥 Новый приход</b>
              <button type="button" onClick={() => !saving && setOpen(false)}>✕</button>
            </div>
            <div className="k-modal-b" style={{ padding: 16 }}>
              <div className="k-grid2">
                <div className="k-field">
                  <label>Поставщик</label>
                  <select className="k-sel" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                    <option value="">Без поставщика</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="k-field">
                  <label>Оплачено сейчас (сом)</label>
                  <input className="k-inp" type="number" min="0" step="0.01" value={paidNow} onChange={e => setPaidNow(e.target.value)} />
                </div>
              </div>

              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--green)', marginBottom: 8 }}>Товары</div>
              {lines.map((line, idx) => {
                const product = products.find(p => p.id === line.productId) || null
                return (
                  <div key={line.key} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px 120px auto', gap: 8, marginBottom: 8, alignItems: 'end' }}>
                    <div className="k-field" style={{ marginBottom: 0 }}>
                      {idx === 0 && <label>Товар</label>}
                      <WarehouseProductSelect
                        products={products}
                        value={line.productId}
                        onChange={p => updateLine(line.key, {
                          productId: p?.id ?? null,
                          costPrice: p?.costPrice != null ? String(p.costPrice) : line.costPrice,
                        })}
                      />
                    </div>
                    <div className="k-field" style={{ marginBottom: 0 }}>
                      {idx === 0 && <label>Кол-во</label>}
                      <input className="k-inp" type="number" min="0" step="any" value={line.qty} onChange={e => updateLine(line.key, { qty: e.target.value })} />
                    </div>
                    <div className="k-field" style={{ marginBottom: 0 }}>
                      {idx === 0 && <label>Себест.</label>}
                      <input className="k-inp" type="number" min="0" step="0.01" value={line.costPrice} onChange={e => updateLine(line.key, { costPrice: e.target.value })} />
                    </div>
                    <div className="k-field" style={{ marginBottom: 0 }}>
                      {idx === 0 && <label>Срок</label>}
                      <input className="k-inp" type="date" value={line.expiryDate} onChange={e => updateLine(line.key, { expiryDate: e.target.value })} />
                    </div>
                    <button type="button" className="k-btn k-btn-s" style={{ padding: '9px 10px' }} disabled={lines.length <= 1} onClick={() => setLines(prev => prev.filter(l => l.key !== line.key))}>✕</button>
                    {product && (
                      <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--muted)', marginTop: -4 }}>
                        Остаток: {product.stock ?? 0} {product.unit || 'шт'}
                      </div>
                    )}
                  </div>
                )
              })}
              <button type="button" className="k-btn k-btn-s" style={{ marginBottom: 12 }} onClick={() => setLines(prev => [...prev, emptyLine()])}>+ Строка</button>

              {msg && <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>{msg}</div>}

              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} disabled={saving} onClick={() => void submit()}>
                  {saving ? 'Сохранение…' : 'Провести приход'}
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
