'use client'

import { useMemo, useState } from 'react'
import { productMatchesSearch } from '@/lib/productBarcodes'
import type { Product } from '@/lib/types'
import {
  categoryDisplayLabel,
  categorySlug,
  countProductsInCategory,
  productMatchesCategoryFilter,
} from '@/lib/useCategories'
import type { Category } from '@/lib/types'

type StockFilter = 'all' | 'inStock' | 'low' | 'out'

function matchStock(p: Product, filter: StockFilter) {
  const stock = Number(p.stock) || 0
  if (filter === 'inStock') return stock > 5
  if (filter === 'low') return stock > 0 && stock <= 5
  if (filter === 'out') return stock <= 0
  return true
}

export default function RevisionBulkPicker({
  products,
  categories,
  existingProductIds,
  onAdd,
}: {
  products: Product[]
  categories: Category[]
  existingProductIds: Set<number>
  onAdd: (items: Product[]) => void
}) {
  const [catFlt, setCatFlt] = useState('all')
  const [stockFlt, setStockFlt] = useState<StockFilter>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [open, setOpen] = useState(true)

  const roots = useMemo(
    () => categories.filter(c => c.parent_id == null).sort((a, b) => (a.order || 0) - (b.order || 0)),
    [categories],
  )

  const activeRoot = useMemo(() => {
    if (catFlt === 'all') return null
    const direct = categories.find(c => categorySlug(c) === catFlt)
    if (!direct) return null
    if (direct.parent_id == null) return direct
    return categories.find(c => c.id === Number(direct.parent_id)) || null
  }, [catFlt, categories])

  const subcategories = useMemo(() => {
    if (!activeRoot) return []
    return categories
      .filter(c => Number(c.parent_id) === activeRoot.id)
      .sort((a, b) => (a.order || 0) - (b.order || 0))
  }, [activeRoot, categories])

  const filtered = useMemo(() => {
    const q = search.trim()
    return products.filter(p => {
      if (!productMatchesCategoryFilter(p.catId, catFlt, categories)) return false
      if (!matchStock(p, stockFlt)) return false
      if (q && !productMatchesSearch(p, q, categoryDisplayLabel(categories, p.catId, p.cat))) return false
      return true
    })
  }, [products, categories, catFlt, stockFlt, search])

  const selectable = useMemo(
    () => filtered.filter(p => !existingProductIds.has(p.id)),
    [filtered, existingProductIds],
  )

  const selectedCount = useMemo(
    () => selectable.filter(p => selected.has(p.id)).length,
    [selectable, selected],
  )

  function pickCategory(slug: string) {
    setCatFlt(slug)
    setSelected(new Set())
  }

  function toggle(id: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllVisible() {
    setSelected(new Set(selectable.map(p => p.id)))
  }

  function clearSelection() {
    setSelected(new Set())
  }

  function addSelected() {
    const items = selectable.filter(p => selected.has(p.id))
    if (!items.length) return
    onAdd(items)
    setSelected(new Set())
  }

  function addAllVisible() {
    if (!selectable.length) return
    onAdd(selectable)
    setSelected(new Set())
  }

  const stockFilters: { id: StockFilter; label: string; count: number }[] = [
    { id: 'all', label: 'Все', count: products.filter(p => productMatchesCategoryFilter(p.catId, catFlt, categories)).length },
    { id: 'inStock', label: 'В наличии', count: products.filter(p => productMatchesCategoryFilter(p.catId, catFlt, categories) && matchStock(p, 'inStock')).length },
    { id: 'low', label: 'Мало', count: products.filter(p => productMatchesCategoryFilter(p.catId, catFlt, categories) && matchStock(p, 'low')).length },
    { id: 'out', label: 'Нет', count: products.filter(p => productMatchesCategoryFilter(p.catId, catFlt, categories) && matchStock(p, 'out')).length },
  ]

  return (
    <div style={{ flexShrink: 0, borderBottom: '1px solid var(--border)', background: 'var(--card2)' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', border: 'none', background: 'transparent', color: 'var(--text)',
          cursor: 'pointer', fontWeight: 900, fontSize: 14,
        }}
      >
        <span>📂 Добавить по категории и фильтру</span>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '0 16px 14px' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, fontWeight: 700 }}>Категория</div>
          <div className="k-cats" style={{ marginBottom: subcategories.length ? 8 : 10 }}>
            <button type="button" className={`k-cat ${catFlt === 'all' ? 'active' : ''}`} onClick={() => pickCategory('all')}>
              <span className="ce">🏪</span>Все
              <div style={{ fontSize: 10, opacity: 0.75 }}>{products.length}</div>
            </button>
            {roots.map(c => {
              const slug = categorySlug(c)
              const count = countProductsInCategory(products, slug, categories)
              const active = catFlt === slug || activeRoot?.id === c.id
              return (
                <button key={c.id} type="button" className={`k-cat ${active ? 'active' : ''}`} onClick={() => pickCategory(slug)}>
                  <span className="ce">{c.emoji || '📦'}</span>
                  {c.name.split(' ')[0]}
                  <div style={{ fontSize: 10, opacity: 0.75 }}>{count}</div>
                </button>
              )
            })}
          </div>

          {subcategories.length > 0 && activeRoot && (
            <>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, fontWeight: 700 }}>
                Подкатегории · {activeRoot.name}
              </div>
              <div className="k-cats" style={{ marginBottom: 10 }}>
                <button
                  type="button"
                  className={`k-cat ${catFlt === categorySlug(activeRoot) ? 'active' : ''}`}
                  onClick={() => pickCategory(categorySlug(activeRoot))}
                  style={{ minWidth: 90 }}
                >
                  <span className="ce">{activeRoot.emoji || '📦'}</span>Все
                  <div style={{ fontSize: 10, opacity: 0.75 }}>{countProductsInCategory(products, categorySlug(activeRoot), categories)}</div>
                </button>
                {subcategories.map(sub => {
                  const slug = categorySlug(sub)
                  const count = countProductsInCategory(products, slug, categories)
                  return (
                    <button key={sub.id} type="button" className={`k-cat ${catFlt === slug ? 'active' : ''}`} onClick={() => pickCategory(slug)} style={{ minWidth: 90 }}>
                      <span className="ce">{sub.emoji || '📦'}</span>
                      {sub.name.split(' ')[0]}
                      <div style={{ fontSize: 10, opacity: 0.75 }}>{count}</div>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {stockFilters.map(f => (
              <button
                key={f.id}
                type="button"
                className={`k-subtab ${stockFlt === f.id ? 'active' : ''}`}
                style={{ padding: '6px 12px', fontSize: 12 }}
                onClick={() => { setStockFlt(f.id); setSelected(new Set()) }}
              >
                {f.label} ({f.count})
              </button>
            ))}
          </div>

          <input
            className="k-inp"
            style={{ marginBottom: 10 }}
            placeholder="Поиск в списке: название, артикул, штрихкод…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              Найдено <b style={{ color: 'var(--text)' }}>{filtered.length}</b>
              {selectable.length < filtered.length && (
                <> · уже в ревизии: {filtered.length - selectable.length}</>
              )}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 11 }} onClick={selectAllVisible} disabled={!selectable.length}>
                Выбрать все
              </button>
              <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 11 }} onClick={clearSelection} disabled={!selected.size}>
                Снять
              </button>
            </div>
          </div>

          <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 10, background: 'var(--card)' }}>
            {!filtered.length ? (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Нет товаров по фильтру</div>
            ) : (
              filtered.map(p => {
                const inRevision = existingProductIds.has(p.id)
                const checked = selected.has(p.id)
                const stock = Number(p.stock) || 0
                return (
                  <label
                    key={p.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                      borderBottom: '1px solid var(--border)', cursor: inRevision ? 'default' : 'pointer',
                      opacity: inRevision ? 0.5 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={inRevision}
                      onChange={() => toggle(p.id)}
                      style={{ accentColor: '#3B8EF0', width: 16, height: 16 }}
                    />
                    <span style={{ fontSize: 18 }}>{p.e || '📦'}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{p.art || '—'} · {stock} {p.unit || 'шт'}</span>
                    </span>
                    {inRevision && <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>добавлен</span>}
                  </label>
                )
              })
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="k-btn k-btn-g"
              style={{ flex: 1, minWidth: 160, background: 'linear-gradient(135deg,#3B8EF0,#2563b0)' }}
              disabled={!selectedCount}
              onClick={addSelected}
            >
              + Добавить выбранные ({selectedCount})
            </button>
            <button
              type="button"
              className="k-btn k-btn-s"
              disabled={!selectable.length}
              onClick={addAllVisible}
            >
              + Все из фильтра ({selectable.length})
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
