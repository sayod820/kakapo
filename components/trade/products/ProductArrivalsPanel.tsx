'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import { formatBulkPricingHint, serializeBulkPricing } from '@/lib/productBulkPricing'
import type { Product, ProductStockLayer } from '@/lib/types'
import BulkPricingFields, { type BulkPricingRow } from './BulkPricingFields'
import { money } from './productFormShared'

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
  } catch {
    return iso
  }
}

function bulkSummary(layer: ProductStockLayer) {
  const tiers = layer.bulkPricing || []
  if (!tiers.length) return '—'
  const best = tiers[tiers.length - 1]
  return `от ${best.minQty} шт → ${best.price.toFixed(2)}`
}

export default function ProductArrivalsPanel({
  product,
  open,
  onClose,
  onUpdated,
}: {
  product: Product
  open: boolean
  onClose: () => void
  onUpdated?: () => void
}) {
  const [layers, setLayers] = useState<ProductStockLayer[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  const [qty, setQty] = useState('')
  const [costPrice, setCostPrice] = useState('')
  const [retailPrice, setRetailPrice] = useState(String(product.price ?? ''))
  const [bulkPricing, setBulkPricing] = useState<BulkPricingRow[]>([])
  const [expiryDate, setExpiryDate] = useState('')

  const [editCost, setEditCost] = useState('')
  const [editRetail, setEditRetail] = useState('')
  const [editBulk, setEditBulk] = useState<BulkPricingRow[]>([])
  const [addDirty, setAddDirty] = useState(false)

  const sessionRef = useRef<{ productId: number | null }>({ productId: null })

  const loadLayers = useCallback(async (opts?: { silent?: boolean }) => {
    if (!USE_API || !product.id) {
      setLayers([])
      return
    }
    if (!opts?.silent) setLoading(true)
    try {
      const rows = await api.getProductStockLayers(product.id)
      setLayers(rows)
    } catch (e) {
      if (!opts?.silent) {
        setMsg(e instanceof Error ? e.message : 'Не удалось загрузить партии')
      }
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [product.id])

  function initAddForm() {
    setQty('')
    setCostPrice(product.costPrice != null ? String(product.costPrice) : '')
    setRetailPrice(String(product.price ?? ''))
    setBulkPricing([])
    setExpiryDate('')
    setAddDirty(false)
  }

  useEffect(() => {
    if (!open) {
      sessionRef.current.productId = null
      return
    }
    if (sessionRef.current.productId === product.id) return
    sessionRef.current.productId = product.id
    void loadLayers()
    setShowAdd(false)
    setEditId(null)
    setMsg('')
    initAddForm()
  }, [open, product.id, loadLayers])

  useEffect(() => {
    if (!open || showAdd || editId || addDirty) return
    void loadLayers({ silent: true })
  }, [open, product.stock, showAdd, editId, addDirty, loadLayers])

  function markAddDirty() {
    setAddDirty(true)
  }

  function requestClose() {
    if (addDirty && !confirm('Есть несохранённый приход. Закрыть без сохранения?')) return
    onClose()
  }

  function toggleAddForm() {
    if (showAdd) {
      if (addDirty && !confirm('Отменить несохранённый приход?')) return
      setShowAdd(false)
      setAddDirty(false)
      return
    }
    initAddForm()
    setShowAdd(true)
  }

  async function handleAdd() {
    const q = Number(qty)
    if (!(q > 0)) {
      setMsg('Укажите количество прихода')
      return
    }
    setSaving(true)
    setMsg('')
    try {
      await api.addProductStockLayer(product.id, {
        qty: q,
        costPrice: Number(costPrice) || 0,
        retailPrice: Number(retailPrice) || Number(product.price) || 0,
        bulkPricing: serializeBulkPricing(bulkPricing),
        expiryDate: expiryDate || null,
        supplierName: 'Ручной приход',
        createdBy: 'Торговля',
      })
      initAddForm()
      setShowAdd(false)
      await loadLayers()
      onUpdated?.()
      setMsg('Приход добавлен')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось добавить приход')
    } finally {
      setSaving(false)
    }
  }

  function startEdit(layer: ProductStockLayer) {
    setEditId(layer.receiptId)
    setEditCost(String(layer.costPrice))
    setEditRetail(String(layer.retailPrice))
    setEditBulk((layer.bulkPricing || []).map(t => ({ minQty: String(t.minQty), price: String(t.price) })))
  }

  async function handleSaveEdit(layer: ProductStockLayer) {
    setSaving(true)
    setMsg('')
    try {
      await api.updateProductStockLayer(layer.receiptId, product.id, {
        costPrice: Number(editCost) || 0,
        retailPrice: Number(editRetail) || 0,
        bulkPricing: serializeBulkPricing(editBulk),
      })
      setEditId(null)
      await loadLayers()
      onUpdated?.()
      setMsg('Партия обновлена')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const totalQty = layers.reduce((s, l) => s + l.remainingQty, 0)
  const bulkHint = formatBulkPricingHint({
    price: Number(retailPrice) || Number(product.price) || 0,
    sellType: product.sellType || 'piece',
    bulkPricing: serializeBulkPricing(bulkPricing),
  })

  return (
    <div className="k-modal-bg" onClick={requestClose}>
      <div className="k-modal k-modal-wide" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="k-modal-h">
          <div>
            <b>📦 Партии и приходы · {product.name}</b>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, fontWeight: 500 }}>
              FIFO: сначала активная партия, затем следующая в очереди
            </div>
            {addDirty && (
              <div style={{ fontSize: 11, color: 'var(--gold)', marginTop: 4, fontWeight: 700 }}>
                ● Несохранённый приход
              </div>
            )}
          </div>
          <button type="button" onClick={requestClose}>✕</button>
        </div>

        <div className="k-modal-b" style={{ padding: 16 }}>
          {msg && <div className="k-alert" style={{ marginBottom: 12 }}>{msg}</div>}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Остаток по партиям: <b style={{ color: 'var(--green)' }}>{totalQty}</b>
              {product.stock != null && totalQty !== Number(product.stock) && (
                <span style={{ marginLeft: 8, color: 'var(--gold)' }}>
                  (в карточке: {product.stock})
                </span>
              )}
            </div>
            <button type="button" className="k-btn k-btn-g" onClick={toggleAddForm}>
              {showAdd ? 'Отмена' : '+ Приход'}
            </button>
          </div>

          {showAdd && (
            <div style={{
              marginBottom: 16, padding: 14, borderRadius: 10,
              background: 'var(--green-d)', border: '1px solid rgba(31,215,96,.25)',
            }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--green)', marginBottom: 10 }}>Новый приход</div>
              <div className="k-grid2">
                <div className="k-field">
                  <label>Количество *</label>
                  <input className="k-inp" type="number" min="1" step="1" value={qty} onChange={e => { setQty(e.target.value); markAddDirty() }} />
                </div>
                <div className="k-field">
                  <label>Закупочная цена</label>
                  <input className="k-inp" type="number" step="0.01" value={costPrice} onChange={e => { setCostPrice(e.target.value); markAddDirty() }} />
                </div>
                <div className="k-field">
                  <label>Розничная цена</label>
                  <input className="k-inp" type="number" step="0.01" value={retailPrice} onChange={e => { setRetailPrice(e.target.value); markAddDirty() }} />
                </div>
                <div className="k-field">
                  <label>Срок годности</label>
                  <input className="k-inp" type="date" value={expiryDate} onChange={e => { setExpiryDate(e.target.value); markAddDirty() }} />
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <BulkPricingFields tiers={bulkPricing} onChange={v => { setBulkPricing(v); markAddDirty() }} sellType={product.sellType || 'piece'} />
                {bulkHint && <div style={{ fontSize: 11, color: '#FF8C00', marginTop: 8, fontWeight: 700 }}>{bulkHint}</div>}
              </div>
              <button type="button" className="k-btn k-btn-g" style={{ marginTop: 12 }} disabled={saving} onClick={() => void handleAdd()}>
                {saving ? 'Сохранение…' : 'Провести приход'}
              </button>
            </div>
          )}

          {loading && !showAdd && !layers.length ? (
            <div className="k-empty">Загрузка партий…</div>
          ) : !layers.length && !showAdd ? (
            <div className="k-empty">
              Нет партий. Добавьте первый приход — у каждой партии своя закупочная, розничная и оптовая цена.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="k-tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Статус</th>
                    <th className="num">Остаток</th>
                    <th className="num">Закуп</th>
                    <th className="num">Розница</th>
                    <th>Опт</th>
                    <th>Дата</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {layers.map((layer, i) => (
                    <Fragment key={layer.receiptId}>
                      <tr>
                        <td>{i + 1}</td>
                        <td>
                          <span className="k-badge" style={{
                            background: layer.isActive ? 'rgba(31,215,96,.2)' : '#1a2430',
                            color: layer.isActive ? 'var(--green)' : 'var(--muted)',
                          }}>
                            {layer.isActive ? '● Активная' : `Очередь ${layer.queueIndex + 1}`}
                          </span>
                        </td>
                        <td className="num" style={{ fontWeight: 800 }}>{layer.remainingQty}</td>
                        <td className="num">{money(layer.costPrice)}</td>
                        <td className="num" style={{ color: 'var(--green)' }}>{money(layer.retailPrice)}</td>
                        <td style={{ fontSize: 11, color: '#FF8C00' }}>{bulkSummary(layer)}</td>
                        <td style={{ fontSize: 11, color: 'var(--muted)' }}>{formatDate(layer.createdAtIso)}</td>
                        <td>
                          <button type="button" className="k-btn k-btn-s" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => startEdit(layer)}>
                            {editId === layer.receiptId ? '▼' : 'Изменить'}
                          </button>
                        </td>
                      </tr>
                      {editId === layer.receiptId && (
                        <tr>
                          <td colSpan={8} style={{ background: '#0e1712', padding: 12 }}>
                            <div className="k-grid2" style={{ marginBottom: 10 }}>
                              <div className="k-field">
                                <label>Закупочная</label>
                                <input className="k-inp" type="number" step="0.01" value={editCost} onChange={e => setEditCost(e.target.value)} />
                              </div>
                              <div className="k-field">
                                <label>Розничная</label>
                                <input className="k-inp" type="number" step="0.01" value={editRetail} onChange={e => setEditRetail(e.target.value)} />
                              </div>
                            </div>
                            <BulkPricingFields tiers={editBulk} onChange={setEditBulk} sellType={product.sellType || 'piece'} />
                            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                              <button type="button" className="k-btn k-btn-g" disabled={saving} onClick={() => void handleSaveEdit(layer)}>
                                Сохранить партию
                              </button>
                              <button type="button" className="k-btn k-btn-s" onClick={() => setEditId(null)}>Отмена</button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
