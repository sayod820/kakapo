import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = process.env.DATA_DIR || join(__dirname, 'data')
const DB_FILE = join(DATA_DIR, 'kakapo.json')
const SAVE_DEBOUNCE_MS = Number(process.env.DB_SAVE_DEBOUNCE_MS) || 120

let cache = null
let saveTimer = null
let saveDirty = false

function ensureDataDir() {
  mkdirSync(dirname(DB_FILE), { recursive: true })
}

const DEFAULT = {
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

export function getDbFilePath() {
  return DB_FILE
}

export function databaseFileExists() {
  return existsSync(DB_FILE)
}

/** Постоянное хранилище: Docker volume /data или каталог на VPS (Hetzner). */
export function isPersistentDataDir() {
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
    path: DB_FILE,
    dataDir: DATA_DIR,
    persistent: isPersistentDataDir(),
    fileExists: databaseFileExists(),
    clients: Array.isArray(db.clients) ? db.clients.length : 0,
    orders: Array.isArray(db.orders) ? db.orders.length : 0,
    cards: Array.isArray(db.cards) ? db.cards.length : 0,
    products: Array.isArray(db.products) ? db.products.length : 0,
  }
}

export function loadDb() {
  if (cache) return cache
  if (!existsSync(DB_FILE)) {
    ensureDataDir()
    cache = structuredClone(DEFAULT)
    saveDb()
    return cache
  }
  cache = JSON.parse(readFileSync(DB_FILE, 'utf8'))
  if (!Array.isArray(cache.deletedPhoneKeys)) cache.deletedPhoneKeys = []
  if (!cache.settings) cache.settings = structuredClone(DEFAULT.settings)
  if (!cache.settings.admin) cache.settings.admin = structuredClone(DEFAULT.settings.admin)
  if (!Array.isArray(cache.cashiers)) cache.cashiers = []
  if (!Array.isArray(cache.posShifts)) cache.posShifts = []
  if (!Array.isArray(cache.posSales)) cache.posSales = []
  if (!Array.isArray(cache.stockReceipts)) cache.stockReceipts = []
  if (!Array.isArray(cache.writeOffs)) cache.writeOffs = []
  if (!Array.isArray(cache.stockRevisions)) cache.stockRevisions = []
  if (!Array.isArray(cache.suppliers)) cache.suppliers = []
  if (!Array.isArray(cache.supplierPayments)) cache.supplierPayments = []
  if (!Array.isArray(cache.expenses)) cache.expenses = []
  return cache
}

export function saveDb() {
  if (!cache) return
  ensureDataDir()
  writeFileSync(DB_FILE, JSON.stringify(cache, null, 2), 'utf8')
  saveDirty = false
}

/** Отложенная запись — снижает лаг при серии persist() подряд */
export function scheduleSaveDb() {
  if (!cache) return
  saveDirty = true
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (saveDirty) saveDb()
  }, SAVE_DEBOUNCE_MS)
}

/** Немедленно сбросить отложенную запись (shutdown, критические операции) */
export function flushDb() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (saveDirty) saveDb()
}

export function resetCache() {
  cache = null
}
