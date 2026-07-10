'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useProducts } from '@/lib/store'
import { useProductPhotos } from '@/lib/productPhotos'
import { useCategories } from '@/lib/useCategories'
import ProductTab from '@/components/trade/products/ProductTab'
import CategoryTab from '@/components/trade/products/CategoryTab'
import LabelsTab from '@/components/trade/products/LabelsTab'
import {
  buildProductPayload,
  emptyForm,
  formFromProduct,
  type ProductForm,
} from '@/components/trade/products/productFormShared'

export type ProductsSubPage = 'product' | 'category' | 'labels'

const SUB_PAGES: { id: ProductsSubPage; label: string }[] = [
  { id: 'product', label: 'Товар' },
  { id: 'category', label: 'Категория' },
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
  const fetchProducts = useProducts(s => s.fetchProducts)
  const { getPhoto, setPhoto, hydrate } = useProductPhotos()
  const {
    categories,
    loaded: catsLoaded,
    roots,
    childrenOf,
    createCategory,
    updateCategory,
    deleteCategory,
  } = useCategories()

  const [internalSub, setInternalSub] = useState<ProductsSubPage>('product')
  const sub = controlledSub ?? internalSub
  const setSub = onSubPageChange ?? setInternalSub

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState<ProductForm>(emptyForm())
  const [formDirty, setFormDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const formLoadedForId = useRef<number | 'new' | null>(null)

  const setFormFromUser = useCallback((f: ProductForm) => {
    setFormDirty(true)
    setForm(f)
  }, [])

  useEffect(() => { void hydrate() }, [hydrate])

  const selectedProduct = useMemo(
    () => products.find(p => p.id === selectedId) || null,
    [products, selectedId],
  )

  useEffect(() => {
    if (isNew) {
      formLoadedForId.current = 'new'
      return
    }
    if (!selectedId) {
      formLoadedForId.current = null
      return
    }
    if (formLoadedForId.current === selectedId) return
    const p = products.find(x => x.id === selectedId)
    if (!p) return
    setForm(formFromProduct(p, getPhoto(p.id)))
    setFormDirty(false)
    formLoadedForId.current = selectedId
  }, [selectedId, isNew, products, getPhoto])

  async function refreshAfterArrivals() {
    await fetchProducts()
    if (!selectedId || isNew) return
    formLoadedForId.current = null
    const p = useProducts.getState().products.find(x => x.id === selectedId)
    if (p) {
      setForm(formFromProduct(p, getPhoto(p.id)))
      formLoadedForId.current = selectedId
    }
  }

  function confirmDiscardChanges() {
    if (!formDirty) return true
    return confirm('Есть несохранённые изменения. Продолжить без сохранения?')
  }

  function openProduct(id: number) {
    if (!confirmDiscardChanges()) return
    formLoadedForId.current = null
    setSelectedId(id)
    setIsNew(false)
    setFormDirty(false)
    setSub('product')
  }

  function startNewProduct(catId?: string) {
    if (!confirmDiscardChanges()) return
    formLoadedForId.current = null
    setSelectedId(null)
    setIsNew(true)
    setForm(catId ? { ...emptyForm(), catId } : emptyForm())
    setFormDirty(false)
    setSub('product')
  }

  function selectProduct(id: number) {
    if (id === selectedId && !isNew) return
    if (!confirmDiscardChanges()) return
    formLoadedForId.current = null
    setSelectedId(id)
    setIsNew(false)
    setFormDirty(false)
  }

  async function handleSave() {
    setSaving(true)
    setMsg('')
    try {
      const payload = buildProductPayload(form, products, isNew ? null : selectedProduct, categories)
      const saved = await saveProduct(payload)
      if (saved && form.photo) setPhoto(saved.id, form.photo)
      if (isNew && saved) {
        setSelectedId(saved.id)
        setIsNew(false)
        formLoadedForId.current = saved.id
      }
      setFormDirty(false)
      setMsg(isNew ? 'Товар добавлен' : 'Товар обновлён')
      setSub('product')
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
      setFormDirty(false)
      formLoadedForId.current = null
    }
    setMsg('Товар удалён')
  }

  async function handleDeleteSelected() {
    if (!selectedProduct) return
    await handleDelete(selectedProduct.id, selectedProduct.name)
  }

  return (
    <div>
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

      {sub === 'product' && (
        <ProductTab
          products={products}
          loaded={loaded}
          search={search}
          categories={categories}
          getPhoto={getPhoto}
          form={form}
          setForm={setFormFromUser}
          formDirty={formDirty}
          selectedId={selectedId}
          isNew={isNew}
          saving={saving}
          onSelect={selectProduct}
          onNew={startNewProduct}
          onSave={() => void handleSave()}
          onDelete={() => void handleDeleteSelected()}
          onDeleteProduct={(id, name) => void handleDelete(id, name)}
          onOpenEdit={openProduct}
          onRefreshProducts={() => void refreshAfterArrivals()}
        />
      )}

      {sub === 'category' && (
        <CategoryTab
          categories={categories}
          loaded={catsLoaded}
          products={products}
          roots={roots}
          childrenOf={childrenOf}
          onCreate={async data => { await createCategory(data) }}
          onUpdate={updateCategory}
          onDelete={deleteCategory}
        />
      )}

      {sub === 'labels' && (
        <LabelsTab products={products} search={search} />
      )}
    </div>
  )
}
