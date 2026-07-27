/**
 * Полная очистка данных КАКАПО (чистый старт перед реальной продажей).
 *
 * Что делает:
 *  - создаёт резервную копию kakapo.json
 *  - стирает: товары, заказы, чеки, смены, финансы, клиентов, карты,
 *    склад, поставщиков, историю действий (auditLog), категории и пр.
 *  - сбрасывает нумерацию (следующий чек с 1)
 *  - заново создаёт стандартные категории магазина
 *  - ОСТАВЛЯЕТ: настройки, вход админа, сотрудников Торговли
 *
 * Запуск:  node resetData.js
 * (в каталоге server/kakapo-api). Сервер лучше остановить или сразу перезапустить.
 */
import { loadDb, saveDb, getDbFilePath } from './db.js'
import { buildCategoriesFromSeed } from './marketCategoriesSeed.js'
import { copyFileSync, existsSync } from 'fs'

const db = loadDb()

// 1) Резервная копия
const file = getDbFilePath()
if (existsSync(file)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = file.replace(/\.json$/i, `.backup-${stamp}.json`)
  copyFileSync(file, backup)
  console.log('Резервная копия сохранена:', backup)
}

// 2) Очистка коллекций (оставляем settings, users=админ, employees)
const CLEARED = [
  'products', 'restaurants', 'orders', 'pickups', 'couriers', 'assemblers',
  'clients', 'cards', 'reviews', 'promos', 'payouts',
  'cashiers', 'posShifts', 'posSales', 'posPoints',
  'stockReceipts', 'writeOffs', 'stockRevisions',
  'suppliers', 'supplierPayments', 'expenses',
  'financeMoves', 'moneyLedger', 'auditLog',
  'categories', 'deletedPhoneKeys', 'deletedCategorySlugs',
]
for (const key of CLEARED) db[key] = []

// 3) Сброс нумерации
db._seq = { order: 0, product: 0, category: 0, review: 0, promo: 0, payout: 0, posSale: 0 }

// 4) Категории заново (чтобы сразу можно было добавлять товары)
db.categories = buildCategoriesFromSeed(db._seq)
db._categorySeedVersion = 1

if (!db.settings) db.settings = {}
db.settings.walletMergeDone = true

// 5) Гарантируем вход админа
if (!Array.isArray(db.users) || !db.users.length) {
  db.users = [
    { id: 1, email: 'admin@kakapo.tj', login: 'admin', password: 'admin123', role: 'admin', name: 'Админ КАКАПО' },
  ]
}

saveDb()

const kept = [
  'settings',
  'users(админ)',
  Array.isArray(db.employees) && db.employees.length ? `employees(${db.employees.length})` : 'employees(0)',
  `categories(${db.categories.length})`,
]
console.log('Готово. Данные очищены, история действий пуста, нумерация с нуля.')
console.log('Оставлено:', kept.join(', '))
console.log('Точка продаж по умолчанию создастся при старте сервера.')
