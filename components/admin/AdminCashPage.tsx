'use client'

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import type { PosShift } from '@/lib/types'

type CashBook = { balance: number; summary?: { inflow: number; outflow: number; count: number } }
type VsRow = {
  shiftId: string
  posId?: string
  cashierName?: string
  closedAtIso?: string
  expectedCash: number
  actualCash: number
  cashDiff: number
  alert: boolean
}
type Alert = {
  id: string
  kind: string
  severity: string
  title: string
  message: string
  atIso?: string
}
type TruthBundle = {
  cashBook?: CashBook
  expectedVsActual?: { rows?: VsRow[]; summary?: { shifts: number; withAlert: number; absDiffSum: number } }
  alerts?: { alerts?: Alert[]; count?: number }
}

function fmtMoney(n: number) {
  return `${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('ru-RU')} ЅМ`
}

function fmtWhen(iso?: string) {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  return new Date(t).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

/** Ожидаемая наличка в открытой смене сейчас */
function openShiftExpected(s: PosShift) {
  return Math.round((
    (Number(s.openingCash) || 0)
    + (Number(s.salesCash) || 0)
    + (Number(s.cashInTotal) || 0)
    - (Number(s.expenseTotal) || 0)
  ) * 100) / 100
}

export default function AdminCashPage() {
  const [shifts, setShifts] = useState<PosShift[]>([])
  const [truth, setTruth] = useState<TruthBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    if (!USE_API) {
      setErr('Нужен API-сервер')
      setLoading(false)
      return
    }
    setLoading(true)
    setErr('')
    try {
      const [sh, tr] = await Promise.all([
        api.getPosShifts(),
        api.getFinanceTruth().catch(() => null),
      ])
      setShifts(Array.isArray(sh) ? sh : [])
      setTruth((tr as TruthBundle) || null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось загрузить кассу')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const openShifts = useMemo(() => shifts.filter(s => s.status === 'open'), [shifts])
  const cashInTills = useMemo(
    () => openShifts.reduce((sum, s) => sum + openShiftExpected(s), 0),
    [openShifts],
  )
  const vsRows = truth?.expectedVsActual?.rows || []
  const alerts = truth?.alerts?.alerts || []
  const cashBookBalance = truth?.cashBook?.balance ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button type="button" onClick={() => void load()} className="ab abp" style={{ padding: '8px 16px', fontSize: 12 }}>
          ↻ Обновить
        </button>
        <span style={{ fontSize: 12, color: '#8FB897' }}>
          {loading ? 'Загрузка…' : 'Данные из кассы (Торговля) в реальном времени'}
        </span>
      </div>

      {err && <div style={{ color: '#FF4545', fontSize: 13 }}>⚠ {err}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
        <StatBox l="💵 Наличка в кассах сейчас" v={fmtMoney(cashInTills)} c="#1FD760" sub={`${openShifts.length} откр. смен`} />
        <StatBox l="🧾 Открытых смен" v={String(openShifts.length)} c="#FFB800" />
        <StatBox l="📒 Баланс кассовой книги" v={cashBookBalance != null ? fmtMoney(cashBookBalance) : '—'} c="#00D4C8" />
        <StatBox l="⚠ Расхождения" v={String(alerts.length)} c={alerts.length > 0 ? '#FF4545' : '#3D6645'} />
      </div>

      <Section title="Открытые смены (наличка сейчас)">
        {openShifts.length === 0 ? (
          <Empty text="Нет открытых смен" />
        ) : (
          <table className="at">
            <thead>
              <tr>
                <th>Кассир</th>
                <th>Точка</th>
                <th>Открыта</th>
                <th>Старт кассы</th>
                <th>Продажи нал</th>
                <th>Внесено</th>
                <th>Расходы</th>
                <th>В кассе сейчас</th>
              </tr>
            </thead>
            <tbody>
              {openShifts.map(s => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.cashierName || '—'}</td>
                  <td style={{ color: '#8FB897' }}>{s.posId || '—'}</td>
                  <td style={{ fontSize: 11, color: '#3D6645' }}>{fmtWhen(s.openedAtIso)}</td>
                  <td>{fmtMoney(s.openingCash)}</td>
                  <td>{fmtMoney(s.salesCash)}</td>
                  <td>{fmtMoney(Number(s.cashInTotal) || 0)}</td>
                  <td style={{ color: '#FF8C8C' }}>{fmtMoney(s.expenseTotal)}</td>
                  <td style={{ color: '#1FD760', fontWeight: 800 }}>{fmtMoney(openShiftExpected(s))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {alerts.length > 0 && (
        <Section title="Расхождения и предупреждения">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {alerts.map(a => (
              <div key={a.id} style={{
                padding: '10px 14px', borderRadius: 10,
                background: a.severity === 'high' ? 'rgba(255,69,69,.1)' : 'rgba(255,140,0,.08)',
                border: `1px solid ${a.severity === 'high' ? 'rgba(255,69,69,.35)' : 'rgba(255,140,0,.3)'}`,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: a.severity === 'high' ? '#FF6B6B' : '#FFB800' }}>{a.title}</div>
                <div style={{ fontSize: 12, color: '#C8E0D0', marginTop: 2 }}>{a.message}</div>
                <div style={{ fontSize: 10, color: '#3D6645', marginTop: 2 }}>{fmtWhen(a.atIso)}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Закрытые смены — ожидалось / факт">
        {vsRows.length === 0 ? (
          <Empty text="Нет закрытых смен" />
        ) : (
          <table className="at">
            <thead>
              <tr>
                <th>Кассир</th>
                <th>Точка</th>
                <th>Закрыта</th>
                <th>Ожидалось</th>
                <th>Факт</th>
                <th>Разница</th>
              </tr>
            </thead>
            <tbody>
              {vsRows.slice(0, 50).map(r => (
                <tr key={r.shiftId}>
                  <td style={{ fontWeight: 600 }}>{r.cashierName || '—'}</td>
                  <td style={{ color: '#8FB897' }}>{r.posId || '—'}</td>
                  <td style={{ fontSize: 11, color: '#3D6645' }}>{fmtWhen(r.closedAtIso)}</td>
                  <td>{fmtMoney(r.expectedCash)}</td>
                  <td>{fmtMoney(r.actualCash)}</td>
                  <td style={{
                    fontWeight: 800,
                    color: Math.abs(r.cashDiff) < 0.01 ? '#3D6645' : r.cashDiff < 0 ? '#FF4545' : '#FFB800',
                  }}>
                    {r.cashDiff > 0 ? '+' : ''}{fmtMoney(r.cashDiff)}
                    {r.cashDiff < -0.01 ? ' (недостача)' : r.cashDiff > 0.01 ? ' (излишек)' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  )
}

const StatBox = ({ l, v, c, sub }: { l: string; v: string; c?: string; sub?: string }) => (
  <div style={{ padding: '14px 16px', borderRadius: 14, background: '#0C1C0F', border: '1px solid #162B1A' }}>
    <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 6 }}>{l}</div>
    <div style={{ fontSize: 22, fontWeight: 900, color: c || '#EBF5ED', fontFamily: 'Unbounded' }}>{v}</div>
    {sub && <div style={{ fontSize: 10, color: '#3D6645', marginTop: 4 }}>{sub}</div>}
  </div>
)

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div style={sectionStyle}>
    <div style={{ fontSize: 14, fontWeight: 800, color: '#EBF5ED', marginBottom: 12 }}>{title}</div>
    {children}
  </div>
)

const Empty = ({ text }: { text: string }) => (
  <div style={{ color: '#3D6645', fontSize: 13, padding: 20, textAlign: 'center' }}>{text}</div>
)

const sectionStyle: CSSProperties = {
  padding: '16px 18px',
  borderRadius: 16,
  background: 'rgba(8,28,16,0.55)',
  border: '1px solid rgba(80,140,100,0.22)',
}
