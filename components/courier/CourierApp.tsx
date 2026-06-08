'use client'
import { useState } from 'react'

/* ══════════════════════════════════════════════════
   KAKAPO КУРЬЕР — Redesigned Premium Map UI
══════════════════════════════════════════════════ */
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@700;800;900&family=Nunito:wght@400;600;700;800&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
  html,body{background:#04100A;color:#E8F5EC;font-family:'Nunito',sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden;height:100%;}
  .ub{font-family:'Unbounded',sans-serif;}
  .btn{cursor:pointer;border:none;transition:all .18s cubic-bezier(.16,1,.3,1);outline:none;background:none;}.btn:active{transform:scale(.95);}
  @keyframes spin  {from{transform:rotate(0)}to{transform:rotate(360deg)}}
  @keyframes pulse {0%,100%{opacity:1}50%{opacity:.35}}
  @keyframes ping  {0%{transform:scale(1);opacity:.8}100%{transform:scale(2.6);opacity:0}}
  @keyframes bob   {0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
  @keyframes pop   {0%{transform:scale(1)}50%{transform:scale(1.18)}100%{transform:scale(1)}}
  ::-webkit-scrollbar{width:0;height:0}
`

const COURIER = { name: 'Фирдавс Назаров', vehicle: 'TJ 1234 AA' }

const MAP_POS: Record<string, { x: number; y: number }> = {
  STORE:    { x: 170, y: 198 },
  'K-4831': { x: 268, y: 280 },
  'K-4835': { x: 358, y: 118 },
  'K-4838': { x: 170, y: 280 },
}

const ORDERS = [
  { id: 'K-4831', client: 'Нилуфар Хасанова', phone: '+992 90 123 45 67',
    addr: 'ул. Сомони, 12', dist: 3.4, weight: 8.5, earning: 5, pay: 'Карта',
    productSum: 42, deliveryFee: 5,
    items: [{ e: '🥛', n: 'Молоко', q: 2, p: 8 }, { e: '🧀', n: 'Сыр', q: 1, p: 18 }, { e: '☕', n: 'Кофе', q: 1, p: 8 }] },
  { id: 'K-4835', client: 'Рустам Давлатов', phone: '+992 91 445 23 11',
    addr: 'мкр. Мирный, 5', dist: 1.8, weight: 2.0, earning: 3, pay: 'Наличными',
    productSum: 24, deliveryFee: 3,
    items: [{ e: '🥦', n: 'Брокколи', q: 2, p: 7 }, { e: '🍅', n: 'Томаты', q: 1, p: 10 }] },
  { id: 'K-4838', client: 'Зафар Мирзоев', phone: '+992 88 789 01 23',
    addr: 'ул. Рудаки, 8', dist: 2.6, weight: 5.2, earning: 4, pay: 'Бонусы',
    productSum: 61, deliveryFee: 4,
    items: [{ e: '🍞', n: 'Хлеб', q: 2, p: 6 }, { e: '🥚', n: 'Яйца', q: 1, p: 22 }, { e: '🧃', n: 'Сок', q: 3, p: 9 }] },
]

const HISTORY = [
  { id: 'K-4820', client: 'Лола М.',   addr: 'ул. Ленина 5',    earning: 5, time: '13:20', dist: '2.1 км', productSum: 38, deliveryFee: 5 },
  { id: 'K-4815', client: 'Бахром К.', addr: 'мкр. Мирный 12',  earning: 4, time: '12:45', dist: '1.5 км', productSum: 29, deliveryFee: 4 },
  { id: 'K-4810', client: 'Зубайр Р.', addr: 'ул. Сомони 8',    earning: 6, time: '12:10', dist: '3.8 км', productSum: 55, deliveryFee: 6 },
]

// ── Beautiful City Map ─────────────────────────────────────
function Map({ orders, active, selId, step, done }: {
  orders: typeof ORDERS; active: any; selId: string | null; step: string; done: string[]
}) {
  const S = MAP_POS.STORE
  const aPin = active ? MAP_POS[active.id] : null
  const courier = !active ? { x: 170, y: 150 }
    : step === 'toStore'  ? { x: 170, y: 160 }
    : step === 'toClient' ? { x: S.x, y: S.y }
    : aPin ?? S

  const avail = orders.filter(o => !done.includes(o.id) && o.id !== active?.id)

  // All available order pins (for the map callout labels)
  const pinColors = ['#3B8EF0', '#9B6DFF', '#FF8C42']

  return (
    <svg viewBox="0 0 400 360" preserveAspectRatio="xMidYMid slice" style={{ width: '100%', height: '100%', display: 'block' }}>
      {/* ── Base ── */}
      <rect width="400" height="360" fill="#EAE5D5"/>

      {/* ── City blocks ── */}
      {[
        [0,0,61,43],[79,0,82,43],[169,0,82,43],[263,0,72,43],[349,0,51,43],
        [0,57,61,66],[169,57,82,66],[263,57,72,66],[349,57,51,66],
        [0,207,61,64],[79,207,82,64],[169,207,82,64],[263,207,72,64],[349,207,51,64],
        [0,285,61,75],[79,285,82,75],[169,285,82,75],[263,285,72,75],[349,285,51,75],
      ].map(([x,y,w,h],i) => <rect key={i} x={x} y={y} width={w} height={h} fill="#DDD9C9" rx="2"/>)}

      {/* ── Park ── */}
      <rect x="79" y="57" width="82" height="66" fill="#C2D9B0" rx="2"/>
      {[{x:100,y:75},{x:125,y:88},{x:148,y:72},{x:155,y:103},{x:107,y:108}].map((p,i)=>(
        <g key={i}>
          <circle cx={p.x} cy={p.y+6} rx="7" ry="3" fill="rgba(0,0,0,.08)"/>
          <circle cx={p.x} cy={p.y} r="8" fill="#8FC87A" opacity=".85"/>
          <circle cx={p.x} cy={p.y} r="5" fill="#A8D888" opacity=".6"/>
        </g>
      ))}
      <text x="120" y="103" fontSize="7" fill="#4A7A3A" textAnchor="middle" fontWeight="bold" opacity=".7">Парк Рудаки</text>

      {/* ── Roads ── */}
      {/* Horizontal */}
      <rect x="0" y="43"  width="400" height="14" fill="#F8F5EE"/>
      <rect x="0" y="125" width="400" height="13" fill="#F2EDDF"/>
      <rect x="0" y="193" width="400" height="14" fill="#F8F5EE"/>
      <rect x="0" y="275" width="400" height="10" fill="#F8F5EE"/>
      {/* Vertical */}
      <rect x="61"  y="0" width="18" height="360" fill="#F8F5EE"/>
      <rect x="161" y="0" width="16" height="360" fill="#F2EDDF"/>
      <rect x="251" y="0" width="12" height="360" fill="#F8F5EE"/>
      <rect x="349" y="0" width="13" height="360" fill="#F8F5EE"/>

      {/* Road dashes / center lines */}
      <line x1="0" y1="200" x2="400" y2="200" stroke="#DDD5AA" strokeWidth=".8" strokeDasharray="10,8" opacity=".6"/>
      <line x1="169" y1="0" x2="169" y2="360" stroke="#DDD5AA" strokeWidth=".8" strokeDasharray="10,8" opacity=".6"/>

      {/* Street labels */}
      <text x="169" y="185" fontSize="6.5" fill="#6A5A40" textAnchor="middle" fontWeight="bold">пр. Рудаки</text>
      <text x="40"  y="207" fontSize="5.5" fill="#7A6A50" textAnchor="middle" transform="rotate(-90,40,207)">ул. Ленина</text>
      <text x="40"  y="283" fontSize="5.5" fill="#7A6A50" textAnchor="middle" transform="rotate(-90,40,283)">ул. Сомони</text>
      <text x="315" y="119" fontSize="5.5" fill="#7A6A50" textAnchor="middle">мкр. Мирный</text>

      {/* ── Active route ── */}
      {active && step !== 'done' && aPin && (() => {
        const p1 = step === 'toStore' ? courier : S
        const p2 = step === 'toStore' ? S : aPin
        const mx = (p1.x + p2.x) / 2
        const my = Math.min(p1.y, p2.y) - 22
        const col = step === 'toStore' ? '#3B8EF0' : '#1FD760'
        return (
          <>
            <path d={`M${p1.x},${p1.y} Q${mx},${my} ${p2.x},${p2.y}`} fill="none" stroke={`${col}40`} strokeWidth="8" strokeLinecap="round"/>
            <path d={`M${p1.x},${p1.y} Q${mx},${my} ${p2.x},${p2.y}`} fill="none" stroke={col} strokeWidth="3" strokeDasharray="8,5" strokeLinecap="round" opacity=".9"/>
          </>
        )
      })()}

      {/* ── All available order pins (always visible) ── */}
      {ORDERS.filter(o => !done.includes(o.id) && o.id !== active?.id).map((order, i) => {
        const pos = MAP_POS[order.id]
        if (!pos) return null
        const isSel = selId === order.id
        const col = pinColors[i % pinColors.length]
        const idx = avail.findIndex(o2 => o2.id === order.id)
        return (
          <g key={order.id}>
            {/* Pulse ring */}
            <circle cx={pos.x} cy={pos.y - 14} r="18" fill={`${col}18`}
              style={{ animation: isSel ? 'ping 1.4s ease-out infinite' : undefined }}/>
            {/* Shadow */}
            <ellipse cx={pos.x} cy={pos.y + 2} rx="7" ry="2.5" fill="rgba(0,0,0,.22)"/>
            {/* Pin teardrop */}
            <path d={`M${pos.x},${pos.y} C${pos.x-9},${pos.y-8} ${pos.x-9},${pos.y-24} ${pos.x},${pos.y-28} C${pos.x+9},${pos.y-24} ${pos.x+9},${pos.y-8} ${pos.x},${pos.y}`}
              fill={isSel ? col : '#1A4AB8'} stroke="white" strokeWidth="2"/>
            {/* Number */}
            <circle cx={pos.x} cy={pos.y - 18} r="7" fill="white" opacity=".95"/>
            <text x={pos.x} y={pos.y - 15} fontSize="8" fill={isSel ? col : '#1A4AB8'} textAnchor="middle" fontWeight="900">{idx + 1}</text>
            {/* Earning callout (only when not selected) */}
            {!isSel && (
              <g>
                <rect x={pos.x + 10} y={pos.y - 34} width={32} height={14} rx="7" fill="#FFB800" opacity=".95"/>
                <text x={pos.x + 26} y={pos.y - 24} fontSize="7.5" fill="#030B05" textAnchor="middle" fontWeight="900">+{order.earning}</text>
              </g>
            )}
          </g>
        )
      })}

      {/* ── Active destination pin ── */}
      {aPin && (
        <g>
          <circle cx={aPin.x} cy={aPin.y - 14} r="22" fill="rgba(255,69,69,.14)" style={{ animation: 'ping 1.8s ease-out infinite' }}/>
          <ellipse cx={aPin.x} cy={aPin.y + 2} rx="7" ry="2.5" fill="rgba(0,0,0,.22)"/>
          <path d={`M${aPin.x},${aPin.y} C${aPin.x-9},${aPin.y-8} ${aPin.x-9},${aPin.y-24} ${aPin.x},${aPin.y-28} C${aPin.x+9},${aPin.y-24} ${aPin.x+9},${aPin.y-8} ${aPin.x},${aPin.y}`}
            fill="#E03030" stroke="white" strokeWidth="2.5"/>
          <text x={aPin.x} y={aPin.y - 14} fontSize="13" textAnchor="middle">📍</text>
        </g>
      )}

      {/* ── Store pin ── */}
      <g style={{ filter: 'drop-shadow(0 3px 6px rgba(23,179,78,.4))' }}>
        <ellipse cx={S.x} cy={S.y + 2} rx="8" ry="3" fill="rgba(0,0,0,.2)"/>
        <path d={`M${S.x},${S.y} C${S.x-10},${S.y-9} ${S.x-10},${S.y-26} ${S.x},${S.y-30} C${S.x+10},${S.y-26} ${S.x+10},${S.y-9} ${S.x},${S.y}`}
          fill="#17B34E" stroke="white" strokeWidth="2.5"/>
        <circle cx={S.x} cy={S.y - 20} r="8" fill="white" opacity=".2"/>
        <text x={S.x} y={S.y - 15} fontSize="13" textAnchor="middle">🏪</text>
      </g>

      {/* ── Courier pin ── */}
      <g style={{ animation: 'bob 2.4s ease-in-out infinite', filter: 'drop-shadow(0 4px 8px rgba(255,184,0,.5))' }}>
        <circle cx={courier.x} cy={courier.y} r="20" fill="rgba(255,184,0,.12)" style={{ animation: 'ping 2.5s ease-out infinite' }}/>
        <circle cx={courier.x} cy={courier.y} r="14" fill="#FFB800" stroke="white" strokeWidth="2.5"/>
        <text x={courier.x} y={courier.y + 5} fontSize="14" textAnchor="middle">🛵</text>
      </g>
    </svg>
  )
}

// ── Helpers ──────────────────────────────────────────────────
const PC = (p: string) => p === 'Наличными' ? '#1FD760' : p === 'Карта' ? '#3B8EF0' : '#FFB800'
const PBG = (p: string) => p === 'Наличными' ? 'rgba(31,215,96,.12)' : p === 'Карта' ? 'rgba(59,142,240,.12)' : 'rgba(255,184,0,.12)'
const PBD = (p: string) => p === 'Наличными' ? 'rgba(31,215,96,.3)' : p === 'Карта' ? 'rgba(59,142,240,.3)' : 'rgba(255,184,0,.3)'

function PriceSummary({ productSum, deliveryFee }: { productSum: number; deliveryFee: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
      {[
        ['Товары', productSum, '#FFB800', 'rgba(255,184,0,.06)', 'rgba(255,184,0,.18)'],
        ['Доставка', deliveryFee, '#3B8EF0', 'rgba(59,142,240,.06)', 'rgba(59,142,240,.18)'],
        ['Итого', productSum + deliveryFee, '#1FD760', 'rgba(31,215,96,.08)', 'rgba(31,215,96,.22)'],
      ].map(([l, v, c, bg, bd]) => (
        <div key={l as string} style={{ textAlign: 'center', padding: '10px 6px', borderRadius: 12, background: bg as string, border: `1px solid ${bd}` }}>
          <div style={{ fontSize: 9, color: '#4A6A50', fontWeight: 700, marginBottom: 4, letterSpacing: .4 }}>{l as string}</div>
          <div className="ub" style={{ fontSize: 14, fontWeight: 900, color: c as string }}>{v as number} ЅМ</div>
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
export default function CourierApp() {
  const [logged,      setLogged]      = useState(false)
  const [status,      setStatus]      = useState<'available' | 'busy' | 'offline'>('available')
  const [active,      setActive]      = useState<any>(null)
  const [step,        setStep]        = useState<'toStore' | 'toClient' | 'done'>('toStore')
  const [done,        setDone]        = useState<string[]>([])
  const [selected,    setSelected]    = useState<any>(null)
  const [showActive,  setShowActive]  = useState(false)
  const [tab,         setTab]         = useState<'orders' | 'earnings'>('orders')
  const [otp,         setOtp]         = useState(['', '', '', ''])
  const [err,         setErr]         = useState('')
  const [loading,     setLoading]     = useState(false)

  const verify = () => {
    if (otp.join('').length < 4) return
    setLoading(true)
    setTimeout(() => {
      if (otp.join('') === '1234') setLogged(true)
      else { setErr('Неверный код · Демо: 1234'); setOtp(['', '', '', '']) }
      setLoading(false)
    }, 700)
  }

  const accept = (order: any) => {
    setActive(order); setStatus('busy'); setStep('toStore')
    setSelected(null); setShowActive(true)
  }
  const finish = () => {
    setDone(d => [...d, active.id]); setActive(null)
    setStatus('available'); setShowActive(false)
  }

  const avail = ORDERS.filter(o => !done.includes(o.id) && o.id !== active?.id)

  // Sheet state: 'strip' | 'detail' | 'active' | 'earnings'
  const sheet = showActive && active ? 'active'
    : selected ? 'detail'
    : tab === 'earnings' ? 'earnings'
    : 'strip'

  const sheetH: Record<string, string> = {
    strip: '210px', detail: '72vh', active: '70vh', earnings: '78vh',
  }

  // ── LOGIN ──────────────────────────────────────────────────
  if (!logged) return (
    <div style={{ minHeight: '100vh', background: '#04100A', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, maxWidth: 480, margin: '0 auto' }}>
      <style>{CSS}</style>
      <a href="/" style={{ position: 'absolute', top: 18, left: 18, width: 40, height: 40, borderRadius: 12, background: '#0C1C0F', border: '1px solid #162B1A', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', color: '#8FB897', fontSize: 18 }}>←</a>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ width: 80, height: 80, borderRadius: 24, background: 'linear-gradient(135deg,#1E5BB5,#3B8EF0)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 38, margin: '0 auto 16px', boxShadow: '0 12px 40px rgba(59,142,240,.45)' }}>🛵</div>
        <div className="ub" style={{ fontSize: 20, fontWeight: 900, color: '#3B8EF0', marginBottom: 6 }}>Курьер KAKAPO</div>
        <div style={{ fontSize: 12, color: '#6A9070' }}>Введите OTP из SMS</div>
      </div>
      <div style={{ width: '100%', maxWidth: 340, background: '#081410', border: '1px solid #142018', borderRadius: 22, padding: 24 }}>
        {err && <div style={{ padding: '10px 13px', borderRadius: 11, background: 'rgba(255,69,69,.1)', border: '1px solid rgba(255,69,69,.28)', fontSize: 12, color: '#FF6060', marginBottom: 14 }}>⚠️ {err}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 16 }}>
          {otp.map((v, i) => (
            <input key={i} id={`o${i}`} value={v} type="tel" maxLength={1} inputMode="numeric"
              onChange={e => { const d = [...otp]; d[i] = e.target.value.replace(/\D/, '').slice(-1); setOtp(d); if (e.target.value && i < 3)(document.getElementById(`o${i + 1}`) as HTMLInputElement)?.focus() }}
              onKeyDown={e => { if (e.key === 'Backspace' && !v && i > 0)(document.getElementById(`o${i - 1}`) as HTMLInputElement)?.focus() }}
              style={{ width: 54, height: 62, borderRadius: 15, border: `2px solid ${v ? 'rgba(59,142,240,.6)' : '#182820'}`, background: v ? 'rgba(59,142,240,.1)' : '#0C1C0F', textAlign: 'center', fontFamily: 'Unbounded', fontSize: 26, fontWeight: 900, color: '#E8F5EC', outline: 'none' }}/>
          ))}
        </div>
        <div style={{ padding: '9px 13px', borderRadius: 10, background: 'rgba(59,142,240,.06)', border: '1px solid rgba(59,142,240,.18)', fontSize: 11, color: '#6A9070', marginBottom: 14, textAlign: 'center' }}>
          💡 Демо: <span style={{ color: '#3B8EF0', fontWeight: 700 }}>1 2 3 4</span>
        </div>
        <button onClick={verify} className="btn" style={{ width: '100%', padding: 15, borderRadius: 15, background: 'linear-gradient(135deg,#1E5BB5,#3B8EF0)', color: 'white', fontFamily: 'Nunito', fontWeight: 800, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: otp.join('').length < 4 ? .45 : 1, boxShadow: '0 8px 24px rgba(59,142,240,.35)' }}>
          {loading ? <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2.5px solid rgba(255,255,255,.3)', borderTopColor: 'white', animation: 'spin 1s linear infinite' }}/> : '🛵 Войти'}
        </button>
      </div>
    </div>
  )

  // ── MAIN ───────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, maxWidth: 480, margin: '0 auto', background: '#EAE5D5', overflow: 'hidden' }}>
      <style>{CSS}</style>

      {/* ── MAP ── */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <Map orders={ORDERS} active={active} selId={selected?.id ?? null} step={step} done={done}/>
      </div>

      {/* ── TOP BAR ── */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 40, padding: '44px 16px 16px', background: 'linear-gradient(to bottom,rgba(4,16,10,.96) 55%,transparent)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <a href="/" style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#E8F5EC', fontSize: 16, textDecoration: 'none', flexShrink: 0 }}>←</a>
          <div style={{ width: 38, height: 38, borderRadius: 11, background: 'linear-gradient(135deg,#1E5BB5,#3B8EF0)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0, boxShadow: '0 4px 12px rgba(59,142,240,.4)' }}>🛵</div>
          <div style={{ flex: 1 }}>
            <div className="ub" style={{ fontSize: 12, fontWeight: 900, color: '#E8F5EC' }}>{COURIER.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: status === 'available' ? '#1FD760' : status === 'busy' ? '#FFB800' : '#3D6645', animation: 'pulse 2s infinite', flexShrink: 0 }}/>
              <span style={{ fontSize: 10, color: '#8FB897' }}>
                {status === 'available' ? 'Свободен' : status === 'busy' ? 'В доставке' : 'Офлайн'} · 🏍 {COURIER.vehicle}
              </span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 8, color: '#3D6645', marginBottom: 1 }}>СЕГОДНЯ</div>
            <div className="ub" style={{ fontSize: 17, fontWeight: 900, color: '#FFB800', lineHeight: 1 }}>42 ЅМ</div>
          </div>
        </div>
      </div>

      {/* ── MAP CONTROL BUTTONS ── */}
      <div style={{ position: 'absolute', right: 13, zIndex: 40, bottom: `calc(${sheetH[sheet]} + 12px)`, display: 'flex', flexDirection: 'column', gap: 8, transition: 'bottom .32s cubic-bezier(.32,0,.67,0)' }}>
        {[['📍',''], ['＋',''], ['－','']].map(([ic], i) => (
          <button key={i} className="btn" style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(4,16,10,.88)', border: '1px solid rgba(255,255,255,.1)', color: '#E8F5EC', fontSize: i === 0 ? 17 : 19, backdropFilter: 'blur(12px)', boxShadow: '0 2px 10px rgba(0,0,0,.3)' }}>
            {ic}
          </button>
        ))}
      </div>

      {/* ── BOTTOM SHEET ── */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 60,
        height: sheetH[sheet], transition: 'height .35s cubic-bezier(.32,0,.67,0)',
        background: '#04100A', borderRadius: '20px 20px 0 0',
        boxShadow: '0 -8px 40px rgba(0,0,0,.7)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Handle */}
        <div style={{ padding: '10px 0 0', display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: '#1A3020' }}/>
        </div>

        {/* ─── STRIP mode ─── */}
        {sheet === 'strip' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Top row */}
            <div style={{ padding: '8px 16px 6px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {/* Status pills */}
              <div style={{ display: 'flex', gap: 5, flex: 1 }}>
                {([['available', 'Свободен', '#1FD760'], ['busy', 'Занят', '#FFB800'], ['offline', 'Офлайн', '#4A6050']] as const).map(([s, l, c]) => (
                  <button key={s} onClick={() => setStatus(s)} className="btn"
                    style={{ padding: '5px 9px', borderRadius: 8, fontSize: 9, fontWeight: 700, border: `1px solid ${status === s ? c : '#1A3020'}`, background: status === s ? `${c}18` : 'transparent', color: status === s ? c : '#4A6050', fontFamily: 'Nunito' }}>
                    {l}
                  </button>
                ))}
              </div>
              {active && (
                <button onClick={() => setShowActive(true)} className="btn"
                  style={{ padding: '5px 10px', borderRadius: 8, background: 'rgba(255,184,0,.1)', border: '1px solid rgba(255,184,0,.3)', color: '#FFB800', fontSize: 10, fontWeight: 700, fontFamily: 'Nunito', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#FFB800', animation: 'pulse 1s infinite', display: 'inline-block' }}/>
                  Доставка
                </button>
              )}
              <button onClick={() => setTab('earnings')} className="btn"
                style={{ padding: '5px 10px', borderRadius: 8, background: 'rgba(255,184,0,.08)', border: '1px solid rgba(255,184,0,.2)', color: '#FFB800', fontSize: 10, fontWeight: 700, fontFamily: 'Nunito' }}>
                💰
              </button>
            </div>

            {/* Order count label */}
            {status !== 'offline' && avail.length > 0 && (
              <div style={{ padding: '0 16px 8px', flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: '#6A9070', fontWeight: 700 }}>
                  {avail.length} {avail.length === 1 ? 'новый заказ' : 'новых заказа'} на карте
                </span>
              </div>
            )}

            {/* Horizontal order cards */}
            {status === 'offline' ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 20px', gap: 6 }}>
                <span style={{ fontSize: 34 }}>😴</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#E8F5EC' }}>Вы офлайн</span>
                <span style={{ fontSize: 11, color: '#4A6050', textAlign: 'center' }}>Включите «Свободен» для приёма заказов</span>
              </div>
            ) : avail.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <span style={{ fontSize: 34 }}>📭</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#E8F5EC' }}>Нет новых заказов</span>
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', gap: 10, padding: '0 16px 14px', overflowX: 'auto', alignItems: 'stretch' }}>
                {avail.map((order, idx) => (
                  <div key={order.id} onClick={() => setSelected(order)} className="btn"
                    style={{ width: 162, flexShrink: 0, background: selected?.id === order.id ? 'rgba(59,142,240,.12)' : '#081410', border: `1.5px solid ${selected?.id === order.id ? 'rgba(59,142,240,.45)' : '#142018'}`, borderRadius: 16, padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 5, cursor: 'pointer', animation: `fadeUp .3s ease ${idx * .07}s both` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div className="ub" style={{ fontSize: 10, color: '#3B8EF0', fontWeight: 800 }}>{order.id}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#E8F5EC', marginTop: 2 }}>{order.client.split(' ')[0]}</div>
                      </div>
                      <div className="ub" style={{ fontSize: 16, fontWeight: 900, color: '#1FD760', lineHeight: 1 }}>+{order.earning}<span style={{ fontSize: 9 }}> ЅМ</span></div>
                    </div>
                    <div style={{ fontSize: 10, color: '#4A6A50' }}>📍 {order.addr}</div>
                    <div style={{ display: 'flex', gap: 5, marginTop: 2 }}>
                      <span style={{ padding: '2px 7px', borderRadius: 6, fontSize: 9, fontWeight: 700, background: 'rgba(59,142,240,.1)', color: '#3B8EF0', border: '1px solid rgba(59,142,240,.2)' }}>{order.dist} км</span>
                      <span style={{ padding: '2px 7px', borderRadius: 6, fontSize: 9, fontWeight: 700, background: PBG(order.pay), color: PC(order.pay), border: `1px solid ${PBD(order.pay)}` }}>{order.pay}</span>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#FFB800', marginTop: 2 }}>{order.productSum + order.deliveryFee} ЅМ итого</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── DETAIL mode ─── */}
        {sheet === 'detail' && selected && (() => {
          const o = selected
          return (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Header */}
              <div style={{ padding: '8px 16px 10px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, borderBottom: '1px solid #0E1E14' }}>
                <button onClick={() => setSelected(null)} className="btn" style={{ width: 34, height: 34, borderRadius: 9, background: '#0C1C0F', border: '1px solid #142018', color: '#E8F5EC', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>←</button>
                <span className="ub" style={{ fontSize: 13, fontWeight: 900, color: '#E8F5EC' }}>{o.id}</span>
                <span style={{ padding: '3px 9px', borderRadius: 7, fontSize: 10, fontWeight: 700, background: PBG(o.pay), color: PC(o.pay), border: `1px solid ${PBD(o.pay)}` }}>{o.pay}</span>
                <div className="ub" style={{ marginLeft: 'auto', fontSize: 18, fontWeight: 900, color: '#1FD760' }}>+{o.earning} ЅМ</div>
              </div>
              {/* Content */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Client */}
                <div style={{ padding: '12px 14px', background: '#081410', border: '1px solid #112218', borderRadius: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#E8F5EC', marginBottom: 3 }}>{o.client}</div>
                    <a href={`tel:${o.phone}`} style={{ fontSize: 12, color: '#3B8EF0', fontWeight: 700, textDecoration: 'none' }}>📞 {o.phone}</a>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <span style={{ padding: '3px 8px', borderRadius: 7, fontSize: 10, fontWeight: 700, background: 'rgba(59,142,240,.1)', color: '#3B8EF0', border: '1px solid rgba(59,142,240,.2)' }}>📍 {o.dist} км</span>
                    <span style={{ padding: '3px 8px', borderRadius: 7, fontSize: 10, fontWeight: 700, background: 'rgba(255,184,0,.1)', color: '#FFB800', border: '1px solid rgba(255,184,0,.2)' }}>⚖️ {o.weight} кг</span>
                  </div>
                </div>
                {/* Route */}
                <div style={{ background: '#081410', border: '1px solid #112218', borderRadius: 14, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', borderBottom: '1px solid #0E1810' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#1FD760', boxShadow: '0 0 6px #1FD760' }}/>
                      <div style={{ width: 1.5, height: 14, background: 'repeating-linear-gradient(to bottom,#1A3020 0,#1A3020 4px,transparent 4px,transparent 7px)' }}/>
                    </div>
                    <div style={{ flex: 1 }}><div style={{ fontSize: 8, color: '#4A6050', fontWeight: 700, letterSpacing: .5, marginBottom: 2 }}>ЗАБРАТЬ</div><div style={{ fontSize: 13, fontWeight: 700 }}>KAKAPO, ул. Ленина 42</div></div>
                  </div>
                  <div style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: '#3B8EF0', boxShadow: '0 0 6px #3B8EF0', flexShrink: 0 }}/>
                    <div style={{ flex: 1 }}><div style={{ fontSize: 8, color: '#4A6050', fontWeight: 700, letterSpacing: .5, marginBottom: 2 }}>ДОСТАВИТЬ</div><div style={{ fontSize: 13, fontWeight: 700 }}>{o.addr}</div></div>
                  </div>
                </div>
                {/* Items */}
                <div style={{ background: '#081410', border: '1px solid #112218', borderRadius: 14, overflow: 'hidden' }}>
                  <div style={{ padding: '8px 14px', borderBottom: '1px solid #0E1810', fontSize: 9, color: '#4A6050', fontWeight: 700, letterSpacing: .5 }}>🛍 СОСТАВ</div>
                  <div style={{ padding: '4px 14px 10px' }}>
                    {o.items.map((it: any, i: number) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < o.items.length - 1 ? '1px solid #0E1810' : 'none' }}>
                        <span style={{ fontSize: 13 }}>{it.e} {it.n}</span>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <span style={{ fontSize: 10, color: '#4A6050' }}>×{it.q}</span>
                          <span className="ub" style={{ fontSize: 12, fontWeight: 800, color: '#FFB800', minWidth: 46, textAlign: 'right' }}>{it.p * it.q} ЅМ</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Price */}
                <PriceSummary productSum={o.productSum} deliveryFee={o.deliveryFee}/>
                {/* Payment */}
                <div style={{ padding: '10px 14px', borderRadius: 12, background: PBG(o.pay), border: `1px solid ${PBD(o.pay)}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 20 }}>{o.pay === 'Наличными' ? '💵' : o.pay === 'Карта' ? '💳' : '🎁'}</span>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{o.pay}</span>
                  </div>
                  <span className="ub" style={{ fontSize: 14, fontWeight: 900, color: PC(o.pay) }}>
                    {o.pay === 'Наличными' ? `${o.productSum + o.deliveryFee} ЅМ` : 'Оплачено'}
                  </span>
                </div>
                {/* Accept */}
                <button onClick={() => accept(o)} className="btn"
                  style={{ width: '100%', padding: 15, borderRadius: 15, background: 'linear-gradient(135deg,#17B34E,#1FD760)', color: '#030B05', fontFamily: 'Nunito', fontWeight: 800, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 8px 24px rgba(31,215,96,.4)' }}>
                  ✓ Принять заказ
                  <span style={{ padding: '2px 9px', borderRadius: 7, background: 'rgba(3,11,5,.25)', fontSize: 12 }}>+{o.earning} ЅМ</span>
                </button>
              </div>
            </div>
          )
        })()}

        {/* ─── ACTIVE mode ─── */}
        {sheet === 'active' && active && (() => {
          const o = active
          return (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Header */}
              <div style={{ padding: '8px 16px 10px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, borderBottom: '1px solid #0E1E14' }}>
                <button onClick={() => setShowActive(false)} className="btn" style={{ width: 34, height: 34, borderRadius: 9, background: '#0C1C0F', border: '1px solid #142018', color: '#E8F5EC', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>←</button>
                <span className="ub" style={{ fontSize: 13, fontWeight: 900 }}>{o.id}</span>
                <span style={{ padding: '3px 10px', borderRadius: 8, fontSize: 10, fontWeight: 700, background: step === 'done' ? 'rgba(31,215,96,.12)' : 'rgba(59,142,240,.12)', border: `1px solid ${step === 'done' ? 'rgba(31,215,96,.3)' : 'rgba(59,142,240,.3)'}`, color: step === 'done' ? '#1FD760' : '#3B8EF0' }}>
                  {step === 'toStore' ? '🏪 В магазин' : step === 'toClient' ? '🛵 К клиенту' : '✅ На месте'}
                </span>
                <div className="ub" style={{ marginLeft: 'auto', fontSize: 18, fontWeight: 900, color: '#1FD760' }}>+{o.earning} ЅМ</div>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Steps */}
                <div style={{ display: 'flex', padding: '4px 0' }}>
                  {([['toStore', '🏪', 'Магазин'], ['toClient', '🛵', 'К клиенту'], ['done', '✓', 'Готово']] as const).map(([s, e, l], i) => {
                    const isA = step === s
                    const isD = (step === 'toClient' && s === 'toStore') || (step === 'done' && s !== 'done')
                    return (
                      <div key={s} style={{ flex: 1, textAlign: 'center', position: 'relative' }}>
                        {i < 2 && <div style={{ position: 'absolute', top: 17, left: '50%', width: '100%', height: 2, background: isD ? '#1FD760' : '#142018' }}/>}
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: isA ? '#3B8EF0' : isD ? '#1FD760' : '#0C1C0F', border: `2px solid ${isA ? '#3B8EF0' : isD ? '#1FD760' : '#142018'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, margin: '0 auto 5px', position: 'relative', zIndex: 1 }}>{isD ? '✓' : e}</div>
                        <div style={{ fontSize: 9, color: isA ? '#3B8EF0' : isD ? '#1FD760' : '#4A6050', fontWeight: isA ? 700 : 500 }}>{l}</div>
                      </div>
                    )
                  })}
                </div>
                {/* Route */}
                <div style={{ background: '#081410', border: '1px solid #112218', borderRadius: 14, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', borderBottom: '1px solid #0E1810' }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#1FD760', boxShadow: '0 0 5px #1FD760', flexShrink: 0 }}/>
                    <div style={{ flex: 1 }}><div style={{ fontSize: 8, color: '#4A6050', fontWeight: 700, marginBottom: 2 }}>ЗАБРАТЬ</div><div style={{ fontSize: 13, fontWeight: 700 }}>KAKAPO, ул. Ленина 42</div></div>
                    <a href="tel:+992118559797" style={{ padding: '5px 9px', borderRadius: 8, background: 'rgba(31,215,96,.1)', border: '1px solid rgba(31,215,96,.25)', color: '#1FD760', fontSize: 11, fontWeight: 700, textDecoration: 'none' }}>📞</a>
                  </div>
                  <div style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: '#3B8EF0', boxShadow: '0 0 5px #3B8EF0', flexShrink: 0 }}/>
                    <div style={{ flex: 1 }}><div style={{ fontSize: 8, color: '#4A6050', fontWeight: 700, marginBottom: 2 }}>КЛИЕНТ</div><div style={{ fontSize: 13, fontWeight: 700 }}>{o.addr}</div><div style={{ fontSize: 11, color: '#8FB897', marginTop: 1 }}>{o.client}</div></div>
                    <a href={`tel:${o.phone}`} style={{ padding: '5px 9px', borderRadius: 8, background: 'rgba(59,142,240,.1)', border: '1px solid rgba(59,142,240,.25)', color: '#3B8EF0', fontSize: 11, fontWeight: 700, textDecoration: 'none' }}>📞</a>
                  </div>
                </div>
                {/* Items compact */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {o.items.map((it: any, i: number) => (
                    <span key={i} style={{ padding: '4px 9px', borderRadius: 8, fontSize: 11, background: '#081410', border: '1px solid #112218', color: '#E8F5EC', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {it.e} {it.n} <span style={{ color: '#4A6050' }}>×{it.q}</span>
                      <span style={{ color: '#FFB800', fontWeight: 700 }}>{it.p * it.q} ЅМ</span>
                    </span>
                  ))}
                </div>
                {/* Price */}
                <PriceSummary productSum={o.productSum} deliveryFee={o.deliveryFee}/>
                {/* Payment */}
                <div style={{ padding: '10px 14px', borderRadius: 12, background: PBG(o.pay), border: `1px solid ${PBD(o.pay)}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18 }}>{o.pay === 'Наличными' ? '💵' : o.pay === 'Карта' ? '💳' : '🎁'}</span>
                    <div><div style={{ fontSize: 8, color: '#4A6050', fontWeight: 700 }}>ОПЛАТА</div><div style={{ fontSize: 13, fontWeight: 700 }}>{o.pay}</div></div>
                  </div>
                  <span className="ub" style={{ fontSize: 15, fontWeight: 900, color: PC(o.pay) }}>
                    {o.pay === 'Наличными' ? `${o.productSum + o.deliveryFee} ЅМ` : 'Оплачено'}
                  </span>
                </div>
                {/* Action */}
                {step === 'toStore'  && <button onClick={() => setStep('toClient')} className="btn" style={{ width: '100%', padding: 15, borderRadius: 15, background: 'linear-gradient(135deg,#1E5BB5,#3B8EF0)', color: 'white', fontFamily: 'Nunito', fontWeight: 800, fontSize: 14, boxShadow: '0 6px 20px rgba(59,142,240,.35)' }}>📦 Забрал — еду к клиенту</button>}
                {step === 'toClient' && <button onClick={() => setStep('done')}     className="btn" style={{ width: '100%', padding: 15, borderRadius: 15, background: 'linear-gradient(135deg,#1E5BB5,#3B8EF0)', color: 'white', fontFamily: 'Nunito', fontWeight: 800, fontSize: 14, boxShadow: '0 6px 20px rgba(59,142,240,.35)' }}>🏁 Я на месте у клиента</button>}
                {step === 'done'     && <button onClick={finish}                    className="btn" style={{ width: '100%', padding: 15, borderRadius: 15, background: 'linear-gradient(135deg,#17B34E,#1FD760)', color: '#030B05', fontFamily: 'Nunito', fontWeight: 800, fontSize: 14, boxShadow: '0 8px 28px rgba(31,215,96,.45)' }}>✅ Доставлено — +{o.earning} ЅМ</button>}
              </div>
            </div>
          )
        })()}

        {/* ─── EARNINGS mode ─── */}
        {sheet === 'earnings' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '8px 16px 10px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, borderBottom: '1px solid #0E1E14' }}>
              <button onClick={() => setTab('orders')} className="btn" style={{ width: 34, height: 34, borderRadius: 9, background: '#0C1C0F', border: '1px solid #142018', color: '#E8F5EC', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>←</button>
              <span className="ub" style={{ fontSize: 13, fontWeight: 900 }}>Заработок</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Today summary */}
              <div style={{ background: 'linear-gradient(135deg,#071A28,#0D2840)', border: '1px solid rgba(59,142,240,.25)', borderRadius: 18, padding: '20px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 0%,rgba(59,142,240,.12),transparent 65%)', pointerEvents: 'none' }}/>
                <div style={{ fontSize: 10, color: '#6A9070', fontWeight: 700, marginBottom: 6 }}>СЕГОДНЯ</div>
                <div className="ub" style={{ fontSize: 40, fontWeight: 900, color: '#FFB800', lineHeight: 1, marginBottom: 8 }}>210 ЅМ</div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                  <span style={{ padding: '3px 10px', borderRadius: 8, background: 'rgba(31,215,96,.1)', border: '1px solid rgba(31,215,96,.22)', fontSize: 11, color: '#1FD760', fontWeight: 700 }}>📦 14 доставок</span>
                  <span style={{ padding: '3px 10px', borderRadius: 8, background: 'rgba(255,184,0,.1)', border: '1px solid rgba(255,184,0,.22)', fontSize: 11, color: '#FFB800', fontWeight: 700 }}>⭐ 4.9</span>
                </div>
              </div>
              {/* Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {([['За неделю', '1 240 ЅМ', '#1FD760', '📅'], ['Доставок', '342', '#3B8EF0', '🏆'], ['Ср./день', '177 ЅМ', '#FFB800', '📊'], ['Рейтинг', '4.9 ★', '#FFB800', '⭐']] as const).map(([l, v, c, ic]) => (
                  <div key={l} style={{ background: '#081410', border: `1px solid ${c}22`, borderRadius: 14, padding: '14px', textAlign: 'center' }}>
                    <div style={{ fontSize: 22, marginBottom: 5 }}>{ic}</div>
                    <div className="ub" style={{ fontSize: 17, fontWeight: 900, color: c, marginBottom: 3 }}>{v}</div>
                    <div style={{ fontSize: 9, color: '#4A6050', fontWeight: 700 }}>{l}</div>
                  </div>
                ))}
              </div>
              {/* History */}
              <div className="ub" style={{ fontSize: 12, fontWeight: 800, color: '#E8F5EC' }}>История</div>
              {HISTORY.map((h, i) => (
                <div key={i} style={{ background: '#081410', border: '1px solid #112218', borderRadius: 14, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #0E1810' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(31,215,96,.1)', border: '1px solid rgba(31,215,96,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>✓</div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className="ub" style={{ fontSize: 10, fontWeight: 800, color: '#3B8EF0' }}>{h.id}</span>
                          <span style={{ fontSize: 12, fontWeight: 700 }}>{h.client}</span>
                        </div>
                        <div style={{ fontSize: 10, color: '#4A6050', marginTop: 1 }}>{h.addr} · {h.dist} · {h.time}</div>
                      </div>
                    </div>
                    <div className="ub" style={{ fontSize: 14, fontWeight: 900, color: '#1FD760' }}>+{h.earning} ЅМ</div>
                  </div>
                  <div style={{ padding: '7px 13px', display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 9, fontWeight: 700, background: 'rgba(255,184,0,.07)', color: '#FFB800', border: '1px solid rgba(255,184,0,.15)' }}>Товары: {h.productSum} ЅМ</span>
                    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 9, fontWeight: 700, background: 'rgba(59,142,240,.07)', color: '#3B8EF0', border: '1px solid rgba(59,142,240,.15)' }}>Доставка: {h.deliveryFee} ЅМ</span>
                    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 9, fontWeight: 700, background: 'rgba(31,215,96,.07)', color: '#1FD760', border: '1px solid rgba(31,215,96,.15)' }}>Итого: {h.productSum + h.deliveryFee} ЅМ</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
