export function updateRestaurantRating(db, restId) {
  if (!restId || restId === 'STORE') return
  const list = (db.reviews || []).filter(r => r.restId === restId)
  const r = (db.restaurants || []).find(x => x.id === restId)
  if (!r) return
  if (!list.length) return
  const avg = list.reduce((s, rev) => s + (Number(rev.rating) || 0), 0) / list.length
  r.rating = Math.round(avg * 10) / 10
  r.reviews = list.length
}

export function createReviewRecord(db, body) {
  if (!db._seq) db._seq = {}
  if (typeof db._seq.review !== 'number') {
    const ids = (db.reviews || []).map(r => Number(r.id) || 0)
    db._seq.review = ids.length ? Math.max(...ids) : 0
  }
  const restId = String(body.restId || 'STORE')
  const isStore = restId === 'STORE'
  const rest = isStore ? null : (db.restaurants || []).find(r => r.id === restId)
  const rating = Math.min(5, Math.max(1, Number(body.rating) || 5))
  const review = {
    id: ++db._seq.review,
    restId,
    restName: isStore ? 'КАКАПО Магазин' : (rest?.name || body.restName || ''),
    orderId: body.orderId ? String(body.orderId) : '',
    client: String(body.client || 'Клиент').trim(),
    rating,
    text: String(body.text || '').trim(),
    date: new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Asia/Dushanbe' }),
    status: 'new',
    restSeen: false,
    restNotified: !isStore,
    urgent: rating <= 2,
    createdAt: new Date().toISOString(),
    targetType: isStore ? 'market' : 'restaurant',
  }
  if (!Array.isArray(db.reviews)) db.reviews = []
  db.reviews.unshift(review)
  updateRestaurantRating(db, review.restId)
  return review
}
