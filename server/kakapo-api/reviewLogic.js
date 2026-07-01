const STORE_REVIEW_REST_ID = 'STORE'

export function updateRestaurantRating(db, restId) {
  if (!restId || restId === STORE_REVIEW_REST_ID) return
  const list = (db.reviews || []).filter(r => r.restId === restId && !r.productKey)
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

  const productKey = String(body.productKey || '').trim()
  const productName = String(body.productName || body.product_name || '').trim()
  const productId = body.productId != null ? body.productId : body.product_id
  const rating = Math.min(5, Math.max(1, Number(body.rating) || 5))

  const review = {
    id: ++db._seq.review,
    restId: STORE_REVIEW_REST_ID,
    restName: productName ? `Товар: ${productName}` : 'КАКАПО Магазин',
    orderId: body.orderId ? String(body.orderId) : '',
    productKey: productKey || undefined,
    productId: productId != null && productId !== '' ? productId : undefined,
    productName: productName || undefined,
    client: String(body.client || 'Клиент').trim(),
    rating,
    text: String(body.text || '').trim(),
    date: new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Asia/Dushanbe' }),
    status: 'new',
    restSeen: true,
    restNotified: false,
    urgent: rating <= 2,
    createdAt: new Date().toISOString(),
    targetType: 'product',
  }

  if (!Array.isArray(db.reviews)) db.reviews = []
  db.reviews.unshift(review)
  return review
}
