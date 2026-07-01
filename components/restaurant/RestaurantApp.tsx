'use client'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useOrders, useRestaurants, USE_API } from '@/lib/store'
import { mapOrdersForRestaurant, hasOrderCourierAssigned } from '@/lib/orderUiMap'
import { hasRestPart, isMixedOrder, normalizeOrder, getAllPickupIds, getPendingPartsForCourier, isPickupPointReady } from '@/lib/orderParts'
import { restIdToPickupId } from '@/lib/pickups'
import { useApiSync } from '@/lib/useApiSync'
import { useAppNavigation } from '@/lib/useAppNavigation'
import AppNavigationBoundary from '@/components/shared/AppNavigationBoundary'
import { enrichRestaurants } from '@/lib/enrichCatalog'
import { api } from '@/lib/api'
import { sortReviewsNewestFirst } from '@/lib/clientReviews'
import { useWebSocket } from '@/lib/ws'
import type { Review } from '@/lib/types'
import Link from 'next/link'
import RestaurantLoginPage from '@/components/restaurant/RestaurantLoginPage'
import { loadRestaurantSession, clearRestaurantSession, saveRestaurantSession, type RestaurantSession } from '@/lib/restaurantSession'
import type { RestaurantLoginProfile } from '@/lib/restaurantTeam'
// ─── КАКАПО Restaurant App ───────────────────────
/* ══════════════════════════════════════════════════════
   КАКАПО RESTAURANT — Приложение для партнёров
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
  @keyframes alertEnter{0%{opacity:0;transform:translateX(-50%) translateY(-110%) scale(.94);}65%{opacity:1;transform:translateX(-50%) translateY(8px) scale(1.02);}85%{transform:translateX(-50%) translateY(-2px) scale(.995);}100%{opacity:1;transform:translateX(-50%) translateY(0) scale(1);}}
  @keyframes alertGlow{0%,100%{box-shadow:0 8px 32px rgba(31,215,96,.18),0 0 0 1px rgba(31,215,96,.35),inset 0 1px 0 rgba(255,255,255,.06);}50%{box-shadow:0 12px 40px rgba(31,215,96,.32),0 0 0 1.5px rgba(31,215,96,.55),inset 0 1px 0 rgba(255,255,255,.1);}}
  @keyframes alertContentIn{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}
  @keyframes alertShimmer{0%{background-position:200% center;}100%{background-position:-200% center;}}
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
  return (
    <AppNavigationBoundary>
      <RestaurantAppInner />
    </AppNavigationBoundary>
  );
}

function RestaurantAppInner() {
  useApiSync('restaurant');
  const { page, setPage } = useAppNavigation('dashboard');
  const apiOrders = useOrders(s => s.orders);
  const updateStatusApi = useOrders(s => s.updateStatus);
  const updateRestPart = useOrders(s => s.updateRestPart);
  const apiRests = useRestaurants(s => s.restaurants);
  const toggleMenuApi = useRestaurants(s => s.toggleMenuItem);
  const toggleOpenApi = useRestaurants(s => s.toggleOpen);
  const [session, setSession] = useState<RestaurantSession | null>(() => loadRestaurantSession());
  const [rest, setRest] = useState<(typeof DEMO_RESTAURANTS)[0] | null>(null);
  const [menu, setMenu] = useState<(typeof DEMO_RESTAURANTS)[0]['menu']>([]);
  const orders = useMemo(
    () => (USE_API && rest ? mapOrdersForRestaurant(apiOrders, rest.id) : DEMO_ORDERS),
    [apiOrders, rest]
  );
  const [reviews, setReviews] = useState<Review[]>([]);
  const [alertOrder, setAlertOrder] = useState<any>(null);
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(() => new Set());
  const seenNewOrderIds = useRef<Set<string>>(new Set());
  const ordersBootstrapped = useRef(false);

  const orderAlertLine = (o: any) => {
    const names = (o.items || []).map((it: any) => it.name).slice(0, 3);
    const tail = (o.items?.length || 0) > 3 ? '…' : '';
    return `${o.client} · ${o.total} ЅМ · ${names.join(' + ')}${tail}`;
  };

  const isOpen = rest ? (typeof rest.open === 'boolean' ? rest.open : (rest.isOpen ?? true)) : true;

  const loginRestaurants = useMemo((): RestaurantLoginProfile[] => {
    const enriched = enrichRestaurants(USE_API && apiRests.length ? apiRests : DEMO_RESTAURANTS, DEMO_RESTAURANTS);
    return enriched
      .filter(r => r.phone)
      .map(r => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        emoji: r.emoji || '🍽',
        blocked: false,
        otp: '1234',
      }));
  }, [apiRests]);

  const applyRestaurant = useCallback((found: (typeof DEMO_RESTAURANTS)[0]) => {
    setRest(found);
    setMenu(found.menu);
  }, []);

  useEffect(() => {
    if (!session || rest) return;
    const enriched = enrichRestaurants(USE_API && apiRests.length ? apiRests : DEMO_RESTAURANTS, DEMO_RESTAURANTS);
    const found = enriched.find(r => r.id === session.restId);
    if (found) applyRestaurant(found);
    else {
      clearRestaurantSession();
      setSession(null);
    }
  }, [session, apiRests, rest, applyRestaurant]);

  const toggleOpen = useCallback(async () => {
    if (!rest?.id) return;
    if (USE_API) {
      await toggleOpenApi(rest.id);
    } else {
      setRest(r => ({ ...r, open: !isOpen, isOpen: !isOpen }));
    }
  }, [rest?.id, toggleOpenApi, isOpen]);

  useEffect(() => {
    if (USE_API && apiRests.length && rest?.id) {
      const enriched = enrichRestaurants(apiRests, DEMO_RESTAURANTS);
      const found = enriched.find(r => r.id === rest.id);
      if (found) {
        setRest(found);
        setMenu(found.menu);
      }
    }
  }, [apiRests, rest?.id]);

  const onLoginSuccess = (s: RestaurantSession) => {
    saveRestaurantSession(s);
    setSession(s);
    const enriched = enrichRestaurants(USE_API && apiRests.length ? apiRests : DEMO_RESTAURANTS, DEMO_RESTAURANTS);
    const found = enriched.find(r => r.id === s.restId);
    if (found) {
      applyRestaurant(found);
      setPage('dashboard');
    }
  };

  const logout = () => {
    clearRestaurantSession();
    setSession(null);
    setRest(null);
    setMenu([]);
  };

  const loadReviews = useCallback(async () => {
    if (!rest?.id || !USE_API) return;
    try {
      const list = await api.getReviews(rest.id);
      setReviews(sortReviewsNewestFirst(list));
    } catch {
      setReviews([]);
    }
  }, [rest?.id]);

  useWebSocket('restaurant', useCallback((msg) => {
    if (msg.event !== 'review_update' || !msg.review || !rest?.id) return;
    if (String(msg.review.restId) !== String(rest.id)) return;
    setReviews(rs => {
      const idx = rs.findIndex(r => r.id === msg.review.id);
      if (idx >= 0) {
        const next = [...rs];
        next[idx] = { ...next[idx], ...msg.review };
        return sortReviewsNewestFirst(next);
      }
      return sortReviewsNewestFirst([msg.review, ...rs]);
    });
  }, [rest?.id]));

  useEffect(() => {
    loadReviews();
    if (!USE_API) return;
    const id = setInterval(loadReviews, 12000);
    return () => clearInterval(id);
  }, [loadReviews]);

  const unseenReviews = reviews.filter(r => !r.restSeen).length;

  useEffect(() => {
    const newOrders = orders.filter(o => o.status === 'new');

    if (!ordersBootstrapped.current) {
      newOrders.forEach(o => seenNewOrderIds.current.add(o.id));
      ordersBootstrapped.current = true;
      return;
    }

    for (const o of newOrders) {
      if (!seenNewOrderIds.current.has(o.id) && !dismissedAlerts.has(o.id)) {
        seenNewOrderIds.current.add(o.id);
        setAlertOrder(o);
        break;
      }
    }
  }, [orders, dismissedAlerts]);

  useEffect(() => {
    if (!alertOrder) return;
    const current = orders.find(o => o.id === alertOrder.id);
    if (!current || current.status !== 'new') setAlertOrder(null);
  }, [orders, alertOrder]);

  const handoffToCourier = async (orderId: string) => {
    if (!rest) return
    const raw = apiOrders.find(o => o.id === orderId)
    if (!raw) return
    const order = normalizeOrder(raw)
    const pickupId = restIdToPickupId(rest.id)
    const pickedUpIds = [...new Set([...(order.pickedUpIds || []), pickupId])]
    const patched = { ...order, pickedUpIds }
    const readyPoints = getAllPickupIds(order).filter(pid => isPickupPointReady(patched, pid))
    const allReadyPicked = readyPoints.length > 0 && readyPoints.every(pid => pickedUpIds.includes(pid))
    const nextStatus = allReadyPicked && !getPendingPartsForCourier(patched).length ? 'delivering' : 'courier_picked'
    await updateStatusApi(orderId, nextStatus, { pickedUpIds })
  };

  const updateOrderStatus = async (id, status) => {
    const raw = apiOrders.find(o => o.id === id);
    const normalized = raw ? normalizeOrder(raw) : null;
    const restPart = !!(normalized && rest && hasRestPart(normalized, rest.id));
    // Доставку подтверждает только курьер — ресторан не может закрыть заказ вручную
    if (restPart && status === 'delivered') return;
    if (USE_API && restPart && status === 'cancelled') {
      await updateStatusApi(id, status);
    } else if (USE_API && restPart && status !== 'delivered') {
      if (status === 'cooking') await updateRestPart(id, rest.id, 'cooking');
      else if (status === 'ready') await updateRestPart(id, rest.id, 'done');
      else await updateRestPart(id, rest.id, 'new');
    } else if (USE_API) {
      await updateStatusApi(id, status);
    }
  };

  const toggleDish = async (id) => {
    if (USE_API && rest) await toggleMenuApi(rest.id, id);
    setMenu(m => m.map(dish => dish.id===id ? {...dish, inStock:!dish.inStock} : dish));
  };

  const addDish = (dish) => {
    setMenu(m => [...m, {...dish, id: Date.now()}]);
  };

  const removeDish = (id) => {
    setMenu(m => m.filter(dish => dish.id !== id));
  };

  const addCategory = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || !rest) return false;
    if (rest.categories.includes(trimmed)) return false;
    setRest(r => r ? { ...r, categories: [...r.categories, trimmed] } : r);
    return true;
  };

  const renameCategory = (oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || !rest || trimmed === oldName) return false;
    if (rest.categories.includes(trimmed)) return false;
    setRest(r => r ? { ...r, categories: r.categories.map(c => c === oldName ? trimmed : c) } : r);
    setMenu(m => m.map(d => d.cat === oldName ? { ...d, cat: trimmed } : d));
    return true;
  };

  const removeCategory = (name: string) => {
    if (!rest || rest.categories.length <= 1) return false;
    const count = menu.filter(m => m.cat === name).length;
    if (count > 0) {
      const ok = window.confirm(`В разделе «${name}» ${count} блюд.\n\nУдалить раздел? Блюда перейдут в «${rest.categories.find(c => c !== name)}».`);
      if (!ok) return false;
      const fallback = rest.categories.find(c => c !== name)!;
      setMenu(m => m.map(d => d.cat === name ? { ...d, cat: fallback } : d));
    }
    setRest(r => r ? { ...r, categories: r.categories.filter(c => c !== name) } : r);
    return true;
  };

  const acceptAlertOrder = async () => {
    if (!alertOrder) return;
    await updateOrderStatus(alertOrder.id, 'cooking');
    setAlertOrder(null);
  };

  const dismissAlertOrder = () => {
    if (!alertOrder) return;
    const id = alertOrder.id;
    const nextDismissed = new Set([...dismissedAlerts, id]);
    setDismissedAlerts(nextDismissed);
    const next = orders.find(o => o.status === 'new' && o.id !== id && !nextDismissed.has(o.id));
    setAlertOrder(next || null);
  };

  if (!rest) {
    return (
      <>
        <style>{CSS}</style>
        <RestaurantLoginPage restaurants={loginRestaurants} onSuccess={onLoginSuccess} />
      </>
    );
  }

  return (
    <>
      <style>{CSS}</style>
      <div style={{maxWidth:480,margin:'0 auto',minHeight:'100dvh',background:'#030B05',position:'relative'}}>
        {/* New order notification */}
        {alertOrder && (
          <div
            key={alertOrder.id}
            style={{
              position:'fixed',
              top:12,
              left:'50%',
              transform:'translateX(-50%)',
              width:'calc(100% - 24px)',
              maxWidth:456,
              zIndex:999,
              padding:'14px 16px',
              borderRadius:18,
              background:'linear-gradient(135deg,rgba(15,48,32,.97),rgba(26,80,48,.97))',
              backdropFilter:'blur(20px)',
              WebkitBackdropFilter:'blur(20px)',
              border:'1px solid rgba(31,215,96,.45)',
              animation:'alertEnter .55s cubic-bezier(.22,1.2,.36,1) forwards, alertGlow 2.4s ease-in-out .55s infinite',
              display:'flex',
              alignItems:'center',
              gap:12,
              overflow:'hidden',
            }}
          >
            <div style={{
              position:'absolute',
              inset:0,
              background:'linear-gradient(105deg,transparent 40%,rgba(31,215,96,.12) 50%,transparent 60%)',
              backgroundSize:'200% 100%',
              animation:'alertShimmer 2.8s ease-in-out .3s 2',
              pointerEvents:'none',
            }}/>
            <div style={{position:'relative',width:44,height:44,flexShrink:0,animation:'alertContentIn .4s ease .15s both'}}>
              <div style={{position:'absolute',inset:0,borderRadius:14,background:'rgba(31,215,96,.15)',animation:'ping 1.8s ease-out infinite'}}/>
              <div style={{position:'relative',width:44,height:44,borderRadius:14,background:'linear-gradient(135deg,rgba(31,215,96,.25),rgba(31,215,96,.08))',border:'1px solid rgba(31,215,96,.4)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,animation:'ring 1.2s ease-in-out .4s 3'}}>
                🔔
              </div>
            </div>
            <div style={{flex:1,minWidth:0,animation:'alertContentIn .45s ease .22s both'}}>
              <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:900,color:'#1FD760',letterSpacing:'.02em'}}>Новый заказ!</div>
              <div style={{fontSize:12,color:'rgba(255,255,255,.78)',marginTop:3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{orderAlertLine(alertOrder)}</div>
            </div>
            <div style={{display:'flex',gap:8,flexShrink:0,animation:'alertContentIn .45s ease .32s both'}}>
              <button onClick={acceptAlertOrder} className="btn" style={{padding:'9px 16px',borderRadius:12,background:'linear-gradient(135deg,#17B34E,#1FD760)',border:'none',color:'#030B05',fontFamily:'Nunito',fontWeight:800,fontSize:13,boxShadow:'0 4px 16px rgba(31,215,96,.35)'}}>Принять</button>
              <button onClick={dismissAlertOrder} className="btn" style={{width:38,height:38,borderRadius:12,background:'rgba(255,69,69,.12)',border:'1px solid rgba(255,69,69,.35)',color:'#FF6969',fontFamily:'Nunito',fontWeight:700,fontSize:15,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
            </div>
          </div>
        )}

        {page==='dashboard' && <DashboardPage rest={rest} orders={orders} reviews={reviews} unseenReviews={unseenReviews} isOpen={isOpen} onToggleOpen={toggleOpen} onPage={setPage} onLogout={logout} hasAlert={!!alertOrder}/>}
        {page==='orders'    && <OrdersPage    rest={rest} orders={orders} apiOrders={apiOrders} reviewBadge={unseenReviews} onUpdate={updateOrderStatus} onHandoff={handoffToCourier} onPage={setPage}/>}
        {page==='menu'      && <MenuPage rest={rest} menu={menu} reviewBadge={unseenReviews} onToggle={toggleDish} onAdd={addDish} onRemove={removeDish} onAddCategory={addCategory} onRenameCategory={renameCategory} onRemoveCategory={removeCategory} onPage={setPage}/>}
        {page==='reviews'   && <ReviewsPage   rest={rest} reviews={reviews} reviewBadge={unseenReviews} onRefresh={loadReviews} onPage={setPage} onMarkSeen={async (id) => { if (USE_API) await api.updateReview(id, { restSeen: true }); setReviews(rs => rs.map(r => r.id === id ? { ...r, restSeen: true } : r)); }}/>}
        {page==='stats'     && <StatsPage     rest={rest} orders={orders} reviewBadge={unseenReviews} onPage={setPage}/>}
        {page==='settings'  && <SettingsPage  rest={rest} isOpen={isOpen} reviewBadge={unseenReviews} onToggleOpen={toggleOpen} onPage={setPage} onLogout={logout}/>}
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════
   HEADER (shared)
══════════════════════════════════════════════════════ */
function Header({
  rest, isOpen, onToggleOpen, onPage,
  onLogout = () => {},
  showBack = false,
  backPage = 'dashboard',
  title = '',
}: {
  rest: any; isOpen: boolean; onToggleOpen?: () => void
  onPage: (p: string) => void; onLogout?: () => void
  showBack?: boolean; backPage?: string; title?: string
}) {
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
        {!showBack && onToggleOpen && (
          <div onClick={onToggleOpen} style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',borderRadius:11,background:isOpen?'rgba(31,215,96,.12)':'rgba(255,69,69,.12)',border:`1px solid ${isOpen?'rgba(31,215,96,.3)':'rgba(255,69,69,.3)'}`,cursor:'pointer'}}>
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
function BottomNav({page, onPage, newOrders, reviewBadge}) {
  const items = [
    {id:'dashboard',icon:'📊',label:'Главная'},
    {id:'orders',   icon:'📦',label:'Заказы',  badge:newOrders},
    {id:'menu',     icon:'🍽', label:'Меню'},
    {id:'reviews',  icon:'⭐', label:'Отзывы', badge:reviewBadge},
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
function DashboardPage({rest, orders, reviews, unseenReviews, isOpen, onToggleOpen, onPage, onLogout, hasAlert}) {
  const todayOrders   = orders.filter(o=>o.status!=='delivered' && o.status!=='cancelled');
  const workOrders    = todayOrders.filter(o=>o.status==='new' || o.status==='cooking');
  const readyOrders   = todayOrders.filter(o=>o.status==='ready');
  const doneToday     = orders.filter(o=>o.status==='delivered').length;
  const revenue       = orders.filter(o=>o.status==='delivered').reduce((s,o)=>s+o.total,0);
  const newOrders     = orders.filter(o=>o.status==='new').length;
  const avgReview     = reviews.length ? (reviews.reduce((s,r)=>s+r.rating,0)/reviews.length).toFixed(1) : rest?.rating;

  return (
    <div style={{minHeight:'100vh',background:'#030B05',paddingBottom:90,paddingTop:hasAlert?88:0}}>
      <Header rest={rest} isOpen={isOpen} onToggleOpen={onToggleOpen} onPage={onPage} onLogout={onLogout}/>

      <div style={{padding:'16px 18px'}}>
        {unseenReviews>0&&(
          <div onClick={()=>onPage('reviews')} style={{display:'flex',alignItems:'center',gap:12,padding:'13px 16px',borderRadius:16,background:'rgba(255,184,0,.08)',border:'1.5px solid rgba(255,184,0,.35)',marginBottom:16,cursor:'pointer',animation:'fadeUp .4s ease'}}>
            <div style={{fontSize:24}}>⭐</div>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:800,color:'#FFB800'}}>{unseenReviews} новых отзывов от клиентов</div>
              <div style={{fontSize:11,color:'#8FB897',marginTop:1}}>Нажмите чтобы прочитать и ответить</div>
            </div>
          </div>
        )}
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
        <div onClick={()=>onPage('stats')} style={{cursor:'pointer',background:'linear-gradient(135deg,#071A0A,#0F3018)',border:'1px solid rgba(31,215,96,.2)',borderRadius:18,padding:'18px',marginBottom:16,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <div style={{fontSize:11,color:'#8FB897',marginBottom:6}}>Выручка сегодня</div>
            <div style={{fontFamily:'Unbounded',fontSize:30,fontWeight:900,color:'#1FD760'}}>{revenue} <span style={{fontSize:16,color:'#FFB800'}}>ЅМ</span></div>
            <div style={{fontSize:11,color:'#3D6645',marginTop:4}}>Комиссия КАКАПО ({rest?.commission}%): <span style={{color:'#FF4545'}}>−{Math.round(revenue*rest?.commission/100)} ЅМ</span></div>
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:11,color:'#8FB897',marginBottom:4}}>Ваш доход · ★ {avgReview}</div>
            <div style={{fontFamily:'Unbounded',fontSize:22,fontWeight:900,color:'#FFB800'}}>{Math.round(revenue*(1-rest?.commission/100))} ЅМ</div>
          </div>
        </div>

        {/* Active orders */}
        {(workOrders.length>0 || readyOrders.length>0)&&(
          <>
            {workOrders.length>0&&(
              <>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                  <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:800}}>В работе ({workOrders.length})</div>
                  <button onClick={()=>onPage('orders')} className="btn" style={{fontSize:12,color:'#FFB800',background:'rgba(255,184,0,.1)',border:'1px solid rgba(255,184,0,.25)',borderRadius:10,padding:'5px 12px',fontFamily:'Nunito',fontWeight:700}}>Все →</button>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:readyOrders.length?16:0}}>
                  {workOrders.slice(0,3).map((o,i)=>{
                    const sc = {new:{l:'Новый',c:'#FF4545'},cooking:{l:'Готовится',c:'#FFB800'}};
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
            {readyOrders.length>0&&(
              <>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                  <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:800,color:'#1FD760'}}>Готовые ({readyOrders.length})</div>
                  <button onClick={()=>onPage('orders')} className="btn" style={{fontSize:12,color:'#1FD760',background:'rgba(31,215,96,.1)',border:'1px solid rgba(31,215,96,.25)',borderRadius:10,padding:'5px 12px',fontFamily:'Nunito',fontWeight:700}}>Все →</button>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {readyOrders.slice(0,3).map((o,i)=>(
                    <div key={o.id} onClick={()=>onPage('orders')} style={{display:'flex',alignItems:'center',gap:12,padding:'13px 14px',background:'#091508',border:'1px solid rgba(31,215,96,.28)',borderRadius:14,cursor:'pointer',animation:`fadeUp .4s ease ${i*.07}s both`}}>
                      <div style={{width:8,height:8,borderRadius:'50%',background:'#1FD760',flexShrink:0}}/>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:700,marginBottom:1}}>{o.id} · {o.client}</div>
                        <div style={{fontSize:11,color:'#8FB897'}}>{o.items.map(it=>it.name).join(', ')}</div>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontFamily:'Unbounded',fontSize:13,fontWeight:900}}>{o.total} <span style={{fontSize:10,color:'#FFB800'}}>ЅМ</span></div>
                        <span style={{fontSize:10,fontWeight:800,color:'#1FD760'}}>Готово!</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <BottomNav page="dashboard" onPage={onPage} newOrders={newOrders} reviewBadge={unseenReviews}/>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   ЗАКАЗЫ
══════════════════════════════════════════════════════ */
function OrdersPage({rest, orders, apiOrders, onUpdate, onHandoff, onPage, reviewBadge = 0}) {
  const [filter, setFilter] = useState('work');
  const newOrders = orders.filter(o=>o.status==='new').length;

  const isOrderReady = (o) => {
    if (!['ready', 'courier_picked', 'delivering'].includes(o.status)) return false
    const raw = apiOrders.find(x => x.id === o.id)
    const pickupId = rest ? restIdToPickupId(rest.id) : ''
    const handedOff = pickupId ? (raw?.pickedUpIds || []).includes(pickupId) : false
    return !handedOff
  }
  const isOrderInWork = (o) => o.status === 'new' || o.status === 'cooking'

  const workOrders = orders.filter(isOrderInWork)
  const readyOrders = orders.filter(isOrderReady)
  const doneOrders = orders.filter(o => o.status === 'delivered')

  const filtered = filter === 'work'
    ? workOrders
    : filter === 'ready'
      ? readyOrders
      : doneOrders.sort((a,b)=>String(b.time).localeCompare(String(a.time)));

  const emptyMsg = filter === 'work'
    ? 'Нет заказов в работе'
    : filter === 'ready'
      ? 'Нет готовых заказов'
      : 'Ещё нет доставленных заказов'

  const SC = {
    new:      {l:'Новый',     c:'#FF4545',  next:'cooking',  nextL:'✓ Принять и начать готовить'},
    cooking:  {l:'Готовится', c:'#FFB800',  next:'ready',    nextL:'✅ Заказ готов'},
    ready:    {l:'Готово!',   c:'#1FD760',  next:null,      nextL:'⏳ Ожидает курьера', waitCourier:true},
    courier_picked: {l:'У курьера', c:'#3B8EF0', next:null, nextL:'🛵 Курьер забрал заказ', waitCourier:true},
    delivering: {l:'Доставляется', c:'#3B8EF0', next:null, nextL:'🛵 Курьер везёт клиенту', waitCourier:true},
    delivered:{l:'Доставлен', c:'#3B8EF0',  next:null,       nextL:''},
  };

  return (
    <div style={{minHeight:'100vh',background:'#030B05',paddingBottom:90}}>
      <Header rest={rest} isOpen={true} onPage={onPage} showBack backPage="dashboard" title="Заказы"/>

      <div style={{padding:'14px 18px 0'}}>
        <div style={{display:'flex',gap:8,marginBottom:14}}>
          {[
            {id:'work',l:`В работе (${workOrders.length})`,accent:'#FFB800'},
            {id:'ready',l:`Готовые (${readyOrders.length})`,accent:'#1FD760'},
            {id:'done',l:`Доставлено (${doneOrders.length})`,accent:'#3B8EF0'},
          ].map(f=>(
            <button key={f.id} onClick={()=>setFilter(f.id)} className="btn"
              style={{flex:1,padding:'10px 8px',borderRadius:12,fontSize:11,fontWeight:700,border:`1.5px solid ${filter===f.id?`${f.accent}66`:'#162B1A'}`,background:filter===f.id?`${f.accent}1F`:'#0C1C0F',color:filter===f.id?f.accent:'#8FB897',fontFamily:'Nunito'}}>
              {f.l}
            </button>
          ))}
        </div>
      </div>

      <div style={{padding:'0 18px 20px',display:'flex',flexDirection:'column',gap:12}}>
        {filtered.map((o,i)=>{
          const s = SC[o.status]||SC.delivered;
          const raw = apiOrders.find(x => x.id === o.id)
          const pickupId = rest ? restIdToPickupId(rest.id) : ''
          const hasCourier = hasOrderCourierAssigned(raw?.courier)
          const handedOff = pickupId ? (raw?.pickedUpIds || []).includes(pickupId) : false
          const isReadyWaiting = o.status === 'ready' && !hasCourier
          const isCourierAssigned = ['ready', 'courier_picked', 'delivering'].includes(o.status) && hasCourier && !handedOff
          const showHandoff = isCourierAssigned
          const cardBorder = o.status === 'new'
            ? 'rgba(255,69,69,.4)'
            : isCourierAssigned
              ? 'rgba(59,142,240,.45)'
              : isReadyWaiting
                ? 'rgba(31,215,96,.4)'
                : '#162B1A'
          return (
            <div key={o.id} style={{background:'#091508',border:`1.5px solid ${cardBorder}`,borderRadius:18,overflow:'hidden',animation:`fadeUp .4s ease ${i*.06}s both`}}>
              {isReadyWaiting && (
                <div style={{padding:'7px 16px',background:'rgba(31,215,96,.08)',borderBottom:'1px solid rgba(31,215,96,.2)',display:'flex',alignItems:'center',gap:7}}>
                  <span style={{fontSize:11,fontWeight:800,color:'#1FD760'}}>✅ Заказ готов · ждёт курьера</span>
                </div>
              )}
              {isCourierAssigned && (
                <div style={{padding:'7px 16px',background:'rgba(59,142,240,.08)',borderBottom:'1px solid rgba(59,142,240,.2)',display:'flex',alignItems:'center',gap:7}}>
                  <span style={{fontSize:11,fontWeight:800,color:'#3B8EF0'}}>🛵 Курьер принял · передайте заказ</span>
                </div>
              )}
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

                {(isReadyWaiting || isCourierAssigned) && (
                  <div style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',borderRadius:11,background:'rgba(59,142,240,.07)',border:'1px solid rgba(59,142,240,.2)',marginBottom:12}}>
                    <span style={{fontSize:16}}>🛵</span>
                    <div style={{flex:1}}>
                      {isCourierAssigned ? (
                        <>
                          <div style={{fontSize:12,fontWeight:700,color:'#3B8EF0'}}>{raw?.courier?.name}</div>
                          <div style={{fontSize:10,color:'#3D6645'}}>{raw?.courier?.phone || 'Курьер ждёт передачи заказа'}</div>
                        </>
                      ) : (
                        <>
                          <div style={{fontSize:12,fontWeight:700,color:'#3B8EF0'}}>Ожидаем курьера</div>
                          <div style={{fontSize:10,color:'#3D6645'}}>Курьер примет заказ в приложении</div>
                        </>
                      )}
                    </div>
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
                      <button onClick={()=>onUpdate(o.id,'cancelled')} className="btn" style={{width:44,height:44,borderRadius:11,background:'rgba(255,69,69,.1)',border:'1px solid rgba(255,69,69,.3)',color:'#FF4545',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>✕</button>
                    )}
                  </div>
                )}
                {showHandoff && (
                  <button type="button" onClick={() => onHandoff(o.id)} className="btn"
                    style={{ width:'100%', padding:'12px', borderRadius:13, background:'linear-gradient(135deg,#1E5BB5,#3B8EF0)', border:'none', color:'white', fontFamily:'Nunito', fontWeight:800, fontSize:13 }}>
                    🛵 Забрал курьер
                  </button>
                )}
                {isReadyWaiting && (
                  <div style={{padding:'12px',borderRadius:13,background:'rgba(31,215,96,.08)',border:'1px solid rgba(31,215,96,.25)',fontSize:12,fontWeight:700,color:'#1FD760',textAlign:'center',fontFamily:'Nunito'}}>
                    ⏳ Ожидаем, пока курьер примет заказ в приложении
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
            <div style={{fontSize:12,color:'#8FB897'}}>{emptyMsg}</div>
          </div>
        )}
      </div>

      <BottomNav page="orders" onPage={onPage} newOrders={orders.filter(o=>o.status==='new').length} reviewBadge={reviewBadge}/>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   МЕНЮ
══════════════════════════════════════════════════════ */
const FOOD_EMOJIS = ['🍖', '🍚', '🥩', '🍗', '🥗', '🍲', '🍜', '🍵', '🥟', '🍕', '🍔', '🍝', '🥤', '🌯', '🍣', '🥘', '🧁', '☕', '🍰', '🥙', '🍽', '🥛', '🧃', '🍺']

const CATEGORY_SUGGESTIONS = [
  'Горячее', 'Холодные', 'Шашлык', 'Салаты', 'Супы', 'Закуски', 'Гарниры',
  'Пицца', 'Бургеры', 'Паста', 'Роллы', 'Десерты', 'Напитки', 'Кофе', 'Чай', 'Алкоголь', 'Соусы', 'Детское меню',
]

const CATEGORY_ICONS: Record<string, string> = {
  'Горячее': '🔥', 'Холодные': '🧊', 'Шашлык': '🥩', 'Салаты': '🥗', 'Супы': '🍲',
  'Закуски': '🥟', 'Гарниры': '🍚', 'Пицца': '🍕', 'Бургеры': '🍔', 'Паста': '🍝',
  'Роллы': '🍣', 'Десерты': '🍰', 'Напитки': '🥤', 'Кофе': '☕', 'Чай': '🍵',
  'Алкоголь': '🍺', 'Соусы': '🫙', 'Детское меню': '🧒',
}

function categoryIcon(name: string) {
  return CATEGORY_ICONS[name] || '🍽'
}

const ALL_MENU_CAT = '__all__'

function MenuPage({rest, menu, onToggle, onAdd, onRemove, onAddCategory, onRenameCategory, onRemoveCategory, onPage, reviewBadge = 0}) {
  const [activeCat, setActiveCat] = useState(ALL_MENU_CAT)
  const [showAdd, setShowAdd] = useState(false)
  const [showAddCat, setShowAddCat] = useState(false)
  const [showRenameCat, setShowRenameCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [renameCatName, setRenameCatName] = useState('')
  const [catErr, setCatErr] = useState('')
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [desc, setDesc] = useState('')
  const [cat, setCat] = useState(rest?.categories[0] || '')
  const [emoji, setEmoji] = useState('🍽')
  const [photo, setPhoto] = useState('')
  const [photoErr, setPhotoErr] = useState('')
  const [formErr, setFormErr] = useState('')

  const categories = rest?.categories || []
  const isAllView = activeCat === ALL_MENU_CAT
  const displayMenu = isAllView ? menu : menu.filter(m => m.cat === activeCat)
  const viewTitle = isAllView ? 'Все меню' : activeCat
  const viewIcon = isAllView ? '📋' : categoryIcon(activeCat)
  const defaultCat = categories[0] || ''
  const stopCount = menu.filter(m => !m.inStock).length
  const priceNum = Number(price)
  const canSave = name.trim().length > 0 && priceNum > 0
  const availableSuggestions = CATEGORY_SUGGESTIONS.filter(s => !categories.includes(s))

  useEffect(() => {
    if (activeCat === ALL_MENU_CAT) return
    if (!categories.length) return
    if (!categories.includes(activeCat)) setActiveCat(ALL_MENU_CAT)
  }, [categories, activeCat])

  const resetForm = (category?: string) => {
    const target = category && category !== ALL_MENU_CAT
      ? category
      : (activeCat !== ALL_MENU_CAT ? activeCat : defaultCat)
    setName('')
    setPrice('')
    setDesc('')
    setCat(target)
    setEmoji('🍽')
    setPhoto('')
    setPhotoErr('')
    setFormErr('')
  }

  const openAddForm = (category = activeCat) => {
    resetForm(category)
    setShowAdd(true)
  }

  const openAddCategory = () => {
    setNewCatName('')
    setCatErr('')
    setShowAddCat(true)
  }

  const saveNewCategory = (name?: string) => {
    const value = (name ?? newCatName).trim()
    if (!value) { setCatErr('Введите название раздела'); return }
    if (categories.includes(value)) { setCatErr('Такой раздел уже есть'); return }
    const ok = onAddCategory(value)
    if (!ok) { setCatErr('Не удалось добавить раздел'); return }
    setActiveCat(value)
    setShowAddCat(false)
    setNewCatName('')
    setCatErr('')
  }

  const openRenameCategory = () => {
    if (isAllView) return
    setRenameCatName(activeCat)
    setCatErr('')
    setShowRenameCat(true)
  }

  const saveRenameCategory = () => {
    const value = renameCatName.trim()
    if (!value) { setCatErr('Введите название'); return }
    if (value !== activeCat && categories.includes(value)) { setCatErr('Такой раздел уже есть'); return }
    const ok = onRenameCategory(activeCat, value)
    if (!ok) { setCatErr('Не удалось переименовать'); return }
    setActiveCat(value)
    setShowRenameCat(false)
    setCatErr('')
  }

  const handleRemoveCategory = () => {
    if (isAllView || categories.length <= 1) return
    const ok = onRemoveCategory(activeCat)
    if (ok) setActiveCat(ALL_MENU_CAT)
  }

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { setPhotoErr('Файл слишком большой (макс. 5 МБ)'); return }
    setPhotoErr('')
    const reader = new FileReader()
    reader.onload = (ev) => setPhoto(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  const save = () => {
    if (!name.trim()) { setFormErr('Укажите название блюда'); return }
    if (!priceNum || priceNum <= 0) { setFormErr('Укажите цену больше 0'); return }
    onAdd({ e: emoji, name: name.trim(), desc: desc.trim(), price: priceNum, cat, inStock: true, popular: false, photo })
    setShowAdd(false)
    resetForm(isAllView ? defaultCat : activeCat)
    if (cat !== activeCat && cat !== ALL_MENU_CAT) setActiveCat(cat)
  }

  return (
    <div style={{minHeight:'100vh',background:'#030B05',paddingBottom:90}}>
      <Header rest={rest} isOpen={true} onPage={onPage} showBack backPage="dashboard" title="Управление меню"/>

      {stopCount > 0 && (
        <div style={{margin:'14px 18px 0',padding:'11px 14px',borderRadius:13,background:'rgba(255,69,69,.07)',border:'1px solid rgba(255,69,69,.25)',display:'flex',alignItems:'center',gap:10}}>
          <span style={{fontSize:20}}>⚠️</span>
          <div style={{flex:1}}>
            <span style={{fontSize:13,fontWeight:700,color:'#FF4545'}}>Стоп-лист: {stopCount} блюд</span>
            <div style={{fontSize:11,color:'#8FB897',marginTop:1}}>Клиенты не могут заказать эти блюда</div>
          </div>
        </div>
      )}

      <div style={{padding:'16px 18px 0'}}>
        <div className="hscroll" style={{gap:10,padding:'4px 2px 12px'}}>
          <button type="button" onClick={() => setActiveCat(ALL_MENU_CAT)} className="btn"
            style={{
              width:86,flexShrink:0,padding:'14px 10px 12px',borderRadius:18,textAlign:'center',
              background:isAllView
                ? 'linear-gradient(160deg,rgba(23,179,78,.22) 0%,rgba(31,215,96,.08) 100%)'
                : 'linear-gradient(160deg,#0C1C0F 0%,#091508 100%)',
              border:`1.5px solid ${isAllView ? 'rgba(31,215,96,.55)' : '#162B1A'}`,
              boxShadow:isAllView ? '0 8px 28px rgba(31,215,96,.22), inset 0 1px 0 rgba(255,255,255,.06)' : 'none',
              transform:isAllView ? 'translateY(-2px)' : 'none',
              transition:'all .22s ease',
            }}>
            <div style={{fontSize:28,lineHeight:1,marginBottom:8}}>📋</div>
            <div style={{
              fontSize:11,fontWeight:800,color:isAllView ? '#1FD760' : '#8FB897',
              lineHeight:1.2,marginBottom:6,
            }}>
              Все
            </div>
            <div style={{
              display:'inline-flex',alignItems:'center',justifyContent:'center',minWidth:22,height:20,padding:'0 7px',
              borderRadius:20,fontSize:10,fontWeight:800,
              background:isAllView ? 'rgba(31,215,96,.2)' : '#162B1A',
              color:isAllView ? '#1FD760' : '#3D6645',
            }}>
              {menu.length}
            </div>
          </button>
          {categories.map(c => {
            const count = menu.filter(m => m.cat === c).length
            const active = activeCat === c
            return (
              <button key={c} type="button" onClick={() => setActiveCat(c)} className="btn"
                style={{
                  width:86,flexShrink:0,padding:'14px 10px 12px',borderRadius:18,textAlign:'center',
                  background:active
                    ? 'linear-gradient(160deg,rgba(23,179,78,.22) 0%,rgba(31,215,96,.08) 100%)'
                    : 'linear-gradient(160deg,#0C1C0F 0%,#091508 100%)',
                  border:`1.5px solid ${active ? 'rgba(31,215,96,.55)' : '#162B1A'}`,
                  boxShadow:active ? '0 8px 28px rgba(31,215,96,.22), inset 0 1px 0 rgba(255,255,255,.06)' : 'none',
                  transform:active ? 'translateY(-2px)' : 'none',
                  transition:'all .22s ease',
                }}>
                <div style={{fontSize:28,lineHeight:1,marginBottom:8,filter:active ? 'none' : 'grayscale(.25) opacity(.85)'}}>
                  {categoryIcon(c)}
                </div>
                <div style={{
                  fontSize:11,fontWeight:800,color:active ? '#1FD760' : '#8FB897',
                  lineHeight:1.2,marginBottom:6,maxHeight:26,overflow:'hidden',
                }}>
                  {c}
                </div>
                <div style={{
                  display:'inline-flex',alignItems:'center',justifyContent:'center',minWidth:22,height:20,padding:'0 7px',
                  borderRadius:20,fontSize:10,fontWeight:800,
                  background:active ? 'rgba(31,215,96,.2)' : '#162B1A',
                  color:active ? '#1FD760' : '#3D6645',
                }}>
                  {count}
                </div>
              </button>
            )
          })}
          <button type="button" onClick={openAddCategory} className="btn"
            style={{
              width:86,flexShrink:0,padding:'14px 10px 12px',borderRadius:18,textAlign:'center',
              background:'rgba(31,215,96,.04)',border:'1.5px dashed rgba(31,215,96,.35)',
              display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6,
            }}>
            <div style={{
              width:36,height:36,borderRadius:12,background:'rgba(31,215,96,.12)',
              border:'1px solid rgba(31,215,96,.25)',display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:22,color:'#1FD760',fontWeight:300,
            }}>+</div>
            <div style={{fontSize:11,fontWeight:800,color:'#1FD760'}}>Раздел</div>
          </button>
        </div>

        <div style={{
          marginBottom:18,padding:'18px 18px 16px',borderRadius:22,position:'relative',overflow:'hidden',
          background:'linear-gradient(135deg,rgba(15,48,32,.95) 0%,rgba(9,21,8,.98) 100%)',
          border:'1px solid rgba(31,215,96,.28)',
          boxShadow:'0 12px 40px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.05)',
          animation:'fadeUp .35s ease both',
        }}>
          <div style={{
            position:'absolute',top:-30,right:-20,width:120,height:120,borderRadius:'50%',
            background:'radial-gradient(circle,rgba(31,215,96,.15) 0%,transparent 70%)',pointerEvents:'none',
          }}/>
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:14,position:'relative'}}>
            <div style={{display:'flex',gap:14,alignItems:'center'}}>
              <div style={{
                width:52,height:52,borderRadius:16,flexShrink:0,
                background:'linear-gradient(135deg,rgba(31,215,96,.25),rgba(31,215,96,.08))',
                border:'1px solid rgba(31,215,96,.35)',
                display:'flex',alignItems:'center',justifyContent:'center',fontSize:26,
                boxShadow:'0 4px 16px rgba(31,215,96,.2)',
              }}>
                {viewIcon}
              </div>
              <div>
                <div style={{fontFamily:'Unbounded',fontSize:17,fontWeight:900,color:'#EBF5ED',marginBottom:3}}>{viewTitle}</div>
                <div style={{fontSize:12,color:'#8FB897'}}>
                  {displayMenu.length} {displayMenu.length === 1 ? 'блюдо' : displayMenu.length < 5 ? 'блюда' : 'блюд'}
                  {isAllView && categories.length > 0 && (
                    <span style={{color:'#3D6645'}}> · {categories.length} {categories.length < 5 ? 'раздела' : 'разделов'}</span>
                  )}
                  {!isAllView && displayMenu.length === 0 && <span style={{color:'#3D6645'}}> · пока пусто</span>}
                </div>
              </div>
            </div>
            {!isAllView && (
            <div style={{display:'flex',gap:6,flexShrink:0}}>
              <button type="button" onClick={openRenameCategory} title="Переименовать" className="btn"
                style={{
                  width:36,height:36,borderRadius:11,
                  background:'rgba(255,255,255,.06)',border:'1px solid rgba(255,255,255,.1)',
                  color:'#8FB897',fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',
                }}>
                ✏️
              </button>
              {categories.length > 1 && (
                <button type="button" onClick={handleRemoveCategory} title="Удалить раздел" className="btn"
                  style={{
                    width:36,height:36,borderRadius:11,
                    background:'rgba(255,69,69,.08)',border:'1px solid rgba(255,69,69,.22)',
                    color:'#FF6969',fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',
                  }}>
                  🗑
                </button>
              )}
            </div>
            )}
          </div>
          <button type="button" onClick={() => openAddForm(isAllView ? defaultCat : activeCat)} className="btn"
            style={{
              width:'100%',padding:13,borderRadius:14,
              background:'linear-gradient(135deg,#17B34E,#1FD760)',border:'none',
              color:'#030B05',fontFamily:'Nunito',fontWeight:800,fontSize:14,
              display:'flex',alignItems:'center',justifyContent:'center',gap:8,
              boxShadow:'0 6px 22px rgba(31,215,96,.35)',
            }}>
            <span style={{fontSize:18,lineHeight:1}}>+</span>
            {isAllView ? 'Добавить блюдо' : `Добавить блюдо в «${activeCat}»`}
          </button>
        </div>
      </div>

      <div style={{padding:'0 18px 20px'}}>
        {displayMenu.length === 0 ? (
          <div style={{
            padding:'28px 22px',borderRadius:18,textAlign:'center',
            background:'#091508',border:'1px solid #162B1A',
            animation:'fadeUp .4s ease both',
          }}>
            <div style={{fontSize:44,marginBottom:10}}>{viewIcon}</div>
            <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:900,marginBottom:6,color:'#EBF5ED'}}>Пока нет блюд</div>
            <div style={{fontSize:12,color:'#8FB897',lineHeight:1.55}}>
              {isAllView ? 'Добавьте первое блюдо в любой раздел' : 'Используйте зелёную кнопку выше'}
            </div>
          </div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {displayMenu.map((item, i) => (
              <div key={item.id} style={{
                display:'flex',gap:12,padding:'14px 15px',
                background:'linear-gradient(160deg,#0C1C0F 0%,#091508 100%)',
                border:`1px solid ${item.inStock ? '#162B1A' : 'rgba(255,69,69,.35)'}`,
                borderRadius:18,animation:`fadeUp .35s ease ${i * .05}s both`,
                opacity:item.inStock ? 1 : .75,
                boxShadow:'0 4px 20px rgba(0,0,0,.22)',
              }}>
                <div style={{
                  width:68,height:68,borderRadius:14,background:'#0C1C0F',
                  display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,flexShrink:0,
                  position:'relative',overflow:'hidden',border:'1px solid #162B1A',
                }}>
                  {(item as { photo?: string }).photo
                    ? <img src={(item as { photo?: string }).photo} alt={item.name} style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
                    : <span style={{fontSize:30}}>{item.e}</span>
                  }
                  {!item.inStock && (
                    <div style={{position:'absolute',inset:0,borderRadius:14,background:'rgba(0,0,0,.65)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:800,color:'#FF4545'}}>
                      СТОП
                    </div>
                  )}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:2,flexWrap:'wrap'}}>
                    <div style={{fontSize:13,fontWeight:800}}>{item.name}</div>
                    {isAllView && (
                      <button type="button" onClick={() => setActiveCat(item.cat)} className="btn"
                        style={{
                          padding:'2px 8px',borderRadius:20,fontSize:9,fontWeight:800,
                          background:'rgba(31,215,96,.1)',border:'1px solid rgba(31,215,96,.25)',color:'#1FD760',
                        }}>
                        {categoryIcon(item.cat)} {item.cat}
                      </button>
                    )}
                  </div>
                  <div style={{fontSize:11,color:'#3D6645',marginBottom:5,lineHeight:1.4}}>{item.desc}</div>
                  <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:900}}>
                    {item.price}<span style={{fontSize:10,color:'#FFB800',marginLeft:2}}>ЅМ</span>
                  </div>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:7,alignItems:'flex-end'}}>
                  <button onClick={() => onToggle(item.id)} className="btn"
                    style={{
                      padding:'5px 11px',borderRadius:9,fontSize:11,fontWeight:700,
                      background:item.inStock ? 'rgba(31,215,96,.12)' : 'rgba(255,69,69,.12)',
                      color:item.inStock ? '#1FD760' : '#FF4545',
                      border:`1px solid ${item.inStock ? 'rgba(31,215,96,.3)' : 'rgba(255,69,69,.3)'}`,
                    }}>
                    {item.inStock ? '✓ Есть' : '✕ Стоп'}
                  </button>
                  <button onClick={() => onRemove(item.id)} className="btn"
                    style={{padding:'4px 10px',borderRadius:8,fontSize:11,background:'rgba(255,69,69,.08)',border:'1px solid rgba(255,69,69,.25)',color:'#FF4545'}}>
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <div style={{position:'fixed',inset:0,zIndex:300,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
          <div onClick={() => setShowAdd(false)} style={{position:'absolute',inset:0,background:'rgba(0,0,0,.85)',backdropFilter:'blur(10px)'}}/>
          <div style={{
            position:'relative',zIndex:1,width:'100%',maxWidth:480,maxHeight:'92vh',
            display:'flex',flexDirection:'column',
            background:'#06100A',borderTop:'1px solid #162B1A',borderRadius:'24px 24px 0 0',
            animation:'slideUp .4s cubic-bezier(.16,1,.3,1)',
          }}>
            <div style={{padding:'16px 20px 0',flexShrink:0}}>
              <div style={{width:40,height:4,borderRadius:2,background:'#1D3822',margin:'0 auto 16px'}}/>
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:4}}>
                <div>
                  <div style={{fontFamily:'Unbounded',fontSize:16,fontWeight:900,marginBottom:4}}>Новое блюдо</div>
                  <div style={{fontSize:12,color:'#8FB897'}}>Заполните карточку — так её увидят клиенты</div>
                </div>
                <button type="button" onClick={() => setShowAdd(false)} className="btn"
                  style={{width:34,height:34,borderRadius:11,background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',fontSize:16}}>
                  ✕
                </button>
              </div>
            </div>

            <div style={{flex:1,overflowY:'auto',padding:'14px 20px 20px'}}>
              {/* Preview */}
              <div style={{marginBottom:18}}>
                <div style={{fontSize:10,color:'#3D6645',marginBottom:8,fontWeight:800,letterSpacing:.5,textTransform:'uppercase'}}>Предпросмотр</div>
                <div style={{
                  display:'flex',gap:12,padding:'12px 14px',background:'#091508',
                  border:'1.5px solid rgba(31,215,96,.25)',borderRadius:15,
                }}>
                  <div style={{
                    width:60,height:60,borderRadius:13,background:'#0C1C0F',border:'1px solid #162B1A',
                    display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden',flexShrink:0,
                  }}>
                    {photo
                      ? <img src={photo} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                      : <span style={{fontSize:28}}>{emoji}</span>
                    }
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:800,marginBottom:2,color:name ? '#EBF5ED' : '#3D6645'}}>
                      {name.trim() || 'Название блюда'}
                    </div>
                    <div style={{fontSize:10,color:'#3D6645',marginBottom:4,lineHeight:1.4}}>
                      {desc.trim() || 'Краткое описание'}
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{fontFamily:'Unbounded',fontSize:13,fontWeight:900,color:priceNum > 0 ? '#1FD760' : '#3D6645'}}>
                        {priceNum > 0 ? priceNum : '—'}<span style={{fontSize:9,color:'#FFB800'}}> ЅМ</span>
                      </span>
                      <span style={{fontSize:10,padding:'2px 8px',borderRadius:20,background:'rgba(31,215,96,.1)',color:'#1FD760',fontWeight:700}}>{cat}</span>
                    </div>
                  </div>
                </div>
              </div>

              {formErr && (
                <div style={{padding:'10px 13px',borderRadius:11,marginBottom:14,background:'rgba(255,69,69,.1)',border:'1px solid rgba(255,69,69,.3)',fontSize:12,color:'#FF4545'}}>
                  ⚠️ {formErr}
                </div>
              )}

              {/* Category chips */}
              <div style={{marginBottom:16}}>
                <div style={{fontSize:11,color:'#8FB897',marginBottom:8,fontWeight:700}}>Раздел меню *</div>
                <div className="hscroll" style={{gap:6}}>
                  {categories.map(c => (
                    <button key={c} type="button" onClick={() => setCat(c)} className="btn"
                      style={{
                        padding:'8px 14px',borderRadius:50,fontSize:12,fontWeight:700,whiteSpace:'nowrap',
                        border:`1.5px solid ${cat === c ? 'rgba(31,215,96,.5)' : '#162B1A'}`,
                        background:cat === c ? 'rgba(31,215,96,.15)' : '#0C1C0F',
                        color:cat === c ? '#1FD760' : '#8FB897',
                      }}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* Photo */}
              <div style={{marginBottom:16}}>
                <div style={{fontSize:11,color:'#8FB897',marginBottom:8,fontWeight:700}}>📷 Фото (необязательно)</div>
                {photo ? (
                  <div style={{position:'relative',width:'100%',height:160,borderRadius:14,overflow:'hidden',border:'1px solid #162B1A'}}>
                    <img src={photo} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                    <button type="button" onClick={() => setPhoto('')} className="btn"
                      style={{position:'absolute',top:8,right:8,width:32,height:32,borderRadius:'50%',background:'rgba(0,0,0,.75)',border:'1px solid rgba(255,255,255,.2)',color:'white',fontSize:14}}>
                      ✕
                    </button>
                  </div>
                ) : (
                  <label className="btn" style={{
                    display:'flex',alignItems:'center',justifyContent:'center',gap:10,
                    width:'100%',padding:'16px',borderRadius:14,
                    border:'2px dashed #1D3822',background:'#0C1C0F',cursor:'pointer',
                  }}>
                    <span style={{fontSize:22}}>📷</span>
                    <div style={{textAlign:'left'}}>
                      <div style={{fontSize:12,color:'#8FB897',fontWeight:700}}>Загрузить фото</div>
                      <div style={{fontSize:10,color:'#3D6645'}}>JPG, PNG · до 5 МБ</div>
                    </div>
                    <input type="file" accept="image/*" onChange={handlePhoto} style={{display:'none'}}/>
                  </label>
                )}
                {photoErr && <div style={{marginTop:6,fontSize:11,color:'#FF4545'}}>⚠️ {photoErr}</div>}
              </div>

              {/* Emoji picker */}
              <div style={{marginBottom:16}}>
                <div style={{fontSize:11,color:'#8FB897',marginBottom:8,fontWeight:700}}>Иконка блюда</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(8,1fr)',gap:6}}>
                  {FOOD_EMOJIS.map(e => (
                    <button key={e} type="button" onClick={() => setEmoji(e)} className="btn"
                      style={{
                        aspectRatio:'1',borderRadius:11,fontSize:22,
                        background:emoji === e ? 'rgba(31,215,96,.18)' : '#0C1C0F',
                        border:`1.5px solid ${emoji === e ? 'rgba(31,215,96,.5)' : '#162B1A'}`,
                        display:'flex',alignItems:'center',justifyContent:'center',
                      }}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{marginBottom:14}}>
                <div style={{fontSize:11,color:'#8FB897',marginBottom:6,fontWeight:700}}>Название *</div>
                <input className="inp" value={name} onChange={e => { setName(e.target.value); setFormErr('') }} placeholder="Например: Плов узбекский"/>
              </div>

              <div style={{marginBottom:14}}>
                <div style={{fontSize:11,color:'#8FB897',marginBottom:6,fontWeight:700}}>Состав / описание</div>
                <textarea className="inp" value={desc} onChange={e => setDesc(e.target.value)} rows={2} placeholder="Граммовка, состав, особенности…" style={{resize:'vertical',minHeight:64}}/>
              </div>

              <div style={{marginBottom:8}}>
                <div style={{fontSize:11,color:'#8FB897',marginBottom:6,fontWeight:700}}>Цена *</div>
                <div style={{position:'relative'}}>
                  <input className="inp" value={price} onChange={e => { setPrice(e.target.value); setFormErr('') }} type="number" min="1" placeholder="0" style={{paddingRight:48}}/>
                  <span style={{position:'absolute',right:14,top:'50%',transform:'translateY(-50%)',fontSize:12,fontWeight:800,color:'#FFB800'}}>ЅМ</span>
                </div>
              </div>
            </div>

            <div style={{padding:'12px 20px 32px',borderTop:'1px solid #162B1A',flexShrink:0,background:'rgba(3,11,5,.97)'}}>
              <button type="button" onClick={save} disabled={!canSave} className="btn"
                style={{
                  width:'100%',padding:15,borderRadius:16,
                  background:canSave ? 'linear-gradient(135deg,#17B34E,#1FD760)' : '#162B1A',
                  border:'none',color:canSave ? '#030B05' : '#3D6645',
                  fontFamily:'Nunito',fontWeight:800,fontSize:15,
                  boxShadow:canSave ? '0 8px 24px rgba(31,215,96,.35)' : 'none',
                }}>
                ✓ Добавить в «{cat}»
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddCat && (
        <div style={{position:'fixed',inset:0,zIndex:310,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
          <div onClick={() => setShowAddCat(false)} style={{position:'absolute',inset:0,background:'rgba(0,0,0,.88)',backdropFilter:'blur(12px)'}}/>
          <div style={{
            position:'relative',zIndex:1,width:'100%',maxWidth:480,maxHeight:'85vh',overflowY:'auto',
            background:'linear-gradient(180deg,#0a180d 0%,#06100A 100%)',
            borderTop:'1px solid rgba(31,215,96,.2)',borderRadius:'28px 28px 0 0',
            padding:'22px 20px 40px',animation:'slideUp .4s cubic-bezier(.16,1,.3,1)',
          }}>
            <div style={{width:44,height:4,borderRadius:2,background:'#1D3822',margin:'0 auto 20px'}}/>
            <div style={{textAlign:'center',marginBottom:20}}>
              <div style={{
                width:56,height:56,borderRadius:18,margin:'0 auto 12px',
                background:'linear-gradient(135deg,rgba(31,215,96,.25),rgba(31,215,96,.08))',
                border:'1px solid rgba(31,215,96,.35)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,
              }}>📂</div>
              <div style={{fontFamily:'Unbounded',fontSize:17,fontWeight:900,marginBottom:4}}>Новый раздел</div>
              <div style={{fontSize:12,color:'#8FB897',lineHeight:1.5}}>Выберите готовый или придумайте своё название</div>
            </div>
            {catErr && (
              <div style={{padding:'10px 13px',borderRadius:12,marginBottom:14,background:'rgba(255,69,69,.1)',border:'1px solid rgba(255,69,69,.3)',fontSize:12,color:'#FF4545',textAlign:'center'}}>
                ⚠️ {catErr}
              </div>
            )}
            {availableSuggestions.length > 0 && (
              <div style={{marginBottom:18}}>
                <div style={{fontSize:10,color:'#3D6645',marginBottom:10,fontWeight:800,letterSpacing:.4,textTransform:'uppercase'}}>Популярные разделы</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
                  {availableSuggestions.slice(0, 9).map(s => (
                    <button key={s} type="button" onClick={() => saveNewCategory(s)} className="btn"
                      style={{
                        padding:'12px 8px',borderRadius:16,textAlign:'center',
                        background:'#091508',border:'1px solid #162B1A',
                      }}>
                      <div style={{fontSize:24,marginBottom:6}}>{categoryIcon(s)}</div>
                      <div style={{fontSize:10,fontWeight:800,color:'#EBF5ED',lineHeight:1.2}}>{s}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div style={{marginBottom:18}}>
              <div style={{fontSize:11,color:'#8FB897',marginBottom:8,fontWeight:700}}>Своё название</div>
              <input className="inp" value={newCatName} onChange={e => { setNewCatName(e.target.value); setCatErr('') }}
                onKeyDown={e => e.key === 'Enter' && saveNewCategory()}
                placeholder="Например: Закуски" autoFocus/>
            </div>
            <button type="button" onClick={() => saveNewCategory()} className="btn"
              style={{
                width:'100%',padding:15,borderRadius:16,
                background:'linear-gradient(135deg,#17B34E,#1FD760)',border:'none',color:'#030B05',fontWeight:800,fontSize:15,
                boxShadow:'0 8px 24px rgba(31,215,96,.35)',marginBottom:10,
                opacity:newCatName.trim() ? 1 : .55,
              }}>
              ✓ Создать раздел
            </button>
            <button type="button" onClick={() => setShowAddCat(false)} className="btn"
              style={{width:'100%',padding:12,borderRadius:14,background:'transparent',border:'none',color:'#8FB897',fontWeight:700,fontSize:13}}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {showRenameCat && (
        <div style={{position:'fixed',inset:0,zIndex:310,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
          <div onClick={() => setShowRenameCat(false)} style={{position:'absolute',inset:0,background:'rgba(0,0,0,.88)',backdropFilter:'blur(12px)'}}/>
          <div style={{
            position:'relative',zIndex:1,width:'100%',maxWidth:480,
            background:'linear-gradient(180deg,#0a180d 0%,#06100A 100%)',
            borderTop:'1px solid rgba(31,215,96,.2)',borderRadius:'28px 28px 0 0',
            padding:'22px 20px 40px',animation:'slideUp .4s cubic-bezier(.16,1,.3,1)',
          }}>
            <div style={{width:44,height:4,borderRadius:2,background:'#1D3822',margin:'0 auto 20px'}}/>
            <div style={{textAlign:'center',marginBottom:20}}>
              <div style={{
                width:56,height:56,borderRadius:18,margin:'0 auto 12px',
                background:'linear-gradient(135deg,rgba(31,215,96,.25),rgba(31,215,96,.08))',
                border:'1px solid rgba(31,215,96,.35)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,
              }}>{categoryIcon(activeCat)}</div>
              <div style={{fontFamily:'Unbounded',fontSize:17,fontWeight:900,marginBottom:4}}>Переименовать</div>
              <div style={{fontSize:12,color:'#8FB897'}}>Сейчас: <span style={{color:'#1FD760',fontWeight:700}}>{activeCat}</span></div>
            </div>
            {catErr && (
              <div style={{padding:'10px 13px',borderRadius:12,marginBottom:14,background:'rgba(255,69,69,.1)',border:'1px solid rgba(255,69,69,.3)',fontSize:12,color:'#FF4545',textAlign:'center'}}>
                ⚠️ {catErr}
              </div>
            )}
            <input className="inp" value={renameCatName} onChange={e => { setRenameCatName(e.target.value); setCatErr('') }}
              onKeyDown={e => e.key === 'Enter' && saveRenameCategory()}
              placeholder="Новое название" autoFocus style={{marginBottom:18}}/>
            <button type="button" onClick={saveRenameCategory} className="btn"
              style={{
                width:'100%',padding:15,borderRadius:16,
                background:'linear-gradient(135deg,#17B34E,#1FD760)',border:'none',color:'#030B05',fontWeight:800,fontSize:15,
                boxShadow:'0 8px 24px rgba(31,215,96,.35)',marginBottom:10,
              }}>
              ✓ Сохранить
            </button>
            <button type="button" onClick={() => setShowRenameCat(false)} className="btn"
              style={{width:'100%',padding:12,borderRadius:14,background:'transparent',border:'none',color:'#8FB897',fontWeight:700,fontSize:13}}>
              Отмена
            </button>
          </div>
        </div>
      )}

      <BottomNav page="menu" onPage={onPage} newOrders={0} reviewBadge={reviewBadge}/>
    </div>
  )
}

/* ══════════════════════════════════════════════════════
   ОТЗЫВЫ
══════════════════════════════════════════════════════ */
function ReviewsPage({ rest, reviews, onPage, onRefresh, onMarkSeen, reviewBadge = 0 }) {
  const [replyId, setReplyId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const Stars = ({ n }: { n: number }) => (
    <span>{[1, 2, 3, 4, 5].map(i => <span key={i} style={{ color: i <= n ? '#FFB800' : '#1D3822', fontSize: 14 }}>★</span>)}</span>
  );

  const saveReply = async (id: number) => {
    const text = replyText.trim();
    if (!text) return;
    if (USE_API) {
      try {
        await api.updateReview(id, { restReply: text, restSeen: true });
      } catch { return; }
    }
    setReviews(rs => rs.map(r => r.id === id ? { ...r, restReply: text, restSeen: true } : r));
    setReplyId(null);
    setReplyText('');
  };

  return (
    <div style={{ minHeight: '100vh', background: '#030B05', paddingBottom: 90 }}>
      <Header rest={rest} isOpen={true} onPage={onPage} showBack backPage="dashboard" title="Отзывы клиентов"/>
      <div style={{ padding: '14px 18px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
          {[
            { l: 'Всего', v: reviews.length, c: '#EBF5ED' },
            { l: 'Новых', v: reviews.filter(r => !r.restSeen).length, c: '#FF4545' },
            { l: 'Рейтинг', v: reviews.length ? `${(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)} ★` : `${rest?.rating} ★`, c: '#FFB800' },
          ].map((s, i) => (
            <div key={i} style={{ background: '#091508', border: '1px solid #162B1A', borderRadius: 14, padding: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#8FB897', marginBottom: 4 }}>{s.l}</div>
              <div style={{ fontFamily: 'Unbounded', fontSize: 16, fontWeight: 900, color: s.c }}>{s.v}</div>
            </div>
          ))}
        </div>
        {reviews.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#8FB897' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>⭐</div>
            <div style={{ fontFamily: 'Unbounded', fontSize: 15, fontWeight: 800, marginBottom: 6 }}>Пока нет отзывов</div>
            <div style={{ fontSize: 12 }}>Клиенты смогут оценить заказ после доставки</div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {reviews.map((rev, i) => (
            <div key={rev.id} onClick={() => !rev.restSeen && onMarkSeen(rev.id)} style={{ background: '#091508', border: `1.5px solid ${!rev.restSeen ? 'rgba(255,184,0,.35)' : rev.rating <= 2 ? 'rgba(255,69,69,.3)' : '#162B1A'}`, borderRadius: 16, padding: '14px 16px', animation: `fadeUp .4s ease ${i * .05}s both` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#0F8A3A,#1FD760)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Unbounded', fontSize: 13, fontWeight: 900, color: '#030B05' }}>{rev.client.charAt(0)}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{rev.client}</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2 }}>
                      <Stars n={rev.rating} />
                      <span style={{ fontSize: 10, color: '#3D6645' }}>{rev.date}</span>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  {!rev.restSeen && <span style={{ fontSize: 9, fontWeight: 800, color: '#FFB800', background: 'rgba(255,184,0,.12)', padding: '2px 7px', borderRadius: 6 }}>НОВЫЙ</span>}
                  {rev.urgent && <span style={{ fontSize: 9, fontWeight: 800, color: '#FF4545', background: 'rgba(255,69,69,.12)', padding: '2px 7px', borderRadius: 6 }}>СРОЧНО</span>}
                  {rev.orderId && <span style={{ fontSize: 10, color: '#3D6645' }}>{rev.orderId}</span>}
                </div>
              </div>
              <div style={{ fontSize: 13, color: '#EBF5ED', lineHeight: 1.55, padding: '10px 12px', background: '#0C1C0F', borderRadius: 10, border: '1px solid #162B1A', marginBottom: 10 }}>
                "{rev.text || 'Без комментария'}"
              </div>
              {rev.adminReply && (
                <div style={{ fontSize: 11, color: '#3B8EF0', marginBottom: 8, padding: '8px 10px', background: 'rgba(59,142,240,.08)', borderRadius: 8 }}>💬 КАКАПО: {rev.adminReply}</div>
              )}
              {rev.restReply && (
                <div style={{ fontSize: 11, color: '#1FD760', marginBottom: 8, padding: '8px 10px', background: 'rgba(31,215,96,.08)', borderRadius: 8 }}>✓ Ваш ответ: {rev.restReply}</div>
              )}
              {replyId === rev.id ? (
                <div onClick={e => e.stopPropagation()}>
                  <textarea className="inp" value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="Ответ клиенту…" rows={2} style={{ marginBottom: 8, resize: 'vertical' }} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => saveReply(rev.id)} className="btn" style={{ flex: 1, padding: '10px', borderRadius: 11, background: 'linear-gradient(135deg,#17B34E,#1FD760)', border: 'none', color: '#030B05', fontWeight: 800, fontSize: 12 }}>Отправить</button>
                    <button onClick={() => { setReplyId(null); setReplyText(''); }} className="btn" style={{ padding: '10px 14px', borderRadius: 11, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', fontSize: 12 }}>✕</button>
                  </div>
                </div>
              ) : (
                <button onClick={e => { e.stopPropagation(); setReplyId(rev.id); setReplyText(rev.restReply || ''); onMarkSeen(rev.id); }} className="btn" style={{ padding: '8px 14px', borderRadius: 10, background: 'rgba(59,142,240,.1)', border: '1px solid rgba(59,142,240,.3)', color: '#3B8EF0', fontSize: 12, fontWeight: 700 }}>
                  💬 Ответить клиенту
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      <BottomNav page="reviews" onPage={onPage} newOrders={0} reviewBadge={reviewBadge}/>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   СТАТИСТИКА
══════════════════════════════════════════════════════ */
function StatsPage({rest, orders, onPage, reviewBadge = 0}) {
  const delivered = orders.filter(o=>o.status==='delivered');
  const revenue   = delivered.reduce((s,o)=>s+o.total,0);
  const commission= Math.round(revenue*rest?.commission/100);
  const myShare   = revenue - commission;

  const topDishes: Record<string, number> = {};
  delivered.forEach(o=>o.items.forEach(it=>{
    topDishes[it.name] = (topDishes[it.name]||0) + it.qty;
  }));
  const top = Object.entries(topDishes).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const WEEK = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  const weekData = WEEK.map((_,i)=>Math.round(revenue/7*(0.7+Math.random()*0.6)));
  const maxW = Math.max(...weekData);

  return (
    <div style={{minHeight:'100vh',background:'#030B05',paddingBottom:90}}>
      <Header rest={rest} isOpen={true} onPage={onPage} showBack backPage="dashboard" title="Статистика"/>

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
              <div style={{fontSize:10,color:'#3D6645',marginBottom:4}}>Комиссия КАКАПО {rest?.commission}%</div>
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

      <BottomNav page="stats" onPage={onPage} newOrders={0} reviewBadge={reviewBadge}/>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   НАСТРОЙКИ
══════════════════════════════════════════════════════ */
function SettingsPage({rest, isOpen, onToggleOpen, onPage, onLogout, reviewBadge = 0}) {
  const [notifs, setNotifs] = useState(true);
  const [sound,  setSound]  = useState(true);

  const Tog = ({on, onToggle}) => (
    <div onClick={onToggle} style={{width:44,height:24,borderRadius:12,background:on?'#1FD760':'#1D3822',position:'relative',cursor:'pointer',transition:'background .2s',flexShrink:0}}>
      <div style={{position:'absolute',top:3,left:on?23:3,width:18,height:18,borderRadius:'50%',background:'white',transition:'left .2s'}}/>
    </div>
  );

  return (
    <div style={{minHeight:'100vh',background:'#030B05',paddingBottom:90}}>
      <Header rest={rest} isOpen={isOpen} onToggleOpen={onToggleOpen} onPage={onPage} showBack backPage="dashboard" title="Настройки"/>

      <div style={{padding:'16px 18px',display:'flex',flexDirection:'column',gap:12}}>
        {/* Restaurant status */}
        <div style={{background:'#091508',border:'1px solid #162B1A',borderRadius:16,padding:'16px'}}>
          <div style={{fontFamily:'Unbounded',fontSize:13,fontWeight:800,marginBottom:14}}>Статус ресторана</div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 14px',borderRadius:13,background:isOpen?'rgba(31,215,96,.06)':'rgba(255,69,69,.06)',border:`1px solid ${isOpen?'rgba(31,215,96,.2)':'rgba(255,69,69,.2)'}`}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:isOpen?'#1FD760':'#FF4545'}}>{isOpen?'🟢 Ресторан открыт':'🔴 Ресторан закрыт'}</div>
              <div style={{fontSize:11,color:'#8FB897',marginTop:2}}>{isOpen?'Клиенты могут делать заказы':'Заказы не принимаются'}</div>
            </div>
            <Tog on={isOpen} onToggle={onToggleOpen}/>
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
            {l:'Push при новом заказе', on:notifs, onToggle:() => setNotifs(v => !v)},
            {l:'Звук при новом заказе', on:sound,  onToggle:() => setSound(v => !v)},
          ].map((r,i,arr)=>(
            <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'11px 0',borderBottom:i<arr.length-1?'1px solid #162B1A':'none'}}>
              <span style={{fontSize:13,fontWeight:600}}>{r.l}</span>
              <Tog on={r.on} onToggle={r.onToggle}/>
            </div>
          ))}
        </div>

        {/* Contract info */}
        <div style={{background:'rgba(255,69,69,.06)',border:'1px solid rgba(255,69,69,.2)',borderRadius:16,padding:'16px'}}>
          <div style={{fontFamily:'Unbounded',fontSize:13,fontWeight:800,color:'#FF4545',marginBottom:10}}>Условия договора</div>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
            <span style={{fontSize:12,color:'#8FB897'}}>Комиссия КАКАПО</span>
            <span style={{fontSize:13,fontWeight:800,color:'#FF4545'}}>{rest?.commission}%</span>
          </div>
          <div style={{fontSize:11,color:'#3D6645',lineHeight:1.6}}>
            С каждого заказа КАКАПО удерживает {rest?.commission}% как комиссию за платформу, маркетинг и доставку. Вопросы: +992 118 55-97-97
          </div>
        </div>

        {/* Logout */}
        <button onClick={onLogout} className="btn" style={{padding:'14px',borderRadius:14,background:'rgba(255,69,69,.1)',border:'1.5px solid rgba(255,69,69,.3)',color:'#FF4545',fontFamily:'Nunito',fontWeight:700,fontSize:14}}>
          🚪 Выйти из кабинета
        </button>
      </div>

      <BottomNav page="settings" onPage={onPage} newOrders={0} reviewBadge={reviewBadge}/>
    </div>
  );
}
