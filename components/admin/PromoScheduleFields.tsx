'use client'

import type { PromoScheduleMode } from '@/lib/promoSchedule'
import { datetimeLocalToIso, isoToDatetimeLocal, splitDatetimeLocal, joinDatetimeLocal } from '@/lib/promoSchedule'

export type PromoScheduleForm = {
  scheduleMode: PromoScheduleMode
  from: string
  to: string
  till: string
  startsAt: string
  endsAt: string
}

type Props = {
  value: PromoScheduleForm
  onChange: (patch: Partial<PromoScheduleForm>) => void
  compact?: boolean
  /** flash — только флэш; category — всегда/ежедневно без флэш */
  context?: 'flash' | 'category'
}

const MODES: { id: PromoScheduleMode; label: string; hint: string }[] = [
  { id: 'always', label: '♾️ Всегда', hint: 'Без ограничения по времени' },
  { id: 'daily', label: '🕐 Ежедневно', hint: 'Каждый день в указанные часы' },
  { id: 'flash', label: '⚡ Флэш', hint: 'До конкретной даты и времени' },
]

export default function PromoScheduleFields({ value, onChange, compact, context }: Props) {
  const mode = value.scheduleMode
  const visibleModes = context === 'flash'
    ? MODES.filter(m => m.id === 'flash')
    : context === 'category'
      ? MODES.filter(m => m.id !== 'flash')
      : MODES

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 6, fontWeight: 700 }}>Когда действует</div>
        {context === 'flash' ? (
          <div style={{
            padding: '8px 12px',
            borderRadius: 9,
            background: 'rgba(255,69,69,.1)',
            border: '1px solid rgba(255,69,69,.25)',
            fontSize: 12,
            fontWeight: 700,
            color: '#FF8C8C',
          }}>
            ⚡ Флэш-распродажа
            <div style={{ fontSize: 10, color: '#8FB897', fontWeight: 500, marginTop: 4 }}>До конкретной даты и времени</div>
          </div>
        ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {visibleModes.map(m => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                if (m.id === 'flash' && !splitDatetimeLocal(value.endsAt, value.to || '20:00').date) {
                  const today = new Date()
                  const pad = (n: number) => String(n).padStart(2, '0')
                  const date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
                  onChange({
                    scheduleMode: m.id,
                    endsAt: joinDatetimeLocal(date, value.to || '20:00', value.to || '20:00'),
                  })
                } else {
                  onChange({ scheduleMode: m.id })
                }
              }}
              className="ab"
              style={{
                flex: compact ? '1 1 auto' : '1 1 30%',
                minWidth: compact ? 90 : 120,
                padding: '8px 10px',
                fontSize: 11,
                fontWeight: 700,
                background: mode === m.id ? 'rgba(31,215,96,.14)' : '#091508',
                border: `1.5px solid ${mode === m.id ? 'rgba(31,215,96,.35)' : '#162B1A'}`,
                color: mode === m.id ? '#1FD760' : '#8FB897',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        )}
        {context !== 'flash' && (
          <div style={{ fontSize: 10, color: '#3D6645', marginTop: 6 }}>
            {visibleModes.find(m => m.id === mode)?.hint}
          </div>
        )}
      </div>

      {mode === 'daily' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>С</div>
            <input className="ai" type="time" value={value.from} onChange={e => onChange({ from: e.target.value })} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>До</div>
            <input className="ai" type="time" value={value.to} onChange={e => onChange({ to: e.target.value })} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>Подпись</div>
            <input className="ai" value={value.till} onChange={e => onChange({ till: e.target.value })} placeholder="Среда, Сб–Вс…" />
          </div>
        </div>
      )}

      {mode === 'flash' && (
        <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '1fr 1fr', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>Начало (необяз.)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 8 }}>
              <input
                className="ai"
                type="date"
                value={splitDatetimeLocal(value.startsAt, value.from || '08:00').date}
                onChange={e => {
                  const { time } = splitDatetimeLocal(value.startsAt, value.from || '08:00')
                  onChange({ startsAt: joinDatetimeLocal(e.target.value, time, value.from || '08:00') })
                }}
              />
              <input
                className="ai"
                type="time"
                value={splitDatetimeLocal(value.startsAt, value.from || '08:00').time}
                onChange={e => {
                  const { date } = splitDatetimeLocal(value.startsAt, value.from || '08:00')
                  if (!date) return
                  onChange({ startsAt: joinDatetimeLocal(date, e.target.value, value.from || '08:00') })
                }}
              />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>Окончание *</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 8 }}>
              <input
                className="ai"
                type="date"
                value={splitDatetimeLocal(value.endsAt, value.to || '20:00').date}
                onChange={e => {
                  const { time } = splitDatetimeLocal(value.endsAt, value.to || '20:00')
                  onChange({ endsAt: joinDatetimeLocal(e.target.value, time, value.to || '20:00') })
                }}
              />
              <input
                className="ai"
                type="time"
                value={splitDatetimeLocal(value.endsAt, value.to || '20:00').time}
                onChange={e => {
                  const { date } = splitDatetimeLocal(value.endsAt, value.to || '20:00')
                  if (!date) return
                  onChange({ endsAt: joinDatetimeLocal(date, e.target.value, value.to || '20:00') })
                }}
              />
            </div>
            <div style={{ fontSize: 10, color: '#3D6645', marginTop: 5 }}>Если время не менять — берётся из «Часы показа» справа</div>
          </div>
          <div style={{ gridColumn: compact ? undefined : '1 / -1' }}>
            <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>Часы показа в магазине</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <input className="ai" type="time" value={value.from} onChange={e => onChange({ from: e.target.value })} />
              <input className="ai" type="time" value={value.to} onChange={e => onChange({ to: e.target.value })} />
            </div>
          </div>
        </div>
      )}

      {mode === 'always' && !compact && (
        <div>
          <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>Подпись для клиентов</div>
          <input className="ai" value={value.till} onChange={e => onChange({ till: e.target.value })} placeholder="Всегда" />
        </div>
      )}
    </div>
  )
}

export function scheduleFromPromo(p: {
  scheduleMode?: PromoScheduleMode
  from?: string
  to?: string
  till?: string
  startsAt?: string
  endsAt?: string
}): PromoScheduleForm {
  return {
    scheduleMode: p.scheduleMode || (p.endsAt ? 'flash' : p.from && p.to && (p.from !== '00:00' || p.to !== '23:59') ? 'daily' : 'always'),
    from: p.from || '08:00',
    to: p.to || '22:00',
    till: p.till || 'Всегда',
    startsAt: isoToDatetimeLocal(p.startsAt),
    endsAt: isoToDatetimeLocal(p.endsAt),
  }
}

export function scheduleToPromoPayload(form: PromoScheduleForm) {
  return {
    scheduleMode: form.scheduleMode,
    from: form.scheduleMode === 'always' ? '00:00' : form.from,
    to: form.scheduleMode === 'always' ? '23:59' : form.to,
    till: form.scheduleMode === 'flash'
      ? (form.endsAt ? 'Флэш' : 'Сегодня')
      : (form.till || 'Всегда'),
    startsAt: form.scheduleMode === 'flash' ? datetimeLocalToIso(form.startsAt, form.from || '08:00') : undefined,
    endsAt: form.scheduleMode === 'flash' ? datetimeLocalToIso(form.endsAt, form.to || '20:00') : undefined,
  }
}
