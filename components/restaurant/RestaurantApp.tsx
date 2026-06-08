'use client'
import { useState, useEffect } from 'react'
import { useOrders, useRestaurants } from '@/lib/store'
import Link from 'next/link'
// ─── KAKAPO Restaurant App ───────────────────────
/* ══════════════════════════════════════════════════════
   KAKAPO RESTAURANT — Приложение для партнёров
   Отдельное приложение для управления рестораном
   г. Яван, Таджикистан
══════════════════════════════════════════════════════ */

// React hooks imported above

/* ── CSS ─────────────────────────────────────────── */
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@700;800;900&family=Nunito:wght@400;600;700;800&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
  html,body{background:#030B05;color:#EBF5ED;font-family:'Nunito',sans-serif;-webkit-font-smoothing:antialiased;}
  .ub{font-family:'Unbounded',sans-serif;}
  .btn{cursor:pointer;border:none;transition:all .2s cubic-bezier(.16,1,.3,1);}.btn:active{transform:scale(.97);}
  .card{background:#091508;border:1px solid #162B1A;border-radius:18px;overflow:hidden;}
  .inp{background:#0C1C0F;border:1.5px solid #162B1A;border-radius:13px;color:#EBF5ED;font-family:'Nunito',sans-serif;font-size:14px;outline:none;padding:12px 15px;width:100%;transition:border-color .2s;}
  .inp:focus{border-color:rgba(31,215,96,.5);box-shadow:0 0 0 3px rgba(31,215,96,.07);}
  .inp::placeholder{color:#3D6645;}
  .hscroll{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;}
  .hscroll::-webkit-scrollbar{display:none;}
  ::-webkit-scrollbar{width:3px;}
  ::-webkit-scrollbar-track{background:#06100A;}
  ::-webkit-scrollbar-thumb{background:#1D3822;border-radius:2px;}
  @keyframes spin{from{transform:rotate(0);}to{transform:rotate(360deg);}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
  @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
  @keyframes pulse{0%,100%{opacity:1;}50%{opacity:.35;}}
  @keyframes glow{0%,100%{box-shadow:0 0 18px rgba(31,215,96,.2);}50%{box-shadow:0 0 40px rgba(31,215,96,.5);}}
  @keyframes ping{0%{transform:scale(1);opacity:1;}100%{transform:scale(2.2);opacity:0;}}
  @keyframes slideUp{from{opacity:0;transform:translateY(24px);}to{opacity:1;transform:translateY(0);}}
  @keyframes ring{0%,100%{transform:rotate(0);}20%{transform:rotate(-15deg);}40%{transform:rotate(15deg);}60%{transform:rotate(-8deg);}80%{transform:rotate(8deg);}}
`;

/* ── DEMO DATA ───────────────────────────────────── */
const DEMO_RESTAURANTS = [
  {id:'R-01',name:'Чайхона Оромгох',  emoji:'🍖',email:'chaihona@kakapo.tj', pass:'rest123',
   cuisine:'Таджикская кухня', address:'ул. Рудаки, 15', phone:'+992 93 111 22 33',
   rating:4.8, commission:15, isOpen:true,
   hours:{open:'09:00',close:'23:00'},
   categories:['Горячее','Шашлык','Салаты','Супы','Напитки'],
   menu:[
     {id:1,cat:'Горячее',e:'🍚',name:'Плов узбекский',    desc:'Рис, мясо, морковь, специи',  price:18,inStock:true, popular:true},
     {id:2,cat:'Шашлык', e:'🥩',name:'Шашлык говяжий',   desc:'Говядина на углях, 200 гр',    price:22,inStock:true, popular:true},
     {id:3,cat:'Шашлык', e:'🍗',name:'Шашлык куриный',   desc:'Куриное филе на углях',        price:16,inStock:true, popular:false},
     {id:4,cat:'Салаты', e:'🥗',name:'Ачик-чучук',        desc:'Помидоры, лук, перец',         price:8, inStock:true, popular:false},
     {id:5,cat:'Супы',   e:'🍲',name:'Шурпо',             desc:'Наваристый суп из баранины',   price:12,inStock:true, popular:true},
     {id:6,cat:'Супы',   e:'🍜',name:'Лагман',            desc:'Домашняя лапша с мясом',      price:14,inStock:false,popular:true},
     {id:7,cat:'Напитки',e:'🍵',name:'Зелёный чай',       desc:'Чайник 0.5л',                  price:4, inStock:true, popular:false},
     {id:8,cat:'Горячее',e:'🥟',name:'Манты',             desc:'6 штук, говядина+лук',         price:16,inStock:true, popular:true},
   ]},
  {id:'R-02',name:'Пицца Яван',       emoji:'🍕',email:'pizza@kakapo.tj',    pass:'rest123',
   cuisine:'Итальянская', address:'ул. Ленина, 28', phone:'+992 90 222 33 44',
   rating:4.6, commission:18, isOpen:true,
   hours:{open:'10:00',close:'22:00'},
   categories:['Пицца','Бургеры','Паста','Десерты','Напитки'],
   menu:[
     {id:1,cat:'Пицца',  e:'🍕',name:'Маргарита',         desc:'Томат, моцарелла, базилик',   price:28,inStock:true, popular:true},
     {id:2,cat:'Пицца',  e:'🍕',name:'Пепперони',         desc:'Томат, пепперони, сыр',        price:32,inStock:true, popular:true},
     {id:3,cat:'Бургеры',e:'🍔',name:'Классик бургер',    desc:'Котлета 150г, сыр, овощи',    price:22,inStock:true, popular:true},
     {id:4,cat:'Паста',  e:'🍝',name:'Спагетти болоньезе',desc:'Паста, мясной соус',           price:24,inStock:true, popular:false},
     {id:5,cat:'Десерты',e:'🍰',name:'Чизкейк',           desc:'Классический чизкейк',         price:14,inStock:true, popular:true},
     {id:6,cat:'Напитки',e:'🥤',name:'Кола 0.5л',         desc:'Coca-Cola / Pepsi',            price:5, inStock:true, popular:false},
   ]},
];

const DEMO_ORDERS = [
  {id:'K-4832',time:'14:23',client:'Диловар Р.',  phone:'+992 93 456 78 90',
   items:[{e:'🍚',name:'Плов узбекский',qty:2,price:18},{e:'🥩',name:'Шашлык говяжий',qty:1,price:22}],
   total:58,status:'new',   addr:'ул. Ленина, 42',  comment:'Без лука пожалуйста'},
  {id:'K-4831',time:'14:10',client:'Нилуфар Х.',  phone:'+992 90 123 45 67',
   items:[{e:'🍜',name:'Лагман',qty:1,price:14},{e:'🥗',name:'Ачик-чучук',qty:1,price:8}],
   total:22,status:'cooking',addr:'ул. Сомони, 12', comment:''},
  {id:'K-4820',time:'13:45',client:'Бахром К.',   phone:'+992 88 789 01 23',
   items:[{e:'🥟',name:'Манты',qty:1,price:16}],
   total:16,status:'ready',  addr:'мкр. Мирный, 5', comment:''},
  {id:'K-4810',time:'13:20',client:'Рустам Д.',   phone:'+992 91 654 32 10',
   items:[{e:'🍚',name:'Плов узбекский',qty:1,price:18},{e:'🥩',name:'Шашлык говяжий',qty:2,price:22},{e:'🍵',name:'Зелёный чай',qty:2,price:4}],
   total:70,status:'delivered',addr:'ул. Рудаки, 8', comment:''},
];

/* ══════════════════════════════════════════════════════
   MAIN APP
══════════════════════════════════════════════════════ */
export default function RestaurantApp() {
  const [page,    setPage]    = useState('dashboard');
  const [partner, setPartner] = useState({email:'chaihona@kakapo.tj', name:'Чайхона Оромгох'});
  const [rest,    setRest]    = useState(DEMO_RESTAURANTS[0]);
  const [menu,    setMenu]    = useState(DEMO_RESTAURANTS[0].menu);
  const [orders,  setOrders]  = useState(DEMO_ORDERS);
  const [isOpen,  setIsOpen]  = useState(true);
  const [newOrder,setNewOrder]= useState(false);

  // Simulate new order notification
  useEffect(() => {
    if(!partner) return;
    const t = setTimeout(() => setNewOrder(true), 8000);
    return () => clearTimeout(t);
  }, [partner]);

  const login = (email, pass) => {
    const found = DEMO_RESTAURANTS.find(r => r.email.toLowerCase()===email.toLowerCase() && r.pass===pass);
    if(found) {
      setPartner({email, name: found.name});
      setRest(found);
      setMenu(found.menu);
      setIsOpen(found.isOpen);
      setPage('dashboard');
      return true;
    }
    return false;
  };

  const logout = () => { setPartner(null); setRest(null); setPage('login'); };

  const updateOrderStatus = (id, status) => {
    setOrders(os => os.map(o => o.id===id ? {...o, status} : o));
  };

  const toggleDish = (id) => {
    setMenu(m => m.map(dish => dish.id===id ? {...dish, inStock:!dish.inStock} : dish));
  };

  const addDish = (dish) => {
    setMenu(m => [...m, {...dish, id: Date.now()}]);
  };

  const removeDish = (id) => {
    setMenu(m => m.filter(dish => dish.id!==id));
  };

  const acceptNewOrder = () => {
    const o = {
      id:`K-${4840+Math.floor(Math.random()*10)}`,
      time: new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}),
      client:'Зафар М.', phone:'+992 93 500 11 22',
      items:[{e:'🍲',name:'Шурпо',qty:1,price:12},{e:'🥟',name:'Манты',qty:2,price:16}],
      total:44, status:'new', addr:'ул. Ленина, 18', comment:'Побыстрее пожалуйста'
    };
    setOrders(os=>[o,...os]);
    setNewOrder(false);
  };

  if(!rest) return null;

  return (
    <>
      <style>{CSS}</style>
      <div style={{maxWidth:480,margin:'0 auto',minHeight:'100dvh',background:'#030B05',position:'relative'}}>
        {/* New order notification */}
        {newOrder && (
          <div style={{position:'fixed',top:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:480,zIndex:999,padding:'14px 18px',background:'linear-gradient(135deg,#0F3020,#1A5030)',borderBottom:'2px solid var(--gr)',animation:'ring .8s ease',display:'flex',alignItems:'center',gap:12}}>
            <div style={{fontSize:28,animation:'ring 1s ease infinite'}}>🔔</div>
            <div style={{flex:1}}>
              <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:900,color:'var(--gr)'}}>Новый заказ!</div>
              <div style={{fontSize:11,color:'rgba(255,255,255,.7)',marginTop:1}}>Зафар М. · 44 ЅМ · Шурпо + Манты</div>
            </div>
            <div style={{display:'flex',gap:8}}>
              <button onClick={acceptNewOrder} className="btn" style={{padding:'8px 14px',borderRadius:11,background:'linear-gradient(135deg,var(--gr2),var(--gr))',border:'none',color:'#030B05',fontFamily:'Nunito',fontWeight:800,fontSize:13}}>Принять</button>
              <button onClick={()=>setNewOrder(false)} className="btn" style={{padding:'8px 12px',borderRadius:11,background:'rgba(255,69,69,.2)',border:'1px solid rgba(255,69,69,.4)',color:'var(--red)',fontFamily:'Nunito',fontWeight:700,fontSize:13}}>✕</button>
            </div>
          </div>
        )}

        {page==='dashboard' && <DashboardPage rest={rest} orders={orders} isOpen={isOpen} setIsOpen={setIsOpen} onPage={setPage} onLogout={logout} newOrder={newOrder}/>}
        {page==='orders'    && <OrdersPage    rest={rest} orders={orders} onUpdate={updateOrderStatus} onPage={setPage}/>}
        {page==='menu'      && <MenuPage      rest={rest} menu={menu} onToggle={toggleDish} onAdd={addDish} onRemove={removeDish} onPage={setPage}/>}
        {page==='stats'     && <StatsPage     rest={rest} orders={orders} onPage={setPage}/>}
        {page==='settings'  && <SettingsPage  rest={rest} isOpen={isOpen} setIsOpen={setIsOpen} onPage={setPage} onLogout={logout}/>}
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════
   LOGIN
══════════════════════════════════════════════════════ */
function LoginPage({onLogin}) {
  const [email, setEmail] = useState('');
  const [pass,  setPass]  = useState('');
  const [err,   setErr]   = useState('');
  const [load,  setLoad]  = useState(false);

  const submit = (e) => {
    e.preventDefault(); setErr('');
    if(!email||!pass){setErr('Заполните все поля');return;}
    setLoad(true);
    setTimeout(() => {
      const ok = onLogin(email, pass);
      if(!ok){setErr('Неверный email или пароль');}
      setLoad(false);
    },900);
  };

  return (
    <>
      <style>{CSS}</style>
      <div style={{minHeight:'100vh',background:'#030B05',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:24,maxWidth:480,margin:'0 auto'}}>
        <div style={{textAlign:'center',marginBottom:32}}>
          <div style={{width:72,height:72,borderRadius:22,background:'linear-gradient(135deg,#0F3020,#1FD760)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:36,margin:'0 auto 14px',animation:'glow 3s ease-in-out infinite',boxShadow:'0 8px 28px rgba(31,215,96,.4)'}}>🍽</div>
          <div style={{fontFamily:'Unbounded',fontSize:20,fontWeight:900,background:'linear-gradient(135deg,#1FD760,#FFB800)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text',marginBottom:4}}>KAKAPO Ресторан</div>
          <div style={{fontSize:12,color:'#8FB897'}}>Кабинет партнёра · г. Яван</div>
        </div>

        <div style={{width:'100%',maxWidth:380,background:'#091508',border:'1px solid #162B1A',borderRadius:22,padding:26}}>
          <div style={{fontFamily:'Unbounded',fontSize:15,fontWeight:800,marginBottom:18}}>Войти в кабинет</div>
          {err&&<div style={{padding:'10px 13px',borderRadius:11,background:'rgba(255,69,69,.1)',border:'1px solid rgba(255,69,69,.3)',fontSize:12,color:'#FF4545',marginBottom:14}}>⚠️ {err}</div>}
          <form onSubmit={submit} style={{display:'flex',flexDirection:'column',gap:13}}>
            <div>
              <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Email</div>
              <input className="inp" value={email} onChange={e=>{setEmail(e.target.value);setErr('');}} type="email" placeholder="your@restaurant.tj" autoComplete="email"/>
            </div>
            <div>
              <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Пароль</div>
              <input className="inp" value={pass} onChange={e=>{setPass(e.target.value);setErr('');}} type="password" placeholder="••••••••" autoComplete="current-password"/>
            </div>
            <div style={{padding:'10px 13px',borderRadius:10,background:'rgba(255,184,0,.06)',border:'1px solid rgba(255,184,0,.2)',fontSize:12,color:'#8FB897'}}>
              💡 <span style={{color:'#FFB800',fontWeight:700}}>chaihona@kakapo.tj</span> / <span style={{color:'#FFB800',fontWeight:700}}>rest123</span>
            </div>
            <button type="submit" className="btn" style={{padding:14,borderRadius:14,background:'linear-gradient(135deg,#17B34E,#1FD760)',border:'none',color:'#030B05',fontFamily:'Nunito',fontWeight:800,fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
              {load?<div style={{width:20,height:20,borderRadius:'50%',border:'2.5px solid rgba(3,11,5,.3)',borderTopColor:'#030B05',animation:'spin 1s linear infinite'}}/>:'🔑 Войти'}
            </button>
          </form>
        </div>
        <div style={{marginTop:20,fontSize:11,color:'#3D6645',textAlign:'center'}}>KAKAPO Restaurant v1.0 · Только для партнёров</div>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════
   HEADER (shared)
══════════════════════════════════════════════════════ */
function Header({rest, isOpen, setIsOpen, onPage, onLogout, showBack, backPage, title}) {
  return (
    <header style={{position:'sticky',top:0,zIndex:100,background:'rgba(3,11,5,.97)',backdropFilter:'blur(24px)',borderBottom:'1px solid #162B1A'}}>
      <div style={{padding:'13px 18px',display:'flex',alignItems:'center',gap:10}}>
        {showBack ? (
          <button onClick={()=>onPage(backPage||'dashboard')} className="btn" style={{width:38,height:38,borderRadius:12,background:'#0C1C0F',border:'1px solid #162B1A',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="#8FB897" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 5 5 12 12 19"/></svg>
          </button>
        ) : (
          <div style={{width:38,height:38,borderRadius:12,background:'linear-gradient(135deg,#0F3020,#1FD760)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0,animation:'glow 3s ease-in-out infinite'}}>{rest?.emoji||'🍽'}</div>
        )}
        <div style={{flex:1}}>
          <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:900}}>{title||rest?.name}</div>
          <div style={{fontSize:10,color:'#8FB897',marginTop:1}}>{rest?.cuisine} · {rest?.address}</div>
        </div>
        {!showBack && (
          <div onClick={()=>setIsOpen(v=>!v)} style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',borderRadius:11,background:isOpen?'rgba(31,215,96,.12)':'rgba(255,69,69,.12)',border:`1px solid ${isOpen?'rgba(31,215,96,.3)':'rgba(255,69,69,.3)'}`,cursor:'pointer'}}>
            <div style={{width:7,height:7,borderRadius:'50%',background:isOpen?'#1FD760':'#FF4545',animation:'pulse 2s infinite'}}/>
            <span style={{fontSize:12,fontWeight:700,color:isOpen?'#1FD760':'#FF4545'}}>{isOpen?'Открыто':'Закрыто'}</span>
          </div>
        )}
      </div>
    </header>
  );
}

/* ══════════════════════════════════════════════════════
   BOTTOM NAV (shared)
══════════════════════════════════════════════════════ */
function BottomNav({page, onPage, newOrders}) {
  const items = [
    {id:'dashboard',icon:'📊',label:'Главная'},
    {id:'orders',   icon:'📦',label:'Заказы',  badge:newOrders},
    {id:'menu',     icon:'🍽', label:'Меню'},
    {id:'stats',    icon:'📈',label:'Статистика'},
    {id:'settings', icon:'⚙️', label:'Настройки'},
  ];
  return (
    <nav style={{position:'fixed',bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:480,background:'rgba(3,11,5,.97)',backdropFilter:'blur(26px)',borderTop:'1px solid #162B1A',padding:'8px 18px',paddingBottom:'calc(10px + env(safe-area-inset-bottom,0))',display:'flex',justifyContent:'space-around',zIndex:80}}>
      {items.map(item=>(
        <button key={item.id} onClick={()=>onPage(item.id)} className="btn"
          style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3,padding:'5px 10px',borderRadius:11,background:page===item.id?'rgba(31,215,96,.09)':'transparent',border:`1.5px solid ${page===item.id?'rgba(31,215,96,.22)':'transparent'}`,position:'relative'}}>
          <span style={{fontSize:20}}>{item.icon}</span>
          <span style={{fontSize:9,fontWeight:page===item.id?800:600,color:page===item.id?'#1FD760':'#3D6645',fontFamily:'Nunito'}}>{item.label}</span>
          {item.badge>0&&<div style={{position:'absolute',top:2,right:6,width:16,height:16,borderRadius:'50%',background:'#FF4545',border:'2px solid #030B05',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:8,fontWeight:900,color:'white'}}>{item.badge}</div>}
        </button>
      ))}
    </nav>
  );
}

/* ══════════════════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════════════════ */
function DashboardPage({rest, orders, isOpen, setIsOpen, onPage, onLogout, newOrder}) {
  const todayOrders   = orders.filter(o=>o.status!=='delivered');
  const doneToday     = orders.filter(o=>o.status==='delivered').length;
  const revenue       = orders.filter(o=>o.status==='delivered').reduce((s,o)=>s+o.total,0);
  const newOrders     = orders.filter(o=>o.status==='new').length;

  return (
    <div style={{minHeight:'100vh',background:'#030B05',paddingBottom:90}}>
      <Header rest={rest} isOpen={isOpen} setIsOpen={setIsOpen} onPage={onPage} onLogout={onLogout}/>

      <div style={{padding:'16px 18px'}}>
        {/* Alert new orders */}
        {newOrders>0&&(
          <div onClick={()=>onPage('orders')} style={{display:'flex',alignItems:'center',gap:12,padding:'13px 16px',borderRadius:16,background:'rgba(255,69,69,.08)',border:'1.5px solid rgba(255,69,69,.35)',marginBottom:16,cursor:'pointer',animation:'fadeUp .4s ease'}}>
            <div style={{width:10,height:10,borderRadius:'50%',background:'#FF4545',position:'relative',flexShrink:0}}>
              <div style={{position:'absolute',inset:0,borderRadius:'50%',background:'#FF4545',animation:'ping 1.5s ease-out infinite',opacity:.5}}/>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:800,color:'#FF4545'}}>🔔 {newOrders} новых заказа — требуют ответа!</div>
              <div style={{fontSize:11,color:'#8FB897',marginTop:1}}>Нажмите чтобы обработать заказы</div>
            </div>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#FF4545" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </div>
        )}

        {/* Stats */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:16}}>
          {[
            {l:'Новых заказов',    v:newOrders,       c:'#FF4545', e:'🔔'},
            {l:'В работе',         v:todayOrders.filter(o=>o.status==='cooking').length, c:'#FFB800', e:'👨‍🍳'},
            {l:'Готово к выдаче',  v:todayOrders.filter(o=>o.status==='ready').length,   c:'#1FD760', e:'✅'},
            {l:'Доставлено сегодня',v:doneToday,     c:'#3B8EF0', e:'🛵'},
          ].map((s,i)=>(
            <div key={i} style={{background:'#091508',border:'1px solid #162B1A',borderRadius:16,padding:'14px',animation:`fadeUp .4s ease ${i*.06}s both`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                <div style={{fontSize:10,color:'#8FB897',fontWeight:600}}>{s.l}</div>
                <span style={{fontSize:20}}>{s.e}</span>
              </div>
              <div style={{fontFamily:'Unbounded',fontSize:26,fontWeight:900,color:s.c}}>{s.v}</div>
            </div>
          ))}
        </div>

        {/* Revenue today */}
        <div style={{background:'linear-gradient(135deg,#071A0A,#0F3018)',border:'1px solid rgba(31,215,96,.2)',borderRadius:18,padding:'18px',marginBottom:16,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <div style={{fontSize:11,color:'#8FB897',marginBottom:6}}>Выручка сегодня</div>
            <div style={{fontFamily:'Unbounded',fontSize:30,fontWeight:900,color:'#1FD760'}}>{revenue} <span style={{fontSize:16,color:'#FFB800'}}>ЅМ</span></div>
            <div style={{fontSize:11,color:'#3D6645',marginTop:4}}>Комиссия KAKAPO ({rest?.commission}%): <span style={{color:'#FF4545'}}>−{Math.round(revenue*rest?.commission/100)} ЅМ</span></div>
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:11,color:'#8FB897',marginBottom:4}}>Ваш доход</div>
            <div style={{fontFamily:'Unbounded',fontSize:22,fontWeight:900,color:'#FFB800'}}>{Math.round(revenue*(1-rest?.commission/100))} ЅМ</div>
          </div>
        </div>

        {/* Active orders */}
        {todayOrders.length>0&&(
          <>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:800}}>Активные заказы</div>
              <button onClick={()=>onPage('orders')} className="btn" style={{fontSize:12,color:'#1FD760',background:'rgba(31,215,96,.1)',border:'1px solid rgba(31,215,96,.25)',borderRadius:10,padding:'5px 12px',fontFamily:'Nunito',fontWeight:700}}>Все →</button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {todayOrders.slice(0,3).map((o,i)=>{
                const sc = {new:{l:'Новый',c:'#FF4545'},cooking:{l:'Готовится',c:'#FFB800'},ready:{l:'Готово!',c:'#1FD760'}};
                const s = sc[o.status]||{l:o.status,c:'#8FB897'};
                return (
                  <div key={o.id} onClick={()=>onPage('orders')} style={{display:'flex',alignItems:'center',gap:12,padding:'13px 14px',background:'#091508',border:`1px solid ${s.c}28`,borderRadius:14,cursor:'pointer',animation:`fadeUp .4s ease ${i*.07}s both`}}>
                    <div style={{width:8,height:8,borderRadius:'50%',background:s.c,flexShrink:0,animation:o.status==='new'?'pulse 1.5s infinite':'none'}}/>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:700,marginBottom:1}}>{o.id} · {o.client}</div>
                      <div style={{fontSize:11,color:'#8FB897'}}>{o.items.map(it=>it.name).join(', ')}</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontFamily:'Unbounded',fontSize:13,fontWeight:900}}>{o.total} <span style={{fontSize:10,color:'#FFB800'}}>ЅМ</span></div>
                      <span style={{fontSize:10,fontWeight:800,color:s.c}}>{s.l}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <BottomNav page="dashboard" onPage={onPage} newOrders={newOrders}/>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   ЗАКАЗЫ
══════════════════════════════════════════════════════ */
function OrdersPage({rest, orders, onUpdate, onPage}) {
  const [filter, setFilter] = useState('active');
  const newOrders = orders.filter(o=>o.status==='new').length;

  const filtered = filter==='active'
    ? orders.filter(o=>o.status!=='delivered')
    : orders.filter(o=>o.status==='delivered');

  const SC = {
    new:      {l:'Новый',     c:'#FF4545',  next:'cooking',  nextL:'✓ Принять и начать готовить'},
    cooking:  {l:'Готовится', c:'#FFB800',  next:'ready',    nextL:'✓ Готово — передать курьеру'},
    ready:    {l:'Готово!',   c:'#1FD760',  next:'delivered',nextL:'✓ Курьер забрал'},
    delivered:{l:'Доставлен', c:'#3B8EF0',  next:null,       nextL:''},
  };

  return (
    <div style={{minHeight:'100vh',background:'#030B05',paddingBottom:90}}>
      <Header rest={rest} isOpen={true} setIsOpen={()=>{}} onPage={onPage} showBack backPage="dashboard" title="Заказы"/>

      <div style={{padding:'14px 18px 0'}}>
        <div style={{display:'flex',gap:8,marginBottom:14}}>
          {[{id:'active',l:`Активные (${orders.filter(o=>o.status!=='delivered').length})`},{id:'done',l:`Доставлено (${orders.filter(o=>o.status==='delivered').length})`}].map(f=>(
            <button key={f.id} onClick={()=>setFilter(f.id)} className="btn"
              style={{flex:1,padding:'10px',borderRadius:12,fontSize:12,fontWeight:700,border:`1.5px solid ${filter===f.id?'rgba(31,215,96,.38)':'#162B1A'}`,background:filter===f.id?'rgba(31,215,96,.12)':'#0C1C0F',color:filter===f.id?'#1FD760':'#8FB897',fontFamily:'Nunito'}}>
              {f.l}
            </button>
          ))}
        </div>
      </div>

      <div style={{padding:'0 18px 20px',display:'flex',flexDirection:'column',gap:12}}>
        {filtered.map((o,i)=>{
          const s = SC[o.status]||SC.delivered;
          return (
            <div key={o.id} style={{background:'#091508',border:`1.5px solid ${o.status==='new'?'rgba(255,69,69,.4)':o.status==='ready'?'rgba(31,215,96,.4)':'#162B1A'}`,borderRadius:18,overflow:'hidden',animation:`fadeUp .4s ease ${i*.06}s both`}}>
              {/* Status header */}
              <div style={{padding:'10px 16px',background:o.status==='new'?'rgba(255,69,69,.08)':o.status==='ready'?'rgba(31,215,96,.08)':'rgba(255,184,0,.06)',borderBottom:'1px solid #162B1A',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div style={{display:'flex',alignItems:'center',gap:7}}>
                  <div style={{width:8,height:8,borderRadius:'50%',background:s.c,animation:o.status!=='delivered'?'pulse 1.5s infinite':'none'}}/>
                  <span style={{fontSize:12,fontWeight:800,color:s.c}}>{s.l}</span>
                </div>
                <span style={{fontSize:11,color:'#3D6645'}}>{o.time}</span>
              </div>

              <div style={{padding:'14px 16px'}}>
                {/* Client info */}
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
                  <div>
                    <div style={{fontFamily:'Unbounded',fontSize:13,fontWeight:800}}>{o.id}</div>
                    <div style={{fontSize:13,fontWeight:700,marginTop:2}}>{o.client}</div>
                    <div style={{fontSize:11,color:'#8FB897',marginTop:1}}>{o.phone}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontFamily:'Unbounded',fontSize:18,fontWeight:900}}>{o.total} <span style={{fontSize:12,color:'#FFB800'}}>ЅМ</span></div>
                    <div style={{fontSize:11,color:'#8FB897',marginTop:2}}>📍 {o.addr}</div>
                  </div>
                </div>

                {/* Items */}
                <div style={{background:'#0C1C0F',borderRadius:12,padding:'10px 13px',marginBottom:o.comment?10:12}}>
                  {o.items.map((it,j)=>(
                    <div key={j} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 0',borderBottom:j<o.items.length-1?'1px solid #162B1A':'none'}}>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <span style={{fontSize:18,width:24}}>{it.e}</span>
                        <span style={{fontSize:13,fontWeight:600}}>{it.name}</span>
                        <span style={{fontSize:11,color:'#3D6645'}}>× {it.qty}</span>
                      </div>
                      <span style={{fontSize:12,fontWeight:700,color:'#FFB800',fontFamily:'Unbounded'}}>{(it.price*it.qty)} ЅМ</span>
                    </div>
                  ))}
                </div>

                {/* Comment */}
                {o.comment&&(
                  <div style={{padding:'8px 12px',borderRadius:10,background:'rgba(255,184,0,.06)',border:'1px solid rgba(255,184,0,.2)',fontSize:12,color:'#FFB800',marginBottom:12}}>
                    💬 {o.comment}
                  </div>
                )}

                {/* Action buttons */}
                {s.next&&(
                  <div style={{display:'flex',gap:8}}>
                    <button onClick={()=>onUpdate(o.id,s.next)} className="btn"
                      style={{flex:1,padding:'12px',borderRadius:13,background:o.status==='new'?'linear-gradient(135deg,#17B34E,#1FD760)':o.status==='cooking'?'linear-gradient(135deg,#CC9400,#FFB800)':'linear-gradient(135deg,#17B34E,#1FD760)',border:'none',color:o.status==='cooking'?'#030B05':'white',fontFamily:'Nunito',fontWeight:700,fontSize:13}}>
                      {s.nextL}
                    </button>
                    {o.status==='new'&&(
                      <button onClick={()=>onUpdate(o.id,'delivered')} className="btn" style={{width:44,height:44,borderRadius:11,background:'rgba(255,69,69,.1)',border:'1px solid rgba(255,69,69,.3)',color:'#FF4545',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>✕</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length===0&&(
          <div style={{textAlign:'center',paddingTop:40}}>
            <div style={{fontSize:48,marginBottom:12}}>📭</div>
            <div style={{fontFamily:'Unbounded',fontSize:16,fontWeight:800,marginBottom:6}}>Заказов нет</div>
            <div style={{fontSize:12,color:'#8FB897'}}>{filter==='active'?'Все заказы выполнены!':'Ещё нет доставленных заказов'}</div>
          </div>
        )}
      </div>

      <BottomNav page="orders" onPage={onPage} newOrders={orders.filter(o=>o.status==='new').length}/>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   МЕНЮ
══════════════════════════════════════════════════════ */
function MenuPage({rest, menu, onToggle, onAdd, onRemove, onPage}) {
  const [activeCat, setActiveCat] = useState(rest?.categories[0]||'');
  const [showAdd,   setShowAdd]   = useState(false);
  const [editItem,  setEditItem]  = useState(null);
  const [name,      setName]      = useState('');
  const [price,     setPrice]     = useState('');
  const [desc,      setDesc]      = useState('');
  const [cat,       setCat]       = useState(rest?.categories[0]||'');
  const [emoji,     setEmoji]     = useState('🍽');

  const catMenu = menu.filter(m=>m.cat===activeCat);
  const stopCount = menu.filter(m=>!m.inStock).length;

  const save = () => {
    if(!name||!price) return;
    onAdd({e:emoji,name,desc,price:Number(price),cat,inStock:true,popular:false});
    setShowAdd(false); setName(''); setPrice(''); setDesc(''); setEmoji('🍽');
  };

  return (
    <div style={{minHeight:'100vh',background:'#030B05',paddingBottom:90}}>
      <Header rest={rest} isOpen={true} setIsOpen={()=>{}} onPage={onPage} showBack backPage="dashboard" title="Управление меню"/>

      {/* Stop-list alert */}
      {stopCount>0&&(
        <div style={{margin:'14px 18px 0',padding:'11px 14px',borderRadius:13,background:'rgba(255,69,69,.07)',border:'1px solid rgba(255,69,69,.25)',display:'flex',alignItems:'center',gap:10}}>
          <span style={{fontSize:20}}>⚠️</span>
          <div style={{flex:1}}>
            <span style={{fontSize:13,fontWeight:700,color:'#FF4545'}}>Стоп-лист: {stopCount} блюд</span>
            <div style={{fontSize:11,color:'#8FB897',marginTop:1}}>Клиенты не могут заказать эти блюда</div>
          </div>
        </div>
      )}

      {/* Category tabs */}
      <div style={{padding:'14px 18px 0'}}>
        <div className="hscroll" style={{gap:6,marginBottom:14}}>
          {(rest?.categories||[]).map(c=>(
            <button key={c} onClick={()=>setActiveCat(c)} className="btn"
              style={{padding:'8px 15px',borderRadius:50,fontSize:12,fontWeight:700,border:`1.5px solid ${activeCat===c?'rgba(31,215,96,.38)':'#162B1A'}`,background:activeCat===c?'rgba(31,215,96,.12)':'#0C1C0F',color:activeCat===c?'#1FD760':'#8FB897',whiteSpace:'nowrap',fontFamily:'Nunito'}}>
              {c} ({menu.filter(m=>m.cat===c).length})
            </button>
          ))}
        </div>
      </div>

      <div style={{padding:'0 18px 20px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <div style={{fontSize:13,fontWeight:700,color:'#8FB897'}}>{activeCat} · {catMenu.length} блюд</div>
          <button onClick={()=>{setCat(activeCat);setShowAdd(true);}} className="btn" style={{padding:'8px 14px',borderRadius:11,background:'linear-gradient(135deg,#17B34E,#1FD760)',border:'none',color:'#030B05',fontFamily:'Nunito',fontWeight:700,fontSize:12}}>
            + Добавить блюдо
          </button>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {catMenu.map((item,i)=>(
            <div key={item.id} style={{display:'flex',gap:12,padding:'13px 14px',background:'#091508',border:`1.5px solid ${item.inStock?'#162B1A':'rgba(255,69,69,.3)'}`,borderRadius:15,animation:`fadeUp .35s ease ${i*.05}s both`,opacity:item.inStock?1:.7}}>
              <div style={{width:58,height:58,borderRadius:14,background:'#0C1C0F',display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,flexShrink:0,position:'relative'}}>
                {item.e}
                {!item.inStock&&<div style={{position:'absolute',inset:0,borderRadius:14,background:'rgba(0,0,0,.6)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:800,color:'#FF4545'}}>СТОП</div>}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:800,marginBottom:2}}>{item.name}</div>
                <div style={{fontSize:11,color:'#3D6645',marginBottom:5,lineHeight:1.4}}>{item.desc}</div>
                <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:900}}>{item.price}<span style={{fontSize:10,color:'#FFB800',marginLeft:2}}>ЅМ</span></div>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:7,alignItems:'flex-end'}}>
                <button onClick={()=>onToggle(item.id)} className="btn"
                  style={{padding:'5px 11px',borderRadius:9,fontSize:11,fontWeight:700,background:item.inStock?'rgba(31,215,96,.12)':'rgba(255,69,69,.12)',color:item.inStock?'#1FD760':'#FF4545',border:`1px solid ${item.inStock?'rgba(31,215,96,.3)':'rgba(255,69,69,.3)'}`}}>
                  {item.inStock?'✓ Есть':'✕ Стоп'}
                </button>
                <button onClick={()=>onRemove(item.id)} className="btn" style={{padding:'4px 10px',borderRadius:8,fontSize:11,background:'rgba(255,69,69,.08)',border:'1px solid rgba(255,69,69,.25)',color:'#FF4545'}}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add modal */}
      {showAdd&&(
        <div style={{position:'fixed',inset:0,zIndex:300,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
          <div onClick={()=>setShowAdd(false)} style={{position:'absolute',inset:0,background:'rgba(0,0,0,.85)',backdropFilter:'blur(10px)'}}/>
          <div style={{position:'relative',zIndex:1,width:'100%',maxWidth:480,background:'#06100A',borderTop:'1px solid #162B1A',borderRadius:'24px 24px 0 0',padding:'20px 20px 44px',animation:'slideUp .4s cubic-bezier(.16,1,.3,1)'}}>
            <div style={{width:40,height:4,borderRadius:2,background:'#1D3822',margin:'0 auto 18px'}}/>
            <div style={{fontFamily:'Unbounded',fontSize:15,fontWeight:800,marginBottom:16}}>Добавить блюдо</div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div style={{display:'grid',gridTemplateColumns:'72px 1fr',gap:10}}>
                <div>
                  <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Emoji</div>
                  <input className="inp" value={emoji} onChange={e=>setEmoji(e.target.value)} style={{textAlign:'center',fontSize:26,height:50}}/>
                </div>
                <div>
                  <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Название *</div>
                  <input className="inp" value={name} onChange={e=>setName(e.target.value)} placeholder="Название блюда"/>
                </div>
              </div>
              <div>
                <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Состав / описание</div>
                <input className="inp" value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Граммовка, состав, особенности..."/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div>
                  <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Цена (ЅМ) *</div>
                  <input className="inp" value={price} onChange={e=>setPrice(e.target.value)} type="number" placeholder="0"/>
                </div>
                <div>
                  <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Раздел меню</div>
                  <select className="inp" value={cat} onChange={e=>setCat(e.target.value)} style={{cursor:'pointer'}}>
                    {(rest?.categories||[]).map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <button onClick={save} className="btn" style={{padding:14,borderRadius:14,background:'linear-gradient(135deg,#17B34E,#1FD760)',border:'none',color:'#030B05',fontFamily:'Nunito',fontWeight:800,fontSize:14,opacity:name&&price?1:.5}}>
                ✓ Добавить в меню
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNav page="menu" onPage={onPage} newOrders={0}/>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   СТАТИСТИКА
══════════════════════════════════════════════════════ */
function StatsPage({rest, orders, onPage}) {
  const delivered = orders.filter(o=>o.status==='delivered');
  const revenue   = delivered.reduce((s,o)=>s+o.total,0);
  const commission= Math.round(revenue*rest?.commission/100);
  const myShare   = revenue - commission;

  const topDishes = {};
  delivered.forEach(o=>o.items.forEach(it=>{
    topDishes[it.name] = (topDishes[it.name]||0) + it.qty;
  }));
  const top = Object.entries(topDishes).sort((a,b)=>b[1]-a[1]).slice(0,5);

  const WEEK = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  const weekData = WEEK.map((_,i)=>Math.round(revenue/7*(0.7+Math.random()*0.6)));
  const maxW = Math.max(...weekData);

  return (
    <div style={{minHeight:'100vh',background:'#030B05',paddingBottom:90}}>
      <Header rest={rest} isOpen={true} setIsOpen={()=>{}} onPage={onPage} showBack backPage="dashboard" title="Статистика"/>

      <div style={{padding:'16px 18px'}}>
        {/* Revenue summary */}
        <div style={{background:'linear-gradient(135deg,#071A0A,#0F3018)',border:'1px solid rgba(31,215,96,.2)',borderRadius:18,padding:'20px',marginBottom:16}}>
          <div style={{fontSize:11,color:'#8FB897',marginBottom:6}}>Выручка за сегодня</div>
          <div style={{fontFamily:'Unbounded',fontSize:32,fontWeight:900,color:'#1FD760',marginBottom:14}}>{revenue} <span style={{fontSize:16,color:'#FFB800'}}>ЅМ</span></div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div style={{background:'rgba(31,215,96,.08)',borderRadius:12,padding:'12px',border:'1px solid rgba(31,215,96,.2)'}}>
              <div style={{fontSize:10,color:'#3D6645',marginBottom:4}}>Ваш доход</div>
              <div style={{fontFamily:'Unbounded',fontSize:18,fontWeight:900,color:'#1FD760'}}>{myShare} ЅМ</div>
            </div>
            <div style={{background:'rgba(255,69,69,.08)',borderRadius:12,padding:'12px',border:'1px solid rgba(255,69,69,.2)'}}>
              <div style={{fontSize:10,color:'#3D6645',marginBottom:4}}>Комиссия KAKAPO {rest?.commission}%</div>
              <div style={{fontFamily:'Unbounded',fontSize:18,fontWeight:900,color:'#FF4545'}}>{commission} ЅМ</div>
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:16}}>
          {[
            {l:'Заказов',v:delivered.length,c:'#3B8EF0'},
            {l:'Ср. чек', v:`${delivered.length?Math.round(revenue/delivered.length):0} ЅМ`,c:'#FFB800'},
            {l:'Рейтинг', v:`★ ${rest?.rating}`,c:'#FFB800'},
          ].map((s,i)=>(
            <div key={i} style={{background:'#091508',border:'1px solid #162B1A',borderRadius:14,padding:'13px 10px',textAlign:'center'}}>
              <div style={{fontFamily:'Unbounded',fontSize:17,fontWeight:900,color:s.c,marginBottom:3}}>{s.v}</div>
              <div style={{fontSize:10,color:'#3D6645'}}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* Week chart */}
        <div style={{background:'#091508',border:'1px solid #162B1A',borderRadius:18,padding:'18px',marginBottom:16}}>
          <div style={{fontFamily:'Unbounded',fontSize:13,fontWeight:800,marginBottom:16}}>Выручка за неделю</div>
          <div style={{display:'flex',gap:6,alignItems:'flex-end',height:100}}>
            {weekData.map((v,i)=>(
              <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
                <div style={{fontSize:9,color:'#FFB800',fontWeight:700}}>{v}</div>
                <div style={{width:'100%',borderRadius:'4px 4px 0 0',background:'linear-gradient(180deg,#1FD760,#17B34E)',height:`${Math.round((v/maxW)*80)}px`,transition:'height .5s ease'}}/>
                <div style={{fontSize:9,color:'#3D6645'}}>{WEEK[i]}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Top dishes */}
        <div style={{background:'#091508',border:'1px solid #162B1A',borderRadius:18,padding:'18px'}}>
          <div style={{fontFamily:'Unbounded',fontSize:13,fontWeight:800,marginBottom:14}}>Топ блюда</div>
          {top.map(([name,qty],i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 0',borderBottom:i<top.length-1?'1px solid #162B1A':'none'}}>
              <div style={{width:24,height:24,borderRadius:'50%',background:'rgba(255,184,0,.12)',border:'1px solid rgba(255,184,0,.25)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:10,fontWeight:900,color:'#FFB800',flexShrink:0}}>{i+1}</div>
              <span style={{flex:1,fontSize:13,fontWeight:600}}>{name}</span>
              <span style={{fontFamily:'Unbounded',fontSize:12,fontWeight:700,color:'#1FD760'}}>{qty} шт</span>
            </div>
          ))}
        </div>
      </div>

      <BottomNav page="stats" onPage={onPage} newOrders={0}/>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   НАСТРОЙКИ
══════════════════════════════════════════════════════ */
function SettingsPage({rest, isOpen, setIsOpen, onPage, onLogout}) {
  const [notifs, setNotifs] = useState(true);
  const [sound,  setSound]  = useState(true);

  const Tog = ({on,set}) => (
    <div onClick={()=>set(v=>!v)} style={{width:44,height:24,borderRadius:12,background:on?'#1FD760':'#1D3822',position:'relative',cursor:'pointer',transition:'background .2s',flexShrink:0}}>
      <div style={{position:'absolute',top:3,left:on?23:3,width:18,height:18,borderRadius:'50%',background:'white',transition:'left .2s'}}/>
    </div>
  );

  return (
    <div style={{minHeight:'100vh',background:'#030B05',paddingBottom:90}}>
      <Header rest={rest} isOpen={isOpen} setIsOpen={setIsOpen} onPage={onPage} showBack backPage="dashboard" title="Настройки"/>

      <div style={{padding:'16px 18px',display:'flex',flexDirection:'column',gap:12}}>
        {/* Restaurant status */}
        <div style={{background:'#091508',border:'1px solid #162B1A',borderRadius:16,padding:'16px'}}>
          <div style={{fontFamily:'Unbounded',fontSize:13,fontWeight:800,marginBottom:14}}>Статус ресторана</div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 14px',borderRadius:13,background:isOpen?'rgba(31,215,96,.06)':'rgba(255,69,69,.06)',border:`1px solid ${isOpen?'rgba(31,215,96,.2)':'rgba(255,69,69,.2)'}`}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:isOpen?'#1FD760':'#FF4545'}}>{isOpen?'🟢 Ресторан открыт':'🔴 Ресторан закрыт'}</div>
              <div style={{fontSize:11,color:'#8FB897',marginTop:2}}>{isOpen?'Клиенты могут делать заказы':'Заказы не принимаются'}</div>
            </div>
            <Tog on={isOpen} set={setIsOpen}/>
          </div>
          <div style={{fontSize:11,color:'#3D6645',marginTop:8}}>Режим работы: {rest?.hours?.open} – {rest?.hours?.close}</div>
        </div>

        {/* Restaurant info */}
        <div style={{background:'#091508',border:'1px solid #162B1A',borderRadius:16,padding:'16px'}}>
          <div style={{fontFamily:'Unbounded',fontSize:13,fontWeight:800,marginBottom:14}}>Информация о ресторане</div>
          {[
            {l:'Название',   v:rest?.name},
            {l:'Кухня',      v:rest?.cuisine},
            {l:'Адрес',      v:rest?.address},
            {l:'Телефон',    v:rest?.phone},
            {l:'Email',      v:rest?.email},
          ].map((r,i,arr)=>(
            <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'10px 0',borderBottom:i<arr.length-1?'1px solid #162B1A':'none'}}>
              <span style={{fontSize:12,color:'#8FB897'}}>{r.l}</span>
              <span style={{fontSize:12,fontWeight:700,maxWidth:200,textAlign:'right'}}>{r.v}</span>
            </div>
          ))}
        </div>

        {/* Notifications */}
        <div style={{background:'#091508',border:'1px solid #162B1A',borderRadius:16,padding:'16px'}}>
          <div style={{fontFamily:'Unbounded',fontSize:13,fontWeight:800,marginBottom:14}}>Уведомления</div>
          {[
            {l:'Push при новом заказе', on:notifs, set:setNotifs},
            {l:'Звук при новом заказе', on:sound,  set:setSound},
          ].map((r,i,arr)=>(
            <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'11px 0',borderBottom:i<arr.length-1?'1px solid #162B1A':'none'}}>
              <span style={{fontSize:13,fontWeight:600}}>{r.l}</span>
              <Tog on={r.on} set={r.set}/>
            </div>
          ))}
        </div>

        {/* Contract info */}
        <div style={{background:'rgba(255,69,69,.06)',border:'1px solid rgba(255,69,69,.2)',borderRadius:16,padding:'16px'}}>
          <div style={{fontFamily:'Unbounded',fontSize:13,fontWeight:800,color:'#FF4545',marginBottom:10}}>Условия договора</div>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
            <span style={{fontSize:12,color:'#8FB897'}}>Комиссия KAKAPO</span>
            <span style={{fontSize:13,fontWeight:800,color:'#FF4545'}}>{rest?.commission}%</span>
          </div>
          <div style={{fontSize:11,color:'#3D6645',lineHeight:1.6}}>
            С каждого заказа KAKAPO удерживает {rest?.commission}% как комиссию за платформу, маркетинг и доставку. Вопросы: +992 118 55-97-97
          </div>
        </div>

        {/* Logout */}
        <button onClick={onLogout} className="btn" style={{padding:'14px',borderRadius:14,background:'rgba(255,69,69,.1)',border:'1.5px solid rgba(255,69,69,.3)',color:'#FF4545',fontFamily:'Nunito',fontWeight:700,fontSize:14}}>
          🚪 Выйти из кабинета
        </button>
      </div>

      <BottomNav page="settings" onPage={onPage} newOrders={0}/>
    </div>
  );
}
