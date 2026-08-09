'use client'

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApiSync } from '@/lib/useApiSync'
import { useOfflineSync } from '@/lib/offlineSync'
import { hydrateOfflineCaches } from '@/lib/offlineHydrate'
import { useAppNavigation } from '@/lib/useAppNavigation'
import AppNavigationBoundary from '@/components/shared/AppNavigationBoundary'
import { useProducts } from '@/lib/store'
import ProductsModule, { type ProductsSubPage } from '@/components/trade/ProductsModule'
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
  .k-cli-fab{display:none}
  .k-clients-mod{padding-bottom:4px}
  .k-cli-head-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .k-cli-sync{font-size:12px;color:var(--muted)}
  .k-cli-banner{margin-bottom:12px}
  .k-cli-err{
    margin-top:8px;padding:10px 14px;border-radius:10px;font-size:13px;
    background:var(--alert-error-bg);color:var(--red);border:1px solid var(--alert-error-border)
  }
  .k-cli-meta{display:none}
  .k-cli-toolbar{
    display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center
  }
  .k-cli-search{flex:1 1 220px;max-width:360px}
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
  .k-rev-scope-lbl{font-size:11px;color:var(--muted);font-weight:700;margin:0 0 6px}
  .k-rev-cats{margin-bottom:10px}
  .k-rev-stock-flt{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px}
  .k-rev-stock-flt .k-subtab{padding:5px 10px;font-size:11px;min-height:0}
  .k-rev-scope-sum{
    display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;
    padding:8px 10px;border-radius:10px;background:var(--card2);
    border:1px solid var(--border);margin-bottom:10px
  }
  .k-rev-scope-sum > span:first-child{font-size:11px;color:var(--muted);font-weight:700}
  .k-rev-scope-sum b{font-size:16px;font-weight:900}
  .k-rev-scope-sum-sub{font-size:11px;color:var(--muted);margin-left:auto}
  .k-rev-scope-hint{font-size:11px;color:var(--gold);margin:-4px 0 8px;text-align:center}
  .k-rev-scope-actions{display:grid;grid-template-columns:1fr 1.4fr;gap:6px;margin-top:auto}
  .k-rev-scope-actions .k-btn{min-height:36px;width:100%}
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
  .k-top{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border);background:var(--panel)}
  .k-top-back{flex-shrink:0;white-space:nowrap}
  .k-top-subtabs{display:flex;gap:6px;flex-shrink:0;align-items:center}
  .k-top-subtabs .k-subtab{padding:7px 12px;font-size:12px;margin:0}
  .k-top-search-wrap{flex:1;display:flex;justify-content:center;min-width:0}
  .k-top-search-wrap .k-search{flex:1;max-width:560px;width:100%}
  .k-top-end{display:flex;align-items:center;gap:12px;flex-shrink:0}
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
  .k-modal-fs-bg{padding:0;align-items:stretch;justify-content:stretch;z-index:90}
  .k-modal-fs{
    width:100%!important;max-width:100%!important;
    height:100vh!important;max-height:100vh!important;
    height:100dvh!important;max-height:100dvh!important;
    margin:0;border-radius:0;display:flex!important;flex-direction:column;overflow:hidden!important;min-height:0
  }
  .k-modal-fs > .k-modal-h{flex-shrink:0}
  .k-modal-fs > .k-modal-b{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column}
  .k-arrivals-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;flex-shrink:0}
  .k-arrivals-tbl-wrap{flex:1;min-height:0;overflow:auto;border:1px solid var(--border);border-radius:12px;background:var(--card)}
  .k-arrivals-tbl{width:100%;min-width:0;border-collapse:collapse}
  .k-arrivals-tbl th{
    text-align:left;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.03em;
    padding:10px 12px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--card);z-index:1;white-space:nowrap
  }
  .k-arrivals-tbl td{padding:10px 12px;border-bottom:1px solid var(--tbl-line);font-size:13px;vertical-align:middle}
  .k-arrivals-tbl .num{text-align:right;font-variant-numeric:tabular-nums}
  .k-arrivals-tbl tbody tr:hover{background:var(--hover)}
  .k-receipt-modal-bg{
    padding:0!important;align-items:stretch!important;justify-content:stretch!important;
    z-index:180;background:var(--bg)!important;inset:0
  }
  .k-trade[data-theme="light"] .k-receipt-modal-bg{background:var(--bg)!important}
  .k-receipt-modal{
    border-radius:0!important;width:100%!important;max-width:100%!important;
    height:100vh!important;max-height:100vh!important;
    height:100dvh!important;max-height:100dvh!important;
    margin:0!important;display:flex!important;flex-direction:column;overflow:hidden!important;min-height:0;
    background:var(--panel);border:none;box-shadow:none
  }
  .k-receipt-scroll{
    flex:1 1 auto!important;min-height:0!important;overflow-y:auto!important;overflow-x:hidden;
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
  .k-rcpt-line-qty .k-inp{text-align:center;font-weight:800;padding:8px 6px}
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
    display:grid;grid-template-columns:32px minmax(160px,1.2fr) repeat(5,minmax(72px,1fr)) 96px;
    gap:8px;padding:8px 10px;font-size:10px;font-weight:800;color:var(--muted);
    text-transform:uppercase;letter-spacing:.03em;border-bottom:1px solid var(--border);background:var(--card)
  }
  .k-rcpt-th > span:nth-child(n+3):nth-child(-n+7){text-align:center}
  .k-rcpt-tr{border-bottom:1px solid var(--tbl-line);background:var(--card)}
  .k-rcpt-tr:last-child{border-bottom:none}
  .k-rcpt-tr.is-open{background:rgba(31,215,96,.04)}
  .k-rcpt-tr-main{
    display:grid;grid-template-columns:32px minmax(160px,1.2fr) repeat(5,minmax(72px,1fr)) 96px;
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
  .k-rcpt-td.qty,.k-rcpt-td.cost,.k-rcpt-td.retail,.k-rcpt-td.sum,.k-rcpt-td.markup{
    font-size:12px;font-weight:800;font-variant-numeric:tabular-nums;text-align:center
  }
  .k-rcpt-td.sum{font-weight:900}
  .k-rcpt-td.markup b{font-weight:900}
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
    padding:12px 18px 16px;border-top:1px solid var(--border);background:var(--card)
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
    display:flex;flex-direction:row;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:10px;margin-bottom:12px
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
  .k-debts-list-b,.k-debts-detail-b{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;padding:6px 8px;overscroll-behavior:contain}
  .k-debts-row{display:flex;gap:8px;align-items:center;padding:8px 10px;border-radius:10px;border:1px solid transparent;cursor:pointer;margin-bottom:4px;background:var(--card2)}
  .k-debts-row:hover{border-color:var(--border)}
  .k-debts-row.active{border-color:var(--green);background:var(--green-d)}
  .k-debts-av{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;flex-shrink:0;background:rgba(31,215,96,.15);color:var(--green)}
  .k-debts-actions{display:flex;gap:8px;flex-wrap:wrap;padding:8px 10px;border-top:1px solid var(--border);background:var(--panel)}
  .k-debts-actions .k-btn{flex:1;min-width:100px;justify-content:center;min-height:36px;padding:8px 12px;font-size:12px}
  .k-debts-table{width:100%;border-collapse:collapse;font-size:12px}
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
  .k-hide-mob{display:block}
  .k-hide-desk{display:none}

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
    .k-hide-desk{display:block}
    .k-trade{flex-direction:column;height:auto;min-height:100vh;min-height:100dvh;overflow-x:hidden}
    .k-trade:has(.k-body-pos){height:100vh;height:100dvh;overflow:hidden}
    .k-trade:has(.k-body-pos) .k-main{height:100%!important;min-height:0!important;overflow:hidden;padding-bottom:0}
    .k-trade:has(.k-body-debts){height:100vh;height:100dvh;overflow:hidden}
    .k-trade:has(.k-body-debts) .k-main{
      height:100%!important;min-height:0!important;overflow:hidden;
      padding-bottom:calc(56px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column
    }
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
    .k-main{width:100%;height:auto!important;min-height:100vh;min-height:100dvh;overflow:visible;padding-bottom:calc(56px + env(safe-area-inset-bottom,0px))}
    .k-top{padding:10px 12px;gap:8px;flex-wrap:wrap}
    .k-top-subtabs{order:1;flex:1 1 auto;min-width:0;overflow-x:auto;scrollbar-width:none}
    .k-top-subtabs::-webkit-scrollbar{display:none}
    .k-top-subtabs.k-seg-tabs{
      order:3;flex:1 1 100%;width:100%;overflow:visible;min-width:0
    }
    .k-top-back{order:2;padding:8px 10px;font-size:12px}
    .k-top-end{order:2;gap:8px;margin-left:auto}
    .k-top-search-wrap{order:3;flex:1 1 100%;justify-content:stretch}
    .k-top-search-wrap .k-search{max-width:none}
    .k-search{max-width:none;min-width:0;flex:1 1 100%}
    .k-body-products{padding:4px 10px 8px;overflow:visible;flex:none;height:auto}
    .k-body-products > .k-products-mod,
    .k-products-mod-body,
    .k-products-mod-body > .k-product-edit-shell{flex:none;min-height:0;overflow:visible;height:auto}
    .k-body-warehouse{padding:4px 8px 6px;overflow:visible;flex:none;height:auto}
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
    .k-catalog-bar{flex-wrap:wrap;gap:6px}
    .k-catalog-filters{flex:1 1 100%;order:3}
    .k-filter-chip{flex:1 1 auto;min-width:calc(33.33% - 6px);padding:7px 8px}
    .k-catalog-add{margin-left:auto}
    .k-user .who{display:none}
    /* Весь раздел скроллится целиком — не внутренний «кусок» экрана */
    .k-body{padding:10px;overflow:visible;flex:none;height:auto;min-height:0;-webkit-overflow-scrolling:touch}
    .k-body-pos{
      overflow:hidden!important;flex:1 1 auto!important;min-height:0!important;
      height:calc(100dvh - 56px);max-height:calc(100dvh - 56px)
    }
    .k-body-debts{
      overflow:hidden!important;flex:1 1 auto!important;min-height:0!important;
      height:calc(100dvh - 56px - 56px - env(safe-area-inset-bottom,0px));
      max-height:calc(100dvh - 56px - 56px - env(safe-area-inset-bottom,0px));
      padding:12px;display:flex;flex-direction:column
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
    .k-wh-head{gap:4px;margin-bottom:6px}
    .k-wh-head .k-seg-tabs{margin-top:2px}
    .k-wh-head .k-catalog-meta{gap:6px}
    .k-wh-head .k-catalog-meta b{font-size:14px}
    .k-wh-head .k-catalog-meta span{display:none}
    .k-wh-head .k-btn{min-height:32px!important;padding:5px 8px!important;font-size:11px}
    .k-debts-list > div:first-child .k-subtabs{
      display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;
      overflow:visible;flex-wrap:nowrap;padding:0;margin-bottom:8px
    }
    .k-debts-list > div:first-child .k-subtabs .k-subtab{
      width:100%;justify-content:center;text-align:center;min-height:40px;padding:8px 4px;font-size:11px
    }
    .k-debts-layout{grid-template-columns:1fr;min-height:0;flex:1;gap:10px}
    .k-debts-layout.detail-open .k-debts-list{display:none}
    .k-debts-layout:not(.detail-open) .k-debts-detail{display:none}
    .k-debts-list,.k-debts-detail{min-height:0;height:100%;max-height:100%}
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
    .k-receipt-modal-bg{padding:0!important;align-items:stretch!important;justify-content:stretch!important;background:var(--bg)!important}
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
    .k-rcpt-table{border:none;background:transparent;overflow:visible;display:flex;flex-direction:column;gap:6px}
    .k-rcpt-tr{
      border:1px solid var(--border);border-radius:10px;background:var(--card);overflow:hidden
    }
    .k-rcpt-tr-main{
      display:grid;
      grid-template-columns:22px minmax(0,1fr) auto;
      grid-template-areas:
        "idx prod acts"
        "metrics metrics metrics";
      gap:5px;padding:7px
    }
    .k-rcpt-tr-main:hover{background:transparent}
    .k-rcpt-td.idx{grid-area:idx;align-self:start;padding-top:4px;font-size:11px}
    .k-rcpt-td.prod{grid-area:prod}
    .k-rcpt-td.prod .emo{width:28px;height:28px;font-size:14px;border-radius:7px}
    .k-rcpt-td.prod b{font-size:12px;white-space:normal;line-height:1.25}
    .k-rcpt-td.prod small{font-size:9px;white-space:normal;word-break:break-word;margin-top:0}
    .k-rcpt-td.acts{grid-area:acts;align-self:start;gap:2px}
    .k-rcpt-td.acts .k-btn{
      min-width:28px!important;min-height:28px!important;padding:0!important;font-size:12px;border-radius:7px
    }
    .k-rcpt-td-metrics{
      grid-area:metrics;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px
    }
    .k-rcpt-td.qty,
    .k-rcpt-td.cost,
    .k-rcpt-td.retail,
    .k-rcpt-td.sum,
    .k-rcpt-td.markup{
      display:flex;flex-direction:column;gap:1px;
      padding:5px 6px;border-radius:7px;background:var(--card2);border:1px solid var(--border);
      font-size:11px;font-weight:900;text-align:left;min-width:0
    }
    .k-rcpt-td.sum{grid-column:auto;text-align:left}
    .k-rcpt-td.qty::before,
    .k-rcpt-td.cost::before,
    .k-rcpt-td.retail::before,
    .k-rcpt-td.sum::before,
    .k-rcpt-td.markup::before{
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
    .k-wh-revisions .k-wh-panel-body{padding-bottom:64px}
    .k-wh-fab{
      display:flex!important;align-items:center;justify-content:center;
      position:fixed;right:14px;bottom:calc(58px + env(safe-area-inset-bottom,0px));
      z-index:140;width:52px;height:52px;border-radius:14px;border:none;
      background:linear-gradient(135deg,#1FD760,#14b24f);color:#05210D;
      font-size:28px;font-weight:900;line-height:1;cursor:pointer;
      box-shadow:0 8px 22px rgba(31,215,96,.4)
    }
    .k-wh-fab:disabled{opacity:.45;cursor:default;box-shadow:none}
    .k-wh-fab.has-draft::after{
      content:'';position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;
      background:var(--gold);box-shadow:0 0 0 2px rgba(255,184,0,.25)
    }
    .k-trade:has(.k-receipt-modal-bg) .k-wh-fab:not(.k-wo-fab):not(.k-rev-fab):not(.k-cli-fab){display:none!important}
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
    .k-rev-scope{padding:8px 10px 12px}
    .k-rev-scope-sum{padding:6px 8px;margin-bottom:8px}
    .k-rev-scope-sum b{font-size:14px}
    .k-rev-scope-actions{grid-template-columns:1fr 1.5fr;gap:6px}
    .k-rev-scroll{padding:8px 10px 72px}
    .k-rev-note{padding:0 0 6px;margin-bottom:6px}
    .k-rev-note-row{gap:5px}
    .k-rev-note-row .k-btn{min-height:34px;padding:5px 8px;font-size:11px}
    .k-rev-scope-chip{margin-top:4px}
    .k-rev-scope-chip > span{padding:3px 7px;font-size:10px}
    .k-rev-summary{gap:3px;padding:5px 6px;margin-bottom:6px}
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
    .k-top-net{display:flex;align-items:center}
    .k-wh-filters{flex-direction:column;align-items:stretch}
    .k-wh-filters-row{gap:6px}
    .k-wh-period{width:100%}
    .k-wh-period .k-inp{
      flex:1 1 calc(50% - 20px);min-width:0;max-width:none!important;
      min-height:36px!important;font-size:14px!important;padding:6px 8px!important
    }
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
    .k-clients-mod .k-cli-sub{display:none}
    .k-clients-mod .k-page-h{margin-bottom:8px}
    .k-clients-mod .k-page-h h1{font-size:16px}
    .k-cli-meta{
      display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;
      margin:0 0 8px;padding:6px 8px;border:1px solid var(--border);border-radius:10px;background:var(--card)
    }
    .k-cli-meta span{display:block;font-size:9px;color:var(--muted);font-weight:700}
    .k-cli-meta b{display:block;font-size:11px;font-weight:900;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .k-cli-toolbar{flex-direction:column;align-items:stretch;gap:6px;margin-bottom:8px}
    .k-cli-search{max-width:none;width:100%;min-height:36px!important;font-size:14px!important}
    .k-cli-list{gap:6px}
    .k-cli-row{padding:8px;gap:6px;border-radius:10px;flex-wrap:wrap}
    .k-cli-main{gap:7px}
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
    .k-cli-fab{
      display:flex!important;
      bottom:calc(58px + env(safe-area-inset-bottom,0px))
    }
    .k-clients-mod:has(.k-modal-bg) .k-cli-fab{display:none!important}
    .k-body:has(.k-receipt-modal-bg) .k-bottom-nav,
    .k-trade:has(.k-receipt-modal-bg) .k-bottom-nav{visibility:hidden;pointer-events:none}
    .k-trade:has(.k-receipt-modal-bg) .k-wh-cta{display:none!important}
    .k-bottom-nav{
      display:flex;position:fixed;bottom:0;left:0;right:0;z-index:150;
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

  @media (max-width:600px){
    .k-kpis{grid-template-columns:1fr 1fr}
    .k-receipt-summary{gap:8px}
    .k-theme-toggle{order:2}
    .k-user{padding:4px}
  }

  @media (max-width:480px){
    .k-kpis{grid-template-columns:1fr 1fr}
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

  if (compact) {
    return (
      <>
        <button
          type="button"
          className="k-online-chip"
          data-state={state}
          title={label}
          onClick={() => setQueueOpen(true)}
        >
          <span className="d" />
          <span className="t">{shortLabel}</span>
          {pending > 0 ? <span className="n">{pending}</span> : null}
        </button>
        {queueOpen && <OfflineQueuePanel onClose={() => setQueueOpen(false)} />}
      </>
    )
  }

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
  const [productsSub, setProductsSub] = useState<ProductsSubPage>('product')
  const [catalogBack, setCatalogBack] = useState<(() => void) | null>(null)
  const onBackToCatalogChange = useCallback((handler: (() => void) | null) => {
    setCatalogBack(() => handler)
  }, [])

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
    || (current === 'products' && productsSub === 'product')

  useEffect(() => {
    if (current === 'products' && (productsSub === 'category' || productsSub === 'labels')) {
      setSearch('')
    }
  }, [current, productsSub])

  useEffect(() => {
    if (current !== 'products' || productsSub !== 'labels') return
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
    const el = searchInputRef.current
    if (!el) return
    try { el.focus({ preventScroll: true }) } catch { el.focus() }
  }

  function tradeSearchBlocked() {
    if (catalogBack) return true
    if (document.querySelector('.modal-card, .overlay, .k-modal, .k-modal-bg')) return true
    return false
  }

  useEffect(() => {
    if (!showSearch) return
    setSearch('')
    const t = window.setTimeout(focusTradeSearch, 40)
    return () => window.clearTimeout(t)
  }, [current, showSearch])

  useEffect(() => {
    if (!showSearch || catalogBack) return
    const t = window.setTimeout(focusTradeSearch, 40)
    return () => window.clearTimeout(t)
  }, [catalogBack, showSearch])

  // Товар/Склад: курсор всегда в поиске (сканер / повторный клик по окну)
  useEffect(() => {
    if (!showSearch) return

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
    if (current === 'suppliers') return <SuppliersModule />
    if (current === 'clients') return <ClientsModule />
    if (current === 'debts') return <DebtsModule onNavigate={p => goTo(p as TradePage)} />
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
            {catalogBack ? (
              <button type="button" className="k-btn k-btn-s k-top-back" onClick={catalogBack}>
                ← К каталогу
              </button>
            ) : null}
            {current === 'products' && !catalogBack ? (
              <div className="k-top-subtabs k-seg-tabs" role="tablist" aria-label="Разделы товаров">
                {PRODUCTS_SUBS.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={productsSub === item.id}
                    className={`k-subtab ${productsSub === item.id ? 'active' : ''}`}
                    onClick={() => {
                      setProductsSub(item.id)
                      if (item.id === 'labels') {
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
            {showSearch ? (
              <div className="k-top-search-wrap">
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
              </div>
            ) : current === 'products' ? (
              <div className="k-top-search-wrap" aria-hidden />
            ) : (
              <div style={{ flex: 1, fontWeight: 800, color: 'var(--text)', minWidth: 0 }}>
                {current === 'debts' ? (
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 900, lineHeight: 1.2 }}>💳 Долги клиентов</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginTop: 2 }}>
                      Товары (чеки) и наличные (ручные)
                    </div>
                  </div>
                ) : (
                  <span style={{ color: 'var(--muted)' }}>{NAV.find(n => n.id === current)?.label}</span>
                )}
              </div>
            )}
            <div className="k-top-end">
              <div className="k-top-net k-hide-desk">
                <NetworkStatus compact />
              </div>
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
            </div>
          </header>
        )}

        <div className={salesActive ? 'k-body k-body-pos' : debtsActive ? 'k-body k-body-debts' : current === 'products' ? 'k-body k-body-products' : current === 'warehouse' ? 'k-body k-body-warehouse' : 'k-body'}>
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
                onExit={() => goTo(homePage)}
                onNavigate={p => goTo(p as TradePage)}
              />
            </div>
          )}
          {!salesActive && renderPage()}
        </div>
      </div>

      {!posFullscreen && MOB_QUICK.length > 0 && (
        <nav className="k-bottom-nav k-hide-desk" aria-label="Разделы">
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
