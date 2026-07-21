/**
 * Полная очистка данных КАКАПО (чистый старт перед запуском).
 *
 * Что делает:
 *  - создаёт резервную копию data/kakapo.json (kakapo.backup-<timestamp>.json)
 *  - стирает: товары, рестораны, заказы, чеки (posSales), смены, финансы,
 *    клиентов, карты, курьеров, сборщиков, отзывы, акции, склад, поставщиков,
 *    расходы, аудит-лог, категории, точки продаж
 *  - сбрасывает нумерацию заказов и чеков с нуля (следующий заказ будет K-1)
 *  - ОСТАВЛЯЕТ: настройки (лояльность/цены/магазин), вход админа, сотрудников Торговли
 *
 * Запуск:  node resetData.js
 * (в каталоге server/kakapo-api). Сервер лучше остановить перед запуском.
 */
import { loadDb, saveDb, getDbFilePath } from './db.js'
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
  'categories', 'deletedPhoneKeys',
]
for (const key of CLEARED) db[key] = []

// 3) Сброс нумерации заказов и чеков с нуля
db._seq = { order: 0, product: 0, category: 0, review: 0, promo: 0, payout: 0, posSale: 0 }

// 4) Флаги, чтобы демо/категории не пересоздавались, а миграция не трогала чистые данные
db._categorySeedVersion = 1
if (!db.settings) db.settings = {}
db.settings.walletSplitDone = true

// 5) Гарантируем вход админа (на случай если users тоже почистили ранее)
if (!Array.isArray(db.users) || !db.users.length) {
  db.users = [
    { id: 1, email: 'admin@kakapo.tj', login: 'admin', password: 'admin123', role: 'admin', name: 'Админ КАКАПО' },
  ]
}

saveDb()

const kept = ['settings', 'users(админ)', Array.isArray(db.employees) && db.employees.length ? `employees(${db.employees.length})` : 'employees(0)']
console.log('Готово. Данные очищены, нумерация сброшена (следующий заказ: K-1).')
console.log('Оставлено:', kept.join(', '))
console.log('Точка продаж по умолчанию будет создана автоматически при старте сервера.')
