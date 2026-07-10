'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Product } from '@/lib/types'
import { filterProductsBySearch, pickProductBySearch, productBarcodes } from '@/lib/productBarcodes'

export default function WarehouseProductSelect({
  products,
  value,
  onChange,
  onCreateNew,
  placeholder = 'Поиск: штрихкод, название, артикул…',
}: {
  products: Product[]
  value: number | null
  onChange: (product: Product | null) => void
  onCreateNew?: (query: string) => void
  placeholder?: string
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const selected = products.find(p => p.id === value) || null
  const options = useMemo(
    () => filterProductsBySearch(products, q || selected?.name || '', 30),
    [products, q, selected?.name],
  )
  const canCreate = onCreateNew && q.trim().length >= 2 && !options.some(p => p.name.toLowerCase() === q.trim().toLowerCase())

  useEffect(() => {
    if (!open || !q.trim()) return
    const exact = pickProductBySearch(products, q)
    if (exact && productBarcodes(exact).some(c => c === q.trim())) {
      onChange(exact)
      setQ('')
      setOpen(false)
    }
  }, [q, open, products, onChange])

  function tryPick() {
    const best = pickProductBySearch(products, q)
    if (best) {
      onChange(best)
      setQ('')
      setOpen(false)
      return true
    }
    return false
  }

  function selectProduct(p: Product) {
    onChange(p)
    setQ('')
    setOpen(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="k-inp"
        value={open ? q : (selected ? `${selected.e || '📦'} ${selected.name}` : q)}
        placeholder={placeholder}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            tryPick()
          }
        }}
      />
      {open && (options.length > 0 || canCreate) && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
          background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10,
          maxHeight: 260, overflow: 'auto', marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,.4)',
        }}>
          {options.map(p => {
            const codes = productBarcodes(p)
            return (
              <button
                key={p.id}
                type="button"
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  border: 'none', background: 'transparent', color: 'var(--text)',
                  padding: '8px 10px', cursor: 'pointer', textAlign: 'left', fontSize: 13,
                }}
                onMouseDown={e => e.preventDefault()}
                onClick={() => selectProduct(p)}
              >
                <span>{p.e || '📦'}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700 }}>
                    {p.name}
                  </span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[p.art, codes[0], p.plu ? `PLU ${p.plu}` : ''].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{p.stock ?? 0} шт</span>
              </button>
            )
          })}
          {canCreate && (
            <button
              type="button"
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                border: 'none', borderTop: options.length ? '1px solid var(--border)' : 'none',
                background: 'var(--green-d)', color: 'var(--green)',
                padding: '10px 10px', cursor: 'pointer', textAlign: 'left', fontSize: 13, fontWeight: 800,
              }}
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                onCreateNew(q.trim())
                setOpen(false)
              }}
            >
              + Создать товар «{q.trim()}»
            </button>
          )}
        </div>
      )}
    </div>
  )
}
