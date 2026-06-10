import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_FILE = join(__dirname, 'data', 'kakapo.json')

const DEFAULT = {
  products: [],
  restaurants: [],
  orders: [],
  pickups: [],
  settings: { pricing: { base: 10, baseDist: 2.5, perKm: 3, heavyKg: 50, heavyExtra: 10, freeFrom: 0 } },
  users: [],
  cards: [],
  reviews: [],
  categories: [],
  promos: [],
  _seq: { order: 4832, product: 12, category: 2, review: 0, promo: 7 },
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
