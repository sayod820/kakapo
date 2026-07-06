import crypto from 'crypto'
import { fetchAllGbsGoods, fetchGbsSaleDocuments } from './gbsClient.js'
import { findClientByPhone, applyClientLoyaltyAfterDelivery } from './loyaltyBonus.js'

export function generateIngestToken() {
  return crypto.randomBytes(24).toString('hex')
}

/**
 * Обновляет stock/price существующих товаров KAKAPO по совпадению art === Barcode.
 * Новые товары из кассы не создаются — только обновление уже заведённых у нас.
 * Чистая функция — не знает, откуда взялся массив goods (прямой опрос кассы или пуш от агента).
 */
export function applyGbsGoodsToProducts(db, goods) {
  const byBarcode = new Map()
  for (const g of goods) {
    const code = String(g?.Barcode || '').trim().toUpperCase()
    if (code) byBarcode.set(code, g)
  }

  let matched = 0
  let updated = 0
  for (const p of db.products || []) {
    const art = String(p?.art || '').trim().toUpperCase()
    if (!art) continue
    const good = byBarcode.get(art)
    if (!good) continue
    matched += 1

    const stocks = Array.isArray(good.Stocks) ? good.Stocks : []
    const stock = stocks.reduce((s, st) => s + (Number(st?.Quantity) || 0), 0)
    const price = Number(stocks[0]?.Price) || 0

    let changed = false
    if (Number.isFinite(stock) && p.stock !== stock) {
      p.stock = stock
      changed = true
    }
    if (price > 0 && p.price !== price) {
      p.price = price
      changed = true
    }
    if (changed) updated += 1
  }

  return {
    matched,
    updated,
    totalGbsGoods: goods.length,
    unmatchedGbsCount: Math.max(0, byBarcode.size - matched),
  }
}

export async function syncGbsProducts(db, gbsSettings) {
  const goods = await fetchAllGbsGoods(gbsSettings)
  return applyGbsGoodsToProducts(db, goods)
}

/** Правдоподобные имена полей с картой/телефоном клиента в документе — уточняются по факту реального ответа кассы. */
const CLIENT_FIELD_CANDIDATES = ['Card', 'CardNum', 'CardNumber', 'DiscountCard', 'Client', 'ClientCard', 'Buyer', 'Phone', 'ClientPhone']

function extractClientIdentifier(doc) {
  for (const key of CLIENT_FIELD_CANDIDATES) {
    const v = doc?.[key]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  const props = Array.isArray(doc?.Properties) ? doc.Properties : []
  for (const prop of props) {
    const name = String(prop?.TypeName || '').toLowerCase()
    if (/карта|card|клиент|телефон|phone/.test(name) && prop?.Value) {
      return String(prop.Value).trim()
    }
  }
  return ''
}

function resolveClientForIdentifier(db, hooks, identifier) {
  if (!identifier) return null
  const digits = identifier.replace(/\D/g, '')
  if (digits.length >= 7) {
    const client = findClientByPhone(db, identifier)
    if (client) return client
  }
  const card = hooks?.findCardByNum ? hooks.findCardByNum(identifier) : null
  if (card?.phone) return findClientByPhone(db, card.phone)
  return null
}

/**
 * Импортирует новые чеки продаж (тип Sale) как доставленные заказы для клиентов,
 * которых удаётся распознать по номеру карты/телефону в документе. Чек без
 * распознанного клиента не создаёт заказ (админка/курьер/сборщик рассчитаны на
 * заказ с клиентом) — просто учитывается в сводке как unmatchedToClient.
 * Идемпотентно по doc.Uid — повторный запуск не задваивает импорт. Чистая функция
 * относительно источника документов (прямой опрос или пуш от локального агента).
 */
export function applyGbsSaleDocuments(db, documents, hooks) {
  if (!db.settings) db.settings = {}
  if (!db.settings.admin) db.settings.admin = {}
  if (!db.settings.admin.gbs) db.settings.admin.gbs = {}
  const gbs = db.settings.admin.gbs

  const importedDocUids = Array.isArray(gbs.importedDocUids) ? gbs.importedDocUids : []
  const importedSet = new Set(importedDocUids.map(x => x.uid))

  if (!Array.isArray(db.orders)) db.orders = []

  let imported = 0
  let unmatchedToClient = 0

  for (const doc of documents) {
    const uid = String(doc?.Uid || '')
    if (!uid || importedSet.has(uid) || doc?.IsDeleted) continue
    importedSet.add(uid)
    importedDocUids.push({ uid, dateTime: doc?.DateTime || new Date().toISOString() })

    const items = Array.isArray(doc?.Items) ? doc.Items : []
    const goodsTotal = Math.round(items.reduce((s, it) => {
      const qty = Number(it?.Quantity) || 0
      const price = Number(it?.SalePrice) || 0
      const discount = Number(it?.Discount) || 0
      return s + qty * price - discount
    }, 0) * 100) / 100
    if (goodsTotal <= 0) continue

    const identifier = extractClientIdentifier(doc)
    const client = resolveClientForIdentifier(db, hooks, identifier)
    if (!client?.phone) {
      unmatchedToClient += 1
      continue
    }

    const deliveredAtIso = doc?.DateTime || new Date().toISOString()
    const order = {
      id: `GBS-${uid.slice(0, 8)}`,
      type: 'market',
      status: 'delivered',
      client: { name: client.name || '', phone: client.phone },
      goodsTotal,
      total: goodsTotal,
      deliveryFee: 0,
      bonusSpent: 0,
      source: 'gbs',
      gbsDocUid: uid,
      deliveredAtIso,
      createdAtIso: deliveredAtIso,
    }
    db.orders.push(order)
    applyClientLoyaltyAfterDelivery(db, order, hooks)
    imported += 1
  }

  const cutoffMs = Date.now() - 60 * 24 * 60 * 60 * 1000
  gbs.importedDocUids = importedDocUids.filter(x => {
    const t = Date.parse(x.dateTime)
    return Number.isNaN(t) || t >= cutoffMs
  })

  return { imported, unmatchedToClient, totalDocs: documents.length }
}

export async function syncGbsSales(db, gbsSettings, hooks) {
  if (!db.settings) db.settings = {}
  if (!db.settings.admin) db.settings.admin = {}
  if (!db.settings.admin.gbs) db.settings.admin.gbs = {}
  const gbs = db.settings.admin.gbs

  const todayIso = new Date().toISOString().slice(0, 10)
  const lastSync = gbs.lastSalesSyncIso ? String(gbs.lastSalesSyncIso).slice(0, 10) : null
  const fallbackStart = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const dateStart = lastSync || fallbackStart

  const docs = await fetchGbsSaleDocuments(gbsSettings, dateStart, todayIso)
  const result = applyGbsSaleDocuments(db, docs, hooks)
  gbs.lastSalesSyncIso = new Date().toISOString()
  return result
}

/** Полный цикл прямого опроса кассы: товары + продажи. Сбой одного шага не должен ронять другой. */
export async function runGbsSyncCycle(db, hooks) {
  if (!db.settings) db.settings = {}
  if (!db.settings.admin) db.settings.admin = {}
  if (!db.settings.admin.gbs) db.settings.admin.gbs = {}
  const gbs = db.settings.admin.gbs

  if (!gbs.enabled) return { ok: false, skipped: true, reason: 'disabled' }

  const errors = []
  let products = null
  let sales = null

  try {
    products = await syncGbsProducts(db, gbs)
  } catch (e) {
    errors.push(`Товары: ${e?.message || e}`)
  }

  try {
    sales = await syncGbsSales(db, gbs, hooks)
  } catch (e) {
    errors.push(`Продажи: ${e?.message || e}`)
  }

  stampSyncResult(gbs, products, sales, errors)
  if (typeof hooks?.persist === 'function') hooks.persist()
  if (products?.updated && typeof hooks?.broadcast === 'function') {
    hooks.broadcast('products_synced', { count: products.updated })
  }

  return { ok: errors.length === 0, products, sales, errors }
}

function stampSyncResult(gbs, products, sales, errors) {
  gbs.lastSyncIso = new Date().toISOString()
  gbs.lastSyncSummary = {
    matched: products?.matched ?? null,
    updated: products?.updated ?? null,
    imported: sales?.imported ?? null,
    unmatchedToClient: sales?.unmatchedToClient ?? null,
  }
  gbs.lastSyncError = errors.length ? errors.join('; ') : null
}

/**
 * Приём данных, которые уже собрал и прислал локальный агент (для случая, когда касса
 * стоит за роутером магазина и облачный backend не может достучаться до неё напрямую).
 * Никаких сетевых запросов к кассе тут нет — только матчинг присланных goods/documents.
 */
export function ingestGbsPayload(db, hooks, payload) {
  if (!db.settings) db.settings = {}
  if (!db.settings.admin) db.settings.admin = {}
  if (!db.settings.admin.gbs) db.settings.admin.gbs = {}
  const gbs = db.settings.admin.gbs

  const errors = []
  let products = null
  let sales = null

  try {
    products = applyGbsGoodsToProducts(db, Array.isArray(payload?.goods) ? payload.goods : [])
  } catch (e) {
    errors.push(`Товары: ${e?.message || e}`)
  }

  try {
    sales = applyGbsSaleDocuments(db, Array.isArray(payload?.documents) ? payload.documents : [], hooks)
  } catch (e) {
    errors.push(`Продажи: ${e?.message || e}`)
  }

  stampSyncResult(gbs, products, sales, errors)
  gbs.lastIngestIso = gbs.lastSyncIso
  if (typeof hooks?.persist === 'function') hooks.persist()
  if (products?.updated && typeof hooks?.broadcast === 'function') {
    hooks.broadcast('products_synced', { count: products.updated })
  }

  return { ok: errors.length === 0, products, sales, errors }
}
