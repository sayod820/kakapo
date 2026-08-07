/**
 * Полная очистка операционных данных КАКАПО.
 * Оставляет: employees, clients, cards, settings, users/auth.
 */
import { copyFileSync, existsSync } from 'fs'
import { replaceCategoriesFromSeed } from './marketCategoriesSeed.js'
import { backupDatabaseSnapshot, getDbFilePath } from './db.js'

/** Коллекции, которые стираем */
export const OPERATIONAL_CLEARED_KEYS = [
  'products', 'restaurants', 'orders', 'pickups', 'couriers', 'assemblers',
  'reviews', 'promos', 'payouts', 'banners',
  'cashiers', 'posShifts', 'posSales', 'posPoints',
  'stockReceipts', 'writeOffs', 'stockRevisions',
  'suppliers', 'supplierPayments', 'expenses',
  'financeMoves', 'moneyLedger', 'auditLog',
  'categories', 'deletedPhoneKeys', 'deletedCategorySlugs',
]

/**
 * @param {Record<string, any>} db
 * @param {{ reseedCategories?: boolean }} [opts]
 * @returns {{ kept: Record<string, number>, cleared: string[], categories: number }}
 */
export function resetOperationalData(db, opts = {}) {
  const reseedCategories = opts.reseedCategories !== false

  for (const key of OPERATIONAL_CLEARED_KEYS) {
    db[key] = []
  }

  // Нумерация с нуля (клиенты/карты живут по своим id-строкам)
  db._seq = {
    order: 0,
    product: 0,
    category: 0,
    review: 0,
    promo: 0,
    payout: 0,
    posSale: 0,
  }

  if (reseedCategories) {
    db.categories = []
    db.deletedCategorySlugs = []
    replaceCategoriesFromSeed(db)
    db._categorySeedVersion = 3
  }

  if (!db.settings || typeof db.settings !== 'object') db.settings = {}
  db.settings.walletMergeDone = true

  // Гарантируем вход админа
  if (!Array.isArray(db.users) || !db.users.length) {
    db.users = [
      { id: 1, email: 'admin@kakapo.tj', login: 'admin', password: 'admin123', role: 'admin', name: 'Админ КАКАПО' },
    ]
  }

  if (!Array.isArray(db.employees)) db.employees = []
  if (!Array.isArray(db.clients)) db.clients = []
  if (!Array.isArray(db.cards)) db.cards = []

  return {
    kept: {
      employees: db.employees.length,
      clients: db.clients.length,
      cards: db.cards.length,
    },
    cleared: [...OPERATIONAL_CLEARED_KEYS],
    categories: Array.isArray(db.categories) ? db.categories.length : 0,
  }
}

/** Резервная копия снимка БД (JSON-файл в DATA_DIR; работает и для Postgres). */
export function backupDatabaseFile() {
  try {
    const snap = backupDatabaseSnapshot()
    if (snap) return snap
  } catch { /* fall through */ }
  const file = getDbFilePath()
  if (!existsSync(file)) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = file.replace(/\.json$/i, `.backup-${stamp}.json`)
  copyFileSync(file, backup)
  return backup
}
