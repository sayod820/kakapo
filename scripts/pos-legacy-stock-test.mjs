#!/usr/bin/env node
/**
 * Списание остатка в кассе: «висячий» остаток и FIFO по старым приходам.
 * Только память: db — обычный объект, ничего не пишется на диск и в API.
 *
 * Запуск: node scripts/pos-legacy-stock-test.mjs
 */
process.env.DATA_DIR = process.env.DATA_DIR || 'kakapo-pos-stock-test-data'

const {
  deductStockLines,
  reconcileAllProductStock,
  sumProductLayers,
  listProductStockLayers,
  ensurePosCollections,
} = await import('../server/kakapo-api/posLogic.js')

let passed = 0
let failed = 0
const fails = []

function check(name, cond, detail = '') {
  if (cond) {
    passed += 1
    console.log(`OK   ${name}${detail ? ' — ' + detail : ''}`)
  } else {
    failed += 1
    fails.push(name)
    console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`)
  }
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100

function makeDb(products) {
  const db = { products: [...products] }
  ensurePosCollections(db)
  return db
}

function product(over = {}) {
  return {
    id: 1,
    art: '1',
    name: 'Тестовый товар',
    price: 11,
    costPrice: 9.5,
    stock: 0,
    unit: 'шт',
    sellType: 'piece',
    ...over,
  }
}

function receipt(id, createdAtIso, productId, qty, retailPrice = 11, costPrice = 9.5) {
  return {
    id,
    supplierName: 'Приход',
    createdAtIso,
    serverAtIso: createdAtIso,
    totalCost: r2(qty * costPrice),
    paidNow: 0,
    debtAdded: 0,
    items: [{ productId, productName: 'Тестовый товар', qty, remainingQty: qty, costPrice, retailPrice }],
  }
}

// ── 1. Реальный случай #437: остаток 72, открытых партий нет ────────────────
{
  const db = makeDb([product({ id: 437, stock: 72 })])
  // Старый приход полностью распродан — строка есть, остатка нет
  db.stockReceipts.push(receipt('REC-old', '2026-08-02T12:11:50.667Z', 437, 79))
  db.stockReceipts[0].items[0].remainingQty = 0

  let error = null
  try {
    deductStockLines(db, [{ productId: 437, qty: 2 }])
  } catch (e) {
    error = e.message
  }
  check('1 остаток есть, партий нет: продажа проходит', !error, error || '')
  check('1 остаток уменьшился 72 → 70', r2(db.products[0].stock) === 70, String(db.products[0].stock))
  check('1 создан слой на недостающее', sumProductLayers(db, 437) === 70, String(sumProductLayers(db, 437)))
  const healLayer = db.stockReceipts.find(r => /Перенос остатка/.test(String(r.supplierName || '')))
  check('1 слой помечен как перенос остатка', !!healLayer, healLayer ? healLayer.supplierName : 'нет')
  check('1 слой не тянет деньги поставщику', healLayer && healLayer.paidNow === 0 && healLayer.debtAdded === 0)
}

// ── 2. FIFO: списание идёт из старых приходов ───────────────────────────────
{
  const db = makeDb([product({ id: 2, stock: 15 })])
  db.stockReceipts.push(receipt('REC-new', '2026-09-10T10:00:00.000Z', 2, 10))
  db.stockReceipts.push(receipt('REC-old', '2026-08-01T10:00:00.000Z', 2, 5))

  deductStockLines(db, [{ productId: 2, qty: 7 }])
  const oldRow = db.stockReceipts.find(r => r.id === 'REC-old').items[0]
  const newRow = db.stockReceipts.find(r => r.id === 'REC-new').items[0]
  check('2 сначала списан старый приход', oldRow.remainingQty === 0, `старый=${oldRow.remainingQty}`)
  check('2 остаток взят из нового прихода', newRow.remainingQty === 8, `новый=${newRow.remainingQty}`)
  check('2 итоговый остаток 15 → 8', r2(db.products[0].stock) === 8, String(db.products[0].stock))
}

// ── 3. Старый приход с другой ценой: продажа не блокируется ─────────────────
{
  const db = makeDb([product({ id: 3, stock: 4, price: 12 })])
  db.stockReceipts.push(receipt('REC-cheap', '2026-07-01T10:00:00.000Z', 3, 4, 10))

  let error = null
  try {
    deductStockLines(db, [{ productId: 3, qty: 1, preferRetailPrice: 12 }])
  } catch (e) {
    error = e.message
  }
  check('3 цена партии отличается: продажа проходит', !error, error || '')
  check('3 остаток 4 → 3', r2(db.products[0].stock) === 3, String(db.products[0].stock))
}

// ── 4. Нельзя продать больше, чем есть ─────────────────────────────────────
{
  const db = makeDb([product({ id: 4, stock: 3 })])
  let error = null
  try {
    deductStockLines(db, [{ productId: 4, qty: 5 }])
  } catch (e) {
    error = e.message
  }
  check('4 больше остатка: отказ с понятным текстом', !!error && /Недостаточно остатка/.test(error), error || 'продажа прошла')
  check('4 остаток не изменился', r2(db.products[0].stock) === 3, String(db.products[0].stock))
  check('4 лишний слой не создан', sumProductLayers(db, 4) === 0, String(sumProductLayers(db, 4)))
}

// ── 5. Всё или ничего: вторая строка не хватает ─────────────────────────────
{
  const db = makeDb([
    product({ id: 5, stock: 10 }),
    product({ id: 6, stock: 1, name: 'Второй товар' }),
  ])
  let error = null
  try {
    deductStockLines(db, [{ productId: 5, qty: 2 }, { productId: 6, qty: 5 }])
  } catch (e) {
    error = e.message
  }
  check('5 многострочный чек: ошибка возвращается', !!error && /Недостаточно остатка/.test(error), error || '')
  check('5 первая строка не списана', r2(db.products[0].stock) === 10, String(db.products[0].stock))
  check('5 слои первой строки не созданы', sumProductLayers(db, 5) === 0, String(sumProductLayers(db, 5)))
}

// ── 6. Сверка: остаток карточки переносится в партии ────────────────────────
{
  const db = makeDb([
    product({ id: 7, stock: 72 }),
    product({ id: 8, stock: 0 }),
  ])
  db.stockReceipts.push(receipt('REC-7', '2026-08-02T12:11:50.667Z', 7, 79))
  db.stockReceipts[0].items[0].remainingQty = 0

  const fixed = reconcileAllProductStock(db, { createdBy: 'test' })
  check('6 сверка нашла расхождение', fixed.some(f => f.id === 7), JSON.stringify(fixed))
  check('6 остаток товара не изменился', r2(db.products[0].stock) === 72, String(db.products[0].stock))
  check('6 партии теперь равны остатку', sumProductLayers(db, 7) === 72, String(sumProductLayers(db, 7)))
  const layers = listProductStockLayers(db, 7)
  check('6 открытых партий ровно одна', layers.length === 1, String(layers.length))
}

// ── 7. Нет расхождения: сверка ничего не создаёт ───────────────────────────
{
  const db = makeDb([product({ id: 9, stock: 5 })])
  db.stockReceipts.push(receipt('REC-9', '2026-09-01T10:00:00.000Z', 9, 5))
  const before = db.stockReceipts.length
  const fixed = reconcileAllProductStock(db, { createdBy: 'test' })
  check('7 лишних слоёв не появилось', db.stockReceipts.length === before && fixed.length === 0, `${before} → ${db.stockReceipts.length}`)
  check('7 остаток прежний', r2(db.products[0].stock) === 5, String(db.products[0].stock))
}

// ── 8. Повторная продажа после переноса не плодит слои ─────────────────────
{
  const db = makeDb([product({ id: 10, stock: 5 })])
  deductStockLines(db, [{ productId: 10, qty: 1 }])
  const afterFirst = db.stockReceipts.length
  deductStockLines(db, [{ productId: 10, qty: 1 }])
  check('8 второй чек не создаёт новый слой', db.stockReceipts.length === afterFirst, `${afterFirst} → ${db.stockReceipts.length}`)
  check('8 остаток 5 → 3', r2(db.products[0].stock) === 3, String(db.products[0].stock))
}

console.log(`\n=== ИТОГ: ${passed} пройдено, ${failed} не пройдено ===`)
if (failed) {
  console.log('Провалено: ' + fails.join('; '))
  process.exit(1)
}
