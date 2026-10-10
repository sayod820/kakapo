/**
 * Гостевой трекинг заказов магазина — чистые тесты логики (К3).
 * Run: node scripts/client-order-tracking-test.mjs
 */
import {
  TRACK_BATCH_MAX,
  normPhone,
  upsertRef,
  collectRefsForPhone,
  mergeTrackedIntoOrders,
} from '../lib/clientOrderTrackingCore.mjs'

let pass = 0
let fail = 0
function t(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ok  ${name}`)
  } catch (e) {
    fail++
    console.log(`  FAIL ${name}: ${e.message}`)
  }
}
function eq(a, b, msg = '') {
  if (a !== b) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}
function ok(cond, msg = 'expected truthy') {
  if (!cond) throw new Error(msg)
}

console.log('client-order-tracking')

// ── normPhone ──
t('normPhone: +992 формат → последние 9 цифр', () => {
  eq(normPhone('+992 90 123 45 67'), '901234567')
})
t('normPhone: локальный ввод', () => {
  eq(normPhone('90 123 45 67'), '901234567')
})
t('normPhone: пусто/мусор → пусто', () => {
  eq(normPhone(''), '')
  eq(normPhone(null), '')
  eq(normPhone('abc'), '')
})

// ── upsertRef ──
t('upsertRef: добавляет заказ свежим первым', () => {
  const refs = upsertRef([], 'K-1', '901234567')
  eq(refs.length, 1)
  eq(refs[0].id, 'K-1')
  eq(refs[0].phone, '901234567')
  ok(typeof refs[0].ts === 'number', 'ts должен быть числом')
})
t('upsertRef: дубликат id поднимается наверх, без повторов', () => {
  let refs = upsertRef([], 'K-1', '901234567')
  refs = upsertRef(refs, 'K-2', '901234567')
  refs = upsertRef(refs, 'K-1', '901234567')
  eq(refs.length, 2)
  eq(refs[0].id, 'K-1')
  eq(refs[1].id, 'K-2')
})
t('upsertRef: пустой id или телефон игнорируются', () => {
  eq(upsertRef([], '', '901234567').length, 0)
  eq(upsertRef([], 'K-1', '').length, 0)
  eq(upsertRef([], 'K-1', 'abc').length, 0)
})
t('upsertRef: уважает лимит хранения', () => {
  let refs = []
  for (let i = 0; i < 80; i++) refs = upsertRef(refs, `K-${i}`, '901234567', 10)
  eq(refs.length, 10)
  eq(refs[0].id, 'K-79')
})

// ── collectRefsForPhone ──
t('collectRefsForPhone: только заказы этого телефона', () => {
  let refs = upsertRef([], 'A-1', '901234567')
  refs = upsertRef(refs, 'B-1', '935555555')
  const mine = collectRefsForPhone(refs, '+992901234567')
  eq(mine.length, 1)
  eq(mine[0].id, 'A-1')
})
t('collectRefsForPhone: пустой телефон → пусто', () => {
  eq(collectRefsForPhone(upsertRef([], 'A-1', '901234567'), '').length, 0)
})
t('collectRefsForPhone: уважает лимит партии (20)', () => {
  let refs = []
  for (let i = 0; i < 40; i++) refs = upsertRef(refs, `K-${i}`, '901234567')
  eq(collectRefsForPhone(refs, '901234567').length, TRACK_BATCH_MAX)
})

// ── mergeTrackedIntoOrders ──
const baseOrders = [
  { id: 'K-1', status: 'new', total: 10, items: [{ id: 1, name: 'Сыр', qty: 1, price: 10 }] },
  { id: 'K-2', status: 'new', total: 20 },
]

t('merge: пустой ответ → тот же массив (стабильные ссылки)', () => {
  eq(mergeTrackedIntoOrders(baseOrders, []), baseOrders)
  eq(mergeTrackedIntoOrders(baseOrders, null), baseOrders)
})
t('merge: обновляет статус существующего заказа', () => {
  const out = mergeTrackedIntoOrders(baseOrders, [{ id: 'K-1', status: 'delivering', total: 10 }])
  eq(out.length, 2)
  eq(out.find(o => o.id === 'K-1').status, 'delivering')
  eq(out.find(o => o.id === 'K-2').status, 'new')
})
t('merge: неизменная запись не создаёт новый массив', () => {
  const same = mergeTrackedIntoOrders(baseOrders, [{ id: 'K-1', status: 'new', total: 10 }])
  eq(same, baseOrders)
})
t('merge: новый заказ с сервера добавляется', () => {
  const out = mergeTrackedIntoOrders(baseOrders, [{ id: 'K-9', status: 'delivered', total: 5 }])
  eq(out.length, 3)
  eq(out.find(o => o.id === 'K-9').status, 'delivered')
})
t('merge: новому заказу проставляется телефон владельца (для фильтра «Мои заказы»)', () => {
  const out = mergeTrackedIntoOrders(baseOrders, [{ id: 'K-9', status: 'delivered' }], '+992 90 123 45 67')
  eq(out.find(o => o.id === 'K-9').client.phone, '+992 90 123 45 67')
})
t('merge: телефон не проставляется, если не задан', () => {
  const out = mergeTrackedIntoOrders(baseOrders, [{ id: 'K-9', status: 'delivered' }])
  eq(out.find(o => o.id === 'K-9').client, undefined)
})
t('merge: подтягивает позиции, если локально их нет', () => {
  const tracked = [{ id: 'K-2', status: 'delivering', items: [{ id: 7, name: 'Хлеб', qty: 2, price: 3 }] }]
  const out = mergeTrackedIntoOrders(baseOrders, tracked)
  const k2 = out.find(o => o.id === 'K-2')
  eq(k2.status, 'delivering')
  eq(k2.items.length, 1)
  eq(k2.items[0].name, 'Хлеб')
})
t('merge: локальные позиции не перетираются ответом', () => {
  const tracked = [{ id: 'K-1', status: 'delivered', items: [{ id: 99, name: 'Чужое', qty: 1, price: 1 }] }]
  const out = mergeTrackedIntoOrders(baseOrders, tracked)
  eq(out.find(o => o.id === 'K-1').items[0].name, 'Сыр')
})
t('merge: игнорирует записи без id', () => {
  const out = mergeTrackedIntoOrders(baseOrders, [{ status: 'delivered' }])
  eq(out, baseOrders)
})

console.log(`\nclient-order-tracking: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
