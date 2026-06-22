import type { Order, OrderStatus, OrderType } from './types'
import { enrichCourierOrderPayment, mapCourierPayLabel } from './courierPayment'
import type { DemoCourierOrder } from './demoOrders'
import { expectedOrderBonus } from './loyaltyBonus'
import {
  allPartsDone,
  allRestPartsDone,
  anyPartDone,
  getAllPickupIds,
  getMarketItems,
  getMarketStatus,
  getRestItems,
  getRestItemsForOrder,
  getRestPartStatus,
  getRestIdsFromOrder,
  hasRestPart,
  getCourierAcceptPickupIds,
  getPendingPartsForCourier,
  isMarketPartActive,
  isMixedOrder,
  hasMarketPart,
  isMarketItem,
  isRestPartActive,
  inferOrderType,
  normalizeOrder,
  restPartToUiStatus,
} from './orderParts'

/** Заказы API → формат «Мои заказы» в StoreApp */
export function mapOrdersForClient(
  orders: Order[],
  profile?: { level?: string; vip?: boolean; loyaltyPeriod?: string; bonusEligibleFrom?: string } | null,
) {
  return orders.map(o => {
    const order = normalizeOrder(o)
    const status = clientStatus(order)
    return {
      id: order.id,
      phone: order.client?.phone || '',
      date: 'Сегодня',
      time: order.createdAt || '',
      status,
      trackable: status === 'delivering',
      eta: status === 'delivering' ? '~15 мин' : null,
      items: (order.items || []).map(it => ({
        e: it.e || '📦',
        name: it.name,
        qty: it.qty,
        price: it.price,
      })),
      total: order.total,
      bonus: expectedOrderBonus(order, profile?.level, profile?.vip, orders, {
        loyaltyPeriod: profile?.loyaltyPeriod,
        bonusEligibleFrom: profile?.bonusEligibleFrom,
      }),
      bonusSpent: order.bonusSpent ?? 0,
      delivery: order.deliveryFee ?? 0,
      addr: order.client?.addr || '',
      restId: order.restId || order.items?.find(it => it.restId)?.restId || '',
      cancelReason: order.status === 'cancelled' ? 'Отменён' : undefined,
      orderType: order.type,
    }
  })
}

function clientStatus(o: Order): string {
  const order = normalizeOrder(o)
  const s = order.status

  if (isMixedOrder(order)) {
    if (s === 'courier_picked' || s === 'delivering') return 'delivering'
    if (s === 'delivered') return 'delivered'
    if (s === 'cancelled') return 'cancelled'
    if (anyPartDone(order) || s === 'assembler_done' || s === 'ready') return 'waiting_courier'
    return 'assembling'
  }

  if (order.type === 'restaurant') {
    if (s === 'new' || s === 'cooking') return 'cooking'
    if (s === 'ready') return 'waiting_courier'
    if (s === 'courier_picked' || s === 'delivering') return 'delivering'
    if (s === 'delivered') return 'delivered'
    if (s === 'cancelled') return 'cancelled'
    return 'pending'
  }

  if (s === 'new' || s === 'assembling') return 'assembling'
  if (s === 'assembler_done') return 'waiting_courier'
  if (s === 'ready') return 'waiting_courier'
  if (s === 'courier_picked' || s === 'delivering') return 'delivering'
  if (s === 'delivered') return 'delivered'
  if (s === 'cancelled') return 'cancelled'
  return 'pending'
}

/** Заказ виден на карте курьера (сразу после оформления) */
export function isCourierMapOrder(o: Order): boolean {
  const order = normalizeOrder(o)
  if (order.status === 'delivered' || order.status === 'cancelled') return false
  if (['courier_picked', 'delivering'].includes(order.status)) return false
  return ['new', 'assembling', 'cooking', 'ready', 'assembler_done'].includes(order.status)
}

/** Заказ полностью готов — можно забирать */
export function isCourierFullyReadyOrder(o: Order): boolean {
  const order = normalizeOrder(o)
  if (order.status === 'delivered' || order.status === 'cancelled') return false
  if (['courier_picked', 'delivering'].includes(order.status)) return false
  const t = inferOrderType(order)
  if (t === 'restaurant') {
    return order.status === 'ready' || allRestPartsDone(order)
  }
  if (!allPartsDone(order)) return false
  if (t === 'mixed') return ['ready', 'assembler_done'].includes(order.status)
  if (t === 'market') return order.status === 'assembler_done'
  return false
}

export function getCourierMapStatus(o: Order): 'waiting' | 'preparing' | 'ready' {
  const order = normalizeOrder(o)
  if (isCourierFullyReadyOrder(order)) return 'ready'
  const pending = getPendingPartsForCourier(order)
  if (pending.length) {
    const onlyWaiting = pending.every(p => p.status === 'Ожидает сборку' || p.status === 'Ожидает')
    return onlyWaiting ? 'waiting' : 'preparing'
  }
  if (order.status === 'new') return 'waiting'
  return 'preparing'
}

/** Подпись статуса на карте курьера — магазин и ресторан по-разному */
export function courierMapStatusLabel(
  status: 'waiting' | 'preparing' | 'ready',
  kind: OrderType = 'market',
): string {
  if (status === 'ready') return '✓ Можно забирать'
  if (status === 'preparing') {
    if (kind === 'restaurant') return '⏳ Готовится на кухне'
    if (kind === 'mixed') return '⏳ Готовится'
    return '⏳ Собирается в магазине'
  }
  if (kind === 'restaurant') return '🍽 Ожидает ресторан'
  if (kind === 'mixed') return '⏳ Ожидает магазин и ресторан'
  return '📦 Ещё не собирается'
}

export function courierWaitingBanner(
  status: 'waiting' | 'preparing',
  kind: OrderType,
): string {
  if (status === 'preparing') {
    if (kind === 'restaurant') return '⏳ Блюда готовятся на кухне — точка забора станет активной, когда ресторан отметит «Готово»'
    if (kind === 'mixed') return '⏳ Ждём готовность всех частей заказа'
    return '⏳ Товар собирается в магазине — точка забора появится после сборки'
  }
  if (kind === 'restaurant') return '🍽 Ресторан ещё не принял заказ — ждём подтверждения'
  if (kind === 'mixed') return '⏳ Заказ только оформлен — ждём магазин и ресторан'
  return '📦 Заказ ещё не собирается — ждём сборщика'
}

/** Заказ доступен курьеру (хотя бы одна часть готова) */
export function isCourierReadyOrder(o: Order): boolean {
  const order = normalizeOrder(o)
  if (order.status === 'delivered' || order.status === 'cancelled') return false
  if (['courier_picked', 'delivering'].includes(order.status)) return false
  const t = inferOrderType(order)
  if (t === 'restaurant') {
    return order.status === 'ready' || allRestPartsDone(order)
  }
  if (t === 'mixed') return anyPartDone(order) && (order.status === 'ready' || order.status === 'assembler_done')
  if (t === 'market') return order.status === 'assembler_done'
  return false
}

/** Заказы курьера для синхронизации (доступные + уже принятые) */
export function isCourierSyncOrder(o: Order): boolean {
  const order = normalizeOrder(o)
  if (order.status === 'delivered' || order.status === 'cancelled') return false
  return isCourierReadyOrder(order) || order.status === 'courier_picked' || order.status === 'delivering'
}

/** Заказы для карты курьера + активные доставки */
export function isCourierMapSyncOrder(o: Order): boolean {
  const order = normalizeOrder(o)
  if (order.status === 'delivered' || order.status === 'cancelled') return false
  return isCourierMapOrder(order) || order.status === 'courier_picked' || order.status === 'delivering'
}

/** Заказы курьера в сторе: карта + активные + завершённые (для истории и заработка) */
export function isCourierRoleOrder(o: Order): boolean {
  return isCourierMapSyncOrder(o) || o.status === 'delivered'
}

/** Админка — подписи статусов */
export const ADMIN_STATUS_LABELS: Record<string, { l: string; c: string }> = {
  new: { l: 'Новый', c: '#FF4545' },
  assembling: { l: 'Собирается', c: '#9B6DFF' },
  assembler_done: { l: 'Собран', c: '#9B6DFF' },
  cooking: { l: 'Готовится', c: '#FF8C00' },
  ready: { l: 'Готов', c: '#FFB800' },
  courier_picked: { l: 'У курьера', c: '#3B8EF0' },
  delivering: { l: 'В пути', c: '#3B8EF0' },
  delivered: { l: 'Доставлен', c: '#1FD760' },
  cancelled: { l: 'Отменён', c: '#3D6645' },
}

export function adminStatusLabel(status: string) {
  return ADMIN_STATUS_LABELS[status] || { l: status, c: '#8FB897' }
}

type RestCatalogEntry = { id: string; name: string; emoji?: string }

/** Название ресторана по id (для этапов смешанного заказа) */
export function resolveRestaurantName(
  restId: string,
  order: Pick<Order, 'restId' | 'restName' | 'items'>,
  restaurants: RestCatalogEntry[] = [],
): string {
  const id = String(restId)
  const fromCatalog = restaurants.find(r => String(r.id) === id)
  if (fromCatalog) {
    const em = fromCatalog.emoji?.trim()
    return em ? `${em} ${fromCatalog.name}` : fromCatalog.name
  }
  if (order.restId && String(order.restId) === id && order.restName) return order.restName
  return id
}

/** Админка — таблица заказов */
export function mapOrdersForAdmin(orders: Order[], restaurants: RestCatalogEntry[] = []) {
  return orders.map(o => {
    const order = normalizeOrder(o)
    return {
      id: order.id,
      type: order.type,
      client: order.client?.name || '',
      phone: order.client?.phone || '',
      items: (order.items || []).map(it => `${it.name}${it.qty > 1 ? ` ×${it.qty}` : ''}`).join(', '),
      itemsDetailed: (order.items || []).map(it => ({
        e: it.e,
        name: it.name,
        qty: it.qty,
        price: it.price,
        source: it.source,
        restId: it.restId,
      })),
      total: order.total,
      deliveryFee: order.deliveryFee,
      status: o.status ?? order.status,
      courier: order.courier?.name || '—',
      courierPhone: order.courier?.phone || '',
      assembler: order.assembler?.name || '—',
      time: order.createdAt || '',
      deliveredAt: order.deliveredAt || '',
      addr: order.client?.addr || '',
      comment: order.comment || '',
      rest: order.restName || '',
      marketStatus: order.marketStatus,
      restParts: order.restParts,
      restNameById: order.restParts
        ? Object.fromEntries(
            Object.keys(order.restParts).map(id => [id, resolveRestaurantName(id, order, restaurants)]),
          )
        : undefined,
      pickedUpIds: order.pickedUpIds,
    }
  })
}

/** Статусы, когда заказ уже у курьера */
export const COURIER_ASSIGNED_STATUSES: OrderStatus[] = ['courier_picked', 'delivering', 'delivered']

/** Доп. поля при смене статуса из админки */
export function adminExtrasForStatusChange(newStatus: OrderStatus): Record<string, unknown> {
  const extra: Record<string, unknown> = {}
  if (newStatus === 'delivered') {
    extra.deliveredAt = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  }
  if (!COURIER_ASSIGNED_STATUSES.includes(newStatus)) {
    extra.courier = null
    extra.courierRoute = null
    extra.pickedUpIds = []
  }
  if (newStatus === 'new') {
    extra.assembler = null
  }
  return extra
}

/** Полный patch для админки — принудительно переводит заказ в выбранный статус */
export function buildAdminStatusPatch(order: Order | undefined, newStatus: OrderStatus): Record<string, unknown> {
  const extra: Record<string, unknown> = {
    ...adminExtrasForStatusChange(newStatus),
    adminOverride: true,
  }
  if (!order) return extra

  const o = { ...order, status: newStatus }
  const items = o.items || []

  if (isMixedOrder(o)) {
    const restIds = getRestIdsFromOrder(o)
    const market = hasMarketPart(o)

    if (['new', 'cancelled'].includes(newStatus)) {
      if (market) extra.marketStatus = 'new'
      if (restIds.length) extra.restParts = Object.fromEntries(restIds.map(id => [id, 'new']))
      extra.items = items.map(it => ({ ...it, done: false }))
    } else if (newStatus === 'assembling') {
      if (market) extra.marketStatus = 'assembling'
      if (restIds.length) extra.restParts = Object.fromEntries(restIds.map(id => [id, 'new']))
      extra.items = items.map(it => ({ ...it, done: false }))
    } else if (newStatus === 'cooking') {
      if (market) extra.marketStatus = 'new'
      if (restIds.length) extra.restParts = Object.fromEntries(restIds.map(id => [id, 'cooking']))
      extra.items = items.map(it => ({ ...it, done: false }))
    } else if (newStatus === 'ready') {
      if (market) extra.marketStatus = 'done'
      if (restIds.length) extra.restParts = Object.fromEntries(restIds.map(id => [id, 'new']))
      extra.items = items.map(it => (isMarketItem(it) ? { ...it, done: true } : { ...it, done: false }))
    } else if (newStatus === 'assembler_done') {
      if (market) extra.marketStatus = 'done'
      if (restIds.length) extra.restParts = Object.fromEntries(restIds.map(id => [id, 'done']))
      extra.items = items.map(it => ({ ...it, done: true }))
    } else if (['courier_picked', 'delivering', 'delivered'].includes(newStatus)) {
      if (market) extra.marketStatus = 'done'
      if (restIds.length) extra.restParts = Object.fromEntries(restIds.map(id => [id, 'done']))
      extra.items = items.map(it => ({ ...it, done: true }))
    }
  } else if (o.type === 'market') {
    if (['new', 'assembling', 'cooking', 'cancelled'].includes(newStatus)) {
      extra.items = items.map(it => ({ ...it, done: false }))
    } else {
      extra.items = items.map(it => ({ ...it, done: true }))
    }
  }

  return extra
}

export const ADMIN_NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  new: 'assembling',
  assembling: 'assembler_done',
  assembler_done: 'delivering',
  courier_picked: 'delivering',
  cooking: 'ready',
  ready: 'delivering',
  delivering: 'delivered',
}

/** Все статусы для выбора в админке */
export const ADMIN_STATUS_OPTIONS: OrderStatus[] = [
  'new',
  'assembling',
  'assembler_done',
  'cooking',
  'ready',
  'courier_picked',
  'delivering',
  'delivered',
  'cancelled',
]

export function isAssemblerOrder(o: Order): boolean {
  const order = normalizeOrder(o)
  if (order.status === 'cancelled') return false
  if (isMixedOrder(order)) return isMarketPartActive(order)
  return order.type === 'market' && (order.status === 'new' || order.status === 'assembling')
}

/** Отменённый заказ с частью магазина — показываем сборщику до подтверждения */
export function isAssemblerCancelledVisible(o: Order): boolean {
  const order = normalizeOrder(o)
  if (order.status !== 'cancelled') return false
  const t = inferOrderType(order)
  return t === 'market' || (t === 'mixed' && hasMarketPart(order))
}

function mapAssemblerOrderShape(o: Order) {
  const order = normalizeOrder(o)
  const marketItems = getMarketItems(order.items)
  const ms = isMixedOrder(order) ? getMarketStatus(order) : order.status
  const cancelled = order.status === 'cancelled'
  const claimed = !!(order.assembler?.name || order.assembler?.id)
  const pool = !claimed && !cancelled && ms === 'new'
  return {
    id: order.id,
    time: order.createdAt || '',
    priority: order.priority || 'normal',
    mixed: isMixedOrder(order),
    queue: cancelled ? 'cancelled' as const : pool ? 'pool' as const : (ms === 'new' ? 'accepted' as const : 'assembling' as const),
    claimed,
    claimedBy: order.assembler?.name,
    cancelled,
    cancelReason: order.cancelReason || (cancelled ? 'Заказ отменён клиентом' : undefined),
    client: { name: order.client.name, phone: order.client.phone, addr: order.client.addr },
    courier: order.courier || { name: '—', phone: '' },
    comment: order.comment || '',
    assemblerNote: order.assemblerNote || '',
    items: marketItems.map((it, idx) => ({
      id: it.id ?? it.product_id ?? idx + 1,
      art: it.art || '',
      e: it.e,
      name: it.name,
      qty: it.qty,
      unit: it.unit,
      price: it.price,
      done: it.done ?? false,
    })),
  }
}

export function mapSingleOrderForAssembler(o: Order) {
  return mapAssemblerOrderShape(o)
}

/** Сборщик — только товары магазина из заказа */
export function mapOrdersForAssembler(orders: Order[]) {
  return orders
    .filter(isAssemblerOrder)
    .map(mapAssemblerOrderShape)
}

/** Отменённые заказы магазина — для подтверждения сборщиком */
export function mapCancelledOrdersForAssembler(orders: Order[]) {
  return orders
    .filter(isAssemblerCancelledVisible)
    .map(mapAssemblerOrderShape)
}

/** Один заказ → формат курьера (с учётом частичной готовности) */
export function mapSingleOrderForCourier(o: Order): import('./demoOrders').DemoCourierOrder {
  const order = normalizeOrder(o)
  const routePickupIds = getCourierAcceptPickupIds(order)
  const pendingParts = getPendingPartsForCourier(order)
  const base = {
    id: order.id,
    pickupIds: routePickupIds,
    mapPickupIds: routePickupIds,
    mixed: isMixedOrder(order),
    orderKind: inferOrderType(order),
    pendingParts,
    pickedUpIds: order.pickedUpIds || [],
    mapStatus: getCourierMapStatus(order),
    client: order.client?.name || '',
    phone: order.client?.phone || '',
    addr: order.client?.addr || '',
    lat: order.client?.lat ?? 38.325,
    lng: order.client?.lng ?? 69.028,
    weight: Math.round((order.weightKg ?? Math.max(1, (order.items?.reduce((s, i) => s + i.qty, 0) || 1) * 0.4)) * 10) / 10,
    pay: mapCourierPayLabel(order),
    time: order.createdAt || '',
    sum: Math.max(0, order.total - (order.deliveryFee ?? 0)),
    items: (order.items || []).map(it => ({
      e: it.e,
      n: it.name,
      q: it.qty,
      p: it.price,
      source: it.source,
    })),
  }
  return enrichCourierOrderPayment(base, order)
}

/** Все заказы на карте курьера (готовятся + готовые) */
export function mapOrdersForCourierMap(orders: Order[]): import('./demoOrders').DemoCourierOrder[] {
  return orders
    .filter(o => isCourierMapOrder(o))
    .map(o => mapSingleOrderForCourier(o))
}

/** Курьер — только полностью готовые к забору */
export function mapOrdersForCourier(orders: Order[]): import('./demoOrders').DemoCourierOrder[] {
  return orders
    .filter(o => isCourierFullyReadyOrder(o))
    .map(o => mapSingleOrderForCourier(o))
}

/** Ресторан — только блюда своего ресторана из заказа (включая доставленные) */
export function mapOrdersForRestaurant(orders: Order[], restId: string) {
  const rid = String(restId)
  return orders
    .filter(o => {
      const order = normalizeOrder(o)
      if (order.status === 'cancelled') return false
      if (!hasRestPart(order, rid)) return false
      if (isMixedOrder(order)) {
        if (order.status === 'delivered') return true
        const part = getRestPartStatus(order, rid)
        if (part === 'done') return true
        return isRestPartActive(order, rid)
      }
      return true
    })
    .map(o => {
      const order = normalizeOrder(o)
      const restItems = getRestItemsForOrder(order, rid)
      const partStatus = (() => {
        if (order.status === 'delivered') return 'delivered' as const
        if (isMixedOrder(order)) {
          const part = getRestPartStatus(order, restId)
          if (part === 'done') {
            if (['courier_picked', 'delivering'].includes(order.status)) return order.status
            return 'ready'
          }
          return restPartToUiStatus(part)
        }
        return order.status
      })()
      return {
        id: order.id,
        time: order.createdAt || '',
        client: order.client.name,
        phone: order.client.phone,
        items: restItems.map(it => ({ e: it.e, name: it.name, qty: it.qty, price: it.price })),
        total: restItems.reduce((s, it) => s + it.price * it.qty, 0),
        status: partStatus,
        addr: order.client.addr,
        comment: order.comment || '',
        mixed: isMixedOrder(order),
      }
    })
}
