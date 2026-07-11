'use client'

import { useMemo, useState } from 'react'
import type { PosSupplier } from '@/lib/types'

export default function WarehouseSupplierSelect({
  suppliers,
  value,
  onChange,
  onCreateNew,
  placeholder = 'Без поставщика — нажмите, чтобы выбрать или найти',
}: {
  suppliers: PosSupplier[]
  value: string
  onChange: (id: string) => void
  onCreateNew?: (name: string) => void
  placeholder?: string
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const selected = suppliers.find(s => s.id === value) || null

  const options = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return suppliers
    return suppliers.filter(s =>
      s.name.toLowerCase().includes(query)
      || (s.phone || '').toLowerCase().includes(query)
      || (s.category || '').toLowerCase().includes(query),
    )
  }, [suppliers, q])

  const canCreate = !!onCreateNew && q.trim().length >= 2
    && !options.some(s => s.name.toLowerCase() === q.trim().toLowerCase())

  function pick(id: string) {
    onChange(id)
    setQ('')
    setOpen(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="k-inp"
        value={open ? q : (selected ? selected.name : '')}
        placeholder={open ? 'Поиск по названию, телефону, категории…' : placeholder}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
          background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10,
          maxHeight: 260, overflow: 'auto', marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,.4)',
        }}>
          <button
            type="button"
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              border: 'none', borderBottom: '1px solid var(--border)',
              background: !value ? 'var(--card2)' : 'transparent', color: 'var(--muted)',
              padding: '9px 10px', cursor: 'pointer', textAlign: 'left', fontSize: 13, fontWeight: 700,
            }}
            onMouseDown={e => e.preventDefault()}
            onClick={() => pick('')}
          >
            🚫 Без поставщика
          </button>

          {options.map(s => {
            const debt = Number(s.payableAmount) || 0
            return (
              <button
                key={s.id}
                type="button"
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  border: 'none', background: value === s.id ? 'var(--green-d)' : 'transparent', color: 'var(--text)',
                  padding: '8px 10px', cursor: 'pointer', textAlign: 'left', fontSize: 13,
                }}
                onMouseDown={e => e.preventDefault()}
                onClick={() => pick(s.id)}
              >
                <span>🚚</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700 }}>
                    {s.name}
                  </span>
                  {(s.category || s.phone) && (
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[s.category, s.phone].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
                {debt > 0 && (
                  <span style={{ fontSize: 10, color: 'var(--red)', flexShrink: 0, fontWeight: 800, whiteSpace: 'nowrap' }}>долг</span>
                )}
              </button>
            )
          })}

          {!options.length && !canCreate && (
            <div style={{ padding: '10px 10px', fontSize: 12, color: 'var(--muted)' }}>Ничего не найдено</div>
          )}

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
                onCreateNew!(q.trim())
                setQ('')
                setOpen(false)
              }}
            >
              + Добавить поставщика «{q.trim()}»
            </button>
          )}
        </div>
      )}
    </div>
  )
}
