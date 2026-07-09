'use client'

import { categorySlug } from '@/lib/useCategories'
import type { Category } from '@/lib/types'
import type { ProductForm } from './productFormShared'
import type { SellType } from '@/lib/types'

export default function ProductFormFields({
  form,
  setForm,
  categories,
}: {
  form: ProductForm
  setForm: (f: ProductForm) => void
  categories: Category[]
}) {
  const roots = categories.filter(c => c.parent_id == null)
  const children = (parentId: number) => categories.filter(c => Number(c.parent_id) === parentId)

  return (
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
          {roots.map(c => (
            <optgroup key={c.id} label={`${c.emoji || '📦'} ${c.name}`}>
              <option value={categorySlug(c)}>{c.name}</option>
              {children(c.id).map(sub => (
                <option key={sub.id} value={categorySlug(sub)}>↳ {sub.name}</option>
              ))}
            </optgroup>
          ))}
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
  )
}
