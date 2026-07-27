/**
 * Заменяет все категории на актуальное дерево из marketCategoriesSeed.js
 * и переназначает товары со старых slug.
 *
 * Запуск: node syncCategories.js
 * На сервере: docker exec -e DATA_DIR=/data -w /app kakapo-api node syncCategories.js
 */
import { copyFileSync, existsSync } from 'fs'
import { loadDb, saveDb, getDbFilePath } from './db.js'
import { replaceCategoriesFromSeed } from './marketCategoriesSeed.js'

const db = loadDb()
const file = getDbFilePath()
if (existsSync(file)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  copyFileSync(file, file.replace(/\.json$/i, `.backup-cats-${stamp}.json`))
}

const result = replaceCategoriesFromSeed(db)
db._categorySeedVersion = 2
saveDb()

console.log('Категории обновлены.')
console.log('Всего категорий:', result.categories)
console.log('Товаров переназначено:', result.remapped)
console.log('База:', file)
