import { categorySlug, findCategoryName } from '@/lib/useCategories'
import { normalizeBarcodes, productBarcodes } from '@/lib/productBarcodes'
import type { Category, Product, SellType } from '@/lib/types'

export function money(n: number | undefined | null) {
  return `${(Number(n) || 0).toFixed(2)} сом`
}

export type ProductForm = {
  name: string
  art: string
  e: string
  catId: string
  price: string
  unit: string
  barcodes: string[]
  plu: string
  brand: string
  desc: string
  photo: string
  sellType: SellType
  weightStep: string
  unitGrams: string
  hot: boolean
  organic: boolean
}

export function emptyForm(): ProductForm {
  return {
    name: '', art: '', e: '📦', catId: 'veg', price: '',
    unit: 'шт', barcodes: [], plu: '', brand: '', desc: '', photo: '', sellType: 'piece',
    weightStep: '1', unitGrams: '1000', hot: false, organic: false,
  }
}

export function formFromProduct(p: Product, photo?: string): ProductForm {
  return {
    name: p.name,
    art: p.art,
    e: p.e || '📦',
    catId: p.catId || 'veg',
    price: String(p.price ?? ''),
    unit: p.unit || 'шт',
    barcodes: productBarcodes(p),
    plu: p.plu || '',
    brand: p.brand || '',
    desc: p.desc || '',
    photo: p.photo || photo || '',
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
  const id = existing?.id ?? Math.max(0, ...products.map(p => p.id)) + 1
  const art = data.art.trim() || `KAK-${String(id).padStart(4, '0')}`
  const { barcode, barcodes } = normalizeBarcodes(data.barcodes)
  return {
    ...(existing || {}),
    id: existing?.id,
    art,
    e: data.e || '📦',
    name: data.name.trim(),
    price: Number(data.price) || 0,
    costPrice: existing?.costPrice ?? null,
    catId: data.catId,
    cat: findCategoryName(categories, data.catId, data.catId),
    unit: data.unit || 'шт',
    stock: existing?.stock ?? 0,
    barcode: barcode || undefined,
    barcodes: barcodes.length ? barcodes : undefined,
    plu: data.plu.trim() || undefined,
    brand: data.brand || undefined,
    desc: data.desc || undefined,
    photo: data.photo || undefined,
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
