'use client'
import { create } from 'zustand'
import type { Order, OrderStatus, OrderItem, Product, Restaurant, Promo } from './types'
import { INITIAL_ORDERS, PRODUCTS, RESTAURANTS } from './data'
import { api, setToken, getToken } from './api'
import { USE_API } from './config'
import { isCourierReadyOrder, isCourierSyncOrder, isCourierMapSyncOrder, isCourierRoleOrder, isAssemblerOrder, buildAdminStatusPatch } from './orderUiMap'
import { isAssemblerOrderClaimed, orderHasAssemblerAssignment } from './assemblerTeam'
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
import { ensureArray } from './apiGuards'
import { onOrderStatusChange, onRestPartAccepted } from './pushService'
import { creditBonusOnDeliveryLocal, reverseBonusOnOrderCancelLocal } from './loyaltyBonus'
import { useClientStore } from './clientStore'
import { useCardStore } from './cardStore'
import { useCourierTeamStore } from './courierTeamStore'
import { usePricingStore } from './courierStore'
import { findCourierByPhone } from './courierTeam'
import { canCourierAffordOrder, getCourierBalance, isNewCourierAssignment } from './courierWallet'
import { DEFAULT_PRICING } from './courierData'

function applyCancelLoyalty(
  set: (fn: (s: OrdersStore) => Partial<OrdersStore> | OrdersStore) => void,
  get: () => OrdersStore,
  id: string,
  prev?: Order,
) {
  const order = get().orders.find(o => o.id === id)
  if (!order || order.status !== 'cancelled') return
  const phone = order.client?.phone || prev?.client?.phone || ''
  if (!phone) return

  if (USE_API) {
    void import('./loyaltyBonus').then(m => m.syncLoyaltyBonuses(phone, get().orders)).catch(() => {})
    return
  }

  const patch = prev ? reverseBonusOnOrderCancelLocal(prev, get().orders) : null
  if (patch) {
    patchOrders(set, get, s => s.map(o => (o.id === id ? { ...o, ...patch } : o)))
  }
}

function applyDeliveryLoyalty(
  set: (fn: (s: OrdersStore) => Partial<OrdersStore> | OrdersStore) => void,
  get: () => OrdersStore,
  id: string,
) {
  const order = get().orders.find(o => o.id === id)
  if (!order || order.status !== 'delivered') return
  const phone = order.client?.phone || ''
  if (!phone) return

  if (USE_API) {
    void import('./loyaltyBonus').then(m => m.syncLoyaltyBonuses(phone, get().orders, { force: true })).catch(() => {})
    return
  }
  if (order.bonusCredited) return
  const patch = creditBonusOnDeliveryLocal(order, get().orders)
  if (patch) {
    patchOrders(set, get, s => s.map(o => (o.id === id ? { ...o, ...patch } : o)))
  }
}

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
  if (!USE_API) saveStoredOrders(next)
}


async function loadCourierOrdersFromApi(): Promise<Order[]> {
  try {
    const list = await api.getOrders()
    return normalizeOrders(list.filter(o => isCourierMapSyncOrder(o) || o.status === 'delivered'))
  } catch { /* fallback */ }
  try {
    const dedicated = await api.getCourierOrders()
    return normalizeOrders(dedicated.filter(isCourierMapSyncOrder))
  } catch {
    return []
  }
}

export function applyAdminPins(orders: Order[], pins: Record<string, AdminOrderPin>): Order[] {
  if (!Object.keys(pins).length) return orders
  return orders.map(o => {
    const pin = pins[o.id]
    if (!pin) return o
    return { ...o, ...pin, status: (pin.status ?? o.status) as OrderStatus }
  })
}

export type AdminOrderPin = Partial<Pick<Order,
  'status' | 'marketStatus' | 'restParts' | 'items' | 'courier' | 'assembler' | 'courierRoute' | 'pickedUpIds' | 'deliveredAt'
>>

function orderMatchesAdminPin(order: Order, pin: AdminOrderPin): boolean {
  if (pin.status && order.status !== pin.status) return false
  if (pin.marketStatus != null && order.marketStatus !== pin.marketStatus) return false
  if (pin.restParts && JSON.stringify(order.restParts ?? {}) !== JSON.stringify(pin.restParts)) return false
  if (pin.courier === null && order.courier?.name) return false
  if (pin.assembler === null && order.assembler?.name) return false
  return true
}

const STATUS_RANK: Record<string, number> = {
  new: 0, cooking: 1, assembling: 2, ready: 3, assembler_done: 3,
  courier_picked: 4, delivering: 5, delivered: 6, cancelled: 6,
}

function mergeOrderStatus(local: OrderStatus, remote: OrderStatus): OrderStatus {
  if (USE_API) return remote ?? local
  if (remote === 'delivered' || remote === 'cancelled') return remote
  return (STATUS_RANK[local] ?? 0) >= (STATUS_RANK[remote] ?? 0) ? local : remote
}

function mergeOrderItems(local: OrderItem[] = [], remote: OrderItem[] = []): OrderItem[] {
  if (!remote.length) return local
  if (!local.length) return remote
  const localByKey = new Map(local.map((it, idx) => [String(it.id ?? it.product_id ?? idx + 1), it]))
  return remote.map((rit, idx) => {
    const key = String(rit.id ?? rit.product_id ?? idx + 1)
    const lit = localByKey.get(key)
    if (!lit) return rit
    return { ...rit, done: !!(lit.done || rit.done) }
  })
}

export function mergeOrderFields(local: Order, remote: Order, adminPin?: AdminOrderPin): Order {
  if (adminPin) {
    const merged = { ...local, ...remote, ...adminPin, status: (adminPin.status ?? remote.status ?? local.status) as OrderStatus }
    if (adminPin.courier === null) merged.courier = undefined
    if (adminPin.assembler === null) merged.assembler = undefined
    if (adminPin.courierRoute === null) merged.courierRoute = undefined
    if (adminPin.pickedUpIds) merged.pickedUpIds = adminPin.pickedUpIds
    return merged
  }
  const pickedUpIds = USE_API
    ? (remote.pickedUpIds ?? local.pickedUpIds ?? [])
    : [...new Set([...(local.pickedUpIds || []), ...(remote.pickedUpIds || [])])]
  const useRemoteCourier = remote.courier === null || !!remote.courier?.name
  const useRemoteAssembler = remote.assembler === null || !!remote.assembler?.name
  const courierRoute = remote.courierRoute === null
    ? null
    : (remote.courierRoute?.length ? remote.courierRoute : local.courierRoute)
  return {
    ...remote,
    status: USE_API
      ? mergeOrderStatus(local.status, remote.status ?? local.status)
      : (remote.status ?? local.status),
    bonusCredited: remote.bonusCredited === true || local.bonusCredited === true,
    bonusEarned: remote.bonusEarned ?? local.bonusEarned,
    bonusSpent: remote.bonusSpent ?? local.bonusSpent,
    courier: useRemoteCourier ? remote.courier : local.courier,
    assembler: useRemoteAssembler ? remote.assembler : local.assembler,
    assemblerTeam: remote.assemblerTeam?.length ? remote.assemblerTeam : local.assemblerTeam,
    marketStatus: remote.marketStatus ?? local.marketStatus,
    restParts: remote.restParts ?? local.restParts,
    items: remote.items?.length
      ? (USE_API ? remote.items : mergeOrderItems(local.items, remote.items))
      : local.items,
    courierAtClient: remote.courierAtClient ?? local.courierAtClient,
    ...(pickedUpIds.length ? { pickedUpIds } : {}),
    ...(courierRoute != null ? { courierRoute } : { courierRoute: null }),
  }
}

function isRestaurantRoleOrder(o: Order): boolean {
  return hasRestPart(normalizeOrder(o))
}

function mergeRoleOrders(
  current: Order[],
  remote: Order[],
  belongsToRole: (o: Order) => boolean,
  pins: Record<string, AdminOrderPin> = {},
): Order[] {
  const remoteIds = new Set(remote.map(o => o.id))
  const localById = new Map(current.filter(belongsToRole).map(o => [o.id, o]))
  const outsideRole = current.filter(o => !belongsToRole(o))
  const localRoleOnly = USE_API
    ? current.filter(o => belongsToRole(o) && !remoteIds.has(o.id) && o.status === 'delivered')
    : current.filter(o => belongsToRole(o) && !remoteIds.has(o.id))
  const mergedRemote = remote.map(o => {
    const local = localById.get(o.id)
    return local ? mergeOrderFields(local, o, pins[o.id]) : o
  })
  const merged = [...outsideRole, ...mergedRemote, ...localRoleOnly]
  const seen = new Set<string>()
  return applyAdminPins(merged.filter(o => {
    if (seen.has(o.id)) return false
    seen.add(o.id)
    return true
  }), pins)
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
  orderAdminPins: Record<string, AdminOrderPin>
  fetchOrders: () => Promise<void>
  fetchAssemblerOrders: () => Promise<void>
  fetchCourierOrders: () => Promise<void>
  fetchRestaurantOrders: () => Promise<void>
  createOrder: (data: any) => Promise<Order | null>
  addOrder: (order: Order) => void
  updateStatus: (id: string, status: OrderStatus, extra?: Record<string, unknown>) => Promise<void>
  adminUpdateStatus: (id: string, status: OrderStatus) => Promise<void>
  adminAssignCourier: (id: string, courier: { name: string; phone: string } | null) => Promise<void>
  adminAssignAssembler: (id: string, assembler: { name: string; id?: string } | null) => Promise<void>
  adminRemoveOrder: (id: string) => Promise<void>
  adminRemoveOrders: (ids: string[]) => Promise<{ removed: number }>
  acceptAssemblerOrder: (id: string, member: { name: string; id?: string }) => Promise<{ ok: true } | { ok: false; error: string }>
  startMarketPart: (id: string) => Promise<void>
  completeMarketPart: (id: string) => Promise<void>
  updateRestPart: (id: string, restId: string, partStatus: 'new' | 'cooking' | 'done') => Promise<void>
  markPickupDone: (id: string, pickupId: string) => Promise<void>
  setCourierRoute: (id: string, route: string[]) => Promise<void>
  toggleItem: (orderId: string, itemId: number) => Promise<void>
  updateOrderItems: (orderId: string, items: Order['items'], extra?: { assemblerNote?: string }) => Promise<void>
  getByStatus: (status: OrderStatus | OrderStatus[]) => Order[]
  getByType: (type: 'market' | 'restaurant') => Order[]
}
export const useOrders = create<OrdersStore>((set, get) => ({
  orders: USE_API ? [] : (loadStoredOrders() ?? INITIAL_ORDERS),
  loading: false,
  orderAdminPins: {},

  fetchOrders: async () => {
    if (!USE_API) return
    set({ loading: true })
    try {
      const raw = ensureArray<Order>(await api.getOrders(), 'orders')
      const pins = get().orderAdminPins
      const current = get().orders
      const orders = applyAdminPins(
        raw.map(o => {
          const normalized = { ...normalizeOrder(o), status: o.status }
          const local = current.find(x => x.id === o.id)
          const pin = pins[o.id]
          if (pin) return { ...normalized, ...pin, status: (pin.status ?? normalized.status) as OrderStatus }
          return local ? mergeOrderFields(local, normalized, pins[o.id]) : normalized
        }),
        pins,
      )
      patchOrders(set, get, orders)
    } catch (e) { console.error(e) }
    finally { set({ loading: false }) }
  },

  fetchAssemblerOrders: async () => {
    if (!USE_API) return
    try {
      const orders = await loadAssemblerOrdersFromApi()
      const pins = get().orderAdminPins
      patchOrders(set, get, s => mergeRoleOrders(s, orders, o => isAssemblerOrder(normalizeOrder(o)), pins))
    } catch (e) { console.error(e) }
  },

  fetchCourierOrders: async () => {
    if (!USE_API) return
    try {
      const orders = await loadCourierOrdersFromApi()
      const pins = get().orderAdminPins
      patchOrders(set, get, s => mergeRoleOrders(s, orders, isCourierRoleOrder, pins))
    } catch (e) { console.error(e) }
  },

  fetchRestaurantOrders: async () => {
    if (!USE_API) return
    try {
      const orders = await loadRestaurantOrdersFromApi()
      patchOrders(set, get, s => mergeRoleOrders(s, orders, o => isRestaurantRoleOrder(normalizeOrder(o)), get().orderAdminPins))
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
      createdAtIso: new Date().toISOString(),
      client: data.client || { name: data.client_name, phone: data.client_phone, addr: data.address },
      items: prepared.items || data.items || [],
      total: data.total || 0,
      deliveryFee: data.deliveryFee,
      deliveryFeeLocked: Number(data.deliveryFee) > 0,
      payment_method: data.payment_method || data.pay || 'cash',
      pay: data.payment_method || data.pay || 'cash',
      creditAmount: data.creditAmount,
      bonusSpent: data.bonusSpent,
      pickupIds: data.pickupIds,
      weightKg: data.weightKg,
    } as Order)
    patchOrders(set, get, s => [order, ...s])
    return order
  },

  addOrder: (order) => patchOrders(set, get, s => [order, ...s]),

  updateStatus: async (id, status, extra) => {
    const prev = get().orders.find(o => o.id === id)
    const patch: Record<string, unknown> = { ...(extra || {}) }

    if (!USE_API) {
      if (isNewCourierAssignment(prev, patch)) {
        const couriers = useCourierTeamStore.getState().couriers
        const phone = (patch.courier as { phone?: string } | undefined)?.phone
        const courier = findCourierByPhone(couriers, phone || '')
        const pricing = { ...DEFAULT_PRICING, ...usePricingStore.getState().pricing }
        const gate = canCourierAffordOrder(courier, pricing)
        if (!gate.ok) throw new Error(gate.msg || 'Недостаточно средств на счёте')
        if (gate.commission > 0 && courier) {
          useCourierTeamStore.getState().updateCourier(courier.id, {
            balance: Math.round((gate.balance - gate.commission) * 100) / 100,
          })
          patch.courierCommissionPaid = gate.commission
          patch.courierCommissionCourierId = courier.id
          patch.courierCommissionRefunded = false
        }
      }
      if (status === 'cancelled' && prev && prev.status !== 'cancelled') {
        const paid = Number((prev as Order & { courierCommissionPaid?: number }).courierCommissionPaid) || 0
        const refunded = !!(prev as Order & { courierCommissionRefunded?: boolean }).courierCommissionRefunded
        if (paid > 0 && !refunded) {
          const courierId = (prev as Order & { courierCommissionCourierId?: string }).courierCommissionCourierId
          const courier = courierId
            ? useCourierTeamStore.getState().couriers.find(c => c.id === courierId)
            : null
          if (courier) {
            useCourierTeamStore.getState().updateCourier(courier.id, {
              balance: Math.round((getCourierBalance(courier) + paid) * 100) / 100,
            })
            patch.courierCommissionRefunded = true
          }
        }
      }
    }

    patchOrders(set, get, s => s.map(o => o.id === id ? { ...o, status, ...patch } : o))
    const nextAfter = get().orders.find(o => o.id === id)
    if (prev && nextAfter) onOrderStatusChange(normalizeOrder(prev), normalizeOrder(nextAfter))
    if (nextAfter?.status === 'delivered' && !USE_API) applyDeliveryLoyalty(set, get, id)
    if (nextAfter?.status === 'cancelled' && !USE_API) applyCancelLoyalty(set, get, id, prev)
    if (USE_API) {
      try {
        const updated = await api.updateOrderStatus(id, status, patch)
        const nextStatus = (updated.status ?? status) as OrderStatus
        patchOrders(set, get, s => s.map(o => {
          if (o.id !== id) return o
          return { ...normalizeOrder({ ...o, ...updated }), status: nextStatus }
        }))
        const synced = get().orders.find(o => o.id === id)
        if (prev && synced) onOrderStatusChange(normalizeOrder(prev), normalizeOrder(synced))
        if (synced?.status === 'delivered') applyDeliveryLoyalty(set, get, id)
        if (synced?.status === 'cancelled') applyCancelLoyalty(set, get, id, prev)
        if (isNewCourierAssignment(prev, patch)) {
          void useCourierTeamStore.getState().fetchFromApi()
        }
      } catch (e) {
        console.error(e)
        if (prev) patchOrders(set, get, s => s.map(o => o.id === id ? prev : o))
        throw e
      }
    }
  },

  adminUpdateStatus: async (id, status) => {
    const order = get().orders.find(o => o.id === id)
    const prev = order ? normalizeOrder(order) : undefined
    const patch = buildAdminStatusPatch(order, status)
    const { adminOverride: _ao, ...fields } = patch
    const pin = { status, ...fields } as AdminOrderPin
    const optimistic = { ...fields, status } as Partial<Order>
    const pins = { ...get().orderAdminPins, [id]: pin }
    set({ orderAdminPins: pins })
    patchOrders(set, get, s => s.map(o => (o.id === id ? { ...o, ...optimistic } : o)))
    const nextAfter = get().orders.find(o => o.id === id)
    if (prev && nextAfter) onOrderStatusChange(prev, normalizeOrder(nextAfter))
    if (nextAfter?.status === 'delivered' && !USE_API) applyDeliveryLoyalty(set, get, id)
    if (nextAfter?.status === 'cancelled' && !USE_API) applyCancelLoyalty(set, get, id, prev)
    if (USE_API) {
      try {
        const updated = await api.updateOrderStatus(id, status, patch)
        const merged = normalizeOrder({ ...(get().orders.find(o => o.id === id) || {}), ...updated, status: (updated.status ?? status) as OrderStatus })
        if (!orderMatchesAdminPin(merged, pin)) {
          set({ orderAdminPins: { ...get().orderAdminPins, [id]: pin } })
          patchOrders(set, get, s => s.map(o => (o.id === id ? { ...o, ...pin, status: pin.status ?? status } : o)))
          throw new Error('Сервер не сохранил статус. Проверьте API и повторите.')
        }
        const nextPins = { ...get().orderAdminPins }
        delete nextPins[id]
        set({ orderAdminPins: nextPins })
        patchOrders(set, get, s => s.map(o => (o.id === id ? merged : o)))
        const synced = get().orders.find(o => o.id === id)
        if (prev && synced) onOrderStatusChange(prev, normalizeOrder(synced))
        if (synced?.status === 'delivered') applyDeliveryLoyalty(set, get, id)
        if (synced?.status === 'cancelled') applyCancelLoyalty(set, get, id, prev)
      } catch (e) {
        console.error(e)
        if (!(e instanceof Error && e.message.includes('Сервер не сохранил'))) {
          const nextPins = { ...get().orderAdminPins }
          delete nextPins[id]
          set({ orderAdminPins: nextPins })
          if (prev) patchOrders(set, get, s => s.map(o => o.id === id ? prev : o))
        }
        throw e
      }
    } else {
      const nextPins = { ...get().orderAdminPins }
      delete nextPins[id]
      set({ orderAdminPins: nextPins })
      if (status === 'delivered') applyDeliveryLoyalty(set, get, id)
      if (status === 'cancelled') applyCancelLoyalty(set, get, id, prev)
    }
  },

  adminAssignCourier: async (id, courier) => {
    const order = get().orders.find(o => o.id === id)
    if (!order) return
    patchOrders(set, get, s => s.map(o => (o.id === id ? { ...o, courier: courier ?? undefined } : o)))
    if (USE_API) {
      try {
        const updated = await api.updateOrderStatus(id, order.status, { courier: courier ?? null })
        patchOrders(set, get, s => s.map(o => (o.id === id ? normalizeOrder({ ...o, ...updated }) : o)))
      } catch (e) { console.error(e) }
    }
  },

  adminAssignAssembler: async (id, assembler) => {
    const order = get().orders.find(o => o.id === id)
    if (!order) return
    patchOrders(set, get, s => s.map(o => (o.id === id ? { ...o, assembler: assembler ?? undefined } : o)))
    if (USE_API) {
      try {
        const updated = await api.updateOrderStatus(id, order.status, { assembler: assembler ?? null })
        patchOrders(set, get, s => s.map(o => (o.id === id ? normalizeOrder({ ...o, ...updated }) : o)))
      } catch (e) { console.error(e) }
    }
  },

  adminRemoveOrder: async (id) => {
    if (USE_API) await api.deleteOrder(id)
    patchOrders(set, get, s => s.filter(o => o.id !== id))
    const nextPins = { ...get().orderAdminPins }
    delete nextPins[id]
    set({ orderAdminPins: nextPins })
  },

  adminRemoveOrders: async (ids) => {
    const unique = [...new Set(ids.map(String).filter(Boolean))]
    if (!unique.length) return { removed: 0 }
    if (USE_API) {
      const res = await api.bulkDeleteOrders(unique)
      const idSet = new Set((res.ids || unique).map(String))
      patchOrders(set, get, s => s.filter(o => !idSet.has(String(o.id))))
      const nextPins = { ...get().orderAdminPins }
      unique.forEach(rid => { delete nextPins[rid] })
      set({ orderAdminPins: nextPins })
      return { removed: res.removed ?? idSet.size }
    }
    const idSet = new Set(unique)
    patchOrders(set, get, s => s.filter(o => !idSet.has(String(o.id))))
    const nextPins = { ...get().orderAdminPins }
    unique.forEach(rid => { delete nextPins[rid] })
    set({ orderAdminPins: nextPins })
    return { removed: unique.length }
  },

  acceptAssemblerOrder: async (id, member) => {
    const order = get().orders.find(o => o.id === id)
    if (!order) return { ok: false, error: 'Заказ не найден' }
    const normalized = normalizeOrder(order)
    if (isAssemblerOrderClaimed(normalized) && !orderHasAssemblerAssignment(normalized, member)) {
      return { ok: false, error: 'Заказ уже принят другим сборщиком' }
    }
    const assembler = { name: member.name, ...(member.id ? { id: member.id } : {}) }
    const next = { ...order, assembler }
    patchOrders(set, get, s => s.map(o => o.id === id ? next : o))
    if (USE_API) {
      try {
        const updated = await api.updateOrderStatus(id, order.status, { assembler })
        patchOrders(set, get, s => s.map(o => o.id === id ? normalizeOrder({ ...o, ...updated, assembler }) : o))
      } catch (e) {
        console.error(e)
        if (order) patchOrders(set, get, s => s.map(o => o.id === id ? order : o))
        return { ok: false, error: 'Не удалось принять заказ' }
      }
    }
    return { ok: true }
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
      : { ...order, status: 'assembler_done' as OrderStatus, marketStatus: 'done' as const, assembler }
    const withAssembler = { ...next, assembler }
    patchOrders(set, get, s => s.map(o => o.id === id ? withAssembler : o))
    if (USE_API) {
      try {
        const extra = isMixedOrder(normalizeOrder(order))
          ? { marketStatus: 'done', restParts: withAssembler.restParts, assembler }
          : { assembler, marketStatus: 'done' }
        const updated = await api.updateOrderStatus(id, withAssembler.status, extra)
        patchOrders(set, get, s => s.map(o => o.id === id ? normalizeOrder({ ...o, ...updated, ...withAssembler }) : o))
      } catch (e) { console.error(e) }
    }
  },

  updateRestPart: async (id, restId, partStatus) => {
    const order = get().orders.find(o => o.id === id)
    if (!order) return
    const prev = normalizeOrder(order)
    const normalized = normalizeOrder(order)
    const restKey = String(restId)
    const next = isMixedOrder(normalized)
      ? applyRestPartStatus(order, restId, partStatus)
      : {
        ...order,
        status: (partStatus === 'done' ? 'ready' : partStatus === 'cooking' ? 'cooking' : 'new') as OrderStatus,
        ...(partStatus === 'done' || partStatus === 'cooking'
          ? { restParts: { ...(order.restParts || {}), [restKey]: partStatus === 'done' ? 'done' : 'cooking' } }
          : {}),
      }
    patchOrders(set, get, s => s.map(o => o.id === id ? next : o))
    const nextOrder = get().orders.find(o => o.id === id)
    if (nextOrder) onOrderStatusChange(prev, normalizeOrder(nextOrder))
    if (partStatus === 'cooking') {
      onRestPartAccepted(normalizeOrder(nextOrder || next), order.restName || restId)
    }
    if (USE_API) {
      try {
        const extra = isMixedOrder(normalized)
          ? { restParts: next.restParts, marketStatus: next.marketStatus }
          : { restParts: next.restParts }
        const updated = await api.updateOrderStatus(id, next.status, extra)
        patchOrders(set, get, s => s.map(o => o.id === id ? normalizeOrder({ ...o, ...updated, ...next }) : o))
      } catch (e) {
        console.error(e)
        patchOrders(set, get, s => s.map(o => o.id === id ? order : o))
      }
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
      } catch (e) {
        console.error(e)
        patchOrders(set, get, s => s.map(o => o.id === id ? order : o))
      }
    }
  },

  setCourierRoute: async (id, route) => {
    const order = get().orders.find(o => o.id === id)
    if (!order) return
    patchOrders(set, get, s => s.map(o => o.id === id ? { ...o, courierRoute: route } : o))
    if (USE_API) {
      try {
        const updated = await api.updateOrderStatus(id, order.status, { courierRoute: route })
        patchOrders(set, get, s => s.map(o => o.id === id
          ? normalizeOrder({ ...o, ...updated, courierRoute: updated.courierRoute ?? route })
          : o))
      } catch (e) {
        console.error(e)
        patchOrders(set, get, s => s.map(o => o.id === id ? order : o))
      }
    }
  },

  toggleItem: async (orderId, itemId) => {
    const order = get().orders.find(o => o.id === orderId)
    if (!order) return
    const items = order.items.map((it, idx) => {
      const key = it.id ?? it.product_id ?? idx + 1
      return key === itemId ? { ...it, done: !it.done } : it
    })
    patchOrders(set, get, s => s.map(o => o.id === orderId ? { ...o, items } : o))
    if (USE_API) {
      try {
        const updated = await api.updateOrderStatus(orderId, order.status, { items })
        const mergedItems = updated.items ?? items
        patchOrders(set, get, s => s.map(o => {
          if (o.id !== orderId) return o
          const next = normalizeOrder({ ...o, ...updated, items: mergedItems })
          const same = JSON.stringify(o.items) === JSON.stringify(next.items)
          return same ? o : next
        }))
      } catch (e) {
        console.error(e)
        patchOrders(set, get, s => s.map(o => o.id === orderId ? order : o))
      }
    }
  },

  updateOrderItems: async (orderId, items, extra) => {
    const order = get().orders.find(o => o.id === orderId)
    if (!order) return
    const itemsSubtotal = items.reduce((s, it) => s + it.price * it.qty, 0)
    const total = Math.round((itemsSubtotal + (order.deliveryFee ?? 0)) * 100) / 100
    const patch = { items, total, ...extra }
    patchOrders(set, get, s => s.map(o => o.id === orderId ? { ...o, ...patch } : o))
    if (USE_API) {
      try {
        const updated = await api.updateOrderStatus(orderId, order.status, patch)
        patchOrders(set, get, s => s.map(o => {
          if (o.id !== orderId) return o
          return normalizeOrder({ ...o, ...updated, items: updated.items ?? items, total: updated.total ?? total })
        }))
      } catch (e) {
        console.error(e)
        patchOrders(set, get, s => s.map(o => o.id === orderId ? order : o))
      }
    }
  },

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
  products: USE_API ? [] : PRODUCTS,

  fetchProducts: async () => {
    if (!USE_API) return
    try { set({ products: ensureArray<Product>(await api.getProducts(), 'products') }) } catch (e) { console.error(e) }
  },

  saveProduct: async (data) => {
    if (USE_API) {
      try {
        if (data.id) {
          const p = await api.updateProduct(data.id, {
            ...data,
            old: null,
            discount: 0,
          })
          set(s => ({ products: s.products.map(x => x.id === p.id ? { ...p, old: null, discount: 0 } : x) }))
          return { ...p, old: null, discount: 0 }
        }
        const p = await api.createProduct({
          ...data,
          old: null,
          discount: 0,
        })
        set(s => ({ products: [...s.products, { ...p, old: null, discount: 0 }] }))
        return { ...p, old: null, discount: 0 }
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

// ── PROMOS ───────────────────────────────────────
interface PromosStore {
  promos: Promo[]
  loaded: boolean
  fetchPromos: () => Promise<void>
  setPromos: (promos: Promo[]) => void
}
export const usePromos = create<PromosStore>((set) => ({
  promos: [],
  loaded: !USE_API,
  fetchPromos: async () => {
    if (!USE_API) {
      set({ loaded: true })
      return
    }
    try {
      set({ promos: ensureArray<Promo>(await api.getPromos(), 'promos'), loaded: true })
    } catch (e) {
      console.error(e)
      set({ loaded: true })
    }
  },
  setPromos: (promos) => set({ promos }),
}))

// ── RESTAURANTS ──────────────────────────────────
interface RestaurantsStore {
  restaurants: Restaurant[]
  fetchRestaurants: () => Promise<void>
  toggleOpen: (id: string) => Promise<void>
  updateRestaurant: (id: string, data: Partial<Restaurant>) => Promise<Restaurant | void>
  blockRestaurant: (id: string, blocked: boolean) => Promise<Restaurant | void>
  updateCommission: (id: string, commission: number) => Promise<void>
  toggleMenuItem: (restId: string, menuId: number) => Promise<void>
}
export const useRestaurants = create<RestaurantsStore>((set, get) => ({
  restaurants: USE_API ? [] : RESTAURANTS,

  fetchRestaurants: async () => {
    if (!USE_API) return
    try { set({ restaurants: ensureArray<Restaurant>(await api.getRestaurants(), 'restaurants') }) } catch (e) { console.error(e) }
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

  updateRestaurant: async (id, data) => {
    let result: Restaurant | undefined
    set(s => {
      const restaurants = s.restaurants.map(r => {
        if (r.id !== id) return r
        result = { ...r, ...data }
        return result
      })
      return { restaurants }
    })
    if (USE_API) {
      try {
        const updated = await api.updateRestaurant(id, data)
        set(s => ({
          restaurants: s.restaurants.map(r => r.id === id ? { ...r, ...updated } : r),
        }))
        return updated
      } catch (e) {
        console.error(e)
        return result
      }
    }
    return result
  },

  blockRestaurant: async (id, blocked) => {
    let result: Restaurant | undefined
    set(s => {
      const restaurants = s.restaurants.map(r => {
        if (r.id !== id) return r
        result = { ...r, blocked, open: blocked ? false : true }
        return result
      })
      return { restaurants }
    })

    if (USE_API) {
      try {
        const updated = await api.blockRestaurant(id, blocked)
        set(s => ({
          restaurants: s.restaurants.map(r =>
            r.id === id ? { ...r, ...updated, blocked, open: blocked ? false : true } : r
          ),
        }))
        return updated
      } catch (e) {
        console.error(e)
        return result
      }
    }
    return result
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
      set({ token: r.access_token, role: r.role, userId: Number(r.user_id) || null, name: r.name })
      return true
    } catch { return false }
  },

  login: async (email, password) => {
    if (!USE_API) return false
    try {
      const r = await api.login(email, password)
      setToken(r.access_token)
      set({ token: r.access_token, role: r.role, userId: r.user_id, name: r.name, email })
      return true
    } catch { return false }
  },

  logout: () => { setToken(null); set({ token: null, role: null, userId: null, name: '', email: '' }) },
}))
