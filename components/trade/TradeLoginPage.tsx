'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import type { TradeEmployeeSession } from '@/lib/employeeSession'

type DirectoryRow = { id: string; name: string; role: string; roleLabel?: string }
type TradeTheme = 'dark' | 'light'

export default function TradeLoginPage({
  onSuccess,
  theme = 'dark',
  onThemeChange,
}: {
  onSuccess: (session: TradeEmployeeSession) => void
  theme?: TradeTheme
  onThemeChange?: (theme: TradeTheme) => void
}) {
  const [directory, setDirectory] = useState<DirectoryRow[]>([])
  const [employeeId, setEmployeeId] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [loadingDir, setLoadingDir] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!USE_API) {
        setErr('Нужен API')
        setLoadingDir(false)
        return
      }
      try {
        const rows = await api.getEmployeesDirectory()
        if (cancelled) return
        setDirectory(rows)
        if (rows.length === 1) setEmployeeId(rows[0].id)
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Не удалось загрузить сотрудников')
      } finally {
        if (!cancelled) setLoadingDir(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    setErr('')
    if (!employeeId) {
      setErr('Выберите сотрудника')
      return
    }
    if (password.trim().length < 4) {
      setErr('Введите пароль')
      return
    }
    setBusy(true)
    try {
      const row = await api.loginEmployee({ id: employeeId, password: password.trim() })
      onSuccess({
        employeeId: row.id,
        name: row.name,
        role: row.role,
        permissions: (row.permissions || []) as TradeEmployeeSession['permissions'],
      })
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Неверный пароль')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tl-wrap">
      <style>{`
        .tl-wrap{
          min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;
          background:var(--bg);position:relative;
        }
        .tl-wrap::before{
          content:'';position:absolute;inset:0;pointer-events:none;opacity:.45;
          background:
            radial-gradient(circle at 18% 18%, rgba(31,215,96,.14), transparent 42%),
            radial-gradient(circle at 82% 78%, rgba(31,215,96,.06), transparent 45%);
        }
        .k-trade[data-theme="light"] .tl-wrap::before{
          opacity:.35;
          background:
            radial-gradient(circle at 18% 18%, rgba(18,155,69,.16), transparent 42%),
            radial-gradient(circle at 82% 78%, rgba(18,155,69,.07), transparent 45%);
        }
        .tl-theme{
          position:absolute;top:18px;right:18px;z-index:2;
          display:flex;align-items:center;gap:2px;padding:3px;border-radius:12px;
          background:var(--card2);border:1.5px solid var(--border);
        }
        .tl-theme button{
          width:34px;height:30px;border-radius:9px;border:none;background:transparent;
          color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;
        }
        .tl-theme button.on{
          background:var(--card);color:var(--green);box-shadow:0 1px 4px rgba(0,0,0,.12);
        }
        .k-trade[data-theme="light"] .tl-theme button.on{box-shadow:0 1px 4px rgba(12,26,16,.12)}
        .tl-card{
          position:relative;z-index:1;width:100%;max-width:400px;
          background:var(--card);border:1px solid var(--border);border-radius:22px;padding:28px 24px;
          box-shadow:0 18px 40px rgba(0,0,0,.28);
        }
        .k-trade[data-theme="light"] .tl-card{box-shadow:0 18px 40px rgba(12,26,16,.12)}
        .tl-logo{
          width:50px;height:50px;border-radius:16px;margin:0 auto 14px;
          background:linear-gradient(135deg,#1FD760,#12a548);
          display:flex;align-items:center;justify-content:center;font-size:22px;
          box-shadow:0 6px 16px rgba(31,215,96,.28);
        }
        .tl-card h1{margin:0 0 6px;font-size:20px;font-weight:900;text-align:center;color:var(--text)}
        .tl-card .sub{color:var(--muted);font-size:13px;margin-bottom:18px;line-height:1.45;font-weight:700;text-align:center}
        .tl-label{font-size:12px;color:var(--muted);font-weight:800;margin-bottom:6px}
        .tl-card select,.tl-card input{
          width:100%;background:var(--panel);border:1.5px solid var(--border);border-radius:12px;
          color:var(--text);padding:12px 14px;font-size:15px;font-weight:700;margin-bottom:12px;outline:none;
        }
        .k-trade[data-theme="light"] .tl-card select,
        .k-trade[data-theme="light"] .tl-card input{background:var(--card2)}
        .tl-card select:focus,.tl-card input:focus{border-color:var(--green)}
        .tl-err{
          background:rgba(255,90,90,.12);color:#FF8A8A;border:1px solid rgba(255,90,90,.28);
          border-radius:12px;padding:10px 12px;font-weight:700;font-size:13px;margin-bottom:12px;
        }
        .k-trade[data-theme="light"] .tl-err{
          background:rgba(220,38,38,.08);color:#DC2626;border-color:rgba(220,38,38,.22);
        }
        .tl-btn{
          width:100%;border:none;border-radius:14px;padding:14px;font-weight:900;font-size:15px;cursor:pointer;
          background:linear-gradient(135deg,#1FD760,#14b24f);color:#05210D;
        }
        .tl-btn:disabled{opacity:.55;cursor:default}
        .tl-hint{margin-top:14px;font-size:11px;color:var(--muted);font-weight:700;line-height:1.4;text-align:center}
      `}</style>

      {onThemeChange && (
        <div className="tl-theme" role="group" aria-label="Тема">
          <button
            type="button"
            className={theme === 'dark' ? 'on' : ''}
            title="Тёмная тема"
            onClick={() => onThemeChange('dark')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M21 14.3A9 9 0 1 1 9.7 3 7 7 0 0 0 21 14.3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className={theme === 'light' ? 'on' : ''}
            title="Светлая тема"
            onClick={() => onThemeChange('light')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
              <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.05 5.05l1.56 1.56M17.39 17.39l1.56 1.56M18.95 5.05l-1.56 1.56M6.61 17.39l-1.56 1.56" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      <form className="tl-card" onSubmit={e => void submit(e)}>
        <div className="tl-logo" aria-hidden>🦜</div>
        <h1>Торговля</h1>
        <div className="sub">Войдите под своим паролем — откроются только ваши разделы</div>

        {loadingDir ? (
          <div style={{ color: 'var(--muted)', fontWeight: 700, textAlign: 'center' }}>Загрузка…</div>
        ) : !directory.length ? (
          <div className="tl-err">
            Нет сотрудников. Добавьте их в Админке → Команда → Сотрудники
          </div>
        ) : (
          <>
            <div className="tl-label">Сотрудник</div>
            <select value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
              <option value="">Выберите…</option>
              {directory.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}{d.roleLabel ? ` · ${d.roleLabel}` : ''}
                </option>
              ))}
            </select>
            <div className="tl-label">Пароль</div>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••"
              autoComplete="current-password"
              autoFocus
            />
            {err && <div className="tl-err">{err}</div>}
            <button type="submit" className="tl-btn" disabled={busy || !employeeId}>
              {busy ? 'Входим…' : 'Войти'}
            </button>
            <div className="tl-hint">
              Пароль выдаёт админ. Пример по умолчанию: Админ магазина / 1234
            </div>
          </>
        )}
        {err && !directory.length && <div className="tl-err" style={{ marginTop: 12 }}>{err}</div>}
      </form>
    </div>
  )
}
