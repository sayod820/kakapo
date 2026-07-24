'use client'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useOrders, useProducts, useRestaurants, usePromos, USE_API } from '@/lib/store'
import { mapOrdersForAdmin, ADMIN_STATUS_OPTIONS, adminStatusLabel, buildAdminStatusPatch, COURIER_ASSIGNED_STATUSES } from '@/lib/orderUiMap'
import { useApiSync } from '@/lib/useApiSync'
import { clearAppDataLocalCacheOnce } from '@/lib/localCache'
import { useAppNavigation } from '@/lib/useAppNavigation'
import AppNavigationBoundary from '@/components/shared/AppNavigationBoundary'
import MarketCategoriesPanel from '@/components/shared/MarketCategoriesPanel'
import AdminAiAssistantPage from '@/components/admin/AdminAiAssistantPage'
import AdminLoginPage from '@/components/admin/AdminLoginPage'
import AuditLogPage from '@/components/admin/AuditLogPage'
import AdminCashPage from '@/components/admin/AdminCashPage'
import {
  clearAdminSession,
  loadAdminSession,
  loadOfflineAdminCreds,
  saveAdminSession,
  saveOfflineAdminCreds,
  type AdminSession,
} from '@/lib/adminSession'
import { setToken } from '@/lib/api'
import { useCategories } from '@/lib/useCategories'
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
  hydrateClientStore,
  syncClientsFromApi,
  refilterClientsStore,
} from '@/lib/clientStore'
import {
  useCardStore,
  useCards,
  hydrateCardStore,
} from '@/lib/cardStore'
import {
  emptyCardLoyaltyForm,
  mergeCardsWithClients,
  cardMatchesSearch,
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
  isClientPurged,
} from '@/lib/clientCrm'
import {
  saveClientProfile,
  saveCardLoyalty,
  lookupClientByPhone,
  loyaltySummaryForClient,
  clientNoteForCard,
  cardLoyaltyFromCard,
} from '@/lib/clientCardSync'
import { deleteClientFromCrm, purgeAllDemoClientsFromCrm } from '@/lib/clientAccountDelete'
import { isPhoneDeleted } from '@/lib/clientTombstones'
import { isDemoSeedClient } from '@/lib/clientDemoSeed'
import { isClientInRecovery, moveClientToRecovery, restoreClientFromRecovery } from '@/lib/clientRecovery'
import { loadDebtHistory, subscribeDebtHistory, type DebtHistoryEntry } from '@/lib/clientVipCredit'
import { loyaltyTierOptions, loadLoyaltyStatusConfig } from '@/lib/loyaltyStatusConfig'
import { formatAdminLevelExpiry, formatAdminVipExpiry } from '@/lib/loyaltyAdminLock'
import CardStatusAdminPanel from '@/components/admin/CardStatusAdminPanel'
import EmployeesPage from '@/components/admin/EmployeesPage'
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
  buildCourierFinance,
  buildCourierDeliveryOrderRows,
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
import { getCourierCommissionPercent, getCourierBalance, getMinCourierCommissionEstimate, formatCourierCommissionPercent } from '@/lib/courierWallet'
import { formatCourierAccountDisplay, findCourierByAccount } from '@/lib/courierAccount'
import type { CourierWalletTx } from '@/lib/courierWalletTx'
import { formatWalletTxTime, getLocalCourierWalletTransactions, walletTxLabel } from '@/lib/courierWalletTx'
import { restIdToPickupId } from '@/lib/pickups'
import { resolveOrderDeliveryFee } from '@/lib/deliveryFee'
import { useProductPhotos, resolvePhotoUrl } from '@/lib/productPhotos'
import PhotoUploadField from '@/components/shared/PhotoUploadField'
import ProductImage from '@/components/shared/ProductImage'
import { formatPriceLabel, isWeighted, productUnitGrams } from '@/lib/productWeight'
import { formatBulkPricingHint, hasBulkPricing, normalizeBulkPricing } from '@/lib/productBulkPricing'
import { isProductPromo, productPromoLabel, stripProductSaleFields } from '@/lib/productPromos'
import { formatPromoScheduleLabel, hasFlashEnd, inferScheduleMode, isPromoScheduleActive } from '@/lib/promoSchedule'
import { formatPromoStockAdmin, isPromoStockAvailable, isPromoStockExhausted, isWeightedPromoProduct, promoLimitLooksLikeGrams, promoLimitUnit, stockLimitFromAdminInput, stockLimitToAdminInput } from '@/lib/promoStock'
import ProductSearchPicker from '@/components/admin/ProductSearchPicker'
import PromoScheduleFields, { scheduleFromPromo, scheduleToPromoPayload, type PromoScheduleForm } from '@/components/admin/PromoScheduleFields'
import { api } from '@/lib/api'
import { avgReviewRating, resolveReviewPlaceName, sortReviewsNewestFirst } from '@/lib/clientReviews'
import { STORE_REVIEW_REST_ID } from '@/lib/clientOrderReview'
import type { Promo, Review } from '@/lib/types'
import { useOrderRoadKm } from '@/lib/useOrderRoadKm'
import { formatKm, DEFAULT_PRICING, STORE_LOCATION } from '@/lib/courierData'
import { preloadLeaflet } from '@/lib/leafletLoader'
import Link from 'next/link'

const AddressMapPicker = dynamic(() => import('@/components/shared/AddressMapPicker'), { ssr: false })

function AdminLocationMap({
  mapKey,
  lat,
  lng,
  onCenterChange,
  addressLabel = 'Адрес',
}: {
  mapKey: string;
  lat: number | null;
  lng: number | null;
  onCenterChange: (r: { lat: number; lng: number; address: string }) => void;
  addressLabel?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const onChangeRef = useRef(onCenterChange);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  onChangeRef.current = onCenterChange;

  useEffect(() => {
    preloadLeaflet();
    const t = window.setTimeout(() => setMounted(true), 120);
    return () => {
      window.clearTimeout(t);
      setMounted(false);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [mapKey]);

  const handleCenterChange = useCallback((r: { lat: number; lng: number; address: string }) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onChangeRef.current(r);
    }, 600);
  }, []);

  const initialRef = useRef(
    lat != null && lng != null ? { lat, lng } : { lat: STORE_LOCATION.lat, lng: STORE_LOCATION.lng },
  );

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: '#8FB897', marginBottom: 6, fontWeight: 700 }}>📍 Точка на карте *</div>
      {!mounted ? (
        <div style={{ height: 280, borderRadius: 14, background: '#050F08', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #162B1A' }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', border: '3px solid rgba(31,215,96,.2)', borderTopColor: '#1FD760', animation: 'spin 1s linear infinite' }} />
        </div>
      ) : (
        <AddressMapPicker
          key={mapKey}
          variant="admin"
          mapHeight={280}
          pickMode="center"
          hideConfirm
          hideGps
          addressLabel={addressLabel}
          addressHelper="Двигайте карту — остриё метки показывает точку"
          initial={initialRef.current}
          onCenterChange={handleCenterChange}
        />
      )}
    </div>
  );
}
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
  .ac{background:#091508;border:1px solid #162B1A;border-radius:14px;overflow-x:auto;-webkit-overflow-scrolling:touch;}
  .at{width:100%;border-collapse:collapse;min-width:560px;}
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

  .admin-shell{display:flex;min-height:100vh;min-height:100dvh;background:#030B05;font-family:Nunito,sans-serif;}
  .admin-sidebar{width:205px;flex-shrink:0;background:#06100A;border-right:1px solid #162B1A;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;height:100dvh;overflow-y:auto;z-index:120;}
  .admin-overlay{display:none;}
  .admin-mob-btn{display:none;align-items:center;justify-content:center;width:40px;height:40px;border-radius:10px;border:1px solid #162B1A;background:#0C1C0F;color:#EBF5ED;cursor:pointer;font-size:20px;flex-shrink:0;}
  .admin-bottom-nav{display:none;}
  .admin-main-wrap{flex:1;display:flex;flex-direction:column;min-width:0;}
  .admin-header{padding:12px 24px;border-bottom:1px solid #162B1A;background:rgba(3,11,5,.95);backdrop-filter:blur(16px);display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:50;flex-shrink:0;}
  .admin-content{flex:1;padding:22px;overflow-y:auto;-webkit-overflow-scrolling:touch;}
  .admin-app-badges{display:flex;gap:6px;flex-wrap:wrap;}
  .admin-tbl-scroll{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;}
  .admin-grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));}
  .admin-grid-2{display:grid;gap:14px;grid-template-columns:repeat(2,minmax(0,1fr));}
  .admin-grid-3{display:grid;gap:14px;grid-template-columns:repeat(3,minmax(0,1fr));}
  .admin-grid-4{display:grid;gap:14px;grid-template-columns:repeat(4,minmax(0,1fr));}

  @media (max-width:1100px){
    .admin-grid-4{grid-template-columns:repeat(2,minmax(0,1fr));}
    .admin-grid-3{grid-template-columns:repeat(2,minmax(0,1fr));}
  }
  @media (max-width:1024px){
    .admin-sidebar{
      position:fixed;left:0;top:0;transform:translateX(-105%);transition:transform .25s ease;
      width:min(280px,88vw);height:100vh;height:100dvh;box-shadow:none;border-right:1px solid #162B1A;
    }
    .admin-sidebar.open{transform:translateX(0);box-shadow:8px 0 32px rgba(0,0,0,.55);}
    .admin-overlay{display:block;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:110;opacity:0;pointer-events:none;transition:opacity .25s;}
    .admin-overlay.open{opacity:1;pointer-events:auto;}
    .admin-mob-btn{display:flex;}
    .admin-content{padding:14px;}
    .admin-header{padding:10px 14px;gap:8px;}
    .admin-app-badges{display:none;}
    .admin-main-wrap{padding-bottom:calc(64px + env(safe-area-inset-bottom,0px));}
    .admin-bottom-nav{
      display:flex;position:fixed;bottom:0;left:0;right:0;z-index:100;
      background:#06100A;border-top:1px solid #162B1A;
      padding:6px 4px calc(6px + env(safe-area-inset-bottom,0px));gap:2px;
    }
    .admin-bottom-nav button{
      flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
      border:none;background:transparent;color:#3D6645;padding:6px 2px;border-radius:10px;
      font-size:9px;font-weight:800;cursor:pointer;min-height:52px;font-family:Nunito,sans-serif;
    }
    .admin-bottom-nav button.active{color:#1FD760;background:rgba(31,215,96,.12);}
    .admin-bottom-nav button .ic{font-size:18px;line-height:1;}
    .amod{align-items:flex-end;padding:0;}
    .amodbox{max-width:100%;max-height:92vh;max-height:92dvh;border-radius:18px 18px 0 0;margin-top:auto;}
    .admin-grid-2,.admin-grid-3,.admin-grid-4{grid-template-columns:1fr 1fr;}
  }
  @media (max-width:600px){
    .admin-content{padding:10px;}
    .admin-grid-2,.admin-grid-3,.admin-grid-4,.admin-grid{grid-template-columns:1fr;}
    .at th,.at td{padding:8px 10px;font-size:12px;}
    .ai,.ab{font-size:16px;min-height:44px;}
  }
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

const ADMIN_CAT_VISUAL: Record<string, { bg: string; color: string }> = {
  veg: { bg: 'linear-gradient(145deg,#0D2A0D,#1A4A1A)', color: '#56C956' },
  meat: { bg: 'linear-gradient(145deg,#2A0A0A,#4A1818)', color: '#FF6B6B' },
  dairy: { bg: 'linear-gradient(145deg,#0A1828,#163050)', color: '#93C5FD' },
  bread: { bg: 'linear-gradient(145deg,#281806,#4A2E12)', color: '#FCD34D' },
  drinks: { bg: 'linear-gradient(145deg,#041820,#0C2E3A)', color: '#67E8F9' },
  grains: { bg: 'linear-gradient(145deg,#281806,#4A2E12)', color: '#D4A574' },
  frozen: { bg: 'linear-gradient(145deg,#051822,#0E2C3E)', color: '#7DD3FC' },
  sweets: { bg: 'linear-gradient(145deg,#1A0C28,#2E1848)', color: '#C084FC' },
  house: { bg: 'linear-gradient(145deg,#062018,#103A28)', color: '#6EE7B7' },
}

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

const REVIEWS: Review[] = [];

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

const StatCard = ({l,v,c,e,sub,onClick,active}) => (
  <button
    type="button"
    className="ac"
    onClick={onClick}
    style={{
      width:'100%',
      padding:'16px 18px',
      cursor:onClick?'pointer':'default',
      border:active?`1.5px solid ${c||'rgba(31,215,96,.45)'}`:'1px solid #162B1A',
      background:active?'rgba(31,215,96,.08)':'#091508',
      transition:'border .15s, background .15s, transform .12s',
      transform:active?'scale(1.02)':'none',
      textAlign:'left',
    }}
  >
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
      <div style={{fontSize:11,color:'#8FB897',fontWeight:600}}>{l}</div>
      {e&&<span style={{fontSize:22}}>{e}</span>}
    </div>
    <div className="ub" style={{fontSize:22,fontWeight:900,color:c||'#EBF5ED'}}>{v}</div>
    {sub&&<div style={{fontSize:10,color:'#3D6645',marginTop:4}}>{sub}</div>}
  </button>
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
  {g:'Команда',   items:[{id:'couriers',icon:'🛵',l:'Курьеры'},{id:'assemblers',icon:'🛒',l:'Сборщики'},{id:'employees',icon:'👤',l:'Сотрудники'},{id:'courierorders',icon:'🗺',l:'Заказы курьеров'}]},
  {g:'Клиенты',   items:[{id:'clients',icon:'👥',l:'Клиенты'},{id:'cards',icon:'💳',l:'Карты'},{id:'debts',icon:'📒',l:'Долги VIP'},{id:'push',icon:'🔔',l:'Push'}]},
  {g:'Финансы',   items:[{id:'finance',icon:'💰',l:'Финансы'},{id:'cash',icon:'💵',l:'Касса'},{id:'tariff',icon:'🚚',l:'Тариф доставки'}]},
  {g:'Контент',   items:[{id:'banners',icon:'🖼',l:'Баннеры / Слайдеры'}]},
  {g:'Система',   items:[{id:'ai',icon:'🧠',l:'ИИ-ассистент'},{id:'audit',icon:'📜',l:'История действий'},{id:'settings',icon:'⚙️',l:'Настройки'}]},
];

function Layout({page,setPage,children,title,subtitle,session,onLogout}) {
  const apiOrders = useOrders(s => s.orders);
  const storedCards = useCards();
  const clients = useClients();
  const [menuOpen, setMenuOpen] = useState(false);
  const orders = useMemo(
    () => (USE_API ? mapOrdersForAdmin(apiOrders) : ALL_ORDERS),
    [apiOrders],
  );
  const newOrders = orders.filter(o => o.status === 'new').length;
  const debtClients = useMemo(
    () => mergeCardsWithClients(storedCards, clients).filter(c => c.status === 'active' && cardHasDebtSection(c) && c.debt > 0).length,
    [storedCards, clients],
  );

  const goPage = (id) => {
    setPage(id);
    setMenuOpen(false);
  };

  const bottomItems = [
    { id: 'dashboard', icon: '📊', l: 'Главная' },
    { id: 'orders', icon: '📦', l: 'Заказы' },
    { id: 'products', icon: '🥦', l: 'Товары' },
    { id: 'clients', icon: '👥', l: 'Клиенты' },
    { id: 'menu', icon: '☰', l: 'Меню' },
  ];

  return (
    <div className="admin-shell">
      <style>{CSS}</style>
      <div className={`admin-overlay${menuOpen ? ' open' : ''}`} onClick={() => setMenuOpen(false)} />
      <aside className={`admin-sidebar${menuOpen ? ' open' : ''}`}>
        <div style={{padding:'16px 14px',borderBottom:'1px solid #162B1A',display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
          <div style={{width:40,height:40,borderRadius:13,background:'linear-gradient(135deg,#0F8A3A,#1FD760)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:16,fontWeight:900,color:'#030B05',flexShrink:0}}>K</div>
          <div style={{flex:1,minWidth:0}}>
            <div className="ub" style={{fontSize:14,fontWeight:900,color:'#1FD760'}}>КАКАПО</div>
            <div style={{fontSize:9,color:'#3D6645'}}>Admin · г. Яван</div>
          </div>
          <button type="button" className="admin-mob-btn" onClick={() => setMenuOpen(false)} aria-label="Закрыть" style={{width:34,height:34,fontSize:16}}>✕</button>
        </div>
        <nav style={{flex:1,padding:'8px',display:'flex',flexDirection:'column',gap:0}}>
          {NAV_GROUPS.map(g=>(
            <div key={g.g} style={{marginBottom:4}}>
              <div style={{fontSize:9,fontWeight:800,color:'#3D6645',textTransform:'uppercase',letterSpacing:1,padding:'6px 10px 3px'}}>{g.g}</div>
              {g.items.map(n=>(
                <button key={n.id} type="button" onClick={()=>goPage(n.id)} className="btn"
                  style={{display:'flex',alignItems:'center',gap:9,padding:'9px 11px',borderRadius:10,background:page===n.id?'rgba(31,215,96,.14)':'transparent',border:`1px solid ${page===n.id?'rgba(31,215,96,.22)':'transparent'}`,color:page===n.id?'#1FD760':'#8FB897',fontSize:13,fontWeight:600,textAlign:'left',cursor:'pointer',width:'100%',position:'relative'}}>
                  <span style={{fontSize:16,flexShrink:0}}>{n.icon}</span>{n.l}
                  {n.id==='orders'&&newOrders>0&&<span style={{marginLeft:'auto',minWidth:18,height:18,padding:'0 5px',borderRadius:999,background:'#FF4545',fontSize:9,fontWeight:900,color:'white',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',flexShrink:0}}>{newOrders > 99 ? '99+' : newOrders}</span>}
                  {n.id==='debts'&&debtClients>0&&<span style={{marginLeft:'auto',minWidth:18,height:18,padding:'0 5px',borderRadius:999,background:'#FF8C00',fontSize:9,fontWeight:900,color:'#030B05',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',flexShrink:0}}>{debtClients > 99 ? '99+' : debtClients}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div style={{padding:'10px 14px 16px',borderTop:'1px solid #162B1A',flexShrink:0}}>
          <div style={{fontSize:11,fontWeight:700,color:'#8FB897',marginBottom:8,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {session?.name || 'Админ'}{session?.login ? ` · ${session.login}` : ''}
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="btn"
            style={{
              width: '100%', padding: '9px 11px', borderRadius: 10, fontSize: 12, fontWeight: 800,
              background: 'rgba(255,69,69,.08)', border: '1px solid rgba(255,69,69,.25)', color: '#FF6969',
              cursor: 'pointer', textAlign: 'left',
            }}
          >
            🚪 Выйти
          </button>
          <div style={{marginTop:10,fontSize:9,color:'#3D6645',lineHeight:1.6}}>
            КАКАПО v2.0<br/>
            🛒 Магазин · 🍽 Рестораны<br/>
            🛵 Курьеры · 🛒 Сборщики
          </div>
        </div>
      </aside>
      <div className="admin-main-wrap">
        <div className="admin-header">
          <button type="button" className="admin-mob-btn" onClick={() => setMenuOpen(true)} aria-label="Меню">☰</button>
          <div style={{flex:1,minWidth:0}}>
            <div className="ub" style={{fontSize:16,fontWeight:900}}>{title}</div>
            {subtitle&&<div style={{fontSize:11,color:'#8FB897',marginTop:1}}>{subtitle}</div>}
          </div>
          <div className="admin-app-badges">
            {page !== 'settings' && [{l:'Магазин',c:'#1FD760'},{l:'Рестораны',c:'#FF8C00'},{l:'Курьеры',c:'#3B8EF0'},{l:'Сборщики',c:'#9B6DFF'}].map((a,i)=>(
              <span key={i} style={{padding:'3px 9px',borderRadius:8,fontSize:10,fontWeight:700,background:`${a.c}14`,color:a.c,border:`1px solid ${a.c}28`}}>{a.l}</span>
            ))}
          </div>
        </div>
        <main className="admin-content">{children}</main>
      </div>
      <nav className="admin-bottom-nav">
        {bottomItems.map(item => (
          <button
            key={item.id}
            type="button"
            className={item.id === 'menu' ? (menuOpen ? 'active' : '') : (page === item.id ? 'active' : '')}
            onClick={() => item.id === 'menu' ? setMenuOpen(v => !v) : goPage(item.id)}
          >
            <span className="ic">{item.icon}</span>
            {item.l}
          </button>
        ))}
      </nav>
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

function OrderDetailModal({ order, onClose, onStatusChange, onCourierChange, onAssemblerChange, onDelete, couriers, assemblers, statusBusy, courierBusy, assemblerBusy, deleteBusy }) {
  if (!order) return null
  const st = adminStatusLabel(order.status)
  const showAssembler = order.type === 'market' || order.type === 'mixed'
  const PART_LABELS = { new: 'Новый', assembling: 'Собирается', done: 'Готово', cooking: 'Готовится' }
  const goodsTotal = Number(order.goodsTotal ?? order.total) || 0
  const deliveryFee = Number(order.deliveryFee) || 0
  const bonusSpent = Number(order.bonusSpent) || 0
  const payableTotal = Number(order.payableTotal) || 0
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.72)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div onClick={e=>e.stopPropagation()} className="ac" style={{ width:'100%', maxWidth:520, maxHeight:'90vh', overflowY:'auto', padding:22 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:18 }}>
          <div>
            <div className="ub" style={{ fontSize:18, fontWeight:900, color:'#1FD760', marginBottom:4 }}>{order.id}</div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <Badge v={st.l} c={st.c}/>
              <Badge v={order.type==='restaurant'?'🍽 Ресторан':order.type==='mixed'?'🔀 Смешанный':'🛒 Магазин'} c={order.type==='restaurant'?'#FF8C00':'#1FD760'}/>
              {order.archived && <Badge v="архив" c="#FFB800"/>}
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
                  {resolvePhotoUrl(it.photoThumb || it.photo)
                    ? <img src={resolvePhotoUrl(it.photoThumb || it.photo)} alt="" style={{width:28,height:28,borderRadius:7,objectFit:'cover',flexShrink:0}}/>
                    : <span>{it.e || '📦'}</span>}
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

        <div style={{ marginTop: 14, padding: '12px 14px', background: '#0C1C0F', borderRadius: 12, border: '1px solid #162B1A' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, marginBottom: deliveryFee > 0 || bonusSpent > 0 ? 8 : 0 }}>
            <span style={{ color: '#8FB897' }}>Товары</span>
            <span className="ub" style={{ fontWeight: 800, color: '#1FD760' }}>{goodsTotal.toFixed(2)} ЅМ</span>
          </div>
          {deliveryFee > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, marginBottom: bonusSpent > 0 ? 8 : 0 }}>
              <span style={{ color: '#3B8EF0' }}>Доставка · курьер</span>
              <span className="ub" style={{ fontWeight: 800, color: '#3B8EF0' }}>{deliveryFee.toFixed(2)} ЅМ</span>
            </div>
          )}
          {bonusSpent > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, marginBottom: 8 }}>
              <span style={{ color: '#FFB800' }}>Бонусы</span>
              <span className="ub" style={{ fontWeight: 800, color: '#FFB800' }}>−{bonusSpent.toFixed(2)} ЅМ</span>
            </div>
          )}
          {(deliveryFee > 0 || bonusSpent > 0) && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, paddingTop: 8, borderTop: '1px solid #162B1A' }}>
              <span style={{ color: '#EBF5ED', fontWeight: 700 }}>К оплате</span>
              <span className="ub" style={{ fontWeight: 900, color: '#1FD760' }}>{payableTotal.toFixed(2)} ЅМ</span>
            </div>
          )}
          <div style={{ fontSize: 10, color: '#3D6645', marginTop: 10 }}>
            Создан: {order.time || '—'}{order.deliveredAt ? ` · Доставлен: ${order.deliveredAt}` : ''}
          </div>
          {order.comment && <div style={{ fontSize: 11, color: '#8FB897', marginTop: 4 }}>💬 {order.comment}</div>}
        </div>

        {onStatusChange && (
          <div style={{ marginTop:16, paddingTop:14, borderTop:'1px solid #162B1A' }}>
            <div style={{ fontSize:10, color:'#3D6645', marginBottom:8, fontWeight:700 }}>ИЗМЕНИТЬ СТАТУС</div>
            <OrderStatusSelect value={order.status} disabled={statusBusy} onChange={s => onStatusChange(order, s)} />
          </div>
        )}

        {onDelete && (
          <div style={{ marginTop:16, paddingTop:14, borderTop:'1px solid #162B1A' }}>
            {order.archived && (
              <div style={{ fontSize:11, color:'#FFB800', marginBottom:10, lineHeight:1.45 }}>
                Заказ из прошлого аккаунта клиента — в статус и бонусы текущего клиента не входит.
              </div>
            )}
            <button
              type="button"
              disabled={deleteBusy}
              onClick={() => onDelete(order)}
              className="ab abd"
              style={{ width:'100%', padding:'10px 14px', fontSize:12, opacity: deleteBusy ? .6 : 1 }}
            >
              {deleteBusy ? 'Удаление…' : '🗑 Удалить заказ из базы'}
            </button>
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
  const adminRemoveOrder = useOrders(s => s.adminRemoveOrder);
  const adminRemoveOrders = useOrders(s => s.adminRemoveOrders);
  const storedClients = useClients();
  const activeClients = useMemo(
    () => storedClients.filter(c => c.accountStatus !== 'recovery'),
    [storedClients],
  );
  const couriers = useCourierTeam();
  const assemblers = useAssemblerTeam();
  const apiRests = useRestaurants(s => s.restaurants);
  const restaurantsLoaded = useRestaurants(s => s.loaded);
  const restaurants = useMemo(
    () => (!USE_API ? RESTAURANTS : (restaurantsLoaded ? enrichRestaurants(apiRests, RESTAURANTS) : [])),
    [apiRests, restaurantsLoaded],
  );
  const [demoPatch, setDemoPatch] = useState({});
  const [busyKey, setBusyKey] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkStatusChanging, setBulkStatusChanging] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [removedDemoIds, setRemovedDemoIds] = useState(new Set());
  const orders = useMemo(
    () => {
      const pinned = apiOrders.map(o => {
        const pin = adminPins[o.id]
        return pin ? { ...o, ...pin, status: pin.status ?? o.status } : o
      })
      const base = USE_API ? mapOrdersForAdmin(pinned, restaurants, activeClients) : ALL_ORDERS;
      return base
        .map(o => (demoPatch[o.id] ? { ...o, ...demoPatch[o.id] } : o))
        .filter(o => !removedDemoIds.has(o.id));
    },
    [apiOrders, adminPins, demoPatch, restaurants, activeClients, removedDemoIds]
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
  const allFilteredSelected = filtered.length > 0 && filtered.every(o => selectedIds.has(o.id));
  const toggleSelectOrder = (id, e) => {
    e?.stopPropagation?.();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectAllFiltered = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach(o => next.delete(o.id));
      else filtered.forEach(o => next.add(o.id));
      return next;
    });
  };
  const selectCancelledInView = () => {
    setSelectedIds(new Set(filtered.filter(o => o.status === 'cancelled').map(o => o.id)));
  };
  const confirmRemoveOrders = (items) => {
    if (!items.length) return false;
    const delivered = items.filter(o => o.status === 'delivered').length;
    const archived = items.filter(o => o.archived).length;
    const lines = [
      `Удалить ${items.length} заказ(ов) из базы?`,
      'Действие необратимо.',
    ];
    if (delivered > 0) lines.push(`• ${delivered} доставленных — пересчитаются бонусы клиента.`);
    if (archived > 0) lines.push(`• ${archived} архивных — старый аккаунт клиента.`);
    return window.confirm(lines.join('\n'));
  };
  const removeOrders = async (items) => {
    if (!items.length || !confirmRemoveOrders(items)) return;
    const ids = items.map(o => o.id);
    if (ids.length === 1) setDeletingId(ids[0]);
    else setBulkDeleting(true);
    try {
      if (USE_API) {
        if (ids.length === 1) await adminRemoveOrder(ids[0]);
        else await adminRemoveOrders(ids);
      } else {
        setRemovedDemoIds(prev => new Set([...prev, ...ids]));
      }
      setSelectedIds(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
      if (detail && ids.includes(detail.id)) setDetail(null);
      setDemoPatch(prev => {
        const next = { ...prev };
        ids.forEach(id => { delete next[id]; });
        return next;
      });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Не удалось удалить заказы');
    } finally {
      setDeletingId(null);
      setBulkDeleting(false);
    }
  };
  const changeStatus = async (o, newStatus) => {
    if (!newStatus || newStatus === o.status) return;
    if (newStatus === 'cancelled' && !window.confirm(`Отменить заказ ${o.id}?`)) return;
    setBusyKey(`${o.id}:status`);
    try {
      await applyStatusChange(o, newStatus);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Не удалось сохранить статус'
      window.alert(msg)
    } finally {
      setBusyKey(null);
    }
  };
  const applyStatusChange = async (o, newStatus) => {
    if (!newStatus || newStatus === o.status) return;
    const clearsCourier = !COURIER_ASSIGNED_STATUSES.includes(newStatus);
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
  };
  const applyBulkStatus = async () => {
    if (!bulkStatus) return;
    const items = filtered.filter(o => selectedIds.has(o.id));
    const needChange = items.filter(o => o.status !== bulkStatus);
    if (!needChange.length) {
      window.alert('У всех выбранных заказов уже этот статус');
      return;
    }
    const label = adminStatusLabel(bulkStatus).l;
    const question = bulkStatus === 'cancelled'
      ? `Отменить ${needChange.length} заказ(ов)?`
      : `Изменить статус у ${needChange.length} заказ(ов) на «${label}»?`;
    if (!window.confirm(question)) return;
    setBulkStatusChanging(true);
    let failed = 0;
    for (const o of needChange) {
      try {
        await applyStatusChange(o, bulkStatus);
      } catch {
        failed += 1;
      }
    }
    setBulkStatusChanging(false);
    if (failed > 0) {
      window.alert(`Не удалось обновить ${failed} заказ(ов)`);
    } else {
      setSelectedIds(new Set());
      setBulkStatus('');
    }
  };
  const applyCourier = async (o, courierId) => {
    const currentId = resolvePersonSelectId(couriers, o.courier);
    if (courierId === currentId) return;
    const person = courierId ? couriers.find(c => c.id === courierId) : null;
    setBusyKey(`${o.id}:courier`);
    try {
      if (USE_API) {
        await adminAssignCourier(o.id, person ? { id: person.id, name: person.name, phone: person.phone } : null);
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
          onDelete={o => removeOrders([o])}
          couriers={couriers.filter(c => !c.blocked)}
          assemblers={assemblers.filter(a => !a.blocked)}
          statusBusy={busyKey === `${detail.id}:status`}
          courierBusy={busyKey === `${detail.id}:courier`}
          assemblerBusy={busyKey === `${detail.id}:assembler`}
          deleteBusy={deletingId === detail.id || bulkDeleting || bulkStatusChanging}
        />
      )}
      <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:10,marginBottom:18}}>
        {['all','new','assembling','delivering','delivered','cancelled'].map(s=>{
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
        {filtered.some(o => o.status === 'cancelled') && (
          <button
            type="button"
            onClick={selectCancelledInView}
            className="ab"
            style={{ padding:'7px 14px', fontSize:12, background:'rgba(255,69,69,.08)', border:'1px solid rgba(255,69,69,.25)', color:'#FF8C8C' }}
          >
            Выбрать отменённые
          </button>
        )}
      </div>

      {selectedIds.size > 0 && (
        <div style={{
          display:'flex', flexWrap:'wrap', alignItems:'center', gap:10, marginBottom:12,
          padding:'10px 14px', borderRadius:12, background:'rgba(31,215,96,.06)', border:'1px solid rgba(31,215,96,.22)',
        }}>
          <span style={{ fontSize:13, color:'#EBF5ED' }}>
            Выбрано: <strong style={{ color:'#1FD760' }}>{selectedIds.size}</strong>
          </span>
          <select
            value={bulkStatus}
            onChange={e => setBulkStatus(e.target.value)}
            disabled={bulkDeleting || bulkStatusChanging}
            style={{
              padding:'6px 10px',
              borderRadius:8,
              fontSize:12,
              fontWeight:700,
              background:'#0C1C0F',
              color: bulkStatus ? adminStatusLabel(bulkStatus).c : '#8FB897',
              border:`1px solid ${bulkStatus ? `${adminStatusLabel(bulkStatus).c}40` : '#162B1A'}`,
              cursor: bulkDeleting || bulkStatusChanging ? 'default' : 'pointer',
              minWidth: 150,
              opacity: bulkDeleting || bulkStatusChanging ? .6 : 1,
            }}
          >
            <option value="" style={{ background:'#0C1C0F', color:'#8FB897' }}>Новый статус…</option>
            {ADMIN_STATUS_OPTIONS.map(st => {
              const lb = adminStatusLabel(st);
              return <option key={st} value={st} style={{ background:'#0C1C0F', color:'#EBF5ED' }}>{lb.l}</option>;
            })}
          </select>
          <button
            type="button"
            onClick={applyBulkStatus}
            disabled={!bulkStatus || bulkDeleting || bulkStatusChanging}
            className="ab abp"
            style={{ padding:'6px 14px', fontSize:12, opacity: !bulkStatus || bulkDeleting || bulkStatusChanging ? .6 : 1 }}
          >
            {bulkStatusChanging ? 'Сохранение…' : '✓ Изменить статус'}
          </button>
          <button
            type="button"
            onClick={() => removeOrders(filtered.filter(o => selectedIds.has(o.id)))}
            disabled={bulkDeleting || bulkStatusChanging}
            className="ab abd"
            style={{ padding:'6px 14px', fontSize:12, opacity: bulkDeleting || bulkStatusChanging ? .6 : 1 }}
          >
            {bulkDeleting ? 'Удаление…' : '🗑 Удалить выбранные'}
          </button>
          <button
            type="button"
            onClick={() => { setSelectedIds(new Set()); setBulkStatus(''); }}
            disabled={bulkDeleting || bulkStatusChanging}
            className="ab"
            style={{ padding:'6px 14px', fontSize:12, background:'#0C1C0F', border:'1px solid #162B1A', color:'#8FB897', marginLeft:'auto' }}
          >
            Снять выбор
          </button>
        </div>
      )}

      <div className="ac">
        <table className="at">
          <thead><tr>
            <th style={{ width:36 }}>
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={toggleSelectAllFiltered}
                disabled={filtered.length === 0 || bulkDeleting || bulkStatusChanging}
                title="Выбрать все в списке"
                style={{ width:16, height:16, cursor: filtered.length === 0 ? 'default' : 'pointer', accentColor:'#1FD760' }}
              />
            </th>
            <th>ID</th><th>Тип</th><th>Клиент</th><th>Адрес</th><th>Состав</th><th>Товары</th><th>Курьер</th><th>Сборщик</th><th>Статус</th><th>Время</th><th></th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={12} style={{textAlign:'center',padding:'28px 14px',color:'#8FB897',fontSize:13}}>
                  {orderSearch.trim()
                    ? `Заказ «${orderSearch.trim()}» не найден`
                    : 'Нет заказов по выбранным фильтрам'}
                </td>
              </tr>
            ) : filtered.map(o=>(
                <tr key={o.id} onClick={()=>setDetail(o)} style={{ cursor:'pointer' }}>
                  <td onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(o.id)}
                      onChange={e => toggleSelectOrder(o.id, e)}
                      disabled={bulkDeleting || bulkStatusChanging}
                      style={{ width:16, height:16, accentColor:'#1FD760', cursor:'pointer' }}
                    />
                  </td>
                  <td>
                    <span className="ub" style={{fontSize:11,color:'#1FD760'}}>{o.id}</span>
                    {o.archived && <div style={{ fontSize:9, color:'#FFB800', marginTop:2 }}>архив</div>}
                  </td>
                  <td>
                    <span style={{fontSize:10,padding:'2px 7px',borderRadius:6,background:o.type==='restaurant'?'rgba(255,140,0,.12)':'rgba(31,215,96,.1)',color:o.type==='restaurant'?'#FF8C00':'#1FD760'}}>{o.type==='restaurant'?`🍽 ${o.rest||''}` :o.type==='mixed'?'🔀 Смеш.':'🛒'}</span>
                  </td>
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
                  <td onClick={e => e.stopPropagation()}>
                    <button
                      type="button"
                      title="Удалить заказ"
                      disabled={bulkDeleting || bulkStatusChanging || deletingId === o.id}
                      onClick={() => removeOrders([o])}
                      className="btn"
                      style={{ width:30, height:30, borderRadius:8, background:'rgba(255,69,69,.1)', border:'1px solid rgba(255,69,69,.25)', color:'#FF4545', fontSize:13 }}
                    >
                      🗑
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── PRODUCTS ───────────────────────────────────── */
function BulkPricingFields({ tiers, onChange, sellType }) {
  const rows = Array.isArray(tiers) && tiers.length ? tiers : []
  const unit = sellType === 'weight' ? 'г' : 'шт'
  const setRow = (i, patch) => {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  return (
    <div style={{ padding:'12px 14px', borderRadius:12, background:'#0C1C0F', border:'1px solid #162B1A' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
        <div style={{ fontSize:11, color:'#8FB897', fontWeight:700 }}>📦 Оптовые цены</div>
        <button type="button" onClick={() => onChange([...rows, { minQty: '', price: '' }])} className="ab abg" style={{ padding:'4px 10px', fontSize:11 }}>+ Уровень</button>
      </div>
      <div style={{ fontSize:10, color:'#3D6645', marginBottom:10, lineHeight:1.45 }}>
        При достижении количества цена за {sellType === 'weight' ? 'порцию' : 'шт'} меняется для всей позиции. Пример: кекс — от 24 шт по 1.8 ЅМ.
      </div>
      {!rows.length ? (
        <div style={{ fontSize:11, color:'#3D6645' }}>Одна розничная цена. Нажмите «+ Уровень» для опта.</div>
      ) : rows.map((row, i) => (
        <div key={i} style={{ display:'grid', gridTemplateColumns:'1fr 1fr auto', gap:8, marginBottom:8 }}>
          <div>
            <div style={{ fontSize:10, color:'#3D6645', marginBottom:4 }}>От ({unit})</div>
            <input className="ai" type="number" value={row.minQty} onChange={e => setRow(i, { minQty: e.target.value })} placeholder="24" />
          </div>
          <div>
            <div style={{ fontSize:10, color:'#3D6645', marginBottom:4 }}>Цена (ЅМ)</div>
            <input className="ai" type="number" step="0.01" value={row.price} onChange={e => setRow(i, { price: e.target.value })} placeholder="1.80" />
          </div>
          <button type="button" onClick={() => onChange(rows.filter((_, idx) => idx !== i))} className="ab abd" style={{ alignSelf:'end', padding:'8px 10px', fontSize:11 }}>✕</button>
        </div>
      ))}
    </div>
  )
}

function serializeBulkPricing(rows) {
  return normalizeBulkPricing(
    (rows || []).map(r => ({ minQty: Number(r.minQty), price: Number(r.price) })),
  )
}

function ProductsPage() {
  const { setPhoto, getPhoto, hydrate } = useProductPhotos();
  const apiProducts = useProducts(s => s.products);
  const productsLoaded = useProducts(s => s.loaded);
  const saveProduct = useProducts(s => s.saveProduct);
  const removeProduct = useProducts(s => s.removeProduct);
  const prods = useMemo(
    () => (USE_API && !productsLoaded ? [] : stripProductSaleFields(enrichProducts(apiProducts, PRODS))),
    [apiProducts, productsLoaded],
  );
  const [search,  setSearch]  = useState('');
  const [catFlt,  setCatFlt]  = useState('all');
  const [statFlt, setStatFlt] = useState('all');
  const [syncMsg, setSyncMsg] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editP,   setEditP]   = useState(null);
  const [nName,   setNName]   = useState('');
  const [nArt,    setNArt]    = useState('');
  const [nPrice,  setNPrice]  = useState('');
  const [nCostPrice, setNCostPrice] = useState('');
  const [nCat,    setNCat]    = useState('veg');
  const [nUnit,   setNUnit]   = useState('');
  const [nEmoji,  setNEmoji]  = useState('📦');
  const [nPhoto,  setNPhoto]  = useState('');
  const [nPhotoThumb, setNPhotoThumb] = useState('');
  const [nStock,  setNStock]  = useState('');
  const [nOrganic,setNOrganic]= useState(false);
  const [nSellType,setNSellType]=useState('piece');
  const [nWeightStep,setNWeightStep]=useState('100');
  const [nUnitGrams,setNUnitGrams]=useState('1000');
  const [nDesc,setNDesc]=useState('');
  const [nBulkPricing, setNBulkPricing] = useState([]);
  const [editForm,setEditForm]=useState(null);
  const [ePhoto,  setEPhoto]  = useState('');
  const [ePhotoThumb, setEPhotoThumb] = useState('');

  useEffect(() => { hydrate(); }, [hydrate]);
  useEffect(() => {
    if (!editP) { setEditForm(null); return; }
    setEPhoto(editP.photo || getPhoto(editP.id) || '');
    setEPhotoThumb(editP.photoThumb || '');
    setEditForm({
      name: editP.name,
      art: editP.art,
      e: editP.e || '📦',
      desc: editP.desc || '',
      brand: editP.brand || '',
      country: editP.country || '',
      barcode: editP.barcode || '',
      price: editP.price,
      costPrice: editP.costPrice ?? '',
      stock: editP.stock,
      unit: editP.unit || 'шт',
      catId: editP.catId,
      sellType: editP.sellType || 'piece',
      weightStep: editP.weightStep || 100,
      minWeight: editP.minWeight || editP.weightStep || 100,
      unitGrams: editP.unitGrams || productUnitGrams(editP),
      hot: !!editP.hot,
      organic: !!editP.organic,
      bulkPricing: (editP.bulkPricing || []).map(t => ({ minQty: t.minQty, price: t.price })),
    });
  }, [editP, getPhoto]);

  const syncGBS = async () => {
    setSyncMsg('loading');
    try {
      const r = USE_API ? await api.syncGBS() : { synced: 0 };
      setSyncMsg(`demo:${r?.synced ?? 0}`);
    } catch {
      setSyncMsg('demo:0');
    }
    setTimeout(()=>setSyncMsg(''),5000);
  };

  const toggleStatFlt = (id) => setStatFlt(s => s === id ? 'all' : id);

  const statLabels = {
    all: 'Все',
    inStock: 'В наличии',
    low: 'Мало (≤3)',
    out: 'Нет в наличии',
    hot: 'Хиты',
    bulk: 'С оптом',
  };

  const matchStat = (p) => {
    if (statFlt === 'inStock') return p.stock > 3;
    if (statFlt === 'low') return p.stock > 0 && p.stock <= 3;
    if (statFlt === 'out') return p.stock === 0;
    if (statFlt === 'hot') return !!p.hot;
    if (statFlt === 'bulk') return hasBulkPricing(p);
    return true;
  };

  const filtered = prods.filter(p => {
    const q = search.toLowerCase();
    const matchQ = !search || p.name.toLowerCase().includes(q) || p.art.toLowerCase().includes(q) || p.cat.toLowerCase().includes(q);
    const matchC = catFlt==='all' || p.catId===catFlt;
    return matchQ && matchC && matchStat(p);
  });

  const resetAddForm = () => {
    setNName(''); setNArt(''); setNPrice(''); setNCostPrice(''); setNUnit(''); setNStock('');
    setNEmoji('📦'); setNPhoto(''); setNPhotoThumb(''); setNOrganic(false); setNSellType('piece');
    setNWeightStep('100'); setNUnitGrams('1000'); setNDesc(''); setNBulkPricing([]);
  };

  const closeAddModal = () => { setShowAdd(false); resetAddForm(); };

  const addProd = async () => {
    if(!nName||!nPrice) return;
    try {
      const { nextFreeProductCode } = await import('@/lib/productCodes');
      const next = nextFreeProductCode(prods);
      const code = String(next);
      const product = {
        art: nArt.trim() || code,
        e:nEmoji, name:nName, price:Number(nPrice),
        costPrice: nCostPrice ? Number(nCostPrice) : null,
        cat:CATS_LIST.find(c=>c.id===nCat)?.name||nCat, catId:nCat,
        unit:nUnit||'шт', stock:Number(nStock)||0, hot:false, organic:nOrganic,
        desc:nDesc||undefined, sellType:nSellType,
        plu: code,
        ...(nSellType==='weight' ? {
          weightStep:Number(nWeightStep)||100,
          minWeight:Number(nWeightStep)||100,
          unitGrams:Number(nUnitGrams)||1000,
        } : {}),
        photo:nPhoto||undefined,
        photoThumb:nPhotoThumb||undefined,
        bulkPricing: serializeBulkPricing(nBulkPricing),
      };
      const saved = await saveProduct(product);
      if (saved && nPhoto) setPhoto(saved.id, nPhoto);
      closeAddModal();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось сохранить товар');
    }
  };

  const saveEdit = async () => {
    if (!editP || !editForm) return;
    const price = Number(editForm.price);
    const costPrice = editForm.costPrice !== '' && editForm.costPrice != null ? Number(editForm.costPrice) : null;
    const updated = {
      ...editP,
      ...editForm,
      price,
      costPrice,
      stock: Number(editForm.stock),
      catId: editForm.catId,
      cat: CATS_LIST.find(c=>c.id===editForm.catId)?.name || editP.cat,
      photo: ePhoto || null,
      photoThumb: ePhotoThumb || null,
      sellType: editForm.sellType || 'piece',
      ...(editForm.sellType === 'weight' ? {
        weightStep: Number(editForm.weightStep) || 100,
        minWeight: Number(editForm.minWeight) || Number(editForm.weightStep) || 100,
        unitGrams: Number(editForm.unitGrams) || 1000,
      } : { weightStep: undefined, minWeight: undefined, unitGrams: undefined }),
      bulkPricing: serializeBulkPricing(editForm.bulkPricing),
    };
    await saveProduct(updated);
    if (ePhoto) setPhoto(editP.id, ePhoto);
    else useProductPhotos.getState().removePhoto(editP.id);
    setEditP(null);
  };

  const delProd = async (id) => { await removeProduct(id); };

  const cats = CATS_LIST;
  const byCat = cats.map(c=>({...c, count: prods.filter(p=>p.catId===c.id).length}));
  const withBulk = prods.filter(p => hasBulkPricing(p)).length;

  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:12,marginBottom:18}}>
        <StatCard l="Всего позиций" v={prods.length} onClick={()=>setStatFlt('all')} active={statFlt==='all'}/>
        <StatCard l="В наличии" v={prods.filter(p=>p.stock>3).length} c="#1FD760" onClick={()=>toggleStatFlt('inStock')} active={statFlt==='inStock'}/>
        <StatCard l="Мало (≤3)" v={prods.filter(p=>p.stock>0&&p.stock<=3).length} c="#FFB800" onClick={()=>toggleStatFlt('low')} active={statFlt==='low'}/>
        <StatCard l="Нет в наличии" v={prods.filter(p=>p.stock===0).length} c="#FF4545" onClick={()=>toggleStatFlt('out')} active={statFlt==='out'}/>
        <StatCard l="Хиты" v={prods.filter(p=>p.hot).length} c="#FF8C00" onClick={()=>toggleStatFlt('hot')} active={statFlt==='hot'}/>
        <StatCard l="С оптом" v={withBulk} c="#FF8C00" onClick={()=>toggleStatFlt('bulk')} active={statFlt==='bulk'}/>
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:18, overflowX:'auto', paddingBottom:4 }}>
        <button type="button" onClick={()=>setCatFlt('all')} className="ab" style={{ flexShrink:0, minWidth:72, padding:'10px 12px', borderRadius:12, textAlign:'center', background:catFlt==='all'?'rgba(31,215,96,.14)':'#091508', border:`1.5px solid ${catFlt==='all'?'rgba(31,215,96,.35)':'#162B1A'}`, color:catFlt==='all'?'#1FD760':'#8FB897' }}>
          <div style={{ fontSize:18, marginBottom:2 }}>🏪</div>
          <div style={{ fontSize:10, fontWeight:700 }}>Все</div>
          <div style={{ fontSize:10, opacity:.7 }}>{prods.length}</div>
        </button>
        {byCat.map(c=>(
          <button key={c.id} type="button" onClick={()=>setCatFlt(c.id)} className="ab" style={{ flexShrink:0, minWidth:72, padding:'10px 12px', borderRadius:12, textAlign:'center', background:catFlt===c.id?'rgba(31,215,96,.14)':'#091508', border:`1.5px solid ${catFlt===c.id?'rgba(31,215,96,.35)':'#162B1A'}`, color:catFlt===c.id?'#1FD760':'#8FB897' }}>
            <div style={{ fontSize:18, marginBottom:2 }}>{c.e}</div>
            <div style={{ fontSize:10, fontWeight:700, lineHeight:1.2 }}>{c.name.split(' ')[0]}</div>
            <div style={{ fontSize:10, opacity:.7 }}>{c.count}</div>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{display:'flex',gap:10,marginBottom:14,alignItems:'center',flexWrap:'wrap'}}>
        <div style={{position:'relative',flex:1,maxWidth:320}}>
          <div style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',fontSize:15,pointerEvents:'none'}}>🔍</div>
          <input className="ai" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Артикул, название, категория..." style={{paddingLeft:38}}/>
        </div>
        {syncMsg.startsWith('demo:')&&<div style={{fontSize:11,color:'#FFB800',fontWeight:700}}>⚠ Demo-режим: GBS Market не подключён (синхронизировано: {syncMsg.split(':')[1]})</div>}
        <div style={{marginLeft:'auto',display:'flex',gap:8}}>
          <button onClick={syncGBS} className="ab abg" style={{display:'flex',alignItems:'center',gap:6}}>
            {syncMsg==='loading'?<div style={{width:13,height:13,borderRadius:'50%',border:'2px solid rgba(31,215,96,.3)',borderTopColor:'#1FD760',animation:'spin 1s linear infinite'}}/>:'🔄'}
            {syncMsg==='loading'?'Синхронизация...':'Синх. GBS Market'}
          </button>
          <button onClick={()=>setShowAdd(true)} className="ab abp" style={{display:'flex',alignItems:'center',gap:6}}>+ Добавить товар</button>
        </div>
      </div>

      <div style={{fontSize:12,color:'#3D6645',marginBottom:10}}>
        Показано {filtered.length} из {prods.length} товаров
        {statFlt!=='all'?` · ${statLabels[statFlt]}`:''}
        {catFlt!=='all'?` · ${CATS_LIST.find(c=>c.id===catFlt)?.name}`:''}
      </div>

      {/* Table */}
      <div className="ac" style={{ overflow:'hidden' }}>
        <table className="at">
          <thead><tr><th>Артикул</th><th>Товар</th><th>Категория</th><th>Цена</th><th>Опт</th><th>Ед.</th><th>Остаток</th><th>Хит</th><th>Орг.</th><th></th></tr></thead>
          <tbody>
            {filtered.map(p=>{
              const sc=p.stock===0?{c:'#FF4545',l:'Нет'}:p.stock<=3?{c:'#FFB800',l:'Мало'}:{c:'#1FD760',l:'Есть'};
              const bulkHint = formatBulkPricingHint(p);
              return (
                <tr key={p.id} onClick={()=>setEditP(p)} style={{ cursor:'pointer', transition:'background .15s' }} onMouseEnter={e=>{ e.currentTarget.style.background='rgba(31,215,96,.04)'; }} onMouseLeave={e=>{ e.currentTarget.style.background='transparent'; }}>
                  <td><span className="ub" style={{fontSize:11,color:'#FFB800',letterSpacing:.5}}>{p.art}</span></td>
                  <td>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <div style={{width:44,height:44,borderRadius:11,flexShrink:0,overflow:'hidden'}}>
                        <ProductImage product={p} preferThumb getPhoto={getPhoto} size={44} radius={11} plate="dark" />
                      </div>
                    <div>
                        <div style={{fontWeight:700,fontSize:13,lineHeight:1.25}}>{p.name}</div>
                        {p.desc && <div style={{fontSize:10,color:'#3D6645',marginTop:2,maxWidth:220,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.desc}</div>}
                      </div>
                    </div>
                  </td>
                  <td><span style={{padding:'3px 8px',borderRadius:8,fontSize:10,fontWeight:700,background:'rgba(59,142,240,.1)',color:'#3B8EF0',border:'1px solid rgba(59,142,240,.2)'}}>{p.cat}</span></td>
                  <td>
                    <div className="ub" style={{fontSize:13,fontWeight:900}}>{p.price.toFixed(2)} <span style={{fontSize:9,color:'#FFB800'}}>ЅМ</span></div>
                  </td>
                  <td style={{ fontSize:10, color: bulkHint ? '#FF8C00' : '#3D6645', maxWidth:110, lineHeight:1.35 }}>
                    {bulkHint || '—'}
                  </td>
                  <td style={{fontSize:11,color:'#8FB897'}}>{p.unit}{isWeighted(p)?' ⚖️':''}</td>
                  <td onClick={e=>e.stopPropagation()}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div style={{width:52,height:7,borderRadius:4,background:'#162B1A',overflow:'hidden'}}><div style={{height:'100%',width:`${Math.min(100,p.stock/25*100)}%`,background:sc.c,borderRadius:4}}/></div>
                      <span style={{fontSize:12,fontWeight:800,color:sc.c,minWidth:18}}>{p.stock}</span>
                    </div>
                  </td>
                  <td onClick={e=>e.stopPropagation()}>
                    <div onClick={()=>void saveProduct({ ...p, hot: !p.hot }).catch(()=>{})} style={{width:36,height:20,borderRadius:10,background:p.hot?'#1FD760':'#1D3822',position:'relative',cursor:'pointer',flexShrink:0}}>
                      <div style={{position:'absolute',top:2,left:p.hot?17:2,width:16,height:16,borderRadius:'50%',background:'white',transition:'left .2s'}}/>
                    </div>
                  </td>
                  <td onClick={e=>e.stopPropagation()}>
                    <div onClick={()=>void saveProduct({ ...p, organic: !p.organic }).catch(()=>{})} style={{width:36,height:20,borderRadius:10,background:p.organic?'#34D399':'#1D3822',position:'relative',cursor:'pointer',flexShrink:0}}>
                      <div style={{position:'absolute',top:2,left:p.organic?17:2,width:16,height:16,borderRadius:'50%',background:'white',transition:'left .2s'}}/>
                    </div>
                  </td>
                  <td onClick={e=>e.stopPropagation()}>
                    <div style={{display:'flex',gap:5}}>
                      <button onClick={()=>setEditP(p)} className="ab abg" style={{padding:'5px 9px',fontSize:11}}>✏️</button>
                      <button onClick={()=>delProd(p.id)} className="ab abd" style={{padding:'5px 9px',fontSize:11}}>🗑</button>
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
              <PhotoUploadField
                value={nPhoto}
                onChange={photo => { setNPhoto(photo); if (!photo) setNPhotoThumb(''); }}
                onUploaded={(photo, thumb) => { setNPhoto(photo); setNPhotoThumb(thumb); }}
              />
              <div style={{display:'grid',gridTemplateColumns:'72px 1fr 1fr',gap:12}}>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Emoji</div><input className="ai" value={nEmoji} onChange={e=>setNEmoji(e.target.value)} style={{textAlign:'center',fontSize:24,height:48}}/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Название *</div><input className="ai" value={nName} onChange={e=>setNName(e.target.value)} placeholder="Название товара"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Артикул</div><input className="ai" value={nArt} onChange={e=>setNArt(e.target.value.replace(/\D/g,''))} placeholder="Авто (свободный номер)"/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Цена (ЅМ) *</div><input className="ai" value={nPrice} onChange={e=>setNPrice(e.target.value)} type="number" placeholder="0.00"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Цена прихода (ЅМ)</div><input className="ai" value={nCostPrice} onChange={e=>setNCostPrice(e.target.value)} type="number" step="0.01" placeholder="Закупка"/></div>
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
              <BulkPricingFields tiers={nBulkPricing} onChange={setNBulkPricing} sellType={nSellType} />
              <div style={{display:'flex',gap:16,padding:'10px 14px',borderRadius:11,background:'#0C1C0F',border:'1px solid #162B1A'}}>
                <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13,fontWeight:600}}>
                  <input type="checkbox" onChange={e=>setNOrganic(e.target.checked)} style={{width:16,height:16,accentColor:'#34D399'}}/>
                  🌿 Органик продукт
                </label>
              </div>
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
              <PhotoUploadField
                value={ePhoto}
                onChange={photo => { setEPhoto(photo); if (!photo) setEPhotoThumb(''); }}
                onUploaded={(photo, thumb) => { setEPhoto(photo); setEPhotoThumb(thumb); }}
                productId={editP?.id}
                height={160}
              />
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
              <BulkPricingFields
                tiers={editForm.bulkPricing}
                onChange={bulkPricing => setEditForm(f => ({ ...f, bulkPricing }))}
                sellType={editForm.sellType}
              />
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Цена продажи (ЅМ)</div><input className="ai" value={editForm.price} onChange={e=>setEditForm(f=>({...f,price:e.target.value}))} type="number" step="0.01"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Цена прихода (ЅМ)</div><input className="ai" value={editForm.costPrice} onChange={e=>setEditForm(f=>({...f,costPrice:e.target.value}))} type="number" step="0.01" placeholder="Закупка"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Остаток</div><input className="ai" value={editForm.stock} onChange={e=>setEditForm(f=>({...f,stock:e.target.value}))} type="number"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Единица (отображение)</div><input className="ai" value={editForm.unit} onChange={e=>setEditForm(f=>({...f,unit:e.target.value}))} placeholder="500 гр / шт / 1 л"/></div>
              </div>
              {editForm.costPrice !== '' && editForm.price && Number(editForm.price) > Number(editForm.costPrice) && (
                <div style={{fontSize:11,color:'#8FB897',padding:'8px 12px',borderRadius:9,background:'rgba(31,215,96,.06)',border:'1px solid rgba(31,215,96,.15)'}}>
                  Наценка: <span style={{color:'#1FD760',fontWeight:800}}>+{(Number(editForm.price) - Number(editForm.costPrice)).toFixed(2)} ЅМ</span>
                  {' · '}
                  <span style={{color:'#1FD760',fontWeight:700}}>{Math.round((1 - Number(editForm.costPrice) / Number(editForm.price)) * 100)}% маржа</span>
                </div>
              )}
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
  const restaurantsLoaded = useRestaurants(s => s.loaded);
  const toggleOpenApi = useRestaurants(s => s.toggleOpen);
  const blockRestaurantApi = useRestaurants(s => s.blockRestaurant);
  const fetchRestaurantsApi = useRestaurants(s => s.fetchRestaurants);
  const createRestaurantApi = useRestaurants(s => s.createRestaurant);
  const deleteRestaurantApi = useRestaurants(s => s.deleteRestaurant);
  const updateRestaurantApi = useRestaurants(s => s.updateRestaurant);
  const toggleMenuApi = useRestaurants(s => s.toggleMenuItem);
  const [rests, setRests] = useState<any[]>(() => (USE_API ? [] : RESTAURANTS.map(r => ({ ...r }))));
  const [savingInfo, setSavingInfo] = useState(false);
  useEffect(() => {
    if (USE_API && restaurantsLoaded) {
      setRests(enrichRestaurants(apiRests, RESTAURANTS));
    }
  }, [apiRests, restaurantsLoaded]);
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
    preloadLeaflet();
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

  const saveAdd = async () => {
    if (!addForm.name.trim()) { setLocError('Укажите название ресторана'); return; }
    if (addForm.lat == null || addForm.lng == null) { setLocError('Выберите место на карте'); return; }
    const commission = Number(addForm.commission) || 15;
    const payload = {
      name: addForm.name.trim(), emoji: addForm.emoji || '🍽',
      cuisine: addForm.cuisine.trim() || '—', address: addForm.address.trim(),
      phone: addForm.phone.trim(), email: addForm.email.trim(), commission,
    };
    try {
      const created = await createRestaurantApi(payload);
      const newRest = created || {
        id: `R-0${rests.length + 1}`, ...payload,
        open: true, rating: 5, reviews: 0, ordersMonth: 0, revenueMonth: 0,
        img: 'linear-gradient(135deg,#1A0808,#3A1010)', menu: [],
      };
      // В режиме API эффект синхронизации сам обновит список из стора.
      if (!USE_API) setRests(rs => [...rs, newRest]);
      pushPickup(newRest, addForm.lat, addForm.lng, addForm.address, addForm.phone, true);
      setShowAdd(false);
      resetAddForm();
    } catch (e) {
      console.error(e);
      setLocError('Не удалось сохранить ресторан. Попробуйте ещё раз.');
    }
  };

  return (
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        <StatCard l="Партнёров" v={rests.length}/>
        <StatCard l="Открыто" v={rests.filter(r=>r.open).length} c="#1FD760"/>
        <StatCard l="Закрыто" v={rests.filter(r=>!r.open).length} c="#FF4545"/>
        <StatCard l="Комиссия/мес" v={`${totalComm.toLocaleString()} ЅМ`} c="#FFB800"/>
      </div>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:14}}>
        <button onClick={() => { preloadLeaflet(); setShowAdd(true); }} className="ab abp" style={{display:'flex',alignItems:'center',gap:6}}>+ Добавить ресторан</button>
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
                <button
                  type="button"
                  className="ab abd"
                  style={{padding:'7px 10px',fontSize:11}}
                  title="Удалить ресторан"
                  onClick={async () => {
                    if (!window.confirm(`Удалить ресторан «${r.name}»? Это нельзя отменить.`)) return;
                    try {
                      await deleteRestaurantApi(r.id);
                      setRests(rs => rs.filter(x => x.id !== r.id));
                      if (sel?.id === r.id) setSel(null);
                    } catch (e) {
                      window.alert(e instanceof Error ? e.message : 'Не удалось удалить');
                    }
                  }}
                >🗑</button>
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
                <AdminLocationMap
                  mapKey={`rest-edit-${sel.id}`}
                  lat={editForm.lat}
                  lng={editForm.lng}
                  addressLabel="Адрес ресторана"
                  onCenterChange={r => {
                    setEditForm((x: any) => ({
                      ...x,
                      lat: r.lat,
                      lng: r.lng,
                      address: r.address?.trim() ? r.address : x.address,
                    }));
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
                <button
                  type="button"
                  className="ab abd"
                  style={{width:'100%',padding:10,marginTop:10}}
                  onClick={async () => {
                    if (!window.confirm(`Удалить ресторан «${sel.name}»? Это нельзя отменить.`)) return;
                    try {
                      await deleteRestaurantApi(sel.id);
                      setRests(rs => rs.filter(x => x.id !== sel.id));
                      setSel(null);
                    } catch (e) {
                      window.alert(e instanceof Error ? e.message : 'Не удалось удалить');
                    }
                  }}
                >
                  🗑 Удалить ресторан
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
              <AdminLocationMap
                mapKey="rest-add"
                lat={addForm.lat}
                lng={addForm.lng}
                addressLabel="Адрес ресторана"
                onCenterChange={r => setAddForm(f => ({ ...f, lat: r.lat, lng: r.lng, address: r.address?.trim() ? r.address : f.address }))}
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
function isStoreReview(rev: Review) {
  return String(rev.restId || '') === STORE_REVIEW_REST_ID
}

function ReviewsPage() {
  const apiRests = useRestaurants(s => s.restaurants);
  const restaurantsLoaded = useRestaurants(s => s.loaded);
  const rests = useMemo(
    () => (!USE_API ? RESTAURANTS : (restaurantsLoaded ? enrichRestaurants(apiRests, RESTAURANTS) : [])),
    [apiRests, restaurantsLoaded],
  );
  const [reviews, setReviews] = useState(REVIEWS);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'store' | 'restaurants'>('restaurants');
  const [replyId, setReplyId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [deleting, setDeleting] = useState(false);

  const loadReviews = async () => {
    if (!USE_API) { setReviews([]); return; }
    setLoading(true);
    try {
      const list = await api.getReviews();
      setReviews(sortReviewsNewestFirst(list));
    } catch {
      setReviews([]);
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

  const storeReviews = reviews.filter(isStoreReview);
  const restaurantReviews = reviews.filter(r => !isStoreReview(r));
  const visible = tab === 'store' ? storeReviews : restaurantReviews;
  const visibleIds = visible.map(r => r.id);
  const allVisibleSelected = visible.length > 0 && visible.every(r => selected.has(r.id));
  const selectedOnTab = visible.filter(r => selected.has(r.id));
  const avgRating = avgReviewRating(visible);
  const avgLabel = avgRating != null ? `${avgRating} ★` : '—';

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach(id => next.delete(id));
      else visibleIds.forEach(id => next.add(id));
      return next;
    });
  };

  const deleteReviewsByIds = async (ids: number[]) => {
    if (!ids.length || deleting) return;
    if (!window.confirm(ids.length === 1 ? 'Удалить этот отзыв?' : `Удалить выбранные отзывы (${ids.length})?`)) return;
    setDeleting(true);
    try {
      if (USE_API) {
        if (ids.length === 1) await api.deleteReview(ids[0]);
        else await api.deleteReviewsBulk(ids);
      }
      setReviews(rs => rs.filter(r => !ids.includes(r.id)));
      setSelected(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.delete(id));
        return next;
      });
      if (replyId != null && ids.includes(replyId)) {
        setReplyId(null);
        setReplyText('');
      }
    } catch {
      window.alert('Не удалось удалить отзыв(ы). Попробуйте ещё раз.');
    } finally {
      setDeleting(false);
    }
  };

  const Stars = ({ n }: { n: number }) => (
    <span>{[1, 2, 3, 4, 5].map(i => <span key={i} style={{ color: i <= n ? '#FFB800' : '#1D3822', fontSize: 13 }}>★</span>)}</span>
  );

  const tabBtn = (id: 'store' | 'restaurants', label: string, count: number, color: string) => {
    const on = tab === id;
    return (
      <button
        type="button"
        onClick={() => { setTab(id); setReplyId(null); setReplyText(''); setSelected(new Set()); }}
        className="ab"
        style={{
          padding: '8px 16px',
          fontSize: 12,
          fontWeight: 800,
          borderRadius: 12,
          background: on ? `${color}18` : 'transparent',
          border: `1.5px solid ${on ? `${color}55` : '#162B1A'}`,
          color: on ? color : '#8FB897',
        }}
      >
        {label} ({count})
      </button>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {tabBtn('store', '🛒 Магазин', storeReviews.length, '#1FD760')}
          {tabBtn('restaurants', '🍽 Рестораны', restaurantReviews.length, '#FF8C00')}
        </div>
        <button onClick={loadReviews} className="ab" style={{ padding: '6px 12px', fontSize: 11 }} disabled={loading}>
          {loading ? '…' : '↻ Обновить'}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
        <StatCard l="Всего отзывов" v={visible.length} />
        <StatCard l="Новых" v={visible.filter(r => r.status === 'new').length} c="#FF4545" />
        <StatCard l="Жалоб (≤2★)" v={visible.filter(r => r.rating <= 2).length} c="#FF4545" />
        <StatCard l="Средний рейтинг" v={avgLabel} c="#FFB800" />
      </div>
      {visible.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#8FB897', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAllVisible}
              style={{ width: 16, height: 16, accentColor: '#1FD760' }}
            />
            Выбрать все на вкладке ({visible.length})
          </label>
          {selectedOnTab.length > 0 && (
            <button
              type="button"
              onClick={() => deleteReviewsByIds(selectedOnTab.map(r => r.id))}
              disabled={deleting}
              className="ab abd"
              style={{ padding: '6px 14px', fontSize: 11 }}
            >
              {deleting ? 'Удаление…' : `🗑 Удалить выбранные (${selectedOnTab.length})`}
            </button>
          )}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!loading && visible.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#8FB897', fontSize: 13 }}>
            {tab === 'store' ? 'Пока нет отзывов о магазине' : 'Пока нет отзывов о ресторанах'}
          </div>
        )}
        {visible.map((rev, i) => {
          const place = resolveReviewPlaceName(rev.restId, rev, rests);
          const isStore = isStoreReview(rev);
          return (
            <div key={rev.id} className="ac" style={{ padding: '15px 17px', border: `1.5px solid ${selected.has(rev.id) ? 'rgba(31,215,96,.45)' : rev.status === 'new' ? 'rgba(255,69,69,.3)' : '#162B1A'}`, animation: `fadeUp .4s ease ${i * .06}s both` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={selected.has(rev.id)}
                    onChange={() => toggleSelect(rev.id)}
                    style={{ width: 16, height: 16, marginTop: 10, accentColor: '#1FD760', flexShrink: 0 }}
                  />
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
                    <span style={{ fontSize: 11, color: '#8FB897' }}>{place}</span>
              </div>
                  {rev.status === 'new' && <Badge v="Новый" c="#FF4545" />}
                  {!isStore && (rev.restSeen ? <Badge v="Ресторан видел" c="#1FD760" /> : <Badge v="Не прочитан рест." c="#FFB800" />)}
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
              {!isStore && rev.restReply && (
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
                    <button onClick={() => patchReview(rev.id, { urgent: true })} className="ab abd" style={{ padding: '5px 12px', fontSize: 11 }}>⚠️ Важно</button>
                  )}
                  <button onClick={() => deleteReviewsByIds([rev.id])} disabled={deleting} className="ab abd" style={{ padding: '5px 12px', fontSize: 11 }}>🗑 Удалить</button>
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
  const { addCourier, updateCourier, deleteCourier, toggleBlock, depositBalance, withdrawBalance } = useCourierTeamStore();
  const apiOrders = useOrders(s => s.orders);
  const pricing = usePricingStore(s => s.pricing);
  const tariff = useMemo(() => normalizePricing({ ...DEFAULT_PRICING, ...pricing }), [pricing]);
  const defaultCommissionPercent = useMemo(() => getCourierCommissionPercent(tariff), [tariff]);
  const defaultMinCommission = useMemo(() => getMinCourierCommissionEstimate(tariff), [tariff]);
  const { roadKm } = useOrderRoadKm(apiOrders);
  const financeRows = useMemo(
    () => buildCourierFinance(apiOrders, couriers, roadKm, tariff),
    [apiOrders, couriers, roadKm, tariff],
  );
  const financeById = useMemo(
    () => Object.fromEntries(financeRows.map(r => [r.id, r])),
    [financeRows],
  );
  const deliveryOrders = useMemo(
    () => buildCourierDeliveryOrderRows(apiOrders, roadKm, tariff),
    [apiOrders, roadKm, tariff],
  );
  const reportSummary = useMemo(
    () => courierTariffSummary(apiOrders, couriers, tariff, roadKm),
    [apiOrders, couriers, tariff, roadKm],
  );
  const clientDeliveryTotal = useMemo(
    () => apiOrders
      .filter(o => o.status === 'delivered')
      .reduce((s, o) => s + (Number(o.deliveryFee) || 0), 0),
    [apiOrders],
  );
  const [editId, setEditId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyCourierForm());
  const [formErr, setFormErr] = useState('');
  const [depositId, setDepositId] = useState<string | null>(null);
  const [depositAccountQuery, setDepositAccountQuery] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [depositNote, setDepositNote] = useState('');
  const [depositErr, setDepositErr] = useState('');
  const [depositing, setDepositing] = useState(false);
  const [walletActionMode, setWalletActionMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [depositWalletTx, setDepositWalletTx] = useState<(CourierWalletTx & { courierName?: string; account?: string })[]>([]);
  const [depositWalletLoading, setDepositWalletLoading] = useState(false);
  const [walletTxFilter, setWalletTxFilter] = useState<'all' | 'deposit' | 'withdrawal' | 'commission' | 'refund'>('all');
  const [walletSearchQuery, setWalletSearchQuery] = useState('');
  const [section, setSection] = useState<'list' | 'wallet'>('list');
  const [commissionInput, setCommissionInput] = useState('');
  const [commissionSaving, setCommissionSaving] = useState(false);
  const [commissionSaved, setCommissionSaved] = useState(false);
  const [commissionErr, setCommissionErr] = useState('');

  const walletSummary = useMemo(() => {
    let totalBalance = 0;
    let lowCount = 0;
    for (const c of couriers) {
      const balance = getCourierBalance(c);
      const commission = getMinCourierCommissionEstimate(tariff, c);
      totalBalance += balance;
      if (commission > 0 && balance + 0.001 < commission) lowCount += 1;
    }
    return { totalBalance, lowCount };
  }, [couriers, tariff]);

  useEffect(() => {
    setCommissionInput(String(tariff.courierCommissionPercent ?? DEFAULT_PRICING.courierCommissionPercent ?? 15));
  }, [tariff.courierCommissionPercent]);

  const loadDepositWalletTx = useCallback(async (courierId: string, opts?: { silent?: boolean }) => {
    if (!courierId) {
      setDepositWalletTx([]);
      return;
    }
    if (!opts?.silent) setDepositWalletLoading(true);
    try {
      const couriersNow = useCourierTeamStore.getState().couriers;
      const c = couriersNow.find(x => x.id === courierId);
      if (USE_API) {
        const snap = await api.getCourierWalletTransactions(courierId, 50);
        setDepositWalletTx((snap.transactions || []).map(t => ({
          ...t,
          account: formatCourierAccountDisplay(snap.account, courierId),
          courierName: c?.name,
        })));
      } else {
        setDepositWalletTx(getLocalCourierWalletTransactions(courierId, 50).map(t => ({
          ...t,
          account: formatCourierAccountDisplay(c?.account, courierId),
          courierName: c?.name,
        })));
      }
    } catch {
      if (!opts?.silent) setDepositWalletTx([]);
    } finally {
      if (!opts?.silent) setDepositWalletLoading(false);
    }
  }, []);

  const depositWalletTxLoaded = useRef(false);

  useEffect(() => {
    if (!depositId) {
      depositWalletTxLoaded.current = false;
      setDepositWalletTx([]);
      return;
    }
    depositWalletTxLoaded.current = true;
    void loadDepositWalletTx(depositId);
  }, [depositId, loadDepositWalletTx]);

  useEffect(() => {
    if (!depositId || !depositWalletTxLoaded.current) return;
    void loadDepositWalletTx(depositId, { silent: true });
  }, [couriers, depositId, loadDepositWalletTx]);

  const filteredWalletCouriers = useMemo(() => {
    const q = walletSearchQuery.trim().toLowerCase();
    if (!q) return couriers;
    const qDigits = q.replace(/\D/g, '');
    return couriers.filter(c => {
      const name = c.name.toLowerCase();
      const account = formatCourierAccountDisplay(c.account, c.id).toLowerCase();
      const phone = c.phone.replace(/\D/g, '');
      return name.includes(q) || account.includes(q) || (qDigits.length > 0 && phone.includes(qDigits));
    });
  }, [couriers, walletSearchQuery]);

  const selectedWalletCourier = useMemo(
    () => (depositId ? couriers.find(c => c.id === depositId) ?? null : null),
    [couriers, depositId],
  );

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
      balance: c.balance,
      commissionPercent: c.commissionPercent ?? 0,
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

  const saveCourier = async () => {
    const name = form.name.trim();
    const phone = form.phone.trim();
    if (!name || !phone) {
      setFormErr('Укажите ФИО и телефон');
      return;
    }
    const maxActiveOrders = Math.max(1, Math.min(5, Number(form.maxActiveOrders) || 1));
    const customCommission = Math.max(0, Math.min(100, Number(form.commissionPercent) || 0));
    const payload = {
      ...form,
      name,
      phone,
      num: form.num.trim() || '—',
      maxActiveOrders,
      commissionPercent: customCommission > 0 ? customCommission : undefined,
      otp: (form.otp || '1234').trim(),
    };
    try {
      if (editId) updateCourier(editId, payload);
      else await Promise.resolve(addCourier(payload));
      closeModal();
    } catch (e: unknown) {
      setFormErr(e instanceof Error ? e.message : 'Не удалось сохранить курьера');
    }
  };

  const setF = <K extends keyof typeof form>(key: K, val: (typeof form)[K]) =>
    setForm(prev => ({ ...prev, [key]: val }));

  const openDeposit = (c: AdminCourier) => {
    setSection('wallet');
    setDepositId(c.id);
    setDepositAccountQuery(formatCourierAccountDisplay(c.account, c.id));
    setDepositAmount('');
    setDepositNote('');
    setDepositErr('');
    setWalletTxFilter('all');
  };

  const selectWalletCourier = (c: AdminCourier) => {
    setDepositId(c.id);
    setDepositAccountQuery(formatCourierAccountDisplay(c.account, c.id));
    setDepositAmount('');
    setDepositNote('');
    setDepositErr('');
    setWalletTxFilter('all');
    void loadDepositWalletTx(c.id);
  };

  const closeWalletDetail = () => {
    setDepositId(null);
    setDepositAccountQuery('');
    setDepositAmount('');
    setDepositNote('');
    setDepositErr('');
    setDepositWalletTx([]);
  };

  const saveCommissionTariff = async () => {
    const val = Math.max(0, Math.min(100, parseFloat(commissionInput) || 0));
    setCommissionSaving(true);
    setCommissionErr('');
    setCommissionSaved(false);
    try {
      const next = normalizePricing({ ...tariff, courierCommissionPercent: val });
      if (USE_API) {
        const saved = await api.updatePricing(next);
        usePricingStore.setState({ pricing: normalizePricing({ ...DEFAULT_PRICING, ...saved }) });
        try {
          if (typeof BroadcastChannel !== 'undefined') {
            new BroadcastChannel('kakapo-pricing').postMessage({ type: 'update', pricing: saved });
          }
        } catch { /* ignore */ }
      } else {
        usePricingStore.getState().setPricing({ courierCommissionPercent: val });
      }
      setCommissionSaved(true);
      setTimeout(() => setCommissionSaved(false), 2500);
    } catch (e: unknown) {
      setCommissionErr(e instanceof Error ? e.message : 'Не удалось сохранить тариф');
    } finally {
      setCommissionSaving(false);
    }
  };

  const submitDeposit = async () => {
    let id = depositId
    if (!id && depositAccountQuery.trim()) {
      const found = findCourierByAccount(couriers, depositAccountQuery)
      if (found) id = found.id
    }
    if (!id) {
      setDepositErr('Выберите курьера');
      return;
    }
    const amount = parseFloat(depositAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setDepositErr('Укажите сумму пополнения');
      return;
    }
    setDepositing(true);
    setDepositErr('');
    try {
      await depositBalance(id, amount, depositNote.trim() || `Пополнение ${formatCourierAccountDisplay(couriers.find(c => c.id === id)?.account, id)}`);
      setDepositId(id);
      setDepositAmount('');
      setDepositNote('');
      setDepositErr('');
      await loadDepositWalletTx(id);
    } catch (e: unknown) {
      setDepositErr(e instanceof Error ? e.message : 'Не удалось пополнить счёт');
    } finally {
      setDepositing(false);
    }
  };

  const submitWithdraw = async () => {
    if (!depositId) {
      setDepositErr('Выберите курьера');
      return;
    }
    const amount = parseFloat(depositAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setDepositErr('Укажите сумму списания');
      return;
    }
    setDepositing(true);
    setDepositErr('');
    try {
      await withdrawBalance(depositId, amount, depositNote.trim() || 'Списание со счёта');
      setDepositAmount('');
      setDepositNote('');
      setDepositErr('');
      await loadDepositWalletTx(depositId);
    } catch (e: unknown) {
      setDepositErr(e instanceof Error ? e.message : 'Не удалось списать со счёта');
    } finally {
      setDepositing(false);
    }
  };

  const exportCourierReport = () => {
    downloadCsv(
      `kakapo-couriers-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Курьер', 'Транспорт', 'Доставок', 'За доставку ЅМ', 'Рейтинг'],
      financeRows.map(r => [
        r.name,
        vehicleLabel(r.vehicle as AdminCourier['vehicle']),
        r.deliveries,
        r.earnings,
        r.rating,
      ]),
    );
  };

  const printCourierReport = () => {
    const courierTable = `<table><thead><tr><th>Курьер</th><th>Доставок</th><th>За доставку</th><th>Рейтинг</th></tr></thead><tbody>${
      financeRows.map(r => `<tr><td>${r.name}</td><td>${r.deliveries}</td><td>${formatSm(r.earnings)}</td><td>${r.rating}</td></tr>`).join('')
    }</tbody></table>`;
    const ordersTable = `<h2 style="font-size:14px;margin:24px 0 8px">Доставленные заказы</h2><table><thead><tr><th>Заказ</th><th>Курьер</th><th>Товары</th><th>Доставка</th><th>Км</th></tr></thead><tbody>${
      deliveryOrders.map(o => `<tr><td>${o.id}</td><td>${o.courier}</td><td>${formatSm(o.goodsTotal)}</td><td>${formatSm(o.deliveryFee)}</td><td>${o.km}</td></tr>`).join('')
    }</tbody></table>`;
    printFinanceReport(
      'Отчёт курьеров — доставка',
      `<p>Доставок: ${reportSummary.deliveries} · Выплаты курьерам: ${formatSm(reportSummary.totalEarnings)} · Клиенты заплатили за доставку: ${formatSm(clientDeliveryTotal)}</p>${courierTable}${ordersTable}`,
    );
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 12 }}>
        <StatCard l="Всего" v={couriers.length} />
        <StatCard l="Свободных" v={couriers.filter(c => c.status === 'available' && !c.blocked).length} c="#1FD760" />
        <StatCard l="В заказе" v={couriers.filter(c => c.status === 'busy').length} c="#FFB800" />
        <StatCard l="Офлайн" v={couriers.filter(c => c.status === 'offline' || c.blocked).length} c="#3D6645" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 14 }}>
        <StatCard l="Доставок" v={reportSummary.deliveries} c="#3B8EF0" e="📦" />
        <StatCard l="Выплаты курьерам" v={`${formatSm(reportSummary.totalEarnings)}`} c="#FFB800" e="💰" />
        <StatCard l="Ср. за доставку" v={`${formatSm(reportSummary.avgPerDelivery)}`} c="#1FD760" e="📊" />
        <StatCard l="Оплата клиентами" v={`${formatSm(clientDeliveryTotal)}`} c="#00D4C8" e="🛵" sub="только доставка" />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['list', '🛵', 'Список курьеров'],
          ['wallet', '💳', 'Счёт и комиссия'],
        ] as const).map(([id, icon, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              if (id === 'wallet') {
                closeWalletDetail();
                setWalletSearchQuery('');
              }
              setSection(id);
            }}
            className="ab"
            style={{
              padding: '9px 16px',
              fontSize: 12,
              fontWeight: 700,
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              background: section === id ? 'rgba(31,215,96,.12)' : '#0C1C0F',
              border: `1.5px solid ${section === id ? 'rgba(31,215,96,.4)' : '#162B1A'}`,
              color: section === id ? '#1FD760' : '#8FB897',
            }}
          >
            {icon} {label}
            {id === 'wallet' && walletSummary.lowCount > 0 && (
              <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: '#FF4545', color: 'white', fontSize: 10, fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                {walletSummary.lowCount}
              </span>
            )}
          </button>
        ))}
        {section === 'list' && (
          <button onClick={openAdd} className="ab abp" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', fontSize: 12 }}>
            + Добавить курьера
          </button>
        )}
      </div>

      {section === 'wallet' && (
        <>
          <div className="ac" style={{ padding: '14px 16px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div className="ub" style={{ fontSize: 13, fontWeight: 800 }}>⚙️ Тариф комиссии</div>
                <div style={{ fontSize: 10, color: '#8FB897', marginTop: 3 }}>
                  % от доставки списывается при принятии заказа · на счетах: <b style={{ color: '#EBF5ED' }}>{formatSm(walletSummary.totalBalance)}</b>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  className="ai"
                  value={commissionInput}
                  onChange={e => { setCommissionInput(e.target.value); setCommissionErr(''); setCommissionSaved(false); }}
                  style={{ width: 72, textAlign: 'center', fontSize: 18, fontWeight: 900, fontFamily: 'Unbounded, sans-serif' }}
                />
                <span style={{ fontSize: 12, color: '#3D6645', fontWeight: 700 }}>%</span>
                {[5, 10, 15, 20].map(n => (
                  <button key={n} type="button" onClick={() => setCommissionInput(String(n))} className="ab abg" style={{ padding: '6px 10px', fontSize: 11 }}>
                    {n}%
                  </button>
                ))}
                <button type="button" onClick={saveCommissionTariff} disabled={commissionSaving} className="ab abp" style={{ padding: '7px 14px', fontSize: 11, opacity: commissionSaving ? .7 : 1 }}>
                  {commissionSaved ? '✓' : commissionSaving ? '…' : '💾 Сохранить'}
                </button>
              </div>
            </div>
            {commissionErr && <div style={{ marginTop: 8, fontSize: 11, color: '#FF4545' }}>{commissionErr}</div>}
            <div style={{ marginTop: 10, fontSize: 10, color: '#8FB897' }}>
              Сейчас: <b style={{ color: '#3B8EF0' }}>{formatCourierCommissionPercent(defaultCommissionPercent)}</b>
              {' · '}мин. ~{formatSm(defaultMinCommission)} при базе {tariff.base} ЅМ
              {walletSummary.lowCount > 0 && (
                <span style={{ color: '#FF4545', fontWeight: 700 }}> · {walletSummary.lowCount} с низким балансом</span>
              )}
            </div>
          </div>

          {!depositId ? (
            <div className="ac" style={{ marginBottom: 18 }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #162B1A' }}>
                <div className="ub" style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>🛵 Счета курьеров</div>
                <input
                  className="ai"
                  value={walletSearchQuery}
                  onChange={e => setWalletSearchQuery(e.target.value)}
                  placeholder="Поиск по имени или номеру KUR-XXXX"
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ maxHeight: 520, overflowY: 'auto' }}>
                {filteredWalletCouriers.length === 0 ? (
                  <div style={{ padding: 32, textAlign: 'center', color: '#3D6645', fontSize: 12 }}>Курьеры не найдены</div>
                ) : (
                  <table className="at">
                    <thead>
                      <tr>
                        <th>Курьер</th>
                        <th>Счёт KUR</th>
                        <th>Баланс</th>
                        <th>Комиссия</th>
                        <th>Статус</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredWalletCouriers.map(c => {
                        const balance = getCourierBalance(c);
                        const commission = getMinCourierCommissionEstimate(tariff, c);
                        const low = commission > 0 && balance + 0.001 < commission;
                        return (
                          <tr
                            key={c.id}
                            onClick={() => selectWalletCourier(c)}
                            style={{ cursor: 'pointer' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'rgba(31,215,96,.04)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = ''; }}
                          >
                            <td>
                              <div style={{ fontWeight: 700, fontSize: 13 }}>{c.name}</div>
                              <div style={{ fontSize: 10, color: '#8FB897' }}>{c.phone}</div>
                            </td>
                            <td>
                              <span className="ub" style={{ fontSize: 12, fontWeight: 800, color: '#3B8EF0', letterSpacing: .5 }}>
                                {formatCourierAccountDisplay(c.account, c.id)}
                              </span>
                            </td>
                            <td>
                              <span className="ub" style={{ fontSize: 12, fontWeight: 800, color: low ? '#FF4545' : '#EBF5ED' }}>{formatSm(balance)}</span>
                            </td>
                            <td style={{ fontSize: 11, color: '#8FB897' }}>
                              {formatCourierCommissionPercent(getCourierCommissionPercent(tariff, c))}
                              <div style={{ fontSize: 9, color: '#3D6645' }}>~{formatSm(commission)}</div>
                            </td>
                            <td>{low ? <Badge v="Мало" c="#FF4545" /> : <Badge v="OK" c="#1FD760" />}</td>
                            <td style={{ color: '#3D6645', fontSize: 14 }}>→</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ) : selectedWalletCourier && (
            <div style={{ marginBottom: 18 }}>
              <div className="ac" style={{ padding: '12px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                <button type="button" onClick={closeWalletDetail} className="ab abg" style={{ padding: '7px 12px', fontSize: 12, flexShrink: 0 }}>← Назад</button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ub" style={{ fontSize: 15, fontWeight: 800 }}>{selectedWalletCourier.name}</div>
                  <div style={{ fontSize: 11, color: '#8FB897', marginTop: 2 }}>
                    <span className="ub" style={{ color: '#3B8EF0', fontWeight: 800 }}>{formatCourierAccountDisplay(selectedWalletCourier.account, selectedWalletCourier.id)}</span>
                    {' · '}{selectedWalletCourier.phone}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 9, color: '#8FB897' }}>Баланс</div>
                  <div className="ub" style={{ fontSize: 20, fontWeight: 900, color: getCourierBalance(selectedWalletCourier) < getMinCourierCommissionEstimate(tariff, selectedWalletCourier) ? '#FF4545' : '#1FD760' }}>
                    {formatSm(getCourierBalance(selectedWalletCourier))}
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.25fr', gap: 14 }}>
                <div className="ac" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                    {([
                      ['deposit', '💳 Пополнение'],
                      ['withdraw', '📉 Списание'],
                    ] as const).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => { setWalletActionMode(id); setDepositErr(''); }}
                        className="ab"
                        style={{
                          flex: 1, padding: '8px 10px', fontSize: 11, fontWeight: 700, borderRadius: 10,
                          background: walletActionMode === id ? (id === 'withdraw' ? 'rgba(255,69,69,.12)' : 'rgba(31,215,96,.12)') : '#0C1C0F',
                          border: `1px solid ${walletActionMode === id ? (id === 'withdraw' ? 'rgba(255,69,69,.35)' : 'rgba(31,215,96,.35)') : '#162B1A'}`,
                          color: walletActionMode === id ? (id === 'withdraw' ? '#FF6969' : '#1FD760') : '#8FB897',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: 10, color: '#8FB897', marginBottom: 12, lineHeight: 1.45 }}>
                    {walletActionMode === 'deposit'
                      ? <>Пополнение синхронизируется с приложением курьера</>
                      : <>Списание вручную · комиссия {formatCourierCommissionPercent(getCourierCommissionPercent(tariff, selectedWalletCourier))}</>}
                    {' · '}баланс <b style={{ color: '#EBF5ED' }}>{formatSm(getCourierBalance(selectedWalletCourier))}</b>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                    {(walletActionMode === 'deposit' ? [50, 100, 200, 500] : [10, 25, 50, 100]).map(n => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setDepositAmount(String(n))}
                        className="ab abg"
                        style={{ flex: 1, padding: '7px 0', fontSize: 11, color: walletActionMode === 'withdraw' ? '#FF8080' : undefined }}
                      >
                        {walletActionMode === 'deposit' ? `+${n}` : `−${n}`}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <NI lbl="Сумма, ЅМ" val={depositAmount} set={setDepositAmount} ph="100" type="number" />
                    <NI lbl="Комментарий" val={depositNote} set={setDepositNote} ph={walletActionMode === 'deposit' ? 'Пополнение счёта' : 'Причина списания'} />
                  </div>
                  {depositErr && <div style={{ marginTop: 8, fontSize: 11, color: '#FF4545', fontWeight: 700 }}>{depositErr}</div>}
                  {walletActionMode === 'deposit' ? (
                    <button type="button" onClick={submitDeposit} disabled={depositing} className="ab abp" style={{ width: '100%', padding: 11, marginTop: 10, opacity: depositing ? .65 : 1 }}>
                      {depositing ? '⏳ Пополняем…' : '✓ Пополнить счёт'}
                    </button>
                  ) : (
                    <button type="button" onClick={submitWithdraw} disabled={depositing} className="ab" style={{ width: '100%', padding: 11, marginTop: 10, opacity: depositing ? .65 : 1, background: 'rgba(255,69,69,.15)', border: '1px solid rgba(255,69,69,.4)', color: '#FF6969', fontWeight: 800 }}>
                      {depositing ? '⏳ Списываем…' : '− Списать со счёта'}
                    </button>
                  )}
                </div>

                <div className="ac" style={{ padding: 16, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
                    <div className="ub" style={{ fontSize: 14, fontWeight: 800 }}>📋 История операций</div>
                    <button type="button" onClick={() => void loadDepositWalletTx(depositId, { silent: false })} className="ab abg" style={{ padding: '4px 10px', fontSize: 10 }}>
                      ↻
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap' }}>
                    {([
                      ['all', 'Все'],
                      ['deposit', 'Пополнения'],
                      ['withdrawal', 'Списания'],
                      ['commission', 'Комиссии'],
                      ['refund', 'Возвраты'],
                    ] as const).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setWalletTxFilter(id)}
                        className="ab"
                        style={{
                          padding: '4px 9px', fontSize: 10, fontWeight: 700, borderRadius: 8,
                          background: walletTxFilter === id ? 'rgba(31,215,96,.12)' : '#0C1C0F',
                          border: `1px solid ${walletTxFilter === id ? 'rgba(31,215,96,.35)' : '#162B1A'}`,
                          color: walletTxFilter === id ? '#1FD760' : '#8FB897',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: '#8FB897', alignSelf: 'center' }}>
                      {depositWalletLoading ? 'загрузка…' : `${depositWalletTx.length} записей`}
                    </span>
                  </div>
                  <div style={{ flex: 1, maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {depositWalletLoading && depositWalletTx.length === 0 ? (
                      <div style={{ padding: 24, textAlign: 'center', color: '#8FB897', fontSize: 12 }}>Загрузка…</div>
                    ) : depositWalletTx.filter(t => walletTxFilter === 'all' || t.type === walletTxFilter).length === 0 ? (
                      <div style={{ padding: 24, textAlign: 'center', color: '#3D6645', fontSize: 12, background: '#091508', borderRadius: 10, border: '1px solid #162B1A' }}>
                        Операций пока нет
                      </div>
                    ) : depositWalletTx
                      .filter(t => walletTxFilter === 'all' || t.type === walletTxFilter)
                      .map(tx => {
                        const positive = tx.amount >= 0;
                        const color = positive ? '#1FD760' : '#FF6969';
                        const icon = tx.type === 'deposit' ? '💳' : tx.type === 'refund' ? '↩' : tx.type === 'withdrawal' ? '📉' : '📊';
                        return (
                          <div key={tx.id} style={{ padding: '9px 10px', borderRadius: 10, background: '#091508', border: `1px solid ${positive ? 'rgba(31,215,96,.15)' : 'rgba(255,69,69,.15)'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                              <span style={{ fontSize: 14 }}>{icon}</span>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 11, fontWeight: 800 }}>{walletTxLabel(tx.type)}</div>
                                <div style={{ fontSize: 9, color: '#8FB897', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.note || '—'}</div>
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div className="ub" style={{ fontSize: 12, fontWeight: 800, color }}>{positive ? '+' : ''}{formatSm(tx.amount)}</div>
                              <div style={{ fontSize: 9, color: '#3D6645' }}>{formatWalletTxTime(tx.at)}</div>
                              {tx.balanceAfter != null && (
                                <div style={{ fontSize: 8, color: '#3D6645', marginTop: 2 }}>баланс {formatSm(tx.balanceAfter)}</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {section === 'list' && (
      <>
      <div className="ac">
        <table className="at">
          <thead>
            <tr>
              <th>Курьер</th>
              <th>Транспорт</th>
              <th>Статус</th>
              <th>Макс. заказов</th>
              <th>Номер KUR</th>
              <th>Баланс</th>
              <th>Комиссия</th>
              <th>Рейтинг</th>
              <th>Доставок</th>
              <th>За доставку</th>
              <th>Всего заказов</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {couriers.map(c => {
              const s = c.blocked ? { l: 'Заблокирован', c: '#FF4545' } : SC[c.status];
              const active = countCourierActiveOrders(apiOrders, c);
              const fin = financeById[c.id];
              const balance = getCourierBalance(c);
              const commission = getMinCourierCommissionEstimate(tariff, c);
              const lowBalance = commission > 0 && balance + 0.001 < commission;
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
                  <td>
                    <span className="ub" style={{ fontSize: 11, fontWeight: 800, color: '#3B8EF0', letterSpacing: .4 }}>
                      {formatCourierAccountDisplay(c.account, c.id)}
                    </span>
                  </td>
                  <td>
                    <span className="ub" style={{ fontSize: 12, fontWeight: 800, color: lowBalance ? '#FF4545' : '#EBF5ED' }}>
                      {formatSm(balance)}
                    </span>
                    {lowBalance && <div style={{ fontSize: 10, color: '#FF4545' }}>мало для заказа</div>}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    <span className="ub" style={{ fontWeight: 800, color: '#FFB800' }}>
                      {formatCourierCommissionPercent(getCourierCommissionPercent(tariff, c))}
                    </span>
                    {c.commissionPercent ? <div style={{ fontSize: 10, color: '#3D6645' }}>индивид.</div> : null}
                  </td>
                  <td style={{ color: '#FFB800', fontWeight: 700 }}>★ {c.rating}</td>
                  <td style={{ color: '#8FB897' }}>{fin?.deliveries ?? 0}</td>
                  <td><span className="ub" style={{ fontSize: 12, fontWeight: 800, color: '#3B8EF0' }}>{formatSm(fin?.earnings ?? 0)}</span></td>
                  <td style={{ color: '#8FB897' }}>{c.orders}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <button onClick={() => openDeposit(c)} className="ab abg" style={{ padding: '4px 9px', fontSize: 11 }} title="Пополнить счёт">💳</button>
                      <a href={`tel:${c.phone.replace(/\s/g, '')}`} className="ab abg" style={{ padding: '4px 9px', fontSize: 11, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>📱</a>
                      <button onClick={() => openEdit(c)} className="ab abg" style={{ padding: '4px 9px', fontSize: 11 }}>✏️</button>
                      <button onClick={() => toggleBlock(c.id)} className={`ab ${c.blocked ? 'abg' : 'abd'}`} style={{ padding: '4px 9px', fontSize: 11 }}>
                        {c.blocked ? 'Разблок' : 'Блок'}
                      </button>
                      <button
                        type="button"
                        className="ab abd"
                        style={{ padding: '4px 9px', fontSize: 11 }}
                        title="Удалить курьера"
                        onClick={async () => {
                          if (!window.confirm(`Удалить курьера «${c.name}»?`)) return;
                          try {
                            await deleteCourier(c.id);
                            if (editId === c.id) closeModal();
                            if (depositId === c.id) setDepositId(null);
                          } catch (e) {
                            window.alert(e instanceof Error ? e.message : 'Не удалось удалить');
                          }
                        }}
                      >🗑</button>
      </div>
                  </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="ac" style={{ marginTop: 18 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #162B1A', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="ub" style={{ fontSize: 14, fontWeight: 800 }}>📊 Отчёт по доставкам</div>
            <div style={{ fontSize: 11, color: '#8FB897', marginTop: 4 }}>Только сумма доставки · товары не включены</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={exportCourierReport} className="ab abg" style={{ padding: '7px 14px', fontSize: 12 }}>📊 Excel</button>
            <button type="button" onClick={printCourierReport} className="ab abg" style={{ padding: '7px 14px', fontSize: 12 }}>📄 PDF</button>
            <Link href="/admin?p=finance" className="ab abg" style={{ padding: '7px 14px', fontSize: 12, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>💰 Финансы</Link>
          </div>
        </div>
        <table className="at">
          <thead>
            <tr>
              <th>Курьер</th>
              <th>Транспорт</th>
              <th>Доставок</th>
              <th>За доставку</th>
              <th>Ср. за заказ</th>
              <th>Рейтинг</th>
            </tr>
          </thead>
          <tbody>
            {financeRows.map(r => (
              <tr key={r.id}>
                <td style={{ fontWeight: 700 }}>🛵 {r.name}</td>
                <td style={{ fontSize: 12, color: '#8FB897' }}>{vehicleLabel(r.vehicle as AdminCourier['vehicle'])}</td>
                <td>{r.deliveries}</td>
                <td><span className="ub" style={{ color: '#3B8EF0', fontWeight: 800 }}>{formatSm(r.earnings)}</span></td>
                <td style={{ color: '#8FB897' }}>{r.deliveries ? formatSm(r.earnings / r.deliveries) : '—'}</td>
                <td style={{ color: '#FFB800' }}>★ {r.rating}</td>
              </tr>
            ))}
            {!financeRows.length && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 24, color: '#3D6645' }}>Нет данных по курьерам</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="ac" style={{ marginTop: 14 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #162B1A', fontWeight: 800, fontSize: 13 }}>
          Доставленные заказы · детализация
        </div>
        <table className="at">
          <thead>
            <tr>
              <th>Заказ</th>
              <th>Курьер</th>
              <th>Клиент</th>
              <th>Товары</th>
              <th>Доставка</th>
              <th>Км</th>
              <th>Время</th>
            </tr>
          </thead>
          <tbody>
            {deliveryOrders.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 24, color: '#3D6645' }}>Пока нет доставленных заказов</td>
              </tr>
            ) : deliveryOrders.map(o => (
              <tr key={o.id}>
                <td><span className="ub" style={{ fontSize: 11, color: '#1FD760' }}>{o.id}</span></td>
                <td style={{ fontSize: 12, fontWeight: 600 }}>{o.courier}</td>
                <td style={{ fontSize: 12, color: '#8FB897' }}>{o.client}</td>
                <td style={{ color: '#8FB897' }}>{formatSm(o.goodsTotal)}</td>
                <td><span className="ub" style={{ fontSize: 12, fontWeight: 800, color: '#3B8EF0' }}>{formatSm(o.deliveryFee)}</span></td>
                <td style={{ fontSize: 11, color: '#8FB897' }}>{o.km ? formatKm(o.km) : '—'}</td>
                <td style={{ fontSize: 11, color: '#3D6645' }}>{o.time || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>
      )}

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
              <NI lbl={`Комиссия, % (0 = из тарифа ${defaultCommissionPercent}%)`} val={String(form.commissionPercent ?? 0)} set={v => setF('commissionPercent', Math.max(0, Math.min(100, parseFloat(v) || 0)))} ph="0" type="number" />
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
  const { addAssembler, updateAssembler, deleteAssembler, toggleBlock } = useAssemblerTeamStore();
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
                      <button
                        type="button"
                        className="ab abd"
                        style={{ padding: '4px 9px', fontSize: 11 }}
                        title="Удалить сборщика"
                        onClick={async () => {
                          if (!window.confirm(`Удалить сборщика «${a.name}»?`)) return;
                          try {
                            await deleteAssembler(a.id);
                            if (editId === a.id) closeModal();
                          } catch (e) {
                            window.alert(e instanceof Error ? e.message : 'Не удалось удалить');
                          }
                        }}
                      >🗑</button>
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
  const clientsApiSyncing = useClientStore(s => s.apiSyncing);
  const clientsApiError = useClientStore(s => s.apiError);
  const allCards = useCards();
  const { toggleBlock } = useClientStore();
  const apiOrders = useOrders(s => s.orders);
  const [search, setSearch] = useState('');
  const [filterLevel, setFilterLevel] = useState<'all' | ClientLevel>('all');
  const [filterDebt, setFilterDebt] = useState<'all' | 'with' | 'without'>('all');
  const [filterCard, setFilterCard] = useState<'all' | 'with' | 'without'>('all');
  const [filterBlocked, setFilterBlocked] = useState<'all' | 'active' | 'blocked'>('all');
  const [filterSegment, setFilterSegment] = useState<'all' | 'market' | 'restaurant' | 'mixed'>('all');
  const [filterAccount, setFilterAccount] = useState<'active' | 'recovery'>('active');
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<ClientProfileForm>(emptyClientProfileForm());
  const [formErr, setFormErr] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<AdminClient | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [recoveryConfirm, setRecoveryConfirm] = useState<AdminClient | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [purgingDemo, setPurgingDemo] = useState(false);

  useEffect(() => {
    if (USE_API) void syncClientsFromApi();
  }, []);

  const clients = useMemo(() => mergeClientsWithOrders(stored, apiOrders), [stored, apiOrders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qCompact = q.replace(/\s/g, '');
    const qDigits = q.replace(/\D/g, '');
    return clients.filter(c => {
      if (isClientPurged(c)) return false;
      if (isPhoneDeleted(c.phone)) return false;
      if (filterAccount === 'active' && isClientInRecovery(c)) return false;
      if (filterAccount === 'recovery' && !isClientInRecovery(c)) return false;
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
  }, [clients, search, filterLevel, filterDebt, filterCard, filterBlocked, filterSegment, filterAccount]);

  const stats = useMemo(() => ({
    total: clients.filter(c => !isClientPurged(c) && !isClientInRecovery(c)).length,
    recovery: clients.filter(c => !isClientPurged(c) && isClientInRecovery(c)).length,
    withCard: clients.filter(c => !isClientPurged(c) && !!c.card && !isClientInRecovery(c)).length,
    withDebt: clients.filter(c => !isClientPurged(c) && c.debt > 0 && !isClientInRecovery(c)).length,
    newMonth: clients.filter(c => !isClientPurged(c) && isNewThisMonth(c.createdAt) && !isClientInRecovery(c)).length,
  }), [clients]);

  const hasDemoClients = useMemo(
    () => clients.some(c => isDemoSeedClient(c.id, c.phone) && !isPhoneDeleted(c.phone)),
    [clients],
  );

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

  const handleDeleteClient = async (c: AdminClient) => {
    setDeletingId(c.id);
    try {
      await deleteClientFromCrm(c.id, c.phone);
      setDeleteConfirm(null);
      setSelectedIds(prev => {
        if (!prev.has(c.id)) return prev;
        const next = new Set(prev);
        next.delete(c.id);
        return next;
      });
      if (detailId === c.id) setDetailId(null);
      if (editId === c.id) closeModal();
    } catch (e) {
      console.error(e);
      setDeleteConfirm(null);
      const msg = e instanceof Error ? e.message : 'Не удалось удалить клиента';
      window.alert(msg.length > 180 ? `${msg.slice(0, 180)}…` : msg);
    } finally {
      setDeletingId(null);
    }
  };

  const selectedClients = useMemo(
    () => clients.filter(c => selectedIds.has(c.id)),
    [clients, selectedIds],
  );

  const allFilteredSelected = filtered.length > 0 && filtered.every(c => selectedIds.has(c.id));

  const toggleSelectClient = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filtered.forEach(c => next.delete(c.id));
      } else {
        filtered.forEach(c => next.add(c.id));
      }
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (!selectedClients.length) return;
    setBulkDeleting(true);
    let errors = 0;
    let lastErr = '';
    for (const c of selectedClients) {
      try {
        await deleteClientFromCrm(c.id, c.phone);
        if (detailId === c.id) setDetailId(null);
        if (editId === c.id) closeModal();
      } catch (e) {
        console.error(e);
        errors += 1;
        lastErr = e instanceof Error ? e.message : 'Ошибка удаления';
      }
    }
    setSelectedIds(new Set());
    setBulkDeleteOpen(false);
    setBulkDeleting(false);
    if (errors > 0) {
      window.alert(`Не удалось удалить ${errors} из ${selectedClients.length}. ${lastErr}`);
    }
    refilterClientsStore();
  };

  const handlePurgeDemo = async () => {
    if (!window.confirm('Удалить всех тестовых клиентов (Диловар, Нилуфар… U-01…U-07)? Ваши реальные клиенты не затронуты.')) return;
    setPurgingDemo(true);
    try {
      const { removed, errors } = await purgeAllDemoClientsFromCrm();
      if (errors > 0) {
        window.alert(`Удалено ${removed} демо-клиентов. Ошибок: ${errors}.`);
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Не удалось удалить демо-клиентов');
    } finally {
      setPurgingDemo(false);
    }
  };

  const handleMoveToRecovery = async (c: AdminClient) => {
    setActionId(c.id);
    try {
      await moveClientToRecovery(c.id, c.phone);
      setRecoveryConfirm(null);
      if (detailId === c.id) setDetailId(null);
      if (editId === c.id) closeModal();
    } catch (e) {
      console.error(e);
      window.alert(e instanceof Error ? e.message : 'Не удалось переместить в восстановление');
    } finally {
      setActionId(null);
    }
  };

  const handleRestoreClient = async (c: AdminClient) => {
    setActionId(c.id);
    try {
      await restoreClientFromRecovery(c.id, c.phone);
      if (detailId === c.id) setDetailId(null);
    } catch (e) {
      console.error(e);
      window.alert(e instanceof Error ? e.message : 'Не удалось восстановить клиента');
    } finally {
      setActionId(null);
    }
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 18 }}>
        <StatCard l="Активных" v={stats.total.toLocaleString()} />
        <StatCard l="Восстановление" v={stats.recovery} c="#FF8C00" />
        <StatCard l="С картами" v={stats.withCard} c="#FFB800" />
        <StatCard l="С долгом" v={stats.withDebt} c="#FF4545" />
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
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {hasDemoClients && (
            <button
              type="button"
              onClick={() => void handlePurgeDemo()}
              disabled={purgingDemo}
              className="ab"
              style={{ padding: '8px 14px', fontSize: 12, border: '1px solid rgba(255,184,0,.35)', color: '#FFB800', background: 'rgba(255,184,0,.08)' }}
            >
              {purgingDemo ? 'Удаление демо…' : '🧹 Убрать демо-клиентов'}
            </button>
          )}
          <button onClick={openAdd} className="ab abp">+ Добавить клиента</button>
        </div>
      </div>

      {hasDemoClients && (
        <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,184,0,.08)', border: '1px solid rgba(255,184,0,.25)', fontSize: 12, color: '#FFB800' }}>
          В списке тестовые клиенты из демо-базы (U-01…). Нажмите «Убрать демо-клиентов» — они исчезнут навсегда. Ваших клиентов это не удалит.
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        {[
          { id: 'active', l: '✓ Активные' },
          { id: 'recovery', l: '♻️ Восстановление' },
        ].map(f => (
          <button
            key={f.id}
            onClick={() => setFilterAccount(f.id as typeof filterAccount)}
            className="ab"
            style={{
              padding: '5px 12px',
              fontSize: 11,
              background: filterAccount === f.id ? (f.id === 'recovery' ? 'rgba(255,140,0,.15)' : 'rgba(31,215,96,.15)') : '#0C1C0F',
              color: filterAccount === f.id ? (f.id === 'recovery' ? '#FF8C00' : '#1FD760') : '#8FB897',
              border: `1px solid ${filterAccount === f.id ? (f.id === 'recovery' ? 'rgba(255,140,0,.35)' : 'rgba(31,215,96,.35)') : '#162B1A'}`,
            }}
          >{f.l}</button>
        ))}
        <select
          className="ai"
          value={filterLevel}
          onChange={e => setFilterLevel(e.target.value as typeof filterLevel)}
          style={{ width: 130, fontSize: 11, padding: '6px 10px' }}
        >
          <option value="all">Все уровни</option>
          {CLIENT_LEVEL_OPTIONS.map(o => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <select
          className="ai"
          value={filterDebt}
          onChange={e => setFilterDebt(e.target.value as typeof filterDebt)}
          style={{ width: 120, fontSize: 11, padding: '6px 10px' }}
        >
          <option value="all">Долг: все</option>
          <option value="with">С долгом</option>
          <option value="without">Без долга</option>
        </select>
        <select
          className="ai"
          value={filterCard}
          onChange={e => setFilterCard(e.target.value as typeof filterCard)}
          style={{ width: 120, fontSize: 11, padding: '6px 10px' }}
        >
          <option value="all">Карта: все</option>
          <option value="with">С картой</option>
          <option value="without">Без карты</option>
        </select>
        <select
          className="ai"
          value={filterSegment}
          onChange={e => setFilterSegment(e.target.value as typeof filterSegment)}
          style={{ width: 130, fontSize: 11, padding: '6px 10px' }}
        >
          <option value="all">Все типы</option>
          <option value="market">🛒 Магазин</option>
          <option value="restaurant">🍽 Рестораны</option>
          <option value="mixed">🔀 Смешанные</option>
        </select>
        <select
          className="ai"
          value={filterBlocked}
          onChange={e => setFilterBlocked(e.target.value as typeof filterBlocked)}
          style={{ width: 120, fontSize: 11, padding: '6px 10px' }}
        >
          <option value="all">Статус: все</option>
          <option value="active">Активные</option>
          <option value="blocked">Заблок.</option>
        </select>
      </div>

      {selectedIds.size > 0 && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 10,
          marginBottom: 12,
          padding: '10px 14px',
          borderRadius: 12,
          background: 'rgba(255,69,69,.08)',
          border: '1px solid rgba(255,69,69,.25)',
        }}>
          <span style={{ fontSize: 13, color: '#EBF5ED' }}>
            Выбрано: <strong style={{ color: '#FF4545' }}>{selectedIds.size}</strong>
          </span>
          <button
            type="button"
            onClick={() => setBulkDeleteOpen(true)}
            disabled={bulkDeleting}
            className="ab abd"
            style={{ padding: '6px 14px', fontSize: 12, opacity: bulkDeleting ? 0.6 : 1 }}
          >
            🗑 Удалить выбранных
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            disabled={bulkDeleting}
            className="ab"
            style={{ padding: '6px 14px', fontSize: 12, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897' }}
          >
            Снять выбор
          </button>
        </div>
      )}

      <div className="ac">
        <table className="at">
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleSelectAllFiltered}
                  disabled={filtered.length === 0 || bulkDeleting}
                  title="Выбрать все на странице"
                  style={{ width: 16, height: 16, cursor: filtered.length === 0 ? 'default' : 'pointer', accentColor: '#1FD760' }}
                />
              </th>
              <th>Клиент</th>
              <th>Тип</th>
              <th>Карта</th>
              <th>Уровень</th>
              <th>Заказов</th>
              <th>Потрачено</th>
              <th>Долг</th>
              <th>⭐ Бонусы</th>
              <th>Последний</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {USE_API && clientsApiSyncing && !stored.length ? (
              <tr>
                <td colSpan={12} style={{ textAlign: 'center', color: '#8FB897', padding: 28 }}>
                  <div style={{ marginBottom: 8 }}>Загрузка клиентов…</div>
                  <div style={{ fontSize: 11, color: '#3D6645', lineHeight: 1.5 }}>
                    Если долго не грузится — проверьте, что API-сервер запущен, и нажмите «Повторить».
                  </div>
                </td>
              </tr>
            ) : USE_API && clientsApiError && !stored.length ? (
              <tr>
                <td colSpan={12} style={{ textAlign: 'center', padding: 28 }}>
                  <div style={{ color: '#FF4545', fontWeight: 700, marginBottom: 10 }}>⚠ {clientsApiError}</div>
                  <button type="button" onClick={() => void syncClientsFromApi()} className="ab abp" style={{ padding: '8px 16px', fontSize: 12 }}>
                    Повторить загрузку
                  </button>
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={12} style={{ textAlign: 'center', color: '#3D6645', padding: 28 }}>
                  {search.trim() ? `Клиент «${search.trim()}» не найден` : 'Нет клиентов по выбранным фильтрам'}
                </td>
              </tr>
            ) : filtered.map(c => {
              const seg = clientSegment(c);
              const isSelected = selectedIds.has(c.id);
              return (
                <tr key={c.id} style={(c.blocked || isClientInRecovery(c)) ? { opacity: .75 } : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectClient(c.id)}
                      disabled={bulkDeleting}
                      style={{ width: 16, height: 16, cursor: bulkDeleting ? 'default' : 'pointer', accentColor: '#1FD760' }}
                    />
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: isClientInRecovery(c) ? 'linear-gradient(135deg,#664400,#FF8C00)' : c.blocked ? 'linear-gradient(135deg,#662222,#FF4545)' : 'linear-gradient(135deg,#0F8A3A,#1FD760)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Unbounded', fontSize: 12, fontWeight: 900, color: '#030B05', flexShrink: 0 }}>{c.name.charAt(0)}</div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>
                          {c.name}
                          {isClientInRecovery(c) && <span style={{ marginLeft: 6, fontSize: 10, color: '#FF8C00' }}>♻️</span>}
                          {c.blocked && !isClientInRecovery(c) && <span style={{ marginLeft: 6, fontSize: 10, color: '#FF4545' }}>🚫</span>}
                        </div>
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
                      {isClientInRecovery(c) ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleRestoreClient(c)}
                            disabled={actionId === c.id}
                            className="ab abg"
                            style={{ padding: '4px 9px', fontSize: 11, opacity: actionId === c.id ? 0.6 : 1 }}
                            title="Восстановить"
                          >
                            {actionId === c.id ? '…' : '♻️'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteConfirm(c)}
                            disabled={deletingId === c.id}
                            className="ab abd"
                            style={{ padding: '4px 9px', fontSize: 11, opacity: deletingId === c.id ? 0.6 : 1 }}
                            title="Удалить навсегда"
                          >
                            {deletingId === c.id ? '…' : '🗑'}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setRecoveryConfirm(c)}
                            disabled={actionId === c.id}
                            className="ab"
                            style={{ padding: '4px 9px', fontSize: 11, background: 'rgba(255,140,0,.12)', color: '#FF8C00', border: '1px solid rgba(255,140,0,.3)', opacity: actionId === c.id ? 0.6 : 1 }}
                            title="В восстановление"
                          >
                            {actionId === c.id ? '…' : '♻️'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteConfirm(c)}
                            disabled={deletingId === c.id}
                            className="ab abd"
                            style={{ padding: '4px 9px', fontSize: 11, opacity: deletingId === c.id ? 0.6 : 1 }}
                            title="Удалить навсегда"
                          >
                            {deletingId === c.id ? '…' : '🗑'}
                          </button>
                          <button onClick={() => toggleBlock(c.id)} className={`ab ${c.blocked ? 'abg' : 'abd'}`} style={{ padding: '4px 9px', fontSize: 11 }}>
                            {c.blocked ? 'Разблок' : 'Блок'}
                          </button>
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

      {deleteConfirm && (
        <div className="amod">
          <div className="amodbg" onClick={() => !deletingId && setDeleteConfirm(null)} />
          <div className="amodbox" style={{ maxWidth: 420 }}>
            <div className="ub" style={{ fontSize: 14, fontWeight: 800, color: '#FF4545', marginBottom: 10 }}>
              Удалить навсегда?
            </div>
            <div style={{ fontSize: 13, color: '#8FB897', lineHeight: 1.55, marginBottom: 16 }}>
              <strong style={{ color: '#EBF5ED' }}>{deleteConfirm.name}</strong> ({deleteConfirm.phone}) будет полностью удалён из базы.
              Карта отвяжется. Восстановить будет нельзя.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                disabled={!!deletingId}
                onClick={() => handleDeleteClient(deleteConfirm)}
                className="ab abd"
                style={{ flex: 1, opacity: deletingId ? 0.7 : 1 }}
              >
                {deletingId ? 'Удаление…' : 'Да, удалить навсегда'}
              </button>
              <button
                type="button"
                disabled={!!deletingId}
                onClick={() => setDeleteConfirm(null)}
                className="ab"
                style={{ flex: 1, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897' }}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkDeleteOpen && (
        <div className="amod">
          <div className="amodbg" onClick={() => !bulkDeleting && setBulkDeleteOpen(false)} />
          <div className="amodbox" style={{ maxWidth: 460 }}>
            <div className="ub" style={{ fontSize: 14, fontWeight: 800, color: '#FF4545', marginBottom: 10 }}>
              Удалить {selectedClients.length} клиент(ов)?
            </div>
            <div style={{ fontSize: 13, color: '#8FB897', lineHeight: 1.55, marginBottom: 12 }}>
              Выбранные клиенты будут полностью удалены из базы на сервере. Карты отвяжутся. Восстановить будет нельзя.
            </div>
            <div style={{
              maxHeight: 140,
              overflowY: 'auto',
              marginBottom: 16,
              padding: '8px 10px',
              borderRadius: 10,
              background: '#0C1C0F',
              border: '1px solid #162B1A',
              fontSize: 12,
              color: '#8FB897',
            }}>
              {selectedClients.slice(0, 12).map(c => (
                <div key={c.id} style={{ padding: '3px 0' }}>
                  <strong style={{ color: '#EBF5ED' }}>{c.name}</strong> · {c.phone}
                </div>
              ))}
              {selectedClients.length > 12 && (
                <div style={{ color: '#3D6645', marginTop: 4 }}>…и ещё {selectedClients.length - 12}</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                disabled={bulkDeleting}
                onClick={() => void handleBulkDelete()}
                className="ab abd"
                style={{ flex: 1, opacity: bulkDeleting ? 0.7 : 1 }}
              >
                {bulkDeleting ? 'Удаление…' : `Да, удалить ${selectedClients.length}`}
              </button>
              <button
                type="button"
                disabled={bulkDeleting}
                onClick={() => setBulkDeleteOpen(false)}
                className="ab"
                style={{ flex: 1, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897' }}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {recoveryConfirm && (
        <div className="amod">
          <div className="amodbg" onClick={() => !actionId && setRecoveryConfirm(null)} />
          <div className="amodbox" style={{ maxWidth: 420 }}>
            <div className="ub" style={{ fontSize: 14, fontWeight: 800, color: '#FF8C00', marginBottom: 10 }}>
              Переместить в восстановление?
            </div>
            <div style={{ fontSize: 13, color: '#8FB897', lineHeight: 1.55, marginBottom: 16 }}>
              <strong style={{ color: '#EBF5ED' }}>{recoveryConfirm.name}</strong> ({recoveryConfirm.phone}) попадёт в раздел «Восстановление».
              Карта отвяжется. Клиент сможет восстановить аккаунт при входе.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                disabled={!!actionId}
                onClick={() => handleMoveToRecovery(recoveryConfirm)}
                className="ab"
                style={{ flex: 1, background: 'rgba(255,140,0,.2)', border: '1px solid rgba(255,140,0,.4)', color: '#FF8C00', opacity: actionId ? 0.7 : 1 }}
              >
                {actionId ? '…' : 'Да, переместить'}
              </button>
              <button
                type="button"
                disabled={!!actionId}
                onClick={() => setRecoveryConfirm(null)}
                className="ab"
                style={{ flex: 1, background: '#0C1C0F', border: '1px solid #162B1A', color: '#8FB897' }}
              >
                Отмена
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
                { l: 'Статус', v: isClientInRecovery(detailClient) ? '♻️ Восстановление' : detailClient.blocked ? '🚫 Заблокирован' : '✓ Активен' },
                { l: 'Удалён', v: detailClient.deletedAt || '—' },
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
              <StatCard l="⭐ Бонусы (1=1 сом)" v={`${detailClient.bonus.toLocaleString()}`} c="#FFB800" />
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
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => { setDetailId(null); openEdit(detailClient); }} className="ab abg" style={{ flex: 1, minWidth: 120 }}>✏️ Редактировать</button>
              <a href={`tel:${detailClient.phone.replace(/\s/g, '')}`} className="ab abp" style={{ flex: 1, minWidth: 120, textDecoration: 'none', textAlign: 'center' }}>📱 Позвонить</a>
              {isClientInRecovery(detailClient) ? (
                <>
                  <button type="button" onClick={() => handleRestoreClient(detailClient)} disabled={actionId === detailClient.id} className="ab abg" style={{ flex: 1, minWidth: 120 }}>
                    {actionId === detailClient.id ? '…' : '♻️ Восстановить'}
                  </button>
                  <button type="button" onClick={() => setDeleteConfirm(detailClient)} disabled={deletingId === detailClient.id} className="ab abd" style={{ flex: 1, minWidth: 120 }}>
                    {deletingId === detailClient.id ? '…' : '🗑 Удалить навсегда'}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setRecoveryConfirm(detailClient)} disabled={actionId === detailClient.id} className="ab" style={{ flex: 1, minWidth: 120, background: 'rgba(255,140,0,.12)', color: '#FF8C00', border: '1px solid rgba(255,140,0,.3)' }}>
                    ♻️ В восстановление
                  </button>
                  <button type="button" onClick={() => setDeleteConfirm(detailClient)} disabled={deletingId === detailClient.id} className="ab abd" style={{ flex: 1, minWidth: 120 }}>
                    {deletingId === detailClient.id ? '…' : '🗑 Удалить навсегда'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── КАРТЫ — UI helpers ─────────────────────────── */
const CARD_LEVEL_RU: Record<ClientLevel, string> = { basic: 'Базовый', bronze: 'Бронза', silver: 'Серебро', gold: 'Золото', platinum: 'Платина' };

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
  const { unlinkCard, toggleBlock } = useCardStore();
  const [cardsTab, setCardsTab] = useState<'registry' | 'status'>('registry');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | CardStatus>('all');
  const [detail, setDetail] = useState<AdminCard | null>(null);
  const [showLink, setShowLink] = useState<AdminCard | null>(null);
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

  const openLink = (card: AdminCard) => {
    const client = findClientForCard(clients, card);
    setLinkForm(cardLoyaltyFromCard(card, client));
    setLinkErr('');
    setShowLink(card);
  };

  const saveLink = async () => {
    if (!showLink) return;
    try {
      const form = {
        ...linkForm,
        debt: showLink.status === 'unlinked' ? 0 : Math.max(0, Number(showLink.debt) || 0),
      };
      await saveCardLoyalty(showLink, form, showLink.status === 'unlinked' ? 'link' : 'edit');
      setShowLink(null);
    } catch (e) {
      setLinkErr(e instanceof Error ? e.message : 'Ошибка сохранения');
    }
  };

  const setLF = <K extends keyof CardLoyaltyForm>(key: K, val: CardLoyaltyForm[K]) =>
    setLinkForm(prev => ({ ...prev, [key]: val }));

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { id: 'registry' as const, l: '💳 Картотека', d: 'Все карты клиентов' },
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

      {/* Автоматическая выдача */}
      <div style={{
        display: 'flex',
        gap: 12,
        padding: '14px 18px',
        marginBottom: 16,
        borderRadius: 14,
        background: 'rgba(31,215,96,.06)',
        border: '1px solid rgba(31,215,96,.2)',
        alignItems: 'flex-start',
      }}>
        <div style={{ fontSize: 24, lineHeight: 1 }}>🎴</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#EBF5ED', marginBottom: 4 }}>Карта создаётся автоматически</div>
          <div style={{ fontSize: 12, color: '#8FB897', lineHeight: 1.55 }}>
            При регистрации клиента в CRM или входе в приложение по телефону система сама выдаёт КАКАПО-карту и привязывает её к аккаунту.
            Здесь можно просматривать карты, настраивать бонусы и привязать старые неактивные карты.
          </div>
        </div>
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
              <th>⭐ Бонусы</th>
              <th>Долг</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: 32 }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>💳</div>
                  <div style={{ color: '#8FB897', fontWeight: 700, marginBottom: 4 }}>
                    {search.trim() ? 'Ничего не найдено' : 'Карт пока нет'}
                  </div>
                  <div style={{ fontSize: 12, color: '#3D6645' }}>
                    {search.trim() ? 'Попробуйте другой запрос' : 'Карты появятся после регистрации клиентов'}
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
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <Badge v={CARD_LEVEL_RU[c.level as ClientLevel] || c.level} c={LVC[c.level] || '#8FB897'} />
                            {c.vip && <Badge v="VIP" c="#FFB800" />}
                          </div>
                          <div style={{ fontSize: 10, color: '#8FB897', marginTop: 4, lineHeight: 1.4 }}>
                            {formatAdminLevelExpiry({ level: c.level as ClientLevel, levelAssignMode: c.levelAssignMode, levelLockedPeriod: c.levelLockedPeriod, levelValidUntil: c.levelValidUntil })}
                            {c.vip && (
                              <span style={{ display: 'block', marginTop: 2 }}>
                                VIP: {formatAdminVipExpiry({ vip: c.vip, vipUntil: c.vipUntil })}
                              </span>
                            )}
                          </div>
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
                { l: '⭐ Бонусы (1=1 сом)', v: `${detail.bonus.toLocaleString()}`, c: '#FFB800' },
                { l: 'Лимит долга', v: detail.debtLimit > 0 ? `${detail.debtLimit} ЅМ` : 'Нет', c: '#1FD760' },
                { l: 'Долг', v: detail.debt > 0 ? `${detail.debt} ЅМ` : '—', c: detail.debt > 0 ? '#FF4545' : '#3D6645' },
                { l: 'VIP', v: detail.vip ? '👑 Включён' : 'Выключен', c: detail.vip ? '#FFB800' : '#3D6645' },
                { l: 'Срок уровня', v: formatAdminLevelExpiry({ level: detail.level as ClientLevel, levelAssignMode: detail.levelAssignMode, levelLockedPeriod: detail.levelLockedPeriod, levelValidUntil: detail.levelValidUntil }), c: '#8FB897' },
                { l: 'Срок VIP', v: detail.vip ? formatAdminVipExpiry({ vip: detail.vip, vipUntil: detail.vipUntil }) : '—', c: '#8FB897' },
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

  const saveDebt = async () => {
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
      await saveCardLoyalty(detail, form, 'edit');
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
  const products = useProducts(s => s.products)
  const {
    categories,
    loaded,
    roots,
    childrenOf,
    createCategory,
    updateCategory,
    deleteCategory,
  } = useCategories()

  return (
    <MarketCategoriesPanel
      theme="admin"
      showStatus
      categories={categories}
      loaded={loaded}
      products={products}
      roots={roots}
      childrenOf={childrenOf}
      onCreate={async data => { await createCategory(data) }}
      onUpdate={updateCategory}
      onDelete={deleteCategory}
    />
  )
}

function PromosPage() {
  const LOCAL_KEY = 'kakapo_admin_promos'
  const emptyProductForm = { productId: '', salePrice: '', oldPrice: '', markHot: false, on: true, stockLimit: '', resetStockSold: false, schedule: { scheduleMode: 'always' as PromoScheduleForm['scheduleMode'], from: '08:00', to: '22:00', till: 'Всегда', startsAt: '', endsAt: '' } }

  const apiProducts = useProducts(s => s.products)
  const catalogProds = useMemo(() => stripProductSaleFields(enrichProducts(apiProducts, PRODS)), [apiProducts])

  const [promos, setPromosLocal] = useState<Promo[]>([])
  const syncPromos = (list: Promo[]) => {
    setPromosLocal(list)
    usePromos.getState().setPromos(list)
  }
  const [loading, setLoading] = useState(true)
  const [section, setSection] = useState<'flash' | 'categories'>('flash')
  const [selectedCat, setSelectedCat] = useState<string | null>(null)
  const [showProductModal, setShowProductModal] = useState(false)
  const [editProductId, setEditProductId] = useState<number | null>(null)
  const [productForm, setProductForm] = useState(emptyProductForm)
  const [pickerCatFilter, setPickerCatFilter] = useState<string | null>(null)
  const [modalContext, setModalContext] = useState<'flash' | 'category'>('category')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [saving, setSaving] = useState(false)

  const productPromos = promos.filter(isProductPromo)
  const prodForPromo = (p: Promo) => catalogProds.find(x => x.id === p.productId)
  const catIdForPromo = (p: Promo) => prodForPromo(p)?.catId || null
  const saleDiscPromo = (p: Promo) => {
    const sale = Number(p.salePrice)
    const old = Number(p.oldPrice) || prodForPromo(p)?.price || 0
    return old > sale ? Math.round((1 - sale / old) * 100) : 0
  }
  const catLabelForPromo = (p: Promo) => {
    const cid = catIdForPromo(p)
    const cat = cid ? CATS_LIST.find(c => c.id === cid) : null
    return cat ? `${cat.e} ${cat.name.split(' ')[0]}` : null
  }
  const flashPromos = useMemo(
    () => productPromos.filter(p => inferScheduleMode(p) === 'flash'),
    [productPromos],
  )
  const regularPromos = useMemo(
    () => productPromos.filter(p => inferScheduleMode(p) !== 'flash'),
    [productPromos],
  )
  const promosByCategory = useMemo(() => {
    const groups: { cat: typeof CATS_LIST[0]; items: Promo[]; maxDisc: number }[] = []
    for (const cat of CATS_LIST) {
      const items = productPromos.filter(p => catIdForPromo(p) === cat.id)
      if (!items.length) continue
      groups.push({ cat, items, maxDisc: Math.max(...items.map(saleDiscPromo)) })
    }
    const other = productPromos.filter(p => {
      const cid = catIdForPromo(p)
      return !cid || !CATS_LIST.some(c => c.id === cid)
    })
    if (other.length) {
      groups.push({
        cat: { id: '_other', e: '🏷️', name: 'Другие' },
        items: other,
        maxDisc: Math.max(...other.map(saleDiscPromo)),
      })
    }
    return groups
  }, [productPromos, catalogProds])
  const activeCat = selectedCat
    ? (CATS_LIST.find(c => c.id === selectedCat) || (selectedCat === '_other' ? { id: '_other', e: '🏷️', name: 'Другие' } : null))
    : null
  const activeCatItems = useMemo(() => {
    if (!selectedCat) return []
    if (selectedCat === '_other') {
      return productPromos.filter(p => {
        const cid = catIdForPromo(p)
        return !cid || !CATS_LIST.some(c => c.id === cid)
      })
    }
    return productPromos.filter(p => catIdForPromo(p) === selectedCat)
  }, [selectedCat, productPromos, catalogProds])

  const persistLocal = (list: Promo[]) => {
    if (typeof window !== 'undefined') localStorage.setItem(LOCAL_KEY, JSON.stringify(list))
    syncPromos(list)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (USE_API) {
          const list = await api.getPromos()
          if (!cancelled) syncPromos(list)
        } else {
          const raw = typeof window !== 'undefined' ? localStorage.getItem(LOCAL_KEY) : null
          const list = raw ? (JSON.parse(raw) as Promo[]).filter(isProductPromo) : []
          if (!cancelled) syncPromos(list)
        }
      } catch {
        if (!cancelled) syncPromos([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    setSelectedIds([])
  }, [section, selectedCat])

  const togglePromoSelect = (id: number) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  }

  const toggleSelectAll = (items: Promo[]) => {
    const ids = items.map(p => p.id)
    const allSelected = ids.length > 0 && ids.every(id => selectedIds.includes(id))
    setSelectedIds(prev => (
      allSelected ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])]
    ))
  }

  const flashSchedulePreset = (): PromoScheduleForm => {
    const today = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
    return { scheduleMode: 'flash', from: '08:00', to: '20:00', till: 'Флэш', startsAt: '', endsAt: `${date}T20:00` }
  }

  const openProductCreate = (opts?: { flash?: boolean; catId?: string }) => {
    const isFlash = !!opts?.flash
    setPickerCatFilter(opts?.catId ?? null)
    setModalContext(isFlash ? 'flash' : 'category')
    setEditProductId(null)
    setProductForm({
      ...emptyProductForm,
      schedule: isFlash ? flashSchedulePreset() : emptyProductForm.schedule,
    })
    setShowProductModal(true)
  }

  const openProductEdit = (p: Promo) => {
    const prod = catalogProds.find(x => x.id === p.productId)
    const isFlash = inferScheduleMode(p) === 'flash'
    setModalContext(isFlash ? 'flash' : 'category')
    setPickerCatFilter(isFlash ? null : (catIdForPromo(p) ?? null))
    setEditProductId(p.id)
    setProductForm({
      productId: String(p.productId ?? ''),
      salePrice: String(p.salePrice ?? ''),
      oldPrice: p.oldPrice != null ? String(p.oldPrice) : '',
      markHot: !!p.markHot,
      on: p.on,
      stockLimit: stockLimitToAdminInput(p.stockLimit, prod, p),
      resetStockSold: false,
      schedule: scheduleFromPromo(p),
    })
    setShowProductModal(true)
  }

  const closeProductModal = () => {
    setShowProductModal(false)
    setEditProductId(null)
    setPickerCatFilter(null)
    setProductForm(emptyProductForm)
  }

  const saveProductPromo = async () => {
    const pid = Number(productForm.productId)
    const sale = Number(productForm.salePrice)
    if (!pid || !Number.isFinite(sale) || sale <= 0) return
    if (modalContext === 'flash' && productForm.schedule.scheduleMode !== 'flash') {
      alert('Флэш-акция должна иметь режим «Флэш»')
      return
    }
    if (modalContext === 'category' && productForm.schedule.scheduleMode === 'flash') {
      alert('Для категорийной акции выберите «Всегда» или «Ежедневно»')
      return
    }
    if (productForm.schedule.scheduleMode === 'flash' && !hasFlashEnd(productForm.schedule)) {
      alert('Укажите дату окончания флэш-акции')
      return
    }
    const product = catalogProds.find(p => p.id === pid)
    const old = productForm.oldPrice !== '' ? Number(productForm.oldPrice) : (product?.price ?? 0)
    const disc = old > sale ? Math.round((1 - sale / old) * 100) : 0
    const schedule = scheduleToPromoPayload(productForm.schedule)
    const stockLimit = stockLimitFromAdminInput(productForm.stockLimit, product)
    const prevSold = productForm.resetStockSold ? 0 : (editingProductPromo?.stockSold ?? 0)
    const stockExhausted = !!stockLimit && prevSold >= stockLimit
    const payload = {
      type: 'product' as const,
      e: product?.e || '🏷️',
      title: product?.name || `Товар #${pid}`,
      sub: productPromoLabel({ salePrice: sale, oldPrice: old } as Promo, product),
      disc,
      cat: 'Магазин' as const,
      on: productForm.on && !stockExhausted,
      productId: pid,
      salePrice: sale,
      oldPrice: old > sale ? old : undefined,
      markHot: productForm.markHot,
      stockLimit,
      stockLimitUnit: (isWeightedPromoProduct(product) || promoLimitLooksLikeGrams({ stockLimit } as Promo))
        ? 'grams'
        : 'pieces',
      ...(productForm.resetStockSold ? { stockSold: 0 } : {}),
      ...schedule,
    }
    setSaving(true)
    try {
      if (USE_API) {
        if (editProductId !== null) {
          const updated = await api.updatePromo(editProductId, payload)
          syncPromos(promos.map(x => (x.id === editProductId ? updated : x)))
        } else {
          const existing = productPromos.find(p => p.productId === pid)
          if (existing) {
            const updated = await api.updatePromo(existing.id, payload)
            syncPromos(promos.map(x => (x.id === existing.id ? updated : x)))
          } else {
            const created = await api.createPromo(payload)
            syncPromos([...promos, created])
          }
        }
      } else {
        if (editProductId !== null) {
          const next = promos.map(x => (x.id === editProductId ? { ...x, ...payload, id: editProductId } : x))
          persistLocal(next)
        } else {
          const existing = productPromos.find(p => p.productId === pid)
          if (existing) {
            const next = promos.map(x => (x.id === existing.id ? { ...x, ...payload, id: existing.id } : x))
            persistLocal(next)
          } else {
            persistLocal([...promos, { ...payload, id: Date.now() }])
          }
        }
      }
      closeProductModal()
      const isFlash = inferScheduleMode({ ...payload, scheduleMode: productForm.schedule.scheduleMode } as Promo) === 'flash'
      if (!isFlash && product?.catId) {
        setSection('categories')
        setSelectedCat(product.catId)
      } else if (isFlash) {
        setSection('flash')
        setSelectedCat(null)
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось сохранить скидку')
    } finally {
      setSaving(false)
    }
  }

  const togglePromo = async (p: Promo) => {
    const nextOn = !p.on
    syncPromos(promos.map(x => (x.id === p.id ? { ...x, on: nextOn } : x)))
    try {
      if (USE_API) await api.updatePromo(p.id, { on: nextOn })
      else persistLocal(promos.map(x => (x.id === p.id ? { ...x, on: nextOn } : x)))
    } catch {
      syncPromos(promos.map(x => (x.id === p.id ? { ...x, on: p.on } : x)))
    }
  }

  const removePromo = async (id: number) => {
    if (!confirm('Удалить акцию?')) return
    const prev = promos
    syncPromos(promos.filter(x => x.id !== id))
    setSelectedIds(prevIds => prevIds.filter(x => x !== id))
    try {
      if (USE_API) await api.deletePromo(id)
      else persistLocal(prev.filter(x => x.id !== id))
    } catch {
      syncPromos(prev)
      alert('Не удалось удалить акцию')
    }
  }

  const removeSelectedPromos = async (items: Promo[]) => {
    const ids = selectedIds.filter(id => items.some(p => p.id === id))
    if (!ids.length) return
    const n = ids.length
    const word = n === 1 ? 'акцию' : n < 5 ? 'акции' : 'акций'
    if (!confirm(`Удалить ${n} ${word}?`)) return
    const prev = promos
    syncPromos(promos.filter(x => !ids.includes(x.id)))
    setSelectedIds(prevIds => prevIds.filter(id => !ids.includes(id)))
    try {
      if (USE_API) await Promise.all(ids.map(id => api.deletePromo(id)))
      else persistLocal(prev.filter(x => !ids.includes(x.id)))
    } catch {
      syncPromos(prev)
      alert('Не удалось удалить выбранные акции')
    }
  }

  const discBadge = (p: Promo) => {
    const label = productPromoLabel(p, catalogProds.find(x => x.id === p.productId))
    return label ? <Badge v={label} c="#FF4545"/> : null
  }

  const scheduleBadge = (p: Promo) => {
    const mode = inferScheduleMode(p)
    if (mode === 'flash') return <Badge v="⚡ Флэш" c="#FF4545"/>
    if (mode === 'daily') return <Badge v="🕐 По расписанию" c="#3B8EF0"/>
    return null
  }

  const selectedProduct = catalogProds.find(p => p.id === Number(productForm.productId))
  const editingProductPromo = editProductId != null ? productPromos.find(p => p.id === editProductId) : null
  const pickerProducts = useMemo(() => {
    let list = catalogProds
    if (pickerCatFilter) list = list.filter(p => p.catId === pickerCatFilter)
    return list.map(p => ({ id: p.id, name: p.name, e: p.e, art: p.art, price: p.price }))
  }, [catalogProds, pickerCatFilter])
  const productPreviewDisc = selectedProduct && productForm.salePrice
    && Number(productForm.oldPrice || selectedProduct.price) > Number(productForm.salePrice)
    ? Math.round((1 - Number(productForm.salePrice) / Number(productForm.oldPrice || selectedProduct.price)) * 100)
    : 0

  const productModalJsx = (
    <div className="amod">
      <div className="amodbg" onClick={closeProductModal}/>
      <div className="amodbox" style={{maxWidth:480}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
          <div className="ub" style={{fontSize:15,fontWeight:800}}>
            {editProductId !== null ? 'Редактировать скидку' : (modalContext === 'flash' ? 'Флэш-товар' : 'Скидка на товар')}
          </div>
          <button onClick={closeProductModal} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          <div>
            <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Товар *</div>
            <ProductSearchPicker
              products={pickerProducts}
              value={productForm.productId}
              disabled={editProductId !== null}
              onChange={(id, p) => setProductForm(f => ({
                ...f,
                productId: id,
                oldPrice: f.oldPrice || (p ? String(p.price) : ''),
              }))}
            />
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div>
              <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Цена по акции (ЅМ) *</div>
              <input className="ai" type="number" step="0.01" value={productForm.salePrice} onChange={e=>setProductForm(f=>({...f,salePrice:e.target.value}))} placeholder="5.50"/>
            </div>
            <div>
              <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Старая цена (ЅМ)</div>
              <input className="ai" type="number" step="0.01" value={productForm.oldPrice} onChange={e=>setProductForm(f=>({...f,oldPrice:e.target.value}))} placeholder={selectedProduct ? String(selectedProduct.price) : 'Базовая цена'}/>
            </div>
          </div>
          {productPreviewDisc > 0 && (
            <div style={{padding:'8px 12px',borderRadius:9,background:'rgba(255,69,69,.07)',border:'1px solid rgba(255,69,69,.2)',fontSize:12,color:'#8FB897'}}>
              Скидка: <span style={{color:'#FF4545',fontWeight:800}}>−{productPreviewDisc}%</span>
            </div>
          )}
          <div>
            <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>
              Лимит по акции ({selectedProduct ? promoLimitUnit(selectedProduct, editingProductPromo) : 'шт'})
            </div>
            <input
              className="ai"
              type="number"
              min="0.1"
              step={selectedProduct?.sellType === 'weight' ? '0.1' : '1'}
              value={productForm.stockLimit}
              onChange={e => setProductForm(f => ({ ...f, stockLimit: e.target.value }))}
              placeholder={selectedProduct?.sellType === 'weight' ? 'Напр. 50 кг' : 'Напр. 100 шт'}
            />
            <div style={{fontSize:10,color:'#3D6645',marginTop:5,lineHeight:1.45}}>
              {selectedProduct?.sellType === 'weight'
                ? 'Для весовых товаров укажите лимит в килограммах. Когда лимит исчерпан — акция автоматически выключается.'
                : 'Для штучных товаров — количество штук. Когда лимит исчерпан — акция автоматически выключается.'}
            </div>
            {editingProductPromo && Number(editingProductPromo.stockLimit) > 0 && (
              <div style={{marginTop:8,padding:'8px 10px',borderRadius:9,background:'rgba(59,142,240,.06)',border:'1px solid rgba(59,142,240,.15)',fontSize:11,color:'#8FB897'}}>
                Продано: <strong style={{color:'#EBF5ED'}}>{formatPromoStockAdmin(editingProductPromo, selectedProduct)}</strong>
                <label style={{display:'flex',alignItems:'center',gap:8,marginTop:8,cursor:'pointer'}}>
                  <input type="checkbox" checked={productForm.resetStockSold} onChange={e => setProductForm(f => ({ ...f, resetStockSold: e.target.checked }))}/>
                  Сбросить счётчик продаж
                </label>
              </div>
            )}
          </div>
          <PromoScheduleFields
            compact
            context={modalContext}
            value={productForm.schedule}
            onChange={patch => setProductForm(f => ({ ...f, schedule: { ...f.schedule, ...patch } }))}
          />
          <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12,color:'#8FB897',cursor:'pointer'}}>
            <input type="checkbox" checked={productForm.markHot} onChange={e=>setProductForm(f=>({...f,markHot:e.target.checked}))}/>
            🔥 Показывать как «Хит» в магазине
          </label>
          <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12,color:'#8FB897',cursor:'pointer'}}>
            <input type="checkbox" checked={productForm.on} onChange={e=>setProductForm(f=>({...f,on:e.target.checked}))}/>
            Акция активна
          </label>
          <div style={{display:'flex',gap:10,marginTop:4}}>
            <button
              onClick={saveProductPromo}
              disabled={saving || !productForm.productId || !productForm.salePrice}
              className="ab abp"
              style={{flex:1,padding:12,opacity:saving||!productForm.productId||!productForm.salePrice?0.6:1}}
            >
              {saving ? 'Сохранение…' : editProductId !== null ? '✓ Сохранить' : '✓ Создать скидку'}
            </button>
            <button onClick={closeProductModal} className="ab abg">Отмена</button>
          </div>
        </div>
      </div>
    </div>
  )

  const renderPromoSelectionBar = (items: Promo[]) => {
    if (!items.length) return null
    const ids = items.map(p => p.id)
    const selectedInList = selectedIds.filter(id => ids.includes(id))
    const allSelected = ids.length > 0 && ids.every(id => selectedIds.includes(id))
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 12,
        padding: '10px 14px',
        borderRadius: 11,
        background: selectedInList.length ? 'rgba(255,69,69,.06)' : '#091508',
        border: `1px solid ${selectedInList.length ? 'rgba(255,69,69,.2)' : '#162B1A'}`,
        flexWrap: 'wrap',
      }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#8FB897', cursor: 'pointer' }}>
          <input type="checkbox" checked={allSelected} onChange={() => toggleSelectAll(items)}/>
          Выбрать все
        </label>
        {selectedInList.length > 0 && (
          <>
            <span style={{ fontSize: 12, color: '#8FB897' }}>
              Выбрано: <strong style={{ color: '#EBF5ED' }}>{selectedInList.length}</strong>
            </span>
            <button
              type="button"
              onClick={() => removeSelectedPromos(items)}
              className="ab abd"
              style={{ marginLeft: 'auto', padding: '6px 14px', fontSize: 12, fontWeight: 700 }}
            >
              🗑 Удалить выбранные
            </button>
          </>
        )}
      </div>
    )
  }

  const renderPromoRow = (p: Promo) => {
    const prod = prodForPromo(p)
    const catLabel = catLabelForPromo(p)
    const isSelected = selectedIds.includes(p.id)
    return (
      <div key={p.id} className="ac" style={{
        padding: '14px 16px',
        opacity: p.on ? 1 : 0.6,
        border: isSelected ? '1.5px solid rgba(255,69,69,.35)' : undefined,
        background: isSelected ? 'rgba(255,69,69,.04)' : undefined,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ flexShrink: 0, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <input type="checkbox" checked={isSelected} onChange={() => togglePromoSelect(p.id)}/>
          </label>
          <div style={{ width: 44, height: 44, borderRadius: 13, background: '#162B1A', border: '1px solid #1E3522', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>{prod?.e || p.e}</div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 800 }}>{prod?.name || p.title}</span>
              {catLabel && <Badge v={catLabel} c="#3B8EF0"/>}
              {discBadge(p)}
              {scheduleBadge(p)}
              {p.markHot && <Badge v="🔥 Хит" c="#FF8C00"/>}
              <span style={{ fontSize: 10, color: '#3D6645' }}>{prod?.art}</span>
            </div>
            <div style={{ fontSize: 12, color: '#8FB897' }}>
              База: {prod ? `${prod.price.toFixed(2)} ЅМ` : '—'}
              {p.salePrice != null && <> → <span style={{ color: '#FF4545', fontWeight: 700 }}>{Number(p.salePrice).toFixed(2)} ЅМ</span></>}
            </div>
            <div style={{ fontSize: 10, color: '#3D6645', marginTop: 4 }}>
              {formatPromoScheduleLabel(p)}{p.on && !isPromoScheduleActive(p) ? ' · ⏸ вне расписания' : ''}
              {formatPromoStockAdmin(p, prod) ? ` · 📦 ${formatPromoStockAdmin(p, prod)}` : ''}
              {p.on && isPromoStockExhausted(p) ? ' · закончилось' : ''}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: p.on ? '#1FD760' : '#3D6645', fontWeight: 700 }}>{p.on ? 'Вкл' : 'Выкл'}</span>
            <Tog on={p.on} set={() => togglePromo(p)}/>
            <button onClick={() => openProductEdit(p)} className="ab abg" style={{ padding: '5px 10px', fontSize: 11 }}>✏️</button>
            <button onClick={() => removePromo(p.id)} className="ab abd" style={{ padding: '5px 10px', fontSize: 11 }}>🗑</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{fontSize:12,color:'#8FB897',marginBottom:14,padding:'10px 14px',borderRadius:11,background:'rgba(59,142,240,.06)',border:'1px solid rgba(59,142,240,.15)',lineHeight:1.5}}>
        Создайте скидку — категория появится сама по товару. Флэш отдельно сверху в магазине.
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:16}}>
        <StatCard l="Всего" v={productPromos.length}/>
        <StatCard l="Активных" v={productPromos.filter(p=>p.on).length} c="#1FD760"/>
        <StatCard l="Флэш" v={flashPromos.length} c="#FF4545"/>
        <StatCard l="Категорий" v={promosByCategory.length} c="#5B9CF5"/>
      </div>

      <div style={{display:'flex',gap:8,marginBottom:18}}>
        {[
          { id: 'flash' as const, label: '⚡ Флэш-распродажа', count: flashPromos.length },
          { id: 'categories' as const, label: '📁 По категориям', count: promosByCategory.length },
        ].map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => { setSection(t.id); setSelectedCat(null) }}
            className="ab"
            style={{
              flex: 1,
              padding: '12px 14px',
              fontSize: 13,
              fontWeight: 700,
              background: section === t.id ? (t.id === 'flash' ? 'rgba(255,69,69,.12)' : 'rgba(59,142,240,.12)') : '#091508',
              border: `1.5px solid ${section === t.id ? (t.id === 'flash' ? 'rgba(255,69,69,.35)' : 'rgba(59,142,240,.35)') : '#162B1A'}`,
              color: section === t.id ? (t.id === 'flash' ? '#FF8C8C' : '#5B9CF5') : '#8FB897',
            }}
          >
            {t.label}
            <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.75 }}>({t.count})</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{padding:24,textAlign:'center',color:'#8FB897'}}>Загрузка…</div>
      ) : section === 'flash' ? (
        <>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}>
            <button onClick={() => openProductCreate({ flash: true })} className="ab" style={{padding:'8px 16px',fontSize:12,fontWeight:700,background:'rgba(255,69,69,.15)',border:'1px solid rgba(255,69,69,.3)',color:'#FF8C8C'}}>+ Флэш-товар</button>
      </div>
          {flashPromos.length === 0 ? (
            <div style={{padding:'32px 16px',textAlign:'center',color:'#3D6645',fontSize:13,background:'#091508',borderRadius:12,border:'1px solid #162B1A'}}>
              Нет флэш-акций. Создайте скидку с режимом «⚡ Флэш».
            </div>
          ) : (
            <>
              {renderPromoSelectionBar(flashPromos)}
              <div style={{display:'flex',flexDirection:'column',gap:10}}>{flashPromos.map(renderPromoRow)}</div>
            </>
          )}
        </>
      ) : activeCat ? (
        <>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
            <button type="button" onClick={() => setSelectedCat(null)} className="ab abg" style={{padding:'8px 12px',fontSize:12}}>← Категории</button>
            {(() => {
              const vis = ADMIN_CAT_VISUAL[activeCat.id] || { bg: '#162B1A', color: '#1FD760' }
              return (
                <>
                  <div style={{width:36,height:36,borderRadius:10,background:vis.bg,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>{activeCat.e}</div>
              <div style={{flex:1}}>
                    <div className="ub" style={{fontSize:15,fontWeight:800}}>{activeCat.name}</div>
                    <div style={{fontSize:11,color:'#8FB897'}}>{activeCatItems.length} акционных товаров</div>
                </div>
                  <button onClick={() => openProductCreate({ catId: activeCat.id === '_other' ? undefined : activeCat.id })} className="ab abp" style={{padding:'8px 16px',fontSize:12,fontWeight:700,whiteSpace:'nowrap'}}>+ Скидка на товар</button>
                </>
              )
            })()}
              </div>
          {activeCatItems.length === 0 ? (
            <div style={{padding:32,textAlign:'center',color:'#3D6645',fontSize:13}}>
              <div style={{marginBottom:14}}>В этой категории пока нет акций</div>
              <button onClick={() => openProductCreate({ catId: activeCat.id === '_other' ? undefined : activeCat.id })} className="ab abp" style={{padding:'10px 20px',fontSize:13,fontWeight:700}}>+ Скидка на товар</button>
              </div>
          ) : (
            <>
              {renderPromoSelectionBar(activeCatItems)}
              <div style={{display:'flex',flexDirection:'column',gap:10}}>{activeCatItems.map(renderPromoRow)}</div>
            </>
          )}
        </>
      ) : (
        <>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,marginBottom:14}}>
            <div style={{fontSize:11,color:'#8FB897',flex:1}}>Категории появляются автоматически, когда добавляете скидку на товар</div>
            <button onClick={() => openProductCreate()} className="ab abp" style={{padding:'8px 16px',fontSize:12,fontWeight:700,whiteSpace:'nowrap'}}>+ Скидка на товар</button>
            </div>
          {promosByCategory.length === 0 ? (
            <div style={{padding:32,textAlign:'center',color:'#3D6645',fontSize:13,background:'#091508',borderRadius:12,border:'1px solid #162B1A'}}>
              <div style={{marginBottom:14}}>Пока нет категорий с акциями. Добавьте скидку на товар — его категория появится здесь.</div>
              <button onClick={() => openProductCreate()} className="ab abp" style={{padding:'10px 20px',fontSize:13,fontWeight:700}}>+ Скидка на товар</button>
          </div>
          ) : (
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
              {promosByCategory.map(({ cat, items, maxDisc }) => {
                const vis = ADMIN_CAT_VISUAL[cat.id] || { bg: '#162B1A', color: '#1FD760' }
                const shortLabel = cat.name.split(' ')[0]
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCat(cat.id)}
                    className="ab"
                    style={{
                      borderRadius: 16,
                      background: vis.bg,
                      border: `1px solid ${vis.color}28`,
                      padding: '14px 14px 12px',
                      minHeight: 110,
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{fontSize: 28, marginBottom: 8}}>{cat.e}</div>
                      <div className="ub" style={{fontSize: 14, fontWeight: 800, color: '#fff', marginBottom: 4}}>{shortLabel}</div>
                      <div style={{fontSize: 10, color: 'rgba(255,255,255,.45)'}}>{items.length} товаров</div>
      </div>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:10}}>
                      <span style={{padding:'4px 10px',borderRadius:8,background:`${vis.color}22`,border:`1px solid ${vis.color}40`,fontSize:12,fontWeight:800,color:vis.color}}>−{maxDisc}%</span>
                      <span style={{fontSize:15,color:'rgba(255,255,255,.4)'}}>→</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {showProductModal && productModalJsx}
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
  const restaurantsLoaded = useRestaurants(s => s.loaded)
  const fetchRestaurants = useRestaurants(s => s.fetchRestaurants)
  const couriers = useCourierTeam()
  const assemblers = useAssemblerTeam()
  const pricing = usePricingStore(s => s.pricing)
  const { roadKm } = useOrderRoadKm(apiOrders)

  const [tab, setTab] = useState<FinanceTab>('shop')
  const [payouts, setPayouts] = useState<any[]>([])
  const [localRests, setLocalRests] = useState(() => (USE_API ? [] : RESTAURANTS.map(r => ({ ...r, paidRevenueMonth: r.paidRevenueMonth ?? 0 }))))
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
    if (USE_API) {
      if (!restaurantsLoaded) return []
      return enrichRestaurants(apiRests, RESTAURANTS).map(r => ({
        ...r,
        paidRevenueMonth: (localRests.find(l => l.id === r.id)?.paidRevenueMonth) ?? r.paidRevenueMonth ?? 0,
      }))
    }
    return localRests
  }, [apiRests, restaurantsLoaded, localRests])

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
    { l: 'Оборот товаров', v: formatSm(summary.totalTurnover), c: '#9B6DFF', e: '📈' },
  ] : tab === 'restaurants' ? [
    { l: 'Рестораны/мес', v: formatSm(summary.restaurantGross), c: '#FF8C00', e: '🍽' },
    { l: 'Комиссия КАКАПО', v: formatSm(summary.restaurantCommission), c: '#FFB800', e: '💰' },
    { l: 'К выплате', v: formatSm(summary.restaurantPendingNet), c: '#1FD760', e: '💸' },
    { l: 'Итого оборот', v: formatSm(summary.totalTurnover), c: '#3B8EF0', e: '📈' },
  ] : tab === 'couriers' ? [
    { l: 'Курьеров', v: summary.couriers.length, c: '#3B8EF0', e: '🛵' },
    { l: 'Доставок', v: summary.couriers.reduce((s, c) => s + c.deliveries, 0), c: '#1FD760', e: '📦' },
    { l: 'Сбор за доставку', v: formatSm(summary.courierDeliveryFees), c: '#00D4C8', e: '💵' },
    { l: 'Выплаты курьерам', v: formatSm(summary.couriers.reduce((s, c) => s + c.earnings, 0)), c: '#FFB800', e: '💰' },
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
                { href: '/', icon: '🛒', label: 'Магазин — заказы клиентов' },
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

function SettingsPage({ setPage, session, onSessionUpdate }: {
  setPage: (p: string) => void
  session?: AdminSession | null
  onSessionUpdate?: (s: AdminSession) => void
}) {
  const [stab, setStab] = useState('access')
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

  const [authLogin, setAuthLogin] = useState(session?.login || 'admin')
  const [authCurrentPass, setAuthCurrentPass] = useState('')
  const [authNewPass, setAuthNewPass] = useState('')
  const [authNewPass2, setAuthNewPass2] = useState('')
  const [authSaved, setAuthSaved] = useState(false)
  const [authErr, setAuthErr] = useState('')
  const [authBusy, setAuthBusy] = useState(false)

  useEffect(() => {
    const loadLocal = () => {
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
        const creds = loadOfflineAdminCreds()
        setAuthLogin(creds.login)
      } catch { /* private mode */ }
    }

    if (!USE_API) {
      loadLocal()
      return
    }

    void api.getAdminSettings().then(remote => {
      if (remote.gbs) {
        setGbsOn(!!remote.gbs.enabled)
        if (remote.gbs.ip) setGbsIP(remote.gbs.ip)
        if (remote.gbs.port) setGbsPort(remote.gbs.port)
        if (remote.gbs.user) setGbsUser(remote.gbs.user)
        if (remote.gbs.pass != null) setGbsPass(remote.gbs.pass)
      }
      if (remote.sms) {
        if (remote.sms.provider) setSmsP(remote.sms.provider)
        if (remote.sms.apiKey != null) setSmsKey(remote.sms.apiKey)
      }
      if (remote.store) setStoreInfo({ ...DEFAULT_STORE_INFO, ...remote.store })
      if (remote.auth?.login) setAuthLogin(remote.auth.login)
    }).catch(() => loadLocal())
  }, [])

  const saveAll = async () => {
    const payload = {
      gbs: { enabled: gbsOn, ip: gbsIP, port: gbsPort, user: gbsUser, pass: gbsPass },
      sms: { provider: smsP, apiKey: smsKey },
      store: storeInfo,
    }
    try {
      if (USE_API) {
        await api.updateAdminSettings(payload)
      } else {
        localStorage.setItem('kakapo_admin_gbs', JSON.stringify(payload.gbs))
        localStorage.setItem('kakapo_admin_sms', JSON.stringify(payload.sms))
        localStorage.setItem('kakapo_admin_store', JSON.stringify(payload.store))
      }
      setSaveErr('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setSaveErr('Не удалось сохранить настройки')
    }
  }

  const saveAuth = async () => {
    setAuthErr('')
    const nextLogin = authLogin.trim()
    if (nextLogin.length < 3) {
      setAuthErr('Логин минимум 3 символа')
      return
    }
    if (!authCurrentPass) {
      setAuthErr('Введите текущий пароль')
      return
    }
    if (authNewPass && authNewPass.length < 4) {
      setAuthErr('Новый пароль минимум 4 символа')
      return
    }
    if (authNewPass && authNewPass !== authNewPass2) {
      setAuthErr('Новый пароль и подтверждение не совпадают')
      return
    }
    setAuthBusy(true)
    try {
      if (USE_API) {
        const res = await api.updateAdminAuth({
          currentPassword: authCurrentPass,
          login: nextLogin,
          newPassword: authNewPass || undefined,
        })
        const nextSession: AdminSession = {
          login: res.login,
          name: session?.name || 'Админ',
          role: session?.role || 'admin',
          token: session?.token || `token-admin-${Date.now()}`,
          userId: session?.userId,
        }
        saveAdminSession(nextSession)
        onSessionUpdate?.(nextSession)
      } else {
        const creds = loadOfflineAdminCreds()
        if (authCurrentPass !== creds.password) {
          setAuthErr('Неверный текущий пароль')
          return
        }
        saveOfflineAdminCreds({
          login: nextLogin,
          password: authNewPass || creds.password,
        })
        const nextSession: AdminSession = {
          login: nextLogin,
          name: session?.name || 'Админ КАКАПО',
          role: 'admin',
          token: session?.token || 'offline-admin',
        }
        saveAdminSession(nextSession)
        onSessionUpdate?.(nextSession)
      }
      setAuthCurrentPass('')
      setAuthNewPass('')
      setAuthNewPass2('')
      setAuthSaved(true)
      setTimeout(() => setAuthSaved(false), 2500)
    } catch (e) {
      setAuthErr(e instanceof Error ? e.message : 'Не удалось сохранить доступ')
    } finally {
      setAuthBusy(false)
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
    { id: 'access', l: '🔐 Доступ' },
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
        {stab !== 'access' && (
          <button type="button" onClick={saveAll} className="ab abp" style={{ marginLeft: 'auto', padding: '8px 16px' }}>
            {saved ? '✓ Сохранено!' : '💾 Сохранить'}
          </button>
        )}
      </div>

      {saveErr && stab !== 'access' && (
        <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,69,69,.08)', border: '1px solid rgba(255,69,69,.25)', fontSize: 12, color: '#FF4545' }}>
          {saveErr}
        </div>
      )}

      {stab === 'access' && (
        <div className="ac" style={{ padding: 20, maxWidth: 480 }}>
          <div className="ub" style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>Логин и пароль админки</div>
          <div style={{ fontSize: 11, color: '#3D6645', marginBottom: 16 }}>
            Эти данные нужны для входа в панель /admin. Для смены обязательно укажите текущий пароль.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <NI lbl="Логин" val={authLogin} set={setAuthLogin} ph="admin" />
            <NI lbl="Текущий пароль" val={authCurrentPass} set={setAuthCurrentPass} type="password" ph="••••••••" />
            <NI lbl="Новый пароль (необязательно)" val={authNewPass} set={setAuthNewPass} type="password" ph="оставьте пустым, чтобы не менять" />
            <NI lbl="Подтвердите новый пароль" val={authNewPass2} set={setAuthNewPass2} type="password" ph="••••••••" />
          </div>
          {authErr && (
            <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,69,69,.08)', border: '1px solid rgba(255,69,69,.25)', fontSize: 12, color: '#FF4545' }}>
              {authErr}
            </div>
          )}
          <button
            type="button"
            disabled={authBusy}
            onClick={() => void saveAuth()}
            className="ab abp"
            style={{ width: '100%', marginTop: 16, padding: 12, opacity: authBusy ? .6 : 1 }}
          >
            {authBusy ? 'Сохранение…' : authSaved ? '✓ Сохранено!' : '🔐 Сохранить доступ'}
          </button>
        </div>
      )}

      {stab==='gbs'&&(
        <div style={{display:'grid',gridTemplateColumns:'1.3fr 1fr',gap:18}}>
          <div className="ac" style={{padding:20}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
              <div className="ub" style={{fontSize:14,fontWeight:800}}>JSON API · GBS Market</div>
              <div style={{display:'flex',alignItems:'center',gap:10}}><span style={{fontSize:12,color:gbsOn?'#1FD760':'#3D6645',fontWeight:700}}>{gbsOn?'Активно':'Выкл.'}</span><Tog on={gbsOn} set={() => setGbsOn(v => !v)}/></div>
            </div>
            <div style={{marginBottom:12,padding:'8px 12px',borderRadius:8,background:'rgba(255,184,0,.08)',border:'1px solid rgba(255,184,0,.25)',fontSize:11,color:'#FFB800',fontWeight:700}}>⚠ Demo-режим: реального подключения к кассовому терминалу нет, синхронизация не отправляет данные на устройство</div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 90px',gap:10}}><NI lbl="IP адрес кассы" val={gbsIP} set={setGbsIP} ph="http://192.168.1.100"/><NI lbl="Порт" val={gbsPort} set={setGbsPort} ph="8419"/></div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}><NI lbl="Логин" val={gbsUser} set={setGbsUser}/><NI lbl="Пароль" val={gbsPass} set={setGbsPass} type="password" ph="••••••••••••"/></div>
            </div>
            <button type="button" onClick={testConn} className="ab" style={{width:'100%',marginTop:14,padding:11,background:'rgba(59,142,240,.1)',border:'1.5px solid rgba(59,142,240,.3)',color:'#3B8EF0',display:'flex',alignItems:'center',justifyContent:'center',gap:8,fontSize:13}}>
              {testSt==='loading'?<><div style={{width:16,height:16,borderRadius:'50%',border:'2px solid rgba(59,142,240,.3)',borderTopColor:'#3B8EF0',animation:'spin 1s linear infinite'}}/>Проверка...</>:testSt==='ok'?'⚠ Demo: заглушка ответила OK (устройство не проверялось)':testSt==='err'?'❌ Не удалось подключиться':'🔌 Проверить соединение'}
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
          <div style={{fontSize:11,color:'#3D6645',marginBottom:12}}>Для входа курьеров, сборщиков и партнёров. Тариф доставки — в разделе «Тариф доставки».</div>
          <div style={{marginBottom:16,padding:'8px 12px',borderRadius:8,background:'rgba(255,184,0,.08)',border:'1px solid rgba(255,184,0,.25)',fontSize:11,color:'#FFB800',fontWeight:700}}>⚠ Demo-режим: OTP всегда «1234», реальные SMS не отправляются ни одним провайдером</div>
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
  const apiOrders = useOrders(s => s.orders);
  const apiRests = useRestaurants(s => s.restaurants);
  const restaurantsLoaded = useRestaurants(s => s.loaded);
  const couriers = useCourierTeam();
  const assemblers = useAssemblerTeam();
  const rests = useMemo(
    () => (!USE_API ? RESTAURANTS : (restaurantsLoaded ? enrichRestaurants(apiRests, RESTAURANTS) : [])),
    [apiRests, restaurantsLoaded],
  );
  const orders = useMemo(
    () => (USE_API ? mapOrdersForAdmin(apiOrders, rests, []) : ALL_ORDERS),
    [apiOrders, rests],
  );
  const totalRestRev = rests.reduce((s,r)=>s+(r.revenueMonth||0),0);
  const totalComm    = rests.reduce((s,r)=>s+Math.round((r.revenueMonth||0)*r.commission/100),0);
  const activeRest   = (USE_API ? orders : REST_ORDERS).filter(o=>o.status!=='delivered'&&o.status!=='cancelled').length;
  const storeOrders  = orders.filter(o=>o.type==='market'&&o.status!=='delivered'&&o.status!=='cancelled');
  const openRestLabel = restaurantsLoaded || !USE_API
    ? `${rests.filter(r=>r.open).length}/${rests.length} открыто`
    : '…';
  const activeCourierCount = couriers.filter(c => c.status === 'busy' || c.status === 'available').length;
  const workingAssemblers = assemblers.filter(a => a.status === 'working' || a.status === 'available').length;
  const clients = useClients();
  const storeDayRevenue = orders
    .filter(o => o.type === 'market')
    .reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  return (
    <div>
      {/* 4 apps */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:20}}>
        {[
          {e:'🛒',l:'Магазин',v:'Работает',sub:`${storeOrders.length} активных заказов`,c:'#1FD760',a:'orders'},
          {e:'🍽',l:'Рестораны',v:openRestLabel,sub:`${activeRest} активных заказов`,c:'#FF8C00',a:'partners'},
          {e:'🛵',l:'Курьеры',v:`${activeCourierCount} активных`,sub:'Live GPS',c:'#3B8EF0',a:'couriers'},
          {e:'📦',l:'Сборщики',v:`${workingAssemblers} на смене`,sub:'Сборка заказов',c:'#9B6DFF',a:'assemblers'},
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
        {[{l:'Выручка магазин/день',v:`${storeDayRevenue.toLocaleString()} ЅМ`,c:'#1FD760',e:'🛒'},{l:'Выручка рестораны/мес',v:`${totalRestRev.toLocaleString()} ЅМ`,c:'#FF8C00',e:'🍽'},{l:'Комиссия КАКАПО',v:`${totalComm.toLocaleString()} ЅМ`,c:'#FFB800',e:'💰'},{l:'Клиентов всего',v:String(clients.length),c:'#00D4C8',e:'👥'}].map((s,i)=>(
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
            <tbody>{orders.filter(o=>o.status!=='delivered'&&o.status!=='cancelled').slice(0,8).map(o=>{
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
  const pricingHydrated = usePricingStore(s => s.hydrated)
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
  const editingRef = useRef(false)

  useEffect(() => {
    usePricingStore.getState().hydrate()
  }, [])

  useEffect(() => {
    if (!pricingHydrated || editingRef.current) return
    setT(normalizePricing({ ...DEFAULT_PRICING, ...pricing }))
  }, [pricing, pricingHydrated])

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

  useEffect(() => {
    editingRef.current = dirty
  }, [dirty])

  const save = async () => {
    const err = validatePricing(t)
    if (err) { setSaveErr(err); return }
    setSaving(true)
    setSaveErr('')
    try {
      const normalized = normalizePricing(t)
      if (USE_API) {
        const savedPricing = await api.updatePricing(normalized)
        const merged = normalizePricing({ ...DEFAULT_PRICING, ...savedPricing })
        usePricingStore.setState({ pricing: merged })
        try {
          if (typeof BroadcastChannel !== 'undefined') {
            new BroadcastChannel('kakapo-pricing').postMessage({ type: 'update', pricing: merged })
          }
        } catch { /* ignore */ }
      } else {
        setPricing(normalized)
      }
      editingRef.current = false
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
    editingRef.current = true
    setT(normalizePricing(config))
    setSaveErr('')
  }

  const resetDefaults = () => {
    editingRef.current = true
    setT(normalizePricing(DEFAULT_PRICING))
    setSaveErr('')
  }

  const updateField = (key: keyof typeof t, raw: string) => {
    editingRef.current = true
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
        {t.courierCommissionPercent ? <> · <b style={{ color: '#3B8EF0' }}>комиссия курьера {t.courierCommissionPercent}%</b> от доставки</> : null}
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
  const [saveErr, setSaveErr] = useState('');

  const storeList = list.filter(p => p.type === 'store');
  const restList  = list.filter(p => p.type === 'rest');

  const openAdd = () => {
    preloadLeaflet();
    setForm({ e:'🏪', color:'#1FD760', type:'store', active:true, lat: STORE_LOCATION.lat, lng: STORE_LOCATION.lng });
    setSaveErr('');
    setModal('add');
  };
  const openEdit = (p:any) => {
    if (p.type !== 'store') return;
    setForm({ ...p, lat: p.lat, lng: p.lng });
    setSaveErr('');
    setModal('edit');
  };
  const closeModal = () => { setModal(null); setSaveErr(''); };

  const pickOnMap = (r: { lat: number; lng: number; address: string }) => {
    setForm((f: any) => ({
      ...f,
      lat: r.lat,
      lng: r.lng,
      addr: r.address?.trim() ? r.address : f.addr,
    }));
    setSaveErr('');
  };

  const save = () => {
    const lat = parseFloat(String(form.lat).replace(',', '.'));
    const lng = parseFloat(String(form.lng).replace(',', '.'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setSaveErr('Укажите точку на карте');
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

  // Важно: это render-функция, а не компонент. Вызываем её как {field(...)},
  // иначе (как <FI/>) input пересоздаётся на каждый ввод и теряет фокус.
  const field = ({lbl,fld,ph='',type='text'}:{lbl:string,fld:string,ph?:string,type?:string}) => (
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
              <AdminLocationMap
                mapKey={`pickup-${modal}-${form.id || 'new'}`}
                lat={form.lat != null ? Number(form.lat) : null}
                lng={form.lng != null ? Number(form.lng) : null}
                addressLabel="Адрес точки"
                onCenterChange={pickOnMap}
              />
              <div style={{display:'grid',gridTemplateColumns:'80px 1fr',gap:10}}>
                {field({lbl:'Эмодзи',fld:'e',ph:'🏪'})}
                {field({lbl:'Название *',fld:'name',ph:'КАКАПО Магазин'})}
              </div>
              {field({lbl:'Цвет (hex)',fld:'color',ph:'#1FD760'})}
              {field({lbl:'Адрес',fld:'addr',ph:'ул. Ленина, 42'})}
              {field({lbl:'Телефон',fld:'phone',ph:'+992 __ ___ __ __'})}
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
  // Демо-заказы курьеров убраны — раздел наполняется реальными данными
  const orders: any[] = [];
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
          <thead><tr><th>Заказ</th><th>Курьер</th><th>Маршрут</th><th>Клиент</th><th>Км</th><th>Доставка</th><th>Прогресс</th><th>Статус</th></tr></thead>
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
                  </td>
                  <td>
                    <span style={{fontFamily:'Unbounded',fontSize:12,fontWeight:800,color:'#1FD760'}}>{dlv} ЅМ</span>
                    {o.step === 'done' && <span style={{ fontSize: 10, color: '#3D6645' }}> 🔒</span>}
                  </td>
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
  // Баннеры и тикер хранятся локально (без сервера). Пусто по умолчанию — админ добавляет сам.
  const TICKERS_KEY = 'kakapo-admin-tickers';
  const BANNERS_KEY = 'kakapo-admin-banners';
  const loadLS = (key: string): any[] => {
    if (typeof window === 'undefined') return [];
    try { const raw = localStorage.getItem(key); const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; } catch { return []; }
  };

  /* ── Тикер ── */
  const [tickers,setTickers] = useState<any[]>(() => loadLS(TICKERS_KEY));
  const [newTick,setNewTick] = useState('');
  // Любое изменение сразу пишем в кэш (localStorage): переживает обновление, без демо и мелькания
  useEffect(() => { try { localStorage.setItem(TICKERS_KEY, JSON.stringify(tickers)); } catch { /* quota */ } }, [tickers]);
  const addTick  = () => { if(!newTick.trim()) return; setTickers(ts=>[...ts,{id:Date.now(),text:newTick.trim(),on:true}]); setNewTick(''); };
  const rmTick   = id => setTickers(ts=>ts.filter(t=>t.id!==id));
  const togTick  = id => setTickers(ts=>ts.map(t=>t.id===id?{...t,on:!t.on}:t));
  const editTick = (id,val) => setTickers(ts=>ts.map(t=>t.id===id?{...t,text:val}:t));

  /* ── Баннеры ── */
  const DEF = {badge:'',title:'',sub:'',disc:'',e:'🎁',bg:'linear-gradient(135deg,#0A1A0A,#1A3020)',ac:'#1FD760',on:true};
  const [banners,setBanners] = useState<any[]>(() => loadLS(BANNERS_KEY));
  useEffect(() => { try { localStorage.setItem(BANNERS_KEY, JSON.stringify(banners)); } catch { /* quota */ } }, [banners]);
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
  // render-функция (не компонент): вызывать как {field(...)}, иначе input теряет фокус при вводе
  const field = ({label,val,onChange,type='text',half}:any) => (
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
            {field({half:true,label:'Заголовок *',val:form.title,onChange:(v:any)=>setForm(f=>({...f,title:v}))})}
            {field({half:true,label:'Бейдж (ФЛЭШ, ПЯТНИЦА...)',val:form.badge,onChange:(v:any)=>setForm(f=>({...f,badge:v}))})}
          </div>
          {field({label:'Подзаголовок',val:form.sub,onChange:(v:any)=>setForm(f=>({...f,sub:v}))})}
          <div style={{display:'flex',gap:12}}>
            {field({half:true,label:'Скидка %',val:form.disc,onChange:(v:any)=>setForm(f=>({...f,disc:v})),type:'number'})}
            {field({half:true,label:'Эмодзи',val:form.e,onChange:(v:any)=>setForm(f=>({...f,e:v}))})}
          </div>
          {field({label:'Цвет акцента (hex, напр. #1FD760)',val:form.ac,onChange:(v:any)=>setForm(f=>({...f,ac:v}))})}
          {field({label:'Фон (CSS, напр. linear-gradient(135deg,#0A2A0A,#1A4A1A))',val:form.bg,onChange:(v:any)=>setForm(f=>({...f,bg:v}))})}
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
   MAIN ADMIN APP — вход по логину / паролю
══════════════════════════════════════════════════════ */
export default function AdminApp() {
  const [session, setSession] = useState<AdminSession | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const s = loadAdminSession()
    if (s?.token) setToken(s.token)
    setSession(s)
    setReady(true)
  }, [])

  if (!ready) {
    return (
      <div style={{
        minHeight: '100vh', background: '#030B05', color: '#8FB897',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13,
      }}>
        Загрузка…
      </div>
    )
  }

  if (!session) {
    return <AdminLoginPage onSuccess={setSession} />
  }

  return (
    <AppNavigationBoundary>
      <AdminAppInner
        session={session}
        onSessionUpdate={setSession}
        onLogout={() => {
          clearAdminSession()
          setToken(null)
          setSession(null)
        }}
      />
    </AppNavigationBoundary>
  )
}

function AdminAppInner({
  session,
  onSessionUpdate,
  onLogout,
}: {
  session: AdminSession
  onSessionUpdate: (s: AdminSession) => void
  onLogout: () => void
}) {
  useApiSync('all');
  const { page, setPage } = useAppNavigation('dashboard');
  useEffect(() => {
    if (USE_API) clearAppDataLocalCacheOnce();
    hydrateCourierStores();
    void syncCourierStoresFromApi();
    void syncCourierTeamFromApi();
    hydrateAssemblerTeamStore();
    void syncAssemblerTeamFromApi();
    if (!USE_API) {
      hydrateClientStore();
      hydrateCardStore();
    }
    hydratePushStore();
    void syncPushFromApi();
    useProductPhotos.getState().hydrate();
    return () => {};
  }, []);
  const TITLES={dashboard:'Dashboard',categories:'Категории товаров',orders:'Все заказы',products:'Товары',inventory:'Склад',promos:'Акции',banners:'Баннеры / Слайдеры',partners:'Рестораны-партнёры',reviews:'Отзывы',couriers:'Курьеры',assemblers:'Сборщики',employees:'Сотрудники',clients:'Клиенты',cards:'Карты',debts:'Долги VIP',push:'Push уведомления',finance:'Финансы',cash:'Касса',ai:'ИИ-ассистент',audit:'История действий',settings:'Настройки',pickups:'Точки забора',courierorders:'Заказы курьеров',tariff:'Тариф доставки'};
  const SUBS={dashboard:'Управление всеми 4 приложениями · г. Яван',categories:'Управление разделами каталога',orders:'Магазин и рестораны · в реальном времени',products:'Синхронизация KAK-XXXX с GBS Market',inventory:'Контроль остатков',promos:'Скидки на товары · категории в магазине автоматически',banners:'Слайдер на главной и в разделе Акций',partners:'Управление, меню, комиссии, выплаты',reviews:'Магазин и рестораны · отдельные вкладки',couriers:'GPS трекинг · kakapo-courier',assemblers:'Команда сборки · kakapo-assembler',employees:'Доступ в приложение Торговля · пароль и разделы',clients:'CRM · все клиенты',cards:'Карты КАКАПО-XXXX · бонусы · долги',debts:'VIP-кредит · долги клиентов · погашение через поддержку',push:'Рассылка клиентам всех приложений',finance:'Выручка · комиссии · выплаты · курьеры · сборщики',cash:'Наличка в кассах · открытые смены · недостачи и излишки',ai:'Gemini · анализ кассы, товаров, долгов, курьеров, сборщиков и ресторанов · Alt+0…9',audit:'Админка и Торговля · кто что изменил · хранение 30 дней',settings:'Доступ · GBS · SMS · контакты',pickups:'Магазин и рестораны · адреса и координаты',courierorders:'Активные заказы с маршрутами · kakapo-courier',tariff:'Тариф доставки · магазин · курьеры · OSRM'};
  return (
    <Layout page={page} setPage={setPage} title={TITLES[page]||page} subtitle={SUBS[page]||''} session={session} onLogout={onLogout}>
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
      {page==='employees'  && <EmployeesPage/>}
      {page==='clients'    && <ClientsPage/>}
      {page==='cards'      && <CardsPage setPage={setPage}/>}
      {page==='debts'      && <DebtsPage setPage={setPage}/>}
      {page==='push'       && <PushPage/>}
      {page==='banners'    && <BannersPage/>}
      {page==='pickups'    && <PickupsPage/>}
      {page==='tariff'     && <TariffPage/>}
      {page==='courierorders' && <CourierOrdersPage/>}
      {page==='finance'    && <FinancePage/>}
      {page==='cash'       && <AdminCashPage/>}
      {page==='ai'         && <AdminAiAssistantPage/>}
      {page==='audit'      && <AuditLogPage/>}
      {page==='settings'   && <SettingsPage setPage={setPage} session={session} onSessionUpdate={onSessionUpdate}/>}
    </Layout>
  );
}
