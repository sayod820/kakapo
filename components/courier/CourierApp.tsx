'use client'
import { useState } from 'react'

/* ══════════════════════════════════════════════════════
   KAKAPO КУРЬЕР — полное приложение
   Приём заказов · Карта · Маршрут · GPS · Заработок
══════════════════════════════════════════════════════ */
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@700;800;900&family=Nunito:wght@400;600;700;800&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
  html,body{background:#030B05;color:#EBF5ED;font-family:'Nunito',sans-serif;-webkit-font-smoothing:antialiased;}
  .ub{font-family:'Unbounded',sans-serif;}
  .btn{cursor:pointer;border:none;transition:all .2s cubic-bezier(.16,1,.3,1);}.btn:active{transform:scale(.96);}
  @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
  @keyframes ping{0%{transform:scale(1);opacity:1}100%{transform:scale(2.4);opacity:0}}
  ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:#06100A}::-webkit-scrollbar-thumb{background:#1D3822;border-radius:2px}
`

const COURIER = { name:'Фирдавс Назаров', vehicle:'🏍 TJ 1234 AA' }

const NEW_ORDERS = [
  { id:'K-4831', client:'Нилуфар Хасанова', phone:'+992 90 123 45 67', addr:'ул. Сомони, 12', dist:3.4, weight:8.5, earning:5, pay:'Карта',
    items:[{e:'🥛',n:'Молоко',q:2},{e:'🧀',n:'Сыр',q:1},{e:'☕',n:'Кофе',q:1}] },
  { id:'K-4835', client:'Рустам Давлатов', phone:'+992 91 445 23 11', addr:'мкр. Мирный, 5', dist:1.8, weight:2.0, earning:3, pay:'Наличными',
    items:[{e:'🥦',n:'Брокколи',q:2},{e:'🍅',n:'Томаты',q:1}] },
  { id:'K-4838', client:'Зафар Мирзоев', phone:'+992 88 789 01 23', addr:'ул. Рудаки, 8', dist:2.6, weight:5.2, earning:4, pay:'Бонусы',
    items:[{e:'🍞',n:'Хлеб',q:2},{e:'🥚',n:'Яйца',q:1},{e:'🧃',n:'Сок',q:3}] },
]

const HISTORY = [
  { id:'K-4820', client:'Лола М.', addr:'ул. Ленина 5', earning:5, time:'13:20', dist:'2.1 км' },
  { id:'K-4815', client:'Бахром К.', addr:'мкр. Мирный 12', earning:4, time:'12:45', dist:'1.5 км' },
  { id:'K-4810', client:'Зубайр Р.', addr:'ул. Сомони 8', earning:6, time:'12:10', dist:'3.8 км' },
]

export default function CourierApp() {
  const [logged, setLogged] = useState(false)
  const [tab, setTab] = useState<'orders'|'active'|'earnings'>('orders')
  const [status, setStatus] = useState<'available'|'busy'|'offline'>('available')
  const [activeOrder, setActiveOrder] = useState<any>(null)
  const [step, setStep] = useState<'toStore'|'toClient'|'done'>('toStore')
  const [completed, setCompleted] = useState<string[]>([])
  const [otp, setOtp] = useState(['','','',''])
  const [err, setErr] = useState('')
  const [load, setLoad] = useState(false)

  const verify = () => {
    if(otp.join('').length<4) return
    setLoad(true)
    setTimeout(()=>{
      if(otp.join('')==='1234') setLogged(true)
      else { setErr('Неверный код · Демо: 1234'); setOtp(['','','','']) }
      setLoad(false)
    }, 700)
  }

  const acceptOrder = (order:any) => { setActiveOrder(order); setStatus('busy'); setStep('toStore'); setTab('active') }
  const finishDelivery = () => { setCompleted(c=>[...c, activeOrder.id]); setActiveOrder(null); setStatus('available'); setTab('orders') }
  const available = NEW_ORDERS.filter(o=>!completed.includes(o.id) && o.id!==activeOrder?.id)

  if(!logged) return (
    <div style={{minHeight:'100vh',background:'#030B05',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:24,maxWidth:480,margin:'0 auto'}}>
      <style>{CSS}</style>
      <a href="/" style={{position:'absolute',top:18,left:18,width:40,height:40,borderRadius:12,background:'#0C1C0F',border:'1px solid #162B1A',display:'flex',alignItems:'center',justifyContent:'center',textDecoration:'none',color:'#8FB897',fontSize:18}}>←</a>
      <div style={{textAlign:'center',marginBottom:28}}>
        <div style={{fontSize:54,marginBottom:14}}>🛵</div>
        <div className="ub" style={{fontSize:20,fontWeight:900,color:'#3B8EF0',marginBottom:4}}>Курьер KAKAPO</div>
        <div style={{fontSize:12,color:'#8FB897'}}>Введите OTP код из SMS</div>
      </div>
      <div style={{width:'100%',maxWidth:340,background:'#091508',border:'1px solid #162B1A',borderRadius:20,padding:24}}>
        {err&&<div style={{padding:'9px',borderRadius:10,background:'rgba(255,69,69,.1)',border:'1px solid rgba(255,69,69,.3)',fontSize:12,color:'#FF4545',marginBottom:12}}>⚠️ {err}</div>}
        <div style={{display:'flex',gap:10,justifyContent:'center',marginBottom:14}}>
          {otp.map((v,i)=>(
            <input key={i} id={`o${i}`} value={v} type="tel" maxLength={1} inputMode="numeric"
              onChange={e=>{const d=[...otp];d[i]=e.target.value.replace(/\D/,'').slice(-1);setOtp(d);if(e.target.value&&i<3)(document.getElementById(`o${i+1}`) as HTMLInputElement)?.focus()}}
              onKeyDown={e=>{if(e.key==='Backspace'&&!v&&i>0)(document.getElementById(`o${i-1}`) as HTMLInputElement)?.focus()}}
              style={{width:52,height:60,borderRadius:14,border:`2px solid ${v?'rgba(59,142,240,.5)':'#162B1A'}`,background:v?'rgba(59,142,240,.08)':'#0C1C0F',textAlign:'center',fontFamily:'Unbounded',fontSize:24,fontWeight:900,color:'#EBF5ED',outline:'none'}}/>
          ))}
        </div>
        <div style={{padding:'9px',borderRadius:9,background:'rgba(59,142,240,.06)',border:'1px solid rgba(59,142,240,.2)',fontSize:11,color:'#8FB897',marginBottom:12,textAlign:'center'}}>
          💡 Демо OTP: <span style={{color:'#3B8EF0',fontWeight:700}}>1 2 3 4</span>
        </div>
        <button onClick={verify} className="btn" style={{width:'100%',padding:14,borderRadius:14,background:'linear-gradient(135deg,#1E5BB5,#3B8EF0)',border:'none',color:'white',fontFamily:'Nunito',fontWeight:800,fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:otp.join('').length<4?.5:1}}>
          {load?<div style={{width:18,height:18,borderRadius:'50%',border:'2.5px solid rgba(255,255,255,.3)',borderTopColor:'white',animation:'spin 1s linear infinite'}}/>:'🛵 Войти'}
        </button>
      </div>
    </div>
  )

  return (
    <div style={{minHeight:'100vh',background:'#030B05',maxWidth:480,margin:'0 auto',paddingBottom:80}}>
      <style>{CSS}</style>
      <header style={{position:'sticky',top:0,zIndex:100,background:'rgba(3,11,5,.97)',backdropFilter:'blur(24px)',borderBottom:'1px solid #162B1A',padding:'12px 18px',display:'flex',alignItems:'center',gap:10}}>
        <div style={{width:40,height:40,borderRadius:13,background:'linear-gradient(135deg,#1E5BB5,#3B8EF0)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>🛵</div>
        <div style={{flex:1}}>
          <div className="ub" style={{fontSize:14,fontWeight:900}}>{COURIER.name}</div>
          <div style={{display:'flex',alignItems:'center',gap:5,marginTop:1}}>
            <div style={{width:6,height:6,borderRadius:'50%',background:status==='available'?'#1FD760':status==='busy'?'#FFB800':'#3D6645',animation:'pulse 2s infinite'}}/>
            <span style={{fontSize:10,color:'#8FB897'}}>{status==='available'?'Свободен':status==='busy'?'В заказе':'Офлайн'} · {COURIER.vehicle}</span>
          </div>
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:9,color:'#3D6645'}}>Сегодня</div>
          <div className="ub" style={{fontSize:15,fontWeight:900,color:'#FFB800'}}>42 ЅМ</div>
        </div>
      </header>

      {tab==='orders' && (
        <div style={{padding:'14px 18px'}}>
          <div style={{display:'flex',gap:8,marginBottom:16}}>
            {([['available','Свободен','#1FD760'],['busy','В заказе','#FFB800'],['offline','Офлайн','#3D6645']] as const).map(([s,l,c])=>(
              <button key={s} onClick={()=>setStatus(s)} className="btn" style={{flex:1,padding:'9px 6px',borderRadius:11,fontSize:11,fontWeight:700,border:`1.5px solid ${status===s?c:'#162B1A'}`,background:status===s?c+'18':'#091508',color:status===s?c:'#8FB897',fontFamily:'Nunito'}}>{l}</button>
            ))}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:18}}>
            {[['Заработано','42 ЅМ','#FFB800'],['Доставок','14','#1FD760'],['Рейтинг','4.9 ★','#FFB800']].map(([l,v,c],i)=>(
              <div key={i} style={{background:'#091508',border:'1px solid #162B1A',borderRadius:14,padding:'12px 10px',textAlign:'center'}}>
                <div className="ub" style={{fontSize:15,fontWeight:900,color:c,marginBottom:3}}>{v}</div>
                <div style={{fontSize:10,color:'#3D6645'}}>{l}</div>
              </div>
            ))}
          </div>
          <div className="ub" style={{fontSize:14,fontWeight:800,marginBottom:12,display:'flex',alignItems:'center',gap:8}}>
            Новые заказы
            <span style={{padding:'2px 8px',borderRadius:8,fontSize:11,fontWeight:800,background:'rgba(255,69,69,.12)',color:'#FF4545',border:'1px solid rgba(255,69,69,.28)'}}>{available.length}</span>
          </div>
          {status==='offline' ? (
            <div style={{textAlign:'center',padding:'40px 0',color:'#8FB897'}}>
              <div style={{fontSize:48,marginBottom:12}}>😴</div>
              <div style={{fontWeight:700,marginBottom:4}}>Вы офлайн</div>
              <div style={{fontSize:12,color:'#3D6645'}}>Включите «Свободен» чтобы получать заказы</div>
            </div>
          ) : (
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              {available.map((order,idx)=>(
                <div key={order.id} style={{background:'#091508',border:'1.5px solid #162B1A',borderRadius:18,overflow:'hidden',animation:`fadeUp .4s ease ${idx*.08}s both`}}>
                  <div style={{padding:'13px 16px',borderBottom:'1px solid #162B1A',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <div>
                      <span className="ub" style={{fontSize:13,fontWeight:800,color:'#3B8EF0'}}>{order.id}</span>
                      <span style={{fontSize:11,color:'#8FB897',marginLeft:8}}>{order.client.split(' ')[0]} · {order.pay}</span>
                    </div>
                    <div className="ub" style={{fontSize:18,fontWeight:900,color:'#FFB800'}}>+{order.earning} ЅМ</div>
                  </div>
                  <div style={{padding:'12px 16px',borderBottom:'1px solid #162B1A'}}>
                    <div style={{display:'flex',gap:8,marginBottom:8}}>
                      <div style={{width:8,height:8,borderRadius:'50%',background:'#1FD760',marginTop:4,flexShrink:0}}/>
                      <div><div style={{fontSize:10,color:'#3D6645'}}>ЗАБРАТЬ</div><div style={{fontSize:13,fontWeight:700}}>KAKAPO, ул. Ленина 42</div></div>
                    </div>
                    <div style={{display:'flex',gap:8}}>
                      <div style={{width:8,height:8,borderRadius:2,background:'#3B8EF0',marginTop:4,flexShrink:0}}/>
                      <div><div style={{fontSize:10,color:'#3D6645'}}>ДОСТАВИТЬ</div><div style={{fontSize:13,fontWeight:700}}>{order.addr}</div></div>
                    </div>
                  </div>
                  <div style={{padding:'10px 16px',borderBottom:'1px solid #162B1A',display:'flex',gap:8,flexWrap:'wrap'}}>
                    <span style={{padding:'4px 9px',borderRadius:8,fontSize:11,fontWeight:700,background:'rgba(59,142,240,.1)',color:'#3B8EF0',border:'1px solid rgba(59,142,240,.25)'}}>📍 {order.dist} км</span>
                    <span style={{padding:'4px 9px',borderRadius:8,fontSize:11,fontWeight:700,background:'rgba(255,184,0,.1)',color:'#FFB800',border:'1px solid rgba(255,184,0,.25)'}}>⚖️ {order.weight} кг</span>
                    {order.items.map((it,i)=><span key={i} style={{padding:'4px 9px',borderRadius:8,fontSize:11,background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897'}}>{it.e} {it.n}</span>)}
                  </div>
                  <div style={{padding:'12px 16px'}}>
                    <button onClick={()=>acceptOrder(order)} className="btn" style={{width:'100%',padding:13,borderRadius:13,background:'linear-gradient(135deg,#17B34E,#1FD760)',border:'none',color:'#030B05',fontFamily:'Nunito',fontWeight:800,fontSize:14}}>✓ Принять — +{order.earning} ЅМ</button>
                  </div>
                </div>
              ))}
              {available.length===0&&(
                <div style={{textAlign:'center',padding:'40px 0',color:'#8FB897'}}>
                  <div style={{fontSize:48,marginBottom:12}}>📭</div>
                  <div style={{fontWeight:700}}>Нет новых заказов</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab==='active' && (
        activeOrder ? (
          <div>
            <div style={{position:'relative',height:240,background:'linear-gradient(135deg,#0A1828,#0D2818)',overflow:'hidden',borderBottom:'1px solid #162B1A'}}>
              <svg width="100%" height="100%" style={{position:'absolute',inset:0,opacity:.15}}>
                {Array.from({length:10}).map((_,i)=><line key={'h'+i} x1="0" y1={i*26} x2="100%" y2={i*26} stroke="#1FD760" strokeWidth="0.5"/>)}
                {Array.from({length:14}).map((_,i)=><line key={'v'+i} x1={i*36} y1="0" x2={i*36} y2="100%" stroke="#1FD760" strokeWidth="0.5"/>)}
              </svg>
              <svg width="100%" height="100%" viewBox="0 0 400 240" style={{position:'absolute',inset:0}}>
                <path d="M 80 180 Q 180 100 320 70" fill="none" stroke="#3B8EF0" strokeWidth="3" strokeDasharray="8 6" strokeLinecap="round" opacity="0.8"/>
                <circle cx="80" cy="180" r="9" fill="#1FD760"/>
                <circle cx="80" cy="180" r="9" fill="none" stroke="#1FD760" strokeWidth="2" opacity="0.4" style={{animation:'ping 1.8s ease-out infinite',transformOrigin:'80px 180px'}}/>
                <circle cx="320" cy="70" r="9" fill="#FF4545"/>
                <text x={step==='toStore'?'80':'320'} y={step==='toStore'?'174':'64'} fontSize="22" textAnchor="middle" style={{transition:'all 1s'}}>🛵</text>
              </svg>
              <div style={{position:'absolute',bottom:12,left:12,padding:'6px 12px',borderRadius:10,background:'rgba(3,11,5,.85)',border:'1px solid rgba(31,215,96,.3)',fontSize:9,color:'#1FD760'}}>🟢 Магазин</div>
              <div style={{position:'absolute',top:12,right:12,padding:'6px 12px',borderRadius:10,background:'rgba(3,11,5,.85)',border:'1px solid rgba(255,69,69,.3)',fontSize:9,color:'#FF4545'}}>🔴 {activeOrder.client.split(' ')[0]}</div>
              <div style={{position:'absolute',top:12,left:12,padding:'8px 13px',borderRadius:12,background:'rgba(59,142,240,.15)',border:'1px solid rgba(59,142,240,.4)'}}>
                <div className="ub" style={{fontSize:16,fontWeight:900,color:'#3B8EF0'}}>{activeOrder.dist} км</div>
                <div style={{fontSize:9,color:'#8FB897'}}>~{Math.round(activeOrder.dist*4)} мин</div>
              </div>
            </div>
            <div style={{padding:'16px 18px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                <div>
                  <span className="ub" style={{fontSize:16,fontWeight:900,color:'#3B8EF0'}}>{activeOrder.id}</span>
                  <div style={{fontSize:12,color:'#8FB897',marginTop:2}}>{activeOrder.client}</div>
                </div>
                <div className="ub" style={{fontSize:20,fontWeight:900,color:'#FFB800'}}>+{activeOrder.earning} ЅМ</div>
              </div>
              <div style={{display:'flex',marginBottom:18}}>
                {([['toStore','🏪','В магазин'],['toClient','🛵','К клиенту'],['done','✓','Доставлено']] as const).map(([s,e,l],i)=>{
                  const active = step===s
                  const done = (step==='toClient'&&s==='toStore')||(step==='done'&&s!=='done')
                  return (
                    <div key={s} style={{flex:1,textAlign:'center',position:'relative'}}>
                      {i<2&&<div style={{position:'absolute',top:18,left:'50%',width:'100%',height:2,background:done?'#1FD760':'#162B1A'}}/>}
                      <div style={{width:38,height:38,borderRadius:'50%',background:active?'#3B8EF0':done?'#1FD760':'#0C1C0F',border:`2px solid ${active?'#3B8EF0':done?'#1FD760':'#162B1A'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,margin:'0 auto 6px',position:'relative',zIndex:1}}>{done?'✓':e}</div>
                      <div style={{fontSize:10,fontWeight:active?700:400,color:active?'#3B8EF0':done?'#1FD760':'#3D6645'}}>{l}</div>
                    </div>
                  )
                })}
              </div>
              <div style={{background:'#091508',border:'1px solid #162B1A',borderRadius:16,padding:'14px 16px',marginBottom:14}}>
                <div style={{display:'flex',gap:10,marginBottom:12,paddingBottom:12,borderBottom:'1px solid #162B1A'}}>
                  <div style={{width:10,height:10,borderRadius:'50%',background:'#1FD760',marginTop:4,flexShrink:0}}/>
                  <div style={{flex:1}}><div style={{fontSize:10,color:'#3D6645'}}>ЗАБРАТЬ ЗАКАЗ</div><div style={{fontSize:13,fontWeight:700}}>KAKAPO, ул. Ленина 42</div></div>
                  <a href="tel:+992118559797" style={{padding:'6px 10px',borderRadius:9,background:'rgba(31,215,96,.1)',border:'1px solid rgba(31,215,96,.3)',color:'#1FD760',fontSize:11,fontWeight:700,textDecoration:'none',alignSelf:'center'}}>📞</a>
                </div>
                <div style={{display:'flex',gap:10}}>
                  <div style={{width:10,height:10,borderRadius:2,background:'#3B8EF0',marginTop:4,flexShrink:0}}/>
                  <div style={{flex:1}}><div style={{fontSize:10,color:'#3D6645'}}>ДОСТАВИТЬ КЛИЕНТУ</div><div style={{fontSize:13,fontWeight:700}}>{activeOrder.addr}</div><div style={{fontSize:11,color:'#8FB897',marginTop:1}}>{activeOrder.client}</div></div>
                  <a href={`tel:${activeOrder.phone}`} style={{padding:'6px 10px',borderRadius:9,background:'rgba(59,142,240,.1)',border:'1px solid rgba(59,142,240,.3)',color:'#3B8EF0',fontSize:11,fontWeight:700,textDecoration:'none',alignSelf:'center'}}>📞</a>
                </div>
              </div>
              <div style={{background:'#091508',border:'1px solid #162B1A',borderRadius:16,padding:'12px 16px',marginBottom:18}}>
                <div style={{fontSize:11,color:'#3D6645',marginBottom:8,fontWeight:700}}>СОСТАВ ЗАКАЗА</div>
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  {activeOrder.items.map((it:any,i:number)=><span key={i} style={{padding:'5px 10px',borderRadius:9,fontSize:12,background:'#0C1C0F',border:'1px solid #162B1A',color:'#EBF5ED'}}>{it.e} {it.n} ×{it.q}</span>)}
                </div>
              </div>
              {step==='toStore' && <button onClick={()=>setStep('toClient')} className="btn" style={{width:'100%',padding:15,borderRadius:15,background:'linear-gradient(135deg,#1E5BB5,#3B8EF0)',border:'none',color:'white',fontFamily:'Nunito',fontWeight:800,fontSize:15}}>📦 Забрал заказ — еду к клиенту</button>}
              {step==='toClient' && <button onClick={()=>setStep('done')} className="btn" style={{width:'100%',padding:15,borderRadius:15,background:'linear-gradient(135deg,#1E5BB5,#3B8EF0)',border:'none',color:'white',fontFamily:'Nunito',fontWeight:800,fontSize:15}}>🏁 Я на месте у клиента</button>}
              {step==='done' && <button onClick={finishDelivery} className="btn" style={{width:'100%',padding:15,borderRadius:15,background:'linear-gradient(135deg,#17B34E,#1FD760)',border:'none',color:'#030B05',fontFamily:'Nunito',fontWeight:800,fontSize:15,boxShadow:'0 8px 24px rgba(31,215,96,.4)'}}>✓ Доставлено — получить +{activeOrder.earning} ЅМ</button>}
            </div>
          </div>
        ) : (
          <div style={{textAlign:'center',padding:'80px 20px',color:'#8FB897'}}>
            <div style={{fontSize:54,marginBottom:14}}>🛵</div>
            <div className="ub" style={{fontSize:16,fontWeight:800,marginBottom:6}}>Нет активной доставки</div>
            <div style={{fontSize:12,color:'#3D6645',marginBottom:20}}>Примите заказ во вкладке «Заказы»</div>
            <button onClick={()=>setTab('orders')} className="btn" style={{padding:'11px 22px',borderRadius:12,background:'rgba(59,142,240,.12)',border:'1.5px solid rgba(59,142,240,.3)',color:'#3B8EF0',fontFamily:'Nunito',fontWeight:700,fontSize:13}}>← К заказам</button>
          </div>
        )
      )}

      {tab==='earnings' && (
        <div style={{padding:'14px 18px'}}>
          <div style={{background:'linear-gradient(135deg,#0A1828,#163050)',border:'1px solid rgba(59,142,240,.3)',borderRadius:20,padding:'20px',marginBottom:16,textAlign:'center'}}>
            <div style={{fontSize:11,color:'#8FB897',marginBottom:6}}>Заработано сегодня</div>
            <div className="ub" style={{fontSize:38,fontWeight:900,color:'#FFB800',marginBottom:4}}>210 ЅМ</div>
            <div style={{fontSize:12,color:'#3B8EF0'}}>14 доставок · 4.9 ★</div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:18}}>
            {[['За неделю','1 240 ЅМ','#1FD760'],['Всего доставок','342','#3B8EF0'],['Ср. за день','177 ЅМ','#FFB800'],['Рейтинг','4.9 ★','#FFB800']].map(([l,v,c],i)=>(
              <div key={i} style={{background:'#091508',border:'1px solid #162B1A',borderRadius:14,padding:'14px',textAlign:'center'}}>
                <div className="ub" style={{fontSize:18,fontWeight:900,color:c,marginBottom:3}}>{v}</div>
                <div style={{fontSize:10,color:'#3D6645'}}>{l}</div>
              </div>
            ))}
          </div>
          <div className="ub" style={{fontSize:14,fontWeight:800,marginBottom:12}}>История доставок</div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {HISTORY.map((h,i)=>(
              <div key={i} style={{background:'#091508',border:'1px solid #162B1A',borderRadius:13,padding:'12px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:34,height:34,borderRadius:9,background:'rgba(31,215,96,.12)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14}}>✓</div>
                  <div><div style={{fontSize:13,fontWeight:700}}>{h.id} · {h.client}</div><div style={{fontSize:11,color:'#3D6645'}}>{h.addr} · {h.dist}</div></div>
                </div>
                <div style={{textAlign:'right'}}><div className="ub" style={{fontSize:13,fontWeight:800,color:'#FFB800'}}>+{h.earning} ЅМ</div><div style={{fontSize:10,color:'#3D6645'}}>{h.time}</div></div>
              </div>
            ))}
          </div>
        </div>
      )}

      <nav style={{position:'fixed',bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:480,background:'rgba(3,11,5,.97)',backdropFilter:'blur(26px)',borderTop:'1px solid #162B1A',padding:'8px 18px 20px',display:'flex',justifyContent:'space-around',zIndex:80}}>
        {([['orders','📋','Заказы'],['active','🛵','Доставка'],['earnings','💰','Заработок']] as const).map(([id,icon,label])=>(
          <button key={id} onClick={()=>setTab(id)} className="btn" style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3,padding:'5px 16px',borderRadius:11,background:tab===id?'rgba(59,142,240,.12)':'transparent',border:`1.5px solid ${tab===id?'rgba(59,142,240,.3)':'transparent'}`,position:'relative'}}>
            <span style={{fontSize:20}}>{icon}</span>
            <span style={{fontSize:10,fontWeight:tab===id?800:600,color:tab===id?'#3B8EF0':'#3D6645',fontFamily:'Nunito'}}>{label}</span>
            {id==='active'&&activeOrder&&<div style={{position:'absolute',top:2,right:10,width:8,height:8,borderRadius:'50%',background:'#FFB800',animation:'pulse 1.5s infinite'}}/>}
          </button>
        ))}
      </nav>
    </div>
  )
}
