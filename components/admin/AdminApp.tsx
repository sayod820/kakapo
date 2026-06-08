'use client'
import { useState, useEffect } from 'react'
import { useOrders, useProducts, useRestaurants, useAuth } from '@/lib/store'
import Link from 'next/link'
// ─── KAKAPO Admin App ────────────────────────────
/* ══════════════════════════════════════════════════════
   KAKAPO ADMIN — Единая панель управления
   Магазин + Рестораны + Курьеры + Сборщики
   г. Яван, Таджикистан
══════════════════════════════════════════════════════ */
// React hooks imported above

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@700;800;900&family=Nunito:wght@400;600;700;800&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html,body{background:#030B05;color:#EBF5ED;font-family:'Nunito',sans-serif;-webkit-font-smoothing:antialiased;}
  .ub{font-family:'Unbounded',sans-serif;}
  .btn{cursor:pointer;border:none;transition:all .18s;}.btn:active{transform:scale(.97);}
  .ac{background:#091508;border:1px solid #162B1A;border-radius:14px;overflow:hidden;}
  .at{width:100%;border-collapse:collapse;}
  .at th{padding:9px 14px;text-align:left;font-size:10px;font-weight:800;color:#3D6645;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #162B1A;}
  .at td{padding:11px 14px;border-bottom:1px solid rgba(22,43,26,.4);font-size:13px;vertical-align:middle;}
  .at tr:last-child td{border-bottom:none;}
  .at tr:hover td{background:rgba(31,215,96,.03);}
  .ai{background:#0C1C0F;border:1.5px solid #162B1A;border-radius:10px;color:#EBF5ED;font-family:'Nunito',sans-serif;font-size:13px;outline:none;padding:9px 13px;transition:border-color .2s;width:100%;}
  .ai:focus{border-color:rgba(31,215,96,.5);}
  .ai::placeholder{color:#3D6645;}
  .ab{font-family:'Nunito',sans-serif;font-weight:700;cursor:pointer;border:none;transition:all .2s;border-radius:10px;padding:8px 16px;font-size:13px;}
  .ab:active{transform:scale(.97);}
  .abp{background:linear-gradient(135deg,#17B34E,#1FD760);color:#030B05;}
  .abg{background:rgba(31,215,96,.09);color:#1FD760;border:1.5px solid rgba(31,215,96,.28);}
  .abd{background:rgba(255,69,69,.1);color:#FF4545;border:1px solid rgba(255,69,69,.3);}
  .amod{position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;padding:16px;}
  .amodbg{position:absolute;inset:0;background:rgba(0,0,0,.85);backdrop-filter:blur(10px);}
  .amodbox{position:relative;z-index:1;background:#06100A;border:1px solid #162B1A;border-radius:20px;padding:24px;width:100%;max-width:640px;max-height:90vh;overflow-y:auto;animation:fadeIn .3s ease;}
  @keyframes fadeIn{from{opacity:0;transform:scale(.97);}to{opacity:1;transform:scale(1);}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}
  @keyframes spin{from{transform:rotate(0);}to{transform:rotate(360deg);}}
  @keyframes pulse{0%,100%{opacity:1;}50%{opacity:.4;}}
  @keyframes ping{0%{transform:scale(1);opacity:1;}100%{transform:scale(2);opacity:0;}}
  ::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-track{background:#06100A;}::-webkit-scrollbar-thumb{background:#1D3822;border-radius:2px;}
`;

/* ── DATA ──────────────────────────────────────────── */
const RESTAURANTS = [
  {id:'R-01',name:'Чайхона Оромгох',emoji:'🍖',cuisine:'Таджикская',address:'ул. Рудаки, 15',phone:'+992 93 111 22 33',email:'chaihona@kakapo.tj',commission:15,open:true,rating:4.8,reviews:312,ordersMonth:187,revenueMonth:8450,img:'linear-gradient(135deg,#2A1506,#4A2A0C)',
   menu:[{id:1,cat:'Горячее',e:'🍚',name:'Плов',price:18,inStock:true},{id:2,cat:'Шашлык',e:'🥩',name:'Шашлык говяжий',price:22,inStock:true},{id:3,cat:'Супы',e:'🍲',name:'Шурпо',price:12,inStock:true},{id:4,cat:'Супы',e:'🍜',name:'Лагман',price:14,inStock:false},{id:5,cat:'Горячее',e:'🥟',name:'Манты',price:16,inStock:true}]},
  {id:'R-02',name:'Пицца Яван',emoji:'🍕',cuisine:'Итальянская',address:'ул. Ленина, 28',phone:'+992 90 222 33 44',email:'pizza@kakapo.tj',commission:18,open:true,rating:4.6,reviews:187,ordersMonth:143,revenueMonth:6240,img:'linear-gradient(135deg,#1A0808,#3A1010)',
   menu:[{id:1,cat:'Пицца',e:'🍕',name:'Маргарита',price:28,inStock:true},{id:2,cat:'Пицца',e:'🍕',name:'Пепперони',price:32,inStock:true},{id:3,cat:'Бургеры',e:'🍔',name:'Классик бургер',price:22,inStock:true}]},
  {id:'R-03',name:'Суши Яван',emoji:'🍣',cuisine:'Японская',address:'ул. Сомони, 8',phone:'+992 91 333 44 55',email:'sushi@kakapo.tj',commission:20,open:true,rating:4.9,reviews:94,ordersMonth:98,revenueMonth:5390,img:'linear-gradient(135deg,#0A0A1A,#1A1A3A)',
   menu:[{id:1,cat:'Роллы',e:'🌯',name:'Филадельфия',price:32,inStock:true},{id:2,cat:'Роллы',e:'🌯',name:'Дракон',price:36,inStock:true}]},
  {id:'R-04',name:'Фаст-фуд 24/7',emoji:'🍟',cuisine:'Фаст-фуд',address:'Центральный рынок',phone:'+992 88 444 55 66',email:'fastfood@kakapo.tj',commission:12,open:false,rating:4.3,reviews:521,ordersMonth:312,revenueMonth:4120,img:'linear-gradient(135deg,#1A1000,#3A2200)',
   menu:[{id:1,cat:'Бургеры',e:'🍔',name:'Двойной бургер',price:16,inStock:true},{id:2,cat:'Хот-доги',e:'🌭',name:'Хот-дог',price:8,inStock:true}]},
];

const COURIERS = [
  {id:'C-01',name:'Фирдавс Назаров',phone:'+992 93 111 22 33',vehicle:'🏍 Мото',num:'TJ 1234 AA',status:'busy',rating:4.9,orders:342,today:42,week:310},
  {id:'C-02',name:'Баходур Кодиров',phone:'+992 90 222 33 44',vehicle:'🚲 Вело',num:'—',status:'available',rating:4.7,orders:187,today:28,week:195},
  {id:'C-03',name:'Рустам Холов',phone:'+992 91 333 44 55',vehicle:'🚗 Авто',num:'TJ 5678 BB',status:'available',rating:4.8,orders:521,today:56,week:420},
  {id:'C-04',name:'Зубайр Рахимов',phone:'+992 88 444 55 66',vehicle:'🏍 Мото',num:'TJ 9012 CC',status:'offline',rating:4.6,orders:98,today:0,week:145},
];

const ASSEMBLERS = [
  {id:'A-01',name:'Камола Юсупова',phone:'+992 93 500 11 22',status:'working',ordersToday:12,avgTime:'7 мин',rating:4.9},
  {id:'A-02',name:'Шахло Рахимова',phone:'+992 93 500 33 44',status:'available',ordersToday:8,avgTime:'9 мин',rating:4.7},
  {id:'A-03',name:'Зарина Холова',phone:'+992 93 500 55 66',status:'offline',ordersToday:0,avgTime:'—',rating:4.5},
];

const ALL_ORDERS = [
  {id:'K-4832',type:'market',    client:'Диловар Р.',  phone:'+992 93 456 78 90',items:'Брокколи, Говядина',   total:64, status:'delivering', courier:'Фирдавс Н.',  assembler:'Камола Ю.',time:'14:23',addr:'ул. Ленина, 42'},
  {id:'K-4831',type:'restaurant',rest:'Чайхона',       client:'Нилуфар Х.',  phone:'+992 90 123 45 67',items:'Лагман, Салат',      total:22, status:'cooking',   courier:'—',           assembler:'—',         time:'14:10',addr:'ул. Сомони, 12'},
  {id:'K-4830',type:'restaurant',rest:'Пицца Яван',    client:'Бахром К.',   phone:'+992 88 789 01 23',items:'Маргарита, Кола',    total:38, status:'cooking',   courier:'—',           assembler:'—',         time:'14:05',addr:'мкр. Мирный, 5'},
  {id:'K-4829',type:'market',    client:'Мадина О.',   phone:'+992 93 321 65 43',items:'Молоко, Сыр, Кофе', total:47, status:'assembling', courier:'Рустам Х.',   assembler:'Шахло Р.', time:'13:55',addr:'ул. Ленина, 18'},
  {id:'K-4828',type:'restaurant',rest:'Суши Яван',     client:'Зафар М.',    phone:'+992 91 654 32 10',items:'Филадельфия ×2',     total:64, status:'new',       courier:'—',           assembler:'—',         time:'13:50',addr:'ул. Рудаки, 8'},
  {id:'K-4820',type:'market',    client:'Рустам Д.',   phone:'+992 91 445 23 11',items:'Говядина, Лосось',   total:66, status:'delivered', courier:'Баходур К.',  assembler:'Камола Ю.',time:'13:20',addr:'ул. Сомони, 5'},
];

const REST_ORDERS = [
  {id:'K-4832',restId:'R-01',client:'Диловар Р.',  phone:'+992 93 456 78 90',items:['🍚 Плов ×2','🥩 Шашлык ×1'],total:58,status:'cooking',  time:'14:23'},
  {id:'K-4831',restId:'R-01',client:'Нилуфар Х.',  phone:'+992 90 123 45 67',items:['🍜 Лагман ×1','🥗 Салат ×1'],  total:22,status:'ready',    time:'14:10'},
  {id:'K-4830',restId:'R-02',client:'Бахром К.',   phone:'+992 88 789 01 23',items:['🍕 Маргарита ×1','🥤 Кола ×2'],total:38,status:'cooking',  time:'14:05'},
  {id:'K-4829',restId:'R-03',client:'Мадина О.',   phone:'+992 91 111 22 33',items:['🌯 Филадельфия ×2'],            total:64,status:'new',       time:'14:01'},
  {id:'K-4828',restId:'R-02',client:'Рустам Д.',   phone:'+992 93 654 32 10',items:['🍔 Бургер ×2','🍟 Картошка ×1'],total:51,status:'delivered', time:'13:40'},
];

const CLIENTS = [
  {id:'U-01',name:'Диловар Рахимов',phone:'+992 93 456 78 90',card:'KAKAPO-0001',level:'platinum',orders:87,spent:3420,debt:1200,bonus:4850,last:'Сегодня'},
  {id:'U-02',name:'Нилуфар Хасанова',phone:'+992 90 123 45 67',card:'KAKAPO-0042',level:'gold',orders:43,spent:1890,debt:0,bonus:1240,last:'Вчера'},
  {id:'U-03',name:'Бахром Каримов',phone:'+992 88 789 01 23',card:'KAKAPO-0118',level:'silver',orders:28,spent:980,debt:0,bonus:560,last:'3 дня назад'},
  {id:'U-04',name:'Зафар Мирзоев',phone:'+992 91 654 32 10',card:'KAKAPO-0234',level:'gold',orders:56,spent:2340,debt:4500,bonus:2100,last:'Сегодня'},
];

const CATS_LIST = [
  {id:'veg',   e:'🥦', name:'Овощи и фрукты'},
  {id:'meat',  e:'🥩', name:'Мясо и птица'},
  {id:'dairy', e:'🥛', name:'Молочное'},
  {id:'bread', e:'🥐', name:'Выпечка и хлеб'},
  {id:'drinks',e:'🧃', name:'Напитки'},
  {id:'grains',e:'🌾', name:'Крупы и бобовые'},
  {id:'frozen',e:'🧊', name:'Заморозка'},
  {id:'sweets',e:'🍫', name:'Сладости'},
  {id:'house', e:'🧴', name:'Бытовая химия'},
];

const PRODS = [
  {id:1, art:'KAK-0001',e:'🥦',name:'Брокколи свежая',   price:5.50, old:7.20, cat:'Овощи',   catId:'veg',   unit:'500 гр',stock:8, hot:true, organic:true, discount:24},
  {id:2, art:'KAK-0002',e:'🍅',name:'Томаты черри',       price:7.90, old:null, cat:'Овощи',   catId:'veg',   unit:'400 гр',stock:3, hot:false,organic:false,discount:0},
  {id:3, art:'KAK-0003',e:'🍊',name:'Апельсины Навел',    price:6.50, old:8.90, cat:'Фрукты',  catId:'veg',   unit:'1 кг',  stock:15,hot:true, organic:false,discount:27},
  {id:4, art:'KAK-0004',e:'🥝',name:'Киви New Zealand',   price:12.0, old:null, cat:'Фрукты',  catId:'veg',   unit:'500 гр',stock:6, hot:false,organic:false,discount:0},
  {id:5, art:'KAK-0005',e:'🍋',name:'Лимоны',             price:4.50, old:null, cat:'Фрукты',  catId:'veg',   unit:'500 гр',stock:20,hot:false,organic:false,discount:0},
  {id:6, art:'KAK-0006',e:'🥩',name:'Говядина вырезка',   price:38.0, old:47.0, cat:'Мясо',    catId:'meat',  unit:'500 гр',stock:5, hot:true, organic:false,discount:19},
  {id:7, art:'KAK-0007',e:'🍗',name:'Куриное филе',       price:16.5, old:null, cat:'Мясо',    catId:'meat',  unit:'1 кг',  stock:12,hot:true, organic:false,discount:0},
  {id:8, art:'KAK-0008',e:'🥓',name:'Бекон копчёный',     price:22.0, old:null, cat:'Мясо',    catId:'meat',  unit:'200 гр',stock:4, hot:false,organic:false,discount:0},
  {id:9, art:'KAK-0009',e:'🍖',name:'Баранина на кости',  price:42.0, old:null, cat:'Мясо',    catId:'meat',  unit:'500 гр',stock:8, hot:false,organic:false,discount:0},
  {id:10,art:'KAK-0010',e:'🥛',name:'Молоко 3.2%',        price:4.90, old:null, cat:'Молочное',catId:'dairy', unit:'1 л',   stock:0, hot:false,organic:false,discount:0},
  {id:11,art:'KAK-0011',e:'🧀',name:'Сыр Российский',     price:18.5, old:null, cat:'Молочное',catId:'dairy', unit:'250 гр',stock:7, hot:true, organic:false,discount:0},
  {id:12,art:'KAK-0012',e:'🥚',name:'Яйца С1',            price:8.90, old:null, cat:'Молочное',catId:'dairy', unit:'10 шт', stock:15,hot:true, organic:false,discount:0},
  {id:13,art:'KAK-0013',e:'🧈',name:'Масло сливочное 82%',price:14.0, old:null, cat:'Молочное',catId:'dairy', unit:'200 гр',stock:9, hot:false,organic:false,discount:0},
  {id:14,art:'KAK-0014',e:'🥐',name:'Круассан с шоколадом',price:2.50,old:null, cat:'Выпечка', catId:'bread', unit:'1 шт',  stock:2, hot:true, organic:false,discount:0},
  {id:15,art:'KAK-0015',e:'🍞',name:'Хлеб пшеничный',     price:3.20, old:null, cat:'Выпечка', catId:'bread', unit:'500 гр',stock:11,hot:false,organic:false,discount:0},
  {id:16,art:'KAK-0016',e:'🥖',name:'Багет французский',  price:4.50, old:null, cat:'Выпечка', catId:'bread', unit:'250 гр',stock:6, hot:false,organic:false,discount:0},
  {id:17,art:'KAK-0017',e:'🧃',name:'Сок апельсиновый',   price:6.80, old:null, cat:'Напитки', catId:'drinks',unit:'1 л',   stock:18,hot:false,organic:false,discount:0},
  {id:18,art:'KAK-0018',e:'☕',name:'Кофе Nescafé Gold',  price:28.0, old:34.0, cat:'Напитки', catId:'drinks',unit:'190 гр',stock:7, hot:true, organic:false,discount:18},
  {id:19,art:'KAK-0019',e:'🌾',name:'Рис Девзира',        price:9.50, old:null, cat:'Крупы',   catId:'grains',unit:'1 кг',  stock:22,hot:false,organic:false,discount:0},
  {id:20,art:'KAK-0020',e:'🫘',name:'Чечевица красная',   price:7.20, old:null, cat:'Крупы',   catId:'grains',unit:'500 гр',stock:14,hot:false,organic:true, discount:0},
  {id:21,art:'KAK-0021',e:'🍫',name:'Шоколад Milka',      price:6.50, old:8.0,  cat:'Сладости',catId:'sweets',unit:'90 гр', stock:10,hot:true, organic:false,discount:19},
  {id:22,art:'KAK-0022',e:'🧁',name:'Печенье Oreo',       price:5.90, old:null, cat:'Сладости',catId:'sweets',unit:'154 гр',stock:8, hot:false,organic:false,discount:0},
  {id:23,art:'KAK-0023',e:'🧴',name:'Шампунь Head&Shoulders',price:18.0,old:null,cat:'Химия',  catId:'house', unit:'400 мл',stock:5, hot:false,organic:false,discount:0},
  {id:24,art:'KAK-0024',e:'🧹',name:'Порошок Tide',       price:24.0, old:29.0, cat:'Химия',   catId:'house', unit:'1 кг',  stock:4, hot:false,organic:false,discount:17},
];

const CARDS_DATA = [
  {num:'KAKAPO-0001',client:'Диловар Рахимов',phone:'+992 93 456 78 90',status:'active',level:'platinum',bonus:4850,debtLimit:3000,debt:1200},
  {num:'KAKAPO-0042',client:'Нилуфар Хасанова',phone:'+992 90 123 45 67',status:'active',level:'gold',bonus:1240,debtLimit:1000,debt:0},
  {num:'KAKAPO-0118',client:'Бахром Каримов',phone:'+992 88 789 01 23',status:'active',level:'silver',bonus:560,debtLimit:0,debt:0},
  {num:'KAKAPO-0099',client:'',phone:'',status:'unlinked',level:'',bonus:0,debtLimit:0,debt:0},
  {num:'KAKAPO-0234',client:'Зафар Мирзоев',phone:'+992 91 654 32 10',status:'active',level:'gold',bonus:2100,debtLimit:2000,debt:4500},
  {num:'KAKAPO-0055',client:'Рустам Давлатов',phone:'+992 90 445 23 11',status:'blocked',level:'gold',bonus:2100,debtLimit:0,debt:0},
];

const REVIEWS = [
  {id:1,restId:'R-01',client:'Зафар М.',rating:2,text:'Долго ждали, еда была холодная',date:'16 мая',status:'new'},
  {id:2,restId:'R-02',client:'Лола К.',rating:5,text:'Отличная пицца! Быстро доставили',date:'15 мая',status:'read'},
  {id:3,restId:'R-01',client:'Нилуфар С.',rating:1,text:'Неправильный заказ привезли',date:'14 мая',status:'new'},
  {id:4,restId:'R-03',client:'Бахром Т.',rating:4,text:'Вкусные роллы, но немного дорого',date:'13 мая',status:'read'},
];

/* ── HELPERS ─────────────────────────────────────── */
const SC_STATUS = {new:{l:'Новый',c:'#FF4545'},assembling:{l:'Собирается',c:'#9B6DFF'},cooking:{l:'Готовится',c:'#FF8C00'},delivering:{l:'В пути',c:'#3B8EF0'},delivered:{l:'Доставлен',c:'#1FD760'},cancelled:{l:'Отменён',c:'#3D6645'}};
const LVC = {bronze:'#CD7F32',silver:'#C0C0C0',gold:'#FFB800',platinum:'#3B8EF0'};

const Tog = ({on,set}) => (
  <div onClick={()=>set(v=>!v)} style={{width:44,height:24,borderRadius:12,background:on?'#1FD760':'#1D3822',position:'relative',cursor:'pointer',transition:'background .2s',flexShrink:0}}>
    <div style={{position:'absolute',top:3,left:on?23:3,width:18,height:18,borderRadius:'50%',background:'white',transition:'left .2s'}}/>
  </div>
);

const Badge = ({v,c}) => (
  <span style={{padding:'2px 8px',borderRadius:7,fontSize:10,fontWeight:800,background:`${c}18`,color:c,border:`1px solid ${c}28`}}>{v}</span>
);

const StatCard = ({l,v,c,e,sub}) => (
  <div className="ac" style={{padding:'16px 18px'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
      <div style={{fontSize:11,color:'#8FB897',fontWeight:600}}>{l}</div>
      {e&&<span style={{fontSize:22}}>{e}</span>}
    </div>
    <div className="ub" style={{fontSize:22,fontWeight:900,color:c||'#EBF5ED'}}>{v}</div>
    {sub&&<div style={{fontSize:10,color:'#3D6645',marginTop:4}}>{sub}</div>}
  </div>
);

const NI = ({lbl,val,set,ph='',type='text',suf=''}) => (
  <div>
    <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>{lbl}</div>
    <div style={{position:'relative'}}>
      <input className="ai" type={type} value={val} onChange={e=>set(e.target.value)} placeholder={ph} style={{paddingRight:suf?38:13}}/>
      {suf&&<span style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',fontSize:11,color:'#3D6645',fontWeight:700}}>{suf}</span>}
    </div>
  </div>
);

/* ── NAV ──────────────────────────────────────────── */
const NAV_GROUPS = [
  {g:'Общее',     items:[{id:'dashboard',icon:'📊',l:'Dashboard'},{id:'orders',icon:'📦',l:'Все заказы'}]},
  {g:'Магазин',   items:[{id:'products',icon:'🥦',l:'Товары'},{id:'categories',icon:'📁',l:'Категории'},{id:'inventory',icon:'📋',l:'Склад'},{id:'promos',icon:'💸',l:'Акции'}]},
  {g:'Маркетплейс',items:[{id:'partners',icon:'🍽',l:'Рестораны'},{id:'reviews',icon:'⭐',l:'Отзывы'}]},
  {g:'Команда',   items:[{id:'couriers',icon:'🛵',l:'Курьеры'},{id:'assemblers',icon:'🛒',l:'Сборщики'}]},
  {g:'Клиенты',   items:[{id:'clients',icon:'👥',l:'Клиенты'},{id:'cards',icon:'💳',l:'Карты'},{id:'push',icon:'🔔',l:'Push'}]},
  {g:'Финансы',   items:[{id:'finance',icon:'💰',l:'Финансы'}]},
  {g:'Система',   items:[{id:'settings',icon:'⚙️',l:'Настройки'}]},
];

function Layout({page,setPage,children,title,subtitle}) {
  const newOrders = ALL_ORDERS.filter(o=>o.status==='new').length;
  return (
    <div style={{display:'flex',minHeight:'100vh',background:'#030B05',fontFamily:'Nunito,sans-serif'}}>
      <style>{CSS}</style>
      <aside style={{width:205,flexShrink:0,background:'#06100A',borderRight:'1px solid #162B1A',display:'flex',flexDirection:'column',position:'sticky',top:0,height:'100vh',overflowY:'auto'}}>
        <div style={{padding:'16px 14px',borderBottom:'1px solid #162B1A',display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
          <div style={{width:40,height:40,borderRadius:13,background:'linear-gradient(135deg,#0F8A3A,#1FD760)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:16,fontWeight:900,color:'#030B05',flexShrink:0}}>K</div>
          <div><div className="ub" style={{fontSize:14,fontWeight:900,color:'#1FD760'}}>KAKAPO</div><div style={{fontSize:9,color:'#3D6645'}}>Admin · г. Яван</div></div>
        </div>
        <nav style={{flex:1,padding:'8px',display:'flex',flexDirection:'column',gap:0}}>
          {NAV_GROUPS.map(g=>(
            <div key={g.g} style={{marginBottom:4}}>
              <div style={{fontSize:9,fontWeight:800,color:'#3D6645',textTransform:'uppercase',letterSpacing:1,padding:'6px 10px 3px'}}>{g.g}</div>
              {g.items.map(n=>(
                <button key={n.id} onClick={()=>setPage(n.id)} className="btn"
                  style={{display:'flex',alignItems:'center',gap:9,padding:'9px 11px',borderRadius:10,background:page===n.id?'rgba(31,215,96,.14)':'transparent',border:`1px solid ${page===n.id?'rgba(31,215,96,.22)':'transparent'}`,color:page===n.id?'#1FD760':'#8FB897',fontSize:13,fontWeight:600,textAlign:'left',cursor:'pointer',width:'100%',position:'relative'}}>
                  <span style={{fontSize:16,flexShrink:0}}>{n.icon}</span>{n.l}
                  {n.id==='orders'&&newOrders>0&&<span style={{marginLeft:'auto',width:18,height:18,borderRadius:'50%',background:'#FF4545',fontSize:9,fontWeight:900,color:'white',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',flexShrink:0}}>{newOrders}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div style={{padding:'10px 14px 16px',borderTop:'1px solid #162B1A',fontSize:9,color:'#3D6645',flexShrink:0,lineHeight:1.6}}>
          KAKAPO v2.0<br/>
          🛒 Магазин · 🍽 Рестораны<br/>
          🛵 Курьеры · 🛒 Сборщики
        </div>
      </aside>
      <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0}}>
        <div style={{padding:'12px 24px',borderBottom:'1px solid #162B1A',background:'rgba(3,11,5,.95)',backdropFilter:'blur(16px)',display:'flex',alignItems:'center',gap:12,position:'sticky',top:0,zIndex:50,flexShrink:0}}>
          <div style={{flex:1}}>
            <div className="ub" style={{fontSize:16,fontWeight:900}}>{title}</div>
            {subtitle&&<div style={{fontSize:11,color:'#8FB897',marginTop:1}}>{subtitle}</div>}
          </div>
          <div style={{display:'flex',gap:6}}>
            {[{l:'Магазин',c:'#1FD760'},{l:'Рестораны',c:'#FF8C00'},{l:'Курьеры',c:'#3B8EF0'},{l:'Сборщики',c:'#9B6DFF'}].map((a,i)=>(
              <span key={i} style={{padding:'3px 9px',borderRadius:8,fontSize:10,fontWeight:700,background:`${a.c}14`,color:a.c,border:`1px solid ${a.c}28`}}>{a.l}</span>
            ))}
          </div>
        </div>
        <main style={{flex:1,padding:22,overflowY:'auto'}}>{children}</main>
      </div>
    </div>
  );
}
/* ── ORDERS ─────────────────────────────────────── */
function OrdersPage() {
  const [orders, setOrders] = useState(ALL_ORDERS);
  const [type,   setType]   = useState('all');
  const [status, setStatus] = useState('all');
  const filtered = orders.filter(o=>(type==='all'||o.type===type)&&(status==='all'||o.status===status));
  const nextStatus = {new:'assembling',assembling:'delivering',cooking:'delivering',delivering:'delivered'};
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:10,marginBottom:18}}>
        {['all','new','assembling','delivering','delivered'].map(s=>{
          const cnt = s==='all' ? orders.length : orders.filter(o=>o.status===s).length;
          const sc  = SC_STATUS[s]||{l:'Все',c:'#EBF5ED'};
          return (
            <div key={s} onClick={()=>setStatus(s)} className="ac" style={{padding:'12px 14px',cursor:'pointer',border:`1.5px solid ${status===s?'rgba(31,215,96,.3)':'#162B1A'}`,background:status===s?'rgba(31,215,96,.06)':'#091508'}}>
              <div style={{fontSize:10,color:'#8FB897',marginBottom:5}}>{s==='all'?'Все заказы':sc.l}</div>
              <div className="ub" style={{fontSize:20,fontWeight:900,color:status===s?'#1FD760':sc.c}}>{cnt}</div>
            </div>
          );
        })}
      </div>
      <div style={{display:'flex',gap:8,marginBottom:14}}>
        {[{id:'all',l:'Все типы'},{id:'market',l:'🛒 Магазин'},{id:'restaurant',l:'🍽 Рестораны'}].map(f=>(
          <button key={f.id} onClick={()=>setType(f.id)} className="ab"
            style={{padding:'7px 14px',fontSize:12,background:type===f.id?'rgba(31,215,96,.12)':'#0C1C0F',border:`1.5px solid ${type===f.id?'rgba(31,215,96,.35)':'#162B1A'}`,color:type===f.id?'#1FD760':'#8FB897'}}>
            {f.l}
          </button>
        ))}
      </div>
      <div className="ac">
        <table className="at">
          <thead><tr><th>ID</th><th>Тип</th><th>Клиент</th><th>Состав</th><th>Сумма</th><th>Курьер</th><th>Сборщик</th><th>Статус</th><th>Время</th><th></th></tr></thead>
          <tbody>
            {filtered.map(o=>{
              const s=SC_STATUS[o.status]||{l:o.status,c:'#8FB897'};
              const nxt=nextStatus[o.status];
              return (
                <tr key={o.id}>
                  <td><span className="ub" style={{fontSize:11,color:'#1FD760'}}>{o.id}</span></td>
                  <td><span style={{fontSize:10,padding:'2px 7px',borderRadius:6,background:o.type==='restaurant'?'rgba(255,140,0,.12)':'rgba(31,215,96,.1)',color:o.type==='restaurant'?'#FF8C00':'#1FD760'}}>{o.type==='restaurant'?`🍽 ${o.rest||''}` :'🛒'}</span></td>
                  <td><div style={{fontWeight:600,fontSize:12}}>{o.client}</div><div style={{fontSize:10,color:'#3D6645'}}>{o.phone}</div></td>
                  <td style={{fontSize:11,color:'#8FB897',maxWidth:130}}>{o.items}</td>
                  <td><span className="ub" style={{fontSize:12,fontWeight:800}}>{o.total} ЅМ</span></td>
                  <td style={{fontSize:11,color:'#3B8EF0'}}>{o.courier}</td>
                  <td style={{fontSize:11,color:'#9B6DFF'}}>{o.assembler}</td>
                  <td><Badge v={s.l} c={s.c}/></td>
                  <td style={{fontSize:11,color:'#3D6645'}}>{o.time}</td>
                  <td>{nxt&&<button onClick={()=>setOrders(os=>os.map(x=>x.id===o.id?{...x,status:nxt}:x))} className="ab abg" style={{padding:'4px 9px',fontSize:11}}>→</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── PRODUCTS ───────────────────────────────────── */
function ProductsPage() {
  const [prods,   setProds]   = useState(PRODS);
  const [search,  setSearch]  = useState('');
  const [catFlt,  setCatFlt]  = useState('all');
  const [syncMsg, setSyncMsg] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editP,   setEditP]   = useState(null);
  const [nName,   setNName]   = useState('');
  const [nArt,    setNArt]    = useState('');
  const [nPrice,  setNPrice]  = useState('');
  const [nOld,    setNOld]    = useState('');
  const [nCat,    setNCat]    = useState('veg');
  const [nUnit,   setNUnit]   = useState('');
  const [nEmoji,  setNEmoji]  = useState('📦');
  const [nStock,  setNStock]  = useState('');
  const [nOrganic,setNOrganic]= useState(false);

  const syncGBS = () => { setSyncMsg('loading'); setTimeout(()=>setSyncMsg('ok'),1800); setTimeout(()=>setSyncMsg(''),5000); };

  const filtered = prods.filter(p => {
    const q = search.toLowerCase();
    const matchQ = !search || p.name.toLowerCase().includes(q) || p.art.toLowerCase().includes(q) || p.cat.toLowerCase().includes(q);
    const matchC = catFlt==='all' || p.catId===catFlt;
    return matchQ && matchC;
  });

  const addProd = () => {
    if(!nName||!nPrice) return;
    const newId = Math.max(...prods.map(p=>p.id))+1;
    const nextArt = 'KAK-'+String(newId).padStart(4,'0');
    setProds(ps=>[...ps,{id:newId,art:nArt||nextArt,e:nEmoji,name:nName,price:Number(nPrice),old:nOld?Number(nOld):null,cat:CATS_LIST.find(c=>c.id===nCat)?.name||nCat,catId:nCat,unit:nUnit||'шт',stock:Number(nStock)||0,hot:false,organic:nOrganic,discount:nOld?Math.round((1-Number(nPrice)/Number(nOld))*100):0}]);
    setShowAdd(false); setNName(''); setNArt(''); setNPrice(''); setNOld(''); setNUnit(''); setNStock(''); setNEmoji('📦'); setNOrganic(false);
  };

  const delProd = (id) => setProds(ps=>ps.filter(p=>p.id!==id));

  const cats = CATS_LIST;
  const byCat = cats.map(c=>({...c, count: prods.filter(p=>p.catId===c.id).length}));

  return (
    <div>
      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:12,marginBottom:18}}>
        <StatCard l="Всего позиций" v={prods.length}/>
        <StatCard l="В наличии" v={prods.filter(p=>p.stock>3).length} c="#1FD760"/>
        <StatCard l="Мало (≤3)" v={prods.filter(p=>p.stock>0&&p.stock<=3).length} c="#FFB800"/>
        <StatCard l="Нет в наличии" v={prods.filter(p=>p.stock===0).length} c="#FF4545"/>
        <StatCard l="Со скидкой" v={prods.filter(p=>p.discount>0).length} c="#3B8EF0"/>
      </div>

      {/* Category cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(9,1fr)',gap:8,marginBottom:18}}>
        <div onClick={()=>setCatFlt('all')} style={{padding:'10px 4px',borderRadius:11,background:catFlt==='all'?'rgba(31,215,96,.14)':'#091508',border:`1.5px solid ${catFlt==='all'?'rgba(31,215,96,.35)':'#162B1A'}`,cursor:'pointer',textAlign:'center'}}>
          <div style={{fontSize:20,marginBottom:3}}>🏪</div>
          <div style={{fontSize:9,fontWeight:700,color:catFlt==='all'?'#1FD760':'#8FB897'}}>Все</div>
          <div style={{fontSize:9,color:'#3D6645'}}>{prods.length}</div>
        </div>
        {byCat.map(c=>(
          <div key={c.id} onClick={()=>setCatFlt(c.id)} style={{padding:'10px 4px',borderRadius:11,background:catFlt===c.id?'rgba(31,215,96,.14)':'#091508',border:`1.5px solid ${catFlt===c.id?'rgba(31,215,96,.35)':'#162B1A'}`,cursor:'pointer',textAlign:'center'}}>
            <div style={{fontSize:20,marginBottom:3}}>{c.e}</div>
            <div style={{fontSize:9,fontWeight:700,color:catFlt===c.id?'#1FD760':'#8FB897',lineHeight:1.3}}>{c.name.split(' ')[0]}</div>
            <div style={{fontSize:9,color:'#3D6645'}}>{c.count}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{display:'flex',gap:10,marginBottom:14,alignItems:'center',flexWrap:'wrap'}}>
        <div style={{position:'relative',flex:1,maxWidth:320}}>
          <div style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',fontSize:15,pointerEvents:'none'}}>🔍</div>
          <input className="ai" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Артикул, название, категория..." style={{paddingLeft:38}}/>
        </div>
        {syncMsg==='ok'&&<div style={{fontSize:11,color:'#1FD760',fontWeight:700}}>✓ GBS Market синхронизирован</div>}
        <div style={{marginLeft:'auto',display:'flex',gap:8}}>
          <button onClick={syncGBS} className="ab abg" style={{display:'flex',alignItems:'center',gap:6}}>
            {syncMsg==='loading'?<div style={{width:13,height:13,borderRadius:'50%',border:'2px solid rgba(31,215,96,.3)',borderTopColor:'#1FD760',animation:'spin 1s linear infinite'}}/>:'🔄'}
            {syncMsg==='loading'?'Синхронизация...':'Синх. GBS Market'}
          </button>
          <button onClick={()=>setShowAdd(true)} className="ab abp" style={{display:'flex',alignItems:'center',gap:6}}>+ Добавить товар</button>
        </div>
      </div>

      <div style={{fontSize:12,color:'#3D6645',marginBottom:10}}>Показано {filtered.length} из {prods.length} товаров {catFlt!=='all'?`· ${CATS_LIST.find(c=>c.id===catFlt)?.name}`:''}</div>

      {/* Table */}
      <div className="ac">
        <table className="at">
          <thead><tr><th>Артикул</th><th>Товар</th><th>Категория</th><th>Цена</th><th>Скидка</th><th>Ед.изм.</th><th>Остаток</th><th>Хит</th><th>Орган.</th><th></th></tr></thead>
          <tbody>
            {filtered.map(p=>{
              const sc=p.stock===0?{c:'#FF4545',l:'Нет'}:p.stock<=3?{c:'#FFB800',l:'Мало'}:{c:'#1FD760',l:'Есть'};
              return (
                <tr key={p.id}>
                  <td><span className="ub" style={{fontSize:11,color:'#FFB800',letterSpacing:.5}}>{p.art}</span></td>
                  <td>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div style={{width:34,height:34,borderRadius:9,background:'#162B1A',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>{p.e}</div>
                      <div><div style={{fontWeight:700,fontSize:13}}>{p.name}</div></div>
                    </div>
                  </td>
                  <td><span style={{padding:'2px 7px',borderRadius:7,fontSize:10,fontWeight:700,background:'rgba(59,142,240,.1)',color:'#3B8EF0',border:'1px solid rgba(59,142,240,.2)'}}>{p.cat}</span></td>
                  <td>
                    <div>
                      <div className="ub" style={{fontSize:13,fontWeight:900}}>{p.price.toFixed(2)} <span style={{fontSize:9,color:'#FFB800'}}>ЅМ</span></div>
                      {p.old&&<div style={{fontSize:10,color:'#3D6645',textDecoration:'line-through'}}>{p.old.toFixed(2)} ЅМ</div>}
                    </div>
                  </td>
                  <td>{p.discount>0?<Badge v={`-${p.discount}%`} c="#FF4545"/>:<span style={{color:'#3D6645',fontSize:11}}>—</span>}</td>
                  <td style={{fontSize:11,color:'#8FB897'}}>{p.unit}</td>
                  <td>
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      <div style={{width:45,height:6,borderRadius:3,background:'#162B1A',overflow:'hidden'}}><div style={{height:'100%',width:`${Math.min(100,p.stock/25*100)}%`,background:sc.c,borderRadius:3}}/></div>
                      <span style={{fontSize:12,fontWeight:700,color:sc.c}}>{p.stock}</span>
                    </div>
                  </td>
                  <td>
                    <div onClick={()=>setProds(ps=>ps.map(x=>x.id===p.id?{...x,hot:!x.hot}:x))} style={{width:36,height:20,borderRadius:10,background:p.hot?'#1FD760':'#1D3822',position:'relative',cursor:'pointer',flexShrink:0}}>
                      <div style={{position:'absolute',top:2,left:p.hot?17:2,width:16,height:16,borderRadius:'50%',background:'white',transition:'left .2s'}}/>
                    </div>
                  </td>
                  <td>
                    <div onClick={()=>setProds(ps=>ps.map(x=>x.id===p.id?{...x,organic:!x.organic}:x))} style={{width:36,height:20,borderRadius:10,background:p.organic?'#34D399':'#1D3822',position:'relative',cursor:'pointer',flexShrink:0}}>
                      <div style={{position:'absolute',top:2,left:p.organic?17:2,width:16,height:16,borderRadius:'50%',background:'white',transition:'left .2s'}}/>
                    </div>
                  </td>
                  <td>
                    <div style={{display:'flex',gap:5}}>
                      <button onClick={()=>setEditP(p)} className="ab abg" style={{padding:'4px 9px',fontSize:11}}>✏️</button>
                      <button onClick={()=>delProd(p.id)} className="ab abd" style={{padding:'4px 9px',fontSize:11}}>🗑</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add modal */}
      {showAdd&&(
        <div className="amod">
          <div className="amodbg" onClick={()=>setShowAdd(false)}/>
          <div className="amodbox" style={{maxWidth:580}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
              <div className="ub" style={{fontSize:15,fontWeight:800}}>Добавить товар</div>
              <button onClick={()=>setShowAdd(false)} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:10,fontSize:16}}>✕</button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div style={{display:'grid',gridTemplateColumns:'72px 1fr 1fr',gap:12}}>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Emoji</div><input className="ai" value={nEmoji} onChange={e=>setNEmoji(e.target.value)} style={{textAlign:'center',fontSize:24,height:48}}/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Название *</div><input className="ai" value={nName} onChange={e=>setNName(e.target.value)} placeholder="Название товара"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Артикул</div><input className="ai" value={nArt} onChange={e=>setNArt(e.target.value)} placeholder="KAK-XXXX (авто)"/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Цена (ЅМ) *</div><input className="ai" value={nPrice} onChange={e=>setNPrice(e.target.value)} type="number" placeholder="0.00"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Старая цена (ЅМ)</div><input className="ai" value={nOld} onChange={e=>setNOld(e.target.value)} type="number" placeholder="Для скидки"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Остаток</div><input className="ai" value={nStock} onChange={e=>setNStock(e.target.value)} type="number" placeholder="0"/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div>
                  <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Категория *</div>
                  <select className="ai" value={nCat} onChange={e=>setNCat(e.target.value)} style={{cursor:'pointer'}}>
                    {CATS_LIST.map(c=><option key={c.id} value={c.id}>{c.e} {c.name}</option>)}
                  </select>
                </div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Единица измерения</div><input className="ai" value={nUnit} onChange={e=>setNUnit(e.target.value)} placeholder="500 гр / 1 кг / 1 л ..."/></div>
              </div>
              <div style={{display:'flex',gap:16,padding:'10px 14px',borderRadius:11,background:'#0C1C0F',border:'1px solid #162B1A'}}>
                <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13,fontWeight:600}}>
                  <input type="checkbox" onChange={e=>setNOrganic(e.target.checked)} style={{width:16,height:16,accentColor:'#34D399'}}/>
                  🌿 Органик продукт
                </label>
              </div>
              {nPrice&&nOld&&Number(nOld)>Number(nPrice)&&(
                <div style={{padding:'8px 12px',borderRadius:9,background:'rgba(255,69,69,.07)',border:'1px solid rgba(255,69,69,.2)',fontSize:12,color:'#8FB897'}}>
                  Скидка: <span style={{color:'#FF4545',fontWeight:800}}>-{Math.round((1-Number(nPrice)/Number(nOld))*100)}%</span> · экономия <span style={{color:'#FF4545',fontWeight:700}}>{(Number(nOld)-Number(nPrice)).toFixed(2)} ЅМ</span>
                </div>
              )}
              <button onClick={addProd} className="ab abp" style={{width:'100%',padding:13,fontSize:14,opacity:nName&&nPrice?1:.5}}>✓ Добавить товар</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editP&&(
        <div className="amod">
          <div className="amodbg" onClick={()=>setEditP(null)}/>
          <div className="amodbox" style={{maxWidth:520}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <span style={{fontSize:28}}>{editP.e}</span>
                <div><div className="ub" style={{fontSize:14,fontWeight:800}}>{editP.name}</div><div style={{fontSize:11,color:'#8FB897'}}>{editP.art}</div></div>
              </div>
              <button onClick={()=>setEditP(null)} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:10,fontSize:16}}>✕</button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Цена (ЅМ)</div><input className="ai" defaultValue={editP.price} type="number"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Старая цена (ЅМ)</div><input className="ai" defaultValue={editP.old||''} type="number" placeholder="Без скидки"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Остаток</div><input className="ai" defaultValue={editP.stock} type="number"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Единица</div><input className="ai" defaultValue={editP.unit}/></div>
              </div>
              <div style={{display:'flex',gap:12}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Категория</div>
                  <select className="ai" defaultValue={editP.catId} style={{cursor:'pointer'}}>
                    {CATS_LIST.map(c=><option key={c.id} value={c.id}>{c.e} {c.name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{display:'flex',gap:10}}>
                <button onClick={()=>setEditP(null)} className="ab abp" style={{flex:1,padding:11}}>✓ Сохранить изменения</button>
                <button onClick={()=>{delProd(editP.id);setEditP(null);}} className="ab abd" style={{padding:'11px 16px'}}>🗑 Удалить</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── INVENTORY ──────────────────────────────────── */
function InventoryPage() {
  const out=PRODS.filter(p=>p.stock===0);
  const low=PRODS.filter(p=>p.stock>0&&p.stock<=3);
  return (
    <div>
      {(out.length>0||low.length>0)&&(
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:18}}>
          {out.length>0&&<div style={{padding:'12px 15px',borderRadius:12,background:'rgba(255,69,69,.07)',border:'1px solid rgba(255,69,69,.3)',display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:22}}>🚨</span><div><div style={{fontSize:13,fontWeight:800,color:'#FF4545'}}>Закончилось: {out.length}</div><div style={{fontSize:11,color:'#8FB897'}}>{out.map(p=>p.name).join(', ')}</div></div>
          </div>}
          {low.length>0&&<div style={{padding:'12px 15px',borderRadius:12,background:'rgba(255,184,0,.07)',border:'1px solid rgba(255,184,0,.3)',display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:22}}>⚠️</span><div><div style={{fontSize:13,fontWeight:800,color:'#FFB800'}}>Мало: {low.length}</div><div style={{fontSize:11,color:'#8FB897'}}>Нужно пополнить</div></div>
          </div>}
        </div>
      )}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:16}}>
        <StatCard l="Всего позиций" v={PRODS.length}/>
        <StatCard l="В наличии" v={PRODS.filter(p=>p.stock>3).length} c="#1FD760"/>
        <StatCard l="Мало" v={low.length} c="#FFB800"/>
        <StatCard l="Закончилось" v={out.length} c="#FF4545"/>
      </div>
      <div className="ac">
        <table className="at">
          <thead><tr><th>Артикул</th><th>Товар</th><th>Остаток</th><th>Статус</th><th>Пополнить</th></tr></thead>
          <tbody>
            {PRODS.map(p=>{
              const sc=p.stock===0?{c:'#FF4545',l:'Нет'}:p.stock<=3?{c:'#FFB800',l:'Мало'}:{c:'#1FD760',l:'Есть'};
              return (
                <tr key={p.id}>
                  <td><span className="ub" style={{fontSize:11,color:'#FFB800'}}>{p.art}</span></td>
                  <td><div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:18}}>{p.e}</span><span style={{fontWeight:700}}>{p.name}</span></div></td>
                  <td>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div style={{width:60,height:7,borderRadius:3,background:'#162B1A',overflow:'hidden'}}><div style={{height:'100%',width:`${Math.min(100,p.stock/20*100)}%`,background:sc.c,borderRadius:3}}/></div>
                      <span style={{fontSize:12,fontWeight:700,color:sc.c}}>{p.stock} шт</span>
                    </div>
                  </td>
                  <td><Badge v={sc.l} c={sc.c}/></td>
                  <td><input className="ai" placeholder="Кол-во" type="number" style={{width:90,padding:'5px 9px',fontSize:12}}/></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
/* ── РЕСТОРАНЫ (ПАРТНЁРЫ) ──────────────────────── */
function PartnersPage() {
  const [rests,setRests]=useState(RESTAURANTS.map(r=>({...r})));
  const [sel,setSel]=useState(null);
  const [tab,setTab]=useState('info');
  const [showAdd,setShowAdd]=useState(false);
  const toggleOpen=id=>setRests(rs=>rs.map(r=>r.id===id?{...r,open:!r.open}:r));
  const toggleMenu=(rId,mId)=>setRests(rs=>rs.map(r=>r.id===rId?{...r,menu:r.menu.map(m=>m.id===mId?{...m,inStock:!m.inStock}:m)}:r));
  const totalComm=rests.reduce((s,r)=>s+Math.round(r.revenueMonth*r.commission/100),0);
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        <StatCard l="Партнёров" v={rests.length}/>
        <StatCard l="Открыто" v={rests.filter(r=>r.open).length} c="#1FD760"/>
        <StatCard l="Закрыто" v={rests.filter(r=>!r.open).length} c="#FF4545"/>
        <StatCard l="Комиссия/мес" v={`${totalComm.toLocaleString()} ЅМ`} c="#FFB800"/>
      </div>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:14}}>
        <button onClick={()=>setShowAdd(true)} className="ab abp" style={{display:'flex',alignItems:'center',gap:6}}>+ Добавить ресторан</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:20}}>
        {rests.map((r,i)=>(
          <div key={r.id} className="ac" style={{overflow:'hidden',animation:`fadeUp .4s ease ${i*.07}s both`}}>
            <div style={{height:80,background:r.img,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 15px',position:'relative'}}>
              <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,.35)'}}/>
              <div style={{position:'relative',zIndex:1}}><div className="ub" style={{fontSize:13,fontWeight:900,color:'white',marginBottom:1}}>{r.name}</div><div style={{fontSize:10,color:'rgba(255,255,255,.6)'}}>{r.cuisine} · {r.address}</div></div>
              <span style={{fontSize:32,position:'relative',zIndex:1}}>{r.emoji}</span>
            </div>
            <div style={{padding:'12px 14px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                <div style={{display:'flex',gap:14}}>
                  <div style={{textAlign:'center'}}><div style={{fontSize:9,color:'#3D6645'}}>Заказов</div><div className="ub" style={{fontSize:13,fontWeight:800}}>{r.ordersMonth}</div></div>
                  <div style={{textAlign:'center'}}><div style={{fontSize:9,color:'#3D6645'}}>Выручка</div><div className="ub" style={{fontSize:13,fontWeight:800}}>{(r.revenueMonth/1000).toFixed(1)}k</div></div>
                  <div style={{textAlign:'center'}}><div style={{fontSize:9,color:'#FF4545'}}>Комиссия</div><div className="ub" style={{fontSize:13,fontWeight:800,color:'#FF4545'}}>{r.commission}%</div></div>
                </div>
                <Tog on={r.open} set={()=>toggleOpen(r.id)}/>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>{setSel(r);setTab('info');}} className="ab abg" style={{flex:1,padding:'7px',fontSize:11}}>⚙️ Управление</button>
                <button className="ab" style={{flex:1,padding:'7px',fontSize:11,background:'rgba(255,184,0,.1)',border:'1.5px solid rgba(255,184,0,.3)',color:'#FFB800'}}>💰 Выплата</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {/* Комиссии */}
      <div className="ac">
        <div style={{padding:'12px 16px',borderBottom:'1px solid #162B1A',fontWeight:800,fontSize:13}}>Комиссии за месяц</div>
        <table className="at">
          <thead><tr><th>Ресторан</th><th>Выручка</th><th>Комиссия %</th><th>KAKAPO</th><th>Ресторан получает</th><th></th></tr></thead>
          <tbody>
            {rests.map(r=>(
              <tr key={r.id}>
                <td><div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:18}}>{r.emoji}</span><span style={{fontWeight:700}}>{r.name}</span></div></td>
                <td><span className="ub" style={{fontSize:12}}>{r.revenueMonth.toLocaleString()} ЅМ</span></td>
                <td><div style={{display:'flex',alignItems:'center',gap:6}}><input type="number" defaultValue={r.commission} className="ai" style={{width:60,padding:'4px 8px',fontSize:12,textAlign:'center'}}/><span style={{fontSize:11,color:'#3D6645'}}>%</span></div></td>
                <td><span className="ub" style={{fontSize:12,color:'#1FD760',fontWeight:900}}>{Math.round(r.revenueMonth*r.commission/100).toLocaleString()} ЅМ</span></td>
                <td><span className="ub" style={{fontSize:12}}>{Math.round(r.revenueMonth*(1-r.commission/100)).toLocaleString()} ЅМ</span></td>
                <td><button className="ab" style={{padding:'4px 11px',fontSize:11,background:'rgba(255,184,0,.1)',border:'1px solid rgba(255,184,0,.28)',color:'#FFB800'}}>Выплатить</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Modal управление */}
      {sel&&(
        <div className="amod">
          <div className="amodbg" onClick={()=>setSel(null)}/>
          <div className="amodbox" style={{maxWidth:700}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}><span style={{fontSize:28}}>{sel.emoji}</span><div><div className="ub" style={{fontSize:14,fontWeight:800}}>{sel.name}</div><div style={{fontSize:11,color:'#8FB897'}}>{sel.cuisine} · {sel.address}</div></div></div>
              <button onClick={()=>setSel(null)} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:10,fontSize:16}}>✕</button>
            </div>
            <div style={{display:'flex',gap:6,marginBottom:16,flexWrap:'wrap'}}>
              {[{id:'info',l:'📋 Инфо'},{id:'menu',l:'🍽 Меню'},{id:'orders',l:'📦 Заказы'},{id:'commission',l:'💰 Комиссия'},{id:'access',l:'🔑 Доступ'}].map(t=>(
                <button key={t.id} onClick={()=>setTab(t.id)} className="ab" style={{padding:'6px 13px',fontSize:11,background:tab===t.id?'rgba(31,215,96,.12)':'#0C1C0F',border:`1.5px solid ${tab===t.id?'rgba(31,215,96,.35)':'#162B1A'}`,color:tab===t.id?'#1FD760':'#8FB897'}}>{t.l}</button>
              ))}
            </div>
            {tab==='info'&&(
              <div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
                  {[{l:'Название',v:sel.name},{l:'Кухня',v:sel.cuisine},{l:'Адрес',v:sel.address},{l:'Телефон',v:sel.phone},{l:'Email',v:sel.email},{l:'Часы',v:'09:00–23:00'}].map((f,i)=>(
                    <div key={i}><div style={{fontSize:11,color:'#8FB897',marginBottom:4,fontWeight:700}}>{f.l}</div><input className="ai" defaultValue={f.v}/></div>
                  ))}
                </div>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'11px 14px',borderRadius:11,background:sel.open?'rgba(31,215,96,.07)':'rgba(255,69,69,.07)',border:`1px solid ${sel.open?'rgba(31,215,96,.2)':'rgba(255,69,69,.2)'}`,marginBottom:14}}>
                  <span style={{fontSize:13,fontWeight:700,color:sel.open?'#1FD760':'#FF4545'}}>{sel.open?'🟢 Открыт':'🔴 Закрыт'}</span>
                  <Tog on={sel.open} set={()=>{setSel(s=>({...s,open:!s.open}));toggleOpen(sel.id);}}/>
                </div>
                <div style={{display:'flex',gap:9}}><button className="ab abp" style={{flex:1,padding:10}}>✓ Сохранить</button><button className="ab abd" style={{padding:'10px 15px'}}>🚫 Заблокировать</button></div>
              </div>
            )}
            {tab==='menu'&&(
              <div>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:12}}>
                  <span style={{fontSize:12,color:'#8FB897'}}>{sel.menu.length} блюд · стоп-лист: {sel.menu.filter(m=>!m.inStock).length}</span>
                  <button className="ab abp" style={{padding:'5px 13px',fontSize:11}}>+ Добавить</button>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {sel.menu.map(item=>(
                    <div key={item.id} style={{display:'flex',alignItems:'center',gap:11,padding:'10px 13px',background:'#0C1C0F',borderRadius:11,border:`1px solid ${item.inStock?'#162B1A':'rgba(255,69,69,.3)'}`}}>
                      <div style={{width:38,height:38,borderRadius:9,background:'#162B1A',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>{item.e}</div>
                      <div style={{flex:1}}><div style={{fontSize:13,fontWeight:700}}>{item.name}</div><div style={{fontSize:10,color:'#3D6645'}}>{item.cat}</div></div>
                      <span className="ub" style={{fontSize:12,fontWeight:800,color:'#FFB800'}}>{item.price} ЅМ</span>
                      <button onClick={()=>toggleMenu(sel.id,item.id)} style={{padding:'4px 10px',borderRadius:8,fontSize:11,fontWeight:700,background:item.inStock?'rgba(31,215,96,.12)':'rgba(255,69,69,.12)',color:item.inStock?'#1FD760':'#FF4545',border:`1px solid ${item.inStock?'rgba(31,215,96,.3)':'rgba(255,69,69,.3)'}`,cursor:'pointer',fontFamily:'Nunito'}}>{item.inStock?'✓ Есть':'✕ Стоп'}</button>
                      <button style={{padding:'4px 8px',borderRadius:8,background:'rgba(255,69,69,.08)',border:'1px solid rgba(255,69,69,.25)',color:'#FF4545',cursor:'pointer',fontSize:12}}>🗑</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {tab==='orders'&&(
              <div>
                {ALL_ORDERS.map((o,i)=>{
                  const s=SC_STATUS[o.status]||{l:o.status,c:'#8FB897'};
                  return (
                    <div key={i} style={{padding:'10px 13px',background:'#0C1C0F',borderRadius:11,border:`1px solid ${s.c}20`,marginBottom:8}}>
                      <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span className="ub" style={{fontSize:12,color:'#1FD760'}}>{o.id}</span><div style={{display:'flex',gap:7}}><span className="ub" style={{fontSize:11,fontWeight:800}}>{o.total} ЅМ</span><Badge v={s.l} c={s.c}/></div></div>
                      <div style={{fontSize:11,color:'#8FB897'}}>{o.client} · {o.items}</div>
                    </div>
                  );
                })}
              </div>
            )}
            {tab==='commission'&&(
              <div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
                  {[{l:'Выручка/мес',v:`${sel.revenueMonth.toLocaleString()} ЅМ`,c:'#EBF5ED'},{l:`Комиссия ${sel.commission}%`,v:`${Math.round(sel.revenueMonth*sel.commission/100).toLocaleString()} ЅМ`,c:'#FF4545'},{l:'KAKAPO',v:`${Math.round(sel.revenueMonth*sel.commission/100).toLocaleString()} ЅМ`,c:'#1FD760'},{l:'Ресторан получает',v:`${Math.round(sel.revenueMonth*(1-sel.commission/100)).toLocaleString()} ЅМ`,c:'#FFB800'}].map((s,i)=>(
                    <div key={i} style={{background:'#0C1C0F',borderRadius:11,padding:'13px',border:'1px solid #162B1A'}}><div style={{fontSize:10,color:'#3D6645',marginBottom:5}}>{s.l}</div><div className="ub" style={{fontSize:18,fontWeight:900,color:s.c}}>{s.v}</div></div>
                  ))}
                </div>
                <div style={{marginBottom:12}}><div style={{fontSize:11,color:'#8FB897',marginBottom:8,fontWeight:700}}>Быстрый выбор %</div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{[10,12,15,18,20,25].map(v=><button key={v} className="ab" style={{padding:'7px 14px',fontSize:12,background:sel.commission===v?'rgba(255,69,69,.15)':'#0C1C0F',border:`1.5px solid ${sel.commission===v?'rgba(255,69,69,.4)':'#162B1A'}`,color:sel.commission===v?'#FF4545':'#8FB897'}}>{v}%</button>)}</div></div>
                <button className="ab abp" style={{width:'100%',padding:10}}>✓ Сохранить комиссию</button>
              </div>
            )}
            {tab==='access'&&(
              <div style={{display:'flex',flexDirection:'column',gap:12}}>
                <div style={{padding:'13px 15px',borderRadius:12,background:'rgba(31,215,96,.05)',border:'1px solid rgba(31,215,96,.2)'}}>
                  <div style={{fontWeight:800,fontSize:13,marginBottom:10}}>Данные для входа</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}><div><div style={{fontSize:11,color:'#8FB897',marginBottom:4,fontWeight:700}}>Email</div><input className="ai" defaultValue={sel.email}/></div><div><div style={{fontSize:11,color:'#8FB897',marginBottom:4,fontWeight:700}}>Новый пароль</div><input className="ai" type="password" placeholder="Оставить пустым"/></div></div>
                </div>
                <div style={{padding:'10px 13px',borderRadius:10,background:'rgba(255,184,0,.06)',border:'1px solid rgba(255,184,0,.2)',fontSize:12,color:'#8FB897'}}>💡 Ресторан входит в <span style={{color:'#FFB800',fontWeight:700}}>kakapo-restaurant.jsx</span></div>
                <div style={{display:'flex',gap:9}}><button className="ab abp" style={{flex:1,padding:10}}>✓ Обновить доступ</button><button className="ab" style={{padding:'10px 15px',background:'rgba(59,142,240,.1)',border:'1.5px solid rgba(59,142,240,.3)',color:'#3B8EF0'}}>📧 Письмо</button><button className="ab abd" style={{padding:'10px 15px'}}>🚫 Блок</button></div>
              </div>
            )}
          </div>
        </div>
      )}
      {showAdd&&(
        <div className="amod">
          <div className="amodbg" onClick={()=>setShowAdd(false)}/>
          <div className="amodbox" style={{maxWidth:500}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}><div className="ub" style={{fontSize:14,fontWeight:800}}>Добавить ресторан</div><button onClick={()=>setShowAdd(false)} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:10,fontSize:16}}>✕</button></div>
            <div style={{display:'flex',flexDirection:'column',gap:11}}>
              <div style={{display:'grid',gridTemplateColumns:'66px 1fr',gap:10}}><div><div style={{fontSize:11,color:'#8FB897',marginBottom:4,fontWeight:700}}>Emoji</div><input className="ai" defaultValue="🍽" style={{textAlign:'center',fontSize:22,height:46}}/></div><div><div style={{fontSize:11,color:'#8FB897',marginBottom:4,fontWeight:700}}>Название *</div><input className="ai" placeholder="Название ресторана"/></div></div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                {[{l:'Кухня',p:'Таджикская...'},{l:'Адрес',p:'ул. Ленина, 42'},{l:'Email партнёра *',p:'partner@rest.tj'},{l:'Пароль *',p:'••••••••'},{l:'Телефон',p:'+992 __ ___'},{l:'Комиссия %',p:'15'}].map((f,i)=>(
                  <div key={i}><div style={{fontSize:11,color:'#8FB897',marginBottom:4,fontWeight:700}}>{f.l}</div><input className="ai" placeholder={f.p} type={f.l.includes('Пароль')?'password':f.l.includes('Комиссия')?'number':'text'}/></div>
                ))}
              </div>
              <div style={{padding:'9px 12px',borderRadius:9,background:'rgba(31,215,96,.05)',border:'1px solid rgba(31,215,96,.18)',fontSize:11,color:'#8FB897'}}>📧 Ресторан получит доступ в kakapo-restaurant.jsx</div>
              <button onClick={()=>setShowAdd(false)} className="ab abp" style={{width:'100%',padding:11}}>✓ Добавить партнёра</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── ОТЗЫВЫ ─────────────────────────────────────── */
function ReviewsPage() {
  const [reviews,setReviews]=useState(REVIEWS);
  const Stars=({n})=><span>{[1,2,3,4,5].map(i=><span key={i} style={{color:i<=n?'#FFB800':'#1D3822',fontSize:13}}>★</span>)}</span>;
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        <StatCard l="Всего отзывов" v={reviews.length}/>
        <StatCard l="Новых" v={reviews.filter(r=>r.status==='new').length} c="#FF4545"/>
        <StatCard l="Жалоб (≤2★)" v={reviews.filter(r=>r.rating<=2).length} c="#FF4545"/>
        <StatCard l="Средний рейтинг" v="4.6 ★" c="#FFB800"/>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        {reviews.map((rev,i)=>{
          const rest=RESTAURANTS.find(r=>r.id===rev.restId);
          return (
            <div key={rev.id} className="ac" style={{padding:'15px 17px',border:`1.5px solid ${rev.status==='new'?'rgba(255,69,69,.3)':'#162B1A'}`,animation:`fadeUp .4s ease ${i*.06}s both`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:36,height:36,borderRadius:'50%',background:'linear-gradient(135deg,#0F8A3A,#1FD760)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:13,fontWeight:900,color:'#030B05',flexShrink:0}}>{rev.client.charAt(0)}</div>
                  <div><div style={{fontSize:13,fontWeight:700,marginBottom:2}}>{rev.client}</div><div style={{display:'flex',gap:8,alignItems:'center'}}><Stars n={rev.rating}/><span style={{fontSize:10,color:'#3D6645'}}>{rev.date}</span></div></div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{display:'flex',alignItems:'center',gap:5,padding:'3px 9px',borderRadius:8,background:'rgba(0,0,0,.3)',border:'1px solid #162B1A'}}><span style={{fontSize:14}}>{rest?.emoji}</span><span style={{fontSize:11,color:'#8FB897'}}>{rest?.name}</span></div>
                  {rev.status==='new'&&<Badge v="Новый" c="#FF4545"/>}
                </div>
              </div>
              <div style={{fontSize:13,color:'#EBF5ED',lineHeight:1.6,marginBottom:10,padding:'9px 12px',background:'#0C1C0F',borderRadius:9,border:'1px solid #162B1A'}}>"{rev.text}"</div>
              <div style={{display:'flex',gap:8}}>
                {rev.status==='new'&&<button onClick={()=>setReviews(rs=>rs.map(r=>r.id===rev.id?{...r,status:'read'}:r))} className="ab abg" style={{padding:'5px 12px',fontSize:11}}>✓ Прочитано</button>}
                <button className="ab" style={{padding:'5px 12px',fontSize:11,background:'rgba(59,142,240,.1)',border:'1.5px solid rgba(59,142,240,.3)',color:'#3B8EF0'}}>💬 Ответить</button>
                {rev.rating<=2&&<button className="ab abd" style={{padding:'5px 12px',fontSize:11}}>⚠️ Предупредить ресторан</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── КУРЬЕРЫ ─────────────────────────────────────── */
function CouriersPage() {
  const [showAdd,setShowAdd]=useState(false);
  const SC={available:{l:'Свободен',c:'#1FD760'},busy:{l:'В заказе',c:'#FFB800'},offline:{l:'Офлайн',c:'#3D6645'}};
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        <StatCard l="Всего" v={COURIERS.length}/>
        <StatCard l="Свободных" v={COURIERS.filter(c=>c.status==='available').length} c="#1FD760"/>
        <StatCard l="В заказе" v={COURIERS.filter(c=>c.status==='busy').length} c="#FFB800"/>
        <StatCard l="Офлайн" v={COURIERS.filter(c=>c.status==='offline').length} c="#3D6645"/>
      </div>
      <div className="ac" style={{overflow:'hidden',marginBottom:16}}>
        <div style={{padding:'11px 15px',borderBottom:'1px solid #162B1A',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span style={{fontWeight:800,fontSize:13}}>📍 Live карта</span>
          <div style={{display:'flex',alignItems:'center',gap:5}}><div style={{width:6,height:6,borderRadius:'50%',background:'#1FD760',animation:'pulse 2s infinite'}}/><span style={{fontSize:11,color:'#1FD760',fontWeight:700}}>GPS Live</span></div>
        </div>
        <div style={{height:160,background:'linear-gradient(135deg,#050F08,#091814)',position:'relative',overflow:'hidden'}}>
          <div style={{position:'absolute',inset:0,opacity:.04,background:'repeating-linear-gradient(0deg,transparent,transparent 20px,rgba(31,215,96,1) 20px,rgba(31,215,96,1) 21px),repeating-linear-gradient(90deg,transparent,transparent 20px,rgba(31,215,96,1) 20px,rgba(31,215,96,1) 21px)'}}/>
          <div style={{position:'absolute',left:'44%',top:'40%',display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
            <div style={{width:28,height:28,borderRadius:'50%',background:'linear-gradient(135deg,#0F8A3A,#1FD760)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:11,fontWeight:900,color:'#030B05',boxShadow:'0 0 10px rgba(31,215,96,.6)'}}>K</div>
          </div>
          {COURIERS.filter(c=>c.status!=='offline').map((c,i)=>(
            <div key={c.id} style={{position:'absolute',left:`${18+i*22}%`,top:`${22+i*18}%`,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
              <div style={{width:24,height:24,borderRadius:'50%',background:c.status==='available'?'#3B8EF0':'#FFB800',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,position:'relative',boxShadow:`0 0 8px ${c.status==='available'?'rgba(59,142,240,.6)':'rgba(255,184,0,.6)'}`}}>🛵<div style={{position:'absolute',inset:-2,borderRadius:'50%',border:`2px solid ${c.status==='available'?'#3B8EF0':'#FFB800'}`,animation:'ping 2s ease-out infinite',opacity:.4}}/></div>
              <span style={{fontSize:7,color:'rgba(255,255,255,.5)',background:'rgba(0,0,0,.6)',padding:'1px 3px',borderRadius:3,whiteSpace:'nowrap'}}>{c.name.split(' ')[0]}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}>
        <button onClick={()=>setShowAdd(true)} className="ab abp" style={{display:'flex',alignItems:'center',gap:6}}>+ Добавить курьера</button>
      </div>
      <div className="ac">
        <table className="at">
          <thead><tr><th>Курьер</th><th>Транспорт</th><th>Статус</th><th>Рейтинг</th><th>Сегодня</th><th>Неделя</th><th>Заказов</th><th></th></tr></thead>
          <tbody>
            {COURIERS.map(c=>{const s=SC[c.status];return(
              <tr key={c.id}>
                <td><div style={{display:'flex',alignItems:'center',gap:10}}><div style={{width:34,height:34,borderRadius:'50%',background:'linear-gradient(135deg,#0F8A3A,#1FD760)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:13,fontWeight:900,color:'#030B05',flexShrink:0}}>{c.name.charAt(0)}</div><div><div style={{fontWeight:700,fontSize:13}}>{c.name}</div><div style={{fontSize:11,color:'#8FB897'}}>{c.phone}</div></div></div></td>
                <td style={{fontSize:12,color:'#8FB897'}}>{c.vehicle}<div style={{fontSize:10,color:'#3D6645'}}>{c.num}</div></td>
                <td><Badge v={s.l} c={s.c}/></td>
                <td style={{color:'#FFB800',fontWeight:700}}>★ {c.rating}</td>
                <td><span className="ub" style={{fontSize:12,fontWeight:800,color:'#FFB800'}}>{c.today} ЅМ</span></td>
                <td><span className="ub" style={{fontSize:12}}>{c.week} ЅМ</span></td>
                <td style={{color:'#8FB897'}}>{c.orders}</td>
                <td><div style={{display:'flex',gap:5}}><button className="ab abg" style={{padding:'4px 9px',fontSize:11}}>📱</button><button className="ab abd" style={{padding:'4px 9px',fontSize:11}}>Блок</button></div></td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>
      {showAdd&&(
        <div className="amod">
          <div className="amodbg" onClick={()=>setShowAdd(false)}/>
          <div className="amodbox" style={{maxWidth:400}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}><div className="ub" style={{fontSize:14,fontWeight:800}}>Добавить курьера</div><button onClick={()=>setShowAdd(false)} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:10,fontSize:16}}>✕</button></div>
            <div style={{display:'flex',flexDirection:'column',gap:11}}>
              <NI lbl="ФИО *" val="" set={()=>{}} ph="Имя Фамилия"/>
              <NI lbl="Телефон *" val="" set={()=>{}} ph="+992 __ ___ __ __"/>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:4,fontWeight:700}}>Транспорт</div><select className="ai"><option>🏍 Мотоцикл</option><option>🚲 Велосипед</option><option>🚗 Авто</option></select></div>
                <NI lbl="Номер ТС" val="" set={()=>{}} ph="TJ XXXX XX"/>
              </div>
              <button onClick={()=>setShowAdd(false)} className="ab abp" style={{width:'100%',padding:11}}>✓ Добавить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── СБОРЩИКИ ───────────────────────────────────── */
function AssemblersPage() {
  const [showAdd,setShowAdd]=useState(false);
  const SC={working:{l:'Собирает',c:'#9B6DFF'},available:{l:'Свободен',c:'#1FD760'},offline:{l:'Офлайн',c:'#3D6645'}};
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        <StatCard l="Всего" v={ASSEMBLERS.length}/>
        <StatCard l="Собирают" v={ASSEMBLERS.filter(a=>a.status==='working').length} c="#9B6DFF"/>
        <StatCard l="Свободных" v={ASSEMBLERS.filter(a=>a.status==='available').length} c="#1FD760"/>
        <StatCard l="Офлайн" v={ASSEMBLERS.filter(a=>a.status==='offline').length} c="#3D6645"/>
      </div>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}>
        <button onClick={()=>setShowAdd(true)} className="ab abp">+ Добавить сборщика</button>
      </div>
      <div className="ac">
        <table className="at">
          <thead><tr><th>Сборщик</th><th>Статус</th><th>Заказов сегодня</th><th>Ср. время</th><th>Рейтинг</th><th></th></tr></thead>
          <tbody>
            {ASSEMBLERS.map(a=>{const s=SC[a.status];return(
              <tr key={a.id}>
                <td><div style={{display:'flex',alignItems:'center',gap:10}}><div style={{width:34,height:34,borderRadius:'50%',background:'linear-gradient(135deg,#6B3FD4,#9B6DFF)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:13,fontWeight:900,color:'white',flexShrink:0}}>{a.name.charAt(0)}</div><div><div style={{fontWeight:700,fontSize:13}}>{a.name}</div><div style={{fontSize:11,color:'#8FB897'}}>{a.phone}</div></div></div></td>
                <td><Badge v={s.l} c={s.c}/></td>
                <td><span className="ub" style={{fontSize:13,fontWeight:800,color:'#9B6DFF'}}>{a.ordersToday}</span></td>
                <td style={{color:'#8FB897'}}>{a.avgTime}</td>
                <td style={{color:'#FFB800',fontWeight:700}}>★ {a.rating}</td>
                <td><div style={{display:'flex',gap:5}}><button className="ab abg" style={{padding:'4px 9px',fontSize:11}}>✏️</button><button className="ab abd" style={{padding:'4px 9px',fontSize:11}}>Блок</button></div></td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>
      {showAdd&&(
        <div className="amod">
          <div className="amodbg" onClick={()=>setShowAdd(false)}/>
          <div className="amodbox" style={{maxWidth:380}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}><div className="ub" style={{fontSize:14,fontWeight:800}}>Добавить сборщика</div><button onClick={()=>setShowAdd(false)} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:10,fontSize:16}}>✕</button></div>
            <div style={{display:'flex',flexDirection:'column',gap:11}}>
              <NI lbl="ФИО *" val="" set={()=>{}} ph="Имя Фамилия"/>
              <NI lbl="Телефон *" val="" set={()=>{}} ph="+992 __ ___ __ __"/>
              <div><div style={{fontSize:11,color:'#8FB897',marginBottom:4,fontWeight:700}}>PIN код (4 цифры)</div><input className="ai" type="password" placeholder="••••" maxLength={4}/></div>
              <button onClick={()=>setShowAdd(false)} className="ab abp" style={{width:'100%',padding:11}}>✓ Добавить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── КЛИЕНТЫ ────────────────────────────────────── */
function ClientsPage() {
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        <StatCard l="Всего клиентов" v="1 847"/>
        <StatCard l="С картами" v="234" c="#FFB800"/>
        <StatCard l="VIP (долг)" v={CLIENTS.filter(c=>c.debt>0).length} c="#FF4545"/>
        <StatCard l="Новых за месяц" v="48" c="#1FD760"/>
      </div>
      <div className="ac">
        <table className="at">
          <thead><tr><th>Клиент</th><th>Карта</th><th>Уровень</th><th>Заказов</th><th>Потрачено</th><th>Долг</th><th>Бонусы</th><th>Последний</th></tr></thead>
          <tbody>
            {CLIENTS.map(c=>(
              <tr key={c.id}>
                <td><div style={{display:'flex',alignItems:'center',gap:10}}><div style={{width:32,height:32,borderRadius:'50%',background:'linear-gradient(135deg,#0F8A3A,#1FD760)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:12,fontWeight:900,color:'#030B05',flexShrink:0}}>{c.name.charAt(0)}</div><div><div style={{fontWeight:700,fontSize:13}}>{c.name}</div><div style={{fontSize:11,color:'#8FB897'}}>{c.phone}</div></div></div></td>
                <td><span className="ub" style={{fontSize:11,fontWeight:800,color:'#FFB800'}}>{c.card}</span></td>
                <td><Badge v={c.level} c={LVC[c.level]||'#8FB897'}/></td>
                <td style={{fontWeight:600}}>{c.orders}</td>
                <td><span className="ub" style={{fontSize:12,fontWeight:700}}>{c.spent.toLocaleString()} ЅМ</span></td>
                <td style={{color:c.debt>0?'#FF4545':'#3D6645',fontWeight:c.debt>0?800:400}}>{c.debt>0?`${c.debt.toLocaleString()} ЅМ`:'—'}</td>
                <td style={{color:'#FFB800',fontWeight:600}}>{c.bonus.toLocaleString()} ⭐</td>
                <td style={{fontSize:11,color:'#3D6645'}}>{c.last}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── КАРТЫ ──────────────────────────────────────── */
function CardsPage() {
  const [showGen,setShowGen]=useState(false);
  const [genN,setGenN]=useState('10');
  const [gened,setGened]=useState(false);
  const SC2={active:{l:'Активна',c:'#1FD760'},unlinked:{l:'Не привязана',c:'#FFB800'},blocked:{l:'Заблок.',c:'#FF4545'}};
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        <StatCard l="Всего карт" v={CARDS_DATA.length}/>
        <StatCard l="Активных" v={CARDS_DATA.filter(c=>c.status==='active').length} c="#1FD760"/>
        <StatCard l="Не привязано" v={CARDS_DATA.filter(c=>c.status==='unlinked').length} c="#FFB800"/>
        <StatCard l="Заблокировано" v={CARDS_DATA.filter(c=>c.status==='blocked').length} c="#FF4545"/>
      </div>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}>
        <button onClick={()=>setShowGen(true)} className="ab abp" style={{display:'flex',alignItems:'center',gap:6}}>🃏 Генерировать карты</button>
      </div>
      <div className="ac">
        <table className="at">
          <thead><tr><th>Номер карты</th><th>Клиент</th><th>Статус</th><th>Уровень</th><th>Бонусы</th><th>Лимит долга</th><th>Долг</th><th></th></tr></thead>
          <tbody>
            {CARDS_DATA.map((c,i)=>{const s=SC2[c.status];return(
              <tr key={i}>
                <td><span className="ub" style={{fontSize:11,fontWeight:800,color:'#FFB800'}}>{c.num}</span></td>
                <td style={{fontWeight:600}}>{c.client||<span style={{color:'#3D6645',fontStyle:'italic'}}>Не привязана</span>}</td>
                <td><Badge v={s.l} c={s.c}/></td>
                <td>{c.level?<Badge v={c.level} c={LVC[c.level]||'#8FB897'}/>:'—'}</td>
                <td style={{color:'#FFB800',fontWeight:700}}>{c.bonus>0?`${c.bonus.toLocaleString()} ⭐`:'—'}</td>
                <td style={{color:c.debtLimit>0?'#1FD760':'#3D6645'}}>{c.debtLimit>0?`${c.debtLimit.toLocaleString()} ЅМ`:'Нет'}</td>
                <td style={{color:c.debt>0?'#FF4545':'#3D6645',fontWeight:c.debt>0?800:400}}>{c.debt>0?`${c.debt.toLocaleString()} ЅМ`:'—'}</td>
                <td><div style={{display:'flex',gap:5}}>{c.status==='unlinked'&&<button className="ab abp" style={{padding:'4px 9px',fontSize:11}}>🔗</button>}{c.status==='active'&&<button className="ab abg" style={{padding:'4px 9px',fontSize:11}}>✏️</button>}{c.status!=='blocked'&&<button className="ab abd" style={{padding:'4px 9px',fontSize:11}}>🚫</button>}</div></td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>
      {showGen&&(
        <div className="amod">
          <div className="amodbg" onClick={()=>{setShowGen(false);setGened(false);}}/>
          <div className="amodbox" style={{maxWidth:360}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}><div className="ub" style={{fontSize:14,fontWeight:800}}>Генерация карт</div><button onClick={()=>{setShowGen(false);setGened(false);}} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:10,fontSize:16}}>✕</button></div>
            {!gened?(<><div style={{marginBottom:12}}><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Количество карт</div><input className="ai" value={genN} onChange={e=>setGenN(e.target.value)} type="number" min="1" max="500"/></div><div style={{padding:'10px 12px',borderRadius:9,background:'rgba(255,184,0,.06)',border:'1px solid rgba(255,184,0,.2)',fontSize:12,color:'#8FB897',marginBottom:12}}>Будет создано: KAKAPO-{String(CARDS_DATA.length+1).padStart(4,'0')} – KAKAPO-{String(CARDS_DATA.length+Number(genN)).padStart(4,'0')}</div><button onClick={()=>setGened(true)} className="ab abp" style={{width:'100%',padding:11}}>🃏 Создать {genN} карт</button></>)
            :(<div style={{textAlign:'center',padding:'10px 0'}}><div style={{fontSize:36,marginBottom:10}}>✅</div><div className="ub" style={{fontSize:14,fontWeight:800,color:'#1FD760',marginBottom:6}}>{genN} карт создано!</div><button className="ab abg" style={{width:'100%',padding:10,marginBottom:8}}>📄 Скачать PDF</button><button onClick={()=>{setShowGen(false);setGened(false);}} className="ab" style={{width:'100%',padding:9,background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897'}}>Закрыть</button></div>)}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── КАТЕГОРИИ ──────────────────────────────────── */
function CategoriesPage() {
  const [cats, setCats] = useState([
    {id:'veg',   e:'🥦', name:'Овощи и фрукты',  desc:'Свежие овощи, фрукты',           parentId:null, count:5,  active:true,  order:1},
    {id:'veg_ov',e:'🥕', name:'Овощи',            desc:'Свежие овощи',                   parentId:'veg',count:3,  active:true,  order:1},
    {id:'veg_fr',e:'🍊', name:'Фрукты и ягоды',   desc:'Свежие фрукты',                  parentId:'veg',count:2,  active:true,  order:2},
    {id:'meat',  e:'🥩', name:'Мясо и птица',      desc:'Говядина, курица, баранина',     parentId:null, count:4,  active:true,  order:2},
    {id:'meat_b',e:'🥩', name:'Говядина и баранина',desc:'Свежее мясо',                  parentId:'meat',count:2, active:true,  order:1},
    {id:'meat_p',e:'🍗', name:'Птица',             desc:'Курица, индейка',                parentId:'meat',count:1, active:true,  order:2},
    {id:'meat_k',e:'🌭', name:'Колбасные изделия', desc:'Колбасы, сосиски',              parentId:'meat',count:1, active:true,  order:3},
    {id:'dairy', e:'🥛', name:'Молочное',           desc:'Молоко, сыр, яйца, масло',      parentId:null, count:4,  active:true,  order:3},
    {id:'dairy_m',e:'🥛',name:'Молоко',             desc:'Молоко, кефир, ряженка',        parentId:'dairy',count:2,active:true,  order:1},
    {id:'dairy_s',e:'🧀',name:'Сыры',              desc:'Российский, плавленый',          parentId:'dairy',count:1,active:true,  order:2},
    {id:'dairy_e',e:'🥚',name:'Яйцо',              desc:'Яйца куриные',                  parentId:'dairy',count:1,active:true,  order:3},
    {id:'bread', e:'🥐', name:'Выпечка и хлеб',    desc:'Хлеб, булочки, круассаны',      parentId:null, count:3,  active:true,  order:4},
    {id:'drinks',e:'🧃', name:'Напитки',            desc:'Соки, вода, чай, кофе',          parentId:null, count:2,  active:true,  order:5},
    {id:'sweets',e:'🍫', name:'Сладости',           desc:'Шоколад, печенье, конфеты',     parentId:null, count:2,  active:true,  order:6},
    {id:'house', e:'🧴', name:'Бытовая химия',      desc:'Чистящие средства, порошок',    parentId:null, count:2,  active:true,  order:7},
  ]);

  const [showAdd,   setShowAdd]   = useState(false);
  const [editCat,   setEditCat]   = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const [nEmoji,    setNEmoji]    = useState('📦');
  const [nName,     setNName]     = useState('');
  const [nDesc,     setNDesc]     = useState('');
  const [nParent,   setNParent]   = useState('');

  const roots    = cats.filter(c=>!c.parentId);
  const children = (parentId) => cats.filter(c=>c.parentId===parentId);
  const toggleActive = (id) => setCats(cs=>cs.map(c=>c.id===id?{...c,active:!c.active}:c));
  const deleteCat    = (id) => {
    // also delete children
    setCats(cs=>cs.filter(c=>c.id!==id && c.parentId!==id));
  };
  const toggleCollapse = (id) => setCollapsed(s=>({...s,[id]:!s[id]}));

  const addCat = () => {
    if(!nName) return;
    const newId = nName.toLowerCase().replace(/\s+/g,'_')+Date.now();
    setCats(cs=>[...cs,{id:newId,e:nEmoji,name:nName,desc:nDesc,parentId:nParent||null,count:0,active:true,order:99}]);
    setShowAdd(false); setNName(''); setNDesc(''); setNEmoji('📦'); setNParent('');
  };

  const rootParentOptions = cats.filter(c=>!c.parentId);

  const CatRow = ({cat, depth=0}) => {
    const kids = children(cat.id);
    const isOpen = !collapsed[cat.id];
    return (
      <>
        <tr style={{background:depth>0?'rgba(31,215,96,.03)':'transparent'}}>
          <td>
            <div style={{display:'flex',alignItems:'center',gap:6,paddingLeft:depth*22}}>
              {kids.length>0 && (
                <button onClick={()=>toggleCollapse(cat.id)} className="ab"
                  style={{width:20,height:20,padding:0,background:'#162B1A',border:'none',color:'#8FB897',fontSize:11,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:5,flexShrink:0}}>
                  {isOpen?'▾':'▸'}
                </button>
              )}
              {kids.length===0 && depth>0 && <div style={{width:20,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',color:'#1D3822',fontSize:11}}>└</div>}
              {kids.length===0 && depth===0 && <div style={{width:20,flexShrink:0}}/>}
              <div style={{width:32,height:32,borderRadius:9,background:depth>0?'rgba(31,215,96,.08)':'rgba(31,215,96,.12)',border:'1px solid rgba(31,215,96,.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:17,flexShrink:0}}>{cat.e}</div>
              <div>
                <div style={{fontSize:13,fontWeight:depth>0?600:700}}>{cat.name}</div>
                {cat.desc&&<div style={{fontSize:10,color:'#3D6645'}}>{cat.desc}</div>}
              </div>
            </div>
          </td>
          <td>
            {depth===0
              ? <span style={{padding:'2px 8px',borderRadius:7,fontSize:10,fontWeight:800,background:'rgba(31,215,96,.1)',color:'#1FD760',border:'1px solid rgba(31,215,96,.25)'}}>Родительская</span>
              : <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <span style={{fontSize:10,color:'#3D6645'}}>↳</span>
                  <span style={{padding:'2px 8px',borderRadius:7,fontSize:10,fontWeight:700,background:'rgba(59,142,240,.1)',color:'#3B8EF0',border:'1px solid rgba(59,142,240,.25)'}}>
                    {cats.find(c=>c.id===cat.parentId)?.name}
                  </span>
                </div>
            }
          </td>
          <td>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <span className="ub" style={{fontSize:13,fontWeight:900,color:cat.count>0?'#FFB800':'#3D6645'}}>{cat.count}</span>
              {kids.length>0&&<span style={{fontSize:10,color:'#3D6645'}}>(+{kids.reduce((s,k)=>s+k.count,0)} в подкатегориях)</span>}
            </div>
          </td>
          <td>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <Badge v={cat.active?'Активна':'Скрыта'} c={cat.active?'#1FD760':'#3D6645'}/>
              <Tog on={cat.active} set={()=>toggleActive(cat.id)}/>
            </div>
          </td>
          <td>
            <div style={{display:'flex',gap:6}}>
              <button onClick={()=>setEditCat(cat)} className="ab abg" style={{padding:'4px 9px',fontSize:11}}>✏️</button>
              <button onClick={()=>{setNParent(cat.id);setShowAdd(true);}} className="ab" style={{padding:'4px 9px',fontSize:11,background:'rgba(59,142,240,.1)',border:'1px solid rgba(59,142,240,.3)',color:'#3B8EF0'}} title="Добавить подкатегорию">+ Подкат.</button>
              {cat.count===0&&kids.length===0&&<button onClick={()=>deleteCat(cat.id)} className="ab abd" style={{padding:'4px 9px',fontSize:11}}>🗑</button>}
            </div>
          </td>
        </tr>
        {isOpen && kids.map(kid=><CatRow key={kid.id} cat={kid} depth={depth+1}/>)}
      </>
    );
  };

  return (
    <div>
      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:20}}>
        <StatCard l="Родительских" v={roots.length} c="#1FD760"/>
        <StatCard l="Подкатегорий" v={cats.filter(c=>c.parentId).length} c="#3B8EF0"/>
        <StatCard l="Активных" v={cats.filter(c=>c.active).length} c="#FFB800"/>
        <StatCard l="Товаров всего" v={cats.reduce((s,c)=>s+c.count,0)} c="#EBF5ED"/>
      </div>

      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div style={{fontSize:12,color:'#3D6645'}}>Нажмите <span style={{color:'#3B8EF0',fontWeight:700}}>+ Подкат.</span> рядом с категорией чтобы добавить подкатегорию</div>
        <button onClick={()=>{setNParent('');setShowAdd(true);}} className="ab abp" style={{display:'flex',alignItems:'center',gap:6}}>+ Родительская категория</button>
      </div>

      {/* Tree table */}
      <div className="ac">
        <table className="at">
          <thead><tr><th>Категория</th><th>Тип / Родитель</th><th>Товаров</th><th>Статус</th><th>Действия</th></tr></thead>
          <tbody>
            {roots.map(cat=><CatRow key={cat.id} cat={cat}/>)}
          </tbody>
        </table>
      </div>

      {/* Add modal */}
      {showAdd&&(
        <div className="amod">
          <div className="amodbg" onClick={()=>setShowAdd(false)}/>
          <div className="amodbox" style={{maxWidth:460}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
              <div className="ub" style={{fontSize:15,fontWeight:800}}>{nParent?'Новая подкатегория':'Новая категория'}</div>
              <button onClick={()=>setShowAdd(false)} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:10,fontSize:16}}>✕</button>
            </div>

            {/* Parent selector */}
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,color:'#8FB897',marginBottom:8,fontWeight:700}}>Родительская категория</div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                <button onClick={()=>setNParent('')} className="ab"
                  style={{padding:'7px 14px',fontSize:12,background:!nParent?'rgba(31,215,96,.12)':'#0C1C0F',border:`1.5px solid ${!nParent?'rgba(31,215,96,.35)':'#162B1A'}`,color:!nParent?'#1FD760':'#8FB897'}}>
                  🏪 Без родителя (главная)
                </button>
                {rootParentOptions.map(p=>(
                  <button key={p.id} onClick={()=>setNParent(p.id)} className="ab"
                    style={{padding:'7px 14px',fontSize:12,background:nParent===p.id?'rgba(59,142,240,.12)':'#0C1C0F',border:`1.5px solid ${nParent===p.id?'rgba(59,142,240,.35)':'#162B1A'}`,color:nParent===p.id?'#3B8EF0':'#8FB897'}}>
                    {p.e} {p.name}
                  </button>
                ))}
              </div>
              {nParent&&(
                <div style={{marginTop:8,padding:'8px 12px',borderRadius:10,background:'rgba(59,142,240,.07)',border:'1px solid rgba(59,142,240,.2)',fontSize:12,color:'#3B8EF0'}}>
                  ↳ Подкатегория для: <span style={{fontWeight:700}}>{cats.find(c=>c.id===nParent)?.e} {cats.find(c=>c.id===nParent)?.name}</span>
                </div>
              )}
            </div>

            {/* Preview */}
            {nName&&(
              <div style={{marginBottom:14,padding:'11px 14px',borderRadius:12,background:nParent?'rgba(59,142,240,.06)':'rgba(31,215,96,.06)',border:`1px solid ${nParent?'rgba(59,142,240,.2)':'rgba(31,215,96,.2)'}`,display:'flex',alignItems:'center',gap:10}}>
                {nParent&&<span style={{fontSize:13,color:'#1D3822'}}>└</span>}
                <div style={{width:38,height:38,borderRadius:11,background:nParent?'rgba(59,142,240,.15)':'rgba(31,215,96,.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20}}>{nEmoji}</div>
                <div><div style={{fontSize:13,fontWeight:700}}>{nName}</div><div style={{fontSize:10,color:'#3D6645'}}>{nDesc}</div></div>
              </div>
            )}

            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div style={{display:'grid',gridTemplateColumns:'70px 1fr',gap:12}}>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Emoji</div><input className="ai" value={nEmoji} onChange={e=>setNEmoji(e.target.value)} style={{textAlign:'center',fontSize:24,height:48}}/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Название *</div><input className="ai" value={nName} onChange={e=>setNName(e.target.value)} placeholder={nParent?'Название подкатегории':'Название категории'}/></div>
              </div>
              <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Описание</div><input className="ai" value={nDesc} onChange={e=>setNDesc(e.target.value)} placeholder="Краткое описание"/></div>
              <button onClick={addCat} className="ab abp" style={{width:'100%',padding:12,fontSize:14,opacity:nName?1:.5}}>
                ✓ {nParent?'Создать подкатегорию':'Создать категорию'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editCat&&(
        <div className="amod">
          <div className="amodbg" onClick={()=>setEditCat(null)}/>
          <div className="amodbox" style={{maxWidth:460}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}><span style={{fontSize:26}}>{editCat.e}</span><div className="ub" style={{fontSize:14,fontWeight:800}}>{editCat.name}</div></div>
              <button onClick={()=>setEditCat(null)} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:10,fontSize:16}}>✕</button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div style={{display:'grid',gridTemplateColumns:'70px 1fr',gap:12}}>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Emoji</div><input className="ai" defaultValue={editCat.e} style={{textAlign:'center',fontSize:24,height:48}}/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Название</div><input className="ai" defaultValue={editCat.name}/></div>
              </div>
              <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Описание</div><input className="ai" defaultValue={editCat.desc}/></div>
              {/* Change parent */}
              <div>
                <div style={{fontSize:11,color:'#8FB897',marginBottom:8,fontWeight:700}}>Родительская категория</div>
                <select className="ai" defaultValue={editCat.parentId||''} style={{cursor:'pointer'}}>
                  <option value="">🏪 Без родителя (главная)</option>
                  {rootParentOptions.filter(p=>p.id!==editCat.id).map(p=>(
                    <option key={p.id} value={p.id}>{p.e} {p.name}</option>
                  ))}
                </select>
              </div>
              <button onClick={()=>setEditCat(null)} className="ab abp" style={{width:'100%',padding:12}}>✓ Сохранить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function PromosPage() {
  const [promos,setPromos]=useState([
    {id:1,e:'🥛',t:'Молочная среда',s:'Скидка 30% на молочное',disc:30,on:true,cat:'Магазин'},
    {id:2,e:'🥩',t:'Мясные выходные',s:'Скидка 25% на мясо и птицу',disc:25,on:true,cat:'Магазин'},
    {id:3,e:'🥦',t:'Органик-день',s:'Скидка 20% на органик продукты',disc:20,on:false,cat:'Магазин'},
    {id:4,e:'⚡',t:'Флэш-распродажа',s:'Только до 20:00 сегодня',disc:40,on:true,cat:'Магазин'},
    {id:5,e:'🚀',t:'Бесплатная доставка',s:'При заказе от 30 ЅМ',disc:0,on:true,cat:'Магазин'},
    {id:6,e:'🍽',t:'Скидка в ресторанах',s:'10% в Чайхоне и Суши',disc:10,on:false,cat:'Рестораны'},
    {id:7,e:'🎁',t:'Первый заказ',s:'15% скидка на первый заказ',disc:15,on:true,cat:'Магазин'},
  ]);
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:18}}>
        <StatCard l="Всего акций" v={promos.length}/>
        <StatCard l="Активных" v={promos.filter(p=>p.on).length} c="#1FD760"/>
        <StatCard l="Выключено" v={promos.filter(p=>!p.on).length} c="#3D6645"/>
      </div>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}>
        <button className="ab abp">+ Создать акцию</button>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {promos.map(p=>(
          <div key={p.id} className="ac" style={{padding:'14px 16px',opacity:p.on?1:.6,transition:'opacity .2s'}}>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:44,height:44,borderRadius:13,background:'rgba(31,215,96,.1)',border:'1px solid rgba(31,215,96,.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>{p.e}</div>
              <div style={{flex:1}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
                  <span style={{fontSize:14,fontWeight:800}}>{p.t}</span>
                  {p.disc>0&&<Badge v={`-${p.disc}%`} c="#FF4545"/>}
                  {p.disc===0&&<Badge v="Бесплатная доставка" c="#1FD760"/>}
                  <Badge v={p.cat} c={p.cat==='Рестораны'?'#FF8C00':'#3B8EF0'}/>
                </div>
                <div style={{fontSize:12,color:'#8FB897'}}>{p.s}</div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <span style={{fontSize:11,color:p.on?'#1FD760':'#3D6645',fontWeight:700}}>{p.on?'Вкл':'Выкл'}</span>
                <Tog on={p.on} set={()=>setPromos(ps=>ps.map(x=>x.id===p.id?{...x,on:!x.on}:x))}/>
                <button className="ab abg" style={{padding:'5px 10px',fontSize:11}}>✏️</button>
                <button onClick={()=>setPromos(ps=>ps.filter(x=>x.id!==p.id))} className="ab abd" style={{padding:'5px 10px',fontSize:11}}>🗑</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── PUSH ────────────────────────────────────────── */
function PushPage() {
  const [title,setTitle]=useState('');
  const [body,setBody]=useState('');
  const [target,setTarget]=useState('all');
  const [sent,setSent]=useState(false);
  const [sending,setSending]=useState(false);
  const doSend=()=>{if(!title||!body)return;setSending(true);setTimeout(()=>{setSending(false);setSent(true);},1400);setTimeout(()=>setSent(false),5000);};
  const TARGETS=[{id:'all',l:'Все клиенты',n:1847},{id:'vip',l:'VIP клиенты',n:24},{id:'rest',l:'Посетители ресторанов',n:312},{id:'inactive',l:'Неактивные 30+ дней',n:234}];
  const TEMPLATES=[{e:'🔥',t:'Акция дня!',b:'Скидки до 40% только сегодня!'},{e:'🍽',t:'Новый ресторан!',b:'Суши Яван теперь в KAKAPO!'},{e:'🎁',t:'Бонусы истекают',b:'Ваши бонусы сгорят через 3 дня.'},{e:'🚀',t:'Бесплатная доставка',b:'Сегодня доставляем бесплатно при любом заказе 🎉'}];
  return (
    <div style={{display:'grid',gridTemplateColumns:'1.2fr 1fr',gap:18}}>
      <div style={{display:'flex',flexDirection:'column',gap:14}}>
        <div className="ac" style={{padding:20}}>
          <div className="ub" style={{fontSize:14,fontWeight:800,marginBottom:16}}>Новое уведомление</div>
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,color:'#8FB897',marginBottom:8,fontWeight:700}}>Получатели</div>
            {TARGETS.map(t=>(
              <div key={t.id} onClick={()=>setTarget(t.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 12px',borderRadius:10,background:target===t.id?'rgba(31,215,96,.08)':'#0C1C0F',border:`1.5px solid ${target===t.id?'rgba(31,215,96,.35)':'#162B1A'}`,cursor:'pointer',marginBottom:6}}>
                <div style={{width:16,height:16,borderRadius:'50%',border:`2px solid ${target===t.id?'#1FD760':'#3D6645'}`,background:target===t.id?'#1FD760':'transparent',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
                  {target===t.id&&<svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="#030B05" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                </div>
                <span style={{flex:1,fontSize:13,fontWeight:600,color:target===t.id?'#1FD760':'#EBF5ED'}}>{t.l}</span>
                <span style={{fontSize:11,color:'#3D6645'}}>{t.n.toLocaleString()} чел.</span>
              </div>
            ))}
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:14}}>
            <NI lbl="Заголовок *" val={title} set={setTitle} ph="Краткий заголовок..."/>
            <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Текст *</div><textarea value={body} onChange={e=>setBody(e.target.value)} placeholder="Текст сообщения..." style={{background:'#0C1C0F',border:'1.5px solid #162B1A',borderRadius:10,color:'#EBF5ED',fontFamily:'Nunito',fontSize:13,resize:'none',height:80,outline:'none',padding:'9px 13px',width:'100%'}}/></div>
          </div>
          {(title||body)&&<div style={{marginBottom:14,padding:'11px 13px',borderRadius:12,background:'#0C1C0F',border:'1px solid #162B1A'}}>
            <div style={{fontSize:9,color:'#3D6645',marginBottom:7,fontWeight:700}}>ПРЕДПРОСМОТР</div>
            <div style={{display:'flex',gap:9,alignItems:'flex-start'}}>
              <div style={{width:34,height:34,borderRadius:9,background:'linear-gradient(135deg,#0F8A3A,#1FD760)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:13,fontWeight:900,color:'#030B05',flexShrink:0}}>K</div>
              <div><div style={{fontSize:13,fontWeight:700,marginBottom:2}}>{title||'Заголовок'}</div><div style={{fontSize:11,color:'#8FB897'}}>{body||'Текст'}</div><div style={{fontSize:10,color:'#3D6645',marginTop:3}}>KAKAPO · сейчас</div></div>
            </div>
          </div>}
          <button onClick={doSend} className="ab" style={{width:'100%',padding:12,background:sent?'rgba(31,215,96,.15)':'linear-gradient(135deg,#17B34E,#1FD760)',border:sent?'1.5px solid rgba(31,215,96,.4)':'none',color:sent?'#1FD760':'#030B05',fontFamily:'Nunito',fontWeight:800,fontSize:14,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
            {sending?<div style={{width:18,height:18,borderRadius:'50%',border:'2.5px solid rgba(3,11,5,.3)',borderTopColor:'#030B05',animation:'spin 1s linear infinite'}}/>:sent?'✅ Отправлено!':'📤 Отправить'}
          </button>
        </div>
        <div className="ac" style={{padding:18}}>
          <div className="ub" style={{fontSize:13,fontWeight:800,marginBottom:12}}>Шаблоны</div>
          {TEMPLATES.map((t,i)=>(
            <div key={i} onClick={()=>{setTitle(t.t);setBody(t.b);}} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 11px',borderRadius:10,background:'#0C1C0F',border:'1px solid #162B1A',cursor:'pointer',marginBottom:6,transition:'border-color .15s'}} onMouseEnter={e=>e.currentTarget.style.borderColor='rgba(31,215,96,.3)'} onMouseLeave={e=>e.currentTarget.style.borderColor='#162B1A'}>
              <span style={{fontSize:20}}>{t.e}</span><div style={{flex:1}}><div style={{fontSize:12,fontWeight:700}}>{t.t}</div><div style={{fontSize:10,color:'#3D6645',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.b}</div></div><span style={{fontSize:11,color:'#1FD760',fontWeight:700,flexShrink:0}}>Выбрать</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:14}}>
        <div className="ac" style={{padding:18}}>
          <div className="ub" style={{fontSize:13,fontWeight:800,marginBottom:14}}>Автоматические</div>
          {[{l:'При принятии заказа',on:true},{l:'Курьер выехал',on:true},{l:'Заказ доставлен',on:true},{l:'Заказ из ресторана принят',on:true},{l:'Бонусы начислены',on:true},{l:'Акции дня (9:00)',on:false},{l:'Бонусы истекают',on:false}].map((r,i,arr)=>(
            <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'9px 0',borderBottom:i<arr.length-1?'1px solid #162B1A':'none'}}>
              <span style={{fontSize:12,fontWeight:600}}>{r.l}</span>
              <div style={{width:40,height:22,borderRadius:11,background:r.on?'#1FD760':'#1D3822',position:'relative',cursor:'pointer',flexShrink:0}}><div style={{position:'absolute',top:2,left:r.on?19:2,width:18,height:18,borderRadius:'50%',background:'white',transition:'left .2s'}}/></div>
            </div>
          ))}
        </div>
        <div className="ac" style={{padding:18}}>
          <div className="ub" style={{fontSize:13,fontWeight:800,marginBottom:12}}>История</div>
          {[{t:'Молочная среда! −30%',to:'Все',n:1847,open:34,time:'Ср 10:00'},{t:'Флэш-распродажа!',to:'Gold+',n:390,open:58,time:'Вчера 12:00'},{t:'Новый ресторан!',to:'Все',n:1847,open:22,time:'Вс 09:00'}].map((h,i)=>(
            <div key={i} style={{padding:'9px 0',borderBottom:i<2?'1px solid #162B1A':'none'}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}><span style={{fontSize:12,fontWeight:700}}>{h.t}</span><span style={{fontSize:10,color:'#3D6645'}}>{h.time}</span></div>
              <div style={{display:'flex',gap:8}}><span style={{fontSize:10,color:'#8FB897'}}>{h.to}</span><span style={{fontSize:10,color:'#8FB897'}}>{h.n} чел.</span><span style={{fontSize:10,color:'#1FD760',fontWeight:700}}>{h.open}% открыли</span></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── ФИНАНСЫ ────────────────────────────────────── */
function FinancePage() {
  const restRev  = RESTAURANTS.reduce((s,r)=>s+r.revenueMonth,0);
  const restComm = RESTAURANTS.reduce((s,r)=>s+Math.round(r.revenueMonth*r.commission/100),0);
  const shopRev  = 42600;
  const total    = shopRev + restRev;
  const DAYS=['1','3','5','7','9','11','13','15','16'];
  const shopData=[1240,1890,1540,2100,1780,2340,2560,2920,3580];
  const restData=[640,890,720,1100,980,1240,1380,1560,1890];
  const maxV = Math.max(...shopData,...restData);
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:22}}>
        <StatCard l="Магазин/мес" v={`${shopRev.toLocaleString()} ЅМ`} c="#1FD760" e="🛒"/>
        <StatCard l="Рестораны/мес" v={`${restRev.toLocaleString()} ЅМ`} c="#FF8C00" e="🍽"/>
        <StatCard l="Комиссия KAKAPO" v={`${restComm.toLocaleString()} ЅМ`} c="#FFB800" e="💰"/>
        <StatCard l="Итого оборот" v={`${total.toLocaleString()} ЅМ`} c="#3B8EF0" e="📈"/>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1.5fr 1fr',gap:18,marginBottom:16}}>
        <div className="ac" style={{padding:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
            <div className="ub" style={{fontSize:14,fontWeight:800}}>Выручка по дням</div>
            <div style={{display:'flex',gap:12}}>
              {[{c:'#1FD760',l:'Магазин'},{c:'#FF8C00',l:'Рестораны'}].map((l,i)=>(
                <div key={i} style={{display:'flex',alignItems:'center',gap:5}}><div style={{width:10,height:10,borderRadius:3,background:l.c}}/><span style={{fontSize:11,color:'#8FB897'}}>{l.l}</span></div>
              ))}
            </div>
          </div>
          <div style={{display:'flex',gap:5,alignItems:'flex-end',height:120}}>
            {DAYS.map((d,i)=>(
              <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:3}}>
                <div style={{width:'100%',display:'flex',flexDirection:'column',gap:2}}>
                  <div style={{width:'100%',borderRadius:'3px 3px 0 0',background:'#1FD760',height:`${Math.round(shopData[i]/maxV*90)}px`,opacity:.85}}/>
                  <div style={{width:'100%',borderRadius:'3px 3px 0 0',background:'#FF8C00',height:`${Math.round(restData[i]/maxV*60)}px`,opacity:.85}}/>
                </div>
                <div style={{fontSize:9,color:'#3D6645'}}>{d}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          <div className="ac" style={{padding:16}}>
            <div className="ub" style={{fontSize:13,fontWeight:800,marginBottom:12}}>Выплаты ресторанам</div>
            {RESTAURANTS.map(r=>(
              <div key={r.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid #162B1A'}}>
                <div style={{display:'flex',alignItems:'center',gap:7}}><span style={{fontSize:16}}>{r.emoji}</span><span style={{fontSize:12,fontWeight:600}}>{r.name.split(' ')[0]}</span></div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span className="ub" style={{fontSize:11,fontWeight:700,color:'#FFB800'}}>{Math.round(r.revenueMonth*(1-r.commission/100)).toLocaleString()} ЅМ</span>
                  <button className="ab" style={{padding:'3px 8px',fontSize:10,background:'rgba(255,184,0,.1)',border:'1px solid rgba(255,184,0,.3)',color:'#FFB800'}}>Выплатить</button>
                </div>
              </div>
            ))}
          </div>
          <div style={{display:'flex',gap:8}}>
            <button className="ab abg" style={{flex:1,padding:11,display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>📊 Excel</button>
            <button className="ab abg" style={{flex:1,padding:11,display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>📄 PDF</button>
          </div>
        </div>
      </div>
      <div className="ac">
        <div style={{padding:'12px 16px',borderBottom:'1px solid #162B1A',fontWeight:800,fontSize:13}}>Детализация комиссий</div>
        <table className="at">
          <thead><tr><th>Ресторан</th><th>Выручка</th><th>%</th><th>KAKAPO получает</th><th>К выплате</th></tr></thead>
          <tbody>{RESTAURANTS.map(r=>(
            <tr key={r.id}>
              <td><div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:18}}>{r.emoji}</span><span style={{fontWeight:700}}>{r.name}</span></div></td>
              <td><span className="ub" style={{fontSize:12}}>{r.revenueMonth.toLocaleString()} ЅМ</span></td>
              <td><Badge v={`${r.commission}%`} c="#FF4545"/></td>
              <td><span className="ub" style={{fontSize:12,color:'#1FD760',fontWeight:900}}>{Math.round(r.revenueMonth*r.commission/100).toLocaleString()} ЅМ</span></td>
              <td><span className="ub" style={{fontSize:12,fontWeight:700}}>{Math.round(r.revenueMonth*(1-r.commission/100)).toLocaleString()} ЅМ</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

/* ── НАСТРОЙКИ ──────────────────────────────────── */
function SettingsPage() {
  const [stab,setStab]=useState('gbs');
  const [gbsOn,setGbsOn]=useState(false);
  const [gbsIP,setGbsIP]=useState('http://192.168.1.100');
  const [gbsPort,setGbsPort]=useState('8419');
  const [gbsUser,setGbsUser]=useState('admin');
  const [gbsPass,setGbsPass]=useState('202505290930');
  const [testSt,setTestSt]=useState('');
  const [basePr,setBasePr]=useState('5');
  const [freeAm,setFreeAm]=useState('30');
  const [perKm,setPerKm]=useState('1.5');
  const [freeKm,setFreeKm]=useState('2');
  const [smsP,setSmsP]=useState('smspro');
  const [saved,setSaved]=useState(false);
  const testConn=()=>{setTestSt('loading');setTimeout(()=>setTestSt('ok'),1800);setTimeout(()=>setTestSt(''),5000);};
  const STABS=[{id:'gbs',l:'🔗 GBS Market'},{id:'delivery',l:'🚚 Доставка'},{id:'sms',l:'💬 SMS'},{id:'cards',l:'💳 Карты'},{id:'store',l:'🏪 Магазин'}];
  return (
    <div>
      <div style={{display:'flex',gap:8,marginBottom:20,flexWrap:'wrap',alignItems:'center'}}>
        {STABS.map(t=><button key={t.id} onClick={()=>setStab(t.id)} className="ab" style={{padding:'8px 14px',fontSize:12,background:stab===t.id?'rgba(31,215,96,.12)':'#0C1C0F',border:`1.5px solid ${stab===t.id?'rgba(31,215,96,.35)':'#162B1A'}`,color:stab===t.id?'#1FD760':'#8FB897'}}>{t.l}</button>)}
        <button onClick={()=>{setSaved(true);setTimeout(()=>setSaved(false),3000);}} className="ab abp" style={{marginLeft:'auto',padding:'8px 16px'}}>{saved?'✓ Сохранено!':'💾 Сохранить всё'}</button>
      </div>

      {stab==='gbs'&&(
        <div style={{display:'grid',gridTemplateColumns:'1.3fr 1fr',gap:18}}>
          <div className="ac" style={{padding:20}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
              <div className="ub" style={{fontSize:14,fontWeight:800}}>JSON API · GBS Market</div>
              <div style={{display:'flex',alignItems:'center',gap:10}}><span style={{fontSize:12,color:gbsOn?'#1FD760':'#3D6645',fontWeight:700}}>{gbsOn?'Активно':'Выкл.'}</span><Tog on={gbsOn} set={setGbsOn}/></div>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 90px',gap:10}}><NI lbl="IP адрес кассы" val={gbsIP} set={setGbsIP} ph="http://192.168.1.100"/><NI lbl="Порт" val={gbsPort} set={setGbsPort} ph="8419"/></div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}><NI lbl="Логин" val={gbsUser} set={setGbsUser}/><NI lbl="Пароль" val={gbsPass} set={setGbsPass} type="password" ph="••••••••••••"/></div>
            </div>
            <button onClick={testConn} className="ab" style={{width:'100%',marginTop:14,padding:11,background:'rgba(59,142,240,.1)',border:'1.5px solid rgba(59,142,240,.3)',color:'#3B8EF0',display:'flex',alignItems:'center',justifyContent:'center',gap:8,fontSize:13}}>
              {testSt==='loading'?<><div style={{width:16,height:16,borderRadius:'50%',border:'2px solid rgba(59,142,240,.3)',borderTopColor:'#3B8EF0',animation:'spin 1s linear infinite'}}/>Проверка...</>:testSt==='ok'?'✅ Соединение установлено!':'🔌 Проверить соединение'}
            </button>
          </div>
          <div style={{padding:'14px 16px',borderRadius:14,background:'rgba(31,215,96,.05)',border:'1px solid rgba(31,215,96,.2)'}}>
            <div className="ub" style={{fontSize:12,fontWeight:800,color:'#1FD760',marginBottom:10}}>📋 Инструкция GBS Market</div>
            {['1. Откройте GBS Market на кассовом компьютере','2. Настройки → Интеграции → API','3. Поставить ✓ "Активировать JSON API"','4. Скопируйте IP кассы','5. Вставьте IP выше и нажмите "Проверить"','6. Включите тумблер — начнётся синхронизация','','Синхронизируется:','• Товары по артикулу KAK-XXXX','• Продажи по карте KAKAPO-XXXX','• Долги VIP клиентов','• История покупок'].map((s,i)=><div key={i} style={{fontSize:11,color:s===''?undefined:s.startsWith('•')?'#FFB800':'#8FB897',marginBottom:4,lineHeight:1.5,fontWeight:s.startsWith('Синх')||s===''?700:400}}>{s}</div>)}
          </div>
        </div>
      )}

      {stab==='delivery'&&(
        <div className="ac" style={{padding:20,maxWidth:560}}>
          <div className="ub" style={{fontSize:14,fontWeight:800,marginBottom:18}}>Настройки доставки</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:16}}>
            <NI lbl="Базовая цена (ЅМ)" val={basePr} set={setBasePr} type="number" suf="ЅМ"/>
            <NI lbl="Бесплатно от (ЅМ)" val={freeAm} set={setFreeAm} type="number" suf="ЅМ"/>
            <NI lbl="Цена за 1 км" val={perKm} set={setPerKm} type="number" suf="ЅМ"/>
            <NI lbl="Бесплатный радиус" val={freeKm} set={setFreeKm} type="number" suf="км"/>
          </div>
          <div style={{padding:'12px 14px',borderRadius:12,background:'rgba(255,184,0,.07)',border:'1px solid rgba(255,184,0,.2)',fontSize:12,color:'#8FB897',marginBottom:14}}>
            💡 Пример: Заказ 25 ЅМ, расстояние 3.5 км → {basePr} + {(Math.max(0,3.5-Number(freeKm))*Number(perKm)).toFixed(2)} = <span style={{color:'#FFB800',fontWeight:700}}>{(Number(basePr)+Math.max(0,3.5-Number(freeKm))*Number(perKm)).toFixed(2)} ЅМ</span>
          </div>
          {[{l:'Часы пик 12:00–14:00 (×1.3)',on:true},{l:'Вечерний пик 17:00–20:00 (×1.5)',on:true},{l:'Ночная доставка (×2.0)',on:false}].map((r,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 0',borderBottom:i<2?'1px solid #162B1A':'none'}}>
              <span style={{fontSize:13,fontWeight:600}}>{r.l}</span>
              <div style={{width:40,height:22,borderRadius:11,background:r.on?'#1FD760':'#1D3822',position:'relative',cursor:'pointer',flexShrink:0}}><div style={{position:'absolute',top:2,left:r.on?19:2,width:18,height:18,borderRadius:'50%',background:'white',transition:'left .2s'}}/></div>
            </div>
          ))}
        </div>
      )}

      {stab==='sms'&&(
        <div className="ac" style={{padding:20,maxWidth:500}}>
          <div className="ub" style={{fontSize:14,fontWeight:800,marginBottom:18}}>SMS провайдер (OTP авторизация)</div>
          <div style={{display:'flex',gap:8,marginBottom:14}}>
            {[{id:'smspro',l:'🇹🇯 SmsPro.tj'},{id:'eskiz',l:'🇺🇿 Eskiz'},{id:'twilio',l:'🌍 Twilio'}].map(p=><button key={p.id} onClick={()=>setSmsP(p.id)} className="ab" style={{flex:1,padding:'9px 6px',fontSize:12,background:smsP===p.id?'rgba(31,215,96,.12)':'#0C1C0F',border:`1.5px solid ${smsP===p.id?'rgba(31,215,96,.35)':'#162B1A'}`,color:smsP===p.id?'#1FD760':'#8FB897'}}>{p.l}</button>)}
          </div>
          <NI lbl="API ключ" val="" set={()=>{}} ph="Вставь ключ от SmsPro.tj"/>
          <div style={{marginTop:10,padding:'10px 13px',borderRadius:10,background:'rgba(59,142,240,.06)',border:'1px solid rgba(59,142,240,.2)',fontSize:12,color:'#8FB897'}}>Для Таджикистана рекомендуем <span style={{color:'#3B8EF0',fontWeight:700}}>SmsPro.tj</span> — поддержка русского/таджикского языка</div>
        </div>
      )}

      {stab==='cards'&&(
        <div className="ac" style={{padding:20,maxWidth:500}}>
          <div className="ub" style={{fontSize:14,fontWeight:800,marginBottom:18}}>Карты лояльности KAKAPO-XXXX</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
            {[{l:'Бонус Bronze %',v:'1'},{l:'Бонус Silver %',v:'2'},{l:'Бонус Gold %',v:'3'},{l:'Бонус Platinum %',v:'5'}].map((r,i)=>(<div key={i}><div style={{fontSize:11,color:'#8FB897',marginBottom:4,fontWeight:700}}>{r.l}</div><input className="ai" defaultValue={r.v} type="number" style={{paddingRight:30}}/></div>))}
          </div>
          {[{l:'Бонусы за покупки в магазине',on:true},{l:'Бонусы за заказы в ресторанах',on:true},{l:'Бонус за первую привязку карты (100 ⭐)',on:true},{l:'Синхронизация долгов с GBS Market',on:true},{l:'Кредитный лимит для Gold/Platinum',on:true}].map((r,i,arr)=>(
            <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 0',borderBottom:i<arr.length-1?'1px solid #162B1A':'none'}}>
              <span style={{fontSize:13,fontWeight:600}}>{r.l}</span>
              <div style={{width:40,height:22,borderRadius:11,background:r.on?'#1FD760':'#1D3822',position:'relative',cursor:'pointer',flexShrink:0}}><div style={{position:'absolute',top:2,left:r.on?19:2,width:18,height:18,borderRadius:'50%',background:'white',transition:'left .2s'}}/></div>
            </div>
          ))}
        </div>
      )}

      {stab==='store'&&(
        <div className="ac" style={{padding:20,maxWidth:500}}>
          <div className="ub" style={{fontSize:14,fontWeight:800,marginBottom:18}}>Информация о магазине</div>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {[{l:'Название',v:'KAKAPO'},{l:'Город',v:'г. Яван, Таджикистан'},{l:'Адрес',v:'ул. Ленина, 42'},{l:'Телефон 1',v:'+992 118 55-97-97'},{l:'Телефон 2',v:'+992 553 55-98-98'},{l:'Email',v:'kakapo.tj@gmail.com'},{l:'Telegram',v:'@kakapo_tj'},{l:'Время работы',v:'08:00 – 23:00'}].map((r,i)=>(<NI key={i} lbl={r.l} val={r.v} set={()=>{}}/>))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   DASHBOARD — обзор всех 4 приложений
══════════════════════════════════════════════════════ */
function DashboardPage({setPage}) {
  const totalRestRev = RESTAURANTS.reduce((s,r)=>s+r.revenueMonth,0);
  const totalComm    = RESTAURANTS.reduce((s,r)=>s+Math.round(r.revenueMonth*r.commission/100),0);
  const activeRest   = REST_ORDERS.filter(o=>o.status!=='delivered').length;
  const storeOrders  = ALL_ORDERS.filter(o=>o.type==='market'&&o.status!=='delivered');
  return (
    <div>
      {/* 4 apps */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:20}}>
        {[
          {e:'🛒',l:'Магазин',v:'Работает',sub:'48 заказов сегодня',c:'#1FD760',a:'orders'},
          {e:'🍽',l:'Рестораны',v:`${RESTAURANTS.filter(r=>r.open).length}/${RESTAURANTS.length} открыто`,sub:`${activeRest} активных заказов`,c:'#FF8C00',a:'partners'},
          {e:'🛵',l:'Курьеры',v:'3 активных',sub:'1 офлайн · Live GPS',c:'#3B8EF0',a:'couriers'},
          {e:'📦',l:'Сборщики',v:'2 на смене',sub:'12 собрано сегодня',c:'#9B6DFF',a:'assemblers'},
        ].map((s,i)=>(
          <div key={i} className="ac" style={{padding:16,cursor:'pointer',transition:'transform .15s'}} onClick={()=>setPage(s.a)} onMouseEnter={e=>e.currentTarget.style.transform='translateY(-2px)'} onMouseLeave={e=>e.currentTarget.style.transform='none'}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}><span style={{fontSize:26}}>{s.e}</span><div style={{width:8,height:8,borderRadius:'50%',background:s.c,animation:'pulse 2s infinite',marginTop:4}}/></div>
            <div className="ub" style={{fontSize:13,fontWeight:800,marginBottom:4}}>{s.l}</div>
            <div style={{fontSize:13,fontWeight:700,color:s.c,marginBottom:2}}>{s.v}</div>
            <div style={{fontSize:10,color:'#3D6645'}}>{s.sub}</div>
          </div>
        ))}
      </div>
      {/* Revenue */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:20}}>
        {[{l:'Выручка магазин/день',v:'3 580 ЅМ',c:'#1FD760',e:'🛒'},{l:'Выручка рестораны/мес',v:`${totalRestRev.toLocaleString()} ЅМ`,c:'#FF8C00',e:'🍽'},{l:'Комиссия KAKAPO',v:`${totalComm.toLocaleString()} ЅМ`,c:'#FFB800',e:'💰'},{l:'Клиентов всего',v:'1 847',c:'#00D4C8',e:'👥'}].map((s,i)=>(
          <div key={i} className="ac" style={{padding:16}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}><div style={{fontSize:11,color:'#8FB897',fontWeight:600}}>{s.l}</div><span style={{fontSize:20}}>{s.e}</span></div>
            <div style={{fontFamily:'Unbounded',fontSize:20,fontWeight:900,color:s.c}}>{s.v}</div>
          </div>
        ))}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1.2fr 1fr',gap:18,marginBottom:18}}>
        <div className="ac">
          <div style={{padding:'12px 16px',borderBottom:'1px solid #162B1A',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontWeight:800,fontSize:13}}>Активные заказы</span>
            <button onClick={()=>setPage('orders')} className="ab abg" style={{padding:'4px 11px',fontSize:11}}>Все →</button>
          </div>
          <table className="at">
            <thead><tr><th>ID</th><th>Тип</th><th>Клиент</th><th>Сумма</th><th>Статус</th></tr></thead>
            <tbody>{ALL_ORDERS.filter(o=>o.status!=='delivered').map(o=>{
              const s=SC_STATUS[o.status]||{l:o.status,c:'#8FB897'};
              return(<tr key={o.id}>
                <td><span className="ub" style={{fontSize:11,color:'#1FD760'}}>{o.id}</span></td>
                <td><span style={{fontSize:10,padding:'2px 6px',borderRadius:6,background:o.type==='restaurant'?'rgba(255,140,0,.12)':'rgba(31,215,96,.1)',color:o.type==='restaurant'?'#FF8C00':'#1FD760'}}>{o.type==='restaurant'?`🍽`:'🛒'}</span></td>
                <td style={{fontSize:12,fontWeight:600}}>{o.client}</td>
                <td><span className="ub" style={{fontSize:11,fontWeight:800}}>{o.total} ЅМ</span></td>
                <td><Badge v={s.l} c={s.c}/></td>
              </tr>);
            })}</tbody>
          </table>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          <div className="ac" style={{padding:16}}>
            <div style={{fontWeight:800,fontSize:13,marginBottom:12}}>⚠️ Требует внимания</div>
            {[{e:'🥛',t:'Молоко закончилось',s:'Пополнить склад',c:'#FF4545'},{e:'🥐',t:'Круассан — 2 шт',s:'Мало на складе',c:'#FFB800'},{e:'🍽',t:'Фаст-фуд закрыт',s:'Проверить партнёра',c:'#FF8C00'},{e:'⭐',t:'2 новых жалобы',s:'Чайхона Оромгох',c:'#FF4545'}].map((a,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:i<3?'1px solid #162B1A':'none'}}>
                <div style={{width:30,height:30,borderRadius:9,background:`${a.c}14`,border:`1px solid ${a.c}25`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,flexShrink:0}}>{a.e}</div>
                <div style={{flex:1}}><div style={{fontSize:12,fontWeight:700}}>{a.t}</div><div style={{fontSize:10,color:'#3D6645'}}>{a.s}</div></div>
                <div style={{width:6,height:6,borderRadius:'50%',background:a.c,animation:'pulse 2s infinite'}}/>
              </div>
            ))}
          </div>
          <div className="ac" style={{padding:16}}>
            <div style={{fontWeight:800,fontSize:13,marginBottom:12}}>Быстрые действия</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              {[{e:'🍽',l:'Добавить ресторан',a:'partners'},{e:'💸',l:'Создать акцию',a:'promos'},{e:'🔔',l:'Push рассылка',a:'push'},{e:'💰',l:'Выплаты',a:'finance'}].map((a,i)=>(
                <button key={i} onClick={()=>setPage(a.a)} className="ab" style={{padding:'10px 6px',background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',display:'flex',flexDirection:'column',alignItems:'center',gap:5,fontSize:11,fontFamily:'Nunito',fontWeight:700,lineHeight:1.4,textAlign:'center'}}>
                  <span style={{fontSize:20}}>{a.e}</span>{a.l}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   MAIN ADMIN APP — без логина
══════════════════════════════════════════════════════ */
export default function AdminApp() {
  const [page,setPage]=useState('dashboard');
  const TITLES={dashboard:'Dashboard',categories:'Категории товаров',orders:'Все заказы',products:'Товары',inventory:'Склад',promos:'Акции',partners:'Рестораны-партнёры',reviews:'Отзывы',couriers:'Курьеры',assemblers:'Сборщики',clients:'Клиенты',cards:'Карты',push:'Push уведомления',finance:'Финансы',settings:'Настройки'};
  const SUBS={dashboard:'Управление всеми 4 приложениями · г. Яван',categories:'Управление разделами каталога',orders:'Магазин и рестораны · в реальном времени',products:'Синхронизация KAK-XXXX с GBS Market',inventory:'Контроль остатков',promos:'Скидки для магазина и ресторанов',partners:'Управление, меню, комиссии, выплаты',reviews:'Жалобы и отзывы клиентов',couriers:'GPS трекинг · kakapo-courier',assemblers:'Команда сборки · kakapo-assembler',clients:'CRM · все клиенты',cards:'Карты KAKAPO-XXXX · бонусы · долги',push:'Рассылка клиентам всех приложений',finance:'Выручка + комиссии ресторанов',settings:'GBS Market · Доставка · SMS · Карты'};
  return (
    <Layout page={page} setPage={setPage} title={TITLES[page]||page} subtitle={SUBS[page]||''}>
      {page==='dashboard'  && <DashboardPage  setPage={setPage}/>}
      {page==='orders'     && <OrdersPage/>}
      {page==='products'   && <ProductsPage/>}
      {page==='categories' && <CategoriesPage/>}
      {page==='inventory'  && <InventoryPage/>}
      {page==='promos'     && <PromosPage/>}
      {page==='partners'   && <PartnersPage/>}
      {page==='reviews'    && <ReviewsPage/>}
      {page==='couriers'   && <CouriersPage/>}
      {page==='assemblers' && <AssemblersPage/>}
      {page==='clients'    && <ClientsPage/>}
      {page==='cards'      && <CardsPage/>}
      {page==='push'       && <PushPage/>}
      {page==='finance'    && <FinancePage/>}
      {page==='settings'   && <SettingsPage/>}
    </Layout>
  );
}
