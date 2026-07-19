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
  .pos-root[data-embed="1"]{
    position:relative;inset:auto;z-index:1;height:100%;width:100%;min-height:0;
  }
  .pos-root[data-embed="1"] .gate,
  .pos-root[data-embed="1"] .overlay,
  .pos-root[data-embed="1"] .cashier-screen,
  .pos-root[data-embed="1"] .toast{
    position:absolute;
  }
  /* настройки всегда fixed на весь экран — даже в embed */
  .pos-root[data-embed="1"] .pos-settings-fs{
    position:fixed !important;
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

  .shift-lock-bar{
    position:absolute;left:0;right:0;bottom:0;z-index:120;
    display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;
    padding:14px 18px;background:linear-gradient(180deg,transparent,rgba(3,11,5,.92) 28%,var(--surface));
    border-top:1px solid var(--border);
  }
  .shift-lock-bar .shift-lock-txt{min-width:0;}
  .shift-lock-bar .shift-lock-txt b{display:block;font-size:14px;font-weight:900;color:var(--t1);}
  .shift-lock-bar .shift-lock-txt span{display:block;font-size:12px;font-weight:700;color:var(--t2);margin-top:2px;}
  .pos-root button.btn-open-shift{
    flex-shrink:0;padding:12px 18px;border-radius:14px;font-weight:900;font-size:13px;
    background:linear-gradient(135deg,var(--accent2),var(--accent));color:var(--bg);
    box-shadow:0 8px 20px rgba(31,215,96,.28);
  }
  .pos-root button.btn-open-shift:hover{filter:brightness(1.05);}
  .pos-root[data-theme="light"] .shift-lock-bar{
    background:linear-gradient(180deg,transparent,rgba(243,247,244,.95) 28%,var(--surface));
  }

  /* ── Дашборд точки продаж (стиль KAKAPO Торговля) ── */
  .odoo-dash{
    height:100%;min-height:0;display:flex;flex-direction:column;
    background:var(--bg);color:var(--t1);overflow:auto;
    font-family:'Nunito',system-ui,sans-serif;
  }
  .odoo-dash-top{
    display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;
    padding:20px 22px 16px;border-bottom:1px solid var(--border);background:var(--surface);
  }
  .odoo-dash-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex-shrink:0;}
  .odoo-dash-top h1{
    margin:0;font-size:22px;font-weight:900;letter-spacing:-.02em;color:var(--t1);
    font-family:inherit;
  }
  .odoo-dash-top p{margin:6px 0 0;font-size:13px;font-weight:700;color:var(--t2);max-width:560px;line-height:1.45;}
  .pos-root button.odoo-create-pos{
    flex-shrink:0;padding:11px 16px;border-radius:12px;font-weight:900;font-size:13px;
    background:linear-gradient(135deg,#1FD760,#14b24f);color:#05210D;
    box-shadow:0 8px 20px rgba(31,215,96,.25);border:none;cursor:pointer;
    white-space:nowrap;
  }
  .pos-root button.odoo-create-pos:hover{filter:brightness(1.06);}
  .odoo-dash-body{
    padding:20px 22px 28px;flex:1;
    background:radial-gradient(ellipse 70% 50% at 10% 0%, rgba(31,215,96,.07), transparent 55%), var(--bg);
  }
  .pos-root[data-theme="light"] .odoo-dash-body{
    background:radial-gradient(ellipse 70% 50% at 10% 0%, rgba(18,155,69,.08), transparent 55%), var(--bg);
  }
  .odoo-kanban{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,320px));gap:16px;align-items:start;}
  .odoo-card{
    background:var(--surface);border:1px solid var(--border);border-radius:16px;
    box-shadow:0 10px 28px var(--shade);overflow:hidden;display:flex;flex-direction:column;
  }
  .odoo-card-head{
    padding:16px 16px 10px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;
  }
  .odoo-card-mark{
    width:40px;height:40px;border-radius:12px;flex-shrink:0;margin-bottom:12px;
    background:linear-gradient(135deg,#1FD760,#12a548);color:#05210D;
    display:flex;align-items:center;justify-content:center;font-size:18px;
    box-shadow:0 6px 16px rgba(31,215,96,.28);
  }
  .odoo-card-head .odoo-card-title{font-size:16px;font-weight:900;line-height:1.25;color:var(--t1);}
  .odoo-card-head .odoo-card-sub{font-size:12px;font-weight:700;color:var(--t2);margin-top:4px;}
  .odoo-card-menu{position:relative;}
  .pos-root button.odoo-card-more{
    width:36px;height:36px;border-radius:12px;color:var(--t2);font-size:18px;line-height:1;
    display:flex;align-items:center;justify-content:center;background:var(--surface2);border:1px solid var(--border);
  }
  .pos-root button.odoo-card-more:hover{border-color:var(--accent);color:var(--t1);}
  .odoo-card-drop{
    position:absolute;right:0;top:40px;z-index:20;min-width:190px;
    background:var(--surface);border:1px solid var(--border);border-radius:14px;
    box-shadow:0 14px 32px var(--shade);padding:6px;display:flex;flex-direction:column;
  }
  .pos-root button.odoo-card-drop-item{
    text-align:left;padding:10px 12px;border-radius:10px;font-size:13px;font-weight:700;color:var(--t1);
  }
  .pos-root button.odoo-card-drop-item:hover{background:var(--surface2);color:var(--accent);}
  .pos-root button.odoo-card-drop-item.danger{color:var(--red);}
  .pos-root button.odoo-card-drop-item.danger:hover{background:rgba(255,90,90,.1);color:var(--red);}
  .odoo-card-drop-sep{height:1px;margin:4px 8px;background:var(--border);}
  .odoo-card-status{
    margin:0 16px 12px;padding:9px 12px;border-radius:12px;font-size:12px;font-weight:800;
    background:var(--surface2);color:var(--t2);border:1px solid var(--border);
  }
  .odoo-card-status.open{background:rgba(31,215,96,.1);border-color:rgba(31,215,96,.28);color:var(--accent);}
  .odoo-card-status.closed{background:rgba(255,90,90,.08);border-color:rgba(255,90,90,.22);color:var(--red);}
  .pos-root[data-theme="light"] .odoo-card-status.open{background:rgba(18,155,69,.1);border-color:rgba(18,155,69,.28);color:var(--accent);}
  .pos-root[data-theme="light"] .odoo-card-status.closed{background:rgba(220,38,38,.08);border-color:rgba(220,38,38,.22);color:var(--red);}
  .odoo-card-meta{padding:0 16px 14px;font-size:12.5px;font-weight:700;color:var(--t3);line-height:1.5;}
  .odoo-card-meta b{color:var(--t2);font-weight:800;}
  .odoo-card-actions{padding:0 16px 16px;display:flex;flex-direction:column;gap:8px;}
  .pos-root button.odoo-btn-primary{
    width:100%;padding:13px 16px;border-radius:12px;font-weight:900;font-size:14px;
    background:linear-gradient(135deg,#1FD760,#14b24f);color:#05210D;
    box-shadow:0 8px 20px rgba(31,215,96,.25);
  }
  .pos-root button.odoo-btn-primary:hover{filter:brightness(1.06);}
  .pos-root button.odoo-btn-primary.go{
    background:linear-gradient(135deg,#1FD760,#12a548);color:#05210D;
  }
  .pos-root button.odoo-btn-primary.go:hover{filter:brightness(1.06);}
  .pos-root button.odoo-btn-secondary{
    width:100%;padding:11px 14px;border-radius:12px;font-weight:800;font-size:13px;
    background:var(--surface2);border:1.5px solid var(--border);color:var(--t1);
  }
  .pos-root button.odoo-btn-secondary:hover{border-color:var(--accent);color:var(--accent);background:var(--surface2);}
  .pos-root button.odoo-btn-secondary:disabled{
    opacity:.55;cursor:not-allowed;border-color:var(--border);color:var(--t3);
  }
  .pos-root button.odoo-btn-secondary:disabled:hover{border-color:var(--border);color:var(--t3);background:var(--surface2);}

  .gate{position:fixed;inset:0;background:var(--bg);display:flex;align-items:center;justify-content:center;z-index:500;}
  .gate.gate-modal{background:rgba(3,11,5,.78);backdrop-filter:blur(5px);}
  .pos-root[data-theme="light"] .gate.gate-modal{background:rgba(12,26,16,.45);}
  .gate.hide{display:none;}
  .gate-bg{position:absolute;inset:0;opacity:.55;background:radial-gradient(circle at 20% 20%, rgba(31,215,96,.12), transparent 45%),radial-gradient(circle at 82% 78%, rgba(31,215,96,.05), transparent 45%);}
  .pos-root[data-theme="light"] .gate-bg{opacity:.35;background:radial-gradient(circle at 20% 20%, rgba(18,155,69,.14), transparent 45%),radial-gradient(circle at 82% 78%, rgba(18,155,69,.06), transparent 45%);}
  .gate-card{position:relative;width:400px;max-width:92vw;background:var(--surface);border:1px solid var(--border);border-radius:22px;padding:32px;color:var(--t1);animation:popIn .3s cubic-bezier(.16,1,.3,1);box-shadow:0 18px 40px var(--shade);}
  .gate-logo{width:50px;height:50px;border-radius:16px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-family:'Unbounded';font-weight:900;font-size:21px;color:var(--bg);margin:0 auto 14px;}
  .gate-title{font-family:'Unbounded';font-size:16px;font-weight:800;text-align:center;margin-bottom:4px;color:var(--t1);}
  .gate-sub{font-size:12px;color:var(--t2);text-align:center;margin-bottom:24px;}
  .gate-label{font-size:11px;font-weight:700;color:var(--t2);margin-bottom:8px;display:block;}
  .pos-device-block{
    margin:4px 0 16px;padding:12px;border-radius:14px;
    background:var(--surface2);border:1px solid var(--border);
  }
  .pos-device-head{display:flex;flex-direction:column;gap:2px;margin-bottom:10px;}
  .pos-device-head b{font-size:13px;font-weight:900;color:var(--t1);}
  .pos-device-head span{font-size:11px;font-weight:700;color:var(--t2);}
  .pos-device-row{
    display:flex;align-items:center;justify-content:space-between;gap:10px;
    padding:10px 10px;border-radius:12px;background:var(--surface);
  }
  .pos-device-row + .pos-device-row{margin-top:6px;}
  .pos-device-row strong{display:block;font-size:12.5px;font-weight:800;color:var(--t1);}
  .pos-device-row em{display:block;font-style:normal;font-size:11px;font-weight:700;color:var(--t3);margin-top:2px;}
  .pos-device-soon{
    flex-shrink:0;padding:5px 9px;border-radius:999px;font-size:10px;font-weight:900;
    color:var(--t2);background:rgba(31,215,96,.1);border:1px solid rgba(31,215,96,.22);
  }
  .pos-root[data-theme="light"] .pos-device-soon{background:rgba(18,155,69,.1);border-color:rgba(18,155,69,.22);}

  /* Полноэкранные настройки точки продаж — на весь экран окна, не в колонке меню */
  .pos-settings-fs{
    position:fixed !important;inset:0 !important;z-index:8000 !important;
    display:flex;flex-direction:column;
    background:var(--bg);color:var(--t1);overflow:hidden;
    width:100vw;height:100vh;max-width:100vw;max-height:100vh;
  }
  .pos-settings-top{
    flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:16px;
    padding:16px 28px;border-bottom:1px solid var(--border);background:var(--surface);
    min-height:72px;
  }
  .pos-settings-top h2{margin:0;font-size:22px;font-weight:900;letter-spacing:-.02em;color:var(--t1);}
  .pos-settings-top p{margin:4px 0 0;font-size:13px;font-weight:700;color:var(--t2);}
  .pos-settings-top-actions{display:flex;align-items:center;gap:10px;flex-shrink:0;}
  .pos-settings-scroll{
    flex:1;min-height:0;overflow:auto;
    padding:22px 28px 28px;
  }
  .pos-settings-wrap{
    width:min(1120px,100%);
    margin:0 auto;
    display:grid;
    grid-template-columns:minmax(300px,.9fr) minmax(380px,1.1fr);
    gap:18px;
    align-items:start;
  }
  .pos-settings-wrap .pos-settings-card.span-all{
    grid-column:1 / -1;
  }
  .pos-settings-body{display:contents;}
  .pos-settings-card{
    background:var(--surface);border:1px solid var(--border);border-radius:18px;
    padding:20px 22px;box-shadow:0 8px 24px var(--shade);min-width:0;
  }
  .pos-settings-card h3{
    margin:0 0 4px;font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;color:var(--t1);
  }
  .pos-settings-card .hint{margin:0 0 16px;font-size:12.5px;font-weight:700;color:var(--t2);line-height:1.45;}
  .pos-settings-field{margin-bottom:14px;}
  .pos-settings-field:last-child{margin-bottom:0;}
  .pos-settings-field .gate-label{margin-bottom:7px;}
  .pos-settings-field .gate-input{margin-bottom:0;font-size:14px;}
  .pos-settings-scale-grid{
    display:grid;grid-template-columns:1.5fr 120px 90px;gap:12px;
  }
  .pos-printer-list{
    display:grid;grid-template-columns:1fr;gap:8px;margin:8px 0 12px;
    max-height:min(320px,38vh);overflow:auto;padding-right:2px;
  }
  .pos-root button.pos-printer-opt{
    text-align:left;padding:14px 16px;border-radius:14px;border:1.5px solid var(--border);
    background:var(--surface2);display:flex;align-items:center;justify-content:space-between;gap:12px;
    width:100%;
  }
  .pos-root button.pos-printer-opt:hover{border-color:var(--accent);}
  .pos-root button.pos-printer-opt.on{
    border-color:var(--accent);background:rgba(31,215,96,.1);
  }
  .pos-root[data-theme="light"] button.pos-printer-opt.on{background:rgba(18,155,69,.1);}
  .pos-printer-opt b{display:block;font-size:14px;font-weight:900;color:var(--t1);}
  .pos-printer-opt span{display:block;font-size:11.5px;font-weight:700;color:var(--t3);margin-top:3px;word-break:break-all;}
  .pos-printer-badge{
    flex-shrink:0;padding:5px 9px;border-radius:999px;font-size:10px;font-weight:900;
    background:rgba(31,215,96,.14);color:var(--accent);border:1px solid rgba(31,215,96,.28);
  }
  .pos-settings-actions{
    flex-shrink:0;display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;
    padding:14px 28px;border-top:1px solid var(--border);background:var(--surface);
  }
  .pos-settings-actions-inner{
    width:min(1120px,100%);display:flex;gap:12px;align-items:center;
  }
  .pos-settings-actions .btn-gate{width:auto;min-width:220px;flex:1;max-width:420px;}
  .pos-settings-actions .btn-switch-till{min-width:140px;flex-shrink:0;}
  .pos-settings-status{
    margin-top:12px;padding:12px 14px;border-radius:12px;font-size:12.5px;font-weight:800;line-height:1.4;
    background:var(--surface2);border:1px solid var(--border);color:var(--t2);
  }
  .pos-settings-status.ok{color:var(--accent);border-color:rgba(31,215,96,.3);background:rgba(31,215,96,.08);}
  .pos-settings-status.warn{color:var(--org);border-color:rgba(255,140,0,.28);background:rgba(255,140,0,.08);}
  .pos-settings-net-hint{
    margin-top:8px;font-size:11.5px;font-weight:700;color:var(--t3);line-height:1.45;
  }
  .pos-settings-net-hint b{color:var(--t1);font-weight:900;}
  .pos-settings-check{
    display:flex;align-items:center;gap:10px;margin:4px 0 10px;
    font-size:13.5px;font-weight:800;color:var(--t1);cursor:pointer;user-select:none;
  }
  .pos-settings-check input{width:18px;height:18px;accent-color:var(--accent);}
  .pos-settings-row-btns{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;}
  .pos-settings-row-btns .btn-switch-till{flex:1;min-width:160px;margin:0 !important;width:auto !important;}
  .cart-row.weighing{box-shadow:inset 3px 0 0 var(--accent);}
  .line-scale{
    display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:900;
    background:rgba(31,215,96,.12);color:var(--accent);border:1px solid rgba(31,215,96,.28);
  }
  .line-scale.warn{
    background:rgba(255,140,0,.12);color:var(--org);border-color:rgba(255,140,0,.28);
  }

  @media (max-width:860px){
    .pos-settings-wrap{grid-template-columns:1fr;}
    .pos-settings-scale-grid{grid-template-columns:1fr 1fr;}
    .pos-settings-top{padding:14px 16px;align-items:flex-start;}
    .pos-settings-scroll{padding:14px 16px 20px;}
    .pos-settings-actions{padding:12px 16px;}
  }
  .cashier-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:20px;}
  .pos-root button.cashier-opt{padding:12px 5px;border-radius:14px;border:1.5px solid var(--border);background:var(--surface2);text-align:center;color:var(--t1);}
  .pos-root button.cashier-opt.on{border-color:var(--accent);background:rgba(31,215,96,.08);}
  .pos-root[data-theme="light"] button.cashier-opt.on{background:rgba(18,155,69,.08);}
  .cashier-opt .av{width:32px;height:32px;border-radius:10px;background:var(--surface);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-family:'Unbounded';font-weight:800;font-size:11px;margin:0 auto 6px;color:var(--t2);}
  .cashier-opt.on .av{background:linear-gradient(135deg,var(--accent),var(--accent2));color:var(--bg);border-color:transparent;}
  .cashier-opt span{font-size:10.5px;font-weight:700;color:var(--t2);}
  .cashier-opt.on span{color:var(--t1);}
  .gate-input{width:100%;background:var(--surface2);border:1.5px solid var(--border);border-radius:13px;padding:13px 15px;font-size:14px;font-weight:700;color:var(--t1);outline:none;margin-bottom:20px;font-family:'JetBrains Mono',monospace;}
  .gate-input:focus{border-color:var(--accent);}
  .gate-input::placeholder{color:var(--t3);}
  .pos-root button.btn-gate{width:100%;padding:14px;border-radius:14px;background:linear-gradient(135deg,#1FD760,#14b24f);color:#05210D;font-weight:800;font-size:14px;box-shadow:0 8px 20px rgba(31,215,96,.25);}

  /* Касса: товары слева, чек справа (как было) */
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

  .order-tabs{
    flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:6px;
    overflow-x:auto;padding:2px 4px;scrollbar-width:thin;
  }
  .order-tabs::-webkit-scrollbar{height:4px;}
  .pos-root button.order-tab{
    flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;
    max-width:148px;min-height:36px;padding:6px 8px 6px 10px;border-radius:11px;
    background:var(--surface2);border:1.5px solid var(--border);color:var(--t2);
    font-size:11.5px;font-weight:800;transition:border-color .12s,background .12s,color .12s;
  }
  .pos-root button.order-tab:hover{border-color:var(--border2);color:var(--t1);}
  .pos-root button.order-tab.on{
    border-color:var(--accent);background:rgba(31,215,96,.12);color:var(--t1);
    box-shadow:0 1px 0 rgba(31,215,96,.15);
  }
  .pos-root[data-theme="light"] button.order-tab.on{background:rgba(18,155,69,.1);}
  .order-tab-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:78px;}
  .order-tab-count{
    flex-shrink:0;min-width:18px;height:18px;padding:0 5px;border-radius:8px;
    display:inline-flex;align-items:center;justify-content:center;
    font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:900;
    background:var(--surface);border:1px solid var(--border);color:var(--t2);
  }
  .pos-root button.order-tab.on .order-tab-count{
    background:rgba(31,215,96,.18);border-color:rgba(31,215,96,.35);color:var(--accent);
  }
  .order-tab-x{
    flex-shrink:0;width:18px;height:18px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;
    font-size:14px;line-height:1;color:var(--t3);font-weight:700;
  }
  .order-tab-x:hover{background:rgba(255,69,69,.12);color:var(--red);}
  .pos-root button.order-tab-add{
    flex:0 0 auto;width:36px;height:36px;border-radius:11px;
    display:inline-flex;align-items:center;justify-content:center;
    font-size:20px;font-weight:800;line-height:1;color:var(--accent);
    background:var(--surface2);border:1.5px dashed var(--border2);
  }
  .pos-root button.order-tab-add:hover{border-color:var(--accent);background:rgba(31,215,96,.1);}
  .pos-root button.order-tab-add:disabled{opacity:.35;pointer-events:none;}

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
  .cashier-screen-inner.wide{width:min(860px,100%);}
  .receipt-filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;}
  .receipt-product-hint{
    margin:-4px 0 12px;padding:8px 12px;border-radius:12px;
    background:rgba(31,215,96,.08);border:1px solid rgba(31,215,96,.22);
    font-size:12px;font-weight:700;color:var(--t2);
  }
  .receipt-product-hint b{color:var(--accent);font-weight:900;}
  .receipt-product-hint span{color:var(--t3);font-weight:700;}
  .pos-root button.receipt-filter{padding:8px 12px;border-radius:11px;font-size:11.5px;font-weight:800;background:var(--surface2);border:1.5px solid var(--border);color:var(--t2);}
  .pos-root button.receipt-filter.on{border-color:var(--accent);background:rgba(31,215,96,.1);color:var(--accent);}
  .receipt-list{display:flex;flex-direction:column;gap:8px;flex:1;overflow-y:auto;padding-bottom:12px;}
  .pos-root button.receipt-row{
    display:flex;align-items:flex-start;justify-content:space-between;gap:12px;width:100%;text-align:left;
    padding:12px 14px;border-radius:14px;background:var(--surface);border:1.5px solid var(--border);color:inherit;font:inherit;
  }
  .pos-root button.receipt-row:hover{border-color:var(--accent);}
  .pos-root button.receipt-row.returned{opacity:.72;border-color:rgba(255,69,69,.28);background:rgba(255,69,69,.06);}
  .pos-root button.receipt-row.partial{border-color:rgba(255,170,40,.35);background:rgba(255,170,40,.07);}
  .receipt-num{
    flex-shrink:0;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:900;
    color:var(--accent);background:rgba(31,215,96,.12);border:1px solid rgba(31,215,96,.28);
    border-radius:8px;padding:2px 7px;letter-spacing:.02em;
  }
  .receipt-row-main{min-width:0;flex:1;display:flex;flex-direction:column;gap:3px;}
  .receipt-detail-meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;}
  .receipt-detail-meta > div{padding:12px;border-radius:14px;background:var(--surface);border:1px solid var(--border);}
  .receipt-detail-meta span{display:block;font-size:10px;font-weight:800;color:var(--t3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;}
  .receipt-detail-meta b{font-size:13px;font-weight:800;}
  .receipt-detail-meta b.sum{font-family:'JetBrains Mono',monospace;font-size:18px;color:var(--accent);}
  .receipt-return-hint{font-size:11.5px;font-weight:700;color:var(--t3);margin:-4px 0 10px;}
  .pos-root button.receipt-select-all{
    padding:6px 10px;border-radius:10px;font-size:11px;font-weight:800;
    background:var(--surface2);border:1.5px solid var(--border);color:var(--accent);
  }
  .hist-line.receipt-line{cursor:pointer;align-items:center;gap:10px;transition:border-color .15s,background .15s;}
  .hist-line.receipt-line.on{border-color:var(--accent);background:rgba(31,215,96,.1);}
  .hist-line.receipt-line.returned{opacity:.65;cursor:default;}
  .receipt-check{
    flex-shrink:0;width:22px;height:22px;border-radius:7px;border:1.5px solid var(--border);
    background:var(--surface);display:grid;place-items:center;font-size:12px;font-weight:900;color:var(--accent);
  }
  .receipt-check.on{border-color:var(--accent);background:rgba(31,215,96,.18);}
  .receipt-qty-ctrl{display:inline-flex;align-items:center;gap:6px;margin-top:6px;}
  .receipt-qty-ctrl span{min-width:18px;text-align:center;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:900;}
  .pos-root .receipt-qty-ctrl button{
    width:28px;height:28px;border-radius:8px;font-size:16px;font-weight:800;line-height:1;
    background:var(--surface);border:1.5px solid var(--border);color:var(--t1);
  }
  .receipt-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px;}
  .receipt-actions .action-chip{width:100%;justify-content:center;}
  .receipt-actions .receipt-return-all{grid-column:1 / -1;}
  @media(max-width:640px){
    .receipt-detail-meta,.receipt-actions{grid-template-columns:1fr;}
    .receipt-actions .receipt-return-all{grid-column:auto;}
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
  .pos-root button.cat-browse-btn.has-sel{border-color:var(--accent);color:var(--accent);background:rgba(31,215,96,.1);}
  .pos-root button.cat-browse-item.all{border-style:dashed;}
  .cat-browse-hint{margin:-6px 0 12px;font-size:12px;font-weight:700;color:var(--t3);}
  .cat-browse-check{
    position:absolute;top:8px;right:8px;width:18px;height:18px;border-radius:6px;
    border:1.5px solid var(--border);background:var(--surface);display:grid;place-items:center;
    font-size:11px;font-weight:900;color:var(--accent);line-height:1;
  }
  .pos-root button.cat-browse-item{position:relative;}
  .pos-root button.cat-browse-item.on .cat-browse-check{border-color:var(--accent);background:rgba(31,215,96,.18);}
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
  .p-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:13px;}
  .pos-root button.p-tile{position:relative;background:var(--surface);border:1.5px solid var(--border);border-radius:16px;padding:12px;text-align:left;transition:border-color .15s,transform .1s;animation:tileIn .25s ease both;}
  .pos-root button.p-tile:hover{border-color:var(--accent);transform:translateY(-2px);}
  .pos-root button.p-tile:active{transform:translateY(0) scale(.97);}
  .p-fav{position:absolute;top:8px;right:8px;z-index:2;width:28px;height:28px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:15px;line-height:1;color:var(--t3);background:rgba(3,11,5,.55);border:1px solid var(--border);cursor:pointer;}
  .pos-root[data-theme="light"] .p-fav{background:rgba(255,255,255,.85);}
  .p-fav:hover{color:var(--gd);border-color:var(--gd);}
  .p-fav.on{color:var(--gd);border-color:rgba(255,184,0,.45);background:rgba(255,184,0,.16);}
  .p-photo{width:100%;height:118px;border-radius:14px;background:linear-gradient(160deg,#f3f7f4 0%,#e6eee8 100%);display:flex;align-items:center;justify-content:center;font-size:40px;margin-bottom:10px;position:relative;overflow:hidden;border:1px solid rgba(255,255,255,.04);}
  .pos-root[data-theme="light"] .p-photo{background:linear-gradient(160deg,#ffffff 0%,#eef3ef 100%);border-color:rgba(12,26,16,.08);}
  .p-photo img{width:100%;height:100%;object-fit:contain;object-position:center;padding:8px;box-sizing:border-box;display:block;}
  .p-weight-tag{position:absolute;top:6px;left:6px;font-size:9px;font-weight:800;background:rgba(3,11,5,.78);color:#F1FBF3;padding:2px 7px;border-radius:7px;z-index:1;}
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
  .client-bonus{font-size:10px;color:var(--gd);font-weight:700;margin-top:3px;line-height:1.35;}
  .client-bonus .debt{color:var(--red);}
  .client-bonus .used{color:var(--pur);}
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
  .check-till-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 14px 8px;flex-shrink:0;}
  .pos-root button.ac-till-in{background:rgba(31,215,96,.1);border:1.5px solid rgba(31,215,96,.32);}
  .ac-till-in .ic-wrap{background:rgba(31,215,96,.2);}
  .pos-root button.ac-till-in:hover{border-color:var(--accent);}
  .pos-root button.ac-till-out{background:rgba(255,140,0,.1);border:1.5px solid rgba(255,140,0,.32);}
  .ac-till-out .ic-wrap{background:rgba(255,140,0,.2);}
  .pos-root button.ac-till-out:hover{border-color:var(--org);}
  .till-expected{font-size:12px;color:var(--t2);margin:0 0 10px;font-weight:700;line-height:1.4;}
  .till-expected b{color:var(--gd);font-family:'JetBrains Mono',monospace;}
  .till-supplier-grid{display:grid;gap:6px;max-height:160px;overflow:auto;margin-bottom:10px;}
  .pos-root button.till-supplier-opt{text-align:left;padding:8px 10px;border-radius:10px;border:1.5px solid var(--border);background:rgba(255,255,255,.03);display:flex;justify-content:space-between;gap:8px;font-size:12px;font-weight:700;color:var(--t2);}
  .pos-root button.till-supplier-opt.on{border-color:var(--org);background:rgba(255,140,0,.12);color:var(--gd);}
  .pos-root button.till-supplier-opt span:last-child{color:var(--org);font-family:'JetBrains Mono',monospace;flex-shrink:0;}

  .modal-card.layer-pick-card{width:420px;max-height:min(86vh,640px);display:flex;flex-direction:column;}
  .layer-pick-hint{display:flex;flex-direction:column;gap:4px;margin-bottom:12px;}
  .layer-pick-hint b{font-size:14px;color:var(--gd);}
  .layer-pick-hint span{font-size:12px;color:var(--t2);font-weight:700;line-height:1.4;}
  .layer-pick-list{display:grid;gap:8px;overflow:auto;max-height:min(52vh,420px);padding-right:2px;}
  .pos-root button.layer-pick-item{text-align:left;padding:12px 12px 10px;border-radius:14px;border:1.5px solid var(--border);background:rgba(255,255,255,.03);display:flex;flex-direction:column;gap:4px;}
  .pos-root button.layer-pick-item:hover{border-color:var(--accent);background:rgba(31,215,96,.08);}
  .pos-root button.layer-pick-item.active{border-color:rgba(31,215,96,.45);}
  .lpi-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:2px;}
  .lpi-price{font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:900;color:var(--accent);}
  .lpi-badge{font-size:10px;font-weight:800;letter-spacing:.4px;padding:3px 7px;border-radius:999px;background:rgba(31,215,96,.16);color:var(--gd);}
  .lpi-row{display:flex;justify-content:space-between;gap:10px;font-size:12px;font-weight:700;color:var(--t2);}
  .lpi-row b{color:var(--gd);font-family:'JetBrains Mono',monospace;}
  .lpi-row.muted{color:var(--t3);font-size:11px;margin-top:2px;}
  .cart-row .meta .line-batch{color:var(--org);font-weight:800;}

  .link-row{display:flex;gap:4px;padding:2px 14px 8px;flex-shrink:0;justify-content:center;align-items:center;}
  .link-row button{font-size:11px;color:#6B8F76;font-weight:700;padding:4px 10px;}
  .link-row button:hover{color:var(--t1);}

  .pay-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;padding:0 0 8px;flex-shrink:0;}
  .pay-grid.pay-grid-3{grid-template-columns:1fr 1fr 1fr;}
  .pay-grid.pay-grid-2{grid-template-columns:1fr 1fr;}
  .pos-root button.pay-btn{padding:10px 4px;border-radius:14px;text-align:center;font-size:10.5px;font-weight:800;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:56px;border:2px solid transparent;opacity:1;transition:transform .12s,box-shadow .12s,border-color .12s;}
  .pay-btn .ic{font-size:18px;line-height:1;}
  .pos-root button.pay-btn.on{transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.3);border-color:rgba(255,255,255,.22);}
  .pos-root button.pay-btn:disabled{opacity:.45;pointer-events:none;}
  .pos-root button.pay-btn.disabled{opacity:1;pointer-events:none;filter:none;}
  .pos-root button.pay-cash{background:#22C55E;border-color:#1AA34A;}
  .pos-root button.pay-cash.on{background:#16A34A;border-color:#86EFAC;box-shadow:0 4px 12px rgba(34,197,94,.3);}
  .pos-root button.pay-card{background:#3B82F6;border-color:#2563EB;}
  .pos-root button.pay-card.on{background:#2563EB;border-color:#93C5FD;box-shadow:0 4px 12px rgba(59,130,246,.3);}
  .pos-root button.pay-credit{background:#EA580C;border-color:#C2410C;}
  .pos-root button.pay-credit.on{background:#C2410C;border-color:#FDBA74;box-shadow:0 4px 12px rgba(234,88,12,.3);}
  .pos-root button.pay-mixed{background:#0D9488;border-color:#0F766E;color:#fff;}
  .pos-root button.pay-mixed.on{background:#0F766E;border-color:#5EEAD4;box-shadow:0 4px 12px rgba(13,148,136,.3);}
  .pos-root button.pay-balance{background:#2A2A3D;border-color:#3A3A52;color:#7A7A96;}
  .pos-root button.pay-balance.on{background:#3B2F66;border-color:#9B6DFF;color:#fff;box-shadow:0 4px 12px rgba(155,109,255,.28);}
  .pos-root button.pay-balance.disabled{background:#232334;border-color:#2E2E42;color:#5C5C78;}
  .pos-root button.pay-balance-full{
    width:100%;margin:0 0 10px;min-height:48px;flex-direction:row;gap:8px;font-size:12px;
    background:linear-gradient(135deg,#5B21B6,#7C3AED);border-color:#A78BFA;color:#fff;
  }
  .pos-root[data-theme="light"] button.pay-balance-full{background:linear-gradient(135deg,#6D28D9,#8B5CF6);border-color:#7C3AED;}

  .mix-row{
    margin-bottom:10px;padding:12px 14px;border-radius:14px;
    background:var(--surface2);border:1.5px solid var(--border);
  }
  .mix-row.mix-card-row{border-color:rgba(59,130,246,.35);background:rgba(59,130,246,.08);}
  .mix-row-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;font-size:12px;font-weight:800;}
  .mix-auto{font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--blue);}
  .mix-quick{display:flex;gap:6px;}
  .pos-root .mix-quick button{
    min-width:36px;padding:5px 8px;border-radius:9px;font-size:11px;font-weight:800;
    background:var(--surface);border:1.5px solid var(--border);color:var(--t2);
  }
  .pos-root .mix-quick button:hover{border-color:var(--accent);color:var(--t1);}
  .mix-field{
    width:100%;background:transparent;border:none;outline:none;text-align:center;
    font-family:'JetBrains Mono',monospace;font-size:28px;font-weight:800;color:var(--t1);
    caret-color:var(--accent);padding:2px 0;
  }
  .mix-card-val{
    text-align:center;font-family:'JetBrains Mono',monospace;font-size:28px;font-weight:900;color:var(--blue);line-height:1.2;
  }
  .mix-bonus-hint{font-size:12px;font-weight:800;color:var(--gd);margin:4px 0 8px;}

  .modal-card.pay-checkout-card{width:420px;max-height:min(92vh,720px);overflow-y:auto;}
  .pay-client-strip{
    display:flex;align-items:center;justify-content:space-between;gap:10px;
    padding:10px 12px;border-radius:14px;background:var(--surface2);border:1px solid var(--border);margin-bottom:12px;
  }
  .pay-client-strip b{display:block;font-size:13px;font-weight:800;line-height:1.2;}
  .pay-client-strip span{display:block;font-size:11px;color:var(--t3);font-weight:700;margin-top:2px;}
  .pay-client-bonus{font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:900;color:var(--gd);flex-shrink:0;}
  .pos-root button.pay-pick-client{
    width:100%;margin-bottom:12px;padding:11px 12px;border-radius:14px;text-align:left;
    background:var(--surface2);border:1.5px dashed var(--border2);font-size:12px;font-weight:800;color:var(--t2);
  }
  .pos-root button.pay-pick-client:hover{border-color:var(--accent);color:var(--t1);}
  .pay-breakdown{
    display:flex;flex-direction:column;gap:8px;padding:12px 14px;border-radius:14px;
    background:var(--surface2);border:1px solid var(--border);margin-bottom:12px;
  }
  .pay-breakdown > div{display:flex;align-items:baseline;justify-content:space-between;gap:10px;font-size:12px;font-weight:700;color:var(--t2);}
  .pay-breakdown .disc{color:var(--pur);}
  .pay-breakdown .debt-line{color:var(--red);}
  .pay-breakdown .debt-line .bank-fig{color:var(--red);}
  .pay-breakdown .due{padding-top:8px;margin-top:2px;border-top:1px dashed var(--border);color:var(--t1);font-size:13px;}
  .bank-fig{font-family:'JetBrains Mono',monospace;font-weight:900;font-size:14px;color:var(--t1);letter-spacing:-.02em;tabular-nums;}
  .bank-fig.sum{font-size:clamp(18px,4.5vw,26px);color:var(--accent);line-height:1.1;text-align:right;min-width:0;overflow-wrap:anywhere;}
  .pay-debt-box{
    margin:0 0 12px;padding:10px 12px;border-radius:14px;
    background:rgba(255,69,69,.07);border:1px solid rgba(255,69,69,.28);
  }
  .pos-root[data-theme="light"] .pay-debt-box{background:rgba(220,38,38,.06);border-color:rgba(220,38,38,.22);}
  .pos-root .pay-debt-toggle{
    width:100%;display:flex;align-items:center;gap:10px;text-align:left;
    padding:0;border:none;background:transparent;cursor:pointer;color:var(--t1);
  }
  .pay-debt-toggle .sw{
    width:36px;height:22px;border-radius:99px;flex-shrink:0;
    background:rgba(255,255,255,.08);border:1px solid var(--border);position:relative;
    transition:all .18s;
  }
  .pay-debt-toggle .sw::after{
    content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;
    background:var(--t3);transition:all .18s;
  }
  .pay-debt-toggle.on .sw{background:rgba(255,69,69,.35);border-color:var(--red);}
  .pay-debt-toggle.on .sw::after{left:16px;background:var(--red);}
  .pay-debt-toggle span:last-child{display:flex;flex-direction:column;gap:1px;font-size:13px;font-weight:800;min-width:0;}
  .pay-debt-toggle b{color:var(--red);font-family:'JetBrains Mono',monospace;}
  .pay-debt-toggle em{font-style:normal;font-size:11px;font-weight:650;color:var(--t3);}
  .pay-debt-row{display:grid;grid-template-columns:48px 64px 1fr;gap:6px;margin-top:10px;}
  .pos-root .pay-debt-row button{
    padding:8px 6px;border-radius:11px;font-size:12px;font-weight:800;
    background:var(--surface);border:1.5px solid var(--border);color:var(--t2);
  }
  .pos-root .pay-debt-row button.on{border-color:var(--red);background:rgba(255,69,69,.12);color:var(--t1);}
  .pay-debt-amt{
    width:100%;box-sizing:border-box;padding:8px 10px;border-radius:11px;text-align:right;
    font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:800;
    background:var(--surface);border:1.5px solid var(--border);color:var(--t1);outline:none;
  }
  .pay-debt-amt:focus{border-color:rgba(255,69,69,.45);}
  .cash-debt-split{margin:-2px 0 10px;font-size:11px;font-weight:700;color:var(--t3);text-align:center;}
  .cash-debt-split span{color:var(--red);font-weight:800;}
  .pay-bonus-box{
    padding:12px;border-radius:14px;background:rgba(155,109,255,.08);border:1.5px solid rgba(155,109,255,.28);margin-bottom:12px;
  }
  .pos-root[data-theme="light"] .pay-bonus-box{background:rgba(124,58,237,.06);border-color:rgba(124,58,237,.22);}
  .pay-bonus-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;font-size:12px;font-weight:800;}
  .pay-bonus-head .muted{font-size:11px;font-weight:700;color:var(--t3);}
  .pay-bonus-quick{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px;}
  .pos-root .pay-bonus-quick button{
    padding:8px;border-radius:11px;font-size:12px;font-weight:800;background:var(--surface);border:1.5px solid var(--border);color:var(--t2);
  }
  .pos-root .pay-bonus-quick button.on{border-color:var(--pur);background:rgba(155,109,255,.16);color:var(--t1);}
  .pay-bonus-range{width:100%;accent-color:var(--pur);margin:0 0 8px;}
  .pay-bonus-val{font-size:12px;font-weight:700;color:var(--t2);}
  .pay-bonus-val b{font-family:'JetBrains Mono',monospace;color:var(--pur);}
  .cash-change-box{
    display:flex;align-items:center;justify-content:space-between;gap:10px;
    margin:12px 0 8px;padding:14px 16px;border-radius:14px;
    background:var(--surface2);border:1.5px solid var(--border);
  }
  .cash-change-box span{font-size:12px;font-weight:800;color:var(--t2);text-transform:uppercase;letter-spacing:.04em;}
  .cash-change-box .bank-fig{font-size:clamp(20px,5vw,28px);color:var(--t3);}
  .cash-change-box.ok{border-color:rgba(31,215,96,.35);background:rgba(31,215,96,.08);}
  .cash-change-box.ok .bank-fig{color:var(--accent);}
  .cash-change-box.short{border-color:rgba(255,69,69,.4);background:rgba(255,69,69,.08);}
  .cash-change-box.short .bank-fig{color:var(--red);}
  .cash-change-warn{font-size:11px;font-weight:800;color:var(--red);margin:-2px 0 10px;text-align:right;}

  .modal-card.cash-checkout-card{
    width:min(440px,94vw);max-height:min(94vh,760px);overflow-y:auto;padding:20px 20px 18px;
    background:
      radial-gradient(120% 80% at 100% 0%, rgba(31,215,96,.12), transparent 55%),
      radial-gradient(90% 70% at 0% 100%, rgba(255,184,0,.08), transparent 50%),
      var(--surface);
  }
  .pos-root[data-theme="light"] .modal-card.cash-checkout-card{
    background:
      radial-gradient(120% 80% at 100% 0%, rgba(18,155,69,.1), transparent 55%),
      radial-gradient(90% 70% at 0% 100%, rgba(196,138,0,.08), transparent 50%),
      var(--surface);
  }
  .cash-checkout-shell{
    display:flex;align-items:stretch;justify-content:center;gap:12px;
    max-width:min(960px,96vw);max-height:min(94vh,820px);
  }
  .cash-checkout-shell .cash-checkout-card{margin:0;flex:0 1 440px;max-height:100%;}
  .cash-checkout-shell.with-pad .cash-checkout-card{width:min(400px,52vw);}
  .cash-pad-side{
    flex:0 0 min(320px,42vw);width:min(320px,42vw);
    display:flex;flex-direction:column;
    padding:16px 14px;border-radius:22px;
    background:var(--surface);border:1.5px solid var(--border);
    box-shadow:0 16px 40px var(--shade);
    animation:popIn .22s cubic-bezier(.16,1,.3,1);
    min-height:0;align-self:stretch;
  }
  .cash-pad-side-title{
    font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;
    color:var(--t3);margin-bottom:10px;text-align:center;flex-shrink:0;
  }
  .cash-pad-side .keypad{
    margin:0;flex:1;min-height:0;
    display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(4,1fr);
    gap:10px;align-content:stretch;
  }
  .cash-pad-side .keypad button{
    min-height:0;height:100%;padding:0;border-radius:16px;
    font-size:clamp(22px,3.2vw,28px);font-weight:800;
  }
  .cash-pad-side .keypad button.kp-clear{font-size:clamp(18px,2.6vw,22px);}
  .pos-root button.cash-pad-side-hide{
    margin-top:12px;padding:12px;border-radius:14px;font-size:13px;font-weight:800;
    color:var(--t2);background:var(--surface2);border:1.5px solid var(--border);flex-shrink:0;
  }
  @media (max-width:720px){
    .cash-checkout-shell.with-pad{
      flex-direction:column;align-items:center;overflow-y:auto;padding:8px 0;
    }
    .cash-checkout-shell.with-pad .cash-checkout-card{width:min(440px,94vw);}
    .cash-pad-side{flex:none;width:min(440px,94vw);min-height:340px;}
  }
  .cash-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:12px;}
  .cash-head h3{margin:0;font-family:'Unbounded',sans-serif;font-size:15px;font-weight:800;}
  .cash-head-client{font-size:11px;font-weight:800;color:var(--t3);text-align:right;max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .cash-due-pill{
    display:flex;align-items:center;justify-content:space-between;gap:10px;
    padding:10px 14px;margin-bottom:12px;border-radius:14px;
    background:var(--surface2);border:1px solid var(--border);
  }
  .cash-due-pill span{font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--t3);}
  .cash-due-pill b{font-family:'JetBrains Mono',monospace;font-size:clamp(15px,3.8vw,18px);font-weight:900;color:var(--t1);tabular-nums;}
  .cash-change-hero{
    text-align:center;padding:22px 16px 20px;margin-bottom:14px;border-radius:20px;
    border:1.5px solid var(--border);background:var(--surface2);
    transition:border-color .15s,background .15s,box-shadow .15s;
  }
  .cash-change-hero.idle{opacity:.85;}
  .cash-change-hero.ok{
    border-color:rgba(31,215,96,.45);
    background:linear-gradient(165deg, rgba(31,215,96,.16), rgba(31,215,96,.04) 60%, var(--surface2));
    box-shadow:0 10px 28px rgba(31,215,96,.12);
  }
  .cash-change-hero.short{
    border-color:rgba(255,69,69,.45);
    background:linear-gradient(165deg, rgba(255,69,69,.14), rgba(255,69,69,.04) 60%, var(--surface2));
  }
  .pos-root[data-theme="light"] .cash-change-hero.ok{
    border-color:rgba(18,155,69,.35);
    background:linear-gradient(165deg, rgba(18,155,69,.12), rgba(18,155,69,.03) 60%, #fff);
    box-shadow:0 10px 24px rgba(18,155,69,.1);
  }
  .cash-change-lbl{
    font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--t3);margin-bottom:6px;
  }
  .cash-change-hero.ok .cash-change-lbl{color:var(--accent);}
  .cash-change-hero.short .cash-change-lbl{color:var(--red);}
  .cash-change-val{
    font-family:'JetBrains Mono',monospace;font-weight:900;line-height:1;
    font-size:clamp(40px,11vw,56px);letter-spacing:-.04em;tabular-nums;color:var(--t2);
    display:flex;align-items:baseline;justify-content:center;gap:10px;flex-wrap:wrap;
  }
  .cash-change-hero.ok .cash-change-val{color:var(--accent);}
  .cash-change-hero.short .cash-change-val{color:var(--red);}
  .cash-change-val span{font-size:clamp(14px,3.5vw,18px);font-weight:800;letter-spacing:0;opacity:.75;}
  .cash-change-bonus{margin-top:10px;font-size:12px;font-weight:800;color:var(--gd);}
  .cash-recv{
    margin-bottom:12px;padding:12px 14px;border-radius:16px;
    background:var(--surface2);border:1.5px solid var(--border);text-align:center;
  }
  .cash-recv .lbl{font-size:10px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--t3);margin-bottom:4px;}
  .cash-recv-field{
    width:100%;background:transparent;border:none;outline:none;text-align:center;
    font-family:'JetBrains Mono',monospace;font-size:clamp(28px,7vw,36px);font-weight:800;
    color:var(--t1);caret-color:var(--accent);padding:2px 0;min-width:0;
  }
  .cash-recv-field::placeholder{color:var(--t3);}
  .cash-bills{
    display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px;
  }
  .pos-root .cash-bills button{
    min-height:48px;padding:10px 6px;border-radius:14px;font-family:'JetBrains Mono',monospace;
    font-size:15px;font-weight:900;background:var(--surface2);border:1.5px solid var(--border);color:var(--t1);
    transition:transform .1s,border-color .12s,background .12s;
  }
  .pos-root .cash-bills button:hover{border-color:var(--accent);transform:translateY(-1px);}
  .pos-root .cash-bills button.on{border-color:var(--accent);background:rgba(31,215,96,.14);color:var(--accent);}
  .pos-root .cash-bills button.exact{
    grid-column:1 / -1;font-family:'Nunito',sans-serif;font-size:13px;font-weight:800;color:var(--t2);
  }
  .pos-root .cash-bills button.exact:hover{color:var(--t1);}
  .pos-root .cash-bills button.alt{
    font-family:'Nunito',sans-serif;font-size:12px;font-weight:800;letter-spacing:.02em;
  }
  .pos-root .cash-bills button.alt.card{
    border-color:rgba(59,130,246,.45);background:rgba(59,130,246,.12);color:var(--blue);
  }
  .pos-root .cash-bills button.alt.card:hover{border-color:var(--blue);background:rgba(59,130,246,.2);}
  .pos-root .cash-bills button.alt.debt{
    border-color:rgba(234,88,12,.45);background:rgba(234,88,12,.12);color:var(--org);
  }
  .pos-root .cash-bills button.alt.debt:hover{border-color:var(--org);background:rgba(234,88,12,.2);}
  .pos-root button.cash-pad-toggle{
    width:100%;min-height:42px;margin-bottom:12px;padding:10px;border-radius:13px;
    font-size:12px;font-weight:800;color:var(--t2);background:var(--surface2);border:1.5px solid var(--border);
  }
  .pos-root button.cash-pad-toggle.on{border-color:var(--accent);color:var(--accent);background:rgba(31,215,96,.1);}
  .cash-actions{margin-top:4px;}
  .pos-root button.cash-accept{font-size:14px;min-height:48px;}
  @media (max-width:420px){
    .cash-bills{grid-template-columns:repeat(3,1fr);}
    .cash-change-val{font-size:clamp(34px,12vw,48px);}
  }

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
  .hist-cash-meta{
    margin-top:4px;display:flex;flex-direction:column;align-items:flex-end;gap:1px;
    font-size:10.5px;font-weight:700;color:var(--t3);line-height:1.25;
  }
  .hist-cash-meta .hist-change{color:var(--accent);font-weight:800;}
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
  .kp-field{
    width:100%;background:transparent;border:none;outline:none;text-align:center;
    font-family:'JetBrains Mono',monospace;font-size:28px;font-weight:800;color:var(--t1);
    padding:4px 0;caret-color:var(--accent);min-width:0;
  }
  .kp-field::placeholder{color:var(--t3);}
  .amount-pad-row{display:flex;justify-content:flex-end;margin-bottom:12px;}
  .amount-pad-row .qty-pad-toggle{min-height:40px;}
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
