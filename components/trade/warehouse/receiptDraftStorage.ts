import type { ProductForm } from '@/components/trade/products/productFormShared'
import type { Product } from '@/lib/types'

export const RECEIPT_DRAFT_KEY = 'kakapo-receipt-draft-v2'
export const WAREHOUSE_TAB_KEY = 'kakapo-warehouse-tab'

/** Новый товар только в черновике — в каталог/на кассу попадёт после «Провести приход» */
export type PendingReceiptProduct = {
  form: ProductForm
}

export type ReceiptDraftLine = {
  key: string
  productId: number | null
  /** Локальный черновик нового товара (ещё не в каталоге) */
  pendingProduct?: PendingReceiptProduct | null
  qty: string
  purchaseTotal: string
  costPrice: string
  retailPrice: string
  markupPct: string
  expiryDate: string
  bulkPricing: { minQty: string; price: string }[]
}

export function lineHasProduct(line: ReceiptDraftLine) {
  return line.productId != null || !!line.pendingProduct?.form?.name?.trim()
}

export function productFromPending(line: ReceiptDraftLine): Product | null {
  const form = line.pendingProduct?.form
  if (!form?.name?.trim()) return null
  const barcodes = Array.isArray(form.barcodes) ? form.barcodes.filter(Boolean) : []
  return {
    id: -1,
    name: form.name.trim(),
    e: form.e || '📦',
    art: form.art || '',
    plu: form.plu || undefined,
    barcode: barcodes[0] || undefined,
    barcodes: barcodes.length ? barcodes : undefined,
    catId: form.catId || 'veg',
    cat: form.catId || 'veg',
    unit: form.unit || 'шт',
    price: 0,
    costPrice: null,
    stock: 0,
    sellType: form.sellType || 'piece',
    brand: form.brand || undefined,
    desc: form.desc || undefined,
    hot: !!form.hot,
    organic: !!form.organic,
  }
}

export type ReceiptDraft = {
  open: boolean
  /** Если задан — сохранение идёт как UPDATE, не как новый приход */
  editingId: string | null
  supplierId: string
  paidNow: string
  lines: ReceiptDraftLine[]
  activeLineKey: string | null
  scrollTop: number
}

export function emptyReceiptLine(): ReceiptDraftLine {
  return {
    key: String(Date.now() + Math.random()),
    productId: null,
    pendingProduct: null,
    qty: '',
    purchaseTotal: '',
    costPrice: '',
    retailPrice: '',
    markupPct: '',
    expiryDate: '',
    bulkPricing: [],
  }
}

export function defaultReceiptDraft(): ReceiptDraft {
  return {
    open: false,
    editingId: null,
    supplierId: '',
    paidNow: '',
    lines: [emptyReceiptLine()],
    activeLineKey: null,
    scrollTop: 0,
  }
}

export function loadReceiptDraft(): ReceiptDraft {
  if (typeof window === 'undefined') return defaultReceiptDraft()
  try {
    const raw = localStorage.getItem(RECEIPT_DRAFT_KEY) || localStorage.getItem('kakapo-receipt-draft-v1')
    if (!raw) return defaultReceiptDraft()
    const parsed = JSON.parse(raw) as Partial<ReceiptDraft>
    const lines = Array.isArray(parsed.lines) && parsed.lines.length
      ? parsed.lines.map(l => ({
        ...emptyReceiptLine(),
        ...l,
        pendingProduct: l.pendingProduct?.form?.name
          ? { form: l.pendingProduct.form }
          : null,
        purchaseTotal: l.purchaseTotal ?? '',
        bulkPricing: Array.isArray(l.bulkPricing) ? l.bulkPricing : [],
      }))
      : [emptyReceiptLine()]
    // Всегда держим пустую строку для поиска — иначе после черновика поиск «ломается»
    if (!lines.some(l => !lineHasProduct(l))) lines.push(emptyReceiptLine())
    return {
      ...defaultReceiptDraft(),
      ...parsed,
      editingId: parsed.editingId ? String(parsed.editingId) : null,
      activeLineKey: parsed.activeLineKey ?? null,
      scrollTop: Number(parsed.scrollTop) || 0,
      lines,
    }
  } catch {
    return defaultReceiptDraft()
  }
}

export function loadWarehouseTab(): import('./warehouseShared').WarehouseTab | null {
  if (typeof window === 'undefined') return null
  try {
    const v = localStorage.getItem(WAREHOUSE_TAB_KEY)
    if (!v) return null
    return v as import('./warehouseShared').WarehouseTab
  } catch {
    return null
  }
}

export function saveWarehouseTab(tab: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(WAREHOUSE_TAB_KEY, tab)
}

export function saveReceiptDraft(draft: ReceiptDraft) {
  if (typeof window === 'undefined') return
  localStorage.setItem(RECEIPT_DRAFT_KEY, JSON.stringify(draft))
}

export function clearReceiptDraft() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(RECEIPT_DRAFT_KEY)
}

export function roundMoney(n: number) {
  return Math.round(n * 100) / 100
}

export function linePurchaseSum(line: ReceiptDraftLine) {
  const total = Number(line.purchaseTotal) || 0
  if (total > 0) return total
  const qty = Number(line.qty) || 0
  const cost = Number(line.costPrice) || 0
  return roundMoney(qty * cost)
}

export function costFromPurchaseTotal(qty: number, purchaseTotal: number) {
  if (!(qty > 0) || !(purchaseTotal > 0)) return 0
  return roundMoney(purchaseTotal / qty)
}

export function retailFromMarkup(cost: number, markupPct: number) {
  if (!(cost > 0)) return 0
  return roundMoney(cost * (1 + markupPct / 100))
}

export function markupFromRetail(cost: number, retail: number) {
  if (!(cost > 0)) return 0
  return roundMoney(((retail - cost) / cost) * 100)
}

export function defaultMarkupPct(product?: { costPrice?: number | null; price?: number } | null) {
  const cost = Number(product?.costPrice) || 0
  const retail = Number(product?.price) || 0
  if (cost > 0 && retail > 0) return String(markupFromRetail(cost, retail))
  return '30'
}

export function receiptToDraft(receipt: import('@/lib/types').StockReceipt): ReceiptDraft {
  return {
    open: true,
    editingId: receipt.id,
    supplierId: receipt.supplierId || '',
    paidNow: String(receipt.paidNow ?? ''),
    lines: [
      ...receipt.items.map(item => {
        const cost = Number(item.costPrice) || 0
        const retail = Number(item.retailPrice) || 0
        const qty = Number(item.qty) || 0
        return {
          key: `edit-${item.productId}-${Math.random()}`,
          productId: item.productId,
          qty: String(qty),
          purchaseTotal: String(roundMoney(qty * cost)),
          costPrice: String(cost),
          retailPrice: retail > 0 ? String(retail) : '',
          markupPct: cost > 0 && retail > 0 ? String(markupFromRetail(cost, retail)) : '',
          expiryDate: item.expiryDate || '',
          bulkPricing: (item.bulkPricing || []).map(t => ({ minQty: String(t.minQty), price: String(t.price) })),
        }
      }),
      emptyReceiptLine(),
    ],
    activeLineKey: null,
    scrollTop: 0,
  }
}

export function receiptHasConsumption(receipt: import('@/lib/types').StockReceipt) {
  return receipt.items.some(it => Number(it.remainingQty ?? it.qty) < Number(it.qty))
}
