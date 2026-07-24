'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import {
  verifyRestaurantOtp,
  findRestaurantByPhone,
  type RestaurantLoginProfile,
} from '@/lib/restaurantTeam'
import { saveRestaurantSession, type RestaurantSession } from '@/lib/restaurantSession'

const LOGIN_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@700;800;900&family=Nunito:wght@400;600;700;800&display=swap');
  .rl-root{font-family:'Nunito',sans-serif;}
  .rl-ub{font-family:'Unbounded',sans-serif;}
  .rl-btn{cursor:pointer;border:none;transition:all .22s cubic-bezier(.16,1,.3,1);}
  .rl-btn:active:not(:disabled){transform:scale(.97);}
  .rl-btn:disabled{cursor:not-allowed;}
  .rl-inp{transition:border-color .2s,box-shadow .2s,background .2s;}
  .rl-inp:focus{border-color:rgba(31,215,96,.65)!important;box-shadow:0 0 0 3px rgba(31,215,96,.15)!important;outline:none;}
  @keyframes rlSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
  @keyframes rlFadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
  @keyframes rlFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
  @keyframes rlGlow{0%,100%{box-shadow:0 0 28px rgba(31,215,96,.35),0 0 60px rgba(31,215,96,.12)}50%{box-shadow:0 0 40px rgba(31,215,96,.55),0 0 80px rgba(31,215,96,.2)}}
  @keyframes rlPulseRing{0%{transform:scale(.92);opacity:.6}100%{transform:scale(1.35);opacity:0}}
  @keyframes rlOrb{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(12px,-18px) scale(1.08)}}
`

interface RestaurantLoginPageProps {
  restaurants: RestaurantLoginProfile[]
  onSuccess: (session: RestaurantSession) => void
}

function Spinner() {
  return (
    <div style={{
      width: 18, height: 18, borderRadius: '50%',
      border: '2.5px solid rgba(3,11,5,.25)',
      borderTopColor: '#030B05',
      animation: 'rlSpin .8s linear infinite',
    }} />
  )
}

export default function RestaurantLoginPage({ restaurants, onSuccess }: RestaurantLoginPageProps) {
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState(['', '', '', ''])
  const [err, setErr] = useState('')
  const [load, setLoad] = useState(false)
  const [cd, setCd] = useState(0)
  const refs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ]

  const demoList = restaurants.filter(r => !r.blocked && r.phone).slice(0, 4)

  useEffect(() => {
    if (step !== 'otp' || cd <= 0) return
    const t = setInterval(() => setCd(c => (c > 0 ? c - 1 : 0)), 1000)
    return () => clearInterval(t)
  }, [step, cd])

  const pickDemo = (r: RestaurantLoginProfile) => {
    setPhone(r.phone)
    setErr('')
  }

  const sendOtp = () => {
    if (!phone.trim()) { setErr('Введите номер телефона'); return }
    const restaurant = findRestaurantByPhone(restaurants, phone)
    if (!restaurant) {
      setErr('Номер не найден · проверьте данные партнёра в админке')
      return
    }
    if (restaurant.blocked) {
      setErr('Доступ заблокирован администратором')
      return
    }
    setErr('')
    setStep('otp')
    setCd(30)
    setOtp(['', '', '', ''])
    setTimeout(() => refs[0].current?.focus(), 120)
  }

  const verifyWithCode = (code: string) => {
    if (code.length < 4 || load) return
    setErr('')
    setLoad(true)
    setTimeout(() => {
      const result = verifyRestaurantOtp(restaurants, phone, code)
      setLoad(false)
      if (!result.ok) {
        setErr(result.error)
        setOtp(['', '', '', ''])
        refs[0].current?.focus()
        return
      }
      const session: RestaurantSession = {
        restId: result.restaurant.id,
        phone: result.restaurant.phone,
        name: result.restaurant.name,
      }
      saveRestaurantSession(session)
      onSuccess(session)
    }, 450)
  }

  const verify = () => verifyWithCode(otp.join(''))

  const handleOtp = (i: number, v: string) => {
    const d = [...otp]
    d[i] = v.replace(/\D/g, '').slice(-1)
    setOtp(d)
    if (v && i < 3) refs[i + 1].current?.focus()
    if (d.every(x => x) && d.join('').length === 4) {
      setTimeout(() => verifyWithCode(d.join('')), 100)
    }
  }

  const handleKey = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[i] && i > 0) {
      refs[i - 1].current?.focus()
      const d = [...otp]
      d[i - 1] = ''
      setOtp(d)
    }
    if (e.key === 'Enter' && otp.join('').length === 4) verify()
  }

  const otpReady = otp.join('').length === 4
  const matched = findRestaurantByPhone(restaurants, phone)

  return (
    <div className="rl-root" style={{
      minHeight: '100dvh',
      background: '#030B05',
      maxWidth: 480,
      margin: '0 auto',
      position: 'relative',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <style>{LOGIN_CSS}</style>

      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', top: '-15%', right: '-20%', width: 280, height: 280, borderRadius: '50%',
          background: 'radial-gradient(circle,rgba(31,215,96,.18) 0%,transparent 70%)',
          animation: 'rlOrb 8s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', bottom: '5%', left: '-25%', width: 320, height: 320, borderRadius: '50%',
          background: 'radial-gradient(circle,rgba(255,184,0,.06) 0%,transparent 70%)',
          animation: 'rlOrb 10s ease-in-out infinite reverse',
        }} />
      </div>

      <Link href="/" className="rl-btn" style={{
        position: 'absolute', top: 18, left: 18, zIndex: 10,
        width: 42, height: 42, borderRadius: 13,
        background: 'rgba(9,21,8,.85)', backdropFilter: 'blur(12px)',
        border: '1px solid rgba(31,215,96,.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        textDecoration: 'none', color: '#8FB897', fontSize: 18,
      }}>←</Link>

      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '72px 22px 32px', position: 'relative', zIndex: 1,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32, animation: 'rlFadeUp .55s ease both' }}>
          <div style={{ position: 'relative', width: 96, height: 96, margin: '0 auto 20px' }}>
            <div style={{
              position: 'absolute', inset: -8, borderRadius: 28,
              border: '2px solid rgba(31,215,96,.35)',
              animation: 'rlPulseRing 2.2s ease-out infinite',
            }} />
            <div style={{
              width: 96, height: 96, borderRadius: 28,
              background: 'linear-gradient(145deg,#0F3020 0%,#17B34E 50%,#1FD760 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 46, animation: 'rlFloat 3.5s ease-in-out infinite, rlGlow 3s ease-in-out infinite',
              boxShadow: '0 12px 40px rgba(31,215,96,.4)',
            }}>🍽</div>
          </div>
          <div className="rl-ub" style={{
            fontSize: 24, fontWeight: 900, letterSpacing: '-.02em', marginBottom: 6,
            background: 'linear-gradient(135deg,#1FD760 0%,#FFB800 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>КАКАПО Ресторан</div>
          <div style={{ fontSize: 13, color: '#8FB897', lineHeight: 1.5 }}>
            Кабинет партнёра · <span style={{ color: '#1FD760', fontWeight: 700 }}>г. Яван</span>
          </div>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20,
          animation: 'rlFadeUp .55s ease .08s both',
        }}>
          {(['phone', 'otp'] as const).map((s, i) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 9,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 800,
                background: step === s || (step === 'otp' && s === 'phone')
                  ? 'linear-gradient(135deg,#17B34E,#1FD760)' : '#0C1C0F',
                color: step === s || (step === 'otp' && s === 'phone') ? '#030B05' : '#3D6645',
                border: `1.5px solid ${step === s ? 'rgba(31,215,96,.6)' : '#162B1A'}`,
                boxShadow: step === s ? '0 4px 14px rgba(31,215,96,.35)' : 'none',
              }}>{i + 1}</div>
              <span style={{ fontSize: 11, fontWeight: 700, color: step === s ? '#1FD760' : '#3D6645' }}>
                {s === 'phone' ? 'Телефон' : 'Код SMS'}
              </span>
              {i === 0 && <div style={{ width: 24, height: 2, borderRadius: 1, background: step === 'otp' ? '#1FD760' : '#162B1A', marginLeft: 4 }} />}
            </div>
          ))}
        </div>

        <div style={{
          width: '100%', maxWidth: 360,
          background: 'linear-gradient(165deg,rgba(12,28,15,.95) 0%,rgba(9,21,8,.98) 100%)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(31,215,96,.18)',
          borderRadius: 24, padding: '26px 22px',
          boxShadow: '0 20px 60px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.04)',
          animation: 'rlFadeUp .55s ease .14s both',
        }}>
          {err && (
            <div style={{
              padding: '11px 14px', borderRadius: 12, marginBottom: 16,
              background: 'rgba(255,69,69,.08)', border: '1px solid rgba(255,69,69,.28)',
              fontSize: 12, color: '#FF6969', textAlign: 'center', lineHeight: 1.45,
            }}>⚠️ {err}</div>
          )}

          {step === 'phone' ? (
            <div key="phone-step">
              <div className="rl-ub" style={{ fontSize: 15, fontWeight: 800, marginBottom: 4, color: '#EBF5ED' }}>Войти в кабинет</div>
              <div style={{ fontSize: 12, color: '#8FB897', marginBottom: 18, lineHeight: 1.45 }}>
                Укажите номер ресторана — пришлём SMS с кодом подтверждения
              </div>

              <div style={{ fontSize: 10, color: '#3D6645', marginBottom: 7, fontWeight: 800, letterSpacing: .6, textTransform: 'uppercase' }}>
                Номер телефона
              </div>
              <div style={{ position: 'relative', marginBottom: 16 }}>
                <div style={{
                  position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                  display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none', zIndex: 2,
                }}>
                  <span style={{ fontSize: 18 }}>🇹🇯</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#8FB897' }}>+992</span>
                  <div style={{ width: 1, height: 18, background: '#162B1A' }} />
                </div>
                <input
                  className="rl-inp"
                  value={phone}
                  onChange={e => { setPhone(e.target.value); setErr('') }}
                  onKeyDown={e => e.key === 'Enter' && sendOtp()}
                  placeholder="93 111 22 33"
                  type="tel"
                  autoComplete="tel"
                  style={{
                    width: '100%', padding: '14px 14px 14px 88px', borderRadius: 14,
                    background: '#0C1C0F', border: '1.5px solid #162B1A',
                    color: '#EBF5ED', fontSize: 16, letterSpacing: .5,
                  }}
                />
              </div>

              {demoList.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 10, color: '#3D6645', marginBottom: 8, fontWeight: 700 }}>Быстрый вход</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {demoList.map(r => (
                      <button
                        key={r.id}
                        type="button"
                        className="rl-btn"
                        onClick={() => pickDemo(r)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '11px 14px', borderRadius: 13, textAlign: 'left',
                          background: phone === r.phone ? 'rgba(31,215,96,.14)' : 'rgba(31,215,96,.06)',
                          border: `1.5px solid ${phone === r.phone ? 'rgba(31,215,96,.45)' : 'rgba(31,215,96,.15)'}`,
                        }}
                      >
                        <div style={{
                          width: 38, height: 38, borderRadius: 11, flexShrink: 0,
                          background: 'linear-gradient(135deg,#0F3020,#1FD760)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
                        }}>{r.emoji}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: '#EBF5ED', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                          <div style={{ fontSize: 11, color: '#8FB897', marginTop: 1 }}>{r.phone}</div>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 800, color: '#1FD760', flexShrink: 0 }}>→</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button type="button" onClick={sendOtp} disabled={load} className="rl-btn rl-ub"
                style={{
                  width: '100%', padding: 16, borderRadius: 16,
                  background: 'linear-gradient(135deg,#17B34E,#1FD760)',
                  color: '#030B05', fontWeight: 800, fontSize: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  boxShadow: '0 8px 28px rgba(31,215,96,.35)',
                  opacity: load ? .7 : 1,
                }}>
                {load ? <Spinner /> : '📲 Получить код'}
              </button>
            </div>
          ) : (
            <div key="otp-step">
              <button type="button" onClick={() => { setStep('phone'); setErr('') }} className="rl-btn"
                style={{ background: 'none', color: '#8FB897', fontSize: 12, fontWeight: 700, marginBottom: 14, padding: 0 }}>
                ← Изменить номер
              </button>
              <div className="rl-ub" style={{ fontSize: 15, fontWeight: 800, marginBottom: 4, color: '#EBF5ED' }}>Код из SMS</div>
              <div style={{ fontSize: 12, color: '#8FB897', marginBottom: 20, lineHeight: 1.45 }}>
                Отправлен на <span style={{ color: '#1FD760', fontWeight: 700 }}>{matched?.phone || phone}</span>
                {matched && <span style={{ display: 'block', marginTop: 4 }}>{matched.emoji} {matched.name}</span>}
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 20 }}>
                {otp.map((d, i) => (
                  <input
                    key={i}
                    ref={refs[i]}
                    className="rl-inp rl-ub"
                    value={d}
                    onChange={e => handleOtp(i, e.target.value)}
                    onKeyDown={e => handleKey(i, e)}
                    maxLength={1}
                    inputMode="numeric"
                    style={{
                      width: 56, height: 60, textAlign: 'center', fontSize: 22, fontWeight: 900,
                      borderRadius: 14, background: '#0C1C0F', border: '1.5px solid #162B1A', color: '#1FD760',
                    }}
                  />
                ))}
              </div>

              <button type="button" onClick={verify} disabled={load || !otpReady} className="rl-btn rl-ub"
                style={{
                  width: '100%', padding: 16, borderRadius: 16,
                  background: otpReady ? 'linear-gradient(135deg,#17B34E,#1FD760)' : '#162B1A',
                  color: otpReady ? '#030B05' : '#3D6645', fontWeight: 800, fontSize: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  boxShadow: otpReady ? '0 8px 28px rgba(31,215,96,.35)' : 'none',
                }}>
                {load ? <Spinner /> : '🔑 Войти'}
              </button>

              <button type="button" onClick={sendOtp} disabled={cd > 0 || load} className="rl-btn"
                style={{
                  width: '100%', marginTop: 12, padding: 12, borderRadius: 12,
                  background: 'transparent', border: '1px solid #162B1A',
                  color: cd > 0 ? '#3D6645' : '#8FB897', fontSize: 12, fontWeight: 700,
                }}>
                {cd > 0 ? `Отправить снова через ${cd} сек` : 'Отправить код повторно'}
              </button>
            </div>
          )}
        </div>

        <div style={{ marginTop: 24, fontSize: 11, color: '#3D6645', textAlign: 'center' }}>
          КАКАПО Restaurant v1.0 · Только для партнёров
        </div>
      </div>
    </div>
  )
}
