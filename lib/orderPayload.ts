/** Нормализация заказа под KAKAPO API (Render) */
export function sanitizeOrderPayload(raw: Record<string, unknown>) {
  const client = (raw.client as Record<string, unknown>) || {}
  const name = String(client.name ?? raw.client_name ?? '').trim()
  const phone = String(client.phone ?? raw.client_phone ?? '').trim()
  const addr = String(client.addr ?? raw.address ?? '').trim()
  const lat = Number(client.lat ?? raw.lat ?? 0) || 0
  const lng = Number(client.lng ?? raw.lng ?? 0) || 0

  const items = Array.isArray(raw.items) ? raw.items : []
  const cleanItems = items.map((it: Record<string, unknown>) => {
    const item: Record<string, unknown> = {
      name: String(it.name ?? 'Товар').trim() || 'Товар',
      price: Number(it.price) || 0,
      qty: Math.max(1, Math.round(Number(it.qty) || 1)),
      unit: String(it.unit ?? 'шт'),
      e: String(it.e ?? it.emoji ?? '📦'),
    }
    const pid = it.id ?? it.product_id
    if (typeof pid === 'number' && pid > 0) item.product_id = pid
    const art = it.art ?? it.article
    if (art) item.art = String(art)
    return item
  })

  if (!cleanItems.length) {
    throw new Error('Корзина пуста')
  }

  const payload: Record<string, unknown> = {
    type: raw.type === 'restaurant' ? 'restaurant' : 'market',
    items: cleanItems,
    client: { name, phone, addr, lat, lng },
    client_name: name,
    client_phone: phone,
    address: addr,
    lat,
    lng,
    total: Number(Number(raw.total ?? 0).toFixed(2)),
    deliveryFee: Number(Number(raw.deliveryFee ?? 0).toFixed(2)),
    pickupIds: Array.isArray(raw.pickupIds) && raw.pickupIds.length ? raw.pickupIds : ['store'],
    comment: String(raw.comment ?? ''),
    payment_method: String(raw.payment_method ?? raw.pay ?? 'cash'),
    priority: 'normal',
  }

  const dist = Number(raw.distanceKm)
  if (dist > 0) payload.distanceKm = Number(dist.toFixed(2))
  const dur = Number(raw.durationMin)
  if (dur > 0) payload.durationMin = Math.round(dur)
  const w = Number(raw.weightKg)
  if (w > 0) payload.weightKg = Number(w.toFixed(1))

  if (payload.type === 'restaurant' && raw.restId) {
    payload.restId = String(raw.restId)
  }

  return payload
}
