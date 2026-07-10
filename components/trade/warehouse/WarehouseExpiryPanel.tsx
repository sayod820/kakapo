'use client'

import { useMemo } from 'react'
import { fmtDate } from './warehouseShared'

type ExpiryRow = {
  receiptId: string
  productId: number
  productName: string
  qty: number
  expiryDate: string
  daysLeft: number
}

export default function WarehouseExpiryPanel({
  expiry,
  days,
  onDaysChange,
}: {
  expiry: ExpiryRow[]
  days: number
  onDaysChange: (d: number) => void
}) {
  const sorted = useMemo(
    () => [...expiry].sort((a, b) => a.daysLeft - b.daysLeft),
    [expiry],
  )

  const urgent = sorted.filter(r => r.daysLeft <= 3).length
  const soon = sorted.filter(r => r.daysLeft > 3 && r.daysLeft <= 7).length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {urgent > 0 && <span className="k-badge" style={{ background: '#2a1420', color: 'var(--red)' }}>Срочно: {urgent}</span>}
          {soon > 0 && <span className="k-badge" style={{ background: '#2a2414', color: 'var(--gold)' }}>Скоро: {soon}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Показать на</span>
          <select className="k-sel" style={{ width: 'auto', minWidth: 100 }} value={days} onChange={e => onDaysChange(Number(e.target.value))}>
            <option value={7}>7 дней</option>
            <option value={14}>14 дней</option>
            <option value={30}>30 дней</option>
            <option value={60}>60 дней</option>
          </select>
        </div>
      </div>

      {!sorted.length ? (
        <div className="k-empty">Нет партий с истекающим сроком в ближайшие {days} дней</div>
      ) : (
        <div className="k-card k-tbl-scroll">
          <table className="k-tbl">
            <thead>
              <tr>
                <th>Товар</th>
                <th className="num">Остаток</th>
                <th>Срок годности</th>
                <th className="num">Осталось</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <tr key={`${row.receiptId}-${row.productId}-${i}`}>
                  <td>{row.productName}</td>
                  <td className="num">{row.qty}</td>
                  <td>{fmtDate(row.expiryDate)}</td>
                  <td className="num">
                    <span style={{
                      color: row.daysLeft <= 3 ? 'var(--red)' : row.daysLeft <= 7 ? 'var(--gold)' : 'var(--muted)',
                      fontWeight: 800,
                    }}>
                      {row.daysLeft} дн.
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
