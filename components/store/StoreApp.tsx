'use client'
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import GeoAddressPicker from "@/components/shared/GeoAddressPicker";
import dynamic from "next/dynamic";
import { hydrateCourierStores } from "@/lib/courierStore";
import { resolveCheckoutPickupIds } from "@/lib/pickups";
import { useProductPhotos } from "@/lib/productPhotos";
import { LiveCatalogProvider, useLiveCatalog } from "@/components/store/LiveCatalogContext";
import { productCatSlug } from "@/lib/enrichCatalog";
import { useOrders, USE_API, useRestaurants } from "@/lib/store";
import { api } from "@/lib/api";
import { enrichRestaurants } from "@/lib/enrichCatalog";
import { mapOrdersForClient } from "@/lib/orderUiMap";
import { useApiSync } from "@/lib/useApiSync";
import { useClientReviewNotifSync } from "@/lib/useClientReviewNotifSync";
import { useClientNotificationSync } from "@/lib/useClientNotificationSync";
import { loadStoreUser, saveStoreUser, getActiveClientPhone, findStoreClientByPhone, storeUserFromClient } from "@/lib/clientSession";
import { loadClientAddresses, saveClientAddresses, formatClientAddressLine } from "@/lib/clientAddresses";
import { ACCOUNT_NS, loadAccountJson, saveAccountJson, migrateLegacyClientData } from "@/lib/clientAccountStorage";
import { phoneDigits } from "@/lib/clientSession";
import ClientLoginPage from "@/components/store/ClientLoginPage";
import { loadClientReviewMap, loadLocalReviews, saveLocalReview } from "@/lib/clientReviews";
import { getLoyaltyProgress, LOYALTY_TIERS } from "@/lib/clientLoyalty";
import {
  getUnreadNotificationCount,
  loadClientNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeClientNotifications,
  subscribeNotificationChannel,
  syncClientNotificationsFromApi,
} from "@/lib/clientNotifications";
import { useAppNavigation } from "@/lib/useAppNavigation";
import AppNavigationBoundary from "@/components/shared/AppNavigationBoundary";
import { isWeighted, formatCartQty, formatCartQtyStepper, calcLineTotal, formatPriceLabel, nextCartQty, orderItemFromProduct, estimateCartWeightKg, sumCartUnits, formatCartBadgeCount } from "@/lib/productWeight";
import type { Review } from "@/lib/types";

const AddressMapPicker = dynamic(() => import("@/components/shared/AddressMapPicker"), { ssr: false });
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@400;600;700;800;900&family=Nunito:wght@400;600;700;800&display=swap');
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
:root{
  --gr:#1FD760;--gr2:#17B34E;--gr3:#0F8A3A;--gd:#FFB800;
  --bg:#030B05;--l1:#06100A;--l2:#091508;--l3:#0C1C0F;--l4:#102213;
  --b1:#162B1A;--b2:#1D3822;
  --t1:#EBF5ED;--t2:#8FB897;--t3:#3D6645;
  --red:#FF4545;--blue:#3B8EF0;--sky:#00D4C8;--pur:#9B6DFF;--org:#FF7D3B;--gd2:#E89E00;
}
html,body{background:var(--bg);color:var(--t1);font-family:'Nunito',sans-serif;-webkit-font-smoothing:antialiased;}
.ub{font-family:'Unbounded',sans-serif;}
::-webkit-scrollbar{width:3px;height:3px;}::-webkit-scrollbar-track{background:var(--l1);}::-webkit-scrollbar-thumb{background:var(--b2);border-radius:2px;}
@keyframes fadeUp{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
@keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
@keyframes float{0%,100%{transform:translateY(0);}50%{transform:translateY(-6px);}}
@keyframes glow{0%,100%{box-shadow:0 0 18px rgba(31,215,96,.2);}50%{box-shadow:0 0 40px rgba(31,215,96,.55);}}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.35;}}
@keyframes spin{from{transform:rotate(0);}to{transform:rotate(360deg);}}
@keyframes notif{from{opacity:0;transform:translate(-50%,-24px);}to{opacity:1;transform:translate(-50%,0);}}
@keyframes scanLine{0%{top:-20%;}100%{top:115%;}}
@keyframes ticker{0%{transform:translateX(0);}100%{transform:translateX(-50%);}}
@keyframes ping{0%{transform:scale(1);opacity:1;}100%{transform:scale(2.4);opacity:0;}}
@keyframes successPop{0%{transform:scale(.7);opacity:0;}60%{transform:scale(1.08);}100%{transform:scale(1);opacity:1;}}
@keyframes slideUp{from{opacity:0;transform:translateY(32px);}to{opacity:1;transform:translateY(0);}}
@keyframes cartPop{0%{transform:scale(1);}50%{transform:scale(1.06);}100%{transform:scale(1);}}
.btn{font-family:'Nunito',sans-serif;font-weight:700;cursor:pointer;border:none;background:transparent;color:inherit;transition:all .22s cubic-bezier(.16,1,.3,1);}
.btn:active{transform:scale(.96);}
.card{background:var(--l2);border:1px solid var(--b1);border-radius:20px;overflow:hidden;transition:all .25s cubic-bezier(.16,1,.3,1);}
.kakapo-card{background:var(--l2);border:1px solid var(--b1);border-radius:18px;overflow:hidden;}
.hscroll{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;}.hscroll::-webkit-scrollbar{display:none;}
.chip{padding:8px 15px;border-radius:50px;font-size:12px;font-weight:700;cursor:pointer;border:1.5px solid var(--b1);background:var(--l2);color:var(--t2);transition:all .2s;font-family:'Nunito',sans-serif;}
.chip.on{background:rgba(31,215,96,.12);color:var(--gr);border-color:rgba(31,215,96,.38);}
.inp{background:var(--l3);border:1.5px solid var(--b1);border-radius:14px;color:var(--t1);font-family:'Nunito',sans-serif;font-size:14px;outline:none;transition:border-color .2s;padding:13px 16px;}
.inp:focus{border-color:rgba(31,215,96,.5);box-shadow:0 0 0 4px rgba(31,215,96,.07);}
.inp::placeholder{color:var(--t3);}
.inp-err{border-color:rgba(255,69,69,.5)!important;}
.inp-ok{border-color:rgba(31,215,96,.45)!important;}
.toggle{width:44px;height:24px;border-radius:12px;background:var(--b2);position:relative;cursor:pointer;transition:background .2s;flex-shrink:0;}
.toggle.on{background:var(--gr);}
.toggle-dot{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:white;transition:transform .2s cubic-bezier(.16,1,.3,1);}
.toggle.on .toggle-dot{transform:translateX(20px);}
.bdg{display:inline-flex;align-items:center;gap:3px;padding:3px 9px;border-radius:50px;font-size:10px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;}
.b-gr{background:rgba(31,215,96,.12);color:var(--gr);border:1px solid rgba(31,215,96,.28);}
.b-gd{background:rgba(255,184,0,.12);color:var(--gd);border:1px solid rgba(255,184,0,.28);}
.b-rd{background:rgba(255,69,69,.12);color:var(--red);border:1px solid rgba(255,69,69,.28);}
.b-bl{background:rgba(59,142,240,.1);color:var(--blue);border:1px solid rgba(59,142,240,.25);}
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
    repeat:  <><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></>,
    card:    <><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></>,
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
          fill={i <= Math.round(r) ? "#FFB800" : "rgba(255,184,0,.15)"} stroke="none"/>
      </svg>
    ))}
  </div>
);

const Toast = ({ msg }) => !msg ? null : (
  <div style={{ position:"fixed", top:16, left:"50%", zIndex:999, animation:"notif .38s cubic-bezier(.16,1,.3,1)", background:"linear-gradient(135deg,#091C0D,#123020)", border:"1.5px solid rgba(31,215,96,.45)", borderRadius:16, padding:"12px 18px", display:"flex", alignItems:"center", gap:10, boxShadow:"0 8px 36px rgba(0,0,0,.65)", whiteSpace:"nowrap", transform:"translateX(-50%)", maxWidth:"90vw" }}>
    <div style={{ width:24, height:24, borderRadius:"50%", background:"rgba(31,215,96,.2)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
      <Ic n="check" s={12} c="var(--gr)" w={2.5}/>
    </div>
    <span style={{ fontSize:13, fontWeight:700 }}>{msg}</span>
  </div>
);

const Nav = ({ page, go }) => (
  <nav style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, background:"rgba(3,11,5,.97)", backdropFilter:"blur(26px)", borderTop:"1px solid var(--b1)", padding:"8px 18px calc(16px + env(safe-area-inset-bottom, 0px))", display:"flex", justifyContent:"space-around", zIndex:200 }}>
    {[{id:"home",icon:"home",label:"Главная"},{id:"catalog",icon:"tag",label:"Каталог"},{id:"orders",icon:"truck",label:"Заказы"},{id:"promos",icon:"gift",label:"Акции"},{id:"profile",icon:"user",label:"Профиль"}].map(item => (
      <button key={item.id} type="button" onClick={() => go(item.id)} className="btn"
        style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, padding:"6px 12px", borderRadius:12, background:page===item.id?"rgba(31,215,96,.09)":"transparent", border:`1.5px solid ${page===item.id?"rgba(31,215,96,.22)":"transparent"}`, color:page===item.id?"var(--gr)":"var(--t3)" }}>
        <Ic n={item.icon} s={20} c={page===item.id?"var(--gr)":"var(--t3)"}/>
        <span style={{ fontSize:9, fontWeight:page===item.id?800:600 }}>{item.label}</span>
      </button>
    ))}
  </nav>
);

/** Компактная плавающая кнопка корзины */
const FloatingCartBtn = ({ count, onClick, label = "В корзину" }) => (
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
        background:"linear-gradient(135deg,#0F7A38 0%,#1FD760 100%)",
        border:"1px solid rgba(255,255,255,.14)",
        boxShadow:"0 3px 12px rgba(31,215,96,.26), inset 0 1px 0 rgba(255,255,255,.16)",
        maxWidth:"calc(100% - 44px)",
      }}
    >
      <div style={{
        minWidth:19, height:19, padding:"0 5px", borderRadius:999,
        background:"rgba(0,0,0,.28)", border:"1px solid rgba(255,255,255,.1)",
        display:"flex", alignItems:"center", justifyContent:"center",
        fontFamily:"Unbounded", fontSize:9, fontWeight:900, color:"white", flexShrink:0,
      }}>{count}</div>
      <span style={{ fontSize:12, fontWeight:800, color:"white", whiteSpace:"nowrap", letterSpacing:"-.01em" }}>{label}</span>
      <Ic n="arr" s={11} c="rgba(255,255,255,.85)"/>
    </button>
  </div>
);

const Header = ({ title, back, go, cart }) => {
  const { prods } = useLiveCatalog();
  const qty = formatCartBadgeCount(sumCartUnits(cart || {}, prods));
  const qtyNum = sumCartUnits(cart || {}, prods);
  return (
    <header style={{ position:"sticky", top:0, zIndex:100, background:"rgba(3,11,5,.96)", backdropFilter:"blur(24px)", borderBottom:"1px solid var(--b1)" }}>
      <div style={{ padding:"13px 18px 12px", display:"flex", alignItems:"center", gap:10 }}>
        {back ? (
          <button onClick={() => go(back)} className="btn" style={{ width:38, height:38, borderRadius:12, background:"var(--l3)", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <Ic n="arrL" s={17} c="var(--t2)"/>
          </button>
        ) : (
          <div style={{ width:40, height:40, borderRadius:12, background:"linear-gradient(135deg,var(--gr3),var(--gr))", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Unbounded", fontSize:17, fontWeight:900, color:"var(--bg)", animation:"glow 3s ease-in-out infinite", boxShadow:"0 4px 16px rgba(31,215,96,.4)", flexShrink:0 }}>K</div>
        )}
        <div style={{ flex:1 }}>
          {title ? (
            <div className="ub" style={{ fontSize:16, fontWeight:900 }}>{title}</div>
          ) : (
            <>
              <div className="ub" style={{ fontSize:16, fontWeight:900, background:"linear-gradient(135deg,var(--gr),var(--gd))", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", backgroundClip:"text" }}>КАКАПО</div>
              <div style={{ display:"flex", alignItems:"center", gap:4, marginTop:1 }}>
                <div style={{ width:5, height:5, borderRadius:"50%", background:"var(--gr)", animation:"pulse 2s infinite" }}/>
                <span style={{ fontSize:10, color:"var(--t2)" }}>г. Яван · Доставка 45 мин</span>
              </div>
            </>
          )}
        </div>
        <button onClick={() => go("search")} className="btn" style={{ width:38, height:38, borderRadius:12, background:"var(--l3)", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <Ic n="search" s={17} c="var(--t2)"/>
        </button>
        <button onClick={() => go("cart")} className="btn" style={{ width:38, height:38, borderRadius:12, background:qtyNum>0?"linear-gradient(135deg,var(--gr2),var(--gr))":"var(--l3)", border:`1px solid ${qtyNum>0?"transparent":"var(--b1)"}`, display:"flex", alignItems:"center", justifyContent:"center", position:"relative", boxShadow:qtyNum>0?"0 4px 14px rgba(31,215,96,.4)":"none" }}>
          <Ic n="cart" s={17} c={qtyNum>0?"white":"var(--t2)"}/>
          {qtyNum>0 && <div style={{ position:"absolute", top:-6, right:-6, minWidth:17, height:17, padding:"0 4px", borderRadius:999, background:"var(--red)", border:"2px solid var(--bg)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Unbounded", fontSize:9, fontWeight:900, color:"white" }}>{qty}</div>}
        </button>
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

const CATS = [
  {id:"veg",     e:"🥦",label:"Овощи и фрукты",   count:142,color:"#56C956",bg:"linear-gradient(145deg,#0D2A0D,#1A4A1A)", parentId:null},
  {id:"meat",    e:"🥩",label:"Мясо и птица",      count:67, color:"#FF6B6B",bg:"linear-gradient(145deg,#2A0A0A,#4A1818)", parentId:null},
  {id:"dairy",   e:"🥛",label:"Молочные продукты", count:98, color:"#93C5FD",bg:"linear-gradient(145deg,#0A1828,#163050)", parentId:null},
  {id:"bread",   e:"🥐",label:"Хлеб и выпечка",    count:54, color:"#FCD34D",bg:"linear-gradient(145deg,#281806,#4A2E12)", parentId:null},
  {id:"sweet",   e:"🍫",label:"Сладости",           count:113,color:"#C084FC",bg:"linear-gradient(145deg,#1A0C28,#2E1848)", parentId:null},
  {id:"drink",   e:"🧃",label:"Напитки",             count:88, color:"#67E8F9",bg:"linear-gradient(145deg,#041820,#0C2E3A)", parentId:null},
  {id:"fish",    e:"🐟",label:"Рыба и морепродукты",count:39, color:"#7DD3FC",bg:"linear-gradient(145deg,#051822,#0E2C3E)", parentId:null},
  {id:"chem",    e:"🧴",label:"Бытовая химия",      count:45, color:"#6EE7B7",bg:"linear-gradient(145deg,#062018,#103A28)", parentId:null},
  {id:"kids",    e:"👶",label:"Товары для детей",   count:32, color:"#FBBF24",bg:"linear-gradient(145deg,#281800,#4A2C00)", parentId:null},
  {id:"veg_ov",  e:"🥕",label:"Овощи",              count:65, color:"#56C956",bg:"linear-gradient(145deg,#0D2A0D,#1A4A1A)", parentId:"veg"},
  {id:"veg_fr",  e:"🍊",label:"Фрукты",              count:48, color:"#FB923C",bg:"linear-gradient(145deg,#2A1000,#4A2000)", parentId:"veg"},
  {id:"veg_gr",  e:"🌿",label:"Зелень",              count:18, color:"#34D399",bg:"linear-gradient(145deg,#032010,#06401A)", parentId:"veg"},
  {id:"veg_yg",  e:"🫐",label:"Ягоды",               count:11, color:"#A78BFA",bg:"linear-gradient(145deg,#14082A,#26104A)", parentId:"veg"},
  {id:"meat_b",  e:"🥩",label:"Говядина и баранина", count:22, color:"#FF6B6B",bg:"linear-gradient(145deg,#2A0A0A,#4A1818)", parentId:"meat"},
  {id:"meat_p",  e:"🍗",label:"Птица",               count:18, color:"#FCD34D",bg:"linear-gradient(145deg,#281806,#4A2E12)", parentId:"meat"},
  {id:"meat_k",  e:"🌭",label:"Колбасные изделия",   count:15, color:"#FB923C",bg:"linear-gradient(145deg,#2A1200,#4A2200)", parentId:"meat"},
  {id:"meat_f",  e:"🐟",label:"Рыба",                count:12, color:"#7DD3FC",bg:"linear-gradient(145deg,#051822,#0E2C3E)", parentId:"meat"},
  {id:"dairy_m", e:"🥛",label:"Молоко и кефир",      count:28, color:"#93C5FD",bg:"linear-gradient(145deg,#0A1828,#163050)", parentId:"dairy"},
  {id:"dairy_s", e:"🧀",label:"Сыры",                count:22, color:"#FCD34D",bg:"linear-gradient(145deg,#281806,#4A2E12)", parentId:"dairy"},
  {id:"dairy_e", e:"🥚",label:"Яйцо",                count:8,  color:"#FBBF24",bg:"linear-gradient(145deg,#281800,#4A2C00)", parentId:"dairy"},
  {id:"dairy_t", e:"🧈",label:"Масло и маргарин",    count:12, color:"#FDE68A",bg:"linear-gradient(145deg,#281A00,#4A3000)", parentId:"dairy"},
  {id:"dairy_y", e:"🍦",label:"Йогурты и творог",    count:18, color:"#C084FC",bg:"linear-gradient(145deg,#1A0C28,#2E1848)", parentId:"dairy"},
  {id:"drink_j", e:"🧃",label:"Соки и нектары",       count:24, color:"#FB923C",bg:"linear-gradient(145deg,#2A1000,#4A2000)", parentId:"drink"},
  {id:"drink_w", e:"💧",label:"Вода",                  count:18, color:"#67E8F9",bg:"linear-gradient(145deg,#041820,#0C2E3A)", parentId:"drink"},
  {id:"drink_t", e:"🍵",label:"Чай и кофе",            count:28, color:"#A78BFA",bg:"linear-gradient(145deg,#14082A,#26104A)", parentId:"drink"},
  {id:"drink_c", e:"🥤",label:"Газированные",          count:18, color:"#34D399",bg:"linear-gradient(145deg,#032010,#06401A)", parentId:"drink"},
  {id:"sweet_c", e:"🍫",label:"Шоколад",               count:32, color:"#C084FC",bg:"linear-gradient(145deg,#1A0C28,#2E1848)", parentId:"sweet"},
  {id:"sweet_b", e:"🍪",label:"Печенье и вафли",        count:28, color:"#FCD34D",bg:"linear-gradient(145deg,#281806,#4A2E12)", parentId:"sweet"},
  {id:"sweet_k", e:"🍬",label:"Конфеты",                count:35, color:"#F472B6",bg:"linear-gradient(145deg,#2A0818,#4A1028)", parentId:"sweet"},
  {id:"sweet_h", e:"🥜",label:"Орехи и сухофрукты",    count:18, color:"#FB923C",bg:"linear-gradient(145deg,#2A1000,#4A2000)", parentId:"sweet"},
];

function productsInCategory(prods, catId, subCatId = null) {
  return prods.filter(p => {
    const slug = productCatSlug(p);
    if (subCatId) return slug === subCatId;
    if (catId) {
      return slug === catId || CATS.filter(c => c.parentId === catId).some(sub => sub.id === slug);
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
    id:'R-01', name:'Чайхона Оромгох',   emoji:'🍖', rating:4.8, reviews:312,
    cuisine:'Таджикская кухня',            tags:['Плов','Шашлык','Манты'],
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
    id:'R-02', name:'Пицца Яван',         emoji:'🍕', rating:4.6, reviews:187,
    cuisine:'Итальянская кухня',           tags:['Пицца','Бургеры','Паста'],
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
    id:'R-03', name:'Суши Яван',          emoji:'🍣', rating:4.9, reviews:94,
    cuisine:'Японская кухня',              tags:['Роллы','Суши','Рамен'],
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
    id:'R-04', name:'Фаст-фуд 24/7',     emoji:'🍟', rating:4.3, reviews:521,
    cuisine:'Быстрое питание',             tags:['Бургеры','Хот-дог','Картошка'],
    minOrder:10, deliveryMin:20, deliveryFee:3, open:true,
    hours:'00:00–24:00', img:'linear-gradient(135deg,#1A1000,#3A2200)',
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

const PARTNER_USERS = [
  {id:'P-01',restId:'R-01',email:'chaihona@kakapo.tj', pass:'rest123',name:'Акбар Ниёзов'},
  {id:'P-02',restId:'R-02',email:'pizza@kakapo.tj',    pass:'rest123',name:'Диёр Каримов'},
  {id:'P-03',restId:'R-03',email:'sushi@kakapo.tj',    pass:'rest123',name:'Мирзо Хасанов'},
  {id:'P-04',restId:'R-04',email:'fastfood@kakapo.tj', pass:'rest123',name:'Зафар Рахимов'},
];

const REST_ORDERS = [
  {id:'K-4832',restId:'R-01',client:'Диловар Р.',  phone:'+992 93 456 78 90',items:['🍚 Плов ×2','🥩 Шашлык ×1'],total:58,status:'cooking',  time:'14:23'},
  {id:'K-4831',restId:'R-01',client:'Нилуфар Х.',  phone:'+992 90 123 45 67',items:['🍜 Лагман ×1','🥗 Салат ×1'],  total:22,status:'ready',    time:'14:10'},
  {id:'K-4830',restId:'R-02',client:'Бахром К.',   phone:'+992 88 789 01 23',items:['🍕 Маргарита ×1','🥤 Кола ×2'],total:38,status:'cooking',  time:'14:05'},
  {id:'K-4829',restId:'R-03',client:'Мадина О.',   phone:'+992 91 111 22 33',items:['🌯 Филадельфия ×2'],            total:64,status:'new',       time:'14:01'},
  {id:'K-4828',restId:'R-02',client:'Рустам Д.',   phone:'+992 93 654 32 10',items:['🍔 Бургер ×2','🍟 Картошка ×1'],total:51,status:'delivered', time:'13:40'},
];

const BANNERS = [
  {e:"🥛",title:"Молочная среда",  sub:"Скидка 30% на молочную продукцию",badge:"Сегодня",disc:30,bg:"linear-gradient(135deg,#061A0C,#0F3020)",ac:"var(--gr)"},
  {e:"🥩",title:"Мясные выходные",sub:"Скидки до 25% на мясо и птицу",   badge:"Сб–Вс",  disc:25,bg:"linear-gradient(135deg,#1A0608,#3A1014)",ac:"var(--red)"},
  {e:"🥦",title:"Органик-день",   sub:"20% на органические продукты",    badge:"Пятница",disc:20,bg:"linear-gradient(135deg,#061A08,#102A14)",ac:"#56C956"},
  {e:"🚀",title:"Бесплатная доставка",sub:"При заказе от 30 ЅМ",        badge:"Всегда", disc:null,bg:"linear-gradient(135deg,#060820,#0E1840)",ac:"var(--blue)"},
];

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
  cancelled:       {l:"Отменён",       c:"var(--red)"},
};

const ORDER_STATUS_FILTERS = [
  { id: 'all', l: 'Все', ic: null, c: 'var(--gr)', activeBg: 'rgba(31,215,96,.11)', activeBd: 'rgba(31,215,96,.35)' },
  { id: 'assembling', l: 'Сборка', ic: 'bag', c: 'var(--pur)', activeBg: 'rgba(155,109,255,.11)', activeBd: 'rgba(155,109,255,.28)' },
  { id: 'cooking', l: 'Кухня', ic: 'zap', c: 'var(--gd)', activeBg: 'rgba(255,184,0,.1)', activeBd: 'rgba(255,184,0,.28)' },
  { id: 'waiting_courier', l: 'Ждём', ic: 'clock', c: 'var(--gd)', activeBg: 'rgba(255,184,0,.1)', activeBd: 'rgba(255,184,0,.28)' },
  { id: 'delivering', l: 'Путь', ic: 'truck', c: 'var(--blue)', activeBg: 'rgba(59,142,240,.1)', activeBd: 'rgba(59,142,240,.28)' },
  { id: 'delivered', l: 'Готов', ic: 'check', c: 'var(--gr)', activeBg: 'rgba(31,215,96,.11)', activeBd: 'rgba(31,215,96,.35)' },
];

function ruCount(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return `${n} ${many}`
  if (mod10 === 1) return `${n} ${one}`
  if (mod10 >= 2 && mod10 <= 4) return `${n} ${few}`
  return `${n} ${many}`
}

function countClientSpent(apiOrders: import('@/lib/types').Order[], phone?: string) {
  const mine = phoneDigits(phone || '')
  if (!mine) return 0
  const add = (list: { id: string; phone?: string; status: string; total?: number }[]) =>
    list.filter(o => phoneDigits(o.phone || '') === mine && o.status === 'delivered')
  if (USE_API) {
    const sum = add(mapOrdersForClient(apiOrders)).reduce((s, o) => s + (o.total || 0), 0)
    return Math.round(sum * 10) / 10
  }
  const byId = new Map<string, { total?: number }>()
  add(mapOrdersForClient(apiOrders)).forEach(o => byId.set(o.id, o))
  add(ORDERS_LIST).forEach(o => byId.set(o.id, o))
  const sum = [...byId.values()].reduce((s, o) => s + (o.total || 0), 0)
  return Math.round(sum * 10) / 10
}

function LoyaltyStatusCard({ loyalty, onVip, adminVip }: { loyalty: ReturnType<typeof getLoyaltyProgress>; onVip: () => void; adminVip?: boolean }) {
  const { tier, nextTier, progressPct, remaining, spent, isVip, vipSteps, vipDoneCount } = loyalty
  return (
    <div className="card" style={{ padding: 14, marginBottom: 12, background: 'linear-gradient(145deg,var(--l2),var(--l1))', border: `1px solid ${tier.color}28` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 22 }}>{tier.emoji}</span>
          <div>
            <div className="ub" style={{ fontSize: 13, fontWeight: 900, color: tier.color }}>{tier.label}</div>
            <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 1 }}>Кешбэк {tier.cashback} · {tier.perk}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="ub" style={{ fontSize: 15, fontWeight: 900, color: 'var(--t1)' }}>{spent.toLocaleString()} <span style={{ fontSize: 10, color: 'var(--gd)' }}>ЅМ</span></div>
          <div style={{ fontSize: 9, color: 'var(--t3)' }}>покупок</div>
        </div>
      </div>

      {nextTier ? (
        <>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--b1)', overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ height: '100%', width: `${progressPct}%`, borderRadius: 3, background: `linear-gradient(90deg,${tier.color},${nextTier.color})`, transition: 'width .4s ease' }} />
          </div>
          <div style={{ fontSize: 10, color: 'var(--t2)', marginBottom: 12 }}>
            До {nextTier.emoji} <span style={{ fontWeight: 700, color: nextTier.color }}>{nextTier.label}</span>
            {' '}— ещё <span style={{ fontWeight: 700, color: 'var(--gr)' }}>{remaining.toLocaleString()} ЅМ</span>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 10, color: 'var(--blue)', fontWeight: 700, marginBottom: 12 }}>✨ Максимальный уровень Platinum</div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, gap: 4 }}>
        {LOYALTY_TIERS.map((t) => {
          const reached = spent >= t.minSpent
          const active = t.id === tier.id
          return (
            <div key={t.id} style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
              <div style={{
                width: '100%', height: 3, borderRadius: 2, marginBottom: 5,
                background: reached ? t.color : 'var(--b1)',
                opacity: active ? 1 : reached ? 0.7 : 0.35,
              }} />
              <div style={{ fontSize: 14, lineHeight: 1, marginBottom: 2 }}>{t.emoji}</div>
              <div style={{ fontSize: 8, fontWeight: active ? 800 : 600, color: active ? t.color : reached ? 'var(--t2)' : 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.label}</div>
              <div style={{ fontSize: 8, color: 'var(--t3)', marginTop: 1 }}>{t.minSpent > 0 ? `${t.minSpent}` : '0'}</div>
            </div>
          )
        })}
      </div>

      <div
        onClick={onVip}
        style={{
          padding: '10px 12px', borderRadius: 12, cursor: 'pointer',
          background: isVip ? 'linear-gradient(135deg,rgba(255,184,0,.15),rgba(255,184,0,.06))' : 'var(--l3)',
          border: `1px solid ${isVip ? 'rgba(255,184,0,.35)' : 'var(--b1)'}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Ic n="crown" s={14} c="var(--gd)" />
            <span className="ub" style={{ fontSize: 12, fontWeight: 900, color: isVip ? 'var(--gd)' : 'var(--t1)' }}>
              {isVip ? 'VIP активен' : 'Путь к VIP'}
            </span>
          </div>
          <span style={{ fontSize: 10, fontWeight: 800, color: isVip ? 'var(--gd)' : 'var(--t3)' }}>
            {loyalty.vipDoneCount}/3
          </span>
        </div>
        {adminVip && isVip && (
          <div style={{ fontSize: 10, color: 'var(--gd)', marginBottom: 8, fontWeight: 700 }}>✓ VIP включён администратором</div>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          {vipSteps.map(step => (
            <div key={step.id} style={{
              flex: 1, padding: '6px 4px', borderRadius: 8, textAlign: 'center',
              background: step.done ? 'rgba(31,215,96,.1)' : 'rgba(0,0,0,.15)',
              border: `1px solid ${step.done ? 'rgba(31,215,96,.25)' : 'var(--b1)'}`,
            }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: step.done ? 'var(--gr)' : 'var(--t3)', marginBottom: 2 }}>{step.label}</div>
              <div style={{ fontSize: 8, color: step.done ? 'var(--gr)' : 'var(--t2)' }}>{step.done ? '✓' : step.progress}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function countClientOrders(apiOrders: import('@/lib/types').Order[], phone?: string) {
  const mine = phoneDigits(phone || '')
  if (!mine) return 0
  const fromApi = mapOrdersForClient(apiOrders).filter(o => phoneDigits(o.phone || '') === mine)
  if (USE_API) return fromApi.length
  const demoStatic = ORDERS_LIST.filter(o => phoneDigits(o.phone || '') === mine)
  const byId = new Map<string, typeof fromApi[0]>()
  fromApi.forEach(o => byId.set(o.id, o))
  demoStatic.forEach(o => byId.set(o.id, o))
  return byId.size
}

function ClientReviewBlock({ review, orderId, embedded }: { review: Review; orderId?: string; embedded?: boolean }) {
  const hasReply = !!(review.adminReply || review.restReply);
  return (
    <div style={embedded ? undefined : { padding: 14, borderRadius: 15, background: "rgba(255,184,0,.06)", border: "1px solid rgba(255,184,0,.22)", marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        {!embedded && <div style={{ fontSize: 13, fontWeight: 800, color: "var(--gd)" }}>⭐ Ваш отзыв{orderId ? ` · ${orderId}` : ''}</div>}
        {embedded && <div style={{ fontSize: 12, fontWeight: 700, color: "var(--t2)" }}>Ваша оценка</div>}
        <span style={{ fontSize: 10, color: "var(--t3)" }}>{review.date}</span>
      </div>
      <div style={{ display: "flex", gap: 2, marginBottom: 8 }}>
        {[1, 2, 3, 4, 5].map(s => (
          <span key={s} style={{ fontSize: 14, color: s <= review.rating ? "#FFB800" : "var(--b2)" }}>★</span>
        ))}
      </div>
      {review.text && (
        <div style={{ fontSize: 13, color: "var(--t1)", lineHeight: 1.55, marginBottom: hasReply ? 12 : 0, padding: "10px 12px", background: "var(--l3)", borderRadius: 10, border: "1px solid var(--b1)" }}>
          {review.text}
        </div>
      )}
      {review.adminReply && (
        <div style={{ fontSize: 12, color: "var(--blue)", marginBottom: review.restReply ? 8 : 0, padding: "10px 12px", background: "rgba(59,142,240,.08)", borderRadius: 10, border: "1px solid rgba(59,142,240,.2)", lineHeight: 1.5 }}>
          <div style={{ fontSize: 10, fontWeight: 800, marginBottom: 4, color: "var(--blue)" }}>💬 Ответ КАКАПО</div>
          {review.adminReply}
        </div>
      )}
      {review.restReply && (
        <div style={{ fontSize: 12, color: "var(--gr)", padding: "10px 12px", background: "rgba(31,215,96,.08)", borderRadius: 10, border: "1px solid rgba(31,215,96,.2)", lineHeight: 1.5 }}>
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
  clientOrder: { items?: { e?: string; name: string; qty?: number; price: number; art?: string; id?: number; product_id?: number; source?: string; restId?: string }[] },
  ctx: {
    apiOrders: import('@/lib/types').Order[];
    prods: { id: number; art?: string; name: string; price: number; e?: string }[];
    restaurants: { id: string; menu?: { id: number; name: string; price: number; e: string }[] }[];
    onAdd: (id: string | number, price?: number, name?: string, emoji?: string, restId?: string) => void;
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
          onAdd(`R${rest.id}_${menuItem.id}`, menuItem.price, menuItem.name, menuItem.e, rest.id);
        }
        added += qty;
      } else if (restId) {
        const cartId = `R${restId}_repeat_${String(it.name).replace(/\s+/g, '_').slice(0, 24)}`;
        for (let i = 0; i < qty; i++) {
          onAdd(cartId, it.price, it.name, it.e || '🍽', restId);
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

const FAQ = [
  {q:"Как быстро доставляют заказ?",         a:"45 минут по всему г. Яван. В часы пик до 60 минут. Придёт SMS когда курьер выедет."},
  {q:"Стоимость доставки?",                  a:"5 ЅМ. Бесплатно при заказе от 30 ЅМ. VIP клиентам — всегда бесплатно."},
  {q:"Какие способы оплаты?",                a:"Наличными курьеру, карты Visa/Mastercard, бонусами."},
  {q:"Как работает бонусная программа?",     a:"Bronze 1%, Silver 2%, Gold 3%, Platinum 5% кешбэк. 1 бонус = 1 ЅМ."},
  {q:"Как стать VIP клиентом?",              a:"30+ заказов, нет долгов, 5 отзывов и верификация. Даёт кредитный лимит до 500 ЅМ."},
  {q:"Как отменить заказ?",                  a:"В течение 5 минут в разделе 'Мои заказы'. После сборки — только по телефону."},
  {q:"Гарантия свежести?",                   a:"Если товар плохого качества — полный возврат в течение 24 часов без вопросов."},
  {q:"Как зарегистрироваться?",              a:"Телефон → SMS код (демо: 1234) → имя. 1 минута. +100 бонусов за регистрацию!"},
  {q:"Можно ли отследить курьера?",          a:"Да! После начала доставки в приложении появится карта с местоположением курьера."},
  {q:"Что если меня нет дома?",              a:"Курьер подождёт 10 минут. Оставьте комментарий к заказу — например, 'оставить у соседа'."},
];
const PCard = ({ p, cart, onAdd, onRm, onWish, wished, go }) => {
  const qty  = cart[p.id] || 0;
  const disc = p.old ? Math.round((1 - p.price / p.old) * 100) : 0;
  const [pop, setPop] = useState(false);
  const photo = useProductPhotos(s => s.photos[p.id]);
  const add = e => { e.stopPropagation(); setPop(true); setTimeout(() => setPop(false), 300); onAdd(p.id); };
  return (
    <div className="card" style={{ display:"flex", flexDirection:"column", cursor:"default", position:"relative" }} onClick={() => go("product", { id:p.id })}>
      <button onClick={e => { e.stopPropagation(); onWish(p.id); }} className="btn" style={{ position:"absolute", top:8, right:8, zIndex:3, width:28, height:28, borderRadius:"50%", background:"rgba(0,0,0,.5)", display:"flex", alignItems:"center", justifyContent:"center" }}>
        <Ic n="heart" s={13} c={wished ? "#FF4545" : "rgba(255,255,255,.5)"} fill={wished ? "#FF4545" : "none"} w={2}/>
      </button>
      <div style={{ position:"absolute", top:8, left:8, display:"flex", flexDirection:"column", gap:3, zIndex:3 }}>
        {disc > 0 && <span className="bdg b-rd">−{disc}%</span>}
        {p.isNew && <span className="bdg b-gr">NEW</span>}
        {p.org && <span className="bdg" style={{ background:"rgba(52,211,153,.12)", color:"#34D399", border:"1px solid rgba(52,211,153,.28)" }}>🌿</span>}
      </div>
      <div style={{ height:110, background:p.grad, display:"flex", alignItems:"center", justifyContent:"center", fontSize:48, animation:p.hot ? "float 3s ease-in-out infinite" : "none", position:"relative", overflow:"hidden" }}>
        {photo
          ? <img src={photo} alt={p.name} style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }}/>
          : p.e
        }
      </div>
      <div style={{ padding:"10px 10px 8px", flex:1, display:"flex", flexDirection:"column", gap:3 }}>
        <div style={{ fontSize:12, fontWeight:700, lineHeight:1.35, minHeight:30 }}>{p.name}</div>
        <div style={{ fontSize:10, color:"var(--t3)" }}>{p.unit}</div>
        <div style={{ display:"flex", alignItems:"center", gap:3 }}><Stars r={p.r} s={8}/><span style={{ fontSize:9, color:"var(--t2)" }}>{p.r}({p.rv})</span></div>
        <div style={{ display:"flex", alignItems:"baseline", gap:5, marginTop:2 }}>
          <span className="ub" style={{ fontSize:15, fontWeight:800 }}>{p.price.toFixed(2)}<span style={{ fontSize:9, color:"var(--gd)", marginLeft:2 }}>ЅМ</span></span>
          {p.old && <span style={{ fontSize:10, color:"var(--t3)", textDecoration:"line-through" }}>{p.old.toFixed(2)}</span>}
        </div>
        <div style={{ fontSize:9, color:"var(--gd)", fontWeight:700 }}>⭐+{Math.ceil(p.price * .03)}</div>
      </div>
      <div style={{ padding:"0 10px 10px" }}>
        {qty === 0 ? (
          <button className="btn" onClick={add} style={{ width:"100%", padding:"9px", fontSize:12, borderRadius:12, background:"linear-gradient(135deg,var(--gr2),var(--gr))", color:"white", display:"flex", alignItems:"center", justifyContent:"center", gap:4, animation:pop ? "cartPop .3s ease" : "none" }}>
            <Ic n="plus" s={12} c="white" w={2.5}/>В корзину
          </button>
        ) : (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:"rgba(31,215,96,.1)", border:"1.5px solid rgba(31,215,96,.28)", borderRadius:12, padding:"4px 8px" }}>
            <button onClick={e => { e.stopPropagation(); onRm(p.id); }} className="btn" style={{ width:28, height:28, borderRadius:8, background:"rgba(31,215,96,.15)", color:"var(--gr)", fontSize:17 }}>−</button>
            <span className="ub" style={{ fontSize:14, fontWeight:800, color:"var(--gr)" }}>{formatCartQtyStepper(p, qty)}</span>
            <button onClick={add} className="btn" style={{ width:28, height:28, borderRadius:8, background:"rgba(31,215,96,.15)", color:"var(--gr)", fontSize:17 }}>+</button>
          </div>
        )}
      </div>
    </div>
  );
};

const HomePage = ({ go, cart, onAdd, onRm, onWish, wished }) => {
  const { prods, restaurants } = useLiveCatalog();
  const [bi, setBi] = useState(0);
  useEffect(() => { const t = setInterval(() => setBi(b => (b + 1) % BANNERS.length), 4000); return () => clearInterval(t); }, []);
  const b = BANNERS[bi];
  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:480, margin:"0 auto" }}>
      <Header go={go} cart={cart}/>
      <div style={{ padding:"14px 18px 100px" }}>
        <div style={{ borderRadius:22, overflow:"hidden", marginBottom:20, cursor:"pointer" }} onClick={() => go("promos")}>
          <div style={{ background:b.bg, padding:"22px 20px 18px", position:"relative", overflow:"hidden" }}>
            <div style={{ position:"absolute", left:0, right:0, height:1, background:`linear-gradient(90deg,transparent,${b.ac}55,transparent)`, animation:"scanLine 3s linear infinite" }}/>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <span className="bdg" style={{ background:`${b.ac}20`, color:b.ac, border:`1px solid ${b.ac}40`, marginBottom:10, display:"inline-flex" }}>✦ {b.badge}</span>
                <div className="ub" style={{ fontSize:22, fontWeight:900, color:"#fff", lineHeight:1.2, marginBottom:6 }}>{b.title}</div>
                <div style={{ fontSize:12, color:"rgba(255,255,255,.6)", marginBottom:12 }}>{b.sub}</div>
                {b.disc && <div style={{ padding:"7px 16px", borderRadius:11, background:b.ac, color:"white", fontFamily:"Unbounded", fontSize:20, fontWeight:900, display:"inline-block" }}>−{b.disc}%</div>}
              </div>
              <div style={{ fontSize:52, animation:"float 2.5s ease-in-out infinite", flexShrink:0 }}>{b.e}</div>
            </div>
            <div style={{ display:"flex", gap:5, marginTop:12 }}>
              {BANNERS.map((_, i) => <div key={i} onClick={e => { e.stopPropagation(); setBi(i); }} style={{ width:i===bi?20:6, height:6, borderRadius:3, background:i===bi?b.ac:"rgba(255,255,255,.2)", transition:"all .3s", cursor:"pointer" }}/>)}
            </div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
          <div className="ub" style={{ fontSize:15, fontWeight:800 }}>Категории</div>
          <button onClick={() => go("catalog")} className="btn" style={{ fontSize:12, color:"var(--gr)", background:"transparent" }}>Все →</button>
        </div>
        <div className="hscroll" style={{ marginBottom:22 }}>
          {CATS.slice(0,6).map(c => (
            <div key={c.id} onClick={() => go("plist", { cat:c.id })} style={{ flexShrink:0, width:90, borderRadius:16, background:c.bg, border:`1px solid ${c.color}22`, padding:"12px 8px", textAlign:"center", cursor:"pointer" }}>
              <div style={{ fontSize:28, marginBottom:6 }}>{c.e}</div>
              <div style={{ fontSize:10, fontWeight:700, color:c.color, lineHeight:1.3 }}>{c.label.split(" ")[0]}</div>
            </div>
          ))}
          <div onClick={() => go("restaurants")} style={{ flexShrink:0, width:90, borderRadius:16, background:"linear-gradient(145deg,#1A0808,#3A1010)", border:"1px solid rgba(255,125,59,.25)", padding:"12px 8px", textAlign:"center", cursor:"pointer" }}>
            <div style={{ fontSize:28, marginBottom:6 }}>🍽</div>
            <div style={{ fontSize:10, fontWeight:700, color:"var(--org)", lineHeight:1.3 }}>Рестораны</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
          <div className="ub" style={{ fontSize:15, fontWeight:800 }}>🍽 Рестораны г. Яван</div>
          <button onClick={() => go("restaurants")} className="btn" style={{ fontSize:12, color:"var(--org)", background:"transparent" }}>Все →</button>
        </div>
        <div className="hscroll" style={{ marginBottom:22 }}>
          {restaurants.map((r,i) => (
            <div key={r.id} onClick={() => go("restaurant",{rid:r.id})}
              style={{ flexShrink:0, width:160, borderRadius:18, overflow:"hidden", background:r.img, cursor:"pointer", animation:`fadeUp .45s cubic-bezier(.16,1,.3,1) ${i*.07}s both`, position:"relative" }}>
              {!r.open && <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,.55)", zIndex:2, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:800, color:"white" }}>🔴 Закрыто</div>}
              <div style={{ padding:"14px 12px 10px", position:"relative", zIndex:1 }}>
                <div style={{ fontSize:36, marginBottom:6 }}>{r.emoji}</div>
                <div className="ub" style={{ fontSize:12, fontWeight:900, color:"white", marginBottom:2, lineHeight:1.3 }}>{r.name}</div>
                <div style={{ fontSize:10, color:"rgba(255,255,255,.6)", marginBottom:8 }}>{r.cuisine}</div>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                  <span style={{ padding:"2px 7px", borderRadius:7, fontSize:9, fontWeight:800, background:"rgba(0,0,0,.4)", color:"rgba(255,255,255,.8)" }}>★ {r.rating}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
          <div className="ub" style={{ fontSize:15, fontWeight:800 }}>🔥 Хиты продаж</div>
          <button onClick={() => go("catalog")} className="btn" style={{ fontSize:12, color:"var(--gr)", background:"transparent" }}>Все →</button>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:20 }}>
          {prods.filter(p => p.hot).slice(0,4).map((p,i) => (
            <div key={p.id} style={{ animation:`fadeUp .45s cubic-bezier(.16,1,.3,1) ${i*.06}s both` }}>
              <PCard p={p} cart={cart} onAdd={onAdd} onRm={onRm} onWish={onWish} wished={!!wished[p.id]} go={go}/>
            </div>
          ))}
        </div>
        <div onClick={() => go("promos")} style={{ borderRadius:18, background:"linear-gradient(135deg,#070A18,#0E1430)", border:"1px solid rgba(59,142,240,.2)", padding:"18px", display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer" }}>
          <div>
            <div className="ub" style={{ fontSize:14, fontWeight:800, marginBottom:4 }}>Акции и скидки</div>
            <div style={{ fontSize:12, color:"var(--t2)" }}>Флэш-распродажа до 20:00 ⚡</div>
          </div>
          <div style={{ fontSize:40, animation:"float 3s ease-in-out infinite" }}>🏷</div>
        </div>
      </div>
      <Nav page="home" go={go}/>
    </div>
  );
};

const CatalogPage = ({ go, cart }) => {
  const { prods, restaurants } = useLiveCatalog();
  return (
  <div style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:480, margin:"0 auto" }}>
    <Header title="Каталог" go={go} cart={cart}/>
    <div style={{ padding:"16px 18px 100px" }}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:22 }}>
        {[{e:"💸",t:"Акции",s:"До 40%",c:"var(--gr)",to:"promos"},{e:"🔥",t:"Хиты",s:"Топ продаж",c:"var(--org)",to:"promos"},{e:"✨",t:"Новинки",s:"Только что",c:"var(--blue)",to:"promos"},{e:"🌿",t:"Органик",s:"Без ГМО",c:"#34D399",to:"promos"}].map((p,i) => (
          <button key={i} type="button" onClick={() => go(p.to)} className="btn" style={{ background:"var(--l2)", border:"1px solid var(--b1)", borderRadius:16, padding:"14px 12px", cursor:"pointer", animation:`fadeUp .4s cubic-bezier(.16,1,.3,1) ${i*.05}s both`, textAlign:"left" }}>
            <div style={{ fontSize:28, marginBottom:8 }}>{p.e}</div>
            <div className="ub" style={{ fontSize:13, fontWeight:800, color:p.c, marginBottom:2 }}>{p.t}</div>
            <div style={{ fontSize:10, color:"var(--t3)" }}>{p.s}</div>
          </button>
        ))}
        <div onClick={() => go("restaurants")} style={{ background:"linear-gradient(135deg,#1A0808,#3A1010)", border:"1px solid rgba(255,125,59,.25)", borderRadius:16, padding:"14px 12px", cursor:"pointer", animation:"fadeUp .4s cubic-bezier(.16,1,.3,1) .2s both", gridColumn:"span 2" }}>
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <div style={{ fontSize:38 }}>🍽</div>
            <div style={{ flex:1 }}>
              <div className="ub" style={{ fontSize:14, fontWeight:800, color:"var(--org)", marginBottom:2 }}>Рестораны г. Яван</div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,.5)", marginBottom:6 }}>Чайхона, Пицца, Суши, Фаст-фуд</div>
              <div style={{ display:"flex", gap:8 }}>
                {restaurants.map(r => (
                  <span key={r.id} style={{ fontSize:18 }}>{r.emoji}</span>
                ))}
              </div>
            </div>
            <div style={{ textAlign:"right", flexShrink:0 }}>
              <div style={{ fontFamily:"Unbounded", fontSize:16, fontWeight:900, color:"var(--org)" }}>{restaurants.length}</div>
              <div style={{ fontSize:10, color:"rgba(255,255,255,.4)" }}>ресторана</div>
              <div style={{ marginTop:6, fontSize:11, fontWeight:700, color:"var(--org)" }}>Смотреть →</div>
            </div>
          </div>
        </div>
      </div>
      <div className="ub" style={{ fontSize:15, fontWeight:800, marginBottom:14 }}>Все категории</div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        {CATS.filter(c=>!c.parentId).map((c,i) => (
          <div key={c.id} onClick={() => go("plist", { cat:c.id })} className="card" style={{ background:c.bg, cursor:"pointer", animation:`fadeUp .45s cubic-bezier(.16,1,.3,1) ${i*.04}s both` }}>
            <div style={{ padding:"16px 14px" }}>
              <div style={{ fontSize:36, marginBottom:8 }}>{c.e}</div>
              <div className="ub" style={{ fontSize:13, fontWeight:800, color:"#fff", marginBottom:4 }}>{c.label}</div>
              <div style={{ fontSize:10, color:"rgba(255,255,255,.5)", marginBottom:10 }}>{formatProductCount(productsInCategory(prods, c.id).length)}</div>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <span style={{ fontSize:11, fontWeight:700, color:c.color }}>Смотреть</span>
                <Ic n="arr" s={13} c={c.color}/>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
    <Nav page="catalog" go={go}/>
  </div>
  );
};
const PListPage = ({ go, params, cart, onAdd, onRm, onWish, wished }) => {
  const { prods } = useLiveCatalog();
  const [sort,    setSort]    = useState("pop");
  const [view,    setView]    = useState("grid");
  const [search,  setSearch]  = useState("");
  const [subCat,  setSubCat]  = useState(null);
  const cat = CATS.find(c => c.id === params?.cat) || CATS[0];
  const subCats = CATS.filter(c => c.parentId === cat.id);
  const hasSubCats = subCats.length > 0;
  const totalQty = formatCartBadgeCount(sumCartUnits(cart, prods));
  const totalQtyNum = sumCartUnits(cart, prods);
  let items = productsInCategory(prods, params?.cat, subCat);
  if (search) items = items.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
  if (sort === "cheap") items = [...items].sort((a,b) => a.price - b.price);
  else if (sort === "exp") items = [...items].sort((a,b) => b.price - a.price);
  else if (sort === "sale") items = items.filter(p => p.old).sort((a,b) => (1-b.price/b.old) - (1-a.price/a.old));
  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:480, margin:"0 auto" }}>
      <header style={{ position:"sticky", top:0, zIndex:100, background:"rgba(3,11,5,.96)", backdropFilter:"blur(24px)", borderBottom:"1px solid var(--b1)" }}>
        <div style={{ padding:"13px 18px 10px", display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={() => go("catalog")} className="btn" style={{ width:38, height:38, borderRadius:12, background:"var(--l3)", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div style={{ width:36, height:36, borderRadius:10, background:cat.bg, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>{cat.e}</div>
          <div style={{ flex:1 }}>
            <div className="ub" style={{ fontSize:15, fontWeight:800 }}>{cat.label}</div>
            <div style={{ fontSize:10, color:"var(--t2)", marginTop:1 }}>{formatProductCount(items.length)}</div>
          </div>
          <button onClick={() => go("cart")} className="btn" style={{ width:38, height:38, borderRadius:12, background:totalQtyNum>0?"linear-gradient(135deg,var(--gr2),var(--gr))":"var(--l3)", border:`1px solid ${totalQtyNum>0?"transparent":"var(--b1)"}`, display:"flex", alignItems:"center", justifyContent:"center", position:"relative", boxShadow:totalQtyNum>0?"0 4px 14px rgba(31,215,96,.4)":"none" }}>
            <Ic n="cart" s={17} c={totalQtyNum>0?"white":"var(--t2)"}/>
            {totalQtyNum>0 && <div style={{ position:"absolute", top:-6, right:-6, minWidth:17, height:17, padding:"0 4px", borderRadius:999, background:"var(--red)", border:"2px solid var(--bg)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Unbounded", fontSize:9, fontWeight:900, color:"white" }}>{totalQty}</div>}
          </button>
        </div>
        <div style={{ padding:"0 18px 10px", position:"relative" }}>
          <div style={{ position:"absolute", left:30, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}><Ic n="search" s={15} c="var(--t3)"/></div>
          <input className="inp" value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск в категории..." style={{ paddingLeft:38, width:"100%", fontSize:13 }}/>
        </div>
        {hasSubCats && (
          <div className="hscroll" style={{ padding:"0 18px 8px", gap:8 }}>
            <button onClick={()=>setSubCat(null)} className="btn"
              style={{ padding:"7px 14px", borderRadius:50, fontSize:12, fontWeight:700, border:`1.5px solid ${!subCat?"rgba(31,215,96,.38)":"var(--b1)"}`, background:!subCat?"rgba(31,215,96,.12)":"var(--l2)", color:!subCat?"var(--gr)":"var(--t2)", whiteSpace:"nowrap", fontFamily:"Nunito", flexShrink:0 }}>
              Все
            </button>
            {subCats.map(sc=>(
              <button key={sc.id} onClick={()=>setSubCat(sc.id)} className="btn"
                style={{ padding:"7px 14px", borderRadius:50, fontSize:12, fontWeight:700, border:`1.5px solid ${subCat===sc.id?"rgba(31,215,96,.38)":"var(--b1)"}`, background:subCat===sc.id?"rgba(31,215,96,.12)":"var(--l2)", color:subCat===sc.id?"var(--gr)":"var(--t2)", whiteSpace:"nowrap", fontFamily:"Nunito", flexShrink:0, display:"flex", alignItems:"center", gap:5 }}>
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
              <button key={v.v} onClick={() => setView(v.v)} className="btn" style={{ width:34, height:34, borderRadius:9, background:view===v.v?"rgba(31,215,96,.12)":"var(--l3)", border:`1.5px solid ${view===v.v?"rgba(31,215,96,.35)":"var(--b1)"}`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                <Ic n={v.n} s={14} c={view===v.v?"var(--gr)":"var(--t2)"}/>
              </button>
            ))}
          </div>
        </div>
      </header>
      <div style={{ padding:"14px 18px 110px" }}>
        {items.length === 0 ? (
          <div style={{ textAlign:"center", paddingTop:60 }}>
            <div style={{ fontSize:56, marginBottom:14 }}>🔍</div>
            <div className="ub" style={{ fontSize:17, fontWeight:800, marginBottom:8 }}>Ничего не найдено</div>
            <button className="btn" onClick={() => setSearch("")} style={{ padding:"12px 24px", borderRadius:14, background:"linear-gradient(135deg,var(--gr2),var(--gr))", color:"white", fontSize:13 }}>Сбросить</button>
          </div>
        ) : view === "grid" ? (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            {items.map((p,i) => <div key={p.id} style={{ animation:`fadeUp .45s cubic-bezier(.16,1,.3,1) ${i*.04}s both` }}><PCard p={p} cart={cart} onAdd={onAdd} onRm={onRm} onWish={onWish} wished={!!wished[p.id]} go={go}/></div>)}
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {items.map((p,i) => {
              const qty = cart[p.id]||0, disc = p.old ? Math.round((1-p.price/p.old)*100) : 0;
              return (
                <div key={p.id} className="card" style={{ display:"flex", alignItems:"center", gap:12, padding:"12px", animation:`fadeUp .4s cubic-bezier(.16,1,.3,1) ${i*.04}s both` }} onClick={() => go("product", { id:p.id })}>
                  <div style={{ width:60, height:60, borderRadius:14, background:p.grad, display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, flexShrink:0, position:"relative" }}>
                    {p.e}{disc>0 && <div style={{ position:"absolute", top:-4, left:-4, borderRadius:8, background:"var(--red)", padding:"1px 5px", fontSize:9, fontWeight:800, color:"white" }}>-{disc}%</div>}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:700, marginBottom:1 }}>{p.name}</div>
                    <div style={{ fontSize:10, color:"var(--t3)", marginBottom:4 }}>{p.unit}</div>
                    <div style={{ display:"flex", alignItems:"center", gap:3 }}><Stars r={p.r} s={8}/><span style={{ fontSize:9, color:"var(--t2)" }}>{p.r}</span></div>
                    <div style={{ display:"flex", alignItems:"baseline", gap:5, marginTop:4 }}>
                      <span className="ub" style={{ fontSize:14, fontWeight:800 }}>{p.price.toFixed(2)}<span style={{ fontSize:9, color:"var(--gd)", marginLeft:2 }}>ЅМ</span></span>
                      {p.old && <span style={{ fontSize:10, color:"var(--t3)", textDecoration:"line-through" }}>{p.old.toFixed(2)}</span>}
                    </div>
                  </div>
                  <div style={{ flexShrink:0 }}>
                    {qty === 0 ? (
                      <button onClick={e => { e.stopPropagation(); onAdd(p.id); }} className="btn" style={{ width:36, height:36, borderRadius:10, background:"linear-gradient(135deg,var(--gr2),var(--gr))", display:"flex", alignItems:"center", justifyContent:"center" }}>
                        <Ic n="plus" s={16} c="white" w={2.5}/>
                      </button>
                    ) : (
                      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, background:"rgba(31,215,96,.1)", border:"1.5px solid rgba(31,215,96,.28)", borderRadius:10, padding:"4px 6px" }}>
                        <button onClick={e => { e.stopPropagation(); onRm(p.id); }} className="btn" style={{ width:22, height:22, borderRadius:6, background:"rgba(31,215,96,.18)", color:"var(--gr)", fontSize:14, fontWeight:700 }}>−</button>
                        <span className="ub" style={{ fontSize:12, fontWeight:800, color:"var(--gr)" }}>{formatCartQtyStepper(p, qty)}</span>
                        <button onClick={e => { e.stopPropagation(); onAdd(p.id); }} className="btn" style={{ width:22, height:22, borderRadius:6, background:"rgba(31,215,96,.18)", color:"var(--gr)", fontSize:14, fontWeight:700 }}>+</button>
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
        <FloatingCartBtn count={totalQty} onClick={() => go("cart")} label="Корзина" />
      )}
      <Nav page="catalog" go={go}/>
    </div>
  );
};

const QtyStepper = ({ qty, onAdd, onRm, size = "md", label }) => {
  const btn = size === "sm" ? 34 : 40;
  const display = label ?? qty;
  const wrap = {
    display: "flex",
    alignItems: "center",
    gap: size === "sm" ? 6 : 8,
    background: "rgba(255,255,255,.04)",
    border: "1px solid var(--b1)",
    borderRadius: size === "sm" ? 12 : 14,
    padding: size === "sm" ? "4px 5px" : "5px 8px",
  };
  const btnStyle = {
    width: btn,
    height: btn,
    borderRadius: btn / 2,
    background: "rgba(31,215,96,.12)",
    border: "1px solid rgba(31,215,96,.22)",
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

const ProductPage = ({ go, params, cart, onAdd, onRm, onWish, wished }) => {
  const { prods } = useLiveCatalog();
  const p = prods.find(x => x.id == params?.id) || prods[0];
  const qty = cart[p.id] || 0;
  const [tab, setTab] = useState("desc");
  const [myRating, setMyRating] = useState(0);
  const photo = useProductPhotos(s => s.photos[p.id]);
  const disc = p.old ? Math.round((1 - p.price / p.old) * 100) : 0;
  const pCat = productCatSlug(p);
  const related = prods.filter(x => productCatSlug(x) === pCat && x.id !== p.id).slice(0, 4);
  const cartBadge = formatCartBadgeCount(sumCartUnits(cart, prods));
  const cartBadgeNum = sumCartUnits(cart, prods);
  const weighted = isWeighted(p);
  const qtyLabel = weighted ? formatCartQtyStepper(p, qty) : qty;
  const add = () => onAdd(p.id);
  const rm  = () => onRm(p.id);
  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:480, margin:"0 auto" }}>
      <div style={{ position:"fixed", top:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, zIndex:100, padding:"14px 18px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <button onClick={() => go("catalog")} className="btn" style={{ width:40, height:40, borderRadius:"50%", background:"rgba(3,11,5,.75)", backdropFilter:"blur(12px)", border:"1px solid rgba(255,255,255,.1)", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="arrL" s={18} c="var(--t1)"/></button>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={() => onWish(p.id)} className="btn" style={{ width:40, height:40, borderRadius:"50%", background:"rgba(3,11,5,.75)", backdropFilter:"blur(12px)", border:"1px solid rgba(255,255,255,.1)", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <Ic n="heart" s={18} c={wished[p.id] ? "#FF4545" : "var(--t1)"} fill={wished[p.id] ? "#FF4545" : "none"}/>
          </button>
          <button onClick={() => go("cart")} className="btn" style={{ width:40, height:40, borderRadius:"50%", background:"rgba(3,11,5,.75)", backdropFilter:"blur(12px)", border:"1px solid rgba(255,255,255,.1)", display:"flex", alignItems:"center", justifyContent:"center", position:"relative" }}>
            <Ic n="cart" s={18} c="var(--t1)"/>
            {cartBadgeNum>0 && <div style={{ position:"absolute", top:-4, right:-4, minWidth:16, height:16, padding:"0 3px", borderRadius:999, background:"var(--gr)", border:"2px solid var(--bg)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Unbounded", fontSize:8, fontWeight:900, color:"var(--bg)" }}>{cartBadge}</div>}
          </button>
        </div>
      </div>
      <div style={{ height:300, background:p.grad, display:"flex", alignItems:"center", justifyContent:"center", position:"relative", overflow:"hidden" }}>
        {photo
          ? <img src={photo} alt={p.name} style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }}/>
          : <div style={{ fontSize:120, filter:"drop-shadow(0 20px 40px rgba(0,0,0,.5))", animation:"float 3s ease-in-out infinite", position:"relative", zIndex:1 }}>{p.e}</div>
        }
        <div style={{ position:"absolute", bottom:18, left:18, display:"flex", gap:6 }}>
          {p.org && <span className="bdg" style={{ background:"rgba(52,211,153,.18)", color:"#34D399", border:"1px solid rgba(52,211,153,.35)" }}>🌿 Органик</span>}
          {p.hot && <span className="bdg b-gd">🔥 Хит</span>}
          {disc>0 && <span className="bdg b-rd">−{disc}%</span>}
        </div>
        <div style={{ position:"absolute", bottom:0, left:0, right:0, height:80, background:"linear-gradient(transparent,var(--bg))" }}/>
      </div>
      <div style={{ padding:"0 18px 140px" }}>
        <div style={{ fontSize:11, color:"var(--t3)", marginBottom:10 }}>{CATS.find(c => c.id === pCat)?.label || p.catLabel || p.cat}</div>
        <div className="ub" style={{ fontSize:22, fontWeight:900, lineHeight:1.2, marginBottom:10 }}>{p.name}</div>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
          <Stars r={p.r} s={13}/><span className="ub" style={{ fontSize:13, fontWeight:800 }}>{p.r}</span><span style={{ fontSize:12, color:"var(--t2)" }}>({p.rv} отзывов)</span>
          <span style={{ fontSize:11, color:"var(--gr)", fontWeight:700, display:"flex", alignItems:"center", gap:4 }}><div style={{ width:6, height:6, borderRadius:"50%", background:"var(--gr)", animation:"pulse 2s infinite" }}/>В наличии</span>
        </div>
        <div className="card" style={{ padding:"18px", marginBottom:16 }}>
          <div style={{ display:"flex", alignItems:"flex-end", gap:10, marginBottom:4 }}>
            <span className="ub" style={{ fontSize:34, fontWeight:900 }}>{p.price.toFixed(2)}</span>
            <span style={{ fontSize:18, color:"var(--gd)", fontWeight:800, marginBottom:2 }}>ЅМ</span>
            {p.old && <><span style={{ fontSize:16, color:"var(--t3)", textDecoration:"line-through", marginBottom:4 }}>{p.old.toFixed(2)} ЅМ</span><span className="bdg b-rd">−{disc}%</span></>}
          </div>
          <div style={{ fontSize:12, color:"var(--t2)", marginBottom:10 }}>{formatPriceLabel(p)}{weighted && <span style={{ color:"var(--org)", marginLeft:8 }}>⚖️ На развес</span>}</div>
          <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 13px", borderRadius:12, background:"rgba(255,184,0,.07)", border:"1px solid rgba(255,184,0,.22)", marginBottom:14 }}>
            <span style={{ fontSize:18 }}>⭐</span>
            <div><div style={{ fontSize:12, fontWeight:800, color:"var(--gd)" }}>+{Math.ceil(p.price*.03)} бонуса за покупку</div><div style={{ fontSize:10, color:"var(--t2)" }}>1 бонус = 1 ЅМ</div></div>
          </div>
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <QtyStepper qty={qty} label={qtyLabel} onAdd={add} onRm={rm}/>
            <button onClick={add} className="btn" style={{ flex:1, padding:"14px", fontSize:14, borderRadius:14, background:qty>0?"rgba(31,215,96,.14)":"linear-gradient(135deg,var(--gr2),var(--gr))", border:qty>0?"1.5px solid rgba(31,215,96,.35)":"none", color:qty>0?"var(--gr)":"white", display:"flex", alignItems:"center", justifyContent:"center", gap:8, boxShadow:qty>0?"none":"0 6px 20px rgba(31,215,96,.28)" }}>
              <Ic n="bag" s={18} c={qty>0?"var(--gr)":"white"}/>{qty===0 ? (weighted ? "В корзину" : "В корзину") : `Добавить · ${calcLineTotal(p, qty).toFixed(2)} ЅМ`}
            </button>
          </div>
        </div>
        <div style={{ borderBottom:"1px solid var(--b1)", display:"flex", marginBottom:18 }}>
          {[{id:"desc",l:"Описание"},{id:"spec",l:"Характеристики"},{id:"rev",l:`Отзывы (${p.rv})`}].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className="btn" style={{ flex:1, padding:"11px 4px", fontSize:13, background:"transparent", color:tab===t.id?"var(--gr)":"var(--t2)", borderBottom:`2px solid ${tab===t.id?"var(--gr)":"transparent"}`, borderRadius:0, fontWeight:700, transition:"all .2s" }}>{t.l}</button>
          ))}
        </div>
        {tab==="desc" && <div style={{ fontSize:13, color:"var(--t2)", lineHeight:1.75, animation:"fadeIn .3s ease" }}>{p.desc}</div>}
        {tab==="spec" && (
          <div className="card" style={{ animation:"fadeIn .3s ease", overflow:"hidden" }}>
            {Object.entries(p.specs).map(([k,v],i,arr) => (
              <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"13px 16px", borderBottom:i<arr.length-1?"1px solid var(--b1)":"none" }}>
                <span style={{ fontSize:12, color:"var(--t2)" }}>{k}</span><span style={{ fontSize:12, fontWeight:700 }}>{v}</span>
              </div>
            ))}
          </div>
        )}
        {tab==="rev" && (
          <div style={{ animation:"fadeIn .3s ease" }}>
            {[{name:"Диловар Р.",av:"Д",r:5,d:"12 мая",t:"Отличное качество! Буду заказывать снова."},{name:"Нилуфар Х.",av:"Н",r:4,d:"10 мая",t:"Хороший товар, доставили быстро."}].map((rv,i) => (
              <div key={i} style={{ background:"var(--l2)", border:"1px solid var(--b1)", borderRadius:16, padding:"14px", marginBottom:10 }}>
                <div style={{ display:"flex", gap:10, marginBottom:8 }}>
                  <div style={{ width:36, height:36, borderRadius:"50%", background:"linear-gradient(135deg,var(--gr3),var(--gr))", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Unbounded", fontSize:14, fontWeight:900, color:"var(--bg)", flexShrink:0 }}>{rv.av}</div>
                  <div><div style={{ fontSize:13, fontWeight:700 }}>{rv.name}</div><div style={{ display:"flex", alignItems:"center", gap:6, marginTop:2 }}><Stars r={rv.r} s={9}/><span style={{ fontSize:10, color:"var(--t3)" }}>{rv.d}</span></div></div>
                </div>
                <p style={{ fontSize:12, color:"var(--t2)", lineHeight:1.6 }}>{rv.t}</p>
              </div>
            ))}
            <div style={{ background:"var(--l2)", border:"1px solid var(--b1)", borderRadius:16, padding:"16px" }}>
              <div style={{ fontSize:13, fontWeight:700, marginBottom:10 }}>Ваша оценка:</div>
              <div style={{ display:"flex", gap:6, marginBottom:12 }}>
                {[1,2,3,4,5].map(i => <svg key={i} width={30} height={30} viewBox="0 0 24 24" style={{ cursor:"pointer" }} onClick={() => setMyRating(i)}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill={i<=myRating?"#FFB800":"rgba(255,184,0,.15)"} stroke="#FFB800" strokeWidth={1}/></svg>)}
              </div>
              <button className="btn" style={{ width:"100%", padding:"12px", borderRadius:13, background:"linear-gradient(135deg,var(--gr2),var(--gr))", color:"white", fontSize:13, display:"flex", alignItems:"center", justifyContent:"center", gap:7, opacity:myRating>0?1:.5 }}><Ic n="star" s={15} c="white"/>Отправить отзыв</button>
            </div>
          </div>
        )}
        {related.length > 0 && (
          <div style={{ marginTop:24 }}>
            <div className="ub" style={{ fontSize:15, fontWeight:800, marginBottom:14 }}>Похожие товары</div>
            <div className="hscroll">
              {related.map(rp => (
                <div key={rp.id} className="card" style={{ width:140, flexShrink:0, cursor:"pointer" }} onClick={() => go("product", { id:rp.id })}>
                  <div style={{ height:80, background:rp.grad, display:"flex", alignItems:"center", justifyContent:"center", fontSize:36 }}>{rp.e}</div>
                  <div style={{ padding:"9px 10px 8px" }}>
                    <div style={{ fontSize:11, fontWeight:700, lineHeight:1.3, marginBottom:3 }}>{rp.name}</div>
                    <div style={{ fontSize:10, color:"var(--t3)", marginBottom:5 }}>{rp.unit}</div>
                    <span className="ub" style={{ fontSize:13, fontWeight:800 }}>{rp.price.toFixed(2)}<span style={{ fontSize:9, color:"var(--gd)", marginLeft:2 }}>ЅМ</span></span>
                  </div>
                  <div style={{ padding:"0 10px 10px" }}>
                    <button onClick={e => { e.stopPropagation(); onAdd(rp.id); }} className="btn" style={{ width:"100%", padding:"8px", borderRadius:10, background:"linear-gradient(135deg,var(--gr2),var(--gr))", color:"white", fontSize:11, display:"flex", alignItems:"center", justifyContent:"center", gap:4 }}>
                      <Ic n="plus" s={11} c="white" w={2.5}/>В корзину
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, zIndex:90, background:"rgba(3,11,5,.97)", backdropFilter:"blur(26px)", borderTop:"1px solid var(--b1)", padding:"12px 18px 24px" }}>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:10, color:"var(--t3)" }}>К оплате</div>
            <div style={{ display:"flex", alignItems:"baseline", gap:5 }}>
              <span className="ub" style={{ fontSize:22, fontWeight:900 }}>{qty>0?(p.price*qty).toFixed(2):p.price.toFixed(2)}</span>
              <span style={{ fontSize:13, color:"var(--gd)", fontWeight:700 }}>ЅМ</span>
            </div>
          </div>
          {qty === 0 ? (
            <button onClick={add} className="btn" style={{ flex:2, padding:"14px", fontSize:14, borderRadius:16, background:"linear-gradient(135deg,var(--gr2),var(--gr))", color:"white", display:"flex", alignItems:"center", justifyContent:"center", gap:8, boxShadow:"0 6px 20px rgba(31,215,96,.28)" }}>
              <Ic n="bag" s={18} c="white"/>В корзину
            </button>
          ) : (
            <div style={{ flex:2, display:"flex", gap:8, alignItems:"center" }}>
              <QtyStepper qty={qty} label={qtyLabel} onAdd={add} onRm={rm} size="sm"/>
              <button onClick={() => go("cart")} className="btn" style={{ flex:1, padding:"13px", fontSize:13, borderRadius:13, background:"linear-gradient(135deg,var(--gr2),var(--gr))", color:"white", display:"flex", alignItems:"center", justifyContent:"center", gap:6, boxShadow:"0 4px 16px rgba(31,215,96,.22)" }}>
                <Ic n="check" s={15} c="white" w={2.5}/>Оформить
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
const CartPage = ({ go, cart, cartMeta = {}, onAdd, onRm, onDel }) => {
  const { prods } = useLiveCatalog();
  const [promo, setPromo] = useState("");
  const [promoOk, setPromoOk] = useState(false);
  const [promoErr, setPromoErr] = useState(false);
  const prodItems = prods.filter(p => cart[p.id] > 0).map(p => ({ ...p, qty:cart[p.id] }));
  const restItems = Object.keys(cartMeta).filter(id => cart[id] > 0).map(id => ({
    id, e: cartMeta[id].emoji, name: cartMeta[id].name, price: cartMeta[id].price,
    qty: cart[id], isRest: true, restId: cartMeta[id].restId
  }));
  const items = [...prodItems, ...restItems];
  const sub   = items.reduce((s,p) => s + calcLineTotal(p, p.qty), 0);
  const disc  = promoOk ? sub * .1 : 0;
  const total = sub - disc;
  const tqty  = items.length;
  const applyPromo = () => {
    const p = promo.trim().toUpperCase()
    if (p === "КАКАПО10" || p === "KAKAPO10") { setPromoOk(true); setPromoErr(false); }
    else { setPromoErr(true); setTimeout(() => setPromoErr(false), 2200); }
  };
  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:480, margin:"0 auto" }}>
      <header style={{ position:"sticky", top:0, zIndex:100, background:"rgba(3,11,5,.96)", backdropFilter:"blur(24px)", borderBottom:"1px solid var(--b1)" }}>
        <div style={{ padding:"14px 18px 13px", display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={() => go("home")} className="btn" style={{ width:38, height:38, borderRadius:12, background:"var(--l3)", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div style={{ flex:1 }}><div className="ub" style={{ fontSize:17, fontWeight:900 }}>Корзина</div><div style={{ fontSize:10, color:"var(--t2)", marginTop:1 }}>{tqty} товаров</div></div>
          {items.length>0 && <button onClick={() => items.forEach(p=>onDel(p.id))} className="btn" style={{ fontSize:11, color:"var(--red)", background:"rgba(255,69,69,.1)", border:"1px solid rgba(255,69,69,.25)", borderRadius:10, padding:"6px 12px" }}>Очистить</button>}
        </div>
      </header>
      {items.length === 0 ? (
        <div style={{ textAlign:"center", padding:"60px 24px" }}>
          <div style={{ fontSize:80, marginBottom:16, animation:"float 3s ease-in-out infinite" }}>🛒</div>
          <div className="ub" style={{ fontSize:20, fontWeight:800, marginBottom:8 }}>Корзина пустая</div>
          <div style={{ fontSize:13, color:"var(--t2)", marginBottom:24 }}>Добавьте товары из каталога</div>
          <button onClick={() => go("catalog")} className="btn" style={{ padding:"14px 32px", borderRadius:16, background:"linear-gradient(135deg,var(--gr2),var(--gr))", color:"white", fontSize:14 }}>Перейти в каталог</button>
        </div>
      ) : (
        <div style={{ padding:"14px 18px calc(120px + env(safe-area-inset-bottom, 0px))" }}>
          <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:14 }}>
            {items.map(p => {
              const disc2 = p.old ? Math.round((1-p.price/p.old)*100) : 0;
              return (
                <div key={p.id} className="card" style={{ display:"flex", alignItems:"center", gap:12, padding:"13px" }}>
                  <div style={{ width:62, height:62, borderRadius:15, background:p.grad||"linear-gradient(135deg,#2A1400,#4A2400)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, flexShrink:0, position:"relative" }}>
                    {p.e}{disc2>0 && <div style={{ position:"absolute", top:-4, left:-4, borderRadius:8, background:"var(--red)", padding:"1px 5px", fontSize:9, fontWeight:800, color:"white" }}>-{disc2}%</div>}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:700, marginBottom:2 }}>{p.name}</div>
                    <div style={{ fontSize:11, color:"var(--t3)", marginBottom:6 }}>{p.isRest ? "🍽 Ресторан" : (isWeighted(p) ? `⚖️ ${formatCartQty(p, p.qty)}` : (p.unit||"шт"))}</div>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                      <span className="ub" style={{ fontSize:15, fontWeight:800 }}>{calcLineTotal(p, p.qty).toFixed(2)}<span style={{ fontSize:10, color:"var(--gd)", marginLeft:2 }}>ЅМ</span></span>
                      <div style={{ display:"flex", alignItems:"center", gap:0, background:"rgba(31,215,96,.1)", border:"1.5px solid rgba(31,215,96,.25)", borderRadius:11, overflow:"hidden" }}>
                        <button onClick={() => (isWeighted(p) ? p.qty <= (p.minWeight || 100) : p.qty===1) ? onDel(p.id) : onRm(p.id)} className="btn" style={{ width:33, height:33, display:"flex", alignItems:"center", justifyContent:"center", color:(!isWeighted(p) && p.qty===1) || (isWeighted(p) && p.qty <= (p.minWeight || p.weightStep || 100)) ? "var(--red)" : "var(--gr)", background:"transparent", fontSize:16 }}>
                          {((!isWeighted(p) && p.qty===1) || (isWeighted(p) && p.qty <= (p.minWeight || p.weightStep || 100))) ? <Ic n="trash" s={13} c="var(--red)"/> : "−"}
                        </button>
                        <span className="ub" style={{ minWidth:36, textAlign:"center", fontSize:12, fontWeight:800, color:"var(--gr)" }}>{isWeighted(p) ? formatCartQtyStepper(p, p.qty) : p.qty}</span>
                        <button onClick={() => onAdd(p.id)} className="btn" style={{ width:33, height:33, display:"flex", alignItems:"center", justifyContent:"center", color:"var(--gr)", background:"transparent", fontSize:18 }}>+</button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="card" style={{ padding:"16px", marginBottom:14 }}>
            <div style={{ fontSize:13, fontWeight:700, marginBottom:10, display:"flex", alignItems:"center", gap:6 }}><Ic n="percent" s={15} c="var(--gr)"/>Промокод</div>
            <div style={{ display:"flex", gap:8 }}>
              <input className={`inp ${promoErr?"inp-err":promoOk?"inp-ok":""}`} value={promo} onChange={e => { setPromo(e.target.value); setPromoErr(false); }} placeholder="Введите промокод..." style={{ flex:1 }}/>
              <button onClick={applyPromo} className="btn" style={{ padding:"12px 16px", borderRadius:13, background:"linear-gradient(135deg,var(--gr2),var(--gr))", color:"white", fontSize:13, flexShrink:0 }}>
                {promoOk ? <Ic n="check" s={16} c="white" w={2.5}/> : "Применить"}
              </button>
            </div>
            {promoOk && <div style={{ marginTop:7, fontSize:11, color:"var(--gr)", fontWeight:700, display:"flex", alignItems:"center", gap:5 }}><Ic n="check" s={11} c="var(--gr)" w={2.5}/>КАКАПО10 — скидка 10% применена!</div>}
            {promoErr && <div style={{ marginTop:7, fontSize:11, color:"var(--red)", fontWeight:700 }}>✗ Неверный промокод. Попробуйте КАКАПО10</div>}
          </div>
          <div className="card" style={{ padding:"16px", marginBottom:14 }}>
            {[{l:`Товары (${tqty} шт)`,v:`${sub.toFixed(2)} ЅМ`,c:"var(--t1)"},...(promoOk?[{l:"Промокод -10%",v:`−${disc.toFixed(2)} ЅМ`,c:"var(--gr)"}]:[])].map((r,i) => (
              <div key={i} style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}><span style={{ fontSize:12, color:"var(--t2)" }}>{r.l}</span><span style={{ fontSize:13, fontWeight:700, color:r.c }}>{r.v}</span></div>
            ))}
            <div style={{ height:1, background:"var(--b1)", margin:"8px 0" }}/>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
              <span style={{ fontSize:14, fontWeight:700 }}>Итого</span>
              <span className="ub" style={{ fontSize:24, fontWeight:900 }}>{total.toFixed(2)} <span style={{ fontSize:14, color:"var(--gd)" }}>ЅМ</span></span>
            </div>
          </div>
        </div>
      )}
      {items.length > 0 && (
        <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, zIndex:210, background:"rgba(3,11,5,.97)", backdropFilter:"blur(26px)", borderTop:"1px solid var(--b1)", padding:"12px 18px calc(16px + env(safe-area-inset-bottom, 0px))" }}>
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:10, color:"var(--t3)" }}>К оплате</div>
              <div style={{ display:"flex", alignItems:"baseline", gap:5 }}>
                <span className="ub" style={{ fontSize:22, fontWeight:900 }}>{total.toFixed(2)}</span>
                <span style={{ fontSize:13, color:"var(--gd)", fontWeight:800 }}>ЅМ</span>
              </div>
            </div>
            <button onClick={() => go("checkout")} className="btn" style={{ flex:2, padding:"14px 12px", fontSize:14, borderRadius:16, background:"linear-gradient(135deg,var(--gr2),var(--gr))", color:"white", display:"flex", alignItems:"center", justifyContent:"center", gap:8, boxShadow:"0 6px 20px rgba(31,215,96,.28)" }}>
              <Ic n="bag" s={18} c="white"/>Оформить · {tqty} шт
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const CHECKOUT_PAYS = [
  { id: 'cash', icon: '💵', label: 'Наличными', sub: 'Курьеру' },
  { id: 'card', icon: '💳', label: 'Карта', sub: 'Visa/Mastercard' },
  { id: 'bonus', icon: '⭐', label: 'Бонусами', sub: '73 бонуса' },
];
const CHECKOUT_TIMES = [
  { id: 'asap', l: 'Как можно скорее', s: '~45 мин' },
  { id: 't1', l: '12:00–14:00', s: 'Сегодня' },
  { id: 't2', l: '14:00–16:00', s: 'Сегодня' },
  { id: 't3', l: '18:00–20:00', s: 'Сегодня' },
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
            background: val === m.id ? 'rgba(31,215,96,.08)' : 'var(--l3)',
            border: `1.5px solid ${val === m.id ? 'rgba(31,215,96,.4)' : 'var(--b1)'}`,
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
          {m.id === 'asap' && (
            <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 8, background: 'rgba(31,215,96,.12)', color: 'var(--gr)' }}>~45 мин</span>
          )}
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

const CheckoutPage = ({ go, cart, cartMeta = {}, onClearCart, user }) => {
  const { prods, restaurants } = useLiveCatalog();
  const createOrder = useOrders(s => s.createOrder);
  const [step,  setStep]  = useState("form");
  const [name,  setName]  = useState("");
  const [phone, setPhone] = useState("");
  const [addr,  setAddr]  = useState("");
  const [pay,   setPay]   = useState("cash");
  const [time,  setTime]  = useState("asap");
  const [bonus, setBonus] = useState(false);
  const [errs,  setErrs]  = useState({});
  const [loading, setLoading] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const [orderId, setOrderId] = useState("");
  const [checkoutMode, setCheckoutMode] = useState('market');
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [deliveryKm, setDeliveryKm] = useState(0);
  const [deliveryMin, setDeliveryMin] = useState(0);
  const [addrReady, setAddrReady] = useState(false);
  const [clientLat, setClientLat] = useState(0);
  const [clientLng, setClientLng] = useState(0);
  const [savedAddrs, setSavedAddrs] = useState([]);

  const clientPhone = user?.phone || getActiveClientPhone(user);

  // Загрузить сохранённые адреса + автозаполнить адрес по умолчанию (только для текущего аккаунта)
  useEffect(() => {
    if (!clientPhone) {
      setSavedAddrs([]);
      return;
    }
    try {
      migrateLegacyClientData(clientPhone);
      const list = loadClientAddresses(clientPhone);
      if (list.length) setSavedAddrs(list);
      const def = list.find(a => a.def) || list[0];
      if (def) {
        setAddr(formatClientAddressLine(def));
        if (def.lat != null && def.lng != null) {
          setClientLat(def.lat);
          setClientLng(def.lng);
          setAddrReady(true);
        }
      }
    } catch { /* ignore */ }
  }, [clientPhone]);

  useEffect(() => {
    if (user?.name && !name) setName(user.name)
    if (user?.phone && !phone) {
      setPhone(user.phone.replace(/^\+992\s?/, '').trim())
    }
  }, [user, name, phone])

  const pickSavedAddr = (a) => {
    setAddr(formatClientAddressLine(a));
    setErrs(prev => ({ ...prev, addr: undefined }));
    if (a.lat != null && a.lng != null) {
      setClientLat(a.lat)
      setClientLng(a.lng)
      setAddrReady(true)
    } else {
      resetDelivery()
    }
  };

  const prodItems = prods.filter(p => cart[p.id] > 0).map(p => ({ ...p, qty: cart[p.id] }));
  const restItems = Object.keys(cartMeta).filter(id => cart[id] > 0).map(id => ({
    id,
    e: cartMeta[id].emoji,
    name: cartMeta[id].name,
    price: cartMeta[id].price,
    qty: cart[id],
    restId: cartMeta[id].restId,
  }));
  const items = [...prodItems, ...restItems];
  const sub = items.reduce((s, p) => s + calcLineTotal(p, p.qty), 0);
  const weightKg = estimateCartWeightKg(prodItems.map(p => ({ p, qty: p.qty })));
  const pickupIds = resolveCheckoutPickupIds({
    hasMarketItems: prodItems.length > 0,
    restIds: [...new Set(restItems.map(r => r.restId).filter(Boolean))],
  });
  const total = sub;

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
    if (!validate()) return;
    setLoading(true);
    setSubmitErr("");

    const hasMarket = prodItems.length > 0;
    const hasRest = restItems.length > 0;
    const orderType = hasMarket && hasRest ? 'mixed' : hasRest ? 'restaurant' : 'market';
    const restIds = [...new Set(restItems.map(r => r.restId).filter(Boolean))];

    const payload = {
      type: orderType,
      client: { name, phone, addr, lat: clientLat, lng: clientLng },
      items: [
        ...prodItems.map(p => orderItemFromProduct(p, p.qty)),
        ...restItems.map(p => ({
          name: p.name || 'Блюдо',
          e: p.e || '🍽',
          qty: p.qty,
          unit: 'порция',
          price: Number(p.price) || 0,
          source: 'restaurant',
          restId: p.restId,
        })),
      ],
      total: Number(total.toFixed(2)),
      deliveryFee: 0,
      pickupIds,
      distanceKm: deliveryKm > 0 ? Number(deliveryKm.toFixed(2)) : undefined,
      durationMin: deliveryMin > 0 ? Math.round(deliveryMin) : undefined,
      weightKg: Number(weightKg.toFixed(1)),
      restIds,
      restId: restIds[0],
      restName: restIds[0] ? restaurants.find(r => r.id === restIds[0])?.name : undefined,
      comment: '',
    };

    let order = null;
    let errMsg = '';
    try {
      order = await createOrder(payload);
    } catch (e) {
      errMsg = e instanceof Error ? e.message : 'Не удалось оформить заказ. Проверьте интернет и попробуйте снова.';
    }
    setLoading(false);

    if (order) {
      setOrderId(order.id);
      setCheckoutMode(orderType);
      try { localStorage.setItem('kakapo_client_phone', phone); } catch { /* private mode */ }
      setStep('ok');
      onClearCart?.();
    } else {
      setSubmitErr(errMsg || 'Не удалось оформить заказ. Проверьте интернет и попробуйте снова.');
    }
  };

  if (step === "ok") return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:480, margin:"0 auto", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"32px 24px", textAlign:"center" }}>
      <div style={{ width:90, height:90, borderRadius:"50%", background:"linear-gradient(135deg,var(--gr3),var(--gr))", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 0 60px rgba(31,215,96,.5)", marginBottom:24, animation:"successPop .6s cubic-bezier(.16,1,.3,1)" }}>
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
        {[{icon:"bag",l:"Номер заказа",v:orderId||"—",c:"var(--gr)"},{icon:"clock",l:"Доставка",v:`~${deliveryMin || 45} минут`,c:"var(--gd)"},{icon:"map",l:"Адрес",v:addr||"ул. Ленина, 42",c:"var(--sky)"},{icon:"star",l:"Бонусы",v:"+12 начислено",c:"var(--gd)"}].map((r,i) => (
          <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom:i<3?"1px solid var(--b1)":"none" }}>
            <div style={{ width:30, height:30, borderRadius:8, background:`${r.c}18`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Ic n={r.icon} s={14} c={r.c}/></div>
            <span style={{ fontSize:12, color:"var(--t2)", flex:1 }}>{r.l}</span>
            <span style={{ fontSize:12, fontWeight:700, color:r.c }}>{r.v}</span>
          </div>
        ))}
      </div>
      <button onClick={() => go("orders")} className="btn" style={{ width:"100%", padding:"15px", fontSize:14, borderRadius:17, background:"linear-gradient(135deg,var(--gr2),var(--gr))", color:"white", marginBottom:10 }}>Мои заказы</button>
      <button onClick={() => go("home")} className="btn" style={{ width:"100%", padding:"14px", fontSize:13, borderRadius:17, background:"var(--l2)", border:"1px solid var(--b1)", color:"var(--t2)" }}>На главную</button>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:480, margin:"0 auto" }}>
      <header style={{ position:"sticky", top:0, zIndex:100, background:"rgba(3,11,5,.96)", backdropFilter:"blur(24px)", borderBottom:"1px solid var(--b1)" }}>
        <div style={{ padding:"14px 18px 13px", display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={() => go("cart")} className="btn" style={{ width:38, height:38, borderRadius:12, background:"var(--l3)", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div className="ub" style={{ flex:1, fontSize:16, fontWeight:900 }}>Оформление заказа</div>
        </div>
      </header>
      <div style={{ padding:"14px 18px 160px" }}>
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
          {savedAddrs.length > 0 && (
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, color:"var(--t2)", marginBottom:8, fontWeight:700 }}>Сохранённые адреса</div>
              <div className="hscroll" style={{ gap:8 }}>
                {savedAddrs.map(a => {
                  const line = formatClientAddressLine(a);
                  const active = addr === line;
                  return (
                    <button key={a.id} onClick={() => pickSavedAddr(a)} className="btn"
                      style={{ flexShrink:0, padding:"10px 14px", borderRadius:12, textAlign:"left",
                        border:`1.5px solid ${active ? "var(--gr)" : "var(--b1)"}`,
                        background: active ? "rgba(31,215,96,.1)" : "var(--l2)", minWidth:140 }}>
                      <div style={{ fontSize:12, fontWeight:800, color: active ? "var(--gr)" : "var(--t1)", marginBottom:2 }}>{a.label}</div>
                      <div style={{ fontSize:11, color:"var(--t2)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:160 }}>{line}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div style={{ fontSize:11, color:"var(--t2)", marginBottom:8, fontWeight:700 }}>Улица, дом *</div>
          <GeoAddressPicker
            value={addr}
            onChange={v => { setAddr(v); resetDelivery(); setErrs(prev => ({ ...prev, addr: undefined })); }}
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
          {errs.addr && <div style={{ fontSize:11, color:"var(--red)", marginTop:6 }}>{errs.addr}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
            <input className="inp" placeholder="Квартира" style={{ width: '100%', fontSize: 13, padding: '11px 12px' }} />
            <input className="inp" placeholder="Этаж" style={{ width: '100%', fontSize: 13, padding: '11px 12px' }} />
            <input className="inp" placeholder="Подъезд" style={{ width: '100%', fontSize: 13, padding: '11px 12px', gridColumn: '1 / -1' }} />
          </div>
        </div>
        <div className="card" style={{ padding:"18px", marginBottom:13 }}>
          <CheckoutSec icon="clock" color="var(--gd)" title="Время доставки"/>
          <CheckoutRadio items={CHECKOUT_TIMES} val={time} set={setTime}/>
        </div>
        <div className="card" style={{ padding:"18px", marginBottom:13 }}>
          <CheckoutSec icon="card" color="var(--blue)" title="Оплата"/>
          <CheckoutRadio items={CHECKOUT_PAYS} val={pay} set={setPay}/>
        </div>
        <div className="card" style={{ padding:"16px", marginBottom:13, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:20 }}>⭐</span>
            <div><div style={{ fontSize:13, fontWeight:700 }}>Использовать бонусы</div><div style={{ fontSize:11, color:"var(--t3)" }}>Баланс: 73 бонуса</div></div>
          </div>
          <div className={`toggle ${bonus?"on":""}`} onClick={() => setBonus(v => !v)}><div className="toggle-dot"/></div>
        </div>
      </div>
      <div style={{ position:"fixed", bottom:0, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:480, zIndex:90, background:"rgba(3,11,5,.97)", backdropFilter:"blur(26px)", borderTop:"1px solid var(--b1)", padding:"13px 18px 28px" }}>
        {addrReady && (
          <div style={{ marginBottom:10, padding:"10px 12px", borderRadius:12, background:"var(--l2)", border:"1px solid var(--b1)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:14, fontWeight:800 }}>
              <span>💵 К оплате</span>
              <span className="ub" style={{ color:"var(--gd)" }}>{total.toFixed(2)} ЅМ</span>
            </div>
          </div>
        )}
        {prodItems.length > 0 && restItems.length > 0 && (
          <div style={{ marginBottom:10, padding:"10px 12px", borderRadius:12, background:"rgba(59,142,240,.08)", border:"1px solid rgba(59,142,240,.2)", fontSize:12, color:"var(--t2)", textAlign:"center" }}>
            📦 Один заказ · сборщик соберёт товары, ресторан приготовит блюда
          </div>
        )}
        {submitErr && (
          <div style={{ marginBottom:10, padding:"10px 12px", borderRadius:12, background:"rgba(255,69,69,.1)", border:"1px solid rgba(255,69,69,.3)", fontSize:12, color:"#FF4545", textAlign:"center" }}>
            ⚠️ {submitErr}
          </div>
        )}
        <button onClick={submit} className="btn" style={{ width:"100%", padding:"15px", fontSize:15, borderRadius:17, background:"linear-gradient(135deg,var(--gr2),var(--gr))", color:"white", display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
          {loading ? <div style={{ width:18, height:18, borderRadius:"50%", border:"2.5px solid rgba(255,255,255,.3)", borderTopColor:"white", animation:"spin 1s linear infinite" }}/> : <><Ic n="check" s={19} c="white" w={2.5}/>{addrReady ? `Подтвердить · ${total.toFixed(2)} ЅМ` : "Подтвердить заказ"}</>}
        </button>
      </div>
    </div>
  );
};

const ProfilePage = ({ go, user, setUser, onLogout, wished }) => {
  const apiOrders = useOrders(s => s.orders);
  const [reviewStats, setReviewStats] = useState({ count: 0, withReplies: 0 });
  const [unreadNotifs, setUnreadNotifs] = useState(0);

  const orderCount = useMemo(() => countClientOrders(apiOrders, user?.phone), [apiOrders, user?.phone]);
  const spentTotal = useMemo(() => countClientSpent(apiOrders, user?.phone), [apiOrders, user?.phone]);
  const addrCount = useMemo(() => loadClientAddresses(user?.phone).length, [user?.phone]);
  const wishCount = useMemo(
    () => Object.keys(wished || {}).filter(id => wished[id]).length,
    [wished],
  );
  const loyalty = useMemo(
    () => getLoyaltyProgress(spentTotal, orderCount, reviewStats.count, user?.level, user?.vip),
    [spentTotal, orderCount, reviewStats.count, user?.level, user?.vip],
  );

  useEffect(() => {
    if (!user?.phone || !setUser) return
    findStoreClientByPhone(user.phone).then(c => {
      if (!c) return
      const next = storeUserFromClient(c)
      if (next.vip !== user.vip || next.bonus !== user.bonus || next.level !== user.level) {
        saveStoreUser(next)
        setUser(next)
      }
    }).catch(() => {})
  }, [user?.phone])

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

  if (!user) return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:480, margin:"0 auto", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"40px 24px", textAlign:"center" }}>
      <div style={{ fontSize:60, marginBottom:16, animation:"float 3s ease-in-out infinite" }}>👤</div>
      <div className="ub" style={{ fontSize:20, fontWeight:800, marginBottom:8 }}>Войдите в аккаунт</div>
      <div style={{ fontSize:13, color:"var(--t2)", marginBottom:24, lineHeight:1.6 }}>Войдите по номеру телефона — бонусы, заказы и персональные предложения</div>
      <button onClick={() => go("auth")} className="btn" style={{ padding:"14px 32px", borderRadius:16, background:"linear-gradient(135deg,var(--gr2),var(--gr))", color:"white", fontSize:14, fontWeight:800 }}>📱 Войти по номеру телефона</button>
      <Nav page="profile" go={go}/>
    </div>
  );

  const lc = loyalty.tier.color;
  const levelLabel = loyalty.tier.label;

  const menuItems = [
    {
      icon: "crown", l: loyalty.isVip ? "VIP профиль" : "VIP программа", c: "var(--gd)", to: "vip",
      s: loyalty.isVip ? "Привилегии и кредитный лимит" : `Выполнено ${loyalty.vipDoneCount} из 3 условий`,
      badge: loyalty.isVip ? "VIP" : undefined,
    },
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
    <div style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:480, margin:"0 auto" }}>
      <header style={{ position:"sticky", top:0, zIndex:100, background:"rgba(3,11,5,.96)", backdropFilter:"blur(24px)", borderBottom:"1px solid var(--b1)" }}>
        <div style={{ padding:"14px 18px 13px", display:"flex", alignItems:"center", gap:10 }}>
          <div className="ub" style={{ flex:1, fontSize:17, fontWeight:900 }}>Профиль</div>
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
        <div className="card" style={{ padding:"16px", marginBottom:14, background:"linear-gradient(145deg,var(--l2) 0%,var(--l1) 100%)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
            <div style={{ width:56, height:56, borderRadius:16, background:"linear-gradient(135deg,var(--gr3),var(--gr))", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Unbounded", fontSize:22, fontWeight:900, color:"var(--bg)", flexShrink:0, boxShadow:"0 4px 16px rgba(31,215,96,.3)" }}>
              {user.name.charAt(0)}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div className="ub" style={{ fontSize:15, fontWeight:900, marginBottom:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user.name}</div>
              <div style={{ fontSize:12, color:"var(--t2)", marginBottom:5 }}>{user.phone}</div>
              <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:20, background:`${lc}18`, color:lc, border:`1px solid ${lc}35` }}>{loyalty.tier.emoji} {levelLabel}</span>
            </div>
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <div style={{ flex:1, padding:"10px 12px", borderRadius:12, background:"rgba(255,184,0,.08)", border:"1px solid rgba(255,184,0,.2)", textAlign:"center" }}>
              <div className="ub" style={{ fontSize:18, fontWeight:900, color:"var(--gd)", lineHeight:1.1 }}>{(user.bonus || 0).toLocaleString()}</div>
              <div style={{ fontSize:10, color:"var(--t3)", marginTop:3 }}>бонусов</div>
            </div>
            <div style={{ flex:1, padding:"10px 12px", borderRadius:12, background:"rgba(31,215,96,.08)", border:"1px solid rgba(31,215,96,.2)", textAlign:"center" }}>
              <div className="ub" style={{ fontSize:18, fontWeight:900, color:"var(--gr)", lineHeight:1.1 }}>{orderCount}</div>
              <div style={{ fontSize:10, color:"var(--t3)", marginTop:3 }}>{orderCount === 1 ? "заказ" : orderCount >= 2 && orderCount <= 4 ? "заказа" : "заказов"}</div>
            </div>
            {wishCount > 0 && (
              <div style={{ flex:1, padding:"10px 12px", borderRadius:12, background:"rgba(255,69,69,.08)", border:"1px solid rgba(255,69,69,.2)", textAlign:"center" }}>
                <div className="ub" style={{ fontSize:18, fontWeight:900, color:"var(--red)", lineHeight:1.1 }}>{wishCount}</div>
                <div style={{ fontSize:10, color:"var(--t3)", marginTop:3 }}>в избранном</div>
              </div>
            )}
          </div>
        </div>

        <LoyaltyStatusCard loyalty={loyalty} onVip={() => go("vip")} adminVip={!!user.vip} />

        <div className="card" style={{ marginBottom:12 }}>
          {menuItems.map((item, i) => (
            <div
              key={item.to}
              onClick={() => go(item.to)}
              style={{ display:"flex", alignItems:"center", gap:12, padding:"13px 14px", borderBottom:i < menuItems.length - 1 ? "1px solid var(--b1)" : "none", cursor:"pointer" }}
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
                  <span style={{ fontSize:10, fontWeight:800, padding:"2px 7px", borderRadius:8, background:item.icon === "bell" ? "rgba(255,69,69,.12)" : item.icon === "crown" ? "rgba(255,184,0,.12)" : "rgba(59,142,240,.12)", color:item.icon === "bell" ? "var(--red)" : item.icon === "crown" ? "var(--gd)" : "var(--blue)", border:`1px solid ${item.icon === "bell" ? "rgba(255,69,69,.25)" : item.icon === "crown" ? "rgba(255,184,0,.3)" : "rgba(59,142,240,.25)"}` }}>
                    {item.icon === "bell" ? String(item.badge) : item.badge === "VIP" ? "VIP" : "ответ"}
                  </span>
                ) : null}
                <Ic n="arr" s={14} c="var(--t3)"/>
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <div onClick={() => onLogout?.()} style={{ display:"flex", alignItems:"center", gap:12, padding:"13px 14px", cursor:"pointer" }}>
            <div style={{ width:34, height:34, borderRadius:10, background:"rgba(255,69,69,.12)", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <Ic n="logout" s={16} c="var(--red)"/>
            </div>
            <div style={{ flex:1, fontSize:13, fontWeight:700, color:"var(--red)" }}>Выйти из аккаунта</div>
          </div>
        </div>

        <div style={{ textAlign:"center", marginTop:14, fontSize:10, color:"var(--t3)" }}>КАКАПО · г. Яван</div>
      </div>
      <Nav page="profile" go={go}/>
    </div>
  );
};
const OrdersPage = ({ go, user, onAdd, onClearCart, showToast }) => {
  const apiOrders = useOrders(s => s.orders);
  const { prods, restaurants } = useLiveCatalog();
  const ordersList = useMemo(() => {
    const mine = phoneDigits(user?.phone || getActiveClientPhone(user) || '');
    if (!mine) return [];
    const fromApi = mapOrdersForClient(apiOrders).filter(o => phoneDigits(o.phone || '') === mine);
    if (USE_API) return fromApi;
    const demoStatic = ORDERS_LIST.filter(o => phoneDigits(o.phone || '') === mine);
    const byId = new Map<string, typeof fromApi[0]>();
    [...fromApi, ...demoStatic].forEach(o => byId.set(o.id, o));
    return Array.from(byId.values());
  }, [apiOrders, user?.phone]);
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [reviewed, setReviewed] = useState<Record<string, Review>>({});
  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [showRev, setShowRev] = useState(null);
  const [step, setStep] = useState(1);
  useEffect(() => { if (step < 3) { const t = setTimeout(() => setStep(s => s+1), 8000); return () => clearTimeout(t); } }, [step]);
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
  const submitReview = async () => {
    if (!showRev || rating <= 0) return;
    const raw = apiOrders.find(o => o.id === showRev.id);
    const restId = showRev.restId || raw?.restId || raw?.items?.find(it => it.restId)?.restId;
    if (USE_API) {
      if (!restId) {
        showToast?.("Отзыв доступен только для заказов из ресторана");
        return;
      }
      try {
        const created = await api.createReview({
          orderId: showRev.id,
          restId,
          client: user?.name || raw?.client?.name || showRev.phone || "Клиент",
          rating,
          text: reviewText.trim() || `${"★".repeat(rating)}`,
        });
        setReviewed(r => ({ ...r, [showRev.id]: created }));
      } catch (e) {
        showToast?.(e?.message || "Не удалось отправить отзыв");
        return;
      }
    }
    if (!USE_API) {
      const created = { id: Date.now(), restId: restId || '', client: user?.name || 'Клиент', rating, text: reviewText, date: 'Сегодня', status: 'new' } as Review;
      saveLocalReview(showRev.id, created, user?.phone);
      setReviewed(r => ({ ...r, [showRev.id]: created }));
    }
    setShowRev(null);
    setRating(0);
    setReviewText("");
    showToast?.("⭐ Спасибо! Ресторан получил ваш отзыв");
  };
  const canReview = (o) => o.status === "delivered" && !reviewed[o.id] && (USE_API ? !!o.restId : true);
  const filtered = filter==="all" ? ordersList : ordersList.filter(o => o.status===filter);
  const ST = OSTATUS;

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
    <div style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:480, margin:"0 auto" }}>
      <header style={{ position:"sticky", top:0, zIndex:100, background:"rgba(3,11,5,.96)", backdropFilter:"blur(24px)", borderBottom:"1px solid var(--b1)" }}>
        <div style={{ padding:"14px 18px 13px", display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={() => setSelected(null)} className="btn" style={{ width:38, height:38, borderRadius:12, background:"var(--l3)", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div style={{ flex:1 }}><div className="ub" style={{ fontSize:15, fontWeight:900 }}>Заказ {selected.id}</div><div style={{ fontSize:10, color:"var(--t2)", marginTop:1 }}>{selected.date} · {selected.time}</div></div>
          <span className="bdg" style={{ background:`${ST[selected.status].c}18`, color:ST[selected.status].c, border:`1px solid ${ST[selected.status].c}30` }}>{ST[selected.status].l}</span>
        </div>
      </header>
      <div style={{ padding:"16px 18px 100px" }}>
        {selected.status==="assembling" && (
          <div style={{ padding:"16px", borderRadius:16, background:"rgba(155,109,255,.08)", border:"1px solid rgba(155,109,255,.25)", marginBottom:16 }}>
            <div style={{ fontSize:13, fontWeight:700, color:"var(--pur)", marginBottom:6 }}>📦 Заказ собирается</div>
            <div style={{ fontSize:12, color:"var(--t2)" }}>Сборщик комплектует ваш заказ. Курьер получит его после сборки.</div>
          </div>
        )}
        {selected.status==="cooking" && (
          <div style={{ padding:"16px", borderRadius:16, background:"rgba(255,184,0,.08)", border:"1px solid rgba(255,184,0,.25)", marginBottom:16 }}>
            <div style={{ fontSize:13, fontWeight:700, color:"var(--gd)", marginBottom:6 }}>👨‍🍳 Ресторан готовит заказ</div>
            <div style={{ fontSize:12, color:"var(--t2)" }}>Когда блюда будут готовы — курьер заберёт заказ из ресторана.</div>
          </div>
        )}
        {selected.status==="waiting_courier" && (
          <div style={{ padding:"16px", borderRadius:16, background:"rgba(255,184,0,.08)", border:"1px solid rgba(255,184,0,.25)", marginBottom:16 }}>
            <div style={{ fontSize:13, fontWeight:700, color:"var(--gd)", marginBottom:6 }}>{selected.orderType === 'restaurant' ? '✅ Заказ готов' : '✅ Заказ собран'}</div>
            <div style={{ fontSize:12, color:"var(--t2)" }}>{selected.orderType === 'restaurant' ? 'Ресторан передал заказ. Ждём курьера — когда он примет заказ, здесь появится карта.' : 'Ждём курьера. Когда он примет заказ — здесь появится карта отслеживания.'}</div>
          </div>
        )}
        {selected.status==="delivering" && (
          <div style={{ padding:"16px", borderRadius:16, background:"rgba(59,142,240,.06)", border:"1px solid rgba(59,142,240,.2)", marginBottom:16 }}>
            <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:14 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:"var(--blue)", position:"relative" }}><div style={{ position:"absolute", inset:0, borderRadius:"50%", background:"var(--blue)", animation:"ping 1.5s ease-out infinite", opacity:.5 }}/></div>
              <span style={{ fontSize:13, fontWeight:700, color:"var(--blue)" }}>Курьер едет · {selected.eta}</span>
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
            <div style={{ height:80, borderRadius:12, background:"linear-gradient(135deg,#050F08,#091814)", border:"1px solid rgba(59,142,240,.2)", display:"flex", alignItems:"center", justifyContent:"center", position:"relative", overflow:"hidden" }}>
              <div style={{ position:"absolute", inset:0, opacity:.05, background:"repeating-linear-gradient(0deg,transparent,transparent 16px,rgba(59,142,240,1) 16px,rgba(59,142,240,1) 17px),repeating-linear-gradient(90deg,transparent,transparent 16px,rgba(59,142,240,1) 16px,rgba(59,142,240,1) 17px)" }}/>
              <div style={{ position:"absolute", right:"15%", top:"30%", fontSize:18 }}>🏠</div>
              <div style={{ position:"absolute", left:"25%", top:"35%", fontSize:16 }}>🛵</div>
              <div style={{ position:"absolute", bottom:7, left:10, fontSize:9, color:"rgba(255,255,255,.4)" }}>г. Яван · Live tracking</div>
            </div>
          </div>
        )}
        {selected.status==="delivered" && (
          <div style={{ padding:"14px 16px", borderRadius:16, background:"rgba(31,215,96,.07)", border:"1px solid rgba(31,215,96,.25)", display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
            <div style={{ width:38, height:38, borderRadius:11, background:"rgba(31,215,96,.2)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Ic n="check" s={20} c="var(--gr)" w={2.5}/></div>
            <div><div style={{ fontSize:13, fontWeight:700, color:"var(--gr)" }}>Заказ доставлен!</div><div style={{ fontSize:11, color:"var(--t2)", marginTop:1 }}>Начислено <span style={{ color:"var(--gd)", fontWeight:700 }}>+{selected.bonus} бонусов</span></div></div>
          </div>
        )}
        <div className="card" style={{ marginBottom:14, overflow:"hidden" }}>
          <div style={{ padding:"13px 15px", borderBottom:"1px solid var(--b1)", fontSize:13, fontWeight:800 }}>Состав заказа</div>
          {selected.items.map((item,i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 15px", borderBottom:i<selected.items.length-1?"1px solid var(--b1)":"none" }}>
              <div style={{ width:42, height:42, borderRadius:11, background:"var(--l3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>{item.e}</div>
              <div style={{ flex:1 }}><div style={{ fontSize:13, fontWeight:600 }}>{item.name}</div><div style={{ fontSize:11, color:"var(--t3)", marginTop:1 }}>× {item.qty}</div></div>
              <span className="ub" style={{ fontSize:13, fontWeight:800 }}>{(item.price*item.qty).toFixed(2)} <span style={{ fontSize:10, color:"var(--gd)" }}>ЅМ</span></span>
            </div>
          ))}
        </div>
        <div className="card" style={{ padding:"15px", marginBottom:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 0" }}>
            <span style={{ fontSize:12, color:"var(--t2)" }}>Адрес</span>
            <span style={{ fontSize:12, fontWeight:700, color:"var(--t2)", textAlign:"right", maxWidth:"60%" }}>{selected.addr}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginTop:10, borderTop:"1px solid var(--b1)", paddingTop:10 }}>
            <span style={{ fontSize:14, fontWeight:700 }}>Итого</span>
            <span className="ub" style={{ fontSize:20, fontWeight:900 }}>{selected.total.toFixed(2)} <span style={{ fontSize:12, color:"var(--gd)" }}>ЅМ</span></span>
          </div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <button type="button" onClick={() => repeatOrder(selected)} className="btn" style={{ padding:"13px", fontSize:13, borderRadius:15, background:"linear-gradient(135deg,var(--gr2),var(--gr))", color:"white", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
            <Ic n="repeat" s={16} c="white"/>Повторить заказ
          </button>
          {canReview(selected) && (
            <button onClick={() => { setShowRev(selected); setRating(0); setReviewText(""); }} className="btn" style={{ padding:"13px", fontSize:13, borderRadius:15, background:"rgba(255,184,0,.1)", border:"1.5px solid rgba(255,184,0,.3)", color:"var(--gd)", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
              <Ic n="star" s={16} c="var(--gd)"/>Оставить отзыв
            </button>
          )}
          {reviewed[selected.id] && <ClientReviewBlock review={reviewed[selected.id]} orderId={selected.id} />}
        </div>
      </div>
      {showRev && (
        <div style={{ position:"fixed", inset:0, zIndex:300, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div onClick={() => setShowRev(null)} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,.8)", backdropFilter:"blur(8px)" }}/>
          <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:480, background:"var(--l1)", borderTop:"1px solid var(--b1)", borderRadius:"24px 24px 0 0", padding:"20px 20px 36px", animation:"slideUp .4s cubic-bezier(.16,1,.3,1)" }}>
            <div style={{ width:40, height:4, borderRadius:2, background:"var(--b2)", margin:"0 auto 16px" }}/>
            <div style={{ fontSize:16, fontWeight:800, textAlign:"center", marginBottom:16 }}>Оцените заказ {showRev.id}</div>
            <div style={{ display:"flex", justifyContent:"center", gap:8, marginBottom:10 }}>
              {[1,2,3,4,5].map(i => <svg key={i} width={36} height={36} viewBox="0 0 24 24" style={{ cursor:"pointer" }} onClick={() => setRating(i)}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill={i<=rating?"#FFB800":"rgba(255,184,0,.12)"} stroke="#FFB800" strokeWidth={1}/></svg>)}
            </div>
            <div style={{ textAlign:"center", fontSize:14, color:"var(--gd)", fontWeight:700, marginBottom:12, minHeight:22 }}>
              {["","😤 Плохо","😕 Так себе","😐 Нормально","😊 Хорошо","🤩 Отлично!"][rating]}
            </div>
            <textarea className="inp" value={reviewText} onChange={e => setReviewText(e.target.value)} placeholder="Комментарий (необязательно)…" rows={3} style={{ width:"100%", marginBottom:14, resize:"vertical" }}/>
            <button onClick={submitReview} className="btn" style={{ width:"100%", padding:"14px", fontSize:14, borderRadius:15, background:"linear-gradient(135deg,var(--gr2),var(--gr))", color:"white", display:"flex", alignItems:"center", justifyContent:"center", gap:8, opacity:rating>0?1:.5 }}>
              <Ic n="star" s={16} c="white"/>Отправить отзыв
            </button>
          </div>
        </div>
      )}
      <Nav page="orders" go={go}/>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:480, margin:"0 auto" }}>
      <header style={{ position:"sticky", top:0, zIndex:100, background:"rgba(3,11,5,.96)", backdropFilter:"blur(24px)", borderBottom:"1px solid var(--b1)" }}>
        <div style={{ padding:"14px 18px 10px", display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={() => go("home")} className="btn" style={{ width:38, height:38, borderRadius:12, background:"var(--l3)", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div style={{ flex:1 }}><div className="ub" style={{ fontSize:17, fontWeight:900 }}>Мои заказы</div><div style={{ fontSize:10, color:"var(--t2)", marginTop:1 }}>{ordersList.length} заказов</div></div>
        </div>
        <div className="hscroll" style={{ padding:"0 16px 10px", gap:5 }}>
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
        <div onClick={() => setSelected(ordersList.find(o => o.status==="delivering"))} style={{ margin:"14px 18px 0", padding:"12px 16px", borderRadius:16, background:"rgba(59,142,240,.08)", border:"1px solid rgba(59,142,240,.3)", display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}>
          <div style={{ width:8, height:8, borderRadius:"50%", background:"var(--blue)", position:"relative", flexShrink:0 }}><div style={{ position:"absolute", inset:0, borderRadius:"50%", background:"var(--blue)", animation:"ping 1.5s ease-out infinite", opacity:.5 }}/></div>
          <div style={{ flex:1 }}><div style={{ fontSize:13, fontWeight:700, color:"var(--blue)" }}>Курьер в пути!</div><div style={{ fontSize:11, color:"var(--t2)", marginTop:1 }}>Нажмите чтобы отследить</div></div>
          <Ic n="arr" s={15} c="var(--blue)"/>
        </div>
      )}
      <div style={{ padding:"14px 18px 100px", display:"flex", flexDirection:"column", gap:12 }}>
        {filtered.map((o,i) => {
          const st = ST[o.status];
          return (
            <div key={o.id} className="card" onClick={() => setSelected(o)} style={{ cursor:"pointer", animation:`fadeUp .45s cubic-bezier(.16,1,.3,1) ${i*.06}s both` }}>
              {o.status==="delivering" && (
                <div style={{ padding:"9px 14px", background:"rgba(59,142,240,.08)", borderBottom:"1px solid rgba(59,142,240,.2)", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <div style={{ width:7, height:7, borderRadius:"50%", background:"var(--blue)", position:"relative" }}><div style={{ position:"absolute", inset:0, borderRadius:"50%", background:"var(--blue)", animation:"ping 1.5s ease-out infinite", opacity:.5 }}/></div>
                    <span style={{ fontSize:12, fontWeight:700, color:"var(--blue)" }}>Курьер едет · {o.eta}</span>
                  </div>
                  <span style={{ fontSize:10, color:"var(--t3)" }}>Live</span>
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
                    <div className="ub" style={{ fontSize:15, fontWeight:900 }}>{o.total.toFixed(2)} <span style={{ fontSize:10, color:"var(--gd)" }}>ЅМ</span></div>
                    <div style={{ fontSize:10, color:"var(--t3)", marginTop:1 }}>{o.items.reduce((s,it)=>s+it.qty,0)} товаров</div>
                  </div>
                </div>
                <div style={{ display:"flex", gap:5, marginBottom:10 }}>
                  {o.items.slice(0,3).map((it,j) => <div key={j} style={{ width:36, height:36, borderRadius:10, background:"var(--l3)", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>{it.e}</div>)}
                  <div style={{ flex:1, display:"flex", justifyContent:"flex-end", alignItems:"center" }}><Ic n="arr" s={14} c="var(--t3)"/></div>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  {o.status==="delivering" && o.trackable && <button className="btn" onClick={e=>{e.stopPropagation();setSelected(o);}} style={{ flex:1, padding:"9px", fontSize:12, borderRadius:11, background:"linear-gradient(135deg,var(--gr2),var(--gr))", color:"white", display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}><Ic n="map" s={13} c="white"/>Отследить</button>}
                  {canReview(o) && <button className="btn" onClick={e=>{e.stopPropagation();setShowRev(o);setRating(0);setReviewText("");}} style={{ flex:1, padding:"9px", fontSize:12, borderRadius:11, background:"rgba(255,184,0,.1)", border:"1.5px solid rgba(255,184,0,.3)", color:"var(--gd)", display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}><Ic n="star" s={13} c="var(--gd)"/>Отзыв</button>}
                  <button type="button" className="btn" onClick={e=>{e.stopPropagation();repeatOrder(o);}} style={{ flex:1, padding:"9px", fontSize:12, borderRadius:11, background:"var(--l3)", border:"1px solid var(--b1)", color:"var(--t2)", display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}><Ic n="repeat" s={13} c="var(--t2)"/>Повторить</button>
                </div>
                {o.cancelReason && <div style={{ marginTop:9, padding:"7px 10px", borderRadius:9, background:"rgba(255,69,69,.07)", border:"1px solid rgba(255,69,69,.2)", fontSize:11, color:"var(--red)" }}>ℹ️ {o.cancelReason}</div>}
              </div>
            </div>
          );
        })}
      </div>
      {showRev && (
        <div style={{ position:"fixed", inset:0, zIndex:300, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div onClick={() => setShowRev(null)} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,.8)", backdropFilter:"blur(8px)" }}/>
          <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:480, background:"var(--l1)", borderTop:"1px solid var(--b1)", borderRadius:"24px 24px 0 0", padding:"20px 20px 36px", animation:"slideUp .4s cubic-bezier(.16,1,.3,1)" }}>
            <div style={{ width:40, height:4, borderRadius:2, background:"var(--b2)", margin:"0 auto 16px" }}/>
            <div style={{ fontSize:16, fontWeight:800, textAlign:"center", marginBottom:16 }}>Оцените заказ</div>
            <div style={{ display:"flex", justifyContent:"center", gap:8, marginBottom:10 }}>
              {[1,2,3,4,5].map(i => <svg key={i} width={36} height={36} viewBox="0 0 24 24" style={{ cursor:"pointer" }} onClick={() => setRating(i)}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill={i<=rating?"#FFB800":"rgba(255,184,0,.12)"} stroke="#FFB800" strokeWidth={1}/></svg>)}
            </div>
            <div style={{ textAlign:"center", fontSize:14, color:"var(--gd)", fontWeight:700, marginBottom:12 }}>{["","😤","😕","😐","😊","🤩 Отлично!"][rating]}</div>
            <textarea className="inp" value={reviewText} onChange={e => setReviewText(e.target.value)} placeholder="Комментарий…" rows={3} style={{ width:"100%", marginBottom:14, resize:"vertical" }}/>
            <button onClick={submitReview} className="btn" style={{ width:"100%", padding:"14px", fontSize:14, borderRadius:15, background:"linear-gradient(135deg,var(--gr2),var(--gr))", color:"white", display:"flex", alignItems:"center", justifyContent:"center", gap:8, opacity:rating>0?1:.5 }}>
              <Ic n="star" s={16} c="white"/>Отправить
            </button>
          </div>
        </div>
      )}
      <Nav page="orders" go={go}/>
    </div>
  );
};

const ClientReviewsPage = ({ go, user }) => {
  const apiOrders = useOrders(s => s.orders);
  const { restaurants } = useLiveCatalog();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);

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
      setReviews(Object.values(map).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));
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

  if (!user) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg)", maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>⭐</div>
        <div className="ub" style={{ fontSize: 16, fontWeight: 800, marginBottom: 16 }}>Войдите, чтобы видеть отзывы</div>
        <button onClick={() => go("auth")} className="btn" style={{ padding: "12px 24px", borderRadius: 14, background: "linear-gradient(135deg,var(--gr2),var(--gr))", color: "white" }}>Войти</button>
        <Nav page="profile" go={go}/>
      </div>
    );
  }

  const withReplies = reviews.filter(r => r.adminReply || r.restReply).length;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", maxWidth: 480, margin: "0 auto" }}>
      <header style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(3,11,5,.96)", backdropFilter: "blur(24px)", borderBottom: "1px solid var(--b1)" }}>
        <div style={{ padding: "14px 18px 13px", display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => go("profile")} className="btn" style={{ width: 38, height: 38, borderRadius: 12, background: "var(--l3)", border: "1px solid var(--b1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Ic n="arrL" s={17} c="var(--t2)"/>
          </button>
          <div style={{ flex: 1 }}>
            <div className="ub" style={{ fontSize: 17, fontWeight: 900 }}>Мои отзывы</div>
            <div style={{ fontSize: 10, color: "var(--t2)", marginTop: 1 }}>
              {loading ? "Загрузка…" : withReplies ? `${withReplies} с ответами` : `${reviews.length} отзывов`}
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
              После доставки заказа из ресторана вы сможете оценить блюда и получить ответ от ресторана
            </div>
            <button onClick={() => go("orders")} className="btn" style={{ padding: "12px 24px", borderRadius: 14, background: "linear-gradient(135deg,var(--gr2),var(--gr))", color: "white", fontSize: 13 }}>
              Перейти к заказам
            </button>
          </div>
        )}
        {!loading && reviews.map((rev, i) => {
          const rest = restaurants.find(r => r.id === rev.restId);
          return (
            <div key={rev.id} className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 12, animation: `fadeUp .4s ease ${i * .06}s both` }}>
              <div style={{ padding: "12px 15px", borderBottom: "1px solid var(--b1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{rest?.name || rev.restName || "Ресторан"}</div>
                  {rev.orderId && <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 2 }}>Заказ {rev.orderId}</div>}
                </div>
                {(rev.adminReply || rev.restReply) && (
                  <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 8, background: "rgba(59,142,240,.12)", color: "var(--blue)", border: "1px solid rgba(59,142,240,.25)" }}>Есть ответ</span>
                )}
              </div>
              <div style={{ padding: "14px 15px" }}>
                <ClientReviewBlock review={rev} embedded />
                {rev.orderId && (
                  <button onClick={() => go("orders")} className="btn" style={{ width: "100%", marginTop: 4, padding: 10, fontSize: 12, borderRadius: 12, background: "var(--l3)", border: "1px solid var(--b1)", color: "var(--t2)" }}>
                    Открыть заказ {rev.orderId}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <Nav page="profile" go={go}/>
    </div>
  );
};

const PromosPage = ({ go, cart, onAdd, onRm }) => {
  const { prods } = useLiveCatalog();
  const [tab, setTab] = useState("all");
  const [bi, setBi] = useState(0);
  const [copied, setCopied] = useState(null);
  const [timer, setTimer] = useState({ h:3, m:24, s:18 });
  useEffect(() => { const t = setInterval(() => setBi(b => (b+1)%BANNERS.length), 4500); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setInterval(() => setTimer(t => { if(t.s>0) return {...t,s:t.s-1}; if(t.m>0) return {...t,m:t.m-1,s:59}; if(t.h>0) return {h:t.h-1,m:59,s:59}; return t; }), 1000); return () => clearInterval(t); }, []);
  const pad = n => String(n).padStart(2,"0");
  const b = BANNERS[bi];
  const copy = code => { setCopied(code); setTimeout(() => setCopied(null), 2000); };
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const FLASH = prods
    .filter(p => num(p.old) > num(p.price))
    .map(p => ({ ...p, price: num(p.price), old: num(p.old), now: num(p.price), was: num(p.old), stock: ((Number(p.id) * 37) % 56) + 5 }))
    .slice(0, 5);
  const totalQty = formatCartBadgeCount(sumCartUnits(cart, prods));
  const totalQtyNum = sumCartUnits(cart, prods);
  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:480, margin:"0 auto" }}>
      <header style={{ position:"sticky", top:0, zIndex:100, background:"rgba(3,11,5,.96)", backdropFilter:"blur(24px)", borderBottom:"1px solid var(--b1)" }}>
        <div style={{ padding:"13px 18px 12px", display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:40, height:40, borderRadius:12, background:"linear-gradient(135deg,var(--gr3),var(--gr))", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Unbounded", fontSize:17, fontWeight:900, color:"var(--bg)", animation:"glow 3s ease-in-out infinite", boxShadow:"0 4px 16px rgba(31,215,96,.4)", flexShrink:0 }}>K</div>
          <div className="ub" style={{ flex:1, fontSize:16, fontWeight:900 }}>Акции</div>
          <button onClick={() => go("search")} className="btn" style={{ width:38, height:38, borderRadius:12, background:"var(--l3)", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <Ic n="search" s={17} c="var(--t2)"/>
          </button>
          <button onClick={() => go("cart")} className="btn" style={{ width:38, height:38, borderRadius:12, background:totalQtyNum>0?"linear-gradient(135deg,var(--gr2),var(--gr))":"var(--l3)", border:`1px solid ${totalQtyNum>0?"transparent":"var(--b1)"}`, display:"flex", alignItems:"center", justifyContent:"center", position:"relative", boxShadow:totalQtyNum>0?"0 4px 14px rgba(31,215,96,.4)":"none" }}>
            <Ic n="cart" s={17} c={totalQtyNum>0?"white":"var(--t2)"}/>
            {totalQtyNum>0 && <div style={{ position:"absolute", top:-6, right:-6, minWidth:17, height:17, padding:"0 4px", borderRadius:999, background:"var(--red)", border:"2px solid var(--bg)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Unbounded", fontSize:9, fontWeight:900, color:"white" }}>{totalQty}</div>}
          </button>
        </div>
        <div className="hscroll" style={{ padding:"0 18px 10px", gap:6 }}>
          {[{id:"all",l:"Все"},{id:"flash",l:"⚡ Флэш"},{id:"cats",l:"По категориям"},{id:"codes",l:"🏷 Промокоды"}].map(t => (
            <button key={t.id} className={`chip ${tab===t.id?"on":""}`} onClick={() => setTab(t.id)}>{t.l}</button>
          ))}
        </div>
        <div style={{ background:"rgba(255,69,69,.08)", borderTop:"1px solid rgba(255,69,69,.12)", padding:"5px 0", overflow:"hidden" }}>
          <div style={{ display:"flex", animation:"ticker 20s linear infinite", width:"200%" }}>
            {[...Array(2)].map((_,si) => <div key={si} style={{ display:"flex", flexShrink:0, width:"100%" }}>{["🔥 Молочная среда −30%","⚡ Флэш до 20:00","🥩 Мясные выходные −25%","🎁 Бесплатная доставка от 30 ЅМ"].map((t,i) => <span key={i} style={{ fontSize:11, fontWeight:700, color:"var(--red)", whiteSpace:"nowrap", padding:"0 24px" }}>{t}</span>)}</div>)}
          </div>
        </div>
      </header>
      <div style={{ padding:"14px 18px 100px" }}>
        {(tab==="all") && (
          <div style={{ borderRadius:22, overflow:"hidden", marginBottom:20, cursor:"pointer" }} onClick={() => setBi(c => (c+1)%BANNERS.length)}>
            <div style={{ background:b.bg, padding:"22px 20px 18px", position:"relative", overflow:"hidden" }}>
              <div style={{ position:"absolute", left:0, right:0, height:1, background:`linear-gradient(90deg,transparent,${b.ac}55,transparent)`, animation:"scanLine 3s linear infinite" }}/>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <span className="bdg" style={{ background:`${b.ac}20`, color:b.ac, border:`1px solid ${b.ac}40`, marginBottom:10, display:"inline-flex" }}>✦ {b.badge}</span>
                  <div className="ub" style={{ fontSize:22, fontWeight:900, color:"#fff", lineHeight:1.2, marginBottom:6 }}>{b.title}</div>
                  <div style={{ fontSize:12, color:"rgba(255,255,255,.6)", marginBottom:12 }}>{b.sub}</div>
                  {b.disc && <div style={{ padding:"7px 16px", borderRadius:11, background:b.ac, color:"white", fontFamily:"Unbounded", fontSize:20, fontWeight:900, display:"inline-block" }}>−{b.disc}%</div>}
                </div>
                <div style={{ fontSize:52, animation:"float 2.5s ease-in-out infinite", flexShrink:0 }}>{b.e}</div>
              </div>
              <div style={{ display:"flex", gap:5, marginTop:12 }}>
                {BANNERS.map((_,i) => <div key={i} onClick={e=>{e.stopPropagation();setBi(i);}} style={{ width:i===bi?20:6, height:6, borderRadius:3, background:i===bi?b.ac:"rgba(255,255,255,.2)", transition:"all .3s", cursor:"pointer" }}/>)}
              </div>
            </div>
          </div>
        )}
        {(tab==="all"||tab==="flash") && (
          <div style={{ marginBottom:22 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
              <div>
                <div className="ub" style={{ fontSize:15, fontWeight:800, marginBottom:6 }}>⚡ Флэш-распродажа</div>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <Ic n="clock" s={13} c="var(--red)"/>
                  <div style={{ display:"flex", gap:3 }}>
                    {[pad(timer.h),pad(timer.m),pad(timer.s)].map((v,i) => (
                      <span key={i} style={{ display:"flex", alignItems:"center", gap:3 }}>
                        <span style={{ background:"rgba(255,69,69,.15)", border:"1px solid rgba(255,69,69,.3)", borderRadius:6, padding:"2px 6px", fontFamily:"Unbounded", fontSize:12, fontWeight:900, color:"var(--red)" }}>{v}</span>
                        {i<2 && <span style={{ color:"var(--red)", fontWeight:900 }}>:</span>}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="hscroll">
              {FLASH.map(p => {
                const qty=cart[p.id]||0, disc=p.old > 0 ? Math.round((1-p.price/p.old)*100) : 0;
                return (
                  <div key={p.id} style={{ width:148, flexShrink:0, background:"var(--l2)", border:"1.5px solid rgba(255,69,69,.25)", borderRadius:16, overflow:"hidden", display:"flex", flexDirection:"column" }}>
                    <div style={{ height:96, background:"linear-gradient(145deg,#180808,#2A1010)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:48, position:"relative" }}>
                      {p.e}
                      <div style={{ position:"absolute", top:8, left:8, padding:"3px 8px", borderRadius:8, background:"var(--red)", fontFamily:"Unbounded", fontSize:10, fontWeight:900, color:"white" }}>-{disc}%</div>
                    </div>
                    <div style={{ padding:"10px 11px 8px", flex:1 }}>
                      <div style={{ fontSize:11, fontWeight:700, marginBottom:4 }}>{p.name}</div>
                      <div style={{ display:"flex", alignItems:"baseline", gap:5 }}>
                        <span className="ub" style={{ fontSize:14, fontWeight:900, color:"var(--red)" }}>{p.price.toFixed(2)}<span style={{ fontSize:9, color:"var(--gd)", marginLeft:2 }}>ЅМ</span></span>
                        <span style={{ fontSize:10, color:"var(--t3)", textDecoration:"line-through" }}>{p.old.toFixed(2)}</span>
                      </div>
                      <div style={{ height:4, background:"var(--b1)", borderRadius:2, marginTop:6 }}><div style={{ height:"100%", width:`${((p.id * 53) % 51) + 10}%`, background:"var(--gr)", borderRadius:2 }}/></div>
                    </div>
                    <div style={{ padding:"0 10px 10px" }}>
                      {qty===0 ? <button onClick={() => onAdd(p.id)} className="btn" style={{ width:"100%", padding:"8px", fontSize:11, borderRadius:10, background:"linear-gradient(135deg,#CC2A2A,var(--red))", color:"white", display:"flex", alignItems:"center", justifyContent:"center", gap:4 }}><Ic n="plus" s={11} c="white" w={2.5}/>В корзину</button> :
                        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:"rgba(255,69,69,.1)", border:"1px solid rgba(255,69,69,.28)", borderRadius:10, padding:"4px 7px" }}>
                          <button onClick={() => onRm(p.id)} className="btn" style={{ width:26, height:26, borderRadius:7, background:"rgba(255,69,69,.18)", color:"var(--red)", fontSize:15, fontWeight:700 }}>−</button>
                          <span className="ub" style={{ fontSize:12, fontWeight:900, color:"var(--red)" }}>{formatCartQtyStepper(p, qty)}</span>
                          <button onClick={() => onAdd(p.id)} className="btn" style={{ width:26, height:26, borderRadius:7, background:"rgba(255,69,69,.18)", color:"var(--red)", fontSize:15, fontWeight:700 }}>+</button>
                        </div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {(tab==="all"||tab==="cats") && (
          <div style={{ marginBottom:22 }}>
            <div className="ub" style={{ fontSize:15, fontWeight:800, marginBottom:14 }}>По категориям</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              {CATS.filter(c=>!c.parentId).slice(0,6).map((c,i) => (
                <div key={c.id} onClick={() => go("plist",{cat:c.id})} className="card" style={{ background:c.bg, border:`1px solid ${c.color}22`, cursor:"pointer" }}>
                  <div style={{ padding:"14px 12px" }}>
                    <div style={{ fontSize:28, marginBottom:8 }}>{c.e}</div>
                    <div className="ub" style={{ fontSize:12, fontWeight:800, color:"#fff", marginBottom:3 }}>{c.label.split(" ")[0]}</div>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:8 }}>
                      <div style={{ padding:"4px 10px", borderRadius:8, background:`${c.color}22`, border:`1px solid ${c.color}44` }}><span className="ub" style={{ fontSize:12, fontWeight:900, color:c.color }}>−{10+i*3}%</span></div>
                      <Ic n="arr" s={13} c={c.color}/>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {(tab==="all"||tab==="codes") && (
          <div>
            <div className="ub" style={{ fontSize:15, fontWeight:800, marginBottom:14 }}>🏷 Промокоды</div>
            <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:14 }}>
              {[{code:"КАКАПО10",desc:"Скидка 10% на первый заказ",e:"🎉",expires:"31 мая"},{code:"YAVAN5",desc:"5 ЅМ для жителей Явана",e:"📍",expires:"30 мая"},{code:"SUMMER25",desc:"Летняя акция — скидка 25%",e:"☀️",expires:"1 июня"}].map(pc => (
                <div key={pc.code} style={{ background:"var(--l2)", border:"1.5px solid rgba(31,215,96,.2)", borderRadius:15, padding:"14px 16px", display:"flex", alignItems:"center", gap:12 }}>
                  <div style={{ width:42, height:42, borderRadius:12, background:"rgba(31,215,96,.12)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{pc.e}</div>
                  <div style={{ flex:1 }}>
                    <div className="ub" style={{ fontSize:14, fontWeight:900, color:"var(--gr)", marginBottom:3 }}>{pc.code}</div>
                    <div style={{ fontSize:11, color:"var(--t2)", marginBottom:2 }}>{pc.desc}</div>
                    <div style={{ fontSize:10, color:"var(--t3)" }}>До {pc.expires}</div>
                  </div>
                  <button onClick={() => copy(pc.code)} className="btn" style={{ width:36, height:36, borderRadius:10, background:copied===pc.code?"rgba(31,215,96,.14)":"var(--l3)", border:`1px solid ${copied===pc.code?"rgba(31,215,96,.4)":"var(--b1)"}`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                    {copied===pc.code ? <Ic n="check" s={15} c="var(--gr)" w={2.5}/> : <Ic n="copy" s={15} c="var(--t2)"/>}
                  </button>
                </div>
              ))}
            </div>
            <div style={{ background:"var(--l2)", border:"1px solid var(--b1)", borderRadius:15, padding:"16px" }}>
              <div style={{ fontSize:13, fontWeight:700, marginBottom:10 }}>Есть промокод?</div>
              <div style={{ display:"flex", gap:8 }}>
                <input className="inp" placeholder="Введите промокод..." style={{ flex:1 }}/>
                <button className="btn" style={{ padding:"12px 16px", borderRadius:12, background:"linear-gradient(135deg,var(--gr2),var(--gr))", color:"white", fontSize:13, flexShrink:0 }}>Применить</button>
              </div>
            </div>
          </div>
        )}
      </div>
      {totalQtyNum > 0 && (
        <FloatingCartBtn count={totalQty} onClick={() => go("cart")} />
      )}
      <Nav page="promos" go={go}/>
    </div>
  );
};
const SearchPage = ({ go, cart, onAdd, onRm }) => {
  const { prods } = useLiveCatalog();
  const [query, setQuery] = useState("");
  const iRef = useRef();
  useEffect(() => {
    const t = setTimeout(() => iRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);
  const results = query.trim() ? prods.filter(p => p.name.toLowerCase().includes(query.toLowerCase())) : [];
  const totalQty = formatCartBadgeCount(sumCartUnits(cart, prods));
  const totalQtyNum = sumCartUnits(cart, prods);
  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:480, margin:"0 auto" }}>
      <header style={{ position:"sticky", top:0, zIndex:100, background:"rgba(3,11,5,.96)", backdropFilter:"blur(24px)", borderBottom:"1px solid var(--b1)" }}>
        <div style={{ padding:"13px 18px 12px", display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={() => go("home")} className="btn" style={{ width:38, height:38, borderRadius:12, background:"var(--l3)", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div style={{ flex:1, position:"relative" }}>
            <div style={{ position:"absolute", left:11, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}><Ic n="search" s={15} c="var(--t3)"/></div>
            <input ref={iRef} className="inp" value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск в КАКАПО..." style={{ paddingLeft:36, paddingRight:query?32:14, width:"100%", fontSize:14 }}/>
            {query && <button onClick={() => setQuery("")} className="btn" style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", width:20, height:20, borderRadius:5, background:"rgba(255,255,255,.1)", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="x" s={11} c="var(--t2)"/></button>}
          </div>
          {totalQtyNum>0 && <button onClick={() => go("cart")} className="btn" style={{ width:38, height:38, borderRadius:12, background:"linear-gradient(135deg,var(--gr2),var(--gr))", display:"flex", alignItems:"center", justifyContent:"center", position:"relative", flexShrink:0 }}>
            <Ic n="cart" s={17} c="white"/>
            <div style={{ position:"absolute", top:-6, right:-6, minWidth:17, height:17, padding:"0 4px", borderRadius:999, background:"var(--red)", border:"2px solid var(--bg)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Unbounded", fontSize:9, fontWeight:900, color:"white" }}>{totalQty}</div>
          </button>}
        </div>
      </header>
      <div style={{ padding:"16px 18px 100px" }}>
        {!query && (
          <div>
            <div className="ub" style={{ fontSize:13, fontWeight:700, color:"var(--t2)", marginBottom:12 }}>Популярные</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:24 }}>
              {["Молоко","Хлеб","Мясо","Брокколи","Кофе","Яйца","Сыр","Лосось"].map(s => (
                <button key={s} onClick={() => setQuery(s)} className="btn chip">🔍 {s}</button>
              ))}
            </div>
            <div className="ub" style={{ fontSize:13, fontWeight:700, color:"var(--t2)", marginBottom:12 }}>Недавние поиски</div>
            {["Говядина вырезка","Молоко 3.2%","Круассан масляный"].map((r,i) => (
              <div key={i} onClick={() => setQuery(r)} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 0", borderBottom:"1px solid var(--b1)", cursor:"pointer" }}>
                <div style={{ width:32, height:32, borderRadius:9, background:"var(--l3)", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Ic n="clock" s={14} c="var(--t3)"/></div>
                <span style={{ flex:1, fontSize:13, fontWeight:600 }}>{r}</span>
                <div style={{ transform:"rotate(225deg)" }}><Ic n="arr" s={13} c="var(--t3)"/></div>
              </div>
            ))}
          </div>
        )}
        {query && results.length===0 && (
          <div style={{ textAlign:"center", paddingTop:50 }}>
            <div style={{ fontSize:56, marginBottom:14, animation:"float 3s ease-in-out infinite" }}>🔍</div>
            <div className="ub" style={{ fontSize:18, fontWeight:800, marginBottom:8 }}>Ничего не найдено</div>
            <div style={{ fontSize:13, color:"var(--t2)", marginBottom:20 }}>По запросу <span style={{ color:"var(--gr)", fontWeight:700 }}>«{query}»</span></div>
            <button onClick={() => setQuery("")} className="btn" style={{ padding:"12px 24px", borderRadius:14, background:"linear-gradient(135deg,var(--gr2),var(--gr))", color:"white", fontSize:13 }}>Очистить поиск</button>
          </div>
        )}
        {query && results.length>0 && (
          <div>
            <div style={{ fontSize:12, color:"var(--t2)", marginBottom:14 }}>Найдено: <span style={{ color:"var(--gr)", fontWeight:700 }}>{results.length}</span> товаров</div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {results.map((p,i) => {
                const qty=cart[p.id]||0, disc=p.old?Math.round((1-p.price/p.old)*100):0;
                return (
                  <div key={p.id} className="card" style={{ display:"flex", alignItems:"center", gap:12, padding:"12px", animation:`fadeUp .4s cubic-bezier(.16,1,.3,1) ${i*.04}s both` }} onClick={() => go("product",{id:p.id})}>
                    <div style={{ width:60, height:60, borderRadius:14, background:p.grad, display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, flexShrink:0, position:"relative" }}>
                      {p.e}{disc>0 && <div style={{ position:"absolute", top:-4, left:-4, borderRadius:8, background:"var(--red)", padding:"1px 5px", fontSize:9, fontWeight:800, color:"white" }}>-{disc}%</div>}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:700, marginBottom:1 }}>{p.name}</div>
                      <div style={{ fontSize:10, color:"var(--t3)", marginBottom:4 }}>{p.unit}</div>
                      <div style={{ display:"flex", alignItems:"center", gap:3 }}><Stars r={p.r} s={8}/><span style={{ fontSize:9, color:"var(--t2)" }}>{p.r}({p.rv})</span></div>
                      <div style={{ display:"flex", alignItems:"baseline", gap:5, marginTop:4 }}>
                        <span className="ub" style={{ fontSize:14, fontWeight:800 }}>{p.price.toFixed(2)}<span style={{ fontSize:9, color:"var(--gd)", marginLeft:2 }}>ЅМ</span></span>
                        {p.old && <span style={{ fontSize:10, color:"var(--t3)", textDecoration:"line-through" }}>{p.old.toFixed(2)}</span>}
                      </div>
                    </div>
                    <div style={{ flexShrink:0 }}>
                      {qty===0 ? <button onClick={e=>{e.stopPropagation();onAdd(p.id);}} className="btn" style={{ width:36, height:36, borderRadius:10, background:"linear-gradient(135deg,var(--gr2),var(--gr))", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="plus" s={16} c="white" w={2.5}/></button> :
                        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3, background:"rgba(31,215,96,.1)", border:"1.5px solid rgba(31,215,96,.28)", borderRadius:10, padding:"4px 6px" }}>
                          <button onClick={e=>{e.stopPropagation();onRm(p.id);}} className="btn" style={{ width:22, height:22, borderRadius:6, background:"rgba(31,215,96,.18)", color:"var(--gr)", fontSize:14, fontWeight:700 }}>−</button>
                          <span className="ub" style={{ fontSize:12, fontWeight:800, color:"var(--gr)" }}>{formatCartQtyStepper(p, qty)}</span>
                          <button onClick={e=>{e.stopPropagation();onAdd(p.id);}} className="btn" style={{ width:22, height:22, borderRadius:6, background:"rgba(31,215,96,.18)", color:"var(--gr)", fontSize:14, fontWeight:700 }}>+</button>
                        </div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const FAQPage = ({ go }) => {
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState("");
  const filtered = FAQ.filter(f => q==="" || f.q.toLowerCase().includes(q.toLowerCase()) || f.a.toLowerCase().includes(q.toLowerCase()));
  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:480, margin:"0 auto" }}>
      <header style={{ position:"sticky", top:0, zIndex:100, background:"rgba(3,11,5,.96)", backdropFilter:"blur(24px)", borderBottom:"1px solid var(--b1)" }}>
        <div style={{ padding:"14px 18px 10px", display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={() => go("profile")} className="btn" style={{ width:38, height:38, borderRadius:12, background:"var(--l3)", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div className="ub" style={{ flex:1, fontSize:17, fontWeight:900 }}>FAQ</div>
        </div>
        <div style={{ padding:"0 18px 12px", position:"relative" }}>
          <div style={{ position:"absolute", left:30, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}><Ic n="search" s={15} c="var(--t3)"/></div>
          <input className="inp" value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск по вопросам..." style={{ paddingLeft:38, width:"100%" }}/>
        </div>
      </header>
      <div style={{ padding:"16px 18px 100px" }}>
        {!q && <div style={{ borderRadius:18, padding:"18px", marginBottom:20, background:"linear-gradient(135deg,#061A0C,#0F3020)", border:"1px solid rgba(31,215,96,.2)", display:"flex", alignItems:"center", justifyContent:"space-between" }}><div><div className="ub" style={{ fontSize:15, fontWeight:800, marginBottom:4 }}>Центр помощи</div><div style={{ fontSize:12, color:"var(--t2)" }}>Ответы на ваши вопросы о КАКАПО</div></div><div style={{ fontSize:40, animation:"float 3s ease-in-out infinite" }}>❓</div></div>}
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {filtered.map((f,i) => (
            <div key={i} style={{ background:"var(--l2)", border:`1px solid ${open===i?"rgba(31,215,96,.3)":"var(--b1)"}`, borderRadius:16, overflow:"hidden", transition:"border-color .2s", animation:`fadeUp .4s cubic-bezier(.16,1,.3,1) ${i*.04}s both` }}>
              <div onClick={() => setOpen(open===i?null:i)} style={{ padding:"15px", display:"flex", alignItems:"center", gap:12, cursor:"pointer" }}>
                <div style={{ width:30, height:30, borderRadius:9, background:open===i?"rgba(31,215,96,.14)":"var(--l3)", border:`1px solid ${open===i?"rgba(31,215,96,.3)":"var(--b1)"}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, transition:"all .2s" }}>
                  <Ic n={open===i?"minus":"plus"} s={14} c={open===i?"var(--gr)":"var(--t2)"} w={2.5}/>
                </div>
                <div style={{ flex:1, fontSize:13, fontWeight:700, color:open===i?"var(--gr)":"var(--t1)", lineHeight:1.38 }}>{f.q}</div>
              </div>
              {open===i && <div style={{ padding:"0 15px 15px 57px", fontSize:13, color:"var(--t2)", lineHeight:1.7, animation:"fadeIn .3s ease" }}>{f.a}</div>}
            </div>
          ))}
        </div>
        {filtered.length===0 && <div style={{ textAlign:"center", paddingTop:50 }}><div style={{ fontSize:50, marginBottom:14 }}>🔍</div><div className="ub" style={{ fontSize:16, fontWeight:800, marginBottom:8 }}>Не найдено</div><button onClick={() => setQ("")} className="btn" style={{ padding:"12px 24px", borderRadius:13, background:"linear-gradient(135deg,var(--gr2),var(--gr))", color:"white", fontSize:13 }}>Сбросить</button></div>}
        <div style={{ marginTop:20, background:"var(--l2)", border:"1px solid var(--b1)", borderRadius:18, padding:"16px" }}>
          <div className="ub" style={{ fontSize:13, fontWeight:800, marginBottom:4 }}>Не нашли ответ?</div>
          <div style={{ fontSize:12, color:"var(--t2)", marginBottom:14, lineHeight:1.6 }}>Наша поддержка в рабочие часы</div>
          {[{icon:"phone",l:"Позвонить",s:"+992 118 55-97-97",c:"var(--gr)"},{icon:"tg",l:"Telegram",s:"@kakapo_tj",c:"#29B6F6"}].map((ct,i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 0", borderBottom:i<1?"1px solid var(--b1)":"none", cursor:"pointer" }}>
              <div style={{ width:38, height:38, borderRadius:11, background:`${ct.c}14`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Ic n={ct.icon} s={18} c={ct.c}/></div>
              <div style={{ flex:1 }}><div style={{ fontSize:13, fontWeight:700 }}>{ct.l}</div><div style={{ fontSize:11, color:"var(--t2)", marginTop:1 }}>{ct.s}</div></div>
              <Ic n="arr" s={14} c="var(--t3)"/>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
const VIPPage = ({ go, user }) => {
  const [reserveModal, setReserveModal] = useState(false);
  const creditUsed = 1200, creditLimit = 3000;
  const creditPct  = Math.round((creditUsed / creditLimit) * 100);

  const PERKS = [
    { e:"🚀", title:"Приоритетная доставка",  desc:"Ваши заказы собираются первыми. Доставка за 30 мин.", color:"var(--blue)" },
    { e:"💳", title:"Покупки в долг",          desc:`Кредитный лимит ${creditLimit.toLocaleString()} ЅМ. Платите потом.`, color:"var(--gd)" },
    { e:"📦", title:"Резерв товаров",           desc:"Зарезервируй нужные товары — они ждут тебя в магазине.", color:"var(--sky)" },
    { e:"👑", title:"Личный менеджер",          desc:"Диловар Р. — ваш персональный менеджер. Всегда на связи.", color:"var(--pur)" },
    { e:"🎁", title:"Закрытые акции",           desc:"Доступ к эксклюзивным VIP предложениям до публикации.", color:"var(--gr)" },
    { e:"🌿", title:"Бесплатная доставка",      desc:"Доставка всегда бесплатна, независимо от суммы заказа.", color:"#34D399" },
    { e:"⭐", title:"5% кешбэк бонусами",       desc:"Максимальный уровень Platinum — 5% с каждой покупки.", color:"var(--gd)" },
    { e:"🔔", title:"Уведомления первым",        desc:"Узнаёте о новых акциях и поступлениях раньше всех.", color:"var(--org)" },
  ];

  const RESERVED = [
    { e:"🥩", name:"Говядина вырезка", qty:2, unit:"500 гр", price:38.00, till:"Сегодня 20:00" },
    { e:"🐟", name:"Лосось слабосолёный", qty:1, unit:"200 гр", price:28.00, till:"Завтра 12:00" },
  ];

  const HISTORY = [
    { date:"15 мая", desc:"Оплата долга",        amount:+500,  type:"pay" },
    { date:"14 мая", desc:"Заказ K-4821",         amount:-240,  type:"debt" },
    { date:"10 мая", desc:"Оплата долга",         amount:+1000, type:"pay" },
    { date:"8 мая",  desc:"Заказ K-4756",         amount:-960,  type:"debt" },
  ];

  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:480, margin:"0 auto" }}>
      <header style={{ position:"sticky", top:0, zIndex:100, background:"rgba(3,11,5,.96)", backdropFilter:"blur(24px)", borderBottom:"1px solid var(--b1)" }}>
        <div style={{ padding:"14px 18px 13px", display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={() => go("profile")} className="btn" style={{ width:38, height:38, borderRadius:12, background:"var(--l3)", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div style={{ flex:1 }}>
            <div className="ub" style={{ fontSize:17, fontWeight:900 }}>VIP Профиль</div>
            <div style={{ fontSize:10, color:"var(--gd)", marginTop:1, display:"flex", alignItems:"center", gap:4 }}><Ic n="crown" s={10} c="var(--gd)"/>Platinum · г. Яван</div>
          </div>
          <div style={{ padding:"4px 12px", borderRadius:20, background:"linear-gradient(135deg,rgba(255,184,0,.2),rgba(255,184,0,.08))", border:"1px solid rgba(255,184,0,.4)" }}>
            <span className="ub" style={{ fontSize:11, fontWeight:900, color:"var(--gd)" }}>VIP</span>
          </div>
        </div>
      </header>

      <div style={{ padding:"16px 18px 100px" }}>
        <div style={{ borderRadius:22, overflow:"hidden", marginBottom:18, position:"relative", background:"linear-gradient(135deg,#1A1000,#2E1E00,#1A1000)", border:"1.5px solid rgba(255,184,0,.4)", boxShadow:"0 8px 40px rgba(255,184,0,.2)" }}>
          <div style={{ position:"absolute", inset:0, opacity:.04, background:"repeating-linear-gradient(45deg,transparent,transparent 8px,rgba(255,184,0,1) 8px,rgba(255,184,0,1) 9px)" }}/>
          <div style={{ position:"absolute", right:-30, top:-30, width:160, height:160, borderRadius:"50%", background:"radial-gradient(circle,rgba(255,184,0,.18),transparent 70%)", filter:"blur(20px)" }}/>
          <div style={{ position:"relative", zIndex:2, padding:"22px 22px 20px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                  <div style={{ width:36, height:36, borderRadius:10, background:"linear-gradient(135deg,var(--gd2),var(--gd))", display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <Ic n="crown" s={18} c="var(--bg)" w={2}/>
                  </div>
                  <div>
                    <div className="ub" style={{ fontSize:14, fontWeight:900, color:"var(--gd)" }}>КАКАПО VIP</div>
                    <div style={{ fontSize:9, color:"rgba(255,184,0,.6)" }}>PLATINUM MEMBER</div>
                  </div>
                </div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:9, color:"rgba(255,184,0,.6)", marginBottom:2 }}>Клиент с</div>
                <div style={{ fontSize:11, fontWeight:700, color:"var(--gd)" }}>2022 года</div>
              </div>
            </div>
            <div className="ub" style={{ fontSize:20, letterSpacing:3, color:"var(--gd)", marginBottom:16, textShadow:"0 2px 12px rgba(255,184,0,.5)" }}>
              •••• •••• •••• 7654
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
              <div>
                <div style={{ fontSize:9, color:"rgba(255,184,0,.6)", marginBottom:2 }}>Имя</div>
                <div style={{ fontSize:13, fontWeight:700, color:"var(--gd)" }}>{user?.name?.toUpperCase() || "ДИЛОВАР Р."}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:9, color:"rgba(255,184,0,.6)", marginBottom:2 }}>Лимит</div>
                <div className="ub" style={{ fontSize:14, fontWeight:900, color:"var(--gd)" }}>{creditLimit.toLocaleString()} ЅМ</div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:16 }}>
          {[
            { l:"Заказов",   v:"124",   c:"var(--gr)" },
            { l:"Сэкономил", v:"890 ЅМ",c:"var(--blue)" },
            { l:"Бонусов",   v:"8 900", c:"var(--gd)" },
          ].map((s,i) => (
            <div key={i} style={{ background:"var(--l2)", border:"1px solid var(--b1)", borderRadius:16, padding:"14px 10px", textAlign:"center" }}>
              <div className="ub" style={{ fontSize:15, fontWeight:900, color:s.c, marginBottom:3 }}>{s.v}</div>
              <div style={{ fontSize:10, color:"var(--t3)" }}>{s.l}</div>
            </div>
          ))}
        </div>

        <div style={{ background:"var(--l2)", border:"1px solid var(--b1)", borderRadius:18, padding:"18px", marginBottom:16 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <div className="ub" style={{ fontSize:14, fontWeight:800 }}>💳 Кредитный лимит</div>
            <span className="bdg b-gd">Активен</span>
          </div>
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
          <div style={{ borderTop:"1px solid var(--b1)", paddingTop:12 }}>
            <div style={{ fontSize:12, fontWeight:700, marginBottom:10, color:"var(--t2)" }}>История</div>
            {HISTORY.map((h,i) => (
              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:i<HISTORY.length-1?"1px solid rgba(22,43,26,.5)":"none" }}>
                <div>
                  <div style={{ fontSize:12, fontWeight:600 }}>{h.desc}</div>
                  <div style={{ fontSize:10, color:"var(--t3)", marginTop:1 }}>{h.date}</div>
                </div>
                <span className="ub" style={{ fontSize:13, fontWeight:800, color:h.type==="pay"?"var(--gr)":"var(--red)" }}>
                  {h.type==="pay" ? "+" : "−"}{Math.abs(h.amount).toLocaleString()} ЅМ
                </span>
              </div>
            ))}
          </div>
          <button className="btn" style={{ width:"100%", marginTop:14, padding:"12px", borderRadius:13, background:"linear-gradient(135deg,var(--gd2),var(--gd))", color:"var(--bg)", fontSize:13, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center", gap:7 }}>
            <Ic n="card" s={16} c="var(--bg)"/>Погасить долг — {creditUsed.toLocaleString()} ЅМ
          </button>
        </div>

        <div style={{ background:"var(--l2)", border:"1px solid var(--b1)", borderRadius:18, padding:"18px", marginBottom:16 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
            <div className="ub" style={{ fontSize:14, fontWeight:800 }}>📦 Резерв товаров</div>
            <button onClick={() => setReserveModal(true)} className="btn" style={{ padding:"6px 13px", borderRadius:10, background:"rgba(0,212,200,.1)", border:"1px solid rgba(0,212,200,.28)", color:"var(--sky)", fontSize:12, fontWeight:700 }}>+ Добавить</button>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {RESERVED.map((r,i) => (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", background:"var(--l3)", borderRadius:14, border:"1px solid var(--b1)" }}>
                <div style={{ width:44, height:44, borderRadius:12, background:"var(--bg)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0 }}>{r.e}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700 }}>{r.name}</div>
                  <div style={{ fontSize:11, color:"var(--t3)", marginTop:1 }}>{r.qty} шт · {r.unit}</div>
                  <div style={{ fontSize:10, color:"var(--sky)", marginTop:3, display:"flex", alignItems:"center", gap:4 }}>
                    <Ic n="clock" s={10} c="var(--sky)"/>До {r.till}
                  </div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div className="ub" style={{ fontSize:13, fontWeight:800 }}>{(r.price*r.qty).toFixed(2)} <span style={{ fontSize:10, color:"var(--gd)" }}>ЅМ</span></div>
                  <button className="btn" style={{ marginTop:6, padding:"4px 10px", borderRadius:8, background:"rgba(31,215,96,.12)", border:"1px solid rgba(31,215,96,.3)", color:"var(--gr)", fontSize:11 }}>Купить</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background:"linear-gradient(135deg,#0E0A28,#1A1440)", border:"1px solid rgba(155,109,255,.3)", borderRadius:18, padding:"18px", marginBottom:16 }}>
          <div className="ub" style={{ fontSize:14, fontWeight:800, marginBottom:14 }}>👑 Личный менеджер</div>
          <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:14 }}>
            <div style={{ width:54, height:54, borderRadius:16, background:"linear-gradient(135deg,var(--pur),#6B3FD4)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Unbounded", fontSize:20, fontWeight:900, color:"white", flexShrink:0 }}>Д</div>
            <div style={{ flex:1 }}>
              <div className="ub" style={{ fontSize:14, fontWeight:800 }}>Диловар Рахимов</div>
              <div style={{ fontSize:11, color:"var(--t2)", marginTop:2 }}>Персональный VIP-менеджер</div>
              <div style={{ display:"flex", alignItems:"center", gap:5, marginTop:5 }}>
                <div style={{ width:6, height:6, borderRadius:"50%", background:"var(--gr)", animation:"pulse 2s infinite" }}/>
                <span style={{ fontSize:10, color:"var(--gr)", fontWeight:700 }}>Онлайн сейчас</span>
              </div>
            </div>
          </div>
          <div style={{ display:"flex", gap:8 }}>
            {[{icon:"phone",l:"Позвонить",c:"var(--gr)",bg:"rgba(31,215,96,.1)"},{icon:"tg",l:"Telegram",c:"#29B6F6",bg:"rgba(41,182,246,.1)"},{icon:"msg",l:"Написать",c:"var(--pur)",bg:"rgba(155,109,255,.1)"}].map((b,i) => (
              <button key={i} className="btn" style={{ flex:1, padding:"10px 8px", borderRadius:12, background:b.bg, border:`1px solid ${b.c}28`, display:"flex", flexDirection:"column", alignItems:"center", gap:5 }}>
                <Ic n={b.icon} s={18} c={b.c}/>
                <span style={{ fontSize:10, fontWeight:700, color:b.c }}>{b.l}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="ub" style={{ fontSize:14, fontWeight:800, marginBottom:14 }}>Ваши привилегии</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          {PERKS.map((perk,i) => (
            <div key={i} style={{ background:"var(--l2)", border:`1px solid ${perk.color}22`, borderRadius:16, padding:"14px 12px", animation:`fadeUp .4s cubic-bezier(.16,1,.3,1) ${i*.04}s both` }}>
              <div style={{ fontSize:26, marginBottom:8 }}>{perk.e}</div>
              <div style={{ fontSize:12, fontWeight:800, color:perk.color, marginBottom:4, lineHeight:1.3 }}>{perk.title}</div>
              <div style={{ fontSize:10, color:"var(--t3)", lineHeight:1.55 }}>{perk.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {reserveModal && (
        <div style={{ position:"fixed", inset:0, zIndex:300, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
          <div onClick={() => setReserveModal(false)} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,.8)", backdropFilter:"blur(8px)" }}/>
          <div style={{ position:"relative", zIndex:1, width:"100%", maxWidth:480, background:"var(--l1)", borderTop:"1px solid var(--b1)", borderRadius:"24px 24px 0 0", padding:"20px 20px 36px", animation:"slideUp .4s cubic-bezier(.16,1,.3,1)" }}>
            <div style={{ width:40, height:4, borderRadius:2, background:"var(--b2)", margin:"0 auto 16px" }}/>
            <div className="ub" style={{ fontSize:16, fontWeight:800, marginBottom:16 }}>Зарезервировать товар</div>
            <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:16 }}>
              <div>
                <div style={{ fontSize:11, color:"var(--t2)", marginBottom:6, fontWeight:700 }}>Название товара</div>
                <input className="inp" placeholder="Например: Говядина вырезка" style={{ width:"100%" }}/>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                <div>
                  <div style={{ fontSize:11, color:"var(--t2)", marginBottom:6, fontWeight:700 }}>Количество</div>
                  <input className="inp" type="number" defaultValue={1} style={{ width:"100%" }}/>
                </div>
                <div>
                  <div style={{ fontSize:11, color:"var(--t2)", marginBottom:6, fontWeight:700 }}>До (часы)</div>
                  <input className="inp" type="time" defaultValue="20:00" style={{ width:"100%" }}/>
                </div>
              </div>
            </div>
            <button onClick={() => setReserveModal(false)} className="btn" style={{ width:"100%", padding:"14px", fontSize:14, borderRadius:15, background:"linear-gradient(135deg,var(--gr2),var(--gr))", color:"white", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
              <Ic n="check" s={17} c="white" w={2.5}/>Зарезервировать
            </button>
          </div>
        </div>
      )}

      <Nav page="profile" go={go}/>
    </div>
  );
};
const AboutPage = ({ go }) => {
  const [tab, setTab] = useState("about");
  const [sent, setSent] = useState(false);
  const [name, setName] = useState("");
  const [msg,  setMsg]  = useState("");
  const [sending, setSending] = useState(false);

  const TIMELINE = [
    { year:"2019", e:"🌱", t:"Открытие первого магазина", d:"Начали с небольшого магазина в центре г. Яван. Первые покупатели стали постоянными клиентами." },
    { year:"2021", e:"📱", t:"Запуск приложения",          d:"Создали мобильное приложение. Более 5 000 загрузок в первый месяц." },
    { year:"2022", e:"🚀", t:"Служба доставки",             d:"Запустили собственную доставку по всему г. Яван за 45 минут." },
    { year:"2023", e:"🏪", t:"Второй магазин",              d:"Открыли магазин на Центральном рынке. Ассортимент — 5 000 позиций." },
    { year:"2024", e:"👑", t:"VIP программа",               d:"Запустили клуб лояльности с кредитным лимитом и VIP менеджерами." },
    { year:"2025", e:"✨", t:"Новое приложение",             d:"Полностью переработали платформу — вы в нём прямо сейчас!" },
  ];

  const STORES = [
    { name:"КАКАПО Главный",    addr:"ул. Ленина, 42",             hours:"08:00–22:00", phone:"+992 118 55-97-97", main:true },
    { name:"КАКАПО Рынок",      addr:"Центральный рынок, блок 3",  hours:"08:00–20:00", phone:"+992 553 55-98-98", main:false },
    { name:"КАКАПО Микрорайон", addr:"мкр. Мирный, 15",            hours:"09:00–21:00", phone:"+992 93 123 45 67", main:false },
  ];

  const TEAM = [
    { name:"Диловар Рахимов",  role:"Основатель и директор",    av:"Д", color:"var(--gr)" },
    { name:"Нилуфар Хасанова", role:"Управляющая магазина",     av:"Н", color:"var(--blue)" },
    { name:"Зафар Мирзоев",    role:"Руководитель доставки",    av:"З", color:"var(--gd)" },
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
    <div style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:480, margin:"0 auto" }}>
      <header style={{ position:"sticky", top:0, zIndex:100, background:"rgba(3,11,5,.96)", backdropFilter:"blur(24px)", borderBottom:"1px solid var(--b1)" }}>
        <div style={{ padding:"14px 18px 10px", display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={() => go("profile")} className="btn" style={{ width:38, height:38, borderRadius:12, background:"var(--l3)", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div style={{ flex:1 }}>
            <div className="ub" style={{ fontSize:17, fontWeight:900 }}>О КАКАПО</div>
            <div style={{ fontSize:10, color:"var(--t2)", marginTop:1 }}>г. Яван, Таджикистан · с 2019 года</div>
          </div>
          <button className="btn" style={{ width:38, height:38, borderRadius:12, background:"var(--l3)", border:"1px solid var(--b1)", display:"flex", alignItems:"center", justifyContent:"center" }}><Ic n="share" s={17} c="var(--t2)"/></button>
        </div>
        <div className="hscroll" style={{ padding:"0 18px 12px", gap:6 }}>
          {[{id:"about",l:"О нас"},{id:"contacts",l:"Контакты"},{id:"stores",l:"Магазины"},{id:"team",l:"Команда"}].map(t => (
            <button key={t.id} className={`chip ${tab===t.id?"on":""}`} onClick={() => setTab(t.id)}>{t.l}</button>
          ))}
        </div>
      </header>

      <div style={{ padding:"0 0 100px" }}>
        {tab==="about" && (
          <div>
            <div style={{ height:200, background:"linear-gradient(160deg,#061A0A 0%,#103020 50%,#040E06 100%)", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"28px 24px", position:"relative", overflow:"hidden" }}>
              <div style={{ position:"absolute", left:0, right:0, height:1, background:"linear-gradient(90deg,transparent,rgba(31,215,96,.5),transparent)", animation:"scanLine 3s linear infinite" }}/>
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12 }}>
                  <div style={{ width:52, height:52, borderRadius:16, background:"linear-gradient(135deg,var(--gr3),var(--gr))", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Unbounded", fontSize:22, fontWeight:900, color:"var(--bg)", animation:"glow 3s ease-in-out infinite", boxShadow:"0 4px 16px rgba(31,215,96,.4)" }}>K</div>
                  <div>
                    <div className="ub" style={{ fontSize:20, fontWeight:900, background:"linear-gradient(135deg,var(--gr),var(--gd))", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", backgroundClip:"text" }}>КАКАПО</div>
                    <div style={{ fontSize:11, color:"var(--t2)" }}>Ваш семейный супермаркет</div>
                  </div>
                </div>
                <div style={{ fontSize:13, color:"rgba(255,255,255,.65)", lineHeight:1.6 }}>Свежие продукты каждой семье г. Яван</div>
              </div>
              <div style={{ fontSize:52, animation:"float 3s ease-in-out infinite", filter:"drop-shadow(0 6px 16px rgba(31,215,96,.35))" }}>🛒</div>
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
                      <div style={{ width:36, height:36, borderRadius:11, background:"linear-gradient(135deg,var(--gr3),var(--gr))", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{step.e}</div>
                      {i<TIMELINE.length-1 && <div style={{ width:2, flex:1, minHeight:20, background:"linear-gradient(180deg,var(--gr),var(--b1))", margin:"4px 0" }}/>}
                    </div>
                    <div style={{ flex:1, paddingBottom:i<TIMELINE.length-1?4:0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                        <span style={{ fontSize:9, fontWeight:800, color:"var(--gr)", padding:"2px 7px", borderRadius:6, background:"rgba(31,215,96,.12)", border:"1px solid rgba(31,215,96,.25)" }}>{step.year}</span>
                        <span style={{ fontSize:12, fontWeight:800 }}>{step.t}</span>
                      </div>
                      <div style={{ fontSize:11, color:"var(--t2)", lineHeight:1.6 }}>{step.d}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ borderRadius:18, background:"linear-gradient(135deg,#0A1A06,#142A0E)", border:"1px solid rgba(31,215,96,.2)", padding:"18px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ fontSize:11, fontWeight:800, color:"var(--gr)", textTransform:"uppercase", letterSpacing:".8px", marginBottom:6 }}>Нас выбирают</div>
                  <div className="ub" style={{ fontSize:16, fontWeight:900, marginBottom:4 }}>Лучший супермаркет Явана</div>
                  <div style={{ fontSize:11, color:"var(--t2)" }}>По версии жителей · 2023–2024</div>
                </div>
                <div style={{ fontSize:48, animation:"float 3s ease-in-out infinite", filter:"drop-shadow(0 6px 16px rgba(255,184,0,.4))" }}>🏆</div>
              </div>
            </div>
          </div>
        )}
        {tab==="contacts" && (
          <div style={{ padding:"16px 18px 0" }}>
            <div className="ub" style={{ fontSize:13, fontWeight:800, color:"var(--t3)", textTransform:"uppercase", letterSpacing:".8px", marginBottom:10 }}>Связаться с нами</div>
            <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:22 }}>
              {[
                { icon:"phone", label:"Позвонить",       sub:"+992 118 55-97-97", color:"var(--gr)",   bg:"rgba(31,215,96,.1)" },
                { icon:"phone", label:"Второй номер",     sub:"+992 553 55-98-98", color:"var(--gr)",   bg:"rgba(31,215,96,.08)" },
                { icon:"wa",    label:"WhatsApp",         sub:"Пишите в любое время", color:"#25D366",  bg:"rgba(37,211,102,.1)" },
                { icon:"tg",    label:"Telegram",         sub:"@kakapo_tj",        color:"#29B6F6",     bg:"rgba(41,182,246,.1)" },
                { icon:"insta", label:"Instagram",        sub:"@kakapo.tj",        color:"#E1306C",     bg:"rgba(225,48,108,.1)" },
                { icon:"msg",   label:"Email",            sub:"kakapo.tj@gmail.com",color:"var(--gd)",  bg:"rgba(255,184,0,.1)" },
              ].map((c,i) => (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 16px", background:"var(--l2)", border:"1px solid var(--b1)", borderRadius:16, cursor:"pointer", transition:"all .2s" }}>
                  <div style={{ width:42, height:42, borderRadius:13, background:c.bg, border:`1px solid ${c.color}30`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    <Ic n={c.icon} s={20} c={c.color}/>
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:700 }}>{c.label}</div>
                    <div style={{ fontSize:11, color:"var(--t2)", marginTop:1 }}>{c.sub}</div>
                  </div>
                  <Ic n="arr" s={14} c="var(--t3)"/>
                </div>
              ))}
            </div>

            <div className="ub" style={{ fontSize:13, fontWeight:800, color:"var(--t3)", textTransform:"uppercase", letterSpacing:".8px", marginBottom:10 }}>Режим работы</div>
            <div className="card" style={{ overflow:"hidden", marginBottom:22 }}>
              {[{d:"Понедельник – Пятница",h:"08:00–22:00"},{d:"Суббота",h:"08:00–22:00"},{d:"Воскресенье",h:"09:00–21:00"},{d:"Доставка",h:"08:00–22:00"}].map((r,i) => (
                <div key={i} style={{ padding:"13px 16px", borderBottom:i<3?"1px solid var(--b1)":"none", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ width:7, height:7, borderRadius:"50%", background:"var(--gr)", animation:"pulse 2s infinite" }}/>
                    <span style={{ fontSize:12, fontWeight:600 }}>{r.d}</span>
                  </div>
                  <span className="ub" style={{ fontSize:12, fontWeight:800, color:"var(--gr)" }}>{r.h}</span>
                </div>
              ))}
            </div>

            <div className="ub" style={{ fontSize:13, fontWeight:800, color:"var(--t3)", textTransform:"uppercase", letterSpacing:".8px", marginBottom:10 }}>Написать нам</div>
            {!sent ? (
              <div className="card" style={{ padding:"18px", display:"flex", flexDirection:"column", gap:10 }}>
                <input className="inp" value={name} onChange={e => setName(e.target.value)} placeholder="Ваше имя *" style={{ width:"100%" }}/>
                <textarea value={msg} onChange={e => setMsg(e.target.value)} placeholder="Ваше сообщение *"
                  style={{ width:"100%", background:"var(--l3)", border:"1.5px solid var(--b1)", borderRadius:14, padding:"13px 16px", color:"var(--t1)", fontFamily:"Nunito", fontSize:14, resize:"none", height:90, outline:"none" }}/>
                <button onClick={send} className="btn" style={{ padding:"14px", fontSize:14, borderRadius:14, background:"linear-gradient(135deg,var(--gr2),var(--gr))", color:"white", display:"flex", alignItems:"center", justifyContent:"center", gap:8, opacity:name&&msg?1:.5 }}>
                  {sending ? <div style={{ width:18, height:18, borderRadius:"50%", border:"2.5px solid rgba(255,255,255,.3)", borderTopColor:"white", animation:"spin 1s linear infinite" }}/> : <><Ic n="send" s={16} c="white"/>Отправить сообщение</>}
                </button>
              </div>
            ) : (
              <div style={{ background:"rgba(31,215,96,.07)", border:"1.5px solid rgba(31,215,96,.3)", borderRadius:18, padding:"28px", textAlign:"center" }}>
                <div style={{ fontSize:40, marginBottom:12, animation:"float 3s ease-in-out infinite" }}>✉️</div>
                <div className="ub" style={{ fontSize:16, fontWeight:800, color:"var(--gr)", marginBottom:6 }}>Сообщение отправлено!</div>
                <div style={{ fontSize:12, color:"var(--t2)", lineHeight:1.6 }}>Ответим в течение нескольких часов в рабочее время</div>
                <button className="btn" onClick={() => { setSent(false); setName(""); setMsg(""); }} style={{ marginTop:14, padding:"10px 22px", borderRadius:13, background:"rgba(31,215,96,.1)", border:"1.5px solid rgba(31,215,96,.3)", color:"var(--gr)", fontSize:12, fontWeight:700 }}>Написать ещё</button>
              </div>
            )}
          </div>
        )}

        {tab==="stores" && (
          <div style={{ padding:"16px 18px 0" }}>
            <div className="ub" style={{ fontSize:15, fontWeight:800, marginBottom:16 }}>Наши магазины</div>
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              {STORES.map((store,i) => (
                <div key={i} style={{ background:"var(--l2)", border:`1.5px solid ${store.main?"rgba(31,215,96,.3)":"var(--b1)"}`, borderRadius:20, overflow:"hidden" }}>
                  {store.main && (
                    <div style={{ padding:"8px 16px", background:"rgba(31,215,96,.08)", borderBottom:"1px solid rgba(31,215,96,.15)", display:"flex", alignItems:"center", gap:7 }}>
                      <div style={{ width:6, height:6, borderRadius:"50%", background:"var(--gr)", animation:"pulse 2s infinite" }}/>
                      <span style={{ fontSize:10, fontWeight:800, color:"var(--gr)" }}>Главный магазин · Открыт сейчас</span>
                    </div>
                  )}
                  <div style={{ padding:"16px" }}>
                    <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:14 }}>
                      <div style={{ width:44, height:44, borderRadius:13, background:store.main?"linear-gradient(135deg,var(--gr3),var(--gr))":"var(--l3)", border:`1px solid ${store.main?"transparent":"var(--b1)"}`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Unbounded", fontSize:16, fontWeight:900, color:store.main?"var(--bg)":"var(--t2)", flexShrink:0 }}>K</div>
                      <div style={{ flex:1 }}>
                        <div className="ub" style={{ fontSize:14, fontWeight:800, marginBottom:3 }}>{store.name}</div>
                        <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, color:"var(--t2)", marginBottom:2 }}><Ic n="map" s={12} c="var(--gr)"/>{store.addr}</div>
                        <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, color:"var(--t2)" }}><Ic n="clock" s={12} c="var(--gd)"/>{store.hours}</div>
                      </div>
                    </div>
                    <div style={{ height:90, borderRadius:12, overflow:"hidden", position:"relative", background:"linear-gradient(135deg,#050F08,#091814)", border:"1px solid rgba(31,215,96,.12)", marginBottom:12, cursor:"pointer" }}>
                      <div style={{ position:"absolute", inset:0, opacity:.05, background:"repeating-linear-gradient(0deg,transparent,transparent 16px,rgba(31,215,96,1) 16px,rgba(31,215,96,1) 17px),repeating-linear-gradient(90deg,transparent,transparent 16px,rgba(31,215,96,1) 16px,rgba(31,215,96,1) 17px)" }}/>
                      <div style={{ position:"absolute", top:"40%", left:"45%", display:"flex", flexDirection:"column", alignItems:"center" }}>
                        <div style={{ width:26, height:26, borderRadius:"50%", background:"rgba(31,215,96,.9)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"Unbounded", fontSize:10, fontWeight:900, color:"var(--bg)", boxShadow:"0 0 10px rgba(31,215,96,.6)" }}>K</div>
                        <div style={{ width:2, height:8, background:"var(--gr)" }}/>
                      </div>
                      <div style={{ position:"absolute", bottom:7, right:10, fontSize:9, color:"rgba(255,255,255,.4)", display:"flex", alignItems:"center", gap:4 }}>Открыть карту</div>
                    </div>
                    <div style={{ display:"flex", gap:8 }}>
                      <button className="btn" style={{ flex:1, padding:"10px", fontSize:12, borderRadius:12, background:"linear-gradient(135deg,var(--gr2),var(--gr))", color:"white", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                        <Ic n="phone" s={13} c="white"/>{store.phone}
                      </button>
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
            <div style={{ background:"linear-gradient(135deg,#060C20,#0E1640)", border:"1px solid rgba(59,142,240,.2)", borderRadius:18, padding:"20px", textAlign:"center", marginBottom:16 }}>
              <div style={{ fontSize:36, marginBottom:10 }}>💼</div>
              <div className="ub" style={{ fontSize:15, fontWeight:800, marginBottom:6 }}>Хотите к нам?</div>
              <div style={{ fontSize:12, color:"var(--t2)", lineHeight:1.65, marginBottom:14 }}>Ищем ответственных и позитивных людей для работы в КАКАПО</div>
              <button className="btn" style={{ padding:"12px 24px", fontSize:13, borderRadius:14, background:"linear-gradient(135deg,var(--gr2),var(--gr))", color:"white" }}>Отправить резюме →</button>
            </div>
            <div className="card" style={{ padding:"16px" }}>
              <div style={{ fontSize:13, fontWeight:800, marginBottom:12 }}>Мы в социальных сетях</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                {[
                  { icon:"insta",label:"Instagram",sub:"@kakapo.tj",  color:"#E1306C",bg:"rgba(225,48,108,.1)" },
                  { icon:"tg",   label:"Telegram", sub:"@kakapo_tj",  color:"#29B6F6",bg:"rgba(41,182,246,.1)" },
                  { icon:"wa",   label:"WhatsApp",  sub:"Чат поддержки",color:"#25D366",bg:"rgba(37,211,102,.1)" },
                  { icon:"msg",  label:"Написать",  sub:"kakapo.tj",  color:"var(--gd)",bg:"rgba(255,184,0,.1)" },
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
      <Nav page="profile" go={go}/>
    </div>
  );
};
const ACSS=`.ac{background:#091508;border:1px solid #162B1A;border-radius:14px;overflow:hidden;}.at{width:100%;border-collapse:collapse;}.at th{padding:9px 14px;text-align:left;font-size:10px;font-weight:800;color:#3D6645;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #162B1A;}.at td{padding:11px 14px;border-bottom:1px solid rgba(22,43,26,.5);font-size:13px;}.at tr:last-child td{border-bottom:none;}.at tr:hover td{background:rgba(31,215,96,.03);cursor:pointer;}.ai{background:#0C1C0F;border:1.5px solid #162B1A;border-radius:10px;color:#EBF5ED;font-family:Nunito,sans-serif;font-size:13px;outline:none;padding:9px 13px;transition:border-color .2s;width:100%;}.ai:focus{border-color:rgba(31,215,96,.5);}.ai::placeholder{color:#3D6645;}.ab{font-family:Nunito,sans-serif;font-weight:700;cursor:pointer;border:none;transition:all .2s;border-radius:10px;padding:8px 16px;font-size:13px;}.ab:active{transform:scale(.97);}.abp{background:linear-gradient(135deg,#17B34E,#1FD760);color:#030B05;}.abg{background:rgba(31,215,96,.09);color:#1FD760;border:1.5px solid rgba(31,215,96,.28);}.abd{background:rgba(255,69,69,.1);color:#FF4545;border:1px solid rgba(255,69,69,.3);}.amod{position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;padding:20px;}.amodbg{position:absolute;inset:0;background:rgba(0,0,0,.8);backdrop-filter:blur(8px);}.amodbox{position:relative;z-index:1;background:#06100A;border:1px solid #162B1A;border-radius:20px;padding:24px;width:100%;max-width:560px;max-height:88vh;overflow-y:auto;animation:fadeIn .3s ease;}`;

const AdminWrap = ({go, title, subtitle, children}) => {
  const [ok, setOk] = useState(() => { try { return localStorage.getItem('ka')==='1'; } catch { return false; } });
  const [em, setEm] = useState('');
  const [pw, setPw] = useState('');
  const [er, setEr] = useState('');
  const [ld, setLd] = useState(false);

  const NAV = [
    {id:'admin_dash',      icon:'📊', l:'Dashboard',   group:'Общее'},
    {id:'admin_orders',    icon:'📦', l:'Все заказы',  group:'Общее'},
    {id:'admin_products',  icon:'🥦', l:'Товары',      group:'🛒 Магазин'},
    {id:'admin_inventory', icon:'📊', l:'Склад',       group:'🛒 Магазин'},
    {id:'admin_promos',    icon:'💸', l:'Акции',       group:'🛒 Магазин'},
    {id:'admin_banners',   icon:'🖼', l:'Баннеры / Слайдеры', group:'🖼 Контент'},
    {id:'admin_partners',  icon:'🍽', l:'Рестораны',   group:'🍽 Рестораны'},
    {id:'admin_reviews',   icon:'⭐', l:'Отзывы',      group:'🍽 Рестораны'},
    {id:'admin_couriers',  icon:'🛵', l:'Курьеры',     group:'👥 Команда'},
    {id:'admin_assemblers',icon:'🛒', l:'Сборщики',    group:'👥 Команда'},
    {id:'admin_clients',   icon:'👥', l:'Клиенты',     group:'💳 Клиенты'},
    {id:'admin_cards',     icon:'💳', l:'Карты',       group:'💳 Клиенты'},
    {id:'admin_push',      icon:'🔔', l:'Push',        group:'💳 Клиенты'},
    {id:'admin_finance',   icon:'💰', l:'Финансы',     group:'💰 Финансы'},
    {id:'admin_chat',      icon:'💬', l:'Чат',         group:'⚙️ Система'},
    {id:'admin_settings',  icon:'⚙️',  l:'Настройки',  group:'⚙️ Система'},
  ];

  const doLogin = (e) => {
    e.preventDefault(); setEr('');
    if(!em||!pw){setEr('Заполните поля');return;}
    setLd(true);
    setTimeout(()=>{
      if(em.toLowerCase()==='admin@kakapo.tj'&&pw==='admin123'){
        try{localStorage.setItem('ka','1');}catch{}
        setOk(true);
      } else setEr('Неверный email или пароль');
      setLd(false);
    },800);
  };

  if(!ok) return (
    <div style={{minHeight:'100vh',background:'#030B05',display:'flex',alignItems:'center',justifyContent:'center',padding:24,fontFamily:'Nunito,sans-serif'}}>
      <style>{ACSS}</style>
      <div style={{width:'100%',maxWidth:380}}>
        <div style={{textAlign:'center',marginBottom:26}}>
          <div style={{width:60,height:60,borderRadius:18,background:'linear-gradient(135deg,#0F8A3A,#1FD760)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:24,fontWeight:900,color:'#030B05',margin:'0 auto 12px',boxShadow:'0 8px 28px rgba(31,215,96,.4)'}}>K</div>
          <div style={{fontFamily:'Unbounded',fontSize:18,fontWeight:900,background:'linear-gradient(135deg,#1FD760,#FFB800)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text'}}>КАКАПО Admin</div>
        </div>
        <div style={{background:'#091508',border:'1px solid #162B1A',borderRadius:20,padding:24}}>
          <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:800,marginBottom:16}}>Вход в панель</div>
          {er&&<div style={{padding:'9px 12px',borderRadius:10,background:'rgba(255,69,69,.1)',border:'1px solid rgba(255,69,69,.3)',fontSize:12,color:'#FF4545',marginBottom:12}}>⚠️ {er}</div>}
          <form onSubmit={doLogin} style={{display:'flex',flexDirection:'column',gap:11}}>
            <input className="ai" value={em} onChange={e=>{setEm(e.target.value);setEr('');}} type="email" placeholder="admin@kakapo.tj"/>
            <input className="ai" value={pw} onChange={e=>{setPw(e.target.value);setEr('');}} type="password" placeholder="••••••••"/>
            <div style={{padding:'8px 12px',borderRadius:9,background:'rgba(255,184,0,.06)',border:'1px solid rgba(255,184,0,.2)',fontSize:11,color:'#8FB897'}}>
              💡 <span style={{color:'#FFB800',fontWeight:700}}>admin@kakapo.tj</span> / <span style={{color:'#FFB800',fontWeight:700}}>admin123</span>
            </div>
            <button type="submit" className="ab abp" style={{padding:12,fontSize:14,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
              {ld?<div style={{width:18,height:18,borderRadius:'50%',border:'2.5px solid rgba(3,11,5,.3)',borderTopColor:'#030B05',animation:'spin 1s linear infinite'}}/>:'🔐 Войти'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{display:'flex',minHeight:'100vh',background:'#030B05',fontFamily:'Nunito,sans-serif'}}>
      <style>{ACSS}</style>
      <aside style={{width:200,flexShrink:0,background:'#06100A',borderRight:'1px solid #162B1A',display:'flex',flexDirection:'column',position:'sticky',top:0,height:'100vh'}}>
        <div style={{padding:'14px 12px',borderBottom:'1px solid #162B1A',display:'flex',alignItems:'center',gap:9}}>
          <div style={{width:36,height:36,borderRadius:11,background:'linear-gradient(135deg,#0F8A3A,#1FD760)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:14,fontWeight:900,color:'#030B05',flexShrink:0}}>K</div>
          <div><div style={{fontFamily:'Unbounded',fontSize:13,fontWeight:900,color:'#1FD760'}}>КАКАПО</div><div style={{fontSize:9,color:'#3D6645'}}>Admin Panel</div></div>
        </div>
        <nav style={{flex:1,padding:'8px',overflowY:'auto',display:'flex',flexDirection:'column',gap:1}}>
          {(() => {
            let lastGroup = null;
            return NAV.map((n) => {
              const showGroup = n.group && n.group !== lastGroup;
              if(showGroup) lastGroup = n.group;
              return (
                <div key={n.id}>
                  {showGroup && n.group !== 'Общее' && (
                    <div style={{fontSize:9,fontWeight:800,color:'#1D3822',textTransform:'uppercase',letterSpacing:1,padding:'10px 11px 4px',marginTop:4}}>{n.group}</div>
                  )}
                  <button onClick={()=>go(n.id)} className="btn"
                    style={{display:'flex',alignItems:'center',gap:9,padding:'8px 11px',borderRadius:10,background:title===n.l?'rgba(31,215,96,.14)':'transparent',border:`1px solid ${title===n.l?'rgba(31,215,96,.22)':'transparent'}`,color:title===n.l?'#1FD760':'#8FB897',fontSize:12,fontWeight:600,textAlign:'left',cursor:'pointer',width:'100%',marginBottom:1}}>
                    <span style={{fontSize:16}}>{n.icon}</span>{n.l}
                  </button>
                </div>
              );
            });
          })()}
        </nav>
        <div style={{padding:'8px 8px 14px',borderTop:'1px solid #162B1A',display:'flex',flexDirection:'column',gap:6}}>
          <button onClick={()=>go('home')} className="ab abg" style={{width:'100%',padding:'8px',fontSize:11}}>← Сайт</button>
          <button onClick={()=>{try{localStorage.removeItem('ka');}catch{}setOk(false);}} className="ab abd" style={{width:'100%',padding:'8px',fontSize:12}}>🚪 Выйти</button>
        </div>
      </aside>
      <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0}}>
        <div style={{padding:'12px 22px',borderBottom:'1px solid #162B1A',background:'rgba(3,11,5,.9)',backdropFilter:'blur(16px)',display:'flex',alignItems:'center',gap:10,position:'sticky',top:0,zIndex:50}}>
          <div style={{flex:1}}><div style={{fontFamily:'Unbounded',fontSize:16,fontWeight:900}}>{title}</div>{subtitle&&<div style={{fontSize:11,color:'#8FB897',marginTop:1}}>{subtitle}</div>}</div>
        </div>
        <main style={{flex:1,padding:22,overflowY:'auto'}}>{children}</main>
      </div>
    </div>
  );
};
const AdminDashPage = ({go}) => {
  const SC = {pending:{l:'Ожидает',c:'#FFB800'},assembling:{l:'Собирается',c:'#9B6DFF'},delivering:{l:'В пути',c:'#3B8EF0'},delivered:{l:'Доставлен',c:'#1FD760'},cancelled:{l:'Отменён',c:'#FF4545'},new:{l:'Новый',c:'#FF4545'},cooking:{l:'Готовится',c:'#FFB800'},ready:{l:'Готово',c:'#1FD760'}};
  const storeOrders = [
    {id:'K-4832',client:'Диловар Р.',total:64.30,status:'delivering',type:'store'},
    {id:'K-4831',client:'Нилуфар Х.',total:28.50,status:'assembling',type:'store'},
    {id:'K-4830',client:'Бахром К.',total:112.0,status:'delivered',type:'store'},
  ];
  const totalRestRev = RESTAURANTS.reduce((s,r)=>s+r.revenueMonth,0);
  const totalRestComm= RESTAURANTS.reduce((s,r)=>s+Math.round(r.revenueMonth*r.commission/100),0);
  const activeRestOrders = REST_ORDERS.filter(o=>o.status!=='delivered').length;

  return (
    <AdminWrap go={go} title="Dashboard" subtitle="Управление всеми 4 приложениями · г. Яван">
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:20}}>
        {[
          {e:'🛒',l:'Магазин',       v:'Работает',  sub:'48 заказов сегодня',c:'#1FD760', to:'admin_orders'},
          {e:'🍽',l:'Рестораны',     v:`${RESTAURANTS.filter(r=>r.open).length}/${RESTAURANTS.length} открыто`,sub:`${activeRestOrders} активных заказов`,c:'var(--org)',to:'admin_partners'},
          {e:'🛵',l:'Курьеры',       v:'3 активных',sub:'1 офлайн',          c:'#3B8EF0', to:'admin_couriers'},
          {e:'🛒',l:'Сборщики',      v:'2 на смене', sub:'12 собрано сегодня',c:'#9B6DFF', to:'admin_assemblers'},
        ].map((s,i)=>(
          <div key={i} onClick={()=>go(s.to)} className="ac" style={{padding:16,cursor:'pointer',transition:'transform .2s'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
              <div style={{fontSize:11,color:'#8FB897',fontWeight:600}}>{s.l}</div>
              <span style={{fontSize:24}}>{s.e}</span>
            </div>
            <div style={{fontFamily:'Unbounded',fontSize:15,fontWeight:900,color:s.c,marginBottom:4}}>{s.v}</div>
            <div style={{fontSize:10,color:'#3D6645'}}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:20}}>
        {[
          {l:'Выручка магазина',  v:'3 580 ЅМ',c:'#1FD760',t:'+12%'},
          {l:'Выручка ресторанов',v:`${totalRestRev.toLocaleString()} ЅМ`,c:'var(--org)',t:'+8%'},
          {l:'Комиссия от ресторанов',v:`${totalRestComm.toLocaleString()} ЅМ`,c:'#FF4545',t:''},
          {l:'Клиентов всего',    v:'1 847',c:'#00D4C8',t:'+3%'},
        ].map((s,i)=>(
          <div key={i} className="ac" style={{padding:16}}>
            <div style={{fontSize:11,color:'#8FB897',fontWeight:600,marginBottom:10}}>{s.l}</div>
            <div style={{fontFamily:'Unbounded',fontSize:20,fontWeight:900,color:s.c,marginBottom:6}}>{s.v}</div>
            {s.t&&<span style={{padding:'2px 8px',borderRadius:8,fontSize:10,fontWeight:800,background:'rgba(31,215,96,.1)',color:'#1FD760'}}>{s.t}</span>}
          </div>
        ))}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1.2fr 1fr',gap:18,marginBottom:18}}>
        <div className="ac">
          <div style={{padding:'12px 16px',borderBottom:'1px solid #162B1A',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div style={{fontSize:13,fontWeight:800}}>🛒 Заказы магазина</div>
            <button onClick={()=>go('admin_orders')} className="ab abg" style={{padding:'4px 11px',fontSize:11}}>Все →</button>
          </div>
          <table className="at">
            <thead><tr><th>ID</th><th>Клиент</th><th>Сумма</th><th>Статус</th></tr></thead>
            <tbody>{storeOrders.map(o=>{const s=SC[o.status];return(
              <tr key={o.id}>
                <td><span style={{fontFamily:'Unbounded',fontSize:11,color:'#1FD760'}}>{o.id}</span></td>
                <td style={{fontWeight:600,fontSize:13}}>{o.client}</td>
                <td><span style={{fontFamily:'Unbounded',fontWeight:800,fontSize:12}}>{o.total.toFixed(2)} ЅМ</span></td>
                <td><span style={{padding:'2px 7px',borderRadius:7,fontSize:10,fontWeight:800,background:`${s.c}18`,color:s.c,border:`1px solid ${s.c}30`}}>{s.l}</span></td>
              </tr>
            );})}</tbody>
          </table>
        </div>

        <div className="ac">
          <div style={{padding:'12px 16px',borderBottom:'1px solid #162B1A',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div style={{fontSize:13,fontWeight:800}}>🍽 Заказы ресторанов</div>
            <button onClick={()=>go('admin_partners')} className="ab abg" style={{padding:'4px 11px',fontSize:11}}>Все →</button>
          </div>
          <table className="at">
            <thead><tr><th>ID</th><th>Ресторан</th><th>Сумма</th><th>Статус</th></tr></thead>
            <tbody>{REST_ORDERS.slice(0,4).map(o=>{
              const rest=RESTAURANTS.find(r=>r.id===o.restId);
              const s=SC[o.status];
              return(
                <tr key={o.id}>
                  <td><span style={{fontFamily:'Unbounded',fontSize:11,color:'#1FD760'}}>{o.id}</span></td>
                  <td style={{fontSize:13}}>{rest?.emoji} {rest?.name.split(' ')[0]}</td>
                  <td><span style={{fontFamily:'Unbounded',fontWeight:800,fontSize:12}}>{o.total} ЅМ</span></td>
                  <td><span style={{padding:'2px 7px',borderRadius:7,fontSize:10,fontWeight:800,background:`${s.c}18`,color:s.c,border:`1px solid ${s.c}30`}}>{s.l}</span></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </div>

      <div className="ac" style={{padding:16}}>
        <div style={{fontSize:13,fontWeight:800,marginBottom:14}}>Быстрые действия</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:10}}>
          {[
            {e:'🍽',l:'Добавить ресторан',to:'admin_partners'},
            {e:'🥦',l:'Добавить товар',    to:'admin_products'},
            {e:'🛵',l:'Добавить курьера',  to:'admin_couriers'},
            {e:'💸',l:'Создать акцию',     to:'admin_promos'},
            {e:'🔔',l:'Push рассылка',     to:'admin_push'},
            {e:'💰',l:'Выплаты ресторанам',to:'admin_finance'},
          ].map((a,i)=>(
            <button key={i} onClick={()=>go(a.to)} className="ab" style={{padding:'12px 8px',background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',display:'flex',flexDirection:'column',alignItems:'center',gap:6,fontSize:11,fontFamily:'Nunito',fontWeight:700,lineHeight:1.4,textAlign:'center'}}>
              <span style={{fontSize:24}}>{a.e}</span>{a.l}
            </button>
          ))}
        </div>
      </div>
    </AdminWrap>
  );
};
const AdminProductsPage = ({go}) => {
  const [search,  setSearch]  = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const filtered = PRODS.filter(p=>p.name.toLowerCase().includes(search.toLowerCase())||p.art.toLowerCase().includes(search.toLowerCase()));

  const syncGBS = () => {
    setSyncMsg('loading');
    setTimeout(()=>setSyncMsg('ok'),1800);
    setTimeout(()=>setSyncMsg(''),4500);
  };

  return (
    <AdminWrap go={go} title="Товары" subtitle={`${PRODS.length} позиций · обновление по артикулу KAK-XXXX`}>
      <div style={{display:'flex',gap:10,marginBottom:14,alignItems:'center',flexWrap:'wrap'}}>
        <input className="ai" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск по названию или артикулу..." style={{width:300}}/>
        <div style={{marginLeft:'auto',display:'flex',gap:8}}>
          <button onClick={syncGBS} className="ab abg" style={{display:'flex',alignItems:'center',gap:6}}>
            {syncMsg==='loading'?<div style={{width:14,height:14,borderRadius:'50%',border:'2px solid rgba(31,215,96,.3)',borderTopColor:'#1FD760',animation:'spin 1s linear infinite'}}/>:'🔄'}
            {syncMsg==='ok'?'✓ Синхронизировано':'Синх. с GBS Market'}
          </button>
          <button onClick={()=>setShowAdd(true)} className="ab abp">+ Добавить</button>
        </div>
      </div>
      {syncMsg==='ok'&&<div style={{padding:'9px 13px',borderRadius:10,background:'rgba(31,215,96,.08)',border:'1px solid rgba(31,215,96,.25)',fontSize:12,color:'#1FD760',marginBottom:12}}>✓ Товары обновлены по артикулам KAK-XXXX из GBS Market. Последняя синхронизация: только что.</div>}
      <div className="ac">
        <table className="at">
          <thead><tr><th>Артикул</th><th>Товар</th><th>Категория</th><th>Цена</th><th>Скидка</th><th>Хит</th><th>Рейтинг</th><th></th></tr></thead>
          <tbody>
            {filtered.map(p=>(
              <tr key={p.id}>
                <td><span style={{fontFamily:'Unbounded',fontSize:11,fontWeight:800,color:'#FFB800',letterSpacing:.5}}>{p.art}</span></td>
                <td>
                  <div style={{display:'flex',alignItems:'center',gap:9}}>
                    <div style={{width:34,height:34,borderRadius:9,background:p.grad,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>{p.e}</div>
                    <span style={{fontWeight:700}}>{p.name}</span>
                  </div>
                </td>
                <td style={{color:'#8FB897',fontSize:12}}>{p.cat}</td>
                <td><span style={{fontFamily:'Unbounded',fontWeight:800}}>{p.price.toFixed(2)}<span style={{fontSize:9,color:'#FFB800',marginLeft:2}}>ЅМ</span></span></td>
                <td style={{color:p.old?'#FF4545':'#3D6645'}}>{p.old?`-${Math.round((1-p.price/p.old)*100)}%`:'—'}</td>
                <td>
                  <div style={{width:34,height:20,borderRadius:10,background:p.hot?'#1FD760':'#1D3822',position:'relative',cursor:'pointer'}}>
                    <div style={{position:'absolute',top:2,left:p.hot?16:2,width:16,height:16,borderRadius:'50%',background:'white',transition:'left .2s'}}/>
                  </div>
                </td>
                <td style={{color:'#FFB800'}}>★ {p.r}</td>
                <td>
                  <div style={{display:'flex',gap:6}}>
                    <button className="ab abg" style={{padding:'4px 10px',fontSize:11}}>✏️</button>
                    <button className="ab abd" style={{padding:'4px 10px',fontSize:11}}>🗑</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd&&(
        <div className="amod">
          <div className="amodbg" onClick={()=>setShowAdd(false)}/>
          <div className="amodbox">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={{fontFamily:'Unbounded',fontSize:15,fontWeight:800}}>Добавить товар</div>
              <button onClick={()=>setShowAdd(false)} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div style={{display:'grid',gridTemplateColumns:'130px 1fr',gap:12}}>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Артикул GBS</div><input className="ai" placeholder="KAK-0013"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Название *</div><input className="ai" placeholder="Название товара"/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'70px 1fr 1fr 1fr',gap:12}}>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Emoji</div><input className="ai" defaultValue="🛒" style={{textAlign:'center',fontSize:22,height:48}}/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Цена (ЅМ)*</div><input className="ai" type="number" placeholder="0.00"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Категория</div>
                  <select className="ai" style={{cursor:'pointer'}}>
                    {CATS.map(c=><option key={c.id} value={c.id}>{c.e} {c.label}</option>)}
                  </select>
                </div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Фасовка</div><input className="ai" placeholder="500 гр"/></div>
              </div>
              <div style={{display:'flex',gap:10,marginTop:4}}>
                <button className="ab abp" style={{flex:1,padding:12}}>✓ Сохранить</button>
                <button className="ab abg" onClick={()=>setShowAdd(false)}>Отмена</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminWrap>
  );
};
const CARDS_DATA = [
  {num:'КАКАПО-0001',client:'Диловар Рахимов',  phone:'+992 93 456 78 90',status:'active',  level:'platinum',bonus:4850,debtLimit:3000,debt:1200,issued:'01.01.2022'},
  {num:'КАКАПО-0042',client:'Нилуфар Хасанова', phone:'+992 90 123 45 67',status:'active',  level:'gold',    bonus:1240,debtLimit:1000,debt:0,   issued:'15.03.2023'},
  {num:'КАКАПО-0118',client:'Бахром Каримов',   phone:'+992 88 789 01 23',status:'active',  level:'silver',  bonus:560, debtLimit:0,   debt:0,   issued:'10.06.2023'},
  {num:'КАКАПО-0007',client:'Мадина Олимова',   phone:'+992 93 321 65 43',status:'active',  level:'bronze',  bonus:120, debtLimit:0,   debt:0,   issued:'22.09.2023'},
  {num:'КАКАПО-0234',client:'Зафар Мирзоев',    phone:'+992 91 654 32 10',status:'active',  level:'gold',    bonus:2100,debtLimit:2000,debt:4500,issued:'05.02.2023'},
  {num:'КАКАПО-0099',client:'',                 phone:'',                  status:'unlinked',level:'',       bonus:0,   debtLimit:0,   debt:0,   issued:'01.05.2024'},
  {num:'КАКАПО-0100',client:'',                 phone:'',                  status:'unlinked',level:'',       bonus:0,   debtLimit:0,   debt:0,   issued:'01.05.2024'},
  {num:'КАКАПО-0055',client:'Рустам Давлатов',  phone:'+992 90 445 23 11',status:'blocked', level:'gold',    bonus:2100,debtLimit:0,   debt:0,   issued:'10.11.2022'},
];
const LVC = {bronze:'#CD7F32',silver:'#C0C0C0',gold:'#FFB800',platinum:'#3B8EF0'};

const AdminCardsPage = ({go}) => {
  const [search,  setSearch]  = useState('');
  const [filter,  setFilter]  = useState('all');
  const [sel,     setSel]     = useState(null);
  const [showGen, setShowGen] = useState(false);
  const [showLink,setShowLink]= useState(null);
  const [genN,    setGenN]    = useState(10);
  const [gened,   setGened]   = useState(false);
  const [lPhone,  setLPhone]  = useState('');
  const [lLimit,  setLLimit]  = useState('0');
  const [lLevel,  setLLevel]  = useState('bronze');

  const filtered = CARDS_DATA.filter(c=>{
    const q=search.toLowerCase();
    return (!search||c.num.toLowerCase().includes(q)||c.client.toLowerCase().includes(q)||c.phone.includes(q))
      &&(filter==='all'||c.status===filter);
  });

  const Sbadge = ({s}) => {
    const m={active:{l:'Активна',c:'#1FD760'},unlinked:{l:'Не привязана',c:'#FFB800'},blocked:{l:'Заблокирована',c:'#FF4545'}};
    const x=m[s]||m.active;
    return <span style={{padding:'2px 8px',borderRadius:8,fontSize:10,fontWeight:800,background:`${x.c}18`,color:x.c,border:`1px solid ${x.c}30`}}>{x.l}</span>;
  };

  return (
    <AdminWrap go={go} title="Карты" subtitle="Управление картами лояльности КАКАПО">
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        {[
          {l:'Всего карт',   v:CARDS_DATA.length,                                    c:'#1FD760'},
          {l:'Активных',     v:CARDS_DATA.filter(c=>c.status==='active').length,     c:'#3B8EF0'},
          {l:'Не привязано', v:CARDS_DATA.filter(c=>c.status==='unlinked').length,   c:'#FFB800'},
          {l:'Заблокировано',v:CARDS_DATA.filter(c=>c.status==='blocked').length,    c:'#FF4545'},
        ].map((s,i)=>(
          <div key={i} className="ac" style={{padding:'14px 16px'}}>
            <div style={{fontSize:10,color:'#8FB897',marginBottom:6}}>{s.l}</div>
            <div style={{fontFamily:'Unbounded',fontSize:22,fontWeight:900,color:s.c}}>{s.v}</div>
          </div>
        ))}
      </div>

      <div style={{display:'flex',gap:10,marginBottom:14,alignItems:'center',flexWrap:'wrap'}}>
        <input className="ai" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Номер карты, клиент, телефон..." style={{width:280}}/>
        <div style={{display:'flex',gap:6}}>
          {[{id:'all',l:'Все'},{id:'active',l:'Активные'},{id:'unlinked',l:'Не привязаны'},{id:'blocked',l:'Заблок.'}].map(f=>(
            <button key={f.id} onClick={()=>setFilter(f.id)} className="ab"
              style={{padding:'7px 12px',fontSize:11,background:filter===f.id?'rgba(31,215,96,.12)':'#0C1C0F',border:`1.5px solid ${filter===f.id?'rgba(31,215,96,.35)':'#162B1A'}`,color:filter===f.id?'#1FD760':'#8FB897'}}>
              {f.l}
            </button>
          ))}
        </div>
        <button onClick={()=>setShowGen(true)} className="ab abp" style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:6}}>
          🃏 Генерировать карты
        </button>
      </div>

      <div className="ac">
        <table className="at">
          <thead><tr><th>Номер карты</th><th>Клиент</th><th>Телефон</th><th>Статус</th><th>Уровень</th><th>Бонусы</th><th>Лимит долга</th><th>Долг</th><th>Действия</th></tr></thead>
          <tbody>
            {filtered.map((c,i)=>(
              <tr key={i} onClick={()=>setSel(c)}>
                <td><span style={{fontFamily:'Unbounded',fontSize:11,fontWeight:800,color:'#FFB800',letterSpacing:.5}}>{c.num}</span></td>
                <td style={{fontWeight:600}}>{c.client||<span style={{color:'#3D6645',fontStyle:'italic'}}>Не привязана</span>}</td>
                <td style={{color:'#8FB897',fontSize:12}}>{c.phone||'—'}</td>
                <td><Sbadge s={c.status}/></td>
                <td>{c.level?<span style={{padding:'2px 8px',borderRadius:8,fontSize:10,fontWeight:800,color:LVC[c.level],background:`${LVC[c.level]}18`,border:`1px solid ${LVC[c.level]}30`}}>{c.level}</span>:'—'}</td>
                <td style={{fontWeight:700,color:'#FFB800'}}>{c.bonus>0?`${c.bonus.toLocaleString()} ⭐`:'—'}</td>
                <td style={{color:c.debtLimit>0?'#1FD760':'#3D6645',fontWeight:c.debtLimit>0?700:400}}>{c.debtLimit>0?`${c.debtLimit.toLocaleString()} ЅМ`:'Нет'}</td>
                <td style={{color:c.debt>0?'#FF4545':'#3D6645',fontWeight:c.debt>0?800:400}}>{c.debt>0?`${c.debt.toLocaleString()} ЅМ`:'—'}</td>
                <td onClick={e=>e.stopPropagation()}>
                  <div style={{display:'flex',gap:5}}>
                    {c.status==='unlinked'&&<button onClick={()=>{setShowLink(c);setLPhone('');}} className="ab abp" style={{padding:'4px 9px',fontSize:10}}>🔗 Привязать</button>}
                    {c.status==='active'  &&<button onClick={()=>{setShowLink(c);setLPhone(c.phone);setLLimit(String(c.debtLimit));setLLevel(c.level);}} className="ab abg" style={{padding:'4px 9px',fontSize:10}}>✏️</button>}
                    {c.status!=='blocked' &&<button className="ab abd" style={{padding:'4px 9px',fontSize:10}}>🚫</button>}
                    {c.status==='blocked' &&<button className="ab abg" style={{padding:'4px 9px',fontSize:10}}>✓ Разблок</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sel&&(
        <div className="amod">
          <div className="amodbg" onClick={()=>setSel(null)}/>
          <div className="amodbox" style={{maxWidth:440}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:800}}>Карта {sel.num}</div>
              <button onClick={()=>setSel(null)} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
            </div>
            <div style={{background:'linear-gradient(135deg,#071A0A,#0F3018)',border:'1.5px solid rgba(31,215,96,.3)',borderRadius:14,padding:16,marginBottom:14,textAlign:'center',position:'relative',overflow:'hidden'}}>
              <div style={{position:'absolute',left:0,right:0,height:1,background:'linear-gradient(90deg,transparent,rgba(31,215,96,.5),transparent)',animation:'scanLine 3s linear infinite'}}/>
              <div style={{fontFamily:'Unbounded',fontSize:10,color:'#1FD760',marginBottom:8}}>КАКАПО LOYALTY CARD</div>
              <div style={{width:80,height:80,margin:'0 auto 8px',background:'#030B05',borderRadius:8,display:'grid',gridTemplateColumns:'repeat(10,1fr)',gap:1,padding:6,border:'1px solid rgba(31,215,96,.2)'}}>
                {Array.from({length:100},(_,idx)=>{const b=(idx<3||idx>96)||(idx%10===0||idx%10===9)||(Math.floor(idx/10)<3&&idx%10<3)||(Math.floor(idx/10)>6&&idx%10<3);return <div key={idx} style={{borderRadius:1,background:b?'#EBF5ED':'transparent'}}/>;})}
              </div>
              <div style={{fontFamily:'Unbounded',fontSize:13,fontWeight:900,color:'#FFB800',letterSpacing:2}}>{sel.num}</div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:9,marginBottom:14}}>
              {[
                {l:'Клиент',    v:sel.client||'Не привязана',c:sel.client?'#EBF5ED':'#3D6645'},
                {l:'Телефон',   v:sel.phone||'—',            c:'#8FB897'},
                {l:'Уровень',   v:sel.level||'—',            c:sel.level?LVC[sel.level]:'#3D6645'},
                {l:'Бонусов',   v:sel.bonus>0?`${sel.bonus.toLocaleString()} ⭐`:'0', c:'#FFB800'},
                {l:'Лимит долга',v:sel.debtLimit>0?`${sel.debtLimit.toLocaleString()} ЅМ`:'Нет', c:sel.debtLimit>0?'#1FD760':'#3D6645'},
                {l:'Долг',      v:sel.debt>0?`${sel.debt.toLocaleString()} ЅМ`:'—', c:sel.debt>0?'#FF4545':'#3D6645'},
              ].map((r,i)=>(
                <div key={i} style={{background:'#0C1C0F',borderRadius:10,padding:'10px 12px',border:'1px solid #162B1A'}}>
                  <div style={{fontSize:10,color:'#3D6645',marginBottom:3,fontWeight:700,textTransform:'uppercase'}}>{r.l}</div>
                  <div style={{fontSize:13,fontWeight:700,color:r.c}}>{r.v}</div>
                </div>
              ))}
            </div>
            <div style={{display:'flex',gap:10}}>
              <button className="ab abg" style={{flex:1,padding:10}}>✏️ Редактировать</button>
              <button className="ab abd" style={{flex:1,padding:10}}>🚫 Заблокировать</button>
            </div>
          </div>
        </div>
      )}

      {showLink&&(
        <div className="amod">
          <div className="amodbg" onClick={()=>setShowLink(null)}/>
          <div className="amodbox" style={{maxWidth:400}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:800}}>{showLink.status==='unlinked'?'Привязать карту':'Редактировать'}</div>
              <button onClick={()=>setShowLink(null)} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
            </div>
            <div style={{padding:'9px 13px',borderRadius:9,background:'rgba(255,184,0,.06)',border:'1px solid rgba(255,184,0,.2)',fontSize:12,color:'#FFB800',marginBottom:14,fontFamily:'Unbounded',letterSpacing:.5}}>{showLink.num}</div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div>
                <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Телефон клиента *</div>
                <input className="ai" value={lPhone} onChange={e=>setLPhone(e.target.value)} placeholder="+992 __ ___ __ __" type="tel"/>
                <div style={{fontSize:10,color:'#3D6645',marginTop:3}}>Клиент должен быть зарегистрирован в приложении</div>
              </div>
              <div>
                <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Лимит долга (ЅМ) — 0 = кредит запрещён</div>
                <input className="ai" value={lLimit} onChange={e=>setLLimit(e.target.value)} type="number" min="0"/>
              </div>
              <div>
                <div style={{fontSize:11,color:'#8FB897',marginBottom:8,fontWeight:700}}>Уровень лояльности</div>
                <div style={{display:'flex',gap:8}}>
                  {['bronze','silver','gold','platinum'].map(lv=>(
                    <button key={lv} onClick={()=>setLLevel(lv)} className="ab"
                      style={{flex:1,padding:'7px 4px',fontSize:10,color:LVC[lv],background:lLevel===lv?`${LVC[lv]}22`:`${LVC[lv]}0a`,border:`1.5px solid ${lLevel===lv?LVC[lv]:LVC[lv]+'30'}`}}>
                      {lv}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={()=>setShowLink(null)} className="ab abp" style={{width:'100%',padding:12,marginTop:4}}>
                🔗 {showLink.status==='unlinked'?'Привязать карту':'Сохранить изменения'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showGen&&(
        <div className="amod">
          <div className="amodbg" onClick={()=>{setShowGen(false);setGened(false);}}/>
          <div className="amodbox" style={{maxWidth:360}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:800}}>Генерация карт</div>
              <button onClick={()=>{setShowGen(false);setGened(false);}} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
            </div>
            {!gened?(
              <>
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Количество карт</div>
                  <input className="ai" value={genN} onChange={e=>setGenN(e.target.value)} type="number" min="1" max="500"/>
                </div>
                <div style={{padding:'10px 13px',borderRadius:10,background:'rgba(255,184,0,.06)',border:'1px solid rgba(255,184,0,.2)',fontSize:12,color:'#8FB897',marginBottom:14}}>
                  <div style={{fontWeight:700,color:'#FFB800',marginBottom:4}}>Будет создано:</div>
                  КАКАПО-{String(CARDS_DATA.length+1).padStart(4,'0')} – КАКАПО-{String(CARDS_DATA.length+Number(genN)).padStart(4,'0')}
                </div>
                <button onClick={()=>setGened(true)} className="ab abp" style={{width:'100%',padding:12}}>🃏 Сгенерировать {genN} карт</button>
              </>
            ):(
              <div style={{textAlign:'center',padding:'8px 0'}}>
                <div style={{fontSize:36,marginBottom:10}}>✅</div>
                <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:800,color:'#1FD760',marginBottom:6}}>{genN} карт создано!</div>
                <div style={{fontSize:12,color:'#8FB897',marginBottom:14}}>Карты готовы к выдаче. Привяжи карту к клиенту после выдачи.</div>
                <button className="ab abg" style={{width:'100%',padding:11,marginBottom:8}}>📄 Скачать PDF для печати</button>
                <button onClick={()=>{setShowGen(false);setGened(false);}} className="ab" style={{width:'100%',padding:10,background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897'}}>Закрыть</button>
              </div>
            )}
          </div>
        </div>
      )}
    </AdminWrap>
  );
};
const AdminSettingsPage = ({go}) => {
  const [tab,    setTab]    = useState('gbs');
  const [gbsIP,  setGbsIP]  = useState('http://192.168.1.100');
  const [gbsPort,setGbsPort]= useState('8419');
  const [gbsUser,setGbsUser]= useState('admin');
  const [gbsPass,setGbsPass]= useState('');
  const [gbsMin, setGbsMin] = useState('2');
  const [gbsOn,  setGbsOn]  = useState(false);
  const [testSt, setTestSt] = useState('');
  const [saved,  setSaved]  = useState(false);
  const [smsP,   setSmsP]   = useState('smspro');
  const [smsKey, setSmsKey] = useState('');
  const [mapsKey,setMapsKey]= useState('');
  const [fbKey,  setFbKey]  = useState('');
  const [basePr, setBasePr] = useState('5');
  const [freeAm, setFreeAm] = useState('30');
  const [perKm,  setPerKm]  = useState('1.5');
  const [freeKm, setFreeKm] = useState('2');

  const testConn = () => {
    setTestSt('loading');
    setTimeout(()=>setTestSt('ok'),1800);
    setTimeout(()=>setTestSt(''),5000);
  };
  const saveAll = () => { setSaved(true); setTimeout(()=>setSaved(false),2500); };

  const NI = ({lbl,val,set,ph='',type='text',suf=''}) => (
    <div>
      <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>{lbl}</div>
      <div style={{position:'relative'}}>
        <input className="ai" type={type} value={val} onChange={e=>set(e.target.value)} placeholder={ph} style={{paddingRight:suf?38:13}}/>
        {suf&&<span style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',fontSize:11,color:'#3D6645',fontWeight:700}}>{suf}</span>}
      </div>
    </div>
  );

  const TABS = [
    {id:'gbs',      l:'🔗 GBS Market'},
    {id:'cards',    l:'💳 Карты'},
    {id:'delivery', l:'🚚 Доставка'},
    {id:'sms',      l:'💬 SMS'},
    {id:'maps',     l:'🗺 Карты/GPS'},
    {id:'push',     l:'🔔 Push'},
    {id:'store',    l:'🏪 Магазин'},
  ];

  return (
    <AdminWrap go={go} title="Настройки" subtitle="Конфигурация и интеграции КАКАПО">
      <div style={{display:'flex',gap:8,marginBottom:20,flexWrap:'wrap',alignItems:'center'}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} className="ab"
            style={{padding:'8px 14px',fontSize:12,background:tab===t.id?'rgba(31,215,96,.12)':'#0C1C0F',border:`1.5px solid ${tab===t.id?'rgba(31,215,96,.35)':'#162B1A'}`,color:tab===t.id?'#1FD760':'#8FB897'}}>
            {t.l}
          </button>
        ))}
        <button onClick={saveAll} className="ab abp" style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:6}}>
          {saved?'✓ Сохранено!':'💾 Сохранить всё'}
        </button>
      </div>

      {tab==='gbs'&&(
        <div style={{display:'grid',gridTemplateColumns:'1.3fr 1fr',gap:18}}>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div className="ac" style={{padding:20}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
                <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:800}}>JSON API · GBS Market</div>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontSize:12,color:gbsOn?'#1FD760':'#3D6645',fontWeight:700}}>{gbsOn?'Активно':'Выключено'}</span>
                  <div onClick={()=>setGbsOn(v=>!v)} style={{width:44,height:24,borderRadius:12,background:gbsOn?'#1FD760':'#1D3822',position:'relative',cursor:'pointer',transition:'background .2s',flexShrink:0}}>
                    <div style={{position:'absolute',top:3,left:gbsOn?23:3,width:18,height:18,borderRadius:'50%',background:'white',transition:'left .2s'}}/>
                  </div>
                </div>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:12}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 100px',gap:10}}>
                  <NI lbl="IP адрес кассы" val={gbsIP}   set={setGbsIP}   ph="http://192.168.1.100"/>
                  <NI lbl="Порт"           val={gbsPort} set={setGbsPort} ph="8419"/>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                  <NI lbl="Логин" val={gbsUser} set={setGbsUser}/>
                  <NI lbl="Пароль" val={gbsPass} set={setGbsPass} type="password" ph="••••••••"/>
                </div>
                <NI lbl="Интервал синхронизации" val={gbsMin} set={setGbsMin} type="number" suf="мин"/>
              </div>
              <button onClick={testConn} className="ab" style={{width:'100%',marginTop:14,padding:11,background:'rgba(59,142,240,.1)',border:'1.5px solid rgba(59,142,240,.3)',color:'#3B8EF0',display:'flex',alignItems:'center',justifyContent:'center',gap:8,fontSize:13}}>
                {testSt==='loading'?<><div style={{width:16,height:16,borderRadius:'50%',border:'2px solid rgba(59,142,240,.3)',borderTopColor:'#3B8EF0',animation:'spin 1s linear infinite'}}/>Проверка...</>
                :testSt==='ok'?'✅ Соединение установлено!'
                :'🔌 Проверить соединение'}
              </button>
            </div>

            <div className="ac" style={{padding:18}}>
              <div style={{fontFamily:'Unbounded',fontSize:13,fontWeight:800,marginBottom:14}}>Что синхронизируется</div>
              {[
                {e:'🥦',l:'Товары по артикулу',    d:'Цены и наличие обновляются по KAK-XXXX',on:true},
                {e:'💳',l:'Продажи по карте',       d:'Чек → бонусы + история в профиле клиента',on:true},
                {e:'💰',l:'Долги клиентов',          d:'Отрицательный баланс → раздел VIP',on:true},
                {e:'👤',l:'Новые клиенты с кассы',  d:'Авторегистрация при первой покупке по карте',on:false},
              ].map((s,i,arr)=>(
                <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 0',borderBottom:i<arr.length-1?'1px solid #162B1A':'none'}}>
                  <span style={{fontSize:20,flexShrink:0}}>{s.e}</span>
                  <div style={{flex:1}}><div style={{fontSize:13,fontWeight:700}}>{s.l}</div><div style={{fontSize:11,color:'#3D6645',marginTop:1}}>{s.d}</div></div>
                  <div style={{width:36,height:20,borderRadius:10,background:s.on?'#1FD760':'#1D3822',position:'relative',cursor:'pointer',flexShrink:0}}>
                    <div style={{position:'absolute',top:2,left:s.on?17:2,width:16,height:16,borderRadius:'50%',background:'white',transition:'left .2s'}}/>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div className="ac" style={{padding:18}}>
              <div style={{fontFamily:'Unbounded',fontSize:13,fontWeight:800,marginBottom:14}}>Статус синхронизации</div>
              {[
                {l:'Последний запрос',    v:'Сегодня 14:22',    c:'#1FD760'},
                {l:'Товаров обновлено',   v:'12 позиций',       c:'#EBF5ED'},
                {l:'Чеков обработано',    v:'48 сегодня',       c:'#FFB800'},
                {l:'Бонусов начислено',   v:'+1 240 ⭐',        c:'#FFB800'},
                {l:'Следующий запрос',    v:`Через ${gbsMin} мин`, c:'#3B8EF0'},
              ].map((r,i)=>(
                <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:i<4?'1px solid #162B1A':'none'}}>
                  <span style={{fontSize:11,color:'#8FB897'}}>{r.l}</span>
                  <span style={{fontSize:12,fontWeight:700,color:r.c}}>{r.v}</span>
                </div>
              ))}
            </div>
            <div style={{padding:'14px 16px',borderRadius:14,background:'rgba(31,215,96,.05)',border:'1px solid rgba(31,215,96,.2)'}}>
              <div style={{fontSize:12,fontWeight:800,color:'#1FD760',marginBottom:10}}>📋 Инструкция по настройке</div>
              {[
                '1. GBS Market → Настройки → Интеграции',
                '2. Поставить ✓ "Активировать API"',
                '3. Записать IP адрес компьютера кассы',
                '4. Вставить IP выше и нажать "Проверить соединение"',
                '5. Включить синхронизацию тумблером',
                '6. Товары и чеки начнут синхронизироваться автоматически',
              ].map((s,i)=>(
                <div key={i} style={{fontSize:11,color:'#8FB897',marginBottom:5,paddingLeft:4,lineHeight:1.5}}>{s}</div>
              ))}
            </div>
          </div>
        </div>
      )}
      {tab==='cards'&&(
        <div className="ac" style={{padding:20,maxWidth:560}}>
          <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:800,marginBottom:18}}>Настройки карт лояльности</div>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            {[
              {e:'💳',l:'Начислять бонусы при оплате картой',on:true},
              {e:'📦',l:'Показывать покупки из магазина в истории',on:true},
              {e:'💰',l:'Синхронизировать долги с GBS Market',on:true},
              {e:'🎁',l:'Бонус за первую привязку карты',on:true},
            ].map((s,i,arr)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:14,padding:'12px 0',borderBottom:i<arr.length-1?'1px solid #162B1A':'none'}}>
                <span style={{fontSize:22,flexShrink:0}}>{s.e}</span>
                <span style={{flex:1,fontSize:13,fontWeight:600}}>{s.l}</span>
                <div style={{width:40,height:22,borderRadius:11,background:s.on?'#1FD760':'#1D3822',position:'relative',cursor:'pointer',flexShrink:0}}>
                  <div style={{position:'absolute',top:2,left:s.on?19:2,width:18,height:18,borderRadius:'50%',background:'white',transition:'left .2s'}}/>
                </div>
              </div>
            ))}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginTop:4}}>
              <NI lbl="Бонус за Bronze (%)" val="1" set={()=>{}} type="number" suf="%"/>
              <NI lbl="Бонус за Silver (%)" val="2" set={()=>{}} type="number" suf="%"/>
              <NI lbl="Бонус за Gold (%)"   val="3" set={()=>{}} type="number" suf="%"/>
              <NI lbl="Бонус за Platinum (%)"val="5" set={()=>{}} type="number" suf="%"/>
            </div>
          </div>
        </div>
      )}

      {tab==='delivery'&&(
        <div className="ac" style={{padding:20,maxWidth:560}}>
          <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:800,marginBottom:18}}>Настройки доставки</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
            <NI lbl="Базовая цена (ЅМ)"   val={basePr} set={setBasePr} type="number" suf="ЅМ"/>
            <NI lbl="Бесплатно от (ЅМ)"   val={freeAm} set={setFreeAm} type="number" suf="ЅМ"/>
            <NI lbl="Цена за 1 км"         val={perKm}  set={setPerKm}  type="number" suf="ЅМ"/>
            <NI lbl="Бесплатный радиус"    val={freeKm} set={setFreeKm} type="number" suf="км"/>
          </div>
          <div style={{marginTop:14,padding:'12px 14px',borderRadius:12,background:'rgba(255,184,0,.07)',border:'1px solid rgba(255,184,0,.2)',fontSize:12,color:'#8FB897'}}>
            💡 Пример: Заказ 25 ЅМ, 3.5 км → {basePr} + {(Math.max(0,3.5-Number(freeKm))*Number(perKm)).toFixed(2)} = <span style={{color:'#FFB800',fontWeight:700}}>{(Number(basePr)+Math.max(0,3.5-Number(freeKm))*Number(perKm)).toFixed(2)} ЅМ</span>
          </div>
        </div>
      )}

      {tab==='sms'&&(
        <div className="ac" style={{padding:20,maxWidth:520}}>
          <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:800,marginBottom:18}}>SMS провайдер (OTP авторизация)</div>
          <div style={{display:'flex',gap:8,marginBottom:16}}>
            {[{id:'smspro',l:'🇹🇯 SmsPro.tj'},{id:'eskiz',l:'🇺🇿 Eskiz'},{id:'twilio',l:'🌍 Twilio'}].map(p=>(
              <button key={p.id} onClick={()=>setSmsP(p.id)} className="ab"
                style={{flex:1,padding:'10px 8px',fontSize:12,background:smsP===p.id?'rgba(31,215,96,.12)':'#0C1C0F',border:`1.5px solid ${smsP===p.id?'rgba(31,215,96,.35)':'#162B1A'}`,color:smsP===p.id?'#1FD760':'#8FB897'}}>
                {p.l}
              </button>
            ))}
          </div>
          <NI lbl="API ключ" val={smsKey} set={setSmsKey} ph="Вставь ключ от провайдера"/>
          <div style={{marginTop:10,padding:'10px 13px',borderRadius:10,background:'rgba(59,142,240,.06)',border:'1px solid rgba(59,142,240,.2)',fontSize:12,color:'#8FB897'}}>
            Для Таджикистана рекомендуем <span style={{color:'#3B8EF0',fontWeight:700}}>SmsPro.tj</span> — местный провайдер. После добавления ключа — демо-код 1234 заменится на реальный SMS.
          </div>
        </div>
      )}

      {tab==='maps'&&(
        <div className="ac" style={{padding:20,maxWidth:520}}>
          <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:800,marginBottom:18}}>Карты и геолокация</div>
          <NI lbl="Google Maps API Key" val={mapsKey} set={setMapsKey} ph="AIzaSy..."/>
          <div style={{marginTop:12,display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <NI lbl="Широта магазина (lat)" val="38.5500" set={()=>{}} ph="38.5500"/>
            <NI lbl="Долгота магазина (lng)" val="69.1400" set={()=>{}} ph="69.1400"/>
          </div>
          <div style={{marginTop:10,padding:'10px 13px',borderRadius:10,background:'rgba(31,215,96,.06)',border:'1px solid rgba(31,215,96,.2)',fontSize:12,color:'#8FB897'}}>
            После добавления API ключа — карта при оформлении заказа и трекинг курьера станут настоящими.
          </div>
        </div>
      )}

      {tab==='push'&&(
        <div className="ac" style={{padding:20,maxWidth:520}}>
          <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:800,marginBottom:18}}>Firebase Push Notifications</div>
          <NI lbl="Firebase Server Key" val={fbKey} set={setFbKey} ph="AAAAxxxxxxx..."/>
          <div style={{marginTop:14,display:'flex',flexDirection:'column',gap:0}}>
            {[{l:'Push при новом заказе',on:true},{l:'Push когда курьер выехал',on:true},{l:'Push при доставке',on:true},{l:'Push на акции',on:false}].map((r,i,arr)=>(
              <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'11px 0',borderBottom:i<arr.length-1?'1px solid #162B1A':'none'}}>
                <span style={{fontSize:13,fontWeight:600}}>{r.l}</span>
                <div style={{width:40,height:22,borderRadius:11,background:r.on?'#1FD760':'#1D3822',position:'relative',cursor:'pointer',flexShrink:0}}>
                  <div style={{position:'absolute',top:2,left:r.on?19:2,width:18,height:18,borderRadius:'50%',background:'white',transition:'left .2s'}}/>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab==='store'&&(
        <div className="ac" style={{padding:20,maxWidth:520}}>
          <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:800,marginBottom:18}}>Информация о магазине</div>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {[{l:'Название',v:'КАКАПО'},{l:'Город',v:'г. Яван, Таджикистан'},{l:'Адрес',v:'ул. Ленина, 42'},{l:'Телефон 1',v:'+992 118 55-97-97'},{l:'Телефон 2',v:'+992 553 55-98-98'},{l:'Email',v:'kakapo.tj@gmail.com'},{l:'Telegram',v:'@kakapo_tj'},{l:'Instagram',v:'@kakapo.tj'}].map((r,i)=>(
              <NI key={i} lbl={r.l} val={r.v} set={()=>{}}/>
            ))}
          </div>
        </div>
      )}
    </AdminWrap>
  );
};
const AdminPromosPage = ({go}) => {
  const [promos, setPromos] = useState([
    {id:1, e:'🥛', title:'Молочная среда',   sub:'Скидка на всё молочное',      disc:30, cat:'dairy',  on:true,  type:'pct',  from:'08:00', to:'22:00', till:'Среда'},
    {id:2, e:'🥩', title:'Мясные выходные',  sub:'Скидки на мясо и птицу',      disc:25, cat:'meat',   on:true,  type:'pct',  from:'08:00', to:'22:00', till:'Сб–Вс'},
    {id:3, e:'🥦', title:'Органик-день',     sub:'Скидка на органик продукты',   disc:20, cat:'veg',    on:false, type:'pct',  from:'08:00', to:'22:00', till:'Пятница'},
    {id:4, e:'⚡', title:'Флэш-распродажа',  sub:'Только до 20:00 сегодня',      disc:40, cat:'all',    on:true,  type:'pct',  from:'10:00', to:'20:00', till:'Сегодня'},
    {id:5, e:'🚀', title:'Бесплатная доставка', sub:'При заказе от 30 ЅМ',      disc:0,  cat:'all',    on:true,  type:'free', from:'08:00', to:'22:00', till:'Всегда'},
    {id:6, e:'🎁', title:'Новый клиент',     sub:'Скидка на первый заказ',       disc:15, cat:'all',    on:true,  type:'first',from:'08:00', to:'22:00', till:'Всегда'},
  ]);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle,setNewTitle]= useState('');
  const [newDisc, setNewDisc] = useState('');
  const [newCat,  setNewCat]  = useState('all');
  const [newTill, setNewTill] = useState('');
  const [newEmoji,setNewEmoji]= useState('🎉');

  const toggle = (id) => setPromos(ps => ps.map(p => p.id===id ? {...p, on:!p.on} : p));
  const remove = (id) => setPromos(ps => ps.filter(p => p.id!==id));

  const Tog = ({on, onToggle}) => (
    <div onClick={onToggle} style={{width:44,height:24,borderRadius:12,background:on?'var(--gr)':'var(--b2)',position:'relative',cursor:'pointer',transition:'background .2s',flexShrink:0}}>
      <div style={{position:'absolute',top:3,left:on?23:3,width:18,height:18,borderRadius:'50%',background:'white',transition:'left .2s'}}/>
    </div>
  );

  return (
    <AdminWrap go={go} title="Акции" subtitle="Управление скидками и промо-акциями">
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        {[
          {l:'Всего акций',  v:promos.length,               c:'var(--t1)'},
          {l:'Активных',     v:promos.filter(p=>p.on).length,c:'var(--gr)'},
          {l:'Выключено',    v:promos.filter(p=>!p.on).length,c:'var(--red)'},
          {l:'Охват клиентов',v:'1 847',                    c:'var(--blue)'},
        ].map((s,i)=>(
          <div key={i} className="ac" style={{padding:'14px 16px'}}>
            <div style={{fontSize:10,color:'#8FB897',marginBottom:6}}>{s.l}</div>
            <div className="ub" style={{fontSize:22,fontWeight:900,color:s.c}}>{s.v}</div>
          </div>
        ))}
      </div>

      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:14}}>
        <button onClick={()=>setShowAdd(true)} className="ab abp" style={{display:'flex',alignItems:'center',gap:6}}>+ Добавить акцию</button>
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {promos.map(p=>(
          <div key={p.id} className="ac" style={{padding:'16px 18px',opacity:p.on?1:.65,transition:'opacity .2s'}}>
            <div style={{display:'flex',alignItems:'center',gap:14}}>
              <div style={{width:46,height:46,borderRadius:14,background:'var(--l3)',border:'1px solid var(--b1)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,flexShrink:0}}>{p.e}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
                  <span style={{fontSize:14,fontWeight:800}}>{p.title}</span>
                  {p.type==='pct'   && <span style={{padding:'2px 8px',borderRadius:8,fontSize:11,fontWeight:900,background:'rgba(255,69,69,.12)',color:'var(--red)',border:'1px solid rgba(255,69,69,.28)'}}>−{p.disc}%</span>}
                  {p.type==='free'  && <span style={{padding:'2px 8px',borderRadius:8,fontSize:11,fontWeight:900,background:'rgba(31,215,96,.12)',color:'var(--gr)',border:'1px solid rgba(31,215,96,.28)'}}>Бесплатно</span>}
                  {p.type==='first' && <span style={{padding:'2px 8px',borderRadius:8,fontSize:11,fontWeight:900,background:'rgba(59,142,240,.12)',color:'var(--blue)',border:'1px solid rgba(59,142,240,.28)'}}>Первый заказ</span>}
                </div>
                <div style={{fontSize:12,color:'#8FB897',marginBottom:2}}>{p.sub}</div>
                <div style={{display:'flex',gap:10,fontSize:11,color:'#3D6645'}}>
                  <span>📅 {p.till}</span>
                  <span>🕐 {p.from}–{p.to}</span>
                  <span>📦 {p.cat==='all'?'Все категории':p.cat}</span>
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
                <span style={{fontSize:11,color:p.on?'var(--gr)':'#3D6645',fontWeight:700}}>{p.on?'Активна':'Выкл.'}</span>
                <Tog on={p.on} onToggle={()=>toggle(p.id)}/>
                <button className="ab abg" style={{padding:'6px 11px',fontSize:11}}>✏️</button>
                <button onClick={()=>remove(p.id)} className="ab abd" style={{padding:'6px 11px',fontSize:11}}>🗑</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{marginTop:20}}>
        <div className="ub" style={{fontSize:14,fontWeight:800,marginBottom:12}}>Промокоды</div>
        <div className="ac" style={{overflow:'hidden'}}>
          <table className="at">
            <thead><tr><th>Промокод</th><th>Скидка</th><th>Использований</th><th>Действует до</th><th>Статус</th><th></th></tr></thead>
            <tbody>
              {[
                {code:'КАКАПО10',disc:'10%',used:124,till:'31 мая',on:true},
                {code:'YAVAN5',  disc:'5 ЅМ',used:89, till:'30 мая',on:true},
                {code:'SUMMER25',disc:'25%',used:12, till:'1 июня', on:false},
              ].map((c,i)=>(
                <tr key={i}>
                  <td><span className="ub" style={{fontSize:13,fontWeight:900,color:'var(--gr)',letterSpacing:1}}>{c.code}</span></td>
                  <td style={{fontWeight:700,color:'var(--red)',fontFamily:'Unbounded'}}>{c.disc}</td>
                  <td style={{color:'#8FB897'}}>{c.used} раз</td>
                  <td style={{color:'#8FB897',fontSize:12}}>{c.till}</td>
                  <td><Tog on={c.on} onToggle={()=>{}}/></td>
                  <td><button className="ab abd" style={{padding:'4px 9px',fontSize:11}}>🗑</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{padding:'12px 16px',borderTop:'1px solid #162B1A',display:'flex',gap:10}}>
            <input className="ai" placeholder="Новый промокод..." style={{flex:1}}/>
            <input className="ai" placeholder="Скидка %" type="number" style={{width:100}}/>
            <button className="ab abp" style={{padding:'8px 16px',fontSize:12,flexShrink:0}}>+ Создать</button>
          </div>
        </div>
      </div>

      {showAdd&&(
        <div className="amod">
          <div className="amodbg" onClick={()=>setShowAdd(false)}/>
          <div className="amodbox" style={{maxWidth:480}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
              <div className="ub" style={{fontSize:15,fontWeight:800}}>Новая акция</div>
              <button onClick={()=>setShowAdd(false)} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div style={{display:'grid',gridTemplateColumns:'70px 1fr',gap:12}}>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Emoji</div><input className="ai" value={newEmoji} onChange={e=>setNewEmoji(e.target.value)} style={{textAlign:'center',fontSize:26,height:50}}/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Название *</div><input className="ai" value={newTitle} onChange={e=>setNewTitle(e.target.value)} placeholder="Название акции"/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
                <div>
                  <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Тип акции</div>
                  <select className="ai" style={{cursor:'pointer'}}>
                    <option value="pct">% скидка</option>
                    <option value="free">Бесплатная доставка</option>
                    <option value="first">Первый заказ</option>
                    <option value="fixed">Фиксированная (ЅМ)</option>
                  </select>
                </div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Скидка (%)</div><input className="ai" value={newDisc} onChange={e=>setNewDisc(e.target.value)} type="number" placeholder="30"/></div>
                <div>
                  <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Категория</div>
                  <select className="ai" value={newCat} onChange={e=>setNewCat(e.target.value)} style={{cursor:'pointer'}}>
                    <option value="all">Все товары</option>
                    {CATS.map(c=><option key={c.id} value={c.id}>{c.e} {c.label}</option>)}
                  </select>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Начало</div><input className="ai" type="time" defaultValue="08:00"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Конец</div><input className="ai" type="time" defaultValue="22:00"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Действует до</div><input className="ai" value={newTill} onChange={e=>setNewTill(e.target.value)} placeholder="Напр: Среда"/></div>
              </div>
              <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Описание</div><input className="ai" placeholder="Короткое описание для клиентов"/></div>
              <div style={{display:'flex',gap:10,marginTop:4}}>
                <button onClick={()=>{
                  if(newTitle){
                    const newPromo = {id:Date.now(),e:newEmoji,title:newTitle,sub:'',disc:Number(newDisc),cat:newCat,on:true,type:'pct',from:'08:00',to:'22:00',till:newTill||'Всегда'};
                    setPromos(ps=>[...ps, newPromo]);
                    setShowAdd(false); setNewTitle(''); setNewDisc('');
                  }
                }} className="ab abp" style={{flex:1,padding:12}}>✓ Создать акцию</button>
                <button onClick={()=>setShowAdd(false)} className="ab abg">Отмена</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminWrap>
  );
};
const AdminBannersPage = ({go}) => {
  const [banners, setBanners] = useState([
    {id:1,badge:'ПЯТНИЦА',   title:'Органик-день',       sub:'20% на органические продукты',  disc:20, e:'🥦', bg:'linear-gradient(135deg,#0A2A0A,#1A4A1A)', ac:'#1FD760', on:true},
    {id:2,badge:'ХИТЫ',      title:'Молочная среда',     sub:'Скидка 30% на всё молочное',     disc:30, e:'🥛', bg:'linear-gradient(135deg,#0D2040,#163460)', ac:'#3B8EF0', on:true},
    {id:3,badge:'ВЫХОДНЫЕ',  title:'Мясные выходные',    sub:'−25% на мясо и птицу',           disc:25, e:'🥩', bg:'linear-gradient(135deg,#2A0E0E,#501818)', ac:'#FF4545', on:true},
    {id:4,badge:'ФЛЭШ',      title:'Флэш до 20:00',      sub:'Успей купить — только сегодня',  disc:40, e:'⚡', bg:'linear-gradient(135deg,#1A1A0A,#3A3010)', ac:'#FFB800', on:false},
  ]);
  const [edit, setEdit] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const def = {badge:'',title:'',sub:'',disc:'',e:'🎁',bg:'linear-gradient(135deg,#0A1A0A,#1A3020)',ac:'#1FD760',on:true};
  const [form, setForm] = useState(def);
  const F = ({label,val,onChange,type='text'}) => (
    <div style={{marginBottom:10}}>
      <div style={{fontSize:11,color:'var(--t3)',marginBottom:4,fontWeight:700}}>{label}</div>
      <input className="inp" type={type} value={val} onChange={e=>onChange(e.target.value)} style={{width:'100%'}}/>
    </div>
  );
  const save = () => {
    if(!form.title.trim()) return;
    if(edit!==null) {
      setBanners(bs=>bs.map(b=>b.id===edit?{...b,...form,disc:Number(form.disc)}:b));
      setEdit(null);
    } else {
      setBanners(bs=>[...bs,{...form,id:Date.now(),disc:Number(form.disc)}]);
      setShowAdd(false);
    }
    setForm(def);
  };
  const startEdit = (b) => { setForm({...b,disc:String(b.disc)}); setEdit(b.id); setShowAdd(true); };
  const remove = (id) => setBanners(bs=>bs.filter(b=>b.id!==id));
  const toggle = (id) => setBanners(bs=>bs.map(b=>b.id===id?{...b,on:!b.on}:b));
  const move = (id,dir) => {
    const idx=banners.findIndex(b=>b.id===id);
    const nb=[...banners];
    const to=idx+dir;
    if(to<0||to>=nb.length) return;
    [nb[idx],nb[to]]=[nb[to],nb[idx]];
    setBanners(nb);
  };
  const Tog = ({on,onToggle}) => (
    <div onClick={onToggle} style={{width:40,height:22,borderRadius:11,background:on?'var(--gr)':'var(--b2)',position:'relative',cursor:'pointer',transition:'background .2s',flexShrink:0}}>
      <div style={{position:'absolute',top:2,left:on?20:2,width:18,height:18,borderRadius:'50%',background:'white',transition:'left .2s'}}/>
    </div>
  );
  return (
    <AdminWrap go={go} title="Баннеры" subtitle="Управление слайдером на главной и в акциях">
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:18}}>
        {[
          {l:'Всего баннеров', v:banners.length,              c:'var(--t1)'},
          {l:'Активных',       v:banners.filter(b=>b.on).length, c:'var(--gr)'},
          {l:'Скрытых',        v:banners.filter(b=>!b.on).length,c:'var(--t3)'},
        ].map((s,i)=>(
          <div key={i} style={{background:'var(--l2)',border:'1px solid var(--b1)',borderRadius:14,padding:'14px 12px',textAlign:'center'}}>
            <div style={{fontSize:22,fontWeight:900,color:s.c,fontFamily:'Unbounded'}}>{s.v}</div>
            <div style={{fontSize:10,color:'var(--t3)',marginTop:3}}>{s.l}</div>
          </div>
        ))}
      </div>

      <button onClick={()=>{setForm(def);setEdit(null);setShowAdd(s=>!s);}} className="btn" style={{width:'100%',padding:'11px',borderRadius:12,background:'linear-gradient(135deg,var(--gr2),var(--gr))',border:'none',color:'var(--bg)',fontFamily:'Unbounded',fontSize:12,fontWeight:800,marginBottom:16,display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>
        + Добавить баннер
      </button>

      {showAdd && (
        <div style={{background:'var(--l2)',border:'1px solid var(--b1)',borderRadius:16,padding:16,marginBottom:18}}>
          <div className="ub" style={{fontSize:13,fontWeight:800,marginBottom:14}}>{edit!==null?'✏️ Редактировать баннер':'➕ Новый баннер'}</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 12px'}}>
            <F label="Заголовок" val={form.title} onChange={v=>setForm(f=>({...f,title:v}))}/>
            <F label="Бейдж (ПЯТНИЦА, ФЛЭШ...)" val={form.badge} onChange={v=>setForm(f=>({...f,badge:v}))}/>
          </div>
          <F label="Подзаголовок" val={form.sub} onChange={v=>setForm(f=>({...f,sub:v}))}/>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'0 12px'}}>
            <F label="Скидка %" val={form.disc} onChange={v=>setForm(f=>({...f,disc:v}))} type="number"/>
            <F label="Эмодзи" val={form.e} onChange={v=>setForm(f=>({...f,e:v}))}/>
            <F label="Цвет акцента (hex)" val={form.ac} onChange={v=>setForm(f=>({...f,ac:v}))}/>
          </div>
          <F label="Фон (CSS gradient)" val={form.bg} onChange={v=>setForm(f=>({...f,bg:v}))}/>
          <div style={{display:'flex',gap:8,marginTop:4}}>
            <button onClick={save} className="btn" style={{flex:1,padding:'10px',borderRadius:11,background:'linear-gradient(135deg,var(--gr2),var(--gr))',border:'none',color:'var(--bg)',fontWeight:800,fontSize:13}}>Сохранить</button>
            <button onClick={()=>{setShowAdd(false);setEdit(null);setForm(def);}} className="btn" style={{padding:'10px 16px',borderRadius:11,background:'var(--l3)',border:'1px solid var(--b1)',color:'var(--t2)',fontSize:13}}>Отмена</button>
          </div>
        </div>
      )}

      {/* Preview */}
      {banners.map((b,idx)=>(
        <div key={b.id} style={{background:'var(--l2)',border:`1px solid ${b.on?'var(--b1)':'rgba(255,69,69,.25)'}`,borderRadius:16,marginBottom:12,overflow:'hidden',opacity:b.on?1:.7}}>
          <div style={{background:b.bg,padding:'14px 16px',display:'flex',justifyContent:'space-between',alignItems:'center',position:'relative'}}>
            <div>
              {b.badge&&<div style={{display:'inline-flex',alignItems:'center',gap:4,padding:'3px 10px',borderRadius:20,background:`${b.ac}22`,border:`1px solid ${b.ac}44`,color:b.ac,fontSize:10,fontWeight:800,marginBottom:6}}>✦ {b.badge}</div>}
              <div style={{fontFamily:'Unbounded',fontSize:16,fontWeight:900,color:'white',marginBottom:3}}>{b.title||'—'}</div>
              <div style={{fontSize:11,color:'rgba(255,255,255,.55)',marginBottom:8}}>{b.sub}</div>
              {b.disc>0&&<div style={{display:'inline-block',padding:'5px 14px',borderRadius:9,background:b.ac,color:'white',fontFamily:'Unbounded',fontSize:15,fontWeight:900}}>−{b.disc}%</div>}
            </div>
            <div style={{fontSize:38,flexShrink:0}}>{b.e}</div>
          </div>
          <div style={{padding:'10px 14px',display:'flex',alignItems:'center',gap:8}}>
            <Tog on={b.on} onToggle={()=>toggle(b.id)}/>
            <span style={{fontSize:11,color:b.on?'var(--gr)':'var(--t3)',fontWeight:700,flex:1}}>{b.on?'Активен':'Скрыт'}</span>
            <button onClick={()=>move(b.id,-1)} disabled={idx===0} className="btn" style={{width:30,height:30,borderRadius:8,background:'var(--l3)',border:'1px solid var(--b1)',color:'var(--t2)',fontSize:14,opacity:idx===0?.3:1}}>↑</button>
            <button onClick={()=>move(b.id,1)} disabled={idx===banners.length-1} className="btn" style={{width:30,height:30,borderRadius:8,background:'var(--l3)',border:'1px solid var(--b1)',color:'var(--t2)',fontSize:14,opacity:idx===banners.length-1?.3:1}}>↓</button>
            <button onClick={()=>startEdit(b)} className="btn" style={{padding:'6px 12px',borderRadius:8,background:'rgba(59,142,240,.15)',border:'1px solid rgba(59,142,240,.3)',color:'var(--blue)',fontSize:11,fontWeight:700}}>✏️</button>
            <button onClick={()=>remove(b.id)} className="btn" style={{padding:'6px 12px',borderRadius:8,background:'rgba(255,69,69,.12)',border:'1px solid rgba(255,69,69,.3)',color:'var(--red)',fontSize:11,fontWeight:700}}>✕</button>
          </div>
        </div>
      ))}
    </AdminWrap>
  );
};
const AdminPushPage = ({go}) => {
  const [target,  setTarget]  = useState('all');
  const [title,   setTitle]   = useState('');
  const [body,    setBody]    = useState('');
  const [sent,    setSent]    = useState(false);
  const [sending, setSending] = useState(false);

  const TARGETS = [
    {id:'all',      l:'Все клиенты',      n:'1 847'},
    {id:'vip',      l:'VIP клиенты',      n:'24'},
    {id:'gold',     l:'Gold и выше',      n:'390'},
    {id:'inactive', l:'Неактивные 30+ дней',n:'234'},
    {id:'debt',     l:'Клиенты с долгом', n:'3'},
  ];

  const TEMPLATES = [
    {e:'🔥',t:'Акция дня!',    b:'Скидки до 40% только сегодня! Заходи скорее →'},
    {e:'🚀',t:'Доставка бесплатно!',b:'Сегодня доставляем бесплатно при любом заказе 🎉'},
    {e:'🎁',t:'Бонусы истекают',b:'Ваши бонусы сгорят через 3 дня. Потратьте их!'},
    {e:'💳',t:'VIP привилегия',b:'Как VIP клиент вы получаете кредитный лимит 3 000 ЅМ'},
    {e:'⭐',t:'Оцените заказ',  b:'Расскажите как прошла доставка. Нам важно ваше мнение!'},
  ];

  const HISTORY = [
    {t:'Молочная среда! −30%',  to:'Все',    n:1847, open:34, time:'Среда 10:00'},
    {t:'Флэш-распродажа!',      to:'Gold+',  n:390,  open:58, time:'Вчера 12:00'},
    {t:'Акция выходного дня',   to:'Все',    n:1847, open:22, time:'Вс 09:00'},
    {t:'Бонусы истекают',       to:'Bronze', n:310,  open:41, time:'Пт 15:00'},
  ];

  const doSend = () => {
    if(!title||!body) return;
    setSending(true);
    setTimeout(()=>{setSending(false);setSent(true);}, 1400);
    setTimeout(()=>setSent(false), 5000);
  };

  const Tog = ({on}) => (
    <div style={{width:36,height:20,borderRadius:10,background:on?'var(--gr)':'#1D3822',position:'relative',cursor:'pointer',flexShrink:0}}>
      <div style={{position:'absolute',top:2,left:on?17:2,width:16,height:16,borderRadius:'50%',background:'white',transition:'left .2s'}}/>
    </div>
  );

  return (
    <AdminWrap go={go} title="Push уведомления" subtitle="Рассылка уведомлений клиентам">
      <div style={{display:'grid',gridTemplateColumns:'1.2fr 1fr',gap:18}}>
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <div className="ac" style={{padding:20}}>
            <div className="ub" style={{fontSize:14,fontWeight:800,marginBottom:16}}>Новое уведомление</div>

            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,color:'#8FB897',marginBottom:8,fontWeight:700}}>Получатели</div>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {TARGETS.map(t=>(
                  <div key={t.id} onClick={()=>setTarget(t.id)}
                    style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderRadius:11,background:target===t.id?'rgba(31,215,96,.08)':'#0C1C0F',border:`1.5px solid ${target===t.id?'rgba(31,215,96,.35)':'#162B1A'}`,cursor:'pointer'}}>
                    <div style={{width:18,height:18,borderRadius:'50%',border:`2px solid ${target===t.id?'var(--gr)':'#1D3822'}`,background:target===t.id?'var(--gr)':'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                      {target===t.id&&<svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="var(--bg)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                    </div>
                    <span style={{flex:1,fontSize:13,fontWeight:600,color:target===t.id?'var(--gr)':'var(--t1)'}}>{t.l}</span>
                    <span style={{fontSize:11,color:'#3D6645',fontWeight:700}}>{t.n} чел.</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:14}}>
              <div>
                <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Заголовок *</div>
                <input className="ai" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Краткий заголовок..."/>
              </div>
              <div>
                <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Текст уведомления *</div>
                <textarea value={body} onChange={e=>setBody(e.target.value)} placeholder="Текст сообщения..."
                  style={{background:'#0C1C0F',border:'1.5px solid #162B1A',borderRadius:10,color:'#EBF5ED',fontFamily:'Nunito,sans-serif',fontSize:13,resize:'none',height:80,outline:'none',padding:'9px 13px',width:'100%',transition:'border-color .2s'}}
                  onFocus={e=>e.target.style.borderColor='rgba(31,215,96,.5)'} onBlur={e=>e.target.style.borderColor='#162B1A'}/>
              </div>
            </div>

            {(title||body)&&(
              <div style={{marginBottom:14,padding:'12px 14px',borderRadius:13,background:'#0C1C0F',border:'1px solid #162B1A'}}>
                <div style={{fontSize:10,color:'#3D6645',marginBottom:8,fontWeight:700}}>ПРЕДПРОСМОТР</div>
                <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                  <div style={{width:36,height:36,borderRadius:10,background:'linear-gradient(135deg,var(--gr3),var(--gr))',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:14,fontWeight:900,color:'var(--bg)',flexShrink:0}}>K</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:700,marginBottom:2}}>{title||'Заголовок'}</div>
                    <div style={{fontSize:11,color:'#8FB897',lineHeight:1.5}}>{body||'Текст сообщения'}</div>
                    <div style={{fontSize:10,color:'#3D6645',marginTop:4}}>КАКАПО · сейчас</div>
                  </div>
                </div>
              </div>
            )}

            <button onClick={doSend} className="ab" style={{width:'100%',padding:13,background:sent?'rgba(31,215,96,.15)':'linear-gradient(135deg,var(--gr2),var(--gr))',border:sent?'1.5px solid rgba(31,215,96,.4)':'none',color:sent?'var(--gr)':'var(--bg)',fontFamily:'Nunito',fontWeight:800,fontSize:14,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
              {sending?<div style={{width:18,height:18,borderRadius:'50%',border:'2.5px solid rgba(3,11,5,.3)',borderTopColor:'#030B05',animation:'spin 1s linear infinite'}}/>
              :sent?'✅ Отправлено!'
              :'📤 Отправить уведомление'}
            </button>
          </div>

          <div className="ac" style={{padding:18}}>
            <div className="ub" style={{fontSize:13,fontWeight:800,marginBottom:12}}>Быстрые шаблоны</div>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {TEMPLATES.map((tpl,i)=>(
                <div key={i} onClick={()=>{setTitle(tpl.t);setBody(tpl.b);}} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderRadius:11,background:'#0C1C0F',border:'1px solid #162B1A',cursor:'pointer',transition:'all .15s'}}
                  onMouseEnter={e=>e.currentTarget.style.borderColor='rgba(31,215,96,.3)'}
                  onMouseLeave={e=>e.currentTarget.style.borderColor='#162B1A'}>
                  <span style={{fontSize:20,flexShrink:0}}>{tpl.e}</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,fontWeight:700}}>{tpl.t}</div>
                    <div style={{fontSize:11,color:'#3D6645',marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{tpl.b}</div>
                  </div>
                  <span style={{fontSize:11,color:'var(--gr)',fontWeight:700,flexShrink:0}}>Выбрать →</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <div className="ac" style={{overflow:'hidden'}}>
            <div style={{padding:'13px 16px',borderBottom:'1px solid #162B1A',fontWeight:800,fontSize:13}}>История рассылок</div>
            {HISTORY.map((h,i)=>(
              <div key={i} style={{padding:'12px 16px',borderBottom:i<HISTORY.length-1?'1px solid #162B1A':'none'}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                  <div style={{fontSize:13,fontWeight:700,flex:1}}>{h.t}</div>
                  <span style={{fontSize:10,color:'#3D6645',flexShrink:0,marginLeft:8}}>{h.time}</span>
                </div>
                <div style={{display:'flex',gap:10}}>
                  <span style={{padding:'2px 8px',borderRadius:7,fontSize:11,background:'rgba(59,142,240,.1)',color:'var(--blue)',border:'1px solid rgba(59,142,240,.25)'}}>{h.to}</span>
                  <span style={{fontSize:11,color:'#8FB897'}}>{h.n} доставлено</span>
                  <span style={{fontSize:11,color:'var(--gr)',fontWeight:700}}>{h.open}% открыли</span>
                </div>
              </div>
            ))}
          </div>

          <div className="ac" style={{padding:18}}>
            <div className="ub" style={{fontSize:13,fontWeight:800,marginBottom:14}}>Автоматические уведомления</div>
            {[
              {l:'При принятии заказа',  on:true},
              {l:'Когда курьер выехал',  on:true},
              {l:'Заказ доставлен',      on:true},
              {l:'Начислены бонусы',     on:true},
              {l:'Акции дня (в 9:00)',   on:false},
              {l:'Бонусы истекают',      on:false},
            ].map((r,i,arr)=>(
              <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 0',borderBottom:i<arr.length-1?'1px solid #162B1A':'none'}}>
                <span style={{fontSize:12,fontWeight:600}}>{r.l}</span>
                <Tog on={r.on}/>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AdminWrap>
  );
};
const AdminCouriersPage = ({go}) => {
  const COURIERS = [
    {id:'C-01',name:'Фирдавс Назаров',  phone:'+992 93 111 22 33',vehicle:'🏍 Мото', num:'TJ 1234 AA',status:'busy',     rating:4.9,orders:342,today:42, week:310},
    {id:'C-02',name:'Баходур Кодиров',  phone:'+992 90 222 33 44',vehicle:'🚲 Вело', num:'—',          status:'available',rating:4.7,orders:187,today:28, week:195},
    {id:'C-03',name:'Рустам Холов',     phone:'+992 91 333 44 55',vehicle:'🚗 Авто', num:'TJ 5678 BB', status:'available',rating:4.8,orders:521,today:56, week:420},
    {id:'C-04',name:'Зубайр Рахимов',   phone:'+992 88 444 55 66',vehicle:'🏍 Мото', num:'TJ 9012 CC', status:'offline',  rating:4.6,orders:98, today:0,  week:145},
  ];
  const SC = {available:{l:'Свободен',c:'var(--gr)'},busy:{l:'В заказе',c:'var(--gd)'},offline:{l:'Офлайн',c:'var(--t3)'}};
  const [showAdd,setShowAdd]=useState(false);

  return (
    <AdminWrap go={go} title="Курьеры" subtitle="Управление командой доставки">
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        {[
          {l:'Всего курьеров',  v:COURIERS.length,                                c:'var(--t1)'},
          {l:'Свободных',       v:COURIERS.filter(c=>c.status==='available').length,c:'var(--gr)'},
          {l:'В заказе',        v:COURIERS.filter(c=>c.status==='busy').length,   c:'var(--gd)'},
          {l:'Офлайн',          v:COURIERS.filter(c=>c.status==='offline').length, c:'var(--t3)'},
        ].map((s,i)=>(
          <div key={i} className="ac" style={{padding:'14px 16px'}}>
            <div style={{fontSize:10,color:'#8FB897',marginBottom:6}}>{s.l}</div>
            <div className="ub" style={{fontSize:22,fontWeight:900,color:s.c}}>{s.v}</div>
          </div>
        ))}
      </div>

      <div className="ac" style={{overflow:'hidden',marginBottom:16}}>
        <div style={{padding:'12px 16px',borderBottom:'1px solid #162B1A',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{fontWeight:800,fontSize:13}}>📍 Карта курьеров — Live</div>
          <div style={{display:'flex',alignItems:'center',gap:5}}>
            <div style={{width:6,height:6,borderRadius:'50%',background:'var(--gr)',animation:'pulse 2s infinite'}}/>
            <span style={{fontSize:11,color:'var(--gr)',fontWeight:700}}>Онлайн</span>
          </div>
        </div>
        <div style={{height:200,background:'linear-gradient(135deg,#050F08,#091814)',position:'relative',overflow:'hidden'}}>
          <div style={{position:'absolute',inset:0,opacity:.05,background:'repeating-linear-gradient(0deg,transparent,transparent 20px,rgba(31,215,96,1) 20px,rgba(31,215,96,1) 21px),repeating-linear-gradient(90deg,transparent,transparent 20px,rgba(31,215,96,1) 20px,rgba(31,215,96,1) 21px)'}}/>
          <div style={{position:'absolute',left:'44%',top:'42%',display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
            <div style={{width:30,height:30,borderRadius:'50%',background:'linear-gradient(135deg,var(--gr3),var(--gr))',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:12,fontWeight:900,color:'var(--bg)',boxShadow:'0 0 12px rgba(31,215,96,.6)'}}>K</div>
            <span style={{fontSize:8,color:'rgba(255,255,255,.5)',background:'rgba(0,0,0,.6)',padding:'1px 4px',borderRadius:3}}>Магазин</span>
          </div>
          {COURIERS.filter(c=>c.status!=='offline').map((c,i)=>(
            <div key={c.id} style={{position:'absolute',left:`${20+i*22}%`,top:`${28+i*16}%`,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
              <div style={{width:26,height:26,borderRadius:'50%',background:c.status==='available'?'var(--blue)':'var(--gd)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,position:'relative',boxShadow:`0 0 10px ${c.status==='available'?'rgba(59,142,240,.6)':'rgba(255,184,0,.6)'}`}}>
                🛵
                <div style={{position:'absolute',inset:-2,borderRadius:'50%',border:`2px solid ${c.status==='available'?'var(--blue)':'var(--gd)'}`,animation:'ping 2s ease-out infinite',opacity:.4}}/>
              </div>
              <span style={{fontSize:8,color:'rgba(255,255,255,.5)',background:'rgba(0,0,0,.6)',padding:'1px 4px',borderRadius:3,whiteSpace:'nowrap'}}>{c.name.split(' ')[0]}</span>
            </div>
          ))}
          <div style={{position:'absolute',bottom:8,right:12,fontSize:9,color:'rgba(255,255,255,.3)'}}>г. Яван · GPS Live</div>
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
                <td>
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <div style={{width:34,height:34,borderRadius:'50%',background:'linear-gradient(135deg,var(--gr3),var(--gr))',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:13,fontWeight:900,color:'var(--bg)',flexShrink:0}}>{c.name.charAt(0)}</div>
                    <div><div style={{fontWeight:700,fontSize:13}}>{c.name}</div><div style={{fontSize:11,color:'#8FB897'}}>{c.phone}</div></div>
                  </div>
                </td>
                <td style={{fontSize:12}}>{c.vehicle}<br/><span style={{color:'#3D6645',fontSize:11}}>{c.num}</span></td>
                <td><span style={{padding:'2px 9px',borderRadius:8,fontSize:11,fontWeight:800,background:`${s.c}18`,color:s.c,border:`1px solid ${s.c}30`}}>{s.l}</span></td>
                <td style={{color:'var(--gd)',fontWeight:700}}>★ {c.rating}</td>
                <td><span className="ub" style={{fontSize:12,fontWeight:800,color:'var(--gd)'}}>{c.today} ЅМ</span></td>
                <td><span className="ub" style={{fontSize:12,fontWeight:700}}>{c.week} ЅМ</span></td>
                <td style={{color:'#8FB897'}}>{c.orders}</td>
                <td>
                  <div style={{display:'flex',gap:6}}>
                    <button className="ab abg" style={{padding:'4px 9px',fontSize:11}}>📱 Звонок</button>
                    <button className="ab abd" style={{padding:'4px 9px',fontSize:11}}>Блок</button>
                  </div>
                </td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>

      {showAdd&&(
        <div className="amod">
          <div className="amodbg" onClick={()=>setShowAdd(false)}/>
          <div className="amodbox" style={{maxWidth:420}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
              <div className="ub" style={{fontSize:15,fontWeight:800}}>Добавить курьера</div>
              <button onClick={()=>setShowAdd(false)} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>ФИО *</div><input className="ai" placeholder="Имя Фамилия"/></div>
              <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Телефон *</div><input className="ai" placeholder="+992 __ ___ __ __" type="tel"/></div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div>
                  <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Транспорт</div>
                  <select className="ai" style={{cursor:'pointer'}}>
                    <option>🏍 Мотоцикл</option><option>🚲 Велосипед</option><option>🚗 Авто</option>
                  </select>
                </div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Номер ТС</div><input className="ai" placeholder="TJ XXXX XX"/></div>
              </div>
              <button className="ab abp" style={{width:'100%',padding:12}} onClick={()=>setShowAdd(false)}>✓ Добавить курьера</button>
            </div>
          </div>
        </div>
      )}
    </AdminWrap>
  );
};

const AdminOrdersPage = ({go}) => {
  const SC={pending:{l:'Ожидает',c:'#FFB800'},assembling:{l:'Собирается',c:'#9B6DFF'},delivering:{l:'В пути',c:'#3B8EF0'},delivered:{l:'Доставлен',c:'#1FD760'},cancelled:{l:'Отменён',c:'#FF4545'}};
  const ORDERS=[
    {id:'K-4832',client:'Диловар Р.',card:'КАКАПО-0042',total:64.30,status:'delivering',addr:'ул. Ленина, 42',time:'14:23'},
    {id:'K-4831',client:'Нилуфар Х.',card:'КАКАПО-0118',total:28.50,status:'assembling',addr:'ул. Сомони, 12',time:'14:18'},
    {id:'K-4830',client:'Бахром К.', card:'—',          total:112.0,status:'delivered', addr:'мкр. Мирный, 5',time:'14:05'},
    {id:'K-4829',client:'Мадина О.', card:'КАКАПО-0007',total:47.80,status:'delivered', addr:'ул. Ленина, 18',time:'13:55'},
    {id:'K-4828',client:'Зафар М.',  card:'КАКАПО-0234',total:89.40,status:'cancelled', addr:'ул. Рудаки, 3', time:'13:40'},
  ];
  const [search,setSearch]=useState('');
  const filtered=ORDERS.filter(o=>!search||o.id.toLowerCase().includes(search.toLowerCase())||o.client.toLowerCase().includes(search.toLowerCase()));
  return (
    <AdminWrap go={go} title="Заказы" subtitle="Управление заказами">
      <div style={{display:'flex',gap:10,marginBottom:14,alignItems:'center'}}>
        <input className="ai" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск по ID или клиенту..." style={{width:280}}/>
      </div>
      <div className="ac">
        <table className="at">
          <thead><tr><th>ID</th><th>Клиент</th><th>Карта</th><th>Адрес</th><th>Сумма</th><th>Статус</th><th>Время</th><th></th></tr></thead>
          <tbody>
            {filtered.map(o=>{const s=SC[o.status];return(
              <tr key={o.id}>
                <td><span style={{fontFamily:'Unbounded',fontSize:12,color:'#1FD760'}}>{o.id}</span></td>
                <td style={{fontWeight:600}}>{o.client}</td>
                <td><span style={{fontSize:11,color:o.card!=='—'?'#FFB800':'#3D6645',fontFamily:o.card!=='—'?'Unbounded':'inherit',fontWeight:700}}>{o.card}</span></td>
                <td style={{color:'#8FB897',fontSize:12}}>{o.addr}</td>
                <td><span style={{fontFamily:'Unbounded',fontWeight:800}}>{o.total.toFixed(2)} <span style={{fontSize:10,color:'#FFB800'}}>ЅМ</span></span></td>
                <td><span style={{padding:'2px 8px',borderRadius:8,fontSize:10,fontWeight:800,background:`${s.c}18`,color:s.c,border:`1px solid ${s.c}30`}}>{s.l}</span></td>
                <td style={{color:'#3D6645',fontSize:12}}>{o.time}</td>
                <td><button className="ab abg" style={{padding:'4px 10px',fontSize:11}}>Открыть</button></td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>
    </AdminWrap>
  );
};

const AdminClientsPage = ({go}) => {
  const CLIENTS=[
    {name:'Диловар Рахимов', phone:'+992 93 456 78 90',level:'platinum',orders:87,spent:3420,debt:1200,bonus:4850,card:'КАКАПО-0001'},
    {name:'Нилуфар Хасанова',phone:'+992 90 123 45 67',level:'gold',    orders:43,spent:1890,debt:0,   bonus:1240,card:'КАКАПО-0042'},
    {name:'Бахром Каримов',  phone:'+992 88 789 01 23',level:'silver',  orders:28,spent:980, debt:0,   bonus:560, card:'КАКАПО-0118'},
    {name:'Зафар Мирзоев',   phone:'+992 91 654 32 10',level:'gold',    orders:56,spent:2340,debt:4500,bonus:2100,card:'КАКАПО-0234'},
  ];
  return (
    <AdminWrap go={go} title="Клиенты" subtitle="CRM — база клиентов и карты лояльности">
      <div className="ac">
        <table className="at">
          <thead><tr><th>Клиент</th><th>Карта</th><th>Уровень</th><th>Заказов</th><th>Потрачено</th><th>Долг</th><th>Бонусы</th><th></th></tr></thead>
          <tbody>
            {CLIENTS.map((c,i)=>(
              <tr key={i}>
                <td>
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <div style={{width:32,height:32,borderRadius:'50%',background:'linear-gradient(135deg,#0F8A3A,#1FD760)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:12,fontWeight:900,color:'#030B05',flexShrink:0}}>{c.name.charAt(0)}</div>
                    <div><div style={{fontWeight:700,fontSize:13}}>{c.name}</div><div style={{fontSize:11,color:'#8FB897'}}>{c.phone}</div></div>
                  </div>
                </td>
                <td><span style={{fontFamily:'Unbounded',fontSize:11,fontWeight:800,color:'#FFB800'}}>{c.card}</span></td>
                <td><span style={{padding:'2px 8px',borderRadius:8,fontSize:10,fontWeight:800,color:LVC[c.level],background:`${LVC[c.level]}18`,border:`1px solid ${LVC[c.level]}30`}}>{c.level}</span></td>
                <td style={{fontWeight:600}}>{c.orders}</td>
                <td><span style={{fontFamily:'Unbounded',fontSize:12,fontWeight:700}}>{c.spent.toLocaleString()} ЅМ</span></td>
                <td style={{color:c.debt>0?'#FF4545':'#3D6645',fontWeight:c.debt>0?800:400}}>{c.debt>0?`${c.debt.toLocaleString()} ЅМ`:'—'}</td>
                <td style={{color:'#FFB800',fontWeight:600}}>{c.bonus.toLocaleString()} ⭐</td>
                <td><button className="ab abg" style={{padding:'4px 10px',fontSize:11}}>Профиль</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminWrap>
  );
};
const CourierLoginPage = ({go}) => {
  const [phone, setPhone] = useState('');
  const [otp,   setOtp]   = useState(['','','','']);
  const [step,  setStep]  = useState('phone');
  const [load,  setLoad]  = useState(false);
  const [err,   setErr]   = useState('');

  const sendOtp = () => {
    if (!phone.trim()) { setErr('Введите номер'); return; }
    setLoad(true);
    setTimeout(() => { setLoad(false); setStep('otp'); setErr(''); }, 900);
  };
  const verify = () => {
    const code = otp.join('');
    if (code.length < 4) return;
    setLoad(true);
    setTimeout(() => {
      setLoad(false);
      if (code === '1234') { window.location.href = '/courier'; return; }
      else { setErr('Неверный код. Демо: 1234'); setOtp(['','','','']); }
    }, 800);
  };

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',maxWidth:480,margin:'0 auto',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:24}}>
      <button onClick={()=>go('home')} className="btn" style={{position:'absolute',top:18,left:18,width:40,height:40,borderRadius:12,background:'var(--l3)',border:'1px solid var(--b1)',display:'flex',alignItems:'center',justifyContent:'center'}}>
        <Ic n="arrL" s={17} c="var(--t2)"/>
      </button>
      <div style={{textAlign:'center',marginBottom:28}}>
        <div style={{fontSize:52,marginBottom:14}}>🛵</div>
        <div className="ub" style={{fontSize:20,fontWeight:900,color:'var(--gr)',marginBottom:4}}>Курьер КАКАПО</div>
        <div style={{fontSize:12,color:'var(--t2)'}}>г. Яван, Таджикистан</div>
      </div>
      <div style={{width:'100%',maxWidth:360,background:'var(--l2)',border:'1px solid var(--b1)',borderRadius:20,padding:24}}>
        {err&&<div style={{padding:'9px 12px',borderRadius:10,background:'rgba(255,69,69,.1)',border:'1px solid rgba(255,69,69,.3)',fontSize:12,color:'var(--red)',marginBottom:14}}>⚠️ {err}</div>}
        {step==='phone' ? (
          <>
            <div className="ub" style={{fontSize:15,fontWeight:800,marginBottom:16}}>Вход для курьера</div>
            <div style={{position:'relative',marginBottom:12}}>
              <div style={{position:'absolute',left:13,top:'50%',transform:'translateY(-50%)',display:'flex',alignItems:'center',gap:7,pointerEvents:'none',zIndex:2}}>
                <span style={{fontSize:18}}>🇹🇯</span>
                <span style={{fontSize:14,fontWeight:700,color:'var(--t2)'}}>+992</span>
                <div style={{width:1,height:16,background:'var(--b1)'}}/>
              </div>
              <input className="inp" value={phone} onChange={e=>{setPhone(e.target.value);setErr('');}} placeholder="__ ___ __ __" type="tel" inputMode="numeric" style={{paddingLeft:88,width:'100%',fontSize:16}}/>
            </div>
            <div style={{padding:'9px 12px',borderRadius:9,background:'rgba(255,184,0,.06)',border:'1px solid rgba(255,184,0,.2)',fontSize:11,color:'var(--t2)',marginBottom:14}}>
              💡 Демо OTP: <span style={{color:'var(--gd)',fontWeight:700}}>1 2 3 4</span>
            </div>
            <button onClick={sendOtp} className="btn" style={{width:'100%',padding:14,borderRadius:14,background:'linear-gradient(135deg,var(--gr2),var(--gr))',border:'none',color:'var(--bg)',fontFamily:'Nunito',fontWeight:800,fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
              {load?<div style={{width:18,height:18,borderRadius:'50%',border:'2.5px solid rgba(3,11,5,.3)',borderTopColor:'#030B05',animation:'spin 1s linear infinite'}}/>:'💬 Получить SMS код'}
            </button>
          </>
        ) : (
          <>
            <button onClick={()=>{setStep('phone');setOtp(['','','','']);}} style={{background:'none',border:'none',color:'var(--t2)',fontSize:13,cursor:'pointer',marginBottom:14,fontFamily:'Nunito'}}>← Назад</button>
            <div className="ub" style={{fontSize:15,fontWeight:800,marginBottom:6}}>Введите код</div>
            <div style={{fontSize:12,color:'var(--t2)',marginBottom:16}}>Отправили на +992 {phone}</div>
            <div style={{display:'flex',gap:10,justifyContent:'center',marginBottom:14}}>
              {otp.map((v,i)=>(
                <input key={i} id={"cotp"+i} value={v}
                  onChange={e=>{const d=[...otp];d[i]=e.target.value.replace(/\D/,'').slice(-1);setOtp(d);if(e.target.value&&i<3)document.getElementById("cotp"+(i+1))?.focus();}}
                  onKeyDown={e=>{if(e.key==='Backspace'&&!v&&i>0){document.getElementById("cotp"+(i-1))?.focus();const d=[...otp];d[i-1]='';setOtp(d);}}}
                  maxLength={1} inputMode="numeric"
                  style={{width:52,height:60,borderRadius:14,border:`2px solid ${v?'rgba(31,215,96,.5)':'var(--b1)'}`,background:v?'rgba(31,215,96,.07)':'var(--l3)',textAlign:'center',fontFamily:'Unbounded',fontSize:24,fontWeight:900,color:'var(--t1)',outline:'none'}}/>
              ))}
            </div>
            <button onClick={verify} className="btn" style={{width:'100%',padding:14,borderRadius:14,background:'linear-gradient(135deg,var(--gr2),var(--gr))',border:'none',color:'var(--bg)',fontFamily:'Nunito',fontWeight:800,fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:otp.join('').length<4?.5:1}}>
              {load?<div style={{width:18,height:18,borderRadius:'50%',border:'2.5px solid rgba(3,11,5,.3)',borderTopColor:'#030B05',animation:'spin 1s linear infinite'}}/>:'✓ Войти'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

const CourierDashRedirect = () => {
  useEffect(() => { window.location.href = '/courier'; }, []);
  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', maxWidth:480, margin:'0 auto', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:32, textAlign:'center' }}>
      <div style={{ fontSize:48, marginBottom:16 }}>🛵</div>
      <div className="ub" style={{ fontSize:18, fontWeight:900, marginBottom:8 }}>Приложение курьера</div>
      <div style={{ fontSize:13, color:'var(--t2)', marginBottom:20 }}>Перенаправляем на карту с OSRM-маршрутами…</div>
      <a href="/courier" style={{ padding:'12px 24px', borderRadius:14, background:'linear-gradient(135deg,var(--gr2),var(--gr))', color:'white', fontWeight:800, textDecoration:'none' }}>Открыть /courier</a>
    </div>
  );
};

const CourierDashPage = ({go}) => {
  const SC = {available:{l:'Свободен',c:'var(--gr)'},busy:{l:'В заказе',c:'var(--gd)'},offline:{l:'Офлайн',c:'var(--t3)'}};

  // Точки на карте (SVG 340x240)
  const POINTS = {
    courier:  {x:170, y:130, label:'Я',        color:'var(--gr)',  icon:'🛵'},
    market:   {x:170, y:100, label:'Магазин',   color:'var(--gr)',  icon:'🛒'},
    rest1:    {x:80,  y:80,  label:'Чайхона',   color:'var(--org)', icon:'🍖'},
    rest2:    {x:260, y:70,  label:'Пицца',     color:'var(--red)', icon:'🍕'},
    rest3:    {x:290, y:160, label:'Суши',      color:'var(--blue)',icon:'🍣'},
    rest4:    {x:100, y:185, label:'Фаст-фуд',  color:'var(--gd)', icon:'🍟'},
    client1:  {x:60,  y:160, label:'Нилуфар Х.',color:'var(--pur)', icon:'📍'},
    client2:  {x:230, y:195, label:'Рустам Д.', color:'var(--pur)', icon:'📍'},
    client3:  {x:310, y:100, label:'Мадина О.', color:'var(--pur)', icon:'📍'},
  };

  const ORDERS = [
    {id:'K-4831',client:'Нилуфар Х.',  phone:'+992 93 456-78-90',addr:'ул. Сомони, 12',   dist:3.4,earning:5, pay:'Карта',    type:'market',    pickupKey:'market', deliverKey:'client1', items:[{e:'🥛',n:'Молоко'},{e:'🧀',n:'Сыр'},{e:'☕',n:'Кофе'}],    pickupName:'КАКАПО Магазин'},
    {id:'K-4835',client:'Рустам Д.',   phone:'+992 90 123-45-67',addr:'мкр. Мирный, 5',  dist:1.8,earning:3, pay:'Наличными', type:'market',    pickupKey:'market', deliverKey:'client2', items:[{e:'🥦',n:'Брокколи'},{e:'🍅',n:'Томаты'},{e:'🥩',n:'Говядина'}], pickupName:'КАКАПО Магазин'},
    {id:'K-4837',client:'Мадина О.',   phone:'+992 91 333-21-10',addr:'ул. Ленина, 18',   dist:4.1,earning:6, pay:'Карта',    type:'restaurant', pickupKey:'rest1',  deliverKey:'client3', items:[{e:'🍚',n:'Плов'},{e:'🥩',n:'Шашлык ×2'}],              pickupName:'Чайхона Оромгох'},
    {id:'K-4838',client:'Зафар М.',    phone:'+992 88 777-55-33',addr:'ул. Рудаки, 8',    dist:2.6,earning:4, pay:'Наличными', type:'restaurant', pickupKey:'rest2',  deliverKey:'client1', items:[{e:'🍕',n:'Пепперони'},{e:'🍕',n:'Маргарита'}],           pickupName:'Пицца Яван'},
    {id:'K-4840',client:'Бахром К.',   phone:'+992 93 555-12-34',addr:'ул. Навои, 3',     dist:3.0,earning:5, pay:'Карта',    type:'restaurant', pickupKey:'rest3',  deliverKey:'client2', items:[{e:'🌯',n:'Филадельфия ×2'},{e:'🌯',n:'Дракон'}],          pickupName:'Суши Яван'},
    {id:'K-4841',client:'Гулнора С.',  phone:'+992 90 888-44-21',addr:'мкр. Садовый, 7',  dist:1.2,earning:2, pay:'Наличными', type:'restaurant', pickupKey:'rest4',  deliverKey:'client3', items:[{e:'🍔',n:'Двойной бургер'},{e:'🌭',n:'Хот-дог'}],          pickupName:'Фаст-фуд 24/7'},
  ];

  const [status,   setStatus]   = useState('available');
  const [activeId, setActiveId] = useState(null);
  const [step,     setStep]     = useState(0); // 0=едем в точку, 1=забрали, 2=доставили
  const [tab,      setTab]      = useState('orders'); // orders | map

  const activeOrder = ORDERS.find(o=>o.id===activeId);

  const accept = (order) => { setActiveId(order.id); setStatus('busy'); setStep(0); setTab('map'); };
  const nextStep = () => {
    if(step===0) setStep(1);
    else if(step===1) setStep(2);
    else { setActiveId(null); setStatus('available'); setStep(0); setTab('orders'); }
  };

  const stepInfo = [
    {label:'Едешь за заказом', sub: activeOrder ? `→ ${activeOrder.pickupName}` : '', c:'var(--gd)',  btn:'✅ Забрал заказ'},
    {label:'Везёшь клиенту',   sub: activeOrder ? `→ ${activeOrder.addr}` : '',       c:'var(--blue)',btn:'📦 Доставил'},
    {label:'Заказ доставлен',  sub:'Отлично! +отзыв',                                  c:'var(--gr)', btn:'✓ Завершить'},
  ];

  // SVG Карта
  const RouteMap = ({order}) => {
    if(!order) return null;
    const courier = POINTS.courier;
    const pickup  = POINTS[order.pickupKey];
    const deliver = POINTS[order.deliverKey];
    // путь: курьер → забрать → доставить
    const path = step===0
      ? `M${courier.x},${courier.y} L${pickup.x},${pickup.y}`
      : `M${pickup.x},${pickup.y} L${deliver.x},${deliver.y}`;
    const fullPath = `M${courier.x},${courier.y} L${pickup.x},${pickup.y} L${deliver.x},${deliver.y}`;

    return (
      <svg width="100%" viewBox="0 0 340 240" style={{display:'block',borderRadius:16,background:'#061008'}}>
        {/* Сетка улиц */}
        {[40,80,120,160,200].map(y=><line key={y} x1="0" y1={y} x2="340" y2={y} stroke="#0D2010" strokeWidth="1"/>)}
        {[60,120,180,240,300].map(x=><line key={x} x1={x} y1="0" x2={x} y2="240" stroke="#0D2010" strokeWidth="1"/>)}
        {/* Главные дороги */}
        <line x1="0" y1="120" x2="340" y2="120" stroke="#122018" strokeWidth="3"/>
        <line x1="170" y1="0" x2="170" y2="240" stroke="#122018" strokeWidth="3"/>
        <line x1="0" y1="60" x2="340" y2="200" stroke="#0F1A0E" strokeWidth="2"/>

        {/* Полный маршрут (серый) */}
        <polyline points={`${courier.x},${courier.y} ${pickup.x},${pickup.y} ${deliver.x},${deliver.y}`} fill="none" stroke="#1D3822" strokeWidth="2.5" strokeDasharray="6 4"/>

        {/* Активный участок маршрута */}
        <line x1={path.split('M')[1].split(' L')[0].split(',')[0]} y1={path.split('M')[1].split(' L')[0].split(',')[1]}
              x2={path.split('L')[1].split(',')[0]} y2={path.split('L')[1].split(',')[1]}
              stroke={step===0?'var(--gd)':'var(--blue)'} strokeWidth="3" strokeLinecap="round"/>

        {/* Все рестораны и магазин */}
        {Object.entries(POINTS).filter(([k])=>!['courier','client1','client2','client3'].includes(k)).map(([k,p])=>(
          <g key={k}>
            <circle cx={p.x} cy={p.y} r="14" fill={k===order.pickupKey?p.color+'44':'#0C1C0F'} stroke={k===order.pickupKey?p.color:'#1D3822'} strokeWidth={k===order.pickupKey?2:1}/>
            <text x={p.x} y={p.y+5} textAnchor="middle" fontSize="13">{p.icon}</text>
          </g>
        ))}

        {/* Точка доставки */}
        <g>
          <circle cx={deliver.x} cy={deliver.y} r="14" fill={step===1?'rgba(155,109,255,.35)':'#0C1C0F'} stroke={step===1?'var(--pur)':'#1D3822'} strokeWidth={step===1?2:1}/>
          <text x={deliver.x} y={deliver.y+5} textAnchor="middle" fontSize="12">📍</text>
        </g>

        {/* Курьер */}
        <g>
          <circle cx={step===0?courier.x:step===1?pickup.x:deliver.x} cy={step===0?courier.y:step===1?pickup.y:deliver.y} r="16" fill="rgba(31,215,96,.25)" stroke="var(--gr)" strokeWidth="2.5"/>
          <text x={step===0?courier.x:step===1?pickup.x:deliver.x} y={(step===0?courier.y:step===1?pickup.y:deliver.y)+5} textAnchor="middle" fontSize="14">🛵</text>
        </g>

        {/* Метки активных точек */}
        {[{p:pickup,l:order.pickupName.split(' ')[0],c:pickup.color},{p:deliver,l:order.client.split(' ')[0],c:'var(--pur)'}].map((m,i)=>(
          <text key={i} x={m.p.x} y={m.p.y-19} textAnchor="middle" fontSize="9" fill={m.c} fontWeight="700">{m.l}</text>
        ))}

        {/* Легенда */}
        <rect x="4" y="4" width="95" height="34" rx="6" fill="rgba(3,11,5,.85)"/>
        <text x="10" y="16" fontSize="8" fill="#3D6645">🛵 Курьер  📍 Клиент</text>
        <text x="10" y="28" fontSize="8" fill="#3D6645">🛒 Магазин  🍽 Рестораны</text>
      </svg>
    );
  };

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',maxWidth:480,margin:'0 auto'}}>
      {/* Шапка */}
      <header style={{position:'sticky',top:0,zIndex:100,background:'rgba(3,11,5,.97)',backdropFilter:'blur(24px)',borderBottom:'1px solid var(--b1)'}}>
        <div style={{padding:'13px 18px 12px',display:'flex',alignItems:'center',gap:10}}>
          <button onClick={()=>go('courier_login')} className="btn" style={{width:38,height:38,borderRadius:12,background:'var(--l3)',border:'1px solid var(--b1)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            <Ic n="arrL" s={17} c="var(--t2)"/>
          </button>
          <div style={{flex:1}}>
            <div className="ub" style={{fontSize:15,fontWeight:900}}>Курьер КАКАПО</div>
            <div style={{display:'flex',alignItems:'center',gap:5,marginTop:1}}>
              <div style={{width:6,height:6,borderRadius:'50%',background:SC[status].c,animation:'pulse 2s infinite'}}/>
              <span style={{fontSize:10,color:'var(--t2)'}}>{SC[status].l} · 🏍 TJ 1234 AA</span>
            </div>
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:9,color:'var(--t3)'}}>Сегодня</div>
            <div className="ub" style={{fontSize:15,fontWeight:900,color:'var(--gd)'}}>42 ЅМ</div>
          </div>
        </div>
        {/* Табы */}
        <div style={{display:'flex',borderTop:'1px solid var(--b1)'}}>
          {[{id:'orders',l:'📋 Заказы'},{id:'map',l:'🗺 Маршрут'}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} className="btn"
              style={{flex:1,padding:'10px',fontSize:12,fontWeight:700,color:tab===t.id?'var(--gr)':'var(--t3)',borderBottom:`2px solid ${tab===t.id?'var(--gr)':'transparent'}`,background:'transparent',borderRadius:0,transition:'all .2s',fontFamily:'Nunito'}}>
              {t.l}
              {t.id==='map'&&activeOrder&&<span style={{marginLeft:4,width:7,height:7,borderRadius:'50%',background:'var(--gd)',display:'inline-block',animation:'pulse 2s infinite'}}/>}
            </button>
          ))}
        </div>
      </header>

      <div style={{padding:'14px 18px 30px'}}>
        {/* Статус */}
        <div style={{display:'flex',gap:8,marginBottom:16}}>
          {['available','busy','offline'].map(s=>(
            <button key={s} onClick={()=>!activeOrder&&setStatus(s)} className="btn"
              style={{flex:1,padding:'9px 6px',borderRadius:11,fontSize:11,fontWeight:700,border:`1.5px solid ${status===s?SC[s].c:'var(--b1)'}`,background:status===s?SC[s].c+'14':'var(--l2)',color:status===s?SC[s].c:'var(--t2)',fontFamily:'Nunito',opacity:activeOrder&&s!=='busy'?.4:1}}>
              {SC[s].l}
            </button>
          ))}
        </div>

        {/* Статистика */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:18}}>
          {[{l:'Заработано',v:'42 ЅМ',c:'var(--gd)'},{l:'Доставок',v:'14',c:'var(--gr)'},{l:'Рейтинг',v:'4.9 ★',c:'var(--gd)'}].map((s,i)=>(
            <div key={i} style={{background:'var(--l2)',border:'1px solid var(--b1)',borderRadius:14,padding:'12px 10px',textAlign:'center'}}>
              <div className="ub" style={{fontSize:15,fontWeight:900,color:s.c,marginBottom:3}}>{s.v}</div>
              <div style={{fontSize:10,color:'var(--t3)'}}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* ── ТАБ: КАРТА МАРШРУТА ── */}
        {tab==='map' && (
          <div>
            {!activeOrder ? (
              <div style={{textAlign:'center',padding:'40px 20px',background:'var(--l2)',borderRadius:18,border:'1px solid var(--b1)'}}>
                <div style={{fontSize:48,marginBottom:12}}>🗺</div>
                <div className="ub" style={{fontSize:14,fontWeight:800,marginBottom:6}}>Нет активного заказа</div>
                <div style={{fontSize:12,color:'var(--t3)',marginBottom:16}}>Прими заказ во вкладке «Заказы»</div>
                <button onClick={()=>setTab('orders')} className="btn" style={{padding:'10px 24px',borderRadius:12,background:'rgba(31,215,96,.12)',border:'1px solid rgba(31,215,96,.3)',color:'var(--gr)',fontWeight:700,fontSize:13}}>Смотреть заказы →</button>
              </div>
            ) : (
              <div>
                {/* Статус маршрута */}
                <div style={{background:'var(--l2)',border:`1.5px solid ${stepInfo[step].c}44`,borderRadius:16,padding:'14px 16px',marginBottom:14,display:'flex',alignItems:'center',gap:12}}>
                  <div style={{width:44,height:44,borderRadius:12,background:`${stepInfo[step].c}18`,border:`1.5px solid ${stepInfo[step].c}44`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>
                    {step===0?'🛵':step===1?'📦':'✅'}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14,fontWeight:800,color:stepInfo[step].c}}>{stepInfo[step].label}</div>
                    <div style={{fontSize:12,color:'var(--t2)',marginTop:2}}>{stepInfo[step].sub}</div>
                  </div>
                  <div className="ub" style={{fontSize:16,fontWeight:900,color:'var(--gd)'}}>+{activeOrder.earning} ЅМ</div>
                </div>

                {/* SVG Карта */}
                <div style={{borderRadius:16,overflow:'hidden',border:'1px solid var(--b1)',marginBottom:14}}>
                  <RouteMap order={activeOrder}/>
                </div>

                {/* Маршрутные точки */}
                <div style={{background:'var(--l2)',border:'1px solid var(--b1)',borderRadius:16,padding:'14px 16px',marginBottom:14}}>
                  <div style={{fontSize:11,color:'var(--t3)',fontWeight:700,marginBottom:10,textTransform:'uppercase',letterSpacing:1}}>Маршрут</div>
                  {/* Точка 1: Курьер */}
                  <div style={{display:'flex',gap:10,marginBottom:0}}>
                    <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
                      <div style={{width:12,height:12,borderRadius:'50%',background:'var(--gr)',border:'2px solid var(--bg)',flexShrink:0}}/>
                      <div style={{width:2,height:28,background:'var(--b2)'}}/>
                    </div>
                    <div style={{paddingBottom:12}}>
                      <div style={{fontSize:11,color:'var(--t3)'}}>МОЁ МЕСТОПОЛОЖЕНИЕ</div>
                      <div style={{fontSize:13,fontWeight:700}}>ул. Ленина, 42 · г. Яван</div>
                    </div>
                  </div>
                  {/* Точка 2: Забрать */}
                  <div style={{display:'flex',gap:10,marginBottom:0}}>
                    <div style={{display:'flex',flexDirection:'column',alignItems:'center'}}>
                      <div style={{width:12,height:12,borderRadius:3,background:step>=1?'var(--gr)':'var(--gd)',border:'2px solid var(--bg)',flexShrink:0}}/>
                      <div style={{width:2,height:28,background:'var(--b2)'}}/>
                    </div>
                    <div style={{paddingBottom:12}}>
                      <div style={{fontSize:11,color:'var(--t3)'}}>ЗАБРАТЬ {activeOrder.type==='restaurant'?'ИЗ РЕСТОРАНА':'ИЗ МАГАЗИНА'} {step>=1&&'✅'}</div>
                      <div style={{fontSize:13,fontWeight:700,color:step>=1?'var(--t3)':'var(--t1)'}}>{activeOrder.pickupName}</div>
                      <div style={{fontSize:11,color:'var(--t3)',marginTop:2}}>Заказ {activeOrder.id} · {activeOrder.items.map(it=>it.e+it.n).join(', ')}</div>
                    </div>
                  </div>
                  {/* Точка 3: Доставить */}
                  <div style={{display:'flex',gap:10}}>
                    <div style={{alignItems:'center',display:'flex',flexDirection:'column'}}>
                      <div style={{width:12,height:12,borderRadius:2,background:step>=2?'var(--gr)':'var(--pur)',border:'2px solid var(--bg)',flexShrink:0}}/>
                    </div>
                    <div>
                      <div style={{fontSize:11,color:'var(--t3)'}}>ДОСТАВИТЬ КЛИЕНТУ {step>=2&&'✅'}</div>
                      <div style={{fontSize:13,fontWeight:700,color:step>=2?'var(--t3)':'var(--t1)'}}>{activeOrder.client} · {activeOrder.addr}</div>
                      <div style={{fontSize:11,color:'var(--t3)',marginTop:2}}>{activeOrder.phone} · Оплата: {activeOrder.pay}</div>
                    </div>
                  </div>
                </div>

                {/* Кнопка действия */}
                <button onClick={nextStep} className="btn" style={{width:'100%',padding:14,borderRadius:14,background:step===2?'linear-gradient(135deg,var(--gr2),var(--gr))':step===1?'linear-gradient(135deg,#2255CC,var(--blue))':'linear-gradient(135deg,#CC8800,var(--gd))',border:'none',color:step===2?'var(--bg)':'white',fontFamily:'Nunito',fontWeight:800,fontSize:14}}>
                  {stepInfo[step].btn}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── ТАБ: ЗАКАЗЫ ── */}
        {tab==='orders' && (
          <div>
            {activeOrder && (
              <div onClick={()=>setTab('map')} style={{background:'rgba(31,215,96,.08)',border:'1.5px solid rgba(31,215,96,.35)',borderRadius:14,padding:'12px 16px',marginBottom:16,cursor:'pointer',display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:38,height:38,borderRadius:10,background:'rgba(31,215,96,.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>🛵</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:800,color:'var(--gr)'}}>Активный заказ: {activeOrder.id}</div>
                  <div style={{fontSize:11,color:'var(--t2)',marginTop:1}}>{stepInfo[step].label} · {stepInfo[step].sub}</div>
                </div>
                <span style={{fontSize:12,color:'var(--gr)',fontWeight:700}}>Карта →</span>
              </div>
            )}

            <div className="ub" style={{fontSize:14,fontWeight:800,marginBottom:12}}>
              Новые заказы
              <span style={{marginLeft:8,padding:'2px 8px',borderRadius:8,fontSize:11,fontWeight:800,background:'rgba(255,69,69,.12)',color:'var(--red)',border:'1px solid rgba(255,69,69,.28)'}}>{ORDERS.filter(o=>o.id!==activeId).length}</span>
            </div>

            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              {ORDERS.filter(o=>o.id!==activeId).map(order=>(
                <div key={order.id} style={{background:'var(--l2)',border:'1.5px solid var(--b1)',borderRadius:18,overflow:'hidden'}}>
                  <div style={{padding:'13px 16px',borderBottom:'1px solid var(--b1)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <div>
                      <span className="ub" style={{fontSize:13,fontWeight:800,color:'var(--gr)'}}>{order.id}</span>
                      <span style={{fontSize:10,padding:'2px 7px',borderRadius:6,marginLeft:8,background:order.type==='restaurant'?'rgba(255,125,59,.12)':'rgba(31,215,96,.1)',color:order.type==='restaurant'?'var(--org)':'var(--gr)',border:`1px solid ${order.type==='restaurant'?'rgba(255,125,59,.25)':'rgba(31,215,96,.2)'}`}}>{order.type==='restaurant'?'🍽 Ресторан':'🛒 Магазин'}</span>
                    </div>
                    <div className="ub" style={{fontSize:18,fontWeight:900,color:'var(--gd)'}}>+{order.earning} ЅМ</div>
                  </div>
                  <div style={{padding:'12px 16px',borderBottom:'1px solid var(--b1)',display:'flex',flexDirection:'column',gap:10}}>
                    {/* Забрать */}
                    <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                      <div style={{width:28,height:28,borderRadius:8,background:'rgba(31,215,96,.12)',border:'1px solid rgba(31,215,96,.25)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,flexShrink:0}}>
                        {order.type==='restaurant'?'🍽':'🛒'}
                      </div>
                      <div>
                        <div style={{fontSize:10,color:'var(--t3)',fontWeight:700,marginBottom:1}}>ЗАБРАТЬ</div>
                        <div style={{fontSize:13,fontWeight:700}}>{order.pickupName}</div>
                        <div style={{fontSize:11,color:'var(--t3)',marginTop:1}}>{order.items.map(it=>it.e+' '+it.n).join(' · ')}</div>
                      </div>
                    </div>
                    {/* Стрелка */}
                    <div style={{paddingLeft:8,color:'var(--t3)',fontSize:12}}>↓ {order.dist} км</div>
                    {/* Доставить */}
                    <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                      <div style={{width:28,height:28,borderRadius:8,background:'rgba(155,109,255,.12)',border:'1px solid rgba(155,109,255,.25)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,flexShrink:0}}>📍</div>
                      <div>
                        <div style={{fontSize:10,color:'var(--t3)',fontWeight:700,marginBottom:1}}>ДОСТАВИТЬ</div>
                        <div style={{fontSize:13,fontWeight:700}}>{order.client}</div>
                        <div style={{fontSize:11,color:'var(--t3)',marginTop:1}}>{order.addr} · {order.pay}</div>
                      </div>
                    </div>
                  </div>
                  <div style={{padding:'12px 16px'}}>
                    {activeOrder ? (
                      <div style={{padding:10,borderRadius:12,background:'rgba(255,184,0,.06)',border:'1px solid rgba(255,184,0,.2)',textAlign:'center',fontSize:12,color:'var(--t3)'}}>
                        Сначала завершите текущий заказ
                      </div>
                    ) : (
                      <button onClick={()=>accept(order)} className="btn"
                        style={{width:'100%',padding:13,borderRadius:13,background:'linear-gradient(135deg,var(--gr2),var(--gr))',border:'none',color:'var(--bg)',fontFamily:'Nunito',fontWeight:800,fontSize:14}}>
                        ✓ Принять — +{order.earning} ЅМ
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {ORDERS.filter(o=>o.id!==activeId).length===0&&(
                <div style={{textAlign:'center',padding:'30px 20px',background:'var(--l2)',borderRadius:18,border:'1px solid var(--b1)'}}>
                  <div style={{fontSize:40,marginBottom:10}}>✅</div>
                  <div className="ub" style={{fontSize:13,fontWeight:800}}>Нет новых заказов</div>
                  <div style={{fontSize:11,color:'var(--t3)',marginTop:4}}>Ожидай следующего заказа...</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
const NotifPage = ({go, user}) => {
  const phone = getActiveClientPhone(user);
  const [notifs, setNotifs] = useState(() => loadClientNotifications(!USE_API, phone));

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
    if (n.action === 'reviews') go('reviews');
    else if (n.action === 'orders') go('orders');
  };

  const unread = notifs.filter(n => !n.read).length;

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',maxWidth:480,margin:'0 auto'}}>
      <header style={{position:'sticky',top:0,zIndex:100,background:'rgba(3,11,5,.96)',backdropFilter:'blur(24px)',borderBottom:'1px solid var(--b1)'}}>
        <div style={{padding:'14px 18px 13px',display:'flex',alignItems:'center',gap:10}}>
          <button onClick={()=>go('profile')} className="btn" style={{width:38,height:38,borderRadius:12,background:'var(--l3)',border:'1px solid var(--b1)',display:'flex',alignItems:'center',justifyContent:'center'}}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div style={{flex:1}}>
            <div className="ub" style={{fontSize:17,fontWeight:900}}>Уведомления</div>
            {unread>0&&<div style={{fontSize:10,color:'var(--red)',marginTop:1}}>{unread} непрочитанных</div>}
          </div>
          {unread>0&&<button onClick={markAll} className="btn" style={{fontSize:11,color:'var(--gr)',background:'rgba(31,215,96,.1)',border:'1px solid rgba(31,215,96,.25)',borderRadius:10,padding:'6px 12px',fontFamily:'Nunito',fontWeight:700}}>Прочитать все</button>}
        </div>
      </header>
      <div style={{padding:'14px 18px 100px',display:'flex',flexDirection:'column',gap:8}}>
        {notifs.length === 0 && (
          <div style={{ textAlign:'center', padding:'48px 20px', color:'var(--t3)', fontSize:13 }}>
            <div style={{ fontSize:40, marginBottom:10 }}>🔔</div>
            Пока нет уведомлений
            {!phone && (
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--t2)', lineHeight: 1.5 }}>
                Войдите с телефоном из CRM — тогда push-рассылки будут приходить сюда
              </div>
            )}
          </div>
        )}
        {notifs.map((n,i)=>(
          <div key={n.id} onClick={()=>openNotif(n)}
            style={{display:'flex',gap:12,padding:'14px 16px',background:n.read?'var(--l2)':'rgba(31,215,96,.06)',border:`1px solid ${n.read?'var(--b1)':'rgba(31,215,96,.2)'}`,borderRadius:16,cursor:'pointer',animation:`fadeUp .4s cubic-bezier(.16,1,.3,1) ${i*.04}s both`}}>
            <div style={{width:42,height:42,borderRadius:13,background:`${n.color}14`,border:`1px solid ${n.color}25`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>{n.icon}</div>
            <div style={{flex:1}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:3}}>
                <span style={{fontSize:13,fontWeight:n.read?600:800,color:n.read?'var(--t1)':n.color}}>{n.title}</span>
                <span style={{fontSize:10,color:'var(--t3)',flexShrink:0,marginLeft:8}}>{n.time}</span>
              </div>
              <div style={{fontSize:12,color:'var(--t2)',lineHeight:1.5}}>{n.body}</div>
              {n.action === 'reviews' && !n.read && (
                <div style={{ fontSize:10, color:'var(--gr)', fontWeight:700, marginTop:6 }}>Нажмите, чтобы открыть отзывы →</div>
              )}
            </div>
            {!n.read&&<div style={{width:8,height:8,borderRadius:'50%',background:'var(--gr)',marginTop:4,flexShrink:0,animation:'pulse 2s infinite'}}/>}
          </div>
        ))}
      </div>
      <Nav page="profile" go={go}/>
    </div>
  );
};

const DEFAULT_ADDRESSES = [
  { id: 1, label: '🏠 Дом', street: 'ул. Ленина, 42', apt: '15', floor: '3', ent: '2', comment: 'Домофон 15', def: true, lat: 38.3260, lng: 69.0280 },
  { id: 2, label: '💼 Работа', street: 'ул. Сомони, 12', apt: '', floor: '1', ent: '1', comment: '', def: false, lat: 38.3160, lng: 69.0340 },
];

const AddressesPage = ({ go, user }) => {
  const clientPhone = user?.phone || getActiveClientPhone(user);
  const [addrs, setAddrs] = useState(() => {
    const saved = loadClientAddresses(clientPhone);
    return saved.length ? saved : (clientPhone ? [] : DEFAULT_ADDRESSES);
  });
  const [showAdd, setShowAdd] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [street, setStreet] = useState('');
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
    saveClientAddresses(addrs, clientPhone);
  }, [addrs, clientPhone]);

  const resetForm = () => {
    setShowAdd(false);
    setMapOpen(false);
    setEditId(null);
    setStreet('');
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
    setApt('');
    setFloor('');
    setEnt('');
    setComment('');
    setCoords(null);
    setLabel('🏠 Дом');
    setMapOpen(false);
    setShowAdd(true);
  };

  const openEdit = (a) => {
    setEditId(a.id);
    setLabel(a.label);
    setStreet(a.street);
    setApt(a.apt || '');
    setFloor(a.floor || '');
    setEnt(a.ent || '');
    setComment(a.comment || '');
    setCoords(a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : null);
    setMapOpen(false);
    setShowAdd(true);
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
    <div style={{minHeight:'100vh',background:'var(--bg)',maxWidth:480,margin:'0 auto'}}>
      <header style={{position:'sticky',top:0,zIndex:100,background:'rgba(3,11,5,.96)',backdropFilter:'blur(24px)',borderBottom:'1px solid var(--b1)'}}>
        <div style={{padding:'14px 18px 13px',display:'flex',alignItems:'center',gap:10}}>
          <button onClick={()=>go('profile')} className="btn" style={{width:38,height:38,borderRadius:12,background:'var(--l3)',border:'1px solid var(--b1)',display:'flex',alignItems:'center',justifyContent:'center'}}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div className="ub" style={{fontSize:17,fontWeight:900,flex:1}}>Мои адреса</div>
          <button onClick={openAdd} className="btn" style={{padding:'8px 14px',borderRadius:12,background:'linear-gradient(135deg,var(--gr2),var(--gr))',border:'none',color:'var(--bg)',fontSize:12,fontFamily:'Nunito',fontWeight:700}}>+ Добавить</button>
        </div>
      </header>
      <div style={{padding:'16px 18px 100px',display:'flex',flexDirection:'column',gap:12}}>
        {addrs.map((a,i)=>(
          <div key={a.id} className="card" style={{padding:'16px',border:`1.5px solid ${a.def?'rgba(31,215,96,.35)':'var(--b1)'}`,animation:`fadeUp .4s cubic-bezier(.16,1,.3,1) ${i*.08}s both`}}>
            <div style={{display:'flex',alignItems:'flex-start',gap:12}}>
              <div style={{width:44,height:44,borderRadius:13,background:a.def?'rgba(31,215,96,.14)':'var(--l3)',border:`1px solid ${a.def?'rgba(31,215,96,.3)':'var(--b1)'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>{a.label.split(' ')[0]}</div>
              <div style={{flex:1}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                  <span style={{fontSize:13,fontWeight:800}}>{a.label}</span>
                  {a.def&&<span style={{padding:'2px 7px',borderRadius:7,fontSize:10,fontWeight:800,background:'rgba(31,215,96,.12)',color:'var(--gr)',border:'1px solid rgba(31,215,96,.28)'}}>По умолчанию</span>}
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
              {!a.def&&<button onClick={()=>setDef(a.id)} className="btn" style={{flex:1,padding:'9px',borderRadius:11,background:'rgba(31,215,96,.08)',border:'1px solid rgba(31,215,96,.25)',color:'var(--gr)',fontSize:12,fontFamily:'Nunito',fontWeight:700}}>✓ Сделать основным</button>}
              <button onClick={() => openEdit(a)} className="btn" style={{flex:1,padding:'9px',borderRadius:11,background:'var(--l3)',border:'1px solid var(--b1)',color:'var(--t2)',fontSize:12,fontFamily:'Nunito',fontWeight:700}}>✏️ Изменить</button>
              {!a.def&&<button onClick={()=>remove(a.id)} className="btn" style={{width:38,height:38,borderRadius:11,background:'rgba(255,69,69,.1)',border:'1px solid rgba(255,69,69,.25)',color:'var(--red)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>🗑</button>}
            </div>
          </div>
        ))}
        <div style={{padding:'16px',borderRadius:16,background:'rgba(31,215,96,.06)',border:'1.5px dashed rgba(31,215,96,.3)',textAlign:'center',cursor:'pointer'}} onClick={openAdd}>
          <div style={{fontSize:28,marginBottom:6}}>📍</div>
          <div style={{fontSize:13,fontWeight:700,color:'var(--gr)'}}>Добавить новый адрес</div>
          <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>С точкой на карте для курьера</div>
        </div>
      </div>
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={resetForm} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.8)', backdropFilter: 'blur(8px)' }} />
          <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 480, background: 'var(--l1)', borderTop: '1px solid var(--b1)', borderRadius: '24px 24px 0 0', padding: '20px 16px calc(40px + env(safe-area-inset-bottom, 0px))', maxHeight: '92vh', overflowY: 'auto', overflowX: 'hidden', boxSizing: 'border-box', animation: 'slideUp .4s cubic-bezier(.16,1,.3,1)' }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--b2)', margin: '0 auto 18px' }} />
            <div className="ub" style={{ fontSize: 15, fontWeight: 800, marginBottom: 16 }}>{editId != null ? 'Изменить адрес' : 'Новый адрес'}</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {['🏠 Дом', '💼 Работа', '📍 Другое'].map(l => (
                <button key={l} onClick={() => setLabel(l)} className="btn" style={{ flex: 1, padding: '8px 4px', borderRadius: 10, fontSize: 12, fontWeight: 700, border: `1.5px solid ${label === l ? 'rgba(31,215,96,.4)' : 'var(--b1)'}`, background: label === l ? 'rgba(31,215,96,.1)' : 'var(--l3)', color: label === l ? 'var(--gr)' : 'var(--t2)', fontFamily: 'Nunito' }}>{l}</button>
              ))}
            </div>

            {!mapOpen ? (
              <button
                type="button"
                onClick={() => setMapOpen(true)}
                className="btn"
                style={{ width: '100%', marginBottom: 12, padding: '14px', borderRadius: 14, background: coords ? 'rgba(59,142,240,.1)' : 'rgba(31,215,96,.08)', border: `1.5px solid ${coords ? 'rgba(59,142,240,.35)' : 'rgba(31,215,96,.35)'}`, color: coords ? 'var(--sky)' : 'var(--gr)', fontSize: 13, fontWeight: 700, fontFamily: 'Nunito' }}
              >
                {coords ? '✓ Точка выбрана · изменить на карте' : '🗺 Указать точку на карте'}
              </button>
            ) : (
              <div style={{ marginBottom: 12 }}>
                <button type="button" onClick={() => setMapOpen(false)} className="btn" style={{ marginBottom: 8, padding: '6px 10px', borderRadius: 8, background: 'var(--l3)', border: '1px solid var(--b1)', color: 'var(--t2)', fontSize: 11, fontWeight: 700, fontFamily: 'Nunito' }}>← Назад к полям</button>
                <AddressMapPicker
                  key={editId != null ? `edit-${editId}-${coords?.lat}-${coords?.lng}` : 'new'}
                  initial={coords}
                  onSelect={({ lat, lng, address }) => {
                    setCoords({ lat, lng });
                    setStreet(address);
                    setMapOpen(false);
                  }}
                />
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 5, fontWeight: 700 }}>Улица, дом *</div>
                <input className="inp" value={street} onChange={e => setStreet(e.target.value)} placeholder="ул. Ленина, 42" style={{ width: '100%' }} />
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
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--gd)', fontWeight: 600 }}>⚠️ Укажите точку на карте — курьер увидит ваш дом</div>
            )}
            <button onClick={save} className="btn" style={{ width: '100%', marginTop: 14, padding: '14px', borderRadius: 15, background: 'linear-gradient(135deg,var(--gr2),var(--gr))', border: 'none', color: 'white', fontSize: 14, fontFamily: 'Nunito', fontWeight: 700, opacity: street && coords ? 1 : 0.5 }}>
              📍 {editId != null ? 'Сохранить изменения' : 'Сохранить адрес'}
            </button>
          </div>
        </div>
      )}
      <Nav page="profile" go={go}/>
    </div>
  );
};
const ReferralPage = ({go}) => {
  const [copied, setCopied] = useState(false);
  const code = 'КАКАПО-D7F2';
  const stats = [{l:'Приглашено',v:'7',c:'var(--blue)'},{l:'Зарегистрировалось',v:'4',c:'var(--gr)'},{l:'Сделали заказ',v:'3',c:'var(--gd)'},{l:'Ваш заработок',v:'150 ⭐',c:'var(--gd)'}];
  const friends = [
    {name:'Нилуфар Х.',date:'12 мая',status:'ordered',bonus:50},
    {name:'Бахром К.', date:'10 мая',status:'ordered',bonus:50},
    {name:'Рустам Д.', date:'8 мая', status:'ordered',bonus:50},
    {name:'Зубайр М.', date:'5 мая', status:'registered',bonus:0},
  ];

  const copy = () => {
    try{navigator.clipboard.writeText(code);}catch{}
    setCopied(true); setTimeout(()=>setCopied(false),2000);
  };

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',maxWidth:480,margin:'0 auto'}}>
      <header style={{position:'sticky',top:0,zIndex:100,background:'rgba(3,11,5,.96)',backdropFilter:'blur(24px)',borderBottom:'1px solid var(--b1)'}}>
        <div style={{padding:'14px 18px 13px',display:'flex',alignItems:'center',gap:10}}>
          <button onClick={()=>go('profile')} className="btn" style={{width:38,height:38,borderRadius:12,background:'var(--l3)',border:'1px solid var(--b1)',display:'flex',alignItems:'center',justifyContent:'center'}}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div className="ub" style={{fontSize:17,fontWeight:900,flex:1}}>Пригласи друга</div>
        </div>
      </header>
      <div style={{padding:'16px 18px 100px'}}>
        <div style={{borderRadius:22,background:'linear-gradient(135deg,#061A0C,#0F3020)',border:'1px solid rgba(31,215,96,.2)',padding:'24px',textAlign:'center',marginBottom:18,position:'relative',overflow:'hidden'}}>
          <div style={{position:'absolute',left:0,right:0,height:1,background:'linear-gradient(90deg,transparent,rgba(31,215,96,.5),transparent)',animation:'scanLine 3s linear infinite'}}/>
          <div style={{fontSize:48,marginBottom:10,animation:'float 3s ease-in-out infinite'}}>🎁</div>
          <div className="ub" style={{fontSize:18,fontWeight:900,marginBottom:6}}>Пригласи — получи бонусы</div>
          <div style={{fontSize:13,color:'var(--t2)',lineHeight:1.65,marginBottom:16}}>
            За каждого друга который сделает первый заказ —<br/>
            <span style={{color:'var(--gr)',fontWeight:700}}>ты +50 бонусов</span>, он <span style={{color:'var(--gd)',fontWeight:700}}>+100 бонусов</span>
          </div>
          <div style={{background:'var(--bg)',borderRadius:14,padding:'14px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',border:'1px solid rgba(31,215,96,.25)'}}>
            <div>
              <div style={{fontSize:10,color:'var(--t3)',marginBottom:3}}>Твой реферальный код</div>
              <div className="ub" style={{fontSize:18,fontWeight:900,color:'var(--gr)',letterSpacing:2}}>{code}</div>
            </div>
            <button onClick={copy} className="btn" style={{padding:'9px 16px',borderRadius:11,background:copied?'rgba(31,215,96,.2)':'rgba(31,215,96,.1)',border:`1.5px solid ${copied?'rgba(31,215,96,.5)':'rgba(31,215,96,.3)'}`,color:'var(--gr)',fontSize:12,fontFamily:'Nunito',fontWeight:700}}>
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
            {e:'📨',l:'Telegram',c:'#29B6F6',bg:'rgba(41,182,246,.1)'},
          ].map((s,i)=>(
            <button key={i} className="btn" style={{padding:'13px',borderRadius:14,background:s.bg,border:`1.5px solid ${s.c}30`,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
              <span style={{fontSize:22}}>{s.e}</span>
              <span style={{fontSize:13,fontWeight:700,color:s.c,fontFamily:'Nunito'}}>Поделиться в {s.l}</span>
            </button>
          ))}
        </div>

        <div className="ub" style={{fontSize:14,fontWeight:800,marginBottom:12}}>Мои приглашённые</div>
        <div className="card" style={{overflow:'hidden'}}>
          {friends.map((f,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 15px',borderBottom:i<friends.length-1?'1px solid var(--b1)':'none'}}>
              <div style={{width:36,height:36,borderRadius:'50%',background:'linear-gradient(135deg,var(--gr3),var(--gr))',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:13,fontWeight:900,color:'var(--bg)',flexShrink:0}}>{f.name.charAt(0)}</div>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:700}}>{f.name}</div>
                <div style={{fontSize:11,color:'var(--t3)',marginTop:1}}>{f.date}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <span style={{padding:'3px 9px',borderRadius:8,fontSize:11,fontWeight:800,background:f.status==='ordered'?'rgba(31,215,96,.12)':'rgba(255,184,0,.12)',color:f.status==='ordered'?'var(--gr)':'var(--gd)',border:`1px solid ${f.status==='ordered'?'rgba(31,215,96,.28)':'rgba(255,184,0,.28)'}`}}>
                  {f.status==='ordered'?'Заказал':'Зарегистрировался'}
                </span>
                {f.bonus>0&&<div style={{fontSize:11,color:'var(--gd)',fontWeight:700,marginTop:3}}>+{f.bonus} ⭐</div>}
              </div>
            </div>
          ))}
        </div>

        <div className="ub" style={{fontSize:14,fontWeight:800,marginBottom:12,marginTop:20}}>Как это работает</div>
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {[
            {n:'1',t:'Поделись кодом',d:'Отправь свой код другу в WhatsApp или Telegram',c:'var(--blue)'},
            {n:'2',t:'Друг регистрируется',d:'Он вводит твой код при регистрации и получает +100 бонусов',c:'var(--gr)'},
            {n:'3',t:'Друг делает заказ',d:'После первого заказа тебе начисляются +50 бонусов',c:'var(--gd)'},
          ].map((s,i)=>(
            <div key={i} style={{display:'flex',gap:12,alignItems:'center',padding:'14px',background:'var(--l2)',border:'1px solid var(--b1)',borderRadius:14}}>
              <div style={{width:36,height:36,borderRadius:'50%',background:`${s.c}18`,border:`2px solid ${s.c}35`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:15,fontWeight:900,color:s.c,flexShrink:0}}>{s.n}</div>
              <div><div style={{fontSize:13,fontWeight:700,marginBottom:2}}>{s.t}</div><div style={{fontSize:11,color:'var(--t2)'}}>{s.d}</div></div>
            </div>
          ))}
        </div>
      </div>
      <Nav page="profile" go={go}/>
    </div>
  );
};

const ChatPage = ({go}) => {
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
    <div style={{minHeight:'100vh',background:'var(--bg)',maxWidth:480,margin:'0 auto',display:'flex',flexDirection:'column'}}>
      <header style={{position:'sticky',top:0,zIndex:100,background:'rgba(3,11,5,.96)',backdropFilter:'blur(24px)',borderBottom:'1px solid var(--b1)'}}>
        <div style={{padding:'14px 18px 13px',display:'flex',alignItems:'center',gap:10}}>
          <button onClick={()=>go('profile')} className="btn" style={{width:38,height:38,borderRadius:12,background:'var(--l3)',border:'1px solid var(--b1)',display:'flex',alignItems:'center',justifyContent:'center'}}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div style={{width:38,height:38,borderRadius:'50%',background:'linear-gradient(135deg,var(--gr3),var(--gr))',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:14,fontWeight:900,color:'var(--bg)',flexShrink:0}}>K</div>
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
            {m.from!=='me'&&<div style={{width:32,height:32,borderRadius:'50%',background:'linear-gradient(135deg,var(--gr3),var(--gr))',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:12,fontWeight:900,color:'var(--bg)',flexShrink:0,marginTop:'auto'}}>K</div>}
            <div style={{maxWidth:'75%'}}>
              <div style={{padding:'11px 14px',borderRadius:m.from==='me'?'18px 18px 4px 18px':'18px 18px 18px 4px',background:m.from==='me'?'linear-gradient(135deg,var(--gr2),var(--gr))':'var(--l2)',border:m.from==='me'?'none':'1px solid var(--b1)',color:m.from==='me'?'white':'var(--t1)',fontSize:13,lineHeight:1.55}}>
                {m.text}
              </div>
              <div style={{fontSize:10,color:'var(--t3)',marginTop:4,textAlign:m.from==='me'?'right':'left'}}>{m.time}</div>
            </div>
          </div>
        ))}
        {typing&&(
          <div style={{display:'flex',gap:8,animation:'fadeIn .3s ease'}}>
            <div style={{width:32,height:32,borderRadius:'50%',background:'linear-gradient(135deg,var(--gr3),var(--gr))',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:12,fontWeight:900,color:'var(--bg)',flexShrink:0}}>K</div>
            <div style={{padding:'12px 16px',borderRadius:'18px 18px 18px 4px',background:'var(--l2)',border:'1px solid var(--b1)',display:'flex',gap:5,alignItems:'center'}}>
              {[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:'50%',background:'var(--t3)',animation:`pulse 1.4s ease ${i*.2}s infinite`}}/>)}
            </div>
          </div>
        )}
      </div>

      <div style={{padding:'12px 18px 28px',borderTop:'1px solid var(--b1)',background:'rgba(3,11,5,.97)',backdropFilter:'blur(20px)',display:'flex',gap:10}}>
        <input className="inp" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send(input)} placeholder="Написать сообщение..." style={{flex:1}}/>
        <button onClick={()=>send(input)} className="btn" style={{width:46,height:46,borderRadius:13,background:input?'linear-gradient(135deg,var(--gr2),var(--gr))':'var(--l3)',border:input?'none':'1px solid var(--b1)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
          <Ic n="send" s={18} c={input?'white':'var(--t3)'}/>
        </button>
      </div>
    </div>
  );
};

const AssemblerLoginPage = ({go}) => {
  const [pin,  setPin]   = useState(['','','','']);
  const [load, setLoad]  = useState(false);
  const [err,  setErr]   = useState('');

  const verify = () => {
    const code = pin.join('');
    if(code.length<4) return;
    setLoad(true);
    setTimeout(()=>{
      setLoad(false);
      if(code==='5678') go('assembler_dash');
      else {setErr('Неверный PIN. Демо: 5678'); setPin(['','','','']);}
    },700);
  };

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',maxWidth:480,margin:'0 auto',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:24}}>
      <button onClick={()=>go('home')} className="btn" style={{position:'absolute',top:18,left:18,width:40,height:40,borderRadius:12,background:'var(--l3)',border:'1px solid var(--b1)',display:'flex',alignItems:'center',justifyContent:'center'}}>
        <Ic n="arrL" s={17} c="var(--t2)"/>
      </button>
      <div style={{textAlign:'center',marginBottom:28}}>
        <div style={{fontSize:52,marginBottom:14}}>🛒</div>
        <div className="ub" style={{fontSize:20,fontWeight:900,color:'var(--pur)',marginBottom:4}}>Сборщик КАКАПО</div>
        <div style={{fontSize:12,color:'var(--t2)'}}>Введите PIN код</div>
      </div>
      <div style={{width:'100%',maxWidth:340,background:'var(--l2)',border:'1px solid var(--b1)',borderRadius:20,padding:24}}>
        {err&&<div style={{padding:'9px 12px',borderRadius:10,background:'rgba(255,69,69,.1)',border:'1px solid rgba(255,69,69,.3)',fontSize:12,color:'var(--red)',marginBottom:14}}>⚠️ {err}</div>}
        <div style={{display:'flex',gap:10,justifyContent:'center',marginBottom:14}}>
          {pin.map((v,i)=>(
            <input key={i} id={"apin"+i} value={v} type="password"
              onChange={e=>{const d=[...pin];d[i]=e.target.value.replace(/\D/,'').slice(-1);setPin(d);if(e.target.value&&i<3)document.getElementById("apin"+(i+1))?.focus();}}
              onKeyDown={e=>{if(e.key==='Backspace'&&!v&&i>0){document.getElementById("apin"+(i-1))?.focus();const d=[...pin];d[i-1]='';setPin(d);}}}
              maxLength={1} inputMode="numeric"
              style={{width:52,height:60,borderRadius:14,border:`2px solid ${v?'rgba(155,109,255,.5)':'var(--b1)'}`,background:v?'rgba(155,109,255,.08)':'var(--l3)',textAlign:'center',fontFamily:'Unbounded',fontSize:24,fontWeight:900,color:'var(--t1)',outline:'none'}}/>
          ))}
        </div>
        <div style={{padding:'9px 12px',borderRadius:9,background:'rgba(155,109,255,.06)',border:'1px solid rgba(155,109,255,.2)',fontSize:11,color:'var(--t2)',marginBottom:14}}>
          💡 Демо PIN: <span style={{color:'var(--pur)',fontWeight:700}}>5 6 7 8</span>
        </div>
        <button onClick={verify} className="btn" style={{width:'100%',padding:14,borderRadius:14,background:'linear-gradient(135deg,#6B3FD4,var(--pur))',border:'none',color:'white',fontFamily:'Nunito',fontWeight:800,fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:pin.join('').length<4?.5:1}}>
          {load?<div style={{width:18,height:18,borderRadius:'50%',border:'2.5px solid rgba(255,255,255,.3)',borderTopColor:'white',animation:'spin 1s linear infinite'}}/>:'🛒 Войти'}
        </button>
      </div>
    </div>
  );
};

const AssemblerDashPage = ({go}) => {
  const [orders, setOrders] = useState([
    {id:'K-4831',client:'Нилуфар Х.',priority:'normal',status:'pending',items:[
      {e:'🥛',n:'Молоко 3.2%',qty:2,unit:'1 л',   loc:'Молочный, полка 2',done:false},
      {e:'🧀',n:'Сыр Российский',qty:1,unit:'250 гр',loc:'Молочный, полка 3',done:false},
      {e:'☕',n:'Кофе Nescafé',qty:1,unit:'190 гр',loc:'Напитки, полка 1', done:false},
    ]},
    {id:'K-4835',client:'Рустам Д.', priority:'urgent',status:'pending',items:[
      {e:'🥦',n:'Брокколи',   qty:1,unit:'500 гр',loc:'Овощи, стеллаж А',done:false},
      {e:'🍅',n:'Томаты черри',qty:1,unit:'400 гр',loc:'Овощи, стеллаж Б',done:false},
    ]},
  ]);
  const [active, setActive] = useState(null);

  const toggleItem = (orderId, idx) => {
    setOrders(os=>os.map(o=>o.id===orderId?{...o,items:o.items.map((it,i)=>i===idx?{...it,done:!it.done}:it)}:o));
  };

  const order = orders.find(o=>o.id===active);
  const doneCount = order ? order.items.filter(it=>it.done).length : 0;
  const allDone   = order ? doneCount===order.items.length : false;

  if(active&&order) return (
    <div style={{minHeight:'100vh',background:'var(--bg)',maxWidth:480,margin:'0 auto'}}>
      <header style={{position:'sticky',top:0,zIndex:100,background:'rgba(3,11,5,.96)',backdropFilter:'blur(24px)',borderBottom:'1px solid var(--b1)'}}>
        <div style={{padding:'14px 18px 13px',display:'flex',alignItems:'center',gap:10}}>
          <button onClick={()=>setActive(null)} className="btn" style={{width:38,height:38,borderRadius:12,background:'var(--l3)',border:'1px solid var(--b1)',display:'flex',alignItems:'center',justifyContent:'center'}}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div style={{flex:1}}>
            <div className="ub" style={{fontSize:15,fontWeight:900}}>Сборка {order.id}</div>
            <div style={{fontSize:10,color:'var(--t2)',marginTop:1}}>{order.client} · {doneCount}/{order.items.length} собрано</div>
          </div>
          <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:800,color:allDone?'var(--gr)':'var(--gd)'}}>{doneCount}/{order.items.length}</div>
        </div>
        <div style={{height:4,background:'var(--b1)',margin:'0 18px 14px'}}>
          <div style={{height:'100%',width:`${(doneCount/order.items.length)*100}%`,background:'var(--gr)',transition:'width .4s ease',borderRadius:2}}/>
        </div>
      </header>

      <div style={{padding:'14px 18px 120px',display:'flex',flexDirection:'column',gap:10}}>
        {order.items.map((it,i)=>(
          <div key={i} onClick={()=>toggleItem(order.id,i)}
            style={{display:'flex',gap:12,padding:'16px',borderRadius:16,background:it.done?'rgba(31,215,96,.08)':'var(--l2)',border:`1.5px solid ${it.done?'rgba(31,215,96,.35)':'var(--b1)'}`,cursor:'pointer',transition:'all .2s',animation:`fadeUp .35s ease ${i*.06}s both`}}>
            <div style={{width:46,height:46,borderRadius:13,background:it.done?'rgba(31,215,96,.15)':'var(--l3)',border:`1px solid ${it.done?'rgba(31,215,96,.3)':'var(--b1)'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,flexShrink:0,position:'relative'}}>
              {it.e}
              {it.done&&<div style={{position:'absolute',inset:0,borderRadius:13,background:'rgba(31,215,96,.3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>✓</div>}
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:700,textDecoration:it.done?'line-through':'none',color:it.done?'var(--t3)':'var(--t1)',marginBottom:3}}>{it.n}</div>
              <div style={{fontSize:12,color:it.done?'var(--t3)':'var(--t2)',marginBottom:4}}>{it.qty} шт · {it.unit}</div>
              <div style={{display:'inline-flex',alignItems:'center',gap:5,padding:'3px 9px',borderRadius:8,background:'rgba(59,142,240,.1)',border:'1px solid rgba(59,142,240,.2)'}}>
                <span style={{fontSize:12}}>📍</span><span style={{fontSize:11,color:'var(--blue)',fontWeight:600}}>{it.loc}</span>
              </div>
            </div>
            <div style={{width:28,height:28,borderRadius:'50%',border:`2px solid ${it.done?'var(--gr)':'var(--b2)'}`,background:it.done?'var(--gr)':'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:'auto'}}>
              {it.done&&<svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
            </div>
          </div>
        ))}
      </div>

      <div style={{position:'fixed',bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:480,zIndex:90,background:'rgba(3,11,5,.97)',backdropFilter:'blur(26px)',borderTop:'1px solid var(--b1)',padding:'13px 18px 28px'}}>
        {allDone ? (
          <button onClick={()=>setActive(null)} className="btn" style={{width:'100%',padding:15,borderRadius:17,background:'linear-gradient(135deg,var(--gr2),var(--gr))',border:'none',color:'white',fontFamily:'Nunito',fontWeight:800,fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',gap:10}}>
            🚀 Всё собрано — передать курьеру
          </button>
        ) : (
          <div style={{textAlign:'center',padding:'12px',background:'var(--l2)',borderRadius:14,border:'1px solid var(--b1)',fontSize:13,color:'var(--t2)'}}>
            Отметь каждый товар по мере сбора
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',maxWidth:480,margin:'0 auto'}}>
      <header style={{position:'sticky',top:0,zIndex:100,background:'rgba(3,11,5,.96)',backdropFilter:'blur(24px)',borderBottom:'1px solid var(--b1)'}}>
        <div style={{padding:'14px 18px 13px',display:'flex',alignItems:'center',gap:10}}>
          <button onClick={()=>go('home')} className="btn" style={{width:38,height:38,borderRadius:12,background:'var(--l3)',border:'1px solid var(--b1)',display:'flex',alignItems:'center',justifyContent:'center'}}><Ic n="arrL" s={17} c="var(--t2)"/></button>
          <div style={{flex:1}}>
            <div className="ub" style={{fontSize:16,fontWeight:900,color:'var(--pur)'}}>Сборщик КАКАПО</div>
            <div style={{fontSize:10,color:'var(--t2)',marginTop:1}}>Новых заказов: {orders.length}</div>
          </div>
        </div>
      </header>
      <div style={{padding:'14px 18px 24px',display:'flex',flexDirection:'column',gap:12}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:4}}>
          {[{l:'На сборке',v:orders.length,c:'var(--pur)'},{l:'Собрано сегодня',v:'12',c:'var(--gr)'},{l:'Ср. время',v:'8 мин',c:'var(--gd)'}].map((s,i)=>(
            <div key={i} style={{background:'var(--l2)',border:'1px solid var(--b1)',borderRadius:14,padding:'12px 10px',textAlign:'center'}}>
              <div className="ub" style={{fontSize:16,fontWeight:900,color:s.c,marginBottom:3}}>{s.v}</div>
              <div style={{fontSize:10,color:'var(--t3)'}}>{s.l}</div>
            </div>
          ))}
        </div>
        {orders.map((o,i)=>(
          <div key={o.id} className="card" onClick={()=>setActive(o.id)} style={{cursor:'pointer',animation:`fadeUp .4s ease ${i*.08}s both`}}>
            {o.priority==='urgent'&&(
              <div style={{padding:'7px 14px',background:'rgba(255,69,69,.08)',borderBottom:'1px solid rgba(255,69,69,.2)',display:'flex',alignItems:'center',gap:6}}>
                <div style={{width:6,height:6,borderRadius:'50%',background:'var(--red)',animation:'pulse 1s infinite'}}/>
                <span style={{fontSize:11,fontWeight:800,color:'var(--red)'}}>⚡ Срочно — курьер ждёт</span>
              </div>
            )}
            <div style={{padding:'14px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                <div>
                  <div className="ub" style={{fontSize:14,fontWeight:900,color:'var(--pur)'}}>{o.id}</div>
                  <div style={{fontSize:11,color:'var(--t2)',marginTop:2}}>{o.client} · {o.items.length} товаров</div>
                </div>
                <div style={{padding:'8px 14px',borderRadius:12,background:'linear-gradient(135deg,#6B3FD4,var(--pur))',color:'white',fontSize:12,fontWeight:700,fontFamily:'Nunito'}}>Собрать →</div>
              </div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {o.items.map((it,i)=>(
                  <span key={i} style={{padding:'4px 9px',borderRadius:8,fontSize:12,background:'var(--l3)',border:'1px solid var(--b1)',color:'var(--t2)'}}>{it.e} {it.n}</span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
const AdminFinancePage = ({go}) => {
  const [period, setPeriod] = useState('month');
  const DAYS = [
    {d:'1 мая',r:1240,o:18},{d:'3 мая',r:1890,o:24},{d:'5 мая',r:1540,o:21},
    {d:'7 мая',r:2100,o:29},{d:'9 мая',r:1780,o:23},{d:'11 мая',r:2340,o:31},
    {d:'13 мая',r:2560,o:34},{d:'15 мая',r:2920,o:39},{d:'16 мая',r:3580,o:48},
  ];
  const total   = DAYS.reduce((s,d)=>s+d.r,0);
  const orders  = DAYS.reduce((s,d)=>s+d.o,0);
  const avgCheck= Math.round(total/orders);
  const maxR    = Math.max(...DAYS.map(d=>d.r));

  return (
    <AdminWrap go={go} title="Финансы" subtitle="Выручка и аналитика продаж">
      <div style={{display:'flex',gap:8,marginBottom:18}}>
        {[{id:'week',l:'Неделя'},{id:'month',l:'Месяц'},{id:'quarter',l:'Квартал'}].map(p=>(
          <button key={p.id} onClick={()=>setPeriod(p.id)} className="ab"
            style={{padding:'8px 16px',fontSize:12,background:period===p.id?'rgba(31,215,96,.12)':'#0C1C0F',border:`1.5px solid ${period===p.id?'rgba(31,215,96,.35)':'#162B1A'}`,color:period===p.id?'#1FD760':'#8FB897'}}>
            {p.l}
          </button>
        ))}
        <div style={{marginLeft:'auto',display:'flex',gap:8}}>
          <button className="ab abg" style={{display:'flex',alignItems:'center',gap:6}}>📊 Excel</button>
          <button className="ab abg" style={{display:'flex',alignItems:'center',gap:6}}>📄 PDF</button>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:20}}>
        {[
          {l:'Выручка',       v:`${total.toLocaleString()} ЅМ`, c:'#1FD760',t:'+18%'},
          {l:'Заказов',       v:orders,                          c:'#3B8EF0',t:'+12%'},
          {l:'Средний чек',   v:`${avgCheck} ЅМ`,                c:'#00D4C8',t:'+5%'},
          {l:'Возвратов',     v:'2',                             c:'#FF4545',t:'-3%'},
        ].map((s,i)=>(
          <div key={i} className="ac" style={{padding:18}}>
            <div style={{fontSize:11,color:'#8FB897',marginBottom:10}}>{s.l}</div>
            <div className="ub" style={{fontSize:22,fontWeight:900,color:'#EBF5ED',marginBottom:6}}>{s.v}</div>
            <span style={{padding:'2px 8px',borderRadius:8,fontSize:10,fontWeight:800,background:`${s.c}14`,color:s.c}}>{s.t}</span>
          </div>
        ))}
      </div>

      <div className="ac" style={{padding:20,marginBottom:16}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
          <div className="ub" style={{fontSize:14,fontWeight:800}}>Выручка по дням</div>
          <div style={{fontSize:12,color:'#8FB897'}}>Май 2025</div>
        </div>
        <div style={{display:'flex',gap:4,alignItems:'flex-end',height:140}}>
          {DAYS.map((d,i)=>(
            <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
              <div style={{fontSize:9,color:'#FFB800',fontWeight:700,fontFamily:'Unbounded',opacity:0.9}}>{d.r>=1000?`${(d.r/1000).toFixed(1)}k`:d.r}</div>
              <div style={{width:'100%',borderRadius:'4px 4px 0 0',background:`linear-gradient(180deg,#1FD760,#17B34E)`,height:`${Math.round((d.r/maxR)*110)}px`,transition:'height .5s ease',boxShadow:'0 2px 8px rgba(31,215,96,.3)'}}/>
              <div style={{fontSize:9,color:'#3D6645',textAlign:'center',lineHeight:1.2}}>{d.d.split(' ')[0]}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
        <div className="ac" style={{padding:18}}>
          <div className="ub" style={{fontSize:13,fontWeight:800,marginBottom:14}}>По категориям</div>
          {[
            {e:'🥦',l:'Овощи/фрукты',pct:28,v:'12 345'},
            {e:'🥩',l:'Мясо',         pct:22,v:'9 680'},
            {e:'🥛',l:'Молочное',     pct:18,v:'7 921'},
            {e:'🧃',l:'Напитки',      pct:12,v:'5 280'},
            {e:'🍫',l:'Остальное',    pct:20,v:'8 794'},
          ].map((c,i)=>(
            <div key={i} style={{marginBottom:10}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                <span style={{fontSize:12,fontWeight:600}}>{c.e} {c.l}</span>
                <span style={{fontSize:11,color:'#FFB800',fontWeight:700}}>{c.v} ЅМ</span>
              </div>
              <div style={{height:6,background:'#162B1A',borderRadius:3,overflow:'hidden'}}>
                <div style={{height:'100%',width:`${c.pct}%`,background:'linear-gradient(90deg,#17B34E,#1FD760)',borderRadius:3}}/>
              </div>
            </div>
          ))}
        </div>
        <div className="ac" style={{padding:18}}>
          <div className="ub" style={{fontSize:13,fontWeight:800,marginBottom:14}}>Топ товары</div>
          {[
            {e:'🥛',n:'Молоко 3.2%',  sold:2100,rev:10290},
            {e:'🥦',n:'Брокколи',     sold:1240,rev:6820},
            {e:'🥩',n:'Говядина',     sold:445, rev:16910},
            {e:'🥐',n:'Круассан',     sold:890, rev:2225},
            {e:'🍫',n:'Шоколад',      sold:789, rev:5129},
          ].map((p,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 0',borderBottom:i<4?'1px solid #162B1A':'none'}}>
              <span style={{fontSize:20,width:28}}>{p.e}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:600}}>{p.n}</div>
                <div style={{fontSize:10,color:'#3D6645'}}>{p.sold} шт</div>
              </div>
              <span className="ub" style={{fontSize:12,fontWeight:700,color:'#FFB800'}}>{p.rev.toLocaleString()} ЅМ</span>
            </div>
          ))}
        </div>
      </div>
    </AdminWrap>
  );
};

const AdminInventoryPage = ({go}) => {
  const [filter,setFilter]=useState('all');
  const STOCK = PRODS.map((p,i)=>({...p,stock:[0,3,5,2,12,0,8,4,1,15,7,2][i],minStock:[5,5,10,5,15,5,10,10,5,10,5,5][i]}));
  const low     = STOCK.filter(p=>p.stock>0&&p.stock<=p.minStock);
  const out     = STOCK.filter(p=>p.stock===0);
  const ok      = STOCK.filter(p=>p.stock>p.minStock);
  const filtered= filter==='all'?STOCK:filter==='low'?low:filter==='out'?out:ok;

  return (
    <AdminWrap go={go} title="Склад" subtitle="Контроль остатков товаров">
      {(out.length>0||low.length>0)&&(
        <div style={{display:'flex',gap:10,marginBottom:18}}>
          {out.length>0&&<div style={{flex:1,padding:'12px 14px',borderRadius:13,background:'rgba(255,69,69,.08)',border:'1px solid rgba(255,69,69,.3)',display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:22}}>🚨</span>
            <div><div style={{fontSize:13,fontWeight:800,color:'var(--red)'}}>Закончилось: {out.length} товаров</div><div style={{fontSize:11,color:'#8FB897'}}>{out.map(p=>p.name).join(', ')}</div></div>
          </div>}
          {low.length>0&&<div style={{flex:1,padding:'12px 14px',borderRadius:13,background:'rgba(255,125,59,.08)',border:'1px solid rgba(255,125,59,.3)',display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:22}}>⚠️</span>
            <div><div style={{fontSize:13,fontWeight:800,color:'var(--org)'}}>Мало: {low.length} товаров</div><div style={{fontSize:11,color:'#8FB897'}}>Нужно пополнить</div></div>
          </div>}
        </div>
      )}

      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:16}}>
        {[{l:'Всего позиций',v:STOCK.length,c:'var(--t1)'},{l:'В наличии',v:ok.length,c:'var(--gr)'},{l:'Мало',v:low.length,c:'var(--org)'},{l:'Закончилось',v:out.length,c:'var(--red)'}].map((s,i)=>(
          <div key={i} className="ac" style={{padding:'13px 14px'}}>
            <div style={{fontSize:10,color:'#8FB897',marginBottom:6}}>{s.l}</div>
            <div className="ub" style={{fontSize:22,fontWeight:900,color:s.c}}>{s.v}</div>
          </div>
        ))}
      </div>

      <div style={{display:'flex',gap:8,marginBottom:14}}>
        {[{id:'all',l:'Все'},{id:'out',l:'🚨 Закончилось'},{id:'low',l:'⚠️ Мало'},{id:'ok',l:'✅ В наличии'}].map(f=>(
          <button key={f.id} onClick={()=>setFilter(f.id)} className="ab"
            style={{padding:'7px 12px',fontSize:11,background:filter===f.id?'rgba(31,215,96,.12)':'#0C1C0F',border:`1.5px solid ${filter===f.id?'rgba(31,215,96,.35)':'#162B1A'}`,color:filter===f.id?'#1FD760':'#8FB897'}}>
            {f.l}
          </button>
        ))}
      </div>

      <div className="ac">
        <table className="at">
          <thead><tr><th>Артикул</th><th>Товар</th><th>Остаток</th><th>Минимум</th><th>Статус</th><th></th></tr></thead>
          <tbody>
            {filtered.map(p=>{
              const status=p.stock===0?{l:'Нет',c:'var(--red)'}:p.stock<=p.minStock?{l:'Мало',c:'var(--org)'}:{l:'Есть',c:'var(--gr)'};
              return(
                <tr key={p.id}>
                  <td><span style={{fontFamily:'Unbounded',fontSize:11,color:'#FFB800'}}>{p.art}</span></td>
                  <td>
                    <div style={{display:'flex',alignItems:'center',gap:9}}>
                      <div style={{width:32,height:32,borderRadius:9,background:p.grad,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0}}>{p.e}</div>
                      <span style={{fontWeight:700,fontSize:13}}>{p.name}</span>
                    </div>
                  </td>
                  <td>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div style={{width:60,height:8,borderRadius:4,background:'#162B1A',overflow:'hidden'}}>
                        <div style={{height:'100%',width:`${Math.min(100,(p.stock/20)*100)}%`,background:p.stock===0?'var(--red)':p.stock<=p.minStock?'var(--org)':'var(--gr)',borderRadius:4}}/>
                      </div>
                      <span className="ub" style={{fontSize:13,fontWeight:800,color:status.c}}>{p.stock}</span>
                    </div>
                  </td>
                  <td style={{color:'#3D6645'}}>{p.minStock}</td>
                  <td><span style={{padding:'2px 8px',borderRadius:8,fontSize:11,fontWeight:800,background:`${status.c}18`,color:status.c,border:`1px solid ${status.c}30`}}>{status.l}</span></td>
                  <td>
                    <input type="number" placeholder="Пополнить" className="ai" style={{width:100,padding:'5px 9px',fontSize:12}}/>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AdminWrap>
  );
};
const AdminChatSupportPage = ({go}) => {
  const [active, setActive] = useState(0);
  const [reply,  setReply]  = useState('');
  const [chats,  setChats]  = useState([
    {id:1,client:'Нилуфар Х.',phone:'+992 90 123 45 67',order:'K-4831',unread:1,msgs:[
      {from:'client',text:'Хочу уточнить статус заказа K-4831',time:'14:05'},
      {from:'client',text:'Уже 30 минут жду',time:'14:06'},
    ]},
    {id:2,client:'Бахром К.', phone:'+992 88 789 01 23',order:'K-4820',unread:0,msgs:[
      {from:'client',text:'В заказе был не тот сыр',time:'13:40'},
      {from:'admin', text:'Извините за неудобство! Мы вернём вам бонусы.',time:'13:42'},
    ]},
    {id:3,client:'Рустам Д.', phone:'+992 91 654 32 10',order:'',unread:2,msgs:[
      {from:'client',text:'Как работает реферальная программа?',time:'13:00'},
      {from:'client',text:'Где мой код?',time:'13:02'},
    ]},
  ]);

  const activeChat = chats[active];

  const sendReply = () => {
    if(!reply.trim()) return;
    setChats(cs=>cs.map((c,i)=>i===active?{...c,msgs:[...c.msgs,{from:'admin',text:reply,time:new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}]}:c));
    setReply('');
  };

  const QUICK_REPLIES = ['Ваш заказ уже в пути 🛵','Извините за неудобство!','Мы начислим вам бонусы','Уточняю информацию, подождите минуту'];

  return (
    <AdminWrap go={go} title="Чат поддержки" subtitle={`${chats.reduce((s,c)=>s+c.unread,0)} новых сообщений`}>
      <div style={{display:'grid',gridTemplateColumns:'280px 1fr',gap:16,height:'70vh'}}>
        <div className="ac" style={{overflow:'hidden',display:'flex',flexDirection:'column'}}>
          <div style={{padding:'12px 14px',borderBottom:'1px solid #162B1A',fontSize:13,fontWeight:800}}>Диалоги</div>
          <div style={{overflowY:'auto',flex:1}}>
            {chats.map((c,i)=>(
              <div key={c.id} onClick={()=>{setActive(i);setChats(cs=>cs.map((x,j)=>j===i?{...x,unread:0}:x));}}
                style={{padding:'12px 14px',borderBottom:'1px solid #162B1A',cursor:'pointer',background:active===i?'rgba(31,215,96,.07)':'transparent',transition:'background .15s'}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
                  <span style={{fontWeight:700,fontSize:13}}>{c.client}</span>
                  {c.unread>0&&<span style={{width:18,height:18,borderRadius:'50%',background:'var(--red)',fontSize:10,fontWeight:900,color:'white',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded'}}>{c.unread}</span>}
                </div>
                <div style={{fontSize:11,color:'#3D6645',marginBottom:2}}>{c.phone}</div>
                {c.order&&<span style={{fontSize:10,color:'var(--gr)',fontWeight:700}}>{c.order}</span>}
                <div style={{fontSize:11,color:'#8FB897',marginTop:3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.msgs[c.msgs.length-1].text}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="ac" style={{overflow:'hidden',display:'flex',flexDirection:'column'}}>
          <div style={{padding:'12px 16px',borderBottom:'1px solid #162B1A',display:'flex',alignItems:'center',gap:10}}>
            <div style={{width:34,height:34,borderRadius:'50%',background:'linear-gradient(135deg,#0F8A3A,#1FD760)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:13,fontWeight:900,color:'#030B05',flexShrink:0}}>{activeChat.client.charAt(0)}</div>
            <div style={{flex:1}}>
              <div style={{fontWeight:800,fontSize:13}}>{activeChat.client}</div>
              <div style={{fontSize:11,color:'#8FB897'}}>{activeChat.phone}{activeChat.order&&` · ${activeChat.order}`}</div>
            </div>
            <button className="ab abg" style={{padding:'5px 12px',fontSize:11}}>📞 Позвонить</button>
          </div>

          <div style={{flex:1,padding:'14px 16px',overflowY:'auto',display:'flex',flexDirection:'column',gap:8}}>
            {activeChat.msgs.map((m,i)=>(
              <div key={i} style={{display:'flex',justifyContent:m.from==='admin'?'flex-end':'flex-start'}}>
                <div style={{maxWidth:'70%',padding:'9px 13px',borderRadius:m.from==='admin'?'14px 14px 4px 14px':'14px 14px 14px 4px',background:m.from==='admin'?'linear-gradient(135deg,#17B34E,#1FD760)':'#0C1C0F',border:m.from==='admin'?'none':'1px solid #162B1A',color:m.from==='admin'?'#030B05':'#EBF5ED',fontSize:13,lineHeight:1.5}}>
                  {m.text}
                  <div style={{fontSize:10,color:m.from==='admin'?'rgba(3,11,5,.5)':'#3D6645',marginTop:4,textAlign:'right'}}>{m.time}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{padding:'8px 16px',borderTop:'1px solid #162B1A',display:'flex',gap:6,overflowX:'auto'}}>
            {QUICK_REPLIES.map((q,i)=>(
              <button key={i} onClick={()=>setReply(q)} className="ab" style={{padding:'5px 10px',fontSize:11,background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',whiteSpace:'nowrap',flexShrink:0}}>
                {q}
              </button>
            ))}
          </div>

          <div style={{padding:'12px 16px',borderTop:'1px solid #162B1A',display:'flex',gap:10}}>
            <input className="ai" value={reply} onChange={e=>setReply(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendReply()} placeholder="Ответить клиенту..." style={{flex:1,padding:'9px 13px'}}/>
            <button onClick={sendReply} className="ab abp" style={{padding:'9px 16px',fontSize:13,display:'flex',alignItems:'center',gap:6}}>Отправить →</button>
          </div>
        </div>
      </div>
    </AdminWrap>
  );
};

const RestaurantsPage = ({go, cart, onAdd}) => {
  const { restaurants, prods } = useLiveCatalog();
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
    <div style={{minHeight:'100vh',background:'var(--bg)',maxWidth:480,margin:'0 auto'}}>
      <header style={{position:'sticky',top:0,zIndex:100,background:'rgba(3,11,5,.96)',backdropFilter:'blur(24px)',borderBottom:'1px solid var(--b1)'}}>
        <div style={{padding:'13px 18px 12px',display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:40,height:40,borderRadius:12,background:'linear-gradient(135deg,var(--gr3),var(--gr))',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:17,fontWeight:900,color:'var(--bg)',animation:'glow 3s ease-in-out infinite',boxShadow:'0 4px 16px rgba(31,215,96,.4)',flexShrink:0}}>K</div>
          <div className="ub" style={{flex:1,fontSize:16,fontWeight:900}}>Рестораны</div>
          <button onClick={()=>go('cart')} className="btn" style={{width:38,height:38,borderRadius:12,background:totalQtyNum>0?'linear-gradient(135deg,var(--gr2),var(--gr))':'var(--l3)',border:`1px solid ${totalQtyNum>0?'transparent':'var(--b1)'}`,display:'flex',alignItems:'center',justifyContent:'center',position:'relative',boxShadow:totalQtyNum>0?'0 4px 14px rgba(31,215,96,.4)':'none'}}>
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
        <div style={{borderRadius:20,overflow:'hidden',marginBottom:20,background:'linear-gradient(135deg,#0A1A06,#14300F)',border:'1px solid rgba(31,215,96,.2)',padding:'18px 20px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:900,color:'var(--gr)',marginBottom:4}}>Рестораны г. Яван</div>
            <div style={{fontSize:12,color:'var(--t2)',marginBottom:8}}>Заказывай еду из любимых мест · Один курьер</div>
            <div style={{display:'flex',gap:8}}>
              <span style={{padding:'3px 10px',borderRadius:8,fontSize:11,fontWeight:700,background:'rgba(31,215,96,.12)',color:'var(--gr)',border:'1px solid rgba(31,215,96,.25)'}}>{restaurants.length} ресторана</span>
              <span style={{padding:'3px 10px',borderRadius:8,fontSize:11,fontWeight:700,background:'rgba(255,69,69,.1)',color:'var(--red)',border:'1px solid rgba(255,69,69,.25)'}}>{restaurants.filter(x=>x.open).length} открыто</span>
            </div>
          </div>
          <div style={{fontSize:48,animation:'float 3s ease-in-out infinite'}}>🍽</div>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          {filtered.map((r,i)=>(
            <div key={r.id} onClick={()=>go('restaurant',{rid:r.id})} className="card" style={{cursor:'pointer',animation:`fadeUp .45s cubic-bezier(.16,1,.3,1) ${i*.07}s both`,opacity:r.open?1:.7}}>
              <div style={{height:130,background:r.img,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 18px',position:'relative',overflow:'hidden'}}>
                <div style={{position:'absolute',inset:0,opacity:.04,background:'repeating-linear-gradient(45deg,transparent,transparent 8px,rgba(255,255,255,1) 8px,rgba(255,255,255,1) 9px)'}}/>
                <div>
                  <div style={{fontFamily:'Unbounded',fontSize:18,fontWeight:900,color:'white',marginBottom:4,textShadow:'0 2px 8px rgba(0,0,0,.5)'}}>{r.name}</div>
                  <div style={{fontSize:12,color:'rgba(255,255,255,.7)',marginBottom:8}}>{r.cuisine}</div>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                    {r.tags.map((t,j)=><span key={j} style={{padding:'3px 8px',borderRadius:8,fontSize:10,fontWeight:700,background:'rgba(255,255,255,.15)',color:'white'}}>{t}</span>)}
                  </div>
                </div>
                <div style={{fontSize:56,animation:'float 3s ease-in-out infinite',filter:'drop-shadow(0 4px 12px rgba(0,0,0,.5))'}}>{r.emoji}</div>
                {!r.open&&<div style={{position:'absolute',inset:0,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:800,color:'white'}}>🔴 Закрыто</div>}
              </div>
              <div style={{padding:'12px 16px',display:'flex',alignItems:'center'}}>
                <div style={{display:'flex',alignItems:'center',gap:4}}>
                  <span style={{color:'var(--gd)',fontSize:14}}>★</span>
                  <span style={{fontFamily:'Unbounded',fontSize:13,fontWeight:800}}>{r.rating}</span>
                  <span style={{fontSize:11,color:'var(--t3)'}}>({r.reviews})</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {filtered.length===0&&(
          <div style={{textAlign:'center',paddingTop:50}}>
            <div style={{fontSize:52,marginBottom:12}}>🍽</div>
            <div style={{fontFamily:'Unbounded',fontSize:16,fontWeight:800,marginBottom:8}}>Не найдено</div>
            <button onClick={()=>{setSearch('');setFilter('all');}} className="btn" style={{padding:'11px 22px',borderRadius:13,background:'linear-gradient(135deg,var(--gr2),var(--gr))',border:'none',color:'white',fontFamily:'Nunito',fontWeight:700}}>Сбросить</button>
          </div>
        )}
      </div>
      <Nav page="restaurants" go={go}/>
    </div>
  );
};

const ALL_REST_MENU = '__all__';

const RestaurantPage = ({go, params, cart, onAdd, onRm}) => {
  const { restaurants, prods } = useLiveCatalog();
  const r = restaurants.find(x => x.id === (params && params.rid)) || restaurants[0];
  const [activeCat, setActiveCat] = useState(ALL_REST_MENU);
  const totalQty = formatCartBadgeCount(sumCartUnits(cart || {}, prods));
  const totalQtyNum = sumCartUnits(cart || {}, prods);

  useEffect(() => {
    setActiveCat(ALL_REST_MENU);
  }, [r?.id]);

  if (!r) return null;

  const isAllView = activeCat === ALL_REST_MENU;
  const displayMenu = isAllView ? r.menu : r.menu.filter(item => item.cat === activeCat);
  const sectionTitle = isAllView ? 'Все блюда' : activeCat;

  const addItem  = (item) => onAdd && onAdd(`R${r.id}_${item.id}`, item.price, item.name, item.e, r.id);
  const rmItem   = (item) => onRm  && onRm(`R${r.id}_${item.id}`);
  const getQty   = (item) => (cart||{})[`R${r.id}_${item.id}`]||0;

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',maxWidth:480,margin:'0 auto'}}>

      {/* Sticky header — back + name + cart + categories */}
      <header style={{position:'sticky',top:0,zIndex:100,background:'rgba(3,11,5,.96)',backdropFilter:'blur(24px)',borderBottom:'1px solid var(--b1)'}}>
        <div style={{padding:'13px 18px 12px',display:'flex',alignItems:'center',gap:10}}>
          <button onClick={()=>go('restaurants')} className="btn" style={{width:38,height:38,borderRadius:12,background:'var(--l3)',border:'1px solid var(--b1)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            <Ic n="arrL" s={17} c="var(--t2)"/>
          </button>
          <div style={{flex:1,minWidth:0}}>
            <div className="ub" style={{fontSize:15,fontWeight:900,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.name}</div>
            <div style={{display:'flex',alignItems:'center',gap:6,marginTop:1}}>
              <span style={{fontSize:10,color:'var(--gd)',fontWeight:700}}>★ {r.rating}</span>
              <span style={{fontSize:10,color:'var(--t3)'}}>· {r.cuisine}</span>
              <span style={{fontSize:10,color:r.open?'var(--gr)':'var(--red)',fontWeight:700}}>{r.open?'● Открыто':'● Закрыто'}</span>
            </div>
          </div>
          <button onClick={()=>go('cart')} className="btn" style={{width:38,height:38,borderRadius:12,background:totalQtyNum>0?'linear-gradient(135deg,var(--gr2),var(--gr))':'var(--l3)',border:`1px solid ${totalQtyNum>0?'transparent':'var(--b1)'}`,display:'flex',alignItems:'center',justifyContent:'center',position:'relative',boxShadow:totalQtyNum>0?'0 4px 14px rgba(31,215,96,.4)':'none',flexShrink:0}}>
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
      <div style={{height:180,background:r.img,display:'flex',alignItems:'flex-end',padding:'18px',position:'relative',overflow:'hidden'}}>
        <div style={{position:'absolute',inset:0,background:'linear-gradient(transparent 30%,rgba(3,11,5,.95))'}}/>
        <div style={{position:'relative',zIndex:1}}>
          <div style={{fontFamily:'Unbounded',fontSize:20,fontWeight:900,color:'white',marginBottom:4}}>{r.name}</div>
          <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
            <span style={{color:'var(--gd)',display:'flex',alignItems:'center',gap:4,fontSize:13}}>★ <span style={{fontWeight:800}}>{r.rating}</span> <span style={{color:'var(--t3)',fontSize:11}}>({r.reviews})</span></span>
            <span style={{width:1,height:14,background:'var(--b1)'}}/>
            <span style={{fontSize:12,color:'var(--t2)'}}>{r.cuisine}</span>
            <span style={{width:1,height:14,background:'var(--b1)'}}/>
            <span style={{fontSize:12,color:r.open?'var(--gr)':'var(--red)',fontWeight:700}}>{r.open?'🟢 Открыто':'🔴 Закрыто'}</span>
          </div>
        </div>
      </div>

      {!r.open && (
        <div style={{margin:'0 18px 12px',padding:'12px 14px',borderRadius:14,background:'rgba(255,69,69,.1)',border:'1px solid rgba(255,69,69,.35)',textAlign:'center'}}>
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
            <div key={item.id} style={{display:'flex',gap:12,padding:'14px',background:'var(--l2)',border:`1px solid ${item.inStock?'var(--b1)':'rgba(255,69,69,.2)'}`,borderRadius:16,animation:`fadeUp .4s ease ${i*.05}s both`,opacity:item.inStock?1:.6}}>
              <div style={{width:80,height:80,borderRadius:14,background:'var(--l3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:40,flexShrink:0,position:'relative'}}>
                {item.e}
                {item.popular&&<div style={{position:'absolute',top:-4,right:-4,padding:'2px 6px',borderRadius:7,background:'var(--red)',fontSize:8,fontWeight:800,color:'white'}}>ХИТ</div>}
                {disc>0&&<div style={{position:'absolute',bottom:-4,left:-4,padding:'2px 6px',borderRadius:7,background:'var(--org)',fontSize:8,fontWeight:800,color:'white'}}>-{disc}%</div>}
                {!item.inStock&&<div style={{position:'absolute',inset:0,borderRadius:14,background:'rgba(0,0,0,.6)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:800,color:'white'}}>Стоп</div>}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:3,flexWrap:'wrap'}}>
                  <div style={{fontSize:14,fontWeight:700,lineHeight:1.3}}>{item.name}</div>
                  {isAllView && (
                    <button type="button" onClick={() => setActiveCat(item.cat)} className="btn"
                      style={{padding:'2px 8px',borderRadius:20,fontSize:9,fontWeight:800,background:'rgba(31,215,96,.1)',border:'1px solid rgba(31,215,96,.25)',color:'var(--gr)'}}>
                      {item.cat}
                    </button>
                  )}
                </div>
                <div style={{fontSize:11,color:'var(--t3)',marginBottom:6,lineHeight:1.5}}>{item.desc}</div>
                <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8}}>
                  <span style={{fontSize:10,color:'var(--t3)'}}>⏱ {item.time} мин</span>
                </div>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <div style={{display:'flex',alignItems:'baseline',gap:5}}>
                    <span style={{fontFamily:'Unbounded',fontSize:15,fontWeight:900}}>{item.price}<span style={{fontSize:10,color:'var(--gd)',marginLeft:2}}>ЅМ</span></span>
                    {item.old&&<span style={{fontSize:11,color:'var(--t3)',textDecoration:'line-through'}}>{item.old}</span>}
                  </div>
                  {item.inStock && r.open ? (
                    qty===0 ? (
                      <button onClick={()=>addItem(item)} className="btn" style={{padding:'7px 16px',borderRadius:11,background:'linear-gradient(135deg,var(--gr2),var(--gr))',border:'none',color:'white',fontSize:12,fontFamily:'Nunito',fontWeight:700}}>+ Добавить</button>
                    ) : (
                      <div style={{display:'flex',alignItems:'center',gap:0,background:'rgba(31,215,96,.1)',border:'1.5px solid rgba(31,215,96,.28)',borderRadius:11,overflow:'hidden'}}>
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
      <Nav page="home" go={go}/>
    </div>
  );
};
const REVIEWS_DATA = [
  {id:1,restId:'R-01',client:'Зафар М.',  rating:2,text:'Долго ждали, еда была холодная',  date:'16 мая',status:'new'},
  {id:2,restId:'R-02',client:'Лола К.',   rating:5,text:'Отличная пицца! Быстро доставили',date:'15 мая',status:'read'},
  {id:3,restId:'R-03',client:'Бахром Т.', rating:4,text:'Вкусные роллы, но дорого',        date:'15 мая',status:'read'},
  {id:4,restId:'R-01',client:'Нилуфар С.',rating:1,text:'Неправильный заказ привезли',     date:'14 мая',status:'new'},
];

const ASSEMBLERS_DATA = [
  {id:'A-01',name:'Камола Юсупова', phone:'+992 93 500 11 22',status:'active',ordersToday:12,avgTime:8, rating:4.9},
  {id:'A-02',name:'Шахло Рахимова', phone:'+992 93 500 33 44',status:'active',ordersToday:9, avgTime:11,rating:4.7},
  {id:'A-03',name:'Мухаббат Алиева',phone:'+992 90 600 55 66',status:'break', ordersToday:7, avgTime:9, rating:4.8},
  {id:'A-04',name:'Зарина Каримова',phone:'+992 88 700 77 88',status:'offline',ordersToday:0, avgTime:0, rating:4.6},
];

const PartnerLoginPage = ({go}) => {
  const [email, setEmail] = useState('');
  const [pass,  setPass]  = useState('');
  const [err,   setErr]   = useState('');
  const [load,  setLoad]  = useState(false);

  const login = (e) => {
    e.preventDefault(); setErr('');
    if(!email||!pass){setErr('Заполните поля');return;}
    setLoad(true);
    setTimeout(()=>{
      const user = PARTNER_USERS.find(u=>u.email.toLowerCase()===email.toLowerCase()&&u.pass===pass);
      if(user){
        try{localStorage.setItem('kp_partner',JSON.stringify(user));}catch{}
        go('partner_dash');
      } else {
        setErr('Неверный email или пароль');
      }
      setLoad(false);
    },800);
  };

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',maxWidth:480,margin:'0 auto',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:24}}>
      <button onClick={()=>go('home')} className="btn" style={{position:'absolute',top:18,left:18,width:40,height:40,borderRadius:12,background:'var(--l3)',border:'1px solid var(--b1)',display:'flex',alignItems:'center',justifyContent:'center'}}>
        <Ic n="arrL" s={17} c="var(--t2)"/>
      </button>
      <div style={{textAlign:'center',marginBottom:28}}>
        <div style={{fontSize:52,marginBottom:14}}>🍽</div>
        <div className="ub" style={{fontSize:20,fontWeight:900,marginBottom:4}}>Кабинет партнёра</div>
        <div style={{fontSize:12,color:'var(--t2)'}}>КАКАПО Маркетплейс · г. Яван</div>
      </div>
      <div style={{width:'100%',maxWidth:360,background:'var(--l2)',border:'1px solid var(--b1)',borderRadius:20,padding:24}}>
        {err&&<div style={{padding:'9px 12px',borderRadius:10,background:'rgba(255,69,69,.1)',border:'1px solid rgba(255,69,69,.3)',fontSize:12,color:'var(--red)',marginBottom:14}}>⚠️ {err}</div>}
        <div className="ub" style={{fontSize:14,fontWeight:800,marginBottom:16}}>Войти в кабинет</div>
        <form onSubmit={login} style={{display:'flex',flexDirection:'column',gap:12}}>
          <div>
            <div style={{fontSize:11,color:'var(--t2)',marginBottom:5,fontWeight:700}}>Email</div>
            <input className="inp" value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="your@restaurant.tj"/>
          </div>
          <div>
            <div style={{fontSize:11,color:'var(--t2)',marginBottom:5,fontWeight:700}}>Пароль</div>
            <input className="inp" value={pass} onChange={e=>setPass(e.target.value)} type="password" placeholder="••••••••"/>
          </div>
          <div style={{padding:'9px 12px',borderRadius:9,background:'rgba(255,184,0,.06)',border:'1px solid rgba(255,184,0,.2)',fontSize:11,color:'var(--t2)'}}>
            💡 Демо: <span style={{color:'var(--gd)',fontWeight:700}}>chaihona@kakapo.tj</span> / <span style={{color:'var(--gd)',fontWeight:700}}>rest123</span>
          </div>
          <button type="submit" className="btn" style={{padding:13,borderRadius:14,background:'linear-gradient(135deg,var(--gr2),var(--gr))',border:'none',color:'white',fontFamily:'Nunito',fontWeight:800,fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
            {load?<div style={{width:18,height:18,borderRadius:'50%',border:'2.5px solid rgba(255,255,255,.3)',borderTopColor:'white',animation:'spin 1s linear infinite'}}/>:'🔑 Войти в кабинет'}
          </button>
        </form>
      </div>
    </div>
  );
};

const PartnerDashPage = ({go}) => {
  const apiRests = useRestaurants(s => s.restaurants);
  const toggleOpenApi = useRestaurants(s => s.toggleOpen);
  const [partnerUser] = useState(()=>{try{return JSON.parse(localStorage.getItem('kp_partner')||'null');}catch{return PARTNER_USERS[0];}});
  const seedRest = partnerUser ? RESTAURANTS.find(r=>r.id===partnerUser.restId) : RESTAURANTS[0];
  const rest = useMemo(() => {
    if (USE_API && apiRests.length && partnerUser?.restId) {
      const enriched = enrichRestaurants(apiRests, RESTAURANTS);
      return enriched.find(r => r.id === partnerUser.restId) || enriched[0];
    }
    return seedRest;
  }, [apiRests, partnerUser?.restId, seedRest]);
  const isOpen = rest ? (typeof rest.open === 'boolean' ? rest.open : true) : true;
  const [tab,   setTab]   = useState('orders');
  const [menu,  setMenu]  = useState(rest ? rest.menu : []);
  const [showAdd,setShowAdd]=useState(false);
  const [newName,setNewName]=useState('');
  const [newPrice,setNewPrice]=useState('');
  const [newCat,setNewCat]=useState(rest?rest.categories[0]:'');
  const [newEmoji2,setNewEmoji2]=useState('🍽');
  const [newDesc,setNewDesc]=useState('');

  const toggleOpen = () => { if (rest?.id) void toggleOpenApi(rest.id); };

  const ORDERS_REST = [
    {id:'R-4832',client:'Диловар Р.',items:['🍚 Плов','🥩 Шашлык'],total:40,status:'cooking',time:'14:23'},
    {id:'R-4831',client:'Нилуфар Х.',items:['🍜 Лагман','🥗 Ачик-чучук'],total:22,status:'ready',time:'14:10'},
    {id:'R-4820',client:'Бахром К.', items:['🥟 Манты'],total:16,status:'delivered',time:'13:45'},
  ];

  const SC = {cooking:{l:'Готовится',c:'var(--gd)'},ready:{l:'Готово',c:'var(--gr)'},delivered:{l:'Доставлен',c:'var(--blue)'}};
  const toggleStock = (id) => setMenu(m=>m.map(item=>item.id===id?{...item,inStock:!item.inStock}:item));

  if(!rest) return null;

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',maxWidth:480,margin:'0 auto'}}>
      <div style={{background:rest.img,padding:'20px 18px 16px',position:'relative',overflow:'hidden'}}>
        <div style={{position:'absolute',inset:0,background:'rgba(3,11,5,.7)'}}/>
        <div style={{position:'relative',zIndex:1}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
            <div>
              <div style={{fontFamily:'Unbounded',fontSize:18,fontWeight:900,color:'white',marginBottom:2}}>{rest.name}</div>
              <div style={{fontSize:12,color:'rgba(255,255,255,.7)'}}>{rest.cuisine} · {rest.address}</div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:10,color:'rgba(255,255,255,.6)',marginBottom:2}}>Статус</div>
              <div onClick={toggleOpen} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',padding:'5px 10px',borderRadius:10,background:isOpen?'rgba(31,215,96,.2)':'rgba(255,69,69,.2)',border:`1px solid ${isOpen?'rgba(31,215,96,.4)':'rgba(255,69,69,.4)'}`}}>
                <div style={{width:8,height:8,borderRadius:'50%',background:isOpen?'var(--gr)':'var(--red)',animation:'pulse 2s infinite'}}/>
                <span style={{fontSize:12,fontWeight:700,color:isOpen?'var(--gr)':'var(--red)'}}>{isOpen?'Открыто':'Закрыто'}</span>
              </div>
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
            {[{l:'Заказов сегодня',v:'12',c:'var(--gr)'},{l:'Выручка',v:'480 ЅМ',c:'var(--gd)'},{l:'Рейтинг',v:`★ ${rest.rating}`,c:'var(--gd)'}].map((s,i)=>(
              <div key={i} style={{background:'rgba(0,0,0,.4)',borderRadius:10,padding:'10px',textAlign:'center',border:'1px solid rgba(255,255,255,.1)'}}>
                <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:900,color:s.c,marginBottom:2}}>{s.v}</div>
                <div style={{fontSize:9,color:'rgba(255,255,255,.5)'}}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{background:'var(--l1)',borderBottom:'1px solid var(--b1)',display:'flex'}}>
        {[{id:'orders',l:'📦 Заказы'},{id:'menu',l:'🍽 Меню'},{id:'stats',l:'📊 Статистика'}].map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} className="btn"
            style={{flex:1,padding:'13px 4px',fontSize:13,fontWeight:tab===t.id?800:600,background:'transparent',border:'none',borderBottom:`2.5px solid ${tab===t.id?'var(--gr)':'transparent'}`,color:tab===t.id?'var(--gr)':'var(--t2)',borderRadius:0,fontFamily:'Nunito'}}>
            {t.l}
          </button>
        ))}
      </div>

      <div style={{padding:'14px 18px 100px'}}>
        {tab==='orders'&&(
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {ORDERS_REST.map((o,i)=>{
              const s=SC[o.status]||{l:o.status,c:'var(--t2)'};
              return (
                <div key={o.id} className="card" style={{padding:'14px',animation:`fadeUp .4s ease ${i*.07}s both`}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
                    <div>
                      <span style={{fontFamily:'Unbounded',fontSize:13,fontWeight:800,color:'var(--gr)'}}>{o.id}</span>
                      <div style={{fontSize:11,color:'var(--t3)',marginTop:2}}>{o.client} · {o.time}</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <span style={{padding:'3px 9px',borderRadius:8,fontSize:11,fontWeight:800,background:`${s.c}18`,color:s.c,border:`1px solid ${s.c}30`}}>{s.l}</span>
                      <div style={{fontFamily:'Unbounded',fontSize:14,fontWeight:900,marginTop:4}}>{o.total} <span style={{fontSize:10,color:'var(--gd)'}}>ЅМ</span></div>
                    </div>
                  </div>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
                    {o.items.map((it,j)=><span key={j} style={{padding:'4px 9px',borderRadius:8,fontSize:12,background:'var(--l3)',border:'1px solid var(--b1)',color:'var(--t2)'}}>{it}</span>)}
                  </div>
                  {o.status==='cooking'&&(
                    <button className="btn" style={{width:'100%',padding:'10px',borderRadius:11,background:'linear-gradient(135deg,var(--gr2),var(--gr))',border:'none',color:'white',fontFamily:'Nunito',fontWeight:700,fontSize:13}}>
                      ✓ Готово — передать курьеру
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab==='menu'&&(
          <div>
            <div style={{display:'flex',justifyContent:'flex-end',marginBottom:14}}>
              <button onClick={()=>setShowAdd(true)} className="btn" style={{padding:'9px 16px',borderRadius:11,background:'linear-gradient(135deg,var(--gr2),var(--gr))',border:'none',color:'white',fontFamily:'Nunito',fontWeight:700,fontSize:13}}>
                + Добавить блюдо
              </button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {menu.map((item,i)=>(
                <div key={item.id} style={{display:'flex',gap:12,padding:'12px 14px',background:'var(--l2)',border:`1px solid ${item.inStock?'var(--b1)':'rgba(255,69,69,.25)'}`,borderRadius:14,animation:`fadeUp .35s ease ${i*.05}s both`}}>
                  <div style={{width:52,height:52,borderRadius:13,background:'var(--l3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:26,flexShrink:0}}>{item.e}</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:700,marginBottom:2}}>{item.name}</div>
                    <div style={{fontSize:11,color:'var(--t3)',marginBottom:4}}>{item.desc}</div>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{fontFamily:'Unbounded',fontSize:13,fontWeight:900}}>{item.price}<span style={{fontSize:9,color:'var(--gd)',marginLeft:2}}>ЅМ</span></span>
                      <span style={{fontSize:10,color:'var(--t3)'}}>· {item.cat}</span>
                    </div>
                  </div>
                  <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:8}}>
                    <div onClick={()=>toggleStock(item.id)} style={{padding:'4px 10px',borderRadius:9,fontSize:11,fontWeight:700,background:item.inStock?'rgba(31,215,96,.12)':'rgba(255,69,69,.12)',color:item.inStock?'var(--gr)':'var(--red)',border:`1px solid ${item.inStock?'rgba(31,215,96,.3)':'rgba(255,69,69,.3)'}`,cursor:'pointer'}}>
                      {item.inStock?'✓ В наличии':'✕ Стоп'}
                    </div>
                    <button className="btn" style={{fontSize:12,padding:'4px 9px',borderRadius:8,background:'var(--l3)',border:'1px solid var(--b1)',color:'var(--t2)'}}>✏️</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab==='stats'&&(
          <div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
              {[
                {l:'Выручка за месяц',v:'14 280 ЅМ',c:'var(--gd)'},
                {l:'Заказов за месяц',v:'312',       c:'var(--gr)'},
                {l:'Средний чек',     v:'45.8 ЅМ',   c:'var(--blue)'},
                {l:'Комиссия КАКАПО', v:`${rest.commission}%`,c:'var(--red)'},
              ].map((s,i)=>(
                <div key={i} style={{background:'var(--l2)',border:'1px solid var(--b1)',borderRadius:16,padding:'16px 14px',textAlign:'center'}}>
                  <div style={{fontSize:10,color:'var(--t3)',marginBottom:6}}>{s.l}</div>
                  <div style={{fontFamily:'Unbounded',fontSize:18,fontWeight:900,color:s.c}}>{s.v}</div>
                </div>
              ))}
            </div>
            <div className="card" style={{padding:'16px'}}>
              <div style={{fontFamily:'Unbounded',fontSize:13,fontWeight:800,marginBottom:12}}>Топ блюда</div>
              {menu.filter(m=>m.popular).map((item,i)=>(
                <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 0',borderBottom:i<menu.filter(m=>m.popular).length-1?'1px solid var(--b1)':'none'}}>
                  <span style={{fontSize:22,width:28}}>{item.e}</span>
                  <span style={{flex:1,fontSize:13,fontWeight:600}}>{item.name}</span>
                  <span style={{fontFamily:'Unbounded',fontSize:12,fontWeight:700,color:'var(--gd)'}}>{item.price} ЅМ</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showAdd&&(
        <div style={{position:'fixed',inset:0,zIndex:300,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
          <div onClick={()=>setShowAdd(false)} style={{position:'absolute',inset:0,background:'rgba(0,0,0,.8)',backdropFilter:'blur(8px)'}}/>
          <div style={{position:'relative',zIndex:1,width:'100%',maxWidth:480,background:'var(--l1)',borderTop:'1px solid var(--b1)',borderRadius:'24px 24px 0 0',padding:'20px 20px 40px',animation:'slideUp .4s ease'}}>
            <div style={{width:40,height:4,borderRadius:2,background:'var(--b2)',margin:'0 auto 16px'}}/>
            <div className="ub" style={{fontSize:15,fontWeight:800,marginBottom:16}}>Добавить блюдо</div>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              <div style={{display:'grid',gridTemplateColumns:'70px 1fr',gap:10}}>
                <div>
                  <div style={{fontSize:11,color:'var(--t2)',marginBottom:5,fontWeight:700}}>Emoji</div>
                  <input className="inp" value={newEmoji2} onChange={e=>setNewEmoji2(e.target.value)} style={{textAlign:'center',fontSize:26,height:48}}/>
                </div>
                <div>
                  <div style={{fontSize:11,color:'var(--t2)',marginBottom:5,fontWeight:700}}>Название *</div>
                  <input className="inp" value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Название блюда"/>
                </div>
              </div>
              <div>
                <div style={{fontSize:11,color:'var(--t2)',marginBottom:5,fontWeight:700}}>Описание</div>
                <input className="inp" value={newDesc} onChange={e=>setNewDesc(e.target.value)} placeholder="Состав, граммовка..."/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div>
                  <div style={{fontSize:11,color:'var(--t2)',marginBottom:5,fontWeight:700}}>Цена (ЅМ) *</div>
                  <input className="inp" value={newPrice} onChange={e=>setNewPrice(e.target.value)} type="number" placeholder="0"/>
                </div>
                <div>
                  <div style={{fontSize:11,color:'var(--t2)',marginBottom:5,fontWeight:700}}>Категория</div>
                  <select className="inp" value={newCat} onChange={e=>setNewCat(e.target.value)} style={{cursor:'pointer'}}>
                    {rest.categories.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <button onClick={()=>{
                if(newName&&newPrice){
                  const dish={id:Date.now(),cat:newCat,e:newEmoji2,name:newName,desc:newDesc,price:Number(newPrice),old:null,popular:false,time:15,inStock:true};
                  setMenu(m=>[...m,dish]);
                  setShowAdd(false);setNewName('');setNewPrice('');setNewDesc('');
                }
              }} className="btn" style={{padding:13,borderRadius:14,background:'linear-gradient(135deg,var(--gr2),var(--gr))',border:'none',color:'white',fontFamily:'Nunito',fontWeight:700,fontSize:14,opacity:newName&&newPrice?1:.5}}>
                ✓ Добавить блюдо
              </button>
            </div>
          </div>
        </div>
      )}

      <Nav page="partner" go={go}/>
    </div>
  );
};
const AdminPartnersPage = ({go}) => {
  const apiRests = useRestaurants(s => s.restaurants);
  const toggleOpenApi = useRestaurants(s => s.toggleOpen);
  const [rests,   setRests]   = useState(RESTAURANTS.map(r=>({...r,commEdit:r.commission})));
  const [sel,     setSel]     = useState(null);
  const [rtab,    setRtab]    = useState('info');
  const [showAdd, setShowAdd] = useState(false);
  const [showPay, setShowPay] = useState(null);

  useEffect(() => {
    if (USE_API && apiRests.length) {
      setRests(enrichRestaurants(apiRests, RESTAURANTS).map(r => ({ ...r, commEdit: r.commission })));
    }
  }, [apiRests]);

  const toggleOpen = (id) => { void toggleOpenApi(id); };
  const saveComm   = (id,v) => setRests(rs=>rs.map(r=>r.id===id?{...r,commission:v,commEdit:v}:r));
  const toggleDish = (rid,mid) => setRests(rs=>rs.map(r=>r.id===rid?{...r,menu:r.menu.map(m=>m.id===mid?{...m,inStock:!m.inStock}:m)}:r));

  const totalComm = rests.reduce((s,r)=>s+Math.round(r.revenueMonth*r.commission/100),0);

  const Tog = ({on,onT}) => (
    <div onClick={onT} style={{width:44,height:24,borderRadius:12,background:on?'#1FD760':'#1D3822',position:'relative',cursor:'pointer',transition:'background .2s',flexShrink:0}}>
      <div style={{position:'absolute',top:3,left:on?23:3,width:18,height:18,borderRadius:'50%',background:'white',transition:'left .2s'}}/>
    </div>
  );

  return (
    <AdminWrap go={go} title="Рестораны" subtitle="Маркетплейс — управление партнёрами, меню, комиссиями">
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        {[
          {l:'Партнёров',    v:rests.length,                           c:'#1FD760'},
          {l:'Открытых',     v:rests.filter(r=>r.open).length,         c:'#3B8EF0'},
          {l:'Заказов/мес',  v:rests.reduce((s,r)=>s+r.ordersMonth,0), c:'#FFB800'},
          {l:'Комиссия/мес', v:`${totalComm.toLocaleString()} ЅМ`,     c:'#FF4545'},
        ].map((s,i)=>(
          <div key={i} className="ac" style={{padding:'14px 16px'}}>
            <div style={{fontSize:10,color:'#8FB897',marginBottom:6}}>{s.l}</div>
            <div className="ub" style={{fontSize:22,fontWeight:900,color:s.c}}>{s.v}</div>
          </div>
        ))}
      </div>

      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:14}}>
        <button onClick={()=>setShowAdd(true)} className="ab abp" style={{display:'flex',alignItems:'center',gap:6}}>+ Добавить ресторан</button>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:22}}>
        {rests.map((r,i)=>(
          <div key={r.id} className="ac" style={{overflow:'hidden',animation:`fadeIn .4s ease ${i*.06}s both`}}>
            <div style={{height:88,background:r.img||'linear-gradient(135deg,#0A1A0A,#1A3A1A)',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'13px 15px',position:'relative'}}>
              <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,.35)'}}/>
              <div style={{position:'relative',zIndex:1}}>
                <div className="ub" style={{fontSize:13,fontWeight:900,color:'white',marginBottom:2}}>{r.name}</div>
                <div style={{fontSize:11,color:'rgba(255,255,255,.6)'}}>{r.cuisine} · {r.address}</div>
              </div>
              <span style={{fontSize:32,position:'relative',zIndex:1}}>{r.emoji}</span>
            </div>
            <div style={{padding:'12px 14px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <span style={{color:'#FFB800'}}>★</span>
                  <span style={{fontWeight:700,fontSize:12}}>{r.rating}</span>
                  <span style={{fontSize:10,color:'#3D6645'}}>({r.reviews})</span>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:11,color:r.open?'#1FD760':'#FF4545',fontWeight:700}}>{r.open?'Открыт':'Закрыт'}</span>
                  <Tog on={r.open} onT={()=>toggleOpen(r.id)}/>
                </div>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
                <div style={{textAlign:'center'}}>
                  <div className="ub" style={{fontSize:14,fontWeight:800}}>{r.ordersMonth}</div>
                  <div style={{fontSize:9,color:'#3D6645'}}>заказов</div>
                </div>
                <div style={{textAlign:'center'}}>
                  <div className="ub" style={{fontSize:14,fontWeight:800}}>{r.revenueMonth.toLocaleString()}</div>
                  <div style={{fontSize:9,color:'#3D6645'}}>выручка ЅМ</div>
                </div>
                <div style={{textAlign:'center'}}>
                  <div className="ub" style={{fontSize:14,fontWeight:800,color:'#FF4545'}}>{r.commission}%</div>
                  <div style={{fontSize:9,color:'#3D6645'}}>комиссия</div>
                </div>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>{setSel(r);setRtab('info');}} className="ab abg" style={{flex:1,padding:'8px',fontSize:11}}>⚙️ Управление</button>
                <button onClick={()=>setShowPay(r)} className="ab" style={{flex:1,padding:'8px',fontSize:11,background:'rgba(255,184,0,.1)',border:'1.5px solid rgba(255,184,0,.3)',color:'#FFB800'}}>💰 Выплата</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="ac">
        <div style={{padding:'12px 16px',borderBottom:'1px solid #162B1A',fontWeight:800,fontSize:13}}>Комиссии за этот месяц</div>
        <table className="at">
          <thead><tr><th>Ресторан</th><th>Выручка</th><th>Комиссия</th><th>КАКАПО</th><th>К выплате</th><th></th></tr></thead>
          <tbody>
            {rests.map(r=>(
              <tr key={r.id}>
                <td><div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:18}}>{r.emoji}</span><span style={{fontWeight:700}}>{r.name}</span></div></td>
                <td><span className="ub" style={{fontSize:12,fontWeight:700}}>{r.revenueMonth.toLocaleString()} ЅМ</span></td>
                <td>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <input type="number" value={r.commEdit} min={0} max={50}
                      onChange={e=>setRests(rs=>rs.map(x=>x.id===r.id?{...x,commEdit:Number(e.target.value)}:x))}
                      className="ai" style={{width:58,padding:'4px 8px',fontSize:12,textAlign:'center'}}/>
                    <span style={{fontSize:11,color:'#3D6645'}}>%</span>
                    {r.commEdit!==r.commission&&<button onClick={()=>saveComm(r.id,r.commEdit)} className="ab abp" style={{padding:'4px 9px',fontSize:11}}>✓</button>}
                  </div>
                </td>
                <td><span className="ub" style={{fontSize:13,fontWeight:900,color:'#1FD760'}}>{Math.round(r.revenueMonth*r.commission/100).toLocaleString()} ЅМ</span></td>
                <td><span className="ub" style={{fontSize:13,fontWeight:700}}>{Math.round(r.revenueMonth*(1-r.commission/100)).toLocaleString()} ЅМ</span></td>
                <td><button onClick={()=>setShowPay(r)} className="ab" style={{padding:'5px 11px',fontSize:11,background:'rgba(255,184,0,.1)',border:'1px solid rgba(255,184,0,.3)',color:'#FFB800'}}>Выплатить</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sel&&(
        <div className="amod">
          <div className="amodbg" onClick={()=>setSel(null)}/>
          <div className="amodbox" style={{maxWidth:680}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <span style={{fontSize:26}}>{sel.emoji}</span>
                <div>
                  <div className="ub" style={{fontSize:14,fontWeight:800}}>{sel.name}</div>
                  <div style={{fontSize:11,color:'#8FB897'}}>{sel.cuisine} · {sel.address}</div>
                </div>
              </div>
              <button onClick={()=>setSel(null)} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
            </div>
            <div style={{display:'flex',gap:6,marginBottom:16,borderBottom:'1px solid #162B1A',paddingBottom:12,flexWrap:'wrap'}}>
              {[{id:'info',l:'📋 Инфо'},{id:'menu',l:'🍽 Меню'},{id:'orders',l:'📦 Заказы'},{id:'commission',l:'💰 Комиссия'},{id:'access',l:'🔑 Доступ'}].map(t=>(
                <button key={t.id} onClick={()=>setRtab(t.id)} className="ab"
                  style={{padding:'7px 14px',fontSize:12,background:rtab===t.id?'rgba(31,215,96,.12)':'#0C1C0F',border:`1.5px solid ${rtab===t.id?'rgba(31,215,96,.35)':'#162B1A'}`,color:rtab===t.id?'#1FD760':'#8FB897'}}>
                  {t.l}
                </button>
              ))}
            </div>

            {rtab==='info'&&(
              <div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
                  {[{l:'Название',v:sel.name},{l:'Кухня',v:sel.cuisine},{l:'Адрес',v:sel.address},{l:'Email',v:sel.email||'—'}].map((f,i)=>(
                    <div key={i}><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>{f.l}</div><input className="ai" defaultValue={f.v}/></div>
                  ))}
                </div>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 14px',borderRadius:12,background:sel.open?'rgba(31,215,96,.07)':'rgba(255,69,69,.07)',border:`1px solid ${sel.open?'rgba(31,215,96,.2)':'rgba(255,69,69,.2)'}`,marginBottom:12}}>
                  <div>
                    <div style={{fontWeight:700,color:sel.open?'#1FD760':'#FF4545'}}>{sel.open?'🟢 Открыт':'🔴 Закрыт'}</div>
                    <div style={{fontSize:11,color:'#8FB897',marginTop:1}}>{sel.open?'Принимает заказы':'Заказы остановлены'}</div>
                  </div>
                  <Tog on={sel.open} onT={()=>{setSel(s=>({...s,open:!s.open}));toggleOpen(sel.id);}}/>
                </div>
                <div style={{display:'flex',gap:10}}>
                  <button className="ab abp" style={{flex:1,padding:10}}>✓ Сохранить</button>
                  <button className="ab abd" style={{padding:'10px 16px'}}>🚫 Заблокировать</button>
                </div>
              </div>
            )}

            {rtab==='menu'&&(
              <div>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                  <span style={{fontSize:12,color:'#8FB897'}}>{sel.menu?.length||0} блюд</span>
                  <button className="ab abp" style={{padding:'6px 13px',fontSize:12}}>+ Добавить блюдо</button>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {(sel.menu||[]).map(item=>(
                    <div key={item.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 13px',background:'#0C1C0F',borderRadius:11,border:`1px solid ${item.inStock?'#162B1A':'rgba(255,69,69,.3)'}`}}>
                      <div style={{width:38,height:38,borderRadius:10,background:'#162B1A',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>{item.e}</div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:700}}>{item.name}</div>
                        <div style={{fontSize:11,color:'#3D6645'}}>{item.cat}</div>
                      </div>
                      <span className="ub" style={{fontSize:12,fontWeight:800,color:'#FFB800',flexShrink:0}}>{item.price} ЅМ</span>
                      <button onClick={()=>{toggleDish(sel.id,item.id);setSel(s=>({...s,menu:s.menu.map(m=>m.id===item.id?{...m,inStock:!m.inStock}:m)}));}}
                        style={{padding:'5px 10px',borderRadius:8,fontSize:11,fontWeight:700,background:item.inStock?'rgba(31,215,96,.12)':'rgba(255,69,69,.12)',color:item.inStock?'#1FD760':'#FF4545',border:`1px solid ${item.inStock?'rgba(31,215,96,.3)':'rgba(255,69,69,.3)'}`,cursor:'pointer',fontFamily:'Nunito',flexShrink:0}}>
                        {item.inStock?'✓ Есть':'✕ Стоп'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {rtab==='orders'&&(
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {[{id:'K-4832',client:'Диловар Р.',items:['🍚 Плов ×2','🥩 Шашлык'],total:58,status:'cooking',time:'14:23'},{id:'K-4831',client:'Нилуфар Х.',items:['🍜 Лагман','🥗 Салат'],total:22,status:'ready',time:'14:10'}].map((o,i)=>{
                  const SC2={cooking:{l:'Готовится',c:'#FFB800'},ready:{l:'Готово!',c:'#1FD760'},new:{l:'Новый',c:'#FF4545'}};
                  const s=SC2[o.status]||{l:o.status,c:'#8FB897'};
                  return(
                    <div key={i} style={{padding:'12px 14px',background:'#0C1C0F',borderRadius:12,border:`1px solid ${s.c}22`}}>
                      <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                        <span className="ub" style={{fontSize:12,color:'#1FD760'}}>{o.id}</span>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <span className="ub" style={{fontSize:12,fontWeight:800}}>{o.total} ЅМ</span>
                          <span style={{padding:'2px 7px',borderRadius:7,fontSize:10,fontWeight:800,background:`${s.c}18`,color:s.c}}>{s.l}</span>
                        </div>
                      </div>
                      <div style={{fontSize:12,color:'#8FB897'}}>{o.client} · {o.items.join(', ')}</div>
                    </div>
                  );
                })}
              </div>
            )}

            {rtab==='commission'&&(
              <div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
                  {[
                    {l:'Выручка',v:`${sel.revenueMonth?.toLocaleString()||0} ЅМ`,c:'#EBF5ED'},
                    {l:'Комиссия',v:`${sel.commission}%`,c:'#FF4545'},
                    {l:'КАКАПО получает',v:`${Math.round((sel.revenueMonth||0)*sel.commission/100).toLocaleString()} ЅМ`,c:'#1FD760'},
                    {l:'Ресторан получает',v:`${Math.round((sel.revenueMonth||0)*(1-sel.commission/100)).toLocaleString()} ЅМ`,c:'#FFB800'},
                  ].map((s,i)=>(
                    <div key={i} style={{background:'#0C1C0F',borderRadius:11,padding:'13px',border:'1px solid #162B1A'}}>
                      <div style={{fontSize:10,color:'#3D6645',marginBottom:5}}>{s.l}</div>
                      <div className="ub" style={{fontSize:18,fontWeight:900,color:s.c}}>{s.v}</div>
                    </div>
                  ))}
                </div>
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:11,color:'#8FB897',marginBottom:8,fontWeight:700}}>Быстрый выбор комиссии</div>
                  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                    {[10,12,15,18,20,25].map(v=>(
                      <button key={v} onClick={()=>{setSel(s=>({...s,commission:v}));saveComm(sel.id,v);}} className="ab"
                        style={{padding:'8px 14px',fontSize:13,background:sel.commission===v?'rgba(255,69,69,.15)':'#0C1C0F',border:`1.5px solid ${sel.commission===v?'rgba(255,69,69,.4)':'#162B1A'}`,color:sel.commission===v?'#FF4545':'#8FB897'}}>
                        {v}%
                      </button>
                    ))}
                  </div>
                </div>
                <button className="ab abp" style={{width:'100%',padding:11}}>✓ Сохранить комиссию</button>
              </div>
            )}

            {rtab==='access'&&(
              <div style={{display:'flex',flexDirection:'column',gap:12}}>
                <div style={{padding:'13px 15px',borderRadius:12,background:'rgba(31,215,96,.06)',border:'1px solid rgba(31,215,96,.2)'}}>
                  <div style={{fontWeight:800,fontSize:13,marginBottom:10}}>Данные для входа</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                    <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Email</div><input className="ai" defaultValue={sel.email||'—'}/></div>
                    <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Новый пароль</div><input className="ai" type="password" placeholder="Оставить пустым"/></div>
                  </div>
                </div>
                <div style={{display:'flex',gap:10}}>
                  <button className="ab abp" style={{flex:1,padding:11}}>✓ Обновить доступ</button>
                  <button className="ab abd" style={{padding:'11px 16px'}}>🚫 Заблок.</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showPay&&(
        <div className="amod">
          <div className="amodbg" onClick={()=>setShowPay(null)}/>
          <div className="amodbox" style={{maxWidth:400}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div className="ub" style={{fontSize:14,fontWeight:800}}>Выплата · {showPay.name}</div>
              <button onClick={()=>setShowPay(null)} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
            </div>
            {[
              {l:'Выручка',v:`${showPay.revenueMonth?.toLocaleString()||0} ЅМ`,c:'#EBF5ED'},
              {l:`Комиссия КАКАПО (${showPay.commission}%)`,v:`−${Math.round((showPay.revenueMonth||0)*showPay.commission/100).toLocaleString()} ЅМ`,c:'#FF4545'},
              {l:'К выплате',v:`${Math.round((showPay.revenueMonth||0)*(1-showPay.commission/100)).toLocaleString()} ЅМ`,c:'#1FD760'},
            ].map((r,i)=>(
              <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'10px 13px',background:'#0C1C0F',borderRadius:10,border:'1px solid #162B1A',marginBottom:8}}>
                <span style={{fontSize:12,color:'#8FB897'}}>{r.l}</span>
                <span className="ub" style={{fontSize:13,fontWeight:800,color:r.c}}>{r.v}</span>
              </div>
            ))}
            <div style={{marginBottom:12,marginTop:4}}>
              <div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Способ выплаты</div>
              <select className="ai"><option>💵 Наличными</option><option>🏦 Перевод</option></select>
            </div>
            <button onClick={()=>setShowPay(null)} className="ab abp" style={{width:'100%',padding:12}}>✓ Подтвердить выплату</button>
          </div>
        </div>
      )}

      {showAdd&&(
        <div className="amod">
          <div className="amodbg" onClick={()=>setShowAdd(false)}/>
          <div className="amodbox" style={{maxWidth:500}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div className="ub" style={{fontSize:14,fontWeight:800}}>Добавить ресторан-партнёра</div>
              <button onClick={()=>setShowAdd(false)} className="ab" style={{background:'#0C1C0F',border:'1px solid #162B1A',color:'#8FB897',width:32,height:32,padding:0,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div style={{display:'grid',gridTemplateColumns:'68px 1fr',gap:12}}>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Emoji</div><input className="ai" defaultValue="🍽" style={{textAlign:'center',fontSize:22,height:46}}/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Название *</div><input className="ai" placeholder="Название ресторана"/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Кухня</div><input className="ai" placeholder="Таджикская..."/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Адрес</div><input className="ai" placeholder="ул. Ленина, 42"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Email партнёра *</div><input className="ai" type="email" placeholder="rest@kakapo.tj"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Пароль *</div><input className="ai" type="password" placeholder="••••••••"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Телефон</div><input className="ai" placeholder="+992 __ ___ __ __"/></div>
                <div><div style={{fontSize:11,color:'#8FB897',marginBottom:5,fontWeight:700}}>Комиссия %</div><input className="ai" type="number" defaultValue="15" min={0} max={50}/></div>
              </div>
              <button onClick={()=>setShowAdd(false)} className="ab abp" style={{width:'100%',padding:12}}>✓ Добавить партнёра</button>
            </div>
          </div>
        </div>
      )}
    </AdminWrap>
  );
};

const AdminReviewsPage = ({go}) => {
  const [reviews, setReviews] = useState(REVIEWS_DATA);
  const [filter,  setFilter]  = useState('all');
  const newCount = reviews.filter(r=>r.status==='new').length;
  const filtered = filter==='all'?reviews:filter==='new'?reviews.filter(r=>r.status==='new'):reviews.filter(r=>String(r.rating)===filter);
  const markRead = (id) => setReviews(rs=>rs.map(r=>r.id===id?{...r,status:'read'}:r));

  return (
    <AdminWrap go={go} title="Отзывы" subtitle="Жалобы и отзывы клиентов на рестораны">
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        {[
          {l:'Всего отзывов',v:reviews.length,c:'#EBF5ED'},
          {l:'Новых',v:newCount,c:'#FF4545'},
          {l:'Средний рейтинг',v:'4.5 ★',c:'#FFB800'},
          {l:'Жалоб (1-2 ★)',v:reviews.filter(r=>r.rating<=2).length,c:'#FF4545'},
        ].map((s,i)=>(
          <div key={i} className="ac" style={{padding:'14px 16px'}}>
            <div style={{fontSize:10,color:'#8FB897',marginBottom:6}}>{s.l}</div>
            <div className="ub" style={{fontSize:22,fontWeight:900,color:s.c}}>{s.v}</div>
          </div>
        ))}
      </div>
      <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
        {[{id:'all',l:'Все'},{id:'new',l:'🔴 Новые'},{id:'1',l:'⭐'},{id:'2',l:'⭐⭐'},{id:'5',l:'⭐⭐⭐⭐⭐'}].map(f=>(
          <button key={f.id} onClick={()=>setFilter(f.id)} className="ab"
            style={{padding:'7px 13px',fontSize:12,background:filter===f.id?'rgba(31,215,96,.12)':'#0C1C0F',border:`1.5px solid ${filter===f.id?'rgba(31,215,96,.35)':'#162B1A'}`,color:filter===f.id?'#1FD760':'#8FB897'}}>
            {f.l}
          </button>
        ))}
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        {filtered.map((rev,i)=>{
          const rest = RESTAURANTS.find(r=>r.id===rev.restId);
          return (
            <div key={rev.id} className="ac" style={{padding:'15px 17px',border:`1.5px solid ${rev.status==='new'?'rgba(255,69,69,.3)':'#162B1A'}`,animation:`fadeIn .4s ease ${i*.06}s both`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:36,height:36,borderRadius:'50%',background:'linear-gradient(135deg,#0F8A3A,#1FD760)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:13,fontWeight:900,color:'#030B05',flexShrink:0}}>{rev.client.charAt(0)}</div>
                  <div>
                    <div style={{fontSize:13,fontWeight:700}}>{rev.client}</div>
                    <div style={{display:'flex',gap:2,marginTop:2}}>
                      {[1,2,3,4,5].map(s=><span key={s} style={{fontSize:12,color:s<=rev.rating?'#FFB800':'#1D3822'}}>★</span>)}
                      <span style={{fontSize:10,color:'#3D6645',marginLeft:4}}>{rev.date}</span>
                    </div>
                  </div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{padding:'2px 9px',borderRadius:8,fontSize:11,background:'rgba(0,0,0,.3)',border:'1px solid #162B1A',color:'#8FB897'}}>{rest?.emoji} {rest?.name}</span>
                  {rev.status==='new'&&<span style={{padding:'2px 8px',borderRadius:7,fontSize:10,fontWeight:800,background:'rgba(255,69,69,.12)',color:'#FF4545',border:'1px solid rgba(255,69,69,.28)'}}>Новый</span>}
                </div>
              </div>
              <div style={{fontSize:13,color:'#EBF5ED',lineHeight:1.6,marginBottom:10,padding:'10px 13px',background:'#0C1C0F',borderRadius:10,border:'1px solid #162B1A'}}>
                "{rev.text}"
              </div>
              <div style={{display:'flex',gap:8}}>
                {rev.status==='new'&&<button onClick={()=>markRead(rev.id)} className="ab abg" style={{padding:'5px 13px',fontSize:11}}>✓ Прочитано</button>}
                <button className="ab" style={{padding:'5px 13px',fontSize:11,background:'rgba(59,142,240,.1)',border:'1.5px solid rgba(59,142,240,.3)',color:'#3B8EF0'}}>💬 Ответить</button>
                {rev.rating<=2&&<button className="ab abd" style={{padding:'5px 13px',fontSize:11}}>⚠️ Предупредить ресторан</button>}
              </div>
            </div>
          );
        })}
      </div>
    </AdminWrap>
  );
};

const AdminAssemblersPage = ({go}) => {
  const SC = {active:{l:'На смене',c:'#1FD760'},break:{l:'Перерыв',c:'#FFB800'},offline:{l:'Офлайн',c:'#3D6645'}};
  return (
    <AdminWrap go={go} title="Сборщики" subtitle="Управление командой сборки заказов">
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        {[
          {l:'Всего сборщиков', v:ASSEMBLERS_DATA.length,                                    c:'#EBF5ED'},
          {l:'На смене',        v:ASSEMBLERS_DATA.filter(a=>a.status==='active').length,     c:'#1FD760'},
          {l:'Собрано сегодня', v:ASSEMBLERS_DATA.reduce((s,a)=>s+a.ordersToday,0),         c:'#3B8EF0'},
          {l:'Ср. время сборки',v:`${Math.round(ASSEMBLERS_DATA.filter(a=>a.avgTime>0).reduce((s,a)=>s+a.avgTime,0)/ASSEMBLERS_DATA.filter(a=>a.avgTime>0).length)} мин`,c:'#FFB800'},
        ].map((s,i)=>(
          <div key={i} className="ac" style={{padding:'14px 16px'}}>
            <div style={{fontSize:10,color:'#8FB897',marginBottom:6}}>{s.l}</div>
            <div className="ub" style={{fontSize:22,fontWeight:900,color:s.c}}>{s.v}</div>
          </div>
        ))}
      </div>
      <div className="ac">
        <div style={{padding:'12px 16px',borderBottom:'1px solid #162B1A',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span style={{fontWeight:800,fontSize:13}}>Команда сборщиков</span>
          <button className="ab abp" style={{padding:'6px 13px',fontSize:12}}>+ Добавить сборщика</button>
        </div>
        <table className="at">
          <thead><tr><th>Сборщик</th><th>Статус</th><th>Сегодня</th><th>Ср. время</th><th>Рейтинг</th><th></th></tr></thead>
          <tbody>
            {ASSEMBLERS_DATA.map(a=>{
              const s=SC[a.status];
              return(
                <tr key={a.id}>
                  <td>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <div style={{width:34,height:34,borderRadius:'50%',background:'linear-gradient(135deg,#6B3FD4,#9B6DFF)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Unbounded',fontSize:13,fontWeight:900,color:'white',flexShrink:0}}>{a.name.charAt(0)}</div>
                      <div><div style={{fontWeight:700,fontSize:13}}>{a.name}</div><div style={{fontSize:11,color:'#8FB897'}}>{a.phone}</div></div>
                    </div>
                  </td>
                  <td><span style={{padding:'3px 9px',borderRadius:8,fontSize:11,fontWeight:800,background:`${s.c}18`,color:s.c,border:`1px solid ${s.c}30`}}>{s.l}</span></td>
                  <td><span className="ub" style={{fontSize:13,fontWeight:800,color:'#3B8EF0'}}>{a.ordersToday} заказов</span></td>
                  <td style={{color:'#FFB800',fontWeight:600}}>{a.avgTime>0?`${a.avgTime} мин`:'—'}</td>
                  <td style={{color:'#FFB800',fontWeight:700}}>★ {a.rating}</td>
                  <td>
                    <div style={{display:'flex',gap:6}}>
                      <button className="ab abg" style={{padding:'4px 9px',fontSize:11}}>📱 Звонок</button>
                      <button className="ab abd" style={{padding:'4px 9px',fontSize:11}}>Блок</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AdminWrap>
  );
};
const Page404 = ({ go }) => (
  <div style={{ minHeight:"100vh", background:"var(--bg)", maxWidth:480, margin:"0 auto", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"40px 24px", textAlign:"center", position:"relative", overflow:"hidden" }}>
    <div style={{ position:"absolute", inset:0, opacity:.03, background:"repeating-linear-gradient(0deg,transparent,transparent 28px,rgba(31,215,96,1) 28px,rgba(31,215,96,1) 29px),repeating-linear-gradient(90deg,transparent,transparent 28px,rgba(31,215,96,1) 28px,rgba(31,215,96,1) 29px)" }}/>
    <div style={{ position:"relative", zIndex:2 }}>
      <div className="ub" style={{ fontSize:96, fontWeight:900, lineHeight:1, marginBottom:8, background:"linear-gradient(135deg,var(--gr),var(--gd))", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", backgroundClip:"text" }}>404</div>
      <div style={{ fontSize:56, marginBottom:20, animation:"float 3s ease-in-out infinite" }}>🛒</div>
      <div className="ub" style={{ fontSize:20, fontWeight:900, marginBottom:8 }}>Страница не найдена</div>
      <div style={{ fontSize:13, color:"var(--t2)", lineHeight:1.7, marginBottom:32 }}>Похоже, эта страница уехала<br/>вместе с курьером 🛵</div>
      <button onClick={() => go("home")} className="btn" style={{ padding:"15px 32px", fontSize:14, borderRadius:16, background:"linear-gradient(135deg,var(--gr2),var(--gr))", color:"white", marginBottom:12, width:"100%", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}><Ic n="home" s={17} c="white"/>На главную</button>
      <button onClick={() => go("catalog")} className="btn" style={{ padding:"14px 32px", fontSize:13, borderRadius:16, background:"rgba(31,215,96,.09)", border:"1.5px solid rgba(31,215,96,.28)", color:"var(--gr)", width:"100%", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}><Ic n="tag" s={15} c="var(--gr)"/>Каталог товаров</button>
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

function KakapoAppInner() {
  useApiSync('all');
  const { prods } = useLiveCatalog();
  const { page, params, go } = useAppNavigation('home');
  const [cart,   setCart]   = useState({});
  const [cartMeta, setCartMeta] = useState({});
  const [wished, setWished] = useState({});
  const [user,   setUser]   = useState(() => loadStoreUser());
  const [toast,  setToast]  = useState(null);

  useEffect(() => {
    if (user) saveStoreUser(user)
  }, [user])

  useEffect(() => {
    if (!user?.phone) {
      setCart({});
      setCartMeta({});
      setWished({});
      return;
    }
    migrateLegacyClientData(user.phone);
    setCart(loadAccountJson(ACCOUNT_NS.cart, {}, user.phone));
    setCartMeta(loadAccountJson(ACCOUNT_NS.cartMeta, {}, user.phone));
    setWished(loadAccountJson(ACCOUNT_NS.wished, {}, user.phone));
  }, [user?.phone]);

  useEffect(() => {
    if (!user?.phone) return;
    saveAccountJson(ACCOUNT_NS.cart, cart, user.phone);
  }, [cart, user?.phone]);

  useEffect(() => {
    if (!user?.phone) return;
    saveAccountJson(ACCOUNT_NS.cartMeta, cartMeta, user.phone);
  }, [cartMeta, user?.phone]);

  useEffect(() => {
    if (!user?.phone) return;
    saveAccountJson(ACCOUNT_NS.wished, wished, user.phone);
  }, [wished, user?.phone]);

  useClientReviewNotifSync(user);
  useClientNotificationSync(user);

  useEffect(() => {
    hydrateCourierStores();
    useProductPhotos.getState().hydrate();
  }, []);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  const addItem = useCallback((id, price, name, emoji, restId, silent) => {
    const p = prods.find(x => x.id == id);
    if (p && !restId) {
      setCart(c => {
        const cur = c[id] || 0;
        const next = nextCartQty(p, cur, true);
        if (!silent && next > 0) showToast(`${p.e} ${p.name} — ${formatCartQty(p, next)}`);
        if (next === 0) return c;
        return { ...c, [id]: next };
      });
      return;
    }
    setCart(c => ({ ...c, [id]: (c[id]||0) + 1 }));
    if (name) {
      setCartMeta(m => ({ ...m, [id]: { price, name, emoji: emoji || '🍽', restId } }));
      if (!silent) showToast(`${emoji || '🍽'} ${name} в корзине`);
    }
  }, [showToast, prods]);

  const rmItem = useCallback((id) => {
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
  }, [prods]);

  const delItem = useCallback((id) => {
    setCart(c => { const n = {...c}; delete n[id]; return n; });
    setCartMeta(m => { const n = {...m}; delete n[id]; return n; });
  }, []);

  const toggleWish = useCallback((id) => {
    setWished(w => { const n = {...w, [id]: !w[id]}; return n; });
    const p = prods.find(x => x.id === id);
    if (p && !wished[id]) showToast(`❤️ ${p.name} в избранном`);
  }, [wished, showToast, prods]);

  const clearCart = useCallback(() => {
    setCart({});
    setCartMeta({});
  }, []);

  const logout = useCallback(() => {
    saveStoreUser(null);
    setUser(null);
    setCart({});
    setCartMeta({});
    setWished({});
    go('profile');
  }, [go]);

  const shared = { go, cart, cartMeta, onAdd:addItem, onRm:rmItem, onWish:toggleWish, wished, params, onClearCart: clearCart, showToast, user, onLogout: logout };

  const render = () => {
    switch (page) {
      case "home":             return <HomePage          {...shared}/>;
      case "catalog":          return <CatalogPage       {...shared}/>;
      case "plist":            return <PListPage         {...shared}/>;
      case "product":          return <ProductPage       {...shared}/>;
      case "cart":             return <CartPage          {...shared} onDel={delItem}/>;
      case "checkout":         return <CheckoutPage      {...shared}/>;
      case "auth":             return <ClientLoginPage   go={go} setUser={setUser}/>;
      case "profile":          return <ProfilePage       {...shared} user={user} setUser={setUser} onLogout={logout}/>;
      case "orders":           return <OrdersPage        {...shared} user={user}/>;
      case "reviews":          return <ClientReviewsPage   go={go} user={user}/>;
      case "promos":           return <PromosPage        {...shared}/>;
      case "search":           return <SearchPage        {...shared}/>;
      case "faq":              return <FAQPage           {...shared}/>;
      case "vip":              return <VIPPage           {...shared} user={user}/>;
      case "about":            return <AboutPage         {...shared}/>;
      case "admin_dash":       return <AdminDashPage     go={go}/>;
      case "admin_orders":     return <AdminOrdersPage   go={go}/>;
      case "admin_products":   return <AdminProductsPage go={go}/>;
      case "admin_cards":      return <AdminCardsPage    go={go}/>;
      case "admin_clients":    return <AdminClientsPage  go={go}/>;
      case "admin_settings":   return <AdminSettingsPage go={go}/>;
      case "admin_couriers":   return <AdminCouriersPage go={go}/>;
      case "admin_promos":     return <AdminPromosPage   go={go}/>;
      case "admin_banners":    return <AdminBannersPage  go={go}/>;
      case "admin_push":       return <AdminPushPage     go={go}/>;
      case "restaurants":      return <RestaurantsPage   go={go} cart={cart} onAdd={addItem}/>;
      case "restaurant":       return <RestaurantPage    go={go} params={params} cart={cart} onAdd={addItem} onRm={rmItem}/>;
      case "partner_login":    return <PartnerLoginPage  go={go}/>;
      case "partner_dash":     return <PartnerDashPage   go={go}/>;
      case "admin_partners":   return <AdminPartnersPage go={go}/>;
      case "courier_login":    return <CourierLoginPage      go={go}/>;
      case "courier_dash":     return <CourierDashRedirect/>;
      case "assembler_login":  return <AssemblerLoginPage    go={go}/>;
      case "assembler_dash":   return <AssemblerDashPage     go={go}/>;
      case "notifs":           return <NotifPage             {...shared}/>;
      case "addresses":        return <AddressesPage         {...shared}/>;
      case "referral":         return <ReferralPage          {...shared}/>;
      case "chat":             return <ChatPage              {...shared}/>;
      case "admin_finance":    return <AdminFinancePage      go={go}/>;
      case "admin_inventory":  return <AdminInventoryPage    go={go}/>;
      case "admin_chat":       return <AdminChatSupportPage  go={go}/>;
      case "admin_reviews":    return <AdminReviewsPage      go={go}/>;
      case "admin_assemblers": return <AdminAssemblersPage   go={go}/>;
      default:                 return <Page404               go={go}/>;
    }
  };

  return (
    <>
      <style>{CSS}</style>
      <Toast msg={toast}/>
      <div style={{ maxWidth:480, margin:"0 auto", minHeight:"100vh", background:"var(--bg)", overflowX:"clip" }}>
        {render()}
      </div>
    </>
  );
}
