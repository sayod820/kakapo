'use client'

import { categorySlug } from '@/lib/useCategories'
import { formatPriceLabel } from '@/lib/productWeight'
import type { Category } from '@/lib/types'
import type { ProductForm } from './productFormShared'
import type { SellType } from '@/lib/types'

function weightPriceHints(price: string, unitGrams: string) {
  const p = Number(price) || 0
  const ug = Number(unitGrams) || 1000
  if (!p || !ug) return null
  const perGram = p / ug
  return {
    per100g: (perGram * 100).toFixed(2),
    perKg: (perGram * 1000).toFixed(2),
    perGram: perGram.toFixed(4),
  }
}

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
  const isWeight = form.sellType === 'weight'
  const hints = isWeight ? weightPriceHints(form.price, form.unitGrams) : null

  function setSellType(sellType: SellType) {
    if (sellType === 'weight') {
      setForm({
        ...form,
        sellType,
        unitGrams: form.unitGrams || '1000',
        weightStep: form.weightStep || '100',
        unit: !form.unit || form.unit === 'шт' ? 'кг' : form.unit,
      })
      return
    }
    setForm({ ...form, sellType })
  }

  const previewLabel = isWeight
    ? formatPriceLabel({
        sellType: 'weight',
        price: Number(form.price) || 0,
        unitGrams: Number(form.unitGrams) || 1000,
        unit: form.unit,
      })
    : null

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
        <label>Тип продажи</label>
        <select className="k-sel" value={form.sellType} onChange={e => setSellType(e.target.value as SellType)}>
          <option value="piece">Поштучно</option>
          <option value="weight">На развес (граммы)</option>
        </select>
      </div>
      <div className="k-field">
        <label>{isWeight ? 'Цена продажи * (за указанный вес)' : 'Цена продажи *'}</label>
        <input className="k-inp" type="number" step="0.01" min="0" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} />
        {previewLabel && (
          <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 6, fontWeight: 700 }}>{previewLabel}</div>
        )}
      </div>
      <div className="k-field">
        <label>Себестоимость</label>
        <input className="k-inp" type="number" step="0.01" value={form.costPrice} onChange={e => setForm({ ...form, costPrice: e.target.value })} />
      </div>
      <div className="k-field">
        <label>{isWeight ? 'Остаток, г' : 'Остаток'}</label>
        <input className="k-inp" type="number" step={isWeight ? '1' : '0.01'} min="0" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} />
      </div>
      <div className="k-field">
        <label>Единица (отображение)</label>
        <input className="k-inp" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder={isWeight ? 'кг' : 'шт'} />
      </div>
      <div className="k-field">
        <label>Штрихкод</label>
        <input className="k-inp" value={form.barcode} onChange={e => setForm({ ...form, barcode: e.target.value })} />
      </div>
      <div className="k-field">
        <label>PLU-код (весы)</label>
        <input
          className="k-inp"
          value={form.plu}
          onChange={e => setForm({ ...form, plu: e.target.value.replace(/\D/g, '').slice(0, 4) })}
          placeholder="1–9999"
          inputMode="numeric"
        />
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
          Код на весах для весового товара
        </div>
      </div>
      <div className="k-field">
        <label>Бренд</label>
        <input className="k-inp" value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} />
      </div>
      {isWeight && (
        <>
          <div className="k-field">
            <label>Цена указана за, г</label>
            <input
              className="k-inp"
              type="number"
              min="1"
              step="1"
              value={form.unitGrams}
              onChange={e => setForm({ ...form, unitGrams: e.target.value })}
            />
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>1000 = цена за 1 кг · 100 = за 100 г</div>
          </div>
          <div className="k-field">
            <label>Шаг на весах / в кассе, г</label>
            <input
              className="k-inp"
              type="number"
              min="1"
              step="1"
              value={form.weightStep}
              onChange={e => setForm({ ...form, weightStep: e.target.value })}
            />
          </div>
          {hints && (
            <div className="k-field" style={{ gridColumn: '1 / -1' }}>
              <div style={{
                padding: '10px 12px', borderRadius: 10, background: 'var(--green-d)',
                border: '1px solid rgba(31,215,96,.25)', fontSize: 12,
              }}>
                <b style={{ color: 'var(--green)' }}>Расчёт по граммам:</b>
                <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 8 }}>
                  <span>{hints.per100g} сом / 100 г</span>
                  <span>{hints.perKg} сом / кг</span>
                  <span>{hints.perGram} сом / 1 г</span>
                </div>
                <div style={{ marginTop: 6, color: 'var(--muted)', fontSize: 11 }}>
                  Пример: {form.weightStep || 100} г → {((Number(hints.perGram) || 0) * (Number(form.weightStep) || 100)).toFixed(2)} сом
                </div>
              </div>
            </div>
          )}
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
