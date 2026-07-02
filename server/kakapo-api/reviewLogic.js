const STORE_REVIEW_REST_ID = 'STORE'

export function updateRestaurantRating(db, restId) {
  if (!restId || restId === STORE_REVIEW_REST_ID) return
  const list = (db.reviews || []).filter(r => String(r.restId) === String(restId))
  const r = (db.restaurants || []).find(x => x.id === restId)
  if (!r) return
  r.reviews = list.length
  if (!list.length) {
    r.rating = 0
    return
  }
  const avg = list.reduce((s, rev) => s + (Number(rev.rating) || 0), 0) / list.length
  r.rating = Math.round(avg * 10) / 10
}

export function updateStoreRating(db) {
  const list = (db.reviews || []).filter(r => String(r.restId) === STORE_REVIEW_REST_ID)
  if (!db.storeMeta) db.storeMeta = {}
  db.storeMeta.reviewCount = list.length
  if (!list.length) {
    db.storeMeta.rating = 0
    return
  }
  const avg = list.reduce((s, rev) => s + (Number(rev.rating) || 0), 0) / list.length
  db.storeMeta.rating = Math.round(avg * 10) / 10
}

export function createReviewRecord(db, body) {
  if (!db._seq) db._seq = {}
  if (typeof db._seq.review !== 'number') {
    const ids = (db.reviews || []).map(r => Number(r.id) || 0)
    db._seq.review = ids.length ? Math.max(...ids) : 0
  }

  const restId = String(body.restId || STORE_REVIEW_REST_ID)
  const isStore = restId === STORE_REVIEW_REST_ID
  const rest = isStore ? null : (db.restaurants || []).find(r => r.id === restId)
  const rating = Math.min(5, Math.max(1, Number(body.rating) || 5))
  const text = String(body.text || '').trim()

  const review = {
    id: ++db._seq.review,
    restId,
    restName: isStore ? 'КАКАПО Магазин' : (rest?.name || body.restName || ''),
    orderId: body.orderId ? String(body.orderId) : '',
    client: String(body.client || 'Клиент').trim(),
    rating,
    text: text || '★'.repeat(rating),
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
  if (isStore) updateStoreRating(db)
  else updateRestaurantRating(db, restId)
  return review
}

const STORE_ID = STORE_REVIEW_REST_ID

export function deleteReviewRecords(db, ids) {
  const idSet = new Set((ids || []).map(id => String(id)).filter(Boolean))
  if (!idSet.size) return { deleted: 0 }
  const before = (db.reviews || []).length
  const affectedRestIds = new Set()
  let storeAffected = false
  db.reviews = (db.reviews || []).filter(r => {
    if (!idSet.has(String(r.id))) return true
    if (String(r.restId) === STORE_ID) storeAffected = true
    else affectedRestIds.add(String(r.restId))
    return false
  })
  if (storeAffected) updateStoreRating(db)
  for (const rid of affectedRestIds) updateRestaurantRating(db, rid)
  return { deleted: before - (db.reviews || []).length }
}
