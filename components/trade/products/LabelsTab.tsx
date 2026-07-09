'use client'

import { useMemo, useState } from 'react'
import { money } from './productFormShared'
import { formatPriceLabel, isWeighted } from '@/lib/productWeight'
import { productBarcodeSearchText, productBarcodes } from '@/lib/productBarcodes'
import type { Product } from '@/lib/types'

const LABEL_CSS = `
  @media print {
    body * { visibility: hidden !important; }
    #k-label-print, #k-label-print * { visibility: visible !important; }
    #k-label-print { position: absolute; left: 0; top: 0; width: 100%; }
    .k-label-card { break-inside: avoid; page-break-inside: avoid; }
  }
  .k-label-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
  .k-label-card{background:#fff;color:#111;border:1px dashed #ccc;border-radius:8px;padding:12px 14px;min-height:120px;display:flex;flex-direction:column;justify-content:space-between}
  .k-label-card .brand{font-size:10px;font-weight:800;color:#0a7a3e;letter-spacing:.06em}
  .k-label-card .name{font-size:14px;font-weight:800;line-height:1.25;margin:6px 0}
  .k-label-card .price{font-size:22px;font-weight:900;color:#0a7a3e}
  .k-label-card .meta{font-size:10px;color:#666;margin-top:4px}
  .k-label-card .bar{font-family:monospace;font-size:11px;letter-spacing:2px;margin-top:8px;padding:4px 0;border-top:1px solid #eee}
  .k-label-pick{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;cursor:pointer;border:1px solid var(--border);margin-bottom:6px;background:var(--card2)}
  .k-label-pick input{accent-color:var(--green)}
  .k-label-pick:hover{border-color:var(--green)}
`

export default function LabelsTab({
  products,
  search,
}: {
  products: Product[]
  search: string
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [labelSize, setLabelSize] = useState<'small' | 'medium'>('medium')

  const q = search.trim().toLowerCase()
  const filtered = useMemo(() =>
    products.filter(p => !q || `${p.name} ${p.art} ${productBarcodeSearchText(p)}`.toLowerCase().includes(q)),
  [products, q])

  const chosen = filtered.filter(p => selected.has(p.id))

  function toggle(id: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(filtered.map(p => p.id)))
  }

  function clearAll() {
    setSelected(new Set())
  }

  function printLabels() {
    if (!chosen.length) return
    const style = document.createElement('style')
    style.textContent = LABEL_CSS.replace(/@media print[\s\S]*$/, '')
    document.head.appendChild(style)
    window.print()
    setTimeout(() => style.remove(), 1000)
  }

  return (
    <div>
      <style>{LABEL_CSS}</style>
      <div className="k-page-h" style={{ marginTop: 0 }}>
        <div>
          <h1>🏷️ Этикетки</h1>
          <div className="sub">Ценники и штрихкоды для полки. Выберите товары и нажмите «Печать».</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="k-btn k-btn-s" onClick={selectAll}>Выбрать все</button>
          <button type="button" className="k-btn k-btn-s" onClick={clearAll}>Сбросить</button>
          <button type="button" className="k-btn k-btn-g" disabled={!chosen.length} onClick={printLabels}>
            🖨️ Печать ({chosen.length})
          </button>
        </div>
      </div>

      <div className="k-grid2" style={{ alignItems: 'start' }}>
        <section className="k-card">
          <div className="k-card-h"><b>Выбор товаров</b><span style={{ fontSize: 12, color: 'var(--muted)' }}>{selected.size} выбрано</span></div>
          <div className="k-card-b" style={{ maxHeight: '52vh', overflow: 'auto' }}>
            {filtered.map(p => (
              <label key={p.id} className="k-label-pick">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                <span style={{ fontSize: 18 }}>{p.e || '📦'}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 13 }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.art} · {money(p.price)}</div>
                </span>
              </label>
            ))}
            {!filtered.length && <div className="k-empty">Товары не найдены</div>}
          </div>
        </section>

        <section className="k-card">
          <div className="k-card-h">
            <b>Предпросмотр</b>
            <select className="k-sel" style={{ width: 'auto', minWidth: 120 }} value={labelSize} onChange={e => setLabelSize(e.target.value as 'small' | 'medium')}>
              <option value="medium">Средняя</option>
              <option value="small">Маленькая</option>
            </select>
          </div>
          <div className="k-card-b">
            <div id="k-label-print" className="k-label-grid">
              {(chosen.length ? chosen : filtered.slice(0, 6)).map(p => (
                <div
                  key={p.id}
                  className="k-label-card"
                  style={labelSize === 'small' ? { minHeight: 96, padding: '8px 10px' } : undefined}
                >
                  <div>
                    <div className="brand">KAKAPO</div>
                    <div className="name">{p.name}</div>
                    <div className="meta">{isWeighted(p) ? formatPriceLabel(p) : `${p.unit} · ${p.art}`}</div>
                  </div>
                  <div>
                    <div className="price">{money(p.price)}</div>
                    <div className="bar">{p.plu ? `PLU ${p.plu}` : (productBarcodes(p)[0] || p.art)}</div>
                  </div>
                </div>
              ))}
            </div>
            {!chosen.length && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>
                Показан предпросмотр первых 6 товаров. Отметьте галочками нужные для печати.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
