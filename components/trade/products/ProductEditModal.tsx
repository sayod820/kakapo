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
  formFromProduct,
  type ProductForm,
} from '@/components/trade/products/productFormShared'

export default function ProductEditModal({
  open,
  product,
  onClose,
  onSaved,
}: {
  open: boolean
  product: Product
  onClose: () => void
  onSaved?: (product: Product) => void
}) {
  const products = useProducts(s => s.products)
  const fetchProducts = useProducts(s => s.fetchProducts)
  const { getPhoto, setPhoto } = useProductPhotos()
  const { categories } = useCategories()
  const [form, setForm] = useState<ProductForm>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!open) return
    setForm(formFromProduct(product, getPhoto(product.id)))
    setMsg('')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при открытии / смене товара
  }, [open, product.id])

  if (!open) return null

  async function handleSave() {
    if (!form.name.trim()) {
      setMsg('Укажите название товара')
      return
    }
    setSaving(true)
    setMsg('')
    try {
      const payload = buildProductPayload(form, products, product, categories)
      const res = await saveProductSafe(payload)
      const saved = res.data || product
      if (saved && form.photo) setPhoto(saved.id, form.photo)
      if (!res.offline) await fetchProducts()
      onSaved?.(saved)
      onClose()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось сохранить товар')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="k-modal-bg" style={{ zIndex: 2000 }} onClick={() => !saving && onClose()}>
      <div className="k-modal k-modal-wide" onClick={e => e.stopPropagation()} style={{ maxWidth: 720, maxHeight: '92vh' }}>
        <div className="k-modal-h">
          <div>
            <b>✎ Редактировать товар</b>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginTop: 2 }}>
              {product.name}
            </div>
          </div>
          <button type="button" onClick={() => !saving && onClose()}>✕</button>
        </div>
        <div className="k-modal-b" style={{ padding: 16, overflow: 'auto' }}>
          <ProductFormFields
            form={form}
            setForm={setForm}
            categories={categories}
            productId={product.id}
            products={products}
          />
          {msg && (
            <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>
              {msg}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button type="button" className="k-btn k-btn-g" style={{ flex: 1 }} disabled={saving} onClick={() => void handleSave()}>
              {saving ? 'Сохранение…' : 'Сохранить товар'}
            </button>
            <button type="button" className="k-btn k-btn-s" disabled={saving} onClick={onClose}>Отмена</button>
          </div>
        </div>
      </div>
    </div>
  )
}
