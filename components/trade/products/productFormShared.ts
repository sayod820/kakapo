import { categorySlug, findCategoryName } from '@/lib/useCategories'
import { normalizeBarcodes, productBarcodes } from '@/lib/productBarcodes'
import { nextFreePlu, nextFreeProductCode } from '@/lib/productCodes'
import type { Category, Product, SellType } from '@/lib/types'

export function money(n: number | undefined | null) {
  return `${(Number(n) || 0).toFixed(2)} сом`
}

/** Заменяет запятую на точку и убирает всё, что не цифра/точка — number-инпуты в RU-локали ломают ввод. */
export function sanitizeDecimal(raw: string): string {
  let v = raw.replace(',', '.').replace(/[^0-9.]/g, '')
  const firstDot = v.indexOf('.')
  if (firstDot !== -1) v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '')
  return v
}

/** Единицы фасовки/размера для штучного товара */
export const PACK_MEASURES = [
  { id: 'шт', label: 'шт' },
  { id: 'размер', label: 'размер' },
  { id: 'г', label: 'г (граммы)' },
  { id: 'кг', label: 'кг' },
  { id: 'мл', label: 'мл' },
  { id: 'л', label: 'л' },
  { id: 'см', label: 'см' },
  { id: 'м', label: 'м' },
  { id: 'уп', label: 'уп.' },
] as const

export type PackMeasureId = (typeof PACK_MEASURES)[number]['id']

function normalizeMeasureLabel(raw: string): string {
  let t = raw.trim().toLowerCase().replace(/\./g, '')
  if (t === 'гр' || t === 'g' || t === 'gram' || t === 'grams') return 'г'
  if (t === 'kg' || t === 'килограмм' || t === 'килограмма') return 'кг'
  if (t === 'l' || t === 'литр' || t === 'литра' || t === 'литров') return 'л'
  if (t === 'ml' || t === 'миллилитр') return 'мл'
  if (t === 'cm') return 'см'
  if (t === 'pcs' || t === 'piece' || t === 'ед') return 'шт'
  if (t === 'size' || t === 'р' || t === 'р-р' || t === 'рр' || t === 'разм') return 'размер'
  if (t === 'упак' || t === 'упаковка' || t === 'pack') return 'уп'
  return t
}

/** Разбор «500 г» / «1/3 л» / «р. 42» / «шт» → число + единица */
export function parsePackFields(unit: string): { amount: string; measure: PackMeasureId | string } {
  const raw = String(unit || '').trim()
  if (!raw) return { amount: '', measure: 'шт' }
  const norm = normalizeMeasureLabel(raw)
  if (PACK_MEASURES.some(m => m.id === norm)) {
    return { amount: '', measure: norm }
  }
  // «р. 42» / «размер 42»
  const sizePref = /^(?:р\.?|размер)\s*[.:]?\s*(.+)$/iu.exec(raw)
  if (sizePref) {
    const amount = sanitizePackAmount(sizePref[1])
    if (amount) return { amount, measure: 'размер' }
  }
  // 1/3 л · 500 г · 0,5л · ½ л · 42 размер
  const m = /^(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)?|[½⅓⅔¼¾])\s*(.*)$/u.exec(raw)
  if (m) {
    const amount = m[1].replace(/\s+/g, '').replace(',', '.')
    const measureRaw = normalizeMeasureLabel(m[2] || '')
    if (measureRaw && PACK_MEASURES.some(x => x.id === measureRaw)) {
      return { amount, measure: measureRaw }
    }
    if (measureRaw) return { amount, measure: measureRaw }
    // Только число «5» — это размер (памперсы и т.п.), не граммы
    return { amount, measure: 'размер' }
  }
  return { amount: '', measure: 'шт' }
}

/** Сборка unit для сохранения: «80 г», «1/3 л», «р. 42», «шт» */
export function composePackUnit(amount: string, measure: string): string {
  const m = normalizeMeasureLabel(measure || 'шт') || 'шт'
  if (m === 'шт') return 'шт'
  const a = String(amount || '').trim().replace(',', '.').replace(/\s+/g, '')
  if (m === 'размер') return a ? `р. ${a}` : 'размер'
  // Число ещё не ввели — держим выбранную единицу («г» / «л»), чтобы селект не сбрасывался
  if (!a) return m
  return `${a} ${m}`
}

/** Ввод размера: число или дробь 1/3 */
export function sanitizePackAmount(raw: string): string {
  let v = raw.replace(',', '.').replace(/[^\d./½⅓⅔¼¾]/g, '')
  // одна дробь
  const slash = v.indexOf('/')
  if (slash !== -1) {
    const left = v.slice(0, slash).replace(/[^\d.]/g, '')
    let right = v.slice(slash + 1).replace(/[^\d.]/g, '')
    const dot = right.indexOf('.')
    if (dot !== -1) right = right.slice(0, dot + 1) + right.slice(dot + 1).replace(/\./g, '')
    v = `${left}/${right}`
  } else if (!/[½⅓⅔¼¾]/.test(v)) {
    v = sanitizeDecimal(v)
  }
  return v
}

export type ProductForm = {
  name: string
  art: string
  e: string
  catId: string
  unit: string
  barcodes: string[]
  plu: string
  brand: string
  desc: string
  photo: string
  photoThumb: string
  sellType: SellType
  weightStep: string
  unitGrams: string
  hot: boolean
  organic: boolean
}

export function emptyForm(): ProductForm {
  return {
    name: '', art: '', e: '📦', catId: 'veg',
    unit: 'шт', barcodes: [], plu: '', brand: '', desc: '', photo: '', photoThumb: '', sellType: 'piece',
    weightStep: '1', unitGrams: '1000', hot: false, organic: false,
  }
}

/** Форма нового товара со свободным артикулом (штрихкод не подставляем — только по «Авто» / скану) */
export function emptyFormWithNextCodes(products: Product[]): ProductForm {
  const next = nextFreeProductCode(products)
  const code = String(next)
  return {
    ...emptyForm(),
    art: code,
    plu: '',
    barcodes: [],
  }
}

/** Дубликат: имя, штрихкод, ед. как у исходного; артикул новый; PLU только если весовой. */
export function formFromDuplicate(source: Product, products: Product[]): ProductForm {
  const next = emptyFormWithNextCodes(products)
  const codes = productBarcodes(source)
  const sellType = source.sellType || 'piece'
  const isWeight = sellType === 'weight'
  const freePlu = isWeight ? nextFreePlu(products) : 0
  return {
    ...next,
    name: source.name || '',
    e: source.e || '📦',
    catId: source.catId || next.catId,
    unit: source.unit || 'шт',
    barcodes: codes.length ? [...codes] : next.barcodes,
    brand: source.brand || '',
    desc: source.desc || '',
    sellType,
    plu: isWeight && freePlu <= 9999 ? String(freePlu) : '',
    weightStep: String(source.weightStep || 1),
    unitGrams: String(source.unitGrams || 1000),
    hot: !!source.hot,
    organic: !!source.organic,
    photo: '',
    photoThumb: '',
  }
}

export function formFromProduct(p: Product, photo?: string): ProductForm {
  const sellType = p.sellType || 'piece'
  return {
    name: p.name,
    art: p.art,
    e: p.e || '📦',
    catId: p.catId || 'veg',
    unit: p.unit || 'шт',
    barcodes: productBarcodes(p),
    // PLU только у весовых; у штучных в форме пусто (при сохранении сбросится в базе)
    plu: sellType === 'weight' ? (p.plu || '') : '',
    brand: p.brand || '',
    desc: p.desc || '',
    photo: p.photo || photo || '',
    photoThumb: p.photoThumb || '',
    sellType,
    weightStep: String(p.weightStep || 1),
    unitGrams: String(p.unitGrams || 1000),
    hot: !!p.hot,
    organic: !!p.organic,
  }
}

export function stockStatus(stock: number) {
  if (stock <= 0) return { c: 'var(--red)', bg: 'var(--badge-stock-no)', l: 'Нет' }
  if (stock <= 5) return { c: 'var(--gold)', bg: 'var(--badge-stock-low)', l: 'Мало' }
  return { c: 'var(--green)', bg: 'var(--badge-stock-ok)', l: 'Есть' }
}

export function buildProductPayload(
  data: ProductForm,
  products: Product[],
  existing?: Product | null,
  categories: Category[] = [],
) {
  const next = nextFreeProductCode(products, existing?.id)
  const art = data.art.trim() || String(next)
  const isWeight = data.sellType === 'weight'
  let plu: string | undefined
  if (isWeight) {
    const raw = data.plu.trim()
    if (raw) {
      plu = raw
    } else {
      const n = nextFreePlu(products, existing?.id)
      plu = n <= 9999 ? String(n) : undefined
    }
  } else {
    plu = undefined
  }
  const { barcode, barcodes } = normalizeBarcodes(data.barcodes)
  return {
    ...(existing || {}),
    id: existing?.id,
    art,
    e: data.e || '📦',
    name: data.name.trim(),
    price: existing?.price ?? 0,
    costPrice: existing?.costPrice ?? null,
    catId: data.catId,
    cat: findCategoryName(categories, data.catId, data.catId),
    unit: data.unit || 'шт',
    stock: existing?.stock ?? 0,
    barcode: barcode || undefined,
    barcodes: barcodes.length ? barcodes : undefined,
    plu: plu || null,
    brand: data.brand || undefined,
    desc: data.desc || undefined,
    photo: data.photo || null,
    photoThumb: data.photoThumb || null,
    sellType: data.sellType,
    hot: data.hot,
    organic: data.organic,
    bulkPricing: existing?.bulkPricing,
    ...(isWeight ? {
      weightStep: 1,
      minWeight: 1,
      unitGrams: 1000,
    } : {
      weightStep: undefined,
      minWeight: undefined,
      unitGrams: undefined,
    }),
  }
}

export { POS_CATEGORIES } from '@/lib/posCategories'
