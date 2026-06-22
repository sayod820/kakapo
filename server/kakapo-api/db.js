import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || join(__dirname, 'data')
const DB_FILE = join(DATA_DIR, 'kakapo.json')

const DEFAULT = {
  products: [],
  restaurants: [],
  orders: [],
  pickups: [],
  couriers: [],
  assemblers: [],
  clients: [],
  settings: {
    pricing: { base: 10, baseDist: 2.5, perKm: 3, heavyKg: 50, heavyExtra: 10, freeFrom: 0 },
    loyalty: {
      welcomeBonus: 10,
      bronzeMinSpent: 500,
      tierMinSpent: { bronze: 500, silver: 1000, gold: 2000, platinum: 3000 },
      basic: { bonusPercent: 0 },
      bronze: { bonusPercent: 1 },
      silver: { bonusPercent: 2 },
      gold: { bonusPercent: 3 },
      platinum: { bonusPercent: 5 },
      vip: { bonusPercent: 5 },
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
  _seq: { order: 4832, product: 12, category: 2, review: 0, promo: 7, payout: 0 },
}

let cache = null

export function loadDb() {
  if (cache) return cache
  if (!existsSync(DB_FILE)) {
    mkdirSync(dirname(DB_FILE), { recursive: true })
    cache = structuredClone(DEFAULT)
    saveDb()
    return cache
  }
  cache = JSON.parse(readFileSync(DB_FILE, 'utf8'))
  if (!Array.isArray(cache.deletedPhoneKeys)) cache.deletedPhoneKeys = []
  if (!cache.settings) cache.settings = structuredClone(DEFAULT.settings)
  if (!cache.settings.admin) cache.settings.admin = structuredClone(DEFAULT.settings.admin)
  return cache
}

export function saveDb() {
  mkdirSync(dirname(DB_FILE), { recursive: true })
  writeFileSync(DB_FILE, JSON.stringify(cache, null, 2), 'utf8')
}

export function resetCache() {
  cache = null
}
