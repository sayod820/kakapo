'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { USE_API } from '@/lib/config'
import type { TradeEmployeeSession } from '@/lib/employeeSession'

type DirectoryRow = { id: string; name: string; role: string; roleLabel?: string }

export default function TradeLoginPage({
  onSuccess,
}: {
  onSuccess: (session: TradeEmployeeSession) => void
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
    <div className="k-trade" style={{ minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <style>{`
        .tl-card{width:100%;max-width:400px;background:var(--card);border:1px solid var(--border);border-radius:20px;padding:24px}
        .tl-card h1{margin:0 0 6px;font-size:22px;font-weight:900}
        .tl-card .sub{color:var(--muted);font-size:13px;margin-bottom:18px;line-height:1.4;font-weight:700}
        .tl-label{font-size:12px;color:var(--muted);font-weight:800;margin-bottom:6px}
        .tl-card select,.tl-card input{width:100%;background:var(--panel);border:1.5px solid var(--border);border-radius:12px;color:var(--text);padding:12px 14px;font-size:15px;font-weight:700;margin-bottom:12px;outline:none}
        .tl-card select:focus,.tl-card input:focus{border-color:var(--green)}
        .tl-err{background:#2a1420;color:#FF8A8A;border:1px solid #5a2030;border-radius:12px;padding:10px 12px;font-weight:700;font-size:13px;margin-bottom:12px}
        .tl-btn{width:100%;border:none;border-radius:14px;padding:14px;font-weight:900;font-size:15px;cursor:pointer;background:linear-gradient(135deg,#1FD760,#14b24f);color:#05210D}
        .tl-btn:disabled{opacity:.55;cursor:default}
        .tl-hint{margin-top:14px;font-size:11px;color:var(--muted);font-weight:700;line-height:1.4;text-align:center}
      `}</style>
      <form className="tl-card" onSubmit={e => void submit(e)}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🦜</div>
        <h1>Торговля</h1>
        <div className="sub">Войдите под своим паролем — откроются только ваши разделы</div>

        {loadingDir ? (
          <div style={{ color: 'var(--muted)', fontWeight: 700 }}>Загрузка…</div>
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
