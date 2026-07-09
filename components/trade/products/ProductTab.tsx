'use client'

import { useMemo, useState } from 'react'
import ProductFormFields from './ProductFormFields'
import { money, stockStatus } from './productFormShared'
import { formatBulkPricingHint, hasBulkPricing } from '@/lib/productBulkPricing'
import { isWeighted } from '@/lib/productWeight'
import { productBarcodeSearchText, productBarcodes } from '@/lib/productBarcodes'
import {
  categoryDisplayLabel,
  categorySlug,
  countProductsInCategory,
  productMatchesCategoryFilter,
} from '@/lib/useCategories'
import type { Category, Product } from '@/lib/types'
import type { ProductForm } from './productFormShared'

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
  onOpenEdit,
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
  onOpenEdit: (id: number) => void
}) {
  const [view, setView] = useState<'catalog' | 'edit'>('catalog')
  const [catFlt, setCatFlt] = useState('all')
  const [statFlt, setStatFlt] = useState<StatFilter>('all')

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
    const catLabel = categoryDisplayLabel(categories, p.catId, p.cat)
    const matchQ = !q || `${p.name} ${p.art} ${productBarcodeSearchText(p)} ${p.cat} ${catLabel}`.toLowerCase().includes(q)
    const matchC = productMatchesCategoryFilter(p.catId, catFlt, categories)
    return matchQ && matchC && matchStat(p)
  })

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
    const qList = search.trim().toLowerCase()
    const list = products.filter(p => {
      const catLabel = categoryDisplayLabel(categories, p.catId, p.cat)
      return !qList || `${p.name} ${p.art} ${productBarcodeSearchText(p)} ${catLabel}`.toLowerCase().includes(qList)
    })

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
                  <span className="pe">{p.e || '📦'}</span>
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
                {!isNew && selectedId && (
                  <button type="button" className="k-btn k-btn-s" style={{ color: 'var(--red)' }} onClick={onDelete}>Удалить</button>
                )}
                <button type="button" className="k-btn k-btn-g" disabled={saving || !form.name || !form.price} onClick={onSave}>
                  {saving ? 'Сохранение…' : 'Сохранить'}
                </button>
              </div>
            </div>
            <div className="k-card-b">
              {(isNew || selectedId) ? (
                <>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
                    Общий товар KAKAPO — изменения видны в магазине, админке и кассе.
                  </div>
                  <ProductFormFields form={form} setForm={setForm} categories={categories} />
                </>
              ) : (
                <div className="k-empty">Выберите товар слева или нажмите «+ Новый»</div>
              )}
            </div>
          </section>
        </div>
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
        <StatCard label="Всего позиций" value={products.length} active={statFlt === 'all' && catFlt === 'all'} onClick={() => { setStatFlt('all'); setCatFlt('all') }} />
        <StatCard label="В наличии" value={products.filter(p => Number(p.stock) > 5).length} color="var(--green)" active={statFlt === 'inStock'} onClick={() => setStatFlt(s => s === 'inStock' ? 'all' : 'inStock')} />
        <StatCard label="Мало (≤5)" value={products.filter(p => { const s = Number(p.stock); return s > 0 && s <= 5 }).length} color="var(--gold)" active={statFlt === 'low'} onClick={() => setStatFlt(s => s === 'low' ? 'all' : 'low')} />
        <StatCard label="Нет в наличии" value={products.filter(p => Number(p.stock) <= 0).length} color="var(--red)" active={statFlt === 'out'} onClick={() => setStatFlt(s => s === 'out' ? 'all' : 'out')} />
        <StatCard label="Хиты" value={products.filter(p => p.hot).length} color="var(--gold)" active={statFlt === 'hot'} onClick={() => setStatFlt(s => s === 'hot' ? 'all' : 'hot')} />
        <StatCard label="С оптом" value={products.filter(p => hasBulkPricing(p)).length} color="#FF8C00" active={statFlt === 'bulk'} onClick={() => setStatFlt(s => s === 'bulk' ? 'all' : 'bulk')} />
      </div>

      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, fontWeight: 700 }}>Категории</div>
      <div className="k-cats" style={{ marginBottom: subcategories.length ? 8 : 16 }}>
        <button type="button" className={`k-cat ${catFlt === 'all' ? 'active' : ''}`} onClick={() => pickCategory('all')}>
          <span className="ce">🏪</span>Все<div style={{ fontSize: 10, opacity: 0.75 }}>{products.length}</div>
        </button>
        {roots.map(c => {
          const slug = categorySlug(c)
          const count = countProductsInCategory(products, slug, categories)
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
              <div style={{ fontSize: 10, opacity: 0.75 }}>{countProductsInCategory(products, categorySlug(activeRoot), categories)}</div>
            </button>
            {subcategories.map(sub => {
              const slug = categorySlug(sub)
              const count = countProductsInCategory(products, slug, categories)
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

      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
        Показано {filtered.length} из {products.length}
        {catFlt !== 'all' && ` · ${categoryDisplayLabel(categories, catFlt, catFlt)}`}
        {!loaded && ' · загрузка…'}
      </div>

      <section className="k-card">
        <div className="k-card-b" style={{ padding: 0 }}>
          <div style={{ maxHeight: '62vh', overflow: 'auto' }}>
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
                  const catLabel = categoryDisplayLabel(categories, p.catId, p.cat)
                  return (
                    <tr key={p.id} className="k-prodrow" onClick={() => openEdit(p.id)}>
                      <td><span style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 800 }}>{p.art}</span></td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#0e1712', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, overflow: 'hidden', flexShrink: 0 }}>
                            {photo ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (p.e || '📦')}
                          </div>
                          <div>
                            <div style={{ fontWeight: 800 }}>{p.name}</div>
                            {(() => {
                              const codes = productBarcodes(p)
                              if (!codes.length) return null
                              return (
                                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                                  ШК: {codes[0]}{codes.length > 1 ? ` +${codes.length - 1}` : ''}
                                </div>
                              )
                            })()}
                            {bulkHint && <div style={{ fontSize: 10, color: '#FF8C00' }}>{bulkHint}</div>}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="k-badge" style={{ background: '#1a2430', color: 'var(--blue)' }}>{catLabel}</span>
                      </td>
                      <td className="num" style={{ color: 'var(--green)', fontWeight: 900 }}>{money(p.price)}</td>
                      <td className="num">{money(p.costPrice)}</td>
                      <td style={{ color: 'var(--muted)' }}>{p.unit}{isWeighted(p) ? ' ⚖️' : ''}</td>
                      <td className="num" style={{ fontWeight: 800, color: sc.c }}>{p.stock}</td>
                      <td><span className="k-badge" style={{ background: sc.c + '22', color: sc.c }}>{sc.l}</span></td>
                      <td onClick={e => e.stopPropagation()}>
                        <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 12, color: 'var(--red)' }} onClick={() => onDeleteProduct(p.id, p.name)}>✕</button>
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
