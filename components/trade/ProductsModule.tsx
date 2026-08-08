'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useProducts } from '@/lib/store'
import { useProductPhotos } from '@/lib/productPhotos'
import { useCategories } from '@/lib/useCategories'
import { guardMutation } from '@/lib/offlineGuard'
import { isOfflineV2Full } from '@/lib/offlineV2'
import { deleteProductSafe, saveProductSafe } from '@/lib/offlineProductOps'
import OfflineNotice from '@/components/trade/OfflineNotice'
import ProductTab from '@/components/trade/products/ProductTab'
import CategoryTab from '@/components/trade/products/CategoryTab'
import LabelsTab from '@/components/trade/products/LabelsTab'
import {
  buildProductPayload,
  emptyForm,
  emptyFormWithNextCodes,
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
  onBackToCatalogChange,
  hideSubtabs = false,
}: {
  search: string
  subPage?: ProductsSubPage
  onSubPageChange?: (p: ProductsSubPage) => void
  onBackToCatalogChange?: (handler: (() => void) | null) => void
  hideSubtabs?: boolean
}) {
  const products = useProducts(s => s.products)
  const loaded = useProducts(s => s.loaded)
  const removeProducts = useProducts(s => s.removeProducts)
  const fetchProducts = useProducts(s => s.fetchProducts)
  const { getPhoto, setPhoto, hydrate } = useProductPhotos()
  const {
    categories,
    loaded: catsLoaded,
    roots,
    childrenOf,
    createCategory,
    updateCategory,
    reorderCategories,
    deleteCategory,
    deleteCategories,
  } = useCategories()

  const [internalSub, setInternalSub] = useState<ProductsSubPage>('product')
  const sub = controlledSub ?? internalSub
  const setSub = onSubPageChange ?? setInternalSub

  useEffect(() => {
    if (sub !== 'product') onBackToCatalogChange?.(null)
  }, [sub, onBackToCatalogChange])

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
    const base = emptyFormWithNextCodes(products)
    setForm(catId ? { ...base, catId } : base)
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
    if (!isOfflineV2Full() && !guardMutation(setMsg)) return
    setSaving(true)
    setMsg('')
    try {
      const payload = buildProductPayload(form, products, isNew ? null : selectedProduct, categories)
      const res = await saveProductSafe(payload)
      const saved = res.data
      if (saved && form.photo) setPhoto(saved.id, form.photo)
      if (isNew && saved) {
        setSelectedId(saved.id)
        setIsNew(false)
        formLoadedForId.current = saved.id
      }
      setFormDirty(false)
      setMsg(
        res.offline
          ? (isNew ? 'Товар добавлен · отправится при связи' : 'Сохранено · отправится при связи')
          : (isNew ? 'Товар добавлен' : 'Товар обновлён'),
      )
      setSub('product')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number, name: string) {
    if (!isOfflineV2Full() && !guardMutation(setMsg)) return
    if (!confirm(`Удалить товар «${name}»?`)) return
    try {
      const res = await deleteProductSafe(id)
      if (selectedId === id) {
        setSelectedId(null)
        setIsNew(false)
        setForm(emptyForm())
        setFormDirty(false)
        formLoadedForId.current = null
      }
      setMsg(res.offline ? 'Товар удалён · отправится при связи' : 'Товар удалён')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось удалить')
    }
  }

  async function handleDeleteSelected() {
    if (!selectedProduct) return
    await handleDelete(selectedProduct.id, selectedProduct.name)
  }

  async function handleDeleteProducts(ids: number[]) {
    if (!ids.length) return
    if (!isOfflineV2Full() && !guardMutation(setMsg)) return
    try {
      let removed = 0
      let anyOffline = false
      if (isOfflineV2Full()) {
        for (const id of ids) {
          const res = await deleteProductSafe(id)
          removed += 1
          if (res.offline) anyOffline = true
        }
      } else {
        ;({ removed } = await removeProducts(ids))
      }
      if (selectedId != null && ids.includes(selectedId)) {
        setSelectedId(null)
        setIsNew(false)
        setForm(emptyForm())
        setFormDirty(false)
        formLoadedForId.current = null
      }
      setMsg(
        anyOffline
          ? `Удалено товаров: ${removed} · отправится при связи`
          : `Удалено товаров: ${removed}`,
      )
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Не удалось удалить товары')
    }
  }

  return (
    <div className="k-products-mod">
      {!hideSubtabs && (
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
      )}

      <OfflineNotice section="товары" />

      {msg && <div className="k-alert" style={{ marginBottom: 12 }}>{msg}</div>}

      <div className="k-products-mod-body">
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
          onDeleteProducts={ids => handleDeleteProducts(ids)}
          onOpenEdit={openProduct}
          onRefreshProducts={() => void refreshAfterArrivals()}
          onBackToCatalogChange={onBackToCatalogChange}
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
          onReorder={reorderCategories}
          onDelete={deleteCategory}
          onDeleteMany={ids => deleteCategories(ids)}
        />
      )}

      {sub === 'labels' && (
        <LabelsTab products={products} search={search} />
      )}
      </div>
    </div>
  )
}
