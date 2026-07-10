'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import { useProducts } from '@/lib/store'
import type { PosSupplier, Product, StockReceipt } from '@/lib/types'
import WarehouseNewProductModal from './WarehouseNewProductModal'
import WarehouseProductSelect from './WarehouseProductSelect'
import {
  clearReceiptDraft,
  defaultMarkupPct,
  defaultReceiptDraft,
  emptyReceiptLine,
  loadReceiptDraft,
  markupFromRetail,
  retailFromMarkup,
  saveReceiptDraft,
  type ReceiptDraft,
  type ReceiptDraftLine,
} from './receiptDraftStorage'
import { fmtDateTime, fmtMoney } from './warehouseShared'

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

  return { ...line, productId: product.id, costPrice: cost, retailPrice, markupPct }
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
  const lineRefs = useRef<Record<string, HTMLTableRowElement | null>>({})
  const [draft, setDraft] = useState<ReceiptDraft>(() => defaultReceiptDraft())
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [newProductOpen, setNewProductOpen] = useState(false)
  const [newProductName, setNewProductName] = useState('')
  const [newProductLineKey, setNewProductLineKey] = useState<string | null>(null)

  const { open, supplierId, paidNow, lines, activeLineKey } = draft

  useEffect(() => {
    if (hydrated.current) return
    hydrated.current = true
    const saved = loadReceiptDraft()
    setDraft(saved)
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

  function addLine() {
    const line = emptyReceiptLine()
    setDraft(prev => ({
      ...prev,
      lines: [...prev.lines, line],
      activeLineKey: line.key,
    }))
    requestAnimationFrame(() => {
      lineRefs.current[line.key]?.scrollIntoView({ block: 'center' })
    })
  }

  function openForm() {
    setDraft(prev => ({ ...prev, open: true }))
    setMsg('')
  }

  function applyQuickMarkup(key: string, pct: number) {
    setLineMarkup(key, String(pct))
    setActiveLine(key)
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

  function setLineCost(key: string, costPrice: string) {
    setDraft(prev => ({
      ...prev,
      lines: prev.lines.map(l => {
        if (l.key !== key) return l
        const cost = Number(costPrice) || 0
        const markup = Number(l.markupPct)
        if (cost > 0 && l.markupPct !== '') {
          return { ...l, costPrice, retailPrice: String(retailFromMarkup(cost, markup)) }
        }
        if (cost > 0 && l.retailPrice !== '') {
          return { ...l, costPrice, markupPct: String(markupFromRetail(cost, Number(l.retailPrice) || 0)) }
        }
        return { ...l, costPrice }
      }),
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
    setActiveLine(key)
    if (!product) {
      updateLine(key, { productId: null })
      return
    }
    setDraft(prev => ({
      ...prev,
      activeLineKey: key,
      lines: prev.lines.map(l => (l.key === key ? fillLineFromProduct(l, product) : l)),
    }))
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
      if (!l.productId || !(Number(l.qty) > 0)) continue
      count++
      const qty = Number(l.qty) || 0
      costTotal += qty * (Number(l.costPrice) || 0)
      retailTotal += qty * (Number(l.retailPrice) || 0)
    }
    const markup = costTotal > 0 ? ((retailTotal - costTotal) / costTotal) * 100 : 0
    return { costTotal, retailTotal, markup, count }
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
        expiryDate: l.expiryDate || null,
      }))
    if (!items.length) {
      setMsg('Добавьте хотя бы один товар с количеством')
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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
        {hasDraft && !open && (
          <span style={{ fontSize: 12, color: 'var(--gold)', alignSelf: 'center' }}>● Черновик сохранён</span>
        )}
        <button type="button" className="k-btn k-btn-g" disabled={!USE_API} onClick={openForm}>
          + Новый приход
        </button>
      </div>

      {!receipts.length ? (
        <div className="k-empty">Приходов пока нет</div>
      ) : (
        <div className="k-card" style={{ overflow: 'hidden' }}>
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
              {receipts.map(r => (
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
            style={{
              width: 'min(98vw, 1320px)',
              maxWidth: '98vw',
              height: '96vh',
              maxHeight: '96vh',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div className="k-modal-h" style={{ flexShrink: 0 }}>
              <div>
                <b>📥 Новый приход</b>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginTop: 2 }}>
                  Черновик сохраняется — после обновления страницы всё останется на месте
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

            {totals.count > 0 && (
              <div style={{
                flexShrink: 0, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
                padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--panel)',
              }}>
                <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>Позиций</div><div style={{ fontWeight: 900, fontSize: 18 }}>{totals.count}</div></div>
                <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>Сумма закуп</div><div style={{ fontWeight: 900, fontSize: 18 }}>{fmtMoney(totals.costTotal)}</div></div>
                <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>Сумма продажи</div><div style={{ fontWeight: 900, fontSize: 18, color: 'var(--green)' }}>{fmtMoney(totals.retailTotal)}</div></div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>Наценка</div>
                  <div style={{ fontWeight: 900, fontSize: 18, color: totals.markup >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {totals.markup >= 0 ? '+' : ''}{totals.markup.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>маржа {fmtMoney(totals.retailTotal - totals.costTotal)}</div>
                </div>
              </div>
            )}

            <div
              ref={bodyRef}
              className="k-modal-b"
              onScroll={onBodyScroll}
              style={{ flex: 1, overflow: 'auto', padding: '12px 16px', minHeight: 0 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--green)' }}>Товары · {lines.length}</div>
                <button type="button" className="k-btn k-btn-s" onClick={addLine}>+ Строка</button>
              </div>

              <div className="k-card" style={{ overflow: 'auto' }}>
                <table className="k-tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>#</th>
                      <th>Товар</th>
                      <th className="num" style={{ width: 80 }}>Кол-во</th>
                      <th className="num" style={{ width: 90 }}>Закуп</th>
                      <th className="num" style={{ width: 80 }}>Наценка</th>
                      <th className="num" style={{ width: 90 }}>Розница</th>
                      <th style={{ width: 130 }}>Срок</th>
                      <th style={{ width: 100 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, idx) => {
                      const product = products.find(p => p.id === line.productId) || null
                      const active = activeLineKey === line.key
                      const lineCost = (Number(line.qty) || 0) * (Number(line.costPrice) || 0)
                      const lineRetail = (Number(line.qty) || 0) * (Number(line.retailPrice) || 0)
                      return (
                        <tr
                          key={line.key}
                          ref={el => { lineRefs.current[line.key] = el }}
                          onClick={() => setActiveLine(line.key)}
                          style={{
                            background: active ? 'rgba(31,215,96,.08)' : undefined,
                            outline: active ? '1px solid var(--green)' : undefined,
                          }}
                        >
                          <td style={{ color: 'var(--muted)', fontWeight: 800 }}>{idx + 1}</td>
                          <td>
                            <WarehouseProductSelect
                              products={products}
                              value={line.productId}
                              onChange={p => selectProduct(line.key, p)}
                              onCreateNew={name => openNewProduct(line.key, name)}
                            />
                            {product && (
                              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                                {product.art} · остаток {product.stock ?? 0} {product.unit || 'шт'}
                                {lineCost > 0 && <> · {fmtMoney(lineCost)} → {fmtMoney(lineRetail)}</>}
                              </div>
                            )}
                          </td>
                          <td className="num">
                            <input className="k-inp" type="number" min="0" step="any" value={line.qty} onChange={e => updateLine(line.key, { qty: e.target.value })} onFocus={() => setActiveLine(line.key)} />
                          </td>
                          <td className="num">
                            <input className="k-inp" type="number" min="0" step="0.01" value={line.costPrice} onChange={e => setLineCost(line.key, e.target.value)} onFocus={() => setActiveLine(line.key)} />
                          </td>
                          <td className="num">
                            <input className="k-inp" type="number" step="0.1" value={line.markupPct} onChange={e => setLineMarkup(line.key, e.target.value)} placeholder="30" onFocus={() => setActiveLine(line.key)} />
                            <div style={{ display: 'flex', gap: 2, marginTop: 4, flexWrap: 'wrap' }}>
                              {[20, 30, 40, 50].map(p => (
                                <button key={p} type="button" onClick={() => applyQuickMarkup(line.key, p)} style={{ border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--muted)', borderRadius: 4, padding: '1px 5px', fontSize: 9, cursor: 'pointer' }}>{p}%</button>
                              ))}
                            </div>
                          </td>
                          <td className="num">
                            <input className="k-inp" type="number" min="0" step="0.01" value={line.retailPrice} onChange={e => setLineRetail(line.key, e.target.value)} onFocus={() => setActiveLine(line.key)} />
                          </td>
                          <td>
                            <input className="k-inp" type="date" value={line.expiryDate} onChange={e => updateLine(line.key, { expiryDate: e.target.value })} onFocus={() => setActiveLine(line.key)} />
                          </td>
                          <td>
                            <button type="button" className="k-btn k-btn-s" style={{ padding: '4px 8px', fontSize: 11, marginBottom: 4, width: '100%' }} onClick={() => openNewProduct(line.key, '')}>+ Товар</button>
                            <button type="button" className="k-btn k-btn-s" style={{ padding: '4px 8px', fontSize: 11, width: '100%' }} disabled={lines.length <= 1} onClick={() => setDraft(prev => ({ ...prev, lines: prev.lines.filter(l => l.key !== line.key), activeLineKey: prev.activeLineKey === line.key ? null : prev.activeLineKey }))}>✕</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {msg && <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, background: '#2a1420', color: 'var(--red)', border: '1px solid #5a2030' }}>{msg}</div>}
            </div>

            <div style={{ flexShrink: 0, padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--panel)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="k-btn k-btn-g" style={{ flex: 1, minWidth: 180 }} disabled={saving} onClick={() => void submit()}>
                {saving ? 'Сохранение…' : `Провести приход${totals.count ? ` · ${fmtMoney(totals.costTotal)}` : ''}`}
              </button>
              <button type="button" className="k-btn k-btn-s" onClick={addLine}>+ Строка</button>
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
