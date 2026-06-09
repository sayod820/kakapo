'use client'
import { useState } from 'react'

/* ══════════════════════════════════════════════════════
   KAKAPO КУРЬЕР — карта со всеми заказами + список
   Выбор заказа с карты или из списка · приём · маршрут
══════════════════════════════════════════════════════ */

const CSS = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
  html,body{background:#030B05;color:#EBF5ED;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden;}
  .ub{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;}
  .btn{cursor:pointer;border:none;transition:all .2s cubic-bezier(.16,1,.3,1);}
  .btn:active{transform:scale(.96);}
  @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
  @keyframes fadeIn{from{opacity:0}to{opacity:1}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  @keyframes ping{0%{transform:scale(1);opacity:.7}100%{transform:scale(2.6);opacity:0}}
  @keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
  @keyframes slideUp{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:translateY(0)}}
  @keyframes dashmove{to{stroke-dashoffset:-24}}
  @keyframes glow{0%,100%{box-shadow:0 0 12px rgba(59,142,240,.4)}50%{box-shadow:0 0 24px rgba(59,142,240,.7)}}
  ::-webkit-scrollbar{width:0;height:0;}
`;

const COURIER = { name:'Фирдавс Назаров', vehicle:'🏍 TJ 1234 AA', rating:4.9 };

const ORDERS = [
  { id:'K-4831', client:'Нилуфар Хасанова', phone:'+992 90 123 45 67', addr:'ул. Сомони, 12',  mx:72, my:28, dist:3.4, weight:8.5, earning:5, pay:'Наличными', time:'14:23',
    sum:46.40, delivery:5, items:[{e:'🥛',n:'Молоко',q:2,p:4.90},{e:'🧀',n:'Сыр',q:1,p:18.5},{e:'☕',n:'Кофе',q:1,p:18.0}] },
  { id:'K-4835', client:'Рустам Давлатов',  phone:'+992 91 445 23 11', addr:'мкр. Мирный, 5',   mx:35, my:62, dist:1.8, weight:2.0, earning:3, pay:'Наличными', time:'14:10',
    sum:18.90, delivery:5, items:[{e:'🥦',n:'Брокколи',q:2,p:5.50},{e:'🍅',n:'Томаты',q:1,p:7.90}] },
  { id:'K-4838', client:'Зафар Мирзоев',    phone:'+992 88 789 01 23', addr:'ул. Рудаки, 8',    mx:80, my:70, dist:2.6, weight:5.2, earning:4, pay:'Наличными', time:'13:58',
    sum:32.10, delivery:5, items:[{e:'🍞',n:'Хлеб',q:2,p:3.20},{e:'🥚',n:'Яйца',q:1,p:8.90},{e:'🧃',n:'Сок',q:3,p:5.60}] },
  { id:'K-4841', client:'Мадина Олимова',   phone:'+992 93 321 65 43', addr:'ул. Ленина, 18',   mx:50, my:40, dist:1.2, weight:3.4, earning:3, pay:'Наличными', time:'13:45',
    sum:37.20, delivery:0, items:[{e:'🍫',n:'Шоколад',q:4,p:6.50},{e:'🧃',n:'Сок',q:2,p:5.60}] },
];

const HISTORY = [
  { id:'K-4820', client:'Лола М.',    addr:'ул. Ленина 5',    earning:5, time:'13:20', dist:'2.1 км', rating:5 },
  { id:'K-4815', client:'Бахром К.',  addr:'мкр. Мирный 12',  earning:4, time:'12:45', dist:'1.5 км', rating:5 },
  { id:'K-4810', client:'Зубайр Р.',  addr:'ул. Сомони 8',    earning:6, time:'12:10', dist:'3.8 км', rating:4 },
  { id:'K-4805', client:'Сабрина Н.', addr:'ул. Рудаки 22',   earning:5, time:'11:30', dist:'2.7 км', rating:5 },
];

const STORE = { mx:48, my:50 };

/* ─────────────────────────────────────────────────────
    КАРТА со всеми заказами (метки)
───────────────────────────────────────────────────── */
function OrdersMap({ orders, selected, onSelect, height = 280 }: {
  orders: typeof ORDERS; selected: any; onSelect: (o: any) => void; height?: number
}) {
  return (
    <div style={{ position:'relative', height, background:'linear-gradient(135deg,#081420,#0B1E12)', overflow:'hidden' }}>
      {/* сетка улиц */}
      <svg width="100%" height="100%" style={{ position:'absolute', inset:0, opacity:.13 }}>
        {Array.from({length:12}).map((_,i)=><line key={'h'+i} x1="0" y1={i*26} x2="100%" y2={i*26} stroke="#1FD760" strokeWidth="0.5"/>)}
        {Array.from({length:16}).map((_,i)=><line key={'v'+i} x1={i*34} y1="0" x2={i*34} y2="100%" stroke="#1FD760" strokeWidth="0.5"/>)}
      </svg>
      {/* диагональные «дороги» */}
      <svg width="100%" height="100%" style={{ position:'absolute', inset:0, opacity:.2 }}>
        <line x1="0" y1="70%" x2="100%" y2="40%" stroke="#3B8EF0" strokeWidth="2"/>
        <line x1="20%" y1="0" x2="60%" y2="100%" stroke="#3B8EF0" strokeWidth="2"/>
      </svg>

      {/* линия маршрута к выбранному */}
      {selected && (
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position:'absolute', inset:0 }}>
          <line x1={STORE.mx} y1={STORE.my} x2={selected.mx} y2={selected.my}
            stroke="#3B8EF0" strokeWidth="0.7" strokeDasharray="2 1.5" strokeLinecap="round"
            style={{ animation:'dashmove 1s linear infinite' }}/>
        </svg>
      )}

      {/* магазин */}
      <div style={{ position:'absolute', left:`${STORE.mx}%`, top:`${STORE.my}%`, transform:'translate(-50%,-50%)', zIndex:5 }}>
        <div style={{ position:'relative' }}>
          <div style={{ position:'absolute', inset:-6, borderRadius:'50%', border:'2px solid #1FD760', animation:'ping 2s ease-out infinite' }}/>
          <div style={{ width:34, height:34, borderRadius:11, background:'linear-gradient(135deg,#0F8A3A,#1FD760)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:17, boxShadow:'0 4px 14px rgba(31,215,96,.5)' }}>🏪</div>
        </div>
        <div style={{ position:'absolute', top:38, left:'50%', transform:'translateX(-50%)', whiteSpace:'nowrap', fontSize:9, fontWeight:800, color:'#1FD760', background:'rgba(3,11,5,.8)', padding:'2px 7px', borderRadius:6 }}>KAKAPO</div>
      </div>

      {/* метки заказов */}
      {orders.map((o,i) => {
        const isSel = selected?.id === o.id;
        return (
          <div key={o.id} onClick={()=>onSelect(o)}
            style={{ position:'absolute', left:`${o.mx}%`, top:`${o.my}%`, transform:'translate(-50%,-100%)', zIndex:isSel?20:10, cursor:'pointer', transition:'all .25s' }}>
            <div style={{ position:'relative', animation: isSel ? 'bounce 1s ease-in-out infinite' : 'none' }}>
              <div style={{
                width: isSel?44:36, height: isSel?44:36, borderRadius:'50% 50% 50% 0',
                transform:'rotate(-45deg)',
                background: isSel ? 'linear-gradient(135deg,#1E5BB5,#3B8EF0)' : 'linear-gradient(135deg,#7a2020,#FF4545)',
                display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow: isSel ? '0 6px 20px rgba(59,142,240,.6)' : '0 4px 12px rgba(255,69,69,.4)',
                border:'2px solid rgba(255,255,255,.25)', transition:'all .25s'
              }}>
                <span style={{ transform:'rotate(45deg)', fontSize:isSel?17:14, fontWeight:900, color:'white' }}>{o.earning}</span>
              </div>
              <div style={{ position:'absolute', top:isSel?48:40, left:'50%', transform:'translateX(-50%)', whiteSpace:'nowrap', fontSize:9, fontWeight:800, color:isSel?'#3B8EF0':'#FF8888', background:'rgba(3,11,5,.85)', padding:'2px 7px', borderRadius:6 }}>
                +{o.earning} ЅМ
              </div>
            </div>
          </div>
        );
      })}

      {/* счётчик заказов */}
      <div style={{ position:'absolute', top:12, left:12, padding:'8px 13px', borderRadius:12, background:'rgba(3,11,5,.85)', backdropFilter:'blur(10px)', border:'1px solid rgba(59,142,240,.3)', zIndex:30 }}>
        <div className="ub" style={{ fontSize:17, fontWeight:900, color:'#3B8EF0' }}>{orders.length}</div>
        <div style={{ fontSize:9, color:'#8FB897' }}>заказов рядом</div>
      </div>

      {/* кнопка «моё местоположение» */}
      <div style={{ position:'absolute', bottom:12, right:12, width:40, height:40, borderRadius:12, background:'rgba(3,11,5,.85)', backdropFilter:'blur(10px)', border:'1px solid rgba(59,142,240,.3)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, zIndex:30, cursor:'pointer' }}>
        🎯
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   ГЛАВНОЕ ПРИЛОЖЕНИЕ
───────────────────────────────────────────────────── */
export default function CourierApp() {
  const [logged,    setLogged]    = useState(false);
  const [tab,       setTab]       = useState('orders');
  const [status,    setStatus]    = useState('available');
  const [selected,  setSelected]  = useState<any>(null);
  const [active,    setActive]    = useState<any>(null);
  const [step,      setStep]      = useState('toStore');
  const [completed, setCompleted] = useState<string[]>([]);
  const [otp,       setOtp]       = useState(['','','','']);
  const [err,       setErr]       = useState('');
  const [load,      setLoad]      = useState(false);

  const verify = () => {
    if (otp.join('').length < 4) return;
    setLoad(true);
    setTimeout(()=>{
      if (otp.join('') === '1234') setLogged(true);
      else { setErr('Неверный код · Демо: 1234'); setOtp(['','','','']); }
      setLoad(false);
    }, 700);
  };

  const accept = (o: any) => { setActive(o); setStatus('busy'); setStep('toStore'); setSelected(null); setTab('active'); };
  const finish = () => { setCompleted(c=>[...c,active.id]); setActive(null); setStatus('available'); setTab('orders'); };

  const available = ORDERS.filter(o => !completed.includes(o.id) && o.id !== active?.id);

  /* ── ЛОГИН ── */
  if (!logged) return (
    <>
      <style>{CSS}</style>
      <div style={{ minHeight:'100vh', background:'#030B05', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24, maxWidth:480, margin:'0 auto' }}>
        <a href="/" style={{ position:'absolute', top:20, left:20, width:38, height:38, borderRadius:10, background:'#091508', border:'1px solid #162B1A', display:'flex', alignItems:'center', justifyContent:'center', textDecoration:'none', color:'#8FB897', fontSize:16 }}>←</a>
        <div style={{ textAlign:'center', marginBottom:28 }}>
          <div style={{ fontSize:60, marginBottom:14 }}>🛵</div>
          <div className="ub" style={{ fontSize:22, fontWeight:900, color:'#3B8EF0', marginBottom:4 }}>Курьер KAKAPO</div>
          <div style={{ fontSize:13, color:'#8FB897' }}>Введите OTP код из SMS</div>
        </div>
        <div style={{ width:'100%', maxWidth:340, background:'#091508', border:'1px solid #162B1A', borderRadius:22, padding:26 }}>
          {err && <div style={{ padding:'9px', borderRadius:10, background:'rgba(255,69,69,.1)', border:'1px solid rgba(255,69,69,.3)', fontSize:12, color:'#FF4545', marginBottom:14, textAlign:'center' }}>⚠️ {err}</div>}
          <div style={{ display:'flex', gap:10, justifyContent:'center', marginBottom:16 }}>
            {otp.map((v,i)=>(
              <input key={i} id={`o${i}`} value={v} type="tel" maxLength={1} inputMode="numeric"
                onChange={e=>{const d=[...otp];d[i]=e.target.value.replace(/\D/,'').slice(-1);setOtp(d);if(e.target.value&&i<3)(document.getElementById(`o${i+1}`) as HTMLInputElement)?.focus();}}
                onKeyDown={e=>{if(e.key==='Backspace'&&!v&&i>0)(document.getElementById(`o${i-1}`) as HTMLInputElement)?.focus();}}
                style={{ width:54, height:62, borderRadius:15, border:`2px solid ${v?'rgba(59,142,240,.5)':'#162B1A'}`, background:v?'rgba(59,142,240,.08)':'#0C1C0F', textAlign:'center', fontSize:26, fontWeight:900, color:'#EBF5ED', outline:'none' }}/>
            ))}
          </div>
          <div style={{ padding:'10px', borderRadius:10, background:'rgba(59,142,240,.06)', border:'1px solid rgba(59,142,240,.2)', fontSize:12, color:'#8FB897', marginBottom:14, textAlign:'center' }}>
            💡 Демо OTP: <span style={{ color:'#3B8EF0', fontWeight:800 }}>1 2 3 4</span>
          </div>
          <button onClick={verify} className="btn" style={{ width:'100%', padding:15, borderRadius:15, background:'linear-gradient(135deg,#1E5BB5,#3B8EF0)', border:'none', color:'white', fontWeight:800, fontSize:15, display:'flex', alignItems:'center', justifyContent:'center', gap:8, opacity:otp.join('').length<4?.5:1 }}>
            {load ? <div style={{ width:18, height:18, borderRadius:'50%', border:'2.5px solid rgba(255,255,255,.3)', borderTopColor:'white', animation:'spin 1s linear infinite' }}/> : '🛵 Войти'}
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      <style>{CSS}</style>
      <div style={{ minHeight:'100vh', background:'#030B05', maxWidth:480, margin:'0 auto', paddingBottom:78 }}>

        {/* HEADER */}
        <header style={{ position:'sticky', top:0, zIndex:100, background:'rgba(3,11,5,.97)', backdropFilter:'blur(24px)', borderBottom:'1px solid #162B1A', padding:'12px 18px', display:'flex', alignItems:'center', gap:10 }}>
          <a href="/" style={{ width:36, height:36, borderRadius:10, background:'#0C1C0F', border:'1px solid #162B1A', display:'flex', alignItems:'center', justifyContent:'center', textDecoration:'none', color:'#8FB897', fontSize:15, flexShrink:0 }}>←</a>
          <div style={{ width:40, height:40, borderRadius:13, background:'linear-gradient(135deg,#1E5BB5,#3B8EF0)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, flexShrink:0 }}>🛵</div>
          <div style={{ flex:1 }}>
            <div className="ub" style={{ fontSize:14, fontWeight:900 }}>{COURIER.name}</div>
            <div style={{ display:'flex', alignItems:'center', gap:5, marginTop:1 }}>
              <div style={{ width:6, height:6, borderRadius:'50%', background:status==='available'?'#1FD760':status==='busy'?'#FFB800':'#3D6645', animation:'pulse 2s infinite' }}/>
              <span style={{ fontSize:10, color:'#8FB897' }}>{status==='available'?'Свободен':status==='busy'?'В заказе':'Офлайн'} · {COURIER.vehicle}</span>
            </div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:9, color:'#3D6645' }}>Сегодня</div>
            <div className="ub" style={{ fontSize:15, fontWeight:900, color:'#FFB800' }}>42 ЅМ</div>
          </div>
        </header>

        {/* ═══ ВКЛАДКА ЗАКАЗЫ ═══ */}
        {tab==='orders' && (
          <div>
            <div style={{ display:'flex', gap:8, padding:'12px 18px 0' }}>
              {([['available','Свободен','#1FD760'],['busy','В заказе','#FFB800'],['offline','Офлайн','#3D6645']] as const).map(([s,l,c])=>(
                <button key={s} onClick={()=>setStatus(s)} className="btn" style={{ flex:1, padding:'9px 6px', borderRadius:11, fontSize:11, fontWeight:700, border:`1.5px solid ${status===s?c:'#162B1A'}`, background:status===s?c+'18':'#091508', color:status===s?c:'#8FB897' }}>{l}</button>
              ))}
            </div>

            {status==='offline' ? (
              <div style={{ textAlign:'center', padding:'70px 20px', color:'#8FB897' }}>
                <div style={{ fontSize:52, marginBottom:14 }}>😴</div>
                <div className="ub" style={{ fontSize:16, fontWeight:800, marginBottom:6 }}>Вы офлайн</div>
                <div style={{ fontSize:12, color:'#3D6645' }}>Включите «Свободен» чтобы видеть заказы</div>
              </div>
            ) : (
              <>
                <div style={{ margin:'12px 0 0' }}>
                  <OrdersMap orders={available} selected={selected} onSelect={setSelected} />
                </div>

                {selected && (
                  <div style={{ margin:'-30px 14px 0', position:'relative', zIndex:40, background:'#0C1C0F', border:'1.5px solid rgba(59,142,240,.4)', borderRadius:18, padding:16, animation:'slideUp .35s cubic-bezier(.16,1,.3,1)', boxShadow:'0 -8px 30px rgba(0,0,0,.5)' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
                      <div>
                        <div className="ub" style={{ fontSize:15, fontWeight:900, color:'#3B8EF0' }}>{selected.id}</div>
                        <div style={{ fontSize:12, color:'#EBF5ED', fontWeight:700, marginTop:2 }}>{selected.client}</div>
                        <div style={{ fontSize:11, color:'#8FB897', marginTop:1 }}>📍 {selected.addr}</div>
                      </div>
                      <div style={{ textAlign:'right' }}>
                        <div className="ub" style={{ fontSize:20, fontWeight:900, color:'#FFB800' }}>+{selected.earning}</div>
                        <div style={{ fontSize:10, color:'#3D6645' }}>ЅМ</div>
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:7, flexWrap:'wrap', marginBottom:13 }}>
                      <span style={{ padding:'4px 9px', borderRadius:8, fontSize:11, fontWeight:700, background:'rgba(59,142,240,.1)', color:'#3B8EF0', border:'1px solid rgba(59,142,240,.25)' }}>📍 {selected.dist} км</span>
                      <span style={{ padding:'4px 9px', borderRadius:8, fontSize:11, fontWeight:700, background:'rgba(255,184,0,.1)', color:'#FFB800', border:'1px solid rgba(255,184,0,.25)' }}>⚖️ {selected.weight} кг</span>
                      <span style={{ padding:'4px 9px', borderRadius:8, fontSize:11, fontWeight:700, background:'rgba(31,215,96,.1)', color:'#1FD760', border:'1px solid rgba(31,215,96,.25)' }}>💳 {selected.pay}</span>
                    </div>
                    <div style={{ display:'flex', gap:7, flexWrap:'wrap', marginBottom:12 }}>
                      {selected.items.map((it: any,i: number)=><span key={i} style={{ padding:'4px 9px', borderRadius:8, fontSize:11, background:'#091508', border:'1px solid #162B1A', color:'#8FB897' }}>{it.e} {it.n} ×{it.q}</span>)}
                    </div>
                    <div style={{ background:'rgba(31,215,96,.06)', border:'1px solid rgba(31,215,96,.25)', borderRadius:13, padding:'12px 14px', marginBottom:14 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                        <span style={{ fontSize:12, color:'#8FB897' }}>Сумма продуктов</span>
                        <span style={{ fontSize:12, fontWeight:700 }}>{selected.sum.toFixed(2)} ЅМ</span>
                      </div>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8, paddingBottom:8, borderBottom:'1px dashed #1D3822' }}>
                        <span style={{ fontSize:12, color:'#8FB897' }}>Доставка</span>
                        <span style={{ fontSize:12, fontWeight:700, color:selected.delivery===0?'#1FD760':'#EBF5ED' }}>{selected.delivery===0?'Бесплатно':selected.delivery.toFixed(2)+' ЅМ'}</span>
                      </div>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <span style={{ fontSize:13, fontWeight:800, color:'#1FD760' }}>💵 Взять наличными</span>
                        <span className="ub" style={{ fontSize:18, fontWeight:900, color:'#1FD760' }}>{(selected.sum+selected.delivery).toFixed(2)} ЅМ</span>
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                      <button onClick={()=>setSelected(null)} className="btn" style={{ padding:'13px 16px', borderRadius:13, background:'#162B1A', border:'none', color:'#8FB897', fontWeight:700, fontSize:13 }}>✕</button>
                      <button onClick={()=>accept(selected)} className="btn" style={{ flex:1, padding:13, borderRadius:13, background:'linear-gradient(135deg,#17B34E,#1FD760)', border:'none', color:'#030B05', fontWeight:800, fontSize:14 }}>✓ Принять заказ — +{selected.earning} ЅМ</button>
                    </div>
                  </div>
                )}

                <div style={{ padding:'18px 18px 0' }}>
                  <div className="ub" style={{ fontSize:14, fontWeight:800, marginBottom:12, display:'flex', alignItems:'center', gap:8 }}>
                    Доступные заказы
                    <span style={{ padding:'2px 8px', borderRadius:8, fontSize:11, fontWeight:800, background:'rgba(255,69,69,.12)', color:'#FF4545', border:'1px solid rgba(255,69,69,.28)' }}>{available.length}</span>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    {available.map((o,idx)=>{
                      const isSel = selected?.id === o.id;
                      return (
                        <div key={o.id} onClick={()=>setSelected(o)} className="btn"
                          style={{ background:isSel?'rgba(59,142,240,.08)':'#091508', border:`1.5px solid ${isSel?'rgba(59,142,240,.4)':'#162B1A'}`, borderRadius:16, padding:'14px 15px', textAlign:'left', animation:`fadeUp .4s ease ${idx*.06}s both` }}>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                              <div style={{ width:34, height:34, borderRadius:10, background:isSel?'linear-gradient(135deg,#1E5BB5,#3B8EF0)':'#0C1C0F', border:`1px solid ${isSel?'transparent':'#162B1A'}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:900, color:isSel?'white':'#3B8EF0' }}>{idx+1}</div>
                              <div>
                                <div className="ub" style={{ fontSize:13, fontWeight:800, color:'#3B8EF0' }}>{o.id}</div>
                                <div style={{ fontSize:11, color:'#8FB897' }}>{o.client.split(' ')[0]} · {o.time}</div>
                              </div>
                            </div>
                            <div className="ub" style={{ fontSize:17, fontWeight:900, color:'#FFB800' }}>+{o.earning} ЅМ</div>
                          </div>
                          <div style={{ fontSize:11, color:'#8FB897', marginBottom:8, display:'flex', alignItems:'center', gap:5 }}>
                            📍 {o.addr}
                          </div>
                          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                            <span style={{ padding:'3px 8px', borderRadius:7, fontSize:10, fontWeight:700, background:'rgba(59,142,240,.1)', color:'#3B8EF0' }}>{o.dist} км</span>
                            <span style={{ padding:'3px 8px', borderRadius:7, fontSize:10, fontWeight:700, background:'rgba(255,184,0,.1)', color:'#FFB800' }}>{o.weight} кг</span>
                            <span style={{ padding:'3px 8px', borderRadius:7, fontSize:10, fontWeight:700, background:'#0C1C0F', color:'#8FB897' }}>{o.items.length} тов.</span>
                            {isSel && <span style={{ marginLeft:'auto', fontSize:11, color:'#3B8EF0', fontWeight:700 }}>выбран ↑</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ═══ ВКЛАДКА АКТИВНАЯ ДОСТАВКА ═══ */}
        {tab==='active' && (
          active ? (
            <div>
              <OrdersMap orders={[active]} selected={active} onSelect={()=>{}} height={250} />
              <div style={{ padding:'16px 18px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                  <div>
                    <span className="ub" style={{ fontSize:16, fontWeight:900, color:'#3B8EF0' }}>{active.id}</span>
                    <div style={{ fontSize:12, color:'#8FB897', marginTop:2 }}>{active.client}</div>
                  </div>
                  <div className="ub" style={{ fontSize:20, fontWeight:900, color:'#FFB800' }}>+{active.earning} ЅМ</div>
                </div>

                <div style={{ display:'flex', marginBottom:18 }}>
                  {([['toStore','🏪','В магазин'],['toClient','🛵','К клиенту'],['done','✓','Доставлено']] as const).map(([s,e,l],i)=>{
                    const act = step===s;
                    const dn = (step==='toClient'&&s==='toStore')||(step==='done'&&s!=='done');
                    return (
                      <div key={s} style={{ flex:1, textAlign:'center', position:'relative' }}>
                        {i<2 && <div style={{ position:'absolute', top:18, left:'50%', width:'100%', height:2, background:dn?'#1FD760':'#162B1A' }}/>}
                        <div style={{ width:38, height:38, borderRadius:'50%', background:act?'#3B8EF0':dn?'#1FD760':'#0C1C0F', border:`2px solid ${act?'#3B8EF0':dn?'#1FD760':'#162B1A'}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, margin:'0 auto 6px', position:'relative', zIndex:1, animation:act?'glow 1.8s infinite':'none' }}>{dn?'✓':e}</div>
                        <div style={{ fontSize:10, fontWeight:act?700:400, color:act?'#3B8EF0':dn?'#1FD760':'#3D6645' }}>{l}</div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ background:'#091508', border:'1px solid #162B1A', borderRadius:16, padding:'14px 16px', marginBottom:14 }}>
                  <div style={{ display:'flex', gap:10, marginBottom:12, paddingBottom:12, borderBottom:'1px solid #162B1A' }}>
                    <div style={{ width:10, height:10, borderRadius:'50%', background:'#1FD760', marginTop:4, flexShrink:0 }}/>
                    <div style={{ flex:1 }}><div style={{ fontSize:10, color:'#3D6645' }}>ЗАБРАТЬ ЗАКАЗ</div><div style={{ fontSize:13, fontWeight:700 }}>KAKAPO, ул. Ленина 42</div></div>
                    <a href="tel:+992118559797" style={{ padding:'7px 11px', borderRadius:9, background:'rgba(31,215,96,.1)', border:'1px solid rgba(31,215,96,.3)', color:'#1FD760', fontSize:13, textDecoration:'none', alignSelf:'center' }}>📞</a>
                  </div>
                  <div style={{ display:'flex', gap:10 }}>
                    <div style={{ width:10, height:10, borderRadius:2, background:'#3B8EF0', marginTop:4, flexShrink:0 }}/>
                    <div style={{ flex:1 }}><div style={{ fontSize:10, color:'#3D6645' }}>ДОСТАВИТЬ КЛИЕНТУ</div><div style={{ fontSize:13, fontWeight:700 }}>{active.addr}</div><div style={{ fontSize:11, color:'#8FB897', marginTop:1 }}>{active.client}</div></div>
                    <a href={`tel:${active.phone}`} style={{ padding:'7px 11px', borderRadius:9, background:'rgba(59,142,240,.1)', border:'1px solid rgba(59,142,240,.3)', color:'#3B8EF0', fontSize:13, textDecoration:'none', alignSelf:'center' }}>📞</a>
                  </div>
                </div>

                <div style={{ background:'#091508', border:'1px solid #162B1A', borderRadius:16, padding:'12px 16px', marginBottom:14 }}>
                  <div style={{ fontSize:11, color:'#3D6645', marginBottom:8, fontWeight:700 }}>СОСТАВ ЗАКАЗА</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {active.items.map((it: any,i: number)=>(
                      <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:13 }}>
                        <span style={{ color:'#EBF5ED' }}>{it.e} {it.n} <span style={{ color:'#3D6645' }}>×{it.q}</span></span>
                        <span style={{ fontWeight:700, color:'#8FB897' }}>{(it.p*it.q).toFixed(2)} ЅМ</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ background:'rgba(31,215,96,.06)', border:'1.5px solid rgba(31,215,96,.3)', borderRadius:16, padding:'14px 16px', marginBottom:18 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:7 }}>
                    <span style={{ fontSize:13, color:'#8FB897' }}>Сумма продуктов</span>
                    <span style={{ fontSize:13, fontWeight:700 }}>{active.sum.toFixed(2)} ЅМ</span>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10, paddingBottom:10, borderBottom:'1px dashed #1D3822' }}>
                    <span style={{ fontSize:13, color:'#8FB897' }}>Доставка</span>
                    <span style={{ fontSize:13, fontWeight:700, color:active.delivery===0?'#1FD760':'#EBF5ED' }}>{active.delivery===0?'Бесплатно':active.delivery.toFixed(2)+' ЅМ'}</span>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:14, fontWeight:800, color:'#1FD760' }}>💵 Взять с клиента</span>
                    <span className="ub" style={{ fontSize:22, fontWeight:900, color:'#1FD760' }}>{(active.sum+active.delivery).toFixed(2)} ЅМ</span>
                  </div>
                </div>

                {step==='toStore'  && <button onClick={()=>setStep('toClient')} className="btn" style={{ width:'100%', padding:15, borderRadius:15, background:'linear-gradient(135deg,#1E5BB5,#3B8EF0)', border:'none', color:'white', fontWeight:800, fontSize:15 }}>📦 Забрал заказ — еду к клиенту</button>}
                {step==='toClient' && <button onClick={()=>setStep('done')}    className="btn" style={{ width:'100%', padding:15, borderRadius:15, background:'linear-gradient(135deg,#1E5BB5,#3B8EF0)', border:'none', color:'white', fontWeight:800, fontSize:15 }}>🏁 Я на месте у клиента</button>}
                {step==='done'     && <button onClick={finish}                  className="btn" style={{ width:'100%', padding:15, borderRadius:15, background:'linear-gradient(135deg,#17B34E,#1FD760)', border:'none', color:'#030B05', fontWeight:800, fontSize:15, boxShadow:'0 8px 24px rgba(31,215,96,.4)' }}>✓ Доставлено — получить +{active.earning} ЅМ</button>}
              </div>
            </div>
          ) : (
            <div style={{ textAlign:'center', padding:'80px 20px', color:'#8FB897' }}>
              <div style={{ fontSize:54, marginBottom:14 }}>🛵</div>
              <div className="ub" style={{ fontSize:16, fontWeight:800, marginBottom:6 }}>Нет активной доставки</div>
              <div style={{ fontSize:12, color:'#3D6645', marginBottom:20 }}>Примите заказ во вкладке «Заказы»</div>
              <button onClick={()=>setTab('orders')} className="btn" style={{ padding:'11px 22px', borderRadius:12, background:'rgba(59,142,240,.12)', border:'1.5px solid rgba(59,142,240,.3)', color:'#3B8EF0', fontWeight:700, fontSize:13 }}>← К заказам</button>
            </div>
          )
        )}

        {/* ═══ ВКЛАДКА ЗАРАБОТОК ═══ */}
        {tab==='earnings' && (
          <div style={{ padding:'14px 18px' }}>
            <div style={{ background:'linear-gradient(135deg,#0A1828,#163050)', border:'1px solid rgba(59,142,240,.3)', borderRadius:20, padding:'22px', marginBottom:16, textAlign:'center' }}>
              <div style={{ fontSize:11, color:'#8FB897', marginBottom:6 }}>Заработано сегодня</div>
              <div className="ub" style={{ fontSize:40, fontWeight:900, color:'#FFB800', marginBottom:4 }}>210 ЅМ</div>
              <div style={{ fontSize:12, color:'#3B8EF0' }}>14 доставок · 4.9 ★</div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:18 }}>
              {([['За неделю','1 240 ЅМ','#1FD760'],['Всего доставок','342','#3B8EF0'],['Ср. за день','177 ЅМ','#FFB800'],['Рейтинг','4.9 ★','#FFB800']] as const).map(([l,v,c],i)=>(
                <div key={i} style={{ background:'#091508', border:'1px solid #162B1A', borderRadius:14, padding:'15px', textAlign:'center' }}>
                  <div className="ub" style={{ fontSize:18, fontWeight:900, color:c, marginBottom:3 }}>{v}</div>
                  <div style={{ fontSize:10, color:'#3D6645' }}>{l}</div>
                </div>
              ))}
            </div>
            <div className="ub" style={{ fontSize:14, fontWeight:800, marginBottom:12 }}>История доставок</div>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {HISTORY.map((h,i)=>(
                <div key={i} style={{ background:'#091508', border:'1px solid #162B1A', borderRadius:13, padding:'12px 14px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <div style={{ width:34, height:34, borderRadius:9, background:'rgba(31,215,96,.12)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}>✓</div>
                    <div>
                      <div style={{ fontSize:13, fontWeight:700 }}>{h.id} · {h.client}</div>
                      <div style={{ fontSize:11, color:'#3D6645' }}>{h.addr} · {h.dist} · {'★'.repeat(h.rating)}</div>
                    </div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div className="ub" style={{ fontSize:13, fontWeight:800, color:'#FFB800' }}>+{h.earning} ЅМ</div>
                    <div style={{ fontSize:10, color:'#3D6645' }}>{h.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* NAV */}
        <nav style={{ position:'fixed', bottom:0, left:'50%', transform:'translateX(-50%)', width:'100%', maxWidth:480, background:'rgba(3,11,5,.97)', backdropFilter:'blur(26px)', borderTop:'1px solid #162B1A', padding:'8px 18px 18px', display:'flex', justifyContent:'space-around', zIndex:90 }}>
          {([['orders','📋','Заказы'],['active','🛵','Доставка'],['earnings','💰','Заработок']] as const).map(([id,icon,label])=>(
            <button key={id} onClick={()=>setTab(id)} className="btn" style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3, padding:'5px 18px', borderRadius:11, background:tab===id?'rgba(59,142,240,.12)':'transparent', border:`1.5px solid ${tab===id?'rgba(59,142,240,.3)':'transparent'}`, position:'relative' }}>
              <span style={{ fontSize:20 }}>{icon}</span>
              <span style={{ fontSize:10, fontWeight:tab===id?800:600, color:tab===id?'#3B8EF0':'#3D6645' }}>{label}</span>
              {id==='active' && active && <div style={{ position:'absolute', top:2, right:12, width:8, height:8, borderRadius:'50%', background:'#FFB800', animation:'pulse 1.5s infinite' }}/>}
            </button>
          ))}
        </nav>
      </div>
    </>
  );
}
