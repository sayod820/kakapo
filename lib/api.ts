// ════════════════════════════════════════════════
// KAKAPO — API клиент (связь с backend)
// ════════════════════════════════════════════════
import type { Order, Product, Restaurant, Category } from './types'
import type { PickupPoint } from './pickups'
import type { PricingConfig } from './courierData'
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

async function parseErrorResponse(res: Response): Promise<string> {
  const text = await res.text()
  if (!text) return formatApiError(null, res.status)
  try {
    const json = JSON.parse(text)
    return formatApiError(json.detail ?? json.message ?? json, res.status) || text.slice(0, 160)
  } catch {
    return formatApiError(text, res.status) || text.slice(0, 160)
  }
}

const RETRY_STATUS = new Set([500, 502, 503, 504])

async function request<T>(path: string, options: RequestInit = {}, attempt = 0): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`${getApiUrl()}${path}`, { ...options, headers })
  } catch {
    throw new Error('Нет связи с сервером. Проверьте интернет.')
  }

  if (!res.ok) {
    const message = await parseErrorResponse(res)
    if (RETRY_STATUS.has(res.status) && attempt < 2) {
      await new Promise(r => setTimeout(r, 1200 * (attempt + 1)))
      return request<T>(path, options, attempt + 1)
    }
    throw new Error(message || `Ошибка ${res.status}`)
  }
  return res.json()
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
    request<{ access_token: string; role: string; user_id: number; name: string }>('/auth/otp/verify', {
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
  updateOrderStatus: (id: string | number, status: string) =>
    request<Order>(`/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),

  // ── Рестораны ──
  getRestaurants: () => request<Restaurant[]>('/restaurants'),
  getRestaurant: (id: string | number) => request<Restaurant>(`/restaurants/${id}`),
  toggleRestaurant: (id: string) => request(`/restaurants/${id}/toggle`, { method: 'PATCH' }),
  setCommission: (id: string, commission: number) =>
    request(`/restaurants/${id}/commission?commission=${commission}`, { method: 'PATCH' }),
  toggleMenuStock: (itemId: number) => request(`/restaurants/menu/${itemId}/stock`, { method: 'PATCH' }),

  // ── Точки забора ──
  getPickups: () => request<PickupPoint[]>('/pickups'),
  updatePickup: (id: string, data: Partial<PickupPoint>) =>
    request<PickupPoint>(`/pickups/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // ── Тариф доставки ──
  getPricing: () => request<PricingConfig>('/settings/pricing'),
  updatePricing: (data: Partial<PricingConfig>) =>
    request<PricingConfig>('/settings/pricing', { method: 'PATCH', body: JSON.stringify(data) }),

  // ── Карты ──
  getCards: () => request<any[]>('/cards'),
  generateCards: (count: number) => request(`/cards/generate?count=${count}`, { method: 'POST' }),

  // ── Отзывы ──
  getReviews: () => request<any[]>('/reviews'),
  createReview: (data: any) => request('/reviews', { method: 'POST', body: JSON.stringify(data) }),

  // ── Админ ──
  getDashboard: () => request<any>('/admin/dashboard'),

  // ── Синхронизация ──
  syncWoo: () => request('/sync/woocommerce', { method: 'POST' }),
  syncGBS: () => request('/sync/gbs', { method: 'POST' }),
}
