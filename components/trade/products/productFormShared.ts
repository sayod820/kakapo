import { categorySlug, findCategoryName } from '@/lib/useCategories'
import { normalizeBarcodes, productBarcodes } from '@/lib/productBarcodes'
import { nextFreeProductCode, parseProductCodeNum } from '@/lib/productCodes'
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

/** Форма нового товара с уже подставленными свободными артикулом и PLU */
export function emptyFormWithNextCodes(products: Product[]): ProductForm {
  const next = nextFreeProductCode(products)
  const code = String(next)
  return {
    ...emptyForm(),
    art: code,
    plu: next <= 9999 ? code : '',
  }
}

export function formFromProduct(p: Product, photo?: string): ProductForm {
  return {
    name: p.name,
    art: p.art,
    e: p.e || '📦',
    catId: p.catId || 'veg',
    unit: p.unit || 'шт',
    barcodes: productBarcodes(p),
    plu: p.plu || '',
    brand: p.brand || '',
    desc: p.desc || '',
    photo: p.photo || photo || '',
    photoThumb: p.photoThumb || '',
    sellType: p.sellType || 'piece',
    weightStep: String(p.weightStep || 1),
    unitGrams: String(p.unitGrams || 1000),
    hot: !!p.hot,
    organic: !!p.organic,
  }
}

export function stockStatus(stock: number) {
  if (stock <= 0) return { c: 'var(--red)', l: 'Нет' }
  if (stock <= 5) return { c: 'var(--gold)', l: 'Мало' }
  return { c: 'var(--green)', l: 'Есть' }
}

export function buildProductPayload(
  data: ProductForm,
  products: Product[],
  existing?: Product | null,
  categories: Category[] = [],
) {
  const next = nextFreeProductCode(products, existing?.id)
  const art = data.art.trim() || String(next)
  const artNum = parseProductCodeNum(art)
  const pluRaw = data.plu.trim()
  const plu = pluRaw
    || (artNum != null && artNum <= 9999 ? String(artNum) : (next <= 9999 ? String(next) : undefined))
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
    plu: plu || undefined,
    brand: data.brand || undefined,
    desc: data.desc || undefined,
    photo: data.photo || null,
    photoThumb: data.photoThumb || null,
    sellType: data.sellType,
    hot: data.hot,
    organic: data.organic,
    bulkPricing: existing?.bulkPricing,
    ...(data.sellType === 'weight' ? {
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
