'use client'
import { useState } from 'react'
import Link from 'next/link'
import { USE_API } from '@/lib/store'
import { api } from '@/lib/api'
import { verifyAdminLocal, setAdminLoggedIn, loadAdminCredentials } from '@/lib/appAuth'
import { useAuth } from '@/lib/store'

interface AdminLoginPageProps {
  onSuccess: () => void
}

export default function AdminLoginPage({ onSuccess }: AdminLoginPageProps) {
  const authLogin = useAuth(s => s.login)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [load, setLoad] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    if (!email.trim() || !password) {
      setErr('Введите логин и пароль')
      return
    }
    setLoad(true)
    try {
      if (USE_API) {
        const ok = await authLogin(email.trim(), password)
        if (!ok) {
          setErr('Неверный email или пароль')
          return
        }
      } else if (!verifyAdminLocal(email.trim(), password)) {
        setErr('Неверный email или пароль')
        return
      }
      setAdminLoggedIn(true)
      onSuccess()
    } finally {
      setLoad(false)
    }
  }

  const creds = loadAdminCredentials()

  return (
    <div style={{ minHeight: '100vh', background: '#030B05', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Link href="/" style={{ position: 'absolute', top: 20, left: 20, width: 38, height: 38, borderRadius: 10, background: '#091508', border: '1px solid #162B1A', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', color: '#8FB897', fontSize: 16 }}>←</Link>

      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: 'linear-gradient(135deg,#0F8A3A,#1FD760)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Unbounded', fontSize: 28, fontWeight: 900, color: '#030B05', margin: '0 auto 14px' }}>K</div>
        <div className="ub" style={{ fontFamily: 'Unbounded', fontSize: 22, fontWeight: 900, color: '#1FD760', marginBottom: 4 }}>KAKAPO Admin</div>
        <div style={{ fontSize: 13, color: '#8FB897' }}>Только для владельца · г. Яван</div>
      </div>

      <div style={{ width: '100%', maxWidth: 380, background: '#091508', border: '1px solid #162B1A', borderRadius: 22, padding: 26 }}>
        <div className="ub" style={{ fontFamily: 'Unbounded', fontSize: 15, fontWeight: 800, marginBottom: 18 }}>Вход владельца</div>
        {err && (
          <div style={{ padding: '10px 13px', borderRadius: 11, background: 'rgba(255,69,69,.1)', border: '1px solid rgba(255,69,69,.3)', fontSize: 12, color: '#FF4545', marginBottom: 14 }}>
            ⚠️ {err}
          </div>
        )}
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <div>
            <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>Email (логин)</div>
            <input className="ai" value={email} onChange={e => { setEmail(e.target.value); setErr('') }} type="email" placeholder="admin@kakapo.tj" autoComplete="username" style={{ width: '100%', padding: '11px 13px', borderRadius: 11, background: '#0C1C0F', border: '1.5px solid #162B1A', color: '#EBF5ED' }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>Пароль</div>
            <input className="ai" value={password} onChange={e => { setPassword(e.target.value); setErr('') }} type="password" placeholder="••••••••" autoComplete="current-password" style={{ width: '100%', padding: '11px 13px', borderRadius: 11, background: '#0C1C0F', border: '1.5px solid #162B1A', color: '#EBF5ED' }} />
          </div>
          {!USE_API && (
            <div style={{ padding: '10px 13px', borderRadius: 10, background: 'rgba(255,184,0,.06)', border: '1px solid rgba(255,184,0,.2)', fontSize: 12, color: '#8FB897' }}>
              💡 Демо: <span style={{ color: '#FFB800', fontWeight: 700 }}>{creds.email}</span> / <span style={{ color: '#FFB800', fontWeight: 700 }}>{creds.password}</span>
            </div>
          )}
          <button type="submit" disabled={load} className="btn" style={{ padding: 14, borderRadius: 14, background: 'linear-gradient(135deg,#17B34E,#1FD760)', border: 'none', color: '#030B05', fontWeight: 800, fontSize: 15 }}>
            {load ? 'Вход…' : '🔑 Войти'}
          </button>
        </form>
        <div style={{ marginTop: 14, fontSize: 11, color: '#3D6645', textAlign: 'center', lineHeight: 1.5 }}>
          Логин и пароль настраиваются в разделе «Настройки → Владелец»
        </div>
      </div>
    </div>
  )
}
