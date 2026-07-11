'use client'

import type { SellType } from '@/lib/types'

export type BulkPricingRow = { minQty: string; price: string }

/** Заменяет запятую на точку и убирает всё, что не цифра/точка — number-инпуты в RU-локали ломают ввод. */
function sanitizeDecimal(raw: string): string {
  let v = raw.replace(',', '.').replace(/[^0-9.]/g, '')
  const firstDot = v.indexOf('.')
  if (firstDot !== -1) v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '')
  return v
}

export default function BulkPricingFields({
  tiers,
  onChange,
  sellType,
}: {
  tiers: BulkPricingRow[]
  onChange: (tiers: BulkPricingRow[]) => void
  sellType: SellType
}) {
  const rows = tiers.length ? tiers : []
  const unit = sellType === 'weight' ? 'г' : 'шт'

  function setRow(i: number, patch: Partial<BulkPricingRow>) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  return (
    <div style={{
      padding: '12px 14px', borderRadius: 10, background: 'var(--green-d)',
      border: '1px solid rgba(31,215,96,.25)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 800 }}>📦 Оптовые цены</div>
        <button
          type="button"
          className="k-btn k-btn-g"
          style={{ padding: '4px 10px', fontSize: 11 }}
          onClick={() => onChange([...rows, { minQty: '', price: '' }])}
        >
          + Уровень
        </button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.45 }}>
        При достижении количества цена за {sellType === 'weight' ? 'порцию' : 'шт'} меняется для всей позиции.
        Пример: кекс — от 24 шт по 1.8 сом.
      </div>
      {!rows.length ? (
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          Одна розничная цена. Нажмите «+ Уровень» для опта.
        </div>
      ) : rows.map((row, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>От ({unit})</div>
            <input
              className="k-inp"
              type="text"
              inputMode="decimal"
              value={row.minQty}
              onChange={e => setRow(i, { minQty: sanitizeDecimal(e.target.value) })}
              placeholder={sellType === 'weight' ? '500' : '24'}
            />
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>Цена (сом)</div>
            <input
              className="k-inp"
              type="text"
              inputMode="decimal"
              value={row.price}
              onChange={e => setRow(i, { price: sanitizeDecimal(e.target.value) })}
              placeholder="1.80"
            />
          </div>
          <button
            type="button"
            className="k-btn k-btn-s"
            style={{ alignSelf: 'end', padding: '8px 10px', fontSize: 11, color: 'var(--red)' }}
            onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
