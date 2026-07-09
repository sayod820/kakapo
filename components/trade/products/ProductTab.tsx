'use client'

import ProductFormFields from './ProductFormFields'
import { money } from './productFormShared'
import type { ProductForm } from './productFormShared'
import type { Product } from '@/lib/types'

export default function ProductTab({
  products,
  search,
  form,
  setForm,
  selectedId,
  onSelect,
  onNew,
  onSave,
  onDelete,
  saving,
  isNew,
}: {
  products: Product[]
  search: string
  form: ProductForm
  setForm: (f: ProductForm) => void
  selectedId: number | null
  onSelect: (id: number) => void
  onNew: () => void
  onSave: () => void
  onDelete: () => void
  saving: boolean
  isNew: boolean
}) {
  const q = search.trim().toLowerCase()
  const list = products.filter(p =>
    !q || `${p.name} ${p.art} ${p.barcode || ''}`.toLowerCase().includes(q),
  )

  return (
    <div className="k-product-layout">
      <aside className="k-product-list">
        <div className="k-product-list-head">
          <b>Товары</b>
          <button type="button" className="k-btn k-btn-g" style={{ padding: '6px 10px', fontSize: 12 }} onClick={onNew}>+ Новый</button>
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
          <b>{isNew ? 'Новый товар' : selectedId ? `Товар · ${form.name || '…'}` : 'Выберите товар'}</b>
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
            <ProductFormFields form={form} setForm={setForm} />
          ) : (
            <div className="k-empty">Выберите товар слева или нажмите «+ Новый»</div>
          )}
        </div>
      </section>
    </div>
  )
}
