'use client'
import { useState, useEffect } from 'react'
import { useOrders, useAuth } from '@/lib/store'
import Link from 'next/link'

// ── COURIER APP ──────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@700;800;900&family=Nunito:wght@400;600;700;800&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html,body{background:#030B05;color:#EBF5ED;font-family:'Nunito',sans-serif;}
  .ub{font-family:'Unbounded',sans-serif;}
  .btn{cursor:pointer;border:none;transition:all .2s;}.btn:active{transform:scale(.97);}
  .card{background:#091508;border:1px solid #162B1A;border-radius:18px;}
  .inp{background:#0C1C0F;border:1.5px solid #162B1A;border-radius:13px;color:#EBF5ED;font-family:'Nunito',sans-serif;font-size:14px;outline:none;padding:12px 15px;width:100%;transition:border-color .2s;}
  .inp:focus{border-color:rgba(59,142,240,.5);}
  @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
  @keyframes ping{0%{transform:scale(1);opacity:1}100%{transform:scale(2.2);opacity:0}}
`

const COURIER_DATA = {
  name: 'Фирдавс Назаров',
  phone: '+992 93 111 22 33',
  vehicle: '🏍 Honda CG 125',
  rating: 4.9,
  totalOrders: 342,
}

const DEMO_DELIVERIES = [
  {id:'K-4832',client:'Диловар Р.',addr:'ул. Ленина, 42, кв. 15',phone:'+992 93 456 78 90',total:64.30,status:'picked',time:'14:23',items:3,dist:'1.2 км'},
  {id:'K-4829',client:'Мадина О.', addr:'ул. Ленина, 18',         phone:'+992 93 321 65 43',total:47.80,status:'waiting',time:'13:55',items:4,dist:'0.8 км'},
  {id:'K-4825',client:'Зафар М.',  addr:'мкр. Мирный, 5',         phone:'+992 91 654 32 10',total:38.50,status:'waiting',time:'13:20',items:2,dist:'2.1 км'},
]

const SC: Record<string,{l:string,c:string}> = {
  waiting:   {l:'Ожидаю',   c:'#FFB800'},
  picked:    {l:'Везу',     c:'#3B8EF0'},
  delivered: {l:'Доставлен',c:'#1FD760'},
}

export default function CourierApp() {
  const [tab,     setTab]    = useState<'orders'|'map'|'history'|'stats'>('orders')
  const [loggedIn,setLoggedIn]= useState(false)
  const [otp,     setOtp]    = useState(['','','',''])
  const [err,     setErr]    = useState('')
  const [load,    setLoad]   = useState(false)
  const [deliveries, setDeliveries] = useState(DEMO_DELIVERIES)

  const verifyOTP = () => {
    const code = otp.join('')
    if(code.length<4) return
    setLoad(true)
    setTimeout(() => {
      if(code==='1234') setLoggedIn(true)
      else { setErr('Неверный код · Демо: 1234'); setOtp(['','','','']) }
      setLoad(false)
    }, 800)
  }

  const markDelivered = (id: string) => {
    setDeliveries(ds => ds.map(d => d.id===id ? {...d,status:'delivered'} : d))
  }

  const active = deliveries.filter(d=>d.status!=='delivered')
  const done   = deliveries.filter(d=>d.status==='delivered')

  if(!loggedIn) return (
    <div style={{minHeight:'100vh',background:'#030B05',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:24,maxWidth:480,margin:'0 auto'}}>
      <style>{CSS}</style>
      <a href="/" style={{position:'absolute',top:18,left:18,width:40,height:40,borderRadius:12,background:'#0C1C0F',border:'1px solid #162B1A',display:'flex',alignItems:'center',justifyContent:'center',textDecoration:'none',color:'#8FB897',fontSize:18}}>←</a>
      <div style={{textAlign:'center',marginBottom:28}}>
        <div style={{fontSize:52,marginBottom:14}}>🛵</div>
        <div style={{fontFamily:'Unbounded',fontSize:20,fontWeight:900,color:'#3B8EF0',marginBottom:4}}>Курьер KAKAPO</div>
        <div style={{fontSize:12,color:'#8FB897'}}>Введите OTP код из SMS</div>
      </div>
      <div style={{width:'100%',maxWidth:340,background:'#091508',border:'1px solid #162B1A',borderRadius:20,padding:24}}>
        {err&&<div style={{padding:'9px',borderRadius:10,background:'rgba(255,69,69,.1)',border:'1px solid rgba(255,69,69,.3)',fontSize:12,color:'#FF4545',marginBottom:12}}>⚠️ {err}</div>}
        <div style={{display:'flex',gap:10,justifyContent:'center',marginBottom:14}}>
          {otp.map((v,i)=>(
            <input key={i} id={`otp${i}`} value={v} type="password"
              onChange={e=>{const d=[...otp];d[i]=e.target.value.replace(/\D/,'').slice(-1);setOtp(d);if(e.target.value&&i<3)(document.getElementById(`otp${i+1}`) as HTMLInputElement)?.focus()}}
              onKeyDown={e=>{if(e.key==='Backspace'&&!v&&i>0){(document.getElementById(`otp${i-1}`) as HTMLInputElement)?.focus();const d=[...otp];d[i-1]='';setOtp(d)}}}
              maxLength={1} inputMode="numeric"
              style={{width:52,height:60,borderRadius:14,border:`2px solid ${v?'rgba(59,142,240,.5)':'#162B1A'}`,background:v?'rgba(59,142,240,.08)':'#0C1C0F',textAlign:'center',fontFamily:'Unbounded',fontSize:24,fontWeight:900,color:'#EBF5ED',outline:'none'}}/>
          ))}
        </div>
        <div style={{padding:'9px',borderRadius:9,background:'rgba(59,142,240,.06)',border:'1px solid rgba(59,142,240,.2)',fontSize:11,color:'#8FB897',marginBottom:12}}>
          💡 Демо OTP: <span style={{color:'#3B8EF0',fontWeight:700}}>1 2 3 4</span>
        </div>
        <button onClick={verifyOTP} className="btn" style={{width:'100%',padding:14,borderRadius:14,background:'linear-gradient(135deg,#1E5BB5,#3B8EF0)',border:'none',color:'white',fontFamily:'Nunito',fontWeight:800,fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:otp.join('').length<4?.5:1}}>
          {load?<div style={{width:18,height:18,borderRadius:'50%',border:'2.5px solid rgba(255,255,255,.3)',borderTopColor:'white',animation:'spin 1s linear infinite'}}/>:'🛵 Войти'}
        </button>
      </div>
    </div>
  )

  return (
    <div style={{minHeight:'100vh',background:'#030B05',maxWidth:480,margin:'0 auto',paddingBottom:90}}>
      <style>{CSS}</style>
      {/* Header */}
      <header style={{position:'sticky',top:0,zIndex:100,background:'rgba(3,11,5,.97)',backdropFilter:'blur(24px)',borderBottom:'1px solid #162B1A',padding:'13px 18px',display:'flex',alignItems:'center',gap:10}}>
        <div style={{width:40,height:40,borderRadius:13,background:'linear-gradient(135deg,#1E5BB5,#3B8EF0)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>🛵</div>
        <div style={{flex:1}}>
          <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:900,color:'#3B8EF0'}}>Курьер</div>
          <div style={{fontSize:10,color:'#8FB897'}}>{COURIER_DATA.name}</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6,padding:'5px 11px',borderRadius:10,background:'rgba(59,142,240,.1)',border:'1px solid rgba(59,142,240,.25)'}}>
          <div style={{width:6,height:6,borderRadius:'50%',background:'#3B8EF0',animation:'pulse 2s infinite'}}/>
          <span style={{fontSize:11,fontWeight:700,color:'#3B8EF0'}}>В сети</span>
        </div>
      </header>

      {/* Stats */}
      <div style={{padding:'14px 18px 0',display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:18}}>
        {[
          {l:'Активных',v:active.length,c:'#3B8EF0'},
          {l:'Сегодня',v:done.length+7,c:'#1FD760'},
          {l:'Заработок',v:'210 ЅМ',c:'#FFB800'},
        ].map((s,i)=>(
          <div key={i} style={{background:'#091508',border:'1px solid #162B1A',borderRadius:14,padding:'12px 10px',textAlign:'center',animation:`fadeUp .4s ease ${i*.06}s both`}}>
            <div style={{fontFamily:'Unbounded',fontSize:18,fontWeight:900,color:s.c,marginBottom:2}}>{s.v}</div>
            <div style={{fontSize:9,color:'#3D6645'}}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Orders */}
      <div style={{padding:'0 18px 20px',display:'flex',flexDirection:'column',gap:12}}>
        {active.length===0?(
          <div style={{textAlign:'center',paddingTop:40}}>
            <div style={{fontSize:52,marginBottom:12}}>✅</div>
            <div style={{fontFamily:'Unbounded',fontSize:16,fontWeight:800,color:'#3B8EF0'}}>Все доставлено!</div>
          </div>
        ):active.map((d,i)=>{
          const s=SC[d.status]
          return (
            <div key={d.id} className="card" style={{overflow:'hidden',animation:`fadeUp .4s ease ${i*.07}s both`,border:`1.5px solid ${s.c}28`}}>
              <div style={{padding:'8px 16px',background:`${s.c}10`,borderBottom:`1px solid ${s.c}25`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div style={{display:'flex',alignItems:'center',gap:7}}>
                  <div style={{width:6,height:6,borderRadius:'50%',background:s.c,animation:'pulse 2s infinite'}}/>
                  <span style={{fontSize:11,fontWeight:800,color:s.c}}>{s.l}</span>
                </div>
                <span style={{fontSize:10,color:'#3D6645'}}>{d.time}</span>
              </div>
              <div style={{padding:'14px 16px'}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
                  <div>
                    <div style={{fontFamily:'Unbounded',fontSize:13,fontWeight:800,color:'#3B8EF0',marginBottom:2}}>{d.id}</div>
                    <div style={{fontSize:13,fontWeight:700,marginBottom:1}}>{d.client}</div>
                    <div style={{fontSize:11,color:'#8FB897'}}>📍 {d.addr}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontFamily:'Unbounded',fontSize:16,fontWeight:900,marginBottom:2}}>{d.total.toFixed(2)} <span style={{fontSize:10,color:'#FFB800'}}>ЅМ</span></div>
                    <div style={{fontSize:11,color:'#8FB897'}}>{d.items} товаров · {d.dist}</div>
                  </div>
                </div>
                <div style={{display:'flex',gap:8}}>
                  <a href={`tel:${d.phone}`} style={{flex:1,padding:'10px',borderRadius:11,background:'rgba(59,142,240,.1)',border:'1.5px solid rgba(59,142,240,.3)',color:'#3B8EF0',fontSize:12,fontWeight:700,textDecoration:'none',textAlign:'center',fontFamily:'Nunito'}}>📞 Звонок</a>
                  <button onClick={()=>markDelivered(d.id)} className="btn" style={{flex:2,padding:'10px',borderRadius:11,background:'linear-gradient(135deg,#17B34E,#1FD760)',border:'none',color:'white',fontSize:12,fontFamily:'Nunito',fontWeight:700}}>✓ Доставлено</button>
                </div>
              </div>
            </div>
          )
        })}

        {done.length>0&&(
          <div style={{marginTop:8}}>
            <div style={{fontFamily:'Unbounded',fontSize:12,fontWeight:800,color:'#1D3822',marginBottom:10}}>ДОСТАВЛЕНО СЕГОДНЯ</div>
            {done.map((d,i)=>(
              <div key={d.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 14px',background:'#091508',border:'1px solid #162B1A',borderRadius:12,marginBottom:8,opacity:.6}}>
                <div><div style={{fontFamily:'Unbounded',fontSize:11,fontWeight:800,color:'#1FD760'}}>{d.id}</div><div style={{fontSize:11,color:'#8FB897'}}>{d.client}</div></div>
                <div style={{textAlign:'right'}}><div style={{fontSize:12,fontWeight:700}}>{d.total.toFixed(2)} ЅМ</div><span style={{fontSize:10,color:'#1FD760',fontWeight:700}}>✓ Доставлен</span></div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Nav */}
      <nav style={{position:'fixed',bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:480,background:'rgba(3,11,5,.97)',backdropFilter:'blur(26px)',borderTop:'1px solid #162B1A',padding:'8px 18px 20px',display:'flex',justifyContent:'space-around'}}>
        <a href="/" style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3,padding:'5px 10px',textDecoration:'none'}}>
          <span style={{fontSize:20}}>🏠</span>
          <span style={{fontSize:10,fontWeight:600,color:'#3D6645',fontFamily:'Nunito'}}>Главная</span>
        </a>
        <button onClick={()=>setLoggedIn(false)} className="btn" style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3,padding:'5px 10px',background:'transparent'}}>
          <span style={{fontSize:20}}>🚪</span>
          <span style={{fontSize:10,fontWeight:600,color:'#FF4545',fontFamily:'Nunito'}}>Выйти</span>
        </button>
      </nav>
    </div>
  )
}
