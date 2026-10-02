'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import type { PosBoundDevice, PosPoint, TradeDeviceLiveStatus } from '@/lib/types'

/** По умолчанию устройство участвует в ожидании ревизии */
function deviceParticipatesInRevision(device: PosBoundDevice): boolean {
  return device.revisionParticipationDefault !== false
}

const PAIR_TTL_SEC = 300
const STALE_MS = 7 * 24 * 3600 * 1000

function seenAgo(iso: string | undefined, now: number): string {
  const t = Date.parse(String(iso || ''))
  if (!Number.isFinite(t)) return 'не заходило'
  const min = Math.max(0, Math.round((now - t) / 60000))
  if (min < 1) return 'был только что'
  if (min < 60) return `был ${min} мин назад`
  const h = Math.round(min / 60)
  if (h < 24) return `был ${h} ч назад`
  const d = Math.round(h / 24)
  return `был ${d} дн назад`
}

export default function PosPointsAdminPage() {
  const [rows, setRows] = useState<PosPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [pairBusyId, setPairBusyId] = useState<string | null>(null)
  const [pairErr, setPairErr] = useState<{ posId: string; msg: string } | null>(null)
  const [pair, setPair] = useState<{ posId: string; name: string; code: string; expiresAtIso: string; gotAtMs: number } | null>(null)
  const [liveDevices, setLiveDevices] = useState<TradeDeviceLiveStatus[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [showAdd, setShowAdd] = useState(false)
  const [showStale, setShowStale] = useState(false)

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
      setNow(Date.now())
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
      const { newClientRef } = await import('@/lib/offline')
      await api.createPosPoint({ name: n, code: code.trim() || undefined, clientRef: newClientRef() })
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
    setPairBusyId(row.id)
    setPairErr(null)
    try {
      const res = await api.createPosPairCode(row.id)
      setPair({ ...res, gotAtMs: Date.now() })
    } catch (e) {
      setPairErr({ posId: row.id, msg: e instanceof Error ? e.message : 'Не удалось получить код' })
    } finally {
      setPairBusyId(null)
    }
  }

  async function copyCode() {
    if (!pair) return
    try { await navigator.clipboard.writeText(pair.code) } catch { /* ignore */ }
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

  // Countdown from receipt time (not the server's expiresAtIso) so a skewed PC clock cannot hide the code
  const leftSec = pair ? Math.max(0, PAIR_TTL_SEC - Math.floor((now - pair.gotAtMs) / 1000)) : 0

  useEffect(() => {
    if (pair && leftSec <= 0) setPair(null)
  }, [pair, leftSec])

  function liveForDevice(posId: string, deviceId: string): TradeDeviceLiveStatus | undefined {
    return liveDevices.find(d => d.posId === posId && d.deviceId === deviceId)
  }

  const deviceCount = rows.reduce((n, r) => n + (r.devices?.length || 0), 0)
  const onlineTotal = rows.reduce(
    (n, r) => n + (r.devices || []).filter(d => liveForDevice(r.id, d.id)?.online).length,
    0,
  )

  return (
    <div className="pos-admin">
      <style>{`
        .pos-admin{display:flex;flex-direction:column;gap:14px;max-width:860px;}
        .pos-admin-hint{font-size:12px;color:var(--muted);line-height:1.45;font-weight:600;}
        .pos-admin-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}
        .pos-admin-stats{display:flex;gap:8px;flex-wrap:wrap;}
        .pos-admin-pill{font-size:11px;font-weight:800;padding:5px 11px;border-radius:999px;background:var(--l3);border:1px solid var(--b1);color:var(--t2);}
        .pos-admin-pill.on{color:#16a34a;border-color:rgba(31,215,96,.35);background:rgba(31,215,96,.1);}
        .pos-admin-add{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:12px;border-radius:12px;background:var(--l2);border:1px solid var(--b1);}
        .pos-admin-add .ai{flex:1;min-width:160px;width:auto;}
        .pos-err{padding:10px 12px;border-radius:10px;font-size:12px;font-weight:700;color:#d33;background:rgba(255,90,90,.08);border:1px solid rgba(255,90,90,.25);}
        .pos-card{background:var(--l2);border:1px solid var(--b1);border-radius:16px;overflow:hidden;}
        .pos-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid var(--b1);flex-wrap:wrap;}
        .pos-card-title{display:flex;flex-direction:column;gap:3px;min-width:0;}
        .pos-card-title strong{font-size:15px;font-weight:900;color:var(--t1);}
        .pos-card-title span{font-size:12px;font-weight:700;color:var(--muted);}
        .pos-pair{margin:12px 16px 4px;padding:16px;border-radius:14px;border:1px solid rgba(31,215,96,.4);background:rgba(31,215,96,.08);display:flex;align-items:center;gap:18px;flex-wrap:wrap;}
        .pos-pair-code{font-size:44px;font-weight:900;letter-spacing:12px;line-height:1;font-variant-numeric:tabular-nums;color:var(--t1);padding-left:12px;}
        .pos-pair-info{flex:1;min-width:180px;display:flex;flex-direction:column;gap:6px;}
        .pos-pair-meta{font-size:12px;color:var(--muted);font-weight:700;line-height:1.4;}
        .pos-pair-bar{height:5px;border-radius:999px;background:rgba(31,215,96,.18);overflow:hidden;}
        .pos-pair-bar i{display:block;height:100%;background:#1FD760;transition:width 1s linear;}
        .pos-pair-acts{display:flex;gap:6px;flex-wrap:wrap;}
        .pos-sec{padding:8px 16px 4px;font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;}
        .pos-dev{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px 12px;align-items:center;padding:10px 16px;border-top:1px solid color-mix(in srgb, var(--b1) 45%, transparent);}
        .pos-dev.stale{opacity:.6;}
        .pos-dev-main{display:flex;align-items:center;gap:10px;min-width:0;}
        .pos-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;}
        .pos-dot.on{background:#1FD760;box-shadow:0 0 0 3px rgba(31,215,96,.25);}
        .pos-dot.off{background:#9aa3ab;opacity:.6;}
        .pos-dev-name{font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--t1);}
        .pos-dev-meta{font-size:11px;font-weight:700;color:var(--muted);white-space:nowrap;display:flex;gap:6px;align-items:center;}
        .pos-dev-meta.on{color:#16a34a;}
        .pos-q{font-size:10px;font-weight:800;padding:1px 7px;border-radius:999px;background:rgba(255,170,0,.14);color:#b77900;border:1px solid rgba(255,170,0,.35);}
        .pos-rev{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800;cursor:pointer;user-select:none;padding:5px 10px;border-radius:999px;border:1px solid var(--b1);background:var(--l3);color:var(--muted);white-space:nowrap;}
        .pos-rev.on{color:#16a34a;border-color:rgba(31,215,96,.35);background:rgba(31,215,96,.1);}
        .pos-rev input{margin:0;accent-color:#1FD760;}
        .pos-dev-acts{display:flex;gap:6px;}
        .pos-dev-acts .ab,.pos-pair-acts .ab,.pos-more{padding:5px 10px;font-size:11px;min-height:0;background:var(--l3);color:var(--t2);border:1px solid var(--b1);border-radius:8px;}
        .pos-dev-acts .ab.danger{color:#e04848;border-color:rgba(255,90,90,.25);background:rgba(255,90,90,.06);}
        .pos-more{margin:8px 16px 12px;cursor:pointer;font-weight:800;}
        .pos-empty{padding:16px;font-size:12px;font-weight:700;color:var(--muted);}
        @media (max-width:640px){
          .pos-dev{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"main acts" "rev acts";}
          .pos-dev-main{grid-area:main;}
          .pos-rev{grid-area:rev;justify-self:start;}
          .pos-dev-acts{grid-area:acts;align-self:center;flex-direction:column;}
          .pos-pair-code{font-size:36px;letter-spacing:9px;}
        }
      `}</style>

      <div className="pos-admin-hint">
        Точка = касса в магазине. Новое устройство входит в Торговлю по 4-значному коду (действует 5 минут).
        Галочка «Ревизия» — ждать это устройство при инвентаризации.
      </div>

      <div className="pos-admin-toolbar">
        <div className="pos-admin-stats">
          <span className="pos-admin-pill">{rows.length} точек</span>
          <span className="pos-admin-pill">{deviceCount} устройств</span>
          <span className={`pos-admin-pill ${onlineTotal ? 'on' : ''}`}>{onlineTotal} онлайн</span>
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

      {err && <div className="pos-err">{err}</div>}

      {loading ? (
        <div className="pos-empty">Загрузка…</div>
      ) : !rows.length ? (
        <div className="pos-card">
          <div className="pos-empty">Пока нет точек — нажмите «+ Точка»</div>
        </div>
      ) : rows.map(row => {
        const devices = (row.devices || []).map(d => {
          const live = liveForDevice(row.id, d.id)
          const seenIso = live?.lastHeartbeatAtIso || d.lastSeenAtIso
          const seenMs = Date.parse(String(seenIso || '')) || 0
          return { d, live, online: !!live?.online, seenIso, seenMs }
        }).sort((a, b) => Number(b.online) - Number(a.online) || b.seenMs - a.seenMs)
        const active = devices.filter(x => x.online || (x.seenMs && now - x.seenMs < STALE_MS))
        const stale = devices.filter(x => !active.includes(x))
        const onlineN = devices.filter(x => x.online).length
        const pairHere = pair && pair.posId === row.id ? pair : null
        const pairLoading = pairBusyId === row.id

        const renderDevice = (x: typeof devices[number]) => {
          const { d, live, online, seenIso } = x
          const inRev = deviceParticipatesInRevision(d)
          const queueLen = Number(live?.queueLen) || 0
          return (
            <div className={`pos-dev ${stale.includes(x) ? 'stale' : ''}`} key={d.id}>
              <div className="pos-dev-main">
                <span className={`pos-dot ${online ? 'on' : 'off'}`} title={online ? 'онлайн' : 'офлайн'} />
                <div style={{ minWidth: 0 }}>
                  <div className="pos-dev-name">{d.name}</div>
                  <div className={`pos-dev-meta ${online ? 'on' : ''}`}>
                    {online ? 'онлайн' : seenAgo(seenIso, now)}
                    {queueLen > 0 && <span className="pos-q" title="Неотправленные операции на устройстве">очередь {queueLen}</span>}
                  </div>
                </div>
              </div>

              <label className={`pos-rev ${inRev ? 'on' : ''}`} title="Ждать это устройство при ревизии">
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
        }

        return (
          <div className="pos-card" key={row.id}>
            <div className="pos-card-head">
              <div className="pos-card-title">
                <strong>{row.name}</strong>
                <span>
                  {row.code || 'без номера'}
                  {devices.length
                    ? ` · ${devices.length} устр. · ${onlineN} онлайн`
                    : ' · устройств нет'}
                </span>
              </div>
              <button
                type="button"
                className="ab abp"
                disabled={!!pairBusyId || row.active === false}
                onClick={() => void makeCode(row)}
                style={{ padding: '8px 14px', fontSize: 12 }}
              >
                {pairLoading ? 'Получаем код…' : pairHere ? 'Новый код' : 'Код для устройства'}
              </button>
            </div>

            {pairErr?.posId === row.id && !pairLoading && (
              <div className="pos-err" style={{ margin: '12px 16px 0' }}>Код не получен: {pairErr.msg}. Нажмите ещё раз.</div>
            )}

            {pairHere && (
              <div className="pos-pair">
                <div className="pos-pair-code">{pairHere.code}</div>
                <div className="pos-pair-info">
                  <div className="pos-pair-meta">
                    На новом устройстве откройте Торговлю и введите этот код.
                    Действует ещё {Math.floor(leftSec / 60)}:{String(leftSec % 60).padStart(2, '0')}
                  </div>
                  <div className="pos-pair-bar"><i style={{ width: `${(leftSec / PAIR_TTL_SEC) * 100}%` }} /></div>
                  <div className="pos-pair-acts">
                    <button type="button" className="ab" onClick={() => void copyCode()}>Копировать</button>
                    <button type="button" className="ab" onClick={() => setPair(null)}>Скрыть</button>
                  </div>
                </div>
              </div>
            )}

            {!devices.length ? (
              <div className="pos-empty">Нет привязанных устройств — вход закрыт, пока не введут код</div>
            ) : (
              <>
                {active.length > 0 && <div className="pos-sec">Устройства</div>}
                {active.map(renderDevice)}
                {stale.length > 0 && (
                  <>
                    <button type="button" className="pos-more" onClick={() => setShowStale(v => !v)}>
                      {showStale ? 'Скрыть' : 'Показать'} давно не заходившие ({stale.length})
                    </button>
                    {showStale && stale.map(renderDevice)}
                  </>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
