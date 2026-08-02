/**
 * Генерация единого сида категорий (фото + исправленная грамматика).
 * node scripts/generate-market-categories-seed.mjs
 */
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

/** @type {Array<{ emoji: string, name: string, slug: string, children: Array<{ name: string, slug?: string }> }>} */
const TREE = [
  {
    emoji: '🐟', name: 'Рыба и морепродукты', slug: 'fish',
    children: [
      { name: 'Рыба замороженная', slug: 'fish_frozen' },
      { name: 'Рыба копчёная', slug: 'fish_smoked' },
    ],
  },
  {
    emoji: '👶', name: 'Товары для детей', slug: 'kids',
    children: [
      { name: 'Детская гигиена', slug: 'kids_hygiene' },
      { name: 'Детские аксессуары', slug: 'kids_acc' },
      { name: 'Детское питание', slug: 'kids_food' },
      { name: 'Игрушки', slug: 'kids_toys' },
    ],
  },
  {
    emoji: '🏠', name: 'Хозтовары', slug: 'household',
    children: [
      { name: 'Для готовки и хранения', slug: 'household_cooking' },
      { name: 'Для обуви', slug: 'household_shoes' },
      { name: 'Кухонная утварь и аксессуары', slug: 'household_kitchenware' },
      { name: 'Посуда', slug: 'household_dishes' },
      { name: 'Спички', slug: 'household_matches' },
    ],
  },
  {
    emoji: '💄', name: 'Косметика и гигиена', slug: 'beauty',
    children: [
      { name: 'Аксессуары для красоты и гигиены', slug: 'beauty_acc' },
      { name: 'Бумажные изделия', slug: 'beauty_paper' },
      { name: 'Ватные изделия', slug: 'beauty_cotton' },
      { name: 'Влажные салфетки', slug: 'beauty_wet_wipes' },
      { name: 'Дезодорант', slug: 'beauty_deodorant' },
      { name: 'Для бритья и депиляции', slug: 'beauty_shaving' },
      { name: 'Для тела', slug: 'beauty_body' },
      { name: 'Женская гигиена', slug: 'beauty_feminine' },
      { name: 'Краска для волос', slug: 'beauty_hair_dye' },
      { name: 'Кремы', slug: 'beauty_creams' },
      { name: 'Парфюмерия', slug: 'beauty_perfume' },
      { name: 'Салфетки бумажные', slug: 'beauty_paper_tissues' },
      { name: 'Средства после бритья', slug: 'beauty_aftershave' },
      { name: 'Уход за волосами и телом', slug: 'beauty_hair_body' },
      { name: 'Уход за лицом', slug: 'beauty_face' },
      { name: 'Уход за полостью рта', slug: 'beauty_oral' },
    ],
  },
  {
    emoji: '🥤', name: 'Вода и напитки', slug: 'beverages',
    children: [
      { name: 'Газированный напиток', slug: 'beverages_soda' },
      { name: 'Минеральная вода', slug: 'beverages_mineral' },
      { name: 'Сладкая вода', slug: 'beverages_sweet' },
      { name: 'Сок, нектар, морс', slug: 'beverages_juice' },
      { name: 'Столовая вода', slug: 'beverages_table_water' },
      { name: 'Холодный чай', slug: 'beverages_iced_tea' },
      { name: 'Энергетические напитки', slug: 'beverages_energy' },
    ],
  },
  {
    emoji: '🧊', name: 'Замороженные продукты', slug: 'frozen',
    children: [
      { name: 'Блинчики', slug: 'frozen_pancakes' },
      { name: 'Замороженные овощи и ягоды', slug: 'frozen_veg' },
      { name: 'Котлеты', slug: 'frozen_cutlets' },
      { name: 'Пельмени', slug: 'frozen_dumplings' },
      { name: 'Полуфабрикаты', slug: 'frozen_semi' },
    ],
  },
  {
    emoji: '🥛', name: 'Молочные продукты', slug: 'dairy',
    children: [
      { name: 'Йогурт', slug: 'dairy_yogurt' },
      { name: 'Кефир и ряженка', slug: 'dairy_kefir' },
      { name: 'Масло и маргарин', slug: 'dairy_butter' },
      { name: 'Молоко', slug: 'dairy_milk' },
      { name: 'Сгущённое молоко', slug: 'dairy_condensed' },
      { name: 'Сливки', slug: 'dairy_cream' },
      { name: 'Сметана', slug: 'dairy_sour_cream' },
      { name: 'Сырки', slug: 'dairy_curd_snacks' },
      { name: 'Сыры', slug: 'dairy_cheese' },
      { name: 'Творог', slug: 'dairy_cottage' },
      { name: 'Чакка', slug: 'dairy_chakka' },
      { name: 'Яйца', slug: 'dairy_eggs' },
    ],
  },
  {
    emoji: '☕', name: 'Чай, кофе и какао', slug: 'tea_coffee',
    children: [
      { name: 'Какао и горячий шоколад', slug: 'tea_coffee_cocoa' },
      { name: 'Кофе', slug: 'tea_coffee_coffee' },
      { name: 'Чай', slug: 'tea_coffee_tea' },
    ],
  },
  {
    emoji: '🍿', name: 'Орехи, чипсы и снеки', slug: 'snacks',
    children: [
      { name: 'Кукурузные палочки', slug: 'snacks_sticks' },
      { name: 'Орехи', slug: 'snacks_nuts' },
      { name: 'Попкорн', slug: 'snacks_popcorn' },
      { name: 'Семечки', slug: 'snacks_seeds' },
      { name: 'Сухарики, гренки', slug: 'snacks_croutons' },
      { name: 'Сухофрукты', slug: 'snacks_dried_fruit' },
      { name: 'Чипсы', slug: 'snacks_chips' },
    ],
  },
  {
    emoji: '🥐', name: 'Пекарня', slug: 'bakery',
    children: [
      { name: 'Булочки', slug: 'bakery_buns' },
      { name: 'Кондитерские ингредиенты', slug: 'bakery_ingredients' },
      { name: 'Лепёшки', slug: 'bakery_flatbread' },
      { name: 'Печенье', slug: 'bakery_cookies' },
      { name: 'Пончики', slug: 'bakery_donuts' },
      { name: 'Торты', slug: 'bakery_cakes' },
      { name: 'Хлеб', slug: 'bakery_bread' },
    ],
  },
  {
    emoji: '✏️', name: 'Канцтовары', slug: 'stationery',
    children: [
      { name: 'Для офиса и школы', slug: 'stationery_office' },
      { name: 'Для творчества', slug: 'stationery_art' },
    ],
  },
  {
    emoji: '🥫', name: 'Консервация', slug: 'conservation',
    children: [
      { name: 'Грибы', slug: 'conservation_mushrooms' },
      { name: 'Джем и варенье', slug: 'conservation_jam' },
      { name: 'Консервы мясные', slug: 'conservation_canned_meat' },
      { name: 'Консервы овощные', slug: 'conservation_canned_veg' },
      { name: 'Консервы рыбные', slug: 'conservation_canned_fish' },
      { name: 'Консервы фруктовые', slug: 'conservation_canned_fruit' },
      { name: 'Оливки и маслины', slug: 'conservation_olives' },
    ],
  },
  {
    emoji: '🥩', name: 'Мясо и птица', slug: 'meat',
    children: [
      { name: 'Баранина', slug: 'meat_lamb' },
      { name: 'Говядина', slug: 'meat_beef' },
      { name: 'Казы', slug: 'meat_kazy' },
      { name: 'Колбасные изделия', slug: 'meat_sausages' },
      { name: 'Мясные деликатесы', slug: 'meat_deli' },
      { name: 'Птица', slug: 'meat_poultry' },
      { name: 'Сосиски и сардельки', slug: 'meat_wieners' },
      { name: 'Фарш и полуфабрикаты', slug: 'meat_mince' },
    ],
  },
  {
    emoji: '🥬', name: 'Овощи и фрукты', slug: 'veg_fruit',
    children: [
      { name: 'Зелень', slug: 'veg_fruit_greens' },
      { name: 'Овощи', slug: 'veg_fruit_vegetables' },
      { name: 'Фрукты и ягоды', slug: 'veg_fruit_fruits' },
    ],
  },
  {
    emoji: '🧂', name: 'Масла, соусы и соль', slug: 'oils_sauces',
    children: [
      { name: 'Майонез', slug: 'oils_sauces_mayo' },
      { name: 'Масло и уксус', slug: 'oils_sauces_oil' },
      { name: 'Приправы', slug: 'oils_sauces_spices' },
      { name: 'Соль, сода', slug: 'oils_sauces_salt' },
      { name: 'Соусы', slug: 'oils_sauces_sauces' },
    ],
  },
  {
    emoji: '🧴', name: 'Бытовая химия', slug: 'household_chem',
    children: [
      { name: 'Ароматы для дома', slug: 'household_chem_aroma' },
      { name: 'Для стирки', slug: 'household_chem_laundry' },
      { name: 'Полотенца и халаты', slug: 'household_chem_towels' },
      { name: 'Средства для санузла', slug: 'household_chem_bathroom' },
    ],
  },
  {
    emoji: '🌾', name: 'Бакалея', slug: 'grocery',
    children: [
      { name: 'Крупа', slug: 'grocery_cereals' },
      { name: 'Макароны', slug: 'grocery_pasta' },
      { name: 'Мёд', slug: 'grocery_honey' },
      { name: 'Мука и дрожжи', slug: 'grocery_flour' },
      { name: 'Сахар, сахарная пудра', slug: 'grocery_sugar' },
    ],
  },
  {
    emoji: '🔌', name: 'Бытовая техника', slug: 'appliances',
    children: [
      { name: 'Батарейки и фонарики', slug: 'appliances_batteries' },
      { name: 'Кабели и зарядные устройства', slug: 'appliances_cables' },
      { name: 'Строительные материалы', slug: 'appliances_building' },
      { name: 'Техника для дома', slug: 'appliances_home' },
      { name: 'Техника для кухни', slug: 'appliances_kitchen' },
    ],
  },
  {
    emoji: '🍬', name: 'Мир сладостей', slug: 'sweets_world',
    children: [
      { name: 'Драже', slug: 'sweets_world_dragee' },
      { name: 'Жевательные резинки и леденцы', slug: 'sweets_world_gum' },
      { name: 'Зефир, маршмеллоу, мармелад', slug: 'sweets_world_zephyr' },
      { name: 'Кексы, рулеты, бисквиты', slug: 'sweets_world_cakes' },
      { name: 'Конфеты (весовые)', slug: 'sweets_world_candy_bulk' },
      { name: 'Конфеты в пачках', slug: 'sweets_world_candy_pack' },
      { name: 'Круассаны', slug: 'sweets_world_croissants' },
      { name: 'Мороженое', slug: 'sweets_world_icecream' },
      { name: 'Печенье, вафли, пряники', slug: 'sweets_world_cookies_wafers' },
      { name: 'Халва и ирис', slug: 'sweets_world_halva' },
      { name: 'Шоколад', slug: 'sweets_world_chocolate' },
      { name: 'Шоколадная и ореховая паста', slug: 'sweets_world_paste' },
      { name: 'Шоколадные батончики', slug: 'sweets_world_bars' },
    ],
  },
]

function buildSeed() {
  const rows = []
  TREE.forEach((root, ri) => {
    rows.push({
      slug: root.slug,
      emoji: root.emoji,
      name: root.name,
      desc: root.name,
      parentSlug: null,
      order: ri + 1,
      active: true,
    })
    root.children.forEach((ch, ci) => {
      rows.push({
        slug: ch.slug || `${root.slug}_${ci + 1}`,
        emoji: root.emoji,
        name: ch.name,
        desc: ch.name,
        parentSlug: root.slug,
        order: ci + 1,
        active: true,
      })
    })
  })
  return rows
}

const seed = buildSeed()
const seedJson = JSON.stringify(seed, null, 2)

const aliases = {
  // старые slug → новые
  fish_fish_frozen: 'fish_frozen',
  fish_fish_smoked: 'fish_smoked',
  kids_kids_hygiene: 'kids_hygiene',
  kids_kids_acc: 'kids_acc',
  kids_kids_food: 'kids_food',
  frozen_frozen_veg: 'frozen_veg',
  dairy_sour: 'dairy_sour_cream',
  sweets_world_candy_weight: 'sweets_world_candy_bulk',
  veg: 'veg_fruit',
  veg_ov: 'veg_fruit_vegetables',
  veg_fr: 'veg_fruit_fruits',
  meat_b: 'meat_beef',
  meat_p: 'meat_poultry',
  meat_k: 'meat_sausages',
  dairy_m: 'dairy_milk',
  dairy_f: 'dairy_kefir',
  dairy_s: 'dairy_cheese',
  dairy_e: 'dairy_eggs',
  dairy_t: 'dairy_butter',
  dairy_y: 'dairy_yogurt',
  bread: 'bakery',
  bread_h: 'bakery_bread',
  bread_b: 'bakery_buns',
  drinks: 'beverages',
  drinks_w: 'beverages_table_water',
  drinks_s: 'beverages_soda',
  drinks_j: 'beverages_juice',
  drinks_t: 'tea_coffee_tea',
  drinks_c: 'tea_coffee_coffee',
  drinks_e: 'beverages_energy',
  sweets: 'sweets_world',
  sweets_c: 'sweets_world_candy_pack',
  sweets_ch: 'sweets_world_chocolate',
  sweets_b: 'sweets_world_cookies_wafers',
  sweets_k: 'sweets_world_cakes',
  sweets_g: 'sweets_world_gum',
  snacks_s: 'snacks_chips',
  snacks_p: 'snacks_popcorn',
  grocery_p: 'grocery_pasta',
  grocery_s: 'oils_sauces_spices',
  grocery_o: 'oils_sauces_sauces',
  grocery_c: 'conservation_canned_veg',
  grocery_f: 'grocery_flour',
  grocery_n: 'snacks_nuts',
  grocery_j: 'conservation_jam',
  frozen_i: 'sweets_world_icecream',
  frozen_r: 'frozen_semi',
  frozen_v: 'frozen_veg',
  kids_f: 'kids_food',
  kids_h: 'kids_hygiene',
  kids_t: 'kids_toys',
  kids_a: 'kids_acc',
  house: 'household_chem',
  house_l: 'household_chem_laundry',
  house_c: 'household_chem_bathroom',
  house_p: 'beauty_paper',
  house_a: 'household_chem_aroma',
  beauty_b: 'beauty_body',
  beauty_h: 'beauty_hair_body',
  beauty_o: 'beauty_oral',
  beauty_s: 'beauty_shaving',
  beauty_d: 'beauty_deodorant',
  beauty_w: 'beauty_feminine',
  beauty_f: 'beauty_face',
  beauty_c: 'beauty_perfume',
  home: 'household',
  home_k: 'household_kitchenware',
  home_o: 'stationery_office',
  home_b: 'appliances_batteries',
  home_e: 'appliances_cables',
  home_r: 'appliances_building',
  home_sh: 'household_shoes',
  drink: 'beverages',
  sweet: 'sweets_world',
  chem: 'household_chem',
  grains: 'grocery_cereals',
  fish_old: 'fish_frozen',
  Попкорны: 'snacks_popcorn',
}

const csvGroup = {
  'орехи, чипсы и снеки': 'snacks',
  'снеки': 'snacks',
  'пекарня': 'bakery',
  'хлеб': 'bakery_bread',
  'бакалея': 'grocery',
  'молочные': 'dairy',
  'молочка': 'dairy',
  'мясо': 'meat',
  'птица': 'meat_poultry',
  'рыба': 'fish',
  'напитки': 'beverages',
  'вода': 'beverages_table_water',
  'сладости': 'sweets_world',
  'заморозка': 'frozen',
  'дети': 'kids',
  'химия': 'household_chem',
  'хозтовары': 'household',
  'косметика': 'beauty',
  'консервы': 'conservation',
  'овощи': 'veg_fruit_vegetables',
  'фрукты': 'veg_fruit_fruits',
}

const jsHelpers = `
export const CSV_GROUP_TO_SLUG = ${JSON.stringify(csvGroup, null, 2)}

export const CATEGORY_SLUG_ALIASES = ${JSON.stringify(aliases, null, 2)}

export function buildCategoriesFromSeed(seq = { category: 0 }) {
  const slugToId = new Map()
  const rows = []
  for (const item of MARKET_CATEGORIES_SEED.filter(s => !s.parentSlug)) {
    const id = ++seq.category
    slugToId.set(item.slug, id)
    rows.push({ id, slug: item.slug, name: item.name, emoji: item.emoji, desc: item.desc, parent_id: null, order: item.order, active: item.active !== false })
  }
  for (const item of MARKET_CATEGORIES_SEED.filter(s => s.parentSlug)) {
    const id = ++seq.category
    slugToId.set(item.slug, id)
    rows.push({ id, slug: item.slug, name: item.name, emoji: item.emoji, desc: item.desc, parent_id: slugToId.get(item.parentSlug) ?? null, order: item.order, active: item.active !== false })
  }
  return rows
}

export function ensureMarketCategories(db) {
  const deleted = new Set(db.deletedCategorySlugs || [])
  const existing = db.categories || []
  const have = new Set(existing.map(c => c.slug))
  const missing = MARKET_CATEGORIES_SEED.filter(s => !have.has(s.slug) && !deleted.has(s.slug))
  if (!missing.length) return false
  if (!db._seq) db._seq = { category: 0 }
  const slugToId = new Map(existing.map(c => [c.slug, c.id]))
  for (const item of MARKET_CATEGORIES_SEED) {
    if (have.has(item.slug) || deleted.has(item.slug)) continue
    const parent_id = item.parentSlug ? (slugToId.get(item.parentSlug) ?? null) : null
    if (item.parentSlug && parent_id == null) continue
    const id = ++db._seq.category
    const row = { id, slug: item.slug, name: item.name, emoji: item.emoji, desc: item.desc, parent_id, order: item.order, active: item.active !== false }
    existing.push(row)
    slugToId.set(item.slug, id)
  }
  db.categories = existing
  return true
}

export function replaceCategoriesFromSeed(db) {
  if (!db._seq) db._seq = { category: 0 }
  db.categories = buildCategoriesFromSeed(db._seq)
  const newBySlug = new Map(db.categories.map(c => [c.slug, c]))
  let remapped = 0
  for (const p of db.products || []) {
    const oldSlug = p.catId
    const aliased = CATEGORY_SLUG_ALIASES[oldSlug] || oldSlug
    const hit = newBySlug.get(aliased) || newBySlug.get(oldSlug)
    if (hit) {
      p.catId = hit.slug
      p.cat = hit.name
      remapped += 1
    }
  }
  db.deletedCategorySlugs = []
  return {
    roots: db.categories.filter(c => c.parent_id == null).length,
    total: db.categories.length,
    categories: db.categories.length,
    remapped,
  }
}
`

const jsOut = `/** Единый каталог категорий магазина (админка / касса / витрина / импорт) — дерево с фото + грамматика */
export const MARKET_CATEGORIES_SEED = ${seedJson}
${jsHelpers}
`

const tsOut = `import type { Category } from '@/lib/types'

export type MarketCategorySeed = {
  slug: string
  emoji: string
  name: string
  desc: string
  parentSlug: string | null
  order: number
  active: boolean
}

export const MARKET_CATEGORIES_SEED: MarketCategorySeed[] = ${seedJson}

export const CSV_GROUP_TO_SLUG: Record<string, string> = ${JSON.stringify(csvGroup, null, 2)}

export const CATEGORY_SLUG_ALIASES: Record<string, string> = ${JSON.stringify(aliases, null, 2)}

export function seedToCategories(): Category[] {
  const slugToId = new Map<string, number>()
  const rows: Category[] = []
  let id = 0
  for (const item of MARKET_CATEGORIES_SEED.filter(s => !s.parentSlug)) {
    id += 1
    slugToId.set(item.slug, id)
    rows.push({ id, slug: item.slug, name: item.name, emoji: item.emoji, desc: item.desc, parent_id: null, order: item.order, active: item.active })
  }
  for (const item of MARKET_CATEGORIES_SEED.filter(s => s.parentSlug)) {
    id += 1
    rows.push({ id, slug: item.slug, name: item.name, emoji: item.emoji, desc: item.desc, parent_id: slugToId.get(item.parentSlug!) ?? null, order: item.order, active: item.active })
  }
  return rows
}
`

writeFileSync(join(root, 'server/kakapo-api/marketCategoriesSeed.js'), jsOut, 'utf8')
writeFileSync(join(root, 'lib/marketCategoriesSeed.ts'), tsOut, 'utf8')

console.log('Готово. Категорий в сиде:', seed.length)
console.log('Родительских:', TREE.length)
console.log('Подкатегорий:', seed.length - TREE.length)
