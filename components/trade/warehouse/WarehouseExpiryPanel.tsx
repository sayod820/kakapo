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
        padding: '12px 14px',
        borderRadius: 12,
        border: `1px solid ${urgency === 'ok' ? 'var(--border)' : meta.color + '55'}`,
        background: urgency === 'ok' ? 'var(--card2)' : meta.bg,
        marginBottom: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 28, flexShrink: 0 }}>{product?.e || '📦'}</span>

        <div style={{ flex: '1 1 200px', minWidth: 160 }}>
          <div style={{ fontWeight: 900, fontSize: 15 }}>{row.productName}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {product?.art && <span>{product.art}</span>}
            {barcode && <span>· 🏷 {barcode}</span>}
            {row.receiptCreatedAtIso && <span>· приход {fmtDate(row.receiptCreatedAtIso)}</span>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            Партия: <b style={{ color: 'var(--text)' }}>{row.qty}</b> {product?.unit || 'шт'}
            {price > 0 && <> · {fmtMoney(price)}/{product?.unit || 'шт'}</>}
          </div>
        </div>

        <div style={{ flex: '0 0 190px', minWidth: 170, textAlign: 'right' }}>
          <span
            className="k-badge"
            style={{ background: meta.bg, color: meta.color, fontWeight: 900 }}
          >
            {daysLabel(row.daysLeft)}
          </span>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
            Срок: <b style={{ color: 'var(--text)' }}>{fmtDate(row.expiryDate)}</b>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden', marginTop: 8 }}>
            <div style={{ height: '100%', width: `${pct}%`, background: meta.color, borderRadius: 3 }} />
          </div>
          {riskSum > 0 && (
            <div style={{ fontSize: 12, marginTop: 6, fontWeight: 800, color: meta.color }}>
              Под риском: {fmtMoney(riskSum)}
            </div>
          )}
        </div>

        <div style={{ flexShrink: 0, alignSelf: 'center' }}>
          <button
            type="button"
            className="k-btn k-btn-s"
            style={{ color: 'var(--red)', fontSize: 12, whiteSpace: 'nowrap' }}
            disabled={busy}
            onClick={onWriteOff}
            title="Списать эту партию с причиной «Просрочка»"
          >
            {busy ? 'Списание…' : '📤 Списать'}
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
    <div>
      <div className="k-kpis" style={{ marginBottom: 14 }}>
        <div className="k-kpi k-statcard">
          <div className="kl">Партий под контролем</div>
          <div className="kv">{expiry.length}</div>
        </div>
        <div className="k-kpi k-statcard">
          <div className="kl">Просрочено</div>
          <div className="kv" style={{ color: 'var(--red)' }}>{stats.expired}</div>
        </div>
        <div className="k-kpi k-statcard">
          <div className="kl">Срочно (≤3 дня)</div>
          <div className="kv" style={{ color: 'var(--red)' }}>{stats.urgent}</div>
        </div>
        <div className="k-kpi k-statcard">
          <div className="kl">Скоро (≤7 дней)</div>
          <div className="kv" style={{ color: 'var(--gold)' }}>{stats.soon}</div>
        </div>
        <div className="k-kpi k-statcard">
          <div className="kl">Под риском</div>
          <div className="kv" style={{ color: stats.riskSum > 0 ? 'var(--red)' : 'var(--muted)' }}>
            {stats.riskSum > 0 ? fmtMoney(stats.riskSum) : '—'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: '1 1 auto' }}>
          {urgencyTabs.map(t => (
            <button
              key={t.id}
              type="button"
              className={`k-subtab ${urgencyFlt === t.id ? 'active' : ''}`}
              style={{ padding: '6px 12px', fontSize: 12, color: urgencyFlt !== t.id ? t.color : undefined }}
              onClick={() => setUrgencyFlt(t.id)}
            >
              {t.label}{t.count > 0 ? ` (${t.count})` : ''}
            </button>
          ))}
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

      {!filtered.length ? (
        <div className="k-empty">
          {expiry.length
            ? 'По этому фильтру партий нет'
            : `🎉 Нет партий с истекающим сроком в ближайшие ${days} дней`}
        </div>
      ) : (
        <div>
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
      )}
    </div>
  )
}
