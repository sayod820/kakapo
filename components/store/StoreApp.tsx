'use client'
import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, type ReactNode, type MouseEvent } from "react";
import GeoAddressPicker from "@/components/shared/GeoAddressPicker";
import dynamic from "next/dynamic";
import { QRCodeSVG } from "qrcode.react";
import { hydrateCourierStores, usePickups, usePricing } from "@/lib/courierStore";
import { resolveCheckoutPickupIds } from "@/lib/pickups";
import { useProductPhotos, resolveProductPhoto, resolveOrderItemPhoto, resolvePhotoUrl } from "@/lib/productPhotos";
import { LiveCatalogProvider, useLiveCatalog } from "@/components/store/LiveCatalogContext";
import { productCatSlug } from "@/lib/enrichCatalog";
import { productRatingUi, restaurantCuisineLabel, restaurantRatingLabel, restaurantReviewsLabel } from "@/lib/catalogUi";
import { useOrders, USE_API, usePromos } from "@/lib/store";
import { api } from "@/lib/api";
import { newClientRef } from "@/lib/offline";
import { mapOrdersForClient } from "@/lib/orderUiMap";
import {
  resolveClientOrderContacts,
  clientContactPointLabel,
  telHref,
  type ClientOrderContact,
} from "@/lib/clientOrderContacts";
import {
  canClientReviewOrder,
  clientReviewKey,
  getClientReviewTargets,
  getPendingReviewTargets,
  resolveReviewTargetLabel,
  reviewPromptForTarget,
  resolveOrderForReview,
  type ClientReviewTarget,
} from "@/lib/clientOrderReview";
import { useAssemblerTeam, hydrateAssemblerTeamStore } from "@/lib/assemblerTeamStore";
import { useApiSync } from "@/lib/useApiSync";
import { useClientReviewNotifSync } from "@/lib/useClientReviewNotifSync";
import { useClientNotificationSync } from "@/lib/useClientNotificationSync";
import { useStoreProfileSync } from "@/lib/useStoreProfileSync";
import { useClientOrderTracking } from "@/lib/useClientOrderTracking";
import { useAutoLoyaltySync } from "@/lib/useAutoLoyaltySync";
import { useCategories } from "@/lib/useCategories";
import { loadStoreUser, saveStoreUser, clearClientSession, getActiveClientPhone, formatTjPhone, isClientSessionActive, phoneDigits, getSessionEpoch, type StoreUser } from "@/lib/clientSession";
import { filterOrdersForStoreUser } from "@/lib/clientAccountLifecycle";
import { fetchCrmStoreUser, crmStoreUsersEqual, mergeCrmIntoStoreUser } from "@/lib/clientProfileSync";
import { deleteClientAccount } from "@/lib/clientAccountDelete";
import {
  getVipCreditState,
  canPayWithCredit,
  chargeCredit,
  spendBonus,
  getBonusUsable,
  loadDebtHistory,
  subscribeDebtHistory,
  debtHistoryTotals,
  splitDebtHistoryBySettlement,
  buildDebtOrderBalances,
  type DebtHistoryEntry,
  type DebtOrderBalance,
  type DebtLedgerResponse,
  refreshStoreUserAfterCredit,
} from "@/lib/clientVipCredit";
import { useSupportContacts, ensureSupportContactsLoaded, toTelHref } from "@/lib/supportContacts";
import { loadClientAddresses, loadClientAddressesUpdatedAt, saveClientAddresses, saveClientAddressesLocal, formatClientAddressLine, ensureClientDefaultAddress } from "@/lib/clientAddresses";
import { ACCOUNT_NS, loadAccountJson, saveAccountJson, migrateLegacyClientData } from "@/lib/clientAccountStorage";
import { mergeCartData, saveRemoteCart, cartSyncTimestamp, findSyncClient, clientCartPayload } from "@/lib/clientCartSync";
import { mergeWishData, saveRemoteWish, wishBundleFromClient } from "@/lib/clientWishSync";
import { mergeAddressData, addressBundleFromClient, saveRemoteAddresses } from "@/lib/clientAddressSync";
import { formatMemberSinceLabel, qualifiesForDebtSection } from "@/lib/cardCrm";
import ClientLoginPage from "@/components/store/ClientLoginPage";
import ClientAddressEditorSheet from "@/components/store/ClientAddressEditorSheet";
import { loadClientReviewMap, loadLocalReviews, saveLocalReview, sortReviewsNewestFirst, resolveReviewPlaceName, avgReviewRating } from "@/lib/clientReviews";
import { getLoyaltyProgress, LOYALTY_TIERS, mergeStoreUserWithCrmLoyalty, resolveAdminVipActive } from "@/lib/clientLoyalty";
import { loyaltyLockFromRecord, isManualLoyaltyActive } from "@/lib/loyaltyAdminLock";
import { syncLoyaltyBonuses, deliveredOrdersNeedingBonusSync } from "@/lib/loyaltyBonus";
import { loyaltyStatsFromOrders } from "@/lib/clientCrm";
import { tierPresentationMap, tierTopGlowMap, loadLoyaltyStatusConfig, subscribeLoyaltyStatusConfig, getRegistrationWelcomeBonus, resolveEffectiveDebtLimit } from "@/lib/loyaltyStatusConfig";
import { getVipRules } from "@/lib/clientLoyalty";
import {
  getUnreadNotificationCount,
  loadClientNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeClientNotifications,
  subscribeNotificationChannel,
  syncClientNotificationsFromApi,
  notificationKind,
  NOTIFICATION_KIND_LABELS,
  resolveNotificationTarget,
  notificationOpenHint,
  type ClientNotificationKind,
} from "@/lib/clientNotifications";
import { useAppNavigation } from "@/lib/useAppNavigation";
import AppNavigationBoundary from "@/components/shared/AppNavigationBoundary";
import { buildCartLineItems, cartHasQty } from '@/lib/cartDisplay'
import { isWeighted, isOutOfStock, stockCartCap, minWeight as productMinWeight, formatCartQty, formatCartQtyStepper, calcLineTotal, lineRetailTotal, lineBulkSavings, lineSaleSavings, lineTotalSavings, cartUnitPrice, formatPriceLabel, nextCartQty, orderItemFromProduct, estimateCartWeightKg, sumCartUnits, formatCartBadgeCount } from "@/lib/productWeight";
import { bulkPricingHintForQty, formatBulkPricingHint, hasBulkPricing } from "@/lib/productBulkPricing";
import { activeProductPromos } from "@/lib/productPromos";
import { inferScheduleMode } from "@/lib/promoSchedule";
import { formatPromoStockLeft, promoCartRoom } from "@/lib/promoStock";
import type { Review } from "@/lib/types";
import { preloadLeaflet } from "@/lib/leafletLoader";

/** Магазин всегда светлый: помечаем документ, чтобы токены не задевали другие приложения. */
function useStoreLightTheme() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const el = document.documentElement;
    el.setAttribute('data-store-light', '');
    return () => { el.removeAttribute('data-store-light'); };
  }, []);
}

const AddressMapPicker = dynamic(() => import("@/components/shared/AddressMapPicker"), { ssr: false });
/** Bonuses and VIP credit need a verified customer (SMS login is postponed); the server ignores them for store orders. */
const STORE_BONUS_CREDIT_ENABLED = false;
/** Self-delete acts on a typed phone number, so it stays off until SMS login exists. */
const STORE_ACCOUNT_DELETE_ENABLED = false;
const CSS = `
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
/* Светлая тема клиентского магазина. Токены живут на .store-shell, чтобы
   не задевать Trade / POS / админку / курьера / сборщика. */
.store-shell{
  /* поверхности */
  --bg:#F6F7F5;--l1:#FFFFFF;--l2:#FFFFFF;--l3:#F1F4F0;--l4:#E9EFE9;
  /* границы */
  --b1:#E3E9E3;--b2:#D7DFD7;
  /* текст */
  --t1:#17251B;--t2:#5F6D64;--t3:#87918B;
  /* бренд */
  --gr:#07883D;--gr2:#066F33;--gr3:#055B2A;--gr-soft:#EAF6EC;--gd:#E9AE00;--gd2:#B45309;
  /* статусы */
  --red:#C33434;--red-soft:#FFF1F1;--blue:#2563EB;--sky:#0E7490;--pur:#7C3AED;--org:#C2410C;
  /* служебные */
  --header-bg:rgba(255,255,255,.94);
  --overlay:rgba(23,37,27,.45);
  --fab-bg:rgba(255,255,255,.94);
  --shade:rgba(23,37,27,.08);
  /* шкала отступов 4/8/12/16/20/24/32 */
  --sp1:4px;--sp2:8px;--sp3:12px;--sp4:16px;--sp5:20px;--sp6:24px;--sp8:32px;
  /* радиусы */
  --r-field:13px;--r-card:16px;--r-banner:18px;--r-badge:7px;
  /* тени */
  --sh1:0 1px 2px rgba(23,37,27,.05);
  --sh2:0 6px 20px rgba(23,37,27,.09);
  --store-w:480px;
  /* высота нижнего меню: используется закреплёнными панелями */
  --nav-h:66px;
}
html,body{background:#F6F7F5;color:#17251B;}
html[data-store-light],html[data-store-light] body{background:#F6F7F5;color:#17251B;}
@media (min-width:600px){.store-shell{--store-w:640px;}}
@media (min-width:900px){.store-shell{--store-w:920px;}}
@media (min-width:1200px){.store-shell{--store-w:1240px;}}
/* Доступный клавиатурный фокус во всём магазине */
.store-shell :focus-visible,html[data-store-light] :focus-visible{outline:2px solid var(--gr);outline-offset:2px;border-radius:8px;}
.store-shell :focus:not(:focus-visible){outline:none;}
@media (prefers-reduced-motion:reduce){
  .store-shell *,.store-shell *::before,.store-shell *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important;}
}
.store-shell{width:100%;max-width:var(--store-w);margin:0 auto;min-height:100vh;min-height:100dvh;overflow-x:clip;background:var(--bg);color:var(--t1);font-family:'Nunito',sans-serif;-webkit-font-smoothing:antialiased;}
/* Нижнее меню: белая панель 64–72px + safe-area. Контент получает отступ
   через .store-page-pad, чтобы панель не перекрывала цены и кнопки. */
.store-page-pad{padding-bottom:calc(88px + env(safe-area-inset-bottom, 0px));}
.store-nav{
  position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:var(--store-w);z-index:200;
  min-height:var(--nav-h);
}
.store-fixed-bar{left:50%!important;transform:translateX(-50%)!important;width:100%!important;max-width:var(--store-w)!important;}
.store-nav-above{bottom:calc(70px + env(safe-area-inset-bottom, 0px))!important;}
.store-topnav{display:none;}
/* Логотип-плитка магазина (брендового файла в проекте нет — сохраняем прежнее представление) */
.store-brand-mark{width:34px;height:34px;border-radius:11px;background:var(--gr);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-family:'Unbounded',sans-serif;font-size:15px;font-weight:900;flex-shrink:0;}
.store-topnav-cart{position:relative;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:var(--l1);border:1px solid var(--b1);color:var(--t2);cursor:pointer;}
.store-topnav-cart:hover{background:var(--gr-soft);color:var(--gr3);border-color:rgba(7,136,61,.3);}
.store-topnav-cart-count{position:absolute;top:-5px;right:-5px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:var(--gr);color:#fff;font-size:11px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;font-family:'Nunito',sans-serif;}
@media (min-width:900px){
  .store-nav{display:none!important;}
  .store-topnav{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:12px 22px;background:var(--header-bg);backdrop-filter:blur(24px);border-bottom:1px solid var(--b1);box-shadow:var(--sh1);}
  .store-topnav-brand{display:flex;align-items:center;gap:10px;font-family:'Unbounded',sans-serif;font-weight:900;font-size:16px;letter-spacing:.3px;color:var(--t1);}
  .store-topnav-tabs{display:flex;gap:6px;}
  .store-topnav-tab{display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border-radius:12px;background:transparent;border:1px solid transparent;color:var(--t2);font-family:'Nunito',sans-serif;font-size:14px;font-weight:700;cursor:pointer;transition:background .18s,color .18s,border-color .18s;}
  .store-topnav-tab:hover{background:var(--gr-soft);color:var(--gr3);}
  .store-topnav-tab.on{background:var(--gr-soft);border-color:rgba(7,136,61,.3);color:var(--gr3);}
}
.store-vip .store-topnav{background:var(--header-bg)!important;border-bottom-color:var(--gd-line)!important;}
.store-vip .store-topnav-tab.on{background:var(--gd-soft)!important;border-color:var(--gd-line2)!important;color:var(--gd-ink)!important;}
.store-prod-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}
@media (min-width:600px){.store-prod-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;}}
@media (min-width:900px){.store-prod-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;}}
@media (min-width:1200px){.store-prod-grid{grid-template-columns:repeat(5,minmax(0,1fr));}}
@media (min-width:900px){
  .store-desktop-pad{padding-left:20px!important;padding-right:20px!important;}
  .inp,.chip,.btn{font-size:14px;}
}
@media (max-width:480px){
  .inp{font-size:16px;min-height:44px;}
}
html,body{background:#F6F7F5;color:#17251B;font-family:'Nunito',sans-serif;-webkit-font-smoothing:antialiased;}
.ub{font-family:'Unbounded',sans-serif;}
.bank-num{
  font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  font-variant-numeric:tabular-nums;
  font-weight:800;
  letter-spacing:-0.04em;
  line-height:1.1;
  max-width:100%;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  display:block;
}
::-webkit-scrollbar{width:3px;height:3px;}::-webkit-scrollbar-track{background:var(--l1);}::-webkit-scrollbar-thumb{background:var(--b2);border-radius:2px;}
@keyframes fadeUp{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
@keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
@keyframes float{0%,100%{transform:translateY(0);}50%{transform:translateY(-6px);}}
@keyframes glow{0%,100%{box-shadow:0 4px 16px rgba(7,136,61,.3);}50%{box-shadow:0 4px 20px rgba(7,136,61,.45);}}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.35;}}
@keyframes spin{from{transform:rotate(0);}to{transform:rotate(360deg);}}
@keyframes notif{from{opacity:0;transform:translate(-50%,-24px);}to{opacity:1;transform:translate(-50%,0);}}
@keyframes scanLine{0%{top:-20%;}100%{top:115%;}}
@keyframes ticker{0%{transform:translateX(0);}100%{transform:translateX(-50%);}}
@keyframes ping{0%{transform:scale(1);opacity:1;}100%{transform:scale(2.4);opacity:0;}}
@keyframes successPop{0%{transform:scale(.7);opacity:0;}60%{transform:scale(1.08);}100%{transform:scale(1);opacity:1;}}
@keyframes slideUp{from{opacity:0;transform:translateY(32px);}to{opacity:1;transform:translateY(0);}}
@keyframes cartPop{0%{transform:scale(1);}50%{transform:scale(1.06);}100%{transform:scale(1);}}
@keyframes vipShimmer{0%{background-position:200% center;}100%{background-position:-200% center;}}
@keyframes vipGlow{0%,100%{box-shadow:0 0 0 0 rgba(233,174,0,.18);}50%{box-shadow:0 0 0 6px rgba(233,174,0,.06);}}
@keyframes tierPulse{0%,100%{transform:scale(1);box-shadow:0 0 0 0 var(--tier-glow);}50%{transform:scale(1.08);box-shadow:0 0 0 6px transparent;}}
@keyframes levelUpPop{0%{opacity:0;transform:translateY(8px) scale(.92);}15%{opacity:1;transform:translateY(0) scale(1.02);}85%{opacity:1;transform:translateY(0) scale(1);}100%{opacity:0;transform:translateY(-6px) scale(.98);}}
@keyframes sparkle{0%,100%{opacity:.25;transform:scale(1);}50%{opacity:.7;transform:scale(1.15);}}
@keyframes progressShine{0%{transform:translateX(-100%);}100%{transform:translateX(200%);}}
@keyframes crownFloat{0%,100%{transform:translateY(0) rotate(-3deg);}50%{transform:translateY(-3px) rotate(3deg);}}
.loyalty-tier-card{position:relative;overflow:hidden;border-radius:20px;}
.loyalty-tier-card::before{content:'';position:absolute;inset:0;opacity:.05;pointer-events:none;background:repeating-linear-gradient(45deg,transparent,transparent 10px,rgba(23,37,27,.35) 10px,rgba(23,37,27,.35) 11px);}
.loyalty-vip-card{animation:vipGlow 3s ease-in-out infinite;}
.loyalty-level-up{animation:levelUpPop 2.4s ease forwards;}
.loyalty-tier-node-active{animation:tierPulse 2.2s ease-in-out infinite;}
.loyalty-vip-shimmer{background:linear-gradient(105deg,transparent 30%,rgba(233,174,0,.35) 50%,transparent 70%);background-size:200% 100%;animation:vipShimmer 3s linear infinite;}
.btn{font-family:'Nunito',sans-serif;font-weight:700;cursor:pointer;border:none;background:transparent;color:inherit;transition:background-color .18s,border-color .18s,color .18s,transform .18s;}
.btn:active{transform:scale(.97);}
.btn:disabled{cursor:not-allowed;opacity:.55;transform:none;}
.card{background:var(--l1);border:1px solid var(--b1);border-radius:16px;overflow:hidden;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease;}
.kakapo-card{background:var(--l1);border:1px solid var(--b1);border-radius:16px;overflow:hidden;}
/* Кнопка добавления и контрол количества */
.p-add{width:100%;min-height:44px;padding:10px;border-radius:var(--r-field);background:var(--gr);color:#fff;display:inline-flex;align-items:center;justify-content:center;gap:6px;font-size:14px;font-weight:800;}
.p-add:hover{background:var(--gr2);}
.p-add:active{background:var(--gr3);}
.p-add-icon{width:44px;height:44px;min-height:44px;padding:0;border-radius:var(--r-field);background:var(--gr);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;line-height:1;}
.p-add-icon:hover{background:var(--gr2);}
.p-add-icon:active{background:var(--gr3);}
.p-add-off{width:100%;min-height:44px;padding:10px;border-radius:var(--r-field);background:var(--l3);border:1px solid var(--b1);color:var(--t3);font-size:13px;font-weight:700;text-align:center;}
.p-qty{display:flex;align-items:center;justify-content:space-between;gap:2px;background:var(--gr-soft);border:1.5px solid rgba(7,136,61,.3);border-radius:var(--r-field);padding:3px;min-height:44px;}
.p-qty button{width:38px;height:38px;border-radius:10px;background:transparent;border:none;display:inline-flex;align-items:center;justify-content:center;color:var(--gr3);font-size:20px;font-weight:800;cursor:pointer;line-height:1;}
.p-qty button:hover{background:var(--gr-soft);}
.p-qty button:disabled{opacity:.4;cursor:not-allowed;}
.p-qty span{font-family:'Unbounded',sans-serif;font-size:14px;font-weight:800;color:var(--gr3);min-width:28px;text-align:center;}
/* Карточка товара: избранное, название-кнопка, строка цены */
.p-wish{position:absolute;top:4px;right:4px;z-index:3;width:44px;height:44px;border-radius:12px;background:transparent;display:inline-flex;align-items:center;justify-content:center;}
.p-wish:hover{background:var(--l3);}
.p-name{display:block;width:100%;text-align:left;padding:0;font-family:'Nunito',sans-serif;font-size:14px;font-weight:600;line-height:1.3;color:var(--t1);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.p-name:hover{color:var(--gr3);}
.p-price-row{display:flex;align-items:flex-end;justify-content:space-between;gap:8px;margin-top:auto;padding-top:6px;min-width:0;}
/* Узкий телефон: цена и кнопка в отдельных строках */
@media (max-width:359px){
  .p-price-row{flex-direction:column;align-items:stretch;gap:6px;}
  .p-price-row .p-add-icon{width:100%;}
  .store-prod-grid,.store-tile-grid{gap:8px;}
}
/* Компактные карточки, чтобы на телефоне было видно больше товаров */
.p-name{min-height:36px;}
.hdr-icon{width:44px;height:44px;border-radius:12px;background:var(--l3);border:1px solid var(--b1);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}
.hdr-icon:hover{background:var(--l4);}
.hdr-addr{display:inline-flex;align-items:center;gap:4px;padding:2px 0;margin-top:1px;max-width:100%;font-size:12px;font-weight:600;color:var(--t2);background:transparent;}
.hdr-addr span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46vw;}
.hdr-addr:hover span{color:var(--gr3);}
.store-nav-item{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:7px 10px;border-radius:12px;min-width:56px;min-height:52px;}
.store-nav-item:hover{background:var(--l3);}
/* Заголовок раздела + ссылка «Все» */
.store-sec-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;}
.store-sec-title{font-size:20px;font-weight:800;color:var(--t1);line-height:1.2;}
.store-sec-all{display:inline-flex;align-items:center;gap:4px;font-family:'Nunito',sans-serif;font-size:14px;font-weight:700;color:var(--gr3);background:transparent;padding:4px 2px;}
.store-sec-all:hover{color:var(--gr2);}
/* Баннер: светло-зелёная поверхность + реальное фото продукта справа */
.store-banner{display:flex;align-items:center;gap:12px;width:100%;text-align:left;border-radius:var(--r-banner);border:1px solid var(--b1);padding:14px 16px;margin-bottom:20px;cursor:pointer;min-height:112px;overflow:hidden;transition:box-shadow .18s ease,border-color .18s ease;}
.store-banner:hover{box-shadow:var(--sh2);border-color:var(--b2);}
.store-banner-text{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;}
.store-banner-title{font-size:18px;font-weight:900;color:var(--t1);line-height:1.22;margin-bottom:4px;}
.store-banner-sub{font-size:13px;color:var(--t2);}
.store-banner-photo{width:112px;height:88px;object-fit:contain;flex-shrink:0;border-radius:12px;background:#fff;}
@media (min-width:600px){.store-banner-photo{width:168px;height:104px;} .store-banner-title{font-size:20px;}}
.store-ticker{background:var(--red-soft);border:1px solid rgba(195,52,52,.18);border-radius:12px;padding:8px 0;overflow:hidden;margin:-8px 0 20px;}
/* Категории: горизонтальная лента с видимым краем следующей плитки */
.cat-rail{display:flex;gap:10px;overflow-x:auto;scrollbar-width:none;margin:0 -16px 24px;padding:0 16px 4px;}
.cat-rail::-webkit-scrollbar{display:none;}
.cat-tile{flex:0 0 110px;display:flex;flex-direction:column;border-radius:var(--r-card);border:1px solid var(--b1);overflow:hidden;cursor:pointer;padding:0;text-align:center;}
.cat-tile:hover{box-shadow:var(--sh2);border-color:var(--b2);}
.cat-tile-media{display:flex;align-items:center;justify-content:center;width:100%;height:76px;background:#fff;overflow:hidden;}
.cat-tile-media img{width:100%;height:100%;object-fit:contain;padding:6px;box-sizing:border-box;display:block;}
.cat-tile-emoji{font-size:30px;line-height:1;}
.cat-tile-label{padding:8px 8px 10px;font-size:12px;font-weight:700;line-height:1.25;min-height:40px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.cat-tile-count{display:block;padding:0 8px 10px;font-size:11px;color:var(--t3);margin-top:-6px;}
/* Строка поиска магазина */
.store-search{display:flex;align-items:center;gap:10px;height:48px;padding:0 14px;border-radius:var(--r-field);background:var(--l1);border:1.5px solid var(--b1);color:var(--t2);}
.store-search:focus-within{border-color:rgba(7,136,61,.45);box-shadow:0 0 0 4px var(--gr-soft);}
.store-search input{flex:1;min-width:0;border:none;outline:none;background:transparent;font-family:'Nunito',sans-serif;font-size:16px;color:var(--t1);}
.store-search input::placeholder{color:var(--t3);}
.store-search button{width:32px;height:32px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;background:transparent;border:none;color:var(--t3);cursor:pointer;flex-shrink:0;}
.store-search button:hover{background:var(--l3);color:var(--t1);}
.hscroll{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;}.hscroll::-webkit-scrollbar{display:none;}
.chip{padding:8px 15px;border-radius:50px;font-size:13px;font-weight:700;cursor:pointer;border:1.5px solid var(--b1);background:var(--l1);color:var(--t2);transition:background-color .18s,color .18s,border-color .18s;font-family:'Nunito',sans-serif;}
.chip:hover{border-color:var(--b2);color:var(--t1);}
.chip.on{background:var(--gr-soft);color:var(--gr3);border-color:rgba(7,136,61,.38);}
.inp{background:var(--l1);border:1.5px solid var(--b1);border-radius:var(--r-field);color:var(--t1);font-family:'Nunito',sans-serif;font-size:16px;outline:none;transition:border-color .18s,box-shadow .18s;padding:13px 16px;min-height:48px;}
.inp:focus{border-color:rgba(7,136,61,.45);box-shadow:0 0 0 4px var(--gr-soft);}
.inp::placeholder{color:var(--t3);}
.inp:disabled{background:var(--l3);color:var(--t3);cursor:not-allowed;}
.inp-err{border-color:rgba(195,52,52,.55)!important;}
.inp-ok{border-color:rgba(7,136,61,.45)!important;}
.toggle{width:44px;height:24px;border-radius:12px;background:var(--b2);position:relative;cursor:pointer;transition:background .2s;flex-shrink:0;}
.toggle.on{background:var(--gr);}
.toggle-dot{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:white;transition:transform .2s cubic-bezier(.16,1,.3,1);}
.toggle.on .toggle-dot{transform:translateX(20px);}
.bdg{display:inline-flex;align-items:center;gap:3px;padding:3px 8px;border-radius:var(--r-badge);font-size:11px;font-weight:800;letter-spacing:.2px;}
.b-gr{background:var(--gr-soft);color:var(--gr3);border:1px solid rgba(7,136,61,.25);}
.b-gd{background:rgba(233,174,0,.14);color:#8A6400;border:1px solid rgba(233,174,0,.3);}
.b-rd{background:var(--red-soft);color:var(--red);border:1px solid rgba(195,52,52,.25);}
.b-bl{background:rgba(37,99,235,.1);color:#1D4ED8;border:1px solid rgba(37,99,235,.25);}
/* Скелетоны загрузки: размеры как у настоящих карточек */
.skel{background:var(--l1);border:1px solid var(--b1);border-radius:16px;overflow:hidden;}
.skel-line{background:var(--l3);border-radius:6px;animation:skelPulse 1.4s ease-in-out infinite;}
@keyframes skelPulse{0%,100%{opacity:1;}50%{opacity:.55;}}
.b-gr{background:var(--gr-soft);color:var(--gr);border:1px solid rgba(7,136,61,.3);}
.b-gd{background:rgba(233,174,0,.12);color:var(--gd);border:1px solid rgba(233,174,0,.28);}
.b-rd{background:rgba(195,52,52,.12);color:var(--red);border:1px solid rgba(195,52,52,.28);}
.b-bl{background:rgba(37,99,235,.1);color:var(--blue);border:1px solid rgba(37,99,235,.25);}
/* VIP / лояльность: светлая поверхность + золотые акценты (не тёмная тема) */
.store-vip{
  --gd-line:rgba(233,174,0,.45);--gd-line2:rgba(233,174,0,.6);--gd-ink:#8A6400;--gd-soft:rgba(233,174,0,.12);
  background:radial-gradient(ellipse 100% 42% at 50% -5%, rgba(233,174,0,.10) 0%, transparent 48%), var(--bg);
}
.store-vip .card{border-color:var(--gd-line);box-shadow:0 4px 18px rgba(233,174,0,.12);}
.store-vip .kakapo-card{border-color:var(--gd-line);}
.store-vip .chip.on{background:var(--gd-soft);color:var(--gd-ink);border-color:var(--gd-line2);}
.store-vip .inp:focus{border-color:var(--gd-line2);box-shadow:0 0 0 4px rgba(233,174,0,.14);}
.store-vip header,.store-vip [data-store-header]{
  background:var(--header-bg)!important;
  border-bottom-color:var(--gd-line)!important;
  box-shadow:0 4px 18px rgba(233,174,0,.12)!important;
}
.store-vip .btn-vip-cta{
  background:linear-gradient(135deg,#E0A400,#E9AE00)!important;
  color:#3A2A00!important;
  box-shadow:0 4px 16px rgba(233,174,0,.32)!important;
}
.store-vip [data-store-page]:not([data-profile-tier]){background:transparent!important;}
.store-vip .store-toast{
  background:var(--l1)!important;
  border-color:var(--gd-line)!important;
  box-shadow:0 8px 30px rgba(233,174,0,.18)!important;
}
.store-vip .store-toast-icon{background:var(--gd-soft)!important;}
.store-vip [data-header-cart]{box-shadow:0 0 0 4px rgba(233,174,0,.14);}
.store-tile-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}
@media (min-width:600px){.store-tile-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;}}
@media (min-width:900px){.store-tile-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;}}
@media (min-width:1200px){.store-tile-grid{grid-template-columns:repeat(5,minmax(0,1fr));}}
/* Кнопки магазина: единая система */
.store-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 18px;border-radius:var(--r-field);font-family:'Nunito',sans-serif;font-size:15px;font-weight:800;border:1.5px solid transparent;cursor:pointer;transition:background-color .18s,border-color .18s,color .18s,transform .18s;}
.store-btn:active{transform:scale(.985);}
.store-btn:disabled{opacity:.5;cursor:not-allowed;transform:none;}
.store-btn-primary{background:var(--gr);color:#fff;}
.store-btn-primary:hover{background:var(--gr2);}
.store-btn-primary:active{background:var(--gr3);}
.store-btn-sec{background:var(--l1);border-color:var(--b1);color:var(--t1);}
.store-btn-sec:hover{background:var(--l3);border-color:var(--b2);}
.store-btn-ghost{background:transparent;color:var(--gr3);min-height:44px;padding:0 12px;}
.store-btn-ghost:hover{background:var(--gr-soft);}
.store-btn-sm{min-height:40px;font-size:13px;padding:0 14px;border-radius:12px;}
.store-btn-block{width:100%;}
/* Подпись поля: постоянная, placeholder её не заменяет */
.store-label{display:block;font-size:12px;font-weight:700;color:var(--t2);margin-bottom:6px;}
.store-field{margin-bottom:16px;}
.store-hint{font-size:12px;color:var(--t2);line-height:1.5;}
.store-err{font-size:12px;color:var(--red);margin-top:6px;font-weight:700;}
/* Скелетоны товарной сетки */
.store-skel-card{background:var(--l1);border:1px solid var(--b1);border-radius:var(--r-card);overflow:hidden;}
.store-skel-media{width:100%;aspect-ratio:1 / 1;border-radius:0;}
/* Пустые состояния */
.store-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:44px 20px;}
.store-empty-icon{width:72px;height:72px;border-radius:22px;background:var(--l3);display:flex;align-items:center;justify-content:center;font-size:34px;margin-bottom:12px;}
.store-empty-title{font-size:17px;font-weight:800;color:var(--t1);}
.store-empty-text{font-size:13px;color:var(--t2);line-height:1.5;max-width:280px;margin-top:6px;}
/* Модальные окна и нижние панели-шторки */
.store-sheet-backdrop{position:fixed;inset:0;z-index:600;background:var(--overlay);display:flex;align-items:flex-end;justify-content:center;animation:fadeIn .18s ease;}
.store-sheet{width:100%;max-width:var(--store-w);background:var(--l1);border:1px solid var(--b1);border-bottom:none;border-radius:22px 22px 0 0;box-shadow:0 -12px 40px rgba(23,37,27,.16);max-height:88vh;overflow-y:auto;animation:slideUp .22s cubic-bezier(.16,1,.3,1);padding-bottom:env(safe-area-inset-bottom,0px);}
.store-sheet-head{position:sticky;top:0;z-index:2;background:var(--l1);display:flex;align-items:center;gap:10px;padding:14px 16px 12px;border-bottom:1px solid var(--b1);}
.store-sheet-title{flex:1;min-width:0;font-size:16px;font-weight:800;color:var(--t1);}
.store-sheet-x{width:36px;height:36px;border-radius:11px;background:var(--l3);border:1px solid var(--b1);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;}
.store-sheet-body{padding:16px;}
/* Строка товара в списке (корзина, избранное, заказ) */
.store-row{display:flex;align-items:center;gap:12px;padding:12px;background:var(--l1);border:1px solid var(--b1);border-radius:var(--r-card);}
.store-row-media{width:64px;height:64px;border-radius:14px;background:#fff;border:1px solid var(--b1);flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;}
/* Закреплённая панель действия: не накладывается на нижнее меню */
.store-sticky-bar{position:fixed;left:50%;transform:translateX(-50%);width:100%;max-width:var(--store-w);z-index:190;bottom:0;background:var(--header-bg);backdrop-filter:blur(24px);border-top:1px solid var(--b1);box-shadow:0 -2px 14px rgba(23,37,27,.05);padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));}
@media (max-width:899px){.store-sticky-bar{bottom:calc(var(--nav-h) + env(safe-area-inset-bottom,0px));}}
/* Страницы без нижнего меню (например, оформление заказа) */
.store-sticky-nonav{bottom:0!important;}
.store-page-pad-lg{padding-bottom:calc(180px + env(safe-area-inset-bottom,0px));}
/* Страница товара: отступы по бокам + место под фото и нижнее меню */
.store-hero-pad{padding:0 16px calc(180px + env(safe-area-inset-bottom,0px));}
/* Список страницы с закреплённой панелью действия и нижним меню */
.store-list-pad{padding:14px 16px calc(220px + env(safe-area-inset-bottom,0px));}
/* Верхняя навигация для компьютера */
.store-desktop-tabs{padding:10px 20px;background:var(--l1);border-bottom:1px solid var(--b1);}
/* Более плотная сетка на очень узких экранах */
@media (max-width:359px){.store-shell{--sp4:12px;} .store-page-pad-lg{padding-bottom:calc(196px + env(safe-area-inset-bottom,0px));}}
@media (hover:hover) and (min-width:900px){
  .card:hover{transform:translateY(-2px);box-shadow:var(--sh2);border-color:var(--b2);}
  .store-lift{transition:transform .18s ease,box-shadow .18s ease;}
  .store-lift:hover{transform:translateY(-2px);box-shadow:var(--sh2);}
}
`;
const Ic = ({ n, s=20, c="currentColor", w=1.8, fill="none" }) => {
  const icons = {
    home:    <><path d="M3 9.5L12 2l9 7.5V21a1 1 0 01-1 1H5a1 1 0 01-1-1z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
    tag:     <><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></>,
    gift:    <><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></>,
    truck:   <><rect x="1" y="3" width="15" height="13" rx="1"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></>,
    user:    <><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
    search:  <><circle cx="11" cy="11" r="7.5"/><path d="M21 21l-4-4"/></>,
    x:       <><path d="M18 6L6 18"/><path d="M6 6l12 12"/></>,
    arrL:    <><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 5 5 12 12 19"/></>,
    arr:     <><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></>,
    cart:    <><circle cx="8.5" cy="21" r="1.2"/><circle cx="19" cy="21" r="1.2"/><path d="M1 1h3.5l2 10.5a2 2 0 002 1.5h9.7a2 2 0 001.95-1.55L22 6H5"/></>,
    heart:   <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>,
    star:    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor" stroke="none"/>,
    plus:    <><path d="M12 5v14"/><path d="M5 12h14"/></>,
    minus:   <path d="M5 12h14"/>,
    check:   <polyline points="20 6 9 17 4 12"/>,
    bell:    <><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></>,
    map:     <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></>,
    clock:   <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>,
    phone:   <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014.11 10a19.79 19.79 0 01-3.07-8.67A2 2 0 012.89 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7 8.09a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>,
    trash:   <><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></>,
    bag:     <><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></>,
    store:   <><path d="M3 9l1.5-6h15L21 9"/><path d="M3 9v11a1 1 0 001 1h16a1 1 0 001-1V9"/><path d="M3 9h18"/><path d="M9 21V12h6v9"/></>,
    repeat:  <><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></>,
    card:    <><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></>,
    qr:      <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="3" height="3"/><rect x="18" y="14" width="3" height="3"/><rect x="14" y="18" width="3" height="3"/><rect x="18" y="18" width="3" height="3"/></>,
    shield:  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>,
    camera:  <><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></>,
    percent: <><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></>,
    filter:  <><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></>,
    logout:  <><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
    copy:    <><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></>,
    msg:     <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>,
    send:    <><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>,
    zap:     <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor" stroke="none"/>,
    grid:    <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    list:    <><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="18" r="1.5" fill="currentColor" stroke="none"/></>,
    info:    <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>,
    help:    <><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
    tg:      <><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>,
    crown:   <><path d="M2 20h20"/><path d="M5 20V8l7-6 7 6v12"/><path d="M2 8l4 4 6-6 6 6 4-4"/></>,
    wa:      <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/>,
    share:   <><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></>,
    insta:   <><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></>,
  };
  return <svg width={s} height={s} viewBox="0 0 24 24" fill={fill} stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round">{icons[n]||null}</svg>;
};

const Stars = ({ r, s=10 }) => (
  <div style={{ display:"flex", gap:1.5 }}>
    {[1,2,3,4,5].map(i => (
      <svg key={i} width={s} height={s} viewBox="0 0 24 24">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
          fill={i <= Math.round(r) ? "#E0A400" : "rgba(233,174,0,.15)"} stroke="none"/>
      </svg>
    ))}
  </div>
);

const Toast = ({ msg, isVip = false }) => !msg ? null : (
  <div
    role="status"
    aria-live="polite"
    style={{
      position:"fixed", top:16, left:"50%", zIndex:999,
      animation:"notif .24s cubic-bezier(.16,1,.3,1)",
      background:"var(--l1)",
      border:`1.5px solid ${isVip ? "rgba(233,174,0,.45)" : "var(--b1)"}`,
      borderRadius:14, padding:"10px 16px",
      display:"flex", alignItems:"center", gap:10,
      boxShadow:"0 12px 30px rgba(23,37,27,.16)",
      transform:"translateX(-50%)", maxWidth:"min(92vw, 460px)",
    }}
  >
    <div style={{ width:22, height:22, borderRadius:"50%", background: isVip ? "rgba(233,174,0,.16)" : "var(--gr-soft)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
      <Ic n="check" s={12} c={isVip ? "#8A6400" : "var(--gr3)"} w={2.5}/>
    </div>
    <span style={{ fontSize:13, fontWeight:700, color:"var(--t1)" }}>{msg}</span>
  </div>
);

const Nav = ({ page, go, user: userProp }: any) => {
  const syncedUser = userProp ?? loadStoreUser()
  const { isVip } = resolveUserVip(syncedUser)
  return (
  <nav className="store-nav" style={{
    background:"var(--l1)",
    borderTop:"1px solid var(--b1)",
    boxShadow:"0 -2px 14px rgba(23,37,27,.05)",
    padding:"6px 8px calc(6px + env(safe-area-inset-bottom, 0px))",
    display:"flex", justifyContent:"space-around", alignItems:"stretch",
  }}>
    {[{id:"home",icon:"home",label:"Главная"},{id:"catalog",icon:"tag",label:"Каталог"},{id:"orders",icon:"truck",label:"Заказы"},{id:"promos",icon:"gift",label:"Акции"},{id:"profile",icon:"user",label:"Профиль"}].map(item => {
      const on = page === item.id
      const activeColor = on ? (isVip ? "#8A6400" : "var(--gr3)") : "var(--t3)"
      const isProfile = item.id === "profile"
      return (
      <button key={item.id} type="button" onClick={() => go(item.id)} className="btn store-nav-item"
        aria-current={on ? "page" : undefined}
        style={{ background:on ? (isVip ? "rgba(233,174,0,.12)" : "var(--gr-soft)") : "transparent", color:activeColor, position:"relative" }}>
        {isVip && isProfile && (
          <div style={{ position:"absolute", top:0, right:10, fontSize:10, lineHeight:1 }} aria-hidden="true">👑</div>
        )}
        <Ic n={item.icon} s={22} c={activeColor}/>
        <span style={{ fontSize:11, fontWeight:on?800:600 }}>{isProfile && isVip ? "VIP" : item.label}</span>
      </button>
    )})}
  </nav>
  )
}

/** Компактная плавающая кнопка корзины */
const FloatingCartBtn = ({ count, onClick, label = "В корзину", isVip: isVipProp }: any) => {
  const { isVip: isVipUser } = resolveUserVip(loadStoreUser())
  const isVip = isVipProp ?? isVipUser
  return (
  <div style={{ position:"fixed", bottom:82, left:0, right:0, zIndex:90, display:"flex", justifyContent:"center", pointerEvents:"none", animation:"fadeUp .35s cubic-bezier(.16,1,.3,1)" }}>
    <button
      type="button"
      onClick={onClick}
      className="btn"
      style={{
        pointerEvents:"auto",
        display:"inline-flex",
        alignItems:"center",
        gap:6,
        padding:"6px 12px 6px 7px",
        borderRadius:999,
        background: isVip ? "linear-gradient(135deg,#A97800 0%,#E9AE00 100%)" : "linear-gradient(135deg,#066F33 0%,#07883D 100%)",
        border: isVip ? "1px solid rgba(138,100,0,.35)" : "1px solid rgba(255,255,255,.14)",
        boxShadow: isVip ? "0 3px 14px rgba(233,174,0,.38), inset 0 1px 0 rgba(255,255,255,.2)" : "0 3px 12px rgba(7,136,61,.26), inset 0 1px 0 rgba(255,255,255,.16)",
        maxWidth:"calc(100% - 44px)",
      }}
    >
      <div style={{
        minWidth:19, height:19, padding:"0 5px", borderRadius:999,
        background:"rgba(23,37,27,.35)", border:"1px solid var(--b1)",
        display:"flex", alignItems:"center", justifyContent:"center",
        fontFamily:"Unbounded", fontSize:9, fontWeight:900, color:"white", flexShrink:0,
      }}>{count}</div>
      <span style={{ fontSize:12, fontWeight:800, color:"white", whiteSpace:"nowrap", letterSpacing:"-.01em" }}>{label}</span>
      <Ic n="arr" s={11} c="rgba(255,255,255,.85)"/>
    </button>
  </div>
  );
};

/** Короткая строка адреса для шапки: реальные данные клиента, иначе приглашение. */
function useClientAddressLine(user?: StoreUser | null) {
  const phone = (user?.phone || getActiveClientPhone(user) || undefined) as string | undefined
  const [line, setLine] = useState("")
  useEffect(() => {
    if (typeof window === "undefined") return
    const read = () => {
      try {
        const list = loadClientAddresses(phone) || []
        const def = list.find((a: any) => a.def) || list[0]
        const full = def ? formatClientAddressLine(def) : ""
        setLine(full ? full.split(",").slice(0, 2).join(",").trim() : "")
      } catch { setLine("") }
    }
    read()
    const onFocus = () => read()
    window.addEventListener("focus", onFocus)
    const t = setInterval(read, 20000)
    return () => { window.removeEventListener("focus", onFocus); clearInterval(t) }
  }, [phone])
  return line ? `Яван · ${line}` : "Яван · Укажите адрес"
}

const Header = ({ title, back, go, cart, user: userProp, hideSearch = false }: any) => {
  const { prods } = useLiveCatalog();
  const user = userProp ?? loadStoreUser()
  const { isVip } = resolveUserVip(user)
  const qty = formatCartBadgeCount(sumCartUnits(cart || {}, prods));
  const qtyNum = sumCartUnits(cart || {}, prods);
  const address = useClientAddressLine(user)
  return (
    <header data-store-header style={{
      position:"sticky", top:0, zIndex:100,
      background:"var(--header-bg)", backdropFilter:"blur(20px)",
      borderBottom:"1px solid var(--b1)",
    }}>
      <div style={{ padding:"10px 16px", display:"flex", alignItems:"center", gap:10 }}>
        {back ? (
          <button onClick={() => storeBack(back, go)} className="btn hdr-icon" aria-label="Назад">
            <Ic n="arrL" s={18} c="var(--t1)"/>
          </button>
        ) : (
          <span className="store-brand-mark" aria-hidden="true">K</span>
        )}
        <div style={{ flex:1, minWidth:0 }}>
          {title ? (
            <div className="ub" style={{ fontSize:18, fontWeight:800, color:"var(--t1)" }}>{title}</div>
          ) : (
            <>
              <div className="ub" style={{ fontSize:17, fontWeight:900, color:"var(--t1)", letterSpacing:"-.01em" }}>КАКАПО{isVip ? " VIP" : ""}</div>
              <button type="button" className="btn hdr-addr" onClick={() => go("addresses")} aria-label="Изменить адрес доставки">
                <Ic n="map" s={12} c={isVip ? "#8A6400" : "var(--gr3)"} w={2}/>
                <span>{address}</span>
                <Ic n="arr" s={11} c="var(--t3)"/>
              </button>
            </>
          )}
        </div>
        {hideSearch ? null : (
          <button onClick={() => go("search")} className="btn hdr-icon" aria-label="Поиск">
            <Ic n="search" s={18} c="var(--t1)"/>
          </button>
        )}
        <CartHeaderButton count={qty} qtyNum={qtyNum} onClick={() => go("cart")} isVip={isVip} />
      </div>
    </header>
  );
};
const PRODS = [
  {id:1,art:"KAK-0001",e:"🥦",name:"Брокколи свежая",    unit:"500 гр",price:5.50, old:7.20, hot:true, isNew:false,org:true, r:4.9,rv:184,grad:"linear-gradient(145deg,#0D2A0D,#1A4A1A)",cat:"veg",   desc:"Свежая брокколи без пестицидов, богата витаминами.",   specs:{Вес:"500 гр",Калории:"34 ккал/100г",Страна:"Таджикистан"}},
  {id:2,art:"KAK-0002",e:"🍅",name:"Томаты черри",        unit:"400 гр",price:7.90, old:null, hot:false,isNew:true, org:false,r:4.7,rv:92, grad:"linear-gradient(145deg,#2A0E0E,#4A1818)",cat:"veg",   desc:"Сладкие томаты черри, идеальны для салатов.",         specs:{Вес:"400 гр",Калории:"18 ккал/100г",Страна:"Таджикистан"}},
  {id:3,art:"KAK-0003",e:"🍊",name:"Апельсины Навел",     unit:"1 кг",  price:6.50, old:8.90, hot:true, isNew:false,org:false,r:4.8,rv:310,grad:"linear-gradient(145deg,#2A1A06,#4A2E12)",cat:"veg",   desc:"Сочные апельсины сорта Навел, богаты витамином C.",    specs:{Вес:"1 кг",Калории:"47 ккал/100г",Страна:"Таджикистан"}},
  {id:4,art:"KAK-0004",e:"🥩",name:"Говядина вырезка",    unit:"500 гр",price:38.00,old:47.0, hot:true, isNew:false,org:false,r:5.0,rv:225,grad:"linear-gradient(145deg,#2A0E0E,#501818)",cat:"meat",  desc:"Охлаждённая говяжья вырезка, нежное мясо высшего сорта.", specs:{Вес:"500 гр",Белки:"26 г/100г",Страна:"Таджикистан"}, sellType:"weight", unitGrams:500, weightStep:100, minWeight:100},
  {id:5,art:"KAK-0005",e:"🍗",name:"Куриное филе",        unit:"1 кг",  price:16.50,old:null, hot:true, isNew:false,org:false,r:4.8,rv:441,grad:"linear-gradient(145deg,#2A1408,#481E0C)",cat:"meat",  desc:"Свежее куриное филе без кожи и костей, охлаждённое.", specs:{Вес:"1 кг",Белки:"23 г/100г",Страна:"Таджикистан"}, sellType:"weight", unitGrams:1000, weightStep:100, minWeight:100},
  {id:6,art:"KAK-0006",e:"🥛",name:"Молоко 3.2%",         unit:"1 л",   price:4.90, old:6.20, hot:false,isNew:false,org:false,r:4.7,rv:388,grad:"linear-gradient(145deg,#0D2040,#163460)",cat:"dairy",  desc:"Пастеризованное молоко 3.2% жирности, натуральный продукт.", specs:{Объём:"1 л",Жирность:"3.2%",Страна:"Таджикистан"}},
  {id:7,art:"KAK-0007",e:"🧀",name:"Сыр Российский",      unit:"250 гр",price:18.50,old:23.0, hot:true, isNew:false,org:false,r:4.8,rv:127,grad:"linear-gradient(145deg,#0D2040,#163460)",cat:"dairy",  desc:"Твёрдый сыр Российский, жирность 50%, отличный вкус.",  specs:{Вес:"250 гр",Жирность:"50%",Страна:"Таджикистан"}, sellType:"weight", unitGrams:250, weightStep:100, minWeight:100},
  {id:8,art:"KAK-0008",e:"🥐",name:"Круассан масляный",   unit:"шт",    price:2.50, old:null, hot:true, isNew:false,org:false,r:4.9,rv:203,grad:"linear-gradient(145deg,#2A1A06,#442A0E)",cat:"bread",  desc:"Свежий масляный круассан, выпечка каждое утро.",        specs:{Вес:"80 гр",Калории:"410 ккал/100г",Страна:"Таджикистан"}},
  {id:9,art:"KAK-0009",e:"☕",name:"Кофе Nescafé Gold",   unit:"190 гр",price:32.00,old:38.5, hot:false,isNew:false,org:false,r:4.9,rv:178,grad:"linear-gradient(145deg,#261A06,#402C0C)",cat:"drink",  desc:"Растворимый кофе Nescafé Gold, насыщенный вкус и аромат.", specs:{Вес:"190 гр",Тип:"Растворимый",Страна:"Швейцария"}},
  {id:10,art:"KAK-0010",e:"🧃",name:"Сок Rich Яблоко",   unit:"1 л",   price:7.20, old:9.50, hot:false,isNew:false,org:false,r:4.6,rv:231,grad:"linear-gradient(145deg,#041820,#0C2E3A)",cat:"drink",  desc:"Яблочный сок Rich прямого отжима, натуральный без сахара.", specs:{Объём:"1 л",Калории:"46 ккал/100г",Страна:"Россия"}},
  {id:11,art:"KAK-0011",e:"🐟",name:"Лосось слабосолёный",unit:"200 гр",price:28.00,old:35.0, hot:true, isNew:false,org:false,r:4.9,rv:152,grad:"linear-gradient(145deg,#071C2E,#102E4A)",cat:"fish",   desc:"Нежный слабосолёный лосось, нарезка, готов к употреблению.", specs:{Вес:"200 гр",Жирность:"13 г/100г",Страна:"Норвегия"}},
  {id:12,art:"KAK-0012",e:"🍫",name:"Шоколад Alpen Gold", unit:"90 гр", price:6.50, old:8.00, hot:false,isNew:false,org:false,r:4.6,rv:344,grad:"linear-gradient(145deg,#1C0E2C,#2E1848)",cat:"sweet",  desc:"Молочный шоколад Alpen Gold с нежным вкусом карамели.", specs:{Вес:"90 гр",Какао:"32%",Страна:"Россия"}},
];

const CAT_THEME: Record<string, { color: string; bg: string; e: string }> = {
  snacks: { color: "#FB923C", bg: "linear-gradient(145deg,#2A1000,#4A2000)", e: "🍿" },
  bakery: { color: "#FCD34D", bg: "linear-gradient(145deg,#281806,#4A2E12)", e: "🥐" },
  beverages: { color: "#67E8F9", bg: "linear-gradient(145deg,#041820,#0C2E3A)", e: "🧃" },
  frozen: { color: "#7DD3FC", bg: "linear-gradient(145deg,#051822,#0E2C3E)", e: "🧊" },
  household_chem: { color: "#6EE7B7", bg: "linear-gradient(145deg,#062018,#103A28)", e: "🧴" },
  sweets_world: { color: "#C084FC", bg: "linear-gradient(145deg,#1A0C28,#2E1848)", e: "🍫" },
  stationery: { color: "#A5B4FC", bg: "linear-gradient(145deg,#10182A,#1C2848)", e: "📚" },
  conservation: { color: "#FDE68A", bg: "linear-gradient(145deg,#241B08,#453412)", e: "🥫" },
  tea_coffee: { color: "#D4A574", bg: "linear-gradient(145deg,#281806,#4A2E12)", e: "☕" },
  meat: { color: "#FF6B6B", bg: "linear-gradient(145deg,#2A0A0A,#4A1818)", e: "🥩" },
  veg_fruit: { color: "#56C956", bg: "linear-gradient(145deg,#0D2A0D,#1A4A1A)", e: "🥦" },
  dairy: { color: "#93C5FD", bg: "linear-gradient(145deg,#0A1828,#163050)", e: "🥛" },
  oils_sauces: { color: "#FBBF24", bg: "linear-gradient(145deg,#281800,#4A2C00)", e: "🫗" },
  beauty: { color: "#F9A8D4", bg: "linear-gradient(145deg,#2A0818,#4A1028)", e: "🪥" },
  grocery: { color: "#FDE68A", bg: "linear-gradient(145deg,#241B08,#453412)", e: "🧂" },
  appliances: { color: "#CBD5E1", bg: "linear-gradient(145deg,#101820,#1C2A38)", e: "🔌" },
  fish: { color: "#7DD3FC", bg: "linear-gradient(145deg,#051822,#0E2C3E)", e: "🐟" },
  kids: { color: "#FBBF24", bg: "linear-gradient(145deg,#281800,#4A2C00)", e: "🧸" },
  household: { color: "#CBD5E1", bg: "linear-gradient(145deg,#101820,#1C2A38)", e: "🏠" },
  other: { color: "var(--gr)", bg: "linear-gradient(145deg,#0B130E,#162019)", e: "📦" },
  // legacy keys
  veg: { color: "#56C956", bg: "linear-gradient(145deg,#0D2A0D,#1A4A1A)", e: "🥦" },
  drinks: { color: "#67E8F9", bg: "linear-gradient(145deg,#041820,#0C2E3A)", e: "🧃" },
  sweets: { color: "#C084FC", bg: "linear-gradient(145deg,#1A0C28,#2E1848)", e: "🍫" },
  bread: { color: "#FCD34D", bg: "linear-gradient(145deg,#281806,#4A2E12)", e: "🥐" },
  house: { color: "#6EE7B7", bg: "linear-gradient(145deg,#062018,#103A28)", e: "🧴" },
  home: { color: "#CBD5E1", bg: "linear-gradient(145deg,#101820,#1C2A38)", e: "🏠" },
}

/** Пастельный фон категории для светлой темы */
function catThemeForMode(key: string, light: boolean) {
  const base = CAT_THEME[key] || CAT_THEME.other
  if (!light) return base
  const c = base.color.startsWith('var(') ? '#07883D' : base.color
  // Светлые акценты на белом нечитаемы — затемняем оттенок для текста.
  const ink = `color-mix(in srgb, ${c} 58%, #17251B)`
  return {
    ...base,
    bg: `linear-gradient(145deg, color-mix(in srgb, ${c} 20%, #FFFFFF), color-mix(in srgb, ${c} 9%, #F6F7F5))`,
    color: ink,
  }
}

/** Мягкий баннер / плитка вместо тёмного градиента */
function softAccentSurface(accent: string, light: boolean, darkFallback: string) {
  if (!light) return darkFallback
  const c = accent.startsWith('var(') ? '#07883D' : accent
  return `linear-gradient(135deg, color-mix(in srgb, ${c} 18%, #FFFFFF), color-mix(in srgb, ${c} 8%, #F6F7F5))`
}

/** Светлый градиент из тёмного (берёт первый #hex как акцент) */
function softFromDarkGrad(darkGrad: string, light: boolean, fallbackAccent = '#07883D') {
  if (!light) return darkGrad
  const m = String(darkGrad || '').match(/#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/)
  const accent = m ? `#${m[1]}` : fallbackAccent
  return softAccentSurface(accent, true, darkGrad)
}

function insetChipBg(light: boolean, alphaDark = 0.25) {
  return light ? 'rgba(12,26,16,.05)' : `rgba(23,37,27,${alphaDark})`
}

const SHOWCASE_CACHE_KEY = 'kakapo_store_showcase_v1'

type StoreShowcase = { banners: any[]; tickers: any[] }

function readShowcaseCache(): StoreShowcase | null {
  if (typeof window === 'undefined') return null
  try {
    const v = JSON.parse(localStorage.getItem(SHOWCASE_CACHE_KEY) || 'null')
    return v && Array.isArray(v.banners) && Array.isArray(v.tickers) ? v : null
  } catch { return null }
}

function useStoreShowcase(): StoreShowcase {
  const [sc, setSc] = useState<StoreShowcase>(() => readShowcaseCache() || { banners: [], tickers: [] })
  useEffect(() => {
    let alive = true
    const load = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      api.getShowcase().then(s => {
        if (!alive) return
        const next = { banners: Array.isArray(s?.banners) ? s.banners : [], tickers: Array.isArray(s?.tickers) ? s.tickers : [] }
        setSc(next)
        try { localStorage.setItem(SHOWCASE_CACHE_KEY, JSON.stringify(next)) } catch { /* quota */ }
      }).catch(() => {})
    }
    load()
    const t = setInterval(load, 5 * 60_000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  return sc
}

function storeBannerSlides(light: boolean, showcase: StoreShowcase) {
  const fromAdmin = showcase.banners
    .filter(b => b && b.on !== false && String(b.title || '').trim())
    .map(b => ({
      e: b.e || '🎁',
      title: String(b.title),
      sub: String(b.sub || ''),
      badge: String(b.badge || ''),
      disc: Number(b.disc) > 0 ? Number(b.disc) : null as number | null,
      ac: b.ac || 'var(--gr)',
      bg: b.bg || softAccentSurface('#07883D', light, 'linear-gradient(135deg,#061A0C,#0F3020)'),
    }))
  if (fromAdmin.length) return fromAdmin
  return [
    { e: '🥬', title: 'Свежие продукты к вашему столу', sub: 'Доставка по Явану', badge: '', disc: null as number | null, ac: 'var(--gr)', bg: softAccentSurface('#07883D', light, 'linear-gradient(135deg,#061A0C,#0F3020)') },
  ]
}

function catThemeKey(id: string) {
  const slug = String(id || "")
  if (slug.startsWith("veg_fruit") || slug.startsWith("veg")) return "veg_fruit"
  if (slug.startsWith("meat")) return "meat"
  if (slug.startsWith("dairy")) return "dairy"
  if (slug.startsWith("bakery") || slug.startsWith("bread")) return "bakery"
  if (slug.startsWith("beverages") || slug.startsWith("drinks")) return "beverages"
  if (slug.startsWith("tea_coffee")) return "tea_coffee"
  if (slug.startsWith("sweets_world") || slug.startsWith("sweets")) return "sweets_world"
  if (slug.startsWith("snacks")) return "snacks"
  if (slug.startsWith("oils_sauces")) return "oils_sauces"
  if (slug.startsWith("conservation")) return "conservation"
  if (slug.startsWith("grocery")) return "grocery"
  if (slug.startsWith("frozen")) return "frozen"
  if (slug.startsWith("kids")) return "kids"
  if (slug.startsWith("household_chem") || slug.startsWith("house")) return "household_chem"
  if (slug.startsWith("beauty")) return "beauty"
  if (slug.startsWith("stationery")) return "stationery"
  if (slug.startsWith("appliances")) return "appliances"
  if (slug.startsWith("household") || slug.startsWith("home")) return "household"
  if (slug.startsWith("fish")) return "fish"
  return "other"
}

function useStoreCategories() {
  const light = true
  const { categories, loaded } = useCategories()
  return useMemo(() => {
    if (!categories.length) {
      return { cats: [], rootCats: [], loaded, ready: loaded }
    }
    const byId = new Map(categories.map(cat => [cat.id, cat]))
    const cats = categories
      .map(cat => {
        const parent = cat.parent_id != null ? byId.get(Number(cat.parent_id)) : null
        const themeVis = catThemeForMode(catThemeKey(parent?.slug || cat.slug), light)
        return {
          id: cat.slug || String(cat.id),
          e: cat.emoji || themeVis.e,
          label: cat.name,
          color: themeVis.color,
          bg: themeVis.bg,
          parentId: parent?.slug || null,
          order: cat.order || 99,
        }
      })
      .sort((a, b) => {
        if (a.parentId !== b.parentId) return (a.parentId || '').localeCompare(b.parentId || '')
        return (a.order || 99) - (b.order || 99)
      })
    return { cats, rootCats: cats.filter(c => !c.parentId), loaded: true, ready: true }
  }, [categories, loaded, light])
}

function CatSkeleton({ count = 6, width = 90 }: { count?: number; width?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            flexShrink: 0,
            width,
            height: 88,
            borderRadius: 16,
            background: 'var(--l2)',
            border: '1px solid var(--b1)',
            opacity: 0.55,
          }}
        />
      ))}
    </>
  )
}

const HOT_HITS_CAT = {
  id: "hot",
  e: "🔥",
  label: "Хиты продаж",
  bg: "linear-gradient(145deg,#2A1000,#4A2000)",
  color: "var(--org)",
};

let topProductIdsCache = null;
let topProductIdsRequest = null;
/** «Хиты»: products flagged hot by the admin first, then the most frequent in kassa receipts (30 days). */
function useTopProducts(prods, limit = 12) {
  const [ids, setIds] = useState(topProductIdsCache);
  useEffect(() => {
    if (!USE_API || topProductIdsCache) return;
    let alive = true;
    topProductIdsRequest = topProductIdsRequest || api.getTopProductIds(24)
      .then(r => (topProductIdsCache = Array.isArray(r?.ids) ? r.ids : []))
      .catch(() => { topProductIdsRequest = null; return []; });
    topProductIdsRequest.then(v => { if (alive) setIds(v); });
    return () => { alive = false; };
  }, []);
  return useMemo(() => {
    const byId = new Map(prods.map(p => [Number(p.id), p]));
    const flagged = prods.filter(p => p.hot && !isOutOfStock(p));
    const seen = new Set(flagged.map(p => p.id));
    const fromSales = (ids || [])
      .map(id => byId.get(Number(id)))
      .filter(p => p && !seen.has(p.id) && !isOutOfStock(p) && Number(p.price) > 0);
    return [...flagged, ...fromSales].slice(0, limit);
  }, [prods, ids, limit]);
}

/** Товар со скидкой: старая цена выше текущей, остаток по акции не исчерпан. */
function isSaleProduct(p: any) {
  const old = Number(p?.old), price = Number(p?.price)
  return Number.isFinite(old) && Number.isFinite(price) && old > price && (p?.promoStockLeft == null || Number(p.promoStockLeft) > 0)
}

/** Размер скидки в процентах по реальным данным. */
function saleDisc(p: any) {
  const old = Number(p?.old), price = Number(p?.price)
  if (!Number.isFinite(old) || !Number.isFinite(price) || old <= price) return 0
  return Math.round((1 - price / old) * 100)
}

/** Поисковый запрос магазина: не теряем между страницами. */
const STORE_SEARCH_Q_KEY = 'kakapo_store_search_q'
function readSearchQuery(): string {
  if (typeof window === "undefined") return ""
  try { return sessionStorage.getItem(STORE_SEARCH_Q_KEY) || "" } catch { return "" }
}
function writeSearchQuery(q: string) {
  if (typeof window === "undefined") return
  try {
    if (q) sessionStorage.setItem(STORE_SEARCH_Q_KEY, q)
    else sessionStorage.removeItem(STORE_SEARCH_Q_KEY)
  } catch { /* quota */ }
}

function productsInCategory(prods, catId, subCatId = null, cats = []) {
  if (catId === "hot") return prods.filter(p => p.hot);
  const children = cats.filter(c => c.parentId === catId).map(c => c.id)
  return prods.filter(p => {
    const slug = productCatSlug(p);
    if (subCatId) return slug === subCatId;
    if (catId) {
      return slug === catId || children.includes(slug);
    }
    return true;
  });
}

function formatProductCount(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return `${n} товаров`;
  if (mod10 === 1) return `${n} товар`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} товара`;
  return `${n} товаров`;
}

const RESTAURANTS = [
  {
    id:'R-01', name:'Чайхона Оромгох',   emoji:'🍖', rating:4.8, reviews:0,
    cuisine:'Таджикская',            tags:['Плов','Шашлык','Манты'],
    minOrder:20, deliveryMin:35, deliveryFee:5, open:true,
    hours:'09:00–23:00', img:'linear-gradient(135deg,#2A1506,#4A2A0C)',
    address:'ул. Рудаки, 15',             commission:15, email:'chaihona@kakapo.tj', revenueMonth:14280, ordersMonth:312,
    categories:['Горячее','Шашлык','Салаты','Супы','Напитки'],
    menu:[
      {id:1,cat:'Горячее', e:'🍚',name:'Плов узбекский',     desc:'Рис, мясо, морковь, специи',price:18,old:null,  popular:true, time:25,inStock:true},
      {id:2,cat:'Шашлык',  e:'🥩',name:'Шашлык говяжий',    desc:'Говядина на углях, 200 гр', price:22,old:null,  popular:true, time:20,inStock:true},
      {id:3,cat:'Шашлык',  e:'🍗',name:'Шашлык куриный',    desc:'Куриное филе на углях',     price:16,old:null,  popular:false,time:15,inStock:true},
      {id:4,cat:'Салаты',  e:'🥗',name:'Салат Ачик-чучук',  desc:'Помидоры, лук, перец',      price:8, old:null,  popular:false,time:5, inStock:true},
      {id:5,cat:'Супы',    e:'🍲',name:'Шурпо',              desc:'Наваристый суп из баранины',price:12,old:null,  popular:true, time:10,inStock:true},
      {id:6,cat:'Супы',    e:'🍜',name:'Лагман',             desc:'Домашняя лапша с мясом',   price:14,old:null,  popular:true, time:15,inStock:true},
      {id:7,cat:'Напитки', e:'🍵',name:'Зелёный чай',       desc:'Чайник 0.5л',              price:4, old:null,  popular:false,time:5, inStock:true},
      {id:8,cat:'Горячее', e:'🥟',name:'Манты',              desc:'6 штук, говядина+лук',     price:16,old:null,  popular:true, time:30,inStock:true},
    ]
  },
  {
    id:'R-02', name:'Пицца Яван',         emoji:'🍕', rating:4.6, reviews:0,
    cuisine:'Итальянская',           tags:['Пицца','Бургеры','Паста'],
    minOrder:25, deliveryMin:40, deliveryFee:5, open:true,
    hours:'10:00–22:00', img:'linear-gradient(135deg,#1A0808,#3A1010)',
    address:'ул. Ленина, 28',             commission:18, email:'pizza@kakapo.tj', revenueMonth:9680, ordersMonth:187,
    categories:['Пицца','Бургеры','Паста','Десерты','Напитки'],
    menu:[
      {id:1,cat:'Пицца',  e:'🍕',name:'Маргарита',          desc:'Томат, моцарелла, базилик',  price:28,old:35,   popular:true, time:25,inStock:true},
      {id:2,cat:'Пицца',  e:'🍕',name:'Пепперони',          desc:'Томат, пепперони, сыр',      price:32,old:null, popular:true, time:25,inStock:true},
      {id:3,cat:'Пицца',  e:'🍕',name:'4 сыра',             desc:'Моцарелла, пармезан, чеддер',price:35,old:null, popular:false,time:30,inStock:true},
      {id:4,cat:'Бургеры',e:'🍔',name:'Классик бургер',     desc:'Котлета 150г, сыр, овощи',   price:22,old:null, popular:true, time:15,inStock:true},
      {id:5,cat:'Бургеры',e:'🍔',name:'Чикен бургер',       desc:'Куриная котлета, соус',      price:18,old:null, popular:false,time:12,inStock:false},
      {id:6,cat:'Паста',  e:'🍝',name:'Спагетти болоньезе', desc:'Паста, мясной соус',         price:24,old:null, popular:true, time:20,inStock:true},
      {id:7,cat:'Десерты',e:'🍰',name:'Чизкейк',            desc:'Классический чизкейк',        price:14,old:null, popular:true, time:5, inStock:true},
      {id:8,cat:'Напитки',e:'🥤',name:'Кола 0.5л',          desc:'Coca-Cola / Pepsi',           price:5, old:null, popular:false,time:2, inStock:true},
    ]
  },
  {
    id:'R-03', name:'Суши Яван',          emoji:'🍣', rating:4.9, reviews:0,
    cuisine:'Японская',              tags:['Роллы','Суши','Рамен'],
    minOrder:30, deliveryMin:45, deliveryFee:7, open:true,
    hours:'11:00–22:00', img:'linear-gradient(135deg,#0A0A1A,#1A1A3A)',
    address:'ул. Сомони, 8',              commission:20, email:'sushi@kakapo.tj', revenueMonth:7340, ordersMonth:94,
    categories:['Роллы','Суши','Горячее','Напитки'],
    menu:[
      {id:1,cat:'Роллы',  e:'🌯',name:'Филадельфия',        desc:'Лосось, сыр Филадельфия, авокадо',price:32,old:null,popular:true, time:15,inStock:true},
      {id:2,cat:'Роллы',  e:'🌯',name:'Дракон',             desc:'Угорь, авокадо, огурец',     price:36,old:null, popular:true, time:15,inStock:true},
      {id:3,cat:'Роллы',  e:'🌯',name:'Спайси тунец',       desc:'Тунец, соус спайси',         price:28,old:null, popular:false,time:15,inStock:true},
      {id:4,cat:'Суши',   e:'🍣',name:'Сет 20 шт',          desc:'Ассорти суши и роллов',      price:55,old:70,   popular:true, time:20,inStock:true},
      {id:5,cat:'Горячее',e:'🍜',name:'Рамен классический', desc:'Куриный бульон, лапша',      price:24,old:null, popular:true, time:20,inStock:true},
      {id:6,cat:'Напитки',e:'🍵',name:'Зелёный чай',        desc:'Японский сенча',             price:6, old:null, popular:false,time:3, inStock:true},
    ]
  },
  {
    id:'R-04', name:'Фаст-фуд 24/7',     emoji:'🍟', rating:4.3, reviews:0,
    cuisine:'Быстрое питание',             tags:['Бургеры','Хот-дог','Картошка'],
    minOrder:10, deliveryMin:20, deliveryFee:3, open:true,
    hours:'00:00–24:00', img:'linear-gradient(135deg,#3A2A00,#3A2200)',
    address:'Центральный рынок',           commission:12, email:'fastfood@kakapo.tj', revenueMonth:11200, ordersMonth:521,
    categories:['Бургеры','Хот-доги','Картошка','Напитки'],
    menu:[
      {id:1,cat:'Бургеры', e:'🍔',name:'Двойной бургер',    desc:'2 котлеты, сыр, соус',       price:16,old:null, popular:true, time:10,inStock:true},
      {id:2,cat:'Хот-доги',e:'🌭',name:'Хот-дог классик',  desc:'Сосиска, горчица, кетчуп',   price:8, old:null, popular:true, time:5, inStock:true},
      {id:3,cat:'Картошка',e:'🍟',name:'Картошка фри',      desc:'Большая порция',             price:7, old:null, popular:true, time:8, inStock:true},
      {id:4,cat:'Картошка',e:'🥔',name:'Картошка с сыром', desc:'Запечённая, сметана',         price:10,old:null, popular:false,time:12,inStock:true},
      {id:5,cat:'Напитки', e:'🥤',name:'Кола/Спрайт',      desc:'0.5л',                       price:4, old:null, popular:false,time:1, inStock:true},
    ]
  },
];

;

const ORDERS_LIST = [
  {id:"K-4832",phone:"+992 93 456 78 90",date:"16 мая",time:"14:23",status:"delivering",eta:"~12 мин",items:[{e:"🥦",name:"Брокколи",qty:2,price:5.50},{e:"🥩",name:"Говядина",qty:1,price:38.0}],total:49.0,bonus:9,delivery:0,addr:"ул. Ленина, 42"},
  {id:"K-4821",phone:"+992 93 456 78 90",date:"15 мая",time:"11:05",status:"delivered", eta:null,    items:[{e:"🍅",name:"Томаты черри",qty:1,price:7.90},{e:"🧀",name:"Сыр",qty:1,price:18.50}],total:26.4,bonus:5,delivery:0,addr:"ул. Ленина, 42"},
  {id:"K-4756",phone:"+992 90 123 45 67",date:"10 мая",time:"16:48",status:"delivered", eta:null,    items:[{e:"🐟",name:"Лосось",qty:1,price:28.0},{e:"☕",name:"Кофе",qty:1,price:32.0}],total:60.0,bonus:11,delivery:0,addr:"ул. Сомони, 12"},
  {id:"K-4701",phone:"+992 93 456 78 90",date:"3 мая", time:"09:22",status:"cancelled", eta:null,    items:[{e:"🥚",name:"Яйца",qty:1,price:8.50}],total:13.5,bonus:0,delivery:5,addr:"ул. Ленина, 42",cancelReason:"Товар закончился"},
];

const OSTATUS = {
  pending:         {l:"Ожидает",       c:"var(--gd)"},
  assembling:      {l:"Собирается",    c:"var(--pur)"},
  cooking:         {l:"Готовится",     c:"var(--gd)"},
  waiting_courier: {l:"Ждём курьера",  c:"var(--gd)"},
  delivering:      {l:"В пути",        c:"var(--blue)"},
  delivered:       {l:"Доставлен",     c:"var(--gr)"},
  pos_sale:        {l:"В магазине",    c:"var(--gr)"},
  cancelled:       {l:"Отменён",       c:"var(--red)"},
};

const ORDER_STATUS_FILTERS = [
  { id: 'all', l: 'Все', ic: null, c: 'var(--gr)', activeBg: 'rgba(7,136,61,.11)', activeBd: 'rgba(7,136,61,.38)' },
  { id: 'pos_sale', l: 'Магазин', ic: 'store', c: 'var(--gr)', activeBg: 'rgba(7,136,61,.11)', activeBd: 'rgba(7,136,61,.38)' },
  { id: 'assembling', l: 'Сборка', ic: 'bag', c: 'var(--pur)', activeBg: 'rgba(124,58,237,.11)', activeBd: 'rgba(124,58,237,.28)' },
  { id: 'cooking', l: 'Кухня', ic: 'zap', c: 'var(--gd)', activeBg: 'rgba(233,174,0,.1)', activeBd: 'rgba(233,174,0,.28)' },
  { id: 'waiting_courier', l: 'Ждём', ic: 'clock', c: 'var(--gd)', activeBg: 'rgba(233,174,0,.1)', activeBd: 'rgba(233,174,0,.28)' },
  { id: 'delivering', l: 'Путь', ic: 'truck', c: 'var(--blue)', activeBg: 'rgba(37,99,235,.1)', activeBd: 'rgba(37,99,235,.28)' },
  { id: 'delivered', l: 'Готов', ic: 'check', c: 'var(--gr)', activeBg: 'rgba(7,136,61,.11)', activeBd: 'rgba(7,136,61,.38)' },
];

const CONTACT_ROLE_STYLE: Record<ClientOrderContact['role'], { c: string; bg: string; bd: string }> = {
  assembler: { c: 'var(--pur)', bg: 'rgba(124,58,237,.1)', bd: 'rgba(124,58,237,.28)' },
  store: { c: 'var(--gr)', bg: 'var(--gr-soft)', bd: 'rgba(7,136,61,.3)' },
  restaurant: { c: 'var(--gd)', bg: 'rgba(233,174,0,.1)', bd: 'rgba(233,174,0,.28)' },
  courier: { c: 'var(--blue)', bg: 'rgba(37,99,235,.1)', bd: 'rgba(37,99,235,.28)' },
};

function ClientOrderContactsBlock({
  contacts,
  pickups,
  compact,
  onCallClick,
}: {
  contacts: ClientOrderContact[]
  pickups: import('@/lib/pickups').PickupPoint[]
  compact?: boolean
  onCallClick?: (e: MouseEvent) => void
}) {
  if (!contacts.length) return null
  if (compact) {
    return (
      <div
        className="hscroll"
        style={{ gap: 8, marginBottom: 10, paddingBottom: 2 }}
        onClick={onCallClick}
      >
        {contacts.map((c, i) => {
          const st = CONTACT_ROLE_STYLE[c.role]
          const sub = clientContactPointLabel(c, pickups)
          return (
            <a
              key={`${c.role}-${c.pickupId || ''}-${i}`}
              href={telHref(c.phone)}
              className="btn"
              onClick={e => e.stopPropagation()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 11px',
                borderRadius: 12,
                background: st.bg,
                border: `1px solid ${st.bd}`,
                textDecoration: 'none',
                color: 'inherit',
                flexShrink: 0,
                maxWidth: 220,
              }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>{c.emoji}</span>
              <div style={{ minWidth: 0, textAlign: 'left' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: st.c }}>{c.label}</div>
                <div style={{ fontSize: 10, color: 'var(--t2)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.role === 'courier' && !c.pickedUpFrom ? c.name : (sub || c.name)}
                </div>
              </div>
              <Ic n="phone" s={13} c={st.c} />
            </a>
          )
        })}
      </div>
    )
  }
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--t2)', marginBottom: 8, letterSpacing: '.02em' }}>
        Связаться
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {contacts.map((c, i) => {
          const st = CONTACT_ROLE_STYLE[c.role]
          const sub = clientContactPointLabel(c, pickups)
          return (
            <a
              key={`${c.role}-${c.pickupId || ''}-${i}`}
              href={telHref(c.phone)}
              className="btn"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '13px 14px',
                borderRadius: 14,
                background: st.bg,
                border: `1px solid ${st.bd}`,
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <div style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(23,37,27,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                {c.emoji}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: st.c }}>{c.label}</div>
                <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>{c.name}</div>
                {sub && (
                  <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2 }}>{sub}</div>
                )}
                <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 3 }}>{c.phone}</div>
              </div>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(23,37,27,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Ic n="phone" s={16} c={st.c} />
              </div>
            </a>
          )
        })}
      </div>
    </div>
  )
}

function ruCount(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return `${n} ${many}`
  if (mod10 === 1) return `${n} ${one}`
  if (mod10 >= 2 && mod10 <= 4) return `${n} ${few}`
  return `${n} ${many}`
}

/**
 * Кнопка «Назад»: если пользователь пришёл из другого раздела — ведём браузерную
 * историю назад (вернёмся ровно туда, откуда пришли). Если истории нет (заход по
 * прямой ссылке) — открываем запасную страницу.
 */
function storeBack(fallback: string, go: (page: string, params?: Record<string, unknown>) => void) {
  if (typeof window !== 'undefined' && Number((window.history.state && window.history.state.kakapoDepth) || 0) > 0) {
    window.history.back()
    return
  }
  go(fallback)
}

function clientLoyaltyTotals(apiOrders: import('@/lib/types').Order[], user?: StoreUser | null) {
  const scoped = user ? filterOrdersForStoreUser(apiOrders, user) : apiOrders
  return loyaltyStatsFromOrders(scoped, user?.phone || '', user)
}

function countClientSpent(apiOrders: import('@/lib/types').Order[], user?: StoreUser | null) {
  return clientLoyaltyTotals(apiOrders, user).spent
}

function countClientOrders(apiOrders: import('@/lib/types').Order[], user?: StoreUser | null) {
  return clientLoyaltyTotals(apiOrders, user).orderCount
}

function vipPageShell(isVip: boolean) {
  return {
    minHeight: '100vh' as const,
    maxWidth:'var(--store-w)',
    margin: '0 auto' as const,
    background: isVip
      ? 'radial-gradient(ellipse 100% 35% at 50% 0%, rgba(233,174,0,.09) 0%, transparent 50%), var(--bg)'
      : 'var(--bg)',
  }
}

type TierTheme = { bg: string; border: string; glow: string; accent: string; rail: string }

function getTierThemes(light = false): Record<string, TierTheme> {
  const map = tierPresentationMap(loadLoyaltyStatusConfig())
  if (!light) return map
  const out: Record<string, TierTheme> = {}
  for (const [id, t] of Object.entries(map)) {
    const accent = t.accent || '#07883D'
    out[id] = {
      ...t,
      bg: `linear-gradient(145deg, #FFFFFF 0%, color-mix(in srgb, ${accent} 10%, #F3F7F4) 100%)`,
      glow: `color-mix(in srgb, ${accent} 18%, transparent)`,
      border: `color-mix(in srgb, ${accent} 28%, transparent)`,
    }
  }
  return out
}

function profilePageShell(theme: TierTheme, tierId: string) {
  const glow = tierTopGlowMap(loadLoyaltyStatusConfig())[tierId] || tierTopGlowMap(loadLoyaltyStatusConfig()).bronze
  return {
    minHeight: '100vh' as const,
    maxWidth:'var(--store-w)',
    margin: '0 auto' as const,
    background: `radial-gradient(ellipse 100% 38% at 50% -2%, ${glow} 0%, transparent 52%), var(--bg)`,
  }
}

function profileHeaderStyle(theme: TierTheme) {
  return {
    position: 'sticky' as const,
    top: 0,
    zIndex: 100,
    background: 'var(--header-bg)',
    backdropFilter: 'blur(24px)',
    borderBottom: `1px solid ${theme.border}`,
    boxShadow: `0 4px 22px ${theme.glow.replace(/,\s*[\d.]+\)$/, ', 0.12)')}`,
  }
}

function profileCardAccent(theme: TierTheme) {
  return {
    border: `1.5px solid ${theme.border}`,
    boxShadow: `0 6px 28px ${theme.glow.replace(/,\s*[\d.]+\)$/, ', 0.14)')}`,
  }
}

type VipUserLike = { level?: string; vip?: boolean; name?: string; bonus?: number; card?: string } | null | undefined

function resolveUserVip(user: VipUserLike, light = false) {
  const themes = getTierThemes(light)
  const cfg = loadLoyaltyStatusConfig()
  const isVip = !!user?.vip
  if (isVip) {
    const theme = themes.vip
    const tier = LOYALTY_TIERS.find(t => t.id === user?.level) || LOYALTY_TIERS[0]
    return { isVip, theme, tier, label: cfg.vip.label }
  }
  if (user?.level === 'basic' || user?.level === 'new') {
    return { isVip: false, theme: themes.basic, tier: { id: 'basic', label: cfg.basic.label, emoji: cfg.basic.emoji, color: cfg.basic.color }, label: cfg.basic.label }
  }
  const tier = LOYALTY_TIERS.find(t => t.id === user?.level) || LOYALTY_TIERS[0]
  const theme = themes[user?.level || 'bronze'] || themes.bronze
  return { isVip, theme, tier, label: tier.label }
}

function headerCartButtonStyle(isVip: boolean, hasItems: boolean) {
  if (isVip && hasItems) {
    return {
      width: 44, height: 44, borderRadius: 12,
      background: 'linear-gradient(135deg,#A97800 0%,#E9AE00 48%,#E0A400 100%)',
      border: '1px solid rgba(138,100,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative' as const,
      boxShadow: '0 4px 18px rgba(233,174,0,.52), inset 0 1px 0 rgba(255,255,255,.32)',
      animation: 'vipGlow 3s ease-in-out infinite',
    }
  }
  if (isVip) {
    return {
      width: 44, height: 44, borderRadius: 12,
      background: 'rgba(233,174,0,.1)',
      border: '1px solid rgba(233,174,0,.28)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative' as const,
      boxShadow: 'none',
    }
  }
  return {
    width: 44, height: 44, borderRadius: 12,
    background: hasItems ? 'var(--gr)' : 'var(--l3)',
    border: `1px solid ${hasItems ? 'transparent' : 'var(--b1)'}`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    position: 'relative' as const,
    boxShadow: hasItems ? '0 4px 14px var(--gr)' : 'none',
  }
}

function headerCartIconColor(isVip: boolean, hasItems: boolean) {
  if (isVip && hasItems) return '#3A2A00'
  if (isVip) return 'rgba(138,100,0,.78)'
  return hasItems ? 'white' : 'var(--t2)'
}

function cartCountBadgeStyle(isVip: boolean) {
  return {
    position: 'absolute' as const, top: -6, right: -6,
    minWidth: 17, height: 17, padding: '0 4px', borderRadius: 999,
    background: isVip ? 'linear-gradient(135deg,#C33434,#C33434)' : 'var(--red)',
    border: isVip ? '2px solid #E9AE00' : '2px solid var(--bg)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'Unbounded', fontSize: 9, fontWeight: 900, color: 'white',
    boxShadow: isVip ? '0 2px 8px rgba(233,174,0,.45)' : 'none',
  }
}

const CartHeaderButton = ({ count, qtyNum, onClick, isVip = false }) => (
  <button onClick={onClick} className="btn" data-header-cart style={headerCartButtonStyle(isVip, qtyNum > 0)}>
    <Ic n="cart" s={17} c={headerCartIconColor(isVip, qtyNum > 0)}/>
    {qtyNum > 0 && <div style={cartCountBadgeStyle(isVip)}>{count}</div>}
  </button>
)

function UserStatusBadge({ user, size = 'md' }: { user: VipUserLike; size?: 'sm' | 'md' | 'lg' }) {
  if (!user) return null
  const { isVip, theme, tier, label } = resolveUserVip(user)
  const isBasic = (user.level === 'basic' || user.level === 'new') && !isVip
  const sz = size === 'sm' ? { fontSize: 9, padding: '2px 8px' } : size === 'lg' ? { fontSize: 12, padding: '5px 14px' } : { fontSize: 10, padding: '3px 10px' }
  return (
    <span style={{
      ...sz, fontWeight: 800, borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
      background: isVip ? 'linear-gradient(135deg,rgba(233,174,0,.28),rgba(194,65,12,.12))' : isBasic ? 'var(--l3)' : `${tier.color}18`,
      color: isVip ? '#E9AE00' : isBasic ? 'var(--t2)' : tier.color,
      border: isVip ? '1px solid rgba(233,174,0,.55)' : isBasic ? '1px solid var(--b1)' : `1px solid ${tier.color}35`,
      boxShadow: isVip ? '0 0 14px rgba(233,174,0,.3)' : 'none',
    }}>
      {isVip ? '👑 VIP' : isBasic ? '👤 Базовый' : `${tier.emoji} ${label}`}
    </span>
  )
}

function HomeVipWelcome({ user, go }: { user: VipUserLike; go: (p: string) => void }) {
  const light = true;
  const { isVip, theme } = resolveUserVip(user, light)
  if (!user || !isVip) return null
  const firstName = (user.name || 'Клиент').split(' ')[0]
  return (
    <div
      onClick={() => go('vip')}
      className="loyalty-vip-card"
      style={{
        marginBottom: 16, borderRadius: 20, overflow: 'hidden', cursor: 'pointer', position: 'relative',
        background: theme.bg, border: `1.5px solid ${theme.border}`,
        boxShadow: `0 8px 32px ${theme.glow}`,
      }}
    >
      <div className="loyalty-vip-shimmer" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', right: -20, top: -20, width: 120, height: 120, borderRadius: '50%', background: 'radial-gradient(circle,rgba(233,174,0,.2),transparent 70%)', filter: 'blur(16px)' }} />
      <div style={{ position: 'relative', zIndex: 1, padding: '16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: 'linear-gradient(135deg,#E9AE00,#E0A400)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(233,174,0,.45)', fontSize: 20,
              animation: 'crownFloat 2.5s ease-in-out infinite',
            }}>👑</div>
            <div>
              <div className="ub" style={{ fontSize: 14, fontWeight: 900, color: light ? '#B45309' : '#E9AE00', marginBottom: 2 }}>
                Добро пожаловать, {firstName}!
              </div>
              <div style={{ fontSize: 10, color: light ? 'var(--t2)' : 'rgba(138,100,0,.75)' }}>VIP MEMBER · все привилегии активны</div>
            </div>
          </div>
          <UserStatusBadge user={user} size="sm" />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['⭐ Бонусы по карте', '💳 Долг на кассе', '📞 Поддержка'].map((p, i) => (
            <div key={i} style={{
              flex: 1, textAlign: 'center', fontSize: 8, fontWeight: 700, padding: '6px 2px', borderRadius: 8,
              color: light ? '#B45309' : 'rgba(138,100,0,.9)', background: insetChipBg(light, 0.28), border: '1px solid rgba(233,174,0,.22)',
            }}>{p}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

function LoyaltyStatusCard({ loyalty, onVip, adminVip }: { loyalty: ReturnType<typeof getLoyaltyProgress>; onVip: () => void; adminVip?: boolean }) {
  const light = true;
  const { tier, nextTier, progressPct, remaining, spent, isVip, isBasicClient, vipSteps, vipDoneCount, periodSubtitle } = loyalty
  const themes = getTierThemes(light)
  const theme = isVip ? themes.vip : isBasicClient ? themes.basic : (themes[tier.id] || themes.bronze)
  const prevTierRef = useRef(tier.id)
  const [levelFlash, setLevelFlash] = useState<string | null>(null)
  const chip = insetChipBg(light)
  const railTrack = insetChipBg(light, 0.35)

  useEffect(() => {
    if (prevTierRef.current !== tier.id) {
      setLevelFlash(tier.label)
      prevTierRef.current = tier.id
      const t = setTimeout(() => setLevelFlash(null), 2400)
      return () => clearTimeout(t)
    }
  }, [tier.id, tier.label])

  const maxSpent = LOYALTY_TIERS[LOYALTY_TIERS.length - 1].minSpent
  const overallPct = maxSpent > 0 ? Math.min(100, (spent / maxSpent) * 100) : 0

  return (
    <div
      className={`loyalty-tier-card${isVip ? ' loyalty-vip-card' : ''}`}
      style={{
        padding: 16,
        marginBottom: 12,
        background: theme.bg,
        border: `1.5px solid ${theme.border}`,
        boxShadow: isVip ? `0 8px 32px ${theme.glow}, inset 0 1px 0 var(--l3)` : `0 4px 24px ${theme.glow}`,
        transition: 'border-color .5s ease, box-shadow .5s ease, background .5s ease',
      }}
    >
      {isVip && (
        <div className="loyalty-vip-shimmer" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1, borderRadius: 20 }} />
      )}
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          position: 'absolute', width: 4, height: 4, borderRadius: '50%', background: theme.accent,
          opacity: .35, animation: `sparkle ${2 + i * 0.7}s ease-in-out infinite`, animationDelay: `${i * 0.4}s`,
          top: `${12 + i * 28}%`, right: `${8 + i * 12}%`, pointerEvents: 'none', zIndex: 1,
        }} />
      ))}

      {levelFlash && (
        <div className="loyalty-level-up" style={{
          position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 10,
          padding: '6px 14px', borderRadius: 20, whiteSpace: 'nowrap',
          background: `linear-gradient(135deg,${theme.accent}33,${theme.accent}18)`,
          border: `1px solid ${theme.border}`, backdropFilter: 'blur(8px)',
          fontSize: 11, fontWeight: 800, color: theme.accent,
          boxShadow: `0 4px 20px ${theme.glow}`,
        }}>
          🎉 Новый уровень — {levelFlash}!
        </div>
      )}

      <div style={{ position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 14, flexShrink: 0,
              background: `linear-gradient(135deg,${theme.accent}33,${theme.accent}12)`,
              border: `1.5px solid ${theme.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 0 20px ${theme.glow}`,
              fontSize: 22,
            }}>
              {isVip ? <span style={{ animation: 'crownFloat 2.5s ease-in-out infinite', display: 'inline-block' }}>👑</span> : tier.emoji}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <div className="ub" style={{ fontSize: 14, fontWeight: 900, color: theme.accent, letterSpacing: isVip ? 0.5 : 0 }}>
                  {isVip ? 'VIP' : tier.label}
                </div>
                {isVip && (
                  <span style={{
                    fontSize: 8, fontWeight: 900, padding: '2px 6px', borderRadius: 6,
                    background: 'linear-gradient(135deg,#E9AE00,#E0A400)', color: '#3A2A00',
                    letterSpacing: 0.5, textTransform: 'uppercase',
                  }}>Elite</span>
                )}
              </div>
              <div style={{ fontSize: 10, color: 'var(--t2)' }}>
                Кешбэк {tier.cashback} · {isVip ? 'Все привилегии' : tier.perk}
              </div>
              <div style={{ fontSize: 9, color: 'var(--t3)', marginTop: 4 }}>
                📅 {periodSubtitle}
              </div>
            </div>
          </div>
          <div style={{
            textAlign: 'right', padding: '6px 10px', borderRadius: 12,
            background: chip, border: `1px solid ${theme.border}`,
          }}>
            <div className="ub" style={{ fontSize: 16, fontWeight: 900, color: 'var(--t1)', lineHeight: 1.1 }}>
              {spent.toLocaleString()} <span style={{ fontSize: 9, color: theme.accent }}>ЅМ</span>
            </div>
            <div style={{ fontSize: 8, color: 'var(--t3)', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>покупок</div>
          </div>
        </div>

        {isBasicClient ? (
          <div style={{ marginBottom: 14 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, marginBottom: 10, padding: '10px 12px', borderRadius: 12, lineHeight: 1.55,
              background: chip,
              border: '1px solid rgba(143,184,151,.2)', color: 'var(--t2)',
            }}>
              <span style={{ color: theme.accent, fontWeight: 800 }}>Привилегий пока нет.</span>
              {' '}Купите налом или картой (магазин или приложение) — откроется уровень {LOYALTY_TIERS[0].emoji} {LOYALTY_TIERS[0].label} с бонусами.
            </div>
            {nextTier && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 10, color: 'var(--t2)' }}>До {nextTier.emoji} {nextTier.label}</span>
                  <span className="ub" style={{ fontSize: 10, fontWeight: 800, color: theme.accent }}>{progressPct}%</span>
                </div>
                <div style={{ height: 8, borderRadius: 4, background: railTrack, overflow: 'hidden', border: `1px solid ${theme.border}` }}>
                  <div style={{ height: '100%', width: `${Math.max(progressPct, 4)}%`, borderRadius: 4, background: theme.rail, transition: 'width .6s ease' }} />
                </div>
              </>
            )}
          </div>
        ) : nextTier && !isVip ? (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: 'var(--t2)' }}>Прогресс до {nextTier.emoji} {nextTier.label}</span>
              <span className="ub" style={{ fontSize: 10, fontWeight: 800, color: theme.accent }}>{progressPct}%</span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: railTrack, overflow: 'hidden', position: 'relative', border: `1px solid ${theme.border}` }}>
              <div style={{
                height: '100%', width: `${progressPct}%`, borderRadius: 4,
                background: theme.rail, transition: 'width .6s cubic-bezier(.16,1,.3,1)',
                position: 'relative', overflow: 'hidden',
              }}>
                <div style={{
                  position: 'absolute', inset: 0, width: '50%',
                  background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent)',
                  animation: 'progressShine 2s ease-in-out infinite',
                }} />
              </div>
            </div>
            <div style={{ fontSize: 10, color: 'var(--t2)', marginTop: 6 }}>
              Ещё <span style={{ fontWeight: 800, color: 'var(--gr)' }}>{remaining.toLocaleString()} ЅМ</span> до следующего уровня
            </div>
          </div>
        ) : (
          <div style={{
            fontSize: 11, fontWeight: 700, marginBottom: 14, padding: '8px 12px', borderRadius: 10,
            background: `linear-gradient(90deg,${theme.accent}18,transparent)`,
            border: `1px solid ${theme.border}`, color: theme.accent,
          }}>
            {isVip ? '✨ VIP-статус активен — максимальные привилегии' : `✨ Максимальный уровень ${tier.label}`}
          </div>
        )}

        <div style={{ position: 'relative', marginBottom: 14, padding: '0 2px' }}>
          <div style={{ position: 'absolute', top: 18, left: '10%', right: '10%', height: 3, borderRadius: 2, background: railTrack, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${overallPct}%`, background: theme.rail, borderRadius: 2, transition: 'width .6s ease' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', zIndex: 1 }}>
            {LOYALTY_TIERS.map((t, i) => {
              const reached = spent >= t.minSpent
              const active = (t.id === tier.id && !isVip && !isBasicClient)
              const vipActive = isVip && i === LOYALTY_TIERS.length - 1
              const nodeColor = vipActive ? themes.vip.accent : (reached ? t.color : 'var(--b2)')
              return (
                <div key={t.id} style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
                  <div
                    className={active || vipActive ? 'loyalty-tier-node-active' : undefined}
                    style={{
                      width: active || vipActive ? 36 : 30,
                      height: active || vipActive ? 36 : 30,
                      borderRadius: '50%',
                      margin: '0 auto 6px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: active || vipActive ? 16 : 13,
                      background: reached || vipActive
                        ? `linear-gradient(135deg,${nodeColor}44,${nodeColor}18)`
                        : 'var(--l3)',
                      border: `2px solid ${reached || vipActive ? nodeColor : 'var(--b1)'}`,
                      boxShadow: active || vipActive ? `0 0 16px ${nodeColor}66` : reached ? `0 0 8px ${nodeColor}33` : 'none',
                      transition: 'all .35s ease',
                      ['--tier-glow' as string]: `${nodeColor}44`,
                    }}
                  >
                    {vipActive ? '👑' : reached && !active ? '✓' : t.emoji}
                  </div>
                  <div style={{
                    fontSize: 8, fontWeight: active || vipActive ? 900 : 600,
                    color: active || vipActive ? (vipActive ? themes.vip.accent : t.color) : reached ? 'var(--t2)' : 'var(--t3)',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{t.label}</div>
                  <div style={{ fontSize: 7, color: 'var(--t3)', marginTop: 1 }}>{t.minSpent > 0 ? t.minSpent : '0'}</div>
                </div>
              )
            })}
          </div>
        </div>

        <div
          onClick={onVip}
          style={{
            padding: isVip ? '14px 14px' : '12px 12px',
            borderRadius: 14,
            cursor: 'pointer',
            position: 'relative',
            overflow: 'hidden',
            background: isVip
              ? 'linear-gradient(135deg,rgba(233,174,0,.22),rgba(194,65,12,.08),rgba(233,174,0,.15))'
              : chip,
            border: isVip ? '1.5px solid rgba(233,174,0,.55)' : `1px solid ${theme.border}`,
            boxShadow: isVip ? '0 4px 24px rgba(233,174,0,.2), inset 0 1px 0 rgba(138,100,0,.15)' : 'none',
            transition: 'all .3s ease',
          }}
        >
          {isVip && <div className="loyalty-vip-shimmer" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />}
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isVip ? 10 : 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 8,
                  background: isVip ? 'linear-gradient(135deg,#E9AE00,#E0A400)' : 'rgba(233,174,0,.12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: isVip ? '0 0 12px rgba(233,174,0,.5)' : 'none',
                }}>
                  <Ic n="crown" s={14} c={isVip ? '#3A2A00' : 'var(--gd2)'} />
                </div>
                <div>
                  <span className="ub" style={{ fontSize: 13, fontWeight: 900, color: isVip ? (light ? '#B45309' : '#E9AE00') : 'var(--t1)', display: 'block' }}>
                    {isVip ? 'VIP MEMBER' : 'Путь к VIP'}
                  </span>
                  {isVip && adminVip && (
                    <span style={{ fontSize: 9, color: 'rgba(233,174,0,.75)', fontWeight: 600 }}>Назначен администратором</span>
                  )}
                </div>
              </div>
              <div style={{
                padding: '4px 10px', borderRadius: 20,
                background: isVip ? 'rgba(233,174,0,.25)' : 'var(--l3)',
                border: `1px solid ${isVip ? 'rgba(233,174,0,.4)' : 'var(--b1)'}`,
              }}>
                <span style={{ fontSize: 11, fontWeight: 900, color: isVip ? '#E9AE00' : 'var(--t3)' }}>
                  {isVip ? '★ VIP ★' : `${vipDoneCount}/3`}
                </span>
              </div>
            </div>
            {!isVip && (
              <div style={{ display: 'flex', gap: 6 }}>
                {vipSteps.map(step => {
                  const pct = step.done ? 100 : (() => {
                    const parts = step.progress.split('/')
                    if (parts.length !== 2) return 0
                    const cur = parseInt(parts[0].replace(/[^\d]/g, ''), 10) || 0
                    const tot = parseInt(parts[1].replace(/[^\d]/g, ''), 10) || 1
                    return (cur / tot) * 100
                  })()
                  return (
                    <div key={step.id} style={{
                      flex: 1, padding: '8px 4px', borderRadius: 10, textAlign: 'center',
                      background: step.done ? 'var(--gr-soft)' : chip,
                      border: `1px solid ${step.done ? 'rgba(7,136,61,.38)' : 'var(--b1)'}`,
                      position: 'relative', overflow: 'hidden',
                    }}>
                      {!step.done && (
                        <div style={{ position: 'absolute', bottom: 0, left: 0, height: 2, width: `${Math.min(100, pct || 0)}%`, background: 'var(--gr)', borderRadius: 1, transition: 'width .4s ease' }} />
                      )}
                      <div style={{ fontSize: 9, fontWeight: 700, color: step.done ? 'var(--gr)' : 'var(--t3)', marginBottom: 3 }}>{step.label}</div>
                      <div style={{ fontSize: 9, fontWeight: 800, color: step.done ? 'var(--gr)' : 'var(--t2)' }}>{step.done ? '✓ Готово' : step.progress}</div>
                    </div>
                  )
                })}
              </div>
            )}
            {isVip && (
              <div style={{ display: 'flex', gap: 8 }}>
                {['🚀 Приоритет', '💳 Кредит', '🎁 Акции', '🌿 Доставка'].map((p, i) => (
                  <div key={i} style={{
                    flex: 1, fontSize: 8, fontWeight: 700, textAlign: 'center', padding: '6px 2px',
                    borderRadius: 8, color: 'rgba(138,100,0,.9)',
                    background: light ? 'rgba(217,119,6,.1)' : 'rgba(23,37,27,.25)', border: '1px solid rgba(233,174,0,.2)',
                  }}>{p}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}


function ClientReviewBlock({ review, orderId, embedded, restaurants = [], showOrderId = false }: { review: Review; orderId?: string; embedded?: boolean; restaurants?: { id: string; name?: string; emoji?: string }[]; showOrderId?: boolean }) {
  const hasReply = !!(review.adminReply || review.restReply);
  const title = resolveReviewPlaceName(String(review.restId || ''), review, restaurants);
  return (
    <div style={embedded ? undefined : { padding: 14, borderRadius: 15, background: "rgba(233,174,0,.06)", border: "1px solid rgba(233,174,0,.22)", marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        {!embedded && <div style={{ fontSize: 13, fontWeight: 800, color: "var(--t2)" }}>⭐ {title}{showOrderId && orderId ? ` · ${orderId}` : ''}</div>}
        {embedded && <div style={{ fontSize: 12, fontWeight: 700, color: "var(--t2)" }}>{title}</div>}
        <span style={{ fontSize: 10, color: "var(--t3)" }}>{review.date}</span>
      </div>
      <div style={{ display: "flex", gap: 2, marginBottom: 8 }}>
        {[1, 2, 3, 4, 5].map(s => (
          <span key={s} style={{ fontSize: 14, color: s <= review.rating ? "#E0A400" : "var(--b2)" }}>★</span>
        ))}
      </div>
      {review.text && (
        <div style={{ fontSize: 13, color: "var(--t1)", lineHeight: 1.55, marginBottom: hasReply ? 12 : 0, padding: "10px 12px", background: "var(--l3)", borderRadius: 10, border: "1px solid var(--b1)" }}>
          {review.text}
        </div>
      )}
      {review.adminReply && (
        <div style={{ fontSize: 12, color: "var(--blue)", marginBottom: review.restReply ? 8 : 0, padding: "10px 12px", background: "rgba(37,99,235,.08)", borderRadius: 10, border: "1px solid rgba(37,99,235,.2)", lineHeight: 1.5 }}>
          <div style={{ fontSize: 10, fontWeight: 800, marginBottom: 4, color: "var(--blue)" }}>💬 Ответ КАКАПО</div>
          {review.adminReply}
        </div>
      )}
      {review.restReply && (
        <div style={{ fontSize: 12, color: "var(--gr)", padding: "10px 12px", background: "var(--gr-soft)", borderRadius: 10, border: "1px solid rgba(7,136,61,.2)", lineHeight: 1.5 }}>
          <div style={{ fontSize: 10, fontWeight: 800, marginBottom: 4, color: "var(--gr)" }}>🍽 Ответ ресторана</div>
          {review.restReply}
        </div>
      )}
      {!hasReply && (
        <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 8 }}>Ожидаем ответ от ресторана или поддержки</div>
      )}
    </div>
  );
}

/** Повтор заказа — товары и блюда в корзину */
function fillCartFromOrder(
  orderId: string,
  clientOrder: { items?: { e?: string; name: string; qty?: number; price: number; art?: string; id?: number; product_id?: number; source?: string; restId?: string; photo?: string }[] },
  ctx: {
    apiOrders: import('@/lib/types').Order[];
    prods: { id: number; art?: string; name: string; price: number; e?: string }[];
    restaurants: { id: string; menu?: { id: number; name: string; price: number; e: string; photo?: string }[] }[];
    onAdd: (id: string | number, price?: number, name?: string, emoji?: string, restId?: string, silent?: boolean, photo?: string) => void;
    onClearCart: () => void;
  },
): number {
  const { apiOrders, prods, restaurants, onAdd, onClearCart } = ctx;
  onClearCart();
  const raw = apiOrders.find(o => o.id === orderId);
  const items = raw?.items?.length ? raw.items : clientOrder.items || [];
  let added = 0;

  for (const it of items) {
    const qty = Math.max(1, it.qty || 1);
    const isRest = it.source === 'restaurant' || !!(it as { restId?: string }).restId;

    if (isRest) {
      const restId = (it as { restId?: string }).restId || raw?.restId;
      const rest = restaurants.find(r => r.id === restId);
      const menuItem = rest?.menu?.find(m => m.name === it.name);
      if (rest && menuItem) {
        for (let i = 0; i < qty; i++) {
          onAdd(`R${rest.id}_${menuItem.id}`, menuItem.price, menuItem.name, menuItem.e, rest.id, false, menuItem.photo);
        }
        added += qty;
      } else if (restId) {
        const cartId = `R${restId}_repeat_${String(it.name).replace(/\s+/g, '_').slice(0, 24)}`;
        for (let i = 0; i < qty; i++) {
          onAdd(cartId, it.price, it.name, it.e || '🍽', restId, false, it.photo);
        }
        added += qty;
      }
    } else {
      const pid = it.id ?? it.product_id;
      let prod = pid != null ? prods.find(p => p.id === pid) : undefined;
      if (!prod && it.art) prod = prods.find(p => p.art === it.art);
      if (!prod) prod = prods.find(p => p.name === it.name);
      if (prod) {
        for (let i = 0; i < qty; i++) onAdd(prod.id);
        added += qty;
      } else if (pid != null) {
        for (let i = 0; i < qty; i++) onAdd(pid, it.price, it.name, it.e || '📦');
        added += qty;
      }
    }
  }
  return added;
}

const FAQ = (pricing) => {
  const base = Number(pricing?.base) || 0;
  const baseDist = Number(pricing?.baseDist) || 0;
  const perKm = Number(pricing?.perKm) || 0;
  const freeFrom = Number(pricing?.freeFrom) || 0;
  const deliveryCost = base > 0
    ? `${base} ЅМ${baseDist > 0 ? ` до ${baseDist} км` : ''}${perKm > 0 ? `, дальше +${perKm} ЅМ за каждый км` : ''}. Точную сумму видно при оформлении после выбора адреса.${freeFrom > 0 ? ` Бесплатно при заказе от ${freeFrom} ЅМ.` : ''}`
    : 'Сумма доставки считается при оформлении после выбора адреса.';
  return [
  {q:"Как быстро доставляют заказ?",         a:"Сначала заказ соберут в магазине, затем курьер привезёт его по адресу. Время зависит от загрузки — мы позвоним, если нужно уточнить."},
  {q:"Стоимость доставки?",                  a:deliveryCost},
  {q:"Какие способы оплаты?",                a:"Наличными курьеру при получении."},
  {q:"Нужна ли регистрация?",                a:"Нет. При оформлении укажите имя, телефон и адрес — этого достаточно."},
  {q:"Бонусы и карта КАКАПО",                a:"Бонусы по карте КАКАПО начисляются и тратятся на кассе в магазине. В интернет-магазине списание бонусов и покупка в долг пока недоступны."},
  {q:"Как отменить или изменить заказ?",     a:"Позвоните или напишите в поддержку (контакты ниже) — лучше до того, как заказ соберут."},
  {q:"Товар не подошёл или плохого качества?", a:"Сразу сообщите курьеру или позвоните в поддержку — разберёмся и заменим или вернём деньги."},
  {q:"Что если меня нет дома?",              a:"Оставьте комментарий к заказу. Курьер позвонит на указанный номер перед приездом."},
]; };
/** Единая валюта магазина (уже используется в приложении). */
const CURRENCY = 'ЅМ'

/** Фото товара: белая поверхность, object-fit: contain, нейтральная заглушка. */
const ProductMedia = ({ p, emoji, padding = 8, style, className }: { p: any; emoji?: any; padding?: number; style?: any; className?: string }) => {
  const [failed, setFailed] = useState(false)
  const localPhoto = useProductPhotos(s => s.photos[p?.id])
  const photo = failed ? undefined : resolveProductPhoto(p, { preferThumb: true, getPhoto: () => localPhoto })
  const e = emoji ?? p?.e ?? "📦"
  return (
    <div className={className} style={{ position:"relative", background:"#FFFFFF", display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden", ...style }}>
      {photo ? (
        <img
          src={photo}
          alt={p?.name || ""}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          style={{ width:"100%", height:"100%", objectFit:"contain", objectPosition:"center", display:"block", padding, boxSizing:"border-box" }}
        />
      ) : (
        <span aria-hidden="true" style={{ fontSize:26, opacity:.45, lineHeight:1 }}>{e}</span>
      )}
    </div>
  )
}

/** Цена товара: текущая крупно, старая — зачёркнутая. */
const PriceTag = ({ price, old, size = 20, suffixSize = 12 }: { price: any; old?: any; size?: number; suffixSize?: number }) => (
  <div style={{ display:"flex", alignItems:"baseline", gap:6, minWidth:0, flexWrap:"nowrap" }}>
    <span className="ub" style={{ fontSize:size, fontWeight:800, color:"var(--t1)", letterSpacing:"-.02em", whiteSpace:"nowrap" }}>
      {Number(price || 0).toFixed(2)}
      <span style={{ fontSize:suffixSize, fontWeight:700, color:"var(--t2)", marginLeft:3 }}>{CURRENCY}</span>
    </span>
    {old ? <span style={{ fontSize:suffixSize, color:"var(--t3)", textDecoration:"line-through", whiteSpace:"nowrap" }}>{Number(old).toFixed(2)}</span> : null}
  </div>
)

/** Управление количеством: − N + (не открывает страницу товара). */
const QtyStepper = ({ p, qty, onAdd, onRm, label }: { p: any; qty: number; onAdd: (id: any) => void; onRm: (id: any) => void; label?: string }) => (
  <div className="p-qty" onClick={e => e.stopPropagation()} role="group" aria-label={label || `Количество: ${p?.name || ""}`}>
    <button type="button" className="btn" onClick={e => { e.stopPropagation(); onRm(p.id) }} aria-label="Уменьшить количество">−</button>
    <span aria-live="polite">{formatCartQtyStepper(p, qty)}</span>
    <button type="button" className="btn" onClick={e => { e.stopPropagation(); onAdd(p.id) }} aria-label="Увеличить количество">+</button>
  </div>
)

const PCard = ({ p, cart, onAdd, onRm, onWish, wished, go }: any) => {
  const { catalogReady } = useLiveCatalog();
  const rating = productRatingUi(p, catalogReady);
  const qty  = cart[p.id] || 0;
  const disc = p.old ? Math.round((1 - p.price / p.old) * 100) : 0;
  const bulkHint = formatBulkPricingHint(p);
  const [pop, setPop] = useState(false);
  const out = qty === 0 && isOutOfStock(p);
  const open = () => go("product", { id:p.id });
  const add = e => { e && e.stopPropagation(); setPop(true); setTimeout(() => setPop(false), 260); onAdd(p.id); };
  return (
    <div className="card store-lift" style={{ display:"flex", flexDirection:"column", height:"100%", cursor:"pointer", position:"relative" }} onClick={open}>
      <button
        type="button"
        className="btn p-wish"
        onClick={e => { e.stopPropagation(); onWish(p.id); }}
        aria-label={wished ? "Убрать из избранного" : "Добавить в избранное"}
        aria-pressed={wished ? "true" : "false"}
      >
        <Ic n="heart" s={16} c={wished ? "var(--red)" : "var(--t3)"} fill={wished ? "var(--red)" : "none"} w={2}/>
      </button>
      <div style={{ position:"absolute", top:8, left:8, display:"flex", flexDirection:"column", gap:4, zIndex:3, pointerEvents:"none" }}>
        {disc > 0 && <span className="bdg b-rd">−{disc}%</span>}
        {p.isNew && <span className="bdg b-gr">Новинка</span>}
        {hasBulkPricing(p) && <span className="bdg b-gd">Опт</span>}
      </div>
      <ProductMedia p={p} emoji={p.e} style={{ width:"100%", aspectRatio:"1 / 1", flexShrink:0 }} />
      <div style={{ padding:"10px 12px 12px", flex:1, display:"flex", flexDirection:"column", gap:5, minWidth:0, minHeight:0 }}>
        <button type="button" className="btn p-name" onClick={e => { e.stopPropagation(); open(); }}>{p.name}</button>
        {p.unit ? <div style={{ fontSize:12, color:"var(--t2)" }}>{p.unit}</div> : null}
        {rating ? <div style={{ display:"flex", alignItems:"center", gap:4 }}><Stars r={rating.stars} s={11}/><span style={{ fontSize:11, color:"var(--t2)" }}>{rating.label}</span></div> : null}
        {bulkHint ? <div style={{ fontSize:11, color:"var(--org)", fontWeight:700, lineHeight:1.3 }}>{bulkHint}</div> : null}
        <div className="p-price-row">
          <PriceTag price={p.price} old={p.old} />
          {qty === 0 && !out ? (
            <button type="button" className="btn p-add-icon" onClick={add} aria-label={`Добавить «${p.name}» в корзину`} style={{ animation: pop ? "cartPop .26s ease" : "none", flexShrink:0 }}>
              <Ic n="plus" s={18} c="white" w={2.5}/>
            </button>
          ) : null}
        </div>
        {out ? (
          <div className="p-add-off">Нет в наличии</div>
        ) : qty > 0 ? (
          <QtyStepper p={p} qty={qty} onAdd={add} onRm={onRm} />
        ) : null}
      </div>
    </div>
  );
};

/** Пустое состояние раздела магазина. */
const EmptyState = ({ icon = "🔍", title, text, actionLabel, onAction, extra }: any) => (
  <div className="store-empty">
    <div className="store-empty-icon" aria-hidden="true">{icon}</div>
    <div className="store-empty-title">{title}</div>
    {text ? <div className="store-empty-text">{text}</div> : null}
    {actionLabel ? (
      <button type="button" className="btn store-btn store-btn-primary" onClick={onAction} style={{ marginTop:14 }}>{actionLabel}</button>
    ) : null}
    {extra}
  </div>
);

/** Скелетон-карточка товара: те же размеры, что у настоящей карточки. */
const ProductSkeleton = () => (
  <div className="store-skel-card" aria-hidden="true">
    <div className="skel-line store-skel-media"/>
    <div style={{ padding:"10px 12px 12px", display:"flex", flexDirection:"column", gap:6 }}>
      <div className="skel-line" style={{ height:12 }}/>
      <div className="skel-line" style={{ height:12, width:"60%" }}/>
      <div className="skel-line" style={{ height:20, width:"45%", marginTop:4 }}/>
    </div>
  </div>
);

/** Светлая сетка скелетонов под товарную сетку. */
const ProductSkeletonGrid = ({ count = 6 }: any) => (
  <div className="store-prod-grid">
    {Array.from({ length: count }).map((_, i) => <ProductSkeleton key={i}/>)}
  </div>
);

const HomePage = ({ go, cart, onAdd, onRm, onWish, wished, user }: any) => {
  const light = true;
  const showcase = useStoreShowcase();
  const banners = useMemo(() => storeBannerSlides(light, showcase), [light, showcase]);
  const tickerItems = showcase.tickers.filter(t => t && t.on !== false && String(t.text || "").trim());
  const { prods, restaurants, restaurantsReady } = useLiveCatalog();
  const { rootCats, cats, ready: catsReady } = useStoreCategories();
  const apiOrders = useOrders(s => s.orders);
  const orderCount = useMemo(() => countClientOrders(apiOrders, user), [apiOrders, user?.phone]);
  const spentTotal = useMemo(() => countClientSpent(apiOrders, user), [apiOrders, user?.phone]);
  const loyalty = useMemo(
    () => getLoyaltyProgress(spentTotal, orderCount, 0, user?.level, user?.vip, user?.loyaltyPeriod, loyaltyLockFromRecord(user, user?.level)),
    [spentTotal, orderCount, user?.level, user?.vip, user?.loyaltyPeriod, user?.levelAssignMode, user?.levelValidUntil, user?.levelLockedPeriod, user?.vipUntil],
  );
  const vipUser = user ? { ...user, vip: loyalty.isVip } : null;
  const [bi, setBi] = useState(0);
  const bannerCount = Math.max(1, banners.length);
  useEffect(() => {
    if (bannerCount < 2) return;
    const t = setInterval(() => setBi(x => (x + 1) % bannerCount), 6000);
    return () => clearInterval(t);
  }, [bannerCount]);
  const b = banners[bi % bannerCount];
  const [q, setQ] = useState(() => readSearchQuery());
  const photos = useProductPhotos(s => s.photos);
  const getLocalPhoto = useCallback((id: number) => photos[id], [photos]);
  const photoOf = useCallback((p: any) => resolveProductPhoto(p, { preferThumb: true, getPhoto: getLocalPhoto }), [getLocalPhoto]);
  const topProducts = useTopProducts(prods, 8);
  const saleProducts = useMemo(
    () => (prods || []).filter(isSaleProduct).sort((a: any, c: any) => saleDisc(c) - saleDisc(a)).slice(0, 8),
    [prods],
  );
  const hasRestaurants = restaurants.length > 0;
  const bannerPhoto = useMemo(() => {
    for (const p of topProducts) { const ph = photoOf(p); if (ph) return ph }
    for (const p of prods || []) { const ph = photoOf(p); if (ph) return ph }
    return undefined
  }, [topProducts, prods, photoOf]);
  const catPhotoBySlug = useMemo(() => {
    const m = new Map<string, any>();
    for (const p of prods || []) {
      const slug = p.catId;
      if (!slug || m.has(slug)) continue;
      if (!photoOf(p)) continue;
      m.set(slug, p);
    }
    return m;
  }, [prods, photoOf]);
  const findCatProduct = (catId: string) => {
    const direct = catPhotoBySlug.get(catId);
    if (direct) return direct;
    for (const c of cats) {
      if (c.parentId === catId) { const child = catPhotoBySlug.get(c.id); if (child) return child }
    }
    return null;
  };
  const submitSearch = (e?: any) => {
    if (e) e.preventDefault();
    writeSearchQuery(q.trim());
    go("search");
  };
  const restTileBg = softAccentSurface("#C2410C", light, "linear-gradient(145deg,#1A0808,#3A1010)");
  return (
    <div data-store-page style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:"var(--store-w)", margin:"0 auto" }}>
      <Header go={go} cart={cart} user={vipUser} hideSearch/>
      <div className="store-page-pad" style={{ padding:"12px 16px 0" }}>
        <HomeVipWelcome user={vipUser} go={go}/>

        <form className="store-search" onSubmit={submitSearch} role="search" style={{ marginBottom:16 }}>
          <Ic n="search" s={18} c="var(--t3)"/>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Найти продукты"
            aria-label="Поиск продуктов"
            type="search"
            enterKeyHint="search"
          />
          {q ? (
            <button type="button" onClick={() => { setQ(""); writeSearchQuery("") }} aria-label="Очистить поиск"><Ic n="x" s={16} c="var(--t3)"/></button>
          ) : (
            <button type="submit" aria-label="Найти"><Ic n="arr" s={16} c="var(--gr3)"/></button>
          )}
        </form>

        <button type="button" className="btn store-banner" onClick={() => go("promos")} style={{ background:b.bg }}>
          <span className="store-banner-text">
            {b.badge ? <span className="bdg b-gr" style={{ marginBottom:6 }}>{b.badge}</span> : null}
            <span className="ub store-banner-title">{b.title}</span>
            {b.sub ? <span className="store-banner-sub">{b.sub}</span> : null}
          </span>
          {bannerPhoto ? <img className="store-banner-photo" src={bannerPhoto} alt="" loading="lazy" decoding="async"/> : null}
        </button>

        {tickerItems.length > 0 && (
          <div className="store-ticker">
            <div style={{ display:"inline-flex", whiteSpace:"nowrap", animation:`ticker ${Math.max(14, tickerItems.length * 9)}s linear infinite` }}>
              {[...tickerItems, ...tickerItems].map((t, i) => (
                <span key={i} style={{ fontSize:12, fontWeight:700, color:"var(--red)", padding:"0 24px", flexShrink:0 }}>{t.text}</span>
              ))}
            </div>
          </div>
        )}

        <div className="store-sec-head">
          <div className="ub store-sec-title">Категории</div>
          <button type="button" className="btn store-sec-all" onClick={() => go("catalog")}>Все <Ic n="arr" s={14}/></button>
        </div>
        <div className="cat-rail">
          {!catsReady ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="cat-tile">
                <div className="skel-line" style={{ height:76, borderRadius:0 }}/>
                <div style={{ padding:"10px 8px" }}><div className="skel-line" style={{ height:12 }}/></div>
              </div>
            ))
          ) : rootCats.map(c => {
            const cp = findCatProduct(c.id);
            const ph = cp ? photoOf(cp) : undefined;
            return (
              <button key={c.id} type="button" className="btn cat-tile" onClick={() => go("plist", { cat:c.id })} style={{ background:c.bg }}>
                <span className="cat-tile-media">
                  {ph ? <img src={ph} alt="" loading="lazy" decoding="async"/> : <span className="cat-tile-emoji" aria-hidden="true">{c.e}</span>}
                </span>
                <span className="cat-tile-label" style={{ color:c.color }}>{c.label}</span>
              </button>
            )
          })}
          {hasRestaurants && (
            <button type="button" className="btn cat-tile" onClick={() => go("restaurants")} style={{ background:restTileBg }}>
              <span className="cat-tile-media"><span className="cat-tile-emoji" aria-hidden="true">🍽</span></span>
              <span className="cat-tile-label" style={{ color:"var(--org)" }}>Рестораны</span>
            </button>
          )}
        </div>

        {topProducts.length > 0 && <>
          <div className="store-sec-head">
            <div className="ub store-sec-title">Хиты продаж</div>
            <button type="button" className="btn store-sec-all" onClick={() => go("hot")}>Все <Ic n="arr" s={14}/></button>
          </div>
          <div className="store-prod-grid" style={{ marginBottom:24 }}>
            {topProducts.map(p => <PCard key={p.id} p={p} cart={cart} onAdd={onAdd} onRm={onRm} onWish={onWish} wished={!!wished[p.id]} go={go}/>)}
          </div>
        </>}

        {saleProducts.length > 0 && <>
          <div className="store-sec-head">
            <div className="ub store-sec-title">Акции</div>
            <button type="button" className="btn store-sec-all" onClick={() => go("promos")}>Все <Ic n="arr" s={14}/></button>
          </div>
          <div className="store-prod-grid" style={{ marginBottom:24 }}>
            {saleProducts.map(p => <PCard key={p.id} p={p} cart={cart} onAdd={onAdd} onRm={onRm} onWish={onWish} wished={!!wished[p.id]} go={go}/>)}
          </div>
        </>}

        {hasRestaurants && <>
          <div className="store-sec-head">
            <div className="ub store-sec-title">Рестораны г. Яван</div>
            <button type="button" className="btn store-sec-all" onClick={() => go("restaurants")}>Все <Ic n="arr" s={14}/></button>
          </div>
          <div className="hscroll" style={{ marginBottom:24 }}>
            {restaurants.map((r) => (
              <div key={r.id} className="card store-lift" onClick={() => go("restaurant",{rid:r.id})}
                style={{ flexShrink:0, width:172, cursor:"pointer", position:"relative", background:softFromDarkGrad(r.img, light, "#C2410C") }}>
                {!r.open && <div style={{ position:"absolute", inset:0, background:"var(--overlay)", zIndex:2, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:800, color:"#fff", borderRadius:16 }}>Закрыто</div>}
                <div style={{ padding:"14px 12px 12px", position:"relative", zIndex:1 }}>
                  <div style={{ fontSize:32, marginBottom:6 }} aria-hidden="true">{r.emoji}</div>
                  <div className="ub" style={{ fontSize:13, fontWeight:800, color:"var(--t1)", marginBottom:2, lineHeight:1.3 }}>{r.name}</div>
                  <div style={{ fontSize:11, color:"var(--t2)", marginBottom:8 }}>{restaurantCuisineLabel(r.cuisine, restaurantsReady)}</div>
                  <span style={{ padding:"2px 8px", borderRadius:8, fontSize:11, fontWeight:700, background:"var(--l3)", color:"var(--t2)" }}>★ {restaurantRatingLabel(r.rating, restaurantsReady)}</span>
                </div>
              </div>
            ))}
          </div>
        </>}

        <button type="button" className="btn store-banner" onClick={() => go("promos")} style={{ background:"var(--gr-soft)" }}>
          <span className="store-banner-text">
            <span className="ub store-banner-title">Акции и скидки</span>
            <span className="store-banner-sub">Товары по сниженной цене</span>
          </span>
          <Ic n="percent" s={26} c="var(--gr3)"/>
        </button>
      </div>
      <Nav page="home" go={go} user={vipUser}/>
    </div>
  );
};

const CatalogPage = ({ go, cart, user }: any) => {
  const light = true;
  const { prods, restaurants, restaurantsReady, catalogReady } = useLiveCatalog();
  const { rootCats, cats, ready: catsReady } = useStoreCategories();
  const { isVip } = resolveUserVip(user, light);
  const [q, setQ] = useState(() => readSearchQuery());
  const photos = useProductPhotos(s => s.photos);
  const totalQty = formatCartBadgeCount(sumCartUnits(cart || {}, prods));
  const totalQtyNum = sumCartUnits(cart || {}, prods);
  /** Первый товар категории с реальным фото — для плитки категории. */
  const catPhoto = useMemo(() => {
    const m = new Map<string, any>();
    const slugOf = (p: any) => productCatSlug(p);
    for (const p of prods || []) {
      const slug = slugOf(p);
      if (!slug || m.has(slug)) continue;
      const url = resolveProductPhoto(p, { preferThumb: true, getPhoto: id => photos[id] });
      if (!url) continue;
      m.set(slug, url);
    }
    return m;
  }, [prods, photos]);
  const catImage = (catId: string): string | undefined => {
    const direct = catPhoto.get(catId);
    if (direct) return direct;
    for (const c of cats || []) if (c.parentId === catId) { const child = catPhoto.get(c.id); if (child) return child }
    return undefined;
  };
  const submitSearch = (e?: any) => {
    if (e) e.preventDefault();
    writeSearchQuery(q.trim());
    go("search");
  };
  const loading = !catsReady || (USE_API && !catalogReady);
  return (
    <div data-store-page style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:"var(--store-w)", margin:"0 auto" }}>
      <Header title="Каталог" go={go} cart={cart} user={user} hideSearch/>
      <div className="store-page-pad" style={{ padding:"12px 16px 0" }}>
        <form className="store-search" onSubmit={submitSearch} role="search" style={{ marginBottom:16 }}>
          <Ic n="search" s={18} c="var(--t3)"/>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Найти продукты" aria-label="Поиск продуктов" type="search" enterKeyHint="search"/>
          {q ? <button type="button" onClick={() => { setQ(""); writeSearchQuery("") }} aria-label="Очистить поиск"><Ic n="x" s={16} c="var(--t3)"/></button>
            : <button type="submit" aria-label="Найти"><Ic n="arr" s={16} c="var(--gr3)"/></button>}
        </form>

        <div className="store-tile-grid" style={{ marginBottom:24 }}>
          <button type="button" className="btn cat-tile" style={{ flex:"unset", background:"var(--gr-soft)" }} onClick={() => go("promos")}>
            <span className="cat-tile-media"><span className="cat-tile-emoji" aria-hidden="true">%</span></span>
            <span className="cat-tile-label" style={{ color:"var(--gr3)" }}>Акции и скидки</span>
          </button>
          <button type="button" className="btn cat-tile" style={{ flex:"unset", background:"var(--l3)" }} onClick={() => go("hot")}>
            <span className="cat-tile-media"><span className="cat-tile-emoji" aria-hidden="true">🔥</span></span>
            <span className="cat-tile-label" style={{ color:"var(--org)" }}>Хиты продаж</span>
          </button>
        </div>

        {restaurants.length > 0 && (
          <button type="button" className="btn store-banner" onClick={() => go("restaurants")} style={{ background:"var(--l2)" }}>
            <span className="store-banner-text">
              <span className="ub store-banner-title">Рестораны г. Яван</span>
              <span className="store-banner-sub">{restaurantsReady ? `${formatProductCount(restaurants.length)} · доставка по городу` : "Доставка по городу"}</span>
            </span>
            <span aria-hidden="true" style={{ fontSize:34 }}>🍽</span>
          </button>
        )}

        <div className="store-sec-head">
          <div className="ub store-sec-title">Все категории</div>
        </div>
        {loading ? (
          <div className="store-tile-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="cat-tile" style={{ flex:"unset" }}>
                <div className="skel-line" style={{ height:76, borderRadius:0 }}/>
                <div style={{ padding:"10px 8px" }}><div className="skel-line" style={{ height:12 }}/></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="store-tile-grid">
            {rootCats.map(c => {
              const ph = catImage(c.id);
              const count = productsInCategory(prods, c.id, null, cats).length;
              return (
                <button key={c.id} type="button" className="btn cat-tile" style={{ flex:"unset", background:c.bg }} onClick={() => go("plist", { cat:c.id })}>
                  <span className="cat-tile-media">
                    {ph ? <img src={ph} alt="" loading="lazy" decoding="async"/> : <span className="cat-tile-emoji" aria-hidden="true">{c.e}</span>}
                  </span>
                  <span className="cat-tile-label" style={{ color:c.color }}>{c.label}</span>
                  <span className="cat-tile-count">{formatProductCount(count)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {totalQtyNum > 0 && <FloatingCartBtn count={totalQty} onClick={() => go("cart")} isVip={isVip}/>}
      <Nav page="catalog" go={go} user={user}/>
    </div>
  );
};
const PListPage = ({ go, params, cart, onAdd, onRm, onWish, wished, user }: any) => {
  const light = true;
  const { prods, catalogReady } = useLiveCatalog();
  const { cats, rootCats, ready: catsReady } = useStoreCategories();
  const { isVip } = resolveUserVip(user, light);
  const [sort,    setSort]    = useState("pop");
  const [view,    setView]    = useState("grid");
  const [search,  setSearch]  = useState("");
  const [subCat,  setSubCat]  = useState(null);
  const isHotHits = params?.cat === "hot" || params?.hot === "1";
  const hotCat = {
    ...HOT_HITS_CAT,
    bg: softAccentSurface('#FB923C', light, HOT_HITS_CAT.bg),
  };
  const cat = isHotHits ? hotCat : (cats.find(c => c.id === params?.cat) || rootCats[0] || { id: 'other', e: '📦', label: 'Прочее', bg: catThemeForMode('other', light).bg, color: catThemeForMode('other', light).color });
  const subCats = isHotHits ? [] : cats.filter(c => c.parentId === cat.id);
  const hasSubCats = subCats.length > 0;
  const totalQty = formatCartBadgeCount(sumCartUnits(cart, prods));
  const totalQtyNum = sumCartUnits(cart, prods);
  const topProducts = useTopProducts(prods, 24);
  let items = isHotHits ? topProducts : productsInCategory(prods, params?.cat, subCat, cats);
  if (search) items = items.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
  if (sort === "cheap") items = [...items].sort((a,b) => a.price - b.price);
  else if (sort === "exp") items = [...items].sort((a,b) => b.price - a.price);
  else if (sort === "sale") items = items.filter(p => p.old).sort((a,b) => (1-b.price/b.old) - (1-a.price/a.old));
  if (USE_API && (!catalogReady || !catsReady)) {
    return (
      <div data-store-page style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:'var(--store-w)', margin:"0 auto", display:"flex", alignItems:"center", justifyContent:"center", color:"var(--t3)", fontSize:13 }}>
        Загрузка каталога…
      </div>
    );
  }
  return (
    <div data-store-page style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:'var(--store-w)', margin:"0 auto" }}>
      <header data-store-header style={{ position:"sticky", top:0, zIndex:100, background: isVip ? "var(--header-bg)" : "var(--header-bg)", backdropFilter:"blur(24px)", borderBottom: isVip ? "1px solid rgba(233,174,0,.3)" : "1px solid var(--b1)", boxShadow: isVip ? "0 4px 24px rgba(233,174,0,.1)" : "none" }}>
        <div style={{ padding:"13px 18px 10px", display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={() => storeBack(isHotHits ? "home" : "catalog", go)} className="btn" style={{ width:38, height:38, borderRadius:12, background:"var(--l3)", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div style={{ width:36, height:36, borderRadius:10, background:cat.bg, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>{cat.e}</div>
          <div style={{ flex:1 }}>
            <div className="ub" style={{ fontSize:15, fontWeight:800 }}>{cat.label}</div>
            <div style={{ fontSize:10, color:"var(--t2)", marginTop:1 }}>{isHotHits ? "Только хиты · " : ""}{formatProductCount(items.length)}</div>
          </div>
          <CartHeaderButton count={totalQty} qtyNum={totalQtyNum} onClick={() => go("cart")} isVip={isVip} />
        </div>
        <div style={{ padding:"0 18px 10px", position:"relative" }}>
          <div style={{ position:"absolute", left:30, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}><Ic n="search" s={15} c="var(--t3)"/></div>
          <input className="inp" value={search} onChange={e => setSearch(e.target.value)} placeholder={isHotHits ? "Поиск среди хитов..." : "Поиск в категории..."} style={{ paddingLeft:38, width:"100%", fontSize:13 }}/>
        </div>
        {hasSubCats && (
          <div className="hscroll" style={{ padding:"0 18px 8px", gap:8 }}>
            <button onClick={()=>setSubCat(null)} className="btn"
              style={{ padding:"7px 14px", borderRadius:50, fontSize:12, fontWeight:700, border:`1.5px solid ${!subCat?"rgba(7,136,61,.38)":"var(--b1)"}`, background:!subCat?"var(--gr-soft)":"var(--l2)", color:!subCat?"var(--gr)":"var(--t2)", whiteSpace:"nowrap", fontFamily:"Nunito", flexShrink:0 }}>
              Все
            </button>
            {subCats.map(sc=>(
              <button key={sc.id} onClick={()=>setSubCat(sc.id)} className="btn"
                style={{ padding:"7px 14px", borderRadius:50, fontSize:12, fontWeight:700, border:`1.5px solid ${subCat===sc.id?"rgba(7,136,61,.38)":"var(--b1)"}`, background:subCat===sc.id?"var(--gr-soft)":"var(--l2)", color:subCat===sc.id?"var(--gr)":"var(--t2)", whiteSpace:"nowrap", fontFamily:"Nunito", flexShrink:0, display:"flex", alignItems:"center", gap:5 }}>
                <span style={{fontSize:16}}>{sc.e}</span> {sc.label}
              </button>
            ))}
          </div>
        )}
        <div style={{ padding:"0 18px 11px", display:"flex", gap:8, alignItems:"center" }}>
          <div className="hscroll" style={{ flex:1, gap:6 }}>
            {[{id:"pop",l:"🔥 Хиты"},{id:"cheap",l:"↑ Дешевле"},{id:"exp",l:"↓ Дороже"},{id:"sale",l:"💸 Скидки"}].map(s => (
              <button key={s.id} className={`chip ${sort===s.id?"on":""}`} onClick={() => setSort(s.id)} style={{ fontSize:11, padding:"7px 12px" }}>{s.l}</button>
            ))}
          </div>
          <div style={{ display:"flex", gap:4 }}>
            {[{v:"grid",n:"grid"},{v:"list",n:"list"}].map(v => (
              <button key={v.v} onClick={() => setView(v.v)} className="btn" style={{ width:34, height:34, borderRadius:9, background:view===v.v?"var(--gr-soft)":"var(--l3)", border:`1.5px solid ${view===v.v?"rgba(7,136,61,.38)":"var(--b1)"}`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                <Ic n={v.n} s={14} c={view===v.v?"var(--gr)":"var(--t2)"}/>
              </button>
            ))}
          </div>
        </div>
      </header>
      <div style={{ padding:"14px 18px 110px" }}>
        {items.length === 0 ? (
          <div style={{ textAlign:"center", paddingTop:60 }}>
            <div style={{ fontSize:56, marginBottom:14 }}>{isHotHits ? "🔥" : "🔍"}</div>
            <div className="ub" style={{ fontSize:17, fontWeight:800, marginBottom:8 }}>{isHotHits ? "Хитов пока нет" : "Ничего не найдено"}</div>
            {isHotHits && <div style={{ fontSize:13, color:"var(--t2)", marginBottom:16 }}>Отметьте товары как «Хит» в админке</div>}
            <button className="btn" onClick={() => isHotHits ? go("home") : setSearch("")} style={{ padding:"12px 24px", borderRadius:14, background:"var(--gr)", color:"white", fontSize:13 }}>{isHotHits ? "На главную" : "Сбросить"}</button>
          </div>
        ) : view === "grid" ? (
          <div className="store-prod-grid" style={{ alignItems:"stretch" }}>
            {items.map((p,i) => <div key={p.id} style={{ animation:`fadeUp .45s cubic-bezier(.16,1,.3,1) ${i*.04}s both`, height:"100%" }}><PCard p={p} cart={cart} onAdd={onAdd} onRm={onRm} onWish={onWish} wished={!!wished[p.id]} go={go}/></div>)}
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {items.map((p,i) => {
              const qty = cart[p.id]||0, disc = p.old ? Math.round((1-p.price/p.old)*100) : 0;
              const rating = productRatingUi(p, catalogReady);
              return (
                <div key={p.id} className="card" style={{ display:"flex", alignItems:"center", gap:12, padding:"12px", animation:`fadeUp .4s cubic-bezier(.16,1,.3,1) ${i*.04}s both` }} onClick={() => go("product", { id:p.id })}>
                  <div style={{ width:60, height:60, borderRadius:14, background:softFromDarkGrad(p.grad, light), display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, flexShrink:0, position:"relative", overflow:"hidden" }}>
                    {resolveProductPhoto(p, { preferThumb: true })
                      ? <img src={resolveProductPhoto(p, { preferThumb: true })} alt="" loading="lazy" decoding="async" style={{ width:"100%", height:"100%", objectFit:"contain", padding:4, boxSizing:"border-box", display:"block" }}/>
                      : p.e}
                    {disc>0 && <div style={{ position:"absolute", top:-4, left:-4, borderRadius:8, background:"var(--red)", padding:"1px 5px", fontSize:9, fontWeight:800, color:"white" }}>-{disc}%</div>}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:700, marginBottom:1 }}>{p.name}</div>
                    <div style={{ fontSize:10, color:"var(--t3)", marginBottom:4 }}>{p.unit}</div>
                    <div style={{ display:"flex", alignItems:"center", gap:3 }}>{rating ? (<><Stars r={rating.stars} s={8}/><span style={{ fontSize:9, color:"var(--t2)" }}>{rating.label}</span></>) : null}</div>
                    <div style={{ display:"flex", alignItems:"baseline", gap:5, marginTop:4 }}>
                      <span className="ub" style={{ fontSize:14, fontWeight:800 }}>{p.price.toFixed(2)}<span style={{ fontSize:12, color:"var(--t2)", marginLeft:2 }}>ЅМ</span></span>
                      {p.old && <span style={{ fontSize:10, color:"var(--t3)", textDecoration:"line-through" }}>{p.old.toFixed(2)}</span>}
                    </div>
                  </div>
                  <div style={{ flexShrink:0 }}>
                    {qty === 0 ? (
                      <button onClick={e => { e.stopPropagation(); onAdd(p.id); }} className="btn" style={{ width:36, height:36, borderRadius:10, background:"var(--gr)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                        <Ic n="plus" s={16} c="white" w={2.5}/>
                      </button>
                    ) : (
                      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, background:"var(--gr-soft)", border:"1.5px solid rgba(7,136,61,.3)", borderRadius:10, padding:"4px 6px" }}>
                        <button onClick={e => { e.stopPropagation(); onRm(p.id); }} className="btn" style={{ width:22, height:22, borderRadius:6, background:"rgba(7,136,61,.18)", color:"var(--gr)", fontSize:14, fontWeight:700 }}>−</button>
                        <span className="ub" style={{ fontSize:12, fontWeight:800, color:"var(--gr)" }}>{formatCartQtyStepper(p, qty)}</span>
                        <button onClick={e => { e.stopPropagation(); onAdd(p.id); }} className="btn" style={{ width:22, height:22, borderRadius:6, background:"rgba(7,136,61,.18)", color:"var(--gr)", fontSize:14, fontWeight:700 }}>+</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {totalQtyNum > 0 && (
        <FloatingCartBtn count={totalQty} onClick={() => go("cart")} label="Корзина" isVip={isVip} />
      )}
      <Nav page={isHotHits ? "home" : "catalog"} go={go} user={user}/>
    </div>
  );
};

const QtyStepperBar = ({ qty, onAdd, onRm, size = "md", label, disabled = false }: any) => {
  const btn = size === "sm" ? 34 : 40;
  const display = label ?? qty;
  const wrap = {
    display: "flex",
    alignItems: "center",
    gap: size === "sm" ? 6 : 8,
    background: "var(--l3)",
    border: "1px solid var(--b1)",
    borderRadius: size === "sm" ? 12 : 14,
    padding: size === "sm" ? "4px 5px" : "5px 8px",
  };
  const btnStyle = {
    width: btn,
    height: btn,
    borderRadius: btn / 2,
    background: "var(--gr-soft)",
    border: "1.5px solid rgba(7,136,61,.3)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--t1)",
    flexShrink: 0,
    opacity: 1,
  };
  return (
    <div style={wrap}>
      <button
        type="button"
        onClick={onRm}
        disabled={qty === 0}
        className="btn"
        style={{ ...btnStyle, opacity: qty > 0 ? 1 : 0.35 }}
      >
        <Ic n="minus" s={size === "sm" ? 14 : 16} c="var(--t1)" w={2.2}/>
      </button>
      <div className="ub" style={{ minWidth: size === "sm" ? 24 : 32, textAlign: "center", fontSize: size === "sm" ? 13 : 15, fontWeight: 900, color: "var(--t1)" }}>{display}</div>
      <button type="button" onClick={onAdd} className="btn" style={btnStyle}>
        <Ic n="plus" s={size === "sm" ? 14 : 16} c="var(--gr)" w={2.5}/>
      </button>
    </div>
  );
};

const ProductPage = ({ go, params, cart, onAdd, onRm, onWish, wished }: any) => {
  const light = true;
  const { prods, catalogReady } = useLiveCatalog();
  const { cats } = useStoreCategories();
  const p = prods.find(x => x.id == params?.id);
  const [tab, setTab] = useState("desc");
  const [storeReviews, setStoreReviews] = useState<Review[]>([]);
  const [storeRevCount, setStoreRevCount] = useState<number | null>(null);
  const [revLoading, setRevLoading] = useState(false);
  const productId = p?.id;
  const localPhoto = useProductPhotos(s => (productId != null ? s.photos[productId] : undefined));
  useEffect(() => {
    if (!USE_API) {
      setStoreRevCount(0);
      return;
    }
    api.getReviews({ restId: 'STORE' })
      .then(list => setStoreRevCount(list.length))
      .catch(() => setStoreRevCount(0));
  }, []);
  useEffect(() => {
    if (tab !== "rev") return;
    if (!USE_API) {
      setStoreReviews([]);
      setRevLoading(false);
      return;
    }
    setRevLoading(true);
    api.getReviews({ restId: 'STORE' })
      .then(list => {
        const sorted = sortReviewsNewestFirst(list);
        setStoreReviews(sorted.slice(0, 12));
        setStoreRevCount(sorted.length);
      })
      .catch(() => setStoreReviews([]))
      .finally(() => setRevLoading(false));
  }, [tab]);
  /** Настоящие фото товара: сначала основное, затем миниатюра и локальный кэш. */
  const gallery = useMemo(() => {
    const list: string[] = [];
    const push = (u?: string) => { if (u && !list.includes(u)) list.push(u); };
    push(resolvePhotoUrl(p?.photo));
    push(resolvePhotoUrl(p?.photoThumb));
    push(resolveProductPhoto(p, { preferThumb: false, getPhoto: () => localPhoto }));
    return list;
  }, [p?.photo, p?.photoThumb, localPhoto]);
  const [gi, setGi] = useState(0);
  if (!catalogReady || !p) {
    return (
      <div data-store-page style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:"var(--store-w)", margin:"0 auto" }}>
        <Header title="Товар" back="catalog" go={go} cart={cart}/>
        <div style={{ padding:"16px" }}>
          <div className="skel-line" style={{ width:"100%", aspectRatio:"1 / 1", borderRadius:"var(--r-card)" }}/>
        </div>
      </div>
    );
  }
  const qty = cart[p.id] || 0;
  const photo = gallery[gi] || gallery[0];
  const disc = p.old ? Math.round((1 - p.price / p.old) * 100) : 0;
  const pCat = productCatSlug(p);
  const related = prods.filter(x => productCatSlug(x) === pCat && x.id !== p.id).slice(0, 6);
  const cartBadge = formatCartBadgeCount(sumCartUnits(cart, prods));
  const cartBadgeNum = sumCartUnits(cart, prods);
  const weighted = isWeighted(p);
  const qtyLabel = weighted ? formatCartQtyStepper(p, qty) : qty;
  const lineTotal = calcLineTotal(p, qty);
  const add = () => onAdd(p.id);
  const rm  = () => onRm(p.id);
  const outOfStock = isOutOfStock(p);
  const bulkHint = formatBulkPricingHint(p);
  const bulkQtyHint = bulkPricingHintForQty(p, qty);
  const storeRevLabel = storeRevCount == null ? '…' : String(storeRevCount);
  return (
    <div data-store-page style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:"var(--store-w)", margin:"0 auto" }}>
      <header data-store-header style={{ position:"sticky", top:0, zIndex:100, background:"var(--header-bg)", backdropFilter:"blur(20px)", borderBottom:"1px solid var(--b1)" }}>
        <div style={{ padding:"10px 16px", display:"flex", alignItems:"center", gap:10 }}>
          <button type="button" onClick={() => storeBack("catalog", go)} className="btn hdr-icon" aria-label="Назад">
            <Ic n="arrL" s={18} c="var(--t1)"/>
          </button>
          <div className="ub" style={{ flex:1, minWidth:0, fontSize:16, fontWeight:800, color:"var(--t1)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.name}</div>
          <button type="button" className="btn hdr-icon" onClick={() => onWish(p.id)} aria-label={wished?.[p.id] ? "Убрать из избранного" : "Добавить в избранное"} aria-pressed={wished?.[p.id] ? "true" : "false"}>
            <Ic n="heart" s={18} c={wished?.[p.id] ? "var(--red)" : "var(--t1)"} fill={wished?.[p.id] ? "var(--red)" : "none"} w={2}/>
          </button>
          <CartHeaderButton count={cartBadge} qtyNum={cartBadgeNum} onClick={() => go("cart")}/>
        </div>
      </header>
      <div className="store-hero-pad">
        {/* Фото: светлая поверхность, contain, без цветных подложек */}
        <div style={{ background:"var(--l1)", border:"1px solid var(--b1)", borderRadius:"var(--r-card)", overflow:"hidden", position:"relative" }}>
          <ProductMedia p={p} emoji={p.e} padding={16} style={{ width:"100%", aspectRatio:"1 / 1" }} className="store-product-hero"/>
          <div style={{ position:"absolute", top:12, left:12, display:"flex", flexWrap:"wrap", gap:6, pointerEvents:"none" }}>
            {disc > 0 && <span className="bdg b-rd">−{disc}%</span>}
            {p.isNew && <span className="bdg b-gr">Новинка</span>}
            {p.hot && <span className="bdg b-gd">Хит продаж</span>}
            {p.org && <span className="bdg b-gr">Органик</span>}
            {hasBulkPricing(p) && <span className="bdg b-gd">Оптом дешевле</span>}
          </div>
        </div>
        {gallery.length > 1 && (
          <div className="hscroll" style={{ gap:8, marginTop:10, paddingBottom:2 }} role="list" aria-label="Фотографии товара">
            {gallery.map((src, i) => (
              <button key={src} type="button" role="listitem" onClick={() => setGi(i)} aria-label={`Фото ${i + 1}`} aria-current={i === gi ? "true" : undefined}
                className="btn" style={{ width:64, height:64, flexShrink:0, borderRadius:12, overflow:"hidden", background:"#fff", border:`1.5px solid ${i === gi ? "var(--gr)" : "var(--b1)"}`, padding:4 }}>
                <img src={src} alt="" loading="lazy" decoding="async" style={{ width:"100%", height:"100%", objectFit:"contain", display:"block" }}/>
              </button>
            ))}
          </div>
        )}
        <div style={{ marginTop:16 }}>
          <button type="button" className="btn" onClick={() => go("plist", { cat:pCat })} style={{ fontSize:12, color:"var(--gr3)", fontWeight:700, padding:"2px 0" }}>
            {cats.find(c => c.id === pCat)?.label || p.catLabel || p.cat}
          </button>
          <div className="ub" style={{ fontSize:22, fontWeight:900, lineHeight:1.25, color:"var(--t1)", margin:"6px 0 6px", overflowWrap:"anywhere" }}>{p.name}</div>
          {p.unit ? <div style={{ fontSize:13, color:"var(--t2)" }}>{p.unit}{p.art ? ` · Арт. ${p.art}` : ""}</div> : (p.art ? <div style={{ fontSize:13, color:"var(--t2)" }}>Арт. {p.art}</div> : null)}
        </div>
        <div className="card" style={{ padding:16, marginTop:14 }}>
          <div style={{ display:"flex", alignItems:"flex-end", gap:10, flexWrap:"wrap" }}>
            <span className="ub" style={{ fontSize:30, fontWeight:900, color:"var(--t1)", letterSpacing:"-.02em" }}>
              {p.price.toFixed(2)}<span style={{ fontSize:15, fontWeight:700, color:"var(--t2)", marginLeft:3 }}>ЅМ</span>
            </span>
            {p.old > p.price && <span style={{ fontSize:15, color:"var(--t3)", textDecoration:"line-through", marginBottom:4 }}>{Number(p.old).toFixed(2)} ЅМ</span>}
            {disc > 0 && <span className="bdg b-rd" style={{ marginBottom:4 }}>−{disc}%</span>}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginTop:6 }}>
            <span style={{ fontSize:12, color:"var(--t2)" }}>{formatPriceLabel(p)}{weighted && <span style={{ color:"var(--org)", marginLeft:8 }}>На развес</span>}</span>
            {outOfStock
              ? <span style={{ fontSize:12, color:"var(--red)", fontWeight:700 }}>Нет в наличии</span>
              : <span style={{ fontSize:12, color:"var(--gr3)", fontWeight:700, display:"inline-flex", alignItems:"center", gap:5 }}><span style={{ width:6, height:6, borderRadius:"50%", background:"var(--gr)" }}/>В наличии</span>}
            {USE_API && storeRevCount !== null && (
              <span style={{ fontSize:12, color:"var(--t2)" }}>{storeRevLabel} {reviewCountLabel(storeRevCount)}</span>
            )}
            {!USE_API && p.r ? <span style={{ fontSize:12, color:"var(--t2)", display:"inline-flex", alignItems:"center", gap:5 }}><Stars r={p.r} s={11}/>{p.r} · {p.rv}</span> : null}
          </div>
          {bulkHint && (
            <div style={{ marginTop:12, padding:"10px 12px", borderRadius:12, background:"var(--l3)", border:"1px solid var(--b1)", fontSize:12, fontWeight:700, color:"var(--t1)" }}>{bulkHint}</div>
          )}
          {bulkQtyHint && (
            <div style={{ marginTop:8, fontSize:12, fontWeight:700, color: bulkQtyHint.startsWith('Опт') ? "var(--gr3)" : "var(--org)" }}>{bulkQtyHint}</div>
          )}
          <div style={{ marginTop:14 }}>
            {outOfStock && qty === 0 ? (
              <div className="p-add-off" style={{ minHeight:52 }}>Нет в наличии — добавление недоступно</div>
            ) : qty === 0 ? (
              <button type="button" className="btn store-btn store-btn-primary store-btn-block" onClick={add} style={{ minHeight:52 }}>
                <Ic n="bag" s={19} c="white"/>В корзину · {p.price.toFixed(2)} ЅМ
              </button>
            ) : (
              <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
                <QtyStepperBar qty={qty} label={qtyLabel} onAdd={add} onRm={rm}/>
                <button type="button" className="btn store-btn store-btn-sec" onClick={() => go("cart")} style={{ flex:1, minWidth:150 }}>
                  <Ic n="check" s={16} c="var(--gr3)" w={2.5}/>В корзине · {lineTotal.toFixed(2)} ЅМ
                </button>
              </div>
            )}
          </div>
        </div>
        <div style={{ borderBottom:"1px solid var(--b1)", display:"flex", margin:"18px 0 14px" }}>
          {[{id:"desc",l:"Описание"},{id:"spec",l:"Характеристики"},{id:"rev",l:`Отзывы (${storeRevLabel})`}].map(t => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)} className="btn" aria-current={tab === t.id ? "true" : undefined}
              style={{ flex:1, padding:"11px 4px", fontSize:13, background:"transparent", color:tab===t.id?"var(--gr3)":"var(--t2)", borderBottom:`2px solid ${tab===t.id?"var(--gr)":"transparent"}`, borderRadius:0, fontWeight:700 }}>{t.l}</button>
          ))}
        </div>
        {tab==="desc" && (
          <div style={{ fontSize:14, color:"var(--t2)", lineHeight:1.7, overflowWrap:"anywhere" }}>
            {p.desc || "Описание для этого товара пока не заполнено."}
          </div>
        )}
        {tab==="spec" && (
          <div className="card" style={{ overflow:"hidden" }}>
            {Object.entries(p.specs || {}).length === 0 && <div className="store-empty-text" style={{ padding:16 }}>Характеристики не заполнены.</div>}
            {Object.entries(p.specs || {}).map(([k,v],i,arr) => (
              <div key={k} style={{ display:"flex", justifyContent:"space-between", gap:12, padding:"13px 16px", borderBottom:i<arr.length-1?"1px solid var(--b1)":"none" }}>
                <span style={{ fontSize:13, color:"var(--t2)" }}>{k}</span><span style={{ fontSize:13, fontWeight:700, color:"var(--t1)", textAlign:"right" }}>{String(v)}</span>
              </div>
            ))}
          </div>
        )}
        {tab==="rev" && (
          <div>
            <div style={{ padding:"12px 14px", borderRadius:14, background:"var(--l3)", border:"1px solid var(--b1)", marginBottom:14, fontSize:12, color:"var(--t2)", lineHeight:1.55 }}>
              Отзывы о магазине можно оставить после доставки — в разделе <button type="button" onClick={() => go("orders")} className="btn" style={{ display:"inline", padding:0, background:"transparent", border:"none", color:"var(--gr3)", fontWeight:800, fontSize:12 }}>Мои заказы</button>.
            </div>
            {revLoading && <div style={{ display:"flex", flexDirection:"column", gap:10 }}>{[0,1].map(i => <div key={i} className="skel-line" style={{ height:76, borderRadius:16 }}/>)}</div>}
            {!revLoading && storeReviews.length === 0 && (
              <EmptyState icon="💬" title="Пока нет отзывов" text="Отзывы о магазине появятся здесь после доставленных заказов."/>
            )}
            {!revLoading && storeReviews.map((rv, i) => (
              <div key={rv.id || i} className="card" style={{ padding:14, marginBottom:10 }}>
                <div style={{ display:"flex", gap:10, marginBottom:8 }}>
                  <div style={{ width:36, height:36, borderRadius:"50%", background:"var(--gr-soft)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Unbounded", fontSize:14, fontWeight:900, color:"var(--gr3)", flexShrink:0 }}>{(rv.client || "К").charAt(0)}</div>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:"var(--t1)" }}>{rv.client}</div>
                    <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:2 }}>
                      <Stars r={rv.rating} s={9}/>
                      <span style={{ fontSize:11, color:"var(--t3)" }}>{rv.date}</span>
                    </div>
                  </div>
                </div>
                <p style={{ fontSize:13, color:"var(--t2)", lineHeight:1.6, overflowWrap:"anywhere" }}>{rv.text}</p>
                {(rv.adminReply || rv.restReply) && (
                  <div style={{ marginTop:8, fontSize:12, color:"var(--t2)", padding:"9px 11px", background:"var(--gr-soft)", borderRadius:10, lineHeight:1.5 }}>{rv.adminReply || rv.restReply}</div>
                )}
              </div>
            ))}
          </div>
        )}
        {related.length > 0 && (
          <div style={{ marginTop:26 }}>
            <div className="store-sec-head">
              <div className="ub store-sec-title">Похожие товары</div>
            </div>
            <div className="store-prod-grid">
              {related.map(rp => <PCard key={rp.id} p={rp} cart={cart} onAdd={onAdd} onRm={onRm} onWish={onWish} wished={!!wished?.[rp.id]} go={go}/>)}
            </div>
          </div>
        )}
      </div>
      <Nav page="catalog" go={go}/>
    </div>
  );
};
const CartPage = ({ go, cart, cartMeta = {}, onAdd, onRm, onDel, cartSyncReady = true, user }: any) => {
  const light = true;
  const { prods, catalogReady } = useLiveCatalog();
  const items = buildCartLineItems(cart, cartMeta, prods);
  const prodItems = items.filter(p => !p.isRest);
  const cartBoot =
    (cartHasQty(cart) && items.length === 0) ||
    (!cartSyncReady && !!user?.phone && !cartHasQty(cart)) ||
    (USE_API && !catalogReady && cartHasQty(cart));
  if (cartBoot) return <CartPageBoot go={go} />;
  const retailSub = items.reduce((s, p) => s + (p.isRest ? (Number(p.price) || 0) * p.qty : lineRetailTotal(p, p.qty)), 0);
  const bulkSaved = prodItems.reduce((s, p) => s + lineBulkSavings(p, p.qty), 0);
  const saleSaved = prodItems.reduce((s, p) => s + lineSaleSavings(p, p.qty), 0);
  const sub   = items.reduce((s,p) => s + calcLineTotal(p, p.qty), 0);
  const total = sub;
  const totalSaved = Math.round((bulkSaved + saleSaved) * 100) / 100;
  const tqty  = items.length;
  const restCount = items.filter(p => p.isRest).length;
  return (
    <div data-store-page style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:"var(--store-w)", margin:"0 auto" }}>
      <header data-store-header style={{ position:"sticky", top:0, zIndex:100, background:"var(--header-bg)", backdropFilter:"blur(20px)", borderBottom:"1px solid var(--b1)" }}>
        <div style={{ padding:"10px 16px", display:"flex", alignItems:"center", gap:10 }}>
          <button type="button" onClick={() => storeBack("home", go)} className="btn hdr-icon" aria-label="Назад"><Ic n="arrL" s={18} c="var(--t1)"/></button>
          <div style={{ flex:1, minWidth:0 }}>
            <div className="ub" style={{ fontSize:18, fontWeight:800, color:"var(--t1)" }}>Корзина</div>
            <div style={{ fontSize:12, color:"var(--t2)" }}>{formatProductCount(tqty)}{restCount > 0 ? ` · ${restCount} из ресторана` : ""}</div>
          </div>
          {items.length > 0 && (
            <button type="button" onClick={() => items.forEach(p => onDel(p.id))} className="btn store-btn store-btn-sm"
              style={{ background:"var(--red-soft)", border:"1px solid rgba(195,52,52,.25)", color:"var(--red)" }}>Очистить</button>
          )}
        </div>
      </header>
      {items.length === 0 ? (
        <div style={{ paddingTop:24 }}>
          <EmptyState icon="🛒" title="Корзина пуста" text="Добавьте товары из каталога — они появятся здесь." actionLabel="Перейти в каталог" onAction={() => go("catalog")}/>
        </div>
      ) : (
        <div className="store-list-pad">
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {items.map(p => {
              const disc2 = p.old && p.old > p.price ? Math.round((1 - p.price / p.old) * 100) : 0;
              const bulkLine = !p.isRest ? bulkPricingHintForQty(p, p.qty) : null;
              const itemSaved = p.isRest ? 0 : lineTotalSavings(p, p.qty);
              const itemRetail = p.isRest ? (Number(p.price) || 0) * p.qty : lineRetailTotal(p, p.qty);
              const itemBulk = p.isRest ? 0 : lineBulkSavings(p, p.qty);
              const itemSale = p.isRest ? 0 : lineSaleSavings(p, p.qty);
              const unitPrice = cartUnitPrice(p, p.qty, !!p.isRest);
              const atMin = isWeighted(p) ? p.qty <= productMinWeight(p) : p.qty === 1;
              const outNow = !p.isRest && isOutOfStock(p);
              return (
                <div key={p.id} className="store-row" style={{ alignItems:"flex-start" }}>
                  <div className="store-row-media" aria-hidden="true">
                    <ProductMedia p={p} emoji={p.e} padding={6} style={{ width:"100%", height:"100%" }}/>
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"flex-start", gap:8 }}>
                      <button type="button" className="btn p-name" style={{ fontWeight:700, fontSize:14 }}
                        onClick={() => !p.isRest && go("product", { id:p.id })}>{p.name}</button>
                      <button type="button" className="btn" onClick={() => onDel(p.id)} aria-label={`Удалить «${p.name}» из корзины`}
                        style={{ width:34, height:34, borderRadius:10, background:"transparent", display:"inline-flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                        <Ic n="trash" s={15} c="var(--t3)"/>
                      </button>
                    </div>
                    <div style={{ fontSize:12, color:"var(--t2)", marginTop:2 }}>
                      {p.isRest ? "Ресторан" : (isWeighted(p) ? `На развес · ${formatCartQty(p, p.qty)}` : (p.unit || "шт"))}
                    </div>
                    <div style={{ fontSize:12, color:"var(--t3)", marginTop:4, display:"flex", flexWrap:"wrap", alignItems:"baseline", gap:6 }}>
                      {unitPrice.current < unitPrice.base && <span style={{ textDecoration:"line-through" }}>{unitPrice.base.toFixed(2)}</span>}
                      {!(unitPrice.current < unitPrice.base) && p.old > p.price && <span style={{ textDecoration:"line-through" }}>{Number(p.old).toFixed(2)}</span>}
                      <span style={{ fontWeight:800, color: (unitPrice.current < unitPrice.base || p.old > p.price) ? "var(--gr3)" : "var(--t2)" }}>{unitPrice.current.toFixed(2)} ЅМ</span>
                      <span>/ {unitPrice.suffix}</span>
                      {disc2 > 0 && <span className="bdg b-rd">−{disc2}%</span>}
                    </div>
                    {bulkLine && <div style={{ fontSize:12, fontWeight:700, marginTop:4, color: bulkLine.startsWith('Опт') ? "var(--gr3)" : "var(--org)" }}>{bulkLine}</div>}
                    {outNow && <div style={{ fontSize:12, fontWeight:700, marginTop:4, color:"var(--red)" }}>Сейчас нет в наличии — уточним при сборке</div>}
                    {(itemBulk > 0 || itemSale > 0) && (
                      <div style={{ fontSize:12, color:"var(--gr3)", fontWeight:700, marginTop:4, display:"flex", flexWrap:"wrap", gap:8 }}>
                        {itemBulk > 0 && <span>Опт −{itemBulk.toFixed(2)} ЅМ</span>}
                        {itemSale > 0 && <span>Акция −{itemSale.toFixed(2)} ЅМ</span>}
                      </div>
                    )}
                    <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", gap:10, marginTop:10 }}>
                      <div>
                        {itemSaved > 0 && <div style={{ fontSize:12, color:"var(--t3)", textDecoration:"line-through" }}>{itemRetail.toFixed(2)} ЅМ</div>}
                        <span className="ub" style={{ fontSize:16, fontWeight:800, color:"var(--t1)" }}>{calcLineTotal(p, p.qty).toFixed(2)}<span style={{ fontSize:12, fontWeight:700, color:"var(--t2)", marginLeft:3 }}>ЅМ</span></span>
                      </div>
                      <div className="p-qty" style={{ width:"auto", minWidth:120, justifyContent:"space-between" }}>
                        <button type="button" onClick={() => atMin ? onDel(p.id) : onRm(p.id)} aria-label={atMin ? `Удалить «${p.name}»` : `Уменьшить количество «${p.name}»`}>
                          {atMin ? <Ic n="trash" s={15} c="var(--red)"/> : "−"}
                        </button>
                        <span>{isWeighted(p) ? formatCartQtyStepper(p, p.qty) : p.qty}</span>
                        <button type="button" onClick={() => onAdd(p.id)} aria-label={`Увеличить количество «${p.name}»`}>+</button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {items.length > 0 && (
        <div className="store-sticky-bar">
          <div style={{ marginBottom:10, padding:"12px", borderRadius:14, background:"var(--l3)", border:"1px solid var(--b1)" }}>
            {retailSub > sub && (
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"var(--t3)", marginBottom:6 }}>
                <span>Без скидок</span><span style={{ textDecoration:"line-through" }}>{retailSub.toFixed(2)} ЅМ</span>
              </div>
            )}
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:13 }}>
              <span style={{ color:"var(--t2)" }}>Товары ({tqty} поз.)</span>
              <span style={{ fontWeight:700, color:"var(--t1)" }}>{sub.toFixed(2)} ЅМ</span>
            </div>
            {bulkSaved > 0 && (
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"var(--gr3)", marginTop:4 }}>
                <span>Оптовая скидка</span><span style={{ fontWeight:700 }}>−{bulkSaved.toFixed(2)} ЅМ</span>
              </div>
            )}
            {saleSaved > 0 && (
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"var(--gr3)", marginTop:4 }}>
                <span>Скидка по акции</span><span style={{ fontWeight:700 }}>−{saleSaved.toFixed(2)} ЅМ</span>
              </div>
            )}
            <div style={{ display:"flex", justifyContent:"space-between", gap:10, fontSize:12, color:"var(--t2)", marginTop:4 }}>
              <span>Доставка</span>
              <span style={{ color:"var(--t2)", textAlign:"right" }}>Рассчитаем при оформлении после выбора адреса</span>
            </div>
            {totalSaved > 0 && (
              <div style={{ marginTop:8, padding:"8px 10px", borderRadius:10, background:"var(--gr-soft)", border:"1px solid rgba(7,136,61,.2)", fontSize:12, fontWeight:800, color:"var(--gr3)" }}>
                Вы сэкономили {totalSaved.toFixed(2)} ЅМ
              </div>
            )}
            <div style={{ height:1, background:"var(--b1)", margin:"10px 0 8px" }}/>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
              <span style={{ fontSize:13, fontWeight:700, color:"var(--t1)" }}>Итого</span>
              <span className="ub" style={{ fontSize:20, fontWeight:900, color:"var(--t1)" }}>{total.toFixed(2)} <span style={{ fontSize:12, fontWeight:700, color:"var(--t2)" }}>ЅМ</span></span>
            </div>
          </div>
          <button type="button" onClick={() => go("checkout")} className="btn store-btn store-btn-primary store-btn-block" style={{ minHeight:52 }}>
            <Ic n="bag" s={18} c="white"/>Оформить заказ · {tqty} поз.
          </button>
        </div>
      )}
      <Nav page="catalog" go={go} user={user}/>
    </div>
  );
};
const CHECKOUT_PAYS_BASE = [
  { id: 'cash', icon: '💵', label: 'Наличными', sub: 'Курьеру при получении' },
];
const CHECKOUT_TIMES = [
  { id: 'asap', l: 'Как можно скорее', s: 'Время доставки сообщим после сборки' },
];

function CheckoutField({ label, value, onChange, err }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 6, fontWeight: 700 }}>{label}</div>
      <input
        className={`inp ${err ? 'inp-err' : value ? 'inp-ok' : ''}`}
        value={value}
        onChange={onChange}
        style={{ width: '100%' }}
      />
      {err && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>{err}</div>}
    </div>
  );
}

function CheckoutRadio({ items, val, set }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map(m => (
        <div
          key={m.id}
          onClick={() => set(m.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 13,
            background: val === m.id ? 'var(--gr-soft)' : 'var(--l3)',
            border: `1.5px solid ${val === m.id ? 'var(--gr)' : 'var(--b1)'}`,
            cursor: 'pointer', transition: 'all .2s',
          }}
        >
          <div style={{
            width: 20, height: 20, borderRadius: '50%',
            border: `2px solid ${val === m.id ? 'var(--gr)' : 'var(--b2)'}`,
            background: val === m.id ? 'var(--gr)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            {val === m.id && <Ic n="check" s={10} c="var(--bg)" w={3} />}
          </div>
          {m.icon && <span style={{ fontSize: 20, flexShrink: 0 }}>{m.icon}</span>}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: val === m.id ? 'var(--gr)' : 'var(--t1)' }}>{m.l || m.label}</div>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 1 }}>{m.s || m.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CheckoutSec({ icon, color, title }) {
  return (
    <div className="ub" style={{ fontSize: 13, fontWeight: 800, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 26, height: 26, borderRadius: 7, background: `${color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Ic n={icon} s={13} c={color} />
      </div>
      {title}
    </div>
  );
}

const CheckoutPage = ({ go, cart, cartMeta = {}, onClearCart, user, setUser }: any) => {
  const { prods, restaurants } = useLiveCatalog();
  const createOrder = useOrders(s => s.createOrder);
  const [step,  setStep]  = useState("form");
  const [name,  setName]  = useState("");
  const [phone, setPhone] = useState("");
  const [addr,  setAddr]  = useState("");
  const [selectedSavedId, setSelectedSavedId] = useState(null);
  const [pay,   setPay]   = useState("cash");
  const [time,  setTime]  = useState("asap");
  const [useBonus, setUseBonus] = useState(false);
  const [errs,  setErrs]  = useState({});
  const [loading, setLoading] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const [orderId, setOrderId] = useState("");
  const [paidWithCredit, setPaidWithCredit] = useState(0);
  const [bonusSpent, setBonusSpent] = useState(0);
  const [checkoutMode, setCheckoutMode] = useState('market');
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [deliveryKm, setDeliveryKm] = useState(0);
  const [deliveryMin, setDeliveryMin] = useState(0);
  const [addrReady, setAddrReady] = useState(false);
  const [clientLat, setClientLat] = useState(0);
  const [clientLng, setClientLng] = useState(0);
  const [savedAddrs, setSavedAddrs] = useState([]);
  const [comment, setComment] = useState("");
  const [addrEditorOpen, setAddrEditorOpen] = useState(false);
  const [addrEditorEdit, setAddrEditorEdit] = useState(null);
  const [addrEditorSession, setAddrEditorSession] = useState(0);
  const checkoutFooterRef = useRef(null);
  const submitLockRef = useRef(false);
  const orderSubmitClientRef = useRef<string | null>(null);
  const [checkoutFooterPad, setCheckoutFooterPad] = useState(160);

  useLayoutEffect(() => {
    const el = checkoutFooterRef.current;
    if (!el) return;
    const sync = () => setCheckoutFooterPad(el.offsetHeight + 24);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [step]);

  const clientPhone = user?.phone || getActiveClientPhone(user);

  const selectedSavedAddr = useMemo(
    () => (selectedSavedId != null ? savedAddrs.find(a => a.id === selectedSavedId) : null),
    [savedAddrs, selectedSavedId],
  );

  const fullAddrLine = useMemo(
    () => selectedSavedAddr
      ? formatClientAddressLine(selectedSavedAddr)
      : addr.trim(),
    [selectedSavedAddr, addr],
  );

  // Загрузить сохранённые адреса + автозаполнить адрес по умолчанию (только для текущего аккаунта)
  useEffect(() => {
    if (!clientPhone) {
      setSavedAddrs([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        migrateLegacyClientData(clientPhone);
        let list = loadClientAddresses(clientPhone);
        if (!list.length && user?.addr?.trim()) {
          const imported = await ensureClientDefaultAddress(clientPhone, user.addr);
          if (imported) list = [imported];
        }
        if (cancelled) return;
        if (list.length) setSavedAddrs(list);
        const def = list.find(a => a.def) || list[0];
        if (def) {
          setSelectedSavedId(def.id);
          setAddr(def.street || "");
          if (def.lat != null && def.lng != null) {
            setClientLat(def.lat);
            setClientLng(def.lng);
          }
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [clientPhone, user?.addr]);

  useEffect(() => {
    if (user?.name && !name) setName(user.name)
    if (user?.phone && !phone) {
      setPhone(user.phone.replace(/^\+992\s?/, '').trim())
    }
  }, [user, name, phone])

  const pickSavedAddr = (a) => {
    setSelectedSavedId(a.id);
    setAddr(a.street || "");
    setErrs(prev => ({ ...prev, addr: undefined }));
    resetDelivery();
    if (a.lat != null && a.lng != null) {
      setClientLat(a.lat);
      setClientLng(a.lng);
    }
  };

  const openCheckoutAddrEditor = (editEntry = null) => {
    setAddrEditorEdit(editEntry);
    setAddrEditorSession(s => s + 1);
    setAddrEditorOpen(true);
  };

  const handleCheckoutAddrSaved = (entry) => {
    if (!clientPhone) return;
    const list = loadClientAddresses(clientPhone);
    setSavedAddrs(list);
    pickSavedAddr(entry);
  };

  const items = buildCartLineItems(cart, cartMeta, prods);
  const prodItems = items.filter(p => !p.isRest);
  const restItems = items.filter(p => p.isRest);
  const bulkSaved = prodItems.reduce((s, p) => s + lineBulkSavings(p, p.qty), 0);
  const saleSaved = prodItems.reduce((s, p) => s + lineSaleSavings(p, p.qty), 0);
  const totalSaved = Math.round((bulkSaved + saleSaved) * 100) / 100;
  const sub = items.reduce((s, p) => s + calcLineTotal(p, p.qty), 0);
  const weightKg = estimateCartWeightKg(prodItems.map(p => ({ p, qty: p.qty })));
  const pickupIds = resolveCheckoutPickupIds({
    hasMarketItems: prodItems.length > 0,
    restIds: [...new Set(restItems.map(r => r.restId).filter(Boolean))],
  });
  const total = sub;
  const credit = useMemo(() => getVipCreditState(user), [user?.vip, user?.debt, user?.debtLimit, user?.debtEnabled, user?.level, user?.bonus, user?.blocked]);
  const useCreditPay = pay === 'credit';
  const effectiveDelivery = deliveryFee;
  const orderTotal = sub + effectiveDelivery;
  const bonusUsable = STORE_BONUS_CREDIT_ENABLED && useBonus ? getBonusUsable(user, sub) : 0;
  const payable = Math.max(0, Math.round((orderTotal - bonusUsable) * 100) / 100);
  const creditGoods = useCreditPay ? Math.max(0, Math.round((payable - effectiveDelivery) * 100) / 100) : 0;

  const payOptions = useMemo(() => {
    const opts = [...CHECKOUT_PAYS_BASE];
    if (STORE_BONUS_CREDIT_ENABLED && credit.enabled && credit.available > 0) {
      opts.push({
        id: 'credit',
        icon: '👑',
        label: 'VIP-кредит',
        sub: `В долг · доступно ${credit.available.toLocaleString()} ЅМ`,
      });
    }
    return opts;
  }, [credit.enabled, credit.available]);

  useEffect(() => {
    if (pay === 'credit' && !payOptions.some(p => p.id === 'credit')) setPay('cash');
    if (pay === 'card') setPay('cash');
  }, [pay, payOptions]);

  const resetDelivery = () => {
    setAddrReady(false);
    setDeliveryFee(0);
    setDeliveryKm(0);
    setDeliveryMin(0);
    setClientLat(0);
    setClientLng(0);
  };

  const validate = () => {
    const e = {};
    if (!name.trim()) e.name = "Введите имя";
    if (!phone.trim()) e.phone = "Введите телефон";
    if (!addr.trim()) e.addr = "Введите адрес";
    else if (!addrReady || !clientLat || !clientLng) {
      e.addr = "Подтвердите точку на карте — без неё доставка не рассчитается";
    }
    setErrs(e);
    return !Object.keys(e).length;
  };
  const submit = async () => {
    if (submitLockRef.current || loading) return;
    if (!validate()) return;
    if (pay === 'credit') {
      const check = canPayWithCredit(user, creditGoods);
      if (!check.ok) {
        setSubmitErr(check.reason || 'VIP-кредит недоступен');
        return;
      }
    }
    submitLockRef.current = true;
    setLoading(true);
    setSubmitErr("");
    if (!orderSubmitClientRef.current) orderSubmitClientRef.current = newClientRef();

    const hasMarket = prodItems.length > 0;
    const hasRest = restItems.length > 0;
    const orderType = hasMarket && hasRest ? 'mixed' : hasRest ? 'restaurant' : 'market';
    const restIds = [...new Set(restItems.map(r => r.restId).filter(Boolean))];

    const payload = {
      type: orderType,
      client: { name, phone, addr: fullAddrLine, lat: clientLat, lng: clientLng },
      items: [
        ...prodItems.map(p => orderItemFromProduct(p, p.qty)),
        ...restItems.map(p => {
          const menuIdMatch = String(p.id).match(/^R[^_]+_(\d+)$/)
          const menuId = menuIdMatch ? Number(menuIdMatch[1]) : undefined
          return {
            name: p.name || 'Блюдо',
            e: p.e || '🍽',
            qty: p.qty,
            unit: 'порция',
            price: Number(p.price) || 0,
            source: 'restaurant',
            restId: p.restId,
            photo: resolvePhotoUrl(p.photo as string | undefined),
            ...(menuId ? { id: menuId } : {}),
            cartLineId: String(p.id),
          }
        }),
      ],
      total: Number(payable.toFixed(2)),
      goodsTotal: Number(sub.toFixed(2)),
      deliveryFee: effectiveDelivery,
      pickupIds,
      distanceKm: deliveryKm > 0 ? Number(deliveryKm.toFixed(2)) : undefined,
      durationMin: deliveryMin > 0 ? Math.round(deliveryMin) : undefined,
      weightKg: Number(weightKg.toFixed(1)),
      restIds,
      restId: restIds[0],
      restName: restIds[0] ? restaurants.find(r => r.id === restIds[0])?.name : undefined,
      comment: [
        pay === 'credit' ? 'VIP-кредит: товары в долг, доставка наличными' : bonusUsable > 0 ? `Списано бонусов: ${bonusUsable}` : '',
        selectedSavedAddr?.comment?.trim(),
        comment.trim(),
      ].filter(Boolean).join(' · '),
      payment_method: pay,
      pay,
      creditAmount: useCreditPay ? creditGoods : undefined,
      vip: !!user?.vip,
      bonusSpent: bonusUsable > 0 ? bonusUsable : 0,
      clientRef: orderSubmitClientRef.current,
    };

    let order = null;
    let errMsg = '';
    try {
      order = await createOrder(payload);
    } catch (e) {
      errMsg = e instanceof Error ? e.message : 'Не удалось оформить заказ. Проверьте интернет и попробуйте снова.';
    }

    if (order) {
      setOrderId(order.id);
      setCheckoutMode(orderType);
      setPaidWithCredit(pay === 'credit' ? creditGoods : 0);
      setBonusSpent(bonusUsable);
      try { localStorage.setItem('kakapo_client_phone', phone); } catch { /* private mode */ }
      setStep('ok');
      onClearCart?.();

      const ph = user?.phone || formatTjPhone(phone);
      const bonusToSpend = bonusUsable;
      const creditToCharge = useCreditPay ? creditGoods : 0;
      const payMode = pay;
      const orderItems = items;
      void (async () => {
        try {
          if (bonusToSpend > 0 && !USE_API) await spendBonus(ph, bonusToSpend, order.id);
          if (payMode === 'credit' && creditToCharge > 0) {
            const names = orderItems.slice(0, 2).map(p => p.name || 'Товар')
            const itemsSummary = names.length
              ? `${names.join(', ')}${orderItems.length > 2 ? ` + ещё ${orderItems.length - 2}` : ''}`
              : undefined
            await chargeCredit(ph, creditToCharge, order.id, { itemsSummary })
          }
          if (setUser) {
            const fresh = await refreshStoreUserAfterCredit(ph, user?.card);
            if (fresh) {
              saveStoreUser({ ...user, ...fresh });
              setUser({ ...user, ...fresh });
            }
          }
        } catch (creditErr) {
          console.error(creditErr);
        }
      })();
    } else {
      submitLockRef.current = false;
      setLoading(false);
      setSubmitErr(errMsg || 'Не удалось оформить заказ. Проверьте интернет и попробуйте снова.');
    }
  };

  if (step === "ok") return (
    <div data-store-page style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:'var(--store-w)', margin:"0 auto", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"32px 24px", textAlign:"center" }}>
      <div style={{ width:90, height:90, borderRadius:"50%", background:"var(--gr)", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"none", marginBottom:24, animation:"successPop .6s cubic-bezier(.16,1,.3,1)" }}>
        <Ic n="check" s={44} c="white" w={2.5}/>
      </div>
      <div className="ub" style={{ fontSize:24, fontWeight:900, marginBottom:6 }}>Заказ принят!</div>
      <div style={{ fontSize:13, color:"var(--t2)", marginBottom:6 }}>Заказ <span className="ub" style={{ color:"var(--gr)" }}>{orderId || '…'}</span> оформлен</div>
      <div style={{ fontSize:13, color:"var(--t2)", marginBottom:28 }}>
        {checkoutMode === 'mixed'
          ? 'Один заказ: сборщик соберёт товары, ресторан приготовит блюда. Курьер заберёт всё, когда обе части будут готовы.'
          : checkoutMode === 'restaurant'
            ? 'Ресторан готовит заказ. Когда блюда будут готовы — назначат курьера. Отслеживание появится когда курьер примет заказ.'
            : 'Сначала соберут заказ, затем назначат курьера. Отслеживание появится когда курьер примет заказ.'}
      </div>
      <div style={{ width:"100%", background:"var(--l2)", border:"1px solid var(--b1)", borderRadius:20, padding:"18px", marginBottom:20 }}>
        {[{icon:"bag",l:"Номер заказа",v:orderId||"—",c:"var(--gr)"},{icon:"clock",l:"Доставка",v:deliveryMin > 0 ? `в пути ~${Math.round(deliveryMin)} мин после сборки` : "Сообщим после сборки",c:"var(--gd)"},{icon:"map",l:"Адрес",v:addr||"—",c:"var(--sky)"},{icon:"card",l:"Оплата",v:paidWithCredit > 0 ? `VIP-долг ${paidWithCredit.toFixed(2)} ЅМ` + (bonusSpent > 0 ? ` · бонусы −${bonusSpent}` : '') : bonusSpent > 0 ? `Бонусы −${bonusSpent}` : "При получении",c:"var(--gd)"}].map((r,i) => (
          <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom:i<3?"1px solid var(--b1)":"none" }}>
            <div style={{ width:30, height:30, borderRadius:8, background:`${r.c}18`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Ic n={r.icon} s={14} c={r.c}/></div>
            <span style={{ fontSize:12, color:"var(--t2)", flex:1 }}>{r.l}</span>
            <span style={{ fontSize:12, fontWeight:700, color:r.c }}>{r.v}</span>
          </div>
        ))}
      </div>
      <button onClick={() => go("orders")} className="btn" style={{ width:"100%", padding:"15px", fontSize:14, borderRadius:17, background:"var(--gr)", color:"white", marginBottom:10 }}>Мои заказы</button>
      <button onClick={() => go("home")} className="btn" style={{ width:"100%", padding:"14px", fontSize:13, borderRadius:17, background:"var(--l2)", border:"1px solid var(--b1)", color:"var(--t2)" }}>На главную</button>
    </div>
  );

  return (
    <div data-store-page style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:'var(--store-w)', margin:"0 auto" }}>
      <header data-store-header style={{ position:"sticky", top:0, zIndex:100, background:"var(--header-bg)", backdropFilter:"blur(24px)", borderBottom:"1px solid var(--b1)" }}>
        <div style={{ padding:"14px 18px 13px", display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={() => storeBack("cart", go)} className="btn" style={{ width:38, height:38, borderRadius:12, background:"var(--l3)", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div className="ub" style={{ flex:1, fontSize:16, fontWeight:900 }}>Оформление заказа</div>
        </div>
      </header>
      <div style={{ padding:`14px 18px ${checkoutFooterPad}px` }}>
        <div className="card" style={{ padding:"18px", marginBottom:13 }}>
          <CheckoutSec icon="bag" color="var(--gr)" title={`Ваш заказ · ${ruCount(items.length, "позиция", "позиции", "позиций")}`}/>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {items.map((it, i) => (
              <div key={it.id || i} style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:36, height:36, borderRadius:10, background:"var(--l3)", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0, overflow:"hidden" }}>
                  {it.photo ? <img src={it.photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : (it.e || "🛒")}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:700, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{it.name}</div>
                  <div style={{ fontSize:11, color:"var(--t2)" }}>{isWeighted(it) ? formatCartQty(it, it.qty) : `× ${it.qty}`}</div>
                </div>
                <div className="ub" style={{ fontSize:13, fontWeight:800, flexShrink:0 }}>{calcLineTotal(it, it.qty).toFixed(2)} ЅМ</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card" style={{ padding:"18px", marginBottom:13 }}>
          <CheckoutSec icon="user" color="var(--gr)" title="Получатель"/>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <CheckoutField
              label="Имя и фамилия *"
              value={name}
              onChange={e => { setName(e.target.value); setErrs(p => ({ ...p, name: undefined })); }}
              err={errs.name}
            />
            <CheckoutField
              label="Номер телефона *"
              value={phone}
              onChange={e => { setPhone(e.target.value); setErrs(p => ({ ...p, phone: undefined })); }}
              err={errs.phone}
            />
          </div>
        </div>
        <div className="card" style={{ padding:"18px", marginBottom:13 }}>
          <CheckoutSec icon="map" color="var(--sky)" title="Адрес доставки"/>
          {savedAddrs.length > 0 ? (
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, color:"var(--t2)", marginBottom:8, fontWeight:700 }}>Сохранённые адреса</div>
              <div className="hscroll" style={{ gap:8 }}>
                {savedAddrs.map(a => {
                  const line = formatClientAddressLine(a);
                  const active = selectedSavedId === a.id;
                  return (
                    <div key={a.id} style={{ flexShrink: 0, position: 'relative' }}>
                      <button onClick={() => pickSavedAddr(a)} className="btn"
                        style={{ padding:"10px 14px", paddingRight: 36, borderRadius:12, textAlign:"left",
                          border:`1.5px solid ${active ? "var(--gr)" : "var(--b1)"}`,
                          background: active ? "var(--gr-soft)" : "var(--l2)", minWidth:140 }}>
                        <div style={{ fontSize:12, fontWeight:800, color: active ? "var(--gr)" : "var(--t1)", marginBottom:2 }}>{a.label}</div>
                        <div style={{ fontSize:11, color:"var(--t2)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:160 }}>{line}</div>
                      </button>
                      <button
                        type="button"
                        title="Изменить адрес"
                        onClick={(e) => { e.stopPropagation(); pickSavedAddr(a); openCheckoutAddrEditor(a); }}
                        className="btn"
                        style={{
                          position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 8,
                          background: 'var(--l3)', border: '1px solid var(--b1)', fontSize: 11, lineHeight: 1,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t2)',
                        }}
                      >
                        ✏️
                      </button>
          </div>
                  );
                })}
        </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={() => openCheckoutAddrEditor(null)} className="btn"
                  style={{ flex: 1, minWidth: 120, padding: "8px 12px", borderRadius: 10, fontSize: 11, fontWeight: 700, background: "var(--gr-soft)", border: "1px solid rgba(7,136,61,.3)", color: "var(--gr)" }}>
                  + Добавить адрес
                </button>
                {selectedSavedAddr && (
                  <button type="button" onClick={() => openCheckoutAddrEditor(selectedSavedAddr)} className="btn"
                    style={{ flex: 1, minWidth: 120, padding: "8px 12px", borderRadius: 10, fontSize: 11, fontWeight: 700, background: "var(--l3)", border: "1px solid var(--b1)", color: "var(--t2)" }}>
                    ✏️ Изменить выбранный
                  </button>
                )}
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => openCheckoutAddrEditor(null)} className="btn"
              style={{ width: "100%", marginBottom: 12, padding: "12px 14px", borderRadius: 12, fontSize: 13, fontWeight: 700, background: "var(--gr-soft)", border: "1.5px solid rgba(7,136,61,.3)", color: "var(--gr)" }}>
              + Добавить адрес на карте
            </button>
          )}
          <div style={{ fontSize:11, color:"var(--t2)", marginBottom:8, fontWeight:700 }}>
            {selectedSavedAddr ? "Точка доставки" : "Улица, дом *"}
          </div>
          <GeoAddressPicker
            key={selectedSavedId != null ? `saved-${selectedSavedId}` : "manual-addr"}
            value={addr}
            initialCoords={clientLat && clientLng ? { lat: clientLat, lng: clientLng } : null}
            hideChangeAddress={!!selectedSavedAddr}
            onChange={v => {
              setSelectedSavedId(null);
              setAddr(v);
              resetDelivery();
              setErrs(prev => ({ ...prev, addr: undefined }));
            }}
            onClear={resetDelivery}
            weightKg={weightKg}
            orderAmount={sub}
            pickupIds={pickupIds}
            onPriceChange={(price, dist, meta) => {
              setDeliveryFee(price.total);
              setDeliveryKm(dist);
              setDeliveryMin(meta.durationMin);
              setClientLat(meta.lat);
              setClientLng(meta.lng);
              setAddrReady(true);
            }}
          />
          {selectedSavedAddr && (selectedSavedAddr.apt || selectedSavedAddr.floor || selectedSavedAddr.ent) && (
            <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 10, background: "var(--l2)", border: "1px solid var(--b1)", fontSize: 11, color: "var(--t2)", lineHeight: 1.45 }}>
              {[
                selectedSavedAddr.apt?.trim() && `кв. ${selectedSavedAddr.apt.trim()}`,
                selectedSavedAddr.floor?.trim() && `этаж ${selectedSavedAddr.floor.trim()}`,
                selectedSavedAddr.ent?.trim() && `подъезд ${selectedSavedAddr.ent.trim()}`,
              ].filter(Boolean).join(" · ")}
              <span style={{ color: "var(--t3)" }}> · из профиля</span>
            </div>
          )}
          {selectedSavedAddr?.comment?.trim() && (
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--t3)", lineHeight: 1.4 }}>
              💬 {selectedSavedAddr.comment.trim()}
            </div>
          )}

          {errs.addr && <div style={{ fontSize:11, color:"var(--red)", marginTop:6 }}>{errs.addr}</div>}
        </div>
        {CHECKOUT_TIMES.length > 1 && (
        <div className="card" style={{ padding:"18px", marginBottom:13 }}>
          <CheckoutSec icon="clock" color="var(--gd)" title="Время доставки"/>
          <CheckoutRadio items={CHECKOUT_TIMES} val={time} set={setTime}/>
        </div>
        )}
        <div className="card" style={{ padding:"18px", marginBottom:13 }}>
          <CheckoutSec icon="card" color="var(--blue)" title="Оплата"/>
          <CheckoutRadio items={payOptions} val={pay} set={setPay}/>
          {pay === 'credit' && (
            <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 12, background: 'rgba(233,174,0,.14)', border: '1px solid rgba(233,174,0,.25)', fontSize: 11, color: 'var(--t2)', lineHeight: 1.5 }}>
              Товары {creditGoods.toFixed(2)} ЅМ — в долг на VIP-карту. Доставка {effectiveDelivery.toFixed(2)} ЅМ — наличными курьеру. Остаток лимита: {(credit.available - creditGoods).toLocaleString()} ЅМ
        </div>
          )}
        </div>
        {STORE_BONUS_CREDIT_ENABLED && (user?.bonus || 0) > 0 && (
        <div className="card" style={{
          padding:"16px", marginBottom:13, display:"flex", alignItems:"center", justifyContent:"space-between",
          background: useBonus ? 'rgba(233,174,0,.12)' : 'rgba(233,174,0,.06)',
          border: `1px solid ${useBonus ? 'rgba(233,174,0,.35)' : 'rgba(233,174,0,.2)'}`,
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:22 }}>⭐</span>
            <div>
              <div style={{ fontSize:14, fontWeight:800, color:'var(--t1)' }}>Списать бонусы</div>
              <div style={{ fontSize:12, marginTop:4, color:'var(--t2)', lineHeight:1.45 }}>
                Баланс:{' '}
                <span style={{ color:'var(--t2)', fontWeight:800 }}>{(user.bonus || 0).toLocaleString()}</span>
                {' · '}можно списать до{' '}
                <span style={{ color:'var(--gr)', fontWeight:800 }}>−{getBonusUsable(user, sub)} ЅМ</span>
          </div>
        </div>
      </div>
          <div className={`toggle ${useBonus?"on":""}`} onClick={() => setUseBonus(v => !v)}><div className="toggle-dot"/></div>
      </div>
        )}
    </div>
        <div className="card" style={{ padding:"18px", marginBottom:13 }}>
          <CheckoutSec icon="bag" color="var(--gr)" title="Комментарий к заказу"/>
          <label className="store-label" htmlFor="checkout-comment">Курьеру или сборщику (необязательно)</label>
          <textarea
            id="checkout-comment"
            className="inp"
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={3}
            maxLength={400}
            placeholder="Например: позвоните перед приездом"
            style={{ width:"100%", resize:"vertical", minHeight:88, lineHeight:1.5 }}
          />
        </div>
      <div ref={checkoutFooterRef} className="store-sticky-bar store-sticky-nonav" style={{ padding:"13px 16px calc(16px + env(safe-area-inset-bottom, 0px))" }}>
        {items.length > 0 && (
          <div style={{ marginBottom:10, padding:"10px 12px", borderRadius:12, background:"var(--l2)", border:"1px solid var(--b1)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom: bonusUsable > 0 || effectiveDelivery > 0 ? 6 : 0 }}>
              <span style={{ color: 'var(--t2)' }}>Товары</span>
              <span>{sub.toFixed(2)} ЅМ</span>
      </div>
            {bulkSaved > 0 && (
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom: 6, color: 'var(--gr)' }}>
                <span>Оптовая скидка</span>
                <span>−{bulkSaved.toFixed(2)} ЅМ</span>
      </div>
            )}
            {saleSaved > 0 && (
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom: 6, color: 'var(--gr)' }}>
                <span>Скидка по акции</span>
                <span>−{saleSaved.toFixed(2)} ЅМ</span>
      </div>
            )}
            {totalSaved > 0 && (
              <div style={{ fontSize:11, color:'var(--gr)', fontWeight:700, marginBottom: 6 }}>🎉 Сэкономили {totalSaved.toFixed(2)} ЅМ</div>
            )}
            {effectiveDelivery > 0 && (
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom: 6 }}>
                <span style={{ color: 'var(--t2)' }}>Доставка</span>
                <span>{effectiveDelivery.toFixed(2)} ЅМ</span>
      </div>
            )}
            {bonusUsable > 0 && (
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, marginBottom: 6, fontWeight:700 }}>
                <span style={{ color: 'var(--t2)' }}>⭐ Бонусы</span>
                <span style={{ color: 'var(--gr)' }}>−{bonusUsable} ЅМ</span>
    </div>
            )}
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:14, fontWeight:800, paddingTop: bonusUsable > 0 || effectiveDelivery > 0 ? 6 : 0, borderTop: bonusUsable > 0 || effectiveDelivery > 0 ? '1px solid var(--b1)' : 'none' }}>
              <span>{pay === 'credit' ? (effectiveDelivery > 0 ? '💵 Доставка + 👑 в долг' : '👑 В кредит') : '💵 К оплате'}</span>
              <span className="ub" style={{ color:"var(--t2)" }}>{payable.toFixed(2)} ЅМ</span>
      </div>
      </div>
        )}
        {prodItems.length > 0 && restItems.length > 0 && (
          <div style={{ marginBottom:10, padding:"10px 12px", borderRadius:12, background:"rgba(37,99,235,.08)", border:"1px solid rgba(37,99,235,.2)", fontSize:12, color:"var(--t2)", textAlign:"center" }}>
            📦 Один заказ · сборщик соберёт товары, ресторан приготовит блюда
      </div>
        )}
        {submitErr && (
          <div style={{ marginBottom:10, padding:"10px 12px", borderRadius:12, background:"var(--red-soft)", border:"1px solid rgba(195,52,52,.3)", fontSize:12, color:"var(--red)", textAlign:"center" }}>
            ⚠️ {submitErr}
          </div>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={loading}
          className="btn"
          style={{
            width:"100%", padding:"15px", fontSize:15, borderRadius:17,
            background: loading ? "var(--l3)" : "var(--gr)",
            color:"white", display:"flex", alignItems:"center", justifyContent:"center", gap:10,
            opacity: loading ? 0.85 : 1, cursor: loading ? "not-allowed" : "pointer",
            pointerEvents: loading ? "none" : "auto",
          }}
        >
          {loading ? <div style={{ width:18, height:18, borderRadius:"50%", border:"2.5px solid rgba(255,255,255,.3)", borderTopColor:"white", animation:"spin 1s linear infinite" }}/> : <><Ic n="check" s={19} c="white" w={2.5}/>{addrReady ? `Подтвердить · ${payable.toFixed(2)} ЅМ` : "Подтвердить заказ"}</>}
      </button>
      </div>
      <ClientAddressEditorSheet
        open={addrEditorOpen}
        onClose={() => { setAddrEditorOpen(false); setAddrEditorEdit(null); }}
        onSaved={handleCheckoutAddrSaved}
        clientPhone={clientPhone || ''}
        editEntry={addrEditorEdit}
        sessionKey={addrEditorSession}
      />
    </div>
  );
};

function StoreSessionBoot() {
  return (
    <div data-store-page style={{ minHeight: "100vh", background: "var(--bg)", maxWidth:'var(--store-w)', margin: "0 auto" }} />
  );
}

function CartPageBoot({ go }: { go: (p: string) => void }) {
  return (
    <div data-store-page style={{ minHeight: "100vh", background: "var(--bg)", maxWidth:'var(--store-w)', margin: "0 auto" }}>
      <header data-store-header style={{ position: "sticky", top: 0, zIndex: 100, background: "var(--header-bg)", backdropFilter: "blur(24px)", borderBottom: "1px solid var(--b1)" }}>
        <div style={{ padding: "14px 18px 13px", display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => storeBack("home", go)} className="btn" style={{ width: 44, height: 44, borderRadius: 12, background: "var(--l3)", border: "1px solid var(--b1)", display: "flex", alignItems: "center", justifyContent: "center" }}><Ic n="arrL" s={17} c="var(--t2)" /></button>
          <div style={{ flex: 1 }}>
            <div className="ub" style={{ fontSize: 17, fontWeight: 900 }}>Корзина</div>
            <div style={{ fontSize: 10, color: "var(--t2)", marginTop: 1 }}>Загрузка…</div>
      </div>
      </div>
      </header>
      <div style={{ padding: "48px 24px", textAlign: "center" }}>
        <div style={{ width: 36, height: 36, margin: "0 auto", borderRadius: "50%", border: "3px solid rgba(7,136,61,.2)", borderTopColor: "var(--gr)", animation: "spin 0.8s linear infinite" }} />
      </div>
    </div>
  );
}

const ProfilePage = ({ go, user, setUser, onLogout, wished, showToast, sessionReady }: any) => {
  const apiOrders = useOrders(s => s.orders);
  const trackClientOrders = useOrders(s => s.trackClientOrders);
  const pendingBonusSyncCount = useMemo(
    () => (user?.phone ? deliveredOrdersNeedingBonusSync(user.phone, apiOrders).length : 0),
    [user?.phone, apiOrders],
  );
  const bonusBank = (Math.round(Math.max(0, Number(user?.bonus) || 0) * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
  const [reviewStats, setReviewStats] = useState({ count: 0, withReplies: 0 });
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cardQrOpen, setCardQrOpen] = useState(false);

  const orderCount = useMemo(() => countClientOrders(apiOrders, user), [apiOrders, user?.phone]);
  const spentTotal = useMemo(() => countClientSpent(apiOrders, user), [apiOrders, user?.phone]);
  const addrCount = useMemo(() => loadClientAddresses(user?.phone).length, [user?.phone]);
  const wishCount = useMemo(
    () => Object.keys(wished || {}).filter(id => wished[id]).length,
    [wished],
  );
  const loyalty = useMemo(
    () => getLoyaltyProgress(spentTotal, orderCount, reviewStats.count, user?.level, user?.vip, user?.loyaltyPeriod, loyaltyLockFromRecord(user, user?.level)),
    [spentTotal, orderCount, reviewStats.count, user?.level, user?.vip, user?.loyaltyPeriod, user?.levelAssignMode, user?.levelValidUntil, user?.levelLockedPeriod, user?.vipUntil],
  );

  useEffect(() => {
    if (!user?.phone || !setUser) return
    let cancelled = false
    const phone = user.phone
    const card = user.card
    const epoch = getSessionEpoch()

    const refreshProfile = () => fetchCrmStoreUser(phone, card).then(next => {
      if (cancelled || getSessionEpoch() !== epoch || !isClientSessionActive()) return
      const stored = loadStoreUser()
      if (!stored || phoneDigits(stored.phone) !== phoneDigits(phone)) return
      if (!next) return
      const merged = mergeCrmIntoStoreUser(stored, next)
      if (!crmStoreUsersEqual(stored, merged)) {
        saveStoreUser(merged)
        setUser(merged)
      }
    }).catch(() => {})

    const orders = useOrders.getState().orders

    void (async () => {
      if (USE_API) await trackClientOrders(phone).catch(() => {})
      const freshOrders = USE_API ? useOrders.getState().orders : orders
      const skipLoyaltyRecalc = isManualLoyaltyActive(user, user?.level)
      if (!skipLoyaltyRecalc) {
        await syncLoyaltyBonuses(phone, freshOrders)
      }
      if (cancelled) return
      await refreshProfile()
    })()

    return () => { cancelled = true }
  }, [user?.phone, user?.card, pendingBonusSyncCount, setUser, trackClientOrders])

  useEffect(() => {
    const phone = getActiveClientPhone(user);
    const refreshNotifs = () => setUnreadNotifs(getUnreadNotificationCount(!USE_API, phone));
    refreshNotifs();
    const unsub = subscribeClientNotifications(refreshNotifs);
    const unsubCh = subscribeNotificationChannel(refreshNotifs);
    return () => { unsub(); unsubCh(); };
  }, [user?.phone]);

  useEffect(() => {
    if (!user) return;
    if (!USE_API) {
      const list = Object.values(loadLocalReviews(user.phone));
      setReviewStats({
        count: list.length,
        withReplies: list.filter(r => r.adminReply || r.restReply).length,
      });
      return;
    }
    loadClientReviewMap(apiOrders, user).then(map => {
      const list = Object.values(map);
      setReviewStats({
        count: list.length,
        withReplies: list.filter(r => r.adminReply || r.restReply).length,
      });
    }).catch(() => {});
  }, [apiOrders, user]);

  if (!sessionReady) return <StoreSessionBoot />;

  if (!user) return (
    <div data-store-page style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:'var(--store-w)', margin:"0 auto" }}>
      <Header title="Профиль" go={go} cart={{}} user={user} hideSearch/>
      <div className="store-page-pad" style={{ padding:"20px 16px 0" }}>
        <div className="card" style={{ padding:"26px 20px", textAlign:"center" }}>
          <div style={{ fontSize:52, marginBottom:12, animation:"float 3s ease-in-out infinite" }} aria-hidden="true">👤</div>
          <div className="ub" style={{ fontSize:18, fontWeight:800, marginBottom:8 }}>Войдите в аккаунт</div>
          <div style={{ fontSize:13, color:"var(--t2)", marginBottom:20, lineHeight:1.6 }}>Войдите по номеру телефона — бонусы, заказы и персональные предложения</div>
          <button type="button" onClick={() => go("auth")} className="btn store-btn store-btn-primary" style={{ width:"100%", padding:"14px 20px", fontSize:14 }}>
            <Ic n="phone" s={16} c="#fff"/> Войти по номеру телефона
          </button>
        </div>
        <div className="store-sec-head"><div className="ub store-sec-title">Доступно без входа</div></div>
        <div className="store-tile-grid">
          {[
            { l: "Каталог", e: "🛒", to: "catalog" },
            { l: "Акции", e: "%", to: "promos" },
            { l: "Рестораны", e: "🍽", to: "restaurants" },
            { l: "О нас", e: "ℹ️", to: "about" },
          ].map(x => (
            <button key={x.to} type="button" className="btn cat-tile" style={{ flex:"unset", background:"var(--l2)" }} onClick={() => go(x.to)}>
              <span className="cat-tile-media"><span className="cat-tile-emoji" aria-hidden="true">{x.e}</span></span>
              <span className="cat-tile-label">{x.l}</span>
            </button>
          ))}
        </div>
      </div>
      <Nav page="profile" go={go} user={user}/>
    </div>
  );

  const profileLevel = isManualLoyaltyActive(user, user?.level ?? 'basic')
    ? (user?.level ?? 'basic')
    : loyalty.level
  const profileLoyalty = profileLevel !== loyalty.level
    ? {
      ...loyalty,
      level: profileLevel,
      tier: LOYALTY_TIERS.find(t => t.id === profileLevel) || loyalty.tier,
      isBasicClient: profileLevel === 'basic' && !loyalty.isVip,
    }
    : loyalty
  const profileTheme = (() => {
    const th = getTierThemes()
    return profileLoyalty.isVip ? th.vip : profileLoyalty.isBasicClient ? th.basic : (th[profileLoyalty.tier.id] || th.bronze)
  })()
  const profileTierId = profileLoyalty.isVip ? 'vip' : profileLoyalty.isBasicClient ? 'basic' : profileLoyalty.tier.id
  const cardAccent = profileCardAccent(profileTheme);

  const debtNow = Math.max(0, Number(user?.debt) || 0)
  // Раздел «Долги» в профиле только если: есть долг из магазина, админ включил раздел, или статус (VIP) сам открывает долг
  const debtSectionOn = debtNow > 0.001
    || (user?.levelAssignMode === 'manual'
      ? !!user?.debtEnabled
      : (qualifiesForDebtSection(user?.level, user?.vip) || !!user?.debtEnabled))
  const menuItems = [
    {
      icon: "crown", l: loyalty.isVip ? "VIP профиль" : "VIP программа", c: "var(--gd)", to: "vip",
      s: loyalty.isVip ? "Привилегии и кредитный лимит" : loyalty.isBasicClient ? "Нет привилегий · путь к VIP" : `Выполнено ${loyalty.vipDoneCount} из 3 условий`,
      badge: loyalty.isVip ? "VIP" : undefined,
    },
    ...(debtSectionOn ? [{
      icon: "card", l: "Долги", c: debtNow > 0 ? "var(--red)" : "var(--gd)", to: "debts",
      s: debtNow > 0 ? `Сейчас ${debtNow.toLocaleString()} ЅМ` : "История и кредитный лимит",
      badge: debtNow > 0 ? "долг" : undefined,
    }] : []),
    {
      icon: "bag", l: "Мои заказы", c: "var(--gr)", to: "orders",
      s: orderCount ? ruCount(orderCount, "заказ", "заказа", "заказов") : "Пока нет заказов",
    },
    {
      icon: "bell", l: "Уведомления", c: "var(--blue)", to: "notifs",
      s: unreadNotifs ? `${unreadNotifs} новых` : "Нет новых",
      badge: unreadNotifs || undefined,
    },
    {
      icon: "star", l: "Отзывы", c: "var(--gd)", to: "reviews",
      s: reviewStats.count
        ? `${ruCount(reviewStats.count, "отзыв", "отзыва", "отзывов")}${reviewStats.withReplies ? " · есть ответы" : ""}`
        : "После доставки заказа",
      badge: reviewStats.withReplies || undefined,
    },
    {
      icon: "map", l: "Адреса доставки", c: "var(--sky)", to: "addresses",
      s: addrCount ? ruCount(addrCount, "адрес", "адреса", "адресов") : "Добавьте адрес",
    },
    {
      icon: "help", l: "Помощь", c: "var(--t2)", to: "faq",
      s: "FAQ и поддержка",
    },
  ];

  return (
    <div data-store-page data-profile-tier={profileTierId} style={profilePageShell(profileTheme, profileTierId)}>
      <header style={profileHeaderStyle(profileTheme)}>
        <div style={{ padding:"14px 18px 13px", display:"flex", alignItems:"center", gap:10 }}>
          <div className="ub" style={{ flex:1, fontSize:17, fontWeight:900, color: profileTheme.accent }}>Профиль</div>
          <button onClick={() => go("notifs")} className="btn" style={{ width:38, height:38, borderRadius:12, background:"var(--l3)", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center", position:"relative" }}>
            <Ic n="bell" s={17} c="var(--t2)"/>
            {unreadNotifs > 0 && (
              <div style={{ position:"absolute", top:6, right:6, minWidth:16, height:16, padding:"0 4px", borderRadius:8, background:"var(--red)", border:"1.5px solid var(--bg)", fontSize:9, fontWeight:800, color:"white", display:"flex", alignItems:"center", justifyContent:"center" }}>
                {unreadNotifs > 9 ? "9+" : unreadNotifs}
      </div>
            )}
          </button>
        </div>
      </header>

      <div style={{ padding:"16px 18px 110px" }}>
        <div className="card" style={{
          padding:"16px", marginBottom:14,
          background: profileTheme.bg,
          border: `1.5px solid ${profileTheme.border}`,
          boxShadow: loyalty.isVip ? `0 6px 28px ${profileTheme.glow}` : `0 4px 22px ${profileTheme.glow}`,
          transition: 'all .4s ease',
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
            <div style={{
              width:56, height:56, borderRadius:16, flexShrink:0, position:'relative',
              background: loyalty.isVip
                ? 'linear-gradient(135deg,#E9AE00,#E0A400,#C98F00)'
                : `linear-gradient(135deg,${profileTheme.accent},${profileTheme.accent}99)`,
              display:"flex", alignItems:"center", justifyContent:"center",
              boxShadow: loyalty.isVip ? '0 4px 20px rgba(233,174,0,.45)' : `0 4px 16px ${profileTheme.glow}`,
            }}>
              <span style={{ fontFamily:"Unbounded", fontSize:22, fontWeight:900, color: loyalty.isVip ? '#3A2A00' : 'var(--bg)' }}>
                {user.name.charAt(0)}
              </span>
              {loyalty.isVip && (
                <div style={{
                  position:'absolute', top:-4, right:-4, width:22, height:22, borderRadius:8,
                  background:'linear-gradient(135deg,#E9AE00,#E0A400)', border:'2px solid var(--bg)',
                  display:'flex', alignItems:'center', justifyContent:'center', fontSize:11,
                  boxShadow:'0 2px 8px rgba(233,174,0,.5)', animation:'crownFloat 2.5s ease-in-out infinite',
                }}>👑</div>
              )}
          </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:2 }}>
                <div className="ub" style={{ fontSize:15, fontWeight:900, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user.name}</div>
          </div>
              <div style={{ fontSize:12, color:"var(--t2)", marginBottom: user.card ? 2 : 5 }}>{user.phone}</div>
              {user.card && (
                <div style={{ marginBottom:5, display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ fontSize:11, color:"var(--t3)", display:"flex", alignItems:"center", gap:4, minWidth:0, flex:1, overflow:"hidden" }}>
                    <Ic n="card" s={11} c="var(--t3)"/>
                    <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user.card}</span>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setCardQrOpen(true)}
                    title="QR-код карты"
                    style={{
                      flexShrink:0, height:30, padding:"0 10px", borderRadius:10, gap:5,
                      background:`${profileTheme.accent}18`, border:`1px solid ${profileTheme.border}`,
                      display:"inline-flex", alignItems:"center", justifyContent:"center",
                      fontSize:11, fontWeight:800, color:profileTheme.accent,
                    }}
                  >
                    <Ic n="qr" s={14} c={profileTheme.accent}/>
                    QR
                  </button>
                </div>
              )}
              <span style={{
                fontSize:10, fontWeight:800, padding:"3px 10px", borderRadius:20, display:'inline-flex', alignItems:'center', gap:4,
              }}>
                <UserStatusBadge user={{ ...user, vip: profileLoyalty.isVip, level: profileLoyalty.level }} size="md" />
              </span>
            </div>
        </div>
          <div style={{
            display:"flex", alignItems:"center", justifyContent:"space-between", gap:8,
            padding:"12px 14px", borderRadius:14, marginBottom:10,
            background:"linear-gradient(135deg, rgba(14,116,144,.14), rgba(14,116,144,.05))",
            border:"1px solid rgba(14,116,144,.3)",
          }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontSize:18 }}>⭐</span>
              <div>
                <div style={{ fontSize:13, fontWeight:800, color:"var(--t1)" }}>Бонусы</div>
                <div style={{ fontSize:10, color:"var(--t3)" }}>1 бонус = 1 ЅМ · магазин и приложение</div>
              </div>
            </div>
            <div className="bank-num" style={{ fontSize:22, fontWeight:900, color:profileTheme.accent }} title={bonusBank}>
              {bonusBank} ⭐
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(2, minmax(0, 1fr))", gap:8 }}>
            <div style={{ padding:"10px 6px", borderRadius:12, background:"var(--gr-soft)", border:"1px solid rgba(7,136,61,.2)", textAlign:"center", minWidth:0, overflow:"hidden" }}>
              <div className="bank-num" style={{ fontSize:16, color:"var(--gr)" }}>{orderCount}</div>
              <div style={{ fontSize:10, color:"var(--t3)", marginTop:3, lineHeight:1.2 }}>{orderCount === 1 ? "заказ" : orderCount >= 2 && orderCount <= 4 ? "заказа" : "заказов"}</div>
              </div>
            <button
              type="button"
              onClick={() => go("wishlist")}
              className="btn"
              style={{
                padding:"10px 6px", borderRadius:12, minWidth:0, overflow:"hidden",
                background: wishCount > 0 ? "rgba(195,52,52,.08)" : "var(--l3)",
                border: `1px solid ${wishCount > 0 ? "rgba(195,52,52,.25)" : "var(--b1)"}`,
                textAlign:"center", cursor:"pointer",
              }}
            >
              <div className="bank-num" style={{ fontSize:16, color: wishCount > 0 ? "var(--red)" : "var(--t2)" }}>{wishCount}</div>
              <div style={{ fontSize:10, color:"var(--t3)", marginTop:3, lineHeight:1.2 }}>избранное</div>
            </button>
              </div>
              </div>

        {cardQrOpen && user.card && (
          <div
            onClick={() => setCardQrOpen(false)}
            style={{
              position:"fixed", inset:0, zIndex:500, background:"var(--overlay)", backdropFilter:"blur(6px)",
              display:"flex", alignItems:"center", justifyContent:"center", padding:24,
            }}
          >
            <div
              className="card"
              onClick={e => e.stopPropagation()}
              style={{
                width:"100%", maxWidth:320, padding:22, textAlign:"center",
                background: profileTheme.bg, border:`1.5px solid ${profileTheme.border}`,
                boxShadow:`0 16px 48px ${profileTheme.glow}`,
              }}
            >
              <div className="ub" style={{ fontSize:15, fontWeight:900, marginBottom:6, color: profileTheme.accent }}>QR-код карты</div>
              <div style={{ fontSize:12, color:"var(--t2)", marginBottom:16 }}>Покажите кассиру для быстрого выбора клиента</div>
              <div style={{
                width:220, height:220, margin:"0 auto 14px", borderRadius:18, padding:12,
                background:"#fff", display:"flex", alignItems:"center", justifyContent:"center",
                boxShadow:"none",
              }}>
                <QRCodeSVG
                  value={String(user.card || "")}
                  size={196}
                  level="M"
                  marginSize={0}
                  bgColor="#ffffff"
                  fgColor="#000000"
                  style={{ display:"block", borderRadius:8 }}
                />
              </div>
              <div style={{
                fontFamily:"JetBrains Mono, monospace", fontSize:14, fontWeight:800, color:profileTheme.accent,
                letterSpacing:".02em", marginBottom:6, wordBreak:"break-all",
              }}>
                {user.card}
              </div>
              <div style={{ fontSize:11, color:"var(--t3)", marginBottom:16 }}>{user.name}</div>
              <button
                type="button"
                className="btn"
                onClick={() => setCardQrOpen(false)}
                style={{
                  width:"100%", padding:13, borderRadius:14, fontWeight:800, fontSize:13,
                  background:`linear-gradient(135deg,${profileTheme.accent},${profileTheme.accent}cc)`,
                  color: loyalty.isVip ? "#3A2A00" : "var(--bg)",
                }}
              >
                Закрыть
              </button>
            </div>
          </div>
        )}

        <LoyaltyStatusCard loyalty={profileLoyalty} onVip={() => go("vip")} adminVip={!!user.vip} />

        <div className="card" style={{ marginBottom:12, ...cardAccent }}>
          {menuItems.map((item, i) => (
            <div
              key={item.to}
              onClick={() => go(item.to)}
              style={{ display:"flex", alignItems:"center", gap:12, padding:"13px 14px", borderBottom:i < menuItems.length - 1 ? `1px solid ${profileTheme.border}` : "none", cursor:"pointer" }}
            >
              <div style={{ width:34, height:34, borderRadius:10, background:`${item.c}14`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <Ic n={item.icon} s={16} c={item.c}/>
            </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:700 }}>{item.l}</div>
                {item.s && <div style={{ fontSize:11, color:"var(--t3)", marginTop:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.s}</div>}
        </div>
              <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
                {item.badge ? (
                  <span style={{ fontSize:10, fontWeight:800, padding:"2px 7px", borderRadius:8, background:item.icon === "bell" ? "rgba(195,52,52,.12)" : item.icon === "crown" ? "rgba(233,174,0,.12)" : item.icon === "card" ? "rgba(195,52,52,.12)" : "rgba(37,99,235,.12)", color:item.icon === "bell" || item.icon === "card" ? "var(--red)" : item.icon === "crown" ? "var(--gd)" : "var(--blue)", border:`1px solid ${item.icon === "bell" || item.icon === "card" ? "rgba(195,52,52,.25)" : item.icon === "crown" ? "rgba(233,174,0,.3)" : "rgba(37,99,235,.25)"}` }}>
                    {item.icon === "bell" ? String(item.badge) : item.badge === "VIP" ? "VIP" : item.badge === "долг" ? "долг" : "ответ"}
                  </span>
                ) : null}
                <Ic n="arr" s={14} c="var(--t3)"/>
              </div>
                </div>
              ))}
            </div>

        {STORE_ACCOUNT_DELETE_ENABLED && <div className="card" style={cardAccent}>
          {confirmDelete ? (
            <div style={{ padding:"14px" }}>
              <div style={{ fontSize:13, fontWeight:800, color:"var(--red)", marginBottom:8 }}>Удалить аккаунт?</div>
              <div style={{ fontSize:12, color:"var(--t2)", lineHeight:1.5, marginBottom:14 }}>
                Аккаунт попадёт в восстановление на 30 дней — можно вернуть профиль, заказы и бонусы. После этого срока регистрация начнётся заново. Заказы останутся в отчётах админа.
          </div>
              <div style={{ display:"flex", gap:8 }}>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={async () => {
                    const snapshot = user;
                    setDeleting(true);
                    try {
                      await deleteClientAccount(snapshot);
                      clearClientSession();
                      setUser?.(null);
                      setConfirmDelete(false);
                      showToast?.("Аккаунт удалён");
                    } catch (e) {
                      console.error(e);
                      const msg = e instanceof Error ? e.message : 'Не удалось удалить аккаунт';
                      showToast?.(msg);
                    } finally {
                      setDeleting(false);
                    }
                  }}
                  className="btn"
                  style={{ flex:1, padding:"11px", borderRadius:12, background:"var(--red)", color:"white", fontSize:12, fontWeight:800, opacity:deleting ? 0.7 : 1 }}
                >
                  {deleting ? "Удаление…" : "Да, удалить"}
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setConfirmDelete(false)}
                  className="btn"
                  style={{ flex:1, padding:"11px", borderRadius:12, background:"var(--l3)", border:"1px solid var(--b1)", fontSize:12, fontWeight:700, color:"var(--t2)" }}
                >
                  Отмена
                </button>
          </div>
        </div>
          ) : (
            <div
              onClick={() => {
                const debt = Math.max(0, Number(user?.debt) || 0)
                if (debt > 0.001) {
                  showToast?.(`Сначала погасите долг ${debt.toLocaleString()} ЅМ`)
                  return
                }
                setConfirmDelete(true)
              }}
              style={{ display:"flex", alignItems:"center", gap:12, padding:"13px 14px", cursor:"pointer", opacity:(Number(user?.debt) || 0) > 0.001 ? .65 : 1 }}
            >
              <div style={{ width:34, height:34, borderRadius:10, background:"rgba(195,52,52,.08)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <Ic n={(Number(user?.debt) || 0) > 0.001 ? "card" : "trash"} s={16} c="var(--red)"/>
      </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:700, color:"var(--red)" }}>Удалить аккаунт</div>
                {(Number(user?.debt) || 0) > 0.001 && (
                  <div style={{ fontSize:10, color:"var(--t3)", marginTop:2 }}>Недоступно, пока есть долг</div>
                )}
              </div>
            </div>
          )}
        </div>}

        <div className="card" style={cardAccent}>
          <div onClick={() => onLogout?.()} style={{ display:"flex", alignItems:"center", gap:12, padding:"13px 14px", cursor:"pointer" }}>
            <div style={{ width:34, height:34, borderRadius:10, background:"rgba(195,52,52,.12)", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <Ic n="logout" s={16} c="var(--red)"/>
                </div>
            <div style={{ flex:1, fontSize:13, fontWeight:700, color:"var(--red)" }}>Выйти из аккаунта</div>
            </div>
          </div>

        <div style={{ textAlign:"center", marginTop:14, fontSize:10, color:"var(--t3)" }}>КАКАПО · г. Яван</div>
          </div>
      <Nav page="profile" go={go} user={user}/>
    </div>
  );
};
function clientOrderBreakdown(o: {
  goodsTotal?: number
  total: number
  delivery?: number
  bonusSpent?: number
  items: { price: number; qty: number }[]
}) {
  // В заказах price хранится как цена за единицу (как в product catalog)
  // Поэтому нужно умножать на qty для получения суммы
  const goods = o.goodsTotal ?? o.items.reduce((s, it) => s + it.price * it.qty, 0)
  const delivery = Number(o.delivery) || 0
  const bonusSpent = Number(o.bonusSpent) || 0
  const payable = o.goodsTotal != null
    ? Number(o.total) || 0
    : Math.max(0, Math.round((goods + delivery - bonusSpent) * 100) / 100)
  return { goods, delivery, bonusSpent, payable }
}

type ReviewDraft = { rating: number; text: string }

function OrderReviewModal({
  order,
  targets,
  drafts,
  restaurants,
  submitting,
  onClose,
  onRating,
  onText,
  onSubmit,
}: {
  order: { id: string }
  targets: ClientReviewTarget[]
  drafts: Record<string, ReviewDraft>
  restaurants: { id: string; name?: string; emoji?: string }[]
  submitting: boolean
  onClose: () => void
  onRating: (restId: string, rating: number) => void
  onText: (restId: string, text: string) => void
  onSubmit: () => void
}) {
  if (!order || !targets.length) return null
  const canSubmit = targets.every(t => (drafts[t.restId]?.rating || 0) > 0)
  const mood = ['', '😤 Плохо', '😕 Так себе', '😐 Нормально', '😊 Хорошо', '🤩 Отлично!']
  return (
    <div className="store-sheet-backdrop" style={{ zIndex: 300 }} onClick={onClose}>
      <div className="store-sheet" onClick={e => e.stopPropagation()} style={{ padding: "20px 20px calc(36px + env(safe-area-inset-bottom, 0px))" }}>
        <div style={{ width:40, height:4, borderRadius:2, background:"var(--b2)", margin:"0 auto 16px" }}/>
        <div style={{ fontSize:16, fontWeight:800, textAlign:"center", marginBottom:4 }}>Оцените заказ</div>
        <div style={{ fontSize:12, color:"var(--t2)", textAlign:"center", marginBottom:16 }}>Заказ {order.id}</div>
        {targets.map(target => {
          const label = resolveReviewTargetLabel(target, restaurants)
          const draft = drafts[target.restId] || { rating: 0, text: '' }
          const placeholder = reviewPromptForTarget(target).placeholder
          return (
            <div key={target.restId} style={{ marginBottom:16, padding:"14px", borderRadius:14, background:"var(--l2)", border:"1px solid var(--b1)" }}>
              <div style={{ fontSize:14, fontWeight:800, marginBottom:10 }}>{label}</div>
              <div style={{ display:"flex", justifyContent:"center", gap:6, marginBottom:6 }}>
                {[1,2,3,4,5].map(i => (
                  <svg key={i} width={32} height={32} viewBox="0 0 24 24" style={{ cursor:"pointer" }} onClick={() => onRating(target.restId, i)}>
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill={i<=draft.rating?"#E0A400":"rgba(233,174,0,.12)"} stroke="#E0A400" strokeWidth={1}/>
                  </svg>
                ))}
              </div>
              <div style={{ textAlign:"center", fontSize:12, color:"var(--t2)", fontWeight:700, marginBottom:10, minHeight:18 }}>
                {mood[draft.rating] || ''}
              </div>
              <textarea className="inp" value={draft.text} onChange={e => onText(target.restId, e.target.value)} placeholder={placeholder} rows={2} style={{ width:"100%", resize:"vertical" }}/>
            </div>
          )
        })}
        <button onClick={onSubmit} disabled={submitting || !canSubmit} className="btn" style={{ width:"100%", padding:"14px", fontSize:14, borderRadius:15, background:"var(--gr)", color:"white", display:"flex", alignItems:"center", justifyContent:"center", gap:8, opacity:canSubmit && !submitting?1:.5 }}>
          <Ic n="star" s={16} c="white"/>{submitting ? "Отправка…" : targets.length > 1 ? "Отправить все отзывы" : "Отправить отзыв"}
        </button>
      </div>
    </div>
  )
}

const OrdersPage = ({ go, user, onAdd, onClearCart, showToast, params }: any) => {
  const apiOrders = useOrders(s => s.orders);
  const { prods, restaurants } = useLiveCatalog();
  const pickups = usePickups();
  const assemblers = useAssemblerTeam();
  const ordersList = useMemo(() => {
    const activePhone = user?.phone || getActiveClientPhone(user) || '';
    const mine = phoneDigits(activePhone);
    if (!mine) return [];
    // Гость без аккаунта: заказы принадлежат телефону, а не StoreUser — даём трекингу «профиль» по телефону.
    const owner = user?.phone ? user : { phone: activePhone, name: 'Клиент', level: 'basic' as const, bonus: 0 };
    const fromApi = mapOrdersForClient(filterOrdersForStoreUser(apiOrders, owner), owner);
    if (USE_API) return fromApi;
    const demoStatic = ORDERS_LIST.filter(o => phoneDigits(o.phone || '') === mine);
    const byId = new Map<string, typeof fromApi[0]>();
    [...fromApi, ...demoStatic].forEach(o => byId.set(o.id, o));
    return Array.from(byId.values());
  }, [apiOrders, user?.phone, user?.level, user?.vip]);
  const orderContacts = useCallback((orderId: string) => {
    const raw = apiOrders.find(o => o.id === orderId);
    if (!raw) return [];
    return resolveClientOrderContacts(raw, pickups, assemblers);
  }, [apiOrders, pickups, assemblers]);
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [reviewed, setReviewed] = useState<Record<string, Review>>({});
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>({});
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [showRev, setShowRev] = useState(null);
  const step = 2;
  useEffect(() => {
    const oid = params?.orderId || params?.id
    if (!oid) return
    const o = ordersList.find(x => x.id === oid)
    if (o) setSelected(o)
  }, [params?.orderId, params?.id, ordersList])
  useEffect(() => {
    if (!user?.phone) {
      setReviewed({});
      return;
    }
    if (!USE_API) {
      setReviewed(loadLocalReviews(user.phone));
      return;
    }
    loadClientReviewMap(apiOrders, user).then(setReviewed).catch(() => {});
    const id = setInterval(() => {
      loadClientReviewMap(apiOrders, user).then(setReviewed).catch(() => {});
    }, 12000);
    return () => clearInterval(id);
  }, [apiOrders, user?.phone, user?.name]);
  const closeReview = () => {
    setShowRev(null);
    setReviewDrafts({});
  };
  const reviewModalOrder = showRev ? resolveOrderForReview(showRev.id, apiOrders, showRev) : null;
  const reviewModalTargets = reviewModalOrder ? getPendingReviewTargets(reviewModalOrder, reviewed) : [];
  const setDraftRating = (restId: string, rating: number) => {
    setReviewDrafts(d => ({ ...d, [restId]: { rating, text: d[restId]?.text || '' } }));
  };
  const setDraftText = (restId: string, text: string) => {
    setReviewDrafts(d => ({ ...d, [restId]: { rating: d[restId]?.rating || 0, text } }));
  };
  const submitReview = async () => {
    if (!showRev || reviewSubmitting || !reviewModalTargets.length) return;
    const raw = resolveOrderForReview(showRev.id, apiOrders, showRev);
    if (!raw) {
      showToast?.("Не удалось определить заказ для отзыва");
      return;
    }
    const allRated = reviewModalTargets.every(t => (reviewDrafts[t.restId]?.rating || 0) > 0);
    if (!allRated) {
      showToast?.("Поставьте оценку каждому месту");
      return;
    }
    setReviewSubmitting(true);
    const nextReviewed = { ...reviewed };
    const errors: string[] = [];
    let saved = 0;
    try {
      for (const target of reviewModalTargets) {
        const draft = reviewDrafts[target.restId] || { rating: 0, text: '' };
        const reviewKey = clientReviewKey(showRev.id, target.restId);
        if (nextReviewed[reviewKey]) continue;
        try {
          let created: Review | null = null;
          if (USE_API) {
            created = await api.createReview({
              orderId: showRev.id,
              restId: target.restId,
              restName: resolveReviewTargetLabel(target, restaurants),
              client: user?.name || raw?.client?.name || showRev.phone || "Клиент",
              rating: draft.rating,
              text: draft.text.trim() || `${"★".repeat(draft.rating)}`,
            });
          } else {
            created = {
              id: Date.now() + Math.floor(Math.random() * 1000),
              restId: target.restId,
              restName: resolveReviewTargetLabel(target, restaurants),
              client: user?.name || 'Клиент',
              rating: draft.rating,
              text: draft.text.trim() || `${"★".repeat(draft.rating)}`,
              date: 'Сегодня',
              status: 'new',
              orderId: showRev.id,
            } as Review;
            saveLocalReview(showRev.id, created, user?.phone, target.restId);
          }
          if (created) {
            nextReviewed[reviewKey] = created;
            saved += 1;
          }
        } catch (e) {
          const label = resolveReviewTargetLabel(target, restaurants);
          errors.push(`${label}: ${e instanceof Error ? e.message : 'ошибка'}`);
        }
      }
      setReviewed(nextReviewed);
      if (saved > 0) {
        if (errors.length) {
          showToast?.(`Сохранено ${saved} из ${reviewModalTargets.length}. ${errors[0]}`);
        } else {
          closeReview();
          showToast?.(reviewModalTargets.length > 1 ? "⭐ Спасибо! Все отзывы отправлены" : "⭐ Спасибо! Отзыв отправлен");
        }
      } else if (errors.length) {
        showToast?.(errors[0]);
      }
    } finally {
      setReviewSubmitting(false);
    }
  };
  const orderReviews = useCallback((orderId: string) => {
    const row = ordersList.find(x => x.id === orderId);
    const raw = resolveOrderForReview(orderId, apiOrders, row);
    if (!raw) return Object.entries(reviewed).filter(([k]) => k.startsWith(`${orderId}:`)).map(([, v]) => v);
    return getClientReviewTargets(raw)
      .map(t => reviewed[clientReviewKey(orderId, t.restId)])
      .filter(Boolean);
  }, [apiOrders, ordersList, reviewed]);
  const canReview = (o) => {
    const raw = resolveOrderForReview(o.id, apiOrders, o);
    if (!raw) return false;
    return canClientReviewOrder(raw, reviewed, o.status);
  };
  const openReview = (o) => {
    const raw = resolveOrderForReview(o.id, apiOrders, o);
    if (!raw) return;
    const pending = getPendingReviewTargets(raw, reviewed);
    if (!pending.length) return;
    const drafts: Record<string, ReviewDraft> = {};
    pending.forEach(t => { drafts[t.restId] = { rating: 0, text: '' }; });
    setReviewDrafts(drafts);
    setShowRev(o);
  };
  const filtered = filter==="all"
    ? ordersList
    : ordersList.filter(o => o.status === filter);
  const ST = OSTATUS;
  const selectedContacts = selected ? orderContacts(selected.id) : [];
  const selectedAmounts = selected ? clientOrderBreakdown(selected) : null;

  const repeatOrder = (order) => {
    const silentAdd = (id, price, name, emoji, restId) => onAdd(id, price, name, emoji, restId, true);
    const n = fillCartFromOrder(order.id, order, { apiOrders, prods, restaurants, onAdd: silentAdd, onClearCart });
    if (n > 0) {
      setSelected(null);
      showToast?.(`🔄 ${n} поз. добавлено в корзину`);
      go('cart');
    } else {
      showToast?.('Не удалось добавить товары — проверьте каталог');
    }
  };

  if (selected) return (
    <div data-store-page style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:'var(--store-w)', margin:"0 auto" }}>
      <header data-store-header style={{ position:"sticky", top:0, zIndex:100, background:"var(--header-bg)", backdropFilter:"blur(24px)", borderBottom:"1px solid var(--b1)" }}>
        <div style={{ padding:"14px 18px 13px", display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={() => setSelected(null)} className="btn" style={{ width:38, height:38, borderRadius:12, background:"var(--l3)", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div style={{ flex:1 }}><div className="ub" style={{ fontSize:15, fontWeight:900 }}>Заказ {selected.id}</div><div style={{ fontSize:10, color:"var(--t2)", marginTop:1 }}>{selected.date} · {selected.time}</div></div>
          <span className="bdg" style={{ background:`${ST[selected.status].c}18`, color:ST[selected.status].c, border:`1px solid ${ST[selected.status].c}30` }}>{ST[selected.status].l}</span>
        </div>
      </header>
      <div style={{ padding:"16px 18px 100px" }}>
        {selected.status==="assembling" && (
          <div style={{ padding:"16px", borderRadius:16, background:"rgba(124,58,237,.08)", border:"1px solid rgba(124,58,237,.25)", marginBottom:16 }}>
            <div style={{ fontSize:13, fontWeight:700, color:"var(--pur)", marginBottom:6 }}>📦 Заказ собирается</div>
            <div style={{ fontSize:12, color:"var(--t2)" }}>Сборщик комплектует ваш заказ. Курьер получит его после сборки.</div>
          </div>
        )}
        {selected.status==="cooking" && (
          <div style={{ padding:"16px", borderRadius:16, background:"rgba(233,174,0,.14)", border:"1px solid rgba(233,174,0,.25)", marginBottom:16 }}>
            <div style={{ fontSize:13, fontWeight:700, color:"var(--t2)", marginBottom:6 }}>👨‍🍳 Ресторан готовит заказ</div>
            <div style={{ fontSize:12, color:"var(--t2)" }}>Когда блюда будут готовы — курьер заберёт заказ из ресторана.</div>
          </div>
        )}
        {selected.status==="waiting_courier" && (
          <div style={{ padding:"16px", borderRadius:16, background:"rgba(233,174,0,.14)", border:"1px solid rgba(233,174,0,.25)", marginBottom:16 }}>
            <div style={{ fontSize:13, fontWeight:700, color:"var(--t2)", marginBottom:6 }}>{selected.orderType === 'restaurant' ? '✅ Заказ готов' : '✅ Заказ собран'}</div>
            <div style={{ fontSize:12, color:"var(--t2)" }}>{selected.orderType === 'restaurant' ? 'Ресторан передал заказ. Ждём курьера — когда он примет заказ, здесь появится карта.' : 'Ждём курьера. Когда он примет заказ — здесь появится карта отслеживания.'}</div>
          </div>
        )}
        {selected.status==="delivering" && (
          <div style={{ padding:"16px", borderRadius:16, background:"rgba(37,99,235,.06)", border:"1px solid rgba(37,99,235,.2)", marginBottom:16 }}>
            <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:14 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:"var(--blue)", position:"relative" }}><div style={{ position:"absolute", inset:0, borderRadius:"50%", background:"var(--blue)", animation:"ping 1.5s ease-out infinite", opacity:.5 }}/></div>
              <span style={{ fontSize:13, fontWeight:700, color:"var(--blue)" }}>Курьер едет{selected.eta ? ` · ${selected.eta}` : ''}</span>
            </div>
            <div style={{ display:"flex", alignItems:"center", marginBottom:14 }}>
              {["Принят","Собирается","В пути","Доставлен"].map((l,i) => (
                <div key={i} style={{ display:"flex", alignItems:"center", flex:1 }}>
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                    <div style={{ width:24, height:24, borderRadius:"50%", background:i<=step?(i===step?"var(--blue)":"var(--gr)"):"var(--l3)", border:`2px solid ${i<=step?(i===step?"var(--blue)":"var(--gr)"):"var(--b2)"}`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                      {i<step ? <Ic n="check" s={11} c="white" w={2.5}/> : <div style={{ width:6, height:6, borderRadius:"50%", background:i===step?"white":"var(--b2)", animation:i===step?"pulse 1.5s infinite":"none" }}/>}
                    </div>
                    <span style={{ fontSize:9, fontWeight:700, color:i<=step?"var(--t1)":"var(--t3)", textAlign:"center" }}>{l}</span>
                  </div>
                  {i<3 && <div style={{ flex:1, height:3, borderRadius:2, background:i<step?"var(--gr)":"var(--b1)", margin:"0 3px", marginBottom:18 }}/>}
                </div>
              ))}
            </div>
          </div>
        )}
        {(selected.status==="delivered" || selected.status==="pos_sale") && (
          <div style={{ padding:"14px 16px", borderRadius:16, background:"rgba(7,136,61,.07)", border:"1px solid rgba(7,136,61,.25)", display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
            <div style={{ width:38, height:38, borderRadius:11, background:"rgba(7,136,61,.2)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Ic n="check" s={20} c="var(--gr)" w={2.5}/></div>
            <div><div style={{ fontSize:13, fontWeight:700, color:"var(--gr)" }}>Заказ доставлен!</div><div style={{ fontSize:11, color:"var(--t2)", marginTop:1 }}>Начислено <span style={{ color:"var(--t2)", fontWeight:700 }}>+{selected.bonus} бонусов</span></div></div>
          </div>
        )}
        <ClientOrderContactsBlock contacts={selectedContacts} pickups={pickups} />
        <div className="card" style={{ marginBottom:14, overflow:"hidden" }}>
          <div style={{ padding:"13px 15px", borderBottom:"1px solid var(--b1)", fontSize:13, fontWeight:800 }}>Состав заказа</div>
          {selected.items.map((item,i) => {
            const photo = resolveOrderItemPhoto(item, prods)
            return (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 15px", borderBottom:i<selected.items.length-1?"1px solid var(--b1)":"none" }}>
              <div style={{ width:42, height:42, borderRadius:11, background:"var(--l3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0, overflow:"hidden" }}>
                {photo ? <img src={photo} alt="" loading="lazy" decoding="async" style={{ width:"100%", height:"100%", objectFit:"contain", display:"block" }}/> : item.e}
              </div>
              <div style={{ flex:1 }}><div style={{ fontSize:13, fontWeight:600 }}>{item.name}</div><div style={{ fontSize:11, color:"var(--t3)", marginTop:1 }}>× {item.qty}</div></div>
              <span className="ub" style={{ fontSize:13, fontWeight:800 }}>{(item.price * item.qty).toFixed(2)} <span style={{ fontSize:12, color:"var(--t2)" }}>ЅМ</span></span>
            </div>
            )
          })}
        </div>
        <div className="card" style={{ padding:"15px", marginBottom:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 0" }}>
            <span style={{ fontSize:12, color:"var(--t2)" }}>Адрес</span>
            <span style={{ fontSize:12, fontWeight:700, color:"var(--t2)", textAlign:"right", maxWidth:"60%" }}>{selected.addr}</span>
          </div>
          <div style={{ marginTop:10, borderTop:"1px solid var(--b1)", paddingTop:10, display:"flex", flexDirection:"column", gap:8 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
              <span style={{ fontSize:12, color:"var(--t2)" }}>Товары</span>
              <span className="ub" style={{ fontSize:13, fontWeight:700 }}>{selectedAmounts!.goods.toFixed(2)} <span style={{ fontSize:12, color:"var(--t2)" }}>ЅМ</span></span>
            </div>
            {selectedAmounts!.delivery > 0 && (
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
                <span style={{ fontSize:12, color:"var(--t2)" }}>Доставка</span>
                <span className="ub" style={{ fontSize:13, fontWeight:700 }}>{selectedAmounts!.delivery.toFixed(2)} <span style={{ fontSize:12, color:"var(--t2)" }}>ЅМ</span></span>
              </div>
            )}
            {selectedAmounts!.bonusSpent > 0 && (
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
                <span style={{ fontSize:12, color:"var(--t2)" }}>Бонусы</span>
                <span className="ub" style={{ fontSize:13, fontWeight:700, color:"var(--gr)" }}>−{selectedAmounts!.bonusSpent.toFixed(2)} <span style={{ fontSize:12, color:"var(--t2)" }}>ЅМ</span></span>
              </div>
            )}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", paddingTop:8, borderTop:"1px solid var(--b1)" }}>
            <span style={{ fontSize:14, fontWeight:700 }}>Итого</span>
              <span className="ub" style={{ fontSize:20, fontWeight:900 }}>{selectedAmounts!.payable.toFixed(2)} <span style={{ fontSize:12, color:"var(--t2)" }}>ЅМ</span></span>
            </div>
          </div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <button type="button" onClick={() => repeatOrder(selected)} className="btn" style={{ padding:"13px", fontSize:13, borderRadius:15, background:"var(--gr)", color:"white", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
            <Ic n="repeat" s={16} c="white"/>Повторить заказ
          </button>
          {canReview(selected) && (
            <button onClick={() => openReview(selected)} className="btn" style={{ padding:"13px", fontSize:13, borderRadius:15, background:"rgba(233,174,0,.1)", border:"1.5px solid rgba(233,174,0,.3)", color:"var(--t2)", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
              <Ic n="star" s={16} c="var(--gd2)"/>Оставить отзыв
            </button>
          )}
          {orderReviews(selected.id).map(rev => (
            <ClientReviewBlock key={`${selected.id}-${rev.restId || rev.id}`} review={rev} orderId={selected.id} restaurants={restaurants} />
          ))}
        </div>
      </div>
      {showRev && reviewModalTargets.length > 0 && (
        <OrderReviewModal
          order={showRev}
          targets={reviewModalTargets}
          drafts={reviewDrafts}
          restaurants={restaurants}
          submitting={reviewSubmitting}
          onClose={closeReview}
          onRating={setDraftRating}
          onText={setDraftText}
          onSubmit={submitReview}
        />
      )}
      <Nav page="orders" go={go} user={user}/>
    </div>
  );

  return (
    <div data-store-page style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:'var(--store-w)', margin:"0 auto" }}>
      <header data-store-header style={{ position:"sticky", top:0, zIndex:100, background:"var(--header-bg)", backdropFilter:"blur(24px)", borderBottom:"1px solid var(--b1)" }}>
        <div style={{ padding:"14px 18px 10px", display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={() => storeBack("home", go)} className="btn" style={{ width:38, height:38, borderRadius:12, background:"var(--l3)", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div style={{ flex:1 }}><div className="ub" style={{ fontSize:17, fontWeight:900 }}>Мои заказы</div>
            <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:2, flexWrap:"wrap" }}>
              <div style={{ fontSize:10, color:"var(--t2)" }}>{ordersList.length} заказов</div>
              {user && resolveUserVip(user).isVip && <UserStatusBadge user={user} size="sm" />}
        </div>
          </div>
        </div>
        <div style={{ padding:"0 16px 10px", display:"flex", flexWrap:"wrap", gap:5 }}>
          {ORDER_STATUS_FILTERS.map(f => {
            const on = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                className="btn"
                onClick={() => setFilter(f.id)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 10px',
                  borderRadius: 20,
                  fontSize: 11,
                  fontWeight: 700,
                  border: `1px solid ${on ? f.activeBd : 'var(--b1)'}`,
                  background: on ? f.activeBg : 'var(--l2)',
                  color: on ? f.c : 'var(--t2)',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  transition: 'all .18s',
                }}
              >
                {f.ic && <Ic n={f.ic} s={11} c={on ? f.c : 'var(--t3)'} w={on ? 2.2 : 2} />}
                {f.l}
              </button>
            );
          })}
        </div>
      </header>
      {ordersList.some(o => o.status==="delivering" && o.trackable) && filter==="all" && (
        <div onClick={() => setSelected(ordersList.find(o => o.status==="delivering"))} style={{ margin:"14px 18px 0", padding:"12px 16px", borderRadius:16, background:"rgba(37,99,235,.08)", border:"1px solid rgba(37,99,235,.3)", display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}>
          <div style={{ width:8, height:8, borderRadius:"50%", background:"var(--blue)", position:"relative", flexShrink:0 }}><div style={{ position:"absolute", inset:0, borderRadius:"50%", background:"var(--blue)", animation:"ping 1.5s ease-out infinite", opacity:.5 }}/></div>
          <div style={{ flex:1 }}><div style={{ fontSize:13, fontWeight:700, color:"var(--blue)" }}>Курьер в пути!</div><div style={{ fontSize:11, color:"var(--t2)", marginTop:1 }}>Нажмите чтобы отследить</div></div>
          <Ic n="arr" s={15} c="var(--blue)"/>
        </div>
      )}
      <div style={{ padding:"14px 18px 100px", display:"flex", flexDirection:"column", gap:12 }}>
        {filtered.length === 0 && (
          ordersList.length === 0 ? (
            <EmptyState icon="🧾" title="Заказов пока нет" text="Оформите первый заказ — он появится здесь со статусом и составом." actionLabel="Перейти в каталог" onAction={() => go("catalog")}/>
          ) : (
            <EmptyState icon="🔍" title="В этом разделе пусто" text="Заказов с таким статусом нет. Покажите все заказы." actionLabel="Все заказы" onAction={() => setFilter("all")}/>
          )
        )}
        {filtered.map((o,i) => {
          const st = ST[o.status];
          const contacts = orderContacts(o.id);
          const amounts = clientOrderBreakdown(o);
          return (
            <div key={o.id} className="card" onClick={() => setSelected(o)} style={{ cursor:"pointer", animation:`fadeUp .45s cubic-bezier(.16,1,.3,1) ${i*.06}s both`, borderLeft:`3px solid ${st.c}`, overflow:"hidden" }}>
              {o.status==="delivering" && (
                <div style={{ padding:"9px 14px", background:"rgba(37,99,235,.08)", borderBottom:"1px solid rgba(37,99,235,.2)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <div style={{ width:7, height:7, borderRadius:"50%", background:"var(--blue)", position:"relative" }}><div style={{ position:"absolute", inset:0, borderRadius:"50%", background:"var(--blue)", animation:"ping 1.5s ease-out infinite", opacity:.5 }}/></div>
                    <span style={{ fontSize:12, fontWeight:700, color:"var(--blue)" }}>Курьер едет{o.eta ? ` · ${o.eta}` : ''}</span>
                  </div>
                </div>
              )}
              <div style={{ padding:"13px 14px" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                  <div>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
                      <span className="ub" style={{ fontSize:13, fontWeight:800 }}>{o.id}</span>
                      <span className="bdg" style={{ background:`${st.c}18`, color:st.c, border:`1px solid ${st.c}30` }}>{st.l}</span>
                    </div>
                    <div style={{ fontSize:11, color:"var(--t3)" }}>{o.date} · {o.time}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div className="ub" style={{ fontSize:15, fontWeight:900 }}>{amounts.payable.toFixed(2)} <span style={{ fontSize:12, color:"var(--t2)" }}>ЅМ</span></div>
                    {amounts.delivery > 0 && (
                      <div style={{ fontSize:9, color:"var(--t3)", marginTop:1 }}>вкл. доставка {amounts.delivery.toFixed(2)}</div>
                    )}
                    <div style={{ fontSize:10, color:"var(--t3)", marginTop:1 }}>{formatProductCount(o.items.reduce((s,it)=>s+it.qty,0))}</div>
                  </div>
                </div>
                <div style={{ display:"flex", gap:5, marginBottom: contacts.length ? 8 : 10 }}>
                  {o.items.slice(0,3).map((it,j) => (
                    <div key={j} style={{ width:36, height:36, borderRadius:10, background:"#fff", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, overflow:"hidden" }}>
                      {resolveOrderItemPhoto(it, prods)
                        ? <img src={resolveOrderItemPhoto(it, prods)} alt="" loading="lazy" decoding="async" style={{ width:"100%", height:"100%", objectFit:"contain", padding:3, boxSizing:"border-box" }}/>
                        : (it.e || "🛒")}
                    </div>
                  ))}
                  <div style={{ flex:1, display:"flex", justifyContent:"flex-end", alignItems:"center" }}><Ic n="arr" s={14} c="var(--t3)"/></div>
                </div>
                <ClientOrderContactsBlock contacts={contacts} pickups={pickups} compact onCallClick={e => e.stopPropagation()} />
                <div style={{ display:"flex", gap:8 }}>
                  {o.status==="delivering" && o.trackable && <button className="btn" onClick={e=>{e.stopPropagation();setSelected(o);}} style={{ flex:1, padding:"9px", fontSize:12, borderRadius:11, background:"var(--gr)", color:"white", display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}><Ic n="map" s={13} c="white"/>Отследить</button>}
                  {canReview(o) && <button className="btn" onClick={e=>{e.stopPropagation();openReview(o);}} style={{ flex:1, padding:"9px", fontSize:12, borderRadius:11, background:"rgba(233,174,0,.1)", border:"1.5px solid rgba(233,174,0,.3)", color:"var(--t2)", display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}><Ic n="star" s={13} c="var(--gd2)"/>Отзыв</button>}
                  <button type="button" className="btn" onClick={e=>{e.stopPropagation();repeatOrder(o);}} style={{ flex:1, padding:"9px", fontSize:12, borderRadius:11, background:"var(--l3)", border:"1px solid var(--b1)", color:"var(--t2)", display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}><Ic n="repeat" s={13} c="var(--t2)"/>Повторить</button>
                </div>
                {o.cancelReason && <div style={{ marginTop:9, padding:"7px 10px", borderRadius:9, background:"rgba(195,52,52,.07)", border:"1px solid rgba(195,52,52,.2)", fontSize:11, color:"var(--red)" }}>ℹ️ {o.cancelReason}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {showRev && reviewModalTargets.length > 0 && (
        <OrderReviewModal
          order={showRev}
          targets={reviewModalTargets}
          drafts={reviewDrafts}
          restaurants={restaurants}
          submitting={reviewSubmitting}
          onClose={closeReview}
          onRating={setDraftRating}
          onText={setDraftText}
          onSubmit={submitReview}
        />
      )}
      <Nav page="orders" go={go} user={user}/>
    </div>
  );
};

const ClientReviewsPage = ({ go, user, sessionReady, params }: any) => {
  const apiOrders = useOrders(s => s.orders);
  const { restaurants } = useLiveCatalog();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const highlightId = params?.reviewId ? Number(params.reviewId) : null;

  const refresh = useCallback(async () => {
    if (!user) {
      setReviews([]);
      setLoading(false);
      return;
    }
    if (!USE_API) {
      setReviews(Object.values(loadLocalReviews(user.phone)).sort((a, b) => (b.date || '').localeCompare(a.date || '')));
      setLoading(false);
      return;
    }
    try {
      const map = await loadClientReviewMap(apiOrders, user);
      setReviews(sortReviewsNewestFirst(Object.values(map)));
    } catch {
      setReviews([]);
    } finally {
      setLoading(false);
    }
  }, [apiOrders, user]);

  useEffect(() => {
    refresh();
    if (!USE_API || !user) return;
    const id = setInterval(refresh, 12000);
    return () => clearInterval(id);
  }, [refresh, user]);

  useEffect(() => {
    if (!highlightId || loading) return;
    const el = document.getElementById(`client-review-${highlightId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightId, loading, reviews]);

  if (!sessionReady) return <StoreSessionBoot />;

  if (!user) {
  return (
      <div data-store-page style={{ minHeight: "100vh", background: "var(--bg)", maxWidth:'var(--store-w)', margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>⭐</div>
        <div className="ub" style={{ fontSize: 16, fontWeight: 800, marginBottom: 16 }}>Войдите, чтобы видеть отзывы</div>
        <button onClick={() => go("auth")} className="btn" style={{ padding: "12px 24px", borderRadius: 14, background: "var(--gr)", color: "white" }}>Войти</button>
        <Nav page="profile" go={go} user={user}/>
            </div>
    );
  }

  const withReplies = reviews.filter(r => r.adminReply || r.restReply).length;

  return (
    <div data-store-page style={{ minHeight: "100vh", background: "var(--bg)", maxWidth:'var(--store-w)', margin: "0 auto" }}>
      <header data-store-header style={{ position: "sticky", top: 0, zIndex: 100, background: "var(--header-bg)", backdropFilter: "blur(24px)", borderBottom: "1px solid var(--b1)" }}>
        <div style={{ padding: "14px 18px 13px", display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => storeBack("profile", go)} className="btn" style={{ width: 44, height: 44, borderRadius: 12, background: "var(--l3)", border: "1px solid var(--b1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Ic n="arrL" s={17} c="var(--t2)"/>
          </button>
          <div style={{ flex: 1 }}>
            <div className="ub" style={{ fontSize: 17, fontWeight: 900 }}>Мои отзывы</div>
            <div style={{ fontSize: 10, color: "var(--t2)", marginTop: 1 }}>
              {loading ? "Загрузка…" : withReplies ? `${withReplies} с ответами` : `${reviews.length} ${reviewCountLabel(reviews.length)}`}
          </div>
          </div>
        </div>
      </header>
      <div style={{ padding: "16px 18px 100px" }}>
        {loading && (
          <div style={{ textAlign: "center", padding: 40, color: "var(--t3)", fontSize: 13 }}>Загрузка отзывов…</div>
        )}
        {!loading && reviews.length === 0 && (
          <div style={{ textAlign: "center", padding: "48px 20px" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>⭐</div>
            <div className="ub" style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>Пока нет отзывов</div>
            <div style={{ fontSize: 13, color: "var(--t2)", lineHeight: 1.6, marginBottom: 20 }}>
              После доставки оцените магазин или ресторан в разделе «Мои заказы» — ответ придёт сюда
            </div>
            <button onClick={() => go("orders")} className="btn" style={{ padding: "12px 24px", borderRadius: 14, background: "var(--gr)", color: "white", fontSize: 13 }}>
              Перейти к заказам
            </button>
          </div>
        )}
        {!loading && reviews.map((rev, i) => {
          const place = resolveReviewPlaceName(rev.restId || 'STORE', rev, restaurants);
          return (
            <div key={rev.id} id={`client-review-${rev.id}`} className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 12, animation: `fadeUp .4s ease ${i * .06}s both`, border: highlightId === rev.id ? "1px solid rgba(37,99,235,.45)" : undefined, boxShadow: highlightId === rev.id ? "0 0 0 1px rgba(37,99,235,.15)" : undefined }}>
              <div style={{ padding: "12px 15px", borderBottom: "1px solid var(--b1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{place}</div>
                  {rev.orderId && <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 2 }}>Заказ {rev.orderId}</div>}
                </div>
                {(rev.adminReply || rev.restReply) && (
                  <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 8, background: "rgba(37,99,235,.12)", color: "var(--blue)", border: "1px solid rgba(37,99,235,.25)" }}>Есть ответ</span>
                )}
              </div>
              <div style={{ padding: "14px 15px" }}>
                <ClientReviewBlock review={rev} embedded restaurants={restaurants} />
                {rev.orderId && (
                  <button onClick={() => go("orders", { orderId: rev.orderId })} className="btn" style={{ width: "100%", marginTop: 4, padding: 10, fontSize: 12, borderRadius: 12, background: "var(--l3)", border: "1px solid var(--b1)", color: "var(--t2)" }}>
                    Открыть заказ {rev.orderId}
                  </button>
                )}
              </div>
            </div>
          );
        })}
          </div>
      <Nav page="profile" go={go} user={user}/>
    </div>
  );
};

const PromoCategoryCard = ({ cat, maxDisc, onClick, animDelay = 0 }) => {
  const light = true;
  const shortLabel = cat.label.split(" ")[0];
  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: 18,
        background: cat.bg,
        border: `1px solid ${cat.color}28`,
        padding: "14px 14px 12px",
        cursor: "pointer",
        minHeight: 110,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        animation: `fadeUp .45s cubic-bezier(.16,1,.3,1) ${animDelay}s both`,
      }}
    >
              <div>
        <div style={{ fontSize: 30, marginBottom: 8, lineHeight: 1 }}>{cat.e}</div>
        <div className="ub" style={{ fontSize: 15, fontWeight: 800, color: light ? "var(--t1)" : "#fff", lineHeight: 1.2 }}>{shortLabel}</div>
                  </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
        <span style={{
          padding: "4px 10px",
          borderRadius: 8,
          background: `${cat.color}22`,
          border: `1px solid ${cat.color}40`,
          fontSize: 12,
          fontWeight: 800,
          color: cat.color,
        }}>−{maxDisc}%</span>
        <span style={{ fontSize: 15, color: light ? "var(--t3)" : "rgba(255,255,255,.4)", fontWeight: 300 }}>→</span>
                </div>
              </div>
  );
};

const PromoFlashCard = ({ p, cart, onAdd, onRm, disc, stockLabel, stockPct, catLabel, go }) => {
  const light = true;
  const qty = cart[p.id] || 0;
  const photo = resolveProductPhoto(p, { preferThumb: true });
                return (
    <div
      onClick={() => go("product", { id: p.id })}
      style={{
        width: 158,
        height: 252,
        flexShrink: 0,
        borderRadius: 18,
        overflow: "hidden",
        background: softAccentSurface('#DC2626', light, "linear-gradient(160deg,#1A0808 0%,#2A1018 55%,#120608 100%)"),
        border: "1px solid rgba(195,52,52,.22)",
        boxShadow: "0 8px 28px rgba(195,52,52,.08)",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ height: 88, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 44, position: "relative", background: softFromDarkGrad(p.grad || "rgba(195,52,52,.06)", light, '#DC2626'), overflow: "hidden" }}>
        {photo
          ? <img src={photo} alt={p.name} loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "center", display: "block", padding: 6, boxSizing: "border-box", animation: "float 3s ease-in-out infinite" }} />
          : <span style={{ animation: "float 3s ease-in-out infinite" }}>{p.e}</span>}
        <div className="ub" style={{ position: "absolute", top: 8, left: 8, padding: "3px 8px", borderRadius: 8, background: "var(--red)", fontSize: 10, fontWeight: 900, color: "#fff", zIndex: 1 }}>−{disc}%</div>
                    </div>
      <div style={{ padding: "10px 11px 11px", flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: catLabel ? "rgba(195,52,52,.85)" : "transparent", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4, minHeight: 11, lineHeight: 1 }}>
          {catLabel || "·"}
                      </div>
        <div style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.35, height: 30, marginBottom: 6, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{p.name}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginBottom: 6 }}>
          <span className="ub" style={{ fontSize: 14, fontWeight: 900, color: "#FF6B6B" }}>{Number(p.price).toFixed(2)}<span style={{ fontSize: 12, color: "var(--t2)", marginLeft: 2 }}> ЅМ</span></span>
          {p.old > p.price && <span style={{ fontSize: 10, color: "var(--t3)", textDecoration: "line-through" }}>{Number(p.old).toFixed(2)}</span>}
                    </div>
        <div style={{ minHeight: 22, marginBottom: 8 }}>
          {stockLabel ? (
            <>
              <div style={{ height: 3, background: "var(--b1)", borderRadius: 2, marginBottom: 4 }}>
                <div style={{ height: "100%", width: `${stockPct ?? 50}%`, background: "linear-gradient(90deg,#C33434,#FF8C6B)", borderRadius: 2 }}/>
              </div>
              <div style={{ fontSize: 9, color: "var(--t3)", lineHeight: 1.2 }}>{stockLabel}</div>
            </>
          ) : null}
        </div>
        <div style={{ marginTop: "auto" }}>
          {qty === 0 ? (
            <button
              onClick={e => { e.stopPropagation(); onAdd(p.id); }}
              className="btn"
              style={{ width: "100%", padding: "8px", fontSize: 11, borderRadius: 10, background: "linear-gradient(135deg,#C33434,var(--red))", color: "#fff", fontWeight: 700 }}
            >
              + В корзину
            </button>
          ) : (
            <div
              onClick={e => e.stopPropagation()}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(195,52,52,.12)", border: "1px solid rgba(195,52,52,.25)", borderRadius: 10, padding: "3px 6px" }}
            >
              <button onClick={() => onRm(p.id)} className="btn" style={{ width: 26, height: 26, borderRadius: 7, background: "transparent", color: "var(--red)", fontSize: 16 }}>−</button>
              <span className="ub" style={{ fontSize: 12, fontWeight: 900, color: "var(--red)" }}>{formatCartQtyStepper(p, qty)}</span>
              <button onClick={() => onAdd(p.id)} className="btn" style={{ width: 26, height: 26, borderRadius: 7, background: "transparent", color: "var(--red)", fontSize: 16 }}>+</button>
            </div>
          )}
        </div>
                    </div>
                  </div>
                );
};

const PromosPage = ({ go, cart, onAdd, onRm, onWish, wished = {}, user }: any) => {
  const light = true;
  const { prods, catalogReady, promosReady } = useLiveCatalog();
  const { cats, rootCats, ready: catsReady } = useStoreCategories();
  const apiPromos = usePromos(s => s.promos) || [];
  const { isVip } = resolveUserVip(user);
  const [selectedCat, setSelectedCat] = useState(null);
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const parentCatForProduct = p => {
    const slug = productCatSlug(p);
    const cat = cats.find(c => c.id === slug);
    if (!cat) return null;
    return cat.parentId || cat.id;
  };
  const catMetaForProduct = p => {
    const pid = parentCatForProduct(p);
    return pid ? cats.find(c => c.id === pid) : null;
  };
  const findProductPromo = p => apiPromos.find(pr => pr.type === "product" && Number(pr.productId) === Number(p.id));
  const saleProds = useMemo(
    () => (prods || []).filter(isSaleProduct).sort((a, b) => saleDisc(b) - saleDisc(a)),
    [prods],
  );
  const flashProds = useMemo(
    () => saleProds.filter(p => {
      const promo = findProductPromo(p);
      return promo && inferScheduleMode(promo) === "flash";
    }),
    [saleProds, apiPromos],
  );
  const saleByCategory = useMemo(() => {
    const used = new Set();
    const groups = [];
    for (const cat of rootCats) {
      const items = saleProds.filter(p => parentCatForProduct(p) === cat.id);
      if (!items.length) continue;
      items.forEach(p => used.add(p.id));
      groups.push({
        cat,
        items,
        maxDisc: Math.max(...items.map(saleDisc)),
      });
    }
    const other = saleProds.filter(p => !used.has(p.id));
    if (other.length) {
      groups.push({
        cat: { id: "_other", e: "🏷️", label: "Другие акции", color: "var(--gr)", bg: "var(--l2)" },
        items: other,
        maxDisc: Math.max(...other.map(saleDisc)),
      });
    }
    return groups;
  }, [saleProds, cats, rootCats]);
  const totalQty = formatCartBadgeCount(sumCartUnits(cart, prods));
  const totalQtyNum = sumCartUnits(cart, prods);
  const promosBoot = USE_API && (!catalogReady || !promosReady || !catsReady);
  const activeGroup = selectedCat ? saleByCategory.find(g => g.cat.id === selectedCat) : null;

  if (promosBoot) {
    return (
      <div data-store-page style={{ minHeight: "100vh", background: "var(--bg)", maxWidth:'var(--store-w)', margin: "0 auto" }}>
        <header data-store-header style={{ position: "sticky", top: 0, zIndex: 100, background: "var(--header-bg)", backdropFilter: "blur(24px)", borderBottom: "1px solid var(--b1)" }}>
          <div style={{ padding: "13px 18px 12px", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "var(--gr)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Unbounded", fontSize: 17, fontWeight: 900, color: "var(--bg)", flexShrink: 0 }}>K</div>
            <div style={{ flex: 1 }}>
              <div className="ub" style={{ fontSize: 16, fontWeight: 900 }}>Акции</div>
              <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 2 }}>Загрузка…</div>
            </div>
            <CartHeaderButton count={totalQty} qtyNum={totalQtyNum} onClick={() => go("cart")} isVip={isVip} />
          </div>
        </header>
        <div style={{ textAlign: "center", padding: "72px 24px 110px" }}>
          <div style={{ fontSize: 52, marginBottom: 16, animation: "float 3s ease-in-out infinite" }}>🏷️</div>
          <div className="ub" style={{ fontSize: 17, fontWeight: 800, marginBottom: 8 }}>Загрузка акций…</div>
          <div style={{ fontSize: 13, color: "var(--t2)" }}>Подождите немного</div>
                    </div>
        <Nav page="promos" go={go} user={user}/>
                  </div>
    );
  }

  if (activeGroup) {
    const { cat, items } = activeGroup;
    return (
      <div data-store-page style={{ minHeight: "100vh", background: "var(--bg)", maxWidth:'var(--store-w)', margin: "0 auto" }}>
        <header data-store-header style={{ position: "sticky", top: 0, zIndex: 100, background: "var(--header-bg)", backdropFilter: "blur(24px)", borderBottom: "1px solid var(--b1)" }}>
          <div style={{ padding: "13px 18px 12px", display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => setSelectedCat(null)} className="btn" style={{ width: 44, height: 44, borderRadius: 12, background: "var(--l3)", border: "1px solid var(--b1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Ic n="arrL" s={17} c="var(--t2)"/>
            </button>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: cat.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{cat.e}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ub" style={{ fontSize: 15, fontWeight: 800 }}>{cat.label}</div>
              <div style={{ fontSize: 10, color: "var(--t3)", marginTop: 2 }}>Только акционные · {formatProductCount(items.length)}</div>
                </div>
            <CartHeaderButton count={totalQty} qtyNum={totalQtyNum} onClick={() => go("cart")} isVip={isVip} />
            </div>
        </header>
        <div style={{ padding: "14px 18px 110px" }}>
          {items.length === 0 ? (
            <div style={{ textAlign: "center", padding: "52px 22px" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🏷️</div>
              <div className="ub" style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>Акций в этой категории нет</div>
              <button onClick={() => setSelectedCat(null)} className="btn" style={{ padding: "12px 24px", borderRadius: 14, background: "var(--l2)", border: "1px solid var(--b1)", color: "var(--t2)", fontSize: 13 }}>← Назад к акциям</button>
            </div>
          ) : (
            <div className="store-prod-grid" style={{ alignItems: "stretch" }}>
              {items.map((p, i) => (
                <div key={p.id} style={{ animation: `fadeUp .4s cubic-bezier(.16,1,.3,1) ${Math.min(i, 8) * .04}s both`, height: "100%" }}>
                  <PCard p={p} cart={cart} onAdd={onAdd} onRm={onRm} onWish={onWish} wished={!!wished?.[p.id]} go={go}/>
                </div>
              ))}
          </div>
        )}
                  </div>
        {totalQtyNum > 0 && <FloatingCartBtn count={totalQty} onClick={() => go("cart")} isVip={isVip} />}
        <Nav page="promos" go={go} user={user}/>
      </div>
    );
  }

  return (
    <div data-store-page style={{ minHeight: "100vh", background: "var(--bg)", maxWidth:'var(--store-w)', margin: "0 auto" }}>
      <Header title="Акции" go={go} cart={cart} user={user}/>
      <div className="store-page-pad" style={{ padding: "14px 16px 0" }}>
        {saleProds.length === 0 ? (
          <EmptyState
            icon="🏷️"
            title="Акций пока нет"
            text="Как только магазин запустит скидки, товары появятся здесь — с ценой до и после."
            actionLabel="Перейти в каталог"
            onAction={() => go("catalog")}
          />
        ) : (
          <>
            {flashProds.length > 0 && (
              <section style={{ marginBottom: 22 }}>
                <div style={{ borderRadius: 20, padding: "16px 16px 14px", background: softAccentSurface('#DC2626', light, "linear-gradient(135deg,#180606,#2A0C0C 50%,#120404)"), border: "1px solid rgba(195,52,52,.2)", boxShadow: "0 10px 32px rgba(195,52,52,.06)" }}>
                  <div style={{ marginBottom: 12 }}>
                    <div className="ub" style={{ fontSize: 15, fontWeight: 900, color: light ? "var(--red)" : "var(--red)", marginBottom: 4 }}>⚡ Флэш-распродажа</div>
                    <div style={{ fontSize: 11, color: light ? "var(--t2)" : "rgba(195,52,52,.55)" }}>Быстрые скидки — успейте забрать</div>
                  </div>
                  <div className="hscroll" style={{ gap: 10, margin: "0 -4px", padding: "0 2px 2px" }}>
                    {flashProds.map(p => {
                      const promo = findProductPromo(p);
                      const cat = catMetaForProduct(p);
                      return (
                        <PromoFlashCard
                          key={p.id}
                          p={p}
                          cart={cart}
                          onAdd={onAdd}
                          onRm={onRm}
                          disc={saleDisc(p)}
                          stockLabel={promo ? formatPromoStockLeft(promo, p) : null}
                          stockPct={p.promoStockPct ?? (p.promoStockLeft != null ? 0 : null)}
                          catLabel={cat ? cat.label.split(" ")[0] : null}
                          go={go}
                        />
                      );
                    })}
                  </div>
                </div>
              </section>
            )}

            {saleByCategory.length > 0 && (
              <section>
                <div className="store-sec-head"><div className="ub store-sec-title">По категориям</div></div>
                <div className="store-tile-grid">
                  {saleByCategory.map(({ cat, maxDisc }, i) => (
                    <PromoCategoryCard
                      key={cat.id}
                      cat={cat}
                      maxDisc={maxDisc}
                      onClick={() => setSelectedCat(cat.id)}
                      animDelay={i * 0.04}
                    />
              ))}
            </div>
              </section>
            )}
          </>
        )}
              </div>
      {totalQtyNum > 0 && <FloatingCartBtn count={totalQty} onClick={() => go("cart")} isVip={isVip} />}
      <Nav page="promos" go={go} user={user}/>
            </div>
  );
};

const WishlistPage = ({ go, cart, onAdd, onRm, onWish, wished, user }: any) => {
  const { prods, catalogReady } = useLiveCatalog();
  const { isVip } = resolveUserVip(user);
  const items = useMemo(
    () => prods.filter(p => wished?.[p.id]),
    [prods, wished],
  );
  const totalQty = formatCartBadgeCount(sumCartUnits(cart, prods));
  const totalQtyNum = sumCartUnits(cart, prods);
  const loading = USE_API && !catalogReady && items.length === 0 && Object.keys(wished || {}).some(k => wished[k]);
  return (
    <div data-store-page style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:"var(--store-w)", margin:"0 auto" }}>
      <Header title="Избранное" back="profile" go={go} cart={cart} user={user} hideSearch/>
      <div className="store-page-pad" style={{ padding:"14px 16px 0" }}>
        {loading ? (
          <ProductSkeletonGrid count={4}/>
        ) : items.length === 0 ? (
          <EmptyState
            icon="❤️"
            title="Избранное пусто"
            text="Нажмите на сердечко в карточке товара — он появится здесь."
            actionLabel="Перейти в каталог"
            onAction={() => go("catalog")}
          />
        ) : (
          <>
            <div style={{ fontSize:12, color:"var(--t2)", marginBottom:12 }}>{formatProductCount(items.length)}</div>
            <div className="store-prod-grid" style={{ alignItems:"stretch" }}>
              {items.map(p => <PCard key={p.id} p={p} cart={cart} onAdd={onAdd} onRm={onRm} onWish={onWish} wished={!!wished[p.id]} go={go}/>)}
            </div>
          </>
        )}
      </div>
      {totalQtyNum > 0 && <FloatingCartBtn count={totalQty} onClick={() => go("cart")} isVip={isVip} />}
      <Nav page="profile" go={go} user={user}/>
    </div>
  );
};
const SearchPage = ({ go, cart, onAdd, onRm, user }: any) => {
  const light = true;
  const { prods, catalogReady } = useLiveCatalog();
  const { isVip } = resolveUserVip(user, light);
  const [query, setQuery] = useState(() => readSearchQuery());
  const topProducts = useTopProducts(prods, 8);
  const iRef = useRef<any>(null);
  useEffect(() => {
    const t = setTimeout(() => { iRef.current?.focus(); writeSearchQuery(query) }, 100);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => { writeSearchQuery(query) }, [query]);
  const norm = query.trim().toLowerCase();
  const results = useMemo(
    () => (norm ? (prods || []).filter(p => String(p.name || "").toLowerCase().includes(norm)) : []),
    [prods, norm],
  );
  const totalQty = formatCartBadgeCount(sumCartUnits(cart, prods));
  const totalQtyNum = sumCartUnits(cart, prods);
  const loading = USE_API && !catalogReady;
  const clear = () => { setQuery(""); writeSearchQuery("") };
  return (
    <div data-store-page style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:"var(--store-w)", margin:"0 auto" }}>
      <header data-store-header style={{ position:"sticky", top:0, zIndex:100, background:"var(--header-bg)", backdropFilter:"blur(20px)", borderBottom:"1px solid var(--b1)" }}>
        <div style={{ padding:"10px 16px", display:"flex", alignItems:"center", gap:10 }}>
          <button type="button" onClick={() => storeBack("home", go)} className="btn hdr-icon" aria-label="Назад"><Ic n="arrL" s={18} c="var(--t1)"/></button>
          <form className="store-search" onSubmit={e => { e.preventDefault(); writeSearchQuery(query) }} role="search" style={{ flex:1, minWidth:0 }}>
            <Ic n="search" s={18} c="var(--t3)"/>
            <input ref={iRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Найти продукты" aria-label="Поиск продуктов" type="search" enterKeyHint="search"/>
            {query ? <button type="button" onClick={clear} aria-label="Очистить поиск"><Ic n="x" s={16} c="var(--t3)"/></button> : null}
          </form>
          {totalQtyNum > 0 && <CartHeaderButton count={totalQty} qtyNum={totalQtyNum} onClick={() => go("cart")} isVip={isVip} />}
        </div>
      </header>
      <div className="store-page-pad" style={{ padding:"16px 16px 0" }}>
        {loading && <ProductSkeletonGrid count={6}/>}

        {!loading && !norm && topProducts.length > 0 && (
          <div>
            <div className="ub" style={{ fontSize:13, fontWeight:700, color:"var(--t2)", marginBottom:12 }}>Часто покупают</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:24 }}>
              {topProducts.map(p => (
                <button key={p.id} type="button" onClick={() => { setQuery(p.name) }} className="btn chip">{p.name}</button>
              ))}
            </div>
          </div>
        )}

        {!loading && norm && results.length === 0 && (
          <EmptyState
            icon="🔍"
            title="Ничего не найдено"
            text={`По запросу «${query.trim()}» товаров нет. Попробуйте другое название.`}
            actionLabel="Очистить поиск"
            onAction={clear}
          />
        )}

        {!loading && norm && results.length > 0 && (
          <div>
            <div style={{ fontSize:12, color:"var(--t2)", marginBottom:12 }}>Найдено: <span style={{ color:"var(--gr3)", fontWeight:700 }}>{formatProductCount(results.length)}</span></div>
            <div className="store-prod-grid" style={{ alignItems:"stretch" }}>
              {results.map(p => <PCard key={p.id} p={p} cart={cart} onAdd={onAdd} onRm={onRm} onWish={() => {}} wished={false} go={go}/>)}
            </div>
          </div>
        )}
      </div>
      {totalQtyNum > 0 && <FloatingCartBtn count={totalQty} onClick={() => go("cart")} isVip={isVip} />}
    </div>
  );
};
const FAQPage = ({ go }: any) => {
  const light = true;
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState("");
  const support = useSupportContacts();
  const { pricing } = usePricing();
  const items = useMemo(() => FAQ(pricing), [pricing]);
  const filtered = items.filter(f => q==="" || f.q.toLowerCase().includes(q.toLowerCase()) || f.a.toLowerCase().includes(q.toLowerCase()));
  return (
    <div data-store-page style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:'var(--store-w)', margin:"0 auto" }}>
      <header data-store-header style={{ position:"sticky", top:0, zIndex:100, background:"var(--header-bg)", backdropFilter:"blur(24px)", borderBottom:"1px solid var(--b1)" }}>
        <div style={{ padding:"14px 18px 10px", display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={() => storeBack("profile", go)} className="btn" style={{ width:38, height:38, borderRadius:12, background:"var(--l3)", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div className="ub" style={{ flex:1, fontSize:17, fontWeight:900 }}>FAQ</div>
        </div>
        <div style={{ padding:"0 18px 12px", position:"relative" }}>
          <div style={{ position:"absolute", left:30, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}><Ic n="search" s={15} c="var(--t3)"/></div>
          <input className="inp" value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск по вопросам..." style={{ paddingLeft:38, width:"100%" }}/>
        </div>
      </header>
      <div style={{ padding:"16px 18px 100px" }}>
        {!q && <div style={{ borderRadius:18, padding:"18px", marginBottom:20, background:softAccentSurface('#07883D', light, "linear-gradient(135deg,#061A0C,#0F3020)"), border:"1px solid rgba(7,136,61,.2)", display:"flex", alignItems:"center", justifyContent:"space-between" }}><div><div className="ub" style={{ fontSize:15, fontWeight:800, marginBottom:4 }}>Центр помощи</div><div style={{ fontSize:12, color:"var(--t2)" }}>Ответы на ваши вопросы о КАКАПО</div></div><div style={{ fontSize:40, animation:"float 3s ease-in-out infinite" }}>❓</div></div>}
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {filtered.map((f,i) => (
            <div key={i} style={{ background:"var(--l2)", border:`1px solid ${open===i?"rgba(7,136,61,.3)":"var(--b1)"}`, borderRadius:16, overflow:"hidden", transition:"border-color .2s", animation:`fadeUp .4s cubic-bezier(.16,1,.3,1) ${i*.04}s both` }}>
              <div onClick={() => setOpen(open===i?null:i)} style={{ padding:"15px", display:"flex", alignItems:"center", gap:12, cursor:"pointer" }}>
                <div style={{ width:30, height:30, borderRadius:9, background:open===i?"var(--gr-soft)":"var(--l3)", border:`1px solid ${open===i?"rgba(7,136,61,.3)":"var(--b1)"}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, transition:"all .2s" }}>
                  <Ic n={open===i?"minus":"plus"} s={14} c={open===i?"var(--gr)":"var(--t2)"} w={2.5}/>
                </div>
                <div style={{ flex:1, fontSize:13, fontWeight:700, color:open===i?"var(--gr)":"var(--t1)", lineHeight:1.38 }}>{f.q}</div>
              </div>
              {open===i && <div style={{ padding:"0 15px 15px 57px", fontSize:13, color:"var(--t2)", lineHeight:1.7, animation:"fadeIn .3s ease" }}>{f.a}</div>}
            </div>
          ))}
        </div>
        {filtered.length===0 && <div style={{ textAlign:"center", paddingTop:50 }}><div style={{ fontSize:50, marginBottom:14 }}>🔍</div><div className="ub" style={{ fontSize:16, fontWeight:800, marginBottom:8 }}>Не найдено</div><button onClick={() => setQ("")} className="btn" style={{ padding:"12px 24px", borderRadius:13, background:"var(--gr)", color:"white", fontSize:13 }}>Сбросить</button></div>}
        <div style={{ marginTop:20, background:"var(--l2)", border:"1px solid var(--b1)", borderRadius:18, padding:"16px" }}>
          <div className="ub" style={{ fontSize:13, fontWeight:800, marginBottom:4 }}>Не нашли ответ?</div>
          <div style={{ fontSize:12, color:"var(--t2)", marginBottom:14, lineHeight:1.6 }}>Наша поддержка в рабочие часы</div>
          {[{icon:"phone",l:"Позвонить",s:support.phone,c:"var(--gr)",href:support.phoneTel},{icon:"tg",l:"Telegram",s:support.telegramLabel,c:"#0369A1",href:support.telegram}].map((ct,i) => (
            <a key={i} href={ct.href} {...(ct.icon === 'tg' ? { target: '_blank', rel: 'noopener noreferrer' } : {})} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 0", borderBottom:i<1?"1px solid var(--b1)":"none", cursor:"pointer", textDecoration:"none", color:"inherit" }}>
              <div style={{ width:38, height:38, borderRadius:11, background:`${ct.c}14`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Ic n={ct.icon} s={18} c={ct.c}/></div>
              <div style={{ flex:1 }}><div style={{ fontSize:13, fontWeight:700 }}>{ct.l}</div><div style={{ fontSize:11, color:"var(--t2)", marginTop:1 }}>{ct.s}</div></div>
              <Ic n="arr" s={14} c="var(--t3)"/>
            </a>
          ))}
        </div>
      </div>
      <Nav page="profile" go={go}/>
    </div>
  );
};

type DebtTab = 'all' | 'debt' | 'pay'

function DebtSupportBlock({ debt, cardNum }: { debt: number; cardNum?: string }) {
  const s = useSupportContacts()
  return (
    <div style={{ marginTop: 14, padding: '14px', borderRadius: 14, background: 'rgba(37,99,235,.08)', border: '1px solid rgba(37,99,235,.25)' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--sky)', marginBottom: 6 }}>Погашение через поддержку</div>
      <div style={{ fontSize: 11, color: 'var(--t2)', lineHeight: 1.5, marginBottom: 12 }}>
        Чтобы погасить {debt.toLocaleString()} ЅМ, позвоните или напишите в поддержку — оператор подскажет способ оплаты и спишет долг.
        {cardNum && <> Назовите номер карты: <strong style={{ color: 'var(--t2)' }}>{cardNum}</strong>.</>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <a href={s.phoneTel} className="btn" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderRadius: 12, background: 'var(--gr-soft)', border: '1px solid rgba(7,136,61,.3)', textDecoration: 'none', color: 'inherit' }}>
          <div style={{ width: 40, height: 40, borderRadius: 11, background: 'rgba(7,136,61,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Ic n="phone" s={18} c="var(--gr)" />
          </div>
          <div style={{ flex: 1, textAlign: 'left' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--gr)' }}>Позвонить</div>
            <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 2 }}>{s.phone}</div>
          </div>
          <Ic n="arr" s={14} c="var(--t3)" />
        </a>
        <a href={s.telegram} target="_blank" rel="noopener noreferrer" className="btn" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderRadius: 12, background: 'rgba(2,132,199,.1)', border: '1px solid rgba(2,132,199,.28)', textDecoration: 'none', color: 'inherit' }}>
          <div style={{ width: 40, height: 40, borderRadius: 11, background: 'rgba(2,132,199,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Ic n="tg" s={18} c="#0369A1" />
          </div>
          <div style={{ flex: 1, textAlign: 'left' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#0369A1' }}>Telegram</div>
            <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 2 }}>{s.telegramLabel}</div>
          </div>
          <Ic n="arr" s={14} c="var(--t3)" />
        </a>
      </div>
      <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 10, textAlign: 'center' }}>{s.hours}</div>
    </div>
  )
}

function VipSupportBlock() {
  const s = useSupportContacts()
  return (
    <div style={{ background: 'var(--l2)', border: '1px solid var(--b1)', borderRadius: 18, padding: '18px', marginBottom: 16 }}>
      <div className="ub" style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>📞 Поддержка VIP</div>
      <div style={{ fontSize: 11, color: 'var(--t2)', lineHeight: 1.55, marginBottom: 12 }}>
        Помощь по заказам, бонусам и долгу — без очереди, по телефону или в Telegram.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <a href={s.phoneTel} className="btn" style={{ flex: 1, padding: '12px 10px', borderRadius: 12, background: 'var(--gr-soft)', border: '1px solid rgba(7,136,61,.3)', textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
          <Ic n="phone" s={18} c="var(--gr)" />
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--gr)' }}>Позвонить</span>
        </a>
        <a href={s.telegram} target="_blank" rel="noopener noreferrer" className="btn" style={{ flex: 1, padding: '12px 10px', borderRadius: 12, background: 'rgba(2,132,199,.1)', border: '1px solid rgba(2,132,199,.28)', textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
          <Ic n="tg" s={18} c="#0369A1" />
          <span style={{ fontSize: 10, fontWeight: 700, color: '#0369A1' }}>Telegram</span>
        </a>
      </div>
      <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 10, textAlign: 'center' }}>{s.hours}</div>
    </div>
  )
}

function DebtBottomSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div className="store-sheet-backdrop" style={{ zIndex: 300 }} onClick={onClose}>
      <div className="store-sheet" onClick={e => e.stopPropagation()} style={{ padding: "20px 20px calc(36px + env(safe-area-inset-bottom, 0px))" }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--b2)', margin: '0 auto 18px' }} />
        {children}
      </div>
    </div>
  )
}

function VipDebtSection({
  phone,
  cardNum,
  creditUsed,
  creditLimit,
  apiOrders = [],
  loyaltyProfile,
}: {
  phone?: string
  cardNum?: string
  creditUsed: number
  creditLimit: number
  apiOrders?: import('@/lib/types').Order[]
  loyaltyProfile?: { level?: string; vip?: boolean } | null
}) {
  const { prods } = useLiveCatalog()
  const [tab, setTab] = useState<DebtTab>('all')
  const [histTick, setHistTick] = useState(0)
  const [ledger, setLedger] = useState<DebtLedgerResponse | null>(null)
  const [payDetail, setPayDetail] = useState<import('@/lib/clientVipCredit').DebtHistoryEntry | null>(null)
  const [orderDetail, setOrderDetail] = useState<{
    hist: import('@/lib/clientVipCredit').DebtHistoryEntry
    order: ReturnType<typeof mapOrdersForClient>[number] | null
  } | null>(null)

  const clientOrders = useMemo(
    () => mapOrdersForClient(apiOrders, loyaltyProfile),
    [apiOrders, loyaltyProfile?.level, loyaltyProfile?.vip],
  )

  useEffect(() => subscribeDebtHistory(() => setHistTick(t => t + 1)), [])

  useEffect(() => {
    if (!phone || !USE_API) {
      setLedger(null)
      return
    }
    let cancelled = false
    void api.getDebtLedger(phone)
      .then(data => { if (!cancelled) setLedger(data) })
      .catch(() => { if (!cancelled) setLedger(null) })
    return () => { cancelled = true }
  }, [phone, histTick])

  const history = useMemo(() => {
    if (!phone) return []
    const key = phoneDigits(phone)
    const fromServer: DebtHistoryEntry[] = apiOrders
      .filter(order =>
        phoneDigits(order.client?.phone || '') === key
        && (Number(order.creditAmount) || 0) > 0,
      )
      .map(order => {
        const ts = Date.parse(order.createdAtIso || order.createdAt || '') || Date.now()
        const when = new Date(ts)
        const note = String(order.comment || '').trim()
        const isPos = order.channel === 'pos'
        const defaultNote = note === 'Покупка в магазине' ? '' : note
        return {
          id: `SERVER-DEBT-${order.id}`,
          orderId: order.id,
          date: when.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }),
          time: when.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
          ts,
          desc: defaultNote
            ? `${isPos ? 'Касса' : `Заказ ${order.id}`} · ${defaultNote}`
            : (isPos ? `Касса · чек ${order.id}` : `Заказ ${order.id}`),
          amount: -Math.abs(Number(order.creditAmount) || 0),
          type: 'debt' as const,
          itemsSummary: (order.items || [])
            .slice(0, 5)
            .map(item => `${item.name} ×${item.qty}`)
            .join(', '),
        }
      })

    // Старые локальные записи и серверные чеки объединяем без дублей.
    const merged = [...fromServer, ...loadDebtHistory(phone)]
    const seenOrders = new Set<string>()
    return merged
      .filter(row => {
        if (!row.orderId) return true
        if (seenOrders.has(row.orderId)) return false
        seenOrders.add(row.orderId)
        return true
      })
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
  }, [phone, creditUsed, histTick, apiOrders])

  const ledgerUnpaid = useMemo((): DebtOrderBalance[] | null => {
    if (!ledger?.entries?.length) return null
    return ledger.entries
      .filter(e => e.status === 'open' || e.status === 'overdue')
      .map(e => {
        const ts = Date.parse(e.createdAtIso) || Date.now()
        const when = new Date(ts)
        return {
          id: e.id,
          orderId: e.orderId || e.saleId,
          date: when.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }),
          time: when.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
          ts,
          desc: e.desc || 'Долг',
          amount: -e.remaining,
          type: 'debt' as const,
          originalAmount: e.amount,
          paidAmount: e.paidAmount,
          remainingAmount: e.remaining,
          partial: e.paidAmount > 0.001,
          dueAtIso: e.dueAtIso,
          dueDate: e.dueDate,
          daysLeft: e.daysLeft,
          overdue: e.overdue,
        }
      })
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
  }, [ledger])

  const unpaidOrders = useMemo(
    () => ledgerUnpaid ?? buildDebtOrderBalances(history).unpaid,
    [ledgerUnpaid, history],
  )

  const historyList = useMemo(() => {
    if (tab === 'debt') return history.filter(h => h.type === 'debt' || h.type === 'purchase')
    if (tab === 'pay') return history.filter(h => h.type === 'pay')
    return history
  }, [history, tab])

  const totals = useMemo(() => debtHistoryTotals(history), [history])
  const available = Math.max(0, creditLimit - creditUsed)

  const tabs: { id: DebtTab; label: string; icon: string }[] = [
    { id: 'all', label: 'Все', icon: '📋' },
    { id: 'debt', label: 'Заказы', icon: '🛒' },
    { id: 'pay', label: 'Оплаты', icon: '✅' },
  ]

  const handleRowClick = (h: import('@/lib/clientVipCredit').DebtHistoryEntry) => {
    if (h.type === 'debt' && h.orderId) {
      const order = clientOrders.find(o => o.id === h.orderId) || null
      setOrderDetail({ hist: h, order })
      return
    }
    if (h.type === 'pay' || h.type === 'purchase') setPayDetail(h)
  }

  const renderUnpaidRow = (b: DebtOrderBalance, i: number) => {
    const clickable = !!b.orderId
    return (
      <button
        key={b.id || `unpaid-${i}`}
        type="button"
        onClick={() => clickable && handleRowClick(b)}
        className="btn"
        style={{
          width: '100%', textAlign: 'left', padding: '13px 14px', borderRadius: 14,
          background: 'var(--l3)',
          border: `1px solid ${b.partial ? 'rgba(233,174,0,.28)' : 'rgba(195,52,52,.28)'}`,
          display: 'flex', alignItems: 'center', gap: 12,
          cursor: clickable ? 'pointer' : 'default',
          animation: `fadeUp .3s ease ${i * 0.03}s both`,
        }}
      >
        <div style={{
          width: 44, height: 44, borderRadius: 13, flexShrink: 0,
          background: b.partial ? 'rgba(233,174,0,.12)' : 'var(--red-soft)',
          border: `1px solid ${b.partial ? 'rgba(233,174,0,.28)' : 'rgba(195,52,52,.25)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
        }}>
          🛒
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--t1)' }}>
              {b.desc || b.orderId || 'Заказ в долг'}
            </span>
            <span style={{
              fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 5,
              background: b.partial ? 'rgba(233,174,0,.15)' : 'rgba(195,52,52,.15)',
              color: b.partial ? 'var(--gd)' : 'var(--red)',
            }}>
              {b.partial ? 'частично' : 'не оплачен'}
            </span>
          </div>
          {b.orderId && b.desc && (
            <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 3 }}>
              Чек {b.orderId}
            </div>
          )}
          {b.itemsSummary && (
            <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {b.itemsSummary}
            </div>
          )}
          <div style={{ fontSize: 10, color: 'var(--t3)' }}>
            {b.date}{b.time ? ` · ${b.time}` : ''}
          </div>
          {b.dueDate && (
            <div style={{
              fontSize: 10,
              color: b.overdue ? 'var(--red)' : 'var(--gd)',
              marginTop: 4,
              fontWeight: 700,
            }}>
              {b.overdue
                ? `Просрочено · было до ${b.dueDate}`
                : `Погасить до ${b.dueDate}${b.daysLeft != null && b.daysLeft >= 0 ? ` · ${b.daysLeft} дн.` : ''}`}
            </div>
          )}
          {b.partial && (
            <div style={{ fontSize: 10, color: 'var(--gr)', marginTop: 4, fontWeight: 700 }}>
              Оплачено {b.paidAmount.toLocaleString()} из {b.originalAmount.toLocaleString()} ЅМ
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <div>
            <div className="ub" style={{ fontSize: 15, fontWeight: 900, color: 'var(--red)' }}>
              −{b.remainingAmount.toLocaleString()} ЅМ
            </div>
            <div style={{ fontSize: 9, color: 'var(--t3)', marginTop: 2 }}>
              {b.partial ? 'осталось' : 'в долг'}
            </div>
            {b.partial && (
              <div style={{ fontSize: 9, color: 'var(--t3)', marginTop: 2, textDecoration: 'line-through', opacity: .7 }}>
                {b.originalAmount.toLocaleString()} ЅМ
              </div>
            )}
          </div>
          {clickable && <Ic n="arr" s={14} c="var(--t3)" />}
        </div>
      </button>
    )
  }

  const renderHistoryRow = (h: import('@/lib/clientVipCredit').DebtHistoryEntry, i: number) => {
    const isPay = h.type === 'pay'
    const isPurchase = h.type === 'purchase'
    const settled = isPay || isPurchase
    const clickable = !!(isPay || isPurchase || h.orderId)
    return (
      <button
        key={h.id || `hist-${i}`}
        type="button"
        onClick={() => clickable && handleRowClick(h)}
        className="btn"
        style={{
          width: '100%', textAlign: 'left', padding: '13px 14px', borderRadius: 14,
          background: settled ? 'rgba(7,136,61,.06)' : 'var(--l3)',
          border: `1px solid ${settled ? 'rgba(7,136,61,.22)' : 'rgba(233,174,0,.18)'}`,
          display: 'flex', alignItems: 'center', gap: 12,
          cursor: clickable ? 'pointer' : 'default',
          opacity: clickable ? 1 : 0.85,
          animation: `fadeUp .3s ease ${i * 0.03}s both`,
        }}
      >
        <div style={{
          width: 44, height: 44, borderRadius: 13, flexShrink: 0,
          background: settled ? 'var(--gr-soft)' : 'rgba(233,174,0,.12)',
          border: `1px solid ${settled ? 'rgba(7,136,61,.25)' : 'rgba(233,174,0,.25)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
        }}>
          {isPurchase ? '🏪' : settled ? '✅' : '🛒'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--t1)' }}>
              {isPurchase
                ? (h.desc || 'Покупка в магазине')
                : isPay
                  ? (h.desc || 'Погашение через поддержку')
                  : (h.desc || h.orderId || 'Заказ в долг')}
            </span>
            {isPurchase && (
              <span style={{
                fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 5,
                background: 'rgba(7,136,61,.15)', color: 'var(--gr)',
              }}>касса</span>
            )}
            {!isPay && !isPurchase && (
              <span style={{
                fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 5,
                background: 'rgba(233,174,0,.15)', color: 'var(--t2)',
              }}>VIP</span>
            )}
          </div>
          {h.itemsSummary && (
            <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {h.itemsSummary}
            </div>
          )}
          <div style={{ fontSize: 10, color: 'var(--t3)' }}>
            {h.date}{h.time ? ` · ${h.time}` : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <div>
            <div className="ub" style={{ fontSize: 15, fontWeight: 900, color: settled ? 'var(--gr)' : 'var(--red)' }}>
              {settled ? '' : '−'}{Math.abs(h.amount).toLocaleString()} ЅМ
            </div>
            <div style={{ fontSize: 9, color: 'var(--t3)', marginTop: 2 }}>
              {isPurchase ? 'покупка' : settled ? 'оплачено' : 'в долг'}
            </div>
          </div>
          {clickable && <Ic n="arr" s={14} c="var(--t3)" />}
        </div>
      </button>
    )
  }

  const scrollBoxStyle = {
    flex: '1 1 auto',
    minHeight: 0,
    maxHeight: 'min(280px, 40vh)',
    overflowY: 'auto' as const,
    WebkitOverflowScrolling: 'touch' as const,
    overscrollBehavior: 'contain' as const,
    padding: '10px 12px 14px',
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', border: '1px solid rgba(233,174,0,.28)', boxShadow: '0 8px 32px rgba(233,174,0,.08)' }}>
        {/* Шапка — текущий долг */}
        <div style={{
          flexShrink: 0,
          padding: '18px 16px',
          background: creditUsed > 0
            ? 'linear-gradient(135deg, rgba(195,52,52,.12) 0%, rgba(26,16,0,.6) 100%)'
            : 'linear-gradient(135deg, var(--gr-soft) 0%, rgba(26,16,0,.5) 100%)',
          borderBottom: '1px solid var(--b1)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: .5 }}>
                {creditUsed > 0 ? 'Сейчас в долгу' : 'Долга нет'}
              </div>
              <div className="ub" style={{ fontSize: 32, fontWeight: 900, color: creditUsed > 0 ? 'var(--red)' : 'var(--gr)', lineHeight: 1 }}>
                {creditUsed.toLocaleString()}<span style={{ fontSize: 14, marginLeft: 4, opacity: .8 }}>ЅМ</span>
              </div>
              {creditLimit > 0 && (
                <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 6 }}>
                  Доступно ещё <span style={{ color: 'var(--gr)', fontWeight: 700 }}>{available.toLocaleString()} ЅМ</span> из {creditLimit.toLocaleString()} ЅМ
                </div>
              )}
              {ledger?.termDays ? (
                <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 6 }}>
                  Срок погашения каждого долга — {ledger.termDays} дней
                </div>
              ) : null}
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 2 }}>Всего взято</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--red)' }}>{totals.borrowed.toLocaleString()} ЅМ</div>
              <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 8, marginBottom: 2 }}>Погашено</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--gr)' }}>{totals.repaid.toLocaleString()} ЅМ</div>
            </div>
          </div>

          {ledger?.creditBlocked && (
            <div style={{
              marginTop: 14, padding: '12px 14px', borderRadius: 12,
              background: 'rgba(195,52,52,.12)', border: '1px solid rgba(195,52,52,.35)',
              fontSize: 12, fontWeight: 700, color: 'var(--red)', lineHeight: 1.45,
            }}>
              🚫 Новый долг закрыт из-за повторной просрочки. Погасите текущий долг в магазине.
            </div>
          )}

          {creditUsed > 0 && ledger?.nextDueDate && !ledger.creditBlocked && (
            <div style={{
              marginTop: 14, padding: '12px 14px', borderRadius: 12,
              background: ledger.entries.some(e => e.overdue)
                ? 'var(--red-soft)'
                : 'rgba(233,174,0,.1)',
              border: `1px solid ${ledger.entries.some(e => e.overdue) ? 'rgba(195,52,52,.35)' : 'rgba(233,174,0,.28)'}`,
              fontSize: 12, fontWeight: 700,
              color: ledger.entries.some(e => e.overdue) ? 'var(--red)' : 'var(--gd)',
              lineHeight: 1.45,
            }}>
              {ledger.entries.some(e => e.overdue)
                ? '⚠ Есть просроченные долги — погасите срочно.'
                : `⏳ Ближайший срок: ${ledger.nextDueDate}${ledger.nextDueDaysLeft != null && ledger.nextDueDaysLeft >= 0 ? ` · осталось ${ledger.nextDueDaysLeft} дн.` : ''}`}
            </div>
          )}

          {creditUsed > 0 && <DebtSupportBlock debt={creditUsed} cardNum={cardNum} />}
        </div>
      </div>

      {/* Не оплачено — отдельный блок */}
      <div className="card" style={{
        marginBottom: 12, display: 'flex', flexDirection: 'column',
        border: '1px solid rgba(195,52,52,.28)', boxShadow: '0 6px 24px rgba(195,52,52,.06)',
      }}>
        <div style={{
          flexShrink: 0, padding: '14px 16px', borderBottom: '1px solid var(--b1)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div className="ub" style={{ fontSize: 14, fontWeight: 800, color: 'var(--red)' }}>⚠ Не оплачено</div>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)' }}>{unpaidOrders.length}</span>
        </div>
        <div style={scrollBoxStyle}>
          {unpaidOrders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 12px' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gr)' }}>Все долги оплачены</div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>Активных заказов в долг нет</div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 8, paddingLeft: 4 }}>
                Нажмите на заказ — откроются детали
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {unpaidOrders.map((b, i) => renderUnpaidRow(b, i))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Вся история — отдельный блок */}
      <div className="card" style={{
        marginBottom: 16, display: 'flex', flexDirection: 'column',
        border: '1px solid rgba(233,174,0,.28)', boxShadow: '0 8px 32px rgba(233,174,0,.08)',
      }}>
        <div style={{
          flexShrink: 0, padding: '14px 16px', borderBottom: '1px solid var(--b1)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div className="ub" style={{ fontSize: 14, fontWeight: 800, color: 'var(--t2)' }}>📋 История</div>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)' }}>{history.length}</span>
        </div>

        {/* Фильтры */}
        <div style={{ flexShrink: 0, display: 'flex', gap: 6, padding: '12px 14px', borderBottom: '1px solid var(--b1)' }}>
          {tabs.map(t => {
            const count = t.id === 'all'
              ? history.length
              : t.id === 'debt'
                ? history.filter(h => h.type === 'debt' || h.type === 'purchase').length
                : history.filter(h => h.type === 'pay').length
            const on = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className="btn"
                style={{
                  flex: 1, padding: '9px 8px', borderRadius: 11, border: 'none',
                  background: on ? 'rgba(233,174,0,.15)' : 'var(--l3)',
                  color: on ? 'var(--gd)' : 'var(--t3)',
                  fontSize: 11, fontWeight: on ? 800 : 600,
                  boxShadow: on ? 'inset 0 0 0 1px rgba(233,174,0,.35)' : 'none',
                }}
              >
                {t.icon} {t.label}{count > 0 ? ` (${count})` : ''}
              </button>
            )
          })}
        </div>

        <div style={scrollBoxStyle}>
          {historyList.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 12px' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>{tab === 'pay' ? '✅' : tab === 'debt' ? '🛒' : '📋'}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t2)', marginBottom: 4 }}>
                {tab === 'pay' ? 'Оплат пока нет' : tab === 'debt' ? 'Заказов в долг нет' : 'История пуста'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1.5 }}>
                {tab === 'pay'
                  ? 'После погашения через поддержку оплата появится здесь'
                  : 'Оформите заказ с оплатой «VIP-кредит» — он появится здесь'}
              </div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 8, paddingLeft: 4 }}>
                {tab === 'pay' ? 'Нажмите на оплату — подробности' : 'Все операции по порядку'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {historyList.map((h, i) => renderHistoryRow(h, i))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Детали заказа в долг */}
      {orderDetail && (() => {
        const { hist, order } = orderDetail
        const balance = unpaidOrders.find(b => b.id === hist.id) || null
        const originalAmt = balance?.originalAmount ?? Math.abs(hist.amount)
        const paidAmt = balance?.paidAmount ?? 0
        const debtAmt = balance?.remainingAmount ?? Math.abs(hist.amount)
        const st = order ? (OSTATUS[order.status] || OSTATUS.pending) : null
        const rawOrder = apiOrders.find(o => o.id === hist.orderId)
        const deliveryFee = rawOrder?.deliveryFee ?? order?.delivery ?? 0
        return (
          <DebtBottomSheet onClose={() => setOrderDetail(null)}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{
                width: 56, height: 56, borderRadius: 16, margin: '0 auto 12px',
                background: 'rgba(233,174,0,.12)', border: '1px solid rgba(233,174,0,.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
              }}>🛒</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 6 }}>
                <span className="ub" style={{ fontSize: 18, fontWeight: 900 }}>{hist.orderId}</span>
                <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 5, background: 'rgba(233,174,0,.15)', color: 'var(--t2)' }}>VIP</span>
              </div>
              {st && (
                <span className="bdg" style={{ background: `${st.c}18`, color: st.c, border: `1px solid ${st.c}30`, fontSize: 11 }}>{st.l}</span>
              )}
              <div className="ub" style={{ fontSize: 28, fontWeight: 900, color: 'var(--red)', marginTop: 12 }}>
                −{debtAmt.toLocaleString()} ЅМ
              </div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>
                {balance?.partial ? 'осталось к оплате' : 'товары в долг'}
              </div>
              {balance?.partial && (
                <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 8, lineHeight: 1.5 }}>
                  <span style={{ color: 'var(--gr)', fontWeight: 700 }}>Оплачено {paidAmt.toLocaleString()} ЅМ</span>
                  {' · '}из {originalAmt.toLocaleString()} ЅМ
                </div>
              )}
            </div>

            <div className="card" style={{ padding: '14px 16px', marginBottom: 12 }}>
              {[
                { l: 'Дата', v: hist.date },
                { l: 'Время', v: hist.time || '—' },
                ...(hist.desc ? [{ l: 'Заметка', v: hist.desc, c: 'var(--gd)' }] : []),
                ...(balance?.partial ? [
                  { l: 'Сумма заказа', v: `${originalAmt.toLocaleString()} ЅМ` },
                  { l: 'Уже оплачено', v: `${paidAmt.toLocaleString()} ЅМ`, c: 'var(--gr)' },
                  { l: 'Осталось', v: `${debtAmt.toLocaleString()} ЅМ`, c: 'var(--red)' },
                ] : []),
                ...(order?.addr ? [{ l: 'Адрес', v: order.addr }] : []),
                ...(deliveryFee > 0 ? [{ l: 'Доставка', v: `${Number(deliveryFee).toFixed(2)} ЅМ · наличными курьеру`, c: 'var(--t2)' }] : []),
              ].map((row, i, arr) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--b1)' : 'none' }}>
                  <span style={{ fontSize: 12, color: 'var(--t3)', flexShrink: 0 }}>{row.l}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: row.c || 'var(--t1)', textAlign: 'right' }}>{row.v}</span>
                </div>
              ))}
            </div>

            <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ padding: '12px 15px', borderBottom: '1px solid var(--b1)', fontSize: 13, fontWeight: 800 }}>Состав заказа</div>
              {order?.items?.length ? order.items.map((item, i) => {
                const photo = resolveOrderItemPhoto(item, prods)
                return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 15px', borderBottom: i < order.items.length - 1 ? '1px solid var(--b1)' : 'none' }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--l3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0, overflow: 'hidden' }}>
                    {photo ? <img src={photo} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}/> : item.e}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{item.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 1 }}>× {item.qty}</div>
                  </div>
                  <span className="ub" style={{ fontSize: 13, fontWeight: 800, flexShrink: 0 }}>{(item.price * item.qty).toFixed(2)} <span style={{ fontSize: 12, color: 'var(--t2)' }}>ЅМ</span></span>
                </div>
                )
              }) : (
                <div style={{ padding: '14px 15px', fontSize: 12, color: 'var(--t2)', lineHeight: 1.5 }}>
                  {hist.itemsSummary || 'Состав заказа недоступен'}
                </div>
              )}
              {order && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 15px', borderTop: '1px solid var(--b1)' }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>Итого заказа</span>
                  <span className="ub" style={{ fontSize: 15, fontWeight: 900 }}>{order.total.toFixed(2)} <span style={{ fontSize: 12, color: 'var(--t2)' }}>ЅМ</span></span>
                </div>
              )}
            </div>

            <button onClick={() => setOrderDetail(null)} className="btn" style={{ width: '100%', padding: '14px', borderRadius: 15, background: 'var(--l3)', border: '1px solid var(--b1)', color: 'var(--t2)', fontSize: 14, fontWeight: 700 }}>
              Закрыть
            </button>
          </DebtBottomSheet>
        )
      })()}

      {/* Детали погашения / покупки */}
      {payDetail && (
        <DebtBottomSheet onClose={() => setPayDetail(null)}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{
                width: 56, height: 56, borderRadius: 16, margin: '0 auto 12px',
                background: 'var(--gr-soft)', border: '1px solid rgba(7,136,61,.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
              }}>{payDetail.type === 'purchase' ? '🏪' : '✅'}</div>
              <div className="ub" style={{ fontSize: 18, fontWeight: 900, marginBottom: 4 }}>
                {payDetail.desc || (payDetail.type === 'purchase' ? 'Покупка в магазине' : 'Погашение через поддержку')}
              </div>
              <div className="ub" style={{ fontSize: 28, fontWeight: 900, color: 'var(--gr)' }}>
                {payDetail.amount.toLocaleString()} ЅМ
              </div>
            </div>
            <div className="card" style={{ padding: '14px 16px', marginBottom: 16 }}>
              {[
                { l: 'Дата', v: payDetail.date },
                { l: 'Время', v: payDetail.time || '—' },
                { l: 'Статус', v: payDetail.type === 'purchase' ? 'Оплачено в кассе' : 'Успешно', c: 'var(--gr)' },
                ...(payDetail.orderId ? [{ l: 'Чек', v: payDetail.orderId }] : []),
              ].map((row, i, arr) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--b1)' : 'none' }}>
                  <span style={{ fontSize: 12, color: 'var(--t3)' }}>{row.l}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: row.c || 'var(--t1)' }}>{row.v}</span>
                </div>
              ))}
            </div>
            {payDetail.itemsSummary && (
              <div className="card" style={{ padding: '14px 16px', marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--t3)', marginBottom: 8 }}>Состав</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)', lineHeight: 1.45 }}>
                  {payDetail.itemsSummary}
                </div>
              </div>
            )}
            <button onClick={() => setPayDetail(null)} className="btn" style={{ width: '100%', padding: '14px', borderRadius: 15, background: 'var(--l3)', border: '1px solid var(--b1)', color: 'var(--t2)', fontSize: 14, fontWeight: 700 }}>
              Закрыть
            </button>
        </DebtBottomSheet>
      )}
    </>
  )
}

const DebtsPage = ({ go, user }: any) => {
  const apiOrders = useOrders(s => s.orders);
  const trackClientOrders = useOrders(s => s.trackClientOrders);
  const [loyaltyCfgTick, setLoyaltyCfgTick] = useState(0);
  const orderCount = useMemo(() => countClientOrders(apiOrders, user), [apiOrders, user?.phone]);
  const spentTotal = useMemo(() => countClientSpent(apiOrders, user), [apiOrders, user?.phone]);
  useEffect(() => subscribeLoyaltyStatusConfig(() => setLoyaltyCfgTick(t => t + 1)), []);
  useEffect(() => {
    if (USE_API) void trackClientOrders(getActiveClientPhone(user)).catch(() => {})
  }, [user?.phone, trackClientOrders])
  const loyalty = useMemo(
    () => getLoyaltyProgress(spentTotal, orderCount, 0, user?.level, user?.vip, user?.loyaltyPeriod, loyaltyLockFromRecord(user, user?.level)),
    [spentTotal, orderCount, user?.level, user?.vip, user?.loyaltyPeriod, user?.levelAssignMode, user?.levelValidUntil, user?.levelLockedPeriod, user?.vipUntil, loyaltyCfgTick],
  );
  const creditUsed = Math.max(0, Number(user?.debt) || 0);
  const creditLimit = useMemo(() => resolveEffectiveDebtLimit({
    level: user?.level,
    vip: loyalty.isVip || user?.vip,
    debtLimit: user?.debtLimit,
    debtEnabled: user?.debtEnabled,
  }), [user?.level, user?.vip, user?.debtLimit, user?.debtEnabled, loyalty.isVip, loyaltyCfgTick]);
  const debtSectionOn = creditUsed > 0.001
    || (user?.levelAssignMode === 'manual'
      ? !!user?.debtEnabled
      : (qualifiesForDebtSection(user?.level, user?.vip) || !!user?.debtEnabled))

  useEffect(() => {
    if (!debtSectionOn) go('profile')
  }, [debtSectionOn, go])

  if (!debtSectionOn) return null

  return (
    <div data-store-page style={{ minHeight: '100dvh', background: 'var(--bg)' }}>
      <header data-store-header style={{ position: 'sticky', top: 0, zIndex: 40, background: 'var(--bg)', borderBottom: '1px solid var(--b1)' }}>
        <div style={{ padding: '14px 18px 13px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => storeBack('profile', go)} className="btn" style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--l3)', border: '1px solid var(--b1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Ic n="arrL" s={17} c="var(--t2)" />
          </button>
          <div style={{ flex: 1 }}>
            <div className="ub" style={{ fontSize: 17, fontWeight: 900 }}>Долги</div>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>История и текущий баланс</div>
          </div>
        </div>
      </header>
      <div style={{ padding: '16px 18px 110px' }}>
        <VipDebtSection
          phone={user?.phone}
          cardNum={user?.card}
          creditUsed={creditUsed}
          creditLimit={creditLimit}
          apiOrders={apiOrders}
          loyaltyProfile={user ? { level: loyalty.level, vip: loyalty.isVip } : null}
        />
      </div>
      <Nav page="profile" go={go} user={user} />
    </div>
  );
};

const VIPPage = ({ go, user, setUser }: any) => {
  const [loyaltyCfgTick, setLoyaltyCfgTick] = useState(0);
  const apiOrders = useOrders(s => s.orders);
  const orderCount = useMemo(() => countClientOrders(apiOrders, user), [apiOrders, user?.phone]);
  const spentTotal = useMemo(() => countClientSpent(apiOrders, user), [apiOrders, user?.phone]);
  useEffect(() => subscribeLoyaltyStatusConfig(() => setLoyaltyCfgTick(t => t + 1)), []);
  const loyalty = useMemo(
    () => getLoyaltyProgress(spentTotal, orderCount, 0, user?.level, user?.vip, user?.loyaltyPeriod, loyaltyLockFromRecord(user, user?.level)),
    [spentTotal, orderCount, user?.level, user?.vip, user?.loyaltyPeriod, user?.levelAssignMode, user?.levelValidUntil, user?.levelLockedPeriod, user?.vipUntil],
  );
  const vipUser = user ? { ...user, vip: loyalty.isVip } : null;
  const light = true;
  const { isVip, theme, tier } = resolveUserVip(vipUser, light)
  const showVipSupport =
    resolveAdminVipActive(user?.vip, user?.loyaltyPeriod, user?.vipUntil) ||
    (loyalty.isVip && user?.levelAssignMode !== 'manual')
  const creditUsed = user?.debt ?? 0;
  const creditLimit = useMemo(() => resolveEffectiveDebtLimit({
    level: user?.level,
    vip: loyalty.isVip || user?.vip,
    debtLimit: user?.debtLimit,
    debtEnabled: user?.debtEnabled,
  }), [user?.level, user?.vip, user?.debtLimit, user?.debtEnabled, loyalty.isVip, loyaltyCfgTick]);
  const debtSectionOn = creditUsed > 0
    || (user?.levelAssignMode === 'manual'
    ? !!user?.debtEnabled
      : (qualifiesForDebtSection(user?.level, user?.vip) || !!user?.debtEnabled));
  const creditPct = creditLimit > 0 ? Math.min(100, Math.round((creditUsed / creditLimit) * 100)) : 0;
  const cardLabel = user?.card
    ? user.card.replace(/^КАКАПО-/, "•••• •••• •••• ")
    : "•••• •••• •••• —";
  const memberSinceLabel = formatMemberSinceLabel(user?.memberSince);

  const PERKS = [
    { e:"💳", title:"Покупки в долг на кассе", desc:creditLimit > 0 ? `Лимит ${creditLimit.toLocaleString()} ЅМ — покупки в магазине с оплатой позже.` : "Лимит открывает магазин VIP-клиентам.", color:"var(--t2)" },
    { e:"⭐", title:"Бонусы по карте",          desc:"Процент бонусов зависит от уровня карты КАКАПО. Тратятся на кассе.", color:"var(--t2)" },
    { e:"📞", title:"Линия поддержки",          desc:"Помощь по заказам, бонусам и долгу — звонок или Telegram.", color:"var(--sky)" },
  ];
  const promoPerks = [
    { e:"💳", title:"Покупки в долг", desc:"VIP-клиентам магазин открывает лимит на покупки с оплатой позже." },
    { e:"⭐", title:"Больше бонусов", desc:"Чем выше уровень карты, тем больше бонусов с каждой покупки." },
    { e:"📞", title:"Линия поддержки", desc:"Номер и Telegram для вопросов по заказам, бонусам и долгу." },
  ];
  const vipRules = getVipRules();

  return (
    <div data-store-page style={{
      minHeight:"100vh",
      background:"var(--bg)",
      maxWidth:'var(--store-w)', margin:"0 auto",
    }}>
      <header style={{
        position:"sticky", top:0, zIndex:100,
        background: isVip ? "var(--header-bg)" : "var(--header-bg)",
        backdropFilter:"blur(24px)",
        borderBottom: isVip ? "1px solid rgba(233,174,0,.35)" : "1px solid var(--b1)",
        boxShadow: isVip ? "0 4px 20px rgba(233,174,0,.12)" : "none",
      }}>
        <div style={{ padding:"14px 18px 13px", display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={() => storeBack("profile", go)} className="btn" style={{ width:38, height:38, borderRadius:12, background:"var(--l3)", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div style={{ flex:1 }}>
            <div className="ub" style={{ fontSize:17, fontWeight:900, color: isVip ? "#E9AE00" : "var(--t1)" }}>{isVip ? "VIP Профиль" : "VIP программа"}</div>
            <div style={{ fontSize:10, color: isVip ? "rgba(138,100,0,.8)" : "var(--gd)", marginTop:1, display:"flex", alignItems:"center", gap:4 }}>
              <Ic n="crown" s={10} c={isVip ? "#E9AE00" : "var(--gd)"}/>{isVip ? "VIP Elite" : tier.label}{user?.card ? ` · ${user.card}` : ""}
          </div>
          </div>
          {isVip && <UserStatusBadge user={vipUser} size="md" />}
        </div>
      </header>

      <div style={{ padding:"16px 18px 100px" }}>
        {isVip ? (
          <>
        <div style={{ borderRadius:22, overflow:"hidden", marginBottom:18, position:"relative", background:softAccentSurface('#D97706', light, "linear-gradient(135deg,#3A2A00,#2E1E00,#3A2A00)"), border:"1.5px solid rgba(233,174,0,.4)", boxShadow:"0 8px 40px rgba(233,174,0,.2)" }}>
          <div style={{ position:"absolute", inset:0, opacity:.04, background:"repeating-linear-gradient(45deg,transparent,transparent 8px,rgba(233,174,0,1) 8px,rgba(233,174,0,1) 9px)" }}/>
          <div style={{ position:"absolute", right:-30, top:-30, width:160, height:160, borderRadius:"50%", background:"radial-gradient(circle,rgba(233,174,0,.18),transparent 70%)", filter:"blur(20px)" }}/>
          <div style={{ position:"relative", zIndex:2, padding:"22px 22px 20px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                  <div style={{ width:36, height:36, borderRadius:10, background:"linear-gradient(135deg,var(--gd2),var(--gd))", display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <Ic n="crown" s={18} c="var(--bg)" w={2}/>
                  </div>
                  <div>
                        <div className="ub" style={{ fontSize:14, fontWeight:900, color:"var(--t2)" }}>КАКАПО VIP</div>
                        <div style={{ fontSize:9, color:"rgba(233,174,0,.6)" }}>{tier.label.toUpperCase()} MEMBER</div>
                  </div>
                </div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:9, color:"rgba(233,174,0,.6)", marginBottom:2 }}>Клиент с</div>
                    <div style={{ fontSize:11, fontWeight:700, color:"var(--t2)" }}>{memberSinceLabel}</div>
              </div>
            </div>
            <div className="ub" style={{ fontSize:20, letterSpacing:3, color:"var(--t2)", marginBottom:16, textShadow:"0 2px 12px rgba(233,174,0,.5)" }}>
                  {cardLabel}
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
              <div>
                <div style={{ fontSize:9, color:"rgba(233,174,0,.6)", marginBottom:2 }}>Имя</div>
                <div style={{ fontSize:13, fontWeight:700, color:"var(--t2)" }}>{user?.name?.toUpperCase() || "ДИЛОВАР Р."}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:9, color:"rgba(233,174,0,.6)", marginBottom:2 }}>Лимит</div>
                <div className="ub" style={{ fontSize:14, fontWeight:900, color:"var(--t2)" }}>{creditLimit.toLocaleString()} ЅМ</div>
              </div>
            </div>
          </div>
        </div>

            <div style={{ display:"grid", gridTemplateColumns: debtSectionOn ? "1fr 1fr 1fr" : "1fr", gap:10, marginBottom:16 }}>
              {[
                { l:"Бонусов",   v:(user?.bonus ?? 0).toLocaleString(), c:"var(--gd)" },
                ...(debtSectionOn ? [
                  { l:"Долг",      v:`${creditUsed.toLocaleString()} ЅМ`, c: creditUsed > 0 ? "var(--red)" : "var(--gr)" },
                  { l:"Лимит",     v:`${creditLimit.toLocaleString()} ЅМ`, c:"var(--blue)" },
                ] : []),
          ].map((s,i) => (
            <div key={i} style={{ background:"var(--l2)", border:"1px solid var(--b1)", borderRadius:16, padding:"14px 10px", textAlign:"center" }}>
              <div className="ub" style={{ fontSize:15, fontWeight:900, color:s.c, marginBottom:3 }}>{s.v}</div>
              <div style={{ fontSize:10, color:"var(--t3)" }}>{s.l}</div>
            </div>
          ))}
        </div>
          </>
        ) : (
          <>
            <div style={{ borderRadius:22, overflow:"hidden", marginBottom:18, position:"relative", background:"linear-gradient(135deg,var(--header-bg),var(--header-bg),var(--header-bg))", border:"1.5px solid rgba(233,174,0,.34)", boxShadow:"0 10px 44px rgba(233,174,0,.14)" }}>
              <div style={{ position:"absolute", inset:0, opacity:.06, background:"repeating-linear-gradient(45deg,transparent,transparent 8px,rgba(233,174,0,1) 8px,rgba(233,174,0,1) 9px)" }}/>
              <div style={{ position:"absolute", right:-40, top:-40, width:180, height:180, borderRadius:"50%", background:"radial-gradient(circle,rgba(233,174,0,.18),transparent 70%)", filter:"blur(22px)" }}/>
              <div style={{ position:"relative", zIndex:2, padding:"22px 20px 20px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
                  <div style={{ width:40, height:40, borderRadius:12, background:"linear-gradient(135deg,var(--gd2),var(--gd))", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 4px 14px rgba(233,174,0,.28)" }}>
                    <Ic n="crown" s={20} c="var(--bg)" w={2}/>
                  </div>
                  <div>
                    <div className="ub" style={{ fontSize:16, fontWeight:900, color:"var(--t2)" }}>Откройте VIP в КАКАПО</div>
                    <div style={{ fontSize:10, color:"rgba(138,100,0,.8)", marginTop:2 }}>Больше выгоды, приоритет и отдельная поддержка</div>
                  </div>
                </div>
                <div style={{ fontSize:13, color:"#FFF1C2", lineHeight:1.6, marginBottom:14 }}>
                  VIP даёт доступ к лучшим привилегиям для постоянных клиентов: быстрые заказы, увеличенный кешбэк, покупки в долг и личную линию поддержки.
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
                  <div style={{ background:"rgba(23,37,27,.18)", border:"1px solid rgba(233,174,0,.2)", borderRadius:12, padding:"10px 8px", textAlign:"center" }}>
                    <div className="ub" style={{ fontSize:15, fontWeight:900, color:"var(--t2)" }}>{vipRules.minSpent.toLocaleString()}+</div>
                    <div style={{ fontSize:10, color:"rgba(138,100,0,.78)" }}>траты</div>
                  </div>
                  <div style={{ background:"rgba(23,37,27,.18)", border:"1px solid rgba(233,174,0,.2)", borderRadius:12, padding:"10px 8px", textAlign:"center" }}>
                    <div className="ub" style={{ fontSize:15, fontWeight:900, color:"var(--t2)" }}>{vipRules.minOrders}+</div>
                    <div style={{ fontSize:10, color:"rgba(138,100,0,.78)" }}>заказов</div>
                  </div>
                  <div style={{ background:"rgba(23,37,27,.18)", border:"1px solid rgba(233,174,0,.2)", borderRadius:12, padding:"10px 8px", textAlign:"center" }}>
                    <div className="ub" style={{ fontSize:15, fontWeight:900, color:"var(--t2)" }}>{vipRules.minReviews}+</div>
                    <div style={{ fontSize:10, color:"rgba(138,100,0,.78)" }}>отзывов</div>
                  </div>
                </div>
              </div>
        </div>

            <div style={{ background:"var(--l2)", border:"1px solid var(--b1)", borderRadius:18, padding:"18px", marginBottom:16 }}>
              <div className="ub" style={{ fontSize:14, fontWeight:800, marginBottom:8 }}>Почему стоит получить VIP</div>
              <div style={{ fontSize:11, color:"var(--t2)", lineHeight:1.65 }}>
                Чем чаще клиент заказывает, тем больше становится разница: VIP ускоряет обслуживание, даёт больше бонусов и открывает особые возможности внутри приложения.
              </div>
            </div>
          </>
        )}

        {debtSectionOn && (
        <div style={{ background:"var(--l2)", border:"1px solid var(--b1)", borderRadius:18, padding:"18px", marginBottom:16 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <div className="ub" style={{ fontSize:14, fontWeight:800 }}>💳 Кредитный лимит</div>
            <span className="bdg b-gd">{creditLimit > 0 ? (creditUsed >= creditLimit ? "Исчерпан" : "Активен") : "Не назначен"}</span>
          </div>
          {creditLimit > 0 ? (<>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
            <span style={{ fontSize:12, color:"var(--t2)" }}>Использовано</span>
            <span className="ub" style={{ fontSize:14, fontWeight:800, color:"var(--red)" }}>{creditUsed.toLocaleString()} ЅМ</span>
          </div>
          <div style={{ height:10, background:"var(--b1)", borderRadius:5, marginBottom:8, overflow:"hidden" }}>
            <div style={{ height:"100%", width:`${creditPct}%`, background:`linear-gradient(90deg,var(--gd2),var(--gd))`, borderRadius:5, transition:"width .5s ease" }}/>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:14 }}>
            <span style={{ fontSize:11, color:"var(--t3)" }}>Доступно: <span style={{ color:"var(--gr)", fontWeight:700 }}>{(creditLimit-creditUsed).toLocaleString()} ЅМ</span></span>
            <span style={{ fontSize:11, color:"var(--t3)" }}>Лимит: {creditLimit.toLocaleString()} ЅМ</span>
          </div>
          </>) : (
            <div style={{ fontSize:12, color:"var(--t3)", lineHeight:1.6 }}>Кредитный лимит назначается администратором в разделе «Карты».</div>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => go("debts")}
            style={{
              width: "100%", marginTop: creditLimit > 0 ? 0 : 12, padding: "12px", borderRadius: 12,
              background: "rgba(233,174,0,.1)", border: "1px solid rgba(233,174,0,.28)",
              color: "var(--t2)", fontSize: 13, fontWeight: 800,
            }}
          >
            Открыть раздел «Долги» →
          </button>
                </div>
        )}

        {isVip ? (
          <>
            {showVipSupport && <VipSupportBlock />}

        <div className="ub" style={{ fontSize:14, fontWeight:800, marginBottom:14 }}>Ваши привилегии</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              {(showVipSupport ? PERKS : PERKS.filter(p => p.title !== 'Линия поддержки VIP')).map((perk,i) => (
            <div key={i} style={{ background:"var(--l2)", border:`1px solid ${perk.color}22`, borderRadius:16, padding:"14px 12px", animation:`fadeUp .4s cubic-bezier(.16,1,.3,1) ${i*.04}s both` }}>
              <div style={{ fontSize:26, marginBottom:8 }}>{perk.e}</div>
              <div style={{ fontSize:12, fontWeight:800, color:perk.color, marginBottom:4, lineHeight:1.3 }}>{perk.title}</div>
              <div style={{ fontSize:10, color:"var(--t3)", lineHeight:1.55 }}>{perk.desc}</div>
            </div>
          ))}
        </div>
          </>
        ) : (
          <>
            <div className="ub" style={{ fontSize:14, fontWeight:800, marginBottom:14 }}>Что входит в VIP</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
              {promoPerks.map((perk, i) => (
                <div key={i} style={{ background:"var(--l2)", border:"1px solid rgba(233,174,0,.18)", borderRadius:16, padding:"14px 12px" }}>
                  <div style={{ fontSize:26, marginBottom:8 }}>{perk.e}</div>
                  <div style={{ fontSize:12, fontWeight:800, color:"var(--t2)", marginBottom:4, lineHeight:1.3 }}>{perk.title}</div>
                  <div style={{ fontSize:10, color:"var(--t3)", lineHeight:1.55 }}>{perk.desc}</div>
                </div>
              ))}
      </div>

            <div style={{ background:"rgba(233,174,0,.14)", border:"1px solid rgba(233,174,0,.16)", borderRadius:18, padding:"18px" }}>
              <div className="ub" style={{ fontSize:14, fontWeight:800, marginBottom:8, color:"var(--t2)" }}>Как получить VIP</div>
              <div style={{ fontSize:11, color:"var(--t2)", lineHeight:1.65 }}>
                Выполняйте условия программы: оформляйте заказы, накапливайте сумму покупок и оставляйте отзывы. Как только все условия будут выполнены, VIP станет доступен автоматически.
              </div>
                </div>
          </>
        )}
      </div>

      <Nav page="profile" go={go} user={vipUser}/>
    </div>
  );
};
/** Only real store contacts are shown; history/team/stores tabs held placeholder text. */
const ABOUT_TABS = [{ id: "contacts", l: "Контакты" }];
const AboutPage = ({ go, user }: any) => {
  const light = true;
  const [tab, setTab] = useState("contacts");
  const support = useSupportContacts();
  const [sent, setSent] = useState(false);
  const [name, setName] = useState("");
  const [msg,  setMsg]  = useState("");
  const [sending, setSending] = useState(false);

  const TIMELINE = [
    { year:"2019", e:"🌱", t:"Открытие первого магазина", d:"Начали с небольшого магазина в центре г. Яван. Первые покупатели стали постоянными клиентами." },
    { year:"2021", e:"📱", t:"Запуск приложения",          d:"Создали мобильное приложение. Более 5 000 загрузок в первый месяц." },
    { year:"2022", e:"🚀", t:"Служба доставки",             d:"Запустили собственную доставку по всему г. Яван за 45 минут." },
    { year:"2023", e:"🏪", t:"Второй магазин",              d:"Открыли магазин на Центральном рынке. Ассортимент — 5 000 позиций." },
    { year:"2024", e:"👑", t:"VIP программа",               d:"Запустили клуб лояльности с кредитным лимитом и привилегиями для постоянных клиентов." },
    { year:"2025", e:"✨", t:"Новое приложение",             d:"Полностью переработали платформу — вы в нём прямо сейчас!" },
  ];

  const STORES = [
    { name: support.name || "КАКАПО Главный", addr: support.address || "ул. Ленина, 42", hours: support.hours || "08:00–22:00", phone: support.phone, main: true },
    { name: "КАКАПО Рынок", addr: "Центральный рынок, блок 3", hours: "08:00–20:00", phone: support.phone2, main: false },
  ];

  const TEAM = [
    { name:"Диловар Рахимов",  role:"Основатель и директор",    av:"Д", color:"var(--gr)" },
    { name:"Нилуфар Хасанова", role:"Управляющая магазина",     av:"Н", color:"var(--blue)" },
    { name:"Зафар Мирзоев",    role:"Руководитель доставки",    av:"З", color:"var(--t2)" },
    { name:"Мадина Холова",    role:"Менеджер по клиентам",     av:"М", color:"var(--pur)" },
  ];

  const STATS = [
    { n:"2019",    l:"Год основания", e:"📅", c:"var(--gr)" },
    { n:"15 000+", l:"Клиентов",      e:"👥", c:"var(--blue)" },
    { n:"5 000+",  l:"Товаров",       e:"📦", c:"var(--gd)" },
    { n:"4.8 ★",   l:"Рейтинг",      e:"⭐", c:"var(--gd)" },
    { n:"45 мин",  l:"Доставка",      e:"🚀", c:"var(--sky)" },
    { n:"3",       l:"Магазина",      e:"🏪", c:"var(--pur)" },
  ];

  const send = () => {
    if (!name.trim() || !msg.trim()) return;
    setSending(true);
    setTimeout(() => { setSending(false); setSent(true); }, 1200);
  };

  return (
    <div data-store-page style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:'var(--store-w)', margin:"0 auto" }}>
      <header data-store-header style={{ position:"sticky", top:0, zIndex:100, background:"var(--header-bg)", backdropFilter:"blur(24px)", borderBottom:"1px solid var(--b1)" }}>
        <div style={{ padding:"14px 18px 10px", display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={() => storeBack("profile", go)} className="btn" style={{ width:38, height:38, borderRadius:12, background:"var(--l3)", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div style={{ flex:1 }}>
            <div className="ub" style={{ fontSize:17, fontWeight:900 }}>О КАКАПО</div>
            <div style={{ fontSize:10, color:"var(--t2)", marginTop:1 }}>{support.address || "г. Яван, Таджикистан"}</div>
          </div>
        </div>
        {ABOUT_TABS.length > 1 && <div className="hscroll" style={{ padding:"0 18px 12px", gap:6 }}>
          {ABOUT_TABS.map(t => (
            <button key={t.id} className={`chip ${tab===t.id?"on":""}`} onClick={() => setTab(t.id)}>{t.l}</button>
          ))}
        </div>}
      </header>

      <div style={{ padding:"0 0 100px" }}>
        {tab==="about" && (
          <div>
            <div style={{ height:200, background:softAccentSurface('#07883D', light, "linear-gradient(160deg,#061A0A 0%,#103020 50%,#040E06 100%)"), display:"flex", alignItems:"center", justifyContent:"space-between", padding:"28px 24px", position:"relative", overflow:"hidden" }}>
              <div style={{ position:"absolute", left:0, right:0, height:1, background:"linear-gradient(90deg,transparent,rgba(7,136,61,.5),transparent)", animation:"scanLine 3s linear infinite" }}/>
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12 }}>
                  <div style={{ width:52, height:52, borderRadius:16, background:"var(--gr)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Unbounded", fontSize:22, fontWeight:900, color:"var(--bg)", animation:"glow 3s ease-in-out infinite", boxShadow:"none" }}>K</div>
                  <div>
                    <div className="ub" style={{ fontSize:20, fontWeight:900, background:"linear-gradient(135deg,var(--gr),var(--gd))", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", backgroundClip:"text" }}>КАКАПО</div>
                    <div style={{ fontSize:11, color:"var(--t2)" }}>Ваш семейный супермаркет</div>
                  </div>
                </div>
                <div style={{ fontSize:13, color:light ? "var(--t2)" : "rgba(255,255,255,.65)", lineHeight:1.6 }}>Свежие продукты каждой семье г. Яван</div>
              </div>
              <div style={{ fontSize:52, animation:"float 3s ease-in-out infinite", filter:"drop-shadow(0 6px 16px rgba(7,136,61,.38))" }}>🛒</div>
              <div style={{ position:"absolute", bottom:0, left:0, right:0, height:60, background:"linear-gradient(transparent,var(--bg))" }}/>
            </div>

            <div style={{ padding:"18px 18px 0" }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:22 }}>
                {STATS.map((s,i) => (
                  <div key={i} style={{ background:"var(--l2)", border:"1px solid var(--b1)", borderRadius:16, padding:"14px 10px", textAlign:"center", animation:`fadeUp .45s cubic-bezier(.16,1,.3,1) ${i*.05}s both` }}>
                    <div style={{ fontSize:20, marginBottom:5 }}>{s.e}</div>
                    <div className="ub" style={{ fontSize:13, fontWeight:900, color:s.c, lineHeight:1.2 }}>{s.n}</div>
                    <div style={{ fontSize:9, color:"var(--t3)", marginTop:3, fontWeight:600 }}>{s.l}</div>
                  </div>
                ))}
              </div>

              <div className="ub" style={{ fontSize:15, fontWeight:800, marginBottom:14 }}>Наша история</div>
              <div className="card" style={{ padding:"18px", marginBottom:20 }}>
                {TIMELINE.map((step,i) => (
                  <div key={i} style={{ display:"flex", gap:14, marginBottom:i<TIMELINE.length-1?16:0 }}>
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
                      <div style={{ width:36, height:36, borderRadius:11, background:"var(--gr)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{step.e}</div>
                      {i<TIMELINE.length-1 && <div style={{ width:2, flex:1, minHeight:20, background:"linear-gradient(180deg,var(--gr),var(--b1))", margin:"4px 0" }}/>}
                    </div>
                    <div style={{ flex:1, paddingBottom:i<TIMELINE.length-1?4:0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                        <span style={{ fontSize:9, fontWeight:800, color:"var(--gr)", padding:"2px 7px", borderRadius:6, background:"var(--gr-soft)", border:"1px solid rgba(7,136,61,.25)" }}>{step.year}</span>
                        <span style={{ fontSize:12, fontWeight:800 }}>{step.t}</span>
                      </div>
                      <div style={{ fontSize:11, color:"var(--t2)", lineHeight:1.6 }}>{step.d}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ borderRadius:18, background:softAccentSurface('#07883D', light, "linear-gradient(135deg,#0A1A06,#142A0E)"), border:"1px solid rgba(7,136,61,.2)", padding:"18px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ fontSize:11, fontWeight:800, color:"var(--gr)", textTransform:"uppercase", letterSpacing:".8px", marginBottom:6 }}>Нас выбирают</div>
                  <div className="ub" style={{ fontSize:16, fontWeight:900, marginBottom:4 }}>Лучший супермаркет Явана</div>
                  <div style={{ fontSize:11, color:"var(--t2)" }}>По версии жителей · 2023–2024</div>
                </div>
                <div style={{ fontSize:48, animation:"float 3s ease-in-out infinite", filter:"drop-shadow(0 6px 16px rgba(233,174,0,.4))" }}>🏆</div>
              </div>
            </div>
          </div>
        )}
        {tab==="contacts" && (
          <div style={{ padding:"16px 18px 0" }}>
            <div className="ub" style={{ fontSize:13, fontWeight:800, color:"var(--t3)", textTransform:"uppercase", letterSpacing:".8px", marginBottom:10 }}>Связаться с нами</div>
            <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:22 }}>
              {[
                { icon:"phone", label:"Позвонить",       sub:support.phone, color:"var(--gr)",   bg:"var(--gr-soft)", href: support.phoneTel },
                { icon:"phone", label:"Второй номер",     sub:support.phone2, color:"var(--gr)",   bg:"var(--gr-soft)", href: support.phone2Tel },
                { icon:"tg",    label:"Telegram",         sub:support.telegramLabel, color:"#0369A1", bg:"rgba(2,132,199,.1)", href: support.telegram },
                { icon:"msg",   label:"Email",            sub:support.email, color:"var(--t2)",  bg:"rgba(233,174,0,.1)", href: `mailto:${support.email}` },
              ].filter(c => String(c.sub || '').trim() && c.href).map((c,i) => (
                <a key={i} href={c.href} {...(c.icon === 'tg' ? { target: '_blank', rel: 'noopener noreferrer' } : {})} style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 16px", background:"var(--l2)", border:"1px solid var(--b1)", borderRadius:16, cursor:"pointer", transition:"all .2s", textDecoration:"none", color:"inherit" }}>
                  <div style={{ width:42, height:42, borderRadius:13, background:c.bg, border:`1px solid ${c.color}30`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    <Ic n={c.icon} s={20} c={c.color}/>
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:700 }}>{c.label}</div>
                    <div style={{ fontSize:11, color:"var(--t2)", marginTop:1 }}>{c.sub}</div>
                  </div>
                  <Ic n="arr" s={14} c="var(--t3)"/>
                </a>
              ))}
            </div>

            <div className="ub" style={{ fontSize:13, fontWeight:800, color:"var(--t3)", textTransform:"uppercase", letterSpacing:".8px", marginBottom:10 }}>Режим работы</div>
            <div className="card" style={{ overflow:"hidden", marginBottom:22, padding:"13px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ width:7, height:7, borderRadius:"50%", background:"var(--gr)", animation:"pulse 2s infinite" }}/>
                <span style={{ fontSize:12, fontWeight:600 }}>Ежедневно</span>
                  </div>
              <span className="ub" style={{ fontSize:12, fontWeight:800, color:"var(--gr)" }}>{support.hours}</span>
            </div>

            {false && (!sent ? (
              <div className="card" style={{ padding:"18px", display:"flex", flexDirection:"column", gap:10 }}>
                <input className="inp" value={name} onChange={e => setName(e.target.value)} placeholder="Ваше имя *" style={{ width:"100%" }}/>
                <textarea value={msg} onChange={e => setMsg(e.target.value)} placeholder="Ваше сообщение *"
                  style={{ width:"100%", background:"var(--l3)", border:"1.5px solid var(--b1)", borderRadius:14, padding:"13px 16px", color:"var(--t1)", fontFamily:"Nunito", fontSize:14, resize:"none", height:90, outline:"none" }}/>
                <button onClick={send} className="btn" style={{ padding:"14px", fontSize:14, borderRadius:14, background:"var(--gr)", color:"white", display:"flex", alignItems:"center", justifyContent:"center", gap:8, opacity:name&&msg?1:.5 }}>
                  {sending ? <div style={{ width:18, height:18, borderRadius:"50%", border:"2.5px solid rgba(255,255,255,.3)", borderTopColor:"white", animation:"spin 1s linear infinite" }}/> : <><Ic n="send" s={16} c="white"/>Отправить сообщение</>}
                </button>
              </div>
            ) : (
              <div style={{ background:"rgba(7,136,61,.07)", border:"1.5px solid rgba(7,136,61,.3)", borderRadius:18, padding:"28px", textAlign:"center" }}>
                <div style={{ fontSize:40, marginBottom:12, animation:"float 3s ease-in-out infinite" }}>✉️</div>
                <div className="ub" style={{ fontSize:16, fontWeight:800, color:"var(--gr)", marginBottom:6 }}>Сообщение отправлено!</div>
                <div style={{ fontSize:12, color:"var(--t2)", lineHeight:1.6 }}>Ответим в течение нескольких часов в рабочее время</div>
                <button className="btn" onClick={() => { setSent(false); setName(""); setMsg(""); }} style={{ marginTop:14, padding:"10px 22px", borderRadius:13, background:"var(--gr-soft)", border:"1.5px solid rgba(7,136,61,.3)", color:"var(--gr)", fontSize:12, fontWeight:700 }}>Написать ещё</button>
              </div>
            ))}
          </div>
        )}

        {tab==="stores" && (
          <div style={{ padding:"16px 18px 0" }}>
            <div className="ub" style={{ fontSize:15, fontWeight:800, marginBottom:16 }}>Наши магазины</div>
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              {STORES.map((store,i) => (
                <div key={i} style={{ background:"var(--l2)", border:`1.5px solid ${store.main?"rgba(7,136,61,.3)":"var(--b1)"}`, borderRadius:20, overflow:"hidden" }}>
                  {store.main && (
                    <div style={{ padding:"8px 16px", background:"var(--gr-soft)", borderBottom:"1px solid rgba(7,136,61,.15)", display:"flex", alignItems:"center", gap:7 }}>
                      <div style={{ width:6, height:6, borderRadius:"50%", background:"var(--gr)", animation:"pulse 2s infinite" }}/>
                      <span style={{ fontSize:10, fontWeight:800, color:"var(--gr)" }}>Главный магазин · Открыт сейчас</span>
                    </div>
                  )}
                  <div style={{ padding:"16px" }}>
                    <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:14 }}>
                      <div style={{ width:44, height:44, borderRadius:13, background:store.main?"var(--gr)":"var(--l3)", border:`1px solid ${store.main?"transparent":"var(--b1)"}`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Unbounded", fontSize:16, fontWeight:900, color:store.main?"var(--bg)":"var(--t2)", flexShrink:0 }}>K</div>
                      <div style={{ flex:1 }}>
                        <div className="ub" style={{ fontSize:14, fontWeight:800, marginBottom:3 }}>{store.name}</div>
                        <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, color:"var(--t2)", marginBottom:2 }}><Ic n="map" s={12} c="var(--gr)"/>{store.addr}</div>
                        <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, color:"var(--t2)" }}><Ic n="clock" s={12} c="var(--gd2)"/>{store.hours}</div>
                      </div>
                    </div>
                    <div style={{ height:90, borderRadius:12, overflow:"hidden", position:"relative", background:"linear-gradient(135deg,var(--l1),var(--l3))", border:"1px solid var(--gr-soft)", marginBottom:12, cursor:"pointer" }}>
                      <div style={{ position:"absolute", inset:0, opacity:.05, background:"repeating-linear-gradient(0deg,transparent,transparent 16px,rgba(7,136,61,1) 16px,rgba(7,136,61,1) 17px),repeating-linear-gradient(90deg,transparent,transparent 16px,rgba(7,136,61,1) 16px,rgba(7,136,61,1) 17px)" }}/>
                      <div style={{ position:"absolute", top:"40%", left:"45%", display:"flex", flexDirection:"column", alignItems:"center" }}>
                        <div style={{ width:26, height:26, borderRadius:"50%", background:"rgba(7,136,61,.9)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Unbounded", fontSize:10, fontWeight:900, color:"var(--bg)", boxShadow:"none" }}>K</div>
                        <div style={{ width:2, height:8, background:"var(--gr)" }}/>
                      </div>
                      <div style={{ position:"absolute", bottom:7, right:10, fontSize:9, color:"rgba(255,255,255,.4)", display:"flex", alignItems:"center", gap:4 }}>Открыть карту</div>
                    </div>
                    <div style={{ display:"flex", gap:8 }}>
                      <a href={toTelHref(store.phone)} className="btn" style={{ flex:1, padding:"10px", fontSize:12, borderRadius:12, background:"var(--gr)", color:"white", display:"flex", alignItems:"center", justifyContent:"center", gap:6, textDecoration:"none" }}>
                        <Ic n="phone" s={13} c="white"/>{store.phone}
                      </a>
                      <button className="btn" style={{ flex:1, padding:"10px", fontSize:12, borderRadius:12, background:"var(--l3)", border:"1px solid var(--b1)", color:"var(--t2)", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                        <Ic n="map" s={13} c="var(--gr)"/>Маршрут
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab==="team" && (
          <div style={{ padding:"16px 18px 0" }}>
            <div className="ub" style={{ fontSize:15, fontWeight:800, marginBottom:6 }}>Наша команда</div>
            <div style={{ fontSize:12, color:"var(--t2)", marginBottom:18, lineHeight:1.6 }}>Мы — команда из г. Яван, которая любит своё дело и своих клиентов</div>
            <div style={{ display:"flex", flexDirection:"column", gap:12, marginBottom:22 }}>
              {TEAM.map((member,i) => (
                <div key={i} style={{ background:"var(--l2)", border:"1px solid var(--b1)", borderRadius:18, padding:"16px", display:"flex", alignItems:"center", gap:14, animation:`fadeUp .4s cubic-bezier(.16,1,.3,1) ${i*.06}s both` }}>
                  <div style={{ width:56, height:56, borderRadius:17, background:`linear-gradient(135deg,${member.color}88,${member.color})`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Unbounded", fontSize:22, fontWeight:900, color:"white", flexShrink:0, boxShadow:`0 4px 14px ${member.color}44` }}>
                    {member.av}
                  </div>
                  <div style={{ flex:1 }}>
                    <div className="ub" style={{ fontSize:14, fontWeight:800, marginBottom:4 }}>{member.name}</div>
                    <div style={{ fontSize:11, color:"var(--t2)" }}>{member.role}</div>
                    <div style={{ display:"flex", alignItems:"center", gap:4, marginTop:5 }}>
                      <div style={{ width:6, height:6, borderRadius:"50%", background:"var(--gr)", animation:"pulse 2s infinite" }}/>
                      <span style={{ fontSize:10, color:"var(--gr)", fontWeight:600 }}>г. Яван</span>
                    </div>
                  </div>
                  <button className="btn" style={{ width:36, height:36, borderRadius:11, background:`${member.color}14`, border:`1px solid ${member.color}30`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <Ic n="tg" s={15} c={member.color}/>
                  </button>
                </div>
              ))}
            </div>
            <div style={{ background:softAccentSurface('#2563EB', light, "linear-gradient(135deg,#060C20,#0E1640)"), border:"1px solid rgba(37,99,235,.2)", borderRadius:18, padding:"20px", textAlign:"center", marginBottom:16 }}>
              <div style={{ fontSize:36, marginBottom:10 }}>💼</div>
              <div className="ub" style={{ fontSize:15, fontWeight:800, marginBottom:6 }}>Хотите к нам?</div>
              <div style={{ fontSize:12, color:"var(--t2)", lineHeight:1.65, marginBottom:14 }}>Ищем ответственных и позитивных людей для работы в КАКАПО</div>
              <button className="btn" style={{ padding:"12px 24px", fontSize:13, borderRadius:14, background:"var(--gr)", color:"white" }}>Отправить резюме →</button>
            </div>
            <div className="card" style={{ padding:"16px" }}>
              <div style={{ fontSize:13, fontWeight:800, marginBottom:12 }}>Мы в социальных сетях</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                {[
                  { icon:"insta",label:"Instagram",sub:"@kakapo.tj",  color:"#E1306C",bg:"rgba(225,48,108,.1)" },
                  { icon:"tg",   label:"Telegram", sub:"@kakapo_tj",  color:"#0369A1",bg:"rgba(2,132,199,.1)" },
                  { icon:"wa",   label:"WhatsApp",  sub:"Чат поддержки",color:"#25D366",bg:"rgba(37,211,102,.1)" },
                  { icon:"msg",  label:"Написать",  sub:"kakapo.tj",  color:"var(--t2)",bg:"rgba(233,174,0,.1)" },
                ].map((s,i) => (
                  <button key={i} className="btn" style={{ padding:"12px", borderRadius:14, background:s.bg, border:`1px solid ${s.color}25`, display:"flex", alignItems:"center", gap:10 }}>
                    <Ic n={s.icon} s={20} c={s.color}/>
                    <div style={{ textAlign:"left" }}>
                      <div style={{ fontSize:12, fontWeight:700, color:s.color }}>{s.label}</div>
                      <div style={{ fontSize:10, color:"var(--t3)", marginTop:1 }}>{s.sub}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      <Nav page="profile" go={go} user={user}/>
    </div>
  );
};
const NotifPage = ({ go, user }: any) => {
  const phone = getActiveClientPhone(user);
  const [notifs, setNotifs] = useState(() => loadClientNotifications(!USE_API, phone));
  const [tab, setTab] = useState<'all' | ClientNotificationKind>('all');

  useEffect(() => {
    const refresh = async () => {
      const list = USE_API
        ? await syncClientNotificationsFromApi(phone)
        : loadClientNotifications(!USE_API, phone);
      setNotifs(list);
    };
    refresh();
    const unsub = subscribeClientNotifications(refresh);
    const unsubCh = subscribeNotificationChannel(refresh);
    return () => { unsub(); unsubCh(); };
  }, [phone]);

  const markAll = async () => {
    setNotifs(prev => prev.map(n => ({ ...n, read: true })));
    await markAllNotificationsRead(phone);
    const list = USE_API
      ? await syncClientNotificationsFromApi(phone)
      : loadClientNotifications(false, phone);
    setNotifs(list);
  };

  const openNotif = (n) => {
    markNotificationRead(n.id, phone);
    setNotifs(loadClientNotifications(!USE_API, phone));
    const { page, params: navParams } = resolveNotificationTarget(n);
    if (page === 'notifs') return;
    go(page, navParams);
  };

  const unread = notifs.filter(n => !n.read).length;
  const filtered = tab === 'all' ? notifs : notifs.filter(n => notificationKind(n) === tab);
  const tabs: Array<{ id: 'all' | ClientNotificationKind; label: string }> = [
    { id: 'all', label: 'Все' },
    { id: 'order', label: NOTIFICATION_KIND_LABELS.order },
    { id: 'review', label: NOTIFICATION_KIND_LABELS.review },
    { id: 'bonus', label: NOTIFICATION_KIND_LABELS.bonus },
    { id: 'promo', label: NOTIFICATION_KIND_LABELS.promo },
  ];
  const tabUnread = (id: typeof tab) => {
    const list = id === 'all' ? notifs : notifs.filter(n => notificationKind(n) === id);
    return list.filter(n => !n.read).length;
  };

  return (
    <div data-store-page style={{minHeight:'100vh',background:'var(--bg)',maxWidth:'var(--store-w)',margin:'0 auto'}}>
      <header data-store-header style={{position:'sticky',top:0,zIndex:100,background:'var(--header-bg)',backdropFilter:'blur(24px)',borderBottom:'1px solid var(--b1)'}}>
        <div style={{padding:'14px 18px 13px',display:'flex',alignItems:'center',gap:10}}>
          <button onClick={() => storeBack('profile', go)} className="btn" style={{width:38,height:38,borderRadius:12,background:'var(--l3)',border:'1px solid var(--b1)',display:'flex',alignItems:'center',justifyContent:'center'}}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div style={{flex:1}}>
            <div className="ub" style={{fontSize:17,fontWeight:900}}>Уведомления</div>
            {unread>0&&<div style={{fontSize:10,color:'var(--red)',marginTop:1}}>{unread} непрочитанных</div>}
          </div>
          {unread>0&&<button onClick={markAll} className="btn" style={{fontSize:11,color:'var(--gr)',background:'var(--gr-soft)',border:'1px solid rgba(7,136,61,.25)',borderRadius:10,padding:'6px 12px',fontFamily:'Nunito',fontWeight:700}}>Прочитать все</button>}
        </div>
        <div style={{ display:'flex', gap:6, padding:'0 18px 12px', overflowX:'auto' }}>
          {tabs.map(t => {
            const active = tab === t.id;
            const cnt = tabUnread(t.id);
            return (
              <button key={t.id} type="button" onClick={() => setTab(t.id)} className="btn"
                style={{
                  flexShrink:0, padding:'7px 12px', borderRadius:999, fontSize:11, fontWeight:700,
                  background: active ? 'var(--gr-soft)' : 'var(--l3)',
                  border: active ? '1px solid rgba(7,136,61,.38)' : '1px solid var(--b1)',
                  color: active ? 'var(--gr)' : 'var(--t2)',
                }}>
                {t.label}{cnt > 0 ? ` · ${cnt}` : ''}
              </button>
            );
          })}
        </div>
      </header>
      <div style={{padding:'14px 18px 100px',display:'flex',flexDirection:'column',gap:8}}>
        {filtered.length === 0 && (
          <div style={{ textAlign:'center', padding:'48px 20px', color:'var(--t3)', fontSize:13 }}>
            <div style={{ fontSize:40, marginBottom:10 }}>🔔</div>
            {notifs.length === 0 ? 'Пока нет уведомлений' : 'В этой категории пока пусто'}
            {!phone && (
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--t2)', lineHeight: 1.5 }}>
                Войдите с телефоном из CRM — тогда push-рассылки будут приходить сюда
              </div>
            )}
          </div>
        )}
        {filtered.map((n,i)=>(
          <div key={n.id} onClick={()=>openNotif(n)}
            style={{display:'flex',gap:12,padding:'14px 16px',background:n.read?'var(--l2)':'rgba(7,136,61,.06)',border:`1px solid ${n.read?'var(--b1)':'rgba(7,136,61,.2)'}`,borderRadius:16,cursor:'pointer',animation:`fadeUp .4s cubic-bezier(.16,1,.3,1) ${i*.04}s both`}}>
            <div style={{width:42,height:42,borderRadius:13,background:`${n.color}14`,border:`1px solid ${n.color}25`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>{n.icon}</div>
            <div style={{flex:1}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:3}}>
                <span style={{fontSize:13,fontWeight:n.read?600:800,color:n.read?'var(--t1)':n.color}}>{n.title}</span>
                <span style={{fontSize:10,color:'var(--t3)',flexShrink:0,marginLeft:8}}>{n.time}</span>
              </div>
              <div style={{ fontSize:10, color:'var(--t3)', marginBottom:4 }}>{NOTIFICATION_KIND_LABELS[notificationKind(n)]}</div>
              <div style={{fontSize:12,color:'var(--t2)',lineHeight:1.5}}>{n.body}</div>
              {!n.read && notificationOpenHint(n) && (
                <div style={{ fontSize:10, color:'var(--gr)', fontWeight:700, marginTop:6 }}>{notificationOpenHint(n)}</div>
              )}
            </div>
            {!n.read&&<div style={{width:8,height:8,borderRadius:'50%',background:'var(--gr)',marginTop:4,flexShrink:0,animation:'pulse 2s infinite'}}/>}
          </div>
        ))}
      </div>
      <Nav page="profile" go={go} user={user}/>
    </div>
  );
};

const DEFAULT_ADDRESSES = [
  { id: 1, label: '🏠 Дом', street: 'ул. Ленина, 42', apt: '15', floor: '3', ent: '2', comment: 'Домофон 15', def: true, lat: 38.3260, lng: 69.0280 },
  { id: 2, label: '💼 Работа', street: 'ул. Сомони, 12', apt: '', floor: '1', ent: '1', comment: '', def: false, lat: 38.3160, lng: 69.0340 },
];

const AddressesPage = ({ go, user }: any) => {
  const clientPhone = user?.phone || getActiveClientPhone(user);
  const [addrs, setAddrs] = useState(() => {
    const saved = loadClientAddresses(clientPhone);
    return saved.length ? saved : (USE_API || clientPhone ? [] : DEFAULT_ADDRESSES);
  });
  const persistReadyRef = useRef(false);
  const [showAdd, setShowAdd] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [street, setStreet] = useState('');
  const [mapStreet, setMapStreet] = useState('');
  const [house, setHouse] = useState('');
  const [apt, setApt] = useState('');
  const [floor, setFloor] = useState('');
  const [ent, setEnt] = useState('');
  const [comment, setComment] = useState('');
  const [label, setLabel] = useState('🏠 Дом');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [editId, setEditId] = useState<number | null>(null);

  useEffect(() => {
    if (!clientPhone) return;
    migrateLegacyClientData(clientPhone);
    const saved = loadClientAddresses(clientPhone);
    if (saved.length) setAddrs(saved);
  }, [clientPhone]);

  useEffect(() => {
    if (!clientPhone) return;
    if (!persistReadyRef.current) {
      persistReadyRef.current = true;
      return;
    }
    saveClientAddresses(addrs, clientPhone);
  }, [addrs, clientPhone]);

  useEffect(() => {
    if (!clientPhone) return;
    const refresh = () => setAddrs(loadClientAddresses(clientPhone));
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [clientPhone]);

  const resetForm = () => {
    setShowAdd(false);
    setMapOpen(false);
    setEditId(null);
    setStreet('');
    setMapStreet('');
    setHouse('');
    setApt('');
    setFloor('');
    setEnt('');
    setComment('');
    setCoords(null);
    setLabel('🏠 Дом');
  };

  const openAdd = () => {
    setEditId(null);
    setStreet('');
    setMapStreet('');
    setHouse('');
    setApt('');
    setFloor('');
    setEnt('');
    setComment('');
    setCoords(null);
    setLabel('🏠 Дом');
    setMapOpen(true);
    setShowAdd(true);
  };

  const openEdit = (a) => {
    setEditId(a.id);
    setLabel(a.label);
    const streetParts = (a.street || '').split(',').map(s => s.trim()).filter(Boolean);
    setMapStreet(streetParts[0] || a.street || '');
    setHouse(streetParts[1] || '');
    setStreet(a.street);
    setApt(a.apt || '');
    setFloor(a.floor || '');
    setEnt(a.ent || '');
    setComment(a.comment || '');
    setCoords(a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : null);
    setMapOpen(false);
    setShowAdd(true);
  };

  const mapPickerHeight = typeof window !== 'undefined'
    ? Math.min(460, Math.max(320, Math.round(window.innerHeight * 0.56)))
    : 380;

  useEffect(() => {
    preloadLeaflet();
    void import('@/components/shared/AddressMapPicker');
  }, []);

  useEffect(() => {
    if (!showAdd || !mapOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [showAdd, mapOpen]);

  const handleMapCenterChange = ({ lat, lng, address }: { lat: number; lng: number; address: string }) => {
    setCoords({ lat, lng });
    if (address) setMapStreet(address);
  };

  const buildFullStreet = () => {
    const parts = [mapStreet.trim(), house.trim()].filter(Boolean);
    return parts.join(', ');
  };

  const confirmAndSave = () => {
    const fullStreet = buildFullStreet();
    if (!fullStreet || !coords) return;
    setStreet(fullStreet);
    if (editId != null) {
      setAddrs(as => as.map(a => a.id === editId
        ? { ...a, label, street: fullStreet, apt, floor, ent, comment, lat: coords.lat, lng: coords.lng }
        : a
      ));
    } else {
      setAddrs(as => [...as, {
        id: Date.now(), label, street: fullStreet, apt, floor, ent, comment,
        lat: coords.lat, lng: coords.lng, def: false,
      }]);
    }
    resetForm();
  };

  const setDef = (id) => setAddrs(as => as.map(a => ({ ...a, def: a.id === id })));
  const remove = (id) => setAddrs(as => as.filter(a => a.id !== id));
  const save = () => {
    if (!street || !coords) return;
    if (editId != null) {
      setAddrs(as => as.map(a => a.id === editId
        ? { ...a, label, street, apt, floor, ent, comment, lat: coords.lat, lng: coords.lng }
        : a
      ));
    } else {
      setAddrs(as => [...as, {
        id: Date.now(), label, street, apt, floor, ent, comment,
        lat: coords.lat, lng: coords.lng, def: false,
      }]);
    }
    resetForm();
  };

  return (
    <div data-store-page style={{minHeight:'100vh',background:'var(--bg)',maxWidth:'var(--store-w)',margin:'0 auto'}}>
      <header data-store-header style={{position:'sticky',top:0,zIndex:100,background:'var(--header-bg)',backdropFilter:'blur(24px)',borderBottom:'1px solid var(--b1)'}}>
        <div style={{padding:'14px 18px 13px',display:'flex',alignItems:'center',gap:10}}>
          <button onClick={() => storeBack('profile', go)} className="btn" style={{width:38,height:38,borderRadius:12,background:'var(--l3)',border:'1px solid var(--b1)',display:'flex',alignItems:'center',justifyContent:'center'}}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div className="ub" style={{fontSize:17,fontWeight:900,flex:1}}>Мои адреса</div>
          <button onClick={openAdd} className="btn" style={{padding:'8px 14px',borderRadius:12,background:'var(--gr)',border:'none',color:'var(--bg)',fontSize:12,fontFamily:'Nunito',fontWeight:700}}>+ Добавить</button>
        </div>
      </header>
      <div style={{padding:'16px 18px 100px',display:'flex',flexDirection:'column',gap:12}}>
        {addrs.map((a,i)=>(
          <div key={a.id} className="card" style={{padding:'16px',border:`1.5px solid ${a.def?'rgba(7,136,61,.38)':'var(--b1)'}`,animation:`fadeUp .4s cubic-bezier(.16,1,.3,1) ${i*.08}s both`}}>
            <div style={{display:'flex',alignItems:'flex-start',gap:12}}>
              <div style={{width:44,height:44,borderRadius:13,background:a.def?'var(--gr-soft)':'var(--l3)',border:`1px solid ${a.def?'rgba(7,136,61,.3)':'var(--b1)'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>{a.label.split(' ')[0]}</div>
              <div style={{flex:1}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                  <span style={{fontSize:13,fontWeight:800}}>{a.label}</span>
                  {a.def&&<span style={{padding:'2px 7px',borderRadius:7,fontSize:10,fontWeight:800,background:'var(--gr-soft)',color:'var(--gr)',border:'1px solid rgba(7,136,61,.3)'}}>По умолчанию</span>}
                </div>
                <div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{a.street}{a.apt&&`, кв. ${a.apt}`}</div>
                {(a.floor||a.ent)&&<div style={{fontSize:11,color:'var(--t3)',marginBottom:2}}>
                  {a.floor&&`Этаж ${a.floor}`}{a.floor&&a.ent&&' · '}{a.ent&&`Подъезд ${a.ent}`}
                </div>}
                {a.comment && <div style={{ fontSize: 11, color: 'var(--t3)' }}>💬 {a.comment}</div>}
                {a.lat != null && a.lng != null && (
                  <div style={{ fontSize: 10, color: 'var(--sky)', marginTop: 4, fontWeight: 700 }}>📍 Точка на карте · {a.lat.toFixed(4)}, {a.lng.toFixed(4)}</div>
                )}
              </div>
            </div>
            <div style={{display:'flex',gap:8,marginTop:12}}>
              {!a.def&&<button onClick={()=>setDef(a.id)} className="btn" style={{flex:1,padding:'9px',borderRadius:11,background:'var(--gr-soft)',border:'1px solid rgba(7,136,61,.25)',color:'var(--gr)',fontSize:12,fontFamily:'Nunito',fontWeight:700}}>✓ Сделать основным</button>}
              <button onClick={() => openEdit(a)} className="btn" style={{flex:1,padding:'9px',borderRadius:11,background:'var(--l3)',border:'1px solid var(--b1)',color:'var(--t2)',fontSize:12,fontFamily:'Nunito',fontWeight:700}}>✏️ Изменить</button>
              {!a.def&&<button onClick={()=>remove(a.id)} className="btn" style={{width:38,height:38,borderRadius:11,background:'var(--red-soft)',border:'1px solid rgba(195,52,52,.25)',color:'var(--red)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>🗑</button>}
            </div>
          </div>
        ))}
        <div style={{padding:'16px',borderRadius:16,background:'rgba(7,136,61,.06)',border:'1.5px dashed rgba(7,136,61,.3)',textAlign:'center',cursor:'pointer'}} onClick={openAdd}>
          <div style={{fontSize:28,marginBottom:6}}>📍</div>
          <div style={{fontSize:13,fontWeight:700,color:'var(--gr)'}}>Добавить новый адрес</div>
          <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>С точкой на карте для курьера</div>
        </div>
      </div>
      {showAdd && mapOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 320, display: 'flex', flexDirection: 'column', background: 'var(--bg)', maxWidth:'var(--store-w)', margin: '0 auto', left: 0, right: 0, height: '100dvh', overflow: 'hidden' }}>
          <header style={{ flexShrink: 0, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--b1)', background: 'var(--header-bg)' }}>
            <button
              type="button"
              onClick={() => (editId != null || coords ? setMapOpen(false) : resetForm())}
              className="btn"
              style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--l3)', border: '1px solid var(--b1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <Ic n="arrL" s={17} c="var(--t2)" />
            </button>
            <div style={{ flex: 1 }}>
              <div className="ub" style={{ fontSize: 15, fontWeight: 800 }}>{editId != null ? 'Точка на карте' : 'Новый адрес'}</div>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>Точку ставьте по карте, дом лучше вписать вручную</div>
            </div>
          </header>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <div style={{ flexShrink: 0 }}>
              <AddressMapPicker
                key={editId != null ? `edit-map-${editId}` : 'new-map'}
                pickMode="center"
                mapHeight={mapPickerHeight}
                initial={coords}
                hideConfirm
                addressLabel="Куда"
                addressHelper="Улица подставится автоматически. Дом введите ниже"
                onCenterChange={handleMapCenterChange}
              />
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', touchAction: 'pan-y', padding: '8px 16px calc(12px + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {['🏠 Дом', '💼 Работа', '📍 Другое'].map(l => (
                  <button key={l} onClick={() => setLabel(l)} className="btn" style={{ flex: 1, padding: '8px 4px', borderRadius: 10, fontSize: 12, fontWeight: 700, border: `1.5px solid ${label === l ? 'var(--gr)' : 'var(--b1)'}`, background: label === l ? 'var(--gr-soft)' : 'var(--l3)', color: label === l ? 'var(--gr)' : 'var(--t2)', fontFamily: 'Nunito' }}>{l}</button>
              ))}
            </div>
              <div style={{ borderRadius: 18, background: 'var(--l1)', border: '1px solid var(--b1)', padding: '14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 5, fontWeight: 700 }}>Улица</div>
                  <input className="inp" value={mapStreet} readOnly placeholder="Двигайте карту — улица появится сама" style={{ width: '100%', opacity: mapStreet ? 1 : 0.7 }} />
              </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 5, fontWeight: 700 }}>Номер дома *</div>
                    <input className="inp" value={house} onChange={e => setHouse(e.target.value)} placeholder="144" style={{ width: '100%', fontSize: 13, padding: '11px 12px' }} />
            </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 5, fontWeight: 700 }}>Подъезд</div>
                    <input className="inp" value={ent} onChange={e => setEnt(e.target.value)} placeholder="2" style={{ width: '100%', fontSize: 13, padding: '11px 12px' }} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 5, fontWeight: 700 }}>Квартира</div>
                    <input className="inp" value={apt} onChange={e => setApt(e.target.value)} placeholder="15" style={{ width: '100%', fontSize: 13, padding: '11px 12px' }} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 5, fontWeight: 700 }}>Этаж</div>
                    <input className="inp" value={floor} onChange={e => setFloor(e.target.value)} placeholder="3" style={{ width: '100%', fontSize: 13, padding: '11px 12px' }} />
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 5, fontWeight: 700 }}>Комментарий</div>
                  <input className="inp" value={comment} onChange={e => setComment(e.target.value)} placeholder="Домофон, пожелания..." />
                </div>
                <button
                  onClick={confirmAndSave}
                  className="btn"
                  style={{ width: '100%', padding: '14px', borderRadius: 15, background: 'var(--gr)', border: 'none', color: 'white', fontSize: 14, fontFamily: 'Nunito', fontWeight: 700, opacity: buildFullStreet() && coords ? 1 : 0.5 }}
                >
                  ✓ Подтвердить и сохранить адрес
            </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showAdd && !mapOpen && (
        <div className="store-sheet-backdrop" style={{ zIndex: 300 }} onClick={resetForm}>
          <div className="store-sheet" onClick={e => e.stopPropagation()} style={{ maxHeight: "92vh", overflowX: "hidden", boxSizing: "border-box", padding: "20px 16px calc(40px + env(safe-area-inset-bottom, 0px))" }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--b2)', margin: '0 auto 18px' }} />
            <div className="ub" style={{ fontSize: 15, fontWeight: 800, marginBottom: 16 }}>{editId != null ? 'Изменить адрес' : 'Новый адрес'}</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {['🏠 Дом', '💼 Работа', '📍 Другое'].map(l => (
                <button key={l} onClick={() => setLabel(l)} className="btn" style={{ flex: 1, padding: '8px 4px', borderRadius: 10, fontSize: 12, fontWeight: 700, border: `1.5px solid ${label === l ? 'var(--gr)' : 'var(--b1)'}`, background: label === l ? 'var(--gr-soft)' : 'var(--l3)', color: label === l ? 'var(--gr)' : 'var(--t2)', fontFamily: 'Nunito' }}>{l}</button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setMapOpen(true)}
              className="btn"
              style={{ width: '100%', marginBottom: 12, padding: '14px', borderRadius: 14, background: coords ? 'rgba(37,99,235,.1)' : 'var(--gr-soft)', border: `1.5px solid ${coords ? 'rgba(37,99,235,.35)' : 'rgba(7,136,61,.38)'}`, color: coords ? 'var(--sky)' : 'var(--gr)', fontSize: 13, fontWeight: 700, fontFamily: 'Nunito' }}
            >
              {coords ? '✓ Точка выбрана · изменить на карте' : '🗺 Указать точку на карте'}
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 5, fontWeight: 700 }}>Улица, дом *</div>
                <input className="inp" value={street} onChange={e => setStreet(e.target.value)} placeholder="Улица и номер дома" style={{ width: '100%' }} />
                <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 5 }}>
                  Карта подсказывает ближайшую улицу, номер дома лучше проверить и вписать вручную.
                </div>
            </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 5, fontWeight: 700 }}>Квартира</div>
                  <input className="inp" value={apt} onChange={e => setApt(e.target.value)} placeholder="15" style={{ width: '100%', fontSize: 13, padding: '11px 12px' }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 5, fontWeight: 700 }}>Этаж</div>
                  <input className="inp" value={floor} onChange={e => setFloor(e.target.value)} placeholder="3" style={{ width: '100%', fontSize: 13, padding: '11px 12px' }} />
                </div>
                <div style={{ gridColumn: '1 / -1', minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 5, fontWeight: 700 }}>Подъезд</div>
                  <input className="inp" value={ent} onChange={e => setEnt(e.target.value)} placeholder="2" style={{ width: '100%', fontSize: 13, padding: '11px 12px' }} />
                </div>
              </div>
              <div><div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 5, fontWeight: 700 }}>Комментарий</div><input className="inp" value={comment} onChange={e => setComment(e.target.value)} placeholder="Домофон, пожелания..." /></div>
            </div>
            {!coords && (
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--t2)', fontWeight: 600 }}>⚠️ Укажите точку на карте — курьер увидит ваш дом</div>
            )}
            <button onClick={save} className="btn" style={{ width: '100%', marginTop: 14, padding: '14px', borderRadius: 15, background: 'var(--gr)', border: 'none', color: 'white', fontSize: 14, fontFamily: 'Nunito', fontWeight: 700, opacity: street && coords ? 1 : 0.5 }}>
              📍 {editId != null ? 'Сохранить изменения' : 'Сохранить адрес'}
            </button>
          </div>
        </div>
      )}
      <Nav page="profile" go={go} user={user}/>
    </div>
  );
};
const ReferralPage = ({ go, user }: any) => {
  const light = true;
  const [copied, setCopied] = useState(false);
  const welcomeBonus = getRegistrationWelcomeBonus();
  const code = user?.card
    ? String(user.card)
    : (user?.phone ? 'KKP-' + String(user.phone).replace(/\D/g, '').slice(-4) : 'КАКАПО');
  const stats = [
    {l:'Приглашено',v:'0',c:'var(--blue)'},
    {l:'Зарегистрировалось',v:'0',c:'var(--gr)'},
    {l:'Сделали заказ',v:'0',c:'var(--gd)'},
    {l:'Ваш заработок',v:'0 ⭐',c:'var(--gd)'},
  ];
  const friends: { name: string; date: string; status: string; bonus: number }[] = [];

  const copy = () => {
    try{navigator.clipboard.writeText(code);}catch{}
    setCopied(true); setTimeout(()=>setCopied(false),2000);
  };

  return (
    <div data-store-page style={{minHeight:'100vh',background:'var(--bg)',maxWidth:'var(--store-w)',margin:'0 auto'}}>
      <header data-store-header style={{position:'sticky',top:0,zIndex:100,background:'var(--header-bg)',backdropFilter:'blur(24px)',borderBottom:'1px solid var(--b1)'}}>
        <div style={{padding:'14px 18px 13px',display:'flex',alignItems:'center',gap:10}}>
          <button onClick={() => storeBack('profile', go)} className="btn" style={{width:38,height:38,borderRadius:12,background:'var(--l3)',border:'1px solid var(--b1)',display:'flex',alignItems:'center',justifyContent:'center'}}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div className="ub" style={{fontSize:17,fontWeight:900,flex:1}}>Пригласи друга</div>
        </div>
      </header>
      <div style={{padding:'16px 18px 100px'}}>
        <div style={{borderRadius:22,background:softAccentSurface('#07883D', light, 'linear-gradient(135deg,#061A0C,#0F3020)'),border:'1px solid rgba(7,136,61,.2)',padding:'24px',textAlign:'center',marginBottom:18,position:'relative',overflow:'hidden'}}>
          <div style={{position:'absolute',left:0,right:0,height:1,background:'linear-gradient(90deg,transparent,rgba(7,136,61,.5),transparent)',animation:'scanLine 3s linear infinite'}}/>
          <div style={{fontSize:48,marginBottom:10,animation:'float 3s ease-in-out infinite'}}>🎁</div>
          <div className="ub" style={{fontSize:18,fontWeight:900,marginBottom:6}}>Пригласи — получи бонусы</div>
          <div style={{fontSize:13,color:'var(--t2)',lineHeight:1.65,marginBottom:16}}>
            За каждого друга который сделает первый заказ —<br/>
            <span style={{color:'var(--gr)',fontWeight:700}}>ты +50 бонусов</span>, он <span style={{color:'var(--t2)',fontWeight:700}}>+{welcomeBonus} бонусов</span>
          </div>
          <div style={{background:'var(--bg)',borderRadius:14,padding:'14px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',border:'1px solid rgba(7,136,61,.25)'}}>
            <div>
              <div style={{fontSize:10,color:'var(--t3)',marginBottom:3}}>Твой реферальный код</div>
              <div className="ub" style={{fontSize:18,fontWeight:900,color:'var(--gr)',letterSpacing:2}}>{code}</div>
            </div>
            <button onClick={copy} className="btn" style={{padding:'9px 16px',borderRadius:11,background:copied?'rgba(7,136,61,.2)':'var(--gr-soft)',border:`1.5px solid ${copied?'rgba(7,136,61,.5)':'rgba(7,136,61,.3)'}`,color:'var(--gr)',fontSize:12,fontFamily:'Nunito',fontWeight:700}}>
              {copied?'✓ Скопировано':'📋 Копировать'}
            </button>
          </div>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:18}}>
          {stats.map((s,i)=>(
            <div key={i} style={{background:'var(--l2)',border:'1px solid var(--b1)',borderRadius:16,padding:'14px 12px',textAlign:'center'}}>
              <div className="ub" style={{fontSize:20,fontWeight:900,color:s.c,marginBottom:3}}>{s.v}</div>
              <div style={{fontSize:11,color:'var(--t3)'}}>{s.l}</div>
            </div>
          ))}
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:18}}>
          {[
            {e:'💬',l:'WhatsApp',c:'#25D366',bg:'rgba(37,211,102,.1)'},
            {e:'📨',l:'Telegram',c:'#0369A1',bg:'rgba(2,132,199,.1)'},
          ].map((s,i)=>(
            <button key={i} className="btn" style={{padding:'13px',borderRadius:14,background:s.bg,border:`1.5px solid ${s.c}30`,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
              <span style={{fontSize:22}}>{s.e}</span>
              <span style={{fontSize:13,fontWeight:700,color:s.c,fontFamily:'Nunito'}}>Поделиться в {s.l}</span>
            </button>
          ))}
        </div>

        <div className="ub" style={{fontSize:14,fontWeight:800,marginBottom:12}}>Мои приглашённые</div>
        {friends.length === 0 && (
          <div className="card" style={{padding:'22px 16px',textAlign:'center',color:'var(--t3)',fontSize:13}}>
            Пока никого нет. Поделитесь кодом с друзьями — они появятся здесь.
          </div>
        )}
        <div className="card" style={{overflow:'hidden',display:friends.length?'block':'none'}}>
          {friends.map((f,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 15px',borderBottom:i<friends.length-1?'1px solid var(--b1)':'none'}}>
              <div style={{width:36,height:36,borderRadius:'50%',background:'var(--gr)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:13,fontWeight:900,color:'var(--bg)',flexShrink:0}}>{f.name.charAt(0)}</div>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:700}}>{f.name}</div>
                <div style={{fontSize:11,color:'var(--t3)',marginTop:1}}>{f.date}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <span style={{padding:'3px 9px',borderRadius:8,fontSize:11,fontWeight:800,background:f.status==='ordered'?'var(--gr-soft)':'rgba(233,174,0,.12)',color:f.status==='ordered'?'var(--gr)':'var(--gd)',border:`1px solid ${f.status==='ordered'?'rgba(7,136,61,.3)':'rgba(233,174,0,.28)'}`}}>
                  {f.status==='ordered'?'Заказал':'Зарегистрировался'}
                </span>
                {f.bonus>0&&<div style={{fontSize:11,color:'var(--t2)',fontWeight:700,marginTop:3}}>+{f.bonus} ⭐</div>}
              </div>
            </div>
          ))}
        </div>

        <div className="ub" style={{fontSize:14,fontWeight:800,marginBottom:12,marginTop:20}}>Как это работает</div>
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {[
            {n:'1',t:'Поделись кодом',d:'Отправь свой код другу в WhatsApp или Telegram',c:'var(--blue)'},
            {n:'2',t:'Друг регистрируется',d:`Он вводит твой код при регистрации и получает +${welcomeBonus} бонусов`,c:'var(--gr)'},
            {n:'3',t:'Друг делает заказ',d:'После первого заказа тебе начисляются +50 бонусов',c:'var(--gd)'},
          ].map((s,i)=>(
            <div key={i} style={{display:'flex',gap:12,alignItems:'center',padding:'14px',background:'var(--l2)',border:'1px solid var(--b1)',borderRadius:14}}>
              <div style={{width:36,height:36,borderRadius:'50%',background:`${s.c}18`,border:`2px solid ${s.c}35`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:15,fontWeight:900,color:s.c,flexShrink:0}}>{s.n}</div>
              <div><div style={{fontSize:13,fontWeight:700,marginBottom:2}}>{s.t}</div><div style={{fontSize:11,color:'var(--t2)'}}>{s.d}</div></div>
            </div>
          ))}
        </div>
      </div>
      <Nav page="profile" go={go} user={user}/>
    </div>
  );
};

const ChatPage = ({ go, user }: any) => {
  const [msgs, setMsgs] = useState([
    {from:'support',text:'Здравствуйте! Чем могу помочь?',time:'14:00',read:true},
    {from:'me',     text:'Я хочу уточнить статус моего заказа K-4832',time:'14:01',read:true},
    {from:'support',text:'Заказ K-4832 уже у курьера! Ожидайте примерно через 12 минут 🛵',time:'14:01',read:true},
  ]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);

  const QUICK = ['Где мой заказ?','Хочу отменить заказ','Проблема с товаром','Как использовать бонусы?'];

  const send = (text) => {
    if(!text.trim()) return;
    setMsgs(ms=>[...ms,{from:'me',text,time:new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}),read:false}]);
    setInput(''); setTyping(true);
    setTimeout(()=>{
      setTyping(false);
      setMsgs(ms=>[...ms,{from:'support',text:'Спасибо за обращение! Я уточняю информацию и отвечу через минуту 👍',time:new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}),read:true}]);
    },1800);
  };

  return (
    <div data-store-page style={{minHeight:'100vh',background:'var(--bg)',maxWidth:'var(--store-w)',margin:'0 auto',display:'flex',flexDirection:'column'}}>
      <header data-store-header style={{position:'sticky',top:0,zIndex:100,background:'var(--header-bg)',backdropFilter:'blur(24px)',borderBottom:'1px solid var(--b1)'}}>
        <div style={{padding:'14px 18px 13px',display:'flex',alignItems:'center',gap:10}}>
          <button onClick={() => storeBack('profile', go)} className="btn" style={{width:38,height:38,borderRadius:12,background:'var(--l3)',border:'1px solid var(--b1)',display:'flex',alignItems:'center',justifyContent:'center'}}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div style={{width:38,height:38,borderRadius:'50%',background:'var(--gr)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:14,fontWeight:900,color:'var(--bg)',flexShrink:0}}>K</div>
          <div style={{flex:1}}>
            <div className="ub" style={{fontSize:14,fontWeight:800}}>Поддержка КАКАПО</div>
            <div style={{display:'flex',alignItems:'center',gap:4,marginTop:1}}>
              <div style={{width:6,height:6,borderRadius:'50%',background:'var(--gr)',animation:'pulse 2s infinite'}}/>
              <span style={{fontSize:10,color:'var(--gr)',fontWeight:700}}>Онлайн</span>
            </div>
          </div>
        </div>
        <div className="hscroll" style={{padding:'0 18px 12px',gap:6}}>
          {QUICK.map((q,i)=>(
            <button key={i} onClick={()=>send(q)} className="btn" style={{padding:'7px 13px',borderRadius:50,fontSize:11,fontWeight:700,background:'var(--l3)',border:'1px solid var(--b1)',color:'var(--t2)',whiteSpace:'nowrap',fontFamily:'Nunito'}}>
              {q}
            </button>
          ))}
        </div>
      </header>

      <div style={{flex:1,padding:'14px 18px',display:'flex',flexDirection:'column',gap:10,overflowY:'auto'}}>
        {msgs.map((m,i)=>(
          <div key={i} style={{display:'flex',justifyContent:m.from==='me'?'flex-end':'flex-start',gap:8,animation:'fadeIn .3s ease'}}>
            {m.from!=='me'&&<div style={{width:32,height:32,borderRadius:'50%',background:'var(--gr)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:12,fontWeight:900,color:'var(--bg)',flexShrink:0,marginTop:'auto'}}>K</div>}
            <div style={{maxWidth:'75%'}}>
              <div style={{padding:'11px 14px',borderRadius:m.from==='me'?'18px 18px 4px 18px':'18px 18px 18px 4px',background:m.from==='me'?'var(--gr)':'var(--l2)',border:m.from==='me'?'none':'1px solid var(--b1)',color:m.from==='me'?'white':'var(--t1)',fontSize:13,lineHeight:1.55}}>
                {m.text}
              </div>
              <div style={{fontSize:10,color:'var(--t3)',marginTop:4,textAlign:m.from==='me'?'right':'left'}}>{m.time}</div>
            </div>
          </div>
        ))}
        {typing&&(
          <div style={{display:'flex',gap:8,animation:'fadeIn .3s ease'}}>
            <div style={{width:32,height:32,borderRadius:'50%',background:'var(--gr)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:12,fontWeight:900,color:'var(--bg)',flexShrink:0}}>K</div>
            <div style={{padding:'12px 16px',borderRadius:'18px 18px 18px 4px',background:'var(--l2)',border:'1px solid var(--b1)',display:'flex',gap:5,alignItems:'center'}}>
              {[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:'50%',background:'var(--t3)',animation:`pulse 1.4s ease ${i*.2}s infinite`}}/>)}
            </div>
          </div>
        )}
      </div>

      <div style={{padding:'12px 18px 28px',borderTop:'1px solid var(--b1)',background:'var(--header-bg)',backdropFilter:'blur(20px)',display:'flex',gap:10}}>
        <input className="inp" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send(input)} placeholder="Написать сообщение..." style={{flex:1}}/>
        <button onClick={()=>send(input)} className="btn" style={{width:46,height:46,borderRadius:13,background:input?'var(--gr)':'var(--l3)',border:input?'none':'1px solid var(--b1)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
          <Ic n="send" s={18} c={input?'white':'var(--t3)'}/>
        </button>
      </div>
    </div>
  );
};


const RestaurantsPage = ({ go, cart, onAdd }: any) => {
  const light = true;
  const { restaurants, prods, restaurantsReady } = useLiveCatalog();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const totalQty = formatCartBadgeCount(sumCartUnits(cart || {}, prods));
  const totalQtyNum = sumCartUnits(cart || {}, prods);

  const filtered = restaurants.filter(r => {
    const q = search.toLowerCase();
    return !r.blocked
      && (!search || r.name.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q) || r.tags.some(t=>t.toLowerCase().includes(q)))
      && (filter==='all' || (filter==='open'&&r.open));
  });

  return (
    <div data-store-page style={{minHeight:'100vh',background:'var(--bg)',maxWidth:'var(--store-w)',margin:'0 auto'}}>
      <header data-store-header style={{position:'sticky',top:0,zIndex:100,background:'var(--header-bg)',backdropFilter:'blur(24px)',borderBottom:'1px solid var(--b1)'}}>
        <div style={{padding:'13px 18px 12px',display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:40,height:40,borderRadius:12,background:'var(--gr)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:17,fontWeight:900,color:'var(--bg)',animation:'glow 3s ease-in-out infinite',boxShadow:'0 4px 16px var(--gr)',flexShrink:0}}>K</div>
          <div className="ub" style={{flex:1,fontSize:16,fontWeight:900}}>Рестораны</div>
          <button onClick={()=>go('cart')} className="btn" style={{width:38,height:38,borderRadius:12,background:totalQtyNum>0?'var(--gr)':'var(--l3)',border:`1px solid ${totalQtyNum>0?'transparent':'var(--b1)'}`,display:'flex',alignItems:'center',justifyContent:'center',position:'relative',boxShadow:totalQtyNum>0?'0 4px 14px var(--gr)':'none'}}>
            <Ic n="cart" s={17} c={totalQtyNum>0?'white':'var(--t2)'}/>
            {totalQtyNum>0&&<div style={{position:'absolute',top:-6,right:-6,minWidth:17,height:17,padding:'0 4px',borderRadius:999,background:'var(--red)',border:'2px solid var(--bg)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:9,fontWeight:900,color:'white'}}>{totalQty}</div>}
          </button>
        </div>
        <div style={{padding:'0 18px 10px',position:'relative'}}>
          <div style={{position:'absolute',left:30,top:'50%',transform:'translateY(-50%)',fontSize:15,pointerEvents:'none'}}><Ic n="search" s={15} c="var(--t3)"/></div>
          <input className="inp" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Ресторан или кухня..." style={{paddingLeft:38,width:'100%'}}/>
        </div>
        <div className="hscroll" style={{padding:'0 18px 12px',gap:6}}>
          {[{id:'all',l:'Все'},{id:'open',l:'🟢 Открыты'}].map(f=>(
            <button key={f.id} onClick={()=>setFilter(f.id)} className={`chip ${filter===f.id?'on':''}`}>{f.l}</button>
          ))}
        </div>
      </header>

      <div style={{padding:'14px 18px 100px'}}>
        <div style={{borderRadius:20,overflow:'hidden',marginBottom:20,background:softAccentSurface('#07883D', light, 'linear-gradient(135deg,#0A1A06,#14300F)'),border:'1px solid rgba(7,136,61,.2)',padding:'18px 20px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:900,color:'var(--gr)',marginBottom:4}}>Рестораны г. Яван</div>
            <div style={{fontSize:12,color:'var(--t2)',marginBottom:8}}>Заказывай еду из любимых мест · Один курьер</div>
            <div style={{display:'flex',gap:8}}>
              <span style={{padding:'3px 10px',borderRadius:8,fontSize:11,fontWeight:700,background:'var(--gr-soft)',color:'var(--gr)',border:'1px solid rgba(7,136,61,.25)'}}>{ruCount(restaurants.length, "ресторан", "ресторана", "ресторанов")}</span>
              <span style={{padding:'3px 10px',borderRadius:8,fontSize:11,fontWeight:700,background:'var(--red-soft)',color:'var(--red)',border:'1px solid rgba(195,52,52,.25)'}}>{restaurants.filter(x=>x.open).length} открыто</span>
            </div>
          </div>
          <div style={{fontSize:48,animation:'float 3s ease-in-out infinite'}}>🍽</div>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          {filtered.map((r,i)=>(
            <div key={r.id} onClick={()=>go('restaurant',{rid:r.id})} className="card" style={{cursor:'pointer',animation:`fadeUp .45s cubic-bezier(.16,1,.3,1) ${i*.07}s both`,opacity:r.open?1:.7}}>
              <div style={{height:130,background:softFromDarkGrad(r.img, light, '#C2410C'),display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 18px',position:'relative',overflow:'hidden'}}>
                {!light && <div style={{position:'absolute',inset:0,opacity:.04,background:'repeating-linear-gradient(45deg,transparent,transparent 8px,rgba(255,255,255,1) 8px,rgba(255,255,255,1) 9px)'}}/>}
                <div>
                  <div style={{fontFamily:'Unbounded',fontSize:18,fontWeight:900,color:light?'var(--t1)':'white',marginBottom:4,textShadow:light?'none':'0 2px 8px rgba(23,37,27,.5)'}}>{r.name}</div>
                  <div style={{fontSize:12,color:light?'var(--t2)':'rgba(255,255,255,.7)',marginBottom:8}}>{restaurantsReady ? r.cuisine : '…'}</div>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                    {r.tags.map((t,j)=><span key={j} style={{padding:'3px 8px',borderRadius:8,fontSize:10,fontWeight:700,background:light?'rgba(12,26,16,.06)':'rgba(255,255,255,.15)',color:light?'var(--t2)':'white'}}>{t}</span>)}
                  </div>
                </div>
                <div style={{fontSize:56,animation:'float 3s ease-in-out infinite',filter:light?'none':'drop-shadow(0 4px 12px rgba(23,37,27,.5))'}}>{r.emoji}</div>
                {!r.open&&<div style={{position:'absolute',inset:0,background:'rgba(23,37,27,.5)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:800,color:'white'}}>🔴 Закрыто</div>}
              </div>
              <div style={{padding:'12px 16px',display:'flex',alignItems:'center'}}>
                <div style={{display:'flex',alignItems:'center',gap:4}}>
                  <span style={{color:'var(--t2)',fontSize:14}}>★</span>
                  <span style={{fontFamily:'Unbounded',fontSize:13,fontWeight:800}}>{restaurantsReady ? r.rating : '…'}</span>
                  <span style={{fontSize:11,color:'var(--t3)'}}>({restaurantsReady ? (Number(r.reviews) || 0) : '…'})</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {filtered.length===0&&(
          <div style={{textAlign:'center',paddingTop:50}}>
            <div style={{fontSize:52,marginBottom:12}}>🍽</div>
            <div style={{fontFamily:'Unbounded',fontSize:16,fontWeight:800,marginBottom:8}}>Не найдено</div>
            <button onClick={()=>{setSearch('');setFilter('all');}} className="btn" style={{padding:'11px 22px',borderRadius:13,background:'var(--gr)',border:'none',color:'white',fontFamily:'Nunito',fontWeight:700}}>Сбросить</button>
          </div>
        )}
      </div>
      <Nav page="restaurants" go={go}/>
    </div>
  );
};

const ALL_REST_MENU = '__all__';

function reviewCountLabel(n: number): string {
  const m = Math.abs(n) % 100;
  const m10 = m % 10;
  if (m10 === 1 && m !== 11) return 'отзыв';
  if (m10 >= 2 && m10 <= 4 && (m < 12 || m > 14)) return 'отзыва';
  return 'отзывов';
}

function PublicReviewsSheet({
  title,
  subtitle,
  reviews,
  loading,
  avgRating,
  onClose,
}: {
  title: string;
  subtitle?: string;
  reviews: Review[];
  loading: boolean;
  avgRating: number | null;
  onClose: () => void;
}) {
  return (
    <div className="store-sheet-backdrop" style={{ zIndex: 300 }} onClick={onClose}>
      <div className="store-sheet" onClick={e => e.stopPropagation()} style={{ padding: '20px 20px calc(36px + env(safe-area-inset-bottom, 0px))' }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--b2)', margin: '0 auto 16px' }} />
        <div style={{ fontSize: 16, fontWeight: 800, textAlign: 'center', marginBottom: 4 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: 'var(--t2)', textAlign: 'center', marginBottom: 14 }}>{subtitle}</div>}
        {!loading && reviews.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginBottom: 16, padding: '10px 14px', borderRadius: 14, background: 'rgba(233,174,0,.14)', border: '1px solid rgba(233,174,0,.22)' }}>
            <Stars r={avgRating || 0} s={14} />
            <span className="ub" style={{ fontSize: 18, fontWeight: 900, color: 'var(--t2)' }}>{avgRating ?? '—'}</span>
            <span style={{ fontSize: 12, color: 'var(--t2)' }}>· {reviews.length} {reviewCountLabel(reviews.length)}</span>
          </div>
        )}
        {loading && <div style={{ textAlign: 'center', padding: 32, color: 'var(--t3)', fontSize: 13 }}>Загрузка отзывов…</div>}
        {!loading && reviews.length === 0 && (
          <div style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--t3)' }}>
            <div style={{ fontSize: 44, marginBottom: 10 }}>⭐</div>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6, color: 'var(--t2)' }}>Пока нет отзывов</div>
            <div style={{ fontSize: 12, lineHeight: 1.55 }}>Станьте первым — оцените после доставки заказа</div>
          </div>
        )}
        {!loading && reviews.map((rv, i) => (
          <div key={rv.id || i} style={{ background: 'var(--l2)', border: '1px solid var(--b1)', borderRadius: 16, padding: 14, marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--gr)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Unbounded', fontSize: 14, fontWeight: 900, color: 'var(--bg)', flexShrink: 0 }}>
                {(rv.client || 'К').charAt(0)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{rv.client || 'Клиент'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <Stars r={rv.rating} s={9} />
                  <span style={{ fontSize: 10, color: 'var(--t3)' }}>{rv.date}</span>
                </div>
              </div>
            </div>
            {rv.text && <p style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.6, margin: 0 }}>{rv.text}</p>}
            {rv.restReply && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--gr)', padding: '8px 10px', background: 'var(--gr-soft)', borderRadius: 10, lineHeight: 1.5 }}>
                🍽 Ответ ресторана: {rv.restReply}
              </div>
            )}
            {rv.adminReply && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--blue)', padding: '8px 10px', background: 'rgba(37,99,235,.08)', borderRadius: 10, lineHeight: 1.5 }}>
                💬 Ответ КАКАПО: {rv.adminReply}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const RestaurantPage = ({ go, params, cart, onAdd, onRm }: any) => {
  const light = true;
  const { restaurants, prods, restaurantsReady } = useLiveCatalog();
  const r = restaurants.find(x => x.id === (params && params.rid)) || restaurants[0];
  const [activeCat, setActiveCat] = useState(ALL_REST_MENU);
  const [showRevModal, setShowRevModal] = useState(false);
  const [restReviews, setRestReviews] = useState<Review[]>([]);
  const [revLoading, setRevLoading] = useState(false);
  const [revsLoaded, setRevsLoaded] = useState(!USE_API);
  const totalQty = formatCartBadgeCount(sumCartUnits(cart || {}, prods));
  const totalQtyNum = sumCartUnits(cart || {}, prods);

  useEffect(() => {
    setActiveCat(ALL_REST_MENU);
  }, [r?.id]);

  const loadRestReviews = useCallback(() => {
    if (!r?.id) return;
    if (!USE_API) {
      setRestReviews([]);
      setRevLoading(false);
      setRevsLoaded(true);
      return;
    }
    setRevLoading(true);
    api.getReviews({ restId: r.id })
      .then(list => setRestReviews(sortReviewsNewestFirst(list)))
      .catch(() => setRestReviews([]))
      .finally(() => {
        setRevLoading(false);
        setRevsLoaded(true);
      });
  }, [r?.id]);

  useEffect(() => {
    setRevsLoaded(!USE_API);
    setRestReviews([]);
  }, [r?.id]);

  useEffect(() => {
    loadRestReviews();
  }, [loadRestReviews]);

  const openReviews = () => setShowRevModal(true);
  const reviewAvg = restReviews.length
    ? avgReviewRating(restReviews)
    : (revsLoaded && restaurantsReady ? (Number(r?.rating) || null) : null);
  const reviewCount = revsLoaded ? restReviews.length : null;
  const reviewCountLabel = reviewCount == null ? '…' : String(reviewCount);
  const ratingLabel = reviewAvg != null ? String(reviewAvg) : (revLoading || !revsLoaded ? '…' : '—');

  if (!r) return null;

  const isAllView = activeCat === ALL_REST_MENU;
  const displayMenu = isAllView ? r.menu : r.menu.filter(item => item.cat === activeCat);
  const sectionTitle = isAllView ? 'Все блюда' : activeCat;

  const addItem  = (item) => onAdd && onAdd(`R${r.id}_${item.id}`, item.price, item.name, item.e, r.id, false, item.photo);
  const rmItem   = (item) => onRm  && onRm(`R${r.id}_${item.id}`);
  const getQty   = (item) => (cart||{})[`R${r.id}_${item.id}`]||0;

  return (
    <div data-store-page style={{minHeight:'100vh',background:'var(--bg)',maxWidth:'var(--store-w)',margin:'0 auto'}}>

      {/* Sticky header — back + name + cart + categories */}
      <header data-store-header style={{position:'sticky',top:0,zIndex:100,background:'var(--header-bg)',backdropFilter:'blur(24px)',borderBottom:'1px solid var(--b1)'}}>
        <div style={{padding:'13px 18px 12px',display:'flex',alignItems:'center',gap:10}}>
          <button onClick={() => storeBack('restaurants', go)} className="btn" style={{width:38,height:38,borderRadius:12,background:'var(--l3)',border:'1px solid var(--b1)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            <Ic n="arrL" s={17} c="var(--t2)"/>
          </button>
          <div style={{flex:1,minWidth:0}}>
            <div className="ub" style={{fontSize:15,fontWeight:900,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.name}</div>
            <div style={{display:'flex',alignItems:'center',gap:6,marginTop:1}}>
              <span style={{fontSize:10,color:'var(--t3)'}}>{restaurantsReady ? r.cuisine : '…'}</span>
              <span style={{fontSize:10,color:'var(--t3)'}}>·</span>
              <span style={{fontSize:10,color:r.open?'var(--gr)':'var(--red)',fontWeight:700}}>{r.open?'● Открыто':'● Закрыто'}</span>
        </div>
        </div>
          <button onClick={()=>go('cart')} className="btn" style={{width:38,height:38,borderRadius:12,background:totalQtyNum>0?'var(--gr)':'var(--l3)',border:`1px solid ${totalQtyNum>0?'transparent':'var(--b1)'}`,display:'flex',alignItems:'center',justifyContent:'center',position:'relative',boxShadow:totalQtyNum>0?'0 4px 14px var(--gr)':'none',flexShrink:0}}>
            <Ic n="cart" s={17} c={totalQtyNum>0?'white':'var(--t2)'}/>
            {totalQtyNum>0&&<div style={{position:'absolute',top:-6,right:-6,minWidth:17,height:17,padding:'0 4px',borderRadius:999,background:'var(--red)',border:'2px solid var(--bg)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:9,fontWeight:900,color:'white'}}>{totalQty}</div>}
          </button>
        </div>
        <div className="hscroll" style={{padding:'0 18px 10px',gap:6}}>
          <button type="button" onClick={() => setActiveCat(ALL_REST_MENU)} className={`chip ${isAllView ? 'on' : ''}`}>
            Все ({r.menu.length})
          </button>
          {r.categories.map(cat => {
            const count = r.menu.filter(m => m.cat === cat).length;
            return (
              <button key={cat} type="button" onClick={() => setActiveCat(cat)} className={`chip ${activeCat === cat ? 'on' : ''}`}>
                {cat} ({count})
              </button>
            );
          })}
        </div>
      </header>

      {/* Hero banner — scrollable */}
      <div style={{height:180,background:softFromDarkGrad(r.img, light, '#C2410C'),display:'flex',alignItems:'flex-end',padding:'18px',position:'relative',overflow:'hidden'}}>
        <div style={{position:'absolute',inset:0,background:'linear-gradient(transparent 30%,var(--bg))'}}/>
        <div style={{position:'relative',zIndex:1}}>
          <div style={{fontFamily:'Unbounded',fontSize:20,fontWeight:900,color:light?'var(--t1)':'white',marginBottom:4}}>{r.name}</div>
          <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
            <button type="button" onClick={openReviews} className="btn" style={{display:'inline-flex',alignItems:'center',gap:6,padding:'6px 12px',borderRadius:20,background:'rgba(233,174,0,.14)',border:'1px solid rgba(233,174,0,.35)',color:'var(--t2)',fontSize:12,fontWeight:800}}>
              <Ic n="star" s={13} c="var(--gd2)"/>
              <span style={{fontWeight:800}}>{ratingLabel}</span>
              <span style={{color:'var(--t2)',fontSize:11,fontWeight:600}}>({reviewCountLabel})</span>
              <span style={{color:'var(--gr3)',fontSize:11,fontWeight:700}}>· Отзывы</span>
            </button>
            <span style={{width:1,height:14,background:'var(--b1)'}}/>
            <span style={{fontSize:12,color:'var(--t2)'}}>{restaurantsReady ? r.cuisine : '…'}</span>
            <span style={{width:1,height:14,background:'var(--b1)'}}/>
            <span style={{fontSize:12,color:r.open?'var(--gr)':'var(--red)',fontWeight:700}}>{r.open?'🟢 Открыто':'🔴 Закрыто'}</span>
          </div>
        </div>
      </div>

      {!r.open && (
        <div style={{margin:'0 18px 12px',padding:'12px 14px',borderRadius:14,background:'var(--red-soft)',border:'1px solid rgba(195,52,52,.35)',textAlign:'center'}}>
          <div style={{fontSize:13,fontWeight:800,color:'var(--red)',marginBottom:4}}>🔴 Ресторан сейчас закрыт</div>
          <div style={{fontSize:11,color:'var(--t2)'}}>Заказ временно недоступен — попробуйте позже</div>
          </div>
      )}

      <div style={{padding:'14px 18px 160px',display:'flex',flexDirection:'column',gap:10}}>
        <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',marginBottom:4}}>
          <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:800,color:'var(--t2)'}}>{sectionTitle}</div>
          <div style={{fontSize:11,color:'var(--t3)'}}>
            {displayMenu.length} {displayMenu.length === 1 ? 'блюдо' : displayMenu.length < 5 ? 'блюда' : 'блюд'}
        </div>
      </div>
        {displayMenu.length === 0 ? (
          <div style={{padding:'32px 20px',borderRadius:16,background:'var(--l2)',border:'1px solid var(--b1)',textAlign:'center'}}>
            <div style={{fontSize:36,marginBottom:10}}>🍽</div>
            <div style={{fontFamily:'Unbounded',fontSize:13,fontWeight:800,marginBottom:6}}>Пока нет блюд</div>
            <div style={{fontSize:12,color:'var(--t3)'}}>В этом разделе меню пока пусто</div>
          </div>
        ) : displayMenu.map((item,i)=>{
          const qty = getQty(item);
          const disc = item.old ? Math.round((1-item.price/item.old)*100) : 0;
          return (
            <div key={item.id} style={{display:'flex',gap:12,padding:'14px',background:'var(--l2)',border:`1px solid ${item.inStock?'var(--b1)':'rgba(195,52,52,.2)'}`,borderRadius:16,animation:`fadeUp .4s ease ${i*.05}s both`,opacity:item.inStock?1:.6}}>
              <div style={{width:80,height:80,borderRadius:14,background:'var(--l3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:40,flexShrink:0,position:'relative',overflow:'hidden'}}>
                {resolvePhotoUrl(item.photo)
                  ? <img src={resolvePhotoUrl(item.photo)} alt={item.name} style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
                  : item.e}
                {item.popular&&<div style={{position:'absolute',top:-4,right:-4,padding:'2px 6px',borderRadius:7,background:'var(--red)',fontSize:8,fontWeight:800,color:'white'}}>ХИТ</div>}
                {disc>0&&<div style={{position:'absolute',bottom:-4,left:-4,padding:'2px 6px',borderRadius:7,background:'var(--org)',fontSize:8,fontWeight:800,color:'white'}}>-{disc}%</div>}
                {!item.inStock&&<div style={{position:'absolute',inset:0,borderRadius:14,background:'rgba(23,37,27,.6)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:800,color:'white'}}>Стоп</div>}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:3,flexWrap:'wrap'}}>
                  <div style={{fontSize:14,fontWeight:700,lineHeight:1.3}}>{item.name}</div>
                  {isAllView && (
                    <button type="button" onClick={() => setActiveCat(item.cat)} className="btn"
                      style={{padding:'2px 8px',borderRadius:20,fontSize:9,fontWeight:800,background:'var(--gr-soft)',border:'1px solid rgba(7,136,61,.25)',color:'var(--gr)'}}>
                      {item.cat}
                    </button>
                  )}
                </div>
                <div style={{fontSize:11,color:'var(--t3)',marginBottom:6,lineHeight:1.5}}>{item.desc}</div>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <div style={{display:'flex',alignItems:'baseline',gap:5}}>
                    <span style={{fontFamily:'Unbounded',fontSize:15,fontWeight:900}}>{item.price}<span style={{fontSize:12,color:'var(--t2)',marginLeft:2}}>ЅМ</span></span>
                    {item.old&&<span style={{fontSize:11,color:'var(--t3)',textDecoration:'line-through'}}>{item.old}</span>}
                  </div>
                  {item.inStock && r.open ? (
                    qty===0 ? (
                      <button onClick={()=>addItem(item)} className="btn" style={{padding:'7px 16px',borderRadius:11,background:'var(--gr)',border:'none',color:'white',fontSize:12,fontFamily:'Nunito',fontWeight:700}}>+ Добавить</button>
                    ) : (
                      <div style={{display:'flex',alignItems:'center',gap:0,background:'var(--gr-soft)',border:'1.5px solid rgba(7,136,61,.3)',borderRadius:11,overflow:'hidden'}}>
                        <button onClick={()=>rmItem(item)} className="btn" style={{width:32,height:32,display:'flex',alignItems:'center',justifyContent:'center',background:'transparent',border:'none',color:'var(--gr)',fontSize:18}}>−</button>
                        <span style={{minWidth:24,textAlign:'center',fontFamily:'Unbounded',fontSize:13,fontWeight:900,color:'var(--gr)'}}>{qty}</span>
                        <button onClick={()=>addItem(item)} className="btn" style={{width:32,height:32,display:'flex',alignItems:'center',justifyContent:'center',background:'transparent',border:'none',color:'var(--gr)',fontSize:18}}>+</button>
                      </div>
                    )
                  ) : (
                    <span style={{fontSize:11,color:'var(--red)',fontWeight:700}}>{!r.open ? 'Закрыто' : 'Нет в наличии'}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}

            </div>

      {totalQtyNum>0&&(
        <FloatingCartBtn count={totalQty} onClick={() => go("cart")} />
      )}
      {showRevModal && (
        <PublicReviewsSheet
          title={`Отзывы · ${r.name}`}
          subtitle="Что говорят клиенты после заказа"
          reviews={restReviews}
          loading={revLoading}
          avgRating={reviewAvg}
          onClose={() => setShowRevModal(false)}
        />
      )}
      <Nav page="home" go={go}/>
    </div>
  );
};
const Page404 = ({ go }) => (
  <div data-store-page style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:'var(--store-w)', margin:"0 auto", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"40px 24px", textAlign:"center", position:"relative", overflow:"hidden" }}>
    <div style={{ position:"absolute", inset:0, opacity:.03, background:"repeating-linear-gradient(0deg,transparent,transparent 28px,rgba(7,136,61,1) 28px,rgba(7,136,61,1) 29px),repeating-linear-gradient(90deg,transparent,transparent 28px,rgba(7,136,61,1) 28px,rgba(7,136,61,1) 29px)" }}/>
    <div style={{ position:"relative", zIndex:2 }}>
      <div className="ub" style={{ fontSize:96, fontWeight:900, lineHeight:1, marginBottom:8, background:"linear-gradient(135deg,var(--gr),var(--gd))", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", backgroundClip:"text" }}>404</div>
      <div style={{ fontSize:56, marginBottom:20, animation:"float 3s ease-in-out infinite" }}>🛒</div>
      <div className="ub" style={{ fontSize:20, fontWeight:900, marginBottom:8 }}>Страница не найдена</div>
      <div style={{ fontSize:13, color:"var(--t2)", lineHeight:1.7, marginBottom:32 }}>Похоже, эта страница уехала<br/>вместе с курьером 🛵</div>
      <button onClick={() => go("home")} className="btn" style={{ padding:"15px 32px", fontSize:14, borderRadius:16, background:"var(--gr)", color:"white", marginBottom:12, width:"100%", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}><Ic n="home" s={17} c="white"/>На главную</button>
      <button onClick={() => go("catalog")} className="btn" style={{ padding:"14px 32px", fontSize:13, borderRadius:16, background:"rgba(7,136,61,.09)", border:"1.5px solid rgba(7,136,61,.3)", color:"var(--gr)", width:"100%", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}><Ic n="tag" s={15} c="var(--gr)"/>Каталог товаров</button>
    </div>
  </div>
);

export default function KakapoApp() {
  return (
    <LiveCatalogProvider fallbackProds={PRODS} fallbackRests={RESTAURANTS}>
      <AppNavigationBoundary>
        <KakapoAppInner />
      </AppNavigationBoundary>
    </LiveCatalogProvider>
  );
}

function hydrateStoreSessionFromStorage(): {
  user: StoreUser | null
  cart: Record<string, number>
  cartMeta: Record<string, unknown>
  cartUpdatedAt: string
  wished: Record<string, boolean>
  wishedUpdatedAt: string
} {
  if (typeof window === 'undefined') {
    return { user: null, cart: {}, cartMeta: {}, cartUpdatedAt: '', wished: {}, wishedUpdatedAt: '' };
  }
  const user = loadStoreUser();
  const accountPhone = getActiveClientPhone(user) || undefined;
  migrateLegacyClientData(accountPhone);
  return {
    user,
    cart: loadAccountJson(ACCOUNT_NS.cart, {}, accountPhone),
    cartMeta: loadAccountJson(ACCOUNT_NS.cartMeta, {}, accountPhone),
    cartUpdatedAt: loadAccountJson(ACCOUNT_NS.cartUpdatedAt, '', accountPhone),
    wished: loadAccountJson(ACCOUNT_NS.wished, {}, accountPhone),
    wishedUpdatedAt: loadAccountJson(ACCOUNT_NS.wishedUpdatedAt, '', accountPhone),
  };
}

function KakapoAppInner() {
  useApiSync('catalog');
  const { prods } = useLiveCatalog();
  const { page, params, go } = useAppNavigation('home');
  useStoreLightTheme();
  const [sessionBoot] = useState(hydrateStoreSessionFromStorage);
  const [cart,   setCart]   = useState(sessionBoot.cart);
  const [cartMeta, setCartMeta] = useState(sessionBoot.cartMeta);
  const [cartUpdatedAt, setCartUpdatedAt] = useState(sessionBoot.cartUpdatedAt);
  const [wished, setWished] = useState(sessionBoot.wished);
  const [wishedUpdatedAt, setWishedUpdatedAt] = useState(sessionBoot.wishedUpdatedAt);
  const [user,   setUser]   = useState<StoreUser | null>(sessionBoot.user);
  const [sessionReady, setSessionReady] = useState(false);
  const userPersistReadyRef = useRef(false);
  const cartUpdatedAtRef = useRef(sessionBoot.cartUpdatedAt);
  const cartMutatedByUserRef = useRef(false);
  const cartRef = useRef(sessionBoot.cart);
  const cartMetaRef = useRef(sessionBoot.cartMeta);
  const wishedUpdatedAtRef = useRef(sessionBoot.wishedUpdatedAt);
  const wishMutatedByUserRef = useRef(false);
  const wishedRef = useRef(sessionBoot.wished);
  const addressesUpdatedAtRef = useRef('');
  const [cartSyncReady, setCartSyncReady] = useState(() => {
    if (!USE_API) return true;
    const boot = sessionBoot;
    return !boot.user?.phone || !boot.user?.clientId;
  });
  const [toast,  setToast]  = useState(null);
  const [, setLoyaltyCfgTick] = useState(0);

  useEffect(() => subscribeLoyaltyStatusConfig(() => setLoyaltyCfgTick(t => t + 1)), []);
  useEffect(() => { void ensureSupportContactsLoaded() }, []);

  useLayoutEffect(() => {
    setSessionReady(true);
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    if (!userPersistReadyRef.current) {
      userPersistReadyRef.current = true;
      return;
    }
    if (user) saveStoreUser(user);
    else clearClientSession();
  }, [user, sessionReady]);

  useEffect(() => {
    // Корзина и избранное должны жить и у покупателя без входа: ключ — телефон,
    // а если телефона ещё нет — гостевой слот устройства (getAccountId → 'guest').
    const accountPhone = user?.phone || getActiveClientPhone(user) || undefined;
    setCartSyncReady(false);
    migrateLegacyClientData(accountPhone);
    const localCart = loadAccountJson(ACCOUNT_NS.cart, {}, accountPhone);
    const localMeta = loadAccountJson(ACCOUNT_NS.cartMeta, {}, accountPhone);
    const localUpdatedAt = loadAccountJson(ACCOUNT_NS.cartUpdatedAt, '', accountPhone);
    const localBundle = { cart: localCart, cartMeta: localMeta, cartUpdatedAt: localUpdatedAt };
    cartUpdatedAtRef.current = localUpdatedAt;
    const localWished = loadAccountJson(ACCOUNT_NS.wished, {}, accountPhone);
    const localWishedUpdatedAt = loadAccountJson(ACCOUNT_NS.wishedUpdatedAt, '', accountPhone);
    const localWishBundle = { wished: localWished, wishedUpdatedAt: localWishedUpdatedAt };
    wishedUpdatedAtRef.current = localWishedUpdatedAt;
    const localAddresses = loadClientAddresses(accountPhone);
    const localAddressesUpdatedAt = loadClientAddressesUpdatedAt(accountPhone);
    const localAddressBundle = { addresses: localAddresses, addressesUpdatedAt: localAddressesUpdatedAt };
    addressesUpdatedAtRef.current = localAddressesUpdatedAt;
    setCart(localCart);
    setCartMeta(localMeta);
    setCartUpdatedAt(localUpdatedAt);
    setWished(localWished);
    setWishedUpdatedAt(localWishedUpdatedAt);

    let cancelled = false;
    const syncRemote = async () => {
      if (!USE_API || !user?.clientId) {
        if (!cancelled) setCartSyncReady(true);
        return;
      }
      try {
        const remoteClient = await findSyncClient(user.phone, user.clientId);
        const remote = clientCartPayload(remoteClient);
        const remoteWish = wishBundleFromClient(remoteClient);
        const remoteAddresses = addressBundleFromClient(remoteClient);
        const merged = mergeCartData(localBundle, remote);
        const mergedWish = mergeWishData(localWishBundle, remoteWish);
        const mergedAddresses = mergeAddressData(localAddressBundle, remoteAddresses);
        if (cancelled) return;
        cartMutatedByUserRef.current = false;
        cartUpdatedAtRef.current = merged.cartUpdatedAt || '';
        setCart(merged.cart);
        setCartMeta(merged.cartMeta);
        setCartUpdatedAt(merged.cartUpdatedAt || '');
        saveAccountJson(ACCOUNT_NS.cart, merged.cart, accountPhone);
        saveAccountJson(ACCOUNT_NS.cartMeta, merged.cartMeta, accountPhone);
        saveAccountJson(ACCOUNT_NS.cartUpdatedAt, merged.cartUpdatedAt || '', accountPhone);
        const localTs = cartSyncTimestamp(localUpdatedAt);
        const remoteTs = cartSyncTimestamp(remote.cartUpdatedAt);
        if (localTs > remoteTs || (localTs === remoteTs && Object.keys(localCart).length > 0 && !Object.keys(remote.cart).length)) {
          void saveRemoteCart(user.clientId, merged.cart, merged.cartMeta, merged.cartUpdatedAt);
        }
        wishMutatedByUserRef.current = false;
        wishedUpdatedAtRef.current = mergedWish.wishedUpdatedAt || '';
        setWished(mergedWish.wished);
        setWishedUpdatedAt(mergedWish.wishedUpdatedAt || '');
        saveAccountJson(ACCOUNT_NS.wished, mergedWish.wished, accountPhone);
        saveAccountJson(ACCOUNT_NS.wishedUpdatedAt, mergedWish.wishedUpdatedAt || '', accountPhone);
        const localWishTs = cartSyncTimestamp(localWishedUpdatedAt);
        const remoteWishTs = cartSyncTimestamp(remoteWish.wishedUpdatedAt);
        if (
          localWishTs > remoteWishTs
          || (localWishTs === remoteWishTs && Object.keys(localWished).length > 0 && !Object.keys(remoteWish.wished).length)
        ) {
          void saveRemoteWish(user.clientId, mergedWish.wished, mergedWish.wishedUpdatedAt);
        }
        saveClientAddressesLocal(mergedAddresses.addresses, accountPhone, mergedAddresses.addressesUpdatedAt);
        const localAddrTs = cartSyncTimestamp(localAddressesUpdatedAt);
        const remoteAddrTs = cartSyncTimestamp(remoteAddresses.addressesUpdatedAt);
        if (
          localAddrTs > remoteAddrTs
          || (localAddrTs === remoteAddrTs && localAddresses.length > 0 && !remoteAddresses.addresses.length)
        ) {
          void saveRemoteAddresses(user.clientId, mergedAddresses.addresses, mergedAddresses.addressesUpdatedAt);
        }
        addressesUpdatedAtRef.current = mergedAddresses.addressesUpdatedAt || '';
      } catch { /* оставляем локальные данные */ }
      finally {
        if (!cancelled) setCartSyncReady(true);
      }
    };
    void syncRemote();
    return () => { cancelled = true; };
  }, [user?.phone, user?.clientId]);

  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  useEffect(() => {
    cartMetaRef.current = cartMeta;
  }, [cartMeta]);

  useEffect(() => {
    const accountPhone = user?.phone || getActiveClientPhone(user) || undefined;
    let ts = cartUpdatedAtRef.current;
    if (cartMutatedByUserRef.current) {
      ts = new Date().toISOString();
      cartUpdatedAtRef.current = ts;
      setCartUpdatedAt(ts);
      cartMutatedByUserRef.current = false;
    }
    saveAccountJson(ACCOUNT_NS.cart, cart, accountPhone);
    saveAccountJson(ACCOUNT_NS.cartMeta, cartMeta, accountPhone);
    saveAccountJson(ACCOUNT_NS.cartUpdatedAt, ts, accountPhone);
  }, [cart, cartMeta, user?.phone]);

  useEffect(() => {
    if (!user?.phone || !cartSyncReady) return;
    if (!USE_API || !user.clientId) return;
    const ts = cartUpdatedAtRef.current || cartUpdatedAt || new Date().toISOString();
    const t = setTimeout(() => {
      void saveRemoteCart(user.clientId!, cart, cartMeta, ts);
    }, 400);
    return () => clearTimeout(t);
  }, [cart, cartMeta, cartUpdatedAt, user?.phone, user?.clientId, cartSyncReady]);

  useEffect(() => {
    if (!USE_API || !user?.clientId || !user?.phone || !cartSyncReady) return;

    const pullRemoteClientData = async () => {
      try {
        const remoteClient = await findSyncClient(user.phone, user.clientId);
        const remote = clientCartPayload(remoteClient);
        const remoteWish = wishBundleFromClient(remoteClient);
        const remoteAddresses = addressBundleFromClient(remoteClient);

        const localCartBundle = {
          cart: cartRef.current,
          cartMeta: cartMetaRef.current,
          cartUpdatedAt: cartUpdatedAtRef.current,
        };
        const mergedCart = mergeCartData(localCartBundle, remote);
        const cartChanged =
          cartSyncTimestamp(mergedCart.cartUpdatedAt) !== cartSyncTimestamp(cartUpdatedAtRef.current)
          || JSON.stringify(mergedCart.cart) !== JSON.stringify(cartRef.current);
        if (cartChanged) {
          cartMutatedByUserRef.current = false;
          cartUpdatedAtRef.current = mergedCart.cartUpdatedAt || '';
          setCart(mergedCart.cart);
          setCartMeta(mergedCart.cartMeta);
          setCartUpdatedAt(mergedCart.cartUpdatedAt || '');
          saveAccountJson(ACCOUNT_NS.cart, mergedCart.cart, user.phone);
          saveAccountJson(ACCOUNT_NS.cartMeta, mergedCart.cartMeta, user.phone);
          saveAccountJson(ACCOUNT_NS.cartUpdatedAt, mergedCart.cartUpdatedAt || '', user.phone);
        }

        const localWishBundle = {
          wished: wishedRef.current,
          wishedUpdatedAt: wishedUpdatedAtRef.current,
        };
        const mergedWish = mergeWishData(localWishBundle, remoteWish);
        const wishChanged =
          cartSyncTimestamp(mergedWish.wishedUpdatedAt) !== cartSyncTimestamp(wishedUpdatedAtRef.current)
          || JSON.stringify(mergedWish.wished) !== JSON.stringify(wishedRef.current);
        if (wishChanged) {
          wishMutatedByUserRef.current = false;
          wishedUpdatedAtRef.current = mergedWish.wishedUpdatedAt || '';
          setWished(mergedWish.wished);
          setWishedUpdatedAt(mergedWish.wishedUpdatedAt || '');
          saveAccountJson(ACCOUNT_NS.wished, mergedWish.wished, user.phone);
          saveAccountJson(ACCOUNT_NS.wishedUpdatedAt, mergedWish.wishedUpdatedAt || '', user.phone);
        }

        const localAddressBundle = {
          addresses: loadClientAddresses(user.phone),
          addressesUpdatedAt: addressesUpdatedAtRef.current,
        };
        const mergedAddresses = mergeAddressData(localAddressBundle, remoteAddresses);
        const addressChanged =
          cartSyncTimestamp(mergedAddresses.addressesUpdatedAt) !== cartSyncTimestamp(addressesUpdatedAtRef.current)
          || JSON.stringify(mergedAddresses.addresses) !== JSON.stringify(localAddressBundle.addresses);
        if (addressChanged) {
          addressesUpdatedAtRef.current = mergedAddresses.addressesUpdatedAt || '';
          saveClientAddressesLocal(mergedAddresses.addresses, user.phone, mergedAddresses.addressesUpdatedAt);
        }
      } catch { /* ignore */ }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') void pullRemoteClientData();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => { void pullRemoteClientData(); }, 25000);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [user?.clientId, user?.phone, cartSyncReady]);

  useEffect(() => {
    wishedRef.current = wished;
  }, [wished]);

  useEffect(() => {
    const accountPhone = user?.phone || getActiveClientPhone(user) || undefined;
    let ts = wishedUpdatedAtRef.current;
    if (wishMutatedByUserRef.current) {
      ts = new Date().toISOString();
      wishedUpdatedAtRef.current = ts;
      setWishedUpdatedAt(ts);
      wishMutatedByUserRef.current = false;
    }
    saveAccountJson(ACCOUNT_NS.wished, wished, accountPhone);
    saveAccountJson(ACCOUNT_NS.wishedUpdatedAt, ts, accountPhone);
  }, [wished, user?.phone]);

  useEffect(() => {
    if (!user?.phone || !cartSyncReady) return;
    if (!USE_API || !user.clientId) return;
    const ts = wishedUpdatedAtRef.current || wishedUpdatedAt || new Date().toISOString();
    const t = setTimeout(() => {
      void saveRemoteWish(user.clientId!, wished, ts);
    }, 400);
    return () => clearTimeout(t);
  }, [wished, wishedUpdatedAt, user?.phone, user?.clientId, cartSyncReady]);

  const apiOrders = useOrders(s => s.orders);
  useClientOrderTracking(getActiveClientPhone(user));

  const logout = useCallback(() => {
    clearClientSession();
    setUser(null);
    setCart({});
    setCartMeta({});
    setCartUpdatedAt('');
    cartUpdatedAtRef.current = '';
    setWished({});
    setWishedUpdatedAt('');
    wishedUpdatedAtRef.current = '';
    go('profile');
  }, [go]);

  useClientReviewNotifSync(user);
  useClientNotificationSync(user);
  useStoreProfileSync(user, setUser, logout);
  useAutoLoyaltySync(user, setUser, apiOrders);

  useEffect(() => {
    hydrateCourierStores();
    hydrateAssemblerTeamStore();
    useProductPhotos.getState().hydrate();
  }, []);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  const apiPromos = usePromos(s => s.promos);

  const markCartTouched = useCallback(() => {
    cartMutatedByUserRef.current = true;
  }, []);

  const markWishTouched = useCallback(() => {
    wishMutatedByUserRef.current = true;
  }, []);

  const addItem = useCallback((id, price, name, emoji, restId, silent, photo) => {
    markCartTouched();
    const p = prods.find(x => x.id == id);
    if (p && !restId) {
      if (isOutOfStock(p)) {
        if (!silent) showToast('Нет в наличии');
        return;
      }
      const promo = activeProductPromos(apiPromos).find(pr => Number(pr.productId) === Number(p.id));
      setCart(c => {
        const cur = c[id] || 0;
        let next = nextCartQty(p, cur, true);
        const cap = stockCartCap(p);
        if (cap != null && next > cap) {
          if (!silent) showToast(`В наличии только ${formatCartQty(p, cap)}`);
          return c;
        }
        if (promo) {
          const room = promoCartRoom(promo, cur);
          if (room != null && room <= 0) {
            if (!silent) showToast('По акции больше нет');
            return c;
          }
          if (room != null && next > cur + room) {
            next = cur + room;
            if (!silent) showToast(`По акции осталось: ${formatPromoStockLeft(promo, p)}`);
          }
        }
        if (!silent && next > 0) showToast(`${p.e} ${p.name} — ${formatCartQty(p, next)}`);
        if (next === 0) return c;
        return { ...c, [id]: next };
      });
      return;
    }
    setCart(c => ({ ...c, [id]: (c[id]||0) + 1 }));
    if (name) {
      setCartMeta(m => ({ ...m, [id]: { price, name, emoji: emoji || '🍽', restId, photo: resolvePhotoUrl(photo) } }));
      if (!silent) showToast(`${emoji || '🍽'} ${name} в корзине`);
    }
  }, [showToast, prods, apiPromos, markCartTouched]);

  const rmItem = useCallback((id) => {
    markCartTouched();
    const p = prods.find(x => x.id == id);
    setCart(c => {
      const cur = c[id] || 0;
      if (!cur) return c;
      const n = { ...c };
      if (p && isWeighted(p)) {
        const next = nextCartQty(p, cur, false);
        if (next === 0) delete n[id]; else n[id] = next;
      } else if (n[id] > 1) n[id]--;
      else delete n[id];
      return n;
    });
  }, [prods, markCartTouched]);

  const delItem = useCallback((id) => {
    markCartTouched();
    setCart(c => { const n = {...c}; delete n[id]; return n; });
    setCartMeta(m => { const n = {...m}; delete n[id]; return n; });
  }, [markCartTouched]);

  const toggleWish = useCallback((id) => {
    markWishTouched();
    setWished(w => {
      const n = { ...w };
      if (n[id]) delete n[id];
      else n[id] = true;
      return n;
    });
    const p = prods.find(x => x.id === id);
    if (p && !wished[id]) showToast(`❤️ ${p.name} в избранном`);
  }, [wished, showToast, prods, markWishTouched]);

  const clearCart = useCallback(() => {
    const ts = new Date().toISOString();
    cartMutatedByUserRef.current = false;
    cartUpdatedAtRef.current = ts;
    setCart({});
    setCartMeta({});
    setCartUpdatedAt(ts);
    // Чистим и гостевой слот: иначе после оформления заказа корзина «вернётся» при перезагрузке.
    const accountPhone = user?.phone || getActiveClientPhone(user) || undefined;
    saveAccountJson(ACCOUNT_NS.cart, {}, accountPhone);
    saveAccountJson(ACCOUNT_NS.cartMeta, {}, accountPhone);
    saveAccountJson(ACCOUNT_NS.cartUpdatedAt, ts, accountPhone);
    if (USE_API && user?.clientId) {
      void saveRemoteCart(user.clientId, {}, {}, ts);
    }
  }, [user?.clientId, user?.phone]);

  const storeLoyalty = useMemo(() => {
    if (!user?.phone) {
      return getLoyaltyProgress(0, 0, 0, user?.level, user?.vip, user?.loyaltyPeriod, loyaltyLockFromRecord(user, user?.level))
    }
    const { spent, orderCount } = clientLoyaltyTotals(apiOrders, user)
    return getLoyaltyProgress(spent, orderCount, 0, user.level, user.vip, user.loyaltyPeriod, loyaltyLockFromRecord(user, user.level))
  }, [apiOrders, user?.phone, user?.level, user?.vip, user?.loyaltyPeriod, user?.levelAssignMode, user?.levelValidUntil, user?.levelLockedPeriod, user?.vipUntil])

  const displayUser = useMemo(
    () => (user ? mergeStoreUserWithCrmLoyalty(user, apiOrders) : null),
    [user, apiOrders],
  )
  const isVipUser = !!(displayUser?.vip || storeLoyalty.isVip)

  const shared = { go, cart, cartMeta, onAdd:addItem, onRm:rmItem, onWish:toggleWish, wished, params, onClearCart: clearCart, showToast, user: displayUser, setUser, onLogout: logout, isVip: isVipUser, sessionReady, cartSyncReady };

  const render = () => {
    switch (page) {
      case "home":             return <HomePage          {...shared}/>;
      case "catalog":          return <CatalogPage       {...shared}/>;
      case "hot":              return <PListPage         {...shared} params={{ cat: "hot" }}/>;
      case "plist":            return <PListPage         {...shared}/>;
      case "product":          return <ProductPage       {...shared}/>;
      case "cart":             return <CartPage          {...shared} onDel={delItem}/>;
      case "checkout":         return <CheckoutPage      {...shared}/>;
      case "auth":             return <ClientLoginPage   go={go} setUser={setUser}/>;
      case "profile":          return <ProfilePage       {...shared} user={displayUser} setUser={setUser} onLogout={logout}/>;
      case "orders":           return <OrdersPage        {...shared} user={user}/>;
      case "reviews":          return <ClientReviewsPage   go={go} user={user} sessionReady={sessionReady} params={params}/>;
      case "promos":           return <PromosPage        {...shared}/>;
      case "search":           return <SearchPage        {...shared}/>;
      case "wishlist":         return <WishlistPage      {...shared}/>;
      case "faq":              return <FAQPage           {...shared}/>;
      case "vip":              return <VIPPage           {...shared} setUser={setUser}/>;
      case "debts":            return <DebtsPage         {...shared}/>;
      case "about":            return <AboutPage         {...shared}/>;
      case "restaurants":      return <RestaurantsPage   go={go} cart={cart} onAdd={addItem}/>;
      case "restaurant":       return <RestaurantPage    go={go} params={params} cart={cart} onAdd={addItem} onRm={rmItem}/>;
      case "notifs":           return <NotifPage             {...shared}/>;
      case "addresses":        return <AddressesPage         {...shared}/>;
      // Referral rewards and the auto-reply chat are not real services yet.
      case "referral":
      case "chat":             return <FAQPage               {...shared}/>;
      default:                 return <Page404               go={go}/>;
    }
  };

  return (
    <div className={`store-shell${isVipUser ? ' store-vip' : ''}`}>
      <style>{CSS}</style>
      <Toast msg={toast} isVip={isVipUser}/>
      <nav className="store-topnav">
        <div className="store-topnav-brand">
          <span className="store-brand-mark" aria-hidden="true">K</span>
          <span>КАКАПО{isVipUser ? " VIP" : ""}</span>
        </div>
        <div className="store-topnav-tabs">
          {[{id:"home",icon:"home",label:"Главная"},{id:"catalog",icon:"tag",label:"Каталог"},{id:"orders",icon:"truck",label:"Заказы"},{id:"promos",icon:"gift",label:"Акции"},{id:"profile",icon:"user",label:"Профиль"}].map(it => (
            <button key={it.id} type="button" onClick={() => go(it.id)} className={`store-topnav-tab${page === it.id ? " on" : ""}`}>
              <Ic n={it.icon} s={16}/>
              <span>{it.label}</span>
            </button>
          ))}
        </div>
        <button type="button" className="store-topnav-cart" onClick={() => go("cart")} aria-label="Корзина">
          <Ic n="cart" s={17}/>
          {formatCartBadgeCount(sumCartUnits(cart, prods)) ? <span className="store-topnav-cart-count">{formatCartBadgeCount(sumCartUnits(cart, prods))}</span> : null}
        </button>
      </nav>
      {render()}
    </div>
  );
}
