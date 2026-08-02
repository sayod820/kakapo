'use client'

import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import { useApiSync } from '@/lib/useApiSync'
import { useOfflineSync } from '@/lib/offlineSync'
import { hydrateOfflineCaches } from '@/lib/offlineHydrate'
import { useAppNavigation } from '@/lib/useAppNavigation'
import AppNavigationBoundary from '@/components/shared/AppNavigationBoundary'
import { useProducts } from '@/lib/store'
import ProductsModule from '@/components/trade/ProductsModule'
import WarehouseModule from '@/components/trade/WarehouseModule'
import SuppliersModule from '@/components/trade/SuppliersModule'
import ClientsModule from '@/components/trade/ClientsModule'
import DebtsModule from '@/components/trade/DebtsModule'
import CashierModule from '@/components/trade/CashierModule'
import ComingSoonModule from '@/components/trade/ComingSoonModule'
import FinanceModule from '@/components/trade/FinanceModule'
import ReportsModule from '@/components/trade/ReportsModule'
import TradeLoginPage from '@/components/trade/TradeLoginPage'
import LocalDbBootstrap from '@/components/trade/LocalDbBootstrap'
import OfflineQueuePanel from '@/components/trade/OfflineQueuePanel'
import {
  getKakapoDesktop,
  isKakapoDesktop,
  type DesktopUpdateStatus,
} from '@/lib/desktopBridge'
import { isLocalBootstrapComplete } from '@/lib/offlineBootstrap'
import {
  clearTradeEmployeeSession,
  loadTradeEmployeeSession,
  saveTradeEmployeeSession,
  type TradeEmployeeSession,
} from '@/lib/employeeSession'
import {
  canAccessTradePage,
  firstAllowedTradePage,
  type TradePageId,
} from '@/lib/tradeAccess'

/* ══════════════════════════════════════════════════════════════
   6-е приложение KAKAPO — «Торговля»
   POS / Касса — один из разделов внутри, не название приложения.
══════════════════════════════════════════════════════════════ */

const CSS = `
  .k-trade *{box-sizing:border-box}
  .k-trade{
    --bg:#070C09; --panel:#0B120E; --card:#101A13; --card2:#0D1610; --border:#1C2A21;
    --text:#E8F3EB; --muted:#7E9A86; --muted2:#5E7A67;
    --green:#1FD760; --green-d:#12351E; --blue:#3B8EF0; --purple:#9B6DFF; --red:#FF5A5A; --gold:#FFB800;
    --hover:#0e1712; --tbl-line:#16241b; --nav-hover:#111d15; --scroll:#1e2f24;
    --photo-plate:#0c1610; --badge-cat-bg:#1a2430; --badge-cat-fg:#3B8EF0; --badge-cat-border:#2a3548;
    --badge-stock-ok:#12351E; --badge-stock-low:#2a2414; --badge-stock-no:#2a1420;
    --badge-debt-bg:#2a2414; --badge-debt-ok:#122018; --badge-warn-bg:#2a1420; --badge-vip-bg:#2a1a40;
    --border-debt:#5a4020; --border-debt-over:#5a2030;
    --alert-error-bg:#2a1420; --alert-error-border:#5a2030;
    --alert-warn-bg:#2a2414; --alert-warn-border:#5a4020;
    display:flex;min-height:100vh;background:var(--bg);color:var(--text);
    font-family:'Nunito',system-ui,-apple-system,sans-serif;font-size:14px;
  }
  .k-trade[data-theme="light"]{
    --bg:#F3F7F4; --panel:#FFFFFF; --card:#FFFFFF; --card2:#EAF1EC; --border:#D0DDD4;
    --text:#0C1A10; --muted:#4A6B52; --muted2:#7A9580;
    --green:#129B45; --green-d:#D6F0DF; --blue:#2563EB; --purple:#7C3AED; --red:#DC2626; --gold:#D97706;
    --hover:#EAF1EC; --tbl-line:#D0DDD4; --nav-hover:#EAF1EC; --scroll:#BCCBBF;
    /* Категории: как в Товарах — круглая плашка с фоном */
    --photo-plate:#E2EBE5; --badge-cat-bg:#DCE8E1; --badge-cat-fg:#2F5A3C; --badge-cat-border:#B5C9BC;
    --badge-stock-ok:#D6F0DF; --badge-stock-low:#FEF3C7; --badge-stock-no:#FEE2E2;
    --badge-debt-bg:#FEF3C7; --badge-debt-ok:#D6F0DF; --badge-warn-bg:#FEE2E2; --badge-vip-bg:#EDE9FE;
    --border-debt:#F0D9A8; --border-debt-over:#FECACA;
    --alert-error-bg:#FEE2E2; --alert-error-border:#FECACA;
    --alert-warn-bg:#FEF3C7; --alert-warn-border:#F0D9A8;
  }
  .k-trade button{font-family:inherit}
  .k-trade ::-webkit-scrollbar{width:8px;height:8px}
  .k-trade ::-webkit-scrollbar-thumb{background:var(--scroll);border-radius:8px}

  .k-side{width:236px;flex-shrink:0;background:var(--panel);border-right:1px solid var(--border);display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
  .k-logo{display:flex;align-items:center;gap:10px;padding:18px 18px 6px;font-weight:900;font-size:17px;line-height:1.2}
  .k-logo .mark{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#1FD760,#12a548);display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 6px 16px rgba(31,215,96,.28);flex-shrink:0}
  .k-logo-sub{padding:0 18px 12px;font-size:11px;color:var(--muted);line-height:1.35}
  .k-nav{flex:1;overflow-y:auto;padding:6px 12px 12px}
  .k-navitem{display:flex;align-items:center;gap:12px;width:100%;border:none;background:transparent;color:var(--muted);cursor:pointer;padding:11px 12px;border-radius:12px;font-size:14px;font-weight:700;text-align:left;margin-bottom:2px;transition:background .12s,color .12s}
  .k-navitem .ic{font-size:17px;width:22px;text-align:center;flex-shrink:0}
  .k-navitem .tag{margin-left:auto;font-size:10px;font-weight:800;padding:2px 7px;border-radius:999px;background:var(--card2);color:var(--muted)}
  .k-navitem:hover{background:var(--nav-hover);color:var(--text)}
  .k-navitem.active{background:linear-gradient(135deg,#1FD760,#14b24f);color:#05210D;box-shadow:0 8px 20px rgba(31,215,96,.25)}
  .k-navitem.active .tag{background:rgba(5,33,13,.2);color:#05210D}
  .k-side-foot{padding:12px;border-top:1px solid var(--border)}
  .k-store{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px}
  .k-store .name{font-weight:800}
  .k-online{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--green);font-weight:700;margin-top:4px}
  .k-online .d{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 3px rgba(31,215,96,.18)}
  .k-online[data-state="offline"]{color:var(--gold)}
  .k-online[data-state="offline"] .d{background:var(--gold);box-shadow:0 0 0 3px rgba(255,184,0,.18)}
  .k-online[data-state="sync"]{color:var(--blue)}
  .k-online[data-state="sync"] .d{background:var(--blue);box-shadow:0 0 0 3px rgba(59,142,240,.18)}
  .k-online[data-state="failed"]{color:var(--red)}
  .k-online[data-state="failed"] .d{background:var(--red);box-shadow:0 0 0 3px rgba(255,90,90,.18)}
  .k-netnote{margin-top:4px;font-size:11px;color:var(--muted);line-height:1.35;background:none;border:0;padding:0;text-align:left;cursor:pointer;font-family:inherit}
  .k-netnote:hover{color:var(--text)}
  .k-update{width:100%;margin-top:10px;padding:8px 10px;border-radius:10px;border:1px solid var(--border);background:var(--card2);color:var(--text);font:inherit;font-size:12px;font-weight:700;cursor:pointer;text-align:left;display:flex;flex-direction:column;gap:2px}
  .k-update:hover:not(:disabled){border-color:var(--green)}
  .k-update:disabled{opacity:.7;cursor:default}
  .k-update[data-state="available"],.k-update[data-state="downloaded"]{border-color:rgba(31,215,96,.45);background:rgba(31,215,96,.08)}
  .k-update[data-state="error"]{border-color:rgba(255,184,0,.4)}
  .k-update .u-title{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .k-update .u-sub{font-size:11px;font-weight:600;color:var(--muted);line-height:1.3}
  .k-update .u-bar{height:4px;border-radius:99px;background:var(--border);overflow:hidden;margin-top:4px}
  .k-update .u-bar>i{display:block;height:100%;background:var(--green);width:0;transition:width .2s ease}
  .k-clock{margin-top:10px;padding-top:10px;border-top:1px solid var(--border)}
  .k-clock .date{font-size:12px;color:var(--muted)}
  .k-clock .time{font-size:26px;font-weight:900;line-height:1.1}
  .k-clock .day{font-size:12px;color:var(--muted)}

  .k-main{flex:1;min-width:0;display:flex;flex-direction:column;height:100vh;overflow:hidden}
  .k-top{display:flex;align-items:center;gap:14px;padding:14px 20px;border-bottom:1px solid var(--border);background:var(--panel)}
  .k-search{flex:1;position:relative;max-width:640px}
  .k-search input{width:100%;background:var(--card);border:1px solid var(--border);border-radius:12px;color:var(--text);padding:11px 40px 11px 42px;font-size:14px;outline:none}
  .k-search input:focus{border-color:var(--green)}
  .k-search .mag{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none}
  .k-search-clear{
    position:absolute;right:8px;top:50%;transform:translateY(-50%);
    width:28px;height:28px;border-radius:9px;border:none;cursor:pointer;
    background:var(--card2);color:var(--muted);font-size:14px;font-weight:800;line-height:1;
    display:flex;align-items:center;justify-content:center;
  }
  .k-search-clear:hover{color:var(--text);background:var(--border)}
  .k-theme-toggle{display:flex;align-items:center;gap:2px;padding:3px;border-radius:12px;background:var(--card2);border:1.5px solid var(--border);flex-shrink:0}
  .k-theme-mode{width:34px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;color:var(--muted);border:none;background:transparent;cursor:pointer;transition:background .15s,color .15s}
  .k-theme-mode:hover{color:var(--text)}
  .k-theme-mode.on{background:var(--card);color:var(--green);box-shadow:0 1px 4px rgba(0,0,0,.12)}
  .k-trade[data-theme="light"] .k-theme-mode.on{box-shadow:0 1px 4px rgba(12,26,16,.12)}
  .k-user{display:flex;align-items:center;gap:10px;padding:5px 6px 5px 5px;border:1px solid var(--border);background:var(--card);border-radius:14px;cursor:pointer;color:var(--text)}
  .k-user .av{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#1FD760,#12a548);color:#05210D;display:flex;align-items:center;justify-content:center;font-weight:900}
  .k-user .who b{display:block;font-size:13px;line-height:1.1;color:var(--text);font-weight:800}
  .k-user .who span{font-size:11px;color:var(--muted)}
  .k-body{flex:1;min-height:0;overflow:auto;padding:18px 20px}
  .k-body-pos{padding:0;overflow:hidden;display:flex;flex-direction:column;}
  .k-body-pos > .pos-root{flex:1;min-height:0;}
  .k-trade.pos-fs{display:block;min-height:100vh;}
  .k-pos-fs-host{min-height:100vh;width:100%;}
  .k-page-h{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:16px;flex-wrap:wrap}
  .k-page-h h1{font-size:22px;font-weight:900;margin:0}
  .k-page-h .sub{color:var(--muted);font-size:13px;margin-top:4px;max-width:560px;line-height:1.45}
  .k-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px}
  .k-kpi{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:16px}
  .k-kpi .kl{font-size:12px;color:var(--muted);font-weight:700}
  .k-kpi .kv{font-size:24px;font-weight:900;margin-top:6px}
  .k-statcard{text-align:left;transition:border-color .12s,background .12s}
  .k-card{background:var(--card);border:1px solid var(--border);border-radius:16px}
  .k-card-h{padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:12px}
  .k-card-h b{font-size:16px;font-weight:900}
  .k-card-b{padding:16px}
  .k-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .k-field{margin-bottom:12px}
  .k-field label{display:block;font-size:12px;color:var(--muted);font-weight:700;margin-bottom:5px}
  .k-inp,.k-sel,.k-ta{width:100%;background:var(--card2);border:1px solid var(--border);border-radius:10px;color:var(--text);padding:9px 11px;font-size:14px;outline:none}
  .k-inp:focus,.k-sel:focus,.k-ta:focus{border-color:var(--green)}
  .k-ta{min-height:70px;resize:vertical}
  .k-btn{border:none;border-radius:10px;padding:10px 16px;font-weight:800;font-size:13px;cursor:pointer}
  .k-btn-g{background:linear-gradient(135deg,#1FD760,#12a548);color:#05210D}
  .k-btn-s{background:var(--card2);border:1px solid var(--border);color:var(--text)}
  .k-btn-s:hover{border-color:var(--green)}
  .k-tbl{width:100%;border-collapse:collapse}
  .k-tbl th{text-align:left;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;padding:9px 10px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--card);z-index:1}
  .k-tbl td{padding:9px 10px;border-bottom:1px solid var(--tbl-line);font-size:13px}
  .k-tbl tbody tr.k-prodrow{cursor:pointer}
  .k-tbl tbody tr:hover{background:var(--hover)}
  .k-tbl .num{text-align:right;font-variant-numeric:tabular-nums}
  .k-badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:800}
  .k-badge-cat{background:var(--badge-cat-bg);color:var(--badge-cat-fg);border:1px solid var(--badge-cat-border)}
  .k-empty{padding:34px;text-align:center;color:var(--muted2)}
  .k-alert{padding:10px 14px;border-radius:10px;font-size:13px;background:var(--green-d);color:var(--green);border:1px solid #1f5a33}
  .k-trade[data-theme="light"] .k-alert{border-color:#9FD4B0}
  .k-cats{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}
  .k-cat{flex-shrink:0;border:1px solid var(--border);background:var(--card2);color:var(--muted);border-radius:14px;padding:10px 14px;font-weight:800;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:78px;transition:.12s}
  .k-cat .ce{font-size:18px}
  .k-cat:hover{color:var(--text);border-color:var(--muted2);background:var(--hover)}
  .k-cat.active{background:linear-gradient(135deg,#1FD760,#14b24f);color:#05210D;border-color:transparent}
  .k-trade[data-theme="light"] .k-cat{background:#DCE8E1;color:#2F5A3C;border-color:#B5C9BC}
  .k-trade[data-theme="light"] .k-cat:hover{background:#D0DED5;color:#0C1A10}
  .k-trade[data-theme="light"] .k-cat.active{background:linear-gradient(135deg,#1FD760,#14b24f);color:#05210D;border-color:transparent}
  .k-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:60;padding:20px}
  .k-trade[data-theme="light"] .k-modal-bg{background:rgba(12,26,16,.45)}
  .k-modal{width:460px;max-width:100%;max-height:88vh;background:var(--panel);border:1px solid var(--border);border-radius:18px;display:flex;flex-direction:column;overflow:hidden}
  .k-modal-wide{width:640px}
  .k-receipt-modal-bg{padding:10px;align-items:stretch;justify-content:center}
  .k-receipt-modal{border-radius:16px;width:min(98vw,900px);max-width:98vw;height:96vh;max-height:96vh}
  .k-modal-h{padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
  .k-modal-h b{font-size:16px;font-weight:900}
  .k-modal-h button{border:none;background:transparent;color:var(--muted);font-size:20px;cursor:pointer}
  .k-modal-b{overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
  .k-subtabs{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
  .k-subtab{border:1px solid var(--border);background:var(--card);color:var(--muted);border-radius:10px;padding:9px 16px;font-weight:800;font-size:13px;cursor:pointer}
  .k-subtab:hover{color:var(--text);border-color:var(--muted2)}
  .k-subtab.active{background:var(--green-d);border-color:var(--green);color:var(--green)}
  .k-product-layout{display:grid;grid-template-columns:280px 1fr;gap:16px;align-items:start}
  .k-product-list{background:var(--card);border:1px solid var(--border);border-radius:16px;overflow:hidden;position:sticky;top:0}
  .k-product-list-head{padding:12px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:8px}
  .k-product-list-body{max-height:62vh;overflow:auto;padding:8px}
  .k-product-pick{display:flex;align-items:center;gap:10px;width:100%;border:1px solid transparent;background:transparent;color:var(--text);border-radius:10px;padding:9px 10px;cursor:pointer;text-align:left;margin-bottom:4px}
  .k-product-pick:hover{background:var(--hover);border-color:var(--border)}
  .k-product-pick.active{background:var(--green-d);border-color:var(--green)}
  .k-product-pick .pe{font-size:18px;width:24px;text-align:center}
  .k-product-pick .pi{flex:1;min-width:0}
  .k-product-pick .pi b{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .k-product-pick .pi span{font-size:11px;color:var(--muted)}
  .k-product-form{min-height:400px}
  .k-tbl-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .k-tbl-scroll .k-tbl{min-width:640px}
  .k-line-row{display:grid;gap:8px;align-items:end;margin-bottom:8px}
  .k-line-row--3{grid-template-columns:1fr 100px auto}
  .k-line-row--5{grid-template-columns:1fr 80px 80px 60px auto}
  .k-label-layout{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}
  .k-receipt-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
  .k-mob-menu-btn{display:none}
  .k-side-overlay{display:none}
  .k-bottom-nav{display:none}
  .k-hide-mob{display:block}
  .k-hide-desk{display:none}

  @media (max-width:900px){
    .k-grid2{grid-template-columns:1fr}
    .k-product-layout{grid-template-columns:1fr}
    .k-label-layout{grid-template-columns:1fr}
    .k-line-row--3,.k-line-row--5{grid-template-columns:1fr 1fr}
    .k-line-row--3>:last-child,.k-line-row--5>:last-child{grid-column:1/-1;justify-self:start}
    .k-receipt-summary{grid-template-columns:repeat(2,1fr)}
    .k-hide-mob{display:none!important}
    .k-hide-desk{display:block}
    .k-trade{flex-direction:column}
    .k-side{
      position:fixed;left:0;top:0;z-index:200;width:min(280px,88vw);height:100vh;height:100dvh;
      transform:translateX(-105%);transition:transform .25s ease;box-shadow:none
    }
    .k-side.open{transform:translateX(0);box-shadow:8px 0 32px rgba(0,0,0,.55)}
    .k-side-overlay{
      display:block;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:199;
      opacity:0;pointer-events:none;transition:opacity .25s
    }
    .k-side-overlay.open{opacity:1;pointer-events:auto}
    .k-mob-menu-btn{
      display:flex;align-items:center;justify-content:center;width:42px;height:42px;
      border-radius:12px;border:1px solid var(--border);background:var(--card);color:var(--text);
      cursor:pointer;font-size:20px;flex-shrink:0
    }
    .k-main{width:100%;height:auto;min-height:100vh;min-height:100dvh;padding-bottom:calc(68px + env(safe-area-inset-bottom,0px))}
    .k-top{padding:10px 12px;gap:8px;flex-wrap:wrap}
    .k-search{max-width:none;min-width:0;order:3;flex:1 1 100%}
    .k-user .who{display:none}
    .k-body{padding:12px}
    .k-page-h h1{font-size:18px}
    .k-page-h .sub{font-size:12px}
    .k-kpis{grid-template-columns:repeat(2,1fr);gap:8px}
    .k-kpi{padding:12px}
    .k-kpi .kv{font-size:20px}
    .k-card-h{flex-wrap:wrap;padding:12px}
    .k-card-b{padding:12px}
    .k-subtabs{flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch;scrollbar-width:none}
    .k-subtabs::-webkit-scrollbar{display:none}
    .k-subtab{flex-shrink:0;padding:8px 12px;font-size:12px}
    .k-btn{min-height:44px;padding:10px 14px}
    .k-inp,.k-sel,.k-ta{font-size:16px;min-height:44px}
    .k-modal-bg{padding:0;align-items:stretch;justify-content:stretch}
    .k-modal,.k-modal-wide,.k-receipt-modal{
      width:100%!important;max-width:100%!important;
      height:100vh!important;max-height:100vh!important;
      height:100dvh!important;max-height:100dvh!important;
      border-radius:0;margin:0
    }
    .k-receipt-modal-bg{padding:0;align-items:stretch;justify-content:stretch}
    .k-modal-b{-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
    .k-product-list{position:static}
    .k-product-list-body{max-height:50vh}
    .k-tbl{font-size:12px}
    .k-tbl th,.k-tbl td{padding:8px 6px}
    .k-bottom-nav{
      display:flex;position:fixed;bottom:0;left:0;right:0;z-index:150;
      background:var(--panel);border-top:1px solid var(--border);
      padding:6px 6px calc(6px + env(safe-area-inset-bottom,0px));gap:4px
    }
    .k-bottom-nav button{
      flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
      border:none;background:transparent;color:var(--muted);border-radius:10px;padding:6px 4px;
      font-size:10px;font-weight:800;cursor:pointer;min-height:52px
    }
    .k-bottom-nav button .ic{font-size:20px;line-height:1}
    .k-bottom-nav button.active{background:var(--green-d);color:var(--green)}
    .k-bottom-nav button.menu-btn{color:var(--text)}
  }

  @media (max-width:600px){
    .k-kpis{grid-template-columns:1fr 1fr}
    .k-receipt-summary{grid-template-columns:1fr}
    .k-theme-toggle{order:2}
    .k-user{padding:4px}
  }

  @media (max-width:480px){
    .k-kpis{grid-template-columns:1fr 1fr}
    .k-receipt-summary{grid-template-columns:1fr 1fr}
    .k-mob-menu-btn{width:38px;height:38px}
    .k-body{padding:10px}
  }
`

const THEME_KEY = 'kakapo_trade_pos_theme'
type TradeTheme = 'dark' | 'light'

function loadTradeTheme(): TradeTheme {
  if (typeof window === 'undefined') return 'light'
  try {
    const t = localStorage.getItem(THEME_KEY)
    if (t === 'dark' || t === 'light') return t
    const shared = localStorage.getItem('kakapo_ui_theme')
    if (shared === 'dark' || shared === 'light') return shared
    return 'light'
  } catch {
    return 'light'
  }
}

function saveTradeTheme(theme: TradeTheme) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(THEME_KEY, theme)
    localStorage.setItem('kakapo_ui_theme', theme)
    window.dispatchEvent(new CustomEvent('kakapo-theme', { detail: theme }))
  } catch { /* private mode */ }
}

type TradePage = TradePageId

type NavItem = {
  id: TradePage
  label: string
  icon: string
  tag?: string
}

const NAV: NavItem[] = [
  { id: 'sales', label: 'Точка продаж', icon: '🛒' },
  { id: 'products', label: 'Товары', icon: '📦' },
  { id: 'clients', label: 'Клиенты', icon: '👥' },
  { id: 'debts', label: 'Долги', icon: '💳' },
  { id: 'warehouse', label: 'Склад', icon: '🏬' },
  { id: 'suppliers', label: 'Поставщики', icon: '🚚' },
  { id: 'finance', label: 'Финансы', icon: '💰' },
  { id: 'reports', label: 'Отчёты', icon: '📊' },
]

const SOON_PAGES: Record<string, { title: string; icon: string; desc: string }> = {}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase() || 'K'
}

function Clock() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!now) return <div className="k-clock"><div className="time">--:--</div></div>
  return (
    <div className="k-clock">
      <div className="date">{now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
      <div className="time">{now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
      <div className="day" style={{ textTransform: 'capitalize' }}>{now.toLocaleDateString('ru-RU', { weekday: 'long' })}</div>
    </div>
  )
}

function NetworkStatus() {
  const online = useOfflineSync(s => s.online)
  const pending = useOfflineSync(s => s.pending)
  const failed = useOfflineSync(s => s.failed)
  const syncing = useOfflineSync(s => s.syncing)
  const progress = useOfflineSync(s => s.progress)
  const lastSyncAtIso = useOfflineSync(s => s.lastSyncAtIso)
  const [mounted, setMounted] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)

  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return <div className="k-online"><span className="d" />Онлайн</div>

  const state = syncing ? 'sync' : !online ? 'offline' : failed > 0 ? 'failed' : 'online'
  const label = syncing
    ? `Синхронизация ${progress.total > 0 ? `${progress.done} из ${progress.total}` : ''}`.trim()
    : online
      ? 'Онлайн'
      : (typeof navigator !== 'undefined' && navigator.onLine
        ? 'Нет связи с сервером'
        : 'Без интернета')

  const lastSync = lastSyncAtIso
    ? new Date(lastSyncAtIso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <>
      <div className="k-online" data-state={state}><span className="d" />{label}</div>
      {(pending > 0 || failed > 0 || !!lastSync) && (
        <button type="button" className="k-netnote" onClick={() => setQueueOpen(true)}>
          {pending > 0 && <div>Ждут отправки: {pending}</div>}
          {failed > 0 && <div>Требуют разбора: {failed}</div>}
          {!!lastSync && <div>Синхронизация в {lastSync}</div>}
        </button>
      )}
      {queueOpen && <OfflineQueuePanel onClose={() => setQueueOpen(false)} />}
    </>
  )
}

function shortUpdateError(raw: string) {
  const s = String(raw || '').trim()
  if (!s) return 'Не удалось проверить'
  if (/404|Cannot find channel/i.test(s)) return 'На сервере ещё нет файла обновления'
  if (/ENOTFOUND|ECONNREFUSED|network|offline|ERR_/i.test(s)) return 'Нет связи с сервером обновлений'
  if (/только в установленной/i.test(s)) return s
  return s.length > 72 ? `${s.slice(0, 72)}…` : s
}

/** Компактная кнопка обновления внизу сайдбара (только desktop) */
function DesktopUpdateButton() {
  const [mounted, setMounted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<DesktopUpdateStatus>({
    state: 'idle',
    currentVersion: '',
    availableVersion: '',
    percent: 0,
    error: '',
    message: '',
  })
  const toastShownRef = useRef(false)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!mounted || !isKakapoDesktop()) return
    const desk = getKakapoDesktop()
    if (!desk?.getUpdateStatus) return

    void desk.getUpdateStatus().then(s => setStatus(s)).catch(() => undefined)
    const off = desk.onUpdateStatus?.(s => {
      setStatus(s)
      if (s.state === 'available' && s.availableVersion && !toastShownRef.current) {
        toastShownRef.current = true
      }
    })
    const t = window.setTimeout(() => {
      void desk.checkForUpdates?.().then(s => { if (s) setStatus(s) }).catch(() => undefined)
    }, 5000)
    return () => {
      window.clearTimeout(t)
      off?.()
    }
  }, [mounted])

  if (!mounted || !isKakapoDesktop()) return null

  const ver = status.currentVersion ? `v${status.currentVersion}` : ''
  const pct = Math.round(status.percent || 0)

  let title = 'Обновить'
  let sub = ver ? `Текущая ${ver}` : 'Проверить обновление'
  if (status.state === 'checking') {
    title = 'Проверка…'
    sub = ver
  } else if (status.state === 'available') {
    title = 'Скачать обновление'
    sub = `Доступна v${status.availableVersion}`
  } else if (status.state === 'downloading') {
    title = `Скачивание ${pct}%`
    sub = `v${status.availableVersion || status.currentVersion}`
  } else if (status.state === 'downloaded') {
    title = 'Установить'
    sub = `v${status.availableVersion} · перезапуск`
  } else if (status.state === 'not-available') {
    title = 'Актуальная версия'
    sub = ver
  } else if (status.state === 'error') {
    title = 'Обновить'
    sub = shortUpdateError(status.error || status.message)
  }

  async function onClick() {
    const desk = getKakapoDesktop()
    if (!desk) return
    setBusy(true)
    try {
      if (status.state === 'downloaded' && desk.quitAndInstall) {
        await desk.quitAndInstall()
        return
      }
      if ((status.state === 'available' || status.state === 'downloading') && desk.downloadUpdate) {
        const s = await desk.downloadUpdate()
        setStatus(s)
        if (s.state === 'downloaded' && desk.quitAndInstall) {
          await desk.quitAndInstall()
        }
        return
      }
      if (desk.checkForUpdates) {
        const s = await desk.checkForUpdates()
        setStatus(s)
        if (s.state === 'available' && desk.downloadUpdate) {
          const d = await desk.downloadUpdate()
          setStatus(d)
          if (d.state === 'downloaded' && desk.quitAndInstall) {
            await desk.quitAndInstall()
          }
        }
      }
    } catch (e) {
      setStatus(prev => ({
        ...prev,
        state: 'error',
        error: e instanceof Error ? e.message : 'Ошибка обновления',
        message: e instanceof Error ? e.message : 'Ошибка обновления',
      }))
    } finally {
      setBusy(false)
    }
  }

  const disabled = busy || status.state === 'checking' || status.state === 'downloading'

  return (
    <button
      type="button"
      className="k-update"
      data-state={status.state}
      disabled={disabled}
      onClick={() => void onClick()}
      title={status.error || status.message || 'Обновление программы'}
    >
      <span className="u-title">
        <span>{title}</span>
        {ver && status.state !== 'available' && status.state !== 'downloaded' ? <span style={{ color: 'var(--muted)', fontWeight: 700 }}>{ver}</span> : null}
      </span>
      {sub ? <span className="u-sub">{sub}</span> : null}
      {status.state === 'downloading' && (
        <span className="u-bar"><i style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} /></span>
      )}
    </button>
  )
}

function TradeAppInner({
  session,
  onLogout,
  theme,
  onThemeChange,
}: {
  session: TradeEmployeeSession
  onLogout: () => void
  theme: TradeTheme
  onThemeChange: (theme: TradeTheme) => void
}) {
  useApiSync('pos')
  const allowedNav = useMemo(
    () => NAV.filter(item => canAccessTradePage(session.permissions, item.id)),
    [session.permissions],
  )
  const defaultPage = firstAllowedTradePage(session.permissions)
  const { page, setPage } = useAppNavigation(defaultPage)
  const products = useProducts(s => s.products)
  const loaded = useProducts(s => s.loaded)
  const [search, setSearch] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [posSurface, setPosSurface] = useState<'dashboard' | 'register'>('dashboard')

  function applyTheme(next: TradeTheme) {
    onThemeChange(next)
  }

  useEffect(() => {
    void useProducts.getState().fetchProducts()
  }, [])

  useEffect(() => {
    setMenuOpen(false)
  }, [page])

  useEffect(() => {
    if (!menuOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [menuOpen])

  const current = (
    allowedNav.some(p => p.id === page) ? page : defaultPage
  ) as TradePage

  useEffect(() => {
    if (!canAccessTradePage(session.permissions, page)) {
      setPage(defaultPage)
    }
  }, [session.permissions, page, defaultPage, setPage])

  const showSearch = current === 'products' || current === 'warehouse'

  function focusTradeSearch() {
    const el = searchInputRef.current
    if (!el) return
    try { el.focus({ preventScroll: true }) } catch { el.focus() }
  }

  useEffect(() => {
    if (!showSearch) return
    setSearch('')
    const t = window.setTimeout(focusTradeSearch, 40)
    return () => window.clearTimeout(t)
  }, [current, showSearch])

  // Пока в Товар/Склад — печать с клавиатуры/сканера сразу в поиск
  useEffect(() => {
    if (!showSearch) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const active = document.activeElement as HTMLElement | null
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable)) {
        return
      }
      if (active?.closest?.('.modal-card, .overlay, .k-modal, .k-modal-bg')) return
      if (e.key.length === 1 || e.key === 'Backspace') {
        focusTradeSearch()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [showSearch])

  const posFullscreen = current === 'sales' && posSurface === 'register'

  function goTo(p: TradePage) {
    if (!canAccessTradePage(session.permissions, p)) return
    setMenuOpen(false)
    if (p !== 'sales') setPosSurface('dashboard')
    // Тяжёлые экраны (Товар / Склад) — не блокируем клик синхронным рендером
    startTransition(() => {
      setPage(p)
    })
  }

  useEffect(() => {
    if (current !== 'sales') setPosSurface('dashboard')
  }, [current])

  const MOB_QUICK: { id: TradePage | 'menu'; label: string; icon: string }[] = useMemo(() => {
    const prefer: TradePage[] = ['sales', 'products', 'warehouse', 'clients']
    const quick = prefer.filter(id => canAccessTradePage(session.permissions, id)).slice(0, 3)
    const items: { id: TradePage | 'menu'; label: string; icon: string }[] = quick.map(id => {
      const n = NAV.find(x => x.id === id)!
      return { id: n.id, label: n.label.split(' ')[0], icon: n.icon }
    })
    items.push({ id: 'menu', label: 'Меню', icon: '☰' })
    return items
  }, [session.permissions])

  function renderPage() {
    if (!canAccessTradePage(session.permissions, current)) {
      return <div className="k-empty">Нет доступа к этому разделу</div>
    }
    if (!loaded && current === 'products') return <div className="k-empty">Загрузка товаров…</div>
    if (current === 'products') return <ProductsModule search={search} />
    if (current === 'warehouse') return <WarehouseModule products={products} search={search} />
    if (current === 'suppliers') return <SuppliersModule />
    if (current === 'clients') return <ClientsModule />
    if (current === 'debts') return <DebtsModule />
    if (current === 'reports') return <ReportsModule />
    if (current === 'finance') return <FinanceModule />
    const soon = SOON_PAGES[current]
    if (soon) return <ComingSoonModule icon={soon.icon} title={soon.title} description={soon.desc} />
    return <div className="k-empty">Раздел недоступен</div>
  }

  const homePage = allowedNav.find(n => n.id === 'products')?.id
    || allowedNav.find(n => n.id === 'sales')?.id
    || defaultPage

  const salesActive = current === 'sales'
  const [salesKeepAlive, setSalesKeepAlive] = useState(salesActive)
  useEffect(() => {
    if (salesActive) setSalesKeepAlive(true)
  }, [salesActive])

  return (
    <div className={`k-trade ${posFullscreen ? 'pos-fs' : ''}`} data-theme={theme}>
      <style>{CSS}</style>

      {!posFullscreen && (
        <>
          <div className={`k-side-overlay ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)} aria-hidden />
          <aside className={`k-side ${menuOpen ? 'open' : ''}`}>
            <div className="k-logo">
              <span className="mark">🦜</span>
              <span>Торговля</span>
            </div>
            <div className="k-logo-sub">6-е приложение KAKAPO · {session.name}</div>
            <nav className="k-nav">
              {allowedNav.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={`k-navitem ${current === item.id ? 'active' : ''}`}
                  onClick={() => goTo(item.id)}
                >
                  <span className="ic">{item.icon}</span>
                  {item.label}
                  {item.tag && <span className="tag">{item.tag}</span>}
                </button>
              ))}
            </nav>
            <div className="k-side-foot">
              <div className="k-store">
                <div className="name">Магазин KAKAPO</div>
                <NetworkStatus />
                <Clock />
                <DesktopUpdateButton />
                <button
                  type="button"
                  className="k-btn k-btn-s"
                  style={{ width: '100%', marginTop: 10, padding: '8px 10px', fontSize: 12 }}
                  onClick={onLogout}
                >
                  Выйти
                </button>
              </div>
            </div>
          </aside>
        </>
      )}

      <div className={posFullscreen ? 'k-pos-fs-host' : 'k-main'}>
        {!posFullscreen && current !== 'sales' && (
          <header className="k-top">
            <button type="button" className="k-mob-menu-btn k-hide-desk" onClick={() => setMenuOpen(true)} aria-label="Меню">☰</button>
            {showSearch ? (
              <div className="k-search">
                <span className="mag">🔍</span>
                <input
                  ref={searchInputRef}
                  placeholder="Поиск по названию, артикулу, штрихкоду…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onFocus={e => e.currentTarget.select()}
                />
                {search.trim() ? (
                  <button
                    type="button"
                    className="k-search-clear"
                    aria-label="Очистить поиск"
                    title="Очистить"
                    onClick={() => {
                      setSearch('')
                      window.setTimeout(focusTradeSearch, 0)
                    }}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            ) : (
              <div style={{ flex: 1, fontWeight: 800, color: 'var(--muted)', minWidth: 0 }}>
                {NAV.find(n => n.id === current)?.label}
              </div>
            )}
            <div className="k-theme-toggle" role="group" aria-label="Тема">
              <button
                type="button"
                className={`k-theme-mode ${theme === 'dark' ? 'on' : ''}`}
                title="Тёмная тема"
                onClick={() => applyTheme('dark')}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M21 14.3A9 9 0 1 1 9.7 3 7 7 0 0 0 21 14.3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                className={`k-theme-mode ${theme === 'light' ? 'on' : ''}`}
                title="Светлая тема"
                onClick={() => applyTheme('light')}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.05 5.05l1.56 1.56M17.39 17.39l1.56 1.56M18.95 5.05l-1.56 1.56M6.61 17.39l-1.56 1.56" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <button type="button" className="k-user" title="Выйти" onClick={onLogout}>
              <div className="av">{initials(session.name)}</div>
              <div className="who"><b>{session.name}</b><span>Выйти</span></div>
            </button>
          </header>
        )}

        <div className={salesActive ? 'k-body k-body-pos' : 'k-body'}>
          {salesKeepAlive && (
            <div
              style={salesActive ? undefined : { display: 'none' }}
              aria-hidden={!salesActive}
            >
              <CashierModule
                active={salesActive}
                embedded={!posFullscreen}
                theme={theme}
                onThemeChange={applyTheme}
                onSurfaceChange={setPosSurface}
                onExit={() => goTo(homePage)}
                onNavigate={p => goTo(p as TradePage)}
              />
            </div>
          )}
          {!salesActive && renderPage()}
        </div>
      </div>

      {!posFullscreen && (
        <nav className="k-bottom-nav k-hide-desk" aria-label="Быстрая навигация">
          {MOB_QUICK.map(item => (
            <button
              key={item.id}
              type="button"
              className={`${current === item.id ? 'active' : ''} ${item.id === 'menu' ? 'menu-btn' : ''}`}
              onClick={() => item.id === 'menu' ? setMenuOpen(true) : goTo(item.id)}
            >
              <span className="ic">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}

function TradeAppGate() {
  const [session, setSession] = useState<TradeEmployeeSession | null>(null)
  const [ready, setReady] = useState(false)
  const [theme, setTheme] = useState<TradeTheme>(() => loadTradeTheme())
  /** null = ещё проверяем диск; true = установка ок; false = нужен первый скач */
  const [localDbReady, setLocalDbReady] = useState<boolean | null>(() => (isKakapoDesktop() ? null : true))

  useEffect(() => {
    void hydrateOfflineCaches()
    useOfflineSync.getState().start()
    setSession(loadTradeEmployeeSession())
    setTheme(loadTradeTheme())
    if (isKakapoDesktop()) {
      void isLocalBootstrapComplete().then(done => {
        setLocalDbReady(done)
        // если база уже есть — тихо подтянем остатки/цены при наличии сети
        if (done) {
          void import('@/lib/offlineBootstrap').then(m => m.silentSyncFromServer()).catch(() => {})
        }
      })
    } else {
      setLocalDbReady(true)
    }
    setReady(true)
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.style.background = theme === 'light' ? '#F3F7F4' : '#070C09'
    document.body.style.background = theme === 'light' ? '#F3F7F4' : '#070C09'
  }, [theme])

  function applyTheme(next: TradeTheme) {
    setTheme(next)
    saveTradeTheme(next)
  }

  if (!ready || localDbReady === null) {
    return (
      <div className="k-trade" data-theme={theme} style={{ minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <style>{CSS}</style>
        <div style={{ color: 'var(--muted)', fontWeight: 700 }}>Загрузка…</div>
      </div>
    )
  }

  // Пока данные не скачаны (товары + пароли) — только экран загрузки, без логина
  if (isKakapoDesktop() && localDbReady === false) {
    return (
      <LocalDbBootstrap
        theme={theme}
        onDone={() => {
          void hydrateOfflineCaches()
          setLocalDbReady(true)
        }}
      />
    )
  }

  if (!session) {
    return (
      <div className="k-trade" data-theme={theme} style={{ minHeight: '100vh', display: 'block' }}>
        <style>{CSS}</style>
        <TradeLoginPage
          theme={theme}
          onThemeChange={applyTheme}
          onSuccess={s => {
            saveTradeEmployeeSession(s)
            setSession(s)
          }}
        />
      </div>
    )
  }

  return (
    <TradeAppInner
      session={session}
      theme={theme}
      onThemeChange={applyTheme}
      onLogout={() => {
        clearTradeEmployeeSession()
        setSession(null)
      }}
    />
  )
}

export default function TradeApp() {
  return (
    <AppNavigationBoundary>
      <TradeAppGate />
    </AppNavigationBoundary>
  )
}
