'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import { serializeBulkPricing } from '@/lib/productBulkPricing'
import { useProducts } from '@/lib/store'
import type { PosSupplier, Product, StockReceipt } from '@/lib/types'
import BulkPricingFields, { type BulkPricingRow } from '@/components/trade/products/BulkPricingFields'
import WarehouseNewProductModal from './WarehouseNewProductModal'
import WarehouseNewSupplierModal from './WarehouseNewSupplierModal'
import WarehousePeriodFilter from './WarehousePeriodFilter'
import WarehouseProductSelect from './WarehouseProductSelect'
import WarehouseSupplierSelect from './WarehouseSupplierSelect'
import ReceiptLabelPrintModal from './ReceiptLabelPrintModal'
import {
  clearReceiptDraft,
  costFromPurchaseTotal,
  defaultMarkupPct,
  defaultReceiptDraft,
  emptyReceiptLine,
  linePurchaseSum,
  loadReceiptDraft,
  markupFromRetail,
  receiptHasConsumption,
  receiptToDraft,
  retailFromMarkup,
  roundMoney,
  saveReceiptDraft,
  type ReceiptDraft,
  type ReceiptDraftLine,
} from './receiptDraftStorage'
import {
  fmtDateTime,
  fmtMoney,
  formatQty,
  matchesDateRange,
  packInputUnitLabel,
  packRealWorld,
  parsePackUnit,
  sanitizeDecimalInput,
} from './warehouseShared'

const QUICK_MARKUPS = [20, 30, 40, 50]

function fillLineFromProduct(line: ReceiptDraftLine, product: Product): ReceiptDraftLine {
  const cost = product.costPrice != null ? String(product.costPrice) : line.costPrice
  const costNum = Number(cost) || 0
  const productRetail = product.price != null ? Number(product.price) : 0
  let markupPct = line.markupPct
  let retailPrice = line.retailPrice

  if (!markupPct && productRetail > 0 && costNum > 0) {
    markupPct = String(markupFromRetail(costNum, productRetail))
    retailPrice = String(productRetail)
  } else if (!markupPct) {
    markupPct = defaultMarkupPct(product)
  }

  if (costNum > 0 && markupPct !== '') {
    retailPrice = String(retailFromMarkup(costNum, Number(markupPct) || 0))
  } else if (!retailPrice && productRetail > 0) {
    retailPrice = String(productRetail)
  }

  return {
    ...line,
    productId: product.id,
    costPrice: cost,
    retailPrice,
    markupPct,
    qty: line.qty || '1',
    bulkPricing: (product.bulkPricing || []).map(t => ({ minQty: String(t.minQty), price: String(t.price) })),
  }
}

function ReceiptLineSummary({
  line,
  idx,
  product,
  onActivate,
  onRemove,
  cardRef,
}: {
  line: ReceiptDraftLine
  idx: number
  product: Product
  onActivate: () => void
  onRemove: () => void
  cardRef: (el: HTMLDivElement | null) => void
}) {
  const lineCost = linePurchaseSum(line)
  const lineRetail = (Number(line.qty) || 0) * (Number(line.retailPrice) || 0)
  const qty = Number(line.qty) || 0
  const packInfo = parsePackUnit(product.unit)
  const inputUnitLabel = packInputUnitLabel(packInfo)
  const real = packRealWorld(qty, packInfo)
  const qtyText = real ? `${formatQty(qty)} ${inputUnitLabel} = ${formatQty(real.value)} ${real.label}` : `${formatQty(qty)} ${inputUnitLabel}`

  return (
    <div
      ref={cardRef}
      onClick={onActivate}
      style={{
        padding: '10px 14px',
        borderRadius: 12,
        border: '1px solid var(--border)',
        background: 'var(--card2)',
        marginBottom: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        cursor: 'pointer',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--muted)', minWidth: 20 }}>{idx + 1}</span>
      <span style={{ fontSize: 22, flexShrink: 0 }}>{product.e || '📦'}</span>
      <div style={{ flex: '1 1 160px', minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{product.name}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
          {qtyText}{line.expiryDate && <> · срок {line.expiryDate}</>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>Сумма закуп</div>
          <div style={{ fontWeight: 800, fontSize: 13 }}>{fmtMoney(lineCost)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>Сумма продажи</div>
          <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--green)' }}>{lineRetail > 0 ? fmtMoney(lineRetail) : '—'}</div>
        </div>
      </div>
      <button type="button" className="k-btn k-btn-s" style={{ padding: '5px 10px', fontSize: 12, flexShrink: 0 }} onClick={e => { e.stopPropagation(); onActivate() }}>✎</button>
      <button type="button" className="k-btn k-btn-s" style={{ padding: '5px 10px', flexShrink: 0 }} onClick={e => { e.stopPropagation(); onRemove() }}>✕</button>
    </div>
  )
}

function ReceiptLineCard({
  line,
  idx,
  product,
  canRemove,
  onClear,
  onRemove,
  onDone,
  onQty,
  onPurchaseTotal,
  onCost,
  onMarkup,
  onRetail,
  onExpiry,
  onBulkPricing,
  onQuickMarkup,
  cardRef,
  qtyRef,
}: {
  line: ReceiptDraftLine
  idx: number
  product: Product
  canRemove: boolean
  onClear: () => void
  onRemove: () => void
  onDone: () => void
  onQty: (v: string) => void
  onPurchaseTotal: (v: string) => void
  onCost: (v: string) => void
  onMarkup: (v: string) => void
  onRetail: (v: string) => void
  onExpiry: (v: string) => void
  onBulkPricing: (tiers: BulkPricingRow[]) => void
  onQuickMarkup: (pct: number) => void
  cardRef: (el: HTMLDivElement | null) => void
  qtyRef: (el: HTMLInputElement | null) => void
}) {
  const lineCost = linePurchaseSum(line)
  const lineRetail = (Number(line.qty) || 0) * (Number(line.retailPrice) || 0)
  const unit = product.unit || 'шт'
  const packInfo = parsePackUnit(product.unit)
  const inputUnitLabel = packInputUnitLabel(packInfo)
  const qtyNum = Number(line.qty) || 0
  const realWorld = qtyNum > 0 ? packRealWorld(qtyNum, packInfo) : null
  const costHint = Number(line.qty) > 0 && Number(line.purchaseTotal) > 0 && Number(line.costPrice) > 0
    ? `${formatQty(qtyNum)} ${inputUnitLabel} за ${Number(line.purchaseTotal).toFixed(2)} сом = ${Number(line.costPrice).toFixed(2)} сом/${inputUnitLabel}`
    : null

  return (
    <div
      ref={cardRef}
      style={{
        padding: 14,
        borderRadius: 12,
        border: '1px solid var(--green)',
        background: 'rgba(31,215,96,.06)',
        marginBottom: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 900, color: 'var(--muted)', minWidth: 22, paddingTop: 4 }}>{idx + 1}</span>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 28 }}>{product.e || '📦'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 16 }}>{product.name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {product.art} · на складе {product.stock ?? 0} {product.unit || 'шт'}
            </div>
          </div>
          <button type="button" className="k-btn k-btn-s" style={{ fontSize: 11 }} onClick={onClear}>Сменить</button>
        </div>
        {canRemove && (
          <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px' }} onClick={onRemove}>✕</button>
        )}
      </div>

      <div className="k-grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
        <div className="k-field" style={{ marginBottom: 0 }}>
          <label>Кол-во ({inputUnitLabel})</label>
          <input ref={qtyRef} className="k-inp" type="text" inputMode="decimal" value={line.qty} onChange={e => onQty(sanitizeDecimalInput(e.target.value))} />
          {realWorld && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>= {formatQty(realWorld.value)} {realWorld.label}</div>
          )}
        </div>
        <div className="k-field" style={{ marginBottom: 0 }}>
          <label>Общая сумма закуп</label>
          <input
            className="k-inp"
            type="text"
            inputMode="decimal"
            value={line.purchaseTotal}
            onChange={e => onPurchaseTotal(sanitizeDecimalInput(e.target.value))}
            placeholder={qtyNum > 0 && Number(line.costPrice) > 0 ? String(roundMoney(qtyNum * Number(line.costPrice))) : '230'}
          />
        </div>
        <div className="k-field" style={{ marginBottom: 0 }}>
          <label>За {unit} (себест.)</label>
          <input className="k-inp" type="text" inputMode="decimal" value={line.costPrice} onChange={e => onCost(sanitizeDecimalInput(e.target.value))} />
        </div>
        <div className="k-field" style={{ marginBottom: 0 }}>
          <label>Наценка %</label>
          <input className="k-inp" type="text" inputMode="decimal" value={line.markupPct} onChange={e => onMarkup(sanitizeDecimalInput(e.target.value))} placeholder="30" />
        </div>
        <div className="k-field" style={{ marginBottom: 0 }}>
          <label>Розница (сом)</label>
          <input className="k-inp" type="text" inputMode="decimal" value={line.retailPrice} onChange={e => onRetail(sanitizeDecimalInput(e.target.value))} />
        </div>
        <div className="k-field" style={{ marginBottom: 0 }}>
          <label>Срок годности</label>
          <input className="k-inp" type="date" value={line.expiryDate} onChange={e => onExpiry(e.target.value)} />
        </div>
      </div>

      {costHint && (
        <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 8, fontWeight: 700 }}>↳ {costHint}</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>Быстрая наценка:</span>
        {QUICK_MARKUPS.map(p => (
          <button
            key={p}
            type="button"
            onClick={() => onQuickMarkup(p)}
            style={{
              border: `1px solid ${line.markupPct === String(p) ? 'var(--green)' : 'var(--border)'}`,
              background: line.markupPct === String(p) ? 'var(--green-d)' : 'var(--card)',
              color: line.markupPct === String(p) ? 'var(--green)' : 'var(--muted)',
              borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer',
            }}
          >
            {p}%
          </button>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        <BulkPricingFields
          tiers={line.bulkPricing}
          onChange={onBulkPricing}
          sellType={product.sellType || 'piece'}
        />
      </div>

      {(lineCost > 0 || lineRetail > 0) && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span>Закуп: <b style={{ color: 'var(--text)' }}>{fmtMoney(lineCost)}</b></span>
          <span>Продажа: <b style={{ color: 'var(--green)' }}>{fmtMoney(lineRetail)}</b></span>
          {lineCost > 0 && lineRetail > 0 && (
            <span>Наценка: <b style={{ color: 'var(--green)' }}>+{markupFromRetail(lineCost / (Number(line.qty) || 1), lineRetail / (Number(line.qty) || 1)).toFixed(1)}%</b></span>
          )}
        </div>
      )}

      <button
        type="button"
        className="k-btn k-btn-g"
        style={{ marginTop: 14, width: '100%' }}
        disabled={!(Number(line.qty) > 0)}
        onClick={onDone}
      >
        ✓ Готово — добавить в приход
      </button>
    </div>
  )
}

export default function WarehouseReceiptsPanel({
  receipts,
  suppliers,
  products,
  onRefresh,
}: {
  receipts: StockReceipt[]
  suppliers: PosSupplier[]
  products: Product[]
  onRefresh: () => Promise<void>
}) {
  const fetchProducts = useProducts(s => s.fetchProducts)
  const hydrated = useRef(false)
  const scrollRestored = useRef(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const [draft, setDraft] = useState<ReceiptDraft>(() => defaultReceiptDraft())
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [newProductOpen, setNewProductOpen] = useState(false)
  const [newProductName, setNewProductName] = useState('')
  const [newProductLineKey, setNewProductLineKey] = useState<string | null>(null)
  const [newSupplierOpen, setNewSupplierOpen] = useState(false)
  const [newSupplierName, setNewSupplierName] = useState('')
  const [editingSupplier, setEditingSupplier] = useState<PosSupplier | null>(null)
  const [labelReceipt, setLabelReceipt] = useState<StockReceipt | null>(null)

  const { open, supplierId, paidNow, lines, activeLineKey } = draft

  useEffect(() => {
    if (hydrated.current) return
    hydrated.current = true
    setDraft(loadReceiptDraft())
  }, [])

  useEffect(() => {
    if (!hydrated.current) return
    saveReceiptDraft(draft)
  }, [draft])

  useEffect(() => {
    if (!open || !hydrated.current || scrollRestored.current) return
    scrollRestored.current = true
    requestAnimationFrame(() => {
      const body = bodyRef.current
      if (!body) return
      if (draft.scrollTop > 0) body.scrollTop = draft.scrollTop
      if (draft.activeLineKey && lineRefs.current[draft.activeLineKey]) {
        lineRefs.current[draft.activeLineKey]?.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
      }
    })
  }, [open, draft.scrollTop, draft.activeLineKey])

  useEffect(() => {
    if (!open) scrollRestored.current = false
  }, [open])

  useEffect(() => {
    if (!open || !hydrated.current) return
    setDraft(prev => {
      if (prev.lines.some(l => !l.productId)) return prev
      return { ...prev, lines: [...prev.lines, emptyReceiptLine()] }
    })
  }, [open])

  const setDraftPatch = useCallback((patch: Partial<ReceiptDraft>) => {
    setDraft(prev => ({ ...prev, ...patch }))
  }, [])

  function resetForm() {
    clearReceiptDraft()
    setDraft(defaultReceiptDraft())
    setEditingId(null)
    setMsg('')
  }

  function openForm() {
    setEditingId(null)
    setDraft(prev => ({ ...prev, open: true }))
    setMsg('')
  }

  function openEditForm(receipt: StockReceipt) {
    setEditingId(receipt.id)
    setDraft(receiptToDraft(receipt))
    setMsg('')
    scrollRestored.current = false
  }

  function setActiveLine(key: string | null) {
    setDraft(prev => ({ ...prev, activeLineKey: key }))
  }

  function onBodyScroll() {
    const top = bodyRef.current?.scrollTop ?? 0
    setDraft(prev => (prev.scrollTop === top ? prev : { ...prev, scrollTop: top }))
  }

  function ensureTrailingEmptyLine(updatedLines: ReceiptDraftLine[]) {
    const last = updatedLines[updatedLines.length - 1]
    if (last?.productId) return [...updatedLines, emptyReceiptLine()]
    return updatedLines
  }

  function closeForm() {
    if (saving) return
    if (editingId) {
      setDraft(prev => ({ ...prev, open: false }))
      setEditingId(null)
      return
    }
    if (lines.some(l => l.productId || l.qty || l.costPrice) && !confirm('Закрыть приход? Черновик сохранится в браузере.')) return
    setDraft(prev => ({ ...prev, open: false }))
  }

  function updateLine(key: string, patch: Partial<ReceiptDraftLine>) {
    setDraft(prev => ({
      ...prev,
      lines: prev.lines.map(l => (l.key === key ? { ...l, ...patch } : l)),
    }))
  }

  /** Пересчёт наценки/розницы от себестоимости. Также пересчитывает «Общую сумму закуп» —
   *  используется только когда пользователь редактирует именно себестоимость за единицу. */
  function applyCostWithMarkup(line: ReceiptDraftLine, costPrice: string): ReceiptDraftLine {
    const cost = Number(costPrice) || 0
    const markup = Number(line.markupPct)
    let next: ReceiptDraftLine = { ...line, costPrice }
    const qty = Number(line.qty) || 0
    if (qty > 0 && cost > 0) {
      next.purchaseTotal = String(roundMoney(qty * cost))
    }
    if (cost > 0 && line.markupPct !== '') {
      next.retailPrice = String(retailFromMarkup(cost, markup))
    } else if (cost > 0 && line.retailPrice !== '') {
      next.markupPct = String(markupFromRetail(cost, Number(line.retailPrice) || 0))
    }
    return next
  }

  /** То же самое, но НЕ трогает «Общую сумму закуп» — она уже введена пользователем
   *  (или его количество) и является первичным источником, из которого выводится себестоимость. */
  function applyCostKeepingTotal(line: ReceiptDraftLine, costPrice: string): ReceiptDraftLine {
    const cost = Number(costPrice) || 0
    const markup = Number(line.markupPct)
    const next: ReceiptDraftLine = { ...line, costPrice }
    if (cost > 0 && line.markupPct !== '') {
      next.retailPrice = String(retailFromMarkup(cost, markup))
    } else if (cost > 0 && line.retailPrice !== '') {
      next.markupPct = String(markupFromRetail(cost, Number(line.retailPrice) || 0))
    }
    return next
  }

  function setLineQty(key: string, qty: string) {
    setDraft(prev => ({
      ...prev,
      lines: prev.lines.map(l => {
        if (l.key !== key) return l
        const next = { ...l, qty }
        const q = Number(qty) || 0
        const purchaseTotal = Number(l.purchaseTotal) || 0
        // Пересчитываем себестоимость из уже введённой общей суммы закупа — но не наоборот:
        // поле «Общая сумма закуп» не должно само меняться, иначе введённую сумму не удержать.
        if (q > 0 && purchaseTotal > 0) {
          const cost = costFromPurchaseTotal(q, purchaseTotal)
          return applyCostKeepingTotal(next, String(cost))
        }
        return next
      }),
    }))
  }

  function setLinePurchaseTotal(key: string, purchaseTotal: string) {
    setDraft(prev => ({
      ...prev,
      lines: prev.lines.map(l => {
        if (l.key !== key) return l
        const qty = Number(l.qty) || 0
        const total = Number(purchaseTotal) || 0
        if (qty > 0 && total > 0) {
          const cost = costFromPurchaseTotal(qty, total)
          return applyCostKeepingTotal({ ...l, purchaseTotal }, String(cost))
        }
        return { ...l, purchaseTotal }
      }),
    }))
  }

  function setLineCost(key: string, costPrice: string) {
    setDraft(prev => ({
      ...prev,
      lines: prev.lines.map(l => (l.key === key ? applyCostWithMarkup(l, costPrice) : l)),
    }))
  }

  function setLineMarkup(key: string, markupPct: string) {
    setDraft(prev => ({
      ...prev,
      lines: prev.lines.map(l => {
        if (l.key !== key) return l
        const cost = Number(l.costPrice) || 0
        if (cost > 0 && markupPct !== '') {
          return { ...l, markupPct, retailPrice: String(retailFromMarkup(cost, Number(markupPct) || 0)) }
        }
        return { ...l, markupPct }
      }),
    }))
  }

  function setLineRetail(key: string, retailPrice: string) {
    setDraft(prev => ({
      ...prev,
      lines: prev.lines.map(l => {
        if (l.key !== key) return l
        const cost = Number(l.costPrice) || 0
        const retail = Number(retailPrice) || 0
        if (cost > 0 && retailPrice !== '') {
          return { ...l, retailPrice, markupPct: String(markupFromRetail(cost, retail)) }
        }
        return { ...l, retailPrice }
      }),
    }))
  }

  function selectProduct(key: string, product: Product | null) {
    if (!product) {
      updateLine(key, { productId: null, qty: '', purchaseTotal: '', costPrice: '', retailPrice: '', markupPct: '', bulkPricing: [] })
      setActiveLine(key)
      return
    }
    setDraft(prev => {
      const updated = prev.lines.map(l => (l.key === key ? fillLineFromProduct(l, product) : l))
      return {
        ...prev,
        activeLineKey: key,
        lines: ensureTrailingEmptyLine(updated),
      }
    })
    requestAnimationFrame(() => {
      qtyRefs.current[key]?.focus()
      qtyRefs.current[key]?.select()
    })
  }

  function openNewProduct(key: string, name: string) {
    setNewProductLineKey(key)
    setNewProductName(name)
    setNewProductOpen(true)
  }

  function onProductCreated(product: Product) {
    if (newProductLineKey) selectProduct(newProductLineKey, product)
    setNewProductOpen(false)
    setNewProductLineKey(null)
  }

  function onSupplierCreated(supplier: PosSupplier) {
    setDraftPatch({ supplierId: supplier.id })
    setNewSupplierOpen(false)
    setEditingSupplier(null)
    void onRefresh()
  }

  const totals = useMemo(() => {
    let costTotal = 0
    let retailTotal = 0
    let count = 0
    for (const l of lines) {
      if (!l.productId) continue
      const qty = Number(l.qty) || 0
      if (qty <= 0) continue
      count++
      costTotal += linePurchaseSum(l)
      retailTotal += qty * (Number(l.retailPrice) || 0)
    }
    const markup = costTotal > 0 ? ((retailTotal - costTotal) / costTotal) * 100 : 0
    return { costTotal, retailTotal, markup, count, withProduct: lines.filter(l => l.productId).length }
  }, [lines])

  async function submit() {
    if (!USE_API) return
    const items = lines
      .filter(l => l.productId && Number(l.qty) > 0)
      .map(l => ({
        productId: l.productId!,
        qty: Number(l.qty),
        costPrice: Number(l.costPrice) || 0,
        retailPrice: Number(l.retailPrice) || undefined,
        bulkPricing: serializeBulkPricing(l.bulkPricing),
        expiryDate: l.expiryDate || null,
      }))
    if (!items.length) {
      setMsg('Добавьте товар и укажите количество')
      return
    }
    setSaving(true)
    setMsg('')
    try {
      const payload = {
        supplierId: supplierId || undefined,
        paidNow: Number(paidNow) || 0,
        items,
      }
      if (editingId) {
        await api.updateStockReceipt(editingId, payload)
        await Promise.all([onRefresh(), fetchProducts()])
        resetForm()
      } else {
        const created = await api.createStockReceipt(payload)
        await Promise.all([onRefresh(), fetchProducts()])
        resetForm()
        // После нового прихода — сразу выбор этикеток
        setLabelReceipt(created)
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  async function removeReceipt(id: string) {
    if (!USE_API) return
    const receipt = receipts.find(r => r.id === id)
    if (!receipt) return
    if (!confirm(`Удалить приход от ${fmtDateTime(receipt.createdAtIso)}?\n\nТовар будет списан со склада, долг поставщику скорректируется.`)) return
    setDeletingId(id)
    try {
      await api.deleteStockReceipt(id)
      if (editingId === id) resetForm()
      if (expanded === id) setExpanded(null)
      await Promise.all([onRefresh(), fetchProducts()])
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось удалить приход')
    } finally {
      setDeletingId(null)
    }
  }

  const editingReceipt = editingId ? receipts.find(r => r.id === editingId) || null : null

  const hasDraft = !editingId && lines.some(l => l.productId || l.qty || l.costPrice)
  const filledLines = lines.filter(l => l.productId)

  const filteredReceipts = useMemo(() => {
    if (!dateFrom && !dateTo) return receipts
    return receipts.filter(r => matchesDateRange(r.createdAtIso, dateFrom, dateTo))
  }, [receipts, dateFrom, dateTo])

  function receiptRetailTotal(r: StockReceipt) {
    return r.items.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.retailPrice) || 0), 0)
  }

  const listTotals = useMemo(() => {
    let costTotal = 0
    let retailTotal = 0
    let paidTotal = 0
    let debtTotal = 0
    for (const r of filteredReceipts) {
      costTotal += Number(r.totalCost) || 0
      retailTotal += receiptRetailTotal(r)
      paidTotal += Number(r.paidNow) || 0
      debtTotal += Number(r.debtAdded) || 0
    }
    const markup = costTotal > 0 ? ((retailTotal - costTotal) / costTotal) * 100 : 0
    return { costTotal, retailTotal, paidTotal, debtTotal, markup }
  }, [filteredReceipts])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <WarehousePeriodFilter
          from={dateFrom}
          to={dateTo}
          onFromChange={setDateFrom}
          onToChange={setDateTo}
          onClear={() => { setDateFrom(''); setDateTo('') }}
        />
        {(dateFrom || dateTo) && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            Показано: <b style={{ color: 'var(--text)' }}>{filteredReceipts.length}</b> из {receipts.length}
          </span>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
          {hasDraft && !open && (
            <span style={{ fontSize: 12, color: 'var(--gold)', alignSelf: 'center' }}>● Черновик сохранён</span>
          )}
          <button type="button" className="k-btn k-btn-g" disabled={!USE_API} onClick={openForm}>
            + Новый приход
          </button>
        </div>
      </div>

      {!!filteredReceipts.length && (
        <div className="k-kpis" style={{ marginBottom: 12 }}>
          <div className="k-kpi k-statcard">
            <div className="kl">Приходов</div>
            <div className="kv">{filteredReceipts.length}</div>
          </div>
          <div className="k-kpi k-statcard">
            <div className="kl">Сумма закуп</div>
            <div className="kv">{fmtMoney(listTotals.costTotal)}</div>
          </div>
          <div className="k-kpi k-statcard">
            <div className="kl">Сумма продажи</div>
            <div className="kv" style={{ color: 'var(--green)' }}>{fmtMoney(listTotals.retailTotal)}</div>
          </div>
          <div className="k-kpi k-statcard">
            <div className="kl">Наценка</div>
            <div className="kv" style={{ color: listTotals.markup >= 0 ? 'var(--green)' : 'var(--muted)' }}>
              {listTotals.costTotal > 0 ? `${listTotals.markup >= 0 ? '+' : ''}${listTotals.markup.toFixed(1)}%` : '—'}
            </div>
          </div>
          <div className="k-kpi k-statcard">
            <div className="kl">Долг поставщикам</div>
            <div className="kv" style={{ color: listTotals.debtTotal > 0 ? 'var(--gold)' : 'var(--muted)' }}>
              {listTotals.debtTotal > 0 ? fmtMoney(listTotals.debtTotal) : '—'}
            </div>
          </div>
        </div>
      )}

      {!filteredReceipts.length ? (
        <div className="k-empty">{receipts.length ? 'За выбранный период приходов нет' : 'Приходов пока нет'}</div>
      ) : (
        <div className="k-card k-tbl-scroll">
          <table className="k-tbl">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Поставщик</th>
                <th className="num">Позиций</th>
                <th className="num">Сумма закуп</th>
                <th className="num">Сумма продажи</th>
                <th className="num">Оплачено</th>
                <th className="num">Долг</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredReceipts.map(r => (
                <Fragment key={r.id}>
                  <tr>
                    <td>{fmtDateTime(r.createdAtIso)}</td>
                    <td>{r.supplierName || '—'}</td>
                    <td className="num">{r.items.length}</td>
                    <td className="num">{fmtMoney(r.totalCost)}</td>
                    <td className="num" style={{ color: 'var(--green)' }}>{fmtMoney(receiptRetailTotal(r))}</td>
                    <td className="num">{fmtMoney(r.paidNow)}</td>
                    <td className="num" style={{ color: r.debtAdded > 0 ? 'var(--gold)' : 'var(--muted)' }}>
                      {r.debtAdded > 0 ? fmtMoney(r.debtAdded) : '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="k-btn k-btn-s"
                          style={{ padding: '4px 10px' }}
                          title="Печать этикеток"
                          onClick={() => setLabelReceipt(r)}
                        >
                          🖨️
                        </button>
                        <button type="button" className="k-btn k-btn-s" style={{ padding: '4px 10px' }} disabled={!USE_API} onClick={() => openEditForm(r)} title="Редактировать">✎</button>
                        <button
                          type="button"
                          className="k-btn k-btn-s"
                          style={{ padding: '4px 10px', color: 'var(--red)' }}
                          disabled={!USE_API || deletingId === r.id}
                          onClick={() => void removeReceipt(r.id)}
                          title="Удалить"
                        >
                          {deletingId === r.id ? '…' : '🗑'}
                        </button>
                        <button type="button" className="k-btn k-btn-s" style={{ padding: '4px 10px' }} onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                          {expanded === r.id ? '▲' : '▼'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr>
                      <td colSpan={8} style={{ background: 'var(--card2)', padding: 0 }}>
                        <table className="k-tbl" style={{ margin: 0 }}>
                          <thead>
                            <tr>
                              <th>Товар</th>
                              <th className="num">Кол-во</th>
                              <th className="num">Закуп/ед.</th>
                              <th className="num">Розница/ед.</th>
                              <th className="num">Сумма закуп</th>
                              <th className="num">Сумма продажи</th>
                              <th>Срок</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.items.map((it, i) => {
                              const qty = Number(it.qty) || 0
                              const itemCostTotal = qty * (Number(it.costPrice) || 0)
                              const itemRetailTotal = it.retailPrice != null ? qty * Number(it.retailPrice) : 0
                              return (
                                <tr key={i}>
                                  <td>{it.productName}</td>
                                  <td className="num">{it.qty}</td>
                                  <td className="num">{fmtMoney(it.costPrice)}</td>
                                  <td className="num">{it.retailPrice != null ? fmtMoney(it.retailPrice) : '—'}</td>
                                  <td className="num">{fmtMoney(itemCostTotal)}</td>
                                  <td className="num" style={{ color: 'var(--green)' }}>{it.retailPrice != null ? fmtMoney(itemRetailTotal) : '—'}</td>
                                  <td>{it.expiryDate || '—'}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="k-modal-bg k-receipt-modal-bg" onClick={closeForm}>
          <div
            className="k-modal k-receipt-modal"
            onClick={e => e.stopPropagation()}
            style={{ display: 'flex', flexDirection: 'column' }}
          >
            <div className="k-modal-h" style={{ flexShrink: 0 }}>
              <div>
                <b>{editingId ? '✎ Редактирование прихода' : '📥 Новый приход'}</b>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginTop: 2 }}>
                  {editingId ? 'Измените данные и сохраните — остатки пересчитаются' : 'Выберите товар → поля заполнятся сами → укажите количество'}
                </div>
              </div>
              <button type="button" onClick={closeForm}>✕</button>
            </div>

            {editingReceipt && receiptHasConsumption(editingReceipt) && (
              <div style={{ flexShrink: 0, padding: '10px 16px', borderBottom: '1px solid var(--border)', background: '#2a2414', color: 'var(--gold)', fontSize: 12, fontWeight: 700 }}>
                ⚠ Часть товара из этого прихода уже списана. При сохранении остатки будут пересчитаны.
              </div>
            )}

            <div style={{ flexShrink: 0, padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--card2)' }}>
              <div className="k-grid2" style={{ marginBottom: 0 }}>
                <div className="k-field" style={{ marginBottom: 0 }}>
                  <label>Поставщик</label>
                  <WarehouseSupplierSelect
                    suppliers={suppliers}
                    value={supplierId}
                    onChange={id => setDraftPatch({ supplierId: id })}
                    onCreateNew={name => { setNewSupplierName(name); setEditingSupplier(null); setNewSupplierOpen(true) }}
                    onEdit={s => { setEditingSupplier(s); setNewSupplierOpen(true) }}
                  />
                </div>
                <div className="k-field" style={{ marginBottom: 0 }}>
                  <label>Оплачено сейчас (сом)</label>
                  <input className="k-inp" type="text" inputMode="decimal" value={paidNow} onChange={e => setDraftPatch({ paidNow: sanitizeDecimalInput(e.target.value) })} />
                </div>
              </div>
            </div>

            <div className="k-receipt-summary" style={{
              flexShrink: 0,
              padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--panel)',
            }}>
              <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>Товаров</div><div style={{ fontWeight: 900, fontSize: 18 }}>{totals.withProduct}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>Сумма закуп</div><div style={{ fontWeight: 900, fontSize: 18 }}>{fmtMoney(totals.costTotal)}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>Сумма продажи</div><div style={{ fontWeight: 900, fontSize: 18, color: 'var(--green)' }}>{fmtMoney(totals.retailTotal)}</div></div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Наценка</div>
                <div style={{ fontWeight: 900, fontSize: 18, color: totals.markup >= 0 ? 'var(--green)' : 'var(--muted)' }}>
                  {totals.costTotal > 0 ? `${totals.markup >= 0 ? '+' : ''}${totals.markup.toFixed(1)}%` : '—'}
                </div>
              </div>
            </div>

            <div ref={bodyRef} className="k-modal-b" onScroll={onBodyScroll} style={{ flex: 1, overflow: 'auto', padding: '12px 16px', minHeight: 0 }}>
              {filledLines.map((line, idx) => {
                const product = products.find(p => p.id === line.productId) || null
                if (!product) return null
                const isActive = activeLineKey === line.key
                if (!isActive) {
                  return (
                    <ReceiptLineSummary
                      key={line.key}
                      line={line}
                      idx={idx}
                      product={product}
                      onActivate={() => setActiveLine(line.key)}
                      onRemove={() => setDraft(prev => ({
                        ...prev,
                        lines: prev.lines.filter(l => l.key !== line.key),
                        activeLineKey: prev.activeLineKey === line.key ? null : prev.activeLineKey,
                      }))}
                      cardRef={el => { lineRefs.current[line.key] = el }}
                    />
                  )
                }
                return (
                  <ReceiptLineCard
                    key={line.key}
                    line={line}
                    idx={idx}
                    product={product}
                    canRemove={filledLines.length > 0}
                    onClear={() => selectProduct(line.key, null)}
                    onRemove={() => setDraft(prev => ({
                      ...prev,
                      lines: prev.lines.filter(l => l.key !== line.key),
                      activeLineKey: prev.activeLineKey === line.key ? null : prev.activeLineKey,
                    }))}
                    onDone={() => setActiveLine(null)}
                    onQty={v => setLineQty(line.key, v)}
                    onPurchaseTotal={v => setLinePurchaseTotal(line.key, v)}
                    onCost={v => setLineCost(line.key, v)}
                    onMarkup={v => setLineMarkup(line.key, v)}
                    onRetail={v => setLineRetail(line.key, v)}
                    onExpiry={v => updateLine(line.key, { expiryDate: v })}
                    onBulkPricing={tiers => updateLine(line.key, { bulkPricing: tiers })}
                    onQuickMarkup={p => setLineMarkup(line.key, String(p))}
                    cardRef={el => { lineRefs.current[line.key] = el }}
                    qtyRef={el => { qtyRefs.current[line.key] = el }}
                  />
                )
              })}

              {(() => {
                const pending = [...lines].reverse().find(l => !l.productId)!
                const pendingIdx = lines.filter(l => l.productId).length
                return (
                  <div
                    ref={el => { if (pending) lineRefs.current[pending.key] = el }}
                    style={{
                      padding: 16,
                      borderRadius: 12,
                      border: '2px dashed var(--green)',
                      background: 'rgba(31,215,96,.04)',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 900, color: 'var(--green)', marginBottom: 10 }}>
                      {filledLines.length ? `+ Добавить товар ${pendingIdx + 1}` : '1. Найдите или создайте товар'}
                    </div>
                    <WarehouseProductSelect
                      products={products}
                      value={null}
                      onChange={p => { if (p) selectProduct(pending.key, p) }}
                      onCreateNew={name => openNewProduct(pending.key, name)}
                      placeholder="Начните вводить название, артикул или штрихкод…"
                    />
                    <button type="button" className="k-btn k-btn-s" style={{ marginTop: 10, fontSize: 12 }} onClick={() => openNewProduct(pending.key, '')}>
                      + Создать новый товар
                    </button>
                  </div>
                )
              })()}

              {msg && <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>{msg}</div>}
            </div>

            <div style={{ flexShrink: 0, padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--panel)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="k-btn k-btn-g" style={{ flex: 1, minWidth: 180 }} disabled={saving} onClick={() => void submit()}>
                {saving ? 'Сохранение…' : editingId
                  ? `Сохранить изменения${totals.costTotal > 0 ? ` · ${fmtMoney(totals.costTotal)}` : ''}`
                  : `Провести приход${totals.costTotal > 0 ? ` · ${fmtMoney(totals.costTotal)}` : ''}`}
              </button>
              <button type="button" className="k-btn k-btn-s" disabled={saving} onClick={() => { if (confirm(editingId ? 'Отменить редактирование?' : 'Очистить черновик?')) resetForm() }}>{editingId ? 'Отмена' : 'Очистить'}</button>
              {editingId && (
                <button
                  type="button"
                  className="k-btn k-btn-s"
                  style={{ color: 'var(--red)' }}
                  disabled={saving || deletingId === editingId}
                  onClick={() => void removeReceipt(editingId)}
                >
                  {deletingId === editingId ? 'Удаление…' : 'Удалить'}
                </button>
              )}
              <button type="button" className="k-btn k-btn-s" disabled={saving} onClick={closeForm}>Закрыть</button>
            </div>
          </div>
        </div>
      )}

      <WarehouseNewProductModal
        open={newProductOpen}
        initialName={newProductName}
        onClose={() => setNewProductOpen(false)}
        onCreated={onProductCreated}
      />

      <WarehouseNewSupplierModal
        open={newSupplierOpen}
        initialName={newSupplierName}
        editingSupplier={editingSupplier}
        onClose={() => { setNewSupplierOpen(false); setEditingSupplier(null) }}
        onCreated={onSupplierCreated}
      />

      <ReceiptLabelPrintModal
        open={!!labelReceipt}
        receipt={labelReceipt}
        products={products}
        onClose={() => setLabelReceipt(null)}
      />
    </div>
  )
}
