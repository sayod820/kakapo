'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import { createStockReceiptSafe, updateStockLayerSafe } from '@/lib/offlineWarehouseOps'
import { formatBulkPricingHint, serializeBulkPricing } from '@/lib/productBulkPricing'
import type { Product, ProductStockLayer, StockReceipt } from '@/lib/types'
import BulkPricingFields, { type BulkPricingRow } from './BulkPricingFields'
import { money, sanitizeDecimal } from './productFormShared'
import ProductEditModal from './ProductEditModal'
import ReceiptLabelPrintModal from '@/components/trade/warehouse/ReceiptLabelPrintModal'

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

function receiptFromLayer(product: Product, layer: ProductStockLayer): StockReceipt {
  return {
    id: layer.receiptId,
    supplierName: layer.supplierName || 'Ручной приход',
    createdAtIso: layer.createdAtIso,
    totalCost: (Number(layer.qty) || 0) * (Number(layer.costPrice) || 0),
    paidNow: 0,
    debtAdded: 0,
    items: [{
      productId: product.id,
      productName: product.name,
      qty: layer.qty,
      remainingQty: layer.remainingQty,
      costPrice: layer.costPrice,
      retailPrice: layer.retailPrice,
      bulkPricing: layer.bulkPricing,
      expiryDate: layer.expiryDate,
    }],
  }
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
  const [editProductOpen, setEditProductOpen] = useState(false)

  const [qty, setQty] = useState('')
  const [retailPrice, setRetailPrice] = useState(String(product.price ?? ''))
  const [bulkPricing, setBulkPricing] = useState<BulkPricingRow[]>([])
  const [expiryDate, setExpiryDate] = useState('')

  const [editRetail, setEditRetail] = useState('')
  const [editBulk, setEditBulk] = useState<BulkPricingRow[]>([])
  const [addDirty, setAddDirty] = useState(false)
  const [labelReceipt, setLabelReceipt] = useState<StockReceipt | null>(null)

  const sessionRef = useRef<{ productId: number | null }>({ productId: null })

  const loadLayers = useCallback(async (opts?: { silent?: boolean }) => {
    if (!product.id) {
      setLayers([])
      return
    }
    if (!opts?.silent) setLoading(true)
    try {
      const { readCachedStockLayers } = await import('@/lib/stockLayersLocal')
      const cached = (await readCachedStockLayers()).filter(l => Number(l.productId) === product.id)
      setLayers(cached)
      if (!opts?.silent) setLoading(false)
      if (!USE_API) return
      // Сеть в фоне — не блокируем окно при слабом интернете
      void api.getProductStockLayers(product.id).then(rows => {
        setLayers(rows)
      }).catch((e: unknown) => {
        if (!cached.length && !opts?.silent) {
          setMsg(e instanceof Error ? e.message : 'Не удалось загрузить партии')
        }
      })
    } catch (e) {
      setLayers([])
      if (!opts?.silent) {
        setMsg(e instanceof Error ? e.message : 'Не удалось загрузить партии')
        setLoading(false)
      }
    }
  }, [product.id])

  function initAddForm() {
    setQty('')
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
    setEditProductOpen(false)
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
      const cost = 0
      const retail = Number(retailPrice) || Number(product.price) || 0
      const bulk = serializeBulkPricing(bulkPricing)
      const res = await createStockReceiptSafe({
        createdBy: 'Торговля',
        paidNow: 0,
        items: [{
          productId: product.id,
          qty: q,
          costPrice: cost,
          retailPrice: retail,
          bulkPricing: bulk,
          expiryDate: expiryDate || null,
        }],
      })
      const receipt = {
        ...res.data,
        supplierName: res.data.supplierName || 'Ручной приход',
      }
      initAddForm()
      setShowAdd(false)
      if (res.offline) {
        const item = receipt.items[0]
        const layer: ProductStockLayer = {
          receiptId: receipt.id,
          productId: product.id,
          productName: product.name,
          qty: Number(item?.qty) || q,
          remainingQty: Number(item?.remainingQty ?? item?.qty) || q,
          costPrice: cost,
          retailPrice: retail,
          bulkPricing: bulk || [],
          expiryDate: expiryDate || null,
          createdAtIso: receipt.createdAtIso,
          supplierName: 'Ручной приход',
          layerIndex: 0,
          isActive: true,
        }
        setLayers(prev => [layer, ...prev])
        setMsg('Приход сохранён локально · отправится при связи')
      } else {
        await loadLayers()
        setMsg('Приход добавлен')
      }
      onUpdated?.()
      setLabelReceipt(receipt)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось добавить приход')
    } finally {
      setSaving(false)
    }
  }

  function startEdit(layer: ProductStockLayer) {
    setEditId(layer.receiptId)
    setEditRetail(String(layer.retailPrice))
    setEditBulk((layer.bulkPricing || []).map(t => ({ minQty: String(t.minQty), price: String(t.price) })))
  }

  async function handleSaveEdit(layer: ProductStockLayer) {
    setSaving(true)
    setMsg('')
    try {
      const res = await updateStockLayerSafe(layer.receiptId, product.id, {
        costPrice: layer.costPrice,
        retailPrice: Number(editRetail) || 0,
        bulkPricing: serializeBulkPricing(editBulk),
      })
      setEditId(null)
      if (res.offline) {
        setLayers(prev => prev.map(l => (
          l.receiptId === layer.receiptId
            ? {
                ...l,
                retailPrice: Number(editRetail) || 0,
                bulkPricing: serializeBulkPricing(editBulk) || [],
              }
            : l
        )))
        setMsg('Партия обновлена локально · отправится при связи')
      } else {
        await loadLayers()
        setMsg('Партия обновлена')
      }
      onUpdated?.()
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
  const tableColSpan = 11

  return (
    <div className="k-modal-bg k-modal-fs-bg k-arrivals-modal" onClick={requestClose}>
      <div className="k-modal k-modal-fs" onClick={e => e.stopPropagation()}>
        <div className="k-modal-h k-arrivals-head">
          <div className="k-arrivals-head-txt">
            <b>📦 Партии · {product.name}</b>
            <div className="k-arrivals-head-sub">
              Несколько партий — цена на кассе вручную, иначе FIFO
            </div>
            {addDirty && (
              <div className="k-arrivals-dirty">● Несохранённый приход</div>
            )}
          </div>
          <button type="button" onClick={requestClose} aria-label="Закрыть">✕</button>
        </div>

        <div className="k-modal-b k-arrivals-body">
          {msg && <div className="k-alert" style={{ marginBottom: 12, flexShrink: 0 }}>{msg}</div>}

          <div className="k-arrivals-toolbar">
            <div className="k-arrivals-stock">
              Остаток: <b style={{ color: 'var(--green)' }}>{totalQty}</b>
              {product.stock != null && totalQty !== Number(product.stock) && (
                <span className="k-arrivals-stock-diff">(карточка: {product.stock})</span>
              )}
              <span className="k-arrivals-stock-n">· {layers.length} парт.</span>
            </div>
            <div className="k-arrivals-toolbar-acts">
              <button
                type="button"
                className="k-btn k-btn-s"
                onClick={() => {
                  if (addDirty && !window.confirm('Есть несохранённый приход. Открыть редактирование товара?')) return
                  setEditProductOpen(true)
                }}
                title="Редактировать название, цену, штрихкод и другие поля товара"
              >
                ✎ Товар
              </button>
              <button type="button" className="k-btn k-btn-g" onClick={toggleAddForm}>
                {showAdd ? 'Отмена' : '+ Приход'}
              </button>
            </div>
          </div>

          {showAdd && (
            <div className="k-arrivals-add">
              <div className="k-arrivals-add-h">Новый приход</div>
              <div className="k-grid2">
                <div className="k-field">
                  <label>Количество *</label>
                  <input className="k-inp" type="text" inputMode="decimal" value={qty} onChange={e => { setQty(sanitizeDecimal(e.target.value)); markAddDirty() }} />
                </div>
                <div className="k-field">
                  <label>Розничная цена</label>
                  <input className="k-inp" type="text" inputMode="decimal" value={retailPrice} onChange={e => { setRetailPrice(sanitizeDecimal(e.target.value)); markAddDirty() }} />
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
              <div className="k-arrivals-edit-foot">
                <button type="button" className="k-btn k-btn-g" disabled={saving} onClick={() => void handleAdd()}>
                  {saving ? 'Сохранение…' : 'Провести приход'}
                </button>
              </div>
            </div>
          )}

          {loading && !showAdd && !layers.length ? (
            <div className="k-empty">Загрузка партий…</div>
          ) : !layers.length && !showAdd ? (
            <div className="k-empty">
              Нет партий. Добавьте первый приход — у каждой партии свои количество, розница и опт.
            </div>
          ) : (
            <div className="k-arrivals-tbl-wrap">
              <table className="k-arrivals-tbl">
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>#</th>
                    <th>Статус</th>
                    <th>Поставщик</th>
                    <th className="num">Количество</th>
                    <th className="num">Остаток</th>
                    <th className="num">Закуп</th>
                    <th className="num">Розница</th>
                    <th>Опт</th>
                    <th>Срок</th>
                    <th>Дата</th>
                    <th style={{ width: 140 }} />
                  </tr>
                </thead>
                <tbody>
                  {layers.map((layer, i) => (
                    <Fragment key={layer.receiptId}>
                      <tr className={editId === layer.receiptId ? 'is-editing' : ''}>
                        <td className="a-idx" data-l="#">{i + 1}</td>
                        <td className="a-status" data-l="Статус">
                          <span className="k-badge" style={{
                            background: layer.isActive ? 'var(--green-d)' : 'var(--badge-cat-bg)',
                            color: layer.isActive ? 'var(--green)' : 'var(--muted)',
                          }}>
                            {layer.isActive ? '● Активная' : `Очередь ${layer.queueIndex + 1}`}
                          </span>
                        </td>
                        <td className="a-sup" data-l="Поставщик" style={{ fontWeight: 700 }}>{layer.supplierName || 'Ручной приход'}</td>
                        <td className="num a-qty" data-l="Кол-во" style={{ fontWeight: 800 }}>{layer.qty}</td>
                        <td className="num a-rem" data-l="Остаток" style={{ fontWeight: 800 }}>{layer.remainingQty}</td>
                        <td className="num a-cost" data-l="Закуп" style={{ color: 'var(--red)', fontWeight: 800 }}>{money(layer.costPrice)}</td>
                        <td className="num a-retail" data-l="Розница" style={{ color: 'var(--green)', fontWeight: 800 }}>{money(layer.retailPrice)}</td>
                        <td className="a-bulk" data-l="Опт" style={{ fontSize: 12, color: 'var(--gold)', fontWeight: 700 }}>{bulkSummary(layer)}</td>
                        <td className="a-exp" data-l="Срок" style={{ fontSize: 12, color: 'var(--muted)' }}>{layer.expiryDate || '—'}</td>
                        <td className="a-date" data-l="Дата" style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{formatDate(layer.createdAtIso)}</td>
                        <td className="a-acts">
                          <div className="k-arrivals-row-acts">
                            <button
                              type="button"
                              className="k-btn k-btn-s"
                              title="Печать этикеток"
                              onClick={() => setLabelReceipt(receiptFromLayer(product, layer))}
                            >
                              🖨️
                            </button>
                            <button type="button" className="k-btn k-btn-s" onClick={() => startEdit(layer)}>
                              {editId === layer.receiptId ? '▼' : 'Изменить'}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {editId === layer.receiptId && (
                        <tr className="k-arrivals-edit-tr">
                          <td colSpan={tableColSpan}>
                            <div className="k-arrivals-edit">
                              <div className="k-grid2 k-arrivals-edit-grid">
                                <div className="k-field">
                                  <label>Количество</label>
                                  <input className="k-inp" type="text" value={String(layer.qty)} readOnly disabled />
                                </div>
                                <div className="k-field">
                                  <label>Розничная</label>
                                  <input className="k-inp" type="text" inputMode="decimal" value={editRetail} onChange={e => setEditRetail(sanitizeDecimal(e.target.value))} />
                                </div>
                              </div>
                              <BulkPricingFields tiers={editBulk} onChange={setEditBulk} sellType={product.sellType || 'piece'} />
                              <div className="k-arrivals-edit-foot">
                                <button type="button" className="k-btn k-btn-g" disabled={saving} onClick={() => void handleSaveEdit(layer)}>
                                  Сохранить партию
                                </button>
                                <button type="button" className="k-btn k-btn-s" onClick={() => setEditId(null)}>Отмена</button>
                              </div>
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

      <ProductEditModal
        open={editProductOpen}
        product={product}
        onClose={() => setEditProductOpen(false)}
        onSaved={() => {
          onUpdated?.()
        }}
      />

      <ReceiptLabelPrintModal
        open={!!labelReceipt}
        receipt={labelReceipt}
        products={[product]}
        onClose={() => setLabelReceipt(null)}
      />
    </div>
  )
}
