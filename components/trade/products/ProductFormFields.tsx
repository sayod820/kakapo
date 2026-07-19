'use client'

import { useState } from 'react'
import { categorySlug } from '@/lib/useCategories'
import type { Category } from '@/lib/types'
import type { ProductForm } from './productFormShared'
import type { SellType } from '@/lib/types'
import PhotoUploadField from '@/components/shared/PhotoUploadField'

export default function ProductFormFields({
  form,
  setForm,
  categories,
  productId,
}: {
  form: ProductForm
  setForm: (f: ProductForm) => void
  categories: Category[]
  productId?: number | null
}) {
  const roots = categories.filter(c => c.parent_id == null)
  const children = (parentId: number) => categories.filter(c => Number(c.parent_id) === parentId)
  const isWeight = form.sellType === 'weight'
  const [newBarcode, setNewBarcode] = useState('')

  function addBarcode() {
    const code = newBarcode.trim()
    if (!code || form.barcodes.includes(code)) {
      setNewBarcode('')
      return
    }
    setForm({ ...form, barcodes: [...form.barcodes, code] })
    setNewBarcode('')
  }

  function removeBarcode(code: string) {
    setForm({ ...form, barcodes: form.barcodes.filter(b => b !== code) })
  }

  function setSellType(sellType: SellType) {
    if (sellType === 'weight') {
      setForm({
        ...form,
        sellType,
        unitGrams: '1000',
        weightStep: '1',
        unit: !form.unit || form.unit === 'шт' ? 'кг' : form.unit,
      })
      return
    }
    setForm({ ...form, sellType })
  }

  return (
    <div className="k-grid2">
      <div className="k-field" style={{ gridColumn: '1 / -1' }}>
        <PhotoUploadField
          value={form.photo}
          productId={productId}
          onChange={photo => setForm({ ...form, photo })}
          onUploaded={(photo, photoThumb) => setForm({ ...form, photo, photoThumb })}
          height={220}
        />
      </div>
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
        <label>Единица (отображение)</label>
        <input className="k-inp" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder={isWeight ? 'кг' : 'шт'} />
      </div>
      <div className="k-field" style={{ gridColumn: '1 / -1' }}>
        <div style={{ fontSize: 10, color: 'var(--muted)' }}>
          Цена, остаток, себестоимость и опт — в «📦 Партии»
        </div>
      </div>
      <div className="k-field" style={{ gridColumn: '1 / -1' }}>
        <label>Штрихкоды</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="k-inp"
            value={newBarcode}
            onChange={e => setNewBarcode(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addBarcode() } }}
            placeholder="Сканируйте или введите штрихкод"
          />
          <button type="button" className="k-btn" onClick={addBarcode} style={{ whiteSpace: 'nowrap' }}>
            Добавить
          </button>
        </div>
        {form.barcodes.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {form.barcodes.map(code => (
              <span
                key={code}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '4px 10px', borderRadius: 8,
                  background: 'var(--green-d)', border: '1px solid rgba(31,215,96,.25)',
                  fontSize: 12, fontFamily: 'monospace',
                }}
              >
                {code}
                <button
                  type="button"
                  onClick={() => removeBarcode(code)}
                  style={{
                    border: 'none', background: 'transparent', color: 'var(--muted)',
                    cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: 14,
                  }}
                  title="Удалить"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
          Один товар может иметь несколько штрихкодов (разные упаковки, поставщики)
        </div>
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
        <div className="k-field" style={{ gridColumn: '1 / -1' }}>
          <div style={{
            padding: '10px 12px', borderRadius: 10, background: 'var(--green-d)',
            border: '1px solid rgba(31,215,96,.25)', fontSize: 12,
          }}>
            <b style={{ color: 'var(--green)' }}>Расчёт по граммам</b>
            <div style={{ marginTop: 6, color: 'var(--muted)', fontSize: 11 }}>
              В кассе и на весах считается по граммам. Цена за 1 кг — в партии прихода.
            </div>
          </div>
        </div>
      )}
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
