'use client'

import { useEffect, useState } from 'react'
import { useProductPhotos } from '@/lib/productPhotos'
import { useProducts } from '@/lib/store'
import { useCategories } from '@/lib/useCategories'
import { saveProductSafe } from '@/lib/offlineProductOps'
import type { Product } from '@/lib/types'
import ProductFormFields from '@/components/trade/products/ProductFormFields'
import {
  buildProductPayload,
  emptyForm,
  emptyFormWithNextCodes,
  formFromDuplicate,
  type ProductForm,
} from '@/components/trade/products/productFormShared'

export default function WarehouseNewProductModal({
  open,
  initialName = '',
  initialBarcode = '',
  duplicateFrom = null,
  onClose,
  onCreated,
}: {
  open: boolean
  initialName?: string
  initialBarcode?: string
  duplicateFrom?: Product | null
  onClose: () => void
  onCreated: (product: Product) => void
}) {
  const products = useProducts(s => s.products)
  const fetchProducts = useProducts(s => s.fetchProducts)
  const { setPhoto } = useProductPhotos()
  const { categories } = useCategories()
  const [form, setForm] = useState<ProductForm>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!open) return
    if (duplicateFrom) {
      setForm(formFromDuplicate(duplicateFrom, products))
    } else {
      const base = emptyFormWithNextCodes(products)
      const code = initialBarcode.trim()
      setForm({
        ...base,
        name: initialName,
        barcodes: code ? [code] : base.barcodes,
      })
    }
    setMsg('')
    // products только при открытии — не сбрасывать форму при фоновом обновлении списка
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialName, initialBarcode, duplicateFrom])

  if (!open) return null

  async function handleSave() {
    if (!form.name.trim()) {
      setMsg('Укажите название товара')
      return
    }
    setSaving(true)
    setMsg('')
    try {
      const payload = buildProductPayload(form, products, null, categories)
      const res = await saveProductSafe(payload)
      const saved = res.data
      if (saved && form.photo) setPhoto(saved.id, form.photo)
      // В полном офлайне каталог уже обновлён локально — лишний fetch не нужен
      if (!res.offline) await fetchProducts()
      onCreated(saved)
      onClose()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось сохранить товар')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="k-modal-bg" style={{ zIndex: 1900 }} onClick={() => !saving && onClose()}>
      <div className="k-modal k-modal-wide" onClick={e => e.stopPropagation()} style={{ maxWidth: 720, maxHeight: '92vh' }}>
        <div className="k-modal-h">
          <b>{duplicateFrom ? '⧉ Дублировать товар' : '📦 Новый товар'}</b>
          <button type="button" onClick={() => !saving && onClose()}>✕</button>
        </div>
        <div className="k-modal-b" style={{ padding: 16, overflow: 'auto' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
            {duplicateFrom
              ? 'Скопированы название, штрихкод и единица (г/шт/л). Артикул и PLU уже новые — при необходимости измените остальное.'
              : 'Товар создаётся как в разделе «Товары». Цену продажи укажите в строке прихода.'}
          </div>
          <ProductFormFields form={form} setForm={setForm} categories={categories} productId={null} products={products} />
          {msg && (
            <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>
              {msg}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} disabled={saving} onClick={() => void handleSave()}>
              {saving ? 'Сохранение…' : 'Создать и добавить в приход'}
            </button>
            <button type="button" className="k-btn k-btn-s" disabled={saving} onClick={onClose}>Отмена</button>
          </div>
        </div>
      </div>
    </div>
  )
}
