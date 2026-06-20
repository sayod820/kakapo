// ════════════════════════════════════════════════
// KAKAPO — API клиент (связь с backend)
// ════════════════════════════════════════════════
import type { Order, Product, Restaurant, Category, Promo, RestaurantPayout, Review } from './types'
import type { PickupPoint } from './pickups'
import type { PricingConfig } from './courierData'
import type { AdminCourier } from './courierTeam'
import type { AdminAssembler } from './assemblerTeam'
import type { AdminClient } from './clientCrm'
import type { AdminCard } from './cardCrm'
import { getApiUrl } from './config'

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
      return 'Сервер временно недоступен. Подождите 5 сек и попробуйте снова.'
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
      return 'На сервере нет удаления клиентов — обновите backend на Render'
    }
    if (/Cannot POST/i.test(msg)) {
      return 'На сервере нет этого API — обновите backend на Render'
    }
    return msg.slice(0, 200)
  }
  if (/Cannot DELETE/i.test(text)) {
    return 'На сервере нет удаления клиентов — обновите backend на Render'
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
const REQUEST_TIMEOUT_MS = 15000
/** Render free tier: первый запрос после простоя может идти 30–90 с */
const COLD_START_TIMEOUT_MS = 50000
const COLD_START_MAX_ATTEMPTS = 3
/** Render free tier cold start может занимать 30–60 с */
const GET_TIMEOUT_MS = 45000

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

async function requestColdStart<T>(path: string, options: RequestInit = {}): Promise<T> {
  return request<T>(path, options, 0, COLD_START_TIMEOUT_MS)
}

/** Маршруты Next.js вне proxy /api/kakapo → Render */
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
    if (timedOut && attempt < COLD_START_MAX_ATTEMPTS - 1) {
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
      return requestUrl<T>(url, options, attempt + 1, timeoutMs)
    }
    if (timedOut) {
      throw new Error('Сервер Render просыпается — подождите до минуты и обновите страницу.')
    }
    throw new Error('Нет связи с сервером. Проверьте интернет.')
  }

  if (!res.ok) {
    const message = await parseErrorResponse(res)
    if (RETRY_STATUS.has(res.status) && attempt < 2) {
      await new Promise(r => setTimeout(r, 1200 * (attempt + 1)))
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

  getAssemblers: () => request<AdminAssembler[]>('/assemblers'),
  createAssembler: (data: Partial<AdminAssembler>) =>
    request<AdminAssembler>('/assemblers', { method: 'POST', body: JSON.stringify(data) }),
  updateAssembler: (id: string, data: Partial<AdminAssembler>) =>
    request<AdminAssembler>(`/assemblers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  getClients: () => requestColdStart<AdminClient[]>('/clients'),
  createClient: (data: Partial<AdminClient>) =>
    request<AdminClient>('/clients', { method: 'POST', body: JSON.stringify(data) }),
  updateClient: (id: string, data: Partial<AdminClient>) =>
    request<AdminClient>(`/clients/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteClient: (id: string, phone?: string) =>
    requestApp<{ ok: boolean }>(`/api/kakapo/clients/${encodeURIComponent(id)}/delete`, {
      method: 'POST',
      body: JSON.stringify({ phone: phone ? phone.replace(/\D/g, '').slice(-9) : '' }),
    }),
  deleteClientByPhone: (phone: string) => {
    const digits = (phone || '').replace(/\D/g, '').slice(-9)
    return requestApp<{ ok: boolean }>('/api/kakapo/clients/delete-by-phone', {
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

  // ── Карты ──
  getCards: () => requestColdStart<AdminCard[]>('/cards'),
  generateCards: (count: number) =>
    request<{ ok: boolean; count: number; cards: AdminCard[] }>(`/cards/generate?count=${count}`, { method: 'POST' }),
  ensureCard: (data: Partial<AdminCard> & { num: string; clientId?: string }) =>
    request<AdminCard>('/cards/ensure', { method: 'POST', body: JSON.stringify(data) }),
  updateCard: (num: string, data: Partial<AdminCard> & { unlink?: boolean }) =>
    request<AdminCard>(`/cards/${encodeURIComponent(num.trim())}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // ── Отзывы ──
  getReviews: (restId?: string) =>
    request<Review[]>(`/reviews${restId ? `?restId=${encodeURIComponent(restId)}` : ''}`),
  createReview: (data: Partial<Review>) =>
    request<Review>('/reviews', { method: 'POST', body: JSON.stringify(data) }),
  updateReview: (id: number, data: Partial<Review>) =>
    request<Review>(`/reviews/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

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
