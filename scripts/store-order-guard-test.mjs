/**
 * Store orders are priced by the server: browser totals, VIP credit and bonuses are ignored,
 * weighted lines use grams with a sane minimum, promo / bulk / delivery match the catalog.
 */
import { priceStoreOrderBody, isPromoActiveForStore } from '../server/kakapo-api/storeOrderGuard.js'
import { toPublicProduct, topSellingProductIds } from '../server/kakapo-api/publicProductView.js'

let pass = 0
let fail = 0
const check = (name, ok) => { if (ok) { pass++; console.log('PASS', name) } else { fail++; console.log('FAIL', name) } }
const throwsCode = (fn, code) => { try { fn(); return false } catch (e) { return e.code === code && e.status === 400 } }

const now = new Date('2026-10-05T07:00:00Z') // 12:00 Dushanbe
const db = {
  settings: { pricing: { base: 5, baseDist: 2.5, perKm: 2, freeFrom: 0, weightStepKg: 30, weightFirstExtra: 5, weightNextExtra: 3 } },
  products: [
    { id: 1, name: 'Сыр', price: 39.5, sellType: 'weight', unit: 'кг', weightStep: 1, minWeight: 1, costPrice: 30 },
    { id: 2, name: 'Сок', price: 12, unit: 'шт', bulkPricing: [{ minQty: 6, price: 10 }], supplierName: 'X' },
    { id: 3, name: 'Хлеб', price: 4, unit: 'шт' },
    { id: 4, name: 'Старый', price: 9, deleted: true },
  ],
  promos: [
    { id: 10, type: 'product', productId: 3, salePrice: 3, on: true, scheduleMode: 'always' },
    { id: 11, type: 'product', productId: 2, salePrice: 1, on: true, scheduleMode: 'daily', from: '20:00', to: '22:00' },
  ],
}
const client = { name: 'Тест', phone: '+992 900 00 00 01', addr: 'Яван' }

const body = {
  client,
  items: [
    { id: 1, product_id: 1, qty: 1, promoUnits: 500, price: 0.01 },
    { id: 2, product_id: 2, qty: 6, price: 0.01 },
    { id: 3, product_id: 3, qty: 2, price: 0.01 },
  ],
  total: 1, goodsTotal: 1, deliveryFee: 0,
  vip: true, creditAmount: 500, bonusSpent: 300, payment_method: 'credit',
  distanceKm: 4.5, weightKg: 1,
  clientRef: 'ref-1',
}
const out = priceStoreOrderBody(db, body, { now })
const [cheese, juice, bread] = out.items
check('cheese 500 g = 19.75', cheese.grams === 500 && cheese.qty === 1 && cheese.price === 19.75)
check('juice bulk tier 6 × 10', juice.qty === 6 && juice.price === 10)
check('bread promo 3', bread.price === 3)
check('inactive daily promo ignored', juice.price !== 1)
check('goodsTotal from catalog', out.goodsTotal === 19.75 + 60 + 6)
check('delivery 5 + ceil(2×2) = 9', out.deliveryFee === 9)
check('total = goods + delivery', out.total === out.goodsTotal + 9)
check('vip/credit/bonus dropped, cash only',
  out.vip === undefined && out.creditAmount === undefined && out.bonusSpent === undefined && out.payment_method === 'cash')
check('clientRef kept', out.clientRef === 'ref-1')

check('cheese below min (minWeight=1 → 100 g) rejected',
  throwsCode(() => priceStoreOrderBody(db, { client, items: [{ id: 1, promoUnits: 40 }] }, { now }), 'STORE_WEIGHT_TOO_SMALL'))
check('deleted product rejected',
  throwsCode(() => priceStoreOrderBody(db, { client, items: [{ id: 4, qty: 1 }] }, { now }), 'STORE_PRODUCT_GONE'))
check('restaurant item rejected',
  throwsCode(() => priceStoreOrderBody(db, { client, items: [{ id: 9, source: 'restaurant', restId: 'R-01' }] }, { now }), 'STORE_RESTAURANTS_OFF'))
check('no phone rejected',
  throwsCode(() => priceStoreOrderBody(db, { client: { name: 'A', phone: '12' }, items: [{ id: 3, qty: 1 }] }, { now }), 'STORE_ORDER_INVALID'))

const free = priceStoreOrderBody({ ...db, settings: { pricing: { ...db.settings.pricing, freeFrom: 50 } } }, body, { now })
check('free delivery from 50', free.deliveryFee === 0 && free.total === free.goodsTotal)

check('promo stock limit reached → inactive',
  !isPromoActiveForStore({ on: true, scheduleMode: 'always', stockLimit: 5, stockSold: 5 }, now))
check('daily promo 11:50–12:30 active at 12:00',
  isPromoActiveForStore({ on: true, scheduleMode: 'daily', from: '11:50', to: '12:30' }, now))

const pub = toPublicProduct(db.products[0])
check('public product hides costPrice', pub.costPrice === undefined && pub.price === 39.5)
check('public product hides supplier', toPublicProduct(db.products[1]).supplierName === undefined)

const salesDb = {
  products: [
    { id: 1, price: 5, stock: 10 }, { id: 2, price: 5, stock: 10 }, { id: 3, price: 5, stock: 0 },
    { id: 4, price: 0, stock: 10 }, { id: 5, price: 5, stock: 10, deleted: true },
  ],
  posSales: [
    { createdAtIso: '2026-10-04T10:00:00Z', items: [{ productId: 2, qty: 1 }, { productId: 2, qty: 3 }, { productId: 1, qty: 1 }] },
    { createdAtIso: '2026-10-03T10:00:00Z', items: [{ productId: 2, qty: 1 }, { productId: 3, qty: 9 }, { productId: 4, qty: 9 }, { productId: 5, qty: 9 }] },
    { createdAtIso: '2026-10-02T10:00:00Z', status: 'returned', items: [{ productId: 1, qty: 50 }] },
    { createdAtIso: '2026-10-01T10:00:00Z', items: [{ productId: 1, qty: 2, returnedQty: 2 }] },
    { createdAtIso: '2026-08-01T10:00:00Z', items: [{ productId: 1, qty: 99 }] },
  ],
}
const top = topSellingProductIds(salesDb, { now: now.getTime() })
check('top: ranked by receipts, skips stock 0 / no price / deleted / returned / old', JSON.stringify(top) === '[2,1]')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
