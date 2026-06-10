'use client'
import { create } from 'zustand'
import type { Order, OrderStatus, Product, Restaurant } from './types'
import { INITIAL_ORDERS, PRODUCTS, RESTAURANTS } from './data'
import { api, setToken, getToken } from './api'
import { USE_API } from './config'
import { isCourierReadyOrder, isCourierSyncOrder, isCourierRoleOrder, isAssemblerOrder } from './orderUiMap'
import {
  applyMarketStatus,
  applyRestPartStatus,
  hasRestPart,
  initMixedOrderFields,
  isMixedOrder,
  normalizeOrder,
  normalizeOrders,
} from './orderParts'
import { ASSEMBLER_NAME } from './courierStats'

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


async function loadCourierOrdersFromApi(): Promise<Order[]> {
  try {
    const list = await api.getOrders()
    return normalizeOrders(list.filter(o => isCourierSyncOrder(o) || o.status === 'delivered'))
  } catch { /* fallback */ }
  try {
    const dedicated = await api.getCourierOrders()
    return normalizeOrders(dedicated.filter(isCourierSyncOrder))
  } catch {
    return []
  }
}

export function mergeOrderFields(local: Order, remote: Order): Order {
  const pickedUpIds = [...new Set([...(local.pickedUpIds || []), ...(remote.pickedUpIds || [])])]
  const courierRoute = local.courierRoute?.length ? local.courierRoute : remote.courierRoute
  const items = (remote.items || []).map((it, idx) => {
    const localIt = local.items?.[idx]
    if (localIt?.done && !it.done) return { ...it, done: true }
    return it
  })
  return {
    ...remote,
    courier: remote.courier?.name ? remote.courier : local.courier,
    assembler: remote.assembler?.name ? remote.assembler : local.assembler,
    ...(pickedUpIds.length ? { pickedUpIds } : {}),
    ...(courierRoute?.length ? { courierRoute } : {}),
    items,
  }
}

function mergeRoleOrders(
  current: Order[],
  remote: Order[],
  belongsToRole: (o: Order) => boolean,
): Order[] {
  const remoteIds = new Set(remote.map(o => o.id))
  const localById = new Map(current.filter(belongsToRole).map(o => [o.id, o]))
  const outsideRole = current.filter(o => !belongsToRole(o))
  const localRoleOnly = current.filter(o => belongsToRole(o) && !remoteIds.has(o.id))
  const mergedRemote = remote.map(o => {
    const local = localById.get(o.id)
    return local ? mergeOrderFields(local, o) : o
  })
  const merged = [...outsideRole, ...mergedRemote, ...localRoleOnly]
  const seen = new Set<string>()
  return merged.filter(o => {
    if (seen.has(o.id)) return false
    seen.add(o.id)
    return true
  })
}

async function loadRestaurantOrdersFromApi(): Promise<Order[]> {
  const list = await api.getOrders()
  return normalizeOrders(list.filter(o => hasRestPart(normalizeOrder(o))))
}

async function loadAssemblerOrdersFromApi(): Promise<Order[]> {
  let list = await api.getAssemblerOrders()
  if (!list.length) list = await api.getOrders()
  return normalizeOrders(list.filter(o => isAssemblerOrder(o)))
}

interface OrdersStore {
  orders: Order[]
  loading: boolean
  fetchOrders: () => Promise<void>
  fetchAssemblerOrders: () => Promise<void>
  fetchCourierOrders: () => Promise<void>
  fetchRestaurantOrders: () => Promise<void>
  createOrder: (data: any) => Promise<Order | null>
  addOrder: (order: Order) => void
  updateStatus: (id: string, status: OrderStatus, extra?: Record<string, unknown>) => Promise<void>
  startMarketPart: (id: string) => Promise<void>
  completeMarketPart: (id: string) => Promise<void>
  updateRestPart: (id: string, restId: string, partStatus: 'new' | 'cooking' | 'done') => Promise<void>
  markPickupDone: (id: string, pickupId: string) => Promise<void>
  setCourierRoute: (id: string, route: string[]) => Promise<void>
  toggleItem: (orderId: string, itemId: number) => void
  getByStatus: (status: OrderStatus | OrderStatus[]) => Order[]
  getByType: (type: 'market' | 'restaurant') => Order[]
}
export const useOrders = create<OrdersStore>((set, get) => ({
  orders: USE_API ? [] : (loadStoredOrders() ?? INITIAL_ORDERS),
  loading: false,

  fetchOrders: async () => {
    if (!USE_API) return
    set({ loading: true })
    try {
      const orders = normalizeOrders(await api.getOrders())
      patchOrders(set, get, orders)
    } catch (e) { console.error(e) }
    finally { set({ loading: false }) }
  },

  fetchAssemblerOrders: async () => {
    if (!USE_API) return
    try {
      const orders = await loadAssemblerOrdersFromApi()
      patchOrders(set, get, s => mergeRoleOrders(s, orders, o => isAssemblerOrder(normalizeOrder(o))))
    } catch (e) { console.error(e) }
  },

  fetchCourierOrders: async () => {
    if (!USE_API) return
    try {
      const orders = await loadCourierOrdersFromApi()
      patchOrders(set, get, s => mergeRoleOrders(s, orders, isCourierRoleOrder))
    } catch (e) { console.error(e) }
  },

  fetchRestaurantOrders: async () => {
    if (!USE_API) return
    try {
      const orders = await loadRestaurantOrdersFromApi()
      patchOrders(set, get, s => mergeRoleOrders(s, orders, o => hasRestPart(normalizeOrder(o))))
    } catch (e) { console.error(e) }
  },

  createOrder: async (data) => {
    const prepared = initMixedOrderFields(data)
    if (USE_API) {
      try {
        const order = await api.createOrder(prepared)
        const normalized = normalizeOrder({
          ...order,
          ...prepared,
          items: (prepared.items as Order['items']) ?? order.items,
          status: 'new',
        })
        patchOrders(set, get, s => [normalized, ...s])
        return normalized
      } catch (e) {
        console.error(e)
        throw e
      }
    }
    const order: Order = normalizeOrder({
      ...prepared,
      id: `K-${Date.now()}`,
      status: 'new',
      createdAt: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      client: data.client || { name: data.client_name, phone: data.client_phone, addr: data.address },
      items: prepared.items || data.items || [],
      total: data.total || 0,
      deliveryFee: data.deliveryFee,
      pickupIds: data.pickupIds,
      weightKg: data.weightKg,
    } as Order)
    patchOrders(set, get, s => [order, ...s])
    return order
  },

  addOrder: (order) => patchOrders(set, get, s => [order, ...s]),

  updateStatus: async (id, status, extra) => {
    patchOrders(set, get, s => s.map(o => o.id === id ? { ...o, status, ...(extra || {}) } : o))
    if (USE_API) {
      try {
        const updated = await api.updateOrderStatus(id, status, extra)
        patchOrders(set, get, s => s.map(o => o.id === id ? normalizeOrder({ ...o, ...updated, status: updated.status ?? status }) : o))
      } catch (e) { console.error(e) }
    }
  },

  startMarketPart: async (id) => {
    const order = get().orders.find(o => o.id === id)
    if (!order) return
    const assembler = { name: ASSEMBLER_NAME }
    const next = isMixedOrder(normalizeOrder(order))
      ? { ...order, marketStatus: 'assembling' as const, assembler: order.assembler || assembler }
      : { ...order, status: 'assembling' as OrderStatus, assembler: order.assembler || assembler }
    patchOrders(set, get, s => s.map(o => o.id === id ? next : o))
    if (USE_API) {
      try {
        const status = 'assembling'
        const extra = isMixedOrder(normalizeOrder(order))
          ? { marketStatus: 'assembling', assembler: next.assembler }
          : { assembler: next.assembler }
        const updated = await api.updateOrderStatus(id, status, extra)
        patchOrders(set, get, s => s.map(o => o.id === id ? normalizeOrder({ ...o, ...updated, ...next }) : o))
      } catch (e) { console.error(e) }
    }
  },

  completeMarketPart: async (id) => {
    const order = get().orders.find(o => o.id === id)
    if (!order) return
    const assembler = order.assembler || { name: ASSEMBLER_NAME }
    const next = isMixedOrder(normalizeOrder(order))
      ? applyMarketStatus(order, 'done')
      : { ...order, status: 'assembler_done' as OrderStatus, assembler }
    const withAssembler = { ...next, assembler }
    patchOrders(set, get, s => s.map(o => o.id === id ? withAssembler : o))
    if (USE_API) {
      try {
        const extra = isMixedOrder(normalizeOrder(order))
          ? { marketStatus: 'done', restParts: withAssembler.restParts, assembler }
          : { assembler }
        const updated = await api.updateOrderStatus(id, withAssembler.status, extra)
        patchOrders(set, get, s => s.map(o => o.id === id ? normalizeOrder({ ...o, ...updated, ...withAssembler }) : o))
      } catch (e) { console.error(e) }
    }
  },

  updateRestPart: async (id, restId, partStatus) => {
    const order = get().orders.find(o => o.id === id)
    if (!order) return
    const normalized = normalizeOrder(order)
    const next = isMixedOrder(normalized)
      ? applyRestPartStatus(order, restId, partStatus)
      : {
        ...order,
        status: (partStatus === 'done' ? 'ready' : partStatus === 'cooking' ? 'cooking' : 'new') as OrderStatus,
      }
    patchOrders(set, get, s => s.map(o => o.id === id ? next : o))
    if (USE_API) {
      try {
        const extra = isMixedOrder(normalized)
          ? { restParts: next.restParts, marketStatus: next.marketStatus }
          : undefined
        const updated = await api.updateOrderStatus(id, next.status, extra)
        patchOrders(set, get, s => s.map(o => o.id === id ? normalizeOrder({ ...o, ...updated, ...next }) : o))
      } catch (e) { console.error(e) }
    }
  },

  markPickupDone: async (id, pickupId) => {
    const order = get().orders.find(o => o.id === id)
    if (!order) return
    const pickedUpIds = [...new Set([...(order.pickedUpIds || []), pickupId])]
    patchOrders(set, get, s => s.map(o => o.id === id ? { ...o, pickedUpIds } : o))
    if (USE_API) {
      try {
        const updated = await api.updateOrderStatus(id, order.status, { pickedUpIds })
        patchOrders(set, get, s => s.map(o => o.id === id
          ? normalizeOrder({ ...o, ...updated, pickedUpIds: updated.pickedUpIds ?? pickedUpIds })
          : o))
      } catch (e) { console.error(e) }
    }
  },

  setCourierRoute: async (id, route) => {
    patchOrders(set, get, s => s.map(o => o.id === id ? { ...o, courierRoute: route } : o))
    if (USE_API) {
      const order = get().orders.find(o => o.id === id)
      if (!order) return
      try {
        const updated = await api.updateOrderStatus(id, order.status, { courierRoute: route })
        patchOrders(set, get, s => s.map(o => o.id === id
          ? normalizeOrder({ ...o, ...updated, courierRoute: updated.courierRoute ?? route })
          : o))
      } catch (e) { console.error(e) }
    }
  },

  toggleItem: (orderId, itemId) => set(s => ({
    orders: s.orders.map(o => o.id === orderId
      ? {
        ...o,
        items: o.items.map((it, idx) => {
          const key = it.id ?? it.product_id ?? idx + 1
          return key === itemId ? { ...it, done: !it.done } : it
        }),
      }
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
      try {
        const updated = await api.toggleRestaurant(id)
        set(s => ({
          restaurants: s.restaurants.map(r => r.id === id ? { ...r, ...updated, open: updated.open } : r),
        }))
        return
      } catch (e) { console.error(e); return }
    }
    set(s => ({
      restaurants: s.restaurants.map(r => r.id === id ? { ...r, open: !r.open } : r),
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
