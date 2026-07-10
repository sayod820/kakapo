export const RECEIPT_DRAFT_KEY = 'kakapo-receipt-draft-v2'
export const WAREHOUSE_TAB_KEY = 'kakapo-warehouse-tab'

export type ReceiptDraftLine = {
  key: string
  productId: number | null
  qty: string
  costPrice: string
  retailPrice: string
  markupPct: string
  expiryDate: string
}

export type ReceiptDraft = {
  open: boolean
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
    qty: '',
    costPrice: '',
    retailPrice: '',
    markupPct: '',
    expiryDate: '',
  }
}

export function defaultReceiptDraft(): ReceiptDraft {
  return {
    open: false,
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
    return {
      ...defaultReceiptDraft(),
      ...parsed,
      activeLineKey: parsed.activeLineKey ?? null,
      scrollTop: Number(parsed.scrollTop) || 0,
      lines: Array.isArray(parsed.lines) && parsed.lines.length
        ? parsed.lines.map(l => ({ ...emptyReceiptLine(), ...l }))
        : [emptyReceiptLine()],
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
