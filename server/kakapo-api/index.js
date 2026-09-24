import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import {
  loadDb,
  scheduleSaveDb,
  flushDb,
  flushDbAsync,
  shutdownDb,
  initDb,
  getDbStats,
  DATA_DIR,
  queueDocDelete,
  rowIdForItem,
} from './db.js'
import { takeClientRef, makeIdempotency } from './offlineIdempotency.js'
import { installDurableHttpResponse, markResponseEphemeral } from './durableHttpResponse.js'
import {
  useDurableMasterCreate,
  masterCreateFingerprint,
  runDurableMasterCreate,
  finishDurableMasterJson,
  respondMasterTxError,
  replyMasterCreateReplayOrConflict,
} from './masterDataCreateTx.js'
import {
  fingerprintProductCreate,
  mutateCreateProduct,
  fingerprintSupplierCreate,
  mutateCreateSupplier,
  fingerprintCategoryCreate,
  mutateCreateCategory,
  fingerprintEmployeeCreate,
  mutateCreateEmployee,
  fingerprintPromoCreate,
  mutateCreatePromo,
  fingerprintProductDelete,
  mutateDeleteProduct,
} from './masterDataCreateMutations.js'
import {
  FIN_OP_KINDS,
  CRM_OP_KINDS,
  WH_OP_KINDS,
  stockProductAdvisoryLocks,
  orderResourceAdvisoryLocks,
  touchedFromWarehouse,
} from './pg/businessMutationTx.js'
import {
  buildOrderStatusFingerprint,
  mutateOrderStatusUpdate,
} from './orderStatusDurable.js'
import { isPostgresEnabled, withClient } from './pg/client.js'
import {
  mutateCreateClient,
  mutateCreateOrder,
  mutateCreatePosPoint,
  mutateBindDevice,
  mutateEnsureCard,
  fingerprintClientCreate,
  fingerprintOrderCreate,
  fingerprintPosPointCreate,
  fingerprintDeviceBind,
  fingerprintCardEnsure,
  buildO6Fingerprint,
} from './o6OperationalMutations.js'
import {
  handleO8CashTopup,
  handleO8SupplierBookPayment,
  handleO8StockReceiptCreate,
  handleO8StockReceiptUpdate,
  handleO8StockReceiptDelete,
  handleO8WriteoffCreate,
  handleO8WriteoffUpdate,
  handleO8WriteoffDelete,
  handleO8SupplierPaymentDelete,
  handleO8ExpenseCreate,
  handleO8ExpenseDelete,
  handleO8ShiftOpen,
  handleO8ShiftClose,
  handleO8FinanceMoveCreate,
  handleO8FinanceMoveDelete,
  handleO8VaultCardToCash,
  handleO8VaultCashToCard,
  handleO8SaleReturn,
  handleO8PosSaleCreate,
  handleO8StockAdjustment,
  handleO8ClientDebtAdjustment,
  handleO8CardBonusAdjustment,
  handleO8CashAdvance,
  handleO8DebtRepay,
  handleO8CardUnlink,
  handleO8ClientCardLink,
} from './onlineO8Handlers.js'
import { registerO8TestRoutes } from './o8TestRoutes.js'
import {
  createSession,
  createAuthMiddleware,
  assertSafeAuthEnvOrThrow,
  isProductionRuntime,
  authSubjectKey,
  revokeSession,
  parseBearer,
  resolveWsAuth,
  isWsStaffRole,
  isLabAutoAuthEnabled,
  isLoopbackReq,
  extractWsToken,
  capsFromTradePermissions,
} from './apiAuth.js'
import {
  matchRoutePolicy,
  countMountedTestRoutes,
  routeCoverageStats,
} from './routeAccessInventory.js'
import {
  buildDebtOpFingerprint,
  checkIdempotencyReplay,
  requireClientRef,
  fingerprintFromMoneyLedgerDebtRepay,
  fingerprintFromMoneyLedgerCashAdvance,
  fingerprintFromPosSale,
  debtOpRefDocId,
  IDEMPOTENCY_KEY_REUSED,
  CLIENT_REF_REQUIRED,
  resolveDebtOpIdempotency,
  classifyDebtOpClientRef,
  isAckLostCompatibleReplay,
} from './debtOpIdempotency.js'
import { buildSyncChanges } from './syncChanges.js'
import { recordSyncDelete } from './syncDeletes.js'
import { mkdirSync } from 'fs'
import { join } from 'path'
import {
  ensureUploadDirs,
  processAndSaveProductPhoto,
  deleteManagedProductPhoto,
  stripHeavyPhotoFields,
  migrateProductPhotos,
  convertStoredProductPhoto,
  productPhotoNeedsConvert,
  UPLOAD_ROOT,
} from './productPhotoPipeline.js'
import {
  processAndSaveRestaurantPhoto,
  deleteManagedRestaurantPhoto,
} from './restaurantPhotoPipeline.js'
import multer from 'multer'
import { seedIfEmpty, nextOrderId, DEFAULT_PROMOS, COURIERS, ASSEMBLERS, DEFAULT_CLIENTS, DEFAULT_CARDS } from './seed.js'
import { ensureMarketCategories, replaceCategoriesFromSeed } from './marketCategoriesSeed.js'
import { backupDatabaseFile, resetOperationalData } from './resetOperational.js'
import {
  applyStatusPatch,
  inferType,
  isAssemblerOrder,
  isCourierMapSync,
  marketItems,
} from './ordersLogic.js'
import {
  releaseOrderStock,
  reserveOrderStock,
  syncOrderStockReserve,
} from './orderStock.js'
import { creditDeliveredOrder, processPayout, getPendingBalance } from './restaurantStats.js'
import { lockOrderDeliveryFee, normalizePricing } from './deliveryFee.js'
import {
  applyBonusSpendOnOrder,
  creditClientBonusOnDelivery,
  applyClientLoyaltyAfterDelivery,
  completePosSaleOnlineLoyalty,
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
import { allocateProductCodes, allocateProductBarcodes, nextFreeProductCode, nextFreeEan13 } from './productCodes.js'
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
  createPosPairCode,
  bindPosDevice,
  unbindPosDevice,
  renamePosDevice,
  updatePosDevice,
  setRevisionCoordinator,
  checkPosDevice,
  listPosShifts,
  openPosShift,
  closePosShift,
  getCashVault,
  convertVaultCardToCash,
  convertVaultCashToCard,
  listSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  createSupplierPayment,
  listSupplierPayments,
  deleteSupplierPayment,
  listExpenses,
  createExpense,
  deleteExpense,
  listFinanceMoves,
  createFinanceMove,
  applyDebtRepayToShift,
  applyCashAdvanceToShift,
  createCashAdvance,
  deleteFinanceMove,
  isCardTopupFinanceMove,
  listStockReceipts,
  createStockReceipt,
  updateStockReceipt,
  deleteStockReceipt,
  listProductStockLayers,
  listAllOpenStockLayers,
  addProductStockLayer,
  updateProductStockLayer,
  deleteProductStockLayer,
  sumProductLayers,
  setProductStockExact,
  reconcileAllProductStock,
  listStockWriteoffs,
  createStockWriteoff,
  updateStockWriteoff,
  deleteStockWriteoff,
  createStockAdjustment,
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
import * as revisionCoordinator from './revisionCoordinator.js'
import {
  getCashBook,
  getExpectedVsActual,
  getProfitReport,
  getFinanceAlerts,
  getFinanceTruthBundle,
  getCashBoxSnapshot,
  listMoneyLedger,
} from './financeTruth.js'
import {
  listEmployees,
  listEmployeesDirectory,
  listEmployeesLocalAuth,
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
import { createOtpChallenge, verifyOtpChallenge } from './otpChallenges.js'
import { rateLimitCheck, rateLimitReset, clientIp } from './authRateLimit.js'
import {
  verifyAndMaybeMigrateCredential,
  applyPasswordMigration,
  setPasswordOnRow,
} from './passwordHash.js'
import {
  buildDebtLedgerResponse,
  canTakeNewDebt,
  handleClientDebtDelta,
  applyDebtRepayment,
  resolveDebtRepaymentTarget,
  runDebtMaintenance,
  syncDebtLedgerFromCard,
  syncDebtLedgerToCard,
} from './debtLedger.js'
import {
  unlinkNonCanonicalSiblingCards,
  assertCardAssignableToClient,
  assertDebtCardUnlinkAllowed,
  CardOwnershipConflict,
  bindCardToClient,
} from './cardCanonical.js'
import { buildEnsureExistingCardPatch, buildEnsureNewCardRow } from './crmEnsureCard.js'
import {
  ensureAuditLog,
  pruneAuditLog,
  auditFromReq,
  listAuditLog,
  diffBrief,
  AUDIT_RETENTION_DAYS,
} from './auditLog.js'
import { ymdBusiness } from './kakapoTime.js'
import { getGeminiApiKey, getGeminiModel, loadLocalEnv } from './loadEnv.js'

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

function o6ClientDeps() {
  return {
    normalizeClientRow,
    ensureCardRowForClient,
    runAccountLifecycleMaintenance,
    forgetDeletedPhone,
    reconcileClientBonuses: (dbRef, phone) => reconcileClientBonuses(dbRef, phone, loyaltyHooks()),
    ensureLoyaltySettings,
    nextAccountGeneration,
    isRecoveryExpired,
    recoveryExpiresAtIso,
    loyaltyHooks,
    clearPersonalNotificationsOnServer,
  }
}

function o6OrderDeps() {
  return {
    nowTime,
    loyaltyHooks,
    findClientByPhone,
    stampOrderForClient,
    consumePromoStockOnOrder,
    applyBonusSpendOnOrder,
  }
}

function o6OrderStatusHooks() {
  return {
    loyaltyHooks,
    findClientByPhone,
    nowTime,
  }
}

function afterOrderStatusCommitted(db, fx, updated) {
  const { prev, stockTouchedIds = [], commissionResult, bonusChanged, phone } = fx || {}
  if (bonusChanged && phone) {
    const client = findClientByPhone(db, phone)
    if (client) {
      broadcastLoyalty({
        phone: client.phone,
        bonus: client.bonus,
        card: client.card || '',
      })
    }
  }
  for (const pid of stockTouchedIds) {
    const p = db.products.find(x => Number(x.id) === Number(pid))
    if (p) broadcastProduct(p)
  }
  if (stockTouchedIds.length) {
    broadcastPosUpdate({ reason: 'order-stock', productIds: stockTouchedIds })
  }
  if (commissionResult?.courierId && Number(commissionResult.commission) > 0) {
    broadcastCourierWallet(commissionResult)
  }
  if (updated.status === 'cancelled' && prev?.status !== 'cancelled') {
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
  if (prev && (fx?.transitionApplied !== false)) onOrderStatusChangeServer(prev, updated)
  broadcast('order_update', updated)
}

function o6CardDeps() {
  return {
    findCardByNum,
    normalizeCardRow,
  }
}

const PORT = Number(process.env.PORT) || 8000
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

await initDb()
const db = seedIfEmpty()
setRevisionCoordinator(revisionCoordinator)
ensurePosCollections(db)
ensureAuditLog(db)
pruneAuditLog(db)
if (ensureDefaultEmployees(db)) persist()
if (ensurePosSaleNumbers(db)) persist()
/** 3 = дерево с фото POS (грамматика + 19 корневых групп) */
const CATEGORY_SEED_VERSION = 3
if (!db._categorySeedVersion || db._categorySeedVersion < CATEGORY_SEED_VERSION) {
  if (db._categorySeedVersion && db._categorySeedVersion < CATEGORY_SEED_VERSION) {
    const result = replaceCategoriesFromSeed(db)
    console.log(`[categories] Сид v${CATEGORY_SEED_VERSION}: ${result.total} категорий, товаров переназначено: ${result.remapped}`)
  } else if (ensureMarketCategories(db)) {
    console.log('[categories] Добавлены недостающие категории из сида')
  }
  db._categorySeedVersion = CATEGORY_SEED_VERSION
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
if (!db._stockLayerSyncVersion || db._stockLayerSyncVersion < 2) {
  const fixed = reconcileAllProductStock(db, { createdBy: 'system' })
  if (fixed.length) {
    console.log(`[stock] Остатки приведены к партиям (${fixed.length} поз.):`)
    for (const row of fixed) console.log(`  · ${row.name}: ${row.before} → ${row.after}`)
  }
  db._stockLayerSyncVersion = 2
  persist()
}

function persist() {
  scheduleSaveDb()
}

const o8HandlerCtx = () => ({
  db,
  findCardByNum,
  findClientByPhone,
  ensureLoyaltySettings,
  createFinanceMove,
  deleteFinanceMove,
  isCardTopupFinanceMove,
  openPosShift,
  closePosShift,
  convertVaultCardToCash,
  convertVaultCashToCard,
  returnPosSale,
  reconcileClientBonuses,
  loyaltyHooks: loyaltyHooks(),
  syncClientFromCardRow,
  auditFromReq,
  broadcastPosUpdate,
  broadcastLoyalty,
  createSupplierPayment,
  deleteSupplierPayment,
  createExpense,
  deleteExpense,
  createStockReceipt,
  updateStockReceipt,
  deleteStockReceipt,
  createStockWriteoff,
  updateStockWriteoff,
  deleteStockWriteoff,
  createStockAdjustment,
  createPosSale,
  createClientOrderFromPosSale,
  completePosSaleOnlineLoyalty,
  deliverDebtNotifications,
  handleClientDebtDelta,
  alignPosCashBonusToTarget,
  ensureCardRowForClient,
  createCashAdvance,
  applyDebtRepayToShift,
  normalizeCardRow,
  normalizeClientRow,
  normalizePhoneDigits,
  assertCardAssignableToClient,
  unlinkNonCanonicalSiblingCards,
  assertDebtCardUnlinkAllowed,
  notifyCrmChange,
  broadcast,
  broadcastProduct,
})

// ── Идемпотентность офлайн-кассы ──
// Касса без интернета копит операции и отправляет их пачкой. Отправка может
// повториться (обрыв связи на ответе), поэтому запоминаем clientRef каждой
// проведённой операции и при повторе отдаём тот же результат.
const OP_REF_TTL_MS = 14 * 24 * 60 * 60 * 1000
const OP_REF_LIMIT = 5000

function ensureOpRefs() {
  if (!Array.isArray(db.opRefs)) db.opRefs = []
  return db.opRefs
}

function pruneOpRefs() {
  const rows = ensureOpRefs()
  const edge = Date.now() - OP_REF_TTL_MS
  const alive = rows.filter(r => Date.parse(r.createdAtIso || '') > edge)
  const next = alive.length > OP_REF_LIMIT ? alive.slice(-OP_REF_LIMIT) : alive
  const keep = new Set(next)
  for (const r of rows) {
    if (keep.has(r)) continue
    queueDocDelete('opRefs', rowIdForItem(r, 0))
  }
  db.opRefs = next
}

/** Результат ранее проведённой операции с тем же ключом (или null) */
function findOpRef(kind, clientRef) {
  const row = findOpRefRow(kind, clientRef)
  return row ? row.result : null
}

/** Full opRef row including fingerprint (Phase D4). */
function findOpRefRow(kind, clientRef) {
  const ref = String(clientRef || '').trim()
  if (!ref) return null
  return ensureOpRefs().find(r => r.clientRef === ref && r.kind === kind) || null
}

function rememberOpRef(kind, clientRef, result, fingerprint = null) {
  const ref = String(clientRef || '').trim()
  if (!ref) return
  const rows = ensureOpRefs()
  const idx = rows.findIndex(r => r.clientRef === ref && r.kind === kind)
  const id = debtOpRefDocId(kind, ref)
  const row = {
    id,
    clientRef: ref,
    kind,
    result,
    fingerprint: fingerprint || (idx >= 0 ? rows[idx].fingerprint : null) || null,
    createdAtIso: new Date().toISOString(),
  }
  // FIX D / D4: one opRef per (kind, clientRef) — replace, do not append duplicates
  if (idx >= 0) rows[idx] = row
  else rows.push(row)
  pruneOpRefs()
}

/**
 * Phase D4: if opRef exists — replay or 409 payload collision.
 * @returns {boolean} true if response already sent
 */
function replyDebtOpReplayOrConflict(res, kind, clientRef, fingerprint, extra = {}) {
  const resolved = resolveDebtOpIdempotency(db, {
    kind,
    clientRef,
    fingerprint,
    findOpRefRow,
  })
  if (resolved.action === 'replay') {
    res.json({
      ...resolved.payload,
      ...extra,
      clientRef,
      kind,
      replayed: true,
      duplicate: true,
      idempotentReplay: true,
    })
    return true
  }
  if (resolved.action === 'conflict') {
    res.status(resolved.status || 409).json({
      ...resolved.body,
      clientRef,
      kind,
    })
    return true
  }
  return false
}

const { replyIfKnownOp, remember: rememberKnownOp } = makeIdempotency(findOpRef, rememberOpRef)

function ensurePromos() {
  if (!Array.isArray(db.promos)) db.promos = []
  if (typeof db._seq.promo !== 'number') db._seq.promo = 0
  // Демо-акции больше не восстанавливаются автоматически (чистый старт).
}
ensurePromos()

function ensureCouriers() {
  if (!Array.isArray(db.couriers)) db.couriers = []
  if (!Array.isArray(db.courierWalletTx)) db.courierWalletTx = []
  // Демо-курьеры больше не восстанавливаются автоматически (чистый старт).
  let changed = false
  const alive = new Set(db.couriers.map(c => String(c.id)))
  const beforeTx = db.courierWalletTx.length
  db.courierWalletTx = db.courierWalletTx.filter(t => alive.has(String(t.courierId || '')))
  if (db.courierWalletTx.length !== beforeTx) changed = true
  for (const c of db.couriers) {
    const acc = normalizeCourierAccount(c.account, c.id)
    if (c.account !== acc) {
      c.account = acc
      changed = true
    }
    // Первый запуск после изоляции счетов: не тянуть чужую историю пополнений
    // с переиспользованного id (C-01 / KUR-0001).
    if (!c.createdAt) {
      c.createdAt = new Date().toISOString()
      const since = Date.parse(c.createdAt)
      const n0 = db.courierWalletTx.length
      db.courierWalletTx = db.courierWalletTx.filter(t => {
        if (String(t.courierId) !== String(c.id)) return true
        const at = Date.parse(t.at || '')
        return Number.isFinite(at) && at >= since
      })
      if (db.courierWalletTx.length !== n0) changed = true
      changed = true
    }
  }
  if (changed) persist()
}
ensureCouriers()

function nextCourierSeq(db) {
  const fromList = (db.couriers || []).map(c => parseInt(String(c.id).replace(/\D/g, ''), 10))
  const fromTx = (db.courierWalletTx || []).map(t => parseInt(String(t.courierId || '').replace(/\D/g, ''), 10))
  const fromAcc = (db.couriers || []).map(c => parseInt(String(normalizeCourierAccount(c.account, c.id)).replace(/\D/g, ''), 10))
  const all = [...fromList, ...fromTx, ...fromAcc].filter(n => Number.isFinite(n) && n > 0)
  return (all.length ? Math.max(...all) : 0) + 1
}

function purgeCourierWalletTx(db, courierId) {
  const id = String(courierId || '')
  if (!id) return
  db.courierWalletTx = (db.courierWalletTx || []).filter(t => String(t.courierId) !== id)
}

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
app.set('trust proxy', 1)
app.use(cors({
  // Bearer Authorization header auth — no ambient cookies → credentials:false
  // (wildcard + credentials:true would be unsafe; we never enable that).
  credentials: false,
  origin(origin, cb) {
    if (!origin) return cb(null, true)
    if (CORS_ORIGINS.length === 1 && CORS_ORIGINS[0] === '*') return cb(null, true)
    if (/^https?:\/\/localhost(:\d+)?$/i.test(origin)) return cb(null, true)
    if (/^capacitor:\/\//i.test(origin)) return cb(null, true)
    if (CORS_ORIGINS.includes(origin)) return cb(null, true)
    cb(null, false)
  },
}))
app.use(express.json({ limit: '2mb' }))
app.use(createAuthMiddleware(matchRoutePolicy, {
  refreshStaffAuth(req) {
    const auth = req.auth
    if (!auth || auth.labAuto) return { ok: true }
    if (!['STAFF', 'CASHIER'].includes(auth.principal)) return { ok: true }
    const emp = (db.employees || []).find((e) => String(e.id) === String(auth.subjectId))
    if (!emp || emp.active === false) {
      return {
        ok: false,
        status: 401,
        detail: 'Сотрудник заблокирован',
        code: 'AUTH_STAFF_DISABLED',
      }
    }
    const perms = Array.isArray(emp.permissions) ? emp.permissions.map(String) : []
    auth.permissions = perms
    auth.caps = capsFromTradePermissions(perms)
    auth.name = emp.name || auth.name
    // Principal follows current role
    if (String(emp.role || '') === 'cashier') auth.principal = 'CASHIER'
    else auth.principal = 'STAFF'
    return { ok: true }
  },
}))
installDurableHttpResponse(app)

ensureUploadDirs()
app.use('/uploads', express.static(UPLOAD_ROOT, {
  maxAge: '30d',
  fallthrough: true,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable')
  },
}))

/** Канал автообновления KAKAPO Касса: latest.yml + Setup.exe */
const UPDATES_KASSA_DIR = process.env.UPDATES_DIR
  ? join(process.env.UPDATES_DIR, 'kassa')
  : join(DATA_DIR, 'updates', 'kassa')
try {
  mkdirSync(UPDATES_KASSA_DIR, { recursive: true })
} catch { /* ignore */ }
app.use('/updates/kassa', express.static(UPDATES_KASSA_DIR, {
  maxAge: 0,
  fallthrough: true,
  setHeaders(res, filePath) {
    // latest.yml всегда свежий; exe можно кэшировать по имени с версией
    if (/\.yml$/i.test(filePath) || /\.yaml$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600')
    }
    res.setHeader('Access-Control-Allow-Origin', '*')
  },
}))
app.get('/updates/kassa', (_req, res) => {
  res.type('text').send('KAKAPO Kassa updates channel')
})

/** Офлайн-пакет UI для Electron (без полной переустановки Setup.exe) */
const UPDATES_KASSA_UI_DIR = process.env.UPDATES_DIR
  ? join(process.env.UPDATES_DIR, 'kassa-ui')
  : join(DATA_DIR, 'updates', 'kassa-ui')
try {
  mkdirSync(UPDATES_KASSA_UI_DIR, { recursive: true })
} catch { /* ignore */ }
app.use('/updates/kassa-ui', express.static(UPDATES_KASSA_UI_DIR, {
  maxAge: 0,
  fallthrough: true,
  setHeaders(res, filePath) {
    if (/latest\.json$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600')
    }
    res.setHeader('Access-Control-Allow-Origin', '*')
  },
}))
app.get('/updates/kassa-ui', (_req, res) => {
  res.type('text').send('KAKAPO Kassa offline UI channel')
})

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
          const prevThumb = p.photoThumb
          p.photo = result.url
          p.photoThumb = result.thumbUrl
          persist()
          broadcastProduct(p)
          if (prev && prev !== result.url) deleteManagedProductPhoto(prev)
          if (prevThumb && prevThumb !== result.thumbUrl && prevThumb !== prev) {
            deleteManagedProductPhoto(prevThumb)
          }
        }
      }
      res.json(result)
    } catch (e) {
      res.status(400).json({ detail: e?.message || 'Не удалось обработать фото' })
    }
  })
})

app.post('/products/convert-photos', async (_req, res) => {
  try {
    const result = await migrateProductPhotos(db.products || [], {
      persist,
      onConverted: p => broadcastProduct(p),
    })
    res.json({ ok: true, ...result })
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось конвертировать фото' })
  }
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
  // Order events are staff-scoped (not anonymous catalog sockets).
  const msg = JSON.stringify({ event, order })
  for (const ws of clients) {
    if (ws.readyState !== 1) continue
    if (isWsStaffRole(ws.wsRole)) ws.send(msg)
  }
}

function broadcastProduct(product) {
  // Catalog invalidation remains receivable by public/catalog + staff + client.
  const msg = JSON.stringify({ event: 'product_update', product: stripHeavyPhotoFields(product) })
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg)
  }
}

let photoMigrateInflight = null
function kickProductPhotoMigration() {
  if (photoMigrateInflight) return photoMigrateInflight
  const list = db.products || []
  if (!list.some(productPhotoNeedsConvert)) return null
  photoMigrateInflight = migrateProductPhotos(list, {
    persist,
    onConverted: p => broadcastProduct(p),
  }).then(r => {
    if (r.converted || r.failed) {
      console.log(`[photos] WebP: конвертировано ${r.converted}, пропущено ${r.skipped}, ошибок ${r.failed}`)
    }
    return r
  }).catch(e => {
    console.warn('[photos] миграция не удалась', e?.message || e)
    return null
  }).finally(() => {
    photoMigrateInflight = null
  })
  return photoMigrateInflight
}

async function convertProductPhotoIfNeeded(p) {
  if (!p || !productPhotoNeedsConvert(p)) return false
  try {
    const ok = await convertStoredProductPhoto(p)
    if (ok) broadcastProduct(p)
    return ok
  } catch (e) {
    console.warn('[photos] не удалось конвертировать товар', p?.id, e?.message || e)
    return false
  }
}

function broadcastRestaurant(restaurant) {
  const msg = JSON.stringify({ event: 'restaurant_update', restaurant })
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg)
  }
}

function broadcastPosUpdate(payload = {}) {
  // POS/CRM/finance invalidation hints — staff/pos only (never anonymous).
  const msg = JSON.stringify({ event: 'pos_update', payload })
  for (const ws of clients) {
    if (ws.readyState !== 1) continue
    if (ws.wsRole === 'admin' || ws.wsRole === 'pos') ws.send(msg)
  }
}

function runRevisionCoordinator() {
  try {
    if (revisionCoordinator.processRevisionQueue(db)) {
      persist()
      broadcastProduct({ reason: 'revision-coordinator' })
      broadcastPosUpdate({ kind: 'revision-coordinator' })
    }
  } catch (e) {
    console.error('[revision-coordinator]', e?.message || e)
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
      clientId: payload.clientId || '',
    },
  })
  for (const ws of clients) {
    if (ws.readyState !== 1) continue
    // admin + все кассы (pos): сразу тянут клиентов/карты
    if (ws.wsRole === 'admin' || ws.wsRole === 'pos') {
      ws.send(msg)
      continue
    }
    if (ws.wsRole === 'client' && target && ws.clientPhone === target) {
      ws.send(msg)
    }
  }
}

/** Клиент/карта изменились → касса и админка обновляются сразу */
function notifyCrmChange(clientOrCard = {}) {
  const phone = clientOrCard.phone || ''
  const card = clientOrCard.card || clientOrCard.num || ''
  const clientId = clientOrCard.id || clientOrCard.clientId || ''
  broadcastLoyalty({
    phone,
    bonus: clientOrCard.bonus,
    card,
    clientId,
  })
  broadcastPosUpdate({
    kind: 'crm',
    id: clientId || card || phone,
    phone,
    card,
  })
}

function parseWsMeta(url, req) {
  const raw = String(url || '')
  const path = raw.split('?')[0]
  const role = path.replace(/^\/ws\//, '') || 'client'
  const params = new URLSearchParams(raw.includes('?') ? raw.split('?')[1] : '')
  const qToken = String(params.get('token') || '').trim()
  return {
    role,
    phone: phoneKey(params.get('phone') || ''),
    token: extractWsToken(req, qToken),
  }
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

/** PC-14 read-only: classify clientRef for debt-family ops (no mutations). */
app.get('/sync/debt-op-status', (req, res) => {
  try {
    const kind = String(req.query.kind || '').trim()
    const clientRef = String(req.query.clientRef || '').trim()
    if (!clientRef || !kind) {
      return res.status(400).json({ detail: 'kind and clientRef required' })
    }
    let incomingFp = null
    if (req.query.amount != null) {
      incomingFp = buildDebtOpFingerprint(kind, {
        amount: req.query.amount,
        method: req.query.method,
        clientId: req.query.clientId,
        cardNum: req.query.cardNum,
        orderId: req.query.orderId,
        shiftId: req.query.shiftId,
      })
    }
    res.json(classifyDebtOpClientRef(db, kind, clientRef, incomingFp))
  } catch (e) {
    res.status(500).json({ detail: e?.message || 'debt-op-status failed' })
  }
})

app.get('/health', (_req, res) => {
  const stats = getDbStats()
  const persistent = stats.persistent
  res.json({
    ok: true,
    service: 'kakapo-api',
    version: '2.16-admin-orders-delete',
    loyaltyVip: true,
    engine: stats.engine,
    dataDir: stats.dataDir,
    dbFile: stats.path,
    persistentDisk: persistent,
    clients: stats.clients,
    orders: stats.orders,
    cards: stats.cards,
    products: stats.products,
    warning: process.env.NODE_ENV === 'production' && !persistent
      ? 'Подключите постоянный диск (DATA_DIR=/data) — иначе клиенты удаляются при каждом деплое'
      : undefined,
  })
})

/** Readiness: process + PostgreSQL reachable (non-destructive). */
app.get('/ready', async (_req, res) => {
  try {
    if (!isPostgresEnabled()) {
      return res.status(503).json({ ok: false, ready: false, detail: 'DATABASE_URL missing', code: 'READY_NO_DB' })
    }
    await withClient(async (c) => {
      await c.query('SELECT 1')
    })
    res.json({ ok: true, ready: true, engine: 'postgres' })
  } catch (e) {
    res.status(503).json({
      ok: false,
      ready: false,
      detail: 'PostgreSQL unavailable',
      code: 'READY_DB_DOWN',
    })
  }
})

/** Двусторонний синк: дельты после outbox flush на кассе.
 *  ?scope=pos-lite — только чеки/смены/клиенты/карты (лёгкий фон кассы). */
app.get('/sync/changes', (req, res) => {
  try {
    const since = String(req.query.since || '').trim()
    const historyDays = Number(req.query.historyDays)
    const scope = String(req.query.scope || '').trim()
    res.json(buildSyncChanges(db, { since, historyDays, scope }))
  } catch (e) {
    res.status(500).json({ detail: e?.message || 'sync/changes failed' })
  }
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

app.post('/auth/otp/send', (req, res) => {
  const ip = clientIp(req)
  const rl = rateLimitCheck(`otp-send:${ip}`, { windowMs: 60_000, max: 10, blockMs: 60_000 })
  if (!rl.ok) return res.status(rl.status).json({ detail: rl.detail, code: rl.code })
  try {
    const out = createOtpChallenge({ phone: req.body?.phone || req.body?.clientPhone })
    res.json(out)
  } catch (e) {
    res.status(e?.status || 400).json({ detail: e?.message || 'OTP недоступен', code: e?.code })
  }
})
app.post('/auth/otp/verify', (req, res) => {
  const ip = clientIp(req)
  const rl = rateLimitCheck(`otp-verify:${ip}`, { windowMs: 60_000, max: 20, blockMs: 120_000 })
  if (!rl.ok) return res.status(rl.status).json({ detail: rl.detail, code: rl.code })
  try {
    const verified = verifyOtpChallenge({
      challengeId: req.body?.challengeId,
      phone: req.body?.phone || req.body?.clientPhone,
      code: req.body?.code,
    })
    const phone = String(verified.phone || '').replace(/\D/g, '')
    rateLimitReset(`otp-verify:${ip}`)
    const session = createSession({
      principal: 'CLIENT',
      subjectId: phone || 'client',
      phone: phone || '',
      name: String(req.body.name || 'Клиент'),
      roles: ['client'],
    })
    res.json({
      access_token: session.token,
      role: 'client',
      user_id: 1,
      name: session.name,
      phone: session.phone,
    })
  } catch (e) {
    res.status(e?.status || 400).json({ detail: e?.message || 'Неверный код', code: e?.code })
  }
})
app.post('/auth/login', (req, res) => {
  ensureAdminAuth()
  const ip = clientIp(req)
  const rl = rateLimitCheck(`admin-login:${ip}`, { windowMs: 60_000, max: 12, blockMs: 120_000 })
  if (!rl.ok) return res.status(rl.status).json({ detail: rl.detail, code: rl.code })
  const loginRaw = String(req.body.login || req.body.email || '').trim()
  const loginKey = loginRaw.toLowerCase()
  const password = String(req.body.password || '')
  if (!loginKey || !password) {
    return res.status(400).json({ detail: 'Укажите логин и пароль' })
  }
  const admin = findAdminUser()
  if (!admin) return res.status(401).json({ detail: 'Неверный логин или пароль' })
  const email = String(admin.email || '').toLowerCase()
  const login = String(admin.login || '').toLowerCase()
  const loginOk = (email === loginKey || login === loginKey)
    || (loginKey === 'admin' && email === 'admin@kakapo.tj')
  if (!loginOk) return res.status(401).json({ detail: 'Неверный логин или пароль' })
  const verified = verifyAndMaybeMigrateCredential(admin, password)
  if (!verified.ok) return res.status(401).json({ detail: 'Неверный логин или пароль' })
  if (verified.migrated) {
    applyPasswordMigration(admin, verified.passwordHash)
    syncAdminAuthMirror(admin)
    persist()
  }
  rateLimitReset(`admin-login:${ip}`)
  const session = createSession({
    principal: 'ADMIN',
    subjectId: String(admin.id),
    name: admin.name || 'Админ',
    roles: ['admin'],
  })
  res.json({
    access_token: session.token,
    role: admin.role,
    user_id: admin.id,
    name: admin.name || 'Админ',
  })
})
app.post('/auth/logout', (req, res) => {
  const token = parseBearer(req)
  if (!token) return res.status(401).json({ detail: 'Требуется авторизация', code: 'AUTH_REQUIRED' })
  revokeSession(token)
  res.json({ ok: true })
})
app.get('/auth/admin', (_req, res) => {
  const auth = ensureAdminAuth()
  res.json({ login: auth.login })
})

app.patch('/auth/admin', (req, res) => {
  ensureAdminAuth()
  const body = req.body || {}
  const currentPassword = String(body.currentPassword || '')
  const admin = findAdminUser()
  if (!admin || !verifyAndMaybeMigrateCredential(admin, currentPassword).ok) {
    return res.status(401).json({ detail: 'Неверный текущий пароль' })
  }

  let nextLogin = String(body.login != null ? body.login : (admin.login || 'admin')).trim()
  if (!nextLogin) return res.status(400).json({ detail: 'Логин не может быть пустым' })
  if (nextLogin.length < 3) return res.status(400).json({ detail: 'Логин минимум 3 символа' })

  const prevLogin = String(admin.login || '')
  admin.login = nextLogin
  admin.email = nextLogin.includes('@') ? nextLogin : `${nextLogin}@kakapo.tj`
  if (body.newPassword != null && String(body.newPassword).length > 0) {
    try {
      setPasswordOnRow(admin, String(body.newPassword))
    } catch (e) {
      return res.status(400).json({ detail: e?.message || 'Пароль некорректен' })
    }
  } else {
    // Migrate legacy plaintext if still present after successful verify
    const v = verifyAndMaybeMigrateCredential(admin, currentPassword)
    if (v.migrated) applyPasswordMigration(admin, v.passwordHash)
  }
  syncAdminAuthMirror(admin)
  auditFromReq(db, req, {
    action: 'update',
    entity: 'settings',
    entityId: 'auth',
    entityName: 'Доступ админки',
    summary: nextLogin !== prevLogin
      ? `Сменён логин админа: ${prevLogin} → ${nextLogin}`
      : (body.newPassword ? 'Сменён пароль админа' : 'Обновлены данные входа админа'),
  })
  persist()
  res.json({ ok: true, login: nextLogin })
})

app.get('/products', (_req, res) => {
  kickProductPhotoMigration()
  res.json((db.products || []).map(stripHeavyPhotoFields))
})
app.get('/products/next-codes', (_req, res) => {
  const next = nextFreeProductCode(db.products)
  const barcode = nextFreeEan13(db.products, next)
  // PLU только для весовых — клиент запросит при выборе «на развес»
  res.json({ next, art: String(next), plu: '', barcode })
})
app.post('/products', async (req, res) => {
  try {
    const clientRef = takeClientRef(req)
    const fingerprint = masterCreateFingerprint(
      FIN_OP_KINDS.PRODUCT_UPSERT,
      fingerprintProductCreate(req.body),
    )
    if (useDurableMasterCreate(clientRef)) {
      if (replyMasterCreateReplayOrConflict(res, FIN_OP_KINDS.PRODUCT_UPSERT, clientRef, fingerprint, findOpRefRow)) return
      try {
        const { replay, result: p } = await runDurableMasterCreate(db, {
          clientRef,
          operationKind: FIN_OP_KINDS.PRODUCT_UPSERT,
          fingerprint,
          mutate: () => mutateCreateProduct(db, { ...req.body, clientRef }),
        })
        if (!replay) {
          auditFromReq(db, req, {
            action: 'create',
            entity: 'product',
            entityId: p.id,
            entityName: p.name,
            summary: `Создан товар «${p.name}» · цена ${p.price}`,
            after: { name: p.name, price: p.price, stock: p.stock, art: p.art },
          })
          await convertProductPhotoIfNeeded(p)
          broadcastProduct(p)
        }
        return finishDurableMasterJson(res, stripHeavyPhotoFields(p), replay)
      } catch (e) {
        return respondMasterTxError(res, e, 'Не удалось создать товар')
      }
    }
    if (replyIfKnownOp(res, 'product_upsert', clientRef)) return
    const id = ++db._seq.product
    const sellType = req.body.sellType || 'piece'
    const needPlu = sellType === 'weight'
    const codes = allocateProductCodes(db.products, {
      art: req.body.art,
      plu: needPlu ? req.body.plu : '',
    }, null, { needPlu })
    const preferSerial = Number(codes.art) || nextFreeProductCode(db.products)
    const bars = allocateProductBarcodes(db.products, {
      barcode: req.body.barcode,
      barcodes: req.body.barcodes,
    }, preferSerial)
    const p = {
      id,
      art: codes.art,
      e: req.body.e || '📦',
      name: req.body.name, price: req.body.price || 0, costPrice: req.body.costPrice ?? null, cat: req.body.cat || '', catId: req.body.catId || '',
      unit: req.body.unit || 'шт', stock: req.body.stock || 0, hot: !!req.body.hot,
      desc: req.body.desc, brand: req.body.brand, country: req.body.country,
      barcode: bars.barcode,
      barcodes: bars.barcodes,
      plu: needPlu ? (codes.plu || null) : null,
      organic: !!req.body.organic, sellType,
      unitGrams: req.body.unitGrams, weightStep: req.body.weightStep, minWeight: req.body.minWeight,
      packWeightGrams: req.body.packWeightGrams != null && Number(req.body.packWeightGrams) > 0
        ? Math.round(Number(req.body.packWeightGrams))
        : undefined,
      old: req.body.old ?? null,
      photo: req.body.photo ? String(req.body.photo) : undefined,
      photoThumb: req.body.photoThumb ? String(req.body.photoThumb) : undefined,
      bulkPricing: Array.isArray(req.body.bulkPricing) ? req.body.bulkPricing : undefined,
      docVersion: 1,
      updatedAtIso: new Date().toISOString(),
    }
    db.products.push(p)
    if (Number(p.stock) > 0) {
      setProductStockExact(db, p.id, p.stock, { reason: 'Начальный остаток', createdBy: req.body?.createdBy || '' })
    } else {
      p.stock = 0
    }
    auditFromReq(db, req, {
      action: 'create',
      entity: 'product',
      entityId: p.id,
      entityName: p.name,
      summary: `Создан товар «${p.name}» · цена ${p.price}`,
      after: { name: p.name, price: p.price, stock: p.stock, art: p.art },
    })
    if (clientRef) { p.clientRef = clientRef; rememberKnownOp('product_upsert', clientRef, p) }
    await convertProductPhotoIfNeeded(p)
    persist()
    broadcastProduct(p)
    res.json(stripHeavyPhotoFields(p))
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось создать товар' })
  }
})
app.patch('/products/:id', async (req, res) => {
  const p = db.products.find(x => x.id === Number(req.params.id))
  if (!p) return res.status(404).json({ detail: 'Не найдено' })
  try {
    const clientRef = takeClientRef(req)
    if (replyIfKnownOp(res, 'product_upsert', clientRef)) return
    const previousPhoto = p.photo
    const previousThumb = p.photoThumb
    const before = { name: p.name, price: p.price, stock: p.stock, costPrice: p.costPrice, cat: p.cat }
    const body = { ...req.body }
    delete body.clientRef
    const expectedDoc = body.expectedDocVersion
    delete body.expectedDocVersion
    if (expectedDoc != null && expectedDoc !== '') {
      const cur = Number(p.docVersion) || 0
      const exp = Number(expectedDoc)
      if (Number.isFinite(exp) && exp !== cur) {
        return res.status(409).json({
          detail: `Товар уже меняли (версия ${cur}, ожидали ${exp})`,
        })
      }
    }
    const artTouched = Object.prototype.hasOwnProperty.call(body, 'art')
    const pluTouched = Object.prototype.hasOwnProperty.call(body, 'plu')
    const sellTouched = Object.prototype.hasOwnProperty.call(body, 'sellType')
    const barTouched = Object.prototype.hasOwnProperty.call(body, 'barcode')
      || Object.prototype.hasOwnProperty.call(body, 'barcodes')
    const nextSell = sellTouched ? (body.sellType || 'piece') : (p.sellType || 'piece')
    const needPlu = nextSell === 'weight'
    if (artTouched || pluTouched || sellTouched || !needPlu) {
      const codes = allocateProductCodes(db.products, {
        art: artTouched ? body.art : p.art,
        plu: needPlu ? (pluTouched ? body.plu : p.plu) : '',
      }, p.id, { needPlu })
      body.art = codes.art
      body.plu = needPlu ? (codes.plu || null) : null
    }
    if (barTouched) {
      const preferSerial = Number(body.art || p.art) || nextFreeProductCode(db.products, p.id)
      const bars = allocateProductBarcodes(db.products, {
        barcode: body.barcode,
        barcodes: body.barcodes,
      }, preferSerial, p.id)
      body.barcode = bars.barcode
      body.barcodes = bars.barcodes
    }
    // Остаток живёт в партиях — прямая запись stock иначе расходится со складом
    const stockTouched = Object.prototype.hasOwnProperty.call(body, 'stock')
    delete body.stock
    delete body.docVersion
    if (stockTouched) {
      return res.status(400).json({
        detail: 'Остаток нельзя менять через карточку товара. Используйте POST /stock/adjustments',
        code: 'STOCK_REQUIRES_ADJUSTMENT_OPERATION',
      })
    }
    Object.assign(p, body)
    p.docVersion = (Number(p.docVersion) || 0) + 1
    p.updatedAtIso = new Date().toISOString()
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
    if (clientRef) rememberKnownOp('product_upsert', clientRef, p)
    await convertProductPhotoIfNeeded(p)
    const photoTouched = Object.prototype.hasOwnProperty.call(req.body, 'photo')
      || Object.prototype.hasOwnProperty.call(req.body, 'photoThumb')
    if (photoTouched) {
      if (previousPhoto && previousPhoto !== p.photo) deleteManagedProductPhoto(previousPhoto)
      if (previousThumb && previousThumb !== p.photoThumb && previousThumb !== previousPhoto) {
        deleteManagedProductPhoto(previousThumb)
      }
    }
    persist()
    broadcastProduct(p)
    res.json(stripHeavyPhotoFields(p))
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

app.post('/stock/reconcile', (req, res) => {
  try {
    const fixed = reconcileAllProductStock(db, { createdBy: req.body?.createdBy || '' })
    if (fixed.length) {
      auditFromReq(db, req, {
        action: 'update',
        entity: 'product',
        summary: `Сверка остатков с партиями · исправлено ${fixed.length} поз.`,
        after: { fixed },
      })
      persist()
      for (const row of fixed) {
        const p = db.products.find(x => x.id === row.id)
        if (p) broadcastProduct(p)
      }
    }
    res.json({ ok: true, fixed })
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось сверить остатки' })
  }
})

app.post('/products/:id/stock-layers', async (req, res) => {
  try {
    const clientRef = takeClientRef(req)
    const id = Number(req.params.id)
    const body = req.body || {}
    const qty = Number(body.qty ?? body.quantity) || 0
    const fingerprint = buildO6Fingerprint(WH_OP_KINDS.STOCK_LAYER_CREATE, {
      productId: id,
      qty,
      costPrice: Number(body.costPrice) || 0,
      reason: String(body.reason || '').trim(),
    })
    if (useDurableMasterCreate(clientRef)) {
      if (replyMasterCreateReplayOrConflict(res, WH_OP_KINDS.STOCK_LAYER_CREATE, clientRef, fingerprint, findOpRefRow)) return
      const { replay, result } = await runDurableMasterCreate(db, {
        clientRef,
        operationKind: WH_OP_KINDS.STOCK_LAYER_CREATE,
        fingerprint,
        advisoryLocks: stockProductAdvisoryLocks([id]),
        mutate: () => {
          const layerResult = addProductStockLayer(db, id, { ...body, clientRef })
          if (layerResult.receipt) layerResult.receipt.clientRef = clientRef
          return {
            result: layerResult,
            touched: touchedFromWarehouse(db, {
              productIds: [id],
              receipt: layerResult.receipt,
            }),
            meta: { _seq: JSON.parse(JSON.stringify(db._seq || {})) },
          }
        },
      })
      if (!replay) {
        broadcastPosUpdate({ kind: 'receipt', id: result.receipt.id })
        broadcastProduct({ id, reason: 'stock-layer' })
      }
      return finishDurableMasterJson(res, result, replay)
    }
    if (replyIfKnownOp(res, 'stock_receipt_create', clientRef)) return
    const result = addProductStockLayer(db, id, body)
    if (clientRef) {
      if (result.receipt) result.receipt.clientRef = clientRef
      rememberKnownOp('stock_receipt_create', clientRef, result)
    }
    persist()
    broadcastPosUpdate({ kind: 'receipt', id: result.receipt.id })
    broadcastProduct({ id, reason: 'stock-layer' })
    res.json(result)
  } catch (e) {
    respondMasterTxError(res, e, 'Не удалось добавить приход')
  }
})

app.patch('/stock/layers/:receiptId/:productId', async (req, res) => {
  try {
    const clientRef = takeClientRef(req)
    const receiptId = req.params.receiptId
    const productId = Number(req.params.productId)
    const body = req.body || {}
    const fingerprint = buildO6Fingerprint(WH_OP_KINDS.STOCK_LAYER_UPDATE, {
      receiptId,
      productId,
      costPrice: body.costPrice,
      retailPrice: body.retailPrice,
      bulkPricing: body.bulkPricing,
      expiryDate: body.expiryDate,
    })
    if (useDurableMasterCreate(clientRef)) {
      if (replyMasterCreateReplayOrConflict(res, WH_OP_KINDS.STOCK_LAYER_UPDATE, clientRef, fingerprint, findOpRefRow)) return
      const { replay, result: layers } = await runDurableMasterCreate(db, {
        clientRef,
        operationKind: WH_OP_KINDS.STOCK_LAYER_UPDATE,
        fingerprint,
        advisoryLocks: stockProductAdvisoryLocks([productId]),
        mutate: () => {
          const updated = updateProductStockLayer(db, receiptId, productId, body)
          return {
            result: updated,
            touched: touchedFromWarehouse(db, { productIds: [productId] }),
            meta: { _seq: JSON.parse(JSON.stringify(db._seq || {})) },
          }
        },
      })
      if (!replay) broadcastProduct({ id: productId, reason: 'stock-layer' })
      markResponseEphemeral(res)
      return res.json(layers)
    }
    if (replyIfKnownOp(res, 'stock_layer_update', clientRef)) return
    const layers = updateProductStockLayer(db, receiptId, productId, body)
    if (clientRef) rememberKnownOp('stock_layer_update', clientRef, layers)
    persist()
    broadcastProduct({ id: productId, reason: 'stock-layer' })
    res.json(layers)
  } catch (e) {
    respondMasterTxError(res, e, 'Не удалось обновить партию')
  }
})
app.delete('/stock/layers/:receiptId/:productId', async (req, res) => {
  try {
    const clientRef = takeClientRef(req)
    const receiptId = req.params.receiptId
    const productId = Number(req.params.productId)
    const fingerprint = buildO6Fingerprint(WH_OP_KINDS.STOCK_LAYER_DELETE, { receiptId, productId })
    if (useDurableMasterCreate(clientRef)) {
      if (replyMasterCreateReplayOrConflict(res, WH_OP_KINDS.STOCK_LAYER_DELETE, clientRef, fingerprint, findOpRefRow)) return
      const { replay, result } = await runDurableMasterCreate(db, {
        clientRef,
        operationKind: WH_OP_KINDS.STOCK_LAYER_DELETE,
        fingerprint,
        advisoryLocks: stockProductAdvisoryLocks([productId]),
        mutate: () => {
          const deleted = deleteProductStockLayer(db, receiptId, productId)
          return {
            result: deleted,
            touched: touchedFromWarehouse(db, { productIds: [productId], receipt: { id: deleted.receiptId } }),
            meta: { _seq: JSON.parse(JSON.stringify(db._seq || {})) },
          }
        },
      })
      if (!replay) {
        auditFromReq(db, req, {
          action: 'delete',
          entity: 'stock',
          entityId: result.receiptId,
          entityName: `layer:${result.productId}`,
          summary: result.deletedReceipt
            ? `Удалена партия (весь приход) · товар #${result.productId}`
            : `Удалена партия · товар #${result.productId}`,
        })
        broadcastPosUpdate({
          kind: 'receipt',
          id: result.receiptId,
          deleted: result.deletedReceipt,
        })
        broadcastProduct({ id: productId, reason: 'stock-layer' })
      }
      return finishDurableMasterJson(res, result, replay)
    }
    if (replyIfKnownOp(res, 'stock_layer_delete', clientRef)) return
    const result = deleteProductStockLayer(db, receiptId, productId)
    if (clientRef) rememberKnownOp('stock_layer_delete', clientRef, result)
    auditFromReq(db, req, {
      action: 'delete',
      entity: 'stock',
      entityId: result.receiptId,
      entityName: `layer:${result.productId}`,
      summary: result.deletedReceipt
        ? `Удалена партия (весь приход) · товар #${result.productId}`
        : `Удалена партия · товар #${result.productId}`,
    })
    persist()
    broadcastPosUpdate({
      kind: 'receipt',
      id: result.receiptId,
      deleted: !!result.deletedReceipt,
      updated: !result.deletedReceipt,
    })
    broadcastProduct({ id: Number(req.params.productId), reason: 'stock-layer-delete' })
    res.json(result)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось удалить партию' })
  }
})
app.delete('/products/:id', async (req, res) => {
  const clientRef = takeClientRef(req)
  const id = Number(req.params.id)
  const fingerprint = masterCreateFingerprint(FIN_OP_KINDS.PRODUCT_DELETE, fingerprintProductDelete(id))
  if (useDurableMasterCreate(clientRef)) {
    if (replyMasterCreateReplayOrConflict(res, FIN_OP_KINDS.PRODUCT_DELETE, clientRef, fingerprint, findOpRefRow)) return
    try {
      const existing = db.products.find(x => x.id === id)
      const { replay, result } = await runDurableMasterCreate(db, {
        clientRef,
        operationKind: FIN_OP_KINDS.PRODUCT_DELETE,
        fingerprint,
        mutate: () => mutateDeleteProduct(db, id, { deleteManagedProductPhotoFn: deleteManagedProductPhoto }),
      })
      if (!replay && existing) {
        auditFromReq(db, req, {
          action: 'delete',
          entity: 'product',
          entityId: id,
          entityName: existing.name,
          summary: `Удалён товар «${existing.name}»`,
          before: { name: existing.name, price: existing.price, stock: existing.stock, art: existing.art },
        })
        broadcastProduct({ id, deleted: true })
      }
      return finishDurableMasterJson(res, result, replay)
    } catch (e) {
      return respondMasterTxError(res, e, 'Не удалось удалить товар')
    }
  }
  if (replyIfKnownOp(res, 'product_delete', clientRef)) return
  const existing = db.products.find(x => x.id === id)
  if (!existing) return res.status(404).json({ detail: 'Не найдено' })
  try {
    const layers = sumProductLayers(db, id)
    if (layers > 0.009 || (Number(existing.stock) || 0) > 0.009) {
      return res.status(409).json({
        detail: `Нельзя удалить товар со складом (остаток ${Math.max(layers, Number(existing.stock) || 0).toFixed(2)})`,
      })
    }
  } catch (e) {
    return res.status(400).json({ detail: e?.message || 'Не удалось проверить склад' })
  }
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
  recordSyncDelete(db, 'product', id)
  const result = { ok: true, id }
  if (clientRef) rememberKnownOp('product_delete', clientRef, result)
  persist()
  broadcastProduct({ id, deleted: true })
  res.json(result)
})

/** Массовое удаление — один persist / один broadcast (иначе N запросов висят минутами) */
app.post('/products/bulk-delete', (req, res) => {
  const raw = Array.isArray(req.body?.ids) ? req.body.ids : []
  const ids = [...new Set(raw.map(x => Number(x)).filter(n => Number.isFinite(n) && n > 0))]
  if (!ids.length) return res.status(400).json({ detail: 'Укажите ids товаров' })
  const idSet = new Set(ids)
  const removed = []
  for (const existing of db.products) {
    if (!idSet.has(Number(existing.id))) continue
    if (existing.photo) {
      try { deleteManagedProductPhoto(existing.photo) } catch { /* ignore */ }
    }
    auditFromReq(db, req, {
      action: 'delete',
      entity: 'product',
      entityId: existing.id,
      entityName: existing.name,
      summary: `Удалён товар «${existing.name}»`,
      before: { name: existing.name, price: existing.price, stock: existing.stock, art: existing.art },
    })
    removed.push(Number(existing.id))
  }
  if (!removed.length) return res.status(404).json({ detail: 'Товары не найдены' })
  const remSet = new Set(removed)
  db.products = db.products.filter(x => !remSet.has(Number(x.id)))
  for (const rid of removed) recordSyncDelete(db, 'product', rid)
  persist()
  broadcastProduct({ deleted: true, ids: removed })
  res.json({ ok: true, removed: removed.length, ids: removed })
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
app.post('/categories', async (req, res) => {
  const clientRef = takeClientRef(req)
  const slugPreview = String(req.body.slug || '').trim() || slugifyCategory(req.body.name)
  const fingerprint = masterCreateFingerprint(
    FIN_OP_KINDS.CATEGORY_UPSERT,
    fingerprintCategoryCreate(req.body, slugPreview),
  )
  if (useDurableMasterCreate(clientRef)) {
    if (replyMasterCreateReplayOrConflict(res, FIN_OP_KINDS.CATEGORY_UPSERT, clientRef, fingerprint, findOpRefRow)) return
    try {
      const { replay, result: c } = await runDurableMasterCreate(db, {
        clientRef,
        operationKind: FIN_OP_KINDS.CATEGORY_UPSERT,
        fingerprint,
        mutate: () => mutateCreateCategory(db, req.body, { slugifyCategory }),
      })
      if (!replay) broadcastCategory(c)
      return finishDurableMasterJson(res, c, replay)
    } catch (e) {
      return respondMasterTxError(res, e, 'Не удалось создать категорию')
    }
  }
  if (replyIfKnownOp(res, 'category_upsert', clientRef)) return
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
  if (clientRef) rememberKnownOp('category_upsert', clientRef, c)
  persist()
  broadcastCategory(c)
  res.json(c)
})
app.patch('/categories/:id', (req, res) => {
  const clientRef = takeClientRef(req)
  if (replyIfKnownOp(res, 'category_upsert', clientRef)) return
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
  if (clientRef) rememberKnownOp('category_upsert', clientRef, next)
  persist()
  broadcastCategory(next)
  res.json(next)
})
app.delete('/categories/:id', (req, res) => {
  const clientRef = takeClientRef(req)
  if (replyIfKnownOp(res, 'category_delete', clientRef)) return
  const id = Number(req.params.id)
  const result = removeCategoryTree(db, id)
  if (!result.ok) return res.status(404).json({ error: 'not found' })
  const payload = {
    ok: true,
    movedProducts: result.movedProducts,
    deleted: result.deleted,
    slugs: result.slugs,
  }
  if (clientRef) rememberKnownOp('category_delete', clientRef, payload)
  persist()
  broadcastCategory({
    id,
    deleted: true,
    ids: result.deleted,
    slugs: result.slugs,
    movedProducts: result.movedProducts,
  })
  if (result.movedProducts) broadcastProduct({ reason: 'category_delete' })
  res.json(payload)
})

/** Массовая смена порядка (siblings: [{ id, order }]) */
app.post('/categories/reorder', (req, res) => {
  const clientRef = takeClientRef(req)
  if (replyIfKnownOp(res, 'category_reorder', clientRef)) return
  const raw = Array.isArray(req.body?.items) ? req.body.items : []
  if (!raw.length) return res.status(400).json({ detail: 'Укажите items: [{ id, order }]' })
  let changed = 0
  for (const it of raw) {
    const id = Number(it?.id)
    const order = Number(it?.order)
    if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(order)) continue
    const idx = db.categories.findIndex(c => Number(c.id) === id)
    if (idx < 0) continue
    if (Number(db.categories[idx].order) !== order) {
      db.categories[idx] = { ...db.categories[idx], order }
      changed += 1
    }
  }
  const payload = { ok: true, changed }
  if (changed) {
    persist()
    broadcastCategory({ reason: 'reorder' })
  }
  if (clientRef) rememberKnownOp('category_reorder', clientRef, payload)
  res.json(payload)
})

/** Массовое удаление категорий — один persist / один broadcast */
app.post('/categories/bulk-delete', (req, res) => {
  const clientRef = takeClientRef(req)
  if (replyIfKnownOp(res, 'category_delete', clientRef)) return
  const raw = Array.isArray(req.body?.ids) ? req.body.ids : []
  const requested = [...new Set(raw.map(x => Number(x)).filter(n => Number.isFinite(n) && n > 0))]
  if (!requested.length) return res.status(400).json({ detail: 'Укажите ids категорий' })

  const reqSet = new Set(requested)
  const hasAncestorInRequest = (catId) => {
    let pid = db.categories.find(c => Number(c.id) === Number(catId))?.parent_id
    while (pid != null) {
      if (reqSet.has(Number(pid))) return true
      pid = db.categories.find(c => Number(c.id) === Number(pid))?.parent_id ?? null
    }
    return false
  }
  const roots = requested.filter(id => !hasAncestorInRequest(id))

  const allDeleted = []
  const allSlugs = []
  let movedProducts = 0
  let removedRoots = 0
  for (const id of roots) {
    if (!db.categories.some(c => Number(c.id) === Number(id))) continue
    const result = removeCategoryTree(db, id)
    if (!result.ok) continue
    removedRoots += 1
    allDeleted.push(...result.deleted)
    allSlugs.push(...result.slugs)
    movedProducts += result.movedProducts
  }
  if (!allDeleted.length) return res.status(404).json({ detail: 'Категории не найдены' })
  const payload = { ok: true, removed: removedRoots, deleted: allDeleted, slugs: allSlugs, movedProducts }
  if (clientRef) rememberKnownOp('category_delete', clientRef, payload)
  persist()
  broadcastCategory({
    deleted: true,
    ids: allDeleted,
    slugs: allSlugs,
    movedProducts,
  })
  if (movedProducts) broadcastProduct({ reason: 'category_delete' })
  res.json(payload)
})

function removeCategoryTree(dbRef, rootId) {
  const rootNum = Number(rootId)
  const root = dbRef.categories.find(c => Number(c.id) === rootNum)
  if (!root) return { ok: false }

  const ids = new Set([rootNum])
  const queue = [rootNum]
  while (queue.length) {
    const pid = queue.pop()
    for (const child of dbRef.categories.filter(c => Number(c.parent_id) === pid)) {
      const cid = Number(child.id)
      if (!ids.has(cid)) {
        ids.add(cid)
        queue.push(cid)
      }
    }
  }

  const catsToDelete = dbRef.categories.filter(c => ids.has(Number(c.id)))
  const slugsToDelete = new Set(catsToDelete.map(c => c.slug))
  const parentCat = root.parent_id != null
    ? dbRef.categories.find(c => Number(c.id) === Number(root.parent_id))
    : null
  const fallbackSlug = parentCat?.slug || ''
  const fallbackName = parentCat?.name || 'Прочее'

  let movedProducts = 0
  for (const p of dbRef.products) {
    if (slugsToDelete.has(p.catId)) {
      p.catId = fallbackSlug
      p.cat = fallbackName
      movedProducts += 1
    }
  }

  if (!Array.isArray(dbRef.deletedCategorySlugs)) dbRef.deletedCategorySlugs = []
  for (const slug of slugsToDelete) {
    if (!dbRef.deletedCategorySlugs.includes(slug)) dbRef.deletedCategorySlugs.push(slug)
  }

  dbRef.categories = dbRef.categories.filter(c => !ids.has(Number(c.id)))
  for (const cid of ids) recordSyncDelete(dbRef, 'category', cid)
  return {
    ok: true,
    deleted: [...ids],
    slugs: [...slugsToDelete],
    movedProducts,
  }
}

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

app.post('/promos', async (req, res) => {
  const clientRef = takeClientRef(req)
  const fingerprint = masterCreateFingerprint(
    FIN_OP_KINDS.PROMO_UPSERT,
    fingerprintPromoCreate(req.body),
  )
  if (useDurableMasterCreate(clientRef)) {
    if (replyMasterCreateReplayOrConflict(res, FIN_OP_KINDS.PROMO_UPSERT, clientRef, fingerprint, findOpRefRow)) return
    try {
      const { replay, result: p } = await runDurableMasterCreate(db, {
        clientRef,
        operationKind: FIN_OP_KINDS.PROMO_UPSERT,
        fingerprint,
        mutate: () => mutateCreatePromo(db, req.body, { resolvePromoStockLimitUnit }),
      })
      return finishDurableMasterJson(res, p, replay)
    } catch (e) {
      return respondMasterTxError(res, e, 'Не удалось создать акцию')
    }
  }
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
function orderSignature(order) {
  const items = (order.items || [])
    .map(it => `${it.product_id ?? it.id}:${Number(it.qty) || 0}`)
    .sort()
    .join('|')
  return `${Number(order.total || 0).toFixed(2)}|${items}`
}

/**
 * Двойная отправка формы / повтор запроса после таймаута не должны
 * создавать второй заказ и второй раз списывать склад.
 */
function findDuplicateRecentOrder(db, order) {
  const phone = normalizePhoneDigits(order.client?.phone || '')
  if (!phone) return null
  const cutoff = Date.now() - 30000
  const sig = orderSignature(order)
  return (db.orders || []).find(o => {
    if (normalizePhoneDigits(o.client?.phone || '') !== phone) return false
    const ts = Date.parse(o.createdAtIso || '')
    if (!Number.isFinite(ts) || ts < cutoff) return false
    return orderSignature(o) === sig
  }) || null
}

app.post('/orders', async (req, res) => {
  const body = req.body || {}
  const clientRef = takeClientRef(req)
  const refGate = isPostgresEnabled() ? requireClientRef(clientRef) : { ok: true, clientRef }
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code })
  }
  const otypePreview = inferType({ type: body.type, items: body.items || [] })
  const fingerprint = buildO6Fingerprint(FIN_OP_KINDS.ORDER_CREATE, fingerprintOrderCreate(body, { type: otypePreview }))
  if (useDurableMasterCreate(clientRef)) {
    if (replyMasterCreateReplayOrConflict(res, FIN_OP_KINDS.ORDER_CREATE, clientRef, fingerprint, findOpRefRow)) return
    try {
      const payload = { ...body, clientRef }
      const { replay, result: order } = await runDurableMasterCreate(db, {
        clientRef,
        operationKind: FIN_OP_KINDS.ORDER_CREATE,
        fingerprint,
        mutate: () => mutateCreateOrder(db, payload, o6OrderDeps()),
      })
      if (!replay) {
        const reservedProducts = (order.items || []).map(it => ({ productId: Number(it.product_id ?? it.id) }))
        for (const line of reservedProducts) {
          const p = db.products.find(x => Number(x.id) === Number(line.productId))
          if (p) broadcastProduct(p)
        }
        const bonusSpendReq = Math.max(0, Math.floor(Number(body.bonusSpent) || 0))
        if (bonusSpendReq > 0) {
          const orderClient = findClientByPhone(db, order.client?.phone || '')
          if (orderClient) {
            broadcastLoyalty({ phone: orderClient.phone, bonus: orderClient.bonus, card: orderClient.card || '' })
          }
        }
        broadcast('new_order', order)
      }
      return finishDurableMasterJson(res, order, replay)
    } catch (e) {
      return respondMasterTxError(res, e, 'Не удалось создать заказ')
    }
  }

  const client = body.client || { name: body.client_name, phone: body.client_phone, addr: body.address, lat: body.lat, lng: body.lng }
  const otype = otypePreview
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
  const duplicate = findDuplicateRecentOrder(db, order)
  if (duplicate) return res.json(duplicate)

  const bonusSpendReq = Math.max(0, Math.floor(Number(body.bonusSpent) || 0))
  let reservedProducts = []
  try {
    reservedProducts = reserveOrderStock(db, order)
  } catch (e) {
    return res.status(400).json({ detail: e?.message || 'Недостаточно остатка на складе' })
  }
  if (bonusSpendReq > 0) {
    const spendResult = applyBonusSpendOnOrder(db, order, bonusSpendReq, loyaltyHooks())
    if (!spendResult.ok) {
      releaseOrderStock(db, order, 'Откат: бонусы')
      return res.status(400).json({ detail: spendResult.error || 'Не удалось списать бонусы' })
    }
  }
  const orderClient = findClientByPhone(db, client.phone || '')
  stampOrderForClient(order, orderClient)
  consumePromoStockOnOrder(order)
  db.orders.push(order)
  persist()
  for (const line of reservedProducts) {
    const p = db.products.find(x => Number(x.id) === Number(line.productId))
    if (p) broadcastProduct(p)
  }
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
app.patch('/orders/:id/status', async (req, res) => {
  const clientRef = takeClientRef(req)
  const refGate = isPostgresEnabled() ? requireClientRef(clientRef) : { ok: true, clientRef }
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code })
  }
  const orderId = req.params.id
  const body = { ...(req.body || {}), clientRef }
  const fingerprint = buildOrderStatusFingerprint(orderId, body)
  const productIdsHint = (body.items || [])
    .map(it => Number(it.product_id ?? it.id))
    .filter(n => n > 0)

  if (useDurableMasterCreate(clientRef)) {
    if (replyMasterCreateReplayOrConflict(res, FIN_OP_KINDS.ORDER_STATUS_UPDATE, clientRef, fingerprint, findOpRefRow)) return
    try {
      let committedFx = null
      const { replay, result: updated } = await runDurableMasterCreate(db, {
        clientRef,
        operationKind: FIN_OP_KINDS.ORDER_STATUS_UPDATE,
        fingerprint,
        advisoryLocks: orderResourceAdvisoryLocks(orderId, productIdsHint),
        mutate: () => {
          const out = mutateOrderStatusUpdate(db, orderId, body, o6OrderStatusHooks())
          committedFx = out.fx
          return {
            result: out.result,
            touched: out.touched,
            meta: out.meta,
          }
        },
      })
      if (!replay) afterOrderStatusCommitted(db, committedFx, updated)
      return finishDurableMasterJson(res, updated, replay)
    } catch (e) {
      return respondMasterTxError(res, e, 'Не удалось обновить заказ')
    }
  }

  if (replyIfKnownOp(res, 'order_status_update', clientRef)) return
  try {
    const out = mutateOrderStatusUpdate(db, orderId, body, o6OrderStatusHooks())
    persist()
    afterOrderStatusCommitted(db, out.fx, out.result)
    if (clientRef) rememberKnownOp('order_status_update', clientRef, out.result)
    return res.json(out.result)
  } catch (e) {
    return respondMasterTxError(res, e, 'Не удалось обновить заказ')
  }
})

function removeOrderRecord(orderId) {
  const id = String(orderId)
  const idx = db.orders.findIndex(o => String(o.id) === id)
  if (idx < 0) return { ok: false, status: 404, detail: 'Заказ не найден' }
  const removed = db.orders[idx]
  const phone = removed.client?.phone || ''
  const released = releaseOrderStock(db, removed, 'Удаление заказа', { skipDelivered: true })
  db.orders.splice(idx, 1)
  queueDocDelete('orders', id)
  if (Array.isArray(db.reviews)) {
    db.reviews = db.reviews.filter(r => String(r.orderId) !== id)
  }
  persist()
  for (const line of released) {
    const p = db.products.find(x => Number(x.id) === Number(line.productId))
    if (p) broadcastProduct(p)
  }
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
  const stockTouchedIds = new Set()
  for (const id of ids) {
    const idx = db.orders.findIndex(o => String(o.id) === id)
    if (idx < 0) continue
    const order = db.orders[idx]
    if (order.client?.phone) phones.add(normalizePhoneDigits(order.client.phone))
    const released = releaseOrderStock(db, order, 'Удаление заказа', { skipDelivered: true })
    for (const line of released) stockTouchedIds.add(Number(line.productId))
    db.orders.splice(idx, 1)
    queueDocDelete('orders', id)
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
  for (const pid of stockTouchedIds) {
    const p = db.products.find(x => Number(x.id) === pid)
    if (p) broadcastProduct(p)
  }
  if (stockTouchedIds.size) broadcastPosUpdate({ reason: 'order-stock' })
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
app.delete('/restaurants/:id', (req, res) => {
  const id = String(req.params.id || '').trim()
  const idx = (db.restaurants || []).findIndex(x => x.id === id)
  if (idx < 0) return res.status(404).json({ detail: 'Ресторан не найден' })
  const removed = db.restaurants[idx]
  db.restaurants.splice(idx, 1)
  // Убрать точку забора ресторана, если есть
  const REST_PICKUP_MAP = { 'R-01': 'rest1', 'R-02': 'rest2', 'R-03': 'rest3', 'R-04': 'rest4' }
  const pickupId = REST_PICKUP_MAP[id] || `rest${String(id).replace(/^R-0?/, '')}`
  if (Array.isArray(db.pickups)) {
    db.pickups = db.pickups.filter(p => String(p.id) !== String(pickupId) && String(p.restId || '') !== id)
  }
  auditFromReq(db, req, {
    action: 'delete',
    entity: 'restaurant',
    entityId: id,
    entityName: removed.name || id,
    summary: `Удалён ресторан «${removed.name || id}»`,
    before: { id, name: removed.name, phone: removed.phone },
  })
  persist()
  broadcast('restaurant_deleted', { id })
  res.json({ ok: true, id })
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
  if (!db.courierWalletTx) db.courierWalletTx = []
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const n = nextCourierSeq(db)
  const id = `C-${String(n).padStart(2, '0')}`
  const account = normalizeCourierAccount(`KUR-${String(n).padStart(4, '0')}`, id)
  const row = normalizeCourierRow({
    ...body,
    id,
    account,
    rating: 5,
    orders: 0,
    today: 0,
    week: 0,
    status: body.status === 'available' || body.status === 'busy' ? body.status : 'offline',
    balance: 0,
    blocked: !!body.blocked,
    createdAt: new Date().toISOString(),
  })
  purgeCourierWalletTx(db, row.id)
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
app.delete('/couriers/:id', (req, res) => {
  const id = String(req.params.id || '').trim()
  const idx = (db.couriers || []).findIndex(x => x.id === id)
  if (idx < 0) return res.status(404).json({ detail: 'Курьер не найден' })
  const removed = db.couriers[idx]
  db.couriers.splice(idx, 1)
  purgeCourierWalletTx(db, id)
  auditFromReq(db, req, {
    action: 'delete',
    entity: 'courier',
    entityId: id,
    entityName: removed.name || id,
    summary: `Удалён курьер «${removed.name || id}»`,
    before: { id, name: removed.name, phone: removed.phone },
  })
  persist()
  res.json({ ok: true, id })
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
app.delete('/assemblers/:id', (req, res) => {
  const id = String(req.params.id || '').trim()
  const idx = (db.assemblers || []).findIndex(x => x.id === id)
  if (idx < 0) return res.status(404).json({ detail: 'Сборщик не найден' })
  const removed = db.assemblers[idx]
  db.assemblers.splice(idx, 1)
  auditFromReq(db, req, {
    action: 'delete',
    entity: 'assembler',
    entityId: id,
    entityName: removed.name || id,
    summary: `Удалён сборщик «${removed.name || id}»`,
    before: { id, name: removed.name, phone: removed.phone },
  })
  persist()
  res.json({ ok: true, id })
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
/** Для экрана входа в Торговлю — только id + name */
app.get('/employees/directory', (_req, res) => {
  res.json(listEmployeesDirectory(db))
})
/** Для локальной кассы (офлайн): сотрудники с хешами — только привязанное устройство */
app.get('/employees/local-auth', (req, res) => {
  const deviceId = readTradeDeviceId(req)
  const check = checkPosDevice(db, deviceId)
  if (!check.ok) {
    return res.status(403).json({ detail: 'Устройство не привязано' })
  }
  res.json(listEmployeesLocalAuth(db))
})
app.post('/employees', async (req, res) => {
  try {
    const clientRef = takeClientRef(req)
    const fingerprint = masterCreateFingerprint(
      FIN_OP_KINDS.EMPLOYEE_UPSERT,
      fingerprintEmployeeCreate(req.body || {}),
    )
    if (useDurableMasterCreate(clientRef)) {
      if (replyMasterCreateReplayOrConflict(res, FIN_OP_KINDS.EMPLOYEE_UPSERT, clientRef, fingerprint, findOpRefRow)) return
      try {
        const { replay, result: row } = await runDurableMasterCreate(db, {
          clientRef,
          operationKind: FIN_OP_KINDS.EMPLOYEE_UPSERT,
          fingerprint,
          mutate: () => mutateCreateEmployee(db, req.body || {}),
        })
        if (!replay) {
          auditFromReq(db, req, {
            action: 'create',
            entity: 'employee',
            entityId: row.id,
            entityName: row.name,
            summary: `Создан сотрудник «${row.name}» · ${row.role || row.roleLabel || ''}`,
            after: { name: row.name, role: row.role, active: row.active },
          })
        }
        return finishDurableMasterJson(res, row, replay)
      } catch (e) {
        return respondMasterTxError(res, e, 'Не удалось создать сотрудника')
      }
    }
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
function readTradeDeviceId(req) {
  const fromBody = String(req.body?.deviceId || '').trim()
  if (fromBody) return fromBody
  const fromQuery = String(req.query?.deviceId || '').trim()
  if (fromQuery) return fromQuery
  let header = String(req.headers['x-kakapo-device-id'] || '').trim()
  if (!header) return ''
  try { header = decodeURIComponent(header) } catch { /* keep */ }
  return header.trim()
}

app.post('/employees/login', (req, res) => {
  try {
    const ip = clientIp(req)
    const rl = rateLimitCheck(`emp-login:${ip}`, { windowMs: 60_000, max: 20, blockMs: 120_000 })
    if (!rl.ok) return res.status(rl.status).json({ detail: rl.detail, code: rl.code })
    const deviceId = readTradeDeviceId(req)
    if (!checkPosDevice(db, deviceId).ok) {
      return res.status(403).json({ detail: 'Устройство не привязано' })
    }
    const row = loginEmployee(db, req.body || {})
    rateLimitReset(`emp-login:${ip}`)
    const session = createSession({
      principal: row.role === 'cashier' ? 'CASHIER' : 'STAFF',
      subjectId: String(row.id),
      name: row.name,
      roles: [String(row.role || 'staff')],
      permissions: Array.isArray(row.permissions) ? row.permissions : [],
      deviceId,
    })
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
    const { _passwordMigrated, ...safe } = row
    res.json({
      ...safe,
      token: session.token,
      access_token: session.token,
    })
  } catch (e) {
    res.status(401).json({ detail: e?.message || 'Ошибка входа' })
  }
})

app.get('/pos/points', (_req, res) => {
  res.json(listPosPoints(db))
})
app.post('/pos/points', async (req, res) => {
  try {
    const clientRef = takeClientRef(req)
    const refGate = isPostgresEnabled() ? requireClientRef(clientRef) : { ok: true, clientRef }
    if (!refGate.ok) {
      return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code })
    }
    const fingerprint = buildO6Fingerprint(FIN_OP_KINDS.POS_POINT_UPSERT, fingerprintPosPointCreate(req.body || {}))
    if (useDurableMasterCreate(clientRef)) {
      if (replyMasterCreateReplayOrConflict(res, FIN_OP_KINDS.POS_POINT_UPSERT, clientRef, fingerprint, findOpRefRow)) return
      const { replay, result: row } = await runDurableMasterCreate(db, {
        clientRef,
        operationKind: FIN_OP_KINDS.POS_POINT_UPSERT,
        fingerprint,
        mutate: () => mutateCreatePosPoint(db, req.body || {}),
      })
      if (!replay) broadcastPosUpdate({ kind: 'pos', id: row.id })
      return finishDurableMasterJson(res, row, replay)
    }
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

app.post('/pos/points/:id/pair-code', (req, res) => {
  try {
    const row = createPosPairCode(db, req.params.id)
    persist()
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось выдать код' })
  }
})

app.delete('/pos/points/:id/devices/:deviceId', (req, res) => {
  try {
    const deviceId = String(req.params.deviceId || '').trim()
    const row = unbindPosDevice(db, req.params.id, deviceId)
    persist()
    broadcastPosUpdate({ kind: 'device-unbind', id: row.id, posId: row.id, deviceId })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось отвязать устройство' })
  }
})

app.patch('/pos/points/:id/devices/:deviceId', (req, res) => {
  try {
    const body = req.body || {}
    const row = body.revisionParticipationDefault != null
      ? updatePosDevice(db, req.params.id, req.params.deviceId, body)
      : renamePosDevice(db, req.params.id, req.params.deviceId, body.name)
    persist()
    broadcastPosUpdate({ kind: 'pos', id: row.id })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось обновить устройство' })
  }
})

app.post('/pos/devices/heartbeat', (req, res) => {
  try {
    const row = revisionCoordinator.recordDeviceHeartbeat(db, req.body || {})
    persist()
    runRevisionCoordinator()
    res.json({ ok: true, device: row })
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Heartbeat не принят' })
  }
})

app.get('/pos/devices/status', (_req, res) => {
  try {
    res.json(revisionCoordinator.listDeviceStatuses(db))
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось получить статус устройств' })
  }
})

app.post('/pos/devices/bind', async (req, res) => {
  try {
    const clientRef = takeClientRef(req)
    const refGate = isPostgresEnabled() ? requireClientRef(clientRef) : { ok: true, clientRef }
    if (!refGate.ok) {
      return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code })
    }
    const body = req.body || {}
    const fingerprint = buildO6Fingerprint(FIN_OP_KINDS.DEVICE_BIND, fingerprintDeviceBind(body))
    const deviceId = String(body.deviceId || '').trim()
    if (useDurableMasterCreate(clientRef)) {
      if (replyMasterCreateReplayOrConflict(res, FIN_OP_KINDS.DEVICE_BIND, clientRef, fingerprint, findOpRefRow)) return
      const { replay, result: row } = await runDurableMasterCreate(db, {
        clientRef,
        operationKind: FIN_OP_KINDS.DEVICE_BIND,
        fingerprint,
        advisoryLocks: deviceId ? [{ ns: 'pos_device', key: deviceId }] : [],
        mutate: () => mutateBindDevice(db, body),
      })
      if (!replay && row?.point?.id) broadcastPosUpdate({ kind: 'pos', id: row.point.id })
      return finishDurableMasterJson(res, row, replay)
    }
    const row = bindPosDevice(db, body)
    persist()
    if (row?.point?.id) broadcastPosUpdate({ kind: 'pos', id: row.point.id })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось привязать устройство' })
  }
})

app.get('/pos/devices/check', (req, res) => {
  try {
    res.json(checkPosDevice(db, String(req.query.deviceId || '')))
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Проверка устройства не удалась' })
  }
})

app.get('/pos/shifts', (_req, res) => {
  res.json(listPosShifts(db))
})
app.post('/pos/shifts/open', (req, res) => {
  void handleO8ShiftOpen(req, res, o8HandlerCtx())
})
app.patch('/pos/shifts/:id/close', (req, res) => {
  void handleO8ShiftClose(req, res, o8HandlerCtx())
})

app.get('/pos/sales', (req, res) => {
  if (ensurePosSaleNumbers(db)) persist()
  const q = {
    from: req.query.from || null,
    to: req.query.to || null,
    limit: req.query.limit != null ? req.query.limit : null,
    offset: req.query.offset != null ? req.query.offset : 0,
  }
  res.json(listPosSales(db, q))
})
app.post('/pos/sales', (req, res) => {
  void handleO8PosSaleCreate(req, res, o8HandlerCtx())
})
app.post('/pos/sales/:id/return', (req, res) => {
  void handleO8SaleReturn(req, res, o8HandlerCtx())
})

app.get('/stock/receipts', (_req, res) => {
  res.json(listStockReceipts(db))
})
app.post('/stock/receipts', (req, res) => {
  void handleO8StockReceiptCreate(req, res, o8HandlerCtx())
})
app.put('/stock/receipts/:id', (req, res) => {
  void handleO8StockReceiptUpdate(req, res, o8HandlerCtx())
})
app.delete('/stock/receipts/:id', (req, res) => {
  void handleO8StockReceiptDelete(req, res, o8HandlerCtx())
})
app.get('/stock/writeoffs', (_req, res) => {
  res.json(listStockWriteoffs(db))
})
app.post('/stock/adjustments', (req, res) => {
  void handleO8StockAdjustment(req, res, o8HandlerCtx())
})
app.post('/stock/writeoffs', (req, res) => {
  void handleO8WriteoffCreate(req, res, o8HandlerCtx())
})
app.put('/stock/writeoffs/:id', (req, res) => {
  void handleO8WriteoffUpdate(req, res, o8HandlerCtx())
})
app.delete('/stock/writeoffs/:id', (req, res) => {
  void handleO8WriteoffDelete(req, res, o8HandlerCtx())
})
app.get('/stock/revisions', (_req, res) => {
  res.json(listStockRevisions(db))
})
app.get('/stock/revisions/queue', (_req, res) => {
  try {
    res.json(revisionCoordinator.listRevisionQueue(db))
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось получить очередь' })
  }
})
app.post('/stock/revisions', (req, res) => {
  try {
    const clientRef = takeClientRef(req)
    if (replyIfKnownOp(res, 'stock_revision_create', clientRef)) return
    const row = createStockRevision(db, req.body || {})
    if (clientRef) { row.clientRef = clientRef; rememberKnownOp('stock_revision_create', clientRef, row) }
    auditFromReq(db, req, {
      action: 'create',
      entity: 'stock',
      entityId: row.id,
      entityName: row.note || row.id,
      summary: `Ревизия склада · ${row.note || row.id}`,
    })
    persist()
    runRevisionCoordinator()
    broadcastPosUpdate({ kind: 'revision', id: row.id })
    broadcastProduct({ reason: 'revision' })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось сохранить ревизию' })
  }
})
app.put('/stock/revisions/:id', (req, res) => {
  try {
    const clientRef = takeClientRef(req)
    if (replyIfKnownOp(res, 'stock_revision_update', clientRef)) return
    const row = updateStockRevision(db, req.params.id, req.body || {})
    if (clientRef) rememberKnownOp('stock_revision_update', clientRef, row)
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
app.patch('/stock/revisions/:id/cancel', (req, res) => {
  try {
    const row = revisionCoordinator.cancelStockRevision(db, req.params.id)
    auditFromReq(db, req, {
      action: 'update',
      entity: 'stock',
      entityId: row.id,
      entityName: row.note || row.id,
      summary: `Отменена ревизия · ${row.note || row.id}`,
    })
    persist()
    runRevisionCoordinator()
    broadcastPosUpdate({ kind: 'revision', id: row.id, cancelled: true })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось отменить ревизию' })
  }
})
app.delete('/stock/revisions/:id', (req, res) => {
  try {
    const clientRef = takeClientRef(req)
    if (replyIfKnownOp(res, 'stock_revision_delete', clientRef)) return
    const row = deleteStockRevision(db, req.params.id)
    if (clientRef) rememberKnownOp('stock_revision_delete', clientRef, row)
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
app.post('/suppliers', async (req, res) => {
  try {
    const clientRef = takeClientRef(req)
    const fingerprint = masterCreateFingerprint(
      FIN_OP_KINDS.SUPPLIER_UPSERT,
      fingerprintSupplierCreate(req.body || {}),
    )
    if (useDurableMasterCreate(clientRef)) {
      if (replyMasterCreateReplayOrConflict(res, FIN_OP_KINDS.SUPPLIER_UPSERT, clientRef, fingerprint, findOpRefRow)) return
      try {
        const { replay, result: row } = await runDurableMasterCreate(db, {
          clientRef,
          operationKind: FIN_OP_KINDS.SUPPLIER_UPSERT,
          fingerprint,
          mutate: () => mutateCreateSupplier(db, { ...(req.body || {}), clientRef }),
        })
        if (!replay) broadcastPosUpdate({ kind: 'supplier', id: row.id })
        return finishDurableMasterJson(res, row, replay)
      } catch (e) {
        return respondMasterTxError(res, e, 'Не удалось создать поставщика')
      }
    }
    if (replyIfKnownOp(res, 'supplier_upsert', clientRef)) return
    const row = createSupplier(db, req.body || {})
    if (clientRef) { row.clientRef = clientRef; rememberKnownOp('supplier_upsert', clientRef, row) }
    persist()
    broadcastPosUpdate({ kind: 'supplier', id: row.id })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось создать поставщика' })
  }
})
app.patch('/suppliers/:id', (req, res) => {
  try {
    const clientRef = takeClientRef(req)
    if (replyIfKnownOp(res, 'supplier_upsert', clientRef)) return
    const row = updateSupplier(db, req.params.id, req.body || {})
    if (clientRef) rememberKnownOp('supplier_upsert', clientRef, row)
    persist()
    broadcastPosUpdate({ kind: 'supplier', id: row.id })
    res.json(row)
  } catch (e) {
    res.status(400).json({ detail: e?.message || 'Не удалось обновить поставщика' })
  }
})
app.delete('/suppliers/:id', (req, res) => {
  try {
    const clientRef = takeClientRef(req)
    if (replyIfKnownOp(res, 'supplier_delete', clientRef)) return
    const row = deleteSupplier(db, req.params.id)
    if (clientRef) rememberKnownOp('supplier_delete', clientRef, row)
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
  void handleO8SupplierBookPayment(req, res, o8HandlerCtx())
})
app.delete('/suppliers/:id/payments/:paymentId', (req, res) => {
  void handleO8SupplierPaymentDelete(req, res, o8HandlerCtx())
})

app.get('/expenses', (_req, res) => {
  res.json(listExpenses(db))
})
app.post('/expenses', (req, res) => {
  void handleO8ExpenseCreate(req, res, o8HandlerCtx())
})
app.delete('/expenses/:id', (req, res) => {
  void handleO8ExpenseDelete(req, res, o8HandlerCtx())
})

app.get('/finance/moves', (_req, res) => {
  res.json(listFinanceMoves(db))
})
app.post('/finance/moves', (req, res) => {
  void handleO8FinanceMoveCreate(req, res, o8HandlerCtx())
})
app.delete('/finance/moves/:id', (req, res) => {
  void handleO8FinanceMoveDelete(req, res, o8HandlerCtx())
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
app.get('/finance/vault', (_req, res) => {
  res.json(getCashVault(db))
})
app.post('/finance/vault/card-to-cash', (req, res) => {
  void handleO8VaultCardToCash(req, res, o8HandlerCtx())
})
app.post('/finance/vault/cash-to-card', (req, res) => {
  void handleO8VaultCashToCard(req, res, o8HandlerCtx())
})
app.get('/finance/cashbox', (req, res) => {
  res.json(getCashBoxSnapshot(db, financeTruthQuery(req)))
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
    docVersion: Math.max(1, Number(raw.docVersion) || 1),
    updatedAtIso: raw.updatedAtIso || new Date().toISOString(),
  }
}

app.get('/clients', (_req, res) => {
  runAccountLifecycleMaintenance()
  reconcileDeletedPhonesWithClients()
  runLoyaltyMaintenance()
  runDebtMaintenanceAndNotify()
  res.json(listVisibleClients())
})
app.post('/clients', async (req, res) => {
  if (!db.clients) db.clients = []
  const clientRef = takeClientRef(req)
  const refGate = isPostgresEnabled() ? requireClientRef(clientRef) : { ok: true, clientRef }
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code })
  }
  const fingerprint = buildO6Fingerprint(CRM_OP_KINDS.CLIENT_UPSERT, fingerprintClientCreate(req.body))
  const digits = normalizePhoneDigits(req.body?.phone || '')
  if (useDurableMasterCreate(clientRef)) {
    if (replyMasterCreateReplayOrConflict(res, CRM_OP_KINDS.CLIENT_UPSERT, clientRef, fingerprint, findOpRefRow)) return
    try {
      const { replay, result: row } = await runDurableMasterCreate(db, {
        clientRef,
        operationKind: CRM_OP_KINDS.CLIENT_UPSERT,
        fingerprint,
        advisoryLocks: digits ? [{ ns: 'crm_client_phone', key: digits }] : [],
        mutate: () => mutateCreateClient(db, req.body, clientRef, o6ClientDeps()),
      })
      if (!replay) notifyCrmChange(row)
      return finishDurableMasterJson(res, row, replay)
    } catch (e) {
      return respondMasterTxError(res, e, 'Не удалось создать клиента')
    }
  }
  if (replyIfKnownOp(res, 'client_upsert', clientRef)) return
  runAccountLifecycleMaintenance()

  const phone = req.body?.phone || ''
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
  if (clientRef) { row.clientRef = clientRef; rememberKnownOp('client_upsert', clientRef, row) }
  persist()
  notifyCrmChange(row)
  res.json(row)
})
app.patch('/clients/:id', (req, res) => {
  const body = req.body || {}
  if (body.card != null && String(body.card).trim()) {
    return void handleO8ClientCardLink(req, res, o8HandlerCtx())
  }
  const clientRef = takeClientRef(req)
  if (replyIfKnownOp(res, 'client_upsert', clientRef)) return
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
    broadcastPosUpdate({ kind: 'crm', id: c.id, deleted: true })
    return res.json({ ok: true })
  }
  const beforeSnap = {
    name: c.name, phone: c.phone, vip: !!c.vip, level: c.level,
    debt: c.debt, bonus: c.bonus, debtEnabled: c.debtEnabled, blocked: c.blocked,
  }
  const { purge, allowBonusDecrease, ...patch } = req.body || {}
  const expectedDoc = patch.expectedDocVersion
  delete patch.expectedDocVersion
  // Never accept absolute debtLedger blobs from Desktop — prevents cross-client ledger adoption.
  delete patch.debtLedger
  delete patch.debtOverdueStrikes
  delete patch.debtCreditBlocked
  if (expectedDoc != null && expectedDoc !== '') {
    const cur = Number(c.docVersion) || 0
    const exp = Number(expectedDoc)
    if (Number.isFinite(exp) && exp !== cur) {
      return res.status(409).json({
        detail: `Клиента уже меняли (версия ${cur}, ожидали ${exp})`,
        code: 'CLIENT_DOC_VERSION_CONFLICT',
      })
    }
  }
  // Reject silent card steal: existing owned card cannot be reassigned via client.card patch.
  if (patch.card != null && String(patch.card).trim()) {
    const targetCard = findCardByNum(patch.card)
    if (targetCard) {
      try {
        assertCardAssignableToClient(db, targetCard, { ...c, ...patch, id: c.id })
      } catch (e) {
        if (e instanceof CardOwnershipConflict) {
          return res.status(409).json({ detail: e.message, code: e.code, conflict: e.details })
        }
        throw e
      }
    }
  }
  // Reject pointing this client at a card while another client already canonical-owns it by client.card
  if (patch.card != null && String(patch.card).trim()) {
    const want = String(patch.card).trim().toUpperCase()
    const other = (db.clients || []).find(x =>
      x.id !== c.id
      && String(x.card || '').trim().toUpperCase() === want,
    )
    if (other) {
      return res.status(409).json({
        detail: `Карта ${want} уже указана у клиента ${other.id}`,
        code: 'CLIENT_CARD_ALREADY_BOUND',
        conflict: { cardNum: want, ownerClientId: other.id, attemptedClientId: c.id },
      })
    }
  }
  // Долг НЕ присваиваем напрямую — проводим через единую логику (ledger + лимит + карта).
  const debtRequested = patch.debt != null ? Number(patch.debt) || 0 : null
  const debtNoteReq = patch.debtNote
  if (debtRequested != null) {
    return res.status(400).json({
      detail: 'Изменение долга только через POST /clients/:id/debt-adjustments',
      code: 'DEBT_REQUIRES_ADJUSTMENT_OPERATION',
    })
  }
  delete patch.debt
  delete patch.debtNote
  delete patch.docVersion
  if (patch.debtEnabled === false && (Number(c.debt) || 0) > 0.001) {
    const nextDebtProbe = debtRequested != null ? debtRequested : Number(c.debt) || 0
    if (nextDebtProbe > 0.001) {
      patch.debtEnabled = true
    } else {
      return res.status(409).json({ detail: 'Нельзя выключить раздел долга, пока есть непогашенный долг' })
    }
  }
  if (patch.bonus != null) {
    return res.status(400).json({
      detail: 'Изменение бонусов только через POST /cards/:num/bonus-adjustments',
      code: 'BONUS_REQUIRES_ADJUSTMENT_OPERATION',
    })
  }
  const bonusManuallySet = false
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
  c.docVersion = (Number(c.docVersion) || 0) + 1
  c.updatedAtIso = new Date().toISOString()
  if (c.card) {
    ensureCardRowForClient(c)
    unlinkNonCanonicalSiblingCards(db, c, c.card, normalizeCardRow)
  } else {
    syncCardIdentityFromClient(c)
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
  if (clientRef) rememberKnownOp('client_upsert', clientRef, c)
  persist()
  notifyCrmChange(c)
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
  recordSyncDelete(db, 'client', client.id)
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
  const clientRef = takeClientRef(req)
  if (replyIfKnownOp(res, 'client_delete', clientRef)) return
  const client = db.clients.find(x => x.id === req.params.id)
  if (!client) {
    const digits = normalizePhoneDigits(req.body?.phone || '')
    if (digits) rememberDeletedPhone(digits)
    const result = { ok: true }
    if (clientRef) rememberKnownOp('client_delete', clientRef, result)
    return res.json(result)
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
  const result = { ok: true }
  if (clientRef) rememberKnownOp('client_delete', clientRef, result)
  res.json(result)
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
  broadcastPosUpdate({ kind: 'crm', id: client.id, deleted: true, phone: client.phone })
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
    // password never stored here in durable form after O8B — passwordHash on users[]
  },
}

function findAdminUser() {
  if (!Array.isArray(db.users)) db.users = []
  return db.users.find(u => u.role === 'admin') || null
}

/** Mirror login only into settings.admin.auth (never password/plaintext). */
function syncAdminAuthMirror(admin) {
  const a = ensureAdminSettings()
  a.auth = {
    login: String(admin?.login || a.auth?.login || 'admin').trim() || 'admin',
  }
  return a.auth
}

function applyAdminAuth({ login, password }) {
  const nextLogin = String(login || 'admin').trim() || 'admin'
  if (!Array.isArray(db.users)) db.users = []
  let admin = findAdminUser()
  if (!admin) {
    const maxId = db.users.reduce((m, u) => Math.max(m, Number(u.id) || 0), 0)
    admin = {
      id: maxId + 1,
      email: nextLogin.includes('@') ? nextLogin : `${nextLogin}@kakapo.tj`,
      login: nextLogin,
      role: 'admin',
      name: 'Админ КАКАПО',
    }
    db.users.push(admin)
  } else {
    admin.login = nextLogin
    admin.email = nextLogin.includes('@') ? nextLogin : `${nextLogin}@kakapo.tj`
    if (!admin.name) admin.name = 'Админ КАКАПО'
  }
  if (password != null && String(password).length > 0) {
    setPasswordOnRow(admin, String(password))
  }
  return syncAdminAuthMirror(admin)
}

function ensureAdminAuth() {
  const a = ensureAdminSettings()
  if (!a.auth || typeof a.auth !== 'object') {
    a.auth = { login: DEFAULT_ADMIN_SETTINGS.auth.login }
  }
  if (!a.auth.login) a.auth.login = DEFAULT_ADMIN_SETTINGS.auth.login
  // Strip any legacy plaintext from settings mirror
  if (Object.prototype.hasOwnProperty.call(a.auth, 'password')) {
    delete a.auth.password
  }
  if (Object.prototype.hasOwnProperty.call(a.auth, 'passwordHash')) {
    delete a.auth.passwordHash
  }

  if (!Array.isArray(db.users)) db.users = []
  let admin = findAdminUser()
  const envPass = String(process.env.KAKAPO_ADMIN_PASSWORD || '').trim()
  const labDefault = isProductionRuntime() ? '' : 'admin123'

  if (!admin) {
    const bootstrap = envPass || labDefault
    if (!bootstrap) {
      throw new Error('Admin credential missing: set KAKAPO_ADMIN_PASSWORD')
    }
    return applyAdminAuth({ login: a.auth.login || 'admin', password: bootstrap })
  }

  if (!admin.login) {
    const email = String(admin.email || '').toLowerCase()
    admin.login = email === 'admin@kakapo.tj' ? 'admin' : (String(admin.email || 'admin').trim() || 'admin')
  }

  // Prefer auth.login from user row
  a.auth.login = String(admin.login).trim() || a.auth.login

  // Bootstrap hash if neither hash nor legacy plaintext exists
  if (!admin.passwordHash && (admin.password == null || String(admin.password) === '')) {
    const bootstrap = envPass || labDefault
    if (!bootstrap) {
      throw new Error('Admin credential missing: set KAKAPO_ADMIN_PASSWORD')
    }
    setPasswordOnRow(admin, bootstrap)
  }

  // Production must not keep hardcoded demo password without env override
  if (isProductionRuntime() && !envPass) {
    // If only legacy plaintext equals demoword — refuse until env set / rotated
    if (!admin.passwordHash && String(admin.password || '') === 'admin123') {
      throw new Error('Production refuses default admin123 — set KAKAPO_ADMIN_PASSWORD')
    }
  }

  return syncAdminAuthMirror(admin)
}

function ensureAdminSettings() {
  if (!db.settings) db.settings = {}
  if (!db.settings.admin) {
    db.settings.admin = structuredClone(DEFAULT_ADMIN_SETTINGS)
  }
  const a = db.settings.admin
  if (a.gbs) delete a.gbs
  if (!a.sms) a.sms = { ...DEFAULT_ADMIN_SETTINGS.sms }
  if (!a.store) a.store = { ...DEFAULT_ADMIN_SETTINGS.store }
  if (!a.auth) a.auth = { login: DEFAULT_ADMIN_SETTINGS.auth.login }
  if (a.auth && Object.prototype.hasOwnProperty.call(a.auth, 'password')) {
    delete a.auth.password
  }
  return a
}

app.get('/settings/admin', (_req, res) => {
  ensureAdminAuth()
  const a = ensureAdminSettings()
  res.json({
    sms: a.sms,
    store: a.store,
    auth: { login: a.auth?.login || 'admin' },
  })
})

/** Публичные контакты для клиентского приложения (долги, FAQ, «О нас») */
app.get('/settings/store', (_req, res) => {
  const a = ensureAdminSettings()
  res.json({ ...(a.store || DEFAULT_ADMIN_SETTINGS.store) })
})

app.patch('/settings/admin', (req, res) => {
  const current = ensureAdminSettings()
  const body = req.body || {}
  db.settings.admin = {
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
    summary: 'Изменены настройки магазина / SMS',
  })
  persist()
  const a = db.settings.admin
  res.json({
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
    debtPayVersion: Math.max(0, Number(raw.debtPayVersion) || 0),
    bonusPayVersion: Math.max(0, Number(raw.bonusPayVersion) || 0),
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
    updatedAtIso: raw.updatedAtIso || undefined,
    serverAtIso: raw.serverAtIso || undefined,
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
    debt: Number(client.debt) || 0,
    debtLimit: Number(client.debtLimit) || 0,
    vip: !!client.vip,
    debtEnabled: !!client.debtEnabled || (Number(client.debt) || 0) > 0,
    issued,
  })
  db.cards.push(card)
  client.card = num
  unlinkNonCanonicalSiblingCards(db, client, num, normalizeCardRow)
  syncDebtLedgerToCard(client, card, { syncDebtBalance: true })
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

function isPlaceholderClientName(name) {
  const t = String(name || '').trim()
  return !t || t === 'Клиент'
}

function syncCardIdentityFromClient(client) {
  if (!client) return
  let card = client.card ? findCardByNum(client.card) : null
  if (!card) {
    card = (db.cards || []).find(x => x.clientId === client.id && x.status !== 'unlinked')
  }
  if (!card || card.status === 'unlinked') return
  try {
    assertCardAssignableToClient(db, card, client)
  } catch (e) {
    if (e instanceof CardOwnershipConflict) {
      // Do not steal another customer's card; clear stale client.card pointer.
      if (client.card && String(client.card).toUpperCase() === String(card.num).toUpperCase()) {
        client.card = ''
      }
      return
    }
    throw e
  }
  bindCardToClient(card, client)
  if (client.blocked) card.status = 'blocked'
  else if (card.status === 'blocked') card.status = 'active'
}

/** Создать строку карты, если клиент ссылается на номер, которого нет в db.cards */
function ensureCardRowForClient(client) {
  if (!client) return null
  if (!client.card) return issueCardForNewClient(client)
  let card = findCardByNum(client.card)
  if (card) {
    try {
      assertCardAssignableToClient(db, card, client)
    } catch (e) {
      if (e instanceof CardOwnershipConflict) {
        // Issue a fresh card instead of stealing an owned number.
        return issueCardForNewClient(client)
      }
      throw e
    }
    if (client.id && !card.clientId) card.clientId = client.id
    if (client.phone && !card.phone) card.phone = client.phone
    if (client.name && !card.client) card.client = client.name
    if (card.status === 'unlinked') {
      // Reactivate only if assignable (asserted above) and empty/same person
      card.status = client.blocked ? 'blocked' : 'active'
      card.clientId = client.id
      card.phone = client.phone || card.phone
      card.client = client.name || card.client
      card.bonus = Number(client.bonus) || 0
      if (!(Number(card.debt) > 0.001)) {
        card.debt = Number(client.debt) || 0
        card.debtLimit = Number(client.debtLimit) || 0
        syncDebtLedgerToCard(client, card, { syncDebtBalance: true })
      }
    } else {
      bindCardToClient(card, client)
    }
    unlinkNonCanonicalSiblingCards(db, client, card.num, normalizeCardRow)
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
  unlinkNonCanonicalSiblingCards(db, client, card.num, normalizeCardRow)
  syncDebtLedgerToCard(client, card, { syncDebtBalance: true })
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
  // Prefer stable clientId ownership; never auto-merge two people by card text alone.
  let client = card.clientId
    ? db.clients.find(c => String(c.id) === String(card.clientId))
    : null
  if (!client && phone) {
    const byPhone = db.clients.find(c => normalizePhoneDigits(c.phone) === normalizePhoneDigits(phone))
    if (byPhone) {
      // Phone match is allowed only when card has no foreign clientId.
      const ownerId = String(card.clientId || '')
      if (!ownerId || ownerId === String(byPhone.id)) client = byPhone
    }
  }
  if (!client && card.status === 'active' && phone) {
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
  try {
    assertCardAssignableToClient(db, card, client)
  } catch (e) {
    if (e instanceof CardOwnershipConflict) return
    throw e
  }
  // Hard stop: never adopt another client's card pointer / debtLedger.
  const ownerId = String(card.clientId || '')
  const cid = String(client.id || '')
  if (ownerId && cid && ownerId !== cid) return

  client.card = card.num
  unlinkNonCanonicalSiblingCards(db, client, card.num, normalizeCardRow)
  const cardName = String(card.client || '').trim()
  const clientName = String(client.name || '').trim()
  // Имя принадлежит клиенту. Карта — копия. Не затираем реальное ФИО старым именем на карте.
  // Never propagate card display name onto a different real person.
  if (isPlaceholderClientName(clientName) && !isPlaceholderClientName(cardName)) {
    client.name = cardName
  }
  client.level = cardLevelToBasic(card.level)
  {
    const cardBonus = Math.round((Number(card.bonus) || 0) * 100) / 100
    const clientBonus = Math.round((Number(client.bonus) || 0) * 100) / 100
    // ONLINE-O4C: client.bonus is canonical; active card mirrors client (never wipe on rebind).
    if (cardBonus + 0.001 < clientBonus) card.bonus = clientBonus
    else client.bonus = cardBonus
  }
  client.wallet = Math.max(0, Math.round((Number(card.wallet) || 0) * 100) / 100)
  // Debt/ledger only when card.clientId matches this client (no cross-client adoption)
  if (!ownerId || ownerId === cid) {
    client.debt = Number(card.debt) || 0
    client.debtLimit = Number(card.debtLimit) || 0
    syncDebtLedgerFromCard(card, client)
  }
  client.vip = !!card.vip
  // Блок — поле клиента. Карта копирует его при PATCH клиента, не наоборот.
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
  if (card.updatedAtIso) {
    client.updatedAtIso = card.updatedAtIso
    client.serverAtIso = card.serverAtIso || card.updatedAtIso
  }
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

app.post('/cards/ensure', async (req, res) => {
  const body = req.body || {}
  const clientRef = takeClientRef(req)
  const refGate = isPostgresEnabled() ? requireClientRef(clientRef) : { ok: true, clientRef }
  if (!refGate.ok) {
    return res.status(refGate.status).json({ detail: refGate.detail, code: refGate.code })
  }
  const num = String(body.num || '').toUpperCase()
  if (!num) return res.status(400).json({ detail: 'Укажите номер карты' })
  const fingerprint = buildO6Fingerprint(CRM_OP_KINDS.CARD_ENSURE, fingerprintCardEnsure(body))
  if (useDurableMasterCreate(clientRef)) {
    if (replyMasterCreateReplayOrConflict(res, CRM_OP_KINDS.CARD_ENSURE, clientRef, fingerprint, findOpRefRow)) return
    try {
      const { replay, result: card } = await runDurableMasterCreate(db, {
        clientRef,
        operationKind: CRM_OP_KINDS.CARD_ENSURE,
        fingerprint,
        mutate: () => mutateEnsureCard(db, body, o6CardDeps()),
      })
      return finishDurableMasterJson(res, card, replay)
    } catch (e) {
      return respondMasterTxError(res, e, 'Не удалось сохранить карту')
    }
  }
  let card = findCardByNum(num)
  const client = body.clientId
    ? (db.clients || []).find(c => c.id === body.clientId)
    : (db.clients || []).find(c => {
      if (!c.card) return false
      const digits = String(c.card).replace(/\D/g, '')
      return c.card.toUpperCase() === num || digits === num.replace(/\D/g, '')
    })
  if (card) {
    const attempted = client || (body.phone
      ? (db.clients || []).find(c => normalizePhoneDigits(c.phone) === normalizePhoneDigits(body.phone))
      : null)
    if (attempted) {
      try {
        assertCardAssignableToClient(db, card, attempted)
      } catch (e) {
        if (e instanceof CardOwnershipConflict) {
          return res.status(409).json({ detail: e.message, code: e.code, conflict: e.details })
        }
        throw e
      }
    } else if (body.clientId && card.clientId && String(body.clientId) !== String(card.clientId)) {
      return res.status(409).json({
        detail: `Карта ${num} уже принадлежит клиенту ${card.clientId}`,
        code: 'CARD_OWNED_BY_OTHER_CLIENT',
        conflict: { cardNum: num, ownerClientId: card.clientId, attemptedClientId: body.clientId },
      })
    }
    const { patch, vipChanged, levelChanged } = buildEnsureExistingCardPatch(body, card)
    if (vipChanged || levelChanged) {
      patch.loyaltyPeriod = currentLoyaltyPeriod()
      patch.bonusEligibleFrom = new Date().toISOString()
    }
    Object.assign(card, normalizeCardRow({ ...card, ...patch, num: card.num }))
  } else {
    const phoneClient = body.phone
      ? (db.clients || []).find(c => normalizePhoneDigits(c.phone) === normalizePhoneDigits(body.phone))
      : undefined
    const idClient = body.clientId
      ? (db.clients || []).find(c => String(c.id) === String(body.clientId))
      : undefined
    if (phoneClient && idClient && String(phoneClient.id) !== String(idClient.id)) {
      return res.status(409).json({
        detail: `clientId не совпадает с телефоном клиента`,
        code: 'ENSURE_CLIENT_ID_PHONE_MISMATCH',
        conflict: { attemptedClientId: body.clientId, phoneClientId: phoneClient.id },
      })
    }
    const baseClient = idClient || phoneClient || client
    card = buildEnsureNewCardRow(body, baseClient, normalizeCardRow)
    if (!db.cards) db.cards = []
    db.cards.push(card)
  }
  persist()
  res.json(card)
})

app.patch('/cards/:num', (req, res) => {
  if (req.body?.unlink) {
    return void handleO8CardUnlink(req, res, o8HandlerCtx())
  }
  const clientRef = takeClientRef(req)
  if (replyIfKnownOp(res, 'card_loyalty_patch', clientRef)) return
  const num = decodeURIComponent(req.params.num).toUpperCase()
  let card = findCardByNum(num)
  // Офлайн-выдача: карта могла быть создана локально — создаём на сервере при первом PATCH
  if (!card) {
    if (!Array.isArray(db.cards)) db.cards = []
    card = normalizeCardRow({
      num,
      client: '',
      phone: '',
      status: 'unlinked',
      level: '',
      bonus: 0,
      debt: 0,
      debtLimit: 0,
      issued: new Date().toISOString().slice(0, 10),
    })
    db.cards.push(card)
  }
  const beforeSnap = {
    client: card.client, phone: card.phone, debt: card.debt, bonus: card.bonus,
    level: card.level, vip: !!card.vip, status: card.status, debtEnabled: card.debtEnabled,
  }
  const body = { ...req.body }
    const allowDecrease = body.allowBonusDecrease === true
    delete body.allowBonusDecrease
    // Версию погашений / бонусов ставит только сервер
    delete body.debtPayVersion
    delete body.bonusPayVersion
    // Never accept absolute debtLedger from Desktop (cross-client adoption vector)
    delete body.debtLedger
    delete body.debtOverdueStrikes
    delete body.debtCreditBlocked
    const prevDebt = Number(card.debt) || 0
    const enforceDebtLimit = !isStaffRequest(req) // лимит только для приложения клиента
    // Ownership guard before mutating identity fields
    if (body.clientId != null || body.phone != null || body.client != null || body.status != null) {
      const attempted = body.clientId
        ? (db.clients || []).find(c => c.id === body.clientId)
        : (body.phone
          ? (db.clients || []).find(c => normalizePhoneDigits(c.phone) === normalizePhoneDigits(body.phone))
          : null)
      if (attempted) {
        try {
          assertCardAssignableToClient(db, card, attempted)
        } catch (e) {
          if (e instanceof CardOwnershipConflict) {
            return res.status(409).json({ detail: e.message, code: e.code, conflict: e.details })
          }
          throw e
        }
      } else if (body.clientId && card.clientId && String(body.clientId) !== String(card.clientId)) {
        return res.status(409).json({
          detail: `Карта ${num} уже принадлежит клиенту ${card.clientId}`,
          code: 'CARD_OWNED_BY_OTHER_CLIENT',
          conflict: { cardNum: num, ownerClientId: card.clientId, attemptedClientId: body.clientId },
        })
      }
    }
    // Reject painting Holov identity onto Sayod-owned card via name/phone alone
    if ((body.phone != null || body.client != null) && card.clientId) {
      const owner = (db.clients || []).find(c => String(c.id) === String(card.clientId))
      if (owner && body.phone != null
        && normalizePhoneDigits(body.phone)
        && normalizePhoneDigits(body.phone) !== normalizePhoneDigits(owner.phone)) {
        return res.status(409).json({
          detail: `Нельзя сменить телефон карты ${num}: владелец ${card.clientId}`,
          code: 'CARD_IDENTITY_PHONE_CONFLICT',
          conflict: { cardNum: num, ownerClientId: card.clientId },
        })
      }
    }
    if (body.debt != null) {
      return res.status(400).json({
        detail: 'Изменение долга только через POST /clients/:id/debt-adjustments',
        code: 'DEBT_REQUIRES_ADJUSTMENT_OPERATION',
      })
    }
    if (body.bonus != null) {
      return res.status(400).json({
        detail: 'Изменение бонусов только через POST /cards/:num/bonus-adjustments',
        code: 'BONUS_REQUIRES_ADJUSTMENT_OPERATION',
      })
    }
    if (body.debtEnabled === false && (Number(card.debt) || 0) > 0.001) {
      // Если одновременно поднимаем/оставляем долг — не отклоняем, а включим раздел ниже
      const nextDebtProbe = body.debt != null ? Number(body.debt) || 0 : Number(card.debt) || 0
      if (nextDebtProbe > 0.001) {
        body.debtEnabled = true
      } else {
        return res.status(409).json({ detail: 'Нельзя выключить раздел долга, пока есть непогашенный долг' })
      }
    }
    const bonusManuallySet = false
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
    {
      const stamp = new Date().toISOString()
      card.updatedAtIso = stamp
      card.serverAtIso = stamp
    }
    if (body.client != null && !isPlaceholderClientName(body.client)) {
      const named = (db.clients || []).find(c =>
        c.card === num
        || (card.clientId && c.id === card.clientId)
        || (card.phone && normalizePhoneDigits(c.phone) === normalizePhoneDigits(card.phone)),
      )
      if (named) named.name = String(body.client).trim()
    }
    if (body.status != null) {
      const linked = (db.clients || []).find(c =>
        c.card === num
        || (card.clientId && c.id === card.clientId)
        || (card.phone && normalizePhoneDigits(c.phone) === normalizePhoneDigits(card.phone)),
      )
      if (linked) linked.blocked = body.status === 'blocked'
    }
    // ВАЖНО: сначала обрабатываем дельту долга, пока client.debt ещё равен prevDebt.
    // Если синхронизировать client.debt из карты ДО handleClientDebtDelta, то
    // внутренняя проверка лимита (canTakeNewDebt) увидит уже увеличенный долг и
    // прибавит дельту повторно (двойной учёт) — операция ошибочно отклонится,
    // сервер откатит долг, и он не попадёт в профиль клиента.
    syncClientFromCardRow(card)
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
  if (clientRef) rememberKnownOp('card_loyalty_patch', clientRef, card)
  persist()
  notifyCrmChange({
    phone: card.phone,
    bonus: card.bonus,
    card: card.num,
    num: card.num,
    clientId: card.clientId,
  })
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

app.post('/clients/:id/debt-adjustments', (req, res) => {
  void handleO8ClientDebtAdjustment(req, res, o8HandlerCtx())
})

app.post('/cards/:num/bonus-adjustments', (req, res) => {
  void handleO8CardBonusAdjustment(req, res, o8HandlerCtx())
})

app.post('/cards/:num/cash-topup', (req, res) => {
  void handleO8CashTopup(req, res, o8HandlerCtx())
})

/** Выдача наличных клиенту в долг: касса −amount, canonicalDebt += amount (не absolute PATCH). */
app.post('/cards/:num/cash-advance', (req, res) => {
  void handleO8CashAdvance(req, res, o8HandlerCtx())
})

/** Погашение долга с кассы: нал → в ожидаемую кассу смены */
app.post('/cards/:num/debt-repay', (req, res) => {
  void handleO8DebtRepay(req, res, o8HandlerCtx())
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
  let key = phoneKey(String(req.query.phone || ''))
  if (req.auth?.principal === 'CLIENT') {
    key = phoneKey(req.auth.phone || '')
  }
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
  let key = phoneKey(String(req.query.phone || req.body.phone || ''))
  if (req.auth?.principal === 'CLIENT') {
    key = phoneKey(req.auth.phone || '')
  }
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
  if (!n) return res.status(404).json({ detail: 'Not found' })
  if (req.auth?.principal === 'CLIENT') {
    const self = phoneKey(req.auth.phone || '')
    if (n.targetPhone && n.targetPhone !== self && n.broadcast !== true) {
      return res.status(403).json({ detail: 'Нет доступа к чужим данным', code: 'AUTH_HORIZONTAL' })
    }
  }
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
      Object.assign(p, pickDefined(before, ['name', 'price', 'costPrice', 'cat']))
      if (before?.stock != null) {
        setProductStockExact(db, p.id, before.stock, { reason: 'Восстановление из истории' })
      }
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
      syncCardIdentityFromClient(c)
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
  const today = ymdBusiness(new Date())
  const ordersToday = (db.orders || []).filter(o => ymdBusiness(o.createdAtIso || o.createdAt) === today)
  res.json({
    ordersToday: ordersToday.length,
    revenueToday: ordersToday.reduce((s, o) => s + bonusEligibleTotal(o), 0),
    activeCouriers: (db.couriers || []).filter(c => c.active !== false).length,
    activeRestaurants: (db.restaurants || []).length,
  })
})

/**
 * Полная очистка операционных данных.
 * Остаются: сотрудники, клиенты, карты, настройки, вход админа.
 * Body: { confirm: "ОЧИСТИТЬ", currentPassword: "..." }
 */
app.post('/admin/reset-operational', async (req, res) => {
  const body = req.body || {}
  const confirm = String(body.confirm || '').trim()
  if (confirm !== 'ОЧИСТИТЬ') {
    return res.status(400).json({ detail: 'Для подтверждения введите слово ОЧИСТИТЬ' })
  }
  const auth = ensureAdminAuth()
  const currentPassword = String(body.currentPassword || '')
  const admin = findAdminUser()
  if (!admin || !verifyAndMaybeMigrateCredential(admin, currentPassword).ok) {
    return res.status(401).json({ detail: 'Неверный пароль админа' })
  }
  // migrate if needed
  {
    const v = verifyAndMaybeMigrateCredential(admin, currentPassword)
    if (v.migrated) {
      applyPasswordMigration(admin, v.passwordHash)
      syncAdminAuthMirror(admin)
    }
  }
  void auth

  let backupPath = null
  try {
    backupPath = backupDatabaseFile()
  } catch (e) {
    console.error('[reset-operational] backup failed', e)
    return res.status(500).json({ detail: 'Не удалось создать резервную копию' })
  }

  // Фото товаров до очистки массива
  try {
    for (const p of db.products || []) {
      if (p?.photo) {
        try { deleteManagedProductPhoto(p.photo) } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

  const result = resetOperationalData(db, { reseedCategories: true })
  await flushDbAsync()

  try {
    broadcastProduct({ reason: 'reset-operational', deleted: true, ids: [] })
    broadcastCategory({ reason: 'reset-operational', deleted: true, ids: [], slugs: [] })
    broadcastPosUpdate({ reason: 'reset-operational' })
  } catch (e) {
    console.error('[reset-operational] broadcast', e)
  }

  res.json({
    ok: true,
    backup: backupPath,
    kept: result.kept,
    categories: result.categories,
    cleared: result.cleared,
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
app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err)
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ detail: 'Некорректный JSON' })
  }
  console.error('[api] unhandled', err)
  res.status(500).json({ detail: 'Внутренняя ошибка сервера' })
})

registerO8TestRoutes(app, { db })

const httpServer = createServer(app)
const wss = new WebSocketServer({
  noServer: true,
  handleProtocols(protocols) {
    // Echo first kakapo/token protocol so browsers complete the handshake.
    const list = [...protocols]
    if (!list.length) return false
    const tokenish = list.find((p) => /^(admin|staff|cashier|client|device)_/i.test(p))
    if (tokenish) return tokenish
    if (list.includes('kakapo')) return 'kakapo'
    return list[0]
  },
})
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

async function shutdown(signal) {
  console.error(`[shutdown] ${signal}`)
  try { clearInterval(wsHeartbeat) } catch { /* */ }
  for (const ws of [...clients]) {
    try { ws.close(1001, 'shutdown') } catch { /* */ }
    clients.delete(ws)
  }
  try {
    await flushDbAsync()
    await shutdownDb()
  } catch (e) {
    console.error('[shutdown] flush', e?.message || e)
  }
  httpServer.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 5000).unref()
}

process.on('SIGINT', () => { void shutdown('SIGINT') })
process.on('SIGTERM', () => { void shutdown('SIGTERM') })
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
  void flushDbAsync()
})

httpServer.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/ws/')) {
    socket.destroy()
    return
  }
  const meta = parseWsMeta(req.url, req)
  let resolved = resolveWsAuth(meta)
  // Lab auto-auth (O1–O7): loopback may claim staff WS roles without Bearer —
  // never in production (assertSafeAuthEnvOrThrow refuses the flag).
  if (!resolved.ok && isLabAutoAuthEnabled() && isLoopbackReq(req) && isWsStaffRole(meta.role)) {
    resolved = {
      ok: true,
      wsRole: String(meta.role || 'admin').toLowerCase(),
      clientPhone: '',
      principal: 'ADMIN',
    }
  }
  if (!resolved.ok) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.wsRole = resolved.wsRole
    ws.clientPhone = resolved.clientPhone
    ws.wsPrincipal = resolved.principal
    clients.add(ws)
    ws.on('message', (data) => { if (String(data) === 'ping') ws.send('pong') })
    ws.on('close', () => clients.delete(ws))
  })
})

httpServer.listen(PORT, '0.0.0.0', () => {
  try {
    assertSafeAuthEnvOrThrow()
  } catch (e) {
    console.error('\n❌ AUTH ENV:', e?.message || e)
    process.exit(1)
  }
  const testRoutes = countMountedTestRoutes()
  if (isProductionRuntime() && testRoutes > 0) {
    console.error(`\n❌ TEST_ROUTE_COUNT=${testRoutes} in production — refusing start\n`)
    process.exit(1)
  }
  const authStats = routeCoverageStats()
  const stats = getDbStats()
  console.log(`\n✅ КАКАПО Backend: http://0.0.0.0:${PORT}`)
  console.log(`   Auth routes: ${authStats.PRODUCTION_ROUTES_TOTAL} · public ${authStats.PUBLIC_ROUTES} · unknown ${authStats.UNKNOWN_AUTH_ROUTES} · testMount ${testRoutes}`)
  console.log(`   Движок БД: ${stats.engine}`)
  console.log(`   База: ${stats.path}`)
  console.log(`   DATA_DIR: ${stats.dataDir} | persistent: ${stats.persistent ? 'yes' : 'NO'}`)
  console.log(`   Записей: клиентов ${stats.clients}, заказов ${stats.orders}, карт ${stats.cards}, товаров ${stats.products}`)
  if (process.env.NODE_ENV === 'production' && stats.engine === 'json' && !stats.persistent) {
    console.error('\n⚠️  ВНИМАНИЕ: DATA_DIR не на постоянном диске — база может обнуляться при деплое!')
    console.error('   Hetzner/Docker: volume kakapo-data → /data (DATA_DIR=/data)\n')
  }
  if (process.env.NODE_ENV === 'production' && stats.engine !== 'postgres') {
    console.error('\n⚠️  ВНИМАНИЕ: production без PostgreSQL (DATABASE_URL). Задайте DATABASE_URL.\n')
  }
  console.log(`   Health: http://0.0.0.0:${PORT}/health`)
  console.log(`   Updates: http://0.0.0.0:${PORT}/updates/kassa  (${UPDATES_KASSA_DIR})`)
  console.log(`   UI pack: http://0.0.0.0:${PORT}/updates/kassa-ui  (${UPDATES_KASSA_UI_DIR})`)
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
  const revisionTimer = setInterval(runRevisionCoordinator, 5000)
  revisionTimer.unref()
  setImmediate(() => runRevisionCoordinator())
  setImmediate(() => runLoyaltyBackfill())
  setImmediate(() => {
    kickProductPhotoMigration()
  })
})
