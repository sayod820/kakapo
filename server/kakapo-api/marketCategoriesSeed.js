/** Единый каталог категорий магазина (админка / касса / витрина / импорт) */
export const MARKET_CATEGORIES_SEED = [
  { slug: 'veg', emoji: '🥦', name: 'Овощи и фрукты', desc: 'Свежие овощи, фрукты', parentSlug: null, order: 1, active: true },
  { slug: 'veg_ov', emoji: '🥕', name: 'Овощи', desc: 'Свежие овощи', parentSlug: 'veg', order: 1, active: true },
  { slug: 'veg_fr', emoji: '🍊', name: 'Фрукты и ягоды', desc: 'Свежие фрукты', parentSlug: 'veg', order: 2, active: true },
  { slug: 'meat', emoji: '🥩', name: 'Мясо и птица', desc: 'Говядина, курица, баранина', parentSlug: null, order: 2, active: true },
  { slug: 'meat_b', emoji: '🥩', name: 'Мясо', desc: 'Свежее мясо', parentSlug: 'meat', order: 1, active: true },
  { slug: 'meat_p', emoji: '🍗', name: 'Птица', desc: 'Курица, индейка', parentSlug: 'meat', order: 2, active: true },
  { slug: 'meat_k', emoji: '🌭', name: 'Колбасные изделия', desc: 'Колбасы, сосиски', parentSlug: 'meat', order: 3, active: true },
  { slug: 'dairy', emoji: '🥛', name: 'Молочное', desc: 'Молоко, сыр, яйца', parentSlug: null, order: 3, active: true },
  { slug: 'dairy_m', emoji: '🥛', name: 'Молоко и сливки', desc: 'Молоко, сливки', parentSlug: 'dairy', order: 1, active: true },
  { slug: 'dairy_f', emoji: '🥣', name: 'Кисломолочные продукты', desc: 'Кефир, йогурт, сметана', parentSlug: 'dairy', order: 2, active: true },
  { slug: 'dairy_s', emoji: '🧀', name: 'Сыры и творог', desc: 'Сыры, творог', parentSlug: 'dairy', order: 3, active: true },
  { slug: 'dairy_e', emoji: '🥚', name: 'Яйца', desc: 'Яйца куриные', parentSlug: 'dairy', order: 4, active: true },
  { slug: 'bread', emoji: '🥐', name: 'Выпечка и хлеб', desc: 'Хлеб, булочки', parentSlug: null, order: 4, active: true },
  { slug: 'bread_h', emoji: '🍞', name: 'Хлеб и лепёшки', desc: 'Хлеб, лепёшки', parentSlug: 'bread', order: 1, active: true },
  { slug: 'bread_b', emoji: '🥐', name: 'Булочки и выпечка', desc: 'Булочки, круассаны', parentSlug: 'bread', order: 2, active: true },
  { slug: 'drinks', emoji: '🧃', name: 'Напитки', desc: 'Соки, вода, чай, кофе', parentSlug: null, order: 5, active: true },
  { slug: 'drinks_w', emoji: '💧', name: 'Вода', desc: 'Вода', parentSlug: 'drinks', order: 1, active: true },
  { slug: 'drinks_s', emoji: '🥤', name: 'Газировка', desc: 'Газировка', parentSlug: 'drinks', order: 2, active: true },
  { slug: 'drinks_j', emoji: '🧃', name: 'Соки и нектары', desc: 'Соки, нектары', parentSlug: 'drinks', order: 3, active: true },
  { slug: 'drinks_t', emoji: '🍵', name: 'Чай', desc: 'Чай', parentSlug: 'drinks', order: 4, active: true },
  { slug: 'drinks_c', emoji: '☕', name: 'Кофе и какао', desc: 'Кофе, какао', parentSlug: 'drinks', order: 5, active: true },
  { slug: 'drinks_e', emoji: '⚡', name: 'Энергетики', desc: 'Энергетики', parentSlug: 'drinks', order: 6, active: true },
  { slug: 'sweets', emoji: '🍫', name: 'Сладости', desc: 'Шоколад, печенье, конфеты', parentSlug: null, order: 6, active: true },
  { slug: 'sweets_c', emoji: '🍬', name: 'Конфеты и мармелад', desc: 'Конфеты, мармелад', parentSlug: 'sweets', order: 1, active: true },
  { slug: 'sweets_ch', emoji: '🍫', name: 'Шоколад', desc: 'Шоколад', parentSlug: 'sweets', order: 2, active: true },
  { slug: 'sweets_b', emoji: '🍪', name: 'Печенье и вафли', desc: 'Печенье, вафли', parentSlug: 'sweets', order: 3, active: true },
  { slug: 'sweets_k', emoji: '🧁', name: 'Кексы и торты', desc: 'Кексы, торты', parentSlug: 'sweets', order: 4, active: true },
  { slug: 'sweets_g', emoji: '🍭', name: 'Жвачка и леденцы', desc: 'Жвачка, леденцы', parentSlug: 'sweets', order: 5, active: true },
  { slug: 'snacks', emoji: '🍿', name: 'Снеки', desc: 'Чипсы, сухарики', parentSlug: null, order: 7, active: true },
  { slug: 'snacks_s', emoji: '🍟', name: 'Чипсы и сухарики', desc: 'Чипсы, сухарики', parentSlug: 'snacks', order: 1, active: true },
  { slug: 'snacks_p', emoji: '🍿', name: 'Попкорн и палочки', desc: 'Попкорн', parentSlug: 'snacks', order: 2, active: true },
  { slug: 'grocery', emoji: '🧂', name: 'Бакалея', desc: 'Крупы, соусы, консервы', parentSlug: null, order: 8, active: true },
  { slug: 'grocery_p', emoji: '🍝', name: 'Макароны и крупы', desc: 'Макароны, крупы', parentSlug: 'grocery', order: 1, active: true },
  { slug: 'grocery_s', emoji: '🧂', name: 'Приправы, соль и сода', desc: 'Приправы, соль', parentSlug: 'grocery', order: 2, active: true },
  { slug: 'grocery_o', emoji: '🫗', name: 'Масло, уксус и соусы', desc: 'Масло, соусы', parentSlug: 'grocery', order: 3, active: true },
  { slug: 'grocery_c', emoji: '🥫', name: 'Консервы', desc: 'Консервы', parentSlug: 'grocery', order: 4, active: true },
  { slug: 'grocery_f', emoji: '🌾', name: 'Мука, дрожжи и сахар', desc: 'Мука, сахар', parentSlug: 'grocery', order: 5, active: true },
  { slug: 'grocery_n', emoji: '🥜', name: 'Орехи и семечки', desc: 'Орехи, семечки', parentSlug: 'grocery', order: 6, active: true },
  { slug: 'grocery_j', emoji: '🍯', name: 'Джемы и пасты', desc: 'Джемы, пасты', parentSlug: 'grocery', order: 7, active: true },
  { slug: 'frozen', emoji: '🧊', name: 'Заморозка', desc: 'Мороженое, полуфабрикаты', parentSlug: null, order: 9, active: true },
  { slug: 'frozen_i', emoji: '🍨', name: 'Мороженое', desc: 'Мороженое', parentSlug: 'frozen', order: 1, active: true },
  { slug: 'frozen_r', emoji: '🥟', name: 'Полуфабрикаты', desc: 'Полуфабрикаты', parentSlug: 'frozen', order: 2, active: true },
  { slug: 'frozen_v', emoji: '🫛', name: 'Замороженные овощи', desc: 'Замороженные овощи', parentSlug: 'frozen', order: 3, active: true },
  { slug: 'kids', emoji: '🧸', name: 'Детские товары', desc: 'Детские товары', parentSlug: null, order: 10, active: true },
  { slug: 'kids_f', emoji: '🍼', name: 'Детское питание', desc: 'Детское питание', parentSlug: 'kids', order: 1, active: true },
  { slug: 'kids_h', emoji: '🧷', name: 'Детская гигиена', desc: 'Детская гигиена', parentSlug: 'kids', order: 2, active: true },
  { slug: 'kids_t', emoji: '🧸', name: 'Игрушки', desc: 'Игрушки', parentSlug: 'kids', order: 3, active: true },
  { slug: 'kids_a', emoji: '🎈', name: 'Детские аксессуары', desc: 'Детские аксессуары', parentSlug: 'kids', order: 4, active: true },
  { slug: 'house', emoji: '🧴', name: 'Бытовая химия', desc: 'Стирка, уборка', parentSlug: null, order: 11, active: true },
  { slug: 'house_l', emoji: '🧺', name: 'Для стирки', desc: 'Для стирки', parentSlug: 'house', order: 1, active: true },
  { slug: 'house_c', emoji: '🧽', name: 'Для уборки', desc: 'Для уборки', parentSlug: 'house', order: 2, active: true },
  { slug: 'house_p', emoji: '🧻', name: 'Бумажные товары', desc: 'Бумага, салфетки', parentSlug: 'house', order: 3, active: true },
  { slug: 'house_a', emoji: '🌸', name: 'Ароматы для дома', desc: 'Ароматы', parentSlug: 'house', order: 4, active: true },
  { slug: 'beauty', emoji: '🪥', name: 'Красота и гигиена', desc: 'Уход и гигиена', parentSlug: null, order: 12, active: true },
  { slug: 'beauty_b', emoji: '🧼', name: 'Уход за телом', desc: 'Уход за телом', parentSlug: 'beauty', order: 1, active: true },
  { slug: 'beauty_h', emoji: '🧴', name: 'Уход за волосами', desc: 'Уход за волосами', parentSlug: 'beauty', order: 2, active: true },
  { slug: 'beauty_o', emoji: '🪥', name: 'Уход за полостью рта', desc: 'Зубные пасты', parentSlug: 'beauty', order: 3, active: true },
  { slug: 'beauty_s', emoji: '🪒', name: 'Бритьё и депиляция', desc: 'Бритьё', parentSlug: 'beauty', order: 4, active: true },
  { slug: 'beauty_d', emoji: '💨', name: 'Дезодоранты', desc: 'Дезодоранты', parentSlug: 'beauty', order: 5, active: true },
  { slug: 'beauty_w', emoji: '🩷', name: 'Женская гигиена', desc: 'Женская гигиена', parentSlug: 'beauty', order: 6, active: true },
  { slug: 'beauty_f', emoji: '🧴', name: 'Уход за лицом', desc: 'Уход за лицом', parentSlug: 'beauty', order: 7, active: true },
  { slug: 'beauty_c', emoji: '💄', name: 'Косметика и парфюмерия', desc: 'Косметика', parentSlug: 'beauty', order: 8, active: true },
  { slug: 'home', emoji: '🏠', name: 'Товары для дома', desc: 'Кухня, офис, техника', parentSlug: null, order: 13, active: true },
  { slug: 'home_k', emoji: '🍽️', name: 'Кухня и посуда', desc: 'Кухня и посуда', parentSlug: 'home', order: 1, active: true },
  { slug: 'home_o', emoji: '📚', name: 'Офис и школа', desc: 'Офис и школа', parentSlug: 'home', order: 2, active: true },
  { slug: 'home_b', emoji: '🔋', name: 'Батарейки и фонарики', desc: 'Батарейки', parentSlug: 'home', order: 3, active: true },
  { slug: 'home_e', emoji: '🔌', name: 'Кабели и техника', desc: 'Кабели, техника', parentSlug: 'home', order: 4, active: true },
  { slug: 'home_r', emoji: '🔧', name: 'Ремонт и стройка', desc: 'Ремонт', parentSlug: 'home', order: 5, active: true },
  { slug: 'home_sh', emoji: '👞', name: 'Для обуви', desc: 'Для обуви', parentSlug: 'home', order: 6, active: true },
  { slug: 'other', emoji: '📦', name: 'Прочее', desc: 'Прочие товары', parentSlug: null, order: 99, active: true },
]

export const CATEGORY_SLUG_ALIASES = {
  drink: 'drinks',
  sweet: 'sweets',
  chem: 'house',
  grains: 'grocery_p',
  fish: 'meat_p',
  meat_f: 'meat_p',
  veg_gr: 'veg_ov',
  veg_yg: 'veg_fr',
  dairy_t: 'dairy_m',
  dairy_y: 'dairy_f',
  drink_j: 'drinks_j',
  drink_w: 'drinks_w',
  drink_t: 'drinks_t',
  drink_c: 'drinks_s',
  sweet_c: 'sweets_ch',
  sweet_b: 'sweets_b',
  sweet_k: 'sweets_c',
  sweet_h: 'grocery_n',
}

export function buildCategoriesFromSeed(seq = { category: 0 }) {
  const slugToId = new Map()
  const rows = []
  for (const item of MARKET_CATEGORIES_SEED.filter(s => !s.parentSlug)) {
    const id = ++seq.category
    slugToId.set(item.slug, id)
    rows.push({
      id,
      slug: item.slug,
      name: item.name,
      emoji: item.emoji,
      desc: item.desc,
      parent_id: null,
      order: item.order,
      active: item.active !== false,
    })
  }
  for (const item of MARKET_CATEGORIES_SEED.filter(s => s.parentSlug)) {
    const id = ++seq.category
    slugToId.set(item.slug, id)
    rows.push({
      id,
      slug: item.slug,
      name: item.name,
      emoji: item.emoji,
      desc: item.desc,
      parent_id: slugToId.get(item.parentSlug) ?? null,
      order: item.order,
      active: item.active !== false,
    })
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
    const row = {
      id,
      slug: item.slug,
      name: item.name,
      emoji: item.emoji,
      desc: item.desc,
      parent_id,
      order: item.order,
      active: item.active !== false,
    }
    existing.push(row)
    slugToId.set(item.slug, id)
    have.add(item.slug)
  }

  db.categories = existing.sort((a, b) => (a.order || 0) - (b.order || 0) || a.id - b.id)
  return true
}

/** Полная замена категорий на сид + remapping товаров со старых slug */
export function replaceCategoriesFromSeed(db) {
  if (!db._seq) db._seq = { category: 0 }
  const maxCatId = Math.max(0, ...(db.categories || []).map(c => Number(c.id) || 0))
  if ((db._seq.category || 0) < maxCatId) db._seq.category = maxCatId

  const allowed = new Set(MARKET_CATEGORIES_SEED.map(s => s.slug))
  db.categories = buildCategoriesFromSeed(db._seq)
  db.deletedCategorySlugs = []

  const bySlug = new Map(db.categories.map(c => [c.slug, c]))
  let remapped = 0
  for (const p of db.products || []) {
    let slug = String(p.catId || '').trim()
    if (CATEGORY_SLUG_ALIASES[slug]) slug = CATEGORY_SLUG_ALIASES[slug]
    if (!allowed.has(slug)) slug = 'other'
    const cat = bySlug.get(slug) || bySlug.get('other')
    if (!cat) continue
    if (p.catId !== cat.slug || p.cat !== cat.name || p.e !== cat.emoji) {
      p.catId = cat.slug
      p.cat = cat.name
      if (!p.e || p.e === '📦') p.e = cat.emoji
      remapped += 1
    }
  }
  return { categories: db.categories.length, remapped }
}
