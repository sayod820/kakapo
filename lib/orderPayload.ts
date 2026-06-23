/** Нормализация заказа под KAKAPO API */
import { restIdToPickupId } from './pickups'
import { getRestIdsFromOrder, getMarketItems, inferOrderType } from './orderParts'
import type { OrderItem } from './types'

export function sanitizeOrderPayload(raw: Record<string, unknown>) {
  const client = (raw.client as Record<string, unknown>) || {}
  const name = String(client.name ?? raw.client_name ?? '').trim()
  const phone = String(client.phone ?? raw.client_phone ?? '').trim()
  const addr = String(client.addr ?? raw.address ?? '').trim()
  const lat = Number(client.lat ?? raw.lat ?? 0) || 0
  const lng = Number(client.lng ?? raw.lng ?? 0) || 0

  const items = Array.isArray(raw.items) ? raw.items : []
  const cleanItems = items.map((it: Record<string, unknown>) => {
    const source = it.source === 'restaurant' || it.restId ? 'restaurant' : 'market'
    const item: Record<string, unknown> = {
      name: String(it.name ?? 'Товар').trim() || 'Товар',
      price: Number(it.price) || 0,
      qty: Math.max(1, Math.round(Number(it.qty) || 1)),
      unit: String(it.unit ?? 'шт'),
      e: String(it.e ?? it.emoji ?? '📦'),
      source,
    }
    const pid = it.id ?? it.product_id
    if (typeof pid === 'number' && pid > 0) {
      item.id = pid
      item.product_id = pid
    }
    const art = it.art ?? it.article
    if (art) item.art = String(art)
    if (source === 'restaurant' && it.restId) item.restId = String(it.restId)
    return item
  })

  if (!cleanItems.length) {
    throw new Error('Корзина пуста')
  }

  const orderType = inferOrderType({
    type: raw.type as 'market' | 'restaurant' | 'mixed' | undefined,
    items: cleanItems as OrderItem[],
  })

  const restIds = Array.isArray(raw.restIds)
    ? raw.restIds.map(String)
    : getRestIdsFromOrder({
      type: orderType,
      items: cleanItems as OrderItem[],
      restId: raw.restId ? String(raw.restId) : undefined,
    } as Parameters<typeof getRestIdsFromOrder>[0])

  const pickupIds = Array.isArray(raw.pickupIds) && raw.pickupIds.length
    ? raw.pickupIds
    : [
      ...(getMarketItems(cleanItems as OrderItem[]).length ? ['store'] : []),
      ...restIds.map(restIdToPickupId),
    ]

  const payload: Record<string, unknown> = {
    type: orderType,
    items: cleanItems,
    client: { name, phone, addr, lat, lng },
    client_name: name,
    client_phone: phone,
    address: addr,
    lat,
    lng,
    total: Number(Number(raw.total ?? 0).toFixed(2)),
    deliveryFee: Number(Number(raw.deliveryFee ?? 0).toFixed(2)),
    // Не блокируем пересчёт при placeholder 0 — сумма фиксируется при доставке курьером
    deliveryFeeLocked: Number(raw.deliveryFee) > 0 && raw.deliveryFeeLocked === true,
    pickupIds: pickupIds.length ? pickupIds : ['store'],
    comment: String(raw.comment ?? ''),
    payment_method: String(raw.payment_method ?? raw.pay ?? 'cash'),
    pay: String(raw.payment_method ?? raw.pay ?? 'cash'),
    priority: 'normal',
  }

  const creditAmt = Number(raw.creditAmount)
  if (raw.payment_method === 'credit' || raw.pay === 'credit') {
    payload.creditAmount = Number.isFinite(creditAmt) && creditAmt >= 0
      ? Number(creditAmt.toFixed(2))
      : Number(Math.max(0, Number(payload.total) - Number(payload.deliveryFee)).toFixed(2))
  }
  if (raw.vip === true) payload.vip = true

  if (orderType === 'mixed') {
    if (raw.marketStatus) payload.marketStatus = raw.marketStatus
    if (raw.restParts) payload.restParts = raw.restParts
  }

  if (restIds.length) {
    payload.restIds = restIds
    payload.restId = String(raw.restId ?? restIds[0])
    if (raw.restName) payload.restName = String(raw.restName)
  } else if (raw.restId) {
    payload.restId = String(raw.restId)
    if (raw.restName) payload.restName = String(raw.restName)
  }

  const dist = Number(raw.distanceKm)
  if (dist > 0) payload.distanceKm = Number(dist.toFixed(2))
  const dur = Number(raw.durationMin)
  if (dur > 0) payload.durationMin = Math.round(dur)
  const w = Number(raw.weightKg)
  if (w > 0) payload.weightKg = Number(w.toFixed(1))

  return payload
}
