'use client'

function toInputDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function startOfWeek(d: Date) {
  const copy = new Date(d)
  const day = copy.getDay()
  const diff = day === 0 ? -6 : 1 - day
  copy.setDate(copy.getDate() + diff)
  copy.setHours(0, 0, 0, 0)
  return copy
}

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

  function applyPreset(kind: 'day' | 'week' | 'month') {
    const today = new Date()
    const toValue = toInputDate(today)
    if (kind === 'day') {
      onFromChange(toValue)
      onToChange(toValue)
      return
    }
    if (kind === 'week') {
      onFromChange(toInputDate(startOfWeek(today)))
      onToChange(toValue)
      return
    }
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
    onFromChange(toInputDate(monthStart))
    onToChange(toValue)
  }

  return (
    <div className="k-wh-period" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span className="k-hide-mob" style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap' }}>Период</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className="k-btn k-btn-s" style={{ padding: '7px 10px', fontSize: 12 }} onClick={() => applyPreset('day')}>
          День
        </button>
        <button type="button" className="k-btn k-btn-s" style={{ padding: '7px 10px', fontSize: 12 }} onClick={() => applyPreset('week')}>
          Неделя
        </button>
        <button type="button" className="k-btn k-btn-s" style={{ padding: '7px 10px', fontSize: 12 }} onClick={() => applyPreset('month')}>
          Месяц
        </button>
      </div>
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
