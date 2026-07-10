'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import { productBarcodeSearchText } from '@/lib/productBarcodes'
import type { Product, ProductStockLayer } from '@/lib/types'
import LabelEditModal from './LabelEditModal'
import {
  buildLabelPick,
  defaultLabelEdit,
  formatLabelMoney,
  labelPickKey,
  layerShortLabel,
  type LabelEdit,
  type LabelPick,
} from './labelShared'

const LABEL_CSS = `
  @media print {
    body * { visibility: hidden !important; }
    #k-label-print, #k-label-print * { visibility: visible !important; }
    #k-label-print { position: absolute; left: 0; top: 0; width: 100%; }
    .k-label-card { break-inside: avoid; page-break-inside: avoid; }
  }
  .k-label-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
  .k-label-card{background:#fff;color:#111;border:1px dashed #ccc;border-radius:8px;padding:12px 14px;min-height:120px;display:flex;flex-direction:column;justify-content:space-between;position:relative}
  .k-label-card .brand{font-size:10px;font-weight:800;color:#0a7a3e;letter-spacing:.06em}
  .k-label-card .name{font-size:14px;font-weight:800;line-height:1.25;margin:6px 0}
  .k-label-card .price{font-size:22px;font-weight:900;color:#0a7a3e}
  .k-label-card .meta{font-size:10px;color:#666;margin-top:4px}
  .k-label-card .bar{font-family:monospace;font-size:11px;letter-spacing:2px;margin-top:8px;padding:4px 0;border-top:1px solid #eee}
  .k-label-pick{border:1px solid var(--border);border-radius:10px;margin-bottom:8px;background:var(--card2);overflow:hidden}
  .k-label-pick-head{display:flex;align-items:center;gap:10px;padding:8px 10px;cursor:pointer}
  .k-label-pick-head input{accent-color:var(--green)}
  .k-label-pick-head:hover{background:rgba(31,215,96,.06)}
  .k-label-layer{padding:6px 10px 6px 38px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer}
  .k-label-layer:hover{background:rgba(31,215,96,.04)}
  .k-label-layer input{accent-color:var(--green)}
  .k-label-edit-btn{position:absolute;top:6px;right:6px;border:none;background:#f0f0f0;color:#333;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer}
`

function LabelCard({
  edit,
  size,
  onEdit,
}: {
  edit: LabelEdit
  size: 'small' | 'medium'
  onEdit: () => void
}) {
  return (
    <div
      className="k-label-card"
      style={size === 'small' ? { minHeight: 96, padding: '8px 10px' } : undefined}
    >
      <button type="button" className="k-label-edit-btn" onClick={onEdit}>✏️</button>
      <div>
        <div className="brand">{edit.brand || 'KAKAPO'}</div>
        <div className="name">{edit.name}</div>
        <div className="meta">{edit.meta}</div>
      </div>
      <div>
        <div className="price">{formatLabelMoney(edit.price)}</div>
        {edit.showBarcode && edit.barcode && <div className="bar">{edit.barcode}</div>}
      </div>
    </div>
  )
}

export default function LabelsTab({
  products,
  search,
}: {
  products: Product[]
  search: string
}) {
  const [labelSearch, setLabelSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [edits, setEdits] = useState<Record<string, LabelEdit>>({})
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [layersByProduct, setLayersByProduct] = useState<Record<number, ProductStockLayer[]>>({})
  const [loadingLayers, setLoadingLayers] = useState<Set<number>>(new Set())
  const [labelSize, setLabelSize] = useState<'small' | 'medium'>('medium')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draftEdit, setDraftEdit] = useState<LabelEdit | null>(null)
  const loadingRef = useRef<Set<number>>(new Set())

  const q = (labelSearch.trim() || search.trim()).toLowerCase()
  const filtered = useMemo(
    () => products.filter(p => !q || `${p.name} ${p.art} ${productBarcodeSearchText(p)}`.toLowerCase().includes(q)),
    [products, q],
  )

  const picksByKey = useMemo(() => {
    const map = new Map<string, LabelPick>()
    for (const p of products) {
      const layers = layersByProduct[p.id] || []
      if (layers.length) {
        for (const layer of layers) {
          const pick = buildLabelPick(p, layer)
          map.set(pick.key, pick)
        }
      } else {
        const pick = buildLabelPick(p, null)
        map.set(pick.key, pick)
      }
    }
    return map
  }, [products, layersByProduct])

  const chosenPicks = useMemo(() => {
    const list: LabelPick[] = []
    for (const key of selected) {
      const pick = picksByKey.get(key)
      if (pick) list.push(pick)
    }
    return list
  }, [selected, picksByKey])

  const previewPicks = chosenPicks.length
    ? chosenPicks
    : filtered.slice(0, 6).map(p => {
      const layers = layersByProduct[p.id] || []
      const active = layers.find(l => l.isActive) || layers[0]
      return buildLabelPick(p, active ?? null)
    })

  const loadLayers = useCallback(async (productId: number) => {
    if (!USE_API || loadingRef.current.has(productId)) return
    let skip = false
    setLayersByProduct(prev => {
      if (prev[productId] !== undefined) {
        skip = true
        return prev
      }
      return prev
    })
    if (skip) return
    loadingRef.current.add(productId)
    setLoadingLayers(prev => new Set(prev).add(productId))
    try {
      const layers = await api.getProductStockLayers(productId)
      setLayersByProduct(prev => ({ ...prev, [productId]: layers }))
    } catch {
      setLayersByProduct(prev => ({ ...prev, [productId]: [] }))
    } finally {
      loadingRef.current.delete(productId)
      setLoadingLayers(prev => {
        const next = new Set(prev)
        next.delete(productId)
        return next
      })
    }
  }, [])

  useEffect(() => {
    if (!USE_API) return
    void Promise.all(filtered.slice(0, 30).map(p => loadLayers(p.id)))
  }, [filtered, loadLayers])

  function getEdit(pick: LabelPick): LabelEdit {
    return edits[pick.key] ?? defaultLabelEdit(pick.product, pick.layer)
  }

  function ensureEdit(key: string, pick: LabelPick) {
    if (!edits[key]) {
      setEdits(prev => ({ ...prev, [key]: defaultLabelEdit(pick.product, pick.layer) }))
    }
  }

  function toggleKey(key: string, pick: LabelPick, on: boolean) {
    ensureEdit(key, pick)
    setSelected(prev => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }

  function toggleProduct(product: Product, on: boolean) {
    const layers = layersByProduct[product.id] || []
    const active = layers.find(l => l.isActive) || layers[0]
    const key = labelPickKey(product.id, active?.receiptId ?? null)
    const pick = picksByKey.get(key) || buildLabelPick(product, active ?? null)
    toggleKey(key, pick, on)
  }

  function isProductChecked(product: Product) {
    const layers = layersByProduct[product.id] || []
    if (!layers.length) return selected.has(labelPickKey(product.id, null))
    return layers.some(l => selected.has(labelPickKey(product.id, l.receiptId)))
  }

  function toggleExpand(productId: number) {
    void loadLayers(productId)
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  function selectAll() {
    const next = new Set<string>()
    const nextEdits = { ...edits }
    for (const p of filtered) {
      const layers = layersByProduct[p.id] || []
      const active = layers.find(l => l.isActive) || layers[0]
      const pick = buildLabelPick(p, active ?? null)
      next.add(pick.key)
      if (!nextEdits[pick.key]) nextEdits[pick.key] = defaultLabelEdit(pick.product, pick.layer)
    }
    setEdits(nextEdits)
    setSelected(next)
  }

  function clearAll() {
    setSelected(new Set())
  }

  function openEdit(key: string) {
    const pick = picksByKey.get(key)
    if (!pick) return
    setEditingKey(key)
    setDraftEdit({ ...getEdit(pick) })
  }

  function saveEdit() {
    if (!editingKey || !draftEdit) return
    setEdits(prev => ({ ...prev, [editingKey]: draftEdit }))
    setEditingKey(null)
    setDraftEdit(null)
  }

  function printLabels() {
    if (!chosenPicks.length) return
    window.print()
  }

  return (
    <div>
      <style>{LABEL_CSS}</style>
      <div className="k-page-h" style={{ marginTop: 0 }}>
        <div>
          <h1>🏷️ Этикетки</h1>
          <div className="sub">Поиск, выбор партии, редактирование и печать ценников</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="k-btn k-btn-s" onClick={selectAll}>Выбрать все</button>
          <button type="button" className="k-btn k-btn-s" onClick={clearAll}>Сбросить</button>
          <button type="button" className="k-btn k-btn-g" disabled={!chosenPicks.length} onClick={printLabels}>
            🖨️ Печать ({chosenPicks.length})
          </button>
        </div>
      </div>

      <div className="k-grid2" style={{ alignItems: 'start' }}>
        <section className="k-card">
          <div className="k-card-h">
            <b>Выбор товаров</b>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{selected.size} этикеток</span>
          </div>
          <div className="k-card-b">
            <input
              className="k-inp"
              value={labelSearch}
              onChange={e => setLabelSearch(e.target.value)}
              placeholder="Поиск по названию или штрихкоду…"
              style={{ marginBottom: 12 }}
            />
            <div style={{ maxHeight: '52vh', overflow: 'auto' }}>
              {filtered.map(p => {
                const layers = layersByProduct[p.id]
                const isOpen = expanded.has(p.id)
                const loading = loadingLayers.has(p.id)
                return (
                  <div key={p.id} className="k-label-pick">
                    <div className="k-label-pick-head">
                      <input
                        type="checkbox"
                        checked={isProductChecked(p)}
                        onChange={e => toggleProduct(p, e.target.checked)}
                      />
                      <span style={{ fontSize: 18 }}>{p.e || '📦'}</span>
                      <span style={{ flex: 1, minWidth: 0 }} onClick={() => toggleExpand(p.id)}>
                        <div style={{ fontWeight: 800, fontSize: 13 }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {p.art} · {formatLabelMoney(p.price)}
                          {layers?.length ? ` · ${layers.length} парт.` : ''}
                        </div>
                      </span>
                      <button
                        type="button"
                        className="k-btn k-btn-s"
                        style={{ padding: '4px 8px', fontSize: 11 }}
                        onClick={() => toggleExpand(p.id)}
                      >
                        {loading ? '…' : isOpen ? '▲' : '▼'}
                      </button>
                    </div>
                    {isOpen && (
                      <div>
                        {loading && layers === undefined && (
                          <div style={{ padding: '8px 38px', fontSize: 11, color: 'var(--muted)' }}>Загрузка партий…</div>
                        )}
                        {(layers || []).length === 0 && layers !== undefined && (
                          <label className="k-label-layer">
                            <input
                              type="checkbox"
                              checked={selected.has(labelPickKey(p.id, null))}
                              onChange={e => toggleKey(labelPickKey(p.id, null), buildLabelPick(p, null), e.target.checked)}
                            />
                            <span>Без партии · {formatLabelMoney(p.price)}</span>
                          </label>
                        )}
                        {(layers || []).map(layer => {
                          const key = labelPickKey(p.id, layer.receiptId)
                          const pick = buildLabelPick(p, layer)
                          return (
                            <label key={key} className="k-label-layer">
                              <input
                                type="checkbox"
                                checked={selected.has(key)}
                                onChange={e => toggleKey(key, pick, e.target.checked)}
                              />
                              <span>{layerShortLabel(layer, p.unit || 'шт')}</span>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
              {!filtered.length && <div className="k-empty">Товары не найдены</div>}
            </div>
          </div>
        </section>

        <section className="k-card">
          <div className="k-card-h">
            <b>Предпросмотр</b>
            <select
              className="k-sel"
              style={{ width: 'auto', minWidth: 120 }}
              value={labelSize}
              onChange={e => setLabelSize(e.target.value as 'small' | 'medium')}
            >
              <option value="medium">Средняя</option>
              <option value="small">Маленькая</option>
            </select>
          </div>
          <div className="k-card-b">
            <div id="k-label-print" className="k-label-grid">
              {previewPicks.map(pick => (
                <LabelCard
                  key={pick.key}
                  edit={getEdit(pick)}
                  size={labelSize}
                  onEdit={() => openEdit(pick.key)}
                />
              ))}
            </div>
            {!chosenPicks.length && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>
                Предпросмотр первых товаров. Выберите товар и партию слева, нажмите ✏️ для редактирования.
              </div>
            )}
          </div>
        </section>
      </div>

      <LabelEditModal
        open={!!editingKey && !!draftEdit}
        edit={draftEdit || { brand: 'KAKAPO', name: '', price: '0', meta: '', barcode: '', showBarcode: true }}
        onChange={e => setDraftEdit(e)}
        onClose={() => { setEditingKey(null); setDraftEdit(null) }}
        onSave={saveEdit}
      />
    </div>
  )
}
