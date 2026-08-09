'use client'

import { useMemo, useState } from 'react'
import type { Product, Category } from '@/lib/types'
import { categorySlug, productMatchesCategoryFilter } from '@/lib/useCategories'

type StockFilter = 'all' | 'inStock' | 'low' | 'out'

function matchStock(p: Product, filter: StockFilter) {
  const stock = Number(p.stock) || 0
  if (filter === 'inStock') return stock > 5
  if (filter === 'low') return stock > 0 && stock <= 5
  if (filter === 'out') return stock <= 0
  return true
}

function productInScope(
  p: Product,
  allCats: boolean,
  selectedCats: Set<string>,
  categories: Category[],
) {
  if (allCats) return true
  if (!selectedCats.size) return false
  for (const slug of selectedCats) {
    if (productMatchesCategoryFilter(p.catId, slug, categories)) return true
  }
  return false
}

export default function RevisionScopePanel({
  products,
  categories,
  onStart,
  onCancel,
}: {
  products: Product[]
  categories: Category[]
  onStart: (items: Product[], label: string) => void
  onCancel?: () => void
}) {
  const [allCats, setAllCats] = useState(true)
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set())
  const [stockFlt, setStockFlt] = useState<StockFilter>('all')

  const roots = useMemo(
    () => categories.filter(c => c.parent_id == null).sort((a, b) => (a.order || 0) - (b.order || 0)),
    [categories],
  )

  const scopeProducts = useMemo(() => {
    return products.filter(p => productInScope(p, allCats, selectedCats, categories) && matchStock(p, stockFlt))
  }, [products, allCats, selectedCats, categories, stockFlt])

  const scopeLabel = useMemo(() => {
    if (allCats) return 'Все категории'
    if (!selectedCats.size) return 'Выберите категории'
    const names = [...selectedCats].map(slug => {
      const c = categories.find(x => categorySlug(x) === slug)
      return c?.name || slug
    })
    return names.join(', ')
  }, [allCats, selectedCats, categories])

  function pickAll() {
    setAllCats(true)
    setSelectedCats(new Set())
  }

  function toggleRoot(slug: string) {
    setAllCats(false)
    setSelectedCats(prev => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  function countInRoot(slug: string) {
    return products.filter(p => productMatchesCategoryFilter(p.catId, slug, categories) && matchStock(p, stockFlt)).length
  }

  const stockFilters: { id: StockFilter; label: string }[] = [
    { id: 'all', label: 'Все' },
    { id: 'inStock', label: 'В наличии' },
    { id: 'low', label: 'Мало' },
    { id: 'out', label: 'Нет' },
  ]

  const countWord = scopeProducts.length === 1 ? 'товар' : scopeProducts.length < 5 ? 'товара' : 'товаров'

  return (
    <div className="k-rev-scope">
      <div className="k-rev-scope-lbl">Категории · можно несколько</div>
      <div className="k-cats k-cats-compact k-rev-cats">
        <button
          type="button"
          className={`k-cat ${allCats ? 'active' : ''}`}
          onClick={pickAll}
        >
          <span className="ce">🏪</span>
          Все
          <span className="cc">{products.filter(p => matchStock(p, stockFlt)).length}</span>
        </button>
        {roots.map(c => {
          const slug = categorySlug(c)
          const active = !allCats && selectedCats.has(slug)
          const count = countInRoot(slug)
          return (
            <button
              key={c.id}
              type="button"
              className={`k-cat ${active ? 'active' : ''}`}
              onClick={() => toggleRoot(slug)}
            >
              <span className="ce">{c.emoji || '📦'}</span>
              {c.name.split(' ')[0]}
              <span className="cc">{count}</span>
              {active && <span className="cc">✓</span>}
            </button>
          )
        })}
      </div>

      <div className="k-rev-scope-lbl">Остаток</div>
      <div className="k-rev-stock-flt">
        {stockFilters.map(f => (
          <button
            key={f.id}
            type="button"
            className={`k-subtab ${stockFlt === f.id ? 'active' : ''}`}
            onClick={() => setStockFlt(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="k-rev-scope-sum">
        <span>Пересчёт</span>
        <b style={{ color: scopeProducts.length ? '#3B8EF0' : 'var(--muted)' }}>
          {scopeProducts.length} {countWord}
        </b>
        <span className="k-rev-scope-sum-sub">{scopeLabel}</span>
      </div>

      {!allCats && !selectedCats.size && (
        <div className="k-rev-scope-hint">Выберите «Все» или отметьте категории</div>
      )}

      <div className="k-rev-scope-actions">
        {onCancel && (
          <button type="button" className="k-btn k-btn-s" onClick={onCancel}>
            Отмена
          </button>
        )}
        <button
          type="button"
          className="k-btn k-btn-g"
          style={{ background: 'linear-gradient(135deg,#3B8EF0,#2563b0)' }}
          disabled={!scopeProducts.length}
          onClick={() => onStart(scopeProducts, scopeLabel)}
        >
          Далее → {scopeProducts.length}
        </button>
      </div>
    </div>
  )
}
