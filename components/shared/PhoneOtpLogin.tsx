'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { USE_API } from '@/lib/store'
import { api } from '@/lib/api'
import {
  demoStaffOtp,
  loadStaffSession,
  saveStaffSession,
  type StaffRole,
  type StaffSession,
} from '@/lib/appAuth'

type DemoLists = Parameters<typeof demoStaffOtp>[3]

interface PhoneOtpLoginProps {
  appTitle: string
  appSubtitle: string
  icon: string
  accent: string
  gradient: string
  role: StaffRole
  demoLists?: DemoLists
  demoPhoneHint?: string
  onSuccess: (session: StaffSession) => void
  backHref?: string
}

export default function PhoneOtpLogin({
  appTitle,
  appSubtitle,
  icon,
  accent,
  gradient,
  role,
  demoLists,
  demoPhoneHint,
  onSuccess,
  backHref = '/',
}: PhoneOtpLoginProps) {
  const existing = typeof window !== 'undefined' ? loadStaffSession(role) : null
  const [step, setStep] = useState<'phone' | 'otp'>(existing ? 'otp' : 'phone')
  const [phone, setPhone] = useState(existing?.phone || '')
  const [otp, setOtp] = useState(['', '', '', ''])
  const [err, setErr] = useState('')
  const [load, setLoad] = useState(false)
  const [cd, setCd] = useState(0)
  const refs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]

  useEffect(() => {
    if (step !== 'otp' || cd <= 0) return
    const t = setInterval(() => setCd(c => (c > 0 ? c - 1 : 0)), 1000)
    return () => clearInterval(t)
  }, [step, cd])

  const sendOtp = async () => {
    if (!phone.trim()) { setErr('Введите номер телефона'); return }
    setErr('')
    setLoad(true)
    try {
      if (USE_API) await api.sendOTP(phone, role)
      setStep('otp')
      setCd(30)
      setOtp(['', '', '', ''])
      setTimeout(() => refs[0].current?.focus(), 100)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Не удалось отправить SMS')
    } finally {
      setLoad(false)
    }
  }

  const verify = async () => {
    const code = otp.join('')
    if (code.length < 4) return
    setErr('')
    setLoad(true)
    try {
      if (USE_API) {
        const r = await api.verifyOTP(phone, code, role)
        const session: StaffSession = {
          role,
          phone: r.phone || phone,
          name: r.name,
          token: r.access_token,
          staffId: r.staff_id,
          restaurantId: r.restaurant_id,
        }
        saveStaffSession(session)
        onSuccess(session)
        return
      }
      const session = demoStaffOtp(phone, code, role, demoLists || {})
      if (!session) {
        setErr('Неверный номер или код · Демо: 1234')
        setOtp(['', '', '', ''])
        refs[0].current?.focus()
        return
      }
      saveStaffSession(session)
      onSuccess(session)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Неверный код')
      setOtp(['', '', '', ''])
      refs[0].current?.focus()
    } finally {
      setLoad(false)
    }
  }

  const handleOtp = (i: number, v: string) => {
    const d = [...otp]
    d[i] = v.replace(/\D/g, '').slice(-1)
    setOtp(d)
    if (v && i < 3) refs[i + 1].current?.focus()
  }

  const handleKey = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[i] && i > 0) {
      refs[i - 1].current?.focus()
      const d = [...otp]
      d[i - 1] = ''
      setOtp(d)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#030B05', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, maxWidth: 480, margin: '0 auto', position: 'relative' }}>
      <Link href={backHref} style={{ position: 'absolute', top: 20, left: 20, width: 38, height: 38, borderRadius: 10, background: '#091508', border: '1px solid #162B1A', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', color: '#8FB897', fontSize: 16 }}>←</Link>

      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontSize: 56, marginBottom: 12 }}>{icon}</div>
        <div className="ub" style={{ fontFamily: 'Unbounded', fontSize: 22, fontWeight: 900, color: accent, marginBottom: 4 }}>{appTitle}</div>
        <div style={{ fontSize: 13, color: '#8FB897' }}>{appSubtitle}</div>
      </div>

      <div style={{ width: '100%', maxWidth: 340, background: '#091508', border: '1px solid #162B1A', borderRadius: 22, padding: 26 }}>
        {err && (
          <div style={{ padding: '9px 12px', borderRadius: 10, background: 'rgba(255,69,69,.1)', border: '1px solid rgba(255,69,69,.3)', fontSize: 12, color: '#FF4545', marginBottom: 14, textAlign: 'center' }}>
            ⚠️ {err}
          </div>
        )}

        {step === 'phone' ? (
          <>
            <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 6, fontWeight: 700 }}>Номер телефона</div>
            <input
              className="ai"
              value={phone}
              onChange={e => { setPhone(e.target.value); setErr('') }}
              placeholder="+992 93 000 00 00"
              type="tel"
              autoComplete="tel"
              style={{ width: '100%', marginBottom: 14, padding: '12px 14px', borderRadius: 13, background: '#0C1C0F', border: '1.5px solid #162B1A', color: '#EBF5ED', fontSize: 15 }}
            />
            {demoPhoneHint && (
              <div style={{ padding: '10px', borderRadius: 10, background: `${accent}10`, border: `1px solid ${accent}30`, fontSize: 12, color: '#8FB897', marginBottom: 14, textAlign: 'center' }}>
                💡 {demoPhoneHint}
              </div>
            )}
            <button type="button" onClick={sendOtp} disabled={load} className="btn"
              style={{ width: '100%', padding: 15, borderRadius: 15, background: gradient, border: 'none', color: 'white', fontWeight: 800, fontSize: 15, opacity: load ? 0.7 : 1 }}>
              {load ? 'Отправка…' : '📱 Получить код SMS'}
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12, color: '#8FB897', textAlign: 'center', marginBottom: 14 }}>
              Код отправлен на <span style={{ color: accent, fontWeight: 700 }}>{phone}</span>
              <button type="button" onClick={() => { setStep('phone'); setErr('') }} style={{ display: 'block', margin: '6px auto 0', background: 'none', border: 'none', color: '#3D6645', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}>Изменить номер</button>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 16 }}>
              {otp.map((v, i) => (
                <input
                  key={i}
                  ref={refs[i]}
                  value={v}
                  type="tel"
                  maxLength={1}
                  inputMode="numeric"
                  onChange={e => handleOtp(i, e.target.value)}
                  onKeyDown={e => handleKey(i, e)}
                  style={{
                    width: 54, height: 62, borderRadius: 15,
                    border: `2px solid ${v ? `${accent}80` : '#162B1A'}`,
                    background: v ? `${accent}14` : '#0C1C0F',
                    textAlign: 'center', fontSize: 26, fontWeight: 900, color: '#EBF5ED', outline: 'none',
                  }}
                />
              ))}
            </div>
            <div style={{ padding: '10px', borderRadius: 10, background: `${accent}10`, border: `1px solid ${accent}30`, fontSize: 12, color: '#8FB897', marginBottom: 14, textAlign: 'center' }}>
              💡 Демо-код: <span style={{ color: accent, fontWeight: 800 }}>1 2 3 4</span>
              {cd > 0 && <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: '#3D6645' }}>Повтор через {cd} сек</span>}
            </div>
            <button type="button" onClick={verify} disabled={load || otp.join('').length < 4} className="btn"
              style={{ width: '100%', padding: 15, borderRadius: 15, background: gradient, border: 'none', color: 'white', fontWeight: 800, fontSize: 15, opacity: otp.join('').length < 4 ? 0.5 : 1 }}>
              {load ? 'Проверка…' : '✓ Войти'}
            </button>
            {cd === 0 && (
              <button type="button" onClick={sendOtp} style={{ width: '100%', marginTop: 10, padding: 10, background: 'none', border: 'none', color: accent, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                Отправить код повторно
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
