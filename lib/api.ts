// ════════════════════════════════════════════════
// KAKAPO — API клиент (связь с backend)
// ════════════════════════════════════════════════
import type {
  Order,
  Product,
  ProductStockLayer,
  Restaurant,
  Category,
  Promo,
  RestaurantPayout,
  Review,
  PosCashier,
  PosExpense,
  FinanceMove,
  PosPoint,
  PosShift,
  PosSupplier,
  SupplierPayment,
  StockReceipt,
  StockWriteoff,
  StockRevision,
  PosSale,
  TradeDeviceHeartbeatPayload,
  TradeDeviceLiveStatus,
  RevisionPosCut,
  RevisionWaitDevice,
} from './types'
import type { PickupPoint } from './pickups'
import type { PricingConfig } from './courierData'
import type { AdminCourier } from './courierTeam'
import type { CourierWalletSnapshot } from './courierWalletTx'
import type { AdminAssembler } from './assemblerTeam'
import type { AdminClient } from './clientCrm'
import type { AdminCard } from './cardCrm'
import { getApiUrl } from './config'
import { getTradeDeviceIdSync } from './tradeDevice'
import { noteApiFail, noteApiOk, recentlyApiOk, shouldSkipFetchAsOffline } from './apiReachability'
import { isTradeLocalFirst } from './offlineV2'

// ── Сетевые ошибки (нет связи / таймаут) для офлайн-режима ──
export class NetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NetworkError'
  }
}

/** true, если ошибка вызвана отсутствием связи с сервером (а не ответом сервера) */
export function isNetworkError(e: unknown): boolean {
  return e instanceof NetworkError
}

/** Браузер уже знает, что сети нет — не ждём таймаутов (кроме ложного offline в Electron) */
function browserOffline(): boolean {
  return shouldSkipFetchAsOffline()
}

/**
 * Ответ пришёл, но это не наш API: в десктоп-кассе запросы идут через
 * локальный сервер, и без интернета он отдаёт 5xx с HTML вместо JSON.
 * Такой ответ означает «нет связи», а не отказ сервера.
 */
function looksLikeOutage(status: number, body: string): boolean {
  if (status === 502 || status === 503 || status === 504) return true
  if (status !== 500) return false
  const text = String(body || '').trim()
  if (!text) return true
  if (text.startsWith('{') || text.startsWith('[')) return false
  return true
}

// ── Хранение токена ──
let _token: string | null = null
export const setToken = (t: string | null) => {
  _token = t
  if (typeof window !== 'undefined') {
    if (t) localStorage.setItem('kakapo_token', t)
    else localStorage.removeItem('kakapo_token')
  }
}
export const getToken = (): string | null => {
  if (_token) return _token
  if (typeof window !== 'undefined') _token = localStorage.getItem('kakapo_token')
  return _token
}

/**
 * Значения HTTP-заголовков должны быть в Latin-1. Имена на кириллице ломают
 * fetch() ("Failed to fetch"), поэтому кодируем всё в percent-encoding (ASCII),
 * а сервер раскодирует обратно.
 */
function encodeHeaderValue(v: string): string {
  try {
    return encodeURIComponent(String(v))
  } catch {
    return ''
  }
}

/** Кто выполнил действие (только Admin / Trade) — для журнала аудита */
function buildAuditActorHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  const path = window.location.pathname || ''
  const out: Record<string, string> = {}
  try {
    if (path.includes('/admin')) {
      // Помечаем приложение по пути всегда (даже без сессии): персонал не ограничен лимитом долга
      out['x-kakapo-app'] = 'admin'
      const raw = localStorage.getItem('kakapo_admin_session')
      if (raw) {
        const s = JSON.parse(raw) as { login?: string; name?: string }
        if (s?.login) out['x-kakapo-admin-login'] = encodeHeaderValue(s.login)
        if (s?.name) out['x-kakapo-admin-name'] = encodeHeaderValue(s.name)
      }
    } else if (path.includes('/trade') || path.includes('/pos')) {
      out['x-kakapo-app'] = 'trade'
      const raw = localStorage.getItem('kakapo_trade_employee_session')
      if (raw) {
        const s = JSON.parse(raw) as { employeeId?: string; name?: string }
        if (s?.employeeId) out['x-kakapo-employee-id'] = encodeHeaderValue(s.employeeId)
        if (s?.name) out['x-kakapo-employee-name'] = encodeHeaderValue(s.name)
      }
      const deviceId = getTradeDeviceIdSync()
      if (deviceId) out['x-kakapo-device-id'] = encodeHeaderValue(deviceId)
    }
  } catch { /* ignore */ }
  return out
}

// ── Базовый запрос ──
function formatApiError(detail: unknown, status?: number): string {
  if (typeof detail === 'string') {
    if (detail === 'Internal Server Error' && status === 500) {
      return 'Сервер временно недоступен. Подождите 5–15 сек и попробуйте снова.'
    }
    return detail
  }
  if (Array.isArray(detail)) {
    return detail
      .map(item => {
        if (item && typeof item === 'object' && 'msg' in item) return String((item as { msg: string }).msg)
        return typeof item === 'string' ? item : JSON.stringify(item)
      })
      .join(' · ')
  }
  if (detail && typeof detail === 'object' && 'error' in detail) return String((detail as { error: string }).error)
  if (detail && typeof detail === 'object' && 'msg' in detail) return String((detail as { msg: string }).msg)
  return status ? `Ошибка сервера (${status})` : 'Ошибка сервера'
}

function stripHtmlError(text: string): string {
  const pre = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)
  if (pre) {
    const msg = pre[1].replace(/<[^>]+>/g, '').trim()
    if (/Cannot DELETE/i.test(msg)) {
      return 'На сервере нет удаления клиентов — обновите backend API'
    }
    if (/Cannot POST/i.test(msg)) {
      return 'На сервере нет этого API — обновите backend API'
    }
    return msg.slice(0, 200)
  }
  if (/Cannot DELETE/i.test(text)) {
    return 'На сервере нет удаления клиентов — обновите backend API'
  }
  // Next.js 404 HTML (часто когда API URL указан как сайт без /api/kakapo)
  if (/404|Страница не найдена|__next_f|This page could not be found/i.test(text)) {
    return 'API не найден (404). Проверьте адрес /api/kakapo — пересоберите веб на сервере.'
  }
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
}

function parseErrorText(text: string, status: number): string {
  if (!text) return formatApiError(null, status)
  try {
    const json = JSON.parse(text)
    return formatApiError(json.error ?? json.detail ?? json.message ?? json, status) || text.slice(0, 160)
  } catch {
    const plain = stripHtmlError(text)
    return formatApiError(plain, status) || plain
  }
}

async function parseErrorResponse(res: Response): Promise<string> {
  return parseErrorText(await res.text(), res.status)
}

const RETRY_STATUS = new Set([500, 502, 503, 504])
const REQUEST_TIMEOUT_MS = 12000
const LIST_TIMEOUT_MS = 20000
const REVIEW_TIMEOUT_MS = 30000
/** Чек кассы: лучше быстро уйти в офлайн-очередь, чем висеть */
const POS_SALE_TIMEOUT_MS = 1600
const MAX_ATTEMPTS = 2
const RETRY_DELAY_MS = 1200

function withTimeout<T>(promise: Promise<T>, ms = REQUEST_TIMEOUT_MS, abort?: AbortController): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { abort?.abort() } catch { /* ignore */ }
      reject(new NetworkError('Сервер не отвечает. Попробуйте ещё раз.'))
    }, ms)
    promise.then(
      v => { clearTimeout(timer); resolve(v) },
      e => {
        clearTimeout(timer)
        if (abort?.signal.aborted) {
          reject(new NetworkError('Сервер не отвечает. Попробуйте ещё раз.'))
          return
        }
        reject(e)
      },
    )
  })
}

async function parseSuccessBody<T>(res: Response): Promise<T> {
  const text = await res.text()
  if (!text.trim()) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    return {} as T
  }
}

async function request<T>(path: string, options: RequestInit = {}, attempt = 0, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  return requestUrl<T>(`${getApiUrl()}${path}`, options, attempt, timeoutMs)
}

async function requestLongList<T>(path: string, options: RequestInit = {}): Promise<T> {
  return request<T>(path, options, 0, LIST_TIMEOUT_MS)
}

/** Маршруты Next.js вне proxy /api/kakapo */
async function requestApp<T>(path: string, options: RequestInit = {}, attempt = 0): Promise<T> {
  return requestUrl<T>(path, options, attempt)
}

async function requestUrl<T>(url: string, options: RequestInit = {}, attempt = 0, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string> || {}),
  }
  if (isFormData) delete headers['Content-Type']
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  Object.assign(headers, buildAuditActorHeaders())

  if (browserOffline()) {
    throw new NetworkError('Нет связи с сервером. Проверьте интернет.')
  }

  let res: Response
  try {
    const ctrl = new AbortController()
    const parentSignal = options.signal
    if (parentSignal) {
      if (parentSignal.aborted) {
        throw new NetworkError('Сервер не отвечает. Попробуйте ещё раз.')
      }
      parentSignal.addEventListener('abort', () => {
        try { ctrl.abort() } catch { /* ignore */ }
      }, { once: true })
    }
    res = await withTimeout(
      fetch(url, { ...options, headers, signal: ctrl.signal }),
      (isTradeLocalFirst() && !recentlyApiOk(45_000)) ? Math.min(timeoutMs, 2800) : timeoutMs,
      ctrl,
    )
  } catch (e) {
    noteApiFail()
    const timedOut = e instanceof NetworkError || (e instanceof Error && e.message.includes('Сервер не отвечает'))
    const allowRetry = timedOut && attempt < 1 && timeoutMs > 2000 && !isTradeLocalFirst()
    if (allowRetry) {
      await new Promise(r => setTimeout(r, 400))
      return requestUrl<T>(url, options, attempt + 1, Math.min(timeoutMs, 8000))
    }
    if (timedOut) {
      throw new NetworkError('Сервер не отвечает. Подождите немного и обновите страницу.')
    }
    throw new NetworkError('Нет связи с сервером. Проверьте интернет.')
  }

  if (!res.ok) {
    const raw = await res.text()
    const message = parseErrorText(raw, res.status)
    if (RETRY_STATUS.has(res.status) && attempt < MAX_ATTEMPTS - 1) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)))
      return requestUrl<T>(url, options, attempt + 1, timeoutMs)
    }
    if (looksLikeOutage(res.status, raw)) {
      noteApiFail()
      throw new NetworkError('Нет связи с сервером. Проверьте интернет.')
    }
    throw new Error(message || `Ошибка ${res.status}`)
  }
  noteApiOk()
  return parseSuccessBody<T>(res)
}

async function createOrderViaAppRoute(data: unknown): Promise<Order> {
  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const message = await parseErrorResponse(res)
    throw new Error(message)
  }
  return res.json()
}

async function reviewsViaAppRoute<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers as Record<string, string> || {}) },
  })
  if (!res.ok) {
    const message = await parseErrorResponse(res)
    throw new Error(message)
  }
  return parseSuccessBody<T>(res)
}

async function reviewViaAppRoute(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers as Record<string, string> || {}) },
  })
}

async function getReviewsViaAppRoute(filter?: string | { restId?: string; productId?: string | number }): Promise<Review[]> {
  const q = new URLSearchParams()
  if (typeof filter === 'string') {
    if (filter) q.set('restId', filter)
  } else if (filter) {
    if (filter.restId) q.set('restId', filter.restId)
    if (filter.productId != null && filter.productId !== '') q.set('productId', String(filter.productId))
  }
  const qs = q.toString()
  const res = await reviewViaAppRoute(`/api/reviews${qs ? `?${qs}` : ''}`)
  if (!res.ok) throw new Error(await parseErrorResponse(res))
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

function reviewsQuery(filter?: string | { restId?: string; productId?: string | number }): string {
  const q = new URLSearchParams()
  if (typeof filter === 'string') {
    if (filter) q.set('restId', filter)
  } else if (filter) {
    if (filter.restId) q.set('restId', filter.restId)
    if (filter.productId != null && filter.productId !== '') q.set('productId', String(filter.productId))
  }
  const qs = q.toString()
  return qs ? `?${qs}` : ''
}

async function createReviewViaAppRoute(data: Partial<Review>): Promise<Review> {
  const res = await reviewViaAppRoute('/api/reviews', {
    method: 'POST',
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await parseErrorResponse(res))
  return res.json()
}

async function updateReviewViaAppRoute(id: number, data: Partial<Review>): Promise<Review> {
  const res = await reviewViaAppRoute(`/api/reviews/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await parseErrorResponse(res))
  return res.json()
}

async function deleteReviewViaAppRoute(id: number): Promise<void> {
  const res = await reviewViaAppRoute(`/api/reviews/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await parseErrorResponse(res))
}

async function deleteReviewsBulkViaAppRoute(ids: number[]): Promise<{ deleted: number }> {
  const res = await reviewViaAppRoute('/api/reviews/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  })
  if (!res.ok) throw new Error(await parseErrorResponse(res))
  return res.json()
}

// ════════════════════════════════════════════════
// АВТОРИЗАЦИЯ
// ════════════════════════════════════════════════
export const api = {
  // ── Auth ──
  sendOTP: (phone: string) =>
    request<{ ok: boolean; demo: boolean }>('/auth/otp/send', {
      method: 'POST', body: JSON.stringify({ phone }),
    }),

  verifyOTP: (phone: string, code: string) =>
    request<{
      access_token: string
      role: string
      user_id: number | string
      name: string
    }>('/auth/otp/verify', {
      method: 'POST', body: JSON.stringify({ phone, code }),
    }),

  login: (email: string, password: string) =>
    request<{ access_token: string; role: string; user_id: number; name: string }>('/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    }),

  loginAdmin: (login: string, password: string) =>
    request<{ access_token: string; role: string; user_id: number; name: string }>('/auth/login', {
      method: 'POST', body: JSON.stringify({ login, email: login, password }),
    }),

  getAdminAuth: () =>
    request<{ login: string }>('/auth/admin'),

  updateAdminAuth: (data: {
    currentPassword: string
    login?: string
    newPassword?: string
  }) =>
    request<{ ok: boolean; login: string }>('/auth/admin', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // ── Товары ──
  getProducts: (params?: { category_id?: number; search?: string; hot?: boolean }) => {
    const q = new URLSearchParams()
    if (params?.category_id) q.set('category_id', String(params.category_id))
    if (params?.search) q.set('search', params.search)
    if (params?.hot !== undefined) q.set('hot', String(params.hot))
    return request<Product[]>(`/products?${q}`)
  },
  getProduct: (id: number) => request<Product>(`/products/${id}`),
  getProductStockLayers: (id: number) => request<ProductStockLayer[]>(`/products/${id}/stock-layers`),
  getAllStockLayers: () => request<ProductStockLayer[]>('/stock/layers'),
  /** Двусторонний синк: дельты с курсором since (ISO) */
  getSyncChanges: (since?: string) => {
    const q = since ? `?since=${encodeURIComponent(since)}` : ''
    return requestLongList<{
      cursor: string
      since: string | null
      full: boolean
      products: Product[]
      categories: unknown[]
      clients: unknown[]
      cards: unknown[]
      stockLayers: ProductStockLayer[]
      deletes?: { kind: string; id: string; atIso?: string }[]
      stockLayersReplace?: boolean
      pos: {
        sales: unknown[]
        shifts: unknown[]
        receipts: unknown[]
        writeoffs: unknown[]
        revisions: unknown[]
        financeMoves: unknown[]
        expenses: unknown[]
        suppliers: unknown[]
        posPoints: unknown[]
        cashiers: unknown[]
        expiry: unknown[]
      }
    }>(`/sync/changes${q}`)
  },
  reconcileStock: (data?: { createdBy?: string }) =>
    request<{ ok: boolean; fixed: { id: number; name: string; before: number; after: number }[] }>(
      '/stock/reconcile',
      { method: 'POST', body: JSON.stringify(data || {}) },
    ),
  addProductStockLayer: (id: number, data: {
    qty: number
    costPrice?: number
    retailPrice?: number
    bulkPricing?: { minQty: number; price: number }[]
    expiryDate?: string | null
    supplierName?: string
    createdBy?: string
  }) => request<{ receipt: StockReceipt; layers: ProductStockLayer[] }>(`/products/${id}/stock-layers`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateProductStockLayer: (receiptId: string, productId: number, data: {
    costPrice?: number
    retailPrice?: number
    bulkPricing?: { minQty: number; price: number }[]
    expiryDate?: string | null
  }) => request<ProductStockLayer[]>(`/stock/layers/${receiptId}/${productId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),
  deleteProductStockLayer: (receiptId: string, productId: number, data?: { clientRef?: string }) =>
    request<{
      receiptId: string
      productId: number
      deletedReceipt: boolean
      layers: ProductStockLayer[]
    }>(`/stock/layers/${encodeURIComponent(receiptId)}/${productId}`, {
      method: 'DELETE',
      body: data ? JSON.stringify(data) : undefined,
    }),
  createProduct: (data: any) => request<Product>('/products', { method: 'POST', body: JSON.stringify(data) }),
  updateProduct: (id: number, data: any) => request<Product>(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteProduct: (id: number, data?: { clientRef?: string }) =>
    request(`/products/${id}`, {
      method: 'DELETE',
      body: data ? JSON.stringify(data) : undefined,
    }),
  deleteProducts: (ids: number[]) => request<{ ok: boolean; removed: number; ids: number[] }>(
    '/products/bulk-delete',
    { method: 'POST', body: JSON.stringify({ ids }) },
    0,
    300_000,
  ),
  /** Одно фото: сервер обрезает, WebP 1200×1200 + thumb. Старое удаляется после успеха. */
  uploadProductPhoto: (file: Blob, opts?: { productId?: number; replaceUrl?: string; fileName?: string }) => {
    const fd = new FormData()
    fd.append('photo', file, opts?.fileName || 'photo.png')
    if (opts?.productId != null && opts.productId > 0) fd.append('productId', String(opts.productId))
    if (opts?.replaceUrl) fd.append('replaceUrl', opts.replaceUrl)
    return request<{ url: string; thumbUrl: string; width: number; height: number; bytes: number }>(
      '/products/photo',
      { method: 'POST', body: fd },
      0,
      300_000,
    )
  },

  // ── Категории ──
  getCategories: (parent_id?: number) =>
    request<Category[]>(`/categories${parent_id !== undefined ? `?parent_id=${parent_id}` : ''}`),
  getCategoriesTree: () => request<any[]>('/categories/tree'),
  createCategory: (data: any) => request('/categories', { method: 'POST', body: JSON.stringify(data) }),
  updateCategory: (id: number, data: any) => request<Category>(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  reorderCategories: (items: { id: number; order: number }[], data?: { clientRef?: string }) =>
    request<{ ok: boolean; changed: number }>('/categories/reorder', {
      method: 'POST',
      body: JSON.stringify({ items, clientRef: data?.clientRef }),
    }),
  deleteCategory: (id: number, data?: { clientRef?: string }) => request<{
    ok: boolean
    movedProducts?: number
    deleted?: number[]
    slugs?: string[]
  }>(`/categories/${id}`, {
    method: 'DELETE',
    body: data ? JSON.stringify(data) : undefined,
  }),
  deleteCategories: (ids: number[], data?: { clientRef?: string }) => request<{
    ok: boolean
    removed: number
    deleted: number[]
    slugs?: string[]
    movedProducts: number
  }>('/categories/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ ids, clientRef: data?.clientRef }),
  }, 0, 300_000),

  // ── Акции ──
  getPromos: () => request<Promo[]>('/promos'),
  createPromo: (data: Partial<Promo>) =>
    request<Promo>('/promos', { method: 'POST', body: JSON.stringify(data) }),
  updatePromo: (id: number, data: Partial<Promo>) =>
    request<Promo>(`/promos/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deletePromo: (id: number) => request(`/promos/${id}`, { method: 'DELETE' }),

  // ── Заказы ──
  createOrder: (data: any) => {
    if (typeof window !== 'undefined') {
      return createOrderViaAppRoute(data)
    }
    return request<Order>('/orders', { method: 'POST', body: JSON.stringify(data) })
  },
  getOrders: (params?: { status?: string; type?: string }) => {
    const q = new URLSearchParams()
    if (params?.status) q.set('status', params.status)
    if (params?.type) q.set('type', params.type)
    return request<Order[]>(`/orders?${q}`)
  },
  getOrder: (id: number) => request<Order>(`/orders/${id}`),
  getAssemblerOrders: () => request<Order[]>('/orders/assembler'),
  getCourierOrders: () => request<Order[]>('/orders/courier'),
  updateOrderStatus: (id: string | number, status: string, extra?: Record<string, unknown>) =>
    request<Order>(`/orders/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, ...extra }),
    }),
  deleteOrder: (id: string | number) =>
    request<{ ok: boolean; id: string }>(`/orders/${id}`, { method: 'DELETE' }),
  bulkDeleteOrders: (ids: Array<string | number>) =>
    request<{ ok: boolean; removed: number; ids: string[] }>('/orders/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),

  // ── Рестораны ──
  getRestaurants: () => request<Restaurant[]>('/restaurants'),
  getRestaurant: (id: string | number) => request<Restaurant>(`/restaurants/${id}`),
  createRestaurant: (data: Partial<Restaurant>) =>
    request<Restaurant>('/restaurants', { method: 'POST', body: JSON.stringify(data) }),
  deleteRestaurant: (id: string) =>
    request<{ ok: boolean; id: string }>(`/restaurants/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  toggleRestaurant: (id: string) => request(`/restaurants/${id}/toggle`, { method: 'PATCH' }),
  updateRestaurant: (id: string, data: Partial<Restaurant>) =>
    request<Restaurant>(`/restaurants/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  uploadRestaurantPhoto: (
    file: Blob,
    opts?: { restaurantId?: string; dishId?: number | string; replaceUrl?: string; fileName?: string },
  ) => {
    const fd = new FormData()
    fd.append('photo', file, opts?.fileName || 'dish-photo.jpg')
    if (opts?.restaurantId) fd.append('restaurantId', opts.restaurantId)
    if (opts?.dishId != null) fd.append('dishId', String(opts.dishId))
    if (opts?.replaceUrl) fd.append('replaceUrl', opts.replaceUrl)
    return request<{ url: string; width: number; height: number; bytes: number }>(
      '/restaurants/photo',
      { method: 'POST', body: fd },
    )
  },
  blockRestaurant: (id: string, blocked: boolean) =>
    request<Restaurant>(`/restaurants/${id}/block`, { method: 'PATCH', body: JSON.stringify({ blocked }) }),
  createPayout: (restId: string, data: { method?: string; note?: string; amount?: number }) =>
    request<{ payout: RestaurantPayout; restaurant: Restaurant; balance?: { pendingNet: number } }>(`/restaurants/${restId}/payout`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getPayouts: (restId?: string) =>
    request<RestaurantPayout[]>(`/payouts${restId ? `?restId=${encodeURIComponent(restId)}` : ''}`),
  setCommission: (id: string, commission: number) =>
    request(`/restaurants/${id}/commission?commission=${commission}`, { method: 'PATCH' }),
  toggleMenuStock: (itemId: number) => request(`/restaurants/menu/${itemId}/stock`, { method: 'PATCH' }),

  // ── Курьеры ──
  getCouriers: () => request<AdminCourier[]>('/couriers'),
  createCourier: (data: Partial<AdminCourier>) =>
    request<AdminCourier>('/couriers', { method: 'POST', body: JSON.stringify(data) }),
  updateCourier: (id: string, data: Partial<AdminCourier>) =>
    request<AdminCourier>(`/couriers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteCourier: (id: string) =>
    request<{ ok: boolean; id: string }>(`/couriers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  depositCourierBalance: (id: string, amount: number, note?: string) =>
    request<{ ok: boolean; balance: number; added: number; courierId?: string; account?: string }>(`/couriers/${id}/deposit`, {
      method: 'POST',
      body: JSON.stringify({ amount, note }),
    }),
  withdrawCourierBalance: (id: string, amount: number, note?: string) =>
    request<{ ok: boolean; balance: number; withdrawn: number; courierId?: string; account?: string }>(`/couriers/${id}/withdraw`, {
      method: 'POST',
      body: JSON.stringify({ amount, note }),
    }),
  getCourierWalletTransactions: (id: string, limit = 30) =>
    request<CourierWalletSnapshot>(`/couriers/${id}/wallet/transactions?limit=${limit}`),
  listCourierWalletTransactions: (params?: { courierId?: string; limit?: number }) => {
    const q = new URLSearchParams()
    if (params?.courierId) q.set('courierId', params.courierId)
    if (params?.limit) q.set('limit', String(params.limit))
    const qs = q.toString()
    return request<{ transactions: (CourierWalletTx & { courierName?: string; account?: string })[] }>(
      `/couriers/wallet/transactions${qs ? `?${qs}` : ''}`,
    )
  },

  getAssemblers: () => request<AdminAssembler[]>('/assemblers'),
  createAssembler: (data: Partial<AdminAssembler>) =>
    request<AdminAssembler>('/assemblers', { method: 'POST', body: JSON.stringify(data) }),
  updateAssembler: (id: string, data: Partial<AdminAssembler>) =>
    request<AdminAssembler>(`/assemblers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteAssembler: (id: string) =>
    request<{ ok: boolean; id: string }>(`/assemblers/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getClients: () => requestLongList<AdminClient[]>('/clients'),
  getDeletedPhones: () =>
    request<{ phones: string[] }>('/clients/deleted-phones').catch(() => ({ phones: [] as string[] })),
  /** Жив ли аккаунт клиента (магазин опрашивает после удаления в админке) */
  checkClientSession: (phone: string) => {
    const digits = (phone || '').replace(/\D/g, '').slice(-9)
    return request<{ active: boolean; reason?: string }>(
      `/clients/session-check?phone=${encodeURIComponent(digits)}`,
    )
  },
  purgeDemoClients: () =>
    request<{ ok: boolean; removed: number }>('/clients/purge-demo', { method: 'POST' }),
  createClient: (data: Partial<AdminClient>) =>
    request<AdminClient>('/clients', { method: 'POST', body: JSON.stringify(data) }),
  updateClient: (id: string, data: Partial<AdminClient> & { expectedDocVersion?: number; clientRef?: string }) =>
    request<AdminClient>(`/clients/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  purgeClient: (id: string) =>
    request<{ ok: boolean } | AdminClient>(`/clients/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ purge: true }),
    }),
  deleteClient: (id: string, phone?: string, data?: { clientRef?: string }) =>
    request<{ ok: boolean }>(`/clients/${encodeURIComponent(id)}/delete`, {
      method: 'POST',
      body: JSON.stringify({
        phone: phone ? phone.replace(/\D/g, '').slice(-9) : '',
        clientRef: data?.clientRef,
      }),
    }),
  deleteClientByPhone: (phone: string) => {
    const digits = (phone || '').replace(/\D/g, '').slice(-9)
    return request<{ ok: boolean }>('/clients/delete-by-phone', {
      method: 'POST',
      body: JSON.stringify({ phone: digits }),
    })
  },
  purgeAccountByPhone: (phone: string) => {
    const digits = (phone || '').replace(/\D/g, '').slice(-9)
    return request<{ ok: boolean; orders: number; clients: number }>('/clients/purge-account', {
      method: 'POST',
      body: JSON.stringify({ phone: digits }),
    })
  },
  moveClientToRecovery: (id: string, phone?: string) =>
    requestApp<AdminClient>(`/api/kakapo/clients/${encodeURIComponent(id)}/recovery`, {
      method: 'POST',
      body: JSON.stringify({ phone: phone ? phone.replace(/\D/g, '').slice(-9) : '' }),
    }),
  restoreClient: (id: string) =>
    requestApp<AdminClient>(`/api/kakapo/clients/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  moveClientToRecoveryByPhone: (phone: string) => {
    const digits = (phone || '').replace(/\D/g, '').slice(-9)
    return request<AdminClient>('/clients/recovery-by-phone', {
      method: 'POST',
      body: JSON.stringify({ phone: digits }),
    })
  },

  // ── Точки забора ──
  getPickups: () => request<PickupPoint[]>('/pickups'),
  updatePickup: (id: string, data: Partial<PickupPoint>) =>
    request<PickupPoint>(`/pickups/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // ── Тариф доставки ──
  getPricing: () => request<PricingConfig>('/settings/pricing'),
  updatePricing: (data: Partial<PricingConfig>) =>
    request<PricingConfig>('/settings/pricing', { method: 'PATCH', body: JSON.stringify(data) }),
  getLoyalty: () => request<Record<string, unknown>>('/settings/loyalty'),
  updateLoyalty: (data: Record<string, unknown>) =>
    request('/settings/loyalty', { method: 'PATCH', body: JSON.stringify(data) }),
  getAdminSettings: () => request<{
    sms: { provider: string; apiKey: string }
    store: Record<string, string>
    auth?: { login: string }
  }>('/settings/admin'),
  updateAdminSettings: (data: {
    sms?: Record<string, unknown>
    store?: Record<string, unknown>
  }) => request('/settings/admin', { method: 'PATCH', body: JSON.stringify(data) }),
  /** Публичные контакты магазина (без SMS/auth) */
  getStoreSettings: () => request<{
    name?: string
    city?: string
    address?: string
    phone1?: string
    phone2?: string
    email?: string
    telegram?: string
    hours?: string
  }>('/settings/store'),
  syncLoyalty: (phone: string) =>
    request<{ ok: boolean; credited: number; orders: number; bonus: number }>('/loyalty/sync', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),

  // ── Карты ──
  getCards: () => requestLongList<AdminCard[]>('/cards'),
  generateCards: (count: number) =>
    request<{ ok: boolean; count: number; cards: AdminCard[] }>(`/cards/generate?count=${count}`, { method: 'POST' }),
  ensureCard: (data: Partial<AdminCard> & { num: string; clientId?: string }) =>
    request<AdminCard>('/cards/ensure', { method: 'POST', body: JSON.stringify(data) }),
  updateCard: (num: string, data: Partial<AdminCard> & { unlink?: boolean; allowBonusDecrease?: boolean }) =>
    request<AdminCard>(`/cards/${encodeURIComponent(num.trim())}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getDebtLedger: (phone: string) =>
    request<import('./clientVipCredit').DebtLedgerResponse>(
      `/debt/ledger?phone=${encodeURIComponent(phone.trim())}`,
    ),
  cashTopupCard: (num: string, data: {
    clientRef?: string
    cash: number
    credit: number
    note?: string
    cashierId?: string
    cashierName?: string
    shiftId: string
    posId?: string
    appliedLocal?: boolean
    skipBalances?: boolean
    bonusAfter?: number
    posCashBonusAfter?: number
    /** Снимок bonusPayVersion; отказ, если бонусы уже меняли */
    expectedBonusPayVersion?: number
    createdAtIso?: string
  }) => request<{ card: AdminCard; financeMove: FinanceMove }>(
    `/cards/${encodeURIComponent(num.trim())}/cash-topup`,
    { method: 'POST', body: JSON.stringify(data) },
  ),
  debtRepayCard: (num: string, data: {
    clientRef?: string
    amount: number
    method?: 'cash' | 'card'
    note?: string
    cashierId?: string
    cashierName?: string
    shiftId?: string
    posId?: string
    appliedLocal?: boolean
    skipBalances?: boolean
    nextDebt?: number
    /** Снимок debtPayVersion; отказ, если погашения уже меняли */
    expectedDebtPayVersion?: number
  }) => request<{
    card: AdminCard
    amount: number
    method: 'cash' | 'card'
    prevDebt: number
    nextDebt: number
    bonusEarned: number
    till: { shiftId: string | null; salesCash: number | null }
  }>(
    `/cards/${encodeURIComponent(num.trim())}/debt-repay`,
    { method: 'POST', body: JSON.stringify(data) },
  ),

  // ── Отзывы ──
  getReviews: (filter?: string | { restId?: string; productId?: string | number }) =>
    typeof window !== 'undefined'
      ? getReviewsViaAppRoute(filter)
      : request<Review[]>(`/reviews${reviewsQuery(filter)}`),
  createReview: (data: Partial<Review>) =>
    typeof window !== 'undefined'
      ? createReviewViaAppRoute(data)
      : request<Review>('/reviews', { method: 'POST', body: JSON.stringify(data) }, 0, REVIEW_TIMEOUT_MS),
  updateReview: (id: number, data: Partial<Review>) =>
    typeof window !== 'undefined'
      ? updateReviewViaAppRoute(id, data)
      : request<Review>(`/reviews/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteReview: (id: number) =>
    typeof window !== 'undefined'
      ? deleteReviewViaAppRoute(id)
      : request<{ ok: boolean; deleted: number }>(`/reviews/${id}`, { method: 'DELETE' }),
  deleteReviewsBulk: (ids: number[]) =>
    typeof window !== 'undefined'
      ? deleteReviewsBulkViaAppRoute(ids)
      : request<{ ok: boolean; deleted: number }>('/reviews/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }),

  // ── Push ──
  getPushState: () => request<{ autoSettings: import('./pushCrm').PushAutoSetting[]; history: import('./pushCrm').PushCampaign[] }>('/push'),
  updatePushSettings: (data: { autoSettings: import('./pushCrm').PushAutoSetting[] }) =>
    request('/push/settings', { method: 'PATCH', body: JSON.stringify(data) }),
  sendPushCampaign: (campaign: import('./pushCrm').PushCampaign) =>
    request('/push/send', { method: 'POST', body: JSON.stringify(campaign) }),

  getNotifications: (phone?: string) =>
    request<import('./clientNotifications').ClientNotification[]>(
      `/notifications${phone ? `?phone=${encodeURIComponent(phone)}` : ''}`,
    ),
  deliverNotifications: (items: import('./clientNotifications').ClientNotification[]) =>
    request('/notifications/deliver', { method: 'POST', body: JSON.stringify({ items }) }),
  markNotificationRead: (id: string) =>
    request(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' }),
  markAllNotificationsRead: (phone?: string) =>
    request(`/notifications/read-all${phone ? `?phone=${encodeURIComponent(phone)}` : ''}`, { method: 'PATCH', body: JSON.stringify({ phone }) }),

  // ── Админ ──
  getDashboard: () => request<any>('/admin/dashboard'),
  resetOperationalData: (data: { confirm: string; currentPassword: string }) =>
    request<{
      ok: boolean
      backup: string | null
      kept: { employees: number; clients: number; cards: number }
      categories: number
      cleared: string[]
    }>('/admin/reset-operational', {
      method: 'POST',
      body: JSON.stringify(data),
    }, 0, 300_000),
  getFinanceSummary: () => request<any>('/finance/summary'),
  getAdminAiStatus: () =>
    request<{
      configured: boolean
      model: string
      quickPrompts: Array<{ id: string; label: string; icon: string; shortcut: string }>
    }>('/admin/ai/status'),
  askAdminAi: (data: { prompt?: string; quickId?: string }) =>
    request<{
      ok: boolean
      prompt: string
      quickId: string | null
      answer: string
      generatedAt: string
      model: string
    }>('/admin/ai/ask', { method: 'POST', body: JSON.stringify(data) }),

  getAuditLog: (params?: {
    app?: string
    action?: string
    entity?: string
    q?: string
    days?: number
    limit?: number
    offset?: number
  }) => {
    const q = new URLSearchParams()
    if (params?.app) q.set('app', params.app)
    if (params?.action) q.set('action', params.action)
    if (params?.entity) q.set('entity', params.entity)
    if (params?.q) q.set('q', params.q)
    if (params?.days) q.set('days', String(params.days))
    if (params?.limit) q.set('limit', String(params.limit))
    if (params?.offset) q.set('offset', String(params.offset))
    const qs = q.toString()
    return request<{
      retentionDays: number
      total: number
      limit: number
      offset: number
      items: Array<{
        id: string
        atIso: string
        app: 'admin' | 'trade'
        action: string
        entity: string
        entityId?: string
        entityName?: string
        summary: string
        before?: Record<string, unknown>
        after?: Record<string, unknown>
        actor?: { name?: string; role?: string; adminLogin?: string; employeeId?: string }
      }>
    }>(`/audit${qs ? `?${qs}` : ''}`)
  },

  restoreAudit: (id: string) =>
    request<{ ok: boolean; entity: string; row: unknown }>(
      `/audit/${encodeURIComponent(id)}/restore`,
      { method: 'POST' },
    ),

  // ── Сотрудники Торговли ──
  getEmployees: () => request<import('./types').TradeEmployee[]>('/employees'),
  getEmployeesDirectory: () =>
    request<Array<{ id: string; name: string; role: string; roleLabel?: string }>>('/employees/directory'),
  /** Полный список с паролями — кэш локальной кассы для офлайн-входа */
  getEmployeesLocalAuth: () => {
    const id = getTradeDeviceIdSync()
    const q = id ? `?deviceId=${encodeURIComponent(id)}` : ''
    return request<Array<{
      id: string
      name: string
      role: string
      roleLabel?: string
      permissions: string[]
      active: boolean
      password?: string
      passwordHash?: string
    }>>(`/employees/local-auth${q}`)
  },
  createEmployee: (data: {
    name: string
    password: string
    role?: string
    permissions?: string[]
    active?: boolean
  }) => request<import('./types').TradeEmployee>('/employees', { method: 'POST', body: JSON.stringify(data) }),
  updateEmployee: (id: string, data: Partial<{
    name: string
    password: string
    role: string
    permissions: string[]
    active: boolean
  }>) => request<import('./types').TradeEmployee>(`/employees/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),
  deleteEmployee: (id: string) =>
    request<{ id: string }>(`/employees/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  loginEmployee: (data: { id?: string; name?: string; password: string }) =>
    request<import('./types').TradeEmployee & { token: string }>('/employees/login', {
      method: 'POST',
      body: JSON.stringify({ ...data, deviceId: getTradeDeviceIdSync() }),
    }),

  // ── POS / склад ──
  getCashiers: () => request<PosCashier[]>('/cashiers'),
  createCashier: (data: { name: string; pin: string }) =>
    request<PosCashier>('/cashiers', { method: 'POST', body: JSON.stringify(data) }),
  updateCashier: (id: string, data: Partial<PosCashier>) =>
    request<PosCashier>(`/cashiers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getPosPoints: () => request<PosPoint[]>('/pos/points'),
  createPosPoint: (data: { name: string; code?: string; note?: string; receiptPhone?: string }) =>
    request<PosPoint>('/pos/points', { method: 'POST', body: JSON.stringify(data) }),
  updatePosPoint: (id: string, data: Partial<Pick<PosPoint, 'name' | 'code' | 'note' | 'receiptPhone' | 'active'>>) =>
    request<PosPoint>(`/pos/points/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deletePosPoint: (id: string) =>
    request<{ id: string }>(`/pos/points/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  createPosPairCode: (posId: string) =>
    request<{ posId: string; name: string; code: string; expiresAtIso: string }>(
      `/pos/points/${encodeURIComponent(posId)}/pair-code`,
      { method: 'POST', body: '{}' },
    ),
  unbindPosDevice: (posId: string, deviceId: string) =>
    request<PosPoint>(
      `/pos/points/${encodeURIComponent(posId)}/devices/${encodeURIComponent(deviceId)}`,
      { method: 'DELETE' },
    ),
  renamePosDevice: (posId: string, deviceId: string, name: string) =>
    request<PosPoint>(
      `/pos/points/${encodeURIComponent(posId)}/devices/${encodeURIComponent(deviceId)}`,
      { method: 'PATCH', body: JSON.stringify({ name }) },
    ),
  updatePosDevice: (
    posId: string,
    deviceId: string,
    data: { name?: string; revisionParticipationDefault?: boolean },
  ) =>
    request<PosPoint>(
      `/pos/points/${encodeURIComponent(posId)}/devices/${encodeURIComponent(deviceId)}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    ),
  bindPosDevice: (data: { code: string; deviceId: string; deviceName?: string }) =>
    request<{
      point: PosPoint
      device: { id: string; name: string; boundAtIso: string }
    }>('/pos/devices/bind', { method: 'POST', body: JSON.stringify(data) }),
  checkPosDevice: (deviceId: string) =>
    request<{ ok: boolean; point?: PosPoint; device?: { id: string; name: string } }>(
      `/pos/devices/check?deviceId=${encodeURIComponent(deviceId)}`,
    ),
  sendDeviceHeartbeat: (data: TradeDeviceHeartbeatPayload) =>
    request<{ ok: boolean }>('/pos/devices/heartbeat', { method: 'POST', body: JSON.stringify(data) }),
  getPosDeviceStatuses: () =>
    request<TradeDeviceLiveStatus[]>('/pos/devices/status'),
  getPosShifts: () => request<PosShift[]>('/pos/shifts'),
  openPosShift: (data: { clientRef?: string; cashierId: string; openingCash: number; note?: string; posId?: string; cashierName?: string; openedAtIso?: string; expectedVaultVersion?: number }) =>
    request<PosShift>('/pos/shifts/open', { method: 'POST', body: JSON.stringify(data) }),
  closePosShift: (id: string, data: { clientRef?: string; closingCash: number; closingCard?: number; note?: string; closedAtIso?: string }) =>
    request<PosShift>(`/pos/shifts/${id}/close`, { method: 'PATCH', body: JSON.stringify(data) }),
  getPosSales: () => request<PosSale[]>('/pos/sales'),
  createPosSale: (
    data: {
      clientRef?: string
      createdAtIso?: string
      cashierId?: string
      shiftId?: string
      posId?: string
      deviceId?: string
      deviceName?: string
      opSeq?: number
      appliedLocal?: boolean
      skipBalances?: boolean
      clientDebtAfter?: number
      walletAfter?: number
      bonusAfter?: number
      clientId?: string
      clientName?: string
      clientPhone?: string
      cardNum?: string
      paymentMethod: 'cash' | 'card' | 'credit' | 'wallet' | 'mixed'
      paidCash?: number
      paidCard?: number
      paidWallet?: number
      debtAdded?: number
      expectedDebtPayVersion?: number
      expectedBonusPayVersion?: number
      cashReceived?: number
      changeGiven?: number
      bonusSpent?: number
      bonusEarned?: number
      bonusBalanceBefore?: number
      bonusBalanceAfter?: number
      orderGoodsTotal?: number
      discountAmount?: number
      note?: string
      items: { productId: number; productName?: string; qty: number; price?: number; unit?: string; receiptId?: string; preferRetailPrice?: number }[]
    },
    opts?: { mode?: 'fast' | 'sync' },
  ) => {
    const sync = opts?.mode === 'sync'
    // fast: касса не ждёт; sync: очередь офлайн-чеков (дольше + 1 повтор)
    return requestUrl<PosSale & { orderId?: string }>(
      `${getApiUrl()}/pos/sales`,
      { method: 'POST', body: JSON.stringify(data) },
      sync ? 0 : 1,
      sync ? 20000 : POS_SALE_TIMEOUT_MS,
    )
  },
  returnPosSale: (id: string, data?: {
    clientRef?: string
    note?: string
    cashierId?: string
    items?: { index?: number; productId?: number; qty: number }[]
    appliedLocal?: boolean
    skipStock?: boolean
    skipBalances?: boolean
    queuedOffline?: boolean
    clientDebtAfter?: number
    cutDebt?: number
    expectedDebtPayVersion?: number
    expectedBonusPayVersion?: number
  }) =>
    request<PosSale>(`/pos/sales/${encodeURIComponent(id)}/return`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),
  getStockReceipts: () => request<StockReceipt[]>('/stock/receipts'),
  createStockReceipt: (data: {
    clientRef?: string
    supplierId?: string
    createdBy?: string
    paidNow?: number
    createdAtIso?: string
    expectedSupplyVersion?: number
    items: { productId: number; qty: number; costPrice?: number; retailPrice?: number; bulkPricing?: { minQty: number; price: number }[]; expiryDate?: string | null }[]
  }) => request<StockReceipt>('/stock/receipts', { method: 'POST', body: JSON.stringify(data) }),
  updateStockReceipt: (id: string, data: {
    clientRef?: string
    supplierId?: string
    paidNow?: number
    expectedSupplyVersion?: number
    items: { productId: number; qty: number; costPrice?: number; retailPrice?: number; bulkPricing?: { minQty: number; price: number }[]; expiryDate?: string | null }[]
  }) => request<StockReceipt>(`/stock/receipts/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteStockReceipt: (id: string, data?: { clientRef?: string }) =>
    request<{ id: string }>(`/stock/receipts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: data ? JSON.stringify(data) : undefined,
    }),
  getStockWriteoffs: () => request<StockWriteoff[]>('/stock/writeoffs'),
  createStockWriteoff: (data: {
    clientRef?: string
    reason: string
    note?: string
    createdBy?: string
    createdAtIso?: string
    items: { productId: number; qty: number }[]
  }) => request<StockWriteoff>('/stock/writeoffs', { method: 'POST', body: JSON.stringify(data) }),
  updateStockWriteoff: (id: string, data: {
    clientRef?: string
    reason: string
    note?: string
    createdBy?: string
    items: { productId: number; qty: number }[]
  }) => request<StockWriteoff>(`/stock/writeoffs/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteStockWriteoff: (id: string, data?: { clientRef?: string }) =>
    request<{ id: string }>(`/stock/writeoffs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: data ? JSON.stringify(data) : undefined,
    }),
  getStockRevisions: () => request<StockRevision[]>('/stock/revisions'),
  getStockRevisionQueue: () => request<Array<{
    id: string
    createdAtIso: string
    submittedAtIso?: string
    status?: StockRevision['status']
    note?: string
    waitDevices?: StockRevision['waitDevices']
    itemCount: number
  }>>('/stock/revisions/queue'),
  cancelStockRevision: (id: string) =>
    request<StockRevision>(`/stock/revisions/${encodeURIComponent(id)}/cancel`, { method: 'PATCH' }),
  createStockRevision: (data: {
    clientRef?: string
    createdAtIso?: string
    submittedAtIso?: string
    createdBy?: string
    note?: string
    sourceDeviceId?: string
    waitDevices?: RevisionWaitDevice[]
    posCuts?: RevisionPosCut[]
    items: { productId: number; countedStock: number; systemStock?: number }[]
  }) => request<StockRevision>('/stock/revisions', { method: 'POST', body: JSON.stringify(data) }),
  updateStockRevision: (id: string, data: {
    clientRef?: string
    createdAtIso?: string
    submittedAtIso?: string
    createdBy?: string
    note?: string
    sourceDeviceId?: string
    waitDevices?: RevisionWaitDevice[]
    posCuts?: RevisionPosCut[]
    items: { productId: number; countedStock: number; systemStock?: number }[]
  }) => request<StockRevision>(`/stock/revisions/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteStockRevision: (id: string, data?: { clientRef?: string }) =>
    request<{ id: string }>(`/stock/revisions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: data ? JSON.stringify(data) : undefined,
    }),
  getStockExpiry: (days = 14) =>
    request<Array<{
      receiptId: string
      receiptCreatedAtIso?: string
      productId: number
      productName: string
      qty: number
      costPrice?: number
      retailPrice?: number
      expiryDate: string
      daysLeft: number
    }>>(`/stock/expiry?days=${days}`),
  getSuppliers: () => request<PosSupplier[]>('/suppliers'),
  createSupplier: (data: { name: string; category?: string; phone?: string; address?: string; note?: string }) =>
    request<PosSupplier>('/suppliers', { method: 'POST', body: JSON.stringify(data) }),
  updateSupplier: (id: string, data: Partial<PosSupplier>) =>
    request<PosSupplier>(`/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteSupplier: (id: string, data?: { clientRef?: string }) =>
    request<{ id: string }>(`/suppliers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: data ? JSON.stringify(data) : undefined,
    }),
  getSupplierPayments: (id: string) =>
    request<SupplierPayment[]>(`/suppliers/${encodeURIComponent(id)}/payments`),
  createSupplierPayment: (id: string, data: {
    amount: number
    note?: string
    clientRef?: string
    /** Снимок payVersion; сервер отклонит, если оплаты уже меняли */
    expectedPayVersion?: number
  }) =>
    request<SupplierPayment>(`/suppliers/${id}/payments`, { method: 'POST', body: JSON.stringify(data) }),
  deleteSupplierPayment: (id: string, paymentId: string, data?: {
    clientRef?: string
    expectedPayVersion?: number
  }) =>
    request<{ id: string }>(`/suppliers/${encodeURIComponent(id)}/payments/${encodeURIComponent(paymentId)}`, {
      method: 'DELETE',
      body: data ? JSON.stringify(data) : undefined,
    }),
  getExpenses: () => request<PosExpense[]>('/expenses'),
  createExpense: (data: { category: string; amount: number; note?: string; createdBy?: string; shiftId?: string; clientRef?: string }) =>
    request<PosExpense>('/expenses', { method: 'POST', body: JSON.stringify(data) }),
  deleteExpense: (id: string, data?: { clientRef?: string }) =>
    request<{ id: string }>(`/expenses/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: data ? JSON.stringify(data) : undefined,
    }),
  getFinanceMoves: () => request<FinanceMove[]>('/finance/moves'),
  createFinanceMove: (data: {
    clientRef?: string
    type: 'deposit' | 'withdraw'
    amount: number
    note?: string
    createdBy?: string
    cashierId?: string
    cashierName?: string
    shiftId?: string
    posId?: string
    supplierId?: string
    /** Снимок payVersion при оплате поставщику с кассы */
    expectedPayVersion?: number
    /** Снимок vaultVersion при движении из основного ящика */
    expectedVaultVersion?: number
    payFrom?: 'shift' | 'vault'
    method?: 'cash' | 'card'
    reason?: string
  }) => request<FinanceMove>('/finance/moves', { method: 'POST', body: JSON.stringify(data) }),
  deleteFinanceMove: (id: string, data?: { clientRef?: string }) =>
    request<{ id: string }>(`/finance/moves/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: data ? JSON.stringify(data) : undefined,
    }),
  getPosFinanceSummary: () => request<any>('/finance/pos-summary'),
  getFinanceTruth: (q?: Record<string, string>) => {
    const qs = q ? new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== '')).toString() : ''
    return request<import('./types').FinanceTruthBundle>(`/finance/truth${qs ? `?${qs}` : ''}`)
  },
  getFinanceCashBook: (q?: Record<string, string>) => {
    const qs = q ? new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== '')).toString() : ''
    return request<import('./types').FinanceTruthBundle['cashBook']>(`/finance/cashbook${qs ? `?${qs}` : ''}`)
  },
  getFinanceExpectedVsActual: (q?: Record<string, string>) => {
    const qs = q ? new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== '')).toString() : ''
    return request<import('./types').FinanceTruthBundle['expectedVsActual']>(
      `/finance/expected-vs-actual${qs ? `?${qs}` : ''}`,
    )
  },
  getFinanceProfit: (q?: Record<string, string>) => {
    const qs = q ? new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== '')).toString() : ''
    return request<import('./types').FinanceTruthBundle['profit']>(`/finance/profit${qs ? `?${qs}` : ''}`)
  },
  getFinanceJournal: (q?: Record<string, string>) => {
    const qs = q ? new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== '')).toString() : ''
    return request<{ rows: import('./types').MoneyLedgerEntry[]; count: number }>(
      `/finance/journal${qs ? `?${qs}` : ''}`,
    )
  },
  getFinanceAlerts: (q?: Record<string, string>) => {
    const qs = q ? new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== '')).toString() : ''
    return request<import('./types').FinanceTruthBundle['alerts']>(`/finance/alerts${qs ? `?${qs}` : ''}`)
  },
  getCashVault: () => request<import('./types').CashVault>('/finance/vault'),
  convertVaultCardToCash: (data: { amount: number; note?: string; clientRef?: string; expectedVaultVersion?: number }) =>
    request<{ id: string; amount: number }>(
      '/finance/vault/card-to-cash',
      { method: 'POST', body: JSON.stringify(data) },
    ),
  convertVaultCashToCard: (data: { amount: number; note?: string; clientRef?: string; expectedVaultVersion?: number }) =>
    request<{ id: string; amount: number }>(
      '/finance/vault/cash-to-card',
      { method: 'POST', body: JSON.stringify(data) },
    ),
  getCashBox: (q?: Record<string, string>) => {
    const qs = q ? new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== '')).toString() : ''
    return request<import('./types').CashBoxSnapshot>(`/finance/cashbox${qs ? `?${qs}` : ''}`)
  },
  getPosReport: () => request<any>('/reports/pos'),

  // ── Синхронизация ──
  syncWoo: () => request('/sync/woocommerce', { method: 'POST' }),
}
