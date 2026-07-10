'use client'

import { useMemo, useState } from 'react'
import { formatBulkPricingHint, hasBulkPricing } from '@/lib/productBulkPricing'
import { productBarcodeSearchText } from '@/lib/productBarcodes'
import { isWeighted } from '@/lib/productWeight'
import type { Product } from '@/lib/types'
import { categoryDisplayLabel, useCategories } from '@/lib/useCategories'
import { fmtMoney } from './warehouseShared'

type StockFilter = 'all' | 'inStock' | 'low' | 'out'
type SortKey = 'name' | 'stock' | 'cost' | 'retail' | 'value'

function stockBadge(stock: number) {
  if (stock <= 0) return { c: 'var(--red)', bg: '#2a1420', l: 'Нет' }
  if (stock <= 5) return { c: 'var(--gold)', bg: '#2a2414', l: 'Мало' }
  return { c: 'var(--green)', bg: 'var(--green-d)', l: 'Есть' }
}

export default function WarehouseStockPanel({ products }: { products: Product[] }) {
  const { categories } = useCategories()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<StockFilter>('all')
  const [sort, setSort] = useState<SortKey>('name')
  const [sortDesc, setSortDesc] = useState(false)

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase()
    let list = products.filter(p => {
      const catLabel = categoryDisplayLabel(categories, p.catId, p.cat)
      const matchQ = !query || `${p.name} ${p.art} ${productBarcodeSearchText(p)} ${catLabel}`.toLowerCase().includes(query)
      const stock = Number(p.stock) || 0
      const matchF =
        filter === 'all' ? true
          : filter === 'inStock' ? stock > 5
            : filter === 'low' ? stock > 0 && stock <= 5
              : stock <= 0
      return matchQ && matchF
    })

    list = [...list].sort((a, b) => {
      let cmp = 0
      if (sort === 'name') cmp = a.name.localeCompare(b.name, 'ru')
      else if (sort === 'stock') cmp = (Number(a.stock) || 0) - (Number(b.stock) || 0)
      else if (sort === 'cost') cmp = (Number(a.costPrice) || 0) - (Number(b.costPrice) || 0)
      else if (sort === 'retail') cmp = (Number(a.price) || 0) - (Number(b.price) || 0)
      else if (sort === 'value') {
        const va = (Number(a.costPrice) || 0) * (Number(a.stock) || 0)
        const vb = (Number(b.costPrice) || 0) * (Number(b.stock) || 0)
        cmp = va - vb
      }
      return sortDesc ? -cmp : cmp
    })
    return list
  }, [products, categories, q, filter, sort, sortDesc])

  const totals = useMemo(() => {
    let costSum = 0
    let retailSum = 0
    let qtySum = 0
    for (const p of rows) {
      const stock = Number(p.stock) || 0
      qtySum += stock
      costSum += (Number(p.costPrice) || 0) * stock
      retailSum += (Number(p.price) || 0) * stock
    }
    return { costSum, retailSum, qtySum, count: rows.length }
  }, [rows])

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
    { id: 'inStock', label: 'В наличии', count: products.filter(p => (Number(p.stock) || 0) > 5).length },
    { id: 'low', label: 'Мало', count: products.filter(p => { const s = Number(p.stock) || 0; return s > 0 && s <= 5 }).length },
    { id: 'out', label: 'Нет', count: products.filter(p => (Number(p.stock) || 0) <= 0).length },
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
            Показано: <b style={{ color: 'var(--text)' }}>{totals.count}</b> · Остаток: <b style={{ color: 'var(--text)' }}>{totals.qtySum}</b>
          </div>
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
                const stock = Number(p.stock) || 0
                const cost = Number(p.costPrice) || 0
                const retail = Number(p.price) || 0
                const badge = stockBadge(stock)
                const catLabel = categoryDisplayLabel(categories, p.catId, p.cat)
                return (
                  <tr key={p.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 160 }}>
                        <span style={{ fontSize: 18 }}>{p.e || '📦'}</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 800 }}>{p.name}</div>
                          {(p.brand || hasBulkPricing(p) || isWeighted(p)) && (
                            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                              {[p.brand, isWeighted(p) ? 'на развес' : null, hasBulkPricing(p) ? formatBulkPricingHint(p) : null].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>{p.art}</td>
                    <td style={{ fontSize: 12 }}>{catLabel}</td>
                    <td style={{ fontSize: 12 }}>{p.unit || 'шт'}</td>
                    <td className="num">{cost > 0 ? fmtMoney(cost) : '—'}</td>
                    <td className="num" style={{ fontWeight: 800, color: 'var(--green)' }}>{fmtMoney(retail)}</td>
                    <td className="num" style={{ fontWeight: 900, color: badge.c }}>{stock}</td>
                    <td className="num">{cost > 0 ? fmtMoney(cost * stock) : '—'}</td>
                    <td className="num">{fmtMoney(retail * stock)}</td>
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
    </div>
  )
}
