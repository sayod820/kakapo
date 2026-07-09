/** Категории товаров для POS / магазина (общие с админкой) */
export const POS_CATEGORIES = [
  { id: 'veg', e: '🥦', name: 'Овощи и фрукты' },
  { id: 'meat', e: '🥩', name: 'Мясо и птица' },
  { id: 'dairy', e: '🥛', name: 'Молочное' },
  { id: 'bread', e: '🥐', name: 'Выпечка и хлеб' },
  { id: 'drinks', e: '🧃', name: 'Напитки' },
  { id: 'grains', e: '🌾', name: 'Крупы и бобовые' },
  { id: 'frozen', e: '🧊', name: 'Заморозка' },
  { id: 'sweets', e: '🍫', name: 'Сладости' },
  { id: 'house', e: '🧴', name: 'Бытовая химия' },
] as const

export function posCategoryName(catId?: string, fallback = 'Прочее') {
  return POS_CATEGORIES.find(c => c.id === catId)?.name || fallback
}

export function posCategoryEmoji(catId?: string) {
  return POS_CATEGORIES.find(c => c.id === catId)?.e || '🏷️'
}
