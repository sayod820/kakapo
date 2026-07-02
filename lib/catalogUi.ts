import { USE_API } from './config'

/** Placeholder while API data is loading — avoids demo→real flash */
export const UI_PLACEHOLDER = '…'

/** Per-product stars on cards: demo only (API has no per-SKU review ratings). */
export function productRatingUi(
  p: { r?: number; rv?: number },
  catalogReady: boolean,
): { stars: number; label: string } | null {
  if (USE_API) return null
  if (!catalogReady) return { stars: 0, label: UI_PLACEHOLDER }
  const r = Number(p.r) || 0
  const rv = Number(p.rv) || 0
  if (!r) return null
  return { stars: r, label: `${r}(${rv})` }
}

export function restaurantRatingLabel(rating: number | undefined | null, ready: boolean): string {
  if (!ready) return UI_PLACEHOLDER
  const n = Number(rating)
  return n > 0 ? String(n) : '—'
}

export function restaurantReviewsLabel(reviews: number | undefined | null, ready: boolean): string {
  if (!ready) return UI_PLACEHOLDER
  return String(Number(reviews) || 0)
}

export function restaurantCuisineLabel(cuisine: string | undefined, ready: boolean): string {
  if (!ready) return UI_PLACEHOLDER
  return cuisine || '—'
}
