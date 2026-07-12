/** CSS из HTML-макета KAKAPO Касса (точная копия, без левого меню) */
export const POS_MOCK_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@600;700;800;900&family=Nunito:wght@400;600;700;800;900&family=JetBrains+Mono:wght@500;700;800&display=swap');

  .pos-root{
    --bg:#030B05; --surface:#0A1710; --surface2:#0F2216; --surface3:#132A1A; --border:#1A3322; --border2:#234430;
    --accent:#1FD760; --accent2:#17B34E; --gd:#FFB800; --org:#FF8C00; --blue:#3B8EF0;
    --pur:#9B6DFF; --red:#FF4545;
    --t1:#F1FBF3; --t2:#8FB897; --t3:#3D6645;
    position:fixed;inset:0;z-index:100;height:100vh;width:100vw;margin:0;background:var(--bg);color:var(--t1);font-family:'Nunito',sans-serif;overflow:hidden;
  }
  .pos-root[data-theme="purple"]{ --accent:#9B6DFF; --accent2:#7C4FE0; }
  .pos-root[data-theme="gold"]{ --accent:#FFB800; --accent2:#E0A000; }

  .pos-root *,.pos-root *::before,.pos-root *::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
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
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

  /* ══════════ SHIFT GATE ══════════ */
  .gate{position:absolute;inset:0;background:var(--bg);display:flex;align-items:center;justify-content:center;z-index:500;}
  .gate-bg{position:absolute;inset:0;opacity:.5;background:radial-gradient(circle at 20% 20%, rgba(31,215,96,.09), transparent 45%),radial-gradient(circle at 82% 78%, rgba(255,184,0,.06), transparent 45%);}
  .gate-card{position:relative;width:400px;max-width:92vw;background:var(--surface);border:1px solid var(--border);border-radius:22px;padding:32px;animation:popIn .3s cubic-bezier(.16,1,.3,1);}
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

  /* ══════════ APP SHELL (без левого меню) ══════════ */
  .app{display:grid;grid-template-columns:1fr minmax(340px,400px);grid-template-rows:64px 1fr;height:100%;}

  /* ── TOPBAR ── */
  .topbar{grid-column:1/3;display:flex;align-items:center;gap:14px;padding:0 20px;background:var(--surface);border-bottom:1px solid var(--border);}
  .btn-exit{padding:9px 12px;border-radius:12px;background:var(--surface2);border:1px solid var(--border);color:var(--t2);font-size:12px;font-weight:700;flex-shrink:0;}
  .btn-exit:hover{border-color:var(--red);color:var(--red);}
  .searchpill{flex:1;display:flex;align-items:center;gap:10px;background:var(--surface2);border:1.5px solid var(--border);border-radius:14px;padding:11px 16px;transition:border-color .2s;}
  .searchpill.active,.searchpill:focus-within{border-color:var(--accent);}
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
  .p-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:13px;}
  .p-tile{position:relative;background:var(--surface);border:1.5px solid var(--border);border-radius:16px;padding:12px;text-align:left;transition:border-color .15s,transform .1s;animation:tileIn .25s ease both;}
  .p-tile:hover{border-color:var(--accent);transform:translateY(-2px);}
  .p-tile:active{transform:translateY(0) scale(.97);}
  .p-photo{width:100%;height:78px;border-radius:12px;background:linear-gradient(145deg,var(--surface2),var(--surface3));display:flex;align-items:center;justify-content:center;font-size:38px;margin-bottom:10px;position:relative;overflow:hidden;}
  .p-photo img{width:100%;height:100%;object-fit:cover;}
  .p-weight-tag{position:absolute;top:6px;right:6px;font-size:9px;font-weight:800;background:rgba(3,11,5,.75);color:var(--t1);padding:2px 7px;border-radius:7px;}
  .p-name{font-size:12px;font-weight:800;line-height:1.25;margin-bottom:4px;min-height:30px;}
  .p-price{font-family:'JetBrains Mono';font-size:15px;font-weight:900;color:var(--gd);}
  .p-unit{font-size:9.5px;color:var(--t3);font-weight:600;}
  .p-stock{font-size:10px;color:var(--accent);margin-top:4px;font-weight:700;}
  .p-stock.low{color:var(--red);}
  .p-manual{border-style:dashed;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--t2);min-height:172px;}
  .p-manual .ic{font-size:26px;margin-bottom:8px;}
  .p-manual b{font-size:11.5px;font-weight:800;}

  /* ── CART PANEL ── */
  .cart{background:var(--surface);border-left:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;}

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
  .action-out.on{border-color:var(--gd);color:var(--gd);background:rgba(255,184,0,.08);}
  .action-out.danger{color:var(--red);border-color:rgba(255,69,69,.25);}

  .link-row{display:flex;gap:4px;padding:0 14px 6px;flex-shrink:0;justify-content:center;align-items:center;}
  .link-row button{font-size:10.5px;color:var(--t3);font-weight:700;padding:6px 10px;}
  .link-row button:hover{color:var(--t1);}

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

  /* ══════════ SHARED OVERLAYS/MODALS ══════════ */
  .overlay{position:absolute;inset:0;background:rgba(3,11,5,.75);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:200;animation:fadeIn .2s ease;}
  .scale-card{width:310px;max-width:92vw;background:var(--surface);border:1.5px solid var(--border);border-radius:22px;padding:24px;text-align:center;animation:popIn .25s cubic-bezier(.16,1,.3,1);}
  .scale-card .emoji{font-size:40px;margin-bottom:8px;}
  .scale-card h3{font-family:'Unbounded';font-size:14px;font-weight:800;margin-bottom:3px;}
  .scale-card p{font-size:11.5px;color:var(--t2);margin-bottom:16px;}
  .scale-display{background:var(--surface2);border:1px solid var(--border);border-radius:16px;padding:16px;margin-bottom:14px;}
  .scale-num{font-family:'JetBrains Mono';font-size:28px;font-weight:700;color:var(--accent);}
  .scale-label{font-size:9.5px;color:var(--t3);margin-top:3px;letter-spacing:1px;}
  .scale-price{font-family:'JetBrains Mono';font-size:20px;font-weight:900;color:var(--gd);margin-top:7px;}

  .modal-card{width:360px;max-width:92vw;background:var(--surface);border:1.5px solid var(--border);border-radius:22px;padding:22px;animation:popIn .25s cubic-bezier(.16,1,.3,1);}
  .modal-card h3{font-family:'Unbounded';font-size:13.5px;font-weight:800;margin-bottom:14px;}
  .modal-input{width:100%;background:var(--surface2);border:1.5px solid var(--border);border-radius:14px;padding:12px 15px;font-size:13.5px;color:var(--t1);outline:none;margin-bottom:12px;}
  .modal-input:focus{border-color:var(--blue);}
  .client-result{width:100%;text-align:left;padding:11px;border-radius:15px;background:var(--surface2);border:1px solid var(--border);display:flex;align-items:center;gap:10px;margin-bottom:12px;cursor:pointer;}
  .client-result:hover,.client-result.on{border-color:var(--accent);}
  .client-result .av{width:34px;height:34px;border-radius:11px;background:linear-gradient(135deg,var(--accent2),var(--accent));display:flex;align-items:center;justify-content:center;font-family:'Unbounded';font-weight:800;font-size:12px;color:var(--bg);flex-shrink:0;}
  .modal-actions{display:flex;gap:8px;}
  .modal-actions button{flex:1;padding:12px;border-radius:14px;font-weight:800;font-size:12px;}
  .btn-cancel{background:var(--surface2);color:var(--t2);border:1px solid var(--border);}
  .btn-confirm{background:var(--accent);color:var(--bg);}
  .btn-confirm:disabled{opacity:.3;background:var(--border2);color:var(--t3);}

  .kp-display{background:var(--surface2);border:1.5px solid var(--border);border-radius:16px;padding:16px;text-align:center;margin-bottom:14px;}
  .kp-display .lbl{font-size:10px;color:var(--t3);letter-spacing:.5px;margin-bottom:4px;}
  .kp-display .val{font-family:'JetBrains Mono';font-size:28px;font-weight:800;color:var(--t1);}
  .kp-quick{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px;}
  .kp-quick button{padding:8px 4px;border-radius:11px;background:var(--surface2);border:1px solid var(--border);font-size:11px;font-weight:700;color:var(--t2);}
  .kp-quick button:hover{border-color:var(--accent);color:var(--accent);}
  .keypad{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:14px;}
  .keypad button{padding:14px;border-radius:13px;background:var(--surface2);border:1px solid var(--border);font-family:'JetBrains Mono';font-size:17px;font-weight:700;}
  .keypad button:hover{background:var(--border2);}
  .keypad button:active{transform:scale(.94);}
  .keypad button.kp-clear{color:var(--red);font-family:'Nunito';font-size:12px;font-weight:800;}

  .toast{position:absolute;bottom:28px;left:50%;transform:translateX(-50%);background:var(--surface);border:1.5px solid var(--accent);border-radius:18px;padding:14px 20px;display:flex;align-items:center;gap:11px;box-shadow:0 14px 32px rgba(0,0,0,.5);z-index:300;animation:toastIn .3s cubic-bezier(.16,1,.3,1);}
  .toast .ic{width:34px;height:34px;border-radius:11px;background:rgba(31,215,96,.15);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}
  .toast b{font-size:13px;display:block;}
  .toast span{font-size:10.5px;color:var(--t2);}

  .wide-card{width:420px;max-width:94vw;max-height:80vh;display:flex;flex-direction:column;overflow:auto;}
  .z-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:14px;}
  .z-stat{background:var(--surface2);border:1px solid var(--border);border-radius:15px;padding:13px;}
  .z-stat .l{font-size:9.5px;color:var(--t3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:5px;}
  .z-stat .v{font-family:'JetBrains Mono';font-size:17px;font-weight:800;}

  .pos-err{margin-top:10px;padding:10px 12px;border-radius:10px;font-size:12px;background:rgba(255,69,69,.1);border:1px solid rgba(255,69,69,.3);color:var(--red);}

  @media(max-width:1200px){
    .p-grid{grid-template-columns:repeat(4,minmax(0,1fr));}
  }
  @media(max-width:800px){
    .app{grid-template-columns:1fr;grid-template-rows:auto auto auto;min-height:100%;overflow:auto;}
    .topbar{grid-column:1;flex-wrap:wrap;height:auto;padding:10px 12px;gap:8px;}
    .cart{border-left:none;border-top:1px solid var(--border);max-height:55vh;}
    .p-grid{grid-template-columns:repeat(auto-fill,minmax(120px,1fr));}
  }
`
