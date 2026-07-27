import { copyFileSync, existsSync, readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

import { loadDb, saveDb, getDbFilePath } from './db.js'
import { allocateProductBarcodes, allocateProductCodes, isPluTaken, nextFreeProductCode } from './productCodes.js'
import { setProductStockExact } from './posLogic.js'
import { buildCategoriesFromSeed, CSV_GROUP_TO_SLUG } from './marketCategoriesSeed.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const ROOT = resolve(__dirname, '../..')
const DEFAULT_CSV = resolve(ROOT, '../products.csv')
const sourceFile = resolve(process.argv[2] || DEFAULT_CSV)

const EXACT_NAME_FIXES = new Map([
  ['тарбуз', 'Арбуз'],
  ['харбуза', 'Арбуз'],
  ['капуст', 'Капуста'],
  ['пистаи акбари', 'Фисташки Акбари'],
  ['пистаи акбари 2', 'Фисташки Акбари 2'],
  ['чой сиёх', 'Чай Сиёх'],
  ['чой ергашт', 'Чай Эргашт'],
  ['конфет десерт картошка', 'Конфеты Десерт Картошка'],
  ['конфет sharqona', 'Конфеты Sharqona'],
  ['конфет sweety', 'Конфеты Sweety'],
  ['конфет вафел ritto', 'Конфеты вафельные Ritto'],
  ['голен индейки', 'Голень индейки'],
  ['хай милки плюс', 'Хай Милки Плюс'],
  ['конфет коровка', 'Конфеты Коровка'],
  ['конфет отломи', 'Конфеты Отломи'],
])

const WORD_FIXES = [
  [/\bпистаи\b/gi, 'Фисташки'],
  [/\bконфет\b/gi, 'Конфеты'],
  [/\bпечень\b/gi, 'Печенье'],
  [/\bобичн(ий|ый)\b/gi, 'Обычный'],
  [/\bкакос\b/gi, 'Кокос'],
  [/\bорешкий\b/gi, 'Орешки'],
  [/\bшколад\b/gi, 'Шоколад'],
  [/\bчой\b/gi, 'Чай'],
  [/\bчипси\b/gi, 'Чипсы'],
  [/\bголен\b/gi, 'Голень'],
  [/\bкапуст\b/gi, 'Капуста'],
  [/\bхарбуза\b/gi, 'Арбуз'],
  [/\bтарбуз\b/gi, 'Арбуз'],
  [/\bвафел\b/gi, 'Вафли'],
  [/\bоблочний\b/gi, 'Облачные'],
  [/\bптичи\b/gi, 'Птичье'],
]

function backupDb() {
  const dbFile = getDbFilePath()
  if (!existsSync(dbFile)) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = dbFile.replace(/\.json$/i, `.backup-import-${stamp}.json`)
  copyFileSync(dbFile, backup)
  return backup
}

function parseCsv(file) {
  const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  const lines = raw.split(/\r?\n/).filter(line => line.trim())
  const rows = []
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(';')
    rows.push({
      sourceLine: i + 1,
      addedAt: clean(parts[0]),
      barcode: digits(parts[1]),
      sourceCategory: clean(parts[2]),
      sourceName: clean(parts[3]),
      stockRaw: clean(parts[4]),
      priceRaw: clean(parts[5]),
      costRaw: clean(parts[6]),
      pluRaw: digits(parts[7]).slice(0, 4),
      sourceArt: clean(parts[8]),
      sourceCode: clean(parts[9]),
    })
  }
  return rows
}

function clean(value) {
  return String(value ?? '').trim()
}

function digits(value) {
  return String(value ?? '').replace(/\D/g, '')
}

function parseNumber(raw) {
  const normalized = String(raw ?? '').replace(/\s+/g, '').replace(',', '.')
  const num = Number(normalized)
  return Number.isFinite(num) ? num : 0
}

function round3(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000
}

function normalizeText(value) {
  return clean(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/['"]/g, '')
    .replace(/\s+/g, ' ')
}

function categoryMap(categories) {
  return new Map(categories.map(cat => [cat.slug, cat]))
}

function titleCase(value) {
  return value
    .toLowerCase()
    .replace(/(^|[\s([{"«])([\p{L}])/gu, (_m, prefix, letter) => `${prefix}${letter.toUpperCase()}`)
}

function normalizeQuotes(value) {
  return value
    .replace(/["“”]/g, '«')
    .replace(/«\s+/g, '«')
    .replace(/\s+«/g, ' «')
    .replace(/«([^»]+)«/g, '«$1»')
    .replace(/«([^»]+)$/g, '«$1»')
}

function extractPack(name) {
  const patterns = [
    /^\s*(\d+(?:[.,]\d+)?)\s*(мл|л|гр|г|кг|шт)\.?\s+/i,
    /\s+(\d+(?:[.,]\d+)?)\s*(мл|л|гр|г|кг|шт)\.?$/i,
  ]
  for (const pattern of patterns) {
    const match = name.match(pattern)
    if (!match) continue
    const amount = match[1].replace('.', ',')
    const unit = normalizeUnitToken(match[2])
    const nextName = clean(name.replace(match[0], ' '))
    return {
      name: nextName,
      unit: `${amount} ${unit}`,
    }
  }
  return { name, unit: 'шт' }
}

function normalizeUnitToken(token) {
  const value = normalizeText(token)
  if (value === 'гр' || value === 'г') return 'г'
  if (value === 'мл') return 'мл'
  if (value === 'л') return 'л'
  if (value === 'кг') return 'кг'
  return 'шт'
}

function cleanProductName(rawName, weighted) {
  let name = clean(rawName)
    .replace(/\(\s*вес\s*\)/gi, '')
    .replace(/\bвес\b/gi, '')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  const packed = extractPack(name)
  name = packed.name
  const exact = EXACT_NAME_FIXES.get(normalizeText(name))
  if (exact) {
    return {
      name: exact,
      unit: weighted ? 'кг' : packed.unit,
    }
  }
  for (const [pattern, replacement] of WORD_FIXES) name = name.replace(pattern, replacement)
  name = titleCase(name)
    .replace(/\bИ\b/g, 'и')
    .replace(/\bС\b/g, 'с')
    .replace(/\bНа\b/g, 'на')
    .replace(/\bДля\b/g, 'для')
    .replace(/\bПо\b/g, 'по')
    .replace(/\bИз\b/g, 'из')
    .replace(/\bСо\b/g, 'со')
    .replace(/\bОт\b/g, 'от')
    .replace(/\bБез\b/g, 'без')
    .replace(/\bМини\b/g, 'мини')
    .replace(/\s{2,}/g, ' ')
    .trim()
  name = normalizeQuotes(name)
  return {
    name,
    unit: weighted ? 'кг' : packed.unit,
  }
}

function hasAny(text, needles) {
  return needles.some(needle => text.includes(needle))
}

function resolveCategorySlug(sourceCategory, sourceName, weighted) {
  const cat = normalizeText(sourceCategory)
  const name = normalizeText(sourceName)

  if (CSV_GROUP_TO_SLUG[cat]) return CSV_GROUP_TO_SLUG[cat]

  if (cat.includes('весов') && cat.includes('товар')) {
    return classifyWeightedByName(name)
  }

  if (weighted) return classifyWeightedByName(name)
  return 'other'
}

function classifyWeightedByName(name) {
  if (hasAny(name, ['чой', 'чай'])) return 'tea_coffee_tea'
  if (hasAny(name, ['чипс', 'чипси'])) return 'snacks_chips'
  if (hasAny(name, ['бодом', 'кешу', 'чормагз', 'писта', 'пистаи', 'дони каду', 'орех', 'семеч', 'фисташ'])) return 'snacks_nuts'
  if (hasAny(name, ['ангур', 'хурмо', 'нок', 'мавиз', 'арбуз', 'дын', 'лимон', 'апельс', 'мандарин', 'яблок', 'банан', 'виноград', 'груш', 'персик', 'абрикос', 'слив', 'киви', 'анор', 'афлесун', 'шафтолу', 'себи', 'занчабил'])) return 'veg_fruit_fruits'
  if (hasAny(name, ['пиёз', 'гулкарам', 'сабзи', 'бодринг', 'капуст', 'карто', 'лук', 'морков', 'огур', 'помидор', 'томат', 'чеснок', 'перец', 'свекл', 'тыкв', 'гулинг', 'кандалот', 'лаблабу', 'бакладжан', 'сан г', 'пиёзи'])) return 'veg_fruit_vegetables'
  if (hasAny(name, ['нахут', 'нахуди', 'рис', 'приловка', 'греч', 'перлов', 'мош', 'луби', 'наск', 'горох', 'макарон'])) return 'grocery_cereals'
  if (hasAny(name, ['шакар', 'набот', 'канди', 'сахар'])) return 'grocery_sugar'
  if (hasAny(name, ['сыр', 'шири кок', 'сухое молоко'])) return 'dairy_cheese'
  if (hasAny(name, ['мохи', 'говяд', 'баран', 'мяс', 'фарш'])) return 'meat_beef'
  if (hasAny(name, ['колбас', 'сосиск', 'сардел', 'казы'])) return 'meat_sausages'
  if (hasAny(name, ['кур', 'индей', 'голень', 'филе', 'бедро', 'окороч', 'птиц'])) return 'meat_poultry'
  if (hasAny(name, ['конфет', 'мармел', 'зефир', 'пахлава', 'халва', 'бублик'])) return 'sweets_world_candy_weight'
  if (hasAny(name, ['шоколад', 'школад'])) return 'sweets_world_chocolate'
  if (hasAny(name, ['печень', 'вафл', 'пряник', 'вафел'])) return 'sweets_world_cookies_wafers'
  if (hasAny(name, ['кофе'])) return 'tea_coffee_coffee'
  if (hasAny(name, ['молок', 'кефир', 'сметан', 'йогурт'])) return 'dairy_milk'
  return 'other'
}

function classifyCategory(sourceCategory, sourceName, weighted) {
  return resolveCategorySlug(sourceCategory, sourceName, weighted)
}

function clearDb(db) {
  const cleared = [
    'products', 'restaurants', 'orders', 'pickups', 'couriers', 'assemblers',
    'clients', 'cards', 'reviews', 'promos', 'payouts',
    'cashiers', 'posShifts', 'posSales', 'posPoints',
    'stockReceipts', 'writeOffs', 'stockRevisions',
    'suppliers', 'supplierPayments', 'expenses',
    'financeMoves', 'moneyLedger', 'auditLog',
    'categories', 'deletedPhoneKeys', 'deletedCategorySlugs',
  ]
  for (const key of cleared) db[key] = []
  db._seq = { order: 0, product: 0, category: 0, review: 0, promo: 0, payout: 0, posSale: 0 }
  db.settings = db.settings || {}
  db.settings.walletMergeDone = true
}

function main() {
  if (!existsSync(sourceFile)) {
    throw new Error(`CSV не найден: ${sourceFile}`)
  }

  const rows = parseCsv(sourceFile)
  const db = loadDb()
  const backup = backupDb()
  clearDb(db)
  db.categories = buildCategoriesFromSeed(db._seq)
  const bySlug = categoryMap(db.categories)

  const stats = {
    imported: 0,
    weighted: 0,
    piece: 0,
    stockFixedToZero: 0,
    zeroPrice: 0,
    generatedBarcodes: 0,
    keptPlu: 0,
    generatedPlu: 0,
    duplicatePlu: 0,
    duplicateBarcode: 0,
    byCategory: new Map(),
  }

  for (const row of rows) {
    const weighted = /вес/i.test(row.sourceCategory) || /вес/i.test(row.sourceName)
    const categorySlug = classifyCategory(row.sourceCategory, row.sourceName, weighted)
    const category = bySlug.get(categorySlug) || bySlug.get('other')
    const { name, unit } = cleanProductName(row.sourceName, weighted)
    const requestedStock = round3(parseNumber(row.stockRaw))
    const stock = Math.max(0, requestedStock)
    const price = parseNumber(row.priceRaw)
    const costPrice = parseNumber(row.costRaw)
    const art = String(nextFreeProductCode(db.products))

    let requestedPlu = row.pluRaw
    if (requestedPlu && isPluTaken(db.products, requestedPlu)) {
      requestedPlu = ''
      stats.duplicatePlu += 1
    }
    let codes = allocateProductCodes(db.products, {
      art,
      plu: requestedPlu || (weighted ? art : ''),
    })
    if (!weighted && !requestedPlu) codes = { ...codes, plu: undefined }
    if (!requestedPlu && weighted) stats.generatedPlu += 1
    else if (requestedPlu && codes.plu) stats.keptPlu += 1

    let barcodeInput = row.barcode
    let usedFallbackBarcode = false
    try {
      const bars = allocateProductBarcodes(db.products, { barcode: barcodeInput }, Number(codes.art))
      barcodeInput = bars.barcode
    } catch {
      barcodeInput = ''
      usedFallbackBarcode = true
      stats.duplicateBarcode += 1
    }
    const bars = allocateProductBarcodes(db.products, { barcode: barcodeInput }, Number(codes.art))
    if (!row.barcode || usedFallbackBarcode || bars.barcode !== row.barcode) stats.generatedBarcodes += 1

    const product = {
      id: ++db._seq.product,
      art: codes.art,
      e: category?.emoji || '📦',
      name,
      price,
      costPrice: costPrice > 0 ? costPrice : null,
      cat: category?.name || 'Прочее',
      catId: category?.slug || 'other',
      unit,
      stock: 0,
      hot: false,
      barcode: bars.barcode,
      barcodes: bars.barcodes,
      plu: codes.plu,
      sellType: weighted ? 'weight' : 'piece',
      unitGrams: weighted ? 1000 : undefined,
      weightStep: weighted ? 1 : undefined,
      minWeight: weighted ? 1 : undefined,
      brand: undefined,
      desc: undefined,
      old: null,
      photo: undefined,
      photoThumb: undefined,
      organic: false,
    }

    db.products.push(product)
    if (stock > 0) setProductStockExact(db, product.id, stock, { reason: 'Импорт CSV', createdBy: 'importProductsCsv' })
    if (requestedStock < 0) stats.stockFixedToZero += 1
    if (price <= 0) stats.zeroPrice += 1
    if (weighted) stats.weighted += 1
    else stats.piece += 1
    stats.imported += 1
    stats.byCategory.set(product.cat, (stats.byCategory.get(product.cat) || 0) + 1)
  }

  saveDb()

  console.log('Импорт завершён.')
  console.log('CSV:', sourceFile)
  console.log('Backup:', backup || 'не было предыдущей базы')
  console.log('Товаров:', stats.imported)
  console.log('Весовых:', stats.weighted, '| Штучных:', stats.piece)
  console.log('PLU сохранено:', stats.keptPlu, '| PLU сгенерировано:', stats.generatedPlu, '| конфликтов PLU:', stats.duplicatePlu)
  console.log('Сгенерировано штрихкодов:', stats.generatedBarcodes, '| конфликтов штрихкода:', stats.duplicateBarcode)
  console.log('Отрицательные остатки -> 0:', stats.stockFixedToZero, '| Нулевая цена:', stats.zeroPrice)
  console.log('База:', getDbFilePath())
  console.log('Категории:')
  for (const [name, count] of [...stats.byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${String(count).padStart(4, ' ')} ${name}`)
  }
}

main()
