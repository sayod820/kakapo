import type { Order, OrderStatus } from './types'
import type { DemoCourierOrder } from './demoOrders'
import {
  allPartsDone,
  anyPartDone,
  getMarketItems,
  getMarketStatus,
  getRestItems,
  getRestPartStatus,
  getRestIdsFromOrder,
  getReadyUnpickedPickupIds,
  getPendingPartsForCourier,
  isMarketPartActive,
  isMixedOrder,
  isRestPartActive,
  normalizeOrder,
  restPartToUiStatus,
} from './orderParts'

/** Заказы API → формат «Мои заказы» в StoreApp */
export function mapOrdersForClient(orders: Order[]) {
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
      bonus: Math.round(order.total * 0.02),
      delivery: order.deliveryFee ?? 0,
      addr: order.client?.addr || '',
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

/** Заказ доступен курьеру (хотя бы одна часть готова) */
export function isCourierReadyOrder(o: Order): boolean {
  const order = normalizeOrder(o)
  if (order.status === 'delivered' || order.status === 'cancelled') return false
  if (['courier_picked', 'delivering'].includes(order.status)) return false
  if (isMixedOrder(order)) return anyPartDone(order) && (order.status === 'ready' || order.status === 'assembler_done')
  if (order.type === 'market') return order.status === 'assembler_done'
  if (order.type === 'restaurant') return order.status === 'ready'
  return false
}

/** Заказы курьера для синхронизации (доступные + уже принятые) */
export function isCourierSyncOrder(o: Order): boolean {
  const order = normalizeOrder(o)
  if (order.status === 'delivered' || order.status === 'cancelled') return false
  return isCourierReadyOrder(order) || order.status === 'courier_picked' || order.status === 'delivering'
}

/** Заказы курьера в сторе: активные + завершённые (для истории и заработка) */
export function isCourierRoleOrder(o: Order): boolean {
  return isCourierSyncOrder(o) || o.status === 'delivered'
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

/** Админка — таблица заказов */
export function mapOrdersForAdmin(orders: Order[]) {
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
      status: order.status,
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
      pickedUpIds: order.pickedUpIds,
    }
  })
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

export function isAssemblerOrder(o: Order): boolean {
  const order = normalizeOrder(o)
  if (isMixedOrder(order)) return isMarketPartActive(order)
  return order.type === 'market' && (order.status === 'new' || order.status === 'assembling')
}

/** Сборщик — только товары магазина из заказа */
export function mapOrdersForAssembler(orders: Order[]) {
  return orders
    .filter(isAssemblerOrder)
    .map(o => {
      const order = normalizeOrder(o)
      const marketItems = getMarketItems(order.items)
      return {
        id: order.id,
        time: order.createdAt || '',
        priority: order.priority || 'normal',
        mixed: isMixedOrder(order),
        client: { name: order.client.name, phone: order.client.phone, addr: order.client.addr },
        courier: order.courier || { name: '—', phone: '' },
        comment: order.comment || '',
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
    })
}

/** Один заказ → формат курьера (с учётом частичной готовности) */
export function mapSingleOrderForCourier(o: Order): import('./demoOrders').DemoCourierOrder {
  const order = normalizeOrder(o)
  const routePickupIds = getReadyUnpickedPickupIds(order)
  const pendingParts = getPendingPartsForCourier(order)
  return {
    id: order.id,
    pickupIds: routePickupIds,
    mapPickupIds: routePickupIds,
    mixed: isMixedOrder(order),
    pendingParts,
    pickedUpIds: order.pickedUpIds || [],
    client: order.client?.name || '',
    phone: order.client?.phone || '',
    addr: order.client?.addr || '',
    lat: order.client?.lat ?? 38.325,
    lng: order.client?.lng ?? 69.028,
    weight: Math.round((order.weightKg ?? Math.max(1, (order.items?.reduce((s, i) => s + i.qty, 0) || 1) * 0.4)) * 10) / 10,
    pay: 'Наличными',
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
}

/** Курьер — после готовности хотя бы одной части */
export function mapOrdersForCourier(orders: Order[]): import('./demoOrders').DemoCourierOrder[] {
  return orders
    .filter(o => isCourierReadyOrder(o))
    .map(o => mapSingleOrderForCourier(o))
}

/** Ресторан — только блюда своего ресторана из заказа */
export function mapOrdersForRestaurant(orders: Order[], restId: string) {
  return orders
    .filter(o => {
      const order = normalizeOrder(o)
      if (!getRestItems(order.items, restId).length) return false
      if (isMixedOrder(order)) return isRestPartActive(order, restId)
      return String(order.restId) === String(restId)
    })
    .map(o => {
      const order = normalizeOrder(o)
      const restItems = getRestItems(order.items, restId)
      const partStatus = isMixedOrder(order)
        ? restPartToUiStatus(getRestPartStatus(order, restId))
        : order.status
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
