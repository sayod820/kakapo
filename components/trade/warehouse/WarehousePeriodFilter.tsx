'use client'

export type WarehousePeriodPreset = 'day' | 'week' | 'month' | null

function toInputDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Сколько мс назад для пресета: день=24ч, неделя=7д, месяц=30д */
export function periodPresetSinceMs(kind: 'day' | 'week' | 'month', now = Date.now()): number {
  if (kind === 'day') return now - 24 * 60 * 60 * 1000
  if (kind === 'week') return now - 7 * 24 * 60 * 60 * 1000
  return now - 30 * 24 * 60 * 60 * 1000
}

export default function WarehousePeriodFilter({
  from,
  to,
  onFromChange,
  onToChange,
  onClear,
  preset = null,
  onPresetChange,
}: {
  from: string
  to: string
  onFromChange: (v: string) => void
  onToChange: (v: string) => void
  onClear?: () => void
  /** Активный быстрый период (подсветка кнопок) */
  preset?: WarehousePeriodPreset
  onPresetChange?: (kind: WarehousePeriodPreset) => void
}) {
  const active = Boolean(from || to || preset)

  function applyPreset(kind: 'day' | 'week' | 'month') {
    const now = Date.now()
    const fromDate = new Date(periodPresetSinceMs(kind, now))
    const toDate = new Date(now)
    onFromChange(toInputDate(fromDate))
    onToChange(toInputDate(toDate))
    onPresetChange?.(kind)
  }

  function changeFrom(v: string) {
    onPresetChange?.(null)
    onFromChange(v)
  }

  function changeTo(v: string) {
    onPresetChange?.(null)
    onToChange(v)
  }

  const btnStyle = (kind: 'day' | 'week' | 'month') => ({
    padding: '7px 10px',
    fontSize: 12,
    ...(preset === kind
      ? {
          background: 'rgba(31,215,96,.18)',
          border: '1px solid rgba(31,215,96,.45)',
          color: 'var(--green)',
          fontWeight: 800,
        }
      : {}),
  })

  return (
    <div className="k-wh-period" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span className="k-hide-mob" style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap' }}>Период</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className="k-btn k-btn-s" style={btnStyle('day')} onClick={() => applyPreset('day')} title="Последние 24 часа">
          День
        </button>
        <button type="button" className="k-btn k-btn-s" style={btnStyle('week')} onClick={() => applyPreset('week')} title="Последние 7 дней">
          Неделя
        </button>
        <button type="button" className="k-btn k-btn-s" style={btnStyle('month')} onClick={() => applyPreset('month')} title="Последние 30 дней">
          Месяц
        </button>
      </div>
      <input
        type="date"
        className="k-inp"
        style={{ width: 'auto', minWidth: 132, maxWidth: 160 }}
        value={from}
        onChange={e => changeFrom(e.target.value)}
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
        onChange={e => changeTo(e.target.value)}
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
