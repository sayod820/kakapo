'use client'

import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useApiSync } from '@/lib/useApiSync'
import { useOfflineSync } from '@/lib/offlineSync'
import { hydrateOfflineCaches } from '@/lib/offlineHydrate'
import { useAppNavigation } from '@/lib/useAppNavigation'
import AppNavigationBoundary from '@/components/shared/AppNavigationBoundary'
import ClientErrorBoundary from '@/components/shared/ClientErrorBoundary'
import { useProducts } from '@/lib/store'
import ProductsModule, { type ProductsSubPage } from '@/components/trade/ProductsModule'
import WarehouseModule from '@/components/trade/WarehouseModule'
import SuppliersModule from '@/components/trade/SuppliersModule'
import ClientsModule from '@/components/trade/ClientsModule'
import DebtsModule from '@/components/trade/DebtsModule'
import CashierModule, { type CashierDashboardApi } from '@/components/trade/CashierModule'
import ComingSoonModule from '@/components/trade/ComingSoonModule'
import FinanceModule from '@/components/trade/FinanceModule'
import ReportsModule from '@/components/trade/ReportsModule'
import TradeLoginPage from '@/components/trade/TradeLoginPage'
import TradeDeviceGate from '@/components/trade/TradeDeviceGate'
import LocalDbBootstrap from '@/components/trade/LocalDbBootstrap'
import OfflineQueuePanel from '@/components/trade/OfflineQueuePanel'
import MobileBarcodeScanner from '@/components/shared/MobileBarcodeScanner'
import {
  getKakapoDesktop,
  isKakapoDesktop,
  type DesktopUpdateStatus,
} from '@/lib/desktopBridge'
import { isTradeAndroidNative } from '@/lib/tradeAndroid'
import { isLocalBootstrapComplete } from '@/lib/offlineBootstrap'
import { pushBackHandler } from '@/lib/hardwareBack'
import { USE_API } from '@/lib/config'
import { api } from '@/lib/api'
import {
  clearTradeDeviceBind,
  ensureTradeDeviceReady,
  getTradeDeviceIdSync,
} from '@/lib/tradeDevice'
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
import { isTradeMobileUi } from '@/lib/tradeAndroid'

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
  .k-side-foot{padding:8px;border-top:1px solid var(--border)}
  .k-store{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:8px}
  .k-store .name{font-weight:800;font-size:12px;line-height:1.2}
  .k-online{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--green);font-weight:700;margin-top:0}
  .k-online .d{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 0 2px rgba(31,215,96,.18)}
  .k-online[data-state="offline"]{color:var(--gold)}
  .k-online[data-state="offline"] .d{background:var(--gold);box-shadow:0 0 0 3px rgba(255,184,0,.18)}
  .k-online[data-state="sync"]{color:var(--blue)}
  .k-online[data-state="sync"] .d{background:var(--blue);box-shadow:0 0 0 3px rgba(59,142,240,.18)}
  .k-online[data-state="failed"]{color:var(--red)}
  .k-online[data-state="failed"] .d{background:var(--red);box-shadow:0 0 0 3px rgba(255,90,90,.18)}
  .k-online-chip{
    display:none;align-items:center;gap:5px;border:1px solid var(--border);background:var(--card);
    color:var(--green);border-radius:999px;padding:5px 8px;font-size:11px;font-weight:800;
    cursor:pointer;min-height:32px;font-family:inherit;flex-shrink:0
  }
  .k-online-chip .d{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 3px rgba(31,215,96,.18);flex-shrink:0}
  .k-online-chip .t{line-height:1}
  .k-online-chip .n{
    min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--gold);
    color:#3a2a00;font-size:10px;display:inline-flex;align-items:center;justify-content:center
  }
  .k-online-chip[data-state="offline"]{color:var(--gold)}
  .k-online-chip[data-state="offline"] .d{background:var(--gold);box-shadow:0 0 0 3px rgba(255,184,0,.18)}
  .k-online-chip[data-state="sync"]{color:var(--blue)}
  .k-online-chip[data-state="sync"] .d{background:var(--blue);box-shadow:0 0 0 3px rgba(59,142,240,.18)}
  .k-online-chip[data-state="failed"]{color:var(--red)}
  .k-online-chip[data-state="failed"] .d{background:var(--red);box-shadow:0 0 0 3px rgba(255,90,90,.18)}
  .k-wo-line{
    padding:10px;border-radius:10px;border:1px solid var(--border);background:var(--card2);margin-bottom:8px
  }
  .k-wo-line.is-on{border-color:rgba(255,90,90,.45);background:rgba(255,90,90,.04)}
  .k-wo-line.is-bad{border-color:var(--red);background:rgba(255,90,90,.06)}
  .k-wo-line-top{display:flex;align-items:flex-start;gap:8px;margin-bottom:8px}
  .k-wo-line-idx{font-size:12px;font-weight:900;color:var(--muted);min-width:16px;padding-top:6px}
  .k-wo-line-emo{font-size:22px;line-height:1;flex-shrink:0}
  .k-wo-line-txt{flex:1;min-width:0}
  .k-wo-line-txt b{display:block;font-size:13px;font-weight:900;line-height:1.25}
  .k-wo-line-txt small{display:block;font-size:10px;color:var(--muted);margin-top:2px}
  .k-wo-line-top .k-btn{padding:3px 7px;font-size:11px;min-height:0}
  .k-wo-line-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
  .k-wo-line-grid .k-field{margin-bottom:0}
  .k-wo-line-grid .k-field label{font-size:10px;margin-bottom:2px}
  .k-wo-ro{display:flex;align-items:center;opacity:.9;cursor:default}
  .k-wo-line-foot{display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap}
  .k-wo-line-foot .k-btn{padding:4px 8px;font-size:11px;min-height:0}
  .k-wo-line-foot .err{font-size:11px;color:var(--red);font-weight:700}
  .k-wo-reason{padding:0 0 8px;margin-bottom:8px;border-bottom:1px solid var(--border)}
  .k-wo-reason-h{font-size:11px;color:var(--muted);font-weight:700;margin-bottom:6px}
  .k-wo-reason-list{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px}
  .k-wo-reason-btn{
    border:1px solid var(--border);background:var(--card);color:var(--muted);
    border-radius:8px;padding:6px 9px;font-size:11px;font-weight:800;cursor:pointer;
    display:inline-flex;align-items:center;gap:4px;font-family:inherit
  }
  .k-wo-summary{
    display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;
    position:sticky;top:0;z-index:2;margin:0 0 8px;padding:8px;
    border:1px solid var(--border);border-radius:10px;background:var(--panel)
  }
  .k-wo-summary span{display:block;font-size:9px;color:var(--muted);font-weight:700}
  .k-wo-summary b{display:block;font-size:13px;font-weight:900;margin-top:1px}
  .k-wo-add{
    padding:10px;border-radius:10px;border:1.5px dashed rgba(255,90,90,.45);
    background:rgba(255,90,90,.04);margin-bottom:8px
  }
  .k-wo-add-h{font-size:12px;font-weight:900;color:var(--red);margin-bottom:6px}
  .k-offline-notice,.k-trade-banner{display:none!important}
  .k-wh-cta{display:none!important}
  .k-catalog-add{display:none!important}
  .k-wh-fab,.k-cli-fab,.k-prod-fab,.k-sup-fab,.k-fin-fab{
    display:flex;align-items:center;justify-content:center;
    position:fixed;right:22px;bottom:22px;z-index:140;
    width:52px;height:52px;border-radius:14px;border:none;
    background:linear-gradient(135deg,#1FD760,#14b24f);color:#05210D;
    font-size:28px;font-weight:900;line-height:1;cursor:pointer;
    box-shadow:0 8px 22px rgba(31,215,96,.35)
  }
  .k-wh-fab:disabled,.k-cli-fab:disabled,.k-prod-fab:disabled,.k-sup-fab:disabled,.k-fin-fab:disabled{opacity:.45;cursor:default;box-shadow:none}
  .k-fin-fab-exp{
    background:linear-gradient(135deg,#FF5A5A,#cc4040);color:#fff;
    box-shadow:0 8px 22px rgba(255,90,90,.35)
  }
  .k-fin-fab-wd{
    background:linear-gradient(135deg,#FF5A5A,#cc4040);color:#fff;
    box-shadow:0 8px 22px rgba(255,90,90,.35)
  }
  .k-fin-fab-stack{
    position:fixed;right:22px;bottom:22px;z-index:140;
    display:flex;flex-direction:column;gap:10px;align-items:center
  }
  .k-fin-fab-stack .k-fin-fab{position:static;right:auto;bottom:auto}
  .k-finance-mod{padding-bottom:72px}
  .k-finance-mod:has(.k-modal-bg) .k-fin-fab,
  .k-finance-mod:has(.k-modal-bg) .k-fin-fab-stack{display:none!important}
  .k-wh-fab.has-draft::after{
    content:'';position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;
    background:var(--gold);box-shadow:0 0 0 2px rgba(255,184,0,.25)
  }
  .k-wo-fab,.k-rev-fab{display:none}
  .k-clients-mod{padding-bottom:72px}
  .k-suppliers-mod{padding-bottom:72px}
  .k-cli-sync-bar{font-size:11px;color:var(--muted);margin:0 0 8px;font-weight:700}
  .k-sup-kpis{
    display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px
  }
  .k-sup-kpis .k-kpi{padding:12px 14px;border-radius:12px}
  .k-sup-kpis .k-kpi .kl{font-size:11px}
  .k-sup-kpis .k-kpi .kv{font-size:20px;margin-top:4px}
  .k-sup-meta{display:none}
  .k-sup-toolbar{
    display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center;flex:0 0 auto
  }
  .k-sup-search{flex:1 1 220px;max-width:360px;min-height:36px;height:36px;box-sizing:border-box}
  .k-sup-chips{display:flex;gap:6px;flex-wrap:wrap;margin:0}
  .k-sup-list{display:flex;flex-direction:column;gap:8px}
  .k-sup-row{
    display:flex;align-items:center;gap:6px;padding:10px 12px;
    border:1px solid var(--border);border-radius:12px;background:var(--card)
  }
  .k-sup-row.is-debt{border-color:rgba(255,184,0,.45)}
  .k-sup-main{
    flex:1;min-width:0;display:flex;align-items:flex-start;gap:10px;flex-wrap:nowrap;
    border:none;background:transparent;color:inherit;text-align:left;cursor:pointer;padding:0;font:inherit
  }
  .k-sup-emo{font-size:20px;flex-shrink:0;line-height:1.2}
  .k-sup-txt{flex:1 1 160px;min-width:0}
  .k-sup-name{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .k-sup-name b{font-size:14px;font-weight:900}
  .k-sup-txt small{display:block;font-size:11px;color:var(--muted);margin-top:3px;line-height:1.35}
  .k-sup-stats{display:flex;gap:12px;flex-wrap:wrap;margin-left:auto}
  .k-sup-stats > div{text-align:right;min-width:58px}
  .k-sup-stats span{display:block;font-size:10px;color:var(--muted);font-weight:700}
  .k-sup-stats b{display:block;font-size:12px;font-weight:900;margin-top:1px}
  .k-sup-actions{display:flex;gap:4px;flex-shrink:0;align-items:center}
  .k-sup-actions .k-btn{
    width:34px;height:34px;min-height:0;padding:0;border-radius:8px;
    display:inline-flex;align-items:center;justify-content:center;font-size:14px
  }
  .k-cli-head-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .k-cli-sync{font-size:12px;color:var(--muted)}
  .k-clients-mod:has(.k-modal-bg) .k-cli-fab,
  .k-suppliers-mod:has(.k-modal-bg) .k-sup-fab{display:none!important}
  .k-fin-sync-bar{font-size:11px;color:var(--muted);margin:0 0 8px;font-weight:700}
  .k-fin-err{
    margin:0 0 10px;padding:8px 10px;border-radius:10px;font-size:12px;font-weight:700;
    background:#2a1420;color:#FF8A8A;border:1px solid #5a2030
  }
  .k-fin-kpis{
    display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:12px
  }
  .k-fin-kpis .k-kpi{padding:12px 14px;border-radius:12px}
  .k-fin-kpis .k-kpi .kl{font-size:11px}
  .k-fin-kpis .k-kpi .kv{font-size:20px;margin-top:4px}
  .k-fin-kpi-sub{font-size:11px;color:var(--muted);margin-top:4px;font-weight:700}
  .k-fin-box-totals{
    display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 10px
  }
  .k-fin-box-hero{
    padding:16px 18px;border-radius:12px;border:1px solid var(--border);
    background:var(--card);margin:0 0 10px
  }
  .k-fin-box-hero .kl{font-size:12px;color:var(--muted);font-weight:700}
  .k-fin-box-hero .kv{font-size:28px;font-weight:900;margin-top:4px}
  .k-fin-box-move-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 12px}
  .k-fin-box-move{width:100%;margin:0}
  .k-fin-box-card{
    padding:14px 16px;border-radius:12px;border:1px solid var(--border);
    background:var(--card)
  }
  .k-fin-box-card .kl{font-size:11px;color:var(--muted);font-weight:700}
  .k-fin-box-card .kv{font-size:22px;font-weight:900;margin-top:4px}
  .k-fin-box-main{margin-bottom:10px}
  .k-fin-box-points{display:grid;gap:8px}
  .k-fin-box-point{
    padding:12px 14px;border-radius:10px;border:1px solid var(--border);background:var(--card2)
  }
  .k-fin-box-point.is-open{border-color:color-mix(in srgb, var(--green) 45%, var(--border))}
  .k-fin-box-point-h{
    display:flex;justify-content:space-between;gap:8px;align-items:baseline;margin-bottom:8px
  }
  .k-fin-box-point-h b{font-size:14px}
  .k-fin-box-point-h span{font-size:11px;color:var(--muted);font-weight:700}
  .k-fin-box-point-h span.is-on{color:var(--green)}
  .k-fin-box-point-nums{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .k-fin-box-point-nums span{display:block;font-size:10px;color:var(--muted);font-weight:700}
  .k-fin-box-point-nums b{display:block;font-size:15px;font-weight:900;margin-top:2px}
  .k-fin-meta{display:none}
  .k-fin-toolbar{
    display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;align-items:center
  }
  .k-fin-periods{display:flex;gap:5px;flex-wrap:wrap;margin:0;flex:1 1 auto}
  .k-fin-periods .k-subtab{padding:5px 10px;font-size:12px;min-height:0}
  .k-fin-actions{display:flex;gap:4px;flex-shrink:0;align-items:center;margin-left:auto}
  .k-fin-actions .k-btn{
    width:34px;height:34px;min-height:0;padding:0;border-radius:8px;
    display:inline-flex;align-items:center;justify-content:center;font-size:16px;font-weight:900
  }
  .k-fin-flt-btn{display:inline-flex!important}
  .k-fin-flt-btn.is-on{border-color:var(--green);color:var(--green)}
  .k-fin-dates{
    display:grid;grid-template-columns:1fr 1fr;gap:8px;max-width:420px;margin:0 0 8px
  }
  .k-fin-filters{
    display:none;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:0 0 8px
  }
  .k-fin-filters.is-open{display:grid}
  .k-fin-filters .k-sel{min-height:32px;height:32px;padding:2px 8px;font-size:12px;box-sizing:border-box}
  .k-fin-tabs{
    display:flex;gap:5px;flex-wrap:wrap;margin:0 0 6px;overflow-x:auto;
    -webkit-overflow-scrolling:touch;scrollbar-width:none
  }
  .k-fin-tabs::-webkit-scrollbar{display:none}
  .k-fin-tabs .k-subtab{
    display:inline-flex;align-items:center;gap:4px;padding:6px 10px;font-size:12px;min-height:0;flex-shrink:0
  }
  .k-fin-tab-ic{font-size:13px;line-height:1}
  .k-fin-tab-n{
    min-width:16px;height:16px;padding:0 4px;border-radius:8px;font-size:10px;font-weight:900;
    background:var(--badge-warn-bg);color:var(--red);display:inline-flex;align-items:center;justify-content:center
  }
  .k-fin-hint{font-size:12px;color:var(--muted);font-weight:700;margin:0 0 10px;line-height:1.35}
  .k-fin-conv-body{padding:16px;padding-bottom:calc(16px + env(safe-area-inset-bottom,0px))}
  .k-fin-submeta{
    display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;
    margin:0 0 10px;padding:8px 10px;border:1px solid var(--border);border-radius:10px;background:var(--card)
  }
  .k-fin-submeta-2{grid-template-columns:repeat(2,minmax(0,1fr))}
  .k-fin-submeta span{display:block;font-size:10px;color:var(--muted);font-weight:700}
  .k-fin-submeta b{display:block;font-size:13px;font-weight:900;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .k-fin-split{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .k-fin-panel{
    border:1px solid var(--border);border-radius:12px;background:var(--card);overflow:hidden;margin-bottom:10px
  }
  .k-fin-panel-h{
    display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;
    padding:8px 12px;border-bottom:1px solid var(--border);font-size:13px;font-weight:900
  }
  .k-fin-panel-acts{display:flex;gap:6px}
  .k-fin-panel-acts .k-btn{min-height:0;padding:5px 10px;font-size:12px}
  .k-fin-list{display:flex;flex-direction:column}
  .k-fin-row{
    display:flex;align-items:flex-start;gap:10px;padding:9px 12px;
    border-bottom:1px solid var(--tbl-line)
  }
  .k-fin-row:last-child{border-bottom:none}
  .k-fin-row.is-warn{background:rgba(180,40,40,.1)}
  .k-fin-row-txt{flex:1;min-width:0}
  .k-fin-row-txt b{display:block;font-size:13px;font-weight:900;line-height:1.25}
  .k-fin-row-txt small{display:block;font-size:11px;color:var(--muted);margin-top:3px;line-height:1.35}
  .k-fin-amt{flex-shrink:0;font-size:13px;font-weight:900;text-align:right;white-space:nowrap}
  .k-fin-amt-col{flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:4px}
  .k-fin-amt-col b{font-size:13px;font-weight:900}
  .k-fin-amt-col small{font-size:10px;color:var(--muted);font-weight:700}
  .k-fin-del{width:28px!important;height:28px!important;min-height:0!important;padding:0!important;font-size:12px!important}
  .k-reports-mod{padding-bottom:12px}
  .k-rep-sync-bar{font-size:11px;color:var(--muted);margin:0 0 8px;font-weight:700}
  .k-rep-err{
    margin:0 0 10px;padding:8px 10px;border-radius:10px;font-size:12px;font-weight:700;
    background:#2a1420;color:#FF8A8A;border:1px solid #5a2030
  }
  .k-rep-toolbar{
    display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;align-items:center
  }
  .k-rep-periods{display:flex;gap:5px;flex-wrap:wrap;margin:0;flex:1 1 auto}
  .k-rep-periods .k-subtab{padding:5px 10px;font-size:12px;min-height:0}
  .k-rep-search{
    flex:0 1 180px;max-width:220px;min-width:120px;
    height:32px!important;min-height:32px!important;max-height:32px!important;
    padding:4px 8px!important;font-size:13px!important;box-sizing:border-box
  }
  .k-rep-actions{display:flex;gap:4px;flex-shrink:0;align-items:center}
  .k-rep-actions .k-btn{
    width:32px;height:32px;min-height:0;padding:0;border-radius:8px;
    display:inline-flex;align-items:center;justify-content:center;font-size:14px;font-weight:900
  }
  .k-rep-flt-btn{display:inline-flex!important}
  .k-rep-flt-btn.is-on,
  .k-rep-actions .k-btn-s.is-on{border-color:var(--green);color:var(--green)}
  .k-rep-dates{
    display:grid;grid-template-columns:1fr 1fr;gap:8px;max-width:420px;margin:0 0 8px
  }
  .k-rep-help{
    margin:0 0 10px;padding:10px 12px;border-radius:10px;border:1px solid var(--border);
    background:var(--card);font-size:12px;color:var(--muted);font-weight:700;line-height:1.45
  }
  .k-rep-help b{display:block;color:var(--text);margin-bottom:4px;font-size:13px}
  .k-rep-filters{
    display:none;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:0 0 8px
  }
  .k-rep-filters.k-rep-filters-2{grid-template-columns:repeat(2,minmax(0,1fr))}
  .k-rep-filters.is-open{display:grid}
  .k-rep-filters .k-sel{
    min-height:32px;height:32px;padding:2px 8px;font-size:12px;box-sizing:border-box;width:100%
  }
  .k-rep-filter-note{font-size:11px;color:var(--muted);font-weight:700;margin:0 0 8px}
  .k-rep-tabs{
    display:flex;gap:5px;flex-wrap:wrap;margin:0 0 6px;overflow-x:auto;
    -webkit-overflow-scrolling:touch;scrollbar-width:none
  }
  .k-rep-tabs::-webkit-scrollbar{display:none}
  .k-rep-tabs .k-subtab{
    display:inline-flex;align-items:center;gap:4px;padding:6px 10px;font-size:12px;min-height:0;flex-shrink:0
  }
  .k-rep-tab-ic{font-size:13px;line-height:1}
  .k-rep-hint{font-size:12px;color:var(--muted);font-weight:700;margin:0 0 10px;line-height:1.35}
  .k-rep-highlight{
    display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;
    margin:0 0 8px;padding:10px 12px;border:1px solid rgba(31,215,96,.35);
    border-radius:12px;background:linear-gradient(135deg,rgba(31,215,96,.08),rgba(31,215,96,.02))
  }
  .k-rep-highlight span{display:block;font-size:11px;color:var(--muted);font-weight:700}
  .k-rep-highlight b{display:block;font-size:18px;font-weight:900;margin-top:3px;line-height:1.15}
  .k-rep-highlight small{display:block;font-size:10px;font-weight:800;margin-top:2px}
  .k-rep-stats{
    display:grid;grid-template-columns:repeat(auto-fit,minmax(72px,1fr));gap:6px;
    margin:0 0 8px;padding:8px 10px;border:1px solid var(--border);border-radius:10px;background:var(--card)
  }
  .k-rep-stats span{display:block;font-size:10px;color:var(--muted);font-weight:700}
  .k-rep-stats b{display:block;font-size:13px;font-weight:900;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .k-rep-note{
    font-size:11px;color:var(--muted);font-weight:700;margin:0 0 10px;line-height:1.4
  }
  .k-rep-split{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}
  .k-rep-panel{
    border:1px solid var(--border);border-radius:12px;background:var(--card);overflow:hidden
  }
  .k-rep-panel-h{
    display:flex;align-items:center;justify-content:space-between;gap:8px;
    padding:8px 12px;border-bottom:1px solid var(--border);font-size:13px;font-weight:900
  }
  .k-rep-panel-h .k-btn{min-height:0;padding:4px 8px;font-size:11px}
  .k-rep-list{display:flex;flex-direction:column}
  .k-rep-row{
    display:flex;align-items:flex-start;gap:10px;padding:8px 12px;
    border-bottom:1px solid var(--tbl-line)
  }
  .k-rep-row:last-child{border-bottom:none}
  .k-rep-row.is-warn{background:rgba(180,40,40,.1)}
  .k-rep-row-txt{flex:1;min-width:0}
  .k-rep-row-txt b{display:block;font-size:13px;font-weight:900;line-height:1.25}
  .k-rep-row-txt small{display:block;font-size:11px;color:var(--muted);margin-top:2px;line-height:1.35}
  .k-rep-amt{flex-shrink:0;font-size:13px;font-weight:900;text-align:right;white-space:nowrap}
  .k-rep-row-rich{
    display:grid;grid-template-columns:1fr auto;grid-template-areas:
      "txt amt"
      "metrics metrics";
    gap:4px 10px;align-items:start
  }
  .k-rep-row-rich .k-rep-row-txt{grid-area:txt}
  .k-rep-row-rich .k-rep-amt{grid-area:amt;align-self:start}
  .k-rep-row-metrics{
    grid-area:metrics;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));
    gap:6px;margin-top:2px;padding-top:6px;border-top:1px solid var(--tbl-line)
  }
  .k-rep-row-metrics-2{grid-template-columns:repeat(2,minmax(0,1fr))}
  .k-rep-row-metrics span{display:block;font-size:9px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.02em}
  .k-rep-row-metrics b{display:block;font-size:12px;font-weight:900;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .k-reports-mod .k-kpis{
    display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:6px;margin-bottom:10px!important
  }
  .k-reports-mod .k-kpi{padding:8px 10px;border-radius:10px}
  .k-reports-mod .k-kpi .kl{font-size:10px}
  .k-reports-mod .k-kpi .kv{font-size:15px;margin-top:2px}
  .k-reports-mod .k-card{margin-bottom:10px}
  .k-reports-mod .k-card-h{padding:8px 12px}
  .k-reports-mod .k-card-h b{font-size:13px}
  .k-reports-mod .k-card-h .k-btn{min-height:0;padding:4px 8px;font-size:11px}
  .k-reports-mod .k-tbl th{padding:6px 8px;font-size:10px}
  .k-reports-mod .k-tbl td{padding:6px 8px;font-size:12px}
  .k-cli-err{display:none!important}
  .k-cli-meta{display:none}
  .k-cli-toolbar{
    display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center;flex:0 0 auto
  }
  .k-cli-search{flex:1 1 220px;max-width:360px;min-height:36px;height:36px;box-sizing:border-box}
  .k-cli-list{display:flex;flex-direction:column;gap:8px}
  .k-cli-row{
    display:flex;align-items:stretch;gap:6px;padding:10px 12px;
    border:1px solid var(--border);border-radius:12px;background:var(--card)
  }
  .k-cli-row.is-debt{border-color:var(--border-debt)}
  .k-cli-row.is-bad{border-color:var(--border-debt-over)}
  .k-cli-main{
    flex:1;min-width:0;display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;
    border:none;background:transparent;color:inherit;text-align:left;cursor:pointer;padding:0;font:inherit
  }
  .k-cli-emo{font-size:22px;flex-shrink:0;line-height:1.2}
  .k-cli-txt{flex:1 1 160px;min-width:0}
  .k-cli-name{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .k-cli-name b{font-size:14px;font-weight:900}
  .k-cli-txt small{display:block;font-size:11px;color:var(--muted);margin-top:3px;line-height:1.35}
  .k-cli-stats{display:flex;gap:12px;flex-wrap:wrap;margin-left:auto}
  .k-cli-stats > div{text-align:right;min-width:52px}
  .k-cli-stats span{display:block;font-size:10px;color:var(--muted);font-weight:700}
  .k-cli-stats b{display:block;font-size:12px;font-weight:900;margin-top:1px}
  .k-cli-actions{display:flex;gap:4px;flex-shrink:0;align-items:center;flex-wrap:wrap}
  .k-cli-actions .k-btn{padding:6px 8px;font-size:12px;min-height:0}
  .k-rev-modal{display:flex;flex-direction:column}
  .k-rev-steps{
    flex-shrink:0;display:flex;align-items:center;gap:8px;
    padding:8px 12px;border-bottom:1px solid var(--border);background:var(--panel)
  }
  .k-rev-step-pill{display:flex;align-items:center;gap:6px;flex:1;min-width:0}
  .k-rev-step-n{
    width:22px;height:22px;border-radius:50%;flex-shrink:0;
    display:flex;align-items:center;justify-content:center;
    font-weight:900;font-size:11px;background:var(--card2);color:var(--muted);
    border:1.5px solid var(--border)
  }
  .k-rev-step-n.on{background:#3B8EF0;color:#fff;border-color:#3B8EF0}
  .k-rev-step-n.done{background:var(--green-d);color:var(--green);border-color:var(--green)}
  .k-rev-step-lbl{font-size:12px;font-weight:700;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .k-rev-step-lbl.on{font-weight:900;color:var(--text)}
  .k-rev-step-lbl.done{color:var(--green)}
  .k-rev-step-line{flex:0 0 20px;height:2px;background:var(--border);border-radius:1px}
  .k-rev-step-line.on{background:var(--green)}
  .k-rev-scope{
    flex:1;display:flex;flex-direction:column;min-height:0;overflow:auto;
    padding:10px 12px 14px;-webkit-overflow-scrolling:touch
  }
  .k-rev-scope-main{
    flex:1;min-height:0;display:flex;flex-direction:column;
    gap:8px;padding:10px;border:1px solid var(--border);border-radius:12px;background:var(--card2)
  }
  .k-rev-scope-hero{
    display:flex;align-items:flex-start;gap:10px;
    padding:8px 10px;border:1px solid var(--border);border-radius:12px;background:var(--card2);margin-bottom:8px
  }
  .k-rev-scope-hero-ic{
    width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;
    flex-shrink:0;background:rgba(59,142,240,.14);color:#3B8EF0;font-size:18px
  }
  .k-rev-scope-hero b{display:block;font-size:20px;line-height:1.15;font-weight:900}
  .k-rev-scope-hero small{display:block;margin-top:4px;font-size:13px;line-height:1.35;color:var(--muted);font-weight:700}
  .k-rev-scope-lbl{font-size:11px;color:var(--muted);font-weight:700;margin:0}
  .k-rev-cats{margin-bottom:10px}
  .k-rev-scope-cats{
    display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;
    flex:1;min-height:120px;overflow:auto;-webkit-overflow-scrolling:touch;align-content:start;padding:2px
  }
  .k-rev-scope-cat{
    display:flex;align-items:center;gap:8px;width:100%;text-align:left;
    min-height:44px;padding:8px 10px;border-radius:11px;cursor:pointer;
    border:1px solid var(--border);background:var(--panel);color:var(--text);
    font-family:'Nunito',sans-serif;font-size:13px;font-weight:800
  }
  .k-rev-scope-cat.active{
    border-color:rgba(31,215,96,.45);background:rgba(31,215,96,.12);color:#1a7a3c
  }
  .k-rev-scope-cat .ce{font-size:16px;line-height:1;flex-shrink:0}
  .k-rev-scope-cat .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .k-rev-scope-cat .cc{
    flex-shrink:0;font-size:11px;font-weight:900;padding:2px 7px;border-radius:999px;
    background:var(--card2);border:1px solid var(--border);color:var(--muted)
  }
  .k-rev-scope-cat.active .cc{border-color:rgba(31,215,96,.35);color:#1a7a3c;background:rgba(31,215,96,.1)}
  .k-rev-scope-cat .ok{flex-shrink:0;color:#1FD760;font-weight:900}
  .k-rev-stock-flt{display:flex;gap:5px;flex-wrap:wrap;margin:0}
  .k-rev-stock-flt .k-subtab{padding:7px 12px;font-size:12px;min-height:34px}
  .k-rev-scope-sum{
    display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;flex-shrink:0;
    padding:8px 10px;border-radius:10px;background:var(--panel);
    border:1px solid var(--border);margin:0
  }
  .k-rev-scope-sum > span:first-child{font-size:11px;color:var(--muted);font-weight:700}
  .k-rev-scope-sum b{font-size:16px;font-weight:900}
  .k-rev-scope-sum-sub{font-size:11px;color:var(--muted);margin-left:auto}
  .k-rev-scope-hint{font-size:11px;color:var(--gold);margin:0;text-align:center;font-weight:700}
  .k-rev-scope-actions{
    display:grid;grid-template-columns:1fr 1.6fr;gap:8px;margin-top:10px;flex-shrink:0;
    position:sticky;bottom:0;background:var(--panel);padding-top:8px
  }
  .k-rev-scope-actions .k-btn{min-height:44px;width:100%;font-size:16px}
  .k-rev-mode{
    flex:1;display:flex;flex-direction:column;gap:10px;min-height:0;overflow:auto;
    padding:14px 12px 16px;-webkit-overflow-scrolling:touch
  }
  .k-rev-mode-lbl{font-size:12px;font-weight:800;color:var(--muted);margin-bottom:2px}
  .k-rev-mode-card{
    display:flex;align-items:center;gap:12px;width:100%;text-align:left;
    padding:14px 12px;border-radius:12px;border:1px solid var(--border);
    background:var(--card2);cursor:pointer;transition:border-color .12s,background .12s
  }
  .k-rev-mode-card:hover{border-color:#3B8EF0;background:rgba(59,142,240,.06)}
  .k-rev-mode-ic{
    width:42px;height:42px;border-radius:11px;flex-shrink:0;
    display:flex;align-items:center;justify-content:center;font-size:22px
  }
  .k-rev-mode-txt{flex:1;min-width:0}
  .k-rev-mode-txt b{display:block;font-size:15px;font-weight:900;margin-bottom:2px}
  .k-rev-mode-txt small{display:block;font-size:12px;color:var(--muted);line-height:1.35}
  .k-rev-mode-go{font-size:18px;color:var(--muted);font-weight:900;flex-shrink:0}
  .k-rev-mode-cancel{margin-top:4px;align-self:stretch;min-height:36px}
  .k-rev-walk-body{padding:8px 12px 72px!important}
  .k-rev-walk-toolbar{display:flex;gap:6px;align-items:stretch}
  .k-rev-walk-toolbar .k-inp{flex:1;min-width:0}
  .k-rev-devs-btn{
    display:inline-flex;align-items:center;gap:5px;flex-shrink:0;
    padding:0 10px;min-height:40px;border-radius:10px;border:1px solid var(--border);
    background:var(--panel);color:var(--text);cursor:pointer;font-family:'Nunito',sans-serif;
    font-size:11px;font-weight:800;white-space:nowrap
  }
  .k-rev-devs-btn.warn{border-color:rgba(255,180,0,.45);background:rgba(255,180,0,.08)}
  .k-rev-devs-btn--empty{opacity:.55;cursor:default}
  .k-rev-devs-btn-ic{font-size:13px;line-height:1}
  .k-rev-devs-btn-txt b{color:#3B8EF0;font-weight:900;margin-left:2px}
  .k-rev-devs-btn-go{font-size:16px;color:var(--muted);font-weight:900;line-height:1}
  .k-rev-devs-sheet-bg{
    position:fixed;inset:0;z-index:140;background:rgba(0,0,0,.5);
    display:flex;align-items:flex-end;justify-content:center;padding:12px;box-sizing:border-box
  }
  .k-rev-devs-sheet{
    width:min(420px,100%);max-height:min(78vh,560px);background:var(--panel);
    border:1px solid var(--border);border-radius:14px;padding:12px;
    display:flex;flex-direction:column;gap:8px;box-shadow:0 12px 40px rgba(0,0,0,.35)
  }
  .k-rev-devs-sheet-h{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
  .k-rev-devs-sheet-h b{display:block;font-size:15px;font-weight:900}
  .k-rev-devs-sheet-h .sub{font-size:11px;color:var(--muted);font-weight:700;margin-top:2px;line-height:1.35}
  .k-rev-devs-sheet-tools{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .k-rev-devs-sheet-tools .k-btn{min-height:32px;padding:4px 10px;font-size:11px}
  .k-rev-devs-sheet-n{
    margin-left:auto;font-size:11px;font-weight:900;padding:4px 8px;border-radius:999px;
    background:var(--card2);border:1px solid var(--border)
  }
  .k-rev-devs-sheet-list{
    flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:4px;
    -webkit-overflow-scrolling:touch
  }
  .k-rev-devs-row{
    display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;
    border:1px solid var(--border);background:var(--card2);cursor:pointer
  }
  .k-rev-devs-row.on{border-color:rgba(31,215,96,.4);background:rgba(31,215,96,.08)}
  .k-rev-devs-row.cur{box-shadow:inset 0 0 0 1px rgba(59,142,240,.25)}
  .k-rev-devs-row input{accent-color:#1FD760;flex-shrink:0}
  .k-rev-devs-row-ic{font-size:16px;line-height:1;flex-shrink:0}
  .k-rev-devs-row-txt{flex:1;min-width:0}
  .k-rev-devs-row-txt b{display:block;font-size:13px;font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .k-rev-devs-row-txt small{display:block;font-size:10px;color:var(--muted);font-weight:700;margin-top:1px}
  .k-rev-devs-sheet-warn{font-size:10px;color:var(--gold);font-weight:700;line-height:1.35}
  .k-rev-devs-sheet-actions{display:grid;grid-template-columns:1fr 1.4fr;gap:6px}
  .k-rev-devs-sheet-actions .k-btn{min-height:40px;width:100%}
  .k-rev-devs-step{display:flex;flex-direction:column;gap:8px}
  .k-rev-edit-toolbar{align-items:stretch}
  .k-rev-edit-toolbar .k-inp{flex:1;min-width:0}
  .k-rev-walk{display:flex;flex-direction:column;gap:8px;min-height:0}
  .k-rev-walk-sticky{display:flex;flex-direction:column;gap:6px}
  .k-rev-walk-mini{display:flex;align-items:stretch;gap:6px}
  .k-rev-walk-filterbtn{
    flex:1;min-width:0;display:flex;align-items:center;justify-content:space-between;gap:8px;
    text-align:left;padding:6px 10px;border-radius:10px;border:1px solid var(--border);
    background:var(--card2);cursor:pointer;font-family:'Nunito',sans-serif
  }
  .k-rev-walk-filterbtn span{
    font-size:12px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap
  }
  .k-rev-walk-filterbtn em{font-style:normal;font-size:11px;font-weight:900;color:#3B8EF0;white-space:nowrap;flex-shrink:0}
  .k-rev-walk-icbtn{
    width:40px;flex-shrink:0;border-radius:10px;border:1px solid var(--border);background:var(--card2);
    cursor:pointer;font-size:16px
  }
  .k-rev-walk-icbtn.on{border-color:rgba(59,142,240,.45);background:rgba(59,142,240,.1)}
  .k-rev-walk-scopechip{
    display:flex;align-items:center;gap:6px;
    padding:6px 8px;border-radius:10px;border:1px solid var(--border);background:var(--card2)
  }
  .k-rev-walk-scopechip-txt{
    flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
    font-size:12px;font-weight:800;color:var(--text)
  }
  .k-rev-walk-scopechip .k-btn{min-height:30px;padding:4px 10px;font-size:11px}
  .k-rev-walk-back-short{display:none}
  .k-rev-walk-prog{display:flex;align-items:center;gap:8px}
  .k-rev-walk-prog-bar{
    flex:1;height:6px;border-radius:99px;background:var(--card2);border:1px solid var(--border);overflow:hidden
  }
  .k-rev-walk-prog-bar i{
    display:block;height:100%;background:linear-gradient(90deg,#3B8EF0,#1fd760);border-radius:99px
  }
  .k-rev-walk-prog > span{font-size:11px;font-weight:800;color:var(--muted);white-space:nowrap}
  .k-rev-walk-prog > span b{color:var(--text);font-weight:900}
  .k-rev-walk-prog > span em{font-style:normal;font-weight:700}
  .k-rev-walk-tabs{display:flex;gap:6px;flex-wrap:wrap}
  .k-rev-walk-tabs .k-subtab{padding:6px 12px;font-size:12px}
  .k-rev-walk-tabs .k-subtab b{font-weight:900;margin-left:2px}
  .k-rev-walk-search{display:flex;gap:8px;align-items:stretch}
  .k-rev-walk-search .k-inp{flex:1;min-width:0}
  .k-rev-walk-search .k-cam-scan-btn{flex-shrink:0;min-width:48px;min-height:44px;padding:0 12px;font-size:20px}
  .k-rev-walk-msg{font-size:12px;color:var(--muted);font-weight:700}
  .k-rev-walk-sum{
    display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;
    padding:6px 8px;border-radius:10px;border:1px solid var(--border);background:var(--card2)
  }
  .k-rev-walk-sum span{display:block;font-size:9px;color:var(--muted);font-weight:700}
  .k-rev-walk-sum b{display:block;font-size:12px;font-weight:900;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .k-rev-walk-filters{display:flex;flex-direction:column;gap:0}
  .k-rev-walk-list{display:flex;flex-direction:column;gap:5px}
  .k-rev-walk-row{
    display:flex;align-items:center;gap:8px;width:100%;text-align:left;
    padding:8px 10px;border-radius:10px;border:1px solid var(--border);
    background:var(--card2);cursor:pointer
  }
  .k-rev-walk-emo{font-size:18px;flex-shrink:0;line-height:1}
  .k-rev-walk-txt{flex:1;min-width:0}
  .k-rev-walk-txt b{
    display:block;font-size:13px;font-weight:900;line-height:1.25;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap
  }
  .k-rev-walk-txt small{display:block;font-size:10px;color:var(--muted);margin-top:1px;line-height:1.35;white-space:normal}
  .k-rev-walk-go{color:var(--muted);font-weight:900;flex-shrink:0}
  .k-rev-walk-done{
    display:flex;align-items:stretch;gap:4px;border-radius:10px;
    border:1px solid var(--border);background:var(--card2);overflow:hidden
  }
  .k-rev-walk-done.up{border-color:rgba(31,215,96,.45)}
  .k-rev-walk-done.down{border-color:rgba(255,90,90,.45)}
  .k-rev-walk-done .k-rev-walk-row{border:0;border-radius:0;background:transparent;flex:1}
  .k-rev-walk-done-btns{display:flex;flex-direction:column;gap:2px;padding:4px;flex-shrink:0}
  .k-rev-walk-done-btns .k-btn{width:28px;height:28px;padding:0;font-size:12px}
  .k-rev-walk-sheet-bg{
    position:fixed;inset:0;z-index:120;background:rgba(0,0,0,.45);
    display:flex;align-items:flex-end;justify-content:center;padding:12px;
    box-sizing:border-box
  }
  .k-rev-walk-sheet{
    width:min(420px,100%);background:var(--panel);border:1px solid var(--border);
    border-radius:14px;padding:12px;box-shadow:0 12px 40px rgba(0,0,0,.35)
  }
  .k-rev-walk-sheet-handle{display:none}
  .k-rev-walk-sheet-h{display:flex;align-items:flex-start;gap:8px;margin-bottom:10px}
  .k-rev-walk-sheet-h-btns{display:flex;align-items:center;gap:4px;flex-shrink:0}
  .k-rev-walk-sheet-h-btns .k-btn{
    width:32px;height:32px;min-height:0;padding:0;font-size:14px;
    display:inline-flex;align-items:center;justify-content:center;border-radius:8px
  }
  .k-rev-walk-sheet-diff{
    margin:8px 0;padding:8px;border-radius:8px;background:var(--card2);
    font-weight:900;font-size:14px;text-align:center;
    display:flex;flex-direction:column;align-items:center;gap:2px;min-height:40px;justify-content:center
  }
  .k-rev-walk-sheet-diff.up{background:rgba(31,215,96,.1)}
  .k-rev-walk-sheet-diff.down{background:rgba(255,90,90,.08)}
  .k-rev-walk-sheet-diff.ok{background:rgba(31,215,96,.08)}
  .k-rev-walk-sheet-diff b{font-size:14px;font-weight:900}
  .k-rev-walk-sheet-diff span{font-size:11px;font-weight:700}
  .k-rev-walk-sheet-actions{display:grid;grid-template-columns:1fr 1fr 1.4fr;gap:6px}
  .k-rev-walk-sheet-actions .k-btn{min-height:40px;width:100%}
  .k-rev-scroll{flex:1;overflow:auto;min-height:0;padding:8px 12px 72px;-webkit-overflow-scrolling:touch}
  .k-rev-head-actions{display:none}
  .k-rev-note{padding:0 0 8px;margin-bottom:8px;border-bottom:1px solid var(--border)}
  .k-rev-note-row{display:flex;gap:6px;align-items:center}
  .k-rev-note-row .k-inp{flex:1;min-width:0}
  .k-rev-note-row .k-btn{flex-shrink:0;min-height:36px;padding:6px 10px;font-size:12px}
  .k-rev-scope-chip{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:6px}
  .k-rev-scope-chip > span{
    font-size:11px;padding:4px 8px;border-radius:7px;background:var(--panel);
    border:1px solid var(--border);color:var(--muted);font-weight:700
  }
  .k-rev-scope-chip .k-btn{font-size:11px;padding:4px 8px;min-height:0}
  .k-rev-summary{
    display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;
    position:sticky;top:0;z-index:2;margin:0 0 8px;padding:6px 8px;
    border:1px solid var(--border);border-radius:10px;background:var(--panel)
  }
  .k-rev-summary span{display:block;font-size:9px;color:var(--muted);font-weight:700}
  .k-rev-summary b{display:block;font-size:12px;font-weight:900;margin-top:1px}
  .k-rev-search{margin-bottom:8px}
  .k-rev-line{
    padding:8px 10px;border-radius:10px;border:1px solid var(--border);
    background:var(--card2);margin-bottom:6px;transition:border-color .12s,background .12s
  }
  .k-rev-line.is-on{border-color:#3B8EF0;background:rgba(59,142,240,.06)}
  .k-rev-line.is-up{border-color:rgba(31,215,96,.45)}
  .k-rev-line.is-down{border-color:rgba(255,90,90,.45)}
  .k-rev-line-top{display:flex;align-items:flex-start;gap:6px}
  .k-rev-line-n{font-size:11px;font-weight:900;color:var(--muted);min-width:14px;padding-top:2px}
  .k-rev-line-emo{font-size:18px;flex-shrink:0;line-height:1.2}
  .k-rev-line-txt{flex:1;min-width:0}
  .k-rev-line-txt b{
    display:block;font-size:13px;font-weight:900;line-height:1.25;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap
  }
  .k-rev-line-txt small{display:block;font-size:10px;color:var(--muted);margin-top:1px;line-height:1.3}
  .k-rev-line-txt small b{display:inline;font-size:inherit;color:var(--text)}
  .k-rev-line-btns{display:flex;gap:3px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;max-width:140px}
  .k-rev-line-btns .k-btn{
    width:28px;height:28px;min-height:0;padding:0;font-size:12px;
    display:inline-flex;align-items:center;justify-content:center;border-radius:8px
  }
  .k-rev-line-btns .k-rev-x{color:var(--red)}
  .k-rev-line-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(72px,0.8fr);gap:8px;align-items:end;margin-top:6px}
  .k-rev-line-grid .k-field{margin:0}
  .k-rev-line-grid .k-field label{font-size:10px;margin-bottom:2px}
  .k-rev-line-grid .k-inp{font-weight:800;font-size:15px}
  .k-rev-line-diff{
    display:flex;flex-direction:column;justify-content:center;align-items:flex-end;gap:1px;
    min-height:36px;padding:4px 8px;border-radius:8px;background:rgba(31,215,96,.08)
  }
  .k-rev-line-diff.ok b{color:var(--green);font-size:13px}
  .k-rev-line-diff.up{background:rgba(31,215,96,.1)}
  .k-rev-line-diff.down{background:rgba(255,90,90,.08)}
  .k-rev-line-diff b{font-size:12px;font-weight:900}
  .k-rev-line-diff span{font-size:10px;font-weight:700}
  .k-rev-add{
    padding:10px;border-radius:10px;border:1.5px dashed rgba(59,142,240,.45);
    background:rgba(59,142,240,.04);margin-top:8px
  }
  .k-rev-add-h{font-size:12px;font-weight:900;color:#3B8EF0;margin-bottom:6px}
  .k-rev-item{
    display:grid;grid-template-columns:22px minmax(0,1fr);grid-template-areas:"emo txt" "nums nums";
    gap:2px 6px;padding:5px 6px;border-radius:8px;
    border:1px solid var(--border);background:var(--card);align-items:start
  }
  .k-rev-item-emo{grid-area:emo;font-size:15px;line-height:1.2;flex-shrink:0}
  .k-rev-item-txt{grid-area:txt;min-width:0}
  .k-rev-item-txt b{
    display:block;font-size:12px;font-weight:900;line-height:1.2;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap
  }
  .k-rev-item-txt small{
    display:block;font-size:10px;color:var(--muted);margin-top:1px;line-height:1.2;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap
  }
  .k-rev-item-nums{
    grid-area:nums;display:flex;flex-wrap:wrap;align-items:center;gap:2px 8px;
    min-width:0;width:100%;padding-top:2px;border-top:1px dashed var(--border);margin-top:2px
  }
  .k-rev-item-nums b{font-size:12px;font-weight:900;white-space:nowrap}
  .k-rev-item-nums span{font-size:10px;font-weight:700;white-space:nowrap;color:var(--muted)}
  .k-rev-item-nums .k-rev-delta{font-size:12px;font-weight:900;white-space:nowrap}
  .k-rev-card-detail{display:grid;gap:4px}
  .k-netblock{
    margin-top:5px;width:100%;padding:5px 7px;border-radius:8px;border:1px solid var(--border);
    background:var(--card2);color:inherit;font:inherit;text-align:left;cursor:pointer;
    display:flex;flex-direction:column;align-items:flex-start;gap:1px
  }
  .k-netblock:hover{border-color:var(--green)}
  .k-netblock .k-online{margin-top:0}
  .k-netnote{margin-top:0;font-size:10px;color:var(--muted);line-height:1.25}
  .k-netblock:hover .k-netnote{color:var(--text)}
  .k-net-hint{margin-top:1px;font-size:9px;font-weight:700;color:var(--green)}
  .k-online{cursor:inherit}
  .k-update{width:100%;margin-top:6px;padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:var(--card2);color:var(--text);font:inherit;font-size:11px;font-weight:700;cursor:pointer;text-align:left;display:flex;flex-direction:column;gap:1px}
  .k-update:hover:not(:disabled){border-color:var(--green)}
  .k-update:disabled{opacity:.7;cursor:default}
  .k-update[data-state="available"],.k-update[data-state="downloaded"]{border-color:rgba(31,215,96,.45);background:rgba(31,215,96,.08)}
  .k-update[data-state="error"]{border-color:rgba(255,184,0,.4)}
  .k-update .u-title{display:flex;align-items:center;justify-content:space-between;gap:6px}
  .k-update .u-sub{font-size:10px;font-weight:600;color:var(--muted);line-height:1.25}
  .k-update .u-bar{height:3px;border-radius:99px;background:var(--border);overflow:hidden;margin-top:3px}
  .k-update .u-bar>i{display:block;height:100%;background:var(--green);width:0;transition:width .2s ease}
  .k-clock{margin-top:6px;padding-top:6px;border-top:1px solid var(--border)}
  .k-clock .date{font-size:10px;color:var(--muted);line-height:1.2}
  .k-clock .k-clock-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:2px}
  .k-clock .time{font-size:16px;font-weight:900;line-height:1.15;letter-spacing:.02em}
  .k-clock .day{font-size:10px;color:var(--muted);line-height:1.2}
  .k-clock .k-theme-toggle{padding:2px;border-radius:10px;gap:1px}
  .k-clock .k-theme-mode{width:28px;height:26px;border-radius:8px}
  .k-clock .k-theme-mode svg{width:13px;height:13px}
  .k-store .k-logout{
    width:100%;margin-top:6px;padding:6px 8px;font-size:11px;min-height:0;border-radius:8px
  }
  .k-store .k-user{
    width:100%;margin-top:6px;box-sizing:border-box;justify-content:flex-start;
    padding:7px 8px;border-radius:10px;gap:8px;text-align:left
  }
  .k-store .k-user .av{width:32px;height:32px;border-radius:9px;font-size:11px;flex-shrink:0}
  .k-store .k-user .who{min-width:0;flex:1}
  .k-store .k-user .who b{
    display:block;font-size:12px;line-height:1.15;font-weight:800;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap
  }
  .k-store .k-user .who span{font-size:11px;color:var(--muted);font-weight:700}


  .k-main{flex:1;min-width:0;display:flex;flex-direction:column;height:100vh;overflow:hidden}
  .k-top{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border);background:var(--panel);flex-shrink:0}
  .k-top-shell{display:contents}
  .k-top-back{flex-shrink:0;white-space:nowrap}
  .k-top-title{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:3px;font-weight:800;color:var(--text)}
  .k-top-title-main{font-size:16px;font-weight:900;line-height:1.15;color:var(--text)}
  .k-top-title-sub{font-size:11px;color:var(--muted);font-weight:600;line-height:1.2}
  .k-top-title-net{display:none;line-height:1}
  .k-top-subtabs{display:flex;gap:6px;flex-shrink:0;align-items:center}
  .k-top-subtabs .k-subtab{padding:7px 12px;font-size:12px;margin:0}
  .k-top-search-wrap{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;min-width:0}
  .k-top-search-net{flex-shrink:0;display:flex;align-items:center}
  .k-top-search-net .k-online-chip{display:inline-flex}
  .k-top-search-wrap .k-search{flex:1;max-width:560px;width:100%;min-width:0}
  .k-top-end{display:flex;align-items:center;gap:12px;flex-shrink:0}
  .k-top-pos-create{
    flex-shrink:0;white-space:nowrap;font-weight:900;font-size:12px;
    padding:8px 12px;border-radius:999px;min-height:36px;
  }
  .k-search{flex:1;position:relative;max-width:640px;min-width:0}
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
  .k-body-products{padding:6px 12px 10px;display:flex;flex-direction:column;overflow:hidden}
  .k-body-products > .k-products-mod{flex:1;min-height:0;display:flex;flex-direction:column}
  .k-products-mod > .k-subtabs{flex-shrink:0}
  .k-products-mod-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:auto}
  .k-products-mod-body > .k-product-edit-shell{flex:1;min-height:0;overflow:hidden}
  .k-products-mod-body > .k-catalog-shell{flex:1;min-height:0;overflow:hidden}
  .k-products-mod-body > .k-cats-panel{flex:1;min-height:0;overflow:hidden}
  .k-products-mod-body > .k-labels-shell{flex:1;min-height:0;overflow:hidden}
  .k-body-products:has(.k-product-edit-shell),
  .k-body-products:has(.k-catalog-shell),
  .k-body-products:has(.k-cats-panel),
  .k-body-products:has(.k-labels-shell){overflow:hidden}
  .k-body-products:has(.k-product-edit-shell) .k-products-mod-body,
  .k-body-products:has(.k-catalog-shell) .k-products-mod-body,
  .k-body-products:has(.k-cats-panel) .k-products-mod-body,
  .k-body-products:has(.k-labels-shell) .k-products-mod-body{overflow:hidden}
  .k-body-pos{padding:0;overflow:hidden;display:flex;flex-direction:column;}
  .k-body-pos > .pos-host{flex:1;min-height:0;display:flex;flex-direction:column;height:100%;}
  .k-body-pos > .pos-host > .pos-root,
  .k-body-pos .pos-root{flex:1;min-height:0;height:100%;}
  .k-body-debts{overflow:hidden;display:flex;flex-direction:column;padding:8px 12px}
  .k-body-debts > .k-debts-page{flex:1;min-height:0;display:flex;flex-direction:column}
  .k-body-warehouse{padding:6px 12px 10px;display:flex;flex-direction:column;overflow:hidden}
  .k-body-warehouse > .k-wh-shell{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
  .k-wh-shell > .k-wh-head{flex-shrink:0;display:flex;flex-direction:column;gap:6px;margin-bottom:8px}
  .k-wh-shell > .k-wh-body{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column}
  .k-wh-shell > .k-wh-body > .k-wh-stock{flex:1;min-height:0;overflow:hidden}
  .k-wh-shell > .k-wh-body > .k-wh-receipts,
  .k-wh-shell > .k-wh-body > .k-wh-writeoffs,
  .k-wh-shell > .k-wh-body > .k-wh-revisions,
  .k-wh-shell > .k-wh-body > .k-wh-expiry{flex:1;min-height:0;overflow:hidden}
  .k-wh-stock,
  .k-wh-receipts,
  .k-wh-writeoffs,
  .k-wh-revisions,
  .k-wh-expiry{display:flex;flex-direction:column;min-height:0}
  .k-wh-stock-head,
  .k-wh-receipts-head,
  .k-wh-panel-head{flex-shrink:0;display:flex;flex-direction:column;gap:6px;margin-bottom:8px}
  .k-wh-stock-body,
  .k-wh-receipts-body,
  .k-wh-panel-body{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--border);border-radius:12px;background:var(--card)}
  .k-wh-stock-body .k-tbl,
  .k-wh-receipts-body .k-tbl,
  .k-wh-panel-body .k-tbl{min-width:640px}
  .k-wh-stock-body .k-tbl th,
  .k-wh-receipts-body .k-tbl th,
  .k-wh-panel-body .k-tbl th{padding:6px 8px;font-size:10px}
  .k-wh-stock-body .k-tbl td,
  .k-wh-receipts-body .k-tbl td,
  .k-wh-panel-body .k-tbl td{padding:5px 8px;font-size:12px}
  .k-wh-stock-body .k-tbl tfoot td{padding:7px 8px}
  .k-wh-receipts .k-wh-cta,
  .k-wh-writeoffs .k-wh-cta{margin-bottom:0;align-items:center}
  .k-wh-receipts .k-wh-cta .k-btn-g,
  .k-wh-writeoffs .k-wh-cta .k-btn-g,
  .k-wh-revisions .k-wh-cta .k-btn-g{min-height:36px;padding:8px 14px;font-size:13px}
  .k-wh-receipts .k-wh-cta-spacer,
  .k-wh-writeoffs .k-wh-cta-spacer{display:none}
  .k-wh-period .k-inp{padding:6px 8px;font-size:12px;min-height:0;border-radius:8px}
  .k-wh-expiry-list{display:flex;flex-direction:column;gap:6px;padding:8px}
  .k-wh-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--muted);min-width:0}
  .k-wh-meta b{color:var(--text);font-weight:900}
  .k-wh-money{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-left:auto}
  .k-wh-money span{white-space:nowrap}
  .k-wh-money b{font-weight:900;color:var(--text)}
  .k-wh-filters-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .k-wh-filters-row .k-subtab{padding:5px 10px;font-size:12px}
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
  .k-grid2-tight{gap:8px}
  .k-field{margin-bottom:12px}
  .k-field label{display:block;font-size:12px;color:var(--muted);font-weight:700;margin-bottom:5px}
  .k-hint{font-size:10px;color:var(--muted);line-height:1.35;margin-top:3px}
  .k-product-edit{display:flex;flex-direction:column;gap:2px}
  .k-product-edit .k-field{margin-bottom:8px}
  .k-product-edit .k-field label{font-size:11px;margin-bottom:3px}
  .k-product-edit-hero{display:grid;grid-template-columns:120px 1fr;gap:12px;align-items:start;margin-bottom:10px}
  .k-product-edit-hero-fields{min-width:0}
  .k-product-edit-note{
    display:flex;flex-direction:column;gap:2px;
    padding:8px 10px;border-radius:10px;margin-bottom:8px;
    background:var(--green-d);border:1px solid rgba(31,215,96,.22);
    font-size:11px;color:var(--muted);
  }
  .k-product-edit-note b{color:var(--green);font-size:12px}
  .k-product-edit-flags{display:flex;gap:14px;flex-wrap:wrap;padding:2px 0 4px}
  .k-product-edit-flags label{display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;font-weight:700;color:var(--t2)}
  .k-product-form .k-card-b{padding-top:10px}
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
  .k-prodrow-sub{font-size:10px;color:var(--muted);line-height:1.25;margin-top:1px}
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
  .k-modal-fs-bg{padding:0;align-items:stretch;justify-content:stretch;z-index:160}
  .k-modal-fs{
    width:100%!important;max-width:100%!important;
    height:100vh!important;max-height:100vh!important;
    height:100dvh!important;max-height:100dvh!important;
    margin:0;border-radius:0;display:flex!important;flex-direction:column;overflow:hidden!important;min-height:0
  }
  .k-modal-fs > .k-modal-h{flex-shrink:0}
  .k-modal-fs > .k-modal-b{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column}
  .k-arrivals-body{padding:16px}
  .k-arrivals-head{align-items:flex-start}
  .k-arrivals-head-txt{min-width:0;flex:1}
  .k-arrivals-head-sub{font-size:12px;color:var(--muted);margin-top:4px;font-weight:500}
  .k-arrivals-dirty{font-size:11px;color:var(--gold);margin-top:4px;font-weight:700}
  .k-arrivals-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;flex-shrink:0}
  .k-arrivals-stock{font-size:13px;color:var(--muted);font-weight:600}
  .k-arrivals-stock b{font-size:16px;font-weight:900}
  .k-arrivals-stock-diff{margin-left:8px;color:var(--gold)}
  .k-arrivals-stock-n{margin-left:10px}
  .k-arrivals-toolbar-acts{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .k-arrivals-add{
    margin-bottom:14px;padding:14px;border-radius:12px;flex-shrink:0;
    background:var(--green-d);border:1px solid rgba(31,215,96,.25)
  }
  .k-arrivals-add-h{font-size:13px;font-weight:800;color:var(--green);margin-bottom:10px}
  .k-arrivals-row-acts{display:flex;gap:6px;justify-content:flex-end}
  .k-arrivals-row-acts .k-btn{padding:6px 10px;font-size:12px;min-height:0}
  .k-arrivals-edit{background:var(--card2);padding:14px;border-radius:10px}
  .k-arrivals-edit-grid{margin-bottom:10px;max-width:640px}
  .k-arrivals-edit-foot{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
  .k-arrivals-tbl-wrap{flex:1;min-height:0;overflow:auto;border:1px solid var(--border);border-radius:12px;background:var(--card)}
  .k-arrivals-tbl{width:100%;min-width:0;border-collapse:collapse}
  .k-arrivals-tbl th{
    text-align:left;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;
    padding:10px 12px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--card);z-index:1;white-space:nowrap
  }
  .k-arrivals-tbl td{padding:10px 12px;border-bottom:1px solid var(--tbl-line);font-size:13px;vertical-align:middle}
  .k-arrivals-tbl .num{text-align:right;font-variant-numeric:tabular-nums}
  .k-arrivals-tbl tbody tr:hover{background:var(--hover)}
  .k-top-scan-btn{
    display:none;position:absolute;right:6px;top:50%;transform:translateY(-50%);
    width:30px;height:30px;min-height:0;min-width:0;padding:0;margin:0;
    border:none;border-radius:9px;cursor:pointer;
    background:var(--card2);color:var(--muted);font-size:15px;line-height:1;
    align-items:center;justify-content:center;box-shadow:none
  }
  .k-top-scan-btn:active{background:var(--border);color:var(--text)}
  .k-cam-scan-btn{display:none!important}
  .k-label-search-row{display:flex;gap:6px;align-items:stretch;margin-bottom:8px}
  .k-label-search-row .k-inp{flex:1;min-width:0;margin-bottom:0!important}
  .k-receipt-modal-bg{
    z-index:180;padding:0;align-items:stretch;justify-content:stretch;
    background:var(--bg)
  }
  .k-trade[data-theme="light"] .k-receipt-modal-bg{background:var(--bg)}
  .k-receipt-modal{
    width:100%;max-width:100%;
    height:100vh;max-height:100vh;
    height:100dvh;max-height:100dvh;
    margin:0;display:flex;flex-direction:column;overflow:hidden;min-height:0;
    background:var(--panel);border:none;border-radius:0;box-shadow:none
  }
  .k-receipt-scroll{
    flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;
    -webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:0
  }
  .k-receipt-modal .k-field label{font-size:11px;margin-bottom:3px}
  .k-receipt-modal .k-inp,
  .k-receipt-modal .k-sel{padding:8px 10px;font-size:13px;border-radius:8px}
  .k-receipt-modal-actions{
    flex-shrink:0;padding:10px 14px;border-top:1px solid var(--border);background:var(--panel);
    display:flex;gap:8px;flex-wrap:wrap;align-items:center
  }
  .k-receipt-modal-actions .k-btn-primary-wide{flex:1;min-width:180px;padding:11px 16px;font-size:14px}
  .k-receipt-modal-actions .k-btn-row{display:flex;gap:6px;flex-wrap:wrap}
  .k-receipt-modal-actions .k-btn-s{padding:8px 12px;font-size:12px;min-height:0}

  .k-rcpt-head{
    flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:12px;
    padding:14px 18px;border-bottom:1px solid var(--border);background:var(--card)
  }
  .k-rcpt-head-title{display:flex;align-items:center;gap:10px;min-width:0}
  .k-rcpt-head-ic{
    width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;
    background:var(--green-d);color:var(--green);font-weight:900;border:1px solid rgba(31,215,96,.35)
  }
  .k-rcpt-head-title b{display:block;font-size:18px;font-weight:900;line-height:1.2}
  .k-rcpt-head-title .sub{font-size:11px;color:var(--muted);font-weight:600;margin-top:2px}
  .k-rcpt-head-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
  .k-rcpt-meta{flex-shrink:0;padding:12px 18px;border-bottom:1px solid var(--border);background:var(--panel)}
  .k-rcpt-layout{
    flex:1;min-height:0;overflow:auto;display:grid;grid-template-columns:280px minmax(0,1fr);
    gap:14px;padding:14px 18px;-webkit-overflow-scrolling:touch
  }
  .k-rcpt-main{
    min-width:0;background:var(--card);border:1px solid var(--border);border-radius:14px;
    padding:12px;display:flex;flex-direction:column;gap:10px;align-self:start
  }
  .k-rcpt-main-h{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
  .k-rcpt-main-h b{font-size:15px;font-weight:900}
  .k-rcpt-main-actions{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto}
  .k-rcpt-main-actions .k-btn.is-on{box-shadow:inset 0 0 0 1px var(--green)}
  .k-rcpt-add-box{
    padding:10px;border-radius:12px;border:1.5px dashed rgba(31,215,96,.45);background:rgba(31,215,96,.04)
  }
  .k-rcpt-find-bg{
    position:fixed;inset:0;z-index:240;padding:24px;
    background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;
    box-sizing:border-box
  }
  .k-trade[data-theme="light"] .k-rcpt-find-bg{background:rgba(12,26,16,.45)}
  .k-rcpt-find-modal{
    width:min(1100px,100%)!important;max-width:1100px!important;
    height:min(860px,calc(100dvh - 48px))!important;max-height:calc(100dvh - 48px)!important;
    border-radius:16px;margin:0;overflow:hidden;
    display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--border);
    box-shadow:0 20px 48px rgba(0,0,0,.35);box-sizing:border-box
  }
  .k-rcpt-find-h{
    flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:12px;
    padding:14px 18px;border-bottom:1px solid var(--border);background:var(--card)
  }
  .k-rcpt-find-h b{display:block;font-size:17px;font-weight:900}
  .k-rcpt-find-h .sub{font-size:11px;color:var(--muted);font-weight:600;margin-top:2px}
  .k-rcpt-find-x{border:none;background:transparent;color:var(--muted);font-size:20px;cursor:pointer;padding:4px 8px}
  .k-rcpt-line-bg{
    position:fixed;inset:0;z-index:250;padding:20px;
    background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;box-sizing:border-box
  }
  .k-trade[data-theme="light"] .k-rcpt-line-bg{background:rgba(12,26,16,.45)}
  .k-rcpt-line-modal{
    width:min(560px,100%);max-height:calc(100dvh - 40px);overflow:hidden;
    border-radius:16px;background:var(--panel);border:1px solid var(--border);
    box-shadow:0 20px 48px rgba(0,0,0,.35);display:flex;flex-direction:column
  }
  .k-rcpt-line-h{
    flex-shrink:0;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;
    padding:10px 12px;border-bottom:1px solid var(--border);background:var(--card)
  }
  .k-rcpt-line-title{display:flex;align-items:flex-start;gap:8px;min-width:0}
  .k-rcpt-line-title .emo{
    width:34px;height:34px;border-radius:8px;background:var(--card2);border:1px solid var(--border);
    display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0
  }
  .k-rcpt-line-title b{display:block;font-size:14px;font-weight:900;line-height:1.2}
  .k-rcpt-line-title span{display:block;font-size:10px;color:var(--muted);margin-top:2px;word-break:break-word}
  .k-rcpt-line-body{flex:1;min-height:0;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
  .k-rcpt-line-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .k-rcpt-line-grid .k-field{margin-bottom:0}
  .k-rcpt-line-grid .k-field label{font-size:10px;margin-bottom:3px}
  .k-rcpt-line-span2{grid-column:1 / -1}
  .k-rcpt-line-qty{display:flex;align-items:center;gap:4px}
  .k-rcpt-line-qty .k-inp{text-align:center;font-weight:800;padding:8px 6px;min-width:0}
  .k-rcpt-line-pct{display:flex;align-items:center;gap:6px}
  .k-rcpt-line-pct .k-inp{text-align:center;font-weight:800;padding:8px 6px;min-width:0}
  .k-rcpt-line-pct-suf{font-size:14px;font-weight:900;color:var(--muted);flex-shrink:0}
  .k-rcpt-line-hint{font-size:10px;color:var(--muted);margin-top:2px}
  .k-rcpt-line-sum{
    display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;
    font-size:12px;color:var(--muted);font-weight:700;padding:6px 0 2px
  }
  .k-rcpt-line-sum b{color:var(--text);font-weight:900}
  .k-rcpt-line-foot{flex-shrink:0;padding:10px 12px;border-top:1px solid var(--border);background:var(--card)}
  .k-rcpt-find-body{
    flex:1;min-height:0;overflow:hidden;padding:10px 0 0;display:flex;flex-direction:column;gap:0
  }
  .k-rcpt-find-body .k-prod-pick-panel{flex:1;min-height:0;display:flex;flex-direction:column;padding:0 12px}
  .k-rcpt-find-body .k-prod-pick-panel > div:first-child{padding:0 0 0;margin:0 0 0}
  .k-prod-pick-list{
    position:absolute;top:100%;left:0;right:0;z-index:20;
    background:var(--panel);border:1px solid var(--border);border-radius:10px;
    max-height:320px;overflow:auto;margin-top:4px;box-shadow:0 8px 24px rgba(0,0,0,.4)
  }
  .k-prod-pick-list-panel{
    position:relative!important;top:auto!important;left:auto!important;right:auto!important;
    flex:1 1 auto!important;min-height:0!important;max-height:none!important;height:100%;
    margin:10px -12px 0!important;border-radius:0;box-shadow:none!important;overflow:auto!important;
    border:none;border-top:1px solid var(--border);background:var(--card);padding-right:0
  }
  .k-prod-pick-tbl-wrap{overflow:auto;min-height:0;padding-right:0}
  .k-prod-pick-hint{padding:16px;text-align:center;color:var(--muted);font-size:13px;font-weight:600;border-bottom:1px solid var(--border)}
  .k-prod-pick-tbl{width:100%;margin:0}
  .k-prod-pick-tbl thead th{
    position:sticky;top:0;z-index:2;background:var(--card);font-size:10px;text-transform:uppercase;
    letter-spacing:.03em;color:var(--muted);font-weight:800;white-space:nowrap
  }
  .k-prod-pick-tbl th:first-child,
  .k-prod-pick-tbl td:first-child{padding-left:14px!important}
  .k-prod-pick-tbl th:last-child,
  .k-prod-pick-tbl td:last-child{padding-right:16px!important}
  .k-prod-pick-tbl th.num,
  .k-prod-pick-tbl td.num{padding-right:14px}
  .k-prod-pick-tbl tbody tr{cursor:pointer}
  .k-prod-pick-tbl tbody tr:nth-child(even){background:var(--card2)}
  .k-prod-pick-tbl tbody tr:hover{background:var(--hover)}
  /* Сканер камеры только на мобилке */
  .k-rcpt-find-modal .k-cam-scan-btn{display:none!important}
  .k-prod-pick-art{font-size:12px;color:var(--gold);font-weight:800}
  .k-prod-pick-name{display:flex;align-items:center;gap:8px;min-width:0}
  .k-prod-pick-name .emo{
    width:32px;height:32px;border-radius:8px;background:var(--card2);border:1px solid var(--border);
    display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0
  }
  .k-prod-pick-name b{display:block;font-size:13px;font-weight:800;line-height:1.2}
  .k-prod-pick-name span{display:block;font-size:10px;color:var(--muted);margin-top:2px}
  .k-prod-pick-create{
    display:flex;align-items:center;gap:8px;width:100%;border:none;border-top:1px solid var(--border);
    background:var(--green-d);color:var(--green);padding:12px;cursor:pointer;text-align:left;font-size:13px;font-weight:800;
    position:sticky;bottom:0
  }
  .k-rcpt-table{border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--card2)}
  .k-rcpt-th{
    display:grid;grid-template-columns:32px minmax(160px,1.8fr) 70px 78px 78px 86px 70px 88px 96px;
    gap:8px;padding:8px 10px;font-size:10px;font-weight:800;color:var(--muted);
    text-transform:uppercase;letter-spacing:.03em;border-bottom:1px solid var(--border);background:var(--card)
  }
  .k-rcpt-th > span:nth-child(n+3):nth-child(-n+8){text-align:center}
  .k-rcpt-tr{border-bottom:1px solid var(--tbl-line);background:var(--card)}
  .k-rcpt-tr:last-child{border-bottom:none}
  .k-rcpt-tr.is-open{background:rgba(31,215,96,.04)}
  .k-rcpt-tr-main{
    display:grid;grid-template-columns:32px minmax(160px,1.8fr) 70px 78px 78px 86px 70px 88px 96px;
    gap:8px;padding:8px 10px;align-items:center
  }
  .k-rcpt-td-metrics{display:contents}
  .k-rcpt-td.idx{font-size:12px;font-weight:900;color:var(--muted)}
  .k-rcpt-td.prod{
    display:flex;align-items:center;gap:8px;min-width:0;border:none;background:transparent;
    text-align:left;padding:0;color:inherit
  }
  .k-rcpt-td.prod .emo{
    width:34px;height:34px;border-radius:8px;background:var(--card2);border:1px solid var(--border);
    display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0
  }
  .k-rcpt-td.prod .txt{min-width:0}
  .k-rcpt-td.prod b{display:block;font-size:13px;font-weight:800;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .k-rcpt-td.prod small{display:block;font-size:10px;color:var(--muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .k-rcpt-td.qty,.k-rcpt-td.cost,.k-rcpt-td.retail,.k-rcpt-td.sum,.k-rcpt-td.markup,.k-rcpt-td.exp{
    font-size:12px;font-weight:800;font-variant-numeric:tabular-nums;text-align:center
  }
  .k-rcpt-td.sum{font-weight:900}
  .k-rcpt-td.markup b{font-weight:900}
  .k-rcpt-td.exp{font-size:11px;color:var(--muted);white-space:nowrap}
  .k-rcpt-stepper{
    width:28px;height:28px;border-radius:7px;border:1px solid var(--border);background:var(--card2);
    color:var(--text);font-weight:900;cursor:pointer;flex-shrink:0;line-height:1
  }
  .k-rcpt-td.acts{display:flex;gap:3px;justify-content:flex-end}
  .k-rcpt-td.acts .k-btn{padding:3px 6px;font-size:11px;min-height:0;min-width:32px}
  .k-rcpt-tr-more{padding:0 10px 12px 46px;border-top:1px dashed var(--border)}
  .k-rcpt-edit-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding-top:10px}
  .k-rcpt-edit-grid .k-field{margin-bottom:0}
  .k-rcpt-tr-more-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;flex-wrap:wrap;font-size:12px;color:var(--muted)}
  .k-rcpt-table-foot{padding:10px 12px;font-size:12px;color:var(--muted);border-top:1px solid var(--border);background:var(--card)}
  .k-rcpt-side{
    align-self:start;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:14px;
    display:flex;flex-direction:column;gap:10px;position:sticky;top:0
  }
  .k-rcpt-side-h{font-size:14px;font-weight:900}
  .k-rcpt-side-total{
    padding:12px;border-radius:12px;background:var(--card2);border:1px solid var(--border);
    display:flex;flex-direction:column;gap:4px
  }
  .k-rcpt-side-total span{font-size:11px;color:var(--muted);font-weight:700}
  .k-rcpt-side-total strong{font-size:22px;font-weight:900;line-height:1.1}
  .k-rcpt-side-debt{font-size:13px;font-weight:800;color:var(--green)}
  .k-rcpt-side-debt.due{color:var(--gold)}
  .k-rcpt-side-debt b{font-weight:900}
  .k-rcpt-side-extra{display:grid;gap:8px;padding-top:4px;border-top:1px solid var(--border)}
  .k-rcpt-side-extra > div{display:flex;justify-content:space-between;gap:8px;font-size:12px}
  .k-rcpt-side-extra span{color:var(--muted);font-weight:700}
  .k-rcpt-side-extra b{font-weight:900}
  .k-rcpt-warn{margin:0 18px;padding:8px 10px;border-radius:8px;font-size:11px;font-weight:700;color:var(--gold);background:rgba(255,184,0,.1);border:1px solid rgba(255,184,0,.25)}
  .k-rcpt-empty{padding:40px 16px;text-align:center;color:var(--muted);font-size:13px}
  .k-rcpt-msg{margin:0 18px 10px;padding:10px 14px;border-radius:10px;font-size:13px;background:#2a1420;color:var(--red);border:1px solid #5a2030}
  .k-rcpt-foot-stats{
    flex-shrink:0;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;
    padding:12px 18px 16px;border-top:1px solid var(--border);background:var(--card);
    max-width:100%
  }
  .k-rcpt-stat{
    border:1px solid var(--border);border-radius:12px;padding:10px 12px;background:var(--panel);
    display:flex;flex-direction:column;gap:2px
  }
  .k-rcpt-stat b{font-size:16px;font-weight:900;line-height:1.2}
  .k-rcpt-stat span{font-size:11px;color:var(--muted);font-weight:700}
  .k-rcpt-stat.c1{box-shadow:inset 3px 0 0 var(--green)}
  .k-rcpt-stat.c2{box-shadow:inset 3px 0 0 #3b82f6}
  .k-rcpt-stat.c3{box-shadow:inset 3px 0 0 var(--green)}
  .k-rcpt-stat.c5{box-shadow:inset 3px 0 0 #22c55e}
  .k-rcpt-stat.c4{box-shadow:inset 3px 0 0 var(--gold)}
  .k-wh-cta{
    display:none!important;flex-direction:row;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:10px;margin-bottom:12px
  }
  .k-wh-cta .k-btn-g{width:auto;min-height:42px;font-size:14px;font-weight:900}
  .k-wh-cta-spacer{display:none}
  .k-wh-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
  .k-wh-chip-row{display:flex;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding-bottom:2px;width:100%}
  .k-wh-chip-row::-webkit-scrollbar{display:none}
  .k-wh-chip-row .k-subtab{flex-shrink:0}
  .k-wh-cards{display:none;flex-direction:column;gap:10px}
  .k-wh-card{
    background:var(--card);border:1px solid var(--border);border-radius:14px;padding:12px 14px;
    display:flex;flex-direction:column;gap:10px
  }
  .k-wh-card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
  .k-wh-card-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .k-wh-card-meta>div{min-width:0}
  .k-wh-card-meta .l{font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.03em}
  .k-wh-card-meta .v{font-size:13px;font-weight:800;margin-top:2px;word-break:break-word}
  .k-wh-card-actions{display:grid;grid-template-columns:1fr 1fr auto;gap:8px}
  .k-wh-card-actions .k-btn{min-height:44px;width:100%}
  .k-wh-card-detail{border-top:1px solid var(--border);padding-top:10px;display:grid;gap:8px}
  .k-modal-h{padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
  .k-modal-h b{font-size:16px;font-weight:900}
  .k-modal-h button{border:none;background:transparent;color:var(--muted);font-size:20px;cursor:pointer}
  .k-modal-b{overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
  .k-subtabs{display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap}
  .k-subtab{border:1px solid var(--border);background:var(--card);color:var(--muted);border-radius:10px;padding:8px 14px;font-weight:800;font-size:13px;cursor:pointer}
  .k-subtab:hover{color:var(--text);border-color:var(--muted2)}
  .k-subtab.active{background:var(--green-d);border-color:var(--green);color:var(--green)}
  .k-seg-tabs{display:flex;flex-wrap:wrap;gap:6px;align-items:stretch}
  .k-seg-tabs .k-subtab{
    display:inline-flex;align-items:center;justify-content:center;gap:6px;
    padding:7px 12px;font-size:12px;min-height:36px
  }
  .k-seg-tabs .k-subtab .ic{font-size:15px;line-height:1}
  .k-seg-tabs .k-subtab .lbl{line-height:1.1}
  .k-seg-tabs .k-subtab .cnt{
    font-size:10px;font-weight:900;padding:1px 6px;border-radius:999px;
    background:var(--card2);color:var(--muted)
  }
  .k-seg-tabs .k-subtab.active .cnt{background:rgba(5,33,13,.16);color:inherit}
  .k-top-subtabs.k-seg-tabs .k-subtab{padding:7px 12px}
  .k-catalog-bar{display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:nowrap}
  .k-catalog-meta{display:flex;align-items:baseline;gap:6px;flex-shrink:0;font-size:13px;color:var(--muted)}
  .k-catalog-meta b{font-size:17px;font-weight:900;color:var(--text);line-height:1}
  .k-catalog-filters{flex:1;display:flex;gap:6px;min-width:0;margin:0;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
  .k-catalog-filters::-webkit-scrollbar{display:none}
  .k-filter-chip{
    flex:1 1 0;display:inline-flex;align-items:center;justify-content:center;gap:6px;
    border:1px solid var(--border);background:var(--card);color:var(--text);
    border-radius:999px;padding:6px 8px;cursor:pointer;font:inherit;line-height:1.1;min-width:0
  }
  .k-filter-chip:hover{border-color:var(--muted2);background:var(--hover)}
  .k-filter-chip.active{background:var(--green-d);border-color:var(--green)}
  .k-filter-chip-l{font-size:11px;font-weight:700;color:var(--muted);white-space:nowrap}
  .k-filter-chip.active .k-filter-chip-l{color:var(--green)}
  .k-filter-chip-v{font-size:13px;font-weight:900;font-variant-numeric:tabular-nums}
  .k-catalog-add{flex-shrink:0;padding:7px 12px;font-size:13px}
  .k-catalog-bulk{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px;font-weight:800}
  .k-catalog-shell{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
  .k-catalog-head{flex-shrink:0;display:flex;flex-direction:column;gap:6px;margin-bottom:8px}
  .k-catalog-body{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch}
  .k-cats-compact{
    display:flex;gap:6px;margin:0;padding:2px 0 4px;overflow-x:auto;overflow-y:visible;
    -webkit-overflow-scrolling:touch;scrollbar-width:none;flex-shrink:0;min-height:36px;align-items:center
  }
  .k-cats-compact::-webkit-scrollbar{display:none}
  .k-cats-compact .k-cat{
    flex-direction:row;align-items:center;justify-content:center;flex-shrink:0;
    min-width:max-content;height:auto;padding:6px 10px;border-radius:10px;gap:5px;font-size:12px
  }
  .k-cats-compact .k-cat .ce{font-size:14px;line-height:1}
  .k-cats-compact .k-cat .cc{font-size:10px;opacity:.75;font-weight:700}
  .k-tbl-compact th{padding:7px 8px;font-size:10px}
  .k-tbl-compact td{padding:6px 8px;font-size:12px}
  .k-cats-panel{display:flex;flex-direction:column;flex:1;min-height:0;gap:0}
  .k-cats-panel-tbl{flex:1;min-height:0;overflow:auto;border:1px solid var(--border);border-radius:12px;background:var(--card)}
  .k-cat-order{display:inline-flex;align-items:center;gap:4px}
  .k-cat-order-inp{
    width:42px;padding:4px 4px;text-align:center;font-size:12px;font-weight:800;
    background:var(--card2);border:1px solid var(--border);border-radius:8px;color:var(--text);outline:none
  }
  .k-cat-order-inp:focus{border-color:var(--green)}
  .k-cat-order-btns{display:flex;gap:2px}
  .k-cat-order-btns .k-btn{width:26px;height:26px;min-height:0;padding:0;font-size:11px;line-height:1}
  .k-debts-layout{display:grid;grid-template-columns:minmax(240px,320px) 1fr;gap:10px;align-items:stretch;flex:1;min-height:0;overflow:hidden}
  .k-debts-list,.k-debts-detail{background:var(--card);border:1px solid var(--border);border-radius:12px;display:flex;flex-direction:column;min-height:0;height:100%;max-height:100%;overflow:hidden}
  .k-debts-detail .client-debt-panel{flex:1;min-height:0}
  .k-debts-list-b,.k-debts-detail-b{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;padding:6px 8px;overscroll-behavior:contain}
  .k-debts-row{display:flex;gap:8px;align-items:center;padding:8px 10px;border-radius:10px;border:1px solid transparent;cursor:pointer;margin-bottom:4px;background:var(--card2)}
  .k-debts-row:hover{border-color:var(--border)}
  .k-debts-row.active{border-color:var(--green);background:var(--green-d)}
  .k-debts-av{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;flex-shrink:0;background:rgba(31,215,96,.15);color:var(--green)}
  .k-debts-actions{display:flex;gap:8px;flex-wrap:wrap;padding:8px 10px;border-top:1px solid var(--border);background:var(--panel)}
  .k-debts-actions .k-btn{flex:1;min-width:100px;justify-content:center;min-height:36px;padding:8px 12px;font-size:12px}
  .k-debts-table{width:100%;border-collapse:collapse;font-size:12px}
  .k-debts-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .k-debts-table th{text-align:left;font-size:10px;color:var(--muted);font-weight:800;padding:4px 5px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--card);z-index:1}
  .k-debts-table td{padding:5px;border-bottom:1px solid var(--border);vertical-align:middle}
  .k-debts-foot{padding:8px 10px;border-top:1px solid var(--border);font-size:12px;font-weight:800;display:flex;justify-content:space-between;gap:8px}
  .k-debts-head{padding:8px 10px;border-bottom:1px solid var(--border);flex-shrink:0}
  .k-debts-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}
  .k-debts-metric{padding:6px 8px;border-radius:8px;background:var(--card2);border:1px solid var(--border)}
  .k-debts-metric .kl{font-size:10px;color:var(--muted);font-weight:700;line-height:1.2}
  .k-debts-metric .kv{font-size:14px;font-weight:900;margin-top:2px;line-height:1.2}
  .k-product-layout{
    flex:1;min-height:0;height:100%;
    display:grid;grid-template-columns:minmax(300px,38%) minmax(0,1fr);gap:10px;align-items:stretch
  }
  .k-product-list{
    background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden;
    display:flex;flex-direction:column;min-height:0;height:100%;min-width:0
  }
  .k-product-list-head{padding:10px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;flex-shrink:0}
  .k-product-list-body{flex:1;min-height:0;overflow:auto;padding:6px;-webkit-overflow-scrolling:touch}
  .k-product-pick{display:flex;align-items:center;gap:10px;width:100%;border:1px solid transparent;background:transparent;color:var(--text);border-radius:10px;padding:8px 10px;cursor:pointer;text-align:left;margin-bottom:2px}
  .k-product-pick:hover{background:var(--hover);border-color:var(--border)}
  .k-product-pick.active{background:var(--green-d);border-color:var(--green)}
  .k-product-pick .pe{font-size:18px;width:24px;text-align:center}
  .k-product-pick .pi{flex:1;min-width:0}
  .k-product-pick .pi b{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .k-product-pick .pi span{font-size:11px;color:var(--muted)}
  .k-product-form{min-height:0;height:100%;display:flex;flex-direction:column;overflow:hidden}
  .k-product-form > .k-card-h{flex-shrink:0}
  .k-product-form > .k-card-b{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch}
  .k-tbl-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .k-tbl-scroll .k-tbl{min-width:640px}
  .k-line-row{display:grid;gap:8px;align-items:end;margin-bottom:8px}
  .k-line-row--3{grid-template-columns:1fr 100px auto}
  .k-line-row--5{grid-template-columns:1fr 80px 80px 60px auto}
  .k-label-layout{
    flex:1;min-height:0;height:100%;
    display:grid;grid-template-columns:minmax(280px,36%) minmax(0,1fr);gap:10px;align-items:stretch
  }
  .k-labels-shell{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
  .k-label-panel{display:flex;flex-direction:column;min-height:0;height:100%;overflow:hidden}
  .k-label-panel > .k-card-h{flex-shrink:0;padding:10px 12px}
  .k-label-panel > .k-card-b{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;padding:10px}
  .k-label-list{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch}
  .k-label-preview-scroll{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch}
  .k-receipt-summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--muted)}
  .k-receipt-summary > div{display:flex;align-items:baseline;gap:5px;min-width:0}
  .k-receipt-summary > div > div:first-child{font-size:11px;color:var(--muted);font-weight:700}
  .k-receipt-summary > div > div:last-child{font-size:14px;font-weight:900;color:var(--text)}
  .k-mob-menu-btn{display:none}
  .k-side-overlay{display:none}
  .k-bottom-nav{display:none}
  .k-top-net{display:none}
  /* Не задаём display на desktop — иначе ломает grid/flex (KPI, actions) */
  .k-hide-desk{display:none!important}
  .k-products-subs{display:none}

  .k-cli-kpis{
    display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px
  }
  .k-cli-kpis .k-kpi{padding:12px 14px;border-radius:12px}
  .k-cli-kpis .k-kpi .kl{font-size:11px}
  .k-cli-kpis .k-kpi .kv{font-size:20px;margin-top:4px}
  .k-cli-row{
    align-items:center
  }
  .k-cli-main{flex-wrap:nowrap}
  .k-cli-actions .k-btn{
    min-width:34px;min-height:34px;display:inline-flex;align-items:center;justify-content:center
  }

  @media (max-width:900px){
    .k-grid2{grid-template-columns:1fr}
    .k-product-edit-hero{grid-template-columns:96px 1fr;gap:10px}
    .k-product-layout{grid-template-columns:1fr;height:auto;flex:none}
    .k-product-list{height:auto;max-height:42vh}
    .k-product-list-body{flex:1;max-height:none}
    .k-product-form{height:auto;overflow:visible}
    .k-product-form > .k-card-b{overflow:visible;flex:none}
    .k-label-layout{grid-template-columns:1fr;height:auto;flex:none}
    .k-labels-shell{flex:none;overflow:visible;height:auto}
    .k-label-panel{height:auto;max-height:none}
    .k-label-panel > .k-card-b{overflow:visible;flex:none}
    .k-label-list{max-height:42vh;flex:none}
    .k-label-preview-scroll{max-height:50vh;flex:none}
    .k-line-row--3,.k-line-row--5{grid-template-columns:1fr 1fr}
    .k-line-row--3>:last-child,.k-line-row--5>:last-child{grid-column:1/-1;justify-self:start}
    .k-hide-mob{display:none!important}
    .k-hide-desk{display:revert!important}
    /* Экран зафиксирован: шапка не уезжает, крутится только .k-body */
    .k-trade{
      flex-direction:column;height:100vh;height:100dvh;overflow:hidden
    }
    .k-trade.pos-fs{padding-bottom:0}
    .k-trade.pos-fs .k-pos-fs-host{height:100%;min-height:0;overflow:hidden}
    .k-side{
      display:flex!important;
      position:fixed;left:0;top:0;z-index:200;width:min(280px,88vw);height:100vh;height:100dvh;
      transform:translateX(-105%);transition:transform .25s ease;box-shadow:none
    }
    .k-side.open{transform:translateX(0);box-shadow:8px 0 32px rgba(0,0,0,.55)}
    .k-side-overlay{
      display:block!important;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:199;
      opacity:0;pointer-events:none;transition:opacity .25s
    }
    .k-side-overlay.open{opacity:1;pointer-events:auto}
    .k-mob-menu-btn{
      display:flex!important;align-items:center;justify-content:center;width:42px;height:42px;
      border-radius:12px;border:1px solid var(--border);background:var(--card);color:var(--text);
      cursor:pointer;font-size:20px;flex-shrink:0
    }
    .k-main{
      width:100%;height:100%!important;min-height:0!important;overflow:hidden;
      padding-bottom:calc(56px + env(safe-area-inset-bottom,0px));
      display:flex;flex-direction:column
    }
    /* Прозрачный fixed-оверлей: круглая карточка отдельно — скролл виден вокруг неё */
    .k-top{
      position:fixed;left:0;right:0;top:0;z-index:40;
      flex:0 0 auto;flex-shrink:0;
      display:block;width:100%;
      margin:0;
      padding:calc(6px + env(safe-area-inset-top,0px)) 10px 6px;
      min-height:0;box-sizing:border-box;
      border:none!important;border-radius:0;background:transparent!important;
      box-shadow:none!important;gap:0;
      pointer-events:none;
    }
    .k-top-shell{
      display:flex;align-items:center;gap:8px;flex-wrap:nowrap;
      pointer-events:auto;
      padding:8px 10px;min-height:50px;box-sizing:border-box;
      border:1px solid var(--border);border-radius:12px;background:var(--card);
      box-shadow:0 2px 10px rgba(12,26,16,.08);
    }
    .k-trade[data-theme="dark"] .k-top-shell{box-shadow:0 2px 10px rgba(0,0,0,.35)}
    .k-mob-menu-btn{
      width:32px;height:32px;font-size:16px;border-radius:10px;align-self:center;flex-shrink:0;
      background:var(--card);border:1px solid var(--border);box-shadow:none
    }
    .k-top-title{
      flex:0 1 auto;min-width:0;max-width:none;
      align-self:center;justify-content:center;gap:0;
      padding:0;margin:0;flex-direction:row;flex-wrap:nowrap;align-items:center
    }
    .k-top-title-main{font-size:14px;font-weight:900;letter-spacing:-.01em;line-height:1.15;white-space:nowrap}
    .k-top-title-sub{display:none}
    .k-top-title-net{display:flex!important;align-items:center;flex:0 0 auto;align-self:center}
    .k-top-title-net .k-online-chip{
      display:inline-flex!important;
      border-radius:999px;padding:3px 8px;min-height:22px;font-size:10px;gap:4px;
      border:1px solid var(--border);background:var(--card)
    }
    .k-top-title-net .k-online-chip .d{width:6px;height:6px}
    .k-top-title-net .k-online-chip .n{min-width:14px;height:14px;font-size:9px}
    .k-top:has(.k-top-title-net) .k-top-end .k-top-net{display:none!important}
    .k-top-end{gap:6px;margin-left:auto;align-items:center;flex-shrink:0}
    .k-top-end .k-online-chip{
      display:inline-flex!important;border-radius:999px;padding:3px 8px;min-height:22px;font-size:10px
    }
    .k-top-subtabs{order:1;flex:1 1 auto;min-width:0;overflow-x:auto;scrollbar-width:none}
    .k-top-subtabs::-webkit-scrollbar{display:none}
    .k-top-subtabs.k-seg-tabs{
      order:3;flex:1 1 100%;width:100%;overflow:visible;min-width:0
    }
    .k-top-back{order:2;padding:8px 10px;font-size:12px;flex-shrink:0}
    /* Меню + Онлайн + поиск — одна строка */
    .k-top-search-wrap{order:0;flex:1 1 auto;min-width:0;justify-content:stretch;gap:6px}
    .k-top-search-wrap .k-search{max-width:none;flex:1 1 auto;min-width:0}
    .k-top-search-net{flex-shrink:0}
    .k-top-search-net .k-online-chip{
      display:inline-flex!important;border-radius:999px;padding:3px 8px;min-height:28px;font-size:10px;gap:4px;
      border:1px solid var(--border);background:var(--panel)
    }
    .k-top-search-net .k-online-chip .d{width:6px;height:6px}
    .k-top-search-net .k-online-chip .n{min-width:14px;height:14px;font-size:9px}
    .k-search{max-width:none;min-width:0;flex:1 1 auto}
    .k-body-products{overflow:visible;flex:none;height:auto}
    .k-body-products > .k-products-mod,
    .k-products-mod-body,
    .k-products-mod-body > .k-product-edit-shell{flex:none;min-height:0;overflow:visible;height:auto}
    .k-catalog-bar{flex-wrap:wrap;gap:4px;align-items:center}
    .k-catalog-meta{gap:4px}
    .k-catalog-meta b{font-size:14px}
    .k-catalog-meta span{font-size:11px}
    .k-catalog-filters{flex:1 1 100%;order:3;gap:4px}
    .k-filter-chip{flex:1 1 auto;min-width:calc(33.33% - 4px);padding:5px 6px;border-radius:10px}
    .k-filter-chip-l{font-size:10px}
    .k-filter-chip-v{font-size:12px}
    .k-catalog-add{margin-left:auto}
    .k-catalog-head{gap:5px;margin-bottom:6px}
    .k-cats-compact{min-height:30px;gap:4px;padding:0 0 2px}
    .k-cats-compact .k-cat{padding:5px 8px;font-size:11px;min-height:30px;border-radius:9px}
    /* Список товаров — компактные карточки без горизонтального скролла */
    .k-catalog-body .k-card{border:none;background:transparent;box-shadow:none}
    .k-catalog-body .k-card-b{padding:0!important}
    .k-catalog-body .k-tbl-scroll{overflow:visible}
    .k-catalog-body .k-tbl-scroll .k-tbl{min-width:0!important;width:100%}
    .k-catalog-body .k-tbl thead{display:none}
    .k-catalog-body .k-tbl tbody{display:flex;flex-direction:column;gap:6px}
    .k-catalog-body .k-tbl tr.k-prodrow{
      display:grid;
      grid-template-columns:22px minmax(0,1fr) auto;
      grid-template-areas:
        "chk prod price"
        "chk meta stock";
      gap:3px 8px;align-items:start;
      padding:8px;margin:0;border:1px solid var(--border);border-radius:12px;background:var(--card)
    }
    .k-catalog-body .k-tbl td{display:block;padding:0;border:none;min-width:0}
    .k-catalog-body .k-tbl td:nth-child(1){grid-area:chk;padding-top:6px}
    .k-catalog-body .k-tbl td:nth-child(2){display:none}
    .k-catalog-body .k-tbl td:nth-child(3){grid-area:prod}
    .k-catalog-body .k-tbl td:nth-child(3) .k-prodrow-main{gap:6px}
    .k-catalog-body .k-tbl td:nth-child(3) .k-prodrow-name{font-size:12px!important;font-weight:800;line-height:1.2}
    .k-catalog-body .k-tbl td:nth-child(3) .k-prodrow-sub{font-size:10px;color:var(--muted);line-height:1.25;margin-top:1px}
    .k-catalog-body .k-tbl td:nth-child(4){grid-area:meta}
    .k-catalog-body .k-tbl td:nth-child(4) .k-badge-cat{
      font-size:9px;padding:2px 6px;border-radius:999px;line-height:1.25;max-width:100%;
      white-space:normal;display:inline-block
    }
    .k-catalog-body .k-tbl td:nth-child(5){
      grid-area:price;justify-self:end;text-align:right;
      font-size:13px!important;font-weight:900;color:var(--green);line-height:1.2
    }
    .k-catalog-body .k-tbl td:nth-child(8){
      grid-area:stock;justify-self:end;text-align:right;font-size:11px;font-weight:800
    }
    .k-catalog-body .k-tbl td:nth-child(6),
    .k-catalog-body .k-tbl td:nth-child(7),
    .k-catalog-body .k-tbl td:nth-child(9),
    .k-catalog-body .k-tbl td:nth-child(10){display:none}
    .k-body-warehouse{overflow:visible;flex:none;height:auto}
    .k-body-warehouse > .k-wh-shell,
    .k-wh-shell > .k-wh-body,
    .k-wh-shell > .k-wh-body > .k-wh-stock,
    .k-wh-shell > .k-wh-body > .k-wh-receipts,
    .k-wh-shell > .k-wh-body > .k-wh-writeoffs,
    .k-wh-shell > .k-wh-body > .k-wh-revisions,
    .k-wh-shell > .k-wh-body > .k-wh-expiry{flex:none;min-height:0;overflow:visible;height:auto}
    .k-wh-stock-body,
    .k-wh-receipts-body,
    .k-wh-panel-body{overflow:visible;border:none;border-radius:0;background:transparent}
    .k-wh-receipts .k-wh-cta-spacer,
    .k-wh-writeoffs .k-wh-cta-spacer{display:none}

    /* Контент крутится под закреплённой круглой шапкой (паддинг = высота оверлея) */
    .k-body{
      --k-top-overlay:calc(6px + env(safe-area-inset-top,0px) + 70px + 8px);
      padding:var(--k-top-overlay,84px) 10px 10px;overflow:auto!important;flex:1 1 auto!important;
      min-height:0!important;height:auto;-webkit-overflow-scrolling:touch
    }
    .k-body.k-body-products{padding:var(--k-top-overlay,84px) 10px 8px}
    .k-body.k-body-warehouse{padding:var(--k-top-overlay,84px) 10px 6px}
    /* Дашборд точки продаж — скролл в .k-body под круглой шапкой (как долги/поставщики) */
    .k-trade:not(.pos-fs) .k-body-pos{
      --k-top-overlay:calc(6px + env(safe-area-inset-top,0px) + 70px + 8px);
      overflow:auto!important;flex:1 1 auto!important;min-height:0!important;
      height:auto!important;max-height:none!important;
      padding:var(--k-top-overlay,84px) 10px calc(56px + env(safe-area-inset-bottom,0px))!important;
      display:block;-webkit-overflow-scrolling:touch
    }
    .k-trade:not(.pos-fs) .k-body-pos > .pos-host{
      flex:none!important;height:auto!important;min-height:0!important;max-height:none!important;
      display:block!important;overflow:visible!important
    }
    .k-trade:not(.pos-fs) .k-body-pos .pos-root[data-embed="1"]{
      height:auto!important;min-height:0!important;flex:none!important;overflow:visible!important;
      background:transparent!important
    }
    .k-trade.pos-fs .k-body-pos{
      overflow:hidden!important;padding:0!important;
      height:100dvh!important;max-height:100dvh!important
    }
    .k-body.k-body-debts{
      --k-top-overlay:calc(6px + env(safe-area-inset-top,0px) + 70px + 8px);
      overflow:auto!important;flex:1 1 auto!important;min-height:0!important;
      height:auto!important;max-height:none!important;
      padding:var(--k-top-overlay,84px) 10px 8px!important;
      display:block;-webkit-overflow-scrolling:touch
    }
    .k-body-debts > .k-debts-page{
      flex:none!important;height:auto!important;min-height:0!important;max-height:none!important;
      overflow:visible!important;display:block
    }
    .k-body.k-body-suppliers{
      --k-top-overlay:calc(6px + env(safe-area-inset-top,0px) + 70px + 8px);
      overflow:auto!important;flex:1 1 auto!important;min-height:0!important;
      height:auto!important;max-height:none!important;
      padding:var(--k-top-overlay,84px) 10px 8px!important;
      display:block;-webkit-overflow-scrolling:touch
    }
    .k-body-suppliers > .k-suppliers-mod{
      flex:none!important;height:auto!important;min-height:0!important;max-height:none!important;
      overflow:visible!important
    }
    .k-body.k-body-clients{
      --k-top-overlay:calc(6px + env(safe-area-inset-top,0px) + 70px + 8px);
      overflow:auto!important;flex:1 1 auto!important;min-height:0!important;
      height:auto!important;max-height:none!important;
      padding:var(--k-top-overlay,84px) 10px 8px!important;
      display:block;-webkit-overflow-scrolling:touch
    }
    .k-body-clients > .k-clients-mod{
      flex:none!important;height:auto!important;min-height:0!important;max-height:none!important;
      overflow:visible!important
    }
    .k-body.k-body-finance,
    .k-body.k-body-reports{
      --k-top-overlay:calc(6px + env(safe-area-inset-top,0px) + 70px + 8px);
      overflow:auto!important;flex:1 1 auto!important;min-height:0!important;
      height:auto!important;max-height:none!important;
      padding:var(--k-top-overlay,84px) 10px 8px!important;
      display:block;-webkit-overflow-scrolling:touch
    }
    .k-body-finance > .k-finance-mod,
    .k-body-reports > .k-reports-mod{
      flex:none!important;height:auto!important;min-height:0!important;max-height:none!important;
      overflow:visible!important
    }
    .k-page-h h1{font-size:18px}
    .k-page-h .sub{font-size:12px}
    .k-kpis{grid-template-columns:repeat(2,1fr);gap:8px}
    .k-kpi{padding:12px}
    .k-kpi .kv{font-size:20px}
    .k-card-h{flex-wrap:wrap;padding:12px}
    .k-card-b{padding:12px}
    .k-subtabs{flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch;scrollbar-width:none;gap:6px}
    .k-subtabs::-webkit-scrollbar{display:none}
    .k-subtab{flex-shrink:0;padding:8px 12px;font-size:12px;min-height:40px}
    .k-top-subtabs .k-subtab{padding:7px 10px;font-size:12px;min-height:0}
    .k-seg-tabs{
      display:grid!important;grid-template-columns:repeat(auto-fit,minmax(0,1fr));
      gap:2px;padding:2px;margin:0;overflow:visible;flex-wrap:nowrap;
      background:var(--card2);border:1px solid var(--border);border-radius:10px
    }
    .k-seg-tabs .k-subtab{
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      gap:1px;width:100%;min-width:0;min-height:40px!important;padding:4px 1px!important;
      border:none;border-radius:8px;font-size:9px;font-weight:800;line-height:1.05;
      background:transparent
    }
    .k-seg-tabs .k-subtab .ic{font-size:14px;line-height:1}
    .k-seg-tabs .k-subtab .lbl{
      display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center
    }
    .k-seg-tabs .k-subtab .cnt{
      font-size:8px;padding:0 4px;line-height:1.3;background:var(--panel);margin-top:0
    }
    .k-seg-tabs .k-subtab.active{
      background:var(--green-d);color:var(--green);
      box-shadow:inset 0 0 0 1px rgba(31,215,96,.3)
    }
    .k-seg-tabs .k-subtab:active{transform:scale(.97)}
    /* Шапка: вкладки товаров НЕ в topbar — только отдельный блок ниже */
    .k-top-shell > .k-top-subtabs,
    .k-top-subtabs.k-seg-tabs.k-hide-mob{
      display:none!important;width:0!important;height:0!important;overflow:hidden!important;
      margin:0!important;padding:0!important;border:none!important;flex:0!important;order:unset!important
    }
    .k-products-mod > .k-products-subs.k-seg-tabs{
      display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));
      gap:4px;padding:4px;margin:0 0 8px;overflow:visible;flex-wrap:nowrap;width:100%;
      background:var(--card);border:1px solid var(--border);border-radius:12px
    }
    .k-products-mod > .k-products-subs .k-subtab{
      display:flex!important;flex-direction:row!important;align-items:center;justify-content:center;
      gap:5px;width:100%;min-width:0;min-height:38px!important;padding:6px 6px!important;
      border:none;border-radius:9px;font-size:12px!important;font-weight:800;line-height:1.1;
      background:transparent;color:var(--muted)
    }
    .k-products-mod > .k-products-subs .k-subtab .ic{font-size:15px;line-height:1;flex-shrink:0}
    .k-products-mod > .k-products-subs .k-subtab .lbl{
      display:block!important;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;
      font-size:12px!important
    }
    .k-products-mod > .k-products-subs .k-subtab.active{
      background:var(--green-d);color:var(--green);
      box-shadow:inset 0 0 0 1px rgba(31,215,96,.35)
    }
    .k-wh-head{gap:4px;margin-bottom:6px}
    .k-wh-head .k-seg-tabs{margin-top:2px}
    .k-wh-head .k-catalog-meta{gap:6px}
    .k-wh-head .k-catalog-meta b{font-size:14px}
    .k-wh-head .k-catalog-meta span{display:none}
    .k-wh-head .k-btn{min-height:32px!important;padding:5px 8px!important;font-size:11px}
    .k-debts-list{
      background:transparent;border:none;border-radius:0
    }
    .k-debts-list > div:first-child{
      padding:8px!important;margin:0 0 8px;border:1px solid var(--border)!important;
      border-radius:12px;background:var(--card);border-bottom:1px solid var(--border)!important;
      position:relative;z-index:0
    }
    .k-debts-list > div:first-child .k-subtabs{
      display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;
      overflow:visible;flex-wrap:nowrap;padding:4px;margin-bottom:8px;
      background:var(--card2);border:1px solid var(--border);border-radius:10px
    }
    .k-debts-list > div:first-child .k-subtabs .k-subtab{
      width:100%;justify-content:center;text-align:center;min-height:38px;padding:8px 4px;font-size:11px;
      border:none;border-radius:8px
    }
    /* Весь раздел долгов крутится в .k-body — фиксирована только верхняя круглая шапка */
    .k-debts-layout{
      display:block;grid-template-columns:unset;min-height:0;height:auto;max-height:none;
      flex:none;gap:0;overflow:visible
    }
    .k-debts-layout.detail-open .k-debts-list{display:none}
    .k-debts-layout:not(.detail-open) .k-debts-detail{display:none}
    .k-debts-list,.k-debts-detail{
      display:block;min-height:0;height:auto!important;max-height:none!important;
      overflow:visible!important
    }
    .k-debts-list-b,.k-debts-detail-b{
      overflow:visible!important;flex:none!important;height:auto!important;max-height:none!important;
      padding:0;min-height:0
    }
    .k-debts-foot{position:static;flex:none}
    .k-debts-head,.k-debts-actions{flex:none}
    .k-debts-metrics{grid-template-columns:1fr 1fr;gap:8px}
    .k-debts-metric:last-child{grid-column:1/-1}
    .k-debts-metric{padding:8px 10px}
    .k-debts-metric .kv{font-size:16px}
    .k-debts-detail .k-subtabs{
      display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;
      overflow:visible;flex-wrap:nowrap
    }
    .k-debts-detail .k-subtabs .k-subtab{
      width:100%;justify-content:center;text-align:center;min-height:40px;padding:8px 6px;font-size:11px
    }
    .k-debts-table-wrap{overflow:visible}
    .k-debts-table{width:100%;display:block}
    .k-debts-table thead{display:none}
    .k-debts-table tbody{display:flex;flex-direction:column;gap:8px}
    .k-debts-table tr{
      display:grid;grid-template-columns:1fr auto;gap:4px 10px;align-items:start;
      padding:10px;margin:0;border:1px solid var(--border);border-radius:10px;background:var(--card2)
    }
    .k-debts-table td{display:block;padding:0;border:none;min-width:0}
    .k-debts-table td:nth-child(1){grid-column:1;font-size:11px}
    .k-debts-table td:nth-child(2){grid-column:2;justify-self:end}
    .k-debts-table td:nth-child(3){grid-column:1/-1;font-size:13px;font-weight:700;white-space:normal}
    .k-debts-table td:nth-child(4){grid-column:1;font-size:14px;font-weight:900}
    .k-debts-table td:nth-child(5){grid-column:2;justify-self:end;font-size:13px}
    .k-debts-table td:nth-child(5)::before{content:'ост. ';font-weight:700;color:var(--muted);font-size:10px}
    .k-btn{min-height:44px;padding:10px 14px}
    .k-inp,.k-sel,.k-ta{font-size:16px;min-height:44px}
    .k-modal-bg{padding:0;align-items:stretch;justify-content:stretch}
    .k-modal,.k-modal-wide,.k-receipt-modal{
      width:100%!important;max-width:100%!important;
      height:100vh!important;max-height:100vh!important;
      height:100dvh!important;max-height:100dvh!important;
      border-radius:0;margin:0
    }
    .k-prod-pick-list-panel{margin:10px -10px 0!important}
    .k-prod-pick-tbl{font-size:12px}
    .k-prod-pick-tbl th:nth-child(3),
    .k-prod-pick-tbl td:nth-child(3){display:none}
    .k-receipt-modal-bg{
      padding:0!important;align-items:stretch!important;justify-content:stretch!important;
      background:var(--bg)!important
    }
    .k-receipt-modal{
      border-radius:0!important;width:100%!important;max-width:100%!important;
      height:100vh!important;max-height:100vh!important;
      height:100dvh!important;max-height:100dvh!important;
      margin:0!important;border:none;box-shadow:none
    }
    .k-receipt-scroll{
      flex:1 1 auto!important;min-height:0!important;overflow-y:auto!important;overflow-x:hidden
    }
    .k-modal-b{-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
    .k-product-list{position:static;height:auto;max-height:42vh}
    .k-product-list-body{flex:1;min-height:0;max-height:none;overflow:auto}
    .k-tbl{font-size:12px}
    .k-tbl th,.k-tbl td{padding:8px 6px}
    .k-rcpt-head{flex-direction:column;align-items:stretch;padding:8px 10px;gap:6px}
    .k-rcpt-head-ic{width:28px;height:28px;border-radius:8px;font-size:13px}
    .k-rcpt-head-title b{font-size:14px}
    .k-rcpt-head-title .sub{font-size:10px;margin-top:1px}
    .k-rcpt-head-actions{width:100%;display:grid;grid-template-columns:1fr 1fr;gap:6px}
    .k-rcpt-head-actions .k-btn{
      min-height:36px!important;width:100%;padding:6px 10px!important;font-size:13px
    }
    .k-rcpt-head-actions .k-btn-g{
      grid-column:auto;order:2;font-size:13px;min-height:36px!important
    }
    .k-rcpt-meta{padding:8px 10px}
    .k-rcpt-layout{grid-template-columns:1fr;padding:8px;gap:8px}
    .k-rcpt-main{order:1;padding:8px;border-radius:10px;gap:6px}
    .k-rcpt-main-h{gap:6px}
    .k-rcpt-main-h b{font-size:13px}
    .k-rcpt-side{position:static;order:2;padding:8px;border-radius:10px;gap:6px}
    .k-rcpt-side-h{font-size:12px}
    .k-rcpt-side-total{padding:8px;border-radius:8px;gap:2px}
    .k-rcpt-side-total span{font-size:10px}
    .k-rcpt-side-total strong{font-size:16px}
    .k-rcpt-side-debt{font-size:12px}
    .k-rcpt-side-extra{gap:4px}
    .k-rcpt-side-extra > div{font-size:11px}
    .k-rcpt-th{display:none}
    .k-rcpt-table{border:none;background:transparent;overflow:visible;display:flex;flex-direction:column;gap:8px}
    .k-rcpt-tr{
      border:1.5px solid color-mix(in srgb, var(--green) 28%, var(--border));
      border-radius:12px;
      background:var(--green-d);
      overflow:hidden;
      box-shadow:0 1px 2px rgba(0,0,0,.05)
    }
    .k-rcpt-tr:nth-child(even){
      background:color-mix(in srgb, var(--blue) 11%, var(--card));
      border-color:color-mix(in srgb, var(--blue) 24%, var(--border))
    }
    .k-rcpt-tr-main{
      display:grid;
      grid-template-columns:22px minmax(0,1fr) auto;
      grid-template-areas:
        "idx prod acts"
        "metrics metrics metrics";
      gap:5px;padding:8px
    }
    .k-rcpt-tr-main:hover{background:transparent}
    .k-rcpt-td.idx{grid-area:idx;align-self:start;padding-top:4px;font-size:11px;color:var(--green);font-weight:900}
    .k-rcpt-td.prod{grid-area:prod}
    .k-rcpt-td.prod .emo{width:28px;height:28px;font-size:14px;border-radius:7px;background:var(--card)}
    .k-rcpt-td.prod b{font-size:12px;white-space:normal;line-height:1.25}
    .k-rcpt-td.prod small{font-size:9px;white-space:normal;word-break:break-word;margin-top:0}
    .k-rcpt-td.acts{grid-area:acts;align-self:start;gap:2px}
    .k-rcpt-td.acts .k-btn{
      min-width:28px!important;min-height:28px!important;padding:0!important;font-size:12px;border-radius:7px;background:var(--card)
    }
    .k-rcpt-td-metrics{
      grid-area:metrics;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px
    }
    .k-rcpt-td.qty,
    .k-rcpt-td.cost,
    .k-rcpt-td.retail,
    .k-rcpt-td.sum,
    .k-rcpt-td.markup,
    .k-rcpt-td.exp{
      display:flex;flex-direction:column;gap:1px;
      padding:5px 6px;border-radius:7px;background:var(--card);border:1px solid var(--border);
      font-size:11px;font-weight:900;text-align:left;min-width:0
    }
    .k-rcpt-td.sum{grid-column:auto;text-align:left}
    .k-rcpt-td.qty::before,
    .k-rcpt-td.cost::before,
    .k-rcpt-td.retail::before,
    .k-rcpt-td.sum::before,
    .k-rcpt-td.markup::before,
    .k-rcpt-td.exp::before{
      content:attr(data-label);font-size:8px;font-weight:700;color:var(--muted)
    }
    .k-rcpt-tr-more{padding-left:10px}
    .k-rcpt-edit-grid{grid-template-columns:1fr 1fr}
    .k-rcpt-empty{padding:20px 10px;font-size:12px}
    .k-rcpt-table-foot{padding:6px 8px;font-size:11px;border-radius:8px;margin-top:0}
    .k-rcpt-foot-stats{
      grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;
      padding:6px 8px calc(8px + env(safe-area-inset-bottom,0px))
    }
    .k-rcpt-stat{padding:6px 7px;border-radius:8px;gap:0}
    .k-rcpt-stat b{font-size:12px}
    .k-rcpt-stat span{font-size:9px;line-height:1.2}
    .k-rcpt-warn,.k-rcpt-msg{margin-left:8px;margin-right:8px;padding:6px 8px;font-size:11px}
    .k-rcpt-main-actions{width:100%;margin-left:0;gap:5px}
    .k-rcpt-main-actions .k-btn{
      flex:1;min-height:34px!important;padding:6px 8px!important;font-size:12px
    }
    .k-rcpt-line-bg{padding:8px;padding-bottom:calc(8px + env(safe-area-inset-bottom,0px));align-items:stretch}
    .k-rcpt-line-modal{width:100%;max-height:none;height:100%;border-radius:14px}
    .k-rcpt-line-grid{grid-template-columns:1fr 1fr;gap:6px}
    .k-rcpt-line-body{padding:8px 10px;gap:6px}
    .k-rcpt-line-h{padding:8px 10px}
    .k-rcpt-line-title .emo{width:28px;height:28px;font-size:14px}
    .k-rcpt-line-title b{font-size:13px}
    .k-rcpt-line-sum{font-size:12px;padding:4px 0}
    .k-rcpt-line-foot{padding:8px 10px}
    .k-rcpt-line-foot .k-btn{min-height:40px!important;font-size:14px}
    .k-rcpt-find-bg{padding:8px;padding-bottom:calc(8px + env(safe-area-inset-bottom,0px))}
    .k-rcpt-find-modal{
      width:100%!important;max-width:none!important;height:100%!important;max-height:none!important;
      border-radius:14px
    }
    .k-rcpt-find-body{padding:10px 0 0}
    .k-rcpt-find-body .k-prod-pick-panel{padding:0 10px}
    .k-rcpt-find-modal .k-cam-scan-btn{display:flex!important}
    .k-cam-scan-btn{display:inline-flex!important;align-items:center;justify-content:center}
    .k-top-scan-btn{
      display:inline-flex!important;width:30px!important;height:30px!important;
      min-height:0!important;min-width:0!important;padding:0!important;
      border:none!important;border-radius:9px!important;font-size:15px!important;
      background:var(--card2)!important;box-shadow:none!important
    }
    .k-search.has-scan input{padding-right:42px}
    .k-search.has-scan:has(.k-search-clear) input{padding-right:74px}
    .k-search.has-scan .k-top-scan-btn{right:6px}
    .k-search.has-scan:has(.k-search-clear) .k-top-scan-btn{right:38px}
    .k-search.has-scan .k-search-clear{right:6px}
    .k-arrivals-body{padding:10px}
    .k-arrivals-head{padding:10px 12px!important;gap:8px}
    .k-arrivals-head-txt b{font-size:14px;line-height:1.25}
    .k-arrivals-head-sub{font-size:11px;line-height:1.3}
    .k-arrivals-toolbar{flex-direction:column;align-items:stretch;gap:8px;margin-bottom:10px}
    .k-arrivals-stock{font-size:12px}
    .k-arrivals-stock b{font-size:15px}
    .k-arrivals-toolbar-acts{display:grid;grid-template-columns:1fr 1fr;gap:6px;width:100%}
    .k-arrivals-toolbar-acts .k-btn{width:100%;min-height:40px!important}
    .k-arrivals-add{padding:10px;margin-bottom:10px;border-radius:10px}
    .k-arrivals-tbl-wrap{
      border:none;background:transparent;overflow:visible;border-radius:0;
      padding-bottom:calc(88px + env(safe-area-inset-bottom,0px))
    }
    .k-arrivals-tbl,.k-arrivals-tbl tbody{display:block;width:100%}
    .k-arrivals-tbl thead{display:none}
    .k-arrivals-tbl tbody tr:not(.k-arrivals-edit-tr){
      display:grid;
      grid-template-columns:28px 1fr 1fr auto;
      grid-template-areas:
        "idx status status acts"
        "sup  sup    date   acts"
        "qty  rem    cost   cost"
        "ret  bulk   exp    exp";
      gap:6px 8px;align-items:start;
      margin:0 0 8px;padding:10px;
      border:1px solid var(--border);border-radius:12px;background:var(--card)
    }
    .k-arrivals-tbl tbody tr:not(.k-arrivals-edit-tr):hover{background:var(--card)}
    .k-arrivals-tbl tbody tr.is-editing{border-color:rgba(31,215,96,.35);box-shadow:inset 0 0 0 1px rgba(31,215,96,.15)}
    .k-arrivals-tbl td{
      border:none!important;padding:0!important;font-size:12px;text-align:left!important
    }
    .k-arrivals-tbl td.a-idx{grid-area:idx;font-size:11px;color:var(--muted);font-weight:900;padding-top:3px!important}
    .k-arrivals-tbl td.a-status{grid-area:status}
    .k-arrivals-tbl td.a-sup{grid-area:sup;font-size:13px!important;font-weight:900!important}
    .k-arrivals-tbl td.a-acts{grid-area:acts}
    .k-arrivals-tbl td.a-qty{grid-area:qty}
    .k-arrivals-tbl td.a-rem{grid-area:rem}
    .k-arrivals-tbl td.a-cost{grid-area:cost}
    .k-arrivals-tbl td.a-retail{grid-area:ret}
    .k-arrivals-tbl td.a-bulk{grid-area:bulk}
    .k-arrivals-tbl td.a-exp{grid-area:exp}
    .k-arrivals-tbl td.a-date{grid-area:date;font-size:11px!important;color:var(--muted)!important;text-align:right!important;align-self:center}
    .k-arrivals-tbl td.a-qty,
    .k-arrivals-tbl td.a-rem,
    .k-arrivals-tbl td.a-cost,
    .k-arrivals-tbl td.a-retail,
    .k-arrivals-tbl td.a-bulk,
    .k-arrivals-tbl td.a-exp{
      display:flex;flex-direction:column;gap:1px;
      padding-top:6px!important;border-top:1px solid var(--tbl-line)!important
    }
    .k-arrivals-tbl td.a-qty::before,
    .k-arrivals-tbl td.a-rem::before,
    .k-arrivals-tbl td.a-cost::before,
    .k-arrivals-tbl td.a-retail::before,
    .k-arrivals-tbl td.a-bulk::before,
    .k-arrivals-tbl td.a-exp::before{
      content:attr(data-l);font-size:9px;color:var(--muted);font-weight:700;text-transform:uppercase
    }
    .k-arrivals-row-acts{flex-direction:column;gap:4px}
    .k-arrivals-row-acts .k-btn{min-height:34px!important;padding:4px 8px!important;font-size:12px}
    .k-arrivals-edit-tr{display:block!important;margin:-4px 0 10px;border:none;background:transparent;padding:0}
    .k-arrivals-edit-tr > td{display:block!important;padding:0!important;border:none!important}
    .k-arrivals-edit{
      padding:10px;border:1px solid rgba(31,215,96,.25);border-radius:12px;
      background:var(--green-d);margin:0
    }
    .k-arrivals-edit-grid{max-width:none;grid-template-columns:1fr 1fr!important;gap:8px}
    .k-arrivals-edit-foot{
      position:sticky;bottom:0;z-index:5;
      display:grid;grid-template-columns:1fr 1fr;gap:8px;
      margin:12px -10px -10px;padding:10px;
      padding-bottom:calc(10px + env(safe-area-inset-bottom,0px));
      background:linear-gradient(180deg,transparent,var(--green-d) 18%);
      border-top:1px solid rgba(31,215,96,.2)
    }
    .k-arrivals-edit-foot .k-btn{width:100%;min-height:46px!important;font-size:14px}
    .k-arrivals-add .k-arrivals-edit-foot{
      margin:12px -10px -10px;grid-template-columns:1fr
    }
    .k-label-search-row{display:flex;gap:6px;align-items:stretch;margin-bottom:8px}
    .k-label-search-row .k-inp{flex:1;min-width:0;margin-bottom:0!important}
    .k-receipt-modal .k-btn{min-height:36px}
    .k-receipt-modal .k-inp,.k-receipt-modal .k-sel{min-height:36px!important;font-size:15px!important;padding:6px 8px!important}
    .k-wh-cta .k-btn-g{
      width:100%;min-height:40px!important;padding:8px 12px!important;font-size:13px;
      box-shadow:none
    }
    .k-wh-cta > span{display:none}
    .k-wh-cta-spacer{display:block;height:48px}
    .k-wh-receipts .k-wh-cta-spacer,
    .k-wh-writeoffs .k-wh-cta-spacer{display:none!important;height:0}
    .k-wh-writeoffs .k-wh-cards,
    .k-wh-revisions .k-wh-cards{display:flex}
    .k-wh-writeoffs .k-wh-panel-body,
    .k-wh-revisions .k-wh-panel-body{padding-bottom:64px}
    .k-wh-revisions .k-wh-filters-row .k-wh-cta{display:none!important}
    .k-rev-card{padding:7px 8px!important;gap:5px!important}
    .k-rev-card .k-wh-card-meta{grid-template-columns:1fr 1fr 1fr 1fr!important;gap:3px 6px}
    .k-rev-card .k-wh-card-meta .l{font-size:8px}
    .k-rev-card .k-wh-card-meta .v{font-size:11px;margin-top:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .k-rev-card .k-wh-card-actions{gap:4px}
    .k-rev-card .k-wh-card-actions .k-btn{
      min-height:30px!important;padding:3px 6px!important;font-size:12px
    }
    .k-rev-item{padding:4px 6px;gap:1px 5px;border-radius:6px}
    .k-rev-item-emo{font-size:13px}
    .k-rev-item-txt b{font-size:11px}
    .k-rev-item-txt small{font-size:9px}
    .k-rev-item-nums{gap:2px 6px;padding-top:2px;margin-top:1px}
    .k-rev-item-nums b,.k-rev-item-nums .k-rev-delta{font-size:11px}
    .k-rev-item-nums span{font-size:9px}
    .k-rev-card-detail{gap:3px;padding-top:6px}
    .k-wh-fab,.k-cli-fab,.k-prod-fab,.k-sup-fab,.k-fin-fab{
      display:flex!important;align-items:center;justify-content:center;
      position:fixed;right:14px;bottom:calc(58px + env(safe-area-inset-bottom,0px));
      z-index:140;width:52px;height:52px;border-radius:14px;border:none;
      background:linear-gradient(135deg,#1FD760,#14b24f);color:#05210D;
      font-size:28px;font-weight:900;line-height:1;cursor:pointer;
      box-shadow:0 8px 22px rgba(31,215,96,.4)
    }
    .k-wh-fab:disabled,.k-cli-fab:disabled,.k-prod-fab:disabled,.k-sup-fab:disabled,.k-fin-fab:disabled{opacity:.45;cursor:default;box-shadow:none}
    .k-wh-fab.has-draft::after{
      content:'';position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;
      background:var(--gold);box-shadow:0 0 0 2px rgba(255,184,0,.25)
    }
    .k-trade:has(.k-receipt-modal-bg) .k-wh-fab:not(.k-wo-fab):not(.k-rev-fab):not(.k-cli-fab):not(.k-prod-fab):not(.k-sup-fab){display:none!important}
    .k-clients-mod:has(.k-modal-bg) .k-cli-fab,
    .k-suppliers-mod:has(.k-modal-bg) .k-sup-fab{display:none!important}
    .k-wo-fab{
      display:flex!important;
      bottom:calc(14px + env(safe-area-inset-bottom,0px));
      background:linear-gradient(135deg,#FF5A5A,#cc4040);color:#fff;
      box-shadow:0 8px 22px rgba(255,90,90,.35)
    }
    .k-rev-fab{
      display:flex!important;
      bottom:calc(14px + env(safe-area-inset-bottom,0px));
      background:linear-gradient(135deg,#3B8EF0,#2563b0);color:#fff;
      box-shadow:0 8px 22px rgba(59,142,240,.35)
    }
    .k-wo-modal .k-receipt-scroll{padding:8px 10px 72px}
    .k-wo-modal .k-rcpt-head{
      display:grid;grid-template-columns:1fr auto;grid-template-areas:
        "title x"
        "actions actions";
      gap:6px;align-items:start
    }
    .k-wo-modal .k-rcpt-head-title{grid-area:title}
    .k-wo-modal .k-rcpt-find-x{grid-area:x;padding:2px 6px}
    .k-wo-modal .k-rcpt-head-actions{
      grid-area:actions;width:100%;display:grid;grid-template-columns:1fr 1fr;gap:6px
    }
    .k-wo-modal .k-rcpt-head-actions .k-btn-g{
      grid-column:auto;order:2;min-height:36px!important;font-size:13px
    }
    .k-wo-modal .k-rcpt-head-actions .k-btn-s{order:1;min-height:36px!important}
    .k-wo-modal .k-rcpt-head-actions .k-btn-s[style*="red"],
    .k-wo-modal .k-rcpt-head-actions .k-btn-del{order:0;grid-column:1 / -1}
    .k-rev-modal .k-rcpt-head{
      display:grid;grid-template-columns:1fr auto;grid-template-areas:
        "title x"
        "actions actions";
      gap:6px;align-items:start;padding:8px 10px
    }
    .k-rev-modal .k-rcpt-head-title{grid-area:title}
    .k-rev-modal .k-rcpt-find-x{grid-area:x;padding:2px 6px}
    .k-rev-head-actions{
      grid-area:actions;display:grid!important;grid-template-columns:1fr 1.35fr;gap:6px;width:100%
    }
    .k-rev-head-actions .k-btn{
      min-height:36px!important;width:100%;padding:6px 10px!important;font-size:13px
    }
    .k-rev-head-actions .k-btn-g{order:2;font-size:13px}
    .k-rev-head-actions .k-btn-s{order:1}
    .k-rev-head-actions .k-btn-del{order:0;grid-column:1 / -1}
    .k-rev-steps{padding:6px 10px}
    .k-rev-step-n{width:20px;height:20px;font-size:10px}
    .k-rev-step-lbl{font-size:11px}
    .k-rev-modal .k-rev-steps:has(.k-rev-step-lbl.on):not(:has(.k-rev-step-line)){display:none}
    .k-rev-scope{padding:8px 10px 12px}
    .k-rev-scope-main{padding:7px;gap:6px;border-radius:10px}
    .k-rev-scope-hero{padding:7px 8px;gap:8px;border-radius:10px;margin-bottom:6px}
    .k-rev-scope-hero-ic{width:28px;height:28px;border-radius:8px;font-size:14px}
    .k-rev-scope-hero b{font-size:16px}
    .k-rev-scope-hero small{font-size:12px;margin-top:2px}
    .k-rev-scope-cats{grid-template-columns:1fr;gap:5px;min-height:100px}
    .k-rev-scope-cat{min-height:40px;padding:7px 9px;font-size:12px}
    .k-rev-scope-cat .ce{font-size:14px}
    .k-rev-scope-sum{padding:6px 8px}
    .k-rev-scope-sum b{font-size:14px}
    .k-rev-scope-actions{grid-template-columns:1fr 1.5fr;gap:6px;padding-top:6px}
    .k-rev-scope-actions .k-btn{min-height:40px;font-size:14px}
    .k-rev-mode{padding:10px 10px 14px;gap:8px}
    .k-rev-mode-lbl{font-size:11px;margin:0 0 2px}
    .k-rev-mode-card{padding:11px 10px;gap:10px;border-radius:11px}
    .k-rev-mode-ic{width:36px;height:36px;border-radius:9px;font-size:18px}
    .k-rev-mode-txt b{font-size:14px;margin-bottom:1px}
    .k-rev-mode-txt small{font-size:11px;line-height:1.3}
    .k-rev-mode-go{font-size:16px}
    .k-rev-mode-cancel{min-height:34px;font-size:12px}
    .k-rev-walk-body{padding:0 0 8px!important}
    .k-rev-walk{gap:6px;padding:0 10px}
    .k-rev-walk-sticky{
      position:sticky;top:0;z-index:5;gap:5px;padding:6px 0 6px;
      margin:0 -10px;padding-left:10px;padding-right:10px;
      background:var(--panel);border-bottom:1px solid var(--border)
    }
    .k-rev-walk-filterbtn{padding:5px 8px;min-height:32px}
    .k-rev-walk-icbtn{width:36px}
    .k-rev-walk-tabs .k-subtab{padding:5px 10px;font-size:11px;min-height:32px}
    .k-rev-walk-search .k-inp{min-height:36px!important}
    .k-rev-walk-search .k-cam-scan-btn{min-width:40px;min-height:36px;padding:0 8px;font-size:18px}
    .k-rev-walk-row{padding:6px 8px}
    .k-rev-walk-txt b{font-size:12px}
    .k-rev-modal--walk .k-rcpt-head{
      grid-template-areas:"title x actions";
      grid-template-columns:1fr auto auto;align-items:center;padding:6px 10px;gap:6px
    }
    .k-rev-modal--walk .k-rcpt-head-title .sub{display:none}
    .k-rev-modal--walk .k-rcpt-head-ic{display:none}
    .k-rev-modal--walk .k-rev-head-actions{
      grid-area:actions;display:block!important;width:auto
    }
    .k-rev-modal--walk .k-rev-head-actions .k-btn{
      min-height:32px!important;width:auto;padding:4px 12px!important;font-size:12px
    }
    .k-rev-walk .k-rev-note{padding:0;margin:0;border:0}
    .k-rev-walk .k-rev-note-row{gap:5px}
    .k-rev-walk .k-rev-note-row .k-inp{
      min-height:34px!important;font-size:13px!important;padding:5px 8px!important
    }
    .k-rev-walk-back{min-width:34px;min-height:34px!important;padding:0 8px!important}
    .k-rev-walk-back-full{display:none}
    .k-rev-walk-back-short{display:inline}
    .k-rev-walk-prog{gap:6px}
    .k-rev-walk-prog-bar{height:5px}
    .k-rev-walk-prog > span{font-size:10px}
    .k-rev-walk-tabs{display:grid;grid-template-columns:1fr 1fr;gap:5px;flex-wrap:nowrap}
    .k-rev-walk-tabs .k-subtab{
      width:100%;justify-content:center;padding:7px 8px;font-size:11px;min-height:34px;border-radius:9px
    }
    .k-rev-walk-search{gap:6px}
    .k-rev-walk-search .k-inp{
      min-height:38px!important;font-size:14px!important;padding:6px 10px!important
    }
    .k-rev-walk-search .k-cam-scan-btn{
      display:inline-flex!important;min-width:42px;min-height:38px;padding:0 10px;font-size:18px;border-radius:9px
    }
    .k-rev-walk-msg{font-size:11px;margin-top:-2px}
    .k-rev-walk-sum{gap:3px;padding:5px 6px;border-radius:9px}
    .k-rev-walk-sum b{font-size:11px}
    .k-rev-walk-filters .k-rev-scope-lbl{font-size:10px;margin:2px 0 4px}
    .k-rev-walk .k-rev-cats{margin-bottom:6px}
    .k-rev-walk .k-cats-compact .k-cat{
      min-width:62px;padding:6px 8px;gap:2px;border-radius:10px;font-size:10px
    }
    .k-rev-walk .k-cats-compact .k-cat .ce{font-size:13px}
    .k-rev-walk .k-rev-stock-flt{margin-bottom:6px;gap:4px}
    .k-rev-walk .k-rev-stock-flt .k-subtab{padding:4px 8px;font-size:10px;min-height:28px;border-radius:7px}
    .k-rev-walk-list{gap:4px;padding-bottom:8px}
    .k-rev-walk-row{padding:7px 8px;gap:6px;border-radius:9px}
    .k-rev-walk-emo{font-size:15px}
    .k-rev-walk-txt b{font-size:12px}
    .k-rev-walk-txt small{font-size:9px}
    .k-rev-walk-go{font-size:14px}
    .k-rev-walk-done{border-radius:9px;gap:2px}
    .k-rev-walk-done-btns{padding:3px;gap:2px}
    .k-rev-walk-done-btns .k-btn{width:26px;height:26px;font-size:11px;border-radius:7px}
    .k-rev-walk-sheet-bg{
      align-items:flex-end;justify-content:stretch;padding:0;
      background:rgba(0,0,0,.5);inset:0;z-index:120
    }
    .k-rev-walk-sheet{
      width:100%;max-width:none;max-height:100%;overflow:auto;
      border-radius:16px 16px 0 0;border-left:0;border-right:0;border-bottom:0;
      padding:8px 12px calc(12px + env(safe-area-inset-bottom,0px));
      box-shadow:0 -8px 28px rgba(0,0,0,.35);-webkit-overflow-scrolling:touch
    }
    .k-rev-walk-sheet-bg.kb-open .k-rev-walk-sheet{
      padding-bottom:8px;border-radius:14px 14px 0 0;max-height:min(100%,420px)
    }
    .k-rev-walk-sheet-bg.kb-open .k-rev-walk-sheet-handle{margin:0 auto 6px}
    .k-rev-walk-sheet-bg.kb-open .k-rev-walk-sheet-h{margin-bottom:6px}
    .k-rev-walk-sheet-bg.kb-open .k-rev-walk-sheet-diff{margin:4px 0;padding:5px;min-height:32px}
    .k-rev-walk-sheet-bg.kb-open .k-rev-walk-sheet-actions .k-btn{min-height:38px}
    .k-rev-walk-sheet-handle{
      display:block;width:36px;height:4px;border-radius:99px;background:var(--border);
      margin:2px auto 10px
    }
    .k-rev-walk-sheet-h{gap:6px;margin-bottom:8px}
    .k-rev-walk-sheet-h .k-rev-walk-emo{font-size:16px;padding-top:2px}
    .k-rev-walk-sheet-h .k-rev-walk-txt b{font-size:13px}
    .k-rev-walk-sheet .k-field{margin-bottom:0}
    .k-rev-walk-sheet .k-field label{font-size:10px;margin-bottom:3px}
    .k-rev-walk-sheet .k-inp{
      min-height:42px!important;font-size:18px!important;font-weight:800;padding:8px 10px!important
    }
    .k-rev-walk-sheet-diff{margin:6px 0;padding:6px;font-size:13px;border-radius:8px;gap:1px}
    .k-rev-walk-sheet-diff b{font-size:13px}
    .k-rev-walk-sheet-diff span{font-size:10px}
    .k-rev-walk-sheet-actions{grid-template-columns:1fr 1fr;gap:6px}
    .k-rev-walk-sheet-actions .k-btn{min-height:42px;font-size:13px;border-radius:10px}
    .k-rev-walk-sheet-actions .k-btn-g{grid-column:1 / -1;font-size:14px;font-weight:900}
    .k-rev-scroll{padding:8px 10px 72px}
    .k-rev-note{padding:0 0 6px;margin-bottom:6px}
    .k-rev-note-row{gap:5px}
    .k-rev-note-row .k-btn{min-height:34px;padding:5px 8px;font-size:11px}
    .k-rev-scope-chip{margin-top:4px}
    .k-rev-scope-chip > span{padding:3px 7px;font-size:10px}
    .k-rev-summary{gap:3px;padding:5px 6px;margin-bottom:6px;grid-template-columns:repeat(3,minmax(0,1fr))}
    .k-rev-summary b{font-size:11px}
    .k-rev-line{padding:6px 8px;margin-bottom:5px;border-radius:9px}
    .k-rev-line-emo{font-size:15px}
    .k-rev-line-txt b{font-size:12px}
    .k-rev-line-btns{max-width:118px;gap:2px}
    .k-rev-line-btns .k-btn{width:26px;height:26px;font-size:11px;border-radius:7px}
    .k-rev-line-grid{grid-template-columns:1.15fr 0.85fr;gap:5px;margin-top:5px}
    .k-rev-line-grid .k-inp{min-height:34px!important;font-size:14px!important;padding:5px 8px!important}
    .k-rev-line-diff{min-height:34px;padding:3px 6px;align-items:flex-end}
    .k-wo-line-grid{grid-template-columns:1fr 1fr;gap:5px}
    .k-wo-line-grid .k-wo-sum{grid-column:1 / -1}
    .k-wo-summary{gap:4px;padding:6px;margin-bottom:6px}
    .k-wo-summary b{font-size:12px}
    .k-wo-reason-btn{padding:5px 7px;font-size:10px;border-radius:7px}
    .k-wo-line{padding:7px;margin-bottom:6px}
    .k-wo-line-emo{font-size:18px}
    .k-wo-line-txt b{font-size:12px}
    .k-wo-add{padding:8px;margin-bottom:6px}
    .k-online-chip{display:inline-flex!important}
    .k-top-net{display:flex!important;align-items:center}
    .k-wh-filters{flex-direction:column;align-items:stretch}
    .k-wh-filters-row{gap:6px}
    .k-wh-period{width:100%;gap:4px!important}
    .k-wh-period > div:first-of-type{display:flex;gap:4px;width:100%}
    .k-wh-period > div:first-of-type .k-btn{
      flex:1;padding:5px 6px!important;font-size:11px!important;min-height:30px!important
    }
    .k-wh-period .k-inp{
      flex:1 1 calc(50% - 12px);min-width:0;max-width:none!important;
      min-height:32px!important;font-size:12px!important;padding:4px 6px!important
    }
    .k-wh-period > span{font-size:11px}
    .k-wh-period > .k-btn{padding:5px 8px!important;font-size:11px!important;min-height:32px!important}
    .k-wh-meta{
      gap:6px;font-size:11px;margin:0 0 8px;padding:8px 10px;
      display:grid;grid-template-columns:1fr;border:1px solid var(--border);
      border-radius:10px;background:var(--card)
    }
    .k-wh-meta-count{font-size:12px;color:var(--muted)}
    .k-wh-money{
      margin-left:0!important;display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;font-size:11px;width:100%
    }
    .k-wh-money span{white-space:normal}
    .k-wh-cards{display:flex;gap:6px;padding-bottom:64px}
    .k-wh-card{padding:8px!important;gap:6px!important;border-radius:10px}
    .k-wh-card-top > div > div:first-child{font-size:10px!important}
    .k-wh-card-top > div > div:last-child{font-size:13px!important;margin-top:1px!important}
    .k-wh-card-meta{gap:4px}
    .k-wh-card-meta .l{font-size:9px;letter-spacing:.02em}
    .k-wh-card-meta .v{font-size:12px;margin-top:1px}
    .k-wh-card-actions{gap:4px}
    .k-wh-card-actions .k-btn{
      min-height:32px!important;min-width:0;padding:4px 6px!important;font-size:13px;border-radius:8px
    }
    .k-wh-desk-tbl{display:none!important}
    .k-trade:has(.k-receipt-modal-bg) .k-wh-cta{display:none!important}
    .k-receipt-modal-actions{
      padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px));
      flex-direction:column
    }
    .k-receipt-modal-actions .k-btn-primary-wide{width:100%;min-width:0;min-height:48px;order:-1}
    .k-receipt-modal-actions .k-btn-s{flex:1;min-height:44px}
    .k-receipt-modal-actions .k-btn-row{display:flex;gap:8px;width:100%}
    .k-page-h{margin-bottom:12px;gap:8px}
    .k-page-h h1{font-size:18px}
    .k-subtabs{position:sticky;top:0;z-index:7;background:var(--bg);padding-top:4px;margin-top:-4px}
    .k-seg-tabs{position:relative;top:auto;z-index:1;background:var(--card2);padding:2px;margin-top:0}
    .k-clients-chips{
      width:100%;gap:5px;padding:0;margin:0;overflow-x:auto;flex-wrap:nowrap;
      -webkit-overflow-scrolling:touch;scrollbar-width:none
    }
    .k-clients-chips::-webkit-scrollbar{display:none}
    .k-clients-chips .k-subtab{
      min-height:30px!important;padding:5px 9px!important;font-size:11px;border-radius:8px;flex-shrink:0
    }
    .k-clients-mod{padding-bottom:72px}
    .k-suppliers-mod{padding-bottom:72px;overflow:visible}
    .k-clients-mod .k-cli-sub{display:none}
    .k-clients-mod .k-page-h{margin-bottom:8px}
    .k-clients-mod .k-page-h h1{font-size:16px}
    .k-cli-meta,
    .k-sup-meta{
      display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;
      margin:0 0 8px;padding:6px 8px;border:1px solid var(--border);border-radius:10px;background:var(--card)
    }
    .k-cli-meta span,.k-sup-meta span{display:block;font-size:9px;color:var(--muted);font-weight:700}
    .k-cli-meta b,.k-sup-meta b{display:block;font-size:11px;font-weight:900;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .k-cli-toolbar,.k-sup-toolbar{flex-direction:column;align-items:stretch;gap:6px;margin-bottom:8px}
    .k-cli-search,.k-sup-search{
      flex:0 0 auto!important;max-width:none;width:100%;
      height:36px!important;min-height:36px!important;max-height:36px!important;
      font-size:14px!important;padding:6px 10px!important;box-sizing:border-box
    }
    /* Фильтры поставщиков — отдельная карточка ниже шапки, крутится вместе со списком */
    .k-sup-toolbar{
      flex:none;padding:8px;margin:0 0 8px;
      border:1px solid var(--border);border-radius:12px;background:var(--card)
    }
    .k-sup-chips{
      display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;
      width:100%;padding:4px;margin:0;overflow:visible;flex-wrap:nowrap;
      background:var(--card2);border:1px solid var(--border);border-radius:10px
    }
    .k-sup-chips .k-subtab{
      width:100%;justify-content:center;text-align:center;
      min-height:38px!important;padding:8px 4px!important;font-size:11px;border-radius:8px;
      border:none;flex-shrink:0
    }
    .k-sup-list{gap:6px;overflow:visible}
    .k-sup-row{padding:8px;gap:6px;border-radius:10px;flex-wrap:wrap;align-items:stretch}
    .k-sup-main{gap:7px;flex-wrap:wrap}
    .k-sup-emo{font-size:18px}
    .k-sup-name b{font-size:13px}
    .k-sup-txt small{font-size:10px;margin-top:2px}
    .k-sup-stats{gap:8px;width:100%;margin-left:0;padding-left:25px}
    .k-sup-stats > div{min-width:0;flex:1}
    .k-sup-stats span{font-size:9px}
    .k-sup-stats b{font-size:11px}
    .k-sup-actions{width:100%;justify-content:flex-end;padding-left:25px}
    .k-sup-actions .k-btn{width:32px;height:32px;font-size:13px}
    .k-cli-toolbar{flex:0 0 auto;flex-direction:column;align-items:stretch;gap:6px;margin-bottom:8px}
    .k-clients-head{
      position:sticky;top:0;z-index:6;background:var(--bg);
      padding-bottom:2px;margin:0 0 4px
    }
    .k-clients-head .k-subtabs{
      position:static;top:auto;background:transparent;padding-top:0;margin-top:0
    }
    .k-cli-list{gap:6px}
    .k-cli-row{padding:8px;gap:6px;border-radius:10px;flex-wrap:wrap;align-items:stretch}
    .k-cli-main{gap:7px;flex-wrap:wrap}
    .k-cli-emo{font-size:18px}
    .k-cli-name b{font-size:13px}
    .k-cli-txt small{font-size:10px;margin-top:2px}
    .k-cli-stats{gap:8px;width:100%;margin-left:0;padding-left:25px}
    .k-cli-stats > div{min-width:0;flex:1}
    .k-cli-stats span{font-size:9px}
    .k-cli-stats b{font-size:11px}
    .k-cli-actions{width:100%;justify-content:flex-end;padding-left:25px}
    .k-cli-actions .k-btn{
      width:32px;height:32px;min-height:0;padding:0;border-radius:8px;
      display:inline-flex;align-items:center;justify-content:center;font-size:14px
    }
    .k-cli-fab,.k-sup-fab{
      display:flex!important;
      bottom:calc(58px + env(safe-area-inset-bottom,0px))
    }
    .k-clients-mod:has(.k-modal-bg) .k-cli-fab,
    .k-suppliers-mod:has(.k-modal-bg) .k-sup-fab{display:none!important}
    .k-fin-fab-exp,.k-fin-fab-wd{
      background:linear-gradient(135deg,#FF5A5A,#cc4040);color:#fff;
      box-shadow:0 8px 22px rgba(255,90,90,.35)
    }
    .k-fin-fab-stack{
      position:fixed;right:14px;bottom:calc(58px + env(safe-area-inset-bottom,0px));z-index:140;
      display:flex;flex-direction:column;gap:10px;align-items:center
    }
    .k-fin-fab-stack .k-fin-fab{position:static;right:auto;bottom:auto}
    .k-finance-mod{padding-bottom:calc(56px + env(safe-area-inset-bottom,0px));overflow:visible}
    .k-finance-mod:has(.k-fin-fab),
    .k-finance-mod:has(.k-fin-fab-stack){padding-bottom:calc(120px + env(safe-area-inset-bottom,0px))}
    .k-finance-mod:has(.k-modal-bg) .k-fin-fab,
    .k-finance-mod:has(.k-modal-bg) .k-fin-fab-stack{display:none!important}
    .k-fin-print{display:none!important}
    .k-fin-toolbar-box .k-fin-periods,
    .k-fin-toolbar-box .k-fin-dates{display:none!important}
    .k-fin-box-hero{padding:12px 14px;border-radius:10px;margin-bottom:8px}
    .k-fin-box-hero .kl{font-size:11px}
    .k-fin-box-hero .kv{font-size:22px;margin-top:2px}
    .k-fin-box-hero .k-fin-kpi-sub{font-size:10px;margin-top:3px;line-height:1.3}
    .k-fin-box-totals{gap:6px;margin-bottom:8px}
    .k-fin-box-card{padding:10px 12px;border-radius:10px}
    .k-fin-box-card .kl{font-size:10px}
    .k-fin-box-card .kv{
      font-size:18px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap
    }
    .k-fin-box-move-row{gap:6px;margin-bottom:10px}
    .k-fin-box-move{
      min-height:42px!important;padding:8px 6px!important;font-size:12px!important;
      white-space:nowrap;border-radius:10px
    }
    .k-fin-box-point{padding:10px 12px;border-radius:10px}
    .k-fin-box-point-h{flex-direction:column;align-items:flex-start;gap:2px;margin-bottom:6px}
    .k-fin-box-point-h b{font-size:13px}
    .k-fin-box-point-h span{font-size:10px}
    .k-fin-box-point-nums b{font-size:14px}
    .k-fin-filters.k-fin-filters-box{grid-template-columns:1fr}
    .k-reports-mod{padding-bottom:calc(56px + env(safe-area-inset-bottom,0px));overflow:visible}
    .k-rep-toolbar{
      flex:none;flex-direction:column;align-items:stretch;gap:6px;
      padding:8px;margin:0 0 8px;border:1px solid var(--border);border-radius:12px;background:var(--card)
    }
    .k-rep-periods{
      display:flex;width:100%;flex-wrap:nowrap;overflow-x:auto;gap:5px;padding:4px;margin:0;
      background:var(--card2);border:1px solid var(--border);border-radius:10px;
      -webkit-overflow-scrolling:touch;scrollbar-width:none
    }
    .k-rep-periods::-webkit-scrollbar{display:none}
    .k-rep-periods .k-subtab{
      min-height:30px!important;padding:5px 9px!important;font-size:11px;border-radius:8px;flex-shrink:0
    }
    .k-rep-search{
      flex:0 0 auto!important;max-width:none;width:100%;min-width:0;
      height:32px!important;min-height:32px!important;max-height:32px!important
    }
    .k-rep-search-opt{display:none!important}
    .k-rep-actions{margin-left:0;justify-content:flex-end}
    .k-rep-actions .k-btn{width:32px;height:32px;font-size:14px}
    .k-rep-flt-btn{display:inline-flex!important}
    .k-rep-dates{max-width:none;margin-bottom:8px}
    .k-rep-filters{display:none;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:8px}
    .k-rep-filters.is-open{display:grid!important}
    .k-rep-tabs{
      flex-wrap:nowrap;margin-bottom:8px;position:static;top:auto;z-index:auto;
      background:transparent;padding:0;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none
    }
    .k-rep-tabs::-webkit-scrollbar{display:none}
    .k-rep-tabs .k-subtab{
      min-height:30px!important;padding:5px 9px!important;font-size:11px;border-radius:8px
    }
    .k-rep-hint{font-size:11px;margin-bottom:8px}
    .k-rep-highlight{
      grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;padding:8px;margin-bottom:8px
    }
    .k-rep-highlight span{font-size:9px}
    .k-rep-highlight b{font-size:14px;margin-top:2px}
    .k-rep-stats{
      grid-template-columns:repeat(auto-fit,minmax(70px,1fr));gap:4px;padding:6px 8px;margin-bottom:8px
    }
    .k-rep-stats span{font-size:9px}
    .k-rep-stats b{font-size:11px}
    .k-rep-note{font-size:10px;margin-bottom:8px}
    .k-rep-split{grid-template-columns:1fr;gap:8px}
    .k-rep-panel{border-radius:10px}
    .k-rep-panel-h{padding:7px 10px;font-size:12px}
    .k-rep-row{padding:8px 10px;gap:8px}
    .k-rep-row-txt b{font-size:12px}
    .k-rep-row-txt small{font-size:10px}
    .k-rep-amt{font-size:12px}
    .k-rep-row-metrics{gap:4px;padding-top:5px;margin-top:2px}
    .k-rep-row-metrics span{font-size:8px}
    .k-rep-row-metrics b{font-size:11px}
    .k-reports-mod .k-kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:5px}
    .k-reports-mod .k-tbl-scroll .k-tbl{min-width:520px}
    .k-fin-meta{
      display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;
      margin:0 0 8px;padding:6px 8px;border:1px solid var(--border);border-radius:10px;background:var(--card)
    }
    .k-fin-meta span{display:block;font-size:9px;color:var(--muted);font-weight:700}
    .k-fin-meta b{display:block;font-size:11px;font-weight:900;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .k-fin-toolbar{
      flex:none;flex-direction:column;align-items:stretch;gap:6px;
      padding:8px;margin:0 0 8px;border:1px solid var(--border);border-radius:12px;background:var(--card)
    }
    .k-fin-periods{
      display:flex;width:100%;flex-wrap:nowrap;overflow-x:auto;gap:5px;padding:4px;margin:0;
      background:var(--card2);border:1px solid var(--border);border-radius:10px;
      -webkit-overflow-scrolling:touch;scrollbar-width:none
    }
    .k-fin-periods::-webkit-scrollbar{display:none}
    .k-fin-periods .k-subtab{
      min-height:30px!important;padding:5px 9px!important;font-size:11px;border-radius:8px;flex-shrink:0
    }
    .k-fin-actions{margin-left:0;justify-content:flex-end}
    .k-fin-actions .k-btn{width:32px;height:32px;font-size:15px}
    .k-fin-actions .k-fin-csv{width:auto;min-width:40px;padding:0 8px;font-size:11px;font-weight:800}
    .k-fin-flt-btn{display:inline-flex!important}
    .k-fin-dates{max-width:none;margin-bottom:8px}
    .k-fin-filters{display:none;grid-template-columns:1fr;gap:5px;margin-bottom:8px}
    .k-fin-filters.is-open{display:grid!important}
    .k-fin-tabs{
      flex-wrap:nowrap;margin-bottom:8px;position:static;top:auto;z-index:auto;
      background:transparent;padding:0;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none
    }
    .k-fin-tabs::-webkit-scrollbar{display:none}
    .k-fin-tabs .k-subtab{
      display:inline-flex;position:relative;flex-direction:column;gap:2px;
      min-height:44px!important;padding:5px 8px!important;font-size:10px;border-radius:8px
    }
    .k-fin-tab-ic{font-size:15px}
    .k-fin-tabs .k-fin-tab-n{position:absolute;top:2px;right:2px}
    .k-fin-hint{font-size:11px;margin-bottom:8px}
    .k-fin-submeta{
      grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;padding:6px 8px;margin-bottom:8px
    }
    .k-fin-submeta-2{grid-template-columns:repeat(2,minmax(0,1fr))}
    .k-fin-submeta span{font-size:9px}
    .k-fin-submeta b{font-size:11px}
    .k-fin-split{grid-template-columns:1fr;gap:8px}
    .k-fin-panel{border-radius:10px;margin-bottom:8px}
    .k-fin-panel-h{padding:7px 10px;font-size:12px}
    .k-fin-row{padding:8px 10px;gap:8px}
    .k-fin-row-txt b{font-size:12px}
    .k-fin-row-txt small{font-size:10px;margin-top:2px}
    .k-fin-amt,.k-fin-amt-col b{font-size:12px}
    .k-body:has(.k-receipt-modal-bg) .k-bottom-nav,
    .k-trade:has(.k-receipt-modal-bg) .k-bottom-nav,
    .k-body:has(.k-modal-bg) .k-bottom-nav,
    .k-trade:has(.k-modal-bg) .k-bottom-nav,
    .k-body:has(.k-modal-fs-bg) .k-bottom-nav,
    .k-trade:has(.k-modal-fs-bg) .k-bottom-nav,
    .k-body:has(.k-arrivals-modal) .k-bottom-nav,
    .k-trade:has(.k-arrivals-modal) .k-bottom-nav{visibility:hidden;pointer-events:none}
    .k-trade:has(.k-receipt-modal-bg) .k-wh-cta{display:none!important}
    .k-bottom-nav{
      display:flex!important;position:fixed;bottom:0;left:0;right:0;z-index:150;
      background:var(--panel);border-top:1px solid var(--border);
      padding:2px 2px calc(2px + env(safe-area-inset-bottom,0px));gap:1px;
      box-shadow:0 -4px 14px rgba(0,0,0,.06)
    }
    .k-bottom-nav button{
      flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;
      border:none;background:transparent;color:var(--muted);border-radius:10px;padding:5px 2px;
      font-size:10px;font-weight:800;cursor:pointer;min-height:48px;line-height:1.05;text-align:center
    }
    .k-bottom-nav button .ic{font-size:18px;line-height:1}
    .k-bottom-nav button .lbl{
      display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:.01em
    }
    .k-bottom-nav button.active{
      background:var(--green-d);color:var(--green);
      box-shadow:inset 0 0 0 1px rgba(31,215,96,.3)
    }
    .k-bottom-nav button:active{transform:scale(.97)}
  }

  /* Android: StatusBar overlays WebView — шапка на одном уровне с карточками */
  html.kakapo-android{
    --k-android-nav-lift:12px;
    --k-android-top-inset:max(env(safe-area-inset-top,0px),18px)
  }
  /* Android: отступ сверху на прозрачной зоне, круглая карточка — в .k-top-shell */
  html.kakapo-android .k-top{
    flex:0 0 auto;flex-shrink:0;
    margin:0!important;
    padding:calc(6px + var(--k-android-top-inset)) 10px 6px!important;
    min-height:0!important;
    background:transparent!important;
    border:none!important;
    box-shadow:none!important
  }
  html.kakapo-android .k-body{
    --k-top-overlay:calc(6px + var(--k-android-top-inset) + 70px + 8px)
  }
  html.kakapo-android .k-trade:not(.pos-fs) .k-body-pos{
    padding-bottom:calc(56px + var(--k-android-nav-lift) + env(safe-area-inset-bottom,0px))!important
  }
  html.kakapo-android .k-bottom-nav{
    padding-bottom:calc(2px + var(--k-android-nav-lift) + env(safe-area-inset-bottom,0px))
  }
  html.kakapo-android .k-main,
  html.kakapo-android .k-trade:has(.k-body-pos) .k-main,
  html.kakapo-android .k-trade:has(.k-body-debts) .k-main,
  html.kakapo-android .k-trade:has(.k-body-clients) .k-main{
    padding-bottom:calc(56px + var(--k-android-nav-lift) + env(safe-area-inset-bottom,0px))
  }
  html.kakapo-android .k-trade.pos-fs .k-main{
    padding-bottom:0
  }
  html.kakapo-android .k-wh-fab,
  html.kakapo-android .k-cli-fab,
  html.kakapo-android .k-prod-fab,
  html.kakapo-android .k-sup-fab,
  html.kakapo-android .k-fin-fab,
  html.kakapo-android .k-fin-fab-stack{
    bottom:calc(58px + var(--k-android-nav-lift) + env(safe-area-inset-bottom,0px))
  }
  html.kakapo-android .k-reports-mod{
    padding-bottom:calc(56px + var(--k-android-nav-lift) + env(safe-area-inset-bottom,0px))
  }
  html.kakapo-android .k-finance-mod{
    padding-bottom:calc(56px + var(--k-android-nav-lift) + env(safe-area-inset-bottom,0px))
  }
  html.kakapo-android .k-finance-mod:has(.k-fin-fab),
  html.kakapo-android .k-finance-mod:has(.k-fin-fab-stack){
    padding-bottom:calc(120px + var(--k-android-nav-lift) + env(safe-area-inset-bottom,0px))
  }

  /* Android Capacitor: склад/товары крутятся в .k-body — шапка .k-top остаётся на месте */
  html.kakapo-android .k-main:has(.k-body-warehouse),
  html.kakapo-android .k-main:has(.k-body-products){
    overflow:hidden!important
  }
  html.kakapo-android .k-main:has(.k-body-warehouse) .k-body,
  html.kakapo-android .k-main:has(.k-body-products) .k-body{
    overflow:auto!important;-webkit-overflow-scrolling:touch!important;
    flex:1 1 auto!important;min-height:0!important
  }
  html.kakapo-android .k-body-warehouse,
  html.kakapo-android .k-body-warehouse > .k-wh-shell,
  html.kakapo-android .k-wh-shell > .k-wh-body,
  html.kakapo-android .k-wh-shell > .k-wh-body > .k-wh-stock,
  html.kakapo-android .k-wh-shell > .k-wh-body > .k-wh-receipts,
  html.kakapo-android .k-wh-shell > .k-wh-body > .k-wh-writeoffs,
  html.kakapo-android .k-wh-shell > .k-wh-body > .k-wh-revisions,
  html.kakapo-android .k-wh-shell > .k-wh-body > .k-wh-expiry{
    flex:none!important;height:auto!important;min-height:0!important;max-height:none!important;
    overflow:visible!important
  }
  html.kakapo-android .k-wh-stock-body,
  html.kakapo-android .k-wh-panel-body,
  html.kakapo-android .k-wh-receipts-body{
    overflow:visible!important;flex:none!important;height:auto!important;max-height:none!important
  }
  html.kakapo-android .k-body-products,
  html.kakapo-android .k-body-products > .k-products-mod,
  html.kakapo-android .k-products-mod-body,
  html.kakapo-android .k-catalog-shell{
    flex:none!important;height:auto!important;min-height:0!important;overflow:visible!important
  }
  html.kakapo-android .k-body-clients,
  html.kakapo-android .k-body-clients > .k-clients-mod{
    flex:none!important;height:auto!important;min-height:0!important;max-height:none!important;
    overflow:visible!important
  }
  html.kakapo-android .k-catalog-body{
    overflow:visible!important;flex:none!important;height:auto!important;max-height:none!important
  }

  @media (max-width:600px){
    .k-kpis{grid-template-columns:1fr 1fr}
    .k-receipt-summary{gap:8px}
  }

  @media (max-width:480px){
    .k-kpis{grid-template-columns:1fr 1fr}
    .k-mob-menu-btn{width:38px;height:38px}
    .k-body{padding:10px}
    .k-rev-walk-toolbar{flex-wrap:wrap}
    .k-rev-devs-btn{width:100%;justify-content:space-between;min-height:36px}
    .k-rev-edit-toolbar{flex-wrap:wrap}
    .k-rev-edit-toolbar .k-rev-devs-btn{width:100%;justify-content:space-between}
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

function Clock({
  theme,
  onThemeChange,
}: {
  theme?: TradeTheme
  onThemeChange?: (next: TradeTheme) => void
}) {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!now) {
    return (
      <div className="k-clock">
        <div className="k-clock-row">
          <div className="time">--:--</div>
          {theme && onThemeChange ? <TradeThemeToggle theme={theme} onChange={onThemeChange} /> : null}
        </div>
      </div>
    )
  }
  const date = now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
  const day = now.toLocaleDateString('ru-RU', { weekday: 'short' })
  const time = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="k-clock">
      <div className="date">{date} · <span style={{ textTransform: 'capitalize' }}>{day}</span></div>
      <div className="k-clock-row">
        <div className="time">{time}</div>
        {theme && onThemeChange ? <TradeThemeToggle theme={theme} onChange={onThemeChange} /> : null}
      </div>
    </div>
  )
}

function TradeThemeToggle({
  theme,
  onChange,
}: {
  theme: TradeTheme
  onChange: (next: TradeTheme) => void
}) {
  return (
    <div className="k-theme-toggle" role="group" aria-label="Тема">
      <button
        type="button"
        className={`k-theme-mode ${theme === 'dark' ? 'on' : ''}`}
        title="Тёмная тема"
        onClick={() => onChange('dark')}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M21 14.3A9 9 0 1 1 9.7 3 7 7 0 0 0 21 14.3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        className={`k-theme-mode ${theme === 'light' ? 'on' : ''}`}
        title="Светлая тема"
        onClick={() => onChange('light')}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.05 5.05l1.56 1.56M17.39 17.39l1.56 1.56M18.95 5.05l-1.56 1.56M6.61 17.39l-1.56 1.56" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

function NetworkStatus({ compact = false }: { compact?: boolean }) {
  const online = useOfflineSync(s => s.online)
  const pending = useOfflineSync(s => s.pending)
  const failed = useOfflineSync(s => s.failed)
  const syncing = useOfflineSync(s => s.syncing)
  const progress = useOfflineSync(s => s.progress)
  const lastSyncAtIso = useOfflineSync(s => s.lastSyncAtIso)
  const [mounted, setMounted] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)

  useEffect(() => { setMounted(true) }, [])
  if (!mounted) {
    return compact
      ? <span className="k-online-chip" data-state="online"><span className="d" /><span className="t">Онлайн</span></span>
      : <div className="k-online"><span className="d" />Онлайн</div>
  }

  const state = syncing ? 'sync' : !online ? 'offline' : failed > 0 ? 'failed' : 'online'
  const shortLabel = syncing ? 'Синхр.' : online ? 'Онлайн' : 'Офлайн'
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

  const openQueue = (e?: MouseEvent) => {
    e?.preventDefault()
    e?.stopPropagation()
    setQueueOpen(true)
  }

  if (compact) {
    return (
      <>
        <button
          type="button"
          className="k-online-chip"
          data-state={state}
          title={`${label} — нажмите, чтобы открыть очередь`}
          onClick={openQueue}
        >
          <span className="d" />
          <span className="t">{shortLabel}</span>
          {(pending + failed) > 0 ? <span className="n">{pending + failed}</span> : null}
        </button>
        {queueOpen && <OfflineQueuePanel onClose={() => setQueueOpen(false)} />}
      </>
    )
  }

  return (
    <>
      <button
        type="button"
        className="k-netblock"
        data-state={state}
        title="Открыть очередь синхронизации"
        onClick={openQueue}
      >
        <div className="k-online" data-state={state}><span className="d" />{label}</div>
        <div className="k-netnote">
          {pending > 0 && failed > 0
            ? `Ждут: ${pending} · повтор: ${failed}${lastSync ? ` · ${lastSync}` : ''}`
            : pending > 0
              ? `Ждут: ${pending}${lastSync ? ` · синхр. ${lastSync}` : ''}`
              : failed > 0
                ? `Повтор: ${failed}${lastSync ? ` · ${lastSync}` : ''}`
                : lastSync
                  ? `Синхр. ${lastSync}`
                  : 'Очередь пуста'}
        </div>
        <div className="k-net-hint">Очередь →</div>
      </button>
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
  const { page, setPage, navigate } = useAppNavigation(defaultPage)
  const current = (
    allowedNav.some(p => p.id === page) ? page : defaultPage
  ) as TradePage
  const products = useProducts(s => s.products)
  const loaded = useProducts(s => s.loaded)
  const [search, setSearch] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchScanOpen, setSearchScanOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [posSurface, setPosSurface] = useState<'dashboard' | 'register'>('dashboard')
  const [posDashboardApi, setPosDashboardApi] = useState<CashierDashboardApi | null>(null)
  const [productsSub, setProductsSub] = useState<ProductsSubPage>('product')
  const [catalogBack, setCatalogBack] = useState<(() => void) | null>(null)
  const onBackToCatalogChange = useCallback((handler: (() => void) | null) => {
    setCatalogBack(() => handler)
  }, [])

  function applyTheme(next: TradeTheme) {
    onThemeChange(next)
  }

  // Каталог уже подтягивает hydrate + useApiSync — лишний fetch на mount не нужен
  // (на слабом интернете дублировал тяжёлую загрузку)

  useEffect(() => {
    setMenuOpen(false)
  }, [page])

  useEffect(() => {
    if (!menuOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    return pushBackHandler(() => {
      setMenuOpen(false)
      return true
    })
  }, [menuOpen])

  useEffect(() => {
    if (!catalogBack) return
    return pushBackHandler(() => {
      catalogBack()
      return true
    })
  }, [catalogBack])

  useEffect(() => {
    if (current !== 'pos' || posSurface !== 'register') return
    return pushBackHandler(() => {
      setPosSurface('dashboard')
      return true
    })
  }, [current, posSurface])

  useEffect(() => {
    if (!searchScanOpen) return
    return pushBackHandler(() => {
      setSearchScanOpen(false)
      return true
    })
  }, [searchScanOpen])

  useEffect(() => {
    if (!canAccessTradePage(session.permissions, page)) {
      navigate(defaultPage, {}, { replace: true })
    }
  }, [session.permissions, page, defaultPage, navigate])

  useEffect(() => {
    if (current !== 'products') {
      onBackToCatalogChange(null)
      setProductsSub('product')
    }
  }, [current, onBackToCatalogChange])

  const PRODUCTS_SUBS: { id: ProductsSubPage; label: string; icon: string }[] = [
    { id: 'product', label: 'Товар', icon: '📦' },
    { id: 'category', label: 'Категория', icon: '🗂' },
    { id: 'labels', label: 'Этикетки', icon: '🏷' },
  ]

  const showSearch =
    current === 'warehouse'
    || current === 'clients'
    || current === 'suppliers'
    || current === 'debts'
    || (current === 'products' && productsSub === 'product')

  const searchPlaceholder =
    current === 'clients' || current === 'debts'
      ? 'Поиск: имя, телефон, карта…'
      : current === 'suppliers'
        ? 'Поиск: название, телефон, категория…'
        : 'Поиск по названию, артикулу, штрихкоду…'

  const searchHasScan =
    current === 'warehouse'
    || (current === 'products' && productsSub === 'product')
  useEffect(() => {
    if (current === 'products' && (productsSub === 'category' || productsSub === 'labels')) {
      setSearch('')
    }
  }, [current, productsSub])

  useEffect(() => {
    if (current !== 'products' || productsSub !== 'labels') return
    if (isTradeMobileUi()) return
    let cancelled = false
    const focusLabels = () => {
      if (cancelled) return
      const el = document.querySelector('input[data-label-search]') as HTMLInputElement | null
      if (!el || el.disabled) return
      try { el.focus({ preventScroll: true }) } catch { el.focus() }
    }
    focusLabels()
    const timers = [0, 40, 120, 280].map(ms => window.setTimeout(focusLabels, ms))
    return () => {
      cancelled = true
      timers.forEach(id => window.clearTimeout(id))
    }
  }, [current, productsSub])

  function focusTradeSearch() {
    if (isTradeMobileUi()) return
    const el = searchInputRef.current
    if (!el) return
    try { el.focus({ preventScroll: true }) } catch { el.focus() }
  }

  function overlayIsVisible(el: Element): boolean {
    if (!(el instanceof HTMLElement)) return false
    if (el.closest('[aria-hidden="true"]')) return false
    const host = el.closest('.pos-host')
    if (host instanceof HTMLElement) {
      if (host.getAttribute('aria-hidden') === 'true') return false
      if (host.style.display === 'none') return false
    }
    const st = window.getComputedStyle(el)
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false
    return true
  }

  function tradeSearchBlocked() {
    if (catalogBack) return true
    const nodes = document.querySelectorAll('.modal-card, .overlay, .k-modal, .k-modal-bg')
    for (const n of nodes) {
      if (overlayIsVisible(n)) return true
    }
    return false
  }

  useEffect(() => {
    if (!showSearch) return
    setSearch('')
    if (isTradeMobileUi()) return
    const t = window.setTimeout(focusTradeSearch, 40)
    return () => window.clearTimeout(t)
  }, [current, showSearch])

  useEffect(() => {
    if (!showSearch || catalogBack) return
    if (isTradeMobileUi()) return
    const t = window.setTimeout(focusTradeSearch, 40)
    return () => window.clearTimeout(t)
  }, [catalogBack, showSearch])

  // Desktop: курсор всегда в поиске (сканер). На мобильном — только по тапу в поле.
  useEffect(() => {
    if (!showSearch) return
    if (isTradeMobileUi()) return

    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (tradeSearchBlocked()) return
      const active = document.activeElement as HTMLElement | null
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable)) {
        return
      }
      if (e.key.length === 1 || e.key === 'Backspace') {
        focusTradeSearch()
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      if (tradeSearchBlocked()) return
      const t = e.target as HTMLElement | null
      if (!t) return
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return
      if (t.closest('.modal-card, .overlay, .k-modal, .k-modal-bg')) return
      window.setTimeout(() => {
        if (tradeSearchBlocked()) return
        const active = document.activeElement as HTMLElement | null
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable)) {
          return
        }
        focusTradeSearch()
      }, 0)
    }

    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerup', onPointerUp, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerup', onPointerUp, true)
    }
  }, [showSearch, catalogBack])

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

  const MOB_QUICK: { id: TradePage; label: string; icon: string }[] = useMemo(() => {
    const prefer: TradePage[] = ['products', 'clients', 'debts', 'warehouse']
    return prefer
      .filter(id => canAccessTradePage(session.permissions, id))
      .map(id => {
      const n = NAV.find(x => x.id === id)!
        return { id: n.id, label: n.label, icon: n.icon }
    })
  }, [session.permissions])

  function renderPage() {
    if (!canAccessTradePage(session.permissions, current)) {
      return <div className="k-empty">Нет доступа к этому разделу</div>
    }
    if (!loaded && current === 'products') return <div className="k-empty">Загрузка товаров…</div>
    if (current === 'products') {
      return (
        <ProductsModule
          search={search}
          subPage={productsSub}
          onSubPageChange={setProductsSub}
          hideSubtabs
          onBackToCatalogChange={onBackToCatalogChange}
        />
      )
    }
    if (current === 'warehouse') return <WarehouseModule products={products} search={search} />
    if (current === 'suppliers') return <SuppliersModule search={search} />
    if (current === 'clients') return <ClientsModule search={search} />
    if (current === 'debts') return <DebtsModule search={search} onNavigate={p => goTo(p as TradePage)} />
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
  const debtsActive = current === 'debts'
  /** Касса держится ~30с после ухода — быстрый возврат без потери, потом выгрузка из памяти */
  const [salesKeepAlive, setSalesKeepAlive] = useState(salesActive)
  useEffect(() => {
    if (salesActive) {
      setSalesKeepAlive(true)
      return
    }
    const t = window.setTimeout(() => setSalesKeepAlive(false), 30_000)
    return () => window.clearTimeout(t)
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
                <Clock
                  theme={current === 'sales' ? undefined : theme}
                  onThemeChange={current === 'sales' ? undefined : applyTheme}
                />
                <DesktopUpdateButton />
                <button
                  type="button"
                  className="k-user"
                  title="Выйти"
                  onClick={onLogout}
                >
                  <div className="av">{initials(session.name)}</div>
                  <div className="who"><b>{session.name}</b><span>Выйти</span></div>
                </button>
              </div>
            </div>
          </aside>
        </>
      )}

      <div className={posFullscreen ? 'k-pos-fs-host' : 'k-main'}>
        {!posFullscreen && (
          <header className="k-top">
            <div className="k-top-shell">
            <button type="button" className="k-mob-menu-btn" onClick={() => setMenuOpen(true)} aria-label="Меню">☰</button>
            {current !== 'sales' && catalogBack ? (
              <button type="button" className="k-btn k-btn-s k-top-back" onClick={() => catalogBack()}>
                ← Назад
              </button>
            ) : null}
            {current === 'products' && !catalogBack ? (
              <div className="k-top-subtabs k-seg-tabs k-hide-mob" role="tablist" aria-label="Разделы товаров">
                {PRODUCTS_SUBS.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={productsSub === item.id}
                    className={`k-subtab ${productsSub === item.id ? 'active' : ''}`}
                    onClick={() => {
                      setProductsSub(item.id)
                      if (item.id === 'labels' && !isTradeMobileUi()) {
                        window.setTimeout(() => {
                          const el = document.querySelector('input[data-label-search]') as HTMLInputElement | null
                          if (!el) return
                          try { el.focus({ preventScroll: true }) } catch { el.focus() }
                        }, 0)
                      }
                    }}
                  >
                    <span className="ic">{item.icon}</span>
                    <span className="lbl">{item.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {current !== 'sales' && showSearch ? (
              <div className="k-top-search-wrap">
                <div className="k-top-search-net">
                  <NetworkStatus compact />
                </div>
                <div className={`k-search${searchHasScan ? ' has-scan' : ''}`}>
                <span className="mag">🔍</span>
                <input
                    ref={searchInputRef}
                  placeholder={searchPlaceholder}
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
                  {searchHasScan ? (
                  <button
                    type="button"
                    className="k-top-scan-btn k-cam-scan-btn"
                    title="Сканер камеры"
                    aria-label="Сканер камеры"
                    onClick={() => setSearchScanOpen(true)}
                  >
                    📷
                  </button>
                  ) : null}
              </div>
              </div>
            ) : (
              <>
                <div className="k-top-title">
                  <span className="k-top-title-main">
                    {NAV.find(n => n.id === current)?.label}
                  </span>
                </div>
                <div className="k-top-title-net">
                  <NetworkStatus compact />
                </div>
              </>
            )}
            <div className="k-top-end">
              {current === 'sales' && posSurface === 'dashboard' && posDashboardApi ? (
                <button
                  type="button"
                  className="k-btn k-btn-g k-btn-s k-top-pos-create"
                  title="Создать точку продаж"
                  onClick={() => posDashboardApi.openCreatePos()}
                >
                  + Создать точку
                </button>
              ) : null}
            </div>
            </div>
          </header>
        )}

        <div className={salesActive ? 'k-body k-body-pos' : debtsActive ? 'k-body k-body-debts' : current === 'clients' ? 'k-body k-body-clients' : current === 'suppliers' ? 'k-body k-body-suppliers' : current === 'finance' ? 'k-body k-body-finance' : current === 'reports' ? 'k-body k-body-reports' : current === 'products' ? 'k-body k-body-products' : current === 'warehouse' ? 'k-body k-body-warehouse' : 'k-body'}>
          {salesKeepAlive && (
            <div
              className="pos-host"
              style={salesActive ? undefined : { display: 'none' }}
              aria-hidden={!salesActive}
            >
            <CashierModule
                active={salesActive}
              embedded={!posFullscreen}
              theme={theme}
              onThemeChange={applyTheme}
              onSurfaceChange={setPosSurface}
              onDashboardBind={setPosDashboardApi}
              onExit={() => goTo(homePage)}
              onNavigate={p => goTo(p as TradePage)}
            />
            </div>
          )}
          {!salesActive && renderPage()}
        </div>
      </div>

      {!posFullscreen && (
        <nav className="k-bottom-nav" aria-label="Разделы">
          {MOB_QUICK.map(item => (
            <button
              key={item.id}
              type="button"
              className={current === item.id ? 'active' : ''}
              onClick={() => goTo(item.id)}
            >
              <span className="ic">{item.icon}</span>
              <span className="lbl">{item.label}</span>
            </button>
          ))}
        </nav>
      )}

      <MobileBarcodeScanner
        open={searchScanOpen}
        onClose={() => setSearchScanOpen(false)}
        onDetect={code => {
          const trimmed = String(code || '').trim()
          setSearchScanOpen(false)
          if (!trimmed) return
          setSearch(trimmed)
          window.setTimeout(focusTradeSearch, 0)
        }}
        title="Сканер товаров"
        hint="Наведите камеру на штрихкод товара"
      />
    </div>
  )
}

function TradeAppGate() {
  const [session, setSession] = useState<TradeEmployeeSession | null>(null)
  const [ready, setReady] = useState(false)
  const [theme, setTheme] = useState<TradeTheme>(() => loadTradeTheme())
  /** null = ещё проверяем диск; true = установка ок; false = нужен первый скач */
  const [localDbReady, setLocalDbReady] = useState<boolean | null>(null)
  const [deviceReady, setDeviceReady] = useState(() => !USE_API)
  const boundAtRef = useRef(0)

  useEffect(() => {
    if (!USE_API) return
    let stopped = false

    async function kickIfUnbound() {
      const started = Date.now()
      try {
        await ensureTradeDeviceReady()
        const deviceId = getTradeDeviceIdSync()
        if (!deviceId) return
        const check = await api.checkPosDevice(deviceId)
        if (stopped) return
        if (check.ok && check.point) return
        if (boundAtRef.current > started) return
        await clearTradeDeviceBind()
        clearTradeEmployeeSession()
        setSession(null)
        setDeviceReady(false)
      } catch {
        /* нет сети — локально не выгоняем */
      }
    }

    function onRevoked() {
      void kickIfUnbound()
    }
    window.addEventListener('kakapo:device-revoked', onRevoked)
    const timer = window.setInterval(() => { void kickIfUnbound() }, 6000)
    void kickIfUnbound()
    return () => {
      stopped = true
      window.clearInterval(timer)
      window.removeEventListener('kakapo:device-revoked', onRevoked)
    }
  }, [])

  useEffect(() => {
    try {
      if (isTradeAndroidNative()) document.documentElement.classList.add('kakapo-android')
      ;(window as Window & { __kakapoHideBoot?: () => void }).__kakapoHideBoot?.()
    } catch { /* ignore */ }
    void import('@/lib/hardwareBack').then(m => m.installHardwareBack()).catch(() => {})
    void import('@/lib/offlineV2').then(m => m.ensureDesktopLocalFirst()).catch(() => {})
    void hydrateOfflineCaches()
    useOfflineSync.getState().start()
    setSession(loadTradeEmployeeSession())
    setTheme(loadTradeTheme())
  }, [])

  useEffect(() => {
    if (isKakapoDesktop() || isTradeAndroidNative()) {
      void isLocalBootstrapComplete().then(done => {
        setLocalDbReady(done)
        if (done) {
          void import('@/lib/offlineBootstrap').then(m => m.silentSyncFromServer()).catch(() => {})
        }
      }).catch(() => {
        // IPC/диск тормозит — не держим чёрный экран, пускаем в логин
        setLocalDbReady(true)
      })
      // страховка: через 2.5с всё равно показываем UI
      window.setTimeout(() => {
        setLocalDbReady(prev => (prev === null ? true : prev))
      }, 2500)
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

  // Сначала привязка устройства — иначе чужой телефон не качает пароли
  if (!deviceReady) {
    return (
      <TradeDeviceGate
        theme={theme}
        onReady={() => {
          boundAtRef.current = Date.now()
          setDeviceReady(true)
        }}
      />
    )
  }

  // Пока данные не скачаны (товары + пароли) — только экран загрузки, без логина
  if ((isKakapoDesktop() || isTradeAndroidNative()) && localDbReady === false) {
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
    <ClientErrorBoundary title="Торговля временно недоступна">
      <TradeAppInner
        session={session}
        theme={theme}
        onThemeChange={applyTheme}
        onLogout={() => {
          clearTradeEmployeeSession()
          setSession(null)
        }}
      />
    </ClientErrorBoundary>
  )
}

export default function TradeApp() {
  return (
    <AppNavigationBoundary>
      <TradeAppGate />
    </AppNavigationBoundary>
  )
}
