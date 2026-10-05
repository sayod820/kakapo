/**
 * Store (public) orders: the server prices the order from the catalog.
 * Browser totals, VIP flag, credit and bonus spending are ignored — the customer
 * is identified only by a typed phone number until SMS login exists.
 * Mirrors lib/productWeight.ts, lib/productBulkPricing.ts, lib/productPromos.ts.
 */
import { calcDeliveryTotal, normalizePricing } from './deliveryFee.js'

const MIN_SANE_WEIGHT_GRAMS = 10
const DEFAULT_WEIGHT_STEP_GRAMS = 100
const PROMO_SCHEDULE_GRACE_MIN = 15
const BUSINESS_UTC_OFFSET_MIN = 5 * 60

const round2 = n => Math.round((Number(n) || 0) * 100) / 100

function storeError(detail, code = 'STORE_ORDER_INVALID') {
  const e = new Error(detail)
  e.status = 400
  e.code = code
  return e
}

function isWeightedProduct(p) {
  return p?.sellType === 'weight'
}

function unitGrams(p) {
  const g = Number(p.unitGrams)
  if (g > 0) return g
  const u = String(p.unit || '').toLowerCase()
  const kg = u.match(/(\d+(?:[.,]\d+)?)\s*кг/)
  if (kg) return Math.round(parseFloat(kg[1].replace(',', '.')) * 1000)
  const gr = u.match(/(\d+(?:[.,]\d+)?)\s*г/)
  if (gr) return Math.round(parseFloat(gr[1].replace(',', '.')))
  return 1000
}

function weightStepGrams(p) {
  const step = Number(p.weightStep) || 0
  return step >= MIN_SANE_WEIGHT_GRAMS ? step : DEFAULT_WEIGHT_STEP_GRAMS
}

function minWeightGrams(p) {
  const min = Number(p.minWeight) || 0
  return min >= MIN_SANE_WEIGHT_GRAMS ? min : weightStepGrams(p)
}

function formatKg(grams) {
  const kg = grams / 1000
  const s = Number.isInteger(kg) ? String(kg) : kg.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  return `${s} кг`
}

function bulkUnitPrice(base, tiersRaw, qty) {
  const tiers = (Array.isArray(tiersRaw) ? tiersRaw : [])
    .map(t => ({ minQty: Math.max(1, Math.floor(Number(t.minQty) || 0)), price: round2(Math.max(0, Number(t.price) || 0)) }))
    .filter(t => t.minQty > 0 && t.price > 0)
    .sort((a, b) => a.minQty - b.minQty)
  let unit = round2(base)
  if (qty > 0) for (const t of tiers) if (qty >= t.minQty) unit = t.price
  return round2(unit)
}

function parseHm(hm) {
  if (!hm || !/^\d{1,2}:\d{2}$/.test(hm)) return null
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

function businessMinutes(now) {
  return Math.floor((now.getTime() / 60000 + BUSINESS_UTC_OFFSET_MIN) % 1440 + 1440) % 1440
}

function minutesInWindow(cur, start, end) {
  if (start <= end) return cur >= start && cur <= end
  return cur >= start || cur <= end
}

/** Promo active now (Asia/Dushanbe), with a small grace so a cart filled just before the end still matches. */
export function isPromoActiveForStore(promo, now = new Date()) {
  if (!promo?.on) return false
  const grace = PROMO_SCHEDULE_GRACE_MIN * 60000
  if (promo.startsAt) {
    const t = Date.parse(promo.startsAt)
    if (Number.isFinite(t) && now.getTime() < t - grace) return false
  }
  if (promo.endsAt) {
    const t = Date.parse(promo.endsAt)
    if (Number.isFinite(t) && now.getTime() >= t + grace) return false
  }
  const mode = promo.scheduleMode
    || (promo.endsAt ? 'flash' : (promo.from && promo.to && (promo.from !== '00:00' || promo.to !== '23:59') ? 'daily' : 'always'))
  if (mode === 'daily' || mode === 'flash') {
    const start = parseHm(promo.from || '00:00')
    const end = parseHm(promo.to || '23:59')
    if (start != null && end != null) {
      const cur = businessMinutes(now)
      const ok = [0, PROMO_SCHEDULE_GRACE_MIN, -PROMO_SCHEDULE_GRACE_MIN]
        .some(d => minutesInWindow((cur + d + 1440) % 1440, start, end))
      if (!ok) return false
    }
  }
  const limit = Number(promo.stockLimit)
  if (Number.isFinite(limit) && limit > 0 && limit - (Number(promo.stockSold) || 0) <= 0) return false
  return true
}

function activePromoPrice(db, productId, now) {
  for (const promo of db.promos || []) {
    if (promo?.type !== 'product' || Number(promo.productId) !== productId) continue
    const sale = Number(promo.salePrice)
    if (!(sale > 0)) continue
    if (isPromoActiveForStore(promo, now)) return sale
  }
  return null
}

function estimateWeightKg(lines) {
  let kg = 0
  for (const l of lines) {
    if (l.grams) { kg += l.grams / 1000; continue }
    const u = String(l.packUnit || '').toLowerCase()
    const k = u.match(/^(\d+(?:[.,]\d+)?)\s*кг/)
    const g = u.match(/^(\d+(?:[.,]\d+)?)\s*(?:г|гр)\b/)
    const each = k ? parseFloat(k[1].replace(',', '.')) : g ? parseFloat(g[1].replace(',', '.')) / 1000 : 0.35
    kg += each * l.qty
  }
  return Math.max(0.3, kg)
}

function phoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '')
}

/** Rebuilds a public order body with server prices. Throws 400 on invalid input. */
export function priceStoreOrderBody(db, body, { now = new Date() } = {}) {
  const src = body || {}
  const client = src.client || {
    name: src.client_name, phone: src.client_phone, addr: src.address, lat: src.lat, lng: src.lng,
  }
  const name = String(client.name || '').trim()
  const digits = phoneDigits(client.phone)
  if (!name) throw storeError('Укажите имя')
  if (digits.length < 9 || digits.length > 12) throw storeError('Укажите номер телефона (9 цифр)')

  const rawItems = Array.isArray(src.items) ? src.items : []
  if (!rawItems.length) throw storeError('Корзина пуста')
  if (rawItems.some(it => it?.source === 'restaurant' || it?.restId)) {
    throw storeError('Рестораны пока не принимают заказы', 'STORE_RESTAURANTS_OFF')
  }

  const productsById = new Map((db.products || []).map(p => [Number(p.id), p]))
  const items = []
  const weightLines = []
  for (const it of rawItems) {
    const pid = Number(it?.product_id ?? it?.id)
    const p = productsById.get(pid)
    if (!p || p.deleted || p.archived) throw storeError(`Товар «${it?.name || pid}» больше не продаётся`, 'STORE_PRODUCT_GONE')
    const base = activePromoPrice(db, pid, now) ?? Number(p.price)
    if (!(base > 0)) throw storeError(`У товара «${p.name}» нет цены`, 'STORE_PRODUCT_NO_PRICE')
    const line = {
      id: pid,
      product_id: pid,
      name: p.name,
      e: p.e || it.e || '📦',
      source: 'market',
      ...(p.art ? { art: String(p.art) } : {}),
      ...(p.photo ? { photo: p.photo } : {}),
      ...(p.photoThumb ? { photoThumb: p.photoThumb } : {}),
    }
    if (isWeightedProduct(p)) {
      const step = weightStepGrams(p)
      const min = minWeightGrams(p)
      let grams = Math.round(Number(it.grams ?? it.promoUnits) || 0)
      if (grams < min) throw storeError(`«${p.name}»: минимум ${formatKg(min)}`, 'STORE_WEIGHT_TOO_SMALL')
      grams = Math.max(min, Math.round(grams / step) * step)
      const unit = bulkUnitPrice(base, p.bulkPricing, grams)
      Object.assign(line, {
        name: `${p.name} (${formatKg(grams)})`,
        qty: 1,
        unit: formatKg(grams),
        grams,
        promoUnits: grams,
        price: round2(unit * (grams / unitGrams(p))),
      })
      weightLines.push({ grams, qty: 1 })
    } else {
      const qty = Math.max(1, Math.round(Number(it.qty) || 1))
      Object.assign(line, {
        qty,
        unit: p.unit || 'шт',
        promoUnits: qty,
        price: bulkUnitPrice(base, p.bulkPricing, qty),
      })
      weightLines.push({ qty, packUnit: p.unit })
    }
    if (it.cartLineId) line.cartLineId = String(it.cartLineId)
    items.push(line)
  }

  const goodsTotal = round2(items.reduce((s, l) => s + l.price * l.qty, 0))
  const pricing = normalizePricing(db.settings?.pricing || {})
  const distanceKm = Math.max(0, Number(src.distanceKm) || 0)
  const weightKg = Math.max(estimateWeightKg(weightLines), Number(src.weightKg) || 0)
  const deliveryFee = round2(calcDeliveryTotal(goodsTotal, distanceKm || Number(pricing.baseDist) || 2.5, weightKg, pricing))

  const out = {
    ...src,
    type: 'market',
    client: { ...client, name, phone: String(client.phone || '').trim() },
    client_name: name,
    client_phone: String(client.phone || '').trim(),
    items,
    goodsTotal,
    deliveryFee,
    deliveryFeeLocked: true,
    total: round2(goodsTotal + deliveryFee),
    weightKg: Math.round(weightKg * 10) / 10,
    payment_method: 'cash',
    pay: 'cash',
    priority: 'normal',
    pickupIds: ['store'],
  }
  delete out.vip
  delete out.creditAmount
  delete out.bonusSpent
  delete out.restIds
  delete out.restId
  delete out.restName
  delete out.marketStatus
  delete out.restParts
  return out
}
