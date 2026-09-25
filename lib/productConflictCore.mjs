/**
 * Конфликт версии карточки товара (expectedDocVersion).
 *
 * Правка из очереди шлёт только поля, которые пользователь реально менял
 * (относительно базы `_prev`). Если сервер за это время менял другие поля —
 * сливаем сами; если те же поля — решает пользователь.
 */

/** Служебные поля и остаток: не часть правки карточки. */
const IGNORED = new Set([
  'id', 'docVersion', 'expectedDocVersion', 'updatedAtIso', 'updatedAt', 'createdAtIso', 'createdAt',
  'serverAtIso', 'stock', 'old', 'discount', 'clientRef', 'localId', '_prev', '_conflict',
])

export const PRODUCT_FIELD_LABEL = Object.freeze({
  name: 'Название',
  price: 'Цена',
  costPrice: 'Себестоимость',
  art: 'Артикул',
  plu: 'PLU',
  barcode: 'Штрихкод',
  barcodes: 'Штрихкоды',
  cat: 'Категория',
  catId: 'Категория',
  unit: 'Единица',
  sellType: 'Способ продажи',
  brand: 'Бренд',
  desc: 'Описание',
  photo: 'Фото',
  photoThumb: 'Фото',
  hot: 'Хит',
  organic: 'Органик',
  e: 'Значок',
  bulkPricing: 'Оптовые цены',
})

const norm = (v) => (v === undefined || v === '' ? null : v)
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b))

/** Поля правки: всё, что отличается от базы (без служебных). Без базы — вся карточка. */
export function changedProductFields(prev, mine) {
  const out = {}
  if (!mine || typeof mine !== 'object') return out
  for (const k of Object.keys(mine)) {
    if (IGNORED.has(k)) continue
    if (prev && typeof prev === 'object' && same(prev[k], mine[k])) continue
    out[k] = mine[k]
  }
  return out
}

/** Тело PATCH для правки из очереди. */
export function buildProductUpdateBody(prev, mine) {
  return changedProductFields(prev, mine)
}

/**
 * @returns {{ autoMergeable: boolean, fields: Array<{ field: string, label: string, base: any, mine: any, server: any }> }}
 */
export function analyzeProductConflict(prev, mine, server) {
  const changes = changedProductFields(prev, mine)
  const fields = []
  if (!server || typeof server !== 'object') {
    return { autoMergeable: false, fields: Object.keys(changes).map(k => row(k, prev, mine, server)) }
  }
  for (const k of Object.keys(changes)) {
    const base = prev ? prev[k] : undefined
    if (same(server[k], changes[k])) continue
    if (prev && same(server[k], base)) continue
    fields.push(row(k, prev, mine, server))
  }
  return { autoMergeable: !!prev && fields.length === 0, fields }
}

function row(k, prev, mine, server) {
  return {
    field: k,
    label: PRODUCT_FIELD_LABEL[k] || k,
    base: prev ? prev[k] : undefined,
    mine: mine ? mine[k] : undefined,
    server: server ? server[k] : undefined,
  }
}

export function isProductVersionConflict(err) {
  if (!err) return false
  const code = typeof err === 'object' ? String(err.code || '') : ''
  if (code === 'PRODUCT_DOC_VERSION_CONFLICT') return true
  const msg = typeof err === 'string' ? err : String(err.message || '')
  return /Товар уже меняли|PRODUCT_DOC_VERSION_CONFLICT/i.test(msg)
}

/** Текущая карточка сервера из ответа 409 (если сервер её прислал). */
export function serverProductFromError(err) {
  const cur = err && typeof err === 'object' ? err.body?.current : null
  return cur && typeof cur === 'object' ? cur : null
}
