'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

export type PickerProduct = {
  id: number
  name: string
  e?: string
  art?: string
  price: number
}

type Props = {
  products: PickerProduct[]
  value: string
  onChange: (productId: string, product?: PickerProduct) => void
  disabled?: boolean
  placeholder?: string
}

export default function ProductSearchPicker({
  products,
  value,
  onChange,
  disabled,
  placeholder = 'Найти по названию, артикулу или ID…',
}: Props) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  const selected = useMemo(
    () => products.find(p => String(p.id) === String(value)),
    [products, value],
  )

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = !s
      ? products
      : products.filter(p => {
          const hay = `${p.name} ${p.art || ''} ${p.id}`.toLowerCase()
          return hay.includes(s)
        })
    return list.slice(0, 60)
  }, [products, q])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  const pick = (p: PickerProduct) => {
    onChange(String(p.id), p)
    setQ('')
    setOpen(false)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {selected && !open ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setOpen(true)}
          className="ai"
          style={{
            width: '100%',
            textAlign: 'left',
            cursor: disabled ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            opacity: disabled ? 0.65 : 1,
          }}
        >
          <span style={{ fontSize: 22 }}>{selected.e || '📦'}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#EBF5ED' }}>{selected.name}</div>
            <div style={{ fontSize: 11, color: '#8FB897' }}>
              {selected.art || `ID ${selected.id}`} · {selected.price.toFixed(2)} ЅМ
            </div>
          </span>
          {!disabled && <span style={{ fontSize: 11, color: '#3D6645' }}>Изменить</span>}
        </button>
      ) : (
        <input
          className="ai"
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
        />
      )}

      {open && !disabled && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 'calc(100% + 6px)',
            zIndex: 120,
            maxHeight: 280,
            overflowY: 'auto',
            background: '#0C1C0F',
            border: '1px solid #1E3522',
            borderRadius: 12,
            boxShadow: '0 12px 40px rgba(0,0,0,.45)',
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: '14px 12px', fontSize: 12, color: '#8FB897' }}>Ничего не найдено</div>
          ) : filtered.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => pick(p)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                border: 'none',
                borderBottom: '1px solid #162B1A',
                background: String(p.id) === String(value) ? 'rgba(31,215,96,.08)' : 'transparent',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 20 }}>{p.e || '📦'}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#EBF5ED' }}>{p.name}</div>
                <div style={{ fontSize: 10, color: '#8FB897' }}>{p.art || `ID ${p.id}`} · {p.price.toFixed(2)} ЅМ</div>
              </span>
            </button>
          ))}
          {products.length > filtered.length && (
            <div style={{ padding: '8px 12px', fontSize: 10, color: '#3D6645' }}>
              Показано {filtered.length} из {products.length}. Уточните поиск.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
