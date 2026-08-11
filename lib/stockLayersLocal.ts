/**
 * Локальные партии склада (stock layers) — кэш KV + entities.
 */
import type { ProductStockLayer } from './types'
import { getKakapoDesktop, isKakapoDesktop } from './desktopBridge'
import { entityList, entityPut } from './localEntities'

const KEY_STOCK_LAYERS = 'catalog_stock_layers'

let entitySyncTimer: ReturnType<typeof setTimeout> | null = null
let entitySyncPending: ProductStockLayer[] | null = null

async function kvGet(): Promise<ProductStockLayer[] | null> {
  const desk = getKakapoDesktop()
  if (isKakapoDesktop() && desk?.localDbKvGet) {
    try {
      const v = await desk.localDbKvGet(KEY_STOCK_LAYERS)
      return Array.isArray(v) ? (v as ProductStockLayer[]) : null
    } catch { return null }
  }
  try {
    const raw = localStorage.getItem(`kakapo_${KEY_STOCK_LAYERS}`)
    return raw ? (JSON.parse(raw) as ProductStockLayer[]) : null
  } catch {
    return null
  }
}

async function kvSet(layers: ProductStockLayer[]): Promise<void> {
  const desk = getKakapoDesktop()
  if (isKakapoDesktop() && desk?.localDbKvSet) {
    await desk.localDbKvSet(KEY_STOCK_LAYERS, layers)
    return
  }
  try {
    localStorage.setItem(`kakapo_${KEY_STOCK_LAYERS}`, JSON.stringify(layers))
  } catch { /* ignore */ }
}

export function layerKey(layer: Pick<ProductStockLayer, 'receiptId' | 'productId'>): string {
  return `${layer.receiptId}:${layer.productId}`
}

/** Медленный entityPut всех партий — только в фоне, не на пути «Пробить». */
function scheduleEntitySync(layers: ProductStockLayer[]): void {
  entitySyncPending = layers
  if (entitySyncTimer) return
  entitySyncTimer = setTimeout(() => {
    entitySyncTimer = null
    const list = entitySyncPending
    entitySyncPending = null
    if (!list) return
    void (async () => {
      try {
        for (const layer of list) {
          await entityPut('stock_layer', layerKey(layer), layer, {
            updatedAtIso: layer.createdAtIso || new Date().toISOString(),
          })
        }
      } catch { /* ignore */ }
    })()
  }, 0)
}

export async function cacheStockLayers(layers: ProductStockLayer[]): Promise<void> {
  const list = Array.isArray(layers) ? layers : []
  await kvSet(list)
  scheduleEntitySync(list)
}

export async function readCachedStockLayers(): Promise<ProductStockLayer[]> {
  const fromKv = await kvGet()
  if (fromKv?.length) return fromKv
  const rows = await entityList<ProductStockLayer>('stock_layer')
  return rows.map(r => r.data).filter(Boolean)
}

/**
 * Сначала локальный кэш, затем сеть в фоне (не блокирует UI на слабом интернете).
 * onRemote вызывается, когда сервер ответил.
 */
export async function loadStockLayersCacheFirst(
  onRemote?: (layers: ProductStockLayer[]) => void,
): Promise<ProductStockLayer[]> {
  const cached = await readCachedStockLayers()
  void (async () => {
    try {
      const { USE_API } = await import('./config')
      if (!USE_API) return
      const { isOnline } = await import('./offline')
      const { useOfflineSync } = await import('./offlineSync')
      const st = useOfflineSync.getState()
      if (!(isOnline() && st.online)) return
      // Есть очередь — не затираем локальные партии сервером
      if (st.pending > 0) return
      const { api } = await import('./api')
      const remote = await api.getAllStockLayers()
      const list = remote || []
      await cacheStockLayers(list)
      onRemote?.(list)
    } catch { /* оставляем кэш */ }
  })()
  return cached
}

export async function upsertLocalStockLayer(layer: ProductStockLayer): Promise<ProductStockLayer[]> {
  const list = await readCachedStockLayers()
  const key = layerKey(layer)
  const next = list.filter(l => layerKey(l) !== key)
  if ((Number(layer.remainingQty) || 0) > 0.0001) next.push(layer)
  await cacheStockLayers(next)
  return next
}

export async function applyLocalReceiptLayers(
  receipt: {
    id: string
    supplierName?: string
    createdAtIso?: string
    items: Array<{
      productId: number
      productName?: string
      qty: number
      remainingQty?: number
      costPrice?: number
      retailPrice?: number
      bulkPricing?: ProductStockLayer['bulkPricing']
      expiryDate?: string | null
    }>
  },
  sign: 1 | -1,
): Promise<void> {
  let list = await readCachedStockLayers()
  if (sign < 0) {
    list = list.filter(l => l.receiptId !== receipt.id)
    await cacheStockLayers(list)
    return
  }
  const stamp = receipt.createdAtIso || new Date().toISOString()
  const built: ProductStockLayer[] = receipt.items.map((it, idx) => ({
    receiptId: receipt.id,
    productId: Number(it.productId),
    productName: it.productName || `#${it.productId}`,
    qty: Number(it.qty) || 0,
    remainingQty: Number(it.remainingQty != null ? it.remainingQty : it.qty) || 0,
    costPrice: Number(it.costPrice) || 0,
    retailPrice: Number(it.retailPrice) || 0,
    bulkPricing: Array.isArray(it.bulkPricing) ? it.bulkPricing : [],
    expiryDate: it.expiryDate ?? null,
    createdAtIso: stamp,
    supplierName: receipt.supplierName || '',
    queueIndex: idx,
    isActive: true,
  })).filter(l => (Number(l.remainingQty) || 0) > 0.0001)

  list = list.filter(l => l.receiptId !== receipt.id).concat(built)
  await cacheStockLayers(list)
}

function applyFifoOnList(
  list: ProductStockLayer[],
  productId: number,
  qty: number,
): ProductStockLayer[] {
  let left = Math.round((Number(qty) || 0) * 1000) / 1000
  if (!(left > 0)) return list
  const pid = Number(productId)
  const next = list.map(l => ({ ...l }))
  const mine = next
    .filter(l => Number(l.productId) === pid && (Number(l.remainingQty) || 0) > 0)
    .sort((a, b) => String(a.createdAtIso).localeCompare(String(b.createdAtIso)) || a.queueIndex - b.queueIndex)

  for (const layer of mine) {
    if (!(left > 0)) break
    const have = Number(layer.remainingQty) || 0
    const take = Math.min(have, left)
    layer.remainingQty = Math.round((have - take) * 1000) / 1000
    left = Math.round((left - take) * 1000) / 1000
  }
  return next.filter(l => (Number(l.remainingQty) || 0) > 0.0001)
}

/** FIFO списание qty с партий товара (локально) */
export async function consumeLocalLayersFifo(
  productId: number,
  qty: number,
): Promise<ProductStockLayer[]> {
  const list = await readCachedStockLayers()
  const cleaned = applyFifoOnList(list, productId, qty)
  await cacheStockLayers(cleaned)
  return cleaned
}

/** Одним чтением/записью списать весь чек — для быстрого пробития. */
export async function consumeLocalLayersFifoBatch(
  lines: Array<{ productId: number; qty: number }>,
): Promise<ProductStockLayer[]> {
  let list = await readCachedStockLayers()
  for (const line of lines) {
    const qty = Number(line.qty) || 0
    if (!(qty > 0)) continue
    list = applyFifoOnList(list, line.productId, qty)
  }
  await cacheStockLayers(list)
  return list
}
