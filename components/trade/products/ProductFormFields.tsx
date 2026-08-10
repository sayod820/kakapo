'use client'

import { useCallback, useState } from 'react'
import { categorySlug } from '@/lib/useCategories'
import { buildWeightMasterBarcode, findBarcodeOwner, nextFreeEan13 } from '@/lib/productBarcodes'
import { nextFreePlu, parseProductCodeNum } from '@/lib/productCodes'
import type { Category, Product } from '@/lib/types'
import type { ProductForm } from './productFormShared'
import type { SellType } from '@/lib/types'
import PhotoUploadField from '@/components/shared/PhotoUploadField'
import MobileBarcodeScanner from '@/components/shared/MobileBarcodeScanner'

export default function ProductFormFields({
  form,
  setForm,
  categories,
  productId,
  products = [],
}: {
  form: ProductForm
  setForm: (f: ProductForm) => void
  categories: Category[]
  productId?: number | null
  products?: Product[]
}) {
  const roots = categories.filter(c => c.parent_id == null)
  const children = (parentId: number) => categories.filter(c => Number(c.parent_id) === parentId)
  const isWeight = form.sellType === 'weight'
  const [newBarcode, setNewBarcode] = useState('')
  const [scanOpen, setScanOpen] = useState(false)
  const [scanHint, setScanHint] = useState('')

  function tryAddBarcode(code: string): boolean {
    const trimmed = code.trim()
    if (!trimmed) return false
    if (form.barcodes.includes(trimmed)) {
      setScanHint(`Уже есть: ${trimmed}`)
      return false
    }
    const owner = findBarcodeOwner(products, trimmed, productId ?? null)
    if (owner) {
      setScanHint(`Занят: «${owner.name}» · ${owner.barcode}`)
      return false
    }
    setForm({ ...form, barcodes: [...form.barcodes, trimmed] })
    setNewBarcode('')
    setScanHint(`Добавлен штрихкод ${trimmed}`)
    return true
  }

  function addBarcode() {
    tryAddBarcode(newBarcode)
    if (!newBarcode.trim()) setNewBarcode('')
  }

  const onBarcodeScanned = useCallback((code: string) => {
    setScanOpen(false)
    tryAddBarcode(code)
  }, [form, setForm, products, productId])

  function generateBarcode() {
    let code: string | null = null
    if (isWeight) {
      const plu = parseProductCodeNum(form.plu)
      if (plu == null || plu <= 0) {
        setScanHint('Сначала укажите PLU для весового штрихкода')
        return
      }
      code = buildWeightMasterBarcode(plu)
      if (!code) {
        setScanHint('Не удалось собрать весовой штрихкод')
        return
      }
    } else {
      const prefer = parseProductCodeNum(form.art)
      const draftAsProducts: Partial<Product>[] = [
        ...products,
        { id: -1, barcodes: form.barcodes },
      ]
      code = nextFreeEan13(draftAsProducts, prefer, productId ?? null)
    }
    if (!code) return
    tryAddBarcode(code)
  }

  function removeBarcode(code: string) {
    setForm({ ...form, barcodes: form.barcodes.filter(b => b !== code) })
  }

  function setSellType(sellType: SellType) {
    if (sellType === 'weight') {
      const free = nextFreePlu(products, productId ?? null)
      setForm({
        ...form,
        sellType,
        unitGrams: '1000',
        weightStep: '1',
        unit: !form.unit || form.unit === 'шт' ? 'кг' : form.unit,
        // Всегда новый минимальный свободный PLU (старый сбрасываем)
        plu: free <= 9999 ? String(free) : '',
      })
      return
    }
    // Штучный — PLU не нужен
    setForm({ ...form, sellType, plu: '' })
  }

  return (
    <div className="k-product-edit">
      <div className="k-product-edit-hero">
        <PhotoUploadField
          value={form.photo}
          productId={productId}
          onChange={photo => setForm({ ...form, photo })}
          onUploaded={(photo, photoThumb) => setForm({ ...form, photo, photoThumb })}
          height={112}
          compact
          label="Фото"
        />
        <div className="k-product-edit-hero-fields">
          <div className="k-field">
            <label>Название *</label>
            <input className="k-inp" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="k-grid2 k-grid2-tight">
            <div className="k-field">
              <label>Артикул</label>
              <input
                className="k-inp"
                value={form.art}
                onChange={e => setForm({ ...form, art: e.target.value.replace(/\D/g, '') })}
                placeholder="Авто"
                inputMode="numeric"
              />
            </div>
            <div className="k-field">
              <label>Эмодзи</label>
              <input className="k-inp" value={form.e} onChange={e => setForm({ ...form, e: e.target.value })} />
            </div>
          </div>
          <div className="k-hint">Артикул ставится сам · после удаления номер снова свободен</div>
        </div>
      </div>

      <div className="k-grid2 k-grid2-tight">
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
          <label>Единица</label>
          <input className="k-inp" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder={isWeight ? 'кг' : 'шт'} />
        </div>
        <div className="k-field">
          <label>Бренд</label>
          <input className="k-inp" value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} />
        </div>
        {isWeight && (
          <div className="k-field">
            <label>PLU (весы)</label>
            <input
              className="k-inp"
              value={form.plu}
              onChange={e => setForm({ ...form, plu: e.target.value.replace(/\D/g, '').slice(0, 4) })}
              placeholder="1–9999"
              inputMode="numeric"
            />
            <div className="k-hint">Минимальный свободный 1–9999</div>
          </div>
        )}
      </div>

      <div className="k-hint" style={{ marginBottom: 8 }}>Цена, остаток, себестоимость и опт — в «📦 Партии»</div>

      {isWeight && (
        <div className="k-product-edit-note">
          <b>Расчёт по граммам</b>
          <span>В кассе и на весах — по граммам. Цена за 1 кг в партии прихода.</span>
        </div>
      )}

      <div className="k-field">
        <label>Штрихкоды</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <input
            className="k-inp"
            style={{ flex: 1, minWidth: 140 }}
            value={newBarcode}
            onChange={e => setNewBarcode(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addBarcode() } }}
            placeholder="Скан или ввод"
          />
          <button
            type="button"
            className="k-btn k-btn-s k-cam-scan-btn"
            title="Сканер камеры"
            aria-label="Сканер камеры"
            onClick={() => { setScanHint(''); setScanOpen(true) }}
            style={{ flexShrink: 0, minWidth: 40, minHeight: 36, padding: '0 10px', fontSize: 16, lineHeight: 1 }}
          >
            📷
          </button>
          <button type="button" className="k-btn k-btn-s" onClick={addBarcode} style={{ whiteSpace: 'nowrap' }}>
            +
          </button>
          <button
            type="button"
            className="k-btn k-btn-s"
            onClick={generateBarcode}
            style={{ whiteSpace: 'nowrap' }}
            title={isWeight ? 'Сгенерировать весовой EAN-13 (21…) и добавить' : 'Сгенерировать EAN-13 и добавить'}
          >
            Авто
          </button>
        </div>
        {scanHint && (
          <div style={{
            fontSize: 11,
            color: scanHint.startsWith('Занят') || scanHint.startsWith('Уже есть') || scanHint.startsWith('Сначала') || scanHint.startsWith('Не удалось')
              ? 'var(--red)'
              : 'var(--green)',
            marginTop: 4,
            fontWeight: 700,
          }}>
            {scanHint}
          </div>
        )}
        {form.barcodes.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
            {form.barcodes.map(code => (
              <span
                key={code}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '3px 8px', borderRadius: 7,
                  background: 'var(--green-d)', border: '1px solid rgba(31,215,96,.25)',
                  fontSize: 11, fontFamily: 'monospace',
                }}
              >
                {code}
                <button
                  type="button"
                  onClick={() => removeBarcode(code)}
                  style={{
                    border: 'none', background: 'transparent', color: 'var(--muted)',
                    cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: 13,
                  }}
                  title="Удалить"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="k-field">
        <label>Описание</label>
        <textarea
          className="k-ta"
          value={form.desc}
          onChange={e => setForm({ ...form, desc: e.target.value })}
          rows={2}
          style={{ minHeight: 56 }}
        />
      </div>

      <div className="k-product-edit-flags">
        <label>
          <input type="checkbox" checked={form.hot} onChange={e => setForm({ ...form, hot: e.target.checked })} />
          <span>Хит</span>
        </label>
        <label>
          <input type="checkbox" checked={form.organic} onChange={e => setForm({ ...form, organic: e.target.checked })} />
          <span>Органик</span>
        </label>
      </div>

      <MobileBarcodeScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onDetect={onBarcodeScanned}
        title="Сканер · штрихкод товара"
        hint="Наведите на штрихкод — он добавится в карточку"
      />
    </div>
  )
}
