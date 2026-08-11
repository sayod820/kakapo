'use client'
import { useEffect, useRef } from 'react'
import { USE_API } from './config'
import { useProducts, useRestaurants, useOrders, usePromos, mergeOrderFields, applyAdminPins } from './store'
import { syncCourierStoresFromApi } from './courierStore'
import { syncClientsFromApi } from './clientStore'
import { syncCardsFromApi } from './cardStore'
import { syncAssemblerTeamFromApi } from './assemblerTeamStore'
import { syncPushFromApi } from './pushStore'
import { softSyncPosAfterSale, softSyncWarehouse, syncPosFromApi } from './posStore'
import { clearAppDataLocalCacheOnce } from './localCache'
import { useWebSocket } from './ws'
import { isCashierCritical } from './cashierUiGate'

export type SyncMode = 'all' | 'assembler' | 'courier' | 'restaurant' | 'catalog' | 'pos'

const INTERVAL_MS = 12000
/** Торговля: реже и легче — полный POS-снимок больше не гоняем каждые 30с */
const POS_INTERVAL_MS = 45000
/** Схлопываем пачки WS-событий, чтобы касса не дёргалась */
const PULL_DEBOUNCE_MS = 400

function wsRoleForMode(mode: SyncMode) {
  if (mode === 'assembler') return 'assembler' as const
  if (mode === 'courier') return 'courier' as const
  if (mode === 'restaurant') return 'restaurant' as const
  if (mode === 'pos') return 'pos' as const
  return 'admin' as const
}

type PullKind = 'crm' | 'pos' | 'posSoft' | 'posWarehouse' | 'products'

function createDebouncedPullers() {
  const timers: Partial<Record<PullKind, ReturnType<typeof setTimeout>>> = {}
  const pending = new Set<PullKind>()

  function schedule(kind: PullKind, run: () => void) {
    pending.add(kind)
    if (timers[kind]) clearTimeout(timers[kind])
    timers[kind] = setTimeout(() => {
      pending.delete(kind)
      delete timers[kind]
      try { run() } catch (e) { console.error('[kakapo] pull failed', kind, e) }
    }, PULL_DEBOUNCE_MS)
  }

  return {
    crm: () => schedule('crm', () => {
      void syncClientsFromApi()
      void syncCardsFromApi()
    }),
    pos: () => schedule('pos', () => {
      if (isCashierCritical()) return
      void syncPosFromApi()
    }),
    products: () => schedule('products', () => {
      if (isCashierCritical()) return
      void useProducts.getState().fetchProducts()
    }),
    posSoft: () => schedule('posSoft', () => {
      if (isCashierCritical()) return
      void softSyncPosAfterSale()
    }),
    posWarehouse: () => schedule('posWarehouse', () => {
      if (isCashierCritical()) return
      void softSyncWarehouse()
    }),
    flushAll: () => {
      for (const t of Object.values(timers)) if (t) clearTimeout(t)
      for (const k of Object.keys(timers) as PullKind[]) delete timers[k]
      pending.clear()
    },
  }
}

export function useApiSync(mode: SyncMode = 'all') {
  const pullersRef = useRef<ReturnType<typeof createDebouncedPullers> | null>(null)
  if (!pullersRef.current) pullersRef.current = createDebouncedPullers()
  const pull = pullersRef.current
  const posTickRef = useRef(0)

  useWebSocket(wsRoleForMode(mode), (msg) => {
    if (!USE_API) return
    if (msg.event === 'loyalty_update') {
      pull.crm()
      return
    }
    if (msg.event === 'courier_wallet_update') {
      void syncCourierStoresFromApi()
      return
    }
    if (msg.event === 'product_update') {
      const incoming = msg.product
      if (incoming?.deleted) {
        const ids = Array.isArray(incoming.ids)
          ? incoming.ids.map(Number).filter(n => Number.isFinite(n))
          : incoming.id != null
            ? [Number(incoming.id)]
            : []
        if (ids.length) {
          const idSet = new Set(ids)
          useProducts.setState(s => ({
            products: s.products.filter(p => !idSet.has(Number(p.id))),
          }))
        }
      } else if (incoming?.id && (incoming.name || Object.prototype.hasOwnProperty.call(incoming, 'photo'))) {
        void import('./offline').then(({ sanitizeProductForLocalCache, cacheProducts }) => {
          const cleaned = sanitizeProductForLocalCache(incoming as import('./types').Product)
          useProducts.setState(s => {
            const exists = s.products.some(p => p.id === Number(cleaned.id))
            const products = exists
              ? s.products.map(p => p.id === Number(cleaned.id) ? { ...p, ...cleaned } : p)
              : [...s.products, cleaned]
            void cacheProducts(products)
            return { products }
          })
        }).catch(() => {
          useProducts.setState(s => {
            const exists = s.products.some(p => p.id === Number(incoming.id))
            return {
              products: exists
                ? s.products.map(p => p.id === Number(incoming.id) ? { ...p, ...incoming } : p)
                : [...s.products, incoming],
            }
          })
        })
      }
      pull.products()
      return
    }
    if (msg.event === 'restaurant_update') {
      const incoming = msg.restaurant
      if (incoming?.id) {
        useRestaurants.setState(s => ({
          restaurants: s.restaurants.some(r => r.id === incoming.id)
            ? s.restaurants.map(r => r.id === incoming.id ? { ...r, ...incoming } : r)
            : [...s.restaurants, incoming],
          loaded: true,
        }))
      }
      void useRestaurants.getState().fetchRestaurants()
      return
    }
    if (msg.event === 'category_update') {
      const incoming = msg.category
      if (incoming?.deleted) {
        void import('./useCategories').then(({ applyCategoryDeletion }) => {
          applyCategoryDeletion({
            ids: Array.isArray(incoming.ids)
              ? incoming.ids
              : incoming.id != null
                ? [incoming.id]
                : [],
            slugs: Array.isArray(incoming.slugs) ? incoming.slugs : undefined,
          })
        })
        pull.products()
      }
      window.dispatchEvent(new CustomEvent('kakapo:categories'))
      return
    }
    if (msg.event === 'pos_update') {
      const kind = String(msg.payload?.kind || msg.payload?.reason || '')
      // CRM / лояльность — сразу клиенты и карты
      if (kind === 'crm' || kind === 'client-cash-topup' || kind === 'debt-repay' || kind === 'sale') {
        pull.crm()
      }
      // Продажа / смена — только лёгкий sync (как касса)
      if (kind === 'sale' || kind === 'sale-return' || kind === 'shift') {
        pull.posSoft()
        return
      }
      // Склад / поставщики / финансы — лёгкий warehouse sync, без 13 эндпоинтов
      if (
        kind.includes('stock')
        || kind.includes('receipt')
        || kind.includes('writeoff')
        || kind.includes('revision')
        || kind.includes('supplier')
        || kind.includes('expense')
        || kind.includes('finance')
      ) {
        pull.posWarehouse()
        return
      }
      // Неизвестный kind — мягко, не полный снимок
      pull.posSoft()
      return
    }
    if (msg.order) {
      const pins = useOrders.getState().orderAdminPins
      const pin = pins[msg.order.id]
      const order = pin
        ? { ...msg.order, ...pin, status: pin.status ?? msg.order.status }
        : msg.order
      useOrders.setState(s => {
        const exists = s.orders.some(o => o.id === order.id)
        const next = exists
          ? s.orders.map(o => o.id === order.id ? mergeOrderFields(o, order, pin) : o)
          : [order, ...s.orders]
        return { orders: applyAdminPins(next, pins) }
      })
      return
    }
    const orders = useOrders.getState()
    if (mode === 'assembler') orders.fetchAssemblerOrders()
    else if (mode === 'courier') orders.fetchCourierOrders()
    else if (mode === 'restaurant') orders.fetchRestaurantOrders()
    else if (mode === 'pos') {
      pull.posSoft()
      pull.crm()
    }
    else if (mode === 'all') orders.fetchOrders()
  })

  useEffect(() => {
    if (!USE_API) return

    const load = async () => {
      try {
        // Касса: пока идёт поиск/оплата — не трогаем UI тяжёлым sync
        if (mode === 'pos' && isCashierCritical()) return

        if (mode === 'all') {
          await Promise.allSettled([syncClientsFromApi(), syncCardsFromApi()])
        }
        const { syncLoyaltyStatusConfigFromApi } = await import('./loyaltyStatusConfig')
        if (mode === 'pos') {
          // Торговля как касса: локально уже есть данные; фон — лёгкий sync
          posTickRef.current += 1
          const tick = posTickRef.current
          const tasks: Promise<unknown>[] = [
            syncLoyaltyStatusConfigFromApi(),
            softSyncPosAfterSale(),
            softSyncWarehouse(),
            syncClientsFromApi(),
            syncCardsFromApi(),
          ]
          // Каталог товаров — не каждый тик (тяжело на слабом интернете)
          if (tick === 1 || tick % 3 === 0) {
            tasks.push(useProducts.getState().fetchProducts())
          }
          // Полный POS-снимок — редко (раз в ~3 мин при 45с интервале)
          if (tick === 1 || tick % 4 === 0) {
            tasks.push(syncPosFromApi())
          }
          await Promise.allSettled(tasks)
          return
        }

        const tasks: Promise<unknown>[] = [
          syncLoyaltyStatusConfigFromApi(),
          useProducts.getState().fetchProducts(),
          usePromos.getState().fetchPromos(),
          useRestaurants.getState().fetchRestaurants(),
          syncCourierStoresFromApi(),
        ]
        if (mode === 'all') {
          tasks.push(syncAssemblerTeamFromApi(), syncPushFromApi())
        }
        if (mode === 'assembler') tasks.push(useOrders.getState().fetchAssemblerOrders())
        else if (mode === 'courier') tasks.push(useOrders.getState().fetchCourierOrders())
        else if (mode === 'restaurant') tasks.push(useOrders.getState().fetchRestaurantOrders())
        else if (mode === 'all') tasks.push(useOrders.getState().fetchOrders())
        await Promise.allSettled(tasks)
      } catch (e) {
        console.error('[kakapo] useApiSync load failed', e)
      }
    }

    // Не блокируем UI: старт в фоне
    void load()
    const id = setInterval(() => { void load() }, mode === 'pos' ? POS_INTERVAL_MS : INTERVAL_MS)
    return () => {
      clearInterval(id)
      pull.flushAll()
    }
  }, [mode, pull])
}

/** Однократная загрузка при старте (layout) */
export function hydrateAllFromApi() {
  if (!USE_API || startedGuard) return
  startedGuard = true
  clearAppDataLocalCacheOnce()
  void import('./loyaltyStatusConfig').then(m => m.syncLoyaltyStatusConfigFromApi()).catch(() => {})
  useProducts.getState().fetchProducts()
  usePromos.getState().fetchPromos()
  useRestaurants.getState().fetchRestaurants()
  useOrders.getState().fetchOrders()
  void syncCourierStoresFromApi()
  void syncClientsFromApi()
  void syncCardsFromApi()
  void syncAssemblerTeamFromApi()
  void syncPushFromApi()
}

let startedGuard = false
