// ════════════════════════════════════════════════
// KAKAPO — общий стейт (Zustand) + связь с API
// ════════════════════════════════════════════════
import { create } from 'zustand'
import type { Order, OrderStatus, Product, Restaurant, MenuItem } from './types'
import { INITIAL_ORDERS, PRODUCTS, RESTAURANTS } from './data'
import { api, setToken } from './api'

// Если true — использует backend API. Если false — локальные демо-данные.
const USE_API = process.env.NEXT_PUBLIC_USE_API === 'true'

// ── CART ─────────────────────────────────────────
interface CartItem { productId: number; name: string; emoji: string; price: number; qty: number }
interface CartStore {
  items: Record<string, CartItem>
  add: (id: string, price: number, name: string, emoji: string) => void
  remove: (id: string) => void
  clear: () => void
  total: () => number
  count: () => number
}
export const useCart = create<CartStore>((set, get) => ({
  items: {},
  add: (id, price, name, emoji) => set(s => ({
    items: { ...s.items, [id]: { productId: Number(id), name, emoji, price, qty: (s.items[id]?.qty || 0) + 1 } }
  })),
  remove: (id) => set(s => {
    const n = { ...s.items }
    if (n[id] && n[id].qty > 1) n[id] = { ...n[id], qty: n[id].qty - 1 }
    else delete n[id]
    return { items: n }
  }),
  clear: () => set({ items: {} }),
  total: () => Object.values(get().items).reduce((s, i) => s + i.price * i.qty, 0),
  count: () => Object.values(get().items).reduce((s, i) => s + i.qty, 0),
}))

// ── ORDERS (общий между всеми приложениями) ──────
interface OrdersStore {
  orders: Order[]
  loading: boolean
  fetchOrders: () => Promise<void>
  fetchAssemblerOrders: () => Promise<void>
  fetchCourierOrders: () => Promise<void>
  createOrder: (data: any) => Promise<Order | null>
  addOrder: (order: Order) => void
  updateStatus: (id: string, status: OrderStatus) => Promise<void>
  toggleItem: (orderId: string, itemId: number) => void
  getByStatus: (status: OrderStatus | OrderStatus[]) => Order[]
  getByType: (type: 'market' | 'restaurant') => Order[]
}
export const useOrders = create<OrdersStore>((set, get) => ({
  orders: INITIAL_ORDERS,
  loading: false,

  fetchOrders: async () => {
    if (!USE_API) return
    set({ loading: true })
    try { set({ orders: await api.getOrders() }) }
    catch (e) { console.error(e) }
    finally { set({ loading: false }) }
  },

  fetchAssemblerOrders: async () => {
    if (!USE_API) return
    try { set({ orders: await api.getAssemblerOrders() }) } catch (e) { console.error(e) }
  },

  fetchCourierOrders: async () => {
    if (!USE_API) return
    try { set({ orders: await api.getCourierOrders() }) } catch (e) { console.error(e) }
  },

  createOrder: async (data) => {
    if (USE_API) {
      try {
        const order = await api.createOrder(data)
        set(s => ({ orders: [order, ...s.orders] }))
        return order
      } catch (e) { console.error(e); return null }
    } else {
      const order = { ...data, id: `K-${Date.now()}`, code: `K-${Date.now()}`, status: 'new', createdAt: new Date().toISOString() }
      set(s => ({ orders: [order, ...s.orders] }))
      return order
    }
  },

  addOrder: (order) => set(s => ({ orders: [order, ...s.orders] })),

  updateStatus: async (id, status) => {
    if (USE_API) {
      try { await api.updateOrderStatus(Number(id), status) } catch (e) { console.error(e) }
    }
    set(s => ({ orders: s.orders.map(o => o.id === id || (o as any).code === id ? { ...o, status } : o) }))
  },

  toggleItem: (orderId, itemId) => set(s => ({
    orders: s.orders.map(o => o.id === orderId
      ? { ...o, items: o.items.map(it => it.id === itemId ? { ...it, done: !it.done } : it) }
      : o)
  })),

  getByStatus: (status) => {
    const arr = Array.isArray(status) ? status : [status]
    return get().orders.filter(o => arr.includes(o.status))
  },
  getByType: (type) => get().orders.filter(o => o.type === type),
}))

// ── PRODUCTS ─────────────────────────────────────
interface ProductsStore {
  products: Product[]
  fetchProducts: () => Promise<void>
  updateProduct: (id: number, updates: Partial<Product>) => void
  addProduct: (p: Product) => void
  removeProduct: (id: number) => void
}
export const useProducts = create<ProductsStore>((set) => ({
  products: PRODUCTS,
  fetchProducts: async () => {
    if (!USE_API) return
    try { set({ products: await api.getProducts() }) } catch (e) { console.error(e) }
  },
  updateProduct: (id, updates) => set(s => ({
    products: s.products.map(p => p.id === id ? { ...p, ...updates } : p)
  })),
  addProduct: (p) => set(s => ({ products: [...s.products, p] })),
  removeProduct: (id) => set(s => ({ products: s.products.filter(p => p.id !== id) })),
}))

// ── RESTAURANTS ──────────────────────────────────
interface RestaurantsStore {
  restaurants: Restaurant[]
  fetchRestaurants: () => Promise<void>
  toggleOpen: (id: string) => void
  updateCommission: (id: string, commission: number) => void
  toggleMenuItem: (restId: string, menuId: number) => void
}
export const useRestaurants = create<RestaurantsStore>((set) => ({
  restaurants: RESTAURANTS,
  fetchRestaurants: async () => {
    if (!USE_API) return
    try { set({ restaurants: await api.getRestaurants() }) } catch (e) { console.error(e) }
  },
  toggleOpen: (id) => set(s => ({
    restaurants: s.restaurants.map(r => r.id === id ? { ...r, open: !r.open } : r)
  })),
  updateCommission: (id, commission) => set(s => ({
    restaurants: s.restaurants.map(r => r.id === id ? { ...r, commission } : r)
  })),
  toggleMenuItem: (restId, menuId) => set(s => ({
    restaurants: s.restaurants.map(r => r.id !== restId ? r : {
      ...r, menu: r.menu.map(m => m.id === menuId ? { ...m, inStock: !m.inStock } : m)
    })
  })),
}))

// ── AUTH ─────────────────────────────────────────
interface AuthStore {
  token: string | null
  role: string | null
  userId: number | null
  name: string
  sendOTP: (phone: string) => Promise<boolean>
  verifyOTP: (phone: string, code: string) => Promise<boolean>
  login: (email: string, password: string) => Promise<boolean>
  logout: () => void
}
export const useAuth = create<AuthStore>((set) => ({
  token: null, role: null, userId: null, name: '',

  sendOTP: async (phone) => {
    if (!USE_API) return true
    try { await api.sendOTP(phone); return true } catch { return false }
  },

  verifyOTP: async (phone, code) => {
    if (!USE_API) {
      if (code === '1234') { set({ role: 'client', name: 'Демо' }); return true }
      return false
    }
    try {
      const r = await api.verifyOTP(phone, code)
      setToken(r.access_token)
      set({ token: r.access_token, role: r.role, userId: r.user_id, name: r.name })
      return true
    } catch { return false }
  },

  login: async (email, password) => {
    if (!USE_API) {
      if (password === 'admin123' || password === 'rest123') { set({ role: 'admin' }); return true }
      return false
    }
    try {
      const r = await api.login(email, password)
      setToken(r.access_token)
      set({ token: r.access_token, role: r.role, userId: r.user_id, name: r.name })
      return true
    } catch { return false }
  },

  logout: () => { setToken(null); set({ token: null, role: null, userId: null, name: '' }) },
}))
