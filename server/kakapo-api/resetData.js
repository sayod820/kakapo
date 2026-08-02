/**
 * Полная очистка операционных данных КАКАПО (чистый старт).
 *
 * ОСТАВЛЯЕТ: сотрудников, клиентов, карты лояльности, настройки, вход админа.
 * СТИРАЕТ: товары, заказы, кассу, склад, финансы, категории (затем сид), и пр.
 *
 * Запуск:  node resetData.js
 * (в каталоге server/kakapo-api). Сервер лучше остановить или сразу перезапустить.
 */
import { loadDb, saveDb } from './db.js'
import { backupDatabaseFile, resetOperationalData } from './resetOperational.js'

const db = loadDb()

const backup = backupDatabaseFile()
if (backup) console.log('Резервная копия сохранена:', backup)

const result = resetOperationalData(db, { reseedCategories: true })
saveDb()

console.log('Готово. Операционные данные очищены, нумерация с нуля.')
console.log('Оставлено: employees(%s), clients(%s), cards(%s), settings, users(админ)',
  result.kept.employees, result.kept.clients, result.kept.cards)
console.log('Категории заново из сида:', result.categories)
console.log('Точка продаж по умолчанию создастся при старте сервера.')
