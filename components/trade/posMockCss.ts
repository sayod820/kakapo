/** CSS 1:1 из kakapo-kassa-v5.html (scoped под .pos-root) */
export const POS_MOCK_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@600;700;800;900&family=Nunito:wght@400;600;700;800;900&family=JetBrains+Mono:wght@500;700;800&display=swap');

  .pos-root{
    --bg:#030B05; --surface:#0A1710; --surface2:#0F2216; --surface3:#132A1A; --border:#1A3322; --border2:#234430;
    --accent:#1FD760; --accent2:#17B34E; --gd:#FFB800; --org:#FF8C00; --blue:#3B8EF0;
    --pur:#9B6DFF; --red:#FF4545;
    --t1:#F1FBF3; --t2:#8FB897; --t3:#3D6645;
    --shade:rgba(0,0,0,.5);
    position:fixed;inset:0;z-index:100;height:100vh;width:100vw;margin:0;background:var(--bg);color:var(--t1);font-family:'Nunito',sans-serif;overflow:hidden;
  }
  .pos-root[data-theme="dark"],.pos-root[data-theme="green"],.pos-root[data-theme="purple"],.pos-root[data-theme="gold"]{
    --bg:#030B05; --surface:#0A1710; --surface2:#0F2216; --surface3:#132A1A; --border:#1A3322; --border2:#234430;
    --accent:#1FD760; --accent2:#17B34E;
    --t1:#F1FBF3; --t2:#8FB897; --t3:#3D6645;
    --shade:rgba(0,0,0,.5);
  }
  .pos-root[data-theme="light"]{
    --bg:#F3F7F4; --surface:#FFFFFF; --surface2:#EAF1EC; --surface3:#DFEAE2; --border:#D0DDD4; --border2:#BCCBBF;
    --accent:#129B45; --accent2:#0E7F38;
    --t1:#0C1A10; --t2:#4A6B52; --t3:#7A9580;
    --shade:rgba(12,26,16,.18);
    --gd:#C48A00; --org:#D97706; --blue:#2563EB; --pur:#7C3AED; --red:#DC2626;
  }

  .pos-root *,.pos-root *::before,.pos-root *::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
  .ub{font-family:'Unbounded',sans-serif;}
  .mono{font-family:'JetBrains Mono',monospace;}
  .pos-root button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit;}
  .pos-root input,.pos-root select{font-family:inherit;color:inherit;background:transparent;}
  .pos-root input::placeholder,.pos-root textarea::placeholder{color:var(--t3);}
  .pos-root input:-webkit-autofill,
  .pos-root input:-webkit-autofill:hover,
  .pos-root input:-webkit-autofill:focus{
    -webkit-text-fill-color:var(--t1);
    caret-color:var(--t1);
    box-shadow:0 0 0 1000px var(--surface2) inset;
    transition:background-color 99999s ease-out;
  }
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

  .topbar{grid-column:1/3;display:flex;align-items:center;gap:10px;padding:0 14px;background:var(--surface);border-bottom:1px solid var(--border);}
  .top-meta{display:flex;align-items:center;gap:10px;flex-shrink:0;padding:4px 0;margin-left:auto;}
  .top-loc{line-height:1.2;min-width:0;flex-shrink:0;padding-right:4px;}
  .top-loc b{font-size:12px;font-weight:800;display:block;white-space:nowrap;}
  .top-loc .dot-row{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--accent);margin-top:2px;font-weight:700;}
  .top-loc .dot-row .d{width:6px;height:6px;border-radius:50%;background:var(--accent);animation:pulse 2s infinite;flex-shrink:0;}
  .top-clock{text-align:left;line-height:1.15;padding:0 2px;border-left:1px solid var(--border);padding-left:12px;}
  .top-clock .tm{font-family:'JetBrains Mono';font-size:18px;font-weight:800;color:var(--gd);letter-spacing:.3px;}
  .top-clock .dt{font-size:10px;color:var(--t3);margin-top:1px;white-space:nowrap;}
  .pos-root button.btn-switch-till{padding:9px 12px;border-radius:12px;background:var(--surface2);border:1.5px solid var(--border);color:var(--t1);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:7px;white-space:nowrap;flex-shrink:0;}
  .pos-root button.btn-switch-till:hover{border-color:var(--accent);color:var(--accent);}
  .pos-root button.btn-switch-till .sw-ic{width:18px;height:18px;border-radius:6px;background:linear-gradient(135deg,#1E5BB5,var(--blue));display:flex;align-items:center;justify-content:center;font-size:10px;flex-shrink:0;}
  .searchpill{
    flex:0 1 340px;width:340px;max-width:min(340px,36vw);min-width:180px;
    display:flex;align-items:center;gap:8px;
    background:var(--surface2);border:1.5px solid var(--border);border-radius:12px;
    padding:8px 10px 8px 12px;transition:border-color .2s,box-shadow .15s;
  }
  .searchpill.active,.searchpill:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px rgba(31,215,96,.12);}
  .searchpill .ic{font-size:13px;color:var(--t3);flex-shrink:0;display:flex;align-items:center;}
  .searchpill .ic svg{display:block;}
  .searchpill input{flex:1;min-width:0;background:none;border:none;outline:none;box-shadow:none;font-size:12.5px;font-weight:700;color:var(--t1);-webkit-appearance:none;appearance:none;}
  .searchpill input::placeholder{color:var(--t3);font-weight:600;}
  .pos-root[data-theme="light"] .searchpill:focus-within{box-shadow:0 0 0 3px rgba(18,155,69,.12);}
  .scan-tag{display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;font-size:12px;color:var(--t2);background:var(--surface);border:1px solid var(--border);flex-shrink:0;}
  .theme-toggle{display:flex;align-items:center;gap:2px;padding:3px;border-radius:12px;background:var(--surface2);border:1.5px solid var(--border);flex-shrink:0;}
  .pos-root button.theme-mode{width:32px;height:28px;border-radius:9px;display:flex;align-items:center;justify-content:center;color:var(--t3);transition:background .15s,color .15s;}
  .pos-root button.theme-mode:hover{color:var(--t1);}
  .pos-root button.theme-mode.on{background:var(--surface);color:var(--accent);box-shadow:0 1px 4px var(--shade);}
  .pos-root button.bell-btn{position:relative;width:38px;height:38px;border-radius:12px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}
  .pos-root button.bell-btn:hover{background:var(--border2);}
  .bell-badge{position:absolute;top:5px;right:5px;width:8px;height:8px;border-radius:50%;background:var(--red);}
  .account-wrap{position:relative;flex-shrink:0;}
  .pos-root button.account-btn{display:flex;align-items:center;gap:9px;padding:6px 10px 6px 6px;border-radius:13px;flex-shrink:0;}
  .pos-root button.account-btn:hover,.pos-root button.account-btn.on{background:var(--surface2);}
  .account-av{width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,#1E5BB5,var(--blue));display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;font-family:'Unbounded';flex-shrink:0;}
  .account-btn .info{text-align:left;line-height:1.2;}
  .account-btn .info b{font-size:12px;display:block;}
  .account-btn .info span{font-size:9.5px;color:var(--t3);}
  .account-menu{
    position:absolute;top:calc(100% + 8px);right:0;width:280px;z-index:80;
    background:var(--surface);border:1.5px solid var(--border);border-radius:16px;
    box-shadow:0 16px 40px var(--shade);padding:8px;animation:popIn .2s cubic-bezier(.16,1,.3,1);
  }
  .account-menu-head{padding:10px 12px 12px;border-bottom:1px solid var(--border);margin-bottom:6px;}
  .account-menu-head b{display:block;font-size:13px;font-weight:800;}
  .account-menu-head span{font-size:10.5px;color:var(--accent);font-weight:700;}
  .pos-root button.account-menu-item{
    width:100%;display:flex;align-items:flex-start;gap:10px;text-align:left;
    padding:11px 12px;border-radius:12px;color:var(--t1);
  }
  .pos-root button.account-menu-item:hover{background:var(--surface2);}
  .pos-root button.account-menu-item .ami-ic{
    width:34px;height:34px;border-radius:11px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
    background:var(--surface2);border:1px solid var(--border);font-size:15px;
  }
  .pos-root button.account-menu-item b{display:block;font-size:12.5px;font-weight:800;}
  .pos-root button.account-menu-item i{display:block;font-style:normal;font-size:10.5px;color:var(--t3);margin-top:2px;font-weight:600;}
  .pos-root button.account-menu-item.danger .ami-ic{background:rgba(255,69,69,.1);border-color:rgba(255,69,69,.25);}
  .pos-root button.account-menu-item.danger b{color:var(--red);}

  .cashier-screen{
    position:fixed;inset:0;z-index:180;background:var(--bg);color:var(--t1);
    display:flex;align-items:stretch;justify-content:center;overflow:auto;animation:fadeIn .2s ease;
  }
  .cashier-screen-inner{
    width:min(720px,100%);margin:0 auto;padding:28px 24px 40px;display:flex;flex-direction:column;min-height:100%;
  }
  .cashier-screen-top{display:flex;align-items:flex-start;gap:14px;margin-bottom:22px;}
  .cashier-screen-top h2{font-family:'Unbounded',sans-serif;font-size:20px;font-weight:800;margin:0 0 4px;}
  .cashier-screen-top p{font-size:12px;color:var(--t2);margin:0;font-weight:700;}
  .cashier-screen-grid{margin-bottom:20px;}
  .cashier-switch-block{margin-bottom:18px;}
  .switch-grid{grid-template-columns:repeat(auto-fill,minmax(100px,1fr));}
  .cashier-screen-actions{display:flex;gap:10px;margin-top:auto;padding-top:18px;}
  .cashier-screen-actions button{flex:1;padding:14px;border-radius:14px;font-weight:800;font-size:13px;}
  .cashier-screen .gate-input{margin-bottom:10px;}
  .cashier-screen .gate-label{margin-bottom:8px;}

  .products{background:var(--bg);overflow:hidden;display:flex;flex-direction:column;}
  .cat-nav{flex-shrink:0;padding:12px 20px 4px;display:flex;flex-direction:column;gap:8px;}
  .cat-quick,.cat-sub{display:flex;gap:8px;overflow-x:auto;align-items:center;padding-bottom:2px;}
  .cat-row{display:flex;gap:9px;padding:14px 20px 6px;overflow-x:auto;flex-shrink:0;}
  .pos-root button.cat-pill{padding:9px 16px;border-radius:13px;font-size:12px;font-weight:700;background:var(--surface);border:1.5px solid var(--border);color:var(--t2);white-space:nowrap;display:flex;align-items:center;gap:7px;flex-shrink:0;}
  .pos-root button.cat-pill.sm{padding:7px 12px;font-size:11px;border-radius:11px;}
  .pos-root button.cat-pill.on{background:var(--accent);border-color:var(--accent);color:var(--bg);}
  .pos-root button.cat-pill.cat-fav.on{background:linear-gradient(135deg,#C9A227,var(--gd));border-color:var(--gd);color:#1a1200;}
  .pos-root button.cat-browse-btn{padding:9px 14px;border-radius:13px;font-size:12px;font-weight:800;background:var(--surface2);border:1.5px solid var(--border2);color:var(--t1);white-space:nowrap;flex-shrink:0;margin-left:auto;}
  .pos-root button.cat-browse-btn:hover{border-color:var(--accent);color:var(--accent);}
  .cat-empty{flex:1;min-height:220px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--t2);text-align:center;padding:40px 20px;}
  .cat-empty-ic{font-size:36px;color:var(--gd);opacity:.85;}
  .cat-empty b{font-size:14px;color:var(--t1);}
  .cat-empty span{font-size:12px;color:var(--t3);max-width:260px;}
  .modal-card.cat-browse-card{width:520px;max-height:min(82vh,640px);display:flex;flex-direction:column;}
  .cat-browse-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;overflow-y:auto;flex:1;min-height:180px;max-height:420px;padding:4px 2px 8px;margin-bottom:10px;}
  .pos-root button.cat-browse-item{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:12px;border-radius:14px;background:var(--surface2);border:1.5px solid var(--border);text-align:left;min-height:96px;}
  .pos-root button.cat-browse-item:hover{border-color:var(--accent);}
  .pos-root button.cat-browse-item.on{border-color:var(--accent);background:rgba(31,215,96,.1);}
  .cat-browse-emoji{font-size:22px;line-height:1;}
  .cat-browse-name{font-size:12px;font-weight:800;color:var(--t1);line-height:1.25;}
  .cat-browse-parent{font-size:10px;font-weight:700;color:var(--t3);}
  .cat-browse-count{font-size:11px;font-weight:800;color:var(--accent);font-family:'JetBrains Mono',monospace;margin-top:auto;}
  .cat-browse-empty{grid-column:1/-1;text-align:center;padding:28px 12px;color:var(--t3);font-size:13px;font-weight:700;}

  .grid-wrap{flex:1;overflow-y:auto;padding:8px 20px 20px;}
  .p-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:13px;}
  .pos-root button.p-tile{position:relative;background:var(--surface);border:1.5px solid var(--border);border-radius:16px;padding:12px;text-align:left;transition:border-color .15s,transform .1s;animation:tileIn .25s ease both;}
  .pos-root button.p-tile:hover{border-color:var(--accent);transform:translateY(-2px);}
  .pos-root button.p-tile:active{transform:translateY(0) scale(.97);}
  .p-fav{position:absolute;top:8px;right:8px;z-index:2;width:28px;height:28px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:15px;line-height:1;color:var(--t3);background:rgba(3,11,5,.55);border:1px solid var(--border);cursor:pointer;}
  .pos-root[data-theme="light"] .p-fav{background:rgba(255,255,255,.85);}
  .p-fav:hover{color:var(--gd);border-color:var(--gd);}
  .p-fav.on{color:var(--gd);border-color:rgba(255,184,0,.45);background:rgba(255,184,0,.16);}
  .p-photo{width:100%;height:78px;border-radius:12px;background:linear-gradient(145deg,var(--surface2),var(--surface3));display:flex;align-items:center;justify-content:center;font-size:38px;margin-bottom:10px;position:relative;overflow:hidden;}
  .p-photo img{width:100%;height:100%;object-fit:cover;}
  .p-weight-tag{position:absolute;top:6px;left:6px;font-size:9px;font-weight:800;background:rgba(3,11,5,.78);color:#F1FBF3;padding:2px 7px;border-radius:7px;}
  .pos-root[data-theme="light"] .p-weight-tag{background:rgba(12,26,16,.88);color:#FFFFFF;}
  .p-name{font-size:12px;font-weight:800;line-height:1.25;margin-bottom:3px;min-height:30px;}
  .p-codes{display:flex;flex-wrap:nowrap;align-items:center;gap:0;margin-bottom:5px;min-height:16px;overflow:hidden;white-space:nowrap;}
  .p-codes span{font-size:9.5px;font-weight:700;color:var(--t3);font-family:'JetBrains Mono',monospace;line-height:1.25;overflow:hidden;text-overflow:ellipsis;}
  .p-codes span + span::before{content:'·';margin:0 6px;color:var(--border2);font-weight:800;}
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
  .client-info .nm-row{display:flex;align-items:center;gap:8px;min-width:0;}
  .client-info .nm{font-size:12.5px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .pos-root button.client-hist-link,.client-hist-link{flex-shrink:0;font-size:10px;font-weight:800;color:var(--blue);padding:2px 0;background:transparent;border:none;}
  .client-card:hover .client-hist-link{color:var(--accent);text-decoration:underline;}
  .client-info .ph{font-size:10px;color:var(--t2);}
  .pos-root button.client-qr-btn{flex-shrink:0;height:34px;padding:0 10px;border-radius:10px;font-size:11px;font-weight:800;color:var(--accent);background:rgba(31,215,96,.1);border:1.5px solid rgba(31,215,96,.28);white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:6px;}
  .pos-root button.client-qr-btn:hover{border-color:var(--accent);background:rgba(31,215,96,.16);}
  .pos-root button.client-scan-link{width:100%;margin:0 0 12px;padding:10px;border-radius:12px;font-size:12px;font-weight:800;color:var(--accent);background:rgba(31,215,96,.08);border:1.5px dashed rgba(31,215,96,.3);display:inline-flex;align-items:center;justify-content:center;gap:8px;}
  .pos-root button.client-scan-link:hover{border-style:solid;background:rgba(31,215,96,.12);}
  .client-tier{padding:3px 9px;border-radius:8px;font-size:9.5px;font-weight:800;flex-shrink:0;}
  .client-bonus{font-size:9.5px;color:var(--gd);font-weight:700;margin-top:2px;}
  .pos-root button.client-x{width:22px;height:22px;border-radius:7px;color:var(--t3);font-size:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;}
  .pos-root button.client-x:hover{background:rgba(255,69,69,.12);color:var(--red);}

  .client-profile-meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:11px;color:var(--t2);margin:-4px 0 12px;}
  .client-kpis{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;}
  .client-kpi{background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:10px 11px;}
  .client-kpi .l{font-size:9.5px;font-weight:800;color:var(--t3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px;}
  .client-kpi .v{font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:900;color:var(--t1);line-height:1.2;}
  .client-kpi .v .sub{display:block;font-size:10px;font-weight:700;color:var(--gd);margin-top:2px;font-family:'Nunito',sans-serif;}
  .client-profile-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;}
  .client-profile-actions.three{grid-template-columns:1fr 1fr 1fr;}
  .client-profile-actions .action-chip{min-width:0;}
  .client-profile-actions .action-chip span:not(.ic-wrap){overflow:hidden;text-overflow:ellipsis;}
  .pos-root button.ac-hist{background:rgba(59,130,246,.1);border:1.5px solid rgba(59,130,246,.3);}
  .ac-hist .ic-wrap{background:rgba(59,130,246,.18);}
  .pos-root button.ac-hist:hover{border-color:var(--blue);}
  .hist-detail-head{display:flex;align-items:center;gap:10px;margin-bottom:12px;}
  .hist-detail-head h3{margin:0;}
  .pos-root button.hist-back{padding:7px 10px;border-radius:10px;font-size:11px;font-weight:800;color:var(--t2);background:var(--surface2);border:1px solid var(--border);flex-shrink:0;}
  .pos-root button.hist-back:hover{color:var(--t1);border-color:var(--accent);}
  .pos-root button.hist-more{width:100%;margin-top:8px;padding:10px;border-radius:12px;font-size:11.5px;font-weight:800;color:var(--blue);background:rgba(59,130,246,.08);border:1.5px dashed rgba(59,130,246,.28);}
  .pos-root button.hist-more:hover{border-style:solid;background:rgba(59,130,246,.12);}
  .hist-scroll.profile{min-height:140px;max-height:min(28vh,220px);}
  .hist-row.sm{padding:9px 10px;}
  .hist-row.sm .hist-items{display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;}

  .tier-strip{margin:10px 14px 0;padding:9px 12px;border-radius:13px;background:rgba(255,184,0,.06);border:1px solid rgba(255,184,0,.2);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;font-size:11px;}
  .tier-strip .lbl{color:var(--t2);}
  .tier-strip b{color:var(--gd);font-family:'JetBrains Mono';}
  .discount-strip{margin:8px 14px 0;padding:9px 12px;border-radius:13px;background:var(--surface2);border:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;font-size:11px;}
  .discount-strip .set-btn{font-size:10.5px;color:var(--blue);font-weight:800;}

  .cart-items{flex:1;overflow-y:auto;padding:10px 14px;min-height:160px;}
  .cart-empty{text-align:center;color:var(--t3);padding:36px 10px;}
  .cart-empty .ic{font-size:34px;opacity:.5;margin-bottom:8px;}
  .cart-row{display:flex;align-items:center;gap:10px;padding:11px 8px;border-radius:14px;animation:rowIn .18s ease both;border:1px solid transparent;cursor:pointer;}
  .cart-row:hover{background:var(--surface2);border-color:var(--border);}
  .cart-row.sel{background:rgba(155,109,255,.08);border-color:rgba(155,109,255,.35);}
  .cart-row .ic{width:44px;height:44px;border-radius:12px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;}
  .cart-row .info{flex:1;min-width:0;}
  .cart-row .name{font-size:13.5px;font-weight:800;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .cart-row .meta{display:flex;align-items:center;flex-wrap:nowrap;gap:0;margin-top:4px;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
  .cart-row .meta span{font-size:10.5px;font-weight:700;color:var(--t3);font-family:'JetBrains Mono',monospace;flex-shrink:1;min-width:0;overflow:hidden;text-overflow:ellipsis;}
  .cart-row .meta span + span::before{content:'·';margin:0 7px;color:var(--border2);font-weight:800;}
  .cart-row .meta .line-disc{color:var(--red);font-weight:800;flex-shrink:0;}
  .cart-row .codes{display:none;}
  .cart-row .sub{display:none;}
  .qtyctrl{display:flex;align-items:center;gap:7px;background:var(--surface2);border-radius:10px;padding:5px;flex-shrink:0;}
  .qtyctrl button{width:24px;height:24px;border-radius:8px;font-size:14px;font-weight:800;color:var(--t2);}
  .qtyctrl button:hover{background:var(--border2);color:var(--t1);}
  .qtyctrl span{font-size:13px;font-weight:800;min-width:18px;text-align:center;font-family:'JetBrains Mono';}
  .pos-root button.qty-btn{flex-shrink:0;min-width:64px;min-height:42px;padding:10px 14px;border-radius:12px;background:var(--surface2);border:1.5px solid var(--border);font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:900;color:var(--t1);}
  .pos-root button.qty-btn:hover{border-color:var(--accent);color:var(--accent);background:rgba(31,215,96,.1);}
  .pos-root button.qty-btn:active{transform:scale(.96);}
  .modal-card.qty-edit-card{width:400px;}
  .qty-edit-head{display:flex;align-items:center;gap:12px;margin-bottom:14px;}
  .qty-edit-av{width:48px;height:48px;border-radius:14px;background:var(--surface2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:26px;flex-shrink:0;}
  .qty-edit-name{font-size:15px;font-weight:800;line-height:1.25;}
  .qty-edit-stock{font-size:11px;color:var(--t3);margin-top:3px;}
  .qty-trio{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;}
  .qty-trio-item{background:var(--surface2);border:1.5px solid var(--border);border-radius:14px;padding:10px 8px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:2px;}
  .pos-root button.qty-trio-item.tap{cursor:pointer;transition:border-color .12s,background .12s,transform .1s;}
  .pos-root button.qty-trio-item.tap:hover{border-color:var(--border2);}
  .pos-root button.qty-trio-item.tap.on{border-color:var(--accent);background:rgba(31,215,96,.1);transform:translateY(-1px);box-shadow:0 4px 12px rgba(31,215,96,.15);}
  .qty-trio-item .l{font-size:9.5px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:var(--t3);}
  .qty-trio-item b{font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:900;color:var(--t1);line-height:1.2;}
  .qty-trio-item b.live{color:var(--accent);}
  .pos-root button.qty-trio-item.tap.on b{color:var(--gd);}
  .qty-trio-item .u{font-size:10px;font-weight:700;color:var(--t3);}
  .qty-edit-hint{font-size:11px;color:var(--t3);margin-bottom:10px;line-height:1.35;text-align:center;}
  .kp-display.qty-edit-input{margin-bottom:10px;}
  .kp-display.qty-edit-input.sum{border-color:rgba(234,179,8,.35);background:rgba(234,179,8,.06);}
  .kp-display.qty-edit-input.qty{border-color:rgba(31,215,96,.28);background:rgba(31,215,96,.05);}
  .qty-edit-field{width:100%;background:transparent;border:none;outline:none;text-align:center;font-family:'JetBrains Mono',monospace;font-size:34px;font-weight:800;color:var(--t1);padding:4px 0;caret-color:var(--accent);min-width:0;}
  .qty-edit-field::placeholder{color:var(--t3);}
  .qty-edit-stepper{display:flex;align-items:center;gap:10px;margin-top:4px;}
  .pos-root button.qty-step{width:52px;height:52px;flex-shrink:0;border-radius:14px;background:var(--surface);border:1.5px solid var(--border);font-size:28px;font-weight:800;color:var(--t1);line-height:1;display:flex;align-items:center;justify-content:center;}
  .pos-root button.qty-step:hover{border-color:var(--accent);color:var(--accent);background:rgba(31,215,96,.1);}
  .pos-root button.qty-step:active{transform:scale(.94);}
  .qty-edit-toolbar{display:flex;align-items:stretch;gap:8px;margin-bottom:12px;}
  .qty-edit-toolbar .kp-quick{display:grid;grid-template-columns:repeat(auto-fit,minmax(48px,1fr));gap:8px;flex:1;margin:0;}
  .pos-root .qty-edit-toolbar .kp-quick button{min-height:44px;min-width:44px;padding:10px 12px;border-radius:12px;font-size:14px;font-weight:800;border:1.5px solid var(--border);}
  .pos-root button.qty-pad-toggle{flex-shrink:0;padding:10px 14px;border-radius:12px;font-size:11.5px;font-weight:800;background:var(--surface2);border:1.5px solid var(--border);color:var(--t2);white-space:nowrap;min-height:44px;}
  .pos-root button.qty-pad-toggle:hover{border-color:var(--accent);color:var(--t1);}
  .pos-root button.qty-pad-toggle.on{border-color:var(--accent);background:rgba(31,215,96,.12);color:var(--gd);}
  .qty-edit-formula{margin-top:10px;padding-top:8px;border-top:1px dashed var(--border);font-size:12px;color:var(--t2);}
  .qty-edit-formula b{color:var(--gd);font-family:'JetBrains Mono',monospace;}
  .qty-edit-warn{margin-top:8px;font-size:11px;font-weight:800;color:var(--red);}
  .cart-row .price{font-family:'JetBrains Mono';font-size:15px;font-weight:900;color:var(--gd);flex-shrink:0;min-width:68px;text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:1px;}
  .cart-row .price .old{font-size:10px;font-weight:700;color:var(--t3);text-decoration:line-through;}
  .pos-root button.rm{width:24px;height:24px;border-radius:8px;color:var(--t3);font-size:13px;flex-shrink:0;}
  .pos-root button.rm:hover{background:rgba(255,69,69,.12);color:var(--red);}

  .check-actions{display:grid;grid-template-columns:1fr 1.2fr 1.2fr;gap:8px;padding:8px 14px;flex-shrink:0;border-top:1px solid var(--border);}
  .pos-root button.ac-clear{background:rgba(255,69,69,.08);border:1.5px solid rgba(255,69,69,.28);}
  .ac-clear .ic-wrap{background:rgba(255,69,69,.15);}
  .pos-root button.ac-clear:hover{border-color:var(--red);}
  .pos-root button.ac-discount-all{background:rgba(59,130,246,.08);border:1.5px solid rgba(59,130,246,.28);}
  .ac-discount-all .ic-wrap{background:rgba(59,130,246,.18);}
  .pos-root button.ac-discount-all:hover,.pos-root button.ac-discount-all.on{border-color:var(--blue);background:rgba(59,130,246,.14);}
  .pos-root button.ac-discount-all.on span{color:var(--blue);}
  .pos-root button.action-chip:disabled{opacity:.35;pointer-events:none;}

  .cart-totals{padding:12px 14px;border-top:1px solid var(--border);flex-shrink:0;}
  .tot-row{display:flex;justify-content:space-between;font-size:12.5px;color:var(--t2);margin-bottom:6px;}
  .tot-row.disc span:last-child{color:var(--red);}
  .tot-row.disc.muted{opacity:.55;}
  .tot-final{display:flex;justify-content:space-between;align-items:baseline;padding-top:12px;margin-top:6px;border-top:1px dashed var(--border);gap:12px;}
  .tot-final b{font-family:'Unbounded';font-size:18px;font-weight:800;}
  .tot-final .sum{font-family:'JetBrains Mono';font-size:40px;font-weight:900;color:var(--accent);letter-spacing:-.5px;line-height:1;}

  .ops-block{padding:0 14px 8px;flex-shrink:0;}
  .ops-block.ops-client{margin:0 14px 8px;padding:10px 10px 8px;border-radius:14px;background:rgba(255,140,0,.05);border:1px solid rgba(255,140,0,.18);}
  .ops-block.ops-check{margin:0 14px 4px;padding:10px 10px 8px;border-radius:14px;background:rgba(155,109,255,.05);border:1px solid rgba(155,109,255,.16);}
  .ops-block.pay-block{padding:0 14px 0;margin-top:2px;}
  .ops-lbl{font-size:9.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--t3);margin:0 0 8px;}
  .ops-client .ops-lbl{color:var(--org);}
  .ops-check .ops-lbl{color:var(--pur);}
  .pay-block .ops-lbl{padding-left:0;margin-bottom:6px;}
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
  .pos-root button.ac-repay{background:rgba(255,140,0,.1);border:1.5px solid rgba(255,140,0,.32);}
  .ac-repay .ic-wrap{background:rgba(255,140,0,.2);}
  .pos-root button.ac-repay:hover{border-color:var(--org);}
  .pos-root button.ac-topup{background:rgba(31,215,96,.1);border:1.5px solid rgba(31,215,96,.32);}
  .ac-topup .ic-wrap{background:rgba(31,215,96,.2);}
  .pos-root button.ac-topup:hover{border-color:var(--accent);}

  .link-row{display:flex;gap:4px;padding:2px 14px 8px;flex-shrink:0;justify-content:center;align-items:center;}
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

  .repay-methods{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;}
  .pos-root button.repay-m{padding:10px;border-radius:12px;font-size:12px;font-weight:800;background:var(--surface2);border:1.5px solid var(--border);color:var(--t2);}
  .pos-root button.repay-m.on{border-color:var(--accent);background:rgba(31,215,96,.1);color:var(--gd);}

  .modal-card.hist-card{width:520px;max-height:min(90vh,820px);display:flex;flex-direction:column;}
  .hist-tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:3px;margin:2px 0 12px;border-radius:14px;background:var(--surface2);border:1.5px solid var(--border);flex-shrink:0;}
  .pos-root button.hist-tab{padding:10px 8px;border-radius:11px;font-size:12px;font-weight:800;color:var(--t3);display:flex;align-items:center;justify-content:center;gap:7px;}
  .pos-root button.hist-tab .n{font-size:10px;font-weight:900;font-family:'JetBrains Mono',monospace;padding:2px 7px;border-radius:8px;background:var(--surface);color:var(--t2);border:1px solid var(--border);}
  .pos-root button.hist-tab.on{background:var(--surface);color:var(--t1);box-shadow:0 1px 4px var(--shade);}
  .pos-root button.hist-tab.on .n{background:rgba(31,215,96,.14);border-color:rgba(31,215,96,.28);color:var(--accent);}
  .hist-empty{font-size:12px;color:var(--t3);padding:28px 8px;text-align:center;font-weight:700;}
  .hist-scroll{flex:1;overflow-y:auto;min-height:280px;max-height:min(52vh,440px);margin:0 -4px;padding:0 4px 4px;}
  .hist-section{margin-bottom:14px;}
  .hist-section:last-child{margin-bottom:0;}
  .hist-section-h{
    font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--t3);
    margin:0 0 8px;padding:0 2px;display:flex;align-items:center;gap:8px;
  }
  .hist-section-h::after{content:'';flex:1;height:1px;background:var(--border);}
  .hist-list{flex:1;overflow-y:auto;min-height:280px;max-height:min(52vh,440px);margin:0 -4px;padding:0 4px 4px;}
  .hist-list.compact{flex:none;overflow:visible;min-height:0;max-height:none;margin:0;padding:0;}
  .hist-row{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:11px 12px;border-radius:12px;background:var(--surface2);border:1px solid var(--border);margin-bottom:8px;}
  .pos-root button.hist-row{width:100%;text-align:left;cursor:pointer;color:inherit;font:inherit;}
  .pos-root button.hist-row:hover{border-color:var(--accent);}
  .hist-row:last-child{margin-bottom:0;}
  .hist-detail-overlay{z-index:220;}
  .modal-card.hist-detail-card{width:420px;}
  .hist-detail-sum{font-family:'JetBrains Mono',monospace;font-size:28px;font-weight:900;color:var(--org);margin:4px 0 8px;}
  .hist-detail-items{margin-top:14px;padding-top:12px;border-top:1px dashed var(--border);}
  .hist-detail-items .hist-items{font-size:12.5px;line-height:1.45;}
  .hist-lines{display:flex;flex-direction:column;gap:8px;}
  .hist-line{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:12px;background:var(--surface2);border:1px solid var(--border);}
  .hist-line-main{min-width:0;display:flex;flex-direction:column;gap:3px;}
  .hist-line-main b{font-size:12.5px;font-weight:800;color:var(--t1);line-height:1.3;}
  .hist-line-qty{font-size:11px;font-weight:800;color:var(--t2);font-family:'JetBrains Mono',monospace;}
  .hist-line-sum{flex-shrink:0;font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:900;color:var(--gd);}
  .hist-row.tone-sale .hist-amt{color:var(--gd);}
  .hist-row.tone-credit,.hist-row.tone-debt{border-color:rgba(234,88,12,.35);background:rgba(234,88,12,.08);}
  .hist-row.tone-credit.partial,.hist-row.tone-debt.partial{border-color:rgba(255,184,0,.45);background:rgba(255,184,0,.1);}
  .hist-row.tone-credit.settled,.hist-row.tone-debt.settled{border-color:rgba(31,215,96,.35);background:rgba(31,215,96,.08);}
  .hist-row.tone-repay{border-color:rgba(59,130,246,.3);background:rgba(59,130,246,.08);}
  .hist-row.tone-topup{border-color:rgba(31,215,96,.3);background:rgba(31,215,96,.08);}
  .hist-main{min-width:0;display:flex;flex-direction:column;gap:2px;flex:1;}
  .hist-title-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap;}
  .hist-main b{font-size:12px;font-weight:800;}
  .hist-badge{font-size:9px;font-weight:800;padding:2px 7px;border-radius:7px;letter-spacing:.02em;}
  .hist-badge.paid{background:rgba(31,215,96,.18);color:var(--accent);}
  .hist-badge.partial{background:rgba(255,184,0,.18);color:var(--gd);}
  .hist-badge.open{background:rgba(234,88,12,.18);color:var(--org);}
  .hist-when{font-size:10px;color:var(--t3);}
  .hist-sub{font-size:10.5px;color:var(--t2);}
  .hist-items{font-size:10.5px;color:var(--t1);font-weight:700;line-height:1.35;margin-top:3px;}
  .hist-amt-col{flex-shrink:0;text-align:right;}
  .hist-amt{font-family:'JetBrains Mono';font-size:13px;font-weight:900;color:var(--gd);}
  .hist-remain{font-size:9.5px;font-weight:800;color:var(--org);margin-top:3px;font-family:'JetBrains Mono',monospace;}
  .hist-row.tone-credit .hist-amt,.hist-row.tone-debt .hist-amt{color:var(--org);}
  .hist-row.tone-credit.settled .hist-amt,.hist-row.tone-debt.settled .hist-amt{color:var(--accent);}
  .hist-row.tone-repay .hist-amt{color:var(--blue);}
  .hist-row.tone-topup .hist-amt{color:var(--accent);}

  .pos-root button.btn-checkout{margin:0 14px 12px;padding:12px;border-radius:14px;background:linear-gradient(135deg,var(--accent2),var(--accent));color:var(--bg);font-weight:800;font-size:13.5px;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 6px 16px rgba(31,215,96,.22);}
  .pos-root button.btn-checkout:disabled{opacity:.3;box-shadow:none;}

  .overlay{position:fixed;inset:0;background:rgba(3,11,5,.75);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:200;animation:fadeIn .2s ease;}
  .modal-card{width:360px;background:var(--surface);border:1.5px solid var(--border);border-radius:22px;padding:22px;animation:popIn .25s cubic-bezier(.16,1,.3,1);max-width:92vw;}
  .modal-card h3{font-family:'Unbounded';font-size:13.5px;font-weight:800;margin-bottom:14px;}
  .modal-input,.modal-card-input{
    width:100%;box-sizing:border-box;background:var(--surface2);border:1.5px solid var(--border);border-radius:14px;
    padding:12px 15px;font-size:13.5px;font-weight:700;color:var(--t1);outline:none;margin-bottom:12px;
    -webkit-appearance:none;appearance:none;
  }
  .modal-input:focus,.modal-card-input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(31,215,96,.12);}
  .modal-input::placeholder,.modal-card-input::placeholder{color:var(--t3);font-weight:600;}
  .pos-search{
    display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;
    background:var(--surface2);border:1.5px solid var(--border);border-radius:14px;
    padding:11px 14px;margin-bottom:12px;transition:border-color .15s,box-shadow .15s;
  }
  .pos-search:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px rgba(31,215,96,.12);}
  .pos-search .ic{font-size:14px;color:var(--t2);flex-shrink:0;line-height:1;display:inline-flex;align-items:center;}
  .pos-search .ic svg{display:block;color:inherit;}
  .pos-search input{
    flex:1;min-width:0;background:none;border:none;outline:none;box-shadow:none;
    font-size:13.5px;font-weight:700;color:var(--t1);padding:0;margin:0;-webkit-appearance:none;appearance:none;
  }
  .pos-search input::placeholder{color:var(--t3);font-weight:600;}
  .pos-root[data-theme="light"] .pos-search:focus-within,
  .pos-root[data-theme="light"] .modal-input:focus,
  .pos-root[data-theme="light"] .modal-card-input:focus{box-shadow:0 0 0 3px rgba(18,155,69,.12);}
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
  .kp-quick{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px;}
  .pos-root .kp-quick button{padding:12px 8px;min-height:42px;border-radius:12px;background:var(--surface2);border:1.5px solid var(--border);font-size:13px;font-weight:800;color:var(--t2);}
  .pos-root .kp-quick button:hover{border-color:var(--accent);color:var(--accent);background:rgba(31,215,96,.08);}
  .pos-root .kp-quick button:active{transform:scale(.96);}
  .keypad{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:14px;}
  .keypad button{padding:14px;border-radius:13px;background:var(--surface2);border:1px solid var(--border);font-family:'JetBrains Mono';font-size:17px;font-weight:700;}
  .keypad button:hover{background:var(--border2);}
  .keypad button:active{transform:scale(.94);}
  .keypad button.kp-clear{color:var(--red);font-family:'Nunito';font-size:12px;font-weight:800;}

  .toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:var(--surface);border:1.5px solid var(--accent);border-radius:18px;padding:14px 20px;display:flex;align-items:center;gap:11px;box-shadow:0 14px 32px var(--shade);z-index:300;animation:toastIn .3s cubic-bezier(.16,1,.3,1);}
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
    .top-loc{order:0;}
    .top-meta{margin-left:0;width:100%;justify-content:space-between;order:2;}
    .searchpill{flex:1 1 100%;max-width:none;min-width:0;width:100%;order:1;}
    .cart{border-left:none;border-top:1px solid var(--border);max-height:55vh;}
  }
`
