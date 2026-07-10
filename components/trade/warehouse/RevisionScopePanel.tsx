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
}: {
  products: Product[]
  categories: Category[]
  onStart: (items: Product[], label: string) => void
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
    { id: 'all', label: 'Все остатки' },
    { id: 'inStock', label: 'В наличии' },
    { id: 'low', label: 'Мало' },
    { id: 'out', label: 'Нет' },
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'auto', padding: '16px 16px 20px' }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>📂</div>
        <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 6 }}>Шаг 1 — Выберите категории</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, maxWidth: 420, margin: '0 auto' }}>
          Отметьте одну или несколько категорий, или нажмите «Все». На следующем шаге укажете фактический остаток по каждому товару.
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, fontWeight: 700 }}>Категории · можно выбрать несколько</div>
      <div className="k-cats" style={{ marginBottom: 14 }}>
        <button
          type="button"
          className={`k-cat ${allCats ? 'active' : ''}`}
          onClick={pickAll}
          style={allCats ? undefined : { opacity: 0.85 }}
        >
          <span className="ce">🏪</span>
          Все
          <div style={{ fontSize: 10, opacity: 0.75 }}>{products.filter(p => matchStock(p, stockFlt)).length}</div>
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
              style={!allCats && !active ? { borderColor: selectedCats.size ? 'var(--border)' : 'var(--green)', opacity: 0.9 } : undefined}
            >
              <span className="ce">{c.emoji || '📦'}</span>
              {c.name.split(' ')[0]}
              <div style={{ fontSize: 10, opacity: 0.75 }}>{count}</div>
              {active && <div style={{ fontSize: 9, marginTop: 2 }}>✓</div>}
            </button>
          )
        })}
      </div>

      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, fontWeight: 700 }}>Фильтр по остатку</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {stockFilters.map(f => (
          <button
            key={f.id}
            type="button"
            className={`k-subtab ${stockFlt === f.id ? 'active' : ''}`}
            style={{ padding: '8px 14px', fontSize: 12 }}
            onClick={() => setStockFlt(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div style={{
        padding: '14px 16px', borderRadius: 12, background: 'var(--card2)',
        border: '1px solid var(--border)', marginBottom: 16, textAlign: 'center',
      }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Будет пересчитано</div>
        <div style={{ fontSize: 28, fontWeight: 900, color: scopeProducts.length ? '#3B8EF0' : 'var(--muted)' }}>
          {scopeProducts.length} {scopeProducts.length === 1 ? 'товар' : scopeProducts.length < 5 ? 'товара' : 'товаров'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{scopeLabel}</div>
      </div>

      <button
        type="button"
        className="k-btn k-btn-g"
        style={{
          width: '100%', padding: '14px 20px', fontSize: 15, fontWeight: 900,
          background: 'linear-gradient(135deg,#3B8EF0,#2563b0)',
        }}
        disabled={!scopeProducts.length}
        onClick={() => onStart(scopeProducts, scopeLabel)}
      >
        Далее → пересчёт ({scopeProducts.length})
      </button>

      {!allCats && !selectedCats.size && (
        <div style={{ marginTop: 12, textAlign: 'center', fontSize: 12, color: 'var(--gold)' }}>
          Выберите «Все» или отметьте нужные категории
        </div>
      )}
    </div>
  )
}
