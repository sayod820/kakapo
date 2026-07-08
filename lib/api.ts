// ════════════════════════════════════════════════
// KAKAPO — API клиент (связь с backend)
// ════════════════════════════════════════════════
import type { Order, Product, Restaurant, Category, Promo, RestaurantPayout, Review } from './types'
import type { PickupPoint } from './pickups'
import type { PricingConfig } from './courierData'
import type { AdminCourier } from './courierTeam'
import type { CourierWalletSnapshot } from './courierWalletTx'
import type { AdminAssembler } from './assemblerTeam'
import type { AdminClient } from './clientCrm'
import type { AdminCard } from './cardCrm'
import { getApiUrl } from './config'

// ── KAKAPO Ритейл: точки продаж / склад ──
export interface RetailLocation {
  id: string
  name: string
  address: string
  type: 'shop' | 'warehouse'
  isActive: boolean
}
export interface StockBatch {
  id: string
  productId: number
  productName: string
  locationId: string
  quantity: number
  expiryDate: string | null
  costPrice: number
  supplierId: string | null
  receivedAtIso: string
}
export interface StockRevisionItem { productId: number; name: string; systemStock: number; countedStock: number; diff: number }
export interface StockRevision {
  id: string
  locationId: string
  items: StockRevisionItem[]
  createdAtIso: string
  createdBy: string
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
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
}

async function parseErrorResponse(res: Response): Promise<string> {
  const text = await res.text()
  if (!text) return formatApiError(null, res.status)
  try {
    const json = JSON.parse(text)
    return formatApiError(json.detail ?? json.message ?? json, res.status) || text.slice(0, 160)
  } catch {
    const plain = stripHtmlError(text)
    return formatApiError(plain, res.status) || plain
  }
}

const RETRY_STATUS = new Set([500, 502, 503, 504])
const REQUEST_TIMEOUT_MS = 25000
const LIST_TIMEOUT_MS = 35000
const REVIEW_TIMEOUT_MS = 45000
const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 5000

function withTimeout<T>(promise: Promise<T>, ms = REQUEST_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Сервер не отвечает. Попробуйте ещё раз.')), ms)
    promise.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  let res: Response
  try {
    res = await withTimeout(fetch(url, { ...options, headers }), timeoutMs)
  } catch (e) {
    const timedOut = e instanceof Error && e.message.includes('Сервер не отвечает')
    if (timedOut && attempt < MAX_ATTEMPTS - 1) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)))
      return requestUrl<T>(url, options, attempt + 1, timeoutMs)
    }
    if (timedOut) {
      throw new Error('Сервер не отвечает. Подождите немного и обновите страницу.')
    }
    throw new Error('Нет связи с сервером. Проверьте интернет.')
  }

  if (!res.ok) {
    const message = await parseErrorResponse(res)
    if (RETRY_STATUS.has(res.status) && attempt < MAX_ATTEMPTS - 1) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)))
      return requestUrl<T>(url, options, attempt + 1, timeoutMs)
    }
    throw new Error(message || `Ошибка ${res.status}`)
  }
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

  // ── Товары ──
  getProducts: (params?: { category_id?: number; search?: string; hot?: boolean }) => {
    const q = new URLSearchParams()
    if (params?.category_id) q.set('category_id', String(params.category_id))
    if (params?.search) q.set('search', params.search)
    if (params?.hot !== undefined) q.set('hot', String(params.hot))
    return request<Product[]>(`/products?${q}`)
  },
  getProduct: (id: number) => request<Product>(`/products/${id}`),
  createProduct: (data: any) => request<Product>('/products', { method: 'POST', body: JSON.stringify(data) }),
  updateProduct: (id: number, data: any) => request<Product>(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteProduct: (id: number) => request(`/products/${id}`, { method: 'DELETE' }),

  // ── Категории ──
  getCategories: (parent_id?: number) =>
    request<Category[]>(`/categories${parent_id !== undefined ? `?parent_id=${parent_id}` : ''}`),
  getCategoriesTree: () => request<any[]>('/categories/tree'),
  createCategory: (data: any) => request('/categories', { method: 'POST', body: JSON.stringify(data) }),
  deleteCategory: (id: number) => request(`/categories/${id}`, { method: 'DELETE' }),

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
  toggleRestaurant: (id: string) => request(`/restaurants/${id}/toggle`, { method: 'PATCH' }),
  updateRestaurant: (id: string, data: Partial<Restaurant>) =>
    request<Restaurant>(`/restaurants/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
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

  // ── KAKAPO Ритейл: точки продаж ──
  getLocations: () => request<RetailLocation[]>('/locations'),
  createLocation: (data: { name: string; address?: string; type?: 'shop' | 'warehouse' }) =>
    request<RetailLocation>('/locations', { method: 'POST', body: JSON.stringify(data) }),
  updateLocation: (id: string, data: Partial<RetailLocation>) =>
    request<RetailLocation>(`/locations/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // ── KAKAPO Ритейл: склад ──
  stockIncome: (data: {
    locationId: string
    supplierId?: string
    items: { productId: number; qty: number; costPrice?: number; expiryDate?: string | null }[]
    createdBy?: string
  }) => request<{ id: string; totalCost: number; batches: StockBatch[] }>('/stock/income', { method: 'POST', body: JSON.stringify(data) }),
  stockWriteoff: (data: { locationId: string; items: { productId: number; qty: number }[]; reason: string; createdBy?: string }) =>
    request<{ id: string }>('/stock/writeoff', { method: 'POST', body: JSON.stringify(data) }),
  stockTransfer: (data: { fromLocationId: string; toLocationId: string; items: { productId: number; qty: number }[]; createdBy?: string }) =>
    request<{ id: string }>('/stock/transfer', { method: 'POST', body: JSON.stringify(data) }),
  stockInventory: (data: { locationId: string; items: { productId: number; countedStock: number }[]; createdBy?: string }) =>
    request<StockRevision>('/stock/inventory', { method: 'POST', body: JSON.stringify(data) }),
  getStockBatches: (expiringSoon?: boolean) =>
    request<StockBatch[]>(`/stock/batches${expiringSoon ? '?expiring_soon=true' : ''}`),

  getClients: () => requestLongList<AdminClient[]>('/clients'),
  getDeletedPhones: () =>
    request<{ phones: string[] }>('/clients/deleted-phones').catch(() => ({ phones: [] as string[] })),
  purgeDemoClients: () =>
    request<{ ok: boolean; removed: number }>('/clients/purge-demo', { method: 'POST' }),
  createClient: (data: Partial<AdminClient>) =>
    request<AdminClient>('/clients', { method: 'POST', body: JSON.stringify(data) }),
  updateClient: (id: string, data: Partial<AdminClient>) =>
    request<AdminClient>(`/clients/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  purgeClient: (id: string) =>
    request<{ ok: boolean } | AdminClient>(`/clients/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ purge: true }),
    }),
  deleteClient: (id: string, phone?: string) =>
    request<{ ok: boolean }>(`/clients/${encodeURIComponent(id)}/delete`, {
      method: 'POST',
      body: JSON.stringify({ phone: phone ? phone.replace(/\D/g, '').slice(-9) : '' }),
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
    gbs: { enabled: boolean; ip: string; port: string; user: string; pass: string }
    sms: { provider: string; apiKey: string }
    store: Record<string, string>
  }>('/settings/admin'),
  updateAdminSettings: (data: {
    gbs?: Record<string, unknown>
    sms?: Record<string, unknown>
    store?: Record<string, unknown>
  }) => request('/settings/admin', { method: 'PATCH', body: JSON.stringify(data) }),
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
  getFinanceSummary: () => request<any>('/finance/summary'),

  // ── Синхронизация ──
  syncWoo: () => request('/sync/woocommerce', { method: 'POST' }),
  syncGBS: () => request('/sync/gbs', { method: 'POST' }),
}
