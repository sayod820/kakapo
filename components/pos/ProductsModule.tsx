'use client'

import { useEffect, useMemo, useState } from 'react'
import { useProducts } from '@/lib/store'
import { useProductPhotos } from '@/lib/productPhotos'
import { POS_CATEGORIES, posCategoryName } from '@/lib/posCategories'
import { formatBulkPricingHint, hasBulkPricing } from '@/lib/productBulkPricing'
import { isWeighted } from '@/lib/productWeight'
import type { Product, SellType } from '@/lib/types'

function money(n: number | undefined | null) {
  return `${(Number(n) || 0).toFixed(2)} сом`
}

type StatFilter = 'all' | 'inStock' | 'low' | 'out' | 'hot' | 'bulk'

type ProductForm = {
  name: string
  art: string
  e: string
  catId: string
  price: string
  costPrice: string
  stock: string
  unit: string
  barcode: string
  brand: string
  desc: string
  photo: string
  sellType: SellType
  weightStep: string
  unitGrams: string
  hot: boolean
  organic: boolean
}

function emptyForm(): ProductForm {
  return {
    name: '', art: '', e: '📦', catId: 'veg', price: '', costPrice: '', stock: '0',
    unit: 'шт', barcode: '', brand: '', desc: '', photo: '', sellType: 'piece',
    weightStep: '100', unitGrams: '1000', hot: false, organic: false,
  }
}

function formFromProduct(p: Product, photo?: string): ProductForm {
  return {
    name: p.name,
    art: p.art,
    e: p.e || '📦',
    catId: p.catId || 'veg',
    price: String(p.price ?? ''),
    costPrice: p.costPrice != null ? String(p.costPrice) : '',
    stock: String(p.stock ?? 0),
    unit: p.unit || 'шт',
    barcode: p.barcode || '',
    brand: p.brand || '',
    desc: p.desc || '',
    photo: p.photo || photo || '',
    sellType: p.sellType || 'piece',
    weightStep: String(p.weightStep || 100),
    unitGrams: String(p.unitGrams || 1000),
    hot: !!p.hot,
    organic: !!p.organic,
  }
}

function stockStatus(stock: number) {
  if (stock <= 0) return { c: 'var(--red)', l: 'Нет' }
  if (stock <= 5) return { c: 'var(--gold)', l: 'Мало' }
  return { c: 'var(--green)', l: 'Есть' }
}

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

function ProductFormModal({
  title,
  form,
  setForm,
  onSave,
  onClose,
  saving,
}: {
  title: string
  form: ProductForm
  setForm: (f: ProductForm) => void
  onSave: () => void
  onClose: () => void
  saving: boolean
}) {
  return (
    <div className="k-modal-bg" onClick={onClose}>
      <div className="k-modal k-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="k-modal-h">
          <b>{title}</b>
          <button type="button" onClick={onClose}>×</button>
        </div>
        <div className="k-modal-b" style={{ padding: 16 }}>
          <div className="k-grid2">
            <div className="k-field">
              <label>Название *</label>
              <input className="k-inp" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="k-field">
              <label>Артикул</label>
              <input className="k-inp" value={form.art} onChange={e => setForm({ ...form, art: e.target.value })} placeholder="KAK-0001" />
            </div>
            <div className="k-field">
              <label>Эмодзи / иконка</label>
              <input className="k-inp" value={form.e} onChange={e => setForm({ ...form, e: e.target.value })} />
            </div>
            <div className="k-field">
              <label>Категория</label>
              <select className="k-sel" value={form.catId} onChange={e => setForm({ ...form, catId: e.target.value })}>
                {POS_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.e} {c.name}</option>)}
              </select>
            </div>
            <div className="k-field">
              <label>Цена продажи *</label>
              <input className="k-inp" type="number" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} />
            </div>
            <div className="k-field">
              <label>Себестоимость</label>
              <input className="k-inp" type="number" step="0.01" value={form.costPrice} onChange={e => setForm({ ...form, costPrice: e.target.value })} />
            </div>
            <div className="k-field">
              <label>Остаток</label>
              <input className="k-inp" type="number" step="0.01" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} />
            </div>
            <div className="k-field">
              <label>Единица</label>
              <input className="k-inp" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="шт, кг, л…" />
            </div>
            <div className="k-field">
              <label>Штрихкод</label>
              <input className="k-inp" value={form.barcode} onChange={e => setForm({ ...form, barcode: e.target.value })} />
            </div>
            <div className="k-field">
              <label>Бренд</label>
              <input className="k-inp" value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} />
            </div>
            <div className="k-field">
              <label>Тип продажи</label>
              <select className="k-sel" value={form.sellType} onChange={e => setForm({ ...form, sellType: e.target.value as SellType })}>
                <option value="piece">Поштучно</option>
                <option value="weight">На развес</option>
              </select>
            </div>
            {form.sellType === 'weight' && (
              <>
                <div className="k-field">
                  <label>Шаг, г</label>
                  <input className="k-inp" type="number" value={form.weightStep} onChange={e => setForm({ ...form, weightStep: e.target.value })} />
                </div>
                <div className="k-field">
                  <label>Цена за, г</label>
                  <input className="k-inp" type="number" value={form.unitGrams} onChange={e => setForm({ ...form, unitGrams: e.target.value })} />
                </div>
              </>
            )}
            <div className="k-field" style={{ gridColumn: '1 / -1' }}>
              <label>Фото (URL)</label>
              <input className="k-inp" value={form.photo} onChange={e => setForm({ ...form, photo: e.target.value })} placeholder="https://…" />
            </div>
            <div className="k-field" style={{ gridColumn: '1 / -1' }}>
              <label>Описание</label>
              <textarea className="k-ta" value={form.desc} onChange={e => setForm({ ...form, desc: e.target.value })} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.hot} onChange={e => setForm({ ...form, hot: e.target.checked })} />
              <span>Хит продаж</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.organic} onChange={e => setForm({ ...form, organic: e.target.checked })} />
              <span>Органик</span>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
            <button type="button" className="k-btn k-btn-s" onClick={onClose}>Отмена</button>
            <button type="button" className="k-btn k-btn-g" disabled={saving || !form.name || !form.price} onClick={onSave}>
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ProductsModule({ search }: { search: string }) {
  const products = useProducts(s => s.products)
  const loaded = useProducts(s => s.loaded)
  const saveProduct = useProducts(s => s.saveProduct)
  const removeProduct = useProducts(s => s.removeProduct)
  const { getPhoto, setPhoto, hydrate } = useProductPhotos()

  const [catFlt, setCatFlt] = useState('all')
  const [statFlt, setStatFlt] = useState<StatFilter>('all')
  const [showAdd, setShowAdd] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<ProductForm>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { void hydrate() }, [hydrate])

  const editProduct = useMemo(() => products.find(p => p.id === editId) || null, [products, editId])

  useEffect(() => {
    if (!editProduct) return
    setForm(formFromProduct(editProduct, getPhoto(editProduct.id)))
  }, [editProduct, getPhoto])

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

  async function buildPayload(data: ProductForm, existing?: Product | null) {
    const id = existing?.id ?? Math.max(0, ...products.map(p => p.id)) + 1
    const art = data.art.trim() || `KAK-${String(id).padStart(4, '0')}`
    return {
      ...(existing || {}),
      id: existing?.id,
      art,
      e: data.e || '📦',
      name: data.name.trim(),
      price: Number(data.price) || 0,
      costPrice: data.costPrice ? Number(data.costPrice) : null,
      catId: data.catId,
      cat: posCategoryName(data.catId),
      unit: data.unit || 'шт',
      stock: Number(data.stock) || 0,
      barcode: data.barcode || undefined,
      brand: data.brand || undefined,
      desc: data.desc || undefined,
      photo: data.photo || undefined,
      sellType: data.sellType,
      hot: data.hot,
      organic: data.organic,
      bulkPricing: existing?.bulkPricing,
      ...(data.sellType === 'weight' ? {
        weightStep: Number(data.weightStep) || 100,
        minWeight: Number(data.weightStep) || 100,
        unitGrams: Number(data.unitGrams) || 1000,
      } : {}),
    }
  }

  async function handleAdd() {
    setSaving(true)
    setMsg('')
    try {
      const payload = await buildPayload(form)
      const saved = await saveProduct(payload)
      if (saved && form.photo) setPhoto(saved.id, form.photo)
      setShowAdd(false)
      setForm(emptyForm())
      setMsg('Товар добавлен')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit() {
    if (!editProduct) return
    setSaving(true)
    setMsg('')
    try {
      const payload = await buildPayload(form, editProduct)
      const saved = await saveProduct(payload)
      if (saved && form.photo) setPhoto(saved.id, form.photo)
      setEditId(null)
      setMsg('Товар обновлён')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Удалить товар «${name}»?`)) return
    await removeProduct(id)
    setMsg('Товар удалён')
  }

  return (
    <div>
      <div className="k-page-h">
        <div>
          <h1>📦 Товары</h1>
          <div className="sub">Каталог товаров — основа для кассы и склада. Общие данные со всеми приложениями KAKAPO.</div>
        </div>
        <button type="button" className="k-btn k-btn-g" onClick={() => { setForm(emptyForm()); setShowAdd(true) }}>
          + Добавить товар
        </button>
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

      {msg && <div className="k-alert" style={{ marginBottom: 12 }}>{msg}</div>}

      <section className="k-card">
        <div className="k-card-b" style={{ padding: 0 }}>
          <div style={{ maxHeight: '58vh', overflow: 'auto' }}>
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
                    <tr key={p.id} className="k-prodrow" onClick={() => setEditId(p.id)}>
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
                        <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px', fontSize: 12, color: 'var(--red)' }} onClick={() => void handleDelete(p.id, p.name)}>✕</button>
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

      {showAdd && (
        <ProductFormModal
          title="Новый товар"
          form={form}
          setForm={setForm}
          saving={saving}
          onClose={() => { setShowAdd(false); setForm(emptyForm()) }}
          onSave={() => void handleAdd()}
        />
      )}

      {editId != null && editProduct && (
        <ProductFormModal
          title={`Редактировать · ${editProduct.name}`}
          form={form}
          setForm={setForm}
          saving={saving}
          onClose={() => setEditId(null)}
          onSave={() => void handleEdit()}
        />
      )}
    </div>
  )
}
