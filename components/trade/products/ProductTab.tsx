'use client'

import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import ProductFormFields from './ProductFormFields'
import ProductImage from '@/components/shared/ProductImage'
import ProductArrivalsPanel from './ProductArrivalsPanel'
import { money, stockStatus } from './productFormShared'
import { formatBulkPricingHint, hasBulkPricing } from '@/lib/productBulkPricing'
import { isWeighted } from '@/lib/productWeight'
import { productBarcodes } from '@/lib/productBarcodes'
import { buildProductCodeIndex, filterProductsByQuery } from '@/lib/productSearchIndex'
import {
  categoryDisplayLabel,
  categorySlug,
  getDescendantSlugs,
  productMatchesCategoryFilter,
} from '@/lib/useCategories'
import type { Category, Product } from '@/lib/types'
import type { ProductForm } from './productFormShared'

type StatFilter = 'all' | 'inStock' | 'low' | 'out' | 'hot' | 'bulk'

/** Сначала рисуем часть таблицы — полный каталог без виртуализации вешает UI */
const CATALOG_PAGE = 80

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

export default function ProductTab({
  products,
  loaded,
  search,
  categories,
  getPhoto,
  form,
  setForm,
  formDirty,
  selectedId,
  isNew,
  saving,
  onSelect,
  onNew,
  onSave,
  onDelete,
  onDeleteProduct,
  onDeleteProducts,
  onOpenEdit,
  onRefreshProducts,
}: {
  products: Product[]
  loaded: boolean
  search: string
  categories: Category[]
  getPhoto: (id: number) => string | undefined
  form: ProductForm
  setForm: (f: ProductForm) => void
  formDirty?: boolean
  selectedId: number | null
  isNew: boolean
  saving: boolean
  onSelect: (id: number) => void
  onNew: (catId?: string) => void
  onSave: () => void
  onDelete: () => void
  onDeleteProduct: (id: number, name: string) => void
  onDeleteProducts: (ids: number[]) => Promise<void> | void
  onOpenEdit: (id: number) => void
  onRefreshProducts?: () => void
}) {
  const [view, setView] = useState<'catalog' | 'edit'>('catalog')
  const [arrivalsOpen, setArrivalsOpen] = useState(false)
  const [catFlt, setCatFlt] = useState('all')
  const [statFlt, setStatFlt] = useState<StatFilter>('all')
  const [visibleCount, setVisibleCount] = useState(CATALOG_PAGE)
  const [checked, setChecked] = useState<Set<number>>(() => new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)

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

  const stats = useMemo(() => {
    let inStock = 0
    let low = 0
    let out = 0
    let hot = 0
    let bulk = 0
    for (const p of products) {
      const s = Number(p.stock) || 0
      if (s > 5) inStock += 1
      else if (s > 0) low += 1
      else out += 1
      if (p.hot) hot += 1
      if (hasBulkPricing(p)) bulk += 1
    }
    return { total: products.length, inStock, low, out, hot, bulk }
  }, [products])

  /** Один проход: catId → count, затем суммы по дереву категорий */
  const catCounts = useMemo(() => {
    const byId = new Map<string, number>()
    for (const p of products) {
      const id = p.catId || ''
      byId.set(id, (byId.get(id) || 0) + 1)
    }
    const cache = new Map<string, number>()
    const countFor = (slug: string) => {
      if (cache.has(slug)) return cache.get(slug)!
      let n = 0
      for (const s of getDescendantSlugs(categories, slug)) n += byId.get(s) || 0
      cache.set(slug, n)
      return n
    }
    return { countFor }
  }, [products, categories])

  const q = search.trim()
  const deferredQ = useDeferredValue(q)
  const codeIndex = useMemo(() => buildProductCodeIndex(products), [products])

  const filtered = useMemo(() => {
    const matchStat = (p: Product) => {
      const stock = Number(p.stock) || 0
      if (statFlt === 'inStock') return stock > 5
      if (statFlt === 'low') return stock > 0 && stock <= 5
      if (statFlt === 'out') return stock <= 0
      if (statFlt === 'hot') return !!p.hot
      if (statFlt === 'bulk') return hasBulkPricing(p)
      return true
    }
    const byQuery = filterProductsByQuery(
      products,
      codeIndex,
      deferredQ,
      p => `${p.cat} ${categoryDisplayLabel(categories, p.catId, p.cat)}`,
    )
    return byQuery.filter(p =>
      productMatchesCategoryFilter(p.catId, catFlt, categories) && matchStat(p),
    )
  }, [products, categories, deferredQ, catFlt, statFlt, codeIndex])

  const visibleRows = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  )

  useEffect(() => {
    setVisibleCount(CATALOG_PAGE)
  }, [q, catFlt, statFlt])

  useEffect(() => {
    const alive = new Set(products.map(p => p.id))
    setChecked(prev => {
      let changed = false
      const next = new Set<number>()
      for (const id of prev) {
        if (alive.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [products])

  const filteredIds = useMemo(() => filtered.map(p => p.id), [filtered])
  const allFilteredChecked = filteredIds.length > 0 && filteredIds.every(id => checked.has(id))
  const someFilteredChecked = filteredIds.some(id => checked.has(id))

  function toggleChecked(id: number, on: boolean) {
    setChecked(prev => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleAllFiltered(on: boolean) {
    setChecked(prev => {
      const next = new Set(prev)
      for (const id of filteredIds) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  async function deleteChecked() {
    const ids = [...checked]
    if (!ids.length) return
    if (!confirm(`Удалить ${ids.length} товар(ов)?`)) return
    setBulkDeleting(true)
    try {
      await onDeleteProducts(ids)
      setChecked(new Set())
    } finally {
      setBulkDeleting(false)
    }
  }

  function pickCategory(slug: string) {
    setCatFlt(slug)
  }

  function openEdit(id: number) {
    onOpenEdit(id)
    setView('edit')
  }

  function startNew() {
    onNew(catFlt !== 'all' ? catFlt : undefined)
    setView('edit')
  }

  function backToCatalog() {
    if (formDirty && !confirm('Есть несохранённые изменения. Вернуться к каталогу без сохранения?')) return
    setView('catalog')
  }

  if (view === 'edit') {
    const qList = search.trim()
    const list = filterProductsByQuery(
      products,
      codeIndex,
      qList,
      p => categoryDisplayLabel(categories, p.catId, p.cat),
    )
    const editProduct = selectedId ? products.find(p => p.id === selectedId) || null : null

    return (
      <div>
        <div className="k-page-h" style={{ marginTop: 0, marginBottom: 12 }}>
          <button type="button" className="k-btn k-btn-s" onClick={backToCatalog}>← К каталогу</button>
        </div>
        <div className="k-product-layout">
          <aside className="k-product-list">
            <div className="k-product-list-head">
              <b>Все товары · {products.length}</b>
              <button type="button" className="k-btn k-btn-g" style={{ padding: '6px 10px', fontSize: 12 }} onClick={startNew}>+ Новый</button>
            </div>
            <div className="k-product-list-body">
              {list.map(p => (
                <button
                  key={p.id}
                  type="button"
                  className={`k-product-pick ${selectedId === p.id && !isNew ? 'active' : ''}`}
                  onClick={() => onSelect(p.id)}
                >
                  <ProductImage product={p} preferThumb getPhoto={getPhoto} size={36} radius={9} emojiSize={18} />
                  <span className="pi">
                    <b>{p.name}</b>
                    <span>{p.art} · {money(p.price)}</span>
                  </span>
                </button>
              ))}
              {!list.length && <div className="k-empty" style={{ padding: 20 }}>Нет товаров</div>}
            </div>
          </aside>

          <section className="k-card k-product-form">
            <div className="k-card-h">
              <div>
                <b>{isNew ? 'Новый товар' : selectedId ? `Товар · ${form.name || '…'}` : 'Выберите товар'}</b>
                {formDirty && (
                  <div style={{ fontSize: 11, color: 'var(--gold)', marginTop: 4, fontWeight: 700 }}>
                    ● Несохранённые изменения
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {!isNew && selectedId && editProduct && (
                  <button type="button" className="k-btn k-btn-s" onClick={() => setArrivalsOpen(true)}>
                    📦 Партии
                  </button>
                )}
                {!isNew && selectedId && (
                  <button type="button" className="k-btn k-btn-s" style={{ color: 'var(--red)' }} onClick={onDelete}>Удалить</button>
                )}
                <button type="button" className="k-btn k-btn-g" disabled={saving || !form.name} onClick={onSave}>
                  {saving ? 'Сохранение…' : 'Сохранить'}
                </button>
              </div>
            </div>
            <div className="k-card-b">
              {(isNew || selectedId) ? (
                <>
                  <div className="k-hint" style={{ marginBottom: 8 }}>
                    Общий товар KAKAPO — изменения видны в магазине, админке и кассе.
                  </div>
                  <ProductFormFields form={form} setForm={setForm} categories={categories} productId={isNew ? null : selectedId} products={products} />
                </>
              ) : (
                <div className="k-empty">Выберите товар слева или нажмите «+ Новый»</div>
              )}
            </div>
          </section>
        </div>
        {editProduct && (
          <ProductArrivalsPanel
            product={editProduct}
            open={arrivalsOpen}
            onClose={() => setArrivalsOpen(false)}
            onUpdated={() => onRefreshProducts?.()}
          />
        )}
      </div>
    )
  }

  return (
    <>
      <div className="k-page-h" style={{ marginTop: 0 }}>
        <div>
          <h1>📦 Товар</h1>
          <div className="sub">Все товары KAKAPO · фильтр по категории и подкатегории · общие данные для всех приложений</div>
        </div>
        <button type="button" className="k-btn k-btn-g" onClick={startNew}>+ Добавить товар</button>
      </div>

      <div className="k-kpis">
        <StatCard label="Всего позиций" value={stats.total} active={statFlt === 'all' && catFlt === 'all'} onClick={() => { setStatFlt('all'); setCatFlt('all') }} />
        <StatCard label="В наличии" value={stats.inStock} color="var(--green)" active={statFlt === 'inStock'} onClick={() => setStatFlt(s => s === 'inStock' ? 'all' : 'inStock')} />
        <StatCard label="Мало (≤5)" value={stats.low} color="var(--gold)" active={statFlt === 'low'} onClick={() => setStatFlt(s => s === 'low' ? 'all' : 'low')} />
        <StatCard label="Нет в наличии" value={stats.out} color="var(--red)" active={statFlt === 'out'} onClick={() => setStatFlt(s => s === 'out' ? 'all' : 'out')} />
        <StatCard label="Хиты" value={stats.hot} color="var(--gold)" active={statFlt === 'hot'} onClick={() => setStatFlt(s => s === 'hot' ? 'all' : 'hot')} />
        <StatCard label="С оптом" value={stats.bulk} color="#FF8C00" active={statFlt === 'bulk'} onClick={() => setStatFlt(s => s === 'bulk' ? 'all' : 'bulk')} />
      </div>

      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, fontWeight: 700 }}>Категории</div>
      <div className="k-cats" style={{ marginBottom: subcategories.length ? 8 : 16 }}>
        <button type="button" className={`k-cat ${catFlt === 'all' ? 'active' : ''}`} onClick={() => pickCategory('all')}>
          <span className="ce">🏪</span>Все<div style={{ fontSize: 10, opacity: 0.75 }}>{stats.total}</div>
        </button>
        {roots.map(c => {
          const slug = categorySlug(c)
          const count = catCounts.countFor(slug)
          const active = catFlt === slug || activeRoot?.id === c.id
          return (
            <button key={c.id} type="button" className={`k-cat ${active ? 'active' : ''}`} onClick={() => pickCategory(slug)}>
              <span className="ce">{c.emoji || '📦'}</span>{c.name.split(' ')[0]}
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
          <div className="k-cats" style={{ marginBottom: 16 }}>
            <button
              type="button"
              className={`k-cat ${catFlt === categorySlug(activeRoot) ? 'active' : ''}`}
              onClick={() => pickCategory(categorySlug(activeRoot))}
              style={{ minWidth: 90 }}
            >
              <span className="ce">{activeRoot.emoji || '📦'}</span>Все
              <div style={{ fontSize: 10, opacity: 0.75 }}>{catCounts.countFor(categorySlug(activeRoot))}</div>
            </button>
            {subcategories.map(sub => {
              const slug = categorySlug(sub)
              const count = catCounts.countFor(slug)
              return (
                <button key={sub.id} type="button" className={`k-cat ${catFlt === slug ? 'active' : ''}`} onClick={() => pickCategory(slug)} style={{ minWidth: 90 }}>
                  <span className="ce">{sub.emoji || '📦'}</span>{sub.name.split(' ')[0]}
                  <div style={{ fontSize: 10, opacity: 0.75 }}>{count}</div>
                </button>
              )
            })}
          </div>
        </>
      )}

      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span>
          Показано {Math.min(visibleCount, filtered.length)} из {filtered.length}
          {filtered.length !== products.length ? ` (фильтр · всего ${products.length})` : ''}
          {catFlt !== 'all' && ` · ${categoryDisplayLabel(categories, catFlt, catFlt)}`}
          {!loaded && ' · загрузка…'}
        </span>
        {checked.size > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
            <span style={{ fontWeight: 800, color: 'var(--text)' }}>Выбрано {checked.size}</span>
            <button
              type="button"
              className="k-btn k-btn-s"
              style={{ color: 'var(--red)' }}
              disabled={bulkDeleting}
              onClick={() => void deleteChecked()}
            >
              {bulkDeleting ? 'Удаление…' : 'Удалить отмеченные'}
            </button>
            <button type="button" className="k-btn k-btn-s" disabled={bulkDeleting} onClick={() => setChecked(new Set())}>
              Снять
            </button>
          </span>
        )}
      </div>

      <section className="k-card">
        <div className="k-card-b" style={{ padding: 0 }}>
          <div className="k-tbl-scroll">
            <table className="k-tbl">
              <thead>
                <tr>
                  <th style={{ width: 36 }} onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={allFilteredChecked}
                      ref={el => {
                        if (el) el.indeterminate = someFilteredChecked && !allFilteredChecked
                      }}
                      onChange={e => toggleAllFiltered(e.target.checked)}
                      title="Выбрать все в фильтре"
                      aria-label="Выбрать все в фильтре"
                    />
                  </th>
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
                {visibleRows.map(p => {
                  const sc = stockStatus(Number(p.stock) || 0)
                  const bulkHint = formatBulkPricingHint(p)
                  const catLabel = categoryDisplayLabel(categories, p.catId, p.cat)
                  const codes = productBarcodes(p)
                  const isChecked = checked.has(p.id)
                  return (
                    <tr key={p.id} className="k-prodrow" onClick={() => openEdit(p.id)}>
                      <td onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={e => toggleChecked(p.id, e.target.checked)}
                          aria-label={`Выбрать ${p.name}`}
                        />
                      </td>
                      <td><span style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 800 }}>{p.art}</span></td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <ProductImage product={p} preferThumb getPhoto={getPhoto} size={44} radius={10} plate="theme" />
                          <div>
                            <div style={{ fontWeight: 800 }}>{p.name}</div>
                            {codes.length > 0 && (
                              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                                ШК: {codes[0]}{codes.length > 1 ? ` +${codes.length - 1}` : ''}
                              </div>
                            )}
                            {bulkHint && <div style={{ fontSize: 10, color: 'var(--gold)' }}>{bulkHint}</div>}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="k-badge k-badge-cat">{catLabel}</span>
                      </td>
                      <td className="num" style={{ color: 'var(--green)', fontWeight: 900 }}>{money(p.price)}</td>
                      <td className="num">{money(p.costPrice)}</td>
                      <td style={{ color: 'var(--muted)' }}>{p.unit}{isWeighted(p) ? ' ⚖️' : ''}</td>
                      <td className="num" style={{ fontWeight: 800, color: sc.c }}>{p.stock}</td>
                      <td><span className="k-badge" style={{ background: sc.bg, color: sc.c }}>{sc.l}</span></td>
                      <td onClick={e => e.stopPropagation()}>
                        <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 12, color: 'var(--red)' }} onClick={() => onDeleteProduct(p.id, p.name)}>✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!filtered.length && <div className="k-empty">{loaded ? 'Товары не найдены' : 'Загрузка товаров…'}</div>}
            {filtered.length > visibleCount && (
              <div style={{ padding: 12, textAlign: 'center' }}>
                <button
                  type="button"
                  className="k-btn k-btn-s"
                  onClick={() => setVisibleCount(c => c + CATALOG_PAGE)}
                >
                  Показать ещё ({filtered.length - visibleCount})
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  )
}
