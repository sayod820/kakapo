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
