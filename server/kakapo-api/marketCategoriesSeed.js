/** Единый каталог категорий магазина (админка / касса / витрина / импорт) — POS дерево */
export const MARKET_CATEGORIES_SEED = [
  {
    slug: "snacks",
    emoji: "🍿",
    name: "Орехи, чипсы и снеки",
    desc: "Орехи, чипсы и снеки",
    parentSlug: null,
    order: 1,
    active: true
  },
  {
    slug: "snacks_sticks",
    emoji: "🍿",
    name: "Кукурузные палочки",
    desc: "Кукурузные палочки",
    parentSlug: "snacks",
    order: 1,
    active: true
  },
  {
    slug: "snacks_nuts",
    emoji: "🍿",
    name: "Орехи",
    desc: "Орехи",
    parentSlug: "snacks",
    order: 2,
    active: true
  },
  {
    slug: "snacks_popcorn",
    emoji: "🍿",
    name: "Попкорны",
    desc: "Попкорны",
    parentSlug: "snacks",
    order: 3,
    active: true
  },
  {
    slug: "snacks_seeds",
    emoji: "🍿",
    name: "Семечки",
    desc: "Семечки",
    parentSlug: "snacks",
    order: 4,
    active: true
  },
  {
    slug: "snacks_croutons",
    emoji: "🍿",
    name: "Сухарики, гренки",
    desc: "Сухарики, гренки",
    parentSlug: "snacks",
    order: 5,
    active: true
  },
  {
    slug: "snacks_dried_fruit",
    emoji: "🍿",
    name: "Сухофрукты",
    desc: "Сухофрукты",
    parentSlug: "snacks",
    order: 6,
    active: true
  },
  {
    slug: "snacks_chips",
    emoji: "🍿",
    name: "Чипсы",
    desc: "Чипсы",
    parentSlug: "snacks",
    order: 7,
    active: true
  },
  {
    slug: "bakery",
    emoji: "🥐",
    name: "Пекарня",
    desc: "Пекарня",
    parentSlug: null,
    order: 2,
    active: true
  },
  {
    slug: "bakery_buns",
    emoji: "🥐",
    name: "Булочки",
    desc: "Булочки",
    parentSlug: "bakery",
    order: 1,
    active: true
  },
  {
    slug: "bakery_ingredients",
    emoji: "🥐",
    name: "Кондитерские ингредиенты",
    desc: "Кондитерские ингредиенты",
    parentSlug: "bakery",
    order: 2,
    active: true
  },
  {
    slug: "bakery_flatbread",
    emoji: "🥐",
    name: "Лепешки",
    desc: "Лепешки",
    parentSlug: "bakery",
    order: 3,
    active: true
  },
  {
    slug: "bakery_cookies",
    emoji: "🥐",
    name: "Печенье",
    desc: "Печенье",
    parentSlug: "bakery",
    order: 4,
    active: true
  },
  {
    slug: "bakery_donuts",
    emoji: "🥐",
    name: "Пончики",
    desc: "Пончики",
    parentSlug: "bakery",
    order: 5,
    active: true
  },
  {
    slug: "bakery_cake",
    emoji: "🥐",
    name: "Торт",
    desc: "Торт",
    parentSlug: "bakery",
    order: 6,
    active: true
  },
  {
    slug: "bakery_bread",
    emoji: "🥐",
    name: "Хлеб",
    desc: "Хлеб",
    parentSlug: "bakery",
    order: 7,
    active: true
  },
  {
    slug: "beverages",
    emoji: "🧃",
    name: "Вода и напитки",
    desc: "Вода и напитки",
    parentSlug: null,
    order: 3,
    active: true
  },
  {
    slug: "beverages_soda",
    emoji: "🧃",
    name: "Газированный напиток",
    desc: "Газированный напиток",
    parentSlug: "beverages",
    order: 1,
    active: true
  },
  {
    slug: "beverages_mineral",
    emoji: "🧃",
    name: "Минеральная вода",
    desc: "Минеральная вода",
    parentSlug: "beverages",
    order: 2,
    active: true
  },
  {
    slug: "beverages_sweet_water",
    emoji: "🧃",
    name: "Сладкая вода",
    desc: "Сладкая вода",
    parentSlug: "beverages",
    order: 3,
    active: true
  },
  {
    slug: "beverages_juice",
    emoji: "🧃",
    name: "Сок, Нектар, Морс",
    desc: "Сок, Нектар, Морс",
    parentSlug: "beverages",
    order: 4,
    active: true
  },
  {
    slug: "beverages_table_water",
    emoji: "🧃",
    name: "Столовая вода",
    desc: "Столовая вода",
    parentSlug: "beverages",
    order: 5,
    active: true
  },
  {
    slug: "beverages_iced_tea",
    emoji: "🧃",
    name: "Холодный чай",
    desc: "Холодный чай",
    parentSlug: "beverages",
    order: 6,
    active: true
  },
  {
    slug: "beverages_energy",
    emoji: "🧃",
    name: "Энергетические напитки",
    desc: "Энергетические напитки",
    parentSlug: "beverages",
    order: 7,
    active: true
  },
  {
    slug: "frozen",
    emoji: "🧊",
    name: "Замороженные продукты",
    desc: "Замороженные продукты",
    parentSlug: null,
    order: 4,
    active: true
  },
  {
    slug: "frozen_pancakes",
    emoji: "🧊",
    name: "Блинчики",
    desc: "Блинчики",
    parentSlug: "frozen",
    order: 1,
    active: true
  },
  {
    slug: "frozen_frozen_veg",
    emoji: "🧊",
    name: "Замороженные овощи и ягоды",
    desc: "Замороженные овощи и ягоды",
    parentSlug: "frozen",
    order: 2,
    active: true
  },
  {
    slug: "frozen_cutlets",
    emoji: "🧊",
    name: "Котлеты",
    desc: "Котлеты",
    parentSlug: "frozen",
    order: 3,
    active: true
  },
  {
    slug: "frozen_dumplings",
    emoji: "🧊",
    name: "Пельмени",
    desc: "Пельмени",
    parentSlug: "frozen",
    order: 4,
    active: true
  },
  {
    slug: "frozen_semi",
    emoji: "🧊",
    name: "Полуфабрикаты",
    desc: "Полуфабрикаты",
    parentSlug: "frozen",
    order: 5,
    active: true
  },
  {
    slug: "household_chem",
    emoji: "🧴",
    name: "Бытовая химия",
    desc: "Бытовая химия",
    parentSlug: null,
    order: 5,
    active: true
  },
  {
    slug: "household_chem_aroma",
    emoji: "🧴",
    name: "Ароматы для дома",
    desc: "Ароматы для дома",
    parentSlug: "household_chem",
    order: 1,
    active: true
  },
  {
    slug: "household_chem_laundry",
    emoji: "🧴",
    name: "Для стирки",
    desc: "Для стирки",
    parentSlug: "household_chem",
    order: 2,
    active: true
  },
  {
    slug: "household_chem_towels",
    emoji: "🧴",
    name: "Полотенца и халаты",
    desc: "Полотенца и халаты",
    parentSlug: "household_chem",
    order: 3,
    active: true
  },
  {
    slug: "household_chem_bathroom",
    emoji: "🧴",
    name: "Средства для санузела",
    desc: "Средства для санузела",
    parentSlug: "household_chem",
    order: 4,
    active: true
  },
  {
    slug: "sweets_world",
    emoji: "🍫",
    name: "Мир сладостей",
    desc: "Мир сладостей",
    parentSlug: null,
    order: 6,
    active: true
  },
  {
    slug: "sweets_world_dragee",
    emoji: "🍫",
    name: "Драже",
    desc: "Драже",
    parentSlug: "sweets_world",
    order: 1,
    active: true
  },
  {
    slug: "sweets_world_gum",
    emoji: "🍫",
    name: "Жевательные резинки и леденцы",
    desc: "Жевательные резинки и леденцы",
    parentSlug: "sweets_world",
    order: 2,
    active: true
  },
  {
    slug: "sweets_world_marshmallow",
    emoji: "🍫",
    name: "Зефир, маршмеллоу, мармелад",
    desc: "Зефир, маршмеллоу, мармелад",
    parentSlug: "sweets_world",
    order: 3,
    active: true
  },
  {
    slug: "sweets_world_cakes",
    emoji: "🍫",
    name: "Кексы, рулеты, бисквиты",
    desc: "Кексы, рулеты, бисквиты",
    parentSlug: "sweets_world",
    order: 4,
    active: true
  },
  {
    slug: "sweets_world_candy_weight",
    emoji: "🍫",
    name: "Конфеты (Вес)",
    desc: "Конфеты (Вес)",
    parentSlug: "sweets_world",
    order: 5,
    active: true
  },
  {
    slug: "sweets_world_candy_pack",
    emoji: "🍫",
    name: "Конфеты в пачках",
    desc: "Конфеты в пачках",
    parentSlug: "sweets_world",
    order: 6,
    active: true
  },
  {
    slug: "sweets_world_croissants",
    emoji: "🍫",
    name: "Курассаны",
    desc: "Курассаны",
    parentSlug: "sweets_world",
    order: 7,
    active: true
  },
  {
    slug: "sweets_world_icecream",
    emoji: "🍫",
    name: "Мороженое",
    desc: "Мороженое",
    parentSlug: "sweets_world",
    order: 8,
    active: true
  },
  {
    slug: "sweets_world_cookies_wafers",
    emoji: "🍫",
    name: "Печенье, вафли, пряники",
    desc: "Печенье, вафли, пряники",
    parentSlug: "sweets_world",
    order: 9,
    active: true
  },
  {
    slug: "sweets_world_halva",
    emoji: "🍫",
    name: "Халва и ирис",
    desc: "Халва и ирис",
    parentSlug: "sweets_world",
    order: 10,
    active: true
  },
  {
    slug: "sweets_world_chocolate",
    emoji: "🍫",
    name: "Шоколад",
    desc: "Шоколад",
    parentSlug: "sweets_world",
    order: 11,
    active: true
  },
  {
    slug: "sweets_world_choco_paste",
    emoji: "🍫",
    name: "Шоколадная и ореховая пасты",
    desc: "Шоколадная и ореховая пасты",
    parentSlug: "sweets_world",
    order: 12,
    active: true
  },
  {
    slug: "sweets_world_choco_bars",
    emoji: "🍫",
    name: "Шоколадные батончики",
    desc: "Шоколадные батончики",
    parentSlug: "sweets_world",
    order: 13,
    active: true
  },
  {
    slug: "stationery",
    emoji: "📚",
    name: "Канцтовары",
    desc: "Канцтовары",
    parentSlug: null,
    order: 7,
    active: true
  },
  {
    slug: "stationery_office",
    emoji: "📚",
    name: "Для офиса и школы",
    desc: "Для офиса и школы",
    parentSlug: "stationery",
    order: 1,
    active: true
  },
  {
    slug: "stationery_craft",
    emoji: "📚",
    name: "Для творчества",
    desc: "Для творчества",
    parentSlug: "stationery",
    order: 2,
    active: true
  },
  {
    slug: "conservation",
    emoji: "🥫",
    name: "Консервация",
    desc: "Консервация",
    parentSlug: null,
    order: 8,
    active: true
  },
  {
    slug: "conservation_mushrooms",
    emoji: "🥫",
    name: "Грибы",
    desc: "Грибы",
    parentSlug: "conservation",
    order: 1,
    active: true
  },
  {
    slug: "conservation_jam",
    emoji: "🥫",
    name: "Джем и варенье",
    desc: "Джем и варенье",
    parentSlug: "conservation",
    order: 2,
    active: true
  },
  {
    slug: "conservation_canned_meat",
    emoji: "🥫",
    name: "Консервы мясные",
    desc: "Консервы мясные",
    parentSlug: "conservation",
    order: 3,
    active: true
  },
  {
    slug: "conservation_canned_veg",
    emoji: "🥫",
    name: "Консервы овощные",
    desc: "Консервы овощные",
    parentSlug: "conservation",
    order: 4,
    active: true
  },
  {
    slug: "conservation_canned_fish",
    emoji: "🥫",
    name: "Консервы рыбные",
    desc: "Консервы рыбные",
    parentSlug: "conservation",
    order: 5,
    active: true
  },
  {
    slug: "conservation_canned_fruit",
    emoji: "🥫",
    name: "Консервы фруктовый",
    desc: "Консервы фруктовый",
    parentSlug: "conservation",
    order: 6,
    active: true
  },
  {
    slug: "conservation_olives",
    emoji: "🥫",
    name: "Оливки и маслины",
    desc: "Оливки и маслины",
    parentSlug: "conservation",
    order: 7,
    active: true
  },
  {
    slug: "tea_coffee",
    emoji: "☕",
    name: "Чай, кофе и какао",
    desc: "Чай, кофе и какао",
    parentSlug: null,
    order: 9,
    active: true
  },
  {
    slug: "tea_coffee_cocoa",
    emoji: "☕",
    name: "Какао и горячий шоколад",
    desc: "Какао и горячий шоколад",
    parentSlug: "tea_coffee",
    order: 1,
    active: true
  },
  {
    slug: "tea_coffee_coffee",
    emoji: "☕",
    name: "Кофе",
    desc: "Кофе",
    parentSlug: "tea_coffee",
    order: 2,
    active: true
  },
  {
    slug: "tea_coffee_tea",
    emoji: "☕",
    name: "Чай",
    desc: "Чай",
    parentSlug: "tea_coffee",
    order: 3,
    active: true
  },
  {
    slug: "meat",
    emoji: "🥩",
    name: "Мясо и птица",
    desc: "Мясо и птица",
    parentSlug: null,
    order: 10,
    active: true
  },
  {
    slug: "meat_lamb",
    emoji: "🥩",
    name: "Баранина",
    desc: "Баранина",
    parentSlug: "meat",
    order: 1,
    active: true
  },
  {
    slug: "meat_beef",
    emoji: "🥩",
    name: "Говядина",
    desc: "Говядина",
    parentSlug: "meat",
    order: 2,
    active: true
  },
  {
    slug: "meat_kazy",
    emoji: "🥩",
    name: "Казы",
    desc: "Казы",
    parentSlug: "meat",
    order: 3,
    active: true
  },
  {
    slug: "meat_sausages",
    emoji: "🥩",
    name: "Колбасные изделия",
    desc: "Колбасные изделия",
    parentSlug: "meat",
    order: 4,
    active: true
  },
  {
    slug: "meat_deli",
    emoji: "🥩",
    name: "Мясные деликатесы",
    desc: "Мясные деликатесы",
    parentSlug: "meat",
    order: 5,
    active: true
  },
  {
    slug: "meat_poultry",
    emoji: "🥩",
    name: "Птица",
    desc: "Птица",
    parentSlug: "meat",
    order: 6,
    active: true
  },
  {
    slug: "meat_hotdogs",
    emoji: "🥩",
    name: "Сосиски и сардельки",
    desc: "Сосиски и сардельки",
    parentSlug: "meat",
    order: 7,
    active: true
  },
  {
    slug: "meat_minced",
    emoji: "🥩",
    name: "Фарш и полуфабрикаты",
    desc: "Фарш и полуфабрикаты",
    parentSlug: "meat",
    order: 8,
    active: true
  },
  {
    slug: "veg_fruit",
    emoji: "🥦",
    name: "Овощи и Фрукты",
    desc: "Овощи и Фрукты",
    parentSlug: null,
    order: 11,
    active: true
  },
  {
    slug: "veg_fruit_greens",
    emoji: "🥦",
    name: "Зелень",
    desc: "Зелень",
    parentSlug: "veg_fruit",
    order: 1,
    active: true
  },
  {
    slug: "veg_fruit_vegetables",
    emoji: "🥦",
    name: "Овощи",
    desc: "Овощи",
    parentSlug: "veg_fruit",
    order: 2,
    active: true
  },
  {
    slug: "veg_fruit_fruits",
    emoji: "🥦",
    name: "Фрукты и ягоды",
    desc: "Фрукты и ягоды",
    parentSlug: "veg_fruit",
    order: 3,
    active: true
  },
  {
    slug: "dairy",
    emoji: "🥛",
    name: "Молочные продукты",
    desc: "Молочные продукты",
    parentSlug: null,
    order: 12,
    active: true
  },
  {
    slug: "dairy_yogurt",
    emoji: "🥛",
    name: "Йогурт",
    desc: "Йогурт",
    parentSlug: "dairy",
    order: 1,
    active: true
  },
  {
    slug: "dairy_kefir",
    emoji: "🥛",
    name: "Кефир и ряженка",
    desc: "Кефир и ряженка",
    parentSlug: "dairy",
    order: 2,
    active: true
  },
  {
    slug: "dairy_butter",
    emoji: "🥛",
    name: "Масло и маргарин",
    desc: "Масло и маргарин",
    parentSlug: "dairy",
    order: 3,
    active: true
  },
  {
    slug: "dairy_milk",
    emoji: "🥛",
    name: "Молоко",
    desc: "Молоко",
    parentSlug: "dairy",
    order: 4,
    active: true
  },
  {
    slug: "dairy_condensed",
    emoji: "🥛",
    name: "Сгущенное молоко",
    desc: "Сгущенное молоко",
    parentSlug: "dairy",
    order: 5,
    active: true
  },
  {
    slug: "dairy_cream",
    emoji: "🥛",
    name: "Сливки",
    desc: "Сливки",
    parentSlug: "dairy",
    order: 6,
    active: true
  },
  {
    slug: "dairy_sour_cream",
    emoji: "🥛",
    name: "Сметана",
    desc: "Сметана",
    parentSlug: "dairy",
    order: 7,
    active: true
  },
  {
    slug: "dairy_curd_snacks",
    emoji: "🥛",
    name: "Сырки",
    desc: "Сырки",
    parentSlug: "dairy",
    order: 8,
    active: true
  },
  {
    slug: "dairy_cheese",
    emoji: "🥛",
    name: "Сыры",
    desc: "Сыры",
    parentSlug: "dairy",
    order: 9,
    active: true
  },
  {
    slug: "dairy_cottage",
    emoji: "🥛",
    name: "Творог",
    desc: "Творог",
    parentSlug: "dairy",
    order: 10,
    active: true
  },
  {
    slug: "dairy_chakka",
    emoji: "🥛",
    name: "Чакка",
    desc: "Чакка",
    parentSlug: "dairy",
    order: 11,
    active: true
  },
  {
    slug: "dairy_eggs",
    emoji: "🥛",
    name: "Яйцо",
    desc: "Яйцо",
    parentSlug: "dairy",
    order: 12,
    active: true
  },
  {
    slug: "oils_sauces",
    emoji: "🫗",
    name: "Масла, соусы и соль",
    desc: "Масла, соусы и соль",
    parentSlug: null,
    order: 13,
    active: true
  },
  {
    slug: "oils_sauces_mayo",
    emoji: "🫗",
    name: "Майонез",
    desc: "Майонез",
    parentSlug: "oils_sauces",
    order: 1,
    active: true
  },
  {
    slug: "oils_sauces_oil_vinegar",
    emoji: "🫗",
    name: "Масло и уксус",
    desc: "Масло и уксус",
    parentSlug: "oils_sauces",
    order: 2,
    active: true
  },
  {
    slug: "oils_sauces_spices",
    emoji: "🫗",
    name: "Приправы",
    desc: "Приправы",
    parentSlug: "oils_sauces",
    order: 3,
    active: true
  },
  {
    slug: "oils_sauces_salt",
    emoji: "🫗",
    name: "Соль, Сода",
    desc: "Соль, Сода",
    parentSlug: "oils_sauces",
    order: 4,
    active: true
  },
  {
    slug: "oils_sauces_sauces",
    emoji: "🫗",
    name: "Соусы",
    desc: "Соусы",
    parentSlug: "oils_sauces",
    order: 5,
    active: true
  },
  {
    slug: "beauty",
    emoji: "🪥",
    name: "Косметика и гигиена",
    desc: "Косметика и гигиена",
    parentSlug: null,
    order: 14,
    active: true
  },
  {
    slug: "beauty_beauty_acc",
    emoji: "🪥",
    name: "Аксессуары для красоты и гигиены",
    desc: "Аксессуары для красоты и гигиены",
    parentSlug: "beauty",
    order: 1,
    active: true
  },
  {
    slug: "beauty_paper",
    emoji: "🪥",
    name: "Бумажные изделия",
    desc: "Бумажные изделия",
    parentSlug: "beauty",
    order: 2,
    active: true
  },
  {
    slug: "beauty_cotton",
    emoji: "🪥",
    name: "Ватные изделия",
    desc: "Ватные изделия",
    parentSlug: "beauty",
    order: 3,
    active: true
  },
  {
    slug: "beauty_wet_wipes",
    emoji: "🪥",
    name: "Влажные салфетки",
    desc: "Влажные салфетки",
    parentSlug: "beauty",
    order: 4,
    active: true
  },
  {
    slug: "beauty_deodorant",
    emoji: "🪥",
    name: "Дезодорант",
    desc: "Дезодорант",
    parentSlug: "beauty",
    order: 5,
    active: true
  },
  {
    slug: "beauty_shaving",
    emoji: "🪥",
    name: "Для бритья и депиляции",
    desc: "Для бритья и депиляции",
    parentSlug: "beauty",
    order: 6,
    active: true
  },
  {
    slug: "beauty_body",
    emoji: "🪥",
    name: "Для тела",
    desc: "Для тела",
    parentSlug: "beauty",
    order: 7,
    active: true
  },
  {
    slug: "beauty_feminine",
    emoji: "🪥",
    name: "Женская гигиена",
    desc: "Женская гигиена",
    parentSlug: "beauty",
    order: 8,
    active: true
  },
  {
    slug: "beauty_hair_dye",
    emoji: "🪥",
    name: "Краска для волос",
    desc: "Краска для волос",
    parentSlug: "beauty",
    order: 9,
    active: true
  },
  {
    slug: "beauty_creams",
    emoji: "🪥",
    name: "Кремы",
    desc: "Кремы",
    parentSlug: "beauty",
    order: 10,
    active: true
  },
  {
    slug: "beauty_perfume",
    emoji: "🪥",
    name: "Парфюмерия",
    desc: "Парфюмерия",
    parentSlug: "beauty",
    order: 11,
    active: true
  },
  {
    slug: "beauty_napkins",
    emoji: "🪥",
    name: "Салфетки бумажные",
    desc: "Салфетки бумажные",
    parentSlug: "beauty",
    order: 12,
    active: true
  },
  {
    slug: "beauty_aftershave",
    emoji: "🪥",
    name: "Средства после бритья",
    desc: "Средства после бритья",
    parentSlug: "beauty",
    order: 13,
    active: true
  },
  {
    slug: "beauty_hair_body",
    emoji: "🪥",
    name: "Уход за волосами и телом",
    desc: "Уход за волосами и телом",
    parentSlug: "beauty",
    order: 14,
    active: true
  },
  {
    slug: "beauty_face",
    emoji: "🪥",
    name: "Уход за лицом",
    desc: "Уход за лицом",
    parentSlug: "beauty",
    order: 15,
    active: true
  },
  {
    slug: "beauty_oral",
    emoji: "🪥",
    name: "Уход за полостью рта",
    desc: "Уход за полостью рта",
    parentSlug: "beauty",
    order: 16,
    active: true
  },
  {
    slug: "grocery",
    emoji: "🧂",
    name: "Бакалея",
    desc: "Бакалея",
    parentSlug: null,
    order: 15,
    active: true
  },
  {
    slug: "grocery_cereals",
    emoji: "🧂",
    name: "Крупа",
    desc: "Крупа",
    parentSlug: "grocery",
    order: 1,
    active: true
  },
  {
    slug: "grocery_pasta",
    emoji: "🧂",
    name: "Макароны",
    desc: "Макароны",
    parentSlug: "grocery",
    order: 2,
    active: true
  },
  {
    slug: "grocery_honey",
    emoji: "🧂",
    name: "Мёд",
    desc: "Мёд",
    parentSlug: "grocery",
    order: 3,
    active: true
  },
  {
    slug: "grocery_flour",
    emoji: "🧂",
    name: "Мука и дрож",
    desc: "Мука и дрож",
    parentSlug: "grocery",
    order: 4,
    active: true
  },
  {
    slug: "grocery_sugar",
    emoji: "🧂",
    name: "Сахар, Сахарная пудра",
    desc: "Сахар, Сахарная пудра",
    parentSlug: "grocery",
    order: 5,
    active: true
  },
  {
    slug: "appliances",
    emoji: "🔌",
    name: "Бытовая техника",
    desc: "Бытовая техника",
    parentSlug: null,
    order: 16,
    active: true
  },
  {
    slug: "appliances_batteries",
    emoji: "🔌",
    name: "Батарейки и фонарики",
    desc: "Батарейки и фонарики",
    parentSlug: "appliances",
    order: 1,
    active: true
  },
  {
    slug: "appliances_cables",
    emoji: "🔌",
    name: "Кабели и зарядные устройства",
    desc: "Кабели и зарядные устройства",
    parentSlug: "appliances",
    order: 2,
    active: true
  },
  {
    slug: "appliances_building",
    emoji: "🔌",
    name: "Строительные материалы",
    desc: "Строительные материалы",
    parentSlug: "appliances",
    order: 3,
    active: true
  },
  {
    slug: "appliances_home_tech",
    emoji: "🔌",
    name: "Техника для дома",
    desc: "Техника для дома",
    parentSlug: "appliances",
    order: 4,
    active: true
  },
  {
    slug: "appliances_kitchen_tech",
    emoji: "🔌",
    name: "Техника для кухни",
    desc: "Техника для кухни",
    parentSlug: "appliances",
    order: 5,
    active: true
  },
  {
    slug: "fish",
    emoji: "🐟",
    name: "Рыбы и морепродукты",
    desc: "Рыбы и морепродукты",
    parentSlug: null,
    order: 17,
    active: true
  },
  {
    slug: "fish_fish_frozen",
    emoji: "🐟",
    name: "Рыба замороженая",
    desc: "Рыба замороженая",
    parentSlug: "fish",
    order: 1,
    active: true
  },
  {
    slug: "fish_fish_smoked",
    emoji: "🐟",
    name: "Рыба копчёная",
    desc: "Рыба копчёная",
    parentSlug: "fish",
    order: 2,
    active: true
  },
  {
    slug: "kids",
    emoji: "🧸",
    name: "Товары для детей",
    desc: "Товары для детей",
    parentSlug: null,
    order: 18,
    active: true
  },
  {
    slug: "kids_kids_hygiene",
    emoji: "🧸",
    name: "Детская гигиена",
    desc: "Детская гигиена",
    parentSlug: "kids",
    order: 1,
    active: true
  },
  {
    slug: "kids_kids_acc",
    emoji: "🧸",
    name: "Детские аксессуары",
    desc: "Детские аксессуары",
    parentSlug: "kids",
    order: 2,
    active: true
  },
  {
    slug: "kids_kids_food",
    emoji: "🧸",
    name: "Детское питание",
    desc: "Детское питание",
    parentSlug: "kids",
    order: 3,
    active: true
  },
  {
    slug: "kids_toys",
    emoji: "🧸",
    name: "Игрушки",
    desc: "Игрушки",
    parentSlug: "kids",
    order: 4,
    active: true
  },
  {
    slug: "household",
    emoji: "🏠",
    name: "Хозтовары",
    desc: "Хозтовары",
    parentSlug: null,
    order: 19,
    active: true
  },
  {
    slug: "household_cooking_storage",
    emoji: "🏠",
    name: "Для готовки и хранения",
    desc: "Для готовки и хранения",
    parentSlug: "household",
    order: 1,
    active: true
  },
  {
    slug: "household_shoes",
    emoji: "🏠",
    name: "Для обуви",
    desc: "Для обуви",
    parentSlug: "household",
    order: 2,
    active: true
  },
  {
    slug: "household_kitchenware",
    emoji: "🏠",
    name: "Кухонная утварь и аксессуары",
    desc: "Кухонная утварь и аксессуары",
    parentSlug: "household",
    order: 3,
    active: true
  },
  {
    slug: "household_dishes",
    emoji: "🏠",
    name: "Посуда",
    desc: "Посуда",
    parentSlug: "household",
    order: 4,
    active: true
  },
  {
    slug: "household_matches",
    emoji: "🏠",
    name: "Спички",
    desc: "Спички",
    parentSlug: "household",
    order: 5,
    active: true
  },
  {
    slug: "other",
    emoji: "📦",
    name: "Прочее",
    desc: "Прочее",
    parentSlug: null,
    order: 99,
    active: true
  }
]

/** CSV GroupName → slug подкатегории */
export const CSV_GROUP_TO_SLUG = {
  "орехи, чипсы и снеки": "snacks",
  "кукурузные палочки": "snacks_sticks",
  "орехи": "snacks_nuts",
  "попкорны": "snacks_popcorn",
  "семечки": "snacks_seeds",
  "сухарики, гренки": "snacks_croutons",
  "сухофрукты": "snacks_dried_fruit",
  "чипсы": "snacks_chips",
  "пекарня": "bakery_buns",
  "булочки": "bakery_buns",
  "кондитерские ингредиенты": "bakery_ingredients",
  "лепешки": "bakery_flatbread",
  "печенье": "bakery_cookies",
  "пончики": "bakery_donuts",
  "торт": "bakery_cake",
  "хлеб": "bakery_bread",
  "вода и напитки": "beverages",
  "газированный напиток": "beverages_soda",
  "минеральная вода": "beverages_mineral",
  "сладкая вода": "beverages_sweet_water",
  "сок, нектар, морс": "beverages_juice",
  "столовая вода": "beverages_table_water",
  "холодный чай": "beverages_iced_tea",
  "энергетические напитки": "beverages_energy",
  "замороженные продукты": "frozen",
  "блинчики": "frozen_pancakes",
  "замороженные овощи и ягоды": "frozen_frozen_veg",
  "котлеты": "frozen_cutlets",
  "пельмени": "frozen_dumplings",
  "полуфабрикаты": "frozen_semi",
  "бытовая химия": "household_chem",
  "ароматы для дома": "household_chem_aroma",
  "для стирки": "household_chem_laundry",
  "полотенца и халаты": "household_chem_towels",
  "средства для санузела": "household_chem_bathroom",
  "мир сладостей": "sweets_world",
  "драже": "sweets_world_dragee",
  "жевательные резинки и леденцы": "sweets_world_gum",
  "зефир, маршмеллоу, мармелад": "sweets_world_marshmallow",
  "кексы, рулеты, бисквиты": "sweets_world_cakes",
  "конфеты (вес)": "sweets_world_candy_weight",
  "конфеты в пачках": "sweets_world_candy_pack",
  "курассаны": "sweets_world_croissants",
  "мороженое": "sweets_world_icecream",
  "печенье, вафли, пряники": "sweets_world_cookies_wafers",
  "халва и ирис": "sweets_world_halva",
  "шоколад": "sweets_world_chocolate",
  "шоколадная и ореховая пасты": "sweets_world_choco_paste",
  "шоколадные батончики": "sweets_world_choco_bars",
  "канцтовары": "stationery",
  "для офиса и школы": "stationery_office",
  "для творчества": "stationery_craft",
  "консервация": "conservation_canned_veg",
  "грибы": "conservation_mushrooms",
  "джем и варенье": "conservation_jam",
  "консервы мясные": "conservation_canned_meat",
  "консервы овощные": "conservation_canned_veg",
  "консервы рыбные": "conservation_canned_fish",
  "консервы фруктовый": "conservation_canned_fruit",
  "оливки и маслины": "conservation_olives",
  "чай, кофе и какао": "tea_coffee_tea",
  "какао и горячий шоколад": "tea_coffee_cocoa",
  "кофе": "tea_coffee_coffee",
  "чай": "tea_coffee_tea",
  "мясо и птица": "meat_beef",
  "баранина": "meat_lamb",
  "говядина": "meat_beef",
  "казы": "meat_kazy",
  "колбасные изделия": "meat_sausages",
  "мясные деликатесы": "meat_deli",
  "птица": "meat_poultry",
  "сосиски и сардельки": "meat_hotdogs",
  "фарш и полуфабрикаты": "meat_minced",
  "овощи и фрукты": "veg_fruit",
  "зелень": "veg_fruit_greens",
  "овощи": "veg_fruit_vegetables",
  "фрукты и ягоды": "veg_fruit_fruits",
  "молочные продукты": "dairy",
  "йогурт": "dairy_yogurt",
  "кефир и ряженка": "dairy_kefir",
  "масло и маргарин": "dairy_butter",
  "молоко": "dairy_milk",
  "сгущенное молоко": "dairy_condensed",
  "сливки": "dairy_cream",
  "сметана": "dairy_sour_cream",
  "сырки": "dairy_curd_snacks",
  "сыры": "dairy_cheese",
  "творог": "dairy_cottage",
  "чакка": "dairy_chakka",
  "яйцо": "dairy_eggs",
  "масла, соусы и соль": "oils_sauces",
  "майонез": "oils_sauces_mayo",
  "масло и уксус": "oils_sauces_oil_vinegar",
  "приправы": "oils_sauces_spices",
  "соль, сода": "oils_sauces_salt",
  "соусы": "oils_sauces_sauces",
  "косметика и гигиена": "beauty_body",
  "аксессуары для красоты и гигиены": "beauty_beauty_acc",
  "бумажные изделия": "beauty_paper",
  "ватные изделия": "beauty_cotton",
  "влажные салфетки": "beauty_wet_wipes",
  "дезодорант": "beauty_deodorant",
  "для бритья и депиляции": "beauty_shaving",
  "для тела": "beauty_body",
  "женская гигиена": "beauty_feminine",
  "краска для волос": "beauty_hair_dye",
  "кремы": "beauty_creams",
  "парфюмерия": "beauty_perfume",
  "салфетки бумажные": "beauty_napkins",
  "средства после бритья": "beauty_aftershave",
  "уход за волосами и телом": "beauty_hair_body",
  "уход за лицом": "beauty_face",
  "уход за полостью рта": "beauty_oral",
  "бакалея": "grocery",
  "крупа": "grocery_cereals",
  "макароны": "grocery_pasta",
  "мёд": "grocery_honey",
  "мука и дрож": "grocery_flour",
  "сахар, сахарная пудра": "grocery_sugar",
  "бытовая техника": "appliances",
  "батарейки и фонарики": "appliances_batteries",
  "кабели и зарядные устройства": "appliances_cables",
  "строительные материалы": "appliances_building",
  "техника для дома": "appliances_home_tech",
  "техника для кухни": "appliances_kitchen_tech",
  "рыбы и морепродукты": "fish",
  "рыба замороженая": "fish_fish_frozen",
  "рыба копчёная": "fish_fish_smoked",
  "товары для детей": "kids",
  "детская гигиена": "kids_kids_hygiene",
  "детские аксессуары": "kids_kids_acc",
  "детское питание": "kids_kids_food",
  "игрушки": "kids_toys",
  "хозтовары": "household_kitchenware",
  "для готовки и хранения": "household_cooking_storage",
  "для обуви": "household_shoes",
  "кухонная утварь и аксессуары": "household_kitchenware",
  "посуда": "household_dishes",
  "спички": "household_matches",
  "прочее": "other",
  "овоши": "veg_fruit_vegetables",
  "дезодарант": "beauty_deodorant",
  "кансервы мясные": "conservation_canned_meat",
  "полфабрикаты": "frozen_semi",
  "жевательные резинки и леденци": "sweets_world_gum",
  "кукрузные палочки": "snacks_sticks",
  "птица (вес)": "meat_poultry",
  "весовие колбаси": "meat_sausages",
  "весовие сосиски": "meat_hotdogs",
  "1001 майдучайда": "tea_coffee_tea"
}

export const CATEGORY_SLUG_ALIASES = {
  veg: 'veg_fruit', veg_ov: 'veg_fruit_vegetables', veg_fr: 'veg_fruit_fruits',
  meat_b: 'meat_beef', meat_p: 'meat_poultry', meat_k: 'meat_sausages',
  dairy_m: 'dairy_milk', dairy_f: 'dairy_kefir', dairy_s: 'dairy_cheese', dairy_e: 'dairy_eggs', dairy_t: 'dairy_butter', dairy_y: 'dairy_yogurt',
  bread: 'bakery', bread_h: 'bakery_bread', bread_b: 'bakery_buns',
  drinks: 'beverages', drinks_w: 'beverages_table_water', drinks_s: 'beverages_soda', drinks_j: 'beverages_juice',
  drinks_t: 'tea_coffee_tea', drinks_c: 'tea_coffee_coffee', drinks_e: 'beverages_energy',
  sweets: 'sweets_world', sweets_c: 'sweets_world_candy_pack', sweets_ch: 'sweets_world_chocolate',
  sweets_b: 'sweets_world_cookies_wafers', sweets_k: 'sweets_world_cakes', sweets_g: 'sweets_world_gum',
  snacks: 'snacks', snacks_s: 'snacks_chips', snacks_p: 'snacks_popcorn',
  grocery: 'grocery', grocery_p: 'grocery_pasta', grocery_s: 'oils_sauces_spices', grocery_o: 'oils_sauces_sauces',
  grocery_c: 'conservation_canned_veg', grocery_f: 'grocery_flour', grocery_n: 'snacks_nuts', grocery_j: 'conservation_jam',
  frozen: 'frozen', frozen_i: 'sweets_world_icecream', frozen_r: 'frozen_semi', frozen_v: 'frozen_frozen_veg',
  kids: 'kids', kids_f: 'kids_kids_food', kids_h: 'kids_kids_hygiene', kids_t: 'kids_toys', kids_a: 'kids_kids_acc',
  house: 'household_chem', house_l: 'household_chem_laundry', house_c: 'household_chem_bathroom',
  house_p: 'beauty_paper', house_a: 'household_chem_aroma',
  beauty: 'beauty', beauty_b: 'beauty_body', beauty_h: 'beauty_hair_body', beauty_o: 'beauty_oral',
  beauty_s: 'beauty_shaving', beauty_d: 'beauty_deodorant', beauty_w: 'beauty_feminine',
  beauty_f: 'beauty_face', beauty_c: 'beauty_perfume',
  home: 'household', home_k: 'household_kitchenware', home_o: 'stationery_office',
  home_b: 'appliances_batteries', home_e: 'appliances_cables', home_r: 'appliances_building', home_sh: 'household_shoes',
  drink: 'beverages', sweet: 'sweets_world', chem: 'household_chem', grains: 'grocery_cereals', fish: 'fish_fish_frozen',
}

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
  const oldBySlug = new Map((db.categories || []).map(c => [c.slug, c]))
  db.categories = buildCategoriesFromSeed(db._seq)
  const newBySlug = new Map(db.categories.map(c => [c.slug, c]))
  for (const p of db.products || []) {
    const oldSlug = p.catId
    const aliased = CATEGORY_SLUG_ALIASES[oldSlug] || oldSlug
    const hit = newBySlug.get(aliased) || newBySlug.get(oldSlug)
    if (hit) { p.catId = hit.slug; p.cat = hit.name }
  }
  db.deletedCategorySlugs = []
  return { roots: db.categories.filter(c => c.parent_id == null).length, total: db.categories.length }
}

