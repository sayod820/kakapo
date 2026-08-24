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
  const [now, setNow] = useState(() => Date.now())
  const [showAdd, setShowAdd] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (!USE_API) {
      setErr('Нужен API')
      setLoading(false)
      return
    }
    if (!silent) setLoading(true)
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
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const t = window.setInterval(() => { void load(true) }, 20000)
    return () => window.clearInterval(t)
  }, [load])

  useEffect(() => {
    if (!pair) return
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [pair])

  async function addPoint() {
    const n = name.trim()
    if (!n) return
    setBusy(true)
    try {
      await api.createPosPoint({ name: n, code: code.trim() || undefined })
      setName('')
      setCode('')
      setShowAdd(false)
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
    const nextName = next.trim()
    if (!nextName) return
    try {
      await api.renamePosDevice(row.id, device.id, nextName)
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
      await load(true)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  const leftSec = pair ? Math.max(0, Math.round((Date.parse(pair.expiresAtIso) - now) / 1000)) : 0

  useEffect(() => {
    if (pair && leftSec <= 0) setPair(null)
  }, [pair, leftSec])

  function liveForDevice(posId: string, deviceId: string): TradeDeviceLiveStatus | undefined {
    return liveDevices.find(d => d.posId === posId && d.deviceId === deviceId)
  }

  const deviceCount = rows.reduce((n, r) => n + (r.devices?.length || 0), 0)

  return (
    <div className="pos-admin">
      <style>{`
        .pos-admin{display:flex;flex-direction:column;gap:12px;max-width:820px;}
        .pos-admin-hint{font-size:12px;color:var(--muted);line-height:1.4;font-weight:600;}
        .pos-admin-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}
        .pos-admin-stats{display:flex;gap:8px;flex-wrap:wrap;}
        .pos-admin-pill{font-size:11px;font-weight:800;padding:5px 10px;border-radius:999px;background:var(--l3);border:1px solid var(--b1);color:var(--t2);}
        .pos-admin-add{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 12px;border-radius:12px;background:var(--l2);border:1px solid var(--b1);}
        .pos-admin-add .ai{flex:1;min-width:140px;width:auto;}
        .pos-pair{padding:14px 16px;border-radius:14px;border:1px solid rgba(31,215,96,.35);background:rgba(31,215,96,.1);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}
        .pos-pair-code{font-size:34px;font-weight:900;letter-spacing:8px;line-height:1;font-variant-numeric:tabular-nums;}
        .pos-pair-meta{font-size:12px;color:var(--muted);font-weight:700;}
        .pos-card{background:var(--l2);border:1px solid var(--b1);border-radius:14px;overflow:hidden;}
        .pos-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-bottom:1px solid var(--b1);flex-wrap:wrap;}
        .pos-card-title{display:flex;flex-direction:column;gap:2px;min-width:0;}
        .pos-card-title strong{font-size:14px;font-weight:900;color:var(--t1);}
        .pos-card-title span{font-size:12px;font-weight:700;color:var(--muted);}
        .pos-dev{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px 10px;align-items:center;padding:9px 14px;border-bottom:1px solid color-mix(in srgb, var(--b1) 45%, transparent);}
        .pos-dev:last-child{border-bottom:none;}
        .pos-dev-main{display:flex;align-items:center;gap:8px;min-width:0;}
        .pos-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
        .pos-dot.on{background:var(--green);box-shadow:0 0 0 3px rgba(31,215,96,.18);}
        .pos-dot.off{background:var(--muted);opacity:.55;}
        .pos-dev-name{font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .pos-dev-meta{font-size:11px;font-weight:700;color:var(--muted);white-space:nowrap;}
        .pos-rev{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:800;cursor:pointer;user-select:none;padding:4px 8px;border-radius:8px;border:1px solid var(--b1);background:var(--l3);color:var(--muted);white-space:nowrap;}
        .pos-rev.on{color:var(--green);border-color:rgba(31,215,96,.35);background:rgba(31,215,96,.1);}
        .pos-rev input{margin:0;accent-color:var(--green);}
        .pos-dev-acts{display:flex;gap:4px;}
        .pos-dev-acts .ab{padding:4px 8px;font-size:11px;min-height:0;background:var(--l3);color:var(--t2);border:1px solid var(--b1);}
        .pos-dev-acts .ab.danger{color:#FF5A5A;border-color:rgba(255,90,90,.25);background:rgba(255,90,90,.06);}
        .pos-empty{padding:14px;font-size:12px;font-weight:700;color:var(--muted);}
        @media (max-width:640px){
          .pos-dev{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"main acts" "rev acts";}
          .pos-dev-main{grid-area:main;}
          .pos-rev{grid-area:rev;justify-self:start;}
          .pos-dev-acts{grid-area:acts;align-self:center;}
        }
      `}</style>

      <div className="pos-admin-hint">
        Точка = касса в магазине. Устройство входит в Торговлю по коду (5 мин).
        Галочка «Ревизия» — ждать это устройство при инвентаризации.
      </div>

      <div className="pos-admin-toolbar">
        <div className="pos-admin-stats">
          <span className="pos-admin-pill">{rows.length} точек</span>
          <span className="pos-admin-pill">{deviceCount} устройств</span>
        </div>
        <button
          type="button"
          className="ab abp"
          disabled={busy}
          onClick={() => setShowAdd(v => !v)}
        >
          {showAdd ? 'Скрыть' : '+ Точка'}
        </button>
      </div>

      {showAdd && (
        <div className="pos-admin-add">
          <input
            className="ai"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Название · Касса у входа"
            onKeyDown={e => { if (e.key === 'Enter') void addPoint() }}
          />
          <input
            className="ai"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="Номер · Касса №1"
            onKeyDown={e => { if (e.key === 'Enter') void addPoint() }}
          />
          <button type="button" className="ab abp" disabled={busy || !name.trim()} onClick={() => void addPoint()}>
            Создать
          </button>
        </div>
      )}

      {err && (
        <div className="k-alert" style={{ background: '#2a1420', color: '#FF8A8A' }}>{err}</div>
      )}

      {pair && (
        <div className="pos-pair">
          <div>
            <div className="pos-pair-meta">Код для «{pair.name}» · ещё {leftSec} сек</div>
            <div className="pos-pair-code">{pair.code}</div>
            <div className="pos-pair-meta" style={{ marginTop: 4 }}>В Торговле введите этот код на новом устройстве</div>
          </div>
          <button type="button" className="ab" style={{ background: 'var(--l3)', color: 'var(--t2)', border: '1px solid var(--b1)' }} onClick={() => setPair(null)}>
            Закрыть
          </button>
        </div>
      )}

      {loading ? (
        <div className="pos-empty">Загрузка…</div>
      ) : !rows.length ? (
        <div className="pos-card">
          <div className="pos-empty">Пока нет точек — нажмите «+ Точка»</div>
        </div>
      ) : rows.map(row => {
        const devices = row.devices || []
        const onlineN = devices.filter(d => liveForDevice(row.id, d.id)?.online).length
        return (
          <div className="pos-card" key={row.id}>
            <div className="pos-card-head">
              <div className="pos-card-title">
                <strong>{row.name}</strong>
                <span>
                  {row.code || 'без номера'}
                  {devices.length
                    ? ` · ${devices.length} устр.${onlineN ? ` · ${onlineN} онлайн` : ''}`
                    : ' · устройств нет'}
                </span>
              </div>
              <button
                type="button"
                className="ab abp"
                disabled={busy || row.active === false}
                onClick={() => void makeCode(row)}
                style={{ padding: '7px 12px', fontSize: 12 }}
              >
                Код для устройства
              </button>
            </div>

            {!devices.length ? (
              <div className="pos-empty">Нет привязанных устройств — вход закрыт, пока не введут код</div>
            ) : devices.map(d => {
              const live = liveForDevice(row.id, d.id)
              const online = !!live?.online
              const inRev = deviceParticipatesInRevision(d)
              const queueTxt = live
                ? (live.queueLen ? `очередь ${live.queueLen}` : live.queueFlushed ? 'очередь 0' : '')
                : ''
              return (
                <div className="pos-dev" key={d.id}>
                  <div className="pos-dev-main">
                    <span className={`pos-dot ${online ? 'on' : 'off'}`} title={online ? 'онлайн' : 'офлайн'} />
                    <div style={{ minWidth: 0 }}>
                      <div className="pos-dev-name">{d.name}</div>
                      <div className="pos-dev-meta">
                        {online ? 'онлайн' : 'офлайн'}
                        {queueTxt ? ` · ${queueTxt}` : ''}
                      </div>
                    </div>
                  </div>

                  <label
                    className={`pos-rev ${inRev ? 'on' : ''}`}
                    title="Ждать это устройство при ревизии"
                  >
                    <input
                      type="checkbox"
                      checked={inRev}
                      disabled={busy}
                      onChange={() => void toggleRevisionParticipation(row, d)}
                    />
                    Ревизия
                  </label>

                  <div className="pos-dev-acts">
                    <button type="button" className="ab" onClick={() => void renameDevice(row, d)}>Имя</button>
                    <button type="button" className="ab danger" onClick={() => void removeDevice(row, d)}>Отвязать</button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
