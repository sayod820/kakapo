/**
 * Импорт товаров из CSV выгрузки.
 *
 * Берём: название, категория, остаток, цена продажи, цена закупа, PLU,
 *        основной + дополнительные штрихкоды.
 * Генерируем: артикул с 1…N, штрихкод только если в файле нет,
 *             PLU для весовых без PLU — минимальный свободный.
 * Из названия: л/мл/гр/шт/кг → поле unit.
 *
 * Запуск:
 *   node importProductsCsv.js
 *   node importProductsCsv.js "C:/path/Products.csv"
 */
import { existsSync, readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

import { loadDb, saveDb, getDbFilePath } from './db.js'
import { allocateProductBarcodes, isPluTaken, nextFreeProductCode } from './productCodes.js'
import { setProductStockExact } from './posLogic.js'
import { CSV_GROUP_TO_SLUG } from './marketCategoriesSeed.js'
import { backupDatabaseFile, resetOperationalData } from './resetOperational.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const DEFAULT_CSV = resolve(ROOT, '../Products.csv')
const sourceFile = resolve(process.argv[2] || DEFAULT_CSV)

/** Точные имена групп из CSV (с опечатками) → slug нашего дерева */
const CSV_EXACT_GROUP = {
  'весовие товари': null, // классифицируем по названию
  'весовие колбаси': 'meat_sausages',
  'весовие сосиски': 'meat_wieners',
  'печенье, вафли, пряники': 'sweets_world_cookies_wafers',
  'газированный напиток': 'beverages_soda',
  'сок, нектар, морс': 'beverages_juice',
  'кексы, рулеты, бисквиты': 'sweets_world_cakes',
  'для стирки': 'household_chem_laundry',
  'уход за волосами и телом': 'beauty_hair_body',
  'колбасные изделия': 'meat_sausages',
  'для тела': 'beauty_body',
  '1001 майдучайда': 'household',
  'мороженое': 'sweets_world_icecream',
  'макароны': 'grocery_pasta',
  'игрушки': 'kids_toys',
  'конфеты в пачках': 'sweets_world_candy_pack',
  'приправы': 'oils_sauces_spices',
  'энергетические напитки': 'beverages_energy',
  'масло и уксус': 'oils_sauces_oil',
  'йогурт': 'dairy_yogurt',
  'кофе': 'tea_coffee_coffee',
  'соусы': 'oils_sauces_sauces',
  'для офиса и школы': 'stationery_office',
  'сосиски и сардельки': 'meat_wieners',
  'консервы овощные': 'conservation_canned_veg',
  'сухарики, гренки': 'snacks_croutons',
  'чай': 'tea_coffee_tea',
  'детское питание': 'kids_food',
  'детская гигиена': 'kids_hygiene',
  'краска для волос': 'beauty_hair_dye',
  'холодный чай': 'beverages_iced_tea',
  'зефир, маршмеллоу, мармелад': 'sweets_world_zephyr',
  'чипсы': 'snacks_chips',
  'майонез': 'oils_sauces_mayo',
  'жевательные резинки и леденци': 'sweets_world_gum',
  'жевательные резинки и леденцы': 'sweets_world_gum',
  'джем и варенье': 'conservation_jam',
  'шоколад': 'sweets_world_chocolate',
  'уход за полостью рта': 'beauty_oral',
  'сметана': 'dairy_sour_cream',
  'семечки': 'snacks_seeds',
  'масло и маргарин': 'dairy_butter',
  'дезодарант': 'beauty_deodorant',
  'дезодорант': 'beauty_deodorant',
  'сливки': 'dairy_cream',
  'сгущенное молоко': 'dairy_condensed',
  'сгущённое молоко': 'dairy_condensed',
  'ароматы для дома': 'household_chem_aroma',
  'кукрузные палочки': 'snacks_sticks',
  'кукурузные палочки': 'snacks_sticks',
  'столовая вода': 'beverages_table_water',
  'кухонная утварь и аксессуары': 'household_kitchenware',
  'минеральная вода': 'beverages_mineral',
  'орехи': 'snacks_nuts',
  'кефир и ряженка': 'dairy_kefir',
  'булочки': 'bakery_buns',
  'шоколадные батончики': 'sweets_world_bars',
  'попкорны': 'snacks_popcorn',
  'попкорн': 'snacks_popcorn',
  'крупа': 'grocery_cereals',
  'сыры': 'dairy_cheese',
  'аксессуары для красоты и гигиены': 'beauty_acc',
  'пельмени': 'frozen_dumplings',
  'соль, сода': 'oils_sauces_salt',
  'мука и дрож': 'grocery_flour',
  'мука и дрожжи': 'grocery_flour',
  'чакка': 'dairy_chakka',
  'влажные салфетки': 'beauty_wet_wipes',
  'бумажные изделия': 'beauty_paper',
  'творог': 'dairy_cottage',
  'котлеты': 'frozen_cutlets',
  'сахар, сахарная пудра': 'grocery_sugar',
  'средства для санузела': 'household_chem_bathroom',
  'средства для санузла': 'household_chem_bathroom',
  'печенье': 'bakery_cookies',
  'ватные изделия': 'beauty_cotton',
  'для бритья и депиляции': 'beauty_shaving',
  'детские аксессуары': 'kids_acc',
  'птица': 'meat_poultry',
  'птица (вес)': 'meat_poultry',
  'торт': 'bakery_cakes',
  'торты': 'bakery_cakes',
  'сырки': 'dairy_curd_snacks',
  'батарейки и фонарики': 'appliances_batteries',
  'уход за лицом': 'beauty_face',
  'консервы фруктовый': 'conservation_canned_fruit',
  'консервы фруктовые': 'conservation_canned_fruit',
  'сладкая вода': 'beverages_sweet',
  'парфюмерия': 'beauty_perfume',
  'хозтовары': 'household',
  'шоколадная и ореховая пасты': 'sweets_world_paste',
  'шоколадная и ореховая паста': 'sweets_world_paste',
  'строительные материалы': 'appliances_building',
  'косметика и гигиена': 'beauty',
  'посуда': 'household_dishes',
  'овоши': 'veg_fruit_vegetables',
  'овощи': 'veg_fruit_vegetables',
  'хлеб': 'bakery_bread',
  'кондитерские ингредиенты': 'bakery_ingredients',
  'казы': 'meat_kazy',
  'для готовки и хранения': 'household_cooking',
  'кремы': 'beauty_creams',
  'спички': 'household_matches',
  'какао и горячий шоколад': 'tea_coffee_cocoa',
  'кансервы мясные': 'conservation_canned_meat',
  'консервы мясные': 'conservation_canned_meat',
  'консервы рыбные': 'conservation_canned_fish',
  'консервация': 'conservation',
  'чай, кофе и какао': 'tea_coffee',
  'курассаны': 'sweets_world_croissants',
  'круассаны': 'sweets_world_croissants',
  'фарш и полуфабрикаты': 'meat_mince',
  'женская гигиена': 'beauty_feminine',
  'кабели и зарядные устройства': 'appliances_cables',
  'пончики': 'bakery_donuts',
  'конфеты (вес)': 'sweets_world_candy_bulk',
  'замороженные овощи и ягоды': 'frozen_veg',
  'полфабрикаты': 'frozen_semi',
  'полуфабрикаты': 'frozen_semi',
  'молоко': 'dairy_milk',
  'халва и ирис': 'sweets_world_halva',
  'пекарня': 'bakery',
  'фрукты и ягоды': 'veg_fruit_fruits',
  'мясо и птица': 'meat',
  'яйцо': 'dairy_eggs',
  'яйца': 'dairy_eggs',
  'для обуви': 'household_shoes',
  'техника для дома': 'appliances_home',
  'салфетки бумажные': 'beauty_paper_tissues',
  'лепешки': 'bakery_flatbread',
  'лепёшки': 'bakery_flatbread',
  'блинчики': 'frozen_pancakes',
  'драже': 'sweets_world_dragee',
  'для творчества': 'stationery_art',
  'грибы': 'conservation_mushrooms',
  'оливки и маслины': 'conservation_olives',
  'баранина': 'meat_lamb',
  'говядина': 'meat_beef',
  'мясные деликатесы': 'meat_deli',
  'зелень': 'veg_fruit_greens',
  'полотенца и халаты': 'household_chem_towels',
  'мёд': 'grocery_honey',
  'мед': 'grocery_honey',
  'техника для кухни': 'appliances_kitchen',
  'рыба замороженная': 'fish_frozen',
  'рыба копчёная': 'fish_smoked',
  'рыба копченая': 'fish_smoked',
}

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
  [/\bледенци\b/gi, 'Леденцы'],
  [/\bкукрузн/gi, 'Кукурузн'],
  [/\bкурассан/gi, 'Круассан'],
  [/\bполфабрик/gi, 'Полуфабрик'],
  [/\bдезодарант/gi, 'Дезодорант'],
]

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
    .replace(/["“”']/g, '«')
    .replace(/«\s+/g, '«')
    .replace(/\s+«/g, ' «')
    .replace(/«([^»]+)«/g, '«$1»')
    .replace(/«([^»]+)$/g, '«$1»')
}

function normalizeUnitToken(token) {
  const value = normalizeText(token)
  if (value === 'гр' || value === 'г') return 'г'
  if (value === 'мл') return 'мл'
  if (value === 'л') return 'л'
  if (value === 'кг') return 'кг'
  return 'шт'
}

/** Вынимает фасовку (л/мл/г/кг/шт) из названия → в unit; остальные размеры из имени убирает */
function extractPack(name) {
  const packRe = /(\d+(?:[.,]\d+)?)\s*(мл|л|гр|г|кг|шт)\.?/gi
  const found = []
  let m
  while ((m = packRe.exec(name)) !== null) {
    found.push({
      amount: String(m[1]).replace('.', ','),
      unit: normalizeUnitToken(m[2]),
      raw: m[0],
      index: m.index,
    })
  }
  if (!found.length) return { name, unit: 'шт' }

  // приоритет: объём/вес, иначе первое вхождение
  const preferred = found.find(f => f.unit !== 'шт') || found[0]
  const cleaned = clean(
    name.replace(packRe, ' ').replace(/\s{2,}/g, ' ').replace(/^[,.\-–—]+|[,.\-–—]+$/g, ''),
  )
  return {
    name: cleaned || name,
    unit: `${preferred.amount} ${preferred.unit}`,
  }
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
    return { name: exact, unit: weighted ? 'кг' : packed.unit }
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
  return { name, unit: weighted ? 'кг' : packed.unit }
}

function hasAny(text, needles) {
  return needles.some(needle => text.includes(needle))
}

function classifyWeightedByName(name) {
  if (hasAny(name, ['чой', 'чай'])) return 'tea_coffee_tea'
  if (hasAny(name, ['чипс', 'чипси'])) return 'snacks_chips'
  if (hasAny(name, ['бодом', 'кешу', 'чормагз', 'писта', 'пистаи', 'дони каду', 'орех', 'семеч', 'фисташ'])) return 'snacks_nuts'
  if (hasAny(name, ['ангур', 'хурмо', 'нок', 'мавиз', 'арбуз', 'дын', 'лимон', 'апельс', 'мандарин', 'яблок', 'банан', 'виноград', 'груш', 'персик', 'абрикос', 'слив', 'киви', 'анор', 'афлесун', 'шафтолу', 'себи', 'занчабил', 'тарбуз', 'харбуз'])) return 'veg_fruit_fruits'
  if (hasAny(name, ['пиёз', 'гулкарам', 'сабзи', 'бодринг', 'капуст', 'карто', 'лук', 'морков', 'огур', 'помидор', 'томат', 'чеснок', 'перец', 'свекл', 'тыкв', 'гулинг', 'кандалот', 'лаблабу', 'бакладжан', 'сан г', 'пиёзи'])) return 'veg_fruit_vegetables'
  if (hasAny(name, ['нахут', 'нахуди', 'рис', 'приловка', 'греч', 'перлов', 'мош', 'луби', 'наск', 'горох', 'макарон', 'крупа'])) return 'grocery_cereals'
  if (hasAny(name, ['шакар', 'набот', 'канди', 'сахар'])) return 'grocery_sugar'
  if (hasAny(name, ['сыр', 'шири кок', 'сухое молоко'])) return 'dairy_cheese'
  if (hasAny(name, ['мохи', 'говяд', 'баран', 'мяс', 'фарш'])) return 'meat_beef'
  if (hasAny(name, ['колбас', 'сосиск', 'сардел', 'казы'])) return 'meat_sausages'
  if (hasAny(name, ['кур', 'индей', 'голень', 'филе', 'бедро', 'окороч', 'птиц'])) return 'meat_poultry'
  if (hasAny(name, ['конфет', 'мармел', 'зефир', 'пахлава', 'халва', 'бублик'])) return 'sweets_world_candy_bulk'
  if (hasAny(name, ['шоколад', 'школад'])) return 'sweets_world_chocolate'
  if (hasAny(name, ['печень', 'вафл', 'пряник', 'вафел'])) return 'sweets_world_cookies_wafers'
  if (hasAny(name, ['кофе'])) return 'tea_coffee_coffee'
  if (hasAny(name, ['молок', 'кефир', 'сметан', 'йогурт'])) return 'dairy_milk'
  return 'household'
}

function resolveCategorySlug(sourceCategory, sourceName, weighted) {
  const cat = normalizeText(sourceCategory)
  const name = normalizeText(sourceName)

  if (Object.prototype.hasOwnProperty.call(CSV_EXACT_GROUP, cat)) {
    const mapped = CSV_EXACT_GROUP[cat]
    if (mapped) return mapped
    return classifyWeightedByName(name)
  }

  if (CSV_GROUP_TO_SLUG[cat]) return CSV_GROUP_TO_SLUG[cat]

  if (cat.includes('весов')) {
    if (cat.includes('колбас')) return 'meat_sausages'
    if (cat.includes('сосиск')) return 'meat_wieners'
    return classifyWeightedByName(name)
  }

  if (weighted) return classifyWeightedByName(name)
  return 'household'
}

/** Основной + дополнительные штрихкоды из ячейки (через , ; / | пробел) */
function parseBarcodes(...rawParts) {
  const out = []
  const seen = new Set()
  for (const raw of rawParts) {
    const chunks = String(raw ?? '')
      .split(/[,;/|]+|\s+/)
      .map(s => digits(s))
      .filter(Boolean)
    for (const code of chunks) {
      if (code.length < 4) continue
      if (seen.has(code)) continue
      seen.add(code)
      out.push(code)
    }
  }
  return out
}

function parseCsv(file) {
  const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  const lines = raw.split(/\r?\n/).filter(line => line.trim())
  const header = (lines[0] || '').split(';').map(h => normalizeText(h))
  const barcodeExtraIdx = header.findIndex(h =>
    h.includes('доп') && h.includes('штрих')
    || h === 'штрихкоды'
    || h === 'barcodes'
    || h === 'дополнительные штрихкоды'
  )

  const rows = []
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(';')
    const extraRaw = barcodeExtraIdx >= 0 ? parts[barcodeExtraIdx] : ''
    rows.push({
      sourceLine: i + 1,
      barcodes: parseBarcodes(parts[1], extraRaw),
      sourceCategory: clean(parts[2]),
      sourceName: clean(parts[3]),
      stockRaw: clean(parts[4]),
      priceRaw: clean(parts[5]),
      costRaw: clean(parts[6]),
      pluRaw: digits(parts[7]).slice(0, 4),
    })
  }
  return rows
}

function main() {
  if (!existsSync(sourceFile)) {
    throw new Error(`CSV не найден: ${sourceFile}`)
  }

  const rows = parseCsv(sourceFile)
  const db = loadDb()
  const backup = backupDatabaseFile()
  const reset = resetOperationalData(db, { reseedCategories: true })
  db._categorySeedVersion = 3
  const bySlug = categoryMap(db.categories)

  const stats = {
    imported: 0,
    weighted: 0,
    piece: 0,
    stockFixedToZero: 0,
    zeroPrice: 0,
    generatedBarcodes: 0,
    keptBarcodes: 0,
    extraBarcodes: 0,
    keptPlu: 0,
    generatedPlu: 0,
    duplicatePlu: 0,
    duplicateBarcode: 0,
    byCategory: new Map(),
    unmappedCats: new Map(),
  }

  let nextArt = 1

  for (const row of rows) {
    const weighted = /вес/i.test(row.sourceCategory) || /вес/i.test(row.sourceName)
    const categorySlug = resolveCategorySlug(row.sourceCategory, row.sourceName, weighted)
    if (!bySlug.has(categorySlug)) {
      stats.unmappedCats.set(row.sourceCategory, (stats.unmappedCats.get(row.sourceCategory) || 0) + 1)
    }
    const category = bySlug.get(categorySlug) || bySlug.get('household')
    const { name, unit } = cleanProductName(row.sourceName, weighted)
    const requestedStock = round3(parseNumber(row.stockRaw))
    const stock = Math.max(0, requestedStock)
    const price = parseNumber(row.priceRaw)
    const costPrice = parseNumber(row.costRaw)

    const art = String(nextArt)
    nextArt += 1

    let requestedPlu = row.pluRaw
    if (requestedPlu && isPluTaken(db.products, requestedPlu)) {
      requestedPlu = ''
      stats.duplicatePlu += 1
    }
    let plu
    if (requestedPlu) {
      plu = requestedPlu
      stats.keptPlu += 1
    } else if (weighted) {
      // минимальный свободный PLU (и не конфликтует с уже выданными артикулами как PLU)
      let n = nextFreeProductCode(db.products)
      while (n <= 9999 && isPluTaken(db.products, String(n))) n += 1
      plu = n <= 9999 ? String(n) : undefined
      stats.generatedPlu += 1
    }

    const sourceBars = row.barcodes
    let barcode
    let barcodes = []
    let usedFallback = false
    try {
      const bars = allocateProductBarcodes(
        db.products,
        {
          barcode: sourceBars[0] || '',
          barcodes: sourceBars.slice(1),
        },
        Number(art),
        null,
        { autoIfEmpty: true },
      )
      barcode = bars.barcode
      barcodes = bars.barcodes || []
      if (!sourceBars.length || bars.barcode !== sourceBars[0]) {
        stats.generatedBarcodes += 1
        usedFallback = !sourceBars.length
      } else {
        stats.keptBarcodes += 1
      }
      if (sourceBars.length > 1) stats.extraBarcodes += sourceBars.length - 1
    } catch {
      const bars = allocateProductBarcodes(db.products, { barcode: '' }, Number(art), null, { autoIfEmpty: true })
      barcode = bars.barcode
      barcodes = bars.barcodes || []
      stats.duplicateBarcode += 1
      stats.generatedBarcodes += 1
      usedFallback = true
    }
    void usedFallback

    const product = {
      id: ++db._seq.product,
      art,
      e: category?.emoji || '📦',
      name,
      price,
      costPrice: costPrice > 0 ? costPrice : null,
      cat: category?.name || 'Хозтовары',
      catId: category?.slug || 'household',
      unit,
      stock: 0,
      hot: false,
      barcode,
      barcodes: barcodes.length ? barcodes : undefined,
      plu,
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
    if (stock > 0) {
      setProductStockExact(db, product.id, stock, { reason: 'Импорт CSV', createdBy: 'importProductsCsv' })
    }
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
  console.log('Сохранено сотрудников/клиентов/карт:', reset.kept)
  console.log('Товаров:', stats.imported)
  console.log('Весовых:', stats.weighted, '| Штучных:', stats.piece)
  console.log('Артикулы: 1 …', nextArt - 1)
  console.log('PLU сохранено:', stats.keptPlu, '| PLU сгенерировано:', stats.generatedPlu, '| конфликтов PLU:', stats.duplicatePlu)
  console.log('Штрихкоды сохранены:', stats.keptBarcodes, '| сгенерировано:', stats.generatedBarcodes, '| доп.:', stats.extraBarcodes, '| конфликтов:', stats.duplicateBarcode)
  console.log('Отрицательные остатки -> 0:', stats.stockFixedToZero, '| Нулевая цена:', stats.zeroPrice)
  console.log('База:', getDbFilePath())
  console.log('Категории (топ):')
  for (const [name, count] of [...stats.byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`  ${String(count).padStart(4, ' ')} ${name}`)
  }
  if (stats.unmappedCats.size) {
    console.log('Без точного slug (ушло в fallback):')
    for (const [name, count] of [...stats.unmappedCats.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(4, ' ')} ${name}`)
    }
  }
}

main()
