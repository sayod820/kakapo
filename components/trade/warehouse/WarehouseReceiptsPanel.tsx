'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import { serializeBulkPricing } from '@/lib/productBulkPricing'
import { useProducts } from '@/lib/store'
import type { PosSupplier, Product, StockReceipt } from '@/lib/types'
import BulkPricingFields, { type BulkPricingRow } from '@/components/trade/products/BulkPricingFields'
import WarehouseNewProductModal from './WarehouseNewProductModal'
import WarehouseProductSelect from './WarehouseProductSelect'
import {
  clearReceiptDraft,
  costFromPurchaseTotal,
  defaultMarkupPct,
  defaultReceiptDraft,
  emptyReceiptLine,
  linePurchaseSum,
  loadReceiptDraft,
  markupFromRetail,
  retailFromMarkup,
  roundMoney,
  saveReceiptDraft,
  type ReceiptDraft,
  type ReceiptDraftLine,
} from './receiptDraftStorage'
import { documentProductMatchesSearch } from '@/lib/productBarcodes'
import { fmtDateTime, fmtMoney } from './warehouseShared'

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

function ReceiptLineCard({
  line,
  idx,
  product,
  active,
  canRemove,
  onClear,
  onRemove,
  onActivate,
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
  active: boolean
  canRemove: boolean
  onClear: () => void
  onRemove: () => void
  onActivate: () => void
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
  const costHint = Number(line.qty) > 0 && Number(line.purchaseTotal) > 0 && Number(line.costPrice) > 0
    ? `${line.qty} ${unit} за ${Number(line.purchaseTotal).toFixed(2)} сом = ${Number(line.costPrice).toFixed(2)} сом/${unit}`
    : null

  return (
    <div
      ref={cardRef}
      onClick={onActivate}
      style={{
        padding: 14,
        borderRadius: 12,
        border: `1px solid ${active ? 'var(--green)' : 'var(--border)'}`,
        background: active ? 'rgba(31,215,96,.06)' : 'var(--card2)',
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
          <button type="button" className="k-btn k-btn-s" style={{ fontSize: 11 }} onClick={e => { e.stopPropagation(); onClear() }}>Сменить</button>
        </div>
        {canRemove && (
          <button type="button" className="k-btn k-btn-s" style={{ padding: '6px 10px' }} onClick={e => { e.stopPropagation(); onRemove() }}>✕</button>
        )}
      </div>

      <div className="k-grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
        <div className="k-field" style={{ marginBottom: 0 }}>
          <label>Кол-во ({unit})</label>
          <input ref={qtyRef} className="k-inp" type="number" min="0" step="any" value={line.qty} onChange={e => onQty(e.target.value)} onClick={e => e.stopPropagation()} />
        </div>
        <div className="k-field" style={{ marginBottom: 0 }}>
          <label>Общая сумма закуп</label>
          <input className="k-inp" type="number" min="0" step="0.01" value={line.purchaseTotal} onChange={e => onPurchaseTotal(e.target.value)} onClick={e => e.stopPropagation()} placeholder="230" />
        </div>
        <div className="k-field" style={{ marginBottom: 0 }}>
          <label>За {unit} (себест.)</label>
          <input className="k-inp" type="number" min="0" step="0.01" value={line.costPrice} onChange={e => onCost(e.target.value)} onClick={e => e.stopPropagation()} />
        </div>
        <div className="k-field" style={{ marginBottom: 0 }}>
          <label>Наценка %</label>
          <input className="k-inp" type="number" step="0.1" value={line.markupPct} onChange={e => onMarkup(e.target.value)} onClick={e => e.stopPropagation()} placeholder="30" />
        </div>
        <div className="k-field" style={{ marginBottom: 0 }}>
          <label>Розница (сом)</label>
          <input className="k-inp" type="number" min="0" step="0.01" value={line.retailPrice} onChange={e => onRetail(e.target.value)} onClick={e => e.stopPropagation()} />
        </div>
        <div className="k-field" style={{ marginBottom: 0 }}>
          <label>Срок годности</label>
          <input className="k-inp" type="date" value={line.expiryDate} onChange={e => onExpiry(e.target.value)} onClick={e => e.stopPropagation()} />
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
            onClick={e => { e.stopPropagation(); onQuickMarkup(p) }}
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

      <div onClick={e => e.stopPropagation()} style={{ marginTop: 12 }}>
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
  const [listSearch, setListSearch] = useState('')
  const [newProductOpen, setNewProductOpen] = useState(false)
  const [newProductName, setNewProductName] = useState('')
  const [newProductLineKey, setNewProductLineKey] = useState<string | null>(null)

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
    setMsg('')
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

  function addLine() {
    const line = emptyReceiptLine()
    setDraft(prev => ({
      ...prev,
      lines: [...prev.lines, line],
      activeLineKey: line.key,
    }))
    requestAnimationFrame(() => lineRefs.current[line.key]?.scrollIntoView({ block: 'center' }))
  }

  function openForm() {
    setDraft(prev => ({ ...prev, open: true }))
    setMsg('')
  }

  function closeForm() {
    if (saving) return
    if (lines.some(l => l.productId || l.qty || l.costPrice) && !confirm('Закрыть приход? Черновик сохранится в браузере.')) return
    setDraft(prev => ({ ...prev, open: false }))
  }

  function updateLine(key: string, patch: Partial<ReceiptDraftLine>) {
    setDraft(prev => ({
      ...prev,
      lines: prev.lines.map(l => (l.key === key ? { ...l, ...patch } : l)),
    }))
  }

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

  function setLineQty(key: string, qty: string) {
    setDraft(prev => ({
      ...prev,
      lines: prev.lines.map(l => {
        if (l.key !== key) return l
        let next = { ...l, qty }
        const q = Number(qty) || 0
        const purchaseTotal = Number(l.purchaseTotal) || 0
        if (q > 0 && purchaseTotal > 0) {
          const cost = costFromPurchaseTotal(q, purchaseTotal)
          next = applyCostWithMarkup({ ...next, costPrice: String(cost) }, String(cost))
        } else if (q > 0 && Number(l.costPrice) > 0) {
          next.purchaseTotal = String(roundMoney(q * Number(l.costPrice)))
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
          return applyCostWithMarkup({ ...l, purchaseTotal, costPrice: String(cost) }, String(cost))
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
      await api.createStockReceipt({
        supplierId: supplierId || undefined,
        paidNow: Number(paidNow) || 0,
        items,
      })
      await Promise.all([onRefresh(), fetchProducts()])
      resetForm()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const hasDraft = lines.some(l => l.productId || l.qty || l.costPrice)
  const filledLines = lines.filter(l => l.productId)

  const filteredReceipts = useMemo(() => {
    const q = listSearch.trim()
    if (!q) return receipts
    const ql = q.toLowerCase()
    return receipts.filter(r => {
      if ((r.supplierName || '').toLowerCase().includes(ql)) return true
      return r.items.some(it => documentProductMatchesSearch(it.productId, it.productName, products, q))
    })
  }, [receipts, listSearch, products])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          className="k-inp"
          style={{ flex: '1 1 220px', maxWidth: 360 }}
          placeholder="Поиск: штрихкод, название, артикул, поставщик…"
          value={listSearch}
          onChange={e => setListSearch(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {hasDraft && !open && (
            <span style={{ fontSize: 12, color: 'var(--gold)', alignSelf: 'center' }}>● Черновик сохранён</span>
          )}
          <button type="button" className="k-btn k-btn-g" disabled={!USE_API} onClick={openForm}>
            + Новый приход
          </button>
        </div>
      </div>

      {!filteredReceipts.length ? (
        <div className="k-empty">{receipts.length ? 'Ничего не найдено' : 'Приходов пока нет'}</div>
      ) : (
        <div className="k-card k-tbl-scroll">
          <table className="k-tbl">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Поставщик</th>
                <th className="num">Позиций</th>
                <th className="num">Сумма закуп</th>
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
                    <td className="num">{fmtMoney(r.paidNow)}</td>
                    <td className="num" style={{ color: r.debtAdded > 0 ? 'var(--gold)' : 'var(--muted)' }}>
                      {r.debtAdded > 0 ? fmtMoney(r.debtAdded) : '—'}
                    </td>
                    <td>
                      <button type="button" className="k-btn k-btn-s" style={{ padding: '4px 10px' }} onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                        {expanded === r.id ? '▲' : '▼'}
                      </button>
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr>
                      <td colSpan={7} style={{ background: 'var(--card2)', padding: 0 }}>
                        <table className="k-tbl" style={{ margin: 0 }}>
                          <thead>
                            <tr>
                              <th>Товар</th>
                              <th className="num">Кол-во</th>
                              <th className="num">Закуп</th>
                              <th className="num">Розница</th>
                              <th>Срок</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.items.map((it, i) => (
                              <tr key={i}>
                                <td>{it.productName}</td>
                                <td className="num">{it.qty}</td>
                                <td className="num">{fmtMoney(it.costPrice)}</td>
                                <td className="num">{it.retailPrice != null ? fmtMoney(it.retailPrice) : '—'}</td>
                                <td>{it.expiryDate || '—'}</td>
                              </tr>
                            ))}
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
                <b>📥 Новый приход</b>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginTop: 2 }}>
                  Выберите товар → поля заполнятся сами → укажите количество
                </div>
              </div>
              <button type="button" onClick={closeForm}>✕</button>
            </div>

            <div style={{ flexShrink: 0, padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--card2)' }}>
              <div className="k-grid2" style={{ marginBottom: 0 }}>
                <div className="k-field" style={{ marginBottom: 0 }}>
                  <label>Поставщик</label>
                  <select className="k-sel" value={supplierId} onChange={e => setDraftPatch({ supplierId: e.target.value })}>
                    <option value="">Без поставщика</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="k-field" style={{ marginBottom: 0 }}>
                  <label>Оплачено сейчас (сом)</label>
                  <input className="k-inp" type="number" min="0" step="0.01" value={paidNow} onChange={e => setDraftPatch({ paidNow: e.target.value })} />
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
                return (
                  <ReceiptLineCard
                    key={line.key}
                    line={line}
                    idx={idx}
                    product={product}
                    active={activeLineKey === line.key}
                    canRemove={filledLines.length > 0}
                    onClear={() => selectProduct(line.key, null)}
                    onRemove={() => setDraft(prev => ({
                      ...prev,
                      lines: prev.lines.filter(l => l.key !== line.key),
                      activeLineKey: prev.activeLineKey === line.key ? null : prev.activeLineKey,
                    }))}
                    onActivate={() => setActiveLine(line.key)}
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
                {saving ? 'Сохранение…' : `Провести приход${totals.costTotal > 0 ? ` · ${fmtMoney(totals.costTotal)}` : ''}`}
              </button>
              <button type="button" className="k-btn k-btn-s" disabled={saving} onClick={() => { if (confirm('Очистить черновик?')) resetForm() }}>Очистить</button>
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
    </div>
  )
}
