'use client'
import { useState } from 'react'

/* ══════════════════════════════════════════════════
   KAKAPO КУРЬЕР — Original Design v3
══════════════════════════════════════════════════ */
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Space+Grotesk:wght@500;600;700;800&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
  html,body{background:#040C08;color:#E0F0E8;font-family:'Inter',sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden;height:100%;}
  .sg{font-family:'Space Grotesk',sans-serif;}
  .btn{cursor:pointer;border:none;outline:none;background:none;transition:all .15s ease;}.btn:active{opacity:.75;transform:scale(.96);}
  @keyframes spin   {0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
  @keyframes fadeIn {0%{opacity:0;transform:translateY(10px)}100%{opacity:1;transform:translateY(0)}}
  @keyframes glow   {0%,100%{box-shadow:0 0 8px rgba(0,230,118,.4)}50%{box-shadow:0 0 22px rgba(0,230,118,.9)}}
  @keyframes ripple {0%{transform:scale(1);opacity:.6}100%{transform:scale(3);opacity:0}}
  @keyframes bob    {0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
  @keyframes slide  {0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
  ::-webkit-scrollbar{width:0;height:0}
`

const COURIER = { name: 'Фирдавс', surname: 'Назаров', vehicle: 'TJ 1234 AA', rating: 4.9 }

const PIN: Record<string, {x:number;y:number}> = {
  STORE:   {x:185, y:195},
  'O-1':   {x:285, y:270},
  'O-2':   {x:95,  y:110},
  'O-3':   {x:330, y:130},
}

const ORDERS = [
  { id:'O-1', num:1, client:'Нилуфар Хасанова', phone:'+992 90 123 45 67',
    addr:'ул. Сомони, 12', dist:3.4, earn:5, pay:'Карта',
    prodSum:42, delFee:5,
    items:[{e:'🥛',n:'Молоко 3.2%',q:2,p:8},{e:'🧀',n:'Сыр российский',q:1,p:18},{e:'☕',n:'Кофе молотый',q:1,p:8}],
  },
  { id:'O-2', num:2, client:'Рустам Давлатов', phone:'+992 91 445 23 11',
    addr:'мкр. Мирный, 5',  dist:1.8, earn:3, pay:'Наличными',
    prodSum:24, delFee:3,
    items:[{e:'🥦',n:'Брокколи',q:2,p:7},{e:'🍅',n:'Томаты черри',q:1,p:10}],
  },
  { id:'O-3', num:3, client:'Зафар Мирзоев', phone:'+992 88 789 01 23',
    addr:'ул. Рудаки, 8',   dist:2.6, earn:4, pay:'Бонусы',
    prodSum:61, delFee:4,
    items:[{e:'🍞',n:'Хлеб белый',q:2,p:6},{e:'🥚',n:'Яйца СО',q:1,p:22},{e:'🧃',n:'Сок яблочный',q:3,p:9}],
  },
]

const DONE = [
  {id:'D-20',client:'Лола М.',    addr:'ул. Ленина 5',    earn:5, time:'13:20',dist:2.1,prodSum:38,delFee:5},
  {id:'D-15',client:'Бахром К.',  addr:'мкр. Мирный 12',  earn:4, time:'12:45',dist:1.5,prodSum:29,delFee:4},
  {id:'D-10',client:'Зубайр Р.',  addr:'ул. Сомони 8',    earn:6, time:'12:10',dist:3.8,prodSum:55,delFee:6},
]

// ─── Night-mode city map ─────────────────────────────────────
function NightMap({ orders, active, selId, step, completed, onPinClick }: {
  orders: typeof ORDERS; active: any; selId: string | null; step: string; completed: string[]; onPinClick: (o: any) => void
}) {
  const S = PIN.STORE
  const aPin = active ? PIN[active.id] : null
  const courier = !active ? {x:185,y:145}
    : step==='toStore'  ? {x:185,y:155}
    : step==='toClient' ? {x:S.x,y:S.y}
    : aPin ?? S

  return (
    <svg viewBox="0 0 400 320" preserveAspectRatio="xMidYMid slice" style={{width:'100%',height:'100%',display:'block'}}>
      {/* Night sky base */}
      <defs>
        <radialGradient id="mg" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#0A1A10"/>
          <stop offset="100%" stopColor="#040C08"/>
        </radialGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2.5" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <rect width="400" height="320" fill="url(#mg)"/>

      {/* City blocks — dark buildings */}
      {[
        [0,0,65,38],[84,0,78,38],[173,0,78,38],[263,0,74,38],[349,0,51,38],
        [0,52,65,62],[173,52,78,62],[263,52,74,62],[349,52,51,62],
        [0,180,65,60],[84,180,78,60],[173,180,78,60],[263,180,74,60],[349,180,51,60],
        [0,254,65,66],[84,254,78,66],[173,254,78,66],[263,254,74,66],[349,254,51,66],
      ].map(([x,y,w,h],i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill="#071210" rx="2"/>
      ))}

      {/* Park */}
      <rect x="84" y="52" width="78" height="62" fill="#082010" rx="2"/>
      {[{x:105,y:72},{x:128,y:85},{x:150,y:70},{x:157,y:99},{x:112,y:103}].map((p,i)=>(
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="9" fill="#0D3018" opacity=".9"/>
          <circle cx={p.x} cy={p.y} r="6" fill="#0F4020" opacity=".8"/>
          <circle cx={p.x} cy={p.y} r="3" fill="#00E676" opacity=".12"/>
        </g>
      ))}

      {/* Window lights on buildings */}
      {[[20,8],[30,22],[45,12],[90,8],[100,20],[110,8],[180,10],[195,22],[205,8],[270,15],[310,8],[360,12],[370,25],[20,190],[35,205],[50,190],[90,185],[100,200],[180,185],[195,200],[270,190],[285,205],[355,185],[370,200]].map(([x,y],i)=>(
        <rect key={i} x={x} y={y} width="3" height="3" fill="#FFB800" rx=".5" opacity={.15+Math.random()*.15}/>
      ))}

      {/* Roads — night tarmac */}
      <rect x="0"   y="38"  width="400" height="14" fill="#0B1610"/>
      <rect x="0"   y="114" width="400" height="12" fill="#0A1410"/>
      <rect x="0"   y="180" width="400" height="12" fill="#0B1610"/>
      <rect x="0"   y="254" width="400" height="10" fill="#0B1610"/>
      <rect x="65"  y="0"   width="19"  height="320" fill="#0B1610"/>
      <rect x="163" y="0"   width="10"  height="320" fill="#0A1410"/>
      <rect x="251" y="0"   width="12"  height="320" fill="#0B1610"/>
      <rect x="349" y="0"   width="13"  height="320" fill="#0B1610"/>

      {/* Lane markings */}
      {[45,119,185,258].map(y=>(
        [0,50,100,150,200,250,300,350].map(x=>(
          <rect key={`${x}-${y}`} x={x} y={y} width="18" height="1.5" fill="rgba(255,255,255,.08)"/>
        ))
      ))}
      {[72,168,256,352].map(x=>(
        [0,40,80,120,160,200,240,280].map(y=>(
          <rect key={`${x}-${y}`} x={x} y={y} width="1.5" height="18" fill="rgba(255,255,255,.08)"/>
        ))
      ))}

      {/* Active route */}
      {active && step!=='done' && aPin && (() => {
        const p1 = step==='toStore' ? courier : S
        const p2 = step==='toStore' ? S : aPin
        const mx=(p1.x+p2.x)/2, my=Math.min(p1.y,p2.y)-18
        const c = step==='toStore' ? '#3B8EF0' : '#00E676'
        return <>
          <path d={`M${p1.x},${p1.y} Q${mx},${my} ${p2.x},${p2.y}`}
            fill="none" stroke={`${c}22`} strokeWidth="10" strokeLinecap="round"/>
          <path d={`M${p1.x},${p1.y} Q${mx},${my} ${p2.x},${p2.y}`}
            fill="none" stroke={c} strokeWidth="2.5" strokeDasharray="7,5" strokeLinecap="round" opacity=".9"/>
        </>
      })()}

      {/* Order pins — all visible, clickable */}
      {orders.filter(o => !completed.includes(o.id) && o.id!==active?.id).map((order,i) => {
        const pos = PIN[order.id]
        if (!pos) return null
        const isSel = selId === order.id
        const col = ['#00E676','#3B8EF0','#FF6B35'][i%3]
        return (
          <g key={order.id} filter="url(#glow)" onClick={() => onPinClick(order)} style={{cursor:'pointer'}}>
            {/* Tap target — invisible larger area */}
            <circle cx={pos.x} cy={pos.y} r="28" fill="transparent"/>
            <circle cx={pos.x} cy={pos.y} r={isSel?26:20} fill={`${col}12`}
              style={{animation: isSel?'ripple 1.6s ease-out infinite':undefined}}/>
            <circle cx={pos.x} cy={pos.y} r="13" fill="#040C08" stroke={col} strokeWidth={isSel?3:2}/>
            <text x={pos.x} y={pos.y+4.5} textAnchor="middle" fontSize="10" fontWeight="900"
              fill={col} fontFamily="Space Grotesk">{order.num}</text>
            {/* Earning badge */}
            <rect x={pos.x+14} y={pos.y-22} width={30} height={15} rx="7.5" fill={col} opacity=".9"/>
            <text x={pos.x+29} y={pos.y-11} fontSize="7.5" fill="#040C08" textAnchor="middle"
              fontWeight="900" fontFamily="Space Grotesk">+{order.earn}</text>
          </g>
        )
      })}

      {/* Active dest — clickable */}
      {aPin && (
        <g filter="url(#glow)" onClick={() => onPinClick(active)} style={{cursor:'pointer'}}>
          <circle cx={aPin.x} cy={aPin.y} r="28" fill="transparent"/>
          <circle cx={aPin.x} cy={aPin.y} r="22" fill="rgba(255,69,69,.1)"
            style={{animation:'ripple 2s ease-out infinite'}}/>
          <circle cx={aPin.x} cy={aPin.y} r="12" fill="#FF4545" opacity=".9"/>
          <text x={aPin.x} y={aPin.y+4} textAnchor="middle" fontSize="12" fill="white">✦</text>
        </g>
      )}

      {/* Store */}
      <g filter="url(#glow)">
        <circle cx={S.x} cy={S.y} r="14" fill="#040C08" stroke="#00E676" strokeWidth="2"/>
        <circle cx={S.x} cy={S.y} r="10" fill="rgba(0,230,118,.15)"/>
        <text x={S.x} y={S.y+4.5} textAnchor="middle" fontSize="12">🏪</text>
      </g>

      {/* Courier */}
      <g style={{animation:'bob 2s ease-in-out infinite'}}>
        <circle cx={courier.x} cy={courier.y} r="18" fill="rgba(255,184,0,.08)"
          style={{animation:'ripple 3s ease-out infinite'}}/>
        <circle cx={courier.x} cy={courier.y} r="13" fill="#FFB800"/>
        <circle cx={courier.x} cy={courier.y} r="13" fill="none" stroke="rgba(255,255,255,.4)" strokeWidth="2"/>
        <text x={courier.x} y={courier.y+5} textAnchor="middle" fontSize="13">🛵</text>
      </g>
    </svg>
  )
}

// ─── Sub-components ──────────────────────────────────────────
const PAY_COLOR = (p:string) => p==='Карта' ? '#3B8EF0' : p==='Наличными' ? '#00E676' : '#FFB800'

function Tag({children, color='#00E676', bg}:{children:any;color?:string;bg?:string}) {
  return (
    <span style={{display:'inline-flex',alignItems:'center',padding:'3px 8px',borderRadius:6,fontSize:10,fontWeight:700,background:bg||`${color}14`,color,border:`1px solid ${color}28`}}>
      {children}
    </span>
  )
}

function Divider() {
  return <div style={{height:1,background:'rgba(255,255,255,.05)',margin:'10px 0'}}/>
}

function SumRow({label,val,color='#B0C8B8'}:{label:string;val:string|number;color?:string}) {
  return (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 0'}}>
      <span style={{fontSize:12,color:'#507060'}}>{label}</span>
      <span className="sg" style={{fontSize:13,fontWeight:700,color}}>{val} ЅМ</span>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
export default function CourierApp() {
  const [logged,     setLogged]    = useState(false)
  const [online,     setOnline]    = useState(true)
  const [tab,        setTab]       = useState<'orders'|'active'|'earnings'>('orders')
  const [active,     setActive]    = useState<any>(null)
  const [step,       setStep]      = useState<'toStore'|'toClient'|'done'>('toStore')
  const [done,       setDone]      = useState<string[]>([])
  const [selOrder,   setSelOrder]  = useState<any>(null)
  const [otp,        setOtp]       = useState(['','','',''])
  const [otpErr,     setOtpErr]    = useState('')
  const [loading,    setLoading]   = useState(false)
  const [sheet,      setSheet]     = useState<null|'detail'|'active'>(null)

  const avail = ORDERS.filter(o => !done.includes(o.id) && o.id !== active?.id)

  const verify = () => {
    if (otp.join('').length < 4) return
    setLoading(true)
    setTimeout(() => {
      if (otp.join('') === '1234') setLogged(true)
      else { setOtpErr('Неверный код. Демо: 1234'); setOtp(['','','','']) }
      setLoading(false)
    }, 800)
  }

  const acceptOrder = (o: any) => {
    setActive(o); setStep('toStore'); setSheet('active'); setTab('active'); setSelOrder(null)
  }

  const finishOrder = () => {
    if (active) setDone(d => [...d, active.id])
    setActive(null); setSheet(null); setTab('orders')
  }

  const openDetail = (o: any) => { setSelOrder(o); setSheet('detail') }
  const closeSheet = () => { setSheet(null); setSelOrder(null) }

  // ── LOGIN ──────────────────────────────────────────────────
  if (!logged) return (
    <div style={{minHeight:'100vh',background:'#040C08',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:24,maxWidth:480,margin:'0 auto'}}>
      <style>{CSS}</style>
      <a href="/" style={{position:'absolute',top:20,left:20,width:38,height:38,borderRadius:10,background:'#081410',border:'1px solid #0F2015',display:'flex',alignItems:'center',justifyContent:'center',textDecoration:'none',color:'#507060',fontSize:16}}>←</a>

      {/* Logo */}
      <div style={{textAlign:'center',marginBottom:40}}>
        <div style={{width:72,height:72,borderRadius:20,background:'linear-gradient(135deg,#0A2A18,#0D4024)',border:'1px solid rgba(0,230,118,.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:34,margin:'0 auto 16px',boxShadow:'0 0 40px rgba(0,230,118,.15)'}}>🛵</div>
        <div className="sg" style={{fontSize:22,fontWeight:800,color:'#E0F0E8',letterSpacing:-.5}}>KAKAPO Курьер</div>
        <div style={{fontSize:12,color:'#507060',marginTop:4}}>Введите код из SMS</div>
      </div>

      {/* OTP */}
      <div style={{width:'100%',maxWidth:320}}>
        {otpErr && (
          <div style={{padding:'10px 14px',borderRadius:10,background:'rgba(255,69,69,.08)',border:'1px solid rgba(255,69,69,.2)',fontSize:12,color:'#FF6060',marginBottom:14,textAlign:'center'}}>
            {otpErr}
          </div>
        )}
        <div style={{display:'flex',gap:10,justifyContent:'center',marginBottom:16}}>
          {otp.map((v,i) => (
            <input key={i} id={`d${i}`} value={v} type="tel" maxLength={1} inputMode="numeric"
              onChange={e => {
                const d=[...otp]; d[i]=e.target.value.replace(/\D/,'').slice(-1); setOtp(d)
                if(e.target.value&&i<3)(document.getElementById(`d${i+1}`) as HTMLInputElement)?.focus()
              }}
              onKeyDown={e => {if(e.key==='Backspace'&&!v&&i>0)(document.getElementById(`d${i-1}`) as HTMLInputElement)?.focus()}}
              style={{width:60,height:68,borderRadius:14,border:`2px solid ${v?'rgba(0,230,118,.45)':'#0F2015'}`,background:v?'rgba(0,230,118,.06)':'#081410',textAlign:'center',fontFamily:'Space Grotesk',fontSize:28,fontWeight:800,color:'#E0F0E8',outline:'none',transition:'border-color .15s'}}/>
          ))}
        </div>
        <div style={{padding:'8px',borderRadius:9,background:'rgba(0,230,118,.05)',border:'1px solid rgba(0,230,118,.1)',fontSize:11,color:'#507060',marginBottom:16,textAlign:'center'}}>
          Демо: <span style={{color:'#00E676',fontWeight:700}}>1 2 3 4</span>
        </div>
        <button onClick={verify} className="btn" disabled={otp.join('').length<4}
          style={{width:'100%',padding:16,borderRadius:14,background:otp.join('').length<4?'#0C1C12':'linear-gradient(135deg,#00A854,#00E676)',color:otp.join('').length<4?'#2A4A32':'#040C08',fontFamily:'Inter',fontWeight:800,fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',gap:8,transition:'all .2s',boxShadow:otp.join('').length>=4?'0 8px 28px rgba(0,230,118,.28)':'none'}}>
          {loading ? <div style={{width:20,height:20,borderRadius:'50%',border:'2.5px solid rgba(4,12,8,.3)',borderTopColor:'#040C08',animation:'spin 1s linear infinite'}}/> : '🚀 Войти'}
        </button>
      </div>
    </div>
  )

  // ── MAIN APP ───────────────────────────────────────────────
  return (
    <div style={{position:'fixed',inset:0,maxWidth:480,margin:'0 auto',background:'#040C08',display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <style>{CSS}</style>

      {/* ── Header ── */}
      <div style={{padding:'44px 16px 12px',background:'#040C08',borderBottom:'1px solid rgba(255,255,255,.05)',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <a href="/" style={{width:34,height:34,borderRadius:9,background:'#081410',border:'1px solid #0F2015',display:'flex',alignItems:'center',justifyContent:'center',textDecoration:'none',color:'#507060',fontSize:15,flexShrink:0}}>←</a>

          {/* Avatar */}
          <div style={{width:38,height:38,borderRadius:11,background:'linear-gradient(135deg,#0A2A18,#0D4024)',border:'1px solid rgba(0,230,118,.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>🧑</div>

          <div style={{flex:1,minWidth:0}}>
            <div className="sg" style={{fontSize:13,fontWeight:700,color:'#E0F0E8',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{COURIER.name} {COURIER.surname}</div>
            <div style={{display:'flex',alignItems:'center',gap:5,marginTop:1}}>
              <div style={{width:5,height:5,borderRadius:'50%',background:online?'#00E676':'#FF4545',flexShrink:0,boxShadow:`0 0 5px ${online?'#00E676':'#FF4545'}`}}/>
              <span style={{fontSize:10,color:'#507060'}}>{online?'Онлайн':'Офлайн'} · 🏍 {COURIER.vehicle}</span>
            </div>
          </div>

          {/* Online toggle */}
          <button onClick={()=>setOnline(o=>!o)} className="btn"
            style={{padding:'6px 12px',borderRadius:9,background:online?'rgba(0,230,118,.1)':'rgba(255,69,69,.08)',border:`1px solid ${online?'rgba(0,230,118,.25)':'rgba(255,69,69,.2)'}`,color:online?'#00E676':'#FF6060',fontSize:10,fontWeight:700}}>
            {online?'● Вкл':'○ Выкл'}
          </button>

          {/* Today earnings */}
          <div style={{textAlign:'right',flexShrink:0}}>
            <div style={{fontSize:8,color:'#507060',marginBottom:1}}>СЕГОДНЯ</div>
            <div className="sg" style={{fontSize:16,fontWeight:800,color:'#FFB800'}}>42<span style={{fontSize:10,color:'#FFB800',marginLeft:1}}>ЅМ</span></div>
          </div>
        </div>
      </div>

      {/* ── Map ── */}
      <div style={{height:220,flexShrink:0,position:'relative',borderBottom:'1px solid rgba(255,255,255,.04)'}}>
        <NightMap orders={ORDERS} active={active} selId={selOrder?.id??null} step={step} completed={done}
          onPinClick={o => {
            if (active && o.id === active.id) {
              setSheet('active')
            } else {
              setSelOrder(o); setSheet('detail')
            }
          }}/>
        {/* Map legend overlay */}
        <div style={{position:'absolute',bottom:10,left:10,display:'flex',gap:6}}>
          {avail.map((o,i) => (
            <div key={o.id} onClick={()=>openDetail(o)}
              style={{padding:'4px 9px',borderRadius:7,background:'rgba(4,12,8,.85)',border:`1px solid ${['rgba(0,230,118,.35)','rgba(59,142,240,.35)','rgba(255,107,53,.35)'][i%3]}`,cursor:'pointer',display:'flex',alignItems:'center',gap:4}}>
              <span className="sg" style={{fontSize:10,fontWeight:700,color:['#00E676','#3B8EF0','#FF6B35'][i%3]}}>#{o.num}</span>
              <span style={{fontSize:9,color:'#507060'}}>{o.dist}км</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tab Bar ── */}
      <div style={{display:'flex',padding:'10px 16px 8px',gap:6,flexShrink:0}}>
        {([
          ['orders',  `Заказы${avail.length?` (${avail.length})`:''}`, '📦'],
          ['active',  active?'Доставка 🔴':'Активный',                 '🛵'],
          ['earnings','Заработок',                                      '💰'],
        ] as const).map(([id,label,ic]) => (
          <button key={id} onClick={()=>{setTab(id);if(id==='active'&&active)setSheet('active')}} className="btn"
            style={{flex:1,padding:'8px 4px',borderRadius:10,background:tab===id?'rgba(0,230,118,.1)':'#081410',border:`1px solid ${tab===id?'rgba(0,230,118,.3)':'#0F2015'}`,color:tab===id?'#00E676':'#507060',fontSize:11,fontWeight:700,transition:'all .15s'}}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Scrollable content ── */}
      <div style={{flex:1,overflowY:'auto',padding:'0 16px 120px'}}>

        {/* ═══ ORDERS TAB ═══ */}
        {tab==='orders' && (
          !online ? (
            <div style={{textAlign:'center',padding:'48px 20px'}}>
              <div style={{fontSize:48,marginBottom:12}}>😴</div>
              <div className="sg" style={{fontSize:16,fontWeight:700,color:'#E0F0E8',marginBottom:6}}>Вы офлайн</div>
              <div style={{fontSize:12,color:'#507060',marginBottom:20}}>Включите режим «Онлайн» чтобы видеть заказы</div>
              <button onClick={()=>setOnline(true)} className="btn"
                style={{padding:'12px 28px',borderRadius:12,background:'linear-gradient(135deg,#00A854,#00E676)',color:'#040C08',fontWeight:800,fontSize:13}}>
                Включить
              </button>
            </div>
          ) : avail.length===0 ? (
            <div style={{textAlign:'center',padding:'48px 20px'}}>
              <div style={{fontSize:48,marginBottom:12}}>📭</div>
              <div className="sg" style={{fontSize:15,fontWeight:700,color:'#E0F0E8'}}>Нет новых заказов</div>
              <div style={{fontSize:11,color:'#507060',marginTop:6}}>Ожидаем новые...</div>
            </div>
          ) : (
            <div style={{display:'flex',flexDirection:'column',gap:10,paddingTop:4}}>
              {avail.map((order,i) => {
                const col = ['#00E676','#3B8EF0','#FF6B35'][i%3]
                const isSel = selOrder?.id===order.id
                return (
                  <div key={order.id} onClick={()=>openDetail(order)} className="btn"
                    style={{width:'100%',background:'#081410',border:`1px solid ${isSel?`${col}40`:'#0F2015'}`,borderRadius:16,padding:'14px 16px',textAlign:'left',cursor:'pointer',animation:`fadeIn .3s ease ${i*.07}s both`,transition:'border-color .15s',boxShadow:isSel?`0 0 0 1px ${col}20` :'none'}}>

                    {/* Top row */}
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        {/* Number circle */}
                        <div style={{width:28,height:28,borderRadius:8,background:`${col}14`,border:`1.5px solid ${col}30`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                          <span className="sg" style={{fontSize:12,fontWeight:800,color:col}}>{order.num}</span>
                        </div>
                        <div>
                          <div className="sg" style={{fontSize:14,fontWeight:700,color:'#E0F0E8',lineHeight:1.2}}>{order.client}</div>
                          <div style={{fontSize:10,color:'#507060',marginTop:1}}>{order.id}</div>
                        </div>
                      </div>
                      <div className="sg" style={{fontSize:18,fontWeight:800,color:'#00E676',flexShrink:0}}>+{order.earn}<span style={{fontSize:10,marginLeft:1}}>ЅМ</span></div>
                    </div>

                    {/* Address */}
                    <div style={{display:'flex',alignItems:'center',gap:5,marginBottom:10,padding:'7px 10px',background:'rgba(255,255,255,.03)',borderRadius:9}}>
                      <span style={{fontSize:12}}>📍</span>
                      <span style={{fontSize:12,color:'#8AB8A0',flex:1}}>{order.addr}</span>
                    </div>

                    {/* Bottom tags */}
                    <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                      <Tag color='#507060' bg='rgba(255,255,255,.04)'>🏍 {order.dist} км</Tag>
                      <Tag color={PAY_COLOR(order.pay)}>{order.pay === 'Наличными' ? '💵' : order.pay === 'Карта' ? '💳' : '🎁'} {order.pay}</Tag>
                      <div style={{marginLeft:'auto'}}>
                        <span className="sg" style={{fontSize:13,fontWeight:700,color:'#FFB800'}}>{order.prodSum+order.delFee} ЅМ</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}

        {/* ═══ ACTIVE TAB ═══ */}
        {tab==='active' && !active && (
          <div style={{textAlign:'center',padding:'48px 20px'}}>
            <div style={{fontSize:48,marginBottom:12}}>🛵</div>
            <div className="sg" style={{fontSize:15,fontWeight:700,color:'#E0F0E8'}}>Нет активной доставки</div>
            <div style={{fontSize:11,color:'#507060',marginTop:6}}>Примите заказ из списка</div>
            <button onClick={()=>setTab('orders')} className="btn"
              style={{marginTop:20,padding:'11px 24px',borderRadius:12,background:'rgba(0,230,118,.08)',border:'1px solid rgba(0,230,118,.2)',color:'#00E676',fontWeight:700,fontSize:12}}>
              Смотреть заказы
            </button>
          </div>
        )}

        {tab==='active' && active && (
          <div style={{paddingTop:4,display:'flex',flexDirection:'column',gap:10}}>
            {/* Progress steps */}
            <div style={{background:'#081410',borderRadius:16,padding:'16px',border:'1px solid #0F2015'}}>
              <div className="sg" style={{fontSize:12,fontWeight:700,color:'#507060',marginBottom:12,letterSpacing:.5}}>ПРОГРЕСС</div>
              <div style={{display:'flex',alignItems:'center'}}>
                {([['toStore','🏪','Магазин'],['toClient','🛵','Клиент'],['done','✓','Готово']] as const).map(([s,e,l],i)=>{
                  const isA = step===s
                  const isD = (step==='toClient'&&s==='toStore')||(step==='done'&&s!=='done')
                  return (
                    <div key={s} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',position:'relative'}}>
                      {i<2&&<div style={{position:'absolute',top:17,left:'50%',width:'100%',height:2,background:isD?'#00E676':'#0F2015',transition:'background .3s'}}/>}
                      <div style={{width:36,height:36,borderRadius:'50%',background:isA?'rgba(0,230,118,.15)':isD?'rgba(0,230,118,.08)':'#0C1C12',border:`2px solid ${isA?'#00E676':isD?'rgba(0,230,118,.4)':'#0F2015'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:isD?14:16,marginBottom:5,position:'relative',zIndex:1,transition:'all .3s',boxShadow:isA?'0 0 12px rgba(0,230,118,.3)':undefined}}>
                        {isD?'✓':e}
                      </div>
                      <span style={{fontSize:9,color:isA?'#00E676':isD?'rgba(0,230,118,.6)':'#507060',fontWeight:isA?700:500}}>{l}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Route card */}
            <div style={{background:'#081410',borderRadius:16,border:'1px solid #0F2015',overflow:'hidden'}}>
              <div style={{padding:'12px 16px',borderBottom:'1px solid rgba(255,255,255,.04)',display:'flex',gap:10,alignItems:'center'}}>
                <div style={{width:8,height:8,borderRadius:'50%',background:'#00E676',flexShrink:0,boxShadow:'0 0 6px #00E676'}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:9,color:'#507060',fontWeight:700,letterSpacing:.5,marginBottom:2}}>ЗАБРАТЬ</div>
                  <div style={{fontSize:13,fontWeight:600,color:'#E0F0E8'}}>KAKAPO · ул. Ленина 42</div>
                </div>
                <a href="tel:+992118559797" style={{padding:'6px 10px',borderRadius:8,background:'rgba(0,230,118,.08)',border:'1px solid rgba(0,230,118,.18)',color:'#00E676',fontSize:11,fontWeight:700,textDecoration:'none'}}>📞</a>
              </div>
              <div style={{padding:'12px 16px',display:'flex',gap:10,alignItems:'center'}}>
                <div style={{width:8,height:8,borderRadius:2,background:'#3B8EF0',flexShrink:0,boxShadow:'0 0 6px #3B8EF0'}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:9,color:'#507060',fontWeight:700,letterSpacing:.5,marginBottom:2}}>ДОСТАВИТЬ</div>
                  <div style={{fontSize:13,fontWeight:600,color:'#E0F0E8'}}>{active.addr}</div>
                  <div style={{fontSize:11,color:'#507060',marginTop:1}}>{active.client}</div>
                </div>
                <a href={`tel:${active.phone}`} style={{padding:'6px 10px',borderRadius:8,background:'rgba(59,142,240,.08)',border:'1px solid rgba(59,142,240,.18)',color:'#3B8EF0',fontSize:11,fontWeight:700,textDecoration:'none'}}>📞</a>
              </div>
            </div>

            {/* Items */}
            <div style={{background:'#081410',borderRadius:16,border:'1px solid #0F2015',overflow:'hidden'}}>
              <div style={{padding:'10px 16px',borderBottom:'1px solid rgba(255,255,255,.04)',fontSize:9,color:'#507060',fontWeight:700,letterSpacing:.5}}>СОСТАВ ЗАКАЗА</div>
              <div style={{padding:'4px 16px 12px'}}>
                {active.items.map((it:any,i:number)=>(
                  <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 0',borderBottom:i<active.items.length-1?'1px solid rgba(255,255,255,.04)':'none'}}>
                    <span style={{fontSize:13,color:'#C0D8C8'}}>{it.e} {it.n}</span>
                    <div style={{display:'flex',gap:8,alignItems:'center'}}>
                      <span style={{fontSize:10,color:'#507060'}}>×{it.q}</span>
                      <span className="sg" style={{fontSize:12,fontWeight:700,color:'#FFB800',minWidth:44,textAlign:'right'}}>{it.p*it.q} ЅМ</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Price */}
            <div style={{background:'#081410',borderRadius:16,padding:'14px 16px',border:'1px solid #0F2015'}}>
              <SumRow label="Товары" val={active.prodSum}/>
              <SumRow label="Доставка" val={active.delFee}/>
              <Divider/>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
                <span className="sg" style={{fontSize:13,fontWeight:700,color:'#E0F0E8'}}>Итого</span>
                <span className="sg" style={{fontSize:20,fontWeight:800,color:'#00E676'}}>{active.prodSum+active.delFee} ЅМ</span>
              </div>
              <div style={{marginTop:10,padding:'8px 12px',borderRadius:10,background:`${PAY_COLOR(active.pay)}10`,border:`1px solid ${PAY_COLOR(active.pay)}22`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:12,color:'#507060'}}>{active.pay==='Наличными'?'💵':'💳'} {active.pay}</span>
                <span className="sg" style={{fontSize:12,fontWeight:700,color:PAY_COLOR(active.pay)}}>{active.pay==='Наличными'?`${active.prodSum+active.delFee} ЅМ`:'Оплачено'}</span>
              </div>
            </div>

            {/* Action */}
            {step==='toStore' && (
              <button onClick={()=>setStep('toClient')} className="btn"
                style={{width:'100%',padding:15,borderRadius:14,background:'linear-gradient(135deg,#1A6ADF,#3B8EF0)',color:'white',fontWeight:800,fontSize:14,boxShadow:'0 6px 24px rgba(59,142,240,.3)'}}>
                📦 Забрал заказ → Еду к клиенту
              </button>
            )}
            {step==='toClient' && (
              <button onClick={()=>setStep('done')} className="btn"
                style={{width:'100%',padding:15,borderRadius:14,background:'linear-gradient(135deg,#1A6ADF,#3B8EF0)',color:'white',fontWeight:800,fontSize:14,boxShadow:'0 6px 24px rgba(59,142,240,.3)'}}>
                🏁 Приехал к клиенту
              </button>
            )}
            {step==='done' && (
              <button onClick={finishOrder} className="btn"
                style={{width:'100%',padding:15,borderRadius:14,background:'linear-gradient(135deg,#00A854,#00E676)',color:'#040C08',fontWeight:800,fontSize:14,boxShadow:'0 6px 24px rgba(0,230,118,.3)',animation:'glow 1.5s ease-in-out infinite'}}>
                ✅ Доставлено · Получить +{active.earn} ЅМ
              </button>
            )}
          </div>
        )}

        {/* ═══ EARNINGS TAB ═══ */}
        {tab==='earnings' && (
          <div style={{paddingTop:4,display:'flex',flexDirection:'column',gap:10}}>
            {/* Today hero */}
            <div style={{background:'#081410',borderRadius:18,padding:'20px',border:'1px solid rgba(255,184,0,.15)',position:'relative',overflow:'hidden'}}>
              <div style={{position:'absolute',inset:0,background:'radial-gradient(circle at 70% 30%,rgba(255,184,0,.06),transparent 65%)',pointerEvents:'none'}}/>
              <div style={{fontSize:10,color:'#507060',fontWeight:700,marginBottom:6,letterSpacing:.6}}>СЕГОДНЯ</div>
              <div className="sg" style={{fontSize:44,fontWeight:800,color:'#FFB800',lineHeight:1,marginBottom:12}}>42 <span style={{fontSize:18,color:'#507060'}}>ЅМ</span></div>
              <div style={{display:'flex',gap:8}}>
                <Tag color='#00E676'>📦 14 доставок</Tag>
                <Tag color='#FFB800'>⭐ {COURIER.rating}</Tag>
                <Tag color='#3B8EF0'>🏍 34.5 км</Tag>
              </div>
            </div>

            {/* Stats grid */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              {[
                {l:'За неделю', v:'1 240 ЅМ', c:'#00E676', e:'📅'},
                {l:'Всего доставок', v:'342', c:'#3B8EF0', e:'🏆'},
                {l:'Средний день', v:'177 ЅМ', c:'#FFB800', e:'📊'},
                {l:'Рейтинг', v:`${COURIER.rating} ★`, c:'#FFB800', e:'⭐'},
              ].map(s => (
                <div key={s.l} style={{background:'#081410',borderRadius:14,padding:'14px',border:'1px solid #0F2015'}}>
                  <div style={{fontSize:22,marginBottom:6}}>{s.e}</div>
                  <div className="sg" style={{fontSize:16,fontWeight:800,color:s.c,marginBottom:2}}>{s.v}</div>
                  <div style={{fontSize:10,color:'#507060',fontWeight:600}}>{s.l}</div>
                </div>
              ))}
            </div>

            {/* History */}
            <div className="sg" style={{fontSize:13,fontWeight:700,color:'#8AB8A0',padding:'4px 0'}}>История доставок</div>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {DONE.map((h,i) => (
                <div key={i} style={{background:'#081410',borderRadius:14,border:'1px solid #0F2015',overflow:'hidden'}}>
                  <div style={{padding:'12px 16px',display:'flex',alignItems:'center',gap:10}}>
                    <div style={{width:34,height:34,borderRadius:9,background:'rgba(0,230,118,.08)',border:'1px solid rgba(0,230,118,.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,flexShrink:0}}>✓</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:2}}>
                        <span className="sg" style={{fontSize:10,fontWeight:700,color:'#3B8EF0'}}>{h.id}</span>
                        <span style={{fontSize:12,fontWeight:600,color:'#E0F0E8',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{h.client}</span>
                      </div>
                      <div style={{fontSize:10,color:'#507060'}}>{h.addr} · {h.dist} км · {h.time}</div>
                    </div>
                    <div className="sg" style={{fontSize:15,fontWeight:800,color:'#00E676',flexShrink:0}}>+{h.earn}<span style={{fontSize:10}}>ЅМ</span></div>
                  </div>
                  {/* Price breakdown */}
                  <div style={{padding:'8px 16px',borderTop:'1px solid rgba(255,255,255,.04)',display:'flex',gap:6}}>
                    <Tag color='#FFB800'>Товары: {h.prodSum}</Tag>
                    <Tag color='#3B8EF0'>Доставка: {h.delFee}</Tag>
                    <Tag color='#00E676'>Итого: {h.prodSum+h.delFee}</Tag>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ══ BOTTOM SHEET OVERLAY ══ */}
      {sheet && (
        <>
          {/* Backdrop */}
          <div onClick={closeSheet} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.6)',backdropFilter:'blur(2px)',zIndex:100}}/>

          {/* Sheet */}
          <div style={{position:'fixed',bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:480,maxHeight:'78vh',background:'#081410',borderRadius:'20px 20px 0 0',zIndex:101,display:'flex',flexDirection:'column',boxShadow:'0 -12px 60px rgba(0,0,0,.8)',overflow:'hidden',animation:'fadeIn .25s ease'}}>
            {/* Handle */}
            <div style={{padding:'10px 0 0',display:'flex',justifyContent:'center',flexShrink:0}}>
              <div style={{width:32,height:4,borderRadius:2,background:'rgba(255,255,255,.1)'}}/>
            </div>

            {/* ── Detail sheet ── */}
            {sheet==='detail' && selOrder && (() => {
              const o = selOrder
              return (
                <>
                  <div style={{padding:'12px 18px 10px',display:'flex',alignItems:'center',gap:10,flexShrink:0,borderBottom:'1px solid rgba(255,255,255,.05)'}}>
                    <button onClick={closeSheet} className="btn" style={{width:32,height:32,borderRadius:8,background:'#0C1C12',border:'1px solid #0F2015',color:'#507060',fontSize:15,display:'flex',alignItems:'center',justifyContent:'center'}}>←</button>
                    <span className="sg" style={{fontSize:14,fontWeight:700,color:'#E0F0E8'}}>{o.client}</span>
                    <Tag color={PAY_COLOR(o.pay)}>{o.pay}</Tag>
                    <div style={{marginLeft:'auto'}} className="sg"><span style={{fontSize:19,fontWeight:800,color:'#00E676'}}>+{o.earn}</span><span style={{fontSize:11,color:'#507060'}}> ЅМ</span></div>
                  </div>

                  <div style={{overflowY:'auto',padding:'12px 18px 24px',display:'flex',flexDirection:'column',gap:10}}>
                    {/* Route */}
                    <div style={{background:'#0C1C12',borderRadius:14,border:'1px solid #0F2015',overflow:'hidden'}}>
                      <div style={{padding:'10px 14px',borderBottom:'1px solid rgba(255,255,255,.04)',display:'flex',gap:8,alignItems:'center'}}>
                        <div style={{width:7,height:7,borderRadius:'50%',background:'#00E676',flexShrink:0,boxShadow:'0 0 5px #00E676'}}/>
                        <div style={{flex:1}}><div style={{fontSize:8,color:'#507060',fontWeight:700,letterSpacing:.4,marginBottom:1}}>ЗАБРАТЬ</div><div style={{fontSize:12,fontWeight:600}}>KAKAPO · ул. Ленина 42</div></div>
                      </div>
                      <div style={{padding:'10px 14px',display:'flex',gap:8,alignItems:'center'}}>
                        <div style={{width:7,height:7,borderRadius:2,background:'#3B8EF0',flexShrink:0,boxShadow:'0 0 5px #3B8EF0'}}/>
                        <div style={{flex:1}}><div style={{fontSize:8,color:'#507060',fontWeight:700,letterSpacing:.4,marginBottom:1}}>ДОСТАВИТЬ</div><div style={{fontSize:12,fontWeight:600}}>{o.addr}</div></div>
                        <div style={{display:'flex',gap:5}}>
                          <Tag color='#507060' bg='rgba(255,255,255,.04)'>📍 {o.dist} км</Tag>
                        </div>
                      </div>
                    </div>

                    {/* Items */}
                    <div style={{background:'#0C1C12',borderRadius:14,border:'1px solid #0F2015',overflow:'hidden'}}>
                      <div style={{padding:'8px 14px',borderBottom:'1px solid rgba(255,255,255,.04)',fontSize:9,color:'#507060',fontWeight:700,letterSpacing:.5}}>СОСТАВ</div>
                      <div style={{padding:'4px 14px 10px'}}>
                        {o.items.map((it:any,i:number)=>(
                          <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 0',borderBottom:i<o.items.length-1?'1px solid rgba(255,255,255,.04)':'none'}}>
                            <span style={{fontSize:13,color:'#C0D8C8'}}>{it.e} {it.n} <span style={{color:'#507060'}}>×{it.q}</span></span>
                            <span className="sg" style={{fontSize:12,fontWeight:700,color:'#FFB800'}}>{it.p*it.q} ЅМ</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Price */}
                    <div style={{background:'#0C1C12',borderRadius:14,padding:'12px 14px',border:'1px solid #0F2015'}}>
                      <SumRow label="Товары" val={o.prodSum}/>
                      <SumRow label="Доставка" val={o.delFee}/>
                      <Divider/>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
                        <span className="sg" style={{fontSize:13,fontWeight:700}}>Итого</span>
                        <span className="sg" style={{fontSize:20,fontWeight:800,color:'#00E676'}}>{o.prodSum+o.delFee} ЅМ</span>
                      </div>
                    </div>

                    {/* Accept */}
                    <button onClick={()=>acceptOrder(o)} className="btn"
                      style={{width:'100%',padding:15,borderRadius:14,background:'linear-gradient(135deg,#00A854,#00E676)',color:'#040C08',fontWeight:800,fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',gap:8,boxShadow:'0 8px 28px rgba(0,230,118,.3)'}}>
                      🛵 Принять заказ
                      <span style={{padding:'2px 8px',borderRadius:6,background:'rgba(4,12,8,.2)',fontSize:12}}>+{o.earn} ЅМ</span>
                    </button>
                  </div>
                </>
              )
            })()}

            {/* ── Active mini-sheet (tap from map legend) ── */}
            {sheet==='active' && active && (
              <>
                <div style={{padding:'12px 18px 10px',display:'flex',alignItems:'center',gap:10,flexShrink:0,borderBottom:'1px solid rgba(255,255,255,.05)'}}>
                  <button onClick={closeSheet} className="btn" style={{width:32,height:32,borderRadius:8,background:'#0C1C12',border:'1px solid #0F2015',color:'#507060',fontSize:15,display:'flex',alignItems:'center',justifyContent:'center'}}>←</button>
                  <span className="sg" style={{fontSize:14,fontWeight:700}}>Активная доставка</span>
                  <span style={{padding:'3px 8px',borderRadius:6,background:'rgba(255,107,53,.1)',border:'1px solid rgba(255,107,53,.2)',fontSize:10,fontWeight:700,color:'#FF6B35'}}>
                    {step==='toStore'?'🏪 В магазин':step==='toClient'?'🛵 К клиенту':'✅ На месте'}
                  </span>
                </div>
                <div style={{overflowY:'auto',padding:'12px 18px 24px',display:'flex',flexDirection:'column',gap:8}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 14px',background:'#0C1C12',borderRadius:12,border:'1px solid #0F2015'}}>
                    <span style={{fontSize:13,color:'#C0D8C8'}}>{active.client} · {active.addr}</span>
                    <span className="sg" style={{fontSize:15,fontWeight:800,color:'#00E676'}}>+{active.earn} ЅМ</span>
                  </div>
                  {step==='toStore' && <button onClick={()=>{setStep('toClient');closeSheet();setTab('active')}} className="btn" style={{width:'100%',padding:14,borderRadius:12,background:'linear-gradient(135deg,#1A6ADF,#3B8EF0)',color:'white',fontWeight:800,fontSize:13}}>📦 Забрал → К клиенту</button>}
                  {step==='toClient' && <button onClick={()=>{setStep('done');closeSheet();setTab('active')}} className="btn" style={{width:'100%',padding:14,borderRadius:12,background:'linear-gradient(135deg,#1A6ADF,#3B8EF0)',color:'white',fontWeight:800,fontSize:13}}>🏁 На месте у клиента</button>}
                  {step==='done' && <button onClick={()=>{finishOrder();}} className="btn" style={{width:'100%',padding:14,borderRadius:12,background:'linear-gradient(135deg,#00A854,#00E676)',color:'#040C08',fontWeight:800,fontSize:13}}>✅ Доставлено · +{active.earn} ЅМ</button>}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
