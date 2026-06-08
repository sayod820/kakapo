'use client'
import { useState } from 'react'

/* ══════════════════════════════════════════════════
   KAKAPO КУРЬЕР — Map-first layout (VkusVill style)
══════════════════════════════════════════════════ */
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@700;800;900&family=Nunito:wght@400;600;700;800&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
  html,body{background:#ECE8DC;color:#EBF5ED;font-family:'Nunito',sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden;height:100%;}
  .ub{font-family:'Unbounded',sans-serif;}
  .btn{cursor:pointer;border:none;transition:all .2s cubic-bezier(.16,1,.3,1);}.btn:active{transform:scale(.96);}
  @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  @keyframes ping{0%{transform:scale(1);opacity:1}100%{transform:scale(2.2);opacity:0}}
  @keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
  ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#1D3822;border-radius:2px}
`

const COURIER = { name: 'Фирдавс Назаров', vehicle: '🏍 TJ 1234 AA' }

// SVG map coordinates (viewBox "0 0 400 360")
const MAP_POS: Record<string, { x: number; y: number }> = {
  STORE:   { x: 171, y: 201 },
  'K-4831': { x: 264, y: 283 },
  'K-4835': { x: 362, y: 120 },
  'K-4838': { x: 171, y: 283 },
}

const NEW_ORDERS = [
  {
    id: 'K-4831', client: 'Нилуфар Хасанова', phone: '+992 90 123 45 67',
    addr: 'ул. Сомони, 12', dist: 3.4, weight: 8.5, earning: 5, pay: 'Карта',
    productSum: 42, deliveryFee: 5,
    items: [{ e: '🥛', n: 'Молоко', q: 2, p: 8 }, { e: '🧀', n: 'Сыр', q: 1, p: 18 }, { e: '☕', n: 'Кофе', q: 1, p: 8 }],
  },
  {
    id: 'K-4835', client: 'Рустам Давлатов', phone: '+992 91 445 23 11',
    addr: 'мкр. Мирный, 5', dist: 1.8, weight: 2.0, earning: 3, pay: 'Наличными',
    productSum: 24, deliveryFee: 3,
    items: [{ e: '🥦', n: 'Брокколи', q: 2, p: 7 }, { e: '🍅', n: 'Томаты', q: 1, p: 10 }],
  },
  {
    id: 'K-4838', client: 'Зафар Мирзоев', phone: '+992 88 789 01 23',
    addr: 'ул. Рудаки, 8', dist: 2.6, weight: 5.2, earning: 4, pay: 'Бонусы',
    productSum: 61, deliveryFee: 4,
    items: [{ e: '🍞', n: 'Хлеб', q: 2, p: 6 }, { e: '🥚', n: 'Яйца', q: 1, p: 22 }, { e: '🧃', n: 'Сок', q: 3, p: 9 }],
  },
]

const HISTORY = [
  { id: 'K-4820', client: 'Лола М.', addr: 'ул. Ленина 5', earning: 5, time: '13:20', dist: '2.1 км', productSum: 38, deliveryFee: 5 },
  { id: 'K-4815', client: 'Бахром К.', addr: 'мкр. Мирный 12', earning: 4, time: '12:45', dist: '1.5 км', productSum: 29, deliveryFee: 4 },
  { id: 'K-4810', client: 'Зубайр Р.', addr: 'ул. Сомони 8', earning: 6, time: '12:10', dist: '3.8 км', productSum: 55, deliveryFee: 6 },
]

// ── City Map SVG ─────────────────────────────────────────────────
function CityMap({
  orders, activeOrder, selectedId, step, completed,
}: {
  orders: typeof NEW_ORDERS; activeOrder: any; selectedId: string | null; step: string; completed: string[]
}) {
  const store = MAP_POS.STORE
  const activePin = activeOrder ? MAP_POS[activeOrder.id] : null

  const courierPos =
    !activeOrder
      ? { x: 172, y: 148 }
      : step === 'toStore'
        ? { x: 172, y: 158 }
        : step === 'toClient'
          ? { x: store.x, y: store.y }
          : activePin ?? store

  return (
    <svg viewBox="0 0 400 360" preserveAspectRatio="xMidYMid slice" style={{ width: '100%', height: '100%', display: 'block' }}>
      {/* Base land */}
      <rect width="400" height="360" fill="#EDE8DC" />

      {/* City blocks */}
      {[
        [0,0,63,45],[79,0,84,45],[179,0,84,45],[279,0,74,45],[363,0,37,45],
        [0,59,63,68],[179,59,84,68],[279,59,74,68],[363,59,37,68],
        [0,209,63,66],[79,209,84,66],[179,209,84,66],[279,209,74,66],[363,209,37,66],
        [0,291,63,69],[79,291,84,69],[179,291,84,69],[279,291,74,69],[363,291,37,69],
      ].map(([x,y,w,h],i) => <rect key={i} x={x} y={y} width={w} height={h} fill="#E0DBD0" rx="2"/>)}

      {/* Park */}
      <rect x="79" y="59" width="84" height="68" fill="#C8DDB8" rx="2"/>
      {[{x:104,y:80},{x:128,y:93},{x:150,y:77},{x:157,y:106},{x:113,y:112}].map((p,i)=>(
        <circle key={i} cx={p.x} cy={p.y} r="7" fill="#8EC87A" opacity="0.65"/>
      ))}
      <text x="121" y="107" fontSize="7" fill="#4A7A4A" textAnchor="middle" opacity="0.75" fontWeight="bold">Парк Рудаки</text>

      {/* Horizontal roads */}
      <rect x="0" y="45"  width="400" height="14" fill="#FAF8F2"/>
      <rect x="0" y="127" width="400" height="14" fill="#F5F0E8"/>
      <rect x="0" y="195" width="400" height="14" fill="#FAF8F2"/>
      <rect x="0" y="277" width="400" height="14" fill="#FAF8F2"/>

      {/* Vertical roads */}
      <rect x="63"  y="0" width="16" height="360" fill="#FAF8F2"/>
      <rect x="163" y="0" width="16" height="360" fill="#F5F0E8"/>
      <rect x="263" y="0" width="14" height="360" fill="#FAF8F2"/>
      <rect x="363" y="0" width="14" height="360" fill="#FAF8F2"/>

      {/* Road centerlines */}
      <line x1="0" y1="202" x2="400" y2="202" stroke="#D8CC98" strokeWidth="0.8" strokeDasharray="9,7" opacity="0.5"/>
      <line x1="171" y1="0" x2="171" y2="360" stroke="#D8CC98" strokeWidth="0.8" strokeDasharray="9,7" opacity="0.5"/>

      {/* Street labels */}
      <text x="171" y="188" fontSize="6.5" fill="#7A6A50" textAnchor="middle" fontWeight="bold">пр. Рудаки</text>
      <text x="36"  y="209" fontSize="6"   fill="#8A7A60" textAnchor="middle" transform="rotate(-90,36,209)">ул. Ленина</text>
      <text x="36"  y="291" fontSize="6"   fill="#8A7A60" textAnchor="middle" transform="rotate(-90,36,291)">ул. Сомони</text>
      <text x="316" y="122" fontSize="6"   fill="#8A7A60" textAnchor="middle">мкр. Мирный</text>

      {/* Active route */}
      {activeOrder && step !== 'done' && activePin && (() => {
        if (step === 'toStore') {
          return <path
            d={`M${courierPos.x},${courierPos.y} Q${(courierPos.x + store.x) / 2},${Math.min(courierPos.y, store.y) - 20} ${store.x},${store.y}`}
            fill="none" stroke="#3B8EF0" strokeWidth="3.5" strokeDasharray="7,5" strokeLinecap="round" opacity="0.9"/>
        }
        return <path
          d={`M${store.x},${store.y} Q${(store.x + activePin.x) / 2},${(store.y + activePin.y) / 2 - 20} ${activePin.x},${activePin.y}`}
          fill="none" stroke="#1FD760" strokeWidth="3.5" strokeDasharray="7,5" strokeLinecap="round" opacity="0.9"/>
      })()}

      {/* Available order pins */}
      {orders.filter(o => !completed.includes(o.id) && o.id !== activeOrder?.id).map((order, i) => {
        const pos = MAP_POS[order.id]
        if (!pos) return null
        const sel = selectedId === order.id
        return (
          <g key={order.id}>
            {sel && <circle cx={pos.x} cy={pos.y - 4} r="22" fill="rgba(59,142,240,.18)" style={{ animation: 'ping 1.5s ease-out infinite' }}/>}
            <ellipse cx={pos.x} cy={pos.y + 15} rx="7" ry="2.5" fill="rgba(0,0,0,.18)"/>
            <path d={`M${pos.x},${pos.y + 13} L${pos.x - 8},${pos.y - 1} A8,8 0 1,1 ${pos.x + 8},${pos.y - 1} Z`}
              fill={sel ? '#2A6EE8' : '#1A4FCC'} stroke="white" strokeWidth="2"/>
            <circle cx={pos.x} cy={pos.y - 3} r="4.5" fill="white" opacity="0.9"/>
            <text x={pos.x} y={pos.y} fontSize="7" fill={sel ? '#2A6EE8' : '#1A4FCC'} textAnchor="middle" fontWeight="900">{i + 1}</text>
          </g>
        )
      })}

      {/* Active destination pin */}
      {activePin && (
        <g>
          <circle cx={activePin.x} cy={activePin.y - 3} r="20" fill="rgba(255,69,69,.12)" style={{ animation: 'ping 2s ease-out infinite' }}/>
          <ellipse cx={activePin.x} cy={activePin.y + 14} rx="7" ry="2.5" fill="rgba(0,0,0,.18)"/>
          <path d={`M${activePin.x},${activePin.y + 12} L${activePin.x - 8},${activePin.y - 2} A8,8 0 1,1 ${activePin.x + 8},${activePin.y - 2} Z`}
            fill="#E03030" stroke="white" strokeWidth="2"/>
          <text x={activePin.x} y={activePin.y + 2} fontSize="10" textAnchor="middle">📍</text>
        </g>
      )}

      {/* Store pin */}
      <g>
        <ellipse cx={store.x} cy={store.y + 13} rx="7" ry="2.5" fill="rgba(0,0,0,.18)"/>
        <path d={`M${store.x},${store.y + 11} L${store.x - 8},${store.y - 2} A8,8 0 1,1 ${store.x + 8},${store.y - 2} Z`}
          fill="#17B34E" stroke="white" strokeWidth="2"/>
        <text x={store.x} y={store.y + 2} fontSize="10" textAnchor="middle">🏪</text>
      </g>

      {/* Courier pin */}
      <g>
        <circle cx={courierPos.x} cy={courierPos.y} r="18" fill="rgba(255,184,0,.15)" style={{ animation: 'ping 2.5s ease-out infinite' }}/>
        <circle cx={courierPos.x} cy={courierPos.y} r="12" fill="#FFB800" stroke="white" strokeWidth="2.5"/>
        <text x={courierPos.x} y={courierPos.y + 4} fontSize="12" textAnchor="middle">🛵</text>
      </g>
    </svg>
  )
}

// ── Mini Map thumbnail inside order card ──────────────────────────
function MiniMap({ orderId }: { orderId: string }) {
  const store = MAP_POS.STORE
  const pin = MAP_POS[orderId]
  if (!pin) return null
  const minX = Math.min(store.x, pin.x) - 30
  const minY = Math.min(store.y, pin.y) - 30
  const w = Math.abs(store.x - pin.x) + 60
  const h = Math.abs(store.y - pin.y) + 60
  const vb = `${minX} ${minY} ${Math.max(w, 80)} ${Math.max(h, 80)}`
  return (
    <svg viewBox={vb} style={{ width: '100%', height: '100%', display: 'block' }} preserveAspectRatio="xMidYMid slice">
      <rect width="400" height="360" fill="#EDE8DC"/>
      <rect x="0" y="195" width="400" height="12" fill="#FAF8F2"/>
      <rect x="0" y="277" width="400" height="12" fill="#FAF8F2"/>
      <rect x="163" y="0" width="14" height="360" fill="#F5F0E8"/>
      <rect x="263" y="0" width="12" height="360" fill="#FAF8F2"/>
      <rect x="79" y="59" width="84" height="68" fill="#C8DDB8"/>
      {[{x:104,y:80},{x:128,y:93},{x:150,y:77}].map((p,i)=>(
        <circle key={i} cx={p.x} cy={p.y} r="6" fill="#8EC87A" opacity="0.6"/>
      ))}
      {/* Route line */}
      <line x1={store.x} y1={store.y} x2={pin.x} y2={pin.y} stroke="#3B8EF0" strokeWidth="2.5" strokeDasharray="6,4" opacity="0.8"/>
      {/* Store */}
      <circle cx={store.x} cy={store.y} r="8" fill="#17B34E" stroke="white" strokeWidth="1.5"/>
      <text x={store.x} y={store.y + 4} fontSize="9" textAnchor="middle">🏪</text>
      {/* Pin */}
      <circle cx={pin.x} cy={pin.y} r="8" fill="#1A4FCC" stroke="white" strokeWidth="1.5"/>
      <circle cx={pin.x} cy={pin.y} r="4" fill="white" opacity="0.8"/>
    </svg>
  )
}

// ── Helpers ──────────────────────────────────────────────────────
const payColor  = (p: string) => p === 'Наличными' ? '#1FD760' : p === 'Карта' ? '#3B8EF0' : '#FFB800'
const payBg     = (p: string) => p === 'Наличными' ? 'rgba(31,215,96,.1)' : p === 'Карта' ? 'rgba(59,142,240,.1)' : 'rgba(255,184,0,.1)'
const payBorder = (p: string) => p === 'Наличными' ? 'rgba(31,215,96,.25)' : p === 'Карта' ? 'rgba(59,142,240,.25)' : 'rgba(255,184,0,.25)'

// ═══════════════════════════════════════════════════════════════
export default function CourierApp() {
  const [logged,       setLogged]       = useState(false)
  const [tab,          setTab]          = useState<'orders' | 'earnings'>('orders')
  const [status,       setStatus]       = useState<'available' | 'busy' | 'offline'>('available')
  const [activeOrder,  setActiveOrder]  = useState<any>(null)
  const [step,         setStep]         = useState<'toStore' | 'toClient' | 'done'>('toStore')
  const [completed,    setCompleted]    = useState<string[]>([])
  const [selectedOrder,setSelectedOrder]= useState<any>(null)
  const [showActive,   setShowActive]   = useState(false)
  const [otp,          setOtp]          = useState(['', '', '', ''])
  const [err,          setErr]          = useState('')
  const [load,         setLoad]         = useState(false)

  const verify = () => {
    if (otp.join('').length < 4) return
    setLoad(true)
    setTimeout(() => {
      if (otp.join('') === '1234') setLogged(true)
      else { setErr('Неверный код · Демо: 1234'); setOtp(['', '', '', '']) }
      setLoad(false)
    }, 700)
  }

  const acceptOrder = (order: any) => {
    setActiveOrder(order); setStatus('busy'); setStep('toStore')
    setSelectedOrder(null); setShowActive(true)
  }
  const finishDelivery = () => {
    setCompleted(c => [...c, activeOrder.id])
    setActiveOrder(null); setStatus('available'); setShowActive(false)
  }

  const available = NEW_ORDERS.filter(o => !completed.includes(o.id) && o.id !== activeOrder?.id)

  // Sheet mode logic
  const sheetMode =
    showActive && activeOrder ? 'active'
    : selectedOrder           ? 'detail'
    : tab === 'earnings'      ? 'earnings'
    : 'list'

  const sheetH = sheetMode === 'detail' ? '73vh' : sheetMode === 'active' ? '68vh' : sheetMode === 'earnings' ? '76vh' : '47vh'

  // ── Login screen ────────────────────────────────────────────
  if (!logged) return (
    <div style={{ minHeight: '100vh', background: '#030B05', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, maxWidth: 480, margin: '0 auto' }}>
      <style>{CSS}</style>
      <a href="/" style={{ position: 'absolute', top: 18, left: 18, width: 40, height: 40, borderRadius: 12, background: '#0C1C0F', border: '1px solid #162B1A', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', color: '#8FB897', fontSize: 18 }}>←</a>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontSize: 54, marginBottom: 14 }}>🛵</div>
        <div className="ub" style={{ fontSize: 20, fontWeight: 900, color: '#3B8EF0', marginBottom: 4 }}>Курьер KAKAPO</div>
        <div style={{ fontSize: 12, color: '#8FB897' }}>Введите OTP код из SMS</div>
      </div>
      <div style={{ width: '100%', maxWidth: 340, background: '#091508', border: '1px solid #162B1A', borderRadius: 20, padding: 24 }}>
        {err && <div style={{ padding: 9, borderRadius: 10, background: 'rgba(255,69,69,.1)', border: '1px solid rgba(255,69,69,.3)', fontSize: 12, color: '#FF4545', marginBottom: 12 }}>⚠️ {err}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 14 }}>
          {otp.map((v, i) => (
            <input key={i} id={`o${i}`} value={v} type="tel" maxLength={1} inputMode="numeric"
              onChange={e => { const d = [...otp]; d[i] = e.target.value.replace(/\D/, '').slice(-1); setOtp(d); if (e.target.value && i < 3)(document.getElementById(`o${i + 1}`) as HTMLInputElement)?.focus() }}
              onKeyDown={e => { if (e.key === 'Backspace' && !v && i > 0)(document.getElementById(`o${i - 1}`) as HTMLInputElement)?.focus() }}
              style={{ width: 52, height: 60, borderRadius: 14, border: `2px solid ${v ? 'rgba(59,142,240,.5)' : '#162B1A'}`, background: v ? 'rgba(59,142,240,.08)' : '#0C1C0F', textAlign: 'center', fontFamily: 'Unbounded', fontSize: 24, fontWeight: 900, color: '#EBF5ED', outline: 'none' }}/>
          ))}
        </div>
        <div style={{ padding: 9, borderRadius: 9, background: 'rgba(59,142,240,.06)', border: '1px solid rgba(59,142,240,.2)', fontSize: 11, color: '#8FB897', marginBottom: 12, textAlign: 'center' }}>
          💡 Демо OTP: <span style={{ color: '#3B8EF0', fontWeight: 700 }}>1 2 3 4</span>
        </div>
        <button onClick={verify} className="btn" style={{ width: '100%', padding: 14, borderRadius: 14, background: 'linear-gradient(135deg,#1E5BB5,#3B8EF0)', border: 'none', color: 'white', fontFamily: 'Nunito', fontWeight: 800, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: otp.join('').length < 4 ? .5 : 1 }}>
          {load ? <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2.5px solid rgba(255,255,255,.3)', borderTopColor: 'white', animation: 'spin 1s linear infinite' }}/> : '🛵 Войти'}
        </button>
      </div>
    </div>
  )

  // ── Main app ─────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, maxWidth: 480, margin: '0 auto', overflow: 'hidden', background: '#ECE8DC' }}>
      <style>{CSS}</style>

      {/* ── MAP fills entire background ── */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <CityMap
          orders={available} activeOrder={activeOrder}
          selectedId={selectedOrder?.id || null} step={step} completed={completed}
        />
      </div>

      {/* ── TOP HEADER OVERLAY ── */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50, padding: '46px 16px 24px', background: 'linear-gradient(to bottom,rgba(3,11,5,.94) 55%,transparent)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <a href="/" style={{ width: 38, height: 38, borderRadius: 11, background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#EBF5ED', fontSize: 17, textDecoration: 'none', flexShrink: 0 }}>←</a>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg,#1E5BB5,#3B8EF0)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0, boxShadow: '0 4px 14px rgba(59,142,240,.4)' }}>🛵</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ub" style={{ fontSize: 13, fontWeight: 900, color: '#EBF5ED', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{COURIER.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: status === 'available' ? '#1FD760' : status === 'busy' ? '#FFB800' : '#3D6645', animation: 'pulse 2s infinite', boxShadow: status === 'available' ? '0 0 5px #1FD760' : 'none', flexShrink: 0 }}/>
              <span style={{ fontSize: 10, color: '#A0B8A8', whiteSpace: 'nowrap' }}>
                {status === 'available' ? 'Свободен' : status === 'busy' ? 'В заказе' : 'Офлайн'} · {COURIER.vehicle}
              </span>
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 9, color: '#3D6645', marginBottom: 1 }}>СЕГОДНЯ</div>
            <div className="ub" style={{ fontSize: 16, fontWeight: 900, color: '#FFB800', lineHeight: 1 }}>42 ЅМ</div>
            <div style={{ fontSize: 9, color: '#3D6645', marginTop: 1 }}>14 доставок</div>
          </div>
        </div>
      </div>

      {/* ── MAP BUTTONS ── */}
      <div style={{ position: 'absolute', right: 14, zIndex: 50, bottom: `calc(${sheetH} + 12px)`, display: 'flex', flexDirection: 'column', gap: 8, transition: 'bottom .35s cubic-bezier(.32,0,.67,0)' }}>
        {[['📍', 'Моё место'], ['＋', 'Приблизить'], ['－', 'Отдалить']].map(([icon, title], i) => (
          <button key={i} title={title} className="btn" style={{ width: 44, height: 44, borderRadius: 13, background: 'rgba(9,15,9,.88)', border: '1px solid rgba(255,255,255,.1)', color: '#EBF5ED', fontSize: i === 0 ? 18 : 20, backdropFilter: 'blur(10px)', boxShadow: '0 2px 12px rgba(0,0,0,.3)' }}>
            {icon}
          </button>
        ))}
      </div>

      {/* ── BOTTOM SHEET ── */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 60,
        height: sheetH, transition: 'height .38s cubic-bezier(.32,0,.67,0)',
        background: '#090F09', borderRadius: '22px 22px 0 0',
        boxShadow: '0 -6px 40px rgba(0,0,0,.65)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Handle */}
        <div style={{ padding: '11px 0 2px', display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: '#1D3822' }}/>
        </div>

        {/* Sheet top bar */}
        <div style={{ padding: '4px 16px 10px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, borderBottom: '1px solid #111A11' }}>
          {/* Back button (detail/active) */}
          {(sheetMode === 'detail' || sheetMode === 'active') && (
            <button onClick={() => { setSelectedOrder(null); setShowActive(false) }} className="btn"
              style={{ width: 34, height: 34, borderRadius: 9, background: '#0F1F10', border: '1px solid #1A3320', color: '#EBF5ED', fontSize: 16, flexShrink: 0 }}>←</button>
          )}

          {/* Title / tabs */}
          {sheetMode === 'list' || sheetMode === 'earnings' ? (
            <>
              <button onClick={() => setTab('orders')} className="btn"
                style={{ padding: '6px 13px', borderRadius: 9, background: tab === 'orders' ? 'rgba(59,142,240,.14)' : 'transparent', border: `1.5px solid ${tab === 'orders' ? 'rgba(59,142,240,.35)' : '#1A3320'}`, color: tab === 'orders' ? '#3B8EF0' : '#3D6645', fontSize: 12, fontWeight: 700, fontFamily: 'Nunito', display: 'flex', alignItems: 'center', gap: 5 }}>
                📋 Заказы
                {available.length > 0 && <span style={{ padding: '1px 5px', borderRadius: 5, background: '#FF4545', color: 'white', fontSize: 9, fontWeight: 900 }}>{available.length}</span>}
              </button>
              <button onClick={() => setTab('earnings')} className="btn"
                style={{ padding: '6px 13px', borderRadius: 9, background: tab === 'earnings' ? 'rgba(255,184,0,.1)' : 'transparent', border: `1.5px solid ${tab === 'earnings' ? 'rgba(255,184,0,.28)' : '#1A3320'}`, color: tab === 'earnings' ? '#FFB800' : '#3D6645', fontSize: 12, fontWeight: 700, fontFamily: 'Nunito' }}>
                💰 Заработок
              </button>
              {activeOrder && (
                <button onClick={() => setShowActive(true)} className="btn"
                  style={{ marginLeft: 'auto', padding: '5px 11px', borderRadius: 9, background: 'rgba(255,184,0,.1)', border: '1px solid rgba(255,184,0,.28)', color: '#FFB800', fontSize: 11, fontWeight: 700, fontFamily: 'Nunito', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FFB800', animation: 'pulse 1s infinite', display: 'inline-block' }}/>
                  В доставке
                </button>
              )}
            </>
          ) : sheetMode === 'detail' ? (
            <>
              <span className="ub" style={{ fontSize: 13, fontWeight: 900, color: '#EBF5ED' }}>{selectedOrder?.id}</span>
              <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: payBg(selectedOrder?.pay), color: payColor(selectedOrder?.pay), border: `1px solid ${payBorder(selectedOrder?.pay)}` }}>{selectedOrder?.pay}</span>
            </>
          ) : (
            <>
              <span className="ub" style={{ fontSize: 13, fontWeight: 900, color: '#EBF5ED' }}>{activeOrder?.id}</span>
              <span style={{ padding: '3px 9px', borderRadius: 7, background: step === 'done' ? 'rgba(31,215,96,.12)' : 'rgba(59,142,240,.12)', border: `1px solid ${step === 'done' ? 'rgba(31,215,96,.28)' : 'rgba(59,142,240,.28)'}`, color: step === 'done' ? '#1FD760' : '#3B8EF0', fontSize: 11, fontWeight: 700 }}>
                {step === 'toStore' ? '🏪 Еду в магазин' : step === 'toClient' ? '🛵 Еду к клиенту' : '✅ На месте'}
              </span>
            </>
          )}
        </div>

        {/* ═══ SCROLLABLE CONTENT ═══ */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>

          {/* ── LIST ── */}
          {sheetMode === 'list' && (
            <div style={{ padding: '10px 16px 16px' }}>
              {/* Status pills */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {([['available', 'Свободен', '#1FD760'], ['busy', 'Занят', '#FFB800'], ['offline', 'Офлайн', '#3D6645']] as const).map(([s, l, c]) => (
                  <button key={s} onClick={() => setStatus(s)} className="btn"
                    style={{ flex: 1, padding: '7px 4px', borderRadius: 9, fontSize: 10, fontWeight: 700, border: `1px solid ${status === s ? c : '#1A3320'}`, background: status === s ? c + '18' : 'transparent', color: status === s ? c : '#3D6645', fontFamily: 'Nunito' }}>{l}</button>
                ))}
              </div>

              {status === 'offline' ? (
                <div style={{ textAlign: 'center', padding: '30px 0', color: '#8FB897' }}>
                  <div style={{ fontSize: 44, marginBottom: 10 }}>😴</div>
                  <div style={{ fontWeight: 700, color: '#EBF5ED' }}>Вы офлайн</div>
                  <div style={{ fontSize: 11, color: '#3D6645', marginTop: 4 }}>Включите «Свободен» для приёма заказов</div>
                </div>
              ) : available.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px 0', color: '#8FB897' }}>
                  <div style={{ fontSize: 44, marginBottom: 10 }}>📭</div>
                  <div style={{ fontWeight: 700, color: '#EBF5ED' }}>Нет новых заказов</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {available.map((order, idx) => (
                    <div key={order.id} onClick={() => setSelectedOrder(order)}
                      style={{ background: 'linear-gradient(135deg,#0C1A0F,#091208)', border: '1.5px solid #1A3320', borderRadius: 18, overflow: 'hidden', cursor: 'pointer', animation: `fadeUp .3s ease ${idx * .07}s both`, display: 'flex' }}>
                      {/* Mini map */}
                      <div style={{ width: 84, flexShrink: 0, background: '#0A1A0D', borderRight: '1px solid #1A3320' }}>
                        <MiniMap orderId={order.id}/>
                      </div>
                      {/* Info */}
                      <div style={{ flex: 1, padding: '11px 13px 11px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                              <span className="ub" style={{ fontSize: 10, fontWeight: 800, color: '#3B8EF0' }}>{order.id}</span>
                              <span style={{ padding: '1px 5px', borderRadius: 4, fontSize: 9, fontWeight: 700, background: payBg(order.pay), color: payColor(order.pay), border: `1px solid ${payBorder(order.pay)}` }}>{order.pay}</span>
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#EBF5ED' }}>{order.client.split(' ')[0]}</div>
                            <div style={{ fontSize: 10, color: '#3D6645', marginTop: 1 }}>📍 {order.addr}</div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div style={{ fontSize: 8, color: '#3D6645' }}>заработок</div>
                            <div className="ub" style={{ fontSize: 17, fontWeight: 900, color: '#1FD760', lineHeight: 1 }}>+{order.earning}</div>
                            <div style={{ fontSize: 8, color: '#3D6645' }}>ЅМ</div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 5 }}>
                          <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 9, fontWeight: 700, background: 'rgba(59,142,240,.1)', color: '#3B8EF0', border: '1px solid rgba(59,142,240,.2)' }}>📍 {order.dist} км</span>
                          <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 9, fontWeight: 700, background: 'rgba(255,184,0,.1)', color: '#FFB800', border: '1px solid rgba(255,184,0,.2)' }}>💰 {order.productSum + order.deliveryFee} ЅМ</span>
                          <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 9, fontWeight: 700, background: 'rgba(255,255,255,.05)', color: '#8FB897', border: '1px solid #1A3320' }}>⚖️ {order.weight} кг</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── DETAIL ── */}
          {sheetMode === 'detail' && selectedOrder && (() => {
            const o = selectedOrder
            return (
              <div style={{ padding: '10px 16px 24px', animation: 'slideUp .25s ease' }}>
                {/* Client card */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, padding: '12px 14px', background: '#0C1A0F', border: '1px solid #1A3320', borderRadius: 14 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#EBF5ED', marginBottom: 3 }}>{o.client}</div>
                    <a href={`tel:${o.phone}`} style={{ fontSize: 12, color: '#3B8EF0', textDecoration: 'none', fontWeight: 700 }}>📞 {o.phone}</a>
                  </div>
                  <div className="ub" style={{ fontSize: 22, fontWeight: 900, color: '#1FD760' }}>+{o.earning} ЅМ</div>
                </div>

                {/* Route */}
                <div style={{ marginBottom: 12, background: '#0C1A0F', border: '1px solid #1A3320', borderRadius: 14, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', borderBottom: '1px solid #162B1A' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#1FD760', flexShrink: 0, boxShadow: '0 0 5px #1FD760' }}/>
                      <div style={{ width: 1.5, height: 12, background: 'repeating-linear-gradient(to bottom,#1D3822 0,#1D3822 4px,transparent 4px,transparent 7px)' }}/>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 9, color: '#3D6645', fontWeight: 700 }}>ЗАБРАТЬ</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#EBF5ED' }}>KAKAPO, ул. Ленина 42</div>
                    </div>
                    <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 10, background: 'rgba(59,142,240,.1)', color: '#3B8EF0', border: '1px solid rgba(59,142,240,.2)', fontWeight: 700 }}>{o.dist} км</span>
                  </div>
                  <div style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: '#3B8EF0', flexShrink: 0, boxShadow: '0 0 5px #3B8EF0' }}/>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 9, color: '#3D6645', fontWeight: 700 }}>ДОСТАВИТЬ</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#EBF5ED' }}>{o.addr}</div>
                    </div>
                    <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 10, background: 'rgba(255,184,0,.1)', color: '#FFB800', border: '1px solid rgba(255,184,0,.2)', fontWeight: 700 }}>⚖️ {o.weight} кг</span>
                  </div>
                </div>

                {/* Items list */}
                <div style={{ marginBottom: 12, background: '#0C1A0F', border: '1px solid #1A3320', borderRadius: 14, overflow: 'hidden' }}>
                  <div style={{ padding: '8px 14px', borderBottom: '1px solid #162B1A', fontSize: 9, color: '#3D6645', fontWeight: 700, letterSpacing: .5 }}>🛍 СОСТАВ ЗАКАЗА</div>
                  <div style={{ padding: '6px 14px 10px' }}>
                    {o.items.map((it: any, i: number) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 0', borderBottom: i < o.items.length - 1 ? '1px solid #111A11' : 'none' }}>
                        <span style={{ fontSize: 13, color: '#EBF5ED' }}>{it.e} {it.n}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 11, color: '#3D6645' }}>×{it.q}</span>
                          <span className="ub" style={{ fontSize: 12, fontWeight: 800, color: '#FFB800', minWidth: 48, textAlign: 'right' }}>{it.p * it.q} ЅМ</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Price breakdown */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                  <div style={{ textAlign: 'center', padding: '10px 6px', borderRadius: 12, background: 'rgba(255,184,0,.07)', border: '1px solid rgba(255,184,0,.15)' }}>
                    <div style={{ fontSize: 9, color: '#3D6645', fontWeight: 700, marginBottom: 4 }}>ТОВАРЫ</div>
                    <div className="ub" style={{ fontSize: 15, fontWeight: 900, color: '#FFB800' }}>{o.productSum} ЅМ</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: '10px 6px', borderRadius: 12, background: 'rgba(59,142,240,.07)', border: '1px solid rgba(59,142,240,.15)' }}>
                    <div style={{ fontSize: 9, color: '#3D6645', fontWeight: 700, marginBottom: 4 }}>ДОСТАВКА</div>
                    <div className="ub" style={{ fontSize: 15, fontWeight: 900, color: '#3B8EF0' }}>{o.deliveryFee} ЅМ</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: '10px 6px', borderRadius: 12, background: 'rgba(31,215,96,.08)', border: '1px solid rgba(31,215,96,.2)' }}>
                    <div style={{ fontSize: 9, color: '#3D6645', fontWeight: 700, marginBottom: 4 }}>ИТОГО</div>
                    <div className="ub" style={{ fontSize: 15, fontWeight: 900, color: '#1FD760' }}>{o.productSum + o.deliveryFee} ЅМ</div>
                  </div>
                </div>

                {/* Payment */}
                <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 12, background: payBg(o.pay), border: `1px solid ${payBorder(o.pay)}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 20 }}>{o.pay === 'Наличными' ? '💵' : o.pay === 'Карта' ? '💳' : '🎁'}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#EBF5ED' }}>{o.pay}</span>
                  </div>
                  <span className="ub" style={{ fontSize: 14, fontWeight: 900, color: payColor(o.pay) }}>
                    {o.pay === 'Наличными' ? `${o.productSum + o.deliveryFee} ЅМ` : 'Оплачено'}
                  </span>
                </div>

                <button onClick={() => acceptOrder(o)} className="btn"
                  style={{ width: '100%', padding: 15, borderRadius: 15, background: 'linear-gradient(135deg,#17B34E,#1FD760)', border: 'none', color: '#030B05', fontFamily: 'Nunito', fontWeight: 800, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 6px 22px rgba(31,215,96,.4)' }}>
                  ✓ Принять заказ
                  <span style={{ padding: '2px 9px', borderRadius: 7, background: 'rgba(3,11,5,.22)', fontSize: 12 }}>+{o.earning} ЅМ</span>
                </button>
              </div>
            )
          })()}

          {/* ── ACTIVE DELIVERY ── */}
          {sheetMode === 'active' && activeOrder && (() => {
            const o = activeOrder
            return (
              <div style={{ padding: '10px 16px 24px', animation: 'slideUp .25s ease' }}>
                {/* Steps */}
                <div style={{ display: 'flex', marginBottom: 14 }}>
                  {([['toStore', '🏪', 'В магазин'], ['toClient', '🛵', 'К клиенту'], ['done', '✓', 'Доставлено']] as const).map(([s, e, l], i) => {
                    const isActive = step === s
                    const isDone = (step === 'toClient' && s === 'toStore') || (step === 'done' && s !== 'done')
                    return (
                      <div key={s} style={{ flex: 1, textAlign: 'center', position: 'relative' }}>
                        {i < 2 && <div style={{ position: 'absolute', top: 18, left: '50%', width: '100%', height: 2, background: isDone ? '#1FD760' : '#1A3320' }}/>}
                        <div style={{ width: 38, height: 38, borderRadius: '50%', background: isActive ? '#3B8EF0' : isDone ? '#1FD760' : '#0C1C0F', border: `2px solid ${isActive ? '#3B8EF0' : isDone ? '#1FD760' : '#1A3320'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, margin: '0 auto 5px', position: 'relative', zIndex: 1 }}>{isDone ? '✓' : e}</div>
                        <div style={{ fontSize: 10, color: isActive ? '#3B8EF0' : isDone ? '#1FD760' : '#3D6645', fontWeight: isActive ? 700 : 400 }}>{l}</div>
                      </div>
                    )
                  })}
                </div>

                {/* Route */}
                <div style={{ marginBottom: 12, background: '#0C1A0F', border: '1px solid #1A3320', borderRadius: 14, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', borderBottom: '1px solid #162B1A' }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#1FD760', flexShrink: 0, boxShadow: '0 0 5px #1FD760' }}/>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 9, color: '#3D6645', fontWeight: 700 }}>ЗАБРАТЬ</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#EBF5ED' }}>KAKAPO, ул. Ленина 42</div>
                    </div>
                    <a href="tel:+992118559797" style={{ padding: '5px 9px', borderRadius: 8, background: 'rgba(31,215,96,.1)', border: '1px solid rgba(31,215,96,.25)', color: '#1FD760', fontSize: 11, fontWeight: 700, textDecoration: 'none' }}>📞</a>
                  </div>
                  <div style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: '#3B8EF0', flexShrink: 0, boxShadow: '0 0 5px #3B8EF0' }}/>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 9, color: '#3D6645', fontWeight: 700 }}>КЛИЕНТ</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#EBF5ED' }}>{o.addr}</div>
                      <div style={{ fontSize: 11, color: '#8FB897', marginTop: 1 }}>{o.client}</div>
                    </div>
                    <a href={`tel:${o.phone}`} style={{ padding: '5px 9px', borderRadius: 8, background: 'rgba(59,142,240,.1)', border: '1px solid rgba(59,142,240,.25)', color: '#3B8EF0', fontSize: 11, fontWeight: 700, textDecoration: 'none' }}>📞</a>
                  </div>
                </div>

                {/* Items */}
                <div style={{ marginBottom: 10, background: '#0C1A0F', border: '1px solid #1A3320', borderRadius: 14, overflow: 'hidden' }}>
                  <div style={{ padding: '8px 14px', borderBottom: '1px solid #162B1A', fontSize: 9, color: '#3D6645', fontWeight: 700 }}>🛍 СОСТАВ ЗАКАЗА</div>
                  <div style={{ padding: '6px 14px 10px' }}>
                    {o.items.map((it: any, i: number) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 0', borderBottom: i < o.items.length - 1 ? '1px solid #111A11' : 'none' }}>
                        <span style={{ fontSize: 13, color: '#EBF5ED' }}>{it.e} {it.n}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 11, color: '#3D6645' }}>×{it.q}</span>
                          <span className="ub" style={{ fontSize: 12, fontWeight: 800, color: '#FFB800', minWidth: 48, textAlign: 'right' }}>{it.p * it.q} ЅМ</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Price breakdown */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                  <div style={{ textAlign: 'center', padding: '10px 6px', borderRadius: 12, background: 'rgba(255,184,0,.07)', border: '1px solid rgba(255,184,0,.15)' }}>
                    <div style={{ fontSize: 9, color: '#3D6645', fontWeight: 700, marginBottom: 4 }}>ТОВАРЫ</div>
                    <div className="ub" style={{ fontSize: 15, fontWeight: 900, color: '#FFB800' }}>{o.productSum} ЅМ</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: '10px 6px', borderRadius: 12, background: 'rgba(59,142,240,.07)', border: '1px solid rgba(59,142,240,.15)' }}>
                    <div style={{ fontSize: 9, color: '#3D6645', fontWeight: 700, marginBottom: 4 }}>ДОСТАВКА</div>
                    <div className="ub" style={{ fontSize: 15, fontWeight: 900, color: '#3B8EF0' }}>{o.deliveryFee} ЅМ</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: '10px 6px', borderRadius: 12, background: 'rgba(31,215,96,.08)', border: '1px solid rgba(31,215,96,.2)' }}>
                    <div style={{ fontSize: 9, color: '#3D6645', fontWeight: 700, marginBottom: 4 }}>ИТОГО</div>
                    <div className="ub" style={{ fontSize: 15, fontWeight: 900, color: '#1FD760' }}>{o.productSum + o.deliveryFee} ЅМ</div>
                  </div>
                </div>

                {/* Payment */}
                <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 12, background: payBg(o.pay), border: `1px solid ${payBorder(o.pay)}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18 }}>{o.pay === 'Наличными' ? '💵' : o.pay === 'Карта' ? '💳' : '🎁'}</span>
                    <div>
                      <div style={{ fontSize: 9, color: '#3D6645', fontWeight: 700 }}>СПОСОБ ОПЛАТЫ</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#EBF5ED' }}>{o.pay}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 9, color: '#3D6645', fontWeight: 700 }}>К ПОЛУЧЕНИЮ</div>
                    <div className="ub" style={{ fontSize: 15, fontWeight: 900, color: payColor(o.pay) }}>
                      {o.pay === 'Наличными' ? `${o.productSum + o.deliveryFee} ЅМ` : 'Оплачено'}
                    </div>
                  </div>
                </div>

                {step === 'toStore'  && <button onClick={() => setStep('toClient')} className="btn" style={{ width: '100%', padding: 15, borderRadius: 15, background: 'linear-gradient(135deg,#1E5BB5,#3B8EF0)', border: 'none', color: 'white', fontFamily: 'Nunito', fontWeight: 800, fontSize: 14 }}>📦 Забрал заказ — еду к клиенту</button>}
                {step === 'toClient' && <button onClick={() => setStep('done')}     className="btn" style={{ width: '100%', padding: 15, borderRadius: 15, background: 'linear-gradient(135deg,#1E5BB5,#3B8EF0)', border: 'none', color: 'white', fontFamily: 'Nunito', fontWeight: 800, fontSize: 14 }}>🏁 Я на месте у клиента</button>}
                {step === 'done'     && <button onClick={finishDelivery}            className="btn" style={{ width: '100%', padding: 15, borderRadius: 15, background: 'linear-gradient(135deg,#17B34E,#1FD760)', border: 'none', color: '#030B05', fontFamily: 'Nunito', fontWeight: 800, fontSize: 14, boxShadow: '0 8px 24px rgba(31,215,96,.4)' }}>✓ Доставлено — получить +{o.earning} ЅМ</button>}
              </div>
            )
          })()}

          {/* ── EARNINGS ── */}
          {sheetMode === 'earnings' && (
            <div style={{ padding: '10px 16px 24px' }}>
              <div style={{ background: 'linear-gradient(135deg,#0A1828,#163050)', border: '1px solid rgba(59,142,240,.28)', borderRadius: 18, padding: '20px', marginBottom: 14, textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 0%,rgba(59,142,240,.1),transparent 65%)', pointerEvents: 'none' }}/>
                <div style={{ fontSize: 10, color: '#8FB897', marginBottom: 6, fontWeight: 700 }}>ЗАРАБОТАНО СЕГОДНЯ</div>
                <div className="ub" style={{ fontSize: 36, fontWeight: 900, color: '#FFB800', lineHeight: 1, marginBottom: 8 }}>210 ЅМ</div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                  <span style={{ padding: '3px 10px', borderRadius: 7, background: 'rgba(31,215,96,.1)', border: '1px solid rgba(31,215,96,.2)', fontSize: 11, color: '#1FD760', fontWeight: 700 }}>📦 14 доставок</span>
                  <span style={{ padding: '3px 10px', borderRadius: 7, background: 'rgba(255,184,0,.1)', border: '1px solid rgba(255,184,0,.2)', fontSize: 11, color: '#FFB800', fontWeight: 700 }}>⭐ 4.9</span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                {([['За неделю', '1 240 ЅМ', '#1FD760', '📅'], ['Доставок', '342', '#3B8EF0', '🏆'], ['Ср./день', '177 ЅМ', '#FFB800', '📊'], ['Рейтинг', '4.9 ★', '#FFB800', '⭐']] as const).map(([l, v, c, ic], i) => (
                  <div key={i} style={{ background: '#0C1A0F', border: `1px solid ${c}22`, borderRadius: 12, padding: '13px', textAlign: 'center' }}>
                    <div style={{ fontSize: 20, marginBottom: 4 }}>{ic}</div>
                    <div className="ub" style={{ fontSize: 16, fontWeight: 900, color: c, marginBottom: 3 }}>{v}</div>
                    <div style={{ fontSize: 9, color: '#3D6645', fontWeight: 700 }}>{l}</div>
                  </div>
                ))}
              </div>
              <div className="ub" style={{ fontSize: 12, fontWeight: 800, marginBottom: 10, color: '#EBF5ED' }}>История доставок</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {HISTORY.map((h, i) => (
                  <div key={i} style={{ background: '#0C1A0F', border: '1px solid #1A3320', borderRadius: 13, overflow: 'hidden' }}>
                    <div style={{ padding: '10px 13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #111A11' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(31,215,96,.12)', border: '1px solid rgba(31,215,96,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>✓</div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span className="ub" style={{ fontSize: 10, fontWeight: 800, color: '#3B8EF0' }}>{h.id}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#EBF5ED' }}>{h.client}</span>
                          </div>
                          <div style={{ fontSize: 10, color: '#3D6645' }}>{h.addr} · {h.dist} · {h.time}</div>
                        </div>
                      </div>
                      <div className="ub" style={{ fontSize: 13, fontWeight: 900, color: '#1FD760' }}>+{h.earning} ЅМ</div>
                    </div>
                    <div style={{ padding: '7px 13px', display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 9, fontWeight: 700, background: 'rgba(255,184,0,.08)', color: '#FFB800', border: '1px solid rgba(255,184,0,.15)' }}>Товары: {h.productSum} ЅМ</span>
                      <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 9, fontWeight: 700, background: 'rgba(59,142,240,.08)', color: '#3B8EF0', border: '1px solid rgba(59,142,240,.15)' }}>Доставка: {h.deliveryFee} ЅМ</span>
                      <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 9, fontWeight: 700, background: 'rgba(31,215,96,.08)', color: '#1FD760', border: '1px solid rgba(31,215,96,.15)' }}>Итого: {h.productSum + h.deliveryFee} ЅМ</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
