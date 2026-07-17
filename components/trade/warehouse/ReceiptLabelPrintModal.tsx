'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Product, StockReceipt } from '@/lib/types'
import { formatQty } from './warehouseShared'
import {
  buildReceiptLabelRows,
  printReceiptLabelRows,
  type ReceiptLabelRow,
} from './receiptLabelPrint'
import { loadLabelDesign } from '@/components/trade/products/labelShared'

export default function ReceiptLabelPrintModal({
  open,
  receipt,
  products,
  onClose,
}: {
  open: boolean
  receipt: StockReceipt | null
  products: Product[]
  onClose: () => void
}) {
  const [rows, setRows] = useState<ReceiptLabelRow[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const productsById = useMemo(() => {
    const m = new Map<number, Product>()
    for (const p of products) m.set(p.id, p)
    return m
  }, [products])

  useEffect(() => {
    if (!open || !receipt) {
      setRows([])
      setMsg('')
      return
    }
    setRows(buildReceiptLabelRows(receipt, productsById))
    setMsg('')
  }, [open, receipt, productsById])

  if (!open || !receipt) return null

  const selectedCount = rows.filter(r => r.selected).length
  const totalCopies = rows.reduce((s, r) => s + (r.selected ? Math.max(0, r.copies) : 0), 0)

  function toggleAll(on: boolean) {
    setRows(prev => prev.map(r => ({ ...r, selected: on })))
  }

  function patchRow(key: string, patch: Partial<ReceiptLabelRow>) {
    setRows(prev => prev.map(r => (r.key === key ? { ...r, ...patch } : r)))
  }

  async function printSelected() {
    setBusy(true)
    setMsg('')
    try {
      const { printed } = await printReceiptLabelRows(rows, { design: loadLabelDesign() })
      setMsg(`Напечатано: ${printed}`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка печати')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="k-modal-bg" style={{ zIndex: 1500 }} onClick={onClose}>
      <div
        className="k-modal"
        onClick={e => e.stopPropagation()}
        style={{ width: 'min(720px, 96vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="k-modal-h" style={{ flexShrink: 0 }}>
          <div>
            <b>🖨️ Печать этикеток с прихода</b>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, fontWeight: 600 }}>
              {receipt.supplierName || 'Поставщик не указан'} · {receipt.items.length} поз.
              · макет из «Этикетки»
            </div>
          </div>
          <button type="button" onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
          <button type="button" className="k-btn k-btn-s" onClick={() => toggleAll(true)}>Выбрать все</button>
          <button type="button" className="k-btn k-btn-s" onClick={() => toggleAll(false)}>Снять все</button>
          <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
            Выбрано: <b style={{ color: 'var(--text)' }}>{selectedCount}</b> · этикеток: <b style={{ color: 'var(--text)' }}>{totalCopies}</b>
          </span>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
          {!rows.length ? (
            <div className="k-empty" style={{ padding: 24 }}>Нет товаров для печати (проверьте каталог)</div>
          ) : (
            rows.map(row => (
              <label
                key={row.key}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto',
                  gap: 10,
                  alignItems: 'center',
                  padding: '10px 12px',
                  marginBottom: 8,
                  borderRadius: 10,
                  border: `1px solid ${row.selected ? 'var(--green)' : 'var(--border)'}`,
                  background: row.selected ? 'rgba(31,215,96,.06)' : 'var(--card2)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={row.selected}
                  onChange={e => patchRow(row.key, { selected: e.target.checked })}
                  style={{ accentColor: 'var(--green)', width: 18, height: 18 }}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.product.e || '📦'} {row.product.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    {row.edit.size || '—'} · {(Number(row.edit.price) || 0).toFixed(2)} сом
                    {row.edit.plu ? ` · PLU ${row.edit.plu}` : ''}
                    {row.edit.barcode ? ` · ${row.edit.barcode}` : ''}
                    {' · '}приход {formatQty(row.item.qty)}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>шт</span>
                  <input
                    className="k-inp"
                    type="number"
                    min={1}
                    max={99}
                    value={row.copies}
                    disabled={!row.selected}
                    onChange={e => patchRow(row.key, { copies: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })}
                    style={{ width: 64, textAlign: 'center', padding: '6px 8px' }}
                  />
                </div>
              </label>
            ))
          )}
        </div>

        {msg && (
          <div style={{ padding: '8px 16px', fontSize: 13, color: msg.startsWith('Напечатано') ? 'var(--green)' : 'var(--gold)', flexShrink: 0 }}>
            {msg}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, padding: 16, borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button
            type="button"
            className="k-btn k-btn-g"
            style={{ flex: 1, minWidth: 160 }}
            disabled={busy || !selectedCount}
            onClick={() => void printSelected()}
          >
            {busy ? 'Печать…' : `🖨️ Печатать (${totalCopies})`}
          </button>
          <button type="button" className="k-btn k-btn-s" disabled={busy} onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}
