'use client'

import { useMemo, useState } from 'react'
import type { Product } from '@/lib/types'
import { productMatchesSearch } from '@/lib/productBarcodes'
import { fmtDate, fmtMoney } from './warehouseShared'

export type ExpiryRow = {
  receiptId: string
  receiptCreatedAtIso?: string
  productId: number
  productName: string
  qty: number
  costPrice?: number
  retailPrice?: number
  expiryDate: string
  daysLeft: number
}

type Urgency = 'all' | 'expired' | 'urgent' | 'soon' | 'ok'

function urgencyOf(daysLeft: number): Exclude<Urgency, 'all'> {
  if (daysLeft < 0) return 'expired'
  if (daysLeft <= 3) return 'urgent'
  if (daysLeft <= 7) return 'soon'
  return 'ok'
}

const URGENCY_META: Record<Exclude<Urgency, 'all'>, { label: string; color: string; bg: string }> = {
  expired: { label: 'Просрочено', color: '#FF5A5A', bg: 'rgba(255,90,90,.14)' },
  urgent: { label: 'Срочно', color: '#FF5A5A', bg: 'rgba(255,90,90,.1)' },
  soon: { label: 'Скоро', color: '#FFB800', bg: 'rgba(255,184,0,.12)' },
  ok: { label: 'В норме', color: '#1FD760', bg: 'rgba(31,215,96,.1)' },
}

/** Себестоимость партии, а если её нет — розничная (чтобы сумма риска считалась всегда). */
function basisPrice(row: ExpiryRow): number {
  const cost = Number(row.costPrice) || 0
  if (cost > 0) return cost
  return Number(row.retailPrice) || 0
}

function daysLabel(daysLeft: number) {
  if (daysLeft < 0) return `Просрочено ${Math.abs(daysLeft)} ${plural(Math.abs(daysLeft), 'день', 'дня', 'дней')} назад`
  if (daysLeft === 0) return 'Истекает сегодня'
  if (daysLeft === 1) return 'Истекает завтра'
  return `Осталось ${daysLeft} ${plural(daysLeft, 'день', 'дня', 'дней')}`
}

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

function ExpiryCard({
  row,
  product,
  rangeDays,
  onWriteOff,
  busy,
}: {
  row: ExpiryRow
  product: Product | undefined
  rangeDays: number
  onWriteOff: () => void
  busy: boolean
}) {
  const urgency = urgencyOf(row.daysLeft)
  const meta = URGENCY_META[urgency]
  const price = basisPrice(row)
  const riskSum = price * row.qty
  const pct = Math.max(4, Math.min(100, 100 - (row.daysLeft / Math.max(rangeDays, 1)) * 100))
  const barcode = product?.barcode || product?.barcodes?.[0] || ''

  return (
    <div
      style={{
        padding: '8px 10px',
        borderRadius: 10,
        border: `1px solid ${urgency === 'ok' ? 'var(--border)' : meta.color + '55'}`,
        background: urgency === 'ok' ? 'var(--card2)' : meta.bg,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 20, flexShrink: 0 }}>{product?.e || '📦'}</span>

        <div style={{ flex: '1 1 160px', minWidth: 140 }}>
          <div style={{ fontWeight: 900, fontSize: 13, lineHeight: 1.25 }}>{row.productName}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {product?.art && <span>{product.art}</span>}
            {barcode && <span>· 🏷 {barcode}</span>}
            {row.receiptCreatedAtIso && <span>· приход {fmtDate(row.receiptCreatedAtIso)}</span>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            <b style={{ color: 'var(--text)' }}>{row.qty}</b> {product?.unit || 'шт'}
            {price > 0 && <> · {fmtMoney(price)}/{product?.unit || 'шт'}</>}
            {riskSum > 0 && <> · риск <b style={{ color: meta.color }}>{fmtMoney(riskSum)}</b></>}
          </div>
        </div>

        <div style={{ flex: '0 0 auto', minWidth: 140, textAlign: 'right' }}>
          <span
            className="k-badge"
            style={{ background: meta.bg, color: meta.color, fontWeight: 900, fontSize: 10, padding: '2px 6px' }}
          >
            {daysLabel(row.daysLeft)}
          </span>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            {fmtDate(row.expiryDate)}
          </div>
          <div style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden', marginTop: 5 }}>
            <div style={{ height: '100%', width: `${pct}%`, background: meta.color, borderRadius: 2 }} />
          </div>
        </div>

        <div style={{ flexShrink: 0 }}>
          <button
            type="button"
            className="k-btn k-btn-s"
            style={{ color: 'var(--red)', fontSize: 12, padding: '5px 10px', minHeight: 0, whiteSpace: 'nowrap' }}
            disabled={busy}
            onClick={onWriteOff}
            title="Списать эту партию с причиной «Просрочка»"
          >
            {busy ? '…' : '📤 Списать'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function WarehouseExpiryPanel({
  expiry,
  days,
  products,
  onDaysChange,
  onWriteOff,
}: {
  expiry: ExpiryRow[]
  days: number
  products: Product[]
  onDaysChange: (d: number) => void
  onWriteOff: (row: ExpiryRow) => Promise<void>
}) {
  const [q, setQ] = useState('')
  const [urgencyFlt, setUrgencyFlt] = useState<Urgency>('all')
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const productMap = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

  const withUrgency = useMemo(
    () => [...expiry].sort((a, b) => a.daysLeft - b.daysLeft).map(row => ({ row, urgency: urgencyOf(row.daysLeft) })),
    [expiry],
  )

  const stats = useMemo(() => {
    let expired = 0
    let urgent = 0
    let soon = 0
    let riskSum = 0
    for (const { row, urgency } of withUrgency) {
      if (urgency === 'expired') expired++
      else if (urgency === 'urgent') urgent++
      else if (urgency === 'soon') soon++
      if (urgency !== 'ok') riskSum += basisPrice(row) * row.qty
    }
    return { expired, urgent, soon, riskSum }
  }, [withUrgency])

  const filtered = useMemo(() => {
    const query = q.trim()
    return withUrgency
      .filter(({ urgency }) => urgencyFlt === 'all' || urgency === urgencyFlt)
      .filter(({ row }) => {
        if (!query) return true
        const product = productMap.get(row.productId)
        return productMatchesSearch({ id: row.productId, name: row.productName, ...product }, query)
      })
      .map(({ row }) => row)
  }, [withUrgency, urgencyFlt, q, productMap])

  async function handleWriteOff(row: ExpiryRow) {
    const key = `${row.receiptId}-${row.productId}`
    if (!confirm(`Списать «${row.productName}» — ${row.qty} ${productMap.get(row.productId)?.unit || 'шт'} с причиной «Просрочка»?`)) return
    setBusyKey(key)
    try {
      await onWriteOff(row)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось списать партию')
    } finally {
      setBusyKey(null)
    }
  }

  const urgencyTabs: { id: Urgency; label: string; count: number; color?: string }[] = [
    { id: 'all', label: 'Все', count: expiry.length },
    { id: 'expired', label: '⛔ Просрочено', count: stats.expired, color: 'var(--red)' },
    { id: 'urgent', label: '🔥 Срочно ≤3 дня', count: stats.urgent, color: 'var(--red)' },
    { id: 'soon', label: '⏳ Скоро ≤7 дней', count: stats.soon, color: 'var(--gold)' },
  ]

  return (
    <div className="k-wh-expiry">
      <div className="k-wh-panel-head">
        <div className="k-wh-meta">
          <span><b>{expiry.length}</b> партий</span>
          <div className="k-wh-money" style={{ marginLeft: 'auto' }}>
            <span>Просроч. <b style={{ color: 'var(--red)' }}>{stats.expired}</b></span>
            <span>≤3 дн. <b style={{ color: 'var(--red)' }}>{stats.urgent}</b></span>
            <span>≤7 дн. <b style={{ color: 'var(--gold)' }}>{stats.soon}</b></span>
            <span>
              Риск{' '}
              <b style={{ color: stats.riskSum > 0 ? 'var(--red)' : 'var(--muted)' }}>
                {stats.riskSum > 0 ? fmtMoney(stats.riskSum) : '—'}
              </b>
            </span>
          </div>
        </div>

        <div className="k-wh-filters-row">
          {urgencyTabs.map(t => (
            <button
              key={t.id}
              type="button"
              className={`k-subtab ${urgencyFlt === t.id ? 'active' : ''}`}
              style={{ padding: '5px 10px', fontSize: 12, color: urgencyFlt !== t.id ? t.color : undefined }}
              onClick={() => setUrgencyFlt(t.id)}
            >
              {t.label}{t.count > 0 ? ` (${t.count})` : ''}
            </button>
          ))}
          <input
            className="k-inp"
            style={{ flex: '1 1 160px', maxWidth: 260, padding: '6px 10px', fontSize: 12, minHeight: 0 }}
            placeholder="Поиск…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          <select
            className="k-sel"
            style={{ width: 'auto', minWidth: 90, padding: '6px 8px', fontSize: 12, minHeight: 0 }}
            value={days}
            onChange={e => onDaysChange(Number(e.target.value))}
          >
            <option value={7}>7 дн.</option>
            <option value={14}>14 дн.</option>
            <option value={30}>30 дн.</option>
            <option value={60}>60 дн.</option>
          </select>
        </div>
      </div>

      {!filtered.length ? (
        <div className="k-empty">
          {expiry.length
            ? 'По этому фильтру партий нет'
            : `🎉 Нет партий с истекающим сроком в ближайшие ${days} дней`}
        </div>
      ) : (
        <div className="k-wh-panel-body">
          <div className="k-wh-expiry-list">
            {filtered.map(row => (
              <ExpiryCard
                key={`${row.receiptId}-${row.productId}`}
                row={row}
                product={productMap.get(row.productId)}
                rangeDays={days}
                busy={busyKey === `${row.receiptId}-${row.productId}`}
                onWriteOff={() => void handleWriteOff(row)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
