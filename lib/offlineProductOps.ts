// ════════════════════════════════════════════════
// KAKAPO — товары офлайн (Offline V2)
// Режим on: локально сразу + очередь.
// Режим shadow/off: обычный онлайн-путь (shadow только зеркало).
// ════════════════════════════════════════════════
import { api } from './api'
import { cacheProducts, newClientRef } from './offline'
import { localFirstOp, type OfflineResult } from './localFirst'
import { isTradeLocalFirst, shadowMirrorPut } from './offlineV2'
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
  if (!isTradeLocalFirst()) {
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

    const prev = editing ? products.find(p => p.id === existingId) : undefined
    const expectedDocVersion = prev ? (Number(prev.docVersion) || 0) : undefined
    // Уже серверный id, но нет сети — правим локально и ставим upsert в очередь
    const product: Product = {
      ...(prev || null),
      ...cleaned,
      id: localId,
      art: String(cleaned.art || prev?.art || localId),
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
      docVersion: (expectedDocVersion != null ? expectedDocVersion : 0) + 1,
      updatedAtIso: new Date().toISOString(),
    } as Product

    const payload = {
      clientRef,
      localId: String(localId),
      expectedDocVersion,
      product: { ...product },
      _prev: prev ? { ...prev } : null,
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
    try {
      const { entityPut } = await import('./localEntities')
      await entityPut('product', String(product.id), product, { updatedAtIso: (product as any).updatedAtIso })
    } catch { /* ignore */ }
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
  const product = useProducts.getState().products.find(p => p.id === id)
  if (product && (Number(product.stock) || 0) > 0.009) {
    throw new Error(`Нельзя удалить товар со складом (остаток ${Number(product.stock).toFixed(2)})`)
  }
  try {
    const { getPending } = await import('./offline')
    const pending = await getPending()
    const inQueue = pending.some(r => {
      if (r.failed) return false
      if (r.kind !== 'sale' && r.kind !== 'sale_return') return false
      const items = (r.payload as any)?.items || (r.payload as any)?.cart || []
      return Array.isArray(items) && items.some((it: any) => Number(it.productId) === Number(id))
    })
    if (inQueue) throw new Error('Нельзя удалить: товар ещё в очереди чеков')
  } catch (e) {
    if (e instanceof Error && /нельзя удалить/i.test(e.message)) throw e
  }

  if (!isTradeLocalFirst()) {
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
    await api.deleteProduct(id, { clientRef })
    persistLocalCatalog(useProducts.getState().products.filter(p => p.id !== id))
    return { id }
  }, applyLocal)
}

/** Откат локального upsert товара при конфликте версии */
export function revertLocalProductUpsertOnReject(payload: Record<string, unknown>) {
  const prev = payload._prev as Product | null | undefined
  const localId = String(payload.localId || (payload.product as any)?.id || '')
  const products = useProducts.getState().products
  if (prev && prev.id != null) {
    persistLocalCatalog(products.map(p => (Number(p.id) === Number(prev.id) || String(p.id) === localId ? { ...prev } : p)))
    return
  }
  if (localId) {
    persistLocalCatalog(products.filter(p => String(p.id) !== localId && Number(p.id) !== Number(localId)))
  }
}
