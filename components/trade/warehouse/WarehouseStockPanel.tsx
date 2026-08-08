'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import { formatBulkPricingHint, hasBulkPricing } from '@/lib/productBulkPricing'
import { isWeighted } from '@/lib/productWeight'
import type { Product, ProductStockLayer } from '@/lib/types'
import { buildProductCodeIndex, filterProductsByQuery } from '@/lib/productSearchIndex'
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

const STOCK_PAGE = 60

function stockBadge(stock: number) {
  if (stock <= 0) return { c: 'var(--red)', bg: 'var(--badge-stock-no)', l: 'Нет' }
  if (stock <= 5) return { c: 'var(--gold)', bg: 'var(--badge-stock-low)', l: 'Мало' }
  return { c: 'var(--green)', bg: 'var(--badge-stock-ok)', l: 'Есть' }
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
  search = '',
  onRefresh,
  refreshGen = 0,
}: {
  products: Product[]
  search?: string
  onRefresh?: () => void
  /** Инкремент с кнопки «Обновить» — перезагрузить партии без привязки к products */
  refreshGen?: number
}) {
  const { categories } = useCategories()
  const q = search
  const deferredQ = useDeferredValue(q.trim())
  const codeIndex = useMemo(() => buildProductCodeIndex(products), [products])
  const [filter, setFilter] = useState<StockFilter>('all')
  const [sort, setSort] = useState<SortKey>('name')
  const [sortDesc, setSortDesc] = useState(false)
  const [layers, setLayers] = useState<ProductStockLayer[]>([])
  const [layersLoading, setLayersLoading] = useState(false)
  const [arrivalsProduct, setArrivalsProduct] = useState<Product | null>(null)
  const [visibleCount, setVisibleCount] = useState(STOCK_PAGE)

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

  // Сначала таблица по product.stock, партии — после paint (не блокируем вход)
  useEffect(() => {
    let cancelled = false
    const t = window.setTimeout(() => {
      if (!cancelled) void loadLayers()
    }, 80)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [loadLayers, refreshGen])

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
    const query = deferredQ
    let list = filterProductsByQuery(
      products,
      codeIndex,
      query,
      p => categoryDisplayLabel(categories, p.catId, p.cat),
    ).filter(p => {
      const agg = aggByProduct.get(p.id)
      const stock = agg?.layerQty ?? (Number(p.stock) || 0)
      return filter === 'all' ? true
        : filter === 'inStock' ? stock > 5
          : filter === 'low' ? stock > 0 && stock <= 5
            : stock <= 0
    })

    // Один товар по штрихкоду — без тяжёлой сортировки всего каталога
    if (list.length <= 1) return list

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
  }, [products, categories, deferredQ, filter, sort, sortDesc, aggByProduct, codeIndex])

  useEffect(() => {
    setVisibleCount(STOCK_PAGE)
  }, [deferredQ, filter, sort, sortDesc])

  const visibleRows = useMemo(
    () => rows.slice(0, visibleCount),
    [rows, visibleCount],
  )

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

  const filterCounts = useMemo(() => {
    let inStock = 0
    let low = 0
    let out = 0
    for (const p of products) {
      const s = aggByProduct.get(p.id)?.layerQty || 0
      if (s > 5) inStock += 1
      else if (s > 0) low += 1
      else out += 1
    }
    return { all: products.length, inStock, low, out }
  }, [products, aggByProduct])

  function toggleSort(key: SortKey) {
    if (sort === key) setSortDesc(d => !d)
    else { setSort(key); setSortDesc(false) }
  }

  function sortMark(key: SortKey) {
    if (sort !== key) return ''
    return sortDesc ? ' ↓' : ' ↑'
  }

  const filters: { id: StockFilter; label: string; count: number }[] = [
    { id: 'all', label: 'Все', count: filterCounts.all },
    { id: 'inStock', label: 'В наличии', count: filterCounts.inStock },
    { id: 'low', label: 'Мало', count: filterCounts.low },
    { id: 'out', label: 'Нет', count: filterCounts.out },
  ]

  return (
    <div className="k-wh-stock">
      <div className="k-wh-stock-head">
        <div className="k-wh-filters-row">
          {filters.map(f => (
            <button
              key={f.id}
              type="button"
              className={`k-subtab ${filter === f.id ? 'active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label} ({f.count})
            </button>
          ))}
          <button
            type="button"
            className="k-btn k-btn-s"
            style={{ padding: '5px 10px', fontSize: 12, marginLeft: 'auto' }}
            disabled={layersLoading}
            onClick={() => void loadLayers()}
            title="Обновить партии"
          >
            ↻ Партии
          </button>
        </div>

        <div className="k-wh-meta">
          <span>
            Показано <b>{Math.min(visibleCount, totals.count)}</b> / {totals.count}
            {' · '}ост. <b>{totals.qtySum}</b>
            {layersLoading ? ' · партии…' : ''}
            {q.trim() ? ` · «${q.trim()}»` : ''}
          </span>
          <div className="k-wh-money" style={{ marginLeft: 'auto' }}>
            <span>Закуп <b>{fmtMoney(totals.costSum)}</b></span>
            <span>Розн. <b style={{ color: 'var(--green)' }}>{fmtMoney(totals.retailSum)}</b></span>
            <span>
              Маржа{' '}
              <b style={{ color: totals.retailSum >= totals.costSum ? 'var(--green)' : 'var(--red)' }}>
                {fmtMoney(totals.retailSum - totals.costSum)}
              </b>
            </span>
          </div>
        </div>
      </div>

      {!rows.length ? (
        <div className="k-empty">Товары не найдены</div>
      ) : (
        <div className="k-wh-stock-body">
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
                <th className="num" style={{ cursor: 'pointer' }} onClick={() => toggleSort('value')}>Σ закуп{sortMark('value')}</th>
                <th className="num">Σ розн.</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(p => {
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 140 }}>
                        <span style={{ fontSize: 15, flexShrink: 0 }}>{p.e || '📦'}</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: 12, lineHeight: 1.25 }}>{p.name}</div>
                          {(p.brand || isWeighted(p) || hasBulkPricing(p) || agg.layers.length > 1) && (
                            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1, lineHeight: 1.2 }}>
                              {[
                                p.brand,
                                isWeighted(p) ? 'развес' : null,
                                hasBulkPricing(p) ? formatBulkPricingHint(p) : null,
                                agg.layers.length > 1 ? `${agg.layers.length} парт.` : null,
                              ].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--muted)' }}>{p.art}</td>
                    <td style={{ fontSize: 11, color: 'var(--muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={catLabel}>
                      {catLabel}
                    </td>
                    <td style={{ fontSize: 11 }}>{p.unit || 'шт'}</td>
                    <td className="num" style={{ fontSize: 11 }}>
                      {agg.multiCost ? (
                        <div style={{ display: 'grid', gap: 1, justifyItems: 'end' }}>
                          {agg.groups.map(g => (
                            <span key={`c-${g.cost}-${g.retail}`}>{fmtMoney(g.cost)} × {g.qty}</span>
                          ))}
                        </div>
                      ) : (
                        agg.groups[0]?.cost ? fmtMoney(agg.groups[0].cost) : '—'
                      )}
                    </td>
                    <td className="num" style={{ fontWeight: 800, color: 'var(--green)', fontSize: 12 }}>
                      {agg.multiRetail ? (
                        <div style={{ display: 'grid', gap: 1, justifyItems: 'end' }}>
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
                    <td className="num" style={{ fontSize: 11 }}>{agg.costSum > 0 ? fmtMoney(agg.costSum) : '—'}</td>
                    <td className="num" style={{ fontSize: 11 }}>{fmtMoney(agg.retailSum)}</td>
                    <td>
                      <span className="k-badge" style={{ background: badge.bg, color: badge.c, fontSize: 10, padding: '2px 6px' }}>{badge.l}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border)' }}>
                <td colSpan={6} style={{ fontWeight: 800, fontSize: 12 }}>Итого ({totals.count} поз.)</td>
                <td className="num" style={{ fontWeight: 900 }}>{totals.qtySum}</td>
                <td className="num" style={{ fontWeight: 800 }}>{fmtMoney(totals.costSum)}</td>
                <td className="num" style={{ fontWeight: 800, color: 'var(--green)' }}>{fmtMoney(totals.retailSum)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          {rows.length > visibleCount && (
            <div style={{ padding: 10, textAlign: 'center' }}>
              <button
                type="button"
                className="k-btn k-btn-s"
                style={{ padding: '6px 12px', fontSize: 12 }}
                onClick={() => setVisibleCount(c => c + STOCK_PAGE)}
              >
                Показать ещё ({rows.length - visibleCount})
              </button>
            </div>
          )}
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
