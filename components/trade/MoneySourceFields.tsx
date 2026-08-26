'use client'

import type { MoneyPayFrom, MoneyPayMethod } from '@/lib/types'
import { fmtMoney } from '@/components/trade/warehouse/warehouseShared'

export type MoneySourceValue = {
  payFrom: MoneyPayFrom
  method: MoneyPayMethod
}

type Props = {
  value: MoneySourceValue
  onChange: (next: MoneySourceValue) => void
  /** Доступно в кассе смены (нал) */
  shiftCash?: number
  /** Доступно в кассе смены (карта) */
  shiftCard?: number
  /** Доступно в основном (нал) */
  vaultCash?: number
  /** Доступно в основном (карта) */
  vaultCard?: number
  /** Скрыть кассу смены (нет открытой) */
  hideShift?: boolean
  /** Подпись блока */
  label?: string
  compact?: boolean
}

/** Единый блок: откуда + нал/карта */
export default function MoneySourceFields({
  value,
  onChange,
  shiftCash = 0,
  shiftCard = 0,
  vaultCash = 0,
  vaultCard = 0,
  hideShift = false,
  label = 'Откуда',
  compact = false,
}: Props) {
  const payFrom = hideShift ? 'vault' : value.payFrom
  const method = value.method
  const avail = payFrom === 'vault'
    ? (method === 'card' ? vaultCard : vaultCash)
    : (method === 'card' ? shiftCard : shiftCash)

  return (
    <div className="k-money-src" style={{ display: 'grid', gap: compact ? 8 : 10 }}>
      <div className="k-field" style={{ marginBottom: 0 }}>
        <label>{label}</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!hideShift && (
            <button
              type="button"
              className={`k-subtab ${payFrom === 'shift' ? 'active' : ''}`}
              onClick={() => onChange({ ...value, payFrom: 'shift' })}
            >
              Касса смены
            </button>
          )}
          <button
            type="button"
            className={`k-subtab ${payFrom === 'vault' ? 'active' : ''}`}
            onClick={() => onChange({ ...value, payFrom: 'vault' })}
          >
            Основной ящик
          </button>
        </div>
      </div>
      <div className="k-field" style={{ marginBottom: 0 }}>
        <label>Чем</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`k-subtab ${method === 'cash' ? 'active' : ''}`}
            onClick={() => onChange({ ...value, method: 'cash' })}
          >
            Нал
          </button>
          <button
            type="button"
            className={`k-subtab ${method === 'card' ? 'active' : ''}`}
            onClick={() => onChange({ ...value, method: 'card' })}
          >
            Карта
          </button>
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
        Доступно: <b style={{ color: 'var(--text)' }}>{fmtMoney(avail)}</b>
        {' · '}
        {payFrom === 'vault' ? 'основной' : 'смена'}
        {' · '}
        {method === 'card' ? 'карта' : 'нал'}
      </div>
    </div>
  )
}
