'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Product } from '@/lib/types'
import { filterProducts } from './warehouseShared'

export default function WarehouseProductSelect({
  products,
  value,
  onChange,
  onCreateNew,
  placeholder = 'Найти товар…',
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
  const options = useMemo(() => filterProducts(products, q || selected?.name || ''), [products, q, selected?.name])
  const canCreate = onCreateNew && q.trim().length >= 2 && !options.some(p => p.name.toLowerCase() === q.trim().toLowerCase())

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="k-inp"
        value={open ? q : (selected ? `${selected.e || '📦'} ${selected.name}` : q)}
        placeholder={placeholder}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
      />
      {open && (options.length > 0 || canCreate) && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
          background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10,
          maxHeight: 220, overflow: 'auto', marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,.4)',
        }}>
          {options.map(p => (
            <button
              key={p.id}
              type="button"
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                border: 'none', background: 'transparent', color: 'var(--text)',
                padding: '8px 10px', cursor: 'pointer', textAlign: 'left', fontSize: 13,
              }}
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                onChange(p as Product)
                setQ('')
                setOpen(false)
              }}
            >
              <span>{(p as Product).e || '📦'}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{p.art}</span>
            </button>
          ))}
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
