export function updateRestaurantRating(db, restId) {
  const list = (db.reviews || []).filter(r => r.restId === restId)
  const r = db.restaurants.find(x => x.id === restId)
  if (!r) return
  if (!list.length) return
  const avg = list.reduce((s, rev) => s + (Number(rev.rating) || 0), 0) / list.length
  r.rating = Math.round(avg * 10) / 10
  r.reviews = list.length
}

export function createReviewRecord(db, body) {
  const rest = db.restaurants.find(r => r.id === body.restId)
  const rating = Math.min(5, Math.max(1, Number(body.rating) || 5))
  const review = {
    id: ++db._seq.review,
    restId: String(body.restId),
    restName: rest?.name || body.restName || '',
    orderId: body.orderId ? String(body.orderId) : '',
    client: String(body.client || 'Клиент').trim(),
    rating,
    text: String(body.text || '').trim(),
    date: new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
    status: 'new',
    restSeen: false,
    restNotified: true,
    urgent: rating <= 2,
    createdAt: new Date().toISOString(),
  }
  if (!Array.isArray(db.reviews)) db.reviews = []
  db.reviews.unshift(review)
  updateRestaurantRating(db, review.restId)
  return review
}
