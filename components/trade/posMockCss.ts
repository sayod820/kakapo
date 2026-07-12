/** CSS 1:1 из kakapo-kassa-v5.html (scoped под .pos-root) */
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
  @keyframes paperOut{0%{transform:translate(-50%,-100%);opacity:0}12%{opacity:1}100%{transform:translate(-50%,0);opacity:1}}
  @keyframes tearDrop{to{transform:translate(-50%,14px) rotate(1deg);opacity:0}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  @keyframes scanFlash{0%{box-shadow:inset 0 0 0 2px rgba(31,215,96,.7)}100%{box-shadow:inset 0 0 0 2px transparent}}

  .gate{position:fixed;inset:0;background:var(--bg);display:flex;align-items:center;justify-content:center;z-index:500;}
  .gate.hide{display:none;}
  .gate-bg{position:absolute;inset:0;opacity:.5;background:radial-gradient(circle at 20% 20%, rgba(31,215,96,.09), transparent 45%),radial-gradient(circle at 82% 78%, rgba(255,184,0,.06), transparent 45%);}
  .gate-card{position:relative;width:400px;background:var(--surface);border:1px solid var(--border);border-radius:22px;padding:32px;animation:popIn .3s cubic-bezier(.16,1,.3,1);}
  .gate-logo{width:50px;height:50px;border-radius:16px;background:linear-gradient(135deg,var(--accent2),var(--accent));display:flex;align-items:center;justify-content:center;font-family:'Unbounded';font-weight:900;font-size:21px;color:var(--bg);margin:0 auto 14px;}
  .gate-title{font-family:'Unbounded';font-size:16px;font-weight:800;text-align:center;margin-bottom:4px;}
  .gate-sub{font-size:12px;color:var(--t2);text-align:center;margin-bottom:24px;}
  .gate-label{font-size:11px;font-weight:700;color:var(--t2);margin-bottom:8px;display:block;}
  .cashier-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:20px;}
  .pos-root button.cashier-opt{padding:12px 5px;border-radius:14px;border:1.5px solid var(--border);background:var(--surface2);text-align:center;}
  .pos-root button.cashier-opt.on{border-color:var(--accent);background:rgba(31,215,96,.08);}
  .cashier-opt .av{width:32px;height:32px;border-radius:10px;background:var(--border2);display:flex;align-items:center;justify-content:center;font-family:'Unbounded';font-weight:800;font-size:11px;margin:0 auto 6px;}
  .cashier-opt.on .av{background:linear-gradient(135deg,var(--accent2),var(--accent));color:var(--bg);}
  .cashier-opt span{font-size:10.5px;font-weight:700;color:var(--t2);}
  .cashier-opt.on span{color:var(--t1);}
  .gate-input{width:100%;background:var(--surface2);border:1.5px solid var(--border);border-radius:13px;padding:13px 15px;font-size:14px;font-weight:700;color:var(--t1);outline:none;margin-bottom:20px;font-family:'JetBrains Mono';}
  .gate-input:focus{border-color:var(--accent);}
  .pos-root button.btn-gate{width:100%;padding:14px;border-radius:14px;background:linear-gradient(135deg,var(--accent2),var(--accent));color:var(--bg);font-weight:800;font-size:14px;}

  .app{display:grid;grid-template-columns:1fr minmax(720px,780px);grid-template-rows:64px 1fr;height:100%;}

  .topbar{grid-column:1/3;display:flex;align-items:center;gap:12px;padding:0 16px;background:var(--surface);border-bottom:1px solid var(--border);}
  .top-meta{display:flex;align-items:center;gap:12px;flex-shrink:0;padding:4px 0;}
  .top-loc{line-height:1.2;min-width:0;}
  .top-loc b{font-size:12px;font-weight:800;display:block;white-space:nowrap;}
  .top-loc .dot-row{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--accent);margin-top:2px;font-weight:700;}
  .top-loc .dot-row .d{width:6px;height:6px;border-radius:50%;background:var(--accent);animation:pulse 2s infinite;flex-shrink:0;}
  .top-clock{text-align:left;line-height:1.15;padding:0 2px;border-left:1px solid var(--border);padding-left:12px;}
  .top-clock .tm{font-family:'JetBrains Mono';font-size:18px;font-weight:800;color:var(--gd);letter-spacing:.3px;}
  .top-clock .dt{font-size:10px;color:var(--t3);margin-top:1px;white-space:nowrap;}
  .pos-root button.btn-switch-till{padding:9px 12px;border-radius:12px;background:var(--surface2);border:1.5px solid var(--border);color:var(--t1);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:7px;white-space:nowrap;flex-shrink:0;}
  .pos-root button.btn-switch-till:hover{border-color:var(--accent);color:var(--accent);}
  .pos-root button.btn-switch-till .sw-ic{width:18px;height:18px;border-radius:6px;background:linear-gradient(135deg,#1E5BB5,var(--blue));display:flex;align-items:center;justify-content:center;font-size:10px;flex-shrink:0;}
  .searchpill{flex:1;min-width:160px;max-width:none;display:flex;align-items:center;gap:10px;background:var(--surface2);border:1.5px solid var(--border);border-radius:14px;padding:11px 16px;transition:border-color .2s;}
  .searchpill.active,.searchpill:focus-within{border-color:var(--accent);}
  .searchpill .ic{font-size:14px;color:var(--t2);}
  .searchpill input{flex:1;background:none;border:none;outline:none;font-size:13.5px;color:var(--t1);}
  .searchpill input::placeholder{color:var(--t3);}
  .scan-tag{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--t3);font-weight:700;padding-left:10px;border-left:1px solid var(--border);flex-shrink:0;}
  .theme-dots{display:flex;gap:6px;flex-shrink:0;}
  .theme-dot{width:22px;height:22px;border-radius:50%;border:2px solid var(--border);cursor:pointer;transition:transform .12s;}
  .theme-dot:hover{transform:scale(1.12);}
  .theme-dot.on{border-color:var(--t1);}
  .pos-root button.bell-btn{position:relative;width:38px;height:38px;border-radius:12px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}
  .pos-root button.bell-btn:hover{background:var(--border2);}
  .bell-badge{position:absolute;top:5px;right:5px;width:8px;height:8px;border-radius:50%;background:var(--red);}
  .pos-root button.account-btn{display:flex;align-items:center;gap:9px;padding:6px 10px 6px 6px;border-radius:13px;flex-shrink:0;}
  .pos-root button.account-btn:hover{background:var(--surface2);}
  .account-av{width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,#1E5BB5,var(--blue));display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;font-family:'Unbounded';flex-shrink:0;}
  .account-btn .info{text-align:left;line-height:1.2;}
  .account-btn .info b{font-size:12px;display:block;}
  .account-btn .info span{font-size:9.5px;color:var(--t3);}

  .products{background:var(--bg);overflow:hidden;display:flex;flex-direction:column;}
  .cat-row{display:flex;gap:9px;padding:14px 20px 6px;overflow-x:auto;flex-shrink:0;}
  .pos-root button.cat-pill{padding:9px 16px;border-radius:13px;font-size:12px;font-weight:700;background:var(--surface);border:1.5px solid var(--border);color:var(--t2);white-space:nowrap;display:flex;align-items:center;gap:7px;flex-shrink:0;}
  .pos-root button.cat-pill.on{background:var(--accent);border-color:var(--accent);color:var(--bg);}

  .grid-wrap{flex:1;overflow-y:auto;padding:8px 20px 20px;}
  .p-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:13px;}
  .pos-root button.p-tile{position:relative;background:var(--surface);border:1.5px solid var(--border);border-radius:16px;padding:12px;text-align:left;transition:border-color .15s,transform .1s;animation:tileIn .25s ease both;}
  .pos-root button.p-tile:hover{border-color:var(--accent);transform:translateY(-2px);}
  .pos-root button.p-tile:active{transform:translateY(0) scale(.97);}
  .p-photo{width:100%;height:78px;border-radius:12px;background:linear-gradient(145deg,var(--surface2),var(--surface3));display:flex;align-items:center;justify-content:center;font-size:38px;margin-bottom:10px;position:relative;overflow:hidden;}
  .p-photo img{width:100%;height:100%;object-fit:cover;}
  .p-weight-tag{position:absolute;top:6px;right:6px;font-size:9px;font-weight:800;background:rgba(3,11,5,.75);color:var(--t1);padding:2px 7px;border-radius:7px;}
  .p-name{font-size:12px;font-weight:800;line-height:1.25;margin-bottom:3px;min-height:30px;}
  .p-codes{display:flex;flex-direction:column;gap:1px;margin-bottom:5px;min-height:22px;}
  .p-codes span{font-size:9.5px;font-weight:700;color:var(--t3);font-family:'JetBrains Mono',monospace;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .p-codes .muted{font-family:'Nunito',sans-serif;font-weight:600;opacity:.7;}
  .p-price{font-family:'JetBrains Mono';font-size:15px;font-weight:900;color:var(--gd);}
  .p-unit{font-size:9.5px;color:var(--t3);font-weight:600;}
  .p-stock{font-size:10px;color:var(--accent);margin-top:4px;font-weight:700;}
  .p-stock.low{color:var(--red);}

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
  .pos-root button.client-x{width:22px;height:22px;border-radius:7px;color:var(--t3);font-size:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;}
  .pos-root button.client-x:hover{background:rgba(255,69,69,.12);color:var(--red);}

  .tier-strip{margin:10px 14px 0;padding:9px 12px;border-radius:13px;background:rgba(255,184,0,.06);border:1px solid rgba(255,184,0,.2);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;font-size:11px;}
  .tier-strip .lbl{color:var(--t2);}
  .tier-strip b{color:var(--gd);font-family:'JetBrains Mono';}
  .discount-strip{margin:8px 14px 0;padding:9px 12px;border-radius:13px;background:var(--surface2);border:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;font-size:11px;}
  .discount-strip .set-btn{font-size:10.5px;color:var(--blue);font-weight:800;}

  .cart-items{flex:1;overflow-y:auto;padding:10px 14px;min-height:160px;}
  .cart-empty{text-align:center;color:var(--t3);padding:36px 10px;}
  .cart-empty .ic{font-size:34px;opacity:.5;margin-bottom:8px;}
  .cart-row{display:flex;align-items:center;gap:10px;padding:11px 8px;border-radius:14px;animation:rowIn .18s ease both;border:1px solid transparent;}
  .cart-row:hover{background:var(--surface2);border-color:var(--border);}
  .cart-row .ic{width:44px;height:44px;border-radius:12px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;}
  .cart-row .info{flex:1;min-width:0;}
  .cart-row .name{font-size:13.5px;font-weight:800;line-height:1.25;}
  .cart-row .codes{display:flex;flex-wrap:wrap;gap:6px 10px;margin-top:3px;}
  .cart-row .codes span{font-size:10px;font-weight:700;color:var(--t3);font-family:'JetBrains Mono',monospace;}
  .cart-row .sub{font-size:11px;color:var(--t3);margin-top:3px;}
  .cart-row .sub .w{color:var(--pur);font-weight:700;}
  .qtyctrl{display:flex;align-items:center;gap:7px;background:var(--surface2);border-radius:10px;padding:5px;flex-shrink:0;}
  .qtyctrl button{width:24px;height:24px;border-radius:8px;font-size:14px;font-weight:800;color:var(--t2);}
  .qtyctrl button:hover{background:var(--border2);color:var(--t1);}
  .qtyctrl span{font-size:13px;font-weight:800;min-width:18px;text-align:center;font-family:'JetBrains Mono';}
  .cart-row .price{font-family:'JetBrains Mono';font-size:15px;font-weight:900;color:var(--gd);flex-shrink:0;min-width:68px;text-align:right;}
  .pos-root button.rm{width:24px;height:24px;border-radius:8px;color:var(--t3);font-size:13px;flex-shrink:0;}
  .pos-root button.rm:hover{background:rgba(255,69,69,.12);color:var(--red);}

  .cart-totals{padding:10px 14px;border-top:1px solid var(--border);flex-shrink:0;}
  .tot-row{display:flex;justify-content:space-between;font-size:12px;color:var(--t2);margin-bottom:5px;}
  .tot-row.disc span:last-child{color:var(--red);}
  .tot-final{display:flex;justify-content:space-between;align-items:baseline;padding-top:8px;margin-top:2px;border-top:1px dashed var(--border);}
  .tot-final b{font-family:'Unbounded';font-size:12px;}
  .tot-final .sum{font-family:'JetBrains Mono';font-size:22px;font-weight:900;color:var(--accent);}

  .ops-block{padding:0 14px 6px;flex-shrink:0;}
  .ops-block.pay-block{padding-bottom:0;}
  .ops-lbl{font-size:9.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--t3);margin:2px 0 6px;}
  .action-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0;flex-shrink:0;}
  .pos-root button.action-chip{padding:9px 6px;border-radius:12px;text-align:center;display:flex;flex-direction:row;align-items:center;justify-content:center;gap:8px;min-height:42px;transition:border-color .12s,background .12s;}
  .action-chip .ic-wrap{width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;}
  .action-chip span{font-size:11px;font-weight:700;color:var(--t2);}
  .pos-root button.ac-discount{background:rgba(155,109,255,.08);border:1.5px solid rgba(155,109,255,.28);}
  .ac-discount .ic-wrap{background:rgba(155,109,255,.18);}
  .pos-root button.ac-discount:hover,.pos-root button.ac-discount.on{border-color:var(--pur);background:rgba(155,109,255,.14);}
  .pos-root button.ac-discount.on span{color:var(--pur);}
  .pos-root button.ac-bonus{background:rgba(255,184,0,.08);border:1.5px solid rgba(255,184,0,.28);}
  .ac-bonus .ic-wrap{background:rgba(255,184,0,.18);}
  .pos-root button.ac-bonus:hover,.pos-root button.ac-bonus.on{border-color:var(--gd);background:rgba(255,184,0,.14);}
  .pos-root button.ac-bonus.on span{color:var(--gd);}
  .pos-root button.ac-repay{background:rgba(255,140,0,.08);border:1.5px solid rgba(255,140,0,.28);}
  .ac-repay .ic-wrap{background:rgba(255,140,0,.18);}
  .pos-root button.ac-repay:hover{border-color:var(--org);}
  .pos-root button.ac-topup{background:rgba(31,215,96,.08);border:1.5px solid rgba(31,215,96,.28);}
  .ac-topup .ic-wrap{background:rgba(31,215,96,.18);}
  .pos-root button.ac-topup:hover{border-color:var(--accent);}

  .link-row{display:flex;gap:4px;padding:4px 14px 8px;flex-shrink:0;justify-content:center;align-items:center;}
  .link-row button{font-size:11px;color:#6B8F76;font-weight:700;padding:4px 10px;}
  .link-row button:hover{color:var(--t1);}

  .pay-grid{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;padding:0 0 8px;flex-shrink:0;}
  .pos-root button.pay-btn{padding:10px 4px;border-radius:14px;text-align:center;font-size:10.5px;font-weight:800;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:56px;border:2px solid transparent;opacity:1;transition:transform .12s,box-shadow .12s,border-color .12s;}
  .pay-btn .ic{font-size:18px;line-height:1;}
  .pos-root button.pay-btn.on{transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.3);border-color:rgba(255,255,255,.22);}
  .pos-root button.pay-btn.disabled{opacity:1;pointer-events:none;filter:none;}
  .pos-root button.pay-cash{background:#22C55E;border-color:#1AA34A;}
  .pos-root button.pay-cash.on{background:#16A34A;border-color:#86EFAC;box-shadow:0 4px 12px rgba(34,197,94,.3);}
  .pos-root button.pay-card{background:#3B82F6;border-color:#2563EB;}
  .pos-root button.pay-card.on{background:#2563EB;border-color:#93C5FD;box-shadow:0 4px 12px rgba(59,130,246,.3);}
  .pos-root button.pay-credit{background:#EA580C;border-color:#C2410C;}
  .pos-root button.pay-credit.on{background:#C2410C;border-color:#FDBA74;box-shadow:0 4px 12px rgba(234,88,12,.3);}
  .pos-root button.pay-balance{background:#2A2A3D;border-color:#3A3A52;color:#7A7A96;}
  .pos-root button.pay-balance.on{background:#3B2F66;border-color:#9B6DFF;color:#fff;box-shadow:0 4px 12px rgba(155,109,255,.28);}
  .pos-root button.pay-balance.disabled{background:#232334;border-color:#2E2E42;color:#5C5C78;}
  .pos-root button.pay-qr{background:#EAB308;border-color:#CA8A04;color:#1C1400;}
  .pos-root button.pay-qr.on{background:#F59E0B;border-color:#FDE68A;color:#1C1400;box-shadow:0 4px 12px rgba(234,179,8,.3);}

  .pos-root button.btn-checkout{margin:0 14px 12px;padding:12px;border-radius:14px;background:linear-gradient(135deg,var(--accent2),var(--accent));color:var(--bg);font-weight:800;font-size:13.5px;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 6px 16px rgba(31,215,96,.22);}
  .pos-root button.btn-checkout:disabled{opacity:.3;box-shadow:none;}

  .overlay{position:fixed;inset:0;background:rgba(3,11,5,.75);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:200;animation:fadeIn .2s ease;}
  .modal-card{width:360px;background:var(--surface);border:1.5px solid var(--border);border-radius:22px;padding:22px;animation:popIn .25s cubic-bezier(.16,1,.3,1);max-width:92vw;}
  .modal-card h3{font-family:'Unbounded';font-size:13.5px;font-weight:800;margin-bottom:14px;}
  .modal-input{width:100%;background:var(--surface2);border:1.5px solid var(--border);border-radius:14px;padding:12px 15px;font-size:13.5px;color:var(--t1);outline:none;margin-bottom:12px;}
  .modal-input:focus{border-color:var(--blue);}
  .client-result{padding:11px;border-radius:15px;background:var(--surface2);border:1px solid var(--border);display:flex;align-items:center;gap:10px;margin-bottom:12px;cursor:pointer;width:100%;text-align:left;}
  .client-result:hover{border-color:var(--accent);}
  .client-result .av{width:34px;height:34px;border-radius:11px;background:linear-gradient(135deg,var(--accent2),var(--accent));display:flex;align-items:center;justify-content:center;font-family:'Unbounded';font-weight:800;font-size:12px;color:var(--bg);flex-shrink:0;}
  .client-result .ci{flex:1;line-height:1.25;}
  .client-result .ci b{font-size:12.5px;display:block;}
  .client-result .ci span{font-size:10px;color:var(--t2);}
  .tier-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:7px;font-size:9px;font-weight:800;}
  .modal-card-actions,.modal-actions{display:flex;gap:8px;}
  .modal-card-actions button,.modal-actions button{flex:1;padding:12px;border-radius:14px;font-weight:800;font-size:12px;}
  .pos-root button.btn-cancel{background:var(--surface2);color:var(--t2);border:1px solid var(--border);}
  .pos-root button.btn-confirm{background:var(--accent);color:var(--bg);}
  .pos-root button.btn-confirm:disabled{opacity:.3;background:var(--border2);color:var(--t3);}

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

  .toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:var(--surface);border:1.5px solid var(--accent);border-radius:18px;padding:14px 20px;display:flex;align-items:center;gap:11px;box-shadow:0 14px 32px rgba(0,0,0,.5);z-index:300;animation:toastIn .3s cubic-bezier(.16,1,.3,1);}
  .toast .ic{width:34px;height:34px;border-radius:11px;background:rgba(31,215,96,.15);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}
  .toast b{font-size:13px;display:block;}
  .toast span{font-size:10.5px;color:var(--t2);}

  .wide-card{width:420px;max-height:80vh;display:flex;flex-direction:column;}
  .z-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:14px;}
  .z-stat{background:var(--surface2);border:1px solid var(--border);border-radius:15px;padding:13px;}
  .z-stat .l{font-size:9.5px;color:var(--t3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:5px;}
  .z-stat .v{font-family:'JetBrains Mono';font-size:17px;font-weight:800;}
  .pos-err{margin-top:10px;padding:10px 12px;border-radius:10px;font-size:12px;background:rgba(255,69,69,.1);border:1px solid rgba(255,69,69,.3);color:var(--red);}

  @media(max-width:900px){
    .app{grid-template-columns:1fr;grid-template-rows:auto auto auto;min-height:100%;overflow:auto;height:auto;}
    .topbar{grid-column:1;flex-wrap:wrap;height:auto;padding:10px 12px;gap:8px;}
    .top-meta{width:100%;justify-content:space-between;order:-1;}
    .searchpill{max-width:none;min-width:0;width:100%;}
    .cart{border-left:none;border-top:1px solid var(--border);max-height:55vh;}
  }
`
