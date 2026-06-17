'use client'
import { useState, useMemo, useRef, useEffect } from 'react'
import { useOrders, USE_API } from '@/lib/store'
import { mapOrdersForAssembler } from '@/lib/orderUiMap'
import { getMarketStatus, isMixedOrder, normalizeOrder } from '@/lib/orderParts'
import { ASSEMBLER_NAME } from '@/lib/courierStats'
import { useAppNavigation } from '@/lib/useAppNavigation'
import { useApiSync } from '@/lib/useApiSync'
import AppNavigationBoundary from '@/components/shared/AppNavigationBoundary'
import Link from 'next/link'
import AssemblerLoginPage from '@/components/assembler/AssemblerLoginPage'
import { useAssemblerTeam, hydrateAssemblerTeamStore } from '@/lib/assemblerTeamStore'
import type { AdminAssembler } from '@/lib/assemblerTeam'
// ─── КАКАПО Assembler App ────────────────────────
/* ══════════════════════════════════════════════════════
   КАКАПО СБОРЩИК — Приложение для сборки заказов
   г. Яван, Таджикистан · PIN: 5678
══════════════════════════════════════════════════════ */
// React hooks imported above

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@700;800;900&family=Nunito:wght@400;600;700;800&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
  html,body{background:#030B05;color:#EBF5ED;font-family:'Nunito',sans-serif;-webkit-font-smoothing:antialiased;}
  .ub{font-family:'Unbounded',sans-serif;}
  .btn{cursor:pointer;border:none;transition:all .2s cubic-bezier(.16,1,.3,1);}.btn:active{transform:scale(.96);}
  .card{background:#091508;border:1px solid #162B1A;border-radius:18px;}
  .inp{background:#0C1C0F;border:1.5px solid #162B1A;border-radius:13px;color:#EBF5ED;font-family:'Nunito',sans-serif;font-size:14px;outline:none;padding:12px 15px;width:100%;transition:border-color .2s;}
  .inp:focus{border-color:rgba(155,109,255,.5);}
  .inp::placeholder{color:#3D6645;}
  @keyframes spin{from{transform:rotate(0);}to{transform:rotate(360deg);}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
  @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
  @keyframes pulse{0%,100%{opacity:1;}50%{opacity:.35;}}
  @keyframes ping{0%{transform:scale(1);opacity:1;}100%{transform:scale(2.2);opacity:0;}}
  @keyframes slideUp{from{opacity:0;transform:translateY(24px);}to{opacity:1;transform:translateY(0);}}
  @keyframes checkPop{0%{transform:scale(0);}60%{transform:scale(1.2);}100%{transform:scale(1);}}
  ::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-track{background:#06100A;}::-webkit-scrollbar-thumb{background:#1D3822;border-radius:2px;}
`;

/* ── DEMO DATA ─────────────────────────────────── */

const ORDERS_DATA = [
  {
    id:'K-4832', time:'14:23', priority:'urgent', queue:'new',
    client:{name:'Диловар Рахимов', phone:'+992 93 456 78 90', addr:'ул. Ленина, 42, кв. 15'},
    courier:{name:'Фирдавс Назаров', phone:'+992 93 111 22 33'},
    comment:'Пожалуйста побыстрее, жду гостей',
    items:[
      {id:1,art:'KAK-0001',e:'🥦',name:'Брокколи свежая',    qty:2, unit:'500 гр', price:5.50,   done:false},
      {id:2,art:'KAK-0006',e:'🥛',name:'Молоко 3.2%',         qty:3, unit:'1 л',   price:4.90,done:false},
      {id:3,art:'KAK-0007',e:'🧀',name:'Сыр Российский',      qty:1, unit:'250 гр', price:18.5,done:false},
      {id:4,art:'KAK-0004',e:'🥩',name:'Говядина вырезка',    qty:1, unit:'500 гр', price:38.0, done:false},
      {id:5,art:'KAK-0018',e:'☕',name:'Кофе Nescafé Gold',   qty:1, unit:'190 гр', price:28.0,   done:false},
    ]
  },
  {
    id:'K-4829', time:'13:55', priority:'normal', queue:'new',
    client:{name:'Мадина Олимова', phone:'+992 93 321 65 43', addr:'ул. Сомони, 8, кв. 3'},
    courier:{name:'Рустам Холов', phone:'+992 91 333 44 55'},
    comment:'',
    items:[
      {id:1,art:'KAK-0012',e:'🥚',name:'Яйца С1',              qty:1, unit:'10 шт', price:8.90,done:false},
      {id:2,art:'KAK-0014',e:'🥐',name:'Круассан с шоколадом', qty:4, unit:'1 шт',  price:2.50,      done:false},
      {id:3,art:'KAK-0017',e:'🧃',name:'Сок апельсиновый',     qty:2, unit:'1 л',   price:6.80,   done:false},
      {id:4,art:'KAK-0021',e:'🍫',name:'Шоколад Milka',        qty:3, unit:'90 гр', price:6.50,   done:false},
    ]
  },
  {
    id:'K-4825', time:'13:20', priority:'normal', queue:'assembling',
    client:{name:'Зафар Мирзоев', phone:'+992 91 654 32 10', addr:'мкр. Мирный, 5'},
    courier:{name:'Баходур Кодиров', phone:'+992 90 222 33 44'},
    comment:'Без лука в салате',
    items:[
      {id:1,art:'KAK-0003',e:'🍊',name:'Апельсины Навел',      qty:2, unit:'1 кг',  price:6.50,   done:false},
      {id:2,art:'KAK-0015',e:'🍞',name:'Хлеб пшеничный',       qty:1, unit:'500 гр',price:3.20,      done:false},
      {id:3,art:'KAK-0019',e:'🌾',name:'Рис Девзира',           qty:1, unit:'1 кг',  price:9.50,   done:false},
    ]
  },
];

const HISTORY_DATA = [
  {id:'K-4820',time:'13:00',items:5,duration:'6 мин',client:'Рустам Д.'},
  {id:'K-4815',time:'12:40',items:3,duration:'4 мин',client:'Нилуфар Х.'},
  {id:'K-4810',time:'12:15',items:7,duration:'9 мин',client:'Бахром К.'},
  {id:'K-4805',time:'11:50',items:4,duration:'5 мин',client:'Лола М.'},
  {id:'K-4800',time:'11:20',items:6,duration:'8 мин',client:'Зубайр Р.'},
];

/* ══════════════════════════════════════════════════════
   MAIN APP
══════════════════════════════════════════════════════ */
export default function AssemblerApp() {
  return (
    <AppNavigationBoundary>
      <AssemblerAppInner />
    </AppNavigationBoundary>
  );
}

function AssemblerAppInner() {
  useApiSync('assembler');
  const assemblers = useAssemblerTeam();
  const [loggedIn, setLoggedIn] = useState(false);
  const [assemblerProfile, setAssemblerProfile] = useState<AdminAssembler | null>(null);
  const assemblerName = assemblerProfile?.name ?? ASSEMBLER_NAME;
  const { page, navigate, params } = useAppNavigation('dashboard');
  const setPage = (p: string) => navigate(p);
  const apiOrders = useOrders(s => s.orders);
  const updateStatus = useOrders(s => s.updateStatus);
  const startMarketPart = useOrders(s => s.startMarketPart);
  const completeMarketPart = useOrders(s => s.completeMarketPart);
  const toggleItemStore = useOrders(s => s.toggleItem);
  const mapped = useMemo(
    () => (USE_API ? mapOrdersForAssembler(apiOrders) : ORDERS_DATA),
    [apiOrders]
  );
  const collectIdRef = useRef<string | null>(null);
  const activeOrderId = page === 'collect'
    ? (params.order || collectIdRef.current || null)
    : null;

  useEffect(() => {
    hydrateAssemblerTeamStore();
  }, []);

  useEffect(() => {
    if (page !== 'collect') collectIdRef.current = null;
  }, [page]);

  const activeOrder = useMemo(() => {
    if (!activeOrderId) return null;
    const fromList = mapped.find(o => o.id === activeOrderId);
    if (fromList) return fromList;
    const raw = apiOrders.find(o => o.id === activeOrderId);
    if (!raw) return null;
    const mappedOne = mapOrdersForAssembler([raw]);
    return mappedOne[0] ?? null;
  }, [activeOrderId, mapped, apiOrders]);

  const openCollect = (id: string) => {
    collectIdRef.current = id;
    navigate('collect', { order: id });
    const raw = apiOrders.find(o => o.id === id);
    if (!USE_API || !raw) return;
    const order = normalizeOrder(raw);
    if (isMixedOrder(order)) {
      if (getMarketStatus(order) === 'new') void startMarketPart(id);
      return;
    }
    if (order.status === 'new') void updateStatus(id, 'assembling');
  };

  const toggleItem = (orderId: string, itemId: number) => {
    void toggleItemStore(orderId, itemId);
  };

  const completeOrder = async (orderId: string) => {
    const raw = apiOrders.find(o => o.id === orderId);
    if (USE_API && raw && isMixedOrder(normalizeOrder(raw))) {
      await completeMarketPart(orderId);
    } else if (USE_API) {
      await updateStatus(orderId, 'assembler_done', { assembler: { name: assemblerName }, marketStatus: 'done' });
    }
    navigate('dashboard');
  };

  const pending = mapped;

  const completedCount = useMemo(() => apiOrders.filter(o => {
    const order = normalizeOrder(o)
    if (isMixedOrder(order)) return getMarketStatus(order) === 'done'
    return order.type === 'market' && ['assembler_done', 'courier_picked', 'delivering', 'delivered'].includes(order.status)
  }).length, [apiOrders]);

  const logout = () => {
    setLoggedIn(false);
    setAssemblerProfile(null);
    navigate('dashboard');
  };

  if (!loggedIn) {
    return (
      <>
        <style>{CSS}</style>
        <AssemblerLoginPage
          assemblers={assemblers}
          onSuccess={a => { setAssemblerProfile(a); setLoggedIn(true); }}
        />
      </>
    );
  }

  if (page === 'collect' && activeOrderId) {
    if (!activeOrder) {
      return (
        <div style={{ minHeight:'100vh', background:'#030B05', maxWidth:480, margin:'0 auto' }}>
          <style>{CSS}</style>
          <Header title={activeOrderId} sub="Загрузка заказа…" showBack onBack={() => navigate('dashboard')} />
        </div>
      );
    }
    return (
      <CollectPage
        key={activeOrderId}
        order={activeOrder}
        onToggle={toggleItem}
        onComplete={completeOrder}
        onBack={() => navigate('dashboard')}
        onLogout={logout}
      />
    );
  }

  return (
    <>
      <style>{CSS}</style>
      <div style={{maxWidth:480,margin:'0 auto',minHeight:'100dvh',background:'#030B05'}}>
        {page==='dashboard' && <DashboardPage orders={pending} completed={completedCount} onStart={openCollect} onPage={setPage} assemblerName={assemblerName} onLogout={logout}/>}
        {page==='history'   && <HistoryPage onPage={setPage} onLogout={logout}/>}
        {page==='stats'     && <StatsPage onPage={setPage} completed={completedCount} assemblerName={assemblerName} onLogout={logout}/>}
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════
   HEADER (shared)
══════════════════════════════════════════════════════ */
function Header({title, sub, showBack, onBack, right}) {
  return (
    <header style={{position:'sticky',top:0,zIndex:100,background:'rgba(3,11,5,.97)',backdropFilter:'blur(24px)',borderBottom:'1px solid #162B1A'}}>
      <div style={{padding:'13px 18px',display:'flex',alignItems:'center',gap:10}}>
        {showBack
          ? <button onClick={onBack} className="btn" style={{width:38,height:38,borderRadius:12,background:'#0C1C0F',border:'1px solid #162B1A',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="#8FB897" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 5 5 12 12 19"/></svg>
            </button>
          : <div style={{width:40,height:40,borderRadius:13,background:'linear-gradient(135deg,#6B3FD4,#9B6DFF)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:16,fontWeight:900,color:'white',flexShrink:0,boxShadow:'0 4px 16px rgba(155,109,255,.4)'}}>С</div>
        }
        <div style={{flex:1}}>
          <div style={{fontFamily:'Unbounded',fontSize:15,fontWeight:900}}>{title}</div>
          {sub&&<div style={{fontSize:10,color:'#8FB897',marginTop:1}}>{sub}</div>}
        </div>
        {right}
      </div>
    </header>
  );
}

function LogoutBtn({ onLogout }) {
  return (
    <button
      type="button"
      onClick={onLogout}
      title="Выйти из аккаунта"
      className="btn"
      style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        border: '1.5px solid rgba(255,69,69,.35)',
        background: 'rgba(255,69,69,.1)',
        color: '#FF6969', fontSize: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      ⎋
    </button>
  );
}

/* ══════════════════════════════════════════════════════
   BOTTOM NAV
══════════════════════════════════════════════════════ */
function BottomNav({page, onPage, newCount}) {
  const items = [
    {id:'dashboard', icon:'📋', label:'Заказы'},
    {id:'history',   icon:'🕐', label:'История'},
    {id:'stats',     icon:'📊', label:'Статистика'},
  ];
  return (
    <nav style={{position:'fixed',bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:480,background:'rgba(3,11,5,.97)',backdropFilter:'blur(26px)',borderTop:'1px solid #162B1A',padding:'8px 18px',paddingBottom:'calc(10px + env(safe-area-inset-bottom,0))',display:'flex',justifyContent:'space-around',zIndex:80}}>
      {items.map(item=>(
        <button key={item.id} onClick={()=>onPage(item.id)} className="btn"
          style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3,padding:'5px 14px',borderRadius:11,background:page===item.id?'rgba(155,109,255,.12)':'transparent',border:`1.5px solid ${page===item.id?'rgba(155,109,255,.3)':'transparent'}`,position:'relative'}}>
          <span style={{fontSize:20}}>{item.icon}</span>
          <span style={{fontSize:10,fontWeight:page===item.id?800:600,color:page===item.id?'#9B6DFF':'#3D6645',fontFamily:'Nunito'}}>{item.label}</span>
          {item.id==='dashboard'&&newCount>0&&(
            <div style={{position:'absolute',top:2,right:8,width:17,height:17,borderRadius:'50%',background:'#FF4545',border:'2px solid #030B05',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:8,fontWeight:900,color:'white'}}>{newCount}</div>
          )}
        </button>
      ))}
    </nav>
  );
}

/* ══════════════════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════════════════ */
function DashboardPage({orders, completed, onStart, onPage, assemblerName, onLogout}) {
  const newQueue = orders.filter(o => o.queue === 'new');
  const inProgress = orders.filter(o => o.queue !== 'new');
  const urgentNew = newQueue.filter(o => o.priority === 'urgent');
  const normalNew = newQueue.filter(o => o.priority !== 'urgent');
  const urgentProgress = inProgress.filter(o => o.priority === 'urgent');
  const normalProgress = inProgress.filter(o => o.priority !== 'urgent');

  const PCard = ({order, i, isNew}) => {
    const doneCount = order.items.filter(it=>it.done).length;
    const pct = order.items.length ? Math.round(doneCount/order.items.length*100) : 0;
    return (
      <div className="card" style={{overflow:'hidden',animation:isNew ? `fadeUp .45s cubic-bezier(.16,1,.3,1) ${i*.08}s both` : undefined}}>
        {/* Priority banner */}
        {order.priority==='urgent'&&(
          <div style={{padding:'7px 16px',background:'rgba(255,69,69,.09)',borderBottom:'1px solid rgba(255,69,69,.2)',display:'flex',alignItems:'center',gap:7}}>
            <div style={{width:6,height:6,borderRadius:'50%',background:'#FF4545',flexShrink:0,position:'relative'}}>
              <div style={{position:'absolute',inset:0,borderRadius:'50%',background:'#FF4545',animation:'ping 1.5s ease-out infinite',opacity:.5}}/>
            </div>
            <span style={{fontSize:11,fontWeight:800,color:'#FF4545'}}>⚡ Срочно — курьер ждёт</span>
          </div>
        )}
        {isNew && order.priority !== 'urgent' && (
          <div style={{padding:'7px 16px',background:'rgba(255,69,69,.08)',borderBottom:'1px solid rgba(255,69,69,.18)',display:'flex',alignItems:'center',gap:7}}>
            <span style={{fontSize:11,fontWeight:800,color:'#FF4545'}}>🆕 Новый заказ</span>
          </div>
        )}
        <div style={{padding:'15px 16px'}}>
          {/* Header */}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
            <div>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                <span style={{fontFamily:'Unbounded',fontSize:15,fontWeight:900,color:'#9B6DFF'}}>{order.id}</span>
                <span style={{fontSize:11,color:'#3D6645'}}>{order.time}</span>
              </div>
              <div style={{fontSize:13,fontWeight:700,marginBottom:1}}>{order.client.name}</div>
              <div style={{fontSize:11,color:'#8FB897'}}>📍 {order.client.addr}</div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontFamily:'Unbounded',fontSize:18,fontWeight:900,color:'#9B6DFF',marginBottom:2}}>{order.items.length}</div>
              <div style={{fontSize:10,color:'#3D6645'}}>товаров</div>
            </div>
          </div>

          {/* Progress if started */}
          {!isNew && pct>0&&(
            <div style={{marginBottom:12}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
                <span style={{fontSize:11,color:'#8FB897'}}>Прогресс сборки</span>
                <span style={{fontSize:11,fontWeight:700,color:'#9B6DFF'}}>{doneCount}/{order.items.length}</span>
              </div>
              <div style={{height:6,background:'#162B1A',borderRadius:3,overflow:'hidden'}}>
                <div style={{height:'100%',width:`${pct}%`,background:'linear-gradient(90deg,#6B3FD4,#9B6DFF)',borderRadius:3,transition:'width .4s ease'}}/>
              </div>
            </div>
          )}

          {/* Items preview */}
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:14}}>
            {order.items.slice(0,5).map((item,j)=>(
              <div key={j} style={{display:'flex',alignItems:'center',gap:5,padding:'4px 9px',borderRadius:9,background:item.done?'rgba(155,109,255,.12)':'#0C1C0F',border:`1px solid ${item.done?'rgba(155,109,255,.3)':'#162B1A'}`,position:'relative'}}>
                <span style={{fontSize:14}}>{item.e}</span>
                <span style={{fontSize:11,fontWeight:600,color:item.done?'#9B6DFF':'#8FB897',textDecoration:item.done?'line-through':'none'}}>{item.name.split(' ')[0]}</span>
                {item.done&&<span style={{fontSize:10,color:'#9B6DFF'}}>✓</span>}
              </div>
            ))}
            {order.items.length>5&&<span style={{fontSize:11,color:'#3D6645',alignSelf:'center'}}>+{order.items.length-5} ещё</span>}
          </div>

          {/* Comment */}
          {order.comment&&(
            <div style={{padding:'8px 12px',borderRadius:10,background:'rgba(255,184,0,.06)',border:'1px solid rgba(255,184,0,.2)',fontSize:12,color:'#FFB800',marginBottom:12}}>
              💬 {order.comment}
            </div>
          )}

          {/* Courier */}
          <div style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',borderRadius:11,background:'rgba(59,142,240,.07)',border:'1px solid rgba(59,142,240,.2)',marginBottom:12}}>
            <span style={{fontSize:16}}>🛵</span>
            <div style={{flex:1}}>
              <div style={{fontSize:12,fontWeight:700,color:'#3B8EF0'}}>{order.courier.name}</div>
              <div style={{fontSize:10,color:'#3D6645'}}>{order.courier.phone}</div>
            </div>
            <a href={`tel:${order.courier.phone}`} style={{padding:'5px 11px',borderRadius:9,background:'rgba(59,142,240,.12)',border:'1px solid rgba(59,142,240,.3)',color:'#3B8EF0',fontSize:11,fontWeight:700,textDecoration:'none'}}>Позвонить</a>
          </div>

          {/* Action */}
          <button onClick={()=>onStart(order.id)} className="btn"
            style={{width:'100%',padding:13,borderRadius:14,background:`linear-gradient(135deg,#6B3FD4,#9B6DFF)`,border:'none',color:'white',fontFamily:'Nunito',fontWeight:800,fontSize:14,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
            {isNew ? '▶ Начать сборку' : pct>0 ? `▶ Продолжить сборку (${doneCount}/${order.items.length})` : '▶ Продолжить сборку'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div style={{minHeight:'100vh',paddingBottom:90}}>
      <Header title="Сборщик" sub={`${assemblerName} · ${orders.length} заказов`}
        right={
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{display:'flex',alignItems:'center',gap:6,padding:'5px 11px',borderRadius:10,background:'rgba(155,109,255,.1)',border:'1px solid rgba(155,109,255,.25)'}}>
              <div style={{width:6,height:6,borderRadius:'50%',background:'#9B6DFF',animation:'pulse 2s infinite'}}/>
              <span style={{fontSize:11,fontWeight:700,color:'#9B6DFF'}}>Онлайн</span>
            </div>
            <LogoutBtn onLogout={onLogout} />
          </div>
        }
      />

      <div style={{padding:'14px 18px'}}>
        {/* Stats row */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:18}}>
          {[
            {l:'На очереди',  v:orders.length,   c:'#9B6DFF'},
            {l:'Собрано сегодня',v:completed+HISTORY_DATA.length,c:'#1FD760'},
            {l:'Ср. время',   v:'7 мин',          c:'#FFB800'},
          ].map((s,i)=>(
            <div key={i} style={{background:'#091508',border:'1px solid #162B1A',borderRadius:14,padding:'13px 10px',textAlign:'center',animation:`fadeUp .4s ease ${i*.06}s both`}}>
              <div style={{fontFamily:'Unbounded',fontSize:18,fontWeight:900,color:s.c,marginBottom:3}}>{s.v}</div>
              <div style={{fontSize:9,color:'#3D6645',lineHeight:1.3}}>{s.l}</div>
            </div>
          ))}
        </div>

        {orders.length===0?(
          <div style={{textAlign:'center',paddingTop:60,animation:'fadeIn .6s ease'}}>
            <div style={{fontSize:64,marginBottom:16,animation:'pulse 2s ease-in-out infinite'}}>🎉</div>
            <div style={{fontFamily:'Unbounded',fontSize:18,fontWeight:900,marginBottom:8,color:'#9B6DFF'}}>Все заказы собраны!</div>
            <div style={{fontSize:13,color:'#8FB897'}}>Ожидайте новых заказов</div>
          </div>
        ) : (
          <>
            {newQueue.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontFamily:'Unbounded', fontSize:13, fontWeight:800, marginBottom:10, color:'#FF4545' }}>🆕 Новые заказы ({newQueue.length})</div>
                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                  {[...urgentNew, ...normalNew].map((o, i) => <PCard key={o.id} order={o} i={i} isNew />)}
                </div>
              </div>
            )}
            {inProgress.length > 0 && (
              <div>
                <div style={{ fontFamily:'Unbounded', fontSize:13, fontWeight:800, marginBottom:10, color:'#9B6DFF', marginTop: newQueue.length ? 8 : 0 }}>🛒 В сборке ({inProgress.length})</div>
                {urgentProgress.length > 0 && (
                  <div style={{ marginBottom:12 }}>
                    <div style={{ fontSize:11, fontWeight:800, marginBottom:8, color:'#FF4545' }}>⚡ Срочные</div>
                    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                      {urgentProgress.map((o, i) => <PCard key={o.id} order={o} i={i} />)}
                    </div>
                  </div>
                )}
                {normalProgress.length > 0 && (
                  <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                    {normalProgress.map((o, i) => <PCard key={o.id} order={o} i={i + urgentProgress.length} />)}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <BottomNav page="dashboard" onPage={onPage} newCount={newQueue.length}/>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   СБОРКА ЗАКАЗА
══════════════════════════════════════════════════════ */
function CollectPage({order, onToggle, onComplete, onBack, onLogout}) {
  const [showConfirm, setShowConfirm] = useState(false);
  const doneCount = order.items.filter(it=>it.done).length;
  const allDone   = doneCount === order.items.length;
  const pct       = Math.round(doneCount/order.items.length*100);



  return (
    <div style={{minHeight:'100vh',background:'#030B05',maxWidth:480,margin:'0 auto'}}>
      <style>{CSS}</style>
      {/* Header */}
      <header style={{position:'sticky',top:0,zIndex:100,background:'rgba(3,11,5,.97)',backdropFilter:'blur(24px)',borderBottom:'1px solid #162B1A'}}>
        <div style={{padding:'13px 18px',display:'flex',alignItems:'center',gap:10}}>
          <button onClick={onBack} className="btn" style={{width:38,height:38,borderRadius:12,background:'#0C1C0F',border:'1px solid #162B1A',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="#8FB897" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 5 5 12 12 19"/></svg>
          </button>
          <div style={{flex:1}}>
            <div style={{fontFamily:'Unbounded',fontSize:15,fontWeight:900,color:'#9B6DFF'}}>{order.id}</div>
            <div style={{fontSize:10,color:'#8FB897',marginTop:1}}>{order.client.name} · {doneCount}/{order.items.length} собрано</div>
          </div>
          <div style={{fontFamily:'Unbounded',fontSize:16,fontWeight:900,color:allDone?'#1FD760':'#9B6DFF'}}>{pct}%</div>
          <LogoutBtn onLogout={onLogout} />
        </div>
        {/* Progress bar */}
        <div style={{height:5,background:'#162B1A',margin:'0 18px 12px'}}>
          <div style={{height:'100%',width:`${pct}%`,background:allDone?'linear-gradient(90deg,#17B34E,#1FD760)':'linear-gradient(90deg,#6B3FD4,#9B6DFF)',borderRadius:2,transition:'width .4s ease',boxShadow:allDone?'0 0 10px rgba(31,215,96,.5)':'0 0 10px rgba(155,109,255,.5)'}}/>
        </div>
      </header>

      {/* Order info */}
      <div style={{margin:'14px 18px 0'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
          <div style={{padding:'11px 14px',borderRadius:13,background:'#091508',border:'1px solid #162B1A'}}>
            <div style={{fontSize:10,color:'#3D6645',marginBottom:4}}>📍 Клиент</div>
            <div style={{fontSize:12,fontWeight:700,marginBottom:1}}>{order.client.name}</div>
            <div style={{fontSize:10,color:'#8FB897'}}>{order.client.addr}</div>
          </div>
          <div style={{padding:'11px 14px',borderRadius:13,background:'rgba(59,142,240,.07)',border:'1px solid rgba(59,142,240,.2)'}}>
            <div style={{fontSize:10,color:'#3D6645',marginBottom:4}}>🛵 Курьер</div>
            <div style={{fontSize:12,fontWeight:700,color:'#3B8EF0',marginBottom:1}}>{order.courier.name}</div>
            <div style={{fontSize:10,color:'#8FB897'}}>{order.courier.phone}</div>
          </div>
        </div>
        {order.comment&&(
          <div style={{padding:'9px 13px',borderRadius:11,background:'rgba(255,184,0,.06)',border:'1px solid rgba(255,184,0,.2)',fontSize:12,color:'#FFB800',marginBottom:14}}>
            💬 {order.comment}
          </div>
        )}
        {order.priority==='urgent'&&(
          <div style={{padding:'8px 13px',borderRadius:11,background:'rgba(255,69,69,.08)',border:'1px solid rgba(255,69,69,.25)',fontSize:12,color:'#FF4545',fontWeight:700,marginBottom:14,display:'flex',alignItems:'center',gap:7}}>
            <div style={{width:6,height:6,borderRadius:'50%',background:'#FF4545',animation:'pulse 1s infinite'}}/>
            Срочный заказ — курьер ожидает у магазина
          </div>
        )}
      </div>

      {/* Items list */}
      <div style={{padding:'0 18px 180px',display:'flex',flexDirection:'column',gap:10}}>
        {order.items.map((item,i)=>(
          <div key={item.id} onClick={()=>onToggle(order.id, item.id)}
            style={{display:'flex',gap:13,padding:'14px 15px',borderRadius:16,background:item.done?'rgba(155,109,255,.08)':'#091508',border:`1.5px solid ${item.done?'rgba(155,109,255,.4)':'#162B1A'}`,cursor:'pointer',transition:'background .2s, border-color .2s'}}>
            <div style={{width:52,height:52,borderRadius:14,background:item.done?'rgba(155,109,255,.15)':'#0C1C0F',border:`1px solid ${item.done?'rgba(155,109,255,.3)':'#162B1A'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,flexShrink:0,position:'relative',transition:'all .2s'}}>
              {item.e}
              {item.done&&(
                <div style={{position:'absolute',inset:0,borderRadius:14,background:'rgba(155,109,255,.4)',display:'flex',alignItems:'center',justifyContent:'center',animation:'fadeIn .2s ease'}}>
                  <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" style={{animation:'checkPop .3s ease'}}><polyline points="20 6 9 17 4 12"/></svg>
                </div>
              )}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:14,fontWeight:700,marginBottom:4,textDecoration:item.done?'line-through':'none',color:item.done?'#3D6645':'#EBF5ED',transition:'color .2s'}}>{item.name}</div>
              <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:4}}>
                <span style={{fontFamily:'Unbounded',fontSize:13,fontWeight:900,color:item.done?'#3D6645':'#9B6DFF'}}>{item.qty} шт</span>
                <span style={{fontSize:11,color:'#3D6645'}}>· {item.unit}</span>
                <span style={{fontSize:11,color:'#FFB800',fontWeight:700}}>{(item.price*item.qty).toFixed(2)} ЅМ</span>
              </div>
              <span style={{fontFamily:'Unbounded',fontSize:9,color:'#3D6645',fontWeight:700}}>{item.art}</span>
            </div>
            <div style={{width:30,height:30,borderRadius:'50%',border:`2.5px solid ${item.done?'#9B6DFF':'#1D3822'}`,background:item.done?'linear-gradient(135deg,#6B3FD4,#9B6DFF)':'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,alignSelf:'center',transition:'all .2s',boxShadow:item.done?'0 0 12px rgba(155,109,255,.4)':'none'}}>
              {item.done&&<svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" style={{animation:'checkPop .3s ease'}}><polyline points="20 6 9 17 4 12"/></svg>}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom action */}
      <div style={{position:'fixed',bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:480,zIndex:90,background:'rgba(3,11,5,.97)',backdropFilter:'blur(26px)',borderTop:'1px solid #162B1A',padding:'13px 18px 28px'}}>
        {/* Summary */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div style={{fontSize:11,color:'#8FB897'}}>
            Итого: <span style={{fontWeight:700,color:'#FFB800'}}>{order.items.reduce((s,it)=>s+it.price*it.qty,0).toFixed(2)} ЅМ</span>
          </div>
          <div style={{fontSize:11,color:'#8FB897'}}>
            Собрано: <span style={{fontWeight:700,color:'#9B6DFF'}}>{doneCount}/{order.items.length}</span>
          </div>
        </div>
        {allDone ? (
          <button onClick={()=>setShowConfirm(true)} className="btn"
            style={{width:'100%',padding:14,borderRadius:16,background:'linear-gradient(135deg,#17B34E,#1FD760)',border:'none',color:'white',fontFamily:'Nunito',fontWeight:800,fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',gap:10,boxShadow:'0 8px 24px rgba(31,215,96,.4)'}}>
            ✅ Всё собрано — передать курьеру
          </button>
        ) : (
          <div style={{padding:'12px',background:'#091508',borderRadius:13,border:'1px solid #162B1A',textAlign:'center',fontSize:12,color:'#8FB897'}}>
            Отметьте каждый товар по мере сборки · Осталось: <span style={{color:'#9B6DFF',fontWeight:700}}>{order.items.length-doneCount} товаров</span>
          </div>
        )}
      </div>

      {/* Confirm modal */}
      {showConfirm&&(
        <div style={{position:'fixed',inset:0,zIndex:300,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
          <div onClick={()=>setShowConfirm(false)} style={{position:'absolute',inset:0,background:'rgba(0,0,0,.85)',backdropFilter:'blur(10px)'}}/>
          <div style={{position:'relative',zIndex:1,width:'100%',maxWidth:480,background:'#06100A',borderTop:'1px solid #162B1A',borderRadius:'24px 24px 0 0',padding:'22px 20px 44px',animation:'slideUp .4s cubic-bezier(.16,1,.3,1)'}}>
            <div style={{width:40,height:4,borderRadius:2,background:'#1D3822',margin:'0 auto 20px'}}/>
            <div style={{textAlign:'center',marginBottom:20}}>
              <div style={{fontSize:48,marginBottom:10}}>📦</div>
              <div style={{fontFamily:'Unbounded',fontSize:16,fontWeight:900,marginBottom:6}}>Заказ {order.id} собран!</div>
              <div style={{fontSize:12,color:'#8FB897',lineHeight:1.6}}>
                Передайте заказ курьеру:<br/>
                <span style={{color:'#3B8EF0',fontWeight:700}}>{order.courier.name}</span>
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
              {order.items.map((it,i)=>(
                <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',borderRadius:10,background:'rgba(155,109,255,.08)',border:'1px solid rgba(155,109,255,.2)'}}>
                  <span style={{fontSize:18}}>{it.e}</span>
                  <div><div style={{fontSize:11,fontWeight:700}}>{it.name.split(' ')[0]}</div><div style={{fontSize:10,color:'#9B6DFF'}}>{it.qty} шт ✓</div></div>
                </div>
              ))}
            </div>
            <button onClick={()=>onComplete(order.id)} className="btn"
              style={{width:'100%',padding:14,borderRadius:15,background:'linear-gradient(135deg,#17B34E,#1FD760)',border:'none',color:'white',fontFamily:'Nunito',fontWeight:800,fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
              🛵 Передал курьеру — завершить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   ИСТОРИЯ
══════════════════════════════════════════════════════ */
function HistoryPage({onPage, onLogout}) {
  return (
    <div style={{minHeight:'100vh',paddingBottom:90}}>
      <Header title="История сборок" sub="Сегодня" showBack onBack={()=>onPage('dashboard')} right={<LogoutBtn onLogout={onLogout} />}/>
      <div style={{padding:'14px 18px'}}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:18}}>
          {[
            {l:'Собрано сегодня', v:HISTORY_DATA.length, c:'#9B6DFF'},
            {l:'Ср. время',       v:'7 мин',             c:'#1FD760'},
            {l:'Товаров собрано', v:'25',                c:'#FFB800'},
          ].map((s,i)=>(
            <div key={i} style={{background:'#091508',border:'1px solid #162B1A',borderRadius:14,padding:'13px 10px',textAlign:'center'}}>
              <div style={{fontFamily:'Unbounded',fontSize:17,fontWeight:900,color:s.c,marginBottom:3}}>{s.v}</div>
              <div style={{fontSize:9,color:'#3D6645',lineHeight:1.3}}>{s.l}</div>
            </div>
          ))}
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {HISTORY_DATA.map((h,i)=>(
            <div key={i} className="card" style={{padding:'14px 16px',animation:`fadeUp .4s ease ${i*.06}s both`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:36,height:36,borderRadius:10,background:'rgba(155,109,255,.12)',border:'1px solid rgba(155,109,255,.25)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:13,fontWeight:900,color:'#9B6DFF',flexShrink:0}}>✓</div>
                  <div>
                    <div style={{fontFamily:'Unbounded',fontSize:13,fontWeight:800,color:'#9B6DFF'}}>{h.id}</div>
                    <div style={{fontSize:11,color:'#8FB897',marginTop:1}}>{h.client}</div>
                  </div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontFamily:'Unbounded',fontSize:12,fontWeight:700,color:'#1FD760'}}>{h.duration}</div>
                  <div style={{fontSize:10,color:'#3D6645',marginTop:1}}>{h.time}</div>
                </div>
              </div>
              <div style={{display:'flex',gap:8}}>
                <span style={{padding:'3px 9px',borderRadius:8,fontSize:11,fontWeight:700,background:'rgba(255,184,0,.1)',color:'#FFB800',border:'1px solid rgba(255,184,0,.25)'}}>{h.items} товаров</span>
                <span style={{padding:'3px 9px',borderRadius:8,fontSize:11,fontWeight:700,background:'rgba(31,215,96,.1)',color:'#1FD760',border:'1px solid rgba(31,215,96,.25)'}}>✓ Завершён</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <BottomNav page="history" onPage={onPage} newCount={0}/>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   СТАТИСТИКА
══════════════════════════════════════════════════════ */
function StatsPage({onPage, completed, assemblerName, onLogout}) {
  const avatar = assemblerName?.charAt(0) || 'С';
  const totalToday  = completed + HISTORY_DATA.length;
  const totalItems  = 25 + completed*4;
  const WEEK = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  const weekData = [8,12,6,14,11,9,totalToday];
  const maxW = Math.max(...weekData);

  return (
    <div style={{minHeight:'100vh',paddingBottom:90}}>
      <Header title="Статистика" sub="Моя эффективность" showBack onBack={()=>onPage('dashboard')} right={<LogoutBtn onLogout={onLogout} />}/>
      <div style={{padding:'14px 18px'}}>
        {/* Profile */}
        <div style={{display:'flex',alignItems:'center',gap:14,padding:'16px 18px',borderRadius:18,background:'linear-gradient(135deg,#0D0619,#1A0A30)',border:'1px solid rgba(155,109,255,.25)',marginBottom:18}}>
          <div style={{width:56,height:56,borderRadius:18,background:'linear-gradient(135deg,#6B3FD4,#9B6DFF)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:22,fontWeight:900,color:'white',flexShrink:0,boxShadow:'0 6px 20px rgba(155,109,255,.4)'}}>{avatar}</div>
          <div style={{flex:1}}>
            <div style={{fontFamily:'Unbounded',fontSize:15,fontWeight:900,marginBottom:2}}>{assemblerName}</div>
            <div style={{fontSize:11,color:'#8FB897',marginBottom:6}}>Сборщик · КАКАПО Яван</div>
            <div style={{display:'flex',gap:8}}>
              <span style={{padding:'3px 9px',borderRadius:8,fontSize:10,fontWeight:700,background:'rgba(31,215,96,.12)',color:'#1FD760',border:'1px solid rgba(31,215,96,.25)'}}>★ 4.9 рейтинг</span>
              <span style={{padding:'3px 9px',borderRadius:8,fontSize:10,fontWeight:700,background:'rgba(155,109,255,.12)',color:'#9B6DFF',border:'1px solid rgba(155,109,255,.25)'}}>Топ сборщик</span>
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:18}}>
          {[
            {l:'Собрано сегодня',   v:totalToday,         c:'#9B6DFF', e:'📦'},
            {l:'Товаров обработано',v:totalItems,         c:'#FFB800', e:'🛒'},
            {l:'Среднее время',     v:'7 мин',            c:'#1FD760', e:'⏱'},
            {l:'Рекорд за день',    v:'19 заказов',       c:'#FF8C00', e:'🏆'},
          ].map((s,i)=>(
            <div key={i} style={{background:'#091508',border:'1px solid #162B1A',borderRadius:16,padding:'16px 14px',animation:`fadeUp .4s ease ${i*.07}s both`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                <div style={{fontSize:10,color:'#3D6645',fontWeight:600}}>{s.l}</div>
                <span style={{fontSize:20}}>{s.e}</span>
              </div>
              <div style={{fontFamily:'Unbounded',fontSize:22,fontWeight:900,color:s.c}}>{s.v}</div>
            </div>
          ))}
        </div>

        {/* Week chart */}
        <div style={{background:'#091508',border:'1px solid #162B1A',borderRadius:18,padding:'18px',marginBottom:16}}>
          <div style={{fontFamily:'Unbounded',fontSize:13,fontWeight:800,marginBottom:16}}>Заказов за неделю</div>
          <div style={{display:'flex',gap:6,alignItems:'flex-end',height:100}}>
            {weekData.map((v,i)=>(
              <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
                <div style={{fontSize:9,color:i===6?'#9B6DFF':'#3D6645',fontWeight:700}}>{v}</div>
                <div style={{width:'100%',borderRadius:'4px 4px 0 0',background:i===6?'linear-gradient(180deg,#9B6DFF,#6B3FD4)':'linear-gradient(180deg,#1D3822,#162B1A)',height:`${Math.round(v/maxW*80)}px`,transition:'height .6s ease',boxShadow:i===6?'0 2px 10px rgba(155,109,255,.4)':'none'}}/>
                <div style={{fontSize:9,color:i===6?'#9B6DFF':'#3D6645',fontWeight:i===6?800:400}}>{WEEK[i]}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Tips */}
        <div style={{background:'rgba(155,109,255,.06)',border:'1px solid rgba(155,109,255,.2)',borderRadius:16,padding:'16px'}}>
          <div style={{fontFamily:'Unbounded',fontSize:12,fontWeight:800,color:'#9B6DFF',marginBottom:10}}>💡 Советы для эффективности</div>
          {['Начинайте с тяжёлых товаров (мясо, молочное)','Проверяйте срок годности при сборке','Хрупкие товары кладите поверх тяжёлых','Сверяйтесь с артикулом KAK-XXXX'].map((tip,i)=>(
            <div key={i} style={{fontSize:11,color:'#8FB897',padding:'7px 0',borderBottom:i<3?'1px solid rgba(155,109,255,.1)':'none',display:'flex',alignItems:'flex-start',gap:8}}>
              <span style={{color:'#9B6DFF',fontWeight:700,flexShrink:0}}>{i+1}.</span>{tip}
            </div>
          ))}
        </div>
      </div>
      <BottomNav page="stats" onPage={onPage} newCount={0}/>
    </div>
  );
}
