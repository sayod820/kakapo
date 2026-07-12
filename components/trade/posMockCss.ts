/** CSS из HTML-макета KAKAPO Касса */
export const POS_MOCK_CSS = `

  @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@600;700;800;900&family=Nunito:wght@400;600;700;800;900&family=JetBrains+Mono:wght@500;700;800&display=swap');

  .pos-root{
    --bg:#030B05; --surface:#0A1710; --surface2:#0F2216; --surface3:#132A1A; --border:#1A3322; --border2:#234430;
    --accent:#1FD760; --accent2:#17B34E; --gd:#FFB800; --org:#FF8C00; --blue:#3B8EF0;
    --pur:#9B6DFF; --red:#FF4545;
    --t1:#F1FBF3; --t2:#8FB897; --t3:#3D6645;
  }
  .pos-root[data-theme="purple"]{ --accent:#9B6DFF; --accent2:#7C4FE0; }
  .pos-root[data-theme="gold"]{ --accent:#FFB800; --accent2:#E0A000; }

  .pos-root *,.pos-root *::before,.pos-root *::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
  .pos-root{position:fixed;inset:0;z-index:100;height:100vh;width:100vw;margin:0;background:var(--bg);color:var(--t1);font-family:'Nunito',sans-serif;overflow:hidden}
  .ub{font-family:'Unbounded',sans-serif;}
  .mono{font-family:'JetBrains Mono',monospace;}
.pos-root button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit;}
.pos-root input,.pos-root select{font-family:inherit;color:inherit;}
  .pos-root ::-webkit-scrollbar{width:6px;height:6px;}
  .pos-root ::-webkit-scrollbar-track{background:transparent;}
  .pos-root ::-webkit-scrollbar-thumb{background:var(--border2);border-radius:4px;}

  @keyframes fadeIn{from{opacity:0}to{opacity:1}}
  @keyframes popIn{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}
  @keyframes weighTick{0%{transform:translateY(0)}100%{transform:translateY(-2px)}}
  @keyframes tileIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
  @keyframes rowIn{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:translateX(0)}}
  @keyframes toastIn{from{opacity:0;transform:translate(-50%,14px)}to{opacity:1;transform:translate(-50%,0)}}
  @keyframes paperOut{0%{transform:translate(-50%,-100%);opacity:0}12%{opacity:1}100%{transform:translate(-50%,0);opacity:1}}
  @keyframes tearDrop{to{transform:translate(-50%,14px) rotate(1deg);opacity:0}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  @keyframes scanFlash{0%{box-shadow:inset 0 0 0 2px rgba(31,215,96,.7)}100%{box-shadow:inset 0 0 0 2px transparent}}

  /* ══════════ SHIFT GATE ══════════ */
  .gate{position:absolute;inset:0;background:var(--bg);display:flex;align-items:center;justify-content:center;z-index:500;}
  
  .gate-bg{position:absolute;inset:0;opacity:.5;background:radial-gradient(circle at 20% 20%, rgba(31,215,96,.09), transparent 45%),radial-gradient(circle at 82% 78%, rgba(255,184,0,.06), transparent 45%);}
  .gate-card{position:relative;width:400px;background:var(--surface);border:1px solid var(--border);border-radius:22px;padding:32px;animation:popIn .3s cubic-bezier(.16,1,.3,1);}
  .gate-logo{width:50px;height:50px;border-radius:16px;background:linear-gradient(135deg,var(--accent2),var(--accent));display:flex;align-items:center;justify-content:center;font-family:'Unbounded';font-weight:900;font-size:21px;color:var(--bg);margin:0 auto 14px;}
  .gate-title{font-family:'Unbounded';font-size:16px;font-weight:800;text-align:center;margin-bottom:4px;}
  .gate-sub{font-size:12px;color:var(--t2);text-align:center;margin-bottom:24px;}
  .gate-label{font-size:11px;font-weight:700;color:var(--t2);margin-bottom:8px;display:block;}
  .cashier-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:20px;}
  .cashier-opt{padding:12px 5px;border-radius:14px;border:1.5px solid var(--border);background:var(--surface2);text-align:center;}
  .cashier-opt.on{border-color:var(--accent);background:rgba(31,215,96,.08);}
  .cashier-opt .av{width:32px;height:32px;border-radius:10px;background:var(--border2);display:flex;align-items:center;justify-content:center;font-family:'Unbounded';font-weight:800;font-size:11px;margin:0 auto 6px;}
  .cashier-opt.on .av{background:linear-gradient(135deg,var(--accent2),var(--accent));color:var(--bg);}
  .cashier-opt span{font-size:10.5px;font-weight:700;color:var(--t2);}
  .cashier-opt.on span{color:var(--t1);}
  .gate-input{width:100%;background:var(--surface2);border:1.5px solid var(--border);border-radius:13px;padding:13px 15px;font-size:14px;font-weight:700;color:var(--t1);outline:none;margin-bottom:20px;font-family:'JetBrains Mono';}
  .gate-input:focus{border-color:var(--accent);}
  .btn-gate{width:100%;padding:14px;border-radius:14px;background:linear-gradient(135deg,var(--accent2),var(--accent));color:var(--bg);font-weight:800;font-size:14px;}

  /* ══════════ APP SHELL ══════════ */
  .app{display:grid;grid-template-columns:1fr minmax(340px,400px);grid-template-rows:64px 1fr;height:100%}
  

  /* ── SIDEBAR (full nav like reference) ── */
  .sidebar{grid-row:1/3;background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow-y:auto;}
  .sb-brand{display:flex;align-items:center;gap:10px;padding:18px 18px 16px;}
  .sb-logo{width:34px;height:34px;border-radius:11px;background:linear-gradient(135deg,var(--accent2),var(--accent));display:flex;align-items:center;justify-content:center;font-family:'Unbounded';font-weight:900;font-size:15px;color:var(--bg);flex-shrink:0;}
  .sb-brand b{font-family:'Unbounded';font-size:14px;font-weight:800;}
  .sb-nav{padding:0 10px;}
  .sb-item{display:flex;align-items:center;gap:11px;padding:11px 12px;border-radius:12px;color:var(--t2);font-size:12.5px;font-weight:700;margin-bottom:3px;}
  .sb-item:hover{background:var(--surface2);color:var(--t1);}
  .sb-item.on{background:var(--accent);color:var(--bg);}
  .sb-item .ic{font-size:16px;width:20px;text-align:center;flex-shrink:0;}
  .sb-foot{margin-top:auto;padding:14px;border-top:1px solid var(--border);}
  .sb-loc{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}
  .sb-loc b{font-size:12px;display:block;}
  .sb-loc .dot-row{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--accent);margin-top:2px;}
  .sb-loc .dot-row .d{width:6px;height:6px;border-radius:50%;background:var(--accent);animation:pulse 2s infinite;}
  .sb-clock{font-family:'JetBrains Mono';font-size:20px;font-weight:800;color:var(--gd);margin-bottom:2px;}
  .sb-date{font-size:10.5px;color:var(--t3);margin-bottom:12px;}
  .btn-switch-till{width:100%;padding:10px;border-radius:11px;background:var(--surface2);border:1px solid var(--border);color:var(--t2);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:6px;}
  .btn-switch-till:hover{border-color:var(--red);color:var(--red);}

  /* ── TOPBAR ── */
  .topbar{grid-column:1/3;display:flex;align-items:center;gap:14px;padding:0 20px;background:var(--surface);border-bottom:1px solid var(--border);}
  .btn-exit{padding:8px 12px;border-radius:12px;background:var(--surface2);border:1px solid var(--border);color:var(--t2);font-size:11px;font-weight:700;flex-shrink:0}
  .btn-exit:hover{border-color:var(--red);color:var(--red)}
  .searchpill{flex:1;max-width:none;display:flex;align-items:center;gap:10px;background:var(--surface2);border:1.5px solid var(--border);border-radius:14px;padding:11px 16px;transition:border-color .2s;}
  .searchpill.active{border-color:var(--accent);}
  .searchpill .ic{font-size:14px;color:var(--t2);}
  .searchpill input{flex:1;background:none;border:none;outline:none;font-size:13.5px;color:var(--t1);}
  .searchpill input::placeholder{color:var(--t3);}
  .scan-tag{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--t3);font-weight:700;padding-left:10px;border-left:1px solid var(--border);flex-shrink:0;}
  .theme-dots{display:flex;gap:6px;margin-left:auto;}
  .theme-dot{width:22px;height:22px;border-radius:50%;border:2px solid var(--border);cursor:pointer;transition:transform .12s;}
  .theme-dot:hover{transform:scale(1.12);}
  .theme-dot.on{border-color:var(--t1);}
  .bell-btn{position:relative;width:38px;height:38px;border-radius:12px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}
  .bell-btn:hover{background:var(--border2);}
  .bell-badge{position:absolute;top:5px;right:5px;width:8px;height:8px;border-radius:50%;background:var(--red);}
  .account-btn{display:flex;align-items:center;gap:9px;padding:6px 10px 6px 6px;border-radius:13px;flex-shrink:0;}
  .account-btn:hover{background:var(--surface2);}
  .account-av{width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,#1E5BB5,var(--blue));display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;font-family:'Unbounded';flex-shrink:0;}
  .account-btn .info{text-align:left;line-height:1.2;}
  .account-btn .info b{font-size:12px;display:block;}
  .account-btn .info span{font-size:9.5px;color:var(--t3);}

  /* ── PRODUCTS ── */
  .products{background:var(--bg);overflow:hidden;display:flex;flex-direction:column;}
  .cat-row{display:flex;gap:9px;padding:14px 20px 6px;overflow-x:auto;flex-shrink:0;}
  .cat-pill{padding:9px 16px;border-radius:13px;font-size:12px;font-weight:700;background:var(--surface);border:1.5px solid var(--border);color:var(--t2);white-space:nowrap;display:flex;align-items:center;gap:7px;flex-shrink:0;}
  .cat-pill.on{background:var(--accent);border-color:var(--accent);color:var(--bg);}

  .grid-wrap{flex:1;overflow-y:auto;padding:8px 20px 20px;}
  .p-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:12px;}
  .p-tile{position:relative;background:var(--surface);border:1.5px solid var(--border);border-radius:16px;padding:12px;text-align:left;transition:border-color .15s,transform .1s;animation:tileIn .25s ease both;}
  .p-tile:hover{border-color:var(--accent);transform:translateY(-2px);}
  .p-tile:active{transform:translateY(0) scale(.97);}
  .p-photo{width:100%;height:78px;border-radius:12px;background:linear-gradient(145deg,var(--surface2),var(--surface3));display:flex;align-items:center;justify-content:center;font-size:38px;margin-bottom:10px;position:relative;}
  .p-weight-tag{position:absolute;top:6px;right:6px;font-size:9px;font-weight:800;background:rgba(3,11,5,.75);color:var(--t1);padding:2px 7px;border-radius:7px;}
  .p-name{font-size:12px;font-weight:800;line-height:1.25;margin-bottom:4px;min-height:30px;}
  .p-price{font-family:'JetBrains Mono';font-size:15px;font-weight:900;color:var(--gd);}
  .p-unit{font-size:9.5px;color:var(--t3);font-weight:600;}
  .p-stock{font-size:10px;color:var(--accent);margin-top:4px;font-weight:700;}
  .p-stock.low{color:var(--red);}
  .p-badge{position:absolute;top:20px;left:20px;font-size:8.5px;font-weight:800;padding:2px 6px;border-radius:6px;background:rgba(155,109,255,.16);color:var(--pur);z-index:2;}
  .p-manual{border-style:dashed;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--t2);min-height:172px;}
  .p-manual .ic{font-size:26px;margin-bottom:8px;}
  .p-manual b{font-size:11.5px;font-weight:800;}

  /* ── CART PANEL ── */
  .cart{background:var(--surface);border-left:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;}

  /* persistent client card */
  .client-card{margin:14px 14px 0;padding:12px 14px;border-radius:16px;background:var(--surface2);border:1.5px solid var(--border);display:flex;align-items:center;gap:11px;cursor:pointer;flex-shrink:0;}
  .client-card:hover{border-color:var(--border2);}
  .client-card.set{border-color:rgba(255,184,0,.3);background:rgba(255,184,0,.05);}
  .client-av{width:38px;height:38px;border-radius:12px;background:var(--border2);display:flex;align-items:center;justify-content:center;font-family:'Unbounded';font-weight:800;font-size:13px;flex-shrink:0;color:var(--t2);}
  .client-card.set .client-av{background:linear-gradient(135deg,var(--accent2),var(--accent));color:var(--bg);}
  .client-info{flex:1;min-width:0;}
  .client-info .nm{font-size:12.5px;font-weight:800;}
  .client-info .ph{font-size:10px;color:var(--t2);}
  .client-tier{padding:3px 9px;border-radius:8px;font-size:9.5px;font-weight:800;flex-shrink:0;}
  .client-bonus{font-size:9.5px;color:var(--gd);font-weight:700;margin-top:2px;}
  .client-x{width:22px;height:22px;border-radius:7px;color:var(--t3);font-size:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;}
  .client-x:hover{background:rgba(255,69,69,.12);color:var(--red);}

  .tier-strip{margin:10px 14px 0;padding:9px 12px;border-radius:13px;background:rgba(255,184,0,.06);border:1px solid rgba(255,184,0,.2);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;font-size:11px;}
  .tier-strip .lbl{color:var(--t2);}
  .tier-strip b{color:var(--gd);font-family:'JetBrains Mono';}
  .discount-strip{margin:8px 14px 0;padding:9px 12px;border-radius:13px;background:var(--surface2);border:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;font-size:11px;}
  .discount-strip .set-btn{font-size:10.5px;color:var(--blue);font-weight:800;}

  .cart-items{flex:1;overflow-y:auto;padding:10px 14px;}
  .cart-empty{text-align:center;color:var(--t3);padding:50px 10px;}
  .cart-empty .ic{font-size:38px;opacity:.5;margin-bottom:8px;}
  .cart-row{display:flex;align-items:center;gap:10px;padding:9px 6px;border-radius:14px;animation:rowIn .18s ease both;}
  .cart-row:hover{background:var(--surface2);}
  .cart-row .ic{width:38px;height:38px;border-radius:11px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;}
  .cart-row .info{flex:1;min-width:0;}
  .cart-row .name{font-size:12px;font-weight:700;}
  .cart-row .sub{font-size:10px;color:var(--t3);margin-top:1px;}
  .cart-row .sub .w{color:var(--pur);font-weight:700;}
  .qtyctrl{display:flex;align-items:center;gap:7px;background:var(--surface2);border-radius:10px;padding:4px;flex-shrink:0;}
  .qtyctrl button{width:20px;height:20px;border-radius:7px;font-size:13px;font-weight:800;color:var(--t2);}
  .qtyctrl button:hover{background:var(--border2);color:var(--t1);}
  .qtyctrl span{font-size:12px;font-weight:800;min-width:16px;text-align:center;font-family:'JetBrains Mono';}
  .cart-row .price{font-family:'JetBrains Mono';font-size:14px;font-weight:900;color:var(--gd);flex-shrink:0;min-width:64px;text-align:right;}
  .cart-row .rm{width:22px;height:22px;border-radius:8px;color:var(--t3);font-size:12px;flex-shrink:0;}
  .cart-row .rm:hover{background:rgba(255,69,69,.12);color:var(--red);}

  .cart-totals{padding:12px 14px;border-top:1px solid var(--border);flex-shrink:0;}
  .tot-row{display:flex;justify-content:space-between;font-size:12px;color:var(--t2);margin-bottom:6px;}
  .tot-row.disc span:last-child{color:var(--red);}
  .tot-final{display:flex;justify-content:space-between;align-items:baseline;padding-top:9px;margin-top:3px;border-top:1px dashed var(--border);}
  .tot-final b{font-family:'Unbounded';font-size:12.5px;}
  .tot-final .sum{font-family:'JetBrains Mono';font-size:27px;font-weight:900;color:var(--accent);}

  /* action chip rows (colorful, like reference) */
  .action-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;padding:0 14px 9px;flex-shrink:0;}
  .action-chip{padding:11px 6px;border-radius:14px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:5px;}
  .action-chip .ic-wrap{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:15px;}
  .action-chip span{font-size:10px;font-weight:700;color:var(--t2);}
  .ac-discount{background:rgba(155,109,255,.06);border:1px solid rgba(155,109,255,.2);}
  .ac-discount .ic-wrap{background:rgba(155,109,255,.15);}
  .ac-bonus{background:rgba(255,184,0,.06);border:1px solid rgba(255,184,0,.2);}
  .ac-bonus .ic-wrap{background:rgba(255,184,0,.15);}
  .ac-hold{background:rgba(59,142,240,.06);border:1px solid rgba(59,142,240,.2);}
  .ac-hold .ic-wrap{background:rgba(59,142,240,.15);}
  .action-row2{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;padding:0 14px 10px;flex-shrink:0;}
  .action-out{padding:10px 5px;border-radius:13px;text-align:center;font-size:10.5px;font-weight:700;background:var(--surface2);border:1px solid var(--border);color:var(--t2);}
  .action-out:hover{border-color:var(--border2);color:var(--t1);}
  .action-out.danger{color:var(--red);border-color:rgba(255,69,69,.25);}

  .link-row{display:flex;gap:4px;padding:0 14px 6px;flex-shrink:0;justify-content:center;}
  .link-row button{font-size:10.5px;color:var(--t3);font-weight:700;padding:6px 10px;}
  .link-row button:hover{color:var(--t1);}

  /* payment buttons (solid, colorful, 4 across) */
  .pay-grid{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:7px;padding:0 14px 10px;flex-shrink:0;}
  .pay-btn{padding:12px 4px;border-radius:13px;text-align:center;font-size:10px;font-weight:800;color:white;display:flex;flex-direction:column;align-items:center;gap:4px;opacity:.9;}
  .pay-btn .ic{font-size:16px;}
  .pay-btn.on{opacity:1;box-shadow:0 4px 14px rgba(0,0,0,.3);transform:translateY(-1px);}
  .pay-btn.disabled{opacity:.25;pointer-events:none;}
  .pay-cash{background:linear-gradient(135deg,var(--accent2),var(--accent));}
  .pay-card{background:linear-gradient(135deg,#1E5BB5,var(--blue));}
  .pay-balance{background:linear-gradient(135deg,#7C4FE0,var(--pur));}
  .pay-qr{background:linear-gradient(135deg,#B57F00,var(--gd));color:#241900;}

  .btn-checkout{margin:0 14px 16px;padding:16px;border-radius:16px;background:linear-gradient(135deg,var(--accent2),var(--accent));color:var(--bg);font-weight:800;font-size:14.5px;display:flex;align-items:center;justify-content:center;gap:9px;box-shadow:0 10px 26px rgba(31,215,96,.28);}
  .btn-checkout:disabled{opacity:.3;box-shadow:none;}

  /* placeholder page for other sidebar sections */
  .placeholder-page{position:absolute;inset:0;background:var(--bg);z-index:80;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px;}
  .placeholder-page.show{display:flex;}
  .placeholder-page .ic{font-size:52px;margin-bottom:16px;}
  .placeholder-page h2{font-family:'Unbounded';font-size:18px;margin-bottom:8px;}
  .placeholder-page p{color:var(--t2);font-size:13px;max-width:340px;line-height:1.6;margin-bottom:20px;}
  .placeholder-page button{padding:12px 22px;border-radius:13px;background:var(--surface2);border:1px solid var(--border);color:var(--t2);font-weight:700;font-size:12.5px;}

  /* ══════════ SHARED OVERLAYS/MODALS (reused pattern) ══════════ */
  .overlay{position:absolute;inset:0;background:rgba(3,11,5,.75);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:200;}
  
  .scale-card{width:310px;background:var(--surface);border:1.5px solid var(--border);border-radius:22px;padding:24px;text-align:center;animation:popIn .25s cubic-bezier(.16,1,.3,1);}
  .scale-card .emoji{font-size:40px;margin-bottom:8px;}
  .scale-card h3{font-family:'Unbounded';font-size:14px;font-weight:800;margin-bottom:3px;}
  .scale-card p{font-size:11.5px;color:var(--t2);margin-bottom:16px;}
  .scale-display{background:var(--surface2);border:1px solid var(--border);border-radius:16px;padding:16px;margin-bottom:14px;}
  .scale-num{font-family:'JetBrains Mono';font-size:28px;font-weight:700;color:var(--accent);animation:weighTick .3s ease infinite alternate;}
  .scale-num.done{animation:none;color:var(--gd);}
  .scale-label{font-size:9.5px;color:var(--t3);margin-top:3px;letter-spacing:1px;}
  .scale-price{font-family:'JetBrains Mono';font-size:20px;font-weight:900;color:var(--gd);margin-top:7px;}
  .scale-barcode{margin-top:12px;padding:9px;background:var(--bg);border-radius:12px;font-family:'JetBrains Mono';font-size:13px;letter-spacing:2.5px;color:var(--t2);}
  .scan-ring{width:88px;height:88px;border-radius:50%;border:3px solid var(--accent);margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-size:36px;position:relative;}
  .scan-ring::after{content:'';position:absolute;inset:-3px;border-radius:50%;border:3px solid var(--accent);opacity:.4;animation:weighTick 1s ease infinite alternate;}

  .modal-card{width:360px;background:var(--surface);border:1.5px solid var(--border);border-radius:22px;padding:22px;animation:popIn .25s cubic-bezier(.16,1,.3,1);}
  .modal-card h3{font-family:'Unbounded';font-size:13.5px;font-weight:800;margin-bottom:14px;}
  .modal-input{width:100%;background:var(--surface2);border:1.5px solid var(--border);border-radius:14px;padding:12px 15px;font-size:13.5px;color:var(--t1);outline:none;margin-bottom:12px;}
  .modal-input:focus{border-color:var(--blue);}
  .client-result{padding:11px;border-radius:15px;background:var(--surface2);border:1px solid var(--border);display:flex;align-items:center;gap:10px;margin-bottom:12px;cursor:pointer;}
  .client-result:hover{border-color:var(--accent);}
  .client-result .av{width:34px;height:34px;border-radius:11px;background:linear-gradient(135deg,var(--accent2),var(--accent));display:flex;align-items:center;justify-content:center;font-family:'Unbounded';font-weight:800;font-size:12px;color:var(--bg);flex-shrink:0;}
  .client-result .ci{flex:1;line-height:1.25;}
  .client-result .ci b{font-size:12.5px;display:block;}
  .client-result .ci span{font-size:10px;color:var(--t2);}
  .tier-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:7px;font-size:9px;font-weight:800;}
  .debt-meter{margin-top:4px;height:4px;background:var(--border);border-radius:3px;overflow:hidden;}
  .debt-meter i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--gd));}
  .modal-actions{display:flex;gap:8px;}
  .modal-actions button{flex:1;padding:12px;border-radius:14px;font-weight:800;font-size:12px;}
  .btn-cancel{background:var(--surface2);color:var(--t2);border:1px solid var(--border);}
  .btn-confirm{background:var(--accent);color:var(--bg);}
  .btn-confirm:disabled{opacity:.3;background:var(--border2);color:var(--t3);}
  .scan-btn{width:36px;height:36px;border-radius:12px;background:var(--surface2);border:1.5px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;}
  .scan-btn:hover{border-color:var(--accent);}

  .kp-display{background:var(--surface2);border:1.5px solid var(--border);border-radius:16px;padding:16px;text-align:center;margin-bottom:14px;}
  .kp-display .lbl{font-size:10px;color:var(--t3);letter-spacing:.5px;margin-bottom:4px;}
  .kp-display .val{font-family:'JetBrains Mono';font-size:28px;font-weight:800;color:var(--t1);}
  .kp-change{margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);display:flex;justify-content:space-between;font-size:12px;}
  .kp-change b{font-family:'JetBrains Mono';color:var(--gd);}
  .kp-quick{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px;}
  .kp-quick button{padding:8px 4px;border-radius:11px;background:var(--surface2);border:1px solid var(--border);font-size:11px;font-weight:700;color:var(--t2);}
  .kp-quick button:hover{border-color:var(--accent);color:var(--accent);}
  .keypad{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:14px;}
  .keypad button{padding:14px;border-radius:13px;background:var(--surface2);border:1px solid var(--border);font-family:'JetBrains Mono';font-size:17px;font-weight:700;}
  .keypad button:hover{background:var(--border2);}
  .keypad button:active{transform:scale(.94);}
  .keypad button.kp-clear{color:var(--red);font-family:'Nunito';font-size:12px;font-weight:800;}

  .print-slot{position:relative;width:220px;height:290px;overflow:hidden;margin:0 auto 6px;}
  .paper{position:absolute;left:50%;top:0;transform:translate(-50%,-100%);width:200px;background:#F3EFE3;border-radius:2px;padding:16px 14px;box-shadow:0 10px 30px rgba(0,0,0,.4);}
  .paper.go{animation:paperOut .9s cubic-bezier(.2,.8,.3,1) forwards;}
  .paper.tear{animation:tearDrop .4s ease forwards;}
  .paper *{color:#2A2620;font-family:'JetBrains Mono';}
  .paper .pr-head{text-align:center;font-family:'Unbounded';font-size:11px;font-weight:800;margin-bottom:2px;}
  .paper .pr-sub{text-align:center;font-size:8.5px;opacity:.7;margin-bottom:8px;}
  .paper .pr-div{border-top:1px dashed rgba(42,38,32,.4);margin:6px 0;}
  .paper .pr-line{display:flex;justify-content:space-between;font-size:9.5px;margin-bottom:3px;}
  .paper .pr-total{display:flex;justify-content:space-between;font-size:12px;font-weight:800;margin-top:4px;}
  .paper .pr-foot{text-align:center;font-size:8px;opacity:.65;margin-top:8px;}
  .print-status{text-align:center;font-size:12px;color:var(--t2);font-weight:700;}
  .print-status .done{color:var(--accent);}

  .toast{position:absolute;bottom:28px;left:50%;background:var(--surface);border:1.5px solid var(--accent);border-radius:18px;padding:14px 20px;display:flex;align-items:center;gap:11px;box-shadow:0 14px 32px rgba(0,0,0,.5);z-index:300;animation:toastIn .3s cubic-bezier(.16,1,.3,1);}
  .toast .ic{width:34px;height:34px;border-radius:11px;background:rgba(31,215,96,.15);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}
  .toast b{font-size:13px;display:block;}
  .toast span{font-size:10.5px;color:var(--t2);}

  .wide-card{width:420px;max-height:80vh;display:flex;flex-direction:column;}
  .z-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:14px;}
  .z-stat{background:var(--surface2);border:1px solid var(--border);border-radius:15px;padding:13px;}
  .z-stat .l{font-size:9.5px;color:var(--t3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:5px;}
  .z-stat .v{font-family:'JetBrains Mono';font-size:17px;font-weight:800;}
  .hist-list{flex:1;overflow-y:auto;max-height:220px;margin-bottom:14px;}
  .hist-row{display:flex;justify-content:space-between;align-items:center;padding:9px 4px;border-bottom:1px solid var(--border);font-size:12px;cursor:pointer;}
  .hist-row:hover{background:var(--surface2);border-radius:10px;}
  .hist-row .time{color:var(--t3);font-family:'JetBrains Mono';font-size:10.5px;width:44px;flex-shrink:0;}
  .hist-row .meth{font-size:9px;padding:2px 6px;border-radius:6px;margin-left:6px;flex-shrink:0;}
  .hist-row .meth.cash{background:rgba(31,215,96,.12);color:var(--accent);}
  .hist-row .meth.card{background:rgba(59,142,240,.12);color:var(--blue);}
  .hist-row .meth.debt{background:rgba(255,184,0,.12);color:var(--gd);}
  .hist-row .meth.balance{background:rgba(155,109,255,.12);color:var(--pur);}
  .hist-row .st{font-size:9px;padding:2px 6px;border-radius:6px;margin-left:6px;flex-shrink:0;}
  .hist-row .st.returned{background:rgba(255,69,69,.12);color:var(--red);}
  .hist-row .st.cancelled{background:var(--border2);color:var(--t3);text-decoration:line-through;}
  .hist-row .st.correction{background:rgba(59,142,240,.12);color:var(--blue);}
  .hist-row .sum{font-family:'JetBrains Mono';font-weight:800;color:var(--gd);margin-left:auto;}

  .rd-back{display:flex;align-items:center;gap:8px;color:var(--t2);font-size:11.5px;font-weight:700;margin-bottom:12px;cursor:pointer;}
  .rd-back:hover{color:var(--t1);}
  .rd-summary{display:flex;justify-content:space-between;align-items:baseline;background:var(--surface2);border-radius:14px;padding:14px 16px;margin-bottom:12px;}
  .rd-summary .sum{font-family:'JetBrains Mono';font-size:22px;font-weight:900;color:var(--gd);}
  .rd-items{max-height:200px;overflow-y:auto;margin-bottom:14px;}
  .rd-item{display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid var(--border);font-size:12px;}
  .rd-item input[type=checkbox]{width:16px;height:16px;accent-color:var(--accent);flex-shrink:0;}
  .rd-item .nm{flex:1;}
  .rd-item .pr{font-family:'JetBrains Mono';color:var(--gd);font-weight:700;flex-shrink:0;}
  .rd-actions{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;}
  .rd-actions button{padding:11px 6px;border-radius:12px;font-size:11px;font-weight:800;text-align:center;}
  .rd-act-return{background:rgba(255,69,69,.1);border:1px solid rgba(255,69,69,.28);color:var(--red);}
  .rd-act-cancel{background:var(--surface2);border:1px solid var(--border);color:var(--t2);}
  .rd-act-correct{background:rgba(59,142,240,.1);border:1px solid rgba(59,142,240,.28);color:var(--blue);}

  .confirm-card{width:320px;background:var(--surface);border:1.5px solid var(--border);border-radius:20px;padding:22px;text-align:center;animation:popIn .22s ease;}
  .confirm-card .ic{font-size:34px;margin-bottom:10px;}
  .confirm-card h3{font-family:'Unbounded';font-size:13.5px;font-weight:800;margin-bottom:6px;}
  .confirm-card p{font-size:12px;color:var(--t2);margin-bottom:18px;line-height:1.5;}

  .ex-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;}
  .ex-col-head{font-size:10.5px;color:var(--t3);text-transform:uppercase;letter-spacing:.4px;font-weight:800;margin-bottom:8px;}
  .ex-box{background:var(--surface2);border:1px solid var(--border);border-radius:13px;padding:10px;min-height:160px;max-height:220px;overflow-y:auto;}
  .ex-add-select{width:100%;background:var(--surface2);border:1.5px solid var(--border);border-radius:11px;padding:9px 11px;font-size:12px;color:var(--t1);margin-bottom:8px;}
  .ex-item{display:flex;justify-content:space-between;align-items:center;padding:6px 4px;font-size:11.5px;border-bottom:1px solid var(--border);}
  .ex-item .rm{color:var(--t3);font-size:11px;}
  .ex-item .rm:hover{color:var(--red);}
  .ex-diff{display:flex;justify-content:space-between;align-items:baseline;background:var(--surface2);border-radius:13px;padding:12px 15px;margin-bottom:14px;}
  .ex-diff .sum{font-family:'JetBrains Mono';font-size:20px;font-weight:900;}
  .ex-diff .sum.pay{color:var(--red);} .ex-diff .sum.refund{color:var(--accent);}

  .resv-card{background:var(--surface2);border:1.5px solid var(--border);border-radius:15px;padding:13px 15px;margin-bottom:10px;}
  .resv-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
  .resv-top b{font-size:12.5px;}
  .resv-top .exp{font-size:10px;color:var(--org);font-weight:700;}
  .resv-items-txt{font-size:11px;color:var(--t2);margin-bottom:10px;}
  .resv-actions{display:flex;gap:8px;}
  .resv-actions button{flex:1;padding:9px;border-radius:10px;font-size:11px;font-weight:800;}
  .resv-buy{background:var(--accent);color:var(--bg);}
  .resv-cancel{background:var(--surface3);color:var(--t2);border:1px solid var(--border);}

  .topup-breakdown{background:var(--surface2);border:1px solid var(--border);border-radius:14px;padding:14px;margin-bottom:12px;}
  .tb-row{display:flex;justify-content:space-between;font-size:12px;color:var(--t2);margin-bottom:6px;}
  .tb-row b{font-family:'JetBrains Mono';color:var(--t1);}
  .tb-row.bonus b{color:var(--gd);}
  .tb-final{display:flex;justify-content:space-between;padding-top:8px;border-top:1px dashed var(--border);font-size:13px;font-weight:800;}
  .tb-final b{font-family:'JetBrains Mono';color:var(--accent);font-size:17px;}
  .topup-btn{padding:9px;border-radius:12px;background:none;color:var(--pur);font-size:11px;font-weight:700;}
  .thresh-row{display:grid;grid-template-columns:1fr 1fr 70px 30px;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);}
  .thresh-row input{width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:7px 9px;font-size:12px;color:var(--t1);font-family:'JetBrains Mono';text-align:center;}
  .thresh-row .rm{color:var(--t3);font-size:13px;text-align:center;}
  .thresh-row .rm:hover{color:var(--red);}
  .doc-field{display:flex;align-items:center;gap:6px;font-size:12px;}
  .doc-field .l{color:var(--t3);}
  .doc-field .v{flex:1;font-weight:700;}
  .doc-field button{font-size:10.5px;color:var(--blue);font-weight:700;}

@media(max-width:800px){
  .app{grid-template-columns:1fr;grid-template-rows:auto auto auto;min-height:100%;overflow:auto}
  .topbar{grid-column:1;flex-wrap:wrap;height:auto;padding:10px 12px;gap:8px}
  .cart{border-left:none;border-top:1px solid var(--border);max-height:55vh}
}
.action-out.on{border-color:var(--gd);color:var(--gd);background:rgba(255,184,0,.08)}
.p-photo img{width:100%;height:100%;object-fit:cover;border-radius:12px}
.pos-err{margin-top:10px;padding:10px 12px;border-radius:10px;font-size:12px;background:rgba(255,69,69,.1);border:1px solid rgba(255,69,69,.3);color:var(--red)}
.client-result{width:100%;text-align:left}
.sb-item{width:100%;text-align:left}
.modal-card{max-width:92vw}
.wide-card{width:min(420px,94vw);max-height:80vh;overflow:auto}

`
