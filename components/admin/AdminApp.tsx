'use client'
import { useState, useEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { useOrders, useProducts, useRestaurants, USE_API } from '@/lib/store'
import { mapOrdersForAdmin, ADMIN_STATUS_OPTIONS, adminStatusLabel, buildAdminStatusPatch, COURIER_ASSIGNED_STATUSES } from '@/lib/orderUiMap'
import { useApiSync } from '@/lib/useApiSync'
import { useAppNavigation } from '@/lib/useAppNavigation'
import AppNavigationBoundary from '@/components/shared/AppNavigationBoundary'
import { enrichProducts, enrichRestaurants } from '@/lib/enrichCatalog'
import { usePricingStore, usePickupStore, hydrateCourierStores, syncCourierStoresFromApi } from '@/lib/courierStore'
import { useCourierTeamStore, useCourierTeam, syncCourierTeamFromApi } from '@/lib/courierTeamStore'
import {
  useAssemblerTeamStore,
  useAssemblerTeam,
  syncAssemblerTeamFromApi,
  hydrateAssemblerTeamStore,
} from '@/lib/assemblerTeamStore'
import {
  emptyAssemblerForm,
  countAssemblerActiveOrders,
  countAssemblerCompletedOrders,
  formatAssemblerAvgTime,
  type AdminAssembler,
  type AssemblerStatus,
} from '@/lib/assemblerTeam'
import {
  useClientStore,
  useClients,
  syncClientsFromApi,
  hydrateClientStore,
} from '@/lib/clientStore'
import {
  useCardStore,
  useCards,
  syncCardsFromApi,
  hydrateCardStore,
} from '@/lib/cardStore'
import {
  emptyCardLoyaltyForm,
  mergeCardsWithClients,
  cardMatchesSearch,
  previewCardRange,
  CARD_STATUS_LABELS,
  findClientForCard,
  type AdminCard,
  type CardStatus,
  type CardLoyaltyForm,
  cardHasDebtSection,
} from '@/lib/cardCrm'
import {
  emptyClientProfileForm,
  clientProfileFromClient,
  mergeClientsWithOrders,
  clientSegment,
  clientSegmentLabel,
  isNewThisMonth,
  normalizePhone,
  phonesMatch,
  CLIENT_LEVEL_OPTIONS,
  type AdminClient,
  type ClientLevel,
  type ClientProfileForm,
} from '@/lib/clientCrm'
import {
  saveClientProfile,
  saveCardLoyalty,
  createAndLinkCard,
  lookupClientByPhone,
  loyaltySummaryForClient,
  clientNoteForCard,
  cardLoyaltyFromCard,
} from '@/lib/clientCardSync'
import { loadDebtHistory, subscribeDebtHistory, type DebtHistoryEntry } from '@/lib/clientVipCredit'
import { loyaltyTierOptions, loadLoyaltyStatusConfig } from '@/lib/loyaltyStatusConfig'
import CardStatusAdminPanel from '@/components/admin/CardStatusAdminPanel'
import {
  enrichClientsForPush,
  filterClientsBySegment,
  countSegment,
  formatPushTime,
  openRatePercent,
  PUSH_SEGMENT_OPTIONS,
  type PushSegmentId,
} from '@/lib/pushCrm'
import {
  hydratePushStore,
  syncPushFromApi,
  usePushAutoSettings,
  usePushHistory,
  usePushTemplates,
  usePushStore,
} from '@/lib/pushStore'
import { sendPushCampaign } from '@/lib/pushService'
import {
  buildFinanceSummary,
  downloadCsv,
  printFinanceReport,
  formatSm,
  FINANCE_TAB_OPTIONS,
  restaurantBalance,
  prepareOrdersForFinance,
  type FinanceTab,
} from '@/lib/financeCrm'
import {
  TARIFF_TAB_OPTIONS,
  TARIFF_PRESETS,
  TARIFF_FIELD_META,
  validatePricing,
  normalizePricing,
  buildTariffStats,
  previewOrdersForTab,
  courierTariffSummary,
  calcPreview,
  TAB_CONNECTIONS,
  type TariffTab,
} from '@/lib/tariffCrm'
import {
  emptyCourierForm,
  countCourierActiveOrders,
  vehicleIcon,
  vehicleLabel,
  VEHICLE_OPTIONS,
  type AdminCourier,
  type CourierStatus,
} from '@/lib/courierTeam'
import { restIdToPickupId } from '@/lib/pickups'
import { resolveOrderDeliveryFee } from '@/lib/deliveryFee'
import { useProductPhotos } from '@/lib/productPhotos'
import PhotoUploadField from '@/components/shared/PhotoUploadField'
import { formatPriceLabel, isWeighted, productUnitGrams } from '@/lib/productWeight'
import { api } from '@/lib/api'
import type { Promo } from '@/lib/types'
import { DEMO_ADMIN_COURIER_ORDERS } from '@/lib/demoOrders'
import { useOrderRoadKm } from '@/lib/useOrderRoadKm'
import { formatKm, DEFAULT_PRICING } from '@/lib/courierData'
import Link from 'next/link'

const AddressMapPicker = dynamic(() => import('@/components/shared/AddressMapPicker'), { ssr: false })
// ─── КАКАПО Admin App ────────────────────────────
/* ══════════════════════════════════════════════════════
   КАКАПО ADMIN — Единая панель управления
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
  {id:6, art:'KAK-0006',e:'🥩',name:'Говядина вырезка',   price:38.0, old:47.0, cat:'Мясо',    catId:'meat',  unit:'500 гр',stock:5, hot:true, organic:false,discount:19, sellType:'weight', unitGrams:500, weightStep:100, minWeight:100},
  {id:7, art:'KAK-0007',e:'🍗',name:'Куриное филе',       price:16.5, old:null, cat:'Мясо',    catId:'meat',  unit:'1 кг',  stock:12,hot:true, organic:false,discount:0, sellType:'weight', unitGrams:1000, weightStep:100, minWeight:100},
  {id:8, art:'KAK-0008',e:'🥓',name:'Бекон копчёный',     price:22.0, old:null, cat:'Мясо',    catId:'meat',  unit:'200 гр',stock:4, hot:false,organic:false,discount:0, sellType:'weight', unitGrams:200, weightStep:100, minWeight:100},
  {id:9, art:'KAK-0009',e:'🍖',name:'Баранина на кости',  price:42.0, old:null, cat:'Мясо',    catId:'meat',  unit:'500 гр',stock:8, hot:false,organic:false,discount:0, sellType:'weight', unitGrams:500, weightStep:100, minWeight:100},
  {id:10,art:'KAK-0010',e:'🥛',name:'Молоко 3.2%',        price:4.90, old:null, cat:'Молочное',catId:'dairy', unit:'1 л',   stock:0, hot:false,organic:false,discount:0},
  {id:11,art:'KAK-0011',e:'🧀',name:'Сыр Российский',     price:18.5, old:null, cat:'Молочное',catId:'dairy', unit:'250 гр',stock:7, hot:true, organic:false,discount:0, sellType:'weight', unitGrams:250, weightStep:100, minWeight:100},
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

const REVIEWS = [
  {id:1,restId:'R-01',client:'Зафар М.',rating:2,text:'Долго ждали, еда была холодная',date:'16 мая',status:'new'},
  {id:2,restId:'R-02',client:'Лола К.',rating:5,text:'Отличная пицца! Быстро доставили',date:'15 мая',status:'read'},
  {id:3,restId:'R-01',client:'Нилуфар С.',rating:1,text:'Неправильный заказ привезли',date:'14 мая',status:'new'},
  {id:4,restId:'R-03',client:'Бахром Т.',rating:4,text:'Вкусные роллы, но немного дорого',date:'13 мая',status:'read'},
];

/* ── HELPERS ─────────────────────────────────────── */
const SC_STATUS = {new:{l:'Новый',c:'#FF4545'},assembling:{l:'Собирается',c:'#9B6DFF'},cooking:{l:'Готовится',c:'#FF8C00'},delivering:{l:'В пути',c:'#3B8EF0'},delivered:{l:'Доставлен',c:'#1FD760'},cancelled:{l:'Отменён',c:'#3D6645'}};
const LVC = {basic:'#8FB897',bronze:'#CD7F32',silver:'#C0C0C0',gold:'#FFB800',platinum:'#3B8EF0'};

const Tog = ({on,set}) => (
  <div onClick={() => { if (typeof set === 'function') set(); }} style={{width:44,height:24,borderRadius:12,background:on?'#1FD760':'#1D3822',position:'relative',cursor:'pointer',transition:'background .2s',flexShrink:0}}>
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

const DebtReadOnly = ({ debt, onManage }: { debt: number; onManage?: () => void }) => (
  <div>
    <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>Долг ЅМ</div>
    <div style={{
      padding: '9px 13px', borderRadius: 10, background: '#08120C', border: '1.5px solid #162B1A',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    }}>
      <span className="ub" style={{ fontSize: 15, fontWeight: 900, color: debt > 0 ? '#FF4545' : '#8FB897' }}>
        {debt > 0 ? `${debt.toLocaleString()} ЅМ` : '0 ЅМ'}
      </span>
      {onManage && (
        <button type="button" onClick={onManage} className="ab" style={{ padding: '5px 10px', fontSize: 10, fontWeight: 700, background: 'rgba(255,140,0,.12)', border: '1px solid rgba(255,140,0,.28)', color: '#FF8C00' }}>
          Изменить в «Долги VIP»
        </button>
      )}
    </div>
    <div style={{ fontSize: 10, color: '#3D6645', marginTop: 6, lineHeight: 1.45 }}>
      Долг меняется только в разделе «Долги VIP» — добавить или списать с историей.
    </div>
  </div>
);

/* ── NAV ──────────────────────────────────────────── */
const NAV_GROUPS = [
  {g:'Общее',     items:[{id:'dashboard',icon:'📊',l:'Dashboard'},{id:'orders',icon:'📦',l:'Все заказы'}]},
  {g:'Магазин',   items:[{id:'products',icon:'🥦',l:'Товары'},{id:'categories',icon:'📁',l:'Категории'},{id:'inventory',icon:'📋',l:'Склад'},{id:'promos',icon:'💸',l:'Акции'}]},
  {g:'Маркетплейс',items:[{id:'partners',icon:'🍽',l:'Рестораны'},{id:'reviews',icon:'⭐',l:'Отзывы'},{id:'pickups',icon:'📍',l:'Точки забора'}]},
  {g:'Команда',   items:[{id:'couriers',icon:'🛵',l:'Курьеры'},{id:'assemblers',icon:'🛒',l:'Сборщики'},{id:'courierorders',icon:'🗺',l:'Заказы курьеров'}]},
  {g:'Клиенты',   items:[{id:'clients',icon:'👥',l:'Клиенты'},{id:'cards',icon:'💳',l:'Карты'},{id:'debts',icon:'📒',l:'Долги VIP'},{id:'push',icon:'🔔',l:'Push'}]},
  {g:'Финансы',   items:[{id:'finance',icon:'💰',l:'Финансы'},{id:'tariff',icon:'🚚',l:'Тариф доставки'}]},
  {g:'Контент',   items:[{id:'banners',icon:'🖼',l:'Баннеры / Слайдеры'}]},
  {g:'Система',   items:[{id:'settings',icon:'⚙️',l:'Настройки'}]},
];

function Layout({page,setPage,children,title,subtitle}) {
  const apiOrders = useOrders(s => s.orders);
  const storedCards = useCards();
  const clients = useClients();
  const orders = useMemo(
    () => (USE_API ? mapOrdersForAdmin(apiOrders) : ALL_ORDERS),
    [apiOrders],
  );
  const newOrders = orders.filter(o => o.status === 'new').length;
  const debtClients = useMemo(
    () => mergeCardsWithClients(storedCards, clients).filter(c => c.status === 'active' && cardHasDebtSection(c) && c.debt > 0).length,
    [storedCards, clients],
  );
  return (
    <div style={{display:'flex',minHeight:'100vh',background:'#030B05',fontFamily:'Nunito,sans-serif'}}>
      <style>{CSS}</style>
      <aside style={{width:205,flexShrink:0,background:'#06100A',borderRight:'1px solid #162B1A',display:'flex',flexDirection:'column',position:'sticky',top:0,height:'100vh',overflowY:'auto'}}>
        <div style={{padding:'16px 14px',borderBottom:'1px solid #162B1A',display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
          <div style={{width:40,height:40,borderRadius:13,background:'linear-gradient(135deg,#0F8A3A,#1FD760)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:16,fontWeight:900,color:'#030B05',flexShrink:0}}>K</div>
          <div><div className="ub" style={{fontSize:14,fontWeight:900,color:'#1FD760'}}>КАКАПО</div><div style={{fontSize:9,color:'#3D6645'}}>Admin · г. Яван</div></div>
        </div>
        <nav style={{flex:1,padding:'8px',display:'flex',flexDirection:'column',gap:0}}>
          {NAV_GROUPS.map(g=>(
            <div key={g.g} style={{marginBottom:4}}>
              <div style={{fontSize:9,fontWeight:800,color:'#3D6645',textTransform:'uppercase',letterSpacing:1,padding:'6px 10px 3px'}}>{g.g}</div>
              {g.items.map(n=>(
                <button key={n.id} onClick={()=>setPage(n.id)} className="btn"
                  style={{display:'flex',alignItems:'center',gap:9,padding:'9px 11px',borderRadius:10,background:page===n.id?'rgba(31,215,96,.14)':'transparent',border:`1px solid ${page===n.id?'rgba(31,215,96,.22)':'transparent'}`,color:page===n.id?'#1FD760':'#8FB897',fontSize:13,fontWeight:600,textAlign:'left',cursor:'pointer',width:'100%',position:'relative'}}>
                  <span style={{fontSize:16,flexShrink:0}}>{n.icon}</span>{n.l}
                  {n.id==='orders'&&newOrders>0&&<span style={{marginLeft:'auto',minWidth:18,height:18,padding:'0 5px',borderRadius:999,background:'#FF4545',fontSize:9,fontWeight:900,color:'white',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',flexShrink:0}}>{newOrders > 99 ? '99+' : newOrders}</span>}
                  {n.id==='debts'&&debtClients>0&&<span style={{marginLeft:'auto',minWidth:18,height:18,padding:'0 5px',borderRadius:999,background:'#FF8C00',fontSize:9,fontWeight:900,color:'#030B05',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',flexShrink:0}}>{debtClients > 99 ? '99+' : debtClients}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div style={{padding:'10px 14px 16px',borderTop:'1px solid #162B1A',fontSize:9,color:'#3D6645',flexShrink:0,lineHeight:1.6}}>
          КАКАПО v2.0<br/>
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
            {page !== 'settings' && [{l:'Магазин',c:'#1FD760'},{l:'Рестораны',c:'#FF8C00'},{l:'Курьеры',c:'#3B8EF0'},{l:'Сборщики',c:'#9B6DFF'}].map((a,i)=>(
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
function OrderStatusSelect({ value, onChange, disabled = false }) {
  const cur = adminStatusLabel(value)
  return (
    <select
      value={value}
      disabled={disabled}
      onClick={e => e.stopPropagation()}
      onChange={e => { e.stopPropagation(); onChange(e.target.value); }}
      style={{
        padding: '4px 8px',
        borderRadius: 7,
        fontSize: 10,
        fontWeight: 800,
        background: `${cur.c}18`,
        color: cur.c,
        border: `1px solid ${cur.c}28`,
        cursor: disabled ? 'default' : 'pointer',
        maxWidth: 130,
        opacity: disabled ? .6 : 1,
      }}
    >
      {ADMIN_STATUS_OPTIONS.map(st => {
        const lb = adminStatusLabel(st)
        return <option key={st} value={st} style={{ background: '#0C1C0F', color: '#EBF5ED' }}>{lb.l}</option>
      })}
    </select>
  )
}

function resolvePersonSelectId(people, displayName) {
  if (!displayName || displayName === '—') return ''
  const d = displayName.toLowerCase().replace(/\./g, '').trim()
  const hit = people.find(p => {
    const n = p.name.toLowerCase()
    if (n === displayName.toLowerCase()) return true
    const parts = d.split(/\s+/).filter(Boolean)
    return parts.length > 0 && (n.startsWith(parts[0]) || parts.every(pt => n.includes(pt)))
  })
  return hit?.id ?? ''
}

function OrderPersonSelect({ value, options, onChange, disabled = false, accent = '#8FB897' }) {
  const hasValue = !!value
  const color = hasValue ? accent : '#3D6645'
  return (
    <select
      value={value}
      disabled={disabled}
      onClick={e => e.stopPropagation()}
      onChange={e => { e.stopPropagation(); onChange(e.target.value); }}
      style={{
        padding: '4px 8px',
        borderRadius: 7,
        fontSize: 10,
        fontWeight: hasValue ? 700 : 400,
        background: `${color}18`,
        color,
        border: `1px solid ${color}28`,
        cursor: disabled ? 'default' : 'pointer',
        maxWidth: 120,
        opacity: disabled ? .6 : 1,
      }}
    >
      <option value="" style={{ background: '#0C1C0F', color: '#EBF5ED' }}>—</option>
      {options.map(p => (
        <option key={p.id} value={p.id} style={{ background: '#0C1C0F', color: '#EBF5ED' }}>{p.name}</option>
      ))}
    </select>
  )
}

function OrderDetailModal({ order, onClose, onStatusChange, onCourierChange, onAssemblerChange, couriers, assemblers, statusBusy, courierBusy, assemblerBusy }) {
  if (!order) return null
  const st = adminStatusLabel(order.status)
  const showAssembler = order.type === 'market' || order.type === 'mixed'
  const PART_LABELS = { new: 'Новый', assembling: 'Собирается', done: 'Готово', cooking: 'Готовится' }
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.72)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div onClick={e=>e.stopPropagation()} className="ac" style={{ width:'100%', maxWidth:520, maxHeight:'90vh', overflowY:'auto', padding:22 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:18 }}>
          <div>
            <div className="ub" style={{ fontSize:18, fontWeight:900, color:'#1FD760', marginBottom:4 }}>{order.id}</div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <Badge v={st.l} c={st.c}/>
              <Badge v={order.type==='restaurant'?'🍽 Ресторан':order.type==='mixed'?'🔀 Смешанный':'🛒 Магазин'} c={order.type==='restaurant'?'#FF8C00':'#1FD760'}/>
            </div>
          </div>
          <button onClick={onClose} className="btn" style={{ width:32, height:32, borderRadius:10, background:'#0C1C0F', border:'1px solid #162B1A', color:'#8FB897', fontSize:16 }}>✕</button>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 }}>
          <div style={{ background:'#0C1C0F', borderRadius:12, padding:12, border:'1px solid #162B1A' }}>
            <div style={{ fontSize:10, color:'#3D6645', marginBottom:6, fontWeight:700 }}>КЛИЕНТ</div>
            <div style={{ fontWeight:700, fontSize:13, marginBottom:2 }}>{order.client}</div>
            <div style={{ fontSize:11, color:'#8FB897' }}>{order.phone}</div>
            <div style={{ fontSize:11, color:'#8FB897', marginTop:4 }}>📍 {order.addr || '—'}</div>
          </div>
          <div style={{ background:'#0C1C0F', borderRadius:12, padding:12, border:'1px solid #162B1A' }}>
            <div style={{ fontSize:10, color:'#3D6645', marginBottom:6, fontWeight:700 }}>КОМАНДА</div>
            {showAssembler && (
            <div style={{ fontSize:12, marginBottom:8 }}>
              <div style={{ fontSize:10, color:'#3D6645', marginBottom:4 }}>Сборщик</div>
              {onAssemblerChange ? (
                <OrderPersonSelect
                  value={resolvePersonSelectId(assemblers, order.assembler)}
                  options={assemblers}
                  disabled={assemblerBusy}
                  accent="#9B6DFF"
                  onChange={v => onAssemblerChange(order, v)}
                />
              ) : (
                <span style={{ color:'#9B6DFF', fontWeight:700 }}>{order.assembler}</span>
              )}
            </div>
            )}
            <div style={{ fontSize:12 }}>
              <div style={{ fontSize:10, color:'#3D6645', marginBottom:4 }}>Курьер</div>
              {onCourierChange ? (
                <OrderPersonSelect
                  value={resolvePersonSelectId(couriers, order.courier)}
                  options={couriers}
                  disabled={courierBusy}
                  accent="#3B8EF0"
                  onChange={v => onCourierChange(order, v)}
                />
              ) : (
                <>
                  <span style={{ color:'#3B8EF0', fontWeight:700 }}>{order.courier}</span>
                  {order.courierPhone && <span style={{ color:'#3D6645', fontSize:10 }}> · {order.courierPhone}</span>}
                </>
              )}
            </div>
          </div>
        </div>

        {order.rest && (
          <div style={{ fontSize:12, color:'#FF8C00', marginBottom:12, fontWeight:700 }}>🍽 {order.rest}</div>
        )}

        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:10, color:'#3D6645', marginBottom:8, fontWeight:700 }}>СОСТАВ ЗАКАЗА</div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {(order.itemsDetailed || []).map((it, i) => (
              <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 10px', background:'#0C1C0F', borderRadius:10, border:'1px solid #162B1A' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span>{it.e || '📦'}</span>
                  <div>
                    <div style={{ fontSize:12, fontWeight:600 }}>{it.name}</div>
                    <div style={{ fontSize:10, color:'#3D6645' }}>{it.qty} шт · {it.source === 'restaurant' ? 'ресторан' : 'магазин'}</div>
                  </div>
                </div>
                <div className="ub" style={{ fontSize:12, fontWeight:800 }}>{(it.price * it.qty).toFixed(1)} ЅМ</div>
              </div>
            ))}
          </div>
        </div>

        {(order.marketStatus || order.restParts) && (
          <div style={{ marginBottom:14, padding:12, background:'rgba(155,109,255,.06)', borderRadius:12, border:'1px solid rgba(155,109,255,.2)' }}>
            <div style={{ fontSize:10, color:'#9B6DFF', marginBottom:8, fontWeight:700 }}>ЭТАПЫ (СМЕШАННЫЙ ЗАКАЗ)</div>
            {order.marketStatus && <div style={{ fontSize:11, marginBottom:4 }}>🛒 Магазин: <strong>{PART_LABELS[order.marketStatus] || order.marketStatus}</strong></div>}
            {order.restParts && Object.entries(order.restParts).map(([rid, ps]) => (
              <div key={rid} style={{ fontSize:11, marginBottom:2 }}>
                🍽 {order.restNameById?.[rid] || order.rest || rid}: <strong>{PART_LABELS[ps] || ps}</strong>
              </div>
            ))}
          </div>
        )}

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', paddingTop:12, borderTop:'1px solid #162B1A' }}>
          <div>
            <div style={{ fontSize:10, color:'#3D6645' }}>Создан: {order.time || '—'}{order.deliveredAt ? ` · Доставлен: ${order.deliveredAt}` : ''}</div>
            {order.comment && <div style={{ fontSize:11, color:'#8FB897', marginTop:4 }}>💬 {order.comment}</div>}
          </div>
          <div className="ub" style={{ fontSize:20, fontWeight:900, color:'#1FD760' }}>{order.total} ЅМ</div>
        </div>

        {onStatusChange && (
          <div style={{ marginTop:16, paddingTop:14, borderTop:'1px solid #162B1A' }}>
            <div style={{ fontSize:10, color:'#3D6645', marginBottom:8, fontWeight:700 }}>ИЗМЕНИТЬ СТАТУС</div>
            <OrderStatusSelect value={order.status} disabled={statusBusy} onChange={s => onStatusChange(order, s)} />
          </div>
        )}
      </div>
    </div>
  )
}

function OrdersPage() {
  const apiOrders = useOrders(s => s.orders);
  const adminPins = useOrders(s => s.orderAdminPins);
  const adminUpdateStatus = useOrders(s => s.adminUpdateStatus);
  const adminAssignCourier = useOrders(s => s.adminAssignCourier);
  const adminAssignAssembler = useOrders(s => s.adminAssignAssembler);
  const couriers = useCourierTeam();
  const assemblers = useAssemblerTeam();
  const apiRests = useRestaurants(s => s.restaurants);
  const restaurants = USE_API && apiRests.length ? enrichRestaurants(apiRests, RESTAURANTS) : RESTAURANTS;
  const [demoPatch, setDemoPatch] = useState({});
  const [busyKey, setBusyKey] = useState(null);
  const orders = useMemo(
    () => {
      const pinned = apiOrders.map(o => {
        const pin = adminPins[o.id]
        return pin ? { ...o, ...pin, status: pin.status ?? o.status } : o
      })
      const base = USE_API ? mapOrdersForAdmin(pinned, restaurants) : ALL_ORDERS;
      return base.map(o => (demoPatch[o.id] ? { ...o, ...demoPatch[o.id] } : o));
    },
    [apiOrders, adminPins, demoPatch, restaurants]
  );
  const [type,   setType]   = useState('all');
  const [status, setStatus] = useState('all');
  const [orderSearch, setOrderSearch] = useState('');
  const [detail, setDetail] = useState(null);
  const ACTIVE_STATUSES = ['assembling','assembler_done','cooking','ready','courier_picked'];
  const matchesOrderId = (orderId, query) => {
    const q = query.trim().toLowerCase().replace(/\s/g, '');
    if (!q) return true;
    const id = String(orderId).toLowerCase();
    const digits = q.replace(/^k-?/, '');
    return id.includes(q) || id.replace(/^k-/, '').includes(digits);
  };
  const filtered = orders.filter(o => {
    const matchType = type === 'all' || o.type === type;
    const matchStatus = status === 'all' || o.status === status
      || (status === 'assembling' && ACTIVE_STATUSES.includes(o.status));
    const matchId = matchesOrderId(o.id, orderSearch);
    return matchType && matchStatus && matchId;
  });
  const changeStatus = async (o, newStatus) => {
    if (!newStatus || newStatus === o.status) return;
    if (newStatus === 'cancelled' && !window.confirm(`Отменить заказ ${o.id}?`)) return;
    const clearsCourier = !COURIER_ASSIGNED_STATUSES.includes(newStatus);
    setBusyKey(`${o.id}:status`);
    try {
      if (USE_API) {
        await adminUpdateStatus(o.id, newStatus);
      } else {
        const raw = apiOrders.find(x => x.id === o.id)
        const extra = buildAdminStatusPatch(raw, newStatus)
        const { adminOverride: _ao, ...fields } = extra
        setDemoPatch(prev => ({
          ...prev,
          [o.id]: {
            status: newStatus,
            ...fields,
            courier: clearsCourier ? '—' : o.courier,
            courierPhone: clearsCourier ? '' : o.courierPhone,
          },
        }));
      }
      if (detail?.id === o.id) {
        setDetail(prev => (prev ? {
          ...prev,
          status: newStatus,
          courier: clearsCourier ? '—' : prev.courier,
          courierPhone: clearsCourier ? '' : prev.courierPhone,
        } : null));
      }
    } finally {
      setBusyKey(null);
    }
  };
  const applyCourier = async (o, courierId) => {
    const currentId = resolvePersonSelectId(couriers, o.courier);
    if (courierId === currentId) return;
    const person = courierId ? couriers.find(c => c.id === courierId) : null;
    setBusyKey(`${o.id}:courier`);
    try {
      if (USE_API) {
        await adminAssignCourier(o.id, person ? { name: person.name, phone: person.phone } : null);
      } else {
        setDemoPatch(prev => ({
          ...prev,
          [o.id]: {
            ...prev[o.id],
            courier: person ? person.name : '—',
            courierPhone: person?.phone || '',
          },
        }));
      }
      if (detail?.id === o.id) {
        setDetail(prev => prev ? {
          ...prev,
          courier: person ? person.name : '—',
          courierPhone: person?.phone || '',
        } : null);
      }
    } finally {
      setBusyKey(null);
    }
  };
  const applyAssembler = async (o, assemblerId) => {
    const currentId = resolvePersonSelectId(assemblers, o.assembler);
    if (assemblerId === currentId) return;
    const person = assemblerId ? assemblers.find(a => a.id === assemblerId) : null;
    setBusyKey(`${o.id}:assembler`);
    try {
      if (USE_API) {
        await adminAssignAssembler(o.id, person ? { name: person.name } : null);
      } else {
        setDemoPatch(prev => ({
          ...prev,
          [o.id]: {
            ...prev[o.id],
            assembler: person ? person.name : '—',
          },
        }));
      }
      if (detail?.id === o.id) {
        setDetail(prev => prev ? { ...prev, assembler: person ? person.name : '—' } : null);
      }
    } finally {
      setBusyKey(null);
    }
  };
  return (
    <div>
      {detail && (
        <OrderDetailModal
          order={detail}
          onClose={() => setDetail(null)}
          onStatusChange={changeStatus}
          onCourierChange={applyCourier}
          onAssemblerChange={applyAssembler}
          couriers={couriers.filter(c => !c.blocked)}
          assemblers={assemblers.filter(a => !a.blocked)}
          statusBusy={busyKey === `${detail.id}:status`}
          courierBusy={busyKey === `${detail.id}:courier`}
          assemblerBusy={busyKey === `${detail.id}:assembler`}
        />
      )}
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:10,marginBottom:18}}>
        {['all','new','assembling','delivering','delivered'].map(s=>{
          const cnt = s==='all' ? orders.length
            : s==='assembling' ? orders.filter(o=>ACTIVE_STATUSES.includes(o.status)).length
            : orders.filter(o=>o.status===s).length;
          const sc  = s==='all' ? {l:'Все',c:'#EBF5ED'} : s==='assembling' ? {l:'В работе',c:'#9B6DFF'} : adminStatusLabel(s);
          return (
            <div key={s} onClick={()=>setStatus(s)} className="ac" style={{padding:'12px 14px',cursor:'pointer',border:`1.5px solid ${status===s?'rgba(31,215,96,.3)':'#162B1A'}`,background:status===s?'rgba(31,215,96,.06)':'#091508'}}>
              <div style={{fontSize:10,color:'#8FB897',marginBottom:5}}>{s==='all'?'Все заказы':sc.l}</div>
              <div className="ub" style={{fontSize:20,fontWeight:900,color:status===s?'#1FD760':sc.c}}>{cnt}</div>
            </div>
          );
        })}
      </div>
      <div style={{display:'flex',gap:10,marginBottom:14,alignItems:'center',flexWrap:'wrap'}}>
        <div style={{position:'relative',flex:1,minWidth:200,maxWidth:280}}>
          <div style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',fontSize:14,pointerEvents:'none'}}>🔍</div>
          <input
            className="ai"
            value={orderSearch}
            onChange={e => setOrderSearch(e.target.value)}
            placeholder="Номер заказа · K-4846"
            style={{paddingLeft:38,paddingRight:orderSearch ? 34 : 13}}
          />
          {orderSearch && (
            <button
              type="button"
              onClick={() => setOrderSearch('')}
              className="btn"
              style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',background:'transparent',border:'none',color:'#3D6645',fontSize:16,padding:4,lineHeight:1}}
              aria-label="Очистить"
            >×</button>
          )}
        </div>
        {[{id:'all',l:'Все типы'},{id:'market',l:'🛒 Магазин'},{id:'restaurant',l:'🍽 Рестораны'},{id:'mixed',l:'🔀 Смешанные'}].map(f=>(
          <button key={f.id} onClick={()=>setType(f.id)} className="ab"
            style={{padding:'7px 14px',fontSize:12,background:type===f.id?'rgba(31,215,96,.12)':'#0C1C0F',border:`1.5px solid ${type===f.id?'rgba(31,215,96,.35)':'#162B1A'}`,color:type===f.id?'#1FD760':'#8FB897'}}>
            {f.l}
          </button>
        ))}
        {orderSearch.trim() && (
          <span style={{fontSize:11,color:'#8FB897'}}>
            Найдено: <strong style={{color:'#1FD760'}}>{filtered.length}</strong>
          </span>
        )}
      </div>
      <div className="ac">
        <table className="at">
          <thead><tr><th>ID</th><th>Тип</th><th>Клиент</th><th>Адрес</th><th>Состав</th><th>Сумма</th><th>Курьер</th><th>Сборщик</th><th>Статус</th><th>Время</th></tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} style={{textAlign:'center',padding:'28px 14px',color:'#8FB897',fontSize:13}}>
                  {orderSearch.trim()
                    ? `Заказ «${orderSearch.trim()}» не найден`
                    : 'Нет заказов по выбранным фильтрам'}
                </td>
              </tr>
            ) : filtered.map(o=>(
                <tr key={o.id} onClick={()=>setDetail(o)} style={{ cursor:'pointer' }}>
                  <td><span className="ub" style={{fontSize:11,color:'#1FD760'}}>{o.id}</span></td>
                  <td><span style={{fontSize:10,padding:'2px 7px',borderRadius:6,background:o.type==='restaurant'?'rgba(255,140,0,.12)':'rgba(31,215,96,.1)',color:o.type==='restaurant'?'#FF8C00':'#1FD760'}}>{o.type==='restaurant'?`🍽 ${o.rest||''}` :o.type==='mixed'?'🔀 Смеш.':'🛒'}</span></td>
                  <td><div style={{fontWeight:600,fontSize:12}}>{o.client}</div><div style={{fontSize:10,color:'#3D6645'}}>{o.phone}</div></td>
                  <td style={{fontSize:10,color:'#8FB897',maxWidth:100}}>{o.addr||'—'}</td>
                  <td style={{fontSize:11,color:'#8FB897',maxWidth:130}}>{o.items}</td>
                  <td><span className="ub" style={{fontSize:12,fontWeight:800}}>{o.total} ЅМ</span></td>
                  <td style={{fontSize:11,color:o.courier==='—'?'#3D6645':'#3B8EF0',fontWeight:o.courier==='—'?400:700}}>{o.courier}</td>
                  <td style={{fontSize:11,color:o.assembler==='—'?'#3D6645':'#9B6DFF',fontWeight:o.assembler==='—'?400:700}}>{o.assembler}</td>
                  <td>
                    {(() => { const sc = adminStatusLabel(o.status); return <Badge v={sc.l} c={sc.c}/>; })()}
                  </td>
                  <td style={{fontSize:11,color:'#3D6645'}}>{o.time}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── PRODUCTS ───────────────────────────────────── */
function ProductsPage() {
  const { setPhoto, getPhoto, hydrate } = useProductPhotos();
  const apiProducts = useProducts(s => s.products);
  const saveProduct = useProducts(s => s.saveProduct);
  const removeProduct = useProducts(s => s.removeProduct);
  const prods = useMemo(() => enrichProducts(apiProducts, PRODS), [apiProducts]);
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
  const [nPhoto,  setNPhoto]  = useState('');
  const [nStock,  setNStock]  = useState('');
  const [nOrganic,setNOrganic]= useState(false);
  const [nSellType,setNSellType]=useState('piece');
  const [nWeightStep,setNWeightStep]=useState('100');
  const [nUnitGrams,setNUnitGrams]=useState('1000');
  const [nDesc,setNDesc]=useState('');
  const [editForm,setEditForm]=useState(null);
  const [ePhoto,  setEPhoto]  = useState('');

  useEffect(() => { hydrate(); }, [hydrate]);
  useEffect(() => {
    if (!editP) { setEditForm(null); return; }
    setEPhoto(editP.photo || getPhoto(editP.id) || '');
    setEditForm({
      name: editP.name,
      art: editP.art,
      e: editP.e || '📦',
      desc: editP.desc || '',
      brand: editP.brand || '',
      country: editP.country || '',
      barcode: editP.barcode || '',
      price: editP.price,
      old: editP.old ?? '',
      stock: editP.stock,
      unit: editP.unit || 'шт',
      catId: editP.catId,
      sellType: editP.sellType || 'piece',
      weightStep: editP.weightStep || 100,
      minWeight: editP.minWeight || editP.weightStep || 100,
      unitGrams: editP.unitGrams || productUnitGrams(editP),
      hot: !!editP.hot,
      organic: !!editP.organic,
    });
  }, [editP, getPhoto]);

  const syncGBS = () => { setSyncMsg('loading'); setTimeout(()=>setSyncMsg('ok'),1800); setTimeout(()=>setSyncMsg(''),5000); };

  const filtered = prods.filter(p => {
    const q = search.toLowerCase();
    const matchQ = !search || p.name.toLowerCase().includes(q) || p.art.toLowerCase().includes(q) || p.cat.toLowerCase().includes(q);
    const matchC = catFlt==='all' || p.catId===catFlt;
    return matchQ && matchC;
  });

  const resetAddForm = () => {
    setNName(''); setNArt(''); setNPrice(''); setNOld(''); setNUnit(''); setNStock('');
    setNEmoji('📦'); setNPhoto(''); setNOrganic(false); setNSellType('piece');
    setNWeightStep('100'); setNUnitGrams('1000'); setNDesc('');
  };

  const closeAddModal = () => { setShowAdd(false); resetAddForm(); };

  const addProd = async () => {
    if(!nName||!nPrice) return;
    const newId = Math.max(0, ...prods.map(p=>p.id))+1;
    const nextArt = 'KAK-'+String(newId).padStart(4,'0');
    const product = {
      id:newId, art:nArt||nextArt, e:nEmoji, name:nName, price:Number(nPrice),
      old:nOld?Number(nOld):null, cat:CATS_LIST.find(c=>c.id===nCat)?.name||nCat, catId:nCat,
      unit:nUnit||'шт', stock:Number(nStock)||0, hot:false, organic:nOrganic,
      desc:nDesc||undefined, sellType:nSellType,
      ...(nSellType==='weight' ? {
        weightStep:Number(nWeightStep)||100,
        minWeight:Number(nWeightStep)||100,
        unitGrams:Number(nUnitGrams)||1000,
      } : {}),
      discount:nOld?Math.round((1-Number(nPrice)/Number(nOld))*100):0,
      photo:nPhoto||undefined,
    };
    const saved = await saveProduct(product);
    if (saved && nPhoto) setPhoto(saved.id, nPhoto);
    closeAddModal();
  };

  const saveEdit = async () => {
    if (!editP || !editForm) return;
    const price = Number(editForm.price);
    const old = editForm.old !== '' && editForm.old != null ? Number(editForm.old) : null;
    const updated = {
      ...editP,
      ...editForm,
      price, old,
      stock: Number(editForm.stock),
      catId: editForm.catId,
      cat: CATS_LIST.find(c=>c.id===editForm.catId)?.name || editP.cat,
      discount: old && old > price ? Math.round((1 - price / old) * 100) : 0,
      photo: ePhoto || undefined,
      sellType: editForm.sellType || 'piece',
      ...(editForm.sellType === 'weight' ? {
        weightStep: Number(editForm.weightStep) || 100,
        minWeight: Number(editForm.minWeight) || Number(editForm.weightStep) || 100,
        unitGrams: Number(editForm.unitGrams) || 1000,
      } : { weightStep: undefined, minWeight: undefined, unitGrams: undefined }),
    };
    await saveProduct(updated);
    if (ePhoto) setPhoto(editP.id, ePhoto);
    else useProductPhotos.getState().removePhoto(editP.id);
    setEditP(null);
  };

  const delProd = async (id) => { await removeProduct(id); };

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
                      <div style={{width:34,height:34,borderRadius:9,background:'#162B1A',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0,overflow:'hidden'}}>
                        {(p.photo || getPhoto(p.id))
                          ? <img src={p.photo || getPhoto(p.id)} alt="" style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
                          : p.e
                        }
                      </div>
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
                  <td style={{fontSize:11,color:'#8FB897'}}>{p.unit}{isWeighted(p)?' ⚖️':''}</td>
                  <td>
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      <div style={{width:45,height:6,borderRadius:3,background:'#162B1A',overflow:'hidden'}}><div style={{height:'100%',width:`${Math.min(100,p.stock/25*100)}%`,background:sc.c,borderRadius:3}}/></div>
                      <span style={{fontSize:12,fontWeight:700,color:sc.c}}>{p.stock}</span>
                    </div>
                  </td>
                  <td>
                    <div onClick={()=>saveProduct({ ...p, hot: !p.hot })} style={{width:36,height:20,borderRadius:10,background:p.hot?'#1FD760':'#1D3822',position:'relative',cursor:'pointer',flexShrink:0}}>
                      <div style={{position:'absolute',top:2,left:p.hot?17:2,width:16,height:16,borderRadius:'50%',background:'white',transition:'left .2s'}}/>
                    </div>
                  </td>
                  <td>
                    <div onClick={()=>saveProduct({ ...p, organic: !p.organic })} style={{width:36,height:20,borderRadius:10,background:p.organic?'#34D399':'#1D3822',position:'relative',cursor:'pointer',flexShrink:0}}>
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
          <div className="amodbg" onClick={closeAddModal}/>
          <div className="amodbox" style={{maxWidth:580}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
              <div className="ub" style={{fontSize:15,fontWeight:800}}>Добавить товар</div>
              <button onClick={closeAddModal} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:10,fontSize:16}}>✕</button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <PhotoUploadField value={nPhoto} onChange={setNPhoto} />
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
              <div>
                <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Описание</div>
                <textarea className="ai" value={nDesc} onChange={e=>setNDesc(e.target.value)} rows={2} placeholder="Краткое описание для клиента"/>
              </div>
              <div style={{display:'flex',gap:8}}>
                {[{id:'piece',l:'📦 Поштучно'},{id:'weight',l:'⚖️ На развес'}].map(t=>(
                  <button key={t.id} type="button" onClick={()=>setNSellType(t.id)} className="ab" style={{flex:1,padding:'8px',fontSize:12,background:nSellType===t.id?'rgba(31,215,96,.14)':'#091508',border:`1.5px solid ${nSellType===t.id?'rgba(31,215,96,.35)':'#162B1A'}`,color:nSellType===t.id?'#1FD760':'#8FB897'}}>{t.l}</button>
                ))}
              </div>
              {nSellType==='weight'&&(
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                  <div><div style={{fontSize:10,color:'#3D6645',marginBottom:4}}>Цена за (г)</div><input className="ai" value={nUnitGrams} onChange={e=>setNUnitGrams(e.target.value)} type="number"/></div>
                  <div><div style={{fontSize:10,color:'#3D6645',marginBottom:4}}>Шаг в корзине (г)</div><input className="ai" value={nWeightStep} onChange={e=>setNWeightStep(e.target.value)} type="number"/></div>
                </div>
              )}
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
      {editP&&editForm&&(
        <div className="amod">
          <div className="amodbg" onClick={()=>setEditP(null)}/>
          <div className="amodbox" style={{maxWidth:560,maxHeight:'92vh',overflowY:'auto'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <input className="ai" value={editForm.e} onChange={e=>setEditForm(f=>({...f,e:e.target.value}))} style={{width:52,textAlign:'center',fontSize:24,padding:'8px 4px'}}/>
                <div>
                  <input className="ai" value={editForm.name} onChange={e=>setEditForm(f=>({...f,name:e.target.value}))} style={{fontFamily:'Unbounded',fontWeight:800,fontSize:14,marginBottom:4}}/>
                  <div style={{fontSize:11,color:'#8FB897'}}>{editForm.art}</div>
                </div>
              </div>
              <button onClick={()=>setEditP(null)} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:10,fontSize:16}}>✕</button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <PhotoUploadField value={ePhoto} onChange={setEPhoto} height={120} />
              <div>
                <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Описание</div>
                <textarea className="ai" value={editForm.desc} onChange={e=>setEditForm(f=>({...f,desc:e.target.value}))} rows={3} placeholder="Подробное описание для клиента..." style={{resize:'vertical',minHeight:72}}/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Бренд</div><input className="ai" value={editForm.brand} onChange={e=>setEditForm(f=>({...f,brand:e.target.value}))} placeholder="Производитель"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Страна</div><input className="ai" value={editForm.country} onChange={e=>setEditForm(f=>({...f,country:e.target.value}))} placeholder="Таджикистан"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Штрих-код</div><input className="ai" value={editForm.barcode} onChange={e=>setEditForm(f=>({...f,barcode:e.target.value}))} placeholder="4600..."/></div>
              </div>
              <div style={{padding:'12px 14px',borderRadius:12,background:'#0C1C0F',border:'1px solid #162B1A'}}>
                <div style={{fontSize:11,color:'#8FB897',marginBottom:8,fontWeight:700}}>Тип продажи</div>
                <div style={{display:'flex',gap:8,marginBottom:10}}>
                  {[{id:'piece',l:'📦 Поштучно'},{id:'weight',l:'⚖️ На развес'}].map(t=>(
                    <button key={t.id} type="button" onClick={()=>setEditForm(f=>({...f,sellType:t.id}))} className="ab" style={{flex:1,padding:'9px 8px',fontSize:12,background:editForm.sellType===t.id?'rgba(31,215,96,.14)':'#091508',border:`1.5px solid ${editForm.sellType===t.id?'rgba(31,215,96,.35)':'#162B1A'}`,color:editForm.sellType===t.id?'#1FD760':'#8FB897'}}>{t.l}</button>
                  ))}
                </div>
                {editForm.sellType==='weight' && (
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
                    <div><div style={{fontSize:10,color:'#3D6645',marginBottom:4}}>Цена за (г)</div><input className="ai" type="number" value={editForm.unitGrams} onChange={e=>setEditForm(f=>({...f,unitGrams:Number(e.target.value)}))}/></div>
                    <div><div style={{fontSize:10,color:'#3D6645',marginBottom:4}}>Шаг (+г)</div><input className="ai" type="number" value={editForm.weightStep} onChange={e=>setEditForm(f=>({...f,weightStep:Number(e.target.value)}))}/></div>
                    <div><div style={{fontSize:10,color:'#3D6645',marginBottom:4}}>Минимум (г)</div><input className="ai" type="number" value={editForm.minWeight} onChange={e=>setEditForm(f=>({...f,minWeight:Number(e.target.value)}))}/></div>
                  </div>
                )}
                <div style={{fontSize:10,color:'#3D6645',marginTop:8}}>
                  {editForm.sellType==='weight'
                    ? `Клиент добавляет в корзину с шагом ${editForm.weightStep || 100} г · ${formatPriceLabel({ ...editForm, price: Number(editForm.price)||0 })}`
                    : 'Клиент добавляет целыми штуками / упаковками'}
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Цена (ЅМ)</div><input className="ai" value={editForm.price} onChange={e=>setEditForm(f=>({...f,price:e.target.value}))} type="number"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Старая цена (ЅМ)</div><input className="ai" value={editForm.old} onChange={e=>setEditForm(f=>({...f,old:e.target.value}))} type="number" placeholder="Без скидки"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Остаток</div><input className="ai" value={editForm.stock} onChange={e=>setEditForm(f=>({...f,stock:e.target.value}))} type="number"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Единица (отображение)</div><input className="ai" value={editForm.unit} onChange={e=>setEditForm(f=>({...f,unit:e.target.value}))} placeholder="500 гр / шт / 1 л"/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
                <div>
                  <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Категория</div>
                  <select className="ai" value={editForm.catId} onChange={e=>setEditForm(f=>({...f,catId:e.target.value}))} style={{cursor:'pointer'}}>
                    {CATS_LIST.map(c=><option key={c.id} value={c.id}>{c.e} {c.name}</option>)}
                  </select>
                </div>
                <div style={{display:'flex',alignItems:'flex-end',gap:8,paddingBottom:2}}>
                  <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12,cursor:'pointer'}}><input type="checkbox" checked={editForm.hot} onChange={e=>setEditForm(f=>({...f,hot:e.target.checked}))}/> 🔥 Хит</label>
                  <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12,cursor:'pointer'}}><input type="checkbox" checked={editForm.organic} onChange={e=>setEditForm(f=>({...f,organic:e.target.checked}))}/> 🌿 Органик</label>
                </div>
              </div>
              <div style={{display:'flex',gap:10}}>
                <button onClick={saveEdit} className="ab abp" style={{flex:1,padding:11}}>✓ Сохранить изменения</button>
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
  const pickups = usePickupStore(s => s.pickups);
  const syncRestaurantPickup = usePickupStore(s => s.syncRestaurantPickup);
  const updatePickup = usePickupStore(s => s.updatePickup);
  const apiRests = useRestaurants(s => s.restaurants);
  const toggleOpenApi = useRestaurants(s => s.toggleOpen);
  const blockRestaurantApi = useRestaurants(s => s.blockRestaurant);
  const fetchRestaurantsApi = useRestaurants(s => s.fetchRestaurants);
  const updateRestaurantApi = useRestaurants(s => s.updateRestaurant);
  const toggleMenuApi = useRestaurants(s => s.toggleMenuItem);
  const [rests, setRests] = useState(RESTAURANTS.map(r => ({ ...r })));
  const [savingInfo, setSavingInfo] = useState(false);
  useEffect(() => {
    if (USE_API && apiRests.length) {
      setRests(enrichRestaurants(apiRests, RESTAURANTS));
    }
  }, [apiRests]);
  const [sel, setSel] = useState<any>(null);
  const [tab, setTab] = useState('info');
  const [showAdd, setShowAdd] = useState(false);
  const [showPay, setShowPay] = useState<any>(null);
  const [payMethod, setPayMethod] = useState('cash');
  const [payNote, setPayNote] = useState('');
  const [paySaving, setPaySaving] = useState(false);
  const [payDone, setPayDone] = useState(false);
  const [payError, setPayError] = useState('');
  const [payMode, setPayMode] = useState<'full' | 'partial'>('full');
  const [payAmountInput, setPayAmountInput] = useState('');
  const [lastPaidPayout, setLastPaidPayout] = useState<any>(null);
  const [payoutHistory, setPayoutHistory] = useState<any[]>([]);
  const [editForm, setEditForm] = useState<any>(null);
  const [locError, setLocError] = useState('');
  const [addForm, setAddForm] = useState({
    emoji: '🍽', name: '', cuisine: '', address: '', phone: '', email: '',
    password: '', commission: '15', lat: null as number | null, lng: null as number | null,
  });

  const toggleOpen = id => {
    toggleOpenApi(id);
    setRests(rs => rs.map(r => r.id === id ? { ...r, open: !r.open } : r));
  };
  const toggleMenu = (rId, mId) => {
    toggleMenuApi(rId, mId);
    setRests(rs => rs.map(r => r.id === rId ? { ...r, menu: r.menu.map(m => m.id === mId ? { ...m, inStock: !m.inStock } : m) } : r));
  };
  const totalComm = rests.reduce((s, r) => {
    const paidGross = r.paidRevenueMonth || 0;
    const pendingGross = Math.max(0, (r.revenueMonth || 0) - paidGross);
    return s + Math.round(pendingGross * r.commission / 100);
  }, 0);

  const payoutAmounts = (r: any) => {
    const totalGross = r?.revenueMonth || 0;
    const paidGross = r?.paidRevenueMonth || 0;
    const pendingGross = Math.max(0, totalGross - paidGross);
    const pct = r?.commission || 0;
    const pendingCommission = Math.round(pendingGross * pct / 100);
    const paidCommission = Math.round(paidGross * pct / 100);
    const pendingNet = Math.max(0, pendingGross - pendingCommission);
    const paidNet = Math.max(0, paidGross - paidCommission);
    return {
      revenue: totalGross,
      paidGross,
      pendingGross,
      commissionAmt: pendingCommission,
      paidCommission,
      paidNet,
      net: pendingNet,
    };
  };

  const syncRestaurantPayoutFields = (updated: any) => {
    setRests(rs => rs.map(r => r.id === showPay.id ? {
      ...r,
      revenueMonth: updated.revenueMonth,
      paidRevenueMonth: updated.paidRevenueMonth ?? 0,
      ordersMonth: updated.ordersMonth,
    } : r));
    setShowPay((p: any) => ({
      ...p,
      revenueMonth: updated.revenueMonth,
      paidRevenueMonth: updated.paidRevenueMonth ?? 0,
      ordersMonth: updated.ordersMonth,
    }));
    if (sel?.id === showPay.id) {
      setSel((s: any) => ({
        ...s,
        revenueMonth: updated.revenueMonth,
        paidRevenueMonth: updated.paidRevenueMonth ?? 0,
        ordersMonth: updated.ordersMonth,
      }));
    }
  };

  const openPay = async (r: any) => {
    setShowPay(r);
    setPayMethod('cash');
    setPayNote('');
    setPayDone(false);
    setPayError('');
    setPayMode('full');
    setLastPaidPayout(null);
    if (USE_API) {
      try {
        const [history, fresh] = await Promise.all([
          api.getPayouts(r.id),
          api.getRestaurant(r.id),
        ]);
        setPayoutHistory(history);
        const freshRest = { ...fresh, paidRevenueMonth: fresh.paidRevenueMonth ?? 0 };
        setShowPay(freshRest);
        const { net } = payoutAmounts(freshRest);
        setPayAmountInput(net > 0 ? String(net) : '');
      } catch {
        setPayoutHistory([]);
        const { net } = payoutAmounts(r);
        setPayAmountInput(net > 0 ? String(net) : '');
      }
    } else {
      const { net } = payoutAmounts(r);
      setPayAmountInput(net > 0 ? String(net) : '');
    }
  };

  const confirmPayout = async () => {
    if (!showPay || paySaving) return;
    const bal = payoutAmounts(showPay);
    const { net, pendingGross } = bal;
    if (net <= 0) return;

    let payNet = payMode === 'partial' ? Math.round(Number(payAmountInput) || 0) : net;
    if (payNet <= 0) {
      setPayError('Укажите сумму выплаты');
      return;
    }
    if (payNet > net) {
      setPayError(`Максимум к выплате: ${net.toLocaleString()} ЅМ`);
      return;
    }

    setPaySaving(true);
    setPayError('');
    try {
      if (USE_API) {
        const payload: { method: string; note: string; amount?: number } = {
          method: payMethod,
          note: payNote,
        };
        if (payMode === 'partial' || payNet < net) payload.amount = payNet;
        const result = await api.createPayout(showPay.id, payload);
        syncRestaurantPayoutFields(result.restaurant);
        setLastPaidPayout(result.payout);
        const history = await api.getPayouts(showPay.id);
        setPayoutHistory(history);
        await fetchRestaurantsApi();
      } else {
        const pct = showPay.commission || 0;
        const rate = (100 - pct) / 100;
        const isFull = payNet >= net;
        const grossPay = isFull ? pendingGross : Math.min(pendingGross, Math.round(payNet / (rate || 1)));
        const commissionPay = Math.round(grossPay * pct / 100);
        const actualNet = isFull ? net : grossPay - commissionPay;
        const newPaidGross = (showPay.paidRevenueMonth || 0) + grossPay;
        const fullySettled = isFull || newPaidGross >= (showPay.revenueMonth || 0);
        const record = {
          id: Date.now(),
          restId: showPay.id,
          restName: showPay.name,
          emoji: showPay.emoji,
          partial: !fullySettled,
          revenueTotal: showPay.revenueMonth,
          revenuePaid: grossPay,
          revenue: grossPay,
          revenueRemaining: fullySettled ? 0 : Math.max(0, (showPay.revenueMonth || 0) - newPaidGross),
          commission: commissionPay,
          commissionPct: pct,
          amount: actualNet,
          netRemaining: fullySettled ? 0 : net - actualNet,
          paidNetBefore: net,
          method: payMethod,
          note: payNote.trim(),
          date: new Date().toLocaleString('ru-RU'),
        };
        setPayoutHistory(h => [record, ...h].slice(0, 200));
        const updated = fullySettled
          ? { revenueMonth: 0, paidRevenueMonth: 0, ordersMonth: 0 }
          : { revenueMonth: showPay.revenueMonth, paidRevenueMonth: newPaidGross, ordersMonth: showPay.ordersMonth };
        syncRestaurantPayoutFields(updated);
        setLastPaidPayout(record);
      }
      setPayDone(true);
    } catch (e: any) {
      setPayError(e?.message || 'Не удалось провести выплату');
    } finally {
      setPaySaving(false);
    }
  };

  const closePay = () => {
    setShowPay(null);
    setPayDone(false);
    setPayNote('');
    setPayMode('full');
    setLastPaidPayout(null);
  };

  const payMethodLabel = (m: string) => (
    m === 'transfer' ? '🏦 Банковский перевод' : m === 'mobile' ? '📱 Kaspi / HUMO' : '💵 Наличными'
  );

  const renderPayoutHistoryItem = (p: any) => (
    <div key={p.id} style={{padding:'10px 11px',borderRadius:10,background:'#081208',border:'1px solid #162B1A',marginBottom:8}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:6}}>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>
            {p.partial && <span style={{fontSize:9,fontWeight:800,color:'#FFB800',background:'rgba(255,184,0,.12)',padding:'2px 6px',borderRadius:6}}>ЧАСТИЧНАЯ</span>}
            {!p.partial && <span style={{fontSize:9,fontWeight:800,color:'#1FD760',background:'rgba(31,215,96,.12)',padding:'2px 6px',borderRadius:6}}>ПОЛНАЯ</span>}
          </div>
          <div style={{fontSize:11,color:'#8FB897'}}>{p.date}</div>
          <div style={{fontSize:10,color:'#3D6645',marginTop:2}}>{payMethodLabel(p.method)}</div>
        </div>
        <div style={{textAlign:'right'}}>
          <div className="ub" style={{fontSize:14,fontWeight:900,color:'#1FD760'}}>+{(p.amount ?? 0).toLocaleString()} ЅМ</div>
          {(p.netRemaining ?? 0) > 0 && (
            <div style={{fontSize:10,color:'#FFB800',marginTop:2}}>осталось {(p.netRemaining).toLocaleString()} ЅМ</div>
          )}
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'4px 10px',fontSize:10,color:'#3D6645'}}>
        <span>Выручка (часть): <span style={{color:'#8FB897'}}>{(p.revenuePaid ?? p.revenue ?? 0).toLocaleString()} ЅМ</span></span>
        <span>Комиссия {p.commissionPct}%: <span style={{color:'#FF4545'}}>−{(p.commission ?? 0).toLocaleString()} ЅМ</span></span>
        {(p.revenueTotal ?? 0) > 0 && <span>Выручка периода: <span style={{color:'#8FB897'}}>{p.revenueTotal.toLocaleString()} ЅМ</span></span>}
        {(p.paidNetBefore ?? 0) > 0 && <span>Было к выплате: <span style={{color:'#8FB897'}}>{p.paidNetBefore.toLocaleString()} ЅМ</span></span>}
        {(p.orders ?? 0) > 0 && <span>Заказов: <span style={{color:'#8FB897'}}>{p.orders}</span></span>}
      </div>
      {p.note && <div style={{fontSize:10,color:'#8FB897',marginTop:6,paddingTop:6,borderTop:'1px solid #162B1A'}}>💬 {p.note}</div>}
    </div>
  );

  const openManage = (r: typeof RESTAURANTS[0]) => {
    const p = pickups.find(x => x.id === restIdToPickupId(r.id));
    setEditForm({
      name: r.name, cuisine: r.cuisine, address: r.address, phone: r.phone,
      email: r.email, hours: '09:00–23:00',
      lat: p?.lat ?? STORE_LOCATION.lat, lng: p?.lng ?? STORE_LOCATION.lng,
      open: r.open,
      blocked: !!r.blocked,
    });
    setLocError('');
    setSel(r);
    setTab('info');
  };

  const syncPickupForRest = (rest: any, active: boolean, lat?: number, lng?: number, addr?: string, phone?: string) => {
    const p = pickups.find(x => x.id === restIdToPickupId(rest.id));
    const pickupLat = lat ?? p?.lat ?? STORE_LOCATION.lat;
    const pickupLng = lng ?? p?.lng ?? STORE_LOCATION.lng;
    const pickupAddr = addr ?? rest.address;
    const pickupPhone = phone ?? rest.phone;
    syncRestaurantPickup({
      restId: rest.id, e: rest.emoji, name: rest.name,
      addr: pickupAddr, phone: pickupPhone, lat: pickupLat, lng: pickupLng, active,
    });
    updatePickup(restIdToPickupId(rest.id), {
      active,
      lat: pickupLat,
      lng: pickupLng,
      addr: pickupAddr,
      phone: pickupPhone,
      name: rest.name,
      e: rest.emoji,
    });
  };

  const persistPickupCoords = async (rest: any, lat: number, lng: number, addr: string, phone: string, active: boolean) => {
    const pickupId = restIdToPickupId(rest.id);
    const patch = { lat, lng, addr, phone, name: rest.name, e: rest.emoji, active };
    syncRestaurantPickup({ restId: rest.id, e: rest.emoji, name: rest.name, addr, phone, lat, lng, active });
    updatePickup(pickupId, patch);
    if (USE_API) await api.updatePickup(pickupId, patch);
  };

  const applyBlockStatus = async (rest: any, nextBlocked: boolean, form?: any) => {
    const merged = {
      ...rest,
      blocked: nextBlocked,
      open: nextBlocked ? false : true,
    };
    setRests(rs => rs.map(r => r.id === rest.id ? merged : r));
    if (sel?.id === rest.id) {
      setSel(merged);
      if (form) setEditForm((x: any) => x ? { ...x, blocked: nextBlocked, open: merged.open } : x);
    }
    syncPickupForRest(
      merged,
      !nextBlocked,
      form?.lat,
      form?.lng,
      form?.address ?? merged.address,
      form?.phone ?? merged.phone,
    );
    try {
      const updated = await blockRestaurantApi(rest.id, nextBlocked);
      if (updated) {
        const synced = { ...merged, ...updated, blocked: nextBlocked, open: nextBlocked ? false : true };
        setRests(rs => rs.map(r => r.id === rest.id ? synced : r));
        if (sel?.id === rest.id) {
          setSel(synced);
          if (form) setEditForm((x: any) => x ? { ...x, blocked: nextBlocked, open: synced.open } : x);
        }
      }
    } catch {
      /* локальное состояние уже обновлено */
    }
    return merged;
  };

  const onBlockToggle = async () => {
    if (!sel || !editForm) return;
    await applyBlockStatus(sel, !editForm.blocked, editForm);
  };

  const pushPickup = (rest: any, lat: number, lng: number, addr: string, phone: string, active: boolean) => {
    void persistPickupCoords(rest, lat, lng, addr, phone, active);
  };

  const saveInfo = async () => {
    if (!sel || !editForm) return;
    if (editForm.lat == null || editForm.lng == null) { setLocError('Укажите место ресторана на карте'); return; }
    setSavingInfo(true);
    setLocError('');
    const updated = {
      ...sel,
      name: editForm.name, cuisine: editForm.cuisine, address: editForm.address,
      phone: editForm.phone, email: editForm.email, open: editForm.open,
      blocked: editForm.blocked,
    };
    let pickupOk = false;
    let restOk = false;
    try {
      await persistPickupCoords(
        updated,
        editForm.lat,
        editForm.lng,
        editForm.address,
        editForm.phone,
        !editForm.blocked,
      );
      pickupOk = true;
    } catch { /* pickup failed */ }
    try {
      await updateRestaurantApi(sel.id, {
        name: editForm.name,
        cuisine: editForm.cuisine,
        address: editForm.address,
        phone: editForm.phone,
        email: editForm.email,
        open: editForm.open,
      });
      restOk = true;
    } catch { /* restaurant patch may be missing on old API */ }
    setRests(rs => rs.map(r => r.id === sel.id ? updated : r));
    setSel(updated);
    if (pickupOk || restOk) {
      if (!pickupOk) setLocError('Адрес сохранён, но координаты не записались на сервер.');
      else if (!restOk && USE_API) setLocError('');
      else setLocError('');
    } else {
      setLocError('Не удалось сохранить. Перезапустите backend: cd server && npm run dev');
    }
    setSavingInfo(false);
  };

  const resetAddForm = () => {
    setAddForm({
      emoji: '🍽', name: '', cuisine: '', address: '', phone: '', email: '',
      password: '', commission: '15', lat: null, lng: null,
    });
    setLocError('');
  };

  const saveAdd = () => {
    if (!addForm.name.trim()) { setLocError('Укажите название ресторана'); return; }
    if (addForm.lat == null || addForm.lng == null) { setLocError('Выберите место на карте'); return; }
    const newId = `R-0${rests.length + 1}`;
    const commission = Number(addForm.commission) || 15;
    const newRest = {
      id: newId, name: addForm.name.trim(), emoji: addForm.emoji || '🍽',
      cuisine: addForm.cuisine.trim() || '—', address: addForm.address.trim(),
      phone: addForm.phone.trim(), email: addForm.email.trim(), commission,
      open: true, rating: 5, reviews: 0, ordersMonth: 0, revenueMonth: 0,
      img: 'linear-gradient(135deg,#1A0808,#3A1010)', menu: [],
    };
    setRests(rs => [...rs, newRest]);
    pushPickup(newRest, addForm.lat, addForm.lng, addForm.address, addForm.phone, true);
    setShowAdd(false);
    resetAddForm();
  };

  const MapBlock = ({ lat, lng, onPick }: { lat: number | null; lng: number | null; onPick: (r: { lat: number; lng: number; address: string }) => void }) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 6, fontWeight: 700 }}>📍 Место на карте *</div>
      <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #162B1A' }}>
        <AddressMapPicker
          variant="admin"
          mapHeight={240}
          initial={lat != null && lng != null ? { lat, lng } : { lat: STORE_LOCATION.lat, lng: STORE_LOCATION.lng }}
          onSelect={onPick}
        />
      </div>
      {lat != null && lng != null && (
        <div style={{ marginTop: 6, fontSize: 10, color: '#3D6645', fontFamily: 'monospace' }}>
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </div>
      )}
    </div>
  );
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
          <div key={r.id} className="ac" style={{overflow:'hidden',animation:`fadeUp .4s ease ${i*.07}s both`,opacity:r.blocked?.5:(r.open?1:.7)}}>
            <div style={{height:80,background:r.img,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 15px',position:'relative'}}>
              <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,.35)'}}/>
              <div style={{position:'relative',zIndex:1}}><div className="ub" style={{fontSize:13,fontWeight:900,color:'white',marginBottom:1}}>{r.name}</div><div style={{fontSize:10,color:'rgba(255,255,255,.6)'}}>{r.cuisine} · {r.address}</div></div>
              <div style={{position:'relative',zIndex:1,display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
                {r.blocked && <Badge v="Заблокирован" c="#FF4545"/>}
                <span style={{fontSize:32}}>{r.emoji}</span>
              </div>
            </div>
            <div style={{padding:'12px 14px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                <div style={{display:'flex',gap:14}}>
                  <div style={{textAlign:'center'}}><div style={{fontSize:9,color:'#3D6645'}}>Заказов</div><div className="ub" style={{fontSize:13,fontWeight:800}}>{r.ordersMonth}</div></div>
                  <div style={{textAlign:'center'}}><div style={{fontSize:9,color:'#3D6645'}}>Выручка</div><div className="ub" style={{fontSize:13,fontWeight:800}}>{(r.revenueMonth/1000).toFixed(1)}k</div></div>
                  <div style={{textAlign:'center'}}><div style={{fontSize:9,color:'#FF4545'}}>Комиссия</div><div className="ub" style={{fontSize:13,fontWeight:800,color:'#FF4545'}}>{r.commission}%</div></div>
                </div>
                <Tog on={r.open} set={()=>{ if (!r.blocked) toggleOpen(r.id); }}/>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={() => openManage(r)} className="ab abg" style={{flex:1,padding:'7px',fontSize:11}}>⚙️ Управление</button>
                <button onClick={() => openPay(r)} className="ab" style={{flex:1,padding:'7px',fontSize:11,background:'rgba(255,184,0,.1)',border:'1.5px solid rgba(255,184,0,.3)',color:'#FFB800'}}>💰 Выплата</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {/* Комиссии */}
      <div className="ac">
        <div style={{padding:'12px 16px',borderBottom:'1px solid #162B1A',fontWeight:800,fontSize:13}}>Комиссии за месяц</div>
        <table className="at">
          <thead><tr><th>Ресторан</th><th>Выручка</th><th>Комиссия %</th><th>КАКАПО</th><th>Ресторан получает</th><th></th></tr></thead>
          <tbody>
            {rests.map(r=>(
              <tr key={r.id}>
                <td><div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:18}}>{r.emoji}</span><span style={{fontWeight:700}}>{r.name}</span></div></td>
                <td><span className="ub" style={{fontSize:12}}>{r.revenueMonth.toLocaleString()} ЅМ</span></td>
                <td><div style={{display:'flex',alignItems:'center',gap:6}}><input type="number" defaultValue={r.commission} className="ai" style={{width:60,padding:'4px 8px',fontSize:12,textAlign:'center'}}/><span style={{fontSize:11,color:'#3D6645'}}>%</span></div></td>
                <td><span className="ub" style={{fontSize:12,color:'#1FD760',fontWeight:900}}>{Math.round(r.revenueMonth*r.commission/100).toLocaleString()} ЅМ</span></td>
                <td><span className="ub" style={{fontSize:12}}>{Math.round(r.revenueMonth*(1-r.commission/100)).toLocaleString()} ЅМ</span></td>
                <td><button onClick={() => openPay(r)} className="ab" style={{padding:'4px 11px',fontSize:11,background:'rgba(255,184,0,.1)',border:'1px solid rgba(255,184,0,.28)',color:'#FFB800'}}>Выплатить</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Modal управление */}
      {sel&&(
        <div className="amod">
          <div className="amodbg" onClick={()=>setSel(null)}/>
          <div className="amodbox" style={{maxWidth:700,maxHeight:'92vh',overflowY:'auto'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}><span style={{fontSize:28}}>{sel.emoji}</span><div><div className="ub" style={{fontSize:14,fontWeight:800}}>{sel.name}</div><div style={{fontSize:11,color:'#8FB897'}}>{sel.cuisine} · {sel.address}</div></div></div>
              <button onClick={()=>setSel(null)} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:10,fontSize:16}}>✕</button>
            </div>
            <div style={{display:'flex',gap:6,marginBottom:16,flexWrap:'wrap'}}>
              {[{id:'info',l:'📋 Инфо'},{id:'menu',l:'🍽 Меню'},{id:'orders',l:'📦 Заказы'},{id:'commission',l:'💰 Комиссия'},{id:'access',l:'🔑 Доступ'}].map(t=>(
                <button key={t.id} onClick={()=>setTab(t.id)} className="ab" style={{padding:'6px 13px',fontSize:11,background:tab===t.id?'rgba(31,215,96,.12)':'#0C1C0F',border:`1.5px solid ${tab===t.id?'rgba(31,215,96,.35)':'#162B1A'}`,color:tab===t.id?'#1FD760':'#8FB897'}}>{t.l}</button>
              ))}
            </div>
            {tab==='info'&&editForm&&(
              <div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
                  {[
                    {l:'Название',k:'name'},{l:'Кухня',k:'cuisine'},{l:'Адрес',k:'address'},
                    {l:'Телефон',k:'phone'},{l:'Email',k:'email'},{l:'Часы',k:'hours'},
                  ].map((f,i)=>(
                    <div key={i}>
                      <div style={{fontSize:11,color:'#8FB897',marginBottom:4,fontWeight:700}}>{f.l}</div>
                      <input className="ai" value={editForm[f.k]||''} onChange={e=>setEditForm((x:any)=>({...x,[f.k]:e.target.value}))}/>
                    </div>
                  ))}
                </div>
                <MapBlock
                  lat={editForm.lat} lng={editForm.lng}
                  onPick={r => {
                    const addr = r.address || editForm.address;
                    setEditForm((x: any) => ({ ...x, lat: r.lat, lng: r.lng, address: addr }));
                    if (sel) {
                      void persistPickupCoords(
                        { ...sel, name: editForm.name, address: addr },
                        r.lat,
                        r.lng,
                        addr,
                        editForm.phone,
                        !editForm.blocked,
                      ).catch(() => setLocError('Точка выбрана, но не сохранилась на сервере. Нажмите «Сохранить».'));
                    }
                  }}
                />
                {locError&&<div style={{marginBottom:10,fontSize:11,color:'#FF4545'}}>⚠️ {locError}</div>}
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'11px 14px',borderRadius:11,background:!editForm.blocked?'rgba(31,215,96,.07)':'rgba(255,69,69,.07)',border:`1px solid ${!editForm.blocked?'rgba(31,215,96,.2)':'rgba(255,69,69,.2)'}`,marginBottom:12}}>
                  <div>
                    <span style={{fontSize:13,fontWeight:700,color:!editForm.blocked?'#1FD760':'#FF4545'}}>{!editForm.blocked?'✓ Активен в приложении':'🚫 Заблокирован'}</span>
                    <div style={{fontSize:11,color:'#8FB897',marginTop:2}}>{!editForm.blocked?'Ресторан виден клиентам':'Не принимает заказы'}</div>
                </div>
                  <Tog on={!editForm.blocked} set={onBlockToggle}/>
                </div>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'11px 14px',borderRadius:11,background:editForm.open?'rgba(31,215,96,.07)':'rgba(255,69,69,.07)',border:`1px solid ${editForm.open?'rgba(31,215,96,.2)':'rgba(255,69,69,.2)'}`,marginBottom:14,opacity:editForm.blocked?.5:1}}>
                  <div>
                    <span style={{fontSize:13,fontWeight:700,color:editForm.open?'#1FD760':'#FF4545'}}>{editForm.open?'🟢 Открыт':'🔴 Закрыт'}</span>
                    <div style={{fontSize:11,color:'#8FB897',marginTop:2}}>{editForm.open?'Принимает заказы сейчас':'Заказы остановлены'}</div>
                  </div>
                  <Tog on={editForm.open} set={()=>{
                    if (editForm.blocked) return;
                    setEditForm((x:any)=>({...x,open:!x.open}));
                    toggleOpen(sel.id);
                  }}/>
                </div>
                <div style={{padding:'9px 12px',borderRadius:9,background:'rgba(59,142,240,.06)',border:'1px solid rgba(59,142,240,.2)',fontSize:11,color:'#8FB897',marginBottom:12}}>
                  📍 Координаты сохраняются как точка забора · раздел «Точки забора»
                </div>
                <button onClick={saveInfo} disabled={savingInfo} className="ab abp" style={{width:'100%',padding:10,opacity:savingInfo?0.7:1}}>
                  {savingInfo ? 'Сохранение…' : '✓ Сохранить'}
                </button>
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
                  {[{l:'Выручка/мес',v:`${sel.revenueMonth.toLocaleString()} ЅМ`,c:'#EBF5ED'},{l:`Комиссия ${sel.commission}%`,v:`${Math.round(sel.revenueMonth*sel.commission/100).toLocaleString()} ЅМ`,c:'#FF4545'},{l:'КАКАПО',v:`${Math.round(sel.revenueMonth*sel.commission/100).toLocaleString()} ЅМ`,c:'#1FD760'},{l:'Ресторан получает',v:`${Math.round(sel.revenueMonth*(1-sel.commission/100)).toLocaleString()} ЅМ`,c:'#FFB800'}].map((s,i)=>(
                    <div key={i} style={{background:'#0C1C0F',borderRadius:11,padding:'13px',border:'1px solid #162B1A'}}><div style={{fontSize:10,color:'#3D6645',marginBottom:5}}>{s.l}</div><div className="ub" style={{fontSize:18,fontWeight:900,color:s.c}}>{s.v}</div></div>
                  ))}
                </div>
                <div style={{marginBottom:12}}><div style={{fontSize:11,color:'#8FB897',marginBottom:8,fontWeight:700}}>Быстрый выбор %</div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{[10,12,15,18,20,25].map(v=><button key={v} className="ab" style={{padding:'7px 14px',fontSize:12,background:sel.commission===v?'rgba(255,69,69,.15)':'#0C1C0F',border:`1.5px solid ${sel.commission===v?'rgba(255,69,69,.4)':'#162B1A'}`,color:sel.commission===v?'#FF4545':'#8FB897'}}>{v}%</button>)}</div></div>
                <button onClick={() => openPay(sel)} className="ab" style={{width:'100%',padding:10,marginTop:8,background:'rgba(255,184,0,.1)',border:'1.5px solid rgba(255,184,0,.3)',color:'#FFB800'}}>💰 Выплатить партнёру</button>
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
      {showPay && (() => {
        const bal = payoutAmounts(showPay);
        const { revenue, paidGross, pendingGross, commissionAmt, paidCommission, paidNet, net } = bal;
        const restHistory = payoutHistory.filter(p => p.restId === showPay.id);
        const payNetPreview = payMode === 'partial'
          ? Math.min(net, Math.max(0, Math.round(Number(payAmountInput) || 0)))
          : net;
        const remainAfter = Math.max(0, net - payNetPreview);
        return (
          <div className="amod">
            <div className="amodbg" onClick={closePay}/>
            <div className="amodbox" style={{maxWidth:480,maxHeight:'92vh',overflowY:'auto'}}>
              {payDone && lastPaidPayout ? (
                <div style={{padding:'10px 4px'}}>
                  <div style={{textAlign:'center',marginBottom:16}}>
                    <div style={{fontSize:48,marginBottom:12}}>✅</div>
                    <div className="ub" style={{fontSize:16,fontWeight:800,marginBottom:8}}>
                      {lastPaidPayout.partial ? 'Частичная выплата проведена' : 'Выплата подтверждена'}
                    </div>
                    <div style={{fontSize:13,color:'#8FB897',marginBottom:6}}>{showPay.emoji} {showPay.name}</div>
                    <div className="ub" style={{fontSize:22,fontWeight:900,color:'#1FD760',marginBottom:8}}>
                      {(lastPaidPayout.amount ?? 0).toLocaleString()} ЅМ
                    </div>
                    <div style={{fontSize:12,color:'#3D6645'}}>{payMethodLabel(lastPaidPayout.method || payMethod)} · {lastPaidPayout.date}</div>
                  </div>
                  {renderPayoutHistoryItem(lastPaidPayout)}
                  {(lastPaidPayout.netRemaining ?? 0) > 0 ? (
                    <div style={{padding:'11px 12px',borderRadius:10,background:'rgba(255,184,0,.08)',border:'1px solid rgba(255,184,0,.25)',fontSize:12,color:'#FFB800',marginBottom:12,textAlign:'center'}}>
                      Осталось к выплате: <strong>{(lastPaidPayout.netRemaining).toLocaleString()} ЅМ</strong>
                    </div>
                  ) : (
                    <div style={{padding:'11px 12px',borderRadius:10,background:'rgba(31,215,96,.08)',border:'1px solid rgba(31,215,96,.25)',fontSize:12,color:'#1FD760',marginBottom:12,textAlign:'center'}}>
                      Период полностью закрыт — новые продажи начнут новый расчёт
                    </div>
                  )}
                  <button onClick={closePay} className="ab abp" style={{width:'100%',padding:12}}>Готово</button>
                </div>
              ) : (
                <>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <span style={{fontSize:28}}>{showPay.emoji}</span>
                      <div>
                        <div className="ub" style={{fontSize:14,fontWeight:800}}>Выплата</div>
                        <div style={{fontSize:11,color:'#8FB897'}}>{showPay.name}</div>
                      </div>
                    </div>
                    <button onClick={closePay} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:10,fontSize:16}}>✕</button>
                  </div>
                  {[
                    {l:'Выручка за период',v:`${revenue.toLocaleString()} ЅМ`,c:'#EBF5ED'},
                    ...(paidGross > 0 ? [{l:'Уже выплачено',v:`−${paidNet.toLocaleString()} ЅМ`,c:'#FFB800'}] : []),
                    {l:`Комиссия КАКАПО (${showPay.commission}%)`,v:`−${commissionAmt.toLocaleString()} ЅМ`,c:'#FF4545'},
                    {l:'К выплате сейчас',v:`${net.toLocaleString()} ЅМ`,c:'#1FD760'},
                  ].map((row,i)=>(
                    <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'11px 14px',background:i===3||(paidGross===0&&i===2)?'rgba(31,215,96,.06)':'#0C1C0F',borderRadius:10,border:`1px solid ${i===3||(paidGross===0&&i===2)?'rgba(31,215,96,.25)':'#162B1A'}`,marginBottom:8}}>
                      <span style={{fontSize:12,color:'#8FB897'}}>{row.l}</span>
                      <span className="ub" style={{fontSize:13,fontWeight:800,color:row.c}}>{row.v}</span>
                    </div>
                  ))}
                  {paidGross > 0 && (
                    <div style={{fontSize:10,color:'#3D6645',marginBottom:10,padding:'0 2px'}}>
                      Выплачено {paidGross.toLocaleString()} ЅМ выручки · комиссия {paidCommission.toLocaleString()} ЅМ · осталось {pendingGross.toLocaleString()} ЅМ выручки
                    </div>
                  )}
                  <div style={{display:'flex',gap:8,marginBottom:10}}>
                    {(['full','partial'] as const).map(mode=>(
                      <button key={mode} type="button" onClick={()=>{
                        setPayMode(mode);
                        if (mode === 'full') setPayAmountInput(String(net));
                      }} className="ab" style={{flex:1,padding:'8px 10px',fontSize:11,background:payMode===mode?'rgba(31,215,96,.12)':'#0C1C0F',border:`1.5px solid ${payMode===mode?'rgba(31,215,96,.35)':'#162B1A'}`,color:payMode===mode?'#1FD760':'#8FB897'}}>
                        {mode === 'full' ? '✓ Полная' : '◑ Частичная'}
                      </button>
                    ))}
                  </div>
                  {payMode === 'partial' && net > 0 && (
                    <div style={{marginBottom:10}}>
                      <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Сумма к выплате (ЅМ)</div>
                      <input className="ai" type="number" min={1} max={net} value={payAmountInput} onChange={e=>setPayAmountInput(e.target.value)} placeholder={`Макс. ${net}`}/>
                      <div style={{display:'flex',gap:6,marginTop:8,flexWrap:'wrap'}}>
                        {[0.25,0.5,0.75,1].map(frac=>(
                          <button key={frac} type="button" onClick={()=>setPayAmountInput(String(Math.round(net*frac)))} className="ab" style={{padding:'5px 10px',fontSize:10,background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897'}}>
                            {frac===1?'Вся сумма':`${frac*100}%`}
                          </button>
                        ))}
                      </div>
                      {payNetPreview > 0 && payNetPreview < net && (
                        <div style={{fontSize:11,color:'#FFB800',marginTop:8}}>
                          После выплаты останется: <strong>{remainAfter.toLocaleString()} ЅМ</strong>
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{marginBottom:10,marginTop:4}}>
                    <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Способ выплаты</div>
                    <select className="ai" value={payMethod} onChange={e=>setPayMethod(e.target.value)} style={{cursor:'pointer'}}>
                      <option value="cash">💵 Наличными</option>
                      <option value="transfer">🏦 Банковский перевод</option>
                    </select>
                  </div>
                  <div style={{marginBottom:12}}>
                    <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Комментарий (необязательно)</div>
                    <input className="ai" value={payNote} onChange={e=>setPayNote(e.target.value)} placeholder="Напр: выплата за май, часть 1"/>
                  </div>
                  {restHistory.length > 0 && (
                    <div style={{marginBottom:12,padding:'10px 12px',borderRadius:10,background:'#0C1C0F',border:'1px solid #162B1A'}}>
                      <div style={{fontSize:10,color:'#3D6645',marginBottom:8,fontWeight:700}}>ИСТОРИЯ ВЫПЛАТ ({restHistory.length})</div>
                      <div style={{maxHeight:220,overflowY:'auto',paddingRight:2}}>
                        {restHistory.map(renderPayoutHistoryItem)}
                      </div>
                    </div>
                  )}
                  {payError && (
                    <div style={{padding:'10px 12px',borderRadius:10,background:'rgba(255,69,69,.08)',border:'1px solid rgba(255,69,69,.25)',fontSize:12,color:'#FF4545',marginBottom:10}}>
                      {payError}
                    </div>
                  )}
                  {net <= 0 ? (
                    <div style={{padding:'12px',borderRadius:10,background:'rgba(255,184,0,.08)',border:'1px solid rgba(255,184,0,.25)',fontSize:12,color:'#FFB800',textAlign:'center'}}>
                      Нет суммы к выплате — период закрыт или всё уже выплачено
                    </div>
                  ) : (
                    <button onClick={confirmPayout} disabled={paySaving || (payMode === 'partial' && payNetPreview <= 0)} className="ab abp" style={{width:'100%',padding:12,opacity:paySaving?0.7:1}}>
                      {paySaving ? 'Обработка…' : `✓ Подтвердить выплату ${payNetPreview.toLocaleString()} ЅМ`}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}
      {showAdd&&(
        <div className="amod">
          <div className="amodbg" onClick={()=>{setShowAdd(false);resetAddForm();}}/>
          <div className="amodbox" style={{maxWidth:560,maxHeight:'92vh',overflowY:'auto'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}><div className="ub" style={{fontSize:14,fontWeight:800}}>Добавить ресторан</div><button onClick={()=>{setShowAdd(false);resetAddForm();}} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:10,fontSize:16}}>✕</button></div>
            <div style={{display:'flex',flexDirection:'column',gap:11}}>
              <div style={{display:'grid',gridTemplateColumns:'66px 1fr',gap:10}}>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:4,fontWeight:700}}>Emoji</div><input className="ai" value={addForm.emoji} onChange={e=>setAddForm(f=>({...f,emoji:e.target.value}))} style={{textAlign:'center',fontSize:22,height:46}}/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:4,fontWeight:700}}>Название *</div><input className="ai" value={addForm.name} onChange={e=>setAddForm(f=>({...f,name:e.target.value}))} placeholder="Название ресторана"/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:4,fontWeight:700}}>Кухня</div><input className="ai" value={addForm.cuisine} onChange={e=>setAddForm(f=>({...f,cuisine:e.target.value}))} placeholder="Таджикская..."/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:4,fontWeight:700}}>Адрес</div><input className="ai" value={addForm.address} onChange={e=>setAddForm(f=>({...f,address:e.target.value}))} placeholder="ул. Ленина, 42"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:4,fontWeight:700}}>Email партнёра *</div><input className="ai" value={addForm.email} onChange={e=>setAddForm(f=>({...f,email:e.target.value}))} placeholder="partner@rest.tj"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:4,fontWeight:700}}>Пароль *</div><input className="ai" type="password" value={addForm.password} onChange={e=>setAddForm(f=>({...f,password:e.target.value}))} placeholder="••••••••"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:4,fontWeight:700}}>Телефон</div><input className="ai" value={addForm.phone} onChange={e=>setAddForm(f=>({...f,phone:e.target.value}))} placeholder="+992 __ ___"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:4,fontWeight:700}}>Комиссия %</div><input className="ai" type="number" value={addForm.commission} onChange={e=>setAddForm(f=>({...f,commission:e.target.value}))} placeholder="15"/></div>
              </div>
              <MapBlock
                lat={addForm.lat} lng={addForm.lng}
                onPick={r=>setAddForm(f=>({...f,lat:r.lat,lng:r.lng,address:r.address||f.address}))}
              />
              {locError&&<div style={{fontSize:11,color:'#FF4545'}}>⚠️ {locError}</div>}
              <div style={{padding:'9px 12px',borderRadius:9,background:'rgba(31,215,96,.05)',border:'1px solid rgba(31,215,96,.18)',fontSize:11,color:'#8FB897'}}>
                📍 Место на карте станет точкой забора для курьера · «Точки забора»
              </div>
              <button onClick={saveAdd} className="ab abp" style={{width:'100%',padding:11}}>✓ Добавить партнёра</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── ОТЗЫВЫ ─────────────────────────────────────── */
function ReviewsPage() {
  const apiRests = useRestaurants(s => s.restaurants);
  const rests = USE_API && apiRests.length ? enrichRestaurants(apiRests, RESTAURANTS) : RESTAURANTS;
  const [reviews, setReviews] = useState(REVIEWS);
  const [loading, setLoading] = useState(false);
  const [replyId, setReplyId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');

  const loadReviews = async () => {
    if (!USE_API) { setReviews(REVIEWS); return; }
    setLoading(true);
    try {
      const list = await api.getReviews();
      setReviews(list.length ? list : REVIEWS);
    } catch {
      setReviews(REVIEWS);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadReviews(); }, []);

  const patchReview = async (id: number, data: Record<string, unknown>) => {
    if (USE_API) {
      try {
        const updated = await api.updateReview(id, data);
        setReviews(rs => rs.map(r => r.id === id ? { ...r, ...updated } : r));
        return;
      } catch { /* fallback local */ }
    }
    setReviews(rs => rs.map(r => r.id === id ? { ...r, ...data } : r));
  };

  const avgRating = reviews.length
    ? (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length).toFixed(1)
    : '—';

  const Stars = ({ n }: { n: number }) => (
    <span>{[1, 2, 3, 4, 5].map(i => <span key={i} style={{ color: i <= n ? '#FFB800' : '#1D3822', fontSize: 13 }}>★</span>)}</span>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button onClick={loadReviews} className="ab" style={{ padding: '6px 12px', fontSize: 11 }} disabled={loading}>
          {loading ? '…' : '↻ Обновить'}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
        <StatCard l="Всего отзывов" v={reviews.length} />
        <StatCard l="Новых" v={reviews.filter(r => r.status === 'new').length} c="#FF4545" />
        <StatCard l="Жалоб (≤2★)" v={reviews.filter(r => r.rating <= 2).length} c="#FF4545" />
        <StatCard l="Средний рейтинг" v={`${avgRating} ★`} c="#FFB800" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {reviews.map((rev, i) => {
          const rest = rests.find(r => r.id === rev.restId);
          return (
            <div key={rev.id} className="ac" style={{ padding: '15px 17px', border: `1.5px solid ${rev.status === 'new' ? 'rgba(255,69,69,.3)' : '#162B1A'}`, animation: `fadeUp .4s ease ${i * .06}s both` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#0F8A3A,#1FD760)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Unbounded', fontSize: 13, fontWeight: 900, color: '#030B05', flexShrink: 0 }}>{rev.client.charAt(0)}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{rev.client}</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Stars n={rev.rating} />
                      <span style={{ fontSize: 10, color: '#3D6645' }}>{rev.date}</span>
                      {rev.orderId && <span style={{ fontSize: 10, color: '#3D6645' }}>· {rev.orderId}</span>}
                </div>
                </div>
              </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 8, background: 'rgba(0,0,0,.3)', border: '1px solid #162B1A' }}>
                    <span style={{ fontSize: 14 }}>{rest?.emoji}</span>
                    <span style={{ fontSize: 11, color: '#8FB897' }}>{rest?.name || rev.restName}</span>
              </div>
                  {rev.status === 'new' && <Badge v="Новый" c="#FF4545" />}
                  {rev.restSeen ? <Badge v="Ресторан видел" c="#1FD760" /> : <Badge v="Не прочитан рест." c="#FFB800" />}
                  {rev.urgent && <Badge v="Срочно" c="#FF4545" />}
                </div>
              </div>
              <div style={{ fontSize: 13, color: '#EBF5ED', lineHeight: 1.6, marginBottom: 10, padding: '9px 12px', background: '#0C1C0F', borderRadius: 9, border: '1px solid #162B1A' }}>
                "{rev.text || 'Без комментария'}"
              </div>
              {rev.adminReply && (
                <div style={{ fontSize: 12, color: '#3B8EF0', marginBottom: 10, padding: '8px 12px', background: 'rgba(59,142,240,.08)', borderRadius: 9, border: '1px solid rgba(59,142,240,.2)' }}>
                  💬 КАКАПО: {rev.adminReply}
                </div>
              )}
              {rev.restReply && (
                <div style={{ fontSize: 12, color: '#1FD760', marginBottom: 10, padding: '8px 12px', background: 'rgba(31,215,96,.08)', borderRadius: 9, border: '1px solid rgba(31,215,96,.2)' }}>
                  🍽 Ресторан: {rev.restReply}
                </div>
              )}
              {replyId === rev.id ? (
                <div style={{ marginBottom: 10 }}>
                  <textarea className="ai" value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="Ответ клиенту от КАКАПО…" rows={2} style={{ marginBottom: 8, resize: 'vertical' }} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { patchReview(rev.id, { adminReply: replyText, status: 'read' }); setReplyId(null); setReplyText(''); }} className="ab abp" style={{ padding: '5px 12px', fontSize: 11 }}>Отправить ответ</button>
                    <button onClick={() => { setReplyId(null); setReplyText(''); }} className="ab" style={{ padding: '5px 12px', fontSize: 11 }}>Отмена</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {rev.status === 'new' && (
                    <button onClick={() => patchReview(rev.id, { status: 'read' })} className="ab abg" style={{ padding: '5px 12px', fontSize: 11 }}>✓ Прочитано</button>
                  )}
                  <button onClick={() => { setReplyId(rev.id); setReplyText(rev.adminReply || ''); }} className="ab" style={{ padding: '5px 12px', fontSize: 11, background: 'rgba(59,142,240,.1)', border: '1.5px solid rgba(59,142,240,.3)', color: '#3B8EF0' }}>💬 Ответить</button>
                  {rev.rating <= 2 && (
                    <button onClick={() => patchReview(rev.id, { urgent: true, restNotified: true, restSeen: false })} className="ab abd" style={{ padding: '5px 12px', fontSize: 11 }}>⚠️ Предупредить ресторан</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── КУРЬЕРЫ ─────────────────────────────────────── */
function CouriersPage() {
  const couriers = useCourierTeam();
  const { addCourier, updateCourier, toggleBlock } = useCourierTeamStore();
  const apiOrders = useOrders(s => s.orders);
  const [editId, setEditId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyCourierForm());
  const [formErr, setFormErr] = useState('');

  const SC: Record<CourierStatus, { l: string; c: string }> = {
    available: { l: 'Свободен', c: '#1FD760' },
    busy: { l: 'В заказе', c: '#FFB800' },
    offline: { l: 'Офлайн', c: '#3D6645' },
  };

  const openAdd = () => {
    setForm(emptyCourierForm());
    setFormErr('');
    setEditId(null);
    setShowAdd(true);
  };

  const openEdit = (c: AdminCourier) => {
    setForm({
      name: c.name,
      phone: c.phone,
      vehicle: c.vehicle,
      num: c.num === '—' ? '' : c.num,
      status: c.status,
      maxActiveOrders: c.maxActiveOrders,
      blocked: c.blocked,
      otp: c.otp || '1234',
    });
    setFormErr('');
    setEditId(c.id);
    setShowAdd(true);
  };

  const closeModal = () => {
    setShowAdd(false);
    setEditId(null);
    setFormErr('');
  };

  const saveCourier = () => {
    const name = form.name.trim();
    const phone = form.phone.trim();
    if (!name || !phone) {
      setFormErr('Укажите ФИО и телефон');
      return;
    }
    const maxActiveOrders = Math.max(1, Math.min(5, Number(form.maxActiveOrders) || 1));
    const payload = {
      ...form,
      name,
      phone,
      num: form.num.trim() || '—',
      maxActiveOrders,
      otp: (form.otp || '1234').trim(),
    };
    if (editId) updateCourier(editId, payload);
    else addCourier(payload);
    closeModal();
  };

  const setF = <K extends keyof typeof form>(key: K, val: (typeof form)[K]) =>
    setForm(prev => ({ ...prev, [key]: val }));

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
        <StatCard l="Всего" v={couriers.length} />
        <StatCard l="Свободных" v={couriers.filter(c => c.status === 'available' && !c.blocked).length} c="#1FD760" />
        <StatCard l="В заказе" v={couriers.filter(c => c.status === 'busy').length} c="#FFB800" />
        <StatCard l="Офлайн" v={couriers.filter(c => c.status === 'offline' || c.blocked).length} c="#3D6645" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button onClick={openAdd} className="ab abp" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>+ Добавить курьера</button>
      </div>
      <div className="ac">
        <table className="at">
          <thead>
            <tr>
              <th>Курьер</th>
              <th>Транспорт</th>
              <th>Статус</th>
              <th>Макс. заказов</th>
              <th>Рейтинг</th>
              <th>Сегодня</th>
              <th>Неделя</th>
              <th>Заказов</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {couriers.map(c => {
              const s = c.blocked ? { l: 'Заблокирован', c: '#FF4545' } : SC[c.status];
              const active = countCourierActiveOrders(apiOrders, c);
              return (
                <tr key={c.id} style={c.blocked ? { opacity: .65 } : undefined}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg,#0F8A3A,#1FD760)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Unbounded', fontSize: 13, fontWeight: 900, color: '#030B05', flexShrink: 0 }}>{c.name.charAt(0)}</div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: '#8FB897' }}>{c.phone}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: '#8FB897' }}>
                    {vehicleIcon(c.vehicle)} {vehicleLabel(c.vehicle)}
                    <div style={{ fontSize: 10, color: '#3D6645' }}>{c.num}</div>
                  </td>
                  <td><Badge v={s.l} c={s.c} /></td>
                  <td>
                    <span className="ub" style={{ fontSize: 12, fontWeight: 800, color: active >= c.maxActiveOrders ? '#FFB800' : '#1FD760' }}>
                      {active}/{c.maxActiveOrders}
                    </span>
                  </td>
                  <td style={{ color: '#FFB800', fontWeight: 700 }}>★ {c.rating}</td>
                  <td><span className="ub" style={{ fontSize: 12, fontWeight: 800, color: '#FFB800' }}>{c.today} ЅМ</span></td>
                  <td><span className="ub" style={{ fontSize: 12 }}>{c.week} ЅМ</span></td>
                  <td style={{ color: '#8FB897' }}>{c.orders}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <a href={`tel:${c.phone.replace(/\s/g, '')}`} className="ab abg" style={{ padding: '4px 9px', fontSize: 11, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>📱</a>
                      <button onClick={() => openEdit(c)} className="ab abg" style={{ padding: '4px 9px', fontSize: 11 }}>✏️</button>
                      <button onClick={() => toggleBlock(c.id)} className={`ab ${c.blocked ? 'abg' : 'abd'}`} style={{ padding: '4px 9px', fontSize: 11 }}>
                        {c.blocked ? 'Разблок' : 'Блок'}
                      </button>
                    </div>
                  </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {showAdd && (
        <div className="amod">
          <div className="amodbg" onClick={closeModal} />
          <div className="amodbox" style={{ maxWidth: 420 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="ub" style={{ fontSize: 14, fontWeight: 800 }}>{editId ? 'Редактировать курьера' : 'Добавить курьера'}</div>
              <button onClick={closeModal} className="ab" style={{ background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', width: 32, height: 32, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, fontSize: 16 }}>✕</button>
              </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <NI lbl="ФИО *" val={form.name} set={v => setF('name', v)} ph="Имя Фамилия" />
              <NI lbl="Телефон *" val={form.phone} set={v => setF('phone', v)} ph="+992 __ ___ __ __" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 4, fontWeight: 700 }}>Транспорт</div>
                  <select className="ai" value={form.vehicle} onChange={e => setF('vehicle', e.target.value as AdminCourier['vehicle'])}>
                    {VEHICLE_OPTIONS.map(v => (
                      <option key={v.id} value={v.id}>{v.icon} {v.label}</option>
                    ))}
                  </select>
            </div>
                <NI lbl="Номер ТС" val={form.num} set={v => setF('num', v)} ph="TJ XXXX XX" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 4, fontWeight: 700 }}>Статус</div>
                  <select className="ai" value={form.status} onChange={e => setF('status', e.target.value as CourierStatus)}>
                    <option value="available">Свободен</option>
                    <option value="busy">В заказе</option>
                    <option value="offline">Офлайн</option>
                  </select>
                </div>
                <NI lbl="Макс. заказов одновременно" val={String(form.maxActiveOrders)} set={v => setF('maxActiveOrders', Math.max(1, Math.min(5, parseInt(v, 10) || 1)))} ph="1–5" type="number" />
              </div>
              <NI lbl="Код входа (OTP)" val={form.otp || ''} set={v => setF('otp', v)} ph="1234" />
              {formErr && <div style={{ fontSize: 12, color: '#FF4545', fontWeight: 700 }}>{formErr}</div>}
              <button onClick={saveCourier} className="ab abp" style={{ width: '100%', padding: 11 }}>
                {editId ? '✓ Сохранить' : '✓ Добавить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── СБОРЩИКИ ───────────────────────────────────── */
function AssemblersPage() {
  const assemblers = useAssemblerTeam();
  const { addAssembler, updateAssembler, toggleBlock } = useAssemblerTeamStore();
  const apiOrders = useOrders(s => s.orders);
  const [editId, setEditId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyAssemblerForm());
  const [formErr, setFormErr] = useState('');

  const SC: Record<AssemblerStatus, { l: string; c: string }> = {
    working: { l: 'Собирает', c: '#9B6DFF' },
    available: { l: 'Свободен', c: '#1FD760' },
    offline: { l: 'Офлайн', c: '#3D6645' },
  };

  const openAdd = () => {
    setForm(emptyAssemblerForm());
    setFormErr('');
    setEditId(null);
    setShowAdd(true);
  };

  const openEdit = (a: AdminAssembler) => {
    setForm({
      name: a.name,
      phone: a.phone,
      status: a.status,
      avgTimeMin: a.avgTimeMin,
      blocked: a.blocked,
      otp: a.otp || '5678',
    });
    setFormErr('');
    setEditId(a.id);
    setShowAdd(true);
  };

  const closeModal = () => {
    setShowAdd(false);
    setEditId(null);
    setFormErr('');
  };

  const saveAssembler = () => {
    const name = form.name.trim();
    const phone = form.phone.trim();
    if (!name || !phone) {
      setFormErr('Укажите ФИО и телефон');
      return;
    }
    const avgTimeMin = Math.max(1, Math.min(60, Number(form.avgTimeMin) || 8));
    const payload = {
      ...form,
      name,
      phone,
      avgTimeMin,
      otp: (form.otp || '5678').trim(),
    };
    if (editId) updateAssembler(editId, payload);
    else addAssembler(payload);
    closeModal();
  };

  const setF = <K extends keyof typeof form>(key: K, val: (typeof form)[K]) =>
    setForm(prev => ({ ...prev, [key]: val }));

  const workingCount = assemblers.filter(a => !a.blocked && (
    a.status === 'working' || countAssemblerActiveOrders(apiOrders, a) > 0
  )).length;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
        <StatCard l="Всего" v={assemblers.length} />
        <StatCard l="Собирают" v={workingCount} c="#9B6DFF" />
        <StatCard l="Свободных" v={assemblers.filter(a => a.status === 'available' && !a.blocked).length} c="#1FD760" />
        <StatCard l="Офлайн" v={assemblers.filter(a => a.status === 'offline' || a.blocked).length} c="#3D6645" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button onClick={openAdd} className="ab abp">+ Добавить сборщика</button>
      </div>
      <div className="ac">
        <table className="at">
          <thead>
            <tr>
              <th>Сборщик</th>
              <th>Статус</th>
              <th>В работе</th>
              <th>Сегодня</th>
              <th>Неделя</th>
              <th>Всего</th>
              <th>Ср. время</th>
              <th>Рейтинг</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {assemblers.map(a => {
              const active = countAssemblerActiveOrders(apiOrders, a);
              const doneLive = countAssemblerCompletedOrders(apiOrders, a);
              const s = a.blocked
                ? { l: 'Заблокирован', c: '#FF4545' }
                : active > 0
                  ? SC.working
                  : SC[a.status];
              const today = Math.max(a.ordersToday, doneLive);
              return (
                <tr key={a.id} style={a.blocked ? { opacity: .65 } : undefined}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg,#6B3FD4,#9B6DFF)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Unbounded', fontSize: 13, fontWeight: 900, color: 'white', flexShrink: 0 }}>{a.name.charAt(0)}</div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{a.name}</div>
                        <div style={{ fontSize: 11, color: '#8FB897' }}>{a.phone}</div>
                      </div>
                    </div>
                  </td>
                  <td><Badge v={s.l} c={s.c} /></td>
                  <td>
                    <span className="ub" style={{ fontSize: 12, fontWeight: 800, color: active ? '#9B6DFF' : '#3D6645' }}>
                      {active}
                    </span>
                  </td>
                  <td><span className="ub" style={{ fontSize: 13, fontWeight: 800, color: '#9B6DFF' }}>{today}</span></td>
                  <td><span className="ub" style={{ fontSize: 12 }}>{a.week}</span></td>
                  <td style={{ color: '#8FB897' }}>{a.ordersTotal}</td>
                  <td style={{ color: '#8FB897' }}>{formatAssemblerAvgTime(a.avgTimeMin)}</td>
                  <td style={{ color: '#FFB800', fontWeight: 700 }}>★ {a.rating}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <a href={`tel:${a.phone.replace(/\s/g, '')}`} className="ab abg" style={{ padding: '4px 9px', fontSize: 11, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>📱</a>
                      <button onClick={() => openEdit(a)} className="ab abg" style={{ padding: '4px 9px', fontSize: 11 }}>✏️</button>
                      <button onClick={() => toggleBlock(a.id)} className={`ab ${a.blocked ? 'abg' : 'abd'}`} style={{ padding: '4px 9px', fontSize: 11 }}>
                        {a.blocked ? 'Разблок' : 'Блок'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {showAdd && (
        <div className="amod">
          <div className="amodbg" onClick={closeModal} />
          <div className="amodbox" style={{ maxWidth: 420 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="ub" style={{ fontSize: 14, fontWeight: 800 }}>{editId ? 'Редактировать сборщика' : 'Добавить сборщика'}</div>
              <button onClick={closeModal} className="ab" style={{ background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', width: 32, height: 32, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, fontSize: 16 }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <NI lbl="ФИО *" val={form.name} set={v => setF('name', v)} ph="Имя Фамилия" />
              <NI lbl="Телефон *" val={form.phone} set={v => setF('phone', v)} ph="+992 __ ___ __ __" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 4, fontWeight: 700 }}>Статус</div>
                  <select className="ai" value={form.status} onChange={e => setF('status', e.target.value as AssemblerStatus)}>
                    <option value="available">Свободен</option>
                    <option value="working">Собирает</option>
                    <option value="offline">Офлайн</option>
                  </select>
                </div>
                <NI lbl="Ср. время (мин)" val={String(form.avgTimeMin)} set={v => setF('avgTimeMin', Math.max(1, parseInt(v, 10) || 8))} ph="8" type="number" />
              </div>
              <NI lbl="PIN код (4 цифры)" val={form.otp || ''} set={v => setF('otp', v)} ph="5678" />
              {formErr && <div style={{ fontSize: 12, color: '#FF4545', fontWeight: 700 }}>{formErr}</div>}
              <button onClick={saveAssembler} className="ab abp" style={{ width: '100%', padding: 11 }}>
                {editId ? '✓ Сохранить' : '✓ Добавить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── КЛИЕНТЫ ────────────────────────────────────── */
function ClientsPage() {
  const stored = useClients();
  const allCards = useCards();
  const { toggleBlock } = useClientStore();
  const apiOrders = useOrders(s => s.orders);
  const [search, setSearch] = useState('');
  const [filterLevel, setFilterLevel] = useState<'all' | ClientLevel>('all');
  const [filterDebt, setFilterDebt] = useState<'all' | 'with' | 'without'>('all');
  const [filterCard, setFilterCard] = useState<'all' | 'with' | 'without'>('all');
  const [filterBlocked, setFilterBlocked] = useState<'all' | 'active' | 'blocked'>('all');
  const [filterSegment, setFilterSegment] = useState<'all' | 'market' | 'restaurant' | 'mixed'>('all');
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<ClientProfileForm>(emptyClientProfileForm());
  const [formErr, setFormErr] = useState('');

  const clients = useMemo(() => mergeClientsWithOrders(stored, apiOrders), [stored, apiOrders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qCompact = q.replace(/\s/g, '');
    const qDigits = q.replace(/\D/g, '');
    return clients.filter(c => {
      if (filterLevel !== 'all' && c.level !== filterLevel) return false;
      if (filterDebt === 'with' && c.debt <= 0) return false;
      if (filterDebt === 'without' && c.debt > 0) return false;
      if (filterCard === 'with' && !c.card) return false;
      if (filterCard === 'without' && c.card) return false;
      if (filterBlocked === 'active' && c.blocked) return false;
      if (filterBlocked === 'blocked' && !c.blocked) return false;
      if (filterSegment !== 'all' && clientSegment(c) !== filterSegment) return false;
      if (q) {
        const hay = `${c.name} ${c.phone} ${c.card} ${c.id} ${c.email || ''}`.toLowerCase();
        const phoneOk = qDigits.length >= 3 && normalizePhone(c.phone).includes(qDigits.slice(-9));
        if (!hay.includes(q) && !hay.replace(/\s/g, '').includes(qCompact) && !phoneOk) return false;
      }
      return true;
    });
  }, [clients, search, filterLevel, filterDebt, filterCard, filterBlocked, filterSegment]);

  const stats = useMemo(() => ({
    total: clients.length,
    withCard: clients.filter(c => !!c.card).length,
    withDebt: clients.filter(c => c.debt > 0).length,
    newMonth: clients.filter(c => isNewThisMonth(c.createdAt)).length,
  }), [clients]);

  const detailClient = detailId ? clients.find(c => c.id === detailId) : null;

  const openAdd = () => {
    setForm(emptyClientProfileForm());
    setFormErr('');
    setEditId(null);
    setShowAdd(true);
  };

  const openEdit = (c: AdminClient) => {
    setForm(clientProfileFromClient(c));
    setFormErr('');
    setEditId(c.id);
    setShowAdd(true);
  };

  const closeModal = () => {
    setShowAdd(false);
    setEditId(null);
    setFormErr('');
  };

  const saveClient = () => {
    const name = form.name.trim();
    const phone = form.phone.trim();
    if (!name || !phone) {
      setFormErr('Укажите имя и телефон');
      return;
    }
    saveClientProfile(editId, form);
    closeModal();
  };

  const setF = <K extends keyof ClientProfileForm>(key: K, val: ClientProfileForm[K]) =>
    setForm(prev => ({ ...prev, [key]: val }));

  const unlinkedCards = useMemo(
    () => allCards.filter(c => c.status === 'unlinked'),
    [allCards],
  );

  const formLoyalty = useMemo(() => {
    if (!form.card) return null;
    const editClient = editId ? stored.find(c => c.id === editId) : undefined;
    const base: AdminClient = editClient || {
      id: '',
      name: form.name,
      phone: form.phone,
      card: form.card,
      level: 'bronze',
      bonus: 0,
      debt: 0,
      debtLimit: 0,
      orders: 0,
      spent: 0,
      blocked: false,
    };
    return loyaltySummaryForClient({ ...base, card: form.card }, allCards);
  }, [form.card, form.name, form.phone, allCards, editId, stored]);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
        <StatCard l="Всего клиентов" v={stats.total.toLocaleString()} />
        <StatCard l="С картами" v={stats.withCard} c="#FFB800" />
        <StatCard l="VIP (долг)" v={stats.withDebt} c="#FF4545" />
        <StatCard l="Новых за месяц" v={stats.newMonth} c="#1FD760" />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 360 }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, opacity: .5 }}>🔍</span>
          <input
            className="ai"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск: имя, телефон, карта, ID…"
            style={{ paddingLeft: 38, paddingRight: search ? 34 : 13 }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#8FB897', cursor: 'pointer', fontSize: 16 }}
            >✕</button>
          )}
        </div>
        {search.trim() && (
          <span style={{ fontSize: 12, color: '#8FB897' }}>
            Найдено: <strong style={{ color: '#1FD760' }}>{filtered.length}</strong>
          </span>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <button onClick={openAdd} className="ab abp">+ Добавить клиента</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {[{ id: 'all', l: 'Все типы' }, { id: 'market', l: '🛒 Магазин' }, { id: 'restaurant', l: '🍽 Рестораны' }, { id: 'mixed', l: '🔀 Смешанные' }].map(f => (
          <button
            key={f.id}
            onClick={() => setFilterSegment(f.id as typeof filterSegment)}
            className="ab"
            style={{
              padding: '5px 12px',
              fontSize: 11,
              background: filterSegment === f.id ? 'rgba(31,215,96,.15)' : '#0C1C0F',
              color: filterSegment === f.id ? '#1FD760' : '#8FB897',
              border: `1px solid ${filterSegment === f.id ? 'rgba(31,215,96,.35)' : '#162B1A'}`,
            }}
          >{f.l}</button>
        ))}
        {[{ id: 'all', l: 'Все уровни' }, ...CLIENT_LEVEL_OPTIONS.map(o => ({ id: o.id, l: o.label }))].map(f => (
          <button
            key={f.id}
            onClick={() => setFilterLevel(f.id as typeof filterLevel)}
            className="ab"
            style={{
              padding: '5px 10px',
              fontSize: 11,
              background: filterLevel === f.id ? `${LVC[f.id as ClientLevel] || '#1FD760'}18` : '#0C1C0F',
              color: filterLevel === f.id ? (LVC[f.id as ClientLevel] || '#1FD760') : '#8FB897',
              border: `1px solid ${filterLevel === f.id ? `${LVC[f.id as ClientLevel] || '#1FD760'}40` : '#162B1A'}`,
            }}
          >{f.l}</button>
        ))}
        {[
          { id: 'all', l: 'Долг: все' },
          { id: 'with', l: 'С долгом' },
          { id: 'without', l: 'Без долга' },
        ].map(f => (
          <button
            key={f.id}
            onClick={() => setFilterDebt(f.id as typeof filterDebt)}
            className="ab"
            style={{
              padding: '5px 10px',
              fontSize: 11,
              background: filterDebt === f.id ? 'rgba(255,69,69,.12)' : '#0C1C0F',
              color: filterDebt === f.id ? '#FF4545' : '#8FB897',
              border: `1px solid ${filterDebt === f.id ? 'rgba(255,69,69,.3)' : '#162B1A'}`,
            }}
          >{f.l}</button>
        ))}
        {[
          { id: 'all', l: 'Карта: все' },
          { id: 'with', l: 'С картой' },
          { id: 'without', l: 'Без карты' },
        ].map(f => (
          <button
            key={f.id}
            onClick={() => setFilterCard(f.id as typeof filterCard)}
            className="ab"
            style={{
              padding: '5px 10px',
              fontSize: 11,
              background: filterCard === f.id ? 'rgba(255,184,0,.12)' : '#0C1C0F',
              color: filterCard === f.id ? '#FFB800' : '#8FB897',
              border: `1px solid ${filterCard === f.id ? 'rgba(255,184,0,.3)' : '#162B1A'}`,
            }}
          >{f.l}</button>
        ))}
        {[
          { id: 'all', l: 'Статус: все' },
          { id: 'active', l: 'Активные' },
          { id: 'blocked', l: 'Заблок.' },
        ].map(f => (
          <button
            key={f.id}
            onClick={() => setFilterBlocked(f.id as typeof filterBlocked)}
            className="ab"
            style={{
              padding: '5px 10px',
              fontSize: 11,
              background: filterBlocked === f.id ? 'rgba(31,215,96,.12)' : '#0C1C0F',
              color: filterBlocked === f.id ? '#1FD760' : '#8FB897',
              border: `1px solid ${filterBlocked === f.id ? 'rgba(31,215,96,.3)' : '#162B1A'}`,
            }}
          >{f.l}</button>
        ))}
      </div>

      <div className="ac">
        <table className="at">
          <thead>
            <tr>
              <th>Клиент</th>
              <th>Тип</th>
              <th>Карта</th>
              <th>Уровень</th>
              <th>Заказов</th>
              <th>Потрачено</th>
              <th>Долг</th>
              <th>Бонусы</th>
              <th>Последний</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', color: '#3D6645', padding: 28 }}>
                  {search.trim() ? `Клиент «${search.trim()}» не найден` : 'Нет клиентов по выбранным фильтрам'}
                </td>
              </tr>
            ) : filtered.map(c => {
              const seg = clientSegment(c);
              return (
                <tr key={c.id} style={c.blocked ? { opacity: .65 } : undefined}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: c.blocked ? 'linear-gradient(135deg,#662222,#FF4545)' : 'linear-gradient(135deg,#0F8A3A,#1FD760)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Unbounded', fontSize: 12, fontWeight: 900, color: '#030B05', flexShrink: 0 }}>{c.name.charAt(0)}</div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{c.name}{c.blocked && <span style={{ marginLeft: 6, fontSize: 10, color: '#FF4545' }}>🚫</span>}</div>
                        <div style={{ fontSize: 11, color: '#8FB897' }}>{c.phone}</div>
                      </div>
                    </div>
                  </td>
                  <td><span style={{ fontSize: 11, color: '#8FB897' }}>{clientSegmentLabel(seg)}</span></td>
                  <td>{c.card ? <span className="ub" style={{ fontSize: 11, fontWeight: 800, color: '#FFB800' }}>{c.card}</span> : <span style={{ color: '#3D6645' }}>—</span>}</td>
                  <td><Badge v={c.level} c={LVC[c.level] || '#8FB897'} /></td>
                  <td style={{ fontWeight: 600 }}>{c.orders}</td>
                  <td><span className="ub" style={{ fontSize: 12, fontWeight: 700 }}>{c.spent.toLocaleString()} ЅМ</span></td>
                  <td style={{ color: c.debt > 0 ? '#FF4545' : '#3D6645', fontWeight: c.debt > 0 ? 800 : 400 }}>{c.debt > 0 ? `${c.debt.toLocaleString()} ЅМ` : '—'}</td>
                  <td style={{ color: '#FFB800', fontWeight: 600 }}>{c.bonus.toLocaleString()} ⭐</td>
                  <td style={{ fontSize: 11, color: '#3D6645' }}>{c.lastLabel}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <a href={`tel:${c.phone.replace(/\s/g, '')}`} className="ab abg" style={{ padding: '4px 9px', fontSize: 11, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>📱</a>
                      <button onClick={() => setDetailId(c.id)} className="ab abg" style={{ padding: '4px 9px', fontSize: 11 }}>👁</button>
                      <button onClick={() => openEdit(c)} className="ab abg" style={{ padding: '4px 9px', fontSize: 11 }}>✏️</button>
                      <button onClick={() => toggleBlock(c.id)} className={`ab ${c.blocked ? 'abg' : 'abd'}`} style={{ padding: '4px 9px', fontSize: 11 }}>
                        {c.blocked ? 'Разблок' : 'Блок'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <div className="amod">
          <div className="amodbg" onClick={closeModal} />
          <div className="amodbox" style={{ maxWidth: 480 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="ub" style={{ fontSize: 14, fontWeight: 800 }}>{editId ? 'Редактировать клиента' : 'Добавить клиента'}</div>
              <button onClick={closeModal} className="ab" style={{ background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', width: 32, height: 32, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, fontSize: 16 }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div style={{ fontSize: 10, color: '#3D6645', fontWeight: 700, letterSpacing: .3 }}>ПРОФИЛЬ КЛИЕНТА</div>
              <NI lbl="ФИО *" val={form.name} set={v => setF('name', v)} ph="Имя Фамилия" />
              <NI lbl="Телефон *" val={form.phone} set={v => setF('phone', v)} ph="+992 __ ___ __ __" />
              <NI lbl="Email" val={form.email || ''} set={v => setF('email', v)} ph="email@example.com" />
              <NI lbl="Адрес" val={form.addr || ''} set={v => setF('addr', v)} ph="ул. Ленина, 42" />
              <div>
                <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 4, fontWeight: 700 }}>Карта КАКАПО</div>
                <select className="ai" value={form.card} onChange={e => setF('card', e.target.value)}>
                  <option value="">— Без карты —</option>
                  {form.card && !unlinkedCards.some(c => c.num === form.card) && (
                    <option value={form.card}>{form.card} (текущая)</option>
                  )}
                  {unlinkedCards.map(c => (
                    <option key={c.num} value={c.num}>{c.num}</option>
                  ))}
                </select>
                <div style={{ fontSize: 10, color: '#3D6645', marginTop: 4 }}>Привязка карты · уровень и бонусы — в разделе «Карты»</div>
              </div>
              {formLoyalty?.card && (
                <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,184,0,.06)', border: '1px solid rgba(255,184,0,.2)' }}>
                  <div style={{ fontSize: 10, color: '#FFB800', fontWeight: 800, marginBottom: 8 }}>💳 ДАННЫЕ КАРТЫ (только просмотр)</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                    <div><span style={{ color: '#3D6645' }}>Уровень:</span> <strong>{formLoyalty.level || '—'}</strong></div>
                    <div><span style={{ color: '#3D6645' }}>Бонусы:</span> <strong style={{ color: '#FFB800' }}>{formLoyalty.bonus.toLocaleString()} ⭐</strong></div>
                    <div><span style={{ color: '#3D6645' }}>Лимит:</span> <strong>{formLoyalty.debtLimit > 0 ? `${formLoyalty.debtLimit} ЅМ` : 'Нет'}</strong></div>
                    <div><span style={{ color: '#3D6645' }}>Долг:</span> <strong style={{ color: formLoyalty.debt > 0 ? '#FF4545' : '#8FB897' }}>{formLoyalty.debt > 0 ? `${formLoyalty.debt} ЅМ` : '—'}</strong></div>
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderRadius: 10, background: '#0C1C0F', border: '1px solid #162B1A' }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>Заблокирован</div>
                <Tog on={form.blocked} set={() => setF('blocked', !form.blocked)} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 4, fontWeight: 700 }}>Заметка администратора</div>
                <textarea className="ai" value={form.note || ''} onChange={e => setF('note', e.target.value)} placeholder="Комментарий по клиенту" rows={2} style={{ resize: 'vertical' }} />
              </div>
              {formErr && <div style={{ fontSize: 12, color: '#FF4545', fontWeight: 700 }}>{formErr}</div>}
              <button onClick={saveClient} className="ab abp" style={{ width: '100%', padding: 11 }}>
                {editId ? '✓ Сохранить профиль' : '✓ Добавить клиента'}
              </button>
            </div>
          </div>
        </div>
      )}

      {detailClient && (
        <div className="amod">
          <div className="amodbg" onClick={() => setDetailId(null)} />
          <div className="amodbox" style={{ maxWidth: 520 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="ub" style={{ fontSize: 14, fontWeight: 800 }}>{detailClient.name}</div>
              <button onClick={() => setDetailId(null)} className="ab" style={{ background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', width: 32, height: 32, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, fontSize: 16 }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              {[
                { l: 'ID', v: detailClient.id },
                { l: 'Телефон', v: detailClient.phone },
                { l: 'Email', v: detailClient.email || '—' },
                { l: 'Адрес', v: detailClient.addr || '—' },
                { l: 'Карта', v: detailClient.card || '—' },
                { l: 'Уровень', v: detailClient.level },
                { l: 'Тип клиента', v: clientSegmentLabel(clientSegment(detailClient)) },
                { l: 'Статус', v: detailClient.blocked ? '🚫 Заблокирован' : '✓ Активен' },
                { l: 'Регистрация', v: detailClient.createdAt || '—' },
                { l: 'Последний заказ', v: detailClient.lastLabel },
              ].map(row => (
                <div key={row.l} style={{ padding: '8px 10px', borderRadius: 10, background: '#0C1C0F', border: '1px solid #162B1A' }}>
                  <div style={{ fontSize: 10, color: '#3D6645', fontWeight: 700, marginBottom: 3 }}>{row.l}</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{row.v}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 14 }}>
              <StatCard l="Заказов" v={detailClient.orders} />
              <StatCard l="Потрачено" v={`${detailClient.spent.toLocaleString()} ЅМ`} c="#1FD760" />
              <StatCard l="Долг" v={detailClient.debt > 0 ? `${detailClient.debt.toLocaleString()} ЅМ` : '—'} c={detailClient.debt > 0 ? '#FF4545' : undefined} />
              <StatCard l="Бонусы" v={`${detailClient.bonus.toLocaleString()} ⭐`} c="#FFB800" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
              <StatCard l="🛒 Магазин" v={detailClient.marketOrders} />
              <StatCard l="🍽 Рестораны" v={detailClient.restaurantOrders} />
              <StatCard l="🔀 Смешанные" v={detailClient.mixedOrders} />
            </div>
            {detailClient.note && (
              <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,184,0,.06)', border: '1px solid rgba(255,184,0,.2)', fontSize: 12, color: '#8FB897', marginBottom: 12 }}>
                <strong style={{ color: '#FFB800' }}>Заметка:</strong> {detailClient.note}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setDetailId(null); openEdit(detailClient); }} className="ab abg" style={{ flex: 1 }}>✏️ Редактировать</button>
              <a href={`tel:${detailClient.phone.replace(/\s/g, '')}`} className="ab abp" style={{ flex: 1, textDecoration: 'none', textAlign: 'center' }}>📱 Позвонить</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── КАРТЫ — UI helpers ─────────────────────────── */
const CARD_LEVEL_RU: Record<ClientLevel, string> = { basic: 'Обычный', bronze: 'Бронза', silver: 'Серебро', gold: 'Золото', platinum: 'Платина' };

function CardVisualMini({ num, level, clientName, status }: { num?: string; level?: string; clientName?: string; status?: CardStatus }) {
  const lc = level && LVC[level as ClientLevel] ? LVC[level as ClientLevel] : '#FFB800';
  return (
    <div style={{
      background: 'linear-gradient(145deg,#06180C,#0D2818,#071A0A)',
      border: `1.5px solid ${status === 'unlinked' ? 'rgba(255,184,0,.4)' : 'rgba(31,215,96,.4)'}`,
      borderRadius: 16,
      padding: '20px 22px',
      position: 'relative',
      overflow: 'hidden',
      boxShadow: '0 8px 32px rgba(0,0,0,.35)',
    }}>
      <div style={{ position: 'absolute', top: -30, right: -30, width: 100, height: 100, borderRadius: '50%', background: `${lc}15` }} />
      <div className="ub" style={{ fontSize: 9, color: '#1FD760', letterSpacing: 2.5, marginBottom: 12, opacity: .9 }}>КАКАПО LOYALTY CARD</div>
      <div className="ub" style={{ fontSize: num ? 20 : 15, fontWeight: 900, color: '#FFB800', letterSpacing: 2, marginBottom: 10 }}>
        {num || 'Новая карта'}
      </div>
      {clientName ? (
        <div style={{ fontSize: 14, fontWeight: 700, color: '#EBF5ED', marginBottom: 8 }}>{clientName}</div>
      ) : status === 'unlinked' ? (
        <div style={{ fontSize: 12, color: '#FFB800', opacity: .9 }}>⏳ Свободна — выберите клиента</div>
      ) : null}
      {level && <Badge v={CARD_LEVEL_RU[level as ClientLevel] || level} c={lc} />}
    </div>
  );
}

function CardLevelPicker({ value, onChange }: { value: ClientLevel; onChange: (v: ClientLevel) => void }) {
  const cfg = loadLoyaltyStatusConfig();
  const options = loyaltyTierOptions(cfg);
  const colorOf = (id: ClientLevel) => {
    if (id === 'basic') return cfg.basic.color;
    const t = cfg.tiers.find(x => x.id === id);
    return t?.color || LVC[id] || '#8FB897';
  };
  const emojiOf = (id: ClientLevel) => {
    if (id === 'basic') return cfg.basic.emoji;
    const t = cfg.tiers.find(x => x.id === id);
    return t?.emoji || '⭐';
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8 }}>
      {options.map(o => {
        const c = colorOf(o.id);
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className="ab"
            style={{
              padding: '12px 4px',
              fontSize: 10,
              fontWeight: 800,
              color: c,
              background: value === o.id ? `${c}28` : '#0C1C0F',
              border: `2px solid ${value === o.id ? c : '#1D3822'}`,
              borderRadius: 12,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 5,
              transform: value === o.id ? 'scale(1.02)' : 'none',
            }}
          >
            <span style={{ fontSize: 18 }}>{emojiOf(o.id)}</span>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function CardFormSection({ title, subtitle, children }: { title: string; subtitle?: string; children: any }) {
  return (
    <div style={{ background: '#0A140C', border: '1px solid #162B1A', borderRadius: 14, padding: '14px 16px' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: '#1FD760', marginBottom: subtitle ? 4 : 10 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 11, color: '#3D6645', marginBottom: 12, lineHeight: 1.45 }}>{subtitle}</div>}
      {children}
    </div>
  );
}

function filterClientsByQuery(clients: AdminClient[], query: string): AdminClient[] {
  const q = query.trim().toLowerCase();
  if (!q) return clients;
  const qCompact = q.replace(/\s/g, '');
  const qDigits = q.replace(/\D/g, '');
  return clients.filter(c => {
    const hay = `${c.name} ${c.phone} ${c.card} ${c.id} ${c.email || ''}`.toLowerCase();
    const phoneOk = qDigits.length >= 3 && normalizePhone(c.phone).includes(qDigits.slice(-9));
    return hay.includes(q) || hay.replace(/\s/g, '').includes(qCompact) || phoneOk;
  });
}

function ClientSearchPicker({
  clients,
  selectedId,
  onSelect,
  onClear,
  autoFocus,
}: {
  clients: AdminClient[];
  selectedId: string;
  onSelect: (clientId: string) => void;
  onClear: () => void;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => filterClientsByQuery(clients, q), [clients, q]);
  const selected = selectedId ? clients.find(c => c.id === selectedId) : null;
  const qTrim = q.trim();
  const showList = qTrim.length > 0;
  const visible = filtered.slice(0, 40);
  const hiddenCount = Math.max(0, filtered.length - visible.length);

  return (
    <div>
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, opacity: .55, pointerEvents: 'none' }}>🔍</span>
        <input
          className="ai"
          autoFocus={autoFocus}
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Имя, телефон, КАКАПО-0001…"
          style={{ paddingLeft: 38, paddingRight: q ? 34 : 13 }}
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ('')}
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#8FB897', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
          >
            ✕
          </button>
        )}
      </div>

      <div style={{ fontSize: 10, color: '#3D6645', marginBottom: 8, fontWeight: 700 }}>
        {qTrim
          ? `Найдено: ${filtered.length}`
          : selected
            ? 'Клиент выбран — нажмите «Сменить» чтобы выбрать другого'
            : `В базе ${clients.length} клиентов — введите имя, телефон или КАКАПО-0001`}
      </div>

      {selected && !q.trim() && (
        <div style={{ padding: '11px 13px', borderRadius: 12, background: 'rgba(31,215,96,.08)', border: '1px solid rgba(31,215,96,.25)', marginBottom: showList ? 10 : 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: '#1FD760', fontWeight: 800, fontSize: 13 }}>✓ {selected.name}</div>
              <div style={{ color: '#8FB897', fontSize: 12, marginTop: 3 }}>{selected.phone}</div>
              {selected.card && (
                <div style={{ color: '#FFB800', fontSize: 11, marginTop: 5 }}>Карта: {selected.card}</div>
              )}
            </div>
            <button
              type="button"
              onClick={() => { onClear(); setQ(''); }}
              className="ab"
              style={{ flexShrink: 0, padding: '5px 10px', fontSize: 10, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897' }}
            >
              Сменить
            </button>
          </div>
        </div>
      )}

      {showList && (
        <div style={{
          maxHeight: 220,
          overflowY: 'auto',
          borderRadius: 12,
          border: '1px solid #162B1A',
          background: '#060E08',
        }}>
          {visible.length === 0 ? (
            <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 12, color: '#3D6645' }}>
              {qTrim ? 'Никого не нашли — попробуйте другой телефон или имя' : 'Клиентов нет'}
            </div>
          ) : visible.map(c => {
            const active = c.id === selectedId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => { onSelect(c.id); setQ(''); }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 13px',
                  border: 'none',
                  borderBottom: '1px solid #162B1A',
                  background: active ? 'rgba(31,215,96,.12)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'background .12s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: active ? '#1FD760' : '#EBF5ED', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.name}
                    </div>
                    <div style={{ fontSize: 11, color: '#8FB897', marginTop: 2 }}>{c.phone}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                    {c.card
                      ? <span style={{ fontSize: 10, color: '#FFB800', fontWeight: 700 }}>{c.card}</span>
                      : <span style={{ fontSize: 10, color: '#3D6645' }}>без карты</span>}
                    {active && <span style={{ fontSize: 10, color: '#1FD760', fontWeight: 800 }}>✓</span>}
                  </div>
                </div>
              </button>
            );
          })}
          {hiddenCount > 0 && (
            <div style={{ padding: '8px 13px', fontSize: 10, color: '#3D6645', textAlign: 'center', borderTop: '1px solid #162B1A' }}>
              Ещё {hiddenCount} — уточните поиск
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── КАРТЫ ──────────────────────────────────────── */
function CardsPage({ setPage }: { setPage: (p: string) => void }) {
  const stored = useCards();
  const clients = useClients();
  const { generateCards, unlinkCard, toggleBlock } = useCardStore();
  const [cardsTab, setCardsTab] = useState<'registry' | 'status'>('registry');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | CardStatus>('all');
  const [detail, setDetail] = useState<AdminCard | null>(null);
  const [showGen, setShowGen] = useState(false);
  const [showCreateLink, setShowCreateLink] = useState(false);
  const [showLink, setShowLink] = useState<AdminCard | null>(null);
  const [genN, setGenN] = useState('1');
  const [gened, setGened] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [genErr, setGenErr] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [genCreated, setGenCreated] = useState<AdminCard[]>([]);
  const [linkForm, setLinkForm] = useState<CardLoyaltyForm>(emptyCardLoyaltyForm());
  const [linkErr, setLinkErr] = useState('');

  const cards = useMemo(() => mergeCardsWithClients(stored, clients), [stored, clients]);

  const clientsForLink = useMemo(
    () => clients.filter(c => !c.blocked),
    [clients],
  );

  const linkClient = useMemo(() => {
    if (linkForm.clientId) return clients.find(c => c.id === linkForm.clientId);
    return lookupClientByPhone(linkForm.phone, clients);
  }, [linkForm.clientId, linkForm.phone, clients]);

  const pickClient = (clientId: string) => {
    const c = clients.find(x => x.id === clientId);
    if (!c) {
      setLinkForm(prev => ({ ...prev, clientId: '', phone: '' }));
      return;
    }
    setLinkForm(prev => ({
      ...prev,
      clientId: c.id,
      phone: c.phone,
      level: c.level || prev.level,
      debtLimit: c.debtLimit ?? prev.debtLimit,
      bonus: c.bonus ?? prev.bonus,
      debt: c.debt ?? prev.debt,
      vip: !!c.vip,
    }));
  };

  const filtered = useMemo(() => cards.filter(c =>
    cardMatchesSearch(c, search) && (filter === 'all' || c.status === filter),
  ), [cards, search, filter]);

  const stats = useMemo(() => ({
    total: cards.length,
    active: cards.filter(c => c.status === 'active').length,
    unlinked: cards.filter(c => c.status === 'unlinked').length,
    blocked: cards.filter(c => c.status === 'blocked').length,
  }), [cards]);

  const genPreview = useMemo(() => previewCardRange(cards, Math.max(1, parseInt(genN, 10) || 1)), [cards, genN]);

  const openLink = (card: AdminCard) => {
    const client = findClientForCard(clients, card);
    setLinkForm(cardLoyaltyFromCard(card, client));
    setLinkErr('');
    setShowLink(card);
  };

  const saveLink = () => {
    if (!showLink) return;
    try {
      const form = {
        ...linkForm,
        debt: showLink.status === 'unlinked' ? 0 : Math.max(0, Number(showLink.debt) || 0),
      };
      saveCardLoyalty(showLink, form, showLink.status === 'unlinked' ? 'link' : 'edit');
      setShowLink(null);
    } catch (e) {
      setLinkErr(e instanceof Error ? e.message : 'Ошибка сохранения');
    }
  };

  const saveCreateLink = async () => {
    setCreateLoading(true);
    setLinkErr('');
    try {
      if (!linkForm.clientId && !linkForm.phone.trim()) {
        throw new Error('Выберите клиента из списка');
      }
      await createAndLinkCard({ ...linkForm, debt: 0 });
      setShowCreateLink(false);
      setLinkForm(emptyCardLoyaltyForm());
      setFilter('active');
    } catch (e) {
      setLinkErr(e instanceof Error ? e.message : 'Ошибка создания карты');
    } finally {
      setCreateLoading(false);
    }
  };

  const doGenerate = async () => {
    const n = Math.min(500, Math.max(1, parseInt(genN, 10) || 1));
    setGenLoading(true);
    setGenErr('');
    try {
      const created = await generateCards(n);
      if (!created.length) throw new Error('Карты не созданы. Проверьте backend или перезагрузите страницу.');
      setGenCreated(created);
      setGened(true);
      setFilter('unlinked');
    } catch (e) {
      setGenErr(e instanceof Error ? e.message : 'Ошибка генерации');
    } finally {
      setGenLoading(false);
    }
  };

  const downloadCsv = () => {
    const list = genCreated.length ? genCreated : cards.filter(c => c.status === 'unlinked');
    const rows = [['num', 'status', 'issued'], ...list.map(c => [c.num, c.status, c.issued || ''])];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kakapo-cards-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const setLF = <K extends keyof CardLoyaltyForm>(key: K, val: CardLoyaltyForm[K]) =>
    setLinkForm(prev => ({ ...prev, [key]: val }));

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { id: 'registry' as const, l: '💳 Картотека', d: 'Выдача и привязка карт' },
          { id: 'status' as const, l: '🏅 Статусы', d: 'Уровни, VIP, оформление' },
        ].map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setCardsTab(t.id)}
            className="ab"
            style={{
              flex: '1 1 200px',
              padding: '14px 18px',
              textAlign: 'left',
              borderRadius: 14,
              border: cardsTab === t.id ? '2px solid #1FD76055' : '1px solid #162B1A',
              background: cardsTab === t.id ? 'rgba(31,215,96,.08)' : '#0C1C0F',
            }}
          >
            <div className="ub" style={{ fontSize: 14, fontWeight: 900, color: cardsTab === t.id ? '#1FD760' : '#EBF5ED', marginBottom: 4 }}>{t.l}</div>
            <div style={{ fontSize: 11, color: '#8FB897' }}>{t.d}</div>
          </button>
        ))}
      </div>

      {cardsTab === 'status' && <CardStatusAdminPanel />}

      {cardsTab === 'registry' && <>
      {/* Статистика — клик фильтрует список */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { id: 'all', l: 'Всего карт', v: stats.total, c: '#EBF5ED', e: '💳' },
          { id: 'active', l: 'Активные', v: stats.active, c: '#1FD760', e: '✅' },
          { id: 'unlinked', l: 'Без клиента', v: stats.unlinked, c: '#FFB800', e: '🔗' },
          { id: 'blocked', l: 'Заблокированы', v: stats.blocked, c: '#FF4545', e: '🚫' },
        ].map(s => (
          <button
            key={s.id}
            type="button"
            onClick={() => setFilter(s.id as typeof filter)}
            className="ac"
            style={{
              padding: '14px 16px',
              textAlign: 'left',
              cursor: 'pointer',
              border: filter === s.id ? `2px solid ${s.c}55` : '1px solid #162B1A',
              background: filter === s.id ? `${s.c}0D` : undefined,
              transition: 'all .15s',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: '#8FB897', fontWeight: 600 }}>{s.l}</span>
              <span style={{ fontSize: 18 }}>{s.e}</span>
            </div>
            <div className="ub" style={{ fontSize: 24, fontWeight: 900, color: s.c }}>{s.v}</div>
          </button>
        ))}
      </div>

      {/* Главные действия */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => { setShowCreateLink(true); setLinkForm(emptyCardLoyaltyForm()); setLinkErr(''); }}
          style={{
            background: 'linear-gradient(135deg,#0F8A3A,#1FD760)',
            border: 'none',
            borderRadius: 16,
            padding: '20px 22px',
            textAlign: 'left',
            cursor: 'pointer',
            color: '#030B05',
            boxShadow: '0 4px 24px rgba(31,215,96,.25)',
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 8 }}>🎴</div>
          <div className="ub" style={{ fontSize: 15, fontWeight: 900, marginBottom: 6 }}>Выдать карту клиенту</div>
          <div style={{ fontSize: 12, opacity: .85, lineHeight: 1.5, fontWeight: 600 }}>
            Создаётся новая КАКАПО-карта и сразу привязывается к выбранному клиенту
          </div>
        </button>
        <button
          type="button"
          onClick={() => { setShowGen(true); setGened(false); setGenCreated([]); setGenErr(''); }}
          style={{
            background: '#0C1C0F',
            border: '1.5px solid #162B1A',
            borderRadius: 16,
            padding: '20px 22px',
            textAlign: 'left',
            cursor: 'pointer',
            color: '#EBF5ED',
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 8 }}>📦</div>
          <div className="ub" style={{ fontSize: 14, fontWeight: 800, marginBottom: 6, color: '#FFB800' }}>Пустые карты (пачка)</div>
          <div style={{ fontSize: 12, color: '#8FB897', lineHeight: 1.5 }}>
            Сгенерировать карты без клиента — привязку сделаете позже кнопкой «Привязать»
          </div>
        </button>
      </div>

      {/* Подсказка */}
      <div style={{
        display: 'flex',
        gap: 16,
        padding: '14px 18px',
        marginBottom: 16,
        borderRadius: 14,
        background: 'rgba(59,142,240,.06)',
        border: '1px solid rgba(59,142,240,.18)',
        flexWrap: 'wrap',
      }}>
        {[
          { n: '1', t: 'Выберите клиента', d: 'Из списка или по телефону' },
          { n: '2', t: 'Бонусы', d: 'Уровень и VIP — во вкладке «Статусы»' },
          { n: '3', t: 'Готово!', d: 'Карта работает в приложении' },
        ].map((step, i) => (
          <div key={step.n} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: '1 1 160px' }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%', background: '#3B8EF0', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 900, flexShrink: 0,
            }}>{step.n}</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#EBF5ED' }}>{step.t}</div>
              <div style={{ fontSize: 11, color: '#8FB897' }}>{step.d}</div>
            </div>
            {i < 2 && <div style={{ display: 'none' }} />}
          </div>
        ))}
      </div>

      {/* Поиск и фильтры */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 360 }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, opacity: .5 }}>🔍</span>
          <input
            className="ai"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск: КАКАПО-0001, имя, телефон…"
            style={{ paddingLeft: 38, paddingRight: search ? 34 : 13 }}
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#8FB897', cursor: 'pointer', fontSize: 16 }}>✕</button>
          )}
        </div>
        {search.trim() && (
          <span style={{ fontSize: 12, color: '#8FB897' }}>
            Найдено: <strong style={{ color: '#1FD760' }}>{filtered.length}</strong>
          </span>
        )}
      </div>

      {/* Таблица */}
      <div className="ac">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #162B1A', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#8FB897' }}>
            Список карт {filter !== 'all' && `· ${CARD_STATUS_LABELS[filter as CardStatus]?.l || filter}`}
          </span>
          <span style={{ fontSize: 11, color: '#3D6645' }}>{filtered.length} шт.</span>
        </div>
        <table className="at">
          <thead>
            <tr>
              <th>Карта</th>
              <th>Клиент</th>
              <th>Статус</th>
              <th>Уровень</th>
              <th>Бонусы</th>
              <th>Долг</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 32 }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>💳</div>
                  <div style={{ color: '#8FB897', fontWeight: 700, marginBottom: 4 }}>
                    {search.trim() ? 'Ничего не найдено' : 'Карт пока нет'}
                  </div>
                  <div style={{ fontSize: 12, color: '#3D6645' }}>
                    Нажмите «Выдать карту клиенту» чтобы начать
                  </div>
                </td>
              </tr>
            ) : filtered.map(c => {
              const s = CARD_STATUS_LABELS[c.status];
              const overLimit = c.debtLimit > 0 && c.debt > c.debtLimit;
              const isUnlinked = c.status === 'unlinked';
              return (
                <tr
                  key={c.num}
                  style={{
                    opacity: c.status === 'blocked' ? .6 : 1,
                    background: isUnlinked ? 'rgba(255,184,0,.04)' : undefined,
                  }}
                >
                  <td>
                    <div className="ub" style={{ fontSize: 12, fontWeight: 800, color: '#FFB800', letterSpacing: .5 }}>{c.num}</div>
                    <div style={{ fontSize: 10, color: '#3D6645', marginTop: 2 }}>{c.phone || '—'}</div>
                  </td>
                  <td style={{ fontWeight: 600, maxWidth: 140 }}>
                    {c.client || <span style={{ color: '#FFB800', fontSize: 12 }}>👤 Не привязана</span>}
                  </td>
                  <td><Badge v={s.l} c={s.c} /></td>
                  <td>
                    {c.level
                      ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Badge v={CARD_LEVEL_RU[c.level as ClientLevel] || c.level} c={LVC[c.level] || '#8FB897'} />
                          {c.vip && <Badge v="VIP" c="#FFB800" />}
                        </div>
                      )
                      : <span style={{ color: '#3D6645' }}>—</span>}
                  </td>
                  <td style={{ color: '#FFB800', fontWeight: 700, fontSize: 12 }}>
                    {c.bonus > 0 ? `${c.bonus.toLocaleString()} ⭐` : '—'}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {c.debt > 0 ? (
                      <span style={{ color: overLimit ? '#FF4545' : '#FF8C8C', fontWeight: 700 }}>
                        {c.debt.toLocaleString()} ЅМ{overLimit ? ' ⚠' : ''}
                      </span>
                    ) : <span style={{ color: '#3D6645' }}>—</span>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {isUnlinked ? (
                        <button type="button" onClick={() => openLink(c)} className="ab abp" style={{ padding: '6px 12px', fontSize: 11, fontWeight: 800 }}>
                          🔗 Привязать
                        </button>
                      ) : (
                        <>
                          <button type="button" onClick={() => openLink(c)} className="ab abg" style={{ padding: '5px 10px', fontSize: 11 }} title="Настройки">⚙️</button>
                          <button type="button" onClick={() => setDetail(c)} className="ab abg" style={{ padding: '5px 10px', fontSize: 11 }} title="Подробнее">👁</button>
                          {c.status !== 'blocked' ? (
                            <button type="button" onClick={() => toggleBlock(c.num)} className="ab abd" style={{ padding: '5px 10px', fontSize: 11 }} title="Блок">🚫</button>
                          ) : (
                            <button type="button" onClick={() => toggleBlock(c.num)} className="ab abg" style={{ padding: '5px 10px', fontSize: 11 }} title="Разблок">✓</button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="amod">
          <div className="amodbg" onClick={() => setDetail(null)} />
          <div className="amodbox" style={{ maxWidth: 480 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="ub" style={{ fontSize: 15, fontWeight: 800 }}>Карточка клиента</div>
              <button type="button" onClick={() => setDetail(null)} className="ab" style={{ background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', width: 32, height: 32, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, fontSize: 16 }}>✕</button>
            </div>
            <CardVisualMini num={detail.num} level={detail.level} clientName={detail.client || undefined} status={detail.status} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '16px 0' }}>
              {[
                { l: 'Статус', v: CARD_STATUS_LABELS[detail.status].l, c: CARD_STATUS_LABELS[detail.status].c },
                { l: 'Телефон', v: detail.phone || '—', c: '#8FB897' },
                { l: 'Бонусы', v: `${detail.bonus.toLocaleString()} ⭐`, c: '#FFB800' },
                { l: 'Лимит долга', v: detail.debtLimit > 0 ? `${detail.debtLimit} ЅМ` : 'Нет', c: '#1FD760' },
                { l: 'Долг', v: detail.debt > 0 ? `${detail.debt} ЅМ` : '—', c: detail.debt > 0 ? '#FF4545' : '#3D6645' },
                { l: 'VIP', v: detail.vip ? '👑 Включён' : 'Выключен', c: detail.vip ? '#FFB800' : '#3D6645' },
                { l: 'Выдана', v: detail.issued || '—', c: '#8FB897' },
              ].map(row => (
                <div key={row.l} style={{ background: '#0C1C0F', borderRadius: 12, padding: '11px 13px', border: '1px solid #162B1A' }}>
                  <div style={{ fontSize: 10, color: '#3D6645', fontWeight: 700, marginBottom: 4 }}>{row.l}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: row.c }}>{row.v}</div>
                </div>
              ))}
            </div>
            {clientNoteForCard(detail, clients) && (
              <div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(59,142,240,.08)', border: '1px solid rgba(59,142,240,.2)', fontSize: 12, color: '#8FB897', marginBottom: 14 }}>
                💬 {clientNoteForCard(detail, clients)}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => { setDetail(null); openLink(detail); }} className="ab abg" style={{ flex: 1, padding: 11 }}>⚙️ Настроить</button>
              {detail.status !== 'unlinked' && (
                <button type="button" onClick={() => { unlinkCard(detail.num); setDetail(null); }} className="ab abd" style={{ flex: 1, padding: 11 }}>🔓 Отвязать</button>
              )}
            </div>
          </div>
        </div>
      )}

      {showCreateLink && (
        <div className="amod">
          <div className="amodbg" onClick={() => !createLoading && setShowCreateLink(false)} />
          <div className="amodbox" style={{ maxWidth: 460 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <div className="ub" style={{ fontSize: 16, fontWeight: 900 }}>🎴 Выдать карту</div>
                <div style={{ fontSize: 11, color: '#8FB897', marginTop: 3 }}>Новая карта + привязка к клиенту</div>
              </div>
              <button type="button" onClick={() => setShowCreateLink(false)} className="ab" style={{ background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', width: 32, height: 32, padding: 0, borderRadius: 10, fontSize: 16 }}>✕</button>
            </div>

            <CardVisualMini
              level={linkForm.level}
              clientName={linkClient?.name}
              status="unlinked"
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
              <CardFormSection title="👤 Шаг 1 — Кому выдаём?" subtitle="Найдите клиента по имени, телефону или номеру карты">
                <ClientSearchPicker
                  clients={clientsForLink}
                  selectedId={linkForm.clientId}
                  onSelect={pickClient}
                  onClear={() => pickClient('')}
                  autoFocus
                />
                {linkClient && linkClient.card && (
                  <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 10, background: 'rgba(255,184,0,.08)', border: '1px solid rgba(255,184,0,.2)', fontSize: 11, color: '#FFB800' }}>
                    ⚠ Старая карта {linkClient.card} будет заменена новой
                  </div>
                )}
              </CardFormSection>

              <CardFormSection title="⭐ Шаг 2 — Бонусы" subtitle="Уровень, VIP и раздел долга — во вкладке «Статусы»">
                <NI lbl="Бонусы ⭐" val={String(linkForm.bonus)} set={v => setLF('bonus', Math.max(0, parseFloat(v) || 0))} ph="0" type="number" />
                <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: 'rgba(59,142,240,.08)', border: '1px solid rgba(59,142,240,.2)', fontSize: 11, color: '#8FB897', lineHeight: 1.45 }}>
                  🏅 Статус клиента (уровень, VIP, долг) настраивается в <button type="button" onClick={() => { setShowCreateLink(false); setCardsTab('status'); }} style={{ background: 'none', border: 'none', color: '#3B8EF0', fontWeight: 800, cursor: 'pointer', padding: 0, fontSize: 11 }}>разделе «Статусы»</button>
                </div>
              </CardFormSection>

              {linkErr && (
                <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(255,69,69,.1)', border: '1px solid rgba(255,69,69,.3)', fontSize: 12, color: '#FF4545', fontWeight: 700 }}>
                  ⚠ {linkErr}
                </div>
              )}
              <button type="button" onClick={saveCreateLink} disabled={createLoading || !linkForm.clientId} className="ab abp" style={{ width: '100%', padding: 14, fontSize: 14, fontWeight: 800, opacity: createLoading || !linkForm.clientId ? .6 : 1 }}>
                {createLoading ? '⏳ Создаём карту…' : '✓ Выдать карту клиенту'}
              </button>
              {!linkForm.clientId && (
                <div style={{ textAlign: 'center', fontSize: 11, color: '#3D6645' }}>Сначала выберите клиента ↑</div>
              )}
            </div>
          </div>
        </div>
      )}

      {showLink && (
        <div className="amod">
          <div className="amodbg" onClick={() => setShowLink(null)} />
          <div className="amodbox" style={{ maxWidth: 460 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <div className="ub" style={{ fontSize: 16, fontWeight: 900 }}>
                  {showLink.status === 'unlinked' ? '🔗 Привязать карту' : '⚙️ Настройки карты'}
                </div>
                <div style={{ fontSize: 11, color: '#8FB897', marginTop: 3 }}>{showLink.num}</div>
              </div>
              <button type="button" onClick={() => setShowLink(null)} className="ab" style={{ background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', width: 32, height: 32, padding: 0, borderRadius: 10, fontSize: 16 }}>✕</button>
            </div>

            <CardVisualMini num={showLink.num} level={linkForm.level} clientName={linkClient?.name} status={showLink.status} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
              <CardFormSection title="👤 Клиент" subtitle={showLink.status === 'unlinked' ? 'Найдите клиента по имени или телефону' : 'Сменить привязку карты'}>
                <ClientSearchPicker
                  clients={clientsForLink}
                  selectedId={linkForm.clientId}
                  onSelect={pickClient}
                  onClear={() => pickClient('')}
                  autoFocus
                />
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed #162B1A' }}>
                  <NI lbl="Или только телефон (если нет в списке)" val={linkForm.phone} set={v => setLF('phone', v)} ph="+992 93 456 78 90" />
                </div>
              </CardFormSection>

              <CardFormSection title="⭐ Бонусы" subtitle="Уровень, VIP и долг — во вкладке «Статусы»">
                <NI lbl="Бонусы ⭐" val={String(linkForm.bonus)} set={v => setLF('bonus', Math.max(0, parseFloat(v) || 0))} ph="0" type="number" />
                {showLink.status !== 'unlinked' && (linkForm.debt > 0 || linkForm.debtEnabled) && (
                  <div style={{ marginTop: 12 }}>
                    <DebtReadOnly
                      debt={Math.max(0, Number(linkForm.debt) || 0)}
                      onManage={() => { setShowLink(null); setPage('debts'); }}
                    />
                  </div>
                )}
                <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: 'rgba(59,142,240,.08)', border: '1px solid rgba(59,142,240,.2)', fontSize: 11, color: '#8FB897', lineHeight: 1.45 }}>
                  🏅 Статус: <button type="button" onClick={() => { setShowLink(null); setCardsTab('status'); }} style={{ background: 'none', border: 'none', color: '#3B8EF0', fontWeight: 800, cursor: 'pointer', padding: 0, fontSize: 11 }}>вкладка «Статусы»</button>
                </div>
              </CardFormSection>

              {linkErr && (
                <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(255,69,69,.1)', border: '1px solid rgba(255,69,69,.3)', fontSize: 12, color: '#FF4545', fontWeight: 700 }}>⚠ {linkErr}</div>
              )}
              <button type="button" onClick={saveLink} className="ab abp" style={{ width: '100%', padding: 14, fontSize: 14, fontWeight: 800 }}>
                {showLink.status === 'unlinked' ? '✓ Привязать карту' : '✓ Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showGen && (
        <div className="amod">
          <div className="amodbg" onClick={() => { if (!genLoading) { setShowGen(false); setGened(false); setGenCreated([]); } }} />
          <div className="amodbox" style={{ maxWidth: 440 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <div className="ub" style={{ fontSize: 16, fontWeight: 900 }}>📦 Пустые карты</div>
                <div style={{ fontSize: 11, color: '#8FB897', marginTop: 3 }}>Для печати или выдачи на кассе</div>
              </div>
              <button type="button" onClick={() => { setShowGen(false); setGened(false); setGenCreated([]); }} className="ab" style={{ background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', width: 32, height: 32, padding: 0, borderRadius: 10, fontSize: 16 }}>✕</button>
            </div>
            {!gened ? (
              <>
                <CardVisualMini status="unlinked" />
                <div style={{ marginTop: 16 }}>
                  <NI lbl="Сколько карт создать?" val={genN} set={setGenN} ph="1" type="number" />
                </div>
                <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(255,184,0,.08)', border: '1px solid rgba(255,184,0,.2)', fontSize: 12, color: '#8FB897', margin: '12px 0' }}>
                  Номера: <strong style={{ color: '#FFB800' }}>{genPreview.from}</strong> → <strong style={{ color: '#FFB800' }}>{genPreview.to}</strong>
                </div>
                {genErr && <div style={{ fontSize: 12, color: '#FF4545', fontWeight: 700, marginBottom: 10 }}>⚠ {genErr}</div>}
                <button type="button" onClick={doGenerate} disabled={genLoading} className="ab abp" style={{ width: '100%', padding: 14, fontWeight: 800, opacity: genLoading ? .7 : 1 }}>
                  {genLoading ? '⏳ Создаём…' : `✓ Создать ${Math.max(1, parseInt(genN, 10) || 1)} карт`}
                </button>
              </>
            ) : (
              <div>
                <div style={{ textAlign: 'center', padding: '12px 0 16px' }}>
                  <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
                  <div className="ub" style={{ fontSize: 16, fontWeight: 900, color: '#1FD760' }}>{genCreated.length} карт готово!</div>
                  <div style={{ fontSize: 12, color: '#8FB897', marginTop: 6 }}>Нажмите «Привязать» у нужной карты</div>
                </div>
                <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                  {genCreated.map(c => (
                    <div key={c.num} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 12, background: '#0C1C0F', border: '1px solid #162B1A' }}>
                      <span className="ub" style={{ fontSize: 12, fontWeight: 800, color: '#FFB800' }}>{c.num}</span>
                      <button type="button" onClick={() => { setShowGen(false); openLink(c); }} className="ab abp" style={{ padding: '6px 14px', fontSize: 11, fontWeight: 800 }}>🔗 Привязать</button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={downloadCsv} className="ab abg" style={{ width: '100%', padding: 11, marginBottom: 8 }}>📄 Скачать список (CSV)</button>
                <button type="button" onClick={() => { setShowGen(false); setGened(false); setGenCreated([]); }} className="ab" style={{ width: '100%', padding: 10, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897' }}>Готово</button>
              </div>
            )}
          </div>
        </div>
      )}
      </>}
    </div>
  );
}

/* ── ДОЛГИ VIP ──────────────────────────────────── */
function DebtsPage({ setPage }: { setPage: (p: string) => void }) {
  const stored = useCards();
  const clients = useClients();
  const apiOrders = useOrders(s => s.orders);
  const cards = useMemo(() => mergeCardsWithClients(stored, clients), [stored, clients]);

  const debtCards = useMemo(
    () => cards.filter(c => c.status === 'active' && cardHasDebtSection(c) && !!(c.phone || c.clientId || c.client)),
    [cards],
  );

  const [filter, setFilter] = useState<'with_debt' | 'over_limit' | 'all'>('with_debt');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<AdminCard | null>(null);
  const [debtAction, setDebtAction] = useState<'add' | 'subtract'>('subtract');
  const [debtAmount, setDebtAmount] = useState('');
  const [saveErr, setSaveErr] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [histTick, setHistTick] = useState(0);

  const stats = useMemo(() => ({
    totalDebt: debtCards.reduce((s, c) => s + c.debt, 0),
    withDebt: debtCards.filter(c => c.debt > 0).length,
    overLimit: debtCards.filter(c => c.debtLimit > 0 && c.debt > c.debtLimit).length,
    allCards: debtCards.length,
  }), [debtCards]);

  const filtered = useMemo(() => {
    let list = debtCards;
    if (filter === 'with_debt') list = list.filter(c => c.debt > 0);
    if (filter === 'over_limit') list = list.filter(c => c.debtLimit > 0 && c.debt > c.debtLimit);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(c =>
        c.num.toLowerCase().includes(q)
        || c.client.toLowerCase().includes(q)
        || c.phone.replace(/\s/g, '').includes(q.replace(/\s/g, '')),
      );
    }
    return [...list].sort((a, b) => b.debt - a.debt);
  }, [debtCards, filter, search]);

  const creditOrders = useMemo(() => {
    if (!detail?.phone) return [];
    return apiOrders
      .filter(o => (o.payment_method === 'credit' || o.pay === 'credit') && phonesMatch(o.client?.phone || '', detail.phone))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 8);
  }, [detail, apiOrders]);

  const openDetail = (card: AdminCard) => {
    setDetail(card);
    setDebtAction('subtract');
    setDebtAmount('');
    setSaveErr('');
  };

  useEffect(() => subscribeDebtHistory(() => setHistTick(t => t + 1)), []);

  const debtHistory = useMemo(() => {
    if (!detail?.phone) return [];
    return loadDebtHistory(detail.phone).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 12);
  }, [detail?.phone, histTick]);

  const saveDebt = () => {
    if (!detail) return;
    setSaveBusy(true);
    setSaveErr('');
    try {
      const client = findClientForCard(clients, detail);
      const amount = Math.max(0, parseFloat(debtAmount) || 0);
      if (amount <= 0) throw new Error('Укажите сумму');
      const nextDebt = debtAction === 'add'
        ? detail.debt + amount
        : Math.max(0, detail.debt - amount);
      const form = {
        ...cardLoyaltyFromCard(detail, client),
        debt: nextDebt,
      };
      saveCardLoyalty(detail, form, 'edit');
      setDetail(null);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setSaveBusy(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { filter: 'with_debt' as const, l: 'С долгом', v: stats.withDebt, c: '#FF4545', e: '⚠️' },
          { filter: 'with_debt' as const, l: 'Всего долг', v: `${stats.totalDebt.toLocaleString()} ЅМ`, c: '#FF8C00', e: '💰' },
          { filter: 'over_limit' as const, l: 'Превышен лимит', v: stats.overLimit, c: '#FF4545', e: '🚫' },
          { filter: 'all' as const, l: 'С разделом долга', v: stats.allCards, c: '#1FD760', e: '💳' },
        ].map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setFilter(s.filter)}
            className="ac"
            style={{
              padding: '14px 16px', textAlign: 'left', cursor: 'pointer',
              border: filter === s.filter && (i === 0 || i === 2 || i === 3) ? `2px solid ${s.c}55` : '1px solid #162B1A',
              background: filter === s.filter && (i === 0 || i === 2 || i === 3) ? `${s.c}0D` : undefined,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: '#8FB897', fontWeight: 600 }}>{s.l}</span>
              <span style={{ fontSize: 18 }}>{s.e}</span>
            </div>
            <div className="ub" style={{ fontSize: typeof s.v === 'number' ? 24 : 18, fontWeight: 900, color: s.c }}>{s.v}</div>
          </button>
        ))}
      </div>

      <div style={{
        padding: '12px 16px', borderRadius: 12, marginBottom: 16,
        background: 'rgba(59,142,240,.08)', border: '1px solid rgba(59,142,240,.22)',
        fontSize: 12, color: '#8FB897', lineHeight: 1.55,
      }}>
        💬 Клиенты погашают долг через <strong style={{ color: '#EBF5ED' }}>поддержку</strong> (звонок / Telegram).
        После подтверждения оплаты уменьшите долг здесь. Карта попадает в список, если в настройках включён переключатель «Раздел долга».
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 320 }}>
          <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, pointerEvents: 'none' }}>🔍</div>
          <input
            className="ai"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Карта · клиент · телефон"
            style={{ paddingLeft: 38, width: '100%' }}
          />
        </div>
        {[
          { id: 'with_debt' as const, l: 'С долгом' },
          { id: 'over_limit' as const, l: '⚠ Превышен лимит' },
          { id: 'all' as const, l: 'С разделом долга' },
        ].map(f => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className="ab"
            style={{
              padding: '7px 14px', fontSize: 12,
              background: filter === f.id ? 'rgba(255,140,0,.12)' : '#0C1C0F',
              border: `1.5px solid ${filter === f.id ? 'rgba(255,140,0,.35)' : '#162B1A'}`,
              color: filter === f.id ? '#FF8C00' : '#8FB897',
            }}
          >
            {f.l}
          </button>
        ))}
      </div>

      <div className="ac">
        <table className="at">
          <thead>
            <tr>
              <th>Карта</th>
              <th>Клиент</th>
              <th>Телефон</th>
              <th>Долг</th>
              <th>Лимит</th>
              <th>Доступно</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '28px 14px', color: '#8FB897', fontSize: 13 }}>
                  {filter === 'with_debt' ? 'Нет клиентов с долгом' : 'Нет записей по фильтру'}
                </td>
              </tr>
            ) : filtered.map(c => {
              const available = Math.max(0, c.debtLimit - c.debt);
              const overLimit = c.debtLimit > 0 && c.debt > c.debtLimit;
              return (
                <tr key={c.num} onClick={() => openDetail(c)} style={{ cursor: 'pointer' }}>
                  <td><span className="ub" style={{ fontSize: 11, color: '#FFB800', fontWeight: 800 }}>{c.num}</span></td>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 12 }}>{c.client || '—'}</div>
                    {c.vip && <span style={{ fontSize: 9, color: '#FFB800', fontWeight: 800 }}>👑 VIP</span>}
                  </td>
                  <td style={{ fontSize: 11, color: '#8FB897' }}>{c.phone || '—'}</td>
                  <td>
                    <span className="ub" style={{ fontSize: 13, fontWeight: 900, color: c.debt > 0 ? '#FF4545' : '#3D6645' }}>
                      {c.debt > 0 ? `${c.debt.toLocaleString()} ЅМ` : '—'}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: '#8FB897' }}>{c.debtLimit > 0 ? `${c.debtLimit.toLocaleString()} ЅМ` : '—'}</td>
                  <td style={{ fontSize: 12, color: available > 0 ? '#1FD760' : '#3D6645', fontWeight: 700 }}>
                    {c.debtLimit > 0 ? `${available.toLocaleString()} ЅМ` : '—'}
                  </td>
                  <td>
                    {overLimit ? (
                      <Badge v="Превышен" c="#FF4545" />
                    ) : c.debt > 0 ? (
                      <Badge v="В долгу" c="#FF8C00" />
                    ) : c.debtLimit > 0 ? (
                      <Badge v="Лимит есть" c="#1FD760" />
                    ) : (
                      <Badge v="Нет долга" c="#3D6645" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="amod">
          <div className="amodbg" onClick={() => setDetail(null)} />
          <div className="amodbox" style={{ maxWidth: 480 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div className="ub" style={{ fontSize: 17, fontWeight: 900, color: '#FFB800' }}>{detail.num}</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>{detail.client || '—'}</div>
                <div style={{ fontSize: 11, color: '#8FB897', marginTop: 2 }}>{detail.phone || '—'}</div>
              </div>
              <button type="button" onClick={() => setDetail(null)} className="ab" style={{ background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', width: 32, height: 32, padding: 0, borderRadius: 10, fontSize: 16 }}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
              {[
                { l: 'Долг', v: `${detail.debt.toLocaleString()} ЅМ`, c: '#FF4545' },
                { l: 'Лимит', v: detail.debtLimit > 0 ? `${detail.debtLimit.toLocaleString()} ЅМ` : '—', c: '#1FD760' },
                { l: 'Доступно', v: detail.debtLimit > 0 ? `${Math.max(0, detail.debtLimit - detail.debt).toLocaleString()} ЅМ` : '—', c: '#3B8EF0' },
              ].map((row, i) => (
                <div key={i} style={{ padding: '12px', borderRadius: 12, background: '#0C1C0F', border: '1px solid #162B1A', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#3D6645', marginBottom: 4, fontWeight: 700 }}>{row.l}</div>
                  <div className="ub" style={{ fontSize: 14, fontWeight: 900, color: row.c }}>{row.v}</div>
                </div>
              ))}
            </div>

            <div style={{ padding: '14px', borderRadius: 12, background: 'rgba(255,140,0,.08)', border: '1px solid rgba(255,140,0,.22)', marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#FF8C00', marginBottom: 8 }}>Изменить долг</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                {[
                  { id: 'subtract' as const, l: 'Списать долг', s: 'После оплаты' },
                  { id: 'add' as const, l: 'Добавить долг', s: 'Ручное начисление' },
                ].map(action => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => setDebtAction(action.id)}
                    className="ab"
                    style={{
                      padding: '10px 10px',
                      textAlign: 'left',
                      background: debtAction === action.id ? 'rgba(255,140,0,.14)' : '#0C1C0F',
                      border: `1px solid ${debtAction === action.id ? 'rgba(255,140,0,.35)' : '#162B1A'}`,
                      color: debtAction === action.id ? '#FF8C00' : '#8FB897',
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 800 }}>{action.l}</div>
                    <div style={{ fontSize: 10, marginTop: 2, opacity: .85 }}>{action.s}</div>
                  </button>
                ))}
              </div>
              <NI lbl="Сумма ЅМ" val={debtAmount} set={setDebtAmount} ph="0" type="number" />
              <div style={{ fontSize: 10, color: '#8FB897', marginTop: 8, lineHeight: 1.45 }}>
                {debtAction === 'subtract'
                  ? 'После сохранения долг уменьшится, а клиент увидит запись о погашении через поддержку.'
                  : 'После сохранения долг увеличится, а клиент увидит запись о новом начислении.'}
              </div>
            </div>

            {creditOrders.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: '#3D6645', fontWeight: 800, marginBottom: 8, textTransform: 'uppercase' }}>Заказы в долг</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
                  {creditOrders.map(o => (
                    <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: '#0C1C0F', borderRadius: 10, border: '1px solid #162B1A' }}>
                      <div>
                        <div className="ub" style={{ fontSize: 11, fontWeight: 800, color: '#1FD760' }}>{o.id}</div>
                        <div style={{ fontSize: 10, color: '#3D6645' }}>{o.createdAt || '—'}</div>
                      </div>
                      <div className="ub" style={{ fontSize: 12, fontWeight: 900, color: '#FF8C00' }}>
                        {(o.creditAmount ?? Math.max(0, o.total - (o.deliveryFee || 0))).toLocaleString()} ЅМ
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#3D6645', fontWeight: 800, marginBottom: 8, textTransform: 'uppercase' }}>История долга</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                {debtHistory.length === 0 ? (
                  <div style={{ padding: '12px 14px', background: '#0C1C0F', border: '1px solid #162B1A', borderRadius: 10, fontSize: 12, color: '#8FB897' }}>
                    История пока пуста
                  </div>
                ) : debtHistory.map((row: DebtHistoryEntry) => {
                  const isPay = row.type === 'pay';
                  return (
                    <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 12px', background: '#0C1C0F', borderRadius: 10, border: '1px solid #162B1A' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#EBF5ED' }}>{row.desc || (isPay ? 'Погашение' : 'Начисление')}</div>
                        {row.itemsSummary && <div style={{ fontSize: 10, color: '#8FB897', marginTop: 2 }}>{row.itemsSummary}</div>}
                        <div style={{ fontSize: 10, color: '#3D6645', marginTop: 3 }}>{row.date} · {row.time || '—'}</div>
                      </div>
                      <div className="ub" style={{ fontSize: 13, fontWeight: 900, color: isPay ? '#1FD760' : '#FF8080', flexShrink: 0 }}>
                        {isPay ? '+' : '−'}{Math.abs(row.amount).toLocaleString()} ЅМ
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {saveErr && (
              <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,69,69,.1)', border: '1px solid rgba(255,69,69,.3)', fontSize: 12, color: '#FF4545', fontWeight: 700, marginBottom: 12 }}>
                ⚠ {saveErr}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => setPage('cards')} className="ab" style={{ flex: 1, padding: 12, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897', fontWeight: 700 }}>
                💳 Карта
              </button>
              <button type="button" onClick={saveDebt} disabled={saveBusy} className="ab abp" style={{ flex: 2, padding: 12, fontWeight: 800, opacity: saveBusy ? .7 : 1 }}>
                {saveBusy ? '⏳ Сохраняем…' : debtAction === 'add' ? '✓ Добавить долг' : '✓ Списать долг'}
              </button>
            </div>
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
  const LOCAL_KEY = 'kakapo_admin_promos'
  const defaultPromos: Promo[] = [
    { id: 1, e: '🥛', title: 'Молочная среда', sub: 'Скидка 30% на молочное', disc: 30, on: true, cat: 'Магазин', type: 'pct', from: '08:00', to: '22:00', till: 'Среда' },
    { id: 2, e: '🥩', title: 'Мясные выходные', sub: 'Скидка 25% на мясо и птицу', disc: 25, on: true, cat: 'Магазин', type: 'pct', from: '08:00', to: '22:00', till: 'Сб–Вс' },
    { id: 3, e: '🥦', title: 'Органик-день', sub: 'Скидка 20% на органик продукты', disc: 20, on: false, cat: 'Магазин', type: 'pct', from: '08:00', to: '22:00', till: 'Пятница' },
    { id: 4, e: '⚡', title: 'Флэш-распродажа', sub: 'Только до 20:00 сегодня', disc: 40, on: true, cat: 'Магазин', type: 'pct', from: '08:00', to: '20:00', till: 'Сегодня' },
    { id: 5, e: '🚀', title: 'Бесплатная доставка', sub: 'При заказе от 30 ЅМ', disc: 0, on: true, cat: 'Магазин', type: 'free', from: '08:00', to: '22:00', till: 'Всегда' },
    { id: 6, e: '🍽', title: 'Скидка в ресторанах', sub: '10% в Чайхоне и Суши', disc: 10, on: false, cat: 'Рестораны', type: 'pct', from: '10:00', to: '23:00', till: 'Всегда' },
    { id: 7, e: '🎁', title: 'Первый заказ', sub: '15% скидка на первый заказ', disc: 15, on: true, cat: 'Магазин', type: 'first', from: '00:00', to: '23:59', till: 'Всегда' },
  ]
  const emptyForm = { e: '🎁', title: '', sub: '', disc: '0', cat: 'Магазин' as Promo['cat'], type: 'pct' as Promo['type'], from: '08:00', to: '22:00', till: 'Всегда', on: true }

  const [promos, setPromos] = useState<Promo[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const persistLocal = (list: Promo[]) => {
    if (typeof window !== 'undefined') localStorage.setItem(LOCAL_KEY, JSON.stringify(list))
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (USE_API) {
          const list = await api.getPromos()
          if (!cancelled) setPromos(list)
        } else {
          const raw = typeof window !== 'undefined' ? localStorage.getItem(LOCAL_KEY) : null
          const list = raw ? (JSON.parse(raw) as Promo[]) : defaultPromos
          if (!cancelled) setPromos(list)
        }
      } catch {
        if (!cancelled) setPromos(defaultPromos)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const openCreate = () => {
    setEditId(null)
    setForm(emptyForm)
    setShowModal(true)
  }

  const openEdit = (p: Promo) => {
    setEditId(p.id)
    setForm({
      e: p.e,
      title: p.title,
      sub: p.sub,
      disc: String(p.disc),
      cat: p.cat,
      type: p.type || 'pct',
      from: p.from || '08:00',
      to: p.to || '22:00',
      till: p.till || 'Всегда',
      on: p.on,
    })
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditId(null)
    setForm(emptyForm)
  }

  const savePromo = async () => {
    if (!form.title.trim()) return
    setSaving(true)
    const payload = {
      e: form.e || '🎁',
      title: form.title.trim(),
      sub: form.sub.trim(),
      disc: form.type === 'free' ? 0 : Number(form.disc) || 0,
      cat: form.cat,
      type: form.type,
      from: form.from,
      to: form.to,
      till: form.till || 'Всегда',
      on: form.on,
    }
    try {
      if (USE_API) {
        if (editId !== null) {
          const updated = await api.updatePromo(editId, payload)
          setPromos(ps => ps.map(x => (x.id === editId ? updated : x)))
        } else {
          const created = await api.createPromo(payload)
          setPromos(ps => [...ps, created])
        }
      } else {
        if (editId !== null) {
          const next = promos.map(x => (x.id === editId ? { ...x, ...payload, id: editId } : x))
          setPromos(next)
          persistLocal(next)
        } else {
          const created: Promo = { ...payload, id: Date.now() }
          const next = [...promos, created]
          setPromos(next)
          persistLocal(next)
        }
      }
      closeModal()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось сохранить акцию')
    } finally {
      setSaving(false)
    }
  }

  const togglePromo = async (p: Promo) => {
    const nextOn = !p.on
    setPromos(ps => ps.map(x => (x.id === p.id ? { ...x, on: nextOn } : x)))
    try {
      if (USE_API) await api.updatePromo(p.id, { on: nextOn })
      else persistLocal(promos.map(x => (x.id === p.id ? { ...x, on: nextOn } : x)))
    } catch {
      setPromos(ps => ps.map(x => (x.id === p.id ? { ...x, on: p.on } : x)))
    }
  }

  const removePromo = async (id: number) => {
    if (!confirm('Удалить акцию?')) return
    const prev = promos
    setPromos(ps => ps.filter(x => x.id !== id))
    try {
      if (USE_API) await api.deletePromo(id)
      else persistLocal(prev.filter(x => x.id !== id))
    } catch {
      setPromos(prev)
      alert('Не удалось удалить акцию')
    }
  }

  const discBadge = (p: Promo) => {
    if (p.type === 'free') return <Badge v="Бесплатная доставка" c="#1FD760"/>
    if (p.disc > 0) return <Badge v={`-${p.disc}%`} c="#FF4545"/>
    return null
  }

  const setF = (k: keyof typeof form, v: string | boolean) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:18}}>
        <StatCard l="Всего акций" v={promos.length}/>
        <StatCard l="Активных" v={promos.filter(p=>p.on).length} c="#1FD760"/>
        <StatCard l="Выключено" v={promos.filter(p=>!p.on).length} c="#3D6645"/>
      </div>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}>
        <button onClick={openCreate} className="ab abp">+ Создать акцию</button>
      </div>
      {loading ? (
        <div style={{padding:24,textAlign:'center',color:'#8FB897'}}>Загрузка…</div>
      ) : (
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {promos.map(p=>(
          <div key={p.id} className="ac" style={{padding:'14px 16px',opacity:p.on?1:.6,transition:'opacity .2s'}}>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:44,height:44,borderRadius:13,background:'rgba(31,215,96,.1)',border:'1px solid rgba(31,215,96,.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>{p.e}</div>
              <div style={{flex:1}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3,flexWrap:'wrap'}}>
                    <span style={{fontSize:14,fontWeight:800}}>{p.title}</span>
                    {discBadge(p)}
                  <Badge v={p.cat} c={p.cat==='Рестораны'?'#FF8C00':'#3B8EF0'}/>
                </div>
                  <div style={{fontSize:12,color:'#8FB897'}}>{p.sub}</div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <span style={{fontSize:11,color:p.on?'#1FD760':'#3D6645',fontWeight:700}}>{p.on?'Вкл':'Выкл'}</span>
                  <Tog on={p.on} set={()=>togglePromo(p)}/>
                  <button onClick={()=>openEdit(p)} className="ab abg" style={{padding:'5px 10px',fontSize:11}}>✏️</button>
                  <button onClick={()=>removePromo(p.id)} className="ab abd" style={{padding:'5px 10px',fontSize:11}}>🗑</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      )}

      {showModal && (
        <div className="amod">
          <div className="amodbg" onClick={closeModal}/>
          <div className="amodbox" style={{maxWidth:520}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
              <div className="ub" style={{fontSize:15,fontWeight:800}}>{editId !== null ? 'Редактировать акцию' : 'Новая акция'}</div>
              <button onClick={closeModal} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div style={{display:'grid',gridTemplateColumns:'70px 1fr',gap:12}}>
                <div>
                  <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Emoji</div>
                  <input className="ai" value={form.e} onChange={e=>setF('e', e.target.value)} style={{textAlign:'center',fontSize:26,height:50}}/>
                </div>
                <div>
                  <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Название *</div>
                  <input className="ai" value={form.title} onChange={e=>setF('title', e.target.value)} placeholder="Название акции"/>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
                <div>
                  <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Тип акции</div>
                  <select className="ai" value={form.type} onChange={e=>setF('type', e.target.value)} style={{cursor:'pointer'}}>
                    <option value="pct">% скидка</option>
                    <option value="free">Бесплатная доставка</option>
                    <option value="first">Первый заказ</option>
                    <option value="fixed">Фиксированная (ЅМ)</option>
                  </select>
                </div>
                <div>
                  <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Скидка (%)</div>
                  <input className="ai" value={form.disc} onChange={e=>setF('disc', e.target.value)} type="number" placeholder="30" disabled={form.type==='free'}/>
                </div>
                <div>
                  <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Раздел</div>
                  <select className="ai" value={form.cat} onChange={e=>setF('cat', e.target.value)} style={{cursor:'pointer'}}>
                    <option value="Магазин">Магазин</option>
                    <option value="Рестораны">Рестораны</option>
                  </select>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Начало</div><input className="ai" type="time" value={form.from} onChange={e=>setF('from', e.target.value)}/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Конец</div><input className="ai" type="time" value={form.to} onChange={e=>setF('to', e.target.value)}/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Действует до</div><input className="ai" value={form.till} onChange={e=>setF('till', e.target.value)} placeholder="Напр: Среда"/></div>
              </div>
              <div>
                <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Описание</div>
                <input className="ai" value={form.sub} onChange={e=>setF('sub', e.target.value)} placeholder="Короткое описание для клиентов"/>
              </div>
              <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12,color:'#8FB897',cursor:'pointer'}}>
                <input type="checkbox" checked={form.on} onChange={e=>setF('on', e.target.checked)}/>
                Акция активна
              </label>
              <div style={{display:'flex',gap:10,marginTop:4}}>
                <button onClick={savePromo} disabled={saving || !form.title.trim()} className="ab abp" style={{flex:1,padding:12,opacity:saving||!form.title.trim()?0.6:1}}>
                  {saving ? 'Сохранение…' : editId !== null ? '✓ Сохранить' : '✓ Создать акцию'}
                </button>
                <button onClick={closeModal} className="ab abg">Отмена</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── PUSH ────────────────────────────────────────── */
function PushPreview({ title, body }: { title: string; body: string }) {
  return (
    <div style={{
      padding: '14px 16px',
      borderRadius: 16,
      background: 'linear-gradient(145deg,#060E08,#0C1C0F)',
      border: '1px solid #162B1A',
      boxShadow: '0 8px 28px rgba(0,0,0,.35)',
    }}>
      <div style={{ fontSize: 9, color: '#3D6645', marginBottom: 10, fontWeight: 800, letterSpacing: 1 }}>ПРЕДПРОСМОТР · iOS / Android</div>
      <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
        <div style={{
          width: 40, height: 40, borderRadius: 11,
          background: 'linear-gradient(135deg,#0F8A3A,#1FD760)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'Unbounded', fontSize: 15, fontWeight: 900, color: '#030B05', flexShrink: 0,
          boxShadow: '0 4px 12px rgba(31,215,96,.3)',
        }}>K</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 3, color: '#EBF5ED' }}>{title || 'Заголовок'}</div>
          <div style={{ fontSize: 12, color: '#8FB897', lineHeight: 1.5 }}>{body || 'Текст уведомления'}</div>
          <div style={{ fontSize: 10, color: '#3D6645', marginTop: 6 }}>КАКАПО · сейчас</div>
        </div>
      </div>
    </div>
  );
}

function PushToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        width: 44, height: 24, borderRadius: 12, border: 'none', padding: 0, cursor: 'pointer',
        background: on ? '#1FD760' : '#1D3822', position: 'relative', flexShrink: 0, transition: 'background .2s',
      }}
    >
      <div style={{
        position: 'absolute', top: 3, left: on ? 22 : 3, width: 18, height: 18,
        borderRadius: '50%', background: 'white', transition: 'left .2s',
        boxShadow: '0 1px 4px rgba(0,0,0,.25)',
      }} />
    </button>
  );
}

function PushPage() {
  const storedClients = useClients();
  const apiOrders = useOrders(s => s.orders);
  const history = usePushHistory();
  const autoSettings = usePushAutoSettings();
  const templates = usePushTemplates();
  const setAutoEnabled = usePushStore(s => s.setAutoEnabled);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [target, setTarget] = useState<PushSegmentId>('all');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState('');
  const [histSearch, setHistSearch] = useState('');

  const pushClients = useMemo(
    () => enrichClientsForPush(storedClients, apiOrders),
    [storedClients, apiOrders],
  );

  const segmentCounts = useMemo(() => {
    const counts: Record<PushSegmentId, number> = {} as Record<PushSegmentId, number>;
    for (const seg of PUSH_SEGMENT_OPTIONS) counts[seg.id] = countSegment(pushClients, seg.id);
    return counts;
  }, [pushClients]);

  const selectedRecipients = useMemo(
    () => filterClientsBySegment(pushClients, target),
    [pushClients, target],
  );

  const filteredHistory = useMemo(() => {
    const q = histSearch.trim().toLowerCase();
    if (!q) return history;
    return history.filter(h =>
      `${h.title} ${h.body} ${h.segmentLabel}`.toLowerCase().includes(q),
    );
  }, [history, histSearch]);

  const stats = useMemo(() => ({
    totalClients: pushClients.filter(c => !c.blocked).length,
    autoOn: autoSettings.filter(s => s.enabled).length,
    sentTotal: history.reduce((s, h) => s + h.delivered, 0),
    avgOpen: history.length
      ? Math.round(history.reduce((s, h) => s + openRatePercent(h.opened, h.delivered), 0) / history.length)
      : 0,
  }), [pushClients, autoSettings, history]);

  const doSend = async () => {
    if (!title.trim() || !body.trim()) {
      setSendErr('Заполните заголовок и текст');
      return;
    }
    if (!selectedRecipients.length) {
      setSendErr('В этой группе нет получателей');
      return;
    }
    setSending(true);
    setSendErr('');
    try {
      await sendPushCampaign({
        title: title.trim(),
        body: body.trim(),
        segment: target,
        recipients: selectedRecipients,
        icon: '🔔',
      });
      setSent(true);
      setTitle('');
      setBody('');
      setTimeout(() => setSent(false), 4000);
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : 'Ошибка отправки');
    } finally {
      setSending(false);
    }
  };

  const applyTemplate = (t: { title: string; body: string; segment?: PushSegmentId }) => {
    setTitle(t.title);
    setBody(t.body);
    if (t.segment) setTarget(t.segment);
    setSendErr('');
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { l: 'Клиентов в базе', v: stats.totalClients, c: '#EBF5ED', e: '👥' },
          { l: 'Отправлено всего', v: stats.sentTotal.toLocaleString(), c: '#1FD760', e: '📤' },
          { l: 'Авто-уведомления', v: `${stats.autoOn}/${autoSettings.length}`, c: '#3B8EF0', e: '⚡' },
          { l: 'Ср. открываемость', v: `${stats.avgOpen}%`, c: '#FFB800', e: '📊' },
        ].map(s => (
          <div key={s.l} className="ac" style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: '#8FB897', fontWeight: 600 }}>{s.l}</span>
              <span style={{ fontSize: 18 }}>{s.e}</span>
            </div>
            <div className="ub" style={{ fontSize: 22, fontWeight: 900, color: s.c }}>{s.v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="ac" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div className="ub" style={{ fontSize: 15, fontWeight: 900 }}>📣 Новая рассылка</div>
                <div style={{ fontSize: 11, color: '#8FB897', marginTop: 4 }}>Push попадёт в приложение клиента КАКАПО</div>
              </div>
              <Badge v={`${selectedRecipients.length} чел.`} c="#1FD760" />
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 8, fontWeight: 700 }}>Кому отправить</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {PUSH_SEGMENT_OPTIONS.map(seg => {
                  const active = target === seg.id;
                  const n = segmentCounts[seg.id] ?? 0;
                  return (
                    <button
                      key={seg.id}
                      type="button"
                      onClick={() => setTarget(seg.id)}
                      style={{
                        textAlign: 'left', padding: '10px 12px', borderRadius: 12, cursor: 'pointer',
                        background: active ? 'rgba(31,215,96,.1)' : '#0C1C0F',
                        border: `1.5px solid ${active ? 'rgba(31,215,96,.4)' : '#162B1A'}`,
                        transition: 'all .15s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 16 }}>{seg.emoji}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: active ? '#1FD760' : '#EBF5ED' }}>{seg.label}</span>
                      </div>
                      <div style={{ fontSize: 10, color: '#3D6645', lineHeight: 1.4 }}>{seg.hint}</div>
                      <div style={{ fontSize: 11, color: active ? '#1FD760' : '#8FB897', fontWeight: 800, marginTop: 6 }}>{n.toLocaleString()} чел.</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
              <NI lbl="Заголовок *" val={title} set={setTitle} ph="Акция дня!" />
              <div>
                <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 5, fontWeight: 700 }}>Текст *</div>
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  placeholder="Скидки до 40% только сегодня!"
                  style={{
                    background: '#0C1C0F', border: '1.5px solid #162B1A', borderRadius: 10, color: '#EBF5ED',
                    fontFamily: 'Nunito', fontSize: 13, resize: 'none', height: 88, outline: 'none', padding: '9px 13px', width: '100%',
                  }}
                />
              </div>
            </div>

            {(title || body) && (
              <div style={{ marginBottom: 14 }}>
                <PushPreview title={title} body={body} />
              </div>
            )}

            {sendErr && (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(255,69,69,.1)', border: '1px solid rgba(255,69,69,.3)', fontSize: 12, color: '#FF4545', fontWeight: 700, marginBottom: 12 }}>
                ⚠ {sendErr}
              </div>
            )}

            <button
              type="button"
              onClick={doSend}
              disabled={sending || !title.trim() || !body.trim() || !selectedRecipients.length}
              className="ab"
              style={{
                width: '100%', padding: 14, fontWeight: 800, fontSize: 14,
                background: sent ? 'rgba(31,215,96,.15)' : 'linear-gradient(135deg,#17B34E,#1FD760)',
                border: sent ? '1.5px solid rgba(31,215,96,.4)' : 'none',
                color: sent ? '#1FD760' : '#030B05',
                opacity: sending || !selectedRecipients.length ? .65 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {sending ? '⏳ Отправляем…' : sent
                ? (target === 'all' ? '✅ Отправлено всем в приложении!' : `✅ Доставлено ${selectedRecipients.length} клиентам`)
                : (target === 'all' ? '📤 Отправить всем в приложении' : `📤 Отправить ${selectedRecipients.length} клиентам`)}
            </button>
          </div>

          <div className="ac" style={{ padding: 18 }}>
            <div className="ub" style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>⚡ Быстрые шаблоны</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {templates.map(tpl => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => applyTemplate(tpl)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12,
                    background: '#0C1C0F', border: '1px solid #162B1A', cursor: 'pointer', textAlign: 'left', width: '100%',
                  }}
                >
                  <span style={{ fontSize: 22, flexShrink: 0 }}>{tpl.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#EBF5ED' }}>{tpl.title}</div>
                    <div style={{ fontSize: 10, color: '#3D6645', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{tpl.body}</div>
                  </div>
                  <span style={{ fontSize: 10, color: '#1FD760', fontWeight: 800, flexShrink: 0 }}>Выбрать</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="ac" style={{ padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div className="ub" style={{ fontSize: 13, fontWeight: 800 }}>⚙️ Автоматические</div>
              <span style={{ fontSize: 10, color: '#3D6645' }}>Связаны с заказами и картами</span>
            </div>
            {autoSettings.map((row, i) => (
              <div
                key={row.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0',
                  borderBottom: i < autoSettings.length - 1 ? '1px solid #162B1A' : 'none',
                }}
              >
                <span style={{ fontSize: 18, flexShrink: 0 }}>{row.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: row.enabled ? '#EBF5ED' : '#8FB897' }}>{row.label}</div>
                  <div style={{ fontSize: 10, color: '#3D6645', marginTop: 2 }}>{row.description}</div>
                </div>
                <PushToggle on={row.enabled} onToggle={() => setAutoEnabled(row.id, !row.enabled)} />
              </div>
            ))}
          </div>

          <div className="ac" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '13px 16px', borderBottom: '1px solid #162B1A', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div className="ub" style={{ fontSize: 13, fontWeight: 800 }}>📋 История</div>
              <span style={{ fontSize: 10, color: '#3D6645' }}>{history.length} рассылок</span>
            </div>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid #162B1A' }}>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: .5, fontSize: 13 }}>🔍</span>
                <input
                  className="ai"
                  value={histSearch}
                  onChange={e => setHistSearch(e.target.value)}
                  placeholder="Поиск по заголовку…"
                  style={{ paddingLeft: 34, fontSize: 12 }}
                />
              </div>
            </div>
            {filteredHistory.length === 0 ? (
              <div style={{ padding: '28px 16px', textAlign: 'center', color: '#3D6645', fontSize: 12 }}>
                {histSearch ? 'Ничего не найдено' : 'История пуста — отправьте первую рассылку'}
              </div>
            ) : filteredHistory.map((h, i) => {
              const rate = openRatePercent(h.opened, h.delivered);
              return (
                <div key={h.id} style={{ padding: '12px 16px', borderBottom: i < filteredHistory.length - 1 ? '1px solid #162B1A' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ fontSize: 16 }}>{h.icon || '🔔'}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.title}</span>
                    </div>
                    <span style={{ fontSize: 10, color: '#3D6645', flexShrink: 0 }}>{formatPushTime(h.sentAt)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 8, lineHeight: 1.45 }}>{h.body}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 7, fontSize: 10, fontWeight: 700, background: 'rgba(59,142,240,.1)', color: '#3B8EF0', border: '1px solid rgba(59,142,240,.2)' }}>{h.segmentLabel}</span>
                    <span style={{ fontSize: 10, color: '#8FB897' }}>{h.delivered.toLocaleString()} доставлено</span>
                    <span style={{ fontSize: 10, color: '#1FD760', fontWeight: 700 }}>{rate}% открыли</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{
            padding: '14px 16px', borderRadius: 14,
            background: 'rgba(59,142,240,.06)', border: '1px solid rgba(59,142,240,.18)',
            fontSize: 11, color: '#8FB897', lineHeight: 1.55,
          }}>
            <strong style={{ color: '#3B8EF0' }}>Как это работает:</strong> рассылки и авто-push сохраняются в приложении клиента (экран «Уведомления»). Авто-события срабатывают при смене статуса заказа в админке, курьере и сборщике, а также при начислении бонусов на карту.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── ФИНАНСЫ ────────────────────────────────────── */
function FinancePage() {
  const apiOrders = useOrders(s => s.orders)
  const apiRests = useRestaurants(s => s.restaurants)
  const fetchRestaurants = useRestaurants(s => s.fetchRestaurants)
  const couriers = useCourierTeam()
  const assemblers = useAssemblerTeam()
  const pricing = usePricingStore(s => s.pricing)
  const { roadKm } = useOrderRoadKm(apiOrders)

  const [tab, setTab] = useState<FinanceTab>('shop')
  const [payouts, setPayouts] = useState<any[]>([])
  const [localRests, setLocalRests] = useState(() => RESTAURANTS.map(r => ({ ...r, paidRevenueMonth: r.paidRevenueMonth ?? 0 })))
  const [payTarget, setPayTarget] = useState<any>(null)
  const [payMethod, setPayMethod] = useState('cash')
  const [payNote, setPayNote] = useState('')
  const [paySaving, setPaySaving] = useState(false)
  const [payDone, setPayDone] = useState(false)
  const [payError, setPayError] = useState('')
  const [toast, setToast] = useState('')

  const orders = useMemo(
    () => prepareOrdersForFinance(USE_API ? apiOrders : [], USE_API ? undefined : ALL_ORDERS),
    [apiOrders],
  )
  const restaurants = useMemo(() => {
    if (USE_API && apiRests.length) return enrichRestaurants(apiRests, RESTAURANTS)
    return localRests
  }, [apiRests, localRests])

  useEffect(() => {
    if (USE_API) {
      void api.getPayouts().then(setPayouts).catch(() => setPayouts([]))
    }
  }, [payDone])

  const summary = useMemo(
    () => buildFinanceSummary(orders, restaurants, couriers, assemblers, roadKm, pricing || DEFAULT_PRICING, payouts),
    [orders, restaurants, couriers, assemblers, roadKm, pricing, payouts],
  )

  const maxChart = Math.max(1, ...summary.dailyChart.map(d => d.shop + d.restaurant))

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  const openPayout = (r: any) => {
    setPayTarget(r)
    setPayMethod('cash')
    setPayNote('')
    setPayDone(false)
    setPayError('')
  }

  const confirmPayout = async () => {
    if (!payTarget || paySaving) return
    const bal = restaurantBalance(payTarget)
    if (bal.pendingNet <= 0) return
    setPaySaving(true)
    setPayError('')
    try {
      if (USE_API) {
        const result = await api.createPayout(payTarget.id, { method: payMethod, note: payNote })
        await fetchRestaurants()
        const history = await api.getPayouts()
        setPayouts(history)
        setPayTarget({ ...payTarget, ...result.restaurant })
      } else {
        const updated = { revenueMonth: 0, paidRevenueMonth: 0, ordersMonth: 0 }
        setLocalRests(rs => rs.map(r => r.id === payTarget.id ? { ...r, ...updated } : r))
        setPayouts(h => [{
          id: Date.now(),
          restId: payTarget.id,
          restName: payTarget.name,
          emoji: payTarget.emoji,
          amount: bal.pendingNet,
          commission: bal.pendingCommission,
          commissionPct: payTarget.commission,
          revenue: bal.pendingGross,
          method: payMethod,
          note: payNote,
          date: new Date().toLocaleString('ru-RU'),
        }, ...h])
      }
      setPayDone(true)
      showToast(`✅ Выплата ${payTarget.name.split(' ')[0]} — ${formatSm(bal.pendingNet)}`)
    } catch (e: any) {
      setPayError(e?.message || 'Ошибка выплаты')
    } finally {
      setPaySaving(false)
    }
  }

  const exportExcel = () => {
    if (tab === 'restaurants') {
      downloadCsv('kakapo-finance-restaurants.csv',
        ['Ресторан', 'Выручка', 'Комиссия %', 'КАКАПО получает', 'К выплате', 'Заказов'],
        summary.restaurants.map(r => [
          r.name, r.balance.totalGross, r.commission,
          r.balance.pendingCommission + r.balance.paidCommission,
          r.balance.pendingNet, r.ordersMonth,
        ]))
    } else if (tab === 'couriers') {
      downloadCsv('kakapo-finance-couriers.csv',
        ['Курьер', 'Доставок', 'Заработок ЅМ', 'Рейтинг'],
        summary.couriers.map(c => [c.name, c.deliveries, c.earnings, c.rating]))
    } else if (tab === 'assemblers') {
      downloadCsv('kakapo-finance-assemblers.csv',
        ['Сборщик', 'Собрано', 'Заработок ЅМ', 'Ср. время'],
        summary.assemblers.map(a => [a.name, a.assembled, a.earnings, `${a.avgTimeMin} мин`]))
    } else {
      downloadCsv('kakapo-finance-shop.csv',
        ['День', 'Магазин ЅМ', 'Рестораны ЅМ', 'Итого ЅМ'],
        summary.dailyChart.map(d => [d.label, d.shop, d.restaurant, d.total]))
    }
    showToast('📊 Excel файл скачан')
  }

  const exportPdf = () => {
    let rows = ''
    if (tab === 'restaurants') {
      rows = `<table><thead><tr><th>Ресторан</th><th>Выручка</th><th>%</th><th>КАКАПО</th><th>К выплате</th></tr></thead><tbody>${
        summary.restaurants.map(r => `<tr><td>${r.emoji} ${r.name}</td><td>${formatSm(r.balance.totalGross)}</td><td>${r.commission}%</td><td>${formatSm(r.balance.pendingCommission + r.balance.paidCommission)}</td><td>${formatSm(r.balance.pendingNet)}</td></tr>`).join('')
      }</tbody></table>`
    } else if (tab === 'couriers') {
      rows = `<table><thead><tr><th>Курьер</th><th>Доставок</th><th>Заработок</th></tr></thead><tbody>${
        summary.couriers.map(c => `<tr><td>${c.name}</td><td>${c.deliveries}</td><td>${formatSm(c.earnings)}</td></tr>`).join('')
      }</tbody></table>`
    } else if (tab === 'assemblers') {
      rows = `<table><thead><tr><th>Сборщик</th><th>Заказов</th><th>Заработок</th></tr></thead><tbody>${
        summary.assemblers.map(a => `<tr><td>${a.name}</td><td>${a.assembled}</td><td>${formatSm(a.earnings)}</td></tr>`).join('')
      }</tbody></table>`
    } else {
      rows = `<p>Выручка: ${formatSm(summary.shop.revenue)} · Заказов: ${summary.shop.orders} · Средний чек: ${formatSm(summary.shop.avgCheck)}</p>
      <table><thead><tr><th>День</th><th>Магазин</th><th>Рестораны</th></tr></thead><tbody>${
        summary.dailyChart.map(d => `<tr><td>${d.label}</td><td>${formatSm(d.shop)}</td><td>${formatSm(d.restaurant)}</td></tr>`).join('')
      }</tbody></table>`
    }
    printFinanceReport(`КАКАПО — Финансы (${FINANCE_TAB_OPTIONS.find(t => t.id === tab)?.label})`, rows)
  }

  const statCards = tab === 'shop' ? [
    { l: 'Выручка магазина', v: formatSm(summary.shop.revenue), c: '#1FD760', e: '🛒' },
    { l: 'Заказов доставлено', v: summary.shop.orders, c: '#3B8EF0', e: '📦' },
    { l: 'Средний чек', v: formatSm(summary.shop.avgCheck), c: '#00D4C8', e: '🧾' },
    { l: 'Доставка (сбор)', v: formatSm(summary.shop.deliveryFees), c: '#FFB800', e: '🛵' },
  ] : tab === 'restaurants' ? [
    { l: 'Рестораны/мес', v: formatSm(summary.restaurantGross), c: '#FF8C00', e: '🍽' },
    { l: 'Комиссия КАКАПО', v: formatSm(summary.restaurantCommission), c: '#FFB800', e: '💰' },
    { l: 'К выплате', v: formatSm(summary.restaurantPendingNet), c: '#1FD760', e: '💸' },
    { l: 'Итого оборот', v: formatSm(summary.totalTurnover), c: '#3B8EF0', e: '📈' },
  ] : tab === 'couriers' ? [
    { l: 'Курьеров', v: summary.couriers.length, c: '#3B8EF0', e: '🛵' },
    { l: 'Доставок', v: summary.couriers.reduce((s, c) => s + c.deliveries, 0), c: '#1FD760', e: '📦' },
    { l: 'Выплаты курьерам', v: formatSm(summary.couriers.reduce((s, c) => s + c.earnings, 0)), c: '#FFB800', e: '💰' },
    { l: 'Ср. за доставку', v: formatSm(summary.couriers.length ? Math.round(summary.couriers.reduce((s, c) => s + c.earnings, 0) / Math.max(1, summary.couriers.reduce((s, c) => s + c.deliveries, 0))) : 0), c: '#9B6DFF', e: '📊' },
  ] : [
    { l: 'Сборщиков', v: summary.assemblers.length, c: '#9B6DFF', e: '📦' },
    { l: 'Собрано заказов', v: summary.assemblers.reduce((s, a) => s + a.assembled, 0), c: '#1FD760', e: '🛒' },
    { l: 'Выплаты сборщикам', v: formatSm(summary.assemblers.reduce((s, a) => s + a.earnings, 0)), c: '#FFB800', e: '💰' },
    { l: 'За заказ', v: '3 ЅМ', c: '#3B8EF0', e: '🧾' },
  ]

  return (
    <div>
      {toast && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999, padding: '12px 18px', borderRadius: 12, background: 'rgba(31,215,96,.15)', border: '1px solid rgba(31,215,96,.35)', color: '#1FD760', fontSize: 13, fontWeight: 700, boxShadow: '0 8px 32px rgba(0,0,0,.4)' }}>
          {toast}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {FINANCE_TAB_OPTIONS.map(t => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} className="ab"
            style={{ padding: '8px 14px', fontSize: 12, background: tab === t.id ? 'rgba(31,215,96,.12)' : '#0C1C0F', border: `1.5px solid ${tab === t.id ? 'rgba(31,215,96,.35)' : '#162B1A'}`, color: tab === t.id ? '#1FD760' : '#8FB897', display: 'flex', alignItems: 'center', gap: 6 }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 22 }}>
        {statCards.map((s, i) => <StatCard key={i} l={s.l} v={s.v} c={s.c} e={s.e} />)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 18, marginBottom: 16 }}>
        <div className="ac" style={{ padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <div className="ub" style={{ fontSize: 14, fontWeight: 800 }}>Выручка по дням</div>
            <div style={{ display: 'flex', gap: 12 }}>
              {[{ c: '#1FD760', l: 'Магазин' }, { c: '#FF8C00', l: 'Рестораны' }].map((l, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: l.c }} />
                  <span style={{ fontSize: 11, color: '#8FB897' }}>{l.l}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 5, alignItems: 'flex-end', height: 120 }}>
            {summary.dailyChart.map((d, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ width: '100%', borderRadius: '3px 3px 0 0', background: '#1FD760', height: `${Math.round(d.shop / maxChart * 90)}px`, opacity: .85, minHeight: d.shop ? 2 : 0 }} />
                  <div style={{ width: '100%', borderRadius: '3px 3px 0 0', background: '#FF8C00', height: `${Math.round(d.restaurant / maxChart * 60)}px`, opacity: .85, minHeight: d.restaurant ? 2 : 0 }} />
                </div>
                <div style={{ fontSize: 9, color: '#3D6645' }}>{d.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tab === 'restaurants' && (
            <div className="ac" style={{ padding: 16 }}>
              <div className="ub" style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>Выплаты ресторанам</div>
              {summary.restaurants.filter(r => r.balance.pendingNet > 0).map(r => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #162B1A' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ fontSize: 16 }}>{r.emoji}</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{r.name.split(' ')[0]}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="ub" style={{ fontSize: 11, fontWeight: 700, color: '#FFB800' }}>{formatSm(r.balance.pendingNet)}</span>
                    <button type="button" onClick={() => openPayout(restaurants.find(x => x.id === r.id) || r)} className="ab"
                      style={{ padding: '3px 8px', fontSize: 10, background: 'rgba(255,184,0,.1)', border: '1px solid rgba(255,184,0,.3)', color: '#FFB800' }}>Выплатить</button>
                  </div>
                </div>
              ))}
              {!summary.restaurants.some(r => r.balance.pendingNet > 0) && (
                <div style={{ fontSize: 12, color: '#3D6645', padding: '12px 0' }}>Все выплаты закрыты ✓</div>
              )}
            </div>
          )}

          {tab === 'couriers' && (
            <div className="ac" style={{ padding: 16 }}>
              <div className="ub" style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>Заработок курьеров</div>
              {summary.couriers.slice(0, 5).map(c => (
                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #162B1A' }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>🛵 {c.name.split(' ')[0]}</span>
                  <span className="ub" style={{ fontSize: 11, color: '#3B8EF0', fontWeight: 700 }}>{formatSm(c.earnings)}</span>
                </div>
              ))}
              <Link href="/courier" style={{ display: 'block', marginTop: 10, fontSize: 11, color: '#1FD760', fontWeight: 700, textDecoration: 'none' }}>→ Открыть приложение курьера</Link>
            </div>
          )}

          {tab === 'assemblers' && (
            <div className="ac" style={{ padding: 16 }}>
              <div className="ub" style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>Заработок сборщиков</div>
              {summary.assemblers.slice(0, 5).map(a => (
                <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #162B1A' }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>📦 {a.name.split(' ')[0]}</span>
                  <span className="ub" style={{ fontSize: 11, color: '#9B6DFF', fontWeight: 700 }}>{formatSm(a.earnings)}</span>
                </div>
              ))}
              <Link href="/assembler" style={{ display: 'block', marginTop: 10, fontSize: 11, color: '#1FD760', fontWeight: 700, textDecoration: 'none' }}>→ Открыть приложение сборщика</Link>
            </div>
          )}

          {tab === 'shop' && (
            <div className="ac" style={{ padding: 16 }}>
              <div className="ub" style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>Связанные приложения</div>
              {[
                { href: '/store', icon: '🛒', label: 'Магазин — заказы клиентов' },
                { href: '/restaurant', icon: '🍽', label: 'Кабинет ресторана — выручка' },
                { href: '/courier', icon: '🛵', label: 'Курьер — доставки' },
                { href: '/assembler', icon: '📦', label: 'Сборщик — сбор заказов' },
              ].map(l => (
                <Link key={l.href} href={l.href} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid #162B1A', fontSize: 12, color: '#8FB897', textDecoration: 'none' }}>
                  <span>{l.icon}</span><span>{l.label}</span><span style={{ marginLeft: 'auto', color: '#1FD760' }}>→</span>
                </Link>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={exportExcel} className="ab abg" style={{ flex: 1, padding: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>📊 Excel</button>
            <button type="button" onClick={exportPdf} className="ab abg" style={{ flex: 1, padding: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>📄 PDF</button>
          </div>
        </div>
      </div>

      <div className="ac" style={{ marginBottom: 16 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #162B1A', fontWeight: 800, fontSize: 13 }}>
          {tab === 'restaurants' ? 'Детализация комиссий' : tab === 'couriers' ? 'Детализация курьеров' : tab === 'assemblers' ? 'Детализация сборщиков' : 'Доставленные заказы магазина'}
        </div>
        {tab === 'restaurants' && (
          <table className="at">
            <thead><tr><th>Ресторан</th><th>Выручка</th><th>%</th><th>КАКАПО получает</th><th>К выплате</th><th></th></tr></thead>
            <tbody>{summary.restaurants.map(r => (
              <tr key={r.id}>
                <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontSize: 18 }}>{r.emoji}</span><span style={{ fontWeight: 700 }}>{r.name}</span></div></td>
                <td><span className="ub" style={{ fontSize: 12 }}>{formatSm(r.balance.totalGross)}</span></td>
                <td><Badge v={`${r.commission}%`} c="#FF4545" /></td>
                <td><span className="ub" style={{ fontSize: 12, color: '#1FD760', fontWeight: 900 }}>{formatSm(r.balance.pendingCommission + r.balance.paidCommission)}</span></td>
                <td><span className="ub" style={{ fontSize: 12, fontWeight: 700 }}>{formatSm(r.balance.pendingNet)}</span></td>
                <td>{r.balance.pendingNet > 0 && (
                  <button type="button" onClick={() => openPayout(restaurants.find(x => x.id === r.id) || r)} className="ab"
                    style={{ padding: '4px 10px', fontSize: 10, background: 'rgba(255,184,0,.1)', border: '1px solid rgba(255,184,0,.3)', color: '#FFB800' }}>Выплатить</button>
                )}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {tab === 'couriers' && (
          <table className="at">
            <thead><tr><th>Курьер</th><th>Транспорт</th><th>Доставок</th><th>Заработок</th><th>Рейтинг</th></tr></thead>
            <tbody>{summary.couriers.map(c => (
              <tr key={c.id}>
                <td style={{ fontWeight: 700 }}>🛵 {c.name}</td>
                <td>{vehicleLabel(c.vehicle as any)}</td>
                <td>{c.deliveries}</td>
                <td><span className="ub" style={{ color: '#3B8EF0', fontWeight: 800 }}>{formatSm(c.earnings)}</span></td>
                <td>⭐ {c.rating}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {tab === 'assemblers' && (
          <table className="at">
            <thead><tr><th>Сборщик</th><th>Собрано</th><th>За заказ</th><th>Заработок</th><th>Ср. время</th></tr></thead>
            <tbody>{summary.assemblers.map(a => (
              <tr key={a.id}>
                <td style={{ fontWeight: 700 }}>📦 {a.name}</td>
                <td>{a.assembled}</td>
                <td>3 ЅМ</td>
                <td><span className="ub" style={{ color: '#9B6DFF', fontWeight: 800 }}>{formatSm(a.earnings)}</span></td>
                <td>{a.avgTimeMin} мин</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {tab === 'shop' && (
          <table className="at">
            <thead><tr><th>День</th><th>Магазин</th><th>Рестораны</th><th>Итого</th></tr></thead>
            <tbody>{summary.dailyChart.filter(d => d.total > 0).slice(-10).reverse().map(d => (
              <tr key={d.day}>
                <td>{d.label}</td>
                <td><span className="ub" style={{ color: '#1FD760' }}>{formatSm(d.shop)}</span></td>
                <td><span className="ub" style={{ color: '#FF8C00' }}>{formatSm(d.restaurant)}</span></td>
                <td><span className="ub" style={{ fontWeight: 800 }}>{formatSm(d.total)}</span></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      {summary.recentPayouts.length > 0 && (
        <div className="ac">
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #162B1A', fontWeight: 800, fontSize: 13 }}>История выплат ресторанам</div>
          <table className="at">
            <thead><tr><th>Дата</th><th>Ресторан</th><th>Сумма</th><th>Комиссия</th><th>Способ</th></tr></thead>
            <tbody>{summary.recentPayouts.slice(0, 8).map(p => (
              <tr key={p.id}>
                <td style={{ fontSize: 12, color: '#8FB897' }}>{p.date}</td>
                <td>{p.emoji} {p.restName}</td>
                <td><span className="ub" style={{ color: '#1FD760', fontWeight: 800 }}>{formatSm(p.amount)}</span></td>
                <td style={{ color: '#FFB800' }}>{formatSm(p.commission)}</td>
                <td>{p.method === 'cash' ? '💵 Наличные' : p.method === 'card' ? '💳 Карта' : p.method}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {payTarget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => !paySaving && setPayTarget(null)}>
          <div className="ac" style={{ width: '100%', maxWidth: 420, padding: 24 }} onClick={e => e.stopPropagation()}>
            {payDone ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
                <div className="ub" style={{ fontSize: 16, fontWeight: 900, color: '#1FD760', marginBottom: 8 }}>Выплата проведена</div>
                <div style={{ fontSize: 13, color: '#8FB897', marginBottom: 20 }}>{payTarget.name} · {formatSm(restaurantBalance(payTarget).pendingNet)}</div>
                <button type="button" onClick={() => setPayTarget(null)} className="ab abp" style={{ width: '100%', padding: 12 }}>Закрыть</button>
              </div>
            ) : (
              <>
                <div className="ub" style={{ fontSize: 16, fontWeight: 900, marginBottom: 4 }}>Выплата ресторану</div>
                <div style={{ fontSize: 13, color: '#8FB897', marginBottom: 16 }}>{payTarget.emoji} {payTarget.name}</div>
                <div style={{ padding: 14, borderRadius: 12, background: 'rgba(255,184,0,.08)', border: '1px solid rgba(255,184,0,.2)', marginBottom: 16, textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#8FB897' }}>К выплате (нетто)</div>
                  <div className="ub" style={{ fontSize: 28, fontWeight: 900, color: '#FFB800' }}>{formatSm(restaurantBalance(payTarget).pendingNet)}</div>
                  <div style={{ fontSize: 11, color: '#3D6645', marginTop: 4 }}>Комиссия КАКАПО: {formatSm(restaurantBalance(payTarget).pendingCommission)}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  {[{ id: 'cash', l: '💵 Наличные' }, { id: 'card', l: '💳 Карта' }, { id: 'transfer', l: '🏦 Перевод' }].map(m => (
                    <button key={m.id} type="button" onClick={() => setPayMethod(m.id)} className="ab"
                      style={{ flex: 1, padding: 10, fontSize: 11, background: payMethod === m.id ? 'rgba(31,215,96,.12)' : '#0C1C0F', border: `1px solid ${payMethod === m.id ? 'rgba(31,215,96,.35)' : '#162B1A'}`, color: payMethod === m.id ? '#1FD760' : '#8FB897' }}>{m.l}</button>
                  ))}
                </div>
                <textarea className="ai" placeholder="Комментарий (необязательно)" value={payNote} onChange={e => setPayNote(e.target.value)} rows={2} style={{ width: '100%', marginBottom: 12, resize: 'none' }} />
                {payError && <div style={{ fontSize: 12, color: '#FF4545', marginBottom: 10 }}>{payError}</div>}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button type="button" onClick={() => setPayTarget(null)} className="ab" style={{ flex: 1, padding: 12, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897' }}>Отмена</button>
                  <button type="button" onClick={confirmPayout} disabled={paySaving || restaurantBalance(payTarget).pendingNet <= 0} className="ab abp"
                    style={{ flex: 2, padding: 12, opacity: paySaving ? .7 : 1 }}>{paySaving ? '⏳…' : '✅ Подтвердить выплату'}</button>
                </div>
                <Link href="/restaurant" style={{ display: 'block', textAlign: 'center', marginTop: 14, fontSize: 11, color: '#FF8C00', textDecoration: 'none' }}>→ Кабинет ресторана увидит обновлённую выручку</Link>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── НАСТРОЙКИ ──────────────────────────────────── */
const DEFAULT_STORE_INFO = {
  name: 'КАКАПО',
  city: 'г. Яван, Таджикистан',
  address: 'ул. Ленина, 42',
  phone1: '+992 118 55-97-97',
  phone2: '+992 553 55-98-98',
  email: 'kakapo.tj@gmail.com',
  telegram: '@kakapo_tj',
  hours: '08:00 – 23:00',
}

const SETTINGS_QUICK_LINKS = [
  { id: 'tariff', icon: '🚚', label: 'Тариф доставки', sub: 'Цены · км · курьеры · OSRM', color: '#3B8EF0' },
  { id: 'cards', icon: '💳', label: 'Карты лояльности', sub: 'КАКАПО-XXXX · бонусы · долги', color: '#FFB800' },
  { id: 'pickups', icon: '📍', label: 'Точки забора', sub: 'Магазин и рестораны · GPS', color: '#1FD760' },
  { id: 'push', icon: '🔔', label: 'Push уведомления', sub: 'Рассылки клиентам', color: '#9B6DFF' },
]

function SettingsPage({ setPage }: { setPage: (p: string) => void }) {
  const [stab, setStab] = useState('gbs')
  const [gbsOn, setGbsOn] = useState(false)
  const [gbsIP, setGbsIP] = useState('http://192.168.1.100')
  const [gbsPort, setGbsPort] = useState('8419')
  const [gbsUser, setGbsUser] = useState('admin')
  const [gbsPass, setGbsPass] = useState('')
  const [testSt, setTestSt] = useState('')
  const [smsP, setSmsP] = useState('smspro')
  const [smsKey, setSmsKey] = useState('')
  const [storeInfo, setStoreInfo] = useState(DEFAULT_STORE_INFO)
  const [saved, setSaved] = useState(false)
  const [saveErr, setSaveErr] = useState('')

  useEffect(() => {
    try {
      const gbs = localStorage.getItem('kakapo_admin_gbs')
      if (gbs) {
        const p = JSON.parse(gbs)
        if (typeof p.enabled === 'boolean') setGbsOn(p.enabled)
        if (p.ip) setGbsIP(p.ip)
        if (p.port) setGbsPort(p.port)
        if (p.user) setGbsUser(p.user)
        if (p.pass) setGbsPass(p.pass)
      }
      const sms = localStorage.getItem('kakapo_admin_sms')
      if (sms) {
        const p = JSON.parse(sms)
        if (p.provider) setSmsP(p.provider)
        if (p.apiKey) setSmsKey(p.apiKey)
      }
      const store = localStorage.getItem('kakapo_admin_store')
      if (store) setStoreInfo({ ...DEFAULT_STORE_INFO, ...JSON.parse(store) })
    } catch { /* private mode */ }
  }, [])

  const saveAll = async () => {
    try {
      localStorage.setItem('kakapo_admin_gbs', JSON.stringify({
        enabled: gbsOn, ip: gbsIP, port: gbsPort, user: gbsUser, pass: gbsPass,
      }))
      localStorage.setItem('kakapo_admin_sms', JSON.stringify({ provider: smsP, apiKey: smsKey }))
      localStorage.setItem('kakapo_admin_store', JSON.stringify(storeInfo))
      setSaveErr('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setSaveErr('Не удалось сохранить настройки')
    }
  }

  const testConn = async () => {
    setTestSt('loading')
    setSaveErr('')
    try {
      if (USE_API && gbsOn) await api.syncGBS()
      else await new Promise(r => setTimeout(r, 1200))
      setTestSt('ok')
      setTimeout(() => setTestSt(''), 5000)
    } catch {
      setTestSt('err')
      setTimeout(() => setTestSt(''), 4000)
    }
  }

  const STABS = [
    { id: 'gbs', l: '🔗 GBS Market' },
    { id: 'sms', l: '💬 SMS / OTP' },
    { id: 'store', l: '🏪 Контакты' },
  ]

  const patchStore = (key: keyof typeof DEFAULT_STORE_INFO, val: string) => {
    setStoreInfo(s => ({ ...s, [key]: val }))
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
        {SETTINGS_QUICK_LINKS.map(link => (
          <button key={link.id} type="button" onClick={() => setPage(link.id)} className="btn ac"
            style={{ padding: '14px 12px', textAlign: 'left', cursor: 'pointer', background: '#091508', border: `1px solid ${link.color}28` }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>{link.icon}</div>
            <div className="ub" style={{ fontSize: 12, fontWeight: 800, color: link.color, marginBottom: 3 }}>{link.label}</div>
            <div style={{ fontSize: 10, color: '#3D6645', lineHeight: 1.4 }}>{link.sub}</div>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        {STABS.map(t => (
          <button key={t.id} type="button" onClick={() => setStab(t.id)} className="ab"
            style={{
              padding: '8px 14px', fontSize: 12,
              background: stab === t.id ? 'rgba(31,215,96,.12)' : '#0C1C0F',
              border: `1.5px solid ${stab === t.id ? 'rgba(31,215,96,.35)' : '#162B1A'}`,
              color: stab === t.id ? '#1FD760' : '#8FB897',
            }}>
            {t.l}
          </button>
        ))}
        <button type="button" onClick={saveAll} className="ab abp" style={{ marginLeft: 'auto', padding: '8px 16px' }}>
          {saved ? '✓ Сохранено!' : '💾 Сохранить'}
        </button>
      </div>

      {saveErr && (
        <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,69,69,.08)', border: '1px solid rgba(255,69,69,.25)', fontSize: 12, color: '#FF4545' }}>
          {saveErr}
        </div>
      )}

      {stab==='gbs'&&(
        <div style={{display:'grid',gridTemplateColumns:'1.3fr 1fr',gap:18}}>
          <div className="ac" style={{padding:20}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
              <div className="ub" style={{fontSize:14,fontWeight:800}}>JSON API · GBS Market</div>
              <div style={{display:'flex',alignItems:'center',gap:10}}><span style={{fontSize:12,color:gbsOn?'#1FD760':'#3D6645',fontWeight:700}}>{gbsOn?'Активно':'Выкл.'}</span><Tog on={gbsOn} set={() => setGbsOn(v => !v)}/></div>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 90px',gap:10}}><NI lbl="IP адрес кассы" val={gbsIP} set={setGbsIP} ph="http://192.168.1.100"/><NI lbl="Порт" val={gbsPort} set={setGbsPort} ph="8419"/></div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}><NI lbl="Логин" val={gbsUser} set={setGbsUser}/><NI lbl="Пароль" val={gbsPass} set={setGbsPass} type="password" ph="••••••••••••"/></div>
            </div>
            <button type="button" onClick={testConn} className="ab" style={{width:'100%',marginTop:14,padding:11,background:'rgba(59,142,240,.1)',border:'1.5px solid rgba(59,142,240,.3)',color:'#3B8EF0',display:'flex',alignItems:'center',justifyContent:'center',gap:8,fontSize:13}}>
              {testSt==='loading'?<><div style={{width:16,height:16,borderRadius:'50%',border:'2px solid rgba(59,142,240,.3)',borderTopColor:'#3B8EF0',animation:'spin 1s linear infinite'}}/>Проверка...</>:testSt==='ok'?'✅ Соединение установлено!':testSt==='err'?'❌ Не удалось подключиться':'🔌 Проверить соединение'}
            </button>
            <div style={{marginTop:12,fontSize:11,color:'#3D6645'}}>
              Синхронизация товаров: <button type="button" onClick={() => setPage('products')} className="btn" style={{background:'none',border:'none',color:'#1FD760',fontWeight:700,cursor:'pointer',padding:0,fontSize:11}}>Товары → Синх. GBS</button>
            </div>
          </div>
          <div style={{padding:'14px 16px',borderRadius:14,background:'rgba(31,215,96,.05)',border:'1px solid rgba(31,215,96,.2)'}}>
            <div className="ub" style={{fontSize:12,fontWeight:800,color:'#1FD760',marginBottom:10}}>📋 Инструкция GBS Market</div>
            {['1. Откройте GBS Market на кассовом компьютере','2. Настройки → Интеграции → API','3. Поставить ✓ "Активировать JSON API"','4. Скопируйте IP кассы','5. Вставьте IP выше и нажмите "Проверить"','6. Включите тумблер — начнётся синхронизация','','Синхронизируется:','• Товары по артикулу KAK-XXXX','• Продажи по карте КАКАПО-XXXX','• Долги VIP клиентов','• История покупок'].map((s,i)=><div key={i} style={{fontSize:11,color:s===''?undefined:s.startsWith('•')?'#FFB800':'#8FB897',marginBottom:4,lineHeight:1.5,fontWeight:s.startsWith('Синх')||s===''?700:400}}>{s}</div>)}
          </div>
        </div>
      )}

      {stab==='sms'&&(
        <div className="ac" style={{padding:20,maxWidth:520}}>
          <div className="ub" style={{fontSize:14,fontWeight:800,marginBottom:6}}>SMS провайдер (OTP)</div>
          <div style={{fontSize:11,color:'#3D6645',marginBottom:16}}>Для входа курьеров, сборщиков и партнёров. Тариф доставки — в разделе «Тариф доставки».</div>
          <div style={{display:'flex',gap:8,marginBottom:14}}>
            {[{id:'smspro',l:'🇹🇯 SmsPro.tj'},{id:'eskiz',l:'🇺🇿 Eskiz'},{id:'twilio',l:'🌍 Twilio'}].map(p=><button key={p.id} type="button" onClick={()=>setSmsP(p.id)} className="ab" style={{flex:1,padding:'9px 6px',fontSize:12,background:smsP===p.id?'rgba(31,215,96,.12)':'#0C1C0F',border:`1.5px solid ${smsP===p.id?'rgba(31,215,96,.35)':'#162B1A'}`,color:smsP===p.id?'#1FD760':'#8FB897'}}>{p.l}</button>)}
          </div>
          <NI lbl="API ключ" val={smsKey} set={setSmsKey} ph="Вставь ключ от провайдера" type="password"/>
          <div style={{marginTop:12,padding:'10px 13px',borderRadius:10,background:'rgba(59,142,240,.06)',border:'1px solid rgba(59,142,240,.2)',fontSize:12,color:'#8FB897'}}>Для Таджикистана рекомендуем <span style={{color:'#3B8EF0',fontWeight:700}}>SmsPro.tj</span> — поддержка русского и таджикского языка</div>
        </div>
      )}

      {stab==='store'&&(
        <div className="ac" style={{padding:20,maxWidth:520}}>
          <div className="ub" style={{fontSize:14,fontWeight:800,marginBottom:6}}>Контакты магазина</div>
          <div style={{fontSize:11,color:'#3D6645',marginBottom:16}}>Отображаются клиентам. Адреса точек забора — в разделе «Точки забора».</div>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <NI lbl="Название" val={storeInfo.name} set={v => patchStore('name', v)}/>
            <NI lbl="Город" val={storeInfo.city} set={v => patchStore('city', v)}/>
            <NI lbl="Адрес магазина" val={storeInfo.address} set={v => patchStore('address', v)}/>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <NI lbl="Телефон 1" val={storeInfo.phone1} set={v => patchStore('phone1', v)}/>
              <NI lbl="Телефон 2" val={storeInfo.phone2} set={v => patchStore('phone2', v)}/>
            </div>
            <NI lbl="Email" val={storeInfo.email} set={v => patchStore('email', v)}/>
            <NI lbl="Telegram" val={storeInfo.telegram} set={v => patchStore('telegram', v)}/>
            <NI lbl="Время работы" val={storeInfo.hours} set={v => patchStore('hours', v)}/>
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
        {[{l:'Выручка магазин/день',v:'3 580 ЅМ',c:'#1FD760',e:'🛒'},{l:'Выручка рестораны/мес',v:`${totalRestRev.toLocaleString()} ЅМ`,c:'#FF8C00',e:'🍽'},{l:'Комиссия КАКАПО',v:`${totalComm.toLocaleString()} ЅМ`,c:'#FFB800',e:'💰'},{l:'Клиентов всего',v:'1 847',c:'#00D4C8',e:'👥'}].map((s,i)=>(
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

/* ── BANNERS ─────────────────────────────────────── */
/* ── ТАРИФ ДОСТАВКИ ─────────────────────────────── */
function TariffPage() {
  const apiOrders = useOrders(s => s.orders)
  const couriers = useCourierTeam()
  const pricing = usePricingStore(s => s.pricing)
  const setPricing = usePricingStore(s => s.setPricing)
  const { roadKm } = useOrderRoadKm(apiOrders)

  const [tab, setTab] = useState<TariffTab>('shop')
  const [t, setT] = useState(() => normalizePricing({ ...DEFAULT_PRICING, ...pricing }))
  const [saved, setSaved] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [testDist, setTestDist] = useState('3.4')
  const [testWeight, setTestWeight] = useState('8.5')
  const [testAmount, setTestAmount] = useState('65')

  useEffect(() => {
    setT(normalizePricing({ ...DEFAULT_PRICING, ...pricing }))
  }, [pricing])

  const orders = useMemo(
    () => prepareOrdersForFinance(USE_API ? apiOrders : [], USE_API ? undefined : ALL_ORDERS),
    [apiOrders],
  )

  const stats = useMemo(() => buildTariffStats(orders, t, roadKm), [orders, t, roadKm])
  const courierStats = useMemo(() => courierTariffSummary(orders, couriers, t, roadKm), [orders, couriers, t, roadKm])
  const previews = useMemo(() => previewOrdersForTab(orders, t, roadKm, tab), [orders, t, roadKm, tab])

  const dist = parseFloat(testDist) || 0
  const weight = parseFloat(testWeight) || 0
  const amount = parseFloat(testAmount) || 0
  const preview = useMemo(() => calcPreview(t, dist, weight, amount), [t, dist, weight, amount])

  const dirty = JSON.stringify(t) !== JSON.stringify(normalizePricing({ ...DEFAULT_PRICING, ...pricing }))

  const save = async () => {
    const err = validatePricing(t)
    if (err) { setSaveErr(err); return }
    setSaving(true)
    setSaveErr('')
    try {
      const normalized = normalizePricing(t)
      if (USE_API) {
        const savedPricing = await api.updatePricing(normalized)
        usePricingStore.setState({ pricing: normalizePricing({ ...DEFAULT_PRICING, ...savedPricing }) })
        try {
          if (typeof BroadcastChannel !== 'undefined') {
            new BroadcastChannel('kakapo-pricing').postMessage({ type: 'update', pricing: savedPricing })
          }
        } catch { /* ignore */ }
      } else {
        setPricing(normalized)
      }
      setT(normalized)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e: any) {
      setSaveErr(e?.message || 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  const applyPreset = (config: typeof DEFAULT_PRICING) => {
    setT(normalizePricing(config))
    setSaveErr('')
  }

  const resetDefaults = () => {
    setT({ ...DEFAULT_PRICING })
    setSaveErr('')
  }

  const updateField = (key: keyof typeof t, raw: string) => {
    const num = parseFloat(raw)
    setT(v => ({ ...v, [key]: Number.isFinite(num) ? num : 0 }))
    setSaveErr('')
  }

  const tabColor = TARIFF_TAB_OPTIONS.find(x => x.id === tab)?.color || '#1FD760'

  return (
    <div>
      {/* вкладки */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {TARIFF_TAB_OPTIONS.map(opt => (
          <button key={opt.id} type="button" onClick={() => setTab(opt.id)} className="btn"
            style={{
              padding: '8px 14px', fontSize: 12, borderRadius: 12,
              background: tab === opt.id ? `${opt.color}18` : '#0C1C0F',
              border: `1.5px solid ${tab === opt.id ? `${opt.color}55` : '#162B1A'}`,
              color: tab === opt.id ? opt.color : '#8FB897',
              display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700,
            }}>
            {opt.icon} {opt.label}
          </button>
        ))}
      </div>

      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        <StatCard l="Базовая стоимость" v={`${t.base} ЅМ`} c="#1FD760" e="💰" />
        <StatCard l="Ср. доставка" v={formatSm(stats.avgDelivery)} c="#3B8EF0" e="📊" sub={`${stats.deliveredCount} заказов`} />
        <StatCard l="Бесплатных" v={stats.freeCount} c="#FFB800" e="🎁" sub={t.freeFrom ? `от ${t.freeFrom} ЅМ` : 'отключено'} />
        <StatCard l="Доход доставки" v={formatSm(stats.totalDeliveryRevenue)} c={tabColor} e="🛵" sub="доставленные" />
      </div>

      {/* формула */}
      <div style={{
        background: 'linear-gradient(135deg,rgba(59,142,240,.08),rgba(31,215,96,.06))',
        border: '1px solid rgba(59,142,240,.25)', borderRadius: 18, padding: '18px 20px', marginBottom: 20,
        fontSize: 13, color: '#8FB897', lineHeight: 1.75,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 22 }}>📐</span>
          <span className="ub" style={{ fontSize: 14, fontWeight: 800, color: '#3B8EF0' }}>Формула доставки КАКАПО</span>
        </div>
        Доставка = <b style={{ color: '#EBF5ED' }}>База ({t.base} ЅМ)</b> + (км − {t.baseDist}) × <b style={{ color: '#EBF5ED' }}>{t.perKm} ЅМ</b>
        {t.heavyExtra > 0 && <> + надбавка <b style={{ color: '#FFB800' }}>{t.heavyExtra} ЅМ</b> за груз &gt; {t.heavyKg} кг</>}
        {t.freeFrom ? <> · <b style={{ color: '#1FD760' }}>0 ЅМ</b> при заказе от {t.freeFrom} ЅМ</> : null}
        <div style={{ marginTop: 10, fontSize: 11, color: '#3D6645' }}>
          🔒 Доставленные заказы сохраняют стоимость навсегда. Новый тариф действует только на заказы после сохранения.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 18, marginBottom: 20 }}>
        {/* поля тарифа */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="ub" style={{ fontSize: 14, fontWeight: 800 }}>⚙️ Параметры тарифа</div>
            {dirty && <span style={{ fontSize: 10, color: '#FFB800', fontWeight: 700 }}>● есть изменения</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            {TARIFF_FIELD_META.map(f => (
              <div key={f.key} style={{
                background: 'linear-gradient(160deg,#091508,#0C1C0F)', border: '1px solid #162B1A',
                borderRadius: 16, padding: '16px 18px', transition: 'border-color .2s',
              }}>
                <div style={{ fontSize: 11, color: '#8FB897', fontWeight: 700, marginBottom: 6 }}>{f.label}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="number" step={f.step || 1} className="ai"
                    style={{ width: '100%', textAlign: 'center', fontSize: 20, fontWeight: 900, fontFamily: 'Unbounded, sans-serif' }}
                    value={t[f.key] ?? 0}
                    onChange={e => updateField(f.key, e.target.value)} />
                  <span style={{ fontSize: 12, color: '#3D6645', fontWeight: 700, whiteSpace: 'nowrap' }}>{f.unit}</span>
                </div>
                <div style={{ fontSize: 10, color: '#3D6645', marginTop: 8, lineHeight: 1.4 }}>{f.hint}</div>
              </div>
            ))}
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: '#8FB897', fontWeight: 700, marginBottom: 8 }}>⚡ Быстрые шаблоны</div>
            <div style={{ display: 'flex', gap: 10 }}>
              {TARIFF_PRESETS.map(p => (
                <button key={p.id} type="button" onClick={() => applyPreset(p.config)} className="btn"
                  style={{
                    flex: 1, padding: '12px 10px', borderRadius: 14, textAlign: 'left',
                    background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897',
                  }}>
                  <div style={{ fontSize: 18, marginBottom: 4 }}>{p.emoji}</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#EBF5ED' }}>{p.label}</div>
                  <div style={{ fontSize: 10, color: '#3D6645', marginTop: 2 }}>{p.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={resetDefaults} className="ab"
              style={{ flex: 1, padding: 12, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897' }}>
              ↩️ Сбросить
            </button>
            <button type="button" onClick={save} disabled={saving} className="ab abp"
              style={{ flex: 2, padding: 12, fontSize: 14, opacity: saving ? .7 : 1 }}>
              {saved ? '✓ Сохранено!' : saving ? '⏳ Сохраняем…' : '💾 Сохранить тариф'}
            </button>
          </div>
          {saveErr && <div style={{ marginTop: 10, fontSize: 12, color: '#FF4545' }}>{saveErr}</div>}
        </div>

        {/* калькулятор */}
        <div style={{
          background: 'linear-gradient(160deg,rgba(31,215,96,.06),#091508)',
          border: `1.5px solid rgba(31,215,96,.28)`, borderRadius: 20, padding: 20,
        }}>
          <div className="ub" style={{ fontSize: 14, fontWeight: 800, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            🧮 Калькулятор
          </div>
          <div style={{ fontSize: 11, color: '#3D6645', marginBottom: 16 }}>Проверьте тариф до сохранения</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {[
              { lbl: 'Расстояние (км)', val: testDist, set: setTestDist, ph: '3.4' },
              { lbl: 'Вес заказа (кг)', val: testWeight, set: setTestWeight, ph: '8.5' },
              { lbl: 'Сумма заказа (ЅМ)', val: testAmount, set: setTestAmount, ph: '65' },
            ].map(f => (
              <div key={f.lbl}>
                <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 4, fontWeight: 700 }}>{f.lbl}</div>
                <input type="number" className="ai" value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.ph} />
              </div>
            ))}
          </div>

          <div style={{ background: '#06100A', borderRadius: 14, padding: '14px 16px', marginBottom: 14 }}>
            {preview.breakdown.map((line, i) => (
              <div key={i} style={{ fontSize: 12, color: line.startsWith('✅') ? '#1FD760' : '#8FB897', marginBottom: 5 }}>{line}</div>
            ))}
            <div style={{
              borderTop: '1px dashed rgba(31,215,96,.35)', paddingTop: 12, marginTop: 8,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: '#1FD760' }}>
                {preview.isFree ? '🎁 Бесплатно' : '💵 Итого'}
              </span>
              <span className="ub" style={{ fontSize: 26, fontWeight: 900, color: preview.isFree ? '#1FD760' : '#1FD760' }}>
                {preview.full.total} ЅМ
              </span>
            </div>
            {!preview.isFree && preview.feeOnly !== preview.full.total && (
              <div style={{ fontSize: 10, color: '#3D6645', marginTop: 6 }}>Без учёта суммы заказа: {preview.feeOnly} ЅМ</div>
            )}
          </div>

          {tab === 'couriers' && (
            <div style={{ padding: 12, borderRadius: 12, background: 'rgba(59,142,240,.08)', border: '1px solid rgba(59,142,240,.2)', fontSize: 12, color: '#8FB897' }}>
              🛵 Курьер получит ≈ <b style={{ color: '#3B8EF0' }}>{preview.full.total} ЅМ</b> за эту доставку
            </div>
          )}
        </div>
      </div>

      {/* контекст вкладки + связи */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 20 }}>
        <div className="ac" style={{ padding: 18 }}>
          <div className="ub" style={{ fontSize: 13, fontWeight: 800, marginBottom: 12, color: tabColor }}>
            {TARIFF_TAB_OPTIONS.find(x => x.id === tab)?.icon} Контекст: {TARIFF_TAB_OPTIONS.find(x => x.id === tab)?.label}
          </div>
          {tab === 'shop' && (
            <div style={{ fontSize: 12, color: '#8FB897', lineHeight: 1.7 }}>
              Клиент в <b style={{ color: '#1FD760' }}>магазине</b> видит стоимость доставки при выборе адреса на карте (OSRM).
              Тариф применяется к заказам типа market и mixed.
            </div>
          )}
          {tab === 'restaurants' && (
            <div style={{ fontSize: 12, color: '#8FB897', lineHeight: 1.7 }}>
              В <b style={{ color: '#FF8C00' }}>ресторанах</b> deliveryFee добавляется к сумме блюд. Комиссия КАКАПО считается отдельно в разделе Финансы.
            </div>
          )}
          {tab === 'couriers' && (
            <div style={{ fontSize: 12, color: '#8FB897', lineHeight: 1.7 }}>
              <b style={{ color: '#3B8EF0' }}>{courierStats.activeCouriers}</b> курьеров онлайн ·
              <b style={{ color: '#3B8EF0' }}> {courierStats.deliveries}</b> доставок ·
              заработок <b style={{ color: '#FFB800' }}>{formatSm(courierStats.totalEarnings)}</b>
              (≈ {formatSm(courierStats.avgPerDelivery)} / заказ)
            </div>
          )}
          {tab === 'assemblers' && (
            <div style={{ fontSize: 12, color: '#8FB897', lineHeight: 1.7 }}>
              Тариф доставки <b>не влияет</b> на сборщиков. Их оплата фиксирована — <b style={{ color: '#9B6DFF' }}>3 ЅМ</b> за собранный заказ магазина (см. Финансы).
            </div>
          )}
        </div>

        <div className="ac" style={{ padding: 18 }}>
          <div className="ub" style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>🔗 Связанные приложения</div>
          {TAB_CONNECTIONS[tab].map(link => (
            <Link key={link.href} href={link.href}
              style={{ display: 'block', padding: '10px 0', borderBottom: '1px solid #162B1A', textDecoration: 'none' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1FD760' }}>{link.label} →</div>
              <div style={{ fontSize: 10, color: '#3D6645', marginTop: 2 }}>{link.desc}</div>
            </Link>
          ))}
        </div>
      </div>

      {/* превью заказов */}
      <div className="ac">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #162B1A', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 800, fontSize: 13 }}>📋 Расчёт по реальным заказам</span>
          <span style={{ fontSize: 11, color: '#3D6645' }}>тариф: {t.base} + км × {t.perKm}</span>
        </div>
        <table className="at">
          <thead>
            <tr>
              <th>Заказ</th><th>Клиент</th><th>км</th><th>кг</th><th>Сумма</th><th>Доставка</th><th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {previews.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: '#3D6645', padding: 24 }}>Нет заказов для этой вкладки</td></tr>
            )}
            {previews.map(p => (
              <tr key={p.id}>
                <td><span className="ub" style={{ fontSize: 11, fontWeight: 800 }}>{p.id}</span></td>
                <td style={{ fontSize: 12 }}>{p.client}</td>
                <td>{p.km}</td>
                <td>{p.weight}</td>
                <td>{formatSm(p.orderTotal)}</td>
                <td>
                  <span className="ub" style={{ fontWeight: 800, color: p.isFree ? '#1FD760' : '#FFB800' }}>
                    {p.isFree ? 'Бесплатно' : `${p.fee} ЅМ`}
                  </span>
                  {p.locked && <div style={{ fontSize: 9, color: '#3D6645', marginTop: 2 }}>🔒 зафиксировано</div>}
                </td>
                <td><Badge v={p.status === 'delivered' ? 'доставлен' : p.status} c={p.status === 'delivered' ? '#1FD760' : '#FFB800'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── ТОЧКИ ЗАБОРА ───────────────────────────────── */
function PickupsPage() {
  const list = usePickupStore(s => s.pickups);
  const setPickups = usePickupStore(s => s.setPickups);
  const updatePickup = usePickupStore(s => s.updatePickup);
  const [modal,  setModal]  = useState<any>(null);
  const [form,   setForm]   = useState<any>({});
  const [showMap, setShowMap] = useState(true);
  const [saveErr, setSaveErr] = useState('');
  const [mapConfirmed, setMapConfirmed] = useState(false);

  const storeList = list.filter(p => p.type === 'store');
  const restList  = list.filter(p => p.type === 'rest');

  const openAdd = () => {
    setForm({ e:'🏪', color:'#1FD760', type:'store', active:true, lat: STORE_LOCATION.lat, lng: STORE_LOCATION.lng });
    setSaveErr('');
    setShowMap(true);
    setMapConfirmed(false);
    setModal('add');
  };
  const openEdit = (p:any) => {
    if (p.type !== 'store') return;
    setForm({ ...p, lat: p.lat, lng: p.lng });
    setSaveErr('');
    setShowMap(true);
    setMapConfirmed(true);
    setModal('edit');
  };
  const closeModal = () => { setModal(null); setSaveErr(''); setShowMap(false); };

  const pickOnMap = (r: { lat: number; lng: number; address: string }) => {
    setForm((f: any) => ({
      ...f,
      lat: r.lat,
      lng: r.lng,
      addr: f.addr?.trim() ? f.addr : r.address,
    }));
    setMapConfirmed(true);
    setSaveErr('');
  };

  const save = () => {
    const lat = parseFloat(String(form.lat).replace(',', '.'));
    const lng = parseFloat(String(form.lng).replace(',', '.'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setSaveErr('Выберите точку на карте и нажмите «Подтвердить точку»');
      return;
    }
    if (!mapConfirmed) {
      setSaveErr('Нажмите «Подтвердить точку» на карте перед сохранением');
      return;
    }
    const patch = {
      ...form,
      type: 'store' as const,
      lat,
      lng,
      active: form.active !== false,
    };
    if (modal === 'add') {
      setPickups([...list, { ...patch, id: `store-${Date.now()}` }]);
    } else if (USE_API) {
      updatePickup(form.id, patch);
    } else {
      setPickups(list.map(p => (p.id === form.id ? { ...p, ...patch } : p)));
    }
    closeModal();
  };
  const del = (id:string) => setPickups(list.filter(p=>p.id!==id));
  const toggle = (id:string) => setPickups(list.map(p=>p.id===id?{...p,active:!p.active}:p));

  const FI = ({lbl,fld,ph='',type='text'}:{lbl:string,fld:string,ph?:string,type?:string}) => (
    <div><div style={{fontSize:11,color:'#8FB897',marginBottom:4,fontWeight:700}}>{lbl}</div>
      <input className="ai" type={type} placeholder={ph} value={form[fld]||''} onChange={e=>setForm((f:any)=>({...f,[fld]:e.target.value}))}/>
    </div>
  );

  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        <StatCard l="Всего точек" v={list.length}/>
        <StatCard l="Активных"   v={list.filter(p=>p.active).length}  c="#1FD760"/>
        <StatCard l="Магазинов"  v={storeList.length} c="#3B8EF0"/>
        <StatCard l="Ресторанов" v={restList.length}  c="#FFB800"/>
      </div>

      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <div style={{fontSize:12,color:'#8FB897'}}>🏪 Добавляйте только магазины · рестораны — в «Рестораны»</div>
        <button onClick={openAdd} className="ab abp" style={{display:'flex',alignItems:'center',gap:6}}>+ Добавить магазин</button>
      </div>

      <div className="ac" style={{marginBottom:16}}>
        <div style={{padding:'10px 14px',borderBottom:'1px solid #162B1A',fontWeight:800,fontSize:12}}>🏪 Магазины</div>
        <table className="at">
          <thead><tr><th>Точка</th><th>Тип</th><th>Адрес</th><th>Телефон</th><th>Координаты</th><th>Статус</th><th></th></tr></thead>
          <tbody>
            {storeList.length ? storeList.map(p=>(
              <tr key={p.id}>
                <td><div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:36,height:36,borderRadius:10,background:p.color+'22',border:`1.5px solid ${p.color}55`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>{p.e}</div>
                  <div><div style={{fontWeight:700,fontSize:13}}>{p.name}</div><div style={{fontSize:10,color:'#3D6645'}}>{p.id}</div></div>
                </div></td>
                <td><span style={{padding:'3px 8px',borderRadius:6,fontSize:11,fontWeight:700,background:'rgba(59,142,240,.12)',color:'#3B8EF0'}}>🏪 Магазин</span></td>
                <td style={{fontSize:12,color:'#8FB897'}}>{p.addr}</td>
                <td style={{fontSize:12,color:'#8FB897'}}>{p.phone}</td>
                <td style={{fontSize:11,color:'#3D6645',fontFamily:'monospace'}}>{p.lat.toFixed(4)}, {p.lng.toFixed(4)}</td>
                <td>
                  <button onClick={()=>toggle(p.id)} className="ab" style={{padding:'4px 10px',fontSize:11,background:p.active?'rgba(31,215,96,.1)':'rgba(61,102,69,.1)',color:p.active?'#1FD760':'#3D6645',border:`1px solid ${p.active?'rgba(31,215,96,.3)':'rgba(61,102,69,.3)'}`}}>
                    {p.active?'✓ Активна':'✕ Откл.'}
                  </button>
                </td>
                <td><div style={{display:'flex',gap:5}}>
                  <button onClick={()=>openEdit(p)} className="ab abg" style={{padding:'4px 9px',fontSize:11}}>✏️</button>
                  <button onClick={()=>del(p.id)}   className="ab abd" style={{padding:'4px 9px',fontSize:11}}>🗑</button>
                </div></td>
              </tr>
            )) : (
              <tr><td colSpan={7} style={{textAlign:'center',color:'#3D6645',padding:20}}>Нет точек магазина</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="ac">
        <div style={{padding:'10px 14px',borderBottom:'1px solid #162B1A',fontWeight:800,fontSize:12}}>🍽 Рестораны <span style={{fontWeight:400,color:'#3D6645',fontSize:11}}>· из раздела «Рестораны»</span></div>
        <table className="at">
          <thead><tr><th>Точка</th><th>Тип</th><th>Адрес</th><th>Телефон</th><th>Координаты</th><th>Статус</th><th></th></tr></thead>
          <tbody>
            {restList.map(p=>(
              <tr key={p.id}>
                <td><div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:36,height:36,borderRadius:10,background:p.color+'22',border:`1.5px solid ${p.color}55`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>{p.e}</div>
                  <div><div style={{fontWeight:700,fontSize:13}}>{p.name}</div><div style={{fontSize:10,color:'#3D6645'}}>{p.id}</div></div>
                </div></td>
                <td><span style={{padding:'3px 8px',borderRadius:6,fontSize:11,fontWeight:700,background:'rgba(255,184,0,.12)',color:'#FFB800'}}>🍽 Ресторан</span></td>
                <td style={{fontSize:12,color:'#8FB897'}}>{p.addr}</td>
                <td style={{fontSize:12,color:'#8FB897'}}>{p.phone}</td>
                <td style={{fontSize:11,color:'#3D6645',fontFamily:'monospace'}}>{p.lat.toFixed(4)}, {p.lng.toFixed(4)}</td>
                <td>
                  <button onClick={()=>toggle(p.id)} className="ab" style={{padding:'4px 10px',fontSize:11,background:p.active?'rgba(31,215,96,.1)':'rgba(61,102,69,.1)',color:p.active?'#1FD760':'#3D6645',border:`1px solid ${p.active?'rgba(31,215,96,.3)':'rgba(61,102,69,.3)'}`}}>
                    {p.active?'✓ Активна':'✕ Откл.'}
                  </button>
                </td>
                <td><span style={{fontSize:10,color:'#3D6645'}}>из «Рестораны»</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="amod">
          <div className="amodbg" onClick={closeModal}/>
          <div className="amodbox" style={{maxWidth:520}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
              <div className="ub" style={{fontSize:14,fontWeight:800}}>{modal==='add'?'+ Точка магазина':'Редактировать магазин'}</div>
              <button onClick={closeModal} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:10,fontSize:16}}>✕</button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div style={{display:'grid',gridTemplateColumns:'80px 1fr',gap:10}}>
                <FI lbl="Эмодзи" fld="e" ph="🏪"/>
                <FI lbl="Название *" fld="name" ph="КАКАПО Магазин"/>
              </div>
              <FI lbl="Цвет (hex)" fld="color" ph="#1FD760"/>
              <FI lbl="Адрес" fld="addr" ph="ул. Ленина, 42"/>
              <FI lbl="Телефон" fld="phone" ph="+992 __ ___ __ __"/>
              <div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                  <div style={{ fontSize:11, color:'#8FB897', fontWeight:700 }}>📍 Точка на карте *</div>
                  <button type="button" onClick={() => setShowMap(v => !v)} className="ab" style={{ padding:'4px 10px', fontSize:11, background:'rgba(59,142,240,.1)', border:'1px solid rgba(59,142,240,.3)', color:'#3B8EF0' }}>
                    {showMap ? 'Скрыть карту' : 'Показать карту'}
                  </button>
                </div>
                {showMap && (
                  <div style={{ borderRadius:12, overflow:'hidden', border:'1px solid #162B1A', marginBottom:8 }}>
                    <AddressMapPicker
                      key={`pickup-map-${modal}-${form.id || 'new'}`}
                      variant="admin"
                      mapHeight={260}
                      initial={
                        form.lat != null && form.lng != null && Number(form.lat) && Number(form.lng)
                          ? { lat: Number(form.lat), lng: Number(form.lng) }
                          : { lat: STORE_LOCATION.lat, lng: STORE_LOCATION.lng }
                      }
                      onSelect={pickOnMap}
                    />
                  </div>
                )}
                {mapConfirmed && (
                  <div style={{ marginBottom:8, padding:'8px 12px', borderRadius:10, background:'rgba(31,215,96,.1)', border:'1px solid rgba(31,215,96,.3)', fontSize:11, color:'#1FD760', fontWeight:700 }}>
                    ✓ Точка подтверждена · {Number(form.lat).toFixed(5)}, {Number(form.lng).toFixed(5)}
                  </div>
                )}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  <FI lbl="Широта (lat)" fld="lat" ph="38.3250" type="number"/>
                  <FI lbl="Долгота (lng)" fld="lng" ph="69.0250" type="number"/>
                </div>
                {form.lat != null && form.lng != null && Number(form.lat) && Number(form.lng) && (
                  <div style={{ marginTop:6, fontSize:10, color:'#1FD760', fontFamily:'monospace' }}>
                    ✓ {Number(form.lat).toFixed(5)}, {Number(form.lng).toFixed(5)}
                  </div>
                )}
              </div>
              {saveErr && (
                <div style={{ padding:'9px 12px', borderRadius:10, background:'rgba(255,69,69,.08)', border:'1px solid rgba(255,69,69,.25)', fontSize:12, color:'#FF4545' }}>
                  {saveErr}
                </div>
              )}
              <button onClick={save} className="ab abp" style={{width:'100%',padding:11}}>✓ Сохранить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── ЗАКАЗЫ КУРЬЕРОВ ─────────────────────────────── */
function CourierOrdersPage() {
  const pricing = usePricingStore(s => s.pricing);
  const pickups = usePickupStore(s => s.pickups);
  const orders = DEMO_ADMIN_COURIER_ORDERS;
  const { roadKm, loading: kmLoading } = useOrderRoadKm(orders, true);
  const PM: Record<string,{e:string,name:string;color:string}> = Object.fromEntries(
    pickups.map(p => [p.id, { e: p.e, name: p.name.split(' ')[0], color: p.color }])
  );
  const SS: Record<string,{l:string,c:string}> = {
    new:      {l:'Новый',      c:'#3B8EF0'},
    toPickup: {l:'Едет забрать',c:'#FFB800'},
    toClient: {l:'Едет к клиенту',c:'#9B6DFF'},
    done:     {l:'Доставлено', c:'#1FD760'},
  };

  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        <StatCard l="Всего активных" v={orders.length}/>
        <StatCard l="Едут забирать"  v={orders.filter(o=>o.step==='toPickup').length} c="#FFB800"/>
        <StatCard l="Едут к клиенту" v={orders.filter(o=>o.step==='toClient').length} c="#9B6DFF"/>
        <StatCard l="Новые (без курьера)" v={orders.filter(o=>o.step==='new').length} c="#FF4545"/>
      </div>

      <div className="ac">
        <table className="at">
          <thead><tr><th>Заказ</th><th>Курьер</th><th>Маршрут</th><th>Клиент</th><th>Км · доставка</th><th>Сумма</th><th>Прогресс</th><th>Статус</th></tr></thead>
          <tbody>
            {orders.map(o=>{
              const ss = SS[o.step] || SS.new;
              const km = roadKm[o.id];
              const mockOrder = { id: o.id, status: o.step === 'done' ? 'delivered' as const : 'delivering' as const, deliveryFee: o.deliveryFee, deliveryFeeLocked: o.step === 'done', total: o.sum, weightKg: o.weight, items: [] };
              const dlv = resolveOrderDeliveryFee(mockOrder as import('@/lib/types').Order, pricing, roadKm);
              return (
                <tr key={o.id}>
                  <td><div style={{fontWeight:800,color:'#3B8EF0',fontFamily:'Unbounded',fontSize:12}}>{o.id}</div><div style={{fontSize:10,color:'#3D6645'}}>{o.time}</div></td>
                  <td style={{fontSize:12,fontWeight:700}}>{o.courier}</td>
                  <td>
                    <div style={{display:'flex',alignItems:'center',gap:4,flexWrap:'wrap'}}>
                      {o.pickupIds.map((pid,i)=>{
                        const pk = PM[pid] || { e:'📍', name: pid, color:'#3D6645' };
                        const isDone = o.step==='toClient'||o.step==='done'||(o.step==='toPickup'&&i<o.pickupIdx);
                        const isCur  = o.step==='toPickup'&&i===o.pickupIdx;
                        return (
                          <span key={i} style={{display:'inline-flex',alignItems:'center',gap:3,padding:'2px 7px',borderRadius:7,fontSize:11,fontWeight:700,
                            background:isCur?pk.color+'22':isDone?'rgba(31,215,96,.08)':'rgba(22,43,26,.5)',
                            color:isCur?pk.color:isDone?'#1FD760':'#3D6645',
                            border:`1px solid ${isCur?pk.color+'55':isDone?'rgba(31,215,96,.3)':'#162B1A'}`
                          }}>{isDone?'✓ ':isCur?'▶ ':''}{pk.e} {pk.name}</span>
                        );
                      })}
                      <span style={{fontSize:11,color:'#3D6645'}}>→ 📍</span>
                    </div>
                  </td>
                  <td><div style={{fontSize:12,fontWeight:700}}>{o.client}</div><div style={{fontSize:10,color:'#3D6645'}}>{o.addr}</div></td>
                  <td>
                    <div style={{fontSize:11,fontWeight:700,color:'#3B8EF0'}}>{kmLoading ? '…' : km != null ? formatKm(km) : '…'}</div>
                    <div style={{fontSize:10,color:'#1FD760'}}>{`${dlv} ЅМ доставка${o.step === 'done' ? ' 🔒' : ''}`}</div>
                  </td>
                  <td><span style={{fontFamily:'Unbounded',fontSize:12,fontWeight:800,color:'#FFB800'}}>{o.sum.toFixed(2)} ЅМ</span></td>
                  <td>
                    <div style={{display:'flex',gap:3}}>
                      {o.pickupIds.map((_,i)=>(
                        <div key={i} style={{width:10,height:10,borderRadius:'50%',background:(o.step==='toClient'||o.step==='done'||(o.step==='toPickup'&&i<o.pickupIdx))?'#1FD760':(o.step==='toPickup'&&i===o.pickupIdx)?'#FFB800':'#162B1A'}}/>
                      ))}
                      <div style={{width:10,height:10,borderRadius:'50%',background:o.step==='toClient'?'#9B6DFF':o.step==='done'?'#1FD760':'#162B1A'}}/>
                    </div>
                  </td>
                  <td><Badge v={ss.l} c={ss.c}/></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BannersPage() {
  /* ── Тикер ── */
  const [tickers,setTickers] = useState([
    {id:1,text:'🔥 Молочная среда −30%',on:true},
    {id:2,text:'⚡ Флэш до 20:00',on:true},
    {id:3,text:'🥩 Мясные выходные −25%',on:true},
    {id:4,text:'🎁 Бесплатная доставка от 30 ЅМ',on:true},
  ]);
  const [newTick,setNewTick] = useState('');
  const addTick  = () => { if(!newTick.trim()) return; setTickers(ts=>[...ts,{id:Date.now(),text:newTick.trim(),on:true}]); setNewTick(''); };
  const rmTick   = id => setTickers(ts=>ts.filter(t=>t.id!==id));
  const togTick  = id => setTickers(ts=>ts.map(t=>t.id===id?{...t,on:!t.on}:t));
  const editTick = (id,val) => setTickers(ts=>ts.map(t=>t.id===id?{...t,text:val}:t));

  /* ── Баннеры ── */
  const DEF = {badge:'',title:'',sub:'',disc:'',e:'🎁',bg:'linear-gradient(135deg,#0A1A0A,#1A3020)',ac:'#1FD760',on:true};
  const [banners,setBanners] = useState([
    {id:1,badge:'ПЯТНИЦА',  title:'Органик-день',     sub:'20% на органические продукты', disc:20,e:'🥦',bg:'linear-gradient(135deg,#0A2A0A,#1A4A1A)',ac:'#1FD760',on:true},
    {id:2,badge:'ХИТЫ',     title:'Молочная среда',   sub:'Скидка 30% на всё молочное',   disc:30,e:'🥛',bg:'linear-gradient(135deg,#0D2040,#163460)',ac:'#3B8EF0',on:true},
    {id:3,badge:'ВЫХОДНЫЕ', title:'Мясные выходные',  sub:'−25% на мясо и птицу',         disc:25,e:'🥩',bg:'linear-gradient(135deg,#2A0E0E,#501818)',ac:'#FF4545',on:true},
    {id:4,badge:'ФЛЭШ',     title:'Флэш до 20:00',    sub:'Успей купить — только сегодня',disc:40,e:'⚡',bg:'linear-gradient(135deg,#1A1A0A,#3A3010)',ac:'#FFB800',on:false},
  ]);
  const [form,setForm] = useState(DEF);
  const [editId,setEditId] = useState(null);
  const [showForm,setShowForm] = useState(false);

  const toggle = id => setBanners(bs=>bs.map(b=>b.id===id?{...b,on:!b.on}:b));
  const remove = id => setBanners(bs=>bs.filter(b=>b.id!==id));
  const move   = (id,d) => {
    const idx=banners.findIndex(b=>b.id===id), nb=[...banners], to=idx+d;
    if(to<0||to>=nb.length) return;
    [nb[idx],nb[to]]=[nb[to],nb[idx]]; setBanners(nb);
  };
  const startEdit = b => { setForm({...b,disc:String(b.disc)}); setEditId(b.id); setShowForm(true); };
  const startAdd  = () => { setForm(DEF); setEditId(null); setShowForm(true); };
  const save = () => {
    if(!form.title.trim()) return;
    if(editId!==null) setBanners(bs=>bs.map(b=>b.id===editId?{...b,...form,disc:Number(form.disc)}:b));
    else setBanners(bs=>[...bs,{...form,id:Date.now(),disc:Number(form.disc)}]);
    setShowForm(false); setEditId(null); setForm(DEF);
  };
  const FI = ({label,val,onChange,type='text',half}) => (
    <div style={{marginBottom:12,flex:half?'1 1 48%':'1 1 100%'}}>
      <div style={{fontSize:11,color:'#8FB897',marginBottom:4,fontWeight:700}}>{label}</div>
      <input className="ai" type={type} value={val} onChange={e=>onChange(e.target.value)}/>
    </div>
  );
  const Tog = ({on,onToggle}) => (
    <div onClick={onToggle} style={{width:42,height:23,borderRadius:12,background:on?'#1FD760':'#162B1A',position:'relative',cursor:'pointer',transition:'background .2s',flexShrink:0}}>
      <div style={{position:'absolute',top:2.5,left:on?21:2.5,width:18,height:18,borderRadius:'50%',background:'white',transition:'left .2s'}}/>
    </div>
  );
  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:20}}>
        {[{l:'Всего баннеров',v:banners.length,c:'#EBF5ED'},{l:'Активных',v:banners.filter(b=>b.on).length,c:'#1FD760'},{l:'Скрытых',v:banners.filter(b=>!b.on).length,c:'#8FB897'}].map((s,i)=>(
          <div key={i} className="ac" style={{padding:'14px 16px',textAlign:'center'}}>
            <div className="ub" style={{fontSize:24,fontWeight:900,color:s.c}}>{s.v}</div>
            <div style={{fontSize:11,color:'#8FB897',marginTop:3}}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* ── Тикер ── */}
      <div className="ac" style={{padding:18,marginBottom:20}}>
        <div className="ub" style={{fontSize:13,fontWeight:900,marginBottom:4}}>📢 Бегущая строка (тикер)</div>
        <div style={{fontSize:11,color:'#8FB897',marginBottom:14}}>Отображается в шапке страницы Акций</div>

        {/* Превью */}
        <div style={{background:'rgba(255,69,69,.08)',border:'1px solid rgba(255,69,69,.18)',borderRadius:10,padding:'7px 0',overflow:'hidden',marginBottom:14}}>
          <div style={{display:'flex',gap:0,whiteSpace:'nowrap',overflow:'hidden'}}>
            {tickers.filter(t=>t.on).map((t,i)=>(
              <span key={t.id} style={{fontSize:11,fontWeight:700,color:'#FF4545',padding:'0 24px',flexShrink:0}}>{t.text}</span>
            ))}
            {tickers.filter(t=>t.on).length===0&&<span style={{fontSize:11,color:'#3D6645',padding:'0 18px'}}>— нет активных элементов —</span>}
          </div>
        </div>

        {/* Список */}
        <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:12}}>
          {tickers.map(t=>(
            <div key={t.id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',background:'#0C1C0F',borderRadius:10,border:`1px solid ${t.on?'#162B1A':'rgba(255,69,69,.2)'}`,opacity:t.on?1:.65}}>
              <div onClick={()=>togTick(t.id)} style={{width:36,height:20,borderRadius:10,background:t.on?'#1FD760':'#162B1A',position:'relative',cursor:'pointer',flexShrink:0,transition:'background .2s'}}>
                <div style={{position:'absolute',top:2,left:t.on?18:2,width:16,height:16,borderRadius:'50%',background:'white',transition:'left .2s'}}/>
              </div>
              <input className="ai" value={t.text} onChange={e=>editTick(t.id,e.target.value)} style={{flex:1,padding:'5px 10px',fontSize:12,background:'transparent',border:'none',borderRadius:0,outline:'none'}}/>
              <button onClick={()=>rmTick(t.id)} className="ab abd" style={{padding:'4px 10px',fontSize:11,flexShrink:0}}>✕</button>
            </div>
          ))}
        </div>

        {/* Добавить */}
        <div style={{display:'flex',gap:8}}>
          <input className="ai" value={newTick} onChange={e=>setNewTick(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addTick()} placeholder="🎉 Новый текст для тикера..." style={{flex:1,fontSize:12}}/>
          <button onClick={addTick} className="ab abp" style={{padding:'8px 16px',fontSize:12,whiteSpace:'nowrap'}}>+ Добавить</button>
        </div>
      </div>

      {/* ── Баннеры ── */}
      <div className="ub" style={{fontSize:13,fontWeight:900,marginBottom:12}}>🖼 Слайдер-баннеры</div>
      <button onClick={startAdd} className="ab abp" style={{marginBottom:16,padding:'10px 20px',fontSize:13,display:'flex',alignItems:'center',gap:6}}>
        + Добавить баннер
      </button>

      {showForm && (
        <div className="ac" style={{padding:20,marginBottom:20}}>
          <div className="ub" style={{fontSize:13,fontWeight:900,marginBottom:16}}>{editId?'✏️ Редактировать':'➕ Новый баннер'}</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:'0 12px'}}>
            <FI half label="Заголовок *" val={form.title} onChange={v=>setForm(f=>({...f,title:v}))}/>
            <FI half label="Бейдж (ФЛЭШ, ПЯТНИЦА...)" val={form.badge} onChange={v=>setForm(f=>({...f,badge:v}))}/>
          </div>
          <FI label="Подзаголовок" val={form.sub} onChange={v=>setForm(f=>({...f,sub:v}))}/>
          <div style={{display:'flex',gap:12}}>
            <FI half label="Скидка %" val={form.disc} onChange={v=>setForm(f=>({...f,disc:v}))} type="number"/>
            <FI half label="Эмодзи" val={form.e} onChange={v=>setForm(f=>({...f,e:v}))}/>
          </div>
          <FI label="Цвет акцента (hex, напр. #1FD760)" val={form.ac} onChange={v=>setForm(f=>({...f,ac:v}))}/>
          <FI label="Фон (CSS, напр. linear-gradient(135deg,#0A2A0A,#1A4A1A))" val={form.bg} onChange={v=>setForm(f=>({...f,bg:v}))}/>
          <div style={{display:'flex',gap:8,marginTop:4}}>
            <button onClick={save} className="ab abp" style={{padding:'9px 20px'}}>Сохранить</button>
            <button onClick={()=>{setShowForm(false);setEditId(null);setForm(DEF);}} className="ab" style={{padding:'9px 16px',background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897'}}>Отмена</button>
          </div>
        </div>
      )}

      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {banners.map((b,idx)=>(
          <div key={b.id} className="ac" style={{overflow:'visible',border:`1.5px solid ${b.on?'#162B1A':'rgba(255,69,69,.25)'}`,opacity:b.on?1:.75}}>
            <div style={{background:b.bg,padding:'16px 18px',display:'flex',justifyContent:'space-between',alignItems:'center',borderRadius:'14px 14px 0 0',minHeight:80}}>
              <div>
                {b.badge&&<div style={{display:'inline-flex',padding:'3px 10px',borderRadius:20,background:`${b.ac}22`,border:`1px solid ${b.ac}44`,color:b.ac,fontSize:10,fontWeight:800,marginBottom:6}}>✦ {b.badge}</div>}
                <div className="ub" style={{fontSize:16,fontWeight:900,color:'white',marginBottom:2}}>{b.title||'—'}</div>
                <div style={{fontSize:11,color:'rgba(255,255,255,.5)'}}>{b.sub}</div>
                {b.disc>0&&<div style={{marginTop:8,display:'inline-block',padding:'4px 12px',borderRadius:8,background:b.ac,color:'white',fontFamily:'Unbounded',fontSize:13,fontWeight:900}}>−{b.disc}%</div>}
              </div>
              <div style={{fontSize:40,flexShrink:0,marginLeft:12}}>{b.e}</div>
            </div>
            <div style={{padding:'10px 14px',display:'flex',alignItems:'center',gap:8,background:'#091508',borderRadius:'0 0 14px 14px'}}>
              <Tog on={b.on} onToggle={()=>toggle(b.id)}/>
              <span style={{fontSize:11,color:b.on?'#1FD760':'#8FB897',fontWeight:700,flex:1}}>{b.on?'Активен':'Скрыт'}</span>
              <button onClick={()=>move(b.id,-1)} disabled={idx===0} className="ab" style={{padding:'5px 10px',fontSize:13,background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',opacity:idx===0?.3:1}}>↑</button>
              <button onClick={()=>move(b.id,1)} disabled={idx===banners.length-1} className="ab" style={{padding:'5px 10px',fontSize:13,background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',opacity:idx===banners.length-1?.3:1}}>↓</button>
              <button onClick={()=>startEdit(b)} className="ab" style={{padding:'5px 12px',fontSize:12,background:'rgba(59,142,240,.12)',border:'1px solid rgba(59,142,240,.3)',color:'#3B8EF0'}}>✏️ Ред.</button>
              <button onClick={()=>remove(b.id)} className="ab abd" style={{padding:'5px 12px',fontSize:12}}>✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   MAIN ADMIN APP — без логина
══════════════════════════════════════════════════════ */
export default function AdminApp() {
  return (
    <AppNavigationBoundary>
      <AdminAppInner />
    </AppNavigationBoundary>
  );
}

function AdminAppInner() {
  useApiSync('all');
  const { page, setPage } = useAppNavigation('dashboard');
  useEffect(() => {
    hydrateCourierStores();
    void syncCourierStoresFromApi();
    void syncCourierTeamFromApi();
    hydrateAssemblerTeamStore();
    void syncAssemblerTeamFromApi();
    hydrateClientStore();
    void syncClientsFromApi();
    hydrateCardStore();
    void syncCardsFromApi();
    hydratePushStore();
    void syncPushFromApi();
    useProductPhotos.getState().hydrate();
  }, []);
  const TITLES={dashboard:'Dashboard',categories:'Категории товаров',orders:'Все заказы',products:'Товары',inventory:'Склад',promos:'Акции',banners:'Баннеры / Слайдеры',partners:'Рестораны-партнёры',reviews:'Отзывы',couriers:'Курьеры',assemblers:'Сборщики',clients:'Клиенты',cards:'Карты',debts:'Долги VIP',push:'Push уведомления',finance:'Финансы',settings:'Настройки',pickups:'Точки забора',courierorders:'Заказы курьеров',tariff:'Тариф доставки'};
  const SUBS={dashboard:'Управление всеми 4 приложениями · г. Яван',categories:'Управление разделами каталога',orders:'Магазин и рестораны · в реальном времени',products:'Синхронизация KAK-XXXX с GBS Market',inventory:'Контроль остатков',promos:'Скидки для магазина и ресторанов',banners:'Слайдер на главной и в разделе Акций',partners:'Управление, меню, комиссии, выплаты',reviews:'Жалобы и отзывы клиентов',couriers:'GPS трекинг · kakapo-courier',assemblers:'Команда сборки · kakapo-assembler',clients:'CRM · все клиенты',cards:'Карты КАКАПО-XXXX · бонусы · долги',debts:'VIP-кредит · долги клиентов · погашение через поддержку',push:'Рассылка клиентам всех приложений',finance:'Выручка · комиссии · выплаты · курьеры · сборщики',settings:'GBS · SMS · контакты',pickups:'Магазин и рестораны · адреса и координаты',courierorders:'Активные заказы с маршрутами · kakapo-courier',tariff:'Тариф доставки · магазин · курьеры · OSRM'};
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
      {page==='cards'      && <CardsPage setPage={setPage}/>}
      {page==='debts'      && <DebtsPage setPage={setPage}/>}
      {page==='push'       && <PushPage/>}
      {page==='banners'    && <BannersPage/>}
      {page==='pickups'    && <PickupsPage/>}
      {page==='tariff'     && <TariffPage/>}
      {page==='courierorders' && <CourierOrdersPage/>}
      {page==='finance'    && <FinancePage/>}
      {page==='settings'   && <SettingsPage setPage={setPage}/>}
    </Layout>
  );
}
