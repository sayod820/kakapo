'use client'

import { useState } from 'react'
import { api, setToken } from '@/lib/api'
import { USE_API } from '@/lib/config'
import {
  DEFAULT_ADMIN_LOGIN,
  loadOfflineAdminCreds,
  saveAdminSession,
  type AdminSession,
} from '@/lib/adminSession'

export default function AdminLoginPage({
  onSuccess,
}: {
  onSuccess: (session: AdminSession) => void
}) {
  const [login, setLogin] = useState(DEFAULT_ADMIN_LOGIN)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [showPass, setShowPass] = useState(false)

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    setErr('')
    const loginVal = login.trim()
    const passVal = password
    if (!loginVal) {
      setErr('Введите логин')
      return
    }
    if (!passVal) {
      setErr('Введите пароль')
      return
    }
    setBusy(true)
    try {
      if (USE_API) {
        const row = await api.loginAdmin(loginVal, passVal)
        const session: AdminSession = {
          login: loginVal,
          name: row.name || 'Админ',
          role: row.role || 'admin',
          token: row.access_token,
          userId: row.user_id,
        }
        saveAdminSession(session)
        setToken(row.access_token)
        onSuccess(session)
        return
      }

      const creds = loadOfflineAdminCreds()
      const okLogin = loginVal.toLowerCase() === creds.login.toLowerCase()
        || loginVal.toLowerCase() === 'admin@kakapo.tj'
      if (!okLogin || passVal !== creds.password) {
        setErr('Неверный логин или пароль')
        return
      }
      const session: AdminSession = {
        login: creds.login,
        name: 'Админ КАКАПО',
        role: 'admin',
        token: 'offline-admin',
      }
      saveAdminSession(session)
      setToken(session.token)
      onSuccess(session)
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Неверный логин или пароль')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="al-wrap">
      <style>{`
        .al-wrap{
          min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;
          background:#030B05;position:relative;font-family:Nunito,system-ui,sans-serif;color:#EBF5ED;
        }
        .al-wrap::before{
          content:'';position:absolute;inset:0;pointer-events:none;opacity:.5;
          background:
            radial-gradient(circle at 18% 18%, rgba(31,215,96,.16), transparent 42%),
            radial-gradient(circle at 82% 78%, rgba(31,215,96,.07), transparent 45%);
        }
        .al-card{
          position:relative;z-index:1;width:100%;max-width:400px;
          background:#0C1C0F;border:1px solid #162B1A;border-radius:22px;padding:28px 24px;
          box-shadow:0 18px 40px rgba(0,0,0,.35);
        }
        .al-logo{
          width:52px;height:52px;border-radius:16px;margin:0 auto 14px;
          background:linear-gradient(135deg,#0F8A3A,#1FD760);
          display:flex;align-items:center;justify-content:center;
          font-family:Unbounded,sans-serif;font-size:20px;font-weight:900;color:#030B05;
          box-shadow:0 6px 16px rgba(31,215,96,.28);
        }
        .al-card h1{margin:0 0 6px;font-size:20px;font-weight:900;text-align:center;font-family:Unbounded,sans-serif}
        .al-card .sub{text-align:center;font-size:12px;color:#8FB897;margin-bottom:22px}
        .al-lbl{display:block;font-size:11px;font-weight:700;color:#8FB897;margin-bottom:6px}
        .al-inp{
          width:100%;padding:12px 14px;border-radius:12px;border:1.5px solid #162B1A;
          background:#091508;color:#EBF5ED;font-size:14px;font-weight:600;outline:none;
          box-sizing:border-box;
        }
        .al-inp:focus{border-color:rgba(31,215,96,.45)}
        .al-pass-wrap{position:relative}
        .al-pass-wrap .al-inp{padding-right:48px}
        .al-eye{
          position:absolute;right:10px;top:50%;transform:translateY(-50%);
          border:none;background:transparent;color:#8FB897;cursor:pointer;font-size:14px;padding:4px;
        }
        .al-err{
          margin:12px 0 0;padding:10px 12px;border-radius:10px;
          background:rgba(255,69,69,.1);border:1px solid rgba(255,69,69,.28);
          color:#FF6969;font-size:12px;font-weight:700;
        }
        .al-btn{
          width:100%;margin-top:18px;padding:13px;border-radius:12px;border:none;cursor:pointer;
          background:linear-gradient(135deg,#0F8A3A,#1FD760);color:#030B05;
          font-size:14px;font-weight:900;font-family:Unbounded,sans-serif;
          box-shadow:0 6px 16px rgba(31,215,96,.25);
        }
        .al-btn:disabled{opacity:.6;cursor:default}
        .al-hint{margin-top:14px;text-align:center;font-size:11px;color:#3D6645;line-height:1.5}
      `}</style>
      <form className="al-card" onSubmit={submit}>
        <div className="al-logo">K</div>
        <h1>КАКАПО Admin</h1>
        <div className="sub">Вход в панель управления · г. Яван</div>

        <label className="al-lbl" htmlFor="admin-login">Логин</label>
        <input
          id="admin-login"
          className="al-inp"
          autoComplete="username"
          value={login}
          onChange={e => setLogin(e.target.value)}
          placeholder="admin"
          disabled={busy}
        />

        <label className="al-lbl" htmlFor="admin-pass" style={{ marginTop: 14 }}>Пароль</label>
        <div className="al-pass-wrap">
          <input
            id="admin-pass"
            className="al-inp"
            type={showPass ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            disabled={busy}
          />
          <button type="button" className="al-eye" onClick={() => setShowPass(v => !v)} tabIndex={-1}>
            {showPass ? '🙈' : '👁'}
          </button>
        </div>

        {err ? <div className="al-err">{err}</div> : null}

        <button type="submit" className="al-btn" disabled={busy}>
          {busy ? 'Вход…' : 'Войти'}
        </button>
        <div className="al-hint">Логин и пароль можно сменить в Настройки → Доступ</div>
      </form>
    </div>
  )
}
