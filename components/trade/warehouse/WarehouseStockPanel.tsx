'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import { formatBulkPricingHint, hasBulkPricing } from '@/lib/productBulkPricing'
import { productMatchesSearch } from '@/lib/productBarcodes'
import { isWeighted } from '@/lib/productWeight'
import type { Product, ProductStockLayer } from '@/lib/types'
import { categoryDisplayLabel, useCategories } from '@/lib/useCategories'
import ProductArrivalsPanel from '../products/ProductArrivalsPanel'
import { fmtMoney } from './warehouseShared'

type StockFilter = 'all' | 'inStock' | 'low' | 'out'
type SortKey = 'name' | 'stock' | 'cost' | 'retail' | 'value'

type BatchGroup = { retail: number; cost: number; qty: number }

type ProductStockAgg = {
  layers: ProductStockLayer[]
  groups: BatchGroup[]
  layerQty: number
  costSum: number
  retailSum: number
  multiRetail: boolean
  multiCost: boolean
}

function stockBadge(stock: number) {
  if (stock <= 0) return { c: 'var(--red)', bg: '#2a1420', l: 'Нет' }
  if (stock <= 5) return { c: 'var(--gold)', bg: '#2a2414', l: 'Мало' }
  return { c: 'var(--green)', bg: 'var(--green-d)', l: 'Есть' }
}

function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function buildAgg(layers: ProductStockLayer[], product: Product): ProductStockAgg {
  if (!layers.length) {
    const stock = Number(product.stock) || 0
    const cost = Number(product.costPrice) || 0
    const retail = Number(product.price) || 0
    return {
      layers: [],
      groups: stock > 0 ? [{ retail, cost, qty: stock }] : [],
      layerQty: stock,
      costSum: round2(cost * stock),
      retailSum: round2(retail * stock),
      multiRetail: false,
      multiCost: false,
    }
  }

  let layerQty = 0
  let costSum = 0
  let retailSum = 0
  const groupMap = new Map<string, BatchGroup>()

  for (const layer of layers) {
    const qty = Number(layer.remainingQty) || 0
    if (!(qty > 0)) continue
    const cost = Number(layer.costPrice) || 0
    const retail = Number(layer.retailPrice) > 0 ? Number(layer.retailPrice) : (Number(product.price) || 0)
    layerQty = round2(layerQty + qty)
    costSum = round2(costSum + cost * qty)
    retailSum = round2(retailSum + retail * qty)
    const key = `${retail}|${cost}`
    const prev = groupMap.get(key)
    if (prev) prev.qty = round2(prev.qty + qty)
    else groupMap.set(key, { retail, cost, qty })
  }

  const groups = [...groupMap.values()].sort((a, b) => a.retail - b.retail || a.cost - b.cost)
  const retailPrices = new Set(groups.map(g => g.retail))
  const costPrices = new Set(groups.map(g => g.cost))

  return {
    layers,
    groups,
    layerQty,
    costSum,
    retailSum,
    multiRetail: retailPrices.size > 1,
    multiCost: costPrices.size > 1,
  }
}

export default function WarehouseStockPanel({
  products,
  onRefresh,
}: {
  products: Product[]
  onRefresh?: () => void
}) {
  const { categories } = useCategories()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<StockFilter>('all')
  const [sort, setSort] = useState<SortKey>('name')
  const [sortDesc, setSortDesc] = useState(false)
  const [layers, setLayers] = useState<ProductStockLayer[]>([])
  const [layersLoading, setLayersLoading] = useState(false)
  const [arrivalsProduct, setArrivalsProduct] = useState<Product | null>(null)

  const loadLayers = useCallback(async () => {
    if (!USE_API) {
      setLayers([])
      return
    }
    setLayersLoading(true)
    try {
      setLayers(await api.getAllStockLayers())
    } catch {
      setLayers([])
    } finally {
      setLayersLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadLayers()
  }, [loadLayers, products])

  const layersByProduct = useMemo(() => {
    const map = new Map<number, ProductStockLayer[]>()
    for (const layer of layers) {
      const pid = Number(layer.productId)
      const list = map.get(pid) || []
      list.push(layer)
      map.set(pid, list)
    }
    return map
  }, [layers])

  const aggByProduct = useMemo(() => {
    const map = new Map<number, ProductStockAgg>()
    for (const p of products) {
      map.set(p.id, buildAgg(layersByProduct.get(p.id) || [], p))
    }
    return map
  }, [products, layersByProduct])

  const rows = useMemo(() => {
    const query = q.trim()
    let list = products.filter(p => {
      const catLabel = categoryDisplayLabel(categories, p.catId, p.cat)
      const matchQ = productMatchesSearch(p, query, catLabel)
      const agg = aggByProduct.get(p.id)
      const stock = agg?.layerQty ?? (Number(p.stock) || 0)
      const matchF =
        filter === 'all' ? true
          : filter === 'inStock' ? stock > 5
            : filter === 'low' ? stock > 0 && stock <= 5
              : stock <= 0
      return matchQ && matchF
    })

    list = [...list].sort((a, b) => {
      const aa = aggByProduct.get(a.id)!
      const bb = aggByProduct.get(b.id)!
      let cmp = 0
      if (sort === 'name') cmp = a.name.localeCompare(b.name, 'ru')
      else if (sort === 'stock') cmp = aa.layerQty - bb.layerQty
      else if (sort === 'cost') cmp = (aa.groups[0]?.cost || 0) - (bb.groups[0]?.cost || 0)
      else if (sort === 'retail') cmp = (aa.groups[0]?.retail || 0) - (bb.groups[0]?.retail || 0)
      else if (sort === 'value') cmp = aa.costSum - bb.costSum
      return sortDesc ? -cmp : cmp
    })
    return list
  }, [products, categories, q, filter, sort, sortDesc, aggByProduct])

  const totals = useMemo(() => {
    let costSum = 0
    let retailSum = 0
    let qtySum = 0
    for (const p of rows) {
      const agg = aggByProduct.get(p.id)!
      qtySum = round2(qtySum + agg.layerQty)
      costSum = round2(costSum + agg.costSum)
      retailSum = round2(retailSum + agg.retailSum)
    }
    return { costSum, retailSum, qtySum, count: rows.length }
  }, [rows, aggByProduct])

  function toggleSort(key: SortKey) {
    if (sort === key) setSortDesc(d => !d)
    else { setSort(key); setSortDesc(false) }
  }

  function sortMark(key: SortKey) {
    if (sort !== key) return ''
    return sortDesc ? ' ↓' : ' ↑'
  }

  const filters: { id: StockFilter; label: string; count: number }[] = [
    { id: 'all', label: 'Все', count: products.length },
    { id: 'inStock', label: 'В наличии', count: products.filter(p => (aggByProduct.get(p.id)?.layerQty || 0) > 5).length },
    { id: 'low', label: 'Мало', count: products.filter(p => { const s = aggByProduct.get(p.id)?.layerQty || 0; return s > 0 && s <= 5 }).length },
    { id: 'out', label: 'Нет', count: products.filter(p => (aggByProduct.get(p.id)?.layerQty || 0) <= 0).length },
  ]

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {filters.map(f => (
          <button
            key={f.id}
            type="button"
            className={`k-subtab ${filter === f.id ? 'active' : ''}`}
            style={{ padding: '7px 14px' }}
            onClick={() => setFilter(f.id)}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      <div className="k-card" style={{ marginBottom: 12 }}>
        <div className="k-card-b" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="k-inp"
            style={{ flex: 1, minWidth: 200 }}
            placeholder="Поиск по названию, артикулу, штрихкоду…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Показано: <b style={{ color: 'var(--text)' }}>{totals.count}</b>
            {' · '}Остаток: <b style={{ color: 'var(--text)' }}>{totals.qtySum}</b>
            {layersLoading ? ' · партии…' : ''}
          </div>
          <button type="button" className="k-btn k-btn-s" disabled={layersLoading} onClick={() => void loadLayers()}>
            ↻ Партии
          </button>
        </div>
        <div style={{ padding: '0 14px 12px', fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>
          Суммы считаются по партиям (например 48×12 + 67×13). Нажмите на товар — откроются его приходы.
        </div>
      </div>

      <div className="k-kpis" style={{ marginBottom: 12 }}>
        <div className="k-kpi">
          <div className="kl">Сумма закупки на складе</div>
          <div className="kv" style={{ fontSize: 20 }}>{fmtMoney(totals.costSum)}</div>
        </div>
        <div className="k-kpi">
          <div className="kl">Сумма по рознице</div>
          <div className="kv" style={{ fontSize: 20, color: 'var(--green)' }}>{fmtMoney(totals.retailSum)}</div>
        </div>
        <div className="k-kpi">
          <div className="kl">Потенц. маржа</div>
          <div className="kv" style={{ fontSize: 20, color: totals.retailSum >= totals.costSum ? 'var(--green)' : 'var(--red)' }}>
            {fmtMoney(totals.retailSum - totals.costSum)}
          </div>
        </div>
      </div>

      {!rows.length ? (
        <div className="k-empty">Товары не найдены</div>
      ) : (
        <div className="k-card k-tbl-scroll">
          <table className="k-tbl">
            <thead>
              <tr>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('name')}>Наименование{sortMark('name')}</th>
                <th>Артикул</th>
                <th>Категория</th>
                <th>Ед.</th>
                <th className="num" style={{ cursor: 'pointer' }} onClick={() => toggleSort('cost')}>Закуп{sortMark('cost')}</th>
                <th className="num" style={{ cursor: 'pointer' }} onClick={() => toggleSort('retail')}>Розница{sortMark('retail')}</th>
                <th className="num" style={{ cursor: 'pointer' }} onClick={() => toggleSort('stock')}>Кол-во{sortMark('stock')}</th>
                <th className="num" style={{ cursor: 'pointer' }} onClick={() => toggleSort('value')}>Сумма закуп{sortMark('value')}</th>
                <th className="num">Сумма розн.</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => {
                const agg = aggByProduct.get(p.id)!
                const stock = agg.layerQty
                const badge = stockBadge(stock)
                const catLabel = categoryDisplayLabel(categories, p.catId, p.cat)
                return (
                  <tr
                    key={p.id}
                    className="k-prodrow"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setArrivalsProduct(p)}
                    title="Открыть партии прихода"
                  >
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 160 }}>
                        <span style={{ fontSize: 18 }}>{p.e || '📦'}</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 800 }}>{p.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                            {[
                              p.brand,
                              isWeighted(p) ? 'на развес' : null,
                              hasBulkPricing(p) ? formatBulkPricingHint(p) : null,
                              agg.layers.length > 1 ? `${agg.layers.length} партии` : null,
                            ].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>{p.art}</td>
                    <td style={{ fontSize: 12 }}>{catLabel}</td>
                    <td style={{ fontSize: 12 }}>{p.unit || 'шт'}</td>
                    <td className="num">
                      {agg.multiCost ? (
                        <div style={{ display: 'grid', gap: 2, justifyItems: 'end' }}>
                          {agg.groups.map(g => (
                            <span key={`c-${g.cost}-${g.retail}`}>{fmtMoney(g.cost)} × {g.qty}</span>
                          ))}
                        </div>
                      ) : (
                        agg.groups[0]?.cost ? fmtMoney(agg.groups[0].cost) : '—'
                      )}
                    </td>
                    <td className="num" style={{ fontWeight: 800, color: 'var(--green)' }}>
                      {agg.multiRetail ? (
                        <div style={{ display: 'grid', gap: 2, justifyItems: 'end' }}>
                          {agg.groups.map(g => (
                            <span key={`r-${g.retail}-${g.cost}`}>
                              {fmtMoney(g.retail)} × {g.qty}
                            </span>
                          ))}
                        </div>
                      ) : (
                        fmtMoney(agg.groups[0]?.retail ?? p.price)
                      )}
                    </td>
                    <td className="num" style={{ fontWeight: 900, color: badge.c }}>{stock}</td>
                    <td className="num">{agg.costSum > 0 ? fmtMoney(agg.costSum) : '—'}</td>
                    <td className="num">{fmtMoney(agg.retailSum)}</td>
                    <td>
                      <span className="k-badge" style={{ background: badge.bg, color: badge.c }}>{badge.l}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border)' }}>
                <td colSpan={6} style={{ fontWeight: 800 }}>Итого ({totals.count} поз.)</td>
                <td className="num" style={{ fontWeight: 900 }}>{totals.qtySum}</td>
                <td className="num" style={{ fontWeight: 800 }}>{fmtMoney(totals.costSum)}</td>
                <td className="num" style={{ fontWeight: 800, color: 'var(--green)' }}>{fmtMoney(totals.retailSum)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {arrivalsProduct && (
        <ProductArrivalsPanel
          product={arrivalsProduct}
          open
          onClose={() => setArrivalsProduct(null)}
          onUpdated={() => {
            void loadLayers()
            onRefresh?.()
          }}
        />
      )}
    </div>
  )
}
