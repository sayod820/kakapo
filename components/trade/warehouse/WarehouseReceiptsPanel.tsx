'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { USE_API } from '@/lib/config'
import { serializeBulkPricing } from '@/lib/productBulkPricing'
import {
  createStockReceiptSafe,
  deleteStockReceiptSafe,
  updateStockReceiptSafe,
} from '@/lib/offlineWarehouseOps'
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
  productUnitLabel,
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
  onDuplicate,
  onRemove,
  cardRef,
  active,
}: {
  line: ReceiptDraftLine
  idx: number
  product: Product
  onActivate: () => void
  onDuplicate: () => void
  onRemove: () => void
  cardRef: (el: HTMLDivElement | null) => void
  active?: boolean
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
      className={`k-rcpt-row${active ? ' is-active' : ''}`}
      onClick={onActivate}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate() } }}
    >
      <span className="idx">{idx + 1}</span>
      <div className="k-rcpt-name">
        <b>{product.e || '📦'} {product.name}</b>
        <span>{qtyText}{line.expiryDate ? ` · срок ${line.expiryDate}` : ''}</span>
      </div>
      <div className="num">{formatQty(qty)}</div>
      <div className="num">{fmtMoney(lineCost)}</div>
      <div className="num" style={{ color: 'var(--green)' }}>{lineRetail > 0 ? fmtMoney(lineRetail) : '—'}</div>
      <div className="k-rcpt-acts" onClick={e => e.stopPropagation()}>
        <button type="button" className="k-btn k-btn-s" title="Дублировать" onClick={onDuplicate}>⧉</button>
        <button type="button" className="k-btn k-btn-s" title="Изменить" onClick={onActivate}>✎</button>
        <button type="button" className="k-btn k-btn-s" title="Удалить" onClick={onRemove}>✕</button>
      </div>
    </div>
  )
}

function ReceiptLineCard({
  line,
  idx,
  product,
  canRemove,
  onClear,
  onDuplicate,
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
  onDuplicate: () => void
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
    <div ref={cardRef} className="k-rcpt-edit">
      <div className="k-rcpt-edit-h">
        <span style={{ fontSize: 11, fontWeight: 900, color: 'var(--muted)' }}>#{idx + 1}</span>
        <span style={{ fontSize: 20 }}>{product.e || '📦'}</span>
        <b>{product.name}</b>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          {product.art} · склад {formatQty(Number(product.stock) || 0)} {productUnitLabel(product.unit)}
        </span>
        <button type="button" className="k-btn k-btn-s" style={{ padding: '4px 8px', fontSize: 11, minHeight: 0 }} onClick={onDuplicate} title="Дублировать">⧉</button>
        <button type="button" className="k-btn k-btn-s" style={{ padding: '4px 8px', fontSize: 11, minHeight: 0 }} onClick={onClear}>Сменить</button>
        {canRemove && (
          <button type="button" className="k-btn k-btn-s" style={{ padding: '4px 8px', fontSize: 11, minHeight: 0 }} onClick={onRemove}>✕</button>
        )}
      </div>

      <div className="k-rcpt-edit-grid">
        <div className="k-field">
          <label>Кол-во ({inputUnitLabel})</label>
          <input ref={qtyRef} className="k-inp" type="text" inputMode="decimal" value={line.qty} onChange={e => onQty(sanitizeDecimalInput(e.target.value))} />
          {realWorld && (
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>= {formatQty(realWorld.value)} {realWorld.label}</div>
          )}
        </div>
        <div className="k-field">
          <label>Сумма закупки</label>
          <input
            className="k-inp"
            type="text"
            inputMode="decimal"
            value={line.purchaseTotal}
            onChange={e => onPurchaseTotal(sanitizeDecimalInput(e.target.value))}
            placeholder={qtyNum > 0 && Number(line.costPrice) > 0 ? String(roundMoney(qtyNum * Number(line.costPrice))) : '0'}
          />
        </div>
        <div className="k-field">
          <label>Себест. за {unit}</label>
          <input className="k-inp" type="text" inputMode="decimal" value={line.costPrice} onChange={e => onCost(sanitizeDecimalInput(e.target.value))} />
        </div>
        <div className="k-field">
          <label>Наценка %</label>
          <input className="k-inp" type="text" inputMode="decimal" value={line.markupPct} onChange={e => onMarkup(sanitizeDecimalInput(e.target.value))} placeholder="30" />
          <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
            {QUICK_MARKUPS.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => onQuickMarkup(p)}
                style={{
                  border: `1px solid ${line.markupPct === String(p) ? 'var(--green)' : 'var(--border)'}`,
                  background: line.markupPct === String(p) ? 'var(--green-d)' : 'var(--card)',
                  color: line.markupPct === String(p) ? 'var(--green)' : 'var(--muted)',
                  borderRadius: 6, padding: '2px 7px', fontSize: 11, fontWeight: 800, cursor: 'pointer',
                }}
              >
                {p}%
              </button>
            ))}
          </div>
        </div>
        <div className="k-field">
          <label>Розница (сом)</label>
          <input className="k-inp" type="text" inputMode="decimal" value={line.retailPrice} onChange={e => onRetail(sanitizeDecimalInput(e.target.value))} />
        </div>
        <div className="k-field">
          <label>Срок годности</label>
          <input className="k-inp" type="date" value={line.expiryDate} onChange={e => onExpiry(e.target.value)} />
        </div>
      </div>

      {costHint && (
        <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 8, fontWeight: 700 }}>↳ {costHint}</div>
      )}

      <div style={{ marginTop: 8 }}>
        <BulkPricingFields
          tiers={line.bulkPricing}
          onChange={onBulkPricing}
          sellType={product.sellType || 'piece'}
        />
      </div>

      <div className="k-rcpt-edit-foot">
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          Закуп <b style={{ color: 'var(--text)' }}>{fmtMoney(lineCost)}</b>
          {' · '}Продажа <b style={{ color: 'var(--green)' }}>{fmtMoney(lineRetail)}</b>
          {lineCost > 0 && lineRetail > 0 && (
            <> · <b style={{ color: 'var(--green)' }}>+{markupFromRetail(lineCost / (Number(line.qty) || 1), lineRetail / (Number(line.qty) || 1)).toFixed(1)}%</b></>
          )}
        </span>
        <button
          type="button"
          className="k-btn k-btn-g"
          disabled={!(Number(line.qty) > 0)}
          onClick={onDone}
        >
          ✓ Готово
        </button>
      </div>
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
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [newProductOpen, setNewProductOpen] = useState(false)
  const [newProductName, setNewProductName] = useState('')
  const [newProductBarcode, setNewProductBarcode] = useState('')
  const [newProductLineKey, setNewProductLineKey] = useState<string | null>(null)
  const [duplicateFrom, setDuplicateFrom] = useState<Product | null>(null)
  const [newSupplierOpen, setNewSupplierOpen] = useState(false)
  const [newSupplierName, setNewSupplierName] = useState('')
  const [editingSupplier, setEditingSupplier] = useState<PosSupplier | null>(null)
  const [labelReceipt, setLabelReceipt] = useState<StockReceipt | null>(null)
  const [listQ, setListQ] = useState('')

  const { open, supplierId, paidNow, lines, activeLineKey, editingId } = draft

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
      else if (draft.activeLineKey) scrollLineIntoBody(draft.activeLineKey)
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

  /** Крутим только список внутри модалки, не всю страницу */
  function scrollLineIntoBody(key: string) {
    const body = bodyRef.current
    const el = lineRefs.current[key]
    if (!body || !el) return
    const br = body.getBoundingClientRect()
    const er = el.getBoundingClientRect()
    const pad = 12
    if (er.bottom > br.bottom - pad) body.scrollTop += er.bottom - br.bottom + pad + 8
    else if (er.top < br.top + pad) body.scrollTop += er.top - br.top - pad
  }

  const setDraftPatch = useCallback((patch: Partial<ReceiptDraft>) => {
    setDraft(prev => ({ ...prev, ...patch }))
  }, [])

  function resetForm() {
    clearReceiptDraft()
    setDraft(defaultReceiptDraft())
    setListQ('')
    setMsg('')
  }

  /** Новый приход. Черновик нового сохраняем; черновик правки не превращаем в второй приход. */
  function openForm() {
    setDraft(prev => {
      if (prev.editingId) {
        clearReceiptDraft()
        return { ...defaultReceiptDraft(), open: true, editingId: null }
      }
      return { ...prev, open: true, editingId: null }
    })
    setListQ('')
    setMsg('')
    scrollRestored.current = false
  }

  function openEditForm(receipt: StockReceipt) {
    const next = receiptToDraft(receipt)
    setDraft(next)
    saveReceiptDraft(next)
    setListQ('')
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
      // Отмена правки — не оставляем строки как «новый черновик»
      resetForm()
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
      scrollLineIntoBody(key)
      qtyRefs.current[key]?.focus()
      qtyRefs.current[key]?.select()
      // После добавления чуть ниже виден блок «+ Добавить товар»
      requestAnimationFrame(() => {
        const pending = bodyRef.current?.querySelector<HTMLElement>('[data-receipt-pending="1"]')
        if (!pending || !bodyRef.current) return
        const br = bodyRef.current.getBoundingClientRect()
        const er = pending.getBoundingClientRect()
        if (er.bottom > br.bottom - 8) {
          bodyRef.current.scrollTop += er.bottom - br.bottom + 20
        }
      })
    })
  }

  function openNewProduct(key: string, name: string, barcode = '') {
    setNewProductLineKey(key)
    setNewProductName(name)
    setNewProductBarcode(barcode)
    setDuplicateFrom(null)
    setNewProductOpen(true)
  }

  function openDuplicateProduct(source: Product) {
    const pending = [...lines].reverse().find(l => !l.productId)
    if (!pending) return
    setNewProductLineKey(pending.key)
    setNewProductName(source.name)
    setDuplicateFrom(source)
    setNewProductOpen(true)
  }

  function onProductCreated(product: Product) {
    if (newProductLineKey) selectProduct(newProductLineKey, product)
    setNewProductOpen(false)
    setNewProductLineKey(null)
    setDuplicateFrom(null)
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
      const editId = draft.editingId || editingId
      if (editId) {
        const res = await updateStockReceiptSafe(editId, payload)
        resetForm()
        if (!res.offline) void Promise.all([onRefresh(), fetchProducts()])
        else setMsg('Сохранено локально · отправится при связи')
      } else {
        const res = await createStockReceiptSafe(payload)
        resetForm()
        setLabelReceipt(res.data)
        if (!res.offline) void Promise.all([onRefresh(), fetchProducts()])
        else setMsg('Приход сохранён · отправится при связи')
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
      const res = await deleteStockReceiptSafe(id)
      if (editingId === id) resetForm()
      if (expanded === id) setExpanded(null)
      if (!res.offline) void Promise.all([onRefresh(), fetchProducts()])
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось удалить приход')
    } finally {
      setDeletingId(null)
    }
  }

  const editingReceipt = editingId ? receipts.find(r => r.id === editingId) || null : null

  const hasDraft = !editingId && lines.some(l => l.productId || l.qty || l.costPrice)
  const filledLines = useMemo(() => lines.filter(l => l.productId), [lines])
  const listQuery = listQ.trim().toLowerCase()
  const visibleFilledLines = useMemo(() => {
    if (!listQuery) return filledLines
    return filledLines.filter(line => {
      const product = products.find(p => p.id === line.productId)
      if (!product) return false
      const unit = productUnitLabel(product.unit).toLowerCase()
      if (listQuery === 'г' || listQuery === 'гр' || listQuery === 'грамм') {
        return /г|гр|\bg\b/i.test(unit)
      }
      if (listQuery === 'шт' || listQuery === 'штук') {
        return /шт|pcs/i.test(unit)
      }
      if (listQuery === 'л' || listQuery === 'литр') {
        return /(^|\s)л\b|литр|\bl\b/i.test(unit)
      }
      const hay = [product.name, product.art, product.barcode, product.plu, product.unit, unit]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(listQuery) || String(product.id) === listQuery
    })
  }, [filledLines, listQuery, products])

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
      if (r.stockAdjustment) continue
      costTotal += Number(r.totalCost) || 0
      retailTotal += receiptRetailTotal(r)
      paidTotal += Number(r.paidNow) || 0
      debtTotal += Number(r.debtAdded) || 0
    }
    const markup = costTotal > 0 ? ((retailTotal - costTotal) / costTotal) * 100 : 0
    return { costTotal, retailTotal, paidTotal, debtTotal, markup }
  }, [filteredReceipts])

  return (
    <div className="k-wh-receipts">
      <div className="k-wh-receipts-head">
        <div className="k-wh-filters-row">
          <WarehousePeriodFilter
            from={dateFrom}
            to={dateTo}
            onFromChange={setDateFrom}
            onToChange={setDateTo}
            onClear={() => { setDateFrom(''); setDateTo('') }}
          />
          {(dateFrom || dateTo) && (
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              <b style={{ color: 'var(--text)' }}>{filteredReceipts.length}</b> / {receipts.length}
            </span>
          )}
          <div className="k-wh-cta" style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {hasDraft && !open && (
              <span className="k-hide-mob" style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 700 }}>● Черновик</span>
            )}
            <button type="button" className="k-btn k-btn-g" disabled={!USE_API} onClick={openForm}>
              + Новый приход
            </button>
          </div>
        </div>
        <div className="k-wh-cta-spacer" aria-hidden />

        {!!filteredReceipts.length && (
          <div className="k-wh-meta">
            <span>
              <b>{filteredReceipts.length}</b> приходов
            </span>
            <div className="k-wh-money" style={{ marginLeft: 'auto' }}>
              <span>Закуп <b>{fmtMoney(listTotals.costTotal)}</b></span>
              <span>Продажа <b style={{ color: 'var(--green)' }}>{fmtMoney(listTotals.retailTotal)}</b></span>
              <span>
                Наценка{' '}
                <b style={{ color: listTotals.markup >= 0 ? 'var(--green)' : 'var(--muted)' }}>
                  {listTotals.costTotal > 0 ? `${listTotals.markup >= 0 ? '+' : ''}${listTotals.markup.toFixed(1)}%` : '—'}
                </b>
              </span>
              <span>
                Долг{' '}
                <b style={{ color: listTotals.debtTotal > 0 ? 'var(--gold)' : 'var(--muted)' }}>
                  {listTotals.debtTotal > 0 ? fmtMoney(listTotals.debtTotal) : '—'}
                </b>
              </span>
            </div>
          </div>
        )}
      </div>

      {!filteredReceipts.length ? (
        <div className="k-empty">{receipts.length ? 'За выбранный период приходов нет' : 'Приходов пока нет'}</div>
      ) : (
        <>
          <div className="k-wh-cards">
            {filteredReceipts.map(r => {
              const isOpen = expanded === r.id
              const retail = receiptRetailTotal(r)
              return (
                <div key={r.id} className="k-wh-card" style={{ padding: 10, gap: 8 }}>
                  <div className="k-wh-card-top">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{fmtDateTime(r.createdAtIso)}</div>
                      <div style={{ fontWeight: 900, fontSize: 14, marginTop: 2 }}>{r.supplierName || 'Без поставщика'}</div>
                    </div>
                  </div>
                  <div className="k-wh-card-meta">
                    <div>
                      <div className="l">Позиций</div>
                      <div className="v">{r.items.length}</div>
                    </div>
                    <div>
                      <div className="l">Закуп</div>
                      <div className="v">{fmtMoney(r.totalCost)}</div>
                    </div>
                    <div>
                      <div className="l">Продажа</div>
                      <div className="v" style={{ color: 'var(--green)' }}>{fmtMoney(retail)}</div>
                    </div>
                  </div>
                  <div className="k-wh-card-meta" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    <div>
                      <div className="l">Оплачено</div>
                      <div className="v">{fmtMoney(r.paidNow)}</div>
                    </div>
                    <div>
                      <div className="l">Долг</div>
                      <div className="v" style={{ color: r.debtAdded > 0 ? 'var(--gold)' : 'var(--muted)' }}>
                        {r.debtAdded > 0 ? fmtMoney(r.debtAdded) : '—'}
                      </div>
                    </div>
                  </div>
                  <div className="k-wh-card-actions" style={{ gridTemplateColumns: '1fr 1fr 1fr auto' }}>
                    <button type="button" className="k-btn k-btn-s" onClick={() => setLabelReceipt(r)}>🖨️</button>
                    <button type="button" className="k-btn k-btn-s" disabled={!USE_API} onClick={() => openEditForm(r)}>✎</button>
                    <button
                      type="button"
                      className="k-btn k-btn-s"
                      style={{ color: 'var(--red)' }}
                      disabled={!USE_API || deletingId === r.id}
                      onClick={() => void removeReceipt(r.id)}
                    >
                      {deletingId === r.id ? '…' : '🗑'}
                    </button>
                    <button type="button" className="k-btn k-btn-s" style={{ minWidth: 48 }} onClick={() => setExpanded(isOpen ? null : r.id)}>
                      {isOpen ? '▲' : '▼'}
                    </button>
                  </div>
                  {isOpen && (
                    <div className="k-wh-card-detail">
                      {r.items.map((it, i) => {
                        const qty = Number(it.qty) || 0
                        const itemCostTotal = qty * (Number(it.costPrice) || 0)
                        const itemRetailTotal = it.retailPrice != null ? qty * Number(it.retailPrice) : 0
                        return (
                          <div
                            key={i}
                            style={{
                              padding: '8px 10px', borderRadius: 8,
                              border: '1px solid var(--border)', background: 'var(--card2)',
                            }}
                          >
                            <div style={{ fontWeight: 800, marginBottom: 4, fontSize: 13 }}>{it.productName}</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11 }}>
                              <span style={{ color: 'var(--muted)' }}>Кол-во: <b style={{ color: 'var(--text)' }}>{it.qty}</b></span>
                              <span style={{ color: 'var(--muted)' }}>Закуп: <b style={{ color: 'var(--text)' }}>{fmtMoney(itemCostTotal)}</b></span>
                              <span style={{ color: 'var(--muted)' }}>Розница: <b style={{ color: 'var(--green)' }}>{it.retailPrice != null ? fmtMoney(itemRetailTotal) : '—'}</b></span>
                              <span style={{ color: 'var(--muted)' }}>Срок: <b style={{ color: 'var(--text)' }}>{it.expiryDate || '—'}</b></span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="k-wh-receipts-body k-wh-desk-tbl">
          <table className="k-tbl">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Поставщик</th>
                <th className="num">Поз.</th>
                <th className="num">Σ закуп</th>
                <th className="num">Σ продажи</th>
                <th className="num">Оплачено</th>
                <th className="num">Долг</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredReceipts.map(r => (
                <Fragment key={r.id}>
                  <tr>
                    <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDateTime(r.createdAtIso)}</td>
                    <td style={{ fontWeight: 700, fontSize: 12 }}>{r.supplierName || '—'}</td>
                    <td className="num">{r.items.length}</td>
                    <td className="num">{fmtMoney(r.totalCost)}</td>
                    <td className="num" style={{ color: 'var(--green)', fontWeight: 700 }}>{fmtMoney(receiptRetailTotal(r))}</td>
                    <td className="num">{fmtMoney(r.paidNow)}</td>
                    <td className="num" style={{ color: r.debtAdded > 0 ? 'var(--gold)' : 'var(--muted)', fontWeight: r.debtAdded > 0 ? 800 : 400 }}>
                      {r.debtAdded > 0 ? fmtMoney(r.debtAdded) : '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 3, justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="k-btn k-btn-s"
                          style={{ padding: '3px 8px', fontSize: 12, minHeight: 0 }}
                          title="Печать этикеток"
                          onClick={() => setLabelReceipt(r)}
                        >
                          🖨️
                        </button>
                        <button type="button" className="k-btn k-btn-s" style={{ padding: '3px 8px', fontSize: 12, minHeight: 0 }} disabled={!USE_API} onClick={() => openEditForm(r)} title="Редактировать">✎</button>
                        <button
                          type="button"
                          className="k-btn k-btn-s"
                          style={{ padding: '3px 8px', fontSize: 12, minHeight: 0, color: 'var(--red)' }}
                          disabled={!USE_API || deletingId === r.id}
                          onClick={() => void removeReceipt(r.id)}
                          title="Удалить"
                        >
                          {deletingId === r.id ? '…' : '🗑'}
                        </button>
                        <button type="button" className="k-btn k-btn-s" style={{ padding: '3px 8px', fontSize: 12, minHeight: 0 }} onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
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
                              <th className="num">Σ закуп</th>
                              <th className="num">Σ продажи</th>
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
                                  <td style={{ fontWeight: 700 }}>{it.productName}</td>
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
        </>
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
                <b>{editingId ? 'Редактирование прихода' : 'Новый приход'}</b>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginTop: 2 }}>
                  {editingId ? 'Изменения пересчитают остатки на складе' : 'Добавьте товары, укажите количество и цены'}
                </div>
              </div>
              <button type="button" onClick={closeForm}>✕</button>
            </div>

            <div className="k-rcpt-top">
              {editingReceipt && receiptHasConsumption(editingReceipt) && (
                <div className="k-rcpt-warn" style={{ margin: 0 }}>
                  ⚠ Часть товара уже списана — при сохранении остатки пересчитаются
                </div>
              )}
              <div className="k-rcpt-top-row">
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
                  <label>Оплачено сейчас</label>
                  <input className="k-inp" type="text" inputMode="decimal" value={paidNow} onChange={e => setDraftPatch({ paidNow: sanitizeDecimalInput(e.target.value) })} />
                </div>
              </div>
              <div className="k-rcpt-totals">
                <div className="k-rcpt-total">
                  <div className="l">Товаров</div>
                  <div className="v">{totals.withProduct}</div>
                </div>
                <div className="k-rcpt-total">
                  <div className="l">Закуп</div>
                  <div className="v">{fmtMoney(totals.costTotal)}</div>
                </div>
                <div className="k-rcpt-total">
                  <div className="l">Продажа</div>
                  <div className="v" style={{ color: 'var(--green)' }}>{fmtMoney(totals.retailTotal)}</div>
                </div>
                <div className="k-rcpt-total">
                  <div className="l">Наценка</div>
                  <div className="v" style={{ color: totals.markup >= 0 ? 'var(--green)' : 'var(--muted)' }}>
                    {totals.costTotal > 0 ? `${totals.markup >= 0 ? '+' : ''}${totals.markup.toFixed(1)}%` : '—'}
                  </div>
                </div>
              </div>
            </div>

            <div
              ref={bodyRef}
              className="k-rcpt-body"
              onScroll={onBodyScroll}
            >
                {filledLines.length > 0 && (
                  <div className="k-rcpt-tools">
                    <input
                      className="k-inp"
                      value={listQ}
                      onChange={e => setListQ(e.target.value)}
                      placeholder="Найти в списке: название, артикул, штрихкод…"
                    />
                    {listQuery && (
                      <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                        {visibleFilledLines.length}/{filledLines.length}
                      </span>
                    )}
                  </div>
                )}

                {filledLines.length === 0 ? (
                  <div className="k-rcpt-empty">Список пуст — добавьте первый товар ниже</div>
                ) : (
                  <div className="k-rcpt-list">
                    <div className="k-rcpt-list-h">
                      <span>#</span>
                      <span>Товар</span>
                      <span className="num" style={{ textAlign: 'right' }}>Кол-во</span>
                      <span className="num" style={{ textAlign: 'right' }}>Закуп</span>
                      <span className="num" style={{ textAlign: 'right' }}>Продажа</span>
                      <span />
                    </div>
                    {visibleFilledLines.map((line) => {
                      const product = products.find(p => p.id === line.productId) || null
                      if (!product) return null
                      const idx = filledLines.findIndex(l => l.key === line.key)
                      const isActive = activeLineKey === line.key
                      return (
                        <Fragment key={line.key}>
                          <ReceiptLineSummary
                            line={line}
                            idx={idx}
                            product={product}
                            active={isActive}
                            onActivate={() => setActiveLine(isActive ? null : line.key)}
                            onDuplicate={() => openDuplicateProduct(product)}
                            onRemove={() => setDraft(prev => ({
                              ...prev,
                              lines: prev.lines.filter(l => l.key !== line.key),
                              activeLineKey: prev.activeLineKey === line.key ? null : prev.activeLineKey,
                            }))}
                            cardRef={el => { lineRefs.current[line.key] = el }}
                          />
                          {isActive && (
                            <ReceiptLineCard
                              line={line}
                              idx={idx}
                              product={product}
                              canRemove={filledLines.length > 0}
                              onClear={() => selectProduct(line.key, null)}
                              onDuplicate={() => openDuplicateProduct(product)}
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
                              cardRef={el => { lineRefs.current[`${line.key}-edit`] = el }}
                              qtyRef={el => { qtyRefs.current[line.key] = el }}
                            />
                          )}
                        </Fragment>
                      )
                    })}
                  </div>
                )}
            </div>

              {(() => {
                const pending = [...lines].reverse().find(l => !l.productId)!
                const pendingIdx = lines.filter(l => l.productId).length
                return (
                  <div
                    className="k-rcpt-add"
                    data-receipt-pending="1"
                    ref={el => { if (pending) lineRefs.current[pending.key] = el }}
                  >
                    <div className="k-rcpt-add-h">
                      {filledLines.length ? `Добавить товар · ${pendingIdx + 1}` : 'Добавить первый товар'}
                    </div>
                    <WarehouseProductSelect
                      products={products}
                      value={null}
                      onChange={p => { if (p) selectProduct(pending.key, p) }}
                      onCreateNew={(name, meta) => openNewProduct(pending.key, name, meta?.barcode || '')}
                      placeholder="Поиск или сканер: название, артикул, штрихкод…"
                    />
                    <button type="button" className="k-btn k-btn-s" style={{ marginTop: 8, fontSize: 12, padding: '6px 10px', minHeight: 0 }} onClick={() => openNewProduct(pending.key, '')}>
                      + Создать новый товар
                    </button>
                  </div>
                )
              })()}

              {msg && (
                <div style={{ margin: '0 14px 12px', padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>
                  {msg}
                </div>
              )}

            <div className="k-receipt-modal-actions">
              <button type="button" className="k-btn k-btn-g k-btn-primary-wide" disabled={saving} onClick={() => void submit()}>
                {saving ? 'Сохранение…' : editingId
                  ? `Сохранить изменения${totals.costTotal > 0 ? ` · ${fmtMoney(totals.costTotal)}` : ''}`
                  : `Провести приход${totals.costTotal > 0 ? ` · ${fmtMoney(totals.costTotal)}` : ''}`}
              </button>
              <div className="k-btn-row">
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
        </div>
      )}

      <WarehouseNewProductModal
        open={newProductOpen}
        initialName={newProductName}
        initialBarcode={newProductBarcode}
        duplicateFrom={duplicateFrom}
        onClose={() => { setNewProductOpen(false); setDuplicateFrom(null); setNewProductBarcode('') }}
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
