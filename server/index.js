import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import { loadDb, saveDb } from './db.js'
import { seedIfEmpty, nextOrderId, DEFAULT_PROMOS, DEFAULT_REVIEWS, COURIERS, ASSEMBLERS, DEFAULT_CLIENTS, DEFAULT_CARDS } from './seed.js'
import {
  applyStatusPatch,
  inferType,
  isAssemblerOrder,
  isCourierSync,
  isCourierMapSync,
  marketItems,
  restItems,
} from './ordersLogic.js'
import { creditDeliveredOrder, processPayout, getPendingBalance } from './restaurantStats.js'
import { lockOrderDeliveryFee } from './deliveryFee.js'

const PORT = Number(process.env.PORT) || 8000
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
const db = seedIfEmpty()

function persist() {
  saveDb()
}

function ensurePromos() {
  if (!db._seq.promo) db._seq.promo = DEFAULT_PROMOS.length
  if (!Array.isArray(db.promos)) db.promos = []
  if (!db.promos.length) {
    db.promos = DEFAULT_PROMOS.map(p => ({ ...p }))
    persist()
  }
}
ensurePromos()

function ensureCouriers() {
  if (!Array.isArray(db.couriers)) db.couriers = []
  if (!db.couriers.length) {
    db.couriers = COURIERS.map(c => ({ ...c }))
    persist()
  }
}
ensureCouriers()

function ensureAssemblers() {
  if (!Array.isArray(db.assemblers)) db.assemblers = []
  if (!db.assemblers.length) {
    db.assemblers = ASSEMBLERS.map(a => ({ ...a }))
    persist()
  }
}
ensureAssemblers()

function ensureClients() {
  if (!Array.isArray(db.clients)) db.clients = []
  // Не восстанавливать демо-клиентов после полного удаления — иначе после рестарта Render
  // снова появляются U-01…U-07 и пропадают реальные клиенты админа.
}
ensureClients()

function ensureCards() {
  if (!Array.isArray(db.cards)) db.cards = []
  // Не восстанавливать демо-карты после полного удаления (см. ensureClients).
}
ensureCards()

function ensurePayouts() {
  if (!Array.isArray(db.payouts)) db.payouts = []
  if (!db._seq.payout) db._seq.payout = db.payouts.length
  for (const r of db.restaurants || []) {
    if (r.paidRevenueMonth == null) r.paidRevenueMonth = 0
  }
}
ensurePayouts()

function ensureReviews() {
  if (!Array.isArray(db.reviews)) db.reviews = []
  if (!db._seq.review) db._seq.review = db.reviews.length
  if (!db.reviews.length) {
    db.reviews = DEFAULT_REVIEWS.map(r => ({ ...r }))
    db._seq.review = DEFAULT_REVIEWS.length
    persist()
  }
}
ensureReviews()

const app = express()
app.use(cors({
  origin: CORS_ORIGINS.length === 1 && CORS_ORIGINS[0] === '*'
    ? true
    : CORS_ORIGINS,
}))
app.use(express.json({ limit: '2mb' }))

const clients = new Set()

function broadcast(event, order) {
  const msg = JSON.stringify({ event, order })
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg)
  }
}

function broadcastReview(review) {
  const msg = JSON.stringify({ event: 'review_update', review })
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg)
  }
}

function broadcastNotification(notification) {
  const msg = JSON.stringify({ event: 'notification', notification })
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg)
  }
}

function phoneKey(phone) {
  return (phone || '').replace(/\D/g, '').slice(-9)
}

function ensureNotifications() {
  if (!Array.isArray(db.notifications)) {
    db.notifications = []
    persist()
  }
}
ensureNotifications()

function nowTime() {
  return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

app.get('/health', (_req, res) => res.json({
  ok: true,
  service: 'kakapo-api',
  version: '2.3-node-loyalty',
  loyaltyVip: true,
  dataDir: process.env.DATA_DIR || 'data',
}))

app.get('/', (_req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><title>КАКАПО API</title>
<style>body{font-family:system-ui;background:#030B05;color:#EBF5ED;padding:40px;max-width:520px;margin:0 auto}
h1{color:#1FD760}a{color:#1FD760}code{background:#0C1C0F;padding:2px 8px;border-radius:6px}</style></head>
<body>
<h1>✅ КАКАПО Backend работает</h1>
<p>Это <strong>API сервер</strong>, не интерфейс приложения.</p>
<p>Откройте <strong>frontend</strong> (в другом терминале: <code>npm run dev</code>):</p>
<p><a href="http://localhost:3000">http://localhost:3000</a> — портал</p>
<ul>
<li><a href="http://localhost:3000/store">Магазин</a></li>
<li><a href="http://localhost:3000/assembler">Сборщик</a></li>
<li><a href="http://localhost:3000/courier">Курьер</a></li>
<li><a href="http://localhost:3000/restaurant">Ресторан</a></li>
</ul>
<p>Проверка API: <a href="/health">/health</a></p>
</body></html>`)
})

app.post('/auth/otp/send', (_req, res) => res.json({ ok: true, demo: true }))
app.post('/auth/otp/verify', (req, res) => {
  if (String(req.body.code) !== '1234') return res.status(400).json({ detail: 'Неверный код · Демо: 1234' })
  res.json({ access_token: 'demo-client-token', role: 'client', user_id: 1, name: 'Клиент' })
})
app.post('/auth/login', (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim()
  const user = db.users.find(u => u.email === email && u.password === (req.body.password || ''))
  if (!user) return res.status(401).json({ detail: 'Неверный email или пароль' })
  res.json({ access_token: `token-${user.role}-${user.id}`, role: user.role, user_id: user.id, name: user.name })
})

app.get('/products', (_req, res) => res.json(db.products))
app.post('/products', (req, res) => {
  const id = ++db._seq.product
  const p = {
    id, art: req.body.art || `KAK-${String(id).padStart(4, '0')}`, e: req.body.e || '📦',
    name: req.body.name, price: req.body.price || 0, cat: req.body.cat || '', catId: req.body.catId || '',
    unit: req.body.unit || 'шт', stock: req.body.stock || 0, hot: !!req.body.hot,
    desc: req.body.desc, brand: req.body.brand, country: req.body.country, barcode: req.body.barcode,
    organic: !!req.body.organic, sellType: req.body.sellType || 'piece',
    unitGrams: req.body.unitGrams, weightStep: req.body.weightStep, minWeight: req.body.minWeight,
  }
  db.products.push(p)
  persist()
  res.json(p)
})
app.patch('/products/:id', (req, res) => {
  const p = db.products.find(x => x.id === Number(req.params.id))
  if (!p) return res.status(404).json({ detail: 'Не найдено' })
  Object.assign(p, req.body)
  persist()
  res.json(p)
})
app.delete('/products/:id', (req, res) => {
  db.products = db.products.filter(x => x.id !== Number(req.params.id))
  persist()
  res.json({ ok: true })
})

app.get('/categories', (_req, res) => res.json(db.categories))
app.get('/categories/tree', (_req, res) => res.json(db.categories.map(c => ({ ...c, children: [] }))))
app.post('/categories', (req, res) => {
  const id = ++db._seq.category
  const c = { id, name: req.body.name, slug: req.body.slug || '', parent_id: req.body.parent_id ?? null }
  db.categories.push(c)
  persist()
  res.json(c)
})
app.delete('/categories/:id', (req, res) => {
  db.categories = db.categories.filter(c => c.id !== Number(req.params.id))
  persist()
  res.json({ ok: true })
})

app.get('/promos', (_req, res) => res.json(db.promos))
app.post('/promos', (req, res) => {
  const id = ++db._seq.promo
  const p = {
    id,
    e: '🎁',
    title: '',
    sub: '',
    disc: 0,
    on: true,
    cat: 'Магазин',
    type: 'pct',
    from: '08:00',
    to: '22:00',
    till: 'Всегда',
    ...req.body,
  }
  db.promos.push(p)
  persist()
  res.json(p)
})
app.patch('/promos/:id', (req, res) => {
  const p = db.promos.find(x => x.id === Number(req.params.id))
  if (!p) return res.status(404).json({ detail: 'Не найдено' })
  Object.assign(p, req.body)
  persist()
  res.json(p)
})
app.delete('/promos/:id', (req, res) => {
  db.promos = db.promos.filter(x => x.id !== Number(req.params.id))
  persist()
  res.json({ ok: true })
})

app.get('/orders', (req, res) => {
  let orders = [...db.orders].reverse()
  if (req.query.status) orders = orders.filter(o => o.status === req.query.status)
  if (req.query.type) orders = orders.filter(o => o.type === req.query.type)
  res.json(orders)
})
app.get('/orders/assembler', (_req, res) => res.json(db.orders.filter(isAssemblerOrder)))
app.get('/orders/courier', (_req, res) => res.json(db.orders.filter(isCourierMapSync)))
app.get('/orders/:id', (req, res) => {
  const o = db.orders.find(x => x.id === req.params.id)
  if (!o) return res.status(404).json({ detail: 'Заказ не найден' })
  res.json(o)
})
app.post('/orders', (req, res) => {
  const body = req.body
  const client = body.client || { name: body.client_name, phone: body.client_phone, addr: body.address, lat: body.lat, lng: body.lng }
  const otype = inferType({ type: body.type, items: body.items || [] })
  const order = {
    id: nextOrderId(db),
    type: otype,
    status: 'new',
    createdAt: nowTime(),
    total: body.total || 0,
    deliveryFee: body.deliveryFee || 0,
    deliveryFeeLocked: body.deliveryFeeLocked === true || Number(body.deliveryFee) > 0,
    comment: body.comment || '',
    payment_method: body.payment_method || body.pay || 'cash',
    pay: body.payment_method || body.pay || 'cash',
    creditAmount: body.creditAmount != null ? Number(body.creditAmount) : undefined,
    vip: body.vip === true,
    priority: body.priority || 'normal',
    client,
    items: body.items || [],
    restId: body.restId,
    restName: body.restName,
    restIds: body.restIds,
    pickupIds: body.pickupIds,
    distanceKm: body.distanceKm,
    durationMin: body.durationMin,
    weightKg: body.weightKg,
  }
  if (otype === 'mixed') {
    order.marketStatus = body.marketStatus || 'new'
    order.restParts = body.restParts || Object.fromEntries((body.restIds || []).map(r => [r, 'new']))
  }
  db.orders.push(order)
  persist()
  broadcast('new_order', order)
  res.json(order)
})
app.patch('/orders/:id/status', (req, res) => {
  const idx = db.orders.findIndex(o => o.id === req.params.id)
  if (idx < 0) return res.status(404).json({ detail: 'Заказ не найден' })
  const prev = db.orders[idx]
  const updated = applyStatusPatch({ ...prev }, req.body)
  if (updated.status === 'delivered' && prev.status !== 'delivered') {
    lockOrderDeliveryFee(updated, db.settings.pricing)
    creditDeliveredOrder(db, updated)
  }
  db.orders[idx] = updated
  persist()
  broadcast('order_update', db.orders[idx])
  res.json(db.orders[idx])
})

app.get('/restaurants', (_req, res) => res.json(db.restaurants))
app.get('/restaurants/:id', (req, res) => {
  const r = db.restaurants.find(x => x.id === req.params.id)
  if (!r) return res.status(404).json({ detail: 'Не найдено' })
  res.json(r)
})
app.patch('/restaurants/:id/toggle', (req, res) => {
  const r = db.restaurants.find(x => x.id === req.params.id)
  if (!r) return res.status(404).json({ detail: 'Не найдено' })
  if (r.blocked) return res.status(403).json({ detail: 'Ресторан заблокирован' })
  r.open = !r.open
  persist()
  res.json(r)
})
app.patch('/restaurants/:id', (req, res) => {
  const r = db.restaurants.find(x => x.id === req.params.id)
  if (!r) return res.status(404).json({ detail: 'Не найдено' })
  for (const k of ['name', 'cuisine', 'address', 'phone', 'email', 'open', 'blocked', 'hours']) {
    if (req.body[k] !== undefined) r[k] = req.body[k]
  }
  persist()
  res.json(r)
})
app.patch('/restaurants/:id/block', (req, res) => {
  const r = db.restaurants.find(x => x.id === req.params.id)
  if (!r) return res.status(404).json({ detail: 'Не найдено' })
  const blocked = req.body.blocked === true
  r.blocked = blocked
  r.open = blocked ? false : true
  const REST_TO_PICKUP = { 'R-01': 'rest1', 'R-02': 'rest2', 'R-03': 'rest3', 'R-04': 'rest4' }
  const pickupId = REST_TO_PICKUP[r.id] ?? `rest${r.id.replace(/^R-0?/, '')}`
  const pu = db.pickups.find(p => p.id === pickupId)
  if (pu) pu.active = !blocked
  persist()
  res.json(r)
})
app.post('/restaurants/:id/payout', (req, res) => {
  const result = processPayout(db, req.params.id, req.body)
  if (result.error) return res.status(result.status || 400).json({ detail: result.error })
  persist()
  res.json(result)
})
app.get('/payouts', (req, res) => {
  const restId = req.query.restId
  let list = db.payouts || []
  if (restId) list = list.filter(p => p.restId === restId)
  res.json(list)
})
app.patch('/restaurants/:id/commission', (req, res) => {
  const r = db.restaurants.find(x => x.id === req.params.id)
  r.commission = Number(req.query.commission)
  persist()
  res.json(r)
})
app.patch('/restaurants/menu/:itemId/stock', (req, res) => {
  for (const r of db.restaurants) {
    const item = (r.menu || []).find(m => m.id === Number(req.params.itemId))
    if (item) {
      item.inStock = !item.inStock
      persist()
      return res.json(item)
    }
  }
  res.status(404).json({ detail: 'Блюдо не найдено' })
})

app.get('/pickups', (_req, res) => res.json(db.pickups))
app.patch('/pickups/:id', (req, res) => {
  const p = db.pickups.find(x => x.id === req.params.id)
  if (!p) return res.status(404).json({ detail: 'Не найдено' })
  Object.assign(p, req.body)
  persist()
  res.json(p)
})

function normalizeCourierRow(raw) {
  const vehicle = ['moto', 'bike', 'car'].includes(raw.vehicle) ? raw.vehicle : 'moto'
  return {
    ...raw,
    vehicle,
    maxActiveOrders: Math.max(1, Math.min(5, Number(raw.maxActiveOrders) || 1)),
    blocked: !!raw.blocked,
    rating: Number(raw.rating) || 5,
    orders: Number(raw.orders) || 0,
    today: Number(raw.today) || 0,
    week: Number(raw.week) || 0,
    num: raw.num || '—',
    otp: raw.otp || '1234',
  }
}

app.get('/couriers', (_req, res) => res.json(db.couriers || []))
app.post('/couriers', (req, res) => {
  if (!db.couriers) db.couriers = []
  const nums = db.couriers.map(c => parseInt(String(c.id).replace(/\D/g, ''), 10)).filter(n => !Number.isNaN(n))
  const n = (nums.length ? Math.max(...nums) : 0) + 1
  const row = normalizeCourierRow({
    id: `C-${String(n).padStart(2, '0')}`,
    rating: 5,
    orders: 0,
    today: 0,
    week: 0,
    status: 'offline',
    ...req.body,
  })
  db.couriers.push(row)
  persist()
  res.json(row)
})
app.patch('/couriers/:id', (req, res) => {
  const c = (db.couriers || []).find(x => x.id === req.params.id)
  if (!c) return res.status(404).json({ detail: 'Курьер не найден' })
  Object.assign(c, normalizeCourierRow({ ...c, ...req.body, id: c.id }))
  persist()
  res.json(c)
})

function normalizeAssemblerRow(raw) {
  const status = raw.status === 'working' || raw.status === 'available' ? raw.status : 'offline'
  return {
    ...raw,
    status,
    ordersToday: Number(raw.ordersToday) || 0,
    ordersTotal: Number(raw.ordersTotal) || 0,
    week: Number(raw.week) || 0,
    avgTimeMin: Math.max(1, Number(raw.avgTimeMin) || 8),
    rating: Number(raw.rating) || 5,
    blocked: !!raw.blocked,
    otp: raw.otp || '5678',
  }
}

app.get('/assemblers', (_req, res) => res.json(db.assemblers || []))
app.post('/assemblers', (req, res) => {
  if (!db.assemblers) db.assemblers = []
  const nums = db.assemblers.map(a => parseInt(String(a.id).replace(/\D/g, ''), 10)).filter(n => !Number.isNaN(n))
  const n = (nums.length ? Math.max(...nums) : 0) + 1
  const row = normalizeAssemblerRow({
    id: `A-${String(n).padStart(2, '0')}`,
    rating: 5,
    ordersToday: 0,
    ordersTotal: 0,
    week: 0,
    avgTimeMin: 8,
    status: 'offline',
    ...req.body,
  })
  db.assemblers.push(row)
  persist()
  res.json(row)
})
app.patch('/assemblers/:id', (req, res) => {
  const a = (db.assemblers || []).find(x => x.id === req.params.id)
  if (!a) return res.status(404).json({ detail: 'Сборщик не найден' })
  Object.assign(a, normalizeAssemblerRow({ ...a, ...req.body, id: a.id }))
  persist()
  res.json(a)
})

function normalizeClientRow(raw) {
  const level = ['basic', 'bronze', 'silver', 'gold', 'platinum'].includes(raw.level) ? raw.level : 'basic'
  return {
    id: raw.id,
    name: raw.name || '',
    phone: raw.phone || '',
    email: raw.email || '',
    addr: raw.addr || '',
    card: raw.card || '',
    level,
    orders: Number(raw.orders) || 0,
    spent: Number(raw.spent) || 0,
    debt: Number(raw.debt) || 0,
    bonus: Number(raw.bonus) || 0,
    debtLimit: Number(raw.debtLimit) || 0,
    blocked: !!raw.blocked,
    vip: !!raw.vip || vipFromNote(raw.note),
    note: raw.note || '',
    createdAt: raw.createdAt,
    lastOrderAt: raw.lastOrderAt,
    loyaltyPeriod: raw.loyaltyPeriod,
    debtEnabled: raw.debtEnabled === true || debtFromNote(raw.note),
    accountStatus: raw.accountStatus === 'recovery' ? 'recovery' : 'active',
    deletedAt: raw.deletedAt || undefined,
  }
}

app.get('/clients', (_req, res) => res.json((db.clients || []).map(c => normalizeClientRow({ ...c, id: c.id }))))
app.post('/clients', (req, res) => {
  if (!db.clients) db.clients = []
  const nums = db.clients.map(c => parseInt(String(c.id).replace(/\D/g, ''), 10)).filter(n => !Number.isNaN(n))
  const n = (nums.length ? Math.max(...nums) : 0) + 1
  const row = normalizeClientRow({
    id: `U-${String(n).padStart(2, '0')}`,
    level: 'basic',
    orders: 0,
    spent: 0,
    debt: 0,
    bonus: 0,
    debtLimit: 0,
    blocked: false,
    createdAt: new Date().toISOString().slice(0, 10),
    ...req.body,
  })
  db.clients.push(row)
  ensureCardRowForClient(row)
  persist()
  res.json(row)
})
app.patch('/clients/:id', (req, res) => {
  const c = (db.clients || []).find(x => x.id === req.params.id)
  if (!c) return res.status(404).json({ detail: 'Клиент не найден' })
  if (req.body && req.body.purge === true) {
    removeClientAndUnlinkCards(c)
    return res.json({ ok: true })
  }
  const { purge, ...patch } = req.body || {}
  Object.assign(c, normalizeClientRow({ ...c, ...patch, id: c.id }))
  persist()
  res.json(c)
})

function unlinkCardsForClient(client) {
  for (const card of db.cards || []) {
    if (card.status === 'unlinked') continue
    const sameClient = card.clientId === client.id
    const samePhone = card.phone && client.phone
      && normalizePhoneDigits(card.phone) === normalizePhoneDigits(client.phone)
    const sameCardNum = client.card && card.num === client.card
    if (!sameClient && !samePhone && !sameCardNum) continue
    Object.assign(card, normalizeCardRow({
      num: card.num,
      client: '',
      phone: '',
      clientId: undefined,
      status: 'unlinked',
      level: '',
      bonus: 0,
      debt: 0,
      debtLimit: 0,
      vip: false,
    }))
  }
}

function moveClientToRecoveryRecord(client) {
  unlinkCardsForClient(client)
  client.card = ''
  client.accountStatus = 'recovery'
  client.deletedAt = new Date().toISOString().slice(0, 10)
  persist()
}

function restoreClientRecord(client) {
  client.accountStatus = 'active'
  client.deletedAt = undefined
  client.blocked = false
  persist()
}

function removeClientAndUnlinkCards(client) {
  const idx = (db.clients || []).findIndex(x => x.id === client.id)
  if (idx >= 0) db.clients.splice(idx, 1)
  unlinkCardsForClient(client)
  persist()
}

app.post('/clients/:id/recovery', (req, res) => {
  if (!db.clients) db.clients = []
  const client = db.clients.find(x => x.id === req.params.id)
  if (!client) return res.status(404).json({ detail: 'Клиент не найден' })
  moveClientToRecoveryRecord(client)
  res.json(client)
})

app.post('/clients/:id/restore', (req, res) => {
  if (!db.clients) db.clients = []
  const client = db.clients.find(x => x.id === req.params.id)
  if (!client) return res.status(404).json({ detail: 'Клиент не найден' })
  restoreClientRecord(client)
  res.json(client)
})

app.post('/clients/recovery-by-phone', (req, res) => {
  if (!db.clients) db.clients = []
  const digits = normalizePhoneDigits(req.body?.phone || '')
  const client = db.clients.find(c => normalizePhoneDigits(c.phone) === digits)
  if (!client) return res.status(404).json({ detail: 'Клиент не найден' })
  moveClientToRecoveryRecord(client)
  res.json(client)
})

app.post('/clients/delete-by-phone', (req, res) => {
  if (!db.clients) db.clients = []
  const digits = normalizePhoneDigits(req.body?.phone || '')
  const client = db.clients.find(c => normalizePhoneDigits(c.phone) === digits)
  if (!client) return res.status(404).json({ detail: 'Клиент не найден' })
  removeClientAndUnlinkCards(client)
  res.json({ ok: true })
})

app.post('/clients/:id/delete', (req, res) => {
  if (!db.clients) db.clients = []
  const client = db.clients.find(x => x.id === req.params.id)
  if (!client) return res.status(404).json({ detail: 'Клиент не найден' })
  removeClientAndUnlinkCards(client)
  res.json({ ok: true })
})

app.delete('/clients/by-phone/:phone', (req, res) => {
  if (!db.clients) db.clients = []
  const digits = normalizePhoneDigits(decodeURIComponent(req.params.phone))
  const client = db.clients.find(c => normalizePhoneDigits(c.phone) === digits)
  if (!client) return res.status(404).json({ detail: 'Клиент не найден' })
  removeClientAndUnlinkCards(client)
  res.json({ ok: true })
})

app.delete('/clients/:id', (req, res) => {
  if (!db.clients) db.clients = []
  const client = db.clients.find(x => x.id === req.params.id)
  if (!client) return res.status(404).json({ detail: 'Клиент не найден' })
  removeClientAndUnlinkCards(client)
  res.json({ ok: true })
})

app.get('/settings/pricing', (_req, res) => res.json(db.settings.pricing))
app.patch('/settings/pricing', (req, res) => {
  db.settings.pricing = { ...db.settings.pricing, ...req.body }
  persist()
  res.json(db.settings.pricing)
})

function migrateLoyaltyRows() {
  let changed = false
  if (Array.isArray(db.cards)) {
    const next = db.cards.map(c => normalizeCardRow({ ...c, num: c.num }))
    if (JSON.stringify(db.cards) !== JSON.stringify(next)) {
      db.cards = next
      changed = true
    }
  }
  if (Array.isArray(db.clients)) {
    const byId = new Map()
    for (const c of db.clients) {
      const prev = byId.get(c.id)
      if (!prev) byId.set(c.id, c)
      else if (c.card && !prev.card) byId.set(c.id, c)
      else if (!c.card && prev.card) { /* keep prev */ }
      else if ((c.level || '') !== 'basic' && (prev.level || 'basic') === 'basic') byId.set(c.id, c)
    }
    const deduped = Array.from(byId.values()).map(c => normalizeClientRow({ ...c, id: c.id }))
    if (JSON.stringify(db.clients) !== JSON.stringify(deduped)) {
      db.clients = deduped
      changed = true
    }
  }
  if (changed) persist()
}

migrateLoyaltyRows()

app.get('/cards', (_req, res) => res.json((db.cards || []).map(c => normalizeCardRow({ ...c, num: c.num }))))

function normalizePhoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-9)
}

function currentLoyaltyPeriod(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

const VIP_NOTE_MARKER = 'kakapo-vip'
const DEBT_NOTE_MARKER = 'kakapo-debt'

function vipFromNote(note) {
  return !!(note && String(note).includes(VIP_NOTE_MARKER))
}

function debtFromNote(note) {
  return !!(note && String(note).includes(DEBT_NOTE_MARKER))
}

function normalizeCardRow(raw) {
  const status = ['active', 'unlinked', 'blocked'].includes(raw.status) ? raw.status : 'unlinked'
  const level = ['basic', 'bronze', 'silver', 'gold', 'platinum'].includes(raw.level) ? raw.level : (raw.level || '')
  return {
    num: String(raw.num || '').toUpperCase(),
    client: raw.client || '',
    phone: raw.phone || '',
    clientId: raw.clientId,
    status,
    level,
    bonus: Number(raw.bonus) || 0,
    debtLimit: Number(raw.debtLimit) || 0,
    debt: Number(raw.debt) || 0,
    issued: raw.issued || new Date().toISOString().slice(0, 10),
    note: raw.note || '',
    vip: !!raw.vip || vipFromNote(raw.note),
    debtEnabled: raw.debtEnabled === true || debtFromNote(raw.note),
    loyaltyPeriod: raw.loyaltyPeriod || undefined,
  }
}

function issueCardForNewClient(client) {
  if (!db.cards) db.cards = []
  const nums = db.cards.map(c => parseInt(String(c.num).replace(/\D/g, ''), 10)).filter(n => !Number.isNaN(n))
  const n = (nums.length ? Math.max(...nums) : 0) + 1
  const num = `КАКАПО-${String(n).padStart(4, '0')}`
  const card = normalizeCardRow({
    num,
    client: client.name || 'Клиент',
    phone: client.phone || '',
    clientId: client.id,
    status: 'active',
    level: client.level === 'basic' ? '' : (client.level || ''),
    bonus: Number(client.bonus) || 0,
    debt: 0,
    debtLimit: 0,
    issued: new Date().toISOString().slice(0, 10),
  })
  db.cards.push(card)
  client.card = num
  return card
}

function findCardByNum(num) {
  const upper = String(num || '').toUpperCase()
  let card = (db.cards || []).find(x => x.num === upper)
  if (!card) {
    const digits = upper.replace(/\D/g, '')
    if (digits) card = (db.cards || []).find(x => String(x.num).replace(/\D/g, '') === digits)
  }
  return card
}

/** Создать строку карты, если клиент ссылается на номер, которого нет в db.cards */
function ensureCardRowForClient(client) {
  if (!client) return null
  if (!client.card) return issueCardForNewClient(client)
  let card = findCardByNum(client.card)
  if (card) {
    if (client.id && !card.clientId) card.clientId = client.id
    if (client.phone && !card.phone) card.phone = client.phone
    if (client.name && !card.client) card.client = client.name
    return card
  }
  if (!db.cards) db.cards = []
  card = normalizeCardRow({
    num: String(client.card).toUpperCase(),
    client: client.name || '',
    phone: client.phone || '',
    clientId: client.id,
    status: client.blocked ? 'blocked' : 'active',
    level: client.level === 'basic' ? '' : (client.level || ''),
    bonus: Number(client.bonus) || 0,
    debt: Number(client.debt) || 0,
    debtLimit: Number(client.debtLimit) || 0,
    vip: !!client.vip,
    debtEnabled: !!client.debtEnabled,
    loyaltyPeriod: client.loyaltyPeriod,
    issued: new Date().toISOString().slice(0, 10),
  })
  db.cards.push(card)
  return card
}

function syncClientFromCardRow(card) {
  if (!Array.isArray(db.clients)) db.clients = []
  if (card.status === 'unlinked') {
    const prev = db.clients.find(x => x.card === card.num)
    if (prev) prev.card = ''
    return
  }
  const phone = card.phone
  if (!phone) return
  let client = db.clients.find(c => normalizePhoneDigits(c.phone) === normalizePhoneDigits(phone))
  if (!client && card.status === 'active') {
    const nums = db.clients.map(c => parseInt(String(c.id).replace(/\D/g, ''), 10)).filter(n => !Number.isNaN(n))
    const n = (nums.length ? Math.max(...nums) : 0) + 1
    client = normalizeClientRow({
      id: card.clientId || `U-${String(n).padStart(2, '0')}`,
      name: card.client || 'Клиент',
      phone,
      card: card.num,
      level: card.level || 'basic',
      bonus: card.bonus,
      debt: card.debt,
      debtLimit: card.debtLimit,
      vip: !!card.vip,
      blocked: card.status === 'blocked',
      orders: 0,
      spent: 0,
      createdAt: new Date().toISOString().slice(0, 10),
    })
    db.clients.push(client)
  }
  if (!client) return
  client.card = card.num
  const cardName = String(card.client || '').trim()
  const clientName = String(client.name || '').trim()
  if (cardName && cardName !== 'Клиент') client.name = cardName
  else if (!clientName || clientName === 'Клиент') client.name = cardName || clientName || 'Клиент'
  if (card.level) client.level = card.level
  client.bonus = Number(card.bonus) || 0
  client.debt = Number(card.debt) || 0
  client.debtLimit = Number(card.debtLimit) || 0
  client.vip = !!card.vip
  client.blocked = card.status === 'blocked'
  if (card.loyaltyPeriod) client.loyaltyPeriod = card.loyaltyPeriod
  client.debtEnabled = !!(card.debtEnabled || debtFromNote(card.note))
}

app.post('/cards/generate', (req, res) => {
  const count = Math.min(500, Math.max(1, Number(req.query.count) || 1))
  if (!db.cards) db.cards = []
  const created = []
  for (let i = 0; i < count; i++) {
    const nums = db.cards.map(c => parseInt(String(c.num).replace(/\D/g, ''), 10)).filter(n => !Number.isNaN(n))
    const n = (nums.length ? Math.max(...nums) : 0) + 1
    const num = `КАКАПО-${String(n).padStart(4, '0')}`
    const row = normalizeCardRow({
      num,
      client: '',
      phone: '',
      status: 'unlinked',
      level: '',
      bonus: 0,
      debtLimit: 0,
      debt: 0,
    })
    db.cards.push(row)
    created.push(row)
  }
  persist()
  res.json({ ok: true, count: created.length, cards: created })
})

function ensureMissingSeedRows() {
  // Отключено: не подмешивать тестовых клиентов (U-07 / KAKAPO-0236) в прод-базу.
  let changed = false
  for (const client of db.clients || []) {
    if (!client.card) continue
    if (!findCardByNum(client.card)) {
      ensureCardRowForClient(client)
      changed = true
    }
  }
  if (changed) persist()
}

ensureMissingSeedRows()

app.post('/cards/ensure', (req, res) => {
  const body = req.body || {}
  const num = String(body.num || '').toUpperCase()
  if (!num) return res.status(400).json({ detail: 'Укажите номер карты' })
  let card = findCardByNum(num)
  const client = body.clientId
    ? (db.clients || []).find(c => c.id === body.clientId)
    : (db.clients || []).find(c => {
      if (!c.card) return false
      const digits = String(c.card).replace(/\D/g, '')
      return c.card.toUpperCase() === num || digits === num.replace(/\D/g, '')
    })
  if (card) {
    const patch = { ...body, num: card.num }
    delete patch.unlink
    if (patch.vip === true || patch.level != null) patch.loyaltyPeriod = currentLoyaltyPeriod()
    Object.assign(card, normalizeCardRow({ ...card, ...patch, num: card.num }))
    syncClientFromCardRow(card)
  } else {
    const baseClient = client || (body.phone
      ? (db.clients || []).find(c => normalizePhoneDigits(c.phone) === normalizePhoneDigits(body.phone))
      : undefined)
    card = normalizeCardRow({
      num,
      client: body.client || baseClient?.name || '',
      phone: body.phone || baseClient?.phone || '',
      clientId: body.clientId || baseClient?.id,
      status: body.status || 'active',
      level: body.level || baseClient?.level || '',
      bonus: Number(body.bonus ?? baseClient?.bonus) || 0,
      debt: Number(body.debt ?? baseClient?.debt) || 0,
      debtLimit: Number(body.debtLimit ?? baseClient?.debtLimit) || 0,
      vip: !!(body.vip ?? baseClient?.vip),
      debtEnabled: body.debtEnabled !== undefined ? body.debtEnabled === true : baseClient?.debtEnabled === true,
      loyaltyPeriod: body.loyaltyPeriod || baseClient?.loyaltyPeriod,
      issued: new Date().toISOString().slice(0, 10),
    })
    if (!db.cards) db.cards = []
    db.cards.push(card)
    if (baseClient) {
      baseClient.card = card.num
      syncClientFromCardRow(card)
    }
  }
  persist()
  res.json(card)
})

app.patch('/cards/:num', (req, res) => {
  const num = decodeURIComponent(req.params.num).toUpperCase()
  const card = findCardByNum(num)
  if (!card) return res.status(404).json({ detail: 'Карта не найдена' })
  if (req.body.unlink) {
    const prevClient = db.clients?.find(x => x.card === num)
    if (prevClient) prevClient.card = ''
    Object.assign(card, normalizeCardRow({
      num,
      client: '',
      phone: '',
      status: 'unlinked',
      level: '',
      bonus: 0,
      debt: 0,
      debtLimit: 0,
    }))
  } else {
    const body = { ...req.body }
    if (body.vip === true || body.level != null) {
      body.loyaltyPeriod = currentLoyaltyPeriod()
    }
    Object.assign(card, normalizeCardRow({ ...card, ...body, num }))
    syncClientFromCardRow(card)
  }
  persist()
  res.json(card)
})

app.get('/reviews', (req, res) => {
  let list = db.reviews || []
  if (req.query.restId) list = list.filter(r => r.restId === req.query.restId)
  res.json(list)
})
app.post('/reviews', (req, res) => {
  if (!req.body.restId) return res.status(400).json({ detail: 'Укажите ресторан' })
  const dup = req.body.orderId
    ? (db.reviews || []).find(r => r.orderId && r.orderId === String(req.body.orderId))
    : null
  if (dup) return res.status(400).json({ detail: 'Отзыв по этому заказу уже оставлен' })
  const review = createReviewRecord(db, req.body)
  persist()
  broadcastReview(review)
  res.json(review)
})
app.patch('/reviews/:id', (req, res) => {
  const rev = (db.reviews || []).find(r => String(r.id) === String(req.params.id))
  if (!rev) return res.status(404).json({ detail: 'Отзыв не найден' })
  if (req.body.status != null) rev.status = req.body.status
  if (req.body.restSeen != null) rev.restSeen = req.body.restSeen === true
  if (req.body.restNotified != null) rev.restNotified = req.body.restNotified === true
  if (req.body.urgent != null) rev.urgent = req.body.urgent === true
  if (req.body.adminReply != null) rev.adminReply = String(req.body.adminReply).trim()
  if (req.body.restReply != null) rev.restReply = String(req.body.restReply).trim()
  persist()
  broadcastReview(rev)
  res.json(rev)
})
function ensurePush() {
  if (!db.push) {
    db.push = { autoSettings: [], history: [] }
    persist()
  }
}
ensurePush()

app.get('/push', (_req, res) => {
  ensurePush()
  res.json(db.push)
})

app.patch('/push/settings', (req, res) => {
  ensurePush()
  if (Array.isArray(req.body.autoSettings)) {
    db.push.autoSettings = req.body.autoSettings
  }
  persist()
  res.json(db.push)
})

app.post('/push/send', (req, res) => {
  ensurePush()
  const campaign = {
    ...req.body,
    sentAt: req.body.sentAt || new Date().toISOString(),
    id: req.body.id || `push-${Date.now()}`,
  }
  db.push.history = [campaign, ...(db.push.history || [])].slice(0, 50)
  persist()
  res.json(campaign)
})

app.get('/notifications', (req, res) => {
  ensureNotifications()
  const key = phoneKey(String(req.query.phone || ''))
  let list = db.notifications || []
  if (!key) return res.json([])
  list = list.filter(n => n.broadcast === true || n.targetPhone === key)
  res.json(list.slice(0, 80))
})

app.post('/notifications/deliver', (req, res) => {
  ensureNotifications()
  const raw = Array.isArray(req.body.items) ? req.body.items : (req.body.title ? [req.body] : [])
  const created = raw.map((item, i) => ({
    id: item.id || `n-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
    read: !!item.read,
    icon: item.icon || '🔔',
    title: String(item.title || ''),
    body: String(item.body || ''),
    time: item.time || nowTime(),
    color: item.color || 'var(--gr)',
    action: item.action,
    orderId: item.orderId,
    reviewId: item.reviewId,
    broadcast: item.broadcast === true,
    targetPhone: item.broadcast ? undefined : (item.targetPhone ? phoneKey(item.targetPhone) : undefined),
    sentAt: item.sentAt || new Date().toISOString(),
  })).filter(n => n.title && n.body)

  if (created.length) {
    db.notifications.unshift(...created)
    db.notifications = db.notifications.slice(0, 500)
    persist()
    for (const n of created) broadcastNotification(n)
  }
  res.json({ ok: true, count: created.length, items: created })
})

app.patch('/notifications/read-all', (req, res) => {
  ensureNotifications()
  const key = phoneKey(String(req.query.phone || req.body.phone || ''))
  db.notifications = (db.notifications || []).map(n => {
    if (!key) return n
    if (n.broadcast === true || n.targetPhone === key) return { ...n, read: true }
    return n
  })
  persist()
  res.json({ ok: true })
})

app.patch('/notifications/:id/read', (req, res) => {
  ensureNotifications()
  const n = (db.notifications || []).find(x => x.id === req.params.id)
  if (!n) return res.status(404).json({ detail: 'Не найдено' })
  n.read = true
  persist()
  res.json(n)
})

app.get('/finance/summary', (_req, res) => {
  const delivered = (db.orders || []).filter(o => o.status === 'delivered')
  const shopRevenue = delivered.reduce((s, o) => {
    const items = marketItems(o.items || [])
    if (items.length) {
      return s + items.reduce((a, it) => a + (Number(it.price) || 0) * (Number(it.qty) || 1), 0)
    }
    if (inferType(o) === 'market') return s + Math.max(0, Number(o.total) || 0)
    return s
  }, 0)
  const shopOrders = delivered.filter(o => inferType(o) !== 'restaurant').length
  const restaurants = (db.restaurants || []).map(r => ({
    id: r.id,
    name: r.name,
    emoji: r.emoji,
    commission: r.commission,
    ordersMonth: r.ordersMonth || 0,
    revenueMonth: r.revenueMonth || 0,
    paidRevenueMonth: r.paidRevenueMonth || 0,
    balance: getPendingBalance(r),
  }))
  const restaurantGross = restaurants.reduce((s, r) => s + (r.revenueMonth || 0), 0)
  const restaurantCommission = restaurants.reduce((s, r) => s + r.balance.pendingCommission + r.balance.paidCommission, 0)
  const restaurantPendingNet = restaurants.reduce((s, r) => s + r.balance.pendingNet, 0)
  res.json({
    shopRevenue,
    shopOrders,
    shopDeliveryFees: delivered.reduce((s, o) => s + (Number(o.deliveryFee) || 0), 0),
    restaurantGross,
    restaurantCommission,
    restaurantPendingNet,
    totalTurnover: shopRevenue + restaurantGross,
    restaurants,
    payouts: (db.payouts || []).slice(0, 50),
    ordersDelivered: delivered.length,
  })
})

app.get('/admin/dashboard', (_req, res) => {
  res.json({
    ordersToday: db.orders.length,
    revenueToday: db.orders.reduce((s, o) => s + (o.total || 0), 0),
    activeCouriers: 2,
    activeRestaurants: db.restaurants.length,
  })
})
app.post('/sync/woocommerce', (_req, res) => res.json({ ok: true, synced: 0 }))
app.post('/sync/gbs', (_req, res) => res.json({ ok: true, synced: 0 }))

const httpServer = createServer(app)
const wss = new WebSocketServer({ noServer: true })

httpServer.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/ws/')) {
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    clients.add(ws)
    ws.on('message', (data) => { if (String(data) === 'ping') ws.send('pong') })
    ws.on('close', () => clients.delete(ws))
  })
})

httpServer.listen(PORT, '0.0.0.0', () => {
  const dataPath = process.env.DATA_DIR ? `${process.env.DATA_DIR}/kakapo.json` : 'data/kakapo.json'
  console.log(`\n✅ КАКАПО Backend: http://0.0.0.0:${PORT}`)
  console.log(`   База: ${dataPath}`)
  console.log(`   Health: http://0.0.0.0:${PORT}/health\n`)
})
