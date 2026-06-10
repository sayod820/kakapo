import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import { loadDb, saveDb } from './db.js'
import { seedIfEmpty, nextOrderId, DEFAULT_PROMOS } from './seed.js'
import {
  applyStatusPatch,
  isAssemblerOrder,
  isCourierSync,
} from './ordersLogic.js'

const PORT = Number(process.env.PORT) || 8000
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

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

const clients = new Set()

function broadcast(event, order) {
  const msg = JSON.stringify({ event, order })
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg)
  }
}

function nowTime() {
  return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'kakapo-api', local: true }))

app.get('/', (_req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><title>KAKAPO API</title>
<style>body{font-family:system-ui;background:#030B05;color:#EBF5ED;padding:40px;max-width:520px;margin:0 auto}
h1{color:#1FD760}a{color:#1FD760}code{background:#0C1C0F;padding:2px 8px;border-radius:6px}</style></head>
<body>
<h1>✅ KAKAPO Backend работает</h1>
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
app.get('/orders/courier', (_req, res) => res.json(db.orders.filter(isCourierSync)))
app.get('/orders/:id', (req, res) => {
  const o = db.orders.find(x => x.id === req.params.id)
  if (!o) return res.status(404).json({ detail: 'Заказ не найден' })
  res.json(o)
})
app.post('/orders', (req, res) => {
  const body = req.body
  const client = body.client || { name: body.client_name, phone: body.client_phone, addr: body.address, lat: body.lat, lng: body.lng }
  const otype = body.type || 'market'
  const order = {
    id: nextOrderId(db),
    type: otype,
    status: 'new',
    createdAt: nowTime(),
    total: body.total || 0,
    deliveryFee: body.deliveryFee || 0,
    comment: body.comment || '',
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
  db.orders[idx] = applyStatusPatch({ ...db.orders[idx] }, req.body)
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
  r.open = !r.open
  persist()
  res.json(r)
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

app.get('/settings/pricing', (_req, res) => res.json(db.settings.pricing))
app.patch('/settings/pricing', (req, res) => {
  db.settings.pricing = { ...db.settings.pricing, ...req.body }
  persist()
  res.json(db.settings.pricing)
})

app.get('/cards', (_req, res) => res.json(db.cards))
app.post('/cards/generate', (req, res) => res.json({ ok: true, count: Number(req.query.count) || 1 }))
app.get('/reviews', (_req, res) => res.json(db.reviews))
app.post('/reviews', (req, res) => {
  db.reviews.push({ id: ++db._seq.review, ...req.body })
  persist()
  res.json(req.body)
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

httpServer.listen(PORT, () => {
  console.log(`\n✅ KAKAPO Backend: http://localhost:${PORT}`)
  console.log(`   База: server/data/kakapo.json`)
  console.log(`   Health: http://localhost:${PORT}/health\n`)
})
