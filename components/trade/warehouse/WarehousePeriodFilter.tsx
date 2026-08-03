'use client'

export default function WarehousePeriodFilter({
  from,
  to,
  onFromChange,
  onToChange,
  onClear,
}: {
  from: string
  to: string
  onFromChange: (v: string) => void
  onToChange: (v: string) => void
  onClear?: () => void
}) {
  const active = Boolean(from || to)

  return (
    <div className="k-wh-period" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span className="k-hide-mob" style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap' }}>Период</span>
      <input
        type="date"
        className="k-inp"
        style={{ width: 'auto', minWidth: 132, maxWidth: 160 }}
        value={from}
        onChange={e => onFromChange(e.target.value)}
        title="Дата от"
        aria-label="Дата от"
      />
      <span style={{ color: 'var(--muted)', fontSize: 13 }}>—</span>
      <input
        type="date"
        className="k-inp"
        style={{ width: 'auto', minWidth: 132, maxWidth: 160 }}
        value={to}
        min={from || undefined}
        onChange={e => onToChange(e.target.value)}
        title="Дата до"
        aria-label="Дата до"
      />
      {active && onClear && (
        <button type="button" className="k-btn k-btn-s" style={{ padding: '8px 12px', fontSize: 12 }} onClick={onClear}>
          Сбросить
        </button>
      )}
    </div>
  )
}
