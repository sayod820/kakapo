import type { AdminAssembler } from './assemblerTeam'
import { getAssemblerTeam, isAssemblerOrderClaimed } from './assemblerTeam'
import { hasOrderCourierAssigned } from './orderUiMap'
import {
  allPickupsCollected,
  getAllPickupIds,
  normalizeOrder,
} from './orderParts'
import { type PickupPoint } from './pickups'
import type { Order } from './types'

export type ClientOrderContactRole = 'assembler' | 'store' | 'restaurant' | 'courier'

export interface ClientOrderContact {
  pickupId?: string
  role: ClientOrderContactRole
  label: string
  name: string
  phone: string
  pointName?: string
  emoji: string
  /** Точка, откуда курьер уже забрал заказ */
  pickedUpFrom?: string
}

export function telHref(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 9 ? `tel:${digits}` : '#'
}

function lookupAssembler(
  order: Order,
  assemblers: AdminAssembler[],
): { name: string; phone: string } | null {
  const primary = order.assembler
  if (primary?.id) {
    const a = assemblers.find(x => x.id === primary.id)
    if (a?.phone) return { name: a.name, phone: a.phone }
  }
  if (primary?.name) {
    const a = assemblers.find(x => x.name === primary.name)
    if (a?.phone) return { name: a.name, phone: a.phone }
  }
  for (const m of getAssemblerTeam(order)) {
    const a = assemblers.find(x => (m.id && x.id === m.id) || x.name === m.name)
    if (a?.phone) return { name: a.name, phone: a.phone }
  }
  return null
}

function pickupById(pickups: PickupPoint[], id: string): PickupPoint | undefined {
  return pickups.find(p => p.id === id)
}

function storeContact(
  order: Order,
  pickups: PickupPoint[],
  assemblers: AdminAssembler[],
): ClientOrderContact {
  const pickup = pickupById(pickups, 'store')
  if (isAssemblerOrderClaimed(order)) {
    const asm = lookupAssembler(order, assemblers)
    if (asm?.phone) {
      return {
        pickupId: 'store',
        role: 'assembler',
        label: 'Сборщик',
        name: asm.name,
        phone: asm.phone,
        pointName: pickup?.name,
        emoji: '📦',
      }
    }
  }
  return {
    pickupId: 'store',
    role: 'store',
    label: 'Магазин',
    name: pickup?.name || 'Магазин',
    phone: pickup?.phone || '',
    pointName: pickup?.name,
    emoji: pickup?.e || '🏪',
  }
}

function restaurantContact(pickupId: string, pickups: PickupPoint[]): ClientOrderContact {
  const pickup = pickupById(pickups, pickupId)
  return {
    pickupId,
    role: 'restaurant',
    label: 'Ресторан',
    name: pickup?.name || 'Ресторан',
    phone: pickup?.phone || '',
    pointName: pickup?.name,
    emoji: pickup?.e || '🍽',
  }
}

function courierContact(
  order: Order,
  pickups: PickupPoint[],
  pickedUpFrom?: string,
): ClientOrderContact {
  const pickup = pickedUpFrom ? pickupById(pickups, pickedUpFrom) : undefined
  return {
    pickupId: pickedUpFrom,
    role: 'courier',
    label: 'Курьер',
    name: order.courier?.name || 'Курьер',
    phone: order.courier?.phone || '',
    pickedUpFrom,
    pointName: pickup?.name,
    emoji: '🛵',
  }
}

function resolvePickupContact(
  order: Order,
  pickupId: string,
  pickups: PickupPoint[],
  assemblers: AdminAssembler[],
): ClientOrderContact {
  if (pickupId === 'store') return storeContact(order, pickups, assemblers)
  return restaurantContact(pickupId, pickups)
}

/** Контакты для клиента: сборщик / магазин / ресторан / курьер по этапам заказа */
export function resolveClientOrderContacts(
  raw: Order,
  pickups: PickupPoint[],
  assemblers: AdminAssembler[] = [],
): ClientOrderContact[] {
  const order = normalizeOrder(raw)
  if (order.status === 'delivered' || order.status === 'cancelled') return []

  const pickupIds = getAllPickupIds(order)
  if (!pickupIds.length) return []

  const courierAssigned = hasOrderCourierAssigned(order.courier)
  const picked = new Set(order.pickedUpIds || [])

  if (courierAssigned && allPickupsCollected(order)) {
    const c = courierContact(order, pickups)
    return c.phone ? [c] : []
  }

  const out: ClientOrderContact[] = []
  for (const pid of pickupIds) {
    if (courierAssigned && picked.has(pid)) {
      const c = courierContact(order, pickups, pid)
      if (c.phone) out.push(c)
    } else {
      const c = resolvePickupContact(order, pid, pickups, assemblers)
      if (c.phone) out.push(c)
    }
  }

  if (!out.length && courierAssigned && order.courier?.phone) {
    return [courierContact(order, pickups)]
  }

  return out
}

/** Подпись точки для UI (магазин / ресторан) */
export function clientContactPointLabel(c: ClientOrderContact, pickups: PickupPoint[]): string {
  if (c.pickedUpFrom) {
    const p = pickupById(pickups, c.pickedUpFrom)
    return p ? `Забрал: ${p.name}` : 'Забрал заказ'
  }
  if (c.pointName) return c.pointName
  if (c.pickupId) return pickupById(pickups, c.pickupId)?.name || ''
  return ''
}
