'use client'
import { useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import {
  findStoreClientByPhone,
  formatTjPhone,
  saveStoreUser,
  storeUserFromClient,
  type StoreUser,
} from '@/lib/clientSession'
import { DEFAULT_ADMIN_CLIENTS, normalizePhone, phonesMatch } from '@/lib/clientCrm'
import { useClientStore, hydrateClientStore } from '@/lib/clientStore'

const AddressMapPicker = dynamic(() => import('@/components/shared/AddressMapPicker'), { ssr: false })

const DEMO_OTP = '1234'

const LOGIN_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@700;800;900&family=Nunito:wght@400;600;700;800&display=swap');
  .sl-root{font-family:'Nunito',sans-serif;}
  .sl-ub{font-family:'Unbounded',sans-serif;}
  .sl-btn{cursor:pointer;border:none;transition:all .22s cubic-bezier(.16,1,.3,1);}
  .sl-btn:active:not(:disabled){transform:scale(.97);}
  .sl-btn:disabled{cursor:not-allowed;}
  .sl-inp{transition:border-color .2s,box-shadow .2s,background .2s;}
  .sl-inp:focus{border-color:rgba(31,215,96,.65)!important;box-shadow:0 0 0 3px rgba(31,215,96,.15)!important;outline:none;}
  @keyframes slSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
  @keyframes slFadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
  @keyframes slFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
  @keyframes slGlow{0%,100%{box-shadow:0 0 28px rgba(31,215,96,.35),0 0 60px rgba(31,215,96,.12)}50%{box-shadow:0 0 40px rgba(31,215,96,.55),0 0 80px rgba(31,215,96,.2)}}
  @keyframes slPulseRing{0%{transform:scale(.92);opacity:.6}100%{transform:scale(1.35);opacity:0}}
  @keyframes slShimmer{0%{background-position:200% center}100%{background-position:-200% center}}
  @keyframes slOrb{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(12px,-18px) scale(1.08)}}
`

type Step = 'phone' | 'otp' | 'register'

interface ClientLoginPageProps {
  go: (page: string) => void
  setUser: (user: StoreUser) => void
}

function Spinner() {
  return (
    <div style={{
      width: 18, height: 18, borderRadius: '50%',
      border: '2.5px solid rgba(255,255,255,.25)',
      borderTopColor: 'white',
      animation: 'slSpin .8s linear infinite',
    }} />
  )
}

export default function ClientLoginPage({ go, setUser }: ClientLoginPageProps) {
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState(['', '', '', ''])
  const [reg, setReg] = useState({ firstName: '', lastName: '', addr: '', email: '' })
  const [addrCoords, setAddrCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [mapOpen, setMapOpen] = useState(false)
  const [err, setErr] = useState('')
  const [load, setLoad] = useState(false)
  const [cd, setCd] = useState(0)
  const [focusedOtp, setFocusedOtp] = useState(-1)
  const refs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ]
  const addClient = useClientStore(s => s.addClient)
  const demoList = DEFAULT_ADMIN_CLIENTS.filter(c => !c.blocked && c.phone).slice(0, 3)

  useEffect(() => { hydrateClientStore() }, [])

  useEffect(() => {
    if (step !== 'otp' || cd <= 0) return
    const t = setInterval(() => setCd(c => (c > 0 ? c - 1 : 0)), 1000)
    return () => clearInterval(t)
  }, [step, cd])

  const pickDemo = (c: (typeof demoList)[0]) => {
    setPhone(c.phone.replace(/^\+992\s?/, ''))
    setErr('')
  }

  const finishLogin = (user: StoreUser) => {
    saveStoreUser(user)
    setUser(user)
    go('profile')
  }

  const sendOtp = () => {
    if (!phone.trim()) { setErr('Введите номер телефона'); return }
    if (normalizePhone(phone).length < 9) { setErr('Введите полный номер (9 цифр)'); return }
    findStoreClientByPhone(phone).then(match => {
      if (match?.blocked) { setErr('Доступ заблокирован администратором'); return }
      setErr('')
      setStep('otp')
      setCd(30)
      setOtp(['', '', '', ''])
      setTimeout(() => refs[0].current?.focus(), 120)
    })
  }

  const verifyWithCode = (code: string) => {
    if (code.length < 4 || load) return
    setErr('')
    setLoad(true)
    setTimeout(async () => {
      setLoad(false)
      if (code !== DEMO_OTP) {
        setErr('Неверный код · для демо: 1234')
        setOtp(['', '', '', ''])
        refs[0].current?.focus()
        return
      }
      const match = await findStoreClientByPhone(phone)
      if (match) {
        if (match.blocked) {
          setErr('Доступ заблокирован администратором')
          setOtp(['', '', '', ''])
          return
        }
        finishLogin(storeUserFromClient(match))
        return
      }
      setReg({ firstName: '', lastName: '', addr: '', email: '' })
      setAddrCoords(null)
      setMapOpen(false)
      setStep('register')
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

  const setRegField = (key: keyof typeof reg, val: string) => setReg(r => ({ ...r, [key]: val }))

  const saveRegister = () => {
    if (!reg.firstName.trim()) { setErr('Укажите имя'); return }
    if (!reg.lastName.trim()) { setErr('Укажите фамилию'); return }
    if (!addrCoords) { setErr('Укажите точку на карте'); setMapOpen(true); return }
    if (!reg.addr.trim()) { setErr('Укажите адрес доставки'); return }
    setErr('')
    setLoad(true)
    setTimeout(() => {
      setLoad(false)
      const formattedPhone = formatTjPhone(phone)
      const fullName = `${reg.firstName.trim()} ${reg.lastName.trim()}`
      const newClient = addClient({
        name: fullName,
        phone: formattedPhone,
        email: reg.email.trim(),
        addr: reg.addr.trim(),
        card: '',
        level: 'bronze',
        debt: 0,
        bonus: 100,
        debtLimit: 0,
        blocked: false,
      })
      finishLogin(storeUserFromClient(newClient))
    }, 500)
  }

  const otpReady = otp.join('').length === 4
  const stepLabels: { id: Step; label: string }[] = [
    { id: 'phone', label: 'Телефон' },
    { id: 'otp', label: 'Код SMS' },
    ...(step === 'register' ? [{ id: 'register' as Step, label: 'Профиль' }] : []),
  ]

  const stepIndex = (s: Step) => (s === 'phone' ? 0 : s === 'otp' ? 1 : 2)
  const currentIdx = stepIndex(step)

  const fieldLabel = (lbl: string) => (
    <div style={{ fontSize: 10, color: '#3D6645', marginBottom: 7, fontWeight: 800, letterSpacing: .6, textTransform: 'uppercase' }}>{lbl}</div>
  )

  return (
    <div className="sl-root" style={{
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
          animation: 'slOrb 8s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', bottom: '5%', left: '-25%', width: 320, height: 320, borderRadius: '50%',
          background: 'radial-gradient(circle,rgba(255,184,0,.06) 0%,transparent 70%)',
          animation: 'slOrb 10s ease-in-out infinite reverse',
        }} />
      </div>

      <button type="button" onClick={() => go('profile')} className="sl-btn" style={{
        position: 'absolute', top: 18, left: 18, zIndex: 10,
        width: 42, height: 42, borderRadius: 13,
        background: 'rgba(9,21,8,.85)', backdropFilter: 'blur(12px)',
        border: '1px solid rgba(31,215,96,.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#8FB897', fontSize: 18,
      }}>←</button>

      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '72px 22px 32px', position: 'relative', zIndex: 1,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28, animation: 'slFadeUp .55s ease both' }}>
          <div style={{ position: 'relative', width: 96, height: 96, margin: '0 auto 20px' }}>
            <div style={{
              position: 'absolute', inset: -8, borderRadius: 28,
              border: '2px solid rgba(31,215,96,.35)',
              animation: 'slPulseRing 2.2s ease-out infinite',
            }} />
            <div style={{
              width: 96, height: 96, borderRadius: 28,
              background: 'linear-gradient(145deg,#0F8A3A 0%,#1FD760 50%,#17B34E 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'Unbounded', fontSize: 42, fontWeight: 900, color: '#030B05',
              animation: 'slFloat 3.5s ease-in-out infinite, slGlow 3s ease-in-out infinite',
              boxShadow: '0 12px 40px rgba(31,215,96,.4)',
            }}>K</div>
          </div>
          <div className="sl-ub" style={{
            fontSize: 24, fontWeight: 900, letterSpacing: '-.02em', marginBottom: 6,
            background: 'linear-gradient(135deg,#EBF5ED 0%,#1FD760 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>КАКАПО</div>
          <div style={{ fontSize: 13, color: '#8FB897', lineHeight: 1.5 }}>
            Вход и регистрация · <span style={{ color: '#1FD760', fontWeight: 700 }}>г. Яван</span>
          </div>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20,
          animation: 'slFadeUp .55s ease .08s both', flexWrap: 'wrap', justifyContent: 'center',
        }}>
          {stepLabels.map((s, i) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 9,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 800,
                background: currentIdx >= i ? 'linear-gradient(135deg,#17B34E,#1FD760)' : '#0C1C0F',
                color: currentIdx >= i ? '#030B05' : '#3D6645',
                border: `1.5px solid ${currentIdx >= i ? 'rgba(31,215,96,.6)' : '#162B1A'}`,
                boxShadow: currentIdx === i ? '0 4px 14px rgba(31,215,96,.35)' : 'none',
              }}>{i + 1}</div>
              <span style={{ fontSize: 11, fontWeight: 700, color: currentIdx >= i ? '#1FD760' : '#3D6645' }}>
                {s.label}
              </span>
              {i < stepLabels.length - 1 && (
                <div style={{ width: 20, height: 2, borderRadius: 1, background: currentIdx > i ? '#1FD760' : '#162B1A', marginLeft: 4 }} />
              )}
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
          animation: 'slFadeUp .55s ease .14s both',
        }}>
          {err && (
            <div style={{
              padding: '11px 14px', borderRadius: 12, marginBottom: 16,
              background: 'rgba(255,69,69,.08)', border: '1px solid rgba(255,69,69,.28)',
              fontSize: 12, color: '#FF6969', textAlign: 'center', lineHeight: 1.45,
            }}>⚠️ {err}</div>
          )}

          {step === 'phone' && (
            <div key="phone-step">
              <div className="sl-ub" style={{ fontSize: 15, fontWeight: 800, marginBottom: 4, color: '#EBF5ED' }}>Номер телефона</div>
              <div style={{ fontSize: 12, color: '#8FB897', marginBottom: 18, lineHeight: 1.45 }}>
                Один номер для входа и регистрации — пришлём SMS с кодом
              </div>

              {fieldLabel('Номер телефона')}
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
                  className="sl-inp"
                  value={phone}
                  onChange={e => { setPhone(e.target.value); setErr('') }}
                  onKeyDown={e => e.key === 'Enter' && sendOtp()}
                  placeholder="93 456 78 90"
                  type="tel"
                  autoComplete="tel"
                  autoFocus
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
                        className="sl-btn"
                        onClick={() => pickDemo(c)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '11px 14px', borderRadius: 13, textAlign: 'left',
                          background: phonesMatch(c.phone, phone) ? 'rgba(31,215,96,.14)' : 'rgba(31,215,96,.06)',
                          border: `1.5px solid ${phonesMatch(c.phone, phone) ? 'rgba(31,215,96,.45)' : 'rgba(31,215,96,.15)'}`,
                        }}
                      >
                        <div style={{
                          width: 38, height: 38, borderRadius: 11, flexShrink: 0,
                          background: 'linear-gradient(135deg,#0F8A3A,#1FD760)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontFamily: 'Unbounded', fontSize: 16, fontWeight: 900, color: '#030B05',
                        }}>{c.name.charAt(0)}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: '#EBF5ED', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                          <div style={{ fontSize: 11, color: '#8FB897', marginTop: 1 }}>{c.phone}</div>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 800, color: '#FFB800', flexShrink: 0 }}>{c.bonus} б.</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button type="button" onClick={sendOtp} disabled={load} className="sl-btn sl-ub"
                style={{
                  width: '100%', padding: 16, borderRadius: 16,
                  background: 'linear-gradient(135deg,#17B34E 0%,#1FD760 50%,#17B34E 100%)',
                  border: 'none', color: '#030B05', fontWeight: 800, fontSize: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  boxShadow: '0 8px 28px rgba(31,215,96,.4)',
                  opacity: load ? .75 : 1,
                }}>
                {load ? <Spinner /> : <><span style={{ fontSize: 18 }}>📱</span> Получить код SMS</>}
              </button>
            </div>
          )}

          {step === 'otp' && (
            <div key="otp-step">
              <div className="sl-ub" style={{ fontSize: 15, fontWeight: 800, marginBottom: 4, color: '#EBF5ED', textAlign: 'center' }}>Подтверждение</div>
              <div style={{ fontSize: 12, color: '#8FB897', textAlign: 'center', marginBottom: 22, lineHeight: 1.5 }}>
                Код отправлен на<br />
                <span style={{ color: '#1FD760', fontWeight: 800, fontSize: 14 }}>+992 {phone}</span>
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
                    className="sl-inp sl-ub"
                    style={{
                      width: 58, height: 66, borderRadius: 16,
                      border: `2px solid ${v || focusedOtp === i ? 'rgba(31,215,96,.7)' : '#162B1A'}`,
                      background: v ? 'rgba(31,215,96,.14)' : '#0C1C0F',
                      textAlign: 'center', fontSize: 28, fontWeight: 900, color: '#EBF5ED',
                      boxShadow: focusedOtp === i ? '0 0 20px rgba(31,215,96,.25)' : v ? '0 4px 12px rgba(31,215,96,.15)' : 'none',
                    }}
                  />
                ))}
              </div>

              <div style={{
                padding: '12px 14px', borderRadius: 12, marginBottom: 18, textAlign: 'center',
                background: 'linear-gradient(90deg,rgba(255,184,0,.06),rgba(255,184,0,.12),rgba(255,184,0,.06))',
                backgroundSize: '200% 100%',
                animation: 'slShimmer 4s ease-in-out infinite',
                border: '1px solid rgba(255,184,0,.2)',
              }}>
                <div style={{ fontSize: 12, color: '#8FB897' }}>
                  💡 Демо-код: <span className="sl-ub" style={{ color: '#FFB800', fontWeight: 900, letterSpacing: 3 }}>1 2 3 4</span>
                </div>
                {cd > 0 && (
                  <div style={{ fontSize: 11, color: '#3D6645', marginTop: 6 }}>
                    Повторная отправка через <span style={{ color: '#1FD760', fontWeight: 800 }}>{cd}</span> сек
                  </div>
                )}
              </div>

              <button type="button" onClick={verify} disabled={load || !otpReady} className="sl-btn sl-ub"
                style={{
                  width: '100%', padding: 16, borderRadius: 16,
                  background: otpReady
                    ? 'linear-gradient(135deg,#17B34E,#1FD760)'
                    : 'linear-gradient(135deg,#0F8A3A,#17B34E)',
                  border: 'none', color: otpReady ? '#030B05' : 'white',
                  fontWeight: 800, fontSize: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  boxShadow: '0 8px 28px rgba(31,215,96,.35)',
                  opacity: !otpReady && !load ? .55 : load ? .75 : 1,
                }}>
                {load ? <Spinner /> : <>✓ Продолжить</>}
              </button>

              <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 14 }}>
                <button type="button" onClick={() => { setStep('phone'); setErr(''); setOtp(['', '', '', '']) }}
                  className="sl-btn" style={{ background: 'none', border: 'none', color: '#8FB897', fontSize: 12, fontWeight: 700 }}>
                  ← Изменить номер
                </button>
                {cd === 0 && (
                  <button type="button" onClick={sendOtp} className="sl-btn"
                    style={{ background: 'none', border: 'none', color: '#1FD760', fontSize: 12, fontWeight: 700 }}>
                    🔄 Отправить снова
                  </button>
                )}
              </div>
            </div>
          )}

          {step === 'register' && (
            <div key="register-step">
              <div className="sl-ub" style={{ fontSize: 15, fontWeight: 800, marginBottom: 4, color: '#EBF5ED' }}>Создание аккаунта</div>
              <div style={{ fontSize: 12, color: '#8FB897', marginBottom: 18, lineHeight: 1.45 }}>
                Номер <span style={{ color: '#1FD760', fontWeight: 700 }}>{formatTjPhone(phone)}</span> не найден — заполните данные
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div>
                  {fieldLabel('Имя *')}
                  <input className="sl-inp" value={reg.firstName} onChange={e => setRegField('firstName', e.target.value)}
                    placeholder="Диловар" autoFocus
                    style={{ width: '100%', padding: '12px 14px', borderRadius: 12, background: '#0C1C0F', border: '1.5px solid #162B1A', color: '#EBF5ED', fontSize: 14 }} />
                </div>
                <div>
                  {fieldLabel('Фамилия *')}
                  <input className="sl-inp" value={reg.lastName} onChange={e => setRegField('lastName', e.target.value)}
                    placeholder="Рахимов"
                    style={{ width: '100%', padding: '12px 14px', borderRadius: 12, background: '#0C1C0F', border: '1.5px solid #162B1A', color: '#EBF5ED', fontSize: 14 }} />
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                {fieldLabel('Адрес доставки *')}

                {!mapOpen ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setMapOpen(true)}
                      className="sl-btn"
                      style={{
                        width: '100%', marginBottom: 10, padding: '13px 14px', borderRadius: 14,
                        background: addrCoords ? 'rgba(31,215,96,.12)' : 'rgba(31,215,96,.08)',
                        border: `1.5px solid ${addrCoords ? 'rgba(31,215,96,.45)' : 'rgba(31,215,96,.35)'}`,
                        color: addrCoords ? '#1FD760' : '#8FB897',
                        fontSize: 13, fontWeight: 700, textAlign: 'left',
                      }}
                    >
                      {addrCoords ? '✓ Точка выбрана · изменить на карте' : '🗺 Указать точку на карте *'}
                    </button>
                    <input
                      className="sl-inp"
                      value={reg.addr}
                      onChange={e => setRegField('addr', e.target.value)}
                      placeholder="ул. Ленина, 42, кв. 5"
                      style={{ width: '100%', padding: '12px 14px', borderRadius: 12, background: '#0C1C0F', border: `1.5px solid ${addrCoords ? 'rgba(31,215,96,.45)' : '#162B1A'}`, color: '#EBF5ED', fontSize: 14 }}
                    />
                    {!addrCoords && (
                      <div style={{ marginTop: 8, fontSize: 11, color: '#FFB800', fontWeight: 600 }}>
                        ⚠️ Нажмите «Указать точку на карте» — курьер увидит ваш дом
                      </div>
                    )}
                    {addrCoords && (
                      <div style={{ marginTop: 8, fontSize: 11, color: '#1FD760', fontWeight: 600 }}>
                        ✓ Точка: {addrCoords.lat.toFixed(5)}, {addrCoords.lng.toFixed(5)}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ padding: 12, borderRadius: 16, border: '1px solid rgba(31,215,96,.25)', background: 'rgba(31,215,96,.05)' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1FD760', marginBottom: 8 }}>
                      Шаг · Подтвердите точку на карте
                    </div>
                    <AddressMapPicker
                      key={`reg-map-${addrCoords?.lat ?? 'new'}-${addrCoords?.lng ?? 'new'}`}
                      initial={addrCoords}
                      variant="admin"
                      hint="Нажмите на карту и подтвердите — адрес подставится автоматически"
                      mapHeight={200}
                      onSelect={({ lat, lng, address }) => {
                        setAddrCoords({ lat, lng })
                        setRegField('addr', address)
                        setMapOpen(false)
                        setErr('')
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setMapOpen(false)}
                      className="sl-btn"
                      style={{ marginTop: 8, fontSize: 11, color: '#8FB897', background: 'transparent', fontWeight: 600 }}
                    >
                      ← Скрыть карту
                    </button>
                  </div>
                )}
              </div>

              <div style={{ marginBottom: 14 }}>
                {fieldLabel('Email')}
                <input className="sl-inp" value={reg.email} onChange={e => setRegField('email', e.target.value)}
                  placeholder="example@mail.com" type="email"
                  style={{ width: '100%', padding: '12px 14px', borderRadius: 12, background: '#0C1C0F', border: '1.5px solid #162B1A', color: '#EBF5ED', fontSize: 14 }} />
              </div>

              <div style={{
                padding: '12px 14px', borderRadius: 12, marginBottom: 16, textAlign: 'center',
                background: 'rgba(255,184,0,.08)', border: '1px solid rgba(255,184,0,.25)',
              }}>
                <div className="sl-ub" style={{ fontSize: 13, fontWeight: 800, color: '#FFB800' }}>🎁 +100 приветственных бонусов</div>
              </div>

              <button type="button" onClick={saveRegister} disabled={load} className="sl-btn sl-ub"
                style={{
                  width: '100%', padding: 16, borderRadius: 16,
                  background: 'linear-gradient(135deg,#17B34E,#1FD760)',
                  border: 'none', color: '#030B05', fontWeight: 800, fontSize: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  boxShadow: '0 8px 28px rgba(31,215,96,.35)',
                  opacity: load ? .75 : 1,
                }}>
                {load ? <Spinner /> : <>✅ Создать аккаунт</>}
              </button>

              <button type="button" onClick={() => { setStep('otp'); setErr('') }}
                className="sl-btn" style={{ width: '100%', marginTop: 12, background: 'none', border: 'none', color: '#8FB897', fontSize: 12, fontWeight: 700 }}>
                ← Назад к коду
              </button>
            </div>
          )}
        </div>

        <div style={{ marginTop: 28, textAlign: 'center', fontSize: 10, color: '#3D6645', lineHeight: 1.6 }}>
          КАКАПО · Магазин · Таджикистан<br />
          <span style={{ color: '#2a4a32' }}>Только вход по номеру телефона</span>
        </div>
      </div>
    </div>
  )
}
