import { MARKET_CATEGORIES_SEED } from './marketCategoriesSeed'

/** Корневые категории для POS (fallback, если API ещё не загрузился) */
export const POS_CATEGORIES = MARKET_CATEGORIES_SEED
  .filter(item => !item.parentSlug)
  .map(item => ({ id: item.slug, e: item.emoji, name: item.name }))

export function posCategoryName(catId?: string, fallback = 'Прочее') {
  return MARKET_CATEGORIES_SEED.find(c => c.slug === catId)?.name || fallback
}

export function posCategoryEmoji(catId?: string) {
  const hit = MARKET_CATEGORIES_SEED.find(c => c.slug === catId)
  return hit?.emoji || '🏷️'
}
