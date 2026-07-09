import { findCategoryName } from '@/lib/useTradeCategories'
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
  costPrice: string
  stock: string
  unit: string
  barcode: string
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
    name: '', art: '', e: '📦', catId: 'veg', price: '', costPrice: '', stock: '0',
    unit: 'шт', barcode: '', brand: '', desc: '', photo: '', sellType: 'piece',
    weightStep: '100', unitGrams: '1000', hot: false, organic: false,
  }
}

export function formFromProduct(p: Product, photo?: string): ProductForm {
  return {
    name: p.name,
    art: p.art,
    e: p.e || '📦',
    catId: p.catId || 'veg',
    price: String(p.price ?? ''),
    costPrice: p.costPrice != null ? String(p.costPrice) : '',
    stock: String(p.stock ?? 0),
    unit: p.unit || 'шт',
    barcode: p.barcode || '',
    brand: p.brand || '',
    desc: p.desc || '',
    photo: p.photo || photo || '',
    sellType: p.sellType || 'piece',
    weightStep: String(p.weightStep || 100),
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
  return {
    ...(existing || {}),
    id: existing?.id,
    art,
    e: data.e || '📦',
    name: data.name.trim(),
    price: Number(data.price) || 0,
    costPrice: data.costPrice ? Number(data.costPrice) : null,
    catId: data.catId,
    cat: findCategoryName(categories, data.catId),
    unit: data.unit || 'шт',
    stock: Number(data.stock) || 0,
    barcode: data.barcode || undefined,
    brand: data.brand || undefined,
    desc: data.desc || undefined,
    photo: data.photo || undefined,
    sellType: data.sellType,
    hot: data.hot,
    organic: data.organic,
    bulkPricing: existing?.bulkPricing,
    ...(data.sellType === 'weight' ? {
      weightStep: Number(data.weightStep) || 100,
      minWeight: Number(data.weightStep) || 100,
      unitGrams: Number(data.unitGrams) || 1000,
    } : {}),
  }
}

export { POS_CATEGORIES } from '@/lib/posCategories'
