/**
 * Step 4: product doc-version conflict — diff body, auto-merge, user decision.
 * Run: node scripts/product-conflict-test.mjs
 */
import {
  changedProductFields,
  buildProductUpdateBody,
  analyzeProductConflict,
  isProductVersionConflict,
  serverProductFromError,
} from '../lib/productConflictCore.mjs'
import { outboxRetryPolicy, classifyOutboxError } from '../lib/outboxErrorClassifierCore.mjs'

let pass = 0
let fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok', name) } else { fail++; console.log('  FAIL', name) }
}

const base = { id: 7, name: 'Чай', price: 10, art: '100', stock: 5, docVersion: 3, cat: 'Напитки', catId: 'drinks', barcode: '4600', updatedAtIso: '2026-09-20T00:00:00Z' }

console.log('update body')
{
  const mine = { ...base, name: 'Чай зелёный', stock: 4, docVersion: 4, updatedAtIso: '2026-09-25T00:00:00Z', old: null, discount: 0 }
  const body = buildProductUpdateBody(base, mine)
  ok(JSON.stringify(body) === JSON.stringify({ name: 'Чай зелёный' }), 'only really changed field is sent')
  ok(!('stock' in body), 'stock never sent (write goes through adjustments)')
  const full = buildProductUpdateBody(null, mine)
  ok(!('stock' in full) && !('docVersion' in full) && full.name === 'Чай зелёный', 'no base → whole card without stock/service fields')
  ok(Object.keys(changedProductFields(base, { ...base, barcode: '' , brand: undefined })).length === 1, 'empty vs value counts as change, undefined vs missing does not')
}

console.log('conflict analysis')
{
  const mine = { ...base, name: 'Чай зелёный', docVersion: 4 }
  const serverPrice = { ...base, price: 12, docVersion: 4 }
  let a = analyzeProductConflict(base, mine, serverPrice)
  ok(a.autoMergeable && a.fields.length === 0, 'server changed other field → auto-merge')

  const serverName = { ...base, name: 'Чай чёрный', docVersion: 4 }
  a = analyzeProductConflict(base, mine, serverName)
  ok(!a.autoMergeable && a.fields.length === 1 && a.fields[0].field === 'name', 'same field changed differently → user decides')
  ok(a.fields[0].mine === 'Чай зелёный' && a.fields[0].server === 'Чай чёрный' && a.fields[0].label === 'Название', 'field row has mine/server/label')

  const serverSame = { ...base, name: 'Чай зелёный', docVersion: 4 }
  a = analyzeProductConflict(base, mine, serverSame)
  ok(a.autoMergeable, 'server already has my value → no conflict')

  a = analyzeProductConflict(base, mine, null)
  ok(!a.autoMergeable && a.fields.length === 1, 'no server card → ask user')

  a = analyzeProductConflict(null, mine, serverName)
  ok(!a.autoMergeable, 'no base → never auto-merge')
}

console.log('error detection')
{
  const err = Object.assign(new Error('Товар уже меняли (версия 4, ожидали 3) [PRODUCT_DOC_VERSION_CONFLICT]'), {
    status: 409, code: 'PRODUCT_DOC_VERSION_CONFLICT', body: { current: { id: 7, docVersion: 4 } },
  })
  ok(isProductVersionConflict(err), 'code detected')
  ok(isProductVersionConflict(new Error('Товар уже меняли (версия 4, ожидали 3)')), 'old server message detected')
  ok(!isProductVersionConflict(new Error('Остаток нельзя менять')), 'other error not a conflict')
  ok(serverProductFromError(err)?.docVersion === 4, 'server card taken from 409 body')
  ok(classifyOutboxError('product_upsert', err).class === 'CONFLICT', 'classifier: CONFLICT')
}

console.log('queue policy')
{
  const row = { kind: 'product_upsert', failed: true, errorClass: 'CONFLICT', payload: { _conflict: { fields: [] } } }
  ok(outboxRetryPolicy(row) === 'manual', 'row awaiting user decision is not auto-retried')
  ok(outboxRetryPolicy({ ...row, failed: false }) === 'send', 'after "keep mine" row is sent')
  ok(outboxRetryPolicy({ kind: 'product_upsert', failed: true, errorClass: 'INVALID', lastError: 'x' }) === 'manual', 'other reject stays visible, manual')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
