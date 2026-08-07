import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  closePool,
  ensureSchema,
  getDatabaseUrl,
  isPostgresEnabled,
  withClient,
} from './pg/client.js'
import {
  isPgEmpty,
  loadSnapshotFromPg,
  persistSnapshot,
} from './pg/store.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = process.env.DATA_DIR || join(__dirname, 'data')
const DB_FILE = join(DATA_DIR, 'kakapo.json')
const SAVE_DEBOUNCE_MS = Number(process.env.DB_SAVE_DEBOUNCE_MS) || 120

let cache = null
let saveTimer = null
let saveDirty = false
let ready = false
let engine = 'json' // 'json' | 'postgres'
let flushChain = Promise.resolve()

function ensureDataDir() {
  mkdirSync(dirname(DB_FILE), { recursive: true })
}

export const DEFAULT = {
  products: [],
  restaurants: [],
  orders: [],
  pickups: [],
  couriers: [],
  assemblers: [],
  clients: [],
  settings: {
    pricing: { base: 10, baseDist: 2.5, perKm: 3, weightStepKg: 30, weightFirstExtra: 10, weightNextExtra: 5, freeFrom: 0, courierCommissionPercent: 15 },
    loyalty: {
      welcomeBonus: 10,
      bronzeMinSpent: 500,
      tierMinSpent: { bronze: 500, silver: 1000, gold: 2000, platinum: 3000 },
      basic: { bonusPercent: 0 },
      bronze: { bonusPercent: 1 },
      silver: { bonusPercent: 2 },
      gold: { bonusPercent: 3, defaultDebtLimit: 2000 },
      platinum: { bonusPercent: 5, defaultDebtLimit: 2000 },
      vip: { bonusPercent: 5, defaultDebtLimit: 5000 },
      vipRules: { minOrders: 30, minReviews: 5, minSpent: 3000 },
    },
    admin: {
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
    },
  },
  users: [],
  cards: [],
  reviews: [],
  categories: [],
  promos: [],
  payouts: [],
  deletedPhoneKeys: [],
  cashiers: [],
  posShifts: [],
  posSales: [],
  stockReceipts: [],
  writeOffs: [],
  stockRevisions: [],
  suppliers: [],
  supplierPayments: [],
  expenses: [],
  financeMoves: [],
  employees: [],
  _seq: { order: 4832, product: 12, category: 2, review: 0, promo: 7, payout: 0, posSale: 0 },
}

function normalizeCache(raw) {
  const c = raw && typeof raw === 'object' ? raw : structuredClone(DEFAULT)
  if (!Array.isArray(c.deletedPhoneKeys)) c.deletedPhoneKeys = []
  if (!c.settings) c.settings = structuredClone(DEFAULT.settings)
  if (!c.settings.admin) c.settings.admin = structuredClone(DEFAULT.settings.admin)
  if (!Array.isArray(c.cashiers)) c.cashiers = []
  if (!Array.isArray(c.posShifts)) c.posShifts = []
  if (!Array.isArray(c.posSales)) c.posSales = []
  if (!Array.isArray(c.stockReceipts)) c.stockReceipts = []
  if (!Array.isArray(c.writeOffs)) c.writeOffs = []
  if (!Array.isArray(c.stockRevisions)) c.stockRevisions = []
  if (!Array.isArray(c.suppliers)) c.suppliers = []
  if (!Array.isArray(c.supplierPayments)) c.supplierPayments = []
  if (!Array.isArray(c.expenses)) c.expenses = []
  if (!Array.isArray(c.financeMoves)) c.financeMoves = []
  if (!Array.isArray(c.employees)) c.employees = []
  if (!Array.isArray(c.products)) c.products = []
  if (!Array.isArray(c.clients)) c.clients = []
  if (!Array.isArray(c.cards)) c.cards = []
  if (!Array.isArray(c.categories)) c.categories = []
  if (!Array.isArray(c.orders)) c.orders = []
  if (!c._seq || typeof c._seq !== 'object') c._seq = structuredClone(DEFAULT._seq)
  return c
}

function loadJsonFileIntoCache() {
  if (!existsSync(DB_FILE)) {
    ensureDataDir()
    cache = structuredClone(DEFAULT)
    writeFileSync(DB_FILE, JSON.stringify(cache, null, 2), 'utf8')
    return cache
  }
  cache = normalizeCache(JSON.parse(readFileSync(DB_FILE, 'utf8')))
  return cache
}

function writeJsonFile() {
  if (!cache) return
  ensureDataDir()
  writeFileSync(DB_FILE, JSON.stringify(cache, null, 2), 'utf8')
}

export function getDbFilePath() {
  return DB_FILE
}

export function databaseFileExists() {
  return existsSync(DB_FILE)
}

export function getDbEngine() {
  return engine
}

/** Постоянное хранилище: Docker volume /data или каталог на VPS (Hetzner). */
export function isPersistentDataDir() {
  if (engine === 'postgres') return true
  const d = String(DATA_DIR).replace(/\\/g, '/')
  return (
    d === '/data' ||
    d.startsWith('/data/') ||
    d === '/var/kakapo/data' ||
    d.startsWith('/var/kakapo/')
  )
}

export function getDbStats() {
  const db = loadDb()
  return {
    engine,
    path: engine === 'postgres' ? getDatabaseUrl().replace(/:[^:@/]+@/, ':***@') : DB_FILE,
    dataDir: DATA_DIR,
    persistent: isPersistentDataDir(),
    fileExists: databaseFileExists(),
    clients: Array.isArray(db.clients) ? db.clients.length : 0,
    orders: Array.isArray(db.orders) ? db.orders.length : 0,
    cards: Array.isArray(db.cards) ? db.cards.length : 0,
    products: Array.isArray(db.products) ? db.products.length : 0,
  }
}

/**
 * Must be awaited before loadDb() / HTTP listen.
 * Production requires DATABASE_URL (PostgreSQL).
 */
export async function initDb() {
  if (ready) return cache

  const wantPg = isPostgresEnabled()
  if (process.env.NODE_ENV === 'production' && !wantPg) {
    console.error('[db] DATABASE_URL is required in production')
    process.exit(1)
  }

  if (wantPg) {
    engine = 'postgres'
    await ensureSchema()
    await withClient(async client => {
      const empty = await isPgEmpty(client)
      if (empty && existsSync(DB_FILE)) {
        console.log('[db] Postgres empty — importing', DB_FILE)
        const raw = JSON.parse(readFileSync(DB_FILE, 'utf8'))
        cache = normalizeCache(raw)
        await persistSnapshot(cache)
        console.log('[db] Import from kakapo.json complete')
      } else if (empty) {
        console.log('[db] Postgres empty — seeding DEFAULT')
        cache = structuredClone(DEFAULT)
        await persistSnapshot(cache)
      } else {
        cache = normalizeCache(await loadSnapshotFromPg(client))
      }
    })
    console.log('[db] engine=postgres')
  } else {
    engine = 'json'
    loadJsonFileIntoCache()
    console.log('[db] engine=json', DB_FILE)
  }

  ready = true
  return cache
}

export function loadDb() {
  if (!ready || !cache) {
    // Scripts that forget initDb: fall back to sync JSON only
    if (isPostgresEnabled()) {
      throw new Error('initDb() must be awaited before loadDb() when DATABASE_URL is set')
    }
    return loadJsonFileIntoCache()
  }
  return cache
}

async function persistNow() {
  if (!cache || !saveDirty) return
  const snapshot = cache
  if (engine === 'postgres') {
    await persistSnapshot(snapshot)
  } else {
    writeJsonFile()
  }
  saveDirty = false
}

function enqueueFlush() {
  flushChain = flushChain
    .then(() => persistNow())
    .catch(err => {
      console.error('[db] flush failed', err?.message || err)
      // keep dirty so next flush retries
      saveDirty = true
    })
  return flushChain
}

/** Immediate persist (async). Prefer this over sync flushDb when using Postgres. */
export async function flushDbAsync() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!cache) return
  if (!saveDirty && engine === 'json') return
  // Always mark dirty flush requested
  if (engine === 'postgres' && !saveDirty) return
  saveDirty = true
  await enqueueFlush()
}

/**
 * Sync-compatible flush: for JSON writes immediately;
 * for Postgres schedules awaitable flush (callers in async routes should await flushDbAsync).
 */
export function flushDb() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!cache) return
  if (engine === 'json') {
    if (saveDirty) writeJsonFile()
    saveDirty = false
    return
  }
  saveDirty = true
  void enqueueFlush()
}

/** Отложенная запись — снижает лаг при серии persist() подряд */
export function scheduleSaveDb() {
  if (!cache) return
  saveDirty = true
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    void enqueueFlush()
  }, SAVE_DEBOUNCE_MS)
}

/** Синхронный API для seed/скриптов: JSON сразу; PG — dirty + flush chain */
export function saveDb() {
  if (!cache) return
  saveDirty = true
  if (engine === 'json') {
    writeJsonFile()
    saveDirty = false
    return
  }
  void enqueueFlush()
}

export function resetCache() {
  cache = null
  ready = false
}

/** Snapshot backup next to DATA_DIR (works for both engines). */
export function backupDatabaseSnapshot() {
  if (!cache) return null
  ensureDataDir()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = join(DATA_DIR, `kakapo.backup-${stamp}.json`)
  writeFileSync(backup, JSON.stringify(cache, null, 2), 'utf8')
  return backup
}

export async function shutdownDb() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  saveDirty = true
  await enqueueFlush()
  if (engine === 'postgres') {
    try { await closePool() } catch { /* ignore */ }
  }
}
