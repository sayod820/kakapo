'use client'
import { useState, useMemo, useEffect, useRef } from 'react'
import { useProducts } from '@/lib/store'
import { api } from '@/lib/api'
import type { TillShift } from '@/lib/api'
import type { Product, Order } from '@/lib/types'
import { useCards, hydrateCardStore } from '@/lib/cardStore'
import { useClients, hydrateClientStore } from '@/lib/clientStore'
import { mergeCardsWithClients, type AdminCard } from '@/lib/cardCrm'
import { phonesMatch } from '@/lib/clientCrm'
import { isWeighted, nextCartQty, calcLineTotal, formatCartQty, orderItemFromProduct } from '@/lib/productWeight'

const LEVEL_LABEL: Record<string, string> = { basic: 'Базовый', bronze: 'Бронза', silver: 'Серебро', gold: 'Золото', platinum: 'Платина' }
const LEVEL_COLOR: Record<string, string> = { basic: '#8FB897', bronze: '#CD7F32', silver: '#B8C4CC', gold: '#FFD700', platinum: '#9B6DFF' }

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@600;700;800;900&family=Nunito:wght@400;600;700;800;900&family=JetBrains+Mono:wght@500;700;800&display=swap');
  .till-root{--bg:#030B05;--surface:#0A1710;--surface2:#0F2216;--border:#1A3322;--border2:#234430;--gr:#1FD760;--gr2:#17B34E;--gd:#FFB800;--org:#FF8C00;--blue:#3B8EF0;--pur:#9B6DFF;--red:#FF4545;--t1:#F1FBF3;--t2:#8FB897;--t3:#3D6645;
    position:fixed;inset:0;z-index:400;background:var(--bg);color:var(--t1);font-family:'Nunito',sans-serif;-webkit-font-smoothing:antialiased;display:flex;overflow:hidden;}
  .till-root *,.till-root *::before,.till-root *::after{box-sizing:border-box;}
  .till-root .ub{font-family:'Unbounded',sans-serif;}
  .till-root .mono{font-family:'JetBrains Mono',monospace;}
  .till-root button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit;}
  .till-root input,.till-root select{font-family:inherit;color:inherit;}
  .till-root ::-webkit-scrollbar{width:6px;height:6px;}
  .till-root ::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px;}
  @keyframes tPop{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}
  @keyframes tTileIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  @keyframes tRowIn{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}
  @keyframes tFade{from{opacity:0}to{opacity:1}}
  @keyframes tWeigh{0%{transform:translateY(0)}100%{transform:translateY(-2px)}}

  .t-gate{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:20;}
  .t-gate-card{width:400px;background:var(--surface);border:1px solid var(--border);border-radius:26px;padding:34px 30px;animation:tPop .3s cubic-bezier(.16,1,.3,1);}
  .t-gate-logo{width:52px;height:52px;border-radius:17px;background:linear-gradient(135deg,#0F8A3A,var(--gr));display:flex;align-items:center;justify-content:center;font-family:'Unbounded';font-weight:900;font-size:22px;color:var(--bg);margin:0 auto 14px;}
  .t-gate-title{font-family:'Unbounded';font-size:17px;font-weight:800;text-align:center;margin-bottom:4px;}
  .t-gate-sub{font-size:12px;color:var(--t2);text-align:center;margin-bottom:24px;}
  .t-field{margin-bottom:16px;}
  .t-field label{font-size:11px;font-weight:700;color:var(--t2);margin-bottom:7px;display:block;}
  .t-input{width:100%;background:var(--surface2);border:1.5px solid var(--border);border-radius:14px;padding:13px 15px;font-size:14px;font-weight:700;color:var(--t1);outline:none;font-family:'JetBrains Mono';}
  .t-input:focus{border-color:var(--gr);}
  .t-btn-primary{width:100%;padding:15px;border-radius:15px;background:linear-gradient(135deg,var(--gr2),var(--gr));color:var(--bg);font-weight:800;font-size:14px;box-shadow:0 10px 26px rgba(31,215,96,.25);}
  .t-btn-primary:hover{filter:brightness(1.06);}
  .t-btn-primary:disabled{opacity:.4;box-shadow:none;}

  /* ── Left: catalog ── */
  .t-catalog{flex:1;display:flex;flex-direction:column;min-width:0;height:100vh;}
  .t-topbar{display:flex;align-items:center;gap:12px;padding:16px 22px 10px;flex-shrink:0;}
  .t-search{flex:1;max-width:520px;display:flex;align-items:center;gap:10px;background:var(--surface);border:1.5px solid var(--border);border-radius:15px;padding:12px 16px;}
  .t-search.active{border-color:var(--gr);box-shadow:0 0 0 3px rgba(31,215,96,.12);}
  .t-search .ic{color:var(--t2);font-size:14px;}
  .t-search input{flex:1;background:none;border:none;outline:none;font-size:13.5px;color:var(--t1);}
  .t-search input::placeholder{color:var(--t3);}
  .t-scan-btn{width:38px;height:38px;border-radius:11px;background:var(--surface2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--t2);flex-shrink:0;}
  .t-chips{display:flex;align-items:center;gap:6px;margin-left:auto;}
  .t-chip{position:relative;width:36px;height:36px;border-radius:11px;background:var(--surface);border:1.5px solid var(--border);display:flex;align-items:center;justify-content:center;font-family:'Unbounded';font-weight:800;font-size:12px;color:var(--t2);}
  .t-chip.active{border-color:var(--gr);background:rgba(31,215,96,.14);color:var(--gr);}
  .t-chip .cnt{position:absolute;top:-5px;right:-5px;min-width:15px;height:15px;padding:0 3px;border-radius:8px;background:var(--gd);color:#241900;font-size:9px;font-weight:900;display:flex;align-items:center;justify-content:center;}
  .t-chip .rm{position:absolute;bottom:-5px;right:-5px;width:14px;height:14px;border-radius:50%;background:var(--red);color:white;font-size:8px;display:none;align-items:center;justify-content:center;}
  .t-chip:hover .rm{display:flex;}
  .t-chip-add{width:36px;height:36px;border-radius:11px;background:var(--surface);border:1.5px dashed var(--border2);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;color:var(--t2);}
  .t-cashier{display:flex;align-items:center;gap:9px;padding:6px 12px 6px 6px;border-radius:14px;background:var(--surface);border:1.5px solid var(--border);flex-shrink:0;}
  .t-cashier .av{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#1E5BB5,var(--blue));display:flex;align-items:center;justify-content:center;font-family:'Unbounded';font-weight:800;font-size:11px;flex-shrink:0;}
  .t-cashier .info{line-height:1.15;}
  .t-cashier .info b{font-size:11.5px;display:block;}
  .t-cashier .info span{font-size:9px;color:var(--t3);}
  .t-btn-end{padding:9px 15px;border-radius:12px;background:rgba(255,69,69,.1);border:1px solid rgba(255,69,69,.28);color:var(--red);font-size:11px;font-weight:700;flex-shrink:0;}
  .t-btn-end:hover{background:rgba(255,69,69,.16);}
  .t-btn-close{width:36px;height:36px;border-radius:11px;background:var(--surface);border:1.5px solid var(--border);color:var(--t2);font-size:15px;flex-shrink:0;}
  .t-btn-close:hover{color:var(--t1);border-color:var(--border2);}

  .t-cats{display:flex;gap:10px;padding:8px 22px 14px;overflow-x:auto;flex-shrink:0;}
  .t-cat{display:flex;flex-direction:column;align-items:center;gap:7px;padding:12px 18px;border-radius:16px;font-size:11.5px;font-weight:700;background:var(--surface);border:1.5px solid var(--border);color:var(--t2);white-space:nowrap;flex-shrink:0;min-width:76px;}
  .t-cat .emj{font-size:19px;}
  .t-cat.on{background:linear-gradient(135deg,var(--gr2),var(--gr));border-color:var(--gr);color:var(--bg);box-shadow:0 8px 20px rgba(31,215,96,.25);}

  .t-grid-wrap{flex:1;overflow-y:auto;padding:6px 22px 24px;}
  .t-p-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:14px;}
  .t-p-tile{position:relative;background:var(--surface);border:1.5px solid var(--border);border-radius:18px;padding:0;text-align:left;transition:border-color .15s,transform .1s;overflow:hidden;animation:tTileIn .2s ease both;display:flex;flex-direction:column;}
  .t-p-tile:hover{border-color:var(--gr);transform:translateY(-2px);}
  .t-p-img{height:76px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:34px;position:relative;}
  .t-p-body{padding:11px 13px 13px;}
  .t-p-name{font-size:12px;font-weight:700;line-height:1.3;margin-bottom:7px;min-height:31px;color:var(--t1);}
  .t-p-stock{font-size:10px;color:var(--t3);margin-bottom:8px;}
  .t-p-stock.low{color:var(--org);font-weight:700;}
  .t-p-price-row{display:flex;align-items:baseline;justify-content:space-between;}
  .t-p-price{font-family:'JetBrains Mono';font-size:16px;font-weight:900;color:var(--gr);line-height:1;}
  .t-p-unit{font-size:9px;color:var(--t3);font-weight:700;}
  .t-p-badge{position:absolute;top:8px;right:8px;font-size:8.5px;font-weight:800;padding:3px 7px;border-radius:7px;background:rgba(155,109,255,.85);color:white;}
  .t-p-low-badge{position:absolute;top:8px;left:8px;font-size:8px;font-weight:800;color:white;background:var(--red);padding:2px 7px;border-radius:6px;}

  /* ── Right: permanent cart panel ── */
  .t-cartpanel{width:380px;flex-shrink:0;background:var(--surface);border-left:1px solid var(--border);display:flex;flex-direction:column;height:100vh;}
  .t-cart-client{margin:16px 16px 0;padding:13px 15px;border-radius:16px;background:var(--surface2);border:1.5px solid var(--border);cursor:pointer;transition:border-color .15s;}
  .t-cart-client:hover{border-color:var(--border2);}
  .t-cart-client-empty{display:flex;align-items:center;gap:10px;color:var(--t2);font-size:12.5px;font-weight:700;}
  .t-cart-client-head{display:flex;align-items:center;gap:10px;}
  .t-cart-client .av{width:36px;height:36px;border-radius:11px;background:linear-gradient(135deg,#0F8A3A,var(--gr));display:flex;align-items:center;justify-content:center;font-family:'Unbounded';font-weight:800;font-size:13px;color:var(--bg);flex-shrink:0;}
  .t-cart-client .ci{flex:1;min-width:0;}
  .t-cart-client .ci b{font-size:13px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .t-cart-client .ci span{font-size:10.5px;color:var(--t2);}
  .t-cart-client .x{color:var(--t3);font-size:13px;flex-shrink:0;}
  .t-cart-client .x:hover{color:var(--red);}
  .t-tier-pill{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:9px;font-size:10px;font-weight:800;margin-top:8px;}
  .t-bonus-pill{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:9px;font-size:10px;font-weight:800;margin-top:8px;margin-left:6px;background:rgba(255,184,0,.14);color:var(--gd);}

  .t-cart-list{flex:1;overflow-y:auto;padding:12px 16px;}
  .t-cart-empty{text-align:center;color:var(--t3);padding:60px 16px;font-size:12.5px;}
  .t-cart-empty .ic{font-size:40px;opacity:.5;margin-bottom:10px;}
  .t-cart-row{display:flex;align-items:center;gap:10px;padding:9px 6px;border-radius:13px;animation:tRowIn .18s ease both;}
  .t-cart-row:hover{background:var(--surface2);}
  .t-cart-row .ic{width:38px;height:38px;border-radius:11px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;}
  .t-cart-row .info{flex:1;min-width:0;}
  .t-cart-row .name{font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .t-cart-row .sub{font-size:9.5px;color:var(--t3);margin-top:1px;}
  .t-qtyctrl{display:flex;align-items:center;gap:6px;background:var(--surface2);border-radius:9px;padding:3px;flex-shrink:0;}
  .t-qtyctrl button{width:20px;height:20px;border-radius:6px;font-size:13px;font-weight:800;color:var(--t2);display:flex;align-items:center;justify-content:center;}
  .t-qtyctrl button:hover{background:var(--border2);color:var(--t1);}
  .t-qtyctrl span{font-size:11px;font-weight:800;min-width:14px;text-align:center;font-family:'JetBrains Mono';}
  .t-cart-row .price{font-family:'JetBrains Mono';font-size:13px;font-weight:900;color:var(--t1);flex-shrink:0;min-width:56px;text-align:right;}
  .t-cart-row .rm{width:22px;height:22px;border-radius:7px;color:var(--t3);font-size:11px;flex-shrink:0;}
  .t-cart-row .rm:hover{background:rgba(255,69,69,.12);color:var(--red);}

  .t-cart-footer{border-top:1px solid var(--border);padding:14px 16px 18px;flex-shrink:0;}
  .t-tot-row{display:flex;justify-content:space-between;font-size:12px;color:var(--t2);margin-bottom:6px;}
  .t-tot-row.disc span:last-child{color:var(--red);}
  .t-tot-row.bonus span:last-child{color:var(--gd);}
  .t-tot-final{display:flex;justify-content:space-between;align-items:baseline;padding-top:10px;margin-top:2px;margin-bottom:12px;border-top:1px dashed var(--border);}
  .t-tot-final b{font-family:'Unbounded';font-size:13px;}
  .t-tot-final .sum{font-family:'JetBrains Mono';font-size:24px;font-weight:900;color:var(--gr);}

  .t-action-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-bottom:8px;}
  .t-action-btn{display:flex;flex-direction:column;align-items:center;gap:5px;padding:10px 4px;border-radius:13px;background:var(--surface2);border:1.5px solid var(--border);font-size:10px;font-weight:700;color:var(--t2);}
  .t-action-btn .ic{font-size:16px;}
  .t-action-btn.on{border-color:var(--gd);background:rgba(255,184,0,.12);color:var(--gd);}
  .t-action-row2{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:11px;}
  .t-btn-debt{display:flex;align-items:center;justify-content:center;gap:7px;padding:11px 6px;border-radius:13px;background:rgba(255,69,69,.1);border:1.5px solid rgba(255,69,69,.25);color:var(--red);font-size:11.5px;font-weight:800;}
  .t-btn-debt.on{background:var(--red);color:white;border-color:var(--red);}
  .t-btn-clear{display:flex;align-items:center;justify-content:center;gap:7px;padding:11px 6px;border-radius:13px;background:var(--surface2);border:1.5px solid var(--border);color:var(--t2);font-size:11.5px;font-weight:800;}
  .t-btn-clear:hover{color:var(--red);border-color:rgba(255,69,69,.28);}

  .t-pay-row{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:11px;}
  .t-pm{padding:12px 6px;border-radius:13px;border:1.5px solid var(--border);background:var(--surface2);text-align:center;display:flex;flex-direction:column;align-items:center;gap:4px;}
  .t-pm .ic{font-size:17px;}
  .t-pm span{font-size:11px;font-weight:700;color:var(--t2);}
  .t-pm.on[data-m="cash"]{border-color:var(--gr);background:var(--gr);}
  .t-pm.on[data-m="cash"] span{color:var(--bg);}
  .t-pm.on[data-m="card"]{border-color:var(--blue);background:var(--blue);}
  .t-pm.on[data-m="card"] span{color:white;}
  .t-btn-checkout{width:100%;padding:17px;border-radius:15px;background:linear-gradient(135deg,var(--gr2),var(--gr));color:var(--bg);font-weight:800;font-size:14.5px;display:flex;align-items:center;justify-content:center;gap:9px;box-shadow:0 12px 28px rgba(31,215,96,.3);}
  .t-btn-checkout:disabled{opacity:.35;box-shadow:none;}
  .t-history-link{display:block;text-align:center;margin-top:9px;font-size:10.5px;color:var(--t3);font-weight:700;}
  .t-history-link:hover{color:var(--t1);}

  .t-overlay{position:fixed;inset:0;background:rgba(3,11,5,.75);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:200;padding:20px;}
  .t-scale-card{width:300px;background:var(--surface);border:1.5px solid var(--border);border-radius:22px;padding:22px;text-align:center;animation:tPop .22s ease;}
  .t-scale-card .emoji{font-size:38px;margin-bottom:8px;}
  .t-scale-card h3{font-family:'Unbounded';font-size:13.5px;font-weight:800;margin-bottom:3px;}
  .t-scale-card p{font-size:11px;color:var(--t2);margin-bottom:14px;}
  .t-scale-display{background:var(--surface2);border:1px solid var(--border);border-radius:15px;padding:15px;margin-bottom:12px;}
  .t-scale-num{font-family:'JetBrains Mono';font-size:26px;font-weight:700;color:var(--gr);animation:tWeigh .3s ease infinite alternate;}
  .t-scale-num.done{animation:none;color:var(--gd);}
  .t-scale-label{font-size:9px;color:var(--t3);margin-top:3px;letter-spacing:1px;}
  .t-scale-price{font-family:'JetBrains Mono';font-size:19px;font-weight:900;color:var(--gd);margin-top:6px;}

  .t-modal{width:360px;background:var(--surface);border:1.5px solid var(--border);border-radius:22px;padding:22px;animation:tPop .22s ease;max-height:85vh;overflow-y:auto;}
  .t-modal.wide{width:440px;}
  .t-modal h3{font-family:'Unbounded';font-size:13.5px;font-weight:800;margin-bottom:14px;}
  .t-modal-input{width:100%;background:var(--surface2);border:1.5px solid var(--border);border-radius:14px;padding:11px 14px;font-size:13px;color:var(--t1);outline:none;margin-bottom:11px;}
  .t-modal-input:focus{border-color:var(--blue);}
  .t-client-result{padding:10px;border-radius:14px;background:var(--surface2);border:1px solid var(--border);display:flex;align-items:center;gap:9px;margin-bottom:10px;cursor:pointer;}
  .t-client-result:hover{border-color:var(--gr);}
  .t-client-result .av{width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,#0F8A3A,var(--gr));display:flex;align-items:center;justify-content:center;font-family:'Unbounded';font-weight:800;font-size:11px;color:var(--bg);flex-shrink:0;}
  .t-client-result .ci{flex:1;line-height:1.25;}
  .t-client-result .ci b{font-size:12px;display:block;}
  .t-client-result .ci span{font-size:9.5px;color:var(--t2);}
  .t-modal-actions{display:flex;gap:8px;}
  .t-modal-actions button{flex:1;padding:12px;border-radius:14px;font-weight:800;font-size:11.5px;}
  .t-btn-cancel{background:var(--surface2);color:var(--t2);border:1px solid var(--border);}
  .t-btn-confirm{background:var(--gr);color:var(--bg);}
  .t-btn-confirm:disabled{opacity:.3;background:var(--border2);color:var(--t3);}

  .t-kp-display{background:var(--surface2);border:1.5px solid var(--border);border-radius:15px;padding:15px;text-align:center;margin-bottom:13px;}
  .t-kp-display .lbl{font-size:9.5px;color:var(--t3);letter-spacing:.5px;margin-bottom:4px;}
  .t-kp-display .val{font-family:'JetBrains Mono';font-size:27px;font-weight:800;}
  .t-kp-change{margin-top:7px;padding-top:7px;border-top:1px dashed var(--border);display:flex;justify-content:space-between;font-size:11.5px;}
  .t-kp-change b{font-family:'JetBrains Mono';}
  .t-kp-quick{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:9px;}
  .t-kp-quick button{padding:8px 4px;border-radius:10px;background:var(--surface2);border:1px solid var(--border);font-size:10.5px;font-weight:700;color:var(--t2);}
  .t-keypad{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:13px;}
  .t-keypad button{padding:13px;border-radius:12px;background:var(--surface2);border:1px solid var(--border);font-family:'JetBrains Mono';font-size:16px;font-weight:700;}
  .t-keypad button:hover{background:var(--border2);}
  .t-keypad button.clear{color:var(--red);font-family:'Nunito';font-size:11px;font-weight:800;}

  .t-print-slot{position:relative;width:200px;height:230px;overflow:hidden;margin:0 auto 6px;}
  .t-paper{position:absolute;left:50%;top:10px;transform:translateX(-50%);width:180px;background:#F3EFE3;border-radius:2px;padding:14px 12px;box-shadow:0 10px 30px rgba(0,0,0,.4);}
  .t-paper *{color:#2A2620;font-family:'JetBrains Mono';}
  .t-paper .h{text-align:center;font-family:'Unbounded';font-size:10px;font-weight:800;margin-bottom:2px;}
  .t-paper .s{text-align:center;font-size:8px;opacity:.7;margin-bottom:7px;}
  .t-paper .d{border-top:1px dashed rgba(42,38,32,.4);margin:5px 0;}
  .t-paper .l{display:flex;justify-content:space-between;font-size:8.5px;margin-bottom:2px;}
  .t-paper .tt{display:flex;justify-content:space-between;font-size:11px;font-weight:800;margin-top:3px;}
  .t-print-status{text-align:center;font-size:11.5px;color:var(--t2);font-weight:700;}
  .t-print-status .done{color:var(--gr);}

  .t-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--surface);border:1.5px solid var(--gr);border-radius:17px;padding:13px 19px;display:flex;align-items:center;gap:10px;box-shadow:0 14px 32px rgba(0,0,0,.5);z-index:300;animation:tPop .25s ease;}
  .t-toast .ic{width:32px;height:32px;border-radius:10px;background:rgba(31,215,96,.15);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;}
  .t-toast b{font-size:12.5px;display:block;}
  .t-toast span{font-size:10px;color:var(--t2);}

  .t-hist-row{display:flex;justify-content:space-between;align-items:center;padding:9px 5px;border-bottom:1px solid var(--border);font-size:11.5px;cursor:pointer;}
  .t-hist-row:hover{background:var(--surface2);border-radius:9px;}
  .t-hist-row .time{color:var(--t3);font-family:'JetBrains Mono';font-size:10px;width:42px;flex-shrink:0;}
  .t-hist-row .meth{font-size:9.5px;padding:2px 7px;border-radius:7px;margin-left:6px;flex-shrink:0;}
  .t-hist-row .meth.cash{background:rgba(31,215,96,.12);color:var(--gr);}
  .t-hist-row .meth.card{background:rgba(59,142,240,.12);color:var(--blue);}
  .t-hist-row .meth.credit{background:rgba(255,184,0,.12);color:var(--gd);}
  .t-hist-row .sum{font-family:'JetBrains Mono';font-weight:800;color:var(--gd);margin-left:auto;}
  .t-hist-row .st{font-size:8.5px;padding:2px 6px;border-radius:6px;margin-left:6px;flex-shrink:0;}
  .t-hist-row .st.cancelled{background:var(--border2);color:var(--t3);text-decoration:line-through;}

  .t-z-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:14px;}
  .t-z-stat{background:var(--surface2);border:1px solid var(--border);border-radius:14px;padding:12px;}
  .t-z-stat .l{font-size:9px;color:var(--t3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:5px;}
  .t-z-stat .v{font-family:'JetBrains Mono';font-size:16px;font-weight:800;}
`

type PayMethod = 'cash' | 'card' | 'debt'
interface TicketState {
  cart: Record<number, number>
  client: AdminCard | null
  bonusUsed: number
  discountPct: number
  pay: PayMethod
}
function emptyTicket(): TicketState { return { cart: {}, client: null, bonusUsed: 0, discountPct: 0, pay: 'cash' } }

function money(n: number): string { return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2) }

export default function RetailTill({ locationId, locationName, onClose }: { locationId: string; locationName: string; onClose: () => void }) {
  const products = useProducts(s => s.products)
  const fetchProducts = useProducts(s => s.fetchProducts)
  const cardsRaw = useCards()
  const clients = useClients()

  const [cashierName, setCashierName] = useState('')
  const [openingCashInput, setOpeningCashInput] = useState('200')
  const [shift, setShift] = useState<TillShift | null | undefined>(undefined)
  const [gateBusy, setGateBusy] = useState(false)
  const [gateErr, setGateErr] = useState('')

  useEffect(() => {
    void fetchProducts()
    hydrateCardStore()
    hydrateClientStore()
  }, [fetchProducts])

  const cards = useMemo(() => mergeCardsWithClients(cardsRaw, clients), [cardsRaw, clients])

  const openShift = async () => {
    if (!cashierName.trim()) { setGateErr('Укажите имя кассира'); return }
    setGateBusy(true); setGateErr('')
    try {
      const s = await api.openTillShift({ locationId, cashierName: cashierName.trim(), openingCash: Number(openingCashInput) || 0 })
      setShift(s)
    } catch (e) {
      setGateErr(e instanceof Error ? e.message : 'Не удалось открыть смену')
    } finally { setGateBusy(false) }
  }

  if (shift === null || shift === undefined) {
    return (
      <div className="till-root">
        <style>{CSS}</style>
        <div className="t-gate">
          <div className="t-gate-card">
            <div className="t-gate-logo">K</div>
            <div className="t-gate-title">Открытие смены</div>
            <div className="t-gate-sub">KAKAPO Касса · {locationName}</div>
            <div className="t-field"><label>Кто работает?</label><input className="t-input" style={{ fontFamily: 'inherit', fontWeight: 700 }} value={cashierName} onChange={e => setCashierName(e.target.value)} placeholder="Имя кассира" /></div>
            <div className="t-field"><label>Наличные в кассе на начало смены</label><input className="t-input" type="number" value={openingCashInput} onChange={e => setOpeningCashInput(e.target.value)} /></div>
            {gateErr && <div style={{ fontSize: 12, color: 'var(--red)', fontWeight: 700, marginBottom: 12 }}>{gateErr}</div>}
            <button className="t-btn-primary" onClick={openShift} disabled={gateBusy}>{gateBusy ? 'Открываем...' : '🔓 Открыть смену'}</button>
            <button onClick={onClose} style={{ width: '100%', textAlign: 'center', marginTop: 12, fontSize: 11.5, color: 'var(--t3)', fontWeight: 700 }}>← Назад в Ритейл</button>
          </div>
        </div>
      </div>
    )
  }

  return <TillMain locationId={locationId} locationName={locationName} shift={shift} cashierName={cashierName}
    products={products} cards={cards}
    onShiftClosed={() => setShift(null)} onClose={onClose} />
}

function TillMain({ locationId, locationName, shift, cashierName, products, cards, onShiftClosed, onClose }: {
  locationId: string; locationName: string; shift: TillShift; cashierName: string
  products: Product[]; cards: AdminCard[]
  onShiftClosed: () => void; onClose: () => void
}) {
  const ticketSeq = useRef(1)
  const [tickets, setTickets] = useState<Record<string, TicketState>>({ T1: emptyTicket() })
  const [ticketOrder, setTicketOrder] = useState<string[]>(['T1'])
  const [activeTicketId, setActiveTicketId] = useState('T1')

  const newTicket = () => {
    ticketSeq.current += 1
    const id = `T${ticketSeq.current}`
    setTickets(t => ({ ...t, [id]: emptyTicket() }))
    setTicketOrder(o => [...o, id])
    setActiveTicketId(id)
  }
  const closeTicket = (id: string) => {
    setTicketOrder(o => {
      const next = o.filter(x => x !== id)
      if (next.length === 0) {
        ticketSeq.current += 1
        const freshId = `T${ticketSeq.current}`
        setTickets({ [freshId]: emptyTicket() })
        setActiveTicketId(freshId)
        return [freshId]
      }
      setTickets(t => { const n = { ...t }; delete n[id]; return n })
      if (activeTicketId === id) setActiveTicketId(next[0])
      return next
    })
  }
  const patchTicket = (id: string, patch: Partial<TicketState> | ((t: TicketState) => Partial<TicketState>)) => {
    setTickets(t => ({ ...t, [id]: { ...t[id], ...(typeof patch === 'function' ? patch(t[id]) : patch) } }))
  }
  const activeTicket = tickets[activeTicketId] || emptyTicket()
  const patchActive = (patch: Partial<TicketState> | ((t: TicketState) => Partial<TicketState>)) => patchTicket(activeTicketId, patch)

  const [search, setSearch] = useState('')
  const [catFlt, setCatFlt] = useState('all')
  const [searchFocused, setSearchFocused] = useState(false)
  const [scaleProduct, setScaleProduct] = useState<Product | null>(null)
  const [clientModal, setClientModal] = useState(false)
  const [clientQuery, setClientQuery] = useState('')
  const [discModal, setDiscModal] = useState(false)
  const [discBuf, setDiscBuf] = useState('')
  const [cashModal, setCashModal] = useState(false)
  const [cashBuf, setCashBuf] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [printing, setPrinting] = useState<{ order: Order } | null>(null)
  const [toast, setToast] = useState<{ title: string; sub: string } | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [receipts, setReceipts] = useState<Order[]>([])
  const [detailOrder, setDetailOrder] = useState<Order | null>(null)
  const [zOpen, setZOpen] = useState(false)
  const [closingCash, setClosingCash] = useState('')
  const [zResult, setZResult] = useState<TillShift | null>(null)
  const [zBusy, setZBusy] = useState(false)
  const scanRef = useRef<HTMLInputElement>(null)

  const reloadReceipts = () => { void api.getTillReceipts(shift.id).then(setReceipts).catch(() => {}) }
  useEffect(() => { reloadReceipts() }, [shift.id])

  const cats = useMemo(() => {
    const map = new Map<string, { name: string; emoji: string }>()
    for (const p of products) if (p.catId && !map.has(p.catId)) map.set(p.catId, { name: p.cat || p.catId, emoji: p.e })
    return Array.from(map.entries()).map(([id, v]) => ({ id, ...v }))
  }, [products])

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter(p => {
      const matchC = catFlt === 'all' || p.catId === catFlt
      const matchQ = !q || p.name.toLowerCase().includes(q) || (p.art || '').toLowerCase().includes(q)
      return matchC && matchQ
    })
  }, [products, search, catFlt])

  const cartLines = useMemo(() => {
    return Object.entries(activeTicket.cart)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => ({ product: products.find(p => p.id === Number(id))!, qty }))
      .filter(l => l.product)
  }, [activeTicket.cart, products])

  const subtotal = useMemo(() => Math.round(cartLines.reduce((s, l) => s + calcLineTotal(l.product, l.qty), 0) * 100) / 100, [cartLines])
  const discountAmt = Math.round(subtotal * (activeTicket.discountPct / 100) * 100) / 100
  const goodsTotal = Math.max(0, Math.round((subtotal - discountAmt) * 100) / 100)
  const selectedClient = activeTicket.client
  const bonusUsable = selectedClient ? Math.min(Number(selectedClient.bonus) || 0, goodsTotal) : 0
  const bonusApplied = Math.min(activeTicket.bonusUsed, bonusUsable)
  const payable = Math.max(0, Math.round((goodsTotal - bonusApplied) * 100) / 100)

  const addToCart = (p: Product, qty?: number) => {
    patchActive(t => {
      const current = t.cart[p.id] || 0
      const next = qty != null ? current + qty : nextCartQty(p, current, true)
      return { cart: { ...t.cart, [p.id]: next } }
    })
  }
  const decFromCart = (p: Product) => patchActive(t => ({ cart: { ...t.cart, [p.id]: nextCartQty(p, t.cart[p.id] || 0, false) } }))
  const removeFromCart = (id: number) => patchActive(t => { const n = { ...t.cart }; delete n[id]; return { cart: n } })

  const tapProduct = (p: Product) => {
    if (isWeighted(p)) { setScaleProduct(p); return }
    addToCart(p, 1)
  }

  const handleScan = () => {
    const val = search.trim()
    if (!val) return
    const p = products.find(x => x.art?.toLowerCase() === val.toLowerCase() || x.barcode === val)
    if (p) tapProduct(p)
    setSearch('')
  }

  const clientResults = useMemo(() => {
    const q = clientQuery.trim()
    if (!q) return []
    const digits = q.replace(/\D/g, '')
    return cards.filter(c => {
      if (digits.length >= 3 && (phonesMatch(c.phone, q) || c.phone.replace(/\D/g, '').includes(digits))) return true
      if (c.num?.toLowerCase().replace(/\s/g, '').includes(q.toLowerCase().replace(/\s/g, ''))) return true
      return c.client?.toLowerCase().includes(q.toLowerCase())
    }).slice(0, 8)
  }, [cards, clientQuery])

  const pickClient = (c: AdminCard) => {
    patchActive(t => ({ client: c, bonusUsed: 0, pay: t.pay === 'debt' && !c.vip && !c.debtEnabled ? 'cash' : t.pay }))
    setClientModal(false); setClientQuery('')
  }
  const clearClient = () => patchActive(t => ({ client: null, bonusUsed: 0, pay: t.pay === 'debt' ? 'cash' : t.pay }))

  const startCheckout = () => {
    if (!cartLines.length) return
    if (activeTicket.pay === 'debt' && !activeTicket.client) { setClientModal(true); return }
    if (activeTicket.pay === 'cash') {
      setCashBuf('')
      setCashModal(true)
    } else {
      void doCheckout()
    }
  }

  const doCheckout = async () => {
    setBusy(true); setErr('')
    try {
      const discountFactor = subtotal > 0 ? goodsTotal / subtotal : 1
      const items = cartLines.map(l => {
        const oi = orderItemFromProduct(l.product, l.qty)
        return { productId: l.product.id, qty: oi.qty, price: Math.round(oi.price * discountFactor * 100) / 100, unit: oi.unit }
      })
      const result = await api.createTillSale({
        locationId,
        cashierName,
        items,
        clientPhone: selectedClient?.phone,
        bonusSpent: bonusApplied,
        paymentMethod: activeTicket.pay,
      })
      setCashModal(false)
      doPrint(result.order)
      closeTicket(activeTicketId)
      reloadReceipts()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось провести продажу')
      setCashModal(false)
    } finally { setBusy(false) }
  }

  const doPrint = (order: Order) => {
    setPrinting({ order })
    setTimeout(() => {
      setPrinting(null)
      setToast({ title: `Чек ${order.id} проведён`, sub: `${order.payment_method === 'cash' ? 'Наличные' : order.payment_method === 'card' ? 'Картой' : 'В долг'} · ${money(Number(order.total))} ЅМ` })
      setTimeout(() => setToast(null), 2600)
    }, 1100)
  }

  const cashReceived = Number(cashBuf) || 0
  const cashChange = cashReceived - payable

  const returnReceipt = async (order: Order) => {
    setBusy(true)
    try {
      await api.createTillReturn({ orderId: order.id })
      setDetailOrder(null)
      reloadReceipts()
      setToast({ title: 'Возврат оформлен', sub: `Чек ${order.id} возвращён` })
      setTimeout(() => setToast(null), 2600)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось оформить возврат')
    } finally { setBusy(false) }
  }

  const closeShift = async () => {
    setZBusy(true)
    try {
      const result = await api.closeTillShift({ locationId, cashierName, closingCashDeclared: Number(closingCash) || 0 })
      setZResult(result)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось закрыть смену')
    } finally { setZBusy(false) }
  }

  const delivered = receipts.filter(r => r.status === 'delivered')
  const cashTotal = delivered.filter(r => r.payment_method === 'cash').reduce((s, r) => s + (Number(r.goodsTotal) || 0), 0)

  return (
    <div className="till-root">
      <style>{CSS}</style>

      <div className="t-catalog">
        <div className="t-topbar">
          <div className={`t-search ${searchFocused ? 'active' : ''}`}>
            <span className="ic">🔍</span>
            <input ref={scanRef} value={search} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)}
              onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleScan()}
              placeholder="Поиск товара по названию, штрихкоду…" autoFocus />
          </div>
          <button className="t-scan-btn" onClick={() => scanRef.current?.focus()} title="Сканер">⌗</button>
          <div className="t-chips">
            {ticketOrder.map((id, i) => {
              const t = tickets[id]
              const count = Object.values(t?.cart || {}).filter(q => q > 0).length
              return (
                <div key={id} className={`t-chip ${id === activeTicketId ? 'active' : ''}`} onClick={() => setActiveTicketId(id)}>
                  {i + 1}{count > 0 && <span className="cnt">{count}</span>}
                  {ticketOrder.length > 1 && <span className="rm" onClick={e => { e.stopPropagation(); closeTicket(id) }}>✕</span>}
                </div>
              )
            })}
            <button className="t-chip-add" onClick={newTicket} title="Новый чек">+</button>
          </div>
          <div className="t-cashier">
            <div className="av">{cashierName ? cashierName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?'}</div>
            <div className="info"><b>{cashierName || 'Кассир'}</b><span>Смена с {new Date(shift.openedAtIso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span></div>
          </div>
          <button className="t-btn-end" onClick={() => { setZOpen(true); setZResult(null); setClosingCash('') }}>Закрыть смену</button>
          <button className="t-btn-close" onClick={onClose} title="Свернуть кассу">✕</button>
        </div>

        <div className="t-cats">
          <button className={`t-cat ${catFlt === 'all' ? 'on' : ''}`} onClick={() => setCatFlt('all')}><span className="emj">🗂</span>Все товары</button>
          {cats.map(c => <button key={c.id} className={`t-cat ${catFlt === c.id ? 'on' : ''}`} onClick={() => setCatFlt(c.id)}><span className="emj">{c.emoji}</span>{c.name}</button>)}
        </div>

        <div className="t-grid-wrap">
          <div className="t-p-grid">
            {filteredProducts.map(p => {
              const low = !isWeighted(p) && p.stock < 5
              return (
                <button key={p.id} className="t-p-tile" onClick={() => tapProduct(p)}>
                  <div className="t-p-img">
                    {isWeighted(p) && <span className="t-p-badge">⚖ вес</span>}
                    {low && <span className="t-p-low-badge">ост. {p.stock}</span>}
                    {p.e}
                  </div>
                  <div className="t-p-body">
                    <div className="t-p-name">{p.name}</div>
                    <div className={`t-p-stock ${low ? 'low' : ''}`}>{isWeighted(p) ? 'В наличии' : `В наличии: ${p.stock}`}</div>
                    <div className="t-p-price-row"><span className="t-p-price mono">{money(p.price)}</span><span className="t-p-unit">ЅМ/{p.unit}</span></div>
                  </div>
                </button>
              )
            })}
            {filteredProducts.length === 0 && <div style={{ gridColumn: '1/-1', textAlign: 'center', color: 'var(--t3)', padding: 30 }}>Ничего не найдено</div>}
          </div>
        </div>
      </div>

      <div className="t-cartpanel">
        <div className="t-cart-client" onClick={() => setClientModal(true)}>
          {selectedClient ? (
            <>
              <div className="t-cart-client-head">
                <div className="av">{(selectedClient.client || selectedClient.num).split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</div>
                <div className="ci"><b>{selectedClient.client || selectedClient.num}</b><span>{selectedClient.phone}</span></div>
                <span className="x" onClick={e => { e.stopPropagation(); clearClient() }}>✕</span>
              </div>
              <div>
                {selectedClient.level && (
                  <span className="t-tier-pill" style={{ background: `${LEVEL_COLOR[selectedClient.level] || '#8FB897'}22`, color: LEVEL_COLOR[selectedClient.level] || '#8FB897' }}>
                    {selectedClient.vip ? '👑 VIP' : LEVEL_LABEL[selectedClient.level] || selectedClient.level}
                  </span>
                )}
                {Number(selectedClient.bonus) > 0 && <span className="t-bonus-pill">💎 {selectedClient.bonus} бонусов</span>}
              </div>
            </>
          ) : (
            <div className="t-cart-client-empty"><span style={{ fontSize: 18 }}>👤</span>Выбрать клиента (необязательно)</div>
          )}
        </div>

        <div className="t-cart-list">
          {cartLines.length === 0 ? (
            <div className="t-cart-empty"><div className="ic">🛒</div>Чек пуст.<br />Выберите товар в каталоге.</div>
          ) : cartLines.map(({ product, qty }) => (
            <div className="t-cart-row" key={product.id}>
              <div className="ic">{product.e}</div>
              <div className="info"><div className="name">{product.name}</div><div className="sub">{formatCartQty(product, qty)} {isWeighted(product) ? '' : product.unit} × {money(product.price)}</div></div>
              {!isWeighted(product) && <div className="t-qtyctrl"><button onClick={() => decFromCart(product)}>−</button><span>{qty}</span><button onClick={() => addToCart(product, 1)}>+</button></div>}
              <div className="price mono">{money(calcLineTotal(product, qty))}</div>
              <button className="rm" onClick={() => removeFromCart(product.id)}>✕</button>
            </div>
          ))}
        </div>

        <div className="t-cart-footer">
          <div className="t-tot-row"><span>{cartLines.length} товаров</span><span className="mono">{money(subtotal)} ЅМ</span></div>
          {discountAmt > 0 && <div className="t-tot-row disc"><span>Скидка ({activeTicket.discountPct}%)</span><span>−{money(discountAmt)}</span></div>}
          {bonusApplied > 0 && <div className="t-tot-row bonus"><span>Списано бонусами</span><span>−{money(bonusApplied)}</span></div>}
          <div className="t-tot-final"><b>К оплате</b><span className="sum mono">{money(payable)} ЅМ</span></div>

          <div className="t-action-grid">
            <button className={`t-action-btn ${activeTicket.discountPct > 0 ? 'on' : ''}`} onClick={() => { setDiscBuf(activeTicket.discountPct ? String(activeTicket.discountPct) : ''); setDiscModal(true) }}>
              <span className="ic">🏷</span>Скидка
            </button>
            <button className={`t-action-btn ${bonusApplied > 0 ? 'on' : ''}`} disabled={!selectedClient || bonusUsable <= 0}
              onClick={() => patchActive({ bonusUsed: activeTicket.bonusUsed > 0 ? 0 : bonusUsable })}>
              <span className="ic">🎁</span>Бонусы
            </button>
            <button className="t-action-btn" onClick={() => setHistoryOpen(true)}><span className="ic">📋</span>История</button>
          </div>
          <div className="t-action-row2">
            <button className={`t-btn-debt ${activeTicket.pay === 'debt' ? 'on' : ''}`} onClick={() => patchActive({ pay: activeTicket.pay === 'debt' ? 'cash' : 'debt' })}>📝 В долг</button>
            <button className="t-btn-clear" onClick={() => patchActive({ cart: {}, client: null, bonusUsed: 0, discountPct: 0, pay: 'cash' })}>🗑 Очистить</button>
          </div>

          {activeTicket.pay !== 'debt' && (
            <div className="t-pay-row">
              <button className={`t-pm ${activeTicket.pay === 'cash' ? 'on' : ''}`} data-m="cash" onClick={() => patchActive({ pay: 'cash' })}><span className="ic">💵</span><span>Наличные</span></button>
              <button className={`t-pm ${activeTicket.pay === 'card' ? 'on' : ''}`} data-m="card" onClick={() => patchActive({ pay: 'card' })}><span className="ic">💳</span><span>Карта</span></button>
            </div>
          )}

          {err && <div style={{ fontSize: 11.5, color: 'var(--red)', marginBottom: 8, fontWeight: 700, textAlign: 'center' }}>{err}</div>}
          <button className="t-btn-checkout" disabled={!cartLines.length || busy} onClick={startCheckout}>
            <span>{busy ? 'Проводим...' : `Оплатить ${money(payable)} ЅМ`}</span>
          </button>
        </div>
      </div>

      {scaleProduct && <WeighModal product={scaleProduct} onDone={(kg) => { addToCart(scaleProduct, kg); setScaleProduct(null) }} onClose={() => setScaleProduct(null)} />}

      {clientModal && (
        <div className="t-overlay" onClick={() => setClientModal(false)}>
          <div className="t-modal" onClick={e => e.stopPropagation()}>
            <h3>👤 Выбор клиента</h3>
            <input className="t-modal-input" autoFocus value={clientQuery} onChange={e => setClientQuery(e.target.value)} placeholder="Телефон или номер карты…" />
            {clientResults.map(c => (
              <div key={c.num} className="t-client-result" onClick={() => pickClient(c)}>
                <div className="av">{(c.client || c.num).split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</div>
                <div className="ci"><b>{c.client || c.num}</b><span>{c.phone} · бонусы {c.bonus} · долг {c.debt}/{c.debtLimit || '∞'} ЅМ</span></div>
              </div>
            ))}
            {clientQuery.trim().length >= 2 && clientResults.length === 0 && <div style={{ fontSize: 11.5, color: 'var(--t3)', padding: '6px 2px' }}>Не найдено</div>}
            <div className="t-modal-actions"><button className="t-btn-cancel" onClick={() => setClientModal(false)}>Отмена</button></div>
          </div>
        </div>
      )}

      {discModal && (
        <div className="t-overlay" onClick={() => setDiscModal(false)}>
          <div className="t-modal" onClick={e => e.stopPropagation()}>
            <h3>🏷 Скидка на чек</h3>
            <div className="t-kp-display"><div className="lbl">СКИДКА, %</div><div className="val mono">{discBuf || '0'}</div></div>
            <div className="t-kp-quick">{[0, 5, 10, 15].map(v => <button key={v} onClick={() => setDiscBuf(String(v))}>{v}%</button>)}</div>
            <div className="t-keypad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => k === '' ? <div key={i} /> : (
                <button key={k} className={k === '⌫' ? 'clear' : ''} onClick={() => {
                  if (k === '⌫') { setDiscBuf(b => b.slice(0, -1)); return }
                  setDiscBuf(b => (b + k).slice(0, 2))
                }}>{k}</button>
              ))}
            </div>
            <div className="t-modal-actions">
              <button className="t-btn-cancel" onClick={() => setDiscModal(false)}>Отмена</button>
              <button className="t-btn-confirm" onClick={() => { patchActive({ discountPct: Math.min(90, Number(discBuf) || 0) }); setDiscModal(false) }}>Применить</button>
            </div>
          </div>
        </div>
      )}

      {cashModal && (
        <div className="t-overlay" onClick={() => setCashModal(false)}>
          <div className="t-modal" onClick={e => e.stopPropagation()}>
            <h3>💵 Оплата наличными</h3>
            <div className="t-kp-display">
              <div className="lbl">К ОПЛАТЕ: <span className="mono">{money(payable)}</span> ЅМ</div>
              <div className="val mono">{cashReceived.toFixed(2)}</div>
              <div className="t-kp-change"><span>Сдача</span><b className="mono" style={{ color: cashChange < 0 ? 'var(--red)' : 'var(--gd)' }}>{money(cashChange)} ЅМ</b></div>
            </div>
            <div className="t-kp-quick">
              {Array.from(new Set([payable, Math.ceil(payable / 10) * 10, Math.ceil(payable / 50) * 50, Math.ceil(payable / 100) * 100].map(v => Math.round(v)))).slice(0, 4).map(v => (
                <button key={v} onClick={() => setCashBuf(String(v))}>{v}</button>
              ))}
            </div>
            <div className="t-keypad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map(k => (
                <button key={k} className={k === '⌫' ? 'clear' : ''} onClick={() => {
                  if (k === '⌫') { setCashBuf(b => b.slice(0, -1)); return }
                  if (k === '.' && cashBuf.includes('.')) return
                  setCashBuf(b => (b + k).slice(0, 9))
                }}>{k}</button>
              ))}
            </div>
            <div className="t-modal-actions">
              <button className="t-btn-cancel" onClick={() => setCashModal(false)}>Отмена</button>
              <button className="t-btn-confirm" disabled={cashReceived < payable || busy} onClick={doCheckout}>{busy ? 'Проводим...' : 'Подтвердить'}</button>
            </div>
          </div>
        </div>
      )}

      {printing && (
        <div className="t-overlay">
          <div className="t-scale-card" style={{ width: 260 }}>
            <div className="t-print-slot">
              <div className="t-paper">
                <div className="h">KAKAPO</div><div className="s">{locationName}</div><div className="d" />
                {printing.order.items.map((it, i) => (
                  <div className="l" key={i}><span>{it.name.slice(0, 15)} x{it.qty}</span><span>{money(it.price * it.qty)}</span></div>
                ))}
                <div className="d" /><div className="tt"><span>ИТОГО</span><span>{money(Number(printing.order.total))} ЅМ</span></div>
              </div>
            </div>
            <div className="t-print-status">🖨 Печать чека…</div>
          </div>
        </div>
      )}

      {toast && (
        <div className="t-toast"><div className="ic">🖨</div><div><b>{toast.title}</b><span>{toast.sub}</span></div></div>
      )}

      {historyOpen && (
        <div className="t-overlay" onClick={() => setHistoryOpen(false)}>
          <div className="t-modal wide" onClick={e => e.stopPropagation()}>
            <h3>📋 Чеки за смену</h3>
            {receipts.slice().reverse().map(r => (
              <div className="t-hist-row" key={r.id} onClick={() => { setDetailOrder(r); setHistoryOpen(false) }}>
                <span className="time">{r.deliveredAt}</span><span>{r.id}</span>
                <span className={`meth ${r.payment_method}`}>{r.payment_method === 'cash' ? 'Нал' : r.payment_method === 'card' ? 'Карта' : 'Долг'}</span>
                {r.status === 'cancelled' && <span className="st cancelled">Возврат</span>}
                <span className="sum">{money(Number(r.goodsTotal))}</span>
              </div>
            ))}
            {receipts.length === 0 && <div style={{ textAlign: 'center', color: 'var(--t3)', fontSize: 11.5, padding: 20 }}>Пока нет проведённых чеков</div>}
            <div className="t-modal-actions" style={{ marginTop: 12 }}><button className="t-btn-confirm" style={{ flex: 1 }} onClick={() => setHistoryOpen(false)}>Закрыть</button></div>
          </div>
        </div>
      )}

      {detailOrder && (
        <div className="t-overlay" onClick={() => setDetailOrder(null)}>
          <div className="t-modal wide" onClick={e => e.stopPropagation()}>
            <h3>Чек {detailOrder.id} · {detailOrder.deliveredAt}</h3>
            <div style={{ background: 'var(--surface2)', borderRadius: 14, padding: '12px 15px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 11, color: 'var(--t2)' }}>{detailOrder.client?.name || 'Розница'} · {detailOrder.payment_method === 'cash' ? 'Наличные' : detailOrder.payment_method === 'card' ? 'Карта' : 'В долг'}</span>
              <span className="mono" style={{ fontSize: 19, fontWeight: 900, color: 'var(--gd)' }}>{money(Number(detailOrder.goodsTotal))} ЅМ</span>
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 14 }}>
              {(detailOrder.items || []).map((it, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 3px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                  <span>{it.e} {it.name} x{it.qty}</span><span className="mono" style={{ color: 'var(--gd)' }}>{money(it.price * it.qty)}</span>
                </div>
              ))}
            </div>
            {detailOrder.status === 'cancelled' ? (
              <div style={{ textAlign: 'center', color: 'var(--t3)', fontSize: 11.5, padding: 10 }}>Чек уже возвращён</div>
            ) : (
              <button className="t-btn-cancel" style={{ width: '100%', padding: 12, borderRadius: 13, background: 'rgba(255,69,69,.1)', border: '1px solid rgba(255,69,69,.28)', color: 'var(--red)', fontWeight: 800, fontSize: 12 }} disabled={busy} onClick={() => returnReceipt(detailOrder)}>↩ Оформить возврат (весь чек)</button>
            )}
            <div className="t-modal-actions" style={{ marginTop: 10 }}><button className="t-btn-cancel" onClick={() => setDetailOrder(null)}>Закрыть</button></div>
          </div>
        </div>
      )}

      {zOpen && (
        <div className="t-overlay" onClick={() => !zResult && setZOpen(false)}>
          <div className="t-modal wide" onClick={e => e.stopPropagation()}>
            {!zResult ? (
              <>
                <h3>📊 Закрытие смены — сводка</h3>
                <div className="t-z-grid">
                  <div className="t-z-stat"><div className="l">Выручка</div><div className="v mono" style={{ color: 'var(--gr)' }}>{money(delivered.reduce((s, r) => s + (Number(r.goodsTotal) || 0), 0))}</div></div>
                  <div className="t-z-stat"><div className="l">Чеков</div><div className="v mono">{delivered.length}</div></div>
                  <div className="t-z-stat"><div className="l">Наличными</div><div className="v mono" style={{ color: 'var(--gd)' }}>{money(cashTotal)}</div></div>
                  <div className="t-z-stat"><div className="l">Ожидается в кассе</div><div className="v mono">{money(shift.openingCash + cashTotal)}</div></div>
                </div>
                <div className="t-field"><label>Фактически наличных в кассе</label><input className="t-modal-input" type="number" value={closingCash} onChange={e => setClosingCash(e.target.value)} placeholder="0" /></div>
                {err && <div style={{ fontSize: 11.5, color: 'var(--red)', marginBottom: 10, fontWeight: 700 }}>{err}</div>}
                <div className="t-modal-actions">
                  <button className="t-btn-cancel" onClick={() => setZOpen(false)}>Отмена</button>
                  <button className="t-btn-confirm" style={{ background: 'var(--red)' }} disabled={zBusy} onClick={closeShift}>{zBusy ? 'Закрываем...' : 'Закрыть смену'}</button>
                </div>
              </>
            ) : (
              <>
                <h3>{Number(zResult.difference) === 0 ? '✅' : '⚠️'} Смена закрыта</h3>
                <div className="t-z-grid">
                  <div className="t-z-stat"><div className="l">Ожидалось</div><div className="v mono">{money(zResult.expectedCash || 0)}</div></div>
                  <div className="t-z-stat"><div className="l">Заявлено</div><div className="v mono">{money(zResult.closingCashDeclared || 0)}</div></div>
                </div>
                <div style={{ textAlign: 'center', marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 4 }}>Расхождение</div>
                  <div className="mono" style={{ fontSize: 22, fontWeight: 900, color: Number(zResult.difference) === 0 ? 'var(--gr)' : Number(zResult.difference) > 0 ? 'var(--gd)' : 'var(--red)' }}>
                    {Number(zResult.difference) > 0 ? '+' : ''}{money(Number(zResult.difference))} ЅМ
                  </div>
                </div>
                <button className="t-btn-confirm" style={{ width: '100%', padding: 13 }} onClick={() => { setZOpen(false); onShiftClosed() }}>Открыть новую смену</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function WeighModal({ product, onDone, onClose }: { product: Product; onDone: (kg: number) => void; onClose: () => void }) {
  const [weight, setWeight] = useState(0)
  const [done, setDone] = useState(false)
  const finalWeightRef = useRef(Math.random() * 1.2 + 0.25)

  useEffect(() => {
    let t = 0
    const iv = setInterval(() => {
      t++
      const fw = finalWeightRef.current
      setWeight(Math.min(fw, (t / 14) * fw + Math.random() * 0.05))
      if (t >= 14) {
        clearInterval(iv)
        setWeight(fw)
        setDone(true)
        setTimeout(() => onDone(fw), 450)
      }
    }, 55)
    return () => clearInterval(iv)
  }, [onDone])

  return (
    <div className="t-overlay" onClick={onClose}>
      <div className="t-scale-card" onClick={e => e.stopPropagation()}>
        <div className="emoji">{product.e}</div>
        <h3>{product.name}</h3>
        <p>Взвешивание на весах…</p>
        <div className="t-scale-display">
          <div className={`t-scale-num mono ${done ? 'done' : ''}`}>{weight.toFixed(3)}</div>
          <div className="t-scale-label">КГ</div>
          <div className="t-scale-price mono">{money(weight * product.price)} ЅМ</div>
        </div>
      </div>
    </div>
  )
}
