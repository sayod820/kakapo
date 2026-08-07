// ════════════════════════════════════════════════
// KAKAPO — товары офлайн (Offline V2)
// Режим on: локально сразу + очередь.
// Режим shadow/off: обычный онлайн-путь (shadow только зеркало).
// ════════════════════════════════════════════════
import { api } from './api'
import { cacheProducts, newClientRef } from './offline'
import { localFirstOp, type OfflineResult } from './localFirst'
import { isOfflineV2Full, shadowMirrorPut } from './offlineV2'
import { useOfflineSync } from './offlineSync'
import { useProducts } from './store'
import type { Product } from './types'

export type { OfflineResult }

function newLocalProductId(products: Product[]): number {
  let id = -Math.abs(Date.now() % 1_000_000_000_000)
  const used = new Set(products.map(p => Number(p.id)))
  while (used.has(id)) id -= 1
  return id
}

function isLocalProductId(id: number | undefined | null): boolean {
  const n = Number(id)
  return Number.isFinite(n) && n <= 0
}

/** Local-first: сразу локально, сервер в фоне. apiCall игнорируется. */
async function raceProductOp<T>(
  _apiCall: () => Promise<T>,
  localApply: () => Promise<T> | T,
): Promise<OfflineResult<T>> {
  return localFirstOp(localApply)
}

function persistLocalCatalog(next: Product[]) {
  useProducts.setState({ products: next })
  void cacheProducts(next)
}

/** Сохранить товар. При Offline V2 = on работает без сети. */
export async function saveProductSafe(
  data: Partial<Product> & { art?: string; id?: number },
): Promise<OfflineResult<Product>> {
  const clientRef = newClientRef()
  const cleaned = { ...data, old: null as null, discount: 0 }

  // Полный офлайн не включён — обычный онлайн API (как раньше)
  if (!isOfflineV2Full()) {
    const saved = await useProducts.getState().saveProduct(cleaned)
    if (!saved) throw new Error('Не удалось сохранить товар')
    shadowMirrorPut('product', String(saved.id), saved)
    return { offline: false, data: saved }
  }

  const products = useProducts.getState().products
  const existingId = Number(cleaned.id)
  const editing = Number.isFinite(existingId) && existingId !== 0

  const applyLocal = async () => {
    const localId = editing && isLocalProductId(existingId)
      ? existingId
      : editing
        ? existingId
        : newLocalProductId(products)

    // Уже серверный id, но нет сети — правим локально и ставим upsert в очередь
    const product: Product = {
      ...(editing ? products.find(p => p.id === existingId) : null),
      ...cleaned,
      id: localId,
      art: String(cleaned.art || (editing ? products.find(p => p.id === existingId)?.art : '') || localId),
      e: cleaned.e || '📦',
      name: String(cleaned.name || '').trim() || 'Товар',
      price: Number(cleaned.price) || 0,
      cat: String(cleaned.cat || cleaned.catId || 'veg'),
      catId: String(cleaned.catId || 'veg'),
      unit: String(cleaned.unit || 'шт'),
      stock: Number(cleaned.stock) || 0,
      hot: !!cleaned.hot,
      old: null,
      discount: 0,
    } as Product

    const payload = {
      clientRef,
      localId: String(localId),
      product: { ...product },
    }
    await useOfflineSync.getState().queueOp('product_upsert', payload, {
      localId: String(localId),
      clientRef,
    })

    const next = editing
      ? products.map(p => (p.id === existingId ? product : p))
      : [...products, product]
    persistLocalCatalog(next)
    shadowMirrorPut('product', String(product.id), product)
    return product
  }

  return raceProductOp(async () => {
    if (editing && !isLocalProductId(existingId)) {
      const p = await api.updateProduct(existingId, { ...cleaned, clientRef })
      const fixed = { ...p, old: null, discount: 0 }
      persistLocalCatalog(
        useProducts.getState().products.map(x => (x.id === fixed.id ? fixed : x)),
      )
      shadowMirrorPut('product', String(fixed.id), fixed)
      return fixed
    }
    const { id: _id, ...createBody } = cleaned
    const p = await api.createProduct({ ...createBody, clientRef })
    const fixed = { ...p, old: null, discount: 0 }
    persistLocalCatalog([...useProducts.getState().products.filter(x => x.id !== fixed.id), fixed])
    shadowMirrorPut('product', String(fixed.id), fixed)
    return fixed
  }, applyLocal)
}

export async function deleteProductSafe(id: number): Promise<OfflineResult<{ id: number }>> {
  const clientRef = newClientRef()

  if (!isOfflineV2Full()) {
    await useProducts.getState().removeProduct(id)
    return { offline: false, data: { id } }
  }

  const applyLocal = async () => {
    await useOfflineSync.getState().queueOp('product_delete', { clientRef, id }, { clientRef })
    const next = useProducts.getState().products.filter(p => p.id !== id)
    persistLocalCatalog(next)
    return { id }
  }

  if (isLocalProductId(id)) {
    const data = await applyLocal()
    void useOfflineSync.getState().syncNow()
    return { offline: true, data }
  }

  return raceProductOp(async () => {
    await api.deleteProduct(id)
    persistLocalCatalog(useProducts.getState().products.filter(p => p.id !== id))
    return { id }
  }, applyLocal)
}
