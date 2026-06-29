'use client'
import { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react'
import { useOrders, useProducts, USE_API } from '@/lib/store'
import { mapOrdersForAssembler, mapCancelledOrdersForAssembler, mapSingleOrderForAssembler, buildAdminStatusPatch, isAssemblerCancelledVisible } from '@/lib/orderUiMap'
import { getMarketStatus, getPendingPartsForCourier, isMixedOrder, normalizeOrder } from '@/lib/orderParts'
import { ASSEMBLER_NAME } from '@/lib/courierStats'
import { useAppNavigation } from '@/lib/useAppNavigation'
import { useApiSync } from '@/lib/useApiSync'
import AppNavigationBoundary from '@/components/shared/AppNavigationBoundary'
import Link from 'next/link'
import AssemblerLoginPage from '@/components/assembler/AssemblerLoginPage'
import { useAssemblerTeam, hydrateAssemblerTeamStore, useAssemblerTeamStore } from '@/lib/assemblerTeamStore'
import type { AdminAssembler } from '@/lib/assemblerTeam'
import type { Product } from '@/lib/types'
import { canAssemblerSeeOrder, isAssemblerOrderClaimed, orderHasAssemblerAssignment } from '@/lib/assemblerTeam'
import { loadAssemblerSession, saveAssemblerSession, clearAssemblerSession, type AssemblerSession } from '@/lib/assemblerSession'
// ─── КАКАПО Assembler App ────────────────────────
/* ══════════════════════════════════════════════════════
   КАКАПО СБОРЩИК — Приложение для сборки заказов
   г. Яван, Таджикистан · PIN: 5678
══════════════════════════════════════════════════════ */
// React hooks imported above

const DISMISSED_KEY = 'kakapo-assembler-dismissed';

function loadDismissedCancelled(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = sessionStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveDismissedCancelled(ids: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch { /* private mode */ }
}

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
    id:'K-4832', time:'14:23', priority:'urgent', queue:'pool', claimed:false,
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
    id:'K-4829', time:'13:55', priority:'normal', queue:'pool', claimed:false,
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
    id:'K-4825', time:'13:20', priority:'normal', queue:'assembling', claimed:true, claimedBy:'Камола Юсупова',
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

function AssemblerSessionBoot() {
  return (
    <div style={{ minHeight: '100vh', background: '#030B05', maxWidth: 480, margin: '0 auto' }} />
  );
}

function AssemblerAppInner() {
  useApiSync('assembler');
  const assemblers = useAssemblerTeam();
  const teamApiReady = useAssemblerTeamStore(s => s.apiReady);
  const [session, setSession] = useState<AssemblerSession | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [dismissedCancelled, setDismissedCancelled] = useState<Set<string>>(() => new Set());
  const [demoClaims, setDemoClaims] = useState<Record<string, string>>({});
  const [demoEdits, setDemoEdits] = useState<Record<string, { items: typeof ORDERS_DATA[0]['items']; assemblerNote?: string }>>({});

  useLayoutEffect(() => {
    setSession(loadAssemblerSession());
    setSessionReady(true);
    hydrateAssemblerTeamStore();
  }, []);

  const assemblerProfile = useMemo((): AdminAssembler | null => {
    if (!session) return null;
    const byId = assemblers.find(a => a.id === session.assemblerId);
    const byName = assemblers.find(a => a.name === session.name);
    return byId || byName || null;
  }, [assemblers, session]);

  const assemblerName = assemblerProfile?.name ?? session?.name ?? ASSEMBLER_NAME;
  const { page, navigate, params } = useAppNavigation('dashboard');
  const setPage = (p: string) => navigate(p);
  const apiOrders = useOrders(s => s.orders);
  const updateStatus = useOrders(s => s.updateStatus);
  const startMarketPart = useOrders(s => s.startMarketPart);
  const completeMarketPart = useOrders(s => s.completeMarketPart);
  const acceptAssemblerOrder = useOrders(s => s.acceptAssemblerOrder);
  const toggleItemStore = useOrders(s => s.toggleItem);
  const updateOrderItemsStore = useOrders(s => s.updateOrderItems);
  const mapped = useMemo(() => {
    if (!assemblerProfile) return [];
    if (USE_API) {
      return mapOrdersForAssembler(apiOrders).filter(o => {
        const raw = apiOrders.find(r => r.id === o.id);
        return raw && canAssemblerSeeOrder(normalizeOrder(raw), assemblerProfile);
      });
    }
    return ORDERS_DATA.map(o => {
      const claimedBy = demoClaims[o.id] || o.claimedBy;
      const claimed = !!claimedBy || o.claimed;
      const queue = !claimed ? 'pool' as const : (o.queue === 'pool' || o.queue === 'new' ? 'accepted' as const : o.queue);
      const edit = demoEdits[o.id];
      return {
        ...o,
        ...(edit ? { items: edit.items, assemblerNote: edit.assemblerNote || '' } : {}),
        claimed,
        claimedBy,
        queue,
      };
    }).filter(o => !o.claimed || o.claimedBy === assemblerName);
  }, [apiOrders, assemblerProfile, assemblerName, demoClaims, demoEdits]);
  const cancelledOrders = useMemo(() => {
    if (!USE_API || !assemblerProfile) return [];
    return mapCancelledOrdersForAssembler(apiOrders)
      .filter(o => {
        const raw = apiOrders.find(r => r.id === o.id);
        return raw && canAssemblerSeeOrder(normalizeOrder(raw), assemblerProfile);
      })
      .filter(o => !dismissedCancelled.has(o.id));
  }, [apiOrders, assemblerProfile, dismissedCancelled]);
  const collectIdRef = useRef<string | null>(null);
  const activeOrderId = page === 'collect'
    ? (params.order || collectIdRef.current || null)
    : null;

  useEffect(() => {
    setDismissedCancelled(loadDismissedCancelled());
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
    if (isAssemblerCancelledVisible(raw)) return mapSingleOrderForAssembler(raw);
    const mappedOne = mapOrdersForAssembler([raw]);
    return mappedOne[0] ?? null;
  }, [activeOrderId, mapped, apiOrders]);

  const dismissCancel = (orderId: string) => {
    setDismissedCancelled(prev => {
      const next = new Set([...prev, orderId]);
      saveDismissedCancelled(next);
      return next;
    });
    if (page === 'collect') navigate('dashboard');
  };

  const cancelOrder = async (orderId: string, reason: string) => {
    if (!window.confirm(`Отменить заказ ${orderId}?\n\n${reason}`)) return;
    const raw = apiOrders.find(o => o.id === orderId);
    if (!raw) return;
    const patch = buildAdminStatusPatch(normalizeOrder(raw), 'cancelled');
    const { adminOverride: _ao, ...fields } = patch;
    await updateStatus(orderId, 'cancelled', {
      ...fields,
      cancelReason: reason,
      assembler: { name: assemblerName },
    });
    if (page === 'collect') navigate('dashboard');
  };

  const acceptOrder = async (id: string) => {
    if (!assemblerProfile) return;
    if (!USE_API) {
      const demo = ORDERS_DATA.find(o => o.id === id);
      if (demo?.claimed && demo.claimedBy !== assemblerName) {
        window.alert('Заказ уже принят другим сборщиком');
        return;
      }
      setDemoClaims(prev => ({ ...prev, [id]: assemblerName }));
      return;
    }
    const result = await acceptAssemblerOrder(id, { name: assemblerName, id: assemblerProfile.id });
    if (!result.ok) {
      window.alert(result.error);
    }
  };

  const openCollect = (id: string) => {
    const raw = apiOrders.find(o => o.id === id);
    if (USE_API && raw && assemblerProfile) {
      const order = normalizeOrder(raw);
      if (!isAssemblerOrderClaimed(order)) {
        window.alert('Сначала примите заказ');
        return;
      }
      if (!orderHasAssemblerAssignment(order, assemblerProfile)) {
        window.alert('Этот заказ принят другим сборщиком');
        return;
      }
      if (isMixedOrder(order)) {
        if (getMarketStatus(order) === 'new') void startMarketPart(id);
      } else if (order.status === 'new') {
        void updateStatus(id, 'assembling');
      }
    }
    if (!USE_API) {
      const demo = ORDERS_DATA.find(o => o.id === id);
      const claimedBy = demoClaims[id] || demo?.claimedBy;
      if (!claimedBy) {
        window.alert('Сначала примите заказ');
        return;
      }
      if (claimedBy !== assemblerName) {
        window.alert('Этот заказ принят другим сборщиком');
        return;
      }
    }
    collectIdRef.current = id;
    navigate('collect', { order: id });
  };

  const toggleItem = (orderId: string, itemId: number) => {
    void toggleItemStore(orderId, itemId);
  };

  const updateOrderItems = async (orderId: string, items: import('@/lib/types').Order['items'], note?: string) => {
    if (!USE_API) {
      setDemoEdits(prev => ({
        ...prev,
        [orderId]: { items: items as typeof ORDERS_DATA[0]['items'], assemblerNote: note },
      }));
      return;
    }
    await updateOrderItemsStore(orderId, items, note ? { assemblerNote: note } : undefined);
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

  const handoffToCourier = async (orderId: string) => {
    const raw = apiOrders.find(o => o.id === orderId);
    if (!raw) return;
    const order = normalizeOrder(raw);
    const pickedUpIds = [...new Set([...(order.pickedUpIds || []), 'store'])];
    const nextStatus = getPendingPartsForCourier(order).length > 0 ? 'courier_picked' : 'delivering';
    await updateStatus(orderId, nextStatus, { pickedUpIds });
    if (page === 'collect') navigate('dashboard');
  };

  const pending = mapped;

  const completedCount = useMemo(() => apiOrders.filter(o => {
    if (!assemblerProfile || !orderHasAssemblerAssignment(normalizeOrder(o), assemblerProfile)) return false
    const order = normalizeOrder(o)
    if (isMixedOrder(order)) return getMarketStatus(order) === 'done'
    return order.type === 'market' && ['assembler_done', 'courier_picked', 'delivering', 'delivered'].includes(order.status)
  }).length, [apiOrders, assemblerProfile]);

  const logout = () => {
    clearAssemblerSession();
    setSession(null);
    navigate('dashboard');
  };

  if (!sessionReady || (session && !assemblerProfile && !teamApiReady)) {
    return (
      <>
        <style>{CSS}</style>
        <AssemblerSessionBoot />
      </>
    );
  }

  if (!session || !assemblerProfile || assemblerProfile.blocked) {
    if (session && assemblerProfile?.blocked) clearAssemblerSession();
    return (
      <>
        <style>{CSS}</style>
        <AssemblerLoginPage
          assemblers={assemblers}
          onSuccess={a => {
            const next = { assemblerId: a.id, name: a.name };
            saveAssemblerSession(next);
            setSession(next);
          }}
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
        onHandoff={handoffToCourier}
        onBack={() => navigate('dashboard')}
        onLogout={logout}
        onCancel={() => cancelOrder(activeOrderId, 'Отменено сборщиком')}
        onAcknowledgeCancel={() => dismissCancel(activeOrderId)}
        onUpdateItems={updateOrderItems}
      />
    );
  }

  return (
    <>
      <style>{CSS}</style>
      <div style={{maxWidth:480,margin:'0 auto',minHeight:'100dvh',background:'#030B05'}}>
        {page==='dashboard' && (
          <DashboardPage
            orders={pending}
            cancelledOrders={cancelledOrders}
            completed={completedCount}
            onStart={openCollect}
            onAccept={acceptOrder}
            onHandoff={handoffToCourier}
            onPage={setPage}
            assemblerName={assemblerName}
            onLogout={logout}
            onAcknowledgeCancel={dismissCancel}
          />
        )}
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
function DashboardPage({orders, cancelledOrders, completed, onStart, onAccept, onHandoff, onPage, assemblerName, onLogout, onAcknowledgeCancel}) {
  const poolQueue = orders.filter(o => o.queue === 'pool' || !o.claimed);
  const myQueue = orders.filter(o => o.claimed && o.queue !== 'pool');
  const urgentPool = poolQueue.filter(o => o.priority === 'urgent');
  const normalPool = poolQueue.filter(o => o.priority !== 'urgent');
  const urgentMy = myQueue.filter(o => o.priority === 'urgent');
  const normalMy = myQueue.filter(o => o.priority !== 'urgent');

  const PCard = ({order, i, isPool, isCancelled}) => {
    const doneCount = order.items.filter(it=>it.done).length;
    const pct = order.items.length ? Math.round(doneCount/order.items.length*100) : 0;
    const isAccepted = order.queue === 'accepted';
    const isReady = order.queue === 'ready';
    const isCourierAssigned = order.queue === 'courier_assigned';
    const isAssembling = !isPool && !isReady && !isCourierAssigned && !isCancelled;
    const courierName = order.courier?.name && order.courier.name !== '—' ? order.courier.name : null;
    return (
      <div className="card" style={{
        overflow:'hidden',
        animation:isPool ? `fadeUp .45s cubic-bezier(.16,1,.3,1) ${i*.08}s both` : undefined,
        border: isCancelled ? '1px solid rgba(255,69,69,.35)' : undefined,
        opacity: isCancelled ? .92 : 1,
      }}>
        {isCancelled && (
          <div style={{padding:'7px 16px',background:'rgba(255,69,69,.1)',borderBottom:'1px solid rgba(255,69,69,.25)',display:'flex',alignItems:'center',gap:7}}>
            <span style={{fontSize:11,fontWeight:800,color:'#FF4545'}}>✕ Заказ отменён клиентом</span>
          </div>
        )}
        {/* Priority banner */}
        {order.priority==='urgent'&&(
          <div style={{padding:'7px 16px',background:'rgba(255,69,69,.09)',borderBottom:'1px solid rgba(255,69,69,.2)',display:'flex',alignItems:'center',gap:7}}>
            <div style={{width:6,height:6,borderRadius:'50%',background:'#FF4545',flexShrink:0,position:'relative'}}>
              <div style={{position:'absolute',inset:0,borderRadius:'50%',background:'#FF4545',animation:'ping 1.5s ease-out infinite',opacity:.5}}/>
            </div>
            <span style={{fontSize:11,fontWeight:800,color:'#FF4545'}}>⚡ Срочно — курьер ждёт</span>
          </div>
        )}
        {isPool && order.priority !== 'urgent' && (
          <div style={{padding:'7px 16px',background:'rgba(255,69,69,.08)',borderBottom:'1px solid rgba(255,69,69,.18)',display:'flex',alignItems:'center',gap:7}}>
            <span style={{fontSize:11,fontWeight:800,color:'#FF4545'}}>🆕 Новый заказ · свободен</span>
          </div>
        )}
        {!isPool && !isCancelled && !isReady && !isCourierAssigned && (
          <div style={{padding:'7px 16px',background:'rgba(155,109,255,.08)',borderBottom:'1px solid rgba(155,109,255,.18)',display:'flex',alignItems:'center',gap:7}}>
            <span style={{fontSize:11,fontWeight:800,color:'#9B6DFF'}}>✓ Принят · {order.claimedBy || assemblerName}</span>
          </div>
        )}
        {isReady && (
          <div style={{padding:'7px 16px',background:'rgba(31,215,96,.08)',borderBottom:'1px solid rgba(31,215,96,.2)',display:'flex',alignItems:'center',gap:7}}>
            <span style={{fontSize:11,fontWeight:800,color:'#1FD760'}}>✅ Заказ готов · ждёт курьера</span>
          </div>
        )}
        {isCourierAssigned && (
          <div style={{padding:'7px 16px',background:'rgba(59,142,240,.08)',borderBottom:'1px solid rgba(59,142,240,.2)',display:'flex',alignItems:'center',gap:7}}>
            <span style={{fontSize:11,fontWeight:800,color:'#3B8EF0'}}>🛵 Курьер принял · передайте заказ</span>
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
          {isAssembling && pct>0&&(
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

          {isCancelled && order.cancelReason && (
            <div style={{padding:'8px 12px',borderRadius:10,background:'rgba(255,69,69,.06)',border:'1px solid rgba(255,69,69,.22)',fontSize:12,color:'#FF6969',marginBottom:12}}>
              ℹ️ {order.cancelReason}
            </div>
          )}

          {!isCancelled && (
          <>
          <div style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',borderRadius:11,background:'rgba(59,142,240,.07)',border:'1px solid rgba(59,142,240,.2)',marginBottom:12}}>
            <span style={{fontSize:16}}>🛵</span>
            <div style={{flex:1}}>
              {isCourierAssigned && courierName ? (
                <>
                  <div style={{fontSize:12,fontWeight:700,color:'#3B8EF0'}}>{courierName}</div>
                  <div style={{fontSize:10,color:'#3D6645'}}>{order.courier.phone || 'Курьер ждёт передачи заказа'}</div>
                </>
              ) : isReady ? (
                <>
                  <div style={{fontSize:12,fontWeight:700,color:'#3B8EF0'}}>Ожидаем курьера</div>
                  <div style={{fontSize:10,color:'#3D6645'}}>Заказ готов — курьер примет его в приложении</div>
                </>
              ) : (
                <>
                  <div style={{fontSize:12,fontWeight:700,color:'#3B8EF0'}}>Курьер примет заказ после сборки</div>
                  <div style={{fontSize:10,color:'#3D6645'}}>Сначала соберите товары — затем курьер сам возьмёт заказ в работу</div>
                </>
              )}
            </div>
          </div>

          {/* Action */}
          {isPool ? (
            <button type="button" onClick={() => onAccept(order.id)} className="btn"
              style={{width:'100%',padding:13,borderRadius:14,background:'linear-gradient(135deg,#17B34E,#1FD760)',border:'none',color:'#030B05',fontFamily:'Nunito',fontWeight:800,fontSize:14,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
              ✓ Принять заказ
            </button>
          ) : isCourierAssigned ? (
            <button type="button" onClick={() => onHandoff(order.id)} className="btn"
              style={{width:'100%',padding:13,borderRadius:14,background:'linear-gradient(135deg,#1E5BB5,#3B8EF0)',border:'none',color:'white',fontFamily:'Nunito',fontWeight:800,fontSize:14,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
              🛵 Забрал курьер
            </button>
          ) : isReady ? (
            <button type="button" onClick={() => onStart(order.id)} className="btn"
              style={{width:'100%',padding:13,borderRadius:14,background:'rgba(31,215,96,.12)',border:'1.5px solid rgba(31,215,96,.35)',color:'#1FD760',fontFamily:'Nunito',fontWeight:800,fontSize:14}}>
              👁 Открыть готовый заказ
            </button>
          ) : (
            <button onClick={()=>onStart(order.id)} className="btn"
              style={{width:'100%',padding:13,borderRadius:14,background:`linear-gradient(135deg,#6B3FD4,#9B6DFF)`,border:'none',color:'white',fontFamily:'Nunito',fontWeight:800,fontSize:14,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
              {isAccepted ? '▶ Начать сборку' : pct>0 ? `▶ Продолжить сборку (${doneCount}/${order.items.length})` : '▶ Продолжить сборку'}
            </button>
          )}
          </>
          )}

          {isCancelled && (
            <button type="button" onClick={() => onAcknowledgeCancel(order.id)} className="btn"
              style={{width:'100%',padding:13,borderRadius:14,background:'rgba(255,69,69,.12)',border:'1.5px solid rgba(255,69,69,.35)',color:'#FF6969',fontFamily:'Nunito',fontWeight:800,fontSize:14}}>
              ✓ Принять отмену — убрать из списка
            </button>
          )}
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

        {orders.length===0 && cancelledOrders.length===0 ?(
          <div style={{textAlign:'center',paddingTop:60,animation:'fadeIn .6s ease'}}>
            <div style={{fontSize:64,marginBottom:16,animation:'pulse 2s ease-in-out infinite'}}>🎉</div>
            <div style={{fontFamily:'Unbounded',fontSize:18,fontWeight:900,marginBottom:8,color:'#9B6DFF'}}>Все заказы собраны!</div>
            <div style={{fontSize:13,color:'#8FB897'}}>Ожидайте новых заказов</div>
          </div>
        ) : (
          <>
            {cancelledOrders.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontFamily:'Unbounded', fontSize:13, fontWeight:800, marginBottom:10, color:'#FF4545' }}>✕ Отменены ({cancelledOrders.length})</div>
                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                  {cancelledOrders.map((o, i) => <PCard key={o.id} order={o} i={i} isCancelled />)}
                </div>
              </div>
            )}
            {poolQueue.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontFamily:'Unbounded', fontSize:13, fontWeight:800, marginBottom:10, color:'#FF4545' }}>🆕 Свободные заказы ({poolQueue.length})</div>
                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                  {[...urgentPool, ...normalPool].map((o, i) => <PCard key={o.id} order={o} i={i} isPool />)}
                </div>
              </div>
            )}
            {myQueue.length > 0 && (
              <div>
                <div style={{ fontFamily:'Unbounded', fontSize:13, fontWeight:800, marginBottom:10, color:'#9B6DFF', marginTop: poolQueue.length ? 8 : 0 }}>📦 Мои заказы ({myQueue.length})</div>
                {urgentMy.length > 0 && (
                  <div style={{ marginBottom:12 }}>
                    <div style={{ fontSize:11, fontWeight:800, marginBottom:8, color:'#FF4545' }}>⚡ Срочные</div>
                    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                      {urgentMy.map((o, i) => <PCard key={o.id} order={o} i={i} />)}
                    </div>
                  </div>
                )}
                {normalMy.length > 0 && (
                  <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                    {normalMy.map((o, i) => <PCard key={o.id} order={o} i={i + urgentMy.length} />)}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <BottomNav page="dashboard" onPage={onPage} newCount={poolQueue.length}/>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   СБОРКА ЗАКАЗА
══════════════════════════════════════════════════════ */
function phoneHref(phone?: string) {
  if (!phone?.trim()) return null;
  const digits = phone.replace(/[^\d+]/g, '');
  return digits.length >= 9 ? `tel:${digits}` : null;
}

type EditOrderItem = {
  id: number
  product_id?: number
  art: string
  e: string
  name: string
  qty: number
  unit: string
  price: number
  done?: boolean
}

function productToEditItem(p: Product, qty = 1, id?: number): EditOrderItem {
  return {
    id: id ?? p.id,
    product_id: p.id,
    art: p.art,
    e: p.e,
    name: p.name,
    qty,
    unit: p.unit,
    price: p.price,
    done: false,
  };
}

function CollectPage({order, onToggle, onComplete, onHandoff, onBack, onLogout, onCancel, onAcknowledgeCancel, onUpdateItems}) {
  const products = useProducts(s => s.products);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editItems, setEditItems] = useState<EditOrderItem[]>(order.items);
  const [editNote, setEditNote] = useState(order.assemblerNote || '');
  const [saving, setSaving] = useState(false);
  const [pickerMode, setPickerMode] = useState<'add' | number | null>(null);
  const [productQuery, setProductQuery] = useState('');
  const doneCount = order.items.filter(it=>it.done).length;
  const allDone   = order.items.length > 0 && doneCount === order.items.length;
  const pct       = order.items.length ? Math.round(doneCount/order.items.length*100) : 0;
  const isCancelled = !!order.cancelled;
  const isReady = order.queue === 'ready';
  const isCourierAssigned = order.queue === 'courier_assigned';
  const isHandoffStage = isReady || isCourierAssigned;
  const courierName = order.courier?.name && order.courier.name !== '—' ? order.courier.name : null;
  const clientPhone = phoneHref(order.client.phone);
  const itemsTotal = order.items.reduce((s,it)=>s+it.price*it.qty,0);

  useEffect(() => {
    if (!showEdit) {
      setPickerMode(null);
      setProductQuery('');
    }
  }, [showEdit]);

  useEffect(() => {
    setEditItems(order.items);
    setEditNote(order.assemblerNote || '');
    setPickerMode(null);
    setProductQuery('');
  }, [order.id, order.items, order.assemblerNote]);

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    const list = products;
    if (!q) return list.slice(0, 24);
    return list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.art.toLowerCase().includes(q) ||
      p.cat.toLowerCase().includes(q)
    ).slice(0, 30);
  }, [products, productQuery]);

  const openAddPicker = () => {
    setPickerMode('add');
    setProductQuery('');
  };

  const openReplacePicker = (itemId: number) => {
    setPickerMode(itemId);
    setProductQuery('');
  };

  const closePicker = () => {
    setPickerMode(null);
    setProductQuery('');
  };

  const selectProduct = (p: Product) => {
    if (pickerMode === 'add') {
      setEditItems(prev => {
        const idx = prev.findIndex(it => it.id === p.id || it.art === p.art);
        if (idx >= 0) {
          return prev.map((it, i) => i === idx ? { ...it, qty: it.qty + 1, done: false } : it);
        }
        const nextId = prev.length ? Math.max(...prev.map(it => it.id)) + 1 : p.id;
        return [...prev, productToEditItem(p, 1, nextId)];
      });
    } else if (typeof pickerMode === 'number') {
      const old = editItems.find(it => it.id === pickerMode);
      setEditItems(prev => prev.map(it => {
        if (it.id !== pickerMode) return it;
        return { ...productToEditItem(p, old?.qty ?? 1, it.id), done: false };
      }));
    }
    closePicker();
  };

  const replaceTarget = typeof pickerMode === 'number'
    ? editItems.find(it => it.id === pickerMode)
    : null;

  const changeQty = (itemId: number, delta: number) => {
    setEditItems(prev => prev.map(it => {
      if (it.id !== itemId) return it;
      const qty = Math.max(0, it.qty + delta);
      return { ...it, qty };
    }));
  };

  const removeItem = (itemId: number) => {
    setEditItems(prev => prev.filter(it => it.id !== itemId));
  };

  const handleSaveEdit = async () => {
    const filtered = editItems.filter(it => it.qty > 0);
    if (!filtered.length) {
      window.alert('В заказе должен остаться хотя бы один товар');
      return;
    }
    setSaving(true);
    try {
      await onUpdateItems(order.id, filtered.map(it => ({
        ...it,
        product_id: it.product_id ?? products.find(p => p.id === it.id || p.art === it.art)?.id ?? it.id,
      })), editNote.trim());
      setShowEdit(false);
    } finally {
      setSaving(false);
    }
  };



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
        {isCancelled && (
          <div style={{padding:'14px 16px',borderRadius:14,background:'rgba(255,69,69,.1)',border:'1.5px solid rgba(255,69,69,.35)',marginBottom:14,animation:'fadeUp .35s ease'}}>
            <div style={{fontSize:14,fontWeight:800,color:'#FF6969',marginBottom:6}}>✕ Клиент отменил заказ</div>
            <div style={{fontSize:12,color:'#8FB897',lineHeight:1.5,marginBottom:12}}>
              {order.cancelReason || 'Сборку можно прекратить — заказ больше не нужен.'}
            </div>
            <button type="button" onClick={onAcknowledgeCancel} className="btn"
              style={{width:'100%',padding:12,borderRadius:12,background:'rgba(255,69,69,.15)',border:'1px solid rgba(255,69,69,.4)',color:'#FF6969',fontWeight:800,fontSize:13}}>
              ✓ Принять отмену — вернуться к заказам
            </button>
          </div>
        )}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
          <div style={{padding:'11px 14px',borderRadius:13,background:'#091508',border:'1px solid #162B1A'}}>
            <div style={{fontSize:10,color:'#3D6645',marginBottom:4}}>📍 Клиент</div>
            <div style={{fontSize:12,fontWeight:700,marginBottom:1}}>{order.client.name}</div>
            <div style={{fontSize:10,color:'#8FB897',marginBottom:order.client.phone?3:0}}>{order.client.addr}</div>
            {order.client.phone && <div style={{fontSize:10,color:'#9B6DFF',fontWeight:700}}>{order.client.phone}</div>}
          </div>
          <div style={{padding:'11px 14px',borderRadius:13,background:'rgba(59,142,240,.07)',border:'1px solid rgba(59,142,240,.2)'}}>
            <div style={{fontSize:10,color:'#3D6645',marginBottom:4}}>🛵 Курьер</div>
            {isCourierAssigned && courierName ? (
              <>
                <div style={{fontSize:12,fontWeight:700,color:'#3B8EF0',marginBottom:1}}>{courierName}</div>
                <div style={{fontSize:10,color:'#8FB897'}}>{order.courier.phone || 'Ожидает передачи заказа'}</div>
              </>
            ) : isReady ? (
              <>
                <div style={{fontSize:12,fontWeight:700,color:'#3B8EF0',marginBottom:1}}>Ожидаем курьера</div>
                <div style={{fontSize:10,color:'#8FB897'}}>Заказ готов — курьер примет его в приложении</div>
              </>
            ) : (
              <>
                <div style={{fontSize:12,fontWeight:700,color:'#3B8EF0',marginBottom:1}}>Назначится после сборки</div>
                <div style={{fontSize:10,color:'#8FB897'}}>Курьер сам примет заказ, когда товары будут готовы</div>
              </>
            )}
          </div>
        </div>
        {!isCancelled && (
          <div style={{display:'flex',gap:10,marginBottom:14}}>
            {clientPhone ? (
              <a href={clientPhone} className="btn"
                style={{flex:1,padding:'11px 12px',borderRadius:13,background:'rgba(31,215,96,.1)',border:'1.5px solid rgba(31,215,96,.35)',color:'#1FD760',fontWeight:800,fontSize:12,textDecoration:'none',display:'flex',alignItems:'center',justifyContent:'center',gap:7}}>
                📞 Позвонить клиенту
              </a>
            ) : (
              <div style={{flex:1,padding:'11px 12px',borderRadius:13,background:'#091508',border:'1px solid #162B1A',color:'#3D6645',fontSize:11,textAlign:'center',display:'flex',alignItems:'center',justifyContent:'center'}}>
                📞 Номер клиента не указан
              </div>
            )}
            <button type="button" onClick={() => setShowEdit(true)} className="btn"
              style={{flex:1,padding:'11px 12px',borderRadius:13,background:'rgba(155,109,255,.1)',border:'1.5px solid rgba(155,109,255,.35)',color:'#9B6DFF',fontWeight:800,fontSize:12}}>
              ✏️ Изменить заказ
            </button>
          </div>
        )}
        {order.comment&&(
          <div style={{padding:'9px 13px',borderRadius:11,background:'rgba(255,184,0,.06)',border:'1px solid rgba(255,184,0,.2)',fontSize:12,color:'#FFB800',marginBottom:14}}>
            💬 {order.comment}
          </div>
        )}
        {order.assemblerNote&&(
          <div style={{padding:'9px 13px',borderRadius:11,background:'rgba(155,109,255,.08)',border:'1px solid rgba(155,109,255,.25)',fontSize:12,color:'#9B6DFF',marginBottom:14}}>
            📝 Изменения: {order.assemblerNote}
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
          <div key={item.id} onClick={() => !isCancelled && !isHandoffStage && onToggle(order.id, item.id)}
            style={{display:'flex',gap:13,padding:'14px 15px',borderRadius:16,background:item.done?'rgba(155,109,255,.08)':'#091508',border:`1.5px solid ${item.done?'rgba(155,109,255,.4)':'#162B1A'}`,cursor:isCancelled || isHandoffStage ?'default':'pointer',transition:'background .2s, border-color .2s',opacity:isCancelled?.55:1}}>
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
        {isCancelled ? (
          <div style={{padding:'12px',background:'rgba(255,69,69,.08)',borderRadius:13,border:'1px solid rgba(255,69,69,.25)',textAlign:'center',fontSize:12,color:'#FF6969',fontWeight:700}}>
            Сборка остановлена — заказ отменён
          </div>
        ) : isCourierAssigned ? (
        <>
        <div style={{padding:'12px',background:'rgba(59,142,240,.08)',borderRadius:13,border:'1px solid rgba(59,142,240,.25)',textAlign:'center',fontSize:12,color:'#3B8EF0',fontWeight:700,marginBottom:10}}>
          Курьер {courierName || ''} принял заказ · передайте товары и подтвердите
        </div>
        <button type="button" onClick={() => onHandoff(order.id)} className="btn"
          style={{width:'100%',padding:14,borderRadius:16,background:'linear-gradient(135deg,#1E5BB5,#3B8EF0)',border:'none',color:'white',fontFamily:'Nunito',fontWeight:800,fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',gap:8,marginBottom:10}}>
          🛵 Забрал курьер
        </button>
        </>
        ) : isReady ? (
        <div style={{padding:'12px',background:'rgba(31,215,96,.08)',borderRadius:13,border:'1px solid rgba(31,215,96,.25)',textAlign:'center',fontSize:12,color:'#1FD760',fontWeight:700,marginBottom:10}}>
          ✅ Заказ готов · ожидаем, пока курьер примет его в приложении
        </div>
        ) : (
        <>
        {/* Summary */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div style={{fontSize:11,color:'#8FB897'}}>
            Итого: <span style={{fontWeight:700,color:'#FFB800'}}>{itemsTotal.toFixed(2)} ЅМ</span>
          </div>
          <div style={{fontSize:11,color:'#8FB897'}}>
            Собрано: <span style={{fontWeight:700,color:'#9B6DFF'}}>{doneCount}/{order.items.length}</span>
          </div>
        </div>
        {allDone ? (
          <button onClick={()=>setShowConfirm(true)} className="btn"
            style={{width:'100%',padding:14,borderRadius:16,background:'linear-gradient(135deg,#17B34E,#1FD760)',border:'none',color:'white',fontFamily:'Nunito',fontWeight:800,fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',gap:10,boxShadow:'0 8px 24px rgba(31,215,96,.4)',marginBottom:10}}>
            ✅ Заказ готов
          </button>
        ) : (
          <div style={{padding:'12px',background:'#091508',borderRadius:13,border:'1px solid #162B1A',textAlign:'center',fontSize:12,color:'#8FB897',marginBottom:10}}>
            Отметьте каждый товар по мере сборки · Осталось: <span style={{color:'#9B6DFF',fontWeight:700}}>{order.items.length-doneCount} товаров</span>
          </div>
        )}
        <button type="button" onClick={onCancel} className="btn"
          style={{width:'100%',padding:11,borderRadius:12,background:'rgba(255,69,69,.08)',border:'1px solid rgba(255,69,69,.28)',color:'#FF6969',fontFamily:'Nunito',fontWeight:700,fontSize:12}}>
          ✕ Отменить заказ
        </button>
        </>
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
                Заказ готов к передаче.<br/>
                <span style={{color:'#3B8EF0',fontWeight:700}}>Курьер примет его сам в приложении</span>
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
            <button onClick={()=>{ setShowConfirm(false); void onComplete(order.id); }} className="btn"
              style={{width:'100%',padding:14,borderRadius:15,background:'linear-gradient(135deg,#17B34E,#1FD760)',border:'none',color:'white',fontFamily:'Nunito',fontWeight:800,fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
              ✅ Заказ готов
            </button>
          </div>
        </div>
      )}

      {/* Edit order modal */}
      {showEdit && (
        <div style={{position:'fixed',inset:0,zIndex:300,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
          <div onClick={() => !saving && setShowEdit(false)} style={{position:'absolute',inset:0,background:'rgba(0,0,0,.85)',backdropFilter:'blur(10px)'}}/>
          <div style={{position:'relative',zIndex:1,width:'100%',maxWidth:480,maxHeight:'88vh',overflowY:'auto',background:'#06100A',borderTop:'1px solid #162B1A',borderRadius:'24px 24px 0 0',padding:'22px 20px 44px',animation:'slideUp .4s cubic-bezier(.16,1,.3,1)'}}>
            <div style={{width:40,height:4,borderRadius:2,background:'#1D3822',margin:'0 auto 20px'}}/>
            <div style={{marginBottom:16}}>
              <div style={{fontFamily:'Unbounded',fontSize:16,fontWeight:900,marginBottom:6}}>Изменить заказ</div>
              <div style={{fontSize:12,color:'#8FB897',lineHeight:1.5}}>
                Позвоните клиенту и уточните количество, замену или удаление товара.
              </div>
            </div>
            {clientPhone && (
              <a href={clientPhone} className="btn"
                style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,width:'100%',padding:12,borderRadius:13,background:'rgba(31,215,96,.1)',border:'1.5px solid rgba(31,215,96,.35)',color:'#1FD760',fontWeight:800,fontSize:13,textDecoration:'none',marginBottom:16}}>
                📞 Позвонить {order.client.name}
              </a>
            )}
            {pickerMode !== null ? (
              <div style={{marginBottom:16}}>
                <button type="button" onClick={closePicker} className="btn"
                  style={{display:'flex',alignItems:'center',gap:8,marginBottom:12,padding:'8px 0',background:'none',border:'none',color:'#8FB897',fontSize:12,fontWeight:700}}>
                  ← Назад к списку
                </button>
                <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:900,marginBottom:6,color:'#9B6DFF'}}>
                  {pickerMode === 'add' ? 'Добавить товар' : 'Заменить товар'}
                </div>
                {replaceTarget && (
                  <div style={{fontSize:11,color:'#8FB897',marginBottom:10,lineHeight:1.5}}>
                    Вместо: <span style={{color:'#EBF5ED',fontWeight:700}}>{replaceTarget.e} {replaceTarget.name}</span>
                  </div>
                )}
                <input
                  value={productQuery}
                  onChange={e => setProductQuery(e.target.value)}
                  placeholder="Поиск по названию или артикулу…"
                  autoFocus
                  style={{width:'100%',padding:'12px 14px',borderRadius:12,background:'#091508',border:'1px solid #162B1A',color:'#EBF5ED',fontSize:13,marginBottom:12,fontFamily:'Nunito'}}
                />
                <div style={{display:'flex',flexDirection:'column',gap:8,maxHeight:'42vh',overflowY:'auto'}}>
                  {filteredProducts.map(p => (
                    <button key={p.id} type="button" onClick={() => selectProduct(p)} className="btn"
                      style={{display:'flex',alignItems:'center',gap:12,padding:'11px 12px',borderRadius:13,background:'#091508',border:'1px solid #162B1A',textAlign:'left',width:'100%'}}>
                      <span style={{fontSize:26,flexShrink:0}}>{p.e}</span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:700,color:'#EBF5ED',marginBottom:2}}>{p.name}</div>
                        <div style={{fontSize:10,color:'#8FB897'}}>{p.art} · {p.unit} · {p.price.toFixed(2)} ЅМ</div>
                      </div>
                      <div style={{textAlign:'right',flexShrink:0}}>
                        <div style={{fontSize:10,color:p.stock > 0 ? '#1FD760' : '#FF6969',fontWeight:700}}>
                          {p.stock > 0 ? `${p.stock} шт` : 'нет'}
                        </div>
                        <div style={{fontSize:16,color:'#9B6DFF',marginTop:2}}>+</div>
                      </div>
                    </button>
                  ))}
                  {!filteredProducts.length && (
                    <div style={{padding:20,textAlign:'center',fontSize:12,color:'#8FB897'}}>
                      Товар не найден — попробуйте другой запрос
                    </div>
                  )}
                </div>
              </div>
            ) : (
            <>
            <button type="button" onClick={openAddPicker} className="btn"
              style={{width:'100%',padding:12,borderRadius:13,background:'rgba(155,109,255,.12)',border:'1.5px dashed rgba(155,109,255,.4)',color:'#9B6DFF',fontWeight:800,fontSize:13,marginBottom:14}}>
              ➕ Добавить товар из каталога
            </button>
            <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:16}}>
              {editItems.map(item => (
                <div key={item.id} style={{padding:'12px 14px',borderRadius:14,background:'#091508',border:'1px solid #162B1A'}}>
                  <div style={{display:'flex',gap:10,alignItems:'flex-start',marginBottom:10}}>
                    <span style={{fontSize:24}}>{item.e}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:700,marginBottom:2}}>{item.name}</div>
                      <div style={{fontSize:10,color:'#8FB897'}}>{item.art} · {item.unit} · {(item.price * item.qty).toFixed(2)} ЅМ</div>
                    </div>
                    <button type="button" onClick={() => removeItem(item.id)} className="btn"
                      style={{width:30,height:30,borderRadius:10,background:'rgba(255,69,69,.1)',border:'1px solid rgba(255,69,69,.3)',color:'#FF6969',fontSize:14,flexShrink:0}}>
                      ✕
                    </button>
                  </div>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                    <span style={{fontSize:11,color:'#8FB897'}}>Количество</span>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <button type="button" onClick={() => changeQty(item.id, -1)} className="btn"
                        style={{width:34,height:34,borderRadius:10,background:'#0C1C0F',border:'1px solid #162B1A',color:'#EBF5ED',fontSize:18,fontWeight:700}}>−</button>
                      <span style={{fontFamily:'Unbounded',fontSize:15,fontWeight:900,color:'#9B6DFF',minWidth:24,textAlign:'center'}}>{item.qty}</span>
                      <button type="button" onClick={() => changeQty(item.id, 1)} className="btn"
                        style={{width:34,height:34,borderRadius:10,background:'#0C1C0F',border:'1px solid #162B1A',color:'#EBF5ED',fontSize:18,fontWeight:700}}>+</button>
                    </div>
                  </div>
                  <button type="button" onClick={() => openReplacePicker(item.id)} className="btn"
                    style={{width:'100%',padding:9,borderRadius:10,background:'rgba(59,142,240,.08)',border:'1px solid rgba(59,142,240,.25)',color:'#3B8EF0',fontWeight:700,fontSize:11}}>
                    ↔ Заменить на другой товар
                  </button>
                </div>
              ))}
              {!editItems.length && (
                <div style={{padding:16,textAlign:'center',fontSize:12,color:'#8FB897',borderRadius:12,border:'1px dashed #1D3822'}}>
                  Все товары удалены — добавьте из каталога или отмените заказ
                </div>
              )}
            </div>
            <label style={{display:'block',fontSize:11,color:'#8FB897',marginBottom:8}}>Заметка об изменениях</label>
            <textarea value={editNote} onChange={e => setEditNote(e.target.value)} rows={3} placeholder="Например: заменили молоко 1 л на 2 л, убрали сыр — нет в наличии"
              style={{width:'100%',padding:'12px 14px',borderRadius:12,background:'#091508',border:'1px solid #162B1A',color:'#EBF5ED',fontSize:13,resize:'vertical',marginBottom:16,fontFamily:'Nunito'}}/>
            <div style={{display:'flex',gap:10}}>
              <button type="button" onClick={() => setShowEdit(false)} disabled={saving} className="btn"
                style={{flex:1,padding:13,borderRadius:14,background:'#091508',border:'1px solid #162B1A',color:'#8FB897',fontWeight:700,fontSize:13}}>
                Отмена
              </button>
              <button type="button" onClick={handleSaveEdit} disabled={saving || !editItems.length} className="btn"
                style={{flex:1,padding:13,borderRadius:14,background:'linear-gradient(135deg,#6B3FD4,#9B6DFF)',border:'none',color:'white',fontWeight:800,fontSize:13,opacity:(saving || !editItems.length) ? 0.5 : 1}}>
                {saving ? 'Сохранение…' : '✓ Сохранить'}
              </button>
            </div>
            </>
            )}
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
