'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { verifyCourierOtp, findCourierByPhone, vehicleIcon, type AdminCourier } from '@/lib/courierTeam'
import { saveCourierSession, type CourierSession } from '@/lib/courierSession'

const LOGIN_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@700;800;900&family=Nunito:wght@400;600;700;800&display=swap');
  .cl-root{font-family:'Nunito',sans-serif;}
  .cl-ub{font-family:'Unbounded',sans-serif;}
  .cl-btn{cursor:pointer;border:none;transition:all .22s cubic-bezier(.16,1,.3,1);}
  .cl-btn:active:not(:disabled){transform:scale(.97);}
  .cl-btn:disabled{cursor:not-allowed;}
  .cl-inp{transition:border-color .2s,box-shadow .2s,background .2s;}
  .cl-inp:focus{border-color:rgba(59,142,240,.65)!important;box-shadow:0 0 0 3px rgba(59,142,240,.15)!important;outline:none;}
  @keyframes clSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
  @keyframes clFadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
  @keyframes clFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
  @keyframes clGlow{0%,100%{box-shadow:0 0 28px rgba(59,142,240,.35),0 0 60px rgba(59,142,240,.12)}50%{box-shadow:0 0 40px rgba(59,142,240,.55),0 0 80px rgba(59,142,240,.2)}}
  @keyframes clPulseRing{0%{transform:scale(.92);opacity:.6}100%{transform:scale(1.35);opacity:0}}
  @keyframes clShimmer{0%{background-position:200% center}100%{background-position:-200% center}}
  @keyframes clOrb{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(12px,-18px) scale(1.08)}}
`

interface CourierLoginPageProps {
  couriers: AdminCourier[]
  onSuccess: (session: CourierSession) => void
}

function Spinner() {
  return (
    <div style={{
      width: 18, height: 18, borderRadius: '50%',
      border: '2.5px solid rgba(255,255,255,.25)',
      borderTopColor: 'white',
      animation: 'clSpin .8s linear infinite',
    }} />
  )
}

export default function CourierLoginPage({ couriers, onSuccess }: CourierLoginPageProps) {
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState(['', '', '', ''])
  const [err, setErr] = useState('')
  const [load, setLoad] = useState(false)
  const [cd, setCd] = useState(0)
  const [focusedOtp, setFocusedOtp] = useState(-1)
  const refs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]

  const demoList = couriers.filter(c => !c.blocked && c.phone).slice(0, 3)

  useEffect(() => {
    if (step !== 'otp' || cd <= 0) return
    const t = setInterval(() => setCd(c => (c > 0 ? c - 1 : 0)), 1000)
    return () => clearInterval(t)
  }, [step, cd])

  const pickDemo = (c: AdminCourier) => {
    setPhone(c.phone)
    setErr('')
  }

  const sendOtp = () => {
    if (!phone.trim()) { setErr('Введите номер телефона'); return }
    const courier = findCourierByPhone(couriers, phone)
    if (!courier) {
      setErr('Номер не найден · проверьте раздел «Курьеры» в админке')
      return
    }
    if (courier.blocked) {
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
      const result = verifyCourierOtp(couriers, phone, code)
      setLoad(false)
      if (!result.ok) {
        setErr(result.error)
        setOtp(['', '', '', ''])
        refs[0].current?.focus()
        return
      }
      saveCourierSession({
        phone: result.courier.phone,
        courierId: result.courier.id,
        name: result.courier.name,
      })
      onSuccess({
        phone: result.courier.phone,
        courierId: result.courier.id,
        name: result.courier.name,
      })
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

  return (
    <div className="cl-root" style={{
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

      {/* Фон */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', top: '-15%', right: '-20%', width: 280, height: 280, borderRadius: '50%',
          background: 'radial-gradient(circle,rgba(59,142,240,.22) 0%,transparent 70%)',
          animation: 'clOrb 8s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', bottom: '5%', left: '-25%', width: 320, height: 320, borderRadius: '50%',
          background: 'radial-gradient(circle,rgba(31,215,96,.08) 0%,transparent 70%)',
          animation: 'clOrb 10s ease-in-out infinite reverse',
        }} />
        <div style={{
          position: 'absolute', inset: 0, opacity: .04,
          backgroundImage: 'linear-gradient(rgba(59,142,240,.8) 1px,transparent 1px),linear-gradient(90deg,rgba(59,142,240,.8) 1px,transparent 1px)',
          backgroundSize: '32px 32px',
        }} />
      </div>

      <Link href="/" className="cl-btn" style={{
        position: 'absolute', top: 18, left: 18, zIndex: 10,
        width: 42, height: 42, borderRadius: 13,
        background: 'rgba(9,21,8,.85)', backdropFilter: 'blur(12px)',
        border: '1px solid rgba(59,142,240,.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        textDecoration: 'none', color: '#8FB897', fontSize: 18,
      }}>←</Link>

      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '72px 22px 32px', position: 'relative', zIndex: 1,
      }}>
        {/* Герой */}
        <div style={{ textAlign: 'center', marginBottom: 32, animation: 'clFadeUp .55s ease both' }}>
          <div style={{ position: 'relative', width: 96, height: 96, margin: '0 auto 20px' }}>
            <div style={{
              position: 'absolute', inset: -8, borderRadius: 28,
              border: '2px solid rgba(59,142,240,.35)',
              animation: 'clPulseRing 2.2s ease-out infinite',
            }} />
            <div style={{
              width: 96, height: 96, borderRadius: 28,
              background: 'linear-gradient(145deg,#1E5BB5 0%,#3B8EF0 50%,#5BA3FF 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 46, animation: 'clFloat 3.5s ease-in-out infinite, clGlow 3s ease-in-out infinite',
              boxShadow: '0 12px 40px rgba(59,142,240,.4)',
            }}>🛵</div>
          </div>
          <div className="cl-ub" style={{
            fontSize: 24, fontWeight: 900, letterSpacing: '-.02em', marginBottom: 6,
            background: 'linear-gradient(135deg,#EBF5ED 0%,#3B8EF0 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>Курьер КАКАПО</div>
          <div style={{ fontSize: 13, color: '#8FB897', lineHeight: 1.5 }}>
            Доставка по городу · <span style={{ color: '#3B8EF0', fontWeight: 700 }}>г. Яван</span>
          </div>
        </div>

        {/* Шаги */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20,
          animation: 'clFadeUp .55s ease .08s both',
        }}>
          {(['phone', 'otp'] as const).map((s, i) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 9,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 800,
                background: step === s || (step === 'otp' && s === 'phone')
                  ? 'linear-gradient(135deg,#1E5BB5,#3B8EF0)' : '#0C1C0F',
                color: step === s || (step === 'otp' && s === 'phone') ? 'white' : '#3D6645',
                border: `1.5px solid ${step === s ? 'rgba(59,142,240,.6)' : '#162B1A'}`,
                boxShadow: step === s ? '0 4px 14px rgba(59,142,240,.35)' : 'none',
              }}>{i + 1}</div>
              <span style={{ fontSize: 11, fontWeight: 700, color: step === s ? '#3B8EF0' : '#3D6645' }}>
                {s === 'phone' ? 'Телефон' : 'Код SMS'}
              </span>
              {i === 0 && <div style={{ width: 24, height: 2, borderRadius: 1, background: step === 'otp' ? '#3B8EF0' : '#162B1A', marginLeft: 4 }} />}
            </div>
          ))}
        </div>

        {/* Карточка */}
        <div style={{
          width: '100%', maxWidth: 360,
          background: 'linear-gradient(165deg,rgba(12,28,15,.95) 0%,rgba(9,21,8,.98) 100%)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(59,142,240,.18)',
          borderRadius: 24, padding: '26px 22px',
          boxShadow: '0 20px 60px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.04)',
          animation: 'clFadeUp .55s ease .14s both',
        }}>
          {err && (
            <div style={{
              padding: '11px 14px', borderRadius: 12, marginBottom: 16,
              background: 'rgba(255,69,69,.08)', border: '1px solid rgba(255,69,69,.28)',
              fontSize: 12, color: '#FF6969', textAlign: 'center', lineHeight: 1.45,
              animation: 'clFadeUp .3s ease',
            }}>⚠️ {err}</div>
          )}

          {step === 'phone' ? (
            <div key="phone-step">
              <div className="cl-ub" style={{ fontSize: 15, fontWeight: 800, marginBottom: 4, color: '#EBF5ED' }}>Вход для курьера</div>
              <div style={{ fontSize: 12, color: '#8FB897', marginBottom: 18, lineHeight: 1.45 }}>
                Укажите номер из личного кабинета — пришлём SMS с кодом
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
                  className="cl-inp"
                  value={phone}
                  onChange={e => { setPhone(e.target.value); setErr('') }}
                  onKeyDown={e => e.key === 'Enter' && sendOtp()}
                  placeholder="93 000 00 00"
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
                  <div style={{ fontSize: 10, color: '#3D6645', marginBottom: 8, fontWeight: 700 }}>Быстрый вход (демо)</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {demoList.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        className="cl-btn"
                        onClick={() => pickDemo(c)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '11px 14px', borderRadius: 13, textAlign: 'left',
                          background: phone === c.phone ? 'rgba(59,142,240,.14)' : 'rgba(59,142,240,.06)',
                          border: `1.5px solid ${phone === c.phone ? 'rgba(59,142,240,.45)' : 'rgba(59,142,240,.15)'}`,
                        }}
                      >
                        <div style={{
                          width: 38, height: 38, borderRadius: 11, flexShrink: 0,
                          background: 'linear-gradient(135deg,#1E5BB5,#3B8EF0)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
                        }}>{vehicleIcon(c.vehicle)}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: '#EBF5ED', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                          <div style={{ fontSize: 11, color: '#8FB897', marginTop: 1 }}>{c.phone}</div>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 800, color: '#3B8EF0', flexShrink: 0 }}>→</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button type="button" onClick={sendOtp} disabled={load} className="cl-btn cl-ub"
                style={{
                  width: '100%', padding: 16, borderRadius: 16,
                  background: 'linear-gradient(135deg,#1E5BB5 0%,#3B8EF0 50%,#5BA3FF 100%)',
                  border: 'none', color: 'white', fontWeight: 800, fontSize: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  boxShadow: '0 8px 28px rgba(59,142,240,.4)',
                  opacity: load ? .75 : 1,
                }}>
                {load ? <Spinner /> : <><span style={{ fontSize: 18 }}>📱</span> Получить код SMS</>}
              </button>
            </div>
          ) : (
            <div key="otp-step">
              <div className="cl-ub" style={{ fontSize: 15, fontWeight: 800, marginBottom: 4, color: '#EBF5ED', textAlign: 'center' }}>Подтверждение</div>
              <div style={{ fontSize: 12, color: '#8FB897', textAlign: 'center', marginBottom: 22, lineHeight: 1.5 }}>
                Код отправлен на<br />
                <span style={{ color: '#3B8EF0', fontWeight: 800, fontSize: 14 }}>{phone}</span>
              </div>

              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 20 }}>
                {otp.map((v, i) => (
                  <input
                    key={i}
                    ref={refs[i]}
                    value={v}
                    type="tel"
                    maxLength={1}
                    inputMode="numeric"
                    onFocus={() => setFocusedOtp(i)}
                    onBlur={() => setFocusedOtp(-1)}
                    onChange={e => handleOtp(i, e.target.value)}
                    onKeyDown={e => handleKey(i, e)}
                    className="cl-inp cl-ub"
                    style={{
                      width: 58, height: 66, borderRadius: 16,
                      border: `2px solid ${v || focusedOtp === i ? 'rgba(59,142,240,.7)' : '#162B1A'}`,
                      background: v ? 'rgba(59,142,240,.14)' : '#0C1C0F',
                      textAlign: 'center', fontSize: 28, fontWeight: 900, color: '#EBF5ED',
                      boxShadow: focusedOtp === i ? '0 0 20px rgba(59,142,240,.25)' : v ? '0 4px 12px rgba(59,142,240,.15)' : 'none',
                      transform: v ? 'scale(1.02)' : 'scale(1)',
                      transition: 'all .15s ease',
                    }}
                  />
                ))}
              </div>

              <div style={{
                padding: '12px 14px', borderRadius: 12, marginBottom: 18, textAlign: 'center',
                background: 'linear-gradient(90deg,rgba(59,142,240,.06),rgba(59,142,240,.12),rgba(59,142,240,.06))',
                backgroundSize: '200% 100%',
                animation: 'clShimmer 4s ease-in-out infinite',
                border: '1px solid rgba(59,142,240,.2)',
              }}>
                <div style={{ fontSize: 12, color: '#8FB897' }}>
                  💡 Демо-код: <span className="cl-ub" style={{ color: '#3B8EF0', fontWeight: 900, letterSpacing: 3 }}>1 2 3 4</span>
                </div>
                {cd > 0 && (
                  <div style={{ fontSize: 11, color: '#3D6645', marginTop: 6 }}>
                    Повторная отправка через <span style={{ color: '#3B8EF0', fontWeight: 800 }}>{cd}</span> сек
                  </div>
                )}
              </div>

              <button type="button" onClick={verify} disabled={load || !otpReady} className="cl-btn cl-ub"
                style={{
                  width: '100%', padding: 16, borderRadius: 16,
                  background: otpReady
                    ? 'linear-gradient(135deg,#17B34E,#1FD760)'
                    : 'linear-gradient(135deg,#1E5BB5,#3B8EF0)',
                  border: 'none', color: otpReady ? '#030B05' : 'white',
                  fontWeight: 800, fontSize: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  boxShadow: otpReady ? '0 8px 28px rgba(31,215,96,.35)' : '0 8px 28px rgba(59,142,240,.3)',
                  opacity: !otpReady && !load ? .55 : load ? .75 : 1,
                }}>
                {load ? <Spinner /> : <>✓ Войти в кабинет</>}
              </button>

              <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 14 }}>
                <button type="button" onClick={() => { setStep('phone'); setErr(''); setOtp(['', '', '', '']) }}
                  className="cl-btn" style={{ background: 'none', border: 'none', color: '#8FB897', fontSize: 12, fontWeight: 700 }}>
                  ← Изменить номер
                </button>
                {cd === 0 && (
                  <button type="button" onClick={sendOtp} className="cl-btn"
                    style={{ background: 'none', border: 'none', color: '#3B8EF0', fontSize: 12, fontWeight: 700 }}>
                    🔄 Отправить снова
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div style={{
          marginTop: 28, textAlign: 'center', fontSize: 10, color: '#3D6645',
          animation: 'clFadeUp .55s ease .2s both', lineHeight: 1.6,
        }}>
          КАКАПО · Курьер · Таджикистан<br />
          <span style={{ color: '#2a4a32' }}>Только для зарегистрированных курьеров</span>
        </div>
      </div>
    </div>
  )
}
