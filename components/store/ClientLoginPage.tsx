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
import { normalizePhone, type AdminClient } from '@/lib/clientCrm'
import { isClientInRecovery, restoreClientFromRecovery } from '@/lib/clientRecovery'
import { useClientStore, hydrateClientStore } from '@/lib/clientStore'
import { hydrateCardStore } from '@/lib/cardStore'
import { clearAppDataLocalCacheOnce } from '@/lib/localCache'
import { registerClientAccount } from '@/lib/clientCardSync'
import { formatClientAddressLine, setRegistrationDefaultAddress, ensureClientDefaultAddress } from '@/lib/clientAddresses'
import { migrateLegacyClientData } from '@/lib/clientAccountStorage'
import { setCurrentClientPhone } from '@/lib/clientNotifications'

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
  @keyframes slSlideUp{from{opacity:0;transform:translateY(32px)}to{opacity:1;transform:translateY(0)}}
`

type RegAddress = {
  street: string
  apt: string
  floor: string
  ent: string
  coords: { lat: number; lng: number } | null
  saved: boolean
}

function emptyRegAddress(): RegAddress {
  return { street: '', apt: '', floor: '', ent: '', coords: null, saved: false }
}

type Step = 'phone' | 'otp' | 'register' | 'restore'

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
  const [reg, setReg] = useState({ firstName: '', lastName: '', email: '' })
  const [savedAddr, setSavedAddr] = useState<RegAddress>(emptyRegAddress())
  const [showAddrSheet, setShowAddrSheet] = useState(false)
  const [draftStreet, setDraftStreet] = useState('')
  const [draftApt, setDraftApt] = useState('')
  const [draftFloor, setDraftFloor] = useState('')
  const [draftEnt, setDraftEnt] = useState('')
  const [draftCoords, setDraftCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [mapOpen, setMapOpen] = useState(false)
  const [addrErr, setAddrErr] = useState('')
  const [err, setErr] = useState('')
  const [load, setLoad] = useState(false)
  const [cd, setCd] = useState(0)
  const [focusedOtp, setFocusedOtp] = useState(-1)
  const [recoveryClient, setRecoveryClient] = useState<AdminClient | null>(null)
  const refs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ]

  useEffect(() => {
    clearAppDataLocalCacheOnce()
    hydrateClientStore()
    hydrateCardStore()
  }, [])

  useEffect(() => {
    if (step !== 'otp' || cd <= 0) return
    const t = setInterval(() => setCd(c => (c > 0 ? c - 1 : 0)), 1000)
    return () => clearInterval(t)
  }, [step, cd])

  const finishLogin = (user: StoreUser) => {
    saveStoreUser(user)
    setCurrentClientPhone(user.phone)
    migrateLegacyClientData(user.phone)
    if (user.addr?.trim()) {
      void ensureClientDefaultAddress(user.phone, user.addr)
    }
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
        setErr('Неверный код')
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
        if (isClientInRecovery(match)) {
          setRecoveryClient(match)
          setStep('restore')
          return
        }
        finishLogin(storeUserFromClient(match))
        return
      }
      setReg({ firstName: '', lastName: '', email: '' })
      setSavedAddr(emptyRegAddress())
      setShowAddrSheet(false)
      setMapOpen(false)
      setAddrErr('')
      setStep('register')
    }, 450)
  }

  const verify = () => verifyWithCode(otp.join(''))

  const confirmRestore = async () => {
    if (!recoveryClient || load) return
    setLoad(true)
    setErr('')
    try {
      await restoreClientFromRecovery(recoveryClient.id)
      finishLogin(storeUserFromClient({ ...recoveryClient, accountStatus: 'active', deletedAt: undefined }))
    } catch {
      setErr('Не удалось восстановить аккаунт')
    } finally {
      setLoad(false)
    }
  }

  const declineRestore = () => {
    setRecoveryClient(null)
    setStep('phone')
    setPhone('')
    setOtp(['', '', '', ''])
    setErr('')
  }

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

  const openAddrSheet = () => {
    if (savedAddr.saved) {
      setDraftStreet(savedAddr.street)
      setDraftApt(savedAddr.apt)
      setDraftFloor(savedAddr.floor)
      setDraftEnt(savedAddr.ent)
      setDraftCoords(savedAddr.coords)
    } else {
      setDraftStreet('')
      setDraftApt('')
      setDraftFloor('')
      setDraftEnt('')
      setDraftCoords(null)
    }
    setMapOpen(false)
    setAddrErr('')
    setShowAddrSheet(true)
  }

  const closeAddrSheet = () => {
    setShowAddrSheet(false)
    setMapOpen(false)
    setAddrErr('')
  }

  const saveAddrInSheet = () => {
    if (!draftCoords) { setAddrErr('Укажите точку на карте'); setMapOpen(true); return }
    if (!draftStreet.trim()) { setAddrErr('Укажите улицу и дом'); return }
    setSavedAddr({
      street: draftStreet.trim(),
      apt: draftApt.trim(),
      floor: draftFloor.trim(),
      ent: draftEnt.trim(),
      coords: draftCoords,
      saved: true,
    })
    closeAddrSheet()
    setErr('')
  }

  const saveRegister = async () => {
    if (!reg.firstName.trim()) { setErr('Укажите имя'); return }
    if (!reg.lastName.trim()) { setErr('Укажите фамилию'); return }
    if (!savedAddr.saved || !savedAddr.coords) { setErr('Добавьте адрес доставки'); openAddrSheet(); return }
    if (!savedAddr.street.trim()) { setErr('Укажите адрес доставки'); openAddrSheet(); return }
    setErr('')
    setLoad(true)
    try {
      const formattedPhone = formatTjPhone(phone)
      const fullName = `${reg.firstName.trim()} ${reg.lastName.trim()}`
      const newClient = await registerClientAccount({
        name: fullName,
        phone: formattedPhone,
        email: reg.email.trim(),
        addr: formatClientAddressLine(savedAddr),
        card: '',
        blocked: false,
        note: '',
        bonus: 100,
      })
      if (savedAddr.coords) {
        setRegistrationDefaultAddress({
          street: savedAddr.street,
          apt: savedAddr.apt,
          floor: savedAddr.floor,
          ent: savedAddr.ent,
          lat: savedAddr.coords.lat,
          lng: savedAddr.coords.lng,
          phone: formattedPhone,
        })
      }
      finishLogin(storeUserFromClient(newClient))
    } catch {
      setErr('Не удалось создать аккаунт. Попробуйте ещё раз.')
    } finally {
      setLoad(false)
    }
  }

  const otpReady = otp.join('').length === 4
  const stepLabels: { id: Step; label: string }[] = [
    { id: 'phone', label: 'Телефон' },
    { id: 'otp', label: 'Код SMS' },
    ...(step === 'register' ? [{ id: 'register' as Step, label: 'Профиль' }] : []),
    ...(step === 'restore' ? [{ id: 'restore' as Step, label: 'Восстановление' }] : []),
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

          {step === 'restore' && recoveryClient && (
            <div key="restore-step">
              <div style={{ fontSize: 48, textAlign: 'center', marginBottom: 12 }}>♻️</div>
              <div className="sl-ub" style={{ fontSize: 16, fontWeight: 800, marginBottom: 8, color: '#EBF5ED', textAlign: 'center' }}>
                Восстановить аккаунт?
              </div>
              <div style={{ fontSize: 13, color: '#8FB897', marginBottom: 20, lineHeight: 1.55, textAlign: 'center' }}>
                Аккаунт <strong style={{ color: '#EBF5ED' }}>{recoveryClient.name}</strong> ({formatTjPhone(phone)}) был удалён
                {recoveryClient.deletedAt ? ` · ${recoveryClient.deletedAt}` : ''}.
                <br />Восстановить профиль, бонусы и историю?
              </div>
              <button type="button" onClick={confirmRestore} disabled={load} className="sl-btn sl-ub"
                style={{
                  width: '100%', padding: 16, borderRadius: 16, marginBottom: 10,
                  background: 'linear-gradient(135deg,#17B34E,#1FD760)',
                  border: 'none', color: '#030B05', fontWeight: 800, fontSize: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  boxShadow: '0 8px 28px rgba(31,215,96,.35)', opacity: load ? .75 : 1,
                }}>
                {load ? <Spinner /> : <>✓ Да, восстановить</>}
              </button>
              <button type="button" onClick={declineRestore} disabled={load} className="sl-btn"
                style={{
                  width: '100%', padding: 14, borderRadius: 16,
                  background: '#0C1C0F', border: '1.5px solid #162B1A', color: '#8FB897',
                  fontWeight: 700, fontSize: 13,
                }}>
                Нет, оставить удалённым
              </button>
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

              <div style={{ marginBottom: 14 }}>
                {fieldLabel('Адрес доставки *')}
                {savedAddr.saved ? (
                  <div style={{
                    padding: '14px', borderRadius: 14, marginBottom: 10,
                    background: 'rgba(31,215,96,.08)', border: '1.5px solid rgba(31,215,96,.3)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <span style={{ fontSize: 22 }}>📍</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: '#EBF5ED', marginBottom: 4 }}>
                          {formatClientAddressLine(savedAddr)}
                        </div>
                        {savedAddr.coords && (
                          <div style={{ fontSize: 10, color: '#1FD760', fontWeight: 700 }}>
                            ✓ Точка на карте · {savedAddr.coords.lat.toFixed(4)}, {savedAddr.coords.lng.toFixed(4)}
                          </div>
                        )}
                      </div>
                    </div>
                    <button type="button" onClick={openAddrSheet} className="sl-btn"
                      style={{ width: '100%', marginTop: 10, padding: '10px', borderRadius: 10, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', fontSize: 12, fontWeight: 700 }}>
                      ✏️ Изменить адрес
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={openAddrSheet} className="sl-btn"
                    style={{
                      width: '100%', padding: '16px 14px', borderRadius: 14,
                      background: 'rgba(31,215,96,.06)', border: '1.5px dashed rgba(31,215,96,.35)',
                      color: '#1FD760', fontSize: 13, fontWeight: 700, textAlign: 'center',
                    }}>
                    <div style={{ fontSize: 26, marginBottom: 4 }}>📍</div>
                    Добавить адрес
                    <div style={{ fontSize: 11, color: '#3D6645', marginTop: 4, fontWeight: 600 }}>Карта · дом · квартира · этаж · подъезд</div>
                  </button>
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

      {showAddrSheet && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 400, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={closeAddrSheet} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.82)', backdropFilter: 'blur(8px)' }} />
          <div style={{
            position: 'relative', zIndex: 1, width: '100%', maxWidth: 480,
            background: '#091508', borderTop: '1px solid #162B1A',
            borderRadius: '24px 24px 0 0',
            padding: '20px 16px calc(28px + env(safe-area-inset-bottom, 0px))',
            maxHeight: '92vh', overflowY: 'auto', overflowX: 'hidden',
            animation: 'slSlideUp .4s cubic-bezier(.16,1,.3,1)',
          }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: '#1D3822', margin: '0 auto 18px' }} />
            <div className="sl-ub" style={{ fontSize: 16, fontWeight: 800, marginBottom: 6, color: '#EBF5ED' }}>Адрес доставки</div>
            <div style={{ fontSize: 12, color: '#8FB897', marginBottom: 16, lineHeight: 1.45 }}>
              Сначала укажите точку на карте, затем заполните дом, квартиру, этаж и подъезд
            </div>

            {addrErr && (
              <div style={{
                padding: '10px 12px', borderRadius: 12, marginBottom: 12,
                background: 'rgba(255,69,69,.08)', border: '1px solid rgba(255,69,69,.28)',
                fontSize: 12, color: '#FF6969', textAlign: 'center',
              }}>⚠️ {addrErr}</div>
            )}

            {!mapOpen ? (
              <button type="button" onClick={() => setMapOpen(true)} className="sl-btn"
                style={{
                  width: '100%', marginBottom: 14, padding: '14px', borderRadius: 14,
                  background: draftCoords ? 'rgba(31,215,96,.12)' : 'rgba(31,215,96,.08)',
                  border: `1.5px solid ${draftCoords ? 'rgba(31,215,96,.45)' : 'rgba(31,215,96,.35)'}`,
                  color: draftCoords ? '#1FD760' : '#8FB897',
                  fontSize: 13, fontWeight: 700, textAlign: 'left',
                }}>
                {draftCoords ? '✓ Точка выбрана · изменить на карте' : '🗺 Указать точку на карте *'}
              </button>
            ) : (
              <div style={{ marginBottom: 14 }}>
                <button type="button" onClick={() => setMapOpen(false)} className="sl-btn"
                  style={{ marginBottom: 8, padding: '6px 10px', borderRadius: 8, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', fontSize: 11, fontWeight: 700 }}>
                  ← Назад к полям
                </button>
                <AddressMapPicker
                  key={`reg-map-${draftCoords?.lat ?? 'new'}-${draftCoords?.lng ?? 'new'}`}
                  initial={draftCoords}
                  variant="admin"
                  hint="Нажмите на карту и подтвердите точку"
                  mapHeight={210}
                  onSelect={({ lat, lng, address }) => {
                    setDraftCoords({ lat, lng })
                    setDraftStreet(address)
                    setMapOpen(false)
                    setAddrErr('')
                  }}
                />
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                {fieldLabel('Улица, дом *')}
                <input className="sl-inp" value={draftStreet} onChange={e => setDraftStreet(e.target.value)}
                  placeholder="ул. Ленина, 42"
                  style={{ width: '100%', padding: '12px 14px', borderRadius: 12, background: '#0C1C0F', border: '1.5px solid #162B1A', color: '#EBF5ED', fontSize: 14 }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  {fieldLabel('Квартира')}
                  <input className="sl-inp" value={draftApt} onChange={e => setDraftApt(e.target.value)}
                    placeholder="15"
                    style={{ width: '100%', padding: '12px 14px', borderRadius: 12, background: '#0C1C0F', border: '1.5px solid #162B1A', color: '#EBF5ED', fontSize: 14 }} />
                </div>
                <div>
                  {fieldLabel('Этаж')}
                  <input className="sl-inp" value={draftFloor} onChange={e => setDraftFloor(e.target.value)}
                    placeholder="3"
                    style={{ width: '100%', padding: '12px 14px', borderRadius: 12, background: '#0C1C0F', border: '1.5px solid #162B1A', color: '#EBF5ED', fontSize: 14 }} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  {fieldLabel('Подъезд')}
                  <input className="sl-inp" value={draftEnt} onChange={e => setDraftEnt(e.target.value)}
                    placeholder="2"
                    style={{ width: '100%', padding: '12px 14px', borderRadius: 12, background: '#0C1C0F', border: '1.5px solid #162B1A', color: '#EBF5ED', fontSize: 14 }} />
                </div>
              </div>
            </div>

            {!draftCoords && (
              <div style={{ marginTop: 10, fontSize: 11, color: '#FFB800', fontWeight: 600 }}>
                ⚠️ Укажите точку на карте — курьер увидит ваш дом
              </div>
            )}

            <button type="button" onClick={saveAddrInSheet} className="sl-btn sl-ub"
              style={{
                width: '100%', marginTop: 16, padding: '14px', borderRadius: 15,
                background: 'linear-gradient(135deg,#17B34E,#1FD760)',
                border: 'none', color: '#030B05', fontSize: 14, fontWeight: 800,
                opacity: draftStreet.trim() && draftCoords ? 1 : 0.55,
              }}>
              📍 Сохранить адрес
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
