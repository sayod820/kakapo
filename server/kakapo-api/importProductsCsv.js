import { copyFileSync, existsSync, readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

import { loadDb, saveDb, getDbFilePath } from './db.js'
import { allocateProductBarcodes, allocateProductCodes, isPluTaken, nextFreeProductCode } from './productCodes.js'
import { setProductStockExact } from './posLogic.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const ROOT = resolve(__dirname, '../..')
const DEFAULT_CSV = resolve(ROOT, '../products.csv')
const sourceFile = resolve(process.argv[2] || DEFAULT_CSV)

const CATEGORY_SEED = [
  { slug: 'veg', emoji: '🥦', name: 'Овощи и фрукты', parentSlug: null, order: 1 },
  { slug: 'veg_ov', emoji: '🥕', name: 'Овощи', parentSlug: 'veg', order: 1 },
  { slug: 'veg_fr', emoji: '🍊', name: 'Фрукты и ягоды', parentSlug: 'veg', order: 2 },
  { slug: 'meat', emoji: '🥩', name: 'Мясо и птица', parentSlug: null, order: 2 },
  { slug: 'meat_b', emoji: '🥩', name: 'Мясо', parentSlug: 'meat', order: 1 },
  { slug: 'meat_p', emoji: '🍗', name: 'Птица', parentSlug: 'meat', order: 2 },
  { slug: 'meat_k', emoji: '🌭', name: 'Колбасные изделия', parentSlug: 'meat', order: 3 },
  { slug: 'dairy', emoji: '🥛', name: 'Молочное', parentSlug: null, order: 3 },
  { slug: 'dairy_m', emoji: '🥛', name: 'Молоко и сливки', parentSlug: 'dairy', order: 1 },
  { slug: 'dairy_f', emoji: '🥣', name: 'Кисломолочные продукты', parentSlug: 'dairy', order: 2 },
  { slug: 'dairy_s', emoji: '🧀', name: 'Сыры и творог', parentSlug: 'dairy', order: 3 },
  { slug: 'dairy_e', emoji: '🥚', name: 'Яйца', parentSlug: 'dairy', order: 4 },
  { slug: 'bread', emoji: '🥐', name: 'Выпечка и хлеб', parentSlug: null, order: 4 },
  { slug: 'bread_h', emoji: '🍞', name: 'Хлеб и лепёшки', parentSlug: 'bread', order: 1 },
  { slug: 'bread_b', emoji: '🥐', name: 'Булочки и выпечка', parentSlug: 'bread', order: 2 },
  { slug: 'drinks', emoji: '🧃', name: 'Напитки', parentSlug: null, order: 5 },
  { slug: 'drinks_w', emoji: '💧', name: 'Вода', parentSlug: 'drinks', order: 1 },
  { slug: 'drinks_s', emoji: '🥤', name: 'Газировка', parentSlug: 'drinks', order: 2 },
  { slug: 'drinks_j', emoji: '🧃', name: 'Соки и нектары', parentSlug: 'drinks', order: 3 },
  { slug: 'drinks_t', emoji: '🍵', name: 'Чай', parentSlug: 'drinks', order: 4 },
  { slug: 'drinks_c', emoji: '☕', name: 'Кофе и какао', parentSlug: 'drinks', order: 5 },
  { slug: 'drinks_e', emoji: '⚡', name: 'Энергетики', parentSlug: 'drinks', order: 6 },
  { slug: 'sweets', emoji: '🍫', name: 'Сладости', parentSlug: null, order: 6 },
  { slug: 'sweets_c', emoji: '🍬', name: 'Конфеты и мармелад', parentSlug: 'sweets', order: 1 },
  { slug: 'sweets_ch', emoji: '🍫', name: 'Шоколад', parentSlug: 'sweets', order: 2 },
  { slug: 'sweets_b', emoji: '🍪', name: 'Печенье и вафли', parentSlug: 'sweets', order: 3 },
  { slug: 'sweets_k', emoji: '🧁', name: 'Кексы и торты', parentSlug: 'sweets', order: 4 },
  { slug: 'sweets_g', emoji: '🍭', name: 'Жвачка и леденцы', parentSlug: 'sweets', order: 5 },
  { slug: 'snacks', emoji: '🍿', name: 'Снеки', parentSlug: null, order: 7 },
  { slug: 'snacks_s', emoji: '🍟', name: 'Чипсы и сухарики', parentSlug: 'snacks', order: 1 },
  { slug: 'snacks_p', emoji: '🍿', name: 'Попкорн и палочки', parentSlug: 'snacks', order: 2 },
  { slug: 'grocery', emoji: '🧂', name: 'Бакалея', parentSlug: null, order: 8 },
  { slug: 'grocery_p', emoji: '🍝', name: 'Макароны и крупы', parentSlug: 'grocery', order: 1 },
  { slug: 'grocery_s', emoji: '🧂', name: 'Приправы, соль и сода', parentSlug: 'grocery', order: 2 },
  { slug: 'grocery_o', emoji: '🫗', name: 'Масло, уксус и соусы', parentSlug: 'grocery', order: 3 },
  { slug: 'grocery_c', emoji: '🥫', name: 'Консервы', parentSlug: 'grocery', order: 4 },
  { slug: 'grocery_f', emoji: '🌾', name: 'Мука, дрожжи и сахар', parentSlug: 'grocery', order: 5 },
  { slug: 'grocery_n', emoji: '🥜', name: 'Орехи и семечки', parentSlug: 'grocery', order: 6 },
  { slug: 'grocery_j', emoji: '🍯', name: 'Джемы и пасты', parentSlug: 'grocery', order: 7 },
  { slug: 'frozen', emoji: '🧊', name: 'Заморозка', parentSlug: null, order: 9 },
  { slug: 'frozen_i', emoji: '🍨', name: 'Мороженое', parentSlug: 'frozen', order: 1 },
  { slug: 'frozen_r', emoji: '🥟', name: 'Полуфабрикаты', parentSlug: 'frozen', order: 2 },
  { slug: 'frozen_v', emoji: '🫛', name: 'Замороженные овощи', parentSlug: 'frozen', order: 3 },
  { slug: 'kids', emoji: '🧸', name: 'Детские товары', parentSlug: null, order: 10 },
  { slug: 'kids_f', emoji: '🍼', name: 'Детское питание', parentSlug: 'kids', order: 1 },
  { slug: 'kids_h', emoji: '🧷', name: 'Детская гигиена', parentSlug: 'kids', order: 2 },
  { slug: 'kids_t', emoji: '🧸', name: 'Игрушки', parentSlug: 'kids', order: 3 },
  { slug: 'kids_a', emoji: '🎈', name: 'Детские аксессуары', parentSlug: 'kids', order: 4 },
  { slug: 'house', emoji: '🧴', name: 'Бытовая химия', parentSlug: null, order: 11 },
  { slug: 'house_l', emoji: '🧺', name: 'Для стирки', parentSlug: 'house', order: 1 },
  { slug: 'house_c', emoji: '🧽', name: 'Для уборки', parentSlug: 'house', order: 2 },
  { slug: 'house_p', emoji: '🧻', name: 'Бумажные товары', parentSlug: 'house', order: 3 },
  { slug: 'house_a', emoji: '🌸', name: 'Ароматы для дома', parentSlug: 'house', order: 4 },
  { slug: 'beauty', emoji: '🪥', name: 'Красота и гигиена', parentSlug: null, order: 12 },
  { slug: 'beauty_b', emoji: '🧼', name: 'Уход за телом', parentSlug: 'beauty', order: 1 },
  { slug: 'beauty_h', emoji: '🧴', name: 'Уход за волосами', parentSlug: 'beauty', order: 2 },
  { slug: 'beauty_o', emoji: '🪥', name: 'Уход за полостью рта', parentSlug: 'beauty', order: 3 },
  { slug: 'beauty_s', emoji: '🪒', name: 'Бритьё и депиляция', parentSlug: 'beauty', order: 4 },
  { slug: 'beauty_d', emoji: '💨', name: 'Дезодоранты', parentSlug: 'beauty', order: 5 },
  { slug: 'beauty_w', emoji: '🩷', name: 'Женская гигиена', parentSlug: 'beauty', order: 6 },
  { slug: 'beauty_f', emoji: '🧴', name: 'Уход за лицом', parentSlug: 'beauty', order: 7 },
  { slug: 'beauty_c', emoji: '💄', name: 'Косметика и парфюмерия', parentSlug: 'beauty', order: 8 },
  { slug: 'home', emoji: '🏠', name: 'Товары для дома', parentSlug: null, order: 13 },
  { slug: 'home_k', emoji: '🍽️', name: 'Кухня и посуда', parentSlug: 'home', order: 1 },
  { slug: 'home_o', emoji: '📚', name: 'Офис и школа', parentSlug: 'home', order: 2 },
  { slug: 'home_b', emoji: '🔋', name: 'Батарейки и фонарики', parentSlug: 'home', order: 3 },
  { slug: 'home_e', emoji: '🔌', name: 'Кабели и техника', parentSlug: 'home', order: 4 },
  { slug: 'home_r', emoji: '🔧', name: 'Ремонт и стройка', parentSlug: 'home', order: 5 },
  { slug: 'home_sh', emoji: '👞', name: 'Для обуви', parentSlug: 'home', order: 6 },
  { slug: 'other', emoji: '📦', name: 'Прочее', parentSlug: null, order: 99 },
]

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

function buildCategories(seq) {
  const slugToId = new Map()
  const rows = []
  for (const item of CATEGORY_SEED.filter(cat => !cat.parentSlug)) {
    const id = ++seq.category
    slugToId.set(item.slug, id)
    rows.push({
      id,
      slug: item.slug,
      name: item.name,
      emoji: item.emoji,
      desc: item.name,
      parent_id: null,
      order: item.order,
      active: true,
    })
  }
  for (const item of CATEGORY_SEED.filter(cat => cat.parentSlug)) {
    const id = ++seq.category
    slugToId.set(item.slug, id)
    rows.push({
      id,
      slug: item.slug,
      name: item.name,
      emoji: item.emoji,
      desc: item.name,
      parent_id: slugToId.get(item.parentSlug) ?? null,
      order: item.order,
      active: true,
    })
  }
  return rows
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

function classifyCategory(sourceCategory, sourceName, weighted) {
  const cat = normalizeText(sourceCategory)
  const name = normalizeText(sourceName)

  if (hasAny(cat, ['игрушк'])) return 'kids_t'
  if (hasAny(cat, ['детск']) && hasAny(cat, ['питан'])) return 'kids_f'
  if (hasAny(cat, ['детск']) && hasAny(cat, ['гигиен'])) return 'kids_h'
  if (hasAny(cat, ['детск']) && hasAny(cat, ['аксессуар'])) return 'kids_a'
  if (hasAny(cat, ['колбас', 'сосиск', 'сардел', 'казы'])) return 'meat_k'
  if (hasAny(cat, ['птиц'])) return 'meat_p'
  if (hasAny(cat, ['мяс', 'фарш'])) return 'meat_b'
  if (hasAny(cat, ['сливк', 'молок'])) return 'dairy_m'
  if (hasAny(cat, ['кефир', 'ряжен', 'йогурт', 'сметан', 'сгущ'])) return 'dairy_f'
  if (hasAny(cat, ['сыр', 'творог', 'сырк'])) return 'dairy_s'
  if (hasAny(cat, ['яйц'])) return 'dairy_e'
  if (hasAny(cat, ['хлеб', 'лепеш'])) return 'bread_h'
  if (hasAny(cat, ['булоч', 'пекарн', 'круассан', 'пончик'])) return 'bread_b'
  if (hasAny(cat, ['вода'])) return 'drinks_w'
  if (hasAny(cat, ['газир', 'сладкая вода'])) return 'drinks_s'
  if (hasAny(cat, ['сок', 'нектар', 'морс'])) return 'drinks_j'
  if (hasAny(cat, ['чай'])) return 'drinks_t'
  if (hasAny(cat, ['кофе', 'какао'])) return 'drinks_c'
  if (hasAny(cat, ['энергет'])) return 'drinks_e'
  if (hasAny(cat, ['конфет'])) return 'sweets_c'
  if (hasAny(cat, ['шоколад'])) return 'sweets_ch'
  if (hasAny(cat, ['печень', 'вафл', 'пряник'])) return 'sweets_b'
  if (hasAny(cat, ['кекс', 'рулет', 'бисквит', 'торт'])) return 'sweets_k'
  if (hasAny(cat, ['зефир', 'маршмел', 'мармелад', 'халва', 'ирис'])) return 'sweets_c'
  if (hasAny(cat, ['жеватель', 'леден'])) return 'sweets_g'
  if (hasAny(cat, ['чипс', 'сухарик', 'гренк'])) return 'snacks_s'
  if (hasAny(cat, ['попкорн', 'кукурузн'])) return 'snacks_p'
  if (hasAny(cat, ['макарон', 'круп'])) return 'grocery_p'
  if (hasAny(cat, ['приправ', 'соль', 'сода'])) return 'grocery_s'
  if (hasAny(cat, ['масло', 'уксус', 'соус', 'майонез'])) return 'grocery_o'
  if (hasAny(cat, ['консерв', 'консервац'])) return 'grocery_c'
  if (hasAny(cat, ['мука', 'дрож', 'сахар'])) return 'grocery_f'
  if (hasAny(cat, ['орех', 'семеч'])) return 'grocery_n'
  if (hasAny(cat, ['джем', 'варень', 'паст'])) return 'grocery_j'
  if (hasAny(cat, ['морожен'])) return 'frozen_i'
  if (hasAny(cat, ['пельмен', 'котлет', 'полуфабрикат'])) return 'frozen_r'
  if (hasAny(cat, ['заморожен'])) return 'frozen_v'
  if (hasAny(cat, ['стирк'])) return 'house_l'
  if (hasAny(cat, ['сануз', 'уборк'])) return 'house_c'
  if (hasAny(cat, ['бумаж', 'салфет', 'ватн'])) return 'house_p'
  if (hasAny(cat, ['аромат'])) return 'house_a'
  if (hasAny(cat, ['для тела'])) return 'beauty_b'
  if (hasAny(cat, ['волос', 'краска'])) return 'beauty_h'
  if (hasAny(cat, ['полостью рта'])) return 'beauty_o'
  if (hasAny(cat, ['брить', 'депиляц'])) return 'beauty_s'
  if (hasAny(cat, ['дезодорант'])) return 'beauty_d'
  if (hasAny(cat, ['женская'])) return 'beauty_w'
  if (hasAny(cat, ['лицом', 'крем'])) return 'beauty_f'
  if (hasAny(cat, ['косметик', 'парфюмер'])) return 'beauty_c'
  if (hasAny(cat, ['кухон', 'посуда', 'готовки', 'хранения', 'хозтовар'])) return 'home_k'
  if (hasAny(cat, ['офиса', 'школ'])) return 'home_o'
  if (hasAny(cat, ['батарей', 'фонар'])) return 'home_b'
  if (hasAny(cat, ['кабел', 'техник'])) return 'home_e'
  if (hasAny(cat, ['строитель'])) return 'home_r'
  if (hasAny(cat, ['обув'])) return 'home_sh'

  if (weighted) {
    if (hasAny(name, ['чой', 'чай'])) return 'drinks_t'
    if (hasAny(name, ['чипс', 'чипси'])) return 'snacks_s'
    if (hasAny(name, ['бодом', 'кешу', 'чормагз', 'писта', 'пистаи', 'дони каду'])) return 'grocery_n'
    if (hasAny(name, ['ангур', 'хурмо', 'нок', 'мавиз'])) return 'veg_fr'
    if (hasAny(name, ['пиёз', 'гулкарам', 'сабзи', 'бодринг'])) return 'veg_ov'
    if (hasAny(name, ['нахут', 'нахуди', 'рис', 'приловка'])) return 'grocery_p'
    if (hasAny(name, ['шакар', 'набот', 'канди'])) return 'grocery_f'
    if (hasAny(name, ['сыр', 'шири кок', 'сухое молоко'])) return 'dairy_s'
    if (hasAny(name, ['мохи'])) return 'meat_b'
    if (hasAny(name, ['арбуз', 'дын', 'лимон', 'апельс', 'мандарин', 'яблок', 'банан', 'виноград', 'груш', 'персик', 'абрикос', 'слив'])) return 'veg_fr'
    if (hasAny(name, ['капуст', 'карто', 'лук', 'морков', 'огур', 'помидор', 'томат', 'чеснок', 'перец', 'свекл', 'тыкв'])) return 'veg_ov'
    if (hasAny(name, ['колбас', 'сосиск', 'сардел', 'казы'])) return 'meat_k'
    if (hasAny(name, ['кур', 'индей', 'голень', 'филе', 'бедро', 'окороч'])) return 'meat_p'
    if (hasAny(name, ['мяс', 'говяд', 'баран', 'фарш'])) return 'meat_b'
    if (hasAny(name, ['конфет', 'мармел', 'зефир'])) return 'sweets_c'
    if (hasAny(name, ['шоколад'])) return 'sweets_ch'
    if (hasAny(name, ['печень', 'вафл', 'пряник'])) return 'sweets_b'
    if (hasAny(name, ['чай'])) return 'drinks_t'
    if (hasAny(name, ['кофе'])) return 'drinks_c'
    if (hasAny(name, ['фисташ', 'орех', 'семеч'])) return 'grocery_n'
  }

  return 'other'
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
  db.categories = buildCategories(db._seq)
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
