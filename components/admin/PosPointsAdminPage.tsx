'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import type { PosBoundDevice, PosPoint, TradeDeviceLiveStatus } from '@/lib/types'

/** По умолчанию устройство участвует в ожидании ревизии */
function deviceParticipatesInRevision(device: PosBoundDevice): boolean {
  return device.revisionParticipationDefault !== false
}

export default function PosPointsAdminPage() {
  const [rows, setRows] = useState<PosPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [pair, setPair] = useState<{ posId: string; name: string; code: string; expiresAtIso: string } | null>(null)
  const [liveDevices, setLiveDevices] = useState<TradeDeviceLiveStatus[]>([])

  const load = useCallback(async () => {
    if (!USE_API) {
      setErr('Нужен API')
      setLoading(false)
      return
    }
    setLoading(true)
    setErr('')
    try {
      const [points, statuses] = await Promise.all([
        api.getPosPoints(),
        api.getPosDeviceStatuses().catch(() => [] as TradeDeviceLiveStatus[]),
      ])
      setRows(points)
      setLiveDevices(statuses)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось загрузить')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function addPoint() {
    const n = name.trim()
    if (!n) return
    setBusy(true)
    try {
      await api.createPosPoint({ name: n, code: code.trim() || undefined })
      setName('')
      setCode('')
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  async function makeCode(row: PosPoint) {
    setBusy(true)
    try {
      setPair(await api.createPosPairCode(row.id))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  async function renameDevice(row: PosPoint, device: PosBoundDevice) {
    const next = window.prompt('Имя устройства', device.name)
    if (next == null) return
    const name = next.trim()
    if (!name) return
    try {
      await api.renamePosDevice(row.id, device.id, name)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  async function removeDevice(row: PosPoint, device: PosBoundDevice) {
    if (!confirm(`Отвязать «${device.name}» от точки «${row.name}»?`)) return
    try {
      await api.unbindPosDevice(row.id, device.id)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  async function toggleRevisionParticipation(row: PosPoint, device: PosBoundDevice) {
    const next = !deviceParticipatesInRevision(device)
    setBusy(true)
    try {
      await api.updatePosDevice(row.id, device.id, { revisionParticipationDefault: next })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  const leftSec = pair ? Math.max(0, Math.round((Date.parse(pair.expiresAtIso) - Date.now()) / 1000)) : 0

  function liveForDevice(posId: string, deviceId: string): TradeDeviceLiveStatus | undefined {
    return liveDevices.find(d => d.posId === posId && d.deviceId === deviceId)
  }

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 700, maxWidth: 640, lineHeight: 1.45, marginBottom: 16 }}>
        Точка — это касса в магазине. У каждой свой номер.
        Новое устройство (ПК или телефон) не войдёт в Торговлю, пока не введёт код.
        На одну точку можно несколько устройств.
        Галочка «ревизия» — ждать ли это устройство при инвентаризации (если сломано — снимите).
      </div>

      {err && (
        <div className="k-alert" style={{ marginBottom: 12, background: '#2a1420', color: '#FF8A8A' }}>{err}</div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <input className="ai" value={name} onChange={e => setName(e.target.value)} placeholder="Название · Касса у входа" style={{ minWidth: 220 }} />
        <input className="ai" value={code} onChange={e => setCode(e.target.value)} placeholder="Номер · Касса №1" style={{ minWidth: 160 }} />
        <button type="button" className="ab abp" disabled={busy} onClick={() => void addPoint()}>+ Точка</button>
      </div>

      {pair && (
        <div style={{
          marginBottom: 16, padding: 16, borderRadius: 14,
          border: '1px solid rgba(31,215,96,.35)', background: 'rgba(31,215,96,.1)',
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', marginBottom: 6 }}>
            Код для «{pair.name}» · {leftSec} сек
          </div>
          <div style={{ fontSize: 36, fontWeight: 900, letterSpacing: 10 }}>{pair.code}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
            На устройстве откройте Торговлю и введите этот код. Через 5 минут код сгорит.
          </div>
        </div>
      )}

      <div className="ac">
        <table className="at">
          <thead>
            <tr>
              <th>Точка</th>
              <th>Номер</th>
              <th>Устройства</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>Загрузка…</td></tr>
            ) : !rows.length ? (
              <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>Пока нет точек — добавьте первую</td></tr>
            ) : rows.map(row => (
              <tr key={row.id}>
                <td style={{ fontWeight: 800 }}>{row.name}</td>
                <td>{row.code || '—'}</td>
                <td>
                  {(row.devices || []).length === 0 ? (
                    <span style={{ color: 'var(--muted)' }}>нет — вход закрыт</span>
                  ) : (row.devices || []).map(d => {
                    const live = liveForDevice(row.id, d.id)
                    return (
                    <div key={d.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 800 }}>{d.name}</span>
                      {live ? (
                        <span style={{
                          fontSize: 10,
                          fontWeight: 800,
                          color: live.online ? 'var(--green)' : 'var(--muted)',
                        }}>
                          {live.online ? 'онлайн' : 'офлайн'}
                          {live.queueLen ? ` · очередь ${live.queueLen}` : live.queueFlushed ? ' · очередь 0' : ''}
                        </span>
                      ) : null}
                      <label
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 12,
                          color: deviceParticipatesInRevision(d) ? 'var(--green)' : 'var(--muted)',
                          cursor: busy ? 'default' : 'pointer',
                          userSelect: 'none',
                        }}
                        title="Ждать это устройство при ревизии (офлайн-очередь)"
                      >
                        <input
                          type="checkbox"
                          checked={deviceParticipatesInRevision(d)}
                          disabled={busy}
                          onChange={() => void toggleRevisionParticipation(row, d)}
                        />
                        ревизия
                      </label>
                      <button type="button" className="ab" style={{ padding: '2px 8px' }} onClick={() => void renameDevice(row, d)}>
                        имя
                      </button>
                      <button type="button" className="ab" style={{ color: '#FF5A5A', padding: '2px 8px' }} onClick={() => void removeDevice(row, d)}>
                        отвязать
                      </button>
                    </div>
                    )
                  })}
                </td>
                <td>
                  <button type="button" className="ab abp" disabled={busy || row.active === false} onClick={() => void makeCode(row)}>
                    Код для устройства
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
