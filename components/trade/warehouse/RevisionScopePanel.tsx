'use client'

import { useMemo, useState } from 'react'
import type { Product, Category } from '@/lib/types'
import { categorySlug, productMatchesCategoryFilter } from '@/lib/useCategories'
import type { RevisionScopeStock } from './revisionDraftStorage'

export type RevisionScopeResult = {
  allCats: boolean
  cats: string[]
  stock: RevisionScopeStock
  label: string
  count: number
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

function matchStock(live: number, filter: RevisionScopeStock) {
  if (filter === 'in') return live > 0
  if (filter === 'out') return live <= 0
  return true
}

export default function RevisionScopePanel({
  products,
  categories,
  stockOf,
  initial,
  onStart,
  onCancel,
}: {
  products: Product[]
  categories: Category[]
  stockOf: (p: Product) => number
  initial?: Partial<RevisionScopeResult>
  onStart: (result: RevisionScopeResult) => void
  onCancel?: () => void
}) {
  const [allCats, setAllCats] = useState(initial?.allCats !== false)
  const [selectedCats, setSelectedCats] = useState<Set<string>>(
    () => new Set(initial?.cats || []),
  )
  const [stockFlt, setStockFlt] = useState<RevisionScopeStock>(initial?.stock || 'all')

  const roots = useMemo(
    () => categories.filter(c => c.parent_id == null).sort((a, b) => (a.order || 0) - (b.order || 0)),
    [categories],
  )

  const scopeProducts = useMemo(() => {
    return products.filter(
      p => productInScope(p, allCats, selectedCats, categories) && matchStock(stockOf(p), stockFlt),
    )
  }, [products, allCats, selectedCats, categories, stockFlt, stockOf])

  const scopeLabel = useMemo(() => {
    const parts: string[] = []
    if (allCats) parts.push('Все категории')
    else if (!selectedCats.size) parts.push('Категории не выбраны')
    else {
      const names = [...selectedCats].map(slug => {
        const c = categories.find(x => categorySlug(x) === slug)
        return c?.name || slug
      })
      parts.push(names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`)
    }
    if (stockFlt === 'in') parts.push('в наличии')
    if (stockFlt === 'out') parts.push('нет на складе')
    return parts.join(' · ')
  }, [allCats, selectedCats, categories, stockFlt])

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
    return products.filter(
      p => productMatchesCategoryFilter(p.catId, slug, categories) && matchStock(stockOf(p), stockFlt),
    ).length
  }

  const stockFilters: { id: RevisionScopeStock; label: string }[] = [
    { id: 'all', label: 'Все' },
    { id: 'in', label: 'В наличии' },
    { id: 'out', label: 'Нет' },
  ]

  const countWord = scopeProducts.length === 1 ? 'товар' : scopeProducts.length < 5 ? 'товара' : 'товаров'
  const canStart = scopeProducts.length > 0 && (allCats || selectedCats.size > 0)

  return (
    <div className="k-rev-scope">
      <div className="k-rev-scope-hero">
        <div className="k-rev-scope-hero-ic">📂</div>
        <div>
          <b>Что пересчитываем?</b>
          <small>Выберите категории и остаток — список в обходе будет только с этими товарами</small>
        </div>
      </div>

      <div className="k-rev-scope-lbl">Категории · можно несколько</div>
      <div className="k-cats k-cats-compact k-rev-cats">
        <button type="button" className={`k-cat ${allCats ? 'active' : ''}`} onClick={pickAll}>
          <span className="ce">🏪</span>
          Все
          <span className="cc">{products.filter(p => matchStock(stockOf(p), stockFlt)).length}</span>
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
        <span>В обход</span>
        <b style={{ color: canStart ? '#3B8EF0' : 'var(--muted)' }}>
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
          disabled={!canStart}
          onClick={() => onStart({
            allCats,
            cats: [...selectedCats],
            stock: stockFlt,
            label: scopeLabel,
            count: scopeProducts.length,
          })}
        >
          Далее · обход →
        </button>
      </div>
    </div>
  )
}
