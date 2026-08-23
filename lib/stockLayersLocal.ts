/**
 * Локальные партии склада (stock layers) — кэш KV + entities.
 */
import type { ProductStockLayer } from './types'
import { getKakapoDesktop, isKakapoDesktop } from './desktopBridge'
import { entityList, entityPut } from './localEntities'

const KEY_STOCK_LAYERS = 'catalog_stock_layers'
const PERSIST_DEBOUNCE_MS = 80

let entitySyncTimer: ReturnType<typeof setTimeout> | null = null
let entitySyncPending: ProductStockLayer[] | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null
let persistPending: ProductStockLayer[] | null = null
/** Горячий кэш в памяти — не читаем SQLite/localStorage на каждую партию */
let memoryCache: ProductStockLayer[] | null = null
let memoryLoaded = false

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

function setMemoryCache(layers: ProductStockLayer[]): void {
  memoryCache = layers
  memoryLoaded = true
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

function schedulePersist(layers: ProductStockLayer[]): void {
  setMemoryCache(layers)
  persistPending = layers
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    const list = persistPending
    persistPending = null
    if (!list) return
    void (async () => {
      try {
        await kvSet(list)
        scheduleEntitySync(list)
      } catch { /* ignore */ }
    })()
  }, PERSIST_DEBOUNCE_MS)
}

/** Сразу записать кэш на диск (pull sync, закрытие приложения). */
export async function flushStockLayersCache(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  const list = persistPending ?? memoryCache
  persistPending = null
  if (!list) return
  await kvSet(list)
  scheduleEntitySync(list)
}

export async function cacheStockLayers(layers: ProductStockLayer[]): Promise<void> {
  const list = Array.isArray(layers) ? layers : []
  schedulePersist(list)
}

export async function readCachedStockLayers(): Promise<ProductStockLayer[]> {
  if (memoryLoaded && memoryCache) return memoryCache
  const fromKv = await kvGet()
  if (fromKv?.length) {
    setMemoryCache(fromKv)
    return fromKv
  }
  const rows = await entityList<ProductStockLayer>('stock_layer')
  const list = rows.map(r => r.data).filter(Boolean)
  setMemoryCache(list)
  return list
}

/** После sync: локальный off-rec-* → серверный id в партиях */
export async function remapReceiptIdInLayers(localId: string, serverId: string): Promise<void> {
  if (!localId || !serverId || localId === serverId) return
  const list = await readCachedStockLayers()
  let changed = false
  const next = list.map(l => {
    if (l.receiptId !== localId) return l
    changed = true
    return { ...l, receiptId: serverId }
  })
  if (changed) await cacheStockLayers(next)
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
      const list = await pullStockLayersFromServer({ bumpProducts: true })
      if (list) onRemote?.(list)
    } catch { /* оставляем кэш */ }
  })()
  return cached
}

/**
 * Подтянуть партии с сервера.
 * Пока в очереди чек/возврат/склад — не тянем (сервер ещё со старыми остатками).
 * После пустой очереди — полная замена локального кэша.
 */
export async function pullStockLayersFromServer(opts?: {
  bumpProducts?: boolean
}): Promise<ProductStockLayer[] | null> {
  try {
    const { USE_API } = await import('./config')
    if (!USE_API) return null
    const { isOnline, pendingBlocksStockLayerPull } = await import('./offline')
    const { useOfflineSync } = await import('./offlineSync')
    const st = useOfflineSync.getState()
    if (!(isOnline() && st.online)) return null
    if (await pendingBlocksStockLayerPull()) return null

    const { api } = await import('./api')
    const remote = (await api.getAllStockLayers()) || []
    const next = remote
    await cacheStockLayers(next)
    if (opts?.bumpProducts !== false) {
      await bumpProductStockFromLayers(next)
    }
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('kakapo:stock-layers', { detail: { count: next.length } }))
      }
    } catch { /* ignore */ }
    return next
  } catch {
    return null
  }
}

/** Серверные партии + локальные off-* (ещё не ушедшие приходы) */
export function mergeRemoteLayersKeepingLocal(
  local: ProductStockLayer[],
  remote: ProductStockLayer[],
): ProductStockLayer[] {
  const map = new Map<string, ProductStockLayer>()
  for (const r of remote || []) {
    if ((Number(r.remainingQty) || 0) <= 0.0001) continue
    map.set(layerKey(r), r)
  }
  for (const l of local || []) {
    const rid = String(l.receiptId || '')
    const isLocalOnly = rid.startsWith('off-')
    if (!isLocalOnly) continue
    if ((Number(l.remainingQty) || 0) <= 0.0001) continue
    const key = layerKey(l)
    if (!map.has(key)) map.set(key, l)
  }
  return [...map.values()]
}

async function bumpProductStockFromLayers(layers: ProductStockLayer[]): Promise<void> {
  try {
    const { useProducts } = await import('./store')
    const byPid = new Map<number, number>()
    for (const l of layers || []) {
      const pid = Number(l.productId) || 0
      if (!pid) continue
      const qty = Number(l.remainingQty) || 0
      if (!(qty > 0.0001)) continue
      byPid.set(pid, Math.round(((byPid.get(pid) || 0) + qty) * 1000) / 1000)
    }
    // Трогаем только товары, которые были в партиях или есть сейчас — не весь каталог
    const touched = new Set<number>(byPid.keys())
    for (const l of memoryCache || []) {
      const pid = Number(l.productId) || 0
      if (pid) touched.add(pid)
    }
    if (!touched.size) return

    const ps = useProducts.getState()
    let changed = false
    const next = ps.products.map(p => {
      if (!touched.has(p.id)) return p
      const stock = byPid.get(p.id) || 0
      if (Math.abs(stock - (Number(p.stock) || 0)) < 0.0001) return p
      changed = true
      return { ...p, stock }
    })
    if (!changed) return
    useProducts.setState({ products: next })
    try {
      const { cacheProducts } = await import('./offline')
      void cacheProducts(next)
    } catch { /* ignore */ }
  } catch { /* ignore */ }
}

export async function upsertLocalStockLayer(layer: ProductStockLayer): Promise<ProductStockLayer[]> {
  const list = await readCachedStockLayers()
  const key = layerKey(layer)
  const next = list.filter(l => layerKey(l) !== key)
  if ((Number(layer.remainingQty) || 0) > 0.0001) next.push(layer)
  await cacheStockLayers(next)
  return next
}

export async function removeLocalStockLayer(receiptId: string, productId: number): Promise<ProductStockLayer[]> {
  const list = await readCachedStockLayers()
  const next = list.filter(l => !(l.receiptId === receiptId && Number(l.productId) === Number(productId)))
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

function round3(n: number) {
  return Math.round((Number(n) || 0) * 1000) / 1000
}

/**
 * Вернуть qty в партии (зеркально серверному restoreReceiptBalances):
 * 1) предпочитаем receiptId из чека
 * 2) иначе LIFO в ранее списанные партии (qty − remaining)
 * 3) остаток — слой-корректировка off-ret-*
 */
function applyRestoreOnList(
  list: ProductStockLayer[],
  productId: number,
  qty: number,
  opts?: {
    receiptId?: string
    productName?: string
    costPrice?: number
    retailPrice?: number
  },
): ProductStockLayer[] {
  let left = round3(qty)
  if (!(left > 0)) return list
  const pid = Number(productId)
  const next = list.map(l => ({ ...l }))

  const preferId = String(opts?.receiptId || '').trim()
  if (preferId) {
    const hit = next.find(l => l.receiptId === preferId && Number(l.productId) === pid)
    if (hit) {
      hit.remainingQty = round3((Number(hit.remainingQty) || 0) + left)
      hit.qty = Math.max(Number(hit.qty) || 0, Number(hit.remainingQty) || 0)
      return next.filter(l => (Number(l.remainingQty) || 0) > 0.0001)
    }
  }

  const mine = next
    .filter(l => Number(l.productId) === pid)
    .sort((a, b) => String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || ''))
      || (b.queueIndex - a.queueIndex))

  for (const layer of mine) {
    if (!(left > 0)) break
    const orig = Number(layer.qty) || 0
    const rem = Number(layer.remainingQty) || 0
    const room = Math.max(0, round3(orig - rem))
    if (!(room > 0)) continue
    const add = Math.min(room, left)
    layer.remainingQty = round3(rem + add)
    left = round3(left - add)
  }

  // Нет «дыры» в старых партиях — дописываем в новейшую (без off-ret, чтобы sync не дублировал)
  if (left > 0.0001 && mine.length) {
    const top = mine[0]
    top.remainingQty = round3((Number(top.remainingQty) || 0) + left)
    top.qty = Math.max(Number(top.qty) || 0, Number(top.remainingQty) || 0)
    left = 0
  }

  if (left > 0.0001) {
    const stamp = new Date().toISOString()
    next.unshift({
      receiptId: `off-ret-${Date.now()}-${pid}`,
      productId: pid,
      productName: String(opts?.productName || `#${pid}`),
      qty: left,
      remainingQty: left,
      costPrice: Number(opts?.costPrice) || 0,
      retailPrice: Number(opts?.retailPrice) || 0,
      bulkPricing: [],
      expiryDate: null,
      createdAtIso: stamp,
      supplierName: 'Возврат товара',
      queueIndex: 0,
      isActive: true,
    })
  }

  return next.filter(l => (Number(l.remainingQty) || 0) > 0.0001)
}

/** Вернуть товары возврата в локальные партии склада. */
export async function restoreLocalLayersFifoBatch(
  lines: Array<{
    productId: number
    qty: number
    receiptId?: string
    productName?: string
    costPrice?: number
    retailPrice?: number
  }>,
): Promise<ProductStockLayer[]> {
  let list = await readCachedStockLayers()
  for (const line of lines) {
    const qty = Number(line.qty) || 0
    if (!(qty > 0)) continue
    list = applyRestoreOnList(list, line.productId, qty, {
      receiptId: line.receiptId,
      productName: line.productName,
      costPrice: line.costPrice,
      retailPrice: line.retailPrice,
    })
  }
  await cacheStockLayers(list)
  await bumpProductStockFromLayers(list)
  return list
}
