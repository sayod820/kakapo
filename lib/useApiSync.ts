'use client'
import { useEffect, useRef } from 'react'
import { USE_API } from './config'
import { useProducts, useRestaurants, useOrders, usePromos, mergeOrderFields, applyAdminPins } from './store'
import { syncCourierStoresFromApi } from './courierStore'
import { syncClientsFromApi } from './clientStore'
import { syncCardsFromApi } from './cardStore'
import { syncAssemblerTeamFromApi } from './assemblerTeamStore'
import { syncPushFromApi } from './pushStore'
import { softSyncFinance, softSyncPosAfterSale, softSyncWarehouse } from './posStore'
import { clearAppDataLocalCacheOnce } from './localCache'
import { isWsLive, useWebSocket } from './ws'
import { requestDebtLedgerRefresh } from './useDebtLedgerRefresh'
import { isCashierCritical, isCashierPaymentCritical } from './cashierUiGate'
import { getTradeDeviceIdSync } from './tradeDevice'
import { createWsPullCoalescer } from './wsPullCoalesce'

export type SyncMode = 'all' | 'assembler' | 'courier' | 'restaurant' | 'catalog' | 'pos'

const INTERVAL_MS = 12000
/** Торговля: полный/тяжёлый фон реже — слабые ПК меньше фризятся онлайн */
const POS_INTERVAL_MS = 90000
/** Чеки с сервера (браузер → ПК): дельта pos-lite, не полный список */
const POS_SALES_INBOUND_MS = 35000
/** Живой WS приносит изменения сам — фоновые опросы кассы не чаще этого */
export const POS_WS_LIVE_POLL_MS = 5 * 60_000

function wsRoleForMode(mode: SyncMode) {
  if (mode === 'assembler') return 'assembler' as const
  if (mode === 'courier') return 'courier' as const
  if (mode === 'restaurant') return 'restaurant' as const
  if (mode === 'pos') return 'pos' as const
  if (mode === 'catalog') return 'client' as const
  return 'admin' as const
}

/** Phase 7: dirty-scope coalescer — crm + posSoft share one softSyncPosAfterSale runner. */
function createPosPullers() {
  return createWsPullCoalescer({
    crmSoft: () => {
      // Поиск кассы НЕ блокирует; оплата/пробитие — стоп
      if (isCashierPaymentCritical()) return
      void softSyncPosAfterSale({ force: true })
    },
    pos: () => {
      if (isCashierCritical()) return
      void import('./syncPull').then(({ pullSyncChanges }) => {
        void pullSyncChanges().catch(() => {})
      })
    },
    products: () => {
      if (isCashierCritical()) return
      void useProducts.getState().fetchProducts()
    },
    posWarehouse: () => {
      if (isCashierPaymentCritical()) return
      void softSyncWarehouse()
    },
    posFinance: () => {
      if (isCashierPaymentCritical()) return
      void softSyncFinance()
    },
  })
}

export function useApiSync(mode: SyncMode = 'all') {
  const pullersRef = useRef<ReturnType<typeof createPosPullers> | null>(null)
  if (!pullersRef.current) pullersRef.current = createPosPullers()
  const pull = pullersRef.current

  useWebSocket(wsRoleForMode(mode), (msg) => {
    if (!USE_API) return
    if (msg.event === 'restaurant_deleted') {
      void useRestaurants.getState().fetchRestaurants()
      return
    }
    if (msg.event === 'order_deleted') {
      const id = msg.order?.id
      if (id != null) {
        useOrders.setState(s => ({ orders: s.orders.filter(o => String(o.id) !== String(id)) }))
      }
      return
    }
    if (msg.event === 'loyalty_update') {
      pull.crm()
      requestDebtLedgerRefresh()
      return
    }
    if (msg.event === 'courier_wallet_update') {
      void syncCourierStoresFromApi()
      return
    }
    if (msg.event === 'product_update') {
      const incoming = msg.product
      const reason = String((incoming as { reason?: string })?.reason || '')
      if (/receipt|stock|layer|warehouse|revision/i.test(reason)) {
        pull.posWarehouse()
      }
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
          void import('./offline').then(({ cacheProducts }) => {
            void cacheProducts(useProducts.getState().products)
          }).catch(() => {})
        }
        // Удаление уже локально — полный /products не нужен
        return
      }
      if (incoming?.id && (
        incoming.name
        || Object.prototype.hasOwnProperty.call(incoming, 'photo')
        || Object.prototype.hasOwnProperty.call(incoming, 'photoThumb')
        || incoming.price != null
        || incoming.stock != null
      )) {
        // Точечный merge одного товара — без GET /products
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
          void import('./photoOfflineCache').then(({ prefetchProductPhotos }) => {
            prefetchProductPhotos([cleaned])
          }).catch(() => {})
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
        return
      }
      // Продажа/возврат: остатки и партии приходят дельтой — не качаем весь каталог
      if (mode === 'pos' && /^sale/i.test(reason)) {
        pull.pos()
        return
      }
      // Неполное WS-сообщение — редкий repair
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
      if (kind === 'device-unbind') {
        const unboundId = String(msg.payload?.deviceId || '')
        const mine = getTradeDeviceIdSync()
        if (unboundId && mine && unboundId === mine) {
          window.dispatchEvent(new CustomEvent('kakapo:device-revoked'))
        }
        return
      }
      // Пароли/права/блокировка: employeesAuthRev приходит в ответе /sync/changes
      if (kind === 'employee') {
        pull.pos()
        return
      }
      if (kind === 'loyalty-settings') {
        void import('./loyaltyStatusConfig').then(m => m.syncLoyaltyStatusConfigFromApi()).catch(() => {})
        pull.pos()
        return
      }
      // Phase 7: sale/shift → one crmSoft (pos-lite includes CRM). No duplicate crm+posSoft.
      if (kind === 'sale' || kind === 'sale-return' || kind === 'shift') {
        pull.posSoft()
        requestDebtLedgerRefresh()
        return
      }
      // CRM / лояльность без продажи
      if (kind === 'crm' || kind === 'debt-repay') {
        pull.crm()
        requestDebtLedgerRefresh()
        return
      }
      // Выдача наличных с кассы — меняет журнал долга
      if (kind === 'cashier') {
        pull.crm()
        requestDebtLedgerRefresh()
        return
      }
      // Склад / поставщики
      if (
        kind.includes('stock')
        || kind.includes('receipt')
        || kind.includes('writeoff')
        || kind.includes('revision')
        || kind.includes('supplier')
      ) {
        pull.posWarehouse()
        // Остатки товара приходят дельтой / product_update — полный каталог не качаем
        return
      }
      // Вклады / расходы / ящик
      if (
        kind.includes('expense')
        || kind.includes('finance')
        || kind.includes('vault')
        || kind === 'client-cash-topup'
      ) {
        pull.posFinance()
        if (kind === 'client-cash-topup') {
          pull.posSoft()
          requestDebtLedgerRefresh()
        }
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
      // One coalesced soft pass (was posSoft + crm duplicate)
      pull.posSoft()
    }
    else if (mode === 'all') orders.fetchOrders()
  }, undefined, mode === 'pos' ? () => {
    pull.pos()
    pull.posSoft()
    void useOrders.getState().fetchOrders()
  } : undefined)

  useEffect(() => {
    if (!USE_API) return

    let lastLoadAt = 0
    let lastSalesAt = 0

    const load = async (fromTimer = false, force = false) => {
      if (!force && mode === 'pos' && fromTimer && isWsLive('pos') && Date.now() - lastLoadAt < POS_WS_LIVE_POLL_MS) return
      lastLoadAt = Date.now()
      try {
        // Только оплата/пробитие — полный стоп. Фокус поиска НЕ блокирует входящие чеки.
        if (mode === 'pos' && isCashierPaymentCritical()) return
        if (!force && mode === 'pos' && typeof document !== 'undefined' && document.visibilityState === 'hidden') return

        if (mode === 'all') {
          await Promise.allSettled([syncClientsFromApi(), syncCardsFromApi()])
        }
        const { syncLoyaltyStatusConfigFromApi } = await import('./loyaltyStatusConfig')
        if (mode === 'pos') {
          const searchBusy = isCashierCritical() && !isCashierPaymentCritical()
          // Во время поиска — только лёгкая дельта чеков (mutex внутри), без склада/каталога
          if (searchBusy) {
            await softSyncPosAfterSale()
            return
          }
          // Каталог с диска до дельты: иначе дельта ляжет на пустой список и перезапишет кэш частью
          try {
            const { hydrateOfflineCaches } = await import('./offlineHydrate')
            await hydrateOfflineCaches()
          } catch { /* ignore */ }
          if (!useProducts.getState().products.length) {
            await useProducts.getState().fetchProducts().catch(() => {})
          }
          // Один /sync/changes (дельта since=cursor) вместо полных sales/clients/warehouse/finance
          const { pullSyncChanges } = await import('./syncPull')
          const { usePosStore } = await import('./posStore')
          const warehouseEmpty = !(usePosStore.getState().suppliers?.length)
            || !(usePosStore.getState().receipts?.length)
          await pullSyncChanges({ forceFull: warehouseEmpty }).catch(() => ({ ok: false as const }))
          const tasks: Promise<unknown>[] = [
            syncLoyaltyStatusConfigFromApi(),
          ]
          const localEmpty = !useProducts.getState().products.length
          // Полный каталог только если локалка пустая (первый запуск / повреждение)
          if (localEmpty) {
            tasks.push(useProducts.getState().fetchProducts())
          }
          // Поставщики/долги: дельта не шлёт неизменённые строки
          if (!(usePosStore.getState().suppliers?.length)) {
            tasks.push(softSyncWarehouse())
          }
          // Полный POS больше не гоняем по таймеру — только дельты (шаг B)
          await Promise.allSettled(tasks)
          return
        }

        const tasks: Promise<unknown>[] = [
          syncLoyaltyStatusConfigFromApi(),
          usePromos.getState().fetchPromos(),
          useRestaurants.getState().fetchRestaurants(),
        ]
        // layout ApiSyncProvider уже тянет /products — не качаем каталог дважды (магазин);
        // /pickups только для персонала
        if (mode !== 'catalog') {
          tasks.push(useProducts.getState().fetchProducts(), syncCourierStoresFromApi())
        }
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
    const id = setInterval(() => { void load(true) }, mode === 'pos' ? POS_INTERVAL_MS : INTERVAL_MS)
    // Отдельный inbound продаж (браузер → ПК/Android). Читать можно даже при очереди —
    // иначе локаль не видит чек в долг, который уже есть в браузере/на сервере.
    let salesId: ReturnType<typeof setInterval> | null = null
    if (mode === 'pos') {
      // Дельта чеков (pos-lite), без force — уважаем min gap, не долбим UI
      salesId = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
        if (isCashierPaymentCritical()) return
        if (isWsLive('pos') && Date.now() - lastSalesAt < POS_WS_LIVE_POLL_MS) return
        lastSalesAt = Date.now()
        void softSyncPosAfterSale()
      }, POS_SALES_INBOUND_MS)
    }
    // Возврат в окно/вкладку: не ждём очередного таймера — сразу догоняем изменения,
    // сделанные на других устройствах, пока окно было в фоне (скрытые окна не опрашивают сервер).
    const onVisible = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
      void load(true, true)
      if (mode === 'pos') void softSyncPosAfterSale({ force: true })
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(id)
      if (salesId) clearInterval(salesId)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
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
