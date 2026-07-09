/** Единый каталог категорий магазина (как в админке) */
export const MARKET_CATEGORIES_SEED = [
  { slug: 'veg', emoji: '🥦', name: 'Овощи и фрукты', desc: 'Свежие овощи, фрукты', parentSlug: null, order: 1, active: true },
  { slug: 'veg_ov', emoji: '🥕', name: 'Овощи', desc: 'Свежие овощи', parentSlug: 'veg', order: 1, active: true },
  { slug: 'veg_fr', emoji: '🍊', name: 'Фрукты и ягоды', desc: 'Свежие фрукты', parentSlug: 'veg', order: 2, active: true },
  { slug: 'meat', emoji: '🥩', name: 'Мясо и птица', desc: 'Говядина, курица, баранина', parentSlug: null, order: 2, active: true },
  { slug: 'meat_b', emoji: '🥩', name: 'Говядина и баранина', desc: 'Свежее мясо', parentSlug: 'meat', order: 1, active: true },
  { slug: 'meat_p', emoji: '🍗', name: 'Птица', desc: 'Курица, индейка', parentSlug: 'meat', order: 2, active: true },
  { slug: 'meat_k', emoji: '🌭', name: 'Колбасные изделия', desc: 'Колбасы, сосиски', parentSlug: 'meat', order: 3, active: true },
  { slug: 'dairy', emoji: '🥛', name: 'Молочное', desc: 'Молоко, сыр, яйца, масло', parentSlug: null, order: 3, active: true },
  { slug: 'dairy_m', emoji: '🥛', name: 'Молоко', desc: 'Молоко, кефир, ряженка', parentSlug: 'dairy', order: 1, active: true },
  { slug: 'dairy_s', emoji: '🧀', name: 'Сыры', desc: 'Российский, плавленый', parentSlug: 'dairy', order: 2, active: true },
  { slug: 'dairy_e', emoji: '🥚', name: 'Яйцо', desc: 'Яйца куриные', parentSlug: 'dairy', order: 3, active: true },
  { slug: 'bread', emoji: '🥐', name: 'Выпечка и хлеб', desc: 'Хлеб, булочки, круассаны', parentSlug: null, order: 4, active: true },
  { slug: 'drinks', emoji: '🧃', name: 'Напитки', desc: 'Соки, вода, чай, кофе', parentSlug: null, order: 5, active: true },
  { slug: 'sweets', emoji: '🍫', name: 'Сладости', desc: 'Шоколад, печенье, конфеты', parentSlug: null, order: 6, active: true },
  { slug: 'house', emoji: '🧴', name: 'Бытовая химия', desc: 'Чистящие средства, порошок', parentSlug: null, order: 7, active: true },
]

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
  const existing = db.categories || []
  const have = new Set(existing.map(c => c.slug))
  const missing = MARKET_CATEGORIES_SEED.filter(s => !have.has(s.slug))
  if (!missing.length) return false

  if (!db._seq) db._seq = { category: 0 }
  const slugToId = new Map(existing.map(c => [c.slug, c.id]))

  for (const item of MARKET_CATEGORIES_SEED) {
    if (have.has(item.slug)) continue
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
