'use strict'

/**
 * ONLINE-O5B — in-tx master-data CREATE mutations (PG durable opRef + entity atomic).
 */
import { allocateProductCodes, allocateProductBarcodes, nextFreeProductCode } from './productCodes.js'
import { setProductStockExact, createSupplier, sumProductLayers } from './posLogic.js'
import { recordSyncDelete } from './syncDeletes.js'
import { createEmployee } from './employeesLogic.js'
import {
  touchedFromFinance,
  touchedFromWarehouse,
} from './pg/businessMutationTx.js'

function metaSeq(db) {
  return { _seq: JSON.parse(JSON.stringify(db._seq || {})) }
}

function touchedProduct(db, p) {
  return [
    ...touchedFromFinance(db, { product: p }),
    ...touchedFromWarehouse(db, { products: [p], productIds: [p.id] }),
  ]
}

export function fingerprintProductCreate(body = {}) {
  const sellType = body.sellType || 'piece'
  return {
    name: String(body.name || '').trim(),
    price: Number(body.price) || 0,
    stock: Number(body.stock) || 0,
    sellType,
    catId: String(body.catId || ''),
    art: body.art != null ? String(body.art) : '',
  }
}

export function mutateCreateProduct(db, body = {}) {
  const sellType = body.sellType || 'piece'
  const needPlu = sellType === 'weight'
  const codes = allocateProductCodes(db.products, {
    art: body.art,
    plu: needPlu ? body.plu : '',
  }, null, { needPlu })
  const preferSerial = Number(codes.art) || nextFreeProductCode(db.products)
  const bars = allocateProductBarcodes(db.products, {
    barcode: body.barcode,
    barcodes: body.barcodes,
  }, preferSerial)
  const id = ++db._seq.product
  const p = {
    id,
    art: codes.art,
    e: body.e || '📦',
    name: body.name,
    price: body.price || 0,
    costPrice: body.costPrice ?? null,
    cat: body.cat || '',
    catId: body.catId || '',
    unit: body.unit || 'шт',
    stock: body.stock || 0,
    hot: !!body.hot,
    desc: body.desc,
    brand: body.brand,
    country: body.country,
    barcode: bars.barcode,
    barcodes: bars.barcodes,
    plu: needPlu ? (codes.plu || null) : null,
    organic: !!body.organic,
    sellType,
    unitGrams: body.unitGrams,
    weightStep: body.weightStep,
    minWeight: body.minWeight,
    packWeightGrams: body.packWeightGrams != null && Number(body.packWeightGrams) > 0
      ? Math.round(Number(body.packWeightGrams))
      : undefined,
    old: body.old ?? null,
    photo: body.photo ? String(body.photo) : undefined,
    photoThumb: body.photoThumb ? String(body.photoThumb) : undefined,
    bulkPricing: Array.isArray(body.bulkPricing) ? body.bulkPricing : undefined,
    docVersion: 1,
    updatedAtIso: new Date().toISOString(),
  }
  db.products.push(p)
  if (Number(p.stock) > 0) {
    setProductStockExact(db, p.id, p.stock, {
      reason: 'Начальный остаток',
      createdBy: body?.createdBy || '',
    })
  } else {
    p.stock = 0
  }
  const clientRef = String(body.clientRef || '').trim()
  if (clientRef) p.clientRef = clientRef
  return {
    result: p,
    touched: touchedProduct(db, p),
    meta: metaSeq(db),
  }
}

export function fingerprintSupplierCreate(body = {}) {
  return {
    name: String(body.name || '').trim(),
    phone: String(body.phone || '').trim(),
    inn: String(body.inn || '').trim(),
  }
}

export function mutateCreateSupplier(db, body = {}) {
  const row = createSupplier(db, body)
  const clientRef = String(body.clientRef || '').trim()
  if (clientRef) row.clientRef = clientRef
  return {
    result: row,
    touched: touchedFromFinance(db, { supplier: row }),
    meta: metaSeq(db),
  }
}

export function fingerprintCategoryCreate(body = {}, slug) {
  return {
    name: String(body.name || '').trim(),
    slug: String(slug || body.slug || '').trim(),
    parent_id: body.parent_id == null ? null : Number(body.parent_id),
  }
}

export function mutateCreateCategory(db, body = {}, { slugifyCategory }) {
  const slug = String(body.slug || '').trim() || slugifyCategory(body.name)
  if (db.categories.some(c => c.slug === slug)) {
    const err = new Error('slug exists')
    err.status = 400
    throw err
  }
  const parent_id = body.parent_id ?? null
  if (parent_id != null && !db.categories.some(c => c.id === Number(parent_id))) {
    const err = new Error('parent not found')
    err.status = 400
    throw err
  }
  const id = ++db._seq.category
  const c = {
    id,
    name: String(body.name || '').trim(),
    slug,
    parent_id: parent_id == null ? null : Number(parent_id),
    emoji: body.emoji || '📦',
    desc: String(body.desc || '').trim(),
    order: Number(body.order) || 99,
    active: body.active !== false,
  }
  if (!c.name) {
    const err = new Error('name required')
    err.status = 400
    throw err
  }
  if (Array.isArray(db.deletedCategorySlugs)) {
    db.deletedCategorySlugs = db.deletedCategorySlugs.filter(s => s !== slug)
  }
  db.categories.push(c)
  return {
    result: c,
    touched: [{ collection: 'categories', row: c }],
    meta: metaSeq(db),
  }
}

export function fingerprintEmployeeCreate(body = {}) {
  return {
    name: String(body.name || '').trim(),
    role: String(body.role || 'custom'),
  }
}

export function mutateCreateEmployee(db, body = {}) {
  const row = createEmployee(db, body)
  return {
    result: row,
    touched: touchedFromFinance(db, { employee: row }),
    meta: metaSeq(db),
  }
}

export function fingerprintPromoCreate(body = {}) {
  return {
    title: String(body.title || '').trim(),
    disc: Number(body.disc) || 0,
    type: String(body.type || 'pct'),
  }
}

export function fingerprintProductDelete(productId) {
  return { productId: Number(productId) }
}

export function mutateDeleteProduct(db, productId, { deleteManagedProductPhotoFn }) {
  const id = Number(productId)
  const existing = db.products.find(x => x.id === id)
  if (!existing) {
    const err = new Error('Не найдено')
    err.status = 404
    throw err
  }
  const layers = sumProductLayers(db, id)
  if (layers > 0.009 || (Number(existing.stock) || 0) > 0.009) {
    const err = new Error(
      `Нельзя удалить товар со складом (остаток ${Math.max(layers, Number(existing.stock) || 0).toFixed(2)})`,
    )
    err.status = 409
    throw err
  }
  if (existing?.photo && deleteManagedProductPhotoFn) deleteManagedProductPhotoFn(existing.photo)
  db.products = db.products.filter(x => x.id !== id)
  recordSyncDelete(db, 'product', id)
  return {
    result: { ok: true, id },
    deletes: [{ collection: 'products', id: String(id) }],
    meta: metaSeq(db),
  }
}

export function mutateCreatePromo(db, body = {}, { resolvePromoStockLimitUnit }) {
  if (typeof db._seq.promo !== 'number') db._seq.promo = 0
  const id = ++db._seq.promo
  const p = {
    id,
    e: '🎁',
    title: '',
    sub: '',
    disc: 0,
    on: true,
    cat: 'Магазин',
    type: 'pct',
    from: '08:00',
    to: '22:00',
    till: 'Всегда',
    ...body,
  }
  resolvePromoStockLimitUnit(p)
  if (!Array.isArray(db.promos)) db.promos = []
  db.promos.push(p)
  return {
    result: p,
    touched: [{ collection: 'promos', row: p }],
    meta: metaSeq(db),
  }
}
