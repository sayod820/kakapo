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
    admin: { email: 'admin@kakapo.tj', password: 'admin123', name: 'Владелец KAKAPO' },
  },
  users: [],
  cards: [],
  reviews: [],
  categories: [],
  promos: [],
  payouts: [],
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
  return cache
}

export function saveDb() {
  mkdirSync(dirname(DB_FILE), { recursive: true })
  writeFileSync(DB_FILE, JSON.stringify(cache, null, 2), 'utf8')
}

export function resetCache() {
  cache = null
}
