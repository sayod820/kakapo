import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import { loadDb, scheduleSaveDb, flushDb, getDbStats } from './db.js'
import {
  ensureUploadDirs,
  processAndSaveProductPhoto,
  deleteManagedProductPhoto,
  UPLOAD_ROOT,
} from './productPhotoPipeline.js'
import {
  processAndSaveRestaurantPhoto,
  deleteManagedRestaurantPhoto,
} from './restaurantPhotoPipeline.js'
import multer from 'multer'
import { seedIfEmpty, nextOrderId, DEFAULT_PROMOS, COURIERS, ASSEMBLERS, DEFAULT_CLIENTS, DEFAULT_CARDS } from './seed.js'
import { ensureMarketCategories } from './marketCategoriesSeed.js'
import {
  applyStatusPatch,
  inferType,
  isAssemblerOrder,
  isCourierMapSync,
  marketItems,
} from './ordersLogic.js'
import { creditDeliveredOrder, processPayout, getPendingBalance } from './restaurantStats.js'
import { lockOrderDeliveryFee, normalizePricing } from './deliveryFee.js'
import {
  applyBonusSpendOnOrder,
  creditClientBonusOnDelivery,
  applyClientLoyaltyAfterDelivery,
  applyLevelUpgrade,
  clearExpiredManualLoyaltyLock,
  ensureLoyaltySettings,
  syncCardDebtLimitsFromLoyalty,
  backfillAllMissedBonuses,
  backfillClientBonuses,
  reconcileClientBonuses,
  reconcileAllClientBonuses,
  reverseClientBonusOnOrderCancel,
  reapplyBonusSpendOnOrderRestore,
  syncOrderBonusOnStatusChange,
  alignPosCashBonusToTarget,
  findClientByPhone,
  bonusEligibleTotal,
} from './loyaltyBonus.js'
import { allocateProductCodes, nextFreeProductCode } from './productCodes.js'
import { createReviewRecord, updateRestaurantRating, updateStoreRating, deleteReviewRecords } from './reviewLogic.js'
import { normalizeLevelAssignMode, inferLevelAssignMode, isLevelLocked, loyaltyLockRecord } from './loyaltyLock.js'
import {
  recoveryExpiresAtIso,
  isRecoveryExpired,
  expireRecoveryClients,
  nextAccountGeneration,
  defaultAccountGeneration,
  stampOrderForClient,
  hardDeleteClientProfile,
} from './accountLifecycle.js'
import {
  applyCourierCommissionOnAccept,
  stampCourierCommissionOnOrder,
  refundCourierCommission,
  depositCourierBalance,
  depositCourierBalanceByAccount,
  withdrawCourierBalance,
  normalizeCourierAccount,
  getCourierWalletTransactions,
} from './courierWallet.js'
import {
  ensurePosCollections,
  ensurePosSaleNumbers,
  listCashiers,
  createCashier,
  updateCashier,
  listPosPoints,
  createPosPoint,
  updatePosPoint,
  deletePosPoint,
  listPosShifts,
  openPosShift,
  closePosShift,
  listSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  createSupplierPayment,
  listSupplierPayments,
  deleteSupplierPayment,
  listExpenses,
  createExpense,
  listFinanceMoves,
  createFinanceMove,
  deleteFinanceMove,
  listStockReceipts,
  createStockReceipt,
  updateStockReceipt,
  deleteStockReceipt,
  listProductStockLayers,
  listAllOpenStockLayers,
  addProductStockLayer,
  updateProductStockLayer,
  listStockWriteoffs,
  createStockWriteoff,
  updateStockWriteoff,
  deleteStockWriteoff,
  listStockRevisions,
  createStockRevision,
  updateStockRevision,
  deleteStockRevision,
  listExpiryItems,
  listPosSales,
  createPosSale,
  createClientOrderFromPosSale,
  returnPosSale,
  getPosFinanceSummary,
  getPosReport,
} from './posLogic.js'
import {
  getCashBook,
  getExpectedVsActual,
  getProfitReport,
  getFinanceAlerts,
  getFinanceTruthBundle,
  listMoneyLedger,
} from './financeTruth.js'
import {
  listEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  loginEmployee,
  ensureDefaultEmployees,
} from './employeesLogic.js'
import {
  askAdminAi,
  getAdminAiStatus,
} from './adminAiAssistant.js'
import { getGeminiApiKey, getGeminiModel, loadLocalEnv } from './loadEnv.js'
import {
  buildDebtLedgerResponse,
  canTakeNewDebt,
  handleClientDebtDelta,
  runDebtMaintenance,
  syncDebtLedgerFromCard,
  syncDebtLedgerToCard,
} from './debtLedger.js'
import {
  ensureAuditLog,
  pruneAuditLog,
  auditFromReq,
  listAuditLog,
  diffBrief,
  AUDIT_RETENTION_DAYS,
} from './auditLog.js'

loadLocalEnv()

function financeTruthQuery(req) {
  return {
    from: req.query.from || null,
    to: req.query.to || null,
    posId: req.query.posId || '',
    cashierId: req.query.cashierId || '',
    type: req.query.type || '',
  }
}

const loyaltyHooks = () => ({
  findCardByNum,
  ensureCardRowForClient,
  syncClientFromCardRow,
})

const PORT = Number(process.env.PORT) || 8000
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
const db = seedIfEmpty()
ensurePosCollections(db)
ensureAuditLog(db)
pruneAuditLog(db)
if (ensureDefaultEmployees(db)) persist()
if (ensurePosSaleNumbers(db)) persist()
if (!db._categorySeedVersion) {
  if (ensureMarketCategories(db)) persist()
  db._categorySeedVersion = 1
  persist()
}
if (!db._supplierPayableSyncVersion) {
  let changed = false
  for (const supplier of db.suppliers || []) {
    const fixed = Math.round(Math.max(0, (Number(supplier.totalSupplied) || 0) - (Number(supplier.totalPaid) || 0)) * 100) / 100
    if (Number(supplier.payableAmount) !== fixed) {
      supplier.payableAmount = fixed
      changed = true
    }
  }
  db._supplierPayableSyncVersion = 1
  if (changed) persist()
}

function persist() {
  scheduleSaveDb()
}

function ensurePromos() {
  if (!Array.isArray(db.promos)) db.promos = []
  if (typeof db._seq.promo !== 'number') db._seq.promo = 0
  // Демо-акции больше не восстанавливаются автоматически (чистый старт).
}
ensurePromos()

function ensureCouriers() {
  if (!Array.isArray(db.couriers)) db.couriers = []
  // Демо-курьеры больше не восстанавливаются автоматически (чистый старт).
  let changed = false
  for (const c of db.couriers) {
    const acc = normalizeCourierAccount(c.account, c.id)
    if (c.account !== acc) {
      c.account = acc
      changed = true
    }
  }
  if (changed) persist()
}
ensureCouriers()

function ensureAssemblers() {
  if (!Array.isArray(db.assemblers)) db.assemblers = []
  // Демо-сборщики больше не восстанавливаются автоматически (чистый старт).
}
ensureAssemblers()

function ensureClients() {
  if (!Array.isArray(db.clients)) db.clients = []
  ensureDeletedPhoneKeys()
  // Не восстанавливать демо-клиентов после полного удаления — иначе после рестарта API
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
  // убрать старые демо-отзывы без привязки к заказу
  const before = db.reviews.length
  db.reviews = db.reviews.filter(r => r.orderId && String(r.orderId).trim())
  if (db.reviews.length !== before) {
    db._seq.review = db.reviews.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0)
    persist()
  }
  for (const r of (db.restaurants || [])) updateRestaurantRating(db, r.id)
  updateStoreRating(db)
}
ensureReviews()

const app = express()
app.use(cors({
  origin: CORS_ORIGINS.length === 1 && CORS_ORIGINS[0] === '*'
    ? true
    : CORS_ORIGINS,
}))
app.use(express.json({ limit: '2mb' }))

ensureUploadDirs()
app.use('/uploads', express.static(UPLOAD_ROOT, {
  maxAge: '30d',
  fallthrough: true,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable')
  },
}))

const photoUpload = multer({
  storage: multer.memoryStorage(),
  // Практически без лимита: сервер сам сожмёт в WebP (защита от OOM — 200 МБ)
  limits: { fileSize: 200 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    const ok = /^image\//i.test(file.mimetype)
      || /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i.test(file.originalname || '')
    cb(ok ? null : new Error('Нужен файл изображения (JPG, PNG, WebP…)'), ok)
  },
})

/** Одно фото товара: обработка → WebP → удаление старого */
app.post('/products/photo', (req, res) => {
  photoUpload.single('photo')(req, res, async err => {
    if (err) {
      const msg = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
        ? 'Файл слишком большой (макс. 200 МБ)'
        : (err.message || 'Ошибка загрузки')
      return res.status(400).json({ detail: msg })
    }
    try {
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ detail: 'Выберите фото' })
      }
      const productId = req.body?.productId ? Number(req.body.productId) : undefined
      const replaceUrl = req.body?.replaceUrl ? String(req.body.replaceUrl) : ''
      const result = await processAndSaveProductPhoto(req.file.buffer, {
        productId: Number.isFinite(productId) ? productId : undefined,
        replaceUrl: replaceUrl || undefined,
      })
      if (productId && Number.isFinite(productId) && productId > 0) {
        const p = db.products.find(x => x.id === productId)
        if (p) {
          const prev = p.photo
          p.photo = result.url
          p.photoThumb = result.thumbUrl
          persist()
          broadcastProduct(p)
          if (prev && prev !== result.url) deleteManagedProductPhoto(prev)
        }
      }
      res.json(result)
    } catch (e) {
      res.status(400).json({ detail: e?.message || 'Не удалось обработать фото' })
    }
  })
})

/** Фото блюда: любое изображение → WebP, старый управляемый файл удаляется. */
app.post('/restaurants/photo', (req, res) => {
  photoUpload.single('photo')(req, res, async err => {
    if (err) {
      const msg = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
        ? 'Файл слишком большой (макс. 200 МБ)'
        : (err.message || 'Ошибка загрузки')
      return res.status(400).json({ detail: msg })
    }
    try {
      if (!req.file?.buffer?.length) return res.status(400).json({ detail: 'Выберите фото' })
      const result = await processAndSaveRestaurantPhoto(req.file.buffer, {
        restaurantId: req.body?.restaurantId,
        dishId: req.body?.dishId,
        replaceUrl: req.body?.replaceUrl ? String(req.body.replaceUrl) : undefined,
      })
      res.json(result)
    } catch (e) {
      res.status(400).json({ detail: e?.message || 'Не удалось обработать фото блюда' })
    }
  })
})

const clients = new Set()

function broadcast(event, order) {
  const msg = JSON.stringify({ event, order })
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg)
  }
}

function broadcastProduct(product) {
  const msg = JSON.stringify({ event: 'product_update', product })
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg)
  }
}

function broadcastRestaurant(restaurant) {
  const msg = JSON.stringify({ event: 'restaurant_update', restaurant })
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg)
  }
}

function broadcastPosUpdate(payload = {}) {
  const msg = JSON.stringify({ event: 'pos_update', payload })
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
  const target = notification.broadcast ? null : phoneKey(notification.targetPhone || '')
  for (const ws of clients) {
    if (ws.readyState !== 1) continue
    if (ws.wsRole !== 'client') continue
    if (notification.broadcast) {
      ws.send(msg)
      continue
    }
    if (target && ws.clientPhone === target) ws.send(msg)
  }
}

function broadcastCourierWallet(payload = {}) {
  const msg = JSON.stringify({
    event: 'courier_wallet_update',
    wallet: {
      courierId: payload.courierId || '',
      account: payload.account || '',
      balance: payload.balance,
    },
  })
  for (const ws of clients) {
    if (ws.readyState !== 1) continue
    if (ws.wsRole === 'admin' || ws.wsRole === 'courier') ws.send(msg)
  }
}

function broadcastLoyalty(payload = {}) {
  const target = phoneKey(payload.phone || '')
  const msg = JSON.stringify({
    event: 'loyalty_update',
    loyalty: {
      phone: payload.phone || '',
      bonus: payload.bonus,
      card: payload.card || '',
    },
  })
  for (const ws of clients) {
    if (ws.readyState !== 1) continue
    if (ws.wsRole === 'admin') {
      ws.send(msg)
      continue
    }
    if (ws.wsRole === 'client' && target && ws.clientPhone === target) {
      ws.send(msg)
    }
  }
}

function parseWsMeta(url) {
  const raw = String(url || '')
  const path = raw.split('?')[0]
  const role = path.replace(/^\/ws\//, '') || 'client'
  const params = new URLSearchParams(raw.includes('?') ? raw.split('?')[1] : '')
  return { role, phone: phoneKey(params.get('phone') || '') }
}

function pushAutoEnabled(eventId) {
  const settings = db.push?.autoSettings || []
  const row = settings.find(s => s.id === eventId)
  return row ? row.enabled !== false : true
}

function deliverDebtNotifications(list = []) {
  for (const payload of list) deliverOrderNotification(payload)
}

/**
 * Запрос пришёл от персонала (админка или касса/торговая точка)?
 * Такие заголовки шлёт только admin/trade; клиентское приложение — нет.
 * Для персонала лимит долга не проверяется (оформляют сразу),
 * лимит действует только в приложении клиента.
 */
function isStaffRequest(req) {
  const app = String(req?.headers?.['x-kakapo-app'] || '').trim().toLowerCase()
  return app === 'admin' || app === 'trade'
}

function runDebtMaintenanceAndNotify() {
  const notes = runDebtMaintenance(db)
  deliverDebtNotifications(notes)
  if (notes.length) persist()
}

function deliverOrderNotification(payload) {
  ensureNotifications()
  const target = phoneKey(payload.targetPhone || '')
  if (!target || !payload.id) return
  if ((db.notifications || []).some(n => n.id === payload.id)) return
  const notif = {
    id: payload.id,
    read: false,
    icon: payload.icon || '🔔',
    title: String(payload.title || ''),
    body: String(payload.body || ''),
    time: nowTime(),
    color: payload.color || 'var(--gr)',
    kind: payload.kind || 'order',
    action: payload.action || 'order',
    orderId: payload.orderId,
    targetPhone: target,
    sentAt: new Date().toISOString(),
  }
  db.notifications.unshift(notif)
  db.notifications = db.notifications.slice(0, 500)
  persist()
  broadcastNotification(notif)
}

function onOrderStatusChangeServer(prev, next) {
  const phone = next.client?.phone || ''
  if (!phone) return
  const orderId = String(next.id)
  const courierName = next.courier?.name || 'Курьер'
  const prevStatus = prev.status
  const nextStatus = next.status
  const otype = inferType(next)

  if (pushAutoEnabled('order_accepted')) {
    const wasPending = ['new', 'pending'].includes(prevStatus)
    const isAccepted = !['new', 'pending', 'cancelled'].includes(nextStatus)
    if (wasPending && isAccepted && otype !== 'restaurant') {
      deliverOrderNotification({
        id: `ord-${orderId}-accepted`,
        targetPhone: phone,
        title: 'Заказ принят',
        body: `${orderId} принят в работу · КАКАПО Market`,
        icon: '✅',
        color: 'var(--gr)',
        orderId,
      })
    }
  }

  if (pushAutoEnabled('restaurant_accepted')) {
    const isRest = otype === 'restaurant' || otype === 'mixed'
    if (isRest) {
      const prevCooking = prevStatus === 'cooking' || prevStatus === 'ready'
      const nextCooking = nextStatus === 'cooking' || nextStatus === 'ready'
      const prevRestParts = prev.restParts || {}
      const nextRestParts = next.restParts || {}
      const restAccepted = Object.keys(nextRestParts).some(
        rid => nextRestParts[rid] === 'cooking' && prevRestParts[rid] !== 'cooking',
      )
      if ((!prevCooking && nextCooking) || restAccepted || (prevStatus === 'new' && nextStatus === 'cooking')) {
        const restName = next.restName || 'Ресторан'
        deliverOrderNotification({
          id: `ord-${orderId}-restaurant`,
          targetPhone: phone,
          title: 'Ресторан принял заказ',
          body: `${restName} готовит ваш заказ ${orderId}`,
          icon: '🍽',
          color: 'var(--gr)',
          orderId,
        })
      }
    }
  }

  if (pushAutoEnabled('courier_departed')) {
    const wasNotEnRoute = !['courier_picked', 'delivering'].includes(prevStatus)
    const isEnRoute = ['courier_picked', 'delivering'].includes(nextStatus)
    if (wasNotEnRoute && isEnRoute) {
      deliverOrderNotification({
        id: `ord-${orderId}-courier`,
        targetPhone: phone,
        title: 'Курьер выехал',
        body: `${courierName} едет к вам · заказ ${orderId}`,
        icon: '🛵',
        color: 'var(--blue)',
        orderId,
      })
    }
  }

  if (pushAutoEnabled('order_delivered')) {
    if (prevStatus !== 'delivered' && nextStatus === 'delivered') {
      deliverOrderNotification({
        id: `ord-${orderId}-delivered`,
        targetPhone: phone,
        title: 'Заказ доставлен',
        body: `${orderId} доставлен. Приятного аппетита!`,
        icon: '📦',
        color: 'var(--gr)',
        orderId,
      })
    }
  }

  if (pushAutoEnabled('bonus_credited')) {
    if (prevStatus !== 'delivered' && nextStatus === 'delivered' && next.bonusEarned > 0) {
      deliverOrderNotification({
        id: `ord-${orderId}-bonus`,
        targetPhone: phone,
        title: 'Начислены бонусы',
        body: `+${next.bonusEarned.toLocaleString('ru-RU')} ⭐ за заказ ${orderId}`,
        icon: '⭐',
        color: 'var(--gd)',
        kind: 'bonus',
        action: 'bonus',
        orderId,
      })
    }
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
  return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dushanbe' })
}

app.get('/health', (_req, res) => {
  const stats = getDbStats()
  const persistent = stats.persistent
  res.json({
    ok: true,
    service: 'kakapo-api',
    version: '2.16-admin-orders-delete',
    loyaltyVip: true,
    dataDir: stats.dataDir,
    dbFile: stats.path,
    persistentDisk: persistent,
    clients: stats.clients,
    orders: stats.orders,
    cards: stats.cards,
    warning: process.env.NODE_ENV === 'production' && !persistent
      ? 'Подключите постоянный диск (DATA_DIR=/data) — иначе клиенты удаляются при каждом деплое'
      : undefined,
  })
})

app.get('/', (_req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><title>КАКАПО API</title>
<style>body{font-family:system-ui;background:#030B05;color:#EBF5ED;padding:40px;max-width:520px;margin:0 auto}
h1{color:#1FD760}a{color:#1FD760}code{background:#0C1C0F;padding:2px 8px;border-radius:6px}</style></head>
<body>
<h1>✅ КАКАПО Backend работает</h1>
<p>Это <strong>API сервер</strong>, не интерфейс приложения.</p>
<p>Откройте <strong>frontend</strong> (в другом терминале: <code>npm run dev</code>):</p>
<p><a href="http://localhost:3000">http://localhost:3000</a> — магазин клиента</p>
<ul>
<li><a href="http://localhost:3000/">Магазин</a></li>
<li><a href="http://localhost:3000/admin">Админка</a></li>
<li><a href="http://localhost:3000/trade">Торговля</a></li>
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
  ensureAdminAuth()
  const loginRaw = String(req.body.login || req.body.email || '').trim()
  const loginKey = loginRaw.toLowerCase()
  const password = String(req.body.password || '')
  if (!loginKey || !password) {
    return res.status(400).json({ detail: 'Укажите логин и пароль' })
  }
  const user = (db.users || []).find(u => {
    if (u.role !== 'admin') return false
    const email = String(u.email || '').toLowerCase()
    const login = String(u.login || '').toLowerCase()
    return (email === loginKey || login === loginKey) && String(u.password || '') === password
  })
  // Обратная совместимость: старый email admin@kakapo.tj при логине "admin"
  const userOrLegacy = user || (db.users || []).find(u => {
    if (u.role !== 'admin') return false
    if (loginKey !== 'admin') return false
    return String(u.email || '').toLowerCase() === 'admin@kakapo.tj'
      && String(u.password || '') === password
  })
  if (!userOrLegacy) return res.status(401).json({ detail: 'Неверный логин или пароль' })
  res.json({
    access_token: `token-${userOrLegacy.role}-${userOrLegacy.id}`,
    role: userOrLegacy.role,
    user_id: userOrLegacy.id,
    name: userOrLegacy.name || 'Админ',
  })
})
app.get('/auth/admin', (_req, res) => {
  const auth = ensureAdminAuth()
  res.json({ login: auth.login })
})

app.patch('/auth/admin', (req, res) => {
  const auth = ensureAdminAuth()
  const body = req.body || {}
  const currentPassword = String(body.currentPassword || '')
  if (!currentPassword || currentPassword !== auth.password) {
    return res.status(401).json({ detail: 'Неверный текущий пароль' })
  }

  let nextLogin = String(body.login != null ? body.login : auth.login).trim()
  if (!nextLogin) return res.status(400).json({ detail: 'Логин не может быть пустым' })
  if (nextLogin.length < 3) return res.status(400).json({ detail: 'Логин минимум 3 символа' })

  let nextPassword = auth.password
  if (body.newPassword != null && String(body.newPassword).length > 0) {
    nextPassword = String(body.newPassword)
    if (nextPassword.length < 4) {
      return res.status(400).json({ detail: 'Новый пароль минимум 4 символа' })
    }
  }

  applyAdminAuth({ login: nextLogin, password: nextPassword })
  auditFromReq(db, req, {
    action: 'update',
    entity: 'settings',
    entityId: 'auth',
    entityName: 'Доступ админки',
    summary: nextLogin !== auth.login
      ? `Сменён логин админа: ${auth.login} → ${nextLogin}`
      : (body.newPassword ? 'Сменён пароль админа' : 'Обновлены данные входа админа'),
  })
  persist()
  res.json({ ok: true, login: nextLogin })
})

app.get('/products', (_req, res) => res.json(db.products))
app.get('/products/next-codes', (_req, res) => {
  const next = nextFreeProductCode(db.products)
  res.json({ next, art: String(next), plu: next <= 9999 ? String(next) : '' })
})
app.post('/products', (req, res) => {
  try {
    const id = ++db._seq.product
    const codes = allocateProductCodes(db.products, {
      art: req.body.art,
      plu: req.body.plu,
    })
    const p = {
      id,
      art: codes.art,
      e: req.body.e || '📦',
      name: req.body.name, price: req.body.price || 0, costPrice: req.body.costPrice ?? null, cat: req.body.cat || '', catId: req.body.catId || '',
      unit: req.body.unit || 'шт', stock: req.body.stock || 0, hot: !!req.body.hot,
      desc: req.body.desc, brand: req.body.brand, country: req.body.country,
      barcode: req.body.barcode ? String(req.body.barcode).trim() : undefined,
      barcodes: Array.isArray(req.body.barcodes)
        ? [...new Set(req.body.barcodes.map(b => String(b).trim()).filter(Boolean))]
        : undefined,
      plu: codes.plu,
      organic: !!req.body.organic, sellType: req.body.sellType || 'piece',
      unitGrams: req.body.unitGrams, weightStep: req.body.weightStep, minWeight: req.body.minWeight,
      old: req.body.old ?? null,
      photo: req.body.photo ? String(req.body.photo) : undefined,
      photoThumb: req.body.photoThumb ? String(req.body.photoThumb) : undefined,
      bulkPricing: Array.isArray(req.body.bulkPricing) ? req.body.bulkPricing : undefined,
    }
    db.products.push(p)
    auditFromReq(db, req, {
      action: 'create',
      entity: 'product',
      entityId: p.id,
      entityName: p.name,
      summary: `Создан товар «${p.name}» · цена ${p.price}`,
      after: { name: p.name, price: p.price, stock: p.stock, art: p.art },
    })
    persist()
    broadcastProduct(p)
    res.json(p)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось создать товар' })
  }
})
app.patch('/products/:id', (req, res) => {
  const p = db.products.find(x => x.id === Number(req.params.id))
  if (!p) return res.status(404).json({ detail: 'Не найдено' })
  try {
    const previousPhoto = p.photo
    const before = { name: p.name, price: p.price, stock: p.stock, costPrice: p.costPrice, cat: p.cat }
    const body = { ...req.body }
    const artTouched = Object.prototype.hasOwnProperty.call(body, 'art')
    const pluTouched = Object.prototype.hasOwnProperty.call(body, 'plu')
    if (artTouched || pluTouched) {
      const codes = allocateProductCodes(db.products, {
        art: artTouched ? body.art : p.art,
        plu: pluTouched ? body.plu : p.plu,
      }, p.id)
      body.art = codes.art
      body.plu = codes.plu
    }
    Object.assign(p, body)
    const after = { name: p.name, price: p.price, stock: p.stock, costPrice: p.costPrice, cat: p.cat }
    auditFromReq(db, req, {
      action: 'update',
      entity: 'product',
      entityId: p.id,
      entityName: p.name,
      summary: `Изменён товар «${p.name}»` + (diffBrief(before, after, ['name', 'price', 'stock', 'costPrice', 'cat']) ? ` · ${diffBrief(before, after, ['name', 'price', 'stock', 'costPrice', 'cat'])}` : ''),
      before,
      after,
    })
    persist()
    broadcastProduct(p)
    if (Object.prototype.hasOwnProperty.call(req.body, 'photo')
        && previousPhoto
        && previousPhoto !== p.photo) {
      deleteManagedProductPhoto(previousPhoto)
    }
    res.json(p)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось обновить товар' })
  }
})

app.get('/products/:id/stock-layers', (req, res) => {
  const id = Number(req.params.id)
  const p = db.products.find(x => x.id === id)
  if (!p) return res.status(404).json({ detail: 'Не найдено' })
  res.json(listProductStockLayers(db, id))
})

app.get('/stock/layers', (_req, res) => {
  res.json(listAllOpenStockLayers(db))
})

app.post('/products/:id/stock-layers', (req, res) => {
  try {
    const id = Number(req.params.id)
    const result = addProductStockLayer(db, id, req.body || {})
    persist()
    broadcastPosUpdate({ kind: 'receipt', id: result.receipt.id })
    broadcastProduct({ id, reason: 'stock-layer' })
    res.json(result)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось добавить приход' })
  }
})

app.patch('/stock/layers/:receiptId/:productId', (req, res) => {
  try {
    const layers = updateProductStockLayer(db, req.params.receiptId, Number(req.params.productId), req.body || {})
    persist()
    broadcastProduct({ id: Number(req.params.productId), reason: 'stock-layer' })
    res.json(layers)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось обновить партию' })
  }
})
app.delete('/products/:id', (req, res) => {
  const id = Number(req.params.id)
  const existing = db.products.find(x => x.id === id)
  if (existing?.photo) deleteManagedProductPhoto(existing.photo)
  if (existing) {
    auditFromReq(db, req, {
      action: 'delete',
      entity: 'product',
      entityId: id,
      entityName: existing.name,
      summary: `Удалён товар «${existing.name}»`,
      before: { name: existing.name, price: existing.price, stock: existing.stock, art: existing.art },
    })
  }
  db.products = db.products.filter(x => x.id !== id)
  persist()
  broadcastProduct({ id, deleted: true })
  res.json({ ok: true })
})

function categoryErrorMessage(code) {
  if (code === 'has products') return 'В категории есть товары'
  if (code === 'not found') return 'Категория не найдена'
  return code
}

app.get('/categories', (_req, res) => {
  res.json(db.categories || [])
})
app.get('/categories/tree', (_req, res) => {
  const roots = db.categories.filter(c => c.parent_id == null)
  const childrenOf = pid => db.categories.filter(c => Number(c.parent_id) === pid)
  const withChildren = cat => ({ ...cat, children: childrenOf(cat.id).map(withChildren) })
  res.json(roots.map(withChildren))
})
app.post('/categories', (req, res) => {
  const id = ++db._seq.category
  const slug = String(req.body.slug || '').trim() || slugifyCategory(req.body.name)
  if (db.categories.some(c => c.slug === slug)) {
    return res.status(400).json({ error: 'slug exists' })
  }
  const parent_id = req.body.parent_id ?? null
  if (parent_id != null && !db.categories.some(c => c.id === Number(parent_id))) {
    return res.status(400).json({ error: 'parent not found' })
  }
  const c = {
    id,
    name: String(req.body.name || '').trim(),
    slug,
    parent_id: parent_id == null ? null : Number(parent_id),
    emoji: req.body.emoji || '📦',
    desc: String(req.body.desc || '').trim(),
    order: Number(req.body.order) || 99,
    active: req.body.active !== false,
  }
  if (!c.name) return res.status(400).json({ error: 'name required' })
  if (Array.isArray(db.deletedCategorySlugs)) {
    db.deletedCategorySlugs = db.deletedCategorySlugs.filter(s => s !== slug)
  }
  db.categories.push(c)
  persist()
  broadcastCategory(c)
  res.json(c)
})
app.patch('/categories/:id', (req, res) => {
  const id = Number(req.params.id)
  const idx = db.categories.findIndex(c => c.id === id)
  if (idx < 0) return res.status(404).json({ error: 'not found' })
  const cur = db.categories[idx]
  const parent_id = req.body.parent_id !== undefined
    ? (req.body.parent_id == null ? null : Number(req.body.parent_id))
    : cur.parent_id
  if (parent_id === id) return res.status(400).json({ error: 'invalid parent' })
  if (parent_id != null && !db.categories.some(c => c.id === parent_id)) {
    return res.status(400).json({ error: 'parent not found' })
  }
  const next = {
    ...cur,
    name: req.body.name != null ? String(req.body.name).trim() : cur.name,
    emoji: req.body.emoji != null ? req.body.emoji : cur.emoji,
    desc: req.body.desc != null ? String(req.body.desc).trim() : cur.desc,
    parent_id,
    order: req.body.order != null ? Number(req.body.order) : cur.order,
    active: req.body.active != null ? !!req.body.active : cur.active !== false,
  }
  if (!next.name) return res.status(400).json({ error: 'name required' })
  db.categories[idx] = next
  persist()
  broadcastCategory(next)
  res.json(next)
})
app.delete('/categories/:id', (req, res) => {
  const id = Number(req.params.id)
  const root = db.categories.find(c => c.id === id)
  if (!root) return res.status(404).json({ error: 'not found' })

  const ids = new Set([id])
  const queue = [id]
  while (queue.length) {
    const pid = queue.pop()
    for (const child of db.categories.filter(c => Number(c.parent_id) === pid)) {
      if (!ids.has(child.id)) {
        ids.add(child.id)
        queue.push(child.id)
      }
    }
  }

  const catsToDelete = db.categories.filter(c => ids.has(c.id))
  const slugsToDelete = new Set(catsToDelete.map(c => c.slug))
  const parentCat = root.parent_id != null
    ? db.categories.find(c => c.id === Number(root.parent_id))
    : null
  const fallbackSlug = parentCat?.slug || ''
  const fallbackName = parentCat?.name || 'Прочее'

  let movedProducts = 0
  for (const p of db.products) {
    if (slugsToDelete.has(p.catId)) {
      p.catId = fallbackSlug
      p.cat = fallbackName
      movedProducts += 1
    }
  }

  if (!Array.isArray(db.deletedCategorySlugs)) db.deletedCategorySlugs = []
  for (const slug of slugsToDelete) {
    if (!db.deletedCategorySlugs.includes(slug)) db.deletedCategorySlugs.push(slug)
  }

  db.categories = db.categories.filter(c => !ids.has(c.id))
  persist()
  broadcastCategory({ id, deleted: true, ids: [...ids], slugs: [...slugsToDelete], movedProducts })
  if (movedProducts) broadcastProduct({ reason: 'category_delete' })
  res.json({ ok: true, movedProducts, deleted: [...ids] })
})

function broadcastCategory(category) {
  const msg = JSON.stringify({ event: 'category_update', category })
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg)
  }
}

function slugifyCategory(name) {
  const map = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' }
  const base = String(name || '').toLowerCase().trim()
    .split('').map(ch => map[ch] ?? ch).join('')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40)
  return base || `cat_${Date.now()}`
}

app.get('/promos', (_req, res) => {
  if (syncAllPromosLifecycle()) persist()
  let changed = false
  for (const promo of db.promos) {
    if (resolvePromoStockLimitUnit(promo)) changed = true
  }
  if (changed) persist()
  res.json(db.promos)
})

function resolvePromoStockLimitUnit(promo) {
  if (!promo) return false
  const limit = Number(promo.stockLimit)
  if (!Number.isFinite(limit) || limit <= 0) return false
  const pid = Number(promo.productId)
  const product = pid ? db.products.find(p => Number(p.id) === pid) : null
  const looksGrams = limit >= 1000 && limit % 1000 === 0 && limit / 1000 >= 1 && limit / 1000 <= 500 && (limit >= 10000 || limit >= 3000)
  const next = (product?.sellType === 'weight' || looksGrams) ? 'grams' : (promo.stockLimitUnit || 'pieces')
  if (promo.stockLimitUnit === next) return false
  promo.stockLimitUnit = next
  return true
}

function syncPromoLifecycle(promo) {
  if (!promo || !promo.on) return false
  let changed = false
  const limit = Number(promo.stockLimit)
  if (Number.isFinite(limit) && limit > 0) {
    const sold = Number(promo.stockSold) || 0
    if (sold >= limit) {
      promo.on = false
      return true
    }
  }
  if (promo.endsAt) {
    const end = new Date(promo.endsAt)
    if (!Number.isNaN(end.getTime()) && Date.now() >= end.getTime()) {
      promo.on = false
      changed = true
    }
  }
  return changed
}

function syncAllPromosLifecycle() {
  if (!Array.isArray(db.promos)) return false
  let changed = false
  for (const promo of db.promos) {
    if (syncPromoLifecycle(promo)) changed = true
  }
  return changed
}

function consumePromoStockOnOrder(order) {
  if (!Array.isArray(order.items) || !Array.isArray(db.promos)) return
  for (const item of order.items) {
    const pid = Number(item.productId ?? item.id)
    if (!pid) continue
    const promo = db.promos.find(p => p.type === 'product' && p.on && Number(p.productId) === pid)
    if (!promo) continue
    const limit = Number(promo.stockLimit)
    if (!Number.isFinite(limit) || limit <= 0) continue
    const add = Number(item.promoUnits ?? item.qty) || 0
    if (add <= 0) continue
    promo.stockSold = (Number(promo.stockSold) || 0) + add
    syncPromoLifecycle(promo)
  }
}

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
  resolvePromoStockLimitUnit(p)
  db.promos.push(p)
  persist()
  res.json(p)
})
app.patch('/promos/:id', (req, res) => {
  const p = db.promos.find(x => x.id === Number(req.params.id))
  if (!p) return res.status(404).json({ detail: 'Не найдено' })
  Object.assign(p, req.body)
  resolvePromoStockLimitUnit(p)
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
    createdAtIso: new Date().toISOString(),
    total: body.total || 0,
    goodsTotal: body.goodsTotal != null ? Number(body.goodsTotal) : undefined,
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
    bonusSpent: 0,
  }
  if (otype === 'mixed') {
    order.marketStatus = body.marketStatus || 'new'
    order.restParts = body.restParts || Object.fromEntries((body.restIds || []).map(r => [r, 'new']))
  }
  const bonusSpendReq = Math.max(0, Math.floor(Number(body.bonusSpent) || 0))
  if (bonusSpendReq > 0) {
    const spendResult = applyBonusSpendOnOrder(db, order, bonusSpendReq, loyaltyHooks())
    if (!spendResult.ok) {
      return res.status(400).json({ detail: spendResult.error || 'Не удалось списать бонусы' })
    }
  }
  const orderClient = findClientByPhone(db, client.phone || '')
  stampOrderForClient(order, orderClient)
  consumePromoStockOnOrder(order)
  db.orders.push(order)
  persist()
  if (bonusSpendReq > 0 && orderClient) {
    broadcastLoyalty({
      phone: orderClient.phone,
      bonus: orderClient.bonus,
      card: orderClient.card || '',
    })
  }
  broadcast('new_order', order)
  res.json(order)
})
app.patch('/orders/:id/status', (req, res) => {
  const idx = db.orders.findIndex(o => o.id === req.params.id)
  if (idx < 0) return res.status(404).json({ detail: 'Заказ не найден' })
  const prev = db.orders[idx]

  const commissionResult = applyCourierCommissionOnAccept(db, prev, req.body)
  if (!commissionResult.ok) {
    return res.status(400).json({ detail: commissionResult.error })
  }

  const updated = applyStatusPatch({ ...prev }, req.body)
  stampCourierCommissionOnOrder(updated, commissionResult)

  // Бонусы: Отменён → вернуть; любой другой статус из отмены → снова списать
  const bonusSync = syncOrderBonusOnStatusChange(db, prev, updated, loyaltyHooks())
  if (bonusSync.changed) {
    const phone = updated.client?.phone || prev.client?.phone || ''
    if (phone) {
      const client = findClientByPhone(db, phone)
      if (client) {
        broadcastLoyalty({
          phone: client.phone,
          bonus: client.bonus,
          card: client.card || '',
        })
      }
    }
  }

  if (updated.status === 'delivered' && prev.status !== 'delivered') {
    updated.deliveredAtIso = new Date().toISOString()
    if (!updated.deliveredAt) {
      updated.deliveredAt = nowTime()
    }
    lockOrderDeliveryFee(updated, db.settings.pricing)
    creditDeliveredOrder(db, updated)
    const phone = updated.client?.phone || ''
    applyClientLoyaltyAfterDelivery(db, updated, loyaltyHooks())
    if (phone) {
      const client = findClientByPhone(db, phone)
      if (client) {
        broadcastLoyalty({
          phone: client.phone,
          bonus: client.bonus,
          card: client.card || '',
        })
      }
    }
  }
  if (updated.status === 'cancelled' && prev.status !== 'cancelled') {
    refundCourierCommission(db, updated)
  }
  db.orders[idx] = updated
  persist()
  if (commissionResult.courierId && Number(commissionResult.commission) > 0) {
    broadcastCourierWallet(commissionResult)
  }
  if (updated.status === 'cancelled' && prev.status !== 'cancelled') {
    const refundedId = updated.courierCommissionCourierId
    if (refundedId && updated.courierCommissionRefunded) {
      const c = (db.couriers || []).find(x => x.id === refundedId)
      if (c) {
        broadcastCourierWallet({
          courierId: c.id,
          account: normalizeCourierAccount(c.account, c.id),
          balance: Math.max(0, Math.round((Number(c.balance) || 0) * 100) / 100),
        })
      }
    }
  }
  onOrderStatusChangeServer(prev, db.orders[idx])
  broadcast('order_update', db.orders[idx])
  res.json(db.orders[idx])
})

function removeOrderRecord(orderId) {
  const id = String(orderId)
  const idx = db.orders.findIndex(o => String(o.id) === id)
  if (idx < 0) return { ok: false, status: 404, detail: 'Заказ не найден' }
  const removed = db.orders[idx]
  const phone = removed.client?.phone || ''
  db.orders.splice(idx, 1)
  if (Array.isArray(db.reviews)) {
    db.reviews = db.reviews.filter(r => String(r.orderId) !== id)
  }
  persist()
  if (phone) {
    try {
      reconcileClientBonuses(db, phone, loyaltyHooks())
    } catch (e) {
      console.error('[orders] reconcile after delete failed', e)
    }
  }
  broadcast('order_deleted', { id })
  return { ok: true, id, phone }
}

app.delete('/orders/:id', (req, res) => {
  const result = removeOrderRecord(req.params.id)
  if (!result.ok) return res.status(result.status || 404).json({ detail: result.detail || 'Заказ не найден' })
  res.json(result)
})

app.post('/orders/bulk-delete', (req, res) => {
  const raw = Array.isArray(req.body?.ids) ? req.body.ids : []
  const ids = [...new Set(raw.map(x => String(x)).filter(Boolean))]
  if (!ids.length) return res.status(400).json({ detail: 'Укажите ids заказов' })
  const removed = []
  const phones = new Set()
  for (const id of ids) {
    const idx = db.orders.findIndex(o => String(o.id) === id)
    if (idx < 0) continue
    const order = db.orders[idx]
    if (order.client?.phone) phones.add(normalizePhoneDigits(order.client.phone))
    db.orders.splice(idx, 1)
    if (Array.isArray(db.reviews)) {
      db.reviews = db.reviews.filter(r => String(r.orderId) !== id)
    }
    removed.push(id)
  }
  if (!removed.length) return res.status(404).json({ detail: 'Заказы не найдены' })
  persist()
  for (const key of phones) {
    if (!key) continue
    const client = (db.clients || []).find(c => normalizePhoneDigits(c.phone) === key)
    if (client?.phone) {
      try {
        reconcileClientBonuses(db, client.phone, loyaltyHooks())
      } catch (e) {
        console.error('[orders] reconcile after bulk delete failed', e)
      }
    }
  }
  for (const id of removed) broadcast('order_deleted', { id })
  res.json({ ok: true, removed: removed.length, ids: removed })
})

app.get('/restaurants', (_req, res) => res.json(db.restaurants))
app.post('/restaurants', (req, res) => {
  const b = req.body || {}
  const name = String(b.name || '').trim()
  if (!name) return res.status(400).json({ detail: 'Укажите название ресторана' })
  if (!Array.isArray(db.restaurants)) db.restaurants = []
  // Генерируем уникальный id вида R-05 (по максимальному существующему номеру)
  let n = db.restaurants.reduce((m, r) => {
    const num = parseInt(String(r.id || '').replace(/^R-0?/, ''), 10)
    return Number.isFinite(num) ? Math.max(m, num) : m
  }, 0) + 1
  let id = `R-${String(n).padStart(2, '0')}`
  while (db.restaurants.some(r => r.id === id)) {
    n += 1
    id = `R-${String(n).padStart(2, '0')}`
  }
  const rest = {
    id,
    name,
    emoji: b.emoji || '🍽',
    cuisine: String(b.cuisine || '').trim() || '—',
    address: String(b.address || '').trim(),
    phone: String(b.phone || '').trim(),
    email: String(b.email || '').trim(),
    commission: Math.max(0, Math.min(100, Number(b.commission) || 15)),
    open: true,
    blocked: false,
    rating: Number(b.rating) || 5,
    reviews: 0,
    ordersMonth: 0,
    revenueMonth: 0,
    paidRevenueMonth: 0,
    img: b.img || 'linear-gradient(135deg,#1A0808,#3A1010)',
    menu: [],
  }
  db.restaurants.push(rest)
  persist()
  broadcastRestaurant(rest)
  res.status(201).json(rest)
})
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
  broadcastRestaurant(r)
  res.json(r)
})
app.patch('/restaurants/:id', (req, res) => {
  const r = db.restaurants.find(x => x.id === req.params.id)
  if (!r) return res.status(404).json({ detail: 'Не найдено' })
  for (const k of ['name', 'cuisine', 'address', 'phone', 'email', 'open', 'blocked', 'hours']) {
    if (req.body[k] !== undefined) r[k] = req.body[k]
  }
  if (Array.isArray(req.body.menu)) {
    const oldPhotos = new Set((r.menu || []).map(item => item?.photo).filter(Boolean))
    const menu = req.body.menu.map((item, index) => ({
      ...item,
      id: Number(item?.id) || Date.now() + index,
      name: String(item?.name || '').trim(),
      price: Math.max(0, Number(item?.price) || 0),
      photo: item?.photo ? String(item.photo) : undefined,
    }))
    const nextPhotos = new Set(menu.map(item => item.photo).filter(Boolean))
    r.menu = menu
    const changedOrders = []
    for (const order of (db.orders || [])) {
      let changed = false
      for (const item of (order.items || [])) {
        const itemRestId = String(item.restId || order.restId || '')
        if (itemRestId !== String(r.id)) continue
        const dish = menu.find(m =>
          (Number(item.id) > 0 && Number(m.id) === Number(item.id))
          || String(m.name || '').trim() === String(item.name || '').trim()
        )
        if (!dish || item.photo === dish.photo) continue
        item.photo = dish.photo
        changed = true
      }
      if (changed) changedOrders.push(order)
    }
    for (const oldUrl of oldPhotos) {
      if (!nextPhotos.has(oldUrl)) deleteManagedRestaurantPhoto(oldUrl)
    }
    for (const order of changedOrders) broadcast('order_update', order)
  }
  persist()
  broadcastRestaurant(r)
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
  broadcastRestaurant(r)
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
  const commission = Number(raw.commissionPercent ?? raw.commissionPerOrder)
  return {
    ...raw,
    vehicle,
    maxActiveOrders: Math.max(1, Math.min(5, Number(raw.maxActiveOrders) || 1)),
    blocked: !!raw.blocked,
    balance: Math.max(0, Math.round((Number(raw.balance) || 0) * 100) / 100),
    account: normalizeCourierAccount(raw.account, raw.id),
    commissionPercent: Number.isFinite(commission) && commission > 0 ? Math.min(100, Math.round(commission * 100) / 100) : undefined,
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
    balance: 0,
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
app.post('/couriers/:id/deposit', (req, res) => {
  const result = depositCourierBalance(db, req.params.id, req.body?.amount, req.body?.note)
  if (!result.ok) return res.status(400).json({ detail: result.error })
  persist()
  broadcastCourierWallet(result)
  res.json(result)
})
app.post('/couriers/:id/withdraw', (req, res) => {
  const result = withdrawCourierBalance(db, req.params.id, req.body?.amount, req.body?.note)
  if (!result.ok) return res.status(400).json({ detail: result.error })
  persist()
  broadcastCourierWallet(result)
  res.json(result)
})
app.post('/couriers/deposit-by-account', (req, res) => {
  const result = depositCourierBalanceByAccount(db, req.body?.account, req.body?.amount, req.body?.note)
  if (!result.ok) return res.status(400).json({ detail: result.error })
  persist()
  broadcastCourierWallet(result)
  res.json(result)
})
app.get('/couriers/:id/wallet/transactions', (req, res) => {
  const c = (db.couriers || []).find(x => x.id === req.params.id)
  if (!c) return res.status(404).json({ detail: 'Курьер не найден' })
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30))
  res.json({
    courierId: c.id,
    account: normalizeCourierAccount(c.account, c.id),
    balance: Math.max(0, Math.round((Number(c.balance) || 0) * 100) / 100),
    transactions: getCourierWalletTransactions(db, c.id, limit),
  })
})
app.get('/couriers/wallet/transactions', (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40))
  const courierId = String(req.query.courierId || '').trim()
  const couriersById = Object.fromEntries((db.couriers || []).map(c => [c.id, c]))
  let txs = [...(db.courierWalletTx || [])]
  if (courierId) txs = txs.filter(t => t.courierId === courierId)
  res.json({
    transactions: txs.slice(0, limit).map(t => ({
      ...t,
      account: normalizeCourierAccount(couriersById[t.courierId]?.account, t.courierId),
      courierName: couriersById[t.courierId]?.name || '—',
    })),
  })
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

app.get('/cashiers', (_req, res) => {
  res.json(listCashiers(db))
})
app.post('/cashiers', (req, res) => {
  try {
    const row = createCashier(db, req.body || {})
    persist()
    broadcastPosUpdate({ kind: 'cashier', id: row.id })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось создать кассира' })
  }
})
app.patch('/cashiers/:id', (req, res) => {
  try {
    const row = updateCashier(db, req.params.id, req.body || {})
    persist()
    broadcastPosUpdate({ kind: 'cashier', id: row.id })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось обновить кассира' })
  }
})

/** Сотрудники «Торговля» — доступ к разделам */
app.get('/employees', (_req, res) => {
  res.json(listEmployees(db))
})
/** Для экрана входа в Торговлю — без паролей */
app.get('/employees/directory', (_req, res) => {
  res.json(listEmployees(db).filter(e => e.active !== false).map(e => ({
    id: e.id,
    name: e.name,
    role: e.role,
    roleLabel: e.roleLabel,
  })))
})
app.post('/employees', (req, res) => {
  try {
    const row = createEmployee(db, req.body || {})
    auditFromReq(db, req, {
      action: 'create',
      entity: 'employee',
      entityId: row.id,
      entityName: row.name,
      summary: `Создан сотрудник «${row.name}» · ${row.role || row.roleLabel || ''}`,
      after: { name: row.name, role: row.role, active: row.active },
    })
    persist()
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось создать сотрудника' })
  }
})
app.patch('/employees/:id', (req, res) => {
  try {
    const before = (db.employees || []).find(e => e.id === req.params.id)
    const row = updateEmployee(db, req.params.id, req.body || {})
    auditFromReq(db, req, {
      action: 'update',
      entity: 'employee',
      entityId: row.id,
      entityName: row.name,
      summary: `Изменён сотрудник «${row.name}»`,
      before: before ? { name: before.name, role: before.role, active: before.active } : undefined,
      after: { name: row.name, role: row.role, active: row.active },
    })
    persist()
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось обновить' })
  }
})
app.delete('/employees/:id', (req, res) => {
  try {
    const row = deleteEmployee(db, req.params.id)
    auditFromReq(db, req, {
      action: 'delete',
      entity: 'employee',
      entityId: row.id,
      entityName: row.name,
      summary: `Удалён сотрудник «${row.name}»`,
      before: { name: row.name, role: row.role },
    })
    persist()
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось удалить' })
  }
})
app.post('/employees/login', (req, res) => {
  try {
    const row = loginEmployee(db, req.body || {})
    auditFromReq(db, req, {
      app: 'trade',
      action: 'login',
      entity: 'employee',
      entityId: row.id,
      entityName: row.name,
      summary: `Вход в Торговлю: ${row.name}`,
      actor: { name: row.name, employeeId: row.id, role: row.role },
    })
    persist()
    res.json(row)
  } catch (e) {
    res.status(401).json({ detail: e?.message || 'Ошибка входа' })
  }
})

app.get('/pos/points', (_req, res) => {
  res.json(listPosPoints(db))
})
app.post('/pos/points', (req, res) => {
  try {
    const row = createPosPoint(db, req.body || {})
    persist()
    broadcastPosUpdate({ kind: 'pos', id: row.id })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось создать точку продаж' })
  }
})
app.patch('/pos/points/:id', (req, res) => {
  try {
    const row = updatePosPoint(db, req.params.id, req.body || {})
    persist()
    broadcastPosUpdate({ kind: 'pos', id: row.id })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось обновить точку продаж' })
  }
})
app.delete('/pos/points/:id', (req, res) => {
  try {
    const row = deletePosPoint(db, req.params.id)
    persist()
    broadcastPosUpdate({ kind: 'pos', id: row.id, deleted: true })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось удалить точку продаж' })
  }
})

app.get('/pos/shifts', (_req, res) => {
  res.json(listPosShifts(db))
})
app.post('/pos/shifts/open', (req, res) => {
  try {
    const row = openPosShift(db, req.body || {})
    auditFromReq(db, req, {
      app: 'trade',
      action: 'shift_open',
      entity: 'shift',
      entityId: row.id,
      entityName: row.cashierName || row.posId,
      summary: `Открыта смена · ${row.cashierName || 'кассир'} · касса ${row.openingCash ?? 0}`,
    })
    persist()
    broadcastPosUpdate({ kind: 'shift', id: row.id })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось открыть смену' })
  }
})
app.patch('/pos/shifts/:id/close', (req, res) => {
  try {
    const row = closePosShift(db, req.params.id, req.body || {})
    auditFromReq(db, req, {
      app: 'trade',
      action: 'shift_close',
      entity: 'shift',
      entityId: row.id,
      entityName: row.cashierName || row.posId,
      summary: `Закрыта смена · ${row.cashierName || 'кассир'}`,
    })
    persist()
    broadcastPosUpdate({ kind: 'shift', id: row.id })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось закрыть смену' })
  }
})

app.get('/pos/sales', (_req, res) => {
  if (ensurePosSaleNumbers(db)) persist()
  res.json(listPosSales(db))
})
app.post('/pos/sales', (req, res) => {
  try {
    const body = req.body || {}
    // Идемпотентность офлайн-синхронизации: если чек с таким clientRef уже проведён — возвращаем его
    const clientRef = body.clientRef ? String(body.clientRef).trim() : ''
    if (clientRef) {
      const dup = (db.posSales || []).find(s => s.clientRef === clientRef)
      if (dup) return res.json(dup)
    }
    const bonusSpendReq = Math.max(0, Math.floor(Number(body.bonusSpent) || 0))
    if (bonusSpendReq > 0) {
      const phone = String(body.clientPhone || '').trim()
      if (!phone) return res.status(400).json({ detail: 'Для списания бонусов нужен клиент' })
      const client = findClientByPhone(db, phone)
      if (!client) return res.status(400).json({ detail: 'Клиент не найден' })
      const card = client.card ? findCardByNum(client.card) : ensureCardRowForClient(client)
      const bal = Number(card?.bonus) || 0
      if (bal < bonusSpendReq) {
        return res.status(400).json({ detail: `Недостаточно бонусов (доступно ${bal})` })
      }
    }

    const row = createPosSale(db, body)
    deliverDebtNotifications(row._debtNotifications || [])
    let order = null
    if (row.clientPhone) {
      order = createClientOrderFromPosSale(db, row, body)
      if (order) {
        if (bonusSpendReq > 0) {
          const spendResult = applyBonusSpendOnOrder(db, order, bonusSpendReq, loyaltyHooks())
          if (!spendResult.ok) {
            db.orders = (db.orders || []).filter(o => o.id !== order.id)
            row.orderId = undefined
            return res.status(400).json({ detail: spendResult.error || 'Не удалось списать бонусы' })
          }
        }
        applyClientLoyaltyAfterDelivery(db, order, loyaltyHooks())
        const phone = order.client?.phone || ''
        if (phone) {
          const client = findClientByPhone(db, phone)
          if (client) {
            broadcastLoyalty({
              phone: client.phone,
              bonus: client.bonus,
              card: client.card || '',
            })
          }
        }
        broadcast('new_order', order)
      }
    }
    persist()
    broadcastPosUpdate({ kind: 'sale', id: row.id })
    broadcastProduct({ reason: 'sale' })
    auditFromReq(db, req, {
      app: 'trade',
      action: 'sale',
      entity: 'sale',
      entityId: row.id,
      entityName: row.saleNumber || row.id,
      summary: `Продажа ${row.saleNumber || row.id} · ${row.total} ЅМ` + ((Number(row.debtAdded) || 0) > 0 ? ` · долг +${row.debtAdded}` : ''),
      after: { total: row.total, debtAdded: row.debtAdded, paymentMethod: row.paymentMethod, cashierName: row.cashierName },
    })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось провести продажу' })
  }
})
app.post('/pos/sales/:id/return', (req, res) => {
  try {
    const row = returnPosSale(db, req.params.id, req.body || {})
    const bonusRefund = Number(row._bonusRefunded) || 0
    const bonusPhone = String(row._bonusRefundPhone || row.clientPhone || '').trim()
    delete row._bonusRefunded
    delete row._bonusRefundPhone
    if (bonusRefund > 0 && bonusPhone) {
      reconcileClientBonuses(db, bonusPhone, loyaltyHooks())
      const client = findClientByPhone(db, bonusPhone)
      if (client) {
        broadcastLoyalty({
          phone: client.phone,
          bonus: client.bonus,
          card: client.card || '',
        })
      }
    }
    auditFromReq(db, req, {
      app: 'trade',
      action: 'return',
      entity: 'sale',
      entityId: row.id,
      entityName: row.saleNumber || row.id,
      summary: `Возврат по чеку ${row.saleNumber || row.id}`
        + (bonusRefund > 0 ? ` · бонусы +${bonusRefund}` : ''),
    })
    persist()
    broadcastPosUpdate({ kind: 'sale-return', id: row.id })
    broadcastProduct({ reason: 'sale-return' })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось оформить возврат' })
  }
})

app.get('/stock/receipts', (_req, res) => {
  res.json(listStockReceipts(db))
})
app.post('/stock/receipts', (req, res) => {
  try {
    const row = createStockReceipt(db, req.body || {})
    auditFromReq(db, req, {
      action: 'create',
      entity: 'stock',
      entityId: row.id,
      entityName: row.supplierName || row.id,
      summary: `Приход товара · ${row.supplierName || row.id}` + (row.items?.length ? ` · ${row.items.length} поз.` : ''),
    })
    persist()
    broadcastPosUpdate({ kind: 'receipt', id: row.id })
    broadcastProduct({ reason: 'receipt' })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось провести приход' })
  }
})
app.put('/stock/receipts/:id', (req, res) => {
  try {
    const row = updateStockReceipt(db, req.params.id, req.body || {})
    auditFromReq(db, req, {
      action: 'update',
      entity: 'stock',
      entityId: row.id,
      entityName: row.supplierName || row.id,
      summary: `Изменён приход · ${row.supplierName || row.id}`,
    })
    persist()
    broadcastPosUpdate({ kind: 'receipt', id: row.id, updated: true })
    broadcastProduct({ reason: 'receipt-update' })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось изменить приход' })
  }
})
app.delete('/stock/receipts/:id', (req, res) => {
  try {
    const row = deleteStockReceipt(db, req.params.id)
    auditFromReq(db, req, {
      action: 'delete',
      entity: 'stock',
      entityId: row.id,
      entityName: row.supplierName || row.id,
      summary: `Удалён приход · ${row.supplierName || row.id}`,
    })
    persist()
    broadcastPosUpdate({ kind: 'receipt', id: row.id, deleted: true })
    broadcastProduct({ reason: 'receipt-delete' })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось удалить приход' })
  }
})
app.get('/stock/writeoffs', (_req, res) => {
  res.json(listStockWriteoffs(db))
})
app.post('/stock/writeoffs', (req, res) => {
  try {
    const row = createStockWriteoff(db, req.body || {})
    auditFromReq(db, req, {
      action: 'create',
      entity: 'stock',
      entityId: row.id,
      entityName: row.reason || row.id,
      summary: `Списание · ${row.reason || row.id}`,
    })
    persist()
    broadcastPosUpdate({ kind: 'writeoff', id: row.id })
    broadcastProduct({ reason: 'writeoff' })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось провести списание' })
  }
})
app.put('/stock/writeoffs/:id', (req, res) => {
  try {
    const row = updateStockWriteoff(db, req.params.id, req.body || {})
    auditFromReq(db, req, {
      action: 'update',
      entity: 'stock',
      entityId: row.id,
      entityName: row.reason || row.id,
      summary: `Изменено списание · ${row.reason || row.id}`,
    })
    persist()
    broadcastPosUpdate({ kind: 'writeoff', id: row.id, updated: true })
    broadcastProduct({ reason: 'writeoff-update' })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось изменить списание' })
  }
})
app.delete('/stock/writeoffs/:id', (req, res) => {
  try {
    const row = deleteStockWriteoff(db, req.params.id)
    auditFromReq(db, req, {
      action: 'delete',
      entity: 'stock',
      entityId: row.id,
      entityName: row.reason || row.id,
      summary: `Удалено списание · ${row.reason || row.id}`,
    })
    persist()
    broadcastPosUpdate({ kind: 'writeoff', id: row.id, deleted: true })
    broadcastProduct({ reason: 'writeoff-delete' })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось удалить списание' })
  }
})
app.get('/stock/revisions', (_req, res) => {
  res.json(listStockRevisions(db))
})
app.post('/stock/revisions', (req, res) => {
  try {
    const row = createStockRevision(db, req.body || {})
    auditFromReq(db, req, {
      action: 'create',
      entity: 'stock',
      entityId: row.id,
      entityName: row.note || row.id,
      summary: `Ревизия склада · ${row.note || row.id}`,
    })
    persist()
    broadcastPosUpdate({ kind: 'revision', id: row.id })
    broadcastProduct({ reason: 'revision' })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось сохранить ревизию' })
  }
})
app.put('/stock/revisions/:id', (req, res) => {
  try {
    const row = updateStockRevision(db, req.params.id, req.body || {})
    auditFromReq(db, req, {
      action: 'update',
      entity: 'stock',
      entityId: row.id,
      entityName: row.note || row.id,
      summary: `Изменена ревизия · ${row.note || row.id}`,
    })
    persist()
    broadcastPosUpdate({ kind: 'revision', id: row.id, updated: true })
    broadcastProduct({ reason: 'revision-update' })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось изменить ревизию' })
  }
})
app.delete('/stock/revisions/:id', (req, res) => {
  try {
    const row = deleteStockRevision(db, req.params.id)
    auditFromReq(db, req, {
      action: 'delete',
      entity: 'stock',
      entityId: row.id,
      entityName: row.note || row.id,
      summary: `Удалена ревизия · ${row.note || row.id}`,
    })
    persist()
    broadcastPosUpdate({ kind: 'revision', id: row.id, deleted: true })
    broadcastProduct({ reason: 'revision-delete' })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось удалить ревизию' })
  }
})
app.get('/stock/expiry', (req, res) => {
  res.json(listExpiryItems(db, Number(req.query.days) || 14))
})

app.get('/suppliers', (_req, res) => {
  res.json(listSuppliers(db))
})
app.post('/suppliers', (req, res) => {
  try {
    const row = createSupplier(db, req.body || {})
    persist()
    broadcastPosUpdate({ kind: 'supplier', id: row.id })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось создать поставщика' })
  }
})
app.patch('/suppliers/:id', (req, res) => {
  try {
    const row = updateSupplier(db, req.params.id, req.body || {})
    persist()
    broadcastPosUpdate({ kind: 'supplier', id: row.id })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось обновить поставщика' })
  }
})
app.delete('/suppliers/:id', (req, res) => {
  try {
    const row = deleteSupplier(db, req.params.id)
    persist()
    broadcastPosUpdate({ kind: 'supplier', id: row.id, deleted: true })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось удалить поставщика' })
  }
})
app.get('/suppliers/:id/payments', (req, res) => {
  try {
    res.json(listSupplierPayments(db, req.params.id))
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось получить историю платежей' })
  }
})
app.post('/suppliers/:id/payments', (req, res) => {
  try {
    const row = createSupplierPayment(db, req.params.id, req.body || {})
    persist()
    broadcastPosUpdate({ kind: 'supplier_payment', id: row.id })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось провести оплату поставщику' })
  }
})
app.delete('/suppliers/:id/payments/:paymentId', (req, res) => {
  try {
    const row = deleteSupplierPayment(db, req.params.id, req.params.paymentId)
    persist()
    broadcastPosUpdate({ kind: 'supplier_payment', id: row.id, deleted: true })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось удалить платёж' })
  }
})

app.get('/expenses', (_req, res) => {
  res.json(listExpenses(db))
})
app.post('/expenses', (req, res) => {
  try {
    const row = createExpense(db, req.body || {})
    persist()
    broadcastPosUpdate({ kind: 'expense', id: row.id })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось добавить расход' })
  }
})

app.get('/finance/moves', (_req, res) => {
  res.json(listFinanceMoves(db))
})
app.post('/finance/moves', (req, res) => {
  try {
    const row = createFinanceMove(db, req.body || {})
    persist()
    broadcastPosUpdate({ kind: 'finance-move', id: row.id })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось сохранить движение' })
  }
})
app.delete('/finance/moves/:id', (req, res) => {
  try {
    const row = deleteFinanceMove(db, req.params.id)
    persist()
    broadcastPosUpdate({ kind: 'finance-move', id: row.id, deleted: true })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось удалить' })
  }
})

/** Единый источник правды: цифры только из БД */
app.get('/finance/truth', (req, res) => {
  res.json(getFinanceTruthBundle(db, financeTruthQuery(req)))
})
app.get('/finance/cashbook', (req, res) => {
  res.json(getCashBook(db, financeTruthQuery(req)))
})
app.get('/finance/expected-vs-actual', (req, res) => {
  res.json(getExpectedVsActual(db, financeTruthQuery(req)))
})
app.get('/finance/profit', (req, res) => {
  res.json(getProfitReport(db, financeTruthQuery(req)))
})
app.get('/finance/journal', (req, res) => {
  const q = financeTruthQuery(req)
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 500))
  const rows = listMoneyLedger(db, q)
  res.json({
    rows: rows.slice(0, limit),
    count: rows.length,
  })
})
app.get('/finance/alerts', (req, res) => {
  res.json(getFinanceAlerts(db, financeTruthQuery(req)))
})

function normalizePhoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-9)
}

function clientOutstandingDebt(client) {
  if (!client) return 0
  const phone = normalizePhoneDigits(client.phone)
  const linkedCards = (db.cards || []).filter(card =>
    (card.clientId && card.clientId === client.id)
    || (client.card && card.num === client.card)
    || (phone && normalizePhoneDigits(card.phone) === phone),
  )
  return Math.max(
    0,
    Number(client.debt) || 0,
    ...linkedCards.map(card => Number(card.debt) || 0),
  )
}

function rejectDeleteWithDebt(res, clients) {
  const debt = Math.max(0, ...(clients || []).map(clientOutstandingDebt))
  if (debt <= 0.001) return false
  res.status(409).json({
    detail: `Нельзя удалить аккаунт: сначала погасите долг ${debt.toLocaleString('ru-RU')} ЅМ`,
  })
  return true
}

const PURGED_NOTE = 'kakapo-purged'

function ensureDeletedPhoneKeys() {
  if (!Array.isArray(db.deletedPhoneKeys)) db.deletedPhoneKeys = []
}

function rememberDeletedPhone(phone) {
  ensureDeletedPhoneKeys()
  const key = normalizePhoneDigits(phone)
  if (!key) return
  if (!db.deletedPhoneKeys.includes(key)) {
    db.deletedPhoneKeys.push(key)
    persist()
  }
}

function clearPersonalNotificationsOnServer(phone) {
  ensureNotifications()
  const key = phoneKey(phone)
  if (!key) return
  const before = (db.notifications || []).length
  db.notifications = (db.notifications || []).filter(n => n.broadcast === true || n.targetPhone !== key)
  if (db.notifications.length !== before) persist()
}

/** Удалить заказы — только для демо/тестов, не для удаления клиентов */
function purgeClientProfilesForPhone(phone, { rememberDeleted = false } = {}) {
  const key = normalizePhoneDigits(phone)
  if (!key) return { orders: 0, clients: 0 }

  const toRemove = [...(db.clients || [])].filter(c => normalizePhoneDigits(c.phone) === key)
  for (const client of toRemove) {
    hardDeleteClientProfile(db, client, {
      unlinkCardsForClient,
      rememberDeleted,
      rememberDeletedPhone: rememberDeleted ? rememberDeletedPhone : undefined,
    })
  }

  // Даже если клиента уже нет — для админского удаления помечаем телефон,
  // чтобы магазин на телефоне вышел из сессии.
  if (rememberDeleted) rememberDeletedPhone(phone)
  else forgetDeletedPhone(phone)

  clearPersonalNotificationsOnServer(phone)
  persist()
  return { orders: 0, clients: toRemove.length }
}

function runAccountLifecycleMaintenance() {
  return expireRecoveryClients(db, { unlinkCardsForClient, persist })
}

/**
 * Авто-статус — живая функция от трат за скользящие 30 дней (не привязан к календарному
 * месяцу), поэтому может «тихо» понизиться без единого нового заказа. Освежаем его при
 * каждом чтении клиентов/карт, а не только по событиям заказа.
 */
function runLoyaltyMaintenance() {
  const loyalty = ensureLoyaltySettings(db)
  let changed = false
  for (const client of db.clients || []) {
    if (!client.phone) continue
    const card = client.card ? findCardByNum(client.card) : null
    const beforeLevel = client.level
    clearExpiredManualLoyaltyLock(db, client.phone, client, card, loyalty)
    if (inferLevelAssignMode(client, card) === 'auto' && !isLevelLocked(loyaltyLockRecord(client, card))) {
      applyLevelUpgrade(db, client.phone, client, card, loyalty)
    }
    if (client.level !== beforeLevel) {
      changed = true
      if (card) syncClientFromCardRow(card)
    }
  }
  if (changed) persist()
}

function forgetDeletedPhone(phone) {
  ensureDeletedPhoneKeys()
  const key = normalizePhoneDigits(phone)
  if (!key) return
  const next = db.deletedPhoneKeys.filter(x => x !== key)
  if (next.length !== db.deletedPhoneKeys.length) {
    db.deletedPhoneKeys = next
    persist()
  }
  clearPersonalNotificationsOnServer(phone)
}

function isPhoneTombstoned(phone) {
  ensureDeletedPhoneKeys()
  const key = normalizePhoneDigits(phone)
  return !!key && db.deletedPhoneKeys.includes(key)
}

/**
 * БД — источник правды. Если для телефона есть АКТИВНАЯ запись клиента
 * (не recovery и не анонимизированная), значит клиент вернулся — снимаем метку
 * «удалён». Чинит рассинхрон «в базе есть, а в админке не видно».
 */
function reconcileDeletedPhonesWithClients() {
  ensureDeletedPhoneKeys()
  if (!db.deletedPhoneKeys.length) return
  const activeKeys = new Set()
  for (const c of db.clients || []) {
    if (!c || !c.phone) continue
    if (c.accountStatus === 'recovery') continue
    if (String(c.note || '').includes(PURGED_NOTE)) continue
    const key = normalizePhoneDigits(c.phone)
    if (key) activeKeys.add(key)
  }
  if (!activeKeys.size) return
  const before = db.deletedPhoneKeys.length
  db.deletedPhoneKeys = db.deletedPhoneKeys.filter(k => !activeKeys.has(k))
  if (db.deletedPhoneKeys.length !== before) persist()
}

function isClientRowVisible(c) {
  if (!c) return false
  if (isPhoneTombstoned(c.phone)) return false
  const note = String(c.note || '')
  if (note.includes(PURGED_NOTE)) return false
  if (c.name === 'Удалён' && /^\+0000000/.test(String(c.phone || ''))) return false
  return true
}

function listVisibleClients() {
  return (db.clients || []).filter(isClientRowVisible).map(c => normalizeClientRow({ ...c, id: c.id }))
}

const VIP_NOTE_MARKER = 'kakapo-vip'
const DEBT_NOTE_MARKER = 'kakapo-debt'

function vipFromNote(note) {
  return !!(note && String(note).includes(VIP_NOTE_MARKER))
}

function debtFromNote(note) {
  return !!(note && String(note).includes(DEBT_NOTE_MARKER))
}

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
    wallet: Math.max(0, Math.round((Number(raw.wallet) || 0) * 100) / 100),
    debtLimit: Number(raw.debtLimit) || 0,
    blocked: !!raw.blocked,
    vip: !!raw.vip || vipFromNote(raw.note),
    note: raw.note || '',
    createdAt: raw.createdAt,
    lastOrderAt: raw.lastOrderAt,
    loyaltyPeriod: raw.loyaltyPeriod,
    levelLockedPeriod: raw.levelLockedPeriod === null ? undefined : (raw.levelLockedPeriod || undefined),
    levelAssignMode: raw.levelAssignMode === 'manual' ? 'manual' : (raw.levelAssignMode === 'auto' ? 'auto' : undefined),
    levelValidUntil: raw.levelValidUntil === null ? undefined : (raw.levelValidUntil || undefined),
    vipUntil: raw.vipUntil === null ? undefined : (raw.vipUntil || undefined),
    bonusEligibleFrom: raw.bonusEligibleFrom || undefined,
    debtEnabled: (Number(raw.debt) || 0) > 0 || raw.debtEnabled === true || debtFromNote(raw.note),
    debtOverdueStrikes: Number(raw.debtOverdueStrikes) || 0,
    debtCreditBlocked: !!raw.debtCreditBlocked,
    debtLedger: Array.isArray(raw.debtLedger) ? raw.debtLedger : [],
    accountStatus: raw.accountStatus === 'recovery' ? 'recovery' : 'active',
    deletedAt: raw.deletedAt || undefined,
    recoveryExpiresAt: raw.recoveryExpiresAt || undefined,
    accountGeneration: defaultAccountGeneration(raw.accountGeneration),
    cart: raw.cart && typeof raw.cart === 'object' && !Array.isArray(raw.cart) ? raw.cart : {},
    cartMeta: raw.cartMeta && typeof raw.cartMeta === 'object' && !Array.isArray(raw.cartMeta) ? raw.cartMeta : {},
    cartUpdatedAt: raw.cartUpdatedAt || undefined,
    wished: raw.wished && typeof raw.wished === 'object' && !Array.isArray(raw.wished) ? raw.wished : {},
    wishedUpdatedAt: raw.wishedUpdatedAt || undefined,
    addresses: Array.isArray(raw.addresses) ? raw.addresses : [],
    addressesUpdatedAt: raw.addressesUpdatedAt || undefined,
  }
}

app.get('/clients', (_req, res) => {
  runAccountLifecycleMaintenance()
  reconcileDeletedPhonesWithClients()
  runLoyaltyMaintenance()
  runDebtMaintenanceAndNotify()
  res.json(listVisibleClients())
})
app.post('/clients', (req, res) => {
  if (!db.clients) db.clients = []
  runAccountLifecycleMaintenance()

  const phone = req.body?.phone || ''
  const digits = normalizePhoneDigits(phone)
  if (digits) {
    const existing = db.clients.find(c => normalizePhoneDigits(c.phone) === digits)
    if (existing) {
      if (existing.accountStatus === 'recovery' && !isRecoveryExpired(existing)) {
        return res.status(409).json({
          detail: `Аккаунт можно восстановить до ${existing.recoveryExpiresAt || recoveryExpiresAtIso(existing.deletedAt)}`,
        })
      }
      if (existing.accountStatus === 'active') {
        return res.status(409).json({ detail: 'Клиент с этим телефоном уже зарегистрирован' })
      }
    }
    forgetDeletedPhone(phone)
  }

  const loyalty = ensureLoyaltySettings(db)
  const nums = db.clients.map(c => parseInt(String(c.id).replace(/\D/g, ''), 10)).filter(n => !Number.isNaN(n))
  const n = (nums.length ? Math.max(...nums) : 0) + 1
  const welcomeBonus = Number(loyalty.welcomeBonus) || 0
  const generation = digits ? nextAccountGeneration(db, phone) : 1
  const row = normalizeClientRow({
    id: `U-${String(n).padStart(2, '0')}`,
    level: 'basic',
    orders: 0,
    spent: 0,
    debt: 0,
    bonus: welcomeBonus,
    debtLimit: 0,
    blocked: false,
    loyaltyPeriod: currentLoyaltyPeriod(),
    accountGeneration: generation,
    accountStatus: 'active',
    createdAt: new Date().toISOString().slice(0, 10),
    ...req.body,
    bonus: welcomeBonus,
    accountGeneration: generation,
    accountStatus: 'active',
    level: 'basic',
    orders: 0,
    spent: 0,
    vip: false,
  })
  db.clients.push(row)
  ensureCardRowForClient(row)
  clearPersonalNotificationsOnServer(row.phone)
  reconcileClientBonuses(db, row.phone, loyaltyHooks())
  persist()
  res.json(row)
})
app.patch('/clients/:id', (req, res) => {
  const c = (db.clients || []).find(x => x.id === req.params.id)
  if (!c) return res.status(404).json({ detail: 'Клиент не найден' })
  if (req.body && req.body.purge === true) {
    if (rejectDeleteWithDebt(res, [c])) return
    auditFromReq(db, req, {
      action: 'delete',
      entity: 'client',
      entityId: c.id,
      entityName: c.name || c.phone,
      summary: `Полное удаление клиента «${c.name || c.phone}»`,
      before: { name: c.name, phone: c.phone, debt: c.debt, card: c.card },
    })
    removeClientAndUnlinkCards(c)
    return res.json({ ok: true })
  }
  const beforeSnap = {
    name: c.name, phone: c.phone, vip: !!c.vip, level: c.level,
    debt: c.debt, bonus: c.bonus, debtEnabled: c.debtEnabled, blocked: c.blocked,
  }
  const { purge, allowBonusDecrease, ...patch } = req.body || {}
  // Долг НЕ присваиваем напрямую — проводим через единую логику (ledger + лимит + карта).
  const debtRequested = patch.debt != null ? Number(patch.debt) || 0 : null
  const debtNoteReq = patch.debtNote
  delete patch.debt
  delete patch.debtNote
  if (patch.debtEnabled === false && (Number(c.debt) || 0) > 0.001) {
    return res.status(409).json({ detail: 'Нельзя выключить раздел долга, пока есть непогашенный долг' })
  }
  if (patch.bonus != null && !allowBonusDecrease) {
    const next = Number(patch.bonus) || 0
    const prev = Number(c.bonus) || 0
    if (next < prev) delete patch.bonus
  }
  const bonusManuallySet = patch.bonus != null
  const vipChanged = patch.vip !== undefined && !!patch.vip !== !!c.vip
  const levelChanged = patch.level != null && patch.level !== c.level
  const loyaltyTouched = vipChanged || levelChanged
    || patch.levelAssignMode != null
    || patch.levelValidUntil !== undefined
    || patch.levelLockedPeriod !== undefined
  if (loyaltyTouched) {
    if (vipChanged || levelChanged) {
      patch.loyaltyPeriod = currentLoyaltyPeriod()
      patch.bonusEligibleFrom = new Date().toISOString()
    }
    if (levelChanged && !('levelAssignMode' in (req.body || {}))) {
      patch.levelLockedPeriod = patch.level === 'basic' ? undefined : currentLoyaltyPeriod()
      patch.levelAssignMode = 'manual'
    }
    if (vipChanged && patch.vip) {
      patch.vipUntil = patch.vipUntil || endOfLoyaltyPeriodIsoServer()
    }
    if (vipChanged && !patch.vip) patch.vipUntil = undefined
    if (c.card) {
      const linked = findCardByNum(c.card)
      if (linked) {
        if (patch.loyaltyPeriod) linked.loyaltyPeriod = patch.loyaltyPeriod
        if (patch.bonusEligibleFrom) linked.bonusEligibleFrom = patch.bonusEligibleFrom
        if (patch.level != null) linked.level = patch.level === 'basic' ? '' : patch.level
        if (patch.vip !== undefined) linked.vip = !!patch.vip
        if (patch.levelLockedPeriod !== undefined) linked.levelLockedPeriod = patch.levelLockedPeriod
        if (patch.levelAssignMode !== undefined) linked.levelAssignMode = patch.levelAssignMode
        if (patch.levelValidUntil !== undefined) linked.levelValidUntil = patch.levelValidUntil
        if (patch.vipUntil !== undefined) linked.vipUntil = patch.vipUntil
      }
    }
  }
  Object.assign(c, normalizeClientRow({ ...c, ...patch, id: c.id }))
  // Долг: единая логика — запись в ledger, проверка лимита, синхронизация карты.
  // В связке «карта+клиент» (saveCardLoyalty) карта обновляется первой, поэтому
  // здесь дельта будет 0 и второй записи в ledger не появится.
  if (debtRequested != null) {
    const prevDebt = Number(beforeSnap.debt) || 0
    if (Math.abs(debtRequested - prevDebt) > 0.001) {
      const linkedCard = c.card ? findCardByNum(c.card) : null
      try {
        const { notifications } = handleClientDebtDelta(db, c, linkedCard, prevDebt, debtRequested, {
          source: 'admin',
          desc: debtNoteReq || 'Изменение долга',
          enforceLimit: !isStaffRequest(req), // лимит только для приложения клиента
        })
        c.debt = debtRequested
        if (debtRequested > prevDebt) c.debtEnabled = true
        if (linkedCard) {
          linkedCard.debt = debtRequested
          if (debtRequested > prevDebt) linkedCard.debtEnabled = true
        }
        deliverDebtNotifications(notifications)
      } catch (e) {
        c.debt = prevDebt
        return res.status(e?.status || 400).json({ detail: e?.message || 'Не удалось изменить долг' })
      }
    } else {
      c.debt = debtRequested
    }
  }
  // Ручная смена бонуса: подогнать posCashBonus, иначе reconcile вернёт старую сумму
  if (bonusManuallySet && patch.bonus != null) {
    alignPosCashBonusToTarget(db, c.phone, Number(c.bonus) || 0, loyaltyHooks())
  }
  const afterSnap = {
    name: c.name, phone: c.phone, vip: !!c.vip, level: c.level,
    debt: c.debt, bonus: c.bonus, debtEnabled: c.debtEnabled, blocked: c.blocked,
  }
  const brief = diffBrief(beforeSnap, afterSnap, ['name', 'phone', 'vip', 'level', 'debt', 'bonus', 'debtEnabled', 'blocked'])
  if (brief) {
    auditFromReq(db, req, {
      action: 'update',
      entity: 'client',
      entityId: c.id,
      entityName: c.name || c.phone,
      summary: `Изменён клиент «${c.name || c.phone}» · ${brief}`,
      before: beforeSnap,
      after: afterSnap,
    })
  }
  persist()
  res.json(c)
})
function unlinkCardsForClient(client) {
  const clientCardKey = String(client.card || '').trim().toUpperCase()
  for (const card of db.cards || []) {
    if (card.status === 'unlinked') continue
    const sameClient = client.id && card.clientId === client.id
    const samePhone = card.phone && client.phone
      && normalizePhoneDigits(card.phone) === normalizePhoneDigits(client.phone)
    const sameCardNum = !!clientCardKey && String(card.num || '').trim().toUpperCase() === clientCardKey
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
  const today = new Date().toISOString().slice(0, 10)
  client.deletedAt = today
  client.recoveryExpiresAt = recoveryExpiresAtIso(today)
  persist()
}

function restoreClientRecord(client) {
  client.accountStatus = 'active'
  client.deletedAt = undefined
  client.recoveryExpiresAt = undefined
  client.blocked = false
  forgetDeletedPhone(client.phone)
  persist()
}

function removeClientAndUnlinkCards(client) {
  // Админское удаление: запоминаем телефон — магазин на телефоне сразу выйдет из сессии
  hardDeleteClientProfile(db, client, {
    unlinkCardsForClient,
    rememberDeleted: true,
    rememberDeletedPhone,
  })
  persist()
}

/** Полное удаление профиля (админ) — заказы сохраняются */
app.post('/clients/purge-account', (req, res) => {
  const phone = req.body?.phone || ''
  if (!normalizePhoneDigits(phone)) return res.status(400).json({ detail: 'Укажите телефон' })
  runAccountLifecycleMaintenance()
  const clients = (db.clients || []).filter(c => normalizePhoneDigits(c.phone) === normalizePhoneDigits(phone))
  if (rejectDeleteWithDebt(res, clients)) return
  const names = clients.map(c => c.name || c.phone).join(', ')
  const result = purgeClientProfilesForPhone(phone, { rememberDeleted: true })
  auditFromReq(db, req, {
    action: 'delete',
    entity: 'client',
    entityId: phone,
    entityName: names || phone,
    summary: `Удаление профиля по телефону ${phone}` + (result.clients ? ` · ${result.clients} зап.` : ''),
  })
  persist()
  res.json({ ok: true, ...result })
})

app.post('/clients/:id/recovery', (req, res) => {
  if (!db.clients) db.clients = []
  const client = db.clients.find(x => x.id === req.params.id)
  if (!client) return res.status(404).json({ detail: 'Клиент не найден' })
  if (rejectDeleteWithDebt(res, [client])) return
  auditFromReq(db, req, {
    action: 'delete',
    entity: 'client',
    entityId: client.id,
    entityName: client.name || client.phone,
    summary: `Клиент «${client.name || client.phone}» → корзина восстановления`,
  })
  moveClientToRecoveryRecord(client)
  res.json(client)
})
app.post('/clients/:id/restore', (req, res) => {
  if (!db.clients) db.clients = []
  runAccountLifecycleMaintenance()
  const client = db.clients.find(x => x.id === req.params.id)
  if (!client) return res.status(404).json({ detail: 'Клиент не найден' })
  if (isRecoveryExpired(client)) {
    hardDeleteClientProfile(db, client, { unlinkCardsForClient })
    persist()
    return res.status(410).json({ detail: 'Срок восстановления истёк — зарегистрируйтесь заново' })
  }
  restoreClientRecord(client)
  res.json(client)
})

app.post('/clients/recovery-by-phone', (req, res) => {
  if (!db.clients) db.clients = []
  const digits = normalizePhoneDigits(req.body?.phone || '')
  const client = db.clients.find(c => normalizePhoneDigits(c.phone) === digits)
  if (!client) return res.status(404).json({ detail: 'Клиент не найден' })
  if (rejectDeleteWithDebt(res, [client])) return
  moveClientToRecoveryRecord(client)
  res.json(client)
})

app.post('/clients/delete-by-phone', (req, res) => {
  const phone = req.body?.phone || ''
  if (!normalizePhoneDigits(phone)) return res.status(400).json({ detail: 'Укажите телефон' })
  runAccountLifecycleMaintenance()
  const clients = (db.clients || []).filter(c => normalizePhoneDigits(c.phone) === normalizePhoneDigits(phone))
  if (rejectDeleteWithDebt(res, clients)) return
  const names = clients.map(c => c.name || c.phone).join(', ')
  const result = purgeClientProfilesForPhone(phone, { rememberDeleted: true })
  auditFromReq(db, req, {
    action: 'delete',
    entity: 'client',
    entityId: phone,
    entityName: names || phone,
    summary: `Удаление клиента по телефону ${phone}`,
  })
  persist()
  res.json({ ok: true, ...result })
})

app.get('/clients/deleted-phones', (_req, res) => {
  ensureDeletedPhoneKeys()
  reconcileDeletedPhonesWithClients()
  res.json({ phones: [...db.deletedPhoneKeys] })
})

/**
 * Лёгкая проверка сессии магазина: жив ли аккаунт по телефону.
 * Телефон-клиент опрашивает это каждые несколько секунд после удаления в админке.
 */
app.get('/clients/session-check', (req, res) => {
  runAccountLifecycleMaintenance()
  reconcileDeletedPhonesWithClients()
  const phone = String(req.query?.phone || '')
  const key = normalizePhoneDigits(phone)
  if (!key) return res.json({ active: false, reason: 'empty' })

  if (isPhoneTombstoned(phone)) {
    return res.json({ active: false, reason: 'deleted' })
  }

  const client = (db.clients || []).find(c => normalizePhoneDigits(c.phone) === key)
  if (client) {
    if (client.accountStatus === 'recovery') {
      return res.json({ active: false, reason: 'recovery' })
    }
    const note = String(client.note || '')
    if (note.includes(PURGED_NOTE)) {
      return res.json({ active: false, reason: 'purged' })
    }
    return res.json({ active: true, reason: 'client', clientId: client.id })
  }

  const card = (db.cards || []).find(c =>
    c.status !== 'unlinked'
    && c.phone
    && normalizePhoneDigits(c.phone) === key,
  )
  if (card) {
    return res.json({ active: true, reason: 'card', cardNum: card.num })
  }

  return res.json({ active: false, reason: 'missing' })
})

/** Удалить всех демо-клиентов U-01…U-07 и запомнить их телефоны навсегда */
app.post('/clients/purge-demo', (_req, res) => {
  if (!db.clients) db.clients = []
  let removed = 0
  for (const demo of DEFAULT_CLIENTS) {
    rememberDeletedPhone(demo.phone)
    const client = db.clients.find(c => c.id === demo.id)
    if (client) {
      removeClientAndUnlinkCards(client)
      removed += 1
    }
  }
  persist()
  res.json({ ok: true, removed, phones: db.deletedPhoneKeys.length })
})

app.post('/clients/:id/delete', (req, res) => {
  if (!db.clients) db.clients = []
  const client = db.clients.find(x => x.id === req.params.id)
  if (!client) {
    const digits = normalizePhoneDigits(req.body?.phone || '')
    if (digits) rememberDeletedPhone(digits)
    return res.json({ ok: true })
  }
  if (rejectDeleteWithDebt(res, [client])) return
  auditFromReq(db, req, {
    action: 'delete',
    entity: 'client',
    entityId: client.id,
    entityName: client.name || client.phone,
    summary: `Удалён клиент «${client.name || client.phone}»`,
    before: { name: client.name, phone: client.phone, debt: client.debt },
  })
  removeClientAndUnlinkCards(client)
  res.json({ ok: true })
})

app.delete('/clients/by-phone/:phone', (req, res) => {
  if (!db.clients) db.clients = []
  const digits = normalizePhoneDigits(decodeURIComponent(req.params.phone))
  const client = db.clients.find(c => normalizePhoneDigits(c.phone) === digits)
  if (!client) return res.status(404).json({ detail: 'Клиент не найден' })
  if (rejectDeleteWithDebt(res, [client])) return
  auditFromReq(db, req, {
    action: 'delete',
    entity: 'client',
    entityId: client.id,
    entityName: client.name || client.phone,
    summary: `Удалён клиент «${client.name || client.phone}»`,
    before: { name: client.name, phone: client.phone },
  })
  removeClientAndUnlinkCards(client)
  res.json({ ok: true })
})

app.delete('/clients/:id', (req, res) => {
  if (!db.clients) db.clients = []
  const client = db.clients.find(x => x.id === req.params.id)
  if (!client) return res.status(404).json({ detail: 'Клиент не найден' })
  if (rejectDeleteWithDebt(res, [client])) return
  auditFromReq(db, req, {
    action: 'delete',
    entity: 'client',
    entityId: client.id,
    entityName: client.name || client.phone,
    summary: `Удалён клиент «${client.name || client.phone}»`,
    before: { name: client.name, phone: client.phone },
  })
  removeClientAndUnlinkCards(client)
  res.json({ ok: true })
})

app.get('/settings/pricing', (_req, res) => {
  db.settings.pricing = normalizePricing(db.settings.pricing || {})
  res.json(db.settings.pricing)
})
app.patch('/settings/pricing', (req, res) => {
  db.settings.pricing = normalizePricing({ ...db.settings.pricing, ...req.body })
  auditFromReq(db, req, {
    action: 'update',
    entity: 'settings',
    entityId: 'pricing',
    entityName: 'Тариф доставки',
    summary: 'Изменены настройки тарифа доставки',
  })
  persist()
  res.json(db.settings.pricing)
})
app.get('/settings/loyalty', (_req, res) => {
  res.json(ensureLoyaltySettings(db))
})
app.patch('/settings/loyalty', (req, res) => {
  const current = ensureLoyaltySettings(db)
  const body = req.body || {}
  db.settings.loyalty = {
    ...current,
    ...body,
    tierMinSpent: { ...current.tierMinSpent, ...body.tierMinSpent },
    vipRules: { ...current.vipRules, ...body.vipRules },
    cashDepositTiers: Array.isArray(body.cashDepositTiers) ? body.cashDepositTiers : current.cashDepositTiers,
    basic: { ...current.basic, ...body.basic },
    bronze: { ...current.bronze, ...body.bronze },
    silver: { ...current.silver, ...body.silver },
    gold: { ...current.gold, ...body.gold },
    platinum: { ...current.platinum, ...body.platinum },
    vip: { ...current.vip, ...body.vip },
  }
  syncCardDebtLimitsFromLoyalty(db, syncClientFromCardRow)
  auditFromReq(db, req, {
    action: 'update',
    entity: 'settings',
    entityId: 'loyalty',
    entityName: 'Лояльность',
    summary: 'Изменены настройки лояльности / VIP',
  })
  persist()
  res.json(db.settings.loyalty)
})

const DEFAULT_ADMIN_SETTINGS = {
  gbs: { enabled: false, ip: 'http://192.168.1.100', port: '8419', user: 'admin', pass: '' },
  sms: { provider: 'smspro', apiKey: '' },
  store: {
    name: 'КАКАПО',
    city: 'г. Яван, Таджикистан',
    address: 'ул. Ленина, 42',
    phone1: '+992 118 55-97-97',
    phone2: '+992 553 55-98-98',
    email: 'kakapo.tj@gmail.com',
    telegram: '@kakapo_tj',
    hours: '08:00 – 23:00',
  },
  auth: {
    login: 'admin',
    password: 'admin123',
  },
}

function applyAdminAuth({ login, password }) {
  const a = ensureAdminSettings()
  const nextLogin = String(login || 'admin').trim() || 'admin'
  const nextPass = String(password || '')
  a.auth = { login: nextLogin, password: nextPass }
  if (!Array.isArray(db.users)) db.users = []
  let admin = db.users.find(u => u.role === 'admin')
  if (!admin) {
    const maxId = db.users.reduce((m, u) => Math.max(m, Number(u.id) || 0), 0)
    admin = {
      id: maxId + 1,
      email: nextLogin.includes('@') ? nextLogin : `${nextLogin}@kakapo.tj`,
      login: nextLogin,
      password: nextPass,
      role: 'admin',
      name: 'Админ КАКАПО',
    }
    db.users.push(admin)
  } else {
    admin.login = nextLogin
    admin.password = nextPass
    admin.email = nextLogin.includes('@') ? nextLogin : `${nextLogin}@kakapo.tj`
    if (!admin.name) admin.name = 'Админ КАКАПО'
  }
  return a.auth
}

function ensureAdminAuth() {
  const a = ensureAdminSettings()
  if (!a.auth || typeof a.auth !== 'object') {
    a.auth = { ...DEFAULT_ADMIN_SETTINGS.auth }
  }
  if (!a.auth.login) a.auth.login = DEFAULT_ADMIN_SETTINGS.auth.login
  if (a.auth.password == null || a.auth.password === '') {
    a.auth.password = DEFAULT_ADMIN_SETTINGS.auth.password
  }

  if (!Array.isArray(db.users)) db.users = []
  const admin = db.users.find(u => u.role === 'admin')
  if (admin) {
    if (!admin.login) {
      const email = String(admin.email || '').toLowerCase()
      admin.login = email === 'admin@kakapo.tj' ? 'admin' : (String(admin.email || 'admin').trim() || 'admin')
    }
    // users — источник правды, если уже есть пароль
    if (admin.password != null && String(admin.password).length > 0) {
      a.auth.password = String(admin.password)
    }
    a.auth.login = String(admin.login).trim() || a.auth.login
  }
  return applyAdminAuth({ login: a.auth.login, password: a.auth.password })
}

function ensureAdminSettings() {
  if (!db.settings) db.settings = {}
  if (!db.settings.admin) {
    db.settings.admin = structuredClone(DEFAULT_ADMIN_SETTINGS)
  }
  const a = db.settings.admin
  if (!a.gbs) a.gbs = { ...DEFAULT_ADMIN_SETTINGS.gbs }
  if (!a.sms) a.sms = { ...DEFAULT_ADMIN_SETTINGS.sms }
  if (!a.store) a.store = { ...DEFAULT_ADMIN_SETTINGS.store }
  if (!a.auth) a.auth = { ...DEFAULT_ADMIN_SETTINGS.auth }
  return a
}

app.get('/settings/admin', (_req, res) => {
  ensureAdminAuth()
  const a = ensureAdminSettings()
  res.json({
    gbs: a.gbs,
    sms: a.sms,
    store: a.store,
    auth: { login: a.auth?.login || 'admin' },
  })
})

app.patch('/settings/admin', (req, res) => {
  const current = ensureAdminSettings()
  const body = req.body || {}
  db.settings.admin = {
    gbs: { ...current.gbs, ...body.gbs },
    sms: { ...current.sms, ...body.sms },
    store: { ...current.store, ...body.store },
    auth: current.auth || { ...DEFAULT_ADMIN_SETTINGS.auth },
  }
  // Смена логина/пароля только через /auth/admin (нужен текущий пароль)
  auditFromReq(db, req, {
    action: 'update',
    entity: 'settings',
    entityId: 'admin',
    entityName: 'Настройки админки',
    summary: 'Изменены настройки магазина / GBS / SMS',
  })
  persist()
  const a = db.settings.admin
  res.json({
    gbs: a.gbs,
    sms: a.sms,
    store: a.store,
    auth: { login: a.auth?.login || 'admin' },
  })
})
ensureAdminSettings()
ensureAdminAuth()

app.post('/loyalty/sync', (req, res) => {
  const phone = String(req.body?.phone || req.query?.phone || '').trim()
  if (!phone) return res.status(400).json({ detail: 'Укажите телефон' })
  backfillClientBonuses(db, phone, loyaltyHooks())
  const result = reconcileClientBonuses(db, phone, loyaltyHooks())
  persist()
  const client = findClientByPhone(db, phone)
  const card = client?.card ? findCardByNum(client.card) : null
  if (client) {
    broadcastLoyalty({ phone: client.phone, bonus: client.bonus, card: client.card || '' })
  }
  res.json({ ok: true, ...result, client, card })
})

function migrateLoyaltyRows() {
  let changed = false
  if (Array.isArray(db.cards)) {
    const next = db.cards.map(c => {
      const row = normalizeCardRow({ ...c, num: c.num })
      if (!row.levelAssignMode) {
        row.levelAssignMode = normalizeLevelAssignMode(row)
      }
      return row
    })
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
    const deduped = Array.from(byId.values()).map(c => {
      const row = normalizeClientRow({ ...c, id: c.id })
      if (!row.levelAssignMode) {
        row.levelAssignMode = normalizeLevelAssignMode(row)
      }
      return row
    })
    if (JSON.stringify(db.clients) !== JSON.stringify(deduped)) {
      db.clients = deduped
      changed = true
    }
  }
  if (changed) persist()
}

/**
 * Единый баланс «Бонусы»: раньше «деньги» жили в отдельном wallet. Теперь и
 * пополнения наличными, и бонусы — один баланс bonus. Переносим накопленный
 * wallet обратно в bonus (и в защищённый posCashBonus) один раз.
 */
function migrateWalletMerge() {
  if (!db.settings) db.settings = {}
  if (db.settings.walletMergeDone) return
  let changed = false
  for (const card of db.cards || []) {
    const w = Math.max(0, Number(card.wallet) || 0)
    if (w > 0) {
      card.bonus = Math.round(((Number(card.bonus) || 0) + w) * 100) / 100
      card.posCashBonus = Math.round(((Number(card.posCashBonus) || 0) + w) * 100) / 100
      card.wallet = 0
      try { syncClientFromCardRow(card) } catch { /* ignore */ }
      changed = true
    }
  }
  for (const client of db.clients || []) {
    const w = Math.max(0, Number(client.wallet) || 0)
    if (w > 0) {
      const hasCard = client.card
        && (db.cards || []).some(c => String(c.num).toUpperCase() === String(client.card).toUpperCase())
      if (!hasCard) {
        client.bonus = Math.round(((Number(client.bonus) || 0) + w) * 100) / 100
      }
      client.wallet = 0
      changed = true
    }
  }
  db.settings.walletMergeDone = true
  persist()
  if (changed) console.log('[wallet] миграция: кошелёк объединён с бонусами')
}

app.get('/cards', (_req, res) => {
  runLoyaltyMaintenance()
  const list = (db.cards || [])
    .filter(c => !c.phone || !isPhoneTombstoned(c.phone))
    .map(c => normalizeCardRow({ ...c, num: c.num }))
  res.json(list)
})

function currentLoyaltyPeriod(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function normalizeCardRow(raw) {
  const status = ['active', 'unlinked', 'blocked'].includes(raw.status) ? raw.status : 'unlinked'
  let level = ['basic', 'bronze', 'silver', 'gold', 'platinum'].includes(raw.level) ? raw.level : (raw.level || '')
  if (level === 'basic') level = ''
  return {
    num: String(raw.num || '').toUpperCase(),
    client: raw.client || '',
    phone: raw.phone || '',
    clientId: raw.clientId,
    status,
    level,
    bonus: Number(raw.bonus) || 0,
    wallet: Math.max(0, Math.round((Number(raw.wallet) || 0) * 100) / 100),
    posCashBonus: Math.max(0, Number(raw.posCashBonus) || 0),
    debtLimit: Number(raw.debtLimit) || 0,
    debt: Number(raw.debt) || 0,
    issued: raw.issued || new Date().toISOString().slice(0, 10),
    note: raw.note || '',
    vip: !!raw.vip || vipFromNote(raw.note),
    debtEnabled: (Number(raw.debt) || 0) > 0 || raw.debtEnabled === true || debtFromNote(raw.note),
    debtOverdueStrikes: Number(raw.debtOverdueStrikes) || 0,
    debtCreditBlocked: !!raw.debtCreditBlocked,
    debtLedger: Array.isArray(raw.debtLedger) ? raw.debtLedger : [],
    loyaltyPeriod: raw.loyaltyPeriod || undefined,
    levelLockedPeriod: raw.levelLockedPeriod === null ? undefined : (raw.levelLockedPeriod || undefined),
    levelAssignMode: raw.levelAssignMode === 'manual' ? 'manual' : (raw.levelAssignMode === 'auto' ? 'auto' : undefined),
    levelValidUntil: raw.levelValidUntil === null ? undefined : (raw.levelValidUntil || undefined),
    vipUntil: raw.vipUntil === null ? undefined : (raw.vipUntil || undefined),
    bonusEligibleFrom: raw.bonusEligibleFrom || undefined,
  }
}

migrateLoyaltyRows()
migrateWalletMerge()

function issueCardForNewClient(client) {
  if (!db.cards) db.cards = []
  const nums = db.cards.map(c => parseInt(String(c.num).replace(/\D/g, ''), 10)).filter(n => !Number.isNaN(n))
  const n = (nums.length ? Math.max(...nums) : 0) + 1
  const num = `КАКАПО-${String(n).padStart(4, '0')}`
  const issued = (client.createdAt || new Date().toISOString().slice(0, 10)).slice(0, 10)
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
    issued,
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
  const issued = (client.createdAt || new Date().toISOString().slice(0, 10)).slice(0, 10)
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
    issued,
  })
  db.cards.push(card)
  return card
}

function endOfLoyaltyPeriodIsoServer(period = currentLoyaltyPeriod()) {
  const [y, m] = period.split('-').map(Number)
  if (!y || !m) return new Date().toISOString()
  return new Date(y, m, 0, 23, 59, 59, 999).toISOString()
}

function cardLevelToBasic(raw) {
  return raw === '' || raw == null || raw === 'basic' ? 'basic' : raw
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
  client.level = cardLevelToBasic(card.level)
  client.bonus = Number(card.bonus) || 0
  client.wallet = Math.max(0, Math.round((Number(card.wallet) || 0) * 100) / 100)
  client.debt = Number(card.debt) || 0
  client.debtLimit = Number(card.debtLimit) || 0
  client.vip = !!card.vip
  client.blocked = card.status === 'blocked'
  client.debtEnabled = !!(card.debtEnabled || debtFromNote(card.note))
  if (card.loyaltyPeriod) client.loyaltyPeriod = card.loyaltyPeriod
  if (card.levelLockedPeriod) client.levelLockedPeriod = card.levelLockedPeriod
  else if (card.levelLockedPeriod === null || card.levelLockedPeriod === '') client.levelLockedPeriod = undefined
  if (card.levelAssignMode === 'manual' || card.levelAssignMode === 'auto') {
    client.levelAssignMode = card.levelAssignMode
  } else if (card.levelAssignMode === null) {
    client.levelAssignMode = undefined
  }
  if (card.levelValidUntil) client.levelValidUntil = card.levelValidUntil
  else if (card.levelValidUntil === null || card.levelValidUntil === '') client.levelValidUntil = undefined
  if (card.vipUntil) client.vipUntil = card.vipUntil
  else if (card.vipUntil === null || card.vipUntil === '') client.vipUntil = undefined
  if (card.bonusEligibleFrom) client.bonusEligibleFrom = card.bonusEligibleFrom
  syncDebtLedgerFromCard(card, client)
}

app.get('/debt/ledger', (req, res) => {
  runDebtMaintenanceAndNotify()
  const phone = String(req.query.phone || '').trim()
  if (!phone) return res.status(400).json({ detail: 'Укажите phone' })
  const client = (db.clients || []).find(c => normalizePhoneDigits(c.phone) === normalizePhoneDigits(phone))
  if (!client) return res.status(404).json({ detail: 'Клиент не найден' })
  res.json(buildDebtLedgerResponse(client))
})

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

function backfillOrderAccountIds() {
  let changed = false
  for (const order of db.orders || []) {
    if (order.clientAccountId) continue
    if (!order.accountGeneration) {
      order.accountGeneration = 1
      changed = true
    }
  }
  if (changed) persist()
}

function repairMisstampedOrders() {
  let changed = false
  for (const order of db.orders || []) {
    if (!order.clientAccountId) continue
    const client = (db.clients || []).find(c => c.id === order.clientAccountId)
    if (!client?.createdAt) continue
    const raw = order.deliveredAtIso || order.createdAtIso || order.createdAt || ''
    const orderDay = String(raw).slice(0, 10)
    if (!orderDay || orderDay.length < 10 || orderDay >= client.createdAt) continue
    const prevGen = Math.max(1, defaultAccountGeneration(client.accountGeneration) - 1)
    order.clientAccountId = undefined
    order.accountGeneration = prevGen
    changed = true
  }
  if (changed) persist()
}

function runLoyaltyBackfill() {
  try {
    runAccountLifecycleMaintenance()
    repairMisstampedOrders()
    backfillOrderAccountIds()
    const r = backfillAllMissedBonuses(db, loyaltyHooks())
    const rec = reconcileAllClientBonuses(db, loyaltyHooks())
    if (r.totalOrders > 0 || rec.adjusted > 0) persist()
  } catch (e) {
    console.error('[loyalty] backfill failed', e)
  }
}

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
    const vipChanged = patch.vip !== undefined && !!patch.vip !== !!card.vip
    const levelChanged = patch.level != null && patch.level !== card.level
    if (vipChanged || levelChanged) {
      patch.loyaltyPeriod = currentLoyaltyPeriod()
      patch.bonusEligibleFrom = new Date().toISOString()
    }
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
  const beforeSnap = {
    client: card.client, phone: card.phone, debt: card.debt, bonus: card.bonus,
    level: card.level, vip: !!card.vip, status: card.status, debtEnabled: card.debtEnabled,
  }
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
    auditFromReq(db, req, {
      action: 'update',
      entity: 'card',
      entityId: num,
      entityName: beforeSnap.client || num,
      summary: `Отвязана карта ${num}` + (beforeSnap.client ? ` · ${beforeSnap.client}` : ''),
      before: beforeSnap,
      after: { status: 'unlinked' },
    })
  } else {
    const body = { ...req.body }
    const allowDecrease = body.allowBonusDecrease === true
    delete body.allowBonusDecrease
    const prevDebt = Number(card.debt) || 0
    const enforceDebtLimit = !isStaffRequest(req) // лимит только для приложения клиента
    if (body.debt != null && enforceDebtLimit) {
      const nextDebt = Number(body.debt) || 0
      if (nextDebt > prevDebt + 0.001) {
        const linkedClient = (db.clients || []).find(c =>
          c.card === num
          || (card.phone && normalizePhoneDigits(c.phone) === normalizePhoneDigits(card.phone)),
        )
        const gate = canTakeNewDebt(linkedClient || card, card, nextDebt - prevDebt)
        if (!gate.ok) return res.status(gate.blocked ? 403 : 400).json({ detail: gate.reason })
      }
    }
    if (body.debtEnabled === false && (Number(card.debt) || 0) > 0.001) {
      return res.status(409).json({ detail: 'Нельзя выключить раздел долга, пока есть непогашенный долг' })
    }
    if (body.bonus != null && !allowDecrease) {
      const next = Number(body.bonus) || 0
      const prev = Number(card.bonus) || 0
      if (next < prev) delete body.bonus
    }
    const bonusManuallySet = body.bonus != null
    const vipChanged = body.vip !== undefined && !!body.vip !== !!card.vip
    const levelChanged = body.level != null && body.level !== card.level
    if (body.vip !== undefined || body.level != null || body.levelAssignMode != null) {
      if (vipChanged || levelChanged) {
        body.loyaltyPeriod = currentLoyaltyPeriod()
        body.bonusEligibleFrom = new Date().toISOString()
      }
      if (body.level != null && body.level !== card.level && !('levelAssignMode' in (req.body || {}))) {
        body.levelLockedPeriod = body.level === 'basic' ? undefined : currentLoyaltyPeriod()
        body.levelAssignMode = 'manual'
      }
      if (body.vip === true && body.vipUntil === undefined && !('vipUntil' in req.body)) {
        body.vipUntil = endOfLoyaltyPeriodIsoServer()
      }
      if (body.vip === true && req.body.vipUntil === null) {
        body.vipUntil = undefined
      }
      if (body.vip === false) body.vipUntil = undefined
    }
    Object.assign(card, normalizeCardRow({ ...card, ...body, num }))
    // ВАЖНО: сначала обрабатываем дельту долга, пока client.debt ещё равен prevDebt.
    // Если синхронизировать client.debt из карты ДО handleClientDebtDelta, то
    // внутренняя проверка лимита (canTakeNewDebt) увидит уже увеличенный долг и
    // прибавит дельту повторно (двойной учёт) — операция ошибочно отклонится,
    // сервер откатит долг, и он не попадёт в профиль клиента.
    if (body.debt != null) {
      const linkedClient = (db.clients || []).find(c =>
        c.card === num
        || (card.phone && normalizePhoneDigits(c.phone) === normalizePhoneDigits(card.phone)),
      )
      if (linkedClient) {
        try {
          const { notifications } = handleClientDebtDelta(db, linkedClient, card, prevDebt, Number(card.debt) || 0, {
            source: 'admin',
            desc: body.debtNote || 'Изменение долга',
            enforceLimit: enforceDebtLimit,
          })
          deliverDebtNotifications(notifications)
        } catch (e) {
          card.debt = prevDebt
          linkedClient.debt = prevDebt
          syncClientFromCardRow(card)
          return res.status(e?.status || 400).json({ detail: e?.message || 'Не удалось изменить долг' })
        }
      }
    }
    syncClientFromCardRow(card)
    // Ручная смена бонуса: подогнать posCashBonus, иначе reconcile вернёт старую сумму
    if (bonusManuallySet && body.bonus != null && card.phone) {
      alignPosCashBonusToTarget(db, card.phone, Number(card.bonus) || 0, loyaltyHooks())
    }
    const afterSnap = {
      client: card.client, phone: card.phone, debt: card.debt, bonus: card.bonus,
      level: card.level, vip: !!card.vip, status: card.status, debtEnabled: card.debtEnabled,
    }
    const brief = diffBrief(beforeSnap, afterSnap, ['client', 'phone', 'debt', 'bonus', 'level', 'vip', 'status', 'debtEnabled'])
    const debtDelta = (Number(card.debt) || 0) - prevDebt
    if (brief || Math.abs(debtDelta) > 0.001) {
      auditFromReq(db, req, {
        action: 'update',
        entity: Math.abs(debtDelta) > 0.001 ? 'debt' : 'card',
        entityId: num,
        entityName: card.client || num,
        summary: Math.abs(debtDelta) > 0.001
          ? `Долг карты ${num}: ${prevDebt} → ${card.debt}` + (body.debtNote ? ` · ${body.debtNote}` : '')
          : `Изменена карта ${num}` + (brief ? ` · ${brief}` : ''),
        before: beforeSnap,
        after: afterSnap,
      })
    }
  }
  persist()
  res.json(card)
})

/** Наличное пополнение баланса клиента одновременно увеличивает остаток открытой кассы. */
/** Бонус ⭐ за наличное пополнение кошелька — по порогам из настроек лояльности. */
function calcCashDepositBonusServer(cash, loyalty) {
  const amt = Math.max(0, Number(cash) || 0)
  if (amt <= 0) return 0
  const tiers = (loyalty?.cashDepositTiers || [])
    .slice()
    .sort((a, b) => (Number(b.minAmount) || 0) - (Number(a.minAmount) || 0))
  const tier = tiers.find(t => amt >= (Number(t.minAmount) || 0))
  const pct = tier ? Number(tier.bonusPercent) || 0 : 0
  return Math.round((amt * pct) / 100 * 100) / 100
}

app.post('/cards/:num/cash-topup', (req, res) => {
  try {
    const num = decodeURIComponent(req.params.num).toUpperCase()
    const card = findCardByNum(num)
    if (!card) return res.status(404).json({ detail: 'Карта не найдена' })
    // cash — внесённые деньги (идут в Кошелёк). credit оставлен для обратной совместимости.
    const cash = Math.round((Number(req.body?.cash) || 0) * 100) / 100
    if (!(cash > 0)) {
      return res.status(400).json({ detail: 'Укажите сумму пополнения' })
    }
    const loyalty = ensureLoyaltySettings(db)
    const bonusEarned = calcCashDepositBonusServer(cash, loyalty)

    const move = createFinanceMove(db, {
      type: 'deposit',
      amount: cash,
      note: String(req.body?.note || `Пополнение бонусов · ${card.client || card.phone || card.num}`),
      reason: 'Пополнение бонусов клиента',
      createdBy: req.body?.cashierName,
      cashierId: req.body?.cashierId,
      cashierName: req.body?.cashierName,
      shiftId: req.body?.shiftId,
      posId: req.body?.posId,
    })

    // Единый баланс «Бонусы»: и внесённые деньги, и бонус за пополнение идут в bonus.
    // posCashBonus защищает эту сумму при пересчёте лояльности (bonus = welcome + earned − spent + posCashBonus).
    const addToBonus = Math.round((cash + bonusEarned) * 100) / 100
    card.posCashBonus = Math.round((Math.max(0, Number(card.posCashBonus) || 0) + addToBonus) * 100) / 100
    card.bonus = Math.round((Math.max(0, Number(card.bonus) || 0) + addToBonus) * 100) / 100
    card.wallet = 0
    syncClientFromCardRow(card)
    auditFromReq(db, req, {
      app: 'trade',
      action: 'update',
      entity: 'card',
      entityId: num,
      entityName: card.client || num,
      summary: `Пополнение бонусов ${num} · +${addToBonus}⭐`
        + (bonusEarned > 0 ? ` (деньги +${cash} + бонус +${bonusEarned})` : ` (деньги +${cash})`)
        + ` · касса +${cash}`,
      after: { cash, bonusEarned, addToBonus, bonus: card.bonus },
    })
    persist()
    broadcastPosUpdate({ kind: 'client-cash-topup', id: move.id })
    res.json({ card, financeMove: move, bonusEarned, addToBonus })
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось пополнить бонусы' })
  }
})

app.get('/reviews', (req, res) => {
  let list = db.reviews || []
  if (req.query.restId) {
    const rid = String(req.query.restId)
    list = list.filter(r => String(r.restId || '') === rid)
  }
  if (req.query.productId) {
    const pid = String(req.query.productId)
    list = list.filter(r =>
      String(r.productId ?? '') === pid
      || String(r.productKey ?? '') === `p${pid}`,
    )
  }
  res.json(list)
})
app.post('/reviews', (req, res) => {
  ensureReviews()
  if (!Array.isArray(db.restaurants)) db.reaurants = []
  const restId = String(req.body.restId || 'STORE')
  const orderId = req.body.orderId ? String(req.body.orderId) : ''
  if (!orderId) return res.status(400).json({ detail: 'Укажите номер заказа' })
  const dup = (db.reviews || []).find(
    r => r.orderId === orderId && String(r.restId || '') === restId,
  )
  if (dup) return res.status(400).json({ detail: 'Отзыв по этому заказу уже оставлен' })
  try {
    const review = createReviewRecord(db, req.body)
    persist()
    broadcastReview(review)
    res.json(review)
  } catch (e) {
    console.error('[reviews] create failed', e)
    res.status(500).json({ detail: 'Не удалось сохранить отзыв. Подождите 5–15 сек и попробуйте снова.' })
  }
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
app.delete('/reviews/:id', (req, res) => {
  ensureReviews()
  const result = deleteReviewRecords(db, [req.params.id])
  if (!result.deleted) return res.status(404).json({ detail: 'Отзыв не найден' })
  persist()
  res.json({ ok: true, deleted: result.deleted })
})
app.post('/reviews/bulk-delete', (req, res) => {
  ensureReviews()
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : []
  if (!ids.length) return res.status(400).json({ detail: 'Укажите id отзывов' })
  const result = deleteReviewRecords(db, ids)
  if (!result.deleted) return res.status(404).json({ detail: 'Отзывы не найдены' })
  persist()
  res.json({ ok: true, deleted: result.deleted })
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
  list = list.filter(n => n.broadcast === true || (n.targetPhone && n.targetPhone === key))
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
    kind: item.kind,
    action: item.action,
    orderId: item.orderId,
    reviewId: item.reviewId,
    broadcast: item.broadcast === true,
    targetPhone: item.broadcast ? undefined : (item.targetPhone ? phoneKey(item.targetPhone) : undefined),
    sentAt: item.sentAt || new Date().toISOString(),
  })).filter(n => n.title && n.body && !(db.notifications || []).some(x => x.id === n.id))

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
    if (inferType(o) === 'market') return s + bonusEligibleTotal(o)
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

app.get('/finance/pos-summary', (_req, res) => {
  res.json(getPosFinanceSummary(db))
})

app.get('/reports/pos', (_req, res) => {
  res.json(getPosReport(db))
})

app.get('/audit', (req, res) => {
  const removed = pruneAuditLog(db)
  if (removed > 0) persist()
  res.json(listAuditLog(db, req.query || {}))
})

/** Какие типы записей можно восстановить (только изменения). */
const AUDIT_RESTORABLE = new Set(['product', 'client', 'card', 'debt', 'employee'])

function pickDefined(obj, keys) {
  const out = {}
  if (!obj || typeof obj !== 'object') return out
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k]
  return out
}

/** Восстановить прежнее состояние объекта из записи истории (только action=update). */
app.post('/audit/:id/restore', (req, res) => {
  ensureAuditLog(db)
  const entry = (db.auditLog || []).find(e => e.id === req.params.id)
  if (!entry) return res.status(404).json({ detail: 'Запись истории не найдена' })
  if (entry.action !== 'update') {
    return res.status(400).json({ detail: 'Восстановление доступно только для изменений' })
  }
  if (!AUDIT_RESTORABLE.has(entry.entity)) {
    return res.status(400).json({ detail: 'Этот тип записи нельзя восстановить' })
  }
  const before = entry.before
  if (!before || typeof before !== 'object' || Object.keys(before).length === 0) {
    return res.status(400).json({ detail: 'В записи нет прежних данных для восстановления' })
  }

  const logRestore = (entity, summary) => {
    auditFromReq(db, req, {
      action: 'update',
      entity,
      entityId: entry.entityId,
      entityName: entry.entityName,
      summary: `↩ Восстановлено из истории · ${summary}`,
      before: entry.after,
      after: entry.before,
    })
  }

  try {
    if (entry.entity === 'product') {
      const p = db.products.find(x => String(x.id) === String(entry.entityId))
      if (!p) return res.status(404).json({ detail: 'Товар не найден' })
      Object.assign(p, pickDefined(before, ['name', 'price', 'stock', 'costPrice', 'cat']))
      logRestore('product', `товар «${p.name}»`)
      persist()
      broadcastProduct(p)
      return res.json({ ok: true, entity: 'product', row: p })
    }

    if (entry.entity === 'client') {
      const c = (db.clients || []).find(x => String(x.id) === String(entry.entityId))
      if (!c) return res.status(404).json({ detail: 'Клиент не найден' })
      const patch = pickDefined(before, ['name', 'phone', 'vip', 'level', 'debt', 'bonus', 'debtEnabled', 'blocked'])
      Object.assign(c, normalizeClientRow({ ...c, ...patch, id: c.id }))
      if (c.card) {
        const linked = findCardByNum(c.card)
        if (linked) {
          if (patch.level != null) linked.level = c.level === 'basic' ? '' : c.level
          if (patch.vip !== undefined) linked.vip = !!c.vip
          if (patch.debt != null) linked.debt = Number(c.debt) || 0
          if (patch.bonus != null) linked.bonus = Number(c.bonus) || 0
        }
      }
      logRestore('client', `клиент «${c.name || c.phone}»`)
      persist()
      return res.json({ ok: true, entity: 'client', row: c })
    }

    if (entry.entity === 'card' || entry.entity === 'debt') {
      const num = String(entry.entityId || '').toUpperCase()
      const card = findCardByNum(num)
      if (!card) return res.status(404).json({ detail: 'Карта не найдена' })
      const patch = pickDefined(before, ['client', 'phone', 'debt', 'bonus', 'level', 'vip', 'status', 'debtEnabled'])
      Object.assign(card, normalizeCardRow({ ...card, ...patch, num }))
      syncClientFromCardRow(card)
      logRestore(entry.entity, `карта ${num}`)
      persist()
      return res.json({ ok: true, entity: entry.entity, row: card })
    }

    if (entry.entity === 'employee') {
      const row = updateEmployee(db, entry.entityId, pickDefined(before, ['name', 'role', 'active']))
      logRestore('employee', `сотрудник «${row.name}»`)
      persist()
      return res.json({ ok: true, entity: 'employee', row })
    }

    return res.status(400).json({ detail: 'Этот тип записи нельзя восстановить' })
  } catch (e) {
    return res.status(400).json({ detail: e?.message || 'Не удалось восстановить' })
  }
})

app.get('/admin/dashboard', (_req, res) => {

  res.json({
    ordersToday: db.orders.length,
    revenueToday: db.orders.reduce((s, o) => s + bonusEligibleTotal(o), 0),
    activeCouriers: 2,
    activeRestaurants: db.restaurants.length,
  })
})

/** ИИ-ассистент только для админки */
app.get('/admin/ai/status', (_req, res) => {
  res.json(getAdminAiStatus())
})
app.post('/admin/ai/ask', async (req, res) => {
  try {
    const result = await askAdminAi(db, {
      prompt: req.body?.prompt,
      quickId: req.body?.quickId,
    })
    res.json(result)
  } catch (e) {
    res.status(e?.status || 400).json({ detail: e?.message || 'Не удалось получить ответ ИИ' })
  }
})

app.post('/sync/woocommerce', (_req, res) => res.json({ ok: true, synced: 0 }))
app.post('/sync/gbs', (_req, res) => res.json({ ok: true, synced: 0 }))

app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err)
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ detail: 'Некорректный JSON' })
  }
  console.error('[api] unhandled', err)
  res.status(500).json({ detail: 'Внутренняя ошибка сервера' })
})

const httpServer = createServer(app)
const wss = new WebSocketServer({ noServer: true })
const WS_HEARTBEAT_MS = 30_000

const wsHeartbeat = setInterval(() => {
  for (const ws of clients) {
    if (ws.readyState !== 1) {
      clients.delete(ws)
      continue
    }
    ws.ping()
  }
}, WS_HEARTBEAT_MS)
wsHeartbeat.unref()

function shutdown(signal) {
  console.error(`[shutdown] ${signal}`)
  flushDb()
  httpServer.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 5000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
  flushDb()
})

httpServer.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/ws/')) {
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const { role, phone } = parseWsMeta(req.url)
    ws.wsRole = role
    ws.clientPhone = phone
    clients.add(ws)
    ws.on('message', (data) => { if (String(data) === 'ping') ws.send('pong') })
    ws.on('close', () => clients.delete(ws))
  })
})

httpServer.listen(PORT, '0.0.0.0', () => {
  const stats = getDbStats()
  console.log(`\n✅ КАКАПО Backend: http://0.0.0.0:${PORT}`)
  console.log(`   База: ${stats.path}`)
  console.log(`   DATA_DIR: ${stats.dataDir} | persistent: ${stats.persistent ? 'yes' : 'NO'}`)
  console.log(`   Записей: клиентов ${stats.clients}, заказов ${stats.orders}, карт ${stats.cards}`)
  if (process.env.NODE_ENV === 'production' && !stats.persistent) {
    console.error('\n⚠️  ВНИМАНИЕ: DATA_DIR не на постоянном диске — база может обнуляться при деплое!')
    console.error('   Hetzner/Docker: volume kakapo-data → /data (DATA_DIR=/data)\n')
  }
  console.log(`   Health: http://0.0.0.0:${PORT}/health`)
  const geminiKey = getGeminiApiKey()
  console.log(`   Gemini ИИ: ${geminiKey ? `готов (${getGeminiModel()})` : 'нет GEMINI_API_KEY в .env / переменных окружения'}\n`)
  runDebtMaintenanceAndNotify()
  const debtTimer = setInterval(runDebtMaintenanceAndNotify, 60 * 60 * 1000)
  debtTimer.unref()
  const auditTimer = setInterval(() => {
    const removed = pruneAuditLog(db)
    if (removed > 0) {
      persist()
      console.log(`[audit] автоочистка: удалено ${removed} записей старше ${AUDIT_RETENTION_DAYS} дн.`)
    }
  }, 6 * 60 * 60 * 1000)
  auditTimer.unref()
  setImmediate(() => runLoyaltyBackfill())
})
