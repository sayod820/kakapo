'use strict'

/**
 * ИИ-ассистент админки: собирает краткую сводку по БД и спрашивает Gemini.
 * Ключ: GEMINI_API_KEY в server/kakapo-api/.env
 */

import { getGeminiApiKey, getGeminiModel, loadLocalEnv } from './loadEnv.js'

loadLocalEnv()

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function inToday(iso) {
  if (!iso) return false
  const t = new Date(iso).getTime()
  return !Number.isNaN(t) && t >= startOfToday()
}

function daysAgoIso(days) {
  return new Date(Date.now() - days * 864e5).toISOString()
}

function orderHasStatus(order, statuses) {
  return !!order && statuses.includes(String(order.status || ''))
}

function collectOrderRestIds(order) {
  const ids = new Set()
  if (order?.restId) ids.add(String(order.restId))
  for (const rid of order?.restIds || []) {
    if (rid) ids.add(String(rid))
  }
  for (const it of order?.items || []) {
    if (it?.restId) ids.add(String(it.restId))
  }
  if (order?.restParts && typeof order.restParts === 'object') {
    for (const rid of Object.keys(order.restParts)) {
      if (rid) ids.add(String(rid))
    }
  }
  return [...ids]
}

function countRestaurantActivePart(order, restId) {
  const rid = String(restId)
  if (!collectOrderRestIds(order).includes(rid)) return null
  const partStatus = order?.restParts?.[rid]
  if (partStatus === 'done') return 'ready'
  if (partStatus === 'cooking') return 'cooking'
  if (partStatus === 'new') return 'new'
  const status = String(order?.status || '')
  if (status === 'cooking') return 'cooking'
  if (['ready', 'assembler_done', 'courier_picked', 'delivering'].includes(status)) return 'ready'
  if (status === 'new') return 'new'
  return null
}

/** Краткая сводка для ИИ — без телефонов/адресов/секретов */
export function buildAdminAiSnapshot(db) {
  const products = db.products || []
  const sales = db.posSales || []
  const shifts = db.posShifts || []
  const receipts = db.stockReceipts || []
  const writeoffs = db.stockWriteoffs || []
  const orders = db.orders || []
  const clients = db.clients || []
  const cards = db.cards || []
  const restaurants = db.restaurants || []
  const couriers = db.couriers || []
  const assemblers = db.assemblers || []
  const suppliers = db.suppliers || []

  const todaySales = sales.filter(s => inToday(s.createdAtIso) && s.status !== 'returned')
  const weekFrom = daysAgoIso(7)
  const weekSales = sales.filter(s => String(s.createdAtIso || '') >= weekFrom && s.status !== 'returned')

  const soldQty = new Map()
  for (const s of weekSales) {
    for (const it of s.items || []) {
      const left = Math.max(0, (Number(it.qty) || 0) - (Number(it.returnedQty) || 0))
      if (!(left > 0)) continue
      const pid = Number(it.productId) || 0
      if (!pid) continue
      const prev = soldQty.get(pid) || { name: it.productName, qty: 0, revenue: 0 }
      prev.qty = round2(prev.qty + left)
      prev.revenue = round2(prev.revenue + ((Number(it.lineTotal) || 0) * (left / Math.max(1, Number(it.qty) || 1))))
      soldQty.set(pid, prev)
    }
  }

  const topProducts = [...soldQty.entries()]
    .map(([id, v]) => ({ id, name: v.name, qty: v.qty, revenue: v.revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 12)

  const unsoldWithStock = products
    .filter(p => (Number(p.stock) || 0) > 0 && !soldQty.has(Number(p.id)))
    .map(p => ({ id: p.id, name: p.name, stock: p.stock, cat: p.cat || p.catId, price: p.price }))
    .sort((a, b) => (Number(b.stock) || 0) - (Number(a.stock) || 0))
    .slice(0, 15)

  const byCat = {}
  for (const p of products) {
    const cat = String(p.cat || p.catId || 'Без категории')
    if (!byCat[cat]) byCat[cat] = { products: 0, withStock: 0, soldWeek: 0 }
    byCat[cat].products += 1
    if ((Number(p.stock) || 0) > 0) byCat[cat].withStock += 1
    if (soldQty.has(Number(p.id))) byCat[cat].soldWeek += 1
  }

  const debtors = [...clients]
    .filter(c => (Number(c.debt) || 0) > 0.001)
    .sort((a, b) => (Number(b.debt) || 0) - (Number(a.debt) || 0))
    .slice(0, 12)
    .map(c => ({ name: c.name, debt: round2(c.debt), level: c.level, vip: !!c.vip }))

  const openShifts = shifts.filter(s => s.status === 'open').map(s => ({
    cashier: s.cashierName,
    posId: s.posId,
    openingCash: s.openingCash,
    salesCash: s.salesCash,
    salesCount: s.salesCount,
  }))

  const closedWeek = shifts.filter(s => s.status === 'closed' && String(s.closedAtIso || s.openedAtIso || '') >= weekFrom)
  const tillAlerts = closedWeek
    .map(s => {
      const expected = s.expectedCash != null
        ? Number(s.expectedCash)
        : round2((Number(s.openingCash) || 0) + (Number(s.salesCash) || 0) + (Number(s.cashInTotal) || 0) - (Number(s.expenseTotal) || 0))
      const actual = s.actualCash != null ? Number(s.actualCash) : (s.closingCash != null ? Number(s.closingCash) : null)
      const diff = actual != null ? round2(actual - expected) : null
      return {
        cashier: s.cashierName,
        expected,
        actual,
        diff,
        alert: diff != null && Math.abs(diff) >= 50,
      }
    })
    .filter(r => r.alert)
    .slice(0, 10)

  const activeOrders = orders.filter(o => !['delivered', 'cancelled'].includes(o.status))
  const todayOrders = orders.filter(o => inToday(o.createdAtIso))
  const deliveredTodayOrders = orders.filter(o => inToday(o.deliveredAtIso) && o.status === 'delivered')
  const byStatus = {}
  for (const o of activeOrders) {
    byStatus[o.status] = (byStatus[o.status] || 0) + 1
  }

  const courierStats = couriers.map(c => {
    const name = String(c.name || '').trim()
    const assigned = orders.filter(o => String(o?.courier?.name || '').trim() === name)
    const activeAssigned = assigned.filter(o => orderHasStatus(o, ['assembler_done', 'ready', 'courier_picked', 'delivering']))
    const createdTodayAssigned = assigned.filter(o => inToday(o.createdAtIso))
    const deliveredTodayAssigned = assigned.filter(o => inToday(o.deliveredAtIso) && o.status === 'delivered')
    const readyWaitingPickup = assigned.filter(o => orderHasStatus(o, ['assembler_done', 'ready']))
    return {
      name: c.name,
      status: c.status,
      rating: c.rating,
      activeNow: activeAssigned.length,
      waitingPickupNow: readyWaitingPickup.length,
      ordersTodayCreated: createdTodayAssigned.length,
      deliveredToday: deliveredTodayAssigned.length,
      ordersTotal: Number(c.orders) || 0,
    }
  })

  const assemblerStats = assemblers.map(a => {
    const name = String(a.name || '').trim()
    const assigned = orders.filter(o => String(o?.assembler?.name || '').trim() === name)
    const activeAssigned = assigned.filter(o => {
      const st = String(o.status || '')
      if (['new', 'assembling'].includes(st)) return true
      return st === 'ready' && String(o.marketStatus || '') !== 'done'
    })
    const completedTodayAssigned = assigned.filter(o => inToday(o.createdAtIso) && ['assembler_done', 'courier_picked', 'delivering', 'delivered'].includes(String(o.status || '')))
    const createdTodayAssigned = assigned.filter(o => inToday(o.createdAtIso))
    return {
      name: a.name,
      status: a.status,
      rating: a.rating,
      activeNow: activeAssigned.length,
      ordersTodayCreated: createdTodayAssigned.length,
      completedToday: completedTodayAssigned.length,
      ordersTotal: Number(a.ordersTotal || a.orders) || 0,
    }
  })

  const restStats = restaurants.map(r => {
    const menu = r.menu || []
    const stop = menu.filter(m => m.inStock === false).length
    const withPhoto = menu.filter(m => m.photo).length
    const relatedOrders = orders.filter(o => collectOrderRestIds(o).includes(String(r.id)))
    const todayRelatedOrders = relatedOrders.filter(o => inToday(o.createdAtIso))
    const activeRelatedOrders = relatedOrders.filter(o => !['delivered', 'cancelled'].includes(String(o.status || '')))
    const deliveredToday = relatedOrders.filter(o => inToday(o.deliveredAtIso) && o.status === 'delivered')
    const queue = { new: 0, cooking: 0, ready: 0 }
    for (const o of activeRelatedOrders) {
      const stage = countRestaurantActivePart(o, r.id)
      if (stage && queue[stage] != null) queue[stage] += 1
    }
    return {
      name: r.name,
      open: r.open !== false && !r.blocked,
      blocked: !!r.blocked,
      dishes: menu.length,
      stopList: stop,
      withPhoto,
      rating: r.rating,
      revenueMonth: r.revenueMonth,
      ordersTodayCreated: todayRelatedOrders.length,
      deliveredToday: deliveredToday.length,
      activeNow: activeRelatedOrders.length,
      queue,
    }
  })

  const supplierRows = [...suppliers]
    .map(s => ({
      name: s.name,
      debt: round2(s.payableAmount),
      supplied: round2(s.totalSupplied),
      paid: round2(s.totalPaid),
    }))
    .sort((a, b) => b.debt - a.debt)
    .slice(0, 12)

  const todayRevenue = round2(todaySales.reduce((s, x) => s + (Number(x.total) || 0), 0))
  const weekRevenue = round2(weekSales.reduce((s, x) => s + (Number(x.total) || 0), 0))

  return {
    generatedAt: new Date().toISOString(),
    city: 'Яван',
    pos: {
      salesToday: todaySales.length,
      revenueToday: todayRevenue,
      salesWeek: weekSales.length,
      revenueWeek: weekRevenue,
      openShifts: openShifts.length,
      openShiftsDetail: openShifts,
      tillAlerts,
    },
    products: {
      total: products.length,
      topWeek: topProducts,
      unsoldWithStock,
      categories: Object.entries(byCat).map(([cat, v]) => ({ cat, ...v })).slice(0, 20),
    },
    warehouse: {
      receiptsWeek: receipts.filter(r => String(r.createdAtIso || '') >= weekFrom).length,
      writeoffsWeek: writeoffs.filter(r => String(r.createdAtIso || '') >= weekFrom).length,
    },
    clients: {
      total: clients.length,
      cards: cards.length,
      debtorsCount: clients.filter(c => (Number(c.debt) || 0) > 0.001).length,
      debtTotal: round2(clients.reduce((s, c) => s + Math.max(0, Number(c.debt) || 0), 0)),
      topDebtors: debtors,
    },
    suppliers: supplierRows,
    deliveryOrders: {
      active: activeOrders.length,
      byStatus,
      todayCreated: todayOrders.length,
      deliveredToday: deliveredTodayOrders.length,
    },
    restaurants: restStats,
    couriers: {
      total: couriers.length,
      available: couriers.filter(c => c.status === 'available').length,
      busy: couriers.filter(c => c.status === 'busy').length,
      offline: couriers.filter(c => c.status === 'offline').length,
      activeAssignedNow: courierStats.reduce((s, c) => s + c.activeNow, 0),
      waitingPickupNow: courierStats.reduce((s, c) => s + c.waitingPickupNow, 0),
      deliveredToday: courierStats.reduce((s, c) => s + c.deliveredToday, 0),
      list: courierStats.slice(0, 20),
    },
    assemblers: {
      total: assemblers.length,
      activeAssignedNow: assemblerStats.reduce((s, a) => s + a.activeNow, 0),
      completedToday: assemblerStats.reduce((s, a) => s + a.completedToday, 0),
      list: assemblerStats.slice(0, 20),
    },
  }
}

export const AI_QUICK_PROMPTS = [
  {
    id: 'overview',
    label: 'Полный анализ',
    icon: '🧠',
    shortcut: '1',
    prompt: 'Сделай полный анализ бизнеса КАКАПО по данным. Что хорошо, что плохо, где риски. Дай 7–10 конкретных действий на сегодня/неделю.',
  },
  {
    id: 'bad',
    label: 'Что плохо сейчас',
    icon: '⚠️',
    shortcut: '2',
    prompt: 'Найди самые серьёзные проблемы прямо сейчас: касса, долги, склад, доставка, рестораны. Только важное, коротко, с приоритетом.',
  },
  {
    id: 'top',
    label: 'Что продаётся',
    icon: '📈',
    shortcut: '3',
    prompt: 'Какие товары продаются лучше всего за неделю? Что заказывать больше? Что продвигать?',
  },
  {
    id: 'unsold',
    label: 'Что не продаётся',
    icon: '📉',
    shortcut: '4',
    prompt: 'Какие товары не продаются, но лежат на складе? Что уценить, убрать или не заказывать снова?',
  },
  {
    id: 'suppliers',
    label: 'Поставщики +/−',
    icon: '🚚',
    shortcut: '5',
    prompt: 'Оцени поставщиков: кто в плюс, кто в минус/риск по долгу и продажам связанных товаров. Что делать.',
  },
  {
    id: 'debts',
    label: 'Долги клиентов',
    icon: '💳',
    shortcut: '6',
    prompt: 'Проанализируй долги клиентов: кого проверить, кому ограничить кредит, где риск невозврата.',
  },
  {
    id: 'till',
    label: 'Касса и смены',
    icon: '⚖️',
    shortcut: '7',
    prompt: 'Проверь кассу и смены: открытые смены, расхождения, подозрительные моменты. Что проверить кассирам.',
  },
  {
    id: 'couriers',
    label: 'Курьеры',
    icon: '🛵',
    shortcut: '8',
    prompt: 'Оцени курьеров и доставку: кто перегружен, кто офлайн, где узкие места. Что улучшить.',
  },
  {
    id: 'assemblers',
    label: 'Сборщики',
    icon: '🛒',
    shortcut: '9',
    prompt: 'Оцени сборщиков и активные заказы магазина. Где задержки, что сделать.',
  },
  {
    id: 'restaurants',
    label: 'Рестораны',
    icon: '🍽',
    shortcut: '0',
    prompt: 'Оцени рестораны-партнёры: стоп-лист, фото меню, открытость, рейтинг. Кому помочь, кого проверить.',
  },
]

const SYSTEM_INSTRUCTION = `Ты бизнес-ассистент владельца сети КАКАПО (г. Яван, Таджикистан).
Приложения: магазин/касса, клиенты, курьеры, сборщики, рестораны.
Отвечай на русском, коротко и по делу.
Для курьеров, сборщиков и ресторанов считай текущую активность только по полям activeNow, ordersTodayCreated, deliveredToday, completedToday и queue. Исторические поля ordersTotal/week/rating не называй как активность за сегодня.
Если ordersTodayCreated=0 и deliveredToday=0, прямо скажи, что сегодня реальных заказов/действий не было или данных мало.
Формат ответа:
1) Краткий вердикт (2–4 предложения)
2) Проблемы / риски (маркированный список)
3) Что делать сейчас (конкретные шаги)
4) Что не делать
Не выдумывай цифры вне данных. Если данных мало — скажи об этом.
Не проси пароли и не раскрывай персональные данные.`

const DEFAULT_GEMINI_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
]

function geminiModelCandidates() {
  const preferred = getGeminiModel()
  return [...new Set([preferred, ...DEFAULT_GEMINI_MODELS].filter(Boolean))]
}

function isGeminiModelError(message) {
  const m = String(message || '').toLowerCase()
  return m.includes('not found')
    || m.includes('no longer available')
    || m.includes('not supported for generatecontent')
}

async function generateWithGeminiModel(model, prompt, snapshot, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{
      role: 'user',
      parts: [{
        text: `Вопрос владельца:\n${prompt}\n\nДанные приложения (JSON):\n${JSON.stringify(snapshot)}`,
      }],
    }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 2048,
    },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.error?.message || `Gemini ошибка ${res.status}`
    const err = new Error(msg)
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502
    throw err
  }
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n') || ''
  if (!text.trim()) {
    const err = new Error('Gemini вернул пустой ответ')
    err.status = 502
    throw err
  }
  return text.trim()
}

async function callGemini(prompt, snapshot) {
  const apiKey = getGeminiApiKey()
  if (!apiKey) {
    const err = new Error(
      process.env.NODE_ENV === 'production'
        ? 'Нет GEMINI_API_KEY на сервере. Добавьте в deploy/hetzner/.env и перезапустите API (bash deploy/hetzner/set-gemini-key.sh)'
        : 'Нет GEMINI_API_KEY. Добавьте ключ в server/kakapo-api/.env',
    )
    err.status = 503
    throw err
  }

  const candidates = geminiModelCandidates()
  let lastErr = null
  for (const model of candidates) {
    try {
      const text = await generateWithGeminiModel(model, prompt, snapshot, apiKey)
      return { text, model }
    } catch (e) {
      lastErr = e
      if (!isGeminiModelError(e?.message)) throw e
    }
  }
  throw lastErr || new Error('Нет доступной модели Gemini для этого ключа')
}

export async function askAdminAi(db, { prompt, quickId } = {}) {
  let question = String(prompt || '').trim()
  if (!question && quickId) {
    const q = AI_QUICK_PROMPTS.find(x => x.id === quickId)
    question = q?.prompt || ''
  }
  if (!question) {
    const err = new Error('Введите вопрос или выберите быстрый запрос')
    err.status = 400
    throw err
  }
  if (question.length > 4000) {
    const err = new Error('Слишком длинный вопрос')
    err.status = 400
    throw err
  }

  const snapshot = buildAdminAiSnapshot(db)
  const { text: answer, model } = await callGemini(question, snapshot)
  return {
    ok: true,
    prompt: question,
    quickId: quickId || null,
    answer,
    generatedAt: snapshot.generatedAt,
    model,
  }
}

export function getAdminAiStatus() {
  const hasKey = !!getGeminiApiKey()
  return {
    configured: hasKey,
    model: getGeminiModel(),
    quickPrompts: AI_QUICK_PROMPTS.map(({ id, label, icon, shortcut }) => ({ id, label, icon, shortcut })),
  }
}
