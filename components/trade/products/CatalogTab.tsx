'use client'

import { useState } from 'react'
import { POS_CATEGORIES, money, stockStatus } from './productFormShared'
import { formatBulkPricingHint, hasBulkPricing } from '@/lib/productBulkPricing'
import { isWeighted } from '@/lib/productWeight'
import type { Product } from '@/lib/types'

type StatFilter = 'all' | 'inStock' | 'low' | 'out' | 'hot' | 'bulk'

function StatCard({ label, value, color, active, onClick }: {
  label: string; value: number; color?: string; active?: boolean; onClick: () => void
}) {
  return (
    <button
      type="button"
      className="k-kpi k-statcard"
      style={{
        cursor: 'pointer', textAlign: 'left', borderColor: active ? 'var(--green)' : undefined,
        background: active ? 'var(--green-d)' : undefined,
      }}
      onClick={onClick}
    >
      <div className="kl">{label}</div>
      <div className="kv" style={{ color: color || undefined }}>{value}</div>
    </button>
  )
}

export default function CatalogTab({
  products,
  loaded,
  search,
  getPhoto,
  onOpenProduct,
  onAddProduct,
  onDelete,
}: {
  products: Product[]
  loaded: boolean
  search: string
  getPhoto: (id: number) => string | undefined
  onOpenProduct: (id: number) => void
  onAddProduct: () => void
  onDelete: (id: number, name: string) => void
}) {
  const [catFlt, setCatFlt] = useState('all')
  const [statFlt, setStatFlt] = useState<StatFilter>('all')

  const matchStat = (p: Product) => {
    const stock = Number(p.stock) || 0
    if (statFlt === 'inStock') return stock > 5
    if (statFlt === 'low') return stock > 0 && stock <= 5
    if (statFlt === 'out') return stock <= 0
    if (statFlt === 'hot') return !!p.hot
    if (statFlt === 'bulk') return hasBulkPricing(p)
    return true
  }

  const q = search.trim().toLowerCase()
  const filtered = products.filter(p => {
    const matchQ = !q || `${p.name} ${p.art} ${p.barcode || ''} ${p.cat}`.toLowerCase().includes(q)
    const matchC = catFlt === 'all' || p.catId === catFlt
    return matchQ && matchC && matchStat(p)
  })

  const byCat = POS_CATEGORIES.map(c => ({
    ...c,
    count: products.filter(p => p.catId === c.id).length,
  }))

  return (
    <>
      <div className="k-page-h" style={{ marginTop: 0 }}>
        <div>
          <h1>📦 Каталог</h1>
          <div className="sub">Обзор всех товаров: остатки, цены, категории. Клик по строке — карточка товара.</div>
        </div>
        <button type="button" className="k-btn k-btn-g" onClick={onAddProduct}>+ Добавить товар</button>
      </div>

      <div className="k-kpis">
        <StatCard label="Всего позиций" value={products.length} active={statFlt === 'all'} onClick={() => setStatFlt('all')} />
        <StatCard label="В наличии" value={products.filter(p => Number(p.stock) > 5).length} color="var(--green)" active={statFlt === 'inStock'} onClick={() => setStatFlt(s => s === 'inStock' ? 'all' : 'inStock')} />
        <StatCard label="Мало (≤5)" value={products.filter(p => { const s = Number(p.stock); return s > 0 && s <= 5 }).length} color="var(--gold)" active={statFlt === 'low'} onClick={() => setStatFlt(s => s === 'low' ? 'all' : 'low')} />
        <StatCard label="Нет в наличии" value={products.filter(p => Number(p.stock) <= 0).length} color="var(--red)" active={statFlt === 'out'} onClick={() => setStatFlt(s => s === 'out' ? 'all' : 'out')} />
        <StatCard label="Хиты" value={products.filter(p => p.hot).length} color="var(--gold)" active={statFlt === 'hot'} onClick={() => setStatFlt(s => s === 'hot' ? 'all' : 'hot')} />
        <StatCard label="С оптом" value={products.filter(p => hasBulkPricing(p)).length} color="#FF8C00" active={statFlt === 'bulk'} onClick={() => setStatFlt(s => s === 'bulk' ? 'all' : 'bulk')} />
      </div>

      <div className="k-cats" style={{ marginBottom: 16 }}>
        <button type="button" className={`k-cat ${catFlt === 'all' ? 'active' : ''}`} onClick={() => setCatFlt('all')}>
          <span className="ce">🏪</span>Все<div style={{ fontSize: 10, opacity: 0.75 }}>{products.length}</div>
        </button>
        {byCat.map(c => (
          <button key={c.id} type="button" className={`k-cat ${catFlt === c.id ? 'active' : ''}`} onClick={() => setCatFlt(c.id)}>
            <span className="ce">{c.e}</span>{c.name.split(' ')[0]}
            <div style={{ fontSize: 10, opacity: 0.75 }}>{c.count}</div>
          </button>
        ))}
      </div>

      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
        Показано {filtered.length} из {products.length}
        {!loaded && ' · загрузка…'}
      </div>

      <section className="k-card">
        <div className="k-card-b" style={{ padding: 0 }}>
          <div style={{ maxHeight: '52vh', overflow: 'auto' }}>
            <table className="k-tbl">
              <thead>
                <tr>
                  <th>Артикул</th>
                  <th>Товар</th>
                  <th>Категория</th>
                  <th className="num">Цена</th>
                  <th className="num">Себест.</th>
                  <th>Ед.</th>
                  <th className="num">Остаток</th>
                  <th>Статус</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const sc = stockStatus(Number(p.stock) || 0)
                  const photo = p.photo || getPhoto(p.id)
                  const bulkHint = formatBulkPricingHint(p)
                  return (
                    <tr key={p.id} className="k-prodrow" onClick={() => onOpenProduct(p.id)}>
                      <td><span style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 800 }}>{p.art}</span></td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#0e1712', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, overflow: 'hidden', flexShrink: 0 }}>
                            {photo ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (p.e || '📦')}
                          </div>
                          <div>
                            <div style={{ fontWeight: 800 }}>{p.name}</div>
                            {p.barcode && <div style={{ fontSize: 11, color: 'var(--muted)' }}>ШК: {p.barcode}</div>}
                            {bulkHint && <div style={{ fontSize: 10, color: '#FF8C00' }}>{bulkHint}</div>}
                          </div>
                        </div>
                      </td>
                      <td><span className="k-badge" style={{ background: '#1a2430', color: 'var(--blue)' }}>{p.cat}</span></td>
                      <td className="num" style={{ color: 'var(--green)', fontWeight: 900 }}>{money(p.price)}</td>
                      <td className="num">{money(p.costPrice)}</td>
                      <td style={{ color: 'var(--muted)' }}>{p.unit}{isWeighted(p) ? ' ⚖️' : ''}</td>
                      <td className="num" style={{ fontWeight: 800, color: sc.c }}>{p.stock}</td>
                      <td><span className="k-badge" style={{ background: sc.c + '22', color: sc.c }}>{sc.l}</span></td>
                      <td onClick={e => e.stopPropagation()}>
                        <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 12, color: 'var(--red)' }} onClick={() => onDelete(p.id, p.name)}>✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!filtered.length && <div className="k-empty">{loaded ? 'Товары не найдены' : 'Загрузка товаров…'}</div>}
          </div>
        </div>
      </section>
    </>
  )
}
