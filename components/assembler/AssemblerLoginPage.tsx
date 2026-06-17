'use client'
import { useState, useRef } from 'react'
import Link from 'next/link'
import {
  verifyAssemblerPin,
  assemblerStatusIcon,
  assemblerStatusLabel,
  type AdminAssembler,
} from '@/lib/assemblerTeam'

const LOGIN_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@700;800;900&family=Nunito:wght@400;600;700;800&display=swap');
  .al-root{font-family:'Nunito',sans-serif;}
  .al-ub{font-family:'Unbounded',sans-serif;}
  .al-btn{cursor:pointer;border:none;transition:all .22s cubic-bezier(.16,1,.3,1);}
  .al-btn:active:not(:disabled){transform:scale(.97);}
  .al-btn:disabled{cursor:not-allowed;}
  .al-inp{transition:border-color .2s,box-shadow .2s,background .2s,transform .15s;}
  .al-inp:focus{border-color:rgba(155,109,255,.7)!important;box-shadow:0 0 0 3px rgba(155,109,255,.18)!important;outline:none;}
  @keyframes alSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
  @keyframes alFadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
  @keyframes alFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
  @keyframes alGlow{0%,100%{box-shadow:0 0 28px rgba(155,109,255,.35),0 0 60px rgba(155,109,255,.12)}50%{box-shadow:0 0 40px rgba(155,109,255,.55),0 0 80px rgba(155,109,255,.2)}}
  @keyframes alPulseRing{0%{transform:scale(.92);opacity:.6}100%{transform:scale(1.35);opacity:0}}
  @keyframes alShimmer{0%{background-position:200% center}100%{background-position:-200% center}}
  @keyframes alOrb{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(12px,-18px) scale(1.08)}}
`

interface AssemblerLoginPageProps {
  assemblers: AdminAssembler[]
  onSuccess: (assembler: AdminAssembler) => void
}

function Spinner() {
  return (
    <div style={{
      width: 18, height: 18, borderRadius: '50%',
      border: '2.5px solid rgba(255,255,255,.25)',
      borderTopColor: 'white',
      animation: 'alSpin .8s linear infinite',
    }} />
  )
}

export default function AssemblerLoginPage({ assemblers, onSuccess }: AssemblerLoginPageProps) {
  const [pin, setPin] = useState(['', '', '', ''])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [load, setLoad] = useState(false)
  const [focusedPin, setFocusedPin] = useState(-1)
  const refs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ]

  const demoList = assemblers.filter(a => !a.blocked).slice(0, 3)
  const selected = selectedId ? assemblers.find(a => a.id === selectedId) : null
  const pinReady = pin.join('').length === 4

  const verifyWithCode = (code: string) => {
    if (code.length < 4 || load) return
    setErr('')
    setLoad(true)
    setTimeout(() => {
      const result = verifyAssemblerPin(assemblers, code, selectedId ?? undefined)
      setLoad(false)
      if (!result.ok) {
        setErr(result.error)
        setPin(['', '', '', ''])
        refs[0].current?.focus()
        return
      }
      onSuccess(result.assembler)
    }, 450)
  }

  const verify = () => verifyWithCode(pin.join(''))

  const handlePin = (i: number, v: string) => {
    const d = [...pin]
    d[i] = v.replace(/\D/g, '').slice(-1)
    setPin(d)
    setErr('')
    if (v && i < 3) refs[i + 1].current?.focus()
    if (d.every(x => x) && d.join('').length === 4) {
      setTimeout(() => verifyWithCode(d.join('')), 100)
    }
  }

  const handleKey = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pin[i] && i > 0) {
      refs[i - 1].current?.focus()
      const d = [...pin]
      d[i - 1] = ''
      setPin(d)
    }
    if (e.key === 'Enter' && pinReady) verify()
  }

  const pickDemo = (a: AdminAssembler) => {
    setSelectedId(a.id)
    setErr('')
    setPin(['', '', '', ''])
    setTimeout(() => refs[0].current?.focus(), 80)
  }

  return (
    <div className="al-root" style={{
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
          background: 'radial-gradient(circle,rgba(155,109,255,.22) 0%,transparent 70%)',
          animation: 'alOrb 8s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', bottom: '5%', left: '-25%', width: 320, height: 320, borderRadius: '50%',
          background: 'radial-gradient(circle,rgba(107,63,212,.1) 0%,transparent 70%)',
          animation: 'alOrb 10s ease-in-out infinite reverse',
        }} />
        <div style={{
          position: 'absolute', inset: 0, opacity: .04,
          backgroundImage: 'linear-gradient(rgba(155,109,255,.8) 1px,transparent 1px),linear-gradient(90deg,rgba(155,109,255,.8) 1px,transparent 1px)',
          backgroundSize: '32px 32px',
        }} />
      </div>

      <Link href="/" className="al-btn" style={{
        position: 'absolute', top: 18, left: 18, zIndex: 10,
        width: 42, height: 42, borderRadius: 13,
        background: 'rgba(9,21,8,.85)', backdropFilter: 'blur(12px)',
        border: '1px solid rgba(155,109,255,.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        textDecoration: 'none', color: '#8FB897', fontSize: 18,
      }}>←</Link>

      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '72px 22px 32px', position: 'relative', zIndex: 1,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32, animation: 'alFadeUp .55s ease both' }}>
          <div style={{ position: 'relative', width: 96, height: 96, margin: '0 auto 20px' }}>
            <div style={{
              position: 'absolute', inset: -8, borderRadius: 28,
              border: '2px solid rgba(155,109,255,.35)',
              animation: 'alPulseRing 2.2s ease-out infinite',
            }} />
            <div style={{
              width: 96, height: 96, borderRadius: 28,
              background: 'linear-gradient(145deg,#6B3FD4 0%,#9B6DFF 50%,#B794FF 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 46, animation: 'alFloat 3.5s ease-in-out infinite, alGlow 3s ease-in-out infinite',
              boxShadow: '0 12px 40px rgba(155,109,255,.4)',
            }}>📦</div>
          </div>
          <div className="al-ub" style={{
            fontSize: 24, fontWeight: 900, letterSpacing: '-.02em', marginBottom: 6,
            background: 'linear-gradient(135deg,#EBF5ED 0%,#9B6DFF 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>Сборщик КАКАПО</div>
          <div style={{ fontSize: 13, color: '#8FB897', lineHeight: 1.5 }}>
            Сборка заказов · <span style={{ color: '#9B6DFF', fontWeight: 700 }}>г. Яван</span>
          </div>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20,
          animation: 'alFadeUp .55s ease .08s both',
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 9,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 800,
            background: 'linear-gradient(135deg,#6B3FD4,#9B6DFF)',
            color: 'white',
            border: '1.5px solid rgba(155,109,255,.6)',
            boxShadow: '0 4px 14px rgba(155,109,255,.35)',
          }}>1</div>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#9B6DFF' }}>PIN-код</span>
        </div>

        <div style={{
          width: '100%', maxWidth: 360,
          background: 'linear-gradient(165deg,rgba(12,28,15,.95) 0%,rgba(9,21,8,.98) 100%)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(155,109,255,.18)',
          borderRadius: 24, padding: '26px 22px',
          boxShadow: '0 20px 60px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.04)',
          animation: 'alFadeUp .55s ease .14s both',
        }}>
          {err && (
            <div style={{
              padding: '11px 14px', borderRadius: 12, marginBottom: 16,
              background: 'rgba(255,69,69,.08)', border: '1px solid rgba(255,69,69,.28)',
              fontSize: 12, color: '#FF6969', textAlign: 'center', lineHeight: 1.45,
              animation: 'alFadeUp .3s ease',
            }}>⚠️ {err}</div>
          )}

          <div className="al-ub" style={{ fontSize: 15, fontWeight: 800, marginBottom: 4, color: '#EBF5ED', textAlign: 'center' }}>
            Вход для сборщика
          </div>
          <div style={{ fontSize: 12, color: '#8FB897', textAlign: 'center', marginBottom: 22, lineHeight: 1.5 }}>
            {selected
              ? <>Вы вошли как<br /><span style={{ color: '#9B6DFF', fontWeight: 800, fontSize: 14 }}>{selected.name}</span></>
              : 'Выберите профиль и введите PIN из админки'}
          </div>

          {demoList.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, color: '#3D6645', marginBottom: 8, fontWeight: 700, letterSpacing: .5, textTransform: 'uppercase' }}>
                Быстрый вход (демо)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {demoList.map(a => (
                  <button
                    key={a.id}
                    type="button"
                    className="al-btn"
                    onClick={() => pickDemo(a)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '11px 14px', borderRadius: 13, textAlign: 'left',
                      background: selectedId === a.id ? 'rgba(155,109,255,.14)' : 'rgba(155,109,255,.06)',
                      border: `1.5px solid ${selectedId === a.id ? 'rgba(155,109,255,.45)' : 'rgba(155,109,255,.15)'}`,
                    }}
                  >
                    <div style={{
                      width: 38, height: 38, borderRadius: 11, flexShrink: 0,
                      background: 'linear-gradient(135deg,#6B3FD4,#9B6DFF)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'Unbounded', fontSize: 14, fontWeight: 900, color: 'white',
                    }}>{a.name.charAt(0)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#EBF5ED', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                      <div style={{ fontSize: 11, color: '#8FB897', marginTop: 1 }}>
                        {assemblerStatusIcon(a.status)} {assemblerStatusLabel(a.status)}
                      </div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 800, color: '#9B6DFF', flexShrink: 0 }}>→</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ fontSize: 10, color: '#3D6645', marginBottom: 10, fontWeight: 800, letterSpacing: .6, textTransform: 'uppercase', textAlign: 'center' }}>
            PIN-код
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 20 }}>
            {pin.map((v, i) => (
              <input
                key={i}
                ref={refs[i]}
                value={v}
                type="password"
                maxLength={1}
                inputMode="numeric"
                autoComplete={i === 0 ? 'one-time-code' : 'off'}
                onFocus={() => setFocusedPin(i)}
                onBlur={() => setFocusedPin(-1)}
                onChange={e => handlePin(i, e.target.value)}
                onKeyDown={e => handleKey(i, e)}
                className="al-inp al-ub"
                style={{
                  width: 58, height: 66, borderRadius: 16,
                  border: `2px solid ${v || focusedPin === i ? 'rgba(155,109,255,.7)' : '#162B1A'}`,
                  background: v ? 'rgba(155,109,255,.14)' : '#0C1C0F',
                  textAlign: 'center', fontSize: 28, fontWeight: 900, color: '#EBF5ED',
                  boxShadow: focusedPin === i ? '0 0 20px rgba(155,109,255,.25)' : v ? '0 4px 12px rgba(155,109,255,.15)' : 'none',
                  transform: v ? 'scale(1.02)' : 'scale(1)',
                }}
              />
            ))}
          </div>

          <div style={{
            padding: '12px 14px', borderRadius: 12, marginBottom: 18, textAlign: 'center',
            background: 'linear-gradient(90deg,rgba(155,109,255,.06),rgba(155,109,255,.12),rgba(155,109,255,.06))',
            backgroundSize: '200% 100%',
            animation: 'alShimmer 4s ease-in-out infinite',
            border: '1px solid rgba(155,109,255,.2)',
          }}>
            <div style={{ fontSize: 12, color: '#8FB897' }}>
              💡 Демо PIN: <span className="al-ub" style={{ color: '#9B6DFF', fontWeight: 900, letterSpacing: 3 }}>5 6 7 8</span>
            </div>
          </div>

          <button type="button" onClick={verify} disabled={load || !pinReady} className="al-btn al-ub"
            style={{
              width: '100%', padding: 16, borderRadius: 16,
              background: pinReady
                ? 'linear-gradient(135deg,#6B3FD4,#9B6DFF)'
                : 'linear-gradient(135deg,#3D2A6B,#6B3FD4)',
              border: 'none', color: 'white',
              fontWeight: 800, fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              boxShadow: pinReady ? '0 8px 28px rgba(155,109,255,.4)' : '0 8px 28px rgba(107,63,212,.25)',
              opacity: !pinReady && !load ? .55 : load ? .75 : 1,
            }}>
            {load ? <Spinner /> : <><span style={{ fontSize: 18 }}>📦</span> Войти в кабинет</>}
          </button>
        </div>

        <div style={{
          marginTop: 28, textAlign: 'center', fontSize: 10, color: '#3D6645',
          animation: 'alFadeUp .55s ease .2s both', lineHeight: 1.6,
        }}>
          КАКАПО · Сборщик · Таджикистан<br />
          <span style={{ color: '#2a4a32' }}>Только для зарегистрированных сборщиков</span>
        </div>
      </div>
    </div>
  )
}
