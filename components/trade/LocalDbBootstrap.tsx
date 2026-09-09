'use client'

import { useEffect, useRef, useState } from 'react'
import {
  isLocalBootstrapComplete,
  pingApiForBootstrap,
  runLocalBootstrap,
  sealEmployeePasswordsForOffline,
  type BootstrapProgress,
  type EmployeePasswordRow,
} from '@/lib/offlineBootstrap'

/**
 * После установки — один раз при первом запуске скачивает данные на ПК.
 * Логин открывается только когда товары + пароли сотрудников уже на диске.
 */
export default function LocalDbBootstrap({
  theme = 'light',
  onDone,
}: {
  theme?: 'dark' | 'light'
  onDone: () => void
}) {
  const [checking, setChecking] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<BootstrapProgress | null>(null)
  const [error, setError] = useState('')
  const [online, setOnline] = useState(true)
  const [passwordStep, setPasswordStep] = useState<EmployeePasswordRow[] | null>(null)
  const [passwords, setPasswords] = useState<Record<string, string>>({})
  const startedRef = useRef(false)

  async function startDownload() {
    setBusy(true)
    setError('')
    setPasswordStep(null)
    const alive = await pingApiForBootstrap(4000)
    setOnline(alive)
    if (!alive) {
      setError('Для первого запуска нужен интернет. Подключите сеть и нажмите «Скачать».')
      setBusy(false)
      return
    }
    const res = await runLocalBootstrap(p => setProgress(p))
    setBusy(false)
    if (res.ok) {
      onDone()
      return
    }
    if (res.needEmployeePasswords?.length) {
      setPasswordStep(res.needEmployeePasswords)
      setPasswords(Object.fromEntries(res.needEmployeePasswords.map(e => [e.id, ''])))
      setError(res.error || '')
      return
    }
    setError(res.error || 'Не удалось загрузить данные')
  }

  async function submitPasswords() {
    if (!passwordStep?.length) return
    setBusy(true)
    setError('')
    const res = await sealEmployeePasswordsForOffline(
      passwordStep.map(e => ({ id: e.id, password: passwords[e.id] || '' })),
    )
    setBusy(false)
    if (!res.ok) {
      setError(res.error || 'Неверный пароль')
      return
    }
    // докачаем клиентов/карты если ещё не успели
    void import('@/lib/offlineBootstrap').then(m => m.silentSyncFromServer()).catch(() => {})
    onDone()
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const done = await isLocalBootstrapComplete()
        if (cancelled) return
        if (done) {
          onDone()
          return
        }
        const alive = await pingApiForBootstrap(4000)
        if (cancelled) return
        setOnline(alive)
        setChecking(false)
        if (alive && !startedRef.current) {
          startedRef.current = true
          void startDownload()
        }
      } catch {
        if (!cancelled) setChecking(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (checking && !busy) {
    return (
      <div className="ldb-wrap" data-theme={theme}>
        <style>{CSS}</style>
        <div className="ldb-card">
          <div className="ldb-badge">Первый запуск</div>
          <div className="ldb-title">Подготовка кассы…</div>
          <div className="ldb-sub">Проверяем локальную базу на этом устройстве</div>
        </div>
      </div>
    )
  }

  const pct = progress
    ? Math.round((progress.done / Math.max(1, progress.total)) * 100)
    : 0

  if (passwordStep?.length) {
    return (
      <div className="ldb-wrap" data-theme={theme}>
        <style>{CSS}</style>
        <div className="ldb-card">
          <div className="ldb-badge">Почти готово</div>
          <h1 className="ldb-title">Сохранить пароли на устройство</h1>
          <p className="ldb-sub">
            Товары уже скачаны. Введите пароли сотрудников — они останутся на этом устройстве.
            Экран входа откроется только после этого.
          </p>
          {error ? <div className="ldb-err">{error}</div> : null}
          {passwordStep.map(e => (
            <div key={e.id} className="ldb-field">
              <div className="ldb-label">
                {e.name}{e.roleLabel ? ` · ${e.roleLabel}` : ''}
              </div>
              <input
                type="password"
                value={passwords[e.id] || ''}
                onChange={ev => setPasswords(p => ({ ...p, [e.id]: ev.target.value }))}
                placeholder="Пароль"
                autoComplete="current-password"
                disabled={busy}
              />
            </div>
          ))}
          <button
            type="button"
            className="ldb-btn"
            disabled={busy}
            onClick={() => void submitPasswords()}
          >
            {busy ? 'Проверка…' : 'Сохранить и открыть вход'}
          </button>
          <button
            type="button"
            className="ldb-btn ldb-btn-sec"
            disabled={busy}
            onClick={() => void startDownload()}
            style={{ marginTop: 10 }}
          >
            Снова скачать с сервера
          </button>
          <p className="ldb-hint">
            Если на сервере уже включена выдача паролей — нажмите «Снова скачать с сервера»,
            вводить вручную не нужно.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="ldb-wrap" data-theme={theme}>
      <style>{CSS}</style>
      <div className="ldb-card">
        <div className="ldb-badge">Первый запуск · один раз</div>
        <h1 className="ldb-title">Скачать данные на устройство</h1>
        <p className="ldb-sub">
          Сейчас один раз загрузим товары, цены, остатки, клиентов и сотрудников.
          Окно входа откроется <b>только после</b> полной загрузки. Потом касса работает без интернета.
        </p>

        {!online && (
          <div className="ldb-warn">
            Подключите интернет только для этой первой загрузки. Потом интернет не обязателен.
          </div>
        )}

        {error ? <div className="ldb-err">{error}</div> : null}

        {(busy || progress) && (
          <div className="ldb-prog">
            <div className="ldb-prog-label">{progress?.label || 'Загрузка…'}</div>
            <div className="ldb-bar">
              <div className="ldb-bar-fill" style={{ width: `${Math.max(pct, busy ? 8 : 0)}%` }} />
            </div>
            <div className="ldb-prog-meta">
              {progress ? `${progress.done} / ${progress.total} · ${pct}%` : 'Подключение к серверу…'}
            </div>
          </div>
        )}

        {!busy && (
          <button
            type="button"
            className="ldb-btn"
            onClick={() => void startDownload()}
          >
            {error ? 'Повторить загрузку' : 'Скачать'}
          </button>
        )}

        <p className="ldb-hint">
          После загрузки при каждом запуске интернет не нужен — данные уже на устройстве.
        </p>
      </div>
    </div>
  )
}

const CSS = `
.ldb-wrap{
  min-height:100vh;display:flex;align-items:center;justify-content:center;
  padding:24px;background:var(--bg,#F3F7F4);color:var(--text,#0C1A10);
  font-family:'Nunito',system-ui,sans-serif;
}
.ldb-wrap[data-theme="dark"]{--bg:#070C09;--text:#EBF5ED;--card:#0F1A14;--muted:#8AA094;--border:#1E2E26;--green:#1FD760;--err:#FF6B6B;--warn:#E8A317;}
.ldb-wrap[data-theme="light"]{--bg:#F3F7F4;--text:#0C1A10;--card:#FFFFFF;--muted:#5A6B60;--border:#D5E0D8;--green:#129B45;--err:#DC2626;--warn:#B45309;}
.ldb-card{
  width:min(460px,100%);background:var(--card);border:1.5px solid var(--border);
  border-radius:20px;padding:28px 26px 24px;box-shadow:0 18px 40px rgba(12,26,16,.1);
}
.ldb-badge{
  display:inline-block;font-size:11px;font-weight:800;letter-spacing:.4px;
  color:var(--green);background:rgba(31,215,96,.12);border:1px solid rgba(31,215,96,.28);
  padding:4px 10px;border-radius:999px;margin-bottom:14px;
}
.ldb-title{font-size:22px;font-weight:900;margin:0 0 10px;line-height:1.25;}
.ldb-sub{font-size:13.5px;line-height:1.5;color:var(--muted);margin:0 0 18px;}
.ldb-sub b{color:var(--text);}
.ldb-warn,.ldb-err{
  font-size:13px;font-weight:700;padding:10px 12px;border-radius:12px;margin-bottom:14px;
}
.ldb-warn{background:rgba(232,163,23,.12);color:var(--warn);border:1px solid rgba(232,163,23,.3);}
.ldb-err{background:rgba(220,38,38,.1);color:var(--err);border:1px solid rgba(220,38,38,.25);}
.ldb-prog{margin-bottom:16px;}
.ldb-prog-label{font-size:13px;font-weight:800;margin-bottom:8px;}
.ldb-bar{height:10px;border-radius:999px;background:var(--border);overflow:hidden;}
.ldb-bar-fill{height:100%;background:linear-gradient(90deg,var(--green),#14b24f);transition:width .25s ease;}
.ldb-prog-meta{font-size:11px;color:var(--muted);margin-top:6px;font-weight:700;}
.ldb-field{margin-bottom:12px;}
.ldb-label{font-size:12px;font-weight:800;color:var(--muted);margin-bottom:6px;}
.ldb-field input{
  width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;
  border:1.5px solid var(--border);background:var(--bg);color:var(--text);
  font-size:15px;font-weight:700;font-family:inherit;outline:none;
}
.ldb-field input:focus{border-color:var(--green);}
.ldb-btn{
  width:100%;padding:14px 16px;border-radius:14px;border:none;cursor:pointer;
  background:linear-gradient(135deg,#1FD760,#14b24f);color:#05210D;
  font-size:15px;font-weight:900;font-family:inherit;margin-top:4px;
}
.ldb-btn:disabled{opacity:.55;cursor:default;}
.ldb-btn-sec{
  background:transparent!important;color:var(--text)!important;
  border:1.5px solid var(--border)!important;
}
.ldb-hint{font-size:11.5px;color:var(--muted);margin:14px 0 0;line-height:1.4;text-align:center;}
`
