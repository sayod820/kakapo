'use client'

import { useMemo, useState } from 'react'
import type { Product } from '@/lib/types'
import { productMatchesSearch } from '@/lib/productBarcodes'
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
  products,
  onDaysChange,
}: {
  expiry: ExpiryRow[]
  days: number
  products: Product[]
  onDaysChange: (d: number) => void
}) {
  const [q, setQ] = useState('')

  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

  const sorted = useMemo(() => {
    const query = q.trim()
    return [...expiry]
      .filter(row => {
        if (!query) return true
        const product = productMap.get(row.productId)
        return productMatchesSearch({ id: row.productId, name: row.productName, ...product }, query)
      })
      .sort((a, b) => a.daysLeft - b.daysLeft)
  }, [expiry, q, productMap])

  const urgent = sorted.filter(r => r.daysLeft <= 3).length
  const soon = sorted.filter(r => r.daysLeft > 3 && r.daysLeft <= 7).length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flex: '1 1 auto' }}>
          {urgent > 0 && <span className="k-badge" style={{ background: '#2a1420', color: 'var(--red)' }}>Срочно: {urgent}</span>}
          {soon > 0 && <span className="k-badge" style={{ background: '#2a2414', color: 'var(--gold)' }}>Скоро: {soon}</span>}
        </div>
        <input
          className="k-inp"
          style={{ flex: '1 1 200px', maxWidth: 320 }}
          placeholder="Поиск: штрихкод, название, артикул…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
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
        <div className="k-empty">{expiry.length ? 'Ничего не найдено' : `Нет партий с истекающим сроком в ближайшие ${days} дней`}</div>
      ) : (
        <div className="k-card k-tbl-scroll">
          <table className="k-tbl">
            <thead>
              <tr>
                <th>Товар</th>
                <th className="num">Остаток</th>
                <th>Срок годности</th>
                <th className="num">Осталось дней</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(row => {
                const product = productMap.get(row.productId)
                const color = row.daysLeft <= 3 ? 'var(--red)' : row.daysLeft <= 7 ? 'var(--gold)' : 'var(--green)'
                return (
                  <tr key={`${row.receiptId}-${row.productId}`}>
                    <td>
                      <div style={{ fontWeight: 800 }}>{row.productName}</div>
                      {product?.art && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{product.art}</div>}
                    </td>
                    <td className="num">{row.qty}</td>
                    <td>{fmtDate(row.expiryDate)}</td>
                    <td className="num" style={{ color, fontWeight: 800 }}>{row.daysLeft}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
