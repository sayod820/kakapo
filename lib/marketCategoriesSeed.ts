import type { Category } from '@/lib/types'

export type MarketCategorySeed = {
  slug: string
  emoji: string
  name: string
  desc: string
  parentSlug: string | null
  order: number
  active: boolean
}

/** Тот же каталог, что в админке и на бэкенде */
export const MARKET_CATEGORIES_SEED: MarketCategorySeed[] = [
  { slug: 'veg', emoji: '🥦', name: 'Овощи и фрукты', desc: 'Свежие овощи, фрукты', parentSlug: null, order: 1, active: true },
  { slug: 'veg_ov', emoji: '🥕', name: 'Овощи', desc: 'Свежие овощи', parentSlug: 'veg', order: 1, active: true },
  { slug: 'veg_fr', emoji: '🍊', name: 'Фрукты и ягоды', desc: 'Свежие фрукты', parentSlug: 'veg', order: 2, active: true },
  { slug: 'meat', emoji: '🥩', name: 'Мясо и птица', desc: 'Говядина, курица, баранина', parentSlug: null, order: 2, active: true },
  { slug: 'meat_b', emoji: '🥩', name: 'Мясо', desc: 'Свежее мясо', parentSlug: 'meat', order: 1, active: true },
  { slug: 'meat_p', emoji: '🍗', name: 'Птица', desc: 'Курица, индейка', parentSlug: 'meat', order: 2, active: true },
  { slug: 'meat_k', emoji: '🌭', name: 'Колбасные изделия', desc: 'Колбасы, сосиски', parentSlug: 'meat', order: 3, active: true },
  { slug: 'dairy', emoji: '🥛', name: 'Молочное', desc: 'Молоко, сыр, яйца', parentSlug: null, order: 3, active: true },
  { slug: 'dairy_m', emoji: '🥛', name: 'Молоко и сливки', desc: 'Молоко, сливки', parentSlug: 'dairy', order: 1, active: true },
  { slug: 'dairy_f', emoji: '🥣', name: 'Кисломолочные продукты', desc: 'Кефир, йогурт', parentSlug: 'dairy', order: 2, active: true },
  { slug: 'dairy_s', emoji: '🧀', name: 'Сыры и творог', desc: 'Сыры, творог', parentSlug: 'dairy', order: 3, active: true },
  { slug: 'dairy_e', emoji: '🥚', name: 'Яйца', desc: 'Яйца куриные', parentSlug: 'dairy', order: 4, active: true },
  { slug: 'bread', emoji: '🥐', name: 'Выпечка и хлеб', desc: 'Хлеб, булочки', parentSlug: null, order: 4, active: true },
  { slug: 'bread_h', emoji: '🍞', name: 'Хлеб и лепёшки', desc: 'Хлеб, лепёшки', parentSlug: 'bread', order: 1, active: true },
  { slug: 'bread_b', emoji: '🥐', name: 'Булочки и выпечка', desc: 'Булочки', parentSlug: 'bread', order: 2, active: true },
  { slug: 'drinks', emoji: '🧃', name: 'Напитки', desc: 'Соки, вода, чай, кофе', parentSlug: null, order: 5, active: true },
  { slug: 'drinks_w', emoji: '💧', name: 'Вода', desc: 'Вода', parentSlug: 'drinks', order: 1, active: true },
  { slug: 'drinks_s', emoji: '🥤', name: 'Газировка', desc: 'Газировка', parentSlug: 'drinks', order: 2, active: true },
  { slug: 'drinks_j', emoji: '🧃', name: 'Соки и нектары', desc: 'Соки', parentSlug: 'drinks', order: 3, active: true },
  { slug: 'drinks_t', emoji: '🍵', name: 'Чай', desc: 'Чай', parentSlug: 'drinks', order: 4, active: true },
  { slug: 'drinks_c', emoji: '☕', name: 'Кофе и какао', desc: 'Кофе', parentSlug: 'drinks', order: 5, active: true },
  { slug: 'drinks_e', emoji: '⚡', name: 'Энергетики', desc: 'Энергетики', parentSlug: 'drinks', order: 6, active: true },
  { slug: 'sweets', emoji: '🍫', name: 'Сладости', desc: 'Шоколад, печенье, конфеты', parentSlug: null, order: 6, active: true },
  { slug: 'sweets_c', emoji: '🍬', name: 'Конфеты и мармелад', desc: 'Конфеты', parentSlug: 'sweets', order: 1, active: true },
  { slug: 'sweets_ch', emoji: '🍫', name: 'Шоколад', desc: 'Шоколад', parentSlug: 'sweets', order: 2, active: true },
  { slug: 'sweets_b', emoji: '🍪', name: 'Печенье и вафли', desc: 'Печенье', parentSlug: 'sweets', order: 3, active: true },
  { slug: 'sweets_k', emoji: '🧁', name: 'Кексы и торты', desc: 'Кексы', parentSlug: 'sweets', order: 4, active: true },
  { slug: 'sweets_g', emoji: '🍭', name: 'Жвачка и леденцы', desc: 'Жвачка', parentSlug: 'sweets', order: 5, active: true },
  { slug: 'snacks', emoji: '🍿', name: 'Снеки', desc: 'Чипсы, сухарики', parentSlug: null, order: 7, active: true },
  { slug: 'snacks_s', emoji: '🍟', name: 'Чипсы и сухарики', desc: 'Чипсы', parentSlug: 'snacks', order: 1, active: true },
  { slug: 'snacks_p', emoji: '🍿', name: 'Попкорн и палочки', desc: 'Попкорн', parentSlug: 'snacks', order: 2, active: true },
  { slug: 'grocery', emoji: '🧂', name: 'Бакалея', desc: 'Крупы, соусы', parentSlug: null, order: 8, active: true },
  { slug: 'grocery_p', emoji: '🍝', name: 'Макароны и крупы', desc: 'Макароны', parentSlug: 'grocery', order: 1, active: true },
  { slug: 'grocery_s', emoji: '🧂', name: 'Приправы, соль и сода', desc: 'Приправы', parentSlug: 'grocery', order: 2, active: true },
  { slug: 'grocery_o', emoji: '🫗', name: 'Масло, уксус и соусы', desc: 'Соусы', parentSlug: 'grocery', order: 3, active: true },
  { slug: 'grocery_c', emoji: '🥫', name: 'Консервы', desc: 'Консервы', parentSlug: 'grocery', order: 4, active: true },
  { slug: 'grocery_f', emoji: '🌾', name: 'Мука, дрожжи и сахар', desc: 'Мука', parentSlug: 'grocery', order: 5, active: true },
  { slug: 'grocery_n', emoji: '🥜', name: 'Орехи и семечки', desc: 'Орехи', parentSlug: 'grocery', order: 6, active: true },
  { slug: 'grocery_j', emoji: '🍯', name: 'Джемы и пасты', desc: 'Джемы', parentSlug: 'grocery', order: 7, active: true },
  { slug: 'frozen', emoji: '🧊', name: 'Заморозка', desc: 'Мороженое', parentSlug: null, order: 9, active: true },
  { slug: 'frozen_i', emoji: '🍨', name: 'Мороженое', desc: 'Мороженое', parentSlug: 'frozen', order: 1, active: true },
  { slug: 'frozen_r', emoji: '🥟', name: 'Полуфабрикаты', desc: 'Полуфабрикаты', parentSlug: 'frozen', order: 2, active: true },
  { slug: 'frozen_v', emoji: '🫛', name: 'Замороженные овощи', desc: 'Замороженные овощи', parentSlug: 'frozen', order: 3, active: true },
  { slug: 'kids', emoji: '🧸', name: 'Детские товары', desc: 'Детские товары', parentSlug: null, order: 10, active: true },
  { slug: 'kids_f', emoji: '🍼', name: 'Детское питание', desc: 'Детское питание', parentSlug: 'kids', order: 1, active: true },
  { slug: 'kids_h', emoji: '🧷', name: 'Детская гигиена', desc: 'Детская гигиена', parentSlug: 'kids', order: 2, active: true },
  { slug: 'kids_t', emoji: '🧸', name: 'Игрушки', desc: 'Игрушки', parentSlug: 'kids', order: 3, active: true },
  { slug: 'kids_a', emoji: '🎈', name: 'Детские аксессуары', desc: 'Аксессуары', parentSlug: 'kids', order: 4, active: true },
  { slug: 'house', emoji: '🧴', name: 'Бытовая химия', desc: 'Стирка, уборка', parentSlug: null, order: 11, active: true },
  { slug: 'house_l', emoji: '🧺', name: 'Для стирки', desc: 'Стирка', parentSlug: 'house', order: 1, active: true },
  { slug: 'house_c', emoji: '🧽', name: 'Для уборки', desc: 'Уборка', parentSlug: 'house', order: 2, active: true },
  { slug: 'house_p', emoji: '🧻', name: 'Бумажные товары', desc: 'Бумага', parentSlug: 'house', order: 3, active: true },
  { slug: 'house_a', emoji: '🌸', name: 'Ароматы для дома', desc: 'Ароматы', parentSlug: 'house', order: 4, active: true },
  { slug: 'beauty', emoji: '🪥', name: 'Красота и гигиена', desc: 'Уход', parentSlug: null, order: 12, active: true },
  { slug: 'beauty_b', emoji: '🧼', name: 'Уход за телом', desc: 'Тело', parentSlug: 'beauty', order: 1, active: true },
  { slug: 'beauty_h', emoji: '🧴', name: 'Уход за волосами', desc: 'Волосы', parentSlug: 'beauty', order: 2, active: true },
  { slug: 'beauty_o', emoji: '🪥', name: 'Уход за полостью рта', desc: 'Зубы', parentSlug: 'beauty', order: 3, active: true },
  { slug: 'beauty_s', emoji: '🪒', name: 'Бритьё и депиляция', desc: 'Бритьё', parentSlug: 'beauty', order: 4, active: true },
  { slug: 'beauty_d', emoji: '💨', name: 'Дезодоранты', desc: 'Дезодоранты', parentSlug: 'beauty', order: 5, active: true },
  { slug: 'beauty_w', emoji: '🩷', name: 'Женская гигиена', desc: 'Гигиена', parentSlug: 'beauty', order: 6, active: true },
  { slug: 'beauty_f', emoji: '🧴', name: 'Уход за лицом', desc: 'Лицо', parentSlug: 'beauty', order: 7, active: true },
  { slug: 'beauty_c', emoji: '💄', name: 'Косметика и парфюмерия', desc: 'Косметика', parentSlug: 'beauty', order: 8, active: true },
  { slug: 'home', emoji: '🏠', name: 'Товары для дома', desc: 'Дом', parentSlug: null, order: 13, active: true },
  { slug: 'home_k', emoji: '🍽️', name: 'Кухня и посуда', desc: 'Кухня', parentSlug: 'home', order: 1, active: true },
  { slug: 'home_o', emoji: '📚', name: 'Офис и школа', desc: 'Офис', parentSlug: 'home', order: 2, active: true },
  { slug: 'home_b', emoji: '🔋', name: 'Батарейки и фонарики', desc: 'Батарейки', parentSlug: 'home', order: 3, active: true },
  { slug: 'home_e', emoji: '🔌', name: 'Кабели и техника', desc: 'Техника', parentSlug: 'home', order: 4, active: true },
  { slug: 'home_r', emoji: '🔧', name: 'Ремонт и стройка', desc: 'Ремонт', parentSlug: 'home', order: 5, active: true },
  { slug: 'home_sh', emoji: '👞', name: 'Для обуви', desc: 'Обувь', parentSlug: 'home', order: 6, active: true },
  { slug: 'other', emoji: '📦', name: 'Прочее', desc: 'Прочее', parentSlug: null, order: 99, active: true },
]

export const CATEGORY_SLUG_ALIASES: Record<string, string> = {
  drink: 'drinks',
  sweet: 'sweets',
  chem: 'house',
  grains: 'grocery_p',
  fish: 'meat_p',
}

export function seedToCategories(): Category[] {
  const slugToId = new Map<string, number>()
  const rows: Category[] = []
  let id = 0
  for (const item of MARKET_CATEGORIES_SEED.filter(s => !s.parentSlug)) {
    id += 1
    slugToId.set(item.slug, id)
    rows.push({
      id,
      slug: item.slug,
      name: item.name,
      emoji: item.emoji,
      desc: item.desc,
      parent_id: null,
      order: item.order,
      active: item.active,
    })
  }
  for (const item of MARKET_CATEGORIES_SEED.filter(s => s.parentSlug)) {
    id += 1
    rows.push({
      id,
      slug: item.slug,
      name: item.name,
      emoji: item.emoji,
      desc: item.desc,
      parent_id: slugToId.get(item.parentSlug!) ?? null,
      order: item.order,
      active: item.active,
    })
  }
  return rows
}
