'use client'

import { useEffect, useState } from 'react'
import { api, isNetworkError } from '@/lib/api'
import { isOnline } from '@/lib/offline'
import {
  defaultDeviceName,
  ensureTradeDeviceReady,
  getTradeDeviceBindSync,
  getTradeDeviceIdSync,
  saveTradeDeviceBind,
} from '@/lib/tradeDevice'

export default function TradeDeviceGate({
  theme = 'light',
  onReady,
}: {
  theme?: 'dark' | 'light'
  onReady: () => void
}) {
  const [checking, setChecking] = useState(true)
  const [code, setCode] = useState('')
  const [deviceName, setDeviceName] = useState(defaultDeviceName)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [needCode, setNeedCode] = useState(false)

  async function acceptIfBound(): Promise<boolean> {
    await ensureTradeDeviceReady()
    const deviceId = getTradeDeviceIdSync()
    const local = getTradeDeviceBindSync()

    if (local?.posId && local.deviceId === deviceId) {
      onReady()
      if (isOnline()) {
        void api.checkPosDevice(deviceId).then(async check => {
          if (check.ok && check.point) {
            await saveTradeDeviceBind({
              deviceId,
              deviceName: check.device?.name || local.deviceName || defaultDeviceName(),
              posId: check.point.id,
              posName: check.point.name,
              boundAtIso: local.boundAtIso || new Date().toISOString(),
            })
          }
        }).catch(() => {})
      }
      return true
    }

    if (!isOnline()) {
      setErr('Нет доступа. Это устройство не привязано. Нужен интернет и код из Админки.')
      setNeedCode(true)
      return false
    }

    try {
      const check = await api.checkPosDevice(deviceId)
      if (check.ok && check.point) {
        await saveTradeDeviceBind({
          deviceId,
          deviceName: check.device?.name || defaultDeviceName(),
          posId: check.point.id,
          posName: check.point.name,
          boundAtIso: new Date().toISOString(),
        })
        onReady()
        return true
      }
      setNeedCode(true)
      setErr('Нет доступа. Это устройство не привязано к точке. Введите код из Админки.')
      return false
    } catch (e) {
      if (isNetworkError(e) && local?.posId) {
        onReady()
        return true
      }
      setErr(e instanceof Error ? e.message : 'Не удалось проверить устройство')
      setNeedCode(true)
      return false
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await acceptIfBound()
      if (!cancelled) setChecking(false)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function submit() {
    setBusy(true)
    setErr('')
    try {
      const name = deviceName.trim()
      if (name.length < 2) {
        setErr('Укажите имя устройства, например «ПК вход» или «Телефон склада»')
        setBusy(false)
        return
      }
      await ensureTradeDeviceReady()
      const deviceId = getTradeDeviceIdSync()
      const res = await api.bindPosDevice({
        code,
        deviceId,
        deviceName: name,
      })
      await saveTradeDeviceBind({
        deviceId,
        deviceName: res.device?.name || name,
        posId: res.point.id,
        posName: res.point.name,
        boundAtIso: new Date().toISOString(),
      })
      onReady()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Код не принят')
    } finally {
      setBusy(false)
    }
  }

  if (checking && !needCode) {
    return (
      <div className="tdg-wrap" data-theme={theme}>
        <style>{CSS}</style>
        <div className="tdg-card">
          <div className="tdg-badge">Торговля</div>
          <div className="tdg-title">Проверка устройства…</div>
        </div>
      </div>
    )
  }

  return (
    <div className="tdg-wrap" data-theme={theme}>
      <style>{CSS}</style>
      <div className="tdg-card">
        <div className="tdg-badge">Нет доступа</div>
        <h1 className="tdg-title">Устройство не привязано</h1>
        <p className="tdg-sub">
          В админке откройте точку кассы и нажмите «Код для устройства».
          Имя устройства должно быть своё: «ПК вход», «Телефон склада» — тогда на одной точке они не путаются.
        </p>
        {err ? <div className="tdg-err">{err}</div> : null}
        <div className="tdg-label">Имя этого устройства</div>
        <input
          value={deviceName}
          onChange={e => setDeviceName(e.target.value)}
          placeholder="ПК вход"
          disabled={busy}
          style={{ letterSpacing: 0, textAlign: 'left', fontSize: 16 }}
        />
        <div className="tdg-label">Код из админки</div>
        <input
          inputMode="numeric"
          maxLength={4}
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="4821"
          disabled={busy}
        />
        <button type="button" className="tdg-btn" disabled={busy || code.length !== 4} onClick={() => void submit()}>
          {busy ? 'Проверка…' : 'Привязать и войти'}
        </button>
      </div>
    </div>
  )
}

const CSS = `
.tdg-wrap{
  min-height:100vh;display:flex;align-items:center;justify-content:center;
  padding:24px;background:var(--bg,#F3F7F4);color:var(--text,#0C1A10);
  font-family:'Nunito',system-ui,sans-serif;
}
.tdg-wrap[data-theme="dark"]{--bg:#070C09;--text:#EBF5ED;--card:#0F1A14;--muted:#8AA094;--border:#1E2E26;--green:#1FD760;--err:#FF6B6B;}
.tdg-wrap[data-theme="light"]{--bg:#F3F7F4;--text:#0C1A10;--card:#FFFFFF;--muted:#5A6B60;--border:#D5E0D8;--green:#129B45;--err:#DC2626;}
.tdg-card{
  width:min(420px,100%);background:var(--card);border:1.5px solid var(--border);
  border-radius:20px;padding:28px 26px 24px;
}
.tdg-badge{
  display:inline-block;font-size:11px;font-weight:800;letter-spacing:.4px;
  color:var(--green);background:rgba(31,215,96,.12);border:1px solid rgba(31,215,96,.28);
  padding:4px 10px;border-radius:999px;margin-bottom:14px;
}
.tdg-title{font-size:22px;font-weight:900;margin:0 0 10px;line-height:1.25;}
.tdg-sub{font-size:13.5px;line-height:1.5;color:var(--muted);margin:0 0 18px;}
.tdg-err{
  font-size:13px;font-weight:700;padding:10px 12px;border-radius:12px;margin-bottom:14px;
  background:rgba(220,38,38,.1);color:var(--err);border:1px solid rgba(220,38,38,.25);
}
.tdg-label{font-size:12px;font-weight:800;color:var(--muted);margin-bottom:6px;}
.tdg-card input{
  width:100%;box-sizing:border-box;padding:14px;border-radius:12px;letter-spacing:8px;text-align:center;
  border:1.5px solid var(--border);background:var(--bg);color:var(--text);
  font-size:22px;font-weight:900;font-family:inherit;outline:none;margin-bottom:14px;
}
.tdg-btn{
  width:100%;padding:14px;border-radius:14px;border:none;cursor:pointer;
  background:linear-gradient(135deg,#1FD760,#14b24f);color:#05210D;
  font-size:15px;font-weight:900;font-family:inherit;
}
.tdg-btn:disabled{opacity:.55;cursor:default;}
`
