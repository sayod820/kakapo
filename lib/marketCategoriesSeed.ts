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

export const MARKET_CATEGORIES_SEED: MarketCategorySeed[] = [
  {
    "slug": "fish",
    "emoji": "🐟",
    "name": "Рыба и морепродукты",
    "desc": "Рыба и морепродукты",
    "parentSlug": null,
    "order": 1,
    "active": true
  },
  {
    "slug": "fish_frozen",
    "emoji": "🐟",
    "name": "Рыба замороженная",
    "desc": "Рыба замороженная",
    "parentSlug": "fish",
    "order": 1,
    "active": true
  },
  {
    "slug": "fish_smoked",
    "emoji": "🐟",
    "name": "Рыба копчёная",
    "desc": "Рыба копчёная",
    "parentSlug": "fish",
    "order": 2,
    "active": true
  },
  {
    "slug": "kids",
    "emoji": "👶",
    "name": "Товары для детей",
    "desc": "Товары для детей",
    "parentSlug": null,
    "order": 2,
    "active": true
  },
  {
    "slug": "kids_hygiene",
    "emoji": "👶",
    "name": "Детская гигиена",
    "desc": "Детская гигиена",
    "parentSlug": "kids",
    "order": 1,
    "active": true
  },
  {
    "slug": "kids_acc",
    "emoji": "👶",
    "name": "Детские аксессуары",
    "desc": "Детские аксессуары",
    "parentSlug": "kids",
    "order": 2,
    "active": true
  },
  {
    "slug": "kids_food",
    "emoji": "👶",
    "name": "Детское питание",
    "desc": "Детское питание",
    "parentSlug": "kids",
    "order": 3,
    "active": true
  },
  {
    "slug": "kids_toys",
    "emoji": "👶",
    "name": "Игрушки",
    "desc": "Игрушки",
    "parentSlug": "kids",
    "order": 4,
    "active": true
  },
  {
    "slug": "household",
    "emoji": "🏠",
    "name": "Хозтовары",
    "desc": "Хозтовары",
    "parentSlug": null,
    "order": 3,
    "active": true
  },
  {
    "slug": "household_cooking",
    "emoji": "🏠",
    "name": "Для готовки и хранения",
    "desc": "Для готовки и хранения",
    "parentSlug": "household",
    "order": 1,
    "active": true
  },
  {
    "slug": "household_shoes",
    "emoji": "🏠",
    "name": "Для обуви",
    "desc": "Для обуви",
    "parentSlug": "household",
    "order": 2,
    "active": true
  },
  {
    "slug": "household_kitchenware",
    "emoji": "🏠",
    "name": "Кухонная утварь и аксессуары",
    "desc": "Кухонная утварь и аксессуары",
    "parentSlug": "household",
    "order": 3,
    "active": true
  },
  {
    "slug": "household_dishes",
    "emoji": "🏠",
    "name": "Посуда",
    "desc": "Посуда",
    "parentSlug": "household",
    "order": 4,
    "active": true
  },
  {
    "slug": "household_matches",
    "emoji": "🏠",
    "name": "Спички",
    "desc": "Спички",
    "parentSlug": "household",
    "order": 5,
    "active": true
  },
  {
    "slug": "beauty",
    "emoji": "💄",
    "name": "Косметика и гигиена",
    "desc": "Косметика и гигиена",
    "parentSlug": null,
    "order": 4,
    "active": true
  },
  {
    "slug": "beauty_acc",
    "emoji": "💄",
    "name": "Аксессуары для красоты и гигиены",
    "desc": "Аксессуары для красоты и гигиены",
    "parentSlug": "beauty",
    "order": 1,
    "active": true
  },
  {
    "slug": "beauty_paper",
    "emoji": "💄",
    "name": "Бумажные изделия",
    "desc": "Бумажные изделия",
    "parentSlug": "beauty",
    "order": 2,
    "active": true
  },
  {
    "slug": "beauty_cotton",
    "emoji": "💄",
    "name": "Ватные изделия",
    "desc": "Ватные изделия",
    "parentSlug": "beauty",
    "order": 3,
    "active": true
  },
  {
    "slug": "beauty_wet_wipes",
    "emoji": "💄",
    "name": "Влажные салфетки",
    "desc": "Влажные салфетки",
    "parentSlug": "beauty",
    "order": 4,
    "active": true
  },
  {
    "slug": "beauty_deodorant",
    "emoji": "💄",
    "name": "Дезодорант",
    "desc": "Дезодорант",
    "parentSlug": "beauty",
    "order": 5,
    "active": true
  },
  {
    "slug": "beauty_shaving",
    "emoji": "💄",
    "name": "Для бритья и депиляции",
    "desc": "Для бритья и депиляции",
    "parentSlug": "beauty",
    "order": 6,
    "active": true
  },
  {
    "slug": "beauty_body",
    "emoji": "💄",
    "name": "Для тела",
    "desc": "Для тела",
    "parentSlug": "beauty",
    "order": 7,
    "active": true
  },
  {
    "slug": "beauty_feminine",
    "emoji": "💄",
    "name": "Женская гигиена",
    "desc": "Женская гигиена",
    "parentSlug": "beauty",
    "order": 8,
    "active": true
  },
  {
    "slug": "beauty_hair_dye",
    "emoji": "💄",
    "name": "Краска для волос",
    "desc": "Краска для волос",
    "parentSlug": "beauty",
    "order": 9,
    "active": true
  },
  {
    "slug": "beauty_creams",
    "emoji": "💄",
    "name": "Кремы",
    "desc": "Кремы",
    "parentSlug": "beauty",
    "order": 10,
    "active": true
  },
  {
    "slug": "beauty_perfume",
    "emoji": "💄",
    "name": "Парфюмерия",
    "desc": "Парфюмерия",
    "parentSlug": "beauty",
    "order": 11,
    "active": true
  },
  {
    "slug": "beauty_paper_tissues",
    "emoji": "💄",
    "name": "Салфетки бумажные",
    "desc": "Салфетки бумажные",
    "parentSlug": "beauty",
    "order": 12,
    "active": true
  },
  {
    "slug": "beauty_aftershave",
    "emoji": "💄",
    "name": "Средства после бритья",
    "desc": "Средства после бритья",
    "parentSlug": "beauty",
    "order": 13,
    "active": true
  },
  {
    "slug": "beauty_hair_body",
    "emoji": "💄",
    "name": "Уход за волосами и телом",
    "desc": "Уход за волосами и телом",
    "parentSlug": "beauty",
    "order": 14,
    "active": true
  },
  {
    "slug": "beauty_face",
    "emoji": "💄",
    "name": "Уход за лицом",
    "desc": "Уход за лицом",
    "parentSlug": "beauty",
    "order": 15,
    "active": true
  },
  {
    "slug": "beauty_oral",
    "emoji": "💄",
    "name": "Уход за полостью рта",
    "desc": "Уход за полостью рта",
    "parentSlug": "beauty",
    "order": 16,
    "active": true
  },
  {
    "slug": "beverages",
    "emoji": "🥤",
    "name": "Вода и напитки",
    "desc": "Вода и напитки",
    "parentSlug": null,
    "order": 5,
    "active": true
  },
  {
    "slug": "beverages_soda",
    "emoji": "🥤",
    "name": "Газированный напиток",
    "desc": "Газированный напиток",
    "parentSlug": "beverages",
    "order": 1,
    "active": true
  },
  {
    "slug": "beverages_mineral",
    "emoji": "🥤",
    "name": "Минеральная вода",
    "desc": "Минеральная вода",
    "parentSlug": "beverages",
    "order": 2,
    "active": true
  },
  {
    "slug": "beverages_sweet",
    "emoji": "🥤",
    "name": "Сладкая вода",
    "desc": "Сладкая вода",
    "parentSlug": "beverages",
    "order": 3,
    "active": true
  },
  {
    "slug": "beverages_juice",
    "emoji": "🥤",
    "name": "Сок, нектар, морс",
    "desc": "Сок, нектар, морс",
    "parentSlug": "beverages",
    "order": 4,
    "active": true
  },
  {
    "slug": "beverages_table_water",
    "emoji": "🥤",
    "name": "Столовая вода",
    "desc": "Столовая вода",
    "parentSlug": "beverages",
    "order": 5,
    "active": true
  },
  {
    "slug": "beverages_iced_tea",
    "emoji": "🥤",
    "name": "Холодный чай",
    "desc": "Холодный чай",
    "parentSlug": "beverages",
    "order": 6,
    "active": true
  },
  {
    "slug": "beverages_energy",
    "emoji": "🥤",
    "name": "Энергетические напитки",
    "desc": "Энергетические напитки",
    "parentSlug": "beverages",
    "order": 7,
    "active": true
  },
  {
    "slug": "frozen",
    "emoji": "🧊",
    "name": "Замороженные продукты",
    "desc": "Замороженные продукты",
    "parentSlug": null,
    "order": 6,
    "active": true
  },
  {
    "slug": "frozen_pancakes",
    "emoji": "🧊",
    "name": "Блинчики",
    "desc": "Блинчики",
    "parentSlug": "frozen",
    "order": 1,
    "active": true
  },
  {
    "slug": "frozen_veg",
    "emoji": "🧊",
    "name": "Замороженные овощи и ягоды",
    "desc": "Замороженные овощи и ягоды",
    "parentSlug": "frozen",
    "order": 2,
    "active": true
  },
  {
    "slug": "frozen_cutlets",
    "emoji": "🧊",
    "name": "Котлеты",
    "desc": "Котлеты",
    "parentSlug": "frozen",
    "order": 3,
    "active": true
  },
  {
    "slug": "frozen_dumplings",
    "emoji": "🧊",
    "name": "Пельмени",
    "desc": "Пельмени",
    "parentSlug": "frozen",
    "order": 4,
    "active": true
  },
  {
    "slug": "frozen_semi",
    "emoji": "🧊",
    "name": "Полуфабрикаты",
    "desc": "Полуфабрикаты",
    "parentSlug": "frozen",
    "order": 5,
    "active": true
  },
  {
    "slug": "dairy",
    "emoji": "🥛",
    "name": "Молочные продукты",
    "desc": "Молочные продукты",
    "parentSlug": null,
    "order": 7,
    "active": true
  },
  {
    "slug": "dairy_yogurt",
    "emoji": "🥛",
    "name": "Йогурт",
    "desc": "Йогурт",
    "parentSlug": "dairy",
    "order": 1,
    "active": true
  },
  {
    "slug": "dairy_kefir",
    "emoji": "🥛",
    "name": "Кефир и ряженка",
    "desc": "Кефир и ряженка",
    "parentSlug": "dairy",
    "order": 2,
    "active": true
  },
  {
    "slug": "dairy_butter",
    "emoji": "🥛",
    "name": "Масло и маргарин",
    "desc": "Масло и маргарин",
    "parentSlug": "dairy",
    "order": 3,
    "active": true
  },
  {
    "slug": "dairy_milk",
    "emoji": "🥛",
    "name": "Молоко",
    "desc": "Молоко",
    "parentSlug": "dairy",
    "order": 4,
    "active": true
  },
  {
    "slug": "dairy_condensed",
    "emoji": "🥛",
    "name": "Сгущённое молоко",
    "desc": "Сгущённое молоко",
    "parentSlug": "dairy",
    "order": 5,
    "active": true
  },
  {
    "slug": "dairy_cream",
    "emoji": "🥛",
    "name": "Сливки",
    "desc": "Сливки",
    "parentSlug": "dairy",
    "order": 6,
    "active": true
  },
  {
    "slug": "dairy_sour_cream",
    "emoji": "🥛",
    "name": "Сметана",
    "desc": "Сметана",
    "parentSlug": "dairy",
    "order": 7,
    "active": true
  },
  {
    "slug": "dairy_curd_snacks",
    "emoji": "🥛",
    "name": "Сырки",
    "desc": "Сырки",
    "parentSlug": "dairy",
    "order": 8,
    "active": true
  },
  {
    "slug": "dairy_cheese",
    "emoji": "🥛",
    "name": "Сыры",
    "desc": "Сыры",
    "parentSlug": "dairy",
    "order": 9,
    "active": true
  },
  {
    "slug": "dairy_cottage",
    "emoji": "🥛",
    "name": "Творог",
    "desc": "Творог",
    "parentSlug": "dairy",
    "order": 10,
    "active": true
  },
  {
    "slug": "dairy_chakka",
    "emoji": "🥛",
    "name": "Чакка",
    "desc": "Чакка",
    "parentSlug": "dairy",
    "order": 11,
    "active": true
  },
  {
    "slug": "dairy_eggs",
    "emoji": "🥛",
    "name": "Яйца",
    "desc": "Яйца",
    "parentSlug": "dairy",
    "order": 12,
    "active": true
  },
  {
    "slug": "tea_coffee",
    "emoji": "☕",
    "name": "Чай, кофе и какао",
    "desc": "Чай, кофе и какао",
    "parentSlug": null,
    "order": 8,
    "active": true
  },
  {
    "slug": "tea_coffee_cocoa",
    "emoji": "☕",
    "name": "Какао и горячий шоколад",
    "desc": "Какао и горячий шоколад",
    "parentSlug": "tea_coffee",
    "order": 1,
    "active": true
  },
  {
    "slug": "tea_coffee_coffee",
    "emoji": "☕",
    "name": "Кофе",
    "desc": "Кофе",
    "parentSlug": "tea_coffee",
    "order": 2,
    "active": true
  },
  {
    "slug": "tea_coffee_tea",
    "emoji": "☕",
    "name": "Чай",
    "desc": "Чай",
    "parentSlug": "tea_coffee",
    "order": 3,
    "active": true
  },
  {
    "slug": "snacks",
    "emoji": "🍿",
    "name": "Орехи, чипсы и снеки",
    "desc": "Орехи, чипсы и снеки",
    "parentSlug": null,
    "order": 9,
    "active": true
  },
  {
    "slug": "snacks_sticks",
    "emoji": "🍿",
    "name": "Кукурузные палочки",
    "desc": "Кукурузные палочки",
    "parentSlug": "snacks",
    "order": 1,
    "active": true
  },
  {
    "slug": "snacks_nuts",
    "emoji": "🍿",
    "name": "Орехи",
    "desc": "Орехи",
    "parentSlug": "snacks",
    "order": 2,
    "active": true
  },
  {
    "slug": "snacks_popcorn",
    "emoji": "🍿",
    "name": "Попкорн",
    "desc": "Попкорн",
    "parentSlug": "snacks",
    "order": 3,
    "active": true
  },
  {
    "slug": "snacks_seeds",
    "emoji": "🍿",
    "name": "Семечки",
    "desc": "Семечки",
    "parentSlug": "snacks",
    "order": 4,
    "active": true
  },
  {
    "slug": "snacks_croutons",
    "emoji": "🍿",
    "name": "Сухарики, гренки",
    "desc": "Сухарики, гренки",
    "parentSlug": "snacks",
    "order": 5,
    "active": true
  },
  {
    "slug": "snacks_dried_fruit",
    "emoji": "🍿",
    "name": "Сухофрукты",
    "desc": "Сухофрукты",
    "parentSlug": "snacks",
    "order": 6,
    "active": true
  },
  {
    "slug": "snacks_chips",
    "emoji": "🍿",
    "name": "Чипсы",
    "desc": "Чипсы",
    "parentSlug": "snacks",
    "order": 7,
    "active": true
  },
  {
    "slug": "bakery",
    "emoji": "🥐",
    "name": "Пекарня",
    "desc": "Пекарня",
    "parentSlug": null,
    "order": 10,
    "active": true
  },
  {
    "slug": "bakery_buns",
    "emoji": "🥐",
    "name": "Булочки",
    "desc": "Булочки",
    "parentSlug": "bakery",
    "order": 1,
    "active": true
  },
  {
    "slug": "bakery_ingredients",
    "emoji": "🥐",
    "name": "Кондитерские ингредиенты",
    "desc": "Кондитерские ингредиенты",
    "parentSlug": "bakery",
    "order": 2,
    "active": true
  },
  {
    "slug": "bakery_flatbread",
    "emoji": "🥐",
    "name": "Лепёшки",
    "desc": "Лепёшки",
    "parentSlug": "bakery",
    "order": 3,
    "active": true
  },
  {
    "slug": "bakery_cookies",
    "emoji": "🥐",
    "name": "Печенье",
    "desc": "Печенье",
    "parentSlug": "bakery",
    "order": 4,
    "active": true
  },
  {
    "slug": "bakery_donuts",
    "emoji": "🥐",
    "name": "Пончики",
    "desc": "Пончики",
    "parentSlug": "bakery",
    "order": 5,
    "active": true
  },
  {
    "slug": "bakery_cakes",
    "emoji": "🥐",
    "name": "Торты",
    "desc": "Торты",
    "parentSlug": "bakery",
    "order": 6,
    "active": true
  },
  {
    "slug": "bakery_bread",
    "emoji": "🥐",
    "name": "Хлеб",
    "desc": "Хлеб",
    "parentSlug": "bakery",
    "order": 7,
    "active": true
  },
  {
    "slug": "stationery",
    "emoji": "✏️",
    "name": "Канцтовары",
    "desc": "Канцтовары",
    "parentSlug": null,
    "order": 11,
    "active": true
  },
  {
    "slug": "stationery_office",
    "emoji": "✏️",
    "name": "Для офиса и школы",
    "desc": "Для офиса и школы",
    "parentSlug": "stationery",
    "order": 1,
    "active": true
  },
  {
    "slug": "stationery_art",
    "emoji": "✏️",
    "name": "Для творчества",
    "desc": "Для творчества",
    "parentSlug": "stationery",
    "order": 2,
    "active": true
  },
  {
    "slug": "conservation",
    "emoji": "🥫",
    "name": "Консервация",
    "desc": "Консервация",
    "parentSlug": null,
    "order": 12,
    "active": true
  },
  {
    "slug": "conservation_mushrooms",
    "emoji": "🥫",
    "name": "Грибы",
    "desc": "Грибы",
    "parentSlug": "conservation",
    "order": 1,
    "active": true
  },
  {
    "slug": "conservation_jam",
    "emoji": "🥫",
    "name": "Джем и варенье",
    "desc": "Джем и варенье",
    "parentSlug": "conservation",
    "order": 2,
    "active": true
  },
  {
    "slug": "conservation_canned_meat",
    "emoji": "🥫",
    "name": "Консервы мясные",
    "desc": "Консервы мясные",
    "parentSlug": "conservation",
    "order": 3,
    "active": true
  },
  {
    "slug": "conservation_canned_veg",
    "emoji": "🥫",
    "name": "Консервы овощные",
    "desc": "Консервы овощные",
    "parentSlug": "conservation",
    "order": 4,
    "active": true
  },
  {
    "slug": "conservation_canned_fish",
    "emoji": "🥫",
    "name": "Консервы рыбные",
    "desc": "Консервы рыбные",
    "parentSlug": "conservation",
    "order": 5,
    "active": true
  },
  {
    "slug": "conservation_canned_fruit",
    "emoji": "🥫",
    "name": "Консервы фруктовые",
    "desc": "Консервы фруктовые",
    "parentSlug": "conservation",
    "order": 6,
    "active": true
  },
  {
    "slug": "conservation_olives",
    "emoji": "🥫",
    "name": "Оливки и маслины",
    "desc": "Оливки и маслины",
    "parentSlug": "conservation",
    "order": 7,
    "active": true
  },
  {
    "slug": "meat",
    "emoji": "🥩",
    "name": "Мясо и птица",
    "desc": "Мясо и птица",
    "parentSlug": null,
    "order": 13,
    "active": true
  },
  {
    "slug": "meat_lamb",
    "emoji": "🥩",
    "name": "Баранина",
    "desc": "Баранина",
    "parentSlug": "meat",
    "order": 1,
    "active": true
  },
  {
    "slug": "meat_beef",
    "emoji": "🥩",
    "name": "Говядина",
    "desc": "Говядина",
    "parentSlug": "meat",
    "order": 2,
    "active": true
  },
  {
    "slug": "meat_kazy",
    "emoji": "🥩",
    "name": "Казы",
    "desc": "Казы",
    "parentSlug": "meat",
    "order": 3,
    "active": true
  },
  {
    "slug": "meat_sausages",
    "emoji": "🥩",
    "name": "Колбасные изделия",
    "desc": "Колбасные изделия",
    "parentSlug": "meat",
    "order": 4,
    "active": true
  },
  {
    "slug": "meat_deli",
    "emoji": "🥩",
    "name": "Мясные деликатесы",
    "desc": "Мясные деликатесы",
    "parentSlug": "meat",
    "order": 5,
    "active": true
  },
  {
    "slug": "meat_poultry",
    "emoji": "🥩",
    "name": "Птица",
    "desc": "Птица",
    "parentSlug": "meat",
    "order": 6,
    "active": true
  },
  {
    "slug": "meat_wieners",
    "emoji": "🥩",
    "name": "Сосиски и сардельки",
    "desc": "Сосиски и сардельки",
    "parentSlug": "meat",
    "order": 7,
    "active": true
  },
  {
    "slug": "meat_mince",
    "emoji": "🥩",
    "name": "Фарш и полуфабрикаты",
    "desc": "Фарш и полуфабрикаты",
    "parentSlug": "meat",
    "order": 8,
    "active": true
  },
  {
    "slug": "veg_fruit",
    "emoji": "🥬",
    "name": "Овощи и фрукты",
    "desc": "Овощи и фрукты",
    "parentSlug": null,
    "order": 14,
    "active": true
  },
  {
    "slug": "veg_fruit_greens",
    "emoji": "🥬",
    "name": "Зелень",
    "desc": "Зелень",
    "parentSlug": "veg_fruit",
    "order": 1,
    "active": true
  },
  {
    "slug": "veg_fruit_vegetables",
    "emoji": "🥬",
    "name": "Овощи",
    "desc": "Овощи",
    "parentSlug": "veg_fruit",
    "order": 2,
    "active": true
  },
  {
    "slug": "veg_fruit_fruits",
    "emoji": "🥬",
    "name": "Фрукты и ягоды",
    "desc": "Фрукты и ягоды",
    "parentSlug": "veg_fruit",
    "order": 3,
    "active": true
  },
  {
    "slug": "oils_sauces",
    "emoji": "🧂",
    "name": "Масла, соусы и соль",
    "desc": "Масла, соусы и соль",
    "parentSlug": null,
    "order": 15,
    "active": true
  },
  {
    "slug": "oils_sauces_mayo",
    "emoji": "🧂",
    "name": "Майонез",
    "desc": "Майонез",
    "parentSlug": "oils_sauces",
    "order": 1,
    "active": true
  },
  {
    "slug": "oils_sauces_oil",
    "emoji": "🧂",
    "name": "Масло и уксус",
    "desc": "Масло и уксус",
    "parentSlug": "oils_sauces",
    "order": 2,
    "active": true
  },
  {
    "slug": "oils_sauces_spices",
    "emoji": "🧂",
    "name": "Приправы",
    "desc": "Приправы",
    "parentSlug": "oils_sauces",
    "order": 3,
    "active": true
  },
  {
    "slug": "oils_sauces_salt",
    "emoji": "🧂",
    "name": "Соль, сода",
    "desc": "Соль, сода",
    "parentSlug": "oils_sauces",
    "order": 4,
    "active": true
  },
  {
    "slug": "oils_sauces_sauces",
    "emoji": "🧂",
    "name": "Соусы",
    "desc": "Соусы",
    "parentSlug": "oils_sauces",
    "order": 5,
    "active": true
  },
  {
    "slug": "household_chem",
    "emoji": "🧴",
    "name": "Бытовая химия",
    "desc": "Бытовая химия",
    "parentSlug": null,
    "order": 16,
    "active": true
  },
  {
    "slug": "household_chem_aroma",
    "emoji": "🧴",
    "name": "Ароматы для дома",
    "desc": "Ароматы для дома",
    "parentSlug": "household_chem",
    "order": 1,
    "active": true
  },
  {
    "slug": "household_chem_laundry",
    "emoji": "🧴",
    "name": "Для стирки",
    "desc": "Для стирки",
    "parentSlug": "household_chem",
    "order": 2,
    "active": true
  },
  {
    "slug": "household_chem_towels",
    "emoji": "🧴",
    "name": "Полотенца и халаты",
    "desc": "Полотенца и халаты",
    "parentSlug": "household_chem",
    "order": 3,
    "active": true
  },
  {
    "slug": "household_chem_bathroom",
    "emoji": "🧴",
    "name": "Средства для санузла",
    "desc": "Средства для санузла",
    "parentSlug": "household_chem",
    "order": 4,
    "active": true
  },
  {
    "slug": "grocery",
    "emoji": "🌾",
    "name": "Бакалея",
    "desc": "Бакалея",
    "parentSlug": null,
    "order": 17,
    "active": true
  },
  {
    "slug": "grocery_cereals",
    "emoji": "🌾",
    "name": "Крупа",
    "desc": "Крупа",
    "parentSlug": "grocery",
    "order": 1,
    "active": true
  },
  {
    "slug": "grocery_pasta",
    "emoji": "🌾",
    "name": "Макароны",
    "desc": "Макароны",
    "parentSlug": "grocery",
    "order": 2,
    "active": true
  },
  {
    "slug": "grocery_honey",
    "emoji": "🌾",
    "name": "Мёд",
    "desc": "Мёд",
    "parentSlug": "grocery",
    "order": 3,
    "active": true
  },
  {
    "slug": "grocery_flour",
    "emoji": "🌾",
    "name": "Мука и дрожжи",
    "desc": "Мука и дрожжи",
    "parentSlug": "grocery",
    "order": 4,
    "active": true
  },
  {
    "slug": "grocery_sugar",
    "emoji": "🌾",
    "name": "Сахар, сахарная пудра",
    "desc": "Сахар, сахарная пудра",
    "parentSlug": "grocery",
    "order": 5,
    "active": true
  },
  {
    "slug": "appliances",
    "emoji": "🔌",
    "name": "Бытовая техника",
    "desc": "Бытовая техника",
    "parentSlug": null,
    "order": 18,
    "active": true
  },
  {
    "slug": "appliances_batteries",
    "emoji": "🔌",
    "name": "Батарейки и фонарики",
    "desc": "Батарейки и фонарики",
    "parentSlug": "appliances",
    "order": 1,
    "active": true
  },
  {
    "slug": "appliances_cables",
    "emoji": "🔌",
    "name": "Кабели и зарядные устройства",
    "desc": "Кабели и зарядные устройства",
    "parentSlug": "appliances",
    "order": 2,
    "active": true
  },
  {
    "slug": "appliances_building",
    "emoji": "🔌",
    "name": "Строительные материалы",
    "desc": "Строительные материалы",
    "parentSlug": "appliances",
    "order": 3,
    "active": true
  },
  {
    "slug": "appliances_home",
    "emoji": "🔌",
    "name": "Техника для дома",
    "desc": "Техника для дома",
    "parentSlug": "appliances",
    "order": 4,
    "active": true
  },
  {
    "slug": "appliances_kitchen",
    "emoji": "🔌",
    "name": "Техника для кухни",
    "desc": "Техника для кухни",
    "parentSlug": "appliances",
    "order": 5,
    "active": true
  },
  {
    "slug": "sweets_world",
    "emoji": "🍬",
    "name": "Мир сладостей",
    "desc": "Мир сладостей",
    "parentSlug": null,
    "order": 19,
    "active": true
  },
  {
    "slug": "sweets_world_dragee",
    "emoji": "🍬",
    "name": "Драже",
    "desc": "Драже",
    "parentSlug": "sweets_world",
    "order": 1,
    "active": true
  },
  {
    "slug": "sweets_world_gum",
    "emoji": "🍬",
    "name": "Жевательные резинки и леденцы",
    "desc": "Жевательные резинки и леденцы",
    "parentSlug": "sweets_world",
    "order": 2,
    "active": true
  },
  {
    "slug": "sweets_world_zephyr",
    "emoji": "🍬",
    "name": "Зефир, маршмеллоу, мармелад",
    "desc": "Зефир, маршмеллоу, мармелад",
    "parentSlug": "sweets_world",
    "order": 3,
    "active": true
  },
  {
    "slug": "sweets_world_cakes",
    "emoji": "🍬",
    "name": "Кексы, рулеты, бисквиты",
    "desc": "Кексы, рулеты, бисквиты",
    "parentSlug": "sweets_world",
    "order": 4,
    "active": true
  },
  {
    "slug": "sweets_world_candy_bulk",
    "emoji": "🍬",
    "name": "Конфеты (весовые)",
    "desc": "Конфеты (весовые)",
    "parentSlug": "sweets_world",
    "order": 5,
    "active": true
  },
  {
    "slug": "sweets_world_candy_pack",
    "emoji": "🍬",
    "name": "Конфеты в пачках",
    "desc": "Конфеты в пачках",
    "parentSlug": "sweets_world",
    "order": 6,
    "active": true
  },
  {
    "slug": "sweets_world_croissants",
    "emoji": "🍬",
    "name": "Круассаны",
    "desc": "Круассаны",
    "parentSlug": "sweets_world",
    "order": 7,
    "active": true
  },
  {
    "slug": "sweets_world_icecream",
    "emoji": "🍬",
    "name": "Мороженое",
    "desc": "Мороженое",
    "parentSlug": "sweets_world",
    "order": 8,
    "active": true
  },
  {
    "slug": "sweets_world_cookies_wafers",
    "emoji": "🍬",
    "name": "Печенье, вафли, пряники",
    "desc": "Печенье, вафли, пряники",
    "parentSlug": "sweets_world",
    "order": 9,
    "active": true
  },
  {
    "slug": "sweets_world_halva",
    "emoji": "🍬",
    "name": "Халва и ирис",
    "desc": "Халва и ирис",
    "parentSlug": "sweets_world",
    "order": 10,
    "active": true
  },
  {
    "slug": "sweets_world_chocolate",
    "emoji": "🍬",
    "name": "Шоколад",
    "desc": "Шоколад",
    "parentSlug": "sweets_world",
    "order": 11,
    "active": true
  },
  {
    "slug": "sweets_world_paste",
    "emoji": "🍬",
    "name": "Шоколадная и ореховая паста",
    "desc": "Шоколадная и ореховая паста",
    "parentSlug": "sweets_world",
    "order": 12,
    "active": true
  },
  {
    "slug": "sweets_world_bars",
    "emoji": "🍬",
    "name": "Шоколадные батончики",
    "desc": "Шоколадные батончики",
    "parentSlug": "sweets_world",
    "order": 13,
    "active": true
  }
]

export const CSV_GROUP_TO_SLUG: Record<string, string> = {
  "орехи, чипсы и снеки": "snacks",
  "снеки": "snacks",
  "пекарня": "bakery",
  "хлеб": "bakery_bread",
  "бакалея": "grocery",
  "молочные": "dairy",
  "молочка": "dairy",
  "мясо": "meat",
  "птица": "meat_poultry",
  "рыба": "fish",
  "напитки": "beverages",
  "вода": "beverages_table_water",
  "сладости": "sweets_world",
  "заморозка": "frozen",
  "дети": "kids",
  "химия": "household_chem",
  "хозтовары": "household",
  "косметика": "beauty",
  "консервы": "conservation",
  "овощи": "veg_fruit_vegetables",
  "фрукты": "veg_fruit_fruits"
}

export const CATEGORY_SLUG_ALIASES: Record<string, string> = {
  "fish_fish_frozen": "fish_frozen",
  "fish_fish_smoked": "fish_smoked",
  "kids_kids_hygiene": "kids_hygiene",
  "kids_kids_acc": "kids_acc",
  "kids_kids_food": "kids_food",
  "frozen_frozen_veg": "frozen_veg",
  "dairy_sour": "dairy_sour_cream",
  "sweets_world_candy_weight": "sweets_world_candy_bulk",
  "veg": "veg_fruit",
  "veg_ov": "veg_fruit_vegetables",
  "veg_fr": "veg_fruit_fruits",
  "meat_b": "meat_beef",
  "meat_p": "meat_poultry",
  "meat_k": "meat_sausages",
  "dairy_m": "dairy_milk",
  "dairy_f": "dairy_kefir",
  "dairy_s": "dairy_cheese",
  "dairy_e": "dairy_eggs",
  "dairy_t": "dairy_butter",
  "dairy_y": "dairy_yogurt",
  "bread": "bakery",
  "bread_h": "bakery_bread",
  "bread_b": "bakery_buns",
  "drinks": "beverages",
  "drinks_w": "beverages_table_water",
  "drinks_s": "beverages_soda",
  "drinks_j": "beverages_juice",
  "drinks_t": "tea_coffee_tea",
  "drinks_c": "tea_coffee_coffee",
  "drinks_e": "beverages_energy",
  "sweets": "sweets_world",
  "sweets_c": "sweets_world_candy_pack",
  "sweets_ch": "sweets_world_chocolate",
  "sweets_b": "sweets_world_cookies_wafers",
  "sweets_k": "sweets_world_cakes",
  "sweets_g": "sweets_world_gum",
  "snacks_s": "snacks_chips",
  "snacks_p": "snacks_popcorn",
  "grocery_p": "grocery_pasta",
  "grocery_s": "oils_sauces_spices",
  "grocery_o": "oils_sauces_sauces",
  "grocery_c": "conservation_canned_veg",
  "grocery_f": "grocery_flour",
  "grocery_n": "snacks_nuts",
  "grocery_j": "conservation_jam",
  "frozen_i": "sweets_world_icecream",
  "frozen_r": "frozen_semi",
  "frozen_v": "frozen_veg",
  "kids_f": "kids_food",
  "kids_h": "kids_hygiene",
  "kids_t": "kids_toys",
  "kids_a": "kids_acc",
  "house": "household_chem",
  "house_l": "household_chem_laundry",
  "house_c": "household_chem_bathroom",
  "house_p": "beauty_paper",
  "house_a": "household_chem_aroma",
  "beauty_b": "beauty_body",
  "beauty_h": "beauty_hair_body",
  "beauty_o": "beauty_oral",
  "beauty_s": "beauty_shaving",
  "beauty_d": "beauty_deodorant",
  "beauty_w": "beauty_feminine",
  "beauty_f": "beauty_face",
  "beauty_c": "beauty_perfume",
  "home": "household",
  "home_k": "household_kitchenware",
  "home_o": "stationery_office",
  "home_b": "appliances_batteries",
  "home_e": "appliances_cables",
  "home_r": "appliances_building",
  "home_sh": "household_shoes",
  "drink": "beverages",
  "sweet": "sweets_world",
  "chem": "household_chem",
  "grains": "grocery_cereals",
  "fish_old": "fish_frozen",
  "Попкорны": "snacks_popcorn"
}

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
