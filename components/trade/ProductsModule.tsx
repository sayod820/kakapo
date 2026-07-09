'use client'

import { useEffect, useMemo, useState } from 'react'
import { useProducts } from '@/lib/store'
import { useProductPhotos } from '@/lib/productPhotos'
import CatalogTab from '@/components/trade/products/CatalogTab'
import ProductTab from '@/components/trade/products/ProductTab'
import LabelsTab from '@/components/trade/products/LabelsTab'
import {
  buildProductPayload,
  emptyForm,
  formFromProduct,
  type ProductForm,
} from '@/components/trade/products/productFormShared'

export type ProductsSubPage = 'catalog' | 'product' | 'labels'

const SUB_PAGES: { id: ProductsSubPage; label: string }[] = [
  { id: 'catalog', label: 'Каталог' },
  { id: 'product', label: 'Товар' },
  { id: 'labels', label: 'Этикетки' },
]

export default function ProductsModule({
  search,
  subPage: controlledSub,
  onSubPageChange,
}: {
  search: string
  subPage?: ProductsSubPage
  onSubPageChange?: (p: ProductsSubPage) => void
}) {
  const products = useProducts(s => s.products)
  const loaded = useProducts(s => s.loaded)
  const saveProduct = useProducts(s => s.saveProduct)
  const removeProduct = useProducts(s => s.removeProduct)
  const { getPhoto, setPhoto, hydrate } = useProductPhotos()

  const [internalSub, setInternalSub] = useState<ProductsSubPage>('catalog')
  const sub = controlledSub ?? internalSub
  const setSub = onSubPageChange ?? setInternalSub

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState<ProductForm>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { void hydrate() }, [hydrate])

  const selectedProduct = useMemo(
    () => products.find(p => p.id === selectedId) || null,
    [products, selectedId],
  )

  useEffect(() => {
    if (!selectedProduct || isNew) return
    setForm(formFromProduct(selectedProduct, getPhoto(selectedProduct.id)))
  }, [selectedProduct, isNew, getPhoto])

  function openProduct(id: number) {
    setSelectedId(id)
    setIsNew(false)
    setSub('product')
  }

  function startNewProduct() {
    setSelectedId(null)
    setIsNew(true)
    setForm(emptyForm())
    setSub('product')
  }

  function selectProduct(id: number) {
    setSelectedId(id)
    setIsNew(false)
  }

  async function handleSave() {
    setSaving(true)
    setMsg('')
    try {
      const payload = buildProductPayload(form, products, isNew ? null : selectedProduct)
      const saved = await saveProduct(payload)
      if (saved && form.photo) setPhoto(saved.id, form.photo)
      if (isNew && saved) {
        setSelectedId(saved.id)
        setIsNew(false)
      }
      setMsg(isNew ? 'Товар добавлен' : 'Товар обновлён')
      setSub('catalog')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Удалить товар «${name}»?`)) return
    await removeProduct(id)
    if (selectedId === id) {
      setSelectedId(null)
      setIsNew(false)
      setForm(emptyForm())
    }
    setMsg('Товар удалён')
  }

  async function handleDeleteSelected() {
    if (!selectedProduct) return
    await handleDelete(selectedProduct.id, selectedProduct.name)
  }

  return (
    <div>
      <div className="k-page-h" style={{ marginBottom: 12 }}>
        <div>
          <h1>📦 Товары</h1>
          <div className="sub">Каталог товаров — основа для кассы и склада. Общие данные со всеми приложениями KAKAPO.</div>
        </div>
      </div>

      <div className="k-subtabs">
        {SUB_PAGES.map(item => (
          <button
            key={item.id}
            type="button"
            className={`k-subtab ${sub === item.id ? 'active' : ''}`}
            onClick={() => setSub(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {msg && <div className="k-alert" style={{ marginBottom: 12 }}>{msg}</div>}

      {sub === 'catalog' && (
        <CatalogTab
          products={products}
          loaded={loaded}
          search={search}
          getPhoto={getPhoto}
          onOpenProduct={openProduct}
          onAddProduct={startNewProduct}
          onDelete={(id, name) => void handleDelete(id, name)}
        />
      )}

      {sub === 'product' && (
        <ProductTab
          products={products}
          search={search}
          form={form}
          setForm={setForm}
          selectedId={selectedId}
          onSelect={selectProduct}
          onNew={startNewProduct}
          onSave={() => void handleSave()}
          onDelete={() => void handleDeleteSelected()}
          saving={saving}
          isNew={isNew}
        />
      )}

      {sub === 'labels' && (
        <LabelsTab products={products} search={search} />
      )}
    </div>
  )
}
