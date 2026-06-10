import type { Order, OrderStatus } from './types'
import type { DemoCourierOrder } from './demoOrders'
import { restIdToPickupId } from './pickups'

/** Заказы API → формат «Мои заказы» в StoreApp */
export function mapOrdersForClient(orders: Order[]) {
  return orders.map(o => ({
    id: o.id,
    date: 'Сегодня',
    time: o.createdAt || '',
    status: clientStatus(o.status),
    eta: o.status === 'delivering' ? '~15 мин' : null,
    items: (o.items || []).map(it => ({
      e: it.e || '📦',
      name: it.name,
      qty: it.qty,
      price: it.price,
    })),
    total: o.total,
    bonus: Math.round(o.total * 0.02),
    delivery: o.deliveryFee ?? 0,
    addr: o.client?.addr || '',
    cancelReason: o.status === 'cancelled' ? 'Отменён' : undefined,
  }))
}

function clientStatus(s: string): string {
  if (s === 'new' || s === 'assembling') return 'assembling'
  if (s === 'assembler_done' || s === 'courier_picked') return 'delivering'
  if (s === 'delivering') return 'delivering'
  if (s === 'delivered') return 'delivered'
  if (s === 'cancelled') return 'cancelled'
  if (s === 'cooking' || s === 'ready') return 'delivering'
  return 'pending'
}

/** Админка — таблица заказов */
export function mapOrdersForAdmin(orders: Order[]) {
  return orders.map(o => ({
    id: o.id,
    type: o.type,
    client: o.client?.name || '',
    phone: o.client?.phone || '',
    items: (o.items || []).map(it => it.name).join(', '),
    total: o.total,
    status: o.status,
    courier: o.courier?.name || '—',
    assembler: o.assembler?.name || '—',
    time: o.createdAt || '',
    addr: o.client?.addr || '',
    rest: o.restName || '',
  }))
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

/** Сборщик — заказы магазина */
export function mapOrdersForAssembler(orders: Order[]) {
  return orders
    .filter(o => o.type === 'market' && (o.status === 'new' || o.status === 'assembling'))
    .map(o => ({
      id: o.id,
      time: o.createdAt || '',
      priority: o.priority || 'normal',
      client: { name: o.client.name, phone: o.client.phone, addr: o.client.addr },
      courier: o.courier || { name: '—', phone: '' },
      comment: o.comment || '',
      items: (o.items || []).map(it => ({
        id: it.id,
        art: it.art || '',
        e: it.e,
        name: it.name,
        qty: it.qty,
        unit: it.unit,
        price: it.price,
        done: it.done ?? false,
      })),
    }))
}

/** Курьер — список на карте */
export function mapOrdersForCourier(orders: Order[]): DemoCourierOrder[] {
  return orders
    .filter(o => !['delivered', 'cancelled'].includes(o.status))
    .map(o => ({
      id: o.id,
      pickupIds: o.pickupIds?.length
        ? o.pickupIds
        : o.restId
          ? [restIdToPickupId(o.restId)]
          : ['store'],
      client: o.client?.name || '',
      phone: o.client?.phone || '',
      addr: o.client?.addr || '',
      lat: o.client?.lat ?? 38.325,
      lng: o.client?.lng ?? 69.028,
      weight: Math.round((o.weightKg ?? Math.max(1, (o.items?.reduce((s, i) => s + i.qty, 0) || 1) * 0.4)) * 10) / 10,
      pay: 'Наличными',
      time: o.createdAt || '',
      sum: Math.max(0, o.total - (o.deliveryFee ?? 0)),
      items: (o.items || []).map(it => ({ e: it.e, n: it.name, q: it.qty, p: it.price })),
    }))
}

/** Ресторан — заказы партнёра */
export function mapOrdersForRestaurant(orders: Order[], restId: string) {
  return orders
    .filter(o => o.type === 'restaurant' && o.restId === restId)
    .map(o => ({
      id: o.id,
      time: o.createdAt || '',
      client: o.client.name,
      phone: o.client.phone,
      items: o.items.map(it => ({ e: it.e, name: it.name, qty: it.qty, price: it.price })),
      total: o.total,
      status: o.status,
      addr: o.client.addr,
      comment: o.comment || '',
    }))
}
