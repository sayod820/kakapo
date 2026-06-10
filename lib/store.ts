'use client'
import { create } from 'zustand'
import type { Order, OrderStatus, Product, Restaurant } from './types'
import { INITIAL_ORDERS, PRODUCTS, RESTAURANTS } from './data'
import { api, setToken, getToken } from './api'
import { USE_API } from './config'

export { USE_API }

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

// ── ORDERS ───────────────────────────────────────
const ORDERS_STORAGE_KEY = 'kakapo_orders_v1'

function loadStoredOrders(): Order[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(ORDERS_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Order[]) : null
  } catch { return null }
}

function saveStoredOrders(orders: Order[]) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(orders)) } catch { /* quota */ }
}

function patchOrders(
  set: (partial: Partial<{ orders: Order[] }> | ((state: { orders: Order[] }) => Partial<{ orders: Order[] }>)) => void,
  get: () => { orders: Order[] },
  updater: Order[] | ((orders: Order[]) => Order[]),
) {
  const next = typeof updater === 'function' ? updater(get().orders) : updater
  set({ orders: next })
  saveStoredOrders(next)
}

const COURIER_VISIBLE = new Set<OrderStatus>([
  'new', 'assembling', 'assembler_done', 'cooking', 'ready',
  'courier_picked', 'delivering',
])

async function loadCourierOrdersFromApi(): Promise<Order[]> {
  let list = await api.getCourierOrders()
  if (!list.length) {
    list = await api.getOrders()
    list = list.filter(o => COURIER_VISIBLE.has(o.status))
  }
  return list
}

async function loadAssemblerOrdersFromApi(): Promise<Order[]> {
  let list = await api.getAssemblerOrders()
  if (!list.length) {
    list = await api.getOrders()
    list = list.filter(o => o.type === 'market' && (o.status === 'new' || o.status === 'assembling'))
  }
  return list
}

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
  orders: USE_API ? (loadStoredOrders() ?? []) : (loadStoredOrders() ?? INITIAL_ORDERS),
  loading: false,

  fetchOrders: async () => {
    if (!USE_API) return
    set({ loading: true })
    try {
      const orders = await api.getOrders()
      patchOrders(set, get, orders)
    } catch (e) { console.error(e) }
    finally { set({ loading: false }) }
  },

  fetchAssemblerOrders: async () => {
    if (!USE_API) return
    try {
      const orders = await loadAssemblerOrdersFromApi()
      patchOrders(set, get, orders)
    } catch (e) { console.error(e) }
  },

  fetchCourierOrders: async () => {
    if (!USE_API) return
    try {
      const orders = await loadCourierOrdersFromApi()
      patchOrders(set, get, orders)
    } catch (e) { console.error(e) }
  },

  createOrder: async (data) => {
    if (USE_API) {
      try {
        const order = await api.createOrder(data)
        patchOrders(set, get, s => [order, ...s])
        return order
      } catch (e) {
        console.error(e)
        return null
      }
    }
    const order: Order = {
      ...data,
      id: `K-${Date.now()}`,
      status: 'new',
      createdAt: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      client: data.client || { name: data.client_name, phone: data.client_phone, addr: data.address },
      items: data.items || [],
      total: data.total || 0,
      deliveryFee: data.deliveryFee,
      pickupIds: data.pickupIds,
      weightKg: data.weightKg,
    }
    patchOrders(set, get, s => [order, ...s])
    return order
  },

  addOrder: (order) => patchOrders(set, get, s => [order, ...s]),

  updateStatus: async (id, status) => {
    if (USE_API) {
      try {
        const updated = await api.updateOrderStatus(id, status)
        patchOrders(set, get, s => s.map(o => o.id === id ? { ...o, ...updated, status } : o))
        return
      } catch (e) { console.error(e) }
    }
    patchOrders(set, get, s => s.map(o => o.id === id ? { ...o, status } : o))
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
  saveProduct: (data: Partial<Product> & { art?: string; id?: number }) => Promise<Product | null>
  updateProduct: (id: number, updates: Partial<Product>) => void
  addProduct: (p: Product) => void
  removeProduct: (id: number) => Promise<void>
}
export const useProducts = create<ProductsStore>((set, get) => ({
  products: PRODUCTS,

  fetchProducts: async () => {
    if (!USE_API) return
    try { set({ products: await api.getProducts() }) } catch (e) { console.error(e) }
  },

  saveProduct: async (data) => {
    if (USE_API) {
      try {
        if (data.id) {
          const p = await api.updateProduct(data.id, {
            name: data.name, price: data.price, old: data.old, stock: data.stock,
            hot: data.hot, organic: data.organic, photo: data.photo,
            art: data.art, e: data.e,
          })
          set(s => ({ products: s.products.map(x => x.id === p.id ? p : x) }))
          return p
        }
        const p = await api.createProduct({
          art: data.art, name: data.name!, price: data.price!, stock: data.stock ?? 0,
          e: data.e, hot: data.hot, organic: data.organic, photo: data.photo,
          unit: data.unit, old: data.old,
        })
        set(s => ({ products: [...s.products, p] }))
        return p
      } catch (e) { console.error(e); return null }
    }
    if (data.id) {
      get().updateProduct(data.id, data as Partial<Product>)
      return get().products.find(p => p.id === data.id) || null
    }
    const p = { ...data, id: Date.now() } as Product
    get().addProduct(p)
    return p
  },

  updateProduct: (id, updates) => set(s => ({
    products: s.products.map(p => p.id === id ? { ...p, ...updates } : p)
  })),

  addProduct: (p) => set(s => ({ products: [...s.products, p] })),

  removeProduct: async (id) => {
    if (USE_API) {
      try { await api.deleteProduct(id) } catch (e) { console.error(e) }
    }
    set(s => ({ products: s.products.filter(p => p.id !== id) }))
  },
}))

// ── RESTAURANTS ──────────────────────────────────
interface RestaurantsStore {
  restaurants: Restaurant[]
  fetchRestaurants: () => Promise<void>
  toggleOpen: (id: string) => Promise<void>
  updateCommission: (id: string, commission: number) => Promise<void>
  toggleMenuItem: (restId: string, menuId: number) => Promise<void>
}
export const useRestaurants = create<RestaurantsStore>((set, get) => ({
  restaurants: RESTAURANTS,

  fetchRestaurants: async () => {
    if (!USE_API) return
    try { set({ restaurants: await api.getRestaurants() }) } catch (e) { console.error(e) }
  },

  toggleOpen: async (id) => {
    if (USE_API) {
      try { await api.toggleRestaurant(id) } catch (e) { console.error(e) }
    }
    set(s => ({
      restaurants: s.restaurants.map(r => r.id === id ? { ...r, open: !r.open } : r)
    }))
  },

  updateCommission: async (id, commission) => {
    if (USE_API) {
      try { await api.setCommission(id, commission) } catch (e) { console.error(e) }
    }
    set(s => ({
      restaurants: s.restaurants.map(r => r.id === id ? { ...r, commission } : r)
    }))
  },

  toggleMenuItem: async (restId, menuId) => {
    if (USE_API) {
      try { await api.toggleMenuStock(menuId) } catch (e) { console.error(e) }
    }
    set(s => ({
      restaurants: s.restaurants.map(r => r.id !== restId ? r : {
        ...r, menu: r.menu.map(m => m.id === menuId ? { ...m, inStock: !m.inStock } : m)
      })
    }))
  },
}))

// ── AUTH ─────────────────────────────────────────
interface AuthStore {
  token: string | null
  role: string | null
  userId: number | null
  name: string
  email: string
  hydrated: boolean
  hydrate: () => void
  sendOTP: (phone: string) => Promise<boolean>
  verifyOTP: (phone: string, code: string) => Promise<boolean>
  login: (email: string, password: string) => Promise<boolean>
  logout: () => void
}
export const useAuth = create<AuthStore>((set) => ({
  token: null, role: null, userId: null, name: '', email: '', hydrated: false,

  hydrate: () => {
    if (typeof window === 'undefined') return
    const t = getToken()
    if (t) set({ token: t, hydrated: true })
    else set({ hydrated: true })
  },

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
      if (email === 'admin@kakapo.tj' && password === 'admin123') {
        set({ role: 'admin', name: 'Админ', email }); return true
      }
      if (password === 'rest123') { set({ role: 'restaurant', name: 'Ресторан', email }); return true }
      return false
    }
    try {
      const r = await api.login(email, password)
      setToken(r.access_token)
      set({ token: r.access_token, role: r.role, userId: r.user_id, name: r.name, email })
      return true
    } catch { return false }
  },

  logout: () => { setToken(null); set({ token: null, role: null, userId: null, name: '', email: '' }) },
}))
